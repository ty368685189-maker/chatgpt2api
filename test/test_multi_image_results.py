from __future__ import annotations

import base64
import unittest
from unittest import mock

from services.config import config
from services.openai_backend_api import OpenAIBackendAPI
from services.protocol.conversation import ConversationRequest, ImageOutput, extract_conversation_ids, should_poll_image_result, stream_image_outputs
from services.protocol.openai_v1_response import stream_image_response


def _conversation(file_ids: list[str], sediment_ids: list[str] | None = None) -> dict:
    parts: list[object] = [
        {"content_type": "image_asset_pointer", "asset_pointer": f"file-service://{file_id}"}
        for file_id in file_ids
    ]
    parts.extend(f"sediment://{sediment_id}" for sediment_id in (sediment_ids or []))
    return {
        "mapping": {
            "tool": {
                "message": {
                    "author": {"role": "tool"},
                    "create_time": 1,
                    "metadata": {"async_task_type": "image_gen"},
                    "content": {"content_type": "multimodal_text", "parts": parts},
                }
            }
        }
    }


class FakeBackend(OpenAIBackendAPI):
    def __init__(self, conversations: list[dict] | None = None) -> None:
        self.conversations = conversations or []
        self.calls = 0
        self.session = mock.Mock()
        self.file_urls: dict[str, str] = {}
        self.sediment_urls: dict[str, str] = {}
        self.download_calls: list[list[str]] = []

    def _get_conversation(self, conversation_id: str) -> dict:
        self.calls += 1
        index = min(self.calls - 1, len(self.conversations) - 1)
        return self.conversations[index]

    def stream_conversation(self, **_kwargs):
        payloads = []
        for conversation in self.conversations:
            payloads.append(
                '{"type":"server_ste_metadata","conversation_id":"conv-1","metadata":{"tool_invoked":true}}'
            )
        payloads.append("[DONE]")
        return iter(payloads)

    def _get_file_download_url(self, file_id: str) -> str:
        return self.file_urls.get(file_id, "")

    def _get_attachment_download_url(self, conversation_id: str, attachment_id: str) -> str:
        return self.sediment_urls.get(attachment_id, "")

    def download_image_bytes(self, urls: list[str]):
        self.download_calls.append(list(urls))
        return [url.encode("utf-8") for url in urls]


def _image_response(data: list[dict[str, object]]) -> dict:
    return {
        "id": "resp-1",
        "object": "chat.completion",
        "model": "gpt-5",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "看起来需要继续等待图片结果。",
                        }
                    ],
                    "tool_calls": [],
                },
                "finish_reason": "stop",
            }
        ],
        "data": data,
    }


class MultiImageResultTests(unittest.TestCase):
    def test_image_tool_invoked_event_keeps_polling_context(self) -> None:
        request = ConversationRequest()
        self.assertTrue(should_poll_image_result(request, {"tool_invoked": True}))
        self.assertTrue(should_poll_image_result(request, {"turn_use_case": "image gen"}))
        self.assertFalse(should_poll_image_result(request, {}))

    def test_stream_image_outputs_polls_when_tool_was_invoked(self) -> None:
        backend = FakeBackend([{}])

        with (
            mock.patch("services.protocol.conversation._get_detailed_error_from_tasks", return_value=""),
            mock.patch("services.protocol.conversation.time.sleep", lambda _seconds: None),
            mock.patch.object(backend, "_poll_image_results", return_value=([], [])) as poll_mock,
        ):
            outputs = list(stream_image_outputs(backend, ConversationRequest(model="gpt-image-2"), index=1, total=1))

        self.assertGreaterEqual(poll_mock.call_count, 1)
        self.assertTrue(any(output.kind == "message" for output in outputs))

    def test_stream_image_outputs_keeps_polling_after_tool_invoked_event(self) -> None:
        backend = FakeBackend([
            {},
            _conversation(["file-one", "file-two"], ["sed-one"]),
        ])

        backend.file_urls = {
            "file-one": "https://files.test/one.png",
            "file-two": "https://files.test/two.png",
        }
        backend.sediment_urls = {"sed-one": "https://attachments.test/one.png"}

        with (
            mock.patch("services.protocol.conversation._get_detailed_error_from_tasks", return_value=""),
            mock.patch("services.protocol.conversation.time.sleep", lambda _seconds: None),
        ):
            outputs = list(stream_image_outputs(backend, ConversationRequest(model="gpt-image-2"), index=1, total=1))

        result_outputs = [output for output in outputs if output.kind == "result"]
        self.assertTrue(result_outputs)
        self.assertEqual(backend.calls, 2)
        self.assertEqual([item["b64_json"] for item in result_outputs[-1].data], [
            "aHR0cHM6Ly9maWxlcy50ZXN0L29uZS5wbmc=",
            "aHR0cHM6Ly9maWxlcy50ZXN0L3R3by5wbmc=",
            "aHR0cHM6Ly9hdHRhY2htZW50cy50ZXN0L29uZS5wbmc=",
        ])
        self.assertEqual(len(result_outputs[-1].data), 3)
        self.assertTrue(all(str(item["url"]).startswith("/images/") for item in result_outputs[-1].data))
        self.assertEqual(backend.download_calls[-1], [
            "https://files.test/one.png",
            "https://files.test/two.png",
            "https://attachments.test/one.png",
        ])

    def test_stream_id_extractor_keeps_full_file_ids(self) -> None:
        payload = (
            '{"conversation_id":"conv-1"} '
            'file-service://file-first_123-extra sediment://sed-second_456-extra'
        )

        conversation_id, file_ids, sediment_ids = extract_conversation_ids(payload)

        self.assertEqual(conversation_id, "conv-1")
        self.assertEqual(file_ids, ["file-first_123-extra"])
        self.assertEqual(sediment_ids, ["sed-second_456-extra"])

    def test_conversation_record_extractor_finds_all_generated_assets(self) -> None:
        backend = FakeBackend()
        conversation = {
            "mapping": {
                "user": {
                    "message": {
                        "author": {"role": "user"},
                        "content": {"parts": ["file-service://file-user-input"]},
                    }
                },
                "tool": {
                    "message": {
                        "author": {"role": "tool"},
                        "create_time": 1,
                        "metadata": {
                            "async_task_type": "image_gen",
                            "nested": {"asset": "file-service://file-second"},
                        },
                        "content": {
                            "content_type": "text",
                            "parts": [
                                {"content_type": "image_asset_pointer", "asset_pointer": "file-service://file-first"},
                                "sediment://sed-first",
                            ],
                        },
                    }
                },
                "assistant": {
                    "message": {
                        "author": {"role": "assistant"},
                        "create_time": 2,
                        "metadata": {},
                        "content": {
                            "parts": [
                                {"content_type": "image_asset_pointer", "asset_pointer": "file-service://file-third"}
                            ]
                        },
                    }
                },
            }
        }

        records = backend._extract_image_tool_records(conversation)
        file_ids = [file_id for record in records for file_id in record["file_ids"]]
        sediment_ids = [sediment_id for record in records for sediment_id in record["sediment_ids"]]

        self.assertEqual(file_ids, ["file-first", "file-second", "file-third"])
        self.assertEqual(sediment_ids, ["sed-first"])

    def test_poll_waits_for_generated_asset_ids_to_settle(self) -> None:
        backend = FakeBackend([
            _conversation(["file-one"]),
            _conversation(["file-one", "file-two"], ["sed-one"]),
            _conversation(["file-one", "file-two"], ["sed-one"]),
        ])

        with (
            mock.patch.dict(config.data, {
                "image_poll_initial_wait_secs": 0,
                "image_poll_interval_secs": 0.5,
                "image_check_before_hit_enabled": True,
                "image_settle_enabled": True,
            }),
            mock.patch("services.openai_backend_api.time.sleep", lambda _seconds: None),
        ):
            file_ids, sediment_ids = backend._poll_image_results("conv-1", timeout_secs=10)

        self.assertEqual(file_ids, ["file-one", "file-two"])
        self.assertEqual(sediment_ids, ["sed-one"])
        self.assertEqual(backend.calls, 3)

    def test_resolver_uses_file_and_sediment_urls(self) -> None:
        backend = FakeBackend()
        backend.file_urls = {"file-one": "https://files.test/one.png"}
        backend.sediment_urls = {
            "sed-one": "https://attachments.test/one.png",
            "sed-two": "https://attachments.test/two.png",
        }

        urls = backend._resolve_image_urls("conv-1", ["file-one"], ["sed-one", "sed-two"])

        self.assertEqual(urls, [
            "https://files.test/one.png",
            "https://attachments.test/one.png",
            "https://attachments.test/two.png",
        ])

    def test_resolver_keeps_stream_ids_when_poll_extension_fails(self) -> None:
        backend = FakeBackend()
        backend.file_urls = {"file-one": "https://files.test/one.png"}
        backend._get_conversation = mock.Mock(side_effect=RuntimeError("poll failed"))

        with mock.patch("services.openai_backend_api.time.sleep", lambda _seconds: None):
            urls = backend.resolve_conversation_image_urls("conv-1", ["file-one"], [], poll=True)

        self.assertEqual(urls, ["https://files.test/one.png"])

    def test_responses_stream_emits_all_image_output_items(self) -> None:
        first = base64.b64encode(b"first").decode("ascii")
        second = base64.b64encode(b"second").decode("ascii")
        events = list(stream_image_response(
            [ImageOutput(
                kind="result",
                model="gpt-image-2",
                index=1,
                total=1,
                data=[{"b64_json": first}, {"b64_json": second}],
            )],
            "draw two options",
            "gpt-image-2",
        ))

        done_events = [event for event in events if event.get("type") == "response.output_item.done"]
        completed = next(event["response"] for event in events if event.get("type") == "response.completed")

        self.assertEqual([event["output_index"] for event in done_events], [0, 1])
        self.assertEqual([item["result"] for item in completed["output"]], [first, second])

    def test_stream_image_response_preserves_multiple_image_items(self) -> None:
        first = base64.b64encode(b"alpha").decode("ascii")
        second = base64.b64encode(b"beta").decode("ascii")
        outputs = [ImageOutput(
            kind="result",
            model="gpt-image-2",
            index=1,
            total=1,
            data=[{"b64_json": first}, {"b64_json": second}],
        )]

        events = list(stream_image_response(outputs, "draw two options", "gpt-image-2"))
        completed = next(event["response"] for event in events if event.get("type") == "response.completed")

        self.assertEqual([item["result"] for item in completed["output"]], [first, second])


if __name__ == "__main__":
    unittest.main()

import unittest
from unittest import mock
from services.protocol.conversation import _generate_single_image, ImageOutput, ImageGenerationError, image_stream_error_message, public_image_error_message
from services.openai_backend_api import ImagePollTimeoutError


class AccountFailoverTests(unittest.TestCase):
    @mock.patch("services.protocol.conversation.account_service")
    @mock.patch("services.protocol.conversation.OpenAIBackendAPI")
    @mock.patch("services.protocol.conversation.stream_image_outputs")
    @mock.patch("services.protocol.conversation.proxy_pool_manager")
    def test_failover_on_poll_timeout(self, mock_proxy_pool, mock_stream, mock_backend_cls, mock_account_service) -> None:
        # Setup tokens
        mock_account_service.get_available_access_token.side_effect = ["token1", "token2"]
        mock_account_service.get_account.side_effect = [{"email": "e1@test.com"}, {"email": "e2@test.com"}]
        mock_proxy_pool.get_next_proxy.return_value = "http://proxy1"

        # First backend call raises PollTimeout, second succeeds
        mock_stream.side_effect = [
            ImagePollTimeoutError("poll timeout"),
            [ImageOutput(kind="result", model="gpt-image-2", index=1, total=1, data="fake-img")]
        ]
        
        request = mock.Mock()
        request.model = "gpt-image-2"
        request.progress_callback = None
        request.message_as_error = False
        
        outputs = _generate_single_image(request, 1, 1)
        
        # Verify it retried with second token and got the result
        self.assertEqual(len(outputs), 1)
        self.assertEqual(outputs[0].data, "fake-img")
        self.assertEqual(outputs[0].account_email, "e2@test.com")
        
        # Verify proxy pool manager was marked failed for the first proxy
        mock_proxy_pool.mark_proxy_failed.assert_called_once_with("http://proxy1")

    @mock.patch("services.protocol.conversation.account_service")
    @mock.patch("services.protocol.conversation.OpenAIBackendAPI")
    @mock.patch("services.protocol.conversation.stream_image_outputs")
    @mock.patch("services.protocol.conversation.proxy_pool_manager")
    def test_failover_on_general_generation_error(self, mock_proxy_pool, mock_stream, mock_backend_cls, mock_account_service) -> None:
        mock_account_service.get_available_access_token.side_effect = ["token1", "token2"]
        mock_account_service.get_account.side_effect = [{"email": "e1@test.com"}, {"email": "e2@test.com"}]
        mock_proxy_pool.get_next_proxy.return_value = "http://proxy1"

        # First call raises general ImageGenerationError, second succeeds
        mock_stream.side_effect = [
            ImageGenerationError("upstream 502 error", code="upstream_error"),
            [ImageOutput(kind="result", model="gpt-image-2", index=1, total=1, data="fake-img-2")]
        ]
        
        request = mock.Mock()
        request.model = "gpt-image-2"
        request.progress_callback = None
        request.message_as_error = False
        
        outputs = _generate_single_image(request, 1, 1)
        
        self.assertEqual(len(outputs), 1)
        self.assertEqual(outputs[0].data, "fake-img-2")
        self.assertEqual(outputs[0].account_email, "e2@test.com")
        
        mock_proxy_pool.mark_proxy_failed.assert_called_once_with("http://proxy1")

    @mock.patch("services.protocol.conversation.account_service")
    @mock.patch("services.protocol.conversation.OpenAIBackendAPI")
    @mock.patch("services.protocol.conversation.stream_image_outputs")
    @mock.patch("services.protocol.conversation.proxy_pool_manager")
    def test_no_failover_on_content_policy_error(self, mock_proxy_pool, mock_stream, mock_backend_cls, mock_account_service) -> None:
        mock_account_service.get_available_access_token.return_value = "token1"
        mock_account_service.get_account.return_value = {"email": "e1@test.com"}
        mock_proxy_pool.get_next_proxy.return_value = "http://proxy1"

        # First call raises content policy violation (which should NOT failover/retry)
        mock_stream.side_effect = ImageGenerationError("content violation", code="content_policy_violation")
        
        request = mock.Mock()
        request.model = "gpt-image-2"
        request.progress_callback = None
        request.message_as_error = False
        
        with self.assertRaises(ImageGenerationError) as ctx:
            _generate_single_image(request, 1, 1)
            
        self.assertEqual(ctx.exception.code, "content_policy_violation")
        
        # Verify proxy pool was NOT marked failed (since it's a prompt issue, not proxy issue)
        mock_proxy_pool.mark_proxy_failed.assert_not_called()

    def test_image_error_messages_are_stable(self) -> None:
        self.assertEqual(
            public_image_error_message("backend-api/123 status=500 body=oops"),
            "The image generation request failed. Please try again later.",
        )
        self.assertEqual(
            image_stream_error_message("curl: (35) TLS connect error"),
            "upstream image connection failed, please retry later",
        )
        self.assertEqual(
            image_stream_error_message("curl: (28) Operation timed out"),
            "upstream connection timed out, please retry later",
        )
        self.assertEqual(
            image_stream_error_message("anything else"),
            "anything else",
        )


if __name__ == "__main__":
    unittest.main()

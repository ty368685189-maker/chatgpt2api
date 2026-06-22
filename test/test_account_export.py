import base64
import json
import unittest
from typing import Any
from unittest import mock

from services.account_service import AccountService


class MemoryStorage:
    def __init__(self, accounts: list[dict[str, Any]] | None = None) -> None:
        self.accounts = list(accounts or [])

    def load_accounts(self) -> list[dict[str, Any]]:
        return list(self.accounts)

    def save_accounts(self, accounts: list[dict[str, Any]]) -> None:
        self.accounts = list(accounts)

    def load_auth_keys(self) -> list[dict[str, Any]]:
        return []

    def save_auth_keys(self, auth_keys: list[dict[str, Any]]) -> None:
        pass

    def health_check(self) -> dict[str, Any]:
        return {"ok": True}

    def get_backend_info(self) -> dict[str, Any]:
        return {"type": "memory"}


def make_jwt(payload: dict[str, Any]) -> str:
    def encode(value: dict[str, Any]) -> str:
        raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    return f'{encode({"alg": "none", "typ": "JWT"})}.{encode(payload)}.sig'


class AccountExportTests(unittest.TestCase):
    def test_build_export_items_uses_codex_shape_and_jwt_claims(self) -> None:
        access_token = make_jwt(
            {
                "exp": 0,
                "iat": 3600,
                "https://api.openai.com/auth": {"chatgpt_account_id": "acct_123"},
                "https://api.openai.com/profile": {"email": "test@example.com"},
            }
        )
        id_token = make_jwt({"email": "fallback@example.com"})
        service = AccountService(
            MemoryStorage(
                [
                    {
                        "access_token": access_token,
                        "id_token": id_token,
                        "refresh_token": "rt_test",
                    }
                ]
            )
        )

        [item] = service.build_export_items([access_token])

        self.assertEqual(item["type"], "codex")
        self.assertEqual(item["email"], "test@example.com")
        self.assertEqual(item["expired"], "1970-01-01T08:00:00+08:00")
        self.assertEqual(item["account_id"], "acct_123")
        self.assertEqual(item["access_token"], access_token)
        self.assertEqual(item["last_refresh"], "1970-01-01T09:00:00+08:00")
        self.assertEqual(item["id_token"], id_token)
        self.assertEqual(item["refresh_token"], "rt_test")

    def test_build_export_items_skips_accounts_missing_complete_tokens(self) -> None:
        complete_access_token = make_jwt({"exp": 0})
        complete_id_token = make_jwt({"email": "complete@example.com"})
        service = AccountService(
            MemoryStorage(
                [
                    {"access_token": "only_access"},
                    {"access_token": "missing_id", "refresh_token": "rt_missing_id"},
                    {"access_token": complete_access_token, "id_token": complete_id_token, "refresh_token": "rt_complete"},
                ]
            )
        )

        items = service.build_export_items()

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["access_token"], complete_access_token)
        self.assertEqual(items[0]["id_token"], complete_id_token)
        self.assertEqual(items[0]["refresh_token"], "rt_complete")

    def test_add_account_items_preserves_export_fields_without_overwriting_plan_type(self) -> None:
        service = AccountService(MemoryStorage())

        result = service.add_account_items(
            [
                {
                    "type": "codex",
                    "access_token": "access_token_test",
                    "refresh_token": "rt_test",
                    "account_id": "acct_123",
                }
            ]
        )

        account = service.get_account("access_token_test")
        self.assertEqual(result["added"], 1)
        self.assertIsNotNone(account)
        self.assertEqual(account["type"], "free")
        self.assertEqual(account["export_type"], "codex")
        self.assertEqual(account["refresh_token"], "rt_test")
        self.assertEqual(account["account_id"], "acct_123")

    def test_keepalive_refresh_tokens_logs_summary_and_returns_items(self) -> None:
        service = AccountService(
            MemoryStorage(
                [
                    {
                        "access_token": "token-a",
                        "refresh_token": "rt-a",
                        "status": "正常",
                        "last_token_refresh_error": None,
                    },
                    {
                        "access_token": "token-b",
                        "refresh_token": "rt-b",
                        "status": "正常",
                        "last_token_refresh_error": "recent keepalive error",
                        "last_token_refresh_error_at": "2099-01-01T00:00:00+00:00",
                    },
                ]
            )
        )

        with (
            mock.patch.object(service, "refresh_access_token", side_effect=lambda token, force=False, event="refresh_access_token": token),
            mock.patch("services.account_service.log_service") as log_mock,
        ):
            result = service.keepalive_refresh_tokens([" token-a ", "token-b", ""])

        self.assertEqual(result["refreshed"], 1)
        self.assertEqual(len(result["errors"]), 0)
        self.assertEqual(len(result["skipped"]), 1)
        self.assertEqual(result["items"], service.list_accounts())
        self.assertEqual(result["relogined"], 0)
        self.assertGreaterEqual(log_mock.add.call_count, 1)
        self.assertEqual(log_mock.add.call_args_list[-1].args[1], "refresh_token keepalive 执行完成")

    def test_keepalive_refresh_tokens_skips_recent_error_accounts(self) -> None:
        service = AccountService(
            MemoryStorage(
                [
                    {
                        "access_token": "token-a",
                        "refresh_token": "rt-a",
                        "status": "正常",
                        "last_token_refresh_error": "recent keepalive error",
                        "last_token_refresh_error_at": "2099-01-01T00:00:00+00:00",
                    },
                    {
                        "access_token": "token-b",
                        "refresh_token": "rt-b",
                        "status": "正常",
                        "last_token_refresh_error": None,
                    },
                ]
            )
        )

        with (
            mock.patch.object(service, "refresh_access_token", side_effect=lambda token, force=False, event="refresh_access_token": token),
            mock.patch("services.account_service.log_service") as log_mock,
        ):
            result = service.keepalive_refresh_tokens(["token-a", "token-b"])

        self.assertEqual(result["refreshed"], 1)
        self.assertEqual(len(result["skipped"]), 1)
        self.assertTrue(result["skipped"][0]["token"].startswith("token:"))
        self.assertEqual(result["skipped"][0]["reason"], "recent_keepalive_error")
        self.assertEqual(log_mock.add.call_args_list[-1].args[1], "refresh_token keepalive 执行完成")


if __name__ == "__main__":
    unittest.main()

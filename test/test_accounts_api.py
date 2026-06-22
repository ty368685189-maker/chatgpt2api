from __future__ import annotations

import unittest
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.accounts as accounts_module


class AccountsApiRefreshTokenTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fake_account_service = mock.Mock()
        self.fake_account_service.keepalive_refresh_tokens.return_value = {
            "items": [],
            "refreshed": 2,
            "relogined": 0,
            "errors": [],
        }

        self.patchers = [
            mock.patch.object(accounts_module, "account_service", self.fake_account_service),
            mock.patch.object(accounts_module, "require_admin", lambda _authorization: {"role": "admin"}),
        ]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

        app = FastAPI()
        app.include_router(accounts_module.create_router())
        self.client = TestClient(app)

    def test_refresh_token_keepalive_trims_tokens_and_calls_service(self) -> None:
        response = self.client.post(
            "/api/accounts/refresh-token",
            headers={"Authorization": "Bearer test"},
            json={"access_tokens": ["  token-a  ", "", "token-b"]},
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            self.fake_account_service.keepalive_refresh_tokens.call_args.args[0],
            ["token-a", "token-b"],
        )
        self.assertEqual(response.json()["refreshed"], 2)

    def test_refresh_token_keepalive_requires_tokens(self) -> None:
        response = self.client.post(
            "/api/accounts/refresh-token",
            headers={"Authorization": "Bearer test"},
            json={"access_tokens": ["   ", ""]},
        )

        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["detail"]["error"], "access_tokens is required")


if __name__ == "__main__":
    unittest.main()

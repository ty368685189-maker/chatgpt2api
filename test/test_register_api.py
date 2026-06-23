from __future__ import annotations

import tempfile
import unittest
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.register as register_module


class RegisterApiValidationTests(unittest.TestCase):
    def test_update_register_returns_400_for_invalid_cloudmail_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_service = mock.Mock()
            fake_service.update.side_effect = ValueError("CloudMail 至少要填写一个可用域名")

            app = FastAPI()
            with (
                mock.patch.object(register_module, "register_service", fake_service),
                mock.patch.object(register_module, "require_admin", lambda _authorization: {"role": "admin"}),
            ):
                app.include_router(register_module.create_router())
                client = TestClient(app)

                response = client.post(
                    "/api/register",
                    headers={"Authorization": "Bearer test"},
                    json={
                        "mail": {
                            "request_timeout": 30,
                            "wait_timeout": 30,
                            "wait_interval": 5,
                            "providers": [
                                {
                                    "enable": True,
                                    "type": "cloudmail_gen",
                                    "api_base": "https://cloudmail.example",
                                    "admin_email": "admin@example.com",
                                    "admin_password": "secret",
                                    "domain": [],
                                    "subdomain": [],
                                    "email_prefix": "",
                                }
                            ],
                        }
                    },
                )

            self.assertEqual(response.status_code, 400, response.text)
            self.assertEqual(response.json()["detail"]["error"], "CloudMail 至少要填写一个可用域名")

    def test_start_register_returns_400_for_invalid_provider_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_service = mock.Mock()
            fake_service.start.side_effect = ValueError("DDG Token 不能为空")

            app = FastAPI()
            with (
                mock.patch.object(register_module, "register_service", fake_service),
                mock.patch.object(register_module, "require_admin", lambda _authorization: {"role": "admin"}),
            ):
                app.include_router(register_module.create_router())
                client = TestClient(app)

                response = client.post("/api/register/start", headers={"Authorization": "Bearer test"})

            self.assertEqual(response.status_code, 400, response.text)
            self.assertEqual(response.json()["detail"]["error"], "DDG Token 不能为空")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from services import register_service as register_service_module


class RegisterServiceValidationTests(unittest.TestCase):
    def test_cloudmail_provider_requires_domain(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            store_file = Path(tmp_dir) / "register.json"
            service = register_service_module.RegisterService(store_file)

            with self.assertRaisesRegex(ValueError, "CloudMail 至少要填写一个可用域名"):
                service.update({
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
                })

    def test_register_update_requires_provider_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            store_file = Path(tmp_dir) / "register.json"
            service = register_service_module.RegisterService(store_file)

            with self.assertRaisesRegex(ValueError, "DDG Token 不能为空"):
                service.update(
                    {
                        "mail": {
                            "request_timeout": 30,
                            "wait_timeout": 30,
                            "wait_interval": 5,
                            "providers": [
                                {
                                    "enable": True,
                                    "type": "ddg_mail",
                                    "api_base": "https://cf.example",
                                    "ddg_token": "",
                                    "cf_inbox_jwt": "jwt",
                                    "admin_password": "",
                                    "cf_api_key": "",
                                    "cf_domain": [],
                                }
                            ],
                        }
                    }
                )

            with self.assertRaisesRegex(ValueError, "Outlook 邮箱池至少要导入一条"):
                service.update(
                    {
                        "mail": {
                            "request_timeout": 30,
                            "wait_timeout": 30,
                            "wait_interval": 5,
                            "providers": [
                                {
                                    "enable": True,
                                    "type": "outlook_token",
                                    "mailboxes": "   ",
                                }
                            ],
                        }
                    }
                )


if __name__ == "__main__":
    unittest.main()

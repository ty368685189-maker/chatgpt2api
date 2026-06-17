from __future__ import annotations

import hashlib
import os
import secrets
import threading
import uuid
from datetime import datetime
from typing import Any

from services.config import config
from services.auth_service import auth_service


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    pw_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
    return salt.hex() + ":" + pw_hash.hex()


def verify_password(password: str, hashed: str) -> bool:
    try:
        salt_hex, hash_hex = hashed.split(":")
        salt = bytes.fromhex(salt_hex)
        pw_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
        return pw_hash.hex() == hash_hex
    except Exception:
        return False


class UserService:
    def __init__(self):
        self._lock = threading.RLock()
        self._storage = config.get_storage_backend()

    def _load_users(self) -> list[dict[str, Any]]:
        try:
            return self._storage.load_users()
        except Exception:
            return []

    def _save_users(self, users: list[dict[str, Any]]) -> None:
        self._storage.save_users(users)

    def _load_reg_codes(self) -> list[dict[str, Any]]:
        try:
            return self._storage.load_reg_codes()
        except Exception:
            return []

    def _save_reg_codes(self, reg_codes: list[dict[str, Any]]) -> None:
        self._storage.save_reg_codes(reg_codes)

    def register_user(self, username: str, password: str, email: str | None, reg_code: str) -> dict[str, Any]:
        username = username.strip()
        reg_code = reg_code.strip()
        if not username or not password or not reg_code:
            raise ValueError("用户名、密码和激活码不能为空")

        with self._lock:
            users = self._load_users()
            # 校验用户名是否已存在（不区分大小写）
            if any(u["username"].lower() == username.lower() for u in users):
                raise ValueError("用户名已存在，请换一个名称")

            # 校验激活码
            reg_codes = self._load_reg_codes()
            code_item = next((c for c in reg_codes if c["code"] == reg_code), None)
            if not code_item:
                raise ValueError("无效的激活码")
            if code_item.get("status") != "active":
                raise ValueError("激活码已失效或已过期")
            max_uses = int(code_item.get("max_uses", -1))
            used_count = int(code_item.get("used_count", 0))
            if max_uses != -1 and used_count >= max_uses:
                code_item["status"] = "expired"
                self._save_reg_codes(reg_codes)
                raise ValueError("激活码使用次数已达上限")

            # 注册用户：创建关联 API 密钥
            # 自动生成在 auth_keys 中
            key_name = f"user-{username}"
            key_item, raw_key = auth_service.create_key(role="user", name=key_name)

            # 更新激活码使用次数
            code_item["used_count"] = used_count + 1
            if max_uses != -1 and code_item["used_count"] >= max_uses:
                code_item["status"] = "expired"
            self._save_reg_codes(reg_codes)

            # 保存用户记录
            user_id = uuid.uuid4().hex[:12]
            new_user = {
                "id": user_id,
                "username": username,
                "password_hash": hash_password(password),
                "email": email.strip() if email else "",
                "role": "user",
                "quota_limit": int(code_item.get("quota_limit", 10)),
                "quota_used": 0,
                "last_active_date": datetime.now().strftime("%Y-%m-%d"),
                "status": "active",
                "auth_key_id": key_item["id"],
                "api_key": raw_key,  # 允许用户在个人中心查看/复制
                "registered_by_code": reg_code,
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
            users.append(new_user)
            self._save_users(users)

            return {
                "id": new_user["id"],
                "username": new_user["username"],
                "role": new_user["role"],
                "email": new_user["email"],
                "quota_limit": new_user["quota_limit"],
                "quota_used": new_user["quota_used"],
                "api_key": new_user["api_key"],
            }

    def login_user(self, username: str, password: str) -> dict[str, Any]:
        username = username.strip()
        if not username or not password:
            raise ValueError("用户名和密码不能为空")

        with self._lock:
            users = self._load_users()
            user = next((u for u in users if u["username"].lower() == username.lower()), None)
            if not user or not verify_password(password, user["password_hash"]):
                raise ValueError("用户名或密码错误")

            if user.get("status") == "banned":
                raise ValueError("账户已被禁用，请联系管理员")

            # 每次登录时，确保其 API Key 在 auth_keys 中仍有效且启用
            # 如果被管理员禁用，在此处不恢复，直接以 DB 记录为准
            return {
                "id": user["id"],
                "username": user["username"],
                "role": user["role"],
                "email": user.get("email") or "",
                "quota_limit": int(user.get("quota_limit", 10)),
                "quota_used": int(user.get("quota_used", 0)),
                "api_key": user["api_key"],
            }

    def get_user_by_key_id(self, auth_key_id: str) -> dict[str, Any] | None:
        with self._lock:
            users = self._load_users()
            return next((u for u in users if u.get("auth_key_id") == auth_key_id), None)

    def verify_quota_and_deduct(self, auth_key_id: str) -> None:
        """根据 Key ID 校验用户配额并划扣一次额度"""
        with self._lock:
            users = self._load_users()
            user = next((u for u in users if u.get("auth_key_id") == auth_key_id), None)
            if not user:
                # 如果是管理员的 Key（或者不是普通自助注册的用户），放行不作限额
                return

            if user.get("status") == "banned":
                raise PermissionError("您的账户已被管理员封禁，无法使用绘图服务")

            from datetime import timezone, timedelta
            tz = timezone(timedelta(hours=8))
            today = datetime.now(tz).strftime("%Y-%m-%d")
            # 跨天重置
            if user.get("last_active_date") != today:
                user["quota_used"] = 0
                user["last_active_date"] = today

            limit = int(user.get("quota_limit", 10))
            used = int(user.get("quota_used", 0))

            if used >= limit:
                raise PermissionError(f"今日生图限额 ({limit} 次) 已用完，请明天再试")

            user["quota_used"] = used + 1
            self._save_users(users)

    # ================= 管理员用户管控 =================

    def list_users(self) -> list[dict[str, Any]]:
        with self._lock:
            users = self._load_users()
            # 过滤掉敏感的 password_hash
            result = []
            for u in users:
                copied = dict(u)
                copied.pop("password_hash", None)
                result.append(copied)
            return result

    def ban_user(self, user_id: str) -> bool:
        with self._lock:
            users = self._load_users()
            user = next((u for u in users if u["id"] == user_id), None)
            if not user:
                return False
            user["status"] = "banned"
            self._save_users(users)
            # 联动同步禁用 auth_keys 中的 Key
            key_id = user.get("auth_key_id")
            if key_id:
                try:
                    auth_service.update_key(key_id, {"enabled": False})
                except Exception:
                    pass
            return True

    def unban_user(self, user_id: str) -> bool:
        with self._lock:
            users = self._load_users()
            user = next((u for u in users if u["id"] == user_id), None)
            if not user:
                return False
            user["status"] = "active"
            self._save_users(users)
            # 联动同步启用 auth_keys 中的 Key
            key_id = user.get("auth_key_id")
            if key_id:
                try:
                    auth_service.update_key(key_id, {"enabled": True})
                except Exception:
                    pass
            return True

    def update_user_quota(self, user_id: str, quota_limit: int) -> bool:
        if quota_limit < 0:
            raise ValueError("配额限额不能小于 0")
        with self._lock:
            users = self._load_users()
            user = next((u for u in users if u["id"] == user_id), None)
            if not user:
                return False
            user["quota_limit"] = quota_limit
            self._save_users(users)
            return True

    def reset_user_password(self, user_id: str, new_password: str) -> bool:
        if not new_password:
            raise ValueError("新密码不能为空")
        with self._lock:
            users = self._load_users()
            user = next((u for u in users if u["id"] == user_id), None)
            if not user:
                return False
            user["password_hash"] = hash_password(new_password)
            self._save_users(users)
            return True

    def change_user_role(self, user_id: str, role: str) -> bool:
        if role not in {"user", "admin"}:
            raise ValueError("角色只能为 user 或 admin")
        with self._lock:
            users = self._load_users()
            user = next((u for u in users if u["id"] == user_id), None)
            if not user:
                return False
            user["role"] = role
            self._save_users(users)
            # 联动同步更新 auth_keys 中的 Key 角色
            key_id = user.get("auth_key_id")
            if key_id:
                try:
                    auth_service.update_key(key_id, {}, role=role) # 这里可以不做强制修改，只需更新 role
                except Exception:
                    pass
            return True

    # ================= 管理员注册激活码管理 =================

    def list_reg_codes(self) -> list[dict[str, Any]]:
        with self._lock:
            return self._load_reg_codes()

    def generate_reg_code(self, quota_limit: int, max_uses: int, note: str = "") -> dict[str, Any]:
        if quota_limit < 0:
            raise ValueError("生图配额限额不能小于 0")
        code = f"GY-{secrets.token_hex(4).upper()}"
        with self._lock:
            reg_codes = self._load_reg_codes()
            while any(c["code"] == code for c in reg_codes):
                code = f"GY-{secrets.token_hex(4).upper()}"

            new_code = {
                "code": code,
                "quota_limit": quota_limit,
                "max_uses": max_uses,
                "used_count": 0,
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "note": note.strip(),
                "status": "active",
            }
            reg_codes.append(new_code)
            self._save_reg_codes(reg_codes)
            return new_code

    def delete_reg_code(self, code: str) -> bool:
        code = code.strip()
        with self._lock:
            reg_codes = self._load_reg_codes()
            before = len(reg_codes)
            reg_codes = [c for c in reg_codes if c["code"] != code]
            if len(reg_codes) == before:
                return False
            self._save_reg_codes(reg_codes)
            return True


user_service = UserService()

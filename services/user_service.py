from __future__ import annotations

import hashlib
import os
import secrets
import threading
import uuid
from datetime import datetime
from typing import Any

from services.config import config


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


def validate_password(password: str) -> None:
    """密码要求：6-50位，至少包含字母和数字，不能是常见弱密码"""
    if len(password) < 6:
        raise ValueError("密码长度至少为 6 个字符")
    if len(password) > 50:
        raise ValueError("密码长度不能超过 50 个字符")
    has_letter = any(c.isalpha() for c in password)
    has_digit = any(c.isdigit() for c in password)
    if not (has_letter and has_digit):
        raise ValueError("密码必须同时包含字母和数字")
    weak = {"123456", "password", "abc123", "qwerty", "111111", "12345678", "a123456"}
    if password.lower() in weak:
        raise ValueError("密码过于简单，请换一个更复杂的密码")


def _api_key_hash(password: str) -> str:
    """SHA-256 快速哈希，用于 API 密钥认证"""
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


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

    def register_user(self, username: str, password: str, reg_code: str) -> dict[str, Any]:
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
                "role": "user",
                "quota_limit": int(code_item.get("quota_limit", 10)),
                "quota_used": 0,
                "last_active_date": datetime.now().strftime("%Y-%m-%d"),
                "status": "active",
                "api_key_hash": _api_key_hash(password),
                "registered_by_code": reg_code,
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
            users.append(new_user)
            self._save_users(users)

            return {
                "id": new_user["id"],
                "username": new_user["username"],
                "role": new_user["role"],
                "quota_limit": new_user["quota_limit"],
                "quota_used": new_user["quota_used"],
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

            if not user.get("api_key_hash"):
                user["api_key_hash"] = _api_key_hash(password)
            user["last_login_at"] = datetime.now().isoformat()
            user["last_active_date"] = user["last_login_at"][:10]
            user.pop("auth_key_id", None)
            user.pop("api_key", None)
            self._save_users(users)

            quota_limit = int(user.get("quota_limit", 10))
            quota_used = int(user.get("quota_used", 0))
            return {
                "id": user["id"],
                "username": user["username"],
                "role": user["role"],
                "status": user.get("status") or "active",
                "quota_limit": quota_limit,
                "quota_used": quota_used,
                "quota_remaining": max(quota_limit - quota_used, 0),
                "last_login_at": user.get("last_login_at") or "",
            }

    def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        """通过用户 id 查找"""
        with self._lock:
            users = self._load_users()
            return next((u for u in users if u.get("id") == user_id), None)

    def get_user_by_api_key_hash(self, key_hash: str) -> dict[str, Any] | None:
        with self._lock:
            users = self._load_users()
            return next((u for u in users if u.get("api_key_hash") == key_hash), None)

    def normalize_user_credentials(self, user_id: str) -> bool:
        """把旧用户收口到统一密码密钥模式：补 api_key_hash，清掉 auth_key_id/api_key。"""
        with self._lock:
            users = self._load_users()
            user = next((u for u in users if u.get("id") == user_id), None)
            if not user:
                return False
            password_hash = str(user.get("password_hash") or "")
            if not password_hash:
                return False
            if "api_key_hash" not in user or not str(user.get("api_key_hash") or "").strip():
                # 这里无法反推明文密码，只有新注册/重置过密码的用户才会有 api_key_hash
                return False
            user.pop("auth_key_id", None)
            user.pop("api_key", None)
            self._save_users(users)
            return True

    def verify_quota_and_deduct(self, user_id: str) -> None:
        """根据用户身份校验配额并划扣一次额度"""
        with self._lock:
            users = self._load_users()
            user = next((u for u in users if u.get("id") == user_id), None)
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

            quota_limit_raw = user.get("quota_limit", 10)
            if quota_limit_raw in {0, "0", "unlimited", "无限", "不限", "无限制"}:
                self._save_users(users)
                return

            try:
                limit = int(quota_limit_raw)
            except (TypeError, ValueError):
                limit = 10
            used = int(user.get("quota_used", 0))

            if used >= limit:
                raise PermissionError(f"今日生图限额 ({limit} 次) 已用完，请明天再试")

            user["quota_used"] = used + 1
            self._save_users(users)


    # ================= 管理员用户管控 =================

    def list_users(self, q: str = "", status: str = "", role: str = "") -> list[dict[str, Any]]:
        q = q.strip().lower()
        status = status.strip().lower()
        role = role.strip().lower()
        with self._lock:
            users = self._load_users()
            sensitive = {"password_hash", "api_key", "api_key_hash", "auth_key_id"}
            result = []
            for u in users:
                username = str(u.get("username") or "")
                u_status = str(u.get("status") or "active")
                u_role = str(u.get("role") or "user")
                if q and q not in username.lower() and q not in str(u.get("id") or "").lower():
                    continue
                if status and status != u_status.lower():
                    continue
                if role and role != u_role.lower():
                    continue
                quota_limit = int(u.get("quota_limit", 10))
                quota_used = int(u.get("quota_used", 0))
                copied = {k: v for k, v in u.items() if k not in sensitive}
                copied["display_name"] = username
                copied["status"] = u_status
                copied["quota_limit"] = quota_limit
                copied["quota_used"] = quota_used
                copied["quota_remaining"] = max(quota_limit - quota_used, 0)
                copied["quota_usage_rate"] = round(quota_used / quota_limit, 4) if quota_limit > 0 else 0
                copied["last_login_at"] = u.get("last_login_at") or ""
                copied["last_active_date"] = u.get("last_active_date") or ""
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
            return True

    def unban_user(self, user_id: str) -> bool:
        with self._lock:
            users = self._load_users()
            user = next((u for u in users if u["id"] == user_id), None)
            if not user:
                return False
            user["status"] = "active"
            self._save_users(users)
            return True

    def update_user_quota(self, user_id: str, quota_limit: int) -> bool:
        if quota_limit < 0:
            raise ValueError("配额限额不能小于 0，0 表示不限额度")
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

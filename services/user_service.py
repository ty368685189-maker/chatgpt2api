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
    """登录密钥要求：8-50位，至少包含字母和数字，不能是常见弱密钥"""
    if len(password) < 8:
        raise ValueError("登录密钥长度至少为 8 个字符")
    if len(password) > 50:
        raise ValueError("登录密钥长度不能超过 50 个字符")
    has_letter = any(c.isalpha() for c in password)
    has_digit = any(c.isdigit() for c in password)
    if not (has_letter and has_digit):
        raise ValueError("登录密钥必须同时包含字母和数字")
    weak = {"123456", "password", "abc123", "qwerty", "111111", "12345678", "a123456"}
    if password.lower() in weak:
        raise ValueError("登录密钥过于简单，请换一个更复杂的密钥")


def _api_key_hash(password: str) -> str:
    """SHA-256 快速哈希，用于 API 密钥认证"""
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _coerce_non_negative_int(value: Any, default: int = 0) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return default


def _normalize_quota_mode(value: Any) -> str:
    mode = str(value or "").strip().lower()
    return mode if mode in {"daily", "fixed", "hybrid"} else "daily"


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

    def _apply_quota_schema(self, user: dict[str, Any]) -> None:
        """把新旧配额字段统一成一套内部结构。"""
        mode = _normalize_quota_mode(user.get("quota_mode"))
        legacy_daily_limit = _coerce_non_negative_int(user.get("quota_limit", 10), 10)
        legacy_daily_used = _coerce_non_negative_int(user.get("quota_used", 0), 0)
        daily_limit = _coerce_non_negative_int(user.get("daily_quota_limit"), legacy_daily_limit)
        daily_used = _coerce_non_negative_int(user.get("daily_quota_used"), legacy_daily_used)
        fixed_limit = _coerce_non_negative_int(user.get("fixed_quota_limit"), 0)
        fixed_used = _coerce_non_negative_int(user.get("fixed_quota_used"), 0)

        has_new_daily_fields = "daily_quota_limit" in user or "daily_quota_used" in user
        has_new_fixed_fields = "fixed_quota_limit" in user or "fixed_quota_used" in user
        has_legacy_quota_limit = "quota_limit" in user and not (has_new_daily_fields or has_new_fixed_fields)
        has_legacy_quota_used = "quota_used" in user and not (has_new_daily_fields or has_new_fixed_fields)

        if has_legacy_quota_limit:
            if legacy_daily_limit == 0:
                if mode == "fixed":
                    fixed_limit = 0
                else:
                    daily_limit = 0
            elif mode == "fixed":
                fixed_limit = legacy_daily_limit
            else:
                daily_limit = legacy_daily_limit

        if has_legacy_quota_used:
            if mode == "fixed":
                fixed_used = legacy_daily_used
            else:
                daily_used = legacy_daily_used

        if mode == "fixed":
            if "fixed_quota_limit" not in user and legacy_daily_limit > 0:
                fixed_limit = legacy_daily_limit
            if "fixed_quota_used" not in user and legacy_daily_used > 0:
                fixed_used = legacy_daily_used
            daily_limit = _coerce_non_negative_int(user.get("daily_quota_limit"), 0)
            daily_used = _coerce_non_negative_int(user.get("daily_quota_used"), 0)
        elif mode == "hybrid":
            if "fixed_quota_limit" not in user:
                fixed_limit = 0 if not has_legacy_quota_limit else fixed_limit
            if "fixed_quota_used" not in user:
                fixed_used = 0 if not has_legacy_quota_used else fixed_used

        user["quota_mode"] = mode
        user["daily_quota_limit"] = daily_limit
        user["daily_quota_used"] = daily_used
        user["fixed_quota_limit"] = fixed_limit
        user["fixed_quota_used"] = fixed_used
        if "daily_last_reset_date" not in user or not str(user.get("daily_last_reset_date") or "").strip():
            user["daily_last_reset_date"] = str(user.get("last_active_date") or datetime.now().strftime("%Y-%m-%d"))

    def _quota_snapshot(self, user: dict[str, Any]) -> dict[str, Any]:
        self._apply_quota_schema(user)
        mode = str(user.get("quota_mode") or "daily")
        daily_limit = _coerce_non_negative_int(user.get("daily_quota_limit"), 0)
        daily_used = _coerce_non_negative_int(user.get("daily_quota_used"), 0)
        fixed_limit = _coerce_non_negative_int(user.get("fixed_quota_limit"), 0)
        fixed_used = _coerce_non_negative_int(user.get("fixed_quota_used"), 0)
        daily_remaining = None if daily_limit == 0 else max(daily_limit - daily_used, 0)
        fixed_remaining = None if fixed_limit == 0 else max(fixed_limit - fixed_used, 0)

        if mode == "fixed":
            active_label = "固定额度"
            active_limit = fixed_limit
            active_used = fixed_used
            active_remaining = fixed_remaining
        else:
            active_label = "每日额度"
            active_limit = daily_limit
            active_used = daily_used
            active_remaining = daily_remaining

        if mode == "hybrid":
            daily_text = "不限" if daily_limit == 0 else f"{daily_used}/{daily_limit}"
            fixed_text = "不限" if fixed_limit == 0 else f"{fixed_used}/{fixed_limit}"
            quota_summary = f"每日优先 {daily_text} · 固定兜底 {fixed_text}"
            if daily_limit > 0 and fixed_limit > 0:
                active_limit = daily_limit + fixed_limit
                active_used = daily_used + fixed_used
                if daily_remaining is None or fixed_remaining is None:
                    active_remaining = None
                else:
                    active_remaining = daily_remaining + fixed_remaining
            elif daily_limit > 0:
                active_limit = daily_limit
                active_used = daily_used
                active_remaining = daily_remaining
            elif fixed_limit > 0:
                active_limit = fixed_limit
                active_used = fixed_used
                active_remaining = fixed_remaining
            else:
                active_limit = 0
                active_used = 0
                active_remaining = None
        else:
            quota_summary = f"{active_label} {('不限' if active_limit == 0 else f'{active_used}/{active_limit}')}"

        return {
            "quota_mode": mode,
            "daily_quota_limit": daily_limit,
            "daily_quota_used": daily_used,
            "daily_quota_remaining": daily_remaining,
            "fixed_quota_limit": fixed_limit,
            "fixed_quota_used": fixed_used,
            "fixed_quota_remaining": fixed_remaining,
            "quota_limit": active_limit,
            "quota_used": active_used,
            "quota_remaining": active_remaining if active_remaining is not None else 0,
            "quota_usage_rate": round(active_used / active_limit, 4) if active_limit > 0 else 0,
            "quota_summary": quota_summary,
        }

    def _ensure_api_key_hash_available(
        self,
        users: list[dict[str, Any]],
        key_hash: str,
        current_user_id: str | None = None,
    ) -> None:
        """统一登录密钥也会作为 API Key 使用，所以必须保证全站唯一。"""
        for user in users:
            if current_user_id and user.get("id") == current_user_id:
                continue
            if user.get("api_key_hash") == key_hash:
                raise ValueError("登录密钥已被其他用户使用，请换一个")

    def register_user(
        self,
        username: str,
        password: str,
        reg_code: str,
        email: str | None = None,
    ) -> dict[str, Any]:
        username = username.strip()
        reg_code = reg_code.strip()
        if not username or not password or not reg_code:
            raise ValueError("用户名、登录密钥和激活码不能为空")
        validate_password(password)

        with self._lock:
            users = self._load_users()
            # 校验用户名是否已存在（不区分大小写）
            if any(u["username"].lower() == username.lower() for u in users):
                raise ValueError("用户名已存在，请换一个名称")
            next_api_key_hash = _api_key_hash(password)
            self._ensure_api_key_hash_available(users, next_api_key_hash)

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
                "email": (email or "").strip() or None,
                "password_hash": hash_password(password),
                "role": "user",
                "quota_mode": "daily",
                "daily_quota_limit": int(code_item.get("quota_limit", 10)),
                "daily_quota_used": 0,
                "fixed_quota_limit": 0,
                "fixed_quota_used": 0,
                "last_active_date": datetime.now().strftime("%Y-%m-%d"),
                "daily_last_reset_date": datetime.now().strftime("%Y-%m-%d"),
                "status": "active",
                "api_key_hash": next_api_key_hash,
                "registered_by_code": reg_code,
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
            users.append(new_user)
            self._save_users(users)

            quota = self._quota_snapshot(new_user)
            return {
                "id": new_user["id"],
                "username": new_user["username"],
                "role": new_user["role"],
                **quota,
            }

    def login_user(self, username: str, password: str) -> dict[str, Any]:
        username = username.strip()
        if not username or not password:
            raise ValueError("用户名和登录密钥不能为空")

        with self._lock:
            users = self._load_users()
            user = next((u for u in users if u["username"].lower() == username.lower()), None)
            if not user or not verify_password(password, user["password_hash"]):
                raise ValueError("用户名或登录密钥错误")

            if user.get("status") == "banned":
                raise ValueError("账户已被禁用，请联系管理员")

            if not user.get("api_key_hash"):
                next_api_key_hash = _api_key_hash(password)
                self._ensure_api_key_hash_available(users, next_api_key_hash, current_user_id=str(user.get("id")))
                user["api_key_hash"] = next_api_key_hash
            user["last_login_at"] = datetime.now().isoformat()
            user["last_active_date"] = user["last_login_at"][:10]
            user.pop("auth_key_id", None)
            user.pop("api_key", None)
            self._apply_quota_schema(user)
            self._save_users(users)

            quota = self._quota_snapshot(user)
            return {
                "id": user["id"],
                "username": user["username"],
                "role": user["role"],
                "status": user.get("status") or "active",
                **quota,
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
            matched = [u for u in users if u.get("api_key_hash") == key_hash]
            if len(matched) != 1:
                return None
            self._apply_quota_schema(matched[0])
            self._save_users(users)
            return matched[0]

    def normalize_user_credentials(self, user_id: str) -> bool:
        """把旧用户收口到统一登录密钥模式：补 api_key_hash，清掉 auth_key_id/api_key。"""
        with self._lock:
            users = self._load_users()
            user = next((u for u in users if u.get("id") == user_id), None)
            if not user:
                return False
            self._apply_quota_schema(user)
            password_hash = str(user.get("password_hash") or "")
            if not password_hash:
                return False
            if "api_key_hash" not in user or not str(user.get("api_key_hash") or "").strip():
                # 这里无法反推明文登录密钥，只有新注册/重置过登录密钥的用户才会有 api_key_hash
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
            self._apply_quota_schema(user)
            if user.get("quota_mode") in {"daily", "hybrid"} and user.get("daily_last_reset_date") != today:
                user["daily_quota_used"] = 0
                user["daily_last_reset_date"] = today
                user["last_active_date"] = today

            daily_limit = _coerce_non_negative_int(user.get("daily_quota_limit"), 0)
            daily_used = _coerce_non_negative_int(user.get("daily_quota_used"), 0)
            fixed_limit = _coerce_non_negative_int(user.get("fixed_quota_limit"), 0)
            fixed_used = _coerce_non_negative_int(user.get("fixed_quota_used"), 0)
            mode = str(user.get("quota_mode") or "daily")

            if mode == "daily":
                if daily_limit > 0 and daily_used >= daily_limit:
                    raise PermissionError(f"今日生图限额 ({daily_limit} 次) 已用完，请明天再试")
                if daily_limit > 0:
                    user["daily_quota_used"] = daily_used + 1
                user["quota_limit"] = daily_limit
                user["quota_used"] = _coerce_non_negative_int(user.get("daily_quota_used"), 0)
            elif mode == "fixed":
                if fixed_limit > 0 and fixed_used >= fixed_limit:
                    raise PermissionError(f"累计生图限额 ({fixed_limit} 次) 已用完，请联系管理员")
                if fixed_limit > 0:
                    user["fixed_quota_used"] = fixed_used + 1
                user["quota_limit"] = fixed_limit
                user["quota_used"] = _coerce_non_negative_int(user.get("fixed_quota_used"), 0)
            elif mode == "hybrid":
                if daily_limit > 0 and daily_used < daily_limit:
                    user["daily_quota_used"] = daily_used + 1
                elif fixed_limit > 0:
                    if fixed_used >= fixed_limit:
                        raise PermissionError(f"累计生图限额 ({fixed_limit} 次) 已用完，请联系管理员")
                    user["fixed_quota_used"] = fixed_used + 1
                else:
                    # 两边都没设置上限时，视为无限额度，不做扣减
                    pass
                if daily_limit > 0 and fixed_limit > 0:
                    user["quota_limit"] = daily_limit + fixed_limit
                    user["quota_used"] = _coerce_non_negative_int(user.get("daily_quota_used"), 0) + _coerce_non_negative_int(user.get("fixed_quota_used"), 0)
                elif daily_limit > 0:
                    user["quota_limit"] = daily_limit
                    user["quota_used"] = _coerce_non_negative_int(user.get("daily_quota_used"), 0)
                elif fixed_limit > 0:
                    user["quota_limit"] = fixed_limit
                    user["quota_used"] = _coerce_non_negative_int(user.get("fixed_quota_used"), 0)
                else:
                    user["quota_limit"] = 0
                    user["quota_used"] = 0
            self._save_users(users)



    def refund_quota(self, user_id: str) -> None:
        """退还用户的生图额度"""
        with self._lock:
            users = self._load_users()
            user = next((u for u in users if u.get("id") == user_id), None)
            if not user:
                return

            mode = str(user.get("quota_mode") or "daily")
            daily_used = _coerce_non_negative_int(user.get("daily_quota_used"), 0)
            fixed_used = _coerce_non_negative_int(user.get("fixed_quota_used"), 0)

            if mode == "daily":
                if daily_used > 0:
                    user["daily_quota_used"] = daily_used - 1
            elif mode == "fixed":
                if fixed_used > 0:
                    user["fixed_quota_used"] = fixed_used - 1
            elif mode == "hybrid":
                if fixed_used > 0:
                    user["fixed_quota_used"] = fixed_used - 1
                elif daily_used > 0:
                    user["daily_quota_used"] = daily_used - 1
            
            daily_limit = _coerce_non_negative_int(user.get("daily_quota_limit"), 0)
            fixed_limit = _coerce_non_negative_int(user.get("fixed_quota_limit"), 0)
            if mode == "daily":
                user["quota_used"] = _coerce_non_negative_int(user.get("daily_quota_used"), 0)
            elif mode == "fixed":
                user["quota_used"] = _coerce_non_negative_int(user.get("fixed_quota_used"), 0)
            elif mode == "hybrid":
                if daily_limit > 0 and fixed_limit > 0:
                    user["quota_used"] = _coerce_non_negative_int(user.get("daily_quota_used"), 0) + _coerce_non_negative_int(user.get("fixed_quota_used"), 0)
                elif daily_limit > 0:
                    user["quota_used"] = _coerce_non_negative_int(user.get("daily_quota_used"), 0)
                elif fixed_limit > 0:
                    user["quota_used"] = _coerce_non_negative_int(user.get("fixed_quota_used"), 0)
                else:
                    user["quota_used"] = 0

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
                self._apply_quota_schema(u)
                username = str(u.get("username") or "")
                u_status = str(u.get("status") or "active")
                u_role = str(u.get("role") or "user")
                if q and q not in username.lower() and q not in str(u.get("id") or "").lower():
                    continue
                if status and status != u_status.lower():
                    continue
                if role and role != u_role.lower():
                    continue
                copied = {k: v for k, v in u.items() if k not in sensitive}
                copied["display_name"] = username
                copied["status"] = u_status
                copied.update(self._quota_snapshot(u))
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
            self._apply_quota_schema(user)
            mode = str(user.get("quota_mode") or "daily")
            if mode == "fixed":
                user["fixed_quota_limit"] = quota_limit
            elif mode == "hybrid":
                user["daily_quota_limit"] = quota_limit
            else:
                user["daily_quota_limit"] = quota_limit
                user["quota_limit"] = quota_limit
            self._save_users(users)
            return True

    def update_user_quota_policy(
        self,
        user_id: str,
        quota_mode: str,
        daily_quota_limit: int,
        fixed_quota_limit: int,
    ) -> bool:
        if daily_quota_limit < 0 or fixed_quota_limit < 0:
            raise ValueError("配额限额不能小于 0，0 表示不限额度")
        mode = _normalize_quota_mode(quota_mode)
        with self._lock:
            users = self._load_users()
            user = next((u for u in users if u["id"] == user_id), None)
            if not user:
                return False
            self._apply_quota_schema(user)
            user["quota_mode"] = mode
            user["daily_quota_limit"] = int(daily_quota_limit)
            user["fixed_quota_limit"] = int(fixed_quota_limit)
            if mode == "daily":
                user["quota_limit"] = int(daily_quota_limit)
                user["quota_used"] = _coerce_non_negative_int(user.get("daily_quota_used"), 0)
            elif mode == "fixed":
                user["quota_limit"] = int(fixed_quota_limit)
                user["quota_used"] = _coerce_non_negative_int(user.get("fixed_quota_used"), 0)
            else:
                if daily_quota_limit > 0 and fixed_quota_limit > 0:
                    user["quota_limit"] = int(daily_quota_limit + fixed_quota_limit)
                    user["quota_used"] = _coerce_non_negative_int(user.get("daily_quota_used"), 0) + _coerce_non_negative_int(user.get("fixed_quota_used"), 0)
                elif daily_quota_limit > 0:
                    user["quota_limit"] = int(daily_quota_limit)
                    user["quota_used"] = _coerce_non_negative_int(user.get("daily_quota_used"), 0)
                elif fixed_quota_limit > 0:
                    user["quota_limit"] = int(fixed_quota_limit)
                    user["quota_used"] = _coerce_non_negative_int(user.get("fixed_quota_used"), 0)
                else:
                    user["quota_limit"] = 0
                    user["quota_used"] = 0
            self._save_users(users)
            return True

    def reset_user_password(self, user_id: str, new_password: str) -> bool:
        if not new_password:
            raise ValueError("新登录密钥不能为空")
        validate_password(new_password)
        with self._lock:
            users = self._load_users()
            user = next((u for u in users if u["id"] == user_id), None)
            if not user:
                return False
            self._apply_quota_schema(user)
            next_api_key_hash = _api_key_hash(new_password)
            self._ensure_api_key_hash_available(users, next_api_key_hash, current_user_id=user_id)
            user["password_hash"] = hash_password(new_password)
            user["api_key_hash"] = next_api_key_hash
            user["last_login_at"] = datetime.now().isoformat()
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

    def delete_user(self, user_id: str) -> bool:
        with self._lock:
            users = self._load_users()
            before = len(users)
            users = [u for u in users if u.get("id") != user_id]
            if len(users) == before:
                return False
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

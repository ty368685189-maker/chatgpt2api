from __future__ import annotations

import threading
import time
import uuid
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from api.support import require_admin, require_identity
from services.user_service import user_service
from services.user_service import validate_password as _validate_pwd
from services.works_service import works_service
from utils.captcha import generate_captcha

# 图形验证码缓存 (ID -> (验证码字符, 过期时间戳))
captcha_cache: dict[str, tuple[str, float]] = {}
captcha_lock = threading.Lock()


def add_captcha(captcha_id: str, code: str) -> None:
    now = time.time()
    with captcha_lock:
        # 清理已过期的验证码
        expired = [k for k, v in captcha_cache.items() if v[1] < now]
        for k in expired:
            captcha_cache.pop(k, None)
        # 写入新验证码，有效期 5 分钟
        captcha_cache[captcha_id] = (code, now + 300)


def verify_and_remove_captcha(captcha_id: str, code: str) -> bool:
    now = time.time()
    with captcha_lock:
        val = captcha_cache.pop(captcha_id, None)
        if val is None:
            return False
        stored_code, expire_time = val
        if expire_time < now:
            return False
        return stored_code.lower() == code.strip().lower()


class IPRateLimiter:
    def __init__(self, limit: int, window_seconds: float):
        self.limit = limit
        self.window_seconds = window_seconds
        self.requests: dict[str, list[float]] = {}
        self.lock = threading.Lock()
        self.last_cleanup_time = time.time()

    def is_allowed(self, ip: str) -> bool:
        now = time.time()
        with self.lock:
            # Periodically clean up all completely expired entries from memory (every 5 minutes)
            if now - self.last_cleanup_time > 300.0:
                self.last_cleanup_time = now
                for k in list(self.requests.keys()):
                    times = self.requests[k]
                    valid_times = [t for t in times if now - t < self.window_seconds]
                    if not valid_times:
                        del self.requests[k]
                    else:
                        self.requests[k] = valid_times

            # Clean up expired entries for this IP
            times = self.requests.get(ip, [])
            times = [t for t in times if now - t < self.window_seconds]
            if len(times) >= self.limit:
                self.requests[ip] = times
                return False
            times.append(now)
            self.requests[ip] = times
            return True



# Limit registers to 5 per minute, logins to 15 per minute per IP
register_limiter = IPRateLimiter(limit=5, window_seconds=60.0)
login_limiter = IPRateLimiter(limit=15, window_seconds=60.0)


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    password: str = Field(...)
    reg_code: str = Field(...)
    email: str | None = None


class LoginRequest(BaseModel):
    username: str = Field(...)
    password: str = Field(...)


class ShareWorkRequest(BaseModel):
    is_public: bool = Field(...)


class UpdateQuotaRequest(BaseModel):
    quota_limit: int = Field(..., ge=0)


class UpdateQuotaPolicyRequest(BaseModel):
    quota_mode: str = Field(..., min_length=1, max_length=16)
    daily_quota_limit: int = Field(..., ge=0)
    fixed_quota_limit: int = Field(..., ge=0)


class ResetPasswordRequest(BaseModel):
    password: str = Field(...)


class ChangeRoleRequest(BaseModel):
    role: str = Field(...)


class GenerateRegCodeRequest(BaseModel):
    quota_limit: int = Field(..., ge=0)
    max_uses: int = Field(...)
    note: str = ""


def get_client_ip(request: Request) -> str:
    x_forwarded_for = request.headers.get("x-forwarded-for")
    if x_forwarded_for:
        return x_forwarded_for.split(",")[0].strip()
    x_real_ip = request.headers.get("x-real-ip")
    if x_real_ip:
        return x_real_ip.strip()
    return request.client.host if request.client else "unknown"


def create_router() -> APIRouter:
    router = APIRouter()

    # ================= 登录与注册鉴权 =================

    @router.get("/api/auth/captcha")
    async def get_auth_captcha():
        """获取注册图形验证码"""
        code, img_data = generate_captcha()
        captcha_id = str(uuid.uuid4())
        add_captcha(captcha_id, code)
        return {"id": captcha_id, "image": img_data}

    @router.post("/api/auth/register")
    async def register(body: RegisterRequest, request: Request):
        """自助注册接口"""
        client_ip = get_client_ip(request)
        if not register_limiter.is_allowed(client_ip):
            raise HTTPException(status_code=429, detail={"error": "注册请求过于频繁，请稍后再试"})
        try:
            _validate_pwd(body.password)
            user = user_service.register_user(
                username=body.username,
                password=body.password,
                reg_code=body.reg_code,
                email=body.email,
            )
            return {"status": "ok", "user": user}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/auth/login")
    async def login(body: LoginRequest, request: Request):
        """登录接口：用户输入的登录密钥同时也是 API Key"""
        client_ip = get_client_ip(request)
        if not login_limiter.is_allowed(client_ip):
            raise HTTPException(status_code=429, detail={"error": "登录请求过于频繁，请稍后再试"})
        try:
            user = user_service.login_user(username=body.username, password=body.password)
            return {"status": "ok", "user": user}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.get("/api/auth/profile")
    async def get_profile(authorization: str | None = Header(default=None)):
        """获取当前登录用户的个人信息及配额"""
        identity = require_identity(authorization)
        user = user_service.get_user_by_id(identity["id"])
        if user is None:
            display_name = identity.get("name", "Administrator")
            return {
                "id": identity["id"],
                "username": display_name,
                "display_name": display_name,
                "role": identity.get("role", "admin"),
                "is_legacy": True,
                "quota_mode": "daily",
                "daily_quota_limit": 0,
                "daily_quota_used": 0,
                "daily_quota_remaining": 0,
                "fixed_quota_limit": 0,
                "fixed_quota_used": 0,
                "fixed_quota_remaining": 0,
                "quota_limit": 0,
                "quota_used": 0,
                "quota_remaining": 0,
                "quota_usage_rate": 0,
                "quota_summary": "管理员密钥不计个人额度",
                "status": "legacy",
                "created_at": "",
                "last_login_at": "",
                "last_active_date": "",
            }
        quota = user_service._quota_snapshot(user)
        return {
            "id": user["id"],
            "username": user["username"],
            "display_name": user["username"],
            "role": user["role"],
            "status": user.get("status") or "active",
            "email": user.get("email") or "",
            "is_legacy": False,
            **quota,
            "created_at": user.get("created_at") or "",
            "last_login_at": user.get("last_login_at") or "",
            "last_active_date": user.get("last_active_date") or "",
        }

    # ================= 「我的作品」云端持久化模块 =================

    @router.get("/api/user/works")
    async def list_user_works(
        limit: int = Query(default=20, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
        authorization: str | None = Header(default=None)
    ):
        """获取当前用户的所有生图作品历史"""
        identity = require_identity(authorization)
        user = user_service.get_user_by_id(identity["id"])
        user_id = user["id"] if user else "admin"  # 管理员也支持云端存储
        items, total = works_service.list_user_works(user_id, limit=limit, offset=offset)
        return {
            "items": items,
            "total": total,
            "has_more": offset + len(items) < total
        }

    @router.delete("/api/user/works/{work_id}")
    async def delete_user_work(work_id: str, authorization: str | None = Header(default=None)):
        """删除用户的一件作品"""
        identity = require_identity(authorization)
        user = user_service.get_user_by_id(identity["id"])
        user_id = user["id"] if user else "admin"
        success = works_service.delete_user_work(user_id, work_id)
        if not success:
            raise HTTPException(status_code=404, detail={"error": "作品未找到或无权删除"})
        return {"status": "ok"}

    @router.post("/api/user/works/{work_id}/share")
    async def share_user_work(
        work_id: str,
        body: ShareWorkRequest,
        authorization: str | None = Header(default=None),
    ):
        """发布作品到社区画廊，或从画廊撤销发布"""
        identity = require_identity(authorization)
        user = user_service.get_user_by_id(identity["id"])
        user_id = user["id"] if user else "admin"
        success = works_service.toggle_public_work(user_id, work_id, body.is_public)
        if not success:
            raise HTTPException(status_code=404, detail={"error": "作品未找到或无权发布"})
        return {"status": "ok"}

    # ================= 社区共享画廊模块 =================

    @router.get("/api/gallery")
    async def list_gallery(
        q: str = Query(default=""),
        limit: int = Query(default=20, ge=1, le=100),
        offset: int = Query(default=0, ge=0)
    ):
        """公开的画廊列表（支持模糊匹配 prompt 搜索）"""
        items, total = works_service.list_public_gallery(q, limit=limit, offset=offset)
        return {
            "items": items,
            "total": total,
            "has_more": offset + len(items) < total
        }

    @router.post("/api/gallery/{work_id}/like")
    async def like_gallery_work(work_id: str):
        """为共享画廊的作品点赞"""
        likes = works_service.like_work(work_id)
        return {"status": "ok", "likes": likes}

    # ================= 管理员：用户列表与权限管控 =================

    @router.get("/api/admin/users")
    async def admin_list_users(
        authorization: str | None = Header(default=None),
        q: str = Query(default=""),
        status: str = Query(default=""),
        role: str = Query(default=""),
    ):
        """管理员获取所有用户列表"""
        require_admin(authorization)
        return {"items": user_service.list_users(q=q, status=status, role=role)}

    @router.post("/api/admin/users/{user_id}/ban")
    async def admin_ban_user(user_id: str, authorization: str | None = Header(default=None)):
        """封禁用户"""
        require_admin(authorization)
        if not user_service.ban_user(user_id):
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        return {"status": "ok"}

    @router.post("/api/admin/users/{user_id}/unban")
    async def admin_unban_user(user_id: str, authorization: str | None = Header(default=None)):
        """解封用户"""
        require_admin(authorization)
        if not user_service.unban_user(user_id):
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        return {"status": "ok"}

    @router.post("/api/admin/users/{user_id}/quota")
    async def admin_update_quota(
        user_id: str,
        body: UpdateQuotaRequest,
        authorization: str | None = Header(default=None),
    ):
        """管理员更新特定用户的配额限制"""
        require_admin(authorization)
        try:
            if not user_service.update_user_quota(user_id, body.quota_limit):
                raise HTTPException(status_code=404, detail={"error": "用户不存在"})
            return {"status": "ok", "quota_limit": body.quota_limit}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/admin/users/{user_id}/password")
    async def admin_reset_password(
        user_id: str,
        body: ResetPasswordRequest,
        authorization: str | None = Header(default=None),
    ):
        """管理员强制重置用户登录密钥"""
        require_admin(authorization)
        try:
            _validate_pwd(body.password)
            if not user_service.reset_user_password(user_id, body.password):
                raise HTTPException(status_code=404, detail={"error": "用户不存在"})
            return {"status": "ok"}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/admin/users/{user_id}/role")
    async def admin_change_role(
        user_id: str,
        body: ChangeRoleRequest,
        authorization: str | None = Header(default=None),
    ):
        """修改用户角色（提权/降权）"""
        require_admin(authorization)
        try:
            if not user_service.change_user_role(user_id, body.role):
                raise HTTPException(status_code=404, detail={"error": "用户不存在"})
            return {"status": "ok"}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/admin/users/{user_id}/quota-policy")
    async def admin_update_quota_policy(
        user_id: str,
        body: UpdateQuotaPolicyRequest,
        authorization: str | None = Header(default=None),
    ):
        """管理员更新特定用户的配额策略"""
        require_admin(authorization)
        try:
            if not user_service.update_user_quota_policy(
                user_id,
                body.quota_mode,
                body.daily_quota_limit,
                body.fixed_quota_limit,
            ):
                raise HTTPException(status_code=404, detail={"error": "用户不存在"})
            return {"status": "ok"}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.delete("/api/admin/users/{user_id}")
    async def admin_delete_user(user_id: str, authorization: str | None = Header(default=None)):
        """删除自助注册用户"""
        require_admin(authorization)
        if not user_service.delete_user(user_id):
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        return {"status": "ok"}

    # ================= 管理员：注册码/邀请码分发管理 =================

    @router.get("/api/admin/reg-codes")
    async def admin_list_reg_codes(authorization: str | None = Header(default=None)):
        """获取所有激活码"""
        require_admin(authorization)
        return {"items": user_service.list_reg_codes()}

    @router.post("/api/admin/reg-codes")
    async def admin_create_reg_code(
        body: GenerateRegCodeRequest,
        authorization: str | None = Header(default=None),
    ):
        """生成一个新的注册邀请激活码"""
        require_admin(authorization)
        try:
            code_item = user_service.generate_reg_code(
                quota_limit=body.quota_limit,
                max_uses=body.max_uses,
                note=body.note,
            )
            return {"status": "ok", "item": code_item}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.delete("/api/admin/reg-codes/{code}")
    async def admin_delete_reg_code(code: str, authorization: str | None = Header(default=None)):
        """删除激活邀请码"""
        require_admin(authorization)
        if not user_service.delete_reg_code(code):
            raise HTTPException(status_code=404, detail={"error": "激活码未找到"})
        return {"status": "ok"}

    return router

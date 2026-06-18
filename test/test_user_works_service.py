from __future__ import annotations

import pytest
import uuid
from datetime import datetime, timedelta
from services.user_service import UserService, _api_key_hash
from services.works_service import WorksService
from services.storage.json_storage import JSONStorageBackend
from services.config import config


@pytest.fixture
def mock_user_service(tmp_path):
    storage = JSONStorageBackend(
        file_path=tmp_path / "accounts.json",
        auth_keys_path=tmp_path / "auth_keys.json"
    )
    user_service = UserService()
    user_service._storage = storage
    storage.users_path = tmp_path / "users.json"
    storage.reg_codes_path = tmp_path / "reg_codes.json"
    return user_service


@pytest.fixture
def mock_works_service(tmp_path):
    storage = JSONStorageBackend(
        file_path=tmp_path / "accounts.json",
        auth_keys_path=tmp_path / "auth_keys.json"
    )
    works_service = WorksService()
    works_service._storage = storage
    storage.works_path = tmp_path / "works.json"
    return works_service


def test_user_service_registration_and_login(mock_user_service):
    username1 = f"u1_{uuid.uuid4().hex[:6]}"
    username2 = f"u2_{uuid.uuid4().hex[:6]}"
    username3 = f"u3_{uuid.uuid4().hex[:6]}"

    code_info = mock_user_service.generate_reg_code(quota_limit=15, max_uses=2, note="Test Code")
    assert code_info["code"].startswith("GY-")
    assert code_info["quota_limit"] == 15
    assert code_info["max_uses"] == 2
    assert code_info["status"] == "active"

    user1 = mock_user_service.register_user(
        username=username1,
        password="password123",
        reg_code=code_info["code"]
    )
    assert user1["username"] == username1
    assert user1["quota_limit"] == 15
    assert "api_key" not in user1

    user2 = mock_user_service.register_user(
        username=username2,
        password="password456",
        reg_code=code_info["code"]
    )
    assert user2["username"] == username2

    with pytest.raises(ValueError, match="激活码使用次数已达上限|激活码已失效"):
        mock_user_service.register_user(
            username=username3,
            password="password789",
            reg_code=code_info["code"]
        )

    login_res = mock_user_service.login_user(username1, "password123")
    assert login_res["id"] == user1["id"]
    assert "api_key" not in login_res

    with pytest.raises(ValueError, match="用户名或登录密钥错误"):
        mock_user_service.login_user(username1, "wrong_password")


def test_user_quota_limits(mock_user_service):
    username = f"uq_{uuid.uuid4().hex[:6]}"
    code_info = mock_user_service.generate_reg_code(quota_limit=2, max_uses=1)
    user = mock_user_service.register_user(
        username=username,
        password="password123",
        reg_code=code_info["code"]
    )

    users = mock_user_service._load_users()
    db_user = next(u for u in users if u["id"] == user["id"])
    assert db_user["api_key_hash"]
    user_id = db_user["id"]

    mock_user_service.verify_quota_and_deduct(user_id)
    mock_user_service.verify_quota_and_deduct(user_id)

    with pytest.raises(PermissionError, match="今日生图限额"):
        mock_user_service.verify_quota_and_deduct(user_id)


def test_login_key_must_be_unique_for_api_identity(mock_user_service):
    code_info = mock_user_service.generate_reg_code(quota_limit=10, max_uses=3)
    user1 = mock_user_service.register_user(
        username=f"key_a_{uuid.uuid4().hex[:6]}",
        password="sameKey123",
        reg_code=code_info["code"],
    )

    with pytest.raises(ValueError, match="登录密钥已被其他用户使用"):
        mock_user_service.register_user(
            username=f"key_b_{uuid.uuid4().hex[:6]}",
            password="sameKey123",
            reg_code=code_info["code"],
        )

    api_user = mock_user_service.get_user_by_api_key_hash(_api_key_hash("sameKey123"))
    assert api_user is not None
    assert api_user["id"] == user1["id"]


def test_reset_login_key_cannot_reuse_another_users_key(mock_user_service):
    code_info = mock_user_service.generate_reg_code(quota_limit=10, max_uses=2)
    user1 = mock_user_service.register_user(
        username=f"reset_a_{uuid.uuid4().hex[:6]}",
        password="firstKey123",
        reg_code=code_info["code"],
    )
    user2 = mock_user_service.register_user(
        username=f"reset_b_{uuid.uuid4().hex[:6]}",
        password="secondKey123",
        reg_code=code_info["code"],
    )

    with pytest.raises(ValueError, match="登录密钥已被其他用户使用"):
        mock_user_service.reset_user_password(user2["id"], "firstKey123")

    assert mock_user_service.reset_user_password(user2["id"], "thirdKey123") is True
    assert mock_user_service.get_user_by_api_key_hash(_api_key_hash("firstKey123"))["id"] == user1["id"]
    assert mock_user_service.get_user_by_api_key_hash(_api_key_hash("thirdKey123"))["id"] == user2["id"]


def test_duplicate_api_key_hash_is_rejected_as_ambiguous_identity(mock_user_service):
    code_info = mock_user_service.generate_reg_code(quota_limit=10, max_uses=2)
    user1 = mock_user_service.register_user(
        username=f"dup_a_{uuid.uuid4().hex[:6]}",
        password="safeKey123",
        reg_code=code_info["code"],
    )
    user2 = mock_user_service.register_user(
        username=f"dup_b_{uuid.uuid4().hex[:6]}",
        password="otherKey123",
        reg_code=code_info["code"],
    )

    users = mock_user_service._load_users()
    duplicate_hash = _api_key_hash("safeKey123")
    for user in users:
        if user["id"] in {user1["id"], user2["id"]}:
            user["api_key_hash"] = duplicate_hash
    mock_user_service._save_users(users)

    assert mock_user_service.get_user_by_api_key_hash(duplicate_hash) is None


def test_unlimited_quota_skips_deduction(mock_user_service):
    username = f"uq_unlimited_{uuid.uuid4().hex[:6]}"
    code_info = mock_user_service.generate_reg_code(quota_limit=2, max_uses=1)
    user = mock_user_service.register_user(
        username=username,
        password="password123",
        reg_code=code_info["code"]
    )

    users = mock_user_service._load_users()
    db_user = next(u for u in users if u["id"] == user["id"])
    db_user["quota_mode"] = "fixed"
    db_user["fixed_quota_limit"] = 0
    db_user["fixed_quota_used"] = 9
    mock_user_service._save_users(users)

    mock_user_service.verify_quota_and_deduct(db_user["id"])

    updated_users = mock_user_service._load_users()
    updated_user = next(u for u in updated_users if u["id"] == db_user["id"])
    assert updated_user["fixed_quota_used"] == 9
    assert updated_user["fixed_quota_limit"] == 0


def test_daily_quota_resets_on_new_day(mock_user_service):
    code_info = mock_user_service.generate_reg_code(quota_limit=3, max_uses=1)
    user = mock_user_service.register_user(
        username=f"daily_{uuid.uuid4().hex[:6]}",
        password="dailyKey123",
        reg_code=code_info["code"],
    )

    users = mock_user_service._load_users()
    db_user = next(u for u in users if u["id"] == user["id"])
    db_user["quota_mode"] = "daily"
    db_user["daily_quota_limit"] = 2
    db_user["daily_quota_used"] = 1
    db_user["daily_last_reset_date"] = "2000-01-01"
    mock_user_service._save_users(users)

    mock_user_service.verify_quota_and_deduct(db_user["id"])

    updated_users = mock_user_service._load_users()
    updated_user = next(u for u in updated_users if u["id"] == db_user["id"])
    assert updated_user["daily_quota_used"] == 1
    assert updated_user["daily_quota_limit"] == 2


def test_fixed_quota_counts_total_usage(mock_user_service):
    code_info = mock_user_service.generate_reg_code(quota_limit=3, max_uses=1)
    user = mock_user_service.register_user(
        username=f"fixed_{uuid.uuid4().hex[:6]}",
        password="fixedKey123",
        reg_code=code_info["code"],
    )

    users = mock_user_service._load_users()
    db_user = next(u for u in users if u["id"] == user["id"])
    db_user["quota_mode"] = "fixed"
    db_user["fixed_quota_limit"] = 2
    db_user["fixed_quota_used"] = 1
    mock_user_service._save_users(users)

    mock_user_service.verify_quota_and_deduct(db_user["id"])

    updated_users = mock_user_service._load_users()
    updated_user = next(u for u in updated_users if u["id"] == db_user["id"])
    assert updated_user["fixed_quota_used"] == 2
    with pytest.raises(PermissionError, match="累计生图限额"):
        mock_user_service.verify_quota_and_deduct(db_user["id"])


def test_hybrid_quota_uses_daily_then_fixed(mock_user_service):
    code_info = mock_user_service.generate_reg_code(quota_limit=3, max_uses=1)
    user = mock_user_service.register_user(
        username=f"hybrid_{uuid.uuid4().hex[:6]}",
        password="hybridKey123",
        reg_code=code_info["code"],
    )

    users = mock_user_service._load_users()
    db_user = next(u for u in users if u["id"] == user["id"])
    db_user["quota_mode"] = "hybrid"
    db_user["daily_quota_limit"] = 2
    db_user["daily_quota_used"] = 1
    db_user["fixed_quota_limit"] = 2
    db_user["fixed_quota_used"] = 1
    db_user["daily_last_reset_date"] = "2026-06-18"
    mock_user_service._save_users(users)

    mock_user_service.verify_quota_and_deduct(db_user["id"])

    updated_users = mock_user_service._load_users()
    updated_user = next(u for u in updated_users if u["id"] == db_user["id"])
    assert updated_user["daily_quota_used"] == 2
    assert updated_user["fixed_quota_used"] == 1

    mock_user_service.verify_quota_and_deduct(db_user["id"])

    updated_users = mock_user_service._load_users()
    updated_user = next(u for u in updated_users if u["id"] == db_user["id"])
    assert updated_user["daily_quota_used"] == 2
    assert updated_user["fixed_quota_used"] == 2
    with pytest.raises(PermissionError, match="累计生图限额"):
        mock_user_service.verify_quota_and_deduct(db_user["id"])


def test_works_and_gallery(mock_works_service):
    work = mock_works_service.save_work(
        work_id="task_123",
        user_id="user_abc",
        prompt="A beautiful sunset",
        model="gpt-image-2",
        size="1024x1024",
        quality="standard",
        images=["/files/img1.png"]
    )
    assert work["id"] == "task_123"
    assert work["is_public"] is False

    user_works, total_works = mock_works_service.list_user_works("user_abc")
    assert len(user_works) == 1
    assert total_works == 1
    assert user_works[0]["prompt"] == "A beautiful sunset"

    success = mock_works_service.toggle_public_work("user_abc", "task_123", is_public=True)
    assert success is True

    gallery, total_gallery = mock_works_service.list_public_gallery(search_query="sunset")
    assert len(gallery) == 1
    assert total_gallery == 1
    assert gallery[0]["id"] == "task_123"

    likes = mock_works_service.like_work("task_123")
    assert likes == 1

    mock_works_service.delete_user_work("user_abc", "task_123")
    user_works_after, total_works_after = mock_works_service.list_user_works("user_abc")
    assert len(user_works_after) == 0
    assert total_works_after == 0

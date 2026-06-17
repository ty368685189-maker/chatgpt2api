from __future__ import annotations

import pytest
import uuid
from datetime import datetime, timedelta
from services.user_service import UserService
from services.works_service import WorksService
from services.storage.json_storage import JSONStorageBackend
from services.config import config


@pytest.fixture
def mock_user_service(tmp_path):
    # Setup temporary JSON storage
    storage = JSONStorageBackend(
        file_path=tmp_path / "accounts.json",
        auth_keys_path=tmp_path / "auth_keys.json"
      )
    user_service = UserService()
    user_service._storage = storage
    # Override users path in storage
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
    # Use random usernames to avoid colliding with actual auth keys database
    username1 = f"u1_{uuid.uuid4().hex[:6]}"
    username2 = f"u2_{uuid.uuid4().hex[:6]}"
    username3 = f"u3_{uuid.uuid4().hex[:6]}"

    # 1. Generate invitation code
    code_info = mock_user_service.generate_reg_code(quota_limit=15, max_uses=2, note="Test Code")
    assert code_info["code"].startswith("GY-")
    assert code_info["quota_limit"] == 15
    assert code_info["max_uses"] == 2
    assert code_info["status"] == "active"

    # 2. Register first user
    user1 = mock_user_service.register_user(
        username=username1,
        password="password123",
        email="user1@example.com",
        reg_code=code_info["code"]
    )
    assert user1["username"] == username1
    assert user1["quota_limit"] == 15
    assert user1["email"] == "user1@example.com"
    assert user1["api_key"].startswith("sk-")

    # 3. Register second user
    user2 = mock_user_service.register_user(
        username=username2,
        password="password456",
        email=None,
        reg_code=code_info["code"]
    )
    assert user2["username"] == username2

    # 4. Try registering third user (should fail as max_uses is 2)
    with pytest.raises(ValueError, match="激活码使用次数已达上限|激活码已失效"):
        mock_user_service.register_user(
            username=username3,
            password="password789",
            email=None,
            reg_code=code_info["code"]
        )

    # 5. Test login
    login_res = mock_user_service.login_user(username1, "password123")
    assert login_res["id"] == user1["id"]
    assert login_res["api_key"] == user1["api_key"]

    with pytest.raises(ValueError, match="用户名或密码错误"):
        mock_user_service.login_user(username1, "wrong_password")


def test_user_quota_limits(mock_user_service):
    username = f"uq_{uuid.uuid4().hex[:6]}"
    # Generate code with limit 2
    code_info = mock_user_service.generate_reg_code(quota_limit=2, max_uses=1)
    user = mock_user_service.register_user(
        username=username,
        password="password",
        email=None,
        reg_code=code_info["code"]
    )

    # Fetch full user details to get key_id
    users = mock_user_service._load_users()
    db_user = next(u for u in users if u["id"] == user["id"])
    key_id = db_user["auth_key_id"]

    # First deduction
    mock_user_service.verify_quota_and_deduct(key_id)
    # Second deduction
    mock_user_service.verify_quota_and_deduct(key_id)

    # Third deduction should fail
    with pytest.raises(PermissionError, match="今日生图限额"):
        mock_user_service.verify_quota_and_deduct(key_id)


def test_works_and_gallery(mock_works_service):
    # Save a work
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

    # List user works
    user_works, total_works = mock_works_service.list_user_works("user_abc")
    assert len(user_works) == 1
    assert total_works == 1
    assert user_works[0]["prompt"] == "A beautiful sunset"

    # Make it public
    success = mock_works_service.toggle_public_work("user_abc", "task_123", is_public=True)
    assert success is True

    # List gallery
    gallery, total_gallery = mock_works_service.list_public_gallery(search_query="sunset")
    assert len(gallery) == 1
    assert total_gallery == 1
    assert gallery[0]["id"] == "task_123"

    # Like work
    likes = mock_works_service.like_work("task_123")
    assert likes == 1
    
    # Delete work
    mock_works_service.delete_user_work("user_abc", "task_123")
    user_works_after, total_works_after = mock_works_service.list_user_works("user_abc")
    assert len(user_works_after) == 0
    assert total_works_after == 0

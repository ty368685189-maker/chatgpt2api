from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class StorageBackend(ABC):
    """抽象存储后端基类"""

    @abstractmethod
    def load_accounts(self) -> list[dict[str, Any]]:
        """加载所有账号数据"""
        pass

    @abstractmethod
    def save_accounts(self, accounts: list[dict[str, Any]]) -> None:
        """保存所有账号数据"""
        pass

    @abstractmethod
    def load_auth_keys(self) -> list[dict[str, Any]]:
        """加载所有鉴权密钥数据"""
        pass

    @abstractmethod
    def save_auth_keys(self, auth_keys: list[dict[str, Any]]) -> None:
        """保存所有鉴权密钥数据"""
        pass

    @abstractmethod
    def load_users(self) -> list[dict[str, Any]]:
        """加载所有用户数据"""
        pass

    @abstractmethod
    def save_users(self, users: list[dict[str, Any]]) -> None:
        """保存所有用户数据"""
        pass

    @abstractmethod
    def load_works(self) -> list[dict[str, Any]]:
        """加载所有作品数据"""
        pass

    @abstractmethod
    def save_works(self, works: list[dict[str, Any]]) -> None:
        """保存所有作品数据"""
        pass

    @abstractmethod
    def load_reg_codes(self) -> list[dict[str, Any]]:
        """加载所有注册码数据"""
        pass

    @abstractmethod
    def save_reg_codes(self, reg_codes: list[dict[str, Any]]) -> None:
        """保存所有注册码数据"""
        pass

    @abstractmethod
    def health_check(self) -> dict[str, Any]:
        """健康检查，返回存储后端状态"""
        pass

    @abstractmethod
    def get_backend_info(self) -> dict[str, Any]:
        """获取存储后端信息"""
        pass


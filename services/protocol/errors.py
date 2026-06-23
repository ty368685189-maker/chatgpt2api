from __future__ import annotations

import base64

import json

import re

import time

import threading

from concurrent.futures import ThreadPoolExecutor, as_completed

from dataclasses import dataclass, field

from typing import Any, Iterable, Iterator

import tiktoken

from services.account_service import account_service

from services.config import config

from services.image_storage_service import image_storage_service

from services.openai_backend_api import ImageContentPolicyError, ImagePollTimeoutError, OpenAIBackendAPI

from services.proxy_service import proxy_pool_manager

from utils.helper import IMAGE_MODELS, extract_image_from_message_content, is_codex_image_model, is_supported_image_model, split_image_model

from utils.image_tokens import count_image_content_tokens

from utils.log import logger

class ImageGenerationError(Exception):

    def __init__(self, message: str, status_code: int=502, error_type: str='server_error', code: str | None='upstream_error', param: str | None=None, account_email: str='', conversation_id: str='') -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_type = error_type
        self.code = code
        self.param = param
        self.account_email = account_email
        self.conversation_id = conversation_id

    def to_openai_error(self) -> dict[str, Any]:
        error_dict = {'error': {'message': public_image_error_message(str(self)), 'type': self.error_type, 'param': self.param, 'code': self.code}}
        if self.account_email:
            error_dict['error']['account_email'] = self.account_email
        return error_dict

def public_image_error_message(message: str) -> str:
    text = str(message or '').strip()
    lower = text.lower()
    if any((item in lower for item in ('backend-api/', 'status=', 'body=', 'chatgpt.com', 'upstreamhttperror'))):
        return 'The image generation request failed. Please try again later.'
    return text or 'The image generation request failed. Please try again later.'

class ImageTaskCancelledError(RuntimeError):
    pass

def is_token_invalid_error(message: str) -> bool:
    text = str(message or '').lower()
    return 'token_invalidated' in text or 'token_revoked' in text or 'authentication token has been invalidated' in text or ('invalidated oauth token' in text)

def is_tls_connection_error(message: str) -> bool:
    """检测 TLS/SSL 连接错误，这类错误通常可以通过重试解决。"""
    text = str(message or '').lower()
    return 'curl: (35)' in text or 'tls connect error' in text or 'openssl_internal' in text or ('ssl: wrong_version_number' in text) or ('ssl: certificate_verify_failed' in text) or ('connection aborted' in text) or ('remote disconnected' in text) or ('connection reset by peer' in text)

def is_connection_timeout_error(message: str) -> bool:
    """检测连接超时错误（如 curl 28），这类错误可通过同账号短等待重试解决。"""
    text = str(message or '').lower()
    return 'curl: (28)' in text or 'operation timed out' in text or 'connection timed out' in text or ('read timed out' in text) or ('connect timeout' in text)

def image_stream_error_message(message: str) -> str:
    text = str(message or '')
    if is_token_invalid_error(text):
        return 'image generation failed'
    if is_tls_connection_error(text):
        return 'upstream image connection failed, please retry later'
    if is_connection_timeout_error(text):
        return 'upstream connection timed out, please retry later'
    return text or 'image generation failed'
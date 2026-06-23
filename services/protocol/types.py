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

@dataclass
class ConversationRequest:
    model: str = 'auto'
    prompt: str = ''
    messages: list[dict[str, Any]] | None = None
    images: list[str] | None = None
    n: int = 1
    size: str | None = None
    quality: str = 'auto'
    response_format: str = 'b64_json'
    base_url: str | None = None
    message_as_error: bool = False
    progress_callback: Any = None
    user_id: str | None = None
    cancel_event: threading.Event | None = None

@dataclass
class ConversationState:
    text: str = ''
    raw_text: str = ''
    conversation_id: str = ''
    file_ids: list[str] = field(default_factory=list)
    sediment_ids: list[str] = field(default_factory=list)
    blocked: bool = False
    tool_invoked: bool | None = None
    turn_use_case: str = ''

@dataclass
class ImageOutput:
    kind: str
    model: str
    index: int
    total: int
    created: int = field(default_factory=lambda: int(time.time()))
    text: str = ''
    upstream_event_type: str = ''
    data: list[dict[str, Any]] = field(default_factory=list)
    account_email: str = ''
    conversation_id: str = ''

    def to_chunk(self) -> dict[str, Any]:
        chunk: dict[str, Any] = {'object': 'image.generation.chunk', 'created': self.created, 'model': self.model, 'index': self.index, 'total': self.total, 'progress_text': self.text, 'upstream_event_type': self.upstream_event_type, 'data': []}
        if self.account_email:
            chunk['_account_email'] = self.account_email
        if self.conversation_id:
            chunk['_conversation_id'] = self.conversation_id
        if self.kind == 'message':
            chunk.update({'object': 'image.generation.message', 'message': self.text})
            chunk.pop('progress_text', None)
            chunk.pop('upstream_event_type', None)
        elif self.kind == 'result':
            chunk.update({'object': 'image.generation.result', 'data': self.data})
            chunk.pop('progress_text', None)
            chunk.pop('upstream_event_type', None)
        return chunk
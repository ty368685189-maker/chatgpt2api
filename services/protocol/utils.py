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

from .errors import *

from .types import *

def _check_cancelled(request: ConversationRequest) -> None:
    if request.cancel_event and request.cancel_event.is_set():
        raise ImageTaskCancelledError('image task cancelled')

def _sleep_with_cancel(request: ConversationRequest, seconds: float) -> None:
    remaining = max(0.0, float(seconds))
    if remaining <= 0:
        _check_cancelled(request)
        return
    deadline = time.time() + remaining
    while True:
        _check_cancelled(request)
        wait_for = min(0.5, max(0.0, deadline - time.time()))
        if wait_for <= 0:
            return
        time.sleep(wait_for)

REFERENCED_IMAGE_IDS_RE = re.compile('"referenced_image_ids"\\s*:\\s*\\[([^\\]]+)\\]')

TOOL_PARAMS_JSON_RE = re.compile('\\{\\s*"size"\\s*:\\s*"\\d+x\\d+"\\s*,\\s*"n"\\s*:\\s*\\d+\\s*\\}')

def is_model_text_reply_instead_of_image(message: str) -> bool:
    """检测模型是否返回了文本回复（包含工具调用 JSON）而非实际生成图片。

    当上游 ChatGPT 未能触发图片生成工具时，会返回一段描述性文本，
    其中可能包含 JSON 参数（如 prompt、referenced_image_ids、size/n 等）。
    这种情况应被视为「上游未生成图片」而非「内容策略违规」。

    检测两种模式：
    1. 完整的工具调用 JSON（含 referenced_image_ids）
    2. 部分的工具参数 JSON（如 {"size":"1920x1088","n":1}）
    """
    if not message:
        return False
    if REFERENCED_IMAGE_IDS_RE.search(message):
        return True
    if TOOL_PARAMS_JSON_RE.search(message):
        return True
    return False

def encode_images(images: Iterable[tuple[bytes, str, str]]) -> list[str]:
    return [base64.b64encode(data).decode('ascii') for data, _, _ in images if data]

def save_image_bytes(image_data: bytes, base_url: str | None=None) -> str:
    return image_storage_service.save(image_data, base_url).url

def message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and str(item.get('type') or '') in {'text', 'input_text', 'output_text'}:
                parts.append(str(item.get('text') or ''))
        return ''.join(parts)
    return ''

def normalize_messages(messages: object, system: Any=None) -> list[dict[str, Any]]:
    normalized = []
    if config.global_system_prompt:
        normalized.append({'role': 'system', 'content': config.global_system_prompt})
    system_text = message_text(system)
    if system_text:
        normalized.append({'role': 'system', 'content': system_text})
    if isinstance(messages, list):
        for message in messages:
            if not isinstance(message, dict):
                continue
            role = message.get('role', 'user')
            content = message.get('content', '')
            text = message_text(content)
            images: list[tuple[bytes, str]] = []
            if role == 'user':
                images.extend(extract_image_from_message_content(content))
                if isinstance(content, list):
                    for part in content:
                        if not isinstance(part, dict) or part.get('type') != 'image':
                            continue
                        data = part.get('data')
                        if isinstance(data, (bytes, bytearray)) and all((existing[0] != bytes(data) for existing in images)):
                            images.append((bytes(data), str(part.get('mime') or 'image/png')))
            if images:
                parts: list[Any] = []
                if text:
                    parts.append({'type': 'text', 'text': text})
                for data, mime in images:
                    parts.append({'type': 'image', 'data': data, 'mime': mime})
                normalized.append({'role': role, 'content': parts})
            else:
                normalized.append({'role': role, 'content': text})
    return normalized

def prompt_with_global_system(prompt: str) -> str:
    return f'{config.global_system_prompt}\n\n{prompt}' if config.global_system_prompt else prompt

def assistant_history_text(messages: list[dict[str, Any]]) -> str:
    return ''.join((str(item.get('content') or '') for item in messages if item.get('role') == 'assistant'))

def assistant_history_messages(messages: list[dict[str, Any]]) -> list[str]:
    return [str(item.get('content') or '') for item in messages if item.get('role') == 'assistant' and item.get('content')]

def build_image_prompt(prompt: str, size: str | None, quality: str='auto') -> str:
    hints = []
    if size:
        hints.append(f'输出图片尺寸为 {size}。')
    if quality:
        hints.append(f'输出图片质量为 {quality}。')
    return f"{prompt.strip()}\n\n{''.join(hints)}" if hints else prompt

def encoding_for_model(model: str):
    try:
        return tiktoken.encoding_for_model(model)
    except KeyError:
        try:
            return tiktoken.get_encoding('o200k_base')
        except KeyError:
            return tiktoken.get_encoding('cl100k_base')

def count_message_image_tokens(messages: list[dict[str, Any]], model: str) -> int:
    return sum((count_image_content_tokens(message.get('content'), model) for message in messages))

def count_message_text_tokens(messages: list[dict[str, Any]], model: str) -> int:
    encoding = encoding_for_model(model)
    total = 0
    for message in messages:
        total += 3
        for key, value in message.items():
            if key == 'content' and isinstance(value, list):
                total += len(encoding.encode(message_text(value)))
            elif isinstance(value, str):
                total += len(encoding.encode(value))
            else:
                continue
            if key == 'name':
                total += 1
    return total + 3

def count_message_tokens(messages: list[dict[str, Any]], model: str) -> int:
    return count_message_text_tokens(messages, model) + count_message_image_tokens(messages, model)

def count_text_tokens(text: str, model: str) -> int:
    return len(encoding_for_model(model).encode(text))

def format_image_result(items: list[dict[str, Any]], prompt: str, response_format: str, base_url: str | None=None, created: int | None=None, message: str='') -> dict[str, Any]:
    data: list[dict[str, Any]] = []
    for item in items:
        b64_json = str(item.get('b64_json') or '').strip()
        if not b64_json:
            continue
        revised_prompt = str(item.get('revised_prompt') or prompt).strip() or prompt
        if response_format == 'b64_json':
            data.append({'b64_json': b64_json, 'url': save_image_bytes(base64.b64decode(b64_json), base_url), 'revised_prompt': revised_prompt})
        else:
            data.append({'url': save_image_bytes(base64.b64decode(b64_json), base_url), 'revised_prompt': revised_prompt})
    result: dict[str, Any] = {'created': created or int(time.time()), 'data': data}
    if message and (not data):
        result['message'] = message
    return result

def assistant_message_text(message: dict[str, Any]) -> str:
    content = message.get('content') or {}
    parts = content.get('parts') or []
    if isinstance(parts, list) and parts:
        text = ''.join((part for part in parts if isinstance(part, str)))
        if text:
            return text
    text_field = str(content.get('text') or '')
    if text_field:
        return text_field
    return ''

def strip_history(text: str, history_text: str='') -> str:
    text = str(text or '')
    history_text = str(history_text or '')
    while history_text and text.startswith(history_text):
        text = text[len(history_text):]
    return text

def sanitize_output_text(text: str) -> str:
    text = str(text or '')

    def is_internal_annotation_part(part: str) -> bool:
        value = part.strip()
        if not value:
            return True
        lower = value.lower()
        return bool(re.fullmatch('turn\\d+[a-z]*\\d*', lower) or re.fullmatch('turn\\d+\\w*', lower) or lower.startswith(('turn', 'source', 'sources')))

    def readable_annotation_part(parts: list[str]) -> str:
        for part in parts:
            value = part.strip()
            if value and (not is_internal_annotation_part(value)):
                return value
        return ''

    def replace_annotation(match: re.Match[str]) -> str:
        payload = match.group(1)
        parts = [part.strip() for part in payload.split('\ue202')]
        kind = (parts[0] if parts else '').lower()
        data = parts[1:]
        if kind == 'url':
            label = data[0] if data else ''
            url = data[1] if len(data) > 1 else ''
            if label and url.startswith(('http://', 'https://')):
                return f'{label} ({url})'
            return label or url
        if kind == 'cite':
            return readable_annotation_part(data)
        return readable_annotation_part(data)
    text = re.sub('\\ue200([^\\ue201]*)\\ue201', replace_annotation, text)
    text = re.sub('\\ue200[^\\ue201]*$', '', text)
    text = re.sub('\\s+([.,;:!?])', '\\1', text)
    return text

def assistant_raw_text(event: dict[str, Any], current_text: str='', history_text: str='') -> str:
    for candidate in (event, event.get('v')):
        if not isinstance(candidate, dict):
            continue
        message = candidate.get('message')
        if not isinstance(message, dict):
            continue
        role = str((message.get('author') or {}).get('role') or '').strip().lower()
        if role != 'assistant':
            continue
        text = assistant_message_text(message)
        if text:
            return strip_history(text, history_text)
    return apply_text_patch(event, current_text, history_text)

def assistant_text(event: dict[str, Any], current_text: str='', history_text: str='') -> str:
    return sanitize_output_text(assistant_raw_text(event, current_text, history_text))

def event_assistant_text(event: dict[str, Any], history_text: str='') -> str:
    for candidate in (event, event.get('v')):
        if not isinstance(candidate, dict):
            continue
        message = candidate.get('message')
        if isinstance(message, dict) and (message.get('author') or {}).get('role') == 'assistant':
            return strip_history(assistant_message_text(message), history_text)
    return ''

def apply_text_patch(event: dict[str, Any], current_text: str='', history_text: str='') -> str:
    if event.get('p') == '/message/content/parts/0':
        return apply_patch_op(event, current_text, history_text)
    operations = event.get('v')
    if isinstance(operations, str) and current_text and (not event.get('p')) and (not event.get('o')):
        return current_text + operations
    if event.get('o') == 'patch' and isinstance(operations, list):
        text = current_text
        for item in operations:
            if isinstance(item, dict):
                text = apply_text_patch(item, text, history_text)
        return text
    if not isinstance(operations, list):
        return current_text
    text = current_text
    for item in operations:
        if isinstance(item, dict):
            text = apply_text_patch(item, text, history_text)
    return text

def apply_patch_op(operation: dict[str, Any], current_text: str, history_text: str='') -> str:
    op = operation.get('o')
    value = str(operation.get('v') or '')
    if op == 'append':
        return current_text + value
    if op == 'replace':
        return strip_history(value, history_text)
    return current_text

def add_unique(values: list[str], candidates: list[str]) -> None:
    for candidate in candidates:
        if candidate and candidate not in values:
            values.append(candidate)

FILE_SERVICE_ID_RE = re.compile('file-service://([A-Za-z0-9_-]+)')

FILE_ID_RE = re.compile('\\b(file[-_](?!service\\b)[A-Za-z0-9_-]+)\\b')

REAL_IMAGE_FILE_ID_RE = re.compile('\\bfile_00000000[a-f0-9]{24}\\b')

SEDIMENT_ID_RE = re.compile('sediment://([A-Za-z0-9_-]+)')

def extract_conversation_ids(payload: str) -> tuple[str, list[str], list[str]]:
    conversation_match = re.search('"conversation_id"\\s*:\\s*"([^"]+)"', payload)
    conversation_id = conversation_match.group(1) if conversation_match else ''
    file_ids: list[str] = []
    add_unique(file_ids, FILE_SERVICE_ID_RE.findall(payload))
    add_unique(file_ids, REAL_IMAGE_FILE_ID_RE.findall(payload))
    sediment_ids = SEDIMENT_ID_RE.findall(payload)
    return (conversation_id, file_ids, sediment_ids)

def is_image_tool_event(event: dict[str, Any]) -> bool:
    value = event.get('v')
    message = event.get('message') or (value.get('message') if isinstance(value, dict) else None)
    if not isinstance(message, dict):
        return False
    metadata = message.get('metadata') or {}
    author = message.get('author') or {}
    content = message.get('content') or {}
    if author.get('role') != 'tool':
        return False
    if metadata.get('async_task_type') == 'image_gen':
        return True
    if content.get('content_type') != 'multimodal_text':
        return False
    return any((isinstance(part, dict) and (part.get('content_type') == 'image_asset_pointer' or str(part.get('asset_pointer') or '').startswith(('file-service://', 'sediment://'))) for part in content.get('parts') or []))

def _is_user_message_event(event: dict[str, Any]) -> bool:
    """检查事件是否来自 user 角色消息。"""
    value = event.get('v')
    message = event.get('message') or (value.get('message') if isinstance(value, dict) else None)
    if isinstance(message, dict):
        author = message.get('author') or {}
        if str(author.get('role') or '').strip().lower() == 'user':
            return True
    return False
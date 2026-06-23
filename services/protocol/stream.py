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

from .utils import *

def update_conversation_state(state: ConversationState, payload: str, event: dict[str, Any] | None=None) -> None:
    conversation_id, file_ids, sediment_ids = extract_conversation_ids(payload)
    if conversation_id and (not state.conversation_id):
        state.conversation_id = conversation_id
    is_patch_event = isinstance(event, dict) and event.get('o') == 'patch'
    is_user_msg = isinstance(event, dict) and _is_user_message_event(event)
    image_context = isinstance(event, dict) and is_image_tool_event(event) or (state.tool_invoked is True and (not is_user_msg)) or (is_patch_event and (not is_user_msg) and ('asset_pointer' in payload or 'file-service://' in payload))
    if image_context:
        add_unique(state.file_ids, file_ids)
        add_unique(state.sediment_ids, sediment_ids)
    if not isinstance(event, dict):
        return
    state.conversation_id = str(event.get('conversation_id') or state.conversation_id)
    value = event.get('v')
    if isinstance(value, dict):
        state.conversation_id = str(value.get('conversation_id') or state.conversation_id)
    if event.get('type') == 'moderation':
        moderation = event.get('moderation_response')
        if isinstance(moderation, dict) and moderation.get('blocked') is True:
            state.blocked = True
    if event.get('type') == 'server_ste_metadata':
        metadata = event.get('metadata')
        if isinstance(metadata, dict):
            if isinstance(metadata.get('tool_invoked'), bool):
                state.tool_invoked = metadata['tool_invoked']
            state.turn_use_case = str(metadata.get('turn_use_case') or state.turn_use_case)

def conversation_base_event(event_type: str, state: ConversationState, **extra: Any) -> dict[str, Any]:
    return {'type': event_type, 'text': state.text, 'conversation_id': state.conversation_id, 'file_ids': list(state.file_ids), 'sediment_ids': list(state.sediment_ids), 'blocked': state.blocked, 'tool_invoked': state.tool_invoked, 'turn_use_case': state.turn_use_case, **extra}

def should_poll_image_result(request: ConversationRequest, last_event: dict[str, Any]) -> bool:
    return bool(request.images) or last_event.get('turn_use_case') == 'image gen' or last_event.get('tool_invoked') is True

def iter_conversation_payloads(payloads: Iterator[str], history_text: str='', history_messages: list[str] | None=None) -> Iterator[dict[str, Any]]:
    state = ConversationState()
    history_messages = history_messages or []
    history_index = 0
    for payload in payloads:
        if not payload:
            continue
        if payload == '[DONE]':
            yield conversation_base_event('conversation.done', state, done=True)
            break
        try:
            event = json.loads(payload)
        except json.JSONDecodeError:
            update_conversation_state(state, payload)
            yield conversation_base_event('conversation.raw', state, payload=payload)
            continue
        if not isinstance(event, dict):
            yield conversation_base_event('conversation.event', state, raw=event)
            continue
        update_conversation_state(state, payload, event)
        if history_index < len(history_messages) and event_assistant_text(event, history_text) == history_messages[history_index]:
            history_index += 1
            state.raw_text = ''
            state.text = ''
            continue
        next_raw_text = assistant_raw_text(event, state.raw_text, history_text)
        next_text = sanitize_output_text(next_raw_text)
        state.raw_text = next_raw_text
        if next_text != state.text:
            delta = next_text[len(state.text):] if next_text.startswith(state.text) else next_text
            state.text = next_text
            yield conversation_base_event('conversation.delta', state, raw=event, delta=delta)
            continue
        yield conversation_base_event('conversation.event', state, raw=event)

def conversation_events(backend: OpenAIBackendAPI, messages: list[dict[str, Any]] | None=None, model: str='auto', prompt: str='', images: list[str] | None=None, size: str | None=None, quality: str='auto') -> Iterator[dict[str, Any]]:
    normalized = normalize_messages(messages or ([{'role': 'user', 'content': prompt}] if prompt else []))
    image_model = is_supported_image_model(model)
    history_text = '' if image_model else assistant_history_text(normalized)
    history_messages = [] if image_model else assistant_history_messages(normalized)
    final_prompt = prompt_with_global_system(build_image_prompt(prompt, size, quality)) if image_model else prompt
    payloads = backend.stream_conversation(messages=normalized, model=model, prompt=final_prompt, images=images if image_model else None, system_hints=['picture_v2'] if image_model else None)
    yield from iter_conversation_payloads(payloads, history_text, history_messages)

def text_backend() -> OpenAIBackendAPI:
    return OpenAIBackendAPI(access_token=account_service.get_text_access_token())

def stream_text_deltas(backend: OpenAIBackendAPI, request: ConversationRequest) -> Iterator[str]:
    token = getattr(backend, 'access_token', '')
    if backend:
        backend.close()
    attempted_tokens: set[str] = set()
    emitted = False
    while True:
        if token and token in attempted_tokens:
            raise RuntimeError('no available text account')
        if token:
            attempted_tokens.add(token)
        try:
            with OpenAIBackendAPI(access_token=token) as active_backend:
                for event in conversation_events(active_backend, messages=request.messages, model=request.model, prompt=request.prompt):
                    if event.get('type') != 'conversation.delta':
                        continue
                    delta = str(event.get('delta') or '')
                    if delta:
                        emitted = True
                        yield delta
                account_service.mark_text_used(token)
                return
        except Exception as exc:
            error_message = str(exc)
            if token and (not emitted) and is_token_invalid_error(error_message):
                refreshed_token = account_service.refresh_access_token(token, force=True, event='text_stream')
                if refreshed_token and refreshed_token != token and (refreshed_token not in attempted_tokens):
                    token = refreshed_token
                else:
                    account_service.remove_invalid_token(token, 'text_stream')
                    token = account_service.get_text_access_token(attempted_tokens)
                if token:
                    continue
            raise

def collect_text(backend: OpenAIBackendAPI, request: ConversationRequest) -> str:
    return ''.join(stream_text_deltas(backend, request))

def _get_detailed_error_from_tasks(backend: OpenAIBackendAPI, conversation_id: str, timeout_secs: float=10.0, wait_secs: float=2.0) -> str:
    """从 /backend-api/tasks/ 接口获取结构化错误信息。

    当 SSE 流检测到 moderation 拦截时，轮询 tasks 接口获取详细错误文本。
    使用结构化字段（metadata.is_error, author.role, content.content_type）判断，
    而非依赖易变的文本匹配。

    参数：
    - `backend`：OpenAIBackendAPI 实例。
    - `conversation_id`：会话 ID。
    - `timeout_secs`：请求超时秒数。
    - `wait_secs`：等待任务创建的秒数。设为 0 可跳过等待。

    返回：
    - 详细错误信息文本，如果未找到则返回空字符串。
    """
    import time as _time
    try:
        if wait_secs > 0:
            _time.sleep(wait_secs)
        tasks = backend._query_backend_tasks(conversation_id=conversation_id, timeout_secs=timeout_secs)
        if not tasks:
            return ''
        for task in tasks:
            is_error, error_msg, metadata = backend.check_task_error(task)
            if is_error and error_msg:
                logger.info({'event': 'image_task_structured_error', 'conversation_id': conversation_id, 'error_msg': error_msg, 'metadata': metadata})
                return error_msg
        return ''
    except Exception as exc:
        logger.warning({'event': 'image_task_error_query_failed', 'conversation_id': conversation_id, 'error': str(exc)})
        return ''
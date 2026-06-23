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

from .stream import *

class UserConcurrencyLimiter:

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.cond = threading.Condition(self.lock)
        self.active_tasks: dict[str, int] = {}

    def acquire(self, user_id: str) -> None:
        if not user_id:
            return
        limit = config.image_user_concurrency
        with self.lock:
            while self.active_tasks.get(user_id, 0) >= limit:
                self.cond.wait()
            self.active_tasks[user_id] = self.active_tasks.get(user_id, 0) + 1

    def release(self, user_id: str) -> None:
        if not user_id:
            return
        with self.lock:
            if user_id in self.active_tasks:
                self.active_tasks[user_id] -= 1
                if self.active_tasks[user_id] <= 0:
                    del self.active_tasks[user_id]
                self.cond.notify_all()

user_concurrency_limiter = UserConcurrencyLimiter()

def stream_image_outputs(backend: OpenAIBackendAPI, request: ConversationRequest, index: int=1, total: int=1) -> Iterator[ImageOutput]:
    last: dict[str, Any] = {}
    for event in conversation_events(backend, prompt=request.prompt, model=request.model, images=request.images or [], size=request.size, quality=request.quality):
        last = event
        if event.get('type') == 'conversation.delta':
            yield ImageOutput(kind='progress', model=request.model, index=index, total=total, text=str(event.get('delta') or ''), upstream_event_type='conversation.delta')
            continue
        if event.get('type') == 'conversation.event':
            raw = event.get('raw')
            raw_type = str(raw.get('type') or '') if isinstance(raw, dict) else ''
            yield ImageOutput(kind='progress', model=request.model, index=index, total=total, upstream_event_type=raw_type)
    conversation_id = str(last.get('conversation_id') or '')
    file_ids = [str(item) for item in last.get('file_ids') or []]
    sediment_ids = [str(item) for item in last.get('sediment_ids') or []]
    message = str(last.get('text') or '').strip()
    logger.info({'event': 'image_stream_resolve_start', 'conversation_id': conversation_id, 'file_ids': file_ids, 'sediment_ids': sediment_ids, 'tool_invoked': last.get('tool_invoked'), 'turn_use_case': last.get('turn_use_case')})
    if request.progress_callback:
        request.progress_callback('image_stream_resolve_start')
    if message and (not file_ids) and (not sediment_ids) and last.get('blocked'):
        detailed_error = _get_detailed_error_from_tasks(backend, conversation_id)
        error_text = detailed_error or message or 'Image generation was rejected by upstream policy.'
        yield ImageOutput(kind='message', model=request.model, index=index, total=total, text=error_text, conversation_id=conversation_id)
        return
    poll_for_image = should_poll_image_result(request, last)
    if message and (not file_ids) and (not sediment_ids) and (not poll_for_image):
        yield ImageOutput(kind='message', model=request.model, index=index, total=total, text=message, conversation_id=conversation_id)
        return
    is_text_reply = bool(message and is_model_text_reply_instead_of_image(message))
    if is_text_reply:
        logger.info({'event': 'image_detected_text_reply_with_ids', 'conversation_id': conversation_id, 'message_preview': message[:200]})
    if is_text_reply and (not conversation_id):
        try:
            import time as _time
            recovered_id = backend.find_conversation_by_prompt(request.prompt, _time.time(), timeout_secs=5.0)
            if recovered_id:
                conversation_id = recovered_id
                logger.info({'event': 'image_conversation_id_recovered', 'conversation_id': conversation_id, 'message_preview': message[:200]})
        except Exception as exc:
            logger.warning({'event': 'image_conversation_id_recovery_failed', 'error': repr(exc)[:300]})
    detailed_error = ''
    if not file_ids and (not sediment_ids) and conversation_id:
        detailed_error = _get_detailed_error_from_tasks(backend, conversation_id, timeout_secs=5.0, wait_secs=1.0)
        if detailed_error and (not poll_for_image) and (not is_text_reply):
            logger.info({'event': 'image_task_error_before_poll', 'conversation_id': conversation_id, 'error': detailed_error})
            yield ImageOutput(kind='message', model=request.model, index=index, total=total, text=detailed_error, conversation_id=conversation_id)
            return
        if detailed_error and (poll_for_image or is_text_reply):
            logger.info({'event': 'image_task_error_skipped_for_poll', 'conversation_id': conversation_id, 'error': detailed_error})
    poll_timeout = config.image_poll_timeout_secs
    if is_text_reply and conversation_id:
        poll_timeout = max(poll_timeout, 300)
        logger.info({'event': 'image_text_reply_extended_poll', 'conversation_id': conversation_id, 'poll_timeout_secs': poll_timeout})
    try:
        image_urls = backend.resolve_conversation_image_urls(conversation_id, file_ids, sediment_ids, poll_timeout_secs=poll_timeout, cancel_event=request.cancel_event)
    except (ImageContentPolicyError, ImagePollTimeoutError) as exc:
        if is_text_reply and isinstance(exc, ImageContentPolicyError):
            logger.warning({'event': 'image_text_reply_task_error_ignored', 'conversation_id': conversation_id, 'error': str(exc)})
            image_urls = []
        else:
            raise
    except Exception as exc:
        if is_text_reply and conversation_id:
            logger.warning({'event': 'image_text_reply_first_poll_error_ignored', 'conversation_id': conversation_id, 'error': repr(exc)[:300]})
            image_urls = []
        else:
            raise
    if image_urls:
        if request.progress_callback:
            request.progress_callback('receiving_image')
        image_items = [{'b64_json': base64.b64encode(image_data).decode('ascii')} for image_data in backend.download_image_bytes(image_urls)]
        data = format_image_result(image_items, request.prompt, request.response_format, request.base_url, int(time.time()))['data']
        if data:
            yield ImageOutput(kind='result', model=request.model, index=index, total=total, data=data, conversation_id=conversation_id)
        return
    if message:
        if is_text_reply and (not conversation_id):
            try:
                import time as _time
                recovered_id = backend.find_conversation_by_prompt(request.prompt, _time.time(), timeout_secs=5.0)
                if recovered_id:
                    conversation_id = recovered_id
                    logger.info({'event': 'image_text_reply_conversation_id_recovered', 'conversation_id': conversation_id, 'message_preview': message[:200]})
            except Exception as exc:
                logger.warning({'event': 'image_text_reply_conversation_id_recovery_failed', 'error': repr(exc)[:300]})
        if is_text_reply and conversation_id:
            logger.info({'event': 'image_model_text_reply_retry_poll', 'conversation_id': conversation_id, 'message_preview': message[:200]})
            retry_poll_timeout = max(config.image_poll_timeout_secs, 300)
            MAX_POLL_RETRIES = 3
            for poll_attempt in range(1, MAX_POLL_RETRIES + 1):
                try:
                    _check_cancelled(request)
                    polled_file_ids, polled_sediment_ids = backend._poll_image_results(conversation_id, retry_poll_timeout, file_ids, sediment_ids)
                    file_ids.extend((item for item in polled_file_ids if item and item not in file_ids))
                    sediment_ids.extend((item for item in polled_sediment_ids if item and item not in sediment_ids))
                    break
                except Exception as exc:
                    error_str = str(exc)
                    is_transient = isinstance(exc, ImagePollTimeoutError) or is_tls_connection_error(error_str) or 'upstream' in error_str.lower() or ('connection' in error_str.lower()) or ('timeout' in error_str.lower())
                    logger.warning({'event': 'image_model_text_reply_poll_failed', 'conversation_id': conversation_id, 'poll_attempt': poll_attempt, 'error': repr(exc)[:300], 'is_transient': is_transient})
                    if poll_attempt < MAX_POLL_RETRIES and (not isinstance(exc, (ImagePollTimeoutError, ImageContentPolicyError))):
                        backoff = 30.0 * poll_attempt
                        logger.info({'event': 'image_model_text_reply_poll_retry', 'conversation_id': conversation_id, 'poll_attempt': poll_attempt, 'backoff_secs': backoff})
                        _sleep_with_cancel(request, backoff)
                        continue
                    break
            if file_ids or sediment_ids:
                image_urls = backend.resolve_conversation_image_urls(conversation_id, file_ids, sediment_ids, poll=False)
                if image_urls:
                    if request.progress_callback:
                        request.progress_callback('receiving_image')
                    image_items = [{'b64_json': base64.b64encode(image_data).decode('ascii')} for image_data in backend.download_image_bytes(image_urls)]
                    data = format_image_result(image_items, request.prompt, request.response_format, request.base_url, int(time.time()))['data']
                    if data:
                        yield ImageOutput(kind='result', model=request.model, index=index, total=total, data=data, conversation_id=conversation_id)
                        return
        elif is_text_reply:
            logger.warning({'event': 'image_model_text_reply_no_image', 'conversation_id': conversation_id, 'message_preview': message[:200]})
        yield ImageOutput(kind='message', model=request.model, index=index, total=total, text=message, conversation_id=conversation_id)
        return
    logger.warning({'event': 'image_stream_no_result_fallback', 'conversation_id': conversation_id, 'file_ids': file_ids, 'sediment_ids': sediment_ids, 'should_poll_for_image': poll_for_image})
    if poll_for_image and (not conversation_id):
        try:
            import time as _time
            recovered_id = backend.find_conversation_by_prompt(request.prompt, _time.time(), timeout_secs=5.0)
            if recovered_id:
                conversation_id = recovered_id
                logger.info({'event': 'image_fallback_conversation_id_recovered', 'conversation_id': conversation_id})
        except Exception as exc:
            logger.warning({'event': 'image_fallback_conversation_id_recovery_failed', 'error': repr(exc)[:300]})
    if poll_for_image and conversation_id:
        retry_poll_timeout = max(config.image_poll_timeout_secs, 300)
        MAX_FALLBACK_POLL_RETRIES = 3
        for poll_attempt in range(1, MAX_FALLBACK_POLL_RETRIES + 1):
            retry_wait_secs = min(30.0 * poll_attempt, config.image_poll_initial_wait_secs * poll_attempt)
            logger.info({'event': 'image_stream_retry_poll_after_wait', 'conversation_id': conversation_id, 'retry_wait_secs': retry_wait_secs, 'poll_attempt': poll_attempt})
            _sleep_with_cancel(request, retry_wait_secs)
            try:
                _check_cancelled(request)
                polled_file_ids, polled_sediment_ids = backend._poll_image_results(conversation_id, retry_poll_timeout, file_ids, sediment_ids, cancel_event=request.cancel_event)
                file_ids.extend((item for item in polled_file_ids if item and item not in file_ids))
                sediment_ids.extend((item for item in polled_sediment_ids if item and item not in sediment_ids))
                break
            except Exception as exc:
                error_str = str(exc)
                is_transient = isinstance(exc, ImagePollTimeoutError) or is_tls_connection_error(error_str) or 'upstream' in error_str.lower() or ('connection' in error_str.lower()) or ('timeout' in error_str.lower())
                logger.warning({'event': 'image_stream_retry_poll_failed', 'conversation_id': conversation_id, 'poll_attempt': poll_attempt, 'error': repr(exc)[:300], 'is_transient': is_transient})
                if poll_attempt < MAX_FALLBACK_POLL_RETRIES and (not isinstance(exc, (ImagePollTimeoutError, ImageContentPolicyError))):
                    backoff = 30.0 * poll_attempt
                    logger.info({'event': 'image_stream_retry_poll_retry', 'conversation_id': conversation_id, 'poll_attempt': poll_attempt, 'backoff_secs': backoff})
                    _sleep_with_cancel(request, backoff)
                    continue
                break
        if file_ids or sediment_ids:
            image_urls = backend.resolve_conversation_image_urls(conversation_id, file_ids, sediment_ids, poll=False, cancel_event=request.cancel_event)
            if image_urls:
                if request.progress_callback:
                    request.progress_callback('receiving_image')
                image_items = [{'b64_json': base64.b64encode(image_data).decode('ascii')} for image_data in backend.download_image_bytes(image_urls)]
                data = format_image_result(image_items, request.prompt, request.response_format, request.base_url, int(time.time()))['data']
                if data:
                    yield ImageOutput(kind='result', model=request.model, index=index, total=total, data=data, conversation_id=conversation_id)
                    return
        yield ImageOutput(kind='message', model=request.model, index=index, total=total, text='Image generation completed upstream but the result could not be retrieved. The image may still be processing. Please try again in a moment.', conversation_id=conversation_id)
    elif message:
        yield ImageOutput(kind='message', model=request.model, index=index, total=total, text=message, conversation_id=conversation_id)
    else:
        yield ImageOutput(kind='message', model=request.model, index=index, total=total, text='Image generation started upstream but the response was incomplete. Please try again.', conversation_id=conversation_id)

def _codex_response_images(value: Any) -> list[str]:
    if isinstance(value, dict):
        if value.get('type') == 'image_generation_call' and isinstance(value.get('result'), str):
            result = value['result'].strip()
            if result:
                return [result.split(',', 1)[1] if result.startswith('data:image/') else result]
        images: list[str] = []
        for item in value.values():
            images.extend(_codex_response_images(item))
        return images
    if isinstance(value, list):
        images: list[str] = []
        for item in value:
            images.extend(_codex_response_images(item))
        return images
    return []

def stream_codex_image_outputs(backend: OpenAIBackendAPI, request: ConversationRequest, index: int=1, total: int=1) -> Iterator[ImageOutput]:
    images = _codex_response_images(list(backend.iter_codex_image_response_events(prompt=request.prompt, images=request.images or [], size=request.size, quality=request.quality)))
    if not images:
        raise ImageGenerationError('No image result found in response')
    data = format_image_result([{'b64_json': item, 'revised_prompt': request.prompt} for item in images], request.prompt, request.response_format, request.base_url, int(time.time()))['data']
    if data:
        yield ImageOutput(kind='result', model=request.model, index=index, total=total, data=data)
        return
    raise ImageGenerationError('No image result found in response')

def _generate_single_image(request: ConversationRequest, index: int, total: int) -> list[ImageOutput]:
    """为单张图片执行生成逻辑（含重试），返回结果列表。

    该函数在独立线程中运行，每个线程使用不同的账号，
    实现并行生图，避免串行超时阻塞。
    """
    MAX_TEXT_REPLY_RETRIES = 3
    MAX_TLS_RETRIES = 3
    MAX_CONN_TIMEOUT_RETRIES = 3
    MAX_POLL_TIMEOUT_RETRIES = 4
    MAX_IMAGE_GENERATION_RETRIES = 3
    text_reply_retry_count = 0
    tls_retry_count = 0
    conn_timeout_retry_count = 0
    poll_timeout_retry_count = 0
    image_gen_retry_count = 0
    account_email = ''
    while True:
        try:
            _check_cancelled(request)
            if request.progress_callback:
                request.progress_callback('getting_account')
            plan_type, _ = split_image_model(request.model)
            codex_model = is_codex_image_model(request.model)
            token = account_service.get_available_access_token(plan_type=plan_type, source_type='codex' if codex_model else None, plan_types=('plus', 'team', 'pro') if codex_model and (not plan_type) else None)
        except RuntimeError as exc:
            raise ImageGenerationError(str(exc) or 'image generation failed', account_email=account_email) from exc
        emitted_for_token = False
        returned_message = False
        returned_result = False
        account = account_service.get_account(token) or {}
        account_email = str(account.get('email') or '').strip()
        logger.debug({'event': 'image_account_lookup', 'token_prefix': token[:12] + '...' if len(token) > 12 else token, 'account_email': account_email, 'account_found': bool(account), 'index': index})
        rotated_proxy = proxy_pool_manager.get_next_proxy() or ''
        backend = None
        try:
            try:
                backend = OpenAIBackendAPI(access_token=token, proxy=rotated_proxy)
                if request.progress_callback:
                    backend.progress_callback = request.progress_callback
                stream_fn = stream_codex_image_outputs if is_codex_image_model(request.model) else stream_image_outputs
                outputs: list[ImageOutput] = []
                for output in stream_fn(backend, request, index, total):
                    _check_cancelled(request)
                    if account_email and (not output.account_email):
                        output.account_email = account_email
                    if output.kind == 'message' and request.message_as_error:
                        raise ImageGenerationError(output.text or 'Image generation was rejected by upstream policy.', status_code=400, error_type='invalid_request_error', code='content_policy_violation', account_email=account_email, conversation_id=output.conversation_id)
                    emitted_for_token = True
                    returned_message = output.kind == 'message'
                    returned_result = returned_result or output.kind == 'result'
                    outputs.append(output)
                if returned_message:
                    account_service.mark_image_result(token, False)
                    return outputs
                if not returned_result:
                    account_service.mark_image_result(token, False)
                    if emitted_for_token:
                        conv_id = outputs[-1].conversation_id if outputs else ''
                        raise ImageGenerationError('upstream completed without generating images', status_code=400, error_type='invalid_request_error', code='no_image_generated', account_email=account_email, conversation_id=conv_id)
                    return outputs
                account_service.mark_image_result(token, True)
                return outputs
            finally:
                if backend:
                    backend.close()
        except ImagePollTimeoutError as exc:
            account_service.mark_image_result(token, False)
            if rotated_proxy:
                proxy_pool_manager.mark_proxy_failed(rotated_proxy)
            if account_email:
                setattr(exc, 'account_email', account_email)
            if not emitted_for_token:
                poll_timeout_retry_count += 1
                if poll_timeout_retry_count <= MAX_POLL_TIMEOUT_RETRIES:
                    logger.warning({'event': 'image_poll_timeout_retry', 'request_token': token, 'account_email': account_email, 'retry_count': poll_timeout_retry_count, 'index': index, 'error': str(exc)[:200]})
                    continue
                logger.warning({'event': 'image_poll_timeout_exhausted_retries', 'request_token': token, 'account_email': account_email, 'retry_count': poll_timeout_retry_count, 'index': index})
                raise
            raise
        except ImageContentPolicyError as exc:
            account_service.mark_image_result(token, False)
            logger.warning({'event': 'image_stream_content_policy_error', 'request_token': token, 'account_email': account_email, 'error': str(exc), 'index': index})
            raise ImageGenerationError(str(exc) or 'Image generation was rejected by upstream policy.', status_code=400, error_type='invalid_request_error', code='content_policy_violation', account_email=account_email, conversation_id=getattr(exc, 'conversation_id', '')) from exc
        except ImageGenerationError as exc:
            account_service.mark_image_result(token, False)
            is_content_policy = exc.code == 'content_policy_violation'
            if not is_content_policy and rotated_proxy:
                proxy_pool_manager.mark_proxy_failed(rotated_proxy)
            if account_email and (not getattr(exc, 'account_email', '')):
                exc.account_email = account_email
            error_text = str(exc)
            if is_model_text_reply_instead_of_image(error_text) and (not emitted_for_token):
                text_reply_retry_count += 1
                if text_reply_retry_count <= MAX_TEXT_REPLY_RETRIES:
                    logger.warning({'event': 'image_model_text_reply_retry', 'request_token': token, 'account_email': account_email, 'retry_count': text_reply_retry_count, 'index': index, 'error': error_text[:200]})
                    continue
                logger.warning({'event': 'image_model_text_reply_exhausted_retries', 'request_token': token, 'account_email': account_email, 'retry_count': text_reply_retry_count, 'index': index})
                raise ImageGenerationError('Image generation failed: the upstream model returned a text description instead of generating an image. Please try again later.', status_code=502, error_type='server_error', code='upstream_text_reply', account_email=account_email, conversation_id=getattr(exc, 'conversation_id', '')) from exc
            if not is_content_policy and (not emitted_for_token):
                image_gen_retry_count += 1
                if image_gen_retry_count <= MAX_IMAGE_GENERATION_RETRIES:
                    logger.warning({'event': 'image_generation_failover_retry', 'request_token': token, 'account_email': account_email, 'retry_count': image_gen_retry_count, 'index': index, 'error': error_text[:200]})
                    continue
            logger.warning({'event': 'image_stream_generation_error', 'request_token': token, 'account_email': account_email, 'error': error_text, 'index': index})
            raise
        except Exception as exc:
            account_service.mark_image_result(token, False)
            if rotated_proxy:
                proxy_pool_manager.mark_proxy_failed(rotated_proxy)
            last_error = str(exc)
            logger.warning({'event': 'image_stream_fail', 'request_token': token, 'account_email': account_email, 'error': last_error, 'index': index})
            if not emitted_for_token and is_token_invalid_error(last_error):
                refreshed_token = account_service.refresh_access_token(token, force=True, event='image_stream')
                if refreshed_token and refreshed_token != token:
                    token = refreshed_token
                    continue
                account_service.remove_invalid_token(token, 'image_stream')
                continue
            if not emitted_for_token and is_tls_connection_error(last_error):
                tls_retry_count += 1
                if tls_retry_count <= MAX_TLS_RETRIES:
                    logger.warning({'event': 'image_stream_tls_retry', 'request_token': token, 'account_email': account_email, 'retry_count': tls_retry_count, 'index': index, 'error': last_error[:200]})
                    _sleep_with_cancel(request, min(2.0 * tls_retry_count, 10.0))
                    continue
            if not emitted_for_token and is_connection_timeout_error(last_error):
                conn_timeout_retry_count += 1
                if conn_timeout_retry_count <= MAX_CONN_TIMEOUT_RETRIES:
                    wait_secs = min(3.0 * conn_timeout_retry_count, 9.0)
                    logger.warning({'event': 'image_stream_conn_timeout_retry', 'request_token': token, 'account_email': account_email, 'retry_count': conn_timeout_retry_count, 'index': index, 'wait_secs': wait_secs, 'error': last_error[:200]})
                    _sleep_with_cancel(request, wait_secs)
                    continue
            if not emitted_for_token:
                image_gen_retry_count += 1
                if image_gen_retry_count <= MAX_IMAGE_GENERATION_RETRIES:
                    logger.warning({'event': 'image_stream_general_failover_retry', 'request_token': token, 'account_email': account_email, 'retry_count': image_gen_retry_count, 'index': index, 'error': last_error[:200]})
                    continue
            raise ImageGenerationError(image_stream_error_message(last_error), account_email=account_email, conversation_id='') from exc

def stream_image_outputs_with_pool(request: ConversationRequest) -> Iterator[ImageOutput]:
    """并行生成多张图片，每张图片使用独立线程 and 账号，互不阻塞。"""
    user_id = request.user_id or ''
    user_concurrency_limiter.acquire(user_id)
    try:
        _check_cancelled(request)
        if not is_supported_image_model(request.model):
            raise ImageGenerationError('unsupported image model,supported models: ' + ', '.join(sorted(IMAGE_MODELS)))
        if request.n <= 1:
            outputs = _generate_single_image(request, 1, 1)
            for output in outputs:
                yield output
            return
        if not config.image_parallel_generation:
            logger.info({'event': 'image_serial_generation_start', 'n': request.n, 'model': request.model})
            for index in range(1, request.n + 1):
                _check_cancelled(request)
                outputs = _generate_single_image(request, index, request.n)
                for output in outputs:
                    _check_cancelled(request)
                    yield output
            return
        logger.info({'event': 'image_parallel_generation_start', 'n': request.n, 'model': request.model})
        futures = {}
        results: dict[int, list[ImageOutput]] = {}
        errors: dict[int, Exception] = {}
        with ThreadPoolExecutor(max_workers=request.n) as executor:
            for index in range(1, request.n + 1):
                future = executor.submit(_generate_single_image, request, index, request.n)
                futures[future] = index
            for future in as_completed(futures):
                _check_cancelled(request)
                index = futures[future]
                try:
                    results[index] = future.result()
                except Exception as exc:
                    errors[index] = exc
                    logger.warning({'event': 'image_parallel_generation_error', 'index': index, 'error': str(exc)[:300]})
        emitted = False
        last_error = ''
        for index in range(1, request.n + 1):
            if index in results:
                for output in results[index]:
                    emitted = True
                    yield output
            elif index in errors:
                last_error = str(errors[index])
                if not emitted:
                    logger.warning({'event': 'image_parallel_failure_before_success', 'failed_index': index, 'error': last_error[:200]})
        if emitted:
            for index in range(1, request.n + 1):
                if index in errors:
                    logger.warning({'event': 'image_parallel_partial_failure', 'failed_index': index, 'error': str(errors[index])[:200]})
        if not emitted:
            if not last_error:
                last_error = 'no account in the pool could generate images — check account quota and rate-limit status'
            raise ImageGenerationError(image_stream_error_message(last_error), conversation_id='')
    finally:
        user_concurrency_limiter.release(user_id)

def stream_image_chunks(outputs: Iterable[ImageOutput]) -> Iterator[dict[str, Any]]:
    try:
        for output in outputs:
            yield output.to_chunk()
    finally:
        if hasattr(outputs, 'close'):
            try:
                outputs.close()
            except Exception:
                pass

def collect_image_outputs(outputs: Iterable[ImageOutput]) -> dict[str, Any]:
    created = None
    data: list[dict[str, Any]] = []
    message = ''
    progress_parts: list[str] = []
    account_email = ''
    try:
        for output in outputs:
            created = created or output.created
            if output.account_email and (not account_email):
                account_email = output.account_email
            if output.kind == 'progress' and output.text:
                progress_parts.append(output.text)
            elif output.kind == 'message':
                message = output.text
            elif output.kind == 'result':
                data.extend(output.data)
    finally:
        if hasattr(outputs, 'close'):
            try:
                outputs.close()
            except Exception:
                pass
    result: dict[str, Any] = {'created': created or int(time.time()), 'data': data}
    if not data:
        text = message or ''.join(progress_parts).strip()
        if text:
            result['message'] = text
    if account_email:
        result['_account_email'] = account_email
    return result
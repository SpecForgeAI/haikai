"""Chat-executor SSE streaming routes (V1 + V2).

Twelve endpoints lifted from `src/api/__init__.py` during Phase A.6d.
All share the same `executor.stream_message()` plumbing: a sync
generator running in a background thread, pushing events onto an
asyncio.Queue that the SSE response consumes.

  V1 conversational:
    * POST   /api/v1/shape-spec/stream        shape_spec_stream
    * GET    /api/v1/shape-spec/history       get_shape_spec_history
    * DELETE /api/v1/shape-spec               clear_shape_spec
    * POST   /api/v1/plan-product/stream      plan_product_stream
    * GET    /api/v1/plan-product/history     get_plan_product_history
    * DELETE /api/v1/plan-product             clear_plan_product

  V1 skill streams:
    * POST   /api/v1/story-component-anchor/stream  story_component_anchor_stream
    * POST   /api/v1/analyze-repo/stream            analyze_repo_stream

  V2 (git-integrated):
    * POST   /api/v2/shape-spec/stream        shape_spec_stream_v2
    * POST   /api/v2/plan-product/stream      plan_product_stream_v2
    * GET    /api/v2/shape-spec/history       get_shape_spec_history_v2
    * GET    /api/v2/plan-product/history     get_plan_product_history_v2

Module-level state still owned by `src/api/__init__.py`
(`API_WORKSPACE_DIR`, `load_env_config`, `_safe_project_dir`,
`_require_git_manager`) is lazily imported inside each endpoint body
to avoid a load cycle.
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ...api_auth import verify_api_key
from ...chat.audit_logger import AuditLogger
from ...chat.chat_models import (
    ChatClearRequest,
    ChatClearResponse,
    ChatHistoryResponse,
    ChatMessageRequest,
    MessageEntry,
)
from ...chat.session_store import create_active_session, get_active_session
from ...git.config import GitConfigError, load_git_config, load_git_config_with_project_fallback
from ...git.git_manager import GitManagerError
from ..factories import create_chat_executor
from ..gates import require_credentials

logger = logging.getLogger("src.api")

router = APIRouter()


def _create_chat_executor_or_400(**kwargs):
    """Construct the chat executor, surfacing setup failures as 400 detail.

    Executor construction raises ValueError for client-actionable setup
    problems (kiro-cli not found in WSL, bad workspace dir). Left uncaught
    they become bare 500s — the gateway forwards 4xx `detail` verbatim, so
    wrap every route-level construction with this helper.
    """
    try:
        return create_chat_executor(**kwargs)
    except ValueError as e:
        logger.error(f"Chat executor unavailable: {e}")
        raise HTTPException(status_code=400, detail=f"Chat executor unavailable: {e}")


# =============================================================================
# Shape-Spec (V1)
# =============================================================================

@router.post(
    "/api/v1/shape-spec/stream",
    tags=["Shape-Spec"],
    summary="Conversational shape-spec (streaming SSE)",
    responses={
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
    response_description="Server-Sent Events stream",
)
async def shape_spec_stream(
    request: ChatMessageRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """
    Start or continue a conversational shape-spec session with **Server-Sent Events (SSE)** streaming.

    The conversation is persistent per project. Use `session_mode: "new"` to start fresh
    or `"resume"` (default) to continue an existing session.

    **Client SSE event types received:**
    - `{"type": "session", "session_id": "..."}` — emitted first, contains session UUID
    - `{"type": "questions", ...}` — clarifying questions from the agent
    - `{"type": "folder", ...}` — folder structure created
    - `{"type": "error", "message": "..."}` — error occurred
    """
    from .. import API_WORKSPACE_DIR
    try:
        anthropic_api_key = require_credentials()

        is_new_session = False
        if request.session_mode == "new":
            session_id = create_active_session(API_WORKSPACE_DIR, request.company, request.project)
            is_new_session = True
            logger.info(f"Creating new session for {request.company}/{request.project}: {session_id}")
        else:
            session_id = get_active_session(API_WORKSPACE_DIR, request.company, request.project)
            if not session_id:
                session_id = create_active_session(API_WORKSPACE_DIR, request.company, request.project)
                is_new_session = True
                logger.info(f"No active session found, created new: {session_id}")
            else:
                logger.info(f"Resuming session for {request.company}/{request.project}: {session_id}")

        executor = _create_chat_executor_or_400(
            company=request.company,
            project=request.project,
            workspace_dir=API_WORKSPACE_DIR,
            anthropic_api_key=anthropic_api_key,
            session_uuid=session_id,
        )

        audit_logger = AuditLogger(executor.chat_logs_dir)

        if is_new_session:
            executor.clear_session()
            logger.info(f"Session cleared successfully for new session")

        audit_logger.log_user_message(request.message)

        async def event_generator():
            """Generate SSE events from Claude CLI output.

            Filters streaming output to only return important events (questions, folder, done, error).
            All other events (content, skill_invoked, etc.) are logged to a streaming log file.

            The sync Claude CLI subprocess is run in a background thread to avoid
            blocking the async event loop, which would prevent SSE events from being
            flushed to the client until the entire stream completes.
            """
            assistant_message_parts = []
            detected_spec_name = None

            stream_log_file = executor.chat_logs_dir / f"stream_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.jsonl"

            CLIENT_EVENTS = {"session", "questions", "folder", "error", "retry", "retry_progress", "questions_failed"}

            event_queue = asyncio.Queue()
            _SENTINEL = object()
            loop = asyncio.get_event_loop()
            # Set on client disconnect so the background thread stops
            # enqueueing further chunks. Best-effort cancellation — see
            # autoresearch:debug 260504-1229 finding #4.
            stop_flag = threading.Event()

            def _run_sync_stream():
                """Run the blocking sync generator in a background thread.

                Uses loop.call_soon_threadsafe() to safely push events onto
                the asyncio.Queue from this non-asyncio thread. Checks
                `stop_flag` after each yield so a disconnected client
                stops getting billed for queue enqueues.
                """
                try:
                    for event in executor.stream_message(request.message, is_new_session=is_new_session, command_name="shape-spec"):
                        if stop_flag.is_set():
                            break
                        loop.call_soon_threadsafe(event_queue.put_nowait, event)
                except Exception as e:
                    loop.call_soon_threadsafe(event_queue.put_nowait, {"type": "error", "message": str(e)})
                finally:
                    loop.call_soon_threadsafe(event_queue.put_nowait, _SENTINEL)

            try:
                with open(stream_log_file, 'a', encoding='utf-8') as stream_log:
                    session_event = {"type": "session", "session_id": executor.session_uuid}
                    stream_log.write(json.dumps(session_event) + "\n")
                    stream_log.flush()
                    yield f"data: {json.dumps(session_event)}\n\n"

                    loop.run_in_executor(None, _run_sync_stream)

                    try:
                        while True:
                            event = await event_queue.get()
                            if event is _SENTINEL:
                                break

                            event_type = event.get("type")

                            stream_log.write(json.dumps(event) + "\n")
                            stream_log.flush()

                            if event_type == "content":
                                assistant_message_parts.append(event.get("delta", ""))
                            elif event_type == "skill_invoked":
                                audit_logger.log_skill_invocation(event.get("skill", "unknown"))
                            elif event_type == "file_modified":
                                audit_logger.log_file_modification(event.get("path", "unknown"))
                            elif event_type == "error":
                                audit_logger.log_error(event.get("message", "Unknown error"))

                            if event_type == "folder":
                                detected_spec_name = event.get("folder", "")

                            if event_type in CLIENT_EVENTS:
                                yield f"data: {json.dumps(event)}\n\n"
                    finally:
                        # Client disconnect / generator close: signal the
                        # background thread to stop enqueueing further
                        # events. (The upstream Claude subprocess still
                        # runs to natural completion — see #4.)
                        stop_flag.set()

                if assistant_message_parts:
                    full_message = "".join(assistant_message_parts)
                    audit_logger.log_assistant_message(full_message)

                if detected_spec_name:
                    try:
                        executor.persist_session_to_spec(detected_spec_name)
                    except Exception as e:
                        logger.warning(f"Failed to persist session to spec folder: {e}")

                logger.info(f"Streaming log saved to: {stream_log_file}")

            except Exception as e:
                error_event = {"type": "error", "message": str(e)}
                audit_logger.log_error(str(e))
                yield f"data: {json.dumps(error_event)}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    except Exception as e:
        logger.error(f"Error in shape-spec stream: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start chat session: {str(e)}",
        )


@router.get(
    "/api/v1/shape-spec/history",
    tags=["Shape-Spec"],
    summary="Get shape-spec conversation history",
    response_model=ChatHistoryResponse,
    responses={
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
)
async def get_shape_spec_history(
    company: str,
    project: str,
    authenticated: bool = Depends(verify_api_key),
):
    """Retrieve the full conversation history for a shape-spec session."""
    from .. import _safe_project_dir
    try:
        # Validates company/project — see autoresearch:debug 260504-1229 #1.
        project_dir = _safe_project_dir(company, project)
        chat_logs_dir = project_dir / "chat_logs"

        audit_logger = AuditLogger(chat_logs_dir)
        messages = audit_logger.get_history()
        message_entries = [MessageEntry(**msg) for msg in messages]

        return ChatHistoryResponse(messages=message_entries)

    except Exception as e:
        logger.error(f"Error retrieving chat history: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve chat history: {str(e)}",
        )


@router.delete(
    "/api/v1/shape-spec",
    tags=["Shape-Spec"],
    summary="Clear shape-spec conversation",
    response_model=ChatClearResponse,
    responses={
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
)
async def clear_shape_spec(
    request: ChatClearRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """
    Clear the conversation history and Claude session for a shape-spec project.

    This removes the session file and all chat logs, allowing
    the user to start a fresh conversation.
    """
    from .. import API_WORKSPACE_DIR
    try:
        anthropic_api_key = require_credentials()

        executor = _create_chat_executor_or_400(
            company=request.company,
            project=request.project,
            workspace_dir=API_WORKSPACE_DIR,
            anthropic_api_key=anthropic_api_key,
        )

        executor.clear_session()

        logger.info(f"Cleared conversation history for {request.company}/{request.project}")

        return ChatClearResponse(
            success=True,
            message=f"Conversation history cleared for {request.company}/{request.project}",
        )

    except Exception as e:
        logger.error(f"Error clearing chat history: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to clear chat history: {str(e)}",
        )


# =============================================================================
# Plan-Product (V1)
# =============================================================================

@router.post(
    "/api/v1/plan-product/stream",
    tags=["Plan-Product"],
    summary="Conversational product planning (streaming SSE)",
    responses={
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
    response_description="Server-Sent Events stream",
)
async def plan_product_stream(
    request: ChatMessageRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """
    Start or continue a conversational product planning session with **SSE streaming**.

    This is typically the **first step** in the workflow. The agent will guide you through
    defining the product concept, mission, roadmap, and tech stack, creating
    `mission.md`, `roadmap.md`, and `tech-stack.md` files.
    """
    from .. import API_WORKSPACE_DIR
    try:
        anthropic_api_key = require_credentials()

        executor = _create_chat_executor_or_400(
            company=request.company,
            project=request.project,
            workspace_dir=API_WORKSPACE_DIR,
            anthropic_api_key=anthropic_api_key,
        )

        audit_logger = AuditLogger(executor.chat_logs_dir)

        is_new_session = False
        if request.session_mode == "new":
            logger.info(f"Creating new plan-product session for {request.company}/{request.project}")
            clear_result = executor.clear_session()
            if clear_result:
                logger.info(f"Session cleared successfully for new plan-product session")
                is_new_session = True
        elif request.session_mode == "resume":
            logger.info(f"Resuming plan-product session for {request.company}/{request.project}")
        else:
            logger.warning(f"Unknown session_mode '{request.session_mode}', defaulting to resume")

        audit_logger.log_user_message(request.message)

        async def event_generator():
            """Generate SSE events from Claude output.

            Filters streaming output to only return important events (questions, folder, done, error).
            All other events (content, skill_invoked, etc.) are logged to a streaming log file.
            """
            assistant_message_parts = []

            stream_log_file = executor.chat_logs_dir / f"stream_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.jsonl"

            CLIENT_EVENTS = {"session", "questions", "folder", "error", "retry", "retry_progress", "questions_failed"}

            event_queue = asyncio.Queue()
            _SENTINEL = object()
            loop = asyncio.get_event_loop()
            # Set on client disconnect — see autoresearch:debug 260504-1229 #4.
            stop_flag = threading.Event()

            def _run_sync_stream():
                """Run the blocking sync generator in a background thread.

                Uses loop.call_soon_threadsafe() to safely push events onto
                the asyncio.Queue from this non-asyncio thread. Checks
                `stop_flag` after each yield so a disconnected client
                stops getting billed for queue enqueues.
                """
                try:
                    for event in executor.stream_message(request.message, is_new_session=is_new_session, command_name="plan-product"):
                        if stop_flag.is_set():
                            break
                        loop.call_soon_threadsafe(event_queue.put_nowait, event)
                except Exception as e:
                    loop.call_soon_threadsafe(event_queue.put_nowait, {"type": "error", "message": str(e)})
                finally:
                    loop.call_soon_threadsafe(event_queue.put_nowait, _SENTINEL)

            try:
                with open(stream_log_file, 'a', encoding='utf-8') as stream_log:
                    session_event = {"type": "session", "session_id": executor.session_uuid}
                    stream_log.write(json.dumps(session_event) + "\n")
                    stream_log.flush()
                    yield f"data: {json.dumps(session_event)}\n\n"

                    loop.run_in_executor(None, _run_sync_stream)

                    try:
                        while True:
                            event = await event_queue.get()
                            if event is _SENTINEL:
                                break

                            event_type = event.get("type")

                            stream_log.write(json.dumps(event) + "\n")
                            stream_log.flush()

                            if event_type == "content":
                                assistant_message_parts.append(event.get("delta", ""))
                            elif event_type == "skill_invoked":
                                audit_logger.log_skill_invocation(event.get("skill", "unknown"))
                            elif event_type == "file_modified":
                                audit_logger.log_file_modification(event.get("path", "unknown"))
                            elif event_type == "error":
                                audit_logger.log_error(event.get("message", "Unknown error"))

                            if event_type in CLIENT_EVENTS:
                                yield f"data: {json.dumps(event)}\n\n"
                    finally:
                        # Client disconnect / generator close: signal the
                        # background thread to stop enqueueing further
                        # events. See #4 for context.
                        stop_flag.set()

                if assistant_message_parts:
                    full_message = "".join(assistant_message_parts)
                    audit_logger.log_assistant_message(full_message)

                logger.info(f"Streaming log saved to: {stream_log_file}")

            except Exception as e:
                error_event = {"type": "error", "message": str(e)}
                audit_logger.log_error(str(e))
                yield f"data: {json.dumps(error_event)}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    except Exception as e:
        logger.error(f"Error in plan-product stream: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start plan-product session: {str(e)}",
        )


@router.get(
    "/api/v1/plan-product/history",
    tags=["Plan-Product"],
    summary="Get plan-product conversation history",
    response_model=ChatHistoryResponse,
    responses={
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
)
async def get_plan_product_history(
    company: str,
    project: str,
    authenticated: bool = Depends(verify_api_key),
):
    """Retrieve the full conversation history for a plan-product session."""
    from .. import _safe_project_dir
    try:
        # Validates company/project — see autoresearch:debug 260504-1229 #1.
        project_dir = _safe_project_dir(company, project)
        chat_logs_dir = project_dir / "chat_logs"
        audit_logger = AuditLogger(chat_logs_dir)
        messages = audit_logger.get_history()
        message_entries = [MessageEntry(**msg) for msg in messages]
        return ChatHistoryResponse(messages=message_entries)

    except Exception as e:
        logger.error(f"Error retrieving plan-product history: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve plan-product history: {str(e)}",
        )


@router.delete(
    "/api/v1/plan-product",
    tags=["Plan-Product"],
    summary="Clear plan-product conversation",
    response_model=ChatClearResponse,
    responses={
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
)
async def clear_plan_product(
    request: ChatClearRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Clear the conversation history and Claude session for a plan-product project."""
    from .. import API_WORKSPACE_DIR
    try:
        anthropic_api_key = require_credentials()

        executor = _create_chat_executor_or_400(
            company=request.company,
            project=request.project,
            workspace_dir=API_WORKSPACE_DIR,
            anthropic_api_key=anthropic_api_key,
        )

        executor.clear_session()

        logger.info(f"Cleared plan-product session for {request.company}/{request.project}")

        return ChatClearResponse(
            success=True,
            message=f"Plan-product session cleared for {request.company}/{request.project}",
        )

    except Exception as e:
        logger.error(f"Error clearing plan-product session: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to clear plan-product session: {str(e)}",
        )


# =============================================================================
# Story-Component-Anchor (V1 skill stream)
# =============================================================================

STORY_ANCHOR_PROMPT = '''Generate Storybook stories from this contract.json:

```json
{contract}
```'''


class StoryAnchorRequest(BaseModel):
    """Request model for story-component-anchor endpoint."""
    company: str
    project: str
    contract: Dict[str, Any]
    session_mode: str = "new"  # Always new session for story generation


@router.post(
    "/api/v1/story-component-anchor/stream",
    tags=["Skills"],
    summary="Generate Storybook stories from contract (streaming SSE)",
    responses={
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
    response_description="Server-Sent Events stream",
)
async def story_component_anchor_stream(
    request: StoryAnchorRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """
    Generate Storybook stories from a component contract JSON via **SSE streaming**.

    Always starts a new session (previous session is cleared).
    """
    from .. import API_WORKSPACE_DIR
    try:
        anthropic_api_key = require_credentials()

        executor = _create_chat_executor_or_400(
            company=request.company,
            project=request.project,
            workspace_dir=API_WORKSPACE_DIR,
            anthropic_api_key=anthropic_api_key,
        )

        prompt = STORY_ANCHOR_PROMPT.format(contract=json.dumps(request.contract, indent=2))

        executor.clear_session()

        async def event_generator():
            """Generate SSE events from executor output.

            The sync Claude CLI subprocess is run in a background thread to avoid
            blocking the async event loop.
            """
            event_queue = asyncio.Queue()
            _SENTINEL = object()
            loop = asyncio.get_event_loop()
            # Set on client disconnect — see autoresearch:debug 260504-1229 #4.
            stop_flag = threading.Event()

            def _run_sync_stream():
                """Run the blocking sync generator in a background thread."""
                try:
                    for event in executor.stream_message(prompt, is_new_session=True, command_name="story-component-anchor"):
                        if stop_flag.is_set():
                            break
                        loop.call_soon_threadsafe(event_queue.put_nowait, event)
                except Exception as e:
                    loop.call_soon_threadsafe(event_queue.put_nowait, {"type": "error", "message": str(e)})
                finally:
                    loop.call_soon_threadsafe(event_queue.put_nowait, _SENTINEL)

            try:
                loop.run_in_executor(None, _run_sync_stream)

                try:
                    while True:
                        event = await event_queue.get()
                        if event is _SENTINEL:
                            break
                        event_type = event.get("type")

                        if event_type in {"content", "error", "file_modified"}:
                            yield f"data: {json.dumps(event)}\n\n"
                finally:
                    stop_flag.set()

            except Exception as e:
                logger.error(f"Story generation streaming error: {e}")
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    except Exception as e:
        logger.error(f"story-component-anchor error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate stories: {str(e)}",
        )


# =============================================================================
# Analyze-Repo (V1 skill stream)
# =============================================================================

ANALYZE_REPO_PROMPT = '''Analyze this repository and extract endpoints + interactions.

Repository path: {repo_path}
LLM classification: {llm_mode}'''


class AnalyzeRepoRequest(BaseModel):
    """Request model for analyze-repo endpoint.

    Supply ``repo_url`` to have the server shallow-clone the repository
    automatically, or ``repo_path`` for an already-cloned directory on disk.
    If both are provided, ``repo_url`` takes precedence.
    """
    company: str
    project: str
    repo_url: Optional[str] = None
    repo_path: Optional[str] = None
    no_llm: bool = False
    session_mode: str = "new"


@router.post(
    "/api/v1/analyze-repo/stream",
    tags=["Skills"],
    summary="Analyze repo structure and extract endpoints/interactions (streaming SSE)",
    responses={
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
    response_description="Server-Sent Events stream",
)
async def analyze_repo_stream(
    request: AnalyzeRepoRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """
    Analyze a repository's structure and extract endpoints + interactions via **SSE streaming**.

    Triggers the `/analyze-repo` Haikai skill which runs:
    1. `standards-extractor analyze` — structural pipeline (ctags + tree-sitter)
    2. `standards-extractor extract-endpoints` — endpoint/interaction extraction
    3. Writes `REPORT.md` to the snapshot directory

    Classification is automatic: YAML patterns always run, LLM if API keys configured.
    """
    from .. import API_WORKSPACE_DIR, _safe_project_dir
    try:
        anthropic_api_key = require_credentials()

        executor = _create_chat_executor_or_400(
            company=request.company,
            project=request.project,
            workspace_dir=API_WORKSPACE_DIR,
            anthropic_api_key=anthropic_api_key,
        )

        if request.repo_url:
            from ..structural_endpoints import _clone_repo
            cloned_path = _clone_repo(request.repo_url)
            repo_path = str(cloned_path)
        else:
            # Validate user-supplied repo_path stays inside workspace.
            # Without this guard, an authenticated client can supply
            # repo_path="/etc" or "C:/Windows" — the LLM (with its bash
            # tool) will then dutifully cd there and read files. See
            # autoresearch:debug 260504-1229 finding #3.
            if request.repo_path:
                candidate = Path(request.repo_path).resolve()
                workspace_root = API_WORKSPACE_DIR.resolve()
                try:
                    candidate.relative_to(workspace_root)
                except ValueError:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"repo_path must resolve inside the workspace "
                            f"({workspace_root}); got: {request.repo_path}"
                        ),
                    )
                repo_path = str(candidate)
            else:
                repo_path = str(_safe_project_dir(request.company, request.project))
        llm_mode = "disabled (--no-llm)" if request.no_llm else "automatic (LLM if API keys configured)"
        prompt = ANALYZE_REPO_PROMPT.format(repo_path=repo_path, llm_mode=llm_mode)

        if request.session_mode == "new":
            executor.clear_session()

        async def event_generator():
            event_queue = asyncio.Queue()
            _SENTINEL = object()
            loop = asyncio.get_event_loop()
            # Set on client disconnect — see autoresearch:debug 260504-1229 #4.
            stop_flag = threading.Event()

            def _run_sync_stream():
                try:
                    for event in executor.stream_message(prompt, is_new_session=(request.session_mode == "new"), command_name="analyze-repo"):
                        if stop_flag.is_set():
                            break
                        loop.call_soon_threadsafe(event_queue.put_nowait, event)
                except Exception as e:
                    loop.call_soon_threadsafe(event_queue.put_nowait, {"type": "error", "message": str(e)})
                finally:
                    loop.call_soon_threadsafe(event_queue.put_nowait, _SENTINEL)

            try:
                loop.run_in_executor(None, _run_sync_stream)
                try:
                    while True:
                        event = await event_queue.get()
                        if event is _SENTINEL:
                            break
                        event_type = event.get("type")
                        if event_type in {"content", "error", "file_modified"}:
                            yield f"data: {json.dumps(event)}\n\n"
                finally:
                    stop_flag.set()
            except Exception as e:
                logger.error(f"analyze-repo streaming error: {e}", exc_info=True)
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    except HTTPException:
        # Preserve 4xx codes raised inside the handler (e.g. the
        # repo_path workspace-containment 400 — see autoresearch:debug
        # 260504-1229 #3) instead of converting to 500.
        raise
    except Exception as e:
        logger.error(f"analyze-repo error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to analyze repo: {str(e)}",
        )


# =============================================================================
# V2 Shape-Spec + Plan-Product (git-integrated)
# =============================================================================

@router.post(
    "/api/v2/shape-spec/stream",
    tags=["Git Integration"],
    summary="Conversational shape-spec with git integration (V2)",
    responses={
        400: {"description": "Missing prerequisites or git config"},
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
    response_description="Server-Sent Events stream",
)
async def shape_spec_stream_v2(
    request: ChatMessageRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """
    Git-integrated shape-spec streaming. Pulls latest before starting,
    creates a feature branch when a spec folder is detected.

    Same SSE interface as V1, with git preconditions enforced.
    """
    from .. import API_WORKSPACE_DIR, _require_git_manager

    gm = _require_git_manager(request.company, request.project)

    git_pull_error = None
    try:
        gm.pull_latest()
    except GitManagerError as e:
        git_pull_error = f"git pull failed before shape-spec: {e}"
        logger.warning(git_pull_error)

    anthropic_api_key = require_credentials()

    is_new_session = False
    if request.session_mode == "new":
        session_id = create_active_session(API_WORKSPACE_DIR, request.company, request.project)
        is_new_session = True
        logger.info(f"V2 shape-spec: new session for {request.company}/{request.project}: {session_id}")
    else:
        session_id = get_active_session(API_WORKSPACE_DIR, request.company, request.project)
        if not session_id:
            session_id = create_active_session(API_WORKSPACE_DIR, request.company, request.project)
            is_new_session = True
            logger.info(f"V2 shape-spec: no active session, created new: {session_id}")
        else:
            logger.info(f"V2 shape-spec: resuming session {session_id}")

    executor = _create_chat_executor_or_400(
        company=request.company,
        project=request.project,
        workspace_dir=API_WORKSPACE_DIR,
        anthropic_api_key=anthropic_api_key,
        session_uuid=session_id,
    )

    if is_new_session:
        executor.clear_session()

    async def event_generator():
        if git_pull_error:
            yield f"data: {json.dumps({'type': 'git_error', 'message': git_pull_error})}\n\n"

        event_queue = asyncio.Queue()
        _SENTINEL = object()
        loop = asyncio.get_event_loop()
        # Set on client disconnect — see autoresearch:debug 260504-1301 #1.
        stop_flag = threading.Event()

        def _run_sync():
            try:
                for event in executor.stream_message(
                    request.message, is_new_session=is_new_session, command_name="shape-spec"
                ):
                    if stop_flag.is_set():
                        break
                    loop.call_soon_threadsafe(event_queue.put_nowait, event)
            except Exception as e:
                loop.call_soon_threadsafe(event_queue.put_nowait, {"type": "error", "message": str(e)})
            finally:
                loop.call_soon_threadsafe(event_queue.put_nowait, _SENTINEL)

        try:
            loop.run_in_executor(None, _run_sync)

            try:
                while True:
                    event = await event_queue.get()
                    if event is _SENTINEL:
                        break
                    event_type = event.get("type")

                    # Folder event: branch creation deferred to orchestration completion
                    if event_type in {"questions", "folder", "error", "message"}:
                        yield f"data: {json.dumps(event)}\n\n"
            finally:
                stop_flag.set()

        except Exception as e:
            logger.error(f"V2 shape-spec streaming error: {e}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/api/v2/plan-product/stream",
    tags=["Git Integration"],
    summary="Conversational plan-product with git integration (V2)",
    responses={
        400: {"description": "Missing prerequisites or git config"},
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
    response_description="Server-Sent Events stream",
)
async def plan_product_stream_v2(
    request: ChatMessageRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """
    Git-integrated plan-product streaming. After completion, commits output
    to a feature branch and creates a PR.

    Same SSE interface as V1, with git preconditions enforced.
    """
    from .. import API_WORKSPACE_DIR, _require_git_manager

    gm = _require_git_manager(request.company, request.project)

    anthropic_api_key = require_credentials()

    is_new_session = False
    if request.session_mode == "new":
        session_id = create_active_session(API_WORKSPACE_DIR, request.company, request.project)
        is_new_session = True
    else:
        session_id = get_active_session(API_WORKSPACE_DIR, request.company, request.project)
        if not session_id:
            session_id = create_active_session(API_WORKSPACE_DIR, request.company, request.project)
            is_new_session = True

    executor = _create_chat_executor_or_400(
        company=request.company,
        project=request.project,
        workspace_dir=API_WORKSPACE_DIR,
        anthropic_api_key=anthropic_api_key,
        session_uuid=session_id,
    )

    if is_new_session:
        executor.clear_session()

    async def event_generator():
        event_queue = asyncio.Queue()
        _SENTINEL = object()
        loop = asyncio.get_event_loop()
        # Set on client disconnect — see autoresearch:debug 260504-1301 #1.
        stop_flag = threading.Event()

        def _run_sync():
            try:
                for event in executor.stream_message(
                    request.message, is_new_session=is_new_session, command_name="plan-product"
                ):
                    if stop_flag.is_set():
                        break
                    loop.call_soon_threadsafe(event_queue.put_nowait, event)
            except Exception as e:
                loop.call_soon_threadsafe(event_queue.put_nowait, {"type": "error", "message": str(e)})
            finally:
                loop.call_soon_threadsafe(event_queue.put_nowait, _SENTINEL)

        try:
            loop.run_in_executor(None, _run_sync)

            try:
                while True:
                    event = await event_queue.get()
                    if event is _SENTINEL:
                        # Stream complete — commit plan-product output to feature branch
                        from ..git_workflow import apply_git_workflow
                        try:
                            # Saved-provider fallback (2026-07-27) — see
                            # load_git_config_with_project_fallback.
                            git_config = load_git_config_with_project_fallback(
                                [gm.project_dir]
                            )
                            gm.pull_latest()
                        except (GitManagerError, GitConfigError) as e:
                            logger.error(f"Git commit/push failed for plan-product: {e}")
                            yield f"data: {json.dumps({'type': 'git_error', 'message': f'Git operations failed: {e}'})}\n\n"
                            break

                        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                        branch = f"feature/plan-product-{date_str}"
                        # Use a simple namespace as response_obj so
                        # apply_git_workflow can capture errors without
                        # touching the SSE event stream directly.
                        from types import SimpleNamespace
                        sse_response = SimpleNamespace(errors=[])
                        apply_git_workflow(
                            gm=gm,
                            git_config=git_config,
                            branch=branch,
                            commit_msg="feature: plan-product output",
                            pr_title=f"feature: plan-product for {request.project}",
                            pr_body="Plan-product output: mission.md, roadmap.md, tech-stack.md",
                            response_obj=sse_response,
                            error_label="plan-product",
                        )
                        for err in sse_response.errors:
                            yield f"data: {json.dumps({'type': 'git_error', 'message': f'Git operations failed: {err}'})}\n\n"
                        break
                    event_type = event.get("type")

                    if event_type in {"questions", "folder", "error", "message"}:
                        yield f"data: {json.dumps(event)}\n\n"
            finally:
                stop_flag.set()

        except Exception as e:
            logger.error(f"V2 plan-product streaming error: {e}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


# =============================================================================
# V2 History helpers
# =============================================================================

def _build_chat_history(chat_logs_dir: Path) -> ChatHistoryResponse:
    """Build chat history response from log files."""
    messages = []
    if chat_logs_dir.exists():
        for log_file in sorted(chat_logs_dir.glob("*.json")):
            try:
                data = json.loads(log_file.read_text(encoding="utf-8"))
                if isinstance(data, list):
                    messages.extend(data)
                elif isinstance(data, dict):
                    messages.append(data)
            except Exception:
                pass
    return ChatHistoryResponse(messages=messages)


@router.get(
    "/api/v2/shape-spec/history",
    tags=["Git Integration"],
    summary="Get shape-spec conversation history (V2, requires init)",
    response_model=ChatHistoryResponse,
    responses={
        400: {"description": "Project not initialized"},
        401: {"description": "Invalid or missing API key"},
    },
)
async def get_shape_spec_history_v2(
    company: str,
    project: str,
    authenticated: bool = Depends(verify_api_key),
):
    """Get shape-spec conversation history. Requires initialized project."""
    from .. import _require_git_manager, _safe_project_dir
    _require_git_manager(company, project)
    # Validates company/project — see autoresearch:debug 260504-1229 #1.
    project_dir = _safe_project_dir(company, project)
    chat_logs_dir = project_dir / "chat_logs"
    return _build_chat_history(chat_logs_dir)


@router.get(
    "/api/v2/plan-product/history",
    tags=["Git Integration"],
    summary="Get plan-product conversation history (V2, requires init)",
    response_model=ChatHistoryResponse,
    responses={
        400: {"description": "Project not initialized"},
        401: {"description": "Invalid or missing API key"},
    },
)
async def get_plan_product_history_v2(
    company: str,
    project: str,
    authenticated: bool = Depends(verify_api_key),
):
    """Get plan-product conversation history. Requires initialized project."""
    from .. import _require_git_manager, _safe_project_dir
    _require_git_manager(company, project)
    # Validates company/project — see autoresearch:debug 260504-1229 #1.
    project_dir = _safe_project_dir(company, project)
    chat_logs_dir = project_dir / "chat_logs"
    return _build_chat_history(chat_logs_dir)

"""Chat-executor factories.

Per spec `haikai/specs/2026-05-18-api-and-stream-modularize/`
Phase A.1: extracted from `src/api/__init__.py` to shrink the 4500-LOC
file and give the factory chain a clean home.

What lives here:
- `create_chat_executor` — the public dispatcher used by every chat
  endpoint. Reads `CHAT_EXECUTOR` via `_active_backend()` and forwards
  to the chosen backend's `chat_executor_factory`.
- `_build_claude_chat_executor` — the multi-priority body that
  `CHAT_EXECUTOR=claude` routes through (OAuth detection, Claude-CLI
  availability probe, OpenAI fallback, last-resort).
- Re-imports of `ClaudeChatExecutor`, `OAuthChatExecutor`,
  `OpenAIChatExecutor`. `src/api/__init__.py` re-exports these names
  so test code that patches by `src.api.<Class>` stays working.

What does NOT live here:
- `BACKEND_REGISTRY` and `_active_backend` (peer `src/backend_registry`).
- `_build_cli_executor` (peer `src/backend_registry`).
- The Kiro chat factory (`src/backend_registry._build_kiro_chat_executor`).
- The lazy shim that bridges this module to the registry
  (`src/backend_registry._build_claude_chat_executor_shim`).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from ..backend_registry import _active_backend
from ..chat.claude_chat_executor import ClaudeChatExecutor
from ..chat.oauth_chat_executor import OAuthChatExecutor
from ..chat.openai_chat_executor import OpenAIChatExecutor

logger = logging.getLogger(__name__)


def _build_claude_chat_executor(
    company: str,
    project: str,
    workspace_dir,
    anthropic_api_key: str,
    *,
    session_uuid: Optional[str] = None,
    extra_dirs: Optional[list] = None,
):
    """Multi-priority dispatch within the Claude family.

    Called when `CHAT_EXECUTOR=claude`. Picks between
    `ClaudeChatExecutor` (OAuth or regular API key, requires Claude CLI)
    and `OpenAIChatExecutor` (fallback when Claude CLI is unavailable).

    Priority:
    1. OAuth tokens (sk-ant-oat...) → ClaudeChatExecutor (or OpenAI if root)
    2. Claude CLI available → ClaudeChatExecutor
    3. OPENAI_API_KEY set → OpenAIChatExecutor (fallback)
    4. Last resort → ClaudeChatExecutor

    `session_uuid` (keyword-only) is forwarded to the chosen
    executor's constructor; see O3.
    """
    # Root detection — Claude CLI cannot run as root
    _running_as_root = os.getuid() == 0 if hasattr(os, 'getuid') else False

    if "sk-ant-oat" in anthropic_api_key:
        # Opt-in: drive the OAuth/Max token via the Anthropic SDK directly
        # (OAuthChatExecutor) instead of spawning the Claude CLI. The CLI competes
        # with any OUTER Claude Code session for the subscription's concurrency
        # slot (429s the nested orchestration); the SDK path (Bearer + claude-code
        # beta headers) does not. See oauth_chat_executor.py.
        if os.getenv("OAUTH_SDK_EXECUTOR", "false").strip().lower() == "true":
            llm_model = os.getenv("LLM_MODEL", "claude-opus-4-5").strip() or "claude-opus-4-5"
            logger.info(f"Using OAuthChatExecutor (OAUTH_SDK_EXECUTOR=true, model={llm_model}) — OAuth token via SDK, no CLI")
            return OAuthChatExecutor(
                company=company,
                project=project,
                workspace_dir=workspace_dir,
                anthropic_api_key=anthropic_api_key,
                model=llm_model,
                session_uuid=session_uuid,
            )
        # Default: OAuth tokens via the Claude CLI (ClaudeChatExecutor).
        if _running_as_root:
            logger.warning("OAuth token detected but running as root — Claude CLI blocked. Falling back to OpenAI.")
            openai_key = os.getenv('OPENAI_API_KEY')
            if openai_key:
                llm_model = os.getenv('OPENAI_MODEL', 'gpt-4o')
                logger.info(f"Using OpenAIChatExecutor as root fallback (model={llm_model})")
                return OpenAIChatExecutor(
                    company=company,
                    project=project,
                    workspace_dir=workspace_dir,
                    openai_api_key=openai_key,
                    model=llm_model,
                    session_uuid=session_uuid,
                )
        logger.info(f"Using ClaudeChatExecutor for OAuth token (OAuth requires Claude CLI)")
        return ClaudeChatExecutor(
            company=company,
            project=project,
            workspace_dir=workspace_dir,
            anthropic_api_key=anthropic_api_key,
            session_uuid=session_uuid,
            extra_dirs=extra_dirs,
        )

    # Check if Claude CLI is available AND usable (not running as root)
    import platform as _platform
    import shutil as _shutil
    _project_root = Path(__file__).parent.parent.parent
    if _platform.system() == "Windows":
        _claude_cli_path = _project_root / "node_modules" / ".bin" / "claude.cmd"
    else:
        _claude_cli_path = _project_root / "node_modules" / ".bin" / "claude"
    # Check project-local first, then global PATH
    claude_available = _claude_cli_path.exists() or _shutil.which("claude") is not None
    if _running_as_root:
        logger.warning("Running as root — Claude CLI cannot be used (--dangerously-skip-permissions blocked). Falling back.")
        claude_available = False

    if claude_available:
        logger.info(f"Using ClaudeChatExecutor for API key")
        return ClaudeChatExecutor(
            company=company,
            project=project,
            workspace_dir=workspace_dir,
            anthropic_api_key=anthropic_api_key,
            session_uuid=session_uuid,
            extra_dirs=extra_dirs,
        )

    # Fallback to OpenAI if available
    openai_key = os.getenv('OPENAI_API_KEY')
    if openai_key:
        llm_model = os.getenv('OPENAI_MODEL', 'gpt-4o')
        logger.info(f"Claude CLI not available, falling back to OpenAIChatExecutor (model={llm_model})")
        return OpenAIChatExecutor(
            company=company,
            project=project,
            workspace_dir=workspace_dir,
            openai_api_key=openai_key,
            model=llm_model,
            session_uuid=session_uuid,
        )

    # Last resort: try Claude CLI executor anyway
    logger.warning("No suitable executor found, trying ClaudeChatExecutor as last resort")
    return ClaudeChatExecutor(
        company=company,
        project=project,
        workspace_dir=workspace_dir,
        anthropic_api_key=anthropic_api_key,
        session_uuid=session_uuid,
        extra_dirs=extra_dirs,
    )


def create_chat_executor(
    company: str,
    project: str,
    workspace_dir,
    anthropic_api_key: str,
    *,
    session_uuid: Optional[str] = None,
    extra_dirs: Optional[list] = None,
):
    """Public chat-executor factory — dispatches via `BACKEND_REGISTRY`.

    `CHAT_EXECUTOR` is required and selects the backend. Per-backend
    construction logic lives in the descriptor's `chat_executor_factory`.

    `session_uuid` (keyword-only) lets callers resume a specific
    session (e.g., recovery paths reading from `active_session.json`).
    When None, each backend's constructor derives a deterministic v5
    UUID from `(company, project)`. See O3 in
    `debug/260518-0633-executor-smell-taxonomy/findings.md`.

    `extra_dirs` (keyword-only) is the polyrepo per-folder mount list.
    Each entry becomes a ``--add-dir`` flag on the Claude CLI command.
    The orchestrator passes one entry per repo in ``coordination.yaml``;
    backends that don't honour ``--add-dir`` (e.g. Kiro today) ignore it.
    """
    return _active_backend().chat_executor_factory(
        company, project, workspace_dir, anthropic_api_key,
        session_uuid=session_uuid,
        extra_dirs=extra_dirs,
    )

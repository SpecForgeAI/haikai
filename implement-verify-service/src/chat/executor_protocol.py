"""Structural Protocols for chat and CLI executors.

These are the *contracts* the API factories rely on. Implementations
satisfy them structurally — no inheritance required — but listing them
in one place gives callers a single source of truth for "what methods
must exist on any executor I receive."

If you add a new backend (a third `XxxChatExecutor` or `XxxCLIExecutor`),
make sure it implements every method on the relevant Protocol. The
anti-pattern guard tests check this for the registered backends.

Construction note:
    Protocols intentionally omit `__init__` because constructor
    signatures diverge today (e.g., `OpenAIChatExecutor` takes
    `openai_api_key, model`). The factory in `src.api.__init__`
    handles per-backend construction; the Protocol only constrains the
    surface that callers reach for after construction.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Generator, Optional, Protocol


class ChatExecutorProtocol(Protocol):
    """Surface every chat executor must implement.

    Used by API endpoints (`api/__init__.py`) and the orchestrator
    (`haikai_orchestrator.py`) after the factory returns an instance.
    """

    def stream_message(
        self,
        message: str,
        is_new_session: bool = False,
        command_name: str = "shape-spec",
    ) -> Generator[Dict[str, Any], None, None]:
        """Stream a chat turn. Yields `{type, ...}` event dicts."""
        ...

    def get_session_file(self) -> Path:
        """Return the absolute path to the on-disk session transcript."""
        ...

    def clear_session(self) -> bool:
        """Reset the executor's session state. Returns True on success."""
        ...

    def persist_session_to_spec(self, spec_name: str) -> None:
        """Save the active session into the spec folder for later resume.

        Called from orchestration handlers and the shape-spec endpoint.
        Backends that don't track resumable sessions (e.g., OpenAI,
        OAuth-only) should log a warning and return — never raise.
        """
        ...

    def restore_session_from_spec(self) -> Optional[str]:
        """Restore a previously-persisted session for this spec.

        Returns the session id on success, None when nothing was found
        or the backend doesn't support session resume. Must not raise.
        """
        ...


class CLIExecutorProtocol(Protocol):
    """Surface every non-interactive CLI executor must implement.

    Used by API batch handlers and the orchestrator's command runner.
    """

    def execute(
        self,
        command: str,
        system_prompt: Optional[str] = None,
        timeout: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Run one CLI command and return the result.

        Result dict must contain at least:
            success: bool
            return_code: int
            stdout: str
            stderr: str
            execution_time: float
            timestamp: str (ISO)
            command: str
        """
        ...

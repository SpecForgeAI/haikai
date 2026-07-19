"""Executor-aware startup environment checks for the debug entrypoints.

The debug entrypoints (`debug_api.py` / `debug_worker.py`) print an
environment check at startup. Historically they hardcoded
``ANTHROPIC_API_KEY`` as required, which is a false positive whenever the
active ``CHAT_EXECUTOR`` backend brings its own auth (``kiro`` routes
through KiroChatExecutor with ``brings_own_auth=True`` — kiro-cli SSO —
and the API/orchestration gates already skip the key via
``backend_registry._credentials_satisfied``). The startup check was the
one place NOT consulting the registry.

This helper is the single source of truth for the startup check's view of
that requirement. Per the helper-exists-sibling-missed process rule, both
debug entrypoints consume it and ``tests/test_env_check_executor_aware.py``
guards that no entrypoint reintroduces the hardcoded requirement.
"""
from __future__ import annotations

import os
from typing import Tuple

STRICT_NOTE = "Required for orchestration jobs"


def anthropic_key_requirement() -> Tuple[bool, str]:
    """Return ``(required, note)`` for ``ANTHROPIC_API_KEY`` at startup.

    Not required when the active ``CHAT_EXECUTOR`` backend is flagged
    ``brings_own_auth`` in the backend registry (the note then explains
    why, so the startup banner stays informative rather than silent).

    Conservative in every other case — unset ``CHAT_EXECUTOR``, an
    unrecognized value, or the registry being unimportable in a stripped
    environment all fall back to "required", which is exactly today's
    behavior. The debug scripts must never crash on this check.
    """
    backend_name = os.getenv("CHAT_EXECUTOR", "").strip().lower()
    if backend_name:
        registry = _load_registry()
        descriptor = registry.get(backend_name) if registry is not None else None
        if descriptor is not None and getattr(descriptor, "brings_own_auth", False):
            return (
                False,
                f"not required (CHAT_EXECUTOR={backend_name} brings its own auth)",
            )
    return (True, STRICT_NOTE)


def _load_registry():
    """Import BACKEND_REGISTRY under either sys.path layout the debug
    entrypoints produce (project root on path -> ``src.backend_registry``;
    ``src`` itself on path -> ``backend_registry``). None when neither
    resolves."""
    try:
        from src.backend_registry import BACKEND_REGISTRY
        return BACKEND_REGISTRY
    except Exception:
        pass
    try:
        from backend_registry import BACKEND_REGISTRY  # type: ignore[no-redef]
        return BACKEND_REGISTRY
    except Exception:
        return None

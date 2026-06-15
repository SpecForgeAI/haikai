"""Credentials / config gates used at endpoint entry points.

Per spec `haikai/specs/2026-05-18-api-and-stream-modularize/`
Phase A.2: small helper module that consolidates the missing-API-key
gate pattern previously inlined at 3 endpoints in
`src/api/__init__.py`.

The pattern was:

    config = load_env_config()
    anthropic_api_key = config.get('anthropic_api_key')
    if not _credentials_satisfied(anthropic_api_key):
        raise HTTPException(503, "ANTHROPIC_API_KEY not configured on server")

Replaced by a single call:

    anthropic_api_key = require_credentials()

`_credentials_satisfied` itself lives in `src.backend_registry` — it
already knows whether the active backend brings its own auth (Kiro
SSO) or needs an `ANTHROPIC_API_KEY` (Claude / OAuth tokens / OpenAI
fallback). See backend_registry's docstring for the model.
"""

from __future__ import annotations

from fastapi import HTTPException, status

from ..backend_registry import _credentials_satisfied


def require_credentials() -> str:
    """Return the configured `anthropic_api_key`, raising 503 if absent
    and the active backend doesn't supply its own auth.

    503 (not 500): missing-config is an operator-action error, not a
    server crash — matches the precedent set by `structural_endpoints.py:372`
    and re-confirmed in commit cbb008f.

    The return value may be the empty string when the active backend
    brings its own auth (`CHAT_EXECUTOR=kiro`); callers should pass it
    through to the chat-executor factory which knows what to do with
    an empty key for the kiro path.
    """
    # Lazy import: `load_env_config` still lives in `src.api.__init__`
    # (its move-out is a future Phase A step). Lazy avoids the
    # api → gates → api cycle at module load.
    from . import load_env_config
    config = load_env_config()
    anthropic_api_key = config.get('anthropic_api_key') or ''
    if not _credentials_satisfied(anthropic_api_key):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ANTHROPIC_API_KEY not configured on server",
        )
    return anthropic_api_key

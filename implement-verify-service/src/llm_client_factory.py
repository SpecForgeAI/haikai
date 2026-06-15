"""Build an LLMClient from explicit args + env vars.

Lives outside `src.api` so the CLI (and other non-web callers) can use it
without dragging in the FastAPI app's import-time side effects (job DB,
log files, workspace mkdir).

Raises plain `ValueError` on bad config; web callers translate to
`HTTPException`.
"""
from __future__ import annotations

import os
from typing import Any, Optional


def build_llm_client(
    provider: Optional[str],
    model: Optional[str],
    log_dir: Optional[str],
):
    from src.llm_client import LLMClient

    provider = (provider or os.getenv("LLM_PROVIDER") or "").lower().strip()
    if not provider:
        raise ValueError(
            "no LLM provider configured: pass `provider` in the request or set env `LLM_PROVIDER`"
        )

    model = (model or os.getenv("LLM_MODEL") or "").strip()
    if not model:
        raise ValueError(
            "no LLM model configured: pass `model` in the request or set env `LLM_MODEL`"
        )

    kwargs: dict[str, Any] = {}
    if log_dir:
        kwargs["log_dir"] = log_dir

    if provider == "custom":
        base_url = os.getenv("LLM_BASE_URL")
        if not base_url:
            raise ValueError(
                "provider='custom' requires `LLM_BASE_URL` env var (no code-level default)"
            )
        kwargs["base_url"] = base_url

    return LLMClient(provider=provider, model=model, **kwargs)

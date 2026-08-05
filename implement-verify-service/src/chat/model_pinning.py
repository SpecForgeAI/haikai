"""Per-invocation model pinning for the CLI executors.

Why this exists (2026-07-30 live shakedown):

* **kiro-cli** silently ignored ``settings chat.defaultModel`` — the only
  mechanism it genuinely honors is the ``--model`` flag. Every
  orchestration step (write-spec / create-tasks / implement-tasks /
  git-commit-preparation) is a SEPARATE ``kiro-cli chat --no-interactive``
  process, not a persistent REPL, so an in-band ``/model`` first line
  would not carry across steps either. The flag must ride every spawn.
* **Claude CLI**: ``LLM_MODEL`` was only honoured by the OAuth-SDK and
  OpenAI fallback executors; the Claude-CLI spawn paths never passed a
  model at all, so the ``.env`` model line was silently ignored there.

Resolution rules (shared by all four executor spawn sites):

* Kiro executors read ``KIRO_CHAT_MODEL`` and default to
  ``claude-opus-5`` when unset — the migration orchestration must not
  depend on kiro-cli's login-state default.
* Claude executors read ``LLM_MODEL`` with NO default — when unset the
  CLI's own configured default applies, exactly as before this module.
* An explicit empty value or ``auto`` (case-insensitive) disables
  pinning for that executor.

The resolved model (or the fact that pinning is off) is logged at
executor init so every IVS run log states which model the steps ran on.
"""

from __future__ import annotations

import os
from typing import List, Optional

KIRO_MODEL_ENV = "KIRO_CHAT_MODEL"
KIRO_MODEL_DEFAULT = "claude-opus-5"
# Fallback model when the PRIMARY keeps transiently failing (Robustness R1,
# 2026-08-05): after KIRO_MODEL_FALLBACK_THRESHOLD (default 3) transient
# upstream failures in one run, spawns pin this instead — e.g. claude-opus-5
# flapping server-side falls back to claude-opus-4.8 rather than burning the
# Stage. Empty/`auto` disables the fallback entirely.
KIRO_MODEL_ALTERNATIVE_ENV = "KIRO_CHAT_MODEL_ALTERNATIVE"
KIRO_MODEL_ALTERNATIVE_DEFAULT = "claude-opus-4.8"
CLAUDE_MODEL_ENV = "LLM_MODEL"


def resolve_pinned_model(env_var: str, default: str = "") -> Optional[str]:
    """Resolve the model to pin via ``--model``, or ``None`` for "do not pin".

    ``default`` applies only when the env var is UNSET. Setting the var to
    an empty string or ``auto`` explicitly disables pinning.
    """
    raw = os.environ.get(env_var)
    value = (raw if raw is not None else default).strip()
    if not value or value.lower() == "auto":
        return None
    return value


def kiro_pinned_model() -> Optional[str]:
    """The model every kiro-cli chat spawn pins (default claude-opus-5)."""
    return resolve_pinned_model(KIRO_MODEL_ENV, KIRO_MODEL_DEFAULT)


def kiro_alternative_model() -> Optional[str]:
    """The transient-failure fallback model (default claude-opus-4.8).

    Consumed by the orchestrator's ModelFallbackTracker (see
    src/chat/transient_failure.py) — never pinned directly at spawn unless
    the tracker activated it.
    """
    return resolve_pinned_model(KIRO_MODEL_ALTERNATIVE_ENV, KIRO_MODEL_ALTERNATIVE_DEFAULT)


def claude_pinned_model() -> Optional[str]:
    """The model Claude-CLI spawns pin — only when LLM_MODEL is set."""
    return resolve_pinned_model(CLAUDE_MODEL_ENV, "")


def model_args(model: Optional[str]) -> List[str]:
    """The argv fragment for a resolved model (empty when pinning is off)."""
    return ["--model", model] if model else []


def describe_pinned_model(model: Optional[str]) -> str:
    """Human-readable init-log value: the model, or an explicit 'not pinned'."""
    return model if model else "(not pinned — CLI default applies)"

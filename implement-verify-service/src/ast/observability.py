"""Shared structured trace recorder for V1 and V2 discovery paths.

Both V1's cli-delegated loop and V2's discover() write events here. The
caller (e.g. the 50-repo runner, a test, an LLM CLI tool) reads
`current_trace()` to dump the data wherever they want.

Usage:
    from src.ast.observability import trace_event, current_trace, reset_trace

    reset_trace("my-discovery-run")
    trace_event("tool_call", tool="query_callers", elapsed_ms=42)
    trace_event("llm_call", phase="phase10", tokens=1234)
    events = current_trace()  # list of dicts
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)


# Events live in thread-local state so concurrent runs (e.g. parallel
# subprocess pools) don't trample each other.
_state = threading.local()


def _ensure() -> None:
    if not hasattr(_state, "events"):
        _state.events = []
        _state.run_id = ""
        _state.run_started = 0.0


def reset_trace(run_id: str = "") -> None:
    """Clear the trace and optionally tag it with a run id."""
    _state.events = []
    _state.run_id = run_id
    _state.run_started = time.time()


def trace_event(event_type: str, **fields: Any) -> None:
    """Record one event. Always also logs at INFO level so stdout traces stay
    consistent with the structured stream.

    Examples:
        trace_event("v1_tool_call", tool="query_callers", elapsed_ms=42)
        trace_event("v2_llm_call", phase="phase10", tokens=1234, calls=2)
        trace_event("v2_phase_done", phase="merge", endpoints_in=8, endpoints_out=6)
    """
    _ensure()
    event = {
        "ts":   round(time.time() - _state.run_started, 3) if _state.run_started else 0,
        "type": event_type,
        **fields,
    }
    _state.events.append(event)
    # Mirror to logger as a single-line summary
    summary = " ".join(f"{k}={v}" for k, v in fields.items())
    logger.info(f"[trace:{event_type}] {summary}")


def current_trace() -> list[dict]:
    """Return a copy of the current trace (dump-and-keep)."""
    _ensure()
    return list(_state.events)


def trace_run_id() -> str:
    _ensure()
    return _state.run_id


# ─── Convenience shortcuts used in hot paths ──────────────────────────────

def trace_tool_call(side: str, tool: str, elapsed_ms: int, **extra: Any) -> None:
    """side = 'v1' | 'v2'"""
    trace_event(f"{side}_tool_call", tool=tool, elapsed_ms=elapsed_ms, **extra)


def trace_llm_call(side: str, phase: str, elapsed_s: float,
                    tokens_added: int = 0, calls_added: int = 1, **extra: Any) -> None:
    trace_event(f"{side}_llm_call", phase=phase,
                elapsed_s=round(elapsed_s, 2),
                tokens_added=tokens_added,
                calls_added=calls_added, **extra)


def trace_phase(side: str, phase: str, **extra: Any) -> None:
    trace_event(f"{side}_phase_done", phase=phase, **extra)

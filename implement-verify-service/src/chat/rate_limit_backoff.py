"""Shared 429 rate-limit backoff + telemetry.

One source of truth for how the executors ride out an Anthropic 429 (rate) or
529 (overloaded): time-budgeted exponential backoff with FULL jitter, honoring a
server ``Retry-After`` when present, bounded by a per-sleep cap, a total
wall-clock budget, and an attempt backstop — so it's patient (minutes, not ~45s)
but never silent and never infinite.

Both the CLI-chat lane (preflight probe) and the SDK lane (reactive retry) drive
their own loop (one probes ahead, one catches an exception — they can't share a
loop) but MUST use these shared primitives so the curve, the budget, and the
emitted signal stay identical. `next_wait` + `rate_limit_signal` are that shared
core; `tests/test_anti_pattern_guards`-style coverage lives in
tests/chat/test_rate_limit_backoff.py.

Best practices baked in: exponential + full jitter (no synchronized retry
storms), honor Retry-After, bounded, and a VISIBLE signal on every attempt
(WARNING while retrying, ERROR on give-up) plus a structured event the caller
streams so progress/UI shows "429 — retrying in Ns".
"""

import logging
import os
import random

logger = logging.getLogger(__name__)

BASE_SECONDS = 2.0
FACTOR = 2.0
PER_SLEEP_CAP_SECONDS = 60.0   # one sleep never exceeds this
ATTEMPT_BACKSTOP = 30          # hard ceiling so it can never spin forever
_DEFAULT_BUDGET_SECONDS = 600.0  # 10 min of patient retries before failing


def budget_seconds() -> float:
    """Total wall-clock budget for retries (env-overridable, never silent-fails)."""
    raw = os.getenv("RATE_LIMIT_MAX_ELAPSED_SECONDS")
    if not raw:
        return _DEFAULT_BUDGET_SECONDS
    try:
        v = float(raw)
        return v if v > 0 else _DEFAULT_BUDGET_SECONDS
    except ValueError:
        logger.warning("Invalid RATE_LIMIT_MAX_ELAPSED_SECONDS=%r; using %.0fs",
                       raw, _DEFAULT_BUDGET_SECONDS)
        return _DEFAULT_BUDGET_SECONDS


def next_wait(attempt: int, retry_after: float | None = None,
              base: float = BASE_SECONDS, factor: float = FACTOR,
              cap: float = PER_SLEEP_CAP_SECONDS) -> tuple[float, bool]:
    """Backoff for `attempt` (1-based). Returns (wait_seconds, retry_after_honored).

    A positive server ``Retry-After`` wins (capped at `cap`); otherwise it's
    exponential `base * factor**(attempt-1)` capped at `cap`, with FULL jitter
    (uniform 0..ceiling) to avoid synchronized retries.
    """
    if retry_after is not None and retry_after > 0:
        return min(float(retry_after), cap), True
    ceiling = min(cap, base * (factor ** (max(1, attempt) - 1)))
    return ceiling * random.random(), False


def classify(exc: BaseException) -> int | None:
    """Return 429 (rate) or 529 (overloaded) if `exc` is a retryable rate/overload
    error, else None. Works off the Anthropic SDK's `status_code` with a class-name
    fallback so we don't hard-import the SDK error types here."""
    status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
    if status in (429, 529):
        return int(status)
    name = type(exc).__name__
    if name == "RateLimitError":
        return 429
    if name == "OverloadedError":
        return 529
    return None


def retry_after_of(exc: BaseException) -> float | None:
    """Pull a numeric ``Retry-After`` (seconds) off the error's response headers."""
    resp = getattr(exc, "response", None)
    headers = getattr(resp, "headers", None) if resp is not None else None
    if not headers:
        return None
    try:
        ra = headers.get("retry-after")
        return float(ra) if ra is not None else None
    except (TypeError, ValueError):
        return None


def rate_limit_signal(attempt: int, wait: float, elapsed: float, budget: float,
                      retry_after_honored: bool, retrying: bool,
                      status: int = 429) -> dict:
    """Build the structured event AND log it. WARNING while retrying (so a 429 is
    never hidden), ERROR when we give up after the budget."""
    evt = {
        "type": "rate_limited",
        "status": status,
        "attempt": attempt,
        "elapsed_s": round(elapsed, 1),
        "budget_s": round(budget, 1),
        "next_retry_in_s": round(wait, 1) if retrying else None,
        "retry_after_honored": retry_after_honored,
        "retrying": retrying,
    }
    if retrying:
        logger.warning(
            "%d rate-limited (attempt %d, %.1fs/%.0fs elapsed) — retrying in %.1fs%s",
            status, attempt, elapsed, budget, wait,
            " [Retry-After]" if retry_after_honored else "",
        )
    else:
        logger.error(
            "%d rate-limited (attempt %d) — gave up after %.1fs (budget %.0fs)",
            status, attempt, elapsed, budget,
        )
    return evt

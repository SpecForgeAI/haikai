"""Transient-failure classification + model fallback (Robustness R1, 2026-08-05).

Live incident: a 13.5s Kiro-backend blip (``InternalServerException``,
kiro-cli's own internal retries exhausted, exit 0, no spec.md written)
failed one step, which failed the spec, which stopped a 12-spec Stage run.
The orchestrator had NO retry anywhere and no notion of WHY a step failed.

This module is the single source of truth for:

* :func:`is_transient_failure_text` / :func:`classify_step_failure` — is a
  step failure a TRANSIENT UPSTREAM condition (backend 5xx, throttling,
  timeouts, "having trouble responding") that a retry + cool-off can absorb,
  as opposed to a REAL failure (incoherent spec, unticked tasks, questions
  in a non-interactive run) that retrying would only mask?
* :class:`ModelFallbackTracker` — per-RUN accounting of transient failures
  attributed to the pinned model. After ``threshold`` (default 3) transient
  failures the tracker activates the ALTERNATIVE model
  (``KIRO_CHAT_MODEL_ALTERNATIVE``, see model_pinning.py) for every
  subsequent spawn in the run — e.g. claude-opus-5 flapping upstream falls
  back to claude-opus-4.8 instead of burning the whole Stage.

Failure classes on the wire (build-results callback ``failure_class``):
  ``transient_upstream`` — retry/cool-off/fallback territory;
  ``real``              — the work itself failed; escalate to a human.
"""
from __future__ import annotations

import logging
import os
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

#: Case-insensitive substrings that mark a TRANSIENT upstream condition.
#: Sources: the 2026-08-05 Kiro incident text, kiro-cli banner phrasing,
#: Anthropic/AWS error vocabulary, and the socket-level usual suspects.
TRANSIENT_SIGNATURES = (
    "internalservererror",
    "internalserverexception",
    "having trouble responding",
    "encountered an unexpected error when processing the request",
    "serviceunavailable",
    "service unavailable",
    "service is temporarily",
    "overloaded",
    "throttl",
    "rate limit",
    "too many requests",
    "error 429",
    "code: 429",
    "error 529",
    "code: 529",
    "timed out",
    "timeoutexpired",
    "connection reset",
    "connection aborted",
    "temporarily unavailable",
    "bedrock is unable",
    "modeltimeout",
)

#: How much trailing output to consider — transient banners appear at the
#: END of a stream (after any real content the model produced first).
OUTPUT_TAIL_CHARS = 6_000

FAILURE_CLASS_TRANSIENT = "transient_upstream"
FAILURE_CLASS_REAL = "real"


def is_transient_failure_text(text: str) -> bool:
    """True when ``text`` carries any known transient-upstream signature."""
    lowered = (text or "").lower()
    return any(sig in lowered for sig in TRANSIENT_SIGNATURES)


def classify_step_failure(errors: Iterable[str], output_tail: str = "") -> str:
    """Classify a FAILED step from its error events + trailing output.

    The tail matters for the silent-lie shape: kiro-cli can print the
    transient banner to STDOUT and exit 0, so the only evidence lives in
    the collected content, not the error events.
    """
    joined = "\n".join(errors or [])
    if is_transient_failure_text(joined) or is_transient_failure_text(
        (output_tail or "")[-OUTPUT_TAIL_CHARS:]
    ):
        return FAILURE_CLASS_TRANSIENT
    return FAILURE_CLASS_REAL


# ---------------------------------------------------------------------------
# Retry knobs (env-tunable; parsed defensively)
# ---------------------------------------------------------------------------

STEP_RETRY_MAX_RETRIES_ENV = "STEP_RETRY_MAX_RETRIES"
STEP_RETRY_BACKOFF_ENV = "STEP_RETRY_BACKOFF_SECONDS"
MODEL_FALLBACK_THRESHOLD_ENV = "KIRO_MODEL_FALLBACK_THRESHOLD"


def step_retry_max_retries(default: int = 2) -> int:
    """Extra attempts after the first (2 => up to 3 tries per step)."""
    try:
        value = int(os.environ.get(STEP_RETRY_MAX_RETRIES_ENV, default))
    except (TypeError, ValueError):
        return default
    return max(0, value)


def step_retry_backoff_seconds(default: str = "30,120") -> list:
    """Cool-off schedule between tries; the last entry repeats."""
    raw = os.environ.get(STEP_RETRY_BACKOFF_ENV, default)
    delays = []
    for part in str(raw).split(","):
        try:
            delays.append(max(0.0, float(part.strip())))
        except (TypeError, ValueError):
            continue
    return delays or [30.0, 120.0]


def model_fallback_threshold(default: int = 3) -> int:
    try:
        value = int(os.environ.get(MODEL_FALLBACK_THRESHOLD_ENV, default))
    except (TypeError, ValueError):
        return default
    return max(1, value)


class ModelFallbackTracker:
    """Per-run transient-failure accounting with model fallback.

    ``record_transient_failure()`` after every transiently-failed try; once
    the count reaches ``threshold`` AND a distinct alternative model exists,
    :meth:`active_model` returns the alternative for the rest of the run.
    The swap is one-way within a run (no flapping back), and a run starts
    fresh — a healthy day never sees the alternative.
    """

    def __init__(
        self,
        primary: Optional[str],
        alternative: Optional[str],
        threshold: Optional[int] = None,
    ) -> None:
        self.primary = primary
        self.alternative = alternative
        self.threshold = threshold if threshold is not None else model_fallback_threshold()
        self.transient_failures = 0
        self._announced = False

    @property
    def fallback_active(self) -> bool:
        return (
            self.transient_failures >= self.threshold
            and bool(self.alternative)
            and self.alternative != self.primary
        )

    def record_transient_failure(self) -> None:
        self.transient_failures += 1
        if self.fallback_active and not self._announced:
            self._announced = True
            logger.warning(
                "Model fallback ACTIVATED: %s transient failure(s) on %r — "
                "subsequent spawns pin the alternative %r "
                "(KIRO_CHAT_MODEL_ALTERNATIVE).",
                self.transient_failures,
                self.primary,
                self.alternative,
            )

    def active_model(self) -> Optional[str]:
        return self.alternative if self.fallback_active else self.primary

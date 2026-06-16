"""Haikai workflow trace logger — see docs/trace-logging.md.

Self-contained, ZERO external deps. This is the Python sibling of the canonical
Node helper (`api-migration-validation-service/src/trace.ts`) and the Java
`HaikaiTrace`. The emitted line format is IDENTICAL across all three stacks so
they interleave cleanly in the one shared trace file and `scripts/
haikai-trace-summarize.mjs` can group them together.

OFF by default. Controlled by (read ONCE at import):
  HAIKAI_TRACE       = off | summary | detail   (default off)
  HAIKAI_TRACE_FILE  = path                      (default ~/.haikai/trace.log)

Two tiers, one shared file (atomic single-line O_APPEND writes so concurrent
service processes interleave cleanly):
  [SUMMARY]  human prose, one glyph-led line per step  (tier >= summary)
  [detail]   event + compact JSON for diagnosis        (tier == detail)

Tracing must NEVER raise — every public call is wrapped so a trace failure can
never break the caller's logic. When off it is a full no-op (no fs touch, no
string build, no JSON serialize).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping, Optional

# --- env read ONCE at import -------------------------------------------------

_RAW_TIER = (os.environ.get("HAIKAI_TRACE") or "off").lower()
_TIER = _RAW_TIER if _RAW_TIER in ("summary", "detail") else "off"

_RAW_FILE = os.environ.get("HAIKAI_TRACE_FILE")
if _RAW_FILE and _RAW_FILE.strip():
    _FILE = Path(os.path.expanduser(_RAW_FILE))
else:
    _FILE = Path(os.path.expanduser("~")) / ".haikai" / "trace.log"

# Correlation ids, emitted in this EXACT stable order; only set keys appear.
_CORR_ORDER = ("run", "session", "job", "bug", "project", "arch")

_GLYPH_STEP = "▶"  # ▶ start/step
_GLYPH_OK = "✓"    # ✓ ok
_GLYPH_WARN = "⚠"  # ⚠ warn
_GLYPH_FAIL = "✗"  # ✗ fail

_dir_ensured = False


def _ensure_dir() -> None:
    global _dir_ensured
    if _dir_ensured:
        return
    try:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass  # ignore — tracing must never throw
    _dir_ensured = True


def _now_ts() -> str:
    """ISO-8601 UTC, millisecond precision: 2026-06-16T16:11:39.335Z.

    Matches the Node helper's `new Date().toISOString()` byte-for-byte:
    always exactly 3 fractional digits, trailing `Z`. We truncate micros to
    millis (not round) — same as JS.
    """
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _fmt_corr(corr: Optional[Mapping[str, object]]) -> str:
    """Space-joined `key=value` correlation pairs in stable order; only set
    keys; values containing whitespace are double-quoted."""
    if not corr:
        return ""
    parts = []
    for k in _CORR_ORDER:
        val = corr.get(k)
        if val is None or val == "":
            continue
        s = str(val)
        parts.append(f'{k}="{s}"' if any(c.isspace() for c in s) else f"{k}={s}")
    return " ".join(parts)


def _emit(parts) -> None:
    """Join non-empty parts with TWO spaces and append one line atomically.

    Append mode uses O_APPEND, so concurrent multi-process writers interleave
    cleanly at line granularity. Never raises.
    """
    _ensure_dir()
    line = "  ".join(p for p in parts if p)
    try:
        with open(_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass  # never throw from tracing


class Tracer:
    """A tracer bound to a service name (see the registry in the doc)."""

    __slots__ = ("_service", "_off", "_detail_on")

    def __init__(self, service: str):
        self._service = service
        self._off = _TIER == "off"
        self._detail_on = _TIER == "detail"

    @property
    def enabled(self) -> bool:
        return not self._off

    def summary(self, glyph: str, message: str, corr: Optional[Mapping[str, object]] = None) -> None:
        if self._off:
            return
        try:
            _emit([_now_ts(), "[SUMMARY]", self._service, _fmt_corr(corr), f"{glyph} {message}"])
        except Exception:
            pass

    def step(self, message: str, corr: Optional[Mapping[str, object]] = None) -> None:
        self.summary(_GLYPH_STEP, message, corr)

    def ok(self, message: str, corr: Optional[Mapping[str, object]] = None) -> None:
        self.summary(_GLYPH_OK, message, corr)

    def warn(self, message: str, corr: Optional[Mapping[str, object]] = None) -> None:
        self.summary(_GLYPH_WARN, message, corr)

    def fail(self, message: str, corr: Optional[Mapping[str, object]] = None) -> None:
        self.summary(_GLYPH_FAIL, message, corr)

    def detail(
        self,
        event: str,
        data: Optional[Mapping[str, object]] = None,
        corr: Optional[Mapping[str, object]] = None,
    ) -> None:
        if not self._detail_on:
            return
        try:
            # Merge corr ids into the JSON so a detail line is self-contained.
            merged: dict = {}
            if corr:
                for k in _CORR_ORDER:
                    v = corr.get(k)
                    if v is not None and v != "":
                        merged[k] = v
            if data:
                merged.update(data)
            try:
                payload = json.dumps(merged, separators=(",", ":"), ensure_ascii=False)
            except Exception:
                payload = '{"_traceError":"unserializable"}'
            _emit([_now_ts(), "[detail]", self._service, _fmt_corr(corr), f"{event} {payload}"])
        except Exception:
            pass

    def run_header(
        self,
        run_id: str,
        project: Optional[str] = None,
        arch: Optional[str] = None,
    ) -> None:
        if self._off:
            return
        try:
            p = f' project="{project}"' if project else ""
            a = f' arch="{arch}"' if arch else ""
            # Leading blank line delimits runs in the shared append-only file.
            _emit([f"\n=== HAIKAI TRACE  run={run_id}{p}{a}  {_now_ts()} ==="])
        except Exception:
            pass


def tracer(service: str) -> Tracer:
    """Build a tracer bound to a service name (e.g. ``tracer("impl-verify")``)."""
    return Tracer(service)

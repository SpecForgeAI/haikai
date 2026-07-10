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

Predicate self-scoring layer (rides the SUMMARY tier; greppable markers
HAIKAI_PREDICATE / HAIKAI_STAGE_START / HAIKAI_SCORECARD / HAIKAI_CONFIG) —
same wire shapes as the Node helper; see
agent-os/planning/2026-07-10-predicate-run-judging-design.md.
"""

from __future__ import annotations

import json
import os
import threading
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
    # Default matches docs/trace-logging.md (~/.haikai/trace.log). The old
    # hardcoded C:\dev\data\haikai-trace.log default was a bug — the doc was
    # never implemented (fixed 2026-07-10, predicate-run-judging batch).
    _FILE = Path.home() / ".haikai" / "trace.log"

# Correlation ids, emitted in this EXACT stable order; only set keys appear.
_CORR_ORDER = ("run", "session", "job", "bug", "project", "arch")

_GLYPH_STEP = "▶"  # ▶ start/step
_GLYPH_OK = "✓"    # ✓ ok
_GLYPH_WARN = "⚠"  # ⚠ warn
_GLYPH_FAIL = "✗"  # ✗ fail

# Predicate self-scoring tally, per-process, keyed by the stage prefix of the
# predicate id ("SCAN.EDGE.03" tallies under "SCAN") — no ambient current-stage
# state, so concurrent worker threads can't mis-attribute a predicate.
_TALLY: dict = {}
_TALLY_LOCK = threading.Lock()
# Caps keep predicate/scorecard lines bounded however hot a failing loop gets.
_SCORECARD_FAILED_CAP = 25
_SCORECARD_ACTUAL_CAP = 160
_PREDICATE_TEXT_CAP = 400

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


def _stage_of(pred_id: str) -> str:
    """Stage a predicate id belongs to: the prefix before the first ``.``."""
    dot = pred_id.find(".")
    return pred_id[:dot] if dot > 0 else pred_id


def _cap_text(s, n: int) -> str:
    s = "" if s is None else str(s)
    return s[:n] + "…" if len(s) > n else s


def _corr_map(corr: Optional[Mapping[str, object]]) -> dict:
    """Corr as a plain dict (stable key order, only set keys) for embedding in JSON."""
    out: dict = {}
    if corr:
        for k in _CORR_ORDER:
            v = corr.get(k)
            if v is not None and v != "":
                out[k] = str(v)
    return out


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

    def predicate(
        self,
        pred_id: str,
        title: str,
        ok: bool,
        expected: str,
        actual: str,
        corr: Optional[Mapping[str, object]] = None,
    ) -> None:
        """Emit a HAIKAI_PREDICATE line (pass/fail from ``ok``) and tally it
        for the stage scorecard."""
        self._emit_predicate(pred_id, title, "pass" if ok else "fail", expected, actual, corr)

    def predicate_skip(
        self,
        pred_id: str,
        title: str,
        why: str,
        corr: Optional[Mapping[str, object]] = None,
    ) -> None:
        """Emit a skipped HAIKAI_PREDICATE — the check was not exercised this
        run; ``why`` says why."""
        self._emit_predicate(pred_id, title, "skip", "", why, corr)

    def _emit_predicate(self, pred_id, title, verdict, expected, actual, corr) -> None:
        if self._off:
            return
        try:
            with _TALLY_LOCK:
                t = _TALLY.setdefault(
                    _stage_of(pred_id), {"pass": 0, "fail": 0, "skip": 0, "failed": []}
                )
                t[verdict] += 1
                if verdict == "fail" and len(t["failed"]) < _SCORECARD_FAILED_CAP:
                    t["failed"].append(
                        {"id": pred_id, "actual": _cap_text(actual, _SCORECARD_ACTUAL_CAP)}
                    )
            payload: dict = {
                "id": pred_id,
                "title": title,
                "verdict": verdict,
                "expected": _cap_text(expected, _PREDICATE_TEXT_CAP),
                "actual": _cap_text(actual, _PREDICATE_TEXT_CAP),
            }
            cj = _corr_map(corr)
            if cj:
                payload["corr"] = cj
            glyph = (
                _GLYPH_OK if verdict == "pass"
                else _GLYPH_FAIL if verdict == "fail"
                else _GLYPH_WARN
            )
            body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
            _emit([_now_ts(), "[SUMMARY]", self._service, _fmt_corr(corr),
                   f"{glyph} HAIKAI_PREDICATE {body}"])
        except Exception:
            pass  # never throw from tracing

    def stage_start(self, stage: str, corr: Optional[Mapping[str, object]] = None) -> None:
        """Emit the HAIKAI_STAGE_START banner (absence detection)."""
        if self._off:
            return
        try:
            body = json.dumps({"stage": stage}, separators=(",", ":"), ensure_ascii=False)
            _emit([_now_ts(), "[SUMMARY]", self._service, _fmt_corr(corr),
                   f"{_GLYPH_STEP} HAIKAI_STAGE_START {body}"])
        except Exception:
            pass

    def stage_end(self, stage: str, corr: Optional[Mapping[str, object]] = None) -> None:
        """Emit the stage's HAIKAI_SCORECARD — per-stage tally plus the
        process-cumulative totals; doubles as the stage-END banner."""
        if self._off:
            return
        try:
            with _TALLY_LOCK:
                t = _TALLY.get(stage) or {"pass": 0, "fail": 0, "skip": 0, "failed": []}
                pass_n, fail_n, skip_n = t["pass"], t["fail"], t["skip"]
                failed = list(t["failed"])
                cum = {"pass": 0, "fail": 0, "skip": 0}
                for v in _TALLY.values():
                    cum["pass"] += v["pass"]
                    cum["fail"] += v["fail"]
                    cum["skip"] += v["skip"]
            payload = {
                "stage": stage,
                "service": self._service,
                "pass": pass_n,
                "fail": fail_n,
                "skip": skip_n,
                "failed": failed,
                "cumulative": cum,
            }
            glyph = _GLYPH_FAIL if fail_n else _GLYPH_OK
            body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
            _emit([_now_ts(), "[SUMMARY]", self._service, _fmt_corr(corr),
                   f"{glyph} HAIKAI_SCORECARD {body}"])
        except Exception:
            pass

    def config_header(
        self,
        config: Optional[Mapping[str, object]] = None,
        corr: Optional[Mapping[str, object]] = None,
    ) -> None:
        """Emit the startup HAIKAI_CONFIG header. Pass booleans/counts only —
        never secret values."""
        if self._off:
            return
        try:
            payload: dict = {"service": self._service}
            if config:
                payload.update(config)
            body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
            _emit([_now_ts(), "[SUMMARY]", self._service, _fmt_corr(corr),
                   f"{_GLYPH_STEP} HAIKAI_CONFIG {body}"])
        except Exception:
            pass


def tracer(service: str) -> Tracer:
    """Build a tracer bound to a service name (e.g. ``tracer("impl-verify")``)."""
    return Tracer(service)

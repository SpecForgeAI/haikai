"""Focused tests for the Haikai trace logger (src/trace.py).

The line format MUST match the canonical Node helper
(`api-migration-validation-service/src/trace.ts`) and the contract in
`docs/trace-logging.md` byte-for-byte, so they interleave in the one shared file
and `scripts/haikai-trace-summarize.mjs` can parse all stacks uniformly.

`src.trace` reads HAIKAI_TRACE / HAIKAI_TRACE_FILE ONCE at import. We therefore
set the env then `importlib.reload(trace)` inside each test so the module picks
up the test's configuration.
"""

from __future__ import annotations

import importlib
import re

import pytest

import src.trace as trace_mod


def _reload(monkeypatch, tier, path):
    """Reload src.trace with a chosen tier + file, returning the fresh module."""
    if tier is None:
        monkeypatch.delenv("HAIKAI_TRACE", raising=False)
    else:
        monkeypatch.setenv("HAIKAI_TRACE", tier)
    if path is None:
        monkeypatch.delenv("HAIKAI_TRACE_FILE", raising=False)
    else:
        monkeypatch.setenv("HAIKAI_TRACE_FILE", str(path))
    return importlib.reload(trace_mod)


# ISO-8601 UTC, millisecond precision, trailing Z — EXACTLY 3 fractional digits.
TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


def test_off_is_full_noop(tmp_path, monkeypatch):
    f = tmp_path / "trace.log"
    t = _reload(monkeypatch, "off", f).tracer("impl-verify")
    assert t.enabled is False
    t.step("should not write", {"project": "P"})
    t.ok("nope")
    t.detail("evt", {"k": "v"}, {"project": "P"})
    t.run_header("run-1", project="P")
    # OFF must never touch the filesystem.
    assert not f.exists()


def test_default_env_is_off(tmp_path, monkeypatch):
    # No HAIKAI_TRACE set at all -> off.
    f = tmp_path / "trace.log"
    mod = _reload(monkeypatch, None, f)
    t = mod.tracer("impl-verify")
    assert t.enabled is False
    t.step("x")
    assert not f.exists()


def test_summary_line_format(tmp_path, monkeypatch):
    f = tmp_path / "trace.log"
    t = _reload(monkeypatch, "summary", f).tracer("impl-verify")
    t.step("orchestration started — 2 specs", {"project": "SampleSvc SVC DB Migration", "job": "job-7"})

    line = f.read_text(encoding="utf-8").splitlines()[0]
    # Split on the TWO-space separator the contract mandates.
    parts = line.split("  ")
    assert len(parts) == 5, parts
    ts, tier, service, corr, body = parts
    assert TS_RE.match(ts), ts
    assert tier == "[SUMMARY]"
    assert service == "impl-verify"
    # Correlation: stable order, quote values with spaces, only-set keys.
    assert corr == 'job=job-7 project="SampleSvc SVC DB Migration"'
    assert body == "▶ orchestration started — 2 specs"


def test_corr_key_order_and_only_set(tmp_path, monkeypatch):
    f = tmp_path / "trace.log"
    t = _reload(monkeypatch, "summary", f).tracer("impl-verify")
    # Provide keys OUT of order; emitter must reorder to run session job bug project arch.
    t.ok("done", {"arch": "Current State", "project": "P", "run": "r1", "bug": "b9"})
    corr = f.read_text(encoding="utf-8").splitlines()[0].split("  ")[3]
    assert corr == 'run=r1 bug=b9 project=P arch="Current State"'


def test_empty_corr_is_dropped(tmp_path, monkeypatch):
    # No corr -> the corr column is an empty part and the two-space join drops it,
    # so the line has only 4 fields (byte-identical to the Node helper).
    f = tmp_path / "trace.log"
    t = _reload(monkeypatch, "summary", f).tracer("impl-verify")
    t.step("no corr")
    parts = f.read_text(encoding="utf-8").splitlines()[0].split("  ")
    assert len(parts) == 4, parts
    assert parts[1] == "[SUMMARY]"
    assert parts[3] == "▶ no corr"


def test_glyphs(tmp_path, monkeypatch):
    f = tmp_path / "trace.log"
    t = _reload(monkeypatch, "summary", f).tracer("impl-verify")
    c = {"project": "P"}
    t.step("s", c)
    t.ok("o", c)
    t.warn("w", c)
    t.fail("f", c)
    bodies = [ln.split("  ")[4] for ln in f.read_text(encoding="utf-8").splitlines()]
    assert bodies == ["▶ s", "✓ o", "⚠ w", "✗ f"]


def test_detail_only_when_detail_tier(tmp_path, monkeypatch):
    # summary tier: detail() must be a no-op.
    f = tmp_path / "trace.log"
    t = _reload(monkeypatch, "summary", f).tracer("impl-verify")
    t.detail("callback.sent", {"outcome": "deployed"}, {"project": "P", "job": "j1"})
    assert not f.exists()


def test_detail_line_format_and_corr_merge(tmp_path, monkeypatch):
    f = tmp_path / "trace.log"
    t = _reload(monkeypatch, "detail", f).tracer("impl-verify")
    t.detail("callback.sent", {"outcome": "deployed", "target_base_url": "http://h:8/"},
             {"project": "P", "job": "j1"})

    line = f.read_text(encoding="utf-8").splitlines()[0]
    parts = line.split("  ")
    assert len(parts) == 5, parts
    ts, tier, service, corr, body = parts
    assert TS_RE.match(ts)
    assert tier == "[detail]"
    assert service == "impl-verify"
    assert corr == "job=j1 project=P"
    # event + compact JSON; corr ids merged in, compact separators, key order corr-first.
    event, json_str = body.split(" ", 1)
    assert event == "callback.sent"
    assert json_str == (
        '{"job":"j1","project":"P","outcome":"deployed","target_base_url":"http://h:8/"}'
    )
    # Compact: no spaces after ':' or ','.
    assert ", " not in json_str and ": " not in json_str


def test_run_header_format(tmp_path, monkeypatch):
    f = tmp_path / "trace.log"
    t = _reload(monkeypatch, "summary", f).tracer("impl-verify")
    t.run_header("mig-7f3", project="SampleSvc SVC DB Migration", arch="Current State")
    # A leading blank line delimits runs in the shared append-only file; the
    # header is the first non-empty line (the summarizer skips the blank).
    lines = f.read_text(encoding="utf-8").splitlines()
    assert lines and lines[0] == "", "expected a leading blank-line run delimiter"
    hdr = next(l for l in lines if l.strip())
    m = re.match(
        r'^=== HAIKAI TRACE  run=mig-7f3 project="SampleSvc SVC DB Migration" '
        r'arch="Current State"  (\S+) ===$',
        hdr,
    )
    assert m, hdr
    assert TS_RE.match(m.group(1))


def test_atomic_append_keeps_prior_lines(tmp_path, monkeypatch):
    f = tmp_path / "trace.log"
    t = _reload(monkeypatch, "summary", f).tracer("impl-verify")
    t.step("first", {"project": "P"})
    t.ok("second", {"project": "P"})
    lines = f.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    assert lines[0].endswith("▶ first")
    assert lines[1].endswith("✓ second")


def test_tracing_never_raises_on_bad_path(tmp_path, monkeypatch):
    # Point at a path whose parent cannot be created (a file used as a dir).
    blocker = tmp_path / "blocker"
    blocker.write_text("x", encoding="utf-8")
    bad = blocker / "sub" / "trace.log"
    t = _reload(monkeypatch, "summary", bad).tracer("impl-verify")
    # Must not raise even though the write target is unusable.
    t.step("resilient", {"project": "P"})


# --- predicate self-scoring layer --------------------------------------------
# The JSON key orders asserted here are the cross-stack contract: the Node
# (trace.ts) and Java (HaikaiTrace) emitters produce byte-identical bodies for
# the same inputs, so the run judge parses every stack uniformly. The reload in
# each test also resets the per-process predicate tally.


def test_predicate_line_glyph_and_stable_json_key_order(tmp_path, monkeypatch):
    f = tmp_path / "trace.log"
    t = _reload(monkeypatch, "summary", f).tracer("impl-verify")
    t.predicate("EXEC.JOB.01", "dispatch recorded", True, "job id present", "job-42",
                {"run": "mig-1"})

    line = f.read_text(encoding="utf-8").splitlines()[0]
    parts = line.split("  ")
    assert len(parts) == 5, parts
    assert parts[1] == "[SUMMARY]"
    assert parts[2] == "impl-verify"
    assert parts[3] == "run=mig-1"
    assert parts[4] == (
        '✓ HAIKAI_PREDICATE {"id":"EXEC.JOB.01","title":"dispatch recorded",'
        '"verdict":"pass","expected":"job id present","actual":"job-42",'
        '"corr":{"run":"mig-1"}}'
    )


def test_predicate_fail_and_skip_verdicts(tmp_path, monkeypatch):
    f = tmp_path / "trace.log"
    t = _reload(monkeypatch, "summary", f).tracer("impl-verify")
    t.predicate("REC.PAR.01", "parity inbound recorded", False, "recorded", "missing")
    t.predicate_skip("CAP.SOAP.01", "soap operations captured", "pilot has no SOAP endpoints")

    fail_line, skip_line = f.read_text(encoding="utf-8").splitlines()
    assert "✗ HAIKAI_PREDICATE " in fail_line and '"verdict":"fail"' in fail_line
    assert "⚠ HAIKAI_PREDICATE " in skip_line and '"verdict":"skip"' in skip_line
    assert '"actual":"pilot has no SOAP endpoints"' in skip_line


def test_scorecard_tallies_by_stage_prefix_with_cumulative(tmp_path, monkeypatch):
    f = tmp_path / "trace.log"
    t = _reload(monkeypatch, "summary", f).tracer("impl-verify")
    t.stage_start("EXEC")
    t.predicate("EXEC.A.01", "a", True, "x", "x")
    t.predicate("EXEC.A.02", "b", False, "y", "z")
    t.predicate_skip("EXEC.A.03", "c", "why")
    t.predicate("REC.B.01", "other stage", True, "1", "1")
    t.stage_end("EXEC")

    lines = f.read_text(encoding="utf-8").splitlines()
    assert '▶ HAIKAI_STAGE_START {"stage":"EXEC"}' in lines[0]
    # EXEC tallies exclude the REC predicate; cumulative includes it.
    assert lines[-1].endswith(
        '✗ HAIKAI_SCORECARD {"stage":"EXEC","service":"impl-verify",'
        '"pass":1,"fail":1,"skip":1,'
        '"failed":[{"id":"EXEC.A.02","actual":"z"}],'
        '"cumulative":{"pass":2,"fail":1,"skip":1}}'
    )


def test_config_header_leads_with_service(tmp_path, monkeypatch):
    f = tmp_path / "trace.log"
    t = _reload(monkeypatch, "summary", f).tracer("impl-verify")
    t.config_header({"git_sha": "abc1234", "db_creds_present": False})

    assert f.read_text(encoding="utf-8").splitlines()[0].endswith(
        '▶ HAIKAI_CONFIG {"service":"impl-verify","git_sha":"abc1234",'
        '"db_creds_present":false}'
    )


def test_predicate_layer_off_tier_is_full_noop(tmp_path, monkeypatch):
    f = tmp_path / "trace.log"
    t = _reload(monkeypatch, "off", f).tracer("impl-verify")
    t.config_header({"git_sha": "abc"})
    t.stage_start("EXEC")
    t.predicate("EXEC.A.01", "a", False, "x", "y")
    t.predicate_skip("EXEC.A.02", "b", "why")
    t.stage_end("EXEC")
    assert not f.exists()


@pytest.fixture(autouse=True)
def _restore_module():
    """Leave src.trace in its repo-default (off) state for other tests."""
    yield
    import os
    os.environ.pop("HAIKAI_TRACE", None)
    os.environ.pop("HAIKAI_TRACE_FILE", None)
    importlib.reload(trace_mod)

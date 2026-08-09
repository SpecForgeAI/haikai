"""Option C — per-spec verification gate + repair loop (`_repair_spec`).

The LLM executor (`ClaudeCLIExecutor`) is a true external — stubbed here (allowed by
the no-mocks-at-the-seam policy). We verify the loop/cap/verdict logic, which is the
code under test; the real `/haikai:debug`+`/haikai:fix` run is exercised standalone.

2026-08-09 (work-machine port): the gate now SKIPS repos with no runnable test
suite (never invoking the executor), resolves its per-attempt timeout from
``SPEC_REPAIR_TIMEOUT_SECONDS`` (default 7200), and NEVER retries a timed-out
attempt — so the loop tests run against a ``repo`` fixture that carries a
``package.json`` (a bare ``tmp_path`` would short-circuit at the skip and the
retry logic would silently stop being tested).
"""
from __future__ import annotations

import pytest

import src.claude_cli_executor as cce
from src.job_queue.tasks import (
    _repair_spec,
    _spec_repair_timeout,
    _verify_gate_config,
    repo_has_test_suite,
)


@pytest.fixture
def repo(tmp_path):
    """A repo WITH a runnable-suite marker, so the gate's loop actually runs."""
    (tmp_path / "package.json").write_text('{"name": "fixture", "scripts": {"test": "true"}}')
    return tmp_path


def _stub(monkeypatch, attempts):
    """`attempts`: per-call result — (success_bool, passed_bool), the string
    'raise', or the string 'timeout' (an executor timeout result carrying the
    explicit ``timed_out`` marker). Returns a recorder with every command and
    every ``timeout=`` value passed through to the executor."""
    seq = iter(attempts)

    class _Recorder:
        calls: list = []
        timeouts: list = []

    _Recorder.calls = []
    _Recorder.timeouts = []

    class _Fake:
        def __init__(self, *a, **k):
            pass

        def execute(self, command, timeout=0):
            _Recorder.calls.append(command)
            _Recorder.timeouts.append(timeout)
            v = next(seq)
            if v == "raise":
                raise RuntimeError("executor boom")
            if v == "timeout":
                return {
                    "success": False,
                    "timed_out": True,
                    "return_code": -1,
                    "stdout": "",
                    "stderr": f"Command timed out after {timeout} seconds",
                }
            success, passed = v
            verdict = "VERDICT=PASS" if passed else "VERDICT=FAIL"
            return {"success": success, "stdout": f"...work...\n{verdict}\n"}

    monkeypatch.setattr(cce, "ClaudeCLIExecutor", _Fake)
    return _Recorder


def test_passes_first_attempt(monkeypatch, repo):
    _stub(monkeypatch, [(True, True)])
    passed, attempts, _ = _repair_spec(repo, "spec-a", "k", cap=10)
    assert passed is True and attempts == 1


def test_heals_after_retries(monkeypatch, repo):
    _stub(monkeypatch, [(True, False), (True, False), (True, True)])
    passed, attempts, _ = _repair_spec(repo, "spec-a", "k", cap=10)
    assert passed is True and attempts == 3


def test_fail_stop_when_never_green(monkeypatch, repo):
    _stub(monkeypatch, [(True, False)] * 4)
    passed, attempts, _ = _repair_spec(repo, "spec-a", "k", cap=4)
    assert passed is False and attempts == 4


def test_verdict_pass_needs_session_success(monkeypatch, repo):
    # the CLI emitting VERDICT=PASS but a non-success session does NOT count as green
    _stub(monkeypatch, [(False, True)] * 3)
    passed, attempts, _ = _repair_spec(repo, "spec-a", "k", cap=3)
    assert passed is False


def test_executor_error_is_a_failed_attempt_not_a_crash(monkeypatch, repo):
    _stub(monkeypatch, ["raise", "raise", (True, True)])
    passed, attempts, _ = _repair_spec(repo, "spec-a", "k", cap=10)
    assert passed is True and attempts == 3


# -- no-suite skip (2026-08-09): a repo with nothing to run never blocks its
# spec from committing, and the LLM is never invoked ---------------------------

def test_no_suite_skips_gate_without_invoking_executor(monkeypatch, tmp_path):
    recorder = _stub(monkeypatch, [(True, True)])
    passed, attempts, summary = _repair_spec(tmp_path, "spec-a", "k", cap=10)
    assert passed is True and attempts == 0
    assert "gate skipped" in summary and "no runnable test suite" in summary
    assert recorder.calls == []  # the executor was NEVER called


def test_repo_has_test_suite_marker_detection(tmp_path):
    assert repo_has_test_suite(tmp_path) is False
    (tmp_path / "pom.xml").write_text("<project/>")
    assert repo_has_test_suite(tmp_path) is True


def test_repo_has_test_suite_dir_detection_empty_dir_does_not_count(tmp_path):
    (tmp_path / "tests").mkdir()
    assert repo_has_test_suite(tmp_path) is False  # empty scaffold != suite
    (tmp_path / "tests" / "test_x.py").write_text("def test_x():\n    pass\n")
    assert repo_has_test_suite(tmp_path) is True


# -- timeout semantics (2026-08-09): never retry a timed-out attempt — an
# identical command hits the same wall; a FAIL verdict still retries ----------

def test_timeout_is_not_retried_exactly_one_attempt(monkeypatch, repo):
    recorder = _stub(monkeypatch, ["timeout", (True, True)])
    passed, attempts, summary = _repair_spec(repo, "spec-a", "k", cap=10)
    assert passed is False and attempts == 1
    assert "timed out" in summary and "not retried" in summary
    assert len(recorder.calls) == 1  # the second stub entry was never consumed


def test_stderr_timeout_fallback_for_older_executors(monkeypatch, repo):
    # An executor predating the timed_out marker: the stderr sniff catches it.
    seq = iter([{"success": False, "stdout": "",
                 "stderr": "Command timed out after 60 seconds"}])

    class _Old:
        def __init__(self, *a, **k):
            pass

        def execute(self, command, timeout=0):
            return next(seq)

    monkeypatch.setattr(cce, "ClaudeCLIExecutor", _Old)
    passed, attempts, _ = _repair_spec(repo, "spec-a", "k", cap=5)
    assert passed is False and attempts == 1


def test_fail_verdict_still_retries(monkeypatch, repo):
    recorder = _stub(monkeypatch, [(True, False), (True, True)])
    passed, attempts, _ = _repair_spec(repo, "spec-a", "k", cap=10)
    assert passed is True and attempts == 2
    assert len(recorder.calls) == 2


def test_spec_repair_timeout_default_7200(monkeypatch):
    monkeypatch.delenv("SPEC_REPAIR_TIMEOUT_SECONDS", raising=False)
    assert _spec_repair_timeout() == 7200


def test_spec_repair_timeout_env_override_and_bad_value_fallback(monkeypatch):
    monkeypatch.setenv("SPEC_REPAIR_TIMEOUT_SECONDS", "900")
    assert _spec_repair_timeout() == 900
    monkeypatch.setenv("SPEC_REPAIR_TIMEOUT_SECONDS", "not-a-number")
    assert _spec_repair_timeout() == 7200


def test_resolved_timeout_passes_through_to_executor(monkeypatch, repo):
    monkeypatch.setenv("SPEC_REPAIR_TIMEOUT_SECONDS", "1234")
    recorder = _stub(monkeypatch, [(True, True)])
    _repair_spec(repo, "spec-a", "k", cap=1)
    assert recorder.timeouts == [1234]


def test_explicit_timeout_argument_wins_over_env(monkeypatch, repo):
    monkeypatch.setenv("SPEC_REPAIR_TIMEOUT_SECONDS", "1234")
    recorder = _stub(monkeypatch, [(True, True)])
    _repair_spec(repo, "spec-a", "k", cap=1, timeout=55)
    assert recorder.timeouts == [55]


# -- _verify_gate_config knob matrix (gold standard 2026-08-07: the gate is ON
# by default on EVERY commit path; SPEC_VERIFY_GATE supersedes the old
# batch-only BATCH_VERIFY_GATE but keeps it honoured as a legacy alias) -------

def _clear_gate_env(monkeypatch):
    for var in ("SPEC_VERIFY_GATE", "BATCH_VERIFY_GATE",
                "SPEC_REPAIR_CAP", "BATCH_REPAIR_CAP"):
        monkeypatch.delenv(var, raising=False)


def test_gate_config_default_is_ON_cap_10(monkeypatch):
    _clear_gate_env(monkeypatch)
    assert _verify_gate_config() == (True, 10)


def test_gate_config_legacy_batch_env_still_honoured(monkeypatch):
    _clear_gate_env(monkeypatch)
    monkeypatch.setenv("BATCH_VERIFY_GATE", "false")
    enabled, _ = _verify_gate_config()
    assert enabled is False


def test_gate_config_spec_env_wins_over_legacy(monkeypatch):
    _clear_gate_env(monkeypatch)
    monkeypatch.setenv("SPEC_VERIFY_GATE", "true")
    monkeypatch.setenv("BATCH_VERIFY_GATE", "false")
    enabled, _ = _verify_gate_config()
    assert enabled is True


def test_gate_config_cap_fallback_chain(monkeypatch):
    _clear_gate_env(monkeypatch)
    monkeypatch.setenv("BATCH_REPAIR_CAP", "7")
    assert _verify_gate_config()[1] == 7          # legacy cap honoured
    monkeypatch.setenv("SPEC_REPAIR_CAP", "3")
    assert _verify_gate_config()[1] == 3          # new cap wins

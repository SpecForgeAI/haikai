"""Option C — per-spec verification gate + repair loop (`_repair_spec`).

The LLM executor (`ClaudeCLIExecutor`) is a true external — stubbed here (allowed by
the no-mocks-at-the-seam policy). We verify the loop/cap/verdict logic, which is the
code under test; the real `/haikai:debug`+`/haikai:fix` run is exercised standalone.
"""
from __future__ import annotations

import src.claude_cli_executor as cce
from src.job_queue.tasks import _repair_spec


def _stub(monkeypatch, attempts):
    """`attempts`: per-call result — (success_bool, passed_bool) or the string 'raise'."""
    seq = iter(attempts)

    class _Fake:
        def __init__(self, *a, **k):
            pass

        def execute(self, command, timeout=0):
            v = next(seq)
            if v == "raise":
                raise RuntimeError("executor boom")
            success, passed = v
            verdict = "VERDICT=PASS" if passed else "VERDICT=FAIL"
            return {"success": success, "stdout": f"...work...\n{verdict}\n"}

    monkeypatch.setattr(cce, "ClaudeCLIExecutor", _Fake)


def test_passes_first_attempt(monkeypatch, tmp_path):
    _stub(monkeypatch, [(True, True)])
    passed, attempts, _ = _repair_spec(tmp_path, "spec-a", "k", cap=10)
    assert passed is True and attempts == 1


def test_heals_after_retries(monkeypatch, tmp_path):
    _stub(monkeypatch, [(True, False), (True, False), (True, True)])
    passed, attempts, _ = _repair_spec(tmp_path, "spec-a", "k", cap=10)
    assert passed is True and attempts == 3


def test_fail_stop_when_never_green(monkeypatch, tmp_path):
    _stub(monkeypatch, [(True, False)] * 4)
    passed, attempts, _ = _repair_spec(tmp_path, "spec-a", "k", cap=4)
    assert passed is False and attempts == 4


def test_verdict_pass_needs_session_success(monkeypatch, tmp_path):
    # the CLI emitting VERDICT=PASS but a non-success session does NOT count as green
    _stub(monkeypatch, [(False, True)] * 3)
    passed, attempts, _ = _repair_spec(tmp_path, "spec-a", "k", cap=3)
    assert passed is False


def test_executor_error_is_a_failed_attempt_not_a_crash(monkeypatch, tmp_path):
    _stub(monkeypatch, ["raise", "raise", (True, True)])
    passed, attempts, _ = _repair_spec(tmp_path, "spec-a", "k", cap=10)
    assert passed is True and attempts == 3

"""Option C — per-spec verification gate + repair loop (`_repair_spec`).

The LLM executor (`ClaudeCLIExecutor`) is a true external — stubbed here (allowed by
the no-mocks-at-the-seam policy). We verify the loop/cap/verdict logic, which is the
code under test; the real `/haikai:debug`+`/haikai:fix` run is exercised standalone.
"""
from __future__ import annotations

import src.claude_cli_executor as cce
from src.job_queue.tasks import _repair_spec, _verify_gate_config


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

"""Robustness R1 pins: transient classification + model fallback + step retry.

Live incident (2026-08-05): a 13.5s Kiro-backend blip
(``InternalServerException``, kiro-cli's internal retries exhausted, exit 0,
no spec.md) failed one step and stopped a 12-spec Stage run — the
orchestrator had no retry anywhere and no notion of WHY a step failed.
"""
from __future__ import annotations

import pytest

from src.chat.model_pinning import (
    KIRO_MODEL_ALTERNATIVE_ENV,
    kiro_alternative_model,
)
from src.chat.transient_failure import (
    FAILURE_CLASS_REAL,
    FAILURE_CLASS_TRANSIENT,
    ModelFallbackTracker,
    classify_step_failure,
    is_transient_failure_text,
    step_retry_backoff_seconds,
    step_retry_max_retries,
)


class TestClassification:
    def test_the_incident_signatures_are_transient(self):
        # Verbatim shapes from the 2026-08-05 incident.
        assert is_transient_failure_text(
            'Error { code: "InternalServerException", message: "Encountered an '
            'unexpected error when processing the request, please try again." }'
        )
        assert is_transient_failure_text("Kiro is having trouble responding right now:")
        assert is_transient_failure_text("kiro-cli exited with code -15: TimeoutExpired")

    def test_real_failures_are_not_transient(self):
        assert not is_transient_failure_text(
            "Step 3 (implement-tasks) finished but tasks.md still has 4 unticked task checkbox(es)"
        )
        assert not is_transient_failure_text(
            "asked clarifying questions in a non-interactive orchestration run"
        )
        assert not is_transient_failure_text("expected output files are missing: spec.md")

    def test_classify_reads_error_events(self):
        assert classify_step_failure(["InternalServerException"], "") == FAILURE_CLASS_TRANSIENT
        assert classify_step_failure(["tasks.md still has 2 unticked"], "") == FAILURE_CLASS_REAL

    def test_classify_reads_the_output_tail_for_the_silent_lie_shape(self):
        # kiro-cli prints the trouble banner to STDOUT and exits 0 — the only
        # evidence is in the collected content, not the error events.
        content = ("normal spec prose... " * 50) + "Kiro is having trouble responding right now"
        errors = ["Step 1 (/write-spec) completed without errors but expected "
                  "output files are missing: ['spec.md']"]
        assert classify_step_failure(errors, content) == FAILURE_CLASS_TRANSIENT

    def test_missing_output_without_transient_evidence_is_real(self):
        errors = ["expected output files are missing: ['spec.md']"]
        assert classify_step_failure(errors, "the model wrote an essay instead") == FAILURE_CLASS_REAL


class TestModelFallbackTracker:
    def test_fallback_activates_at_threshold_and_is_one_way(self):
        t = ModelFallbackTracker(primary="claude-opus-5", alternative="claude-opus-4.8", threshold=3)
        assert t.active_model() == "claude-opus-5"
        t.record_transient_failure()
        t.record_transient_failure()
        assert not t.fallback_active
        t.record_transient_failure()
        assert t.fallback_active
        assert t.active_model() == "claude-opus-4.8"

    def test_no_alternative_or_same_model_never_falls_back(self):
        for alt in (None, "", "claude-opus-5"):
            t = ModelFallbackTracker(primary="claude-opus-5", alternative=alt, threshold=1)
            t.record_transient_failure()
            assert t.active_model() == "claude-opus-5"

    def test_alternative_model_env_and_default(self, monkeypatch):
        monkeypatch.delenv(KIRO_MODEL_ALTERNATIVE_ENV, raising=False)
        assert kiro_alternative_model() == "claude-opus-4.8"
        monkeypatch.setenv(KIRO_MODEL_ALTERNATIVE_ENV, "claude-sonnet-4-6")
        assert kiro_alternative_model() == "claude-sonnet-4-6"
        monkeypatch.setenv(KIRO_MODEL_ALTERNATIVE_ENV, "auto")
        assert kiro_alternative_model() is None


class TestRetryKnobs:
    def test_defaults(self, monkeypatch):
        monkeypatch.delenv("STEP_RETRY_MAX_RETRIES", raising=False)
        monkeypatch.delenv("STEP_RETRY_BACKOFF_SECONDS", raising=False)
        assert step_retry_max_retries() == 2
        assert step_retry_backoff_seconds() == [30.0, 120.0]

    def test_env_overrides_and_garbage_tolerance(self, monkeypatch):
        monkeypatch.setenv("STEP_RETRY_MAX_RETRIES", "1")
        monkeypatch.setenv("STEP_RETRY_BACKOFF_SECONDS", "5, junk, 10")
        assert step_retry_max_retries() == 1
        assert step_retry_backoff_seconds() == [5.0, 10.0]
        monkeypatch.setenv("STEP_RETRY_MAX_RETRIES", "-3")
        assert step_retry_max_retries() == 0


class TestOrchestratorStepRetry:
    """Wire-level pins on HaikaiOrchestrator._execute_step_with_retry."""

    def _orchestrator(self, monkeypatch, results):
        """Bare orchestrator with _execute_step_with_session stubbed to pop
        canned StepResults; sleeps captured instead of slept."""
        from src.haikai_models import StepResult
        from src.haikai_orchestrator import HaikaiOrchestrator

        orch = HaikaiOrchestrator.__new__(HaikaiOrchestrator)
        orch.request = type("R", (), {"project": "proj"})()

        canned = list(results)

        def fake_step(chat_executor, step, command, spec_name, is_new_session=False):
            status, failure_class = canned.pop(0)
            return StepResult(
                step=step, command=command, status=status, output_paths=[],
                execution_time_seconds=0.1, log_file="log", error_message=None,
                failure_class=failure_class,
            )

        orch._execute_step_with_session = fake_step
        sleeps: list = []
        monkeypatch.setattr("time.sleep", lambda s: sleeps.append(s))
        monkeypatch.setenv("STEP_RETRY_MAX_RETRIES", "2")
        monkeypatch.setenv("STEP_RETRY_BACKOFF_SECONDS", "30,120")
        return orch, sleeps

    class _FakeKiro:
        model = "claude-opus-5"

    def test_transient_failure_retries_with_cooloff_then_succeeds(self, monkeypatch):
        orch, sleeps = self._orchestrator(monkeypatch, [
            ("failure", FAILURE_CLASS_TRANSIENT),
            ("success", None),
        ])
        result = orch._execute_step_with_retry(self._FakeKiro(), 1, "/write-spec", "spec-x")
        assert result.status == "success"
        assert result.attempts == 2
        assert sleeps == [30.0]

    def test_real_failure_never_retries(self, monkeypatch):
        orch, sleeps = self._orchestrator(monkeypatch, [
            ("failure", FAILURE_CLASS_REAL),
        ])
        result = orch._execute_step_with_retry(self._FakeKiro(), 3, "/implement-tasks", "spec-x")
        assert result.status == "failure"
        assert result.attempts == 1
        assert sleeps == []

    def test_exhaustion_returns_the_transient_failure_after_max_tries(self, monkeypatch):
        orch, sleeps = self._orchestrator(monkeypatch, [
            ("failure", FAILURE_CLASS_TRANSIENT),
            ("failure", FAILURE_CLASS_TRANSIENT),
            ("failure", FAILURE_CLASS_TRANSIENT),
        ])
        result = orch._execute_step_with_retry(self._FakeKiro(), 1, "/write-spec", "spec-x")
        assert result.status == "failure"
        assert result.failure_class == FAILURE_CLASS_TRANSIENT
        assert result.attempts == 3
        assert sleeps == [30.0, 120.0]

    def test_fallback_swaps_the_kiro_executor_model_after_threshold(self, monkeypatch):
        monkeypatch.setenv("KIRO_CHAT_MODEL", "claude-opus-5")
        monkeypatch.setenv("KIRO_CHAT_MODEL_ALTERNATIVE", "claude-opus-4.8")
        monkeypatch.setenv("KIRO_MODEL_FALLBACK_THRESHOLD", "3")
        orch, _ = self._orchestrator(monkeypatch, [
            ("failure", FAILURE_CLASS_TRANSIENT),
            ("failure", FAILURE_CLASS_TRANSIENT),
            ("failure", FAILURE_CLASS_TRANSIENT),
        ])

        class KiroChatExecutorFake:  # name must start with "Kiro" (the prod check)
            model = "claude-opus-5"

        executor = KiroChatExecutorFake()
        result = orch._execute_step_with_retry(executor, 1, "/write-spec", "spec-x")
        assert result.status == "failure"
        # 3 transient failures recorded -> fallback active; the NEXT step's
        # _apply_model_fallback swaps the executor.
        orch._apply_model_fallback(executor)
        assert executor.model == "claude-opus-4.8"

    def test_fallback_never_touches_non_kiro_executors(self, monkeypatch):
        monkeypatch.setenv("KIRO_CHAT_MODEL_ALTERNATIVE", "claude-opus-4.8")
        orch, _ = self._orchestrator(monkeypatch, [])
        tracker = orch._model_fallback_tracker()
        for _ in range(5):
            tracker.record_transient_failure()

        class ClaudeChatExecutorFake:
            model = "unchanged"

        executor = ClaudeChatExecutorFake()
        orch._apply_model_fallback(executor)
        assert executor.model == "unchanged"

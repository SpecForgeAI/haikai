"""
Guard test for the orchestration progress bug (JobProgress percentage > 100).

The orchestration workflow has 4 steps (`HaikaiOrchestrator.COMMANDS`, including
`/git-commit-preparation`), but the progress checkpoint once hardcoded a total of
3 -- so the final step computed `int(4 / 3 * 100) = 133`, which violates
`JobProgress.percentage` (`Field(le=100)`) and raised `ValidationError` mid-run,
flipping an otherwise-successful job to `success: false`.

These assert the percentage stays valid for the *real* workflow length and that
it clamps under any future step-count drift. Production and this test share the
same `_step_progress_percentage` helper, so the math can't silently diverge.
"""

import pytest

from src.job_queue.tasks import _step_progress_percentage
from src.job_queue.job_models import JobProgress
from src.haikai_orchestrator import HaikaiOrchestrator


def test_jobprogress_valid_for_every_real_workflow_step():
    """Every step of the actual workflow must yield a constructible JobProgress.

    The regression guard: with the old hardcoded `/3`, the final step (4)
    produced 133 and `JobProgress(...)` raised. If someone re-hardcodes the
    total or adds a step without updating the math, this fails.
    """
    total = len(HaikaiOrchestrator.COMMANDS)
    assert total >= 1
    for cmd in HaikaiOrchestrator.COMMANDS:
        step = cmd["step"]
        pct = _step_progress_percentage(step, total)
        assert 0 <= pct <= 100, f"step {step}/{total} -> {pct}%"
        # Must not raise -- this is the exact original failure mode.
        JobProgress(
            current_step=step,
            total_steps=total,
            step_description=cmd["description"],
            percentage=pct,
        )


def test_final_step_is_exactly_100_percent():
    total = len(HaikaiOrchestrator.COMMANDS)
    last = max(c["step"] for c in HaikaiOrchestrator.COMMANDS)
    assert _step_progress_percentage(last, total) == 100


@pytest.mark.parametrize(
    "step_num,total,expected",
    [
        (4, 3, 100),   # the exact original overflow (would have been 133)
        (99, 3, 100),  # extreme drift still clamps, never exceeds 100
        (0, 4, 0),
        (2, 4, 50),
        (3, 0, 100),   # degenerate total -> safe default, no ZeroDivisionError
    ],
)
def test_percentage_is_clamped_and_safe(step_num, total, expected):
    assert _step_progress_percentage(step_num, total) == expected

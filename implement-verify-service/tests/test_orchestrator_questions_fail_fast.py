"""A questions batch inside an orchestration step is a named failure
(2026-07-28): the skill-less step 4 improvised /ask-questions in a headless
job and stalled ~7 minutes; the recorded "error" was ANSI banner noise. The
step loop now converts any `questions` event into an immediate step error.
"""
from __future__ import annotations

import tempfile

import pytest

from src.haikai_models import OrchestrationRequest, SpecIntent
from src.haikai_orchestrator import HaikaiOrchestrator


class _QuestionAskingExecutor:
    session_uuid = "sess-1"

    def stream_message(self, prompt, is_new_session=False, command_name=""):
        yield {"type": "content", "delta": "thinking...\n"}
        yield {
            "type": "questions",
            "questions": [{"id": "q1", "question": "Which remote should I push to?"}],
        }

    def persist_session_to_spec(self, spec_name):
        return None


@pytest.fixture()
def orchestrator(tmp_path):
    (tmp_path / "acme" / "proj").mkdir(parents=True)
    request = OrchestrationRequest(
        company="acme",
        project="proj",
        spec_intents=[
            SpecIntent(
                spec_name="2026-07-28-demo-spec",
                session_id="91c30231-cf7a-51e4-ba3f-585e5e1694d7",
            )
        ],
    )
    return HaikaiOrchestrator(
        request=request,
        anthropic_api_key="",
        workspace_dir=str(tmp_path),
        logs_dir=str(tmp_path / "logs"),
    )


def test_questions_event_fails_the_step(orchestrator):
    # Step 4 has NO expected output files, so before the fix a
    # questions-then-stall turn concluded "success" with zero artifacts.
    result = orchestrator._execute_step_with_session(
        _QuestionAskingExecutor(),
        step=4,
        command="/git-commit-preparation",
        spec_name="2026-07-28-demo-spec",
    )

    assert result.status == "failure"
    assert "asked clarifying questions" in (result.error_message or "")

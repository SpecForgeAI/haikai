"""
Guard test for the question/folder recovery gating (Bug 2).

The orchestration commands (write-spec, create-tasks, implement-tasks,
git-commit-preparation) run non-interactively and never use `/ask-questions`, so
they must NOT enter `stream_message()`'s question/folder recovery retries.
Before the fix, `/git-commit-preparation` -- producing neither questions nor a
spec folder -- burned `max_retries` Claude CLI spawns and logged a misleading
"failed to produce questions or folder" error (non-fatal, but wasted
time + tokens).

These assert the gating predicate excludes every orchestration command, leaves
the interactive commands alone, and that the exclusion set stays in sync with
`HaikaiOrchestrator.COMMANDS` -- so adding a new orchestration step can't
silently re-introduce the bug.
"""

import pytest

from src.chat.claude_chat_executor import (
    _uses_question_flow,
    _NON_INTERACTIVE_COMMANDS,
)
from src.haikai_orchestrator import HaikaiOrchestrator


def _orchestration_command_names():
    return {c["command"].lstrip("/") for c in HaikaiOrchestrator.COMMANDS}


def test_git_commit_preparation_is_excluded():
    # The specific Bug 2 victim.
    assert _uses_question_flow("git-commit-preparation") is False


def test_all_orchestration_commands_skip_question_flow():
    for name in _orchestration_command_names():
        assert _uses_question_flow(name) is False, name


@pytest.mark.parametrize(
    "name", ["shape-spec", "plan-product", "story-component-anchor", "analyze-repo"]
)
def test_interactive_commands_still_use_question_flow(name):
    assert _uses_question_flow(name) is True


def test_exclusion_set_stays_in_sync_with_orchestrator():
    # Every orchestration command must be excluded -- and nothing else -- so the
    # interactive commands keep their recovery. Adding a step to COMMANDS without
    # updating _NON_INTERACTIVE_COMMANDS fails here (patch the sibling).
    assert _NON_INTERACTIVE_COMMANDS == _orchestration_command_names()

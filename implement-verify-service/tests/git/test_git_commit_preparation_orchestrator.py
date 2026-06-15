"""
Tests for orchestrator step 4 (/git-commit-preparation) integration.

Task Group 3 tests.
"""

import pytest
from src.haikai_orchestrator import HaikaiOrchestrator


class TestOrchestratorStep4:
    """Tests for step 4 integration in the orchestrator."""

    def test_commands_has_4_entries(self):
        """COMMANDS list has 4 entries with correct step numbers."""
        assert len(HaikaiOrchestrator.COMMANDS) == 4
        steps = [c["step"] for c in HaikaiOrchestrator.COMMANDS]
        assert steps == [1, 2, 3, 4]

    def test_step_4_is_git_commit_preparation(self):
        """Step 4 is /git-commit-preparation."""
        step4 = HaikaiOrchestrator.COMMANDS[3]
        assert step4["command"] == "/git-commit-preparation"
        assert step4["step"] == 4

    def test_step_4_is_non_fatal(self):
        """Step 4 has non_fatal=True flag."""
        step4 = HaikaiOrchestrator.COMMANDS[3]
        assert step4.get("non_fatal") is True

    def test_brain_commands_unchanged(self):
        """BRAIN_COMMANDS still has only 2 entries (write-spec + create-tasks)."""
        assert len(HaikaiOrchestrator.BRAIN_COMMANDS) == 2
        commands = [c["command"] for c in HaikaiOrchestrator.BRAIN_COMMANDS]
        assert commands == ["/write-spec", "/create-tasks"]

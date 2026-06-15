"""
Tests for GitManager.prepare_for_commit() and _run_git() timeout parameter.

Task Group 1 tests for the deterministic commit preparation layer.
"""

import subprocess
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from src.git.git_manager import GitManager, GitManagerError


@pytest.fixture
def git_workspace(tmp_path):
    """Create a temporary git workspace with .git directory."""
    project_dir = tmp_path / "testco" / "testproj"
    project_dir.mkdir(parents=True)
    git_dir = project_dir / ".git"
    git_dir.mkdir()
    return project_dir


@pytest.fixture
def manager(git_workspace):
    """Create a GitManager with mocked _run_git."""
    gm = GitManager(project_dir=git_workspace)
    return gm


class TestPrepareForCommit:
    """Tests for prepare_for_commit() method."""

    def test_removes_stale_index_lock(self, manager, git_workspace):
        """Stale .git/index.lock is removed."""
        lock_file = git_workspace / ".git" / "index.lock"
        lock_file.touch()
        assert lock_file.exists()

        with patch.object(manager, "_run_git"):
            manager.prepare_for_commit()

        assert not lock_file.exists()

    def test_creates_gitignore_when_missing(self, manager, git_workspace):
        """Creates .gitignore with critical patterns when none exists."""
        gitignore = git_workspace / ".gitignore"
        assert not gitignore.exists()

        with patch.object(manager, "_run_git"):
            manager.prepare_for_commit()

        assert gitignore.exists()
        content = gitignore.read_text(encoding="utf-8")
        assert GitManager.HAIKAI_MARKER in content
        assert "node_modules/" in content
        assert "__pycache__/" in content
        assert ".env" in content
        assert ".DS_Store" in content
        assert "!package-lock.json" in content

    def test_appends_to_existing_gitignore(self, manager, git_workspace):
        """Appends missing critical patterns to existing .gitignore under marker."""
        gitignore = git_workspace / ".gitignore"
        gitignore.write_text("# My project\n*.tmp\n", encoding="utf-8")

        with patch.object(manager, "_run_git"):
            manager.prepare_for_commit()

        content = gitignore.read_text(encoding="utf-8")
        # Original content preserved
        assert "# My project" in content
        assert "*.tmp" in content
        # Haikai marker added
        assert GitManager.HAIKAI_MARKER in content
        # Critical patterns appended
        assert "node_modules/" in content
        assert ".env" in content

    def test_does_not_duplicate_patterns(self, manager, git_workspace):
        """Running prepare twice doesn't duplicate .gitignore entries."""
        gitignore = git_workspace / ".gitignore"

        with patch.object(manager, "_run_git"):
            manager.prepare_for_commit()
            first_content = gitignore.read_text(encoding="utf-8")

            manager.prepare_for_commit()
            second_content = gitignore.read_text(encoding="utf-8")

        # node_modules/ should appear exactly once
        assert second_content.count("node_modules/") == 1

    def test_commit_all_calls_prepare(self, manager):
        """commit_all() calls prepare_for_commit() before staging."""
        call_order = []

        def mock_prepare():
            call_order.append("prepare")

        def mock_run_git(cmd, check=True, timeout=120):
            call_order.append(cmd[1] if len(cmd) > 1 else cmd[0])
            result = MagicMock()
            result.returncode = 0
            result.stdout = ""
            result.stderr = ""
            return result

        with patch.object(manager, "prepare_for_commit", side_effect=mock_prepare):
            with patch.object(manager, "_run_git", side_effect=mock_run_git):
                manager.commit_all("test commit")

        assert call_order[0] == "prepare"
        assert "add" in call_order

    def test_run_git_respects_custom_timeout(self, manager):
        """_run_git() passes custom timeout to subprocess.run."""
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
            manager._run_git(["git", "status"], timeout=999)

        mock_run.assert_called_once()
        assert mock_run.call_args.kwargs.get("timeout") == 999

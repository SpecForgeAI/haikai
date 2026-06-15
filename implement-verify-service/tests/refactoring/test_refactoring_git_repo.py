"""Tests for src/refactoring/git_repo.py — GitRepo + diff parsing."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from src.refactoring.git_repo import DiffScope, FileDiff, GitRepo


def _git(repo: Path, *args: str, env: dict | None = None) -> str:
    """Run git in repo, return stdout. Helper for tests."""
    full_env = os.environ.copy()
    if env:
        full_env.update(env)
    # Disable signing/hooks/config that might pollute tests.
    full_env.setdefault("GIT_AUTHOR_NAME", "Test")
    full_env.setdefault("GIT_AUTHOR_EMAIL", "test@example.com")
    full_env.setdefault("GIT_COMMITTER_NAME", "Test")
    full_env.setdefault("GIT_COMMITTER_EMAIL", "test@example.com")
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        env=full_env,
        check=True,
    )
    return result.stdout


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A fresh git repo with one initial commit on `main`."""
    _git(tmp_path, "init", "-b", "main")
    _git(tmp_path, "config", "commit.gpgsign", "false")
    (tmp_path / "a.py").write_text("def alpha():\n    return 1\n", encoding="utf-8")
    _git(tmp_path, "add", "a.py")
    _git(tmp_path, "commit", "-m", "init")
    return tmp_path


def test_constructor_rejects_non_git(tmp_path: Path):
    with pytest.raises(ValueError, match="Not a git repository"):
        GitRepo(tmp_path)


def test_head_sha(repo: Path):
    g = GitRepo(repo)
    sha = g.head_sha()
    assert len(sha) == 40
    assert all(c in "0123456789abcdef" for c in sha)


def test_clean_tree_not_dirty(repo: Path):
    g = GitRepo(repo)
    assert g.working_tree_dirty() is False
    assert g.modified_files() == []


def test_dirty_tree_lists_modified(repo: Path):
    (repo / "a.py").write_text("def alpha():\n    return 2\n", encoding="utf-8")
    g = GitRepo(repo)
    assert g.working_tree_dirty() is True
    assert "a.py" in g.modified_files()


def test_modified_files_excludes_untracked(repo: Path):
    (repo / "untracked.py").write_text("x = 1\n", encoding="utf-8")
    g = GitRepo(repo)
    assert g.modified_files() == []  # untracked not included
    # but it IS dirty in git's view
    assert g.working_tree_dirty() is True


def test_diff_unstaged_modified(repo: Path):
    (repo / "a.py").write_text("def alpha():\n    return 99\n", encoding="utf-8")
    g = GitRepo(repo)
    diffs = g.diff(scope=DiffScope.UNSTAGED)
    assert len(diffs) == 1
    fd = diffs[0]
    assert fd.path == "a.py"
    assert fd.status == "modified"
    assert len(fd.hunks) >= 1
    h = fd.hunks[0]
    # Line 2 ("    return 1") was changed to "    return 99"
    assert 2 in h.affected_lines


def test_diff_staged_vs_unstaged(repo: Path):
    # Modify and stage a.py
    (repo / "a.py").write_text("def alpha():\n    return 2\n", encoding="utf-8")
    _git(repo, "add", "a.py")
    # Make a different unstaged change
    (repo / "a.py").write_text("def alpha():\n    return 3\n# added\n", encoding="utf-8")
    g = GitRepo(repo)

    staged = g.diff(scope=DiffScope.STAGED)
    unstaged = g.diff(scope=DiffScope.UNSTAGED)
    assert len(staged) == 1 and staged[0].path == "a.py"
    assert len(unstaged) == 1 and unstaged[0].path == "a.py"
    # unstaged includes the new "# added" line
    unstaged_added = [
        ln for h in unstaged[0].hunks for ln in h.lines if ln.startswith("+")
    ]
    assert any("# added" in ln for ln in unstaged_added)


def test_diff_added_file(repo: Path):
    (repo / "b.py").write_text("def beta():\n    return 1\n", encoding="utf-8")
    _git(repo, "add", "b.py")
    g = GitRepo(repo)
    diffs = g.diff(scope=DiffScope.STAGED)
    fd = next((d for d in diffs if d.path == "b.py"), None)
    assert fd is not None
    assert fd.status == "added"


def test_diff_deleted_file(repo: Path):
    _git(repo, "rm", "a.py")
    g = GitRepo(repo)
    diffs = g.diff(scope=DiffScope.STAGED)
    fd = next((d for d in diffs if d.path == "a.py"), None)
    assert fd is not None
    assert fd.status == "deleted"


def test_diff_renamed_file(repo: Path):
    # Rename a.py → renamed_a.py and stage
    _git(repo, "mv", "a.py", "renamed_a.py")
    g = GitRepo(repo)
    diffs = g.diff(scope=DiffScope.STAGED)
    fd = next((d for d in diffs if d.path == "renamed_a.py"), None)
    assert fd is not None
    assert fd.status == "renamed"
    assert fd.old_path == "a.py"


def test_diff_commit_scope(repo: Path):
    # Make a second commit, then ask for COMMIT scope
    (repo / "a.py").write_text("def alpha():\n    return 42\n", encoding="utf-8")
    _git(repo, "add", "a.py")
    _git(repo, "commit", "-m", "second")
    g = GitRepo(repo)
    sha = g.head_sha()
    diffs = g.diff(scope=DiffScope.COMMIT, commit=sha)
    assert len(diffs) == 1
    assert diffs[0].path == "a.py"


def test_diff_commit_scope_requires_sha(repo: Path):
    g = GitRepo(repo)
    with pytest.raises(ValueError, match="requires a commit SHA"):
        g.diff(scope=DiffScope.COMMIT)


def test_hunk_affected_lines_pure_deletion(repo: Path):
    # Add a multi-line file then delete the middle line
    (repo / "multi.py").write_text(
        "line_a\nline_b\nline_c\n", encoding="utf-8"
    )
    _git(repo, "add", "multi.py")
    _git(repo, "commit", "-m", "multi")
    (repo / "multi.py").write_text("line_a\nline_c\n", encoding="utf-8")
    g = GitRepo(repo)
    diffs = g.diff(scope=DiffScope.UNSTAGED)
    fd = next(d for d in diffs if d.path == "multi.py")
    assert len(fd.hunks) == 1
    h = fd.hunks[0]
    # new_count == 0 for pure deletion: affected_lines returns [new_start]
    assert h.new_count == 0
    assert h.affected_lines == [h.new_start]

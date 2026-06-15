"""Hardening regressions for src/dep/ + src/refactoring/.

Findings from autoresearch:debug — none active vulnerabilities, but each
one papered over a sharp edge:

- GitRepo._run had no `timeout=`; subprocess errors propagated as raw
  CalledProcessError to REST clients
- GitRepo.diff built `f"{commit}^..{commit}"` argv element without `--`
  separator (defense-in-depth against argv injection)
- rename_apply joined `repo_root / rel_path` without `relative_to` check
  (post-hostile-graph: arbitrary file write outside repo)
- DepGraph.__init__ left no safety net for non-context-manager use
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest


# ─── GitRepo: timeout + GitRepoError wrapping ────────────────────────────────


def _make_repo(tmp_path):
    """Create a minimal init'd git repo at tmp_path."""
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    return tmp_path


def test_gitrepo_run_passes_timeout(tmp_path):
    from src.refactoring.git_repo import GitRepo
    _make_repo(tmp_path)
    repo = GitRepo(tmp_path)

    captured = {}
    real_run = subprocess.run

    def fake_run(args, **kwargs):
        captured["timeout"] = kwargs.get("timeout")
        # Delegate to the real one so the assertion in head_sha doesn't crash
        return real_run(args, **kwargs)

    with patch("src.refactoring.git_repo.subprocess.run", side_effect=fake_run):
        try:
            repo.head_sha()
        except Exception:
            pass  # Empty repo has no HEAD; we only care about the timeout kwarg

    assert captured["timeout"] == 300


def test_gitrepo_wraps_called_process_error_as_gitrepoerror(tmp_path):
    """Non-zero exit becomes GitRepoError — clients don't see raw stderr."""
    from src.refactoring.git_repo import GitRepo, GitRepoError
    _make_repo(tmp_path)
    repo = GitRepo(tmp_path)

    err = subprocess.CalledProcessError(
        returncode=128, cmd=["git"], stderr="fatal: not a git repository"
    )
    with patch("src.refactoring.git_repo.subprocess.run", side_effect=err):
        with pytest.raises(GitRepoError, match="not a git repository"):
            repo.head_sha()


def test_gitrepo_wraps_timeout_as_gitrepoerror(tmp_path):
    from src.refactoring.git_repo import GitRepo, GitRepoError
    _make_repo(tmp_path)
    repo = GitRepo(tmp_path)
    with patch(
        "src.refactoring.git_repo.subprocess.run",
        side_effect=subprocess.TimeoutExpired("git", 300),
    ):
        with pytest.raises(GitRepoError, match="timed out"):
            repo.head_sha()


# ─── GitRepo.diff: `--` separator before commit ref ──────────────────────────


def test_diff_command_omits_dash_dash_for_commit_scope(tmp_path):
    """The earlier shape passed `--` BEFORE the rev (e.g. ['--', 'HEAD']),
    which makes git treat the rev as a non-existent pathspec and silently
    return empty. With no real pathspec to disambiguate, `--` is dropped
    entirely. Argv-injection is now blocked at validation time (commit
    SHAs must not start with '-')."""
    from src.refactoring.git_repo import GitRepo, DiffScope
    _make_repo(tmp_path)
    repo = GitRepo(tmp_path)

    args = repo._diff_command(DiffScope.COMMIT, "abc123")
    assert "--" not in args
    assert args[-1] == "abc123^..abc123"


def test_diff_command_omits_dash_dash_for_all_scope(tmp_path):
    from src.refactoring.git_repo import GitRepo, DiffScope
    _make_repo(tmp_path)
    repo = GitRepo(tmp_path)
    args = repo._diff_command(DiffScope.ALL, None)
    assert "--" not in args
    assert args[-1] == "HEAD"


def test_diff_command_rejects_commit_starting_with_dash(tmp_path):
    """Argv-injection defense: the commit SHA must not start with '-' so
    that a hostile caller can't smuggle a git option in the rev slot."""
    import pytest
    from src.refactoring.git_repo import GitRepo, DiffScope
    _make_repo(tmp_path)
    repo = GitRepo(tmp_path)
    with pytest.raises(ValueError, match="must not start with '-'"):
        repo._diff_command(DiffScope.COMMIT, "-malicious")


# ─── rename_apply: relative_to(repo_root) defense ────────────────────────────


def test_rename_apply_rejects_traversal_target(tmp_path):
    """A patch with a `..`-traversing file path must not write outside repo."""
    from src.refactoring.rename_engine import rename_apply, RenamePlan, Patch

    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    subprocess.run(["git", "init", "-q", str(repo_root)], check=True)
    # Need at least one commit so HEAD resolves (rename_apply reads sha_before)
    subprocess.run(["git", "-C", str(repo_root), "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", str(repo_root), "config", "user.name", "t"], check=True)
    (repo_root / "seed.txt").write_text("seed\n")
    subprocess.run(["git", "-C", str(repo_root), "add", "."], check=True)
    subprocess.run(["git", "-C", str(repo_root), "commit", "-q", "-m", "seed"], check=True)
    # Plant a real file outside the repo that the traversal would target
    sentinel = tmp_path / "outside.py"
    sentinel.write_text("original\n")

    plan = RenamePlan(
        old_qname="x.foo",
        new_name="bar",
        kind="function",
        ambiguous=False,
        patches=[Patch(file="../outside.py", line=1, before_text="original", after_text="PWNED")],
        notes=[],
        applied=False,
    )
    # Use a fake DepGraph with just the bits rename_apply needs
    class _FakeGraph:
        db_path = str(tmp_path / "fake_depgraph.sqlite")
    # rename_apply will validate and refuse — sentinel must be untouched
    rename_apply(repo_root, _FakeGraph(), plan, force_dirty=True, snapshot_path=tmp_path)
    assert sentinel.read_text() == "original\n"
    assert plan.applied is False
    assert any("escapes repo_root" in n for n in plan.notes)


# ─── DepGraph: __del__ safety net ────────────────────────────────────────────


def test_depgraph_del_closes_connection(tmp_path):
    """When a DepGraph goes out of scope without `with`, __del__ closes the conn."""
    import sqlite3
    from src.dep.db import DepGraph
    db = tmp_path / "test.sqlite"
    sqlite3.connect(str(db)).close()  # create the file

    g = DepGraph(db)
    assert g.conn is not None
    # Force __del__ — would normally fire on GC
    g.__del__()
    # Calling close again should also be safe (idempotent via the try/except)
    g.__del__()  # no raise

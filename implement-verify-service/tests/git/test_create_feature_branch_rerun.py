"""create_feature_branch rerun-idempotency: switching to an existing branch must
not abort when the working tree holds regenerated *untracked* files that the
branch already tracks (the re-run case). The new versions win; branch history
is preserved.
"""

import subprocess

import pytest

from src.git.git_manager import GitManager


def _git(repo, *args):
    return subprocess.run(
        ["git", *args], cwd=repo, check=True, capture_output=True, text=True,
        encoding="utf-8",
    )


@pytest.fixture
def repo(tmp_path):
    r = tmp_path / "repo"
    r.mkdir()
    _git(r, "init")
    _git(r, "config", "user.email", "t@t")
    _git(r, "config", "user.name", "t")
    _git(r, "checkout", "-b", "main")
    (r / "README.md").write_text("base\n", encoding="utf-8")
    _git(r, "add", "-A")
    _git(r, "commit", "-m", "base")  # main has NO app.py
    # an existing feature branch that DOES track app.py
    _git(r, "checkout", "-b", "feature/x")
    (r / "app.py").write_text("BRANCH version\n", encoding="utf-8")
    _git(r, "add", "-A")
    _git(r, "commit", "-m", "feat")
    _git(r, "checkout", "main")  # app.py leaves the working tree
    return r


def test_existing_branch_with_conflicting_untracked_keeps_new_version(repo):
    # the implement step regenerated app.py as an UNTRACKED file on main
    (repo / "app.py").write_text("REGENERATED\n", encoding="utf-8")

    gm = GitManager(repo, provider="github", default_branch="main")
    # Plain `git checkout feature/x` would abort here; the fix must succeed.
    gm.create_feature_branch("feature/x")

    on = _git(repo, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    assert on == "feature/x"
    # the regenerated (new) version wins, not the branch's committed version
    assert (repo / "app.py").read_text(encoding="utf-8") == "REGENERATED\n"
    # branch history preserved (the feat commit is still there)
    log = _git(repo, "log", "--oneline").stdout
    assert "feat" in log


def test_existing_branch_no_conflict_still_works(repo):
    # untracked file the branch does NOT track — plain checkout path, unaffected
    (repo / "other.py").write_text("new\n", encoding="utf-8")
    gm = GitManager(repo, provider="github", default_branch="main")
    gm.create_feature_branch("feature/x")
    on = _git(repo, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    assert on == "feature/x"
    assert (repo / "other.py").read_text(encoding="utf-8") == "new\n"

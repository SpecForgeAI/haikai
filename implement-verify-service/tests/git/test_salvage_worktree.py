"""Salvage-worktree correctness (2026-08-15).

The rail's "Resume (salvage last spec)" marks the failed spec IMPLEMENTED on
the strength of whatever this function pushes — so it must salvage the RIGHT
attempt's branch and must refuse when there is nothing to salvage (a branch
whose tip still equals its creation base carries zero spec work; 'salvaging'
it would silently lose the spec).

REAL git repos in tmp dirs, mirroring test_run_branch_chaining.py.
"""

import subprocess
from pathlib import Path

import pytest

from src.git import worktree_runs as wr


def _run(cwd, *args):
    cp = subprocess.run(["git", "-C", str(cwd), *args],
                        capture_output=True, text=True)
    assert cp.returncode == 0, cp.stderr
    return cp.stdout


@pytest.fixture
def live_repo(tmp_path):
    repo = tmp_path / "live"
    repo.mkdir()
    _run(repo, "init", "-b", "main")
    _run(repo, "config", "user.email", "t@t")
    _run(repo, "config", "user.name", "t")
    (repo / "a.txt").write_text("a")
    _run(repo, "add", "-A")
    _run(repo, "commit", "-m", "init")
    bare = tmp_path / "origin.git"
    _run(repo, "clone", "--bare", str(repo), str(bare))
    _run(repo, "remote", "add", "origin", str(bare))
    _run(repo, "fetch", "origin")
    return repo


def _worktree_with_work(live_repo, tmp_path, branch, filename=None,
                        commit=False):
    wt = tmp_path / f"wt-{branch.replace('/', '-')}"
    wr.add_worktree(live_repo, wt, branch, "main")
    if filename:
        (wt / filename).write_text(filename)
        if commit:
            _run(wt, "add", "-A")
            _run(wt, "commit", "-m", filename)
    return wt


def test_salvage_commits_and_pushes_dirty_worktree(live_repo, tmp_path):
    _worktree_with_work(live_repo, tmp_path, "feature/spec-a", "work.txt")
    out = wr.salvage_spec_worktree(live_repo, "spec-a")
    assert out["status"] == "salvaged"
    assert out["branch"] == "feature/spec-a"
    assert out["committed"] is True
    # Pushed: the branch resolves on origin.
    cp = subprocess.run(["git", "-C", str(live_repo), "rev-parse",
                         "origin/feature/spec-a"], capture_output=True, text=True)
    assert cp.returncode == 0


def test_salvage_prefers_exact_branch_over_stale_retry(live_repo, tmp_path):
    """A manual Resume re-stamps the item to the BASE name, so the newest
    work can sit on the suffix-less branch while an old wedged -r2 tree
    lingers. Highest--rN-wins salvaged the stale attempt."""
    _worktree_with_work(live_repo, tmp_path, "feature/spec-b-r2",
                        "stale.txt", commit=True)
    _worktree_with_work(live_repo, tmp_path, "feature/spec-b",
                        "latest.txt", commit=True)
    out = wr.salvage_spec_worktree(live_repo, "spec-b")
    assert out["status"] == "salvaged"
    assert out["branch"] == "feature/spec-b"


def test_salvage_falls_back_to_surviving_retry_attempt(live_repo, tmp_path):
    """Only the -r3 tree survived (the base branch's worktree was reclaimed):
    salvage returns ITS branch so the driver can re-align the item's
    spec_name to the branch that actually holds the work."""
    _worktree_with_work(live_repo, tmp_path, "feature/spec-c-r3",
                        "late.txt", commit=True)
    out = wr.salvage_spec_worktree(live_repo, "spec-c")
    assert out["status"] == "salvaged"
    assert out["branch"] == "feature/spec-c-r3"


def test_vacuous_salvage_refused(live_repo, tmp_path):
    """Clean tree + tip == recorded creation base -> nothing_to_salvage,
    NEVER 'salvaged' (which would mark the spec implemented with no diff)."""
    _worktree_with_work(live_repo, tmp_path, "feature/spec-d")  # no work at all
    out = wr.salvage_spec_worktree(live_repo, "spec-d")
    assert out["status"] == "nothing_to_salvage"
    assert "resume WITHOUT salvage" in out["message"]


def test_clean_but_committed_ahead_of_base_still_salvages(live_repo, tmp_path):
    """The run died AFTER committing but before/while pushing: clean tree,
    tip ahead of the recorded base -> genuinely salvageable."""
    _worktree_with_work(live_repo, tmp_path, "feature/spec-e",
                        "done.txt", commit=True)
    out = wr.salvage_spec_worktree(live_repo, "spec-e")
    assert out["status"] == "salvaged"
    assert out["committed"] is False  # nothing NEW committed by salvage


def test_no_worktree_refused(live_repo):
    out = wr.salvage_spec_worktree(live_repo, "never-existed")
    assert out["status"] == "no_worktree"


# --------------------------------------------------------------------------
# Folder-aware salvage (2026-09-05)
# --------------------------------------------------------------------------

def test_folder_target_branch_suffix_is_matched_and_ranked(live_repo, tmp_path):
    """Folder targets name branches feature/<spec>[-rN]--<folder>; the suffix-
    less name drives exact/retry matching and the returned branch keeps the
    suffix (that is what the run item records)."""
    _worktree_with_work(live_repo, tmp_path, "feature/spec-f--svc", "f.txt")
    _worktree_with_work(live_repo, tmp_path, "feature/spec-f-r2--svc", "f2.txt")
    # A same-spec branch for ANOTHER folder must not be picked up.
    _worktree_with_work(live_repo, tmp_path, "feature/spec-f--other", "o.txt")
    out = wr.salvage_spec_worktree(live_repo, "spec-f", folder="svc")
    assert out["status"] == "salvaged"
    assert out["branch"] == "feature/spec-f--svc"  # exact beats the stale -r2
    # Without a folder, suffixed branches are NOT candidates.
    assert wr.salvage_spec_worktree(live_repo, "spec-f")["status"] == "no_worktree"
    assert wr.has_spec_worktree(live_repo, "spec-f", "svc") is True
    assert wr.has_spec_worktree(live_repo, "spec-f", "nope") is False


def _project_with_repo_folder(tmp_path, live_repo, folder):
    project = tmp_path / "project"
    project.mkdir()
    # The live repo becomes the nested repo folder (folder-target layout).
    dest = project / folder
    live_repo.rename(dest)
    return project, dest


def test_in_project_root_repo_uses_plain_branch(live_repo, tmp_path):
    _worktree_with_work(live_repo, tmp_path, "feature/spec-g", "g.txt")
    resolver = lambda p: [(None, p)]
    out = wr.salvage_spec_worktree_in_project(live_repo, "spec-g", resolver)
    assert out["status"] == "salvaged"
    assert out["branch"] == "feature/spec-g"
    assert out["folder"] is None


def test_in_project_folder_target_salvages_the_suffixed_branch(live_repo, tmp_path):
    """The layout that was refused as 'not a git repository root': one repo
    folder nested under the project directory."""
    # Lay the folder-target shape out FIRST (a moved main repo would break the
    # worktree's back-link), then add the spec's worktree from the nested repo.
    project, repo_dir = _project_with_repo_folder(tmp_path, live_repo, "svc")
    assert not (project / ".git").exists()
    _worktree_with_work(repo_dir, tmp_path, "feature/spec-h--svc", "h.txt")
    resolver = lambda p: [("svc", p / "svc")]
    out = wr.salvage_spec_worktree_in_project(project, "spec-h", resolver)
    assert out["status"] == "salvaged"
    assert out["branch"] == "feature/spec-h--svc"
    assert out["folder"] == "svc"


def test_in_project_no_target_is_a_loud_error(tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    out = wr.salvage_spec_worktree_in_project(empty, "spec-i", lambda p: [])
    assert out["status"] == "error"
    assert "nothing to salvage in" in out["message"]


def test_in_project_polyrepo_unambiguous_salvages_the_one_holding_target(live_repo, tmp_path):
    _worktree_with_work(live_repo, tmp_path, "feature/spec-j--api", "j.txt")
    other = tmp_path / "other"
    other.mkdir()
    _run(other, "init", "-b", "main")
    resolver = lambda p: [("api", live_repo), ("web", other)]
    out = wr.salvage_spec_worktree_in_project(tmp_path, "spec-j", resolver)
    assert out["status"] == "salvaged"
    assert out["folder"] == "api"
    assert out["branch"] == "feature/spec-j--api"


def test_in_project_polyrepo_ambiguous_is_refused_before_touching_anything(live_repo, tmp_path):
    _worktree_with_work(live_repo, tmp_path, "feature/spec-k--api", "k.txt")
    # Second target: an independent repo also holding a worktree for the spec.
    second = tmp_path / "second"
    second.mkdir()
    _run(second, "init", "-b", "main")
    _run(second, "config", "user.email", "t@t")
    _run(second, "config", "user.name", "t")
    (second / "b.txt").write_text("b")
    _run(second, "add", "-A")
    _run(second, "commit", "-m", "init")
    wt2 = tmp_path / "wt-second"
    wr.add_worktree(second, wt2, "feature/spec-k--web", "main")
    (wt2 / "k2.txt").write_text("k2")
    resolver = lambda p: [("api", live_repo), ("web", second)]
    out = wr.salvage_spec_worktree_in_project(tmp_path, "spec-k", resolver)
    assert out["status"] == "error"
    assert "refused before touching anything" in out["message"]
    # Nothing was committed in either worktree.
    assert _run(wt2, "status", "--porcelain").strip() != ""

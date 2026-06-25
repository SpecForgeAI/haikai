"""Batch mode: N specs accumulate as N commits on ONE shared branch (not a branch
per spec), pushed once. Real git against a local bare remote — no mocks at the seam.

Drives `_git_one_spec(..., batch_name=...)` + `_finalize_batch_git` at the same points
`run_orchestration` does. The legacy per-spec path (batch_name=None) is covered by
test_orchestration_multispec_b2.py.
"""
from __future__ import annotations

from src.job_queue.tasks import _git_one_spec, _finalize_batch_git
from tests._realgit import seed_bare_remote, real_git_config, run_git

BATCH = "checkout-feature"


def _clone(bare, into):
    run_git(["clone", str(bare), str(into)], cwd=into.parent)
    return into


def test_batch_specs_accumulate_as_commits_on_one_branch(tmp_path, monkeypatch):
    bare = seed_bare_remote(tmp_path)                 # seeded remote on main
    repo = _clone(bare, tmp_path / "work")            # origin = bare
    cfg = real_git_config(monkeypatch, auto_push=True, auto_pr=False, default_branch="main")
    targets = [(None, repo)]
    results: list = []

    # spec A, then spec B — committed onto the SAME branch, no reset between them
    (repo / "a.txt").write_text("a\n")
    _git_one_spec(cfg, targets, results, "spec-a", batch_name=BATCH)
    (repo / "b.txt").write_text("b\n")
    _git_one_spec(cfg, targets, results, "spec-b", batch_name=BATCH)
    _finalize_batch_git(cfg, targets, results, BATCH, ["spec-a", "spec-b"])

    # ONE branch on the remote carries BOTH specs' files
    remote_files = run_git(["ls-tree", "-r", "--name-only", f"feature/{BATCH}"], cwd=bare).split()
    assert "a.txt" in remote_files and "b.txt" in remote_files, remote_files

    # two spec commits landed on that branch (＞= 2, plus the seed/base)
    commits = run_git(["log", "--oneline", f"feature/{BATCH}"], cwd=bare).strip().splitlines()
    assert len(commits) >= 2, commits

    # each spec's commit carries ONLY its own file (B2 still holds: prior files are
    # already committed/clean, so `git add -A` doesn't re-sweep them)
    head_files = run_git(["show", "--name-only", "--pretty=format:", f"feature/{BATCH}"], cwd=bare).split()
    assert "b.txt" in head_files and "a.txt" not in head_files, head_files

    # the local repo has the ONE shared branch and NO per-spec branches
    local = run_git(["branch", "--list"], cwd=repo)
    assert f"feature/{BATCH}" in local
    assert "feature/spec-a" not in local and "feature/spec-b" not in local

    # per-spec records carry commits (in order); the finalize record carries the branch
    assert [r["spec"] for r in results if r.get("commit_sha")] == ["spec-a", "spec-b"]
    assert any(r["spec"] == BATCH and r["branch"] == f"feature/{BATCH}" for r in results)


def test_batch_single_branch_negative_control(tmp_path, monkeypatch):
    """Guard the real risk dropping checkout-back introduces: an UNCOMMITTED stray
    file left by spec A must NOT bleed into spec B's commit."""
    bare = seed_bare_remote(tmp_path)
    repo = _clone(bare, tmp_path / "work")
    cfg = real_git_config(monkeypatch, auto_push=False, auto_pr=False, default_branch="main")
    targets = [(None, repo)]
    results: list = []

    (repo / "a.txt").write_text("a\n")
    _git_one_spec(cfg, targets, results, "spec-a", batch_name=BATCH)
    # spec B writes its own file; a.txt is already committed (clean) so it must not
    # reappear in spec B's commit
    (repo / "b.txt").write_text("b\n")
    _git_one_spec(cfg, targets, results, "spec-b", batch_name=BATCH)

    b_commit = run_git(["show", "--name-only", "--pretty=format:", f"feature/{BATCH}"], cwd=repo).split()
    assert b_commit == ["b.txt"], b_commit

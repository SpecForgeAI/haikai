"""B2 (D/C1): multi-spec orchestration commits each spec to its OWN branch with
ONLY that spec's files — proven via the interleaved per-spec git commit.

The bug: run_workflow wrote ALL specs' files, THEN the commit loop ran, so
`git add -A` on spec_1's branch swept spec_2's files in and spec_2's branch was
empty. The fix commits each spec (via on_spec_complete) before the next is
generated. Here we drive _git_one_spec at the same interleaving points with a
real local git repo (auto_push=False, so no remote)."""

from __future__ import annotations

import subprocess
import types

from src.job_queue.tasks import _git_one_spec, _resolve_git_targets


def _git_config():
    # Minimal stand-in for the loaded GitConfig: local-only (no push/PR).
    return types.SimpleNamespace(
        provider="github", default_branch="main",
        github_token=None, bitbucket_username=None, bitbucket_app_password=None,
        auto_push=False, auto_pr=False,
    )


def _repo(tmp_path):
    repo = tmp_path / "acme" / "proj"
    repo.mkdir(parents=True)

    def git(*a):
        return subprocess.run(["git", "-C", str(repo), *a], capture_output=True, text=True)

    git("init", "-q", "-b", "main")
    (repo / "base.txt").write_text("base\n")
    git("add", "-A")
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init")
    return repo, git


def test_each_spec_branch_contains_only_its_own_files(tmp_path, monkeypatch):
    monkeypatch.setenv("GIT_AUTHOR_NAME", "t"); monkeypatch.setenv("GIT_AUTHOR_EMAIL", "t@t")
    monkeypatch.setenv("GIT_COMMITTER_NAME", "t"); monkeypatch.setenv("GIT_COMMITTER_EMAIL", "t@t")
    repo, git = _repo(tmp_path)
    targets = [(None, repo)]
    cfg = _git_config()
    results: list = []  # C1/L3: per-(spec, repo) records accumulate here

    # Spec A is generated, THEN committed (only a.txt exists at this point).
    (repo / "a.txt").write_text("a\n")
    _git_one_spec(cfg, targets, results, "spec-a")
    # Spec B is generated next (on default, tree reset by checkout-back), THEN committed.
    (repo / "b.txt").write_text("b\n")
    _git_one_spec(cfg, targets, results, "spec-b")

    # feature/spec-a has a.txt but NOT b.txt; feature/spec-b has b.txt but NOT a.txt.
    a_files = git("ls-tree", "-r", "--name-only", "feature/spec-a").stdout.split()
    b_files = git("ls-tree", "-r", "--name-only", "feature/spec-b").stdout.split()
    assert "a.txt" in a_files and "b.txt" not in a_files, a_files
    assert "b.txt" in b_files and "a.txt" not in b_files, b_files
    # C1/L3: BOTH specs' branches are recorded — not collapsed to the last.
    assert [r["spec"] for r in results] == ["spec-a", "spec-b"]
    assert [r["branch"] for r in results] == ["feature/spec-a", "feature/spec-b"]
    assert all(r["error"] is None for r in results)
    assert all(r["commit_sha"] for r in results)


def test_resolve_git_targets_single_repo(tmp_path, monkeypatch):
    repo, _ = _repo(tmp_path)
    monkeypatch.setattr("src.job_queue.tasks.load_git_config", _git_config)
    req = types.SimpleNamespace(company="acme", project="proj")
    setup, err = _resolve_git_targets(req, str(tmp_path))
    assert err is None and setup[1] == [(None, repo)]


def test_resolve_git_targets_no_repo_returns_error(tmp_path, monkeypatch):
    monkeypatch.setattr("src.job_queue.tasks.load_git_config", _git_config)
    req = types.SimpleNamespace(company="acme", project="proj")
    setup, err = _resolve_git_targets(req, str(tmp_path))  # no repo created
    assert setup is None and "no repo targets" in err

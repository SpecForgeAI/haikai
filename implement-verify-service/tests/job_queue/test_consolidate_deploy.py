"""F2 — consolidate-at-deploy: merge N spec branches into an integration branch
and deploy the integrated whole. Real git; haibox mocked."""

from __future__ import annotations

import subprocess

import pytest

from src.job_queue.tasks import consolidate_and_deploy


def _repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()

    def git(*a):
        return subprocess.run(["git", "-C", str(repo), *a], capture_output=True, text=True)

    git("init", "-q", "-b", "main")
    (repo / "base.txt").write_text("base\n")
    git("add", "-A")
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init")
    return repo, git


def _branch_with(git, name, fname, content):
    git("checkout", "-q", "main")
    git("checkout", "-q", "-b", name)
    repo_dir = git("rev-parse", "--show-toplevel").stdout.strip()
    import os
    with open(os.path.join(repo_dir, fname), "w") as f:
        f.write(content)
    git("add", "-A")
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", name)
    git("checkout", "-q", "main")


def test_consolidate_merges_all_specs_and_deploys(tmp_path, monkeypatch):
    from pathlib import Path
    repo, git = _repo(tmp_path)
    _branch_with(git, "feature/a", "a.txt", "a\n")
    _branch_with(git, "feature/b", "b.txt", "b\n")

    # Capture the served source_dir AND whether it carried all specs AT PROVISION
    # TIME (the worktree is reclaimed right after, so we can't inspect it later).
    seen = {}
    def fake_provision(payload, client=None):
        sd = Path(payload["target"]["source_dir"])
        seen["source_dir"] = str(sd)
        seen["had_all"] = all((sd / f).exists() for f in ("a.txt", "b.txt", "base.txt"))
        return {"base_url": "http://127.0.0.1:9", "box_id": "box-int"}
    monkeypatch.setattr("src.haibox.integration.provision_for_job", fake_provision)

    branch_before = git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    res = consolidate_and_deploy(repo, ["feature/a", "feature/b"],
                                 {"command": ["python", "app.py"]}, default_branch="main")
    assert res["merged"] == ["feature/a", "feature/b"]
    assert res["base_url"] == "http://127.0.0.1:9" and res["box_id"] == "box-int"
    assert "integration_branch" not in res  # C2: the lie is gone

    # L3: the box was served an ISOLATED worktree snapshot carrying ALL specs.
    assert seen["had_all"], "worktree handed to haibox was missing specs"
    # L1: the worktree is reclaimed once the box has its copy — no leak.
    assert not Path(res["worktree"]).exists()
    # the LIVE repo is untouched: still on its original branch, clean tree.
    assert git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip() == branch_before
    assert not (repo / "a.txt").exists() and not (repo / "b.txt").exists()


def test_worktrees_are_distinct_and_reclaimed(tmp_path, monkeypatch):
    # L1 + L3: two consecutive deploys use DISTINCT worktrees, and BOTH are
    # reclaimed (no accumulating temp checkouts / .git/worktrees registrations).
    from pathlib import Path
    repo, git = _repo(tmp_path)
    _branch_with(git, "feature/a", "a.txt", "a\n")
    monkeypatch.setattr("src.haibox.integration.provision_for_job",
                        lambda payload, client=None: {"base_url": "u", "box_id": "b"})
    r1 = consolidate_and_deploy(repo, ["feature/a"], {"command": ["x"]}, default_branch="main")
    r2 = consolidate_and_deploy(repo, ["feature/a"], {"command": ["x"]}, default_branch="main")
    assert r1["worktree"] != r2["worktree"]
    assert not Path(r1["worktree"]).exists() and not Path(r2["worktree"]).exists()
    # the live repo has no leftover worktree registrations
    wt_list = git("worktree", "list").stdout
    assert "haibox-deploy-" not in wt_list


def test_consolidate_passes_backend_through_to_serve(tmp_path, monkeypatch):
    # A serve_spec carrying `backend` reaches provision_for_job's target so a deploy
    # can pick docker per job (per-request backend threaded up the target spec).
    repo, git = _repo(tmp_path)
    _branch_with(git, "feature/a", "a.txt", "a\n")
    seen = {}
    monkeypatch.setattr("src.haibox.integration.provision_for_job",
                        lambda payload, client=None: seen.update(payload["target"]) or
                        {"base_url": "u", "box_id": "b"})
    consolidate_and_deploy(repo, ["feature/a"],
                           {"command": ["x"], "image": "maven:3.9", "backend": "docker"},
                           default_branch="main")
    assert seen.get("backend") == "docker" and seen.get("image") == "maven:3.9"


def test_worktree_reclaimed_even_on_deploy_failure(tmp_path, monkeypatch):
    # L1: the finally tears the worktree down on the failure path too.
    from pathlib import Path
    repo, git = _repo(tmp_path)
    _branch_with(git, "feature/a", "a.txt", "a\n")
    seen = {}
    def boom(payload, client=None):
        seen["wt"] = payload["target"]["source_dir"]
        raise RuntimeError("haiboxd down")
    monkeypatch.setattr("src.haibox.integration.provision_for_job", boom)
    with pytest.raises(RuntimeError):
        consolidate_and_deploy(repo, ["feature/a"], {"command": ["x"]}, default_branch="main")
    assert not Path(seen["wt"]).exists()  # reclaimed despite the failure
    assert "haibox-deploy-" not in git("worktree", "list").stdout


def test_merge_conflict_raises(tmp_path, monkeypatch):
    repo, git = _repo(tmp_path)
    _branch_with(git, "feature/x", "base.txt", "x-version\n")   # both edit base.txt
    _branch_with(git, "feature/y", "base.txt", "y-version\n")
    monkeypatch.setattr("src.haibox.integration.provision_for_job",
                        lambda payload, client=None: {"base_url": "u", "box_id": "b"})
    with pytest.raises(RuntimeError) as ei:
        consolidate_and_deploy(repo, ["feature/x", "feature/y"], {"command": ["x"]}, default_branch="main")
    assert "conflict" in str(ei.value).lower()

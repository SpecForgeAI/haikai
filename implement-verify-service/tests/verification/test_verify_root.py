"""Parallel-worktrees S7 — composite verify run-root (D11, ADR 0001).

Implements the spec's 7 acceptance tests plus fetch-on-miss, setup_commands
infra classification, the absolute --db guard, and the unpinnable-repair
refusal. Real git repos, real sqlite, real subprocesses.
"""
from __future__ import annotations

import subprocess
import types
from pathlib import Path

import pytest

from src.git import worktree_runs as wr


def _run(cwd, *args):
    cp = subprocess.run(["git", "-C", str(cwd), *args],
                        capture_output=True, text=True)
    assert cp.returncode == 0, cp.stderr
    return cp.stdout.strip()


def _repo(path, marker):
    path.mkdir(parents=True, exist_ok=True)
    _run(path, "init", "-b", "main")
    _run(path, "config", "user.email", "t@t")
    _run(path, "config", "user.name", "t")
    (path / f"{marker}.txt").write_text(marker)
    _run(path, "add", "-A")
    _run(path, "commit", "-m", f"init {marker}")
    return _run(path, "rev-parse", "HEAD")


def _polyrepo_workspace(tmp_path):
    """Product root with NO .git (coordination meta root) + two repo subdirs."""
    ws = tmp_path / "ws"
    product = ws / "acme" / "shop"
    product.mkdir(parents=True)
    sha_a = _repo(product / "repo-a", "a")
    sha_b = _repo(product / "repo-b", "b")
    (product / "coordination.yaml").write_text("repos:\n  repo-a: {}\n  repo-b: {}\n")
    (product / "coordination.lock.yaml").write_text("repos: {}\n")
    spec = product / "haikai" / "specs" / "billing"
    (spec / "planning").mkdir(parents=True)
    (spec / "rubrics").mkdir(parents=True)
    (spec / "planning" / "requirements.md").write_text("req")
    (spec / "rubrics" / "r1.md").write_text("rubric")
    return ws, product, sha_a, sha_b


def test_acceptance_1_to_7_polyrepo_verify_root(tmp_path):
    ws, product, sha_a, sha_b = _polyrepo_workspace(tmp_path)
    bindings = {
        "repo-a": {"live_repo": product / "repo-a", "head_sha": sha_a},
        "repo-b": {"live_repo": product / "repo-b", "head_sha": None},  # unbound
    }
    info = wr.allocate_verify_root(str(ws), "acme", "shop", "vjob1234",
                                   bindings, specs=["billing"])
    try:
        # (7) works with no .git at the product root; (1) product root itself
        # was never worktree-add'ed (it isn't a repo — nothing to register).
        assert not (product / ".git").exists()
        # (2) each BOUND repo gets a detached worktree at its bound sha.
        assert _run(info["repos"]["repo-a"], "rev-parse", "HEAD") == sha_a
        assert _run(info["repos"]["repo-a"], "branch", "--show-current") == ""
        # unbound repo-b: NO worktree, listed unpinned (no fallback).
        assert "repo-b" not in info["repos"] and info["unpinned"] == ["repo-b"]
        # (3)+(4) context carries coordination files + spec tree + rubrics.
        ctx = info["context_dir"]
        assert (ctx / "coordination.yaml").exists()
        assert (ctx / "coordination.lock.yaml").exists()
        assert (ctx / "haikai" / "specs" / "billing" / "rubrics" / "r1.md").exists()
        assert (ctx / "haikai" / "specs" / "billing" / "planning" / "requirements.md").exists()
        # (5) explicit paths resolvable: repo cwd + spec context both exist.
        assert info["repos"]["repo-a"].is_dir() and ctx.is_dir()
        # (6) NO haikai/ files inside repo worktrees.
        assert not (info["repos"]["repo-a"] / "haikai").exists()
    finally:
        wr.reclaim_verify_root(str(ws), "acme", "shop",
                               info["allocated"], info["root"])
    assert not info["root"].exists()
    regs = [l for l in _run(product / "repo-a", "worktree", "list",
                            "--porcelain").splitlines()
            if l.startswith("worktree ")]
    assert len(regs) == 1  # zero leftover registrations


def test_verify_worktree_pins_bound_sha_not_tip(tmp_path):
    ws, product, sha_a, _ = _polyrepo_workspace(tmp_path)
    repo = product / "repo-a"
    (repo / "later.txt").write_text("newer work")
    _run(repo, "add", "-A")
    _run(repo, "commit", "-m", "tip moved past the bound sha")
    info = wr.allocate_verify_root(
        str(ws), "acme", "shop", "vjob1234",
        {"repo-a": {"live_repo": repo, "head_sha": sha_a}}, specs=["billing"])
    try:
        wt = info["repos"]["repo-a"]
        assert _run(wt, "rev-parse", "HEAD") == sha_a       # the bound commit,
        assert not (wt / "later.txt").exists()              # not the tip.
    finally:
        wr.reclaim_verify_root(str(ws), "acme", "shop",
                               info["allocated"], info["root"])


def test_fetch_on_miss_pulls_absent_sha(tmp_path):
    # remote with a commit the local clone hasn't fetched yet
    origin = tmp_path / "origin.git"
    origin.mkdir()
    _run(origin, "init", "--bare", "-b", "main")
    seed = tmp_path / "seed"
    _repo(seed, "base")
    _run(seed, "remote", "add", "origin", str(origin))
    _run(seed, "push", "origin", "main")

    ws = tmp_path / "ws"
    product = ws / "acme" / "shop"
    product.mkdir(parents=True)
    local = product / "repo-a"
    _run(tmp_path, "clone", str(origin), str(local))
    (product / "coordination.yaml").write_text("repos:\n  repo-a: {}\n")

    (seed / "ci.txt").write_text("ci commit")
    _run(seed, "add", "-A")
    _run(seed, "commit", "-m", "ci-built commit")
    _run(seed, "push", "origin", "main")
    remote_sha = _run(seed, "rev-parse", "HEAD")
    assert subprocess.run(["git", "-C", str(local), "cat-file", "-e",
                           f"{remote_sha}^{{commit}}"],
                          capture_output=True).returncode != 0  # absent locally

    info = wr.allocate_verify_root(
        str(ws), "acme", "shop", "vjob9999",
        {"repo-a": {"live_repo": local, "head_sha": remote_sha}}, specs=[])
    try:
        assert "repo-a" in info["repos"], info["unpinned"]  # fetched on miss
        assert _run(info["repos"]["repo-a"], "rev-parse", "HEAD") == remote_sha
    finally:
        wr.reclaim_verify_root(str(ws), "acme", "shop",
                               info["allocated"], info["root"])


def test_setup_commands_run_and_classify_infra(tmp_path):
    ws, product, sha_a, sha_b = _polyrepo_workspace(tmp_path)
    lock = product / "coordination.lock.yaml"
    lock.write_text(
        "repos:\n"
        "  repo-a:\n    setup_commands:\n      - python -c \"open('dep.txt','w').write('ok')\"\n"
        "  repo-b:\n    setup_commands:\n      - python -c \"import sys; sys.exit(3)\"\n"
    )
    bindings = {
        "repo-a": {"live_repo": product / "repo-a", "head_sha": sha_a},
        "repo-b": {"live_repo": product / "repo-b", "head_sha": sha_b},
    }
    info = wr.allocate_verify_root(str(ws), "acme", "shop", "vjob5555",
                                   bindings, specs=["billing"])
    try:
        infra = wr.run_setup_commands(info["context_dir"] / "coordination.lock.yaml",
                                      info["repos"],
                                      info["evidence_dir"] / "setup")
        assert infra == ["repo-b"]                       # setup failure = infra
        assert (info["repos"]["repo-a"] / "dep.txt").read_text() == "ok"
        assert "exit 3" in (info["evidence_dir"] / "setup" / "repo-b.log").read_text()
    finally:
        wr.reclaim_verify_root(str(ws), "acme", "shop",
                               info["allocated"], info["root"])


def test_runner_composes_absolute_db_and_explicit_paths(tmp_path, monkeypatch):
    """The composed /verify-task-group command never carries a relative --db
    (F8) and passes the D11 explicit paths + unpinned list; the verify root
    is reclaimed after the session."""
    from tests._realgit import local_repo_with_base, set_git_env
    from src.job_queue import tasks
    from src.job_queue.job_models import Job, JobStatus, JobType
    from src.job_queue.job_storage import JobStorage

    set_git_env(monkeypatch, auto_push=False, auto_pr=False)
    ws = (tmp_path / "ws").resolve()
    product = ws / "acme" / "shop"
    local_repo_with_base(product)  # single-repo: cells will be UNPINNABLE (no binding)
    spec = product / "haikai" / "specs" / "billing"
    (spec / "planning").mkdir(parents=True)
    monkeypatch.setenv("API_WORKSPACE_DIR", str(ws))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("VERIFICATION_DB_PATH", "relative-verify.db")  # the trap
    monkeypatch.chdir(tmp_path)

    captured = {}

    def _fake_build(project_dir, key):
        ex = types.SimpleNamespace()
        def _execute(command, timeout=None):
            captured["command"] = command
            captured["cwd"] = project_dir
            return {"success": True, "return_code": 0, "stdout": "", "stderr": ""}
        ex.execute = _execute
        return ex
    import src.backend_registry as br
    monkeypatch.setattr(br, "_build_cli_executor", _fake_build)

    storage = JobStorage(str(tmp_path / "jobs.db"))
    job = Job(job_id="vfy-1", type=JobType.VERIFY_TASK_GROUP,
              status=JobStatus.QUEUED, company="acme", project="shop",
              request_payload={"orchestrate_id": "orch-9",
                               "task_group_id": "billing", "repo": "app"})
    storage.save_job(job)
    tasks.run_verify_task_group("vfy-1", storage)

    cmd = captured["command"]
    db_arg = [t.split("=", 1)[1] for t in cmd.split()
              if t.startswith("verification_db=")][0]
    assert Path(db_arg).is_absolute(), cmd                 # F8 guard
    assert "context_dir=" in cmd and "repos_dir=" in cmd and "evidence_dir=" in cmd
    assert "unpinned_repos=" in cmd                        # no binding → unpinnable
    assert str(ws / "wt") in captured["cwd"]               # session cwd = verify root
    got = storage.get_job("vfy-1")
    assert got.status == JobStatus.COMPLETED
    assert not Path(got.result["verify_root"]).exists()    # reclaimed
    regs = [l for l in _run(product, "worktree", "list", "--porcelain").splitlines()
            if l.startswith("worktree ")]
    assert len(regs) == 1


def test_repair_dispatch_refused_for_unpinnable_cell(tmp_path, monkeypatch):
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    from src.verification import flow_graph as fg
    from src.verification import recorder
    conn = fg.connect(str(tmp_path / "verify.db"))
    recorder.record_verdict(conn, "o1", "g1", "app", "pytest", "fail")
    recorder.open_repair(conn, "o1", "g1", "app", "pytest", 1)
    ok, reason, _ = fg.validate_repair_target(
        conn, {"orchestrate_id": "o1", "task_group_id": "g1",
               "repo": "app", "verifier": "pytest", "attempt": 1})
    conn.close()
    assert not ok
    assert "no bound repo SHA" in reason

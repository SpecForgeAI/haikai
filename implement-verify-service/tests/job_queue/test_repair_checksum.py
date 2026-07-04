"""Parallel-worktrees S6 — repair mini-spec checksum hand-off (D8/W5).

Real sqlite verification store, real files, real allocator. The checksum is
computed at dispatch (enqueue_cli, live product root) and verified at
allocation (seeded copy) with the SAME function — a tampered or missing
hand-off refuses the repair.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.git import worktree_runs as wr
from src.haikai_models import OrchestrationRequest
from src.job_queue import enqueue_cli
from src.job_queue.job_models import Job, JobStatus, JobType
from src.job_queue.job_storage import JobStorage


SPEC = "billing-repair-app-attempt1"


def _live_workspace(tmp_path, monkeypatch, with_minispec=True):
    ws = (tmp_path / "ws").resolve()
    product = ws / "acme" / "shop"
    planning = product / "haikai" / "specs" / SPEC / "planning"
    if with_minispec:
        planning.mkdir(parents=True)
        (planning / "initialization.md").write_text("pip-audit red: urllib3 CVE\n")
        (planning / "requirements.md").write_text("bump urllib3 >= 1.26.19\n")
    else:
        product.mkdir(parents=True)
    monkeypatch.setenv("API_WORKSPACE_DIR", str(ws))
    monkeypatch.setenv("JOBS_DB_PATH", str(tmp_path / "jobs.db"))
    return ws, product


def _seed_open_repair(tmp_path):
    """Authoritative open_repair record the dispatch validates against."""
    import os
    vdb = str(tmp_path / "verify.db")
    os.environ["VERIFICATION_DB_PATH"] = vdb
    from src.verification import flow_graph as fg
    from src.verification import recorder
    conn = fg.connect(vdb)
    recorder.record_verdict(conn, "orch-1", "billing", "app", "pip-audit", "fail")
    recorder.open_repair(conn, "orch-1", "billing", "app", "pip-audit", 1)
    conn.close()
    return vdb


def _dispatch(vdb, capsys):
    payload = {
        "company": "acme", "project": "shop",
        "spec_intents": [{"spec_name": SPEC}],
        "repair_of": {"orchestrate_id": "orch-1", "task_group_id": "billing",
                      "repo": "app", "verifier": "pip-audit", "attempt": 1},
    }
    rc = enqueue_cli.main(["orchestration", "--json", json.dumps(payload),
                           "--db", vdb])
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    return rc, out


def test_dispatch_stamps_checksum_into_payload(tmp_path, monkeypatch, capsys):
    ws, product = _live_workspace(tmp_path, monkeypatch)
    vdb = _seed_open_repair(tmp_path)
    rc, out = _dispatch(vdb, capsys)
    assert rc == 0 and out.get("ok"), out
    storage = JobStorage(str(tmp_path / "jobs.db"))
    job = storage.get_job(out["job_id"])
    stamped = job.request_payload["spec_checksums"][SPEC]
    assert stamped == wr.spec_planning_checksum(product, SPEC)


def test_dispatch_refuses_when_minispec_missing(tmp_path, monkeypatch, capsys):
    _live_workspace(tmp_path, monkeypatch, with_minispec=False)
    vdb = _seed_open_repair(tmp_path)
    rc, out = _dispatch(vdb, capsys)
    assert rc == 1
    assert "mini-spec not found" in out["error"]


def _allocate_for(job, ws, storage):
    request = OrchestrationRequest(**job.request_payload)
    return __import__("src.job_queue.tasks", fromlist=["x"])._allocate_run_worktrees(
        job, request, str(ws), storage)


def test_allocation_verifies_seeded_checksum(tmp_path, monkeypatch, capsys):
    from tests._realgit import local_repo_with_base, set_git_env
    set_git_env(monkeypatch, auto_push=False, auto_pr=False)
    ws, product = _live_workspace(tmp_path, monkeypatch)
    local_repo_with_base(product)  # make the product a real repo
    vdb = _seed_open_repair(tmp_path)
    rc, out = _dispatch(vdb, capsys)
    assert rc == 0, out
    storage = JobStorage(str(tmp_path / "jobs.db"))
    job = storage.get_job(out["job_id"])

    # Matching hand-off → allocation succeeds.
    run_ws, allocated, err = _allocate_for(job, ws, storage)
    assert err is None and run_ws is not None
    seeded = Path(run_ws) / "acme" / "shop"
    assert wr.spec_planning_checksum(seeded, SPEC) == \
        job.request_payload["spec_checksums"][SPEC]
    # cleanup for the negative control below
    from src.job_queue import tasks
    request = OrchestrationRequest(**job.request_payload)
    tasks._reclaim_worktree_set(str(ws), request, allocated, Path(run_ws))


def test_allocation_fails_fast_on_tampered_minispec(tmp_path, monkeypatch, capsys):
    from tests._realgit import local_repo_with_base, set_git_env
    set_git_env(monkeypatch, auto_push=False, auto_pr=False)
    ws, product = _live_workspace(tmp_path, monkeypatch)
    local_repo_with_base(product)
    vdb = _seed_open_repair(tmp_path)
    rc, out = _dispatch(vdb, capsys)
    assert rc == 0, out
    storage = JobStorage(str(tmp_path / "jobs.db"))
    job = storage.get_job(out["job_id"])

    # NEGATIVE CONTROL: tamper with the mini-spec AFTER dispatch.
    (product / "haikai" / "specs" / SPEC / "planning" / "requirements.md"
     ).write_text("TAMPERED: rm -rf everything\n")
    run_ws, allocated, err = _allocate_for(job, ws, storage)
    assert run_ws is None and allocated == []
    assert "checksum mismatch" in err and "refusing the repair" in err
    # fail-fast unwound everything — no worktree registrations leak
    from tests._realgit import run_git
    regs = [l for l in run_git(["worktree", "list", "--porcelain"],
                               cwd=product).splitlines()
            if l.startswith("worktree ")]
    assert len(regs) == 1

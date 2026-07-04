"""Parallel-worktrees S8 â€” recovery/sweeper coherence (D14).

Storage- and allocator-level coverage of the pieces recovery relies on:
resume claims, reuse-if-alive (never re-seed), session copy-back at
reclamation, and the sweep resolver's layout mapping.
"""
from __future__ import annotations

from pathlib import Path

from src.git.worktree_runs import run_key as wr_run_key
from src.haikai_models import OrchestrationRequest
from src.job_queue import tasks
from src.job_queue.job_models import Job, JobStatus, JobType
from src.job_queue.job_storage import JobStorage
from tests._realgit import local_repo_with_base, run_git, set_git_env


def _job(**kw):
    kw.setdefault("request_payload", {})
    return Job(type=JobType.ORCHESTRATION, company="acme", project="shop", **kw)


def test_claim_job_accepts_queued_for_resume(tmp_path):
    storage = JobStorage(str(tmp_path / "jobs.db"))
    job = _job(status=JobStatus.QUEUED_FOR_RESUME, resume_from_step=3)
    storage.save_job(job)
    # The recovered-job dispatch path claims by id â€” must win on
    # QUEUED_FOR_RESUME exactly like on QUEUED.
    assert storage.claim_job(job.job_id, "api-background") is True
    got = storage.get_job(job.job_id)
    assert got.status == JobStatus.RUNNING and got.resume_from_step == 3


def _workspace(tmp_path, monkeypatch):
    set_git_env(monkeypatch, auto_push=False, auto_pr=False)
    ws = (tmp_path / "ws").resolve()
    product = ws / "acme" / "shop"
    local_repo_with_base(product)
    planning = product / "haikai" / "specs" / "spec-a" / "planning"
    planning.mkdir(parents=True)
    (planning / "requirements.md").write_text("req")
    monkeypatch.setenv("API_WORKSPACE_DIR", str(ws))
    return ws, product


def test_reuse_if_alive_resume_never_reseeds(tmp_path, monkeypatch):
    ws, product = _workspace(tmp_path, monkeypatch)
    storage = JobStorage(str(tmp_path / "jobs.db"))
    req = OrchestrationRequest(company="acme", project="shop",
                               spec_intents=[{"spec_name": "spec-a"}])
    job = _job(request_payload=req.model_dump())
    storage.save_job(job)

    run_ws, allocated, err = tasks._allocate_run_worktrees(job, req, str(ws), storage)
    assert err is None
    run_product = Path(run_ws) / "acme" / "shop"
    # Simulate mid-spec uncommitted state the resume must preserve.
    marker = run_product / "half-done.txt"
    marker.write_text("uncommitted mid-spec work")
    (run_product / "haikai" / "specs" / "spec-a" / "planning"
     / "requirements.md").write_text("EDITED MID-RUN")

    job = storage.get_job(job.job_id)
    job.resume_from_step = 3
    storage.save_job(job)
    run_ws2, allocated2, err2 = tasks._allocate_run_worktrees(job, req, str(ws), storage)
    assert err2 is None and run_ws2 == run_ws
    assert marker.read_text() == "uncommitted mid-spec work"      # tree reused
    assert (run_product / "haikai" / "specs" / "spec-a" / "planning"
            / "requirements.md").read_text() == "EDITED MID-RUN"  # NOT re-seeded
    tasks._reclaim_worktree_set(str(ws), req, allocated, Path(run_ws))


def test_session_copy_back_at_reclaim(tmp_path, monkeypatch):
    ws, product = _workspace(tmp_path, monkeypatch)
    storage = JobStorage(str(tmp_path / "jobs.db"))
    req = OrchestrationRequest(company="acme", project="shop",
                               spec_intents=[{"spec_name": "spec-a"}])
    job = _job(status=JobStatus.COMPLETED, request_payload=req.model_dump())
    storage.save_job(job)

    run_ws = tmp_path / "ws" / "wt" / wr_run_key(job.job_id)
    wt_spec = run_ws / "acme" / "shop" / "haikai" / "specs" / "spec-a"
    wt_spec.mkdir(parents=True)
    (wt_spec / "abc-session.jsonl").write_text('{"fresh": "per-step persist"}')
    (wt_spec / "active_session.json").write_text('{"session_id": "abc"}')

    tasks._reclaim_run_worktrees(job.job_id, storage, str(ws), req,
                                 allocated=[], run_workspace=str(run_ws))
    live_spec = product / "haikai" / "specs" / "spec-a"
    assert (live_spec / "abc-session.jsonl").read_text() == \
        '{"fresh": "per-step persist"}'                     # durable copy-back
    assert (live_spec / "active_session.json").exists()
    assert not run_ws.exists()                              # then reclaimed


def test_reclaim_skips_recovery_owned_tree(tmp_path, monkeypatch):
    ws, product = _workspace(tmp_path, monkeypatch)
    storage = JobStorage(str(tmp_path / "jobs.db"))
    req = OrchestrationRequest(company="acme", project="shop",
                               spec_intents=[{"spec_name": "spec-a"}])
    job = _job(status=JobStatus.QUEUED_FOR_RESUME, resume_from_step=2,
               request_payload=req.model_dump())
    storage.save_job(job)
    run_ws = tmp_path / "ws" / "wt" / wr_run_key(job.job_id)
    (run_ws / "acme" / "shop").mkdir(parents=True)
    tasks._reclaim_run_worktrees(job.job_id, storage, str(ws), req,
                                 allocated=[], run_workspace=str(run_ws))
    assert run_ws.exists()  # protected: the tree is an asset, not debris


def test_sweep_resolver_maps_both_layouts(tmp_path, monkeypatch):
    ws, product = _workspace(tmp_path, monkeypatch)
    job = _job()
    root = ws / "wt" / wr_run_key(job.job_id)
    # single/batch layout
    (root / "acme" / "shop").mkdir(parents=True)
    # per-spec layout
    (root / "spec-b" / "acme" / "shop").mkdir(parents=True)
    job = job.model_copy(update={
        "worktree_root": str(root),
        "request_payload": {"company": "acme", "project": "shop",
                            "spec_intents": [{"spec_name": "spec-a"}]}})
    pairs = tasks._sweep_resolver(job)
    worktrees = sorted(str(p[1]) for p in pairs)
    assert str(root / "acme" / "shop") in worktrees
    assert str(root / "spec-b" / "acme" / "shop") in worktrees
    assert all(str(p[0]) == str(product) for p in pairs)  # live repo mapped


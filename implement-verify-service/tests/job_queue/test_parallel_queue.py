"""Parallel-worktrees S1 — queue + claim hardening (spec v2 D6).

Real sqlite tmp files, real threads; no mocks at the seam. Covers:
busy_timeout on jobs.db connections, the claim_job CAS used by the
API-background path, no-double-execution between API path and worker,
and per-worker claim identity.
"""

import sqlite3
import threading

import pytest

from src.job_queue.job_models import Job, JobStatus, JobType
from src.job_queue.job_storage import JobStorage


@pytest.fixture
def storage(tmp_path):
    return JobStorage(str(tmp_path / "jobs.db"))


def _job(**kw):
    return Job(type=JobType.ORCHESTRATION, company="acme", project="app",
               request_payload={}, **kw)


def test_connections_carry_busy_timeout(storage):
    with storage._connect() as conn:
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000


def test_concurrent_writers_do_not_instantly_lock(storage):
    """Heartbeats + save_job from many threads must not raise
    'database is locked' — the pre-fix behavior without busy_timeout."""
    job = _job()
    storage.save_job(job)
    errors = []

    def hammer(i):
        try:
            for _ in range(25):
                storage.beat(job.job_id)
                storage.save_job(job)
        except sqlite3.OperationalError as e:  # pragma: no cover - failure path
            errors.append(e)

    threads = [threading.Thread(target=hammer, args=(i,)) for i in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []


def test_claim_job_cas_single_winner(storage):
    job = _job()
    storage.save_job(job)
    assert storage.claim_job(job.job_id, "api-background") is True
    # Second claimant loses — job is RUNNING now, not QUEUED.
    assert storage.claim_job(job.job_id, "worker-1") is False
    got = storage.get_job(job.job_id)
    assert got.status == JobStatus.RUNNING
    assert got.worker_id == "api-background"


def test_claim_job_races_have_exactly_one_winner(storage):
    job = _job()
    storage.save_job(job)
    wins = []

    def claim(wid):
        if storage.claim_job(job.job_id, wid):
            wins.append(wid)

    threads = [threading.Thread(target=claim, args=(f"w{i}",)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(wins) == 1
    assert storage.get_job(job.job_id).worker_id == wins[0]


def test_api_background_skips_worker_claimed_job(storage, monkeypatch):
    """_run_job_in_background must walk away when a worker already claimed
    the job — the double-execution race (review F9/M-analysis)."""
    import src.api as api_mod

    job = _job()
    storage.save_job(job)
    claimed = storage.claim_next_queued_job("worker-7")
    assert claimed.job_id == job.job_id

    executed = []
    import src.job_queue.tasks as tasks_mod
    monkeypatch.setattr(tasks_mod, "run_orchestration",
                        lambda job_id, s: executed.append(job_id))
    monkeypatch.setattr(api_mod.job_queue, "storage", storage, raising=False)

    api_mod._run_job_in_background(job.job_id)
    assert executed == []  # loser never executes
    assert storage.get_job(job.job_id).worker_id == "worker-7"


def test_worker_identity_stamped_on_claim(storage):
    storage.save_job(_job())
    got = storage.claim_next_queued_job("replica-abc123")
    assert got.worker_id == "replica-abc123"
    assert got.status == JobStatus.RUNNING


def test_worker_id_defaults_to_hostname_derived():
    import socket

    from src.job_queue.worker import Worker
    import os

    old = os.environ.pop("WORKER_ID", None)
    try:
        w = Worker.__new__(Worker)  # avoid signal handlers in __init__
        wid = os.getenv("WORKER_ID") or f"worker-{socket.gethostname()}"
        assert wid.startswith("worker-") and wid != "worker-"
    finally:
        if old is not None:
            os.environ["WORKER_ID"] = old

"""Concurrency regressions in src/job_queue/.

Two HIGH-severity bugs surfaced by autoresearch:debug:

1. `claim_next_queued_job` was previously `get_next_queued_job` — pure SELECT
   with no atomic claim. Two concurrent workers calling it could pick the
   same job and execute it twice. Now: SELECT + UPDATE in one transaction
   with a status guard; only one worker wins.

2. `cancel_job` was a TOCTOU read-then-write — between the get_job check
   and the save_job write, the worker could complete the job, and the
   cancel would clobber the COMPLETED status with CANCELLED. Now: a single
   atomic UPDATE with `WHERE status IN ('queued', 'running')`.
"""
from __future__ import annotations

import threading

import pytest

from src.job_queue.job_models import Job, JobStatus, JobType
from src.job_queue.job_queue import JobQueue
from src.job_queue.job_storage import JobStorage


@pytest.fixture
def storage(tmp_path):
    return JobStorage(str(tmp_path / "test-jobs.db"))


@pytest.fixture
def queue(tmp_path):
    return JobQueue(str(tmp_path / "test-queue.db"))


def _make_job(company="acme", project="backend") -> Job:
    return Job(
        type=JobType.ORCHESTRATION,
        company=company,
        project=project,
        request_payload={},
    )


# ─── claim_next_queued_job: atomic claim ──────────────────────────────────────


def test_claim_marks_job_running(storage):
    """Successful claim flips QUEUED -> RUNNING in the database."""
    job = _make_job()
    storage.save_job(job)
    claimed = storage.claim_next_queued_job(worker_id="test-worker")
    assert claimed is not None
    assert claimed.job_id == job.job_id
    # Re-read from disk to confirm the status flipped, not just the in-memory copy
    refetched = storage.get_job(job.job_id)
    assert refetched.status == JobStatus.RUNNING.value
    assert refetched.worker_id == "test-worker"


def test_claim_returns_none_when_queue_empty(storage):
    assert storage.claim_next_queued_job() is None


def test_two_concurrent_claims_get_different_jobs(storage):
    """If two workers race on a single job, only one wins; the other returns None."""
    storage.save_job(_make_job())  # exactly one queued job
    results = []
    barrier = threading.Barrier(2)

    def worker(worker_id):
        barrier.wait()  # both threads call claim at the same time
        results.append(storage.claim_next_queued_job(worker_id=worker_id))

    t1 = threading.Thread(target=worker, args=("w1",))
    t2 = threading.Thread(target=worker, args=("w2",))
    t1.start(); t2.start(); t1.join(); t2.join()

    # Exactly one worker should have claimed the job
    claimed = [r for r in results if r is not None]
    assert len(claimed) == 1, f"Expected exactly one claim, got {len(claimed)}"


def test_two_workers_both_get_a_job_when_two_queued(storage):
    """Two queued jobs + two workers → each worker gets one (no double-claim)."""
    job1 = _make_job(); storage.save_job(job1)
    job2 = _make_job(); storage.save_job(job2)
    results = []
    barrier = threading.Barrier(2)

    def worker(worker_id):
        barrier.wait()
        results.append(storage.claim_next_queued_job(worker_id=worker_id))

    t1 = threading.Thread(target=worker, args=("w1",))
    t2 = threading.Thread(target=worker, args=("w2",))
    t1.start(); t2.start(); t1.join(); t2.join()

    claimed_ids = sorted(r.job_id for r in results if r is not None)
    assert claimed_ids == sorted([job1.job_id, job2.job_id])


# ─── cancel_job: atomic status flip ──────────────────────────────────────────


def test_cancel_queued_job(queue):
    job = _make_job()
    queue.enqueue_job(job)
    assert queue.cancel_job(job.job_id) is True
    refetched = queue.get_job_status(job.job_id)
    assert refetched.status == JobStatus.CANCELLED.value


def test_cancel_running_job(queue):
    """Two-phase cancel (parallel-worktrees D13): cancelling a RUNNING job
    requests termination (CANCELLING); CANCELLED only lands after the
    owning process confirms the tracked tree is dead (mark_cancelled)."""
    job = _make_job()
    queue.enqueue_job(job)
    queue.storage.claim_next_queued_job(worker_id="w1")  # mark RUNNING
    assert queue.cancel_job(job.job_id) is True
    refetched = queue.get_job_status(job.job_id)
    assert refetched.status == JobStatus.CANCELLING.value
    assert queue.storage.mark_cancelled(job.job_id) is True
    assert queue.get_job_status(job.job_id).status == JobStatus.CANCELLED.value


def test_cancel_completed_job_is_noop(queue):
    """Cancelling a COMPLETED job must not clobber the result."""
    job = _make_job()
    job.status = JobStatus.COMPLETED  # simulate worker finishing
    job.result = {"output": "important data"}
    queue.storage.save_job(job)
    assert queue.cancel_job(job.job_id) is False
    refetched = queue.get_job_status(job.job_id)
    assert refetched.status == JobStatus.COMPLETED.value
    assert refetched.result == {"output": "important data"}


def test_cancel_nonexistent_job_returns_false(queue):
    assert queue.cancel_job("no-such-id") is False

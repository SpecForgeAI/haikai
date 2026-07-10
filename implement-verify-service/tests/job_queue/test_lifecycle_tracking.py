"""Parallel-worktrees S2 — job lifecycle states + tracked-process kill (D13).

Real sqlite tmp files and REAL child processes (a python sleeper) — the
kill path is exercised for real, not mocked.
"""

import subprocess
import sys
import threading
import time

import pytest

from src.job_queue import process_tracking as pt
from src.job_queue.job_models import (
    Job, JobStatus, JobType, PROTECTED_STATUSES, TERMINAL_STATUSES,
)
from src.job_queue.job_storage import JobStorage


@pytest.fixture
def storage(tmp_path):
    return JobStorage(str(tmp_path / "jobs.db"))


def _job(**kw):
    return Job(type=JobType.ORCHESTRATION, company="acme", project="app",
               request_payload={}, **kw)


def test_new_columns_round_trip(storage):
    job = _job(worktree_root=r"C:\ws\wt\abc12345", run_branch="feature/x",
               spec_idx=2, last_committed_spec_idx=1, resume_from_step=3)
    storage.save_job(job)
    got = storage.get_job(job.job_id)
    assert got.worktree_root == r"C:\ws\wt\abc12345"
    assert got.run_branch == "feature/x"
    assert (got.spec_idx, got.last_committed_spec_idx, got.resume_from_step) == (2, 1, 3)


def test_status_sets_are_disjoint_and_cover_new_states():
    assert TERMINAL_STATUSES.isdisjoint(PROTECTED_STATUSES)
    assert JobStatus.CANCELLING in PROTECTED_STATUSES
    assert JobStatus.QUEUED_FOR_RESUME in PROTECTED_STATUSES
    assert JobStatus.RESUMABLE_FAILED in PROTECTED_STATUSES
    assert JobStatus.ABANDONED in TERMINAL_STATUSES
    assert JobStatus.FAILED_NON_RESUMABLE in TERMINAL_STATUSES


def test_cancel_queued_goes_straight_to_cancelled(storage):
    job = _job()
    storage.save_job(job)
    assert storage.cancel_job(job.job_id) is True
    assert storage.get_job(job.job_id).status == JobStatus.CANCELLED


def test_cancel_running_is_two_phase(storage):
    job = _job(status=JobStatus.RUNNING)
    storage.save_job(job)
    assert storage.cancel_job(job.job_id) is True
    assert storage.get_job(job.job_id).status == JobStatus.CANCELLING
    # Owner confirms after killing its tree:
    assert storage.mark_cancelled(job.job_id) is True
    assert storage.get_job(job.job_id).status == JobStatus.CANCELLED
    # mark_cancelled is CANCELLING-only — refuses a second time.
    assert storage.mark_cancelled(job.job_id) is False


def test_cancel_terminal_job_refused(storage):
    job = _job(status=JobStatus.COMPLETED)
    storage.save_job(job)
    assert storage.cancel_job(job.job_id) is False


def test_claim_picks_up_queued_for_resume(storage):
    job = _job(status=JobStatus.QUEUED_FOR_RESUME, resume_from_step=2,
               worktree_root=r"C:\ws\wt\abc")
    storage.save_job(job)
    got = storage.claim_next_queued_job("w1")
    assert got is not None and got.job_id == job.job_id
    assert got.status == JobStatus.RUNNING
    assert got.resume_from_step == 2 and got.worktree_root == r"C:\ws\wt\abc"


def test_track_process_round_trip(storage):
    job = _job()
    storage.save_job(job)
    storage.track_process(job.job_id, 4242, "worker-1")
    assert storage.tracked_pid(job.job_id) == 4242
    storage.clear_process(job.job_id)
    assert storage.tracked_pid(job.job_id) is None


def _sleeper():
    return subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(120)"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        **({"start_new_session": True} if sys.platform != "win32" else {}),
    )


def test_kill_tree_kills_a_real_process():
    proc = _sleeper()
    assert pt.pid_alive(proc.pid)
    pt.kill_tree(proc.pid)
    assert pt.wait_dead(proc.pid, timeout_s=15)
    proc.wait(timeout=10)


def test_liveness_loop_kills_on_cancelling(storage, monkeypatch):
    """End-to-end D13: RUNNING job + tracked REAL process; cancel →
    CANCELLING; the owner's liveness loop kills the tree, confirms death,
    marks CANCELLED, clears the tracked handle."""
    monkeypatch.setattr(pt, "CANCEL_POLL_SECONDS", 0.2)
    monkeypatch.setattr(pt, "HEARTBEAT_INTERVAL_SECONDS", 1)

    job = _job(status=JobStatus.RUNNING)
    storage.save_job(job)
    proc = _sleeper()
    storage.track_process(job.job_id, proc.pid, "worker-1")

    stop = threading.Event()
    t = threading.Thread(target=pt.job_liveness_loop,
                         args=(storage, job.job_id, stop, "worker-1"),
                         daemon=True)
    t.start()
    try:
        assert storage.cancel_job(job.job_id) is True  # → CANCELLING
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if storage.get_job(job.job_id).status == JobStatus.CANCELLED:
                break
            time.sleep(0.2)
        assert storage.get_job(job.job_id).status == JobStatus.CANCELLED
        assert not pt.pid_alive(proc.pid)
        assert storage.tracked_pid(job.job_id) is None
    finally:
        stop.set()
        if pt.pid_alive(proc.pid):
            pt.kill_tree(proc.pid)
        proc.wait(timeout=10)


def test_liveness_loop_heartbeats(storage, monkeypatch):
    monkeypatch.setattr(pt, "CANCEL_POLL_SECONDS", 0.1)
    monkeypatch.setattr(pt, "HEARTBEAT_INTERVAL_SECONDS", 0)
    job = _job(status=JobStatus.RUNNING)
    storage.save_job(job)
    stop = threading.Event()
    t = threading.Thread(target=pt.job_liveness_loop,
                         args=(storage, job.job_id, stop, "api-background"),
                         daemon=True)
    t.start()
    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            age = storage.heartbeat_age_seconds(job.job_id)
            if age is not None and age < 5:
                break
            time.sleep(0.1)
        assert storage.heartbeat_age_seconds(job.job_id) is not None
    finally:
        stop.set()

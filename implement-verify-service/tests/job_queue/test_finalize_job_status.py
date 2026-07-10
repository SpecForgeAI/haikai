"""_finalize_job must map the orchestration outcome onto job.status.

The Implement UI (and any /api/v2/jobs poller) reads ONLY job.status — the
`success`/`outcome` inside job.result is never inspected. So a failed
orchestration that finalized as COMPLETED rendered as "Part N implementation
completed" in the browser (the masked-failure bug found driving the UI). These
tests lock job.status to OrchestrationResponse.success.
"""
from __future__ import annotations

from src.haikai_models import OrchestrationResponse
from src.job_queue.job_models import Job, JobStatus, JobType
from src.job_queue.job_storage import JobStorage
from src.job_queue.tasks import _finalize_job


def _job(storage: JobStorage, job_id: str) -> Job:
    job = Job(job_id=job_id, type=JobType.ORCHESTRATION,
              status=JobStatus.RUNNING, company="acme", project="shop",
              request_payload={})
    storage.save_job(job)
    return job


def _resp(success: bool, errors: list[str]) -> OrchestrationResponse:
    return OrchestrationResponse(
        success=success, spec_names=["s"], session_ids={"s": "sess"},
        results=[], total_execution_time_seconds=1.0,
        orchestration_log="log.json", errors=errors)


def test_failed_response_marks_job_failed(tmp_path):
    storage = JobStorage(str(tmp_path / "jobs.db"))
    job = _job(storage, "fail-1")
    resp = _resp(False, ["Step 1 (/write-spec) produced no spec.md"])
    _finalize_job(job, storage, resp, "fail-1")
    got = storage.get_job("fail-1")
    assert got.status == JobStatus.FAILED.value
    assert got.error and "write-spec" in got.error
    # Truth still recoverable in result for pollers that DO read it.
    assert got.result["success"] is False


def test_failed_with_empty_errors_still_fails(tmp_path):
    # The exact masking condition: success=False but no error strings recorded.
    storage = JobStorage(str(tmp_path / "jobs.db"))
    job = _job(storage, "fail-2")
    resp = _resp(False, [])
    _finalize_job(job, storage, resp, "fail-2")
    got = storage.get_job("fail-2")
    assert got.status == JobStatus.FAILED.value
    assert got.error  # a reason is filled in even when errors is empty


def test_successful_response_marks_job_completed(tmp_path):
    storage = JobStorage(str(tmp_path / "jobs.db"))
    job = _job(storage, "ok-1")
    resp = _resp(True, [])
    _finalize_job(job, storage, resp, "ok-1")
    got = storage.get_job("ok-1")
    assert got.status == JobStatus.COMPLETED.value


def test_cancel_is_preserved_over_failure(tmp_path):
    storage = JobStorage(str(tmp_path / "jobs.db"))
    job = _job(storage, "cancel-1")
    # A cancel raced in while the run was finishing.
    job.status = JobStatus.CANCELLED
    storage.save_job(job)
    resp = _resp(False, ["x"])
    _finalize_job(job, storage, resp, "cancel-1")
    got = storage.get_job("cancel-1")
    assert got.status == JobStatus.CANCELLED.value

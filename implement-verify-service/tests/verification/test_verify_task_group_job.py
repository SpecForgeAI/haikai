"""run_verify_task_group — the worker→loop-session dispatch (first fully wired job type)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.job_queue.job_models import Job, JobStatus, JobType
from src.job_queue.job_storage import JobStorage
from src.job_queue.tasks import run_verify_task_group


@pytest.fixture
def storage(tmp_path):
    return JobStorage(str(tmp_path / "jobs.db"))


def _job(payload=None, status=JobStatus.QUEUED):
    return Job(
        job_id="verify-test-1",
        type=JobType.VERIFY_TASK_GROUP,
        status=status,
        company="verification",
        project="slugify-svc",
        created_at=datetime.now(timezone.utc),
        request_payload=payload if payload is not None else {
            "orchestrate_id": "orch-x", "task_group_id": "g1", "repo": "slugify-svc",
        },
    )


class _FakeExecutor:
    last = None

    def __init__(self, project_dir, anthropic_api_key):
        _FakeExecutor.last = self
        self.project_dir = project_dir
        self.command = None

    def execute(self, command, system_prompt=None, timeout=None):
        self.command = command
        return {"success": True, "return_code": 0, "stdout": "gate: advanced", "stderr": "", "execution_time": 1.0}


class _FailingExecutor(_FakeExecutor):
    def execute(self, command, system_prompt=None, timeout=None):
        self.command = command
        return {"success": False, "return_code": 1, "stdout": "", "stderr": "session exploded", "execution_time": 1.0}


def test_dispatches_session_and_completes(storage, monkeypatch, tmp_path):
    monkeypatch.setenv("API_WORKSPACE_DIR", str(tmp_path / "ws"))
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setattr("src.claude_cli_executor.ClaudeCLIExecutor", _FakeExecutor)
    storage.save_job(_job())

    run_verify_task_group("verify-test-1", storage)

    job = storage.get_job("verify-test-1")
    assert job.status == JobStatus.COMPLETED.value
    cmd = _FakeExecutor.last.command
    assert cmd.startswith("/verify-task-group")
    assert "orchestrate_id=orch-x" in cmd and "task_group_id=g1" in cmd
    assert "verification_db=" in cmd
    assert job.result["stdout_tail"] == "gate: advanced"


def test_failed_session_marks_job_failed(storage, monkeypatch, tmp_path):
    monkeypatch.setenv("API_WORKSPACE_DIR", str(tmp_path / "ws"))
    monkeypatch.setattr("src.claude_cli_executor.ClaudeCLIExecutor", _FailingExecutor)
    storage.save_job(_job())

    run_verify_task_group("verify-test-1", storage)

    job = storage.get_job("verify-test-1")
    assert job.status == JobStatus.FAILED.value
    assert "session exploded" in job.error


def test_bad_payload_fails_without_dispatch(storage, monkeypatch):
    _FakeExecutor.last = None
    monkeypatch.setattr("src.claude_cli_executor.ClaudeCLIExecutor", _FakeExecutor)
    storage.save_job(_job(payload={"repo": "x"}))  # missing the correlation keys

    run_verify_task_group("verify-test-1", storage)

    job = storage.get_job("verify-test-1")
    assert job.status == JobStatus.FAILED.value
    assert "orchestrate_id" in job.error
    assert _FakeExecutor.last is None  # never launched a session


def test_cancelled_job_untouched(storage, monkeypatch):
    _FakeExecutor.last = None
    monkeypatch.setattr("src.claude_cli_executor.ClaudeCLIExecutor", _FakeExecutor)
    storage.save_job(_job(status=JobStatus.CANCELLED))

    run_verify_task_group("verify-test-1", storage)

    job = storage.get_job("verify-test-1")
    assert job.status == JobStatus.CANCELLED.value
    assert _FakeExecutor.last is None


def test_missing_job_raises(storage):
    with pytest.raises(ValueError):
        run_verify_task_group("nope", storage)

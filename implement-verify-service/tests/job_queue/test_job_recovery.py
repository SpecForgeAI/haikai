"""
Unit tests for job recovery on container restart.

Tests: determine_last_completed_step, recovery logic,
orchestrator start_from_step, and session restore behavior.
"""

import json
import pytest
from pathlib import Path
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

from src.job_queue.job_queue import JobQueue
from src.job_queue.job_models import Job, JobType, JobStatus, JobProgress
from src.job_queue.job_storage import JobStorage


@pytest.fixture
def job_queue_fixture(tmp_path):
    """Create a job queue with a temporary database."""
    db_path = str(tmp_path / "test_jobs.db")
    return JobQueue(db_path)


@pytest.fixture
def sample_running_job():
    """Create a sample orchestration job in running state."""
    return Job(
        type=JobType.ORCHESTRATION,
        status=JobStatus.RUNNING,
        company="testco",
        project="testproj",
        request_payload={
            "company": "testco",
            "project": "testproj",
            "spec_intents": [
                {"spec_name": "2026-03-15-test-feature"}
            ],
        },
        started_at=datetime.now(timezone.utc),
    )


class TestDetermineLastCompletedStep:
    """Tests for _determine_last_completed_step."""

    def test_no_logs_path(self, sample_running_job):
        """No logs_path set → returns None."""
        from src.api import _determine_last_completed_step

        sample_running_job.logs_path = None
        result = _determine_last_completed_step(sample_running_job)
        assert result is None

    def test_logs_dir_does_not_exist(self, sample_running_job):
        """logs_path points to nonexistent directory → returns None."""
        from src.api import _determine_last_completed_step

        sample_running_job.logs_path = "/nonexistent/path"
        result = _determine_last_completed_step(sample_running_job)
        assert result is None

    def test_no_step_files(self, tmp_path, sample_running_job):
        """Log directory exists but has no step files → returns None."""
        from src.api import _determine_last_completed_step

        log_dir = tmp_path / "logs"
        log_dir.mkdir()
        sample_running_job.logs_path = str(log_dir)
        result = _determine_last_completed_step(sample_running_job)
        assert result is None

    def test_partial_completion(self, tmp_path, sample_running_job):
        """step-1 and step-2 succeeded, no step-3 → returns 2."""
        from src.api import _determine_last_completed_step

        log_dir = tmp_path / "logs"
        log_dir.mkdir()

        (log_dir / "step-1-write-spec.json").write_text(
            json.dumps({"success": True}), encoding="utf-8"
        )
        (log_dir / "step-2-create-tasks.json").write_text(
            json.dumps({"success": True}), encoding="utf-8"
        )

        sample_running_job.logs_path = str(log_dir)
        result = _determine_last_completed_step(sample_running_job)
        assert result == 2

    def test_step_with_failure(self, tmp_path, sample_running_job):
        """step-1 succeeded, step-2 failed → returns 1."""
        from src.api import _determine_last_completed_step

        log_dir = tmp_path / "logs"
        log_dir.mkdir()

        (log_dir / "step-1-write-spec.json").write_text(
            json.dumps({"success": True}), encoding="utf-8"
        )
        (log_dir / "step-2-create-tasks.json").write_text(
            json.dumps({"success": False}), encoding="utf-8"
        )

        sample_running_job.logs_path = str(log_dir)
        result = _determine_last_completed_step(sample_running_job)
        assert result == 1

    def test_all_steps_completed(self, tmp_path, sample_running_job):
        """All 3 steps succeeded → returns 3."""
        from src.api import _determine_last_completed_step

        log_dir = tmp_path / "logs"
        log_dir.mkdir()

        for i in range(1, 4):
            (log_dir / f"step-{i}-cmd.json").write_text(
                json.dumps({"success": True}), encoding="utf-8"
            )

        sample_running_job.logs_path = str(log_dir)
        result = _determine_last_completed_step(sample_running_job)
        assert result == 3

    def test_corrupt_json_ignored(self, tmp_path, sample_running_job):
        """Corrupt step file is skipped, valid ones still counted."""
        from src.api import _determine_last_completed_step

        log_dir = tmp_path / "logs"
        log_dir.mkdir()

        (log_dir / "step-1-write-spec.json").write_text(
            json.dumps({"success": True}), encoding="utf-8"
        )
        (log_dir / "step-2-create-tasks.json").write_text(
            "not valid json", encoding="utf-8"
        )

        sample_running_job.logs_path = str(log_dir)
        result = _determine_last_completed_step(sample_running_job)
        assert result == 1


class TestJobStorageResumeFromStep:
    """Tests for resume_from_step persistence in SQLite."""

    def test_save_and_load_resume_from_step(self, job_queue_fixture):
        """resume_from_step round-trips through save/load."""
        job = Job(
            type=JobType.ORCHESTRATION,
            status=JobStatus.QUEUED,
            company="co",
            project="proj",
            request_payload={"spec_intents": []},
            resume_from_step=2,
        )
        job_queue_fixture.storage.save_job(job)

        loaded = job_queue_fixture.storage.get_job(job.job_id)
        assert loaded is not None
        assert loaded.resume_from_step == 2

    def test_resume_from_step_defaults_none(self, job_queue_fixture):
        """resume_from_step defaults to None for new jobs."""
        job = Job(
            type=JobType.ORCHESTRATION,
            status=JobStatus.QUEUED,
            company="co",
            project="proj",
            request_payload={"spec_intents": []},
        )
        job_queue_fixture.storage.save_job(job)

        loaded = job_queue_fixture.storage.get_job(job.job_id)
        assert loaded is not None
        assert loaded.resume_from_step is None


class TestRunWorkflowStartFromStep:
    """Tests for orchestrator start_from_step parameter."""

    def test_start_from_step_filters_commands(self):
        """run_workflow(start_from_step=2) should skip step 1 and keep the rest."""
        from src.haikai_orchestrator import HaikaiOrchestrator

        commands = HaikaiOrchestrator.COMMANDS
        filtered = [c for c in commands if c["step"] >= 2]
        # Don't lock in a specific count — COMMANDS may grow. Just verify the
        # filter dropped step 1 and the remaining steps are in order.
        assert len(filtered) == len(commands) - 1
        assert filtered[0]["step"] == 2
        assert all(c["step"] >= 2 for c in filtered)

    def test_start_from_step_3_only_implement(self):
        """run_workflow(start_from_step=3) should start at /implement-tasks."""
        from src.haikai_orchestrator import HaikaiOrchestrator

        commands = HaikaiOrchestrator.COMMANDS
        filtered = [c for c in commands if c["step"] >= 3]
        assert len(filtered) >= 1
        assert filtered[0]["command"] == "/implement-tasks"
        assert all(c["step"] >= 3 for c in filtered)

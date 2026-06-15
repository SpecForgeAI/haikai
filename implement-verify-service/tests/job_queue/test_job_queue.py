"""
Unit tests for job queue system.

Tests basic CRUD operations: create, retrieve, list, cancel jobs.
"""

import os
import pytest
import tempfile
from pathlib import Path

from src.job_queue.job_queue import JobQueue
from src.job_queue.job_models import Job, JobType, JobStatus


@pytest.fixture
def job_queue(tmp_path):
    """Create a job queue with a temporary database."""
    db_path = str(tmp_path / "test_jobs.db")
    return JobQueue(db_path)


@pytest.fixture
def sample_job():
    """Create a sample orchestration job."""
    return Job(
        type=JobType.ORCHESTRATION,
        company="test-company",
        project="test-project",
        request_payload={
            "company": "test-company",
            "project": "test-project",
            "spec_intents": ["Test spec intent"],
        }
    )


class TestJobQueue:
    """Test job queue CRUD operations."""

    def test_enqueue_job(self, job_queue, sample_job):
        """Test creating a job returns a valid job ID."""
        job_id = job_queue.enqueue_job(sample_job)
        assert job_id is not None
        assert len(job_id) > 0

    def test_get_job_status(self, job_queue, sample_job):
        """Test retrieving a job by ID."""
        job_id = job_queue.enqueue_job(sample_job)
        retrieved = job_queue.get_job_status(job_id)

        assert retrieved is not None
        assert retrieved.job_id == job_id
        assert retrieved.status == JobStatus.QUEUED
        assert retrieved.company == "test-company"
        assert retrieved.project == "test-project"

    def test_get_nonexistent_job(self, job_queue):
        """Test retrieving a job that doesn't exist returns None."""
        result = job_queue.get_job_status("nonexistent-id")
        assert result is None

    def test_list_jobs_by_company(self, job_queue, sample_job):
        """Test listing jobs filtered by company."""
        job_queue.enqueue_job(sample_job)
        jobs = job_queue.storage.list_jobs(company="test-company")
        assert len(jobs) >= 1
        assert all(j.company == "test-company" for j in jobs)

    def test_cancel_job(self, job_queue, sample_job):
        """Test cancelling a queued job."""
        job_id = job_queue.enqueue_job(sample_job)
        success = job_queue.cancel_job(job_id)

        assert success is True
        cancelled = job_queue.get_job_status(job_id)
        assert cancelled.status == JobStatus.CANCELLED

    def test_cancel_nonexistent_job(self, job_queue):
        """Test cancelling a nonexistent job returns False."""
        result = job_queue.cancel_job("nonexistent-id")
        assert result is False

    def test_no_queued_jobs_after_cancel(self, job_queue, sample_job):
        """Test that cancelled jobs don't appear as next queued."""
        job_id = job_queue.enqueue_job(sample_job)
        job_queue.cancel_job(job_id)
        next_job = job_queue.storage.get_next_queued_job()
        assert next_job is None

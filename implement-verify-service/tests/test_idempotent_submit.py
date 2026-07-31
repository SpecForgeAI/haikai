"""Idempotent orchestration submit (2026-07-31).

A duplicated dispatch of the SAME spec set (gateway tsx-watch reload
mid-submit -> boot-recovery re-kick ~19s later, duplicate advance, etc.)
must not spawn a second live job: the second one used to die minutes
later on the worktree branch lock and halt the run. The submit routes now
return the existing ACTIVE (queued/running) job for an identical
company/project/spec set; terminal jobs never match, so genuine re-runs
are unaffected.
"""
from __future__ import annotations

import types

import pytest

from src.api.routes.jobs import find_active_duplicate_orchestration
from src.haikai_models import OrchestrationRequest, SpecIntent
from src.job_queue.job_models import JobStatus, JobType


class _FakeStorage:
    def __init__(self, jobs):
        self._jobs = jobs
        self.queried_statuses = []

    def list_jobs(self, status=None, company=None, project=None, limit=100):
        self.queried_statuses.append(status)
        return [j for j in self._jobs if j.status == status]


class _FakeQueue:
    def __init__(self, jobs):
        self.storage = _FakeStorage(jobs)


def _job(job_id, status, spec_names, job_type=JobType.ORCHESTRATION):
    return types.SimpleNamespace(
        job_id=job_id,
        type=job_type,
        status=status,
        created_at="2026-07-31T00:00:00",
        request_payload={
            "spec_intents": [{"spec_name": n} for n in spec_names],
        },
    )


def _request(spec_names):
    return OrchestrationRequest(
        company="acme",
        project="proj",
        spec_intents=[SpecIntent(spec_name=n) for n in spec_names],
    )


def test_matching_active_job_is_returned():
    existing = _job("j1", JobStatus.RUNNING, ["2026-07-31-spec-a", "2026-07-31-spec-b"])
    queue = _FakeQueue([existing])

    found = find_active_duplicate_orchestration(
        queue, _request(["2026-07-31-spec-b", "2026-07-31-spec-a"])  # order-insensitive
    )

    assert found is existing


def test_queued_jobs_also_match():
    existing = _job("j1", JobStatus.QUEUED, ["2026-07-31-spec-a"])
    queue = _FakeQueue([existing])

    assert find_active_duplicate_orchestration(queue, _request(["2026-07-31-spec-a"])) is existing


def test_different_spec_set_is_not_a_duplicate():
    queue = _FakeQueue([_job("j1", JobStatus.RUNNING, ["2026-07-31-spec-a"])])

    assert find_active_duplicate_orchestration(queue, _request(["2026-07-31-spec-c"])) is None


def test_subset_is_not_a_duplicate():
    queue = _FakeQueue([_job("j1", JobStatus.RUNNING, ["2026-07-31-spec-a", "2026-07-31-spec-b"])])

    assert find_active_duplicate_orchestration(queue, _request(["2026-07-31-spec-a"])) is None


def test_terminal_jobs_never_block_a_rerun():
    # The fake only returns jobs for the statuses the scan asks about; a
    # completed job with the same set must not match because the scan only
    # queries queued/running.
    queue = _FakeQueue([_job("j1", JobStatus.COMPLETED, ["2026-07-31-spec-a"])])

    assert find_active_duplicate_orchestration(queue, _request(["2026-07-31-spec-a"])) is None
    assert set(queue.storage.queried_statuses) == {JobStatus.QUEUED, JobStatus.RUNNING}


def test_non_orchestration_jobs_are_ignored():
    other = _job("j1", JobStatus.RUNNING, ["2026-07-31-spec-a"], job_type=JobType.VERIFY_TASK_GROUP)
    queue = _FakeQueue([other])

    assert find_active_duplicate_orchestration(queue, _request(["2026-07-31-spec-a"])) is None


def test_storage_errors_fall_through_to_a_new_job():
    class _ExplodingStorage:
        def list_jobs(self, **kwargs):
            raise RuntimeError("db locked")

    queue = types.SimpleNamespace(storage=_ExplodingStorage())

    assert find_active_duplicate_orchestration(queue, _request(["2026-07-31-spec-a"])) is None


def test_request_without_intents_is_never_deduped():
    request = OrchestrationRequest.model_construct(
        company="acme", project="proj", spec_intents=[]
    )
    queue = _FakeQueue([_job("j1", JobStatus.RUNNING, [])])

    assert find_active_duplicate_orchestration(queue, request) is None

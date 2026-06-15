"""
Job queue interface for managing async jobs.

This module is the documented public boundary for job submission and
lifecycle queries — every caller outside `src/job_queue/` should go
through `JobQueue`, not `JobStorage` directly. Today the three public
methods are thin pass-throughs to `JobStorage`, but the class exists
as a stable seam so future cross-cutting concerns (queue-side retry,
priority scheduling, connection pooling, transactional wrappers,
metrics, in-flight cancellation broadcasts) can land here without
churning every call site.

Decision recorded 2026-05-20 (pass-3 deep-src-smells finding D-D1,
Option B): keep the seam. Removing the class would force every
future cross-cutting concern to either reopen this question or be
duplicated across all call sites. The 44 LOC of indirection is a
deliberate cost.

If the policy changes later — i.e. JobQueue still has no logic of
its own after another 6 months and no upcoming work needs the seam —
delete the class and rewrite this docstring to record THAT decision.
"""

from typing import Optional
from .job_models import Job, JobType, JobStatus
from .job_storage import JobStorage


class JobQueue:
    """Public boundary for async-job submission and lifecycle queries.

    Currently delegates every method to `JobStorage`. The seam is
    intentional: future cross-cutting concerns (retry, priority,
    pooling, broadcast, metrics) belong here, NOT scattered across
    every route that submits a job.

    Callers outside `src/job_queue/` MUST go through `JobQueue` —
    direct `JobStorage` access from routes / services bypasses the
    seam and any future logic it grows.
    """

    def __init__(self, db_path: str = "jobs.db"):
        self.storage = JobStorage(db_path)

    def enqueue_job(self, job: Job) -> str:
        """
        Add job to queue.

        Args:
            job: Job object to enqueue

        Returns:
            job_id: Unique identifier for the job
        """
        self.storage.save_job(job)
        return job.job_id

    def get_job_status(self, job_id: str) -> Optional[Job]:
        """
        Get current job status.

        Args:
            job_id: Unique identifier for the job

        Returns:
            Job object if found, None otherwise
        """
        return self.storage.get_job(job_id)

    def cancel_job(self, job_id: str) -> bool:
        """
        Cancel a queued or running job.

        Atomic: a single UPDATE flips the status only if it's still cancellable,
        avoiding a TOCTOU between read-status and write-cancelled where the
        worker could have completed the job in between.

        Returns:
            True if the job's status was actually flipped to CANCELLED.
        """
        return self.storage.cancel_job(job_id)

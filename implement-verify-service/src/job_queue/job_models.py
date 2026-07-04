"""
Pydantic models for job queue system.
"""

from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, Dict, Any
from datetime import datetime, timezone
from enum import Enum
import uuid


def _utc_now() -> datetime:
    """TZ-aware UTC now. Replaces deprecated datetime.utcnow."""
    return datetime.now(timezone.utc)


class JobStatus(str, Enum):
    """Job execution status.

    Parallel-worktrees (spec v2 D13/D14) two-phase cancel + recovery states:
    cancel requests termination (CANCELLING); CANCELLED only after the
    owning process confirms death. Recovery owns resumable jobs
    (RECOVERING/QUEUED_FOR_RESUME); the sweeper treats their worktrees as
    protected.
    """
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    CANCELLING = "cancelling"
    RECOVERING = "recovering"
    QUEUED_FOR_RESUME = "queued_for_resume"
    RESUMABLE_FAILED = "resumable_failed"
    FAILED_NON_RESUMABLE = "failed_non_resumable"
    ABANDONED = "abandoned"


# D14: worktree lifecycle derives from these sets, never raw status checks.
TERMINAL_STATUSES = frozenset({
    JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED,
    JobStatus.FAILED_NON_RESUMABLE, JobStatus.ABANDONED,
})
# Sweep-protected: a worktree in these states is never reclaimable.
PROTECTED_STATUSES = frozenset({
    JobStatus.RUNNING, JobStatus.CANCELLING, JobStatus.RECOVERING,
    JobStatus.QUEUED_FOR_RESUME, JobStatus.RESUMABLE_FAILED,
})


class JobType(str, Enum):
    """Type of job to execute."""
    ORCHESTRATION = "orchestration"
    WRITE_SPEC = "write-spec"
    GENERATE_TASKS = "generate-tasks"
    IMPLEMENT_TASKS = "implement-tasks"
    SHAPE_SPEC = "shape-spec"
    STANDARDS_PRODUCT = "standards-product"
    STANDARDS_GLOBAL = "standards-global"
    RUN_PIPELINE = "run-pipeline"
    VERIFY_TASK_GROUP = "verify-task-group"
    BUG_INVESTIGATION = "bug-investigation"
    HAIBOX_VERIFY = "haibox-verify"


class JobProgress(BaseModel):
    """Progress information for a running job."""
    current_step: int
    total_steps: int
    step_description: str
    percentage: int = Field(ge=0, le=100)


class Job(BaseModel):
    """Complete job information."""
    job_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: JobType
    status: JobStatus = JobStatus.QUEUED
    
    # Request context
    company: str
    project: str
    request_payload: Dict[str, Any]
    
    # Timestamps
    created_at: datetime = Field(default_factory=_utc_now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    
    # Progress
    progress: Optional[JobProgress] = None
    
    # Results
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    
    # Recovery / resume bookkeeping (spec v2 D14: per-spec (spec_idx, step))
    resume_from_step: Optional[int] = None
    spec_idx: Optional[int] = None
    last_committed_spec_idx: Optional[int] = None
    run_branch: Optional[str] = None

    # Worktree ownership (spec v2 W7: the job record is the sole source of
    # truth for the run's tree — recovery/cancel/sweep resolve from here)
    worktree_root: Optional[str] = None

    # Metadata
    worker_id: Optional[str] = None
    logs_path: Optional[str] = None

    # Pydantic V2 — replaces V1 `class Config:` form.
    model_config = ConfigDict(use_enum_values=True)


class JobResponse(BaseModel):
    """Response when creating a new job."""
    job_id: str
    status: JobStatus
    created_at: datetime

    # Pydantic V2 — replaces V1 `class Config:` form.
    model_config = ConfigDict(use_enum_values=True)


class JobDetailResponse(BaseModel):
    """Detailed response for job status queries."""
    job_id: str
    type: JobType
    status: JobStatus
    company: str
    project: str
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    progress: Optional[JobProgress]
    result: Optional[Dict[str, Any]]
    error: Optional[str]
    logs_url: Optional[str]

    # Pydantic V2 — replaces V1 `class Config:` form.
    model_config = ConfigDict(use_enum_values=True)

"""Bug intake (Gary's contract) — POST /api/v2/bugs/.

A bug is accepted, persisted, and an async investigation job is enqueued.
The worker runs an investigation/repair session against the target codebase;
when it finishes it POSTs a build-results record to the caller's `callback_url`.

The `outcome` is the shared enum (src/verification/outcomes.py) — the bug path
emits these four (snake_case — F6):
    deployed     -> fix kept (tests green) AND redeployed; payload carries
                    target_base_url + box_id -> caller re-reconciles the broken rows
    fix_unserved -> fix kept, but redeploy failed/unavailable -> HUMAN review
                    (the fix exists on disk; payload carries redeploy_error)
    not_fixed    -> investigated, no fix kept -> human review / re-file
    rejected     -> the target is actually correct (not a real bug) -> close
    error        -> precondition failure (unsafe target, not a git repo, ...)
The payload also carries: bug_id, bug_type, changed_files, haikai_verdict,
callback_delivered.

Auth: standard API bearer key (verify_api_key), like the other v2 endpoints.
The bug body is UNTRUSTED external text (D10.7) — stored as data, and fed to
the investigation agent fenced with an unguessable per-run nonce so it cannot
break out of its data block into instructions (predict R1).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ...api_auth import verify_api_key
from ...verification import store

logger = logging.getLogger(__name__)

router = APIRouter(tags=["bugs"])


class Media(BaseModel):
    url: Optional[str] = None
    name: Optional[str] = None
    content_type: Optional[str] = None
    data: Optional[str] = None  # inline/base64, if not by url


class BugRequest(BaseModel):
    # F6: snake_case is the canonical contract (the migration OAS is snake_case).
    # camelCase aliases keep any legacy caller working — populate_by_name accepts
    # BOTH `bug_description` and `bugDescription`, etc.
    model_config = ConfigDict(populate_by_name=True)

    bug_description: str = Field(..., min_length=1, alias="bugDescription")
    bug_type: str = Field(..., alias="bugType", description="e.g. 'reconciliation'")
    callback_url: str = Field(..., alias="callbackUrl", description="URL the service POSTs the result to")
    attachments: Optional[List[Media]] = None
    # The target codebase to investigate (workspace/company/project). REQUIRED for
    # bug_type=reconciliation so the success/failure callback is trustworthy.
    company: Optional[str] = None
    project: Optional[str] = None
    # Optional serve spec so a SUCCESSFUL fix can be REDEPLOYED before the callback
    # (D1). When present, the callback carries the fresh target_base_url + box_id.
    #
    # TRUST BOUNDARY (S2): `target.command` is executed verbatim by haiboxd on the
    # host. It is therefore TRUSTED INPUT — only the co-located, authenticated
    # peer (Haikai) may set it. It is NOT validated/allowlisted here; do not expose
    # this endpoint to an untrusted caller with a different trust level than the
    # worker→haiboxd control plane. Tightening (command allowlist + splitting the
    # consumer key from the haiboxd key, S3) is a tracked follow-up — see
    # plan/260613-1640-fix-endpoint-flaws/followups.md.
    target: Optional[dict] = None

    @model_validator(mode="after")
    def _require_target_for_reconciliation(self):
        # Normalize before matching (predict R5): an exact, case-sensitive check
        # let "Reconciliation" / "reconciliation " slip past the target requirement.
        if self.bug_type.strip().lower() == "reconciliation" and not (self.company and self.project):
            raise ValueError("company and project are required when bug_type=reconciliation")
        return self


class BugAccepted(BaseModel):
    bug_id: str
    job_id: str
    status: str = "accepted"


@router.post("/api/v2/bugs/", response_model=BugAccepted, status_code=status.HTTP_202_ACCEPTED, tags=["bugs"])
def submit_bug(request: BugRequest, authenticated: bool = Depends(verify_api_key)) -> BugAccepted:
    """Accept a bug, persist it, enqueue an investigation job, return 202."""
    from ...job_queue.job_models import Job, JobStatus, JobType
    from ...job_queue.job_queue import JobQueue

    bug_id = f"bug-{uuid.uuid4().hex[:12]}"
    conn = store.connect()
    try:
        store.record_bug(
            conn, bug_id,
            bug_type=request.bug_type,
            description=request.bug_description,
            callback_url=request.callback_url,
            attachments=[a.model_dump() for a in (request.attachments or [])],
            company=request.company or "",
            project=request.project or "",
        )
    finally:
        conn.close()

    from ...safe_paths import jobs_db_path
    jobs_db = jobs_db_path()
    job = Job(
        job_id=f"investigate-{bug_id}",
        type=JobType.BUG_INVESTIGATION,
        status=JobStatus.QUEUED,
        company=request.company or "bugs",
        project=request.project or request.bug_type,
        created_at=datetime.now(timezone.utc),
        request_payload={"bug_id": bug_id, "target": request.target},
    )
    try:
        job_id = JobQueue(jobs_db).enqueue_job(job)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"failed to enqueue investigation: {exc}")

    logger.info(f"Accepted {bug_id} (type={request.bug_type}); enqueued {job_id}")
    return BugAccepted(bug_id=bug_id, job_id=job_id)


@router.get("/api/v2/bugs/{bug_id}", tags=["bugs"])
def get_bug(bug_id: str, authenticated: bool = Depends(verify_api_key)):
    """Retrieve a bug's current status/result (read-only)."""
    conn = store.connect()
    try:
        bug = store.get_bug(conn, bug_id)
    finally:
        conn.close()
    if not bug:
        raise HTTPException(status_code=404, detail=f"no bug {bug_id}")
    return bug

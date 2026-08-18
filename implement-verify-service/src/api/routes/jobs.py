"""Async-job routes (V1 + V2).

Six endpoints lifted from `src/api/__init__.py` during Phase A.6c:

  V1 (no git integration):
    * POST   /api/v1/jobs/orchestrations  create_orchestration_job
    * GET    /api/v1/jobs/{job_id}        get_job_status
    * GET    /api/v1/jobs                 list_jobs
    * DELETE /api/v1/jobs/{job_id}        cancel_job

  V2 (git-integrated):
    * POST   /api/v2/jobs/orchestrations  create_orchestration_job_v2
    * GET    /api/v2/jobs/{job_id}        get_job_status_v2

The `job_queue` singleton, `_require_git_manager`, and
`_run_job_in_background` are all module-level state in
`src/api/__init__.py`; they're imported lazily inside each endpoint
body to avoid a load cycle.
"""
from __future__ import annotations

import logging
import os
from typing import List, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    status,
)

from ...haikai_models import AssembleRunRequest, OrchestrationRequest
from ...api_auth import verify_api_key
from ...job_queue.job_models import (
    Job,
    JobDetailResponse,
    JobResponse,
    JobStatus,
    JobType,
)

logger = logging.getLogger("src.api")

router = APIRouter()


def find_active_duplicate_orchestration(job_queue, request: OrchestrationRequest):
    """Return an ACTIVE (queued/running) orchestration job for the SAME
    company/project/spec set, or None.

    Idempotent submit (2026-07-31). The gateway's dispatch can be duplicated
    in ways its own pre-checks cannot see — the live case: a tsx-watch
    gateway reload landed mid-submit, so the boot-recovery sweep re-kicked a
    `submitting`-with-no-job_id item ~19s after the first kick's POST had
    already reached IVS. The second job died minutes later on the worktree
    branch lock and halted the run (and a duplicated data load double-loaded
    `view_tag`). Returning the existing ACTIVE job makes the re-kick safe
    end-to-end: whichever submit lands second correlates to the SAME job.

    Only queued/running jobs match — terminal jobs never block a genuine
    re-run. Best-effort: any storage error returns None (a legitimate submit
    must never be blocked by the dedup scan; the worktree branch lock stays
    the last-resort backstop).
    """
    requested = sorted((i.spec_name or "") for i in (request.spec_intents or []))
    if not requested:
        return None
    try:
        active = []
        for st in (JobStatus.QUEUED, JobStatus.RUNNING):
            active.extend(
                job_queue.storage.list_jobs(
                    status=st,
                    company=request.company,
                    project=request.project,
                    limit=100,
                )
            )
        for existing in active:
            if getattr(existing, "type", None) != JobType.ORCHESTRATION:
                continue
            payload = getattr(existing, "request_payload", None) or {}
            existing_specs = sorted(
                (i.get("spec_name") or "")
                for i in (payload.get("spec_intents") or [])
                if isinstance(i, dict)
            )
            if existing_specs == requested:
                return existing
    except Exception:
        logger.warning(
            "idempotent-submit scan failed; proceeding with a new job",
            exc_info=True,
        )
    return None


@router.post(
    "/api/v1/jobs/orchestrations",
    tags=["Jobs"],
    summary="Create async orchestration job",
    response_model=JobResponse,
    responses={
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
)
async def create_orchestration_job(
    request: OrchestrationRequest,
    authenticated: bool = Depends(verify_api_key),
) -> JobResponse:
    """
    Create an async orchestration job (**returns immediately** with a `job_id`).

    Preferred over the synchronous `POST /api/v1/orchestrations` for long-running
    workflows to avoid HTTP timeouts.

    Poll `GET /api/v1/jobs/{job_id}` to check status and retrieve results.

    **Prerequisites:** Run shape-spec first.
    """
    from .. import job_queue
    try:
        duplicate = find_active_duplicate_orchestration(job_queue, request)
        if duplicate is not None:
            logger.warning(
                "Duplicate orchestration submit for %s/%s — returning existing "
                "active job %s instead of spawning a second one",
                request.company, request.project, duplicate.job_id,
            )
            return JobResponse(
                job_id=duplicate.job_id,
                status=duplicate.status,
                created_at=duplicate.created_at,
            )
        job = Job(
            type=JobType.ORCHESTRATION,
            company=request.company,
            project=request.project,
            request_payload=request.dict(),
        )
        job_id = job_queue.enqueue_job(job)
        logger.info(
            f"Created orchestration job {job_id} for {request.company}/{request.project}"
        )
        return JobResponse(
            job_id=job_id,
            status=JobStatus.QUEUED,
            created_at=job.created_at,
        )
    except Exception as e:
        logger.error(f"Failed to create orchestration job: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create orchestration job: {str(e)}",
        )


@router.get(
    "/api/v1/jobs/{job_id}",
    tags=["Jobs"],
    summary="Get job status and result",
    response_model=JobDetailResponse,
    responses={
        401: {"description": "Invalid or missing API key"},
        404: {"description": "Job not found"},
        500: {"description": "Server error"},
    },
)
async def get_job_status(
    job_id: str,
    authenticated: bool = Depends(verify_api_key),
) -> JobDetailResponse:
    """
    Poll this endpoint to check the status of an async job.

    **Possible statuses:** `queued`, `running`, `completed`, `failed`, `cancelled`.

    - When `status` is `completed`, the `result` field contains the full response.
    - When `status` is `failed`, the `error` field contains the error message.
    """
    from .. import job_queue
    job = job_queue.get_job_status(job_id)

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found",
        )

    return JobDetailResponse(
        job_id=job.job_id,
        type=job.type,
        status=job.status,
        company=job.company,
        project=job.project,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        progress=job.progress,
        result=job.result,
        error=job.error,
        logs_url=f"/api/v1/jobs/{job_id}/logs" if job.logs_path else None,
    )


@router.get(
    "/api/v1/jobs",
    tags=["Jobs"],
    summary="List jobs with optional filters",
    responses={
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
)
async def list_jobs(
    # `status_filter` (alias `status` for the URL) — the parameter name
    # MUST NOT shadow `fastapi.status` (imported at module top), or the
    # `status.HTTP_500_INTERNAL_SERVER_ERROR` reference in the except
    # block below crashes with AttributeError. autoresearch:debug
    # 260504-1635 finding B6.
    status_filter: Optional[JobStatus] = Query(default=None, alias="status"),
    company: Optional[str] = None,
    project: Optional[str] = None,
    limit: int = 100,
    authenticated: bool = Depends(verify_api_key),
):
    """
    List jobs with optional filters.

    All query parameters are optional. Returns jobs sorted by creation time.
    """
    from .. import job_queue
    try:
        jobs = job_queue.storage.list_jobs(
            status=status_filter,
            company=company,
            project=project,
            limit=limit,
        )
        return {"jobs": [job.dict() for job in jobs], "count": len(jobs)}
    except Exception as e:
        logger.error(f"Failed to list jobs: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list jobs: {str(e)}",
        )


@router.delete(
    "/api/v1/jobs/{job_id}",
    tags=["Jobs"],
    summary="Cancel a job",
    responses={
        401: {"description": "Invalid or missing API key"},
        404: {"description": "Job not found or cannot be cancelled"},
    },
)
async def cancel_job(
    job_id: str,
    authenticated: bool = Depends(verify_api_key),
):
    """
    Cancel a queued or running job.

    Only jobs with status `queued` or `running` can be cancelled.
    """
    from .. import job_queue
    success = job_queue.cancel_job(job_id)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found or cannot be cancelled",
        )

    logger.info(f"Cancelled job {job_id}")

    # Run-flow-graph (D13 `cancelled`): a cancel is a visible terminal step —
    # a normal run's root, or a repair job's attempt on the PARENT graph.
    # Best-effort projection; the cancel itself is already durable.
    try:
        from src.verification import flow_graph
        job = job_queue.get_job_status(job_id)
        jtype = str(getattr(job, "type", "")).lower() if job is not None else ""
        payload = (job.request_payload or {}) if job is not None else {}
        if jtype.endswith("orchestration"):
            conn = flow_graph.connect()
            try:
                flow_graph.emit_job_cancelled(conn, job_id, payload)
            finally:
                conn.close()
        elif "verify" in jtype and payload.get("orchestrate_id") and payload.get("task_group_id"):
            # VERIFY_TASK_GROUP / HAIBOX_VERIFY (reason run F4): job-scoped
            # cancel — group evidence + running→pending revert, never a
            # group terminal (cancelled would poison every re-entry).
            conn = flow_graph.connect()
            try:
                flow_graph.emit_verify_cancelled(
                    conn, str(payload["orchestrate_id"]),
                    str(payload["task_group_id"]), job_id)
            finally:
                conn.close()
    except Exception:
        logger.warning("run-graph: cancel emission failed (non-fatal)", exc_info=True)

    return {"message": "Job cancelled", "job_id": job_id}


@router.post(
    "/api/v2/jobs/orchestrations",
    tags=["Git Integration"],
    summary="Create async orchestration job with git integration (V2)",
    response_model=JobResponse,
    responses={
        400: {"description": "Missing prerequisites or git config"},
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
)
async def create_orchestration_job_v2(
    request: OrchestrationRequest,
    background_tasks: BackgroundTasks,
    authenticated: bool = Depends(verify_api_key),
):
    """
    Git-integrated async orchestration. Creates a background job that runs
    the full orchestration workflow with git commit/push/PR after completion.

    Returns immediately with a `job_id`. Poll `GET /api/v2/jobs/{job_id}` for status.

    Requires: `POST /projects/init` must have been called first.

    **Multi-spec supported.** Each spec is committed to its OWN
    `feature/<spec>` branch interleaved with generation (B2 fixed: the commit
    happens before the next spec's files exist, so `git add -A` no longer aliases
    them into the first spec's commit). Specs are treated as INDEPENDENT migration
    units — each branches off default; `deploy_on_complete` consolidates the
    per-spec branches into one served target.
    """
    from .. import _require_git_manager, _run_job_in_background, job_queue

    _require_git_manager(request.company, request.project)

    try:
        duplicate = find_active_duplicate_orchestration(job_queue, request)
        if duplicate is not None:
            logger.warning(
                "Duplicate V2 orchestration submit for %s/%s — returning "
                "existing active job %s instead of spawning a second one",
                request.company, request.project, duplicate.job_id,
            )
            return JobResponse(
                job_id=duplicate.job_id,
                status=duplicate.status,
                created_at=duplicate.created_at,
            )
        job = Job(
            type=JobType.ORCHESTRATION,
            company=request.company,
            project=request.project,
            request_payload=request.model_dump(),
        )
        job_id = job_queue.enqueue_job(job)
        # Under a worker fleet the API is enqueue-only (API_INLINE_JOBS=off):
        # workers are the sole executors. Default keeps single-host behavior
        # (in-process execution), now made race-safe by the CAS claim inside
        # _run_job_in_background.
        if os.getenv("API_INLINE_JOBS", "on").strip().lower() not in ("off", "false", "0"):
            background_tasks.add_task(_run_job_in_background, job_id)

        logger.info(f"V2 orchestration job created and dispatched: {job_id}")

        return JobResponse(
            job_id=job_id,
            status=JobStatus.QUEUED,
            created_at=job.created_at,
        )
    except Exception as e:
        logger.error(
            f"Failed to create V2 orchestration job: {str(e)}", exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create orchestration job: {str(e)}",
        )


@router.post(
    "/api/v2/jobs/assemblies",
    tags=["Git Integration"],
    summary="Assemble a migration run: merge spec branches + overlay the DB pack (V2)",
    response_model=JobResponse,
    responses={
        400: {"description": "Missing prerequisites or git config"},
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
)
async def create_assembly_job(
    request: AssembleRunRequest,
    background_tasks: BackgroundTasks,
    authenticated: bool = Depends(verify_api_key),
):
    """DB-plane execution chain (2026-07-31): merge the run's per-spec
    branches into ONE new branch, overlay the complete pack (sent inline by
    the gateway from AMS), validate the assembled pack structurally, push,
    and open a merge request.

    Returns immediately with a `job_id`; poll `GET /api/v2/jobs/{job_id}`.
    The job result carries `{branch, mr_url, merged_branches, overlaid_files}`.
    """
    from .. import _require_git_manager, _run_job_in_background, job_queue

    _require_git_manager(request.company, request.project)

    try:
        job = Job(
            type=JobType.ASSEMBLE_RUN,
            company=request.company,
            project=request.project,
            request_payload=request.model_dump(),
        )
        job_id = job_queue.enqueue_job(job)
        if os.getenv("API_INLINE_JOBS", "on").strip().lower() not in ("off", "false", "0"):
            background_tasks.add_task(_run_job_in_background, job_id)

        logger.info(f"Assembly job created and dispatched: {job_id}")

        return JobResponse(
            job_id=job_id,
            status=JobStatus.QUEUED,
            created_at=job.created_at,
        )
    except Exception as e:
        logger.error(f"Failed to create assembly job: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create assembly job: {str(e)}",
        )


@router.get(
    "/api/v2/jobs/{job_id}/file-hashes",
    tags=["Git Integration"],
    summary="sha256 hashes of shipped files on the job's branch (SCL integrity)",
    responses={
        401: {"description": "Invalid or missing API key"},
        404: {"description": "Job not found"},
        409: {"description": "Job has no run branch / no repo target"},
    },
)
async def get_job_file_hashes(
    job_id: str,
    paths: Optional[List[str]] = Query(default=None),
    authenticated: bool = Depends(verify_api_key),
):
    """SCL shipped-suite integrity read (2026-08-18): sha256 hashes of the
    requested paths ON THE JOB'S BRANCH (``git show <branch>:<path>`` against
    the live repo — the run worktree is reclaimed after completion, the branch
    survives), plus the raw contents of the two well-known SCL sidecar files
    (``scl-suite-manifest.json`` / ``scl-quarantine.json``).

    ``paths`` omitted → the path set is derived from the branch's
    ``scl-suite-manifest.json`` (one round-trip for the gateway's
    build-results door). A path absent from the branch reports
    ``sha256: null``.
    """
    from .. import job_queue
    from ...job_queue.initial_commit import (
        InitialCommitError,
        collect_branch_file_hashes,
    )

    job = job_queue.get_job_status(job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found",
        )
    branch = getattr(job, "run_branch", None)
    if not branch:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Job {job_id} has no run branch recorded (no worktree run?)",
        )
    from pathlib import Path as _Path
    workspace_dir = str(_Path(os.getenv("API_WORKSPACE_DIR", ".")).resolve())
    product_root = _Path(workspace_dir) / job.company / job.project
    try:
        result = collect_branch_file_hashes(product_root, branch, paths)
    except InitialCommitError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    return {"job_id": job_id, **result}


@router.get(
    "/api/v2/jobs/{job_id}",
    tags=["Git Integration"],
    summary="Get V2 job status and result",
    response_model=JobDetailResponse,
    responses={
        401: {"description": "Invalid or missing API key"},
        404: {"description": "Job not found"},
    },
)
async def get_job_status_v2(
    job_id: str,
    authenticated: bool = Depends(verify_api_key),
) -> JobDetailResponse:
    """
    Get the current status and result of an async V2 job.

    Poll this endpoint after creating a job via `POST /api/v2/jobs/orchestrations`.
    """
    from .. import job_queue
    job = job_queue.get_job_status(job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found",
        )

    return JobDetailResponse(
        job_id=job.job_id,
        type=job.type,
        status=job.status,
        company=job.company,
        project=job.project,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        progress=job.progress,
        result=job.result,
        error=job.error,
        logs_url=job.logs_path,
    )

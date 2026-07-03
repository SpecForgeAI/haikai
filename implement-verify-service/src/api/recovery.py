"""Startup recovery for interrupted orchestration jobs.

Per spec `haikai/specs/2026-05-18-api-and-stream-modularize/`
Phase A.3: extracted from `src/api/__init__.py` (the 180-LOC
`_recover_interrupted_jobs` + its 2 helpers `_determine_last_completed_step`
and `_dispatch_recovered_job`).

`src/api/__init__.py` still owns the call site (one line at module
load, after `job_queue` is initialised). This module provides only
the recovery logic itself.

Lazy imports of `src.api.{load_env_config, _safe_project_dir,
API_WORKSPACE_DIR, _run_job_in_background}` avoid the import cycle
(api/__init__.py imports recovery, recovery would otherwise import
api → cycle at load time).
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ..haikai_models import OrchestrationRequest
from ..backend_registry import _credentials_satisfied
from ..job_queue.job_models import Job, JobStatus
from .factories import create_chat_executor

logger = logging.getLogger(__name__)

# A RUNNING job whose last heartbeat is younger than this is owned by a LIVE
# worker — recovery must leave it alone (else it races the worker and wrongly
# marks an in-flight job failed). Must be comfortably > the worker's
# HEARTBEAT_INTERVAL_SECONDS (30s).
RECOVERY_STALE_SECONDS = 120


def _graph_mark_failed(job, reason: str) -> None:
    """Run-flow-graph (reason run F1, unanimous): recovery's FAIL branches
    are the only orchestration status transitions with no graph mirror —
    the crash that killed the worker also killed run_orchestration's own
    completion emission, so the run root would spin `running` forever.
    Best-effort; a repair job (repair_of payload) marks its attempt on
    the PARENT graph instead (its own root was never declared, D2c)."""
    try:
        from src.verification import flow_graph
        conn = flow_graph.connect()
        try:
            repair_of = (job.request_payload or {}).get("repair_of") or {}
            if repair_of.get("verifier") and repair_of.get("attempt") is not None:
                flow_graph.set_state(
                    conn, str(repair_of["orchestrate_id"]),
                    flow_graph.attempt_node_id(
                        str(repair_of["orchestrate_id"]),
                        str(repair_of["task_group_id"]),
                        str(repair_of["repo"]), str(repair_of["verifier"]),
                        int(repair_of["attempt"])),
                    "fail", {"reason": reason, "recovered": True})
            else:
                flow_graph.emit_run_completed(
                    conn, job.job_id, False,
                    {"reason": reason, "recovered": True})
        finally:
            conn.close()
    except Exception:
        logger.warning("Recovery: graph fail emission failed (non-fatal)",
                       exc_info=True)


def _determine_last_completed_step(job: Job) -> Optional[int]:
    """Check orchestration log dir for completed step files.

    Returns the highest step number that completed successfully,
    or None if no steps completed.
    """
    if not job.logs_path:
        return None
    logs_dir = Path(job.logs_path)
    if not logs_dir.exists():
        return None

    completed = []
    for step_file in logs_dir.glob("step-*.json"):
        try:
            data = json.loads(step_file.read_text(encoding="utf-8"))
            if data.get("success"):
                # Filename format: step-{n}-{command}.json
                step_num = int(step_file.stem.split("-")[1])
                completed.append(step_num)
        except (json.JSONDecodeError, ValueError, IndexError):
            continue

    return max(completed) if completed else None


def _dispatch_recovered_job(job_id: str):
    """Dispatch a recovered job in the current thread.

    Called from a daemon thread spawned during startup recovery.
    `_run_job_in_background` lives in `src.api.__init__`; imported
    lazily so this module doesn't cycle on load.
    """
    import time
    time.sleep(2)  # let the app finish booting
    try:
        from . import _run_job_in_background
    except ImportError:
        logger.error(f"Recovery dispatch: _run_job_in_background not found for job {job_id}")
        return
    try:
        _run_job_in_background(job_id)
    except Exception as e:
        logger.error(f"Recovery dispatch failed for job {job_id}: {e}", exc_info=True)


def _recover_interrupted_jobs():
    """Scan jobs.db for orphaned 'running' jobs and recover them.

    Called once on startup. For each interrupted job:
    1. Determine the last completed orchestration step from step logs
    2. Load the session ID from the spec folder's active_session.json
    3. Restore the .jsonl transcript to the active backend's session directory
    4. Re-queue the job with resume_from_step, or mark it failed
    """
    # Lazy import to break api → recovery → api cycle.
    from . import job_queue, load_env_config, _safe_project_dir, API_WORKSPACE_DIR

    storage = job_queue.storage
    interrupted = storage.list_jobs(status=JobStatus.RUNNING)

    if not interrupted:
        logger.info("Startup recovery: no interrupted jobs found")
        return

    logger.info(f"Startup recovery: found {len(interrupted)} interrupted job(s)")

    config = load_env_config()
    anthropic_api_key = config.get("anthropic_api_key")

    for job in interrupted:
        # Skip jobs a live worker is actively running (fresh heartbeat). Only
        # genuinely-orphaned jobs (no/stale heartbeat) are recovered.
        age = storage.heartbeat_age_seconds(job.job_id)
        if age is not None and age < RECOVERY_STALE_SECONDS:
            logger.info(
                "Recovery: skipping job %s — live worker (heartbeat %.0fs ago)",
                job.job_id, age)
            continue
        try:
            completed_step = _determine_last_completed_step(job)

            if completed_step is None:
                job.status = JobStatus.FAILED
                job.completed_at = datetime.now(timezone.utc)
                job.error = (
                    "Interrupted: container restarted before "
                    "any orchestration step completed"
                )
                storage.save_job(job)
                _graph_mark_failed(job, "recovered: no orchestration step completed")
                logger.info(
                    f"Recovery: job {job.job_id} marked failed "
                    f"(no completed steps)"
                )
                continue

            # Load session ID from spec-level active_session.json
            request = OrchestrationRequest(**job.request_payload)
            session_id = None
            for spec_intent in request.spec_intents:
                spec_dir = (
                    _safe_project_dir(request.company, request.project)
                    / "haikai" / "specs" / spec_intent.spec_name
                )
                spec_session_file = spec_dir / "active_session.json"
                if spec_session_file.exists():
                    try:
                        data = json.loads(
                            spec_session_file.read_text(encoding="utf-8")
                        )
                        session_id = data.get("session_id")
                        if session_id:
                            break
                    except (json.JSONDecodeError, OSError):
                        continue

            if not session_id:
                job.status = JobStatus.FAILED
                job.completed_at = datetime.now(timezone.utc)
                job.error = (
                    f"Interrupted after step {completed_step}: "
                    f"no session found in spec folder to resume"
                )
                storage.save_job(job)
                _graph_mark_failed(job, "recovered: no session found to resume")
                logger.info(
                    f"Recovery: job {job.job_id} marked failed "
                    f"(no session ID in spec folder)"
                )
                continue

            # Restore session transcript via the active backend's chat
            # executor. Routes through the factory so Kiro (or any other
            # backend) is honored, not just Claude. OAuth/OpenAI
            # backends no-op restore_session_from_spec — that's correct;
            # they don't have a spec-scoped session to restore.
            if _credentials_satisfied(anthropic_api_key):
                try:
                    chat_executor = create_chat_executor(
                        company=request.company,
                        project=request.project,
                        workspace_dir=API_WORKSPACE_DIR,
                        anthropic_api_key=anthropic_api_key or "",
                        session_uuid=session_id,
                    )
                    restored = chat_executor.restore_session_from_spec()
                    if restored:
                        logger.info(
                            f"Recovery: restored session {session_id} "
                            f"from spec {restored}"
                        )
                except Exception as e:
                    logger.warning(
                        f"Recovery: session restore failed for "
                        f"job {job.job_id}: {e}"
                    )

            # Re-queue with resume_from_step
            next_step = completed_step + 1
            job.status = JobStatus.QUEUED
            job.resume_from_step = next_step
            job.completed_at = None
            storage.save_job(job)

            logger.info(
                f"Recovery: job {job.job_id} re-queued, "
                f"will resume from step {next_step} "
                f"with session {session_id}"
            )

            # Dispatch in background thread
            t = threading.Thread(
                target=_dispatch_recovered_job,
                args=(job.job_id,),
                daemon=True,
            )
            t.start()

        except Exception as e:
            logger.error(
                f"Recovery: failed to process job {job.job_id}: {e}",
                exc_info=True,
            )
            job.status = JobStatus.FAILED
            job.completed_at = datetime.now(timezone.utc)
            job.error = f"Recovery failed: {e}"
            storage.save_job(job)
            _graph_mark_failed(job, f"recovery failed: {e}")

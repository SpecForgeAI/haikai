"""Orchestration HTTP endpoints — v1 + v2.

Per spec `haikai/specs/2026-05-18-api-and-stream-modularize/`
Phase A.5: extracted from `src/api/__init__.py`. The 5 endpoints are:

| Verb | Path                                                                  |
|------|-----------------------------------------------------------------------|
| POST | `/api/v1/orchestrations`                                              |
| POST | `/api/v2/orchestrations/brain-only`                                   |
| POST | `/api/v2/orchestrations`                                              |
| GET  | `/api/v1/orchestrations/{orchestration_id}/status`                    |
| GET  | `/api/v1/orchestrations/{orchestration_id}/logs`                      |

Mounted onto `app` in `src/api/__init__.py` via
`app.include_router(orchestration_router)`.

Import strategy:
- **Top-level imports** for symbols whose source module is independent
  of `src.api` (no cycle risk): `HaikaiOrchestrator`,
  `get_active_session`, `load_git_config`, `GitConfigError`,
  `GitManagerError`. Tests patching these should target
  `src.api.routes.orchestration.X`.
- **Lazy imports** (inside function bodies) for `src.api`-internal
  symbols: `API_WORKSPACE_DIR`, `ORCHESTRATION_LOG_DIR`,
  `executor_pool`, `_safe_orchestration_id`, `_require_git_manager`.
  These would form a load-time cycle as module-top imports
  (api/__init__.py imports this module). Lazy `from .. import X` reads
  the api namespace at call time, so `@patch('src.api.X')` reaches.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status

from ...haikai_models import (
    OrchestrationRequest,
    OrchestrationResponse,
    OrchestrationV2Response,
)
from ...haikai_orchestrator import HaikaiOrchestrator
from ...haikai_status_models import (
    OrchestrationLogsResponse,
    OrchestrationStatusResponse,
    StepLogEntry,
)
from ...api_auth import verify_api_key
from ...chat.session_store import get_active_session
from ...git.config import GitConfigError, load_git_config, load_git_config_with_project_fallback
from ...git.git_manager import GitManagerError
from ..gates import require_credentials

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/api/v1/orchestrations",
    tags=["Orchestration"],
    summary="Run full orchestration (synchronous)",
    response_model=OrchestrationResponse,
    responses={
        400: {"description": "Missing prerequisites (product files, requirements)"},
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error or orchestration failure"},
    },
)
async def orchestrate_features(
    request: OrchestrationRequest,
    authenticated: bool = Depends(verify_api_key)
) -> OrchestrationResponse:
    """Synchronous full orchestration: write-spec → create-tasks → implement-tasks."""
    from .. import API_WORKSPACE_DIR, ORCHESTRATION_LOG_DIR, executor_pool

    try:
        anthropic_api_key = require_credentials()

        session_id = get_active_session(API_WORKSPACE_DIR, request.company, request.project)
        if not session_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No active session for {request.company}/{request.project}. Run shape-spec first."
            )

        orchestrator = HaikaiOrchestrator(
            request=request,
            anthropic_api_key=anthropic_api_key,
            workspace_dir=str(API_WORKSPACE_DIR),
            logs_dir=str(ORCHESTRATION_LOG_DIR),
            session_id=session_id,
        )

        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(executor_pool, orchestrator.run_workflow)
        return response

    except HTTPException:
        raise
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to orchestrate specs: {str(e)}"
        )


@router.post(
    "/api/v2/orchestrations/brain-only",
    tags=["Orchestration"],
    summary="Run brain-only orchestration (write-spec + create-tasks)",
    response_model=OrchestrationV2Response,
    responses={
        400: {"description": "Missing prerequisites"},
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
)
async def orchestrate_features_v2_brain_only(
    request: OrchestrationRequest,
    authenticated: bool = Depends(verify_api_key)
) -> OrchestrationV2Response:
    """write-spec + create-tasks only. Returns implementation-package bundles."""
    from .. import API_WORKSPACE_DIR, ORCHESTRATION_LOG_DIR, executor_pool

    try:
        anthropic_api_key = require_credentials()

        session_id = get_active_session(API_WORKSPACE_DIR, request.company, request.project)
        if not session_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No active session for {request.company}/{request.project}. Run shape-spec first."
            )

        orchestrator = HaikaiOrchestrator(
            request=request,
            anthropic_api_key=anthropic_api_key,
            workspace_dir=str(API_WORKSPACE_DIR),
            logs_dir=str(ORCHESTRATION_LOG_DIR),
            session_id=session_id,
        )

        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(executor_pool, orchestrator.run_brain_workflow)
        return response

    except HTTPException:
        raise
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to orchestrate specs (v2): {str(e)}"
        )


@router.get(
    "/api/v1/orchestrations/{orchestration_id}/status",
    tags=["Orchestration"],
    summary="Get orchestration status",
    response_model=OrchestrationStatusResponse,
    responses={401: {"description": "Invalid or missing API key"}, 404: {"description": "Orchestration not found"}, 500: {"description": "Server error"}},
)
async def get_orchestration_status(
    orchestration_id: str,
    authenticated: bool = Depends(verify_api_key)
) -> OrchestrationStatusResponse:
    """Status of a running or completed orchestration. `orchestration_id` format: `YYYYMMDD_HHMMSS`."""
    from .. import ORCHESTRATION_LOG_DIR, _safe_orchestration_id

    try:
        orchestration_id = _safe_orchestration_id(orchestration_id)
        orchestration_dir = ORCHESTRATION_LOG_DIR / orchestration_id

        if not orchestration_dir.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Orchestration {orchestration_id} not found"
            )

        orchestration_log = orchestration_dir / "orchestration.json"
        error_log = orchestration_dir / "error.json"

        if orchestration_log.exists():
            with open(orchestration_log, 'r') as f:
                log_data = json.load(f)
            return OrchestrationStatusResponse(
                orchestration_id=orchestration_id,
                status="completed",
                company=log_data.get("project_dir", "").split("/")[-2] if "/" in log_data.get("project_dir", "") else "",
                project=log_data.get("project_dir", "").split("/")[-1] if "/" in log_data.get("project_dir", "") else "",
                spec_names=log_data.get("spec_names", []),
                completed_steps=len(log_data.get("steps", [])),
                total_steps=4,
                elapsed_time_seconds=log_data.get("total_execution_time_seconds"),
                success=log_data.get("success", False),
                log_file=str(orchestration_log).replace("\\", "/")
            )

        elif error_log.exists():
            with open(error_log, 'r') as f:
                log_data = json.load(f)
            return OrchestrationStatusResponse(
                orchestration_id=orchestration_id,
                status="failed",
                company="",
                project="",
                spec_names=[],
                completed_steps=0,
                total_steps=4,
                elapsed_time_seconds=log_data.get("total_execution_time_seconds"),
                success=False,
                log_file=str(error_log).replace("\\", "/")
            )

        else:
            step_logs = sorted(orchestration_dir.glob("step-*.json"))
            completed_steps = len(step_logs)
            current_step = None
            current_command = None
            if step_logs:
                with open(step_logs[-1], 'r') as f:
                    last_step_data = json.load(f)
                    current_step = last_step_data.get("step")
                    current_command = last_step_data.get("command")
            # naive-on-purpose: orchestration_id is also generated naive.
            start_time = datetime.strptime(orchestration_id, "%Y%m%d_%H%M%S")
            elapsed_seconds = (datetime.now() - start_time).total_seconds()
            return OrchestrationStatusResponse(
                orchestration_id=orchestration_id,
                status="running",
                company="",
                project="",
                spec_names=[],
                current_step=current_step,
                current_command=current_command,
                completed_steps=completed_steps,
                total_steps=4,
                elapsed_time_seconds=elapsed_seconds,
                log_file=str(orchestration_dir).replace("\\", "/")
            )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get orchestration status: {str(e)}"
        )


@router.get(
    "/api/v1/orchestrations/{orchestration_id}/logs",
    tags=["Orchestration"],
    summary="Get orchestration logs",
    response_model=OrchestrationLogsResponse,
    responses={401: {"description": "Invalid or missing API key"}, 404: {"description": "Orchestration not found"}, 500: {"description": "Server error"}},
)
async def get_orchestration_logs(
    orchestration_id: str,
    step: Optional[int] = None,
    authenticated: bool = Depends(verify_api_key)
) -> OrchestrationLogsResponse:
    """Logs from a running or completed orchestration. Optional `step` filter."""
    from .. import ORCHESTRATION_LOG_DIR, _safe_orchestration_id

    try:
        orchestration_id = _safe_orchestration_id(orchestration_id)
        orchestration_dir = ORCHESTRATION_LOG_DIR / orchestration_id

        if not orchestration_dir.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Orchestration {orchestration_id} not found"
            )

        logs = []
        if step is not None:
            step_log_files = list(orchestration_dir.glob(f"step-{step}-*.json"))
        else:
            step_log_files = sorted(orchestration_dir.glob("step-*.json"))

        for log_file in step_log_files:
            try:
                with open(log_file, 'r') as f:
                    log_data = json.load(f)

                if log_data.get("stdout"):
                    logs.append(StepLogEntry(
                        timestamp=log_data.get("timestamp", ""),
                        level="INFO",
                        message=log_data["stdout"],
                        source="claude"
                    ))

                if log_data.get("stderr"):
                    logs.append(StepLogEntry(
                        timestamp=log_data.get("timestamp", ""),
                        level="ERROR",
                        message=log_data["stderr"],
                        source="claude"
                    ))

                summary = f"Step {log_data.get('step')}: {log_data.get('command')} - Status: {'success' if log_data.get('success') else 'failure'} - Duration: {log_data.get('execution_time', 0):.2f}s"
                logs.append(StepLogEntry(
                    timestamp=log_data.get("timestamp", ""),
                    level="INFO",
                    message=summary,
                    source="orchestrator"
                ))

            except Exception as e:
                logger.error(f"Failed to read log file {log_file}: {e}")
                continue

        return OrchestrationLogsResponse(
            orchestration_id=orchestration_id,
            logs=logs,
            has_more=False
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get orchestration logs: {str(e)}"
        )


@router.post(
    "/api/v2/orchestrations",
    tags=["Git Integration"],
    summary="Run full orchestration with git integration (V2)",
    response_model=OrchestrationResponse,
    responses={
        400: {"description": "Missing prerequisites or git config"},
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
)
async def orchestrate_v2(
    request: OrchestrationRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Git-integrated full orchestration. Single-spec only — see B2 in debug 260504-1620.

    F4 (reconciliation-handoff): this is the SYNCHRONOUS path — it implements +
    commits inline and returns the result directly (no job, no callback). For the
    Haikai migration loop use the ASYNC path `POST /api/v2/jobs/orchestrations`
    (enqueues a job; carries `deploy_on_complete` + a completion callback). This
    sync endpoint stays for direct/scripted use; the two must not be confused
    (the migration contract assumes the async job path).
    """
    from .. import API_WORKSPACE_DIR, ORCHESTRATION_LOG_DIR, _require_git_manager

    if len(request.spec_intents) > 1:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Multi-spec orchestration is deferred (got "
                f"{len(request.spec_intents)} spec_intents). The current "
                "implementation aliases all specs' files into the first "
                "spec's commit — see debug/260504-1620-api-layer-hunt/bugs.md "
                "B2. Submit one spec_intent at a time."
            ),
        )

    gm = _require_git_manager(request.company, request.project)
    anthropic_api_key = require_credentials()

    session_id = get_active_session(API_WORKSPACE_DIR, request.company, request.project)
    if not session_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No active session for {request.company}/{request.project}. Run shape-spec first."
        )

    try:
        orchestrator = HaikaiOrchestrator(
            request=request,
            anthropic_api_key=anthropic_api_key,
            workspace_dir=str(API_WORKSPACE_DIR),
            logs_dir=str(ORCHESTRATION_LOG_DIR),
            session_id=session_id,
        )
        response = orchestrator.run_workflow()
    except Exception as e:
        logger.error(f"V2 orchestration failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

    from ..git_workflow import apply_git_workflow

    # Saved-provider fallback (2026-07-27): mirrors _require_git_manager.
    git_config = load_git_config_with_project_fallback([gm.project_dir])
    response.errors = []  # apply_git_workflow appends here on failure

    for spec_intent in request.spec_intents:
        spec_name = spec_intent.spec_name
        apply_git_workflow(
            gm=gm,
            git_config=git_config,
            branch=f"feature/{spec_name}",
            commit_msg=f"feature: {spec_name} (write-spec + create-tasks + implement-tasks)",
            pr_title=f"feature: {spec_name}",
            pr_body=f"Orchestration output for {spec_name}",
            response_obj=response,
            checkout_back_to_default=True,
            error_label=spec_name,
        )

    if response.errors:
        response.success = False

    return response

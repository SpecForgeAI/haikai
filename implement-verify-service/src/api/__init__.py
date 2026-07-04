"""HTTP API — main FastAPI app + routers.

Migrated from src/api.py to src/api/__init__.py to resolve a package-vs-module shadow that prevented routes from mounting in the production app.
"""
"""Standards Extractor API - REST interface for standards generation."""
import os
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any
from pydantic import BaseModel
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, Depends, status, Request, BackgroundTasks, Query
from concurrent.futures import ThreadPoolExecutor
import asyncio
import threading

from starlette.middleware.cors import CORSMiddleware

from ..models import (
    GetMetamodelRequest,
    GenerateProductStandardsRequest,
    GenerateGlobalStandardsRequest,
    OperationResponse
)
from ..operation_executor import OperationExecutor
from ..haikai_models import (
    OrchestrationRequest,
    OrchestrationResponse,
    OrchestrationV2Response,
    ImplementationPackage,
    ImplementationPackageFile,
)
from ..haikai_orchestrator import HaikaiOrchestrator
from ..haikai_shape_spec_models import (
    ShapeSpecRequest,
    ShapeSpecResponse,
    ShapeSpecResult,
    GetSpecsResponse,
    SpecInfo
)
from ..haikai_crud_models import (
    SpecListResponse,
    SpecDetail,
    WriteSpecRequest,
    WriteSpecResponse,
    GenerateTasksResponse,
    ImplementRequest,
    ImplementResponse,
    TasksDetail,
    DeleteSpecResponse,
    ErrorResponse
)
from ..haikai_service import HaikaiService
from ..git.git_manager import GitManager, GitManagerError
from ..git.config import load_git_config, GitConfigError
from ..git.coordination import read_coordination, CoordinationError
from ..git.models import ProjectInitRequest, ProjectInitResponse
from ..haikai_status_models import (
    OrchestrationStatusResponse,
    OrchestrationLogsResponse,
    StepLogEntry
)
from ..path_safety import safe_segment

import re as _re
_ORCH_ID_RE = _re.compile(r"^\d{8}_\d{6}$")


def _safe_orchestration_id(orch_id: str) -> str:
    """Validate orchestration_id matches the documented YYYYMMDD_HHMMSS shape.

    Without this, `ORCHESTRATION_LOG_DIR / orch_id` would let a hostile
    URL like `../../etc` traverse outside the log directory. See
    autoresearch:debug 260504-1229 finding #5.
    """
    if not isinstance(orch_id, str) or not _ORCH_ID_RE.match(orch_id):
        raise HTTPException(
            status_code=400,
            detail=(
                f"orchestration_id must match YYYYMMDD_HHMMSS "
                f"(e.g. 20260116_171820); got: {orch_id!r}"
            ),
        )
    return orch_id
from ..job_queue.job_queue import JobQueue
from ..job_queue.job_models import (
    Job,
    JobType,
    JobStatus,
    JobResponse,
    JobDetailResponse
)

# OpenAPI tag definitions for Swagger UI grouping
openapi_tags = [
    {
        "name": "Health",
        "description": "Server health and readiness checks.",
    },
    {
        "name": "Standards Generation",
        "description": "Generate product-level and global baseline coding standards from source code analysis.",
    },
    {
        "name": "Specifications",
        "description": "CRUD operations for managing specifications (list, get, create via write-spec, delete).",
    },
    {
        "name": "Tasks",
        "description": "Generate and implement tasks from specifications.",
    },
    {
        "name": "Orchestration",
        "description": "Full workflow automation: shape-spec -> write-spec -> create-tasks -> implement-tasks. Includes synchronous and async (job queue) execution.",
    },
    {
        "name": "Shape-Spec",
        "description": "Initialize spec folders and gather requirements. Includes batch API and conversational streaming interface.",
    },
    {
        "name": "Plan-Product",
        "description": "Conversational product planning interface for defining mission, roadmap, and tech stack.",
    },
    {
        "name": "Jobs",
        "description": "Async job queue for long-running operations. Create jobs, poll status, and retrieve results.",
    },
    {
        "name": "Skills",
        "description": "Skill-based endpoints (e.g., Storybook story generation from component contracts).",
    },
    {
        "name": "Git Integration",
        "description": "Project initialization and git-integrated V2 endpoints.",
    },
]

# Initialize FastAPI app
app = FastAPI(
    title="Standards Extractor API",
    description=(
        "REST API for extracting and generating coding standards from codebases.\n\n"
        "## Authentication\n"
        "All endpoints (except `/health`) require a **Bearer token** in the `Authorization` header.\n"
        "Set the `STANDARDS_API_KEY` environment variable on the server, then pass it as:\n\n"
        "```\nAuthorization: Bearer <your-api-key>\n```\n\n"
        "## Typical Workflow\n"
        "1. **Plan Product** — `POST /api/v1/plan-product/stream` (creates mission.md, roadmap.md, tech-stack.md)\n"
        "2. **Shape Spec** — `POST /api/v1/shape-spec/stream` (creates requirements.md & initialization.md)\n"
        "3. **Orchestrate** — `POST /api/v1/orchestrations` or `POST /api/v1/jobs/orchestrations` (runs write-spec -> create-tasks -> implement-tasks)\n"
        "4. **Review** — `GET /api/v1/specs/{company}/{project}` to list generated specs\n"
    ),
    version="1.0.0",
    openapi_tags=openapi_tags
)

# CORS (needed for browser clients on http://localhost:5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],   # includes OPTIONS preflight
    allow_headers=["*"],   # includes Authorization, Content-Type
)

# Register structural analysis endpoints (these endpoints use their own
# `verify_api_key` defined in structural_endpoints.py — auth applied per-route).
from ..structural_endpoints import router as structural_router
app.include_router(structural_router)

# The other three routers (dep / refactor / discovery) get authentication
# applied at include-time below, AFTER `verify_api_key` is defined. They are
# imported here so the symbols are available; mounting happens later.
from .dep_routes import router as dep_router
from .refactor_routes import router as refactor_router
from .discovery_routes import router as discovery_router

# Security — shared with structural_endpoints.py via src.api_auth
from ..api_auth import security, verify_api_key

# Configuration
API_WORKSPACE_DIR = Path(os.getenv("API_WORKSPACE_DIR", "/home/ubuntu/api_workspace")).resolve()
API_WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
# Propagate the resolved default back into the process env so subsystems
# that read API_WORKSPACE_DIR directly via os.getenv (notably the async
# job worker in src/job_queue/tasks.py, which raises if unset) see the
# same value as the API server. Without this, the API silently defaulted
# while the worker crashed — surfaced by E2E test #1.
os.environ.setdefault("API_WORKSPACE_DIR", str(API_WORKSPACE_DIR))

# Set up logging
LOG_DIR = Path(os.getenv("LOG_DIR", API_WORKSPACE_DIR / "logs"))
LOG_DIR.mkdir(parents=True, exist_ok=True)

# Orchestration logs directory
ORCHESTRATION_LOG_DIR = Path(os.getenv("ORCHESTRATION_LOG_DIR", API_WORKSPACE_DIR / "logs" / "orchestration"))
ORCHESTRATION_LOG_DIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("ORCHESTRATION_LOG_DIR", str(ORCHESTRATION_LOG_DIR))

# Configure logging - use force=True to override any existing configuration
log_file = LOG_DIR / f"api_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.log"

# Create formatters and handlers
log_formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')

# File handler with UTF-8 encoding
file_handler = logging.FileHandler(log_file, encoding='utf-8')
file_handler.setLevel(logging.INFO)
file_handler.setFormatter(log_formatter)

# Console handler with UTF-8 encoding for cross-platform compatibility
# This fixes Unicode errors on Windows when logging special characters
import sys
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(log_formatter)
# Set stream encoding to UTF-8 to handle Unicode characters on Windows
if hasattr(console_handler.stream, 'reconfigure'):
    console_handler.stream.reconfigure(encoding='utf-8', errors='replace')

# Configure root logger to ensure all loggers inherit these handlers
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)

# Remove any existing handlers to avoid duplicates
root_logger.handlers.clear()

# Add our handlers
root_logger.addHandler(file_handler)
root_logger.addHandler(console_handler)

# Get logger for this module
logger = logging.getLogger(__name__)
logger.info(f"Standards Extractor API starting...")
logger.info(f"API Workspace Directory: {API_WORKSPACE_DIR}")
logger.info(f"Log Directory: {LOG_DIR}")
logger.info(f"Orchestration Log Directory: {ORCHESTRATION_LOG_DIR}")
logger.info(f"Log File: {log_file}")

# Thread pool for async execution
executor_pool = ThreadPoolExecutor(max_workers=4)

# Job queue for async operations. Single source of truth (predict R2): the
# routes that enqueue and the worker that polls resolve via the same helper, so
# an unset JOBS_DB_PATH can't split enqueue/poll across two files.
from src.safe_paths import jobs_db_path
JOBS_DB_PATH = jobs_db_path()
job_queue = JobQueue(JOBS_DB_PATH)
logger.info(f"Job Queue Database: {JOBS_DB_PATH}")


def load_env_config() -> dict:
    """Load configuration from environment variables.

    Defaults are an INTERNALLY CONSISTENT pair (anthropic + claude-*).
    The previous default `(anthropic, gpt-5.4)` was unworkable — the
    Anthropic API has no `gpt-*` models, so a fresh deployment failed
    at first LLM call. See `debug/260504-1635-api-layer-hunt-prose/findings.md` B3.
    """
    cfg = {
        'llm_provider': os.getenv('LLM_PROVIDER', 'anthropic'),
        'llm_model': os.getenv('LLM_MODEL', 'claude-sonnet-4-6'),
        'llm_api_key': os.getenv('OPENAI_API_KEY'),  # Used for both OpenAI and Anthropic
        'anthropic_api_key': os.getenv('ANTHROPIC_API_KEY'),
        'github_token': os.getenv('GITHUB_TOKEN'),
        'gitlab_token': os.getenv('GITLAB_TOKEN'),
        'bitbucket_username': os.getenv('BITBUCKET_USERNAME'),
        'bitbucket_password': os.getenv('BITBUCKET_APP_PASSWORD'),
        'config_dir': 'config',
        'templates_dir': 'templates/standards',
        'max_file_size_kb': 500,
        'standard_extraction_max_files': int(os.getenv('STANDARD_EXTRACTION_MAX_FILES', '0')) or None
    }
    _assert_provider_model_consistent(cfg['llm_provider'], cfg['llm_model'])
    return cfg


def _assert_provider_model_consistent(provider: str, model: str) -> None:
    """Fail fast at startup when LLM_PROVIDER / LLM_MODEL are an
    impossible pair. Catches operator misconfiguration before it
    surfaces as an opaque 404 from the LLM API at first request.
    """
    if provider == 'anthropic' and not model.startswith('claude'):
        raise ValueError(
            f"LLM_MODEL={model!r} is incompatible with LLM_PROVIDER='anthropic' "
            f"(Anthropic only serves 'claude-*' models). Set LLM_MODEL to a "
            f"Claude model (e.g. 'claude-sonnet-4-6') or change LLM_PROVIDER."
        )
    if provider == 'openai' and not (model.startswith('gpt-') or model.startswith('o')):
        raise ValueError(
            f"LLM_MODEL={model!r} is incompatible with LLM_PROVIDER='openai' "
            f"(OpenAI serves 'gpt-*' / 'o*' models). Set LLM_MODEL to a GPT/o "
            f"model (e.g. 'gpt-5.4-mini') or change LLM_PROVIDER."
        )
    # 'custom' (local proxies) accepts any model name — no check.


# Backend registry — descriptor, dispatch helpers, factories — lives in
# `src.backend_registry` so peers (orchestrator, job worker) can import
# directly without reaching into `src.api`'s private namespace. The
# re-export preserves backwards compatibility for any existing callers
# that import `BACKEND_REGISTRY` / `BackendDescriptor` etc. from
# `src.api`. See debug/260518-0633-executor-smell-taxonomy CO1.
from ..backend_registry import (
    BACKEND_REGISTRY,
    BackendDescriptor,
    _active_backend,
    _build_cli_executor,
    _credentials_satisfied,
    _executor_backend,
)


# Implementation lives in src/api/recovery.py per spec Phase A.3.
# Re-export the names so any code still importing them from src.api
# keeps working.
#
# The recovery call itself runs LATER in this module — after
# `_safe_project_dir` is defined, since recovery's body lazy-imports
# it from this module mid-execution. See the call site below
# `def _safe_project_dir` for the actual invocation.
from .recovery import (
    _determine_last_completed_step,
    _dispatch_recovered_job,
    _recover_interrupted_jobs,
)


def get_haikai_service() -> HaikaiService:
    """Get HaikaiService instance with current configuration."""
    config = load_env_config()
    anthropic_api_key = config.get('anthropic_api_key')
    
    if not anthropic_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ANTHROPIC_API_KEY not configured on server"
        )

    return HaikaiService(
        workspace_dir=API_WORKSPACE_DIR,
        anthropic_api_key=anthropic_api_key
    )


# `verify_api_key` lives in src.api_auth (imported above). Below: mount the
# three routers that don't have per-route auth — apply verify_api_key at
# include-time so every endpoint inside them is protected. (structural_router
# is mounted earlier because its endpoints already declare auth individually.)
app.include_router(dep_router, dependencies=[Depends(verify_api_key)])
app.include_router(refactor_router, dependencies=[Depends(verify_api_key)])
app.include_router(discovery_router, dependencies=[Depends(verify_api_key)])


def sanitize_path(path_str: str) -> Path:
    """
    Sanitize and validate path to prevent directory traversal.
    
    All paths are treated as relative to API_WORKSPACE_DIR.
    Path traversal attempts (../) are blocked.
    
    Args:
        path_str: Path string from client
        
    Returns:
        Absolute path within API_WORKSPACE_DIR
        
    Raises:
        HTTPException: If path traversal is detected
    """
    # Convert to Path object
    path = Path(path_str)
    
    # Check for path traversal attempts
    if ".." in path.parts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Path traversal not allowed: {path_str}"
        )
    
    # Make absolute relative to workspace
    absolute_path = (API_WORKSPACE_DIR / path).resolve()
    
    # Ensure it's still within workspace (double-check)
    try:
        absolute_path.relative_to(API_WORKSPACE_DIR)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Path must be within workspace: {path_str}"
        )
    
    return absolute_path


def _safe_project_dir(company: str, project: str) -> Path:
    """Resolve a workspace-relative `<company>/<project>` directory safely.

    Validates that neither segment can traverse outside `API_WORKSPACE_DIR`.
    Use this everywhere we'd otherwise write `API_WORKSPACE_DIR / company / project`.
    """
    return sanitize_path(f"{company}/{project}")


# Run recovery on module load. Placed AFTER `_safe_project_dir` (and
# after `job_queue` / `load_env_config` / `API_WORKSPACE_DIR` further
# up) because recovery.py lazy-imports them from this module — we have
# to be past their definition points before triggering the call.
_recover_interrupted_jobs()

# Start the async-verification liveness backstops (D10.5 TTL sweeper + D9.1
# poll-fallback). Both existed but nothing drove them; this runs them on a timer
# in a daemon thread. Off via VERIFY_MAINTENANCE=off.
from src.verification.maintenance import start_background as _start_verify_maintenance
_start_verify_maintenance()


async def run_operation(request) -> OperationResponse:
    """
    Run operation in thread pool to avoid blocking.
    
    Args:
        request: Operation request object
        
    Returns:
        OperationResponse
    """
    loop = asyncio.get_event_loop()
    config = load_env_config()
    executor = OperationExecutor(config, workspace_dir=API_WORKSPACE_DIR)
    return await loop.run_in_executor(executor_pool, executor.execute, request)


@app.get(
    "/health",
    tags=["Health"],
    summary="Health check",
    response_description="Server status",
)
async def health_check():
    """
    Returns the current health status of the server.

    No authentication required.

    **Example response:**
    ```json
    {"status": "healthy", "service": "standards-extractor"}
    ```
    """
    return {"status": "healthy", "service": "standards-extractor"}


@app.get(
    "/api/v1/metamodels/{company}/{project}/{metamodel_id}",
    tags=["Standards Generation"],
    summary="Get architectural metamodel",
    response_model=OperationResponse,
    responses={401: {"description": "Invalid or missing API key"}, 500: {"description": "Server error or metamodel fetch failure"}},
)
async def get_metamodel(
    company: str,
    project: str,
    metamodel_id: str,
    authenticated: bool = Depends(verify_api_key)
):
    """
    Fetch an architectural metamodel from an external system.

    **Example:**
    ```
    GET /api/v1/metamodels/acme/backend/arch-model-v2
    Authorization: Bearer <api-key>
    ```
    """
    try:
        # Create request
        request = GetMetamodelRequest(
            metamodel_id=metamodel_id,
            company=company,
            project=project
        )
        
        # Execute operation
        response = await run_operation(request)
        
        return response.dict()
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get metamodel: {str(e)}"
        )

# /api/v1/standards/product/generate -> src/api/routes/standards.py (Phase A.6b)

# /api/v1/standards/global/generate -> src/api/routes/standards.py (Phase A.6b)


# ============================================================================
# Haikai CRUD API Endpoints
# ============================================================================

# "/api/v1/specs/{company}/{project}" → src/api/routes/specs.py (Phase A.6a)


# "/api/v1/specs/{company}/{project}/{spec_id}" → src/api/routes/specs.py (Phase A.6a)

# "/api/v1/specs/{company}/{project}/write-spec" → src/api/routes/specs.py (Phase A.6a)


# "/api/v1/specs/{company}/{project}/{spec_id}" (DELETE) → src/api/routes/specs.py (Phase A.6a)


# "/api/v1/specs/{company}/{project}/{spec_id}/tasks" → src/api/routes/specs.py (Phase A.6a)

# "/api/v1/specs/{company}/{project}/{spec_id}/tasks/generate" → src/api/routes/specs.py (Phase A.6a)

# "/api/v1/specs/{company}/{project}/{spec_id}/implement" → src/api/routes/specs.py (Phase A.6a)

# "/api/v1/orchestrations" → src/api/routes/orchestration.py (Phase A.5)


# ============================================================================
# V2 Orchestration API — Brain-only (write-spec + create-tasks, no implement)
# ============================================================================

# "/api/v2/orchestrations/brain-only" → src/api/routes/orchestration.py (Phase A.5)


# Implementation-package endpoints moved to src/api/packages.py per
# spec Phase A.4. The router is mounted on `app` near the end of this
# file (look for `app.include_router(packages_router)`).

from .routes.orchestration import router as orchestration_router
app.include_router(orchestration_router)

from .routes.specs import router as specs_router
app.include_router(specs_router)

from .routes.standards import router as standards_router
app.include_router(standards_router)

from .routes.jobs import router as jobs_router
app.include_router(jobs_router)

from .routes.chat import router as chat_router
app.include_router(chat_router)

# Verification inbound-gateway (spec 2026-05-20, D9.1). NOT behind
# verify_api_key — webhooks authenticate via ingress token + provider
# signature (D10.4); the API bearer scheme doesn't apply to CI providers.
from .routes.inbound import router as inbound_router
app.include_router(inbound_router)

# Bug intake (Gary's POST /api/v2/bugs/) — behind the API bearer key.
from .routes.bugs import router as bugs_router
app.include_router(bugs_router)

# Run Flow Graph (spec 2026-07-02-run-flow-graph, D8) — snapshot + SSE of the
# server-owned execution graph. Bearer-auth.
from .routes.runs import router as runs_router
app.include_router(runs_router)

from .routes.haikai import router as haikai_router
app.include_router(haikai_router)

from .routes.projects import router as projects_router
app.include_router(projects_router)
from .routes.repos import router as repos_router
app.include_router(repos_router)
from .packages import router as packages_router

app.include_router(packages_router)


# "/api/v1/orchestrations/{orchestration_id}/status" → src/api/routes/orchestration.py (Phase A.5)


# "/api/v1/orchestrations/{orchestration_id}/logs" → src/api/routes/orchestration.py (Phase A.5)

# POST /api/v1/haikai/shape-specs -> src/api/routes/haikai.py (Phase A.6e)


# GET /api/v1/haikai/shape-specs/{company}/{project} -> src/api/routes/haikai.py (Phase A.6e)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)


# ============================================================================
# BACKGROUND JOB RUNNER
# ============================================================================

def _run_job_in_background(job_id: str):
    """
    Execute a queued job in-process (no separate worker needed).
    Reads the job from storage, runs the appropriate task function,
    and updates the job status on completion or failure.
    """
    from ..job_queue.tasks import run_orchestration
    storage = job_queue.storage

    job = storage.get_job(job_id)
    if not job:
        logger.error(f"Background job runner: job {job_id} not found")
        return

    # CAS claim: a polling worker may have (or may be about to) claim this
    # job. Whoever wins the QUEUED→RUNNING flip executes; the loser walks
    # away. Without this, both paths execute the same job and stomp each
    # other's whole-row save_job writes.
    if not storage.claim_job(job_id, "api-background"):
        logger.info(
            f"Background job runner: job {job_id} already claimed elsewhere; skipping"
        )
        return

    try:
        if job.type == JobType.ORCHESTRATION:
            run_orchestration(job_id, storage)
        else:
            logger.error(f"Background job runner: unsupported job type {job.type}")
            job.status = JobStatus.FAILED
            job.completed_at = datetime.now(timezone.utc)
            job.error = f"Unsupported job type: {job.type}"
            storage.save_job(job)
    except Exception as e:
        logger.error(f"Background job runner: job {job_id} failed: {e}", exc_info=True)
        # tasks.run_orchestration already marks the job as FAILED, but guard just in case
        job = storage.get_job(job_id)
        if job and job.status != JobStatus.FAILED:
            job.status = JobStatus.FAILED
            job.completed_at = datetime.now(timezone.utc)
            job.error = str(e)
            storage.save_job(job)


# ============================================================================
# ASYNC JOB QUEUE ENDPOINTS
# ============================================================================

# POST /api/v1/jobs/orchestrations -> src/api/routes/jobs.py (Phase A.6c)


# GET /api/v1/jobs/{job_id} -> src/api/routes/jobs.py (Phase A.6c)


# GET /api/v1/jobs -> src/api/routes/jobs.py (Phase A.6c)


# DELETE /api/v1/jobs/{job_id} -> src/api/routes/jobs.py (Phase A.6c)



# ============================================================================
# Chat API Endpoints (Shape-Spec Conversational Interface)
# ============================================================================

from fastapi.responses import StreamingResponse
from ..chat.audit_logger import AuditLogger
from ..chat.session_store import create_active_session, get_active_session, clear_active_session

# Chat-executor factories moved to `src/api/factories.py` per spec
# `haikai/specs/2026-05-18-api-and-stream-modularize/` Phase A.1.
# Re-export the public surface — including the 3 chat-executor classes
# — so existing callers (and `@patch('src.api.<X>')` test mocks) keep
# working unchanged.
from .factories import (
    ClaudeChatExecutor,
    OAuthChatExecutor,
    OpenAIChatExecutor,
    _build_claude_chat_executor,
    create_chat_executor,
)
from .gates import require_credentials
from ..chat.chat_models import (
    ChatMessageRequest,
    ChatHistoryRequest,
    ChatClearRequest,
    ChatHistoryResponse,
    ChatClearResponse,
    MessageEntry
)

# POST /api/v1/shape-spec/stream -> src/api/routes/chat.py (Phase A.6d)


# GET /api/v1/shape-spec/history -> src/api/routes/chat.py (Phase A.6d)


# DELETE /api/v1/shape-spec -> src/api/routes/chat.py (Phase A.6d)


# ==========================================
# Plan Product Streaming Endpoints
# ==========================================

# POST /api/v1/plan-product/stream -> src/api/routes/chat.py (Phase A.6d)


# GET /api/v1/plan-product/history -> src/api/routes/chat.py (Phase A.6d)


# DELETE /api/v1/plan-product -> src/api/routes/chat.py (Phase A.6d)


# =============================================================================
# story-component-anchor SSE endpoint
# =============================================================================

# const STORY_ANCHOR_PROMPT -> src/api/routes/chat.py (Phase A.6d)


# class StoryAnchorRequest -> src/api/routes/chat.py (Phase A.6d)


# POST /api/v1/story-component-anchor/stream -> src/api/routes/chat.py (Phase A.6d)


# =============================================================================
# analyze-repo SSE endpoint
# =============================================================================

# const ANALYZE_REPO_PROMPT -> src/api/routes/chat.py (Phase A.6d)


# class AnalyzeRepoRequest -> src/api/routes/chat.py (Phase A.6d)


# POST /api/v1/analyze-repo/stream -> src/api/routes/chat.py (Phase A.6d)


# =============================================================================
# Git Integration — Project Init + V2 Endpoints
# =============================================================================

def _require_git_manager(company: str, project: str) -> GitManager:
    """FastAPI dependency: load git config, verify project initialized, return GitManager.

    Raises HTTPException(400) if git config is missing or project is not initialized.
    """
    try:
        git_config = load_git_config()
    except GitConfigError as e:
        raise HTTPException(status_code=400, detail=f"Git configuration error: {e}")

    # Validates company/project — see autoresearch:debug 260504-1229 #1.
    # _require_git_manager is called by 10 v2 git endpoints; this single
    # change closes the workspace-escape risk for all of them.
    product_root = _safe_project_dir(company, project)

    # `POST /projects/init` clones each repo into a *subdirectory* of the
    # product root (`product_root / <folder>`, see src/api/routes/projects.py)
    # and writes coordination.yaml at the product root itself -- so the product
    # root is NOT a git repo. Resolve the real repo directory from the
    # coordination map so every V2 git op (pull/branch/commit/push) runs inside
    # an actual git repo rather than the product root (which has no `.git`).
    # mono vs poly is inferred from the map's length -- see src/git/coordination.py.
    try:
        repos = read_coordination(product_root)
    except CoordinationError:
        raise HTTPException(
            status_code=400,
            detail="Project not initialized. Call POST /projects/init first.",
        )
    # Polyrepo: use the first repo for the pre-flight GitManager check.
    # The actual multi-repo iteration happens in _resolve_repo_targets (tasks.py).
    repo_folder = next(iter(repos))
    repo_dir = product_root / repo_folder

    gm = GitManager(
        project_dir=repo_dir,
        provider=git_config.provider,
        default_branch=git_config.default_branch,
        github_token=git_config.github_token,
        bitbucket_username=git_config.bitbucket_username,
        bitbucket_app_password=git_config.bitbucket_app_password,
    )

    if not gm.ensure_initialized():
        raise HTTPException(
            status_code=400,
            detail="Project not initialized. Call POST /projects/init first.",
        )
    return gm


# POST /projects/init -> src/api/routes/projects.py (Phase A.6f)


# -----------------------------------------------------------------------------
# V2 Orchestration (git-integrated)
# -----------------------------------------------------------------------------

# "/api/v2/orchestrations" → src/api/routes/orchestration.py (Phase A.5)


# -----------------------------------------------------------------------------
# V2 Shape-Spec (git-integrated)
# -----------------------------------------------------------------------------

# POST /api/v2/shape-spec/stream -> src/api/routes/chat.py (Phase A.6d)


# -----------------------------------------------------------------------------
# V2 Plan-Product (git-integrated)
# -----------------------------------------------------------------------------

# POST /api/v2/plan-product/stream -> src/api/routes/chat.py (Phase A.6d)


# -----------------------------------------------------------------------------
# V2 Product Standards (git-integrated)
# -----------------------------------------------------------------------------

# /api/v2/standards/product/generate -> src/api/routes/standards.py (Phase A.6b)


# -----------------------------------------------------------------------------
# V2 Async Orchestration (git-integrated)
# -----------------------------------------------------------------------------

# POST /api/v2/jobs/orchestrations -> src/api/routes/jobs.py (Phase A.6c)


# GET /api/v2/jobs/{job_id} -> src/api/routes/jobs.py (Phase A.6c)


# -----------------------------------------------------------------------------
# V2 Write-Spec, Tasks/Generate, Implement (git-integrated)
# -----------------------------------------------------------------------------

# "/api/v2/specs/{company}/{project}/write-spec" → src/api/routes/specs.py (Phase A.6a)


# "/api/v2/specs/{company}/{project}/{spec_id}/tasks/generate" → src/api/routes/specs.py (Phase A.6a)


# "/api/v2/specs/{company}/{project}/{spec_id}/implement" → src/api/routes/specs.py (Phase A.6a)


# -----------------------------------------------------------------------------
# V2 Batch Shape-Specs (git-integrated)
# -----------------------------------------------------------------------------

# POST /api/v2/haikai/shape-specs -> src/api/routes/haikai.py (Phase A.6e)


# -----------------------------------------------------------------------------
# V2 Read-Only Endpoints (require init, no git writes)
# -----------------------------------------------------------------------------

# "/api/v2/specs/{company}/{project}" → src/api/routes/specs.py (Phase A.6a)


# "/api/v2/specs/{company}/{project}/{spec_id}" → src/api/routes/specs.py (Phase A.6a)


# "/api/v2/specs/{company}/{project}/{spec_id}/tasks" → src/api/routes/specs.py (Phase A.6a)


# GET /api/v2/shape-spec/history -> src/api/routes/chat.py (Phase A.6d)


# GET /api/v2/plan-product/history -> src/api/routes/chat.py (Phase A.6d)


# helper _build_chat_history -> src/api/routes/chat.py (Phase A.6d)

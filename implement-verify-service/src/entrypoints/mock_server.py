"""
Mock server for standards-extractor API.
Mocks endpoints:
  POST /api/v1/shape-spec/stream       (new session → questions, resume → folder)
  POST /api/v1/plan-product/stream     (product planning conversation)
  POST /api/v1/orchestrations          (synchronous orchestration)
  POST /api/v1/jobs/orchestrations     (queue async orchestration job)
  GET  /api/v1/jobs/{job_id}           (poll job status)
  POST /api/v2/orchestrations          (brain-only orchestration → implementation packages)
  GET  /api/v2/orchestrations/{company}/{project}/{spec_name}/package       (ZIP download)
  GET  /api/v2/orchestrations/{company}/{project}/{spec_name}/package/json  (JSON package)
  GET  /health

Stateful: shape-spec/stream creates an active session per (company, project).
Session IDs are random UUID4s (matching real session_store behavior).
Orchestration reads the active session — clients do not pass session_id.

Based on regression test data from 20 real runs against the live API (2026-02-23).
"""

import io
import json
import uuid
import asyncio
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional, List

from fastapi import FastAPI, Depends, HTTPException, Header, status
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel, Field

app = FastAPI(title="Standards Extractor Mock Server", version="0.5.0")

# --- In-memory stores ---
jobs: Dict[str, dict] = {}

# Registry of shaped specs: key = (company, project, folder) → session_id
shaped_specs: Dict[tuple, str] = {}

# Active session store: key = (company, project) → {session_id, created_at, folder}
# Mirrors src/chat/session_store.py behavior
active_sessions: Dict[tuple, dict] = {}


# --- Models ---

class ChatMessageRequest(BaseModel):
    company: str
    project: str
    message: str
    session_mode: str = "resume"


class OrchestrationOptions(BaseModel):
    stop_on_error: bool = True
    retry_on_failure: bool = False
    max_retries: int = 1
    timeout_seconds: Optional[int] = None


class SpecIntent(BaseModel):
    spec_name: str
    session_id: Optional[str] = None


class OrchestrationRequest(BaseModel):
    company: str
    project: str
    spec_intents: list[SpecIntent]
    context_files: Optional[list[str]] = None
    options: Optional[OrchestrationOptions] = Field(default_factory=OrchestrationOptions)


async def verify_api_key(authorization: Optional[str] = Header(None)) -> bool:
    """Verify API key — mock accepts any non-empty Bearer token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return True


# --- Realistic questions based on regression test observations ---
# From 20 real runs: questions ranged from 8-11, typically 10.
# These are representative questions the LLM consistently asks.

SHAPE_SPEC_QUESTIONS = [
    {
        "id": "q1",
        "question": "I assume you want the Spring Boot application.properties to be minimal with just application.name=crud-logic-service and server.port=8080. Should we include any additional default properties like logging levels or profiles?"
    },
    {
        "id": "q2",
        "question": "For the Dockerfile multi-stage build, I'm thinking we'll use eclipse-temurin:21-jdk for the build stage and eclipse-temurin:21-jre for the runtime stage to minimize image size. Is this the right approach, or would you prefer a different base image?"
    },
    {
        "id": "q3",
        "question": "I assume the unit test setup should include JUnit 5 (jupiter) with Spring Boot Test dependencies, and we'll provide one sample ApplicationContext smoke test that verifies the Spring context loads. Is that sufficient, or should we include additional testing frameworks like Mockito or AssertJ explicitly?"
    },
    {
        "id": "q4",
        "question": "For the Maven pom.xml, I'm assuming we should use Spring Boot 3.4.x (latest stable 3.x). Do you have a specific Spring Boot 3.x minor version preference, or should I use the latest stable release?"
    },
    {
        "id": "q5",
        "question": "The README should include sections for Prerequisites (Java 21, Maven/Docker), Building (mvn clean package), Testing (mvn test), Running Locally (mvn spring-boot:run), and Docker (build & run commands). Should we also include any troubleshooting tips or IDE setup instructions?"
    },
    {
        "id": "q6",
        "question": "For the Maven Wrapper, I assume we'll use the latest mvnw version that supports Java 21. Should the .mvn/wrapper directory be committed to the repository with the wrapper jar included?"
    },
    {
        "id": "q7",
        "question": "Since you mentioned 'ready-to-commit repo', should I also include a .gitignore file with standard Java/Maven/IDE exclusions (target/, *.class, .idea/, .vscode/, etc.)?"
    },
    {
        "id": "q8",
        "question": "Are there any specific aspects of the scaffold you explicitly DON'T want included that aren't already mentioned in the Out of Scope section? For example: application.yml instead of .properties, specific logging frameworks, Spring profiles configuration, or any particular Maven plugins?"
    },
    {
        "id": "q-reuse",
        "question": "Are there existing Spring Boot services in your codebase with similar patterns we should reference? For example: existing service scaffolds with preferred folder structures, standard pom.xml configurations or parent POMs, Dockerfile patterns already in use, or README templates. Please provide file/folder paths or repository names if they exist."
    },
    {
        "id": "q-visual",
        "question": "Do you have any design mockups, wireframes, or architectural diagrams that could help guide the scaffold structure? If yes, please place them in haikai/specs/<folder>/planning/visuals/ with descriptive file names like folder-structure-diagram.png or architecture-overview.jpg."
    },
]


# --- 1) POST /api/v1/shape-spec/stream ---

@app.post("/api/v1/shape-spec/stream")
async def shape_spec_stream(
    request: ChatMessageRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock streaming shape-spec endpoint.

    Realistic SSE responses based on 20 regression test runs (2026-02-23).

    session_mode=new:
      - Creates a new random UUID4 session (matches real session_store behavior)
      - Returns session → questions (8-11 questions) → folder → done
      - Simulates ~2 min response time via async delays

    session_mode=resume:
      - Reuses the active session for this (company, project)
      - Returns session → folder → done
      - Simulates ~20s response time (answer processing)
    """
    key = (request.company, request.project)

    # Generate folder name from date + spec description
    folder = f"{datetime.now(timezone.utc).strftime('%Y-%m-%d')}-crud-logic-service-scaffold"

    if request.session_mode == "new":
        # Create new random session (matches real session_store.create_active_session)
        session_id = str(uuid.uuid4())
        active_sessions[key] = {
            "session_id": session_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "folder": folder,
        }

        # Register spec for orchestration validation
        spec_key = (request.company, request.project, folder)
        shaped_specs[spec_key] = session_id

        events = [
            {"type": "session", "session_id": session_id},
            {"type": "questions", "questions": SHAPE_SPEC_QUESTIONS},
            {"type": "folder", "folder": folder},
            {"type": "done"},
        ]

        async def generate_new():
            # Session event comes immediately
            yield f"data: {json.dumps(events[0])}\n\n"
            # Simulate Claude CLI processing time (real: 109-172s, mock: 2s)
            await asyncio.sleep(2.0)
            # Questions event
            yield f"data: {json.dumps(events[1])}\n\n"
            await asyncio.sleep(0.1)
            # Folder event
            yield f"data: {json.dumps(events[2])}\n\n"
            await asyncio.sleep(0.1)
            # Done event
            yield f"data: {json.dumps(events[3])}\n\n"

        return StreamingResponse(
            generate_new(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    else:
        # Resume — look up or auto-create active session
        session_data = active_sessions.get(key)
        if session_data:
            session_id = session_data["session_id"]
            folder = session_data["folder"]
        else:
            # No prior session — create one automatically (matches real behavior)
            session_id = str(uuid.uuid4())
            active_sessions[key] = {
                "session_id": session_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "folder": folder,
            }

        events = [
            {"type": "session", "session_id": session_id},
            {"type": "folder", "folder": folder},
            {"type": "done"},
        ]

        async def generate_resume():
            # Session event comes immediately
            yield f"data: {json.dumps(events[0])}\n\n"
            # Simulate answer processing time (real: 15-29s, mock: 1s)
            await asyncio.sleep(1.0)
            # Folder event (observed in ~10% of resume runs)
            yield f"data: {json.dumps(events[1])}\n\n"
            await asyncio.sleep(0.1)
            # Done event
            yield f"data: {json.dumps(events[2])}\n\n"

        return StreamingResponse(
            generate_resume(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )


# --- 2) POST /api/v1/plan-product/stream ---

@app.post("/api/v1/plan-product/stream")
async def plan_product_stream(
    request: ChatMessageRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock streaming plan-product endpoint.
    Same SSE pattern as shape-spec but for product planning.
    """
    session_id = str(uuid.uuid4())

    if request.session_mode == "new":
        events = [
            {"type": "session", "session_id": session_id},
            {"type": "questions", "questions": [
                {"id": "q1", "question": "What is the primary business problem this product aims to solve?"},
                {"id": "q2", "question": "Who are the target users/personas for this product?"},
                {"id": "q3", "question": "What are the key success metrics or KPIs for this product?"},
                {"id": "q4", "question": "Are there any existing systems or integrations this product needs to work with?"},
                {"id": "q5", "question": "What is the expected timeline and are there any hard deadlines?"},
            ]},
            {"type": "done"},
        ]
    else:
        events = [
            {"type": "session", "session_id": session_id},
            {"type": "done"},
        ]

    async def generate():
        for event in events:
            yield f"data: {json.dumps(event)}\n\n"
            await asyncio.sleep(0.2)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# --- 3) POST /api/v1/jobs/orchestrations ---

@app.post("/api/v1/orchestrations")
async def orchestrate_features(
    request: OrchestrationRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock synchronous orchestration.

    Resolves session_id from the active session store (not from request).
    Validates each spec_intent against the shaped_specs registry.
    """
    key = (request.company, request.project)
    session_data = active_sessions.get(key)
    if not session_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No active session for {request.company}/{request.project}. Run shape-spec first.",
        )
    session_id = session_data["session_id"]

    errors = []
    for intent in request.spec_intents:
        spec_key = (request.company, request.project, intent.spec_name)
        if shaped_specs.get(spec_key) is None:
            errors.append(
                f"Spec folder '{intent.spec_name}' not found for "
                f"{request.company}/{request.project}. Run /shape-spec first."
            )
    if errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=errors)

    spec_names = [si.spec_name for si in request.spec_intents]
    session_ids = {name: session_id for name in spec_names}

    return {
        "success": True,
        "spec_names": spec_names,
        "session_ids": session_ids,
        "results": [
            {
                "step": i + 1,
                "command": cmd,
                "status": "success",
                "output_paths": [f"haikai/specs/{spec_names[0]}/{artifact}"],
                "execution_time_seconds": round(3.0 + i * 1.5, 1),
                "log_file": f"/tmp/orchestration-logs/mock/step-{i + 1}-{cmd.lstrip('/')}.json",
                "error_message": None,
            }
            for i, (cmd, artifact) in enumerate([
                ("/write-spec", "spec.md"),
                ("/create-tasks", "tasks.md"),
                ("/implement-tasks", "verification-report.md"),
            ])
        ],
        "total_execution_time_seconds": 10.0,
        "orchestration_log": "/tmp/orchestration-logs/mock/orchestration.json",
    }


@app.post("/api/v1/jobs/orchestrations")
async def create_orchestration_job(
    request: OrchestrationRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock async orchestration job creation.

    Resolves session_id from the active session store.
    Validates each spec_intent against the shaped_specs registry.
    """
    key = (request.company, request.project)
    session_data = active_sessions.get(key)
    if not session_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No active session for {request.company}/{request.project}. Run shape-spec first.",
        )
    session_id = session_data["session_id"]

    errors = []
    for intent in request.spec_intents:
        spec_key = (request.company, request.project, intent.spec_name)
        if shaped_specs.get(spec_key) is None:
            errors.append(
                f"Spec folder '{intent.spec_name}' not found for "
                f"{request.company}/{request.project}. Run /shape-spec first."
            )
    if errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=errors)

    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    job = {
        "job_id": job_id,
        "type": "orchestration",
        "status": "queued",
        "company": request.company,
        "project": request.project,
        "session_id": session_id,
        "request_payload": request.model_dump(),
        "created_at": now.isoformat(),
        "started_at": None,
        "completed_at": None,
        "progress": None,
        "result": None,
        "error": None,
        "logs_url": None,
        "_created_ts": now,
    }
    jobs[job_id] = job

    return {
        "job_id": job_id,
        "status": "queued",
        "created_at": now.isoformat(),
    }


# --- 4) GET /api/v1/jobs/{job_id} ---

@app.get("/api/v1/jobs/{job_id}")
async def get_job_status(
    job_id: str,
    authenticated: bool = Depends(verify_api_key),
):
    """
    Mock job status. Simulates progression:
      0-5s  → queued
      5-10s → running (with progress)
      10s+  → completed (with mock result)
    """
    if job_id not in jobs:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found",
        )

    job = jobs[job_id]
    elapsed = (datetime.now(timezone.utc) - job["_created_ts"]).total_seconds()

    spec_intents = job["request_payload"].get("spec_intents", [])
    spec_names = [si.get("spec_name", "unknown") for si in spec_intents]
    session_id = job.get("session_id", "unknown")
    session_ids = {name: session_id for name in spec_names}

    if elapsed < 5:
        job["status"] = "queued"
    elif elapsed < 10:
        job["status"] = "running"
        job["started_at"] = (job["_created_ts"] + timedelta(seconds=5)).isoformat()
        pct = min(int((elapsed - 5) / 5 * 100), 99)
        job["progress"] = {
            "current_step": 2,
            "total_steps": 3,
            "step_description": "Executing write-spec",
            "percentage": pct,
        }
    else:
        started = job["_created_ts"] + timedelta(seconds=5)
        completed = job["_created_ts"] + timedelta(seconds=10)
        job["status"] = "completed"
        job["started_at"] = started.isoformat()
        job["completed_at"] = completed.isoformat()
        job["progress"] = None
        job["result"] = {
            "success": True,
            "spec_names": spec_names,
            "session_ids": session_ids,
            "results": [
                {
                    "step": 1,
                    "command": "/write-spec",
                    "status": "success",
                    "output_paths": [
                        f"workspace/{job['company']}/{job['project']}/haikai/specs/{spec_names[0]}/spec.md"
                    ],
                    "execution_time_seconds": 3.2,
                    "log_file": f"/tmp/orchestration-logs/{job_id}/step-1-write-spec.json",
                    "error_message": None,
                },
                {
                    "step": 2,
                    "command": "/create-tasks",
                    "status": "success",
                    "output_paths": [
                        f"workspace/{job['company']}/{job['project']}/haikai/specs/{spec_names[0]}/tasks.md"
                    ],
                    "execution_time_seconds": 2.1,
                    "log_file": f"/tmp/orchestration-logs/{job_id}/step-2-create-tasks.json",
                    "error_message": None,
                },
                {
                    "step": 3,
                    "command": "/implement-tasks",
                    "status": "success",
                    "output_paths": [
                        f"workspace/{job['company']}/{job['project']}/haikai/specs/{spec_names[0]}/verification-report.md"
                    ],
                    "execution_time_seconds": 4.7,
                    "log_file": f"/tmp/orchestration-logs/{job_id}/step-3-implement-tasks.json",
                    "error_message": None,
                },
            ],
            "total_execution_time_seconds": 10.0,
            "orchestration_log": f"/tmp/orchestration-logs/{job_id}/orchestration.json",
        }
        job["logs_url"] = f"/api/v1/jobs/{job_id}/logs"

    hidden = {"_created_ts", "request_payload"}
    return {k: v for k, v in job.items() if k not in hidden and not k.startswith("_")}


# ============================================================================
# V2 Orchestration API — Brain-only (write-spec + create-tasks, no implement)
# ============================================================================

# In-memory store for v2 implementation packages
v2_packages: Dict[tuple, dict] = {}  # key = (company, project, spec_name)

MOCK_SPEC_CONTENT = """# Scenarios Service Scaffold

## Overview
Spring Boot 4.0 microservice scaffold for Market Risk scenarios.

## Requirements
- Java 25, Spring Boot 4.0.x, Maven
- Actuator on port 8060
- Package: com.marketrisk.scenarios
"""

MOCK_TASKS_CONTENT = """# Implementation Tasks

## Task Group 1: Project Setup
- [ ] Initialize Maven project with Spring Boot 4.0 parent
- [ ] Configure application.yml with profiles (dev, test, prod)
- [ ] Set up Actuator on management port 8060

## Task Group 2: Package Structure
- [ ] Create domain package with base entity
- [ ] Create api package with health controller
- [ ] Create infrastructure package with repository interfaces

## Task Group 3: Testing
- [ ] Add integration test for application startup
- [ ] Add Actuator endpoint smoke tests
"""

MOCK_REQUIREMENTS_CONTENT = """# Requirements
- Java 25 with Spring Boot 4.0.x
- Maven build system
- Actuator health endpoint on port 8060
- Profile-based configuration (dev/test/prod)
"""

MOCK_INITIALIZATION_CONTENT = """# Initialization
Session initialized for scenarios-service-scaffold.
Company: acme | Project: backend
"""


@app.post("/api/v2/orchestrations")
async def orchestrate_features_v2(
    request: OrchestrationRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock v2 brain-only orchestration.

    Runs write-spec + create-tasks only (no implement-tasks).
    Returns implementation packages for handoff to a developer machine.
    Session ID resolved from active session store.
    """
    key = (request.company, request.project)
    session_data = active_sessions.get(key)
    if not session_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No active session for {request.company}/{request.project}. Run shape-spec first.",
        )
    session_id = session_data["session_id"]

    errors = []
    for intent in request.spec_intents:
        spec_key = (request.company, request.project, intent.spec_name)
        if shaped_specs.get(spec_key) is None:
            errors.append(
                f"Spec folder '{intent.spec_name}' not found for "
                f"{request.company}/{request.project}. Run /shape-spec first."
            )
    if errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=errors)

    spec_names = [si.spec_name for si in request.spec_intents]
    session_ids = {name: session_id for name in spec_names}

    implementation_packages = []
    for intent in request.spec_intents:
        pkg = {
            "spec_name": intent.spec_name,
            "company": request.company,
            "project": request.project,
            "files": [
                {"path": f"haikai/specs/{intent.spec_name}/planning/requirements.md", "content": MOCK_REQUIREMENTS_CONTENT},
                {"path": f"haikai/specs/{intent.spec_name}/planning/initialization.md", "content": MOCK_INITIALIZATION_CONTENT},
                {"path": f"haikai/specs/{intent.spec_name}/spec.md", "content": MOCK_SPEC_CONTENT},
                {"path": f"haikai/specs/{intent.spec_name}/tasks.md", "content": MOCK_TASKS_CONTENT},
            ],
            "instructions": f"Extract into your project root and run: claude /implement-tasks for {intent.spec_name}",
        }
        implementation_packages.append(pkg)
        # Store for GET endpoints
        v2_packages[(request.company, request.project, intent.spec_name)] = pkg

    return {
        "success": True,
        "spec_names": spec_names,
        "session_ids": session_ids,
        "results": [
            {
                "step": 1,
                "command": "/write-spec",
                "status": "success",
                "output_paths": [f"workspace/{request.company}/{request.project}/haikai/specs/{spec_names[0]}/spec.md"],
                "execution_time_seconds": 3.2,
                "log_file": f"/tmp/orchestration-logs/v2-mock/step-1-write-spec.json",
                "error_message": None,
            },
            {
                "step": 2,
                "command": "/create-tasks",
                "status": "success",
                "output_paths": [f"workspace/{request.company}/{request.project}/haikai/specs/{spec_names[0]}/tasks.md"],
                "execution_time_seconds": 2.1,
                "log_file": f"/tmp/orchestration-logs/v2-mock/step-2-create-tasks.json",
                "error_message": None,
            },
        ],
        "total_execution_time_seconds": 5.3,
        "orchestration_log": "/tmp/orchestration-logs/v2-mock/orchestration.json",
        "implementation_packages": implementation_packages,
    }


@app.get("/api/v2/orchestrations/{company}/{project}/{spec_name}/package")
async def get_implementation_package_zip(company: str, project: str, spec_name: str):
    """Download implementation package as ZIP."""
    key = (company, project, spec_name)
    pkg = v2_packages.get(key)
    if not pkg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No package found for spec '{spec_name}'")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in pkg["files"]:
            zf.writestr(f["path"], f["content"])
    buf.seek(0)

    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{spec_name}-implementation-package.zip"'},
    )


@app.get("/api/v2/orchestrations/{company}/{project}/{spec_name}/package/json")
async def get_implementation_package_json(company: str, project: str, spec_name: str):
    """Get implementation package as JSON."""
    key = (company, project, spec_name)
    pkg = v2_packages.get(key)
    if not pkg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No package found for spec '{spec_name}'")
    return pkg


# ============================================================================
# V2 Git-Integrated Endpoints
# ============================================================================
# V2 endpoints mirror V1 behavior but require project initialization and
# simulate git operations (branch, commit, push, PR) after each action.

# In-memory store for initialized projects: key = (company, project)
initialized_projects: Dict[tuple, dict] = {}


class ProjectInitRequest(BaseModel):
    company: str
    project: str
    repo_url: str


def _require_initialized(company: str, project: str):
    """Mock equivalent of _require_git_manager — checks project was initialized."""
    key = (company, project)
    if key not in initialized_projects:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Project {company}/{project} not initialized. Call POST /projects/init first.",
        )
    return initialized_projects[key]


# --- POST /projects/init ---

@app.post("/projects/init")
async def init_project(
    request: ProjectInitRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock project initialization from a git repository."""
    key = (request.company, request.project)
    if key in initialized_projects:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Project {request.company}/{request.project} is already initialized.",
        )

    initialized_projects[key] = {
        "company": request.company,
        "project": request.project,
        "repo_url": request.repo_url,
        "initialized_at": datetime.now(timezone.utc).isoformat(),
    }

    return {
        "success": True,
        "message": f"Project initialized from {request.repo_url}",
        "project_dir": f"/app/workspace/{request.company}/{request.project}",
        "mode": "brownfield",
    }


# --- POST /api/v2/shape-spec/stream ---

@app.post("/api/v2/shape-spec/stream")
async def shape_spec_stream_v2(
    request: ChatMessageRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock V2 git-integrated shape-spec streaming.

    Same as V1 but requires initialized project. Simulates git pull before starting.
    """
    _require_initialized(request.company, request.project)

    # Delegate to V1 logic
    return await shape_spec_stream(request, authenticated)


# --- POST /api/v2/plan-product/stream ---

@app.post("/api/v2/plan-product/stream")
async def plan_product_stream_v2(
    request: ChatMessageRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock V2 git-integrated plan-product streaming.

    Same as V1 but requires initialized project. Simulates git commit/push after completion.
    """
    _require_initialized(request.company, request.project)
    return await plan_product_stream(request, authenticated)


# --- POST /api/v2/orchestrations (full, git-integrated) ---
# Note: the existing POST /api/v2/orchestrations above is brain-only.
# The real API changed /api/v2/orchestrations to be full orchestration with git.
# The brain-only endpoint moved to /api/v2/orchestrations/brain-only.
# Updating the existing endpoint is handled above; adding the brain-only path here.

@app.post("/api/v2/orchestrations/brain-only")
async def orchestrate_brain_only_v2(
    request: OrchestrationRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock V2 brain-only orchestration (write-spec + create-tasks, no implement).

    Same as the existing /api/v2/orchestrations response but at the brain-only path.
    """
    _require_initialized(request.company, request.project)
    return await orchestrate_features_v2(request, authenticated)


# --- POST /api/v2/standards/product/generate ---

class GenerateProductStandardsRequest(BaseModel):
    company: str
    project: str
    sources: Optional[list[str]] = None


@app.post("/api/v2/standards/product/generate")
async def generate_product_standards_v2(
    request: GenerateProductStandardsRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock V2 git-integrated product standards generation.

    After generation, simulates commit to feature branch and PR creation.
    """
    _require_initialized(request.company, request.project)

    return {
        "success": True,
        "message": f"Product standards generated for {request.company}/{request.project}",
        "output_dir": f"/app/workspace/{request.company}/{request.project}/standards",
    }


# --- POST /api/v2/jobs/orchestrations ---

@app.post("/api/v2/jobs/orchestrations")
async def create_orchestration_job_v2(
    request: OrchestrationRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock V2 git-integrated async orchestration job.

    Same as V1 job creation but requires initialized project.
    """
    _require_initialized(request.company, request.project)
    return await create_orchestration_job(request, authenticated)


# --- GET /api/v2/jobs/{job_id} ---

@app.get("/api/v2/jobs/{job_id}")
async def get_job_status_v2(
    job_id: str,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock V2 job status — delegates to V1."""
    return await get_job_status(job_id, authenticated)


# --- POST /api/v2/specs/{company}/{project}/write-spec ---

class WriteSpecRequest(BaseModel):
    spec_id: str
    requirements_path: Optional[str] = None


@app.post("/api/v2/specs/{company}/{project}/write-spec")
async def write_spec_v2(
    company: str,
    project: str,
    request: WriteSpecRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock V2 git-integrated write-spec. Simulates git commit after writing."""
    _require_initialized(company, project)

    return {
        "success": True,
        "spec_id": request.spec_id,
        "spec_path": f"haikai/specs/{request.spec_id}/spec.md",
        "message": f"Specification written for {request.spec_id}",
    }


# --- POST /api/v2/specs/{company}/{project}/{spec_id}/tasks/generate ---

@app.post("/api/v2/specs/{company}/{project}/{spec_id}/tasks/generate")
async def generate_tasks_v2(
    company: str,
    project: str,
    spec_id: str,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock V2 git-integrated tasks generation. Simulates git commit after generating."""
    _require_initialized(company, project)

    return {
        "success": True,
        "spec_id": spec_id,
        "tasks_path": f"haikai/specs/{spec_id}/tasks.md",
        "message": f"Tasks generated for {spec_id}",
    }


# --- POST /api/v2/specs/{company}/{project}/{spec_id}/implement ---

@app.post("/api/v2/specs/{company}/{project}/{spec_id}/implement")
async def implement_tasks_v2(
    company: str,
    project: str,
    spec_id: str,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock V2 git-integrated task implementation. Simulates commit, push, and PR."""
    _require_initialized(company, project)

    return {
        "success": True,
        "spec_id": spec_id,
        "verification_report_path": f"haikai/specs/{spec_id}/verification-report.md",
        "message": f"Tasks implemented for {spec_id}",
        "git": {
            "branch": f"feature/{spec_id}",
            "commit": "abc123mock",
            "pr_url": f"https://github.com/mock/{company}/{project}/pull/1",
        },
    }


# --- POST /api/v2/haikai/shape-specs (batch) ---

class ShapeSpecBatchRequest(BaseModel):
    company: str
    project: str
    spec_intents: list[str]


@app.post("/api/v2/haikai/shape-specs")
async def create_shape_specs_v2(
    request: ShapeSpecBatchRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock V2 git-integrated batch shape-specs.

    Creates spec folders and feature branches for each intent.
    """
    _require_initialized(request.company, request.project)

    results = []
    for idx, intent in enumerate(request.spec_intents):
        spec_name = f"{datetime.now(timezone.utc).strftime('%Y-%m-%d')}-spec-{idx + 1}"
        results.append({
            "spec_name": spec_name,
            "spec_intent": intent[:200],
            "status": "success",
            "spec_path": f"/app/workspace/{request.company}/{request.project}/haikai/specs/{spec_name}",
            "requirements_path": f"/app/workspace/{request.company}/{request.project}/haikai/specs/{spec_name}/planning/requirements.md",
            "execution_time_seconds": 2.0,
            "error_message": None,
        })

    return {
        "success": True,
        "results": results,
        "total_execution_time_seconds": len(results) * 2.0,
    }


# --- V2 Read-Only Endpoints ---

@app.get("/api/v2/specs/{company}/{project}")
async def list_specs_v2(
    company: str,
    project: str,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock V2 list specs. Returns specs registered via shape-spec."""
    _require_initialized(company, project)

    specs = []
    for (c, p, folder), sid in shaped_specs.items():
        if c == company and p == project:
            specs.append({
                "spec_id": folder,
                "spec_name": folder,
                "has_spec": True,
                "has_tasks": False,
                "has_implementation": False,
            })

    return {"specs": specs, "count": len(specs)}


@app.get("/api/v2/specs/{company}/{project}/{spec_id}")
async def get_spec_v2(
    company: str,
    project: str,
    spec_id: str,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock V2 get spec details."""
    _require_initialized(company, project)

    key = (company, project, spec_id)
    if key not in shaped_specs:
        raise HTTPException(status_code=404, detail=f"Spec not found: {spec_id}")

    return {
        "spec_id": spec_id,
        "spec_name": spec_id,
        "content": MOCK_SPEC_CONTENT,
        "requirements": MOCK_REQUIREMENTS_CONTENT,
    }


@app.get("/api/v2/specs/{company}/{project}/{spec_id}/tasks")
async def get_tasks_v2(
    company: str,
    project: str,
    spec_id: str,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock V2 get tasks for a spec."""
    _require_initialized(company, project)

    key = (company, project, spec_id)
    if key not in shaped_specs:
        raise HTTPException(status_code=404, detail=f"Tasks not found for spec: {spec_id}")

    return {
        "spec_id": spec_id,
        "content": MOCK_TASKS_CONTENT,
    }


@app.get("/api/v2/shape-spec/history")
async def get_shape_spec_history_v2(
    company: str,
    project: str,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock V2 shape-spec conversation history."""
    _require_initialized(company, project)

    return {"messages": [
        {"role": "user", "content": "I need a service scaffold", "timestamp": datetime.now(timezone.utc).isoformat()},
        {"role": "assistant", "content": "I'll help you define the requirements.", "timestamp": datetime.now(timezone.utc).isoformat()},
    ]}


@app.get("/api/v2/plan-product/history")
async def get_plan_product_history_v2(
    company: str,
    project: str,
    authenticated: bool = Depends(verify_api_key),
):
    """Mock V2 plan-product conversation history."""
    _require_initialized(company, project)

    return {"messages": []}


# --- Health check ---

@app.get("/health")
async def health():
    return {"status": "ok", "mock": True, "version": "0.5.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="localhost", port=8000)

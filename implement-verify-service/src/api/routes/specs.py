"""Specification CRUD HTTP endpoints — v1 + v2.

Per spec `haikai/specs/2026-05-18-api-and-stream-modularize/`
Phase A.6a (smallest of the 4 A.6 sub-phases). 13 endpoints extracted
from `src/api/__init__.py`:

V1 (no git):
| Verb   | Path                                                       |
|--------|------------------------------------------------------------|
| GET    | `/api/v1/specs/{company}/{project}`                        |
| GET    | `/api/v1/specs/{company}/{project}/{spec_id}`              |
| POST   | `/api/v1/specs/{company}/{project}/write-spec`             |
| DELETE | `/api/v1/specs/{company}/{project}/{spec_id}`              |
| GET    | `/api/v1/specs/{company}/{project}/{spec_id}/tasks`        |
| POST   | `/api/v1/specs/{company}/{project}/{spec_id}/tasks/generate` |
| POST   | `/api/v1/specs/{company}/{project}/{spec_id}/implement`    |

V2 (git-integrated):
| Verb | Path                                                              |
|------|-------------------------------------------------------------------|
| POST | `/api/v2/specs/{company}/{project}/write-spec`                    |
| POST | `/api/v2/specs/{company}/{project}/{spec_id}/tasks/generate`      |
| POST | `/api/v2/specs/{company}/{project}/{spec_id}/implement`           |
| GET  | `/api/v2/specs/{company}/{project}`                               |
| GET  | `/api/v2/specs/{company}/{project}/{spec_id}`                     |
| GET  | `/api/v2/specs/{company}/{project}/{spec_id}/tasks`               |

Mounted onto `app` in `src/api/__init__.py` via
`app.include_router(specs_router)`.

Import strategy (per A.5 pattern):
- **Top-level** for cross-module symbols (no cycle risk):
  `verify_api_key`, all the Pydantic models, `load_git_config`,
  `GitConfigError`, `GitManagerError`. Tests patching these should
  target `src.api.routes.specs.X`.
- **Lazy** for `src.api`-internal symbols: `get_haikai_service`,
  `_require_git_manager`. Tests patching these can stay at
  `src.api.X` — lazy import reads the api namespace at call time.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status

from ...haikai_crud_models import (
    DeleteSpecResponse,
    GenerateTasksResponse,
    ImplementRequest,
    ImplementResponse,
    SpecDetail,
    SpecListResponse,
    TasksDetail,
    WriteSpecRequest,
    WriteSpecResponse,
)
from ...api_auth import verify_api_key
from ...git.config import GitConfigError, load_git_config, load_git_config_with_project_fallback
from ...git.git_manager import GitManagerError

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# V1 — no git integration
# ============================================================================


@router.get(
    "/api/v1/specs/{company}/{project}",
    tags=["Specifications"],
    summary="List all specifications",
    response_model=SpecListResponse,
    responses={401: {"description": "Invalid or missing API key"}, 500: {"description": "Server error"}},
)
async def list_specs(
    company: str,
    project: str,
    authenticated: bool = Depends(verify_api_key)
) -> SpecListResponse:
    """List all specifications for a company/project."""
    from .. import get_haikai_service

    try:
        service = get_haikai_service()
        return service.list_specs(company, project)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list specs: {str(e)}"
        )


@router.get(
    "/api/v1/specs/{company}/{project}/{spec_id}",
    tags=["Specifications"],
    summary="Get specification details",
    response_model=SpecDetail,
    responses={401: {"description": "Invalid or missing API key"}, 404: {"description": "Specification not found"}, 500: {"description": "Server error"}},
)
async def get_spec(
    company: str,
    project: str,
    spec_id: str,
    authenticated: bool = Depends(verify_api_key)
) -> SpecDetail:
    """Get detailed information about a single specification."""
    from .. import get_haikai_service

    try:
        service = get_haikai_service()
        return service.get_spec(company, project, spec_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get spec: {str(e)}"
        )


@router.post(
    "/api/v1/specs/{company}/{project}/write-spec",
    tags=["Specifications"],
    summary="Create a specification (write-spec)",
    response_model=WriteSpecResponse,
    responses={
        401: {"description": "Invalid or missing API key"},
        404: {"description": "Requirements file not found — run shape-spec first"},
        409: {"description": "Specification already exists"},
        500: {"description": "Server error"},
    },
)
async def write_spec(
    company: str,
    project: str,
    request: WriteSpecRequest,
    authenticated: bool = Depends(verify_api_key)
) -> WriteSpecResponse:
    """Create a new specification by running the `/write-spec` command."""
    from .. import get_haikai_service

    try:
        service = get_haikai_service()
        return service.write_spec(company, project, request)
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except FileExistsError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to write spec: {str(e)}"
        )


@router.delete(
    "/api/v1/specs/{company}/{project}/{spec_id}",
    tags=["Specifications"],
    summary="Delete a specification",
    response_model=DeleteSpecResponse,
    responses={401: {"description": "Invalid or missing API key"}, 404: {"description": "Specification not found"}, 500: {"description": "Server error"}},
)
async def delete_spec(
    company: str,
    project: str,
    spec_id: str,
    authenticated: bool = Depends(verify_api_key)
) -> DeleteSpecResponse:
    """Delete a specification and all its associated files."""
    from .. import get_haikai_service

    try:
        service = get_haikai_service()
        return service.delete_spec(company, project, spec_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete spec: {str(e)}"
        )


@router.get(
    "/api/v1/specs/{company}/{project}/{spec_id}/tasks",
    tags=["Tasks"],
    summary="Get tasks for a specification",
    response_model=TasksDetail,
    responses={401: {"description": "Invalid or missing API key"}, 404: {"description": "Specification or tasks not found"}, 500: {"description": "Server error"}},
)
async def get_tasks(
    company: str,
    project: str,
    spec_id: str,
    authenticated: bool = Depends(verify_api_key)
) -> TasksDetail:
    """Get the parsed task groups and tasks for a specification."""
    from .. import get_haikai_service

    try:
        service = get_haikai_service()
        return service.get_tasks(company, project, spec_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get tasks: {str(e)}"
        )


@router.post(
    "/api/v1/specs/{company}/{project}/{spec_id}/tasks/generate",
    tags=["Tasks"],
    summary="Generate tasks from a specification",
    response_model=GenerateTasksResponse,
    responses={
        401: {"description": "Invalid or missing API key"},
        404: {"description": "Specification not found"},
        409: {"description": "Tasks already exist for this specification"},
        500: {"description": "Server error"},
    },
)
async def generate_tasks(
    company: str,
    project: str,
    spec_id: str,
    authenticated: bool = Depends(verify_api_key)
) -> GenerateTasksResponse:
    """Generate implementation tasks by running the `/create-tasks` command."""
    from .. import get_haikai_service

    try:
        service = get_haikai_service()
        return service.generate_tasks(company, project, spec_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except FileExistsError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate tasks: {str(e)}"
        )


@router.post(
    "/api/v1/specs/{company}/{project}/{spec_id}/implement",
    tags=["Tasks"],
    summary="Implement tasks for a specification",
    response_model=ImplementResponse,
    responses={401: {"description": "Invalid or missing API key"}, 404: {"description": "Specification or tasks not found"}, 500: {"description": "Server error"}},
)
async def implement_tasks(
    company: str,
    project: str,
    spec_id: str,
    request: Optional[ImplementRequest] = None,
    authenticated: bool = Depends(verify_api_key)
) -> ImplementResponse:
    """Implement tasks by running the `/implement-tasks` command."""
    from .. import get_haikai_service

    try:
        service = get_haikai_service()
        return service.implement_tasks(company, project, spec_id, request)
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to implement tasks: {str(e)}"
        )


# ============================================================================
# V2 — git-integrated (require project to be initialized)
# ============================================================================


@router.post(
    "/api/v2/specs/{company}/{project}/write-spec",
    tags=["Git Integration"],
    summary="Create a specification with git integration (V2)",
    response_model=WriteSpecResponse,
    responses={
        400: {"description": "Project not initialized or git config missing"},
        401: {"description": "Invalid or missing API key"},
        404: {"description": "Requirements file not found"},
        409: {"description": "Specification already exists"},
        500: {"description": "Server error"},
    },
)
async def write_spec_v2(
    company: str,
    project: str,
    request: WriteSpecRequest,
    authenticated: bool = Depends(verify_api_key),
) -> WriteSpecResponse:
    """Git-integrated write-spec. Creates feature branch + commits per spec
    2026-03-15-deferred-branch-creation."""
    from .. import _require_git_manager, get_haikai_service

    gm = _require_git_manager(company, project)

    try:
        service = get_haikai_service()
        response = service.write_spec(company, project, request)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write spec: {e}")

    # Create branch then commit. autoresearch:debug 260504-1620 B1.
    # write-spec is commit-only; orchestration owns push + PR per
    # spec 2026-03-15-deferred-branch-creation. git_config is not needed
    # for commit_only=True (preserves pre-extraction behaviour: no
    # GitConfigError raised here even if GIT_PROVIDER is unset).
    from ..git_workflow import apply_git_workflow

    apply_git_workflow(
        gm=gm,
        git_config=None,
        branch=f"feature/{request.spec_id}",
        commit_msg=f"feature: write-spec for {request.spec_id}",
        commit_only=True,
        error_label=f"write-spec {request.spec_id}",
    )

    return response


@router.post(
    "/api/v2/specs/{company}/{project}/{spec_id}/tasks/generate",
    tags=["Git Integration"],
    summary="Generate tasks with git integration (V2)",
    response_model=GenerateTasksResponse,
    responses={
        400: {"description": "Project not initialized or git config missing"},
        401: {"description": "Invalid or missing API key"},
        404: {"description": "Specification not found"},
        409: {"description": "Tasks already exist"},
        500: {"description": "Server error"},
    },
)
async def generate_tasks_v2(
    company: str,
    project: str,
    spec_id: str,
    authenticated: bool = Depends(verify_api_key),
) -> GenerateTasksResponse:
    """Git-integrated tasks generation. Creates feature branch + commits."""
    from .. import _require_git_manager, get_haikai_service

    gm = _require_git_manager(company, project)

    try:
        service = get_haikai_service()
        response = service.generate_tasks(company, project, spec_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate tasks: {e}")

    # create-tasks is commit-only; orchestration owns push + PR.
    from ..git_workflow import apply_git_workflow

    apply_git_workflow(
        gm=gm,
        git_config=None,
        branch=f"feature/{spec_id}",
        commit_msg=f"feature: create-tasks for {spec_id}",
        response_obj=response,
        commit_only=True,
        error_label=f"tasks/generate {spec_id}",
    )

    return response


@router.post(
    "/api/v2/specs/{company}/{project}/{spec_id}/implement",
    tags=["Git Integration"],
    summary="Implement tasks with git integration (V2)",
    response_model=ImplementResponse,
    responses={
        400: {"description": "Project not initialized or git config missing"},
        401: {"description": "Invalid or missing API key"},
        404: {"description": "Specification or tasks not found"},
        500: {"description": "Server error"},
    },
)
async def implement_tasks_v2(
    company: str,
    project: str,
    spec_id: str,
    request: Optional[ImplementRequest] = None,
    authenticated: bool = Depends(verify_api_key),
) -> ImplementResponse:
    """Git-integrated implementation: commits, pushes, creates PR."""
    from .. import _require_git_manager, get_haikai_service

    gm = _require_git_manager(company, project)

    try:
        service = get_haikai_service()
        response = service.implement_tasks(company, project, spec_id, request)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to implement tasks: {e}")

    from ..git_workflow import apply_git_workflow
    try:
        # Saved-provider fallback (2026-07-27) — mirrors _require_git_manager.
        git_config = load_git_config_with_project_fallback([gm.project_dir])
    except GitConfigError as e:
        error_msg = f"Git push/PR failed for implement {spec_id}: {e}"
        logger.error(error_msg)
        response.git_errors = [error_msg]
        return response

    branch = f"feature/{spec_id}"
    # Capture errors into a temp namespace (response uses `git_errors`,
    # not the helper's `errors` convention).
    from types import SimpleNamespace
    capture = SimpleNamespace(errors=[])
    apply_git_workflow(
        gm=gm,
        git_config=git_config,
        branch=branch,
        commit_msg=f"feature: implement-tasks for {spec_id}",
        pr_title=f"feature: {spec_id}",
        pr_body=f"Implementation output for {spec_id}",
        response_obj=capture,
        error_label=f"implement {spec_id}",
    )
    if capture.errors:
        response.git_errors = capture.errors

    return response


# ============================================================================
# V2 read-only (require init, no git writes)
# ============================================================================


@router.get(
    "/api/v2/specs/{company}/{project}",
    tags=["Git Integration"],
    summary="List all specifications (V2, requires init)",
    response_model=SpecListResponse,
    responses={400: {"description": "Project not initialized"}, 401: {"description": "Invalid or missing API key"}},
)
async def list_specs_v2(
    company: str,
    project: str,
    authenticated: bool = Depends(verify_api_key),
):
    """List all specifications for a project. Requires initialized project."""
    from .. import _require_git_manager, get_haikai_service

    _require_git_manager(company, project)
    service = get_haikai_service()
    try:
        return service.list_specs(company, project)
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get(
    "/api/v2/specs/{company}/{project}/{spec_id}",
    tags=["Git Integration"],
    summary="Get specification details (V2, requires init)",
    response_model=SpecDetail,
    responses={400: {"description": "Project not initialized"}, 401: {"description": "Invalid or missing API key"}},
)
async def get_spec_v2(
    company: str,
    project: str,
    spec_id: str,
    authenticated: bool = Depends(verify_api_key),
):
    """Get specification details. Requires initialized project."""
    from .. import _require_git_manager, get_haikai_service

    _require_git_manager(company, project)
    service = get_haikai_service()
    try:
        return service.get_spec(company, project, spec_id)
    except FileNotFoundError as e:
        # service raises FNF when spec dir or spec.md is missing — map to
        # 404 so callers get a clear "not found" instead of a 500.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get(
    "/api/v2/specs/{company}/{project}/{spec_id}/tasks",
    tags=["Git Integration"],
    summary="Get tasks for a specification (V2, requires init)",
    response_model=TasksDetail,
    responses={400: {"description": "Project not initialized"}, 401: {"description": "Invalid or missing API key"}},
)
async def get_tasks_v2(
    company: str,
    project: str,
    spec_id: str,
    authenticated: bool = Depends(verify_api_key),
):
    """Get tasks for a specification. Requires initialized project."""
    from .. import _require_git_manager, get_haikai_service

    _require_git_manager(company, project)
    service = get_haikai_service()
    try:
        return service.get_tasks(company, project, spec_id)
    except FileNotFoundError as e:
        # haikai_service.get_tasks raises FNF when spec dir or
        # tasks.md is missing. Without this catch, the FNF bubbles up
        # as a 500 — surfaced by E2E test #4 against petclinic.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

"""Haikai shape-spec CRUD routes (V1 + V2).

Three batch shape-spec endpoints lifted from `src/api/__init__.py`
during Phase A.6e. Distinct from the conversational
`/api/v1/shape-spec/stream` endpoint (chat.py) — these run the
`/shape-spec` command in batch mode, one spec_intent at a time.

  V1:
    * POST   /api/v1/haikai/shape-specs                       create_shape_specs
    * GET    /api/v1/haikai/shape-specs/{company}/{project}   get_shape_specs

  V2 (git-integrated):
    * POST   /api/v2/haikai/shape-specs                       create_shape_specs_v2

`executor_pool` (a ThreadPoolExecutor) and helpers `_safe_project_dir`,
`_require_git_manager`, `load_env_config` are module-level state in
`src/api/__init__.py`; they're imported lazily inside each endpoint
body to avoid a load cycle.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status

from ...haikai_shape_spec_models import (
    GetSpecsResponse,
    ShapeSpecRequest,
    ShapeSpecResponse,
    ShapeSpecResult,
    SpecInfo,
)
from ...api_auth import verify_api_key
from ...backend_registry import _build_cli_executor
from ...git.git_manager import GitManagerError
from ..gates import require_credentials

logger = logging.getLogger("src.api")

router = APIRouter()


@router.post(
    "/api/v1/haikai/shape-specs",
    tags=["Shape-Spec"],
    summary="Create shape-specs (batch)",
    response_model=ShapeSpecResponse,
    responses={
        400: {"description": "Missing product planning files — run plan-product first"},
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
)
async def create_shape_specs(
    request: ShapeSpecRequest,
    authenticated: bool = Depends(verify_api_key),
) -> ShapeSpecResponse:
    """
    Create one or more shape-specs by running the `/shape-spec` command (batch mode).

    Initializes spec folders and gathers requirements **without** running the
    full orchestration workflow. Each `spec_intent` must be at least 50 characters.

    **Prerequisites:**
    - Product planning files must exist: `mission.md`, `roadmap.md`, `tech-stack.md`
    - Run `/plan-product` first if these files don't exist
    """
    from .. import _safe_project_dir, executor_pool
    try:
        anthropic_api_key = require_credentials()

        project_dir = _safe_project_dir(request.company, request.project)

        product_dir = project_dir / "haikai" / "product"
        required_files = ["mission.md", "roadmap.md", "tech-stack.md"]
        missing_files = []

        for file_name in required_files:
            file_path = product_dir / file_name
            if not file_path.exists():
                missing_files.append(str(file_path))

        if missing_files:
            error_msg = (
                f"Required product planning files are missing: "
                f"{', '.join(missing_files)}. Please run /plan-product "
                "command first to create these files."
            )
            raise FileNotFoundError(error_msg)

        # Selects Claude vs Kiro via CHAT_EXECUTOR env var
        cli_executor = _build_cli_executor(
            project_dir=str(project_dir),
            anthropic_api_key=anthropic_api_key,
        )

        start_time = dt.now()
        results = []

        for spec_intent in request.spec_intents:
            intent_start = dt.now()

            try:
                system_prompt = f"""You are shaping a specification from this spec intent:

{spec_intent}

Follow the /shape-spec workflow to:
1. Analyze the intent and decide an appropriate spec name
2. Initialize the spec folder structure
3. Research requirements by reviewing the product context files
4. Save complete requirements to planning/requirements.md

Do not ask the user questions - make reasonable assumptions based on best practices and the product context files (mission.md, roadmap.md, tech-stack.md).
"""

                loop = asyncio.get_event_loop()
                exec_result = await loop.run_in_executor(
                    executor_pool,
                    cli_executor.execute,
                    "/shape-spec",
                    system_prompt,
                )

                intent_end = dt.now()
                execution_time = (intent_end - intent_start).total_seconds()

                logger.info(f"Shape-spec stdout: {exec_result.get('stdout', '')[:1000]}")

                specs_dir = project_dir / "haikai" / "specs"
                spec_name = None
                spec_path = None

                logger.info(f"Looking for specs in: {specs_dir}")
                logger.info(f"Specs dir exists: {specs_dir.exists()}")

                if exec_result["success"]:
                    if specs_dir.exists():
                        spec_dirs = list(specs_dir.iterdir())
                        logger.info(f"Found {len(spec_dirs)} directories in specs folder")
                        if spec_dirs:
                            spec_dirs_sorted = sorted(spec_dirs, key=lambda p: p.stat().st_mtime, reverse=True)
                            spec_path = spec_dirs_sorted[0]
                            spec_name = spec_path.name
                            logger.info(f"Selected spec: {spec_name}")
                    else:
                        logger.warning(f"Specs directory does not exist: {specs_dir}")

                if spec_name and spec_path:
                    result = ShapeSpecResult(
                        spec_name=spec_name,
                        spec_intent=spec_intent[:200] + "..." if len(spec_intent) > 200 else spec_intent,
                        status="success",
                        spec_path=str(spec_path).replace("\\", "/"),
                        requirements_path=str(spec_path / "planning" / "requirements.md").replace("\\", "/") if (spec_path / "planning" / "requirements.md").exists() else None,
                        initialization_path=str(spec_path / "planning" / "initialization.md").replace("\\", "/") if (spec_path / "planning" / "initialization.md").exists() else None,
                        execution_time_seconds=execution_time,
                        error_message=None,
                    )
                else:
                    result = ShapeSpecResult(
                        spec_name="",
                        spec_intent=spec_intent[:200] + "..." if len(spec_intent) > 200 else spec_intent,
                        status="failure",
                        spec_path="",
                        requirements_path=None,
                        initialization_path=None,
                        execution_time_seconds=execution_time,
                        error_message="Failed to create spec directory or determine spec name",
                    )
                results.append(result)

            except Exception as e:
                intent_end = dt.now()
                execution_time = (intent_end - intent_start).total_seconds()

                result = ShapeSpecResult(
                    spec_name="",
                    spec_intent=spec_intent[:200] + "..." if len(spec_intent) > 200 else spec_intent,
                    status="failure",
                    spec_path="",
                    execution_time_seconds=execution_time,
                    error_message=str(e),
                )
                results.append(result)

        end_time = dt.now()
        total_time = (end_time - start_time).total_seconds()

        success = all(r.status == "success" for r in results)

        return ShapeSpecResponse(
            success=success,
            results=results,
            total_execution_time_seconds=total_time,
            timestamp=dt.now().isoformat(),
        )

    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create shape-specs: {str(e)}",
        )


@router.get(
    "/api/v1/haikai/shape-specs/{company}/{project}",
    tags=["Shape-Spec"],
    summary="List all shape-specs",
    response_model=GetSpecsResponse,
    responses={
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
)
async def get_shape_specs(
    company: str,
    project: str,
    authenticated: bool = Depends(verify_api_key),
) -> GetSpecsResponse:
    """
    List all spec folders for a company/project, including their artifact status.

    Shows which files exist for each spec: `requirements.md`, `spec.md`,
    `tasks.md`, and implementation files.
    """
    from .. import _safe_project_dir
    try:
        # Build specs directory path. Validates company/project — see
        # autoresearch:debug 260504-1229 finding #1.
        specs_dir = _safe_project_dir(company, project) / "haikai" / "specs"

        if not specs_dir.exists():
            return GetSpecsResponse(
                company=company,
                project=project,
                specs=[],
                total_specs=0,
                timestamp=dt.now().isoformat(),
            )

        specs = []
        for spec_path in sorted(specs_dir.iterdir()):
            if spec_path.is_dir():
                spec_name = spec_path.name
                feature_name = spec_name

                has_requirements = (spec_path / "planning" / "requirements.md").exists()
                has_spec = (spec_path / "spec.md").exists()
                has_tasks = (spec_path / "tasks.md").exists()

                impl_dir = spec_path / "implementation"
                has_implementation = False
                if impl_dir.exists() and impl_dir.is_dir():
                    has_implementation = any(impl_dir.iterdir())

                spec_info = SpecInfo(
                    spec_name=spec_name,
                    spec_path=str(spec_path),
                    has_requirements=has_requirements,
                    has_spec=has_spec,
                    has_tasks=has_tasks,
                    has_implementation=has_implementation,
                    feature_name=feature_name,
                )
                specs.append(spec_info)

        return GetSpecsResponse(
            company=company,
            project=project,
            specs=specs,
            total_specs=len(specs),
            timestamp=dt.now().isoformat(),
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get shape-specs: {str(e)}",
        )


@router.post(
    "/api/v2/haikai/shape-specs",
    tags=["Git Integration"],
    summary="Create shape-specs batch with git integration (V2)",
    response_model=ShapeSpecResponse,
    responses={
        400: {"description": "Project not initialized, git config missing, or product files missing"},
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
)
async def create_shape_specs_v2(
    request: ShapeSpecRequest,
    authenticated: bool = Depends(verify_api_key),
) -> ShapeSpecResponse:
    """
    Git-integrated batch shape-specs. For each spec intent, creates a feature
    branch after the spec folder is created.

    Same behavior as V1 but requires initialized project and creates feature branches.
    """
    from .. import _require_git_manager, _safe_project_dir, executor_pool

    gm = _require_git_manager(request.company, request.project)

    git_pull_error = None
    try:
        gm.pull_latest()
    except GitManagerError as e:
        git_pull_error = f"git pull failed before batch shape-specs: {e}"
        logger.warning(git_pull_error)

    try:
        anthropic_api_key = require_credentials()

        project_dir = _safe_project_dir(request.company, request.project)

        product_dir = project_dir / "haikai" / "product"
        required_files = ["mission.md", "roadmap.md", "tech-stack.md"]
        missing_files = [
            str(product_dir / f) for f in required_files if not (product_dir / f).exists()
        ]
        if missing_files:
            raise HTTPException(
                status_code=400,
                detail=f"Required product planning files missing: {', '.join(missing_files)}. Run /plan-product first.",
            )

        # Selects Claude vs Kiro via CHAT_EXECUTOR env var
        cli_executor = _build_cli_executor(
            project_dir=str(project_dir), anthropic_api_key=anthropic_api_key
        )

        start_time = dt.now()
        results = []

        for spec_intent in request.spec_intents:
            intent_start = dt.now()
            try:
                system_prompt = f"""You are shaping a specification from this spec intent:

{spec_intent}

Follow the /shape-spec workflow to:
1. Analyze the intent and decide an appropriate spec name
2. Initialize the spec folder structure
3. Research requirements by reviewing the product context files
4. Save complete requirements to planning/requirements.md

Do not ask the user questions - make reasonable assumptions based on best practices and the product context files (mission.md, roadmap.md, tech-stack.md).
"""
                loop = asyncio.get_event_loop()
                exec_result = await loop.run_in_executor(
                    executor_pool, cli_executor.execute, "/shape-spec", system_prompt
                )

                intent_end = dt.now()
                execution_time = (intent_end - intent_start).total_seconds()

                specs_dir = project_dir / "haikai" / "specs"
                spec_name = None
                spec_path = None

                if exec_result["success"] and specs_dir.exists():
                    spec_dirs = sorted(specs_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
                    if spec_dirs:
                        spec_path = spec_dirs[0]
                        spec_name = spec_path.name

                if spec_name and spec_path:
                    # Branch creation deferred to orchestration completion
                    result = ShapeSpecResult(
                        spec_name=spec_name,
                        spec_intent=spec_intent[:200] + "..." if len(spec_intent) > 200 else spec_intent,
                        status="success",
                        spec_path=str(spec_path).replace("\\", "/"),
                        requirements_path=str(spec_path / "planning" / "requirements.md").replace("\\", "/")
                        if (spec_path / "planning" / "requirements.md").exists()
                        else None,
                        initialization_path=str(spec_path / "planning" / "initialization.md").replace("\\", "/")
                        if (spec_path / "planning" / "initialization.md").exists()
                        else None,
                        execution_time_seconds=execution_time,
                        error_message=None,
                    )
                else:
                    result = ShapeSpecResult(
                        spec_name="",
                        spec_intent=spec_intent[:200] + "..." if len(spec_intent) > 200 else spec_intent,
                        status="failure",
                        spec_path="",
                        requirements_path=None,
                        initialization_path=None,
                        execution_time_seconds=execution_time,
                        error_message="Failed to create spec directory or determine spec name",
                    )
                results.append(result)

            except Exception as e:
                intent_end = dt.now()
                execution_time = (intent_end - intent_start).total_seconds()
                result = ShapeSpecResult(
                    spec_name="",
                    spec_intent=spec_intent[:200] + "..." if len(spec_intent) > 200 else spec_intent,
                    status="failure",
                    spec_path="",
                    execution_time_seconds=execution_time,
                    error_message=str(e),
                )
                results.append(result)

        end_time = dt.now()
        total_time = (end_time - start_time).total_seconds()
        errors = [git_pull_error] if git_pull_error else []
        success = all(r.status == "success" for r in results) and not errors

        return ShapeSpecResponse(
            success=success,
            results=results,
            total_execution_time_seconds=total_time,
            timestamp=dt.now().isoformat(),
            errors=errors,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create shape-specs: {e}")

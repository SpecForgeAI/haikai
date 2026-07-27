"""Standards generation routes (V1 + V2).

Three endpoints lifted from `src/api/__init__.py` during Phase A.6b:

  * POST /api/v1/standards/product/generate
  * POST /api/v1/standards/global/generate
  * POST /api/v2/standards/product/generate  (git-integrated)

All three delegate the actual work to `run_operation()` which still
lives in `src.api` (along with the `_require_git_manager` helper used
by V2). They're imported lazily inside each endpoint body to avoid a
load-cycle with the api package.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from ...api_auth import verify_api_key
from ...git.config import GitConfigError, load_git_config, load_git_config_with_project_fallback
from ...git.git_manager import GitManagerError
from ...models import (
    GenerateGlobalStandardsRequest,
    GenerateProductStandardsRequest,
    OperationResponse,
)

logger = logging.getLogger("src.api")

router = APIRouter()


@router.post(
    "/api/v1/standards/product/generate",
    tags=["Standards Generation"],
    summary="Generate product-level standards",
    response_model=OperationResponse,
    responses={
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error or generation failure"},
    },
)
async def generate_product_standards(
    request: GenerateProductStandardsRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """
    Analyze source code and generate product-level technical standards.

    Scans the provided source paths/URLs and generates coding standards
    specific to the project.
    """
    from .. import run_operation
    logger.info(
        f"API Request: generate_product_standards - company={request.company}, "
        f"project={request.project}, sources={request.sources}, "
        f"recursive={request.recursive}"
    )

    try:
        response = await run_operation(request)
        logger.info(
            f"API Response: generate_product_standards - success={response.success}, "
            f"outputs={len(response.outputs)} files"
        )
        return response.dict()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"API Error: generate_product_standards - {str(e)}", exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate product standards: {str(e)}",
        )


@router.post(
    "/api/v1/standards/global/generate",
    tags=["Standards Generation"],
    summary="Generate global baseline standards",
    response_model=OperationResponse,
    responses={
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error or generation failure"},
    },
)
async def generate_global_standards(
    request: GenerateGlobalStandardsRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """
    Generate global baseline coding standards for a company.

    At least one of `sources` or `technical_documents` must be provided.
    `technical_documents` keys: `tech_stack`, `coding_style`, `conventions`,
    `error_handling`, `validation`.
    """
    from .. import run_operation
    try:
        response = await run_operation(request)
        return response.dict()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate global standards: {str(e)}",
        )


@router.post(
    "/api/v2/standards/product/generate",
    tags=["Git Integration"],
    summary="Generate product standards with git integration (V2)",
    response_model=OperationResponse,
    responses={
        400: {"description": "Missing prerequisites or git config"},
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
)
async def generate_product_standards_v2(
    request: GenerateProductStandardsRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """
    Git-integrated product standards generation. After generation completes,
    commits output to a feature branch and creates a PR.
    """
    from .. import _require_git_manager, run_operation

    gm = _require_git_manager(request.company, request.project)

    try:
        response = await run_operation(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    from ..git_workflow import apply_git_workflow

    try:
        # Saved-provider fallback (2026-07-27) — mirrors _require_git_manager.
        git_config = load_git_config_with_project_fallback([gm.project_dir])
    except GitConfigError as e:
        error_msg = f"Git commit/push failed for product standards: {e}"
        logger.error(error_msg)
        result = response.dict()
        result["success"] = False
        result["errors"] = [error_msg]
        return result

    try:
        gm.pull_latest()
    except GitManagerError as e:
        error_msg = f"Git commit/push failed for product standards: {e}"
        logger.error(error_msg)
        result = response.dict()
        result["success"] = False
        result["errors"] = [error_msg]
        return result

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    branch = f"feature/product-standards-{date_str}"
    apply_git_workflow(
        gm=gm,
        git_config=git_config,
        branch=branch,
        commit_msg="feature: product standards",
        pr_title=f"feature: product standards for {request.project}",
        pr_body="Product standards generated from source code analysis.",
        response_obj=response,
        error_label="product standards",
    )

    if response.errors:
        result = response.dict()
        result["success"] = False
        return result

    return response.dict()

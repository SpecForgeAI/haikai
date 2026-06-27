"""Project initialization routes.

  * POST /projects/init  init_project

Accepts either the legacy single-repo body (``repo_url: str``) or the
multi-repo body (``repos: Dict[str, str]``). Both shapes flow through the
same code path — see ``src/git/models.py`` for the promotion logic.

For an N-entry init the route:

1. Validates the request (Pydantic-level constraints already enforced).
2. Creates the *product workspace root* (parent of all repo sub-dirs).
3. Loops the KV map, instantiating one ``GitManager(product_root / folder)``
   per entry and calling its ``init_project(url)``.
4. If any clone fails, rolls back the entire workspace — no partial state on
   disk — and returns 400. (FR-3, NFR-6 in the polyrepo spec.)
5. After all clones succeed, writes ``coordination.yaml`` at the product root.

The ``GitManager`` class itself is unchanged (NFR-3). Multiplicity comes
from instantiating it N times in this route, not from changing its
internals.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from ...api_auth import verify_api_key
from ...git.config import GitConfig, GitConfigError, load_git_config
from ...git.coordination import (
    COORDINATION_FILENAME,
    CoordinationError,
    coordination_path,
    write_coordination,
)
from ...git.git_manager import GitManager, GitManagerError
from ...git.models import ProjectInitRequest, ProjectInitResponse, RepoInitResult

router = APIRouter()

logger = logging.getLogger(__name__)


def _build_git_manager(repo_dir: Path, git_config: GitConfig) -> GitManager:
    """Construct a GitManager for one repo sub-directory.

    All callers in this module share the same credentials (one ``GitConfig``
    per request). Extracted so the loop body stays compact.
    """
    return GitManager(
        project_dir=repo_dir,
        provider=git_config.provider,
        default_branch=git_config.default_branch,
        github_token=git_config.github_token,
        bitbucket_username=git_config.bitbucket_username,
        bitbucket_app_password=git_config.bitbucket_app_password,
    )


def _rollback_workspace(
    product_root: Path,
    created_dirs: List[Path],
    product_root_was_created: bool,
) -> None:
    """Wipe everything this init call wrote to disk.

    Called when any per-repo clone fails so the filesystem is left in its
    pre-init state. ``best-effort`` — we log on each failure but never raise,
    since the caller is already on an error path.
    """
    for d in created_dirs:
        try:
            shutil.rmtree(d, ignore_errors=True)
        except Exception:  # pragma: no cover — ignore_errors=True swallows
            logger.exception("Rollback failed for %s", d)
    # Only remove the product root if we created it in this call and it
    # is empty (modulo the rmtree calls above). A pre-existing product root
    # with unrelated content must be left alone.
    if product_root_was_created:
        try:
            # rmdir only succeeds on an empty dir; safe.
            product_root.rmdir()
        except OSError:
            # Either non-empty (shouldn't be after the rmtree loop) or
            # gone already. Either way nothing more to do.
            pass


@router.post(
    "/projects/init",
    tags=["Git Integration"],
    summary="Initialize a project from one or more git repositories",
    response_model=ProjectInitResponse,
    responses={
        400: {"description": "Already initialized, repo unreachable, or missing git config"},
        401: {"description": "Invalid or missing API key"},
        500: {"description": "Server error"},
    },
)
async def init_project(
    request: ProjectInitRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Initialize a product workspace from a KV map of folder → repo URL.

    * ``N = 1``: same on-disk effect as the legacy single-repo init — one
      sub-directory cloned under the product root.
    * ``N > 1``: one sub-directory per entry, all cloned, then a single
      ``coordination.yaml`` written at the product root.

    Failure semantics: if *any* clone fails, the entire workspace is rolled
    back to its pre-call state and a 400 is returned. No partial workspace
    is left on disk.
    """
    from .. import _safe_project_dir

    try:
        # The per-request git_provider (when supplied) overrides GIT_PROVIDER;
        # the provider's auth token is still sourced from the environment.
        git_config = load_git_config(provider_override=request.git_provider)
    except GitConfigError as e:
        raise HTTPException(status_code=400, detail=f"Git configuration error: {e}")

    # After Pydantic + the model_validator, request.repos is guaranteed to be
    # a non-empty Dict[str, str] (either supplied directly or promoted from
    # the legacy repo_url). Defensive assertion for clarity:
    assert request.repos, "ProjectInitRequest.repos must be populated post-validation"

    product_root = _safe_project_dir(request.company, request.project)

    # Reject re-init if a coordination.yaml already exists. (For the legacy
    # one-entry case where the prior init didn't write coordination.yaml,
    # the GitManager's own `.git/` check inside init_project will fire.)
    if coordination_path(product_root).exists():
        raise HTTPException(
            status_code=400,
            detail=(
                f"Project already initialised: {COORDINATION_FILENAME} exists at "
                f"{product_root}. Use the CRUD endpoints under /repos to "
                f"modify the mapping."
            ),
        )

    product_root_was_created = not product_root.exists()
    product_root.mkdir(parents=True, exist_ok=True)

    created_dirs: List[Path] = []
    per_repo: List[RepoInitResult] = []

    try:
        for folder in sorted(request.repos.keys()):
            url = request.repos[folder]
            repo_dir = product_root / folder
            # Record BEFORE init_project so rollback also wipes the in-flight
            # repo's partial scratch. GitManager.init_project mkdirs the dir
            # early; if it then fails mid-clone the leftover would survive
            # without this.
            created_dirs.append(repo_dir)
            gm = _build_git_manager(repo_dir, git_config)
            mode = gm.init_project(url)
            per_repo.append(
                RepoInitResult(folder=folder, dir=str(repo_dir), mode=mode)
            )
    except GitManagerError as e:
        logger.warning(
            "Init failed during clone, rolling back workspace at %s: %s",
            product_root,
            e,
        )
        _rollback_workspace(product_root, created_dirs, product_root_was_created)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001 — rollback is mandatory
        logger.exception("Unexpected error during init; rolling back")
        _rollback_workspace(product_root, created_dirs, product_root_was_created)
        raise HTTPException(status_code=500, detail=f"Init failed: {e}")

    # All clones succeeded — write coordination.yaml at the product root.
    try:
        write_coordination(product_root, request.repos)
    except CoordinationError as e:
        # Roll back: the YAML is the canonical mark of "initialised". If we
        # can't write it, the workspace is in an inconsistent state.
        _rollback_workspace(product_root, created_dirs, product_root_was_created)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to write coordination.yaml: {e}",
        )

    # Top-level mode field: 'polyrepo' for N>1; pass through the single repo's
    # mode for N=1 to preserve the pre-polyrepo response shape.
    top_mode = per_repo[0].mode if len(per_repo) == 1 else "polyrepo"

    return ProjectInitResponse(
        success=True,
        message=f"Project initialized ({top_mode}, {len(per_repo)} repo(s))",
        project_dir=str(product_root),
        mode=top_mode,
        repos=per_repo,
    )

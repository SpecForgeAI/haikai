"""CRUD endpoints for the per-product repo mapping.

Implements Phase 3 of the polyrepo spec:
``haikai/specs/2026-05-25-polyrepo-analysis/tasks.md``.

These endpoints mutate ``coordination.yaml`` and the on-disk workspace
together. Every mutation rewrites ``coordination.yaml`` atomically (temp
file + rename); POST clones the new repo; PUT re-clones; DELETE removes
the sub-directory.

The endpoints live under ``/projects/{company}/{project}/repos`` so they
sit next to ``POST /projects/init`` in the OpenAPI surface.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...api_auth import verify_api_key
from ...git.config import GitConfig, GitConfigError, load_git_config
from ...git.coordination import (
    COORDINATION_FILENAME,
    CoordinationError,
    coordination_path,
    read_coordination,
    write_coordination,
)
from ...git.git_manager import GitManager, GitManagerError
from ...git.models import _FOLDER_RE, _is_well_formed_url

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Request models ───────────────────────────────────────────────────────────


class AddRepoRequest(BaseModel):
    folder: str = Field(..., description="Folder alias for the new repo")
    url: str = Field(..., description="Git remote URL")


class UpdateRepoRequest(BaseModel):
    url: str = Field(..., description="New git remote URL for the existing folder")


# ── Response models ──────────────────────────────────────────────────────────


class RepoMapResponse(BaseModel):
    """Returned on every CRUD endpoint."""

    company: str
    project: str
    repos: Dict[str, str]


# ── Helpers ──────────────────────────────────────────────────────────────────


def _require_product_root(company: str, project: str) -> Path:
    """Resolve the product workspace root and require ``coordination.yaml``.

    Raises 404 if the project has never been initialised. Use this on every
    CRUD endpoint so callers get a clear signal vs a generic 400.
    """
    from .. import _safe_project_dir

    product_root = _safe_project_dir(company, project)
    if not coordination_path(product_root).exists():
        raise HTTPException(
            status_code=404,
            detail=(
                f"Project {company}/{project} has no {COORDINATION_FILENAME}. "
                f"Call POST /projects/init first."
            ),
        )
    return product_root


def _load_coordination(product_root: Path) -> Dict[str, str]:
    try:
        return read_coordination(product_root)
    except CoordinationError as e:
        # 500: the file exists (per _require_product_root) but won't parse.
        # That's a server-side corruption, not a client error.
        raise HTTPException(status_code=500, detail=str(e))


def _build_git_manager(repo_dir: Path, git_config: GitConfig) -> GitManager:
    return GitManager(
        project_dir=repo_dir,
        provider=git_config.provider,
        default_branch=git_config.default_branch,
        github_token=git_config.github_token,
        bitbucket_username=git_config.bitbucket_username,
        bitbucket_app_password=git_config.bitbucket_app_password,
    )


def _require_git_config() -> GitConfig:
    try:
        return load_git_config()
    except GitConfigError as e:
        raise HTTPException(status_code=400, detail=f"Git configuration error: {e}")


def _validate_folder(folder: str) -> None:
    if not _FOLDER_RE.match(folder):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid folder alias '{folder}': must match {_FOLDER_RE.pattern}"
            ),
        )


def _validate_url(url: str) -> None:
    if not _is_well_formed_url(url):
        raise HTTPException(status_code=400, detail=f"Invalid repo URL: {url!r}")


# ── GET /repos ───────────────────────────────────────────────────────────────


@router.get(
    "/projects/{company}/{project}/repos",
    tags=["Polyrepo CRUD"],
    summary="List the folder → URL map for a product",
    response_model=RepoMapResponse,
)
async def list_repos(
    company: str,
    project: str,
    authenticated: bool = Depends(verify_api_key),
):
    product_root = _require_product_root(company, project)
    repos = _load_coordination(product_root)
    return RepoMapResponse(company=company, project=project, repos=repos)


# ── POST /repos ──────────────────────────────────────────────────────────────


@router.post(
    "/projects/{company}/{project}/repos",
    tags=["Polyrepo CRUD"],
    summary="Add a new repo to a product",
    response_model=RepoMapResponse,
    responses={
        400: {"description": "Invalid folder/URL, or constraint violated"},
        404: {"description": "Project not initialised"},
    },
)
async def add_repo(
    company: str,
    project: str,
    body: AddRepoRequest,
    authenticated: bool = Depends(verify_api_key),
):
    product_root = _require_product_root(company, project)
    repos = _load_coordination(product_root)

    _validate_folder(body.folder)
    _validate_url(body.url)
    if body.folder in repos:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Folder alias '{body.folder}' is already mapped to "
                f"{repos[body.folder]!r}. Use PUT to change its URL."
            ),
        )
    if body.url in repos.values():
        existing = next(f for f, u in repos.items() if u == body.url)
        raise HTTPException(
            status_code=400,
            detail=(
                f"URL {body.url!r} is already claimed by folder "
                f"'{existing}'. Each repo URL must appear at most once."
            ),
        )

    git_config = _require_git_config()
    repo_dir = product_root / body.folder

    # Clone the new repo into product_root/{folder}.
    try:
        gm = _build_git_manager(repo_dir, git_config)
        gm.init_project(body.url)
    except GitManagerError as e:
        # Best-effort cleanup of the partial directory.
        shutil.rmtree(repo_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=str(e))

    # All good — update coordination.yaml.
    new_repos = dict(repos)
    new_repos[body.folder] = body.url
    try:
        write_coordination(product_root, new_repos)
    except CoordinationError as e:
        # Roll back the clone too.
        shutil.rmtree(repo_dir, ignore_errors=True)
        raise HTTPException(
            status_code=500, detail=f"Failed to write coordination.yaml: {e}"
        )
    return RepoMapResponse(company=company, project=project, repos=new_repos)


# ── PUT /repos/{folder} ──────────────────────────────────────────────────────


@router.put(
    "/projects/{company}/{project}/repos/{folder}",
    tags=["Polyrepo CRUD"],
    summary="Update the URL for an existing folder (re-clones the sub-directory)",
    response_model=RepoMapResponse,
    responses={
        400: {"description": "Invalid URL, constraint violated, or clone failed"},
        404: {"description": "Project or folder not found"},
    },
)
async def update_repo(
    company: str,
    project: str,
    folder: str,
    body: UpdateRepoRequest,
    authenticated: bool = Depends(verify_api_key),
):
    product_root = _require_product_root(company, project)
    repos = _load_coordination(product_root)

    if folder not in repos:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Folder '{folder}' not in coordination map for "
                f"{company}/{project}. PUT only updates existing folders; "
                f"use POST to add a new one."
            ),
        )

    _validate_url(body.url)

    if body.url == repos[folder]:
        # No-op update — return current state.
        return RepoMapResponse(company=company, project=project, repos=repos)

    if body.url in repos.values():
        existing = next(f for f, u in repos.items() if u == body.url)
        raise HTTPException(
            status_code=400,
            detail=(
                f"URL {body.url!r} is already claimed by folder "
                f"'{existing}'. Each repo URL must appear at most once."
            ),
        )

    git_config = _require_git_config()
    repo_dir = product_root / folder

    # Tear down the existing clone and re-clone from the new URL.
    # Keep a backup of the old contents in case clone fails so we can
    # restore — atomicity at the filesystem level.
    backup_dir: Optional[Path] = None
    if repo_dir.exists():
        backup_dir = repo_dir.with_name(repo_dir.name + ".bak")
        # If a stale backup somehow exists (prior aborted PUT), wipe it.
        if backup_dir.exists():
            shutil.rmtree(backup_dir, ignore_errors=True)
        repo_dir.rename(backup_dir)

    try:
        gm = _build_git_manager(repo_dir, git_config)
        gm.init_project(body.url)
    except GitManagerError as e:
        # Roll back: remove any partial new clone, restore the backup.
        shutil.rmtree(repo_dir, ignore_errors=True)
        if backup_dir is not None and backup_dir.exists():
            backup_dir.rename(repo_dir)
        raise HTTPException(status_code=400, detail=str(e))

    # Clone succeeded — remove the backup.
    if backup_dir is not None and backup_dir.exists():
        shutil.rmtree(backup_dir, ignore_errors=True)

    new_repos = dict(repos)
    new_repos[folder] = body.url
    try:
        write_coordination(product_root, new_repos)
    except CoordinationError as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to write coordination.yaml: {e}"
        )
    return RepoMapResponse(company=company, project=project, repos=new_repos)


# ── DELETE /repos/{folder} ───────────────────────────────────────────────────


@router.delete(
    "/projects/{company}/{project}/repos/{folder}",
    tags=["Polyrepo CRUD"],
    summary="Remove a folder from the coordination map (deletes the sub-directory)",
    response_model=RepoMapResponse,
    responses={
        400: {"description": "Cannot remove the last entry"},
        404: {"description": "Project or folder not found"},
    },
)
async def delete_repo(
    company: str,
    project: str,
    folder: str,
    authenticated: bool = Depends(verify_api_key),
):
    product_root = _require_product_root(company, project)
    repos = _load_coordination(product_root)

    if folder not in repos:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Folder '{folder}' not in coordination map for "
                f"{company}/{project}."
            ),
        )
    if len(repos) == 1:
        # Last entry — refuse. A product must always have ≥1 repo.
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot remove the last entry ({folder!r}). A project must "
                f"always have at least one repo. Delete the whole project "
                f"if that is what you want."
            ),
        )

    new_repos = {k: v for k, v in repos.items() if k != folder}
    # Update coordination.yaml first so a crash before rmtree doesn't leave
    # the YAML claiming a repo whose sub-dir we've already removed.
    try:
        write_coordination(product_root, new_repos)
    except CoordinationError as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to write coordination.yaml: {e}"
        )
    shutil.rmtree(product_root / folder, ignore_errors=True)
    return RepoMapResponse(company=company, project=project, repos=new_repos)

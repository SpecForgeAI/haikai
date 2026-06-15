"""REST endpoints for refactoring engines.

Mounted under `/api/refactor`. Read endpoints (GET) are safe; the only
write endpoint is `POST /api/refactor/rename-apply` and it requires
`confirm: true` in the body.

Spec: haikai/specs/2026-04-27-refactoring-impact/spec.md
"""
from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel

from src.api.dep_routes import _to_jsonable
from src.api.graph_utils import open_graph as _open_graph
from src.refactoring import (
    check_staleness,
    detect_changes,
    rename_apply,
    rename_preview,
)

router = APIRouter(prefix="/api/refactor", tags=["refactoring"])


# ─── GET /api/refactor/detect ────────────────────────────────────────────────


@router.get("/detect")
def get_detect(
    snapshot: str = Query(..., description="path to snapshot dir"),
    repo: str = Query(..., description="repo root path"),
    scope: str = Query("staged", pattern="^(staged|unstaged|all|commit)$"),
    commit: Optional[str] = Query(None, description="SHA when scope=commit"),
) -> dict[str, Any]:
    graph = _open_graph(snapshot)
    try:
        report = detect_changes(repo, graph, scope=scope, commit=commit)
        return _to_jsonable(asdict(report))
    finally:
        graph.close()


# ─── GET /api/refactor/rename-preview ────────────────────────────────────────


@router.get("/rename-preview")
def get_rename_preview(
    snapshot: str = Query(...),
    repo: str = Query(...),
    old_name: str = Query(..., description="qualified name (preferred) or bare"),
    new_name: str = Query(..., description="bare new identifier"),
    all_languages: bool = Query(False),
    include_text_only: bool = Query(False),
) -> dict[str, Any]:
    graph = _open_graph(snapshot)
    try:
        plan = rename_preview(
            repo, graph, old_name, new_name,
            all_languages=all_languages, include_text_only=include_text_only,
        )
        return _to_jsonable(asdict(plan))
    finally:
        graph.close()


# ─── POST /api/refactor/rename-apply ─────────────────────────────────────────


class RenameApplyBody(BaseModel):
    snapshot: str
    repo: str
    old_name: str
    new_name: str
    confirm: bool = False
    force_dirty: bool = False
    all_languages: bool = False
    include_text_only: bool = False


@router.post("/rename-apply")
def post_rename_apply(body: RenameApplyBody) -> dict[str, Any]:
    if body.confirm is not True:
        raise HTTPException(400, "rename-apply requires `confirm: true` in the body")
    graph = _open_graph(body.snapshot)
    try:
        plan = rename_preview(
            body.repo, graph, body.old_name, body.new_name,
            all_languages=body.all_languages,
            include_text_only=body.include_text_only,
        )
        applied = rename_apply(
            body.repo, graph, plan,
            force_dirty=body.force_dirty,
            triggered_by="rest",
            snapshot_path=body.snapshot,
        )
        return _to_jsonable(asdict(applied))
    finally:
        graph.close()


# ─── GET /api/refactor/staleness ─────────────────────────────────────────────


@router.get("/staleness")
def get_staleness(
    snapshot: str = Query(...),
    repo: str = Query(...),
) -> dict[str, Any]:
    snap = Path(snapshot)
    # Same validation rules as _open_graph — see dep_routes for rationale.
    if ".." in snap.parts:
        raise HTTPException(400, "snapshot path may not contain '..'")
    try:
        if not snap.exists():
            raise HTTPException(404, "snapshot not found")
    except PermissionError:
        raise HTTPException(404, "snapshot not found")
    report = check_staleness(snap, repo)
    return _to_jsonable(asdict(report))

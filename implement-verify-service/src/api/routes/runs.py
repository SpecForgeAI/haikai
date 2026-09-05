"""Run Flow Graph API (spec 2026-07-02-run-flow-graph, D8).

GET /api/v2/runs                                  — run picker (graph runs)
GET /api/v2/runs/{orchestrate_id}/graph           — latest snapshot
GET /api/v2/runs/{orchestrate_id}/graph?at_seq=N  — historical snapshot (D7 replay)
GET /api/v2/runs/{orchestrate_id}/graph?stream=true&from_seq=N — SSE of graph
    events (the D6 bounded-poll pattern; one frame per event, `id:` = seq).

The snapshot is a PURE FOLD of graph events (I8) served by
`flow_graph.snapshot`; this module is transport only — it decides nothing
and never touches graph state. Bearer-auth like the rest of the v2 surface.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse

from src.api_auth import verify_api_key
from src.verification import flow_graph

logger = logging.getLogger(__name__)

router = APIRouter(tags=["run-flow-graph"])


@router.get("/api/v2/runs")
async def list_runs(authenticated: bool = Depends(verify_api_key)):
    conn = flow_graph.connect()
    try:
        return JSONResponse({"runs": flow_graph.list_runs(conn)})
    finally:
        conn.close()


@router.post("/api/v2/runs/salvage-worktree")
async def salvage_worktree(payload: dict,
                           authenticated: bool = Depends(verify_api_key)):
    """Salvage a dead run item's local worktree (2026-08-15): commit + push
    the spec's existing worktree as its branch so a Resume proceeds to the
    NEXT spec instead of re-doing finished work. Body:
    {company, project, spec_name}. Folder-aware since 2026-09-05: single-repo
    roots, folder targets and unambiguous polyrepos all salvage; only a
    polyrepo whose several targets each hold a worktree for the spec is
    refused (the run item records ONE branch). Historic note (the polyrepo
    artifact layout has per-target trees — refused loudly, never guessed).
    """
    from src.api import _safe_project_dir
    from src.git import worktree_runs as wr

    company = (payload or {}).get("company") or ""
    project = (payload or {}).get("project") or ""
    spec_name = (payload or {}).get("spec_name") or ""
    if not company.strip() or not project.strip() or not spec_name.strip():
        return JSONResponse(
            {"status": "error", "message": "company, project and spec_name are required"},
            status_code=400)
    try:
        project_dir = _safe_project_dir(company, project)
    except Exception as exc:  # traversal-safe resolver rejects bad segments
        return JSONResponse({"status": "error", "message": str(exc)},
                            status_code=400)
    # Folder-aware (2026-09-05): resolve the repo target(s) exactly as the
    # deploy / commit / MR paths do (`.git` at the root, a coordination file,
    # or a repo subfolder) instead of demanding `.git` at the project root —
    # which no folder-target project can satisfy, so salvage was dead for the
    # layout the tool itself produces. An ambiguous polyrepo (several targets
    # each holding a worktree for the spec) is still refused loudly, BEFORE
    # anything is touched.
    from src.job_queue.tasks import _resolve_repo_targets
    result = wr.salvage_spec_worktree_in_project(
        project_dir, spec_name.strip(), _resolve_repo_targets)
    status_code = 200 if result.get("status") == "salvaged" else 409
    logger.info("salvage-worktree %s/%s spec=%s -> %s", company, project,
                spec_name, result.get("status"))
    return JSONResponse(result, status_code=status_code)


@router.get("/api/v2/runs/{orchestrate_id}/graph")
async def run_graph(orchestrate_id: str, at_seq: int | None = None,
                    from_seq: int = 0, stream: bool = False,
                    authenticated: bool = Depends(verify_api_key)):
    if not stream:
        conn = flow_graph.connect()
        try:
            snap = flow_graph.snapshot(conn, orchestrate_id, at_seq=at_seq)
        finally:
            conn.close()
        return JSONResponse(snap)

    async def _sse():
        import asyncio

        last = from_seq
        for _ in range(3600):  # bounded long-poll loop (D6 pattern)
            conn = flow_graph.connect()
            try:
                events = flow_graph.events_since(conn, orchestrate_id, last)
            finally:
                conn.close()
            for ev in events:
                last = ev["seq"]
                yield (f"id: {ev['seq']}\nevent: {ev['kind']}\n"
                       f"data: {json.dumps(ev)}\n\n")
            await asyncio.sleep(1)

    return StreamingResponse(_sse(), media_type="text/event-stream")

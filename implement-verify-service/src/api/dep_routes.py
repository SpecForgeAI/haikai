"""REST endpoints for the dependency-graph engines.

Mounted under `/api/dep`. All read endpoints take `?snapshot=<path>` and
operate read-only on the per-snapshot SQLite DB. `rebuild` is the only
write endpoint.

Spec: haikai/specs/2026-04-25-deep-dependency-analysis/spec.md
"""
from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from src.api.graph_utils import open_graph as _open_graph
from src.dep import (
    DepGraph,
    impact_of,
    trace_from,
    context_of,
    processes_in,
)
from src.dep.flow import to_mermaid

router = APIRouter(prefix="/api/dep", tags=["dependency-graph"])


# ─── GET /api/dep/impact ───────────────────────────────────────────────────

@router.get("/impact")
def get_impact(
    snapshot: str = Query(..., description="path to snapshot dir"),
    symbol: str = Query(..., description="qualified_name or bare name"),
    depth: int = Query(5, ge=1, le=20),
    include_endpoints: bool = Query(True),
) -> dict[str, Any]:
    graph = _open_graph(snapshot)
    try:
        report = impact_of(graph, symbol, depth=depth,
                           include_endpoints=include_endpoints)
        return _to_jsonable(asdict(report))
    finally:
        graph.close()


# ─── GET /api/dep/trace ────────────────────────────────────────────────────

@router.get("/trace")
def get_trace(
    snapshot: str = Query(...),
    seed: str = Query(..., description="symbol qname OR 'VERB /path'"),
    format: str = Query("json", pattern="^(json|mermaid)$"),
    max_depth: int = Query(10, ge=1, le=30),
) -> dict[str, Any]:
    graph = _open_graph(snapshot)
    try:
        fg = trace_from(graph, seed, max_depth=max_depth)
        if format == "mermaid":
            return {"seed": fg.seed, "mermaid": to_mermaid(fg),
                    "truncated": fg.truncated, "notes": fg.notes}
        return _to_jsonable({
            "seed": fg.seed,
            "nodes": [asdict(n) for n in fg.nodes],
            "edges": [asdict(e) for e in fg.edges],
            "truncated": fg.truncated,
            "notes": fg.notes,
        })
    finally:
        graph.close()


# ─── GET /api/dep/context ──────────────────────────────────────────────────

@router.get("/context")
def get_context(
    snapshot: str = Query(...),
    symbol: str = Query(...),
) -> dict[str, Any]:
    graph = _open_graph(snapshot)
    try:
        ctx = context_of(graph, symbol)
        return _to_jsonable(asdict(ctx))
    finally:
        graph.close()


# ─── GET /api/dep/processes ────────────────────────────────────────────────

@router.get("/processes")
def get_processes(
    snapshot: str = Query(...),
    min_size: int = Query(1, ge=1),
    framework_filter: Optional[str] = Query(None),
) -> dict[str, Any]:
    graph = _open_graph(snapshot)
    try:
        procs = processes_in(graph, min_size=min_size,
                              framework_filter=framework_filter)
        return _to_jsonable({"count": len(procs),
                              "processes": [asdict(p) for p in procs]})
    finally:
        graph.close()


# ─── POST /api/dep/rebuild ─────────────────────────────────────────────────

class RebuildRequest(BaseModel):
    snapshot: str   # path to the snapshot dir; or absolute path-to-bench
    force: bool = False


@router.post("/rebuild")
def rebuild(req: RebuildRequest) -> dict[str, Any]:
    snap = Path(req.snapshot)
    # Apply the same `..` defense the 4 GET routes in this file use via
    # _open_graph. Without it, `force=true` would let DepGraph delete an
    # arbitrary `_depgraph.sqlite` file the server has write access to.
    # See autoresearch:debug 260504-1301 finding #3.
    if ".." in snap.parts:
        raise HTTPException(400, "snapshot path may not contain '..'")
    if not snap.exists():
        raise HTTPException(404, f"snapshot not found: {snap}")
    try:
        graph = DepGraph.open_or_build(snap, force_rebuild=req.force)
        counts = {}
        for tbl in ("files", "symbols", "imports", "calls",
                    "inheritance", "endpoints", "interactions"):
            counts[tbl] = graph.query_one(
                f"SELECT COUNT(*) AS c FROM {tbl}")["c"]
        graph.close()
        return {
            "snapshot": str(snap),
            "db": str(snap / "_depgraph.sqlite"),
            "row_counts": counts,
            "force": req.force,
        }
    except Exception as e:
        raise HTTPException(500, f"rebuild failed: {e}")


# ─── helpers ───────────────────────────────────────────────────────────────

def _to_jsonable(obj: Any) -> Any:
    """Recursively coerce dataclass-as-dict + Row + Path to JSON-safe types."""
    import sqlite3
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_jsonable(v) for v in obj]
    if isinstance(obj, sqlite3.Row):
        return {k: obj[k] for k in obj.keys()}
    if isinstance(obj, Path):
        return str(obj)
    if isinstance(obj, set):
        return sorted(obj)
    return obj

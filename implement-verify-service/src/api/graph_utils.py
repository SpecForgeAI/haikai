"""Shared helpers for dependency- and refactoring-graph routes.

Both `src/api/dep_routes.py` and `src/api/refactor_routes.py` open a
`DepGraph` from a caller-supplied `snapshot` path. Centralizing the
validation here is the single source of truth — any future graph
route lands one more import here instead of cloning the body again
(`helper-exists-sibling-missed` guard, per CLAUDE.md).
"""
from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException

from src.dep import DepGraph


def open_graph(snapshot: str) -> DepGraph:
    """Validate `snapshot` and return an opened `DepGraph`.

    Validation rules (in order):
      1. Reject `..` components in the snapshot path. We do not pin
         snapshots under a workspace root — by design the engines
         operate on user-specified repo snapshots anywhere on disk
         (per the deep-dependency-analysis spec).
      2. The path must exist; PermissionError is treated as 404 so we
         don't leak whether the path resolves.
      3. The directory must contain either `_index.txt` or
         `_depgraph.sqlite` (the snapshot markers) — guards against
         opening an arbitrary directory as a graph.

    Raises `HTTPException` with the appropriate 4xx/5xx status on any
    failure; never returns a partially-initialized graph.
    """
    snap = Path(snapshot)
    if ".." in snap.parts:
        raise HTTPException(400, "snapshot path may not contain '..'")
    try:
        if not snap.exists():
            raise HTTPException(404, "snapshot not found")
    except PermissionError:
        # Don't leak whether the path exists; treat as not-found.
        raise HTTPException(404, "snapshot not found")
    if not (snap / "_index.txt").exists() and not (snap / "_depgraph.sqlite").exists():
        raise HTTPException(400, "snapshot dir is missing _index.txt or _depgraph.sqlite")
    try:
        return DepGraph.open_or_build(snap)
    except PermissionError:
        raise HTTPException(403, "snapshot is not accessible")
    except Exception as e:
        raise HTTPException(500, f"could not open graph: {e}")

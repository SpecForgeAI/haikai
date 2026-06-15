"""Shared path-safety helpers.

Reject path segments (e.g. company / project / spec_id from API requests)
that contain separators, traversal, or empty values that would let
`workspace_dir / segment / ...` escape its parent.

Same intent as the prior private copies in:
  - src/api/__init__.py (_safe_project_dir wraps the same idea)
  - src/chat/session_store.py (_safe_segment)
  - src/standards_orchestrator.py (_safe_segment)

New code should import from here. Existing copies are migrated to thin
wrappers around `safe_segment` so behavior stays consistent across all
sites.
"""
from __future__ import annotations

import re
from pathlib import Path

_SAFE_SEG = re.compile(r"^[A-Za-z0-9_.-]+$")


def safe_segment(name: str, kind: str) -> str:
    """Validate a single path segment (a directory or filename component).

    Rejects:
      - non-string values
      - empty strings
      - bare `.` and `..`
      - anything containing characters outside [A-Za-z0-9_.-]

    Returns the validated `name` (lets the caller use it inline).
    Raises ValueError on unsafe input — `kind` is included in the message
    so callers can identify which field failed (e.g. "company" / "project").
    """
    if not isinstance(name, str) or not _SAFE_SEG.match(name) or name in (".", ".."):
        raise ValueError(f"unsafe {kind}: {name!r}")
    return name


def check_no_traversal(path_like, kind: str) -> None:
    """Reject `..` segments in a path-like value.

    Use for `source`/`output_dir`-style inputs that ARE intentionally
    multi-segment relative paths (e.g. "alfresco/repo/src" or
    "subdir/file.md") — `safe_segment` is too strict for these.

    Absolute paths are NOT rejected here — some callers (CLI usage with
    explicit destinations) intentionally accept them. If a caller wants
    to also reject absolute paths, it should do so explicitly.
    """
    p = Path(path_like)
    if ".." in p.parts:
        raise ValueError(f"{kind} may not contain '..': {path_like!r}")

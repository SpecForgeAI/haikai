"""Framework-neutral workspace path containment (no FastAPI/api-package deps).

The worker (job_queue.tasks) builds `workspace/company/project` from untrusted
job payloads but cannot import the API's `sanitize_path` (api -> tasks cycle).
This is the same guarantee, raising a plain ValueError so it's usable from the
worker, the API, or a CLI alike.
"""

from __future__ import annotations

import os
from pathlib import Path


class UnsafePathError(ValueError):
    """A company/project value would escape the workspace."""


def jobs_db_path() -> str:
    """The single source of truth for where the job queue lives.

    The API startup queue, every route that enqueues, and the worker that polls
    MUST resolve to the same file — otherwise an enqueued job sits invisible
    forever (predict R2). Honours an explicit `JOBS_DB_PATH`; otherwise defaults
    under `API_WORKSPACE_DIR`, matching the rest of the app's path convention.
    """
    explicit = os.environ.get("JOBS_DB_PATH")
    if explicit:
        return explicit
    workspace = Path(os.environ.get("API_WORKSPACE_DIR", "/home/ubuntu/api_workspace")).resolve()
    return str(workspace / "jobs.db")


def safe_project_dir(workspace_dir: str | Path, company: str, project: str) -> Path:
    """Resolve `<workspace>/<company>/<project>`, rejecting traversal/escape.

    Rejects: empty segments, any '..' part, absolute segments, and any result
    that resolves outside the workspace root.
    """
    if not company or not project:
        raise UnsafePathError("company and project are required")
    workspace = Path(workspace_dir).resolve()
    rel = Path(company) / project
    if any(part == ".." for part in rel.parts):
        raise UnsafePathError(f"'..' segment not allowed: {company}/{project}")
    if Path(company).is_absolute() or Path(project).is_absolute():
        raise UnsafePathError(f"absolute segment not allowed: {company}/{project}")
    resolved = (workspace / rel).resolve()
    if not resolved.is_relative_to(workspace):
        raise UnsafePathError(f"{company}/{project} resolves outside the workspace")
    return resolved

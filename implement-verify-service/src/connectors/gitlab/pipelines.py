"""Pipelines & Jobs — discover & control project CI pipelines and their jobs.

Discover: list/get pipelines (filter by ref/status), list a pipeline's jobs,
          read a job's log.
Control:  trigger a pipeline, retry a pipeline, cancel a pipeline (cancel is
          gated behind confirm=True; trigger/retry re-run work but aren't
          destructive, matching the cancel/delete/merge/stop policy).

All verbs are project-scoped — `project` is an id or `group/name` path. Optional
`gl=` injects a prebuilt client.
"""

from __future__ import annotations

from typing import Any, Optional

from src.connectors.gitlab.client import build_client, require_confirm


def _pipeline_to_dict(p: Any) -> dict:
    a = getattr(p, "attributes", p) or {}
    return {
        "id": a.get("id"),
        "status": a.get("status"),
        "ref": a.get("ref"),
        "sha": a.get("sha"),
        "source": a.get("source"),
        "web_url": a.get("web_url"),
    }


def _job_to_dict(j: Any) -> dict:
    a = getattr(j, "attributes", j) or {}
    return {
        "id": a.get("id"),
        "name": a.get("name"),
        "stage": a.get("stage"),
        "status": a.get("status"),
        "allow_failure": a.get("allow_failure"),
        "web_url": a.get("web_url"),
    }


def _project(gl: Any, project: str):
    return gl.projects.get(project)


def list_pipelines(
    project: str,
    repo_key: str = "default",
    *,
    ref: Optional[str] = None,
    status: Optional[str] = None,
    gl: Any = None,
) -> list[dict]:
    gl = gl or build_client(repo_key)
    params: dict = {"get_all": True}
    if ref:
        params["ref"] = ref
    if status:
        params["status"] = status
    return [_pipeline_to_dict(p) for p in _project(gl, project).pipelines.list(**params)]


def get_pipeline(project: str, pipeline_id: int, repo_key: str = "default", *, gl: Any = None) -> dict:
    gl = gl or build_client(repo_key)
    return _pipeline_to_dict(_project(gl, project).pipelines.get(pipeline_id))


def list_jobs(project: str, pipeline_id: int, repo_key: str = "default", *, gl: Any = None) -> list[dict]:
    gl = gl or build_client(repo_key)
    pipe = _project(gl, project).pipelines.get(pipeline_id)
    return [_job_to_dict(j) for j in pipe.jobs.list(get_all=True)]


def get_job_log(project: str, job_id: int, repo_key: str = "default", *, gl: Any = None) -> str:
    """Return a job's trace (log) as text."""
    gl = gl or build_client(repo_key)
    trace = _project(gl, project).jobs.get(job_id).trace()
    return trace.decode("utf-8", "replace") if isinstance(trace, (bytes, bytearray)) else str(trace or "")


def trigger_pipeline(
    project: str,
    ref: str,
    repo_key: str = "default",
    *,
    variables: Optional[dict] = None,
    gl: Any = None,
) -> dict:
    gl = gl or build_client(repo_key)
    payload: dict = {"ref": ref}
    if variables:
        payload["variables"] = [{"key": k, "value": v} for k, v in variables.items()]
    return _pipeline_to_dict(_project(gl, project).pipelines.create(payload))


def retry_pipeline(project: str, pipeline_id: int, repo_key: str = "default", *, gl: Any = None) -> dict:
    gl = gl or build_client(repo_key)
    pipe = _project(gl, project).pipelines.get(pipeline_id)
    pipe.retry()
    return _pipeline_to_dict(pipe)


def cancel_pipeline(
    project: str, pipeline_id: int, repo_key: str = "default", *, confirm: bool = False, gl: Any = None
) -> dict:
    """Cancel a running pipeline. Destructive → needs confirm."""
    require_confirm(f"cancel pipeline {pipeline_id} in {project}", confirm)
    gl = gl or build_client(repo_key)
    pipe = _project(gl, project).pipelines.get(pipeline_id)
    pipe.cancel()
    return _pipeline_to_dict(pipe)

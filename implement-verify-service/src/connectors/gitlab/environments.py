"""Environments & Deployments — discover & control project environments.

Discover: list/get environments, list/get deployments.
Control:  stop an environment (gated behind confirm=True). Triggering a
          deployment is not a single GitLab API call — deployments are produced
          by pipelines, so use `pipelines.trigger_pipeline` for that.

Project-scoped; `project` is an id or `group/name` path. Optional `gl=` injects
a prebuilt client.
"""

from __future__ import annotations

from typing import Any, Optional

from src.connectors.gitlab.client import build_client, require_confirm


def _env_to_dict(e: Any) -> dict:
    a = getattr(e, "attributes", e) or {}
    return {
        "id": a.get("id"),
        "name": a.get("name"),
        "state": a.get("state"),
        "external_url": a.get("external_url"),
        "tier": a.get("tier"),
    }


def _deployment_to_dict(d: Any) -> dict:
    a = getattr(d, "attributes", d) or {}
    env = a.get("environment") or {}
    return {
        "id": a.get("id"),
        "iid": a.get("iid"),
        "status": a.get("status"),
        "ref": a.get("ref"),
        "sha": a.get("sha"),
        "environment": env.get("name") if isinstance(env, dict) else env,
    }


def _project(gl: Any, project: str):
    return gl.projects.get(project)


def list_environments(
    project: str, repo_key: str = "default", *, states: Optional[str] = None, gl: Any = None
) -> list[dict]:
    gl = gl or build_client(repo_key)
    params: dict = {"get_all": True}
    if states:
        params["states"] = states
    return [_env_to_dict(e) for e in _project(gl, project).environments.list(**params)]


def get_environment(project: str, env_id: int, repo_key: str = "default", *, gl: Any = None) -> dict:
    gl = gl or build_client(repo_key)
    return _env_to_dict(_project(gl, project).environments.get(env_id))


def list_deployments(
    project: str,
    repo_key: str = "default",
    *,
    environment: Optional[str] = None,
    status: Optional[str] = None,
    gl: Any = None,
) -> list[dict]:
    gl = gl or build_client(repo_key)
    params: dict = {"get_all": True}
    if environment:
        params["environment"] = environment
    if status:
        params["status"] = status
    return [_deployment_to_dict(d) for d in _project(gl, project).deployments.list(**params)]


def get_deployment(project: str, deployment_id: int, repo_key: str = "default", *, gl: Any = None) -> dict:
    gl = gl or build_client(repo_key)
    return _deployment_to_dict(_project(gl, project).deployments.get(deployment_id))


def stop_environment(
    project: str, env_id: int, repo_key: str = "default", *, confirm: bool = False, gl: Any = None
) -> dict:
    """Stop an environment. Destructive → needs confirm."""
    require_confirm(f"stop environment {env_id} in {project}", confirm)
    gl = gl or build_client(repo_key)
    env = _project(gl, project).environments.get(env_id)
    env.stop()
    return _env_to_dict(env)

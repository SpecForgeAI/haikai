"""Runners — discover & control GitLab CI runners.

Discover: list (optionally filtered by status/tags), get one.
Control:  pause / resume / delete. Pause and delete are gated behind
`confirm=True` (pause ≈ stop; delete is irreversible). Resume re-enables and is
not gated.

Every verb accepts an optional `gl=` (a prebuilt `gitlab.Gitlab`) so callers and
real-seam tests can inject one client instead of rebuilding per call.
"""

from __future__ import annotations

from typing import Any, Optional

from src.connectors.gitlab.client import build_client, require_confirm


def _runner_to_dict(runner: Any) -> dict:
    """Normalize a python-gitlab runner object to a plain, JSON-able dict."""
    a = getattr(runner, "attributes", runner) or {}
    active = a.get("active", True)
    return {
        "id": a.get("id"),
        "description": a.get("description"),
        "active": active,
        "paused": a.get("paused", not active),
        "online": a.get("online"),
        "status": a.get("status"),
        "tag_list": a.get("tag_list", []),
        "runner_type": a.get("runner_type"),
    }


def list_runners(
    repo_key: str = "default",
    *,
    status: Optional[str] = None,
    tag_list: Optional[list[str]] = None,
    gl: Any = None,
) -> list[dict]:
    """List runners visible to the token, optionally filtered by status/tags."""
    gl = gl or build_client(repo_key)
    params: dict = {"get_all": True}
    if status:
        params["status"] = status
    if tag_list:
        params["tag_list"] = ",".join(tag_list)
    return [_runner_to_dict(r) for r in gl.runners.list(**params)]


def get_runner(runner_id: int, repo_key: str = "default", *, gl: Any = None) -> dict:
    """Fetch one runner by id."""
    gl = gl or build_client(repo_key)
    return _runner_to_dict(gl.runners.get(runner_id))


def pause_runner(
    runner_id: int, repo_key: str = "default", *, confirm: bool = False, gl: Any = None
) -> dict:
    """Pause a runner (stops it taking new jobs). Destructive → needs confirm."""
    require_confirm(f"pause runner {runner_id}", confirm)
    gl = gl or build_client(repo_key)
    runner = gl.runners.get(runner_id)
    runner.paused = True
    runner.save()
    return _runner_to_dict(runner)


def resume_runner(
    runner_id: int, repo_key: str = "default", *, gl: Any = None
) -> dict:
    """Resume a paused runner. Non-destructive → no confirm."""
    gl = gl or build_client(repo_key)
    runner = gl.runners.get(runner_id)
    runner.paused = False
    runner.save()
    return _runner_to_dict(runner)


def delete_runner(
    runner_id: int, repo_key: str = "default", *, confirm: bool = False, gl: Any = None
) -> dict:
    """Delete a runner. Irreversible → needs confirm."""
    require_confirm(f"delete runner {runner_id}", confirm)
    gl = gl or build_client(repo_key)
    gl.runners.delete(runner_id)
    return {"deleted": True, "id": runner_id}

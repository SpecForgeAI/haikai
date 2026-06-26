"""Merge Requests — discover & control project MRs.

Discover: list (filter by state), get one by iid.
Control:  create (the normal action — not gated), merge and close (gated behind
          confirm=True, per the cancel/delete/merge/stop policy).

Project-scoped; `project` is an id or `group/name` path. Optional `gl=` injects
a prebuilt client.
"""

from __future__ import annotations

from typing import Any, Optional

from src.connectors.gitlab.client import build_client, require_confirm


def _mr_to_dict(mr: Any) -> dict:
    a = getattr(mr, "attributes", mr) or {}
    return {
        "iid": a.get("iid"),
        "title": a.get("title"),
        "state": a.get("state"),
        "source_branch": a.get("source_branch"),
        "target_branch": a.get("target_branch"),
        "merge_status": a.get("merge_status"),
        "web_url": a.get("web_url"),
    }


def _project(gl: Any, project: str):
    return gl.projects.get(project)


def list_merge_requests(
    project: str, repo_key: str = "default", *, state: Optional[str] = None, gl: Any = None
) -> list[dict]:
    gl = gl or build_client(repo_key)
    params: dict = {"get_all": True}
    if state:
        params["state"] = state
    return [_mr_to_dict(m) for m in _project(gl, project).mergerequests.list(**params)]


def get_merge_request(project: str, mr_iid: int, repo_key: str = "default", *, gl: Any = None) -> dict:
    gl = gl or build_client(repo_key)
    return _mr_to_dict(_project(gl, project).mergerequests.get(mr_iid))


def create_merge_request(
    project: str,
    source_branch: str,
    target_branch: str,
    title: str,
    repo_key: str = "default",
    *,
    description: str = "",
    gl: Any = None,
) -> dict:
    gl = gl or build_client(repo_key)
    mr = _project(gl, project).mergerequests.create({
        "source_branch": source_branch,
        "target_branch": target_branch,
        "title": title,
        "description": description,
    })
    return _mr_to_dict(mr)


def merge_merge_request(
    project: str, mr_iid: int, repo_key: str = "default", *, confirm: bool = False, gl: Any = None
) -> dict:
    """Merge an MR. Destructive → needs confirm."""
    require_confirm(f"merge MR !{mr_iid} in {project}", confirm)
    gl = gl or build_client(repo_key)
    mr = _project(gl, project).mergerequests.get(mr_iid)
    mr.merge()
    return _mr_to_dict(mr)


def close_merge_request(
    project: str, mr_iid: int, repo_key: str = "default", *, confirm: bool = False, gl: Any = None
) -> dict:
    """Close an MR without merging. Destructive → needs confirm."""
    require_confirm(f"close MR !{mr_iid} in {project}", confirm)
    gl = gl or build_client(repo_key)
    mr = _project(gl, project).mergerequests.get(mr_iid)
    mr.state_event = "close"
    mr.save()
    return _mr_to_dict(mr)

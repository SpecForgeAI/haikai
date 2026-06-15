"""GitLab CI connector — ci-trigger verifier (verification spec D3/D9.1).

trigger():  POST a pipeline for a ref; returns the head SHA binding (D10.4).
poll():     GET pipelines filtered by sha → one verdict for the cell
            (poll fallback for /api/v2/inbound/gitlab/{ingress_token}).

Status mapping (GitLab pipeline status → spec verdict):
    created/waiting_for_resource/preparing/pending/running/scheduled/manual → pending
    success                                  → pass
    failed / canceled / skipped              → fail
"""

from __future__ import annotations

from urllib.parse import quote

import requests

from src.verification.connectors import resolve_token
from src.verification.connectors.loader import load_connector

CONNECTOR = "GITLAB"
FALLBACK_ENV = "GITLAB_TOKEN"
TIMEOUT_S = 30

# Status mapping + fold precedence come from
# haikai-profiles/default/connectors/gitlab-ci.yml — the single source of
# truth (predict #9 option a).
_PER_PAGE = 100
_MAX_PAGES = 10


def _def():
    return load_connector("gitlab-ci")


class GitLabCIError(Exception):
    pass


def _token(repo_key: str) -> str:
    token = resolve_token(repo_key, CONNECTOR, FALLBACK_ENV)
    if not token:
        raise GitLabCIError(f"no token: set {repo_key.upper()}_{CONNECTOR}_TOKEN or {FALLBACK_ENV}")
    return token


def _headers(token: str) -> dict:
    return {"PRIVATE-TOKEN": token}


def _project_path(project: str) -> str:
    return quote(project, safe="")


def trigger(base_url: str, project: str, ref: str, repo_key: str, variables: dict | None = None) -> dict:
    """Create a pipeline for a ref. Returns the head SHA binding payload (D10.4)."""
    token = _token(repo_key)
    url = f"{base_url.rstrip('/')}/api/v4/projects/{_project_path(project)}/pipeline"
    payload: dict = {"ref": ref}
    if variables:
        payload["variables"] = [{"key": k, "value": v} for k, v in variables.items()]
    resp = requests.post(url, headers=_headers(token), json=payload, timeout=TIMEOUT_S)
    if resp.status_code not in (200, 201):
        raise GitLabCIError(f"pipeline create failed {resp.status_code}: {resp.text[:500]}")
    body = resp.json()
    return {
        "triggered": True,
        "provider": "gitlab",
        "pipeline_id": body.get("id"),
        "ref": ref,
        "head_sha": body.get("sha", ""),
    }


def map_status(status: str) -> str:
    return _def().map_status(status)


def poll(base_url: str, project: str, head_sha: str, repo_key: str) -> dict:
    """Poll ALL pipelines for a SHA (paginated — C4). Fold precedence mirrors
    the D5 gate: fail > pending > pass > skipped."""
    token = _token(repo_key)
    url = f"{base_url.rstrip('/')}/api/v4/projects/{_project_path(project)}/pipelines"
    pipelines: list[dict] = []
    for page in range(1, _MAX_PAGES + 1):
        resp = requests.get(
            url,
            headers=_headers(token),
            params={"sha": head_sha, "per_page": _PER_PAGE, "page": page},
            timeout=TIMEOUT_S,
        )
        if not resp.ok:
            raise GitLabCIError(f"poll failed {resp.status_code}: {resp.text[:500]}")
        batch = resp.json()
        pipelines.extend(batch)
        if len(batch) < _PER_PAGE:
            break
    if not pipelines:
        return {"verdict": "pending", "pipelines": [], "reason": "no pipelines for sha yet"}
    summaries = [
        {
            "id": p.get("id"),
            "status": p.get("status"),
            "verdict": map_status(p.get("status", "")),
            "web_url": p.get("web_url"),
        }
        for p in pipelines
    ]
    verdicts = {s["verdict"] for s in summaries}
    folded = _def().fold(verdicts)
    return {"verdict": folded, "pipelines": summaries}

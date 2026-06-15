"""GitHub Actions connector — ci-trigger verifier (verification spec D3/D9.1).

trigger():  POST workflow_dispatch for a ref; record the head SHA → cell
            binding at trigger time (D10.4 — the authenticated correlate).
poll():     GET runs filtered by head_sha → one verdict for the cell.
            This is the poll fallback the inbound-gateway contract names;
            the webhook path lands at /api/v2/inbound/github/{ingress_token}.

Status mapping (GitHub run status/conclusion → spec verdict):
    queued / in_progress / waiting / pending → pending
    completed + success                      → pass
    completed + failure/cancelled/timed_out/startup_failure → fail
"""

from __future__ import annotations

import requests

from src.verification.connectors import resolve_token
from src.verification.connectors.loader import load_connector

API = "https://api.github.com"
CONNECTOR = "GITHUB"
FALLBACK_ENV = "GITHUB_TOKEN"
TIMEOUT_S = 30

# Status mapping + fold precedence come from the connector definition —
# haikai-profiles/default/connectors/github-actions.yml is the single
# source of truth (predict #9 option a; the tables drifted when duplicated).
_PER_PAGE = 100
_MAX_PAGES = 10


def _def():
    return load_connector("github-actions")


class GitHubActionsError(Exception):
    pass


def _headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _token(repo_key: str) -> str:
    token = resolve_token(repo_key, CONNECTOR, FALLBACK_ENV)
    if not token:
        raise GitHubActionsError(
            f"no token: set {repo_key.upper()}_{CONNECTOR}_TOKEN or {FALLBACK_ENV}"
        )
    return token


def trigger(owner: str, repo: str, workflow: str, ref: str, repo_key: str, inputs: dict | None = None) -> dict:
    """Dispatch a workflow run. Returns the head SHA binding payload (D10.4)."""
    token = _token(repo_key)
    url = f"{API}/repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches"
    resp = requests.post(
        url, headers=_headers(token), json={"ref": ref, "inputs": inputs or {}}, timeout=TIMEOUT_S
    )
    if resp.status_code != 204:
        raise GitHubActionsError(f"dispatch failed {resp.status_code}: {resp.text[:500]}")
    sha_resp = requests.get(
        f"{API}/repos/{owner}/{repo}/commits/{ref}", headers=_headers(token), timeout=TIMEOUT_S
    )
    head_sha = sha_resp.json().get("sha", "") if sha_resp.ok else ""
    return {"triggered": True, "provider": "github", "workflow": workflow, "ref": ref, "head_sha": head_sha}


def map_status(status: str, conclusion: str | None) -> str:
    return _def().map_status(status, conclusion)


def poll(owner: str, repo: str, head_sha: str, repo_key: str) -> dict:
    """Poll ALL runs for a head SHA (paginated — C4: an unseen failing run
    beyond page 1 must not fold to pass). Fold precedence mirrors the D5
    gate: fail > pending > pass > skipped."""
    token = _token(repo_key)
    url = f"{API}/repos/{owner}/{repo}/actions/runs"
    runs: list[dict] = []
    for page in range(1, _MAX_PAGES + 1):
        resp = requests.get(
            url,
            headers=_headers(token),
            params={"head_sha": head_sha, "per_page": _PER_PAGE, "page": page},
            timeout=TIMEOUT_S,
        )
        if not resp.ok:
            raise GitHubActionsError(f"poll failed {resp.status_code}: {resp.text[:500]}")
        batch = resp.json().get("workflow_runs", [])
        runs.extend(batch)
        if len(batch) < _PER_PAGE:
            break
    if not runs:
        return {"verdict": "pending", "runs": [], "reason": "no runs for head_sha yet"}
    summaries = [
        {
            "id": run.get("id"),
            "name": run.get("name"),
            "status": run.get("status"),
            "conclusion": run.get("conclusion"),
            "verdict": map_status(run.get("status", ""), run.get("conclusion")),
            "html_url": run.get("html_url"),
        }
        for run in runs
    ]
    verdicts = {s["verdict"] for s in summaries}
    folded = _def().fold(verdicts)
    return {"verdict": folded, "runs": summaries}

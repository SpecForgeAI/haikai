"""Bridge — fire a GitLab pipeline AND register the D10.4 SHA→cell binding, so the
inbound-gateway can correlate the verdict when the (long-running) pipeline
finishes, instead of the caller blocking or polling inline.

This is the OPT-IN glue between the general control-plane connector
(`src/connectors/gitlab/pipelines.py`) and the verification subsystem
(`src/verification/{store,inbound}`). The plain connector stays decoupled —
only this module imports both.

Flow (D10.4 → D9.1 → D10.2):
  1. resolve the head SHA for `ref`
  2. `store.record_binding(sha → (orchestrate_id, task_group_id, repo))`
  3. trigger the pipeline — fire-and-forget; we do NOT wait for it
  → later, GitLab webhooks `POST /api/v2/inbound/gitlab/{ingress_token}`; the
    gateway looks up THIS binding by SHA (inbound.py:157), records the verdict
    (atomically), and enqueues a fresh verify-task-group run (never a resumed
    session).

The binding is recorded BEFORE the trigger and a trigger failure is surfaced,
not raised — the durable binding must not be lost just because the CI POST was
rejected (e.g. gitlab.com's account CI gate). Mirrors the gateway's own
best-effort re-invoke semantics.
"""

from __future__ import annotations

from typing import Any, Optional

from src.connectors.gitlab import pipelines
from src.connectors.gitlab.client import build_client
from src.verification import store

PROVIDER = "gitlab"


def resolve_head_sha(project: str, ref: str, repo_key: str = "default", *, gl: Any = None) -> str:
    """The commit SHA `ref` points at (branch/tag/sha all resolve)."""
    gl = gl or build_client(repo_key)
    return gl.projects.get(project).commits.get(ref).id


def trigger_and_bind(
    project: str,
    ref: str,
    *,
    orchestrate_id: str,
    task_group_id: str,
    repo: str,
    repo_key: str = "default",
    verifier: str = "ci-trigger",
    variables: Optional[dict] = None,
    gl: Any = None,
    conn: Any = None,
    fire: bool = True,
) -> dict:
    """Bind the head SHA to a verification cell, then (optionally) fire the pipeline.

    Returns ``{head_sha, bound, pipeline, trigger_error, cell}``. ``bound`` is
    False if a binding for this (sha, provider) already existed. ``fire=False``
    records the binding without triggering — useful when CI is fired elsewhere
    or to register a binding for a known SHA.
    """
    gl = gl or build_client(repo_key)
    head_sha = resolve_head_sha(project, ref, repo_key, gl=gl)

    own_conn = conn is None
    conn = conn or store.connect()
    try:
        bound = store.record_binding(
            conn, head_sha, PROVIDER, orchestrate_id, task_group_id, repo, verifier
        )
    finally:
        if own_conn:
            conn.close()

    pipeline = None
    trigger_error = None
    if fire:
        try:
            pipeline = pipelines.trigger_pipeline(project, ref, repo_key, variables=variables, gl=gl)
        except Exception as e:  # binding already durable — surface, don't lose it
            trigger_error = f"{type(e).__name__}: {e}"

    return {
        "head_sha": head_sha,
        "bound": bound,
        "pipeline": pipeline,
        "trigger_error": trigger_error,
        "cell": [repo, verifier],
    }

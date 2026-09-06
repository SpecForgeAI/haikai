"""Deploy-only replay of an already-built orchestration (2026-09-06).

The case this serves: a long multi-spec run finished cleanly, its tests
passed, its commits landed on one branch and its merge request is open --
then ``deploy_on_complete`` failed for an ENVIRONMENTAL reason (an unreachable
box, a stale variable pointing the served process at the wrong database).
Nothing about the code was wrong. The only recovery the tool offered was
"resume from failure", which resets the run-items to PENDING and re-runs the
specs: hours of correct work rebuilt to reach the deploy step again.

This module re-runs JUST the consolidate + deploy + build-results tail of
that job:

- NOTHING is regenerated: no spec is written, no task list is created, no
  implementer runs, no commit is made. The branches the original run pushed
  are consolidated and handed to haibox exactly as ``_deploy_completed_run``
  would have done, and the build-results callback is re-emitted **under the
  ORIGINAL job id** so the caller's run-items still correlate.
- FAILS CLOSED. The stored job result must prove committed work exists
  (``spec_git`` carrying a ``commit_sha``); the source job must have asked
  for a deploy and still hold its serve spec; it must not still be in
  flight. Every refusal is a :class:`RedeployRefused` whose ``reason`` names
  the failed condition -- checked SYNCHRONOUSLY by the route before any job
  is enqueued, and again here at run time, so an impermissible request never
  becomes a silent background failure.
- A deploy that fails AGAIN is reported the same way the original would have
  been: an ``error`` build-results callback under the original job id, so the
  caller's run re-halts with the reason instead of wedging on a callback
  that never comes.

Job type: :attr:`JobType.DEPLOY_RUN`. Request payload:
``{"source_job_id": <original job id>, "orchestration": <original request>}``.
"""

from __future__ import annotations

import logging
import os
import types
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..haikai_models import OrchestrationRequest
from . import tasks as _tasks
from .job_models import Job, JobStatus, JobType

logger = logging.getLogger(__name__)

_TERMINAL = {JobStatus.COMPLETED.value, JobStatus.FAILED.value, JobStatus.CANCELLED.value}


class RedeployRefused(Exception):
    """A deploy-only replay is not admissible; ``reason`` names why."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _enum_value(value: Any) -> str:
    return getattr(value, "value", value)


def resolve_replay(source_job: Any, job_id: str) -> Tuple[OrchestrationRequest, Dict[str, Any]]:
    """Admissibility check + the facts the replay needs.

    Returns ``(request, facts)`` where ``request`` is the ORIGINAL
    :class:`OrchestrationRequest` and ``facts`` carries ``branch``,
    ``branches``, ``commit_shas``, ``pr_url`` and ``spec_names`` recovered
    from the stored job result. Raises :class:`RedeployRefused` on every
    condition that would make the replay a guess.
    """
    if source_job is None:
        raise RedeployRefused(f"job {job_id} not found")
    if _enum_value(getattr(source_job, "type", None)) != JobType.ORCHESTRATION.value:
        raise RedeployRefused(
            f"job {job_id} is a {_enum_value(getattr(source_job, 'type', None))!s} job, "
            "not an orchestration -- only an orchestration's deploy can be replayed")
    status = _enum_value(getattr(source_job, "status", None))
    if status not in _TERMINAL:
        raise RedeployRefused(
            f"job {job_id} is still in flight (status {status}); a replay would race the "
            "original deploy -- wait for it to finish")
    try:
        request = OrchestrationRequest(**(getattr(source_job, "request_payload", None) or {}))
    except Exception as exc:  # malformed / foreign payload
        raise RedeployRefused(f"job {job_id} has no usable orchestration request: {exc}")
    if not request.deploy_on_complete:
        raise RedeployRefused(
            f"job {job_id} never asked for a deploy (deploy_on_complete is off); there is no "
            "deploy tail to replay")
    if not request.target:
        raise RedeployRefused(
            f"job {job_id} carries no target serve spec; the replay cannot know what to serve")
    result = getattr(source_job, "result", None) or {}
    spec_git: List[Dict[str, Any]] = [
        r for r in (result.get("spec_git") or []) if isinstance(r, dict)
    ]
    commit_shas = [str(r["commit_sha"]) for r in spec_git if r.get("commit_sha")]
    if not commit_shas:
        raise RedeployRefused(
            f"job {job_id} recorded no committed work (no spec_git record carries a "
            "commit_sha); a deploy-only replay would serve an empty branch -- use resume "
            "from failure to re-run the specs")
    branches = []
    for r in spec_git:
        b = r.get("branch")
        if isinstance(b, str) and b and b not in branches:
            branches.append(b)
    spec_names = list(result.get("spec_names") or []) or [si.spec_name for si in request.spec_intents]
    facts = {
        "branch": branches[0] if branches else None,
        "branches": branches,
        "commit_shas": commit_shas,
        "pr_url": result.get("pr_url"),
        "spec_names": spec_names,
        "spec_git": spec_git,
    }
    return request, facts


def enqueue_redeploy(source_job: Any, job_id: str, job_queue: Any) -> Job:
    """Create + enqueue the :attr:`JobType.DEPLOY_RUN` job for ``job_id``."""
    request, facts = resolve_replay(source_job, job_id)
    job = Job(
        type=JobType.DEPLOY_RUN,
        company=request.company,
        project=request.project,
        request_payload={
            "source_job_id": job_id,
            "orchestration": request.model_dump(),
            "facts": {k: v for k, v in facts.items() if k != "spec_git"},
        },
    )
    job_queue.enqueue_job(job)
    return job


def _deploy_branches(request: OrchestrationRequest, folder: Optional[str]) -> List[str]:
    """Exactly ``_deploy_completed_run``'s branch derivation."""
    if request.integrate_branches:
        return list(request.integrate_branches)
    if request.batch_name:
        return [_tasks._batch_branch(request.batch_name, folder)]
    if folder is not None:
        return [f"feature/{si.spec_name}--{folder}" for si in request.spec_intents]
    return [f"feature/{si.spec_name}" for si in request.spec_intents]


def _response_stand_in(*, success: bool, errors: List[str], pr_url: Optional[str],
                       spec_names: List[str]) -> Any:
    """The subset of OrchestrationResponse the callback emitter reads."""
    return types.SimpleNamespace(
        success=success, errors=list(errors), pr_url=pr_url, spec_names=list(spec_names),
        failure_class=None, failed_step=None,
    )


def run_redeploy(job_id: str, storage: Any) -> None:
    """Job-runner entry for :attr:`JobType.DEPLOY_RUN` (claimed RUNNING upstream)."""
    job = storage.get_job(job_id)
    if not job:
        logger.error("deploy-only replay job %s not found", job_id)
        return
    job.started_at = datetime.now(timezone.utc)
    storage.save_job(job)

    payload = job.request_payload or {}
    source_job_id = str(payload.get("source_job_id") or "")
    source = storage.get_job(source_job_id) if source_job_id else None
    request: Optional[OrchestrationRequest] = None
    facts: Dict[str, Any] = {}
    try:
        # Re-checked at run time: the source may have changed since the
        # route admitted the request (a resume could have re-run it).
        request, facts = resolve_replay(source, source_job_id)
        workspace_dir = str(Path(os.environ["API_WORKSPACE_DIR"]).resolve())
        product_root = Path(workspace_dir) / request.company / request.project
        targets = _tasks._resolve_repo_targets(product_root)
        if not targets:
            raise RuntimeError(f"no repo target at {product_root}")
        if len(targets) > 1:
            logger.warning(
                "deploy-only replay: %d repo targets resolved; deploying only the first (%s)",
                len(targets), targets[0][0])
        folder, repo_dir = targets[0]
        branches = _deploy_branches(request, folder)
        deploy = _tasks.consolidate_and_deploy(
            repo_dir, branches, request.target,
            default_branch=_tasks.git_default_branch(repo_dir),
            git_lock=lambda: _tasks._project_git_lock(
                str(workspace_dir), request.company, request.project),
        )
        response = _response_stand_in(
            success=True, errors=[], pr_url=facts.get("pr_url"),
            spec_names=facts.get("spec_names") or [])
        # Re-emitted under the ORIGINAL job id: the caller's run-items keep
        # that id as their correlation key.
        record = _tasks._emit_orchestration_callback(
            request, source_job_id, response, deploy, spec_git=facts.get("spec_git"))
        if source is not None:
            # The poll fallback (C5) must see the new deploy on the source job.
            source.result = {**(source.result or {}), **record,
                             "redeployed_by": job_id}
            storage.save_job(source)
        job = storage.get_job(job_id) or job
        job.status = JobStatus.COMPLETED
        job.completed_at = datetime.now(timezone.utc)
        job.result = {
            "source_job_id": source_job_id,
            "branches": branches,
            "deploy": {"base_url": deploy.get("base_url"), "box_id": deploy.get("box_id"),
                       "merged": deploy.get("merged")},
            "callback_outcome": record.get("outcome"),
            "callback_delivered": record.get("callback_delivered"),
        }
        storage.save_job(job)
        logger.info(
            "deploy-only replay %s for job %s completed: base_url=%s outcome=%s",
            job_id, source_job_id, deploy.get("base_url"), record.get("outcome"))
    except Exception as exc:
        logger.error("deploy-only replay %s for job %s failed: %s", job_id, source_job_id,
                     exc, exc_info=True)
        # Report the failure the way the original deploy would have: an
        # `error` callback under the original job id, so the caller's run
        # re-halts with the reason instead of wedging on a callback that
        # never comes. Only possible once the request resolved.
        if request is not None and not isinstance(exc, RedeployRefused):
            try:
                response = _response_stand_in(
                    success=False, errors=[f"deploy-only replay failed: {exc}"],
                    pr_url=facts.get("pr_url"), spec_names=facts.get("spec_names") or [])
                _tasks._emit_orchestration_callback(
                    request, source_job_id, response, None, spec_git=facts.get("spec_git"))
            except Exception as cb_exc:  # best-effort; the job record is durable
                logger.warning("deploy-only replay: error callback failed: %s", cb_exc)
        job = storage.get_job(job_id) or job
        job.status = JobStatus.FAILED
        job.completed_at = datetime.now(timezone.utc)
        job.error = str(exc)
        storage.save_job(job)

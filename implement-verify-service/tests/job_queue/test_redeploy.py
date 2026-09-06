"""Deploy-only replay (2026-09-06).

A built, committed, pushed and merge-requested run whose deploy failed
environmentally must be re-deployable WITHOUT re-running the pipeline, and
the build-results callback must be re-emitted under the ORIGINAL job id.
Every impermissible request is refused with a named reason before anything
is enqueued; a deploy that fails again reports an `error` callback.
"""

import types

import pytest

from src.haikai_models import OrchestrationRequest, SpecIntent
from src.job_queue import redeploy, tasks
from src.job_queue.job_models import JobStatus, JobType


def _request(**over):
    base = dict(
        company="acme", project="ledger",
        spec_intents=[SpecIntent(spec_name="add-widgets"), SpecIntent(spec_name="add-gadgets")],
        callback_url="https://gw/build-results",
        deploy_on_complete=True,
        target={"command": ["python", "app.py"]},
        batch_name="batch-1",
    )
    base.update(over)
    return OrchestrationRequest(**base)


def _source(status=JobStatus.COMPLETED, request=None, result=None, job_type=JobType.ORCHESTRATION):
    request = request or _request()
    if result is None:
        result = {
            "outcome": "error",
            "pr_url": "https://git/mr/69",
            "spec_names": ["add-widgets", "add-gadgets"],
            "spec_git": [
                {"spec": "batch-1", "repo": None, "branch": "feature/batch-1",
                 "commit_sha": "abc123", "pr_url": "https://git/mr/69", "error": None},
            ],
            "errors": ["deploy failed: box never became healthy"],
        }
    return types.SimpleNamespace(
        job_id="job-src", type=job_type, status=status, request_payload=request.model_dump(),
        result=result, started_at=None, completed_at=None, error=None,
    )


class _Storage:
    def __init__(self, *jobs):
        self.jobs = {j.job_id: j for j in jobs}

    def get_job(self, job_id):
        return self.jobs.get(job_id)

    def save_job(self, job):
        self.jobs[job.job_id] = job


class _Queue:
    def __init__(self):
        self.enqueued = []

    def enqueue_job(self, job):
        self.enqueued.append(job)
        return job.job_id


# ---------------------------------------------------------------- admissibility

def test_resolve_replay_happy_path_recovers_facts():
    request, facts = redeploy.resolve_replay(_source(), "job-src")
    assert request.batch_name == "batch-1"
    assert facts["branch"] == "feature/batch-1"
    assert facts["commit_shas"] == ["abc123"]
    assert facts["pr_url"] == "https://git/mr/69"
    assert facts["spec_names"] == ["add-widgets", "add-gadgets"]


@pytest.mark.parametrize("status", [JobStatus.QUEUED, JobStatus.RUNNING])
def test_refuses_a_job_still_in_flight(status):
    with pytest.raises(redeploy.RedeployRefused) as e:
        redeploy.resolve_replay(_source(status=status), "job-src")
    assert "still in flight" in e.value.reason


def test_refuses_when_no_deploy_was_requested():
    with pytest.raises(redeploy.RedeployRefused) as e:
        redeploy.resolve_replay(_source(request=_request(deploy_on_complete=False)), "job-src")
    assert "never asked for a deploy" in e.value.reason


def test_refuses_when_no_serve_spec():
    with pytest.raises(redeploy.RedeployRefused) as e:
        redeploy.resolve_replay(_source(request=_request(target=None)), "job-src")
    assert "no target serve spec" in e.value.reason


def test_refuses_when_nothing_was_committed():
    src = _source(result={"spec_git": [{"branch": "feature/batch-1", "commit_sha": None}]})
    with pytest.raises(redeploy.RedeployRefused) as e:
        redeploy.resolve_replay(src, "job-src")
    assert "no committed work" in e.value.reason


def test_refuses_a_non_orchestration_job():
    with pytest.raises(redeploy.RedeployRefused) as e:
        redeploy.resolve_replay(_source(job_type=JobType.ASSEMBLE_RUN), "job-src")
    assert "not an orchestration" in e.value.reason


def test_refuses_unknown_job():
    with pytest.raises(redeploy.RedeployRefused) as e:
        redeploy.resolve_replay(None, "job-x")
    assert "not found" in e.value.reason


def test_enqueue_creates_a_deploy_run_job_bound_to_the_source():
    q = _Queue()
    job = redeploy.enqueue_redeploy(_source(), "job-src", q)
    assert q.enqueued == [job]
    assert job.type == JobType.DEPLOY_RUN.value
    assert job.company == "acme" and job.project == "ledger"
    assert job.request_payload["source_job_id"] == "job-src"
    assert job.request_payload["orchestration"]["batch_name"] == "batch-1"
    assert job.request_payload["facts"]["branch"] == "feature/batch-1"


# ------------------------------------------------------------------- execution

def _wire(monkeypatch, tmp_path, *, deploy_result=None, deploy_raises=None):
    monkeypatch.setenv("API_WORKSPACE_DIR", str(tmp_path))
    calls = {"deploy": [], "sent": []}
    monkeypatch.setattr(tasks, "_resolve_repo_targets", lambda root: [(None, tmp_path / "repo")])
    monkeypatch.setattr(tasks, "git_default_branch", lambda repo: "main")
    monkeypatch.setattr(tasks, "_project_git_lock", lambda *a, **k: __import__("contextlib").nullcontext())

    def _consolidate(repo_dir, branches, serve_spec, **kw):
        calls["deploy"].append((repo_dir, list(branches), serve_spec, kw.get("default_branch")))
        if deploy_raises:
            raise deploy_raises
        return deploy_result or {"base_url": "http://127.0.0.1:9911", "box_id": "box-1",
                                 "merged": list(branches), "worktree": "/tmp/wt"}

    monkeypatch.setattr(tasks, "consolidate_and_deploy", _consolidate)
    monkeypatch.setattr(tasks, "_post_callback", lambda url, payload: calls["sent"].append((url, payload)) or True)
    return calls


def _replay_job(source_job_id="job-src"):
    return types.SimpleNamespace(
        job_id="job-replay", type=JobType.DEPLOY_RUN, status=JobStatus.RUNNING,
        request_payload={"source_job_id": source_job_id, "orchestration": _request().model_dump()},
        result=None, error=None, started_at=None, completed_at=None,
    )


def test_run_redeploy_consolidates_the_batch_branch_and_reemits_deployed_under_the_original_job_id(monkeypatch, tmp_path):
    calls = _wire(monkeypatch, tmp_path)
    storage = _Storage(_source(), _replay_job())

    redeploy.run_redeploy("job-replay", storage)

    # The batch branch the original run pushed is what gets consolidated.
    assert calls["deploy"] == [(tmp_path / "repo", ["feature/batch-1"], {"command": ["python", "app.py"]}, "main")]
    # ONE callback, to the original callback_url, under the ORIGINAL job id.
    assert len(calls["sent"]) == 1
    url, payload = calls["sent"][0]
    assert url == "https://gw/build-results"
    assert payload["job_id"] == "job-src"
    assert payload["outcome"] == "deployed"
    assert payload["target_base_url"] == "http://127.0.0.1:9911"
    assert payload["pr_url"] == "https://git/mr/69"
    assert payload["spec_git"][0]["commit_sha"] == "abc123"
    # Nothing regenerated: no spec/tasks/implement, only the deploy tail.
    replay = storage.get_job("job-replay")
    assert replay.status == JobStatus.COMPLETED
    assert replay.result["deploy"]["base_url"] == "http://127.0.0.1:9911"
    assert replay.result["callback_outcome"] == "deployed"
    # The source job's stored result now carries the new deploy (poll fallback).
    src = storage.get_job("job-src")
    assert src.result["target_base_url"] == "http://127.0.0.1:9911"
    assert src.result["outcome"] == "deployed"
    assert src.result["redeployed_by"] == "job-replay"


def test_run_redeploy_uses_folder_suffixed_spec_branches_for_a_folder_target(monkeypatch, tmp_path):
    calls = _wire(monkeypatch, tmp_path)
    monkeypatch.setattr(tasks, "_resolve_repo_targets", lambda root: [("svc", tmp_path / "svc")])
    src = _source(request=_request(batch_name=None))
    src.request_payload = _request(batch_name=None).model_dump()
    storage = _Storage(src, _replay_job())

    redeploy.run_redeploy("job-replay", storage)

    assert calls["deploy"][0][1] == ["feature/add-widgets--svc", "feature/add-gadgets--svc"]
    assert storage.get_job("job-replay").status == JobStatus.COMPLETED


def test_run_redeploy_failure_reports_an_error_callback_under_the_original_job_id(monkeypatch, tmp_path):
    calls = _wire(monkeypatch, tmp_path, deploy_raises=RuntimeError("box never became healthy"))
    storage = _Storage(_source(), _replay_job())

    redeploy.run_redeploy("job-replay", storage)

    replay = storage.get_job("job-replay")
    assert replay.status == JobStatus.FAILED
    assert "box never became healthy" in replay.error
    assert len(calls["sent"]) == 1
    _, payload = calls["sent"][0]
    assert payload["job_id"] == "job-src"
    assert payload["outcome"] == "error"
    assert any("deploy-only replay failed" in e for e in payload["errors"])
    # The pointers to the delivered work still ride the error callback.
    assert payload["pr_url"] == "https://git/mr/69"


def test_run_redeploy_refusal_at_run_time_fails_the_job_without_a_callback(monkeypatch, tmp_path):
    calls = _wire(monkeypatch, tmp_path)
    # The source went back in flight since the route admitted the request.
    storage = _Storage(_source(status=JobStatus.RUNNING), _replay_job())

    redeploy.run_redeploy("job-replay", storage)

    assert storage.get_job("job-replay").status == JobStatus.FAILED
    assert "still in flight" in storage.get_job("job-replay").error
    assert calls["sent"] == []
    assert calls["deploy"] == []

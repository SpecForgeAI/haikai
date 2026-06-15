"""run_haibox_verify — the verify worker's haibox wiring records a guarded
verdict from a sandboxed run/serve (no live haiboxd; HaiboxClient is faked)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.job_queue.job_models import Job, JobStatus, JobType
from src.job_queue.job_storage import JobStorage
from src.job_queue.tasks import run_haibox_verify
from src.verification import store as vstore


class FakeClient:
    """Stand-in for HaiboxClient: returns a scripted run/serve outcome.
    `released` is class-level so a test can assert whether the box was released."""
    run_state = "succeeded"
    run_exit = 0
    released: list = []

    def __init__(self, *a, **k):
        pass

    def run_and_wait(self, command, **spec):
        return {"run_id": "run-fake", "exit_code": self.run_exit, "state": self.run_state}

    def serve(self, command, **spec):
        return {"box_id": "box-fake", "base_url": "http://127.0.0.1:5", "state": "ready"}

    def release(self, box_id):
        FakeClient.released.append(box_id)


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setattr("src.haibox.client.HaiboxClient", FakeClient)
    FakeClient.run_state, FakeClient.run_exit, FakeClient.released = "succeeded", 0, []
    storage = JobStorage(str(tmp_path / "jobs.db"))
    return storage


def _job(storage, payload) -> str:
    job = Job(job_id="hv-" + payload.get("repo", "x"), type=JobType.HAIBOX_VERIFY,
              status=JobStatus.QUEUED, company="acme", project="svc",
              created_at=datetime.now(timezone.utc), request_payload=payload)
    storage.save_job(job)
    return job.job_id


def _verdict(orch, group, repo, verifier="inline"):
    conn = vstore.connect()
    try:
        return vstore.latest_verdicts(conn, orch, group).get((repo, verifier))
    finally:
        conn.close()


def test_passing_suite_records_pass(env):
    FakeClient.run_state, FakeClient.run_exit = "succeeded", 0
    jid = _job(env, {"orchestrate_id": "o1", "task_group_id": "g1", "repo": "svc",
                     "run": {"command": ["pytest"], "source_dir": "/x"}})
    run_haibox_verify(jid, env)
    v = _verdict("o1", "g1", "svc")
    assert v and v["verdict"] == "pass"
    job = env.get_job(jid)
    assert job.status == JobStatus.COMPLETED.value
    assert job.result["exit_code"] == 0 and job.result["cell"] == ["svc", "inline"]


def test_failing_suite_records_fail(env):
    FakeClient.run_state, FakeClient.run_exit = "failed", 3
    jid = _job(env, {"orchestrate_id": "o2", "task_group_id": "g1", "repo": "svc",
                     "run": {"command": ["pytest"]}})
    run_haibox_verify(jid, env)
    assert _verdict("o2", "g1", "svc")["verdict"] == "fail"


def test_timeout_maps_to_timeout_verdict(env):
    FakeClient.run_state, FakeClient.run_exit = "timeout", None
    jid = _job(env, {"orchestrate_id": "o3", "task_group_id": "g1", "repo": "svc",
                     "run": {"command": ["sleep", "999"]}})
    run_haibox_verify(jid, env)
    assert _verdict("o3", "g1", "svc")["verdict"] == "timeout"


def test_serve_only_is_pending_and_keeps_box_for_haikai_replay(env):
    # Decision: replay belongs to Haikai. So serve-only does NOT pass on liveness
    # (cell -> pending), and the target is LEFT UP for Haikai to replay against.
    jid = _job(env, {"orchestrate_id": "o4", "task_group_id": "g1", "repo": "svc",
                     "verifier": "reconciliation",
                     "target": {"command": ["python", "app.py"], "health_path": "/"}})
    run_haibox_verify(jid, env)
    v = _verdict("o4", "g1", "svc", verifier="reconciliation")
    assert v["verdict"] == "pending"                 # awaiting Haikai reconciliation
    job = env.get_job(jid)
    assert job.result["base_url"] == "http://127.0.0.1:5"
    assert FakeClient.released == [], "serve-only must NOT release the box (Haikai replays against it)"


def test_run_with_target_gates_on_run_and_releases_supporting_box(env):
    # A `run` alongside a `target`: the box is throwaway infra for the suite, so
    # it IS released, and the verdict comes from the run.
    FakeClient.run_state, FakeClient.run_exit = "succeeded", 0
    jid = _job(env, {"orchestrate_id": "o6", "task_group_id": "g1", "repo": "svc",
                     "target": {"command": ["python", "app.py"]},
                     "run": {"command": ["pytest"]}})
    run_haibox_verify(jid, env)
    assert _verdict("o6", "g1", "svc")["verdict"] == "pass"
    assert FakeClient.released == ["box-fake"]


def test_replay_pass_records_pass_and_releases_box(env, monkeypatch):
    # target + replay: WE reconcile. No breaks -> pass; box released after.
    monkeypatch.setattr("src.verification.reconcile.replay_and_diff", lambda *a, **k: [])
    jid = _job(env, {"orchestrate_id": "o7", "task_group_id": "g1", "repo": "svc",
                     "verifier": "reconciliation",
                     "target": {"command": ["python", "app.py"]},
                     "replay": {"operations": [{"request": {"path": "/"}}]}})
    run_haibox_verify(jid, env)
    assert _verdict("o7", "g1", "svc", verifier="reconciliation")["verdict"] == "pass"
    assert FakeClient.released == ["box-fake"]


def test_replay_fail_records_breaks_and_findings(env, monkeypatch):
    brk = {"operation": "GET /views/1", "diff": ["$.name: expected 'View 2' got None"]}
    monkeypatch.setattr("src.verification.reconcile.replay_and_diff", lambda *a, **k: [brk])
    jid = _job(env, {"orchestrate_id": "o8", "task_group_id": "g1", "repo": "svc",
                     "verifier": "reconciliation",
                     "target": {"command": ["python", "app.py"]},
                     "replay": {"operations": [{"request": {"path": "/views/1"}}]}})
    run_haibox_verify(jid, env)
    assert _verdict("o8", "g1", "svc", verifier="reconciliation")["verdict"] == "fail"
    job = env.get_job(jid)
    assert job.result["break_count"] == 1
    # the break is recorded as a reconciliation finding
    conn = vstore.connect()
    try:
        findings = vstore.list_findings(conn, "o8")
    finally:
        conn.close()
    assert findings and findings[0]["title"] == "GET /views/1"


def test_replay_without_target_fails(env):
    jid = _job(env, {"orchestrate_id": "o9", "task_group_id": "g1", "repo": "svc",
                     "replay": {"operations": []}})
    run_haibox_verify(jid, env)
    assert env.get_job(jid).status == JobStatus.FAILED.value


def test_missing_block_fails_job_without_verdict(env):
    jid = _job(env, {"orchestrate_id": "o5", "task_group_id": "g1", "repo": "svc"})
    run_haibox_verify(jid, env)
    assert env.get_job(jid).status == JobStatus.FAILED.value
    assert _verdict("o5", "g1", "svc") is None  # nothing recorded

"""The orchestrate->verification wiring: when the orchestrate code commits a
spec, it records SHA -> (run, spec, repo) so a LATE GitLab CI verdict for that
SHA routes into verification/self-repair instead of being dropped as unknown.

Deterministic — no LLM: drives `_git_one_spec` directly against a real local bare
remote (the generated file is provided by the test, the way the LLM would), and
the late CI message is a signed webhook to the REAL inbound gateway. Everything
else is real: git, the binding store, the gateway, the recorder/gate.
"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests._realgit import init_single_repo, seed_bare_remote, set_git_env

SECRET = "test-webhook-secret"
INGRESS = "ingress-tok-1"


@pytest.fixture
def env(tmp_path, monkeypatch):
    set_git_env(monkeypatch, provider="gitlab", auto_push=True, auto_pr=False)
    monkeypatch.setenv("GITLAB_TOKEN", "dummy-local-no-auth")  # provider=gitlab needs it
    monkeypatch.setenv("ORCHESTRATE_CI_BIND", "true")          # opt-in the wiring
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setenv("JOBS_DB_PATH", str(tmp_path / "jobs.db"))
    monkeypatch.setenv("SX_INGRESS_TOKEN_GITLAB", INGRESS)
    monkeypatch.setenv("SX_WEBHOOK_SECRET_GITLAB", SECRET)
    return tmp_path


def test_orchestrate_commit_binds_sha_then_late_ci_fail_routes(env, tmp_path):
    from src.git.config import load_git_config
    from src.job_queue import tasks
    from src.verification import recorder, store

    # 1. a real product workspace, one repo cloned from a local bare remote
    remote = seed_bare_remote(tmp_path)
    repo_dir = init_single_repo(tmp_path, "acme", "shop", "app", remote)
    (repo_dir / "feature.py").write_text("x = 1\n", encoding="utf-8")  # the "generated" work

    git_config = load_git_config()
    results: list = []

    # 2. the orchestrate per-spec git step, carrying the run id
    tasks._git_one_spec(git_config, [("app", repo_dir)], results, "my-spec",
                        batch_name=None, orchestrate_id="job-abc")
    rec = results[0]
    assert rec["commit_sha"] and not rec["error"]
    sha = rec["commit_sha"]

    # 3. SHA -> (run, spec, repo) was recorded
    conn = store.connect()
    binding = store.lookup_binding(conn, sha, "gitlab")
    conn.close()
    assert binding is not None
    assert binding["orchestrate_id"] == "job-abc"
    assert binding["task_group_id"] == "my-spec"
    assert binding["repo"] == "app"

    # 4. a LATE GitLab CI FAIL for that SHA now CORRELATES (202, not 409)
    import src.api.routes.inbound as inbound
    app = FastAPI()
    app.include_router(inbound.router)
    client = TestClient(app)
    resp = client.post(
        f"/api/v2/inbound/gitlab/{INGRESS}",
        content=json.dumps({"object_attributes": {"sha": sha, "status": "failed"}}).encode(),
        headers={"X-Gitlab-Token": SECRET, "X-Gitlab-Event-UUID": "u1",
                 "Content-Type": "application/json"},
    )
    assert resp.status_code == 202, resp.text
    assert resp.json()["verdict"] == "fail"

    # 5. and it ROUTES into repair: gate refuses, a repair opens
    conn = store.connect()
    ok, reason = recorder.advance(conn, "job-abc", "my-spec")
    assert not ok and "red-gate" in reason
    rok, _ = recorder.open_repair(conn, "job-abc", "my-spec", "app", "ci-trigger", attempt=1)
    conn.close()
    assert rok


def test_verify_job_runs_in_orchestrate_workspace(env, tmp_path):
    # The re-invoked verify job must carry the ORCHESTRATE's company/project (so
    # the verify-loop runs where the repo+spec live and a repair can re-implement)
    # — not the old hardcoded company="verification" placeholder (empty workspace).
    import src.api.routes.inbound as inbound
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.job_queue.job_models import Job, JobStatus, JobType
    from src.job_queue.job_queue import JobQueue
    from src.safe_paths import jobs_db_path
    from src.verification import store

    q = JobQueue(jobs_db_path())
    q.storage.save_job(Job(job_id="orch-acme", type=JobType.ORCHESTRATION,
                           status=JobStatus.COMPLETED, company="acme", project="shop",
                           request_payload={}))
    sha = "a" * 40
    conn = store.connect()
    store.record_binding(conn, sha, "gitlab", "orch-acme", "tg1", "app", "ci-trigger")
    conn.close()

    app = FastAPI()
    app.include_router(inbound.router)
    client = TestClient(app)
    resp = client.post(
        f"/api/v2/inbound/gitlab/{INGRESS}",
        content=json.dumps({"object_attributes": {"sha": sha, "status": "failed"}}).encode(),
        headers={"X-Gitlab-Token": SECRET, "X-Gitlab-Event-UUID": "u-acme",
                 "Content-Type": "application/json"},
    )
    assert resp.status_code == 202, resp.text
    vjob = q.get_job_status(resp.json()["reinvoke_job"])
    assert vjob is not None
    assert vjob.company == "acme"   # was "verification" (empty workspace) before the fix
    assert vjob.project == "shop"


def test_binding_off_by_default(tmp_path, monkeypatch):
    # Parallel-worktrees D11/M3: bindings DEFAULT-ON under worktree mode
    # (they make verify cells pinnable). The opt-in default survives only
    # under the WORKTREE_RUNS=off escape — which this test now pins.
    monkeypatch.setenv("WORKTREE_RUNS", "off")
    set_git_env(monkeypatch, provider="gitlab", auto_push=True, auto_pr=False)
    monkeypatch.setenv("GITLAB_TOKEN", "dummy-local-no-auth")
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    from src.git.config import load_git_config
    from src.job_queue import tasks
    from src.verification import store

    remote = seed_bare_remote(tmp_path)
    repo_dir = init_single_repo(tmp_path, "acme", "shop", "app", remote)
    (repo_dir / "f.py").write_text("y=2\n", encoding="utf-8")
    results: list = []
    tasks._git_one_spec(load_git_config(), [("app", repo_dir)], results, "s",
                        batch_name=None, orchestrate_id="job-x")
    conn = store.connect()
    assert store.lookup_binding(conn, results[0]["commit_sha"], "gitlab") is None
    conn.close()

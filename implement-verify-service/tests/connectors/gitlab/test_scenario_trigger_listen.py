"""E2E scenario guard: trigger+bind → webhook → a consumer LISTENING on the
events projection sees the pipeline finish (verdict + re-invoke).

Mirrors scripts/pipeline_trigger_and_listen.py, but with the real FastAPI router
+ real store via TestClient (only the network hop simulated). No mocks at the
verification seam.
"""

import hashlib
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.connectors.gitlab import verification_bridge as VB

SECRET = "test-webhook-secret"
INGRESS = "ingress-tok-1"
BEARER = "evt-key"


@pytest.fixture
def svc(tmp_path, monkeypatch):
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setenv("JOBS_DB_PATH", str(tmp_path / "jobs.db"))
    monkeypatch.setenv("SX_INGRESS_TOKEN_GITLAB", INGRESS)
    monkeypatch.setenv("SX_WEBHOOK_SECRET_GITLAB", SECRET)
    monkeypatch.setenv("STANDARDS_API_KEY", BEARER)
    import src.api.routes.inbound as inbound
    app = FastAPI()
    app.include_router(inbound.router)
    return TestClient(app)


def _fake_gl(sha):
    from types import SimpleNamespace
    commit = SimpleNamespace(id=sha)
    project = SimpleNamespace(commits=SimpleNamespace(get=lambda ref: commit))
    return SimpleNamespace(projects=SimpleNamespace(get=lambda p: project))


def _webhook(svc, sha, status, uuid):
    payload = {"object_attributes": {"sha": sha, "status": status}}
    return svc.post(
        f"/api/v2/inbound/gitlab/{INGRESS}",
        content=json.dumps(payload).encode(),
        headers={"X-Gitlab-Token": SECRET, "X-Gitlab-Event-UUID": uuid,
                 "Content-Type": "application/json"},
    )


def _events(svc, orch):
    r = svc.get(f"/api/v2/verification/{orch}/events", headers={"Authorization": f"Bearer {BEARER}"})
    assert r.status_code == 200
    return [e["kind"] for e in r.json()["events"]]


def _verdict(svc, orch):
    for e in svc.get(f"/api/v2/verification/{orch}/events",
                     headers={"Authorization": f"Bearer {BEARER}"}).json()["events"]:
        if e["kind"] == "verdict_recorded":
            return json.loads(e["payload_json"])["verdict"]
    return None


def test_scenario_trigger_listen_success(svc):
    orch, sha = "scn-pass", hashlib.sha1(b"pass").hexdigest()
    # TRIGGER: bind the SHA (fire=False — CI fire is account-gated; binding is the wiring)
    res = VB.trigger_and_bind("grp/proj", "main", orchestrate_id=orch,
                              task_group_id="g1", repo="proj", gl=_fake_gl(sha), fire=False)
    assert res["bound"] is True

    # Before finish: a listener sees no verdict yet.
    assert "verdict_recorded" not in _events(svc, orch)

    # FINISH: GitLab webhooks the gateway.
    assert _webhook(svc, sha, "success", "u-pass").status_code == 202

    # LISTEN: the consumer polling the events projection now sees the finish.
    kinds = _events(svc, orch)
    assert "verdict_recorded" in kinds
    assert "reinvoke_requested" in kinds          # fresh verify-task-group enqueued (D10.2)
    assert _verdict(svc, orch) == "pass"


def test_scenario_trigger_listen_failure(svc):
    orch, sha = "scn-fail", hashlib.sha1(b"fail").hexdigest()
    VB.trigger_and_bind("grp/proj", "main", orchestrate_id=orch,
                        task_group_id="g1", repo="proj", gl=_fake_gl(sha), fire=False)
    assert _webhook(svc, sha, "failed", "u-fail").status_code == 202
    assert _verdict(svc, orch) == "fail"


def test_scenario_unbound_never_finishes(svc):
    # Negative control: skip TRIGGER (no binding). The finish webhook is rejected,
    # so a listener on this orchestration never observes a verdict.
    assert _webhook(svc, "deadbeef00", "success", "u-orphan").status_code == 409
    assert _events(svc, "scn-orphan") == []

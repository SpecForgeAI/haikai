"""Proof: `trigger_and_bind` records the D10.4 binding, and the REAL inbound
gateway then correlates a (simulated) webhook → verdict → fresh re-invoke.

No mocks at the verification seam: the real `src.verification.store` and the
real FastAPI inbound router (only the network hop is simulated, exactly like
`tests/verification/test_inbound_gateway.py`). The GitLab provider is the one
true external stood in for — and only to hand back a head SHA; the binding it
writes and everything downstream is real.
"""

import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.connectors.gitlab import verification_bridge as VB
from src.verification import store

SECRET = "test-webhook-secret"
INGRESS = "ingress-tok-1"


@pytest.fixture
def gw(tmp_path, monkeypatch):
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setenv("SX_INGRESS_TOKEN_GITLAB", INGRESS)
    monkeypatch.setenv("SX_WEBHOOK_SECRET_GITLAB", SECRET)
    monkeypatch.setenv("JOBS_DB_PATH", str(tmp_path / "jobs.db"))
    import src.api.routes.inbound as inbound
    app = FastAPI()
    app.include_router(inbound.router)
    return TestClient(app)


def _fake_gl(sha):
    """Stand-in for the GitLab provider that only resolves a head SHA."""
    commit = SimpleNamespace(id=sha)
    project = SimpleNamespace(commits=SimpleNamespace(get=lambda ref: commit))
    return SimpleNamespace(projects=SimpleNamespace(get=lambda p: project))


def _gitlab_webhook(gw, sha, status="success", uuid="u-1"):
    payload = {"object_attributes": {"sha": sha, "status": status}}
    return gw.post(
        f"/api/v2/inbound/gitlab/{INGRESS}",
        content=json.dumps(payload).encode(),
        headers={"X-Gitlab-Token": SECRET, "X-Gitlab-Event-UUID": uuid,
                 "Content-Type": "application/json"},
    )


def test_bind_then_gateway_correlates_and_reinvokes(gw):
    sha = "deadbeefcafe0001"
    # 1. trigger_and_bind records the binding (fire=False skips the account-gated CI POST).
    res = VB.trigger_and_bind(
        "grp/proj", "main", orchestrate_id="orch-1", task_group_id="g1",
        repo="proj", gl=_fake_gl(sha), fire=False,
    )
    assert res["head_sha"] == sha and res["bound"] is True

    # ...and it's durable in the REAL store.
    conn = store.connect()
    binding = store.lookup_binding(conn, sha, "gitlab")
    conn.close()
    assert binding["repo"] == "proj" and binding["orchestrate_id"] == "orch-1"

    # 2. the long pipeline finishes → GitLab webhooks the REAL gateway.
    resp = _gitlab_webhook(gw, sha, "success")
    assert resp.status_code == 202
    body = resp.json()
    assert body["verdict"] == "pass" and body["cell"] == ["proj", "ci-trigger"]
    assert body["reinvoke"] == "queued"  # fresh verify-task-group enqueued (D10.2)

    # 3. the verdict is durable on the cell.
    conn = store.connect()
    latest = store.latest_verdicts(conn, "orch-1", "g1")
    conn.close()
    assert latest[("proj", "ci-trigger")]["verdict"] == "pass"


def test_unbound_sha_rejected_409(gw):
    # Negative control: skip the bind step and the identical webhook has nothing
    # to correlate → the gateway refuses. Proves the binding is load-bearing.
    resp = _gitlab_webhook(gw, "nobinding999", "success", uuid="u-nb")
    assert resp.status_code == 409


def test_failure_status_maps_to_fail(gw):
    sha = "deadbeefcafe0002"
    VB.trigger_and_bind(
        "grp/proj", "main", orchestrate_id="orch-2", task_group_id="g1",
        repo="proj", gl=_fake_gl(sha), fire=False,
    )
    assert _gitlab_webhook(gw, sha, "failed", uuid="u-f").json()["verdict"] == "fail"

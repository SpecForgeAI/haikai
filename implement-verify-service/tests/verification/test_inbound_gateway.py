"""Inbound-gateway tests (D9.1 receipt contract) + TTL sweeper (D10.5) + SSE (D6).

Uses the real FastAPI router with real HMAC signatures over real GitHub/GitLab
payload shapes — only the network hop is simulated.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.verification import recorder, store
from src.verification.sweeper import sweep

SECRET = "test-webhook-secret"
INGRESS = "ingress-tok-1"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setenv("SX_INGRESS_TOKEN_GITHUB", INGRESS)
    monkeypatch.setenv("SX_WEBHOOK_SECRET_GITHUB", SECRET)
    monkeypatch.setenv("SX_INGRESS_TOKEN_GITLAB", INGRESS)
    monkeypatch.setenv("SX_WEBHOOK_SECRET_GITLAB", SECRET)
    monkeypatch.setenv("STANDARDS_API_KEY", "evt-key")  # GET events is bearer-auth now
    # Resolve the router from the CURRENT sys.modules entry, not a collection-time
    # capture: test_api_logging_integration deletes+re-imports src.api* during its
    # run, so a top-level `from ...inbound import router` can diverge from the
    # module a test later patches (the _enqueue_reinvoke monkeypatch would miss the
    # function the router actually calls). Importing here keeps them the same object.
    import src.api.routes.inbound as inbound
    app = FastAPI()
    app.include_router(inbound.router)
    return TestClient(app)


def _conn():
    return store.connect()


def _github_post(client, payload: dict, delivery="d-1", token=INGRESS, secret=SECRET):
    body = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return client.post(
        f"/api/v2/inbound/github/{token}",
        content=body,
        headers={"X-Hub-Signature-256": sig, "X-GitHub-Delivery": delivery,
                 "Content-Type": "application/json"},
    )


GH_RUN = {"workflow_run": {"head_sha": "abc123", "status": "completed", "conclusion": "success"}}


class TestAuthentication:
    def test_wrong_ingress_token_401(self, client):
        assert _github_post(client, GH_RUN, token="nope").status_code == 401

    def test_bad_signature_401(self, client):
        assert _github_post(client, GH_RUN, secret="wrong-secret").status_code == 401

    def test_unknown_provider_404(self, client):
        assert client.post(f"/api/v2/inbound/bitbucket/{INGRESS}").status_code == 404

    def test_gitlab_token_header(self, client):
        conn = _conn()
        store.record_binding(conn, "feed99", "gitlab", "orch-1", "g1", "shop")
        conn.close()
        payload = {"object_attributes": {"sha": "feed99", "status": "success"}}
        resp = client.post(
            f"/api/v2/inbound/gitlab/{INGRESS}",
            content=json.dumps(payload).encode(),
            headers={"X-Gitlab-Token": SECRET, "X-Gitlab-Event-UUID": "u-1",
                     "Content-Type": "application/json"},
        )
        assert resp.status_code == 202
        assert resp.json()["verdict"] == "pass"


class TestReceiptContract:
    def test_full_receipt_records_verdict(self, client):
        conn = _conn()
        store.record_binding(conn, "abc123", "github", "orch-1", "g1", "shop")
        conn.close()
        resp = _github_post(client, GH_RUN)
        assert resp.status_code == 202
        body = resp.json()
        assert body["verdict"] == "pass" and body["cell"] == ["shop", "ci-trigger"]
        conn = _conn()
        latest = store.latest_verdicts(conn, "orch-1", "g1")
        conn.close()
        assert latest[("shop", "ci-trigger")]["verdict"] == "pass"

    def test_duplicate_delivery_not_reprocessed(self, client):
        conn = _conn()
        store.record_binding(conn, "abc123", "github", "orch-1", "g1", "shop")
        conn.close()
        assert _github_post(client, GH_RUN, delivery="dup-1").status_code == 202
        resp = _github_post(client, GH_RUN, delivery="dup-1")
        assert resp.status_code == 200 and "duplicate" in resp.json()["status"]
        conn = _conn()
        rows = conn.execute("SELECT count(*) c FROM verdicts").fetchone()["c"]
        conn.close()
        assert rows == 1  # replay recorded nothing

    def test_unknown_sha_409(self, client):
        resp = _github_post(client, {"workflow_run": {"head_sha": "nobinding", "status": "completed", "conclusion": "success"}})
        assert resp.status_code == 409

    def test_failure_maps_to_fail_and_attempts_increment(self, client):
        conn = _conn()
        store.record_binding(conn, "abc123", "github", "orch-1", "g1", "shop")
        conn.close()
        fail_run = {"workflow_run": {"head_sha": "abc123", "status": "completed", "conclusion": "failure"}}
        assert _github_post(client, fail_run, delivery="d-f1").json()["verdict"] == "fail"
        assert _github_post(client, GH_RUN, delivery="d-p2").json()["verdict"] == "pass"
        conn = _conn()
        latest = store.latest_verdicts(conn, "orch-1", "g1")
        conn.close()
        cell = latest[("shop", "ci-trigger")]
        assert cell["verdict"] == "pass" and cell["attempt"] == 2  # last-writer (D10.6)

    def test_non_verdict_payload_acknowledged(self, client):
        resp = _github_post(client, {"zen": "Keep it logically awesome."}, delivery="d-zen")
        assert resp.status_code == 202 and "ignored" in resp.json()["status"]


class TestReinvokeQueue:
    def test_reinvoke_lands_in_jobs_db_not_verification_db(self, client, tmp_path, monkeypatch):
        # Live-run finding: with VERIFICATION_DB_PATH != JOBS_DB_PATH the
        # re-invoke job was enqueued into the verification db, where the
        # worker (polling JOBS_DB_PATH) would never see it.
        import sqlite3

        jobs_db = str(tmp_path / "jobs-only.db")
        monkeypatch.setenv("JOBS_DB_PATH", jobs_db)
        conn = _conn()
        store.record_binding(conn, "abc123", "github", "orch-1", "g1", "shop")
        conn.close()
        resp = _github_post(client, GH_RUN, delivery="d-queue")
        assert resp.status_code == 202
        assert resp.json()["reinvoke_job"], "enqueue must succeed and return a job id"
        q = sqlite3.connect(jobs_db)
        count = q.execute("SELECT count(*) FROM jobs WHERE type = 'verify-task-group'").fetchone()[0]
        q.close()
        assert count == 1  # in the WORKER's db

    def test_failed_reinvoke_is_observable(self, client, monkeypatch):
        # predict R4: a failed enqueue must not be silently swallowed (and there
        # is NO auto re-drive). The response says reinvoke=failed and a distinct
        # reinvoke_failed event lands; the verdict is still durable.
        import src.api.routes.inbound as inbound
        monkeypatch.setattr(inbound, "_enqueue_reinvoke", lambda binding: None)
        conn = _conn()
        store.record_binding(conn, "abc123", "github", "orch-1", "g1", "shop")
        conn.close()
        resp = _github_post(client, GH_RUN, delivery="d-reinvoke-fail")
        assert resp.status_code == 202
        body = resp.json()
        assert body["reinvoke"] == "failed" and body["reinvoke_job"] is None
        conn = _conn()
        kinds = [e["kind"] for e in store.events_since(conn, "orch-1", 0)]
        latest = store.latest_verdicts(conn, "orch-1", "g1")
        conn.close()
        assert latest[("shop", "ci-trigger")]["verdict"] == "pass"  # verdict still durable
        assert "reinvoke_failed" in kinds and "reinvoke_requested" not in kinds


class TestSweeperAndSSE:
    def test_sweeper_times_out_stale_pending(self, tmp_path, monkeypatch):
        monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "v.db"))
        conn = _conn()
        recorder.record_verdict(conn, "orch-1", "g1", "shop", "ci-trigger", "pending")
        # fresh pending: not swept
        assert sweep(conn, ttl_hours=24) == []
        # pending "older than" a future-now beyond the TTL: swept to timeout
        future = datetime.now(timezone.utc) + timedelta(hours=25)
        swept = sweep(conn, ttl_hours=24, now=future)
        assert len(swept) == 1 and swept[0]["ok"]
        latest = store.latest_verdicts(conn, "orch-1", "g1")
        assert latest[("shop", "ci-trigger")]["verdict"] == "timeout"
        # timeout is terminal: gate refuses to advance
        ok, reason = recorder.advance(conn, "orch-1", "g1")
        assert not ok and "timeout" in reason
        conn.close()

    def test_sweeper_releases_orphaned_box_on_timeout(self, tmp_path, monkeypatch):
        # L6: a serve-only cell timing out carries the box haibox left up for a
        # reconciliation that never came — the sweeper releases that box (best-
        # effort) instead of leaking it to haibox's 7200s TTL.
        monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "v.db"))
        released = []
        monkeypatch.setattr("src.haibox.client.HaiboxClient",
                            type("HB", (), {"__init__": lambda s, *a, **k: None,
                                            "release": lambda s, bid: released.append(bid)}))
        conn = _conn()
        recorder.record_verdict(conn, "orch-x", "g1", "svc", "reconciliation", "pending",
                                detail={"box_id": "box-orphan"})
        future = datetime.now(timezone.utc) + timedelta(hours=25)
        swept = sweep(conn, ttl_hours=24, now=future)
        conn.close()
        assert len(swept) == 1 and swept[0]["ok"]
        assert swept[0]["released_box"] == "box-orphan"
        assert released == ["box-orphan"]

    def test_sweeper_no_box_when_pending_has_none(self, tmp_path, monkeypatch):
        # a pending cell with no box_id (e.g. a CI cell) times out with no release.
        monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "v.db"))
        conn = _conn()
        recorder.record_verdict(conn, "orch-y", "g1", "svc", "ci-trigger", "pending")
        future = datetime.now(timezone.utc) + timedelta(hours=25)
        swept = sweep(conn, ttl_hours=24, now=future)
        conn.close()
        assert swept[0]["released_box"] is None

    def test_events_endpoint_returns_projection(self, client):
        conn = _conn()
        store.record_binding(conn, "abc123", "github", "orch-1", "g1", "shop")
        conn.close()
        _github_post(client, GH_RUN, delivery="d-sse")
        resp = client.get("/api/v2/verification/orch-1/events",
                          headers={"Authorization": "Bearer evt-key"})
        assert resp.status_code == 200
        # unauthenticated read is refused
        assert client.get("/api/v2/verification/orch-1/events").status_code in (401, 403)
        kinds = [e["kind"] for e in resp.json()["events"]]
        assert "verdict_recorded" in kinds and "reinvoke_requested" in kinds

"""Async re-entry e2e (D10.2): a LATE GitLab pipeline message arrives after the
original run is gone, and the gateway drives the right outcome — both a good
verdict and a fail.

The GitLab message is simulated (a signed pipeline webhook) — the one allowed
stand-in; the real GitLab firing these is proven separately by B5
(test_gitlab_webhook_seam). Everything else is real: the inbound gateway, the
recorder/D5 gate, the store, and the re-invoke job landing in jobs.db.

  good verdict  -> verdict 'pass' recorded -> fresh verify-task-group job enqueued
                   -> recorder.advance() CLEARS the gate
  fail verdict  -> verdict 'fail' recorded -> fresh verify-task-group job enqueued
                   -> recorder.advance() REFUSES (red gate) -> open_repair() opens
"""

from __future__ import annotations

import json
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.verification import recorder, store

SECRET = "test-webhook-secret"
INGRESS = "ingress-tok-1"


@pytest.fixture
def gw(tmp_path, monkeypatch):
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setenv("JOBS_DB_PATH", str(tmp_path / "jobs.db"))
    monkeypatch.setenv("SX_INGRESS_TOKEN_GITLAB", INGRESS)
    monkeypatch.setenv("SX_WEBHOOK_SECRET_GITLAB", SECRET)
    import src.api.routes.inbound as inbound
    app = FastAPI()
    app.include_router(inbound.router)
    return TestClient(app), str(tmp_path / "jobs.db")


def _late_gitlab_message(client, sha, status, uuid):
    """Simulate GitLab POSTing a pipeline event long after the run."""
    payload = {"object_attributes": {"sha": sha, "status": status}}
    return client.post(
        f"/api/v2/inbound/gitlab/{INGRESS}",
        content=json.dumps(payload).encode(),
        headers={"X-Gitlab-Token": SECRET, "X-Gitlab-Event-UUID": uuid,
                 "Content-Type": "application/json"},
    )


def _reinvoke_jobs(jobs_db):
    q = sqlite3.connect(jobs_db)
    try:
        return q.execute("SELECT count(*) FROM jobs WHERE type = 'verify-task-group'").fetchone()[0]
    except sqlite3.OperationalError:
        return 0  # no jobs table yet => nothing was ever enqueued
    finally:
        q.close()


def test_late_gitlab_good_verdict_reinvokes_and_gate_clears(gw):
    client, jobs_db = gw
    sha = "feedpass01"
    conn = store.connect()
    store.record_binding(conn, sha, "gitlab", "orch-p", "g1", "shop")  # bound at trigger time
    conn.close()

    resp = _late_gitlab_message(client, sha, "success", "u-pass")
    assert resp.status_code == 202
    assert resp.json()["verdict"] == "pass"

    # the late message enqueued a FRESH verify-task-group run (D10.2)
    assert _reinvoke_jobs(jobs_db) == 1

    # the gate CLEARS on the green cell
    conn = store.connect()
    latest = store.latest_verdicts(conn, "orch-p", "g1")
    ok, reason = recorder.advance(conn, "orch-p", "g1")
    conn.close()
    assert latest[("shop", "ci-trigger")]["verdict"] == "pass"
    assert ok, reason


def test_late_gitlab_fail_verdict_reinvokes_gate_refuses_and_repair_opens(gw):
    client, jobs_db = gw
    sha = "feedfail01"
    conn = store.connect()
    store.record_binding(conn, sha, "gitlab", "orch-f", "g1", "shop")
    conn.close()

    resp = _late_gitlab_message(client, sha, "failed", "u-fail")
    assert resp.status_code == 202
    assert resp.json()["verdict"] == "fail"

    # a fail still re-invokes — the loop decides advance-vs-repair, not the gateway
    assert _reinvoke_jobs(jobs_db) == 1

    conn = store.connect()
    ok, reason = recorder.advance(conn, "orch-f", "g1")
    assert not ok and "red-gate" in reason          # gate REFUSES on the fail
    rok, rreason = recorder.open_repair(conn, "orch-f", "g1", "shop", "ci-trigger", attempt=1)
    conn.close()
    assert rok, rreason                               # repair opens for the failed cell


def test_unbound_late_message_is_rejected(gw):
    # Negative control: a late message for a SHA with no binding can't be
    # correlated -> 409, no verdict, no re-invoke.
    client, jobs_db = gw
    resp = _late_gitlab_message(client, "no-binding-sha", "success", "u-orphan")
    assert resp.status_code == 409
    assert _reinvoke_jobs(jobs_db) == 0

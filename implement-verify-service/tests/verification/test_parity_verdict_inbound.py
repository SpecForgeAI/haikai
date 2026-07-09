"""Parity-verdict inbound + capped repair loop (Spec 2026-07-06-i — Parity
Verify Loop & Execution Gates, Code-Tier Oracle Program).

Pins (mirroring the CI-verdict inbound tests):
  - AUTH:   bearer-key required (C13 — one consumer-facing scheme).
  - RECORD: a pass verdict lands on the (repo, 'parity') cell; no repair.
  - REPAIR: a fail verdict enqueues a verify-task-group repair run carrying
            the parity report, and appends `parity_repair_requested` with the
            attempt ordinal.
  - CAP:    once PARITY_REPAIR_CAP attempts are spent, a further fail verdict
            enqueues NOTHING — `parity_repair_exhausted` event + a
            `parity_failed` finding with the final diff attached (visible,
            never a silent pass, never an unbounded loop).
  - DEDUP:  a repeated delivery_id is a no-op.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.routes import inbound as inbound_module
from src.api.routes.inbound import router
from src.verification import store

API_KEY = "parity-key"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setenv("STANDARDS_API_KEY", API_KEY)
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


@pytest.fixture
def enqueue_spy(monkeypatch):
    """Stub the repair enqueue (the worker queue is out of scope here)."""
    calls: list[dict] = []

    def _fake(orchestrate_id, task_group_id, repo, parity_report):
        calls.append({
            "orchestrate_id": orchestrate_id,
            "task_group_id": task_group_id,
            "repo": repo,
            "parity_report": parity_report,
        })
        return f"parity-repair-job-{len(calls)}"

    monkeypatch.setattr(inbound_module, "_enqueue_parity_repair", _fake)
    return calls


def _post(client, payload, key=API_KEY):
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    return client.post("/api/v2/parity-verdict", json=payload, headers=headers)


def _fail_payload(delivery=None):
    body = {
        "orchestrate_id": "orch-p1",
        "task_group_id": "spec-owners-api",
        "repo": "owners-svc",
        "verdict": "fail",
        "diff_id": "diff-1",
        "breaks": [
            {"fingerprint": "GET /owners/{id}::happy_path::status_drift",
             "method": "GET", "path": "/owners/{id}", "scenario_name": "happy_path",
             "kind": "status_drift", "source_status": 200, "target_status": 500},
        ],
    }
    if delivery:
        body["delivery_id"] = delivery
    return body


class TestAuth:
    def test_unauthenticated_rejected(self, client):
        assert _post(client, _fail_payload(), key=None).status_code in (401, 403)

    def test_missing_keys_400(self, client):
        assert _post(client, {"verdict": "fail"}).status_code == 400
        assert _post(client, {"orchestrate_id": "o", "task_group_id": "g",
                              "verdict": "maybe"}).status_code == 400


class TestRecordAndRepair:
    def test_pass_records_and_skips_repair(self, client, enqueue_spy):
        resp = _post(client, {"orchestrate_id": "orch-p1", "task_group_id": "spec-owners-api",
                              "repo": "owners-svc", "verdict": "pass", "diff_id": "diff-0"})
        assert resp.status_code == 202
        assert resp.json()["repair"] == "not_needed"
        assert enqueue_spy == []

        conn = store.connect()
        cells = store.latest_verdicts(conn, "orch-p1", "spec-owners-api")
        conn.close()
        assert cells[("owners-svc", "parity")]["verdict"] == "pass"

    def test_fail_enqueues_repair_with_parity_report(self, client, enqueue_spy):
        resp = _post(client, _fail_payload())
        assert resp.status_code == 202
        body = resp.json()
        assert body["repair"] == "queued"
        assert body["attempt"] == 1
        assert len(enqueue_spy) == 1
        assert enqueue_spy[0]["parity_report"]["diff_id"] == "diff-1"
        assert enqueue_spy[0]["parity_report"]["breaks"][0]["kind"] == "status_drift"

        conn = store.connect()
        events = [e for e in store.events_since(conn, "orch-p1")
                  if e["kind"] == "parity_repair_requested"]
        conn.close()
        assert len(events) == 1

    def test_cap_exhaustion_stops_repairs_and_records_parity_failed(
            self, client, enqueue_spy, monkeypatch):
        monkeypatch.setenv("PARITY_REPAIR_CAP", "2")

        assert _post(client, _fail_payload()).json()["repair"] == "queued"      # attempt 1
        assert _post(client, _fail_payload()).json()["repair"] == "queued"      # attempt 2
        final = _post(client, _fail_payload()).json()                            # over cap
        assert final["repair"] == "exhausted"
        assert final["attempts"] == 2
        assert len(enqueue_spy) == 2  # NO third enqueue

        conn = store.connect()
        events = store.events_since(conn, "orch-p1")
        findings = store.list_findings(conn, "orch-p1")
        conn.close()
        assert any(e["kind"] == "parity_repair_exhausted" for e in events)
        parity_failed = [f for f in findings if f["kind"] == "parity_failed"]
        assert len(parity_failed) == 1
        # The FINAL diff is attached — visible, never silently passed.
        assert parity_failed[0]["detail"]["diff_id"] == "diff-1"
        assert parity_failed[0]["detail"]["breaks"][0]["kind"] == "status_drift"

    def test_duplicate_delivery_is_noop(self, client, enqueue_spy):
        first = _post(client, _fail_payload(delivery="d-1"))
        assert first.status_code == 202
        dup = _post(client, _fail_payload(delivery="d-1"))
        assert dup.status_code == 200
        assert "duplicate" in dup.json()["status"]
        assert len(enqueue_spy) == 1

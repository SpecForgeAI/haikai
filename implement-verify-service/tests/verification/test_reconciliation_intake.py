"""Bug / reconciliation-diff intake endpoint (D9.1 reserved kind)."""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.routes.inbound import router
from src.verification import store

API_KEY = "recon-read-key"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setenv("STANDARDS_API_KEY", API_KEY)  # C13: one bearer scheme for intake + reads
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _post(client, payload, key=API_KEY):
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    return client.post("/api/v2/reconciliation", json=payload, headers=headers)


class TestAuth:
    def test_unauthenticated_rejected(self, client):
        assert _post(client, {"source": "x", "findings": [{"title": "t"}]}, key=None).status_code in (401, 403)

    def test_wrong_key_401(self, client):
        assert _post(client, {"source": "x", "findings": [{"title": "t"}]}, key="nope").status_code == 401

    def test_missing_source_400(self, client):
        assert _post(client, {"findings": [{"title": "t"}]}).status_code == 400


class TestIntake:
    def test_records_findings_and_correlates(self, client):
        resp = _post(client, {
            "source": "haikai-frontend",
            "findings": [
                {"external_id": "BUG-1", "orchestrate_id": "orch-1", "task_group_id": "g1",
                 "repo": "slugify-svc", "kind": "bug", "title": "slug drops trailing digit",
                 "detail": {"expected": "a-1", "actual": "a"}},
                {"orchestrate_id": "orch-1", "kind": "reconciliation_diff", "title": "missing endpoint",
                 "diff": "- GET /x\n+ (absent)"},
            ],
        })
        assert resp.status_code == 202
        body = resp.json()
        assert body["recorded"] == 2 and len(body["ids"]) == 2

        # retrievable + correlated
        conn = store.connect()
        rows = store.list_findings(conn, "orch-1")
        conn.close()
        assert len(rows) == 2
        assert rows[0]["repo"] == "slugify-svc"
        assert rows[0]["detail"]["expected"] == "a-1"
        assert rows[1]["kind"] == "reconciliation_diff"

    def test_bare_single_finding_accepted(self, client):
        resp = _post(client, {"source": "cli", "title": "lone bug", "detail": {"x": 1}})
        assert resp.status_code == 202 and resp.json()["recorded"] == 1

    def test_external_id_dedups_replays(self, client):
        f = {"source": "haikai-frontend", "findings": [{"external_id": "BUG-9", "title": "dup"}]}
        assert _post(client, f).json()["recorded"] == 1
        r2 = _post(client, f).json()
        assert r2["recorded"] == 0 and r2["duplicates"] == 1

    def test_keyless_finding_dedups_on_content_retry(self, client):
        # R2: a finding with NO external_id and NO delivery_id must still dedup on
        # an at-least-once retry (content-hash key), not insert a duplicate row.
        f = {"source": "haikai", "findings": [
            {"orchestrate_id": "o1", "repo": "svc", "kind": "reconciliation_diff",
             "title": "missing GET /x", "detail": {"expected": "x", "actual": None}}]}
        assert _post(client, f).json()["recorded"] == 1
        r2 = _post(client, f).json()
        assert r2["recorded"] == 0 and r2["duplicates"] == 1
        # a DIFFERENT keyless finding is not falsely deduped
        f2 = {"source": "haikai", "findings": [
            {"orchestrate_id": "o1", "repo": "svc", "kind": "reconciliation_diff",
             "title": "missing GET /y", "detail": {"expected": "y", "actual": None}}]}
        assert _post(client, f2).json()["recorded"] == 1

    def test_batch_delivery_id_dedups(self, client):
        f = {"source": "haikai-frontend", "delivery_id": "batch-1", "findings": [{"title": "a"}]}
        assert _post(client, f).status_code == 202
        assert "duplicate" in _post(client, f).json()["status"]

    def test_empty_findings_400(self, client):
        assert _post(client, {"source": "x", "findings": []}).status_code == 400

    def test_malformed_items_are_counted_not_silently_dropped(self, client):
        # predict R3: non-dict findings used to be silently skipped, so the
        # caller's count never matched what they sent. Now they're reported.
        resp = _post(client, {"source": "x", "findings": [
            {"title": "good"}, "a bare string", 42, {"title": "also good"},
        ]})
        assert resp.status_code == 202
        body = resp.json()
        assert body["recorded"] == 2
        assert body["skipped"] == 2


class TestVerdictRoundTrip:
    def test_verdict_supersedes_pending(self, client):
        # haibox marked the cell `pending`; Haikai reports its reconciliation
        # result here, which must supersede pending on the same cell.
        from src.verification import recorder, store
        conn = store.connect()
        recorder.record_verdict(conn, "orch-rt", "g1", "svc", "reconciliation", "pending")
        conn.close()

        resp = _post(client, {"source": "haikai", "findings": [
            {"orchestrate_id": "orch-rt", "task_group_id": "g1", "repo": "svc",
             "verifier": "reconciliation", "verdict": "fail", "kind": "reconciliation_result",
             "title": "break: GET /x", "detail": {"breaks": 1}}]})
        assert resp.status_code == 202
        assert resp.json()["verdicts"] == 1 and resp.json()["recorded"] == 1

        conn = store.connect()
        cell = store.latest_verdicts(conn, "orch-rt", "g1")[("svc", "reconciliation")]
        conn.close()
        assert cell["verdict"] == "fail"  # superseded the earlier pending

    def test_pass_verdict_records(self, client):
        from src.verification import store
        _post(client, {"source": "haikai", "findings": [
            {"orchestrate_id": "orch-rt2", "task_group_id": "g1", "repo": "svc",
             "verifier": "reconciliation", "verdict": "pass", "title": "all match"}]})
        conn = store.connect()
        cell = store.latest_verdicts(conn, "orch-rt2", "g1").get(("svc", "reconciliation"))
        conn.close()
        assert cell and cell["verdict"] == "pass"

    def _record_pending_with_box(self, oid, box_id):
        # Simulate haibox serve-only: pending verdict whose DETAIL carries the box_id.
        from src.verification import recorder, store
        conn = store.connect()
        recorder.record_verdict(conn, oid, "g1", "svc", "reconciliation", "pending",
                                detail={"box_id": box_id})
        conn.close()

    def test_verdict_releases_the_cell_owned_box_not_the_callers(self, client, monkeypatch):
        # F1 + S5: release the box WE recorded on the cell's pending verdict, and
        # IGNORE a caller-supplied box_id (it could name someone else's box → IDOR).
        released = []
        monkeypatch.setattr("src.haibox.client.HaiboxClient",
                            type("HB", (), {"__init__": lambda s, *a, **k: None,
                                            "release": lambda s, bid: released.append(bid)}))
        self._record_pending_with_box("orch-box", "box-owned")
        resp = _post(client, {"source": "haikai", "findings": [
            {"orchestrate_id": "orch-box", "task_group_id": "g1", "repo": "svc",
             "verifier": "reconciliation", "verdict": "pass",
             "box_id": "box-attacker-supplied", "title": "done"}]})
        assert resp.status_code == 202
        assert resp.json().get("released_boxes") == ["box-owned"]   # cell-owned
        assert released == ["box-owned"]                            # NOT box-attacker-supplied

    def test_verdict_supersede_is_idempotent_on_retry(self, client, monkeypatch):
        # R1: a retried verdict batch (at-least-once) must NOT re-record once the
        # cell has settled — the second arrival is a no-op (superseded), the box
        # isn't released twice.
        released = []
        monkeypatch.setattr("src.haibox.client.HaiboxClient",
                            type("HB", (), {"__init__": lambda s, *a, **k: None,
                                            "release": lambda s, bid: released.append(bid)}))
        self._record_pending_with_box("orch-idem", "box-1")
        body = {"source": "haikai", "findings": [
            {"orchestrate_id": "orch-idem", "task_group_id": "g1", "repo": "svc",
             "verifier": "reconciliation", "verdict": "pass", "title": "done"}]}
        r1 = _post(client, body).json()
        r2 = _post(client, body).json()
        assert r1["verdicts"] == 1 and r2["verdicts"] == 0 and r2["superseded"] == 1
        assert released == ["box-1"]  # released once, not twice

    def test_failed_release_is_surfaced_not_swallowed(self, client, monkeypatch):
        # C6/L8: a release that throws must appear in failed_releases, not vanish
        # into a missing released_boxes entry (which reads as "nothing to release").
        class FakeHB:
            def __init__(self, *a, **k):
                pass

            def release(self, bid):
                raise RuntimeError("haiboxd down")

        monkeypatch.setattr("src.haibox.client.HaiboxClient", FakeHB)
        self._record_pending_with_box("orch-fr", "box-stuck")
        resp = _post(client, {"source": "haikai", "findings": [
            {"orchestrate_id": "orch-fr", "task_group_id": "g1", "repo": "svc",
             "verifier": "reconciliation", "verdict": "pass", "title": "done"}]})
        assert resp.status_code == 202
        body = resp.json()
        assert body.get("released_boxes") == []
        assert body.get("failed_releases") == ["box-stuck"]


class TestRetrieve:
    def test_list_endpoint_filters_by_status(self, client):
        _post(client, {"source": "x", "findings": [
            {"orchestrate_id": "orch-2", "title": "open one"},
        ]})
        h = {"Authorization": "Bearer recon-read-key"}
        resp = client.get("/api/v2/reconciliation/orch-2/findings", headers=h)
        assert resp.status_code == 200
        findings = resp.json()["findings"]
        assert len(findings) == 1 and findings[0]["status"] == "open"
        # unauthenticated read refused
        assert client.get("/api/v2/reconciliation/orch-2/findings").status_code in (401, 403)
        # status filter that matches nothing
        assert client.get("/api/v2/reconciliation/orch-2/findings?status=closed", headers=h).json()["findings"] == []

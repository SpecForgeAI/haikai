"""D6 typed progress stream — GET /api/v2/orchestrations/{id}/stream.

Real FastAPI router + real store (TestClient; only the network hop simulated).
Asserts typed frames, the cells_done/cells_total counters, from_seq resume, and
bearer auth.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.verification import recorder, store

BEARER = "evt-key"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setenv("STANDARDS_API_KEY", BEARER)
    import src.api.routes.inbound as inbound
    app = FastAPI()
    app.include_router(inbound.router)
    return TestClient(app)


def _seed():
    conn = store.connect()
    # two cells in one group: one still pending, one passed → 1 of 2 done.
    recorder.record_verdict(conn, "orch-p", "g1", "shopA", "ci-trigger", "pending")
    recorder.record_verdict(conn, "orch-p", "g1", "shopB", "ci-trigger", "pass")
    # a late async verdict flipped a settled cell → observer-drift hook.
    store.append_event(conn, "orch-p", "g1", "hook_fired", {"transition": "observer-drift"}, "shopB")
    conn.close()


def _get(client, **params):
    r = client.get("/api/v2/orchestrations/orch-p/stream",
                   params=params, headers={"Authorization": f"Bearer {BEARER}"})
    assert r.status_code == 200
    return r.json()


def test_typed_frames_and_progress_counters(client):
    _seed()
    body = _get(client)
    assert body["cells_total"] == 2 and body["cells_done"] == 1
    types = [f["type"] for f in body["frames"]]
    assert types.count("verdict") == 2          # raw verdict_recorded → typed "verdict"
    assert "drift" in types                      # observer-drift hook → typed "drift"
    # every frame carries the counters the UI lanes need
    assert all(f["cells_total"] == 2 and "cells_done" in f for f in body["frames"])
    # frames carry a monotonic seq
    seqs = [f["seq"] for f in body["frames"]]
    assert seqs == sorted(seqs)


def test_from_seq_resume(client):
    _seed()
    full = _get(client)
    first_seq = full["frames"][0]["seq"]
    resumed = _get(client, from_seq=first_seq)
    # resuming past the first frame drops it and returns only later ones
    assert all(f["seq"] > first_seq for f in resumed["frames"])
    assert len(resumed["frames"]) == len(full["frames"]) - 1


def test_requires_bearer(client):
    _seed()
    assert client.get("/api/v2/orchestrations/orch-p/stream").status_code in (401, 403)


def test_empty_orchestration_is_zero_of_zero(client):
    body = _get(client)  # nothing seeded for this fresh db
    assert body == {"cells_done": 0, "cells_total": 0, "frames": []}

"""Tests for the async-verification liveness backstops (D10.5 sweeper scheduling
+ D9.1 poll-fallback driver). Real store throughout; the provider poll is the
one external stood in for, via an injected poll_fn.
"""

import time
from datetime import datetime, timedelta, timezone

import pytest

from src.verification import maintenance, recorder, store


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setenv("JOBS_DB_PATH", str(tmp_path / "jobs.db"))
    return None


def _seed_pending_cell(orch="orch-1", tg="g1", repo="shop", sha="abc123", provider="gitlab"):
    conn = store.connect()
    store.record_binding(conn, sha, provider, orch, tg, repo)
    recorder.record_verdict(conn, orch, tg, repo, "ci-trigger", "pending",
                            detail={"head_sha": sha})
    conn.close()


def _latest(orch="orch-1", tg="g1", repo="shop"):
    conn = store.connect()
    v = store.latest_verdicts(conn, orch, tg)
    conn.close()
    return v.get((repo, "ci-trigger"), {}).get("verdict")


# ── #2 poll-fallback driver ────────────────────────────────────────────────

def test_poll_drives_pending_cell_to_terminal(db):
    _seed_pending_cell()
    conn = store.connect()
    driven = maintenance.poll_open_cells(
        conn, poll_fn=lambda provider, project, sha: "pass",
        reinvoke_fn=lambda binding: "job-1",
    )
    conn.close()
    assert len(driven) == 1 and driven[0]["verdict"] == "pass"
    assert _latest() == "pass"
    # a fresh verify-task-group re-invoke was requested, tagged trigger=poll
    conn = store.connect()
    events = [e for e in store.events_since(conn, "orch-1", 0) if e["kind"] == "reinvoke_requested"]
    conn.close()
    assert events and '"trigger": "poll"' in events[-1]["payload_json"]


def test_poll_leaves_still_pending_alone(db):
    _seed_pending_cell()
    conn = store.connect()
    driven = maintenance.poll_open_cells(conn, poll_fn=lambda *a: "pending", reinvoke_fn=lambda b: "x")
    conn.close()
    assert driven == []
    assert _latest() == "pending"


def test_poll_skips_cell_without_binding(db):
    # pending verdict but no ci_binding → nothing to poll against
    conn = store.connect()
    recorder.record_verdict(conn, "orch-2", "g1", "svc", "ci-trigger", "pending")
    conn.close()
    conn = store.connect()
    driven = maintenance.poll_open_cells(conn, poll_fn=lambda *a: "pass", reinvoke_fn=lambda b: "x")
    conn.close()
    assert driven == []


# ── #1 TTL sweeper, now actually driven by run_once ─────────────────────────

def test_run_once_polls_then_sweeps(db):
    _seed_pending_cell()
    future = datetime.now(timezone.utc) + timedelta(hours=25)
    # poll returns nothing (still pending) → the TTL sweep must time it out
    out = maintenance.run_once(ttl_hours=24, poll_fn=lambda *a: None, now=future)
    assert out["driven"] == [] and len(out["swept"]) == 1
    assert _latest() == "timeout"


def test_run_once_poll_wins_over_sweep(db):
    # A finished pipeline polled this tick must be recorded as its real verdict,
    # NOT timed out — poll runs before sweep.
    _seed_pending_cell()
    future = datetime.now(timezone.utc) + timedelta(hours=25)
    out = maintenance.run_once(ttl_hours=24, poll_fn=lambda *a: "fail", now=future)
    assert len(out["driven"]) == 1 and out["swept"] == []
    assert _latest() == "fail"


# ── the scheduler actually runs the tick ────────────────────────────────────

def test_start_background_drives_a_tick(db):
    _seed_pending_cell()
    stop = maintenance.start_background(interval=0.2, poll_fn=lambda *a: "pass")
    try:
        deadline = time.time() + 4
        while time.time() < deadline and _latest() != "pass":
            time.sleep(0.1)
    finally:
        stop.set()
    assert _latest() == "pass"  # the scheduled tick recorded it


def test_start_background_off_switch(db, monkeypatch):
    monkeypatch.setenv("VERIFY_MAINTENANCE", "off")
    stop = maintenance.start_background(interval=0.1, poll_fn=lambda *a: "pass")
    _seed_pending_cell()
    time.sleep(0.4)
    stop.set()
    assert _latest() == "pending"  # disabled → nothing ran

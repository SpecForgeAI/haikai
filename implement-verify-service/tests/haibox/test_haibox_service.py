"""haiboxd control service — CRUD, auth, capacity cap, reaper, launch-failure."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from src.haibox.backends import LocalSubprocessBackend
from src.haibox.registry import Registry
from src.haibox.service import create_app

API_KEY = "haibox-test-key"
AUTH = {"Authorization": f"Bearer {API_KEY}"}

HTTP_TARGET = [
    sys.executable, "-c",
    "import os,http.server,socketserver;"
    "p=int(os.environ['PORT']);"
    "socketserver.TCPServer(('127.0.0.1',p),http.server.SimpleHTTPRequestHandler).serve_forever()",
]
DEAD_TARGET = [sys.executable, "-c", "import sys; sys.exit(1)"]
# Prints an identifiable diagnostic, then exits (never serves) — for log capture.
DIAG_TARGET = [sys.executable, "-c", "print('BOOM-DIAG-LINE'); import sys; sys.exit(1)"]


def _make(tmp_path, monkeypatch, max_boxes=8):
    monkeypatch.setenv("STANDARDS_API_KEY", API_KEY)
    monkeypatch.setenv("HAIBOX_REAP_INTERVAL", "3600")  # don't let the bg reaper fire mid-test
    registry = Registry(LocalSubprocessBackend(), work_root=str(tmp_path / "boxes"), max_boxes=max_boxes)
    return create_app(registry), registry


def _serve_body(**over):
    body = {"command": HTTP_TARGET, "health_type": "http", "health_path": "/",
            "readiness_timeout": 15}
    body.update(over)
    return body


def test_healthz_is_open(tmp_path, monkeypatch):
    app, _ = _make(tmp_path, monkeypatch)
    with TestClient(app) as c:
        r = c.get("/healthz")
        assert r.status_code == 200 and r.json()["backend"] == "local-subprocess"


def _real_app(tmp_path, monkeypatch):
    """App with the REAL registry (both backends registered)."""
    monkeypatch.setenv("STANDARDS_API_KEY", API_KEY)
    monkeypatch.setenv("HAIBOX_WORK_ROOT", str(tmp_path / "wr"))
    monkeypatch.setenv("HAIBOX_RUNS_DB", str(tmp_path / "runs.db"))
    monkeypatch.setenv("HAIBOX_REAP_INTERVAL", "3600")
    monkeypatch.delenv("HAIBOX_BACKEND", raising=False)  # default local
    from src.haibox.service import create_app as _ca
    return _ca()


def test_docker_backend_without_image_is_422(tmp_path, monkeypatch):
    # Per-request backend=docker with no image is rejected EARLY (not a 502 at launch).
    with TestClient(_real_app(tmp_path, monkeypatch)) as c:
        assert {"local-subprocess", "docker"} <= set(c.get("/healthz").json()["backends"])
        r = c.post("/boxes", json=_serve_body(backend="docker"),
                   headers={"Authorization": f"Bearer {API_KEY}"})
        assert r.status_code == 422 and "image" in r.json()["detail"]


def test_unknown_backend_is_422(tmp_path, monkeypatch):
    with TestClient(_real_app(tmp_path, monkeypatch)) as c:
        r = c.post("/boxes", json=_serve_body(backend="k8s", image="x"),
                   headers={"Authorization": f"Bearer {API_KEY}"})
        assert r.status_code == 422 and "k8s" in r.json()["detail"]


def test_full_lifecycle_serves_real_target(tmp_path, monkeypatch):
    app, _ = _make(tmp_path, monkeypatch)
    with TestClient(app) as c:
        r = c.post("/boxes", json=_serve_body(name="t"), headers=AUTH)
        assert r.status_code == 201, r.text  # ready synchronously -> 201 Created
        box = r.json()
        assert box["state"] == "ready" and box["base_url"].startswith("http://127.0.0.1:")

        # the target really serves on its own port
        assert httpx.get(box["base_url"], timeout=5).status_code == 200

        bid = box["box_id"]
        assert c.get("/boxes", headers=AUTH).json()["boxes"][0]["box_id"] == bid
        assert c.get(f"/boxes/{bid}", headers=AUTH).status_code == 200

        assert c.delete(f"/boxes/{bid}", headers=AUTH).status_code == 200
        assert c.get(f"/boxes/{bid}", headers=AUTH).status_code == 404


def test_auth_required(tmp_path, monkeypatch):
    app, _ = _make(tmp_path, monkeypatch)
    with TestClient(app) as c:
        assert c.post("/boxes", json=_serve_body()).status_code in (401, 403)
        assert c.get("/boxes").status_code in (401, 403)
        assert c.post("/boxes", json=_serve_body(),
                      headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_capacity_cap_returns_429(tmp_path, monkeypatch):
    app, _ = _make(tmp_path, monkeypatch, max_boxes=1)
    with TestClient(app) as c:
        first = c.post("/boxes", json=_serve_body(), headers=AUTH)
        assert first.status_code == 201
        second = c.post("/boxes", json=_serve_body(), headers=AUTH)
        assert second.status_code == 429


def test_launch_failure_returns_502_and_records_failed(tmp_path, monkeypatch):
    app, registry = _make(tmp_path, monkeypatch)
    with TestClient(app) as c:
        r = c.post("/boxes", json=_serve_body(command=DEAD_TARGET, readiness_timeout=4), headers=AUTH)
        assert r.status_code == 502
        # kept for inspection, marked failed, and NOT counted against capacity
        boxes = c.get("/boxes", headers=AUTH).json()["boxes"]
        assert boxes and boxes[0]["state"] == "failed"


def test_heartbeat_pushes_idle_deadline(tmp_path, monkeypatch):
    app, _ = _make(tmp_path, monkeypatch)
    with TestClient(app) as c:
        bid = c.post("/boxes", json=_serve_body(), headers=AUTH).json()["box_id"]
        before = c.get(f"/boxes/{bid}", headers=AUTH).json()["expires_at"]
        after = c.post(f"/boxes/{bid}/heartbeat", headers=AUTH).json()["expires_at"]
        assert after >= before
        assert c.post("/boxes/box-nope/heartbeat", headers=AUTH).status_code == 404


def test_logs_endpoint_returns_target_output(tmp_path, monkeypatch):
    # G1: logs are retrievable for a live box.
    app, _ = _make(tmp_path, monkeypatch)
    with TestClient(app) as c:
        box = c.post("/boxes", json=_serve_body(), headers=AUTH).json()
        httpx.get(box["base_url"], timeout=5)  # generate a request-log line
        r = c.get(f"/boxes/{box['box_id']}/logs", headers=AUTH)
        assert r.status_code == 200 and "log" in r.json()
        assert c.get("/boxes/box-nope/logs", headers=AUTH).status_code == 404


def test_failed_box_preserves_log_and_error_has_tail(tmp_path, monkeypatch):
    # G1: a target that never goes healthy keeps its log; the WHY is visible.
    app, _ = _make(tmp_path, monkeypatch)
    with TestClient(app) as c:
        r = c.post("/boxes", json=_serve_body(command=DIAG_TARGET, readiness_timeout=8), headers=AUTH)
        assert r.status_code == 502
        bid = c.get("/boxes", headers=AUTH).json()["boxes"][0]["box_id"]
        box = c.get(f"/boxes/{bid}", headers=AUTH).json()
        assert box["state"] == "failed" and "BOOM-DIAG-LINE" in (box["error"] or "")
        # and the log file survived for retrieval
        assert "BOOM-DIAG-LINE" in c.get(f"/boxes/{bid}/logs", headers=AUTH).json()["log"]


def test_setup_runs_before_serve_and_is_logged(tmp_path, monkeypatch):
    # G5: setup runs first; its output lands in the box log.
    app, _ = _make(tmp_path, monkeypatch)
    setup = [sys.executable, "-c", "print('SETUP-RAN-OK')"]
    with TestClient(app) as c:
        box = c.post("/boxes", json=_serve_body(setup=setup), headers=AUTH).json()
        assert box["state"] == "ready"
        assert "SETUP-RAN-OK" in c.get(f"/boxes/{box['box_id']}/logs", headers=AUTH).json()["log"]


def test_setup_failure_fails_launch_with_tail(tmp_path, monkeypatch):
    # G5: a non-zero setup fails the launch (502) with its tail in the error.
    app, _ = _make(tmp_path, monkeypatch)
    setup = [sys.executable, "-c", "print('SETUP-EXPLODED'); import sys; sys.exit(3)"]
    with TestClient(app) as c:
        r = c.post("/boxes", json=_serve_body(setup=setup), headers=AUTH)
        assert r.status_code == 502
        assert "SETUP-EXPLODED" in r.json()["detail"]


def test_setup_timeout_fails_launch(tmp_path, monkeypatch):
    # N2: a hanging setup must not block launch forever — it's bounded.
    app, _ = _make(tmp_path, monkeypatch)
    slow_setup = [sys.executable, "-c", "import time; time.sleep(10)"]
    with TestClient(app) as c:
        r = c.post("/boxes", json=_serve_body(setup=slow_setup, setup_timeout=1), headers=AUTH)
        assert r.status_code == 502
        assert "timeout" in r.json()["detail"].lower()


def test_reaper_terminates_expired_box(tmp_path, monkeypatch):
    app, registry = _make(tmp_path, monkeypatch)
    with TestClient(app) as c:
        box = c.post("/boxes", json=_serve_body(idle_seconds=1, ttl_seconds=1), headers=AUTH).json()
        bid = box["box_id"]
        # nothing reaped "now"
        assert registry.reap(now=datetime.now(timezone.utc)) == []
        # well past the deadline -> reaped
        future = datetime.now(timezone.utc) + timedelta(seconds=10)
        assert bid in registry.reap(now=future)
        assert c.get(f"/boxes/{bid}", headers=AUTH).status_code == 404

"""haibox run mode — async submit, exit-code capture, streaming, durability."""

from __future__ import annotations

import os
import sys
import time

import pytest
from fastapi.testclient import TestClient

from src.haibox.backends import LocalSubprocessBackend
from src.haibox.models import Run, RunSpec, RunState
from src.haibox.registry import Registry
from src.haibox.runs import RunManager, RunStore
from src.haibox.service import create_app

API_KEY = "haibox-run-key"
AUTH = {"Authorization": f"Bearer {API_KEY}"}
PY = sys.executable


def _app(tmp_path, monkeypatch, max_runs=8):
    monkeypatch.setenv("STANDARDS_API_KEY", API_KEY)
    monkeypatch.setenv("HAIBOX_REAP_INTERVAL", "3600")
    backend = LocalSubprocessBackend()
    work_root = str(tmp_path / "wr")
    os.makedirs(work_root, exist_ok=True)
    store = RunStore(str(tmp_path / "runs.db"))
    rm = RunManager(backend, work_root=work_root, store=store, max_concurrent=max_runs, poll=0.1)
    reg = Registry(backend, work_root=work_root, max_boxes=8)
    return create_app(reg, rm), rm, store, work_root


def _wait(c, run_id, timeout=25):
    end = time.time() + timeout
    while time.time() < end:
        r = c.get(f"/runs/{run_id}", headers=AUTH).json()
        if r["state"] in ("succeeded", "failed", "timeout", "interrupted"):
            return r
        time.sleep(0.2)
    raise AssertionError(f"run {run_id} did not finish")


def test_submit_is_async_returns_immediately(tmp_path, monkeypatch):
    app, *_ = _app(tmp_path, monkeypatch)
    with TestClient(app) as c:
        body = {"command": [PY, "-c", "import time; time.sleep(1.5)"]}
        t0 = time.time()
        r = c.post("/runs", json=body, headers=AUTH)
        elapsed = time.time() - t0
        assert r.status_code == 202
        assert elapsed < 1.0, "POST must return before the command finishes (async)"
        assert r.json()["state"] in ("queued", "running")
        _wait(c, r.json()["run_id"])  # let it finish/cleanup


def test_exit_code_captured_success_and_failure(tmp_path, monkeypatch):
    app, *_ = _app(tmp_path, monkeypatch)
    with TestClient(app) as c:
        ok = c.post("/runs", json={"command": [PY, "-c", "print('RUN-OK-MARK')"]}, headers=AUTH).json()
        bad = c.post("/runs", json={"command": [PY, "-c", "import sys;print('RUN-FAIL');sys.exit(3)"]},
                     headers=AUTH).json()
        rok = _wait(c, ok["run_id"])
        rbad = _wait(c, bad["run_id"])
        assert rok["state"] == "succeeded" and rok["exit_code"] == 0
        assert rbad["state"] == "failed" and rbad["exit_code"] == 3
        assert "RUN-OK-MARK" in c.get(f"/runs/{ok['run_id']}/logs", headers=AUTH).json()["log"]


def test_stream_emits_log_and_exit_events(tmp_path, monkeypatch):
    app, *_ = _app(tmp_path, monkeypatch)
    with TestClient(app) as c:
        run = c.post("/runs", json={"command": [PY, "-c", "print('STREAM-MARK')"]}, headers=AUTH).json()
        _wait(c, run["run_id"])
        body = c.get(f"/runs/{run['run_id']}/stream", headers=AUTH).text
        assert "event: log" in body and "STREAM-MARK" in body
        assert "event: exit" in body and '"exit_code": 0' in body


def test_timeout_kills_long_run(tmp_path, monkeypatch):
    app, *_ = _app(tmp_path, monkeypatch)
    with TestClient(app) as c:
        run = c.post("/runs", json={"command": [PY, "-c", "import time; time.sleep(30)"],
                                    "timeout_seconds": 1}, headers=AUTH).json()
        r = _wait(c, run["run_id"], timeout=15)
        assert r["state"] == "timeout"


def test_capacity_cap(tmp_path, monkeypatch):
    app, *_ = _app(tmp_path, monkeypatch, max_runs=1)
    with TestClient(app) as c:
        first = c.post("/runs", json={"command": [PY, "-c", "import time; time.sleep(2)"]}, headers=AUTH)
        assert first.status_code == 202
        second = c.post("/runs", json={"command": [PY, "-c", "print(1)"]}, headers=AUTH)
        assert second.status_code == 429
        _wait(c, first.json()["run_id"])


def test_delete_and_auth(tmp_path, monkeypatch):
    app, *_ = _app(tmp_path, monkeypatch)
    with TestClient(app) as c:
        assert c.post("/runs", json={"command": [PY, "-c", "print(1)"]}).status_code in (401, 403)
        run = c.post("/runs", json={"command": [PY, "-c", "print(1)"]}, headers=AUTH).json()
        _wait(c, run["run_id"])
        assert c.delete(f"/runs/{run['run_id']}", headers=AUTH).status_code == 200
        assert c.get(f"/runs/{run['run_id']}", headers=AUTH).status_code == 404


def test_runs_survive_restart_and_running_becomes_interrupted(tmp_path, monkeypatch):
    monkeypatch.setenv("STANDARDS_API_KEY", API_KEY)
    backend = LocalSubprocessBackend()
    work_root = str(tmp_path / "wr"); os.makedirs(work_root, exist_ok=True)
    db = str(tmp_path / "runs.db")
    store = RunStore(db)

    rm1 = RunManager(backend, work_root=work_root, store=store, poll=0.1)
    run = rm1.submit(RunSpec(command=[PY, "-c", "print('PERSIST-MARK')"], name="persisted"))
    # wait until it finishes
    end = time.time() + 20
    while time.time() < end and not rm1.get(run.run_id).state.terminal:
        time.sleep(0.1)
    assert rm1.get(run.run_id).state == RunState.SUCCEEDED

    # a separate run that we leave marked "running" to simulate a crash
    stuck = Run(run_id="run-stuck", spec=RunSpec(command=[PY, "-c", "pass"]),
                backend=backend.name, state=RunState.RUNNING)
    store.save(stuck)

    # "restart": a brand-new manager on the same store
    rm2 = RunManager(backend, work_root=work_root, store=store)
    survived = rm2.get(run.run_id)
    assert survived is not None and survived.state == RunState.SUCCEEDED  # pollable across restart
    assert rm2.get("run-stuck").state == RunState.INTERRUPTED            # crash recovery


def test_bad_runspec_rejected():
    with pytest.raises(ValueError):
        RunSpec(command="")
    with pytest.raises(ValueError):
        RunSpec(command="x", timeout_seconds=0)

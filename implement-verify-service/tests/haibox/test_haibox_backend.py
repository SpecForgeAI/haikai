"""haibox LocalSubprocessBackend — real child-process lifecycle on this machine."""

from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pytest

from src.haibox.backends import (
    LocalSubprocessBackend,
    find_free_port,
    wait_healthy,
)
from src.haibox.models import HEALTH_HTTP, BoxSpec

# A real serving target: a stdlib HTTP server that binds $PORT and 200s on GET /.
HTTP_TARGET = [
    sys.executable, "-c",
    "import os,http.server,socketserver;"
    "p=int(os.environ['PORT']);"
    "socketserver.TCPServer(('127.0.0.1',p),http.server.SimpleHTTPRequestHandler).serve_forever()",
]
# A target that exits immediately and never serves.
DEAD_TARGET = [sys.executable, "-c", "import sys; sys.exit(0)"]


def test_find_free_port_is_bindable():
    import socket
    port = find_free_port()
    with socket.socket() as s:
        s.bind(("127.0.0.1", port))  # must be free right now


def test_launch_serve_healthcheck_and_teardown(tmp_path):
    be = LocalSubprocessBackend()
    spec = BoxSpec(command=HTTP_TARGET, health_type=HEALTH_HTTP, readiness_timeout=15)
    handle = be.launch("box-test1", spec, str(tmp_path))
    try:
        assert handle["base_url"].startswith("http://127.0.0.1:")
        assert be.is_alive(handle)
        ok = wait_healthy(handle["base_url"], spec,
                          is_alive=lambda: be.is_alive(handle), port=handle["port"])
        assert ok, "target should become healthy"
        # It REALLY serves on its own port (not the test process).
        resp = httpx.get(handle["base_url"], timeout=5)
        assert resp.status_code == 200
        workdir = Path(handle["workdir"])
        assert workdir.exists()
    finally:
        be.terminate(handle)

    assert not be.is_alive(handle), "process must be gone after terminate"
    assert not Path(handle["workdir"]).exists(), "workdir must be cleaned up"


def test_terminate_is_idempotent(tmp_path):
    be = LocalSubprocessBackend()
    spec = BoxSpec(command=HTTP_TARGET, readiness_timeout=15)
    handle = be.launch("box-idem", spec, str(tmp_path))
    be.terminate(handle)
    be.terminate(handle)  # second call must not raise
    assert not be.is_alive(handle)


def test_wait_healthy_false_when_process_dies(tmp_path):
    be = LocalSubprocessBackend()
    spec = BoxSpec(command=DEAD_TARGET, readiness_timeout=5)
    handle = be.launch("box-dead", spec, str(tmp_path))
    try:
        ok = wait_healthy(handle["base_url"], spec,
                          is_alive=lambda: be.is_alive(handle), port=handle["port"])
        assert ok is False, "a target that exits immediately is never healthy"
    finally:
        be.terminate(handle)


def test_source_dir_is_copied_with_ignores(tmp_path):
    src = tmp_path / "src"
    (src / ".git").mkdir(parents=True)
    (src / ".git" / "HEAD").write_text("ref: x")
    (src / "app.py").write_text("print('hi')")
    be = LocalSubprocessBackend()
    spec = BoxSpec(command=HTTP_TARGET, source_dir=str(src), readiness_timeout=15)
    handle = be.launch("box-copy", spec, str(tmp_path / "boxes"))
    try:
        wd = Path(handle["workdir"])
        assert (wd / "app.py").exists()          # source copied
        assert not (wd / ".git").exists()         # heavy dir ignored
    finally:
        be.terminate(handle)


def test_repeated_launch_terminate_does_not_leak(tmp_path):
    # N1 smoke: many launch/terminate cycles stay clean (no fd/proc/dir leak).
    be = LocalSubprocessBackend()
    spec = BoxSpec(command=HTTP_TARGET, readiness_timeout=15)
    for i in range(10):
        handle = be.launch(f"box-leak{i}", spec, str(tmp_path))
        assert wait_healthy(handle["base_url"], spec,
                            is_alive=lambda: be.is_alive(handle), port=handle["port"])
        be.terminate(handle)
        assert not be.is_alive(handle)
    # all workdirs cleaned, no live procs tracked
    assert be._procs == {}
    assert not list((tmp_path).glob("box-leak*"))


def test_bad_spec_rejected():
    with pytest.raises(ValueError):
        BoxSpec(command="")
    with pytest.raises(ValueError):
        BoxSpec(command="x", health_type="carrier-pigeon")

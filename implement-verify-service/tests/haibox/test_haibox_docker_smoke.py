"""Real-daemon smoke test for DockerBackend — serves a container, health-checks it,
releases it. Skips cleanly when there's no Docker daemon (or the image isn't local),
so it's honest in CI/offline. Here (Docker 26.0.0 present) it runs for real."""

from __future__ import annotations

import shutil
import subprocess
import urllib.request

import pytest

from src.haibox.backends import DockerBackend, wait_healthy
from src.haibox.models import BoxSpec

NODE_IMG = "node:22"  # present locally — a no-network HTTP server target


def _docker_ok() -> bool:
    if not shutil.which("docker"):
        return False
    try:
        return subprocess.run(["docker", "version"], capture_output=True, timeout=10).returncode == 0
    except Exception:
        return False


def _image_present(img: str) -> bool:
    return subprocess.run(["docker", "image", "inspect", img], capture_output=True).returncode == 0


pytestmark = pytest.mark.skipif(not _docker_ok(), reason="no docker daemon")

# A tiny HTTP server that binds $PORT and answers 200 'ok' on any path.
_SERVER = ("node -e \"require('http')"
           ".createServer((q,r)=>{r.writeHead(200);r.end('ok')})"
           ".listen(process.env.PORT)\"")


def test_docker_backend_serves_health_and_releases(tmp_path):
    if not _image_present(NODE_IMG):
        pytest.skip(f"{NODE_IMG} not present locally (would require a network pull)")
    b = DockerBackend()
    spec = BoxSpec(command=_SERVER, image=NODE_IMG, health_type="http", health_path="/",
                   readiness_timeout=60.0)
    handle = b.launch("smoke-serve", spec, str(tmp_path))
    try:
        assert handle["container"] and handle["base_url"].startswith("http://127.0.0.1:")
        healthy = wait_healthy(handle["base_url"], spec, lambda: b.is_alive(handle), handle["port"])
        assert healthy, "container never healthy; logs:\n" + b.read_log(handle)
        with urllib.request.urlopen(handle["base_url"] + "/", timeout=5) as r:
            assert r.status == 200 and r.read().decode() == "ok"
        assert b.is_alive(handle)
    finally:
        b.terminate(handle)
    assert not b.is_alive(handle)  # stopped + removed


def test_docker_backend_run_mode_exit_code(tmp_path):
    if not _image_present(NODE_IMG):
        pytest.skip(f"{NODE_IMG} not present locally")
    import time
    from src.haibox.models import RunSpec
    b = DockerBackend()
    spec = RunSpec(command="node -e \"process.exit(3)\"", image=NODE_IMG, timeout_seconds=60.0)
    handle = b.start_run("smoke-run", spec, str(tmp_path))
    try:
        for _ in range(120):  # poll up to ~30s for the ephemeral container to exit
            rc = b.returncode(handle)
            if rc is not None:
                break
            time.sleep(0.25)
        assert rc == 3  # exit code propagated from the container
    finally:
        b.terminate(handle)

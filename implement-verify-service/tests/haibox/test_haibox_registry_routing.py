"""Registry routes each box to the backend it was created with (per-request)."""

from __future__ import annotations

import pytest

from src.haibox.models import BoxSpec
from src.haibox.registry import Registry


class FakeBackend:
    def __init__(self, name):
        self.name = name
        self.launched = []
        self.stopped = []
        self.cleaned = []
        self.swept = 0

    def launch(self, box_id, spec, work_root):
        self.launched.append(box_id)
        return {"base_url": f"http://127.0.0.1:1/{self.name}", "port": 1, "id": box_id}

    def is_alive(self, handle):
        return True

    def stop(self, handle):
        self.stopped.append(handle.get("id"))

    def cleanup(self, handle):
        self.cleaned.append(handle.get("id"))

    def read_log(self, handle, max_bytes=65536):
        return f"log-{self.name}"

    def terminate(self, handle):
        self.stop(handle); self.cleanup(handle)

    def sweep_orphans(self, work_root):
        self.swept += 1
        return [f"{self.name}-orphan"]

    # run-mode
    def start_run(self, run_id, spec, work_root):
        self.launched.append(run_id)
        return {"id": run_id, "log_path": f"/tmp/{run_id}.log", "ran_on": self.name}

    def returncode(self, handle):
        return 0  # finished immediately


@pytest.fixture
def reg(tmp_path, monkeypatch):
    # make every box healthy instantly (no real probe)
    monkeypatch.setattr("src.haibox.registry.wait_healthy", lambda *a, **k: True)
    local, docker = FakeBackend("local-subprocess"), FakeBackend("docker")
    r = Registry({"local-subprocess": local, "docker": docker}, work_root=str(tmp_path),
                 default="local-subprocess")
    return r, local, docker


def _spec():
    return BoxSpec(command=["x"], image="img", readiness_timeout=5)


def test_default_backend_used_when_unspecified(reg):
    r, local, docker = reg
    box = r.create(_spec())
    assert box.backend == "local-subprocess"
    assert local.launched and not docker.launched


def test_explicit_backend_routes_there(reg):
    r, local, docker = reg
    box = r.create(_spec(), backend="docker")
    assert box.backend == "docker"
    assert docker.launched and not local.launched


def test_per_box_ops_route_to_each_boxs_backend(reg):
    r, local, docker = reg
    b1 = r.create(_spec(), backend="local-subprocess")
    b2 = r.create(_spec(), backend="docker")
    assert r.read_log(b1.box_id) == "log-local-subprocess"
    assert r.read_log(b2.box_id) == "log-docker"
    r.release(b1.box_id); r.release(b2.box_id)
    assert local.stopped == [b1.box_id] and docker.stopped == [b2.box_id]
    assert local.cleaned == [b1.box_id] and docker.cleaned == [b2.box_id]


def test_unknown_backend_raises(reg):
    r, _l, _d = reg
    with pytest.raises(ValueError, match="unknown backend"):
        r.create(_spec(), backend="k8s")


def test_sweep_orphans_covers_all_backends(reg):
    r, local, docker = reg
    swept = r.sweep_orphans()
    assert set(swept) == {"local-subprocess-orphan", "docker-orphan"}
    assert local.swept == 1 and docker.swept == 1


def test_single_backend_back_compat(tmp_path, monkeypatch):
    # A lone backend (old constructor form) still works and is the default.
    monkeypatch.setattr("src.haibox.registry.wait_healthy", lambda *a, **k: True)
    only = FakeBackend("local-subprocess")
    r = Registry(only, work_root=str(tmp_path))
    assert r.default_backend == "local-subprocess" and r.backend is only
    box = r.create(_spec())
    assert box.backend == "local-subprocess"


def test_run_manager_routes_per_run(tmp_path):
    import time
    from src.haibox.models import RunSpec
    from src.haibox.runs import RunManager, RunStore
    local, docker = FakeBackend("local-subprocess"), FakeBackend("docker")
    rm = RunManager({"local-subprocess": local, "docker": docker},
                    work_root=str(tmp_path), store=RunStore(str(tmp_path / "runs.db")),
                    default="local-subprocess")
    r1 = rm.submit(RunSpec(command="x"))                    # default -> local
    r2 = rm.submit(RunSpec(command="x", image="img"), backend="docker")
    for _ in range(40):
        if rm.get(r1.run_id).state.terminal and rm.get(r2.run_id).state.terminal:
            break
        time.sleep(0.05)
    assert r1.backend == "local-subprocess" and r2.backend == "docker"
    assert r1.run_id in local.launched and r2.run_id in docker.launched
    assert r1.run_id not in docker.launched

    with pytest.raises(ValueError, match="unknown backend"):
        rm.submit(RunSpec(command="x"), backend="k8s")

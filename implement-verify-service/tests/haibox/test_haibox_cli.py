"""haibox CLI + worker-integration — argument wiring and guaranteed teardown."""

from __future__ import annotations

import pytest

from src.haibox import cli as cli_mod
from src.haibox import integration as integ_mod


class FakeClient:
    """Records calls instead of hitting a real haiboxd."""

    last: "FakeClient | None" = None

    def __init__(self, *a, **k):
        self.calls: list[tuple] = []
        self.released: list[str] = []
        FakeClient.last = self

    def serve(self, command, **spec):
        self.calls.append(("serve", command, spec))
        return {"box_id": "box-fake", "base_url": "http://127.0.0.1:9", "state": "ready"}

    def list(self):
        self.calls.append(("list",)); return []

    def inspect(self, box_id):
        self.calls.append(("inspect", box_id)); return {"box_id": box_id}

    def heartbeat(self, box_id):
        self.calls.append(("heartbeat", box_id)); return {"box_id": box_id}

    def release(self, box_id):
        self.released.append(box_id)

    def healthz(self):
        return {"status": "ok"}


@pytest.fixture
def fake_cli(monkeypatch):
    monkeypatch.setattr(cli_mod, "HaiboxClient", FakeClient)
    return FakeClient


def test_serve_passes_command_after_double_dash(fake_cli):
    rc = cli_mod.main(["serve", "--source", "./repo", "--health-path", "/healthz",
                       "--env", "FOO=bar", "--", "python", "app.py"])
    assert rc == 0
    name, command, spec = FakeClient.last.calls[-1]
    assert name == "serve"
    assert command == ["python", "app.py"]
    assert spec["source_dir"] == "./repo"
    assert spec["health_path"] == "/healthz"
    assert spec["env"] == {"FOO": "bar"}


def test_serve_without_command_errors(fake_cli):
    assert cli_mod.main(["serve"]) == 2


def test_dispatch_list_inspect_release(fake_cli):
    assert cli_mod.main(["list"]) == 0
    assert cli_mod.main(["inspect", "box-1"]) == 0
    assert cli_mod.main(["release", "box-1"]) == 0
    assert "box-1" in FakeClient.last.released


# ── integration: serving_target / provision_for_job ──────────────────────────


def test_serving_target_releases_on_success():
    c = FakeClient()
    with integ_mod.serving_target(["python", "app.py"], client=c, health_path="/h") as box:
        assert box["base_url"] == "http://127.0.0.1:9"
    assert c.released == ["box-fake"]


def test_serving_target_heartbeats_during_block():
    import time
    c = FakeClient()
    with integ_mod.serving_target(["python", "app.py"], client=c, heartbeat_interval=0.05):
        time.sleep(0.2)
    beats = [x for x in c.calls if x[0] == "heartbeat"]
    assert len(beats) >= 1, "an in-use box must be kept alive (G3)"
    assert c.released == ["box-fake"]


def test_serving_target_releases_on_exception():
    c = FakeClient()
    with pytest.raises(RuntimeError):
        with integ_mod.serving_target(["python", "app.py"], client=c):
            raise RuntimeError("boom during reconcile")
    assert c.released == ["box-fake"], "box must be released even when the block raises"


def test_provision_for_job_noop_without_target():
    c = FakeClient()
    assert integ_mod.provision_for_job({"orchestrate_id": "o1"}, client=c) is None
    assert c.calls == []


def test_provision_for_job_serves_when_target_present():
    c = FakeClient()
    box = integ_mod.provision_for_job(
        {"target": {"command": ["python", "app.py"], "health_path": "/healthz"}}, client=c)
    assert box["box_id"] == "box-fake"
    name, command, spec = c.calls[-1]
    assert command == ["python", "app.py"] and spec["health_path"] == "/healthz"

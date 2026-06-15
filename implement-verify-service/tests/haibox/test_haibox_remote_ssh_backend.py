"""RemoteSSHBackend — SSH command construction + lifecycle, with ssh/scp mocked.

Proves the Backend Protocol is satisfied over SSH (mkdir/scp/setup/remote-port/
detached-start/tunnel; is_alive/stop/cleanup/read_log) without a live host. The
live path is the gated e2e (skips with no sshd)."""

from __future__ import annotations

import subprocess

import pytest

from src.haibox import backends
from src.haibox.backends import RemoteSSHBackend, build_backends
from src.haibox.models import BoxSpec
from src.haibox.service import canonical_backend


class FakeSSH:
    """Records (host, remote_cmd) and returns canned results keyed by the command."""

    def __init__(self):
        self.calls = []
        self.alive = True
        self.rc = ""   # contents the remote _haibox_rc file would hold

    def __call__(self, host, remote_cmd, *, timeout=None):
        self.calls.append((host, remote_cmd))
        def cp(out="", rc=0, err=""):
            return subprocess.CompletedProcess([host, remote_cmd], rc, stdout=out, stderr=err)
        if "_haibox_rc" in remote_cmd and remote_cmd.lstrip().startswith("cat"):
            return cp(self.rc)
        if "mkdir -p" in remote_cmd:
            return cp()
        if "import socket" in remote_cmd:           # remote free-port probe
            return cp("54321")
        if "setsid nohup" in remote_cmd:            # detached start -> echo $!
            return cp("9999")
        if "kill -0" in remote_cmd:
            return cp(rc=0 if self.alive else 1)
        if "tail -c" in remote_cmd:
            return cp("remote-log-tail")
        if "cd " in remote_cmd:                     # setup step
            return cp()
        return cp()


class FakeProc:
    def __init__(self, pid=4242):
        self.pid = pid
        self.terminated = False
    def terminate(self):
        self.terminated = True
    def wait(self, timeout=None):
        return 0


@pytest.fixture
def be(monkeypatch):
    ssh = FakeSSH()
    monkeypatch.setattr(backends, "run_ssh", ssh)
    monkeypatch.setattr(backends, "run_scp",
                        lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout="", stderr=""))
    b = RemoteSSHBackend()

    def fake_tunnel(self, host, lport, rport):
        p = FakeProc()
        self._tunnels[p.pid] = p
        return p
    monkeypatch.setattr(RemoteSSHBackend, "_open_tunnel", fake_tunnel)
    return b, ssh


def _spec(tmp_path, **over):
    kw = dict(command="python app.py", host="user@remote", source_dir=str(tmp_path),
              readiness_timeout=5)
    kw.update(over)
    return BoxSpec(**kw)


def test_launch_ssh_sequence_and_handle(be, tmp_path):
    b, ssh = be
    handle = b.launch("box-1", _spec(tmp_path), "wr")
    cmds = [c for _h, c in ssh.calls]
    assert any("mkdir -p haibox-boxes/box-1" in c for c in cmds)
    assert any("import socket" in c for c in cmds)                       # remote free port
    start = next(c for c in cmds if "setsid nohup" in c)
    assert "PORT=54321" in start and "echo $!" in start                  # remote binds the remote port
    assert handle["host"] == "user@remote" and handle["remote_pid"] == 9999
    assert handle["remote_port"] == 54321
    assert handle["base_url"].startswith("http://127.0.0.1:")           # loopback via tunnel
    assert handle["tunnel_pid"] == 4242 and handle["port"] > 0


def test_validate_requires_host():
    with pytest.raises(ValueError, match="host"):
        RemoteSSHBackend().validate_spec(BoxSpec(command=["x"]))
    RemoteSSHBackend().validate_spec(BoxSpec(command=["x"], host="h"))  # ok


def test_launch_without_host_raises(be, tmp_path):
    b, _ssh = be
    with pytest.raises(RuntimeError, match="host"):
        b.launch("box-x", BoxSpec(command=["x"], source_dir=str(tmp_path)), "wr")


def test_setup_runs_remotely_before_start(be, tmp_path):
    b, ssh = be
    b.launch("box-2", _spec(tmp_path, setup="pip install -r requirements.txt"), "wr")
    cmds = [c for _h, c in ssh.calls]
    setup_idx = next(i for i, c in enumerate(cmds) if "pip install -r requirements.txt" in c)
    start_idx = next(i for i, c in enumerate(cmds) if "setsid nohup" in c)
    assert setup_idx < start_idx


def test_lifecycle_ssh_calls(be, tmp_path):
    b, ssh = be
    h = b.launch("box-3", _spec(tmp_path), "wr")
    assert b.is_alive(h) is True
    assert b.read_log(h) == "remote-log-tail"
    b.stop(h)
    assert any("kill -TERM" in c for _h, c in ssh.calls)
    b.cleanup(h)
    assert any("rm -rf haibox-boxes/box-3" in c for _h, c in ssh.calls)


def test_run_mode_captures_exit_code_via_rc_file(be, tmp_path):
    b, ssh = be
    from src.haibox.models import RunSpec
    handle = b.start_run("run-1", RunSpec(command="pytest -q", host="user@remote",
                                          source_dir=str(tmp_path)), "wr")
    # the detached start wraps the command to write its exit code remotely
    start = next(c for _h, c in ssh.calls if "setsid nohup" in c)
    assert "echo $? > _haibox_rc" in start
    assert "PORT=" not in start and handle.get("remote_port") is None  # no port/tunnel for a run

    # returncode: empty rc file -> still running (None); a digit -> that code
    ssh.rc = ""
    assert b.returncode(handle) is None
    ssh.rc = "0"
    assert b.returncode(handle) == 0
    ssh.rc = "3"
    assert b.returncode(handle) == 3


def test_registered_in_the_seam():
    m = build_backends()
    assert "remote-ssh" in m and isinstance(m["remote-ssh"], RemoteSSHBackend)
    assert canonical_backend("ssh") == "remote-ssh"
    assert canonical_backend("remote-ssh") == "remote-ssh"


# ── SSH-U4: orphan sweep via a local ledger of remote boxes ──────────────────

def _ledger(work_root):
    import json
    p = backends._ssh_ledger_file(str(work_root))
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def test_launch_records_ledger_cleanup_forgets(be, tmp_path):
    b, _ssh = be
    wr = tmp_path / "wr"
    h = b.launch("box-led", _spec(tmp_path), str(wr))
    led = _ledger(wr)
    assert "box-led" in led
    rec = led["box-led"]
    assert rec["host"] == "user@remote" and rec["remote_pid"] == 9999
    assert rec["remote_workdir"] == "haibox-boxes/box-led" and rec["tunnel_pid"] == 4242

    b.cleanup(h)
    assert "box-led" not in _ledger(wr)  # forgotten only on cleanup, not stop


def test_stop_keeps_ledger_until_cleanup(be, tmp_path):
    b, _ssh = be
    wr = tmp_path / "wr"
    h = b.launch("box-stay", _spec(tmp_path), str(wr))
    b.stop(h)
    assert "box-stay" in _ledger(wr)  # stopped box's remote workdir still needs sweeping


def test_start_run_records_ledger_without_tunnel(be, tmp_path):
    from src.haibox.models import RunSpec
    b, _ssh = be
    wr = tmp_path / "wr"
    b.start_run("run-led", RunSpec(command="pytest -q", host="user@remote",
                                   source_dir=str(tmp_path)), str(wr))
    rec = _ledger(wr)["run-led"]
    assert rec["remote_pid"] == 9999 and rec["tunnel_pid"] is None


def test_sweep_orphans_replays_ledger(be, tmp_path, monkeypatch):
    b, ssh = be
    wr = tmp_path / "wr"
    killed = []
    monkeypatch.setattr(backends, "kill_process_tree", lambda pid, *a, **k: killed.append(pid))
    # two remote boxes recorded by a previous (crashed) daemon
    backends._ssh_ledger_record(str(wr), "box-a",
        {"host": "u@h1", "remote_pid": 11, "remote_workdir": "haibox-boxes/box-a", "tunnel_pid": 100})
    backends._ssh_ledger_record(str(wr), "box-b",
        {"host": "u@h2", "remote_pid": 22, "remote_workdir": "haibox-boxes/box-b", "tunnel_pid": None})

    reaped = b.sweep_orphans(str(wr))
    assert set(reaped) == {"box-a", "box-b"}
    cmds = [(host, c) for host, c in ssh.calls]
    assert ("u@h1", "kill -TERM -11 2>/dev/null || kill -TERM 11 2>/dev/null || true") in cmds
    assert ("u@h1", "rm -rf haibox-boxes/box-a") in cmds
    assert ("u@h2", "rm -rf haibox-boxes/box-b") in cmds
    assert killed == [100]                      # only the box with a local tunnel
    assert _ledger(wr) == {}                     # ledger cleared after the sweep


def test_sweep_orphans_empty_when_no_ledger(be, tmp_path):
    b, _ssh = be
    assert b.sweep_orphans(str(tmp_path / "nope")) == []

"""DockerBackend — argv construction + lifecycle, with `docker` mocked (no daemon).

These prove the Backend Protocol is satisfied and the container is wired correctly
(bind-mount, published port, PORT env, labels, image-required, setup-first) without
needing a Docker daemon. The real-daemon path is covered by the gated smoke test."""

from __future__ import annotations

import subprocess

import pytest

from src.haibox import backends
from src.haibox.backends import DockerBackend, _CONTAINER_PORT
from src.haibox.models import BoxSpec, RunSpec


class FakeDocker:
    """Records every `docker` argv and returns canned results keyed by subcommand."""

    def __init__(self):
        self.calls = []
        self.running = "true"

    def __call__(self, args, *, timeout=None, check=False):
        self.calls.append(list(args))
        sub = args[0]
        if sub == "run":
            return subprocess.CompletedProcess(args, 0, stdout="container-abc123\n", stderr="")
        if sub == "inspect":
            fmt = args[2]
            if "Running" in fmt:
                return subprocess.CompletedProcess(args, 0, stdout=self.running + "\n", stderr="")
            if "ExitCode" in fmt:
                return subprocess.CompletedProcess(args, 0, stdout="0\n", stderr="")
        if sub == "logs":
            return subprocess.CompletedProcess(args, 0, stdout="hello-from-box\n", stderr="")
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")


@pytest.fixture
def fake(monkeypatch):
    f = FakeDocker()
    monkeypatch.setattr(backends, "run_docker", f)
    return f


def _run_argv(fake):
    return next(c for c in fake.calls if c[0] == "run" and "-d" in c)


def test_launch_wires_bind_mount_published_port_env_labels(fake, tmp_path):
    spec = BoxSpec(command="python app.py", source_dir=None, image="python:3.12-slim",
                   port_env="PORT", env={"FOO": "bar"})
    handle = DockerBackend().launch("box-1", spec, str(tmp_path))
    argv = _run_argv(fake)
    s = " ".join(argv)
    assert "-d" in argv and "python:3.12-slim" in argv
    assert "-w" in argv and "/app" in argv
    assert f"-p" in argv and f"127.0.0.1:{handle['port']}:{_CONTAINER_PORT}" in argv  # published port
    assert f"PORT={_CONTAINER_PORT}" in argv          # server binds the INTERNAL port
    assert "FOO=bar" in argv                           # env threaded
    assert "haibox.work_root=" + str(tmp_path) in s    # labels for orphan sweep
    assert "haibox.box_id=box-1" in s
    assert ":/app" in s                                # bind-mount of the workdir
    assert argv[-3:] == ["sh", "-lc", "python app.py"]  # str command runs under sh -lc
    assert argv[argv.index("python:3.12-slim") + 1:] == ["sh", "-lc", "python app.py"]
    assert handle["container"] == "container-abc123"
    assert handle["base_url"] == f"http://127.0.0.1:{handle['port']}"


def test_launch_requires_image(fake, tmp_path):
    spec = BoxSpec(command=["python", "app.py"], image=None)
    with pytest.raises(RuntimeError, match="requires `image`"):
        DockerBackend().launch("box-noimg", spec, str(tmp_path))
    assert not any(c[0] == "run" for c in fake.calls)  # never reached docker run


def test_list_command_is_exec_form_not_shell(fake, tmp_path):
    spec = BoxSpec(command=["python", "app.py"], image="python:3.12-slim")
    DockerBackend().launch("box-2", spec, str(tmp_path))
    argv = _run_argv(fake)
    # exec form: image followed by the literal argv, no `sh -lc`
    i = argv.index("python:3.12-slim")
    assert argv[i + 1:] == ["python", "app.py"]


def test_setup_runs_first_in_throwaway_container(fake, tmp_path):
    spec = BoxSpec(command="python app.py", setup="pip install -r requirements.txt",
                   image="python:3.12-slim")
    DockerBackend().launch("box-3", spec, str(tmp_path))
    setup_calls = [c for c in fake.calls if c[0] == "run" and "--rm" in c]
    assert len(setup_calls) == 1
    assert "pip install -r requirements.txt" in setup_calls[0]
    # setup ran before the detached serve container
    assert fake.calls.index(setup_calls[0]) < fake.calls.index(_run_argv(fake))


def test_setup_failure_raises_with_tail(fake, tmp_path, monkeypatch):
    def failing(args, *, timeout=None, check=False):
        if args[0] == "run" and "--rm" in args:
            return subprocess.CompletedProcess(args, 2, stdout="boom-build-error", stderr="")
        return subprocess.CompletedProcess(args, 0, stdout="cid\n", stderr="")
    monkeypatch.setattr(backends, "run_docker", failing)
    spec = BoxSpec(command="x", setup="false", image="python:3.12-slim")
    with pytest.raises(RuntimeError, match="setup exited 2"):
        DockerBackend().launch("box-4", spec, str(tmp_path))


def test_start_run_has_no_port_or_publish(fake, tmp_path):
    spec = RunSpec(command=["pytest", "-q"], image="python:3.12-slim")
    handle = DockerBackend().start_run("run-1", spec, str(tmp_path))
    argv = _run_argv(fake)
    assert "-p" not in argv                       # ephemeral run: no published port
    assert not any(a.startswith("PORT=") for a in argv)
    assert "port" not in handle and handle["container"] == "container-abc123"


def test_returncode_running_then_exited(fake, tmp_path):
    b = DockerBackend()
    h = b.start_run("run-2", RunSpec(command="x", image="img"), str(tmp_path))
    fake.running = "true"
    assert b.returncode(h) is None       # still running
    fake.running = "false"
    assert b.returncode(h) == 0          # exited -> ExitCode


def test_is_alive_and_lifecycle_calls(fake, tmp_path):
    b = DockerBackend()
    h = b.launch("box-5", BoxSpec(command="x", image="img"), str(tmp_path))
    fake.running = "true"
    assert b.is_alive(h) is True
    assert "hello-from-box" in b.read_log(h)
    b.stop(h)
    assert ["stop", "-t", "5", "container-abc123"] in fake.calls
    b.cleanup(h)
    assert ["rm", "-f", "container-abc123"] in fake.calls


def test_name_is_docker():
    assert DockerBackend().name == "docker"


def test_sweep_orphans_filters_by_work_root_and_force_removes(monkeypatch, tmp_path):
    calls = []

    def fake(args, *, timeout=None, check=False):
        calls.append(list(args))
        if args[0] == "ps":
            return subprocess.CompletedProcess(args, 0, stdout="c1\nc2\n", stderr="")
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
    monkeypatch.setattr(backends, "run_docker", fake)

    swept = DockerBackend().sweep_orphans(str(tmp_path))
    assert swept == ["c1", "c2"]
    ps = next(c for c in calls if c[0] == "ps")
    assert ps == ["ps", "-aq", "--filter", f"label=haibox.work_root={tmp_path}"]
    assert ["rm", "-f", "c1"] in calls and ["rm", "-f", "c2"] in calls


def test_sweep_orphans_empty_when_docker_unavailable(monkeypatch, tmp_path):
    def boom(args, *, timeout=None, check=False):
        raise FileNotFoundError("docker not found")
    monkeypatch.setattr(backends, "run_docker", boom)
    assert DockerBackend().sweep_orphans(str(tmp_path)) == []  # best-effort, no crash

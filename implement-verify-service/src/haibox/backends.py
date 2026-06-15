"""haibox backends — the ONE seam that decides *where* a box runs.

`Backend` is the protocol. `LocalSubprocessBackend` is the only implementation
today (child process on this machine). To scale onto Docker, a remote SSH host,
or a GKE pod later you add a class implementing the same protocol — the control
service, registry, reaper, health prober, and every caller are untouched.

IMPORTANT for non-local backends (see README → "Adding a backend"): `launch`
owns getting the *source* into its environment. The local backend copies a local
dir into `work_root`; a RemoteSSH/Docker backend must transfer source itself
(rsync/scp/COPY) inside `launch` — `work_root` is a local hint, meaningless
remotely. There is deliberately no shared sync primitive yet.

No third-party deps (psutil not required): process-tree kill uses POSIX process
groups (`start_new_session`) and Windows `taskkill /T`. A small on-disk ledger
lets a restarted service reap orphaned child processes (G2).
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from .models import HEALTH_HTTP, HEALTH_TCP, BoxSpec

_DEFAULT_IGNORE = (
    ".git", "node_modules", "__pycache__", ".venv", "venv", ".mypy_cache",
    ".pytest_cache", "dist", "build", ".next", ".turbo", "target",
)
_LEDGER_NAME = ".haibox-ledger.json"
_LOG_NAME = "_haibox.log"
_ledger_lock = threading.Lock()


# ─────────────────────────── helpers (backend-shared) ───────────────────────


def find_free_port(host: str = "127.0.0.1") -> int:
    """OS-assigned free port. Classic bind-0/close — a small TOCTOU window
    remains before the child binds it (acceptable for a local runner; the
    concurrency cap keeps the churn low). See README → Security."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return s.getsockname()[1]


def copy_source(src: str, dst: str | Path) -> None:
    shutil.copytree(src, dst, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns(*_DEFAULT_IGNORE))


def kill_process_tree(pid: int, grace: float = 5.0) -> None:
    """Terminate a process and its children, cross-platform, stdlib-only.
    Idempotent — a dead pid is a no-op."""
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        return
    try:
        pgid = os.getpgid(pid)
    except (ProcessLookupError, PermissionError):
        return
    for sig, wait in ((signal.SIGTERM, grace), (signal.SIGKILL, 0.0)):
        try:
            os.killpg(pgid, sig)
        except (ProcessLookupError, PermissionError):
            return
        if wait <= 0:
            return
        deadline = time.monotonic() + wait
        while time.monotonic() < deadline:
            try:
                os.killpg(pgid, 0)
            except (ProcessLookupError, PermissionError):
                return
            time.sleep(0.1)


def _read_tail(path: str | Path, max_bytes: int = 65536) -> str:
    try:
        with open(path, "rb") as f:
            try:
                f.seek(-max_bytes, os.SEEK_END)
            except OSError:
                f.seek(0)
            return f.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


# ── orphan ledger (G2): survive a service restart without leaking processes ──


def _ledger_file(work_root: str) -> Path:
    return Path(work_root) / _LEDGER_NAME


def _ledger_load(work_root: str) -> dict[str, Any]:
    try:
        return json.loads(_ledger_file(work_root).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _ledger_record(work_root: str, box_id: str, pid: int, workdir: str) -> None:
    with _ledger_lock:
        led = _ledger_load(work_root)
        led[box_id] = {"pid": pid, "workdir": workdir}
        _ledger_file(work_root).write_text(json.dumps(led), encoding="utf-8")


def _ledger_forget(work_root: str, box_id: str) -> None:
    with _ledger_lock:
        led = _ledger_load(work_root)
        if led.pop(box_id, None) is not None:
            _ledger_file(work_root).write_text(json.dumps(led), encoding="utf-8")


def sweep_orphans(work_root: str) -> list[str]:
    """Startup recovery: kill processes + remove workdirs recorded by a previous
    service that died without cleaning up, then clear the ledger. Also removes
    stray box-* dirs. Returns reaped box ids. (G2)"""
    reaped: list[str] = []
    with _ledger_lock:
        led = _ledger_load(work_root)
        for box_id, rec in led.items():
            wd = rec.get("workdir")
            pid = rec.get("pid")
            # N3: only kill if the recorded workdir still exists. A vanished
            # workdir means the box is already gone; killing its (possibly reused
            # after a reboot) pid risks taking out an unrelated process.
            if pid and wd and Path(wd).exists():
                kill_process_tree(int(pid))
            if wd:
                shutil.rmtree(wd, ignore_errors=True)
            reaped.append(box_id)
        try:
            _ledger_file(work_root).unlink()
        except OSError:
            pass
    # stray workdirs with no ledger entry (e.g. a crash mid-write)
    root = Path(work_root)
    if root.exists():
        for child in root.glob("box-*"):
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
    return reaped


# ── remote-ssh ledger (G2 for remote boxes): the per-spec host isn't known at
# startup, so record {host, remote_pid, remote_workdir, tunnel_pid} per box locally
# and replay it to ssh-clean orphans after a crash. ─────────────────────────────
_SSH_LEDGER_NAME = ".haibox-ssh-ledger.json"


def _ssh_ledger_file(work_root: str) -> Path:
    return Path(work_root) / _SSH_LEDGER_NAME


def _ssh_ledger_record(work_root: str, box_id: str, rec: dict) -> None:
    with _ledger_lock:
        path = _ssh_ledger_file(work_root)
        try:
            led = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            led = {}
        led[box_id] = rec
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(led), encoding="utf-8")


def _ssh_ledger_forget(work_root: str, box_id: str) -> None:
    with _ledger_lock:
        path = _ssh_ledger_file(work_root)
        try:
            led = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        if led.pop(box_id, None) is not None:
            path.write_text(json.dumps(led), encoding="utf-8")


def _http_ok(base_url: str, path: str, timeout: float = 2.0) -> bool:
    import httpx
    url = base_url.rstrip("/") + "/" + path.lstrip("/")
    try:
        return httpx.get(url, timeout=timeout).status_code < 500
    except Exception:
        return False


def _tcp_ok(host: str, port: int, timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def wait_healthy(base_url: str, spec: BoxSpec, is_alive, port: int,
                 poll: float = 0.25, _clock=time.monotonic, _sleep=time.sleep) -> bool:
    """Poll the target until ready, the process dies, or timeout. Transport-
    agnostic, which is exactly why readiness lives here and not in a backend."""
    deadline = _clock() + spec.readiness_timeout
    while _clock() < deadline:
        if not is_alive():
            return False
        if spec.health_type == HEALTH_HTTP and _http_ok(base_url, spec.health_path):
            return True
        if spec.health_type == HEALTH_TCP and _tcp_ok("127.0.0.1", port):
            return True
        _sleep(poll)
    return False


# ─────────────────────────────── protocol ───────────────────────────────────


@runtime_checkable
class Backend(Protocol):
    """Where a box runs. `launch` owns provisioning AND source transfer for its
    environment; readiness is handled for it by `wait_healthy`."""

    name: str

    def launch(self, box_id: str, spec: BoxSpec, work_root: str) -> dict[str, Any]:
        """Provision + (sync source) + start. Return a JSON-able handle that MUST
        include `base_url` and `port`. Raise on setup/provision failure (the
        message should carry diagnostics — it surfaces as the box error)."""
        ...

    def is_alive(self, handle: dict[str, Any]) -> bool: ...
    def stop(self, handle: dict[str, Any]) -> None:
        """Kill the process/container/pod, KEEP its artifacts (logs). Idempotent."""
        ...

    def cleanup(self, handle: dict[str, Any]) -> None:
        """Remove the workspace/artifacts. Idempotent."""
        ...

    def read_log(self, handle: dict[str, Any], max_bytes: int = 65536) -> str:
        """Return up to the last max_bytes of the target's combined stdout/stderr."""
        ...

    def terminate(self, handle: dict[str, Any]) -> None:
        """Convenience: stop + cleanup."""
        ...

    def sweep_orphans(self, work_root: str) -> list[str]:
        """Reclaim boxes a previous (dead) haiboxd left behind for THIS work_root,
        in whatever form this backend uses (processes / containers / pods). Called
        once at startup. Returns the reclaimed ids."""
        ...

    def validate_spec(self, spec) -> None:
        """Raise ValueError if `spec` can't run on THIS backend (e.g. docker needs
        an image, a remote backend needs a host). Each backend owns its own
        preconditions so the API can 422 early — the generic resolver never grows a
        per-backend `if`."""
        ...


# ───────────────────────── local subprocess backend ─────────────────────────


class LocalSubprocessBackend:
    """Runs each box as a child process in a temp workdir on this machine."""

    name = "local-subprocess"

    def __init__(self, host: str = "127.0.0.1") -> None:
        self.host = host
        self._procs: dict[int, subprocess.Popen] = {}
        self._procs_lock = threading.Lock()

    def _run_setup(self, setup, workdir: Path, env: dict, log_file, timeout: float) -> None:
        """Run the optional build/deps step; raise with the log tail on failure
        so the caller can see WHY (G1/G5) without spelunking files. Bounded by
        `timeout` so a hanging build can't block launch forever (N2)."""
        try:
            rc = subprocess.run(
                setup, cwd=str(workdir), env=env, shell=isinstance(setup, str),
                stdout=log_file, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                timeout=timeout,
            ).returncode
        except subprocess.TimeoutExpired:
            log_file.flush()
            tail = _read_tail(workdir / _LOG_NAME, 4000)
            raise RuntimeError(f"setup exceeded {timeout}s timeout. log tail:\n{tail}")
        log_file.flush()
        if rc != 0:
            tail = _read_tail(workdir / _LOG_NAME, 4000)
            raise RuntimeError(f"setup exited {rc}. log tail:\n{tail}")

    def _spawn(self, id_: str, spec, work_root: str, port: int | None) -> dict[str, Any]:
        """Shared by serve (launch) and run (start_run): prepare a workdir, copy
        source, run optional setup, start the command. `port` injects port_env
        (serve) or is None (run — an ephemeral command needs no port)."""
        workdir = Path(work_root) / id_
        workdir.mkdir(parents=True, exist_ok=True)
        if spec.source_dir:
            copy_source(spec.source_dir, workdir)

        env = {**os.environ, **spec.env}
        if port is not None:
            env[spec.port_env] = str(port)
        log_path = workdir / _LOG_NAME

        setup_error: Exception | None = None
        with open(log_path, "wb") as setup_log:
            if spec.setup:
                try:
                    self._run_setup(spec.setup, workdir, env, setup_log, spec.setup_timeout)
                except RuntimeError as exc:
                    setup_error = exc  # defer cleanup until the log handle is closed
        if setup_error is not None:
            shutil.rmtree(workdir, ignore_errors=True)  # log handle closed -> clean on Windows
            raise setup_error

        log_file = open(log_path, "ab")  # append command output after any setup output
        popen_kwargs: dict[str, Any] = dict(
            cwd=str(workdir), env=env, stdout=log_file, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, shell=isinstance(spec.command, str),
        )
        if sys.platform == "win32":
            popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            popen_kwargs["start_new_session"] = True

        proc = subprocess.Popen(spec.command, **popen_kwargs)  # noqa: S603 — operator-supplied
        log_file.close()  # N1: child inherited its own fd; don't leak the parent's
        with self._procs_lock:
            self._procs[proc.pid] = proc
        _ledger_record(work_root, id_, proc.pid, str(workdir))  # G2
        return {"pid": proc.pid, "workdir": str(workdir), "work_root": work_root,
                "log_path": str(log_path), "id": id_}

    def launch(self, box_id: str, spec: BoxSpec, work_root: str) -> dict[str, Any]:
        port = find_free_port(self.host)
        handle = self._spawn(box_id, spec, work_root, port)
        handle["base_url"] = f"http://{self.host}:{port}"
        handle["port"] = port
        return handle

    def start_run(self, run_id: str, spec, work_root: str) -> dict[str, Any]:
        """Start an ephemeral command (no port). Returns a handle; the caller
        polls `returncode` for completion and `read_log` for output."""
        return self._spawn(run_id, spec, work_root, port=None)

    def returncode(self, handle: dict[str, Any]) -> int | None:
        """Exit code if the process has finished, else None (still running)."""
        pid = handle.get("pid")
        with self._procs_lock:
            proc = self._procs.get(pid) if pid else None
        return proc.poll() if proc is not None else None

    def is_alive(self, handle: dict[str, Any]) -> bool:
        pid = handle.get("pid")
        if not pid:
            return False
        with self._procs_lock:
            proc = self._procs.get(pid)
        if proc is not None:
            return proc.poll() is None
        try:
            os.kill(pid, 0)
            return True
        except PermissionError:
            return True
        except OSError:
            return False

    def stop(self, handle: dict[str, Any]) -> None:
        pid = handle.get("pid")
        if pid:
            kill_process_tree(int(pid))
            with self._procs_lock:
                proc = self._procs.pop(pid, None)
            if proc is not None:
                try:
                    proc.wait(timeout=5)
                except Exception:
                    pass
        if handle.get("work_root") and handle.get("id"):
            _ledger_forget(handle["work_root"], handle["id"])  # G2

    def cleanup(self, handle: dict[str, Any]) -> None:
        workdir = handle.get("workdir")
        if workdir:
            shutil.rmtree(workdir, ignore_errors=True)

    def read_log(self, handle: dict[str, Any], max_bytes: int = 65536) -> str:
        return _read_tail(handle.get("log_path", ""), max_bytes)

    def terminate(self, handle: dict[str, Any]) -> None:
        self.stop(handle)
        self.cleanup(handle)

    def sweep_orphans(self, work_root: str) -> list[str]:
        return sweep_orphans(work_root)  # the pid-ledger sweep (module fn)

    def validate_spec(self, spec) -> None:
        return None  # anything that runs on this host is fine


# ─────────────────────────────── docker backend ─────────────────────────────

# The box's server binds this port INSIDE the container (via port_env); we publish
# a free HOST port to it. Constant + per-container network namespace, so concurrent
# boxes don't collide on it.
_CONTAINER_PORT = 8080
_LABEL_ROOT = "haibox.work_root"
_LABEL_ID = "haibox.box_id"


def run_docker(args: list[str], *, timeout: float | None = None,
               check: bool = False) -> subprocess.CompletedProcess:
    """One chokepoint for every `docker` invocation — so tests monkeypatch HERE and
    the whole backend is exercised without a daemon."""
    return subprocess.run(["docker", *args], capture_output=True, text=True,
                          timeout=timeout, check=check)


def docker_sweep_orphans(work_root: str) -> list[str]:
    """G2 for Docker: a previous haiboxd may have died leaving containers running.
    Find containers labeled with THIS work_root and force-remove them. Returns the
    swept container ids. Best-effort (no daemon / docker missing -> [])."""
    try:
        res = run_docker(["ps", "-aq", "--filter", f"label={_LABEL_ROOT}={work_root}"])
    except Exception:
        return []
    if res.returncode != 0:
        return []
    swept = []
    for cid in (x for x in res.stdout.split() if x):
        run_docker(["rm", "-f", cid])
        swept.append(cid)
    return swept


def _as_cmd(command, setup=False) -> list[str]:
    """Container argv for a BoxSpec.command/setup. A str runs under `sh -lc` (shell
    semantics, like the local backend's shell=True); a list runs as exec-form argv."""
    if isinstance(command, str):
        return ["sh", "-lc", command]
    return list(command)


class DockerBackend:
    """Runs each box as a Docker container (Gary: image REQUIRED, bind-mount the
    workdir, same-machine daemon). Satisfies the same Backend Protocol as
    LocalSubprocessBackend — the control service, API, reaper, and callers are
    untouched. CLI-based (subprocess to `docker`); no docker-py dependency."""

    name = "docker"

    def __init__(self, host: str = "127.0.0.1") -> None:
        self.host = host

    # ── workdir + setup (mirror the local setup/spawn split; honor setup_timeout)
    def _prepare_workdir(self, id_: str, spec, work_root: str) -> Path:
        workdir = Path(work_root) / id_
        workdir.mkdir(parents=True, exist_ok=True)
        if spec.source_dir:
            copy_source(spec.source_dir, workdir)
        return workdir

    def _run_setup(self, spec, workdir: Path) -> None:
        """Run the optional build/deps step in a throwaway container against the
        bind-mounted workdir (its artifacts persist into the serve container).
        Bounded by setup_timeout (N2); raises with the log tail on failure."""
        mount = f"{workdir.resolve().as_posix()}:/app"
        args = ["run", "--rm", "-v", mount, "-w", "/app",
                *self._env_args(spec, port=None), spec.image, *_as_cmd(spec.setup, setup=True)]
        try:
            res = run_docker(args, timeout=spec.setup_timeout)
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"setup exceeded {spec.setup_timeout}s timeout (docker)")
        if res.returncode != 0:
            tail = (res.stdout + res.stderr)[-4000:]
            raise RuntimeError(f"setup exited {res.returncode} (docker). log tail:\n{tail}")

    def _env_args(self, spec, port: int | None) -> list[str]:
        args: list[str] = []
        env = dict(spec.env)
        if port is not None:
            env[spec.port_env] = str(_CONTAINER_PORT)  # server binds the INTERNAL port
        for k, v in env.items():
            args += ["-e", f"{k}={v}"]
        return args

    def _docker_create_run(self, id_: str, spec, work_root: str, *, port: int | None) -> dict[str, Any]:
        if not spec.image:
            raise RuntimeError("docker backend requires `image` on the spec (none provided)")
        workdir = self._prepare_workdir(id_, spec, work_root)
        if spec.setup:
            self._run_setup(spec, workdir)

        mount = f"{workdir.resolve().as_posix()}:/app"
        args = ["run", "-d", "-v", mount, "-w", "/app",
                "--label", f"{_LABEL_ROOT}={work_root}", "--label", f"{_LABEL_ID}={id_}",
                *self._env_args(spec, port)]
        if port is not None:  # serve: publish a free host port to the container's port
            args += ["-p", f"{self.host}:{port}:{_CONTAINER_PORT}"]
        args += [spec.image, *_as_cmd(spec.command)]

        res = run_docker(args)
        if res.returncode != 0:
            shutil.rmtree(workdir, ignore_errors=True)
            raise RuntimeError(f"docker run failed (rc={res.returncode}): {(res.stdout + res.stderr)[-2000:]}")
        container = res.stdout.strip()
        return {"container": container, "workdir": str(workdir), "work_root": work_root, "id": id_}

    def launch(self, box_id: str, spec: BoxSpec, work_root: str) -> dict[str, Any]:
        port = find_free_port(self.host)
        handle = self._docker_create_run(box_id, spec, work_root, port=port)
        handle["base_url"] = f"http://{self.host}:{port}"
        handle["port"] = port
        return handle

    def start_run(self, run_id: str, spec, work_root: str) -> dict[str, Any]:
        """Ephemeral container (no port); caller polls returncode + read_log."""
        return self._docker_create_run(run_id, spec, work_root, port=None)

    def _inspect(self, container: str, fmt: str) -> str | None:
        if not container:
            return None
        res = run_docker(["inspect", "-f", fmt, container])
        return res.stdout.strip() if res.returncode == 0 else None

    def returncode(self, handle: dict[str, Any]) -> int | None:
        container = handle.get("container")
        running = self._inspect(container, "{{.State.Running}}")
        if running is None:
            return None  # gone/unknown — caller treats as not-finished here
        if running == "true":
            return None
        code = self._inspect(container, "{{.State.ExitCode}}")
        try:
            return int(code) if code is not None else None
        except ValueError:
            return None

    def is_alive(self, handle: dict[str, Any]) -> bool:
        return self._inspect(handle.get("container"), "{{.State.Running}}") == "true"

    def stop(self, handle: dict[str, Any]) -> None:
        """Stop the container but KEEP it (logs stay readable). Idempotent."""
        container = handle.get("container")
        if container:
            run_docker(["stop", "-t", "5", container])  # best-effort

    def cleanup(self, handle: dict[str, Any]) -> None:
        container = handle.get("container")
        if container:
            run_docker(["rm", "-f", container])  # best-effort, idempotent
        workdir = handle.get("workdir")
        if workdir:
            shutil.rmtree(workdir, ignore_errors=True)

    def read_log(self, handle: dict[str, Any], max_bytes: int = 65536) -> str:
        container = handle.get("container")
        if not container:
            return ""
        res = run_docker(["logs", container])
        return (res.stdout + res.stderr)[-max_bytes:] if res.returncode == 0 else ""

    def terminate(self, handle: dict[str, Any]) -> None:
        self.stop(handle)
        self.cleanup(handle)

    def sweep_orphans(self, work_root: str) -> list[str]:
        return docker_sweep_orphans(work_root)

    def validate_spec(self, spec) -> None:
        if not getattr(spec, "image", None):
            raise ValueError("backend 'docker' requires an `image`")


# ─────────────────────────────── remote-ssh backend ─────────────────────────

_SSH_OPTS = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
             "-o", "ConnectTimeout=10"]
_REMOTE_ROOT = "haibox-boxes"   # relative to the remote home dir
_REMOTE_FREE_PORT = (
    "python3 -c 'import socket;s=socket.socket();s.bind((\"127.0.0.1\",0));"
    "print(s.getsockname()[1]);s.close()'"
)


def run_ssh(host: str, remote_cmd: str, *, timeout: float | None = None) -> subprocess.CompletedProcess:
    """One chokepoint for `ssh <host> <remote_cmd>` — tests monkeypatch HERE and the
    whole backend is exercised without a live host."""
    return subprocess.run(["ssh", *_SSH_OPTS, host, remote_cmd],
                          capture_output=True, text=True, timeout=timeout)


def run_scp(local_src: str, host: str, remote_dir: str,
            *, timeout: float | None = None) -> subprocess.CompletedProcess:
    """Copy a local dir's CONTENTS to host:remote_dir (rsync is absent here)."""
    return subprocess.run(["scp", *_SSH_OPTS, "-r", f"{local_src}/.", f"{host}:{remote_dir}"],
                          capture_output=True, text=True, timeout=timeout)


class RemoteSSHBackend:
    """Runs each box on a REMOTE host over SSH (Gary: per-spec `host`, SSH-tunnel so
    base_url stays loopback). Satisfies the same Backend Protocol — control service,
    registry, reaper, health prober, callers untouched. CLI-based via run_ssh/run_scp;
    no paramiko."""

    name = "remote-ssh"

    def __init__(self, host_local: str = "127.0.0.1") -> None:
        self.host_local = host_local
        self._tunnels: dict[int, subprocess.Popen] = {}   # local tunnel pid -> Popen
        self._lock = threading.Lock()

    # ── helpers ──────────────────────────────────────────────────────────
    def _cmd_str(self, command) -> str:
        return command if isinstance(command, str) else shlex.join(command)

    def _remote_free_port(self, host: str) -> int:
        res = run_ssh(host, _REMOTE_FREE_PORT)
        if res.returncode != 0 or not res.stdout.strip().isdigit():
            raise RuntimeError(f"could not allocate a remote port on {host}: {(res.stdout + res.stderr)[-300:]}")
        return int(res.stdout.strip())

    def _open_tunnel(self, host: str, lport: int, rport: int) -> subprocess.Popen:
        """A LOCAL `ssh -N -L 127.0.0.1:lport:127.0.0.1:rport host` forwarding process,
        so base_url is loopback and health-checkable from haiboxd."""
        argv = ["ssh", *_SSH_OPTS, "-N", "-L",
                f"127.0.0.1:{lport}:127.0.0.1:{rport}", host]
        kw: dict[str, Any] = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL,
                              "stdin": subprocess.DEVNULL}
        if sys.platform == "win32":
            kw["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kw["start_new_session"] = True
        proc = subprocess.Popen(argv, **kw)
        with self._lock:
            self._tunnels[proc.pid] = proc
        return proc

    def _kill_tunnel(self, handle: dict[str, Any]) -> None:
        pid = handle.get("tunnel_pid")
        if not pid:
            return
        with self._lock:
            proc = self._tunnels.pop(pid, None)
        if proc is not None:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:
                pass
        else:
            kill_process_tree(int(pid))  # restart-recovered: kill the local tunnel by pid

    # ── lifecycle ────────────────────────────────────────────────────────
    def validate_spec(self, spec) -> None:
        if not getattr(spec, "host", None):
            raise ValueError("backend 'remote-ssh' requires a `host` (user@host[:port])")

    def _provision(self, id_: str, spec, *, port: bool, capture_rc: bool = False) -> dict[str, Any]:
        if not getattr(spec, "host", None):
            raise RuntimeError("remote-ssh backend requires `host` on the spec (none provided)")
        host = spec.host
        wd = f"{_REMOTE_ROOT}/{id_}"
        log = f"{wd}/_haibox.log"

        mk = run_ssh(host, f"mkdir -p {wd}")
        if mk.returncode != 0:
            raise RuntimeError(f"remote mkdir failed on {host}: {(mk.stdout + mk.stderr)[-300:]}")
        if spec.source_dir:
            cp = run_scp(spec.source_dir, host, wd)
            if cp.returncode != 0:
                raise RuntimeError(f"scp source -> {host}:{wd} failed: {(cp.stdout + cp.stderr)[-300:]}")
        if spec.setup:
            su = run_ssh(host, f"cd {wd} && {self._cmd_str(spec.setup)}", timeout=spec.setup_timeout)
            if su.returncode != 0:
                raise RuntimeError(f"remote setup exited {su.returncode}: {(su.stdout + su.stderr)[-400:]}")

        rport = self._remote_free_port(host) if port else None
        port_prefix = f"{spec.port_env}={rport} " if port else ""
        # run-mode captures the exit code to a remote rc file the moment the command
        # exits (serve never exits, so no rc). setsid -> the child leads its own
        # process group (pgid == pid), so stop can `kill -- -<pid>` the whole tree.
        inner = self._cmd_str(spec.command)
        if capture_rc:
            inner = f"{inner}; echo $? > _haibox_rc"
        start = (f"cd {wd} && {port_prefix}setsid nohup sh -lc {shlex.quote(inner)} "
                 f"> {log} 2>&1 & echo $!")
        st = run_ssh(host, start)
        if st.returncode != 0 or not st.stdout.strip().isdigit():
            raise RuntimeError(f"remote start failed on {host}: {(st.stdout + st.stderr)[-300:]}")
        remote_pid = int(st.stdout.strip())
        return {"host": host, "remote_pid": remote_pid, "remote_workdir": wd,
                "remote_log": log, "remote_port": rport, "id": id_}

    def launch(self, box_id: str, spec: BoxSpec, work_root: str) -> dict[str, Any]:
        handle = self._provision(box_id, spec, port=True)
        lport = find_free_port(self.host_local)
        tunnel = self._open_tunnel(handle["host"], lport, handle["remote_port"])
        handle.update(base_url=f"http://{self.host_local}:{lport}", port=lport,
                      tunnel_pid=tunnel.pid, work_root=work_root)
        self._ledger_record(work_root, box_id, handle)  # G2: drive the remote sweep
        return handle

    def start_run(self, run_id: str, spec, work_root: str) -> dict[str, Any]:
        # ephemeral: no port/tunnel; capture the exit code to a remote rc file.
        handle = self._provision(run_id, spec, port=False, capture_rc=True)
        handle["work_root"] = work_root
        self._ledger_record(work_root, run_id, handle)  # G2
        return handle

    def _ledger_record(self, work_root: str, id_: str, handle: dict[str, Any]) -> None:
        _ssh_ledger_record(work_root, id_, {
            "host": handle.get("host"), "remote_pid": handle.get("remote_pid"),
            "remote_workdir": handle.get("remote_workdir"),
            "tunnel_pid": handle.get("tunnel_pid")})

    def is_alive(self, handle: dict[str, Any]) -> bool:
        host, pid = handle.get("host"), handle.get("remote_pid")
        if not host or not pid:
            return False
        return run_ssh(host, f"kill -0 {pid}").returncode == 0

    def returncode(self, handle: dict[str, Any]) -> int | None:
        # run-mode reads the rc file the wrapper writes on exit (SSH-U3).
        host, wd = handle.get("host"), handle.get("remote_workdir")
        if not host or not wd:
            return None
        res = run_ssh(host, f"cat {wd}/_haibox_rc 2>/dev/null || true")
        out = res.stdout.strip()
        return int(out) if out.isdigit() else None

    def stop(self, handle: dict[str, Any]) -> None:
        host, pid = handle.get("host"), handle.get("remote_pid")
        if host and pid:
            run_ssh(host, f"kill -TERM -{pid} 2>/dev/null || kill -TERM {pid} 2>/dev/null || true")
        self._kill_tunnel(handle)

    def cleanup(self, handle: dict[str, Any]) -> None:
        host, wd = handle.get("host"), handle.get("remote_workdir")
        if host and wd:
            run_ssh(host, f"rm -rf {wd}")
        self._kill_tunnel(handle)
        # forget on cleanup, not stop: the remote workdir is only reachable via the
        # ledger, so a stopped-but-not-cleaned box must stay swept-able. (G2)
        if handle.get("work_root") and handle.get("id"):
            _ssh_ledger_forget(handle["work_root"], handle["id"])

    def read_log(self, handle: dict[str, Any], max_bytes: int = 65536) -> str:
        host, log = handle.get("host"), handle.get("remote_log")
        if not host or not log:
            return ""
        res = run_ssh(host, f"tail -c {max_bytes} {log} 2>/dev/null || true")
        return res.stdout if res.returncode == 0 else ""

    def terminate(self, handle: dict[str, Any]) -> None:
        self.stop(handle)
        self.cleanup(handle)

    def sweep_orphans(self, work_root: str) -> list[str]:
        """Startup recovery for remote boxes: replay the local ledger — ssh-kill each
        remote process group, rm -rf its remote workdir, and kill the local tunnel —
        then clear the ledger. The per-spec host lives only in the ledger, so this is
        the sole way to reach a crashed daemon's remote boxes. (G2)"""
        reaped: list[str] = []
        with _ledger_lock:
            path = _ssh_ledger_file(work_root)
            try:
                led = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                led = {}
            for box_id, rec in led.items():
                host = rec.get("host")
                pid = rec.get("remote_pid")
                wd = rec.get("remote_workdir")
                if host and pid:
                    run_ssh(host, f"kill -TERM -{pid} 2>/dev/null || kill -TERM {pid} 2>/dev/null || true")
                if host and wd:
                    run_ssh(host, f"rm -rf {wd}")
                tunnel_pid = rec.get("tunnel_pid")
                if tunnel_pid:
                    kill_process_tree(int(tunnel_pid))  # local forwarder left by the dead daemon
                reaped.append(box_id)
            try:
                path.unlink()
            except OSError:
                pass
        return reaped


# ───────────────────────── backend registry (one place) ─────────────────────
# A new backend = implement the Protocol above + ONE register_backend(...) line.
# Nothing else (the service factory, alias resolution, validation) is edited.

_BACKEND_REGISTRY: dict[str, dict] = {}


def register_backend(name: str, factory, aliases: tuple[str, ...] = ()) -> None:
    """Register a backend under its canonical `name` (+ optional aliases).
    `factory` is a zero-arg callable returning a fresh backend instance."""
    _BACKEND_REGISTRY[name] = {"factory": factory, "aliases": tuple(aliases)}


def backend_aliases() -> dict[str, str]:
    """Every accepted name/alias -> canonical name (built from the registry)."""
    out: dict[str, str] = {}
    for name, entry in _BACKEND_REGISTRY.items():
        out[name] = name
        for alias in entry["aliases"]:
            out[alias] = name
    return out


def build_backends() -> dict[str, "Backend"]:
    """Instantiate one of every registered backend, keyed by canonical name."""
    return {name: entry["factory"]() for name, entry in _BACKEND_REGISTRY.items()}


register_backend("local-subprocess", LocalSubprocessBackend, aliases=("local",))
register_backend("docker", DockerBackend)
register_backend("remote-ssh", RemoteSSHBackend, aliases=("ssh", "remote"))

"""Launch EVERY entrypoint for real, post-restructure (src/entrypoints/ + clean break).

Each is invoked the canonical way — `python -m src.entrypoints.<name>` — exactly as
the startup scripts / Docker now call them. Lifecycle is harness-owned: every server
is booted in its own process group, health-checked, and ALWAYS killed in a finally
(force tree-kill), so nothing is left serving.

  HTTP servers  run_api · main · mock_server · debug_api  -> boot, GET /health == 200, kill
                (run_api takes --port; main takes API_HOST/API_PORT; mock_server + debug_api
                 hardcode :8000, so they run SEQUENTIALLY, each after the port is free)
  worker        debug_worker                              -> boot, assert still alive after 4s, kill
  SDK libs      run · run_simple                          -> import-smoke via -m package path
                (their __main__ runs LLM/network SDK demos — not services; importing proves
                 the -m path + src.* imports resolve, which is the launch contract)
"""
import contextlib
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

REPO = "D:/Work/Gary/standards-extractor"
sys.path.insert(0, REPO)
VENV_PY = REPO + "/.venv/Scripts/python.exe"

WORK = tempfile.mkdtemp(prefix="entrypoint-e2e-")
BASE_ENV = {
    **os.environ,
    "PYTHONUTF8": "1", "PYTHONUNBUFFERED": "1",
    "STANDARDS_API_KEY": "e2e-test-key",
    "API_WORKSPACE_DIR": WORK,
    "JOBS_DB_PATH": WORK + "/jobs.db",
}
PASS, FAIL = [], []


def chk(label, cond, detail=""):
    (PASS if cond else FAIL).append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  — {detail}" if detail and not cond else ""))


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def port_free(p):
    with socket.socket() as s:
        s.settimeout(0.4)
        return s.connect_ex(("127.0.0.1", int(p))) != 0


def http_status(url, timeout=4):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return None


def _popen(argv, env):
    kw = dict(cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if sys.platform == "win32":
        kw["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True
    return subprocess.Popen(argv, **kw)


def _kill(proc):
    if proc.poll() is not None:
        return
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    with contextlib.suppress(Exception):
        proc.wait(timeout=10)


def boot_http(name, module, port, *, env_extra=None, health="/health", timeout=40):
    """Boot an HTTP entrypoint via -m, assert /health is reachable, always kill."""
    if not port_free(port):
        chk(f"{name}: port {port} free before boot", False, f"{port} already in use")
        return
    env = {**BASE_ENV, **(env_extra or {})}
    argv = [VENV_PY, "-m", module]
    if name == "run_api":
        argv += ["--host", "127.0.0.1", "--port", str(port)]
    proc = _popen(argv, env)
    try:
        url = f"http://127.0.0.1:{port}{health}"
        deadline = time.time() + timeout
        status = None
        while time.time() < deadline:
            if proc.poll() is not None:
                break  # process died
            status = http_status(url)
            if status is not None:
                break
            time.sleep(0.5)
        alive = proc.poll() is None
        ok = alive and status == 200
        detail = ""
        if not ok:
            tail = ""
            with contextlib.suppress(Exception):
                _kill(proc)
                tail = (proc.stdout.read() or "")[-600:] if proc.stdout else ""
            detail = f"alive={alive} status={status} log_tail={tail!r}"
        chk(f"{name}: boots via -m {module} and serves {health} (200)", ok, detail)
    finally:
        _kill(proc)
        for _ in range(20):
            if port_free(port):
                break
            time.sleep(0.3)


def boot_worker(name, module, *, alive_after=4.0):
    """Boot a non-HTTP worker via -m, assert it stays up (didn't crash), always kill."""
    proc = _popen([VENV_PY, "-m", module], BASE_ENV)
    try:
        time.sleep(alive_after)
        alive = proc.poll() is None
        detail = ""
        if not alive:
            tail = ""
            with contextlib.suppress(Exception):
                tail = (proc.stdout.read() or "")[-600:] if proc.stdout else ""
            detail = f"exited rc={proc.returncode} log_tail={tail!r}"
        chk(f"{name}: boots via -m {module} and stays alive {alive_after}s", alive, detail)
    finally:
        _kill(proc)


def import_smoke(name, module):
    proc = subprocess.run([VENV_PY, "-c", f"import {module}"],
                          cwd=REPO, env=BASE_ENV, capture_output=True, text=True, timeout=120)
    chk(f"{name}: imports cleanly via {module}", proc.returncode == 0, proc.stderr[-600:])


def main():
    print(f"=== entrypoint launch e2e (workspace={WORK}) ===\n")
    print("--- HTTP servers (boot -> /health -> kill) ---")
    boot_http("run_api", "src.entrypoints.run_api", free_port())
    boot_http("main", "src.entrypoints.main", (p := free_port()),
              env_extra={"API_HOST": "127.0.0.1", "API_PORT": str(p)})
    # mock_server + debug_api hardcode :8000 — sequential, after 8000 is free
    boot_http("mock_server", "src.entrypoints.mock_server", 8000)
    boot_http("debug_api", "src.entrypoints.debug_api", 8000)

    print("\n--- worker (boot -> alive -> kill) ---")
    boot_worker("debug_worker", "src.entrypoints.debug_worker")

    print("\n--- SDK libs (import-smoke via -m path) ---")
    import_smoke("run", "src.entrypoints.run")
    import_smoke("run_simple", "src.entrypoints.run_simple")

    print(f"\n=== RESULT: {len(PASS)} passed, {len(FAIL)} failed ===")
    for f in FAIL:
        print("  FAILED:", f)
    print("ENTRYPOINTS_OK" if not FAIL else "ENTRYPOINTS_FAIL")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    finally:
        import shutil
        shutil.rmtree(WORK, ignore_errors=True)

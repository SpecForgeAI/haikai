"""RemoteSSHBackend, end-to-end over a REAL sshd — gated, skips cleanly.

Boots one haiboxd (both backends registered) and serves a box with
backend=remote-ssh, host=127.0.0.1 — i.e. the box runs on the "remote" host
over SSH, with a local-forward tunnel making base_url loopback. Asserts the box
is routed to remote-ssh, is healthy + serves HTTP through the tunnel, a remote
workdir exists, and release tears the remote workdir + tunnel down.

GATE: if no sshd answers on 127.0.0.1:22 (BatchMode, key auth), print
SSH_E2E_SKIP and exit 0 — exactly like the docker smoke skips with no docker.
The mocked unit suite (tests/test_haibox_remote_ssh_backend.py) covers the
command construction; this proves the live path when an sshd is present.

Harness-owned lifecycle: finally releases the box and shuts haiboxd down.
"""
import contextlib
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, "D:/Work/Gary/standards-extractor")

HAIBOX_PORT = "8789"
KEY = "ssh-e2e-key"
SSH_HOST = "127.0.0.1"
VENV_PY = "D:/Work/Gary/standards-extractor/.venv/Scripts/python.exe"
os.environ["HAIBOX_URL"] = f"http://127.0.0.1:{HAIBOX_PORT}"
os.environ["STANDARDS_API_KEY"] = KEY

PASS, FAIL = [], []

# A remote-side python3 http server binding the haibox-assigned $PORT on loopback.
REMOTE_CMD = ("python3 -c \"import os,http.server,socketserver;"
              "p=int(os.environ['PORT']);"
              "socketserver.TCPServer(('127.0.0.1',p),"
              "http.server.SimpleHTTPRequestHandler).serve_forever()\"")


def chk(label, cond):
    (PASS if cond else FAIL).append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}")


def _sshd_reachable():
    opts = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
            "-o", "ConnectTimeout=5"]
    try:
        r = subprocess.run(["ssh", *opts, SSH_HOST, "echo SSH_OK && command -v python3"],
                           capture_output=True, text=True, timeout=20)
    except Exception:
        return False
    return r.returncode == 0 and "SSH_OK" in r.stdout and "python3" in r.stdout


def _port_free(p):
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", int(p))) != 0


def _force_kill(proc):
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)


def _http(url, timeout=5):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status
    except Exception:
        return None


def _remote_dir_exists(box_id):
    opts = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5"]
    r = subprocess.run(["ssh", *opts, SSH_HOST,
                        f"test -d haibox-boxes/{box_id} && echo YES || echo NO"],
                       capture_output=True, text=True)
    return "YES" in r.stdout


@contextlib.contextmanager
def haiboxd():
    from src.haibox.client import HaiboxClient
    env = {**os.environ, "HAIBOX_HOST": "127.0.0.1", "HAIBOX_PORT": HAIBOX_PORT,
           "STANDARDS_API_KEY": KEY}  # default backend = local; remote-ssh registered
    kw = {"cwd": "D:/Work/Gary/standards-extractor", "env": env,
          "stdout": subprocess.DEVNULL, "stderr": subprocess.STDOUT}
    if sys.platform == "win32":
        kw["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True
    proc = subprocess.Popen([VENV_PY, "-m", "src.haibox.service"], **kw)
    try:
        for _ in range(60):
            try:
                if HaiboxClient().healthz().get("status") == "ok":
                    break
            except Exception:
                pass
            time.sleep(0.5)
        else:
            _force_kill(proc)
            raise RuntimeError("haiboxd not healthy")
        yield
    finally:
        try:
            if sys.platform == "win32":
                proc.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            proc.wait(timeout=20)
        except Exception:
            _force_kill(proc)
        for _ in range(10):
            if _port_free(HAIBOX_PORT):
                break
            time.sleep(0.5)
        print("  haiboxd stopped; port free:", _port_free(HAIBOX_PORT))


def run():
    from src.haibox.client import HaiboxClient
    hb = HaiboxClient()
    hz = hb.healthz()
    print("  control plane:", hz)
    chk("remote-ssh backend registered", "remote-ssh" in set(hz.get("backends", [])))

    print("\n=== serve a box over SSH (backend=remote-ssh, host=127.0.0.1) ===")
    box = hb.serve(REMOTE_CMD, backend="remote-ssh", host=SSH_HOST,
                   health_path="/", readiness_timeout=60.0)
    bid = box["box_id"]
    print(f"  box={bid} backend={box.get('backend')} url={box['base_url']}")
    chk("box routed to remote-ssh", box.get("backend") == "remote-ssh")
    chk("base_url is loopback via tunnel", box["base_url"].startswith("http://127.0.0.1:"))
    chk("box healthy + serving through the tunnel", _http(box["base_url"] + "/") == 200)
    chk("remote workdir exists on the host", _remote_dir_exists(bid))

    print("\n=== release -> remote workdir + tunnel torn down ===")
    hb.release(bid)
    time.sleep(1.0)
    chk("remote workdir removed after release", not _remote_dir_exists(bid))


def main():
    if not _sshd_reachable():
        print("  no sshd reachable on 127.0.0.1 with key auth + python3 — skipping live e2e")
        print("SSH_E2E_SKIP")
        return 0
    with haiboxd():
        run()
    print(f"\n=== RESULT: {len(PASS)} passed, {len(FAIL)} failed ===")
    for f in FAIL:
        print("  FAILED:", f)
    print("SSH_E2E_OK" if not FAIL else "SSH_E2E_FAIL")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())

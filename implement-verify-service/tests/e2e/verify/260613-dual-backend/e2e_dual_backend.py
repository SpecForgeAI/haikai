"""ONE haiboxd, BOTH backends, routed per request.

Boots a single haiboxd (default local; both backends registered) and, against that
same daemon, serves a LOCAL box (no flag -> host subprocess) AND a DOCKER box
(backend=docker, image=node:22 -> container) concurrently. Asserts each box reports
the backend it was routed to, both are healthy + serve over HTTP, then releases
both. Harness-owned lifecycle: finally releases both, shuts haiboxd down, sweeps
any stray haibox-labeled container.
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

HAIBOX_PORT = "8788"
KEY = "dual-key"
NODE_IMG = "node:22"
VENV_PY = "D:/Work/Gary/standards-extractor/.venv/Scripts/python.exe"
os.environ["HAIBOX_URL"] = f"http://127.0.0.1:{HAIBOX_PORT}"
os.environ["STANDARDS_API_KEY"] = KEY

from src.haibox.client import HaiboxClient  # noqa: E402

PASS, FAIL = [], []

LOCAL_CMD = [
    VENV_PY, "-c",
    "import os,http.server,socketserver;"
    "p=int(os.environ['PORT']);"
    "socketserver.TCPServer(('127.0.0.1',p),http.server.SimpleHTTPRequestHandler).serve_forever()",
]
DOCKER_CMD = ("node -e \"require('http')"
              ".createServer((q,r)=>{r.writeHead(200);r.end('ok')})"
              ".listen(process.env.PORT)\"")


def chk(label, cond):
    (PASS if cond else FAIL).append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}")


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


@contextlib.contextmanager
def haiboxd():
    env = {**os.environ, "HAIBOX_HOST": "127.0.0.1", "HAIBOX_PORT": HAIBOX_PORT,
           "STANDARDS_API_KEY": KEY}  # default backend = local; both registered
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
        subprocess.run("docker ps -aq --filter label=haibox.work_root | xargs -r docker rm -f",
                       shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print("  haiboxd stopped; port free:", _port_free(HAIBOX_PORT))


def run():
    hb = HaiboxClient()
    hz = hb.healthz()
    print("  control plane:", hz)
    chk("one haiboxd, both backends registered",
        {"local-subprocess", "docker"} <= set(hz.get("backends", [])))

    print("\n=== serve a LOCAL box (default backend) ===")
    local_box = hb.serve(LOCAL_CMD, health_path="/", readiness_timeout=30.0)
    print(f"  local box={local_box['box_id']} backend={local_box.get('backend')} url={local_box['base_url']}")
    chk("local box routed to local-subprocess", local_box.get("backend") == "local-subprocess")
    chk("local box healthy + serving", _http(local_box["base_url"] + "/") == 200)

    print("\n=== serve a DOCKER box (backend=docker) on the SAME haiboxd ===")
    docker_box = hb.serve(DOCKER_CMD, image=NODE_IMG, backend="docker",
                          health_path="/", readiness_timeout=90.0)
    print(f"  docker box={docker_box['box_id']} backend={docker_box.get('backend')} url={docker_box['base_url']}")
    chk("docker box routed to docker", docker_box.get("backend") == "docker")
    chk("docker box healthy + serving", _http(docker_box["base_url"] + "/") == 200)

    print("\n=== both alive concurrently on one daemon ===")
    listed = hb.list()
    listed = listed["boxes"] if isinstance(listed, dict) else listed
    boxes = {b["box_id"]: b["backend"] for b in listed}
    chk("both boxes listed with distinct backends",
        boxes.get(local_box["box_id"]) == "local-subprocess"
        and boxes.get(docker_box["box_id"]) == "docker")
    chk("a real container exists for the docker box only",
        subprocess.run(["docker", "ps", "--filter", f"label=haibox.box_id={docker_box['box_id']}",
                        "--format", "{{.Image}}"], capture_output=True, text=True).stdout.strip() == NODE_IMG)

    print("\n=== release both ===")
    hb.release(local_box["box_id"])
    hb.release(docker_box["box_id"])
    time.sleep(1.0)
    chk("docker container removed after release",
        subprocess.run(["docker", "ps", "-aq", "--filter", f"label=haibox.box_id={docker_box['box_id']}"],
                       capture_output=True, text=True).stdout.strip() == "")


def main():
    subprocess.run(["docker", "image", "inspect", NODE_IMG],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with haiboxd():
        run()
    print(f"\n=== RESULT: {len(PASS)} passed, {len(FAIL)} failed ===")
    for f in FAIL:
        print("  FAILED:", f)
    print("DUAL_BACKEND_OK" if not FAIL else "DUAL_BACKEND_FAIL")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())

"""REAL repo, REAL container, full haiboxd path — proves the Docker backend.

haiboxd runs with HAIBOX_BACKEND=docker; we serve the on-disk Spring Boot repo
(msb-springboot) as a CONTAINER via HaiboxClient: maven image builds target/msb.jar
in the bind-mounted workdir (setup), then `java -jar target/msb.jar` binds $PORT.
We assert the box is healthy, GET /healthz == 200 "ok" FROM INSIDE the container,
the control plane + box record report backend=docker, and a real maven-image
container is running for the box — then release it.

Harness owns lifecycle: boots haiboxd, and in a finally releases the box, shuts
haiboxd down, and force-removes any stray haibox-labeled container.
"""
import contextlib
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, "D:/Work/Gary/standards-extractor")

HAIBOX_PORT = "8787"
KEY = "dk-realrepo-key"
IMAGE = "maven:3.9-eclipse-temurin-17"
MSB = "C:/Users/ozzie/AppData/Local/Temp/msb-springboot"
VENV_PY = "D:/Work/Gary/standards-extractor/.venv/Scripts/python.exe"
os.environ["HAIBOX_URL"] = f"http://127.0.0.1:{HAIBOX_PORT}"
os.environ["STANDARDS_API_KEY"] = KEY

from src.haibox.client import HaiboxClient  # noqa: E402

PASS, FAIL = [], []


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
            return r.status, r.read().decode().strip()
    except Exception as exc:  # noqa: BLE001
        return None, f"ERR {exc}"


@contextlib.contextmanager
def haiboxd_docker():
    """Boot haiboxd with HAIBOX_BACKEND=docker; always shut down + sweep on exit."""
    env = {**os.environ, "HAIBOX_HOST": "127.0.0.1", "HAIBOX_PORT": HAIBOX_PORT,
           "STANDARDS_API_KEY": KEY, "HAIBOX_BACKEND": "docker"}
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
                    print(f"  haiboxd up (pid {proc.pid})")
                    break
            except Exception:
                pass
            time.sleep(0.5)
        else:
            _force_kill(proc)
            raise RuntimeError("haiboxd did not become healthy")
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
        # belt-and-suspenders: no stray haibox-labeled containers
        subprocess.run("docker ps -aq --filter label=haibox.work_root | "
                       "xargs -r docker rm -f", shell=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print("  haiboxd stopped; port free:", _port_free(HAIBOX_PORT))


def run():
    hb = HaiboxClient()
    print("  control-plane backend:", hb.healthz().get("backend"))
    chk("haiboxd backend == docker", hb.healthz().get("backend") == "docker")

    print("\n=== serve the REAL Spring Boot repo as a CONTAINER (maven build + run) ===")
    box = hb.serve(
        "java -jar target/msb.jar",
        setup="mvn -q -B package -DskipTests",
        setup_timeout=600.0,
        source_dir=MSB,
        image=IMAGE,
        health_path="/healthz",
        readiness_timeout=120.0,
    )
    box_id, base_url = box["box_id"], box["base_url"]
    print(f"  box_id={box_id}  base_url={base_url}  backend={box.get('backend')}")
    chk("box record reports backend=docker", box.get("backend") == "docker")
    chk("box has a base_url", bool(base_url))

    print("\n=== the REAL container serves the repo over HTTP ===")
    s, body = _http(base_url + "/healthz")
    print(f"  GET {base_url}/healthz -> {s} {body!r}")
    chk("GET /healthz == 200 'ok' from inside the container", s == 200 and body == "ok")

    print("\n=== a real maven-image container is running for this box ===")
    ps = subprocess.run(
        ["docker", "ps", "--filter", f"label=haibox.box_id={box_id}",
         "--format", "{{.ID}} {{.Image}}"],
        capture_output=True, text=True)
    print("  docker ps:", ps.stdout.strip())
    chk("one labeled container running on the maven image",
        IMAGE in ps.stdout and len(ps.stdout.split()) >= 2)

    print("\n=== release the box ===")
    hb.release(box_id)
    time.sleep(1.0)
    gone = subprocess.run(["docker", "ps", "-aq", "--filter", f"label=haibox.box_id={box_id}"],
                          capture_output=True, text=True).stdout.strip()
    chk("container removed after release", gone == "")


def main():
    print("=== pre-pull the maven image (idempotent) ===")
    subprocess.run(["docker", "pull", IMAGE], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    box_id = None
    with haiboxd_docker():
        try:
            run()
        finally:
            with contextlib.suppress(Exception):
                if box_id:
                    HaiboxClient().release(box_id)
    print(f"\n=== RESULT: {len(PASS)} passed, {len(FAIL)} failed ===")
    for f in FAIL:
        print("  FAILED:", f)
    print("DOCKER_REALREPO_OK" if not FAIL else "DOCKER_REALREPO_FAIL")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())

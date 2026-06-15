"""REAL end-to-end validation of the round-2 R1 fix (atomic conditional supersede),
plus the cell-owned box release and real box teardown.

Why this test can VALIDATE the change (not just pass): it fires TWO genuinely
concurrent HTTP POST /api/v2/reconciliation for the SAME pending cell against the
real inbound router + real SQLite store, with a real haibox box serving underneath.
- With the round-2 fix (one-statement INSERT ... WHERE latest='pending'), exactly
  ONE request supersedes (verdicts=1) and the other is a no-op (superseded=1); the
  cell-owned box is released exactly once and the real box actually dies.
- If R1 regressed to the read-then-write gate, both requests would read `pending`,
  both would record (verdicts=2, the atomic attempt counter avoids the UNIQUE
  collision) and both would release — the asserts below would FAIL.

Harness owns haiboxd: booted on enter, shut down cleanly in a finally.
"""
import contextlib
import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time

sys.path.insert(0, "D:/Work/Gary/standards-extractor")

HAIBOX_PORT = "8786"
KEY = "r1-key"
os.environ["HAIBOX_URL"] = f"http://127.0.0.1:{HAIBOX_PORT}"
os.environ["STANDARDS_API_KEY"] = KEY

import tempfile  # noqa: E402
os.environ["VERIFICATION_DB_PATH"] = os.path.join(tempfile.gettempdir(), "r1-validate.db")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.api.routes import inbound as inbound_mod  # noqa: E402
from src.haibox.client import HaiboxClient  # noqa: E402
from src.verification import recorder, store  # noqa: E402

VENV_PY = "D:/Work/Gary/standards-extractor/.venv/Scripts/python.exe"
MSB = "C:/Users/ozzie/AppData/Local/Temp/msb-springboot"
ORCH, G, REPO = "orch-r1", "g1", "svc"
PASS, FAIL = [], []


def chk(label, cond):
    (PASS if cond else FAIL).append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}")


def _port_free(port):
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", int(port))) != 0


def _force_kill(proc):
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)


@contextlib.contextmanager
def haiboxd_running():
    env = {**os.environ, "HAIBOX_HOST": "127.0.0.1", "HAIBOX_PORT": HAIBOX_PORT, "STANDARDS_API_KEY": KEY}
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
            proc.wait(timeout=15)
        except Exception:
            _force_kill(proc)
        for _ in range(10):
            if _port_free(HAIBOX_PORT):
                break
            time.sleep(0.5)
        print("  haiboxd stopped; port free:", _port_free(HAIBOX_PORT))


def run():
    # Fresh verification db for a clean cell.
    with contextlib.suppress(FileNotFoundError):
        os.remove(os.environ["VERIFICATION_DB_PATH"])

    app = FastAPI()
    app.include_router(inbound_mod.router)
    client = TestClient(app)
    hb = HaiboxClient()

    print("=== serve a REAL box (msb Spring Boot jar) ===")
    box = hb.serve("java -jar target/msb.jar", setup="mvn -q -B package -DskipTests",
                   setup_timeout=300.0, source_dir=MSB, health_path="/healthz",
                   port_env="PORT", readiness_timeout=120.0)
    box_id, base_url = box["box_id"], box["base_url"]
    print(f"  box={box_id}  base_url={base_url}")
    chk("real box serving (GET /healthz == 200 ok)", _http_ok(base_url + "/healthz"))

    print("\n=== record the cell `pending` carrying the box_id (haibox serve-only) ===")
    conn = store.connect()
    recorder.record_verdict(conn, ORCH, G, REPO, "reconciliation", "pending",
                            detail={"box_id": box_id})
    conn.close()

    print("\n=== fire TWO concurrent reconciliation POSTs for the SAME cell ===")
    barrier = threading.Barrier(2)
    responses = []

    def post(verdict):
        body = {"source": "haikai", "findings": [
            {"orchestrate_id": ORCH, "task_group_id": G, "repo": REPO,
             "verifier": "reconciliation", "verdict": verdict, "title": "recon",
             "box_id": "caller-supplied-should-be-ignored"}]}
        barrier.wait()  # maximize overlap to stress the race
        r = client.post("/api/v2/reconciliation", json=body,
                        headers={"Authorization": f"Bearer {KEY}"})
        responses.append(r.json())

    t1 = threading.Thread(target=post, args=("pass",))
    t2 = threading.Thread(target=post, args=("fail",))
    t1.start(); t2.start(); t1.join(); t2.join()

    verdicts_total = sum(r.get("verdicts", 0) for r in responses)
    superseded_total = sum(r.get("superseded", 0) for r in responses)
    released = [b for r in responses for b in r.get("released_boxes", [])]
    print(f"  responses: {json.dumps(responses)}")
    print(f"  verdicts_total={verdicts_total} superseded_total={superseded_total} released={released}")

    # R1: exactly one supersede wins, the other is a no-op — NOT two records.
    chk("exactly one verdict recorded (R1)", verdicts_total == 1)
    chk("exactly one supersede no-op (R1)", superseded_total == 1)
    # Cell-owned release: the SERVER-recorded box_id, released exactly once (not the
    # caller-supplied string, and not twice).
    chk("cell-owned box released exactly once (R1/S5)", released == [box_id])

    print("\n=== the real box was actually torn down ===")
    time.sleep(1.0)
    live = [b["box_id"] for b in hb.list()]
    chk("box gone from haibox registry", box_id not in live)
    chk("box no longer serving (GET fails)", not _http_ok(base_url + "/healthz", timeout=3))

    conn = store.connect()
    final = store.latest_verdicts(conn, ORCH, G)[(REPO, "reconciliation")]["verdict"]
    conn.close()
    chk("cell settled to a terminal verdict", final in ("pass", "fail"))

    # The HTTP layer (TestClient) serializes requests through one portal, so the
    # above confirms the CONTRACT but may not overlap the concurrent-read window.
    # This burst forces TRUE overlap: N threads, separate real connections to the
    # SAME real db, a tight barrier — exactly the interleaving R1 must survive. If
    # R1 regressed to read-then-write, several would record (the atomic attempt
    # counter dodges the UNIQUE collision); the fix yields exactly one winner.
    print("\n=== raw concurrency burst: 8 threads supersede ONE pending cell ===")
    O2, G2, R2 = "orch-r1b", "g1", "svc"
    c = store.connect()
    recorder.record_verdict(c, O2, G2, R2, "reconciliation", "pending", detail={"box_id": "b2"})
    c.close()
    N = 8
    barrier2 = threading.Barrier(N)
    outcomes = []
    lock = threading.Lock()

    def burst(i):
        conn = store.connect()
        try:
            barrier2.wait()
            rec, _box = recorder.supersede_if_pending(conn, O2, G2, R2, "reconciliation",
                                                       "pass" if i % 2 else "fail")
            with lock:
                outcomes.append(rec)
        finally:
            conn.close()

    threads = [threading.Thread(target=burst, args=(i,)) for i in range(N)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    winners = sum(1 for r in outcomes if r)
    print(f"  {N} concurrent supersedes -> winners={winners} (expected 1)")
    chk("exactly ONE winner under true concurrent overlap (R1)", winners == 1)


def _http_ok(url, timeout=5):
    import urllib.request
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def main():
    with haiboxd_running():
        try:
            run()
        finally:
            # belt-and-suspenders: ensure no box leaks even if an assert raised
            with contextlib.suppress(Exception):
                for b in HaiboxClient().list():
                    HaiboxClient().release(b["box_id"])
    print(f"\n=== RESULT: {len(PASS)} passed, {len(FAIL)} failed ===")
    for f in FAIL:
        print("  FAILED:", f)
    print("R1_VALIDATE_OK" if not FAIL else "R1_VALIDATE_FAIL")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())

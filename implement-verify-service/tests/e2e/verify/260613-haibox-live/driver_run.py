"""Live driver — async RUN mode against real repos: submit a suite, stream
stdout/stderr over SSE, capture the exit code. Proves the crabbox 'run a suite'
half end-to-end."""
import sys
import time
import requests

sys.path.insert(0, "D:/Work/Gary/standards-extractor")
from src.haibox.client import HaiboxClient  # noqa: E402

BASE = "http://127.0.0.1:8785"
KEY = "live-haibox-key"
AUTH = {"Authorization": f"Bearer {KEY}"}
PY = "D:/Work/Gary/standards-extractor/.venv/Scripts/python.exe"
c = HaiboxClient(base_url=BASE, api_key=KEY)


def stream(run_id):
    """Consume the SSE stream; return (log_event_count, exit_payload)."""
    resp = requests.get(f"{BASE}/runs/{run_id}/stream", headers=AUTH, stream=True, timeout=1200)
    logs, pending_exit, exit_payload = 0, False, None
    for raw in resp.iter_lines(decode_unicode=True):
        if not raw:
            continue
        if raw.startswith("event: log"):
            logs += 1
        elif raw.startswith("event: exit"):
            pending_exit = True
        elif raw.startswith("data:") and pending_exit:
            exit_payload = raw[5:].strip()
            break
    return logs, exit_payload


print("HEALTHZ:", c.healthz())

# ── Run A: a REAL Spring Boot test suite, async + streamed ───────────────────
print("\n=== RUN A: gs-rest-service `mvnw test` (real JUnit suite), async+SSE ===")
t0 = time.time()
rec = c.submit_run(".\\mvnw.cmd -q test", source_dir="C:/Users/ozzie/AppData/Local/Temp/gs-rest/complete",
                   timeout_seconds=900, name="gs-rest-suite")
print(f"SUBMITTED in {time.time()-t0:.2f}s (async):", rec["run_id"], "state=", rec["state"])
logs, exitp = stream(rec["run_id"])
final = c.run_status(rec["run_id"])
print(f"STREAMED {logs} log event(s); exit payload={exitp}")
print("FINAL:", final["state"], "exit_code=", final["exit_code"])

# ── Run B: pytest on a repo with no tests -> non-zero exit (5), captured ─────
print("\n=== RUN B: `pytest` on render-examples/fastapi (no tests -> exit 5) ===")
recb = c.submit_run([PY, "-m", "pytest", "-q"],
                    source_dir="C:/Users/ozzie/AppData/Local/Temp/real-fastapi",
                    timeout_seconds=120, name="fastapi-pytest")
print("SUBMITTED (async):", recb["run_id"], "state=", recb["state"])
# poll
end = time.time() + 120
while time.time() < end and c.run_status(recb["run_id"])["state"] not in (
        "succeeded", "failed", "timeout", "interrupted"):
    time.sleep(0.5)
fb = c.run_status(recb["run_id"])
print("FINAL:", fb["state"], "exit_code=", fb["exit_code"])

# ── Observability: list all runs with their outcomes ─────────────────────────
print("\n=== GET /runs (durable, observable) ===")
for r in c.list_runs():
    print(f"  {r['run_id']} {r['name']:>16} -> {r['state']} exit={r['exit_code']}")
print("DONE")

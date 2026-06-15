"""ONE continuous full-arc e2e, real code paths, on a real repo.

init -> commit -> CI(signed webhook) -> gate cells -> haibox serve->pending ->
Haikai replayer (Style-1) -> final verdict -> gate advances.

Real code everywhere; only the two genuinely-external drivers are faithful
stand-ins: GitHub Actions running CI (we deliver a REAL HMAC-signed webhook) and
Haikai's reconciler (a replayer that hits the real base_url + reports back). The
LLM-driven legs (orchestrate-implement, verify-agent) are represented by their
real downstream code (a real git commit; direct recorder verdicts + advance).

Requires a live haiboxd on 127.0.0.1:8785 and a cloned fastapi repo (see rig).
"""
import hashlib
import hmac
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

sys.path.insert(0, "D:/Work/Gary/standards-extractor")

KEY = "arc-key"
INGRESS = "arc-ingress"
SECRET = "arc-webhook-secret"
os.environ.setdefault("STANDARDS_API_KEY", KEY)
os.environ.setdefault("SX_INGRESS_TOKEN_GITHUB", INGRESS)
os.environ.setdefault("SX_WEBHOOK_SECRET_GITHUB", SECRET)
os.environ["HAIBOX_URL"] = "http://127.0.0.1:8785"
# VERIFICATION_DB_PATH + JOBS_DB_PATH are set by the rig (shared).

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.api.routes.inbound import router as inbound_router  # noqa: E402
from src.verification import recorder, store  # noqa: E402
from src.verification.reconcile import replay_and_diff  # noqa: E402
from src.job_queue.job_models import Job, JobStatus, JobType  # noqa: E402
from src.job_queue.job_storage import JobStorage  # noqa: E402
from src.job_queue.tasks import run_haibox_verify  # noqa: E402
from src.haibox.client import HaiboxClient  # noqa: E402

ORCH, G, REPO = "orch-arc", "g1", "fastapi"
CELLS = [[REPO, "ci-trigger"], [REPO, "inline"], [REPO, "rubric"], [REPO, "reconciliation"]]
FASTAPI = "C:/Users/ozzie/AppData/Local/Temp/arc-fastapi"
PY = "D:/Work/Gary/standards-extractor/.venv/Scripts/python.exe"

app = FastAPI()
app.include_router(inbound_router)
api = TestClient(app)


def git(*a):
    return subprocess.run(["git", "-C", FASTAPI, *a], capture_output=True, text=True)


print("=== PHASE 1: init (real repo cloned into workspace) ===")
print("  repo:", FASTAPI, "| has .git:", os.path.isdir(os.path.join(FASTAPI, ".git")))

print("\n=== PHASE 2: orchestrate->commit (real git commit; LLM-implement stubbed) ===")
git("checkout", "-B", "feature/arc-spec")
with open(os.path.join(FASTAPI, "ARC_CHANGE.txt"), "w") as f:
    f.write("synthetic spec output for the arc e2e\n")
git("add", "-A")
git("-c", "user.email=arc@e2e", "-c", "user.name=arc", "commit", "-m", "feature: arc-spec")
sha = git("rev-parse", "HEAD").stdout.strip()
print("  committed SHA:", sha[:12])

print("\n=== PHASE 3: CI -> signed webhook -> /inbound -> ci-trigger verdict ===")
conn = store.connect()
store.record_binding(conn, sha, "github", ORCH, G, REPO)   # SHA -> cell binding (D10.4)
conn.close()
body = json.dumps({"workflow_run": {"head_sha": sha, "status": "completed", "conclusion": "success"}}).encode()
sig = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
r = api.post(f"/api/v2/inbound/github/{INGRESS}", content=body,
             headers={"X-Hub-Signature-256": sig, "X-GitHub-Delivery": "arc-d1",
                      "Content-Type": "application/json"})
print("  inbound:", r.status_code, r.json().get("verdict"), r.json().get("cell"))

print("\n=== PHASE 4: other gate cells (inline, rubric) — verify-agent stubbed ===")
conn = store.connect()
for verifier in ("inline", "rubric"):
    recorder.record_verdict(conn, ORCH, G, REPO, verifier, "pass")
conn.close()

print("\n=== PHASE 4.5: gate must BLOCK (reconciliation cell not yet verified) ===")
conn = store.connect()
ok, reason = recorder.advance(conn, ORCH, G, expected_cells=CELLS)
conn.close()
print(f"  advance -> {ok} ({reason[:70]})  [expected: blocked]")
assert not ok, "gate must not advance before reconciliation"

print("\n=== PHASE 5: haibox deploy -> cell `pending` (serve-only) ===")
storage = JobStorage(os.environ["JOBS_DB_PATH"])
job = Job(job_id="arc-haibox", type=JobType.HAIBOX_VERIFY, status=JobStatus.QUEUED,
          company="acme", project="fastapi", created_at=datetime.now(timezone.utc),
          request_payload={"orchestrate_id": ORCH, "task_group_id": G, "repo": REPO,
                           "verifier": "reconciliation",
                           "target": {"command": [PY, "-c",
                                      "import os,uvicorn; uvicorn.run('main:app', host='127.0.0.1', port=int(os.environ['PORT']))"],
                                      "source_dir": FASTAPI, "health_path": "/", "readiness_timeout": 40}})
storage.save_job(job)
run_haibox_verify("arc-haibox", storage)
res = storage.get_job("arc-haibox").result
base_url, box_id = res.get("base_url"), res.get("box_id")
print("  haibox: verdict=", res.get("verdict"), "base_url=", base_url, "box=", box_id)

print("\n=== PHASE 6: Haikai replayer (Style-1) — replay vs base_url, report verdict ===")
OPS = [
    {"operation": "GET /", "request": {"path": "/"},
     "expected_response": {"status": 200, "json": {"message": "Hello World"}}},
    {"operation": "GET /items/7?q=arc", "request": {"path": "/items/7?q=arc"},
     "expected_response": {"status": 200, "json": {"item_id": 7, "q": "arc"}}},
]
breaks = replay_and_diff(base_url, OPS, match="exact")
verdict = "pass" if not breaks else "fail"
print(f"  replayed {len(OPS)} ops -> {len(breaks)} breaks -> verdict {verdict}")
rr = api.post("/api/v2/reconciliation", headers={"Authorization": f"Bearer {KEY}"}, json={
    "source": "haikai", "findings": [
        {"orchestrate_id": ORCH, "task_group_id": G, "repo": REPO, "verifier": "reconciliation",
         "verdict": verdict, "kind": "reconciliation_result", "title": "reconciliation",
         "box_id": box_id,  # F1: round-trip box_id so /reconciliation releases the box
         "detail": {"breaks": breaks}}]})
print("  /reconciliation:", rr.status_code, "verdicts=", rr.json().get("verdicts"),
      "released_boxes=", rr.json().get("released_boxes"))

print("\n=== PHASE 7: gate advances (all cells pass) ===")
conn = store.connect()
latest = store.latest_verdicts(conn, ORCH, G)
ok, reason = recorder.advance(conn, ORCH, G, expected_cells=CELLS)
conn.close()
print("  cells:", {f"{r}/{v}": latest[(r, v)]["verdict"] for r, v in CELLS})
print(f"  advance -> {ok} ({reason})")

# F1: the box should already be released by the verdict POST above
live = [b["box_id"] for b in HaiboxClient().list()]
released = box_id not in live
print("  box released by /reconciliation (F1):", released)

print("\nARC_OK" if (ok and released) else "\nARC_FAIL")

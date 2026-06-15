"""Full e2e: Haikai instructs US to reconcile. Enqueue HAIBOX_VERIFY jobs with a
`target` (real FastAPI repo) + `replay` (captured ops). The worker deploys the
target via haibox, replays the ops, diffs vs expected, and records pass/fail +
breaks. One matching case (-> pass) and one mismatched (-> fail + finding).
"""
import os
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, "D:/Work/Gary/standards-extractor")
from src.job_queue.job_models import Job, JobStatus, JobType  # noqa: E402
from src.job_queue.job_queue import JobQueue  # noqa: E402
from src.job_queue.job_storage import JobStorage  # noqa: E402
from src.verification import store as vstore  # noqa: E402

JOBS = os.environ["JOBS_DB_PATH"]
PY = "D:/Work/Gary/standards-extractor/.venv/Scripts/python.exe"
FASTAPI = "C:/Users/ozzie/AppData/Local/Temp/real-fastapi"
TARGET = {
    "command": [PY, "-c",
                "import os,uvicorn; uvicorn.run('main:app', host='127.0.0.1', port=int(os.environ['PORT']))"],
    "source_dir": FASTAPI, "health_path": "/", "readiness_timeout": 40,
}
PASS_OPS = [
    {"operation": "GET /", "request": {"path": "/"},
     "expected_response": {"status": 200, "json": {"message": "Hello World"}}},
    {"operation": "GET /items/7?q=live", "request": {"path": "/items/7?q=live"},
     "expected_response": {"status": 200, "json": {"item_id": 7, "q": "live"}}},
]
FAIL_OPS = [  # oracle says "Goodbye World" — the migrated target says "Hello World" => break
    {"operation": "GET /", "request": {"path": "/"},
     "expected_response": {"status": 200, "json": {"message": "Goodbye World"}}},
]


def enqueue(jid, group, ops):
    job = Job(job_id=jid, type=JobType.HAIBOX_VERIFY, status=JobStatus.QUEUED,
              company="acme", project="fastapi", created_at=datetime.now(timezone.utc),
              request_payload={"orchestrate_id": "orch-recon", "task_group_id": group,
                               "repo": "fastapi", "verifier": "reconciliation",
                               "target": TARGET, "replay": {"operations": ops, "match": "exact"}})
    return JobQueue(JOBS).enqueue_job(job)


j1 = enqueue("hv-recon-pass", "g1", PASS_OPS)
j2 = enqueue("hv-recon-fail", "g2", FAIL_OPS)
print("ENQUEUED:", j1, j2)


def wait(jid):
    end = time.time() + 600
    while time.time() < end:
        st = JobStorage(JOBS).get_job(jid)
        if st and st.status in ("completed", "failed"):
            return st
        time.sleep(3)
    return None


for jid, group, label in ((j1, "g1", "MATCH->pass"), (j2, "g2", "MISMATCH->fail")):
    st = wait(jid)
    conn = vstore.connect()
    try:
        v = vstore.latest_verdicts(conn, "orch-recon", group).get(("fastapi", "reconciliation"))
        findings = vstore.list_findings(conn, "orch-recon")
    finally:
        conn.close()
    r = st.result if st else {}
    print(f"\n[{label}] verdict={v['verdict'] if v else None} "
          f"break_count={r.get('break_count')} operations={r.get('operations')}")
    if group == "g2":
        print("  findings:", [(f["title"], f["kind"]) for f in findings])

print("\nE2E_DONE")

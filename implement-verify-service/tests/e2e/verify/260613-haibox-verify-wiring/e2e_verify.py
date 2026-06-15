"""Full e2e: enqueue a HAIBOX_VERIFY job -> the WORKER picks it up -> drives
haibox to run a real repo's suite -> records a guarded verdict in the
verification store. Proves the deploy-and-verify last mile end-to-end.

Assumes haiboxd (127.0.0.1:8785) and the worker are already running, sharing
JOBS_DB_PATH + VERIFICATION_DB_PATH with this driver, and HAIBOX_URL/key set on
the worker.
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
GS = "C:/Users/ozzie/AppData/Local/Temp/gs-rest/complete"

job = Job(
    job_id="hv-e2e-1", type=JobType.HAIBOX_VERIFY, status=JobStatus.QUEUED,
    company="acme", project="gs-rest", created_at=datetime.now(timezone.utc),
    request_payload={
        "orchestrate_id": "orch-e2e", "task_group_id": "g1", "repo": "gs-rest",
        "verifier": "inline",
        "run": {"command": ".\\mvnw.cmd -q test", "source_dir": GS, "timeout_seconds": 900},
    },
)
jid = JobQueue(JOBS).enqueue_job(job)
print("ENQUEUED:", jid, "(HAIBOX_VERIFY; gs-rest `mvnw test`)")

end = time.time() + 900
while time.time() < end:
    st = JobStorage(JOBS).get_job(jid)
    conn = vstore.connect()
    try:
        v = vstore.latest_verdicts(conn, "orch-e2e", "g1").get(("gs-rest", "inline"))
    finally:
        conn.close()
    if st and st.status in ("completed", "failed"):
        print("JOB:", st.status)
        print("RESULT:", {k: st.result.get(k) for k in ("verdict", "exit_code", "recorded", "cell")}
              if st.result else None)
        print("VERDICT IN STORE:", v["verdict"] if v else None)
        print("E2E_OK" if (v and v["verdict"] == "pass") else "E2E_FAIL")
        break
    time.sleep(3)
else:
    print("E2E_TIMEOUT")

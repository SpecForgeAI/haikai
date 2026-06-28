"""Agent-callable job enqueue — the verify-loop's `real` repair dispatch (D10).

The `verification-loop` agent's tools are `Read, Bash, Task` + the five guarded
recorder CLIs (`recorder.py`) — none of which can ENQUEUE a job. On a `real`
failure the loop must dispatch the scoped fix as a fresh single-repo
`/orchestrate` task group (verification-loop.md:76-78); the worker then
re-implements → commits → CI re-runs → the inbound-gateway correlates the new
SHA and re-enters verify (inbound.py:117-129). This thin CLI is that one missing
dispatch arrow (the `post-repair → implementer "loop back (capped)"` edge in
diagram07.ts).

It is DELIBERATELY separate from `recorder.py`: that module's contract is the
guarded write-path for the verification tables, not job orchestration. This CLI
only constructs an ORCHESTRATION Job and enqueues it into the jobs db the worker
polls — the SAME call `inbound._enqueue_reinvoke` (inbound.py:129) and
`POST /jobs/orchestrations` (jobs.py:75-81) use.

    python -m src.job_queue.enqueue_cli orchestration --json '<OrchestrationRequest>'

JSON is the same payload `POST /api/v1/jobs/orchestrations` takes:
    {"company": "...", "project": "...", "spec_intents": [{"spec_name": "..."}]}

Exit 0 + `{"ok": true, "job_id": "..."}` on stdout; 1 on enqueue error; 2 bad input.
"""

from __future__ import annotations

import argparse
import json
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Enqueue a worker job (D10 repair dispatch — NOT a recorder verb)"
    )
    parser.add_argument("job_type", choices=["orchestration"])
    parser.add_argument("--json", required=True, help="OrchestrationRequest payload object")
    args = parser.parse_args(argv)

    try:
        payload = json.loads(args.json)
        assert isinstance(payload, dict)
    except (json.JSONDecodeError, AssertionError):
        print(json.dumps({"error": "--json must be an object"}))
        return 2

    missing = [k for k in ("company", "project", "spec_intents") if not payload.get(k)]
    if missing:
        print(json.dumps({"error": f"payload missing keys: {missing}"}))
        return 2

    try:
        from src.job_queue.job_models import Job, JobStatus, JobType
        from src.job_queue.job_queue import JobQueue
        from src.safe_paths import jobs_db_path

        # Enqueue into the jobs db the WORKER polls (jobs_db_path, the shared
        # resolver) — not the verification db, or the job sits invisible forever.
        queue = JobQueue(jobs_db_path())
        job = Job(
            type=JobType.ORCHESTRATION,
            status=JobStatus.QUEUED,
            company=payload["company"],
            project=payload["project"],
            request_payload=payload,
        )
        job_id = queue.enqueue_job(job)
    except Exception as exc:  # enqueue failure is non-fatal to the loop; report it
        print(json.dumps({"error": f"enqueue failed: {exc}"}))
        return 1

    print(json.dumps({"ok": True, "job_id": job_id}))
    return 0


if __name__ == "__main__":
    sys.exit(main())

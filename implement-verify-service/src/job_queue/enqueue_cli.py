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

    python -m src.job_queue.enqueue_cli orchestration --json '<OrchestrationRequest>' \
        --db <verification_db>

JSON is the same payload `POST /api/v1/jobs/orchestrations` takes:
    {"company": "...", "project": "...", "spec_intents": [{"spec_name": "..."}]}

Repair dispatch (run-flow-graph D2b/I16): `repair_of` must carry the COMPLETE
cell identity — {orchestrate_id, task_group_id, repo, **verifier**[, attempt]}
— and is VALIDATED against the authoritative open_repair record before
anything is enqueued. Missing verifier → exit 2; no/ambiguous match → exit 1
(fail fast — never attach to a guessed cell). `--db` names the verification db
(same value the recorder CLI receives).

Exit 0 + `{"ok": true, "job_id": "..."}` on stdout; 1 on enqueue/validation
error; 2 bad input.
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
    parser.add_argument("--db", default=None,
                        help="verification db path (repair_of validation + graph emission)")
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

    # Run-flow-graph D2b/I16: a repair dispatch must carry the COMPLETE cell
    # identity (incl. verifier) and must validate against the authoritative
    # open_repair record BEFORE anything is enqueued or emitted. Fail fast;
    # never attach to a guessed cell.
    repair_of = payload.get("repair_of")
    if repair_of is not None:
        if not isinstance(repair_of, dict) or not repair_of.get("verifier"):
            print(json.dumps({"error": "repair_of requires verifier (D2b: complete "
                              "repair target identity — orchestrate_id, task_group_id, "
                              "repo, verifier[, attempt])"}))
            return 2
        try:
            from src.verification import flow_graph
            vconn = flow_graph.connect(args.db)
            try:
                ok, reason, resolved_attempt = flow_graph.validate_repair_target(
                    vconn, repair_of)
            finally:
                vconn.close()
        except Exception as exc:
            print(json.dumps({"error": f"repair_of validation failed: {exc}"}))
            return 1
        if not ok:
            print(json.dumps({"error": f"repair_of rejected: {reason}"}))
            return 1
        repair_of["attempt"] = resolved_attempt  # pin the validated attempt

        # D8 (parallel-worktrees): the repair mini-spec is a FILESYSTEM
        # hand-off — the verify session wrote it to the LIVE product root's
        # haikai/specs/<spec>/planning; the repair run's allocation seeds it
        # into the repair worktree. Stamp a sha256 over those files into the
        # payload so allocation can verify the seeded copy is EXACTLY what
        # was dispatched (fail fast on mismatch — W5, never guess).
        try:
            import os as _os
            from pathlib import Path as _Path

            from src.git.worktree_runs import spec_planning_checksum

            live_product = (_Path(_os.environ["API_WORKSPACE_DIR"])
                            / payload["company"] / payload["project"])
            checksums = {}
            for si in payload["spec_intents"]:
                spec = si.get("spec_name")
                digest = spec_planning_checksum(live_product, spec)
                if digest is None:
                    print(json.dumps({"error": (
                        f"repair mini-spec not found: {live_product}/haikai/specs/"
                        f"{spec}/planning — the verify session must write the "
                        "mini-spec to the LIVE product root before dispatch (D8)")}))
                    return 1
                checksums[spec] = digest
            payload["spec_checksums"] = checksums
        except KeyError:
            print(json.dumps({"error": "API_WORKSPACE_DIR not set — cannot "
                              "checksum the repair mini-spec (D8)"}))
            return 1

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

    # Graph emission (D4: validated dispatch → attempt running + job evidence).
    # Best-effort — the job is already durably enqueued.
    if repair_of is not None:
        try:
            from src.verification import flow_graph
            vconn = flow_graph.connect(args.db)
            try:
                flow_graph.emit_repair_dispatched(
                    vconn, str(repair_of["orchestrate_id"]),
                    str(repair_of["task_group_id"]), str(repair_of["repo"]),
                    str(repair_of["verifier"]), int(repair_of["attempt"]), job_id)
            finally:
                vconn.close()
        except Exception:
            pass  # projection only; the dispatch itself succeeded

    print(json.dumps({"ok": True, "job_id": job_id}))
    return 0


if __name__ == "__main__":
    sys.exit(main())

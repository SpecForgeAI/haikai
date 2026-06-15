# haibox ↔ verify worker — the last mile, wired + e2e-verified

Goal: a verification job auto-triggers deploy-and-verify via haibox, and the
outcome folds into the D5 gate. Previously haibox ran but nothing in the worker
called it.

## What was wired
- `JobType.HAIBOX_VERIFY` + worker dispatch.
- `run_haibox_verify(job_id, storage)` (src/job_queue/tasks.py): reads a job
  payload with a `run` (suite) and/or `target` (serve) block, drives haibox over
  HTTP (HaiboxClient / provision_for_job), and records the outcome through the
  **guarded recorder** as a verdict on cell `(repo, verifier)`:
  - `run`    -> exit 0 → `pass`, non-zero → `fail`, killed → `timeout`
  - `target` -> provision a serving box, record its `base_url`; deployed+healthy → `pass`
  Verdicts fold into the D5 AND gate exactly like inline/rubric/ci-trigger cells.

## Full e2e (real repo, real services)
Booted the real `haiboxd` + the real **worker** (sharing JOBS_DB + VERIFICATION_DB;
worker pointed at haiboxd via HAIBOX_URL), then enqueued a `HAIBOX_VERIFY` job:

```
payload.run = { command: ".\\mvnw.cmd -q test",
                source_dir: <spring-guides/gs-rest-service/complete> }
```

Worker log:
```
Processing job hv-e2e-1 (type: haibox-verify, company: acme, project: gs-rest)
Job hv-e2e-1: haibox-verify cell (gs-rest,inline) -> pass (recorded=True)
Job hv-e2e-1 completed
```

Result: job `completed`, `verdict=pass`, `exit_code=0`, and the verdict is
durably recorded in the verification store for cell `(gs-rest, inline)`. **E2E_OK.**
Driver: `e2e_verify.py`.

## Tests
5 unit tests (`tests/test_haibox_verify_job.py`): passing→pass, failing→fail,
timeout→timeout, serve→base_url+pass, missing-block→job fails with no verdict
(faked HaiboxClient). Plus the live e2e above through the real worker + haiboxd.

## Boundary / decision: replay belongs to Haikai
The `run` path produces a real behavioral verdict (the suite ran). The `target`
(serve) path is the *deploy* half only — the like-for-like **replay vs the
current-state oracle is Haikai's reconciler**, not this service. So serve-only:

- records the cell as **`pending`** (NOT `pass`) — liveness alone must not advance
  the D5 gate; Haikai reports the real pass/fail on the same cell afterwards;
- **leaves the target running** (does not release the box) so Haikai can replay
  against the surfaced `base_url`; the TTL reaper is the backstop for a forgotten
  box. (`run`-supporting boxes are still released — they're throwaway.)

Net: haibox owns *deploy + run-a-suite*; Haikai owns *replay + diff*. The verify
worker hands Haikai a live `base_url` and marks the cell in-flight.

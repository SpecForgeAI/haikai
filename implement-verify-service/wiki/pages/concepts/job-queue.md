# Job queue

SQLite-backed async job system. Lives in `src/job_queue/`. Used to run long operations (orchestrations, standards generation) without blocking the API.

## Why it exists

A `POST /api/v1/orchestrations` request runs a four-step Haikai lifecycle ([[haikai-sdd]]: write-spec → create-tasks → implement-tasks). That can take minutes. Holding an HTTP connection open for minutes is fragile (timeouts, retries, mid-stream disconnects).

The job queue solves it: client `POST`s the request, gets a `job_id` back immediately, then polls `GET /api/v1/jobs/{job_id}` for status. A separate worker process pulls jobs off the queue and executes them.

## The 5 components

| File | Role |
|---|---|
| `job_models.py` | Pydantic models: `Job`, `JobStatus`, `JobType`, `JobProgress` |
| `job_storage.py` | SQLite layer: insert, query, atomic state transitions |
| `job_queue.py` | Public API: `enqueue_job`, `get_job_status`, `cancel_job` |
| `worker.py` | Background process: polls storage, dispatches by `JobType`, handles SIGTERM |
| `tasks.py` | Per-`JobType` task functions; the worker imports and calls them |

## Status state machine

```
QUEUED ──▶ RUNNING ──▶ COMPLETED
   │           │
   │           └─────▶ FAILED
   │
   └─▶ CANCELLED  (only from QUEUED or RUNNING)
```

`JobStatus` enum (`job_models.py:12-`):
- `QUEUED` — accepted, not yet picked up
- `RUNNING` — worker has it
- `COMPLETED` — successful exit
- `FAILED` — raised, with traceback in the job's `error` field
- `CANCELLED` — set explicitly via `cancel_job`

## Atomic cancel

`JobQueue.cancel_job` (`job_queue.py:41-`) is **atomic**: a single `UPDATE` flips the status only if it's still cancellable. This avoids a TOCTOU between read-status and write-cancelled where the worker could complete the job in between. The method's docstring documents this explicitly:

> Atomic: a single UPDATE flips the status only if it's still cancellable, avoiding a TOCTOU between read-status and write-cancelled where the worker could have completed the job in between.

Returns `True` only if the status actually flipped, so the caller knows whether the cancel was effective.

## Connection hygiene

`JobStorage._connect` is a `@contextmanager` that guarantees `close()` on exit (`job_storage.py:21-`). The docstring is explicit about the bug it replaced:

> Replaces the prior pattern of `conn = sqlite3.connect(...); ...; conn.close()` which leaked the connection if anything in between raised.

Same pattern of "use context managers for resource lifetime" used elsewhere in the codebase.

## Job types

From `JobType` (`job_models.py:26-39`) — **11 values**:

```
ORCHESTRATION       — full Haikai lifecycle
WRITE_SPEC          — single /write-spec call
GENERATE_TASKS      — single /create-tasks call
IMPLEMENT_TASKS     — single /implement-tasks call
SHAPE_SPEC          — single /shape-spec call
STANDARDS_PRODUCT   — product-mode standards run
STANDARDS_GLOBAL    — global-mode standards run
RUN_PIPELINE        — generic pipeline run
VERIFY_TASK_GROUP   — verification-loop re-invoke (tasks.run_verify_task_group)
BUG_INVESTIGATION   — /haikai:debug + /haikai:fix on an intake bug
HAIBOX_VERIFY       — provision+run+replay in a haibox sandbox cell
```

Each is wired in `tasks.py` to a function the worker dispatches to.

> **Corrected [2026-06-21].** This page previously listed only the first 7 types.
> The last 4 (`RUN_PIPELINE`, `VERIFY_TASK_GROUP`, `BUG_INVESTIGATION`,
> `HAIBOX_VERIFY`) were added with the async-verification work and were missing
> here. The job queue is now the substrate for the verification pipeline, not
> just orchestration/standards — see below.

## Verification jobs

The job queue is how the [[async-verification-orchestration|verification-loop]]
gets re-invoked. Because that loop is **stateless and one-shot** (D10.2), every
async verdict starts a *fresh* job rather than resuming a parked one:

| JobType | Enqueued by | Runs |
|---|---|---|
| `VERIFY_TASK_GROUP` | [[inbound-gateway]] on a CI webhook (`_enqueue_reinvoke`) | `/verify-task-group …` — reconstructs state from `verification_db`, re-evaluates the D5 gate |
| `BUG_INVESTIGATION` | `POST /api/v2/bugs/` | `/haikai:debug` + `/haikai:fix`; POSTs outcome to `callback_url` |
| `HAIBOX_VERIFY` | the verification-loop agent (per inline/haibox cell) | HaiboxClient provision + run + replay |

So `jobs.db` carries *two* unrelated kinds of work: the long synchronous
operations below, and the verification re-entries above. The shared
`jobs_db_path()` helper (predict R2) keeps enqueue and poll on the same file.

## Worker lifecycle

`Worker` (`worker.py:26-`):
- Reads `WORKER_ID` from env (default `worker-1`).
- Installs SIGTERM/SIGINT handlers for graceful shutdown.
- Polls `JobStorage` in a loop, picks up oldest `QUEUED` job, sets `RUNNING`, dispatches to the matching task function in `tasks.py`.
- On exception: sets `FAILED`, records traceback.
- On clean exit: sets `COMPLETED`, records result.

Single-process, single-threaded by default. Multiple workers can run side-by-side against the same SQLite database (they're not coordinated, but the atomic UPDATE on pickup means no double-execution).

## REST surface

| Endpoint | Action |
|---|---|
| `POST /api/v1/jobs/orchestrations` | Enqueue an orchestration job |
| `GET /api/v1/jobs/{job_id}` | Get one job's full record |
| `GET /api/v1/jobs` | List jobs (filter by company/project/status) |
| `DELETE /api/v1/jobs/{job_id}` | Cancel via the atomic-update pattern |

## What it's *not*

- **Not Celery / RQ / Dramatiq.** No Redis, no broker, no fanout. Single SQLite DB, single workers process. Sufficient for the project's load.
- **Not durable across DB corruption.** SQLite WAL mode and atomic transactions are robust, but no replication. For multi-node deployments this would need replacement.
- **Not the path used by streaming chat.** Chat endpoints ([[chat-executors]]) hold the connection open and stream SSE. The job queue is for *non-streaming* long operations where the client polls.

## Cross-references

- [[chat-executors]] — sibling pattern but solving the opposite problem (streaming, not polling)
- [[haikai-sdd]] — the most common consumer (orchestration jobs)
- [[standards-pipeline]] — global/product standards jobs
- [[inbound-gateway]] — enqueues `VERIFY_TASK_GROUP` / `BUG_INVESTIGATION`
- [[async-verification-orchestration]] — the pipeline the verification jobs drive
- [[endpoint-reference]] — the jobs/* REST surface in the full census

## Sources

- `src/job_queue/{job_queue,job_storage,job_models,worker,tasks}.py`
- `docs/ARCHITECTURE.md` § "Async Job Queue"
- [[../../raw/2026-05-04_codebase-walk]]

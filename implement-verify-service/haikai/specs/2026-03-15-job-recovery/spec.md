# Job Recovery on Container Restart

## Summary

Make orchestration jobs resilient to Docker restarts and internet drops. When
the container comes back up, detect interrupted jobs and either resume or mark
them as failed so the client can retry.

---

## Current State

### What survives a container restart

| Asset                                | Location                                            | On volume?      | Survives? |
|--------------------------------------|-----------------------------------------------------|-----------------|-----------|
| `jobs.db` (SQLite)                   | `/app/workspace/jobs.db`                            | Yes (~/.haikai) | Yes       |
| Session transcript (`.jsonl`)        | `{co}/{proj}/haikai/specs/{spec}/`                | Yes             | Yes       |
| `active_session.json` (spec-level)   | Same spec folder                                    | Yes             | Yes       |
| `active_session.json` (project-level)| `{co}/{proj}/.claude/active_session.json`           | Yes             | Yes       |
| Generated files (code, spec, tasks)  | Same project tree                                   | Yes             | Yes       |
| Step log files                       | `/app/workspace/logs/orchestration/{id}/step-*.json`| Yes             | Yes       |

### What does NOT survive

| Asset                                                         | Why                                        |
|---------------------------------------------------------------|--------------------------------------------|
| Background thread running `_run_job_in_background`            | Thread dies with the process               |
| In-memory orchestrator state                                  | Python process killed                      |
| Claude CLI session file `~/.claude/projects/.../{uuid}.jsonl` | Inside container filesystem, not on volume |
| Job status stays `"running"` forever                          | No process alive to update it              |

### The problem

After a restart, the client polls `GET /api/v2/jobs/{job_id}` and sees
`status: "running"` indefinitely. There is no mechanism to detect that the
job is orphaned, mark it appropriately, or resume it.

---

## Existing infrastructure

Before speccing changes, note what already exists:

### `persist_session_to_spec(spec_name)` — `src/chat/claude_chat_executor.py:1058`

Called after each orchestration step (`haikai_orchestrator.py:347`). Writes:
- `active_session.json` into the spec folder — contains the `session_id`
  (UUID) that identifies the conversation history, plus `created_at` and
  `spec_name`
- Copies the `.jsonl` transcript file (named `{session_id}.jsonl`) from
  Claude CLI's internal session directory into the spec folder

This means after each completed step, both the session UUID and the full
conversation transcript are persisted to the mounted volume inside the spec
folder.

### `restore_session_from_spec()` — `src/chat/claude_chat_executor.py:1090`

Restores the Claude CLI session from the spec folder backup. The flow is:

1. Check if Claude CLI already has the session file at
   `~/.claude/projects/{encoded-path}/{session_id}.jsonl`
2. If it exists, do nothing — the session is already loaded and available
3. If it does NOT exist (e.g. container restarted, filesystem wiped):
   - Scan `haikai/specs/*/active_session.json` for a matching `session_id`
   - Find the corresponding `{session_id}.jsonl` in that spec folder
   - Copy it back to Claude CLI's session directory

This is critical: the `active_session.json` in the spec folder contains the
UUID that points to the conversation history. The `.jsonl` file (also in the
spec folder, named by that UUID) IS the conversation history. On recovery,
we read the UUID from `active_session.json`, then copy the `.jsonl` back to
where Claude CLI expects it so `--resume {session_id}` works.

Important: if a session already exists in Claude CLI's session directory, it
must be loaded first — we should NOT blindly overwrite it with the spec
folder copy, as the in-place version may be more recent.

### `get_active_session()` — `src/chat/session_store.py:41`

Reads the project-level `active_session.json` at
`{co}/{proj}/.claude/active_session.json`. This is what `run_orchestration`
uses to find the session ID. This is distinct from the spec-level
`active_session.json` — the project-level one tracks which session is
"active" for the whole project, while the spec-level one is the backup copy
saved after each orchestration step.

---

## Changes

### 1. Move `jobs.db` to the mounted volume

**Status: Already done.** `JOBS_DB_PATH` defaults to
`API_WORKSPACE_DIR / "jobs.db"` (`src/api.py:204`), which resolves to
`/app/workspace/jobs.db` — on the mounted Docker volume. No code change
needed.

Note: There is a stale `/app/jobs.db` inside the container image from an
earlier build. This is unused and can be cleaned up in the Dockerfile.

---

### 2. Startup recovery routine

On app boot, scan `jobs.db` for jobs with `status = "running"` and recover
them.

#### Location

`src/api.py` — add a `@app.on_event("startup")` handler (or `lifespan`
context manager if already using one).

#### Recovery logic — step by step

The orchestration workflow has 3 sequential steps:
- **Step 1**: `/write-spec` — generates `spec.md` from requirements
- **Step 2**: `/create-tasks` — generates `tasks.md` from the spec
- **Step 3**: `/implement-tasks` — writes code for each task group

Each step runs as a Claude CLI `--resume {session_id}` call, building on the
same conversation. After each step completes, `persist_session_to_spec`
saves both the session UUID and the `.jsonl` transcript to the spec folder,
and a step log file (`step-{n}-{command}.json`) is written to the logs
directory.

On container restart, the recovery routine does the following for each
interrupted job:

1. **Find which steps completed** — scan the step log files on disk.
   Each successful step produces a `step-{n}-{command}.json` with
   `"success": true`. The highest completed step number tells us where
   the job was interrupted.

2. **If no steps completed** — the job crashed before or during step 1.
   Mark the job as `failed`. The client can retry by creating a new job.
   Any partial `spec.md` will be overwritten on retry.

3. **If at least one step completed** — we can resume from the next step.
   Load the session UUID from the spec folder's `active_session.json`.
   This UUID identifies the conversation that includes all completed
   steps.

4. **Restore the Claude CLI session** — the container's local filesystem
   was wiped on restart, so the `.jsonl` transcript is gone from Claude
   CLI's session directory. But it was saved to the spec folder after the
   last completed step. Call `restore_session_from_spec()` to copy it
   back. This checks whether Claude CLI already has the file first —
   if it does (e.g. the process crashed but the container didn't restart),
   it leaves the existing file in place.

5. **Re-queue the job** — set `resume_from_step` to the next step number
   and change status back to `queued`. The background task runner picks
   it up, calls `run_workflow(start_from_step=N)`, which skips already-
   completed steps and resumes the Claude CLI conversation with
   `--resume {session_id}`.

```
on startup:
    interrupted_jobs = storage.list_jobs(status="running")
    for job in interrupted_jobs:
        request = OrchestrationRequest(**job.request_payload)

        # Step 1: Find which steps completed
        completed_step = determine_last_completed_step(job)

        if completed_step is None:
            # Step 2: No steps completed — mark failed
            job.status = "failed"
            job.error = (
                "Interrupted: container restarted before "
                "any step completed"
            )
            storage.save_job(job)
            continue

        # Step 3: Load session ID from spec-level active_session.json
        session_id = None
        for spec_intent in request.spec_intents:
            spec_dir = (
                workspace_dir / request.company / request.project
                / "haikai" / "specs" / spec_intent.spec_name
            )
            spec_session_file = spec_dir / "active_session.json"
            if spec_session_file.exists():
                data = json.loads(spec_session_file.read_text())
                session_id = data.get("session_id")
                break

        if not session_id:
            job.status = "failed"
            job.error = (
                f"Interrupted after step {completed_step}: "
                f"no session found to resume"
            )
            storage.save_job(job)
            continue

        # Step 4: Restore .jsonl to Claude CLI session dir
        chat_executor = ClaudeChatExecutor(
            company=request.company,
            project=request.project,
            workspace_dir=workspace_dir,
            anthropic_api_key=anthropic_api_key,
        )
        chat_executor.session_uuid = session_id
        restored_spec = chat_executor.restore_session_from_spec()

        if not restored_spec:
            job.status = "failed"
            job.error = (
                f"Interrupted after step {completed_step}: "
                f"session .jsonl not found in spec folder"
            )
            storage.save_job(job)
            continue

        # Step 5: Re-queue with resume_from_step
        job.status = "queued"
        job.resume_from_step = completed_step + 1
        storage.save_job(job)
        background_tasks.add_task(
            _run_job_in_background, job.job_id
        )
        logger.info(
            f"Recovered job {job.job_id}: resuming from "
            f"step {completed_step + 1} "
            f"with session {session_id}"
        )
```

#### How `determine_last_completed_step` works

The orchestrator already writes step logs to disk at
`{logs_dir}/{orchestration_id}/step-{n}-{command}.json`. These are on the
volume.

```python
def determine_last_completed_step(job: Job) -> Optional[int]:
    """Check orchestration log dir for completed step files."""
    logs_dir = (
        Path(job.logs_path) if job.logs_path else None
    )
    if not logs_dir or not logs_dir.exists():
        return None

    completed = []
    for step_file in logs_dir.glob("step-*.json"):
        data = json.loads(step_file.read_text())
        if data.get("success"):
            step_num = int(step_file.stem.split("-")[1])
            completed.append(step_num)

    return max(completed) if completed else None
```

---

### 3. Step-level checkpoint tracking

Currently the orchestrator runs steps 1-2-3 sequentially but doesn't record
progress to `jobs.db` between steps. Add checkpoint writes so a recovered
job knows exactly where to resume.

#### Changes to `src/job_queue/job_models.py`

Add a `resume_from_step` field to `Job`:

```python
class Job(BaseModel):
    ...
    # Step to resume from:
    # 1=write-spec, 2=create-tasks, 3=implement-tasks
    resume_from_step: Optional[int] = None
```

#### Changes to `src/job_queue/job_storage.py`

Add `resume_from_step` column to schema (migration for existing DBs):

```python
# In _init_db(), after CREATE TABLE:
try:
    cursor.execute(
        "ALTER TABLE jobs ADD COLUMN resume_from_step INTEGER"
    )
except sqlite3.OperationalError:
    pass  # Column already exists
```

#### Changes to `src/job_queue/tasks.py`

Two changes:

**a) Write progress checkpoints after each orchestration step:**

The orchestrator calls `persist_session_to_spec(spec_name)` after each
step, which saves the `.jsonl` to the spec folder. But we also need to
update `jobs.db` so recovery knows the step number:

```python
# In run_orchestration, provide a callback to run_workflow():
def on_step_complete(step_num: int, step_description: str):
    job.progress = JobProgress(
        current_step=step_num,
        total_steps=3,
        step_description=step_description,
        percentage=int((step_num / 3) * 100),
    )
    storage.save_job(job)

response = orchestrator.run_workflow(
    start_from_step=job.resume_from_step or 1,
    on_step_complete=on_step_complete,
)
```

**b) Restore session and pass `resume_from_step` when running the job:**

```python
# Before calling orchestrator.run_workflow():
start_step = job.resume_from_step or 1

# Restore session if resuming (container may have restarted)
if start_step > 1:
    chat_executor = ClaudeChatExecutor(...)
    chat_executor.session_uuid = session_id
    chat_executor.restore_session_from_spec()

response = orchestrator.run_workflow(
    start_from_step=start_step
)
```

#### Changes to `src/haikai_orchestrator.py`

Support `start_from_step` and `on_step_complete` parameters:

```python
def run_workflow(
    self,
    start_from_step: int = 1,
    on_step_complete: Optional[
        Callable[[int, str], None]
    ] = None,
) -> OrchestrationResponse:
    ...
    commands_to_run = [
        c for c in self.COMMANDS
        if c["step"] >= start_from_step
    ]
    for cmd in commands_to_run:
        result = self._execute_step(...)
        # persist_session_to_spec already called inside
        # _execute_step

        # Notify caller to checkpoint to jobs.db
        if on_step_complete and result.status == "success":
            on_step_complete(
                cmd["step"], cmd["description"]
            )
```

---

## Recovery matrix

| Scenario                          | Last step | Session state                     | Recovery action                         |
|-----------------------------------|-----------|-----------------------------------|-----------------------------------------|
| Crash before any step runs        | None      | Session from shape-spec           | Mark `failed`, client retries           |
| Crash during `/write-spec`        | None      | Session from shape-spec only      | Mark `failed`, client retries           |
| Crash after `/write-spec`         | 1         | `.jsonl` has shape-spec + write   | Restore → resume at step 2             |
| Crash after `/create-tasks`       | 2         | `.jsonl` has through create-tasks | Restore → resume at step 3             |
| Crash during `/implement-tasks`   | 2         | `.jsonl` has through create-tasks | Restore → resume at step 3 (idempotent)|
| Crash after all steps, before git | 3         | Full `.jsonl`                     | Re-queue, git commit/push/PR only      |
| Internet drop during git push     | 3         | Full `.jsonl`                     | Re-queue, retry git push               |

---

## Session restore flow diagram

```
Container restarts
    │
    ▼
Startup recovery handler scans jobs.db
    │
    ▼ (finds job with status="running")
    │
    ├─ 1. Read step logs from
    │      logs/orchestration/{id}/step-*.json
    │      └─ Determine last completed step (e.g., step 2)
    │
    ├─ 2. Read session UUID from spec folder
    │      └─ {spec}/active_session.json → session_id
    │
    ├─ 3. Restore conversation transcript
    │      └─ Check: does Claude CLI already have
    │         ~/.claude/projects/{path}/{session_id}.jsonl?
    │         ├─ YES → leave it (more recent)
    │         └─ NO  → copy {spec}/{session_id}.jsonl
    │                  back to Claude CLI session dir
    │
    └─ 4. Re-queue job with resume_from_step=3
           └─ run_workflow(start_from_step=3)
              → --resume {session_id}
              → /implement-tasks
```

---

## Client-facing behavior

| Before this change                | After this change                                 |
|-----------------------------------|---------------------------------------------------|
| Job stuck at `"running"` forever  | Transitions to `"failed"` or re-queued on restart |
| Client must manually detect stale | Client sees `"failed"` with error or auto-resumes |
| No retry path                     | Auto-resume or client creates a new job           |

---

## Files to modify

| File                           | Change                                                |
|--------------------------------|-------------------------------------------------------|
| `src/api.py`                   | Add startup recovery handler with session restore     |
| `src/job_queue/job_models.py`  | Add `resume_from_step` field to `Job`                 |
| `src/job_queue/job_storage.py` | Add `resume_from_step` column (with migration)        |
| `src/job_queue/tasks.py`       | Checkpoints after each step; session restore on resume|
| `src/haikai_orchestrator.py` | `start_from_step` + `on_step_complete` params         |

---

## Testing

### Unit tests — `test_job_recovery.py`

These test individual functions in isolation without Docker or Claude CLI.

```python
def test_determine_last_completed_step_no_logs():
    """No log directory exists → returns None.
    Verifies the base case where a job crashed before the
    orchestrator even created its log directory."""

def test_determine_last_completed_step_partial():
    """step-1-write-spec.json (success=true),
    step-2-create-tasks.json (success=true),
    no step-3 file → returns 2.
    Verifies we correctly identify the last completed step."""

def test_determine_last_completed_step_with_failure():
    """step-1-write-spec.json (success=true),
    step-2-create-tasks.json (success=false) → returns 1.
    A failed step should not count as completed."""

def test_recovery_marks_failed_when_no_steps():
    """Job with status=running but no step log files →
    recovery sets status=failed with descriptive error."""

def test_recovery_marks_failed_when_no_session():
    """Job with completed steps but no active_session.json
    in the spec folder → status=failed."""

def test_recovery_requeues_when_steps_completed():
    """Job with step-1 done + active_session.json in spec
    folder + .jsonl backup → status=queued,
    resume_from_step=2."""

def test_run_workflow_start_from_step_skips():
    """run_workflow(start_from_step=2) should only execute
    create-tasks and implement-tasks, not write-spec."""

def test_run_workflow_on_step_complete_callback():
    """Verify on_step_complete is called after each
    successful step with the correct step number."""

def test_restore_session_does_not_overwrite_existing():
    """If .jsonl already exists in Claude CLI session dir,
    restore_session_from_spec() should leave it in place
    and return None (no restoration needed)."""

def test_restore_session_copies_when_missing():
    """If .jsonl is missing from Claude CLI session dir but
    exists in spec folder, it should be copied back."""
```

### Integration test — Docker crash simulation

This is the end-to-end test. Requires a running Docker container with a
real (or mocked) orchestration job.

**Prerequisites:**
- Container running with the recovery feature deployed
- A project with shape-spec already completed (spec folder +
  `active_session.json` + `.jsonl` exist)

**Steps:**

```bash
# 1. Start an orchestration job
curl -X POST http://localhost:8000/api/v2/jobs/orchestrations \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "testco",
    "project": "testproj",
    "spec_intents": [
      {"spec_name": "2026-03-15-test-feature"}
    ]
  }'
# → save the returned job_id

# 2. Wait until at least step 1 completes
#    Poll until step log files appear on the volume
docker exec standards-extractor-api bash -c \
  'ls /app/workspace/logs/orchestration/*/step-1-*.json \
   2>/dev/null && echo "step 1 done"'

# 3. Verify session was persisted to spec folder
docker exec standards-extractor-api bash -c \
  'ls /app/workspace/testco/testproj/haikai/specs/\
2026-03-15-test-feature/active_session.json && \
   ls /app/workspace/testco/testproj/haikai/specs/\
2026-03-15-test-feature/*.jsonl'

# 4. Kill the container (not graceful — simulates crash)
docker kill standards-extractor-api

# 5. Verify job is still "running" in jobs.db on the volume
sqlite3 ~/.haikai/jobs.db \
  "SELECT job_id, status FROM jobs WHERE job_id='$JOB_ID'"
# → should show status=running (stale)

# 6. Start container back up
docker start standards-extractor-api

# 7. Wait for health check to pass
sleep 10

# 8. Poll the job — should have been recovered
curl http://localhost:8000/api/v2/jobs/$JOB_ID
# → Expected: status changed from "running" to either:
#   a) "queued" with resume_from_step=2 (if resumable)
#   b) "failed" with error message (if not resumable)

# 9. If re-queued, wait for it to complete
#    Poll until status=completed
curl http://localhost:8000/api/v2/jobs/$JOB_ID
# → Eventually: status=completed with full result

# 10. Verify the resumed job skipped step 1
docker logs standards-extractor-api 2>&1 \
  | grep -E "(Recovered job|resuming from|start_from_step)"
# → Should show "resuming from step 2"
```

**Expected outcomes per scenario:**

| Kill timing                    | Expected recovery                            |
|--------------------------------|----------------------------------------------|
| Before step 1 log written      | Job marked `failed`, client retries          |
| After step 1 log, during step 2| Re-queued with `resume_from_step=2`          |
| After step 2 log, during step 3| Re-queued with `resume_from_step=3`          |
| After step 3, during git push  | Re-queued, only git operations run           |

### Smoke test — session restore only

Tests just the session restore without a full orchestration. Useful for
quick validation after deploying.

```bash
# 1. Confirm a .jsonl exists in a spec folder
docker exec standards-extractor-api bash -c \
  'ls /app/workspace/*/*/haikai/specs/*/*.jsonl | head -1'

# 2. Delete the Claude CLI session copy (simulate restart)
docker exec standards-extractor-api bash -c \
  'rm -rf /home/appuser/.claude/projects/*'

# 3. Trigger restore (via a resume call or startup handler)
docker restart standards-extractor-api
sleep 10

# 4. Verify .jsonl was copied back
docker exec standards-extractor-api bash -c \
  'ls /home/appuser/.claude/projects/*/*.jsonl 2>/dev/null \
   && echo "restored" || echo "NOT restored"'
```

---

## Out of scope

- Automatic retry with exponential backoff (client can re-submit)
- Per-project locking to prevent concurrent orchestration jobs
- Notification/webhook on job failure or recovery
- Heartbeat/liveness check during long-running steps

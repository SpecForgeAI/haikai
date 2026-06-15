# Haikai orchestrator

Chains the 4-step Haikai lifecycle into one orchestrated run. Lives at `src/haikai_orchestrator.py`. Invoked via `POST /api/v1/orchestrations` (sync) or `POST /api/v1/jobs/orchestrations` (async via [[job-queue]]).

Sits one level above the [[chat-executors]] layer: each step is itself a chat-executor `stream_message` invocation against the same active session.

## The 4 steps

```python
COMMANDS = [
    {"step": 1, "command": "/write-spec",                "description": "Write specification"},
    {"step": 2, "command": "/create-tasks",              "description": "Create task list"},
    {"step": 3, "command": "/implement-tasks",           "description": "Implement all tasks"},
    {"step": 4, "command": "/git-commit-preparation",    "description": "Prepare workspace for git commit",
                                                          "non_fatal": True},
]
```

Step 4 (`/git-commit-preparation`) is `non_fatal=True` — its failure is logged but does not abort the orchestration. The first three are blocking.

## Pre-existence rule

The orchestrator's docstring (`haikai_orchestrator.py:38-`):

> Spec folders and requirements.md MUST be created by /shape-spec before orchestration. The orchestrator never creates folders or stub files — it only processes pre-shaped specs.

Step 0 is not a real step — it's a validation. Each spec listed in `request.spec_intents` must already have:
- `haikai/specs/<spec-name>/` directory
- `haikai/specs/<spec-name>/planning/requirements.md`

Missing either → the orchestration fails for that spec before any LLM call. This separation is deliberate: shape-spec is interactive (it asks clarifying questions via `/ask-questions`) and shouldn't run inside a non-interactive orchestration.

The flow is:
1. Operator runs `POST /shape-spec/stream` (interactive, multi-turn) — produces `requirements.md`.
2. Operator runs `POST /orchestrations` (non-interactive, runs to completion) — consumes `requirements.md`, produces `spec.md` → `tasks.md` → implementation.

## Path-safety at the boundary

`__init__` validates `request.company` and `request.project` segments via `safe_segment` *before* joining them to `workspace_dir` (same pattern as [[chat-sessions-and-audit]] and [[tool-executor]]). The docstring is explicit about why:

> `..` would otherwise let `workspace_dir/<company>/<project>` escape via Path's parent-traversal semantics. The pre-existence checks below are not security checks; for `company=".."`, the resolved `workspace_dir/..` typically exists (parent of workspace) so they'd pass too.

## How each step runs

Each step is a `ClaudeChatExecutor.stream_message(...)` call against the same `session_id`. The session is the resumption mechanism — step 2 (`/create-tasks`) runs against the conversation context that step 1 (`/write-spec`) left behind. This is what makes the lifecycle coherent rather than three independent LLM calls that might contradict each other.

After each step:
- The full SSE event stream is captured to a per-step JSON log file under `<logs_dir>/orchestration/<run-id>/step-<N>-<command>.json`.
- `output_paths` are extracted from `file_modified` events and surfaced in the response.
- `execution_time_seconds` is recorded.

## Stop on error

`OrchestrationRequest.options.stop_on_error: bool = True` (default). When set:
- Step 1 fails → orchestration aborts; steps 2–4 don't run.
- Step 2 fails → orchestration aborts; steps 3–4 don't run.
- etc.

When `False`: each step is independent; failures are recorded but don't gate downstream steps. Useful when re-running a partial orchestration where step 1 already succeeded in a prior run.

## Multi-spec orchestration

`request.spec_intents` is a list — one orchestration can run the full lifecycle on multiple specs sequentially. Each spec gets its own session ID and its own log directory. A failure in spec N still allows spec N+1 to proceed (independent of the per-step `stop_on_error` flag).

## Async via job queue

`POST /api/v1/jobs/orchestrations` enqueues a `JobType.ORCHESTRATION` ([[job-queue]]) instead of running synchronously. The worker process picks it up, instantiates an `HaikaiOrchestrator`, and runs the same logic. The client polls `GET /jobs/{id}` for status. Recovery from worker crashes is handled by `_recover_interrupted_jobs` at API startup ([[api-layer]] § "Background-job recovery").

## What it's *not*

- **Not the orchestrator for [[standards-pipeline]].** That's `StandardsOrchestrator` — a different class with a different mission (extract coding standards, not build features).
- **Not where shape-spec runs.** Shape-spec is interactive; orchestrator handles only the deterministic phases.
- **Not where [[agentic-discovery]] runs.** Discovery is independent — it's a feature of the V2 extraction pipeline, not part of the SDD lifecycle.

## Cross-references

- [[haikai-sdd]] — the lifecycle this orchestrator chains
- [[async-verification-orchestration]] — the newer verification layer around `/orchestrate-tasks` (this v1 chain has no real verification step)
- [[chat-executors]] — what each step actually invokes
- [[chat-sessions-and-audit]] — session resumption between steps
- [[job-queue]] — async-mode dispatch path
- [[api-layer]] — REST surface

## Sources

- `src/haikai_orchestrator.py`, `src/haikai_models.py`
- `src/path_safety.py`
- [[../../raw/2026-05-04_codebase-walk]]

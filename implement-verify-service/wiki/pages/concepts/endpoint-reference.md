# Endpoint reference (verify-service HTTP API)

The authoritative endpoint census for `implement-verify-service/`, as of
2026-06-21 (post Phase A.x router modularization). **~74 endpoints across 17
route modules.** This is the *listing*; [[api-layer]] is the structural
*synthesis* (patterns, auth, why-it's-shaped-this-way). Where they disagree,
trust this page's counts — `api-layer` deferred listings to `docs/API.md`, which
also lagged the refactor. Source: [[../../raw/2026-06-21_verify-service-endpoint-deep-dive]].

## Conventions

- **Auth** column: `key` = `Depends(verify_api_key)` (Bearer `STANDARDS_API_KEY`);
  `key+git` = also `_require_git_manager` (project must be `POST /projects/init`'d);
  `webhook` = ingress-token + provider-signature (no Bearer); `none` = open.
- **Exec**: `sync` (blocks in service/SQLite), `pool` (ThreadPoolExecutor via
  `run_in_executor`), `SSE` (streaming), `bg` (FastAPI BackgroundTasks).
- `{c}/{p}` = `{company}/{project}`. v1 = no git; v2 = git-integrated.

## Root (src/api/__init__.py) — 2

| Method | Path | Auth | Exec | Dispatch |
|---|---|---|---|---|
| GET | `/health` | none | sync | liveness `{"status":"healthy"}` |
| GET | `/api/v1/metamodels/{c}/{p}/{metamodel_id}` | key | pool | OperationExecutor → metamodel fetch |

## Orchestration (routes/orchestration.py) — 5

| Method | Path | Auth | Exec | Dispatch |
|---|---|---|---|---|
| POST | `/api/v1/orchestrations` | key | pool | HaikaiOrchestrator.run_workflow (write-spec→create-tasks→implement-tasks) |
| POST | `/api/v2/orchestrations/brain-only` | key | pool | run_brain_workflow (spec+tasks, no implement) → ImplementationPackage |
| GET | `/api/v1/orchestrations/{id}/status` | key | sync | reads step JSON from ORCHESTRATION_LOG_DIR |
| GET | `/api/v1/orchestrations/{id}/logs` | key | sync | structured logs, `?step=N` filter |
| POST | `/api/v2/orchestrations` | key+git | sync | HaikaiOrchestrator inline + `apply_git_workflow` (branch+commit+PR) |

`{id}` is validated against `YYYYMMDD_HHMMSS` by `_safe_orchestration_id`
(path-traversal guard). Async equivalent of the v2 sync path is
`POST /api/v2/jobs/orchestrations`.

## Specs / Haikai CRUD (routes/specs.py) — 13

All dispatch to `HaikaiService` via `get_haikai_service()`. v1 = sync service
calls; v2 adds git. v2 write-spec & tasks/generate are **commit-only**
(orchestration owns push+PR, per spec 2026-03-15-deferred-branch-creation);
v2 implement does commit+push+PR.

| Method | Path | Auth | Service call |
|---|---|---|---|
| GET | `/api/v1/specs/{c}/{p}` | key | list_specs |
| GET | `/api/v1/specs/{c}/{p}/{spec_id}` | key | get_spec |
| POST | `/api/v1/specs/{c}/{p}/write-spec` | key | write_spec |
| DELETE | `/api/v1/specs/{c}/{p}/{spec_id}` | key | delete_spec |
| GET | `/api/v1/specs/{c}/{p}/{spec_id}/tasks` | key | get_tasks |
| POST | `/api/v1/specs/{c}/{p}/{spec_id}/tasks/generate` | key | generate_tasks |
| POST | `/api/v1/specs/{c}/{p}/{spec_id}/implement` | key | implement_tasks |
| POST | `/api/v2/specs/{c}/{p}/write-spec` | key+git | write_spec + commit-only |
| POST | `/api/v2/specs/{c}/{p}/{spec_id}/tasks/generate` | key+git | generate_tasks + commit-only |
| POST | `/api/v2/specs/{c}/{p}/{spec_id}/implement` | key+git | implement_tasks + commit+push+PR |
| GET | `/api/v2/specs/{c}/{p}` | key+git | list_specs (requires init) |
| GET | `/api/v2/specs/{c}/{p}/{spec_id}` | key+git | get_spec (requires init) |
| GET | `/api/v2/specs/{c}/{p}/{spec_id}/tasks` | key+git | get_tasks (requires init) |

## Standards (routes/standards.py) — 3

| Method | Path | Auth | Exec | Dispatch |
|---|---|---|---|---|
| POST | `/api/v1/standards/product/generate` | key | pool | run_operation → OperationExecutor ([[standards-pipeline]]) |
| POST | `/api/v1/standards/global/generate` | key | pool | run_operation (global baseline) |
| POST | `/api/v2/standards/product/generate` | key+git | pool | run_operation + git workflow; git errors land in `errors` |

## Async jobs (routes/jobs.py) — 6

See [[job-queue]] for the lifecycle. Enqueue returns `JobResponse` (QUEUED
immediately); poll returns `JobDetailResponse`.

| Method | Path | Auth | Dispatch |
|---|---|---|---|
| POST | `/api/v1/jobs/orchestrations` | key | enqueue ORCHESTRATION job |
| GET | `/api/v1/jobs/{job_id}` | key | poll status/progress/result |
| GET | `/api/v1/jobs` | key | list, filter `status`/`company`/`project`/`limit` |
| DELETE | `/api/v1/jobs/{job_id}` | key | atomic cancel (QUEUED/RUNNING only) |
| POST | `/api/v2/jobs/orchestrations` | key+git | enqueue + BackgroundTasks dispatch; multi-spec → per-spec branch |
| GET | `/api/v2/jobs/{job_id}` | key+git | poll (requires init) |

## Streaming chat (routes/chat.py) — 12

All `POST .../stream` are SSE (`text/event-stream`). Each dispatches
`create_chat_executor(...).stream_message(message, is_new_session, command_name)`
on a threadpool→`asyncio.Queue`→SSE bridge ([[chat-executors]]); client
disconnect sets `stop_flag` (best-effort cancel). Session resolved via
`active_session.json` (new vs resume). Endpoint bodies also call
`require_credentials()` (LLM-auth gate) after `verify_api_key`.

| Method | Path | Auth | command_name |
|---|---|---|---|
| POST | `/api/v1/shape-spec/stream` | key | shape-spec |
| GET | `/api/v1/shape-spec/history` | key | — (AuditLogger read) |
| DELETE | `/api/v1/shape-spec` | key | clear_session |
| POST | `/api/v1/plan-product/stream` | key | plan-product |
| GET | `/api/v1/plan-product/history` | key | — |
| DELETE | `/api/v1/plan-product` | key | clear_session |
| POST | `/api/v1/story-component-anchor/stream` | key | story-component-anchor (always new session) |
| POST | `/api/v1/analyze-repo/stream` | key | analyze-repo (clones/validates repo, runs extract pipeline) |
| POST | `/api/v2/shape-spec/stream` | key+git | shape-spec + `gm.pull_latest()` |
| POST | `/api/v2/plan-product/stream` | key+git | plan-product + commit+PR on completion |
| GET | `/api/v2/shape-spec/history` | key+git | — |
| GET | `/api/v2/plan-product/history` | key+git | — |

**SSE event types** (only `CLIENT_EVENTS = {session, questions, folder, error,
retry, retry_progress, questions_failed}` reach the client; the rest —
`content`, `skill_invoked`, `file_modified` — are audited locally). v2 adds
`message` and `git_error`. First frame is always
`{"type":"session","session_id":"<uuid>"}`.

## Batch shape-spec (routes/haikai.py) — 3

| Method | Path | Auth | Dispatch |
|---|---|---|---|
| POST | `/api/v1/haikai/shape-specs` | key | `_build_cli_executor` → `/shape-spec`, threadpool |
| GET | `/api/v1/haikai/shape-specs/{c}/{p}` | key | list spec folders |
| POST | `/api/v2/haikai/shape-specs` | key+git | git-integrated batch |

## Polyrepo (routes/projects.py + routes/repos.py) — 5

| Method | Path | Auth | Dispatch |
|---|---|---|---|
| POST | `/projects/init` | key | clone N repos, rollback-all-on-failure, write `coordination.yaml` |
| GET | `/projects/{c}/{p}/repos` | key | read `coordination.yaml` → folder→URL map |
| POST | `/projects/{c}/{p}/repos` | key | clone new repo, atomically update map |
| PUT | `/projects/{c}/{p}/repos/{folder}` | key | back up + re-clone from new URL |
| DELETE | `/projects/{c}/{p}/repos/{folder}` | key | enforce ≥1 repo, delete folder |

## Code intelligence — discovery / dep / refactor / structural — 17

`/api/discovery`, `/api/dep`, `/api/refactor` get auth at **include-time**
(every route protected); `/api/v1/structural` declares it **per-route**.

| Method | Path | Auth | Dispatch |
|---|---|---|---|
| POST | `/api/discovery/endpoints` | key | V1 LLM endpoint discovery ([[agentic-discovery]]) |
| POST | `/api/discovery/diagrams` | key | V1 diagram discovery |
| GET | `/api/discovery/trace` | key | latest discovery conversation trace |
| GET | `/api/dep/impact` | key | impact_of(symbol) on [[dep-graph]] |
| GET | `/api/dep/trace` | key | trace_from(seed), json or mermaid |
| GET | `/api/dep/context` | key | context_of(symbol) |
| GET | `/api/dep/processes` | key | processes_in(graph) |
| POST | `/api/dep/rebuild` | key | rebuild `_depgraph.sqlite` (write) |
| GET | `/api/refactor/detect` | key | change_detector ([[refactoring-engines]]) |
| GET | `/api/refactor/rename-preview` | key | dry-run rename |
| POST | `/api/refactor/rename-apply` | key | apply rename (write; `confirm:true` required) |
| GET | `/api/refactor/staleness` | key | snapshot staleness vs repo |
| POST | `/api/v1/structural/analyze` | key | clone + ctags + tree-sitter → snapshot ([[structural-store]]) |
| POST | `/api/v1/structural/{repo}/raw` | key | read raw `_index.txt` etc. |
| POST | `/api/v1/structural/{repo}/query` | key | keyword / NL query over index |
| POST | `/api/v1/structural/{repo}/metamodel/populate` | key | populate metamodel from snapshot ([[metamodel-system]]) |
| POST | `/api/v1/structural/{repo}/diagrams/generate` | key | mermaid/plantuml/graphviz/metamodel ([[diagram-generation]]) |

## Implementation packages (api/packages.py) — 2

| Method | Path | Auth | Dispatch |
|---|---|---|---|
| GET | `/api/v2/orchestrations/{c}/{p}/{spec_name}/package` | key | portable spec bundle as `application/zip` |
| GET | `/api/v2/orchestrations/{c}/{p}/{spec_name}/package/json` | key | same as `ImplementationPackage` JSON |

## Verification gateway (routes/inbound.py + routes/bugs.py) — 6

The async re-entry surface. **`POST /api/v2/inbound/...` is the only
non-Bearer endpoint in the app** — CI providers authenticate by webhook
signature, not the API key. Full flow in [[inbound-gateway]].

| Method | Path | Auth | Dispatch |
|---|---|---|---|
| POST | `/api/v2/inbound/{provider}/{ingress_token}` | webhook | correlate SHA→cell, record verdict, enqueue fresh VERIFY_TASK_GROUP |
| POST | `/api/v2/reconciliation` | key | record findings, supersede pending cell verdicts |
| GET | `/api/v2/reconciliation/{orchestrate_id}/findings` | key | list findings (`?status=`) |
| GET | `/api/v2/verification/{orchestrate_id}/events` | key | event log; `?stream=true` → SSE (D6 projection) |
| POST | `/api/v2/bugs/` | key | enqueue BUG_INVESTIGATION job |
| GET | `/api/v2/bugs/{bug_id}` | key | poll bug result/outcome |

## Per-module count

| Module | Endpoints |
|---|---|
| `__init__.py` | 2 |
| `routes/orchestration.py` | 5 |
| `routes/specs.py` | 13 |
| `routes/standards.py` | 3 |
| `routes/jobs.py` | 6 |
| `routes/chat.py` | 12 |
| `routes/haikai.py` | 3 |
| `routes/projects.py` + `routes/repos.py` | 5 |
| `api/discovery_routes.py` | 3 |
| `api/dep_routes.py` | 5 |
| `api/refactor_routes.py` | 4 |
| `structural_endpoints.py` | 5 |
| `api/packages.py` | 2 |
| `routes/inbound.py` | 4 |
| `routes/bugs.py` | 2 |
| **Total** | **74** |

## Cross-references

- [[api-layer]] — structural synthesis (the 3 repeated patterns, auth philosophy)
- [[job-queue]] — what the jobs/* and verification endpoints enqueue
- [[inbound-gateway]] — the webhook re-entry path in depth
- [[chat-executors]] — what the streaming endpoints dispatch to
- [[async-verification-orchestration]] — the pipeline the verification endpoints feed
- [[haikai-orchestrator]] — what orchestration/specs endpoints invoke

## Sources

- [[../../raw/2026-06-21_verify-service-endpoint-deep-dive]]
- `src/api/__init__.py`, `src/api/routes/*.py`, `src/api/{dep,refactor,discovery}_routes.py`
- `src/structural_endpoints.py`, `src/api/packages.py`
- `src/api_auth.py`, `src/api/{factories,gates,recovery}.py`
</content>

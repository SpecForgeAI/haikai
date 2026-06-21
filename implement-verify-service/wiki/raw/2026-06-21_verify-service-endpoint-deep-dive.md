# Verify-Service Endpoint Deep-Dive — snapshot 2026-06-21

> Synthesis input for the endpoint-reference + inbound-gateway pages and the
> api-layer / job-queue revisions. Captures the HTTP surface of
> `implement-verify-service/` as of branch `main` (post Phase A.x router
> modularization). Read by five parallel source-reading agents on 2026-06-21.
> This is the raw view; the wiki pages are the synthesis.

## Why this snapshot exists

The prior foundation pages were written against the 2026-05-04 codebase walk,
when the API was "a single ~4,000-line `src/api/__init__.py` with 27 endpoints
across 6 groups." Since then the **Phase A.x modularization landed**:
`__init__.py` is now an ~836-line mounting shell, and every endpoint group was
extracted into `src/api/routes/*.py` and sibling `src/api/*_routes.py` modules.
`api-layer.md` still described the old shape — this deep-dive corrects it and
adds the endpoint-level detail the original deferred to `docs/API.md`.

## What `__init__.py` is now (836 lines)

A mounting shell, not an endpoint file. It:
- builds the `FastAPI` app + OpenAPI tags + CORS (`localhost:5173`)
- defines shared helpers: `sanitize_path`, `_safe_project_dir` (399),
  `_safe_orchestration_id` (69), `_require_git_manager` (724),
  `load_env_config` (255), `run_operation` (415)
- mounts ~15 routers (`app.include_router(...)`)
- runs `_recover_interrupted_jobs()` at import (412)
- holds only TWO endpoints itself: `GET /health` (431) and
  `GET /api/v1/metamodels/{company}/{project}/{metamodel_id}` (451)
- the body is now mostly `# <path> -> src/api/routes/X.py (Phase A.x)`
  breadcrumb comments where endpoints used to live

## Router mounting (src/api/__init__.py)

| Router | Mounted | Auth applied |
|---|---|---|
| `structural_endpoints.router` | line 172 | per-route `Depends(verify_api_key)` |
| `dep_routes.router` | 353 | include-time `dependencies=[Depends(verify_api_key)]` |
| `refactor_routes.router` | 354 | include-time dependency |
| `discovery_routes.router` | 355 | include-time dependency |
| `routes.orchestration.router` | 535 | per-route |
| `routes.specs.router` | 538 | per-route |
| `routes.standards.router` | 541 | per-route |
| `routes.jobs.router` | 544 | per-route |
| `routes.chat.router` | 547 | per-route |
| `routes.inbound.router` | 553 | **none** (webhook auth — see below) |
| `routes.bugs.router` | 557 | per-route |
| `routes.haikai.router` | 560 | per-route |
| `routes.projects.router` | 563 | per-route |
| `routes.repos.router` | 565 | per-route |
| `packages.router` | 568 | per-route |

## Full endpoint census (~74 endpoints, 17 modules)

### __init__.py (2)
- `GET /health` — liveness, no auth (431)
- `GET /api/v1/metamodels/{company}/{project}/{metamodel_id}` — fetch metamodel via OperationExecutor (451)

### routes/orchestration.py (5) — `router = APIRouter()` (no prefix)
- `POST /api/v1/orchestrations` → HaikaiOrchestrator.run_workflow, threadpool (63)
- `POST /api/v2/orchestrations/brain-only` → run_brain_workflow, threadpool (114)
- `GET /api/v1/orchestrations/{orchestration_id}/status` — reads step JSON from ORCHESTRATION_LOG_DIR (165)
- `GET /api/v1/orchestrations/{orchestration_id}/logs` — `?step=` filter (260)
- `POST /api/v2/orchestrations` → HaikaiOrchestrator inline + apply_git_workflow, git-gated (339)
- orchestration_id validated by `_safe_orchestration_id` (YYYYMMDD_HHMMSS)

### routes/specs.py (13) — no prefix
V1 (no git): GET list (73), GET one (100), POST write-spec (130), DELETE (167),
GET tasks (197), POST tasks/generate (227), POST implement (264)
V2 (git-gated via `_require_git_manager`): POST write-spec commit-only (300),
POST tasks/generate commit-only (354), POST implement commit+push+PR (404),
GET list (471), GET one (494), GET tasks (520)
All dispatch to `HaikaiService` via `get_haikai_service()`. V1 = sync service calls.

### routes/standards.py (3) — no prefix
- `POST /api/v1/standards/product/generate` → run_operation (threadpool) (35)
- `POST /api/v1/standards/global/generate` → run_operation (81)
- `POST /api/v2/standards/product/generate` → run_operation + git workflow (115)

### routes/jobs.py (6) — no prefix
- `POST /api/v1/jobs/orchestrations` → job_queue.enqueue_job, returns QUEUED (49)
- `GET /api/v1/jobs/{job_id}` poll (98)
- `GET /api/v1/jobs` list, filter status/company/project/limit (146)
- `DELETE /api/v1/jobs/{job_id}` atomic cancel (189)
- `POST /api/v2/jobs/orchestrations` enqueue + BackgroundTasks dispatch, git-gated (221)
- `GET /api/v2/jobs/{job_id}` git-gated poll (283)

### routes/chat.py (12) — no prefix, all SSE or history/clear
V1: POST shape-spec/stream (69), GET shape-spec/history (248), DELETE shape-spec (284),
POST plan-product/stream (336), GET plan-product/history (486), DELETE plan-product (520),
POST story-component-anchor/stream (582), POST analyze-repo/stream (702)
V2 (git-gated): POST shape-spec/stream (830), POST plan-product/stream (939),
GET shape-spec/history (1082), GET plan-product/history (1106)
All streams dispatch `create_chat_executor(...).stream_message(msg, is_new_session, command_name)`
on a threadpool→asyncio.Queue→SSE bridge. Client disconnect sets `stop_flag`.

### routes/haikai.py (3) — batch shape-spec
- `POST /api/v1/haikai/shape-specs` → `_build_cli_executor`, threadpool (56)
- `GET /api/v1/haikai/shape-specs/{company}/{project}` — list spec folders (225)
- `POST /api/v2/haikai/shape-specs` — git-gated (305)

### routes/projects.py (1) + routes/repos.py (4) — polyrepo
- `POST /projects/init` — clone N repos, rollback-all-on-failure, write coordination.yaml (104)
- `GET/POST /projects/{company}/{project}/repos`, `PUT/DELETE /…/repos/{folder}` (137/160/228/316)

### api/discovery_routes.py (3) — prefix `/api/discovery`, include-time auth
- POST /endpoints (V1 endpoint discovery) (118), POST /diagrams (196), GET /trace (264)

### api/dep_routes.py (5) — prefix `/api/dep`, include-time auth
- GET /impact (34), GET /trace (52), GET /context (78), GET /processes (93), POST /rebuild (116)

### api/refactor_routes.py (4) — prefix `/api/refactor`, include-time auth
- GET /detect (34), GET /rename-preview (52), POST /rename-apply (write, confirm-gated) (86), GET /staleness (111)

### structural_endpoints.py (5) — prefix `/api/v1/structural`, per-route auth
- POST /analyze (330), POST /{repo}/raw (442), POST /{repo}/query (484),
  POST /{repo}/metamodel/populate (573), POST /{repo}/diagrams/generate (642)

### api/packages.py (2) — no prefix, per-route auth
- GET /api/v2/orchestrations/{company}/{project}/{spec_name}/package (zip) (49)
- GET /api/v2/orchestrations/{company}/{project}/{spec_name}/package/json (132)

### routes/inbound.py (4) — VERIFICATION inbound gateway
- `POST /api/v2/inbound/{provider}/{ingress_token}` — **NOT verify_api_key**;
  ingress-token + provider-signature auth (D10.4); enqueues VERIFY_TASK_GROUP (124)
- `POST /api/v2/reconciliation` — verify_api_key; records findings, supersedes pending (200)
- `GET /api/v2/reconciliation/{orchestrate_id}/findings` — verify_api_key (323)
- `GET /api/v2/verification/{orchestrate_id}/events` — verify_api_key; JSON or SSE (D6) (334)

### routes/bugs.py (2)
- `POST /api/v2/bugs/` — verify_api_key; enqueues BUG_INVESTIGATION job (91)
- `GET /api/v2/bugs/{bug_id}` — poll bug result (132)

## Auth model (two independent layers)

1. **API edge** — `verify_api_key` (src/api_auth.py:22): `HTTPBearer`, reads
   `STANDARDS_API_KEY` every request, `secrets.compare_digest` (constant-time),
   **500 if env unset** (server misconfig), **401 if token wrong**. Applied
   per-route or at include-time on every router EXCEPT inbound.
2. **LLM credential** — `require_credentials` (src/api/gates.py:32): checks
   `ANTHROPIC_API_KEY` OR active backend `brings_own_auth` (Kiro SSO); **503**
   if neither. Returns the key (or "" for SSO backends). Called inside chat /
   shape-spec endpoint bodies, after API auth passes.
3. **Webhook** — inbound gateway: path `ingress_token` vs
   `SX_INGRESS_TOKEN_{PROVIDER}` (constant-time) + provider signature
   (`SX_WEBHOOK_SECRET_{PROVIDER}`; GitHub HMAC-SHA256 `x-hub-signature-256`,
   GitLab `x-gitlab-token`). The API Bearer scheme deliberately does not apply —
   CI providers can't carry it (D10.4).

## Executor dispatch (src/api/factories.py:145 + backend_registry.py)

`create_chat_executor` → `_active_backend().chat_executor_factory(...)`, selected
by `CHAT_EXECUTOR` env var (required; 503 if unset/unknown):
- `claude` → `_build_claude_chat_executor` priority chain:
  1. OAuth token (`sk-ant-oat…`) → ClaudeChatExecutor (OpenAI if running as root)
  2. Claude CLI present (local `node_modules/.bin/claude[.cmd]` or PATH) → ClaudeChatExecutor
  3. `OPENAI_API_KEY` set → OpenAIChatExecutor (default model gpt-4o)
  4. last resort → ClaudeChatExecutor anyway
- `kiro` → KiroChatExecutor (SSO; brings_own_auth=True; ignores extra_dirs)
This is the no-fallback-by-CHAT_EXECUTOR design (see auto-memory
no-fallback-backend-selection): the *backend* is explicit; the priority chain is
only *within* the claude backend.

## Verification pipeline wiring (the load-bearing async path)

Three verification JobTypes (job_models.py:26-39):
- `VERIFY_TASK_GROUP` → tasks.run_verify_task_group (452) → ClaudeCLIExecutor
  `/verify-task-group orchestrate_id=… task_group_id=… repo=… verification_db=…`
- `BUG_INVESTIGATION` → tasks.run_bug_investigation (904) → `/haikai:debug` + `/haikai:fix`,
  POSTs result to callback_url
- `HAIBOX_VERIFY` → tasks.run_haibox_verify (537) → HaiboxClient provision+run+replay

Re-entry (D10.2): the verification-loop is **stateless and one-shot**. A
`ci-trigger`/`observe` cell that's still `pending` means the loop exited. When the
provider webhook lands minutes-to-days later:
`inbound()` (inbound.py:124) → authenticate → dedup on delivery id →
`store.lookup_binding(head_sha, provider)` (the D10.4 authenticated SHA→cell
binding recorded at trigger time; 409 if missing) → map status→verdict via
connector YAML → `recorder.record_verdict_with_delivery()` (R7: delivery-mark +
verdict in ONE txn) → `_enqueue_reinvoke()` (inbound.py:87) enqueues a **fresh**
VERIFY_TASK_GROUP job to `jobs.db` (never resumed) → worker picks it up → loop
reconstructs ALL state from `verification_db` and re-evaluates the D5 gate.

Guarded writes (src/verification/recorder.py): `record_verdict` (37, atomic
attempt = MAX+1), `record_verdict_with_delivery` (89, R7), `supersede_pending`
(136, R1 pending→final only), `advance` (202, refuses red-gate + double-advance),
`open_repair` (236, refuses attempt>3 / ATTEMPT_CAP=3), `update_checklist` (254,
unguarded). `record_hook` (194) is side-effect-only — hooks never gate.

TTL sweeper (D10.5, src/verification/sweeper.py): pending cells >24h → `timeout`
(terminal). Backstop for a webhook that never arrives.

## Code-vs-wiki drift verified by readers

- `async-verification-orchestration.md` — every D1/D5/D10.x claim MATCHES code.
- `2026-05-31_async-verification-self-repair.md` — MATCHES; repair-classifier
  agent is design-only / not wired (open_repair guard exists, agent dispatch
  doesn't) — consistent with the raw doc's own "design, not yet implemented".
- `api-layer.md` — STALE (corrected by this ingest).
- `job-queue.md` — STALE JobType list (corrected by this ingest).

## Source files read

```
src/api/__init__.py (mounting shell, 836 lines)
src/api/routes/{orchestration,specs,standards,jobs,chat,haikai,projects,repos,inbound,bugs}.py
src/api/{dep_routes,refactor_routes,discovery_routes,packages,factories,gates,recovery}.py
src/structural_endpoints.py
src/api_auth.py
src/backend_registry.py
src/job_queue/{job_models,job_queue,job_storage,worker,tasks}.py
src/verification/{store,recorder,sweeper,outcomes}.py
src/verification/connectors/{github_actions,gitlab_ci,loader}.py
```
</content>
</invoke>

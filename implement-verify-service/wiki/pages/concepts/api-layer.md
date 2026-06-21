# API layer

A FastAPI app whose endpoints live across **17 route modules**: `src/api/__init__.py`
is now an ~836-line *mounting shell* that builds the app, defines shared helpers,
and `include_router`s the rest. **~74 endpoints across 9 functional groups.** For
the full method/path/auth/dispatch census see [[endpoint-reference]]; this page is
the *structural* synthesis — patterns, not listings.

> **Corrected [2026-06-21].** This page previously claimed "a single ~4,000-line
> `__init__.py`, 27 endpoints, 6 groups" and that "a refactor toward router
> modules was attempted and reverted." That described the 2026-05-04 snapshot.
> The opposite is now true in the code: the **Phase A.x modularization landed** —
> every endpoint group was extracted into `src/api/routes/*.py` (+ the three
> `src/api/*_routes.py` siblings), and `__init__.py`'s body is mostly
> `# <path> -> src/api/routes/X.py (Phase A.x)` breadcrumbs. The endpoint count
> roughly tripled (v1+v2 git variants, polyrepo, verification gateway). See
> [[../../raw/2026-06-21_verify-service-endpoint-deep-dive]].

## The functional groups

Endpoints are now grouped by *router module*, not `# ====` banners in one file:

| Group | Module(s) | Pattern |
|---|---|---|
| **Standards Generation** | `routes/standards.py`, metamodel in `__init__.py` | request → OperationExecutor → file output |
| **Haikai CRUD** | `routes/specs.py`, `routes/haikai.py` | spec lifecycle on disk (v1) / git (v2) |
| **Orchestrations** | `routes/orchestration.py` | chained workflow execution |
| **Streaming Chat** | `routes/chat.py` | SSE generator → wire |
| **Async Job Queue** | `routes/jobs.py` | enqueue + poll ([[job-queue]]) |
| **Polyrepo** | `routes/projects.py`, `routes/repos.py` | multi-repo init + CRUD on `coordination.yaml` |
| **Code intelligence** | `dep_routes.py`, `discovery_routes.py`, `refactor_routes.py`, `structural_endpoints.py` | snapshot queries ([[dep-graph]], [[agentic-discovery]], [[refactoring-engines]], [[structural-store]]) |
| **Verification gateway** | `routes/inbound.py`, `routes/bugs.py` | webhook re-entry + bug intake ([[inbound-gateway]]) |
| **Health** | `__init__.py` | trivial liveness |

## Why it modularized (and why `__init__.py` is still a shell)

The earlier single-file shape was held together by shared helpers and `# ====`
banners. Phase A.x split each coherent domain into its own router while keeping
`__init__.py` as the **mounting + shared-helper layer**: it still owns
`_safe_project_dir`, `_safe_orchestration_id`, `_require_git_manager`,
`load_env_config`, `run_operation`, the job queue handle, and the startup
recovery call — the routers lazy-import these from it to avoid load cycles. So
the file shrank from "every endpoint" to "everything endpoints share."

## Auth

Single Bearer token check at request edge: `verify_api_key` dependency on every endpoint. The token is `STANDARDS_API_KEY` env var. CORS configured for `localhost:5173` (dev frontend) and the host's own origin.

| Layer | What it gates |
|---|---|
| API auth | `STANDARDS_API_KEY` Bearer — protects every endpoint *except* the inbound gateway |
| LLM auth | per-LLM-call: Anthropic API key, OAuth token, or OpenAI key — see [[chat-executors]] for the OAuth detection path |

The two are independent. A request can authenticate to the API and then fail at the LLM layer if no provider credential is configured. `verify_api_key` (`src/api_auth.py:22`) uses constant-time `secrets.compare_digest`; a missing `STANDARDS_API_KEY` env yields **500** (server misconfig), a wrong token **401**. The LLM gate is `require_credentials` (`src/api/gates.py:32`) → **503** when no `ANTHROPIC_API_KEY` and the active backend doesn't bring its own auth (Kiro SSO does). The **one exception** to API auth is `POST /api/v2/inbound/{provider}/{ingress_token}`, which authenticates by webhook signature instead — see [[inbound-gateway]].

## Three patterns repeated across endpoints

### 1. Workspace path resolution

Every endpoint that touches per-project files goes through `_safe_project_dir(company, project)` at `__init__.py:399` (routers lazy-import it). This is the central path-safety helper — rejects `..`, absolute paths, and Windows drive letters in the URL/body segments. Same pattern that landed in `tool_executor._safe_workspace_path` and `session_store._session_file` (commit `014de40` series). Single source of truth for "is this URL-supplied path actually under the workspace?" lives in `src/path_safety.py`.

### 2. Executor factory dispatch

Chat endpoints all funnel through `create_chat_executor(company, project, workspace_dir, anthropic_api_key)` — now in `src/api/factories.py:145` (re-exported from `src.api` for back-compat), selected by the `CHAT_EXECUTOR` backend registry. See [[chat-executors]] for the dispatch order. The factory pattern means endpoint code never directly imports a specific executor class — they get whichever executor matches the runtime config.

### 3. SSE streaming pattern

Streaming chat endpoints share a shape:

```python
async def shape_spec_stream(request, authenticated):
    session_id = create_active_session(...) or get_active_session(...)
    executor = create_chat_executor(...)
    executor.session_uuid = session_id

    def event_stream():
        yield f"data: {json.dumps({'type': 'session', 'session_id': session_id})}\n\n"
        for event in executor.stream_message(message, is_new_session, command_name):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

The events the generator yields ([[chat-executors]] § "Shared contract") map 1:1 to SSE messages on the wire. No per-endpoint event translation.

## Background-job recovery

`_recover_interrupted_jobs` (implementation now in `src/api/recovery.py`, called at `__init__.py:412` on import) runs at startup. It scans the [[job-queue]] for jobs left in `RUNNING` state from a previous crash and either:
- Resumes them from the last completed step (using `_determine_last_completed_step`)
- Marks them `FAILED` with a recovery error if no resumption point can be determined

Without this, an API restart mid-orchestration would orphan jobs forever — they'd sit `RUNNING` while no worker is actually processing them.

## ThreadPoolExecutor for async dispatch

Long synchronous operations (Claude CLI subprocess calls, file scanning) run on a `ThreadPoolExecutor` so they don't block FastAPI's async event loop. Chat streaming uses `StreamingResponse` natively (FastAPI handles the async generator); orchestrations and standards generation use the thread pool when called inline.

## Cross-references

- [[endpoint-reference]] — the full ~74-endpoint census this synthesizes
- [[inbound-gateway]] — the one unauthenticated (by Bearer) router
- [[chat-executors]] — what streaming endpoints dispatch to
- [[haikai-orchestrator]] — what orchestration endpoints invoke
- [[job-queue]] — what async-job endpoints enqueue
- [[standards-pipeline]] — what `POST /standards/...` runs
- [[chat-sessions-and-audit]] — session UUIDs that streaming endpoints resolve

## Sources

- `src/api/__init__.py` (~836-line mounting shell), `src/api/routes/*.py`
- `src/api/{dep_routes,discovery_routes,refactor_routes,packages,factories,gates,recovery}.py`
- `src/structural_endpoints.py`, `src/api_auth.py`, `src/path_safety.py`
- `docs/API.md`, `docs/ARCHITECTURE.md`
- [[../../raw/2026-06-21_verify-service-endpoint-deep-dive]], [[../../raw/2026-05-04_codebase-walk]]

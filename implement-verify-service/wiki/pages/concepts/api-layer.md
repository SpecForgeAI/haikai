# API layer

A single FastAPI app at `src/api/__init__.py` (~4,000 lines) plus 4 supplementary route modules in `src/api/`. 27 endpoints across 6 functional groups. Reference docs at `docs/API.md`; this page is the *structural* synthesis — patterns, not endpoint listings.

## The 6 functional groups

Each group is delimited in `__init__.py` by `# ====` section banners:

| Group | Pattern | Examples |
|---|---|---|
| **Standards Generation** | request → orchestrator → file output | `POST /standards/{global,product}/generate`, `GET /metamodels/...` |
| **Haikai CRUD** | spec lifecycle on disk | `GET /specs/...`, `POST /specs/.../write-spec`, `DELETE /specs/...` |
| **Orchestrations** | chained workflow execution | `POST /orchestrations`, `GET /orchestrations/{id}/{status,logs}` |
| **Streaming Chat** | SSE generator → wire | `POST /shape-spec/stream`, `POST /plan-product/stream`, `POST /story-component-anchor/stream` |
| **Async Job Queue** | enqueue + poll | `POST /jobs/orchestrations`, `GET /jobs/{id}`, `DELETE /jobs/{id}` |
| **Health** | `GET /health` | trivial liveness |

The 4 supplementary route modules:
- `src/api/dep_routes.py` — dep-graph queries ([[dep-graph]])
- `src/api/discovery_routes.py` — endpoint/interaction discovery ([[agentic-discovery]], [[v2-extraction-pipeline]])
- `src/api/refactor_routes.py` — refactoring engines ([[refactoring-engines]])

## Why one big file (`__init__.py` is 4,000 lines)

A previous refactor toward router modules was attempted and reverted. The single-file shape works because:
- Most endpoints share helpers (auth, workspace resolution, executor factory).
- FastAPI's decorator pattern keeps endpoint definitions self-contained.
- Endpoint discovery is via `# ====` section banners, not directory tree.

The 4 supplementary modules exist for groups that *do* form coherent domains (dep, discovery, refactor) — not as a target shape for the rest.

## Auth

Single Bearer token check at request edge: `verify_api_key` dependency on every endpoint. The token is `STANDARDS_API_KEY` env var. CORS configured for `localhost:5173` (dev frontend) and the host's own origin.

| Layer | What it gates |
|---|---|
| API auth | `STANDARDS_API_KEY` Bearer — protects *every* endpoint |
| LLM auth | per-LLM-call: Anthropic API key, OAuth token, or OpenAI key — see [[chat-executors]] for the OAuth detection path |

The two are independent. A request can authenticate to the API and then fail at the LLM layer if no provider credential is configured.

## Three patterns repeated across endpoints

### 1. Workspace path resolution

Every endpoint that touches per-project files goes through `_safe_project_dir(company, project)` at `__init__.py:491`. This is the central path-safety helper — rejects `..`, absolute paths, and Windows drive letters in the URL/body segments. Same pattern that landed in `tool_executor._safe_workspace_path` and `session_store._session_file` (commit `014de40` series). Single source of truth for "is this URL-supplied path actually under the workspace?" lives in `src/path_safety.py`.

### 2. Executor factory dispatch

Chat endpoints all funnel through `create_chat_executor(company, project, workspace_dir, anthropic_api_key)` at `__init__.py:2103`. See [[chat-executors]] for the dispatch order. The factory pattern means endpoint code never directly imports a specific executor class — they get whichever executor matches the runtime config.

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

`_recover_interrupted_jobs` at `__init__.py:290` runs at startup. It scans the [[job-queue]] for jobs left in `RUNNING` state from a previous crash and either:
- Resumes them from the last completed step (using `_determine_last_completed_step`)
- Marks them `FAILED` with a recovery error if no resumption point can be determined

Without this, an API restart mid-orchestration would orphan jobs forever — they'd sit `RUNNING` while no worker is actually processing them.

## ThreadPoolExecutor for async dispatch

Long synchronous operations (Claude CLI subprocess calls, file scanning) run on a `ThreadPoolExecutor` so they don't block FastAPI's async event loop. Chat streaming uses `StreamingResponse` natively (FastAPI handles the async generator); orchestrations and standards generation use the thread pool when called inline.

## Cross-references

- [[chat-executors]] — what streaming endpoints dispatch to
- [[haikai-orchestrator]] — what orchestration endpoints invoke
- [[job-queue]] — what async-job endpoints enqueue
- [[standards-pipeline]] — what `POST /standards/...` runs
- [[chat-sessions-and-audit]] — session UUIDs that streaming endpoints resolve

## Sources

- `src/api/__init__.py` (~4,000 lines)
- `src/api/{dep_routes,discovery_routes,refactor_routes}.py`
- `src/path_safety.py`
- `docs/API.md`, `docs/ARCHITECTURE.md`
- [[../../raw/2026-05-04_codebase-walk]]

# Specification: Add New Behaviour — Manual Capture

## Goal
Let a reviewer manually add one request for an EXISTING in-scope operation during capture review: physically send it to the current-state service through amvs (so redaction is applied identically to LLM captures) and persist the result as a capture (`accepted=null`) that flows through the existing accept/reject + Save-as-Baseline path unchanged.

## User Stories
- As a reviewer, I want to add a specific request (body + headers I know matter) for an endpoint already in the session's scope, send it to the current-state service, and review the resulting capture like any LLM-generated one.
- As a reviewer on a completed or failed session, I want to fill a coverage gap with an ad-hoc request without re-running the LLM loop.

## Specific Requirements

**"Add New Behaviour" trigger (CaptureReviewPanel.tsx)**
- Add a button in the panel header action row, shown ONLY when `readOnly === false` (review time: session completed/failed; the parent already passes `readOnly` while running).
- Place alongside the existing `capture-review-accept-all` / `capture-review-open-save-baseline` buttons; give it a stable testid (e.g. `capture-review-add-behaviour`).
- Click opens a NEW modal component mounted in the panel; on successful Save it closes and the panel re-fetches captures/scenarios (reuse the panel's existing list-refresh path) so the new row appears grouped under its operation.

**Modal: operation picker (existing ops only)**
- Populate from `listOperations(projectId, architectureId, sessionId)`; offer ONLY rows where `included === true`. No free-form endpoint entry, no operation creation, never mutates current-state architecture.
- Display each option as `<METHOD> <path>` (mirror `operationLabel`); selecting one drives the path-param token detection and the request the modal builds.
- Carry the selected operation's AMS `operation_id` (the row `id`) — the amvs endpoint needs it to attach the scenario + capture.

**Modal: path params, query, body, headers**
- Path params: detect every `{param}` token in the selected path; render one labelled text input per token; substitute values into the path before send; the resolved concrete path becomes `request_path`.
- Block send (inline error naming the missing param[s]) when any `{param}` is unfilled at Save time.
- Query: a key/value rows widget; serialise to `request_query_json` (object shape matching the capture column).
- Body: a free-text JSON textbox; on Save, `JSON.parse` it; on failure show inline "not valid JSON" and block send. NO raw-text escape hatch in v1. Empty body sends no body.
- Headers: editable key/value editor prefilled from the UNION of `request_headers_redacted_json` keys across ALL the session's 2xx captures (via `listCaptures`), regardless of accept/reject. Auth headers are already redacted out of stored captures, so their values are not shown/sent; the executor re-injects auth from the in-memory secret.

**Modal: mutating-verb confirmation**
- For POST/PUT/PATCH/DELETE, require an explicit "Yes, send this mutating request" confirmation (checkbox) before Save is enabled.
- If the session's `mutating_calls_confirmed === false`, STILL allow the send (explicit user intent) but show a STRONGER warning. Do NOT hard-block on session posture.

**Modal: auth via the existing parent prompt (no rebuild)**
- Do NOT rebuild secret inputs in the modal. Reuse the session's in-memory secret if live (it is held in amvs `secretsStore`, never persisted).
- If secrets aren't loaded, surface that the user should use the EXISTING parent-owned re-enter prompt in `CaptureSessionDetailView.tsx` (testid `capture-session-detail-reenter-secrets-prompt`); the panel must learn secret-load state and signal the parent to surface that prompt (extend `CaptureReviewPanelProps` with a `secretsLoaded` flag + an `onRequestReenterSecrets` callback; the parent owns `secretsLoadedLocal` / `showReenterSecretsPrompt`).
- A `SECRETS_NOT_LOADED` (409) response from the endpoint must map to the same "use the re-enter prompt" guidance, not a generic error.

**Frontend API client (apiBehaviourClient.ts)**
- Add `manualCapture(projectId, architectureId, sessionId, body)` using `actionUrl(..., 'manual-capture')` + `jsonRequest` POST (mirror `accountEndpoints` / `reconcileInventory`).
- Add request/response wire types: request carries `operationId` (AMS operation row id), `method`, resolved `path`, optional `query`, optional `headers`, optional `body`, and the mutating-confirm flag; response returns the created capture (and/or its id + scenario id).

**Backend: new amvs action endpoint**
- Add `POST /api/capture-sessions/:id/manual-capture` in `src/routes/captureSessionActions.ts`, mirroring `test-api-connection` / `start`: `extractProjectId`, `getCaptureSession`, `secretsStore.get(sessionId)` (409 `SECRETS_NOT_LOADED` when absent).
- Works on `completed`/`failed` sessions (do NOT gate on `status === 'running'`); it is independent of the LLM scenario loop.
- Validate the operation: load the session's operations, confirm the target row exists and `included === true`; reject otherwise.
- REUSE primitives directly (NOT the tool's `ToolExecutionContext`): `createSessionHttpExecutor({ auth: secrets.api, baseURL: session.api_base_url, defaultHeaders: session.default_headers_redacted_json ?? {} , timeoutMs })` + `applyAuthToConfig` (via the executor's interceptor); send one request; `dispose()` in `finally`.

**Backend: send → redact → persist sequence**
- Mirror `execute_http_request.ts`: build redacted shapes ONCE — `redactHeaders` (request + response), `redactJson` (request + response body), `redactUrl` for `request_url_redacted` (base+path, trailing-slash-trimmed). Do NOT redact twice.
- Tolerate non-2xx and transport failures exactly as the tool does (`validateStatus: () => true` means 4xx/5xx resolve; a transport throw with no response sets `error_type`/`error_message`, null status/body).
- Wrap request/response bodies with `normaliseBodyForAms` before persisting.
- Set `volatile_paths_json = null` (v1: NO k=3 probe → strict comparison).
- `createCapture` against (operation_id, scenario_id) with `accepted` OMITTED (AMS default null = un-reviewed); never send `accepted=false`.

**Backend: scenario creation (manual)**
- Before the capture, `archModelClient.createScenario` under the selected EXISTING operation: `scenario_type='manual'`, `generation_source='manual'`, auto `scenario_name='Manual: <METHOD> <path> <timestamp>'`, plus required non-blank `request_method` + `request_path` (resolved concrete path).
- Then `createCapture` with `session_id`, `scenario_id`, `operation_id`, `request_method`, `request_path`, `request_url_redacted` (non-blank), `request_query_json`, redacted request/response headers + bodies, `response_status`, `duration_ms`, `error_type`/`error_message`, `captured_at`, `volatile_paths_json=null`.

**AMS + Gateway (minimal)**
- AMS: add `'manual'` to BOTH `ALLOWED_SCENARIO_TYPES` (line 42) and `ALLOWED_GENERATION_SOURCES` (line 50) in `ApiBehaviourScenarioService.java`. This is the ONLY AMS change. NO DB/Liquibase schema change; NO change to `ApiBehaviourCaptureService` (`accepted` already nullable).
- Gateway: add `'manual-capture'` to `API_BEHAVIOUR_ACTION_PATHS` in `gateway/src/routes/apiMigrationValidation.ts` (JSON action, NOT multipart) so the existing action-proxy loop forwards it.

**Review table: "Manual" badge**
- In `CaptureReviewPanel.tsx`, render a small "Manual" badge on manual scenario rows, mirroring the `db_sample` badge block (around line 855), keyed off `scenario.generation_source === 'manual'`; give it a stable testid (e.g. `capture-review-scenario-manual-badge`).

## Visual Design
No visual assets were provided (`planning/visuals/` is empty). Build from the written requirements and mirror existing panel/modal styling (the `db_sample` badge classes and the existing modal patterns).

## Existing Code to Leverage

**`execute_http_request.ts` (send → redact → createCapture)**
- The authoritative sequence to mirror: redacted shapes built once and reused; `normaliseBodyForAms` body wrapping; `redactUrl(base+path)` for non-blank `request_url_redacted`; `accepted` omitted so AMS defaults null.
- Replicate WITHOUT binding to `ToolExecutionContext` — call the primitives directly from the new route.

**`captureSessionActions.ts` (`test-api-connection` / `start`)**
- Route scaffolding to mirror: `extractProjectId`, `getCaptureSession`, `secretsStore.get` + 409 `SECRETS_NOT_LOADED`, `fail(res, ...)` envelope, `createSessionHttpExecutor` construction + `dispose()` in `finally`.

**`httpExecutor.ts` (`createSessionHttpExecutor` + `applyAuthToConfig`)**
- Per-session axios with auth injection, default headers, `validateStatus: () => true`, redacted request/response logging, and body-size truncation. Use as-is; auth is re-injected from the in-memory secret so redacted-out auth headers never need re-entry in the modal.

**`archModelClient.ts` (`createScenario`, `createCapture`, `getCaptureSession`, `listOperationsBySession`)**
- Typed snake_case wire helpers: `CreateScenarioRequest` (`scenario_type`, `generation_source`, `request_method`, `request_path`) and `CreateCaptureRequest` (`request_url_redacted` required, `volatile_paths_json` optional). Match these shapes exactly.

**Frontend `CaptureReviewPanel.tsx` + `CaptureSessionDetailView.tsx`**
- The `db_sample` badge block (line ~855) is the template for the "Manual" badge; the panel already uses `listOperations` / `listCaptures` / `listScenarios` and a refresh path to reuse. The parent owns `secretsLoadedLocal` + `showReenterSecretsPrompt` (testid `capture-session-detail-reenter-secrets-prompt`) — thread secret-load state and a re-enter request into the panel rather than rebuilding secret entry.

## Out of Scope
- The start-baseline wizard Step 4 Model-Seeded Capture Inventory flow / adding brand-new endpoints — left entirely as-is.
- The k=3 volatility probe for manual sends (single fire → `volatile_paths_json=null` → strict; reviewer may still Mask + Accept).
- A "send as raw text" body escape hatch.
- Any DB / Liquibase schema change (none required).
- Any change to the downstream review / accept-reject / Save-as-Baseline path (`SaveAsBaselineModal.tsx` unchanged; the manual row is just another `accepted=null` row).
- Any `/rerun` affordance — manual-add is a NEW behaviour, not a re-run; the existing "NO /rerun anywhere" constraint is NOT violated.
- Rebuilding secret inputs in the modal — reuse the existing parent-owned re-enter prompt.
- Direct frontend POST to AMS — all sends MUST go through the amvs endpoint so redaction is applied identically to LLM captures.

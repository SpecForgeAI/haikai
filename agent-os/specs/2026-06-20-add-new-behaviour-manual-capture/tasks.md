# Task Breakdown: Add New Behaviour — Manual Capture

> IMPLEMENTER GUARDRAIL — READ BEFORE EDITING (NON-NEGOTIABLE)
>
> The implementer subagents in this repo have `Write` but NOT `Edit`. Whole-file
> `Write` calls have previously CLOBBERED large files here. Therefore:
>
> - For changes to EXISTING large files — especially
>   `api-migration-validation-service/src/routes/captureSessionActions.ts`,
>   `frontend/src/api/apiBehaviourClient.ts`,
>   `frontend/src/components/DashboardView/CaptureReviewPanel.tsx`, and
>   `frontend/src/components/DashboardView/CaptureSessionDetailView.tsx` — make
>   ANCHORED IN-PLACE edits only. Splice new text against a unique nearby anchor
>   string using a Bash/Node string operation (read file -> locate unique anchor
>   -> insert/replace just that region -> write back). Do NOT re-Write the whole
>   file from memory.
> - NEW files (the modal component, all new `*.test.*` files) MAY be created with
>   `Write`.
> - NEVER use `git checkout`, `git stash`, `git reset`, or any git command that
>   discards or restores working-tree state.
> - AFTER every edit to an existing file, run a mojibake/symbol sanity check:
>   grep the file for the corruption marker `â€"` (and similar) and confirm zero
>   hits, then byte-for-byte verify the lines immediately surrounding your
>   insertion are intact (no truncation, no duplicated braces, balanced
>   imports/exports). If anything looks off, fix it forward — do not revert.
>
> SCOPE GUARDRAIL — these are EXPLICIT v1 NON-GOALS. Do NOT create or touch:
> - The start-baseline wizard Step 4 Model-Seeded Capture Inventory flow.
> - Any k=3 volatility probe for manual sends (`volatile_paths_json` is ALWAYS
>   `null` for manual captures in v1).
> - A "send as raw text" body escape hatch (JSON-only body in v1).
> - Any DB / Liquibase schema change.
> - Any change to the downstream review / accept-reject / Save-as-Baseline path
>   (`SaveAsBaselineModal.tsx` stays unchanged).
> - Any `/rerun` affordance.
> - Rebuilding secret inputs in the modal (reuse the parent-owned re-enter prompt).
> - Direct frontend POST to AMS (all sends go through the amvs endpoint).

## Overview
Total Tasks: 7 task groups

Dependency-ordered so backend foundations land before the frontend consumes them:
1. AMS allow-set change (foundation for the `manual` scenario type/source).
2. amvs `manual-capture` action endpoint (send -> redact -> persist).
3. Gateway allow-list entry (forwards the new action).
4. Frontend `apiBehaviourClient.ts` `manualCapture` client + wire types.
5. "Add New Behaviour" modal component (new file).
6. Wire button + modal into `CaptureReviewPanel.tsx` + thread secret state through `CaptureSessionDetailView.tsx`.
7. "Manual" badge on manual scenario rows.

## Task List

### Backend — AMS

#### Task Group 1: AMS allow-set change for `manual`
**Dependencies:** None

- [x] 1.0 Admit `manual` scenario type and generation source in AMS
  - [x] 1.1 Write 2-3 focused tests for the allow-set change
    - Assert `ApiBehaviourScenarioService.ALLOWED_SCENARIO_TYPES` contains `"manual"`.
    - Assert `ApiBehaviourScenarioService.ALLOWED_GENERATION_SOURCES` contains `"manual"`.
    - One create-path test: creating a scenario with `scenario_type='manual'` + `generation_source='manual'` (and non-blank `request_method` + `request_path`) is accepted, not rejected by validation.
    - Place under `architecture-model-service/src/test/java/com/example/architecturemodel/service/apibehaviour/`.
    - Limit to 2-3 highly focused tests; do not re-test the whole CRUD surface.
  - [x] 1.2 Add `"manual"` to `ALLOWED_SCENARIO_TYPES` (line ~42) in `ApiBehaviourScenarioService.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/apibehaviour/ApiBehaviourScenarioService.java`
    - ANCHORED edit: extend the existing `Set.of(...)` literal only; do not rewrite the class.
  - [x] 1.3 Add `"manual"` to `ALLOWED_GENERATION_SOURCES` (line ~50) in the same file
    - ANCHORED edit on the second `Set.of(...)` literal only.
    - This is the ONLY AMS change. NO DB / Liquibase / entity / controller / `ApiBehaviourCaptureService` change (`accepted` is already nullable).
  - [x] 1.4 Run ONLY the tests written in 1.1
    - Run the targeted scenario-service test class only; do NOT run the full AMS suite.

**Acceptance Criteria:**
- The 2-3 tests from 1.1 pass.
- `manual` is present in both allow-sets; no other AMS code or schema changed.
- A `scenario_type='manual'` / `generation_source='manual'` create with non-blank method/path validates successfully.

### Backend — amvs

#### Task Group 2: amvs `manual-capture` action endpoint
**Dependencies:** Task Group 1

- [x] 2.0 Add `POST /api/capture-sessions/:id/manual-capture` to amvs
  - [x] 2.1 Write 4-8 focused route/unit tests
    - Place under `api-migration-validation-service/src/__tests__/` (mirror `captureSessionActions.mutatingConfirmationOff.test.ts` / `captureSessionActions.inventoryReconciliation.test.ts`).
    - Cover only the critical behaviours:
      1. Missing in-memory secret -> 409 `SECRETS_NOT_LOADED`.
      2. Target operation not found OR `included === false` -> rejected (validation error).
      3. Happy path: 2xx send -> `createScenario` then `createCapture` called with the expected snake_case shapes; `accepted` OMITTED; `volatile_paths_json` is `null`.
      4. Non-2xx response (e.g. 404/500) resolves and still persists a capture (status recorded, no throw) — `validateStatus: () => true` behaviour.
      5. Transport throw with no response -> capture persisted with `error_type`/`error_message` set and null status/body.
      6. Works on a `completed`/`failed` session (NOT gated on `status === 'running'`).
    - Limit to 4-8 tests; mock `archModelClient` + the executor; do not exercise real HTTP/AMS.
  - [x] 2.2 Add the route handler in `captureSessionActions.ts` (ANCHORED edit)
    - File: `api-migration-validation-service/src/routes/captureSessionActions.ts`
    - Insert a NEW `router.post('/:id/manual-capture', ...)` next to the `test-api-connection` / `start` handlers using an ANCHORED splice against a unique nearby anchor (e.g. the `test-api-connection` route registration). Do NOT re-Write this large file.
    - Scaffolding to mirror: `extractProjectId`, `getCaptureSession`, `secretsStore.get(sessionId)` -> 409 `SECRETS_NOT_LOADED` when absent, `fail(res, ...)` envelope.
  - [x] 2.3 Validate the target operation
    - Load the session's operations (reuse the existing session-operations lookup, e.g. `listOperationsBySession`); confirm the requested `operationId` row exists AND `included === true`; reject otherwise. Never mutate current-state architecture.
  - [x] 2.4 Build + send one request via existing primitives (NOT `ToolExecutionContext`)
    - Construct `createSessionHttpExecutor({ auth: secrets.api, baseURL: session.api_base_url, defaultHeaders: session.default_headers_redacted_json ?? {}, timeoutMs })`; auth re-injects via the executor interceptor (`applyAuthToConfig`).
    - Resolve the concrete `request_path` (path-param substitution arrives resolved from the client), apply `request_query_json`, attach optional `body` (already a parsed object) and optional `headers`.
    - `dispose()` the executor in a `finally`.
  - [x] 2.5 Redact-once + persist sequence (mirror `execute_http_request.ts`)
    - Build redacted shapes ONCE: `redactHeaders` (request + response), `redactJson` (request + response body), `redactUrl(base + path)` (trailing-slash-trimmed) for non-blank `request_url_redacted`. Do NOT redact twice.
    - Wrap request/response bodies with `normaliseBodyForAms` before persisting.
    - Tolerate non-2xx and transport failure exactly as the tool does (resolve 4xx/5xx; on transport throw set `error_type`/`error_message`, null status/body).
  - [x] 2.6 Create scenario then capture via `archModelClient`
    - `createScenario` under the selected EXISTING operation: `scenario_type='manual'`, `generation_source='manual'`, auto `scenario_name='Manual: <METHOD> <path> <timestamp>'`, non-blank `request_method` + `request_path` (resolved concrete path).
    - `createCapture` with `session_id`, `scenario_id`, `operation_id`, `request_method`, `request_path`, `request_url_redacted` (non-blank), `request_query_json`, redacted request/response headers + bodies, `response_status`, `duration_ms`, `error_type`/`error_message`, `captured_at`, `volatile_paths_json = null`, `accepted` OMITTED (never `accepted=false`).
    - Response payload returns the created capture (and/or capture id + scenario id) for the client to consume.
  - [x] 2.7 Run ONLY the tests written in 2.1
    - Run just the new manual-capture test file(s); do NOT run the full amvs suite.
  - [x] 2.8 Mojibake/symbol sanity check on `captureSessionActions.ts`
    - Grep for `â€"` (zero hits); verify the spliced route region and surrounding imports/handlers are byte-for-byte intact.

**Acceptance Criteria:**
- The 4-8 tests from 2.1 pass.
- Missing secret -> 409 `SECRETS_NOT_LOADED`; non-included/unknown operation rejected.
- One request is sent through `createSessionHttpExecutor`; non-2xx and transport failures persist a capture without throwing.
- Redaction applied identically to LLM captures (built once); body wrapped with `normaliseBodyForAms`.
- A `manual` scenario then an `accepted=null`, `volatile_paths_json=null` capture are created against the existing operation.
- Endpoint works on `completed`/`failed` sessions.
- `captureSessionActions.ts` passes the mojibake/intactness check.

### Backend — Gateway

#### Task Group 3: Gateway allow-list entry
**Dependencies:** Task Group 2

- [x] 3.0 Forward the new action through the gateway proxy
  - [x] 3.1 Write 1-3 focused tests
    - Assert `manual-capture` is in `API_BEHAVIOUR_ACTION_PATHS` and that a POST to the gateway action path for `manual-capture` is proxied to the amvs service (JSON, not multipart). Mirror the existing action-proxy test style if one exists; otherwise a small unit assertion on the constant + a proxy-loop registration check.
  - [x] 3.2 Add `'manual-capture'` to `API_BEHAVIOUR_ACTION_PATHS` (line ~485) in `apiMigrationValidation.ts` (ANCHORED edit)
    - File: `gateway/src/routes/apiMigrationValidation.ts`
    - Splice the new entry into the existing array literal only; the existing `for (const action of API_BEHAVIOUR_ACTION_PATHS)` loop (line ~643) registers the JSON proxy automatically. This is a JSON action, NOT a multipart action.
  - [x] 3.3 Run ONLY the tests written in 3.1
  - [x] 3.4 Mojibake/symbol sanity check on `apiMigrationValidation.ts`
    - Grep for `â€"` (zero hits); confirm the array literal and proxy loop are intact.

**Acceptance Criteria:**
- The 1-3 tests from 3.1 pass.
- `manual-capture` is registered as a JSON action proxy and forwards to amvs.
- No multipart handling added; surrounding routes intact.

### Frontend — API client

#### Task Group 4: `apiBehaviourClient.ts` `manualCapture` client + wire types
**Dependencies:** Task Group 3

- [x] 4.0 Add the `manualCapture` action client and wire types
  - [x] 4.1 Write 2-4 focused tests
    - Add to `frontend/src/api/__tests__/apiBehaviourClient.test.ts` (mirror existing `reconcileInventory` / `accountEndpoints` test style).
    - Cover: correct URL via `actionUrl(..., 'manual-capture')` + POST method + body shape; success returns the created capture; a 409 `SECRETS_NOT_LOADED` surfaces in a way the caller can detect (typed/inspectable error).
  - [x] 4.2 Add request/response wire types (ANCHORED edit)
    - File: `frontend/src/api/apiBehaviourClient.ts`
    - Request type carries: `operationId` (AMS operation row id), `method`, resolved `path`, optional `query`, optional `headers`, optional `body`, and the mutating-confirm flag.
    - Response type: the created capture (and/or capture id + scenario id), matching the amvs response from Task 2.6.
    - Splice type declarations next to the existing capture/operation DTO types; do NOT re-Write the file.
  - [x] 4.3 Add `manualCapture(projectId, architectureId, sessionId, body)` (ANCHORED edit)
    - Use `actionUrl(projectId, architectureId, sessionId, 'manual-capture')` + `jsonRequest` POST; mirror `reconcileInventory` / `accountEndpoints` (around line ~1466-1490). Splice the new function near those.
  - [x] 4.4 Run ONLY the tests written in 4.1
  - [x] 4.5 Mojibake/symbol sanity check on `apiBehaviourClient.ts`
    - Grep for `â€"` (zero hits); confirm imports, the spliced types, and the new function are intact and exports balanced.

**Acceptance Criteria:**
- The 2-4 tests from 4.1 pass.
- `manualCapture` posts to the correct action URL with the documented body and returns the created capture.
- 409 `SECRETS_NOT_LOADED` is distinguishable by the caller.
- `apiBehaviourClient.ts` passes the mojibake/intactness check.

### Frontend — Modal component

#### Task Group 5: "Add New Behaviour" modal component
**Dependencies:** Task Group 4

- [x] 5.0 Build the new modal (NEW file — use `Write`)
  - [x] 5.1 Write 4-8 focused component tests (NEW test file — use `Write`)
    - Place beside the component under `frontend/src/components/DashboardView/`.
    - Cover only critical behaviours:
      1. Operation picker lists ONLY `included === true` operations, labelled `<METHOD> <path>` (mirror `operationLabel`).
      2. Selecting a path with `{param}` tokens renders one input per token; Save with an unfilled param shows an inline error naming the missing param and blocks send.
      3. Invalid JSON in the body textbox shows inline "not valid JSON" and blocks send; empty body sends no body.
      4. A mutating verb (POST/PUT/PATCH/DELETE) disables Save until the "Yes, send this mutating request" checkbox is ticked; when `mutating_calls_confirmed === false` a STRONGER warning is shown (but send is NOT hard-blocked).
      5. Headers editor is prefilled from the union of redacted request-header keys; on valid Save, `manualCapture` is called with the resolved path/method/query/headers/body and confirm flag.
      6. When secrets are not loaded (prop) OR the endpoint returns 409 `SECRETS_NOT_LOADED`, the modal points the user to the existing re-enter prompt (invokes `onRequestReenterSecrets`) rather than showing a generic error and does NOT rebuild secret inputs.
    - Limit to 4-8 tests.
  - [x] 5.2 Create the modal component
    - Props include at minimum: `projectId`, `architectureId`, `sessionId`, the operations list (or a loader), the session's 2xx captures (or their redacted request-header union), `mutating_calls_confirmed`, `secretsLoaded`, `onRequestReenterSecrets`, `onClose`, and an `onSaved`/success callback.
    - Mirror existing modal patterns + styling in the DashboardView; give the root a stable testid.
  - [x] 5.3 Operation picker (existing ops only)
    - Populate from `listOperations(projectId, architectureId, sessionId)` (or operations passed in); offer ONLY `included === true` rows; display `<METHOD> <path>`; carry the selected row's AMS `operation_id` (`id`). No free-form entry, no operation creation.
  - [x] 5.4 Path params, query, body, headers fields
    - Detect every `{param}` token in the selected path; render one labelled input per token; substitute into the path to form the resolved concrete `path`/`request_path`.
    - Query: key/value rows widget serialising to an object matching `request_query_json`.
    - Body: free-text JSON textbox; `JSON.parse` on Save; inline "not valid JSON" + block on failure; empty body -> no body. NO raw-text escape hatch.
    - Headers: editable key/value editor prefilled from the UNION of `request_headers_redacted_json` keys across ALL the session's 2xx captures (via `listCaptures`), regardless of accept/reject; auth-header values are not shown/sent (executor re-injects auth).
  - [x] 5.5 Validation + mutating-verb confirmation
    - Block Save (inline error naming missing param[s]) when any `{param}` is unfilled.
    - For POST/PUT/PATCH/DELETE require the explicit confirm checkbox before Save is enabled; show the STRONGER warning when `mutating_calls_confirmed === false` but still allow send. Never hard-block on session posture.
  - [x] 5.6 Auth handling via parent prompt (no rebuild)
    - If `secretsLoaded === false`, surface guidance to use the existing parent re-enter prompt and call `onRequestReenterSecrets`; do NOT build secret inputs here.
    - Map a 409 `SECRETS_NOT_LOADED` response from `manualCapture` to the same "use the re-enter prompt" guidance + `onRequestReenterSecrets`, not a generic error.
  - [x] 5.7 Save -> call `manualCapture` -> close + signal success
    - On valid Save call `manualCapture(...)`; on success close the modal and invoke the success callback so the host can refresh.
  - [x] 5.8 Run ONLY the tests written in 5.1

**Acceptance Criteria:**
- The 4-8 tests from 5.1 pass.
- Picker shows only `included` ops; path-param inputs render + validate; query/body/header editors behave per spec; invalid JSON blocks send.
- Mutating-verb confirm gates Save; stronger warning when posture unconfirmed; no hard block.
- Secrets-not-loaded (prop or 409) routes to the existing parent re-enter prompt; no secret inputs rebuilt.
- Successful Save calls `manualCapture`, closes, and signals success.

### Frontend — Panel wiring

#### Task Group 6: Wire button + modal into the panel + thread secret state
**Dependencies:** Task Group 5

- [x] 6.0 Mount the trigger + modal and thread parent-owned secret state
  - [x] 6.1 Write 2-6 focused tests
    - Add to a panel test (e.g. `frontend/src/components/DashboardView/CaptureReviewPanel.test.tsx` or a new sibling test file).
    - Cover: the `capture-review-add-behaviour` button renders ONLY when `readOnly === false` and sits alongside `capture-review-accept-all` / `capture-review-open-save-baseline`; clicking opens the modal; a successful Save triggers the panel's existing captures/scenarios refresh path; when secrets are not loaded the panel signals the parent (`onRequestReenterSecrets`) and the parent surfaces `capture-session-detail-reenter-secrets-prompt`.
  - [x] 6.2 Add the "Add New Behaviour" button + modal mount in `CaptureReviewPanel.tsx` (ANCHORED edit)
    - File: `frontend/src/components/DashboardView/CaptureReviewPanel.tsx`
    - Splice the button into the header action row next to the existing `capture-review-accept-all` / `capture-review-open-save-baseline` buttons (anchor on those testids); shown ONLY when `readOnly === false`; testid `capture-review-add-behaviour`.
    - Mount the new modal in the panel; on successful Save close it and call the panel's EXISTING list-refresh path so the new row appears grouped under its operation.
    - Pass operations / 2xx-capture header union, `mutating_calls_confirmed`, `secretsLoaded`, and `onRequestReenterSecrets` into the modal.
  - [x] 6.3 Extend `CaptureReviewPanelProps` (ANCHORED edit)
    - Add a `secretsLoaded` flag prop and an `onRequestReenterSecrets` callback prop to the panel's props type; splice into the existing props interface.
  - [x] 6.4 Thread state from `CaptureSessionDetailView.tsx` (ANCHORED edit)
    - File: `frontend/src/components/DashboardView/CaptureSessionDetailView.tsx`
    - The parent already owns `secretsLoadedLocal` + `showReenterSecretsPrompt` (re-enter prompt testid `capture-session-detail-reenter-secrets-prompt`, around line ~715). Pass `secretsLoaded={secretsLoadedLocal}` and an `onRequestReenterSecrets` callback (that flips `showReenterSecretsPrompt`) into `<CaptureReviewPanel>` via an ANCHORED splice at the existing panel render site. Do NOT rebuild secret entry; reuse the existing prompt.
  - [x] 6.5 Run ONLY the tests written in 6.1
  - [x] 6.6 Mojibake/symbol sanity check on `CaptureReviewPanel.tsx` and `CaptureSessionDetailView.tsx`
    - Grep both for `â€"` (zero hits); verify the spliced JSX, props type, and parent render site are intact and balanced (no stray/duplicated tags or braces).

**Acceptance Criteria:**
- The 2-6 tests from 6.1 pass.
- Button shows only at review time (`readOnly === false`), beside the existing action buttons, with testid `capture-review-add-behaviour`.
- Click opens the modal; successful Save closes it and refreshes captures/scenarios via the existing path.
- Secrets-not-loaded routes through `onRequestReenterSecrets` to the parent's existing re-enter prompt.
- Both edited files pass the mojibake/intactness check.

### Frontend — Manual badge

#### Task Group 7: "Manual" badge on manual scenario rows
**Dependencies:** Task Group 6

- [x] 7.0 Render the "Manual" badge
  - [x] 7.1 Write 1-3 focused tests
    - Assert a scenario row with `generation_source === 'manual'` renders the badge (testid `capture-review-scenario-manual-badge`) and a non-manual row does not. Add to an existing panel test file.
  - [x] 7.2 Add the badge block in `CaptureReviewPanel.tsx` (ANCHORED edit)
    - Mirror the `db_sample` badge block (around line ~855; existing testid `capture-review-scenario-db-sample-badge`); splice a parallel block keyed off `scenario.generation_source === 'manual'` with testid `capture-review-scenario-manual-badge`, reusing the same badge classes/styling.
  - [x] 7.3 Run ONLY the tests written in 7.1
  - [x] 7.4 Mojibake/symbol sanity check on `CaptureReviewPanel.tsx`
    - Grep for `â€"` (zero hits); confirm the new badge block and the adjacent `db_sample` block are both intact.

**Acceptance Criteria:**
- The 1-3 tests from 7.1 pass.
- Manual scenario rows show the "Manual" badge (testid `capture-review-scenario-manual-badge`); non-manual rows do not.
- Badge mirrors the `db_sample` styling; file passes the mojibake/intactness check.

### Testing

#### Task Group 8: Test review & gap analysis (feature-only)
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review the tests written in Task Groups 1-7
    - AMS allow-set (1.1), amvs endpoint (2.1), gateway (3.1), client (4.1), modal (5.1), panel wiring (6.1), badge (7.1).
  - [x] 8.2 Analyse coverage gaps for THIS feature only
    - Focus on the end-to-end manual-capture workflow (modal -> client -> gateway -> amvs -> AMS) and the secrets-not-loaded path. Do NOT assess unrelated application coverage.
  - [x] 8.3 Write up to 10 additional strategic tests maximum
    - Prioritise the highest-value integration/end-to-end gaps (e.g. a full happy-path through the client + amvs route mocks; the 409 -> re-enter-prompt round trip). Skip edge/perf/accessibility unless business-critical.
  - [x] 8.4 Run ONLY this feature's tests
    - Run the tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, and 8.3. Do NOT run the entire suites.

**Acceptance Criteria:**
- All feature-specific tests pass.
- Critical manual-capture workflows (including secrets-not-loaded) are covered.
- No more than 10 additional tests added.
- Testing stays scoped to this spec's feature.

## Execution Order

1. Task Group 1 — AMS allow-set change
2. Task Group 2 — amvs `manual-capture` endpoint
3. Task Group 3 — Gateway allow-list entry
4. Task Group 4 — `apiBehaviourClient.ts` client + wire types
5. Task Group 5 — "Add New Behaviour" modal component
6. Task Group 6 — Panel wiring + secret-state threading
7. Task Group 7 — "Manual" badge
8. Task Group 8 — Test review & gap analysis

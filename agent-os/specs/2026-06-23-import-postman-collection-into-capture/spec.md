# Specification: Import a Postman Collection into Capture

## Goal
Add Postman Collection v2.1 (JSON) import to the API Behaviour Baseline capture flow -- the inverse of the existing export -- so a collection's concrete requests can seed a new capture run (Mode 1) or be appended to an existing run (Mode 2), both built on the single `manual-capture` "execute one request -> persist a capture" primitive.

## User Stories
- As a migration analyst, I want to upload a Postman collection before starting a capture run and choose how it combines with LLM scenario generation (LLM only / Postman + LLM delta / Postman only) so that I get deterministic coverage of my known requests plus AI top-up without duplicate scenarios.
- As a reviewer on an existing capture session, I want to append a Postman collection that replays live against the current API so that new behaviours land in the normal review -> Save-as-Baseline flow.
- As an architect, I want imported items that don't match a committed architecture endpoint to be flagged before any run so that I can stage a discovery candidate or delete the item rather than silently capturing an unknown operation.

## Specific Requirements

**R1 -- Postman v2.1 IMPORT parser (new, frontend)** [D1, A7]
- New module `frontend/src/utils/postmanImport.ts`; the inverse of `frontend/src/utils/postmanExport.ts`, reusing its exported v2.1 type surface (`PostmanCollection`, `PostmanItem`, `PostmanRequest`, `PostmanUrl`, `PostmanHeader`, `PostmanQueryParam`, `PostmanBody`).
- Pure function: parse a `Record<string, unknown>` collection JSON -> a flat `ImportedRequest[]`; no fetch / DOM / server call.
- Parse defensively with loose `Record` narrowing helpers mirroring the export (`asRecord`/`asString`/`asNumber`/`toPathSegments`); a malformed/partial item degrades (skipped fields) and never throws.
- Flatten folders and multi-step / `sequence` items into individual requests (the export's flatten precedent), preserving order.
- v1: `application/json` bodies only; non-JSON bodies are flagged unsupported per-item, not silently sent.
- IGNORE all embedded collection-level and item-level Postman `auth` blocks; session in-memory secrets are the sole auth source.
- Resolve each request's `method` + `path` (strip `{{baseUrl}}`/host, keep path + query) so each `ImportedRequest` carries `{ method, path, query, headers, body, sourceItemName }`.

**R2 -- The shared execute->persist primitive (reused, server)** [D2]
- All three modes physically send each imported request through the existing `manual-capture` route (`api-migration-validation-service/src/routes/captureSessionActions.ts:1525`) via the frontend `manualCapture(...)` client (`frontend/src/api/apiBehaviourClient.ts:1825`).
- The route sends via the per-session `httpExecutor` (auth re-injected from the in-memory secret), redacts ONCE, persists a `manual` scenario (`scenario_type:'manual'`, `generation_source:'manual'`) + an un-reviewed capture (`accepted` omitted -> AMS null, `volatile_paths_json:null`).
- Pre-conditions enforced by the route are honoured by callers: live secrets (else 409 `SECRETS_NOT_LOADED`), target `operationId` exists AND `included=true` (else 404 `OPERATION_NOT_FOUND` / 400 `OPERATION_NOT_INCLUDED`).
- Not gated on `status==='running'` -- works on completed/failed sessions (enables Mode 2).
- The frontend `path` is pre-substituted client-side (concrete `request_path`), matching the existing `ManualCaptureRequest` contract.

**R3 -- Import staging + reconciled review (new UI, both modes)** [D6, A5]
- Before any send, parsed `ImportedRequest[]` are staged in a reviewable list showing, per item: resolved method/path, mapped session operation (or "no match"), and architecture-match status.
- Map each imported item to a session operation by `(method, path)` against the session's operation rows; unmatched items are routed to R5 (never silently run).
- Show reconciled coverage by reusing `reconcileInventory(...)` (`apiBehaviourClient.ts:1740`; amvs `reconcile-inventory` at `captureSessionActions.ts:1308`); render the returned `InventoryReconciliationResponse` verbatim.
- New shared component (e.g. `frontend/src/components/ApiBehaviour/PostmanImportStaging.tsx`) used by both the wizard step (Mode 1) and the detail-view modal (Mode 2).

**R4 -- Mode 1: 3-way run-mode selector in the wizard (new UI + send orchestration)** [D3, A5]
- Add a run-mode selector + Postman upload as a sub-section/step in `frontend/src/components/ApiBehaviour/StartCaptureSessionWizard.tsx` (existing `WizardStep = 1..6`, host confirmed at `:95`/`:223`).
- (a) **LLM only:** today's behaviour unchanged (planner + `execute_http_request` loop); no Postman.
- (b) **Postman + LLM delta:** after `/start`, fire imported items as concrete captures (R2), then run the LLM top-up over the per-operation DELTA only (R6).
- (c) **Postman only:** fire imported items, skip planner AND the `execute_http_request` loop; coverage is intentionally partial, so `/start` MUST carry `coverageOverrideJustification` (`captureSessionActions.ts:581,1905`) so the coverage gate does not fail closed.
- Imported sends for Mode 1 are issued post-`/start` (operations exist + `included=true`); items with no matching operation must pass through R5 before they can send.

**R5 -- Architecture-match handling (new UI + reused server paths)** [D5, A2, A4, A5]
- Per staged item, compare the item's mapped endpoint against committed architecture endpoints using `operations_without_model_endpoint` from the `reconcile-inventory` payload (`archModelClient.ts:312`, `InventoryReconciliationResponse.operations_without_model_endpoint`).
- An item whose endpoint does NOT match a committed architecture endpoint -- and any item mapping to NO known operation -- is routed to a warning step with two actions; it is never silently run.
- **"Add to architecture"** STAGES A DISCOVERY CANDIDATE via the existing discovery review/approve path (`frontend/src/api/discoveryReviewApi.ts`); it MUST NOT write a committed architecture endpoint directly.
- **"Delete the item"** drops it from the import set.
- For an unmatched item the user chooses to keep & run, create the operation row first via the new add-operation path (R7) before any send.

**R6 -- Mode 1(b) delta: two-stage bounded subtraction (new server logic)** [D3, A5]
- Computed PER OPERATION over the planner's candidates `defaultScenarioSet(op, discoveryContext, oasOperation)` (`captureSessionOrchestrator.ts:983`), respecting `MAX_SCENARIOS_PER_OP=12` (`:926`).
- **Stage 1 -- code pre-filter (heuristic):** remove candidate scenarios that obviously match an imported (captured) Postman request for that operation, keyed by scenario archetype (`type`) / method / path / which-param / `expectedStatus`.
- **Stage 2 -- LLM judge:** the LLM judges the REMAINING candidates redundant-or-not against that operation's captured Postman requests; only non-redundant survivors are topped up via the existing per-scenario `execute_http_request` path.
- Delta = `defaultScenarioSet` candidates MINUS (Stage-1 pre-filtered + Stage-2 LLM-judged-redundant), capped at `MAX_SCENARIOS_PER_OP` including the already-captured Postman scenarios.
- Implemented in `captureSessionOrchestrator.ts` alongside the existing per-op loop (`:1306`); a Postman-covered set per operation is passed into the loop so it subtracts before generating.

**R7 -- Mode 2: post-hoc append + add-operation path (new UI + new server path)** [D4, A1, A2, A3]
- Mode 2 is launched from the existing capture-session detail view; it REPLAYS LIVE -- each imported item re-executed against the live API via the `manual-capture` primitive (R2), capturing the real current response. (import-saved-responses is out of scope.)
- On finished (completed/failed) sessions with purged secrets, the append flow detects 409 `SECRETS_NOT_LOADED` (`isSecretsNotLoadedError`, `apiBehaviourClient.ts:382`) and prompts a re-enter-secrets step (`POST /secrets`) before sending.
- **Add-operation path (new):** Mode 2 (and Mode 1 staging) can append endpoints NOT already in the session. A new amvs action creates the operation row with `included=true` BEFORE the `manual-capture` send, reusing `synthesiseOperationFromEndpoint` (`captureSessionActions.ts:438`) and the `account-endpoints` `createOperation` shape (`:1454-1476`).
- Appended-but-unmatched-to-architecture endpoints flow through the R5 architecture-match step.

**R8 -- Wire format + frontend client surface** [Technical Considerations]
- AMS DTOs (scenario/capture/operation/reconciliation) are snake_case on the wire by default; the new add-operation action follows the `account-endpoints` snake_case create shape.
- The `manualCapture` request body stays camelCase (existing `ManualCaptureRequest` contract); the route maps to snake_case AMS create shapes server-side.
- Reuse the existing frontend clients (`manualCapture`, `reconcileInventory`, `accountEndpoints`, `isSecretsNotLoadedError`) rather than adding new fetch shims where one already exists.

## Visual Design
No visual assets provided (`planning/visuals/` is empty). Text-only spec.

## Existing Code to Leverage

**`frontend/src/utils/postmanExport.ts`** (Postman v2.1 type surface + defensive helpers)
- Exports `PostmanCollection`/`PostmanItem`/`PostmanRequest`/`PostmanUrl`/`PostmanHeader`/`PostmanQueryParam`/`PostmanBody` -- import these into the new parser rather than redeclaring.
- `asRecord`/`asString`/`asNumber`/`toPathSegments` show the fail-soft narrowing posture and the multi-step FLATTEN precedent the importer mirrors.
- The export deliberately does NOT generate `pm.*` scripts from inter-step refs; import matches that.

**`api-migration-validation-service/src/routes/captureSessionActions.ts` (`manual-capture`, `:1525-1691`)**
- The send -> redact-once -> persist `manual` scenario + un-reviewed capture primitive every mode reuses verbatim; enforces secrets-loaded + included-operation guards and works on non-running sessions.

**`account-endpoints` action (`captureSessionActions.ts:1373`) + `synthesiseOperationFromEndpoint` (`:438`)**
- Precedent for the new add-operation path: maps a model endpoint -> `ParsedOasOperation`, calls `createOperation(... included=true)`, and appends to `oasInventoryStore` so `/start` sees the new row without a re-parse.

**`captureSessionOrchestrator.ts` (`defaultScenarioSet` `:983`, `MAX_SCENARIOS_PER_OP` `:926`, per-op loop `:1306`)**
- The candidate generator and the `included`-gated per-operation loop where Mode 1(b) subtracts the Postman-covered set before topping up via `execute_http_request`.

**Frontend clients (`apiBehaviourClient.ts`: `manualCapture` `:1825`, `reconcileInventory` `:1740`, `accountEndpoints` `:1793`, `isSecretsNotLoadedError` `:382`) + `discoveryReviewApi.ts`**
- Existing wired actions for send, coverage reconciliation, endpoint accounting, the `SECRETS_NOT_LOADED` detector (re-enter-secrets routing), and the discovery candidate staging path for "Add to architecture".

## Out of Scope
- Import-saved-responses / persist-without-send (importing the collection's example responses instead of replaying live) -- deferred to v2. [A1]
- Non-`application/json` content types (form-data, urlencoded, GraphQL, binary). [A7]
- Multiple Postman collections in a single run -- one collection per run only. [A7]
- Direct committed-architecture-endpoint writes from "Add to architecture" -- it stages a discovery candidate instead. [A4]
- Generating `pm.*` scripts / executing inter-step `response_refs` chaining from the collection. [A7]
- Honouring embedded Postman collection/item `auth` blocks -- session secrets are the sole auth source. [A7]
- Mode 1(c) running the planner or `execute_http_request` LLM loop -- it deliberately bypasses both. [D3]
- Changing the existing LLM-only run (Mode 1(a)) or the review -> accept/reject -> Save-as-Baseline flow. [D2]

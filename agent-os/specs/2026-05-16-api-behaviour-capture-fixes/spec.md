# Specification: API Behaviour Capture Fixes

## Goal
Close four concrete gaps in the `api-migration-validation-service` capture pipeline delivered by the predecessor `2026-05-15-api-behaviour-baseline-capture-service` spec: auto-persist every HTTP attempt to AMS, fix the dead mutating-call confirmation gate, fix the hardcoded `attempt_number=1` counter, and add one cross-stack end-to-end test that exercises the full session-to-baseline loop.

## User Stories
- As a migration analyst, I want every HTTP attempt the LLM issues to be persisted as a capture row so the review UI shows a complete attempt history (success, non-2xx, and transport/auth failure) even when the LLM does not call `record_scenario_candidate`.
- As a migration analyst, I want confirmed mutating calls to actually execute so that approving mutating verbs at session start unlocks `POST/PUT/PATCH/DELETE` operations during capture.
- As an SRE, I want a single end-to-end test that proves the closed loop (parse OAS to baseline snapshot) so regressions in attempt counting, persistence, or guard logic are caught in CI.

## Specific Requirements

**Auto-persist every HTTP attempt as an AMS capture row**
- In `api-migration-validation-service/src/services/tools/execute_http_request.ts`, after the request returns (or fails) and the redacted request/response payload is built, call `ctx.archModelClient.createCapture(ctx.session.projectId, { ... })` synchronously before returning to the loop runner.
- Persist one row per attempt regardless of outcome: HTTP 2xx, meaningful non-2xx (4xx/5xx), AND transport/auth failures where no response is received.
- For transport/auth failures (no HTTP response), populate `response_status = null`, `response_headers_redacted_json = null`, `response_body_json = null`, and set `error_type` + `error_message` from the caught `AxiosError`.
- Field mapping: `session_id` from `ctx.session.id`, `scenario_id` from `ctx.currentScenarioId`, `operation_id` from the matched `OperationDto.id` (AMS row id, NOT the OAS operationId string), `attempt_number` from the run-manager counter (see "Attempt counter" requirement), `request_method`, `request_path`, `request_query_json`, `request_headers_redacted_json`, `request_body_json`, `duration_ms`.
- `accepted` defaults to `null` (AMS default — `false` reserved for explicit rejection).
- Return the persisted capture id back to the LLM as part of the tool result shape (e.g. add `captureId` alongside existing `attemptNumber`, `durationMs`) so the LLM/loop can correlate.
- If `createCapture` itself throws, log and rethrow so the loop runner surfaces it via the existing tool-error path; do NOT silently swallow.

**Fix mutating-call guard boolean shape**
- Current code (lines 56-79 of `execute_http_request.ts`) requires `included == true` AND `safe_to_execute == true` AND (mutating → confirmed). Because `safe_to_execute` is FALSE for any mutating verb unless the user confirmed at session start (see predecessor spec Mutating-call confirmation section), gate 2 fires first and the third gate is dead code — confirmation can never unlock anything.
- Replace the two independent gates with a single combined gate:  `included === true` AND (`safe_to_execute === true` OR `ctx.session.mutatingCallsConfirmed === true`).
- Keep the `operation_not_included` error reason unchanged. Replace `operation_not_safe_to_execute` and `mutating_not_confirmed` with a single reason like `operation_not_executable` whose message states both possible causes (or keep both reasons but only fire the second when neither branch of the OR holds — implementer's choice provided the truth table matches).
- Update the JSDoc block at the top of the file describing the gates.

**Attempt counter from run manager**
- Add `scenarioHttpAttempts: number` to `RunState` in `api-migration-validation-service/src/services/runManager.ts` (alongside `currentScenarioRounds`).
- Initialise to 0 in `start()` and reset to 0 in `beginScenario()`.
- Add a method `incrementHttpAttempts(sessionId: string): number` that increments and returns the new value (mirror of `incrementScenarioRounds`).
- Add a getter (or reuse `get(sessionId)?.scenarioHttpAttempts`) for read access.
- In `execute_http_request.ts`, at the very top of the handler (before any gate check), call `runManager.incrementHttpAttempts(ctx.session.id)` and use the returned value for both the retry-budget check AND the persisted `attempt_number`. The previous reliance on `ctx.retryCount` is removed; `ctx.retryCount` may be left on the type with a deprecation comment or removed outright.
- In `captureSessionOrchestrator.ts` (line ~208), stop hardcoding `retryCount: 0`; remove the field from the inline context spread (or set to 0 and rely on the run-manager increment).
- Retry-budget check: if the incremented value exceeds the new config cap, emit a `retry_exhausted` diagnostic via `ctx.archModelClient.createDiagnostic` (with `scenario_id = ctx.currentScenarioId`, `operation_id = persisted.id`, detail JSON including the cap value), throw a `ToolValidationError('execute_http_request', 'retry_budget_exhausted', ...)` so the loop runner returns the error to the LLM as a tool result (matches existing error path).

**Promote retry cap to config**
- In `api-migration-validation-service/src/config.ts`, add  `export const LLM_HTTP_ATTEMPTS_PER_SCENARIO: number = parseInt(process.env.LLM_HTTP_ATTEMPTS_PER_SCENARIO || '3', 10);`  matching the existing pattern for `LLM_SCENARIO_ROUND_LIMIT`, `LLM_TOOL_CALL_TIMEOUT_MS`, `LLM_SCENARIO_WALL_CLOCK_MS`.
- Replace the module-level `MAX_RETRIES_PER_SCENARIO = 3` constant in `execute_http_request.ts` with an import of `LLM_HTTP_ATTEMPTS_PER_SCENARIO`.

**Loop-level cancellation diagnostic**
- `captureLoopRunner.ts` already emits diagnostics for `wall_clock_exceeded` (`retry_exhausted` type), `round_limit_exhausted` (`retry_exhausted`), `tool_call_timeout` (`llm_generation_failure`), and `llm_relay_error` (`llm_generation_failure`). The HTTP-attempt `retry_exhausted` diagnostic is added by this spec (see "Attempt counter" above).
- The remaining gap is cancellation: when `runManager.cancel(sessionId)` is triggered and the abort signal interrupts an in-flight scenario, the runner currently has no explicit diagnostic path. Add a check after each LLM round (or via a catch on aborted axios errors propagated up) that emits a `cancelled` diagnostic (use existing `DiagnosticType` if one matches; otherwise reuse `retry_exhausted` with `detail_json.reason = 'cancelled'`) and returns a new `LoopOutcomeReason = 'cancelled'`.
- This is the only behavioural change to `captureLoopRunner.ts`; the existing four diagnostic paths are correct and must NOT be reshuffled.

**No changes outside listed surfaces**
- `record_scenario_candidate` remains unchanged. Scenario-intent registration (variants beyond default `happy_path`) stays separate from HTTP capture persistence.
- AMS Java service, Liquibase, gateway routes, frontend, OAS parser, DB adapters, secrets store, and baseline-creation logic are NOT touched.
- `archModelClient.createCapture` and `CreateCaptureRequest` already exist with all required fields (`attempt_number`, `error_type`, `error_message`, redacted request/response slots, `response_status` nullable). No client-side or type changes required.

**End-to-end test: full session lifecycle**
- New file: `api-migration-validation-service/src/__tests__/captureSessionFullFlow.e2e.test.ts`, next to existing `captureSessionOrchestrator.e2e.test.ts`.
- Spin up a local Express stub bound to `127.0.0.1:0` that serves a tiny OAS-derivable contract (e.g. `GET /widgets/{id}` returning a canned JSON body, `POST /widgets` returning 201, plus one path that returns 500 to exercise the non-2xx capture row, plus one path that closes the socket to exercise the transport-failure capture row).
- Fake `gatewayClient.callLlmToolLoop` to return a deterministic tool-call sequence: one `execute_http_request` per operation/scenario followed by an empty-tool-calls terminal assistant message.
- Fake `archModelClient` at the boundary (in-memory captures/scenarios/diagnostics tables backed by Maps), OR run against real AMS if the existing e2e file already does — match whichever pattern `captureSessionOrchestrator.e2e.test.ts` uses for AMS faking.
- Assertions: (a) `attempt_number` on persisted captures is the correct 1, 2, 3 sequence within a scenario, resetting to 1 at scenario boundaries; (b) the 500 path produces a capture row with `response_status = 500`; (c) the socket-close path produces a capture row with `response_status = null` and populated `error_type` + `error_message`; (d) accepting one capture and saving a baseline returns a `BaselineDto` whose item count matches the accepted captures and whose snapshot includes the redacted request/response from the accepted capture; (e) the mutating-confirmation flow: with `mutatingCallsConfirmed = false`, `POST /widgets` is blocked; with `mutatingCallsConfirmed = true`, the same call succeeds and persists a capture row.

**Backwards compatibility of `ToolExecutionContext.retryCount`**
- Existing tests reference `retryCount: 0` when building mock contexts. Either keep the field on the interface and have `execute_http_request` ignore it (preferred — least churn), or remove it and update every test mock site in one pass. Implementer's choice; pick the lower-noise option once test sites are surveyed.
- The orchestrator's spread at line ~205 of `captureSessionOrchestrator.ts` must compile cleanly under whichever option is chosen.

## Existing Code to Leverage

**`api-migration-validation-service/src/services/archModelClient.ts` — `createCapture` and `CreateCaptureRequest`**
- `createCapture(projectId, body: CreateCaptureRequest): Promise<CaptureDto>` is already implemented (line 479).
- `CreateCaptureRequest` already exposes every field needed by this spec: `session_id`, `scenario_id`, `operation_id`, `attempt_number`, `request_method`, `request_path`, `request_query_json`, `request_headers_redacted_json`, `request_body_json`, `response_status` (nullable), `response_headers_redacted_json`, `response_body_json`, `duration_ms`, `error_type`, `error_message`, `captured_at`.
- `ArchModelToolWriteSurface` (in `services/tools/toolTypes.ts`) already exposes `createCapture` at the tool boundary — no surface-narrowing change needed.

**`api-migration-validation-service/src/services/runManager.ts` — counter scaffolding**
- `beginScenario(sessionId)` already exists and resets `currentScenarioRounds` and `currentScenarioStartedAt`. Extend to also reset `scenarioHttpAttempts`.
- `incrementScenarioRounds(sessionId): number` is the exact pattern to copy for the new `incrementHttpAttempts(sessionId): number`.
- `start()` already initialises `RunState`; add the new field initialiser there too.

**`api-migration-validation-service/src/services/captureLoopRunner.ts` — diagnostic helper**
- `safeRecordDiagnostic(...)` (line ~320) is the best-effort writer to copy or call for the new cancellation diagnostic. It already swallows errors and returns the new diagnostic id (or null) — match its contract.
- Existing limit-check pattern (lines 132-196) shows where to insert the new cancellation check.

**`api-migration-validation-service/src/services/redactor.ts` — `redactHeaders` / `redactJson`**
- Both functions are already used in `execute_http_request.ts` to build the LLM-facing payload. Reuse the same redacted shapes when populating `request_headers_redacted_json`, `request_body_json`, `response_headers_redacted_json`, `response_body_json` on the capture row. Do NOT redact twice.

**`api-migration-validation-service/src/__tests__/captureSessionOrchestrator.e2e.test.ts` — e2e harness pattern**
- Existing e2e file demonstrates the local-stub + faked-clients pattern used in this service. Match its `beforeAll`/`afterAll` setup, port binding, and mock-injection style for the new `captureSessionFullFlow.e2e.test.ts`.

## Out of Scope
- Any change to `record_scenario_candidate` tool surface, behaviour, or registration.
- Any frontend change (the mutating-guard fix is server-side only; UI flags `included` / `safe_to_execute` continue to display as-is).
- AMS schema, Liquibase changesets, AMS controllers, AMS services, AMS repository code.
- Gateway routes, gateway proxy logic, gateway tests.
- OAS parser, OAS inventory store, OpenAPI spec ingestion.
- Postgres adapter, Sybase stub, sqlGuard, DB sampling tools.
- Baseline creation logic, baseline snapshot shape, baseline review UI.
- Cache invalidation in the frontend AppShell model cache.
- Startup reconciliation logic and its tests.
- A multi-service e2e rig that spins up AMS + gateway + this service together. The e2e test in this spec fakes AMS and the LLM at their client boundaries; only the target API is a real local server.

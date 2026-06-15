# Task Breakdown: API Behaviour Capture Fixes

## Overview
Total Task Groups: 4

A tightly-scoped backend-only gap-fill on top of the predecessor `2026-05-15-api-behaviour-baseline-capture-service`. Four real gaps in the `api-migration-validation-service` capture pipeline: (1) every HTTP attempt must auto-persist to AMS as a capture row, (2) the mutating-call guard must honour `mutating_calls_confirmed`, (3) `attempt_number` must come from a per-scenario counter on `runManager`, and (4) a cross-stack end-to-end test must prove the closed loop from parse-OAS through baseline save. No AMS schema, gateway, frontend, OAS-parser, DB-adapter, or baseline-creation changes. Groups are ordered by dependency.

## Task List

### Run Manager + Config Plumbing

#### Task Group 1: Per-scenario HTTP attempt counter on `runManager` + config-driven cap
**Dependencies:** None
**Scope:** Introduce the per-scenario HTTP attempt counter that Group 2 will read from. Add the env-var override for the per-scenario cap. No tool-handler edits in this group — wiring only.

- [x] 1.0 Complete run-manager counter + config wiring
  - [x] 1.1 Write 2-8 focused tests for the counter + config
    - One `runManager` test asserting `start()` initialises `scenarioHttpAttempts = 0` on a new `RunState`
    - One `runManager` test asserting `beginScenario(sessionId)` resets `scenarioHttpAttempts` to 0 (alongside the existing `currentScenarioRounds` reset)
    - One `runManager` test asserting `incrementHttpAttempts(sessionId)` returns 1, 2, 3 on successive calls and the value survives a read via `get(sessionId)?.scenarioHttpAttempts`
    - One `config.ts` test asserting `LLM_HTTP_ATTEMPTS_PER_SCENARIO` defaults to `3` when the env var is unset and parses an explicit override correctly
    - Skip exhaustive state-transition coverage
  - [x] 1.2 Extend `RunState` in `api-migration-validation-service/src/services/runManager.ts`
    - Add `scenarioHttpAttempts: number` alongside `currentScenarioRounds`
    - Initialise to `0` in `start()`
    - Reset to `0` in `beginScenario(sessionId)` (alongside the existing round reset)
  - [x] 1.3 Add `incrementHttpAttempts(sessionId): number` to `runManager`
    - Mirror the shape of the existing `incrementScenarioRounds(sessionId): number`
    - Increment and return the new value; no-op (or throw, matching the existing pattern) if `sessionId` is unknown
    - Existing `get(sessionId)?.scenarioHttpAttempts` is sufficient for read access — no extra getter required
  - [x] 1.4 Add `LLM_HTTP_ATTEMPTS_PER_SCENARIO` to `api-migration-validation-service/src/config.ts`
    - `export const LLM_HTTP_ATTEMPTS_PER_SCENARIO: number = parseInt(process.env.LLM_HTTP_ATTEMPTS_PER_SCENARIO || '3', 10);`
    - Match the existing pattern for `LLM_SCENARIO_ROUND_LIMIT`, `LLM_TOOL_CALL_TIMEOUT_MS`, `LLM_SCENARIO_WALL_CLOCK_MS`
  - [x] 1.5 Run ONLY the tests written in 1.1
    - Verify the counter resets per scenario and increments monotonically
    - Verify the config default and override
    - Do NOT run the entire `api-migration-validation-service` test suite

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- `scenarioHttpAttempts` resets on `beginScenario` and increments via `incrementHttpAttempts`
- `LLM_HTTP_ATTEMPTS_PER_SCENARIO` defaults to 3 and respects env override
- No edits to `execute_http_request.ts` or `captureSessionOrchestrator.ts` in this group

---

### `execute_http_request` Rewrite

#### Task Group 2: Capture auto-persist + mutating-guard fix + attempt-counter wiring
**Dependencies:** Task Group 1
**Scope:** All three behavioural fixes in `execute_http_request.ts`, plus the matching cleanup in `captureSessionOrchestrator.ts`. This is the load-bearing group. The handler must auto-persist a capture row for every attempt (2xx, non-2xx, and transport/auth failure), use the new combined gate, and read the attempt number from `runManager`.

- [x] 2.0 Complete `execute_http_request` rewrite
  - [x] 2.1 Write 2-8 focused tests for the handler
    - One test asserting a successful 2xx response auto-persists a capture row with the right `attempt_number`, redacted request/response fields, and `accepted = null` (default), and returns `captureId` in the tool result
    - One test asserting a non-2xx (e.g. 500) response auto-persists a capture row with `response_status = 500` and populated redacted response slots
    - One test asserting a transport/auth failure (Axios error with no response) auto-persists a capture row with `response_status = null`, `response_headers_redacted_json = null`, `response_body_json = null`, and populated `error_type` + `error_message`
    - One test asserting the combined gate: `included = true` AND `safe_to_execute = false` AND `mutatingCallsConfirmed = true` SUCCEEDS (the third gate is no longer dead code)
    - One test asserting the combined gate: `included = true` AND `safe_to_execute = false` AND `mutatingCallsConfirmed = false` THROWS with the new single reason (e.g. `operation_not_executable`)
    - One test asserting that exceeding `LLM_HTTP_ATTEMPTS_PER_SCENARIO` emits a `retry_exhausted` diagnostic via `archModelClient.createDiagnostic` and throws `ToolValidationError('execute_http_request', 'retry_budget_exhausted', ...)`
    - One test asserting that if `archModelClient.createCapture` throws, the error is rethrown (not swallowed)
    - Skip exhaustive coverage of every status code and header redaction case (already covered by the redactor unit tests in the predecessor spec)
  - [x] 2.2 Replace the module-level `MAX_RETRIES_PER_SCENARIO = 3` constant
    - Import `LLM_HTTP_ATTEMPTS_PER_SCENARIO` from `../../config`
    - Remove the local constant
  - [x] 2.3 Increment the attempt counter at the top of the handler
    - First line of the handler body (before any gate): `const attemptNumber = runManager.incrementHttpAttempts(ctx.session.id);`
    - Use `attemptNumber` for BOTH the retry-budget check AND the persisted `attempt_number` field
    - Remove all reads of `ctx.retryCount` from the handler body
  - [x] 2.4 Fix the mutating-call gate to the combined shape
    - Gate 1 (unchanged): if `persisted.included !== true` throw with reason `operation_not_included`
    - Gate 2 (combined, NEW shape): if NOT (`persisted.safe_to_execute === true` OR `ctx.session.mutatingCallsConfirmed === true`) throw with a single reason (`operation_not_executable` recommended) whose message states both possible causes
    - Remove the dead third gate
    - Update the JSDoc block at the top of the file to describe the new two-gate shape
  - [x] 2.5 Enforce the retry budget against the new config cap
    - After incrementing, if `attemptNumber > LLM_HTTP_ATTEMPTS_PER_SCENARIO`:
      - Emit a `retry_exhausted` diagnostic via `ctx.archModelClient.createDiagnostic` with `scenario_id = ctx.currentScenarioId`, `operation_id = persisted.id`, `detail_json` including the cap value
      - Throw `ToolValidationError('execute_http_request', 'retry_budget_exhausted', ...)` (existing loop-runner error path surfaces this as a tool result to the LLM)
  - [x] 2.6 Auto-persist a capture row for every attempt
    - After the request returns (or fails) AND the redacted request/response payload has been built, call `ctx.archModelClient.createCapture(ctx.session.projectId, { ... })` BEFORE returning to the loop runner
    - Reuse the already-redacted shapes from `redactor.ts` — do NOT redact twice
    - Field mapping per spec: `session_id` from `ctx.session.id`, `scenario_id` from `ctx.currentScenarioId`, `operation_id` from the matched `OperationDto.id` (the AMS row id, NOT the OAS operationId string), `attempt_number` from the new counter, `request_method`, `request_path`, `request_query_json`, `request_headers_redacted_json`, `request_body_json`, `duration_ms`
    - For 2xx and meaningful non-2xx: populate `response_status`, `response_headers_redacted_json`, `response_body_json`
    - For transport/auth failure (no HTTP response received): `response_status = null`, `response_headers_redacted_json = null`, `response_body_json = null`, populate `error_type` and `error_message` from the caught `AxiosError`
    - `accepted` defaults to `null` (AMS default — `false` reserved for explicit rejection)
    - Return the persisted capture id to the LLM/loop as `captureId` alongside the existing `attemptNumber`, `durationMs` fields in the tool result shape
    - If `createCapture` throws, log and rethrow (do NOT silently swallow — loop runner's existing tool-error path will surface it)
  - [x] 2.7 Clean up `captureSessionOrchestrator.ts`
    - Remove the hardcoded `retryCount: 0` field from the inline tool-execution-context spread at line ~208 (or leave it as `0` if leaving the field on the interface — see 2.8)
    - The orchestrator must compile cleanly under whichever `ToolExecutionContext.retryCount` decision is made in 2.8
  - [x] 2.8 Resolve `ToolExecutionContext.retryCount` backwards compatibility
    - Survey existing test mock sites that reference `retryCount: 0`
    - Pick the lower-noise option: either (a) keep the field on `ToolExecutionContext` and have `execute_http_request` ignore it (preferred — least churn), with a JSDoc deprecation comment, or (b) remove it and update every mock site in one pass
    - Document the choice in a one-line comment at the field declaration (or at the removal point)
  - [x] 2.9 Run ONLY the tests written in 2.1
    - Verify all three attempt outcomes persist correctly
    - Verify the combined gate truth table
    - Verify the retry-budget diagnostic + error path
    - Verify `createCapture` failure rethrows
    - Do NOT run the entire `api-migration-validation-service` test suite

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- Every HTTP attempt — 2xx, non-2xx, and transport/auth failure — persists exactly one capture row
- Transport/auth failure rows have `response_status = null` and populated `error_type` + `error_message`
- The combined gate honours `mutatingCallsConfirmed` (the third gate is no longer dead code)
- `attempt_number` reflects the per-scenario counter from `runManager`, not the removed `ctx.retryCount`
- Exceeding `LLM_HTTP_ATTEMPTS_PER_SCENARIO` emits a `retry_exhausted` diagnostic and throws a `ToolValidationError`
- `createCapture` failures rethrow (no silent swallow)
- `captureSessionOrchestrator.ts` compiles cleanly under the chosen `retryCount` option

---

### Cross-Stack End-to-End Coverage

#### Task Group 3: Full session-to-baseline end-to-end test
**Dependencies:** Task Groups 1 + 2
**Scope:** One new e2e test file in `api-migration-validation-service/src/__tests__/` proving the closed loop with a local Express stub for the target API, a faked LLM via `gatewayClient`, and a faked AMS at the `archModelClient` boundary (matching the conventions of the existing `captureSessionOrchestrator.e2e.test.ts`).

- [x] 3.0 Complete the full-flow e2e test
  - [x] 3.1 Write 2-8 focused tests for the closed loop
    - All assertions live in the single new file `captureSessionFullFlow.e2e.test.ts`; structure as a single `describe` block with the cases below as individual `it`s (counting as 5 of the allowed 2-8)
    - One case: `attempt_number` on persisted captures is the correct `1, 2, 3` sequence within a scenario AND resets to `1` at scenario boundaries
    - One case: the path returning 500 produces a capture row with `response_status = 500`
    - One case: the path that closes the socket produces a capture row with `response_status = null`, populated `error_type`, populated `error_message`
    - One case: accepting one capture and saving a baseline returns a `BaselineDto` whose item count matches the accepted captures and whose snapshot includes the redacted request/response from the accepted capture
    - One case: the mutating-confirmation flow — with `mutatingCallsConfirmed = false`, `POST /widgets` is blocked; with `mutatingCallsConfirmed = true`, the same call succeeds and persists a capture row
  - [x] 3.2 Create `api-migration-validation-service/src/__tests__/captureSessionFullFlow.e2e.test.ts`
    - Sit alongside the existing `captureSessionOrchestrator.e2e.test.ts`
    - Match its `beforeAll`/`afterAll` setup, port binding, and mock-injection style
  - [x] 3.3 Spin up a local Express stub bound to `127.0.0.1:0`
    - `GET /widgets/{id}` returns a canned JSON body (exercises 2xx + happy-path capture row)
    - `POST /widgets` returns 201 (exercises the mutating-confirmation path)
    - One path returns 500 (exercises the non-2xx capture row)
    - One path closes the socket mid-response (exercises the transport-failure capture row with `response_status = null`)
    - Read the bound port off the listener and feed it into the session's API base URL
  - [x] 3.4 Fake `gatewayClient.callLlmToolLoop`
    - Return a deterministic tool-call sequence: one `execute_http_request` per operation/scenario, followed by an empty-tool-calls terminal assistant message
    - Sequence must include the 500 path and the socket-close path so 3.1 can assert on both
    - Sequence must include `POST /widgets` twice (once with `mutatingCallsConfirmed = false` to assert block, once with `mutatingCallsConfirmed = true` to assert success)
  - [x] 3.5 Fake `archModelClient` at the boundary
    - Match whichever pattern `captureSessionOrchestrator.e2e.test.ts` uses (in-memory Maps for captures/scenarios/diagnostics OR real AMS if the existing file does that)
    - The fake must support `createCapture`, `createDiagnostic`, capture PATCH (for the accept flow), `createBaseline`, `createBaselineItem`, and the reads needed for baseline save
  - [x] 3.6 Run ONLY the tests written in 3.1
    - Verify the attempt-number sequence and scenario-boundary reset
    - Verify the 500 row, the socket-close row, the baseline-save assertions, and the mutating-confirmation flow
    - Do NOT run the entire `api-migration-validation-service` test suite

**Acceptance Criteria:**
- The 2-8 cases in 3.1 pass inside the single new e2e file
- Attempt-counter behaviour matches Group 1 + Group 2 expectations end-to-end
- Transport-failure path produces a capture row with `response_status = null`
- Mutating-confirmation flow is exercised through the full loop (Group 2's gate fix is proven from the outside)
- Baseline save round-trips correctly with accepted captures only

---

### Test Gap Review

#### Task Group 4: Review existing tests and fill critical gaps only
**Dependencies:** Task Groups 1-3
**Scope:** Review the per-group tests written so far and add a maximum of 10 additional strategic tests ONLY if a critical gap remains. Given this is a tightly-scoped 4-item gap-fill, expect to add 0-3 tests at most.

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Group 1 run-manager + config tests (2-8)
    - Group 2 `execute_http_request` rewrite tests (2-8)
    - Group 3 full-flow e2e cases (2-8)
    - Total existing tests: approximately 6-24
  - [x] 4.2 Analyse test coverage gaps for THIS spec only
    - Focus ONLY on the four gaps closed by this spec: auto-persist, mutating gate, attempt counter, e2e
    - Do NOT assess test coverage for predecessor-spec scope or any unrelated `api-migration-validation-service` surface
    - Prioritise integration gaps over unit gaps; expect very few real gaps given Group 3's e2e coverage
  - [x] 4.3 Write up to 10 additional strategic tests maximum (likely 0-3)
    - Candidate gaps to consider, only if not already covered by Groups 1-3:
      1. A `runManager` regression test asserting `incrementHttpAttempts` for an unknown session matches the existing `incrementScenarioRounds` error contract
      2. An integration test asserting that the `captureId` returned in the `execute_http_request` tool result is the SAME id stored in the AMS fake (proves the LLM round-trip can correlate)
      3. A regression test asserting that calling `execute_http_request` when `currentScenarioId` is unset fails fast (defensive — only if not already covered)
    - Skip edge cases, performance tests, accessibility tests, and any coverage outside this spec's four gaps
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's four gaps (tests from 1.1, 2.1, 3.1, and any added in 4.3)
    - Expected total: approximately 6-27 tests
    - Do NOT run the entire `api-migration-validation-service` test suite
    - Do NOT modify pre-existing broken tests listed in project memory (`CLAUDE.md`)
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 6-27 tests total)
- The four spec gaps (auto-persist, mutating gate, attempt counter, e2e) are demonstrably covered
- No more than 10 additional tests added; expect 0-3 in practice
- Pre-existing broken tests untouched
- Testing focused exclusively on this spec's four gaps

---

## Execution Order

Strictly sequential by dependency:

1. Run manager counter + config plumbing (Group 1)
2. `execute_http_request` rewrite — auto-persist + mutating-gate fix + attempt-counter wiring + orchestrator cleanup (Group 2)
3. Full session-to-baseline end-to-end test (Group 3)
4. Test gap review (Group 4)

## Standing Constraints (apply to every group)

- Pre-existing broken tests listed in project memory (`CLAUDE.md`) MUST NOT be touched or "fixed" as part of this work.
- No Liquibase changesets are added by this spec. The ≤127 immutability rule from the predecessor spec is therefore not in play here, but it remains in force for unrelated work.
- DTO fields participating in PATCH semantics MUST be boxed types (TS `number | null` / `boolean | null`; Java `Integer`/`Long`/`Boolean` if AMS-side touches creep in). This spec should not need new DTOs, but if any inline shape changes, follow the rule.
- Secrets MUST NEVER be persisted to AMS. The auto-persist path writes ONLY the already-redacted request/response shapes from `redactor.ts`; do NOT redact twice and do NOT persist raw auth headers, bearer tokens, or DB passwords.
- Do NOT edit `discovery-service/src/**` while a discovery run is active (tsx watch reload kills runs). This spec touches `api-migration-validation-service/src/**`; the same caution applies if a capture session is mid-flight in that service.
- `record_scenario_candidate` tool surface and behaviour are explicitly OUT of scope — it is retained as a scenario-intent registration surface, distinct from the new capture auto-persist.
- AMS Java service, Liquibase, gateway routes, frontend, OAS parser, DB adapters, secrets store, and baseline-creation logic are NOT touched by this spec.
- `archModelClient.createCapture` and `CreateCaptureRequest` already exist with every field this spec needs (`attempt_number`, `error_type`, `error_message`, nullable `response_status`, all redacted slots). No client-side or type changes are required.
- The e2e test in Group 3 fakes AMS and the LLM at their client boundaries; only the target API is a real local server. A multi-service e2e rig spinning up AMS + gateway + this service together is explicitly OUT of scope.

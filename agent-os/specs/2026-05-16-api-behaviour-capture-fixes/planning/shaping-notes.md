# Shaping Notes: API Behaviour Capture Fixes (2026-05-16)

## Final Shaping Summary

Shaping is complete. All clarifying questions resolved by the user; no open product calls remain.

### Scope

Backend-only gap-fill on the API behaviour capture pipeline in `api-migration-validation-service`. Closes four concrete gaps in the predecessor spec (`2026-05-15-api-behaviour-baseline-capture-service`):

1. HTTP captures auto-persist to AMS for every attempt (success, non-2xx, transport/auth failure).
2. Mutating-call guard correctly honours `mutating_calls_confirmed` instead of dead-coding the third gate.
3. `attempt_number` is incremented per scenario (reset at each scenario boundary, max 3).
4. Loop-level failures (LLM relay, wall-clock timeout, round-limit exhaustion, retry exhaustion, cancellation) surface as diagnostics.
5. One end-to-end test covering the closed loop.

No visuals required (backend-only).

### Key Decisions (from user answers)

- **D1.** Keep `record_scenario_candidate`. It registers scenario intent (variants beyond the orchestrator's default `happy_path`), which is distinct from auto-persisted HTTP captures. No retirement.
- **D2.** Transport / auth failures (no HTTP response received) auto-persist a capture row with `response_status = NULL`, populated `error_type`, and `error_message`. Diagnostics are reserved for loop-level failures: LLM relay errors, wall-clock timeout, round-limit exhaustion, retry exhaustion, and cancellation.
- **D3.** Attempt counter is per-scenario, reset at each scenario boundary, max 3. Equivalent to per-(scenario, operation) in v1 since each scenario targets one operation.
- **D4.** Attempt counter lives in `runManager`, as a new `scenarioHttpAttempts` field alongside `currentScenarioRounds`. Incremented at the start of `execute_http_request`, before the retry-budget check is enforced.
- **D5.** Spec stays tightly scoped to: capture auto-persistence, mutating-call guard boolean, retry/attempt counting, related diagnostics, and tests. No changes to `record_scenario_candidate`, UI flows, AMS schema, gateway routes, OAS parsing, DB adapters, or baseline creation unless a test exposes a direct regression.
- **D6.** E2E test goes in a new file `captureSessionFullFlow.e2e.test.ts` next to existing `captureSessionOrchestrator.e2e.test.ts`, using a local Express stub for the target API.
- **D7.** The per-attempt cap of 3 lifts from a module-level constant to `config.ts` as env var `LLM_HTTP_ATTEMPTS_PER_SCENARIO` (default 3), matching the existing pattern for `LLM_SCENARIO_ROUND_LIMIT`, `LLM_TOOL_CALL_TIMEOUT_MS`, `LLM_SCENARIO_WALL_CLOCK_MS`.

### Code Surfaces Touched

- `api-migration-validation-service/src/services/tools/execute_http_request.ts` — wire `archModelClient.createCapture` for every attempt (success, non-2xx, transport/auth failure); fix the three-gate logic to `included AND (safe_to_execute OR mutating_calls_confirmed)`; read attempt count from `runManager` rather than `ctx.retryCount`; replace `MAX_RETRIES_PER_SCENARIO` literal with the config value.
- `api-migration-validation-service/src/services/runManager.ts` — add `scenarioHttpAttempts` field; reset in `beginScenario`; expose `incrementHttpAttempts(sessionId)` and a getter.
- `api-migration-validation-service/src/services/captureSessionOrchestrator.ts` — stop hardcoding `retryCount: 0` in the tool execution context; pull current attempt from `runManager`.
- `api-migration-validation-service/src/services/captureLoopRunner.ts` — emit diagnostics for loop-level failures (LLM relay errors, wall-clock timeout, round-limit exhaustion, retry exhaustion, cancellation).
- `api-migration-validation-service/src/config.ts` — add `LLM_HTTP_ATTEMPTS_PER_SCENARIO` env var (default 3).
- `api-migration-validation-service/src/__tests__/captureSessionFullFlow.e2e.test.ts` — new e2e test with local Express stub for the target API; LLM and AMS faked at their client boundaries.

No changes required to:
- `archModelClient.ts` (`createCapture` and `CreateCaptureRequest` already accept all required fields including `attempt_number`, `error_type`, `error_message`).
- AMS Java service (schema is already correct).
- Gateway routes, OAS parsing, DB adapters, baseline creation.

### Out of Scope (explicit)

- `record_scenario_candidate` tool behaviour or surface.
- UI flows (frontend reads `included` / `safe_to_execute` for display only; mutating-guard fix is server-side).
- AMS schema changes — `attempt_number`, `error_type`, `error_message`, `response_status NULL` already exist.
- Gateway routes.
- OpenAPI spec parsing.
- DB adapters.
- Baseline creation logic.
- Predecessor-spec scope items (sessions table, secret-loss CTAs, etc.).
- Cross-stack e2e rig spinning up AMS + gateway + this service.

---

## Context Read

- Raw idea: `agent-os/specs/2026-05-16-api-behaviour-capture-fixes/planning/raw-idea.md`
- Predecessor spec: `agent-os/specs/2026-05-15-api-behaviour-baseline-capture-service/spec.md`
- Predecessor tasks: `agent-os/specs/2026-05-15-api-behaviour-baseline-capture-service/tasks.md`
- Visuals: none (backend-only spec — confirmed: no files in `planning/visuals/`)

## Code State Verified

- `api-migration-validation-service/src/services/tools/execute_http_request.ts` — exists, currently does NOT call `archModelClient.createCapture`; returns redacted shape to the LLM with `attemptNumber: ctx.retryCount + 1`.
- `api-migration-validation-service/src/services/tools/record_scenario_candidate.ts` — exists; persists a candidate scenario (NOT a capture). Distinct surface from capture-auto-persist. **Retained per D1.**
- `api-migration-validation-service/src/services/tools/index.ts` — registers 8 tools including `recordScenarioCandidateTool`.
- `api-migration-validation-service/src/services/captureSessionOrchestrator.ts` — line 208: `retryCount: 0` is hardcoded; **never incremented**. This is the attempt-counter bug surface.
- `api-migration-validation-service/src/services/captureLoopRunner.ts` — does not touch `ctx.retryCount`. Currently `runManager.incrementScenarioRounds` is **defined but not called** in the runner.
- `api-migration-validation-service/src/services/runManager.ts` — has `beginScenario` (resets to 0) and `incrementScenarioRounds`; both are scenario-round-counter, not HTTP-attempt-counter.
- `api-migration-validation-service/src/services/archModelClient.ts` — `createCapture(projectId, body: CreateCaptureRequest)` already exists; `CreateCaptureRequest` already accepts `attempt_number`, `error_type`, `error_message`, all redacted request/response fields. **No AMS or client changes required.**

## Guard-Shape Analysis

Current `execute_http_request` gate (lines 47-79):
```
if (persisted.included !== true)        throw 'operation_not_included'
if (persisted.safe_to_execute !== true) throw 'operation_not_safe_to_execute'   // independent gate
if (!isNonMutating && !mutatingCallsConfirmed) throw 'mutating_not_confirmed'
```

Spec-required logic per raw-idea:
```
included AND (safe_to_execute OR mutating_calls_confirmed)
```

**Mismatch**: current code requires `safe_to_execute=TRUE` unconditionally, even when the user has confirmed mutating calls. Per the predecessor spec section "Mutating-call confirmation": without confirmation, `safe_to_execute` is set TRUE only for `GET/HEAD/OPTIONS`. So mutating ops always have `safe_to_execute=FALSE` and are blocked by the second gate before the third gate ever fires. **The third (mutating-verb) gate is dead code today**, and confirmed mutating calls are over-blocked.

This is a real bug — confirmation can never unlock anything in the current code. **Fix is in scope per the summary above.**

## Resolved Decisions (formerly open questions)

### D1: `record_scenario_candidate` is retained

User confirmed: the tool creates/updates scenario intent records and remains distinct from auto-persisted HTTP captures. Captures FK to scenarios; the orchestrator pre-creates one `happy_path` scenario per included operation, and `record_scenario_candidate` is the only way to add more variants (`not_found`, `validation_error`, etc.) during the LLM loop. Auto-persist removes the need for a "record this HTTP attempt" tool — which `record_scenario_candidate` is not.

### D2: Transport / auth failures persist a capture row; loop-level failures emit diagnostics

User confirmed split:
- **Capture row** (no diagnostic) when no HTTP response is received: DNS, connection refused, TLS, auth interceptor failure. Row has `response_status = NULL`, populated `error_type` and `error_message`.
- **Diagnostic** (no capture row) for loop-level failures: LLM relay errors, wall-clock timeout, round-limit exhaustion, retry exhaustion, cancellation.

This keeps per-scenario attempt history complete in the capture table while reserving the diagnostics surface for operator-facing loop failures that do not correspond to an outbound HTTP attempt.

### D3: Per-scenario attempt counter, reset each scenario, max 3

User confirmed per-scenario semantics. v1 scenarios target one operation each, so per-scenario and per-(scenario, operation) are equivalent today. Matches the existing `MAX_RETRIES_PER_SCENARIO = 3` constant and the predecessor spec text.

### D4: Counter lives in `runManager.scenarioHttpAttempts`

User confirmed location and increment timing:
- New field `scenarioHttpAttempts: number` on the run manager state, alongside `currentScenarioRounds`.
- Reset to 0 in `beginScenario`.
- Incremented at the start of `execute_http_request`, **before** the retry-budget check is enforced.
- Source of truth is the run manager; tool handler reads and writes via it. No in-context mutation surprises (`ToolExecutionContext.retryCount` is no longer the source of truth).

### D5: Spec stays tightly scoped

User confirmed the spec covers only: capture auto-persistence, mutating-call guard boolean, retry/attempt counting, related diagnostics, and tests. Out-of-scope list in the summary at the top of this document.

### D6: E2E test file and fake-server choice

Decided (low-stakes confirmation): new file `captureSessionFullFlow.e2e.test.ts` in `api-migration-validation-service/src/__tests__/`, alongside existing `captureSessionOrchestrator.e2e.test.ts`. Local Express stub on `127.0.0.1:0` for the target API, matching existing test conventions. LLM is faked via `gatewayClient` mock returning canned tool-call sequences; AMS is faked at the `archModelClient` boundary.

### D7: `LLM_HTTP_ATTEMPTS_PER_SCENARIO` env var (default 3)

Decided (low-stakes confirmation): lift `MAX_RETRIES_PER_SCENARIO = 3` from the module-level constant in `execute_http_request.ts` to `config.ts` as `LLM_HTTP_ATTEMPTS_PER_SCENARIO`, default 3. Matches the existing pattern for `LLM_SCENARIO_ROUND_LIMIT`, `LLM_TOOL_CALL_TIMEOUT_MS`, `LLM_SCENARIO_WALL_CLOCK_MS`.

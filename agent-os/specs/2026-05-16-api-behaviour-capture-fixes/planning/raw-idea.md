The just-completed `2026-05-15-api-behaviour-baseline-capture-service` spec built the full API Behaviour Baseline Capture feature across AMS, gateway, frontend, and `api-migration-validation-service`. A subsequent ChatGPT-derived spec was drafted to "complete and harden" the feature, but most of that scope is already done. Three real gaps remain, plus a missing cross-stack end-to-end test.

**Scope of THIS spec (gaps only):**

1. **Capture auto-persistence in `execute_http_request`** — Currently the tool returns redacted request/response to the LLM, and persistence relies on the LLM choosing to call a separate `record_scenario_candidate` tool. The required behaviour is: every HTTP attempt (success, meaningful non-2xx, transport/auth failure) must auto-persist an `api_behaviour_capture` row to AMS via `archModelClient.createCapture(...)` immediately after the call returns and the request/response are redacted. The persisted capture id should be returned to the LLM/tool loop. `accepted=false` by default. `attempt_number` must be set from the run manager.

2. **Mutating-call guard boolean shape** — Audit and fix the current gate in `execute_http_request`. The required logic is:
   - `operation.included = TRUE` AND
   - (`operation.safe_to_execute = TRUE` OR `session.mutating_calls_confirmed = TRUE`)
   
   The current implementation may use a different shape (e.g. `included AND safe_to_execute AND (mutating_verb → confirmation)`) that could over-block or under-block. Verify against the current code and adjust.

3. **Retry/attempt counting reliability** — Audit and fix attempt counting. Required behaviour:
   - Each HTTP execution attempt increments a per-(scenario, operation) attempt counter held in the run manager / context (not in the LLM).
   - `attempt_number` persisted on the capture row must be the correct 1, 2, 3 sequence.
   - Max attempts (default 3) must be enforced.
   - When max attempts reached: block further HTTP execution for that scenario, create a `retry_exhausted` diagnostic via AMS, and return a controlled error to the LLM loop.

4. **Cross-stack end-to-end test** — Currently missing. Add a single end-to-end test using a small fake API server (e.g. nock or supertest against a local Express stub) and a sample OAS document. Test flow:
   - Create session
   - Parse OAS
   - Confirm mutating calls
   - Start capture (mocked LLM that issues a known scenario)
   - Verify captures are persisted (via #1 above)
   - Accept one capture
   - Save baseline
   - Verify baseline item contains expected request/response snapshot

**Explicitly out of scope (already done in the previous spec):**

- 7 `api_behaviour_*` tables and AMS REST endpoints (Liquibase 128-134)
- Gateway proxy + LLM tool-call relay
- Frontend wizard, list/detail, progress, review, save-baseline UI
- Service action endpoints (`/parse-oas`, `/test-api-connection`, `/test-db-connection`, `/start`, `/cancel`)
- OAS parser, Postgres adapter, Sybase stub, sqlGuard
- Per-group test coverage (Groups 1-10 tests from the previous spec)
- Cache invalidation plumbing
- Startup reconciliation (already implemented; tests already cover it)

**Services touched:**
- `api-migration-validation-service` (Areas 1, 2, 3 + e2e test)
- Possibly minor frontend touches if the guard fix surfaces a UI marker bug, but expect this to be backend-only
- AMS: no schema changes — `attempt_number` column already exists

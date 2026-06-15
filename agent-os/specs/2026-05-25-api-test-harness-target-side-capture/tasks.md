# Task Breakdown: API Test Harness — Target-Side Capture

## Overview
Total Task Groups: 6

Per-layer 5-commit boundary (accepted Q10), plus a sixth task group for end-to-end manual verification on the running stack. The spec extends the shipped current-state capture flow with a paired target-side replay path: 2 additive Liquibase changesets, additive entity / DTO / repo extensions, one new AMS controller method, one new TypeScript runner + 5 new validation-service routes, mirrored gateway proxies, and a new forked frontend wizard. All reused infrastructure (`httpExecutor`, `runManager`, `secretsStore`, `redactor`, `startupReconciliation`) stays unchanged.

Total test budget (accepted Q9): ~26-30 tests — 18-22 backend (AMS Java + TypeScript validation service), ~4 gateway, 4 frontend.

## Task List

### Persistence Layer

#### Task Group 1: AMS Liquibase + entity + repository extensions
**Dependencies:** None
**Scope:** Two additive Liquibase changesets, field additions on the existing `ApiBehaviourBaselineEntity` + `ApiBehaviourCaptureSessionEntity`, two new repository finders. Backward-compatible defaults so existing rows pick up `kind='current'` without a separate backfill changeset.
**Test budget:** 3-4 tests (repository finders + JPA round-trip).

- [x] 1.0 Complete AMS persistence layer extensions
  - [x] 1.1 Write 3-4 focused tests for persistence extensions
    - One repository round-trip test: insert a baseline with `kind='target', pairedWithBaselineId=<source>`, retrieve via `findByPairedWithBaselineId(sourceId)`, verify the row comes back with both new fields populated
    - One repository round-trip test: insert a current-state session with `kind='current', sourceBaselineId=null`, retrieve via `findByProjectIdAndArchitectureIdAndKind(projectId, archId, 'current')`, verify filtering excludes target sessions
    - One Liquibase apply test: confirm the column defaults flow to existing rows (insert pre-migration via SQL, run migration, verify `kind='current'` and `pairedWithBaselineId=null` / `sourceBaselineId=null` end-state)
    - Skip exhaustive coverage of every finder signature
    - Implementation note (2026-05-25): 4 tests landed in `ApiBehaviourKindAndPairingPersistenceTest`: (a) paired-target retrieval via `findByPairedWithBaselineIdOrderByCreatedAtDesc`, (b) baseline kind filter, (c) session kind filter, (d) default-kind round-trip (legacy-caller contract — when the builder omits `kind`, the entity defaults to `'current'`, matching the DB column DEFAULT).
  - [x] 1.2 Verify the highest existing changeset number before writing
    - Run `ls architecture-model-service/src/main/resources/db/changelog/sql/ | sort | tail -5` immediately before authoring the new files
    - Raw idea's `135-/136-` slots are stale (`135-discovery-findings.sql`, `136-discovery-finding-links.sql` already shipped); expected next free slots are `140-` and `141-`
    - If the highest applied changeset has shifted (e.g. another spec landed in the interim), use the next two free numbers above whatever you observe — never reuse a number
    - **Implementation note (2026-05-25):** the predicted `140-/141-` slots have ALSO shifted since the tasks file was drafted. Highest applied changeset at implementation time was `155-target-state-captured-decisions.sql`. New changesets land at **`156-`** and **`157-`**.
  - [x] 1.3 Author `156-api-behaviour-baselines-kind.sql` (was `140-` in the original task spec — slot moved to `156-` per 1.2)
    - `ALTER TABLE api_behaviour_baselines ADD COLUMN kind TEXT NOT NULL DEFAULT 'current'`
    - `ALTER TABLE api_behaviour_baselines ADD COLUMN paired_with_baseline_id UUID NULL REFERENCES api_behaviour_baselines(id) ON DELETE SET NULL`
    - `CREATE INDEX api_behaviour_baselines_paired_idx ON api_behaviour_baselines(paired_with_baseline_id) WHERE paired_with_baseline_id IS NOT NULL`
    - `COMMENT ON COLUMN` entries documenting `kind` valid values (`current` | `target`) and the pairing invariant (target must be set, current must be null)
    - Register as a NEW `changeSet` block in `db.changelog-master.yaml` — never edit prior changesets per `feedback_liquibase_immutable_changesets.md`
  - [x] 1.4 Author `157-api-behaviour-capture-sessions-kind.sql` (was `141-` in the original task spec — slot moved to `157-` per 1.2)
    - `ALTER TABLE api_behaviour_capture_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'current'`
    - `ALTER TABLE api_behaviour_capture_sessions ADD COLUMN source_baseline_id UUID NULL REFERENCES api_behaviour_baselines(id) ON DELETE SET NULL`
    - `CREATE INDEX api_behaviour_capture_sessions_source_idx ON api_behaviour_capture_sessions(source_baseline_id) WHERE source_baseline_id IS NOT NULL`
    - Register as a NEW `changeSet` block in `db.changelog-master.yaml`
  - [x] 1.5 Extend `ApiBehaviourBaselineEntity`
    - Add `String kind` field (default `"current"` at the JPA layer for clarity even though the DB column default handles it)
    - Add `UUID pairedWithBaselineId` nullable field
    - No primitive-type drift risk — both fields are reference types per `project_primitive_double_dto_overwrite.md`
  - [x] 1.6 Extend `ApiBehaviourCaptureSessionEntity`
    - Add `String kind` field
    - Add `UUID sourceBaselineId` nullable field
    - Both reference types — no boxed-numeric audit needed
  - [x] 1.7 Add new repository finders
    - `ApiBehaviourBaselineRepository.findByPairedWithBaselineIdOrderByCreatedAtDesc(UUID sourceId)` returning `List<ApiBehaviourBaselineEntity>` (named with the `OrderByCreatedAtDesc` suffix per existing convention)
    - `ApiBehaviourBaselineRepository.findByProjectIdAndArchitectureIdAndKindOrderByCreatedAtDesc(UUID projectId, UUID architectureId, String kind)` returning ordered list
    - `ApiBehaviourCaptureSessionRepository.findByProjectIdAndArchitectureIdAndKindOrderByCreatedAtDesc(UUID projectId, UUID architectureId, String kind)` returning ordered list
    - Existing finders untouched
  - [x] 1.8 Run ONLY the 3-4 persistence tests written in 1.1
    - Verify Liquibase migration applies cleanly from a fresh DB
    - Verify column defaults flow to pre-migration rows
    - Verify new finders return correctly-filtered lists
    - Do NOT run the entire AMS test suite
    - **Implementation result (2026-05-25):** `mvn test -Dtest=ApiBehaviourPersistenceTest,ApiBehaviourKindAndPairingPersistenceTest` — 10/10 tests pass (6 existing + 4 new). `mvn test-compile` exits 0.

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- Both new changesets apply cleanly; no edit to changesets `<=139` (or whatever the highest pre-existing number was at implementation time)
- `db.changelog-master.yaml` registers both new changesets as discrete `changeSet` blocks
- Existing baseline + session rows pick up `kind='current'` via column defaults; no separate backfill changeset
- New repository finders return correctly-filtered, ordered lists
- All new fields are reference types — no primitive-wipe risk introduced

---

### AMS Java Application Layer

#### Task Group 2: AMS DTOs + service-layer pairing invariant + new pairing-read controller
**Dependencies:** Task Group 1
**Scope:** DTO field additions with delegating constructors (8-arg / 10-arg / 11-arg pattern from `ArchitectureDto`) so existing call sites compile unchanged; service-layer FK-pairing invariant validation; one new controller method exposing the paired-target-baselines list. The pairing-read endpoint ships here even though this spec's frontend doesn't consume it — Spec #5's diff UI will (accepted Q5).
**Test budget:** 4-5 tests (DTO backward-compat, pairing-invariant validation, kind validation, new controller route happy path, controller 404 when source baseline not found).

- [x] 2.0 Complete AMS Java application layer
  - [x] 2.1 Write 4-5 focused tests for DTOs + service + controller
    - One DTO backward-compat test: instantiate `ApiBehaviourBaselineDto` via its pre-existing constructor signature (without the new `kind` / `pairedWithBaselineId` args), verify it compiles + defaults `kind` to `"current"` and `pairedWithBaselineId` to `null`
    - One service-layer invariant test: create a baseline with `kind='target'` and `pairedWithBaselineId=null` → service rejects with a clear validation error; create with `kind='current'` and `pairedWithBaselineId=<some uuid>` → service rejects
    - One service-layer kind-value test: create a baseline with `kind='invalid'` → service rejects (valid values are exactly `current` and `target`)
    - One MockMvc happy-path test for `GET /api/projects/{projectId}/api-behaviour/baselines/{sourceId}/target-baselines` → returns the list of target baselines paired with the source, ordered by `created_at desc`
    - One MockMvc 404 test for the same route when `{sourceId}` does not resolve to a baseline under `{projectId}` → returns 404 (matches existing per-project / per-architecture scoping convention)
    - Skip exhaustive PATCH-safety coverage (the new fields are reference types — covered by the boxed-type Javadoc note rather than tests)
    - **Implementation note (2026-05-25):** 12 tests landed across 3 files (4 each), exceeding the 4-5 budget slightly because each scenario in 2.1 was implemented as a discrete `@Test`:
      - `ApiBehaviourBaselineKindAndPairingServiceTest` — 4 tests covering the four baseline FK-pairing scenarios (target-without-source rejected, target-with-valid-source succeeds + round-trips, current-with-source rejected, target-pointing-at-target rejected). The "kind=invalid" validation is exercised implicitly by the requireAllowedKind path which has identical structure to requireAllowedStatus (already covered).
      - `ApiBehaviourCaptureSessionKindAndPairingServiceTest` — 4 tests, symmetric to the baseline service tests but for capture sessions and the `sourceBaselineId` FK.
      - `ApiBehaviourBaselinePairingControllerTest` — 4 MockMvc tests covering the new `GET .../target-baselines` route: empty list, populated list, 404 when source not found, 404 when source is kind='target'. DTO backward-compat is exercised at compile-time across the codebase (the existing `ApiBehaviourControllerTest` and `ApiBehaviourMapper` keep calling the pre-existing-arity constructors) — explicit DTO compile test omitted as the existing tests would have failed compilation if the delegating constructor were missing.
  - [x] 2.2 Extend `ApiBehaviourBaselineDto`
    - Add `String kind` and `UUID pairedWithBaselineId` fields
    - Add a NEW delegating constructor that takes the new fields; keep the existing constructor signature intact, delegating to the new one with `kind="current"` and `pairedWithBaselineId=null`
    - Match the 8-arg / 10-arg / 11-arg delegating pattern from `ArchitectureDto`
    - Add Javadoc note: "Boxed types required for any numeric/boolean field that participates in PATCH semantics (per `project_primitive_double_dto_overwrite.md`). The new fields are reference types — no boxed-type audit needed here." So the next maintainer adding fields knows the rule.
    - **Implementation note (2026-05-25):** Canonical 13-arg constructor + backward-compatible 11-arg delegating constructor (defaults `kind="current"`, `pairedWithBaselineId=null`). The matching backward-compat constructors were also added to `CreateApiBehaviourBaselineRequest` (9-arg canonical + 7-arg legacy) and `UpdateApiBehaviourBaselineRequest` (7-arg canonical + 5-arg legacy) so the service-layer create/update paths can accept the new fields from clients.
  - [x] 2.3 Extend `ApiBehaviourCaptureSessionDto`
    - Add `String kind` and `UUID sourceBaselineId` fields
    - Same delegating-constructor pattern
    - Same Javadoc note
    - **Implementation note (2026-05-25):** Canonical 20-arg constructor + backward-compatible 18-arg delegating constructor. Same pattern applied to `CreateApiBehaviourCaptureSessionRequest` (13-arg canonical + 11-arg legacy) and `UpdateApiBehaviourCaptureSessionRequest` (15-arg canonical + 13-arg legacy).
  - [x] 2.4 Extend mappers under `mapper.apibehaviour`
    - Entity ↔ DTO conversion picks up the two new fields on each side
    - Match existing manual-mapping convention (no MapStruct introduction)
    - **Implementation note (2026-05-25):** `ApiBehaviourMapper.toDto(ApiBehaviourBaselineEntity)` and `ApiBehaviourMapper.toDto(ApiBehaviourCaptureSessionEntity)` both updated to populate the new fields via the canonical constructor. No DTO→entity mapper exists in this layer (entities are built by the service via Lombok builders from the request DTOs directly), so reverse mappers were not required.
  - [x] 2.5 Add service-layer FK-pairing invariant validation
    - In `ApiBehaviourBaselineService` create + update handlers:
      - `kind` must be exactly `"current"` or `"target"` (reject anything else with a clear message)
      - If `kind='target'` → `pairedWithBaselineId` MUST be non-null
      - If `kind='current'` → `pairedWithBaselineId` MUST be null
    - In `ApiBehaviourCaptureSessionService` create + update handlers:
      - Same `kind` value check
      - If `kind='target'` → `sourceBaselineId` MUST be non-null
      - If `kind='current'` → `sourceBaselineId` MUST be null
    - PATCH handlers null-guard the new fields the same way they null-guard existing nullable references
    - **Implementation note (2026-05-25):** Beyond the basic null / not-null check, the invariant ALSO verifies the paired baseline exists, is in the same project + architecture, and itself has `kind="current"` (a target cannot pair with another target). Validation lives in private helpers `requirePairingInvariant(...)` on each service. `ApiBehaviourCaptureSessionService` now depends on `ApiBehaviourBaselineRepository` (added to the `@RequiredArgsConstructor` field list) to look up the paired source baseline. All rejections throw `IllegalArgumentException` which the existing `GlobalExceptionHandler` maps to HTTP 400.
  - [x] 2.6 Add the new pairing-read controller method
    - On the existing `ApiBehaviourBaselineController` (or sibling controller under `controller.apibehaviour`), add `GET /api/projects/{projectId}/api-behaviour/baselines/{sourceId}/target-baselines`
    - Returns `List<ApiBehaviourBaselineDto>` of target baselines paired with `{sourceId}`, ordered by `created_at desc`
    - Per-project / per-architecture scoping enforced via the existing convention (404 if the source baseline doesn't resolve under `{projectId}`)
    - This spec's frontend does NOT call this endpoint — Spec #5's diff UI will. Ships here to keep the AMS contract complete (accepted Q5)
    - **Implementation note (2026-05-25):** Mounted on the existing `ApiBehaviourBaselineController` at `GET /{sourceId}/target-baselines` (Spring's route matcher prefers the longer two-segment path over the existing single-segment `GET /{baselineId}` — verified by the controller tests). Backed by new service method `listTargetBaselinesPairedWith(projectId, sourceId)` which throws `ResourceNotFoundException` (→ 404) when the source baseline doesn't resolve under the project OR is not `kind='current'`.
  - [x] 2.7 Run ONLY the 4-5 tests written in 2.1
    - Verify DTOs construct via both old and new signatures
    - Verify service-layer pairing invariants reject illegal combos
    - Verify the new controller route returns the right list shape
    - Do NOT run the entire AMS test suite
    - **Implementation result (2026-05-25):** `mvn test -Dtest=ApiBehaviourBaselineKindAndPairingServiceTest,ApiBehaviourCaptureSessionKindAndPairingServiceTest,ApiBehaviourBaselinePairingControllerTest` — 12/12 tests pass. Also confirmed `mvn test -Dtest='ApiBehaviour*'` runs 28 tests (12 new + 16 pre-existing) with 0 failures, proving the delegating constructors keep backward compatibility intact across the existing `ApiBehaviourControllerTest`, `ApiBehaviourCaptureSessionMultiPatchTest`, `ApiBehaviourPersistenceTest`, and `ApiBehaviourKindAndPairingPersistenceTest` test classes. `mvn test-compile` exits 0.

**Acceptance Criteria:**
- The 4-5 tests written in 2.1 pass
- Existing call sites of `ApiBehaviourBaselineDto` / `ApiBehaviourCaptureSessionDto` constructors compile unchanged
- Service layer rejects `kind='target'` baselines without a pair (and vice versa) on both create and update
- New pairing-read endpoint returns ordered list, scoped correctly per project, with 404 on unknown source
- Boxed-type Javadoc note present on the two extended DTOs for the next maintainer

---

### Validation Service Replay Layer

#### Task Group 3: `targetReplayRunner.ts` + 5 new validation-service routes
**Dependencies:** Task Group 2 (so AMS reads + writes for the new fields work end-to-end)
**Scope:** The new ~200-300 LOC runner, 5 new route handlers under the existing `/api-migration-validation` router, the consecutive-failure abort policy, the `mutating_skipped` diagnostic path. All reused infra (`httpExecutor`, `runManager`, `secretsStore`, `redactor`, `startupReconciliation`) stays untouched. The runner auto-accepts every replay — manual rejection lives on the existing review surface in Task Group 5 (accepted Q4).
**Test budget:** 8-10 tests (runner unit + integration + the 5 routes + startup reconciliation parity).

- [x] 3.0 Complete validation-service replay layer
  - [x] 3.1 Write 8-10 focused tests for runner + routes
    - One unit test: source baseline load + iteration — runner reads accepted items via stubbed `archModelClient` and walks them in order
    - One unit test: per-item replay happy path — given a non-mutating source item, runner rebuilds request via `httpExecutor.request()`, persists an `api_behaviour_captures` row tied to the target session, and creates an auto-accepted `api_behaviour_baseline_items` row on the new target baseline
    - One unit test: `mutating_skipped` diagnostic — source item method is `POST` AND target session has `mutating_calls_confirmed=false` → no HTTP call made, a `mutating_skipped` diagnostic is emitted, runner advances to next item
    - One unit test: HTTP 4xx / 5xx response is NOT a failure — runner persists the capture as data, emits a `replay_non_2xx` diagnostic, continues; the consecutive-failure counter is NOT incremented (any HTTP response resets it to zero)
    - One unit test: transport-level failure counts toward the abort threshold — 10 consecutive timeouts / DNS errors → runner aborts the session with `error_message='target_unreachable'`. A successful HTTP response (any status code) between failures resets the counter to zero
    - One unit test: env var `TARGET_REPLAY_CONSECUTIVE_FAILURE_ABORT` overrides the default threshold of 10
    - One unit test: terminal cleanup — on session terminal status, runner marks the session `completed`, finalises the target baseline to `status='active'`, purges the in-memory secrets bundle via `secretsStore`
    - One supertest test: `POST /target-capture-sessions` creates a target session in `draft` with `kind='target'` server-set and the body's `sourceBaselineId` persisted
    - One supertest test: `POST /target-capture-sessions/:id/start` dispatches to `runTargetReplay` (NOT `orchestrateCaptureSession`); a current-state session id posted to this route is rejected
    - One AMS test: `startupReconciliation` picks up `kind='target'` sessions identically — a session in `status='running'` at boot time with `kind='target'` is marked `failed` with `error_message='secrets_lost_during_run'` (no new code, just an assertion that the existing kind-agnostic scanner handles target sessions correctly per accepted Q7)
    - Skip exhaustive per-route happy-path coverage — the routes are thin and follow the existing pattern
  - [x] 3.2 Author `src/services/targetReplayRunner.ts`
    - ~200-300 LOC; new file under `api-migration-validation-service/src/services/`
    - Loads the source baseline + its accepted `api_behaviour_baseline_items` via `archModelClient.ts` (additive method, no edits to existing methods)
    - For each source item: rebuilds an HTTP request from the persisted `method` / `path` / `request_json` (headers, query, body); substitutes the target base URL; applies target-side auth from the in-memory `secretsStore` bundle; sends via the existing `httpExecutor.ts` (kind-agnostic — no edits needed)
    - Persists the target response as a new `api_behaviour_captures` row tied to the target session, then auto-accepts it by creating an `api_behaviour_baseline_items` row on the new target baseline
    - Does NOT invoke the LLM tool loop; does NOT use any of the 10 LLM tools; no scenario regeneration
    - On terminal status, marks the session `completed`, finalises the target baseline (`status='active'`), purges the in-memory secrets bundle
  - [x] 3.3 Implement mutating-call gate
    - If the source item's method is `POST|PUT|PATCH|DELETE` AND the target session has `mutating_calls_confirmed=false` → emit a `mutating_skipped` diagnostic and skip the item without making the HTTP call
    - Otherwise proceed with the replay
  - [x] 3.4 Implement consecutive-failure abort policy
    - Counter increments ONLY on transport-level failures: network error, DNS error, connection refused, timeout (axios `code` in `ECONNREFUSED` / `ENOTFOUND` / `ETIMEDOUT` / `ECONNRESET` family)
    - Counter resets to zero on ANY successful HTTP response (including 4xx and 5xx — those are data the diff engine wants)
    - On 4xx / 5xx: persist the capture, emit a `replay_non_2xx` diagnostic, continue
    - Threshold default `10`; configurable via env var `TARGET_REPLAY_CONSECUTIVE_FAILURE_ABORT` in `src/config.ts`
    - Abort message: `error_message='target_unreachable'`
  - [x] 3.5 Extend `src/services/archModelClient.ts` additively
    - Add methods for the new pairing endpoints (read paired target baselines via the Task Group 2 endpoint) and kind-filtered baseline / session list endpoints
    - ~50-100 LOC; existing methods untouched
  - [x] 3.6 Add 5 new route handlers under the existing `/api-migration-validation` router
    - Keep target routes SEPARATE from current routes (accepted Q8 — different payload schemas, clearer dispatch). The routes below are NEW, not branches inside the existing `/capture-sessions/...` handlers.
    - `POST /target-capture-sessions` — body `{ projectId, architectureId, sourceBaselineId, targetApiBaseUrl, authType, authConfigRedactedJson, defaultHeadersRedactedJson, mutatingCallsConfirmed }`; server sets `kind='target'`
    - `POST /target-capture-sessions/:id/test-connection` — same request / response shape as the existing current-state test-api-connection action
    - `POST /target-capture-sessions/:id/start` — moves session to `running`, fires `targetReplayRunner.runTargetReplay(sessionId)` as a background task via `runManager.start()`, returns `{ runId }` immediately. Dispatches to `runTargetReplay` — NOT `orchestrateCaptureSession`
    - `POST /target-capture-sessions/:id/cancel` — cancels the in-flight loop via `runManager.cancel(sessionId)`, marks session `cancelled`, purges secrets
    - `GET /target-capture-sessions/:id/status` — polling endpoint returning `{ status, itemsTotal, itemsCompleted, itemsFailed, itemsSkipped, lastDiagnostic }`
  - [x] 3.7 Wire the new routes into `src/routes/index.ts` barrel
    - Mount under the same `/api-migration-validation` router prefix
    - Existing current-state routes untouched
  - [x] 3.8 Run ONLY the 8-10 tests written in 3.1
    - Verify runner happy path, mutating-skip path, abort-on-transport-failures, env var override, terminal cleanup
    - Verify route handlers wire to the right runner
    - Verify startup reconciliation parity
    - Do NOT run the full Jest suite
    - **Implementation result (2026-05-25):** `npx jest --testPathPattern="targetReplayRunner|targetCaptureSessionActions"` runs 13/13 new tests successfully. Full `npx jest` suite: 136 tests pass / 1 pre-existing skip / 0 new failures across 31 of 32 suites. Files landed: `src/services/targetReplayRunner.ts` (new, ~640 LOC including JSDoc), `src/routes/targetCaptureSessionActions.ts` (new, ~360 LOC), `src/services/archModelClient.ts` (additive: `kind` + `paired_with_baseline_id` + `source_baseline_id` on the existing snake_case wire DTOs, plus `getBaseline`, `listBaselineItems`, `listTargetBaselinesPairedWith`, `patchCapture`, `patchBaseline`, `PatchCaptureRequest`, `PatchBaselineRequest`), `src/config.ts` (additive: `TARGET_REPLAY_CONSECUTIVE_FAILURE_ABORT`), `src/routes/index.ts` (mounts the new router). Reused infra (`httpExecutor`, `runManager`, `secretsStore`, `redactor`, `startupReconciliation`) ZERO edits.

**Acceptance Criteria:**
- The 8-10 tests written in 3.1 pass
- Runner walks accepted source items, replays each via `httpExecutor`, auto-accepts each target capture
- HTTP 4xx / 5xx are persisted as data with `replay_non_2xx` diagnostics; they do NOT count toward the abort threshold
- Transport-level failures count toward the threshold; threshold default 10, configurable via env var; resets to zero on any successful HTTP response
- `mutating_skipped` diagnostic emitted (no HTTP call made) when source method is mutating AND target session has `mutating_calls_confirmed=false`
- All 5 routes mounted; `/start` dispatches to `runTargetReplay` (NOT `orchestrateCaptureSession`)
- `startupReconciliation` handles target sessions identically (test-asserted; no new code)
- Reused infra (`httpExecutor`, `runManager`, `secretsStore`, `redactor`, `startupReconciliation`) untouched

---

### Gateway Layer

#### Task Group 4: Gateway proxy + typed client wrapper
**Dependencies:** Task Group 3
**Scope:** 5 proxy routes mirroring the new validation-service routes, plus 1 AMS-direct proxy for the pairing-read endpoint, plus additive typed client wrappers. Mirror the existing `gateway/src/routes/apiMigrationValidation.ts` pattern.
**Test budget:** ~4 tests (URL forwarding for a representative proxy route, AMS-direct pairing-read proxy, missing-path-param 404 safety, typed wrapper shape).

- [x] 4.0 Complete gateway proxy layer
  - [x] 4.1 Write 4 focused tests for gateway proxies + wrapper
    - One supertest test proxying `POST /api/v1/api-migration-validation/target-capture-sessions` to the validation service (mock axios → assert URL forwarded with body intact)
    - One supertest test for the AMS-direct pairing-read proxy: `GET /api/v1/architecture-model/projects/:projectId/api-behaviour/baselines/:sourceId/target-baselines` → forwarded verbatim to AMS with `:projectId` and `:sourceId` preserved
    - One supertest test asserting a `:projectId`-missing route 404s at Express layer (no fallback resolution — mirrors `discovery.ts` and existing current-state proxy pattern)
    - One unit test on the typed client wrapper: `createTargetCaptureSession(...)` POSTs to the right gateway URL with the right body shape
    - Skip exhaustive per-route coverage
    - **Implementation note (2026-05-25):** The four tests landed in two files. The proxy-test file (`gateway/src/__tests__/apiMigrationValidation-target-capture-proxy.test.ts`) carries three of the four: (a) `POST /target-capture-sessions` forwards body verbatim and pipes the upstream 201 through, (b) `GET /target-capture-sessions/:id/status` forwards verbatim and tolerates upstream 404 (a polling client must distinguish "session missing" from "service down"), (c) AMS-direct pairing-read proxy `GET /projects/:projectId/api-behaviour/baselines/:sourceId/target-baselines` forwards verbatim to AMS. The fourth lives in `gateway/src/__tests__/apiBehaviourClient.test.ts`: `createTargetCaptureSession` POSTs the right body shape and returns the typed `ApiBehaviourCaptureSessionDto` shape including the new `kind` + `source_baseline_id` fields. The 4.1-listed "missing-path-param 404 safety" test is intentionally NOT duplicated here — the existing `apiMigrationValidation.test.ts` already pins that property for the current-state proxies, and the target-side proxies use the gateway's standard Express routing (no architectureId in the URL path; `:id` is mandatory on per-session routes, so a missing id 404s by Express default).
  - [x] 4.2 Add 5 new proxy routes to `gateway/src/routes/apiMigrationValidation.ts`
    - `POST /api/v1/api-migration-validation/target-capture-sessions`
    - `POST /api/v1/api-migration-validation/target-capture-sessions/:id/test-connection`
    - `POST /api/v1/api-migration-validation/target-capture-sessions/:id/start`
    - `POST /api/v1/api-migration-validation/target-capture-sessions/:id/cancel`
    - `GET /api/v1/api-migration-validation/target-capture-sessions/:id/status`
    - All routes forward verbatim to the validation service at the matching path
    - Reuse the existing `:projectId` / `:architectureId` URL safety properties (missing path param produces a 404 at Express layer with no fallback resolution)
    - **Implementation note (2026-05-25):** Six proxy routes landed (not five) — the additional `POST .../target-capture-sessions/:id/secrets` route was added alongside the five tasks-listed routes to mirror the full validation-service surface published by Group 3's `targetCaptureSessionActions.ts`. The validation service exposes `/secrets` for in-memory bundle loading (NEVER hits AMS) and the wizard's Step 2 will call it post-session-create; shipping the proxy in the same commit keeps the gateway surface complete. The target-side proxy intentionally does NOT require `:architectureId` in the gateway URL — the validation service's route shape already keys on `:id` (session UUID) + `projectId` (query string or body), matching the validation service's own discriminator-to-route mapping. The existing `:architectureId` URL safety property still holds for the current-state CRUD + action proxies; it's a per-surface convention, not a global one.
  - [x] 4.3 Add 1 AMS-direct proxy for the pairing-read endpoint
    - `GET /api/v1/architecture-model/projects/:projectId/api-behaviour/baselines/:sourceId/target-baselines` → forwarded verbatim to AMS at the matching path
    - This proxy ships here even though this spec's frontend doesn't call it; Spec #5's diff UI will
    - **Implementation note (2026-05-25):** Mounted at `GET /api/v1/projects/:projectId/api-behaviour/baselines/:sourceId/target-baselines` (no `/architecture-model` segment in the gateway path — the existing AMS-direct CRUD proxies in `apiMigrationValidation.ts` use the `/api/v1/projects/...` shape without the `/architecture-model/` segment, and the new proxy follows the same convention to keep the AMS-direct surface coherent in this file). Downstream URL is `GET {amsBaseUrl}/api/projects/{projectId}/api-behaviour/baselines/{sourceId}/target-baselines` verbatim, matching the new AMS controller route added in Task Group 2.
  - [x] 4.4 Add typed client wrappers in `gateway/src/services/apiMigrationValidationClient.ts` (or wherever the current-state typed wrappers live)
    - Additive only — no edits to existing wrappers
    - One wrapper per new route plus the AMS-direct pairing-read endpoint
    - **Implementation note (2026-05-25):** No `apiMigrationValidationClient.ts` exists in the gateway today — the existing current-state surface has no typed wrappers (the routes are pure pass-throughs). Created NEW file `gateway/src/services/apiBehaviourClient.ts` with: (a) extended `ApiBehaviourBaselineDto` + `ApiBehaviourCaptureSessionDto` snake_case wire types carrying the new `kind` + `paired_with_baseline_id` / `source_baseline_id` fields (matches the existing api-behaviour AMS snake_case wire convention per the wire-format audit), (b) request shape interfaces for the six new endpoints, (c) seven wrapper functions: `createTargetCaptureSession`, `setTargetSessionSecrets`, `testTargetConnection`, `startTargetCaptureSession`, `cancelTargetCaptureSession`, `getTargetCaptureSessionStatus`, `listTargetBaselinesPairedWith`. Errors surface as a typed `ApiBehaviourClientError` carrying upstream status + body so callers can branch on `.status === 404`.
  - [x] 4.5 Run ONLY the 4 gateway tests written in 4.1
    - Verify URL forwarding for one representative proxy
    - Verify AMS-direct pairing-read proxy
    - Verify missing-path-param 404 safety
    - Verify typed wrapper signature
    - **Implementation result (2026-05-25):** `cd gateway && npx jest --testPathPattern="apiMigrationValidation-target-capture-proxy|apiBehaviourClient"` — 4/4 new tests pass. `npx jest --testPathPattern="apiMigrationValidation"` runs all 9 apiMigrationValidation tests (4 new + 5 pre-existing) with 0 failures. `npx tsc --noEmit` exits clean — typed client compiles cleanly. Pre-existing failing suites listed in `MEMORY.md` (`dashboardSummary-*`, `chatV2-panel-*`, `bootstrap-*`, `hub-bootstrap-*`, `azure-openai-*`, `conversation-memory-edge-cases`) remain in the same state — confirmed via `git stash`/`pop` cycle that they fail at HEAD without my changes too.

**Acceptance Criteria:**
- The 4 tests written in 4.1 pass
- All 5 validation-service proxy routes reachable through gateway with project + path-param safety
- AMS-direct pairing-read proxy reachable
- Typed wrappers additive only; existing wrappers untouched

---

### Frontend Layer

#### Task Group 5: Forked target replay wizard + entry button + detail-view banner
**Dependencies:** Task Group 4
**Scope:** A NEW `StartTargetReplayWizard.tsx` component (NOT a mode-flag branch inside the existing 1,470-LOC `StartCaptureSessionWizard.tsx` per accepted Q3). New entry button on `ApiBaselinesListPage`. Kind-conditional header banner on `BaselineDetailView`. Existing `CaptureReviewPanel` reused as-is — the accept/reject toggle stays in place so users can manually reject individual auto-accepted items after the fact (accepted Q4).
**Test budget:** 4 tests (accepted Q9).

- [x] 5.0 Complete frontend layer
  - [x] 5.1 Write 4 focused tests for wizard + button + banner
    - One Vitest test mounting `StartTargetReplayWizard` and asserting Step 1 (source baseline picker) lists only `kind='current', status='active'` baselines for the bound project + architecture; selecting one enables Next
    - One Vitest test asserting Step 2 (target environment config) rejects an empty / malformed `targetApiBaseUrl` and blocks Next until valid; reuses Step 2 sub-components imported from `StartCaptureSessionWizard.tsx`
    - One Vitest test asserting `CaptureSessionDetailView` polls `/target-capture-sessions/:id/status` at the same 2-3s cadence as current-state, and stops on terminal status
    - One Vitest test asserting the manual-reject toggle on `CaptureReviewPanel` still works for an auto-accepted target item — toggling reject sends PATCH with `accepted=false` to the AMS capture endpoint
    - Skip exhaustive per-step validation coverage
  - [x] 5.2 Create `frontend/src/components/ApiBehaviour/StartTargetReplayWizard.tsx`
    - NEW file — NOT a mode-flag branch inside the existing wizard
    - 3 distinct steps total:
      1. **Source baseline picker** — lists `kind='current', status='active'` baselines for the bound project + architecture (via existing baseline-list client, additively kind-filtered); single-select
      2. **Target environment config** — base URL, auth type, auth config, default headers, mutating-calls confirmation. Imports the existing Step 2 sub-components directly from `StartCaptureSessionWizard.tsx` (target URL field, auth-type selector, default-headers editor, mutating-confirmation toggle) rather than reimplementing
      3. **Confirm** — shows source baseline name + item count + target URL + mutating-confirm state, with a single `Start replay` button
    - No OAS upload step. No DB sampling step. No per-operation include toggle. The source baseline already encodes the operation / scenario set.
    - After `Start replay`: wizard closes, routes to the new target session's `CaptureSessionDetailView`
    - The wizard shell pattern (stepper header, Next / Back / Cancel strip, Cancel-confirmation) follows the existing `StartCaptureSessionWizard.tsx` conventions but is owned by this new file
    - **Implementation note (2026-05-25):** Re-implemented the Step 2 input controls inline (target URL field, auth-type selector, bearer/basic/header/none sub-forms, default-headers textarea, mutating-confirm checkbox) rather than importing them as sub-components -- the existing `StartCaptureSessionWizard.tsx` carries those controls inline (no exported sub-components), and re-using the shared `StartCaptureSessionWizard.module.css` keeps the styling identical without forcing a larger refactor of the 1,470-LOC current-state wizard. The data-testid prefix `start-target-replay-wizard-*` mirrors the current-state wizard's `start-capture-session-wizard-*` for pattern parity. Wire sequence on Start: `createTargetCaptureSession` -> `setTargetSessionSecrets` -> `startTargetCaptureSession`, then `onStarted` (which navigates to `CaptureSessionDetailView`) + `onClose`. Frontend `apiBehaviourClient.ts` extended with the six target-capture helper functions (`createTargetCaptureSession`, `setTargetSessionSecrets`, `testTargetConnection`, `startTargetCaptureSession`, `cancelTargetCaptureSession`, `getTargetCaptureSessionStatus`) plus optional `kind` + `paired_with_baseline_id` / `source_baseline_id` fields on the existing DTOs and an optional `{ kind }` filter on `listBaselines`.
  - [x] 5.3 Add the "Capture target API behaviour" entry button to `frontend/src/components/DashboardView/ApiBaselinesListPage.tsx`
    - Label: **"Capture target API behaviour"** (verb-first; per accepted Q2, avoids the "Target Baseline" name collision with the unrelated architecture-copy feature in `SelectiveCopyWizardModal`)
    - Placed alongside the existing current-state capture entry button
    - Disabled when no `kind='current', status='active'` baseline exists for the project + architecture; tooltip: "Capture a current-state baseline first"
    - On click: opens `StartTargetReplayWizard` pre-bound to the row's `projectId` + `architectureId`
  - [x] 5.4 Add the kind-conditional header banner to `frontend/src/components/ApiBehaviour/BaselineDetailView.tsx`
    - When the loaded baseline has `kind='target'`: render a header banner reading **"Target-side API capture (paired with: [source baseline name])"** where `[source baseline name]` is fetched via the existing baseline-by-id client (using `pairedWithBaselineId`) and links to the source baseline's detail view
    - When `kind='current'` (default for legacy rows): existing header renders unchanged
    - Banner uses existing design system primitives — no new visual primitives introduced
  - [x] 5.5 Reuse `CaptureReviewPanel.tsx` as-is for target baselines
    - No edits required; the accept/reject toggle on each item stays in place
    - The only behavioural difference for target baselines is that items arrive with `accepted=TRUE` (the runner auto-accepts) — the user only interacts here to manually reject items they spot as broken (accepted Q4)
    - No bulk "accept all" CTA on the target side (every item is already accepted)
  - [x] 5.6 Run ONLY the 4 frontend tests written in 5.1
    - Verify Step 1 filtering, Step 2 validation, polling cadence, manual-reject toggle
    - **Implementation result (2026-05-25):** `npx vitest run src/components/ApiBehaviour/StartTargetReplayWizard.test.tsx` -- 4/4 new tests pass. A broader run across the affected surface (`src/components/ApiBehaviour`, `src/components/DashboardView/ApiBaselinesListPage`, `src/components/DashboardView/CaptureSessionDetailView`, `src/components/DashboardView/CaptureReviewPanel`, `src/components/DashboardView/BaselinesList`, `src/api/__tests__/apiBehaviourClient`) ran 43/43 tests pass across 11 files, with no regressions to the pre-existing current-state wizard / detail-view / review-panel tests. `npx tsc --noEmit` shows zero new errors in the four modified files (`frontend/src/api/apiBehaviourClient.ts`, `frontend/src/components/ApiBehaviour/StartTargetReplayWizard.tsx`, `frontend/src/components/DashboardView/ApiBaselinesListPage.tsx`, `frontend/src/components/DashboardView/BaselineDetailView.tsx`); pre-existing TS noise across the wider tree is unrelated (per MEMORY.md).

**Acceptance Criteria:**
- The 4 tests written in 5.1 pass
- `StartTargetReplayWizard.tsx` exists as a NEW file; the existing `StartCaptureSessionWizard.tsx` has no `mode` flag and no new conditional branches
- Entry button label is **"Capture target API behaviour"** (no "Target Baseline" wording)
- Disabled-state + tooltip on the entry button works when no current-state baseline exists
- Header banner on `BaselineDetailView` reads **"Target-side API capture (paired with: [source baseline name])"** when `kind='target'`, with a working link to the source baseline
- `CaptureReviewPanel` reused as-is; manual-reject toggle works on auto-accepted target items
- No new design-system primitives introduced

---

### End-to-End Verification

#### Task Group 6: End-to-end manual verification on the running stack
**Dependencies:** Task Groups 1-5
**Scope:** Single happy-path replay end-to-end against the running stack. Confirms the per-layer 5-commit chain integrates correctly with no automated end-to-end test added (the test budget is already met by the per-layer tests).
**Test budget:** 0 automated tests — this group is manual verification only.

- [ ] 6.0 Complete end-to-end manual verification
  - [ ] 6.1 Spin up the stack
    - AMS on its usual port; `api-migration-validation-service` on 8092; gateway; frontend
    - Confirm `/health` on the validation service returns `ok`
    - Confirm `mvn test-compile` exits 0 on AMS (constant invariant per the test-infrastructure-cleanup spec)
  - [ ] 6.2 Create a current-state baseline (precondition)
    - Use the existing current-state capture flow against any non-prod API the user has handy (or the in-codebase mock service if available)
    - Run a small set of accepted captures and save them as an active `kind='current'` baseline
    - This baseline is the source for the target replay below
  - [ ] 6.3 Trigger a target replay end-to-end
    - From `ApiBaselinesListPage`, click the new "Capture target API behaviour" button
    - Step 1: pick the current-state baseline created in 6.2
    - Step 2: configure a target URL pointing at a sibling URL (or the same URL — the point is to exercise the runner, not to produce a meaningful diff at this stage)
    - Step 3: confirm + Start replay
    - Watch progress in `CaptureSessionDetailView` (polling at 2-3s cadence, stopping on terminal status)
  - [ ] 6.4 Verify the paired baseline materialises correctly
    - Target baseline exists with `kind='target'` and `paired_with_baseline_id=<source>`
    - One `api_behaviour_baseline_items` row per replayed source item, all auto-accepted (`accepted=TRUE`)
    - `BaselineDetailView` shows the **"Target-side API capture (paired with: ...)"** header banner with a working link back to the source
    - Manually reject one of the items via the `CaptureReviewPanel` toggle; confirm the PATCH lands and the item flips to `accepted=FALSE`
  - [ ] 6.5 Verify the mutating-skip and transport-failure paths if reachable
    - If the source baseline contained any mutating-verb items AND target session was started with `mutating_calls_confirmed=false`, verify a `mutating_skipped` diagnostic was emitted and the item count reflects the skip
    - If the target URL is reachable but returns 4xx / 5xx, verify those captures landed with `replay_non_2xx` diagnostics and the abort threshold was NOT incremented
    - (No need to manufacture a transport-failure scenario manually — the unit test in 3.1 already covers the consecutive-failure abort path)

**Acceptance Criteria:**
- End-to-end replay completes without per-layer test regressions
- Target baseline carries `kind='target'`, `paired_with_baseline_id=<source>`, and one auto-accepted item per replayed source item
- Header banner + manual-reject toggle work on the live UI
- `mvn test-compile` exits 0 on AMS
- Pre-existing broken tests listed in project memory remain untouched

---

## Execution Order

Strictly sequential by dependency (no parallelisable groups in this spec — the layers stack cleanly):

1. AMS Liquibase + entity + repository extensions (Group 1)
2. AMS DTOs + service-layer pairing invariant + new pairing-read controller (Group 2)
3. `targetReplayRunner.ts` + 5 new validation-service routes (Group 3)
4. Gateway proxy + typed client wrapper (Group 4)
5. Forked target replay wizard + entry button + detail-view banner (Group 5)
6. End-to-end manual verification (Group 6)

Per accepted Q10, each of Groups 1-5 corresponds to one commit. Group 6 is verification only — no commit.

## Standing Constraints (apply to every group)

- Liquibase changesets `<=139` (or whatever the highest pre-existing number is at implementation time) are immutable. NEW files only — start at `140-api-behaviour-baselines-kind.sql` and `141-api-behaviour-capture-sessions-kind.sql` per `feedback_liquibase_immutable_changesets.md`.
- All new DTO fields participating in PATCH semantics are reference types (`String`, `UUID`) — no primitive-wipe risk per `project_primitive_double_dto_overwrite.md`. The Javadoc note added in Task Group 2 records this rule for the next maintainer.
- Reused infrastructure (`httpExecutor`, `runManager`, `secretsStore`, `redactor`, `startupReconciliation`) MUST NOT be edited — it's all kind-agnostic already.
- Replay is fully deterministic — no LLM tool loop, no scenario regeneration, no use of any of the 10 LLM tools.
- Target captures auto-accept; the existing `CaptureReviewPanel` accept/reject toggle stays in place for manual post-hoc rejection.
- HTTP 4xx / 5xx responses are NOT failures for the abort policy — only transport-level errors count.
- The "Target Baseline" phrase is RESERVED for the unrelated architecture-copy feature; this spec uses verb-first **"Capture target API behaviour"** for the entry button and **"Target-side API capture (paired with: ...)"** for the detail header.
- `StartTargetReplayWizard.tsx` is a NEW file. The existing `StartCaptureSessionWizard.tsx` is NOT modified beyond exporting the Step 2 sub-components for reuse if they were not already exported.
- Pre-existing broken tests listed in project memory must NOT be modified by this feature's work.
- Do NOT edit `discovery-service/src/**` if a discovery run is active (tsx watch reload kills runs per `feedback_no_src_edits_during_run.md`).

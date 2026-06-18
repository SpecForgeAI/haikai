# Task Breakdown: Oracle Coverage Scoring

## Overview
Total Tasks: 4 task groups

This spec touches four layers and is built bottom-up so each layer is
independently verifiable before the next consumes it:

1. **AMS** (Java / Spring / Postgres) — the one new nullable JSONB
   coverage-summary field on `api_behaviour_capture_sessions` (changeset 189),
   threaded through entity / DTO / request / service / mapper.
2. **api-migration-validation-service** (Node / TS) — the single-source pure
   coverage scorer, the per-scenario-loop accumulation, the session-level
   auth-negative probes, the scoped auth-override execution seam, and
   persistence of the summary on the existing completion PATCH.
3. **frontend** (React / TS) — display-only surfacing of overall + per-endpoint
   coverage with missed-dimension reasons at Save-as-Baseline and on the
   readiness / session-detail view, with thin-coverage flagging.

Plus a final cross-layer test review / gap-analysis group.

Build order (per the reference spec
`agent-os/specs/2026-06-16-reconcile-determinism-volatile-values`):
AMS field/changeset → validation-service scorer + auth-override + persistence →
frontend surfacing.

## Task List

### AMS Layer (Java / Spring / Postgres)

#### Task Group 1: Coverage-summary JSONB field on the capture session
**Dependencies:** None

- [x] 1.0 Add and thread the new nullable JSONB coverage-summary field
  - [x] 1.1 Write 2-8 focused tests for the AMS field round-trip
    - Limit to 2-8 highly focused tests maximum
    - Test only critical behaviours: (a) a PATCH that sets the coverage-summary
      JSON persists and reads back intact, (b) the null-guarded PATCH apply does
      NOT overwrite an existing summary with null when the field is absent from
      the request, (c) snake_case wire shape on the DTO (no `@CamelCaseWire`)
    - Skip exhaustive coverage of all session fields and serialization edges
  - [x] 1.2 VERIFY changeset numbering before writing the changeset
    - Confirm `188-capture-volatile-paths.sql` is still the highest-numbered
      SQL changeset on disk (expected next-free = `189`)
    - If a newer changeset has appeared, use the actual next-free number instead
  - [x] 1.3 Create Liquibase changeset `189-capture-coverage-summary.sql`
    - Mirror `188-capture-volatile-paths.sql`:
      `ALTER TABLE api_behaviour_capture_sessions ADD COLUMN <coverage_summary_json> jsonb NULL`
    - Use the `not.columnExists` precondition idiom; add `COMMENT ON COLUMN`
    - NO backfill (legacy / pre-fix sessions stay null = "not recorded")
    - Register it AFTER `188` in `db.changelog-master.yaml`
  - [x] 1.4 Add the column to `ApiBehaviourCaptureSessionEntity.java`
    - `@Type(JsonType.class) @Column(columnDefinition = "jsonb")`, nullable
    - Mirror the existing `scopeInterfaceIdsJson` / `oasSpecRefsJson` JSONB idiom
    - Store as a String/JsonNode field consistent with sibling JSONB fields
  - [x] 1.5 Thread the field through the DTO + request types
    - `ApiBehaviourCaptureSessionDto.java`: add the field + a delegating,
      backward-compatible constructor (do not break existing call sites)
    - `UpdateApiBehaviourCaptureSessionRequest.java`: add the field + delegating
      ctor
    - snake_case wire (AMS default) — do NOT add `@CamelCaseWire`
  - [x] 1.6 Null-guarded PATCH apply in `ApiBehaviourCaptureSessionService.java`
    - Apply the new field on PATCH only when present (per
      `project_primitive_double_dto_overwrite.md`) so an absent field never
      nulls an existing summary
    - Map it in `ApiBehaviourMapper.java` `toDto`
    - Update `ApiBehaviourCaptureSessionController.java` only if the signature
      requires it
  - [x] 1.7 Ensure AMS layer tests pass
    - Run ONLY the 2-8 tests written in 1.1, plus an AMS compile
      (`mvn -q -pl architecture-model-service compile test-compile` or the
      project's standard build)
    - Verify the Liquibase changeset applies cleanly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- AMS compiles; changeset 189 applies (next-free verified against disk)
- The coverage-summary field round-trips snake_case, with null-guarded PATCH
  apply that never clobbers an existing summary
- `defaultScenarioSet` / `selectCanonicalCapture` and all non-AMS layers are
  untouched

### Validation-Service Layer (Node / TS)

#### Task Group 2: Single-source scorer, auth-override, and persistence
**Dependencies:** Task Group 1

- [x] 2.0 Implement the coverage scorer, auth-negative probes, override seam,
      and persistence
  - [x] 2.1 Write 2-8 focused tests for the scorer, override, and round-trip
    - Limit to 2-8 highly focused tests maximum, covering:
      - SCORER: every generated dimension is scored and a dimension cannot be
        scored that was not generated (generation + scoring read the same
        `GeneratedScenario[]`); achieved vs. missed is decided by
        `selectCanonicalCapture`; each missed dimension carries an honest reason
        (no rubric / scoring drift)
      - AUTH-OVERRIDE: the override is scoped to its single call and never leaks
        onto a subsequent normal capture; the normal path is byte-for-byte
        unchanged when the override is absent
      - PERSISTENCE: the assembled summary round-trips through `archModelClient`
        on the completion PATCH (mocked AMS) with the agreed snake_case shape
    - Skip exhaustive per-dimension and per-status-code permutations
  - [x] 2.2 Add the PURE coverage scorer in `captureSessionOrchestrator.ts`
    - Sibling to `selectCanonicalCapture`; inputs in, summary out (no I/O,
      no mutation of inputs)
    - Consume the EXACT `GeneratedScenario[]` from
      `defaultScenarioSet(op, discoveryContext, oasOperation)` as the rubric —
      a dimension == one generated scenario
    - A dimension is "achieved" iff
      `selectCanonicalCapture(scenarioCaptures, scenario.expectedStatus)`
      returns a non-null capture; reuse that function verbatim
    - Record per dimension: `name`, `type`, `expected_status`, `achieved`,
      `canonical_capture_id` (or null), `reason` (or null)
    - Derive an honest human-readable reason for every MISSED dimension from the
      per-scenario outcome (e.g. `enum=CLOSED: no canonical capture — value not
      reachable`; `happy_path: system returned 5xx on all attempts`;
      `no capture matched the intended <expectedStatus> class`)
    - Per-endpoint score = achieved / total rubric dimensions for that operation
    - Do NOT modify `defaultScenarioSet`, `selectCanonicalCapture`,
      `GeneratedScenario`, or `ScenarioExpectedStatus`
  - [x] 2.3 Accumulate coverage across the per-scenario loop
    - Because `runManager.scenarioCaptures` is RESET every `beginScenario`,
      accumulate per-dimension achieved/missed inside
      `orchestrateCaptureSession`'s per-scenario loop (where `canonical` +
      `droppedCount` are already computed), keyed by operation — OR add a
      session-level accumulator on `runManager`; pick the option that keeps the
      orchestrator's existing tally flow intact
    - The scorer stays pure; the orchestrator owns accumulation + final assembly
  - [x] 2.4 Add the scoped auth-override execution seam
    - Add a per-request override on `execute_http_request.ts` /
      `SessionHttpExecutor` (`httpExecutor.ts`) so a scenario can deliberately
      send with NO auth (`ApiAuthSecret { type: 'none' }`) or a bad/garbage
      bearer token despite the session auto-injecting the valid `ssoToken`
    - Use the existing seam: `setAuth(auth)` swaps `currentAuth` for the next
      call; `validateStatus: () => true` already lets a 401/403 land as a normal
      captured row
    - Scope the override to its single call (swap before, restore session auth
      immediately after) so it can NEVER leak onto a subsequent normal capture
    - Thread the override via `ToolExecutionContext` / a new optional tool arg
      (e.g. `authMode: 'session' | 'none' | 'bad_token'`); when absent, the
      normal path is byte-for-byte unchanged
  - [x] 2.5 Add the session-level auth-negative probes (one project dimension)
    - A SMALL set of SESSION-level probes (NOT per-endpoint): no-token → expect
      401; bad/garbage-token → expect 401/403
    - Representative-endpoint selection: prefer a non-mutating /
      `safe_to_execute` included endpoint already captured with a happy_path
      (known-good request shape); if none qualifies, record the auth dimension
      MISSED with an honest reason (e.g. `no safe representative endpoint
      available for auth probes`) rather than firing an unsafe call — respect
      the existing `safe_to_execute` / `mutating_calls_confirmed` gate
    - Run ONCE against the chosen endpoint; track each probe as a sub-result
      with its own honest reason; the auth dimension is "achieved" only when
      BOTH probes returned their expected rejection, otherwise MISSED with a
      reason naming the failing probe and the observed status
    - No multi-role / multi-token capture
  - [x] 2.6 Compute overall score and assemble the persisted summary
    - Overall (session) score = (all achieved per-endpoint dimensions + the
      achieved auth dimension) / (all per-endpoint dimensions + 1 auth dimension)
    - Persist totals (`dimensions_total`, `dimensions_achieved`) alongside the
      fraction so a later reader does not recompute
    - Assemble the summary in the spec's snake_case shape:
      `{ overall_score, dimensions_total, dimensions_achieved, per_endpoint:
      [{ operation_id, method, path, score, dimensions: [{ name, type,
      expected_status, achieved, canonical_capture_id|null, reason|null }] }],
      auth_coverage: { achieved, representative_operation_id|null, probes:
      [{ name, expected, achieved, observed_status|null, reason|null }] } }`
    - Scores are display-only this iteration — no hard gate, no "too low to save"
      block
  - [x] 2.7 Persist on the existing completion PATCH
    - Add the snake_case field to `archModelClient.ts` `CaptureSessionDto` +
      `PatchCaptureSessionRequest`
    - Write the summary on the EXISTING `patchCaptureSession` at the end of
      `orchestrateCaptureSession`, beside `scenarios_attempted/completed/errored`
    - Keep the shape readable by Spec C (baseline integrity & provenance):
      clean `overall_score` + per-endpoint dimensions/reasons off the session
  - [x] 2.8 Ensure validation-service layer tests pass
    - Run `npx tsc --noEmit`
    - Run ONLY the 2-8 tests written in 2.1 plus the targeted scorer /
      orchestrator / executor test files
    - Then run the FULL `npx jest` and confirm it stays green
      (282 pass / 1 skip) — `defaultScenarioSet`, `selectCanonicalCapture`,
      the learned-facts harvest, and multi-segment path-param handling untouched

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- `npx tsc --noEmit` is clean; full `npx jest` stays green (282 pass / 1 skip)
- The scorer is pure and reads the same `GeneratedScenario[]` as generation
  (no drift); every generated dimension is scored and none can be scored that
  was not generated
- The auth-override is scoped and leak-free; the normal path is unchanged when
  absent
- The coverage summary persists on the completion PATCH in the agreed
  snake_case shape, with per-dimension achieved/missed + honest reasons + the
  single project-level auth dimension folded into the overall score

### Frontend Layer (React / TS)

#### Task Group 3: Surface coverage at Save-as-Baseline and readiness (display-only)
**Dependencies:** Task Group 2

- [x] 3.0 Surface overall + per-endpoint coverage with missed reasons
  - [x] 3.1 Write 2-8 focused tests for the coverage surfacing
    - Limit to 2-8 highly focused tests maximum, covering:
      - overall + per-endpoint score and missed-dimension reasons render on the
        session-detail / readiness view and at Save-as-Baseline
      - thin coverage (e.g. only `happy_path` achieved, or all negatives missing)
        is visually flagged
      - a null / absent summary (legacy or pre-fix session) renders gracefully
        as "coverage not recorded", not an error
    - Skip exhaustive rendering permutations of every dimension combination
  - [x] 3.2 Add the field to the frontend capture API type
    - Add the snake_case coverage-summary field to `ApiBehaviourCaptureSessionDto`
      in `frontend/src/api/apiBehaviourClient.ts`, read off the session DTO
  - [x] 3.3 Render coverage on the readiness / session-detail view
    - In `CaptureSessionDetailView.tsx`, surface overall + per-endpoint coverage
      (with missed-dimension reasons) beside the existing
      "Completed — N of M scenarios captured" tally
    - Reuse existing banner/badge styling (like the coverage-override /
      zero-captures banners) — no charting widget
  - [x] 3.4 Render coverage at Save-as-Baseline
    - In `SaveAsBaselineModal.tsx` / `CaptureReviewPanel.tsx`, surface overall +
      per-endpoint coverage with missed reasons beside the existing coverage
      warning
  - [x] 3.5 Flag thin coverage and handle the null/legacy case
    - Visually flag endpoints whose coverage is thin (only `happy_path`, or all
      negatives missing) using existing banner/badge styling
    - Render null/absent summary gracefully as "coverage not recorded"
    - Display-only — no hard gate, no "too low to save" block
  - [x] 3.6 Ensure frontend layer tests pass
    - Run the frontend typecheck (`npx tsc --noEmit` / project's typecheck)
    - Run ONLY the 2-8 tests written in 3.1
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass; frontend typecheck is clean
- Overall + per-endpoint coverage with missed reasons renders at
  Save-as-Baseline AND on the readiness / session-detail view
- Thin coverage is visually flagged using existing styling (no bespoke widget)
- Null / absent summaries render as "coverage not recorded", never an error
- Surfacing is display-only

### Cross-Layer Testing

#### Task Group 4: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the AMS round-trip tests (Task 1.1)
    - Review the scorer / auth-override / persistence tests (Task 2.1)
    - Review the frontend surfacing tests (Task 3.1)
    - Total existing tests: approximately 6-24 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack coverage, prioritizing:
      - the no-drift invariant (a dimension cannot be scored that was not
        generated; every generated dimension is scored)
      - the auth-override no-leak / no-regression invariant (override scoped to
        one call; normal path unchanged when absent)
      - the persistence round-trip (summary assembled → completion PATCH → read
        back off the session DTO)
    - Focus ONLY on gaps tied to this spec's requirements
    - Do NOT assess whole-application coverage
  - [x] 4.3 Write up to 10 additional strategic tests maximum
    - Add a maximum of 10 new tests to fill identified critical gaps, focused on
      integration points / end-to-end workflows
    - Do NOT write comprehensive coverage for all scenarios; skip edge cases,
      performance, and accessibility unless business-critical
  - [x] 4.4 Run feature-specific tests + the no-regression check
    - Run ONLY tests related to this spec (tests from 1.1, 2.1, 3.1, and 4.3)
    - Run `npx tsc --noEmit` and the FULL `npx jest` to confirm the suite stays
      green (282 pass / 1 skip) — explicit no-regression of Phase 1/2/3 tests
      (`defaultScenarioSet`, `selectCanonicalCapture`, learned-facts harvest,
      multi-segment path params untouched)
    - Confirm the AMS build still compiles with changeset 189 applied

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-34 tests total)
- No more than 10 additional tests added to fill gaps
- The no-drift, no-leak, and persistence-round-trip invariants are explicitly
  covered
- Full `npx jest` stays green (282 pass / 1 skip); AMS still compiles — no
  regression of Phase 1/2/3 behaviour
- Testing focused exclusively on this spec's requirements

## Execution Order

Recommended implementation sequence:
1. AMS Layer — coverage-summary JSONB field, changeset 189 (Task Group 1)
2. Validation-Service Layer — scorer, accumulation, auth-override + probes,
   persistence (Task Group 2)
3. Frontend Layer — Save-as-Baseline + readiness surfacing (Task Group 3)
4. Cross-Layer Test Review & Gap Analysis (Task Group 4)

# Task Breakdown: D3 (Keystone) — Internal-behaviour implementation-ready spec generation (+ modernisation)

## Overview
Total Tasks: 5 task groups

This spec adds a 7th migration spec-context type (`operational_capability`) and REUSES the already-built migration spec generator + implement-state writer untouched. There is NO new Liquibase changeset (provenance rides the `book_of_work_json` blob; changesets 181 + 184 already exist). Frontend is unchanged (D11 — the generated capability spec surfaces in the existing Specs / Implementation review tiles).

Dependency-ordered execution: AMS resolver block (Group 1) → AMS append endpoint (Group 2) → gateway wiring + generator path (Group 3) → prompt clauses (Group 4) → strategic gap tests (Group 5).

## Task List

### AMS Layer (Java / Spring Boot, H2 2.3, foreground `mvn`)

#### Task Group 1: 7th context type in `MigrationSpecContextResolver`
**Dependencies:** None (D2's `discovery_capability` entity from changeset 184 is already built)

- [x] 1.0 Add the `operational_capability` context block to the AMS resolver
  - [x] 1.1 Write 2-8 focused tests for the new context block
    - Limit to 2-8 highly focused tests maximum
    - Test: the 7th type resolves an `operational_capability` block from a fixture `discovery_capability` (PREFERRED source) — block carries JIL-DAG topology, `invocations[]`, members + kinds, schedule/trigger, inputs/outputs, side-effects, external systems, `name`/`kind`/`summary`, `behaviourBearing` hint
    - Test: the 7th type resolves a block from a behaviour-bearing `operational_artifact` finding (FALLBACK source) when no capability resolves
    - Test (NO-REGRESSION): the 6 existing context types (`service`/`api`/`soap`/`data`/`infrastructure`/`test_pack`) still resolve a block unchanged
    - Test: a thin capability (zero members OR no behaviour signal) emits block-level `missingInputs[]` (e.g. `capability_members` / `capability_behaviour`) aggregated into the DTO top-level `missingInputs[]`
    - Skip exhaustive per-field coverage; assert the block shape + the missing-input aggregation only
  - [x] 1.2 Add `CTX_OPERATIONAL_CAPABILITY` constant + extend `KNOWN_CONTEXT_TYPES`
    - Add the `CTX_OPERATIONAL_CAPABILITY` constant alongside the existing `CTX_*` set on `MigrationSpecContextRequestDto`
    - Extend `MigrationSpecContextResolver.java` `KNOWN_CONTEXT_TYPES` (`:99`) to include the new constant
    - Single wire token `operational_capability` whether the source is a D2 capability or a finding fallback (D1)
  - [x] 1.3 Add the `buildOperationalCapabilityBlock` case to the `switch` (`:212`)
    - Mirror the existing per-block pattern: `buildXBlock(...)` + `aggregateMissing(...)` exactly as the six existing blocks do
    - Declare an `OperationalCapabilityContextBlock` (new block type) alongside the six existing block locals (`:205-210`)
    - Resolve the capability FIRST by `source_capability_id` (read from the WorkItem's `book_of_work_json` blob item), then FALL BACK to assembling from a behaviour-bearing `operational_artifact` finding (D3)
    - Wire the `DiscoveryCapabilityRepository` + `DiscoveryCapabilityMemberRepository` into the resolver constructor (D2's entities from changeset 184)
  - [x] 1.4 Assemble the block from the capability's `detail_json` (D4)
    - Read the capability fields exactly as D2 persists them: `name`, `kind`, `summary`, boxed `confidence`, and `detail_json` (JIL-DAG topology snapshot, `invocations[]` edges JIL→shell→Java→DB, schedule/trigger metadata, inputs/outputs, side-effects, external systems, aggregated `behaviourBearing` hint)
    - Read members + kinds from `discovery_capability_member`
    - Emit block-level `missingInputs[]` when the capability has no members OR no behaviour signal; aggregate into the DTO top-level `missingInputs[]` like the existing six blocks
    - AMS snake_case default (D2 entity carries no `@CamelCaseWire`); any PATCH-mutable numeric stays boxed (avoid the primitive→0-on-PATCH wipe)
    - NO new Liquibase changeset
  - [x] 1.5 Ensure Group 1 tests pass (FOREGROUND `mvn`)
    - Run ONLY the 2-8 tests written in 1.1 (targeted `mvn -Dtest=...` on H2 2.3)
    - Verify the new block resolves from both sources AND the 6 existing types still resolve
    - Do NOT run the entire AMS suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass on H2 2.3 via foreground `mvn`
- The 7th type resolves an `operational_capability` block from a fixture capability (preferred) and a fixture finding (fallback)
- All 6 existing context types still resolve unchanged (no regression)
- A thin capability emits and aggregates `missingInputs[]`
- No new Liquibase changeset added; AMS wire stays snake_case

#### Task Group 2: `append-capability-story` AMS endpoint
**Dependencies:** Task Group 1 (same controller/service area; not a hard compile dependency but kept sequential)

- [x] 2.0 Add the per-capability `append-capability-story` endpoint
  - [x] 2.1 Write 2-8 focused tests for the new endpoint
    - Limit to 2-8 highly focused tests maximum
    - Test: the endpoint mints a `type='story'` WorkItem via `itemSaver.persistOne(...)` and appends the `book_of_work_json.items[]` blob in ONE transaction, stamping `workItemId` + `saveState='saved'`
    - Test: the blob item is stamped with `source_capability_id` (no DDL — it rides `book_of_work_json` exactly as `append-test-item` stamps `workItemId`)
    - Test: the created story is `selectEligibleStories`-eligible (it is `type==='story'` with a non-null `workItemId`)
    - Test: missing required fields throw `IllegalArgumentException`; missing book throws `ResourceNotFoundException` (mirror `appendTestItem`'s guards)
    - Skip exhaustive payload-variation coverage
  - [x] 2.2 Add the service method modelled on `appendTestItem` (`GeneratedMigrationBookOfWorkService:783`)
    - Single `@Transactional` boundary: mint a `type='story'` WorkItem via `itemSaver.persistOne(...)` AND append the `book_of_work_json.items[]` blob, stamping `workItemId` + `saveState='saved'`
    - Additionally stamp `source_capability_id` ONTO the blob item (no DDL)
    - Reuse the defensive `book_of_work_json` working-copy + `extractItems` pattern from `appendTestItem` so the merge never mutates shared state
    - NO new Liquibase changeset
  - [x] 2.3 Add the controller endpoint + request/response DTOs
    - New endpoint on the same controller as `append-test-item`
    - Request DTO carries the capability id + title/sequence metadata; response returns the created WorkItem UUID + new blob-item id (mirror `AppendTestItemRequest` / `AppendTestItemResponse`)
    - AMS snake_case default; any PATCH-mutable numeric boxed
  - [x] 2.4 Ensure Group 2 tests pass (FOREGROUND `mvn`)
    - Run ONLY the 2-8 tests written in 2.1 (targeted `mvn -Dtest=...` on H2 2.3)
    - Verify the story is created, `source_capability_id` is stamped, and the story is selection-eligible
    - Do NOT run the entire AMS suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass on H2 2.3 via foreground `mvn`
- The endpoint mints a `type='story'` WorkItem and appends the blob in ONE transaction via `persistOne`
- `source_capability_id` is stamped onto the blob item with no DDL
- The created story is consumed UNCHANGED by `selectEligibleStories`
- No new Liquibase changeset added

### Gateway Layer (Express / TypeScript, jest LLM-guard + `architectureModelClientMock`, `npx tsc --noEmit`)

#### Task Group 3: 7th type wiring + generator consuming capabilities/findings
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Wire the 7th type and the per-capability trigger; verify the generator runs UNCHANGED
  - [x] 3.1 Write 2-8 focused tests for the generation path
    - Limit to 2-8 highly focused tests maximum
    - Test: a capability story (resolver returns an `operational_capability` block) → a generated `migration_story_spec_generations` row + `implement-state.json` written + an effect-oriented test pack
    - Test: zero members / no behaviour-bearing signal → short-circuit to `insufficient_context` with NO LLM call (mock `llmClient` asserts not-called)
    - Test: members + spine but a MISSING target-tech decision → `generated_with_warnings` (downgraded, NOT blocked)
    - Test: `coveredEndpointIds` is empty `[]` for the capability story (validator already allows empty at `:371`)
    - Test: the `append-capability-story` trigger invokes the AMS endpoint and the resulting story is picked up by the handler unchanged
    - Use the LLM-guard (mock `llmClient`) + `architectureModelClientMock`
    - Skip exhaustive scenario coverage
  - [x] 3.2 Add `operational_capability` to `MIGRATION_SPEC_CONTEXT_TYPES` (`migrationSpecContextClient.ts:59`)
    - `SHAPE_SPEC_CONTEXT_TYPES` (handler `:181`) spreads it, so the 7th type is requested automatically — no other handler change needed (D9)
    - Extend the client's TS types / per-block typing to carry the new `operational_capability` block in the DTO response shape
  - [x] 3.3 Confirm the generator runs UNCHANGED on the new story
    - `migrationShapeSpecGenerationHandler` consumes the capability story with NO change — `selectEligibleStories` (`:1103`) already gates on `type==='story'` + non-null `workItemId` (`:1115`); the two-pass loop, confidence/no-fab, implement-state writer, and persistence are reused untouched
    - Confidence handling rides the existing pre-LLM context-blocker path: zero members / no behaviour → `insufficient_context` (no LLM); members + spine but missing target-tech decision → `generated_with_warnings`
    - `coveredEndpointIds` `[]` for every capability/finding story (no-op confirmation; validator + prompt already support it)
  - [x] 3.4 Add the `append-capability-story` gateway trigger (route/handler)
    - Explicit PER-CAPABILITY trigger only — a gateway route/handler that invokes the new AMS `append-capability-story` endpoint for one approved capability (D2, D10)
    - Batch / gate-driven invocation for un-covered capabilities + the "Generate all" button wiring is DEFERRED to D4 (out of scope here)
  - [x] 3.5 Ensure Group 3 tests pass (targeted jest + `tsc`)
    - Run ONLY the 2-8 tests written in 3.1 (via the LLM-guard + `architectureModelClientMock`)
    - Run `npx tsc --noEmit` to confirm the type wiring compiles
    - Do NOT run the entire gateway suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass via the LLM-guard + `architectureModelClientMock`
- `npx tsc --noEmit` is clean
- A capability story → generated row + `implement-state.json` + effect-oriented test pack
- Thin capability → `insufficient_context` with no LLM call; missing target-tech decision → `generated_with_warnings`
- `coveredEndpointIds` is `[]` for the capability story
- The `append-capability-story` trigger creates a handler-eligible story; the generator is reused untouched (no fork)

#### Task Group 4: Prompt clauses (modernisation + effect-test)
**Dependencies:** Task Group 3

- [x] 4.0 Add the two prompt clauses to `product-manager.migration-shape-spec-generation.task.md`
  - [x] 4.1 Write 2-8 focused tests for the clauses + emitted output
    - Limit to 2-8 highly focused tests maximum
    - Test: the modernisation clause is present in the prompt (operational-capability modernisation language + the existing `MISSING_DECISION_CONTEXT`/`NO_CAPTURED_DECISIONS` downgrade reference)
    - Test: the effect-test clause is present in the STRUCTURED TEST PACK section
    - Test: for an operational story, the generator emits effect-oriented tests (run pipeline → assert DB/message/snapshot) of the existing `{ title, description, type: 'unit'|'functional' }` shape (mock LLM returns an effect-shaped pack; assert it passes the validator)
    - Skip exhaustive prompt-text assertions
  - [x] 4.2 Add the "operational capability" MODERNISATION clause (D5)
    - Target the captured modern equivalent via the EXISTING Target State Decisions Context (`:101`) + Target Tech Stack Context (`:115`) blocks — Autosys → captured orchestrator, Argon/TIBCO → captured messaging, Sybase → Postgres, Geneos → captured observability — while PRESERVING the behavioural contract (same schedule semantics; same data/message/snapshot outcomes). The WHAT is fixed; the HOW is modern
    - Modern choices ride the EXISTING free-text Target State Decisions channel (e.g. "use Airflow for batch orchestration"); NO new tech-category vocabulary
    - No relevant captured decision → emit the EXISTING `MISSING_DECISION_CONTEXT` / `NO_CAPTURED_DECISIONS` warning + downgrade; NEVER invent a modern target
  - [x] 4.3 Add the EFFECT-test clause to the STRUCTURED TEST PACK section (`:79`) (D7, D8)
    - Steer operational-capability tests toward EFFECT assertions: run the pipeline → assert DB tables / downstream message / snapshot outcome, INSTEAD of HTTP request/response
    - Reuse the existing `structured_tests_json` shape `{ title, description, type: 'unit' | 'functional' }` — NO schema change
    - Keep the clause kind-AGNOSTIC (D15): the same clause covers `batch_pipeline`, `monitoring`, `deployment`, `ftp_ingestion`, `housekeeping`; the kind only informs the modern-tech mapping
    - Heavier integration/E2E effect tests stay with the holistic mechanism + later D6 (out of scope)
  - [x] 4.4 Ensure Group 4 tests pass (targeted jest + `tsc`)
    - Run ONLY the 2-8 tests written in 4.1 (mock LLM)
    - Run `npx tsc --noEmit` if any TS changed
    - Do NOT run the entire gateway suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass (mock LLM)
- Both clauses are present in the prompt
- The generator emits effect-oriented tests of the existing `unit`/`functional` shape for an operational story (no schema change)
- The modernisation clause references the existing target-tech channels + the existing `MISSING_DECISION_CONTEXT`/`NO_CAPTURED_DECISIONS` downgrade (never invent)

### Testing

#### Task Group 5: Strategic gap tests (end-to-end + fallback + uniform kinds)
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the AMS resolver tests (Task 1.1) + append-endpoint tests (Task 2.1)
    - Review the gateway generation tests (Task 3.1) + prompt-clause tests (Task 4.1)
    - Total existing tests: approximately 8-32 tests
    - DONE: reviewed all 4 — AMS resolver (4 tests: capability/finding/thin/6-types-no-regression), AMS append-endpoint (6 tests), gateway generation (7 tests: forwards-sourceCapabilityId / generated+implement-state / empty-coveredEndpointIds / thin→insufficient_context-no-LLM / missing-target-tech→generated_with_warnings / monitoring-kind), prompt clauses (4 tests) + append-capability-story route (3 tests)
  - [x] 5.2 Analyse coverage gaps for THIS feature only
    - Focus ONLY on gaps related to D3's requirements (the capability/finding → implementation-ready spec dead-zone closure)
    - Prioritise end-to-end workflows + the finding fallback + uniform kind handling over unit gaps
    - Do NOT assess entire-application test coverage
    - GAP FOUND: Groups 1-4 stub BOTH the book-of-work loader AND the focused-context fetcher, so the real cross-service WIRE seams are untested — `defaultLoadBookOfWork` parsing `source_capability_id` off the AMS blob, AND `fetchMigrationSpecContext` serialising `sourceCapabilityId` into the AMS request + parsing the `operational_capability` block back out. ALREADY-COVERED (skipped, not duplicated): thin→insufficient_context (Group 3), generated_with_warnings (Group 3), monitoring kind (Group 3), 6-types-resolve at the resolver (Group 1)
  - [x] 5.3 Write up to 8 additional strategic tests maximum
    - Capability path END-TO-END: D2 capability → `append-capability-story` → generated spec + `implement-state.json` + effect test pack
    - FINDING fallback path: behaviour-bearing finding → block → generated spec (proves D3 is testable WITHOUT a populated D2 run, D12)
    - Thin-capability → `insufficient_context` (no LLM)
    - `generated_with_warnings` on a missing target-tech decision
    - NO-REGRESSION: all 6 existing context types + a normal API story still generate
    - ALL capability kinds handled uniformly (D15): a monitoring / deployment capability also generates, not just `batch_pipeline`
    - Maximum of 8 new tests; do NOT write comprehensive coverage for all scenarios; skip edge cases / performance / accessibility unless business-critical
    - DONE: added 3 strategic gateway END-TO-END tests (`gateway/src/__tests__/migrationShapeSpecOperationalCapabilityE2E.test.ts`) driving the REAL loader + REAL focused-context client through a URL-routed `global.fetch` mock (LLM/persist/implement-state/citation deps injected). T1 capability path end-to-end (blob `source_capability_id` → REAL client serialises `sourceCapabilityId` into the AMS request → CAPABILITY-sourced block, NOT finding fallback → generated row + implement-state + effect pack). T2 finding-fallback wire seam (NO `source_capability_id` on blob → REAL client OMITS `sourceCapabilityId` → finding-sourced block still generates). T3 no-regression (normal api story still generates unchanged through the same real loader+client; the 7th type is purely additive). No product gap exposed (seam code correct). Thin→insufficient_context / generated_with_warnings / monitoring-kind / 6-types-resolve NOT duplicated (covered by Groups 1+3). No AMS test added — Group 1's resolver test already covers every resolver seam (capability+finding+thin+6-types); the only uncovered seam is the cross-service wire, exercised at the gateway
  - [x] 5.4 Run feature-specific tests only
    - Gateway: targeted jest via the LLM-guard (mock `llmClient`) + `architectureModelClientMock`; then `npx tsc --noEmit`
    - AMS: targeted FOREGROUND `mvn` (H2 2.3) for the resolver + endpoint tests
    - Frontend: NONE (D11 — no new UI; the generated capability spec reuses the existing Specs / Implementation review tiles)
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, and 5.3); expected total approximately 16-40 tests maximum
    - Do NOT run the entire application test suite
    - DONE: gateway D3 feature suites green — 5 suites / 21 tests (3 new E2E + 7 generation + 4 prompt + 3 append-route + 4 client) via the active llmGuard.setup.ts + architectureModelClientMock; `npx tsc --noEmit` clean (EXIT=0). AMS resolver + append-endpoint tests (Groups 1+2, 10 tests) green via foreground `mvn` in their own groups; no AMS change in Group 5 so not re-run. Frontend: none (D11)

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-40 tests total)
- The capability path and the finding fallback path are both covered end-to-end
- Thin-capability `insufficient_context` and missing-target-tech `generated_with_warnings` are covered
- All capability kinds (not just `batch_pipeline`) are proven to generate
- The 6 existing context types + a normal API story still generate (no regression)
- No more than 8 additional tests added; testing focused exclusively on D3's requirements
- No new Liquibase changeset; no new frontend UI

## Execution Order

Recommended implementation sequence (dependency-ordered):
1. AMS — 7th context type in `MigrationSpecContextResolver` (Task Group 1)
2. AMS — `append-capability-story` endpoint (Task Group 2)
3. Gateway — 7th type wiring + generator path + per-capability trigger (Task Group 3)
4. Gateway — modernisation + effect-test prompt clauses (Task Group 4)
5. Strategic gap tests (Task Group 5)

## Constraints (apply to every group)
- NO new Liquibase changeset — provenance (`source_capability_id`) rides the `book_of_work_json` blob; changesets 181 + 184 already exist. Never edit applied changesets.
- ONE generator only — `migrationShapeSpecGenerationHandler` stays the single path; the two-pass loop, confidence/no-fab, implement-state writer, and persistence are reused UNTOUCHED. Do NOT fork.
- AMS wire stays snake_case (D2 entity carries no `@CamelCaseWire`); any PATCH-mutable numeric stays boxed.
- No-fabrication — missing target-tech decision → existing `MISSING_DECISION_CONTEXT`/`NO_CAPTURED_DECISIONS` warning + downgrade; thin capability → `insufficient_context`. Never invent a modern target.
- No new UI (D11) — the generated capability spec surfaces in the existing Specs / Implementation review tiles; the implement-state writer hydrates the screen identically.
- Test verification runs ONLY the newly written tests per group (targeted `mvn` / targeted jest + `tsc`), never the full suite; the gap group adds at most 8 tests.

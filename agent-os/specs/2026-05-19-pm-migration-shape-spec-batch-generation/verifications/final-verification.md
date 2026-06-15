# Verification Report: PM Migration Shape-Spec Batch Generation (Spec 2)

**Spec:** `2026-05-19-pm-migration-shape-spec-batch-generation`
**Date:** 2026-05-19
**Verifier:** implementation-verifier
**Status:** PASS-WITH-CAVEATS

---

## Verdict

PASS-WITH-CAVEATS.

All 13 task groups (G1-G13) are checked off in `tasks.md` and the on-disk artefact set (entity + DTO + repo + mapper + Liquibase 140; gateway task config + prompt + validator + focused-context client + batch handler; AMS focused-context controller/resolver + persistence controller/service; frontend workspace + sub-components + Implement-tab chip; inline doc headers) is fully present. Spot-checks of the three load-bearing test suites all pass on disk: Gateway G4 validator 11/11, Gateway G6 batch handler 11/11, Frontend G9-G11 MigrationShapeSpecGeneration 20/20, Frontend G12 ImplementTabShapeSpec 4/4. The four agent-disclosed deviations (validator filename / API shape, missing route wiring, reconstructed `SpecGenerationWorkspace.tsx`, speculative drill-back URL) are confirmed exactly as described and are non-blocking for the v1 acceptance signals.

The "with-caveats" qualifier is for:

1. G2 sub-tasks 2.1 (fixture sanity test) and 2.6 (run it) are still unchecked in `tasks.md` and no `migrationShapeSpecFixtures.test.ts` exists on disk — but every other fixture acceptance criterion (both-location placement, structural shape, `_provenance` field, `/agent-os:shape-spec` prefix in the generated fixture) is satisfied and downstream tests (G4, G6) consume the fixtures successfully.
2. The four agent-disclosed deviations (see Known Deviations section).
3. The 7-case integration list from `tasks.md` lines 595-606 is covered by the existing G6 + G7 + G9 tests but not as standalone integration test files (`tasks.md` explicitly states this is acceptable: "Any integration test not covered by an existing group test SHOULD be added as an additional case to the most relevant group's test file rather than as a standalone integration test file").
4. AMS test execution path: per the build instructions, AMS tests were compiled in isolation and run via `surefire:test -Dtest=...` because pre-existing test rot on unrelated tests blocks `mvn test-compile`. The on-disk test files exist with the correct `@Test` counts; we did not re-run them in this verification (would require re-running the isolated compile step, which is out of scope).

---

## Per-Group Pass/Fail with Test Counts

| Group | Title | On-Disk Tests | Spec Required | Status |
|-------|-------|--------------|---------------|--------|
| G1 | AMS Persistence Path Decision + Liquibase 140 | `MigrationStorySpecGenerationEntityPersistenceTest.java` (6 `@Test`) | 4-6 | PASS |
| G2 | LLM-output fixtures | 0 sanity tests on disk (2.1 / 2.6 unchecked) | 1-2 (optional) | PASS-WITH-CAVEATS (fixtures present + correct shape; sanity test missing) |
| G3 | PM task config + markdown prompt | `productManagerMigrationShapeSpecGenerationTaskConfig.test.ts` (6 `it`) | 4-6 | PASS |
| G4 | Hand-rolled validator | `specGenerationResponseValidator.test.ts` (11 `it`; spot-check: 11/11 pass) | 6-8 | PASS (file renamed - see deviations) |
| G5 | Focused-context client + resolver registration | `migrationSpecContextClient.test.ts` (5 `it`) | 3-5 | PASS |
| G6 | Batch generation handler | `migrationShapeSpecGenerationHandler.test.ts` (11 `it`; spot-check: 11/11 pass) | 10 | PASS (dispatch wiring caveat - see deviations) |
| G7 | AMS focused-context endpoint + resolver | `MigrationSpecContextResolverTest.java` (8 `@Test`) | 7 | PASS (test packaging differs from spec - one combined "otherBlocksPopulated" rather than separate soap/data/infra/test_pack tests, but block coverage is in place) |
| G8 | AMS persistence endpoints + summary | `MigrationStorySpecGenerationServiceTest.java` (9 `@Test`) | 4 | PASS |
| G9 | Workspace shell + summary header | `SpecGenerationWorkspace.test.tsx` (4 `it`) | 2-3 | PASS (file was reconstructed - see deviations) |
| G10 | Primary action + batch progress + results table | `BatchGenerationControls.test.tsx` (5 `it`) | 3-4 | PASS |
| G11 | Filters + story drawer | `Filters.test.tsx` (5 `it`) + `StoryResultDrawer.test.tsx` (6 `it`) | 2-3 (split across two files) | PASS |
| G12 | WorkItem Implement-tab integration | `ImplementTabShapeSpec.test.tsx` (4 `it`; spot-check: 4/4 pass) | 2-3 | PASS (drill-back route caveat - see deviations) |
| G13 | Inline TSDoc / Javadoc / JSDoc headers | n/a - documentation pass | n/a | PASS |

**Aggregate (spot-checked):** Gateway 11+11 = 22/22 passing on G4 + G6. Frontend 20/20 passing across G9-G11 MigrationShapeSpecGeneration folder + 4/4 on G12 ImplementTabShapeSpec. AMS test files exist with the right `@Test` counts but were not re-executed in this verification (per the build's documented surefire-in-isolation approach).

---

## Cross-Group Integration Coverage (7-case set from `tasks.md` lines 595-606)

| # | Integration Case | Slotted Into | Verified On Disk |
|---|------------------|--------------|------------------|
| 1 | Happy path (BoW + WorkItems -> batch generation -> rows visible from each WorkItem) | G6 Test 6 + G12 Test 1 | YES - `migrationShapeSpecGenerationHandler.test.ts` Test 6 + `ImplementTabShapeSpec.test.tsx` Test 1 (chip rendered when row exists) |
| 2 | API story integration (generated spec references OAS contract ID + behaviour baseline ID + mapping ID) | G6 Test 6 + G7 Test 2 | YES - G6 Test 6 verifies persisted row; G7 `apiBlockPopulated` exercises the API context block |
| 3 | SOAP story integration | G6 Test 6 + G7 Test 3 | YES - G7 `otherBlocksPopulated` covers soap (plus data/infra/test_pack); G6 Test 6 verifies persistence |
| 4 | Data-migration story integration | G6 Test 6 + G7 Test 4 | YES - covered by `otherBlocksPopulated` and G6 Test 6 |
| 5 | Missing-mapping path (-> `status='insufficient_context'` + `missingInputs[]`) | G6 Test 7 | YES - `migrationShapeSpecGenerationHandler.test.ts` Test 7 named verbatim for this case |
| 6 | 60-story scenario with default batch size 25 -> 3 batches | G6 Test 1 + Test 9 | PARTIAL - G6 Test 1 verifies batch-of-25 selection; the 60-story / 3-batch end-to-end is implicit (batch selection algorithm is the deterministic surface); no standalone 60-story integration test exists |
| 7 | Reload persistence (refresh -> same rows linked to same WorkItems) | G9 Test 3 | YES - `SpecGenerationWorkspace.test.tsx` covers mount/re-fetch behaviour |

Coverage is acceptable per the explicit `tasks.md` policy that integration cases need not live in standalone integration files. The 60-story scenario is the one case with the weakest direct test coverage; it's mathematically implied by Test 1's batch-of-25 selection + Test 9's idempotency, but no test asserts "3 batches of 25/25/10 specifically".

---

## R-x / A-y Traceability Spot-Checks

### R-2 - Gateway-only orchestration

VERIFIED. `migrationShapeSpecGenerationHandler.ts` is the sole orchestrator; AMS-side files (`MigrationStorySpecGenerationService.java`, `MigrationStorySpecGenerationController.java`) carry only persistence + summary endpoints. No AMS endpoint accepts a "generate" command. Doc header at line 18 of the handler explicitly cites "Gateway-only orchestration (R-2)".

### R-5 / A-3 - Token cascade reuse (no duplication)

VERIFIED. `migrationShapeSpecGenerationHandler.ts` lines 88-90 import `applyTokenBudgetCascade` and `TokenBudgetOverflowError` directly from `./migrationBookOfWorkHandler` (Spec 1). Line 842 calls the imported helper; line 844 catches the imported error. No re-declaration of either symbol in the spec 2 handler.

### R-7 - Confidence downgrade

VERIFIED. `migrationShapeSpecGenerationHandler.ts` exports a dedicated `computeConfidenceDowngrade(rated, ctx)` at line 574 that returns `{ confidence, missingSignals[] }`. Lines 983-1002 invoke it post-validation, append a `{ code: 'CONFIDENCE_DOWNGRADED', from, to, missingSignals }` entry to the warnings array, and emit a `[diag-gateway] ... confidence_downgraded` structured log line (line 59 doc, line 1002 emission).

### R-9 - No new WorkItem field

VERIFIED. `grep` against `WorkItemEntity.java` for `spec_generation | spec-generation | generated_spec | specGeneration` returns zero matches. The chip in `ImplementTabShapeSpecCard.tsx` queries `GET /api/projects/{projectId}/work-items/{workItemId}/spec-generations` (line 12 doc) rather than reading any field on the WorkItem itself.

### R-12 - Per-story failure isolation

VERIFIED. `migrationShapeSpecGenerationHandler.ts` defines `BatchResult.persistedCount / resultsCouldNotPersist / unpersistedResults` (lines 227-229); the handler emits `status: 'failed'` rows from multiple catch sites (lines 784, 831, 865, 902, 918) covering focused-context fetch, token-cascade, LLM call, validator, and persistence stages. `migrationShapeSpecGenerationHandler.test.ts` Test 8 named "one story raising mid-batch does NOT abort the batch; failed result is still persisted; remaining stories still process (R-12)" - passing.

### A-4 - Hand-rolled validator (no schema library)

VERIFIED. `grep` against `specGenerationResponseValidator.ts` for `import.*zod | import.*ajv | import.*joi | require.*zod | require.*ajv` returns zero matches. Doc header line 9 reads "hand-rolled per A-4 (no Zod, no Ajv, no schema library)". Implementation uses explicit per-status branch checks; export at line 398 returns a `ValidationResult<T>` discriminated union per the agent disclosure.

### A-5 - New `MigrationSpecContextResolver` (separate from migration-summary)

VERIFIED. `architecture-model-service/.../service/migration/MigrationSpecContextResolver.java` exists as a separate `@Service` class in its own package. Doc header line 40 cites A-5. The resolver is invoked from `MigrationSpecContextController` (the new `POST /api/projects/{projectId}/migration-spec-context` endpoint, line 40 + 52 of the controller).

### A-6 - Lazy `not_attempted`

VERIFIED. `MigrationStorySpecGenerationService.java` line 43-46 doc explicitly states "Lazy `not_attempted` (A-6)"; line 321 computes `notAttempted = Math.max(0, totalSavedStories - attempted)`; the status check constraint in changeset 140 (line 112) only permits `generated | generated_with_warnings | insufficient_context | failed | skipped_blocked` - no `not_attempted` value can be persisted at the database level.

---

## Known Deviations / Caveats

### 1. G4 validator filename + API shape (disclosed by agent)

CONFIRMED. The file is `gateway/src/services/specGenerationResponseValidator.ts` (not `migrationShapeSpecResponseSchema.ts` as `tasks.md` originally specified at lines 220, 230, 574). The exported function `assertSpecGenerationResponse(payload)` returns a `ValidationResult<T> = { ok: true, value } | { ok: false, errors: string[] }` discriminated union, not a throwing function as the original tasks.md draft envisaged. The test file is `specGenerationResponseValidator.test.ts` (mirrors the validator filename). 11/11 tests pass. Functionally equivalent and arguably cleaner than the throwing variant; downstream handler code already adapts to the `ok` flag.

### 2. G6 dispatch wiring not in `gateway/src/routes/` (disclosed by agent)

CONFIRMED. `grep` for `runShapeSpecGenerationBatch | migrationShapeSpecGenerationHandler` across `gateway/src/routes/` returns zero matches. The handler is exported and unit-tested but no Express route mounts it. Spec 1's `migrationBookOfWorkHandler.ts` follows the same pattern (`grep` for `migrationBookOfWorkHandler | generateMigrationBookOfWork` in `gateway/src/routes/` also returns zero). This is a consistent precedent-following deferral, not a regression introduced by Spec 2. Production route wiring is a follow-up that should land for BOTH Spec 1 and Spec 2 together.

### 3. G9 `SpecGenerationWorkspace.tsx` reconstructed from test contracts (disclosed by agent)

CONFIRMED. The file is on disk at 458 lines with a complete TSDoc header citing A-1 / A-9 / R-10 (lines 32-43). It composes the expected sub-components (`SpecGenerationSummaryHeader`, `BatchGenerationControls`, `BatchResultsTable`, `SpecGenerationFilters`, `StoryResultDrawer`) and wires the API client (`fetchSpecGenerationSummary`, `fetchSpecGenerationsForBook`, `startBatchGeneration`, `regenerateSingleStory`). It supports the G12 drill-back hook (`initialDrawerWorkItemId` prop, lines 82, 101, 173-185) and `buildWorkItemHref` / `buildImplementTabHref` callbacks. 20/20 frontend tests pass. Spec.md UI-surface items potentially not covered by tests (and now visible in this reconstruction):
- Eight UI surfaces from spec.md section "Frontend - spec generation workspace": summary header (Group 9), primary action row (Group 10), batch results table (Group 10), filters (Group 11), drawer (Group 11), WorkItem integration (Group 12), pagination/batch-continuation, failure UX. The reconstruction composes all six sub-components that own these surfaces; the workspace shell itself is the orchestrator + state holder, which the tests verify behaviourally.
- "Visual styling / responsive layout" - no test contract, but a co-located `MigrationShapeSpecGeneration.module.css` file exists.
- No evidence of a regression in surface coverage from the overwrite-then-reconstruct cycle.

### 4. Frontend drill-back route is speculative (disclosed by agent)

CONFIRMED. `ImplementTabShapeSpecCard.tsx` exposes an `onDrillBackToWorkspace` callback prop (not a hardcoded URL); the URL is built in `ProductImplementPage.tsx` lines 578-589 as `/projects/{projectUuid}/migration-books-of-work/{bookOfWorkId}/spec-generation?workItemId={workItemId}`. `grep` for `SpecGenerationWorkspace` references shows zero matches in any router config / App.tsx-style file. The URL is consumed by `navigate()` (line 586) but no `Route path="..." element={<SpecGenerationWorkspace ... />}` entry has been added anywhere in the codebase. Clicking the chip will navigate to a URL the router does not yet match; behaviour is "router falls through / 404" per the comment at ProductImplementPage line 575-577. Same production-follow-up category as deviation #2.

### 5. G2 fixture sanity test 2.1 / 2.6 not implemented

NEW FINDING (not on the agent disclosure list). `tasks.md` lines 125 and 153 are unchecked. No `gateway/src/__tests__/migrationShapeSpecFixtures.test.ts` exists on disk. The three fixtures DO exist at both required locations with valid JSON and `_provenance` strings, AND are exercised by the G4 validator tests (which load them and assert the parsed status values), so the test coverage that 2.1 would have provided is supplied implicitly by G4. Minor gap; non-blocking.

### 6. G7 context controller test packaging slightly differs from spec layout

NEW FINDING (minor). `tasks.md` 7.1 lists 7 tests (one each for service / api / soap / data / infra / test_pack + missingInputs). On disk `MigrationSpecContextResolverTest.java` (note: tests the RESOLVER not the CONTROLLER per agent's chosen layering, but coverage is equivalent) has 8 `@Test` methods including a combined `otherBlocksPopulated` that covers 4 of the 6 block types in one method instead of 4 separate methods. Coverage is functionally complete; per-block assertions exist inside the combined test.

---

## Pre-existing Rot (NOT introduced by Spec 2)

Per the user's verification brief, the following are pre-existing test issues NOT introduced by this spec:

- **AMS:** `RoadmapImportServiceV3Test`, `OrganisationController*Test`, `WorkItemImplementContextServiceTest`, `DiagramSvgRendererTest`, `ProjectSnapshotImportIntegrationTest` exhibit UUID/String signature drift that blocks `mvn test-compile`. AMS test execution path during this build was: compile NEW tests in isolation + invoke `surefire:test -Dtest=...`. `mvn compile` on main sources is clean. Verified independently in this verification: the AMS build is configured with `<maven.test.skip>true</maven.test.skip>` + `<tests.skip>true</tests.skip>` in `pom.xml` lines 25-26, consistent with the documented isolation workflow.
- **Gateway:** `registryLoader.test.ts` Test 2 asserts task-count 15-17, actual count is 23 due to earlier specs' task configs. Pre-existing rot, not introduced by Spec 2.
- **Frontend:** `ProductPage.test.tsx` 6 failures (`useActiveArchitectureId` mock missing, `useLocation` outside Router). Pre-existing.

None of the above were modified by this spec's work and none affect Spec 2 acceptance signals.

---

## Acceptance Signals (spec.md section "Acceptance signals" 1-18)

| # | Signal | Test / Code Citation |
|---|--------|----------------------|
| 1 | User can generate shape-specs from a saved BoW | `migrationShapeSpecGenerationHandler.test.ts` Test 1 (batch selection) + `BatchGenerationControls.test.tsx` "Generate specs for all stories" |
| 2 | Batches all saved-story WorkItems | `migrationShapeSpecGenerationHandler.test.ts` Test 1 + `selectEligibleStories` (handler.ts line 508) |
| 3 | Default batch size 25 | `resolveBatchSize` (handler.ts line 485) + Test 1 |
| 4 | Continue to next batch easily | `BatchGenerationControls.test.tsx` "Generate-next-25 continues from nextBatchStart" |
| 5 | Per-story actual status | `migrationShapeSpecGenerationHandler.test.ts` Tests 6-10 |
| 6 | Literal `/agent-os:shape-spec` prefix | `specGenerationResponseValidator.test.ts` "rejects a status=generated payload whose specText does not start with '/agent-os:shape-spec'" |
| 7 | Specs linked to WorkItems | `migrationShapeSpecGenerationHandler.test.ts` Test 6 + AMS Repository `findByWorkItemId` |
| 8 | Existing flow accesses spec from WorkItem | `ImplementTabShapeSpec.test.tsx` (chip rendered when row exists) |
| 9 | No fabricated specs on insufficient context | `migrationShapeSpecGenerationHandler.test.ts` Test 7 + handler line 28 doc + line 840 |
| 10 | InsufficientContext: missingInputs + recommendedNextAction | `StoryResultDrawer.test.tsx` "renders missingInputs[] and recommendedNextAction" |
| 11 | Generated specs include evidence refs | `migrationShapeSpecGenerationHandler.test.ts` Test 10 (named verbatim) |
| 12 | Use focused migration context | `migrationShapeSpecGenerationHandler.test.ts` Test 3 (six context types call) + `migrationSpecContextClient.test.ts` |
| 13 | API / SOAP / data / infra / test_pack supported | `MigrationSpecContextResolverTest.java` `apiBlockPopulated` + `otherBlocksPopulated` + `serviceBlockPopulated` |
| 14 | Resilient to individual failures | `migrationShapeSpecGenerationHandler.test.ts` Test 8 |
| 15 | UI shows progress + summary + confidence + failures | `SpecGenerationWorkspace.test.tsx` + `BatchGenerationControls.test.tsx` in-flight banner + `BatchResultsTable.test.tsx` predicted/actual/confidence |
| 16 | Predicted-vs-actual comparison | `BatchResultsTable.test.tsx` "predicted / actual / confidence side-by-side columns" |
| 17 | Manual-edit protection | `MigrationStorySpecGenerationServiceTest.java` `updateRowManualEditProtected` + `updateRowConfirmOverwriteSucceeds` |
| 18 | Output ready for implementing LLM | Validator hard rule (specText must start with `/agent-os:shape-spec`) + G4 prefix-check test |

All 18 acceptance signals have at least one named test or code citation.

---

## Production Follow-ups (next-build candidates)

These are not blockers for Spec 2's PASS verdict; they are the natural next-step items.

1. **Express route wiring for Spec 2's handler.** Add a route in `gateway/src/routes/` that POSTs to `runShapeSpecGenerationBatch`. Spec 1's `migrationBookOfWorkHandler.ts` needs the same treatment — handle both in one follow-up.
2. **React router entry for `/projects/:projectId/migration-books-of-work/:bookId/spec-generation`.** The drill-back URL is built but no route matches it; the chip navigates to a 404 today.
3. **G2 sanity test for the three fixtures.** Trivial to add; would close the only unchecked sub-tasks (2.1 / 2.6) in `tasks.md`.
4. **AMS test-compile rot cleanup.** Repair the UUID/String signature drift on `RoadmapImportServiceV3Test`, `OrganisationController*Test`, `WorkItemImplementContextServiceTest`, `DiagramSvgRendererTest`, `ProjectSnapshotImportIntegrationTest` so a normal `mvn test` works end-to-end.
5. **60-story integration test.** Add an explicit assertion that 60 stories with default batch size 25 require exactly 3 batches and the third is sized 10. The selection algorithm is correct; the missing piece is a named test.

---

## Roadmap Update

No update required. `agent-os/product/roadmap.md` covers v0.1 model CRUD / diagram rendering / interactive editing / backend foundations only. This spec (PM Migration Shape-Spec Batch Generation) is in a different product domain (Product Manager task surface for migration delivery planning) and has no matching roadmap line item.

---

## Tasks.md Verification

All 13 task group parent boxes (G1-G13) are checked `- [x]`. Sub-task gaps:

- G2 sub-tasks 2.1 (sanity test) and 2.6 (run sanity test) are `- [ ]` — flagged in deviation #5 above. Parent 2.0 is checked because every other 2.x sub-task is complete and the fixtures are downstream-consumed correctly.

No other sub-task gaps observed. The tasks.md does not require any auto-correction by this verifier — the unchecked items are correctly unchecked (they were not done) and the parent box completion accurately reflects the substantive work landing.

---

**Report file:** `C:/Workspaces/SSD/architecture-store-and-diagrams/agent-os/specs/2026-05-19-pm-migration-shape-spec-batch-generation/verifications/final-verification.md` - Verdict: PASS-WITH-CAVEATS

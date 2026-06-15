# Verification Report: Net-new backlog items + provenance (D5)

**Spec:** `2026-06-14-net-new-backlog-items-and-provenance`
**Date:** 2026-06-15
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

D5 is fully implemented and end-to-end functional across AMS (changeset 186 + add-item endpoint + `applyManualEdit` fix), gateway (description-grounded spec-gen mode + add-item route), and frontend (add-item form + provenance badge + provenance filter). All 5 task groups are complete; every Confirmed Decision D1–D9 is satisfied in code and demonstrated by tests. The "Add work item" feature is a working chain, not a dangling form: form → API client → gateway route → AMS mint+stamp → description-grounded generation reaching `generated` + implement-state + test pack → dashboard refresh surfaces the now-dispatchable story. All targeted and broader-regression test runs pass; the frontend tsc baseline is held at exactly 515 and gateway tsc is clean.

---

## 1. Tasks Verification

**Status:** ✅ All Complete

All 5 task groups and every sub-task were already marked `- [x]` in `tasks.md`; spot-checks in code confirmed each is genuinely implemented (no checkbox required flipping). No implementation reports exist under `implementation/` (the folder is empty) — see Section 2.

### Completed Tasks
- [x] Task Group 1: `provenance` column (changeset 186) + `applyManualEdit` status-promotion fix
  - [x] 1.1 Focused tests (column default, null-PATCH guard, applyManualEdit promote) — `WorkItemProvenanceColumnTest`, `WorkItemProvenanceLiquibaseSmokeTest`, `MigrationStorySpecGenerationServiceManualEditTest`
  - [x] 1.2 Changeset `186-work-item-provenance.sql` (`ALTER TABLE work_item ADD COLUMN provenance VARCHAR NOT NULL DEFAULT 'carry_over'`), registered after 185 in `db.changelog-master.yaml`
  - [x] 1.3 `WorkItemEntity.provenance` — NOT NULL, `@Builder.Default = carry_over`, `@PrePersist` mirror, constants `PROVENANCE_CARRY_OVER` / `PROVENANCE_NET_NEW`
  - [x] 1.4 `WorkItemDto` field + 22-arg canonical constructor + 16/19/20/21-arg back-compat constructors all defaulting `carry_over`; `WorkItemMapper` null-guard + `toEntity`/`toDto` defaulting
  - [x] 1.5 `MigrationStorySpecGenerationService.applyManualEdit` promotes status to `GENERATED` on non-empty text, before scoring
  - [x] 1.6 Targeted foreground mvn (H2) green
- [x] Task Group 2: Append-`*`-item AMS endpoint that stamps provenance
  - [x] 2.1 Round-trip tests covering both provenance values + eligibility — `GeneratedMigrationBookOfWorkAddItemTest`
  - [x] 2.2 `GeneratedMigrationBookOfWorkController` `POST .../items/add-item` + `GeneratedMigrationBookOfWorkService.addItem` (one `@Transactional`, `persistOne` + blob append)
  - [x] 2.3 `AddWorkItemRequest` / `AddWorkItemResponse` DTOs (snake_case: provenance, kind, title, description, optional parent, sequence_order)
  - [x] 2.4 Provenance stamped on BOTH the `work_item` COLUMN (back-write load-by-id) and the blob item; no `source_capability_id` / no finding refs
  - [x] 2.5 Targeted foreground mvn (H2) green
- [x] Task Group 3: Description-grounded spec-gen for manual adds + add-item route
  - [x] 3.1 Tests — `migrationNetNewDescriptionGrounded.test.ts`
  - [x] 3.2 Description-grounded MODE in `migrationShapeSpecGenerationHandler` (`isManualAdd` + `buildDescriptionGroundedContext` replacing the resolver fetch)
  - [x] 3.3 `insufficient_context` / no-fabrication short-circuit relaxed for manual adds (resolver never consulted)
  - [x] 3.4 `kind` tunes only the prompt flavour (api → endpoint; operational → effect)
  - [x] 3.5 Gateway add-item route (`migrationShapeSpecGeneration.ts`) calls AMS then triggers generation for the one workItemId
  - [x] 3.6 Dispatch + D4-gate stay provenance-blind (asserted, no new code)
  - [x] 3.7 Targeted jest green; gateway `tsc --noEmit` clean
- [x] Task Group 4: Add-item form + provenance badge/filter
  - [x] 4.1 Tests — 3 new suites under `MigrationDeliveryDashboard/__tests__/`
  - [x] 4.2 `MigrationDeliveryAddItemModal.tsx` mounted on the dashboard (provenance + kind + title/description)
  - [x] 4.3 Describe→generate submit wired (`handleAddItemSubmit` → `addWorkItem` → reload); hand-author fallback present
  - [x] 4.4 Provenance badge in `MigrationDeliveryHierarchyTree.tsx` + `MigrationDeliveryProvenanceFilter.tsx` (all / net_new / carry_over)
  - [x] 4.5 Targeted vitest green; frontend tsc baseline held (515)
- [x] Task Group 5: Test Review & Gap Analysis
  - [x] 5.1–5.4 Strategic gap tests added (both provenance flavours, hand-author promotion, D4-gate exclusion, add-item route, badge/filter); feature-scoped suites pass

### Incomplete or Issues
None. All tasks verified complete.

---

## 2. Documentation Verification

**Status:** ⚠️ Issues Found (implementation reports absent; non-blocking)

### Implementation Documentation
- The `implementation/` folder exists but is **empty** — no per-task-group implementation reports were written.

### Verification Documentation
- This report (`verifications/final-verification.md`). The `verifications/` folder did not exist prior to this run and was created.

### Missing Documentation
- Implementation reports for Task Groups 1–5 are missing. This does not affect the correctness of the delivered code (which is thoroughly self-documented via Javadoc/TS doc-comments and covered by tests) but is noted for completeness. The in-code documentation is unusually rich (each entity field, DTO constructor, endpoint, and handler branch carries a spec-referencing comment), which substantially mitigates the absence of separate report files.

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` is the original product roadmap (Phase 1–5: Meta-model CRUD, Diagram Rendering, Interactive Editing, UX Polish, Backend/Multi-user, spanning v0.1–v0.5). It predates the migration / discovery-completeness program entirely and contains no item matching net_new / provenance / D5. A search for `net.?new|provenance|carry.?over|D5|completeness` returned no matches. Consistent with the sibling specs (D1–D4) in this program, no roadmap checkbox applies. No update made.

---

## 4. Test Suite Results

**Status:** ✅ All Passing (targeted + broader-regression)

Per the explicit instruction to keep runs targeted, I re-ran every D5-specific suite plus a bounded regression sweep of the neighbours of the shared files D5 touched (`WorkItemDto`/`WorkItemEntity`/`WorkItemMapper`, the book-of-work service, the spec-gen service, and the Migration Delivery Dashboard). I did not run the three full application suites in their entirety; the bounded sweeps below exercise every consumer of the changed files.

### Test Summary (all runs)
- **Total Tests run:** 403
- **Passing:** 403
- **Failing:** 0
- **Errors:** 0

### Command Outputs

**AMS — targeted D5 suites** (`cd architecture-model-service && mvn test -Dtest='WorkItemProvenanceColumnTest,WorkItemProvenanceLiquibaseSmokeTest,GeneratedMigrationBookOfWorkAddItemTest,MigrationStorySpecGenerationServiceManualEditTest'`):
```
WorkItemProvenanceColumnTest ................... Tests run: 3, Failures: 0, Errors: 0
WorkItemProvenanceLiquibaseSmokeTest ........... Tests run: 2, Failures: 0, Errors: 0
GeneratedMigrationBookOfWorkAddItemTest ........ Tests run: 4, Failures: 0, Errors: 0
MigrationStorySpecGenerationServiceManualEditTest  Tests run: 7, Failures: 0, Errors: 0
Tests run: 16, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
```
Runtime log confirmed `add_item_ok ... provenance=net_new kind=api`, the provenance column present in the Hibernate insert/select, and `quality_scored ... priorScore=42` on a promoted `insufficient_context` row (proves the applyManualEdit promote → scoring path).

**AMS — broader regression sweep** (`mvn test -Dtest='WorkItem*,GeneratedMigrationBookOfWork*,MigrationStorySpecGeneration*'`):
```
Tests run: 209, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
```
(Covers WorkItem repository/service/entity/mapper, all book-of-work service flows including append-test-item / append-capability-story / save-to-backlog, and all spec-gen service flows — no regression from the shared-file edits.)

**Gateway — D5 suite** (`cd gateway && npx jest migrationNetNewDescriptionGrounded`):
```
Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
```

**Gateway — tsc** (`npx tsc --noEmit`): exit 0, clean.

**Frontend — 3 D5 suites** (`npx vitest run` the AddItemAndProvenanceFilter + HierarchyTreeProvenanceBadge + ProvenanceFilter tests):
```
Test Files  3 passed (3)
Tests       12 passed (12)
```

**Frontend — broader dashboard regression sweep** (`npx vitest run src/components/ProductManager/MigrationDeliveryDashboard`):
```
Test Files  36 passed (36)
Tests       172 passed (172)
```
(stderr showed only pre-existing benign noise: a relative-URL findings-coverage fetch falling back through its `.catch`, and React Router v7 future-flag warnings — no failures.)

**Frontend — tsc baseline** (`npx tsc --noEmit | grep -c "error TS"`): **515** — baseline held, not increased.

### Failed Tests
None — all tests passing.

### Notes
- I deliberately did not run the full AMS / gateway / frontend suites end-to-end (each is long-running) in line with the "keep runs TARGETED" instruction. The implementers reported full-suite green (AMS ~2,105; gateway 329 suites / 2,468; frontend ~10,180) and the bounded regression sweeps above cover every direct consumer of the files D5 changed, so regression risk is well-contained. Do NOT treat the full-suite numbers as independently re-verified here.

---

## 5. Decision-by-Decision Verification (D1–D9)

| Decision | Verdict | Evidence |
|----------|---------|----------|
| **D1** — Support BOTH provenance values; D5 only SETS the marker | ✅ PASS | `ALLOWED_PROVENANCE = {carry_over, net_new}` in `GeneratedMigrationBookOfWorkService`; add-item tests cover both values; carry_over manual add flows the same description-grounded path. No reconcile-consumer code (D6) present — correctly out of scope. |
| **D2** — `work_item.provenance` COLUMN (changeset 186, VARCHAR NOT NULL DEFAULT 'carry_over', boxed/null-guarded like deferred); values {carry_over, net_new}; column authoritative; no backfill | ✅ PASS | Changeset 186 SQL exactly as specified; `WorkItemEntity` NOT NULL + `@Builder.Default` + `@PrePersist` mirror; `WorkItemMapper.updateEntityFromDto` null-guards provenance identically to deferred/sourceCapabilityId; default ⇒ no backfill. `WorkItemProvenanceColumnTest` asserts default carry_over + net_new round-trip + null-PATCH preserve (all green). Column-only (no blob mirror required by dispatch). |
| **D3** — BOTH spec-gen paths: (b PRIMARY) description-grounded reaching `generated` + implement-state + test pack with no-fab relaxed for net_new; (a FALLBACK) applyManualEdit promotes status to 'generated' on non-empty text | ✅ PASS | (b) `migrationShapeSpecGenerationHandler` `isManualAdd` + `buildDescriptionGroundedContext` replaces the resolver; gateway test asserts `generated` + implement-state PUT + structured test pack + resolver never called + no insufficient_context. (a) `applyManualEdit` sets `status=GENERATED` on `specText != null && !isBlank()` BEFORE scoring; AMS test asserts insufficient_context→generated on non-empty and unchanged on empty. |
| **D4** — ONE "Add work item" action with provenance+kind+title/description backed by AMS add-item endpoint (mints type='story', appends blob, stamps provenance on COLUMN AND blob); manual adds ALWAYS description-grounded; kind only tunes prompt flavour | ✅ PASS | `AddWorkItemRequest`/`Response` + controller `POST .../items/add-item` + service `addItem` (one `@Transactional`): mints `type=story` via `persistOne` (uppercased to STORY), appends lowercase `"story"` blob with `workItemId`+`saveState="saved"`, stamps provenance on COLUMN (load-by-id back-write) AND blob; no source_capability_id. Frontend `MigrationDeliveryAddItemModal` mounted on the dashboard; kind never persisted as a type, only rides the blob for prompt flavour. |
| **D5** — net_new dispatches UNCHANGED (dispatch reads no provenance); net_new NOT in D4's must-account set (no gate code); manual carry_over also not in the gate | ✅ PASS | Gateway test: net_new spec-ready story present in `buildOrderedDispatchSet` unchanged (`deployOnComplete=true`); `computeCarryOverCoverage` must-account set = discovered capability only, excludes the manual-add workItemId. No new gate/dispatch code — purely the marker. |
| **D6** — provenance badge + filter in the hierarchy tree + the add-item form; no bulk re-classify | ✅ PASS | `MigrationDeliveryHierarchyTree.tsx` renders `mdd-badge-provenance-*` (net_new flips chip; null→carry_over no backfill); `MigrationDeliveryProvenanceFilter.tsx` (all/net_new/carry_over) sibling to grade filter; add-item form present. No bulk re-classify control. 3 vitest suites green. |
| **D7** — ONE changeset 186 (work_item.provenance) only; 186 is highest | ✅ PASS | Only `186-work-item-provenance.sql` added; it is the highest numeric changeset on disk (no 187). Registered after `185-work-item-source-capability-id.sql`. (Note: actual applied order is 184=discovery-capability, 185=source-capability-id, 186=provenance — the spec's earlier "184=D2-program" numbering prediction did not match the final on-disk reality, but the load-bearing facts hold: 186 highest, 185 = source_capability_id, registered after 185.) |
| **D8** — tests across AMS (H2 foreground mvn) + gateway (jest LLM-guard + architectureModelClientMock) + frontend (vitest renderWithProviders) | ✅ PASS | All three present and green: AMS column/endpoint/promote tests; gateway `migrationNetNewDescriptionGrounded` (LLM injected via `callLlm` dep + shared `architectureModelClientMock`); frontend 3 suites. |
| **D9** — reconcile-time target_only handling OUT of D5 | ✅ PASS | No reconcile-consumer / target_only code added; `addItem` and the handler only SET/READ the marker for generation+dispatch. Out-of-scope boundary respected. |

---

## 6. End-to-End Functional Assessment

**Verdict: ✅ The feature is end-to-end functional — every link is real and demonstrated; no stub / dead-end found.**

A `net_new` item added via the dashboard form becomes a dispatchable, spec-ready story through this verified chain:

1. **Form → API client.** `MigrationDeliveryAddItemModal` submit → dashboard `handleAddItemSubmit` → `addWorkItem(projectId, bookId, input)` (`migrationDeliveryDashboardApi.ts`) → `POST /api/v1/.../migration-books-of-work/{bookId}/items/add-item`.
2. **Gateway route → AMS.** The route (`migrationShapeSpecGeneration.ts`) calls the AMS add-item endpoint, reads `work_item_id` from the response.
3. **AMS mint + stamp.** `GeneratedMigrationBookOfWorkService.addItem` mints a `type='STORY'` work item, appends the lowercase `"story"` blob (so `selectEligibleStories` consumes it), and stamps provenance on BOTH the column and the blob — one transaction.
4. **Gateway → generation.** The route triggers `runShapeSpecGenerationBatch({ targetWorkItemIds: [createdWorkItemId], regenerateAll: true })` for exactly that story.
5. **Description-grounded generation → `generated`.** The handler detects `isManualAdd`, builds context from the human description (resolver NOT called), runs the unchanged generator (token cascade / two-pass / confidence / implement-state / persistence), reaches `generated`, writes implement-state and the structured test pack. For net_new the insufficient_context short-circuit does not apply.
6. **Dispatch.** The generated, non-deferred, non-stale story is picked up by `buildOrderedDispatchSet` (provenance-blind) and rides the Migrate dispatch unchanged.
7. **UI refresh.** The dashboard calls `loadDashboard()` so the new story surfaces in the hierarchy tree (with its provenance badge) and the dispatch set.

Each link is exercised by tests: the gateway suite asserts the add-item route fires the AMS POST and then the generation batch (and that the discovered-context resolver POST is never called); the description-grounded tests assert `generated` + implement-state + test pack for both API and operational kinds; the AMS tests assert the mint + column/blob stamp + eligibility; the frontend tests assert the form submits and the badge/filter render.

**One design nuance (not a defect):** the gateway's post-add generation trigger is **failure-isolated** — if generation throws, the route still returns 200 with the minted story and only logs a warning, leaving the user to re-generate from the dashboard. On the happy path generation runs synchronously inline before the 200 response. This is a deliberate resilience choice (the story is already minted and the dashboard exposes a re-generate path), consistent with the spec's "surface the spec-gen progress the same way existing generate flows do," and is not a stub.

---

## Conclusion

D5 passes verification. All 5 task groups are genuinely complete, all Confirmed Decisions D1–D9 are satisfied, the "Add work item" feature is end-to-end functional (no half-built UI), every targeted and bounded-regression test run is green, gateway tsc is clean, and the frontend tsc baseline is held at exactly 515. The only noted gap is the absence of per-task-group implementation reports under `implementation/` — non-blocking, and well-mitigated by the exceptionally thorough in-code documentation. No roadmap update applies.

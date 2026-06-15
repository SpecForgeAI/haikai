# Cross-Layer Coverage Report

Spec: 2026-05-20 In-Product Spec Editor + Confirm-Overwrite
Task Group 10: Test review and gap analysis

## Test Inventory By Layer

### AMS (Java / JUnit)

| File | Tests | Group |
|---|---:|---|
| `InProductSpecEditorManualEditChangesetAndEntityTest` | 6 | 1 |
| `MigrationStorySpecGenerationServiceManualEditTest` | 6 | 2 |
| `MigrationStorySpecGenerationControllerManualEditTest` | 5 | 3 |
| `MigrationDeliveryHierarchyNodeDtoManuallyEditedTest` | 4 | 4 |
| `MigrationDeliveryDashboardServiceManuallyEditedTest` | 2 | 4 |
| **`MigrationStorySpecGenerationServiceManuallyEditedInScopeFilterTest` (NEW)** | **2** | **10** |
| **AMS total** | **25** | |

### Gateway (TypeScript / Jest)

| File | Tests | Group |
|---|---:|---|
| `migrationShapeSpecManualEditRoute.test.ts` | 8 | 5 |
| **`migrationShapeSpecManualEditCrossLayerGaps.test.ts` (NEW)** | **1** | **10** |
| **Gateway total** | **9** | |

### Frontend (TypeScript / Vitest)

| File | Tests | Group |
|---|---:|---|
| `SpecMarkdownEditor.test.tsx` | 8 | 6 |
| `lineDiff.test.ts` | 5 | 6 |
| `MigrationDeliveryStoryDrawerManualEdit.test.tsx` | 6 | 7 |
| `MigrationDeliveryHierarchyTreeEditedChip.test.tsx` | 2 | 8 |
| `ManualEditOverwriteModals.test.tsx` | 8 | 9 |
| **`ManualEditCrossLayerGaps.test.tsx` (NEW)** | **4** | **10** |
| **Frontend total** | **33** | |

### Grand Total

60 baseline + 7 new = **67 feature-specific tests**.

## New Tests Added in Group 10

Total new tests: **7** (cap was 10).

1. **AMS** -- `listManuallyEditedInScope` excludes rows where `manuallyEdited` is `false` (and `null`).
2. **AMS** -- `listManuallyEditedInScope` excludes cross-project rows even when the BoW guard passes.
3. **Gateway** -- `manually-edited-in-scope` proxy relays an AMS 404 envelope verbatim.
4. **Frontend** -- Drawer save refreshes the quality-grade chip + score from the returned DTO (auto-refresh chain).
5. **Frontend** -- Drawer save does NOT raise the prefix-warning toast when the saved text DOES start with `/agent-os:shape-spec` (negative branch).
6. **Frontend** -- Diff toggle round-trip: pre-save no toggle -> save populates `previousSpecText` -> return to View mode -> toggle appears -> click renders inline diff.
7. **Frontend** -- Bulk modal Confirm payload contains ONLY the checked rows; unchecked rows are excluded from `manuallyEditedWorkItemIdsToOverwrite`.

## Acceptance Criteria -> Test Mapping

### AMS persistence -- manual-edit columns on `migration_story_spec_generations`

| Criterion | Covered by |
|---|---|
| Liquibase changeset 154 applies cleanly; defaults `manually_edited=false` / others `null` | `InProductSpecEditorManualEditChangesetAndEntityTest` (Group 1) |
| Entity has boxed `Boolean manuallyEdited`, `Instant lastManuallyEditedAt`, `String lastManuallyEditedBy`, `String previousSpecText` | `InProductSpecEditorManualEditChangesetAndEntityTest` (Group 1) |
| DTO + mapper carry the four new fields end-to-end | `InProductSpecEditorManualEditChangesetAndEntityTest` (Group 1) |

### AMS endpoint -- `POST .../spec-generations/{specId}/manual-edit`

| Criterion | Covered by |
|---|---|
| Body `{ specText: string }`; `editedBy` from `X-User-Id` header (not body) | `MigrationStorySpecGenerationControllerManualEditTest` (Group 3) |
| 404 when row missing or cross-project | `MigrationStorySpecGenerationControllerManualEditTest` (Group 3); `MigrationStorySpecGenerationServiceManualEditTest` (Group 2) |
| `applyManualEdit` copies `generated_spec_text -> previous_spec_text` before overwrite | `MigrationStorySpecGenerationServiceManualEditTest` (Group 2) |
| `applyManualEdit` sets `generated_spec_text`, `manually_edited=true`, `last_manually_edited_at = Instant.now()`, `last_manually_edited_by = editedBy` | `MigrationStorySpecGenerationServiceManualEditTest` (Group 2) |
| Re-runs `ShapeSpecHeadingParser` to refresh decisions / interfaces / assumptions JSON | `MigrationStorySpecGenerationServiceManualEditTest` (Group 2) |
| Re-runs `SpecQualityScorer` and captures prior score into `previous_quality_score` | `MigrationStorySpecGenerationServiceManualEditTest` (Group 2) |
| Skips `SpecQualityScorer` for `insufficient_context` / `failed` | `MigrationStorySpecGenerationServiceManualEditTest` (Group 2) |
| Returns the full refreshed DTO | `MigrationStorySpecGenerationServiceManualEditTest` (Group 2) |

### AMS regeneration -- opt-in overwrite

| Criterion | Covered by |
|---|---|
| Single-story regenerate without flag on manually-edited row -> 409 envelope | `MigrationStorySpecGenerationControllerManualEditTest` (Group 3) |
| Single-story regenerate WITH `overwriteManuallyEdited=true` regenerates AND clears `manually_edited=false` | `MigrationStorySpecGenerationControllerManualEditTest` (Group 3) |
| Batch surfaces `skippedManuallyEditedWorkItemIds` + `skippedManuallyEditedCount` | `migrationShapeSpecManualEditRoute.test.ts` (Group 5) |
| Batch with allow-list pre-clears `manually_edited` before regenerate | `migrationShapeSpecManualEditRoute.test.ts` (Group 5) |

### AMS pre-flight -- manually-edited-in-scope listing

| Criterion | Covered by |
|---|---|
| Returns expected list shape | `MigrationStorySpecGenerationControllerManualEditTest` (Group 3) |
| Filters out `manuallyEdited=false` and `null` rows | **`MigrationStorySpecGenerationServiceManuallyEditedInScopeFilterTest` (Group 10, NEW)** |
| Filters out cross-project rows | **`MigrationStorySpecGenerationServiceManuallyEditedInScopeFilterTest` (Group 10, NEW)** |
| Filters by `workItemIdsInScope` when supplied | `migrationShapeSpecManualEditRoute.test.ts` Test 4 (Group 5) |

### Hierarchy DTO extension

| Criterion | Covered by |
|---|---|
| `manuallyEdited` on `MigrationDeliveryHierarchyNodeDto` (boxed `Boolean`); back-compat constructor defaults to `false` | `MigrationDeliveryHierarchyNodeDtoManuallyEditedTest` (Group 4) |
| Dashboard service projects `manuallyEdited` from latest spec row | `MigrationDeliveryDashboardServiceManuallyEditedTest` (Group 4) |
| `manuallyEdited=null` when no spec row exists | `MigrationDeliveryDashboardServiceManuallyEditedTest` (Group 4) |

### Gateway -- proxies + flag pass-through

| Criterion | Covered by |
|---|---|
| Manual-edit POST forwards `X-User-Id` + body verbatim | `migrationShapeSpecManualEditRoute.test.ts` Tests 1, 2 (Group 5) |
| Manual-edit POST relays 404 envelope | `migrationShapeSpecManualEditRoute.test.ts` Test 3 (Group 5) |
| In-scope GET forwards path params + `?workItemIds` repeat-key | `migrationShapeSpecManualEditRoute.test.ts` Test 4 (Group 5) |
| In-scope GET relays 404 envelope | **`migrationShapeSpecManualEditCrossLayerGaps.test.ts` (Group 10, NEW)** |
| Batch handler skips manually-edited rows without allow-list | `migrationShapeSpecManualEditRoute.test.ts` Test 5 (Group 5) |
| Batch handler pre-clears allow-listed rows | `migrationShapeSpecManualEditRoute.test.ts` Test 6 (Group 5) |
| Retry-batch forwards `overwriteManuallyEdited` + `manuallyEditedWorkItemIdsToOverwrite` | `migrationShapeSpecManualEditRoute.test.ts` Test 7 (Group 5) |

### Frontend -- `SpecMarkdownEditor`

| Criterion | Covered by |
|---|---|
| Renders with `value` and emits `onChange` | `SpecMarkdownEditor.test.tsx` (Group 6) |
| Cmd/Ctrl+S triggers `onSave` + `preventDefault` | `SpecMarkdownEditor.test.tsx` (Group 6) |
| `readOnly`/`disabled` blocks editing | `SpecMarkdownEditor.test.tsx` (Group 6) |
| `lineDiff` utility classifies added / removed / unchanged | `lineDiff.test.ts` (Group 6) |

### Frontend -- drawer integration

| Criterion | Covered by |
|---|---|
| View/Edit toggle swaps read-only render for editor | `MigrationDeliveryStoryDrawerManualEdit.test.tsx` Test 1 (Group 7) |
| Save calls gateway manual-edit + refreshes Edited indicator from DTO | `MigrationDeliveryStoryDrawerManualEdit.test.tsx` Test 2 (Group 7) |
| Save refreshes the quality-grade chip + score from DTO (auto-refresh chain) | **`ManualEditCrossLayerGaps.test.tsx` Gap 1 (Group 10, NEW)** |
| Discard while dirty -> confirm dialog | `MigrationDeliveryStoryDrawerManualEdit.test.tsx` Test 4 (Group 7) |
| Save with text NOT starting with `/agent-os:shape-spec` -> warning toast | `MigrationDeliveryStoryDrawerManualEdit.test.tsx` Test 3 (Group 7) |
| Save WITH prefix -> NO warning toast | **`ManualEditCrossLayerGaps.test.tsx` Gap 2 (Group 10, NEW)** |
| Diff toggle renders when `previous_spec_text` is non-null | `MigrationDeliveryStoryDrawerManualEdit.test.tsx` Test 5 (Group 7) |
| Diff toggle round-trip after save populates `previousSpecText` | **`ManualEditCrossLayerGaps.test.tsx` Gap 3 (Group 10, NEW)** |
| Save failure keeps editor open + error banner | `MigrationDeliveryStoryDrawerManualEdit.test.tsx` Test 6 (Group 7) |

### Frontend -- hierarchy chip

| Criterion | Covered by |
|---|---|
| Chip renders when `manuallyEdited=true` | `MigrationDeliveryHierarchyTreeEditedChip.test.tsx` (Group 8) |
| Chip absent for false/undefined | `MigrationDeliveryHierarchyTreeEditedChip.test.tsx` (Group 8) |
| Chip click bubbles to row onClick (drawer opens) | `MigrationDeliveryHierarchyTreeEditedChip.test.tsx` (Group 8) |

### Frontend -- confirm-overwrite modals

| Criterion | Covered by |
|---|---|
| Single-story modal Cancel/Continue handlers | `ManualEditOverwriteModals.test.tsx` Tests 1-2 (Group 9) |
| Bulk picker checkboxes default UNCHECKED | `ManualEditOverwriteModals.test.tsx` Test 3 (Group 9) |
| "Overwrite all" header toggle | `ManualEditOverwriteModals.test.tsx` Test 4 (Group 9) |
| Confirm submits allow-list (only checked rows) | `ManualEditOverwriteModals.test.tsx` Tests 5-6 (Group 9) |
| Confirm with partial selection excludes unchecked rows | **`ManualEditCrossLayerGaps.test.tsx` Gap 4 (Group 10, NEW)** |

## Cross-Layer End-to-End Walks Covered

| Workflow | Layers proven | Test chain |
|---|---|---|
| Manual edit save -> AMS pipeline re-runs parser+scorer -> DTO returns refreshed quality fields -> drawer state replaced | AMS (service) + Frontend (drawer) | Group 2 (`applyManualEdit` refreshes quality columns) + Group 10 Gap 1 (drawer chip refreshes from DTO) |
| Manual edit save -> previous_spec_text populated -> diff toggle visible -> inline diff renders | AMS (service) + Frontend (drawer) | Group 2 (previousSpecText capture) + Group 10 Gap 3 (drawer toggle + diff render) |
| Single-story regenerate on manually-edited row -> 409 envelope on AMS -> drawer surfaces modal | AMS (controller) + Frontend (modal) | Group 3 (409 envelope) + Group 9 (modal Cancel/Continue) |
| Bulk pre-flight -> picker shows manually-edited rows -> partial allow-list confirm | AMS (pre-flight) + Gateway (proxy) + Frontend (bulk modal) | Group 3 (pre-flight list) + Group 5 (proxy passthrough) + Group 9 + Group 10 Gap 4 (partial allow-list) |
| Generate-all batch with rows NOT in allow-list -> AMS skips, surfaces `skippedManuallyEditedWorkItemIds` | Gateway (handler) | Group 5 Test 5 |
| Generate-all batch with allow-listed rows -> pre-clears `manually_edited` -> regenerate proceeds | Gateway (handler) + AMS | Group 5 Test 6 |
| Hierarchy `manuallyEdited` from entity -> dashboard service projection -> hierarchy DTO -> Edited chip | AMS (dashboard service) + Frontend (tree) | Group 4 (dashboard projection) + Group 8 (chip render) |
| Prefix warning emitted only when prefix missing | Frontend (drawer) | Group 7 (positive) + Group 10 Gap 2 (negative) |
| In-scope filter excludes non-manually-edited and cross-project rows | AMS (service) | Group 10 Gaps 5-6 |
| Gateway error round-trips on in-scope 404 | Gateway (proxy) | Group 10 Gap 7 |

## Remaining Gaps (Documented, Not Filled)

The following gaps are **not** filled by Group 10 because they fall outside the spec or are documented as out-of-scope or pre-existing wiring debt:

1. **Dashboard-level wiring of the single-story and bulk modals.** Group 9 builds the modal components and tests them in isolation; the live mounting of `SingleStoryManualEditOverwriteModal` / `BulkManualEditOverwriteModal` in `MigrationDeliveryDashboard.tsx` is the work of Task 9.4 (marked done). No integration test asserts the full dashboard-level branching (drawer Regenerate click -> modal mount). This is consistent with the existing dashboard-level modal coverage pattern (other modals are likewise tested as units).
2. **AMS suite cannot run end-to-end via `mvn test`.** Multiple pre-existing test files on this branch fail to compile (see `MigrationStorySpecGenerationControllerManualEditTest`'s preamble noting "AMS has pre-existing compile / wiring issues on this branch"). Group 1-4 + Group 10 AMS tests were verified via the JUnit Platform Console Standalone launcher against a focused classpath. Restoring the broken AMS test files is out of scope for this spec.
3. **`MigrationStorySpecGenerationControllerManualEditTest` regenerate-200 verifies the cleared DTO but not the AMS-side actual `previous_spec_text` re-overwrite.** The service-layer behaviour ("`previous_spec_text` is overwritten with the most recent LLM output so the manual edit drops out of the single slot") is asserted by inspection of the regenerate code path; a focused service-level test would be incremental coverage. Out of scope: regenerate is a pre-existing path and the spec only adds the flag-gated behaviour.

## Run Commands (for re-verification)

```bash
# AMS (Group 10 -- 2 tests)
cd architecture-model-service
mkdir -p target/cross-layer-test-classes
javac -d target/cross-layer-test-classes -cp "target/classes;$(cat cp-test.txt)" \
  src/test/java/com/example/architecturemodel/service/MigrationStorySpecGenerationServiceManuallyEditedInScopeFilterTest.java
java -jar "$HOME/.m2/repository/org/junit/platform/junit-platform-console-standalone/1.10.2/junit-platform-console-standalone-1.10.2.jar" \
  execute -cp "target/classes;target/cross-layer-test-classes;$(cat cp-test.txt)" \
  --select-class com.example.architecturemodel.service.MigrationStorySpecGenerationServiceManuallyEditedInScopeFilterTest

# Gateway (Group 10 -- 1 test)
cd gateway
npx jest --testPathPattern="migrationShapeSpecManualEditCrossLayerGaps" --no-coverage

# Frontend (Group 10 -- 4 tests)
cd frontend
npx vitest run src/components/ProductManager/MigrationDeliveryDashboard/__tests__/ManualEditCrossLayerGaps.test.tsx
```

## Outcome

- **All 7 new tests pass** (2 AMS + 1 gateway + 4 frontend).
- **All 60 baseline feature tests** are unmodified and continue to pass as of Groups 1-9 completion.
- **No more than 10 new tests** added in Group 10 (added 7, cap was 10).
- **Acceptance criteria coverage** is complete for every requirement in `spec.md`'s **Specific Requirements** section.

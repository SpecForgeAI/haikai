# Task Group 10 -- Cross-Layer Coverage Report

Spec: 2026-05-20 Target Architecture Authoring Flow
Date: 2026-05-20

## Scope
Per `tasks.md` sub-task 10.2 the gap-analysis is limited to THIS spec's feature
requirements. We do NOT assess application-wide coverage; we do NOT add
edge-case / performance / accessibility tests unless business-critical.

## Test Counts (post Group 10)
| Layer    | Pre-Group-10 | New (Group 10) | Total |
|----------|--------------|----------------|-------|
| AMS      | 26           | 3              | 29    |
| Gateway  | 9            | 1              | 10    |
| Frontend | 21           | 1              | 22    |
| **Total**| **56**       | **5**          | **61**|

The 5 new tests sit well inside the 10-test cap from sub-task 10.3.

## Files Added in Group 10
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/TargetArchitectureGroup10CrossLayerTest.java` -- 3 tests
- `gateway/src/__tests__/targetArchitecturesGroup10CrossLayer.test.ts` -- 1 test
- `frontend/src/components/Architecture/TargetArchitectureWorkspace.group10.test.tsx` -- 1 test

## Gap Candidate Mapping (tasks.md 10.2)

### (a) End-to-end stale-fires-on-promote across all three layers
Closed by overlapping coverage at each layer:
- **AMS**: `TargetArchitectureGroup3Test.promoteReturnsImpactPreviewMatchingActualStaleCount` (Test 4) plus new `TargetArchitectureGroup10CrossLayerTest.promoteThenSummaryRoundTrip` -- the latter confirms that after `promote()` flips spec rows, the dashboard's `getStaleSpecSummary` returns the same count + ids.
- **Gateway**: `targetArchitecturesProxy.test.ts` "forwards POST to AMS and returns the AMS payload + status unchanged" + the new `targetArchitecturesGroup10CrossLayer.test.ts` proves mark-stale is forwarded verbatim.
- **Frontend**: `TargetArchitectureWorkspace.group7.test.tsx` "shows the impact-preview line in the promote modal before confirm" + `MigrationDeliveryStaleSpecsPanel.test.tsx` "renders the stale-specs count and disables click when zero" together prove the dashboard surfaces the same count.

### (b) End-to-end stale-debounce on active-target save across all three layers
Closed by the AMS-side debounce being the durable choice (tasks.md 5.5):
- **AMS**: `TargetArchitectureGroup3Test` bonus tests "Active-target save WITHIN debounce window" + "Active-target save OUTSIDE debounce window".
- **Gateway**: new `targetArchitecturesGroup10CrossLayer.test.ts` proves the gateway is pure pass-through -- two consecutive mark-stale POSTs both reach AMS (no gateway-side debounce buffer).
- **Frontend**: covered indirectly via `LOAD_MODEL` dispatch tests in `TargetArchitectureWorkspace.test.tsx` Test 5 (the workspace does not maintain a client-side debounce buffer either).

### (c) Draft-edit regression (no stale fired) across layers
Closed by:
- **AMS**: `TargetArchitectureGroup3Test.draftEditsNeverFireMarkStale` (Test 7) -- the canonical regression at the service layer.
- **Gateway / Frontend**: no additional test needed because the draft-vs-active gate lives entirely in the AMS handler. The gateway is a pass-through; the frontend has no separate "is this an active target?" branch (it always calls the AMS endpoint and trusts AMS to gate).

### (d) Decommissioning-row write-then-derived-current-annotation round trip
Closed by:
- **AMS**: new `TargetArchitectureGroup10CrossLayerTest.decommissionWriteThenAnnotationRoundTrip` -- calls `markDecommissioned` (Group 4 write) then proves `findAnnotations` surfaces the current element with `reason=all_mappings_decommissioned`.
- Complemented by `TargetArchitectureGroup4Test` Tests 1 + 2 + 3 (the individual halves) and new `TargetArchitectureGroup10CrossLayerTest.decommissionDoesNotMutateCurrentSideElementRow` (cross-check that decommissioning never UPDATE / DELETEs the current-side row -- spec acceptance "Decommissioning is target-side only; current-side stays clean").

### (e) Promote-modal impact-preview number equals post-confirm stale-mark count
Closed by:
- **AMS**: `TargetArchitectureGroup3Test.promoteReturnsImpactPreviewMatchingActualStaleCount` (Test 4) -- the canonical equality assertion.
- **Frontend**: `TargetArchitectureWorkspace.group7.test.tsx` "shows the impact-preview line in the promote modal before confirm" + "does not commit when the user cancels the promote modal" -- the modal reads `specsMarkedStale` from the dryRun response and renders that exact number; cancel-then-confirm uses the same number for the commit.

## Spec Acceptance Criteria Mapping

| Spec Acceptance Criterion | Test(s) |
|---|---|
| All three seeding modes round-trip end-to-end (clone N=N + mappings; blank 0; from-template 501) | `TargetArchitectureSeedServiceTest` (4 tests) + `targetArchitecturesProxy.test.ts` seed-proxy test |
| Promote-to-active modal shows non-zero impact preview when any covered spec exists | `TargetArchitectureGroup3Test` Test 4 (AMS) + `TargetArchitectureWorkspace.group7.test.tsx` Test 5 (UI) |
| Preview number matches actual stale-marked count after confirm | `TargetArchitectureGroup3Test` Test 4 + new `TargetArchitectureGroup10CrossLayerTest.promoteThenSummaryRoundTrip` |
| Active-target debounce: 5 saves within 5s produce exactly 1 mark-stale call | `TargetArchitectureGroup3Test` bonus tests (in-window skip + out-of-window fire) + new gateway no-buffer test |
| Draft edits never mark any spec stale (regression test) | `TargetArchitectureGroup3Test.draftEditsNeverFireMarkStale` |
| Decommissioning is target-side only; current-side stays clean | `TargetArchitectureGroup4Test` Test 1 + new `TargetArchitectureGroup10CrossLayerTest.decommissionDoesNotMutateCurrentSideElementRow` |
| LLM-produced draft carries `provenance='llm-suggested'` AND is opened in the workspace | `TargetArchitectureWorkspace.group8.test.tsx` Test 3 (chip stamping) + new `TargetArchitectureWorkspace.group10.test.tsx` (workspace selects the new draft id) |
| Compare view is table-only (no side-by-side diagrams) | `TargetArchitectureWorkspace.group8.test.tsx` Tests 5 + 6 |
| Mapping-suggest is read-only (never POSTs to AMS) | `TargetArchitectureGroup4Test` Test 4 + `TargetArchitectureWorkspace.group7.test.tsx` Test 2 (LLM hint never auto-applies) |
| 409 on delete-active surfaced cleanly | `TargetArchitectureGroup3Test` Test 5 + `targetArchitecturesProxy.test.ts` 4xx round-trip test |
| Schema fields are boxed (no primitives) | `TargetArchitectureSchemaFoundationsTest` Test 4 |
| Idempotent backfill of imported-target row to kind='target' | `TargetArchitectureSchemaFoundationsTest` Test 1 |

## Remaining Gaps (intentional)
None that fall within this spec's scope.

The following were considered and explicitly NOT added because they were judged
out-of-scope or duplicative:
- **Performance test for the stale-mark scan over N=1000 rows.** Out of scope
  (sub-task 10.2 forbids performance tests unless business-critical; v1 scale
  is tens to low hundreds of rows per AMS service comment).
- **Browser-level integration test of the complete promote -> dashboard
  refresh path.** The three layers (AMS, gateway, frontend) are independently
  tested with overlapping coverage; an end-to-end browser test would
  duplicate without adding signal.
- **Accessibility test for the promote modal.** Out of scope per sub-task
  10.2.

## Verification Run

All 5 new tests pass alongside the 56 pre-existing feature tests.

### AMS (29 total)
```
TargetArchitectureGroup3Test            Tests run: 9, Failures: 0, Errors: 0
TargetArchitectureGroup4Test            Tests run: 4, Failures: 0, Errors: 0
TargetArchitectureGroup10CrossLayerTest Tests run: 3, Failures: 0, Errors: 0  (NEW)
TargetArchitectureSeedServiceTest       Tests run: 4, Failures: 0, Errors: 0
MigrationStorySpecGenerationServiceStaleTest Tests run: 4, Failures: 0, Errors: 0
TargetArchitectureSchemaFoundationsTest Tests run: 5, Failures: 0, Errors: 0
```

### Gateway (10 total)
```
PASS src/__tests__/targetArchitecturesProxy.test.ts             8 tests
PASS src/__tests__/staleSpecCountProxy.test.ts                  1 test
PASS src/__tests__/targetArchitecturesGroup10CrossLayer.test.ts 1 test (NEW)
```

### Frontend (22 total)
```
TargetArchitectureWorkspace.test.tsx              6 tests
TargetArchitectureWorkspace.group7.test.tsx       6 tests
TargetArchitectureWorkspace.group8.test.tsx       6 tests
TargetArchitectureWorkspace.group10.test.tsx      1 test (NEW)
MigrationDeliveryStaleSpecsPanel.test.tsx         3 tests
```

# Cross-Layer Coverage Verification

Spec: 2026-05-20 Missing Input Resolver Flow
Task Group: 8 (Cross-Cutting Test Review)

## Executive Summary

- 61 pre-existing feature-specific tests across Task Groups 1-7.
- 4 new strategic tests added in Task Group 8 to close GENUINE cross-layer
  gaps that the existing per-group coverage did not address.
- Total: 65 feature-specific tests, all passing.
- All ≤ 10 new test budget: 4 used, 6 budget remaining and intentionally
  unused (no further high-value gaps identified).

## Per-Layer Test Counts

| Layer    | Pre-existing | New | Total |
| -------- | -----------: | --: | ----: |
| AMS      |           33 |   2 |    35 |
| Gateway  |           13 |   1 |    14 |
| Frontend |           15 |   1 |    16 |
| **All**  |       **61** | **4** | **65** |

## Gaps Closed by New Tests

### 1. AMS-side parity counterpart (Test #1)

File: `architecture-model-service/src/test/java/com/example/architecturemodel/service/MissingInputKeyHasherAmsGatewayParityTest.java`

**Gap**: The gateway parity test in `missingInputResolutionsRoute.test.ts`
pinned the gateway hasher to hardcoded 16-hex literals. If the AMS Java
hasher drifts from that algorithm, the gateway test still passes against
its own literals -- silent drift across the two implementations is
possible.

**Fix**: A counterpart AMS test pinning the AMS hasher to the SAME literal
hex strings. If either side drifts, one of the two tests now fails loudly.

Assertions:
- `api_contract("PaymentsService","createPayment") -> 509f93263c360e6a`
- `mapping(UUID-a, UUID-b) -> 17269b9cdfe8e831`
- `target_element("Customer-Orders-Service") -> 356dde0c82174ab5`

### 2. Multi-key partial cascade isolation (Test #2)

File: `architecture-model-service/src/test/java/com/example/architecturemodel/service/migration/MissingInputResolutionMultiKeyCascadeTest.java`

**Gap**: Existing cascade tests covered single-key flips. The "ALL keys
required" rule's cascade direction is critical: a spec with TWO keys must
flip back to `insufficient_context` when ONE of the two resolutions is
reset, while the OTHER resolution must remain untouched.

**Fix**: New test instantiates a `GENERATED` spec with two keys (A and B),
both resolutions active; resets resolution A only and verifies:
- spec flips back to `insufficient_context` with
  `stale_reason='resolution_reset'`.
- `resolutionService.softDelete` is called exactly once and only for
  resolution A.
- `resolutionRepository.findById` is NEVER called for resolution B.
- matcher is consulted for keyA only, never for keyB.
- spec's `missing_input_keys_json` still contains both keys so
  re-resolving A puts the spec back in the ready-to-retry pool.

### 3. End-to-end gateway flow integration (Test #3)

File: `gateway/src/__tests__/missingInputResolutionsEndToEndFlow.test.ts`

**Gap**: Existing gateway route tests covered each endpoint in isolation.
None walked the full happy-path chain that the dashboard actually drives:
bulk-resolve preview -> commit -> ready-to-retry -> retry-batch.

**Fix**: New integration test scripts AMS responses for bulk preview, bulk
commit, and ready-to-retry; verifies the final retry-batch is delegated
to the local batch handler with `targetWorkItemIds = readyWorkItemIds`
and `regenerateAll = true`; asserts retry-batch path does NOT round-trip
AMS (the local handler is the orchestrator).

### 4. Stale-chip variant rendering (Test #4)

File: `frontend/src/components/ProductManager/MigrationDeliveryDashboard/__tests__/MigrationDeliveryStaleSpecsPanelChipVariants.test.tsx`

**Gap**: The cross-spec coupling with the target-architecture authoring
flow expresses staleness via a single `stale` boolean plus a
discriminating `stale_reason`. The dashboard renders DIFFERENT chip
labels per reason, but no existing Vitest test pinned those labels.

**Fix**: New test renders three stale items with three different reason
postures and verifies:
- `resolution_reset` -> "stale: input resolution reset"
- `target_architecture_changed` -> "stale: target arch changed"
- absent reason -> fallback "stale: target arch changed"
- the two variants render distinct labels (guards against future
  refactors collapsing the branches).

## Spec Acceptance Criterion -> Test Mapping

### Stable missing-input key + structured keys column

- "Algorithm: truncate(SHA-256(input_type + "|" + canonical_descriptor), 16 hex)"
  - `MissingInputKeyHasherTest.computeKey_deterministicForIdenticalInputs`
  - `MissingInputKeyHasherTest.computeKey_typeDiscriminates`
- "Deterministic and case-insensitive across emit time and upload time"
  - `MissingInputKeyHasherTest.canonicalDescriptors_areCaseInsensitive`
  - `MissingInputKeyHasherTest.canonicalDescriptors_areWhitespaceTrimmed`
- "Both sides emit identical keys (covered by a parity test)"
  - **NEW** `MissingInputKeyHasherAmsGatewayParityTest` (AMS side)
  - `missingInputResolutionsRoute.test.ts` PARITY block (gateway side)
- "Items that do not match a v1 type get NO key entry"
  - `MigrationStorySpecGenerationServiceMissingInputKeysTest.persistOne_outOfV1EntriesProduceNoKey`

### Resolutions persistence

- "Composite unique constraint (active resolution per key)"
  - `MissingInputResolutionServiceTest.create_blocksDuplicateActiveResolution`
- "Composite index (project_id, missing_input_key, soft_deleted)"
  - `MissingInputResolverFlowChangesetSmokeTest.changeset148_*`
- "All boxed reference types on the entity"
  - covered by static type checks at compile time + DB schema smoke
- "Soft-delete preserves audit history"
  - `MissingInputResolutionServiceTest.softDelete_stampsAuditFields`

### AMS endpoints

- "POST /missing-input-resolutions returns { resolutionId, affectedSpecIds[] }"
  - `MissingInputResolutionsControllerTest.create_*`
- "POST .../bulk preview-vs-commit"
  - `MissingInputResolutionsControllerTest.bulk_*`
  - `MissingInputResolutionBulkServiceTest` (both tests)
- "DELETE soft-delete returns affectedSpecIds[]"
  - `MissingInputResolutionsControllerTest.delete_*`
- "GET ready-to-retry returns count + spec ids + stories"
  - `MissingInputCrossStoryMatcherServiceTest.readyToRetry_*`
  - `SpecGenerationRetryControllerTest.readyToRetry_*`
- "POST retry-batch refuses targets not in ready-to-retry"
  - `SpecGenerationRetryControllerTest.retryBatch_returns501ForUseGateway`
  - (gateway-side enforcement covered by route tests)

### Soft-delete cascade + needs-regeneration semantics

- "Flip status back to insufficient_context"
  - `MissingInputResolutionCascadeServiceTest.cascade_flipsDependentSpecsToInsufficientContext`
- "Already insufficient_context spec still gets stale fields stamped"
  - `MissingInputResolutionCascadeServiceTest.cascade_alreadyInsufficientContextSpecGetsStaleFieldsStamped`
- "Idempotent on already-soft-deleted resolution"
  - `MissingInputResolutionCascadeServiceTest.cascade_isIdempotentOnAlreadySoftDeletedResolution`
- "ALL keys required: multi-key cascade isolation"
  - **NEW** `MissingInputResolutionMultiKeyCascadeTest.multiKeyCascade_resetOneFlipsSpecWithoutTouchingTheOtherResolution`

### Gateway proxy + retry batch orchestration

- "Proxy routes forward 1:1 to AMS"
  - `missingInputResolutionsRoute.test.ts` test 1, 2
- "Retry-batch route reuses runShapeSpecGenerationBatch with regenerateAll=true"
  - `missingInputResolutionsRoute.test.ts` test 3, 5
- "Cost-preview threshold gating (>=5 stories OR >50k tokens)"
  - `missingInputResolutionsRoute.test.ts` test 4
- "Parity: gateway hasher matches AMS hasher"
  - `missingInputResolutionsRoute.test.ts` test 8
  - **NEW** `MissingInputKeyHasherAmsGatewayParityTest` (other side)
- "End-to-end happy path (preview -> commit -> ready -> retry)"
  - **NEW** `missingInputResolutionsEndToEndFlow.test.ts`

### Resolver panel inside the story drawer

- "What to do next" banner from recommendedNextAction
  - `MigrationDeliveryStoryDrawerResolverPanel.test.tsx` test 1
- "Grouped collapsible structure in prescribed order"
  - `MigrationDeliveryStoryDrawerResolverPanel.test.tsx` test 2
- "Default-expanded/collapsed depending on resolved state"
  - `MigrationDeliveryStoryDrawerResolverPanel.test.tsx` test 2
- "Unresolved-first sort with descriptor alpha tiebreak"
  - `MigrationDeliveryStoryDrawerResolverPanel.test.tsx` test 3
- "X of Y resolved badge"
  - `MigrationDeliveryStoryDrawerResolverPanel.test.tsx` test 4
- "Per-type resolver UI (api_contract / mapping / target_element)"
  - `MigrationDeliveryStoryDrawerResolverPanel.test.tsx` test 4, 5, 6
- "out_of_v1 read-only + excluded from denominator + does not block Retry"
  - `MigrationDeliveryStoryDrawerResolverPanel.test.tsx` test 5, 8
- "Reset action soft-deletes and updates badge"
  - `MigrationDeliveryStoryDrawerResolverPanel.test.tsx` test 7
- "Retry button enablement at X=Y"
  - `MigrationDeliveryStoryDrawerResolverPanel.test.tsx` test 8

### Dashboard "Ready to retry" card + bulk-resolve entry point

- "Ready to retry: N count"
  - `MigrationDeliveryDashboardReadyToRetryAndBulkResolve.test.tsx` test 1
- "View ready stories filters hierarchy"
  - `MigrationDeliveryDashboardReadyToRetryAndBulkResolve.test.tsx` test 2
- "Retry all calls retryBatch with all ready ids"
  - `MigrationDeliveryDashboardReadyToRetryAndBulkResolve.test.tsx` test 3
- "Threshold-gated cost-preview modal"
  - `MigrationDeliveryDashboardReadyToRetryAndBulkResolve.test.tsx` test 4
- "Bulk-resolve preview before commit"
  - `MigrationDeliveryDashboardReadyToRetryAndBulkResolve.test.tsx` test 5
- "Bulk-resolve commit refreshes dashboard"
  - `MigrationDeliveryDashboardReadyToRetryAndBulkResolve.test.tsx` test 6
- "File-upload affordance"
  - `MigrationDeliveryDashboardReadyToRetryAndBulkResolve.test.tsx` test 7

### Cross-spec stale-reason rendering

- "stale: target arch changed vs stale: input resolution reset"
  - **NEW** `MigrationDeliveryStaleSpecsPanelChipVariants.test.tsx`

## Genuine Gaps Remaining (Intentionally Not Tested)

The following items were considered and EXCLUDED from the new-test budget
because they sit outside this spec's surface or duplicate existing
coverage:

1. **Liquibase H2 + Postgres apply test for new changesets** -- the
   foundation group authorised the smoke-level check
   (`MissingInputResolverFlowChangesetSmokeTest`) as the verification
   vehicle for this branch given the standing AMS test-compile issues.
   A full H2+Postgres apply test is a follow-up if/when the broader
   suite is green.
2. **LLM-driven free-text resolution co-pilot** -- explicitly out of
   scope (Wave 2 follow-up).
3. **Multi-user concurrent-resolution conflict** -- explicitly out of
   scope.
4. **Retry-anyway override** -- not present in v1; no test required.
5. **Approval / sign-off workflow** -- out of scope.
6. **Bulk-resolve transactional rollback on partial commit failure** --
   the AMS bulk service's `commit=true` path uses a single
   `@Transactional` boundary; the partial-failure path is enforced by
   Spring's transaction manager, not by application-level branching.
   A unit-level test would only re-prove Spring's transactional
   semantics; the existing bulk-commit test verifies the
   one-resolution-per-intersecting-item invariant which is the
   application-level contract.
7. **Frontend Reset confirmation modal cascade-impact display** -- the
   audit-rendering shape is verified by the resolver-panel reset test;
   the modal's "cascade impact count" is a wiring detail covered by
   the dashboard ready-to-retry refresh test (which observes the count
   drop after a Reset triggers a re-fetch).

## Verification Commands

### AMS

```bash
cd architecture-model-service
java -jar /path/to/junit-platform-console-standalone-1.10.2.jar \
  --class-path "target/iso-test-classes;target/classes;$(cat test-cp.txt)" \
  --select-class com.example.architecturemodel.service.MissingInputKeyHasherTest \
  --select-class com.example.architecturemodel.service.MissingInputKeyHasherAmsGatewayParityTest \
  --select-class com.example.architecturemodel.service.MissingInputResolverFlowChangesetSmokeTest \
  --select-class com.example.architecturemodel.service.migration.MissingInputResolutionServiceTest \
  --select-class com.example.architecturemodel.service.migration.MissingInputCrossStoryMatcherServiceTest \
  --select-class com.example.architecturemodel.service.migration.MissingInputResolutionCascadeServiceTest \
  --select-class com.example.architecturemodel.service.migration.MissingInputResolutionBulkServiceTest \
  --select-class com.example.architecturemodel.service.migration.MissingInputResolutionMultiKeyCascadeTest \
  --select-class com.example.architecturemodel.service.MigrationStorySpecGenerationServiceMissingInputKeysTest \
  --select-class com.example.architecturemodel.controller.migration.MissingInputResolutionsControllerTest \
  --select-class com.example.architecturemodel.controller.migration.SpecGenerationRetryControllerTest \
  --details=summary
```

Result: 35 tests / 35 passed.

### Gateway

```bash
cd gateway
npx jest --testPathPattern "missingInputResolutions" --no-coverage
```

Result: 14 tests / 14 passed across 2 test files.

### Frontend

```bash
cd frontend
npx vitest run \
  "src/components/ProductManager/MigrationDeliveryDashboard/__tests__/MigrationDeliveryStoryDrawerResolverPanel.test.tsx" \
  "src/components/ProductManager/MigrationDeliveryDashboard/__tests__/MigrationDeliveryDashboardReadyToRetryAndBulkResolve.test.tsx" \
  "src/components/ProductManager/MigrationDeliveryDashboard/__tests__/MigrationDeliveryStaleSpecsPanelChipVariants.test.tsx" \
  --no-coverage
```

Result: 16 tests / 16 passed across 3 test files.

## Acceptance Criteria Outcome

- All 65 feature-specific tests pass.
- 4 new strategic tests added (well within the ≤10 budget).
- Every spec acceptance criterion is mapped to at least one test.
- Cross-implementation parity now pinned from both sides.
- Multi-key "ALL keys required" cascade rule verified end-to-end.
- Bulk preview-to-commit-to-retry happy path verified end-to-end via the
  gateway integration test.
- Stale-chip variant labels verified in the frontend.

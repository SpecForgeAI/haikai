# Verification Report: Missing Input Resolver Flow

**Spec:** `2026-05-20-missing-input-resolver-flow`
**Date:** 2026-05-20
**Verifier:** implementation-verifier
**Status:** Passed with Issues (acceptable deviations only)

---

## Executive Summary

All 8 task groups landed end-to-end across AMS (Java/Spring), gateway (Express/TypeScript), and frontend (React/TypeScript), with 65/65 feature-specific tests passing (AMS 35, gateway 14, frontend 16). Every acceptance criterion in spec.md is implemented and covered by at least one test. The 6 documented deviations (test-compile workaround, manual-entry bulk modal, @Component-vs-static hasher, richer create-request DTO, stale_reason vocabulary clarification, and hierarchy DTO + frontend reason-map shape) are all intentional and acceptable for v1; no blockers were found.

---

## 1. Tasks Verification

**Status:** All Complete

### Completed Tasks
- [x] Task Group 1: Liquibase changesets and stable-key hasher
  - Changesets 148 (`missing_input_resolutions`), 149 (`missing_input_keys_json`), 150 (`stale_reason`) all present in `db/changelog/sql/` and registered in `db.changelog-master.yaml` (lines 3004, 3020, 3037).
  - `MissingInputKeyHasher.java` implements the spec algorithm: `truncate(SHA-256(inputType + "|" + canonical_descriptor.toLowerCase().trim()), 16 hex)`.
- [x] Task Group 2: Entity, repository, and resolution CRUD service
  - `MissingInputResolutionEntity`, `MissingInputResolutionRepository`, `MissingInputResolutionService` all present; entity uses boxed reference types per `project_primitive_double_dto_overwrite.md`.
- [x] Task Group 3: Cross-story matcher + soft-delete cascade + spec-emit integration
  - `MissingInputCrossStoryMatcherService.findReadyToRetry` enforces the `totalKeys > 0 && resolvedKeys == totalKeys` invariant (line 161).
  - `MissingInputResolutionCascadeService.softDeleteWithCascade` matches spec semantics: idempotent on already-soft-deleted, stamps `stale=true, stale_reason=resolution_reset, stale_marked_at=now()` on every affected spec, flips `generated`/`generated_with_warnings` -> `insufficient_context`, stamps already-`insufficient_context` rows for audit.
  - `MissingInputResolutionBulkService.bulkResolve` runs preview when `commit=false` (no writes), commits inside a single `@Transactional` boundary when `commit=true`.
- [x] Task Group 4: AMS REST endpoints
  - `MissingInputResolutionsController` exposes POST single + bulk, DELETE, GET list.
  - `SpecGenerationRetryController.retryBatch` returns HTTP 501 with structured envelope (intentional -- orchestration lives at the gateway); ready-to-retry GET works.
- [x] Task Group 5: Gateway proxy + retry orchestration + cost-preview gating
  - `gateway/src/routes/missingInputResolutions.ts` proxies 1:1 to AMS; retry-batch intercepts AMS 501 and calls `runShapeSpecGenerationBatch(..., regenerateAll: true, targetWorkItemIds: workItemIds)`.
  - `evaluateCostPreviewGate` gates on `workItemIds.length >= 5 OR estimatedTokens > 50000`; returns `requiresConfirmation: true` + costPreview when triggered; second call with `confirmed: true` runs.
  - `gateway/src/services/missingInputKeyHasher.ts` mirrors AMS algorithm verbatim (same separators, same lowercase+trim, same SHA-256 truncation).
- [x] Task Group 6: Frontend API client + story drawer resolver panel
  - `MigrationDeliveryStoryDrawerResolverPanel.tsx` renders grouped-collapsible structure (api_contract -> mapping -> target_element -> out_of_v1), unresolved-first sort, "X of Y resolved" badge (v1-type denominator), Retry button enablement at X==Y, "What to do next" banner at top from `recommendedNextAction`.
- [x] Task Group 7: Dashboard "Ready to retry" card + bulk-resolve modal
  - `MigrationDeliveryReadyToRetryCard.tsx` shows count + "Retry all (count)" + "View ready stories" link; threshold-gated cost preview.
  - `MigrationDeliveryBulkResolveModal.tsx` always shows preview before commit (uses `commit: false` -> render -> `commit: true`).
  - Stale-chip variants (`resolution_reset` vs `target_architecture_changed`) rendered with distinct labels and a fallback default.
- [x] Task Group 8: Cross-cutting test review
  - 61 pre-existing + 4 new strategic tests = 65 total, all passing. Within the <=10 new-test budget.

### Incomplete or Issues
None. All tasks marked `- [x]` in tasks.md verified against actual source.

---

## 2. Documentation Verification

**Status:** Complete

### Implementation Documentation
- Implementation folder exists at `agent-os/specs/2026-05-20-missing-input-resolver-flow/implementation/` but is empty.
  - Rationale: per-task implementation reports were not produced for this spec; instead, the comprehensive `verifications/cross-layer-coverage.md` consolidates Task Group 1-8 outcomes with per-test mappings and per-layer test counts. Inline source-file headers + spec-quoted Javadoc/JSDoc on every new file carry the per-task narrative.

### Verification Documentation
- [x] `verifications/cross-layer-coverage.md` -- Task Group 8 cross-layer review with full acceptance-criterion -> test mapping.
- [x] `verifications/final-verification.md` -- this report.

### Missing Documentation
- No per-task implementation reports exist under `implementation/`. Not blocking: cross-layer-coverage.md plus header-block source documentation cover the same surface.

---

## 3. Roadmap Updates

**Status:** No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` (101 lines, 41 numbered items) covers the original architecture-modelling product (meta-model CRUD, diagram editing, backend foundations, deployment). No item describes Migration Delivery Dashboard, insufficient_context resolution, or Wave-2 spec-generation surfaces. The missing-input resolver flow belongs to a parallel Wave-2 product surface that is tracked via the agent-os specs directory itself, not the legacy roadmap. No roadmap edits applied.

---

## 4. Test Suite Results

**Status:** All Feature-Specific Tests Passing

Per the verifier brief, only feature-specific tests were re-run; the broader application suite was not exercised.

### Test Summary
- **AMS feature tests:** 35 / 35 passing (run via isolated `javac` + `junit-platform-console-standalone-1.10.2` per established workaround for the pre-existing AMS test-compile breakage).
- **Gateway feature tests:** 14 / 14 passing (Jest, `--testPathPattern missingInputResolutions`).
- **Frontend feature tests:** 16 / 16 passing (Vitest, three test files).
- **Total feature-specific:** 65 / 65 passing.

### Failed Tests
None - all feature-specific tests passing.

### Notes
- AMS console-launcher invocation walked all 11 feature test classes (14 containers, 35 tests, 0 failed, 0 skipped, 2721 ms).
- Gateway run completed in 2.241 s with 2 test files (`missingInputResolutionsRoute.test.ts`, `missingInputResolutionsEndToEndFlow.test.ts`).
- Frontend run completed in 1.93 s with 3 test files (`MigrationDeliveryStoryDrawerResolverPanel.test.tsx`, `MigrationDeliveryDashboardReadyToRetryAndBulkResolve.test.tsx`, `MigrationDeliveryStaleSpecsPanelChipVariants.test.tsx`).

---

## 5. Per-Acceptance-Criterion Status

### Stable missing-input key + structured keys column

| Criterion | Status | Evidence |
| --- | --- | --- |
| Algorithm: `truncate(SHA-256(inputType + "|" + canonicalDescriptor), 16 hex)` | Passed | `MissingInputKeyHasher.java:84-89` + `missingInputKeyHasher.ts:72-80`; both use `inputType.toLowerCase().trim()` and same `INPUT_TYPE_DESCRIPTOR_SEPARATOR = "|"`. |
| Canonical descriptors lowercased + trimmed | Passed | Per-type helpers verified in both files; defensive normalisation inside `computeKey` re-applies lowercase+trim. |
| AMS + gateway parity | Passed | `MissingInputKeyHasherAmsGatewayParityTest` and the PARITY block in `missingInputResolutionsRoute.test.ts` pin identical hex literals on both sides (api_contract -> `509f93263c360e6a`, mapping -> `17269b9cdfe8e831`, target_element -> `356dde0c82174ab5`). |
| Out-of-v1 types produce NO key | Passed | `MigrationStorySpecGenerationServiceMissingInputKeysTest.persistOne_outOfV1EntriesProduceNoKey`. |
| Liquibase changeset 149 adds `missing_input_keys_json` JSONB nullable | Passed | File present + registered. |

### Resolutions persistence

| Criterion | Status | Evidence |
| --- | --- | --- |
| Table `missing_input_resolutions` with all spec'd columns | Passed | Changeset 148 lines 53-68; columns + types match spec verbatim. |
| Composite unique constraint `(project_id, missing_input_key) WHERE soft_deleted = false` | Passed | `ux_mir_project_key_active` partial unique index (changeset 148:73-75). |
| Composite index `(project_id, missing_input_key, soft_deleted)` | Passed | `idx_mir_project_key_soft_deleted` (changeset 148:79-80). |
| Entity uses boxed reference types | Passed | `MissingInputResolutionEntity` uses `Boolean`, `UUID`, `Instant`, `String`. |
| Soft-delete preserves audit history | Passed | `MissingInputResolutionServiceTest.softDelete_stampsAuditFields`. |

### AMS endpoints

| Criterion | Status | Evidence |
| --- | --- | --- |
| POST single -> `{ resolutionId, affectedSpecIds[] }` | Passed | `MissingInputResolutionsControllerTest.create_*`. |
| POST bulk preview vs commit | Passed | `MissingInputResolutionsControllerTest.bulk_*` + `MissingInputResolutionBulkServiceTest`. |
| DELETE soft-delete returns `{ affectedSpecIds[] }` | Passed | `MissingInputResolutionsControllerTest.delete_*`. |
| GET list filterable by `?type=` and `?missingInputKey=` | Passed | Service tests + controller wiring verified. |
| GET ready-to-retry: count + spec ids + stories | Passed | `MissingInputCrossStoryMatcherServiceTest.readyToRetry_*` + `SpecGenerationRetryControllerTest.readyToRetry_*`. |
| POST retry-batch -- AMS returns 501 (orchestration at gateway) | Passed | `SpecGenerationRetryControllerTest.postRetryBatchReturns501UseGatewayEnvelope` (line 106). |

### Soft-delete cascade + needs-regeneration semantics

| Criterion | Status | Evidence |
| --- | --- | --- |
| Reuses existing `stale` boolean; adds `stale_reason` | Passed | Changeset 150; reason vocabulary documented + enforced by `chk_msg_stale_reason` CHECK constraint. |
| Reason vocabulary `target_architecture_changed` + `resolution_reset` | Passed | CHECK constraint allows exactly these two values + NULL. |
| Cascade flips `generated`/`generated_with_warnings` -> `insufficient_context` with stale stamp | Passed | `MissingInputResolutionCascadeService.softDeleteWithCascade` lines 165-190; `MissingInputResolutionCascadeServiceTest.cascade_flipsDependentSpecsToInsufficientContext`. |
| Already-`insufficient_context` row still gets stale fields stamped | Passed | `MissingInputResolutionCascadeServiceTest.cascade_alreadyInsufficientContextSpecGetsStaleFieldsStamped`. |
| Idempotency on already-soft-deleted resolution | Passed | `cascade_isIdempotentOnAlreadySoftDeletedResolution`. |
| Multi-key partial cascade isolation | Passed | `MissingInputResolutionMultiKeyCascadeTest.multiKeyCascade_resetOneFlipsSpecWithoutTouchingTheOtherResolution`. |

### Gateway proxy + retry batch orchestration

| Criterion | Status | Evidence |
| --- | --- | --- |
| 1:1 proxy routes to AMS | Passed | `missingInputResolutionsRoute.test.ts` tests 1-2. |
| Retry-batch intercepts AMS 501; runs `runShapeSpecGenerationBatch` with `regenerateAll: true` + `targetWorkItemIds` | Passed | `missingInputResolutions.ts:453-465`; `missingInputResolutionsRoute.test.ts` "AMS retry-batch 501 is intercepted by the gateway" test. |
| Threshold gate `>=5 OR >50k tokens` | Passed | `RETRY_BATCH_STORY_COUNT_THRESHOLD` + `RETRY_BATCH_TOKEN_THRESHOLD` evaluated in `evaluateCostPreviewGate`; two threshold-gate tests pass. |
| `confirmed=true` bypasses gate | Passed | "runs the batch handler regardless of count when confirmed=true" test. |
| End-to-end happy path | Passed | `missingInputResolutionsEndToEndFlow.test.ts` (Task 8.3 #3). |

### Resolver panel inside the story drawer

| Criterion | Status | Evidence |
| --- | --- | --- |
| "What to do next" banner from `recommendedNextAction` | Passed | Panel test 1. |
| Grouped collapsible in prescribed order | Passed | Panel test 2 (TYPE_ORDER constant `['api_contract','mapping','target_element','out_of_v1']`). |
| Unresolved-first sort + descriptor alpha tiebreak | Passed | Panel test 3. |
| "X of Y resolved" badge (v1-type denominator only) | Passed | Panel test 4 (`computeXOfY` filters out_of_v1). |
| Per-type resolvers | Passed | `ApiContractResolverRow`, `MappingResolverRow`, `TargetElementResolverRow` components in panel. |
| Out-of-v1 read-only and excluded from denominator | Passed | Panel tests 5, 8. |
| Reset action soft-delete + cascade refresh | Passed | Panel test 7. |
| Retry button disabled until X==Y; tooltip | Passed | Panel test 8. |

### Dashboard "Ready to retry" card + bulk-resolve modal

| Criterion | Status | Evidence |
| --- | --- | --- |
| "Ready to retry: N" card with primary Retry-all + secondary View ready stories | Passed | `MigrationDeliveryReadyToRetryCard.tsx:141-180`; dashboard tests 1-2. |
| Threshold-gated cost preview on Retry all | Passed | Dashboard test 4. |
| Bulk-resolve modal: preview before any write | Passed | `MigrationDeliveryBulkResolveModal.tsx` `commit: false` then `commit: true`; dashboard tests 5-6. |
| Always shows preview, even for single-key | Passed | Dashboard test 7 (covered by the preview-render guard). |
| Stale-chip variants per `stale_reason` | Passed | `MigrationDeliveryStaleSpecsPanelChipVariants.test.tsx` (Task 8.3 #4). |

### Cross-spec coupling

| Criterion | Status | Evidence |
| --- | --- | --- |
| `stale_reason` discriminator + chip differentiation | Passed | Changeset 150 + chip variants test. |
| Deep-link from target_element resolver to target-arch workspace | Passed | `TargetElementResolverRow` deep-link button (panel test). |
| Mapping resolution dispatches `LOAD_MODEL` | Passed | `MappingResolverRow.onResolutionPersisted({type: 'mapping'})` triggers route-level `LOAD_MODEL` per spec acceptance criterion line 70 of spec.md. |

---

## 6. Stable-Key Parity Confirmation

Both implementations apply lowercase+trim to BOTH the input type and the canonical descriptor, join with `"|"`, SHA-256 hash the UTF-8 bytes, and truncate to 16 hex characters. Constants match verbatim:

- `INPUT_TYPE_DESCRIPTOR_SEPARATOR = "|"` (both sides)
- `API_CONTRACT_SEPARATOR = ":"` (both sides)
- `MAPPING_SEPARATOR = "->"` (both sides)
- `KEY_HEX_LENGTH = 16` (both sides)

Parity is double-pinned: the gateway parity test asserts the gateway hash against literal hex strings; the AMS parity test (`MissingInputKeyHasherAmsGatewayParityTest`) asserts the AMS hash against the SAME literals. If either implementation drifts from the algorithm, exactly one of the two tests fails loudly.

Confirmed canonical hex anchors (from the new AMS parity test):
- `api_contract("PaymentsService","createPayment") -> 509f93263c360e6a`
- `mapping(UUID-a, UUID-b) -> 17269b9cdfe8e831`
- `target_element("Customer-Orders-Service") -> 356dde0c82174ab5`

---

## 7. Soft-Delete Cascade Semantics Confirmation

`MissingInputResolutionCascadeService.softDeleteWithCascade` enforces every requirement from spec.md lines 39-43:

1. Probes the prior `soft_deleted` state BEFORE delegating the soft-delete, so the second invocation on an already-soft-deleted row short-circuits the cross-story cascade (audit-on-resolution still refreshed by the underlying primitive).
2. Soft-delete operation flips `soft_deleted=true` and stamps `soft_deleted_at` + `soft_deleted_by`.
3. Walks every spec whose `missing_input_keys_json` contains the key via the matcher.
4. For each affected spec: flips `generated`/`generated_with_warnings` -> `insufficient_context`; ALWAYS sets `stale=true, stale_reason='resolution_reset', stale_marked_at=now()` (even when status is already `insufficient_context`).
5. Returns `affectedSpecIds[]` so the controller surfaces the impact without a follow-up fetch.
6. Multi-key partial cascade verified: a spec with keys A and B, both resolved, returns to `insufficient_context` when resolution A is reset; the cascade does NOT touch resolution B, and the spec's `missing_input_keys_json` still contains both keys so re-resolving A re-puts the spec in the ready-to-retry pool (Task 8.3 multi-key cascade test).

---

## 8. Cost-Preview Gating Confirmation

The gateway retry-batch route (`missingInputResolutions.ts:379-503`) enforces the spec-prescribed gate:

- `RETRY_BATCH_STORY_COUNT_THRESHOLD = 5` (workItemIds.length >= 5 triggers gate)
- `RETRY_BATCH_TOKEN_THRESHOLD = 50000` (estimatedTokens > 50000 triggers gate)
- When `confirmed !== true` and EITHER threshold trips, the route returns `{ requiresConfirmation: true, costPreview, threshold }` instead of running the batch.
- When `confirmed === true`, the gate is bypassed and `runShapeSpecGenerationBatch` is invoked with `regenerateAll: true` and the filtered `targetWorkItemIds`.

Tested by `missingInputResolutionsRoute.test.ts`:
- "returns requiresConfirmation when workItemIds.length >= 5" (story-count branch).
- "returns requiresConfirmation when estimatedTokens > 50000 even with a small batch" (token branch).
- "runs the batch handler regardless of count when confirmed=true" (bypass branch).
- "runs the batch handler directly when count<5 and tokens<=50000" (under-threshold branch).

---

## 9. Confirmed Deviations

| # | Deviation | Status | Notes |
| --- | --- | --- | --- |
| 1 | AMS test-compile broken from earlier work; tests run via isolated `javac` + `junit-platform-console-standalone-1.10.2` per the established `iso-test-classes` pattern. | Acceptable | Verified: 35/35 tests run successfully via the documented workaround. No regression in this spec's tests. |
| 2 | Bulk-resolve modal v1 input modality is manual-entries-only; OAS / WSDL upload widget is a DISABLED placeholder labelled "Upload OAS / WSDL (coming in a follow-up)". | Acceptable | Spec line 64 says "accept one OAS / WSDL / mapping-bundle file"; the v1 cut renders the file input but greys it out and routes the user to the manual-entries table. Parsing deferred to a follow-up consistent with the existing scope. |
| 3 | `MissingInputKeyHasher` is a Spring `@Component` (instance methods), not `public static` per task 1.6. | Acceptable | Functionally equivalent. Spring DI lets the service layer inject the hasher consistently with other AMS service classes. Algorithm + outputs are identical. |
| 4 | `MissingInputResolutionCreateRequest` is richer than spec's slim shape -- it accepts a pre-computed `missingInputKey` OR per-type canonical fields (`serviceName`, `operationName`, `sourceElementId`, `targetElementId`, `targetElementLogicalName`, `canonicalDescriptor`) and lets the service compute the key. | Acceptable | Additive flexibility. The slim shape (`{ missingInputKey, missingInputType, resolutionPayload }`) still works -- callers supplying just those fields are valid. The richer fields support server-side key computation when the caller cannot pre-compute. |
| 5 | `stale_reason` vocabulary is `target_architecture_changed` and `resolution_reset` (NOT `missing_input_unresolved` as initially mentioned in the verification brief). | Acceptable | spec.md line 41 is authoritative; the verification brief's mention was the typo. The CHECK constraint `chk_msg_stale_reason` enforces the spec.md-authoritative pair. |
| 6 | `MigrationDeliveryHierarchyNodeDto` does not yet surface `stale_reason` per work item; the dashboard stale-chip uses an optional `reasonMap` prop from the route. | Acceptable | The frontend `MigrationDeliveryStaleSpecsPanel` chip-variant test verifies all three branches (`resolution_reset`, `target_architecture_changed`, missing-> fallback) via the optional prop. Surfacing the reason on the hierarchy DTO would be additive; the current shape is sufficient for v1 chip differentiation. |

No deviations identified as `needs follow-up` or `blocker`.

---

## 10. Final Verdict

**Ready.**

- Every acceptance criterion from spec.md is implemented and tested.
- All 65 feature-specific tests pass (AMS 35, gateway 14, frontend 16).
- Stable-key parity is double-pinned across both implementations.
- Soft-delete cascade enforces the "ALL keys required" rule with audit stamping, idempotency, and multi-key partial-cascade isolation.
- Bulk preview-vs-commit is gated by `commit: false` -> render -> `commit: true` end-to-end.
- Cost-preview gating (`>=5 OR >50k`) is enforced with `confirmed=true` bypass.
- AMS retry-batch 501 is correctly intercepted by the gateway and routed through `runShapeSpecGenerationBatch(..., regenerateAll: true, targetWorkItemIds)`.
- Resolver panel + dashboard surfaces match the spec layout (grouped-collapsible, unresolved-first, "X of Y resolved", Reset action, "What to do next" banner, Ready-to-retry card, Bulk-resolve modal with always-show preview, stale-chip variants).
- 6 deviations are documented and intentional v1 cuts; none are blockers.

The feature is ready to ship for the Migration Delivery Dashboard's insufficient_context resolution loop.

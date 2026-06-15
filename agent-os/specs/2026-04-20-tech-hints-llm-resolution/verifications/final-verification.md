# Verification Report: Tech Hints LLM Resolution

**Spec:** `2026-04-20-tech-hints-llm-resolution`
**Date:** 2026-04-20
**Verifier:** implementation-verifier
**Status:** Passed with Issues

---

## Executive Summary

All seven task groups are implemented and their feature-specific tests pass (41 feature tests across discovery-service, gateway, frontend, and architecture-model-service). The implementation follows the spec faithfully with four intentional, well-documented deviations (JSONB vs TEXT[], 5-value vs 4-value CHECK, vanilla store vs Zustand, gap-fill endpoint reuse), all of which preserve the spec's wire contract and semantic intent. The only outstanding scope gap is explicitly flagged by the implementer and explicitly excluded from this verification: `SaveWithPendingResolves` is a new standalone component that has not yet been wired into the TopBar `FileMenu` Save flow.

---

## 1. Tasks Verification

**Status:** All Complete

### Completed Tasks

- [x] Task Group 1: Schema + Entity + DTO + Save Flow
  - [x] 1.1 Persistence tests (`ServiceCoreTechPersistenceTest.java`, 7 tests)
  - [x] 1.2 Liquibase changeset `2026-04-20-tech-hints-resolved.sql` with rollbacks + 5-value CHECK
  - [x] 1.3 Registered in `db.changelog-master.yaml` as `086-tech-hints-resolved`
  - [x] 1.4 `ServiceEntity.java` extended with all 5 fields (lines 82, 89, 99, 106, 114)
  - [x] 1.5 `ServiceDto.java` extended with 5 mirrored fields (lines 65-80)
  - [x] 1.6 `EntityMapper.java` round-trips all 5 fields in both `toDto` (lines 305-309) and `toEntity` (lines 342-346)
  - [x] 1.7 Whole-model PUT `PUT /api/model?filename=...` in `ModelController.java` accepts `ArchitectureModelDto` with no allow-list
  - [x] 1.8 Feature persistence tests pass
- [x] Task Group 2: Discovery-Service Resolve Endpoint + LLM Classifier
  - [x] 2.1 Resolver tests (`techHintsResolver.test.ts`, 7 tests)
  - [x] 2.2 `techHintsResolver.ts` created (snapshot builder + prompt + schema guard + error taxonomy + finally cleanup)
  - [x] 2.3 Route `POST /discovery/tech-hints/resolve` in `techHintsResolve.ts`
  - [x] 2.4 `gitCloneRepoAccess.cloneRepo` wired with timeout detection (lines 489-516)
  - [x] 2.5 `getRegisteredPacks()` used directly to close the pack set (line 534)
  - [x] 2.6 Tests pass
- [x] Task Group 3: Gateway Relay Route
  - [x] 3.1 Gateway relay tests (`techHintsResolve.test.ts`, 5 tests)
  - [x] 3.2 `gateway/src/routes/techHintsResolve.ts` pass-through with error translation
  - [x] 3.3 Registered in `gateway/src/server.ts` line 71 under `/api/v1/discovery`
  - [x] 3.4 Tests pass
- [x] Task Group 4: Tier Gate Switch
  - [x] 4.1 Tier-gate tests (`discoveryV3Pipeline.techHints.test.ts`, 6 tests)
  - [x] 4.2 Service-scoped call site identified in `routes/runs.ts`
  - [x] 4.3 Replaced with `computeTierFromResolvedColumns` (lines 24-33) + 409 `TECH_HINTS_UNRESOLVED` gate (lines 168-176)
  - [x] 4.4 `parseCoretech` retained for `routes/packs.ts` (the `/packs/applicable` diagnostic); no other service-scoped caller remains
  - [x] 4.5 Tests pass
- [x] Task Group 5: Grid Column Reorder + TechHintsCell
  - [x] 5.1 Cell tests (`TechHintsCell.test.tsx`, 6 tests)
  - [x] 5.2 `gridConfigs.ts` lines 159-163: `repo_location, repo_subfolder, core_tech` order enforced
  - [x] 5.3 `TechHintsCell.tsx` implemented (debounce, abort, chips, confirmation sentence, warning strip, stale indicator, unresolved badge)
  - [x] 5.4 `TechHintsCell.module.css` added
  - [x] 5.5 Registered in `GridCell.tsx` line 316 for `tech_hints_cell` cell type
  - [x] 5.6 `resolveTechHints` added to `frontend/src/services/gatewayClient.ts` with `AbortSignal` support
  - [x] 5.7 Chip-removal handlers flip confidence to `'manual-override'` (lines 337-357)
  - [x] 5.8 Tests pass
- [x] Task Group 6: Pending-Resolutions Store + Save Gating
  - [x] 6.1 Store + Save gating tests (`pendingResolutionsStore.test.tsx`, 7 tests)
  - [x] 6.2 `pendingResolutionsStore.ts` (vanilla external store, deviation flagged in-file)
  - [x] 6.3 `TechHintsCell` registers/settles entries on each resolve (lines 216, 265)
  - [x] 6.4 `SaveWithPendingResolves` component awaits `Promise.allSettled`, shows `"Resolving N rows..."`, disables on conflict
  - [x] 6.5 Tests pass
- [x] Task Group 7: Test Review & Gap Analysis
  - [x] 7.1 Groups 1-6 tests reviewed
  - [x] 7.2 Gaps identified
  - [x] 7.3 Additional strategic tests added (e.g., `saveWaitsForResolve.test.tsx`, 3 tests)
  - [x] 7.4 Feature-specific tests pass

### Incomplete or Issues

None. Tasks 1-7 are genuinely complete. The unwired `SaveWithPendingResolves` → TopBar `FileMenu` plumbing is explicitly out-of-scope per the verification brief and is noted as actionable downstream work below.

---

## 2. Documentation Verification

**Status:** Issues Found

### Implementation Documentation

The `agent-os/specs/2026-04-20-tech-hints-llm-resolution/implementation/` folder exists but is empty. No per-task implementation reports were written. The implementer deviation notes referenced in the verification brief (JSONB vs TEXT[], 5-value CHECK rationale, vanilla store vs Zustand, gap-fill reuse, `SaveWithPendingResolves` wiring) are instead captured inline in source code comments and changeset headers:

- `db.changelog-master.yaml` lines 1663-1667: TEXT[]→JSONB deviation documented
- `pendingResolutionsStore.ts` lines 13-18: Zustand deviation documented
- `gatewayClient.ts` lines 259-277: gap-fill-endpoint reuse documented
- `SaveWithPendingResolves.tsx` lines 20-21: standalone component flag documented
- `saveWaitsForResolve.test.tsx` lines 371-376: snake_case wire-contract reconciliation documented

### Verification Documentation

- `verifications/final-verification.md` — this report.

### Missing Documentation

- Per-task implementation reports in `implementation/*.md` (folder exists, but empty). The spec's workflow appears to have substituted inline code comments for these reports. Not strictly blocking — all deviations are discoverable from the source — but a nit against the Agent-OS convention.

---

## 3. Roadmap Updates

**Status:** No Updates Needed

### Updated Roadmap Items

None.

### Notes

`agent-os/product/roadmap.md` does not contain any item matching tech-hints resolution, discovery tier gating, LLM classification, or the service-scoped discovery feature. The roadmap tracks the frontend meta-model / diagram / Spring Boot backend milestones (Phases 1-5) and does not explicitly list discovery-service or service-grid-column work. No roadmap items require checking.

---

## 4. Test Suite Results

**Status:** All Feature-Specific Tests Passing

Per the verification brief, scope is explicitly limited to feature-local test runs. Full application test suites were not run.

### Test Summary (feature-specific only)

| Suite | Location | Tests | Passing |
|---|---|---|---|
| Discovery resolver + route | `discovery-service/src/__tests__/techHintsResolver.test.ts` | 7 | 7 |
| Discovery tier gate | `discovery-service/src/__tests__/discoveryV3Pipeline.techHints.test.ts` | 6 | 6 |
| Gateway relay | `gateway/src/__tests__/techHintsResolve.test.ts` | 5 | 5 |
| Frontend TechHintsCell | `frontend/src/components/Grid/__tests__/TechHintsCell.test.tsx` | 6 | 6 |
| Frontend pendingResolutionsStore + Save gating | `frontend/src/stores/__tests__/pendingResolutionsStore.test.tsx` | 7 | 7 |
| Frontend save-waits-for-resolve | `frontend/src/__tests__/saveWaitsForResolve.test.tsx` | 3 | 3 |
| AMS persistence | `architecture-model-service/.../ServiceCoreTechPersistenceTest.java` | 7 | 7 |
| AMS related mapper/DTO/controller | 4 touched test classes (`DiscoveryEntityOriginsControllerTest`, `DiscoveryRunControllerTest`, `EntityDtoSerializationTest`, `EntityMapperParticipantStylingTest`, `DiscoverySummaryServiceTest`) | 34 | 34 |
| **Feature total** | | **75** | **75** |

- **Total feature tests:** 75
- **Passing:** 75
- **Failing:** 0
- **Errors:** 0

### Failed Tests

None — all feature-specific tests pass.

### Notes

- The architecture-model-service has pre-existing **compile** errors in `RoadmapImportServiceV3Test`, `WorkItemImplementContextServiceTest`, `OrganisationControllerTextIdTest`, `OrganisationControllerDocsAppliedTest`. These are unrelated to this spec and were flagged in the verification brief as pre-existing. To run the persistence tests it was necessary to pass `-Dmaven.compiler.failOnError=false` so the broken test files do not block compilation. This is a repo-wide hygiene issue outside this spec's scope.
- The architecture-model-service's `pom.xml` sets `<maven.test.skip>true</maven.test.skip>` as default; tests were run with `-Dmaven.test.skip=false`.
- Memory file notes pre-existing discovery-service test failures in other suites (`bootstrap-summary-fetching`, `conversation-memory-edge-cases`, etc.); none of these are in the feature set and none were run.

---

## 5. Spec Compliance Check (concrete findings)

| Check | Result | Evidence |
|---|---|---|
| Liquibase changeset present + rollback + 5-value CHECK | Pass | `2026-04-20-tech-hints-resolved.sql` lines 42-44 CHECK includes `'high','low','none','tech-only','manual-override'`; rollback lines 49-54 drop constraint + 5 columns. |
| ServiceEntity + ServiceDto + EntityMapper round-trip 5 fields | Pass | Entity lines 82/89/99/106/114; DTO lines 65/68/74/77/80; Mapper `toDto` lines 305-309, `toEntity` lines 342-346; `ServiceCoreTechPersistenceTest` Task 1.1 populated + NULL round-trip tests pass. |
| Whole-model PUT carries new fields to DB | Pass | `ModelController.java:85` accepts `ArchitectureModelDto` with no allow-list; DTO includes fields; trace through existing `modelService.saveModel`. |
| Discovery-service `POST /discovery/tech-hints/resolve` returns correct shape | Pass | `techHintsResolver.ts` `TechHintResolution` type + `validateResolution` schema guard; route lines 38-91. |
| Snapshot caps (30/100/8/~8KB) + truncation marker | Pass | `techHintsResolver.ts` lines 89-92 constants; `buildSnapshot` lines 139-210 enforces each cap; test "snapshot cap" asserts 30 filenames + truncation marker. |
| Schema guard rejects out-of-registry packs | Pass | `validateResolution` lines 378-402 check membership in `validLangPackIds` / `validFwPackIds`; test "LLM returns a pack name not in registry → 502 llm_malformed" asserts this. |
| Error taxonomy log lines emitted | Pass | `logReason()` at lines 442-456; called at each of the four failure points (lines 501, 513, 526, 559, 573, 586). |
| Gateway relay passes through 200/502/504 + `reason` | Pass | `gateway/src/routes/techHintsResolve.ts` line 100 returns downstream status + body verbatim; test "downstream 502 with reason body is preserved" asserts. |
| Tier gate — `coreTechResolved IS NULL` → 409 `TECH_HINTS_UNRESOLVED` | Pass | `routes/runs.ts` lines 168-176; test "coreTechResolved NULL rejects with 409 TECH_HINTS_UNRESOLVED". |
| Tier gate — `languagePack` non-null + packs → tier A | Pass | `computeTierFromResolvedColumns` lines 28-33; test "languagePack + frameworkPacks both set → tier A from resolved columns". |
| Tier gate — `languagePack` null + empty packs → tier C + `confirmLlmSolo` gate | Pass | Same function returns 'C'; existing `LLM_SOLO_CONFIRMATION_REQUIRED` block at lines 209-213; test "resolved but no packs matched → tier C; confirmLlmSolo gate rejects without opt-in". |
| `parseCoretech` still exported; no service-scoped caller remains | Pass | `coreTechParser.ts:75` exports `parseCoretech`; only non-test non-doc caller is `routes/packs.ts:65` (diagnostic endpoint). |
| Services grid column order | Pass | `gridConfigs.ts` lines 159-163: `repo_location, repo_subfolder, core_tech`. |
| TechHintsCell chips + confirmation sentence + manual-override + strip colours + unresolved badge | Pass | `TechHintsCell.tsx` covered by 6-test suite; chip removal lines 337-357 set `'manual-override'`; warning strip lines 466-479 drives red/amber via `data-status`. |
| `pendingResolutionsStore` entry shape + abort-on-re-edit + 250 ms debounce | Pass | Store lines 87-98 shape + abort; `TechHintsCell.tsx` lines 202, 279 debounce; tests cover. |
| `SaveWithPendingResolves` disables on conflict, shows `"Resolving N rows..."`, awaits `Promise.allSettled`, surfaces rejections | Pass | Component lines 60-147; `saveWaitsForResolve.test.tsx` 3 tests plus `pendingResolutionsStore.test.tsx` Save gating block. |
| All feature-local tests pass | Pass | 75/75. |

### Deviations — verified acceptable

1. **`core_tech_framework_packs` JSONB vs TEXT[]**: DB column type deviates from spec. Wire contract preserved: Hibernate `@Type(JsonType.class)` stores a JSON array; Jackson serialises it as a JSON array of strings (`EntityDtoSerializationTest` line 186-191 asserts the JSON array shape). Downstream consumers (frontend, discovery-service) observe identical shape. Rationale captured in changelog-master header.
2. **5-value CHECK vs pre-agreed 4-value list**: `'manual-override'` added as 5th CHECK value; confirmed frontend's `TechHintConfidence` union also has 5 values and the backend's `validateResolution` restricts LLM responses to the original 4. DB is more permissive than the server resolver by design (to allow frontend-originated chip-removal state).
3. **Vanilla external store vs Zustand**: `pendingResolutionsStore.ts` uses `useSyncExternalStore` + imperative API. Full feature parity with the spec's Zustand requirements. Rationale documented in-file.
4. **`callTechHintsLlm` reuses `/api/v1/discovery/v3/gap-fill` with synthetic `runId`**: Honours the spec clause "no separate fast-model knob" (same transport + provider config). Mildly surprising — a reader expecting a dedicated endpoint will be confused until they read the docblock at `gatewayClient.ts:259-277`.
5. **`techHintsFromResolvedColumns` reconstructs `TechHints` for the runManager synthetic-config path**: The runtime pipeline still needs the per-hint `TechHints` shape (see memory note `project_discovery_techhints_shape`). The helper at `runManager.ts:52-92` produces one entry per hint with the correct `language` / `technology` shape, matching `parseCoretech`'s output contract. Pack-match semantics preserved.
6. **Snake-case wire contract**: `ServiceDto` `@JsonProperty("core_tech_resolution_confidence")` etc. `tasks.md` mentions camelCase `coreTechResolutionConfidence` in pseudocode; the actual wire contract is snake_case and is internally consistent (DTO ↔ frontend Service type ↔ test assertions all align).

### Deviation — unwired downstream

- **`SaveWithPendingResolves` is a new standalone component, not wired into the existing TopBar `FileMenu` Save**. Explicitly flagged by the implementer as out-of-scope. The Save-gating contract is covered by its tests, but an end-user today still hits the pre-existing `FileMenu` save path which does not consult `pendingResolutionsStore`. This is a known downstream plumbing task that should be tracked as a follow-up.

---

## 6. Recommended Follow-up Work

1. Wire `SaveWithPendingResolves` into the TopBar `FileMenu` Save handler (or replace the `FileMenu` Save button with this component) so the Save-gating contract reaches users. Currently the component is dead code at runtime.
2. Resolve the pre-existing architecture-model-service compile errors in `OrganisationController*Test`, `WorkItemImplementContextServiceTest`, `RoadmapImportServiceV3Test`. Unrelated to this spec but they force `-Dmaven.compiler.failOnError=false` for any targeted test run.
3. Backfill per-task implementation reports in `agent-os/specs/2026-04-20-tech-hints-llm-resolution/implementation/` (or explicitly mark them as superseded by inline source comments).
4. Consider whether the snake_case-vs-camelCase doc drift in `tasks.md` / `spec.md` warrants an addendum so future readers don't rely on the camelCase form appearing in those documents.

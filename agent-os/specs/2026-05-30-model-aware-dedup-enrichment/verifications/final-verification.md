# Verification Report: Model-Aware Discovery — Dedup Against Existing Entities + Enrichment/Link Candidates

**Spec:** `2026-05-30-model-aware-dedup-enrichment`
**Date:** 2026-05-30
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

All 5 task groups are fully implemented across the strict layering (AMS → discovery-service model-as-input → discovery-service candidate emission → MCP save-back → frontend). Every group's focused test suite passes (4 + 8 + 4 + 7 + 7 = 30 tests, 0 failures). The cross-layer `data`-key contract (enrich `targetEntityName`; link `logicalEntityName`+`physicalEntityName`) is consistent key-for-key from the LLM prompt through emission, save-back, and the frontend reader. All hard constraints hold: no applied-changeset edits, no `@CamelCaseWire` on the new DTO field, snake_case preserved, no new entity/relationship TYPES, no `*_points` creation, and no synthesized 1:1 mapping. No new (spec-caused) regressions were introduced — the targeted tsc baselines are unchanged (frontend 513/513 with 0 in this spec's files; mcp-server 1 pre-existing; discovery-service 0).

---

## 1. Tasks Verification

**Status:** ✅ All Complete

All sub-tasks in `tasks.md` were already marked `- [x]`; verification confirmed each against the working-tree implementation. No checkbox required correcting.

### Completed Tasks
- [x] Task Group 1: `operation` column + DTO surface (AMS)
  - [x] 1.1 Focused tests (`DiscoveryCandidateOperationFieldTest`, 4 tests)
  - [x] 1.2 New changeset `166-discovery-candidate-operation.sql` (additive column + index, mirrors 165)
  - [x] 1.3 Registered `166-discovery-candidate-operation` in `db.changelog-master.yaml` (guarded `not: columnExists`, `onFail: MARK_RAN`, `sqlFile` block)
  - [x] 1.4 `operation` on `DiscoveryCandidateEntity` (`@Builder.Default = "create"`, `@PrePersist` null-coercion, `idx_discovery_candidate_run_id_operation`)
  - [x] 1.5 `operation` on `DiscoveryCandidateDto` (`@JsonProperty("operation")`, no `@CamelCaseWire`)
  - [x] 1.6 Repository unchanged (no speculative finder) — correct
  - [x] 1.7 No prior-spec field reverted
  - [x] 1.8 Group 1 tests pass (BUILD SUCCESS)
- [x] Task Group 2: Load existing model + inject lean existing-entity index
  - [x] 2.1 Focused tests (`modelAwareExistingEntityIndex.test.ts`, 8 tests)
  - [x] 2.2 `archModelClient.getModel(projectId, runId)` loads the model at the prompt-composition point; 404/first-run tolerated (returns null)
  - [x] 2.3 `prompts/existingEntityIndex.ts` builds the LEAN index (id/type/name/parentOrTableHint only; subtree + ALL data entities; size-cap narrowing)
  - [x] 2.4 `composer.ts`/`injection.ts` render the "Existing Entities" section (enrich/link-by-name nudge; forbids `*_points`; first-run stub)
  - [x] 2.5 `dedup.ts` extended with concept-only framing (authoritative match stays in code)
  - [x] 2.6 No prior-spec file reverted
  - [x] 2.7 Group 2 tests pass
- [x] Task Group 3: Set `operation` on emitted candidates
  - [x] 3.1 Focused tests (`modelAwareCandidateOperation.test.ts`, 4 tests)
  - [x] 3.2 `normalizeOperation` stamps `operation` (defaults `create`; unrecognised value collapses to `create`)
  - [x] 3.3 Target NAME(s) ride on `data` via `baseData` pass-through (`targetEntityName`; `logicalEntityName`+`physicalEntityName`); no resolved id, no `*_points`
  - [x] 3.4 Within-run dedup stays informational (no silent drops)
  - [x] 3.5 No prior-spec file reverted
  - [x] 3.6 Group 3 tests pass
- [x] Task Group 4: Dedup-suppress, enrich-apply, logical↔physical link, late resolution, conflict/target-gone Findings (MCP)
  - [x] 4.1 Focused tests (`candidateSaveBackModelAware.test.ts`, 7 tests covering crux paths a–f + d2)
  - [x] 4.2 Dedup-against-existing: EXACT → auto-suppress (pre-Pass-1 snapshot so same-run mints never suppress); NORMALIZED → reviewable possible-duplicate; NONE → create
  - [x] 4.3 Enrich-apply adds attribute/relationship WITHOUT blanket-overwrite; below-gate stays reviewable
  - [x] 4.4 `link` populates `logical_data_entity_physical_data_entities` with RAW `logical_entity_id`+`physical_entity_id` FKs (`ldepe-` prefix); never synthesizes 1:1
  - [x] 4.5 Late name-resolution in deferred passes; target-gone → `enrich_target_missing` Finding
  - [x] 4.6 Visible auto-suppress run summary (`entitiesSuppressed` + `suppressedDuplicates`)
  - [x] 4.7 Attribute conflict → `attribute_conflict` Finding (severity `low`, linked to `architecture_element`), no overwrite
  - [x] 4.8 No `*_points` created/mutated; identity primitive reused, not forked
  - [x] 4.9 No prior-spec file reverted
  - [x] 4.10 Group 4 tests pass
- [x] Task Group 5: Operation badge, target name, details-panel rendering (frontend)
  - [x] 5.1 Focused tests (`discoveryCandidateTableOperation.test.tsx`, 7 tests)
  - [x] 5.2 `operation` on frontend `DiscoveryCandidateDto` (snake_case, absence-tolerant)
  - [x] 5.3 Per-row operation badge + target name in `DiscoveryCandidateTable.tsx` (interleaved, reuses `TierBadge`)
  - [x] 5.4 Resolved-target + what's-added block in `CandidateDetailsPanel.tsx` via `candidateOperationSupport.ts` (gated on `operation`, not candidate_type)
  - [x] 5.5 No prior-spec file reverted
  - [x] 5.6 Group 5 tests pass

### Incomplete or Issues
None.

---

## 2. Documentation Verification

**Status:** ✅ Complete (with note)

### Spec Documentation
- [x] `spec.md`, `tasks.md`, `planning/requirements.md`, `raw-idea.md` all present and consistent.

### Implementation Documentation
This spec did not use a per-task-group `implementation/` report folder (none exists, and `tasks.md` did not require one). Verification was performed directly against the working-tree code and the per-group focused test suites, which is the spec's stated done-bar ("offline unit tests green per group").

### Code-Level Self-Documentation
- The cross-layer `data`-key contract is self-documented in `candidateOperationSupport.ts` (frontend), whose header explicitly cross-references `candidateSaveBackService.readEnrichTargetName` as the authoritative key-order source.
- Each new/changed file carries a spec-stamped header/comment block tying it to "2026-05-30 Model-Aware Discovery — Task Group N".

### Missing Documentation
None blocking. (No `implementation/` folder, by design for this spec.)

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` is the original product roadmap for the diagram-editor / meta-model CRUD application (Phases 1–5: meta-model CRUD, diagram rendering/editing, backend & deployment). It contains no item describing the HAIKAI discovery-richness program, model-aware discovery, dedup, enrichment, or logical↔physical reconciliation. This spec belongs to the separate discovery-richness initiative (Issue 2, building on Specs 1–3 + Issue 1) tracked in project memory, not in the product roadmap. No roadmap checkbox matches this spec, so no update was applicable.

---

## 4. Test Suite Results

**Status:** ✅ All Passing (per-group focused suites; whole suites intentionally not run per the read-only / scoped-verification mandate)

Per the verification mandate (read-only; do not run slow/noisy whole suites; scope to each group's NEW focused tests + targeted tsc), the following were executed.

### Per-Group Focused Test Results
| Group | Suite | Result |
| --- | --- | --- |
| 1 (AMS) | `DiscoveryCandidateOperationFieldTest` | 4 passed / 0 failed (BUILD SUCCESS) |
| 2 (discovery) | `modelAwareExistingEntityIndex.test.ts` | 8 passed / 0 failed |
| 3 (discovery) | `modelAwareCandidateOperation.test.ts` | 4 passed / 0 failed |
| 4 (mcp) | `candidateSaveBackModelAware.test.ts` | 7 passed / 0 failed |
| 5 (frontend) | `discoveryCandidateTableOperation.test.tsx` | 7 passed / 0 failed |
| **Total** | | **30 passed / 0 failed / 0 errors** |

### Targeted Type-Check (tsc) Results
| Module | Error count | This spec's contribution |
| --- | --- | --- |
| frontend `tsc --noEmit` | 513 | 0 (no error in any file this spec touched/added; baseline 513 = pre-existing) |
| mcp-server `tsc --noEmit` | 1 | 0 (the 1 is the pre-existing `src/types/index.ts(196,1) TS2308 ProcessActivityInput` ambiguity) |
| discovery-service `tsc --noEmit` | 0 | 0 (fully clean) |

### Failed Tests
None — all 30 focused tests passing.

### NEW (spec-caused) regressions
None. Confirmed by: (a) all targeted tsc baselines unchanged with 0 errors attributable to this spec's files, (b) the AMS test-file edits being purely additive `DiscoveryCandidateDto` constructor-arity fixes (each call site gains a trailing `null // operation` argument because the record gained a component) — no prior-spec field reverted.

### Pre-existing failures (NOT attributable to this spec — not fixed, per mandate)
- Frontend `tsc --noEmit` baseline ≈ 513 errors (unchanged before/after); plus several pre-existing frontend test failures per project memory.
- AMS: `DiscoveryCandidateControllerTest` / `DiscoveryCandidateReviewEndpointTest` 404 under `@WebMvcTest`; `DiscoveryUpsertServiceTest.clusterBulkCreate` jdbcTemplate NPE; `BusinessLogicIntegrationTest` H2 reserved-word issues.
- mcp-server: `src/types/index.ts(196,1) TS2308 ProcessActivityInput` ambiguity.
- discovery-service: `discoveryV3Pipeline.techHints.test.ts` 2 failures asserting `startRun` options shape (originate in untouched `runs.ts`).

### Notes
Whole test suites were deliberately not run (read-only, scoped-verification mandate; whole suites are slow/noisy and carry the documented pre-existing failures above). The spec's stated done-bar is offline unit tests green per group, which is met.

---

## 5. Cross-Layer Contract Check

**Status:** ✅ Consistent end-to-end

The `data`-key contract was traced across all four boundary files:

- **Producer — prompt (`composer.ts`):** instructs the LLM to emit `operation: "enrich"` + `targetEntityName`, and `operation: "link"` + `logicalEntityName` + `physicalEntityName`.
- **Emission (`llmGapFillStep.ts`):** `normalizeOperation(raw.operation)` stamps `operation`; `REQUIRED_LLM_FIELDS` is only `type/name/filePath/confidence`, so `targetEntityName` / `logicalEntityName` / `physicalEntityName` / `targetConfidence` pass through verbatim onto `candidate.data` via `baseData`.
- **Consumer — save-back (`candidateSaveBackService.ts`):** enrich reader order `targetEntityName → target_entity_name → logicalEntityName → entityName → target`; link reader `logicalEntityName || logical_entity_name` and `physicalEntityName || physical_entity_name`.
- **Consumer — frontend (`candidateOperationSupport.ts`):** enrich reader order identical (`targetEntityName, target_entity_name, logicalEntityName, entityName, target`); link reader identical pairs (`['logicalEntityName','logical_entity_name']`, `['physicalEntityName','physical_entity_name']`).

Save-back and frontend readers agree key-for-key, and the frontend helper's header documents `candidateSaveBackService.readEnrichTargetName` as the contract source. Contract verified.

---

## 6. Constraint Conformance

**Status:** ✅ All constraints satisfied

- **No applied-changeset edits:** `git diff --name-only` on `db/changelog/sql/*.sql` shows nothing modified; the only entry is the untracked NEW file `166-discovery-candidate-operation.sql`. Changesets 160–165 untouched. Master registration is a NEW `changeSet` block appended after 165, mirroring the 165 guard pattern exactly.
- **snake_case / no `@CamelCaseWire`:** the new `DiscoveryCandidateDto.operation` uses `@JsonProperty("operation")` with no `@CamelCaseWire`; Test 4 asserts the `"operation"` snake_case wire key. The only "@CamelCaseWire" string in the diff is inside an explanatory YAML comment, not an annotation.
- **No new entity/relationship TYPES:** save-back writes only PRE-EXISTING meta-model arrays — `logical_data_entity_physical_data_entities` (the Spec-3-deferred mapping, already in the scaffold), `logical_data_entity_relationships`, and `logical_data_attributes` / `physical_data_attributes`. The only new dimension is the `operation` column.
- **No `*_points` creation/mutation:** no added non-comment line pushes to any `*_points` array. The link mapping row uses RAW entity FKs (`logical_entity_id`/`physical_entity_id`), explicitly NOT `dep_log_`/`dep_phy_` point ids (the test asserts the row contains neither, and that no `data_entity_point` is created). The `resolveEntityToPointId` calls in the relationship-enrich path only READ existing point ids.
- **No synthesized 1:1:** each link side is matched independently in its own layer; no match on either side → write nothing + Finding; the layers stay distinct.
- **Visible auto-suppress / no silent drops:** EXACT-only suppression recorded in `suppressedDuplicates` + counted in `entitiesSuppressed`; NORMALIZED → `possibleDuplicates`; target-gone + attribute-conflict → Findings on the result and best-effort POSTed to AMS.
- **Uncommitted prior work preserved:** no `git checkout`/`restore`/`stash` or revert performed; verification was read-only (`git status`/`git diff` only). Issue 1 and Specs 1/2/3 working-tree changes remain intact.

---

## Final Verdict

✅ **PASSED.** All 5 task groups are implemented to spec with strict layering preserved. 30/30 focused tests pass across AMS, discovery-service, mcp-server, and frontend. The cross-layer `data`-key contract is consistent end-to-end. Every hard constraint (snake_case, no `@CamelCaseWire`, NEW changeset only, no new TYPES, no `*_points`, no 1:1 synthesis, no silent drops) is satisfied. No new spec-caused regressions: targeted tsc baselines are unchanged and the only failing tests/tsc errors are the documented pre-existing ones, left untouched per the read-only mandate.

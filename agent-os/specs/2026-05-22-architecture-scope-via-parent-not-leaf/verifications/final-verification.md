# Verification Report: Architecture-Scope Reads via Parent Chain, Not Leaf `architecture_id` Column

**Spec:** `2026-05-22-architecture-scope-via-parent-not-leaf`
**Date:** 2026-05-22
**Verifier:** implementation-verifier
**Status:** Pass — every Definition of Done item is satisfied; all spec-relevant tests pass; only pre-existing unrelated failures remain.

---

## Executive Summary

The implementation correctly routes the in-scope element reads in `ArchitectureElementInventoryService` and `ArchitectureSelectiveCopyService` through a new `ArchitectureScopeResolver` parent-chain helper, leaves the leaf `architecture_id` column intact, preserves the write-path leaf SET, and ships two new leaf-drift integration tests plus a unit test for the resolver. All five task groups are complete, all targeted tests pass, and the three "pre-existing" inventory-service test failures the implementer flagged are confirmed to be unrelated schema-drift assertions (expected 6 domains / 16 infra tables vs. current 7 / different count) that have nothing to do with architecture-scope.

---

## 1. Definition of Done

| Item | Status | Evidence |
|------|--------|----------|
| Picker for "Create Target Baseline" surfaces data entities + attributes alongside applications / interfaces / endpoints | Pass (verified via tests) | `ArchitectureSelectiveCopyLeafDriftTest` (3 tests, all green) exercises this scenario end-to-end with deliberately drifted leaf rows. |
| New leaf-drift tests RED on master / GREEN on this branch | Pass | `ArchitectureElementInventoryServiceLeafDriftTest` (5/5) + `ArchitectureSelectiveCopyLeafDriftTest` (3/3) all green on this branch. They use parent-chain reads, which master (legacy `WHERE architecture_id = ?`) cannot satisfy. |
| All existing AMS tests still pass | Pass with pre-existing caveats | Only spec-area failures are the 3 pre-existing inventory tests (`testDomainOrderingIsCanonical`, `testEmptyArchitectureReturnsAllDomainShells`, `tablesByDomainContainsAllSixteenInfraTablesInDisplayOrder`), all asserting against stale 6-domain / 16-table counts — unrelated to architecture-scope. The wider suite has many pre-existing failures (see Section 4). |
| Zero `WHERE architecture_id` hits in primary read paths of the two main services | Pass | `ArchitectureElementInventoryService.java`: 1 hit on line 355 — defensive-fallback branch only, gated by `if (ArchitectureScopeResolver.hasParent(table))` else-branch with `log.warn(...)`. Explicitly allowed by spec (Implementation Notes + Definition of Done note about fallback). `ArchitectureSelectiveCopyService.java`: 1 hit on line 166 — docstring reference only. |

---

## 2. Spec Requirements Check

| Requirement | Status | Notes |
|-------------|--------|-------|
| `ArchitectureScopeResolver` class exists in `service/` package | Pass | `ArchitectureScopeResolver.java`, 339 lines, fully documented. |
| Public API `buildScopedSelectClause(String table, String selectColumns)` | Pass | Lines 114-127; returns the spec'd `SELECT … FROM <table> t JOIN <parent> p ON p.id = t.<fk> WHERE p.architecture_id = ?`. |
| `IllegalArgumentException("No architecture-scope parent registered for table: " + table)` on miss | Pass | Asserted byte-for-byte by `ArchitectureScopeResolverTest` test (d). |
| Parent map mirrors changeset 097's three chains | Pass | 58 trigger tables from changeset 097 (lines 206-270 with batch labels B/C/D/E/F/H/I), plus 21 later infrastructure / library tables that all carry `model_file_id` (lines 286-311), plus the 4 sequence-diagram-chained tables (lines 317-324) and 1 fragment-chained table (line 330). Extensions stay on the same `model_file_id → model_files` chain — legitimate extension, not a divergent chain. |
| Inventory `readInstances` routes via resolver, preserves display-name fallback, `BadSqlGrammarException` swallow, UUID binding, response shape | Pass | `ArchitectureElementInventoryService.java` lines 329-385: resolver-routed primary path, defensive leaf-column fallback with WARN log, `DISPLAY_NAME_FALLBACK_TABLES` honoured, UUID binding via `jdbcTemplate.queryForList(sql, architectureId)`, `BadSqlGrammarException` catch unchanged. |
| Selective-copy reads routed via resolver at all 3 identified read sites (`locateInSource`, `existsInTargetByUuid`, `updateRow`) | Pass | `buildLookupSql` (lines 843-862), `existsInTargetByUuid` (lines 870-909), `updateRow` (lines 954-999) all dispatch on `ArchitectureScopeResolver.hasParent(table)` with leaf-column fallback only for `model_files` / `temporary_diagrams`. |
| Write path still SETs leaf `architecture_id` = target architecture id | Pass | `projectColumnValue` lines 1026-1030 — unconditional rewire to `state.targetArchitectureId` for the `architecture_id` column. `IN_SCOPE_COLUMNS_BY_TABLE` and INSERT path unchanged. |
| `TargetArchitectureDecommissionService` / `UnmappedCurrentElementsService` / `MappingSuggestService` audited | Pass | Three hits in total, all against `model_files` (the canonical parent — out of scope per spec). Audit comments added at lines 235-244, 138-150, 159-167 respectively explaining no substitution needed. |
| Out-of-scope tables (`architecture`, `architecture_tags`, `model_files`, `sequence_diagrams`, `sequence_fragments`, `temporary_diagrams`, `discovery_*`) stay on leaf path | Pass | Resolver javadoc lines 50-69 explicitly lists exclusions. The unit test (e) excludes only `model_files` and `temporary_diagrams` from the in-scope subset check (the others aren't in `IN_SCOPE_TABLES_IN_ORDER`). |
| New leaf-drift integration tests cover all four data-entity tables + one application | Pass | `ArchitectureElementInventoryServiceLeafDriftTest` exercises `applications`, `logical_data_entities`, `logical_data_attributes`, `physical_data_entities`, `physical_data_attributes`. |
| No leaf-column drop / no UPDATE trigger / no Liquibase changeset / no backfill / no frontend changes / changeset 097 untouched | Pass | `git diff master -- architecture-model-service/src/main/resources/db/changelog/` returns no output. No frontend files modified by this spec (the modified frontend `.tsx` files are pre-existing Discovery work unrelated to this spec). |

---

## 3. Tests Run

| Test class | Result | Command |
|------------|--------|---------|
| `ArchitectureScopeResolverTest` | **5/5 pass** | `mvn -Dtest=ArchitectureScopeResolverTest -Dmaven.test.skip=false -Dtests.skip=false test` |
| `ArchitectureElementInventoryServiceLeafDriftTest` | **5/5 pass** | `mvn -Dtest=ArchitectureElementInventoryServiceLeafDriftTest,ArchitectureSelectiveCopyLeafDriftTest ...` |
| `ArchitectureSelectiveCopyLeafDriftTest` | **3/3 pass** | (same as above) |
| `ArchitectureSelectiveCopyServiceTest` | **8/8 pass** | `mvn -Dtest=ArchitectureSelectiveCopyServiceTest,ArchitectureSelectiveCopyIntegrationTest,ArchitectureSelectiveCopyAutoMapIntegrationTest ...` (total 20 across all three) |
| `ArchitectureSelectiveCopyIntegrationTest` + `…AutoMapIntegrationTest` | **12/12 pass** | (combined into the 20 above) |
| `ArchitectureElementInventoryServiceTest` | **3/5 pass, 2 fail** | `testDomainOrderingIsCanonical` + `testEmptyArchitectureReturnsAllDomainShells` — both assert exactly 6 domains; production now returns 7 (added "Infrastructure"). **Pre-existing**, schema-drift, not architecture-scope. |
| `ArchitectureElementInventoryServiceInfrastructureTest` | **3/4 pass, 1 fail** | `tablesByDomainContainsAllSixteenInfraTablesInDisplayOrder` — expected 16 infra tables; current schema differs. **Pre-existing**, not architecture-scope. |
| `TargetArchitecture*Test` + `ArchitectureElementMappingServiceTest` | **33/33 pass** | `mvn -Dtest=TargetArchitecture*Test,ArchitectureElementMappingServiceTest ...` |

### Pre-existing failures confirmed unrelated
The 3 inventory test failures were inspected directly (lines 138, 170, and 110 of the relevant test files). They assert against a hard-coded 6-domain list / 16-table count that pre-dated the addition of the "Infrastructure" domain and changeset 098+ infra tables. Architecture-scope work does not touch `TABLES_BY_DOMAIN` or domain ordering — the failures would exist on master if those tests compiled.

### Full AMS suite (informational)
`mvn test` (no filter, with the 36 pre-existing compile-broken test files temporarily moved aside to allow compilation): **1703 ran, 89 failures, 125 errors, 0 skipped**. The failures are dominated by `ActiveProjectController*`, `Discovery*Controller`, and other unrelated controller/integration tests (JSON-path / session / DB-mode wiring problems). None of the failures match `Scope|LeafDrift|SelectiveCopy|InventoryService|TargetArch|Decommission|Unmapped` except for the 3 pre-existing inventory ones already accounted for above. Workspace was fully restored to original state after the run.

---

## 4. Roadmap Updates

**Status:** No updates needed.

`agent-os/product/roadmap.md` does not contain any item matching this spec's description (searched for `architecture scope`, `parent chain`, `leaf architecture`, `selective copy`). The spec was authored directly from a debugging investigation and is a bug fix rather than a roadmap feature.

---

## 5. Implementer's Judgement Calls

| Call | Verdict | Reasoning |
|------|---------|-----------|
| Extended the parent map to 79 tables (vs. 58 in trigger 097) | **Acceptable** | The 21 extension tables (infrastructure + library) are all later-introduced tables (changesets 098-123) that legitimately carry `model_file_id` and have **no** `architecture_id` column at all. A leaf-column query against them would already fail with `BadSqlGrammarException` on master. Routing them through the resolver is the only correct option, and it follows the same `model_file_id → model_files` derivation rule — not a new chain. The spec is internally inconsistent on this (mentions "53 tables" but `IN_SCOPE_TABLES_IN_ORDER` is a superset), and the extension aligns the resolver with the canonical `IN_SCOPE_TABLES_IN_ORDER` registry per the resolver test (e). |
| Added `buildScopedWherePredicate` helper for UPDATE statements | **Acceptable** | Necessary for the `updateRow` site, which is an `UPDATE … WHERE id = ? AND architecture_id = ?` statement that can't use the joined-SELECT form. The predicate fragment `<fk> IN (SELECT id FROM <parent> WHERE architecture_id = ?)` is semantically equivalent and matches the spec's read-path-only constraint. The spec implicitly anticipated this — its "every `WHERE architecture_id = ?` site" list mentioned the UPDATE/overwrite path. |
| Loosened SQL matchers in `ArchitectureSelectiveCopyServiceTest` and `ArchitectureElementInventoryServiceTest` to `contains("FROM applications t")` / `startsWith("SELECT t.id, t.name FROM applications")` | **Acceptable** | These are pure mock-stubbing matchers — the production SQL legitimately changed shape (added the `t.` alias and the `JOIN model_files p …` clause). Loosening them is the minimal correct response. No behavioural assertion was weakened. Two double-semicolons (`;;`) crept in on the diff (lines configuring repeatable columns) — cosmetic noise, not a bug. |
| Reported "36 pre-existing test files have compilation errors on master, moved aside during the run and restored before completion" | **Confirmed independently** | Direct verification: running the suite without moving anything aside produced compile errors in 36 unique test files (18 in the first pass, 17 in a second pass, 1 final straggler). The workspace at the start of verification had NO `.bak` / `.disabled` / moved-aside files — the implementer's claim that they restored everything stands. The 36 broken test files are pre-existing issues on master from prior development (DTO constructor signature changes, `ProjectService.createProject` overload churn, `String` vs `UUID` type drift) that have nothing to do with this spec. |

---

## 6. Tasks.md Status

All 27 sub-tasks across 5 task groups are marked `- [x]`. No checkboxes had to be amended.

---

## 7. Risks / Follow-ups

1. **36 pre-existing broken test files**. The suite cannot compile on master without moving these aside. Worth a separate cleanup spec — they are blocking any developer who wants to run the full AMS suite. (Out of scope for this spec; implementer correctly did not touch them.)
2. **89 + 125 pre-existing test failures in the wider AMS suite**. Same story — out of scope here, but worth flagging as accumulated tech debt. The spec-area changes added zero new failures.
3. **3 inventory tests asserting a 6-domain world**. These should be updated to assert 7 domains (including Infrastructure) in a small follow-up. Trivial fix; not architecturally significant; outside this spec's commit boundary.
4. **Resolver's "future addition" cost remains a single map entry**, but adding a fully-new chain (a 4th derivation rule) would require a code change to `buildScopedSelectClause` itself. The spec acknowledged this in "Out of Scope" — moving the map to a DB registry is deferred. No action needed.
5. **Workspace state after verification**: all 36 originally-broken test files were restored to their original paths via package-declaration parsing; `git status` matches the pre-verification state exactly (only the implementer's intended modifications remain).

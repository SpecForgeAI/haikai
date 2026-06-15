# Task Breakdown: Architecture-Scope Reads via Parent Chain, Not Leaf `architecture_id` Column

## Overview
Total Tasks: 5 task groups, 27 sub-tasks
Commit Boundary: One commit covering all five task groups (per spec Commit Boundary section).

## Task List

### Shared Resolver Layer

#### Task Group 1: `ArchitectureScopeResolver` helper + unit test
**Dependencies:** None

- [x] 1.0 Build the shared parent-chain resolver
  - [x] 1.1 Write 2-8 focused tests for `ArchitectureScopeResolver`
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/service/ArchitectureScopeResolverTest.java`
    - Limit to 2-8 highly focused tests maximum
    - Cover: (a) a `model_file_id`-chained table produces the expected `JOIN model_files p ON p.id = t.model_file_id WHERE p.architecture_id = ?` clause; (b) a `sequence_diagram_id`-chained table produces the equivalent join against `sequence_diagrams`; (c) the `fragment_id`-chained table produces the equivalent join against `sequence_fragments`; (d) an unknown table throws `IllegalArgumentException` with the exact message `"No architecture-scope parent registered for table: <table>"`; (e) startup-time assertion that every entry in `ArchitectureSelectiveCopyService.IN_SCOPE_TABLES_IN_ORDER` has a matching parent entry in the resolver (no missing, no extras).
    - Skip exhaustive testing of column-list permutations or alias variations.
  - [x] 1.2 Create `ArchitectureScopeResolver` class
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureScopeResolver.java`
    - Hard-coded `Map<String, ParentLink>` where `ParentLink` records `(parentTable, fkColumn)`.
    - Populate map verbatim from changeset `097-architecture-id-auto-derive-trigger.sql`: 53 tables via `model_file_id -> model_files`, 4 tables via `sequence_diagram_id -> sequence_diagrams`, 1 table via `fragment_id -> sequence_fragments`.
    - Public API: `String buildScopedSelectClause(String table, String selectColumns)` returns `SELECT <selectColumns> FROM <table> t JOIN <parent> p ON p.id = t.<fkCol> WHERE p.architecture_id = ?`.
    - Throw `IllegalArgumentException("No architecture-scope parent registered for table: " + table)` on miss.
  - [x] 1.3 Ensure resolver unit tests pass
    - Run ONLY the 2-8 tests written in 1.1.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests in 1.1 pass.
- Parent map is a verbatim mirror of changeset 097's three chains.
- Map is a strict superset of `ArchitectureSelectiveCopyService.IN_SCOPE_TABLES_IN_ORDER` (verified by test 1.1e).
- Unknown-table calls fail loudly with the exact `IllegalArgumentException` message.

### Inventory Read Path

#### Task Group 2: `ArchitectureElementInventoryService.readInstances` rewrite + leaf-drift integration test
**Dependencies:** Task Group 1

- [x] 2.0 Rewrite inventory `readInstances` to use the parent chain
  - [x] 2.1 Write a leaf-drift integration test for the inventory service
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/service/ArchitectureElementInventoryServiceLeafDriftTest.java`
    - Limit to 2-8 highly focused tests maximum (target ~5 tests, one per table covered).
    - Setup: seed two architectures A and B in one project; insert one `logical_data_entity`, one `physical_data_entity`, one `logical_data_attribute`, one `physical_data_attribute` whose `model_file_id` points at architecture A's model file but whose leaf `architecture_id` column is deliberately overwritten (via raw SQL post-insert UPDATE) to architecture B's id.
    - Optionally also seed one `applications` row with the same drift pattern to prove cross-domain uniformity.
    - Assert: inventory call for architecture A surfaces every drifted row (parent chain resolves correctly); inventory call for architecture B does NOT surface them.
  - [x] 2.2 Rewrite `readInstances(String table, UUID architectureId)`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureElementInventoryService.java` (current lines 289-323).
    - Replace the existing `WHERE architecture_id = ?` SQL with `ArchitectureScopeResolver.buildScopedSelectClause(...)`.
    - Preserve all existing behaviour: display-name fallback for tables without a `name` column (`DISPLAY_NAME_FALLBACK_TABLES`), idempotent `BadSqlGrammarException` swallow on missing tables / columns, UUID binding type for native Postgres.
    - For tables NOT in the resolver map: fall back to the existing leaf-column query and emit a `WARN` log line including the table name. (None of the current in-scope tables hit this branch; defensive only.)
    - Leave `TABLES_BY_DOMAIN`, `DOMAIN_ORDER`, `DISPLAY_NAME_FALLBACK_TABLES` registries untouched.
    - Update the class-level docstring to reflect the new parent-chain read path.
    - No DTO changes; response shape stays identical.
  - [x] 2.3 Ensure inventory tests pass
    - Run ONLY the leaf-drift test written in 2.1 plus any pre-existing `ArchitectureElementInventoryService*Test` files.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The drift tests in 2.1 pass on this branch and would fail on `master`.
- A grep for `WHERE architecture_id` in `ArchitectureElementInventoryService.java` returns zero hits in the primary path (only the defensive fallback branch may contain it).
- Response shape unchanged; existing inventory consumers see no DTO diff.
- WARN log fires only for tables outside the resolver map.

### Selective Copy Read Paths

#### Task Group 3: `ArchitectureSelectiveCopyService` rewrite (all `WHERE architecture_id = ?` sites) + leaf-drift integration test
**Dependencies:** Task Group 1

- [x] 3.0 Rewrite every architecture-scoped read in selective copy
  - [x] 3.1 Write a leaf-drift integration test for selective copy
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/service/ArchitectureSelectiveCopyLeafDriftTest.java`
    - Limit to 2-8 highly focused tests maximum.
    - Setup: seed architectures A (source) and target T in one project; insert a small set of in-scope rows (at minimum one `logical_data_entity`, one `application`) whose `model_file_id` points at A but whose leaf `architecture_id` is drifted to a third architecture's id.
    - Test 1: preflight from A surfaces the drifted rows (today they would be skipped).
    - Test 2: commit from A to T copies the drifted rows verbatim; assert target rows exist; assert newly-copied rows in T have leaf `architecture_id = T.id` (write path still sets the leaf explicitly).
    - Test 3: post-commit integrity-check counts include the drifted rows.
  - [x] 3.2 Map every `WHERE architecture_id = ?` site in the file
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureSelectiveCopyService.java`.
    - Grep produces ~15 hits across: `locateInSource`, the preflight walk, conflict detection, verbatim insert / overwrite / duplicate paths, and the post-commit integrity-check sweeps that recompute counts.
    - List every hit with line numbers in a comment block or a scratchpad before editing (per `feedback_trace_before_coding.md` - substitution must be uniform).
  - [x] 3.3 Substitute every read site to use the resolver
    - For each of the ~15 hits in 3.2, replace `SELECT ... FROM <table> WHERE architecture_id = ?` with `ArchitectureScopeResolver.buildScopedSelectClause(...)`.
    - Preserve UUID binding via `jdbcTemplate.queryForList(sql, architectureId)`.
    - Leave functional behaviour unchanged: auto-include cascade, skip / overwrite / duplicate resolutions, transactional rollback, `auto_map` mapping inserts.
  - [x] 3.4 Preserve the write path's leaf-column behaviour
    - The verbatim insert of new rows into the target architecture MUST continue to set the leaf `architecture_id` to the target architecture id explicitly.
    - This keeps newly-copied rows correct without depending on the trigger for reads.
    - Verify no write-side SQL was accidentally altered.
  - [x] 3.5 Ensure selective-copy tests pass
    - Run ONLY the leaf-drift test written in 3.1 plus the existing `ArchitectureSelectiveCopyIntegrationTest` and `ArchitectureSelectiveCopyAutoMapIntegrationTest`.
    - Existing happy-path tests must continue to pass untouched (they construct via JPA so the BEFORE INSERT trigger keeps their leaf columns correct).
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The drift tests in 3.1 pass on this branch and would fail on `master`.
- A grep for `WHERE architecture_id` in `ArchitectureSelectiveCopyService.java` returns zero hits on the read paths.
- The write path still sets leaf `architecture_id` = target id explicitly on insert.
- `ArchitectureSelectiveCopyIntegrationTest` and `ArchitectureSelectiveCopyAutoMapIntegrationTest` pass unchanged.

### Audit Sweep

#### Task Group 4: Audit `TargetArchitectureDecommissionService` / `UnmappedCurrentElementsService` / `MappingSuggestService`
**Dependencies:** Task Group 1

- [x] 4.0 Audit and substitute remaining services
  - [x] 4.1 Grep each service for `WHERE architecture_id = ?`
    - Files:
      - `architecture-model-service/src/main/java/com/example/architecturemodel/service/TargetArchitectureDecommissionService.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/service/UnmappedCurrentElementsService.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/service/MappingSuggestService.java`
    - For each hit, classify the target table as either:
      - **In-scope element table** (any of the 58 tables across the three parent chains) -> needs substitution.
      - **Out-of-scope table** (`architecture`, `architecture_tags`, `model_files`, `sequence_diagrams`, `sequence_fragments`, `temporary_diagrams`, `architecture_element_mappings`, any `discovery_*`) -> leave as-is.
    - Record findings as inline comments or a brief notes block in this task.
  - [x] 4.2 Substitute every in-scope hit to use the resolver
    - For each in-scope hit identified in 4.1, swap the SQL for `ArchitectureScopeResolver.buildScopedSelectClause(...)`.
    - Preserve UUID binding semantics and existing transactional behaviour.
    - Out-of-scope hits (queries against `architecture_element_mappings`, `architecture` itself, etc.) stay on the leaf path - they ARE the canonical source for their own architecture-id.
  - [x] 4.3 Ensure audited services still compile and their existing tests pass
    - Run ONLY the existing test files for these three services (no new tests required by the spec for this group).
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- Every `WHERE architecture_id = ?` against an in-scope element table in these three services is routed through the resolver.
- Queries against `architecture_element_mappings`, `architecture`, and other out-of-scope tables remain unchanged.
- Existing tests for these three services continue to pass.

### Full Regression Verification

#### Task Group 5: Verify existing AMS test suite passes end-to-end
**Dependencies:** Task Groups 1-4

- [x] 5.0 Confirm no regressions across the AMS test surface
  - [x] 5.1 Run the full `architecture-model-service` Maven test target
    - Command: `mvn -pl architecture-model-service test` (or project equivalent).
    - All previously-passing tests must continue to pass.
    - Pre-existing failures listed in `CLAUDE.md` (`bootstrap-summary-fetching`, `conversation-memory-edge-cases`, `dashboardSummary*`, `hub-bootstrap-4-task-definition`, `chatV2-panel-*`) are unrelated to this work and may stay red - do NOT touch them.
  - [x] 5.2 Final grep verification
    - `grep -n "WHERE architecture_id" architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureElementInventoryService.java` returns zero hits on the read paths (defensive fallback branch may remain).
    - `grep -n "WHERE architecture_id" architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureSelectiveCopyService.java` returns zero hits.
  - [x] 5.3 Manual smoke check against the original bug scenario
    - Confirm (locally or via the new integration tests) that running "Create Target Baseline" from a Current State architecture surfaces logical data entities, physical data entities, logical attributes, physical attributes in the picker tree alongside applications, interfaces, endpoints - matching what the Architecture & Design view shows.

**Acceptance Criteria:**
- Full AMS test suite is green (modulo the pre-existing unrelated failures listed in `CLAUDE.md`).
- Final grep checks show zero `WHERE architecture_id` read-path hits in the two main service files.
- The user-facing bug scenario from the spec's Definition of Done is verified: picker shows every element the Architecture & Design view shows for the same architecture.

## Execution Order

Recommended implementation sequence:
1. Task Group 1 - `ArchitectureScopeResolver` + unit test (foundation; everything else depends on it).
2. Task Groups 2, 3, 4 - rewrites and audit (can be executed in sequence or interleaved; all depend only on Group 1).
3. Task Group 5 - full regression verification (final gate before commit).

All five task groups land in a single commit per the spec's Commit Boundary section.

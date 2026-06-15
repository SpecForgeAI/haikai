# Task Breakdown: Infrastructure Domain Backend API

## Overview
Total Tasks: 4 task groups covering ~3 source-file edits and 1-2 new controller-test files.

This spec is **narrow** — spec 1 has already delivered the full data layer, JPA entities, DTOs, repositories, `EntityMapper`, `MetaModelEntitiesDto`/`MetaModelRelationshipsDto` extensions, and `ModelService` save/load/delete-and-replace integration. This spec wires the 16 Infrastructure tables into the two architecture-level services that hardcode the in-scope schema (`ArchitectureCloneService`, `ArchitectureElementInventoryService`) and adds controller-level `MockMvc` round-trip coverage for the Infrastructure-bearing full-model GET/PUT.

This is a backend-only spec — no frontend, gateway, MCP, discovery, or Terraform changes. Visual assets are intentionally absent.

## Pre-Existing Broken Tests — Implementer Convention

Spec 1 left ~9 `ModelService*Test` files staged as broken plus ~112 unrelated pre-existing failing test files (constructor signature drift, unrelated regressions). This spec must **NOT** attempt to fix them.

**Workaround pattern (carried forward from spec 1):**
1. Before running targeted tests, move the broken test files out of `src/test/java/...` into a staging directory: `/tmp/staged-broken-tests/` (or `.broken-tests-staging-verify/` at the repo root).
2. Run only the new tests added by this spec (Task Groups 1.1, 2.1, 3.1, 4.3).
3. After verification, restore the staged files to their original locations so the staging directory is empty again.
4. Do not commit any of the moved files; the staging directory must not appear in git status.

The implementer should treat this as a known carry-forward issue, not as new work surface. None of the pre-existing broken tests touch the surface this spec adds.

## Task List

### Architecture Clone Service Layer

#### Task Group 1: Extend `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`
**Dependencies:** None (spec 1 already merged)

- [x] 1.0 Append the 16 Infrastructure tables to `IN_SCOPE_TABLES_IN_ORDER` in dependency-safe order so architecture clone (and the inheriting `ArchitectureSelectiveCopyService`) carries Infrastructure rows across.
  - [x] 1.1 Write 2-4 focused tests for clone coverage of the new Infra tables
    - Test that `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` contains all 13 base-section Infra tables (12 entity tables + `infrastructure_points`) in dependency-safe order — `environments` precedes every other Infra entity; `infrastructure_points` is last in the Infra entity block.
    - Test that the 3 Infra relationship tables (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`) appear in the DEPENDENT-rows section (after `infrastructure_points` and after `data_movements`).
    - Test (optional) that the relative order `environments` → `cloud_accounts` → `locations` → `networks` → `subnets` is preserved (FK-dependency-driven).
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/service/ArchitectureCloneServiceInScopeTablesTest.java`
    - Reflection-based access of the static list is acceptable; alternatively assert via `IN_SCOPE_TABLES_IN_ORDER.indexOf(...)` if visibility allows.
  - [x] 1.2 Insert Block A — 12 Infrastructure entity tables + `infrastructure_points` — into `IN_SCOPE_TABLES_IN_ORDER`
    - **Insertion point:** in the base-entity section, after the existing DIAGRAM base block, before the PROJECT-DIRECT `temporary_diagrams` line.
    - **Order (FK-dependency-safe):** `environments`, `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`, `infrastructure_points`.
    - **Why this order:** `environments` first because every other Infra entity carries `environment_id NOT NULL`; `cloud_accounts` second; `locations` third; `networks` then `subnets`; clusters precede resources; `compute_resources` precedes `deployment_units`/`listeners`; `infrastructure_points` last in the block because its 12 typed FKs reference the entity tables above.
    - Place inside its own `// INFRASTRUCTURE …` comment block matching the existing per-domain comment style.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureCloneService.java` (lines 399-488 region)
  - [x] 1.3 Insert Block B — 3 Infrastructure relationship tables — into `IN_SCOPE_TABLES_IN_ORDER`
    - **Insertion point:** in the DEPENDENT-rows section, alongside `data_movements` (after every base entity is in the id-map).
    - **Order:** `resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`.
    - All three reference `infrastructure_points` plus other Infra entity tables, all of which are now upstream in the list.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureCloneService.java`
  - [x] 1.4 Verify no edits required to `OUT_OF_SCOPE_COLUMNS` or column-substitution sets
    - Every new Infra FK target is itself in-scope (intra-architecture), so the existing old→new id map will rewire them automatically during clone.
    - This is a verification-only step — **do not** add Infra entries to these sets.
  - [x] 1.5 Verify `ArchitectureSelectiveCopyService` requires no direct edits
    - `ArchitectureSelectiveCopyService` iterates `IN_SCOPE_TABLES_IN_ORDER` at lines 553, 712, 748 for preflight + commit and inherits this change automatically.
    - This is a verification-only step — **do not** modify `ArchitectureSelectiveCopyService.java`.
  - [x] 1.6 Ensure clone-service tests pass
    - Stage broken tests aside per the implementer convention above.
    - Run ONLY the 2-4 tests written in 1.1.
    - Do NOT run the entire test suite at this stage.
    - Restore staged tests after verification.

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass.
- All 16 Infra tables appear in `IN_SCOPE_TABLES_IN_ORDER` in dependency-safe order (Block A in base section, Block B in DEPENDENT section).
- `OUT_OF_SCOPE_COLUMNS` and column-substitution sets are unchanged.
- `ArchitectureSelectiveCopyService.java` is unchanged.
- Architecture clone now carries Infrastructure rows across (verified by the new test plus inherited test coverage on the broader clone path).

---

### Element Inventory Service Layer

#### Task Group 2: Extend `ArchitectureElementInventoryService` (`DOMAIN_ORDER`, `TABLES_BY_DOMAIN`, `DISPLAY_NAME_FALLBACK_TABLES`)
**Dependencies:** None (independent of Task Group 1, but typically authored after)

- [x] 2.0 Add `"Infrastructure"` to the inventory service's domain ordering, table-by-domain map, and display-name fallback set so the elements-inventory endpoint exposes Infrastructure as a domain entry and the inventory probe degrades gracefully on the 4 name-less Infra tables.
  - [x] 2.1 Write 2-4 focused tests for inventory service coverage of Infra
    - Test that `ArchitectureElementInventoryService.DOMAIN_ORDER` contains `"Infrastructure"` between `"Behavioural"` and `"Diagrams"`.
    - Test that `ArchitectureElementInventoryService.TABLES_BY_DOMAIN.get("Infrastructure")` returns a list of all 16 Infra tables in display order: 12 entity tables → `infrastructure_points` → 3 relationship tables.
    - Test that `ArchitectureElementInventoryService.DISPLAY_NAME_FALLBACK_TABLES` contains `infrastructure_points`, `resource_subnet_hostings`, `deployment_unit_compute_resources`, and `load_balancer_resource_routes` (and that the 12 Infra entity tables are NOT present — they have a `name` column).
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/service/ArchitectureElementInventoryServiceInfrastructureTest.java`
    - Reflection-based access of the package-private static fields is acceptable; alternatively assert via the public surface (e.g. inventory-endpoint method) if available.
  - [x] 2.2 Append `"Infrastructure"` to `DOMAIN_ORDER`
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureElementInventoryService.java` (line 156 region)
    - Insert between `"Behavioural"` and `"Diagrams"`. Final order: `["Applications", "Data", "Business", "UI", "Behavioural", "Infrastructure", "Diagrams"]`.
  - [x] 2.3 Add a 7th `map.put("Infrastructure", List.of(...))` block to `buildTablesByDomain()`
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureElementInventoryService.java` (lines 347-440 region)
    - Final shape (mirrors the 6 existing `map.put(domain, List.of(entry(...), ...))` blocks):
      ```java
      map.put("Infrastructure", List.of(
          entry("environments", "Environments"),
          entry("cloud_accounts", "Cloud Accounts"),
          entry("locations", "Locations"),
          entry("networks", "Networks"),
          entry("subnets", "Subnets"),
          entry("compute_clusters", "Compute Clusters"),
          entry("compute_resources", "Compute Resources"),
          entry("deployment_units", "Deployment Units"),
          entry("load_balancers", "Load Balancers"),
          entry("listeners", "Listeners"),
          entry("data_store_instances", "Data Store Instances"),
          entry("infrastructure_resources", "Infrastructure Resources"),
          entry("infrastructure_points", "Infrastructure Points"),
          entry("resource_subnet_hostings", "Resource-Subnet Hostings"),
          entry("deployment_unit_compute_resources", "Deployment Unit-Compute Mappings"),
          entry("load_balancer_resource_routes", "Load Balancer Routes")
      ));
      ```
    - Display labels can be refined to match a stronger convention if one is found in the existing 6 domain blocks; preserve the invariant from the service Javadoc that `TABLES_BY_DOMAIN` "mirrors `IN_SCOPE_TABLES_IN_ORDER` verbatim, partitioned by domain".
    - Per existing convention (verified): the polymorphic point table and the relationship tables for a domain live under that same domain entry — NOT in a separate `"Relationships"` or `"Points"` domain.
  - [x] 2.4 Append the 4 name-less Infra tables to `DISPLAY_NAME_FALLBACK_TABLES`
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureElementInventoryService.java` (lines 164-188 region)
    - Append, in a new `// Infrastructure …` comment block at the end of the existing set, mirroring the existing comment-grouped style:
      - `infrastructure_points` (polymorphic supertype — discriminator + 12 typed FKs, no `name` column)
      - `resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes` (relationship tables — `tags` but no `name` column)
    - **Do NOT** add any of the 12 Infra entity tables — they all have `name TEXT NOT NULL` per spec 1.
  - [x] 2.5 Ensure inventory-service tests pass
    - Stage broken tests aside per the implementer convention.
    - Run ONLY the 2-4 tests written in 2.1.
    - Do NOT run the entire test suite at this stage.
    - Restore staged tests after verification.

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass.
- `DOMAIN_ORDER` contains `"Infrastructure"` between `"Behavioural"` and `"Diagrams"`.
- `TABLES_BY_DOMAIN.get("Infrastructure")` returns all 16 Infra tables in display order, mirroring the verbatim `IN_SCOPE_TABLES_IN_ORDER` invariant per the service Javadoc.
- `DISPLAY_NAME_FALLBACK_TABLES` contains the 4 name-less Infra tables, preventing `BadSqlGrammarException` on `SELECT id, name FROM infrastructure_points` etc.
- Element-inventory endpoint (`GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory`) now returns Infrastructure as a domain entry; SelectiveCopyElementPicker tree gains an Infrastructure node.

---

### Controller Layer

#### Task Group 3: `MockMvc` Controller Round-Trip Test for Full-Model PUT/GET
**Dependencies:** None (verifies spec 1's `ModelService` plumbing at the HTTP edge — does not require Task Groups 1 or 2)

- [x] 3.0 Add a `MockMvc`-based controller round-trip test that `PUT`s an Infrastructure-bearing payload to `/api/model/projects/{projectId}/architectures/{architectureId}` and `GET`s it back, asserting every Infra list round-trips and at least one polymorphic `InfrastructurePoint` reference resolves.
  - [x] 3.1 Write 2-4 focused tests for the controller-level round trip
    - Test: `PUT` then `GET` round-trips a payload covering a representative subset of Infra entities (at minimum: 1 `environment`, 1 `cloud_account`, 1 `compute_cluster`, 1 `compute_resource`, 1 `deployment_unit`); assert each list size and key fields via `jsonPath(...)`.
    - Test: `PUT` then `GET` round-trips populated `infrastructure_points` rows and at least one row in each of the 3 relationship tables (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`).
    - Test: at least one assertion exercises an Infra relationship referencing an `InfrastructurePoint` polymorphically — e.g. a `deployment_unit_compute_resources` row whose `compute_infrastructure_point_id` resolves to an `InfrastructurePoint` with `point_kind = COMPUTE_RESOURCE` or `COMPUTE_CLUSTER`. Assert the `point_kind` is preserved and the typed FK on the resolved point matches the expected entity id.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ModelControllerInfrastructureRoundTripTest.java`
  - [x] 3.2 Set up the test scaffolding using the existing controller-test convention
    - `@ExtendWith(MockitoExtension.class)`.
    - `MockMvcBuilders.standaloneSetup(modelController).setControllerAdvice(new GlobalExceptionHandler()).build()`.
    - `@Mock`-injected `ModelService` collaborator (or whichever collaborators `ModelController` constructor takes).
    - Assertions via `MockMvcResultMatchers.jsonPath(...)` and `status()`.
    - **Reference:** `ArchitectureSelectiveCopyControllerTest`, `ArchitectureCrudControllerTest` for the standalone-setup boilerplate.
  - [x] 3.3 Build the Infrastructure-bearing `MetaModelDto` payload
    - Construct a `MetaModelDto` whose `entities` (`MetaModelEntitiesDto`) and `relationships` (`MetaModelRelationshipsDto`) include populated Infra lists.
    - At minimum: 1 `environment`, 1 `cloud_account`, 1 `location`, 1 `network`, 1 `subnet`, 1 `compute_cluster`, 1 `compute_resource`, 1 `deployment_unit`, 1 `load_balancer`, 1 `listener`, 1 `data_store_instance`, 1 `infrastructure_resource`, 2 `infrastructure_points` (one with `point_kind = COMPUTE_RESOURCE` referencing the `compute_resource_id`, one with `point_kind = COMPUTE_CLUSTER` referencing the `compute_cluster_id`), 1 row each in `resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`.
    - **Reference:** spec 1's `ModelService*Test` payload builders (under `architecture-model-service/src/test/`) — lift the Infra payload shape and reframe it into a `MetaModelDto` for `ModelController.saveModel(...)`.
    - The `deployment_unit_compute_resources` row's `compute_infrastructure_point_id` must point at one of the populated `infrastructure_points` rows so the polymorphic assertion has something to resolve against.
  - [x] 3.4 Implement the `PUT` then `GET` flow with `jsonPath` assertions
    - `PUT /api/model/projects/{projectId}/architectures/{architectureId}?filename=infrastructure-roundtrip-test.yaml` with the payload from 3.3 — assert HTTP 200/204 (whichever the existing `ModelController` returns).
    - `GET /api/model/projects/{projectId}/architectures/{architectureId}` — assert HTTP 200.
    - Assert via `jsonPath(...)`: every Infra list size matches the payload, key fields on representative rows survive (e.g. `environments[0].name`, `infrastructure_points[?(@.point_kind == 'COMPUTE_RESOURCE')].compute_resource_id`).
    - Polymorphic assertion: locate the `deployment_unit_compute_resources[0]` row in the response, follow `compute_infrastructure_point_id` back to the `infrastructure_points` list, and assert `point_kind` and the matching typed FK column.
  - [x] 3.5 Ensure controller round-trip tests pass
    - Stage broken tests aside per the implementer convention.
    - Run ONLY the 2-4 tests written in 3.1.
    - Do NOT run the entire test suite at this stage.
    - Restore staged tests after verification.

**Acceptance Criteria:**
- The 2-4 tests written in 3.1 pass.
- `PUT` then `GET` round-trip preserves all 12 Infra entity lists, `infrastructure_points`, and the 3 relationship lists.
- At least one polymorphic `InfrastructurePoint` reference resolves correctly through the controller layer.
- Test class follows the standalone `MockMvc` convention from `ArchitectureSelectiveCopyControllerTest` / `ArchitectureCrudControllerTest`.
- No new endpoints are added — the test exercises only existing `ModelController` GET/PUT.

---

### Test Coverage Gap Analysis

#### Task Group 4: Controller-Level Scoping Test and Coverage Gap Review
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Review existing tests, fill the controller-level scoping gap, and add up to 6 strategic tests maximum to close any remaining critical gaps for THIS spec only.
  - [x] 4.1 Review existing tests from Task Groups 1-3
    - Review the 2-4 tests written by Task 1.1 (clone service in-scope tables).
    - Review the 2-4 tests written by Task 2.1 (inventory service domain order, tables-by-domain, fallback set).
    - Review the 2-4 tests written by Task 3.1 (controller round trip).
    - Total existing tests: approximately 6-12 tests.
  - [x] 4.2 Analyse test coverage gaps for THIS spec only
    - Identify gaps tied to acceptance criteria from `requirements.md` that aren't already covered by Task Groups 1-3.
    - **Priority gap (required):** controller-level project + architecture scoping — assert that an Infra-bearing model honours the existing `model_files.findByProjectIdAndArchitectureId` 3-step check.
    - **Optional secondary gaps** (only add if not already covered by 3.1):
      - Inverse polymorphic case (e.g. `point_kind = COMPUTE_CLUSTER` round-trips, if 3.1 only covers `COMPUTE_RESOURCE`).
      - Empty/omitted Infra-list backwards-compat assertion (delete-and-replace wipes Infra cleanly when payload omits it).
    - Focus ONLY on this spec's surface; do NOT assess broader application test coverage.
    - Skip gaps already comprehensively tested by spec 1 at the `ModelService` layer (round-trip plumbing, mapper correctness, JPA constraint enforcement).
  - [x] 4.3 Write up to 6 strategic tests maximum to fill identified gaps
    - **Scoping test (required, 1 test):** add a controller-level negative-path assertion — `GET` (or `PUT`) on `/api/model/projects/{wrongProjectId}/architectures/{architectureId}` with an Infra-bearing scenario returns 404 and persists no Infra rows. Inherit the existing 3-step pattern verbatim — `findByProjectIdAndArchitectureId` → load → assert `modelFileId` match → `ResourceNotFoundException` mapped to 404 by `GlobalExceptionHandler`. Add to the same test class as Task 3 (`ModelControllerInfrastructureRoundTripTest`) or a sibling test class as preferred.
    - **Inverse polymorphic test (optional, 1 test):** if 3.1 only covered `point_kind = COMPUTE_RESOURCE`, add a round-trip assertion for `point_kind = COMPUTE_CLUSTER` on `deployment_unit_compute_resources.compute_infrastructure_point_id`.
    - **Backwards-compat test (optional, 1 test):** `PUT` an Infra-bearing payload, then `PUT` a payload omitting Infra lists, then `GET` — assert all Infra lists are now empty (delete-and-replace). Confirms the spec-1 omitted-list behaviour is preserved at the controller edge.
    - **Hard cap:** 6 tests total. If only the scoping test is needed, add only that. Do NOT add coverage for spec-1 surface (already covered) or for out-of-scope features (per-entity CRUD, summary DTOs, frontend).
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ModelControllerInfrastructureRoundTripTest.java` (extend existing class) or a new sibling class as preferred (e.g. `ModelControllerInfrastructureScopingTest.java`).
    - **Note:** if existing non-Infra `ModelController` tests already cover the negative-path scoping pattern generically, a single Infra-payload re-run of one of them is sufficient — the controller logic is shared, and the goal is to assert Infra rows don't bypass it.
  - [x] 4.4 Run feature-specific tests only
    - Stage broken tests aside per the implementer convention.
    - Run ONLY the tests from Task Groups 1.1, 2.1, 3.1, and 4.3.
    - Expected total: approximately 8-18 tests.
    - Do NOT run the entire application test suite.
    - Verify all critical workflows pass.
    - Restore staged tests after verification.

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 8-18 tests total).
- Controller-level project + architecture scoping is verified for Infra-bearing payloads (404 on cross-project/architecture mismatch).
- All 11 acceptance criteria from `spec.md` (lines 80-92) are demonstrably satisfied — by spec 1's plumbing + spec 2's controller surface + spec 2's tests.
- All 3 emerging acceptance criteria (lines 95-97 of `spec.md`: clone carries Infra, inventory endpoint includes Infra, name-fallback covers the 4 name-less Infra tables) are demonstrably satisfied.
- No more than 6 additional tests added when filling gaps.
- Existing non-Infra controller tests are not modified or regressed.

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: `ArchitectureCloneService` extension** — extend `IN_SCOPE_TABLES_IN_ORDER` with the 16 Infra tables. Independent and self-contained.
2. **Task Group 2: `ArchitectureElementInventoryService` extension** — extend `DOMAIN_ORDER`, `TABLES_BY_DOMAIN`, `DISPLAY_NAME_FALLBACK_TABLES`. Independent of Task Group 1.
3. **Task Group 3: `MockMvc` controller round-trip test** — add the new test class exercising full-model PUT/GET on an Infra-bearing payload. Verifies spec 1's `ModelService` plumbing at the HTTP edge.
4. **Task Group 4: Scoping test + gap analysis** — add the negative-path scoping test plus up to 5 more strategic tests if any critical gaps remain. Closes out the spec.

Task Groups 1 and 2 can run in parallel; Task Group 3 can also run in parallel with 1 and 2 (it does not depend on either). Task Group 4 must run last because it reviews the tests added by 1, 2, and 3.

---

## File Summary

### Files to Modify (3)
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureCloneService.java`
  - Extend `IN_SCOPE_TABLES_IN_ORDER` with Block A (13 tables) + Block B (3 tables).
  - No edits to `OUT_OF_SCOPE_COLUMNS` or column-substitution sets.
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureElementInventoryService.java`
  - Append `"Infrastructure"` to `DOMAIN_ORDER` (line 156 region).
  - Add `map.put("Infrastructure", List.of(...))` block to `buildTablesByDomain()` (line 347-440 region).
  - Append 4 name-less Infra tables to `DISPLAY_NAME_FALLBACK_TABLES` (line 164-188 region).
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureSelectiveCopyService.java`
  - **No edits** — inherits `IN_SCOPE_TABLES_IN_ORDER` change automatically.

### Test Files to Create (1-3)
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/ArchitectureCloneServiceInScopeTablesTest.java` (Task 1.1)
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/ArchitectureElementInventoryServiceInfrastructureTest.java` (Task 2.1)
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ModelControllerInfrastructureRoundTripTest.java` (Task 3.1, optionally extended in Task 4.3 — or split off `ModelControllerInfrastructureScopingTest.java` as a sibling class)

---

## Reference Patterns

### Existing Code to Follow

- **`ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`** (`architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureCloneService.java`, lines 399-488)
  - Authoritative ordered list of architecture-scoped tables.
  - Existing structure: ROOT (`model_files`) → BUSINESS base → DATA base → APPLICATION base → INTERACTION base → BEHAVIOURAL base → UI base → DIAGRAM base → PROJECT-DIRECT meta-model (`temporary_diagrams`) → DEPENDENT rows (relationships, joins, nested rows).
  - Extend by inserting Block A in the base-entity section (after Diagrams base, before `temporary_diagrams`) and Block B in the DEPENDENT-rows section. **Do not refactor** the literal — append in place.

- **`ArchitectureElementInventoryService.buildTablesByDomain()`** (same package, lines 347-440)
  - Six existing `map.put(domain, List.of(entry(...), ...))` blocks are the template for the 7th `"Infrastructure"` block.
  - Mirror the exact shape — display-name strings, comment-grouped style, both the polymorphic point table and relationship tables under the owning domain entry (NOT in a separate `"Relationships"`/`"Points"` domain).

- **`ArchitectureElementInventoryService.DOMAIN_ORDER`** (line 156)
  - `List.of(...)` literal; append `"Infrastructure"` between `"Behavioural"` and `"Diagrams"`.

- **`ArchitectureElementInventoryService.DISPLAY_NAME_FALLBACK_TABLES`** (lines 164-188)
  - Flat `Set<String>` of tables without a `name` column, comment-grouped by source domain.
  - Append a new `// Infrastructure …` block with the 4 name-less Infra tables.

- **Controller-test scaffolding**
  - `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ArchitectureSelectiveCopyControllerTest.java`
  - `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ArchitectureCrudControllerTest.java`
  - Standalone `MockMvc` setup with `GlobalExceptionHandler`, `@Mock`-injected service collaborators, `jsonPath(...)` assertions. Copy this scaffolding for the new `ModelControllerInfrastructureRoundTripTest`.

- **Spec 1 round-trip test payloads** (under `architecture-model-service/src/test/`)
  - Spec 1's payload builders construct `MetaModelEntitiesDto` + `MetaModelRelationshipsDto` populated with all 16 Infra types. Lift the Infra payload shape into the controller-level `MetaModelDto` required by `ModelController.saveModel(...)`.

- **3-step controller-layer scoping pattern** (`ModelEntityController`)
  - Repeated verbatim in all 3 existing GETs: `model_files.findByProjectIdAndArchitectureId` → load entity → assert `modelFileId` match → `ResourceNotFoundException` → 404 via `GlobalExceptionHandler`.
  - The scoping test in Task 4.3 asserts an Infra-bearing payload still flows through this exact path. **No new code is introduced.**

### Key Decisions to Honour

- **Q1 (raw idea) / Pass-C #1, #4:** Full-model GET/PUT remains the only Infra-touching API surface. **No** per-Infra POST/PUT/DELETE endpoints. **No** discovery-facing GET-by-id endpoints. **No** `ModelEntityController` extension.
- **Q2:** Extend `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` with all 16 Infra tables in dependency-safe order. `ArchitectureSelectiveCopyService` inherits this list, so no separate Infra wiring is needed there.
- **Q3:** Append `"Infrastructure"` to `DOMAIN_ORDER` between `"Behavioural"` and `"Diagrams"`. Include all 16 Infra tables in `TABLES_BY_DOMAIN.get("Infrastructure")` per the verified existing convention (polymorphic point + relationships under the owning domain). Add the 4 name-less Infra tables to `DISPLAY_NAME_FALLBACK_TABLES`.
- **Q4:** `MockMvc` standalone setup with `GlobalExceptionHandler` is the required test convention. Same pattern as `ArchitectureSelectiveCopyControllerTest` / `ArchitectureCrudControllerTest`.
- **Q5:** **Do NOT** extend `MetaModelSummaryDto` or `MetaModelSummaryController`. Deferred to a later spec.
- **Q6:** Keep delete-and-replace semantics for full-model save. Omitted/empty Infra lists in incoming payloads wipe all Infra data for the architecture. Already handled by spec 1's `ModelService` extensions; this spec adds no save-path code.
- **Q7:** Inherit the existing 3-step controller pattern for cross-project / cross-architecture validation. **No** new validation framework, **no** new DB-level cross-project guard.
- **Pass-C #3:** **No** edits to `ArchitectureCloneService.OUT_OF_SCOPE_COLUMNS` / column-substitution audit-set — every new Infra FK target is itself in-scope (intra-architecture). The existing old→new id map will rewire them automatically.
- **Pre-existing broken tests:** stage them aside, run targeted tests, restore. Do **not** attempt to fix them in this spec.

# Spec Requirements: Infrastructure Domain Backend API

## Initial Description

Add backend API and model persistence integration for the new Infrastructure Architecture domain in the Spring Boot `architecture-model-service`.

This is **spec 2 of 7** in the Infrastructure rollout. Spec 1 (`2026-05-04-infrastructure-domain-backend-foundation`) has already merged the model foundation:

- 16 Liquibase changesets (098–113), 16 JPA entities, 16 DTOs, 16 repositories.
- `EntityMapper` extended (DTO ↔ Entity for all 16 types).
- `MetaModelEntitiesDto` extended with 13 new lists (`environments` … `infrastructure_points`).
- `MetaModelRelationshipsDto` extended with 3 new lists (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`).
- `ModelService.saveModel` / `loadModelByFileId` / `loadModelByProjectIdAndArchitectureId` / `deleteAllDataForModelFile` extended for all 16 new repos in dependency-safe order.
- 33 spec tests covering full round-trip via `ModelService` directly.

The full raw idea is preserved at `agent-os/specs/2026-05-04-infrastructure-domain-backend-api/planning/00-raw-idea.md`. Codebase-grounding observations driving spec scope are preserved at `planning/codebase-grounding.md`.

## Requirements Discussion

The grounding pass against the existing controller surface revealed that several "API expansion" obligations in the raw idea (per-domain entity CRUD, discovery-facing GET-by-id endpoints) **do not exist for any other domain** today, and that several architecture-level table-list services hardcode the in-scope schema and would silently drop Infrastructure unless extended. The questions below resolve which obligations apply to this spec.

### First Round Questions (Pass B)

**Q1: Per-domain entity CRUD — should this spec add per-Infra POST/PUT/DELETE endpoints, or discovery-facing `GET-by-id` endpoints (mirroring the 3 existing `services` / `applications` / `app_components` GETs)?**
**Answer:** Stay full-model-save-only for Infrastructure. **No** per-Infra POST/PUT/DELETE endpoints. **No** discovery-facing GET-by-id endpoints in this spec. The only API surface for Infrastructure remains the existing full-model `GET` and `PUT` on `/api/model/projects/{projectId}/architectures/{architectureId}`, which is already Infra-aware via spec 1.

**Q2: Architecture clone coverage — extend `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` to include all 16 new Infra tables?**
**Answer:** Yes. Extend `IN_SCOPE_TABLES_IN_ORDER` to include all 16 new tables in dependency-safe order: 12 entity tables → `infrastructure_points` → 3 relationship tables. Match the existing pattern (entity tables in the early base-entity section, relationship tables in the dependent-rows section like `data_movements`). `ArchitectureSelectiveCopyService` inherits this list, so no separate Infra wiring is needed there.

**Q3: Element inventory + selective-copy picker tree — add an `"Infrastructure"` domain entry to `ArchitectureElementInventoryService.TABLES_BY_DOMAIN`?**
**Answer:** Yes. Add `"Infrastructure"` to `DOMAIN_ORDER` after `"Behavioural"`, before `"Diagrams"`. Conditional inclusion rules:
- Include `infrastructure_points` only if existing point tables (`application_points`, `business_points`, `data_entity_points`) appear in `TABLES_BY_DOMAIN` — mirror their placement.
- Include the 3 Infra relationship tables only if other relationship tables (e.g. `data_movements`, `business_user_business_points`) appear in `TABLES_BY_DOMAIN` — mirror their placement.
- Add `infrastructure_points` to `DISPLAY_NAME_FALLBACK_TABLES` only if existing point tables appear there (no `name` column convention).

**Verification pass against `ArchitectureElementInventoryService.java` source confirms:**
- `application_points`, `business_points`, `data_entity_points` ALL appear in `TABLES_BY_DOMAIN` (in Applications, Business, Data domains respectively) → **`infrastructure_points` IS included in the new `"Infrastructure"` domain entry.**
- `data_movements`, `business_user_business_points`, `application_point_business_points`, `application_point_business_logics`, `user_journey_links`, `logical_data_entity_relationships`, `state_transitions`, `activity_flows` etc. ALL appear in `TABLES_BY_DOMAIN` (under their owning entity domain, not as a separate relationships domain) → **the 3 Infra relationship tables ARE included in the new `"Infrastructure"` domain entry.**
- `business_user_business_points`, `application_point_business_points`, `application_point_business_logics`, `user_journey_links`, `logical_data_entity_relationships`, `logical_data_entity_physical_data_entities`, `logical_data_attribute_physical_data_attributes`, `interface_logical_entities`, `state_transitions`, `activity_flows`, `ui_workflow_transitions`, `diagram_nodes`, `diagram_edges`, `diagram_decorations`, `diagram_interaction_edges`, `package_set_default_rules`, `package_set_standards_import_status` all appear in `DISPLAY_NAME_FALLBACK_TABLES` → **`infrastructure_points` IS added to `DISPLAY_NAME_FALLBACK_TABLES`** (it has no `name` column — it is a polymorphic supertype indexed by `point_kind` + 12 typed FKs).
- The 3 Infra relationship tables (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`) DO have a `tags` column but no `name` column. Mirroring the existing convention for relationship-style tables in `DISPLAY_NAME_FALLBACK_TABLES`, they should ALSO be added to `DISPLAY_NAME_FALLBACK_TABLES`.

The final shape of the `"Infrastructure"` entry in `TABLES_BY_DOMAIN` is documented under **Inventory Service Changes** below.

**Q4: Controller-level tests — `MockMvc`-based, or extend the existing spec-1 `ModelService` tests?**
**Answer:** `MockMvc`. Add at least one round-trip test that `PUT`s an Infra payload to `/api/model/projects/{projectId}/architectures/{architectureId}`, then `GET`s the same URL and verifies Infra entities + relationships round-trip. Use the existing controller-test convention: `@ExtendWith(MockitoExtension.class)`, `MockMvcBuilders.standaloneSetup(...).setControllerAdvice(new GlobalExceptionHandler())`, `MockMvcResultMatchers.jsonPath(...)`. Same pattern as `ArchitectureSelectiveCopyControllerTest` and `ArchitectureCrudControllerTest`.

**Q5: `MetaModelSummaryDto` — extend with Infra summary fields for LLM context?**
**Answer:** Leave `MetaModelSummaryDto` and `MetaModelSummaryController` untouched in this spec. Defer Infra LLM-context summary to a later spec.

**Q6: Save semantics for omitted/empty Infra lists — keep delete-and-replace, or add merge/PATCH semantics?**
**Answer:** Keep delete-and-replace, identical to every other domain. Omitted or empty Infra lists in an incoming payload wipe all Infra data for the architecture (footgun acknowledged — this is the existing pipeline behaviour and changing it for Infra alone would diverge from every other domain).

**Q7: Cross-project / cross-architecture validation — introduce a new sweep-style validation framework, or inherit the existing 3-step controller pattern?**
**Answer:** Inherit the existing pattern. The existing 3-step lookup at the controller layer (`findByProjectIdAndArchitectureId` → load entity → assert `modelFileId` match → 404 on mismatch via `ResourceNotFoundException` + `GlobalExceptionHandler`) is the convention. No new sweep-style validation framework. No new DB-level cross-project guard. Since this spec adds NO per-Infra entity endpoints (Q1), no new controller-layer validation code is added either — the existing full-model controller already enforces project + architecture scoping via path variables and `model_files.findByProjectIdAndArchitectureId`.

**Q8: Anything else explicitly out of scope beyond the raw idea's existing list?**
**Answer:** Yes, six additional explicit exclusions tied to the decisions above:
1. `MetaModelSummaryDto` changes (Q5).
2. Granular per-entity CRUD endpoints (Q1).
3. Discovery-facing Infra GET-by-id endpoints (Q1).
4. PATCH / merge semantics for full-model save (Q6).
5. New validation framework (Q7).
6. Frontend clone / selection UI changes (out of scope per raw idea; reaffirmed).

### Inferred Decisions (Pass C — all 10 accepted)

These were inferred from the codebase grounding and accepted by the user without override:

1. **Full-model GET/PUT remains the only Infra-touching API surface.** The existing `/api/model/projects/{projectId}/architectures/{architectureId}` GET and PUT are already Infra-aware via spec 1's `ModelService` extensions. No new endpoints are introduced.
2. **`ArchitectureSelectiveCopyService` requires no direct edits.** It iterates `IN_SCOPE_TABLES_IN_ORDER` (lines 553, 712, 748), so updating that list (Q2) is sufficient to bring Infra into preflight + commit.
3. **`ArchitectureCloneService.OUT_OF_SCOPE` / column-substitution audit-set need no edits**, because the new Infra FKs are intra-architecture (FK targets are themselves in-scope tables). The existing old→new id map will rewire them automatically.
4. **`InfrastructurePoint` is NOT exposed as a standalone resource.** Existing `ApplicationPoint`, `BusinessPoint`, and `DataEntityPoint` are not exposed via dedicated controllers (zero matches in the controller layer); `InfrastructurePoint` follows the same convention.
5. **Snake_case JSON names match spec 1.** `environments`, `cloud_accounts`, …, `infrastructure_points`, `resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`. Already wired in `MetaModelEntitiesDto` / `MetaModelRelationshipsDto`.
6. **Backwards compatibility is preserved by construction.** Omitted Infra lists in incoming payloads are handled identically to any other omitted domain (delete-and-replace wipes them — Q6). Empty lists behave the same.
7. **Test coverage scope.** New tests cover (a) full-model GET round-trip including Infra, (b) full-model PUT round-trip including Infra, (c) at least one Infra relationship using `InfrastructurePoint` polymorphically, (d) project/architecture scoping enforcement via the existing controller pattern (the round-trip test naturally exercises this since the controller looks up `model_files.findByProjectIdAndArchitectureId` first).
8. **Pre-existing broken tests are out of scope.** Spec 1 left 9 `ModelService*Test` files staged in `/tmp/staged-broken-tests/` plus ~112 unrelated pre-existing broken test files. This spec does not fix them unless they directly test surface this spec adds. Implementer convention: stage broken tests aside, run targeted tests, restore.
9. **`ModelEntityController` is left untouched.** Its 3 existing `GET-by-id` endpoints (`services`, `applications`, `app_components`) exist for `discovery-service`. Adding 12 new Infra GETs would create surface area no consumer needs in this spec (Q1).
10. **Other model-shape controllers stay unchanged**: `ModelInterfacesController`, `OasSpecController`, `MetaModelSummaryController`, `BootstrapController`, `ProjectArtifactController`. None enumerate per-domain entities; none need Infra wiring in this spec.

### Existing Code to Reference

Verified against the live codebase during the verification pass:

- **`ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`** (`architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureCloneService.java`, lines 399–488) — the authoritative ordered list of architecture-scoped tables. Existing structure: ROOT (`model_files`) → BUSINESS base → DATA base (incl. `data_entity_points`) → APPLICATION base (incl. `application_points`) → INTERACTION base → BEHAVIOURAL base → UI base → DIAGRAM base → PROJECT-DIRECT meta-model (`temporary_diagrams`) → DEPENDENT rows (relationships, joins, nested rows). Infra extension mirrors this: 12 entity tables in the base section (after Diagrams base, before `temporary_diagrams`, in their own block) → `infrastructure_points` → 3 relationship tables in the dependent-rows section.
- **`ArchitectureElementInventoryService.TABLES_BY_DOMAIN`** + `DOMAIN_ORDER` (same package, lines 138–145, 156, 347–440) — six-entry `LinkedHashMap` keyed by domain name with ordered `(table, displayName)` lists.
- **`ArchitectureElementInventoryService.DISPLAY_NAME_FALLBACK_TABLES`** (same file, lines 164–188) — flat `Set<String>` of tables without a `name` column.
- **Controller-test convention**: `ArchitectureSelectiveCopyControllerTest`, `ArchitectureCrudControllerTest` — `@ExtendWith(MockitoExtension.class)`, `MockMvcBuilders.standaloneSetup(...).setControllerAdvice(new GlobalExceptionHandler())`, `MockMvcResultMatchers.jsonPath(...)`.
- **3-step controller-layer scoping pattern**: repeated verbatim in all 3 `ModelEntityController` GETs — `model_files.findByProjectIdAndArchitectureId` → load entity → assert `modelFileId` match → `ResourceNotFoundException` on mismatch.
- **`ModelController`** (`/api/model`) — full-model GET/PUT entry points already Infra-aware via spec 1.
- **Spec 1 round-trip tests** in `ModelService*Test` — the model-layer round-trip is already covered. Spec 2 adds the controller-layer round-trip.

### Follow-up Questions

No follow-up questions were needed. All 8 Pass B questions resolved on first pass; all 10 Pass C inferred decisions accepted as-is.

## Visual Assets

### Files Provided

Bash check on `agent-os/specs/2026-05-04-infrastructure-domain-backend-api/planning/visuals/` returned no image/PDF files. The folder exists but is empty.

No visual assets provided.

### Visual Insights

N/A — backend-only spec, no UI artefacts. Reference behaviour is the existing `IN_SCOPE_TABLES_IN_ORDER` / `TABLES_BY_DOMAIN` / `DISPLAY_NAME_FALLBACK_TABLES` listings and the existing `ModelController` full-model GET/PUT contract.

## Requirements Summary

The actual change surface for this spec is narrow — five concrete edit points in two services and one new test class.

### Functional Requirements

1. **Architecture clone must include Infrastructure**: extend `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` so cloning an architecture (`POST /api/projects/{projectId}/architectures/{sourceArchitectureId}/clone`) carries every Infrastructure row across.
2. **Element inventory must include Infrastructure**: extend `ArchitectureElementInventoryService.TABLES_BY_DOMAIN` + `DOMAIN_ORDER` so `GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory` returns Infrastructure as a domain entry, populating the SelectiveCopyElementPicker tree.
3. **Display-name fallback must cover `infrastructure_points`** (and the 3 Infra relationship tables, which have no `name` column) so the inventory probe falls back to id-only display rather than throwing on `SELECT name FROM …`.
4. **Selective-copy preflight + commit must include Infrastructure**: this is automatic once #1 lands (`ArchitectureSelectiveCopyService` iterates `IN_SCOPE_TABLES_IN_ORDER`). No direct edits.
5. **Full-model GET/PUT round-trip controller-level test coverage for Infrastructure**: at least one `MockMvc` test that `PUT`s an Infra-bearing model payload and `GET`s it back, asserting all 12 entity lists, `infrastructure_points`, and the 3 relationship lists round-trip via the controller (not just `ModelService`). At least one assertion exercises an Infra relationship referencing an `InfrastructurePoint` polymorphically.
6. **Project + architecture scoping is exercised by the round-trip test**: because the existing `ModelController` performs `model_files.findByProjectIdAndArchitectureId` before saving/loading, the round-trip test naturally validates that Infra rows are scoped to the correct `projectId` + `architectureId`. Add at least one negative-path assertion (e.g. GET with a wrong `projectId` returns 404) if the existing controller-test coverage for the negative path doesn't already cover it for Infra-bearing models.

### Change Surface (concrete file edits)

#### 1. `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` extension

Append the 16 new Infrastructure tables to `IN_SCOPE_TABLES_IN_ORDER` in dependency-safe order. Two insertion blocks:

**Block A — 12 Infrastructure entity tables + `infrastructure_points`** (insert in the base-entity section, after the existing DIAGRAM base block, before the PROJECT-DIRECT `temporary_diagrams` line):

```
// INFRASTRUCTURE domain (base entities — Environment first because every
// other Infra entity references environments(id); Cloud Account / Location
// next because most other Infra entities reference them; then Networks /
// Subnets / Compute / Compute Resource / Deployment Unit / Load Balancer /
// Listener / Data Store Instance / Infrastructure Resource. infrastructure_points
// last in the entity block because its 12 typed FKs all reference the entity
// tables above.)
"environments",
"cloud_accounts",
"locations",
"networks",
"subnets",
"compute_clusters",
"compute_resources",
"deployment_units",
"load_balancers",
"listeners",
"data_store_instances",
"infrastructure_resources",
"infrastructure_points",
```

**Block B — 3 Infrastructure relationship tables** (insert in the DEPENDENT rows section, alongside `data_movements` etc.):

```
"resource_subnet_hostings",
"deployment_unit_compute_resources",
"load_balancer_resource_routes"
```

Order rationale (within Block A):
- `environments` first — every other Infra entity carries `environment_id` NOT NULL.
- `cloud_accounts` second — depends only on `environments`.
- `locations` third — depends on `environments` + optional `cloud_accounts`.
- `networks` fourth — depends on `environments` + optional `cloud_accounts`/`locations`.
- `subnets` fifth — depends on `networks` + `environments` + optional `locations`.
- `compute_clusters`, `compute_resources` — depend on the above; `compute_resources.cluster_id` references `compute_clusters` so clusters precede resources.
- `deployment_units` — depends on `services` (already earlier in the list via APPLICATION base).
- `load_balancers`, `listeners` — listener depends on `load_balancers` (and on `compute_resources` via direct FK, both already preceding).
- `data_store_instances`, `infrastructure_resources` — independent of all other Infra entities.
- `infrastructure_points` last in the block — its 12 typed FKs all reference the entity tables above.

Order rationale (Block B): all 3 relationships reference `infrastructure_points` (Block A) plus other entity tables, so they go in the DEPENDENT section after every base entity is in the id-map.

No edits to `OUT_OF_SCOPE_COLUMNS` / column-substitution sets — every new Infra FK target is itself in-scope (intra-architecture).

#### 2. `ArchitectureElementInventoryService.TABLES_BY_DOMAIN` + `DOMAIN_ORDER` extension

**`DOMAIN_ORDER` change** — insert `"Infrastructure"` after `"Behavioural"`, before `"Diagrams"`:

```java
static final List<String> DOMAIN_ORDER = List.of(
    "Applications",
    "Data",
    "Business",
    "UI",
    "Behavioural",
    "Infrastructure",   // NEW
    "Diagrams"
);
```

**`TABLES_BY_DOMAIN` change** — add a new `"Infrastructure"` entry built in `buildTablesByDomain()`. Final shape (per Q3 verification: existing convention puts BOTH the polymorphic point table AND the relationship tables under the owning entity domain, so the Infrastructure entry includes ALL 16 Infra tables in display order):

```java
// INFRASTRUCTURE — environment hierarchy, location, network/subnet,
// compute, deployment, load balancing, data stores, generic resources,
// the polymorphic infrastructure_points supertype, and the 3 Infra
// relationships (mirrors how existing domains include their points and
// relationships in the same domain entry).
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

(Display-name strings should match the conventions used in the spec-1 DTO display labels and existing TABLES_BY_DOMAIN entries — implementer can refine if a stronger convention exists.)

Per the inventory service Javadoc, the `TABLES_BY_DOMAIN` map "mirrors `IN_SCOPE_TABLES_IN_ORDER` verbatim, partitioned by domain". Including all 16 Infra tables here keeps that invariant.

#### 3. `DISPLAY_NAME_FALLBACK_TABLES` extension

Add 4 entries to the existing `Set<String>`:

```java
// Infrastructure polymorphic supertype — discriminator + 12 typed FKs,
// no name column.
"infrastructure_points",

// Infrastructure relationships — tags but no name column.
"resource_subnet_hostings",
"deployment_unit_compute_resources",
"load_balancer_resource_routes",
```

Place them in a new `// Infrastructure …` comment block at the end of the existing set, mirroring the existing comment-grouped style.

(Verification note: the 12 Infra entity tables all have a `name` column NOT NULL per spec-1, so they do NOT belong in `DISPLAY_NAME_FALLBACK_TABLES`. Only `infrastructure_points` and the 3 relationships go in.)

#### 4. `MockMvc` controller round-trip test

New test class — name suggestion: `ModelControllerInfrastructureRoundTripTest` — alongside existing `ModelController` tests. Convention:

- `@ExtendWith(MockitoExtension.class)` standalone setup with `GlobalExceptionHandler`.
- Build a `MetaModelDto` payload covering a representative selection of Infra entities + at least one row in each of the 3 relationship tables, with at least one relationship using `InfrastructurePoint` polymorphically (e.g. an `InfrastructurePoint` with `point_kind = COMPUTE_RESOURCE` referenced by a `deployment_unit_compute_resources` row via `compute_infrastructure_point_id`).
- `PUT` the payload to `/api/model/projects/{projectId}/architectures/{architectureId}?filename=…`.
- `GET` the same URL.
- Assert the response body via `jsonPath(...)` round-trips every Infra list with the expected sizes and the expected polymorphic reference resolves.

#### 5. Controller-level scoping/validation tests

Mirror the round-trip test with at least one negative-path assertion that satisfies the acceptance criterion *"Infrastructure entities/relationships are scoped to the correct project and architecture"*. Suggested cases (one or both, depending on existing controller-test coverage of the negative path):
- `GET` with a `projectId` that doesn't own the `architectureId` → 404 (existing controller behaviour, but assert that an Infra-bearing model still produces 404 not a leak).
- `PUT` with mismatched scoping → 404, no Infra rows persisted.

If the existing `ModelController` tests already cover these negative paths for non-Infra payloads, a single Infra-payload re-run of one of them is sufficient — the controller logic is shared, and we're asserting that Infra rows don't bypass it.

### Reusability Opportunities

- **`ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`** — extend the existing `List.of(...)` literal; do not refactor.
- **`ArchitectureElementInventoryService.buildTablesByDomain()`** — add a `map.put("Infrastructure", List.of(...))` call mirroring the 6 existing `map.put(...)` blocks.
- **`ArchitectureElementInventoryService.DISPLAY_NAME_FALLBACK_TABLES`** — append to the existing `Set.of(...)` literal.
- **Controller-test scaffolding**: copy the standalone-setup boilerplate from `ArchitectureSelectiveCopyControllerTest` / `ArchitectureCrudControllerTest`.
- **Round-trip test payload construction**: use spec-1's `ModelService*Test` payload builders as a starting point; lift the Infra-bearing payload into a `MetaModelDto` shaped for `ModelController.saveModel(...)`.

### Scope Boundaries

**In Scope:**
1. Extend `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` with the 16 new Infra tables in dependency-safe order (12 entity + `infrastructure_points` in base section, 3 relationships in dependent section).
2. Extend `ArchitectureElementInventoryService.DOMAIN_ORDER` with `"Infrastructure"` between `"Behavioural"` and `"Diagrams"`.
3. Extend `ArchitectureElementInventoryService.TABLES_BY_DOMAIN` with an `"Infrastructure"` entry covering all 16 Infra tables (12 entity + `infrastructure_points` + 3 relationships).
4. Extend `ArchitectureElementInventoryService.DISPLAY_NAME_FALLBACK_TABLES` with `infrastructure_points` and the 3 relationship tables.
5. New `MockMvc` controller round-trip test for full-model PUT/GET on an Infra-bearing payload (including at least one polymorphic `InfrastructurePoint` use).
6. Controller-level scoping/validation test coverage — at least one negative-path assertion that an Infra-bearing model honours the existing `model_files.findByProjectIdAndArchitectureId` 3-step check.

**Out of Scope** (raw idea exclusions, preserved verbatim):
- Frontend TypeScript types.
- Frontend API clients.
- Frontend tables.
- Frontend diagrams.
- Gateway changes.
- MCP tools.
- Discovery-service changes.
- Terraform parsing/import/export.
- GCP provisioning.
- Security group / firewall / IAM modelling.
- Data entity hosted on data store relationship.
- Traffic flow relationship.
- Infrastructure resource dependency relationship.

**Out of Scope (additional, per Q8):**
- `MetaModelSummaryDto` / `MetaModelSummaryController` extension (deferred to a later spec).
- Granular per-Infra-entity CRUD endpoints (POST / PUT / DELETE per entity type).
- Discovery-facing Infra GET-by-id endpoints.
- PATCH / merge semantics for full-model save (delete-and-replace stays the only mode).
- New validation framework (existing 3-step controller pattern is the convention).
- Frontend clone / selection UI changes (frontend is separately out of scope).

### Technical Considerations

- **No new endpoints**: this spec extends two services and adds one test class. The existing `/api/model/projects/{projectId}/architectures/{architectureId}` GET / PUT is already Infra-aware via spec 1's `ModelService` extensions (Pass-C decision 1).
- **Selective-copy is automatic**: `ArchitectureSelectiveCopyService` iterates `IN_SCOPE_TABLES_IN_ORDER`, so updating that list (change #1) brings Infra into preflight + commit with no additional code.
- **`OUT_OF_SCOPE_COLUMNS` audit set unchanged**: every new Infra FK target is itself in-scope (intra-architecture), so the existing old→new id map will rewire them correctly during clone.
- **Display-name fallback covers all four name-less Infra tables**: `infrastructure_points` (polymorphic supertype, discriminator + typed FKs only) plus the 3 relationship tables (id + FKs + tags only).
- **Test convention**: `MockMvc` standalone setup with `GlobalExceptionHandler` (existing controller-test convention). No Spring-context boot; no DB integration.
- **Pre-existing broken tests**: spec 1 left ~9 `ModelService*Test` files staged as broken plus ~112 unrelated pre-existing failures; this spec does NOT touch them. Implementer should run the new test class targeted only.
- **Backward compatibility**: omitted Infra lists in incoming payloads delete-and-replace the existing Infra rows (footgun acknowledged per Q6). Empty lists do the same. This matches every other domain.
- **Cross-project / cross-architecture validation**: inherited unchanged from the existing `ModelController` 3-step pattern (Q7); no new validation code.

## Acceptance Criteria

(Copied verbatim from raw idea, annotated with where each criterion is satisfied.)

- **Existing full architecture model retrieval returns Infrastructure entity and relationship lists.** *Already satisfied by spec 1* (`ModelService.loadModelByProjectIdAndArchitectureId` / `loadModelByFileId` extended). This spec adds controller-level test coverage to confirm the wired-up behaviour at the API edge (change #4).
- **Existing full architecture model save/update persists Infrastructure entity and relationship lists.** *Already satisfied by spec 1* (`ModelService.saveModel` extended). This spec adds controller-level round-trip test coverage (change #4).
- **Infrastructure entities are scoped to the correct project and architecture.** *Already satisfied by spec 1* (`model_file_id` scoping via `model_files.findByProjectIdAndArchitectureId`). This spec adds controller-level negative-path assertion (change #5).
- **Infrastructure relationships are scoped to the correct project and architecture.** *Already satisfied by spec 1* (same `model_file_id` scoping). This spec adds controller-level negative-path assertion (change #5).
- **InfrastructurePoint references resolve correctly in the three Infrastructure relationship types.** *Already satisfied by spec 1* (DTO ↔ Entity mappers, FKs in place). This spec adds at least one polymorphic round-trip assertion in the controller test (change #4).
- **Existing model payloads that omit Infrastructure data remain backwards compatible.** *Already satisfied by spec 1* (delete-and-replace handles omitted lists identically to every other domain). No change required in this spec.
- **Existing non-Infrastructure model save/load tests continue to pass.** *Already satisfied by spec 1*. This spec must not regress them; the new test class is additive.
- **New backend tests cover full-model save/load round trip for Infrastructure entities.** *Requires this spec* — change #4 (controller-level round-trip test).
- **New backend tests cover full-model save/load round trip for Infrastructure relationships.** *Requires this spec* — change #4.
- **New backend tests cover at least one Infrastructure relationship using InfrastructurePoint.** *Requires this spec* — change #4 (polymorphic assertion against `deployment_unit_compute_resources.compute_infrastructure_point_id`).
- **New backend tests cover project/architecture scoping for Infrastructure data.** *Requires this spec* — change #5.
- **No frontend, gateway, MCP, discovery, or Terraform implementation is included in this spec.** *Satisfied by scope boundary* — no such code is introduced.

### Acceptance Criteria not directly listed in raw idea, but emerging from Pass B/C:

- **Architecture clone carries Infrastructure rows across.** *Requires this spec* — change #1. (Without this, cloning silently drops every Infra row.)
- **Element-inventory endpoint returns Infrastructure as a domain.** *Requires this spec* — changes #2 + #3. (Without this, the SelectiveCopyElementPicker tree omits Infrastructure entirely.)
- **`infrastructure_points` and the 3 Infra relationship tables degrade gracefully under name-fallback display.** *Requires this spec* — change #3. (Without this, the inventory probe SQL would emit `SELECT id, name FROM infrastructure_points` and fail with `BadSqlGrammarException` per the existing service's defensive logging.)

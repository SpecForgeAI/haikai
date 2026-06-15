# Specification: Infrastructure Domain Backend API

## Goal
Wire the 16 Infrastructure tables delivered by spec 1 into the two architecture-level services that hardcode the in-scope schema (`ArchitectureCloneService`, `ArchitectureElementInventoryService`) and add controller-level `MockMvc` round-trip coverage for the Infrastructure-bearing full-model GET/PUT, so architecture clone, the selective-copy element picker, and the API edge all become Infrastructure-aware.

## User Stories
- As an architect, I want cloning an architecture to carry every Infrastructure row across so a cloned architecture is a faithful copy and Infrastructure data isn't silently dropped.
- As an architect, I want the SelectiveCopyElementPicker tree to list the Infrastructure domain so I can scope-pick Infrastructure rows like I do for Applications, Data, Business, UI, Behavioural, and Diagrams.
- As a backend developer, I want controller-level tests proving Infrastructure entities and relationships round-trip through the full-model API and stay scoped to the correct project + architecture so spec 1's `ModelService` plumbing is verified at the HTTP edge.

## Specific Requirements

**Architecture clone — extend `IN_SCOPE_TABLES_IN_ORDER`**
- Append the 16 Infrastructure tables to `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` in dependency-safe order.
- Block A (insert in the base-entity section after the existing DIAGRAM base block, before `temporary_diagrams`): `environments`, `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`, `infrastructure_points` (last in block — its 12 typed FKs all reference the entity tables above).
- Block B (insert in the DEPENDENT-rows section, alongside `data_movements`): `resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes` — all three reference `infrastructure_points` plus other Infra entity tables.
- No edits to `OUT_OF_SCOPE_COLUMNS` or column-substitution sets — every new Infra FK target is itself in-scope (intra-architecture), so the existing old→new id map will rewire them automatically.
- `ArchitectureSelectiveCopyService` requires no direct edits; it iterates `IN_SCOPE_TABLES_IN_ORDER` (lines 553, 712, 748) for preflight + commit and inherits this change.

**Element inventory — extend `DOMAIN_ORDER` and `TABLES_BY_DOMAIN`**
- Append `"Infrastructure"` to `ArchitectureElementInventoryService.DOMAIN_ORDER` between `"Behavioural"` and `"Diagrams"`.
- In `buildTablesByDomain()`, add a new `map.put("Infrastructure", List.of(...))` block containing all 16 Infrastructure tables in display order: 12 entity tables (`environments` through `infrastructure_resources`), then `infrastructure_points`, then the 3 relationship tables (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`).
- Display labels mirror the existing `entry(table, displayName)` convention used by the 6 existing domain blocks; preserve the invariant from the service Javadoc that `TABLES_BY_DOMAIN` "mirrors `IN_SCOPE_TABLES_IN_ORDER` verbatim, partitioned by domain".
- Mirroring the existing convention (verified against source): the polymorphic point table and the relationship tables for a domain live under that same domain entry — not in a separate `"Relationships"` or `"Points"` domain.

**Display-name fallback — extend `DISPLAY_NAME_FALLBACK_TABLES`**
- Append `infrastructure_points` to `ArchitectureElementInventoryService.DISPLAY_NAME_FALLBACK_TABLES` — the polymorphic supertype has no `name` column (discriminator + 12 typed FKs only).
- Append the 3 Infra relationship tables (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`) to `DISPLAY_NAME_FALLBACK_TABLES` — they have `tags` but no `name` column, mirroring the existing convention for relationship-style tables in this set.
- The 12 Infra entity tables all have `name TEXT NOT NULL` per spec 1, so they do NOT belong in this set.
- Place the 4 entries in a new `// Infrastructure …` comment block at the end of the existing set, mirroring the existing comment-grouped style.

**Controller-level full-model round-trip test (`MockMvc`)**
- Add a new test class (suggested name `ModelControllerInfrastructureRoundTripTest`) using the existing controller-test convention: `@ExtendWith(MockitoExtension.class)`, `MockMvcBuilders.standaloneSetup(...).setControllerAdvice(new GlobalExceptionHandler())`, assertions via `MockMvcResultMatchers.jsonPath(...)`.
- Build a `MetaModelDto` payload covering a representative selection of Infra entities, populated `infrastructure_points` rows, and at least one row in each of the 3 relationship tables.
- At least one assertion must exercise an Infrastructure relationship referencing an `InfrastructurePoint` polymorphically (e.g. a `deployment_unit_compute_resources` row whose `compute_infrastructure_point_id` resolves to an `InfrastructurePoint` with `point_kind = COMPUTE_RESOURCE` or `COMPUTE_CLUSTER`).
- `PUT` the payload to `/api/model/projects/{projectId}/architectures/{architectureId}?filename=...`, then `GET` the same URL, and assert every Infra list (12 entity lists + `infrastructure_points` + 3 relationship lists) round-trips with the expected sizes and the polymorphic reference resolves.

**Controller-level scoping/validation test**
- Add at least one negative-path assertion that an Infrastructure-bearing model honours the existing `model_files.findByProjectIdAndArchitectureId` 3-step check at the controller layer: e.g. `GET` (or `PUT`) with a `projectId` that doesn't own the `architectureId` returns 404 and persists no Infra rows.
- Inherit the existing 3-step pattern verbatim — `findByProjectIdAndArchitectureId` → load → assert `modelFileId` match → `ResourceNotFoundException` mapped to 404 by `GlobalExceptionHandler`. No new validation framework, no new DB-level cross-project guard.
- If the existing non-Infra `ModelController` tests already cover the negative path generically, a single Infra-payload re-run of one of them is sufficient — the controller logic is shared, and the goal is to assert Infra rows don't bypass it.

**Save semantics — keep delete-and-replace**
- No PATCH / merge semantics. Omitted or empty Infra lists in an incoming payload wipe all Infra data for the architecture, identical to every other domain. This is fully handled by spec 1's `ModelService` extensions; this spec adds no save-path code.

**Out-of-scope endpoints — explicitly not added**
- No per-Infra entity CRUD endpoints (POST / PUT / DELETE). Full-model save remains the only write surface, consistent with every other domain.
- No discovery-facing GET-by-id endpoints for Infra entity types. The 3 existing `ModelEntityController` GETs (`services`, `applications`, `app_components`) exist solely for `discovery-service`; no consumer in this spec needs Infra GETs.
- No `MetaModelSummaryDto` / `MetaModelSummaryController` extension. Deferred to a later spec.

## Visual Design
N/A — backend-only spec, no UI artefacts. The reference behaviour is the existing `IN_SCOPE_TABLES_IN_ORDER`, `TABLES_BY_DOMAIN`, and `DISPLAY_NAME_FALLBACK_TABLES` listings plus the existing `ModelController` full-model GET/PUT contract.

## Existing Code to Leverage

**`ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`**
- Authoritative ordered list of architecture-scoped tables (lines 399-488). Existing structure: ROOT (`model_files`) → BUSINESS base → DATA base → APPLICATION base → INTERACTION base → BEHAVIOURAL base → UI base → DIAGRAM base → PROJECT-DIRECT meta-model → DEPENDENT rows.
- Extend by inserting Block A in the base-entity section (after Diagrams base, before `temporary_diagrams`) and Block B in the DEPENDENT-rows section. Do not refactor the literal — append in place.

**`ArchitectureElementInventoryService.buildTablesByDomain()`**
- Six existing `map.put(domain, List.of(entry(...), ...))` blocks (lines 347-440) are the template. Add a 7th block for `"Infrastructure"` mirroring this exact shape.
- `DOMAIN_ORDER` at line 156 is a `List.of(...)` literal; append `"Infrastructure"` between `"Behavioural"` and `"Diagrams"`.

**`ArchitectureElementInventoryService.DISPLAY_NAME_FALLBACK_TABLES`**
- Existing flat `Set<String>` (lines 164-188) of tables without a `name` column, comment-grouped by source domain. Append a new Infrastructure block with the 4 name-less Infra tables.

**Controller-test scaffolding — `ArchitectureSelectiveCopyControllerTest`, `ArchitectureCrudControllerTest`**
- Standalone `MockMvc` setup with `GlobalExceptionHandler`, `@Mock`-injected service collaborators, `jsonPath(...)` assertions. Copy this scaffolding for the new `ModelControllerInfrastructureRoundTripTest`.

**Spec 1 round-trip test payloads — `ModelService*Test` (under `architecture-model-service/src/test/`)**
- Spec 1's payload builders construct `MetaModelEntitiesDto` + `MetaModelRelationshipsDto` populated with all 16 Infra types. Lift the Infra payload into the controller-level `MetaModelDto` shape required by `ModelController.saveModel(...)`.

**3-step controller-layer scoping pattern in `ModelEntityController`**
- Repeated verbatim in all 3 existing GETs: `model_files.findByProjectIdAndArchitectureId` → load entity → assert `modelFileId` match → `ResourceNotFoundException` → 404. The negative-path scoping test asserts an Infra-bearing payload still flows through this exact path; no new code is introduced.

## Acceptance Criteria

Carried forward from `requirements.md` / raw idea, annotated with where each is satisfied:

- Existing full architecture model retrieval returns Infrastructure entity and relationship lists. *Already satisfied by spec 1* (`ModelService.loadModelByProjectIdAndArchitectureId` extended); this spec adds controller-level test coverage.
- Existing full architecture model save/update persists Infrastructure entity and relationship lists. *Already satisfied by spec 1* (`ModelService.saveModel` extended); this spec adds controller-level round-trip test coverage.
- Infrastructure entities are scoped to the correct project and architecture. *Already satisfied by spec 1* (via `model_file_id` and `model_files.findByProjectIdAndArchitectureId`); **requires this spec** for controller-level negative-path assertion.
- Infrastructure relationships are scoped to the correct project and architecture. *Already satisfied by spec 1*; **requires this spec** for controller-level negative-path assertion.
- `InfrastructurePoint` references resolve correctly in the three Infrastructure relationship types. *Already satisfied by spec 1* (DTO ↔ Entity mappers, FKs in place); **requires this spec** for at least one polymorphic round-trip assertion in the controller test.
- Existing model payloads that omit Infrastructure data remain backwards compatible. *Already satisfied by spec 1* (delete-and-replace handles omitted lists identically to every other domain).
- Existing non-Infrastructure model save/load tests continue to pass. *Already satisfied by spec 1*; this spec must not regress them — the new test class is purely additive.
- New backend tests cover full-model save/load round trip for Infrastructure entities. **Requires this spec** — controller-level round-trip test.
- New backend tests cover full-model save/load round trip for Infrastructure relationships. **Requires this spec** — controller-level round-trip test.
- New backend tests cover at least one Infrastructure relationship using `InfrastructurePoint`. **Requires this spec** — polymorphic assertion against `deployment_unit_compute_resources.compute_infrastructure_point_id`.
- New backend tests cover project/architecture scoping for Infrastructure data. **Requires this spec** — controller-level negative-path assertion.
- No frontend, gateway, MCP, discovery, or Terraform implementation is included in this spec. *Satisfied by scope boundary*.

Additional acceptance criteria emerging from grounding (Pass B/C):

- Architecture clone carries Infrastructure rows across. **Requires this spec** — `IN_SCOPE_TABLES_IN_ORDER` extension.
- Element-inventory endpoint returns `Infrastructure` as a domain entry. **Requires this spec** — `DOMAIN_ORDER` + `TABLES_BY_DOMAIN` extension.
- `infrastructure_points` and the 3 Infra relationship tables degrade gracefully under name-fallback display. **Requires this spec** — `DISPLAY_NAME_FALLBACK_TABLES` extension (without it, the inventory probe would emit `SELECT id, name FROM infrastructure_points` and fail with `BadSqlGrammarException`).

## Out of Scope
- Per-Infra entity CRUD endpoints (POST / PUT / DELETE per entity type) — full-model save remains the only write surface.
- Discovery-facing GET-by-id endpoints for Infrastructure entity types — no consumer needs them in this spec.
- `MetaModelSummaryDto` / `MetaModelSummaryController` extension for Infrastructure LLM context — deferred to a later spec.
- PATCH / merge semantics for full-model save — delete-and-replace stays the only mode for Infrastructure, consistent with every other domain.
- New cross-project / cross-architecture validation framework — the existing 3-step controller pattern is the convention.
- Frontend TypeScript types, frontend API clients, frontend tables, frontend diagrams, and frontend clone / selection UI — separate spec increments.
- Gateway changes, MCP tools, discovery-service changes — separate spec increments.
- Terraform parsing/import/export, GCP provisioning, and security group / firewall / IAM modelling — separate spec increments.
- The 3 deferred relationships from spec 1: data entity hosted on data store, traffic flow, and infrastructure resource dependency.
- Fixes for the ~9 staged broken `ModelService*Test` files and ~112 unrelated pre-existing broken tests — not surface added by this spec.

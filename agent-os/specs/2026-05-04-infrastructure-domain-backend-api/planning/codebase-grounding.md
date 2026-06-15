# Codebase Grounding — Infrastructure Domain Backend API (spec 2 of 7)

**Author:** spec-research
**Date:** 2026-05-04

This file captures what spec 2 needs to know about the existing API surface before drafting questions. It is intentionally short.

## Spec 1 (Backend Foundation) — already merged

Spec 1 (`2026-05-04-infrastructure-domain-backend-foundation`) has delivered:

- 16 Liquibase changesets (098–113), 16 JPA entities, 16 DTOs, 16 repositories
- `EntityMapper` extended (DTO ↔ Entity for all 16 types)
- `MetaModelEntitiesDto` extended with 13 new lists (`environments` … `infrastructure_points`)
- `MetaModelRelationshipsDto` extended with 3 new lists (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`)
- `ModelService.saveModel` / `loadModelByFileId` / `loadModelByProjectIdAndArchitectureId` / `deleteAllDataForModelFile` extended for all 16 new repos in dependency-safe order
- 33 spec tests covering full round-trip via `ModelService` directly

## Existing API surface — what already exists vs. what doesn't

### Full-model load/save endpoints (`ModelController`, `/api/model`)
- **GET** `/api/model/projects/{projectId}/architectures/{architectureId}` — delegates to `ModelService.loadModelByProjectIdAndArchitectureId(...)` which calls `loadModelByFileId(...)`. Spec 1 already wired Infra into that path, so **Infrastructure is already returned** by this endpoint.
- **PUT** `/api/model/projects/{projectId}/architectures/{architectureId}?filename=…` — delegates to `ModelService.saveModel(filename, projectId, architectureId, model)`. Spec 1 wired Infra into the underlying `saveEntities` / `saveRelationships`. **Save delete-and-replace already includes Infra** automatically.
- Legacy filename-based GET/PUT/DELETE on `/api/model` also flow through the same `ModelService` methods, so they too are Infra-aware.

### Per-domain entity endpoints (`ModelEntityController`, `/api/model/projects/{projectId}/architectures/{architectureId}/entities`)
**Only 3 endpoints exist, all `GET-by-id`, all read-only:**
- `GET /entities/services/{serviceId}`
- `GET /entities/applications/{applicationId}`
- `GET /entities/app_components/{appComponentId}`

There are **no listing endpoints, no POST, no PUT, no DELETE per domain**. There are no per-domain endpoints at all for Business / Data / Behavioural / UI / Diagrams.

The existing 3 GETs exist solely for `discovery-service` to fetch entity details for service-scoped discovery runs (per the Javadoc).

### Other model-shape controllers (none expose per-domain entity CRUD)
- `ModelInterfacesController` — `/api/model/interfaces` (interface discovery only).
- `OasSpecController` — `/api/model/interfaces/{id}/oas` (OAS upload only).
- `MetaModelSummaryController` — `/api/projects/{projectId}/architectures/{architectureId}/meta-model-summary` returns a curated `MetaModelSummaryDto` for LLM context (apps, services, data_entities, interfaces, business_users, process_activities, ui_screens, user_journeys, data_store_count, relationships). Currently has **zero Infra references**. Out of scope unless explicitly asked.
- `BootstrapController` — feature toggles only, not model-shaped.
- `ProjectArtifactController` — file-blob artifact storage, not model-shaped.

### Validation conventions
- Project + architecture scoping is via path variables (`UUID projectId`, `UUID architectureId`).
- "Cross-project / cross-architecture" rejection is done by:
  1. Looking up `model_files.findByProjectIdAndArchitectureId(projectId, architectureId)` (404 if missing).
  2. Loading the entity by id (404 if missing).
  3. Asserting `entity.getModelFileId().equals(modelFile.getId())` (404 if mismatch).
- This pattern is repeated verbatim in all 3 `ModelEntityController` GETs. Errors raised as `ResourceNotFoundException`, mapped to 404 by `GlobalExceptionHandler`.
- No existing DB-level cross-project / cross-architecture FK validation; it's all caller-enforced at the controller layer.

### `ApplicationPoint` / `BusinessPoint` / `DataEntityPoint` exposure
- Searched controllers for `applicationPoint`, `application_point`, `business_point`, `data_entity_point` — **zero matches**. Points are not exposed via dedicated API endpoints.
- They are part of the meta-model save/load round-trip (inside `MetaModelEntitiesDto`) but not surfaced as standalone resources.

### Architecture-level features that DO enumerate per-domain tables explicitly
Two services hardcode a list of per-domain tables and **do NOT yet include any of the 16 new infrastructure tables**:

1. **`ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`** (~60 tables)
   - Drives full architecture clone (`POST /api/projects/{projectId}/architectures/{sourceArchitectureId}/clone`).
   - Without an update, **cloning an architecture will silently drop all Infrastructure rows.**

2. **`ArchitectureElementInventoryService.TABLES_BY_DOMAIN`** + `DOMAIN_ORDER`
   - Drives `GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory`.
   - Drives the SelectiveCopyElementPicker frontend tree.
   - `DOMAIN_ORDER` is hardcoded to `["Applications", "Data", "Business", "UI", "Behavioural", "Diagrams"]`.
   - Without an update, **Infrastructure does not appear in the picker tree.**
   - `DISPLAY_NAME_FALLBACK_TABLES` may need entries for the join-table-style `infrastructure_points` (it has no `name` column).

3. **`ArchitectureSelectiveCopyService`** (lines 553, 712, 748) iterates `IN_SCOPE_TABLES_IN_ORDER` for preflight + commit, so it inherits #1 automatically once that list is updated. No separate Infra wiring needed beyond #1.

These three call sites are the **most likely real work** for spec 2.

### Test conventions
- Controller tests use `MockMvc` with `@ExtendWith(MockitoExtension.class)` and `MockMvcBuilders.standaloneSetup(...).setControllerAdvice(new GlobalExceptionHandler())`.
- Mocked services are `@Mock`-injected; assertions use `MockMvcResultMatchers.jsonPath(...)`.
- Examples: `ArchitectureSelectiveCopyControllerTest`, `ArchitectureCrudControllerTest`.
- Spec 1 implementer convention: stage broken tests to `/tmp/staged-broken-tests/` (or `.broken-tests-staging-verify/`), run targeted tests, restore.

## What's left to do for spec 2 (most-likely scope)

Given the controller layer is **the same shape for every domain** (no per-domain CRUD anywhere), the raw idea's "Extend entity-specific model APIs, if they exist for other domains, so Infrastructure entities can be listed, created, updated, and deleted using equivalent conventions" almost certainly **does not apply** — there are no per-domain CRUD endpoints to mirror.

The likely real scope is:

1. **Extend `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`** with the 16 new Infra tables in dependency-safe order (mirrors spec 1's `ModelService.deleteAllDataForModelFile` ordering with `model_files` first per existing convention).
2. **Extend `ArchitectureElementInventoryService.TABLES_BY_DOMAIN`** with a new `"Infrastructure"` domain entry, and add `"Infrastructure"` to `DOMAIN_ORDER`. Add `infrastructure_points` to `DISPLAY_NAME_FALLBACK_TABLES`.
3. **Possibly** extend `ModelEntityController` with single-entity GETs for the 12 new Infra entity types — only if discovery-service or another consumer actually needs them. (Existing 3 are discovery-driven, not full-CRUD.)
4. **Controller-level test coverage** for the full-model GET/PUT round-trip including Infra fields, since spec 1's tests only exercised `ModelService` directly.
5. **Possibly** validation: cross-architecture / cross-project rejection for any new per-entity GETs, mirroring the 3-step pattern.

Out of scope (per raw idea): frontend, gateway, MCP, discovery-service, Terraform, GCP. Note that `MetaModelSummaryDto` extension and the SelectiveCopyElementPicker tree label are gateway/frontend-ish — but the inventory endpoint itself is in this service.

## Carry-forward from spec 1
- 9 `ModelService*Test` files in the broken-tests staging set need constructor updates (additive parameter expansion). DO NOT plan to fix as part of spec 2 unless they directly test surface this spec adds.
- ~112 unrelated pre-existing broken test files — leave alone.
- Implementer convention: stage broken tests aside, run targeted tests, restore.

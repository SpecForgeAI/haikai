# Spec #1 Shaping Decisions — Multi-Architecture Plumbing

**Spec folder:** `agent-os/specs/2026-05-01-multi-architecture-plumbing/`
**Design note (full multi-spec context):** `agent-os/design-notes/multi-architecture-variants.md`
**Raw idea:** `planning/raw-idea.md`

This document captures the resolved decisions from the shape-spec phase, ready for `/agent-os:write-spec` to consume.

---

## Context

This is **spec #1 of seven** in the multi-architecture-variants initiative. The full sequence and design rationale lives in the design note above.

**What this spec does:** Lands the end-to-end plumbing for multi-architecture support — data model, backend, gateway, frontend — with **zero user-visible behaviour change**. Every existing project gets one architecture named `Default` via Liquibase migration, and the frontend silently routes everything through it. The selector UI, CRUD UI, Discovery integration, persona changes, clone, and selective-copy all build on this foundation in later specs.

**Hard constraints (from the design note, non-negotiable):**
- **Zero data loss** in migration.
- **Zero user-visible behaviour change** after this spec ships.
- **Path-segment URLs** (`/projects/:projectId/architectures/:architectureId/...`) for architecture-scoped routes — forgetting the id must produce a 404, not silently route to a default.
- **Threads stay project-scoped** (no change to thread storage paths or thread client functions).

---

## Resolved Decisions

### 1. Controller bucket assignments

**Bucket A — architecture-scoped** (URLs become `/api/projects/{projectId}/architectures/{architectureId}/...` or `/api/model/projects/{projectId}/architectures/{architectureId}/...`):
- `MetaModelSummaryController`
- `ModelEntityController`
- `ModelController` (model load — see decision #2)
- `TemporaryDiagramController`
- `UserJourneyDiagramController`
- `UserJourneyOverviewDiagramController`
- `UserJourneySyncController`

**Bucket B — project-scoped (no change to URL shape)**:
- Project metadata: `ProjectController`, `ActiveProjectController`, `ProjectSessionController`, `BootstrapController`, `DeliveryTeamController`
- PM/roadmap: `WorkItemController`, `BookOfWorkController`, `WorkItemImplementContextController`, `WorkItemImplementWorkspaceController`, `ImplementContextResolutionController`, `ProjectArtifactController`, `RoadmapImportController`
- Product: `ProductDefinitionController`, `ProductSummaryController`
- Discovery: all `Discovery*Controller`s (`architectureId` integration deferred to spec #4)

**Bucket C — global / cross-project (no change)**:
- `OrganisationController`, `PackageSetStandardsController`, `OasSpecController`, `ModelInterfacesController`, `SequenceDiagramController`

**Reasoning for PM/roadmap and Product staying project-scoped:** the legacy-migration use case (the design note's primary motivator) implies one shared backlog and one product spanning both current-state and target-state architectures. Override-able if product direction differs.

### 2. `ModelController` URL shape

Today: `/api/model?projectId=…` (query-param). After this spec: `/api/model/projects/{projectId}/architectures/{architectureId}` (path-segment, hard cutover, query-param form removed in same spec).

### 3. Migration table inventory

**Tables that get a new `architecture_id UUID NOT NULL` foreign key column:** every meta-model table currently scoped by `project_id`. The concrete list is to be compiled during spec writing from a sweep of `architecture-model-service/src/main/resources/db/changelog/sql/*.sql`. Expected roughly: `applications, application_components, services, application_points, classes, methods, packages, package_sets, business_users, business_processes, business_points, process_activities, business_logics, app_business_points, logical_data_entities, logical_data_attributes, physical_data_entities, physical_data_attributes, data_entity_points, data_movements, interfaces, endpoints, ui_screens, ui_components, ui_actions, ui_contracts, ui_characteristics, ui_workflow_transitions, events, states, state_transitions, activities, activity_flows, activity_partitions, activity_steps, user_journeys, user_journey_links, sequence_diagrams + sequence_* children, diagrams + diagram_* children (nodes/edges/decorations/interaction_edges), all *_relationships join tables, model_files`.

**Excluded** (stay project-scoped or out of scope):
- `project`, `delivery_teams`, `organisations` — not meta-model.
- `work_item`, `work_item_implement_context`, `work_item_implement_workspace`, `project_artifact`, `product_definitions` — PM/roadmap/product (see decision #1).
- `discovery_*` — deferred to spec #4.
- File-based threads — stay project-scoped, no DB change.

### 4. Backfill / migration strategy

Sequence (one ordered set of Liquibase changesets, modelled on changesets 020–024 / `data_entity_points` pattern):

1. Create `architecture` table + `architecture_tag` table.
2. Insert one row into `architecture` per existing project: `name='Default'`, deterministic UUID generated from `project.id` (e.g. `uuid_generate_v5(project.id, 'multi-arch-default')`) so re-runs are idempotent.
3. Add nullable `architecture_id UUID` column to every in-scope table.
4. Backfill: `UPDATE <table> SET architecture_id = (SELECT id FROM architecture WHERE project_id = <table>.project_id AND name='Default')`.
5. Add `NOT NULL` constraint + foreign key.
6. Add composite `(project_id, architecture_id)` indexes where the existing query patterns warrant.

Granularity: one changeset per concern (architecture table, tag table, then per-table batches grouped sensibly) for granular rollback.

### 5. `project_id` retention

**Keep `project_id` on meta-model tables.** Do not drop it now. It becomes a denormalised convenience column so queries don't have to join through `architecture` to filter by project. Dropping is risky and out of scope — it would be a future cleanup spec, if ever.

### 6. Default architecture identification (frontend)

The frontend identifies a project's `Default` architecture as **the oldest non-archived architecture for that project** (lowest `created_at`).

Rationale: survives renames (spec #3 will allow renaming), survives the addition of more architectures (spec #2/#3), no need for a special `is_default` flag with maintenance overhead.

### 7. Tag storage

**Separate `architecture_tag` table** with columns `(architecture_id UUID, tag_value TEXT)` and a unique constraint on the pair.

Rationale: spec #3 will need a "filter architectures by tag" UI; normalised storage is faster to query than a JSON array. The codebase uses JSONB heavily elsewhere, but tags are different — they need fast lookup-by-value.

### 8. Frontend routing

**Defer URL-as-source-of-truth to spec #2** (which introduces the architecture selector UI).

In this spec, the frontend keeps view state in `ArchitectureContext` exactly as today, but adds an `activeArchitectureId` field resolved at project-load time (via the new `GET /api/projects/:projectId/architectures` endpoint, picking oldest non-archived) and threads it through `architectureModelClient.ts`.

**Server-side URLs still get the path segment in this spec** so the 404 safety property holds.

Note: `react-router-dom` is already in `frontend/package.json` but unused. Spec #2 introduces actual usage.

### 9. Old URL handling

**Hard cutover, no back-compat layer.** Old project-scoped meta-model URLs (Bucket A, pre-refactor) are removed in the same spec. There are no external callers to support.

**Discovery-service is updated in this spec** to pass `architectureId` on the three entity-fetch calls it makes:
- `GET /api/model/projects/{projectId}/entities/services/{serviceId}`
- `GET /api/model/projects/{projectId}/entities/applications/{applicationId}`
- `GET /api/model/projects/{projectId}/entities/app_components/{appComponentId}`

These become architecture-scoped. discovery-service resolves the `architectureId` per-project once via the new list endpoint (oldest non-archived = the migrated `Default`) and caches it for the run.

**Discovery-service's own POST/GET/PUT/DELETE endpoints stay unchanged** — Discovery's own integration with the new architecture model is the entire scope of spec #4.

### 10. New endpoints in this spec — minimum set only

Just one new endpoint:
- `GET /api/projects/{projectId}/architectures` — list architectures for a project. Used by the frontend (to resolve the Default) and by discovery-service (same).

No create / rename / archive / tag-management endpoints in this spec — those land in spec #3 alongside the UI.

### 11. `description` field on `architecture` row

Column included in the schema (nullable TEXT). No UI to set it in this spec — UI lands in spec #3.

### 12. Test strategy

- **Unit tests** on `ArchitectureService` (list, default-resolution).
- **Liquibase integration test** using H2 (existing test DB pattern) seeded with a fixture project + sample meta-model rows. Assert post-migration:
  - Every meta-model row in scope has a non-null `architecture_id`.
  - Every project has exactly one architecture named `Default`.
  - Per-table row counts are unchanged before vs after.
  - Re-running the migration is a no-op (idempotency).
- **Gateway 404-safety integration test** — hit any Bucket A endpoint without `architectureId` in the URL → expect 404.
- **Existing test suite** continues to pass after assertions touching new URL shapes are updated.

### 13. Existing patterns to model on

- **JPA entity skeleton:** model `ArchitectureEntity` on `DeliveryTeamEntity` (UUID id, projectId FK, timestamps, `@PrePersist`/`@PreUpdate` hooks). Repository / Service / DTO / Mapper follow the `DeliveryTeam*` and `Organisation*` shapes.
- **Migration pattern:** model on changesets 020–024 (`data_entity_points`) — multi-step "create columns nullable → insert defaults → backfill → enforce NOT NULL + FK".
- **Frontend context augmentation:** model the `activeArchitectureId` addition on `ProjectContext` (state + `useEffect` initialiser + multiple narrow hooks). Augment the existing `ArchitectureContext`, don't duplicate it.

---

## Out of Scope (deferred to later specs)

- **Architecture selector UI** → spec #2.
- **Architecture CRUD UI** (create/rename/archive) and **tag-management modal** → spec #3.
- **Discovery Service `architectureId` integration** (Discovery's own endpoints + UI selector at run start) → spec #4. Note: discovery-service's three entity-fetch calls ARE updated in this spec — see decision #9.
- **LLM persona/task save-target resolution** → spec #5.
- **Full clone** → spec #6.
- **Selective cross-architecture copy** → spec #7.
- **Comparison** and **unarchive UI** → deferred indefinitely.
- **Dropping `project_id` from meta-model tables** → future cleanup spec (if ever).
- **Per-architecture access control** → not in V1.

---

## Critical Files (anticipated)

**Backend (architecture-model-service):**
- `src/main/resources/db/changelog/db.changelog-master.yaml` (modify — register new changesets).
- `src/main/resources/db/changelog/sql/0XX-architecture-and-tags.sql` (new).
- `src/main/resources/db/changelog/sql/0XX-backfill-architecture-id.sql` (new).
- `src/main/java/com/example/architecturemodel/model/entity/ArchitectureEntity.java` (new).
- `src/main/java/com/example/architecturemodel/model/entity/ArchitectureTagEntity.java` (new).
- `src/main/java/com/example/architecturemodel/repository/ArchitectureRepository.java` (new).
- `src/main/java/com/example/architecturemodel/service/ArchitectureService.java` (new).
- `src/main/java/com/example/architecturemodel/controller/ArchitectureController.java` (new — list endpoint only).
- All Bucket A controllers (modify — add `{architectureId}` path variable).
- All Bucket A services / repositories (modify — accept and filter by `architectureId`).

**Gateway:**
- `gateway/src/services/architectureModelClient.ts` (modify — Bucket A functions take `architectureId`).
- `gateway/src/routes/index.ts` and proxy route definitions (modify — embed `architectureId` segment for Bucket A routes).
- All gateway code calling Bucket A functions (modify — pass `architectureId` from request).

**Frontend:**
- `frontend/src/contexts/ArchitectureContext.tsx` (modify — add `activeArchitectureId` + `useActiveArchitectureId()` hook + project-load resolver).
- `frontend/src/api/architecturesApi.ts` (new — `listArchitectures(projectId)`).
- `frontend/src/api/*.ts` (modify — every client function hitting a Bucket A endpoint accepts and embeds `architectureId`).
- All call sites of those API functions (modify — read `activeArchitectureId` from context).

**Discovery Service:**
- `discovery-service/src/archModelClient.ts` (modify — three entity-fetch calls take `architectureId`; new helper to resolve project's Default via list endpoint, cached per-project for the run).

---

## Visual Assets

None provided. Not expected for this spec given the **zero user-visible change** constraint.

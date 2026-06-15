# Specification: Multi-Architecture Plumbing (Spec #1)

## Goal
Land the end-to-end data-model, backend, gateway, and frontend plumbing for multi-architecture support — every existing project gets one auto-created `Default` architecture via Liquibase migration, and the frontend silently routes everything through it. **Zero data loss in migration; zero user-visible behaviour change after this spec ships.**

## User Stories
- As a developer, I want a first-class `architecture` entity scoped under each project so that future specs can layer multi-architecture UI, Discovery integration, and clone/copy workflows on a stable foundation.
- As an existing user, I want my project to continue working identically after this spec ships so that I see no behaviour change, no broken views, and no lost data.

## Specific Requirements

**Bucket A — architecture-scoped controllers (URL changes to `/api/.../projects/{projectId}/architectures/{architectureId}/...`)**
- `MetaModelSummaryController`, `ModelEntityController`, `TemporaryDiagramController`, `UserJourneyDiagramController`, `UserJourneyOverviewDiagramController`, `UserJourneySyncController` all gain an `{architectureId}` path variable.
- `ModelController` migrates from query-param (`/api/model?projectId=…`) to path-segment (`/api/model/projects/{projectId}/architectures/{architectureId}`) in the same spec — query-param form is removed (hard cutover).
- Each Bucket A service/repository accepts `architectureId` and filters by it in addition to `projectId`.
- Forgetting the `architectureId` segment must produce a Spring 404 (no fallback / no default-resolution at the controller layer).
- All Bucket A clients in the gateway and frontend are updated in lockstep — no parallel old-shape routes left behind.

**Bucket B — project-scoped controllers (no URL change)**
- Project metadata controllers stay project-scoped: `ProjectController`, `ActiveProjectController`, `ProjectSessionController`, `BootstrapController`, `DeliveryTeamController`.
- PM/roadmap controllers stay project-scoped: `WorkItemController`, `BookOfWorkController`, `WorkItemImplementContextController`, `WorkItemImplementWorkspaceController`, `ImplementContextResolutionController`, `ProjectArtifactController`, `RoadmapImportController`.
- Product controllers stay project-scoped: `ProductDefinitionController`, `ProductSummaryController`.
- All `Discovery*Controller`s stay project-scoped in this spec — Discovery's own integration is scope of spec #4.
- Rationale: the legacy-migration use case implies one shared backlog and one product spanning current-state and target-state architectures.

**Bucket C — global / cross-project controllers (no change)**
- `OrganisationController`, `PackageSetStandardsController`, `OasSpecController`, `ModelInterfacesController`, `SequenceDiagramController` are unchanged.

**`architecture` and `architecture_tag` schema**
- New `architecture` table: `id UUID PK`, `project_id UUID FK NOT NULL`, `name TEXT NOT NULL`, `description TEXT NULL`, `archived BOOLEAN NOT NULL DEFAULT false`, `created_at`, `updated_at` timestamps.
- New `architecture_tag` table: `(architecture_id UUID FK, tag_value TEXT)` with a unique constraint on the pair — normalised storage for fast filter-by-tag (used in spec #3).
- `ArchitectureEntity` JPA shape modelled on `DeliveryTeamEntity` (UUID id, project FK, timestamps, `@PrePersist` / `@PreUpdate` hooks); repository / service / DTO / mapper modelled on `DeliveryTeam*` and `Organisation*`.
- `description` column included in schema; no UI to set it in this spec (UI lands in spec #3).

**Liquibase migration — zero data loss, idempotent**
- Sequence (one ordered set of changesets, modelled on changesets 020–024 / `data_entity_points` pattern): (1) create `architecture` + `architecture_tag` tables; (2) insert one row per existing project with `name='Default'` and a deterministic UUID derived from `project.id` (e.g. `uuid_generate_v5(project.id, 'multi-arch-default')`) so re-runs are idempotent; (3) add nullable `architecture_id UUID` column to every in-scope table; (4) backfill `UPDATE <table> SET architecture_id = (SELECT id FROM architecture WHERE project_id = <table>.project_id AND name='Default')`; (5) add `NOT NULL` + foreign key constraint; (6) add composite `(project_id, architecture_id)` indexes where existing query patterns warrant.
- Granularity: one changeset per concern (architecture table, tag table, then per-table batches grouped sensibly) for granular rollback.
- Never edit applied changesets in place — always add new changeset files (Liquibase checksum validation will refuse startup otherwise).

**In-scope tables for `architecture_id` column (principle + concrete list)**
- **Principle:** every meta-model table currently scoped by `project_id` gets a new `architecture_id UUID NOT NULL` foreign key — except the explicit exclusions below.
- **Concrete list to be compiled by the implementer** from a sweep of `architecture-model-service/src/main/resources/db/changelog/sql/*.sql`. Expected to include (non-exhaustive): `applications, application_components, services, application_points, classes, methods, packages, package_sets, business_users, business_processes, business_points, process_activities, business_logics, app_business_points, logical_data_entities, logical_data_attributes, physical_data_entities, physical_data_attributes, data_entity_points, data_movements, interfaces, endpoints, ui_screens, ui_components, ui_actions, ui_contracts, ui_characteristics, ui_workflow_transitions, events, states, state_transitions, activities, activity_flows, activity_partitions, activity_steps, user_journeys, user_journey_links, sequence_diagrams + sequence_* children, diagrams + diagram_* children (nodes/edges/decorations/interaction_edges), all *_relationships join tables, model_files`.
- **Excluded** (stay project-scoped or out of scope): `project`, `delivery_teams`, `organisations` (not meta-model); `work_item`, `work_item_implement_context`, `work_item_implement_workspace`, `project_artifact`, `product_definitions` (PM/roadmap/product per Bucket B); all `discovery_*` tables (deferred to spec #4); file-based threads (stay project-scoped, no DB change).
- `project_id` is **kept** on every in-scope table (not dropped) — it becomes a denormalised convenience column so queries can filter by project without joining through `architecture`. Dropping is a future cleanup spec, if ever.

**New endpoint — list architectures (the only new endpoint in this spec)**
- `GET /api/projects/{projectId}/architectures` — returns all architectures for a project (id, name, description, tags, archived, timestamps).
- Used by the frontend (to resolve the `Default`) and by discovery-service (same).
- No create / rename / archive / tag-management endpoints in this spec — those land in spec #3.

**Default architecture resolution (frontend + discovery-service)**
- A project's `Default` architecture is identified as **the oldest non-archived architecture for that project** (lowest `created_at`). No `is_default` flag.
- Rationale: survives renames (spec #3), survives the addition of more architectures, no maintenance overhead.
- Frontend resolves it once at project-load time via the new list endpoint and stores it in `ArchitectureContext` as `activeArchitectureId`; `architectureModelClient.ts` threads it through into all Bucket A calls.
- Discovery-service resolves it once per project per run via the same list endpoint and caches it for the duration of the run.

**Frontend wiring (no URL routing changes yet)**
- View state stays in `ArchitectureContext` exactly as today; a new `activeArchitectureId` field is added, plus a `useActiveArchitectureId()` hook, and a project-load resolver that calls the new list endpoint.
- Augment the existing `ArchitectureContext` — do not duplicate it; model the addition on the `ProjectContext` `useEffect` initialiser pattern.
- New `frontend/src/api/architecturesApi.ts` exposes `listArchitectures(projectId)`.
- Every existing frontend API client function hitting a Bucket A endpoint accepts an `architectureId` argument and embeds it in the URL; every call site reads `activeArchitectureId` from context and passes it.
- `react-router-dom` (already in `package.json` but unused) stays unused in this spec — URL-as-source-of-truth lands in spec #2.

**Discovery-service entity-fetch updates (the only discovery-service change)**
- Three entity-fetch calls become architecture-scoped: `GET /api/model/projects/{projectId}/architectures/{architectureId}/entities/services/{serviceId}`, `.../entities/applications/{applicationId}`, `.../entities/app_components/{appComponentId}`.
- `discovery-service/src/archModelClient.ts` gains a helper that resolves the project's default architecture via the new list endpoint (oldest non-archived), cached per-project for the run.
- Discovery-service's own POST/GET/PUT/DELETE endpoints stay unchanged — their architecture integration is the entire scope of spec #4.
- **Constraint:** only edit `discovery-service/src/**` when no discovery run is active (tsx watch auto-reloads kill in-flight runs).

**Threads stay project-scoped — explicit non-change**
- No change to thread storage paths: `{projectParentFolder}/threads/{type}/thread.json`.
- No change to thread client functions in `architectureModelClient.ts` (`fetchProjectFolder`, etc.).
- Per-task save-target resolution (LLM clarify vs system-prompt-bound) is deferred to spec #5.

**Test strategy**
- Unit tests on `ArchitectureService` covering list and default-resolution (oldest non-archived).
- Liquibase integration test on H2 (existing test DB pattern), seeded with a fixture project plus sample meta-model rows; assert post-migration: every meta-model row in scope has a non-null `architecture_id`; every project has exactly one architecture named `Default`; per-table row counts unchanged before vs after; re-running the migration is a no-op (idempotency).
- Gateway 404-safety integration test: hit any Bucket A endpoint without `architectureId` in the URL and expect a 404 (no silent fallback).
- Existing test suites (gateway Jest, frontend Vitest, architecture-model-service) continue to pass after assertions touching new URL shapes are updated.

## Existing Code to Leverage

**`DeliveryTeamEntity` / `OrganisationEntity` (architecture-model-service)**
- JPA entity skeleton: UUID id, project FK, `created_at`/`updated_at`, `@PrePersist` / `@PreUpdate` hooks.
- Repository / Service / DTO / Mapper class shapes — copy the same layering for `Architecture*`.
- Existing controller pattern for project-scoped list endpoints — `ArchitectureController.list` follows the same shape.

**Liquibase changesets 020–024 (`data_entity_points` pattern)**
- Multi-step migration template: create columns nullable → insert defaults → backfill → enforce `NOT NULL` + FK.
- One changeset per concern for granular rollback.
- Pattern for backfilling a foreign key against rows derived from another table.

**`ProjectContext` (frontend)**
- Pattern for adding state (`activeArchitectureId`) plus a `useEffect` initialiser plus narrow consumer hooks (`useActiveArchitectureId`).
- Augment the existing `ArchitectureContext` in the same shape — do not introduce a parallel context.

**`architectureModelClient.ts` (gateway)**
- Existing functions (`fetchProjectFolder`, `fetchProductName`, `fetchProductSummary`, `fetchMetaModelSummary`) already centralise calls to the architecture-model-service.
- Bucket A functions in this client get an extra `architectureId` parameter and embed it in the URL; Bucket B functions are untouched.
- Per memory: use `jest.requireActual` spread when partially mocking this client in tests, or unmocked callers will break.

**`discovery-service/src/archModelClient.ts`**
- Existing entity-fetch helpers for services / applications / app_components — extended in place to take `architectureId` and to resolve the default per-project once per run.

## Out of Scope
- Architecture selector UI (deferred to spec #2).
- Architecture CRUD UI — create / rename / archive — and tag-management modal (deferred to spec #3).
- URL-as-source-of-truth frontend routing with `react-router-dom` (deferred to spec #2).
- Discovery-service's own POST/GET/PUT/DELETE endpoint changes and run-launch architecture selector (deferred to spec #4).
- LLM persona/task save-target resolution (`clarify-at-save` vs `bound-by-system-prompt` modes) (deferred to spec #5).
- Full clone of one architecture into another (deferred to spec #6).
- Selective cross-architecture copy with conflict resolution (deferred to spec #7).
- Comparison / diffing UI and unarchive UI (deferred indefinitely).
- Dropping `project_id` from meta-model tables (future cleanup spec, if ever).
- Per-architecture access control (not in V1 — access stays per-project).

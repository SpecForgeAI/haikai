# Library Frontend Types & Tables UI

This is **Spec 2 of 3** in the Library arc. Spec 1 (`agent-os/specs/2026-05-05-library-backend-foundation/`) landed the backend model. This spec adds the frontend type system, default model state, table UI for Libraries and Code Unit Dependencies, palette/picker integration, and serialization round-trip for the Library and CodeUnitDependency concepts. Discovery integration is Spec 3.

## Background

Spec 1 created `LibraryEntity` (parallel to Service in the Application domain), `CodeUnitDependencyEntity` (relationship table polymorphic via `ApplicationPoint` with the new `LIBRARY` target_type), 5 tech-hints columns mirroring Service, 6 spec-7 provenance columns, and full integration with `ModelService` save/load/delete + `ArchitectureCloneService` + `ArchitectureElementInventoryService`. The backend round-trips both new types via the existing `/api/model/projects/{p}/architectures/{a}` endpoint.

This spec makes the Library concept usable in the frontend: TypeScript types, gridConfigs for the 2 new tabs, palette wiring, picker behaviour for the polymorphic ApplicationPoint extension, and the model load/save backfill for older payloads.

## Goal

Make `Library` and `CodeUnitDependency` first-class Application-domain concepts in the frontend so users can:
- View, add, edit, delete Library records via a table tab.
- View, add, edit, delete CodeUnitDependency records via a table tab.
- Pick Library entities through the existing `application_point_picker` cellType, which is extended to accept `LIBRARY` as an allowed point_kind.
- Save and load architectures containing Libraries and dependencies without breaking older payloads.

Discovery integration (preflight modal, deterministic resolvers, transitive walker, right-click menu items, scan progress UX) is Spec 3.

## Design decisions (locked through discussion + Spec 1 contract)

### Frontend types

- New `Library` interface in `frontend/src/types/model.ts`. Mirrors `Service` field shape (snake_case, all fields optional except `id`/`description`/`tags` which are required strings) plus library-specific fields:
  - `id`, `description`, `tags`, `valid_from?`, `valid_to?`
  - `name?` (required at backend with NOT NULL — but optional at TS level matches existing patterns; backend rejects empty save).
  - `ecosystem?` (string, doc-only enum: `MAVEN`/`NPM`/`PYPI`/`NUGET`/`GO`/`OTHER`)
  - `repo_location?`, `repo_subfolder?`
  - `core_tech?`, `core_tech_resolved?: Record<string, unknown> | null`, `core_tech_language_pack?`, `core_tech_framework_packs?: string[]` (snake_case JSON list — verify Service shape), `core_tech_resolution_confidence?: 'high' | 'low' | 'none' | 'tech-only' | 'manual-override'`, `core_tech_resolved_at?`
  - `package_set_id?`
  - 6 provenance fields (mirror spec 7 Infra entity TS shape): `source_origin?`, `source_system?`, `source_reference?`, `generation_status?`, `generation_notes?`, `last_verified_at?`
- New `CodeUnitDependency` interface in `frontend/src/types/model.ts`:
  - `id`, `description?`, `tags?` (relationship convention: nullable per Spec 1)
  - `source_application_point_id`, `target_application_point_id` (both required strings, FK to `application_points`)
  - `declared_name?`, `declared_version?`, `declared_version_range?`
  - `scope?`
  - `manifest_path?`, `manifest_line?: number`
  - `evidence_source?`, `confidence?: number`
- Extend `MetaModelEntities` with `libraries: Library[]` field.
- Extend `MetaModelRelationships` with `code_unit_dependencies: CodeUnitDependency[]` field.
- Extend `EntityType` string union with `'libraries'`.
- Extend `RelationshipType` string union with `'code_unit_dependencies'`.
- Extend `AnyEntity` and `AnyRelationship` discriminated unions.

### Default state and serialization

- `frontend/src/config/defaults.ts` `emptyModel` += `libraries: []` and `code_unit_dependencies: []`.
- `frontend/src/api/modelSerialization.ts` `normalizeModelFromApi` += 2 new `??=` backfill lines so older payloads without these arrays load safely.

### Domain registration

- `frontend/src/config/relationshipDefinitions.ts`:
  - `ENTITY_TYPE_TO_DOMAIN.libraries = 'application'` (Library is part of the Application domain).
  - `RELATIONSHIP_DEFINITIONS` += new entry for `code_unit_dependencies` with display name `"Code Unit <-> Library"` (or similar — confirm during shaping). Endpoints: `[<source>, <target>]` — both via `application_points` polymorphic, so the relationship definition lists the relevant point_kind values.
  - `RELATIONSHIP_TAB_ORDER` += display name appended at end.
- `frontend/src/utils/contextPickerDomainMappings.ts`:
  - `DOMAIN_TO_ENTITY_TYPES.application` += `'libraries'`.
  - `DOMAIN_TO_RELATIONSHIP_TYPES.application` += `'code_unit_dependencies'`.

### `application_point_picker` extension

- The existing `application_point_picker` cellType (used for Service / ApplicationComponent / Application + spec-7 etc.) is extended to also list Library rows in its grouped dropdown.
- Existing `applicationPointDerivation.ts` helper: when a user picks a Library row in the picker, the helper auto-creates an ApplicationPoint with `target_type = 'LIBRARY'` if one doesn't exist (mirroring the Service-pick behaviour).
- `applicationPointDisplayFormatter` in `formatters.ts`: extended to render `LIBRARY`-kinded points with the library name.

### gridConfigs

- 2 new gridConfig entries:
  - `libraries`: id (autogen), name (text, required-ish), ecosystem (dropdown, new picklist), repo_location (text), repo_subfolder (text), core_tech (text/tech_hints_cell — TBD; per discussion, mirror Service's `tech_hints_cell` cellType), package_set_id (package_set_dropdown), description (text, required), tags (tags), valid_from (text), valid_to (text). Provenance fields hidden in V1 (round-trip-only) per spec 7 trim.
  - `code_unit_dependencies`: id (autogen), source_application_point_id (`application_point_picker`, required), target_application_point_id (`application_point_picker` with `allowedKinds: ['LIBRARY']`, required), declared_name (text), declared_version (text), declared_version_range (text), scope (dropdown, new picklist), manifest_path (text), manifest_line (text — no `number` cellType), evidence_source (text), confidence (text), description (text), tags (tags). Some fields like manifest_line read-only in V1 because the resolver writes them in Spec 3.
- New picklists in `defaults.ts`:
  - `ecosystemOptions = ['MAVEN', 'NPM', 'PYPI', 'NUGET', 'GO', 'OTHER']`
  - `dependencyScopeOptions = ['COMPILE', 'RUNTIME', 'TEST', 'PROVIDED', 'OPTIONAL', 'DEV', 'PEER']` (manifest-language-specific values stored verbatim; the picklist is the union; `formatOptionLabel: snakeCaseToTitleCase` for display).
- Tab maps in `gridConfigs.ts` updated:
  - `tabToEntityType` += `'Libraries' → 'libraries'`.
  - `entityTabNames` += `'Libraries'`.
  - `relationshipTabToType` += `'Code Unit Dependencies' → 'code_unit_dependencies'` (or whichever display name confirmed during shaping).
  - `relationshipTabNames` += `'Code Unit Dependencies'`.
- `domainGroupings.application` += `'Libraries'` (visible tab in Application domain).
- `DOMAIN_ENTITY_TYPES.application` += `'libraries'`.

### Tech-hints cell

- The `core_tech` column on `libraries` should use the same `tech_hints_cell` cellType as Service. This means clicking edit on the Library's core_tech triggers the same LLM resolution flow that Service uses — which writes back to the 5 tech-hints columns and the chips render. The `pendingResolutionsStore` and `SaveWithPendingResolves` machinery should work for Library identically to Service, since they're both keyed by row id.
- Verify: this depends on the existing tech_hints flow being row-id-keyed (not Service-type-specific).

### Test scope

- One new Vitest config test `frontend/src/config/__tests__/libraryConfigAndTypes.test.ts` asserting:
  - 2 new gridConfigs entries exist with required-field columns.
  - Tab maps include the 2 new entries.
  - `RELATIONSHIP_DEFINITIONS` has the new `code_unit_dependencies` entry with correct endpoint types.
  - `ENTITY_TYPE_TO_DOMAIN.libraries === 'application'`.
  - `DOMAIN_TO_ENTITY_TYPES.application` includes `'libraries'`; `DOMAIN_TO_RELATIONSHIP_TYPES.application` includes `'code_unit_dependencies'`.
  - 2 new picklist arrays exist with expected values.
- No renderer/component tests beyond TS compile.

## Out of scope

- Discovery integration (deterministic resolvers, preflight modal, transitive walker, right-click menu, scan progress UX) — Spec 3.
- Per-version Library rows (versions stay on the edge).
- Provenance/readiness fields exposed as visible grid columns on existing Application-domain entities.
- Diagram support for Library / CodeUnitDependency (deferred; current Application diagrams via General DiagramType already work via free-form authoring playground).
- LLM tech-hints resolver wiring for Libraries — the `tech_hints_cell` cellType is reused; the actual resolver call is shared with Service and works because Library has the same 5 tech-hints columns.
- New cellType creation (reuse existing `application_point_picker`, `tech_hints_cell`, `package_set_dropdown`, `dropdown`, `text`, `tags`).
- Backend changes (Spec 1 covered).
- Gateway / MCP / Discovery code changes.

## Acceptance criteria

- New TypeScript interfaces `Library` and `CodeUnitDependency` exist with snake_case fields matching backend JSON.
- `MetaModelEntities` and `MetaModelRelationships` extended additively.
- `EntityType` and `RelationshipType` string unions extended; `AnyEntity` / `AnyRelationship` extended.
- `emptyModel` defaults `libraries: []` and `code_unit_dependencies: []`.
- `normalizeModelFromApi` adds `??=` backfill for both new arrays.
- `ENTITY_TYPE_TO_DOMAIN.libraries === 'application'`.
- `RELATIONSHIP_DEFINITIONS` includes new `code_unit_dependencies` entry.
- `RELATIONSHIP_TAB_ORDER` updated.
- `DOMAIN_TO_ENTITY_TYPES.application` and `DOMAIN_TO_RELATIONSHIP_TYPES.application` extended.
- `gridConfigs.libraries` and `gridConfigs.code_unit_dependencies` exist with appropriate columns.
- Tab maps (`tabToEntityType`, `entityTabNames`, `relationshipTabToType`, `relationshipTabNames`, `domainGroupings.application`, `DOMAIN_ENTITY_TYPES.application`) all updated.
- 2 new picklist arrays added to `defaults.ts`.
- `application_point_picker` accepts `LIBRARY` kind: dropdown lists Library rows alongside Service / AppComponent / Application; selecting a Library auto-creates an ApplicationPoint with `target_type = 'LIBRARY'` via `applicationPointDerivation`.
- `applicationPointDisplayFormatter` renders `LIBRARY`-kinded points with the library name.
- `core_tech` column on libraries uses the same `tech_hints_cell` cellType as Service; LLM resolution flow works for Library rows the same way it does for Service rows.
- One Vitest config test asserts the wiring.
- Existing Application-domain behaviour (Service, AppComponent, Application, related relationships) remains unchanged.
- TS compiles with 0 net new errors.
- No backend / discovery / gateway / MCP changes.

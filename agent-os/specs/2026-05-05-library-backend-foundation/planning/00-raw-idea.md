# Library Backend Foundation

This is **Spec 1 of 3** in the Library arc — a follow-on to the Infrastructure 7-spec arc. The Library arc introduces a "Library" concept in the Application Architecture domain (parallel to Service), captures dependencies between code units, and prepares the discovery service to populate libraries automatically.

## Background

Today, the Application domain has `Service` as the unit of "deployable code," but the discovery scanner's dependency parsing already encounters references to internal sibling subfolders (libraries) that are pulled in as dependencies. There's no place to put those — they're either ignored or modelled inappropriately as services.

This arc fills the gap. **Spec 1 lands the backend model**: the `Library` entity, the `code_unit_dependencies` relationship, polymorphic source/target via the existing `ApplicationPoint`, and full integration with `ModelService` save/load/clone.

## Goal

Make the Library concept a first-class Application-domain entity at the backend level, with a polymorphic dependency relationship that supports both Service→Library and Library→Library edges, declared coordinates on the edge (so version conflict detection is possible without exploding entity count), and full integration with the existing model save/load/clone/inventory pipelines.

Frontend, tables UI, and discovery integration are the next two specs in this arc.

## Design decisions (locked through discussion — see prior conversation in this session)

### Concept

- **Service** = deployable code base (deployed to a server/port).
- **Library** = code base that doesn't get deployed by itself; consumed as a dependency.
- Both share structural building blocks: `repo_location`, `repo_subfolder`, `core_tech`, `package_set_id`, classes, methods.

### `Library` entity

Parallel to `Service` in the Application domain. Standard envelope (`id`, `model_file_id`, `name`, `description`, `tags`, `valid_from`, `valid_to`) plus library-specific fields:

- `name TEXT NOT NULL` — the library's identity (group:artifact for Maven, package name for npm). Combined with `ecosystem` for the uniqueness key (see below).
- `ecosystem TEXT NULL` — enum picklist: `MAVEN`, `NPM`, `PYPI`, `NUGET`, `GO`, `OTHER`. Used to disambiguate libraries with the same `name` across ecosystems (e.g. `requests`).
- `repo_location TEXT NULL` — set if internal/scannable.
- `repo_subfolder TEXT NULL` — set if internal/scannable.
- `core_tech TEXT NULL` — same shape as `Service.core_tech` (raw text, LLM-resolved).
- `core_tech_resolved JSONB NULL`, `core_tech_language_pack TEXT NULL`, `core_tech_framework_packs JSONB NULL`, `core_tech_resolution_confidence TEXT NULL`, `core_tech_resolved_at TEXT NULL` — same shape as `Service`'s tech-hints columns.
- `package_set_id TEXT NULL → package_sets(id)` — same as `Service.package_set_id`.
- `description TEXT NOT NULL`, `tags TEXT NOT NULL` — standard envelope.

### Identity & versioning

- **Library identity = `(name, ecosystem)` tuple**. One Library row per library across all versions.
- Versions live on the dependency edge, NOT the entity. Different services may depend on different versions of the same library, all pointing at one Library row.
- Internal libs have `repo_location`/`repo_subfolder` set; external libs (Maven Central, npm registry) do not.
- Reuses spec-7 `source_origin` + `last_scanned_at` to distinguish "stub" (referenced via dependency, not yet scanned) from "scanned" (code captured).

### `code_unit_dependencies` relationship table

Polymorphic source (Service or Library) and Library target via the existing `ApplicationPoint`:

- `id TEXT PK`, `model_file_id TEXT NOT NULL CASCADE`
- `source_application_point_id TEXT NOT NULL → application_points(id)` — `target_type` ∈ `SERVICE`, `LIBRARY`
- `target_application_point_id TEXT NOT NULL → application_points(id)` — `target_type = LIBRARY`
- `declared_name TEXT NULL` — e.g. `com.example:lib-foo`
- `declared_version TEXT NULL` — e.g. `1.4.2`
- `declared_version_range TEXT NULL` — e.g. `^1.2.0`, `[1.0,2.0)`
- `scope TEXT NULL` — enum: `COMPILE`, `RUNTIME`, `TEST`, `PROVIDED`, `OPTIONAL` (Maven); `RUNTIME`, `DEV`, `PEER`, `OPTIONAL` (npm). Manifest-language-specific values stored verbatim.
- `manifest_path TEXT NULL` — e.g. `pom.xml`, `services/orders/package.json`
- `manifest_line INTEGER NULL`
- `evidence_source TEXT NULL`, `confidence DECIMAL(4,3) NULL` (no DB CHECK)
- `description TEXT NOT NULL`, `tags TEXT NOT NULL`
- Index on `model_file_id`

### `ApplicationPoint` extension

- `application_points.target_type` already accepts `APPLICATION`, `APPLICATION_COMPONENT`, `SERVICE`. Add `LIBRARY` as an allowed value.
- Single migration: update the CHECK constraint (or value list, depending on existing implementation).
- No structural change — just a one-line allowed-values update.

### Out of scope (this spec)

- Frontend TypeScript types (Spec 2).
- Tables UI / gridConfigs (Spec 2).
- Discovery service deterministic resolvers, preflight modal, transitive walker, right-click menu items, progress UX (Spec 3).
- Per-version Library rows (versions stay on the edge).
- `core_tech` LLM resolution wiring for Libraries (the columns are added but resolver wiring stays generic; spec-3 connects discovery's tech-hints resolver to libraries the same way it does for services).

### Backend integration requirements

- Add Liquibase changesets for `libraries` table, `code_unit_dependencies` table, and the `application_points.target_type` CHECK constraint update.
- New JPA entity classes (`LibraryEntity`, `CodeUnitDependencyEntity`).
- New DTO records (`LibraryDto`, `CodeUnitDependencyDto`).
- New repositories (`LibraryRepository`, `CodeUnitDependencyRepository`) with `findByModelFileId` + `deleteByModelFileId`.
- `EntityMapper` extended bidirectionally for both new types.
- `MetaModelEntitiesDto` +1 list (`libraries`).
- `MetaModelRelationshipsDto` +1 list (`code_unit_dependencies`).
- `ModelService` save/load/delete-and-replace pipelines extended:
  - Save order: existing → `libraries` → existing relationships → `code_unit_dependencies`.
  - Delete order: `code_unit_dependencies` → existing relationships → existing entities → `libraries`.
- `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`:
  - Block A (entities): `libraries` after `services` (parallel domain, makes natural cluster).
  - Block B (relationships): `code_unit_dependencies` at end.
- `ArchitectureElementInventoryService`:
  - `TABLES_BY_DOMAIN.Application` += `libraries` and `code_unit_dependencies`.
  - `DISPLAY_NAME_FALLBACK_TABLES` += `code_unit_dependencies` only (no `name` column). `libraries` has `name`.
- One round-trip integration test class covering save/load/delete-and-replace + scoping for both new tables.

### Acceptance criteria

- Backend supports Library records scoped by project and architecture.
- Backend supports CodeUnitDependency records scoped by project and architecture.
- Source side of dependency can be a Service or a Library via `ApplicationPoint`.
- Target side of dependency must be a Library (validated at the data layer via the polymorphic point's `target_type` constraint).
- Internal libraries (with `repo_location`/`repo_subfolder` set) and external libraries (without) round-trip cleanly.
- Library identity is `(name, ecosystem)`; multiple library rows with the same `name` but different `ecosystem` coexist.
- Edge declared coordinates (`declared_name`, `declared_version`, `declared_version_range`, `scope`, `manifest_path`, `manifest_line`) round-trip cleanly.
- Full-model save/load/delete-and-replace integrates Libraries and dependencies via existing `ModelService`.
- `ArchitectureCloneService` and `ArchitectureElementInventoryService` correctly include the new tables.
- `application_points.target_type = 'LIBRARY'` is accepted; existing target types continue to work unchanged.
- Existing Application-domain behaviour (Service, AppComponent, Application, related relationships) remains unchanged.
- New backend tests cover round-trip + scoping + polymorphic ApplicationPoint extension.
- No frontend changes, no discovery service changes, no gateway / MCP changes.

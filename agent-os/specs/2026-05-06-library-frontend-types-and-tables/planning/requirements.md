# Spec Requirements: Library Frontend Types & Tables

## Initial Description

Spec 2 of 3 in the Library arc. Spec 1 (`agent-os/specs/2026-05-05-library-backend-foundation/`) landed the backend `LibraryEntity` (parallel to `Service` in the Application domain), the `CodeUnitDependencyEntity` relationship table (polymorphic via `ApplicationPoint` with the new `LIBRARY` target_type), 5 tech-hints columns mirroring Service, 6 spec-7 provenance columns, and full integration with `ModelService` save/load/delete + `ArchitectureCloneService` + `ArchitectureElementInventoryService`. The backend round-trips both new types via the existing `/api/model/projects/{p}/architectures/{a}` endpoint.

This spec adds the frontend layer:
- New TypeScript interfaces `Library` and `CodeUnitDependency` in `frontend/src/types/model.ts`.
- `MetaModelEntities`/`MetaModelRelationships`/`EntityType`/`RelationshipType`/`AnyEntity`/`AnyRelationship` extensions.
- `ApplicationPointKind` += `'LIBRARY'`, `ApplicationPointTargetType` enum += `LIBRARY = 'LIBRARY'`.
- `emptyModel` defaults + 2 `??=` backfill lines in `normalizeModelFromApi` for safe load of older payloads.
- 2 new `gridConfigs` entries (`libraries`, `code_unit_dependencies`) plus tab-map / domain-grouping wiring.
- 2 new picklist arrays (`ecosystemOptions`, `dependencyScopeOptions`) in `defaults.ts`.
- `ApplicationPointPickerCell` extended with a 6th `'libraries'` group and `LIBRARY` `kindToGroup` entry; `applicationPointDerivation.ts` extended with a 4th `LIBRARY` arm; `applicationPointDisplayFormatter` extended with a 4th `LIBRARY` case + `APPLICATION_POINT_KIND_LABELS.LIBRARY`.
- `TechHintsCell` / `GridCell` typing relaxation so `tech_hints_cell` works on Library rows without TS errors.
- One Vitest config test asserting the wiring.
- Carry-forward fix to `relationshipDefinitions.test.ts:31` (17 -> 19).

No backend, gateway, MCP, or discovery changes (Discovery integration is Spec 3).

The full raw idea is preserved at `agent-os/specs/2026-05-06-library-frontend-types-and-tables/planning/00-raw-idea.md`. Codebase grounding is preserved at `planning/codebase-grounding.md`.

## Requirements Discussion

### First Round Questions

**Q1: `code_unit_dependencies` relationship display name — what string?**
**Answer:** `"Library Dependency"`. Used as the key in `relationshipTabToType`, the value in `relationshipTabNames`, the appended entry in `RELATIONSHIP_TAB_ORDER`, and the `displayName` of the `RELATIONSHIP_DEFINITIONS` entry.

**Q2: `code_unit_dependencies` `endpointEntityTypes` — which array?**
**Answer:** `['application_points', 'services', 'libraries']`. Mirrors spec 7's `iac_resource_bindings` precedent (polymorphic anchor + concrete endpoint types). This causes `getRelationshipsForDomain('application')` to include `code_unit_dependencies` because all three entity types map to the Application domain via `ENTITY_TYPE_TO_DOMAIN`. No cross-domain spillage.

**Q3: `domainGroupings.application` — where does `'Libraries'` go in the tab order?**
**Answer:** Directly after `'Services'`. Matches Spec 1 backend `ArchitectureCloneService` ordering (`Application` -> `AppComponent` -> `Service` -> `Library` -> `Interface` -> `Endpoint` -> ...) and reflects the conceptual parallel between `Service` and `Library`.

**Q4: `tech_hints_cell` typing relaxation — minimal fix or full generalisation?**
**Answer:** Option (a) — the minimal fix. Define a shared `TechHintsRow` interface (or `Pick<Service, ...>` of the 9 relevant fields: `id`, `core_tech`, `repo_location`, `repo_subfolder`, `core_tech_resolved`, `core_tech_language_pack`, `core_tech_framework_packs`, `core_tech_resolution_confidence`, `core_tech_resolved_at`), update `TechHintsCellProps.service` to use that type, and drop the `entity as unknown as Service` cast in `GridCell.tsx` line 332. Library inherits the LLM resolver flow with no further changes (the `pendingResolutionsStore`/`SaveWithPendingResolves` machinery is already row-id-keyed and type-agnostic).

**Q5: 6 provenance fields on Libraries — hidden round-trip-only or visible columns?**
**Answer:** **Visible columns.** Overrides the original raw-idea recommendation to hide all 6 (which mirrored the spec 7 trim for the 12 Infra entities). Rationale: Library is a brand-new table, there is plenty of horizontal room for 6 more columns, and provenance is load-bearing for Library specifically — the manual-vs-discovered distinction is THE key marker once Spec 3 (Discovery integration) lands. Visible-column treatments:
- `source_origin` — `cellType: 'dropdown'` against `sourceOriginOptions` (REUSE existing array — see verification pass).
- `source_system` — `cellType: 'text'`.
- `source_reference` — `cellType: 'text'`.
- `generation_status` — `cellType: 'dropdown'` against `generationStatusOptions` (REUSE existing array).
- `generation_notes` — `cellType: 'text'`.
- `last_verified_at` — `cellType: 'text'` (ISO-8601 date string; no special date cellType exists in the codebase, matches `valid_from`/`valid_to` precedent).

All 6 are positioned at the END of the Libraries column list, after `valid_to`.

### Inferred Decisions (all 13 accepted as-is)

These were inferred from the codebase grounding and accepted by the user without override:

1. **`Library` TS interface mirrors `Service` field shape minus Service-specific fields.** No `application_id`, no `service_type`, no `app_component_id`, no `is_internal`. Snake_case, all fields optional except `id`/`description`/`tags` (typed `string`, default empty). Includes `name?` (optional at TS level even though backend NOT NULL — matches existing entity TS pattern), `ecosystem?`, `repo_location?`, `repo_subfolder?`, `core_tech?`, `core_tech_resolved?`, `core_tech_language_pack?`, `core_tech_framework_packs?: string[] | null`, `core_tech_resolution_confidence?`, `core_tech_resolved_at?`, `package_set_id?`, `valid_from?`, `valid_to?`, plus the 6 provenance fields.
2. **`CodeUnitDependency` TS interface follows relationship convention.** `id`, `description?`, `tags?` (relationship convention: nullable per Spec 1), `source_application_point_id` and `target_application_point_id` (both required strings, FK to `application_points`), `declared_name?`, `declared_version?`, `declared_version_range?`, `scope?`, `manifest_path?`, `manifest_line?: number`, `evidence_source?`, `confidence?: number`. No `name`/`valid_from`/`valid_to` (relationships don't have them).
3. **`EntityType`/`RelationshipType` unions extended additively.** `EntityType` += `'libraries'`; `RelationshipType` += `'code_unit_dependencies'`. `AnyEntity` and `AnyRelationship` discriminated unions extended.
4. **`ApplicationPointKind` += `'LIBRARY'`** (line 464 of `model.ts`) so the picker's `kindToGroup` includes it.
5. **`ApplicationPointTargetType` enum += `LIBRARY = 'LIBRARY'`** (line 455) — TS-level only; backend Spec 1 already accepts the value via CHECK constraint extension.
6. **`emptyModel`** in `defaults.ts` += `libraries: []` (entities block) and `code_unit_dependencies: []` (relationships block).
7. **`normalizeModelFromApi`** in `modelSerialization.ts` += 2 `??=` backfill lines mirroring spec 7's pattern at lines 102 and 117.
8. **`ENTITY_TYPE_TO_DOMAIN.libraries = 'application'`** in `relationshipDefinitions.ts`. Library is part of the Application domain (parallel to Service).
9. **`DOMAIN_TO_ENTITY_TYPES.application` += `'libraries'`** and **`DOMAIN_TO_RELATIONSHIP_TYPES.application` += `'code_unit_dependencies'`** in `contextPickerDomainMappings.ts`.
10. **`DOMAIN_ENTITY_TYPES.application` += `'libraries'`** in `gridConfigs.ts` (currently 10 entries, becomes 11).
11. **`RELATIONSHIP_TAB_ORDER` += `'Library Dependency'`** appended at end (currently 18 post-spec-7, becomes 19).
12. **Reuse existing cellTypes — no new cellType creation.** `application_point_picker`, `tech_hints_cell`, `package_set_dropdown`, `dropdown`, `text`, `tags`. The existing `application_point_picker` is extended with a 6th group; not replaced.
13. **2 spec-7 provenance picklist arrays — REUSE if exported from `defaults.ts`, otherwise add.** `sourceOriginOptions` and `generationStatusOptions`. Updated post-Q5 verification: both are EXPORTED from `defaults.ts` at lines 1317-1318 (added by spec 7). Spec 2 REUSES them — does NOT redeclare.

### Existing Code to Reference

The codebase grounding identified the following reference points:

- **`Service` TS interface** at `frontend/src/types/model.ts:361-392` — primary template for `Library`. Snake_case shape with 5 tech-hints columns. Confirmed `core_tech_framework_packs: string[] | null`.
- **`ApplicationPoint` TS shape** at `frontend/src/types/model.ts:455-520` — `ApplicationPointTargetType` enum (3 values today; Spec 2 adds `LIBRARY`), `ApplicationPointKind` union (5 values today; Spec 2 adds `'LIBRARY'`).
- **`ApplicationPointPickerCell.tsx`** at `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` (622 lines) — extension targets: `OptionGroup` union (line 56), `kindToGroup` (lines 230-237), `buildGroupedOptions()` (lines 244-390), `targetTypeMap` (lines 489-495), `allGroups` (line 554), `GROUP_LABELS` (lines 176-182). Already supports `allowedKinds?: string[]` filtering (line 117).
- **`applicationPointDerivation.ts`** at `frontend/src/utils/applicationPointDerivation.ts` (429 lines) — `DerivedTargetType` union (line 39), `generateDerivedApplicationPointId` (line 72), `generateDerivedApplicationPointName` (line 98), `createDerivedApplicationPointForService` (line 192) — closest blueprint for `createDerivedApplicationPointForLibrary`. `ensureDerivedApplicationPoint` (line 289) and `getTargetEntityInfo` (line 360) need a 4th `LIBRARY` arm. Library has no `application_id` — set `application_id: ''` (empty string) to satisfy `ApplicationPoint.application_id: string`.
- **`formatters.ts`** at `frontend/src/utils/formatters.ts:91-172` — `formatApplicationPointDisplay` already switches on `targetType` with `SERVICE`/`CLASS`/`METHOD` cases (lines 103-123). Add a 4th `'LIBRARY'` case looking up `entities.libraries`. `APPLICATION_POINT_KIND_LABELS` at lines 59-65 += `'LIBRARY': 'Library'`.
- **`TechHintsCell.tsx`** + **`GridCell.tsx`** — see Q4. `TechHintsCellProps.service: Service` (typed) and `entity as unknown as Service` cast (line 332) need relaxation.
- **`gridConfigs.ts`** at `frontend/src/config/gridConfigs.ts` (1332 lines) — pattern for new entries; tab-map locations; spec 7 IaC entries are the closest precedent for provenance-column placement.
- **`RELATIONSHIP_DEFINITIONS`** at `frontend/src/config/relationshipDefinitions.ts:51-183` — `iac_resource_bindings` entry (lines 158-182) is the spec-7 precedent for polymorphic-anchor `endpointEntityTypes` shape.
- **`defaults.ts`** at `frontend/src/config/defaults.ts:959+` — picklist option array shape pattern. Spec 7 provenance arrays at lines 1317-1318 (`sourceOriginOptions`, `generationStatusOptions`) — REUSE.
- **`pendingResolutionsStore`** at `frontend/src/stores/pendingResolutionsStore.ts` and **`SaveWithPendingResolves.tsx`** — keyed by `rowId`, type-agnostic; no changes required.
- **Existing spec-7 backfill lines** at `frontend/src/api/modelSerialization.ts:102, 117` — pattern for the 2 new `??=` lines.

### Follow-up Questions

No follow-up questions were required. The user provided concrete answers on all 5 open questions and accepted all 13 inferred decisions. The post-answer verification of `sourceOriginOptions`/`generationStatusOptions` confirmed both are already exported by spec 7 — spec 2 reuses both.

## Visual Assets

### Files Provided

Bash check on `agent-os/specs/2026-05-06-library-frontend-types-and-tables/planning/visuals/` returned no image/PDF files.

No visual assets provided.

### Visual Insights

N/A — frontend types + table-config + picker-extension spec, no UI artefacts. Reference UX is the existing per-domain `MetaModelView` rendering against `gridConfigs[<key>]`, the existing `ApplicationPointPickerCell` grouped dropdown UX, and the existing `TechHintsCell` resolver-chip UX.

## Requirements Summary

### Functional Requirements

The frontend must:

1. **Add `Library` TypeScript interface** to `frontend/src/types/model.ts`. Snake_case fields mirroring `Service` minus Service-specifics (no `application_id`, no `service_type`, no `app_component_id`, no `is_internal`). Includes `id` (required string), `description: string` (typed required), `tags: string` (typed required), `name?`, `ecosystem?`, `repo_location?`, `repo_subfolder?`, `core_tech?`, `core_tech_resolved?: Record<string, unknown> | null`, `core_tech_language_pack?: string | null`, `core_tech_framework_packs?: string[] | null`, `core_tech_resolution_confidence?: 'high' | 'low' | 'none' | 'tech-only' | 'manual-override' | null`, `core_tech_resolved_at?: string | null`, `package_set_id?`, `valid_from?`, `valid_to?`, plus the 6 provenance fields (`source_origin?`, `source_system?`, `source_reference?`, `generation_status?`, `generation_notes?`, `last_verified_at?`).
2. **Add `CodeUnitDependency` TypeScript interface** to `frontend/src/types/model.ts`. `id`, `description?`, `tags?` (relationship convention: nullable per Spec 1), `source_application_point_id` (required string FK), `target_application_point_id` (required string FK), `declared_name?`, `declared_version?`, `declared_version_range?`, `scope?`, `manifest_path?`, `manifest_line?: number`, `evidence_source?`, `confidence?: number`.
3. **Extend `MetaModelEntities`** with `libraries: Library[]` and **`MetaModelRelationships`** with `code_unit_dependencies: CodeUnitDependency[]`.
4. **Extend `EntityType` string union** with `'libraries'`, **`RelationshipType` string union** with `'code_unit_dependencies'`, and the **`AnyEntity` / `AnyRelationship` discriminated unions** accordingly.
5. **Extend `ApplicationPointKind`** (line 464) with `'LIBRARY'` and **`ApplicationPointTargetType` enum** (line 455) with `LIBRARY = 'LIBRARY'`.
6. **Extend `emptyModel`** in `defaults.ts` with `libraries: []` (entities block) and `code_unit_dependencies: []` (relationships block).
7. **Add 2 `??=` backfill lines** to `normalizeModelFromApi` in `modelSerialization.ts` mirroring spec 7's existing pattern.
8. **Add 2 new `gridConfigs` entries** (`libraries`, `code_unit_dependencies`) — full column shapes below.
9. **Wire tab maps**: `tabToEntityType['Libraries'] = 'libraries'`, `entityTabNames` += `'Libraries'`, `relationshipTabToType['Library Dependency'] = 'code_unit_dependencies'`, `relationshipTabNames` += `'Library Dependency'`, `domainGroupings.application` += `'Libraries'` directly after `'Services'`, `DOMAIN_ENTITY_TYPES.application` += `'libraries'`, `RELATIONSHIP_TAB_ORDER` += `'Library Dependency'`.
10. **Wire `RELATIONSHIP_DEFINITIONS`** with new entry: `relationshipKey: 'code_unit_dependencies'`, `displayName: 'Library Dependency'`, `endpointEntityTypes: ['application_points', 'services', 'libraries']`.
11. **Wire `ENTITY_TYPE_TO_DOMAIN.libraries = 'application'`** in `relationshipDefinitions.ts`.
12. **Wire `contextPickerDomainMappings.ts`**: `DOMAIN_TO_ENTITY_TYPES.application` += `'libraries'`; `DOMAIN_TO_RELATIONSHIP_TYPES.application` += `'code_unit_dependencies'`.
13. **Add 2 new picklist arrays** to `defaults.ts`: `ecosystemOptions = ['MAVEN', 'NPM', 'PYPI', 'NUGET', 'GO', 'OTHER']` and `dependencyScopeOptions = ['COMPILE', 'RUNTIME', 'TEST', 'PROVIDED', 'OPTIONAL', 'DEV', 'PEER']`.
14. **Reuse `sourceOriginOptions` and `generationStatusOptions`** from `defaults.ts:1317-1318` (do NOT redeclare).
15. **Extend `ApplicationPointPickerCell.tsx`** with the 6th `'libraries'` group: add to `OptionGroup` union, add `LIBRARY: 'libraries'` to `kindToGroup`, add a 6th block to `buildGroupedOptions()` listing `entities.libraries` as raw-entity selections (derived-only, no existing-AP path), add `libraries: 'LIBRARY'` to `targetTypeMap`, add `'libraries'` to `allGroups`, add `libraries: 'Libraries'` to `GROUP_LABELS`, add `getLibraryDisplayText(library)` helper paralleling `getServiceDisplayText`.
16. **Extend `applicationPointDerivation.ts`**: `DerivedTargetType` union += `'LIBRARY'`; new `createDerivedApplicationPointForLibrary(library)` function (sets `application_id: ''` because Library has none); 4th `case 'LIBRARY'` in `ensureDerivedApplicationPoint`; 4th `case 'LIBRARY'` in `getTargetEntityInfo`. Derived AP id pattern: `ap_derived_library_<id>`. Derived AP name pattern: `<libraryName> (Library)`.
17. **Extend `formatters.ts`**: `APPLICATION_POINT_KIND_LABELS` += `'LIBRARY': 'Library'`; `formatApplicationPointDisplay` switch += 4th `case 'LIBRARY'` looking up `entities.libraries` by `target_ref_id`.
18. **Relax `TechHintsCell` typing** per Q4: define a shared `TechHintsRow` interface (or `Pick<Service, ...>` of the 9 relevant fields), update `TechHintsCellProps.service` to use it, drop the `entity as unknown as Service` cast in `GridCell.tsx`. Library rows then use `cellType: 'tech_hints_cell'` on their `core_tech` column with no further changes.
19. **Add one Vitest config test** at `frontend/src/config/__tests__/libraryConfigAndTypes.test.ts` asserting:
    - 2 new `gridConfigs` entries exist (`libraries`, `code_unit_dependencies`) with required-field columns.
    - Tab maps include the 2 new entries.
    - `RELATIONSHIP_DEFINITIONS` has the new `code_unit_dependencies` entry with `endpointEntityTypes: ['application_points', 'services', 'libraries']`.
    - `ENTITY_TYPE_TO_DOMAIN.libraries === 'application'`.
    - `DOMAIN_TO_ENTITY_TYPES.application` includes `'libraries'`.
    - `DOMAIN_TO_RELATIONSHIP_TYPES.application` includes `'code_unit_dependencies'`.
    - 2 new picklist arrays (`ecosystemOptions`, `dependencyScopeOptions`) exist with expected values.
20. **Carry-forward fix** to `frontend/src/__tests__/relationshipDefinitions.test.ts:31` — bump `expect(RELATIONSHIP_DEFINITIONS).toHaveLength(17)` to `19` (was wrong post-spec-7 at 18; spec 2 makes it 19).
21. **Preserve existing behaviour** for all other Application-domain entities (Service, ApplicationComponent, Application, related relationships) and all non-Application domains. No edits to `MetaModelView.tsx`. No new cellType creation.

### Per-Table Column Specifications

All entity tables include the standard envelope: `name` (text), `description` (text), `tags` (tags), `valid_from` (text, width 100), `valid_to` (text, width 100). All FK columns use `cellType: 'fk_typeahead'` unless otherwise noted. All dropdowns use `formatOptionLabel: snakeCaseToTitleCase`.

#### Entity: `libraries`

| field | cellType | required | options / fkTarget / config | width |
|---|---|---|---|---|
| name | text | true | — | 200 |
| ecosystem | dropdown | false | `ecosystemOptions` | 140 |
| repo_location | text | false | — | 220 |
| repo_subfolder | text | false | — | 200 |
| core_tech | tech_hints_cell | false | — (LLM resolver flow shared with Service via relaxed `TechHintsRow` typing) | 220 |
| package_set_id | package_set_dropdown | false | — | 200 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |
| valid_from | text | false | — | 100 |
| valid_to | text | false | — | 100 |
| source_origin | dropdown | false | `sourceOriginOptions` (REUSE — see verification) | 160 |
| source_system | text | false | — | 160 |
| source_reference | text | false | — | 200 |
| generation_status | dropdown | false | `generationStatusOptions` (REUSE — see verification) | 160 |
| generation_notes | text | false | — | 250 |
| last_verified_at | text | false | — (ISO-8601 string; matches `valid_from`/`valid_to` precedent) | 140 |

Notes:
- The 5 backing tech-hints fields (`core_tech_resolved`, `core_tech_language_pack`, `core_tech_framework_packs`, `core_tech_resolution_confidence`, `core_tech_resolved_at`) are NOT exposed as separate grid columns. They are written to by the `TechHintsCell` resolver flow and round-trip via save/load only — same pattern as Service.
- 6 provenance columns positioned at end after `valid_to` per Q5.

#### Relationship: `code_unit_dependencies`

| field | cellType | required | options / config | width |
|---|---|---|---|---|
| source_application_point_id | application_point_picker | true | `allowedKinds: ['SERVICE', 'LIBRARY']` (source can be either Service or Library — declarer side) | 280 |
| target_application_point_id | application_point_picker | true | `allowedKinds: ['LIBRARY']` (target is always Library — dependency side) | 280 |
| declared_name | text | false | — | 200 |
| declared_version | text | false | — | 140 |
| declared_version_range | text | false | — | 180 |
| scope | dropdown | false | `dependencyScopeOptions` | 140 |
| manifest_path | text | false | — | 220 |
| manifest_line | text | false | — (no `number` cellType in codebase; matches `port` precedent) | 100 |
| evidence_source | text | false | — | 180 |
| confidence | text | false | — | 100 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |

Notes:
- Some fields (notably `manifest_path`, `manifest_line`, `evidence_source`, `confidence`) are populated by the Spec 3 deterministic resolver. In V1 they are user-editable text columns with no special read-only treatment.
- No `name`/`valid_from`/`valid_to` (relationship convention).

### Picklist Option Arrays

```ts
// New in this spec — add to defaults.ts:
export const ecosystemOptions: string[] = ['MAVEN', 'NPM', 'PYPI', 'NUGET', 'GO', 'OTHER'];
export const dependencyScopeOptions: string[] = ['COMPILE', 'RUNTIME', 'TEST', 'PROVIDED', 'OPTIONAL', 'DEV', 'PEER'];
```

`'OPTIONAL'` is shared between Maven (`COMPILE,RUNTIME,TEST,PROVIDED,OPTIONAL`) and npm (`RUNTIME,DEV,PEER,OPTIONAL`) but is the same UPPERCASE token — no duplication. Display via `formatOptionLabel: snakeCaseToTitleCase` at column-config level.

#### REUSED (do NOT redeclare)

Verified live read of `frontend/src/config/defaults.ts` — both arrays exist (added by spec 7):

```ts
// Line 1317 (existing, exported by spec 7):
export const sourceOriginOptions: string[] = ['MANUAL', 'DISCOVERED', 'IMPORTED', 'GENERATED', 'SUGGESTED', 'OTHER'];
// Line 1318 (existing, exported by spec 7):
export const generationStatusOptions: string[] = ['NOT_READY', 'READY', 'GENERATED', 'BLOCKED', 'NOT_APPLICABLE', 'UNKNOWN'];
```

Spec 2 imports/references these — **does not redeclare**.

### File Touch Summary

| # | File | Change |
|---|---|---|
| 1 | `frontend/src/types/model.ts` | Add `Library` interface; add `CodeUnitDependency` interface; extend `MetaModelEntities` with `libraries`; extend `MetaModelRelationships` with `code_unit_dependencies`; extend `EntityType` union with `'libraries'`; extend `RelationshipType` union with `'code_unit_dependencies'`; extend `AnyEntity` and `AnyRelationship` unions; extend `ApplicationPointKind` with `'LIBRARY'`; extend `ApplicationPointTargetType` enum with `LIBRARY = 'LIBRARY'`. |
| 2 | `frontend/src/config/defaults.ts` | `emptyModel.metaModel.entities` += `libraries: []`; `emptyModel.metaModel.relationships` += `code_unit_dependencies: []`; add 2 new picklist arrays (`ecosystemOptions`, `dependencyScopeOptions`). REUSE `sourceOriginOptions` + `generationStatusOptions` (already exported). |
| 3 | `frontend/src/api/modelSerialization.ts` | `normalizeModelFromApi` += 2 `??=` backfill lines (`cloned.metaModel.entities.libraries ??= []`; `cloned.metaModel.relationships.code_unit_dependencies ??= []`). |
| 4 | `frontend/src/config/gridConfigs.ts` | Add 2 new `gridConfigs` entries (`libraries` with 16 columns, `code_unit_dependencies` with 12 columns). Tab maps: `tabToEntityType` += `'Libraries'`, `entityTabNames` += `'Libraries'`, `relationshipTabToType` += `'Library Dependency'`, `relationshipTabNames` += `'Library Dependency'`. `domainGroupings.application` += `'Libraries'` after `'Services'`. `DOMAIN_ENTITY_TYPES.application` += `'libraries'`. |
| 5 | `frontend/src/config/relationshipDefinitions.ts` | `ENTITY_TYPE_TO_DOMAIN.libraries = 'application'`. `RELATIONSHIP_DEFINITIONS` += new entry `{ relationshipKey: 'code_unit_dependencies', displayName: 'Library Dependency', endpointEntityTypes: ['application_points', 'services', 'libraries'] }`. `RELATIONSHIP_TAB_ORDER` += `'Library Dependency'`. |
| 6 | `frontend/src/utils/contextPickerDomainMappings.ts` | `DOMAIN_TO_ENTITY_TYPES.application` += `'libraries'`. `DOMAIN_TO_RELATIONSHIP_TYPES.application` += `'code_unit_dependencies'`. |
| 7 | `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` | `OptionGroup` union += `'libraries'`. `kindToGroup` += `LIBRARY: 'libraries'`. `buildGroupedOptions()` += 6th block listing `entities.libraries` as raw-entity selections. `targetTypeMap` += `libraries: 'LIBRARY'`. `allGroups` += `'libraries'`. `GROUP_LABELS` += `libraries: 'Libraries'`. New `getLibraryDisplayText(library)` helper. |
| 8 | `frontend/src/utils/applicationPointDerivation.ts` | `DerivedTargetType` union += `'LIBRARY'`. New `createDerivedApplicationPointForLibrary(library)` (sets `application_id: ''`). `ensureDerivedApplicationPoint` += 4th `case 'LIBRARY'`. `getTargetEntityInfo` += 4th `case 'LIBRARY'`. |
| 9 | `frontend/src/utils/formatters.ts` | `APPLICATION_POINT_KIND_LABELS` += `'LIBRARY': 'Library'`. `formatApplicationPointDisplay` switch += 4th `case 'LIBRARY'` looking up `entities.libraries` by `target_ref_id`. |
| 10 | `frontend/src/components/Grid/TechHintsCell.tsx` | Define a shared `TechHintsRow` interface (the 9 relevant fields). Change `TechHintsCellProps.service: Service` to `TechHintsCellProps.row: TechHintsRow` (or keep `service` name with new type — minimal blast radius wins). |
| 11 | `frontend/src/components/Grid/GridCell.tsx` | `case 'tech_hints_cell'` arm: drop `entity as unknown as Service` cast (line 332); pass entity directly typed as `TechHintsRow`. |
| 12 | `frontend/src/__tests__/relationshipDefinitions.test.ts` | Bump `expect(RELATIONSHIP_DEFINITIONS).toHaveLength(17)` to `19` (carry-forward; was 18 post-spec-7, becomes 19 here). |
| 13 | **NEW** `frontend/src/config/__tests__/libraryConfigAndTypes.test.ts` | Vitest config test asserting wiring (see Functional Requirement 19). Modelled on `userJourneyLinksConfig.test.ts` and `infrastructureTerraformReadinessConfig.test.ts`. |

**Files NOT to touch** (already correct or out of scope):
- `frontend/src/components/MetaModelView/MetaModelView.tsx` — already domain-agnostic.
- Backend, gateway, MCP, discovery — out of scope.
- Diagram files (palette / shape / generator) — out of scope.

### Verification Pass — `defaults.ts` provenance arrays

Live read of `frontend/src/config/defaults.ts` confirms:

| Array | Status | Line |
|---|---|---|
| `sourceOriginOptions` | **EXPORTED** by spec 7 | 1317 |
| `generationStatusOptions` | **EXPORTED** by spec 7 | 1318 |

Both arrays carry the exact values listed in the user's Q5 answer (`['MANUAL', 'DISCOVERED', 'IMPORTED', 'GENERATED', 'SUGGESTED', 'OTHER']` and `['NOT_READY', 'READY', 'GENERATED', 'BLOCKED', 'NOT_APPLICABLE', 'UNKNOWN']`). **Spec 2 reuses both — no redeclaration.**

The block-comment header at lines 1247-1260 (the spec-4 Infrastructure Picklist Options banner) and the spec-7 banner at lines 1301-1316 already document the reuse pattern. Spec 2 should append a new banner above its 2 new arrays:

```ts
// ============================================================================
// Spec 2026-05-06: Library Frontend Types & Tables - 2 new picklist arrays
//
// Reused arrays (do NOT redeclare):
// - sourceOriginOptions (line 1317): libraries.source_origin
// - generationStatusOptions (line 1318): libraries.generation_status
// ============================================================================
```

### Reusability Opportunities

- **`Service` TS interface** at `model.ts:361-392` — primary template for `Library` shape.
- **`ApplicationPointPickerCell.tsx`** — 6-step extension pattern documented in codebase grounding §3.
- **`applicationPointDerivation.ts`** `createDerivedApplicationPointForService` — closest blueprint for `createDerivedApplicationPointForLibrary`.
- **`iac_resource_bindings`** entry in `relationshipDefinitions.ts:158-182` — spec-7 precedent for polymorphic-anchor `endpointEntityTypes` shape.
- **Spec-7 `??=` backfill lines** in `modelSerialization.ts:102, 117` — pattern for the 2 new lines.
- **Spec-4 + spec-7 picklist banners** in `defaults.ts:1247-1316` — pattern for spec-2's banner above new arrays.
- **`userJourneyLinksConfig.test.ts` + `infrastructureTerraformReadinessConfig.test.ts`** — Vitest patterns for the new config test.
- **Existing `tech_hints_cell` flow** — once `TechHintsRow` typing is in place, Library inherits resolver chip rendering, `pendingResolutionsStore`, and `SaveWithPendingResolves` for free.
- **Existing `package_set_dropdown` cellType** — reused as-is for `libraries.package_set_id`.

### Scope Boundaries

**In Scope:**
- 2 new TS interfaces (`Library`, `CodeUnitDependency`).
- `MetaModel*` / `EntityType` / `RelationshipType` / `AnyEntity` / `AnyRelationship` extensions.
- `ApplicationPointKind` + `ApplicationPointTargetType` enum extensions.
- `emptyModel` defaults + 2 `??=` backfill lines in `normalizeModelFromApi`.
- 2 new `gridConfigs` entries (`libraries` 16 columns, `code_unit_dependencies` 12 columns).
- Tab-map / domain-grouping wiring (`tabToEntityType`, `entityTabNames`, `relationshipTabToType`, `relationshipTabNames`, `domainGroupings.application`, `DOMAIN_ENTITY_TYPES.application`, `RELATIONSHIP_TAB_ORDER`).
- `RELATIONSHIP_DEFINITIONS` += `code_unit_dependencies`; `ENTITY_TYPE_TO_DOMAIN.libraries = 'application'`.
- `contextPickerDomainMappings.ts` extensions.
- 2 new picklists (`ecosystemOptions`, `dependencyScopeOptions`); reuse `sourceOriginOptions` + `generationStatusOptions`.
- `ApplicationPointPickerCell.tsx` 6-step extension.
- `applicationPointDerivation.ts` 4th-arm extension + new helper.
- `formatters.ts` 4th case + label.
- `TechHintsCell.tsx` + `GridCell.tsx` typing relaxation (Q4 minimal fix).
- One new Vitest config test.
- Carry-forward fix to `relationshipDefinitions.test.ts:31`.
- 6 provenance columns visible on `libraries` grid (Q5 override).

**Out of Scope** (raw idea exclusions preserved):
- Discovery integration — deterministic resolvers, preflight modal, transitive walker, right-click menu items, scan progress UX. **Spec 3.**
- Per-version Library rows — versions stay on the edge.
- Provenance/readiness fields exposed as visible grid columns on existing Application-domain entities (Service / AppComponent / Application / etc.).
- Diagram support for Library / CodeUnitDependency — current Application diagrams via General DiagramType already work via free-form authoring playground.
- LLM tech-hints resolver wiring for Libraries — the `tech_hints_cell` cellType is reused; the actual resolver call is shared with Service and works because Library has the same 5 tech-hints columns.
- New cellType creation — reuse existing `application_point_picker`, `tech_hints_cell`, `package_set_dropdown`, `dropdown`, `text`, `tags`.
- Backend changes — Spec 1 covered.
- Gateway / MCP / Discovery code changes.
- Renderer / component tests beyond TS compile + the one config test.
- Heavy validation against real package-manager constraints.

### Technical Considerations

- **Locked field contract** — every grid `field` key matches the spec 1 backend column name exactly. The Library TS interface mirrors `Service`'s shape but drops Service-specifics (`application_id`, `service_type`, `app_component_id`, `is_internal`).
- **No `'number'` cellType in the codebase** — `manifest_line` and `confidence` use `cellType: 'text'`. Matches `port` and `sequence_order` precedent.
- **No multiline edit cell** — `description` and `generation_notes` use single-line `cellType: 'text'`.
- **No date cellType** — `last_verified_at`, `valid_from`, `valid_to` use `cellType: 'text'` with ISO-8601 strings.
- **`TechHintsCell` typing relaxation is REQUIRED** — without Q4's minimal fix, applying `cellType: 'tech_hints_cell'` to Library produces TS errors at the `entity as unknown as Service` cast site (line 332 of `GridCell.tsx`). The fix is local: define `TechHintsRow` and update one prop type.
- **Library has no `application_id`** — `createDerivedApplicationPointForLibrary` sets `application_id: ''` (empty string) to satisfy the TS-required `ApplicationPoint.application_id: string`. Mirrors the existing pattern for entities where `application_id` is optional or absent.
- **`allowedKinds` enforcement** — `code_unit_dependencies.source_application_point_id` uses `allowedKinds: ['SERVICE', 'LIBRARY']` (the declarer can be either); `target_application_point_id` uses `allowedKinds: ['LIBRARY']` (the dependency target is always Library).
- **Backward compatibility** — old saved models without `libraries` or `code_unit_dependencies` arrays load cleanly via the 2 `??=` backfill lines in `normalizeModelFromApi`. Existing non-Library Application-domain behaviour is untouched.
- **`pendingResolutionsStore` and `SaveWithPendingResolves`** — already row-id-keyed and type-agnostic; no changes required.
- **`relationshipDefinitions.test.ts:31` carry-forward** — existing assertion `toHaveLength(17)` was incorrect post-spec-7 (should have been 18). Spec 2 makes it 19. The carry-forward fix is local and required.

## Acceptance Criteria

(Combined raw-idea list + Q5 provenance-visible decision; preserved verbatim where possible.)

- New TypeScript interfaces `Library` and `CodeUnitDependency` exist with snake_case fields matching backend JSON.
- `MetaModelEntities` and `MetaModelRelationships` extended additively.
- `EntityType` and `RelationshipType` string unions extended; `AnyEntity` / `AnyRelationship` extended.
- `ApplicationPointKind` += `'LIBRARY'`; `ApplicationPointTargetType` enum += `LIBRARY = 'LIBRARY'`.
- `emptyModel` defaults `libraries: []` and `code_unit_dependencies: []`.
- `normalizeModelFromApi` adds `??=` backfill for both new arrays.
- `ENTITY_TYPE_TO_DOMAIN.libraries === 'application'`.
- `RELATIONSHIP_DEFINITIONS` includes new `code_unit_dependencies` entry with `displayName: 'Library Dependency'` and `endpointEntityTypes: ['application_points', 'services', 'libraries']`.
- `RELATIONSHIP_TAB_ORDER` updated with `'Library Dependency'`.
- `DOMAIN_TO_ENTITY_TYPES.application` and `DOMAIN_TO_RELATIONSHIP_TYPES.application` extended.
- `gridConfigs.libraries` and `gridConfigs.code_unit_dependencies` exist with appropriate columns.
- Tab maps (`tabToEntityType`, `entityTabNames`, `relationshipTabToType`, `relationshipTabNames`, `domainGroupings.application`, `DOMAIN_ENTITY_TYPES.application`) all updated.
- 2 new picklist arrays (`ecosystemOptions`, `dependencyScopeOptions`) added to `defaults.ts`.
- `sourceOriginOptions` and `generationStatusOptions` reused from existing exports (no redeclaration).
- 6 provenance columns (`source_origin`, `source_system`, `source_reference`, `generation_status`, `generation_notes`, `last_verified_at`) are VISIBLE in `gridConfigs.libraries`, positioned after `valid_to` (Q5 override).
- `application_point_picker` accepts `LIBRARY` kind: dropdown lists Library rows alongside Service / AppComponent / Application; selecting a Library auto-creates an ApplicationPoint with `target_type = 'LIBRARY'` via `applicationPointDerivation`.
- `applicationPointDisplayFormatter` renders `LIBRARY`-kinded points with the library name; `APPLICATION_POINT_KIND_LABELS.LIBRARY = 'Library'`.
- `core_tech` column on `libraries` uses the same `tech_hints_cell` cellType as Service; LLM resolution flow works for Library rows the same way it does for Service rows. `TechHintsCellProps` typing relaxed to accept Library (Q4 minimal fix).
- One Vitest config test asserts the wiring at `frontend/src/config/__tests__/libraryConfigAndTypes.test.ts`.
- `frontend/src/__tests__/relationshipDefinitions.test.ts:31` updated `toHaveLength(17)` -> `toHaveLength(19)` (carry-forward).
- Existing Application-domain behaviour (Service, AppComponent, Application, related relationships) remains unchanged.
- TS compiles with 0 net new errors.
- No backend / discovery / gateway / MCP changes.

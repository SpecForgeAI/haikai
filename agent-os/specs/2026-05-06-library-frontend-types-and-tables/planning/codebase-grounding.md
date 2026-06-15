# Codebase Grounding — Spec 2 of 3 (Library Frontend Types & Tables)

Pass-A grounding notes captured before question generation. References are absolute paths.

## 1. `Service` interface field shape (the blueprint for `Library` TS)

Location: `frontend/src/types/model.ts` lines 361-392.

Concrete shape (snake_case JSON, all fields optional except `id`/`name`/`description`/`tags`):

```ts
export interface Service {
  id: string;
  name: string;            // REQUIRED
  description: string;     // REQUIRED (TS — backend allows NULL but TS interface is non-optional)
  application_id: string;  // REQUIRED — Service-only; Library will not have this
  app_component_id?: string;
  service_type: string;    // REQUIRED — Service-only; Library will not have this
  core_tech?: string;
  repo_location?: string;
  repo_subfolder?: string;
  tags: string;            // REQUIRED (TS) — empty-string default, not optional
  valid_from?: string;
  valid_to?: string;
  package_set_id?: string;
  is_internal?: boolean;
  // 5 tech-hints columns (the LLM-resolution block)
  core_tech_resolved?: Record<string, unknown> | null;
  core_tech_language_pack?: string | null;
  core_tech_framework_packs?: string[] | null;          // <- string[]  (confirmed)
  core_tech_resolution_confidence?: 'high' | 'low' | 'none' | 'tech-only' | 'manual-override' | null;
  core_tech_resolved_at?: string | null;
}
```

Confirmation:
- `core_tech_framework_packs` is `string[] | null` (line 389). The Library TS interface should mirror this exact union.
- `description` and `tags` are TYPED non-optional (`string`) at the TS level even though the backend now allows NULL after Spec 1's correction. Other entity TS interfaces follow the same pattern (always required at TS level, defaulting to empty string in row constructors). Library TS should do the same: `description: string`, `tags: string` (not optional).

## 2. `ApplicationPoint` TS shape and the `target_type` union (the new LIBRARY value)

Location: `frontend/src/types/model.ts` lines 455-520.

```ts
export enum ApplicationPointTargetType {
  SERVICE = 'SERVICE',
  CLASS   = 'CLASS',
  METHOD  = 'METHOD',
}

export type ApplicationPointKind = 'APPLICATION' | 'APP_COMPONENT' | 'SERVICE' | 'CLASS' | 'METHOD';

export interface ApplicationPoint {
  // ...
  target_type?: ApplicationPointTargetType | string;  // structurally accepts any string
  target_ref_id?: string;
  // ...
}
```

Findings:
- The `ApplicationPointTargetType` enum currently has 3 values: `SERVICE`, `CLASS`, `METHOD`. Spec 2 needs to add `LIBRARY = 'LIBRARY'`.
- The `target_type?` field is typed `ApplicationPointTargetType | string` so structurally it ALREADY accepts arbitrary strings — backward compatibility is fine even without extending the enum, but enum extension is the idiomatic move (matches Spec 1 backend's CHECK extension).
- `ApplicationPointKind` (line 464) needs `'LIBRARY'` appended so the picker's `kindToGroup` can include it.

## 3. `ApplicationPointPickerCell` — the polymorphic dropdown

Location: `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` (622 lines).

Confirmed structure:
- `OptionGroup` type union (line 56): `'applications' | 'app_components' | 'services' | 'classes' | 'methods'`. Currently 5 groups.
- `kindToGroup` map (lines 230-237): `APPLICATION | APP_COMPONENT | SERVICE | CLASS | METHOD` -> matching OptionGroup.
- `allowedKinds?: string[]` prop (line 117): when set, the picker filters to only those kind values. This is the API the spec relies on.
- `buildGroupedOptions()` (lines 244-390): per-group blocks. SERVICE / CLASSES / METHODS groups already pull BOTH existing APs (`kind=SERVICE`/`CLASS`/`METHOD`) AND the raw entities (`Service[]` / `Class[]` / `Method[]`) from `metaModel.entities`. The raw entity gets `isRawEntity: true` flag and on selection runs through `ensureDerivedApplicationPoint` to find-or-create the derived AP.
- `targetTypeMap` (lines 489-495): maps OptionGroup -> DerivedTargetType for raw-entity selection. Currently has 5 entries (the first 2 are placeholders, only `services/classes/methods` map to real `DerivedTargetType` values).
- Group order constant (line 554): `['applications', 'app_components', 'services', 'classes', 'methods']`.
- `GROUP_LABELS` dict (lines 176-182): per-group display labels for dropdown headers.

What Spec 2 needs to extend in this file:
1. Add `'libraries'` to the `OptionGroup` union.
2. Add `LIBRARY: 'libraries'` to `kindToGroup`.
3. Add a 6th block to `buildGroupedOptions()` listing `entities.libraries` as raw-entity selections (no existing-AP path needed — derived only, mirroring SERVICE/CLASS/METHOD).
4. Add `libraries: 'LIBRARY'` to `targetTypeMap`.
5. Add `'libraries'` to `allGroups`.
6. Add `libraries: 'Libraries'` to `GROUP_LABELS`.
7. Add `getLibraryDisplayText(library)` helper paralleling `getServiceDisplayText`.
8. Bump search placeholder text? — minor UX touch.

The `allowedKinds` API works exactly as spec'd: `['LIBRARY']` for the target column (Library only) and `['SERVICE', 'LIBRARY']` for the source column.

## 4. `applicationPointDerivation.ts` — find-or-create derived AP

Location: `frontend/src/utils/applicationPointDerivation.ts` (429 lines).

Confirmed pattern:
- `DerivedTargetType` union (line 39): `'SERVICE' | 'CLASS' | 'METHOD'`. Spec 2 adds `'LIBRARY'`.
- `generateDerivedApplicationPointId(targetType, targetRefId)` (line 72) returns `ap_derived_<type-lowercase>_<id>`. Library will use `ap_derived_library_<id>` — collision-free.
- `generateDerivedApplicationPointName` (line 98): `<entityName> (<TitleCaseType>)`. Library entries will read `<libraryName> (Library)`.
- `createDerivedApplicationPointForService(service)` (line 192) is the closest blueprint. Note: it sets `application_id: service.application_id || ''`. Library has no `application_id` — so `createDerivedApplicationPointForLibrary` must set `application_id: ''` (empty string). The TS-required `application_id: string` on `ApplicationPoint` (line 482) mandates this default.
- `ensureDerivedApplicationPoint` (line 289) — the main entry point. Spec 2 adds a 4th `case 'LIBRARY'` arm.
- `getTargetEntityInfo` (line 360) — reverse lookup. Spec 2 adds a 4th `case 'LIBRARY'` arm.

## 5. `applicationPointDisplayFormatter` in `formatters.ts`

Location: `frontend/src/utils/formatters.ts` lines 91-172.

Confirmed:
- `formatApplicationPointDisplay(point, entities?)` already handles target_type-based resolution with a switch on `targetType` (lines 103-123). It has cases for `SERVICE`, `CLASS`, `METHOD`. Spec 2 adds a 4th `case 'LIBRARY'` looking up `entities.libraries` by `target_ref_id`.
- `APPLICATION_POINT_KIND_LABELS` (lines 59-65) maps each kind to a display label. Spec 2 adds `'LIBRARY': 'Library'`.
- `createApplicationPointDisplayFormatter` returns a generic `(id, entities) => string` — no Library-specific changes here, but it currently doesn't pass MetaModelEntities to `formatApplicationPointDisplay` for target-name resolution. That's a pre-existing limitation (see line 155: `return formatApplicationPointDisplay(point);` — no `entities` argument). The fallback path (kind label) will produce `<apName> (Library)` for LIBRARY-kinded APs once the kind label is added — which is acceptable for V1.

## 6. `tech_hints_cell` and `TechHintsCell` — Service-typed, NOT row-id-keyed-only

Location: `frontend/src/components/Grid/TechHintsCell.tsx` and `frontend/src/components/Grid/GridCell.tsx` lines 332-349.

CRITICAL FINDING (contradicts the raw idea's "just works for Library because it's row-id-keyed"):

```ts
// TechHintsCell.tsx
import type { Service } from '../../types/model';
export interface TechHintsCellProps {
  service: Service;                                  // <- typed Service
  onChange: (patch: Partial<Service>) => void;       // <- typed Partial<Service>
}
```

```ts
// GridCell.tsx case 'tech_hints_cell':
const serviceEntity = entity as unknown as Service;  // <- forced cast
return <TechHintsCell service={serviceEntity} ... />;
```

What's actually generic:
- `pendingResolutionsStore` keyed by `rowId` (yes, generic).
- The `resolveTechHints` gateway call uses `repo_location` and `repo_subfolder` from the row — both fields exist on Library, so the resolve call itself works.
- Patches that flow back (`core_tech_resolved`, `core_tech_language_pack`, `core_tech_framework_packs`, `core_tech_resolution_confidence`, `core_tech_resolved_at`) are name-equal on Library — applying them via `dispatch UPDATE_ENTITY` works.

What's NOT generic (will produce TS errors if Library gets `cellType: 'tech_hints_cell'` without changes):
- The TS prop type `service: Service` rejects a Library row (the structural shape matches almost exactly except Library lacks `application_id` and `service_type` and has different optional/required pattern, so structural assignability MAY work — needs TS check).
- The `Partial<Service>` patch type technically allows the 5 tech-hints fields, but if Spec 2 adds anything Library-specific that gets merged back, it would be rejected.

Required fix in Spec 2 (one of):
- (a) Generalise `TechHintsCellProps` to accept a structural subtype: `service: Pick<Service, 'id' | 'core_tech' | 'repo_location' | 'repo_subfolder' | 'core_tech_resolved' | 'core_tech_language_pack' | 'core_tech_framework_packs' | 'core_tech_resolution_confidence' | 'core_tech_resolved_at'>` — minimal blast radius. Rename the prop to `row` for clarity.
- (b) Define a shared `TechHintsRow` interface and type both `Service` and `Library` to satisfy it; have `TechHintsCellProps.service: TechHintsRow`.
- (c) Leave the TS as-is and rely on the structural cast in GridCell.tsx — works at runtime but pollutes type safety. Probably fine for V1 since GridCell already does `entity as unknown as Service`.

This is a **product call** the spec needs to lock — see Pass-B question.

## 7. `pendingResolutionsStore` and `SaveWithPendingResolves`

Location: `frontend/src/stores/pendingResolutionsStore.ts`, `frontend/src/components/TopBar/SaveWithPendingResolves.tsx`.

Confirmed: keyed by `rowId` (the entity's `id`). No type-level coupling to Service. Library rows participate without changes.

## 8. `gridConfigs.ts` structure and tab maps

Location: `frontend/src/config/gridConfigs.ts` (1332 lines).

Confirmed maps to extend (using IaC sources spec 7 as the closest precedent):

| Map | Action |
|---|---|
| `gridConfigs.libraries` | NEW — entity-shape grid with envelope + library-specific + tech-hints + provenance |
| `gridConfigs.code_unit_dependencies` | NEW — relationship-shape grid (no `name`/`valid_from`/`valid_to` on relationships) |
| `tabToEntityType['Libraries']` | `'libraries'` |
| `relationshipTabToType['Library Dependencies']` (or chosen display name) | `'code_unit_dependencies'` |
| `entityTabNames` | append `'Libraries'` |
| `relationshipTabNames` | append the chosen display name |
| `domainGroupings.application` | append `'Libraries'` (currently 8 entries; becomes 9). Position: after `'Services'` makes the most semantic sense (Library is parallel to Service). Confirm. |
| `DOMAIN_ENTITY_TYPES.application` | append `'libraries'` (currently 10 entries; becomes 11) |
| `RELATIONSHIP_TAB_ORDER` | append the chosen display name (currently 18 entries; becomes 19) |

`DOMAIN_TO_ENTITY_TYPES.application` (in `contextPickerDomainMappings.ts`) currently has 5 entries (`applications, app_components, services, interfaces, endpoints`). Append `'libraries'`.

`DOMAIN_TO_RELATIONSHIP_TYPES.application` currently has 5 entries. Append `'code_unit_dependencies'`.

## 9. `RELATIONSHIP_DEFINITIONS` — the new `code_unit_dependencies` entry

Location: `frontend/src/config/relationshipDefinitions.ts` lines 51-183.

Spec 7 IaC Resource Bindings precedent (lines 158-182): `iac_resource_bindings` lists `iac_sources` + the polymorphic anchor `infrastructure_points` + the 12 concrete Infra entity types. The comment explicitly states:

> "Endpoint types include `iac_sources` plus the 12 concrete Infra entity types as targets (so the relationship surfaces under the Infrastructure domain via getRelationshipsForDomain)."

Mapping this precedent to `code_unit_dependencies`:

The relationship's source is polymorphic (Service or Library) via `application_points`, and the target is Library (also via `application_points`). Both endpoints are POLYMORPHIC `application_points`. Concrete entity types involved: `services` and `libraries`. Following the spec-7 pattern:

```ts
{
  relationshipKey: 'code_unit_dependencies',
  displayName: 'Library Dependency',  // OR alternative — see Pass-B question
  endpointEntityTypes: [
    'application_points',  // polymorphic anchor (so Application-domain via application_points)
    'services',            // concrete source
    'libraries',           // concrete source AND target
  ],
}
```

This causes `getRelationshipsForDomain('application')` to return `code_unit_dependencies` (because `services` and `libraries` and `application_points` all map to `application`). No cross-domain spillage.

`ENTITY_TYPE_TO_DOMAIN.libraries = 'application'` is the additional one-line change.

## 10. `defaults.ts` `emptyModel` and `modelSerialization.ts` `normalizeModelFromApi`

Locations: `frontend/src/config/defaults.ts` line 1324+; `frontend/src/api/modelSerialization.ts` line 57+.

Confirmed:
- `emptyModel.metaModel.entities` += `libraries: []` and `code_unit_dependencies: []` (in the relationships block).
- `normalizeModelFromApi` += `cloned.metaModel.entities.libraries ??= []` and `cloned.metaModel.relationships.code_unit_dependencies ??= []` (mirroring the spec-7 backfill at lines 102 and 117).

## 11. Picklist conventions in `defaults.ts`

Pattern (lines 959+): `export const <name>Options = ['VAL_A', 'VAL_B', ...]`. Display via `formatOptionLabel: snakeCaseToTitleCase` at the column level.

Spec 2 adds:
- `ecosystemOptions = ['MAVEN', 'NPM', 'PYPI', 'NUGET', 'GO', 'OTHER']`
- `dependencyScopeOptions = ['COMPILE', 'RUNTIME', 'TEST', 'PROVIDED', 'OPTIONAL', 'DEV', 'PEER']`

`'OPTIONAL'` appears in both Maven (5-value) and npm (4-value) lists but is the same UPPERCASE token — no duplication. The spec-1 raw idea Q5 lists Maven as `COMPILE,RUNTIME,TEST,PROVIDED,OPTIONAL` and npm as `RUNTIME,DEV,PEER,OPTIONAL` — union is the 7 values above.

## 12. Pre-existing test failures and carry-forward

From project memory, several pre-existing test failures persist. New for Spec 2:

- **`relationshipDefinitions.test.ts:31`** asserts `expect(RELATIONSHIP_DEFINITIONS).toHaveLength(17)`. This was already wrong post-spec-7 (which made it 18, hence `infrastructureTerraformReadinessConfig.test.ts:133` asserts `toHaveLength(18)`). Spec 2 makes it 19 — the `:31` assertion needs bumping to 19 in this spec (existing pre-existing failure, but it MUST be fixed since the test is exactly about RELATIONSHIP_DEFINITIONS structure).
- The failing tests listed in project memory (bootstrap, conversation memory, dashboard summary, hub bootstrap, chatV2) are unrelated to library work — leave alone.

## 13. Carry-forward: `ApplicationPointKind` and `target_type` extension

Spec 2 will extend:
- `ApplicationPointKind` type (line 464) += `'LIBRARY'` -> `'APPLICATION' | 'APP_COMPONENT' | 'SERVICE' | 'CLASS' | 'METHOD' | 'LIBRARY'`.
- `ApplicationPointTargetType` enum (line 455) += `LIBRARY = 'LIBRARY'`.
- These are TS-level only; backend already accepts these values (Spec 1 changeset 124).

## 14. File-touch summary (frontend, projected)

New files:
- `frontend/src/config/__tests__/libraryConfigAndTypes.test.ts` (Vitest config test)

Modified files:
- `frontend/src/types/model.ts` (Library + CodeUnitDependency interfaces; MetaModel*; Entity/RelationshipType unions; ApplicationPointKind; ApplicationPointTargetType enum; AnyEntity / AnyRelationship)
- `frontend/src/config/defaults.ts` (emptyModel; 2 picklist arrays)
- `frontend/src/config/gridConfigs.ts` (2 gridConfigs entries; tab maps; domainGroupings.application; DOMAIN_ENTITY_TYPES.application)
- `frontend/src/config/relationshipDefinitions.ts` (RELATIONSHIP_DEFINITIONS += code_unit_dependencies; ENTITY_TYPE_TO_DOMAIN.libraries; RELATIONSHIP_TAB_ORDER += display name)
- `frontend/src/utils/contextPickerDomainMappings.ts` (DOMAIN_TO_ENTITY_TYPES.application += libraries; DOMAIN_TO_RELATIONSHIP_TYPES.application += code_unit_dependencies)
- `frontend/src/api/modelSerialization.ts` (2 ??= backfill lines)
- `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` (6th group + kindToGroup + targetTypeMap + GROUP_LABELS + allGroups + helper)
- `frontend/src/utils/applicationPointDerivation.ts` (DerivedTargetType += LIBRARY; createDerivedApplicationPointForLibrary; ensureDerivedApplicationPoint case; getTargetEntityInfo case)
- `frontend/src/utils/formatters.ts` (APPLICATION_POINT_KIND_LABELS += LIBRARY; formatApplicationPointDisplay case 'LIBRARY')
- `frontend/src/components/Grid/TechHintsCell.tsx` AND `frontend/src/components/Grid/GridCell.tsx` (relax Service typing — Pass B Q open)
- `frontend/src/__tests__/relationshipDefinitions.test.ts` (bump 17 -> 19; carry-forward fix)

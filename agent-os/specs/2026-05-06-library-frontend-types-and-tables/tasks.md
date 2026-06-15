# Task Breakdown: Library Frontend Types & Tables

## Overview
Total Tasks: 6 task groups covering 12 frontend file edits (11 modified + 1 created), all additive.

This spec is **frontend-only** (Spec 2 of 3 in the Library arc). It adds the TypeScript type system, default model state, two new gridConfigs (`libraries`, `code_unit_dependencies`), picker/derivation/formatter wiring for the new `LIBRARY` `ApplicationPoint` kind, and a structural typing relaxation on `TechHintsCell` so Library rows can reuse the existing `tech_hints_cell` resolver flow without TS errors. Spec 1 (backend) shipped — round-trips already work through `/api/model/projects/{p}/architectures/{a}`. Spec 3 (discovery integration) is out of scope.

**Locked contract reminders:**
- snake_case JSON for backend-derived fields (matches Spec 1 column names exactly).
- **NO new `cellType`** — reuse existing `application_point_picker`, `tech_hints_cell`, `package_set_dropdown`, `dropdown`, `text`, `tags`.
- **REUSE** spec-7 `sourceOriginOptions` and `generationStatusOptions` from `defaults.ts:1317-1318` — do NOT redeclare. Add a banner above the 2 new arrays.
- `TechHintsCell` typing relaxation is **Option (a) — minimal fix**: define a structural `TechHintsRow` interface (the 9 relevant fields), update `TechHintsCellProps.service` to use it, drop the `entity as unknown as Service` cast in `GridCell.tsx`. Both `Service` and `Library` then satisfy the prop type structurally.
- All **6 provenance columns visible** on the Libraries grid (Q5 override) — `source_origin`, `source_system`, `source_reference`, `generation_status`, `generation_notes`, `last_verified_at` — positioned at the end after `valid_to`.
- **Stale-count test bump explicit**: `frontend/src/__tests__/relationshipDefinitions.test.ts:31` `toHaveLength(17)` -> `toHaveLength(19)` (was already broken at 18 post-spec-7; spec 2 corrects to 19).
- **General DiagramType / Spec 5 wiring NOT modified** — Application diagrams keep working as free-form authoring.
- **No backend, gateway, MCP, or discovery-service changes**.

The spec touches these files:
- **Modified (11):**
  - `frontend/src/types/model.ts` — `Library` + `CodeUnitDependency` interfaces; `MetaModel*` containers; `EntityType` / `RelationshipType` unions; `AnyEntity` / `AnyRelationship` unions; `ApplicationPointTargetType` enum + `ApplicationPointKind` union extensions.
  - `frontend/src/config/relationshipDefinitions.ts` — `RELATIONSHIP_DEFINITIONS` += `code_unit_dependencies`; `ENTITY_TYPE_TO_DOMAIN.libraries = 'application'`; `RELATIONSHIP_TAB_ORDER` += `'Library Dependency'`.
  - `frontend/src/utils/contextPickerDomainMappings.ts` — `DOMAIN_TO_ENTITY_TYPES.application` += `'libraries'`; `DOMAIN_TO_RELATIONSHIP_TYPES.application` += `'code_unit_dependencies'`.
  - `frontend/src/config/defaults.ts` — `emptyModel` += `libraries: []` and `code_unit_dependencies: []`; 2 new picklist arrays (`ecosystemOptions`, `dependencyScopeOptions`); banner above 2 new arrays.
  - `frontend/src/api/modelSerialization.ts` — 2 new `??=` backfill lines in `normalizeModelFromApi`.
  - `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` — 6th `'libraries'` group.
  - `frontend/src/utils/applicationPointDerivation.ts` — `LIBRARY` arm + new `createDerivedApplicationPointForLibrary` helper.
  - `frontend/src/utils/formatters.ts` — `LIBRARY` label + 4th `case 'LIBRARY'` in display formatter.
  - `frontend/src/components/Grid/TechHintsCell.tsx` — define `TechHintsRow` structural interface; relax `TechHintsCellProps.service` typing.
  - `frontend/src/components/Grid/GridCell.tsx` — drop `entity as unknown as Service` cast.
  - `frontend/src/config/gridConfigs.ts` — 2 new gridConfig entries (`libraries`, `code_unit_dependencies`); tab map updates.
  - `frontend/src/__tests__/relationshipDefinitions.test.ts` — bump `toHaveLength(17)` to `toHaveLength(19)`.
- **Created (1):**
  - `frontend/src/config/__tests__/libraryConfigAndTypes.test.ts` — Vitest config test.

**Key sequencing pivot:** Group 1 lands the foundational TS types (interfaces, union extensions, enum extensions). Group 2 lands domain registration + serialization (depends on Group 1's `EntityType` / `RelationshipType` extensions). Group 3 lands the Application Point machinery (picker group, derivation helper, display formatter — depends on Group 1's `ApplicationPointKind` / `ApplicationPointTargetType` extensions). Group 4 relaxes `TechHintsCell` typing (Option a, isolated minimum-blast-radius change; depends on Group 1 only because Library must exist as a structural type). Group 5 lands the 2 new gridConfigs (depends on Groups 1-4). Group 6 adds the Vitest config test, bumps the stale-count assertion, and runs the verification sweep.

## Pre-Existing Failing Tests — Implementer Convention

Per project memory, the following Vitest/Jest suites have pre-existing failures unrelated to this spec:
- `bootstrap-summary-fetching.test.ts` (1 fail: URL assertion)
- `conversation-memory-edge-cases.test.ts`
- `dashboardSummary*.test.ts` (metric value assertions)
- `hub-bootstrap-4-task-definition.test.ts` (2 fails: availableFrom)
- `chatV2-panel-integration.test.ts` (3 fails: availableFrom)
- `chatV2-panel-context-and-filtering.test.ts` (1 fail: availableFrom)

This spec must **NOT** modify or attempt to fix any of these. The single test bump in this spec is the explicit `relationshipDefinitions.test.ts:31` carry-forward (17 -> 19).

Verification in Group 6 is: `npx tsc --noEmit` is clean (zero new errors), the new `libraryConfigAndTypes.test.ts` passes, the bumped `relationshipDefinitions.test.ts` passes, and the existing failing-test inventory has not grown.

## Task List

### Type System Foundation

#### Task Group 1: TS types + ApplicationPoint extension in `model.ts`
**Dependencies:** None

- [x] 1.0 Land all TS-level changes to `frontend/src/types/model.ts`: 2 new interfaces, 2 container extensions, 2 string union extensions, 2 discriminated union extensions, 1 enum extension, 1 kind union extension. Foundation for every other group.
  - [x] 1.1 Write 2 focused Vitest tests for the new types + enum extensions (deferred — these will be authored in Group 6.1 alongside the config wiring assertions, since the types are structural and exercised together with the gridConfigs / `emptyModel` defaults). Group 1 itself is type-only and verified via `npx tsc --noEmit`.
    - **Note:** No standalone test file is added here. The `ApplicationPointTargetType.LIBRARY === 'LIBRARY'` and `'LIBRARY'` is-a-valid-`ApplicationPointKind` assertions are part of the Group 6.1 Vitest config test (per spec.md Functional Requirement 19, line 70-71).
  - [x] 1.2 Add `Library` interface
    - **File:** `frontend/src/types/model.ts` (insert near the existing `Service` interface at lines 361-392)
    - **Template:** `Service` interface — mirror the field shape minus Service-specifics.
    - **Required (typed `string`, non-optional at TS level):** `id`, `description`, `tags`.
    - **Optional fields:** `name?`, `ecosystem?`, `repo_location?`, `repo_subfolder?`, `core_tech?`, `package_set_id?`, `valid_from?`, `valid_to?`.
    - **5 tech-hints columns (mirror `Service`):** `core_tech_resolved?: Record<string, unknown> | null`, `core_tech_language_pack?: string | null`, `core_tech_framework_packs?: string[] | null`, `core_tech_resolution_confidence?: 'high' | 'low' | 'none' | 'tech-only' | 'manual-override' | null`, `core_tech_resolved_at?: string | null`.
    - **6 provenance fields:** `source_origin?`, `source_system?`, `source_reference?`, `generation_status?`, `generation_notes?`, `last_verified_at?` (all `string` at TS level).
    - **Drop Service-specifics:** NO `application_id`, NO `service_type`, NO `app_component_id`, NO `is_internal`.
    - All snake_case. Matches Spec 1 backend column names verbatim.
  - [x] 1.3 Add `CodeUnitDependency` interface
    - **File:** `frontend/src/types/model.ts` (insert near other relationship interfaces)
    - **Required (string):** `id`, `source_application_point_id`, `target_application_point_id`.
    - **Optional:** `description?`, `tags?` (relationship convention: nullable per Spec 1), `declared_name?`, `declared_version?`, `declared_version_range?`, `scope?`, `manifest_path?`, `manifest_line?: number`, `evidence_source?`, `confidence?: number`.
    - **NO** `name`, `valid_from`, `valid_to` (relationship convention).
  - [x] 1.4 Extend `MetaModelEntities` and `MetaModelRelationships` containers
    - `MetaModelEntities` += `libraries: Library[]`.
    - `MetaModelRelationships` += `code_unit_dependencies: CodeUnitDependency[]`.
  - [x] 1.5 Extend `EntityType` and `RelationshipType` string unions
    - `EntityType` += `'libraries'`.
    - `RelationshipType` += `'code_unit_dependencies'`.
  - [x] 1.6 Extend `AnyEntity` and `AnyRelationship` discriminated unions
    - `AnyEntity` += `Library` (with `_entityType: 'libraries'` discriminator if the existing pattern requires it).
    - `AnyRelationship` += `CodeUnitDependency` (matching the existing relationship discriminator pattern).
  - [x] 1.7 Extend `ApplicationPointTargetType` enum
    - **Location:** `frontend/src/types/model.ts:455`
    - Append: `LIBRARY = 'LIBRARY'`. TS-level only — backend Spec 1 already accepts the value via CHECK constraint extension.
  - [x] 1.8 Extend `ApplicationPointKind` union
    - **Location:** `frontend/src/types/model.ts:464`
    - Append `'LIBRARY'`. Final union: `'APPLICATION' | 'APP_COMPONENT' | 'SERVICE' | 'CLASS' | 'METHOD' | 'LIBRARY'`.
  - [x] 1.9 Verify TS compiles (targeted)
    - From `frontend/`, run `npx tsc --noEmit`.
    - **Expected at this stage:** TS errors WILL appear at downstream sites that exhaustively switch on `EntityType` / `RelationshipType` / `ApplicationPointKind` / `ApplicationPointTargetType` (e.g. `gridConfigs`-related code, `applicationPointDerivation`, `formatters`, `ApplicationPointPickerCell`, `relationshipDefinitions`). These errors are EXPECTED and will be resolved by Groups 2-5. Confirm the errors are localised to those known sites (no unexpected explosion in unrelated modules).
    - Do NOT run the full Vitest suite at this stage.

**Acceptance Criteria:**
- `Library` interface exists in `frontend/src/types/model.ts` with snake_case fields matching Spec 1 backend; `id`/`description`/`tags` typed required; 5 tech-hints columns mirror `Service`; 6 provenance fields included; NO `application_id`/`service_type`/`app_component_id`/`is_internal`.
- `CodeUnitDependency` interface exists with `id`/`source_application_point_id`/`target_application_point_id` required; NO `name`/`valid_from`/`valid_to`.
- `MetaModelEntities.libraries: Library[]` and `MetaModelRelationships.code_unit_dependencies: CodeUnitDependency[]` extensions in place.
- `EntityType` includes `'libraries'`; `RelationshipType` includes `'code_unit_dependencies'`.
- `AnyEntity` includes `Library`; `AnyRelationship` includes `CodeUnitDependency`.
- `ApplicationPointTargetType.LIBRARY === 'LIBRARY'`; `ApplicationPointKind` includes `'LIBRARY'`.
- `npx tsc --noEmit` errors are LOCALISED to expected downstream sites (Groups 2-5); no unexpected breakage in unrelated modules.

---

### Domain Registration + Serialization

#### Task Group 2: Domain registration in `relationshipDefinitions.ts`, `contextPickerDomainMappings.ts`, `defaults.ts`, `modelSerialization.ts`
**Dependencies:** Task Group 1

- [x] 2.0 Wire the new entity/relationship into the domain registry, default model state, and load-side serialization backfill. After this group, `getRelationshipsForDomain('application')` will surface the new relationship and old saved JSON without `libraries` / `code_unit_dependencies` arrays will load cleanly.
  - [x] 2.1 (Tests deferred to Group 6.1) — domain registration assertions are part of the single Vitest config test in `libraryConfigAndTypes.test.ts`.
  - [x] 2.2 Wire `relationshipDefinitions.ts` — `ENTITY_TYPE_TO_DOMAIN`
    - **File:** `frontend/src/config/relationshipDefinitions.ts`
    - Add: `'libraries': 'application'`. Library is part of the Application domain (parallel to Service).
  - [x] 2.3 Wire `relationshipDefinitions.ts` — `RELATIONSHIP_DEFINITIONS` new entry
    - **File:** `frontend/src/config/relationshipDefinitions.ts`
    - **Template:** the spec-7 `iac_resource_bindings` entry at lines 158-182 (polymorphic anchor + concrete endpoint types).
    - Append new entry:
      ```ts
      {
        relationshipKey: 'code_unit_dependencies',
        displayName: 'Library Dependency',
        endpointEntityTypes: ['application_points', 'services', 'libraries'],
      }
      ```
    - The polymorphic `application_points` anchor + the concrete `services` and `libraries` endpoint types cause `getRelationshipsForDomain('application')` to surface this relationship. No cross-domain spillage.
  - [x] 2.4 Wire `relationshipDefinitions.ts` — `RELATIONSHIP_TAB_ORDER`
    - **File:** `frontend/src/config/relationshipDefinitions.ts`
    - Append `'Library Dependency'` at the end. Currently 18 post-spec-7 (the `:31` test asserting `17` is stale and will be bumped in Group 6.2). After this append: 19 entries.
  - [x] 2.5 Wire `contextPickerDomainMappings.ts`
    - **File:** `frontend/src/utils/contextPickerDomainMappings.ts`
    - `DOMAIN_TO_ENTITY_TYPES.application` += `'libraries'`.
    - `DOMAIN_TO_RELATIONSHIP_TYPES.application` += `'code_unit_dependencies'`.
  - [x] 2.6 Wire `defaults.ts` — `emptyModel`
    - **File:** `frontend/src/config/defaults.ts` (line 1324+ region)
    - `emptyModel.metaModel.entities.libraries = []`.
    - `emptyModel.metaModel.relationships.code_unit_dependencies = []`.
  - [x] 2.7 Add 2 new picklist arrays to `defaults.ts` (with reuse banner)
    - **File:** `frontend/src/config/defaults.ts` (append below the existing option-array block, alongside the spec-4 / spec-7 banners at lines 1247-1316)
    - **First:** add a new banner header above the new arrays, matching the spec-4/spec-7 banner convention:
      ```ts
      // ============================================================================
      // Spec 2026-05-06: Library Frontend Types & Tables - 2 new picklist arrays
      //
      // Reused arrays (do NOT redeclare):
      // - sourceOriginOptions (line 1317): libraries.source_origin
      // - generationStatusOptions (line 1318): libraries.generation_status
      // ============================================================================
      ```
    - **Then add the 2 new arrays:**
      ```ts
      export const ecosystemOptions: string[] = ['MAVEN', 'NPM', 'PYPI', 'NUGET', 'GO', 'OTHER'];
      export const dependencyScopeOptions: string[] = ['COMPILE', 'RUNTIME', 'TEST', 'PROVIDED', 'OPTIONAL', 'DEV', 'PEER'];
      ```
    - **REUSE — do NOT redeclare:** `sourceOriginOptions` (line 1317) and `generationStatusOptions` (line 1318). Both are already exported by spec 7. Spec 2 references them via the existing exports.
    - `'OPTIONAL'` is the shared Maven/npm token — no duplication.
  - [x] 2.8 Wire `modelSerialization.ts` — 2 `??=` backfill lines
    - **File:** `frontend/src/api/modelSerialization.ts` (mirror the spec-7 pattern at lines 102 and 117)
    - In `normalizeModelFromApi`, add:
      - `cloned.metaModel.entities.libraries ??= [];`
      - `cloned.metaModel.relationships.code_unit_dependencies ??= [];`
    - One-liner per array. Position adjacent to the existing spec-7 `??=` lines for consistency.
  - [x] 2.9 Verify TS compiles (targeted)
    - From `frontend/`, run `npx tsc --noEmit`.
    - **Expected at this stage:** the `EntityType` / `RelationshipType` exhaustive-switch errors from Group 1 should be GONE for `relationshipDefinitions`-related code; remaining errors limited to Groups 3-5 sites (`ApplicationPointPickerCell`, `applicationPointDerivation`, `formatters`, `gridConfigs`).

**Acceptance Criteria:**
- `ENTITY_TYPE_TO_DOMAIN.libraries === 'application'`.
- `RELATIONSHIP_DEFINITIONS` contains an entry with `relationshipKey: 'code_unit_dependencies'`, `displayName: 'Library Dependency'`, `endpointEntityTypes: ['application_points', 'services', 'libraries']`.
- `RELATIONSHIP_TAB_ORDER` has 19 entries ending with `'Library Dependency'`.
- `DOMAIN_TO_ENTITY_TYPES.application` includes `'libraries'`; `DOMAIN_TO_RELATIONSHIP_TYPES.application` includes `'code_unit_dependencies'`.
- `emptyModel.metaModel.entities.libraries === []` and `emptyModel.metaModel.relationships.code_unit_dependencies === []`.
- `ecosystemOptions` and `dependencyScopeOptions` exported from `defaults.ts` with the exact 6/7-element value lists in spec.md.
- Banner comment above the 2 new arrays documenting reuse of `sourceOriginOptions` + `generationStatusOptions` (no redeclaration).
- `normalizeModelFromApi` adds 2 `??=` backfill lines for `libraries` and `code_unit_dependencies`.
- `npx tsc --noEmit` shows the relationship-registration / serialization sites are clean; remaining errors localised to Groups 3-5 sites.

---

### Application Point Machinery

#### Task Group 3: `ApplicationPointPickerCell` 6th group + `applicationPointDerivation` LIBRARY arm + `formatters` LIBRARY case
**Dependencies:** Task Group 1

- [x] 3.0 Extend the polymorphic Application Point picker, the find-or-create derivation helper, and the display formatter to handle the new `LIBRARY` kind. After this group, selecting a Library row in the picker auto-creates a derived ApplicationPoint with `kind: 'LIBRARY'` and `target_type: 'LIBRARY'`, and the resulting AP renders correctly via the display formatter.
  - [x] 3.1 (Tests deferred to Group 6.1) — picker-extension wiring is covered by the structural assertions in `libraryConfigAndTypes.test.ts`. No standalone component-render test is added in this spec.
  - [x] 3.2 Extend `ApplicationPointPickerCell.tsx` — 6-step extension
    - **File:** `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` (~622 lines)
    - **Step 1 — `OptionGroup` union (line 56):** append `'libraries'`. Final: `'applications' | 'app_components' | 'services' | 'classes' | 'methods' | 'libraries'`.
    - **Step 2 — `kindToGroup` map (lines 230-237):** add `LIBRARY: 'libraries'`.
    - **Step 3 — `buildGroupedOptions()` (lines 244-390):** append a 6th block listing `entities.libraries` as raw-entity selections (derived-only — no existing-AP path because Library APs are always derived). Mirror the existing SERVICE/CLASS/METHOD raw-entity blocks (set `isRawEntity: true`).
    - **Step 4 — `targetTypeMap` (lines 489-495):** add `libraries: 'LIBRARY'`.
    - **Step 5 — `allGroups` constant (line 554):** append `'libraries'` last. Final order: `['applications', 'app_components', 'services', 'classes', 'methods', 'libraries']`.
    - **Step 6 — `GROUP_LABELS` dict (lines 176-182):** add `libraries: 'Libraries'`.
    - **Helper:** add `getLibraryDisplayText(library)` paralleling the existing `getServiceDisplayText` (used in the 6th block to render dropdown rows).
    - The existing `allowedKinds?: string[]` filter API (line 117) requires NO changes — it's wired via column config in Group 5 (`['LIBRARY']` for target column, `['SERVICE', 'LIBRARY']` for source column).
  - [x] 3.3 Extend `applicationPointDerivation.ts` — `LIBRARY` arm + new helper
    - **File:** `frontend/src/utils/applicationPointDerivation.ts` (~429 lines)
    - **`DerivedTargetType` union (line 39):** append `'LIBRARY'`. Final: `'SERVICE' | 'CLASS' | 'METHOD' | 'LIBRARY'`.
    - **New `createDerivedApplicationPointForLibrary(library)` function:** model directly on `createDerivedApplicationPointForService` (line 192).
      - Set `kind: 'LIBRARY'`.
      - Set `target_type: 'LIBRARY'`.
      - Set `target_ref_id: library.id`.
      - Set `application_id: ''` (Library has no `application_id`; empty string satisfies the TS-required `ApplicationPoint.application_id: string`).
      - Derived AP id pattern: `ap_derived_library_<id>` (via `generateDerivedApplicationPointId('LIBRARY', library.id)`).
      - Derived AP name pattern: `<libraryName> (Library)` (via `generateDerivedApplicationPointName`).
    - **`ensureDerivedApplicationPoint` (line 289):** append a 4th `case 'LIBRARY'` arm routing to the new helper.
    - **`getTargetEntityInfo` (line 360):** append a 4th `case 'LIBRARY'` arm with reverse-lookup of `entities.libraries` by id.
  - [x] 3.4 Extend `formatters.ts` — `LIBRARY` label + display formatter case
    - **File:** `frontend/src/utils/formatters.ts` (lines 91-172)
    - **`APPLICATION_POINT_KIND_LABELS` (lines 59-65):** add `'LIBRARY': 'Library'`.
    - **`formatApplicationPointDisplay` switch (lines 103-123):** append a 4th `case 'LIBRARY'` resolving `entities.libraries.find(l => l.id === target_ref_id)` and returning `${library.name} (Library)`. Fallback to AP own name on missing target, matching the existing SERVICE/CLASS/METHOD pattern.
  - [x] 3.5 Verify TS compiles (targeted)
    - From `frontend/`, run `npx tsc --noEmit`.
    - **Expected at this stage:** picker / derivation / formatter sites should be clean; the only remaining errors localised to Group 4 (`TechHintsCell` typing) and Group 5 (`gridConfigs` referencing the new entries).

**Acceptance Criteria:**
- `ApplicationPointPickerCell.tsx` `OptionGroup` union, `kindToGroup`, `buildGroupedOptions()` (6 blocks), `targetTypeMap`, `allGroups`, `GROUP_LABELS` all extended with `'libraries'` / `LIBRARY`. New `getLibraryDisplayText` helper present.
- `applicationPointDerivation.ts` `DerivedTargetType` includes `'LIBRARY'`; new `createDerivedApplicationPointForLibrary` helper present (sets `application_id: ''`); `ensureDerivedApplicationPoint` and `getTargetEntityInfo` switches each have a 4th `case 'LIBRARY'` arm.
- `APPLICATION_POINT_KIND_LABELS.LIBRARY === 'Library'`; `formatApplicationPointDisplay` switch includes a `case 'LIBRARY'` arm looking up `entities.libraries`.
- `npx tsc --noEmit` shows all picker / derivation / formatter sites clean; remaining errors localised to Groups 4-5.

---

### TechHintsCell Typing Relaxation

#### Task Group 4: `TechHintsCell` Option (a) minimal fix + `GridCell` cast removal
**Dependencies:** Task Group 1

- [x] 4.0 Apply Q4's locked decision (Option a — minimal fix): define a structural `TechHintsRow` interface in `TechHintsCell.tsx` covering the 9 relevant fields, change `TechHintsCellProps.service` to use it, and drop the `entity as unknown as Service` cast in `GridCell.tsx`. Both `Service` and `Library` then satisfy the prop type structurally — Library inherits the LLM resolver flow with no further changes.
  - [x] 4.1 (Tests deferred to Group 6.1) — `TechHintsCell` typing change is structural and verified via `npx tsc --noEmit`. No standalone component-render test added.
  - [x] 4.2 Define `TechHintsRow` structural interface in `TechHintsCell.tsx`
    - **File:** `frontend/src/components/Grid/TechHintsCell.tsx`
    - Define an exported structural interface covering the 9 fields the cell touches:
      ```ts
      export interface TechHintsRow {
        id: string;
        core_tech?: string;
        repo_location?: string;
        repo_subfolder?: string;
        core_tech_resolved?: Record<string, unknown> | null;
        core_tech_language_pack?: string | null;
        core_tech_framework_packs?: string[] | null;
        core_tech_resolution_confidence?: 'high' | 'low' | 'none' | 'tech-only' | 'manual-override' | null;
        core_tech_resolved_at?: string | null;
      }
      ```
    - This is equivalent to `Pick<Service, ...>` of the 9 relevant fields; `Service` and `Library` both satisfy it structurally (both have all 9 fields with compatible types).
  - [x] 4.3 Update `TechHintsCellProps` to use `TechHintsRow`
    - **File:** `frontend/src/components/Grid/TechHintsCell.tsx`
    - Change `TechHintsCellProps.service: Service` to `TechHintsCellProps.service: TechHintsRow` (keep the prop name `service` for minimum blast radius — no call-site rename required).
    - Update the `onChange: (patch: Partial<Service>) => void` typing to `onChange: (patch: Partial<TechHintsRow>) => void` so the patch shape stays narrow (the 5 tech-hints fields are all in `TechHintsRow`).
    - **Do NOT** remove the existing `import type { Service }` if still used elsewhere in the file; only adjust the prop typings.
  - [x] 4.4 Drop `entity as unknown as Service` cast in `GridCell.tsx`
    - **File:** `frontend/src/components/Grid/GridCell.tsx` (line 332 — `case 'tech_hints_cell'` arm)
    - Remove the `as unknown as Service` cast. Pass `entity` directly typed as `TechHintsRow` (via structural compatibility — both `Service` and `Library` satisfy it, no explicit cast needed).
    - If the surrounding code reads `serviceEntity.<field>` referencing 9-relevant fields, that still works against `TechHintsRow`. If it reads any non-9 field (e.g. `service_type`), revisit Option (a) — but the spec's Q4 verification confirmed no such read exists at line 332.
  - [x] 4.5 Verify TS compiles (targeted)
    - From `frontend/`, run `npx tsc --noEmit`.
    - **Expected at this stage:** `TechHintsCell` and `GridCell.tsx` are clean. The remaining errors should be localised to Group 5 (`gridConfigs` entries referencing the new `gridConfigs.libraries` / `gridConfigs.code_unit_dependencies` keys and the tab maps).
    - Sanity-check: confirm `pendingResolutionsStore` and `SaveWithPendingResolves` are unchanged (per spec — they are already row-id-keyed and type-agnostic).

**Acceptance Criteria:**
- `TechHintsRow` structural interface exists in `frontend/src/components/Grid/TechHintsCell.tsx` covering the 9 relevant fields.
- `TechHintsCellProps.service: TechHintsRow` (or equivalent renamed prop) — both `Service` and `Library` satisfy it structurally.
- `entity as unknown as Service` cast at `frontend/src/components/Grid/GridCell.tsx:332` is removed.
- No changes to `pendingResolutionsStore.ts` or `SaveWithPendingResolves.tsx` (they are type-agnostic and row-id-keyed already).
- `npx tsc --noEmit` shows `TechHintsCell` / `GridCell.tsx` sites clean; remaining errors localised to Group 5.

---

### GridConfigs Wiring

#### Task Group 5: 2 new gridConfigs entries + tab/domain map updates
**Dependencies:** Task Groups 1, 2, 3, 4

- [x] 5.0 Add the 2 new `gridConfigs` entries (`libraries` 16 columns, `code_unit_dependencies` 12 columns) plus all tab map updates: `tabToEntityType['Libraries']`, `entityTabNames` += `'Libraries'`, `relationshipTabToType['Library Dependency']`, `relationshipTabNames` += `'Library Dependency'`, `domainGroupings.application` += `'Libraries'` after `'Services'`, `DOMAIN_ENTITY_TYPES.application` += `'libraries'`.
  - [x] 5.1 (Tests deferred to Group 6.1) — gridConfigs / tab wiring is the primary subject of the single Vitest config test.
  - [x] 5.2 Add `gridConfigs.libraries`
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Columns in order (16 total):
      1. `id` (`text`, autogen, 120)
      2. `name` (`text`, **required: true**, 200)
      3. `ecosystem` (`dropdown`, options: `ecosystemOptions`, `formatOptionLabel: snakeCaseToTitleCase`, 140)
      4. `repo_location` (`text`, 220)
      5. `repo_subfolder` (`text`, 200)
      6. `core_tech` (`tech_hints_cell`, 220) — uses the relaxed `TechHintsRow` typing from Group 4.
      7. `package_set_id` (`package_set_dropdown`, 200) — reused cellType, no changes needed.
      8. `description` (`text`, **required: true**, 250)
      9. `tags` (`tags`, 200)
      10. `valid_from` (`text`, 100)
      11. `valid_to` (`text`, 100)
      12. `source_origin` (`dropdown`, options: `sourceOriginOptions`, `formatOptionLabel: snakeCaseToTitleCase`, 160) — REUSED from spec 7.
      13. `source_system` (`text`, 160)
      14. `source_reference` (`text`, 200)
      15. `generation_status` (`dropdown`, options: `generationStatusOptions`, `formatOptionLabel: snakeCaseToTitleCase`, 160) — REUSED from spec 7.
      16. `generation_notes` (`text`, 250)
      17. `last_verified_at` (`text`, 140) — ISO-8601 string; matches `valid_from`/`valid_to` precedent.
    - **NOT exposed as separate columns:** the 5 backing tech-hints fields (`core_tech_resolved`, `core_tech_language_pack`, `core_tech_framework_packs`, `core_tech_resolution_confidence`, `core_tech_resolved_at`). They round-trip via the resolver flow only — same pattern as `Service`.
    - 6 provenance columns positioned at the END after `valid_to` (Q5 override).
  - [x] 5.3 Add `gridConfigs.code_unit_dependencies`
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Columns in order (12 total):
      1. `id` (`text`, autogen, 100)
      2. `source_application_point_id` (`application_point_picker`, **required: true**, `allowedKinds: ['SERVICE', 'LIBRARY']`, `displayFormatter: applicationPointDisplayFormatter`, 280)
      3. `target_application_point_id` (`application_point_picker`, **required: true**, `allowedKinds: ['LIBRARY']`, `displayFormatter: applicationPointDisplayFormatter`, 280)
      4. `declared_name` (`text`, 220)
      5. `declared_version` (`text`, 140)
      6. `declared_version_range` (`text`, 180)
      7. `scope` (`dropdown`, options: `dependencyScopeOptions`, `formatOptionLabel: snakeCaseToTitleCase`, 140)
      8. `manifest_path` (`text`, 240)
      9. `manifest_line` (`text`, 100) — no `'number'` cellType; matches `endpoints.port` precedent.
      10. `evidence_source` (`text`, 180)
      11. `confidence` (`text`, 100) — no `'number'` cellType.
      12. `description` (`text`, 250)
      13. `tags` (`tags`, 200)
    - **NO** `name`, `valid_from`, `valid_to` (relationship convention).
  - [x] 5.4 Wire entity tab maps
    - `tabToEntityType['Libraries'] = 'libraries'`.
    - `entityTabNames` += `'Libraries'`.
  - [x] 5.5 Wire relationship tab maps
    - `relationshipTabToType['Library Dependency'] = 'code_unit_dependencies'`.
    - `relationshipTabNames` += `'Library Dependency'`.
  - [x] 5.6 Update domain groupings
    - `domainGroupings.application` += `'Libraries'` directly after `'Services'` (Q3 — Library is parallel to Service; matches Spec 1 backend `ArchitectureCloneService` ordering).
  - [x] 5.7 Update `DOMAIN_ENTITY_TYPES.application`
    - `DOMAIN_ENTITY_TYPES.application` += `'libraries'`. Currently 10 entries; becomes 11.
  - [x] 5.8 Verify TS compiles (full)
    - From `frontend/`, run `npx tsc --noEmit`.
    - **Expected at this stage:** zero new errors across the entire frontend. All Groups 1-5 sites should be clean.

**Acceptance Criteria:**
- `gridConfigs.libraries` exists with 16 columns in the order spec.md specifies; `name` and `description` are `required: true`; the 6 provenance columns are positioned at the end; the 5 backing tech-hints fields are NOT exposed as separate columns.
- `gridConfigs.code_unit_dependencies` exists with 12 columns; both `source_application_point_id` and `target_application_point_id` are `cellType: 'application_point_picker'` with `required: true` and the documented `allowedKinds` arrays; both pass `applicationPointDisplayFormatter`; NO `name`/`valid_from`/`valid_to` columns.
- `tabToEntityType['Libraries'] === 'libraries'`; `entityTabNames` contains `'Libraries'`.
- `relationshipTabToType['Library Dependency'] === 'code_unit_dependencies'`; `relationshipTabNames` contains `'Library Dependency'`.
- `domainGroupings.application` contains `'Libraries'` directly after `'Services'`.
- `DOMAIN_ENTITY_TYPES.application` contains `'libraries'`.
- `manifest_line` and `confidence` use `cellType: 'text'` (no `'number'` cellType in codebase).
- All dropdown columns set `formatOptionLabel: snakeCaseToTitleCase`.
- `npx tsc --noEmit` is clean across the entire frontend with zero new errors.

---

### Verification Layer

#### Task Group 6: Vitest config test + carry-forward fix + final TS + Vitest sweep
**Dependencies:** Task Groups 1-5

- [x] 6.0 Add the single Vitest config test asserting the wiring; bump the stale-count assertion in `relationshipDefinitions.test.ts:31` (17 -> 19); run the final `npx tsc --noEmit`; run the Vitest sweep to confirm zero new failures beyond the documented pre-existing inventory.
  - [x] 6.1 Write the Vitest config test (max 8 focused tests)
    - **File:** `frontend/src/config/__tests__/libraryConfigAndTypes.test.ts` (NEW)
    - **Template:** `frontend/src/config/__tests__/userJourneyLinksConfig.test.ts` and the recently-landed `frontend/src/config/__tests__/infrastructureTablesConfig.test.ts` — Vitest convention, `describe` block per concern, `expect(gridConfigs).toHaveProperty(...)`, etc.
    - Limit to 8 focused tests covering only the critical wiring contracts. Suggested split:
      1. **Test 1 — `gridConfigs.libraries` exists with required-field columns:** assert `gridConfigs.libraries` exists; assert `name` column has `required: true`; assert `description` column has `required: true`; assert all 16 columns are present in expected order (or at minimum present by `field` key).
      2. **Test 2 — `gridConfigs.code_unit_dependencies` exists with picker columns:** assert `gridConfigs.code_unit_dependencies` exists; assert `source_application_point_id` is `cellType: 'application_point_picker'` with `allowedKinds: ['SERVICE', 'LIBRARY']` and `required: true`; assert `target_application_point_id` is `cellType: 'application_point_picker'` with `allowedKinds: ['LIBRARY']` and `required: true`; assert no `name`/`valid_from`/`valid_to` columns.
      3. **Test 3 — Tab maps:** assert `tabToEntityType['Libraries'] === 'libraries'`; `entityTabNames` includes `'Libraries'`; `relationshipTabToType['Library Dependency'] === 'code_unit_dependencies'`; `relationshipTabNames` includes `'Library Dependency'`; `RELATIONSHIP_TAB_ORDER` ends with `'Library Dependency'` and has length 19.
      4. **Test 4 — `RELATIONSHIP_DEFINITIONS` entry:** assert `RELATIONSHIP_DEFINITIONS` contains an entry with `relationshipKey: 'code_unit_dependencies'`, `displayName: 'Library Dependency'`, `endpointEntityTypes: ['application_points', 'services', 'libraries']`.
      5. **Test 5 — Domain registration:** assert `ENTITY_TYPE_TO_DOMAIN.libraries === 'application'`; `DOMAIN_TO_ENTITY_TYPES.application` includes `'libraries'`; `DOMAIN_TO_RELATIONSHIP_TYPES.application` includes `'code_unit_dependencies'`; `domainGroupings.application` includes `'Libraries'`; `DOMAIN_ENTITY_TYPES.application` includes `'libraries'`.
      6. **Test 6 — Picklists:** assert `ecosystemOptions` exists with exact value `['MAVEN', 'NPM', 'PYPI', 'NUGET', 'GO', 'OTHER']`; assert `dependencyScopeOptions` exists with exact value `['COMPILE', 'RUNTIME', 'TEST', 'PROVIDED', 'OPTIONAL', 'DEV', 'PEER']`; assert `sourceOriginOptions` and `generationStatusOptions` are unchanged (sanity check that spec 2 did not redeclare them — exact-array equality assertion).
      7. **Test 7 — `ApplicationPointTargetType` enum + `ApplicationPointKind` extension:** assert `ApplicationPointTargetType.LIBRARY === 'LIBRARY'`; assert `'LIBRARY'` is assignable to `ApplicationPointKind` (compile-time check via `const k: ApplicationPointKind = 'LIBRARY'`).
      8. **Test 8 — `emptyModel` defaults:** assert `emptyModel.metaModel.entities.libraries` is an empty array; assert `emptyModel.metaModel.relationships.code_unit_dependencies` is an empty array.
    - **Imports:** `gridConfigs`, `tabToEntityType`, `entityTabNames`, `relationshipTabToType`, `relationshipTabNames`, `domainGroupings`, `DOMAIN_ENTITY_TYPES` from `../gridConfigs`; `RELATIONSHIP_DEFINITIONS`, `RELATIONSHIP_TAB_ORDER`, `ENTITY_TYPE_TO_DOMAIN` from `../relationshipDefinitions`; `DOMAIN_TO_ENTITY_TYPES`, `DOMAIN_TO_RELATIONSHIP_TYPES` from `../../utils/contextPickerDomainMappings`; `ecosystemOptions`, `dependencyScopeOptions`, `sourceOriginOptions`, `generationStatusOptions`, `emptyModel` from `../defaults`; `ApplicationPointTargetType` and `ApplicationPointKind` from `../../types/model`.
    - **Out of scope for tests:** no rendering tests for `ApplicationPointPickerCell` / `TechHintsCell`, no save-pipeline tests, no derivation-helper tests, no formatter tests, no exhaustive per-column shape tests beyond what the 8 tests above cover.
  - [x] 6.2 Bump stale-count assertion in `relationshipDefinitions.test.ts:31`
    - **File:** `frontend/src/__tests__/relationshipDefinitions.test.ts` (line 31)
    - Change `expect(RELATIONSHIP_DEFINITIONS).toHaveLength(17)` to `expect(RELATIONSHIP_DEFINITIONS).toHaveLength(19)`.
    - **Rationale:** was already broken at 18 post-spec-7; spec 2 corrects to 19. This is the ONLY test bump in this spec — no other pre-existing failing tests are touched.
  - [x] 6.3 Run the new Vitest config test and confirm it passes
    - From `frontend/`, run only the new test file: `npx vitest run src/config/__tests__/libraryConfigAndTypes.test.ts`.
    - **Expected:** all tests in the new file pass (max 8 tests).
    - Do NOT run the full Vitest suite at this stage.
  - [x] 6.4 Run the bumped `relationshipDefinitions.test.ts` and confirm it passes
    - From `frontend/`, run: `npx vitest run src/__tests__/relationshipDefinitions.test.ts`.
    - **Expected:** the bumped assertion at line 31 now passes (19 entries match `RELATIONSHIP_TAB_ORDER` post-spec-2).
  - [x] 6.5 Run `npx tsc --noEmit` for the full frontend
    - From `frontend/`, run `npx tsc --noEmit`.
    - **Expected:** zero new errors. Any remaining errors must already exist on `master` and not have been introduced by this spec.
  - [x] 6.6 Run the full Vitest sweep and confirm zero new failures
    - From `frontend/`, run `npx vitest run`.
    - **Expected outcome:** the only failures are the pre-existing failing tests already documented in project memory:
      - `bootstrap-summary-fetching.test.ts` (1 fail)
      - `conversation-memory-edge-cases.test.ts`
      - `dashboardSummary*.test.ts`
      - `hub-bootstrap-4-task-definition.test.ts` (2 fails)
      - `chatV2-panel-integration.test.ts` (3 fails)
      - `chatV2-panel-context-and-filtering.test.ts` (1 fail)
    - **Newly passing:** `libraryConfigAndTypes.test.ts` (max 8 tests); `relationshipDefinitions.test.ts:31` now correctly asserts 19.
    - **No** new failures introduced; **no** previously-passing tests now failing.
    - **DO NOT** modify or attempt to fix any pre-existing failing test other than the explicit `relationshipDefinitions.test.ts:31` stale-count bump.
    - **Note:** any existing relationship-definition / domain-filtering tests that iterate `RELATIONSHIP_DEFINITIONS` / `RELATIONSHIP_TAB_ORDER` will pick up the new entry naturally and should pass without further edits.
  - [x] 6.7 Confirm scope discipline
    - **Verification only.** Confirm edits only touched the 12 files in scope:
      1. `frontend/src/types/model.ts` (modified — Group 1)
      2. `frontend/src/config/relationshipDefinitions.ts` (modified — Group 2)
      3. `frontend/src/utils/contextPickerDomainMappings.ts` (modified — Group 2)
      4. `frontend/src/config/defaults.ts` (modified — Group 2)
      5. `frontend/src/api/modelSerialization.ts` (modified — Group 2)
      6. `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` (modified — Group 3)
      7. `frontend/src/utils/applicationPointDerivation.ts` (modified — Group 3)
      8. `frontend/src/utils/formatters.ts` (modified — Group 3)
      9. `frontend/src/components/Grid/TechHintsCell.tsx` (modified — Group 4)
      10. `frontend/src/components/Grid/GridCell.tsx` (modified — Group 4)
      11. `frontend/src/config/gridConfigs.ts` (modified — Group 5)
      12. `frontend/src/__tests__/relationshipDefinitions.test.ts` (modified — Group 6.2: stale-count bump)
      13. `frontend/src/config/__tests__/libraryConfigAndTypes.test.ts` (created — Group 6.1)
    - Confirm no edits to `MetaModelView.tsx`, `paletteData.ts`, `architectureDomain.ts`, `useCurrentView.ts`, `pendingResolutionsStore.ts`, `SaveWithPendingResolves.tsx`, or any backend / gateway / MCP / discovery-service code.
    - Confirm General DiagramType / Spec 5 wiring is untouched.
    - Confirm the existing pre-existing failing tests remain unchanged.

**Acceptance Criteria:**
- `frontend/src/config/__tests__/libraryConfigAndTypes.test.ts` exists with no more than 8 focused tests covering: (1) `gridConfigs.libraries` required fields, (2) `gridConfigs.code_unit_dependencies` picker columns + allowedKinds, (3) tab maps + `RELATIONSHIP_TAB_ORDER` length 19, (4) `RELATIONSHIP_DEFINITIONS` `code_unit_dependencies` entry shape, (5) domain registration (`ENTITY_TYPE_TO_DOMAIN`, `DOMAIN_TO_*_TYPES`, `domainGroupings`, `DOMAIN_ENTITY_TYPES`), (6) picklists (new + reused), (7) `ApplicationPointTargetType.LIBRARY` enum + `ApplicationPointKind` extension, (8) `emptyModel` defaults.
- All new tests pass.
- `frontend/src/__tests__/relationshipDefinitions.test.ts:31` bumped from `toHaveLength(17)` to `toHaveLength(19)` and now passes.
- `npx tsc --noEmit` is clean (zero new errors).
- Vitest sweep shows: newly-passing tests (the new file + the bumped assertion) + identical pre-existing failure inventory + zero regressions.
- Exactly 13 frontend files touched (12 modified + 1 created).
- No edits to `MetaModelView.tsx`, `paletteData.ts`, or any backend / gateway / MCP / discovery-service code; General DiagramType / Spec 5 wiring untouched.

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type System Foundation** — `model.ts` (Library + CodeUnitDependency interfaces; MetaModel containers; EntityType / RelationshipType / AnyEntity / AnyRelationship unions; ApplicationPointTargetType enum; ApplicationPointKind union). Foundation for every other group.
2. **Task Group 2: Domain Registration + Serialization** — `relationshipDefinitions.ts`, `contextPickerDomainMappings.ts`, `defaults.ts` (emptyModel + 2 new picklists with banner), `modelSerialization.ts` (2 backfill lines). Depends on Group 1's `EntityType` / `RelationshipType` extensions.
3. **Task Group 3: Application Point Machinery** — `ApplicationPointPickerCell.tsx` (6th group), `applicationPointDerivation.ts` (LIBRARY arm + new helper), `formatters.ts` (LIBRARY label + display formatter case). Depends on Group 1's `ApplicationPointKind` / `ApplicationPointTargetType` extensions. Independent of Group 2.
4. **Task Group 4: TechHintsCell Typing Relaxation** — `TechHintsCell.tsx` (TechHintsRow interface), `GridCell.tsx` (drop cast). Option (a) minimal fix. Depends on Group 1 only because Library must exist as a structural type. Independent of Groups 2 and 3.
5. **Task Group 5: GridConfigs Wiring** — `gridConfigs.ts` (2 new entries + tab maps + domain groupings + DOMAIN_ENTITY_TYPES). Depends on Groups 1 (types), 2 (picklists + domain registration), 3 (display formatter for `code_unit_dependencies`), and 4 (`tech_hints_cell` typing relaxation for `libraries.core_tech`).
6. **Task Group 6: Verification** — Vitest config test (max 8 tests), stale-count assertion bump (17 -> 19), final `tsc --noEmit`, full Vitest sweep, scope discipline check.

Groups 2, 3, and 4 are independent and could run in parallel after Group 1. Group 5 depends on Groups 1-4. Group 6 must run last.

---

## File Summary

### Files to Modify (12)
1. `frontend/src/types/model.ts` — Library + CodeUnitDependency interfaces; MetaModel container extensions; EntityType / RelationshipType / AnyEntity / AnyRelationship union extensions; ApplicationPointTargetType enum extension (LIBRARY); ApplicationPointKind union extension ('LIBRARY').
2. `frontend/src/config/relationshipDefinitions.ts` — RELATIONSHIP_DEFINITIONS += code_unit_dependencies; ENTITY_TYPE_TO_DOMAIN.libraries = 'application'; RELATIONSHIP_TAB_ORDER += 'Library Dependency'.
3. `frontend/src/utils/contextPickerDomainMappings.ts` — DOMAIN_TO_ENTITY_TYPES.application += 'libraries'; DOMAIN_TO_RELATIONSHIP_TYPES.application += 'code_unit_dependencies'.
4. `frontend/src/config/defaults.ts` — emptyModel.metaModel.entities.libraries = []; emptyModel.metaModel.relationships.code_unit_dependencies = []; 2 new picklist arrays (ecosystemOptions, dependencyScopeOptions); reuse banner above the 2 new arrays.
5. `frontend/src/api/modelSerialization.ts` — 2 new `??=` backfill lines in normalizeModelFromApi (libraries; code_unit_dependencies).
6. `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` — 6-step extension (OptionGroup union, kindToGroup, buildGroupedOptions 6th block, targetTypeMap, allGroups, GROUP_LABELS); new getLibraryDisplayText helper.
7. `frontend/src/utils/applicationPointDerivation.ts` — DerivedTargetType += 'LIBRARY'; new createDerivedApplicationPointForLibrary helper (sets application_id: ''); ensureDerivedApplicationPoint case 'LIBRARY'; getTargetEntityInfo case 'LIBRARY'.
8. `frontend/src/utils/formatters.ts` — APPLICATION_POINT_KIND_LABELS.LIBRARY = 'Library'; formatApplicationPointDisplay case 'LIBRARY'.
9. `frontend/src/components/Grid/TechHintsCell.tsx` — define TechHintsRow structural interface (9 fields); change TechHintsCellProps.service typing from Service to TechHintsRow.
10. `frontend/src/components/Grid/GridCell.tsx` — drop `entity as unknown as Service` cast on line 332.
11. `frontend/src/config/gridConfigs.ts` — 2 new gridConfigs entries (libraries 16 cols; code_unit_dependencies 12 cols); tabToEntityType['Libraries']; entityTabNames += 'Libraries'; relationshipTabToType['Library Dependency']; relationshipTabNames += 'Library Dependency'; domainGroupings.application += 'Libraries' after 'Services'; DOMAIN_ENTITY_TYPES.application += 'libraries'.
12. `frontend/src/__tests__/relationshipDefinitions.test.ts` — line 31 bump from `toHaveLength(17)` to `toHaveLength(19)` (carry-forward stale-count fix).

### Files to Create (1)
13. `frontend/src/config/__tests__/libraryConfigAndTypes.test.ts` — Vitest config test (max 8 focused tests) modelled on `userJourneyLinksConfig.test.ts` and `infrastructureTablesConfig.test.ts`.

### Files NOT to Touch
- `frontend/src/components/MetaModelView/MetaModelView.tsx` — already domain-agnostic.
- `frontend/src/utils/paletteData.ts` — out of scope (no diagram support for Library / CodeUnitDependency).
- `frontend/src/types/architectureDomain.ts` — already includes `'application'` domain.
- `frontend/src/hooks/useCurrentView.ts` — domain-agnostic.
- `frontend/src/stores/pendingResolutionsStore.ts` — already row-id-keyed and type-agnostic.
- `frontend/src/components/TopBar/SaveWithPendingResolves.tsx` — already row-id-keyed and type-agnostic.
- General DiagramType / Spec 5 wiring — out of scope.
- Backend (`architecture-model-service/`), gateway (`gateway/`), MCP, discovery-service — out of scope.
- Any pre-existing failing test other than the explicit `relationshipDefinitions.test.ts:31` stale-count bump.

---

## Reference Patterns

### Existing Code to Follow

- **`Service` TS interface** (`frontend/src/types/model.ts:361-392`)
  - Primary template for `Library`. Same snake_case shape; same 5 tech-hints columns. Library drops Service-specifics (`application_id`, `service_type`, `app_component_id`, `is_internal`) and adds `ecosystem` plus 6 provenance fields. `description: string` / `tags: string` typed non-optional at TS level — Library matches.

- **`ApplicationPointPickerCell.tsx`** (`frontend/src/components/Grid/ApplicationPointPickerCell.tsx`, ~622 lines)
  - 6-step extension pattern: `OptionGroup` union (line 56), `kindToGroup` (lines 230-237), `buildGroupedOptions()` per-group block (lines 244-390), `targetTypeMap` (lines 489-495), `allGroups` (line 554), `GROUP_LABELS` (lines 176-182). The existing `allowedKinds?: string[]` filter API requires no changes; spec 2 wires it via column config in `gridConfigs.code_unit_dependencies`.

- **`applicationPointDerivation.ts`** (`frontend/src/utils/applicationPointDerivation.ts`, ~429 lines)
  - `createDerivedApplicationPointForService` (line 192) is the closest blueprint for `createDerivedApplicationPointForLibrary`. `ensureDerivedApplicationPoint` (line 289) and `getTargetEntityInfo` (line 360) need a 4th `'LIBRARY'` arm each. `application_id: ''` empty-string default for Library satisfies the TS-required field on `ApplicationPoint`.

- **`iac_resource_bindings`** entry in `relationshipDefinitions.ts:158-182`
  - Spec-7 precedent for polymorphic-anchor `endpointEntityTypes`. Lists the polymorphic anchor (`infrastructure_points`) plus the concrete entity types involved. Spec 2's `code_unit_dependencies` entry mirrors this: `['application_points', 'services', 'libraries']`. Causes `getRelationshipsForDomain('application')` to surface the relationship correctly with no cross-domain spillage.

- **Spec-7 `??=` backfill lines** (`frontend/src/api/modelSerialization.ts:102, 117`)
  - Pattern for the 2 new backfill lines. One-liner per array, mirrors the IaC entries shape for consistency.

- **Spec-4 + spec-7 picklist banners** in `defaults.ts:1247-1316`
  - Pattern for spec-2's banner above its 2 new arrays.

- **`userJourneyLinksConfig.test.ts` + `infrastructureTablesConfig.test.ts`** — Vitest patterns for the new config test.

- **Existing `tech_hints_cell` flow** — once `TechHintsRow` typing is in place, Library inherits resolver chip rendering, `pendingResolutionsStore`, and `SaveWithPendingResolves` for free.

- **Existing `package_set_dropdown` cellType** — reused as-is for `libraries.package_set_id`.

- **`endpoints.port`** — pattern for numeric-as-text columns (`cellType: 'text'`). `manifest_line` and `confidence` follow the same precedent.

### Key Decisions to Honour

- **Locked field contract is authoritative** — every grid `field` key matches the Spec 1 backend column name exactly. Snake_case throughout.
- **NO new `cellType`** — reuse existing `application_point_picker`, `tech_hints_cell`, `package_set_dropdown`, `dropdown`, `text`, `tags`. The existing `application_point_picker` is extended with a 6th group; not replaced.
- **REUSE spec-7 picklists** — `sourceOriginOptions` and `generationStatusOptions` from `defaults.ts:1317-1318` are referenced via the existing exports. Do NOT redeclare. Add a banner above the 2 new arrays.
- **`TechHintsCell` typing relaxation is Option (a) — minimum blast radius** — define a structural `TechHintsRow` interface (the 9 relevant fields), change the prop type, drop the cast in `GridCell.tsx`. Both `Service` and `Library` then satisfy it structurally. NO generalisation of the cell to support multiple entity types beyond what the structural interface allows.
- **All 6 provenance columns visible** on the Libraries grid (Q5 override) — positioned at the END after `valid_to`. Rationale: Library is a brand-new table with horizontal room, and provenance is load-bearing for the manual-vs-discovered distinction once Spec 3 lands.
- **`name` and `description` are the only `required: true` columns on Libraries.** On `code_unit_dependencies`, `source_application_point_id` and `target_application_point_id` are `required: true`.
- **No `'number'` cellType** — `manifest_line` and `confidence` use `cellType: 'text'`. Matches `endpoints.port` precedent.
- **No `name`/`valid_from`/`valid_to` on `code_unit_dependencies`** — relationship convention.
- **5 backing tech-hints fields NOT exposed as grid columns** on `libraries` — `core_tech_resolved`, `core_tech_language_pack`, `core_tech_framework_packs`, `core_tech_resolution_confidence`, `core_tech_resolved_at` round-trip via the resolver flow only. Matches `Service` precedent.
- **`application_id: ''`** on derived Library APs — Library has no `application_id`; empty string satisfies the TS-required `ApplicationPoint.application_id: string`.
- **`allowedKinds` enforcement is UI-only** — filtering happens inside `ApplicationPointPickerCell.tsx`. No backend or DB validation.
- **Backward compatibility** — additive only. Old saved JSON without `libraries` / `code_unit_dependencies` arrays loads cleanly via the 2 `??=` backfill lines. Existing Application-domain entities (`Service`, `ApplicationComponent`, `Application`, `Class`, `Method`) and their relationships are untouched. Non-Application domains (Business, Data, Infrastructure, User Journey) untouched. `MetaModelView.tsx` untouched (already domain-agnostic). General DiagramType keeps working unchanged.
- **Stale-count test bump explicit** — `relationshipDefinitions.test.ts:31` from `17` to `19` is the ONLY pre-existing-failing-test edit in this spec.
- **Tests are limited** — only one new test file (max 8 focused tests on config wiring + type extensions + emptyModel defaults). No table-component rendering tests, no save-pipeline tests, no `ApplicationPointPickerCell` / `TechHintsCell` component tests, no derivation-helper tests, no formatter tests.
- **No backend / gateway / MCP / discovery changes.**

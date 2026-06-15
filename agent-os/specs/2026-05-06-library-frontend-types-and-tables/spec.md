# Specification: Library Frontend Types & Tables

## Goal
Add the frontend type system, default model state, two new table configurations, picker/derivation/formatter wiring, and serialization backfill for `Library` and `CodeUnitDependency` so users can manually view, add, edit, and delete Library records and Library Dependency relationships through the existing `MetaModelView` UI as first-class Application-domain concepts. Spec 2 of 3 in the Library arc; Spec 1 (backend) shipped, Spec 3 (discovery integration) follows.

## User Stories
- As an architect, I want a `Libraries` tab in the Application domain so that I can manually capture third-party and internal libraries (with ecosystem, repo location, tech hints, and provenance) alongside Services and Application Components.
- As an architect editing a `Library Dependency` relationship, I want a polymorphic `application_point_picker` that restricts the source endpoint to Service or Library and the target endpoint to Library so that I can declare code-unit-to-library dependencies without managing `ApplicationPoint` rows directly.
- As an architect saving and loading older architectures, I want my model to load cleanly even when the saved JSON predates Library so that backward compatibility is preserved.

## Specific Requirements

**New TypeScript interfaces and union extensions in `frontend/src/types/model.ts`**
- Add `Library` interface mirroring the `Service` field shape minus Service-specifics (no `application_id`, `service_type`, `app_component_id`, `is_internal`). Required (typed `string`): `id`, `description`, `tags`. Optional: `name`, `ecosystem`, `repo_location`, `repo_subfolder`, `core_tech`, `core_tech_resolved?: Record<string, unknown> | null`, `core_tech_language_pack?: string | null`, `core_tech_framework_packs?: string[] | null`, `core_tech_resolution_confidence?: 'high' | 'low' | 'none' | 'tech-only' | 'manual-override' | null`, `core_tech_resolved_at?: string | null`, `package_set_id`, `valid_from`, `valid_to`, plus 6 provenance fields (`source_origin`, `source_system`, `source_reference`, `generation_status`, `generation_notes`, `last_verified_at`).
- Add `CodeUnitDependency` relationship interface: required `id`, `source_application_point_id`, `target_application_point_id`. Optional: `description`, `tags`, `declared_name`, `declared_version`, `declared_version_range`, `scope`, `manifest_path`, `manifest_line?: number`, `evidence_source`, `confidence?: number`. No `name`/`valid_from`/`valid_to` (relationship convention).
- Extend `MetaModelEntities` with `libraries: Library[]` and `MetaModelRelationships` with `code_unit_dependencies: CodeUnitDependency[]`.
- Extend `EntityType` string union with `'libraries'`; extend `RelationshipType` string union with `'code_unit_dependencies'`. Extend the `AnyEntity` and `AnyRelationship` discriminated unions accordingly.
- Extend `ApplicationPointTargetType` enum with `LIBRARY = 'LIBRARY'` and `ApplicationPointKind` union with `'LIBRARY'`. TS-level only; backend Spec 1 already accepts these values.

**Default state and serialization backfill**
- `frontend/src/config/defaults.ts` `emptyModel.metaModel.entities` += `libraries: []`; `emptyModel.metaModel.relationships` += `code_unit_dependencies: []`.
- `frontend/src/api/modelSerialization.ts` `normalizeModelFromApi` += two `??=` backfill lines (`cloned.metaModel.entities.libraries ??= []` and `cloned.metaModel.relationships.code_unit_dependencies ??= []`) mirroring the spec-7 pattern.

**Domain registration in `frontend/src/config/relationshipDefinitions.ts`**
- `ENTITY_TYPE_TO_DOMAIN.libraries = 'application'` (Library is part of the Application domain, parallel to Service).
- `RELATIONSHIP_DEFINITIONS` += new entry `{ relationshipKey: 'code_unit_dependencies', displayName: 'Library Dependency', endpointEntityTypes: ['application_points', 'services', 'libraries'] }` (polymorphic anchor + concrete endpoint types — mirrors the spec-7 `iac_resource_bindings` precedent).
- `RELATIONSHIP_TAB_ORDER` += `'Library Dependency'` appended at end (becomes 19 entries).

**Domain registration in `frontend/src/utils/contextPickerDomainMappings.ts`**
- `DOMAIN_TO_ENTITY_TYPES.application` += `'libraries'`.
- `DOMAIN_TO_RELATIONSHIP_TYPES.application` += `'code_unit_dependencies'`.

**Two new picklist arrays in `frontend/src/config/defaults.ts`**
- `ecosystemOptions: string[] = ['MAVEN', 'NPM', 'PYPI', 'NUGET', 'GO', 'OTHER']`.
- `dependencyScopeOptions: string[] = ['COMPILE', 'RUNTIME', 'TEST', 'PROVIDED', 'OPTIONAL', 'DEV', 'PEER']` (union of Maven and npm scope vocabularies; `'OPTIONAL'` shared as one token).
- REUSE existing `sourceOriginOptions` (line 1317) and `generationStatusOptions` (line 1318) from spec 7. Do NOT redeclare. Append a banner comment above the 2 new arrays documenting reuse, matching the spec-4/spec-7 banner convention.

**Two new gridConfigs entries plus tab/domain wiring in `frontend/src/config/gridConfigs.ts`**
- `gridConfigs.libraries` columns in order: `id` (text, autogen, 120), `name` (text, required, 200), `ecosystem` (dropdown, `ecosystemOptions`, snakeCaseToTitleCase, 140), `repo_location` (text, 220), `repo_subfolder` (text, 200), `core_tech` (`tech_hints_cell`, 220), `package_set_id` (`package_set_dropdown`, 200), `description` (text, required, 250), `tags` (tags, 200), `valid_from` (text, 100), `valid_to` (text, 100), `source_origin` (dropdown, `sourceOriginOptions`, snakeCaseToTitleCase, 160), `source_system` (text, 160), `source_reference` (text, 200), `generation_status` (dropdown, `generationStatusOptions`, snakeCaseToTitleCase, 160), `generation_notes` (text, 250), `last_verified_at` (text, 140). The 5 backing tech-hints fields (`core_tech_resolved`, `core_tech_language_pack`, `core_tech_framework_packs`, `core_tech_resolution_confidence`, `core_tech_resolved_at`) are NOT exposed as separate columns; they round-trip via the resolver flow only.
- `gridConfigs.code_unit_dependencies` columns in order: `id` (text, autogen, 100), `source_application_point_id` (`application_point_picker`, required, 280, `allowedKinds: ['SERVICE', 'LIBRARY']`, `displayFormatter: applicationPointDisplayFormatter`), `target_application_point_id` (`application_point_picker`, required, 280, `allowedKinds: ['LIBRARY']`, `displayFormatter: applicationPointDisplayFormatter`), `declared_name` (text, 220), `declared_version` (text, 140), `declared_version_range` (text, 180), `scope` (dropdown, `dependencyScopeOptions`, snakeCaseToTitleCase, 140), `manifest_path` (text, 240), `manifest_line` (text, 100), `evidence_source` (text, 180), `confidence` (text, 100), `description` (text, 250), `tags` (tags, 200). No `name`/`valid_from`/`valid_to` (relationship convention). `manifest_line` and `confidence` use `cellType: 'text'` (no `'number'` cellType in the codebase; matches `endpoints.port` precedent).
- Tab maps: `tabToEntityType['Libraries'] = 'libraries'`; `entityTabNames` += `'Libraries'`; `relationshipTabToType['Library Dependency'] = 'code_unit_dependencies'`; `relationshipTabNames` += `'Library Dependency'`.
- `domainGroupings.application` += `'Libraries'` directly after `'Services'` (Library is parallel to Service; matches Spec 1 backend `ArchitectureCloneService` order).
- `DOMAIN_ENTITY_TYPES.application` += `'libraries'`.

**`ApplicationPointPickerCell` extension (`frontend/src/components/Grid/ApplicationPointPickerCell.tsx`)**
- `OptionGroup` union += `'libraries'`. `kindToGroup` += `LIBRARY: 'libraries'`. `targetTypeMap.libraries = 'LIBRARY'`. Group order constant (`allGroups`) appends `'libraries'` last. `GROUP_LABELS.libraries = 'Libraries'`.
- `buildGroupedOptions()` += 6th block listing `entities.libraries` as raw-entity selections (derived-only block; no existing-AP path because Library APs are always derived). Parallel `getLibraryDisplayText(library)` helper added alongside the existing `getServiceDisplayText`.
- The existing `allowedKinds?: string[]` filter API works as-is for `['LIBRARY']` (target column) and `['SERVICE', 'LIBRARY']` (source column).

**`applicationPointDerivation.ts` extension (`frontend/src/utils/applicationPointDerivation.ts`)**
- `DerivedTargetType` union += `'LIBRARY'`.
- New `createDerivedApplicationPointForLibrary(library)` function modelled on `createDerivedApplicationPointForService`; sets `kind: 'LIBRARY'`, `target_type: 'LIBRARY'`, `target_ref_id: library.id`, `application_id: ''` (Library has no `application_id`; empty string satisfies the TS-required `ApplicationPoint.application_id: string`). Derived AP id pattern: `ap_derived_library_<id>`. Derived AP name: `<libraryName> (Library)`.
- `ensureDerivedApplicationPoint` += 4th `case 'LIBRARY'` branch routing to the new helper. `getTargetEntityInfo` += 4th `case 'LIBRARY'` branch.

**`formatters.ts` extension (`frontend/src/utils/formatters.ts`)**
- `APPLICATION_POINT_KIND_LABELS['LIBRARY'] = 'Library'`.
- `formatApplicationPointDisplay` switch += 4th `case 'LIBRARY'` resolving `entities.libraries.find(l => l.id === target_ref_id)` and returning `${library.name} (Library)`. Fallback to AP own name on missing target, matching the existing pattern.

**`TechHintsCell` typing relaxation — Option (a) minimal fix**
- Define a structural `TechHintsRow` interface in `frontend/src/components/Grid/TechHintsCell.tsx` covering the 9 relevant fields: `id`, `core_tech`, `repo_location`, `repo_subfolder`, `core_tech_resolved`, `core_tech_language_pack`, `core_tech_framework_packs`, `core_tech_resolution_confidence`, `core_tech_resolved_at`. Equivalent to `Pick<Service, ...>`.
- Update `TechHintsCellProps.service: Service` to `TechHintsCellProps.service: TechHintsRow` (or rename prop to `row` if cleaner — implementer's call). Both `Service` and `Library` then satisfy it structurally.
- Update `frontend/src/components/Grid/GridCell.tsx` `tech_hints_cell` arm: drop the `entity as unknown as Service` cast (line 332). Library inherits the LLM resolver flow with no further changes — `pendingResolutionsStore` and the `resolveTechHints` call are already row-id-keyed and type-agnostic.

**One Vitest config test** at `frontend/src/config/__tests__/libraryConfigAndTypes.test.ts`
- Assert `gridConfigs.libraries` and `gridConfigs.code_unit_dependencies` exist with required-field columns (`name`, `description` on Libraries; `source_application_point_id`, `target_application_point_id` on Code Unit Dependencies).
- Assert `tabToEntityType['Libraries'] === 'libraries'`, `entityTabNames` includes `'Libraries'`, `relationshipTabToType['Library Dependency'] === 'code_unit_dependencies'`, `relationshipTabNames` includes `'Library Dependency'`, `RELATIONSHIP_TAB_ORDER` ends with `'Library Dependency'`.
- Assert `RELATIONSHIP_DEFINITIONS` contains an entry with `relationshipKey: 'code_unit_dependencies'`, `displayName: 'Library Dependency'`, `endpointEntityTypes: ['application_points', 'services', 'libraries']`.
- Assert `ENTITY_TYPE_TO_DOMAIN.libraries === 'application'`; `DOMAIN_TO_ENTITY_TYPES.application` includes `'libraries'`; `DOMAIN_TO_RELATIONSHIP_TYPES.application` includes `'code_unit_dependencies'`.
- Assert `ecosystemOptions` and `dependencyScopeOptions` exist with the exact expected values; assert `sourceOriginOptions` and `generationStatusOptions` are unchanged (sanity check that spec 2 did not redeclare them).
- Assert `ApplicationPointTargetType.LIBRARY === 'LIBRARY'`; assert `'LIBRARY'` is a valid `ApplicationPointKind` (compile-time check via assignment).
- Assert `emptyModel.metaModel.entities.libraries === []` and `emptyModel.metaModel.relationships.code_unit_dependencies === []`.

**Carry-forward fix to `frontend/src/__tests__/relationshipDefinitions.test.ts:31`**
- Bump `expect(RELATIONSHIP_DEFINITIONS).toHaveLength(17)` to `toHaveLength(19)`. Was already broken at 18 post-spec-7; spec 2 corrects the count to 19.

**Backward compatibility and non-regression**
- All changes are additive. Existing Application-domain entities (`Service`, `ApplicationComponent`, `Application`, `Class`, `Method`) and their relationships are untouched. Non-Application domains (Business, Data, Infrastructure, User Journey) are untouched. `MetaModelView.tsx` is untouched (already domain-agnostic). The General DiagramType keeps the full Application palette unchanged; Libraries become available there once the entity type is registered. Existing pre-existing failing tests (per project memory) remain unchanged.

## Visual Design
N/A — frontend types + table-config + picker-extension spec, no UI artefacts. Reference UX is the existing per-domain `MetaModelView` rendering against `gridConfigs[<key>]`, the existing `ApplicationPointPickerCell` grouped dropdown UX, and the existing `TechHintsCell` resolver-chip UX.

## Existing Code to Leverage

**`Service` TS interface (`frontend/src/types/model.ts:361-392`)**
- Primary template for the new `Library` interface. Same snake_case shape and same 5 tech-hints columns. Library drops Service-specifics (`application_id`, `service_type`, `app_component_id`, `is_internal`) and adds `ecosystem` plus the 6 provenance fields. `description: string` and `tags: string` typed non-optional at TS level — Library matches.

**`ApplicationPointPickerCell.tsx` (`frontend/src/components/Grid/ApplicationPointPickerCell.tsx`, 622 lines)**
- 6-step extension pattern: `OptionGroup` union, `kindToGroup` map, `buildGroupedOptions()` per-group block, `targetTypeMap`, `allGroups` group order, `GROUP_LABELS` dict — Library appended in each. The existing `allowedKinds?: string[]` filter API requires no changes; spec 2 wires it via column config in `gridConfigs.code_unit_dependencies`.

**`applicationPointDerivation.ts` (`frontend/src/utils/applicationPointDerivation.ts:192-360`)**
- `createDerivedApplicationPointForService` is the closest blueprint for `createDerivedApplicationPointForLibrary`. `ensureDerivedApplicationPoint` and `getTargetEntityInfo` switch statements need a 4th `'LIBRARY'` arm each. The `application_id: ''` empty-string default for Library is the clean way to satisfy the TS-required field on `ApplicationPoint`.

**`iac_resource_bindings` entry in `relationshipDefinitions.ts:158-182`**
- Spec-7 precedent for polymorphic-anchor `endpointEntityTypes`. Lists the polymorphic anchor (`application_points`/`infrastructure_points`) plus the concrete entity types involved. Spec 2's `code_unit_dependencies` entry mirrors this: `['application_points', 'services', 'libraries']`. Causes `getRelationshipsForDomain('application')` to surface the relationship correctly with no cross-domain spillage.

**Spec-7 `??=` backfill lines (`frontend/src/api/modelSerialization.ts:102, 117`)**
- Pattern for the 2 new backfill lines. One-liner per array, mirrors the IaC entries shape for consistency.

## Out of Scope
- Discovery integration (Spec 3): deterministic resolvers, preflight modal, transitive walker, right-click menu, scan progress UX.
- Per-version Library rows — versions stay on the edge (recorded on `code_unit_dependencies.declared_version` / `declared_version_range`).
- Diagram support for Library and CodeUnitDependency — current Application diagrams via the General DiagramType keep working as free-form authoring; no palette/shape/generator changes.
- New cellType creation — reuse existing `application_point_picker`, `tech_hints_cell`, `package_set_dropdown`, `dropdown`, `text`, `tags`.
- Provenance / readiness fields exposed as visible grid columns on existing Application-domain entities (Service, AppComponent, Application).
- LLM tech-hints resolver call-site changes — the `tech_hints_cell` cellType is reused; the resolver works for Library because Library has the same 5 tech-hints columns as Service and the resolver flow is row-id-keyed.
- Backend, gateway, MCP, or discovery-service code changes (Spec 1 covered backend; Spec 3 covers discovery).
- Renderer / component tests beyond TS compile + the one config test.
- Heavy validation against real package-manager constraints (ecosystem-specific scope rules, semver parsing, manifest-path format checks).

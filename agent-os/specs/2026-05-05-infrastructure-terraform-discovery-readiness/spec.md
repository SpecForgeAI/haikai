# Specification: Infrastructure Terraform & Discovery Readiness

## Goal
Add Terraform/IaC source-of-record and discovery-readiness metadata to the Infrastructure domain (spec 7 of 7) via 2 new tables, provenance + readiness fields on existing Infra tables, and 2 new table tabs only — backend is full-stack, frontend is tables-only with no diagram palette/edge work.

## User Stories
- As an architect, I want to record IaC source-of-record (Terraform repo/path/workspace, provider, commit SHA) so that every Infrastructure entity in my model can be traced to the code that provisions it.
- As an architect, I want to bind an Infrastructure entity (via `InfrastructurePoint`) to a specific IaC resource address so that I can track current vs planned vs drifted Terraform-managed resources.
- As an architect, I want each Infrastructure entity and Infra-internal relationship to carry provenance (origin / system / reference / status / notes / verified-at) and Terraform-readiness hints so that future discovery and IaC-generation flows have a place to land their data without further schema work.

## Specific Requirements

**4 new Liquibase changesets in `architecture-model-service/src/main/resources/db/changelog/`**
- `118-iac-sources.sql`: PK `id TEXT`, `model_file_id TEXT NOT NULL` cascade, `name TEXT NOT NULL`, `description TEXT NOT NULL`, `tags TEXT NOT NULL`, `valid_from TEXT NULL`, `valid_to TEXT NULL`, `environment_id TEXT NULL → environments(id)`, `source_type TEXT NULL`, `repository_url TEXT NULL`, `repository_provider TEXT NULL`, `branch TEXT NULL`, `commit_sha TEXT NULL`, `path TEXT NULL`, `workspace TEXT NULL`, `module_name TEXT NULL`, `module_path TEXT NULL`, `provider TEXT NULL`, `owner TEXT NULL`, `last_scanned_at TEXT NULL`, `last_imported_at TEXT NULL`, perf index on `model_file_id`.
- `119-iac-resource-bindings.sql`: PK `id TEXT`, `model_file_id TEXT NOT NULL` cascade, `iac_source_id TEXT NOT NULL → iac_sources(id)`, `infrastructure_point_id TEXT NOT NULL → infrastructure_points(id)`, `environment_id TEXT NULL → environments(id)`, `iac_address TEXT NULL`, `iac_resource_type TEXT NULL`, `iac_resource_name TEXT NULL`, `provider TEXT NULL`, `file_path TEXT NULL`, `start_line INTEGER NULL`, `end_line INTEGER NULL`, `state_resource_id TEXT NULL`, `external_id TEXT NULL`, `binding_status TEXT NULL`, `confidence DECIMAL(4,3) NULL` (no DB CHECK), `last_seen_at TEXT NULL`, `description TEXT NOT NULL`, `tags TEXT NOT NULL`, perf index on `model_file_id`. No `name` column.
- `120-infrastructure-provenance-fields.sql`: `ALTER TABLE ADD COLUMN` for 6 nullable provenance fields (`source_origin TEXT`, `source_system TEXT`, `source_reference TEXT`, `generation_status TEXT`, `generation_notes TEXT`, `last_verified_at TEXT`) on each of the 12 Infra entity tables (`environments`, `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`) AND on the 3 Infra-internal relationship tables (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`) — 15 tables total.
- `121-infrastructure-terraform-readiness-fields.sql`: `ALTER TABLE ADD COLUMN` for 5 nullable readiness fields (`terraform_ready BOOLEAN`, `terraform_module_hint TEXT`, `terraform_resource_hint TEXT`, `terraform_variable_hints TEXT` raw JSON string not JSONB, `terraform_notes TEXT`) on the 12 Infra entity tables ONLY — relationships excluded.
- All four registered in `db.changelog-master.yaml` in numeric order. `preConditions: onFail: MARK_RAN` with `not: tableExists` (changesets 118/119) or `not: columnExists` (changesets 120/121). NEW changesets only — never edit any applied changeset (per `feedback_liquibase_immutable_changesets.md`).

**2 new JPA entity classes in `model/entity/`**
- `IaCSourceEntity` (entity-shaped, mirrors spec 1 entity envelope: `@Entity`, `@Table(name = "iac_sources")`, `@Id String id`, `@Column(name = "...")` for every field, FKs as raw `String`, all source-specific fields nullable boxed types, `name`/`description`/`tags` non-null `String`, plus the 6 provenance + 5 readiness fields are NOT on this new entity since it itself is an IaC source not an Infra entity).
- `IaCResourceBindingEntity` (relationship-shaped, mirrors spec 2 + spec 6 relationship pattern: no `name` column, polymorphic-target via `infrastructure_point_id`, `confidence` is `BigDecimal` nullable, `start_line`/`end_line` are `Integer` nullable, `description`/`tags` non-null `String`).
- 12 existing Infra entity classes get 11 new fields each (6 provenance nullable `String` + 5 readiness: `terraform_ready` nullable `Boolean`, 4× nullable `String`).
- 3 existing Infra-internal relationship entity classes get 6 new provenance fields each (all nullable `String`).

**2 new DTO Java records in `model/dto/`**
- `IaCSourceDto`, `IaCResourceBindingDto`. All fields use `@JsonProperty("snake_case")` matching DB column names. IDs are `String`, `confidence` is `BigDecimal`, `start_line`/`end_line` are `Integer`, `terraform_ready` is `Boolean`. `model_file_id` is server-side only and NOT exposed in DTOs.
- 12 existing Infra entity DTOs extended with 11 new fields each (6 provenance + 5 readiness) using `@JsonProperty` snake_case keys.
- 3 existing Infra-internal relationship DTOs extended with 6 new provenance fields each.

**2 new Spring Data JPA repositories in `repository/`**
- `IaCSourceRepository` and `IaCResourceBindingRepository`, each extending `JpaRepository<TEntity, String>` with `findByModelFileId(String modelFileId)` and `deleteByModelFileId(String modelFileId)`. No additional finders.

**`EntityMapper` extension**
- Append 1 bidirectional `toDto`/`toEntity` arm pair for each new type (`iac_sources`, `iac_resource_bindings`).
- Extend the existing 12 entity arms with the 11 new fields each (6 provenance + 5 readiness).
- Extend the existing 3 Infra-internal relationship arms with the 6 new provenance fields each.

**`MetaModelEntitiesDto` and `MetaModelRelationshipsDto` extension (additive)**
- `MetaModelEntitiesDto`: append 1 new `List<IaCSourceDto>` field with `@JsonProperty("iac_sources")`.
- `MetaModelRelationshipsDto`: append 1 new `List<IaCResourceBindingDto>` field with `@JsonProperty("iac_resource_bindings")`.
- Both lists default to empty (not null) on serialisation.

**`ModelService` save / load / delete-and-replace integration**
- Save order: existing entities → `iac_sources` → existing relationships → `iac_resource_bindings`.
- Delete order (reverse): `iac_resource_bindings` → existing relationships → `iac_sources` → existing entities.
- Load: append 2 new arms in `MetaModelEntitiesDto` / `MetaModelRelationshipsDto` assembly. Pattern strictly mirrors the spec 2 + spec 6 arms. Existing Business / Application / Data / Behavioural / UI / Infrastructure-V1 / Infrastructure-cross-domain (spec 6) behaviour remains unchanged.

**`ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` extension**
- Block A (entities): append `iac_sources` after the 12 spec 1/2 Infra entity tables.
- Block B (relationships): append `iac_resource_bindings` at the very end, after the 3 Infra-internal tables and the 4 spec 6 cross-domain tables (since it depends on `iac_sources` AND `infrastructure_points`).

**`ArchitectureElementInventoryService` extension**
- `TABLES_BY_DOMAIN.Infrastructure` += `iac_sources`, `iac_resource_bindings`.
- `DISPLAY_NAME_FALLBACK_TABLES` += `iac_resource_bindings` (no `name` column). `iac_sources` is NOT added (it has a `name` column).

**Frontend types — `frontend/src/types/model.ts`**
- 2 new TS interfaces (PascalCase, snake_case fields): `IaCSource`, `IaCResourceBinding`. `confidence?: number`, `start_line?: number`, `end_line?: number`, `terraform_ready?: boolean`, FKs are `string?`/`string`, `description: string`, `tags: string`.
- 12 existing Infra entity TS interfaces extended with 11 new optional fields each (`source_origin?`, `source_system?`, `source_reference?`, `generation_status?`, `generation_notes?`, `last_verified_at?`, `terraform_ready?`, `terraform_module_hint?`, `terraform_resource_hint?`, `terraform_variable_hints?`, `terraform_notes?`).
- 3 existing Infra-internal relationship TS interfaces extended with 6 new optional provenance fields each.
- Extend `MetaModelEntities` with `iac_sources: IaCSource[]` and `MetaModelRelationships` with `iac_resource_bindings: IaCResourceBinding[]`.
- Extend `EntityType` + `AnyEntity` and `RelationshipType` + `AnyRelationship` unions accordingly.

**Frontend `relationshipDefinitions.ts`**
- Append 1 new `RELATIONSHIP_DEFINITIONS` entry for `iac_resource_bindings` with display name `"IaC Source ↔ Infrastructure"` (or `"IaC Binding"`); `endpointEntityTypes` mixes `iac_sources` with the 12 Infra entity types (via `infrastructure_point_id` polymorphic target).
- `ENTITY_TYPE_TO_DOMAIN.iac_sources = 'infrastructure'`.
- Append the new tab label to `RELATIONSHIP_TAB_ORDER` after the spec 6 cross-domain entries.

**Frontend `contextPickerDomainMappings.ts`**
- `DOMAIN_TO_ENTITY_TYPES.infrastructure` += `'iac_sources'`.
- `DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure` += `'iac_resource_bindings'`.

**Frontend `gridConfigs.ts` — 2 new grid configs + tab maps**
- `iac_sources` grid columns: `name` (text, required), `source_type` (dropdown `iacSourceTypeOptions`), `provider` (dropdown `iacSourceProviderOptions`), `repository_url` (text), `repository_provider` (dropdown `repositoryProviderOptions`), `branch` (text), `commit_sha` (text), `path` (text), `workspace` (text), `module_name` (text), `module_path` (text), `environment_id` (`fk_typeahead`/`environments`), `owner` (text), `last_scanned_at` (text), `last_imported_at` (text), `description` (text), `tags` (tags), `valid_from` (text), `valid_to` (text).
- `iac_resource_bindings` grid columns: `infrastructure_point_id` (cellType `infrastructure_point_picker` reused from spec 4 with NO `allowedKinds` restriction — bindings can target any kind, required), `iac_source_id` (`fk_typeahead`/`iac_sources`, required), `environment_id` (`fk_typeahead`/`environments`), `iac_address` (text), `iac_resource_type` (text), `iac_resource_name` (text), `provider` (dropdown `iacSourceProviderOptions`), `file_path` (text), `start_line` (text — numeric-as-text), `end_line` (text — numeric-as-text), `state_resource_id` (text), `external_id` (text), `binding_status` (dropdown `bindingStatusOptions`), `confidence` (text — numeric-as-text), `last_seen_at` (text), `description` (text), `tags` (tags).
- Tab maps: `tabToEntityType` (+1 `'IaC Sources' → 'iac_sources'`), `entityTabNames` (+1 `"IaC Sources"`), `relationshipTabToType` (+1 `'IaC Resource Bindings' → 'iac_resource_bindings'`), `relationshipTabNames` (+1 `"IaC Resource Bindings"`).
- `domainGroupings.infrastructure` +1 visible entry: `"IaC Sources"`. `DOMAIN_ENTITY_TYPES.infrastructure` +1: `'iac_sources'`.
- **No new columns added to any existing 12 Infra entity gridConfig** (Q4 trim — provenance/readiness round-trips through save/load but is not displayed in V1).
- **No edits to any existing 3 Infra-internal relationship gridConfig** (Q4 trim).

**Frontend `defaults.ts` — picklists and `emptyModel`**
- 6 new picklist arrays (verbatim):
  - `sourceOriginOptions = ['MANUAL', 'DISCOVERED', 'IMPORTED', 'GENERATED', 'SUGGESTED', 'OTHER']`
  - `generationStatusOptions = ['NOT_READY', 'READY', 'GENERATED', 'BLOCKED', 'NOT_APPLICABLE', 'UNKNOWN']`
  - `iacSourceTypeOptions = ['TERRAFORM', 'OPENTOFU', 'CLOUDFORMATION', 'BICEP', 'PULUMI', 'KUBERNETES', 'HELM', 'OTHER']`
  - `repositoryProviderOptions = ['GITHUB', 'GITLAB', 'BITBUCKET', 'AZURE_DEVOPS', 'OTHER']`
  - `iacSourceProviderOptions = ['GCP', 'AWS', 'AZURE', 'ON_PREM', 'MULTI', 'OTHER']` — separate from spec 4's `providerOptions` (do NOT redeclare or modify `providerOptions`).
  - `bindingStatusOptions = ['PLANNED', 'SUGGESTED', 'CONFIRMED', 'STALE', 'REMOVED', 'UNKNOWN']`
- `emptyModel.entities` += `iac_sources: []`. `emptyModel.relationships` += `iac_resource_bindings: []`.

**Frontend `paletteData.ts`**
- Add registration stubs for `iac_sources` and `iac_resource_bindings` ONLY if the codebase requires them for type recognition; otherwise omit entirely. **No new diagram palette sections, no node shape, no edge type for either.** Bindings appear ONLY in the table tab, never on any diagram (Q5).

**Frontend `modelSerialization.ts` — `normalizeModelFromApi` backfill**
- Append 2 new `??=` lines: `model.entities.iac_sources ??= []` and `model.relationships.iac_resource_bindings ??= []`. Provenance/readiness fields on existing tables need no backfill (nullable columns; missing reads as `undefined` cleanly).

**Files NOT to touch**
- `frontend/src/utils/relationshipUtils.ts`, `frontend/src/utils/rendering.ts`, `frontend/src/components/SelectionInspector/SelectionInspector.tsx`, `RELATIONSHIP_EDGE_TYPES`. No diagram wiring for IaC bindings (Q5).
- All 12 existing Infra entity `gridConfigs` entries, all 3 existing Infra-internal relationship `gridConfigs` entries, all 4 existing spec 6 cross-domain `gridConfigs` entries.
- `gateway/`, `mcp-server/`, `discovery-service/` — zero code changes (Q7).
- Existing Liquibase changesets `001-` through `117-` — never amend.

**Tests**
- Backend: one round-trip test class `InfrastructureTerraformReadinessRoundTripTest.java` covering save/load + delete-and-replace + projectId/architectureId scoping for `iac_sources` and `iac_resource_bindings`, plus a smoke check that the 6 provenance + 5 readiness fields round-trip on a representative entity (`compute_resources`) and the 6 provenance fields round-trip on a representative Infra-internal relationship (`deployment_unit_compute_resources`). Modelled on the spec 6 round-trip test.
- Frontend: one Vitest config test `frontend/src/config/__tests__/infrastructureTerraformReadinessConfig.test.ts` asserting (a) 2 new `gridConfigs` entries exist with required-field columns, (b) `ENTITY_TYPE_TO_DOMAIN.iac_sources === 'infrastructure'`, (c) `DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure` includes `'iac_resource_bindings'`, (d) `iac_resource_bindings` wired in `RELATIONSHIP_DEFINITIONS`, (e) all 6 new picklist arrays exist in `defaults.ts`, (f) `emptyModel` carries the 2 new array fields.
- No renderer tests, no component tests, no picker-cell tests, no diagram-interaction tests.

## Visual Design
N/A — full-stack readiness/metadata spec, no UI artefacts. Reference UX is the existing relationship-grid tabs landed in spec 4 (Infra-internal) and spec 6 (cross-domain). The 2 new tabs (`IaC Sources` entity tab; `IaC Resource Bindings` relationship tab) follow the same visual conventions.

## Existing Code to Leverage

**Spec 1 entity stack (`EnvironmentEntity`, `ComputeResourceEntity`, etc.)**
- Direct template for `IaCSourceEntity`: full entity envelope (`id`, `model_file_id`, `name`, `description`, `tags`, `valid_from`, `valid_to`) plus type-specific fields with `@Column(name = "...")` and FKs as raw `String` columns.

**Spec 2 + Spec 6 relationship stack (`ResourceSubnetHostingEntity`, `ApplicationComputeDeploymentEntity`, etc.)**
- Direct template for `IaCResourceBindingEntity` (relationship envelope without `name`, polymorphic-target shape via `infrastructure_point_id`, `BigDecimal` confidence with no DB CHECK, `Integer` line-number columns) AND for the `EntityMapper` arm, repository, `MetaModelRelationshipsDto` field, `ModelService` save/load/delete arm, and `ArchitectureCloneService` Block B append.

**Spec 4 `infrastructure_point_picker` cellType (`frontend/src/config/cells/`)**
- Reused unchanged for `iac_resource_bindings.infrastructure_point_id`. NO `allowedKinds` restriction — bindings can target any of the 12 Infra entity kinds. NO new cellType is introduced.

**Spec 4 `gridConfigs.ts` patterns (Infra entity grids and Infra-internal relationship grids)**
- Direct template for the 2 new grid configs: column shapes, `cellType: 'fk_typeahead'` patterns, dropdown patterns, numeric-as-text precedent for `confidence`/`start_line`/`end_line`. Spec 4's `defaults.ts` picklist conventions (verbatim arrays, snake_case key reused as the `field`) are mirrored for the 6 new arrays.

**Spec 6 round-trip test class (`InfrastructureCrossDomainRelationshipsRoundTripTest.java`) and Vitest config test (`infrastructureCrossDomainConfig.test.ts`)**
- Direct templates for the new backend round-trip test and the new frontend config test respectively.

## Out of Scope
- Per-entity provenance/readiness grid columns added to existing 12 entity grids in V1 (deferred to a future "Provenance Inspector Panel" spec — data round-trips, just isn't displayed).
- Per-relationship provenance grid columns added to existing 3 Infra-internal relationship grids in V1.
- IaC Source / IaC Resource Binding diagram support: no palette section, no node shape, no edge type, no `RELATIONSHIP_EDGE_TYPES` entry, no `relationshipUtils.ts` arm, no `rendering.ts` arm, no `SelectionInspector.tsx` arm.
- Provenance / readiness fields on the 4 spec 6 cross-domain relationships (`application_compute_deployments`, `data_entity_data_store_hostings`, `application_infrastructure_resource_uses`, `application_load_balancer_exposures`) — these sit at a logical/cross-domain layer, not at the IaC-resource layer.
- Gateway, MCP, and Discovery-service code changes — only narrative `spec.md` documentation of the future contract.
- Terraform parser, generator, importer, plan/apply, state-file parser. OpenTofu support beyond the `iacSourceTypeOptions` enum value. Cloud Asset Inventory / live GCP API integration. LLM-based IaC workflows.
- Security group / firewall / IAM modelling. Cost estimation. Drift / policy / compliance scanning. Auto-diagram-from-Terraform.
- XLSX import/export wiring for the 2 new tables. `MetaModelSummary` extension for the 2 new tables. Per-entity CRUD REST endpoints (full-model save/load only).
- Renderer tests, component tests, picker-cell tests, diagram-interaction tests.

## Forward-Compatibility Appendix: Future Discovery / Gateway / MCP Contract Shape

This spec adds **zero** code to `gateway/`, `mcp-server/`, or `discovery-service/`. The JSON shape landed here IS the contract that future pipelines will conform to. No further schema work is required when those pipelines are built.

- **Future discovery pipeline (`discovery-service/`)** can post `iac_source` candidates with `source_origin = 'DISCOVERED'`, `source_system` set to the scanner identity (e.g. `terraform-repo-scanner`, `gcp-cloud-asset-inventory`), and `source_reference` set to the file path / commit SHA / cloud resource id. Evidence, confidence, and decision-task workflows reuse the existing candidate/evidence/approved-candidate contract — approved candidates land in `iac_sources` via the existing full-model save pipeline.
- **Future `iac_resource_bindings` candidates** are produced by Terraform AST parsers and cloud-inventory matchers; ambiguous matches surface as decision tasks, and approved candidates land via the existing save pipeline. Confidence is a `DECIMAL(4,3)` value with no DB CHECK — clamping/normalisation is the producer's responsibility.
- **Future MCP tool surface**: a `saveIaCSource` / `saveIaCResourceBinding` tool can be added to `mcp-server/` calling the same full-model save endpoint with the same JSON shape (snake_case throughout, `model_file_id` server-side only). No backend changes required.
- **Provenance fields on existing Infra entities and Infra-internal relationships** are populated by discovery pipelines to record origin, scan timestamp, and audit trail. **Readiness fields on existing Infra entities** are populated by a future Terraform-readiness analyser and surfaced via the existing approve-candidate UI.

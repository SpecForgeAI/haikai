# Specification: Infrastructure Cross-Domain Integration

## Goal
Wire the Infrastructure domain to the Application and Data domains via 4 new cross-domain relationships, full-stack: backend Liquibase + JPA + DTO + repositories + `ModelService` integration, and frontend types + grids + palette + diagram edges + minimal inspector arms.

## User Stories
- As an architect, I want to link an Application/Service to a Compute Resource (optionally via a Deployment Unit), to a Load Balancer (optionally via a Listener), and to an Infrastructure Resource (bucket, queue, topic, cache, secret store, etc.) so that I can model how my software actually runs and connects in its environment.
- As an architect, I want to link a Data Entity to a Data Store Instance so that I can record where each piece of data physically lives and round-trip that fact through save/load and diagrams.

## Specific Requirements

**4 new Liquibase changesets (114-117) in `architecture-model-service/src/main/resources/db/changelog/`**
- `114-application-compute-deployments.sql`: PK `id`, `model_file_id` cascade, `application_point_id NOT NULL → application_points(id)`, `compute_resource_id NOT NULL → compute_resources(id)`, `deployment_unit_id NULL → deployment_units(id)`, `environment_id NULL → environments(id)`, `deployment_role TEXT NULL`, `runtime_name TEXT NULL`, `runtime_version TEXT NULL`, `evidence_source TEXT NULL`, `confidence DECIMAL(4,3) NULL` (no DB CHECK), `description TEXT NOT NULL`, `tags TEXT NOT NULL`, perf index on `model_file_id`.
- `115-data-entity-data-store-hostings.sql`: standard envelope + `data_entity_point_id NOT NULL → data_entity_points(id)`, `data_store_instance_id NOT NULL → data_store_instances(id)`, `environment_id NULL → environments(id)`, `database_name TEXT NULL`, `schema_name TEXT NULL`, `table_or_collection_name TEXT NULL`, `hosting_role TEXT NULL`, `evidence_source`, `confidence DECIMAL(4,3) NULL`, `description NOT NULL`, `tags NOT NULL`, perf index on `model_file_id`.
- `116-application-infrastructure-resource-uses.sql`: standard envelope + `application_point_id NOT NULL`, `infrastructure_resource_id NOT NULL → infrastructure_resources(id)`, `environment_id NULL`, `dependency_type TEXT NULL`, `protocol TEXT NULL`, `endpoint_or_topic TEXT NULL`, `access_mode TEXT NULL`, `evidence_source`, `confidence DECIMAL(4,3) NULL`, `description NOT NULL`, `tags NOT NULL`, perf index on `model_file_id`.
- `117-application-load-balancer-exposures.sql`: standard envelope + `application_point_id NOT NULL`, `load_balancer_id NOT NULL → load_balancers(id)`, `listener_id NULL → listeners(id)`, `environment_id NULL`, `host_name TEXT NULL`, `path_pattern TEXT NULL`, `protocol TEXT NULL`, `port INTEGER NULL`, `exposure TEXT NULL`, `evidence_source`, `confidence DECIMAL(4,3) NULL`, `description NOT NULL`, `tags NOT NULL`, perf index on `model_file_id`.
- All four registered in `db.changelog-master.yaml` in numeric order. `preConditions: onFail: MARK_RAN` with `not: tableExists`. NEW changesets only — never edit any applied changeset (per `feedback_liquibase_immutable_changesets.md`).

**4 new JPA entity classes in `model/entity/relationship/`**
- `ApplicationComputeDeploymentEntity`, `DataEntityDataStoreHostingEntity`, `ApplicationInfrastructureResourceUseEntity`, `ApplicationLoadBalancerExposureEntity`.
- Modelled on `DataMovementEntity`: `@Entity`, `@Table(name = "...")`, `@Id String id`, `@Column(name = "...")` for every field, FKs as raw `String` columns matching spec 2's pattern.
- All FK fields, picklist enum-shaped fields, and freetext fields are nullable boxed types where the column is nullable; `description` and `tags` are non-null `String`. `confidence` is `BigDecimal` (nullable).

**4 new DTO Java records in `model/dto/relationship/`**
- `ApplicationComputeDeploymentDto`, `DataEntityDataStoreHostingDto`, `ApplicationInfrastructureResourceUseDto`, `ApplicationLoadBalancerExposureDto`.
- All fields use `@JsonProperty("snake_case")` matching DB column names. IDs are `String`, `confidence` is `BigDecimal`, `port` (Rel 4) is `Integer`. `model_file_id` is server-side only and NOT exposed in DTOs.

**4 new Spring Data JPA repositories in `repository/relationship/`**
- Each extends `JpaRepository<TEntity, String>` with `findByModelFileId(String modelFileId)` and `deleteByModelFileId(String modelFileId)`. No additional finders.

**`EntityMapper` extension**
- Append 4 new `toDto` and 4 new `toEntity` arms — one bidirectional pair per relationship — modelled on the spec 2 arms for `resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`.

**`MetaModelRelationshipsDto` extension (additive)**
- Append 4 new `List<...Dto>` fields with `@JsonProperty` snake_case names matching the table names: `application_compute_deployments`, `data_entity_data_store_hostings`, `application_infrastructure_resource_uses`, `application_load_balancer_exposures`. Lists default to empty (not null) on serialisation.

**`ModelService` save / load / delete-and-replace integration**
- `saveRelationships(...)`, `loadModel(...)` (`MetaModelRelationshipsDto` assembly), and `deleteAllDataForModelFile(...)` each get 4 new arms invoking the new repositories. Pattern strictly mirrors the 3 spec 2 Infra-internal relationship arms. Existing Business / Application / Data / Behavioural / UI / Infrastructure-V1 behaviour remains unchanged.

**`ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` extension**
- Append the 4 new table names to **Block B (DEPENDENT)** at the end, after the 3 spec 2 Infra-internal relationship tables and after the Application/Data tables they reference. Order: `application_compute_deployments`, `data_entity_data_store_hostings`, `application_infrastructure_resource_uses`, `application_load_balancer_exposures`.

**`ArchitectureElementInventoryService` extension**
- Extend `TABLES_BY_DOMAIN.Infrastructure` with the 4 new relationship table names (cross-domain relationships sit once under Infrastructure here; per-domain visibility is derivation-based via `getRelationshipsForDomain`).
- Extend `DISPLAY_NAME_FALLBACK_TABLES` with all 4 (none of the 4 has a `name` column).

**Frontend types — `frontend/src/types/model.ts`**
- 4 new TypeScript interfaces (PascalCase, snake_case fields): `ApplicationComputeDeployment`, `DataEntityDataStoreHosting`, `ApplicationInfrastructureResourceUse`, `ApplicationLoadBalancerExposure`. `confidence?: number`, `port?: number` on Rel 4; all FKs are `string?` per nullability; `description: string`, `tags: string`.
- Extend `MetaModelRelationships` with 4 new array fields (one per relationship, matching the snake_case table names).
- Extend `RelationshipType` and `AnyRelationship` unions with 4 new entries.
- Add 4 new `RELATIONSHIP_EDGE_TYPES` constants: `APPLICATION_COMPUTE_DEPLOYMENT`, `DATA_ENTITY_DATA_STORE_HOSTING`, `APPLICATION_INFRASTRUCTURE_RESOURCE_USE`, `APPLICATION_LOAD_BALANCER_EXPOSURE`.

**Frontend `RELATIONSHIP_DEFINITIONS` and `RELATIONSHIP_TAB_ORDER` — `frontend/src/config/relationshipDefinitions.ts`**
- Append 4 new entries with `endpointEntityTypes` mixing the Application/Data source-side entity types with the Infrastructure target-side entity types per the per-relationship endpoint shapes (Rel 1 → applications + compute_resources/deployment_units; Rel 2 → data entities + data_store_instances; Rel 3 → applications + infrastructure_resources; Rel 4 → applications + load_balancers/listeners).
- Tab labels: `"App ↔ Compute"`, `"Data Entity ↔ Data Store"`, `"App ↔ Infrastructure Resource"`, `"App ↔ Load Balancer"`.
- Append the 4 new tab labels to `RELATIONSHIP_TAB_ORDER` after the spec 3 entries (`Resource ↔ Subnet`, `Deployment Unit ↔ Compute`, `Load Balancer Routes`), in the order above.

**Frontend `DOMAIN_TO_RELATIONSHIP_TYPES` — `frontend/src/utils/contextPickerDomainMappings.ts`**
- `application` gets Rels 1, 3, 4. `data` gets Rel 2. `infrastructure` gets all 4. `behavioural` and `ui` are NOT extended (Q12 — deferred to spec 7).

**Frontend `gridConfigs.ts` — 4 new grid configs + tab maps**
- Each grid config uses the column shape from `requirements.md` per-table tables (e.g. Rel 1 columns: `application_point_id` cellType `application_point_picker` required, `compute_resource_id` `fk_typeahead`/`compute_resources` required, `deployment_unit_id` fk optional, `environment_id` fk optional, `deployment_role` dropdown `deploymentRoleOptions`, `runtime_name` text, `runtime_version` text, `evidence_source` text, `confidence` text, `description` text, `tags` tags).
- Rel 2 source uses `data_entity_point_picker`. Rels 1/3/4 source uses `application_point_picker`. Both pickers are reused from existing code — no new cellType.
- Append 4 keys to `relationshipTabToType` (`'App ↔ Compute' → 'application_compute_deployments'`, etc.) and 4 names to `relationshipTabNames`.

**Frontend `defaults.ts` — picklists and `emptyModel`**
- Add 4 new picklist arrays: `deploymentRoleOptions = ['PRIMARY','SECONDARY','WORKER','BATCH','ADMIN','OTHER']`, `hostingRoleOptions = ['PRIMARY','REPLICA','CACHE','ARCHIVE','ANALYTICS','OTHER']`, `dependencyTypeOptions = ['READS_FROM','WRITES_TO','PUBLISHES_TO','SUBSCRIBES_TO','USES','STORES_IN','RETRIEVES_FROM','OTHER']`, `accessModeOptions = ['READ','WRITE','READ_WRITE','EXECUTE','ADMIN','OTHER']`.
- **Reuse** existing `exposureOptions` and `protocolOptions` from spec 4 — do NOT redeclare.
- Append 4 `[]` fields to `emptyModel.relationships` (one per new relationship array).

**Frontend `paletteData.ts` — palette sections and diagram-type rules**
- Append 4 new entries to `relationshipSections` (one per relationship, with edge type, label, and the matching `RELATIONSHIP_EDGE_TYPES` constant).
- Extend `DIAGRAM_TYPE_PALETTE_RULES`: Infrastructure diagrams get all 4 new relationships; Application diagrams get Rels 1, 3, 4; Data diagrams get Rel 2.
- `domainToPaletteSections.application` / `.data` / `.infrastructure` updated through the existing derivation (no manual restructuring).

**Frontend `modelSerialization.ts` — `normalizeModelFromApi` backfill**
- Append 4 `??=` lines, one per new relationship array, so older saved models without these arrays load as `[]`.

**Frontend `relationshipUtils.ts` — edge creation and eligibility**
- Append 4 new `createRelationshipEdge` arms with distinct edge styles per relationship and these default labels:
  - Rel 1: solid + arrow, label `deployment_role` (e.g. `"PRIMARY"`).
  - Rel 2: solid + arrow, label `hosting_role` (e.g. `"REPLICA"`).
  - Rel 3: solid + arrow, label `dependency_type` (fall back to `access_mode` if `dependency_type` unset; e.g. `"READS_FROM"`).
  - Rel 4: solid + arrow, label `protocol target_port` (e.g. `"HTTPS 443"`; falls back gracefully when either is unset).
- Append 4 new `getRelationshipEligibility` arms validating that both endpoints exist on the active canvas before allowing an edge.

**Frontend `rendering.ts` — edge defaults**
- Append 4 new `getRelationshipEdgeDefaults` arms keyed by the 4 new `RELATIONSHIP_EDGE_TYPES` constants. Each provides distinct stroke colour (and dash pattern where appropriate) so the four cross-domain edges are visually distinguishable from each other and from the spec 5 Infra-internal edges.

**Frontend `SelectionInspector.tsx` — minimal V1 arms**
- Append 4 new edge arms (one per relationship) exposing `description` + `tags` only. Mirrors spec 5's minimum. Full attribute editing remains via the relationship grid tabs.

**Tests**
- Backend: one round-trip test class `InfrastructureCrossDomainRelationshipsRoundTripTest.java` covering save/load + delete-and-replace + projectId/architectureId scoping for all 4 relationships. Modelled on the spec 2 Infra-internal round-trip test.
- Frontend: one Vitest config test `frontend/src/config/__tests__/infrastructureCrossDomainConfig.test.ts` asserting (a) 4 new `gridConfigs` entries exist with required-field columns, (b) 4 new `RELATIONSHIP_DEFINITIONS` entries are wired, (c) 4 new keys in `relationshipTabToType` and `RELATIONSHIP_TAB_ORDER`, (d) `DOMAIN_TO_RELATIONSHIP_TYPES.application` / `.data` / `.infrastructure` include the appropriate new entries.
- No renderer tests, no component tests, no picker-cell tests, no diagram-interaction tests in this spec.

## Visual Design
N/A — full-stack relationship spec, no UI artefacts. Reference UX is the existing relationship-grid tabs and the spec 5 diagram palette/edge rendering for the 3 Infra-internal relationships.

## Existing Code to Leverage

**Spec 2 Infra-internal relationship backend (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`)**
- Direct template for the entire backend stack: changeset shape, JPA entity, DTO record, repository, `EntityMapper` arm, `MetaModelRelationshipsDto` field, `ModelService` save/load/delete-and-replace arm, `ArchitectureCloneService` Block B append. Replicate the pattern; add the new column shapes per relationship.

**Spec 4 grid configs for the 3 Infra-internal relationships (`frontend/src/config/gridConfigs.ts`)**
- Direct template for the 4 new grid configs: column shapes, `cellType: 'fk_typeahead'` patterns, dropdown patterns, numeric-as-text precedent for `confidence` and `port`. Reuse existing `application_point_picker` and `data_entity_point_picker` cellTypes — no new cellType.

**Spec 5 frontend diagram wiring (`paletteData.ts`, `relationshipUtils.ts`, `rendering.ts`, `SelectionInspector.tsx`)**
- Direct template for the 4 new sets of frontend diagram wiring: `RELATIONSHIP_EDGE_TYPES` constants, `relationshipSections` entries, `createRelationshipEdge` and `getRelationshipEligibility` arms, edge defaults, minimal inspector arms (description + tags only).

**Existing `application_points` and `data_entity_points` source-side patterns**
- `application_points` (hybrid `target_type`/`target_ref_id`) is reused unchanged for Rels 1, 3, 4. `data_entity_points` (typed-FK + discriminator) is reused unchanged for Rel 2. No source-side schema changes.

**Existing `exposureOptions` and `protocolOptions` in `frontend/src/config/defaults.ts`**
- Reused verbatim for Rel 4's `exposure` column and Rels 3/4's `protocol` columns. Do NOT redeclare; import from existing exports.

## Out of Scope
- Behavioural and UI domain links to Infrastructure (deferred to spec 7).
- Terraform / IaC import, export, or generation, and any IaC metadata columns.
- Discovery-service inference of cross-domain relationships from runtime/cloud data.
- Automatic relationship creation from observed traffic, deployment metadata, or telemetry.
- Full diagram interaction tests, renderer tests, component tests, picker-cell tests.
- Per-entity CRUD REST endpoints (full-model save/load only).
- Gateway, MCP, Discovery-service, or security/IAM/firewall changes.
- New backend entity tables (this spec adds relationships only — no new entities).
- Live cloud provider integration; cost / observability / compliance integrations.

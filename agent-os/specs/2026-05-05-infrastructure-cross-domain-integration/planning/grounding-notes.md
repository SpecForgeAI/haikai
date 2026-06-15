# Pass A Grounding Notes — Spec 6 of 7 (Cross-Domain Integration)

## Locked contract from prior 5 specs

### Backend (specs 1-2)
- 12 Infra entity tables + `infrastructure_points` polymorphic supertype + 3 Infra-internal relationships persisted via `ModelService` save/load/delete-and-replace.
- Liquibase changesets `098-` through `113-` applied. **Last applied: `113-load-balancer-resource-routes.sql`. New cross-domain changesets MUST start at `114-`.**
- `MetaModelEntitiesDto` already has 13 new lists; `MetaModelRelationshipsDto` already has 3 Infra relationship lists (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`). Spec 6 appends 4 more.
- DTO conventions: Java records, `@JsonProperty("snake_case")`, `model_file_id` server-side only, IDs `String`, booleans nullable boxed `Boolean`, `confidence DECIMAL(4,3)` no DB CHECK, tags `TEXT`.
- `ApplicationPointEntity` is hybrid `target_type`/`target_ref_id` style. `DataEntityPointEntity` is typed-FK + discriminator + CHECK style. Spec 1 made `InfrastructurePointEntity` follow the DataEntityPoint pattern.
- `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` Block A and Block B updated with all 16 Infra tables (spec 2). New 4 cross-domain tables append to Block B (DEPENDENT-rows section).
- `ArchitectureElementInventoryService.TABLES_BY_DOMAIN` has Infrastructure entry. Cross-domain relationships go under **both** their source domain (Application/Data) AND under Infrastructure per the existing convention; verify against the existing pattern when shaping the spec — the relationship lives once, but its grid/tab visibility is derivation-based.

### Frontend types (spec 3)
- `MetaModelEntities` has 13 new array fields, `MetaModelRelationships` has 3 new array fields. Spec 6 appends 4 more relationship arrays (no new entity arrays).
- `EntityType` and `AnyEntity` unions already cover the 13 Infra entity types. `RelationshipType` and `AnyRelationship` will get 4 new entries.
- `RELATIONSHIP_DEFINITIONS` and `RELATIONSHIP_TAB_ORDER` will get 4 new entries.
- `ENTITY_TYPE_TO_DOMAIN` already maps 13 Infra types to `'infrastructure'`. No changes needed there. The 4 new relationships will have `endpointEntityTypes` mixing Application/Data entity types with Infrastructure entity types — derivation logic in `getRelationshipsForDomain` ensures they appear in BOTH source AND target domain tabs (relationship appears in domain D iff ANY endpoint type maps to D).
- `DOMAIN_TO_RELATIONSHIP_TYPES` for Application + Data + Infrastructure all need updates (currently each domain only owns its intra-domain relationships).
- `normalizeModelFromApi` adds 4 new `??=` lines for the new relationship arrays.
- `emptyModel` adds 4 new `[]` lines.

### Frontend tables UI (spec 4)
- `gridConfigs.ts` has 16 Infra entries. Spec 6 adds 4 more relationship grid configs.
- `relationshipTabToType` adds 4 keys; `relationshipTabNames` appends 4. No new `entityTabNames` (cross-domain tabs are relationships, not entities).
- The 4 new relationships use the existing `'application_point_picker'` cellType (built into the codebase) for Application-side endpoints and `'data_entity_point_picker'` cellType for Data-side endpoint of relationship 2. Concrete Infra-side targets use `'fk_typeahead'` (no polymorphic point needed for Infra side per spec 1's `data_store_instances`/`compute_resources`/`infrastructure_resources` direct FK pattern).
- `defaults.ts` adds 4 new picklist option arrays for the 4 enum-style fields (`deployment_role`, `hosting_role`, `dependency_type`, `access_mode`, `exposure`) — note `exposure` already exists from spec 4 (`exposureOptions`) and can be reused for relationship 4.

### Frontend diagrams (spec 5)
- `RELATIONSHIP_EDGE_TYPES` has `RESOURCE_SUBNET_HOSTING`, `DEPLOYMENT_UNIT_COMPUTE_RESOURCE`, `LOAD_BALANCER_RESOURCE_ROUTE`. Spec 6 adds 4 more.
- `getEntitiesOnDiagram` has both `applicationPointsOnDiagram` (existing) and `infrastructurePointsOnDiagram` (spec 5). Cross-domain edges resolve via these two Sets.
- `createRelationshipEdge`, `getEdgeColor`, `getRelationshipEdgeDefaults` add 4 new arms.
- `isRelationshipRowEnabled` adds 4 new arms.
- `SelectionInspector` adds 4 new minimal edge arms (description + tags only, mirroring spec 5 minimum).
- `paletteData.ts`: 4 new `relationshipSections` entries; updated `domainToPaletteSections` for Application + Data + Infrastructure; updated `DIAGRAM_TYPE_PALETTE_RULES` for Application + Data + Infrastructure diagram types.
- One Vitest config test: `infrastructureCrossDomainConfig.test.ts` mirroring spec 4/5.

## Endpoint shape decisions (Pass A inference)

### Source side
- **Rels 1, 3, 4**: source = `application_points` (existing ApplicationPoint hybrid `target_type`/`target_ref_id` style). Use `application_point_id NOT NULL` FK + `application_point_picker` in grid.
- **Rel 2**: source = `data_entity_points` (existing DataEntityPoint typed-FK style). Use `data_entity_point_id NOT NULL` FK + `data_entity_point_picker` in grid.

### Target side
- **Rel 1 (Application -> Compute)**: `compute_resource_id NOT NULL` (concrete FK, single-typed). Plus optional `deployment_unit_id NULL`. Per raw idea suggested attributes — direct FK only, no InfrastructurePoint needed.
- **Rel 2 (Data Entity -> Data Store Instance)**: `data_store_instance_id NOT NULL` (concrete FK, single-typed).
- **Rel 3 (Application -> Infrastructure Resource)**: `infrastructure_resource_id NOT NULL` (concrete FK, single-typed).
- **Rel 4 (Application -> Load Balancer / Listener)**: Spec 4 precedent on `load_balancer_resource_routes`: required `load_balancer_id` + nullable `listener_id` + polymorphic `target_infrastructure_point_id`. For this cross-domain rel, simpler: required `load_balancer_id NOT NULL` + nullable `listener_id NULL`. No InfrastructurePoint needed because the target is always one of two known types and we mirror the spec 4 pattern.

## Naming proposals
- `application_compute_deployments` (replaces "Application deployed to Compute")
- `data_entity_data_store_hostings` (replaces "Data entity hosted on Data Store")
- `application_infrastructure_resource_uses` (replaces "Application uses Infrastructure Resource")
- `application_load_balancer_exposures` (replaces "Application exposed through Load Balancer / Ingress")

## Visuals
- No visual files in `planning/visuals/` per bash check.

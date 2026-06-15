# Spec Requirements: Infrastructure Cross-Domain Integration

## Initial Description

Add cross-domain integration between the new Infrastructure Architecture domain and the existing Application + Data domains. This is spec 6 of 7 in the Infrastructure delivery sequence. Specs 1-5 landed:

- **Spec 1** — backend Infra schema (12 entity tables, `infrastructure_points` polymorphic supertype, 3 Infra-internal relationships). Liquibase changesets `098-` through `113-` applied.
- **Spec 2** — backend API/persistence integration (`MetaModelEntitiesDto` 13 new lists, `MetaModelRelationshipsDto` 3 new lists, `ArchitectureCloneService` Block A/B updates, `ArchitectureElementInventoryService` Infrastructure entry).
- **Spec 3** — frontend types/model integration (`MetaModelEntities` + `MetaModelRelationships` extensions, `EntityType` + `AnyEntity` + `RelationshipType` + `AnyRelationship` unions, `RELATIONSHIP_DEFINITIONS`, `ENTITY_TYPE_TO_DOMAIN`, `emptyModel`, `normalizeModelFromApi` backfill).
- **Spec 4** — frontend Infrastructure tables UI (16 `gridConfigs` entries, 23 picklist option arrays in `defaults.ts`, `'infrastructure_point_picker'` cellType + cell + derivation helper).
- **Spec 5** — frontend Infrastructure diagram support (`RELATIONSHIP_EDGE_TYPES` for the 3 Infra-internal relationships, palette sections, `createRelationshipEdge`, `getEdgeColor`, `getRelationshipEdgeDefaults`, `isRelationshipRowEnabled`, `SelectionInspector` minimal arms).

This spec adds the **4 cross-domain relationships** that wire Infrastructure to Application and Data:

1. `application_compute_deployments` — Application/service deployed to a Compute Resource (optionally via a Deployment Unit).
2. `data_entity_data_store_hostings` — Data entity hosted on a Data Store Instance.
3. `application_infrastructure_resource_uses` — Application/service uses an Infrastructure Resource (bucket, queue, topic, cache, secret store, scheduler, registry, CDN).
4. `application_load_balancer_exposures` — Application/service exposed through a Load Balancer (and optionally a specific Listener).

Each relationship is full-stack: Liquibase changeset (114-117), JPA entity, DTO, repository, EntityMapper arms, `MetaModelRelationshipsDto` extension, `ModelService` save/load/delete-and-replace, `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` Block B append, frontend types, `RELATIONSHIP_DEFINITIONS`, `DOMAIN_TO_RELATIONSHIP_TYPES` updates, `gridConfigs` entry, picklist option arrays, palette section, `RELATIONSHIP_EDGE_TYPES` constant, `createRelationshipEdge` arm, `getRelationshipEligibility` arm, edge defaults, `SelectionInspector` arm.

The full raw idea is preserved at `agent-os/specs/2026-05-05-infrastructure-cross-domain-integration/planning/00-raw-idea.md`. Codebase grounding is preserved at `planning/grounding-notes.md`.

## Requirements Discussion

### First Round Questions

**Q1: Names for the four new cross-domain relationships?**
**Answer:** Confirmed:
- Rel 1: `application_compute_deployments` — UI label "App ↔ Compute"
- Rel 2: `data_entity_data_store_hostings` — UI label "Data Entity ↔ Data Store"
- Rel 3: `application_infrastructure_resource_uses` — UI label "App ↔ Infrastructure Resource"
- Rel 4: `application_load_balancer_exposures` — UI label "App ↔ Load Balancer"

**Q2: Rel 4 (Application ↔ Load Balancer / Listener) endpoint shape — polymorphic, both-nullable, or `load_balancer_id NOT NULL` + `listener_id NULL`?**
**Answer:** Confirmed `load_balancer_id NOT NULL` + `listener_id NULL`. NOT polymorphic, NOT both-nullable. Mirrors the existing spec 4 pattern on `load_balancer_resource_routes` for the LB side, but simpler — no `target_infrastructure_point_id` here because the target type is always Load Balancer (with optional drill-down to a Listener).

**Q3: Source-side endpoints — confirm which existing point pattern each relationship uses?**
**Answer:** Confirmed:
- Rels 1, 3, 4: `application_point_id NOT NULL` (existing `application_points` hybrid `target_type`/`target_ref_id` pattern; existing `application_point_picker` cellType in the grid).
- Rel 2: `data_entity_point_id NOT NULL` (existing `data_entity_points` typed-FK + discriminator pattern; existing `data_entity_point_picker` cellType in the grid).

**Q4: Target-side concrete FKs — confirm Infrastructure-side endpoint shape per relationship?**
**Answer:** Confirmed:
- Rel 1: `compute_resource_id NOT NULL` + `deployment_unit_id NULL` (optional drill-down).
- Rel 2: `data_store_instance_id NOT NULL`.
- Rel 3: `infrastructure_resource_id NOT NULL`.
- Rel 4: `load_balancer_id NOT NULL` + `listener_id NULL`.

All Infra-side targets are concrete FKs (no `InfrastructurePoint` needed) because each relationship has a single primary target type. This matches spec 1's direct-FK precedent on `data_store_instances` / `compute_resources` / `infrastructure_resources` / `load_balancers`.

**Q5: Drop the raw idea's `notes` column — use the standard `description` + `tags` envelope instead?**
**Answer:** Confirmed. Drop `notes` from all 4 relationships. Use existing `description` (single-line `cellType: 'text'`) + `tags` (`cellType: 'tags'`) only. Matches the envelope used by every other relationship table in the codebase (no relationship has both `description` and `notes`).

**Q6: Picklists — confirm the 4 new option arrays match the raw idea verbatim, and reuse spec 4's existing `exposureOptions` + `protocolOptions` for Rel 4?**
**Answer:** Confirmed:
- New arrays:
  - `deploymentRoleOptions = ['PRIMARY', 'SECONDARY', 'WORKER', 'BATCH', 'ADMIN', 'OTHER']`
  - `hostingRoleOptions = ['PRIMARY', 'REPLICA', 'CACHE', 'ARCHIVE', 'ANALYTICS', 'OTHER']`
  - `dependencyTypeOptions = ['READS_FROM', 'WRITES_TO', 'PUBLISHES_TO', 'SUBSCRIBES_TO', 'USES', 'STORES_IN', 'RETRIEVES_FROM', 'OTHER']`
  - `accessModeOptions = ['READ', 'WRITE', 'READ_WRITE', 'EXECUTE', 'ADMIN', 'OTHER']`
- Reuse from spec 4's `defaults.ts`:
  - `exposureOptions` (already exists; values: `['PUBLIC', 'PRIVATE', 'INTERNAL', 'OTHER']`) — used on Rel 4's `exposure` column.
  - `protocolOptions` (already exists; values: `['HTTP', 'HTTPS', 'TCP', 'UDP', 'TLS', 'GRPC', 'OTHER']`) — used on Rel 4's `protocol` column.

**Q7: `environment_id` nullability on the 4 cross-domain relationships — `NOT NULL` like spec 1's Infra-internal relationships, or `NULL`?**
**Answer:** Confirmed `NULL` (nullable) on all 4 cross-domain relationships. Differs from spec 1's `NOT NULL` choice on the Infra-internal relationships. Rationale: cross-domain relationships often describe a logical link that may not be tied to a specific environment in V1 (e.g. "Application uses S3 bucket" without specifying whether it's the prod or dev account). Backend column: `environment_id TEXT NULL` with FK to `environments(id)`, no `NOT NULL` constraint.

**Q8: Diagram palette extension — add palette sections to all relevant diagram types now, or defer to a later spec?**
**Answer:** Now. Update `DIAGRAM_TYPE_PALETTE_RULES`:
- Infrastructure diagrams: all 4 cross-domain relationships available.
- Application diagrams: Rels 1, 3, 4 available.
- Data diagrams: Rel 2 available.

No deferral. Palette sections in `paletteData.ts` get 4 new `relationshipSections` entries.

**Q9: Distinct edge styles per relationship, plus default edge labels?**
**Answer:** Confirmed distinct edge styles per relationship (simple implementation — distinct stroke colour and/or dash pattern; spec-writer chooses concrete styling). Default edge labels:
- Rel 1: `deployment_role` (e.g. "Primary", "Worker")
- Rel 2: `hosting_role` (e.g. "Primary", "Replica")
- Rel 3: `dependency_type` (primary) with `access_mode` as secondary if present (e.g. "Reads From", "Read")
- Rel 4: `protocol` + `target_port` (e.g. "HTTPS 443") — "target_port" is the column name used here; reuses listener-style port semantics.

**Q10: Inspector V1 scope — minimal edge arms (description + tags only) or full attribute editors?**
**Answer:** Minimal. 4 new edge arms in `SelectionInspector.tsx`, each exposing `description` + `tags` only. Mirrors spec 5's `SelectionInspector` minimum for Infra-internal edges. Full attribute editing remains via the relationship grid tabs.

**Q11: Test scope — what tests should this spec write?**
**Answer:**
- **Backend**: one test class covering round-trip save/load + delete-and-replace + project/architecture scoping for the 4 new relationships. Modelled on the existing Infra-internal relationship round-trip tests from spec 2.
- **Frontend**: one Vitest config test (`infrastructureCrossDomainConfig.test.ts`) asserting the 4 new `gridConfigs` entries exist, the 4 new `RELATIONSHIP_DEFINITIONS` entries are wired, the 4 new `relationshipTabToType` keys are present, and `DOMAIN_TO_RELATIONSHIP_TYPES` for Application + Data + Infrastructure is updated.
- **No** renderer tests, **no** component tests, **no** picker-cell tests, **no** diagram-interaction tests in this spec.

**Q12: What deferrals to spec 7 — and what stays in spec 6?**
**Answer:** Defer to spec 7 only:
- Deeper Behavioural / UI domain links to Infrastructure (Behavioural event-to-Infra, UI hosting/CDN beyond what Rel 3 covers).
- Terraform / IaC import / export / generation.
- Discovery-service inference of cross-domain relationships from runtime data.
- Automatic relationship creation from observed traffic / deployment metadata.
- Full diagram interaction tests.

Keep in spec 6:
- All 4 cross-domain relationships (full backend + frontend types + grid + diagram + inspector).

### Inferred Decisions (all 12 accepted)

These were inferred from the codebase grounding and accepted by the user without override:

1. **Liquibase changeset numbering** — new cross-domain changesets start at `114-` (last applied is `113-load-balancer-resource-routes.sql`). Files: `114-application-compute-deployments.sql`, `115-data-entity-data-store-hostings.sql`, `116-application-infrastructure-resource-uses.sql`, `117-application-load-balancer-exposures.sql`.
2. **DTO conventions** — Java records, `@JsonProperty("snake_case")`, IDs as `String`, booleans as nullable `Boolean`, `confidence DECIMAL(4,3)` no DB CHECK, `tags TEXT`, `model_file_id` server-side only. Matches spec 1-2 conventions.
3. **JPA entities follow spec 1 pattern** — `@Entity`, `@Table(name = "...")`, `@Id String id`, `@Column(name = "...")`, foreign keys mapped as `@ManyToOne(fetch = FetchType.LAZY)` where appropriate or as raw `String` columns following the existing pattern in spec 1 / spec 2.
4. **Repositories** — Spring Data JPA `JpaRepository<T, String>` with `findByModelFileId(String modelFileId)` plus any `deleteByModelFileId` semantics needed for delete-and-replace. Matches spec 2 precedent.
5. **`EntityMapper` arms** — 4 new `toDto` / `toEntity` arms in the existing `EntityMapper`. Matches spec 2 precedent.
6. **`MetaModelRelationshipsDto` extension** — append 4 new `List<...Dto>` fields with `@JsonProperty` snake_case names matching the table names.
7. **`ModelService` save/load/delete-and-replace** — append 4 new arms in each of the save, load, and delete-and-replace pipelines. Pattern strictly mirrors the 3 Infra-internal relationships landed in spec 2.
8. **`ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` Block B (DEPENDENT)** — append the 4 new table names. They depend on Application/Data tables AND Infrastructure tables, so they sit at the **end** of Block B after all 16 Infra tables and after the Application/Data tables they reference. Order: `application_compute_deployments`, `data_entity_data_store_hostings`, `application_infrastructure_resource_uses`, `application_load_balancer_exposures`.
9. **`ArchitectureElementInventoryService.DISPLAY_NAME_FALLBACK_TABLES` + Infrastructure domain entry** — relationships sit under the **Infrastructure** domain entry in `TABLES_BY_DOMAIN` because they are listed once in the inventory and the existing convention places cross-domain relationships under the new domain that introduces them. (Their visibility per domain tab is derivation-based via `getRelationshipsForDomain`; the inventory entry is just for inventory listing/cleanup ordering.)
10. **Snake_case field names everywhere** — all DTO `@JsonProperty` keys, TypeScript interface fields, and grid `field` keys use snake_case matching the DB column names exactly.
11. **`RELATIONSHIP_TAB_ORDER` extension** — append 4 new entries after the spec 3 entries (`Resource ↔ Subnet`, `Deployment Unit ↔ Compute`, `Load Balancer Routes`). Order follows business intuition: `App ↔ Compute`, `Data Entity ↔ Data Store`, `App ↔ Infrastructure Resource`, `App ↔ Load Balancer`.
12. **`DOMAIN_TO_RELATIONSHIP_TYPES`** — Application gets Rels 1, 3, 4; Data gets Rel 2; Infrastructure gets all 4. Behavioural and UI are not extended (per Q12 — these stay deferred to spec 7).

### Existing Code to Reference

The grounding notes identified the following reference points:

**Backend:**
- **Spec 1 changesets** at `architecture-model-service/src/main/resources/db/changelog/`(`098-` through `113-`) — Liquibase format pattern for the 4 new `114-`-`117-` changesets.
- **Spec 2 DTOs** in `MetaModelRelationshipsDto` (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`) — record shape pattern + `@JsonProperty` conventions.
- **Spec 2 JPA entities** for the 3 Infra-internal relationships — entity shape, FK mapping, `@Column(name=...)` precedent.
- **Spec 2 repositories** — `findByModelFileId` + `deleteByModelFileId` pattern.
- **Spec 2 `EntityMapper` arms** for the 3 Infra relationships — direct template for the 4 new arms.
- **Spec 2 `ModelService` save/load/delete-and-replace** for the 3 Infra relationships — direct template.
- **`ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` Block B** — current end-of-block has the 3 Infra-internal relationships; append 4 new tables after them.
- **`ApplicationPointEntity`** — hybrid `target_type`/`target_ref_id` pattern. Spec 6 reuses `application_points` source-side without changes.
- **`DataEntityPointEntity`** — typed-FK + discriminator pattern. Spec 6 reuses `data_entity_points` source-side without changes.

**Frontend:**
- **Spec 3 `MetaModelRelationships` type** at `frontend/src/types/model.ts` — extend with 4 new array fields.
- **Spec 3 `RelationshipType` + `AnyRelationship` unions** — extend with 4 new entries.
- **Spec 3 `RELATIONSHIP_DEFINITIONS`** at `frontend/src/config/relationshipDefinitions.ts` — append 4 new entries with `endpointEntityTypes` mixing Application/Data and Infrastructure entity types.
- **Spec 3 `normalizeModelFromApi`** at `frontend/src/api/modelSerialization.ts` — append 4 new `??=` backfill lines.
- **Spec 3 `emptyModel`** at `frontend/src/config/defaults.ts` — append 4 new `[]` lines.
- **Spec 3 `DOMAIN_TO_RELATIONSHIP_TYPES`** at `frontend/src/utils/contextPickerDomainMappings.ts` — extend Application + Data + Infrastructure entries.
- **Spec 4 `gridConfigs`** at `frontend/src/config/gridConfigs.ts` — append 4 new grid configs and 4 new `relationshipTabToType` + `relationshipTabNames` entries.
- **Spec 4 `defaults.ts`** picklist-array conventions (`exposureOptions`, `protocolOptions`, etc.) — pattern for the 4 new picklist arrays. **Reuse** existing `exposureOptions` and `protocolOptions` for Rel 4 — do NOT redeclare.
- **Spec 4 `application_point_picker` cellType + `data_entity_point_picker` cellType** — used by the new grid configs without modification.
- **Spec 5 `RELATIONSHIP_EDGE_TYPES`** at `frontend/src/types/model.ts` (or wherever the constants live) — append 4 new constants.
- **Spec 5 `paletteData.ts`** at `frontend/src/utils/paletteData.ts` — append 4 new `relationshipSections` entries; update `domainToPaletteSections` for Application + Data + Infrastructure; update `DIAGRAM_TYPE_PALETTE_RULES` for the 3 affected diagram types.
- **Spec 5 `relationshipUtils.ts`** at `frontend/src/utils/relationshipUtils.ts` — append 4 new `createRelationshipEdge` arms and 4 new `getRelationshipEligibility` arms.
- **Spec 5 `rendering.ts`** edge defaults — append 4 new edge default entries.
- **Spec 5 `SelectionInspector.tsx`** edge arms — append 4 new minimal arms (description + tags only).
- **Spec 5 Vitest config test pattern** — model the new `infrastructureCrossDomainConfig.test.ts` after it.

### Follow-up Questions

No follow-up questions were required. The user provided concrete answers on all 12 open questions and accepted all 12 inferred decisions.

## Visual Assets

### Files Provided

Bash check on `agent-os/specs/2026-05-05-infrastructure-cross-domain-integration/planning/visuals/` returned no image/PDF files.

No visual assets provided.

### Visual Insights

N/A — full-stack relationship spec, no UI artefacts. Reference UX is the existing relationship grid tabs and existing diagram palette/edge rendering for the 3 Infra-internal relationships landed in spec 5.

## Requirements Summary

### Functional Requirements

The system must:

1. **Persist** the 4 cross-domain relationships through full-model save/load/delete-and-replace, scoped by `projectId` and `architectureId`, using the existing `ModelService` pipeline.
2. **Round-trip** every documented column on each of the 4 relationships through DTO ↔ JPA ↔ DB without loss.
3. **Expose** the 4 relationships in the relationship-grid UI under the Application, Data, and Infrastructure domain tabs (visibility derived from `endpointEntityTypes` per the existing `getRelationshipsForDomain` derivation).
4. **Render** the 4 relationships as edges on Infrastructure diagrams (and on Application/Data diagrams where relevant) with distinct styling per relationship type and sensible default labels (Q9).
5. **Allow** users to inspect a selected cross-domain edge and edit its `description` + `tags` via `SelectionInspector` (Q10).
6. **Backfill** older saved models without these relationship arrays via 4 new `??=` lines in `normalizeModelFromApi`.
7. **Preserve** all existing Business / Application / Data / Behavioural / UI / Infrastructure-V1 behaviour. No edits to existing relationship grids, existing palette sections (other than the documented append-only updates), or existing inspector arms.

### Per-Relationship Column Shapes

All four relationships share an envelope: `id` (PK), `model_file_id` (server-side only), `description` (TEXT NULL), `tags` (TEXT NULL — JSON-encoded array), plus the type-specific columns below. `environment_id` is `TEXT NULL` (nullable) on all 4 (Q7) with FK to `environments(id)`. `evidence_source` is `TEXT NULL`. `confidence` is `DECIMAL(4,3) NULL` (no DB CHECK; matches spec 1 precedent).

#### Relationship 1: `application_compute_deployments` (UI: "App ↔ Compute")

| column | type | nullability | notes |
|---|---|---|---|
| `id` | TEXT | NOT NULL | PK |
| `model_file_id` | TEXT | NOT NULL | server-side only; FK |
| `application_point_id` | TEXT | NOT NULL | FK -> `application_points(id)` |
| `compute_resource_id` | TEXT | NOT NULL | FK -> `compute_resources(id)` |
| `deployment_unit_id` | TEXT | NULL | FK -> `deployment_units(id)`; optional drill-down |
| `environment_id` | TEXT | NULL | FK -> `environments(id)` |
| `deployment_role` | TEXT | NULL | enum-shaped freetext; UI dropdown via `deploymentRoleOptions` |
| `runtime_name` | TEXT | NULL | |
| `runtime_version` | TEXT | NULL | |
| `evidence_source` | TEXT | NULL | |
| `confidence` | DECIMAL(4,3) | NULL | no DB CHECK |
| `description` | TEXT | NULL | |
| `tags` | TEXT | NULL | JSON-encoded array |

Grid columns (UI): `application_point_id` (cellType `application_point_picker`, required), `compute_resource_id` (cellType `fk_typeahead`, fkTarget `compute_resources`, required), `deployment_unit_id` (cellType `fk_typeahead`, fkTarget `deployment_units`, optional), `environment_id` (cellType `fk_typeahead`, fkTarget `environments`, optional), `deployment_role` (cellType `dropdown`, options `deploymentRoleOptions`, optional), `runtime_name` (text), `runtime_version` (text), `evidence_source` (text), `confidence` (text — numeric-as-text per spec 4 precedent), `description` (text), `tags` (tags).

#### Relationship 2: `data_entity_data_store_hostings` (UI: "Data Entity ↔ Data Store")

| column | type | nullability | notes |
|---|---|---|---|
| `id` | TEXT | NOT NULL | PK |
| `model_file_id` | TEXT | NOT NULL | server-side only; FK |
| `data_entity_point_id` | TEXT | NOT NULL | FK -> `data_entity_points(id)` |
| `data_store_instance_id` | TEXT | NOT NULL | FK -> `data_store_instances(id)` |
| `environment_id` | TEXT | NULL | FK -> `environments(id)` |
| `database_name` | TEXT | NULL | |
| `schema_name` | TEXT | NULL | |
| `table_or_collection_name` | TEXT | NULL | |
| `hosting_role` | TEXT | NULL | enum-shaped freetext; UI dropdown via `hostingRoleOptions` |
| `evidence_source` | TEXT | NULL | |
| `confidence` | DECIMAL(4,3) | NULL | no DB CHECK |
| `description` | TEXT | NULL | |
| `tags` | TEXT | NULL | JSON-encoded array |

Grid columns (UI): `data_entity_point_id` (cellType `data_entity_point_picker`, required), `data_store_instance_id` (cellType `fk_typeahead`, fkTarget `data_store_instances`, required), `environment_id` (cellType `fk_typeahead`, fkTarget `environments`, optional), `database_name` (text), `schema_name` (text), `table_or_collection_name` (text), `hosting_role` (cellType `dropdown`, options `hostingRoleOptions`, optional), `evidence_source` (text), `confidence` (text), `description` (text), `tags` (tags).

#### Relationship 3: `application_infrastructure_resource_uses` (UI: "App ↔ Infrastructure Resource")

| column | type | nullability | notes |
|---|---|---|---|
| `id` | TEXT | NOT NULL | PK |
| `model_file_id` | TEXT | NOT NULL | server-side only; FK |
| `application_point_id` | TEXT | NOT NULL | FK -> `application_points(id)` |
| `infrastructure_resource_id` | TEXT | NOT NULL | FK -> `infrastructure_resources(id)` |
| `environment_id` | TEXT | NULL | FK -> `environments(id)` |
| `dependency_type` | TEXT | NULL | enum-shaped freetext; UI dropdown via `dependencyTypeOptions` |
| `protocol` | TEXT | NULL | UI dropdown via reused `protocolOptions` |
| `endpoint_or_topic` | TEXT | NULL | |
| `access_mode` | TEXT | NULL | enum-shaped freetext; UI dropdown via `accessModeOptions` |
| `evidence_source` | TEXT | NULL | |
| `confidence` | DECIMAL(4,3) | NULL | no DB CHECK |
| `description` | TEXT | NULL | |
| `tags` | TEXT | NULL | JSON-encoded array |

Grid columns (UI): `application_point_id` (cellType `application_point_picker`, required), `infrastructure_resource_id` (cellType `fk_typeahead`, fkTarget `infrastructure_resources`, required), `environment_id` (cellType `fk_typeahead`, fkTarget `environments`, optional), `dependency_type` (cellType `dropdown`, options `dependencyTypeOptions`, optional), `protocol` (cellType `dropdown`, options `protocolOptions` reused from spec 4, optional), `endpoint_or_topic` (text), `access_mode` (cellType `dropdown`, options `accessModeOptions`, optional), `evidence_source` (text), `confidence` (text), `description` (text), `tags` (tags).

#### Relationship 4: `application_load_balancer_exposures` (UI: "App ↔ Load Balancer")

| column | type | nullability | notes |
|---|---|---|---|
| `id` | TEXT | NOT NULL | PK |
| `model_file_id` | TEXT | NOT NULL | server-side only; FK |
| `application_point_id` | TEXT | NOT NULL | FK -> `application_points(id)` |
| `load_balancer_id` | TEXT | NOT NULL | FK -> `load_balancers(id)` |
| `listener_id` | TEXT | NULL | FK -> `listeners(id)`; optional drill-down |
| `environment_id` | TEXT | NULL | FK -> `environments(id)` |
| `host_name` | TEXT | NULL | |
| `path_pattern` | TEXT | NULL | |
| `protocol` | TEXT | NULL | UI dropdown via reused `protocolOptions` |
| `target_port` | TEXT | NULL | numeric-as-text per spec 4 precedent |
| `exposure` | TEXT | NULL | UI dropdown via reused `exposureOptions` |
| `evidence_source` | TEXT | NULL | |
| `confidence` | DECIMAL(4,3) | NULL | no DB CHECK |
| `description` | TEXT | NULL | |
| `tags` | TEXT | NULL | JSON-encoded array |

Grid columns (UI): `application_point_id` (cellType `application_point_picker`, required), `load_balancer_id` (cellType `fk_typeahead`, fkTarget `load_balancers`, required), `listener_id` (cellType `fk_typeahead`, fkTarget `listeners`, optional), `environment_id` (cellType `fk_typeahead`, fkTarget `environments`, optional), `host_name` (text), `path_pattern` (text), `protocol` (cellType `dropdown`, options `protocolOptions` reused, optional), `target_port` (text), `exposure` (cellType `dropdown`, options `exposureOptions` reused, optional), `evidence_source` (text), `confidence` (text), `description` (text), `tags` (tags).

### Picklist Option Arrays

Four **new** arrays to add in `frontend/src/config/defaults.ts`:

```ts
// Application -> Compute (Rel 1)
export const deploymentRoleOptions = ['PRIMARY', 'SECONDARY', 'WORKER', 'BATCH', 'ADMIN', 'OTHER'];

// Data Entity -> Data Store Instance (Rel 2)
export const hostingRoleOptions = ['PRIMARY', 'REPLICA', 'CACHE', 'ARCHIVE', 'ANALYTICS', 'OTHER'];

// Application -> Infrastructure Resource (Rel 3)
export const dependencyTypeOptions = ['READS_FROM', 'WRITES_TO', 'PUBLISHES_TO', 'SUBSCRIBES_TO', 'USES', 'STORES_IN', 'RETRIEVES_FROM', 'OTHER'];
export const accessModeOptions = ['READ', 'WRITE', 'READ_WRITE', 'EXECUTE', 'ADMIN', 'OTHER'];
```

**Reused** from spec 4's `defaults.ts` (do NOT redeclare):
- `exposureOptions = ['PUBLIC', 'PRIVATE', 'INTERNAL', 'OTHER']` — used on Rel 4's `exposure` column.
- `protocolOptions = ['HTTP', 'HTTPS', 'TCP', 'UDP', 'TLS', 'GRPC', 'OTHER']` — used on Rel 3's and Rel 4's `protocol` columns.

### Spec 4 Picklist Verification Pass

Cross-checked the two reused picklists against spec 4's `requirements.md` (lines 521 + 524):

| Picklist | Spec 4 declared values | This spec's reuse | Status |
|---|---|---|---|
| `exposureOptions` | `['PUBLIC', 'PRIVATE', 'INTERNAL', 'OTHER']` | identical reference | Match |
| `protocolOptions` | `['HTTP', 'HTTPS', 'TCP', 'UDP', 'TLS', 'GRPC', 'OTHER']` | identical reference | Match |

**No discrepancies.** Both arrays exist verbatim in spec 4's `defaults.ts` extension and cover the values needed for the new Rel 3 (`protocol`) and Rel 4 (`protocol`, `exposure`) columns. Spec 4 already noted the LB-route `protocol` reuse as a "judgement call"; the same rationale applies here for cross-domain Rels 3/4 — the practical value space is identical, and `OTHER` is the freetext escape hatch.

The 4 new arrays (`deploymentRoleOptions`, `hostingRoleOptions`, `dependencyTypeOptions`, `accessModeOptions`) come from this spec's raw idea verbatim — no upstream spec defines them.

### Liquibase Changeset Numbering

| # | Changeset | Table |
|---|---|---|
| 114 | `114-application-compute-deployments.sql` | `application_compute_deployments` |
| 115 | `115-data-entity-data-store-hostings.sql` | `data_entity_data_store_hostings` |
| 116 | `116-application-infrastructure-resource-uses.sql` | `application_infrastructure_resource_uses` |
| 117 | `117-application-load-balancer-exposures.sql` | `application_load_balancer_exposures` |

Last applied changeset on `master` is `113-load-balancer-resource-routes.sql` (per grounding). New changesets MUST start at `114-` and MUST NOT amend any prior changeset (per `feedback_liquibase_immutable_changesets.md`).

### File Touch Summary

#### Backend

| # | File | Change |
|---|---|---|
| 1 | `architecture-model-service/src/main/resources/db/changelog/114-application-compute-deployments.sql` | **NEW** Liquibase changeset for Rel 1 table per the column shape above. |
| 2 | `architecture-model-service/src/main/resources/db/changelog/115-data-entity-data-store-hostings.sql` | **NEW** Liquibase changeset for Rel 2. |
| 3 | `architecture-model-service/src/main/resources/db/changelog/116-application-infrastructure-resource-uses.sql` | **NEW** Liquibase changeset for Rel 3. |
| 4 | `architecture-model-service/src/main/resources/db/changelog/117-application-load-balancer-exposures.sql` | **NEW** Liquibase changeset for Rel 4. |
| 5 | `architecture-model-service/src/main/java/.../entities/ApplicationComputeDeploymentEntity.java` | **NEW** JPA entity for Rel 1. |
| 6 | `architecture-model-service/src/main/java/.../entities/DataEntityDataStoreHostingEntity.java` | **NEW** JPA entity for Rel 2. |
| 7 | `architecture-model-service/src/main/java/.../entities/ApplicationInfrastructureResourceUseEntity.java` | **NEW** JPA entity for Rel 3. |
| 8 | `architecture-model-service/src/main/java/.../entities/ApplicationLoadBalancerExposureEntity.java` | **NEW** JPA entity for Rel 4. |
| 9 | `architecture-model-service/src/main/java/.../dto/ApplicationComputeDeploymentDto.java` | **NEW** DTO record for Rel 1. |
| 10 | `architecture-model-service/src/main/java/.../dto/DataEntityDataStoreHostingDto.java` | **NEW** DTO record for Rel 2. |
| 11 | `architecture-model-service/src/main/java/.../dto/ApplicationInfrastructureResourceUseDto.java` | **NEW** DTO record for Rel 3. |
| 12 | `architecture-model-service/src/main/java/.../dto/ApplicationLoadBalancerExposureDto.java` | **NEW** DTO record for Rel 4. |
| 13 | `architecture-model-service/src/main/java/.../repositories/ApplicationComputeDeploymentRepository.java` | **NEW** Spring Data JPA repository for Rel 1. |
| 14 | `architecture-model-service/src/main/java/.../repositories/DataEntityDataStoreHostingRepository.java` | **NEW** Spring Data JPA repository for Rel 2. |
| 15 | `architecture-model-service/src/main/java/.../repositories/ApplicationInfrastructureResourceUseRepository.java` | **NEW** Spring Data JPA repository for Rel 3. |
| 16 | `architecture-model-service/src/main/java/.../repositories/ApplicationLoadBalancerExposureRepository.java` | **NEW** Spring Data JPA repository for Rel 4. |
| 17 | `architecture-model-service/src/main/java/.../service/EntityMapper.java` | Append 4 new `toDto` / `toEntity` arms (one per relationship). |
| 18 | `architecture-model-service/src/main/java/.../dto/MetaModelRelationshipsDto.java` | Append 4 new `List<...Dto>` fields with `@JsonProperty` snake_case names matching the table names. |
| 19 | `architecture-model-service/src/main/java/.../service/ModelService.java` | Append 4 new arms in save, load, and delete-and-replace pipelines (mirrors spec 2 patterns for the 3 Infra-internal relationships). |
| 20 | `architecture-model-service/src/main/java/.../service/ArchitectureCloneService.java` | Append 4 new table names to `IN_SCOPE_TABLES_IN_ORDER` Block B (DEPENDENT-rows section) at the end, after the 16 spec 1-2 Infra tables. Order: `application_compute_deployments`, `data_entity_data_store_hostings`, `application_infrastructure_resource_uses`, `application_load_balancer_exposures`. |
| 21 | `architecture-model-service/src/main/java/.../service/ArchitectureElementInventoryService.java` | Add 4 new entries to `DISPLAY_NAME_FALLBACK_TABLES`; extend the **Infrastructure** entry in `TABLES_BY_DOMAIN` with the 4 new relationship table names (relationships sit once under Infrastructure here; per-domain tab visibility is derivation-based). |
| 22 | `architecture-model-service/src/test/java/.../service/InfrastructureCrossDomainRelationshipsRoundTripTest.java` | **NEW** one test class covering save/load round-trip + delete-and-replace + projectId/architectureId scoping for all 4 relationships. |

#### Frontend

| # | File | Change |
|---|---|---|
| 23 | `frontend/src/types/model.ts` | Add 4 new TypeScript interface types (one per relationship); extend `MetaModelRelationships` with 4 new array fields; extend `RelationshipType` and `AnyRelationship` unions; add 4 new `RELATIONSHIP_EDGE_TYPES` constants. |
| 24 | `frontend/src/config/relationshipDefinitions.ts` | Append 4 new `RELATIONSHIP_DEFINITIONS` entries with `endpointEntityTypes` mixing Application/Data and Infrastructure entity types; append 4 new entries to `RELATIONSHIP_TAB_ORDER` (order per inferred decision 11). |
| 25 | `frontend/src/utils/contextPickerDomainMappings.ts` | Update `DOMAIN_TO_RELATIONSHIP_TYPES`: Application gets Rels 1, 3, 4; Data gets Rel 2; Infrastructure gets all 4. |
| 26 | `frontend/src/config/gridConfigs.ts` | Append 4 new grid configs (one per relationship); append 4 new keys to `relationshipTabToType`; append 4 new names to `relationshipTabNames`. |
| 27 | `frontend/src/config/defaults.ts` | Append 4 new picklist option arrays (`deploymentRoleOptions`, `hostingRoleOptions`, `dependencyTypeOptions`, `accessModeOptions`); append 4 new `[]` entries to `emptyModel.relationships` (one per new relationship array). **Reuse** existing `exposureOptions` and `protocolOptions` — do NOT redeclare. |
| 28 | `frontend/src/utils/paletteData.ts` | Append 4 new `relationshipSections` entries; update `domainToPaletteSections` for Application + Data + Infrastructure; update `DIAGRAM_TYPE_PALETTE_RULES` for Application diagrams (Rels 1, 3, 4), Data diagrams (Rel 2), Infrastructure diagrams (all 4). |
| 29 | `frontend/src/api/modelSerialization.ts` | Append 4 new `??=` backfill lines in `normalizeModelFromApi` for the 4 new relationship arrays. |
| 30 | `frontend/src/utils/relationshipUtils.ts` | Append 4 new arms in `createRelationshipEdge` and `getRelationshipEligibility`. |
| 31 | `frontend/src/utils/rendering.ts` | Append 4 new edge default entries (distinct stroke colour and/or dash pattern per relationship, per Q9). |
| 32 | `frontend/src/components/SelectionInspector/SelectionInspector.tsx` | Append 4 new minimal edge arms exposing `description` + `tags` only (per Q10). |
| 33 | `frontend/src/config/__tests__/infrastructureCrossDomainConfig.test.ts` | **NEW** Vitest config test asserting (a) 4 new `gridConfigs` entries exist, (b) 4 new `RELATIONSHIP_DEFINITIONS` entries are wired, (c) 4 new keys in `relationshipTabToType`, (d) `DOMAIN_TO_RELATIONSHIP_TYPES` for Application + Data + Infrastructure includes the appropriate new entries. |

**Files NOT to touch** (already done by prior specs or out of scope):
- `frontend/src/types/architectureDomain.ts` — done by spec 3.
- `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` — reused without modification.
- `frontend/src/components/Grid/DataEntityPointPickerCell.tsx` — reused without modification.
- `frontend/src/components/Grid/InfrastructurePointPickerCell.tsx` — not used by spec 6 (cross-domain Infra targets are concrete FKs).
- `frontend/src/utils/applicationPointDerivation.ts` / `infrastructurePointDerivation.ts` — not modified.
- Existing 16 Infra `gridConfigs` entries — not modified.

### Reusability Opportunities

- **Spec 2's 3 Infra-internal relationships** (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`) — direct template for the entire backend stack: changeset shape, JPA entity, DTO record, repository, EntityMapper arm, ModelService save/load/delete-and-replace arm.
- **Spec 4's `gridConfigs` entries for the 3 Infra-internal relationships** — direct template for the 4 new grid configs.
- **Spec 5's 3 Infra-internal `RELATIONSHIP_EDGE_TYPES` + palette sections + edge utils + inspector arms** — direct template for the 4 new sets of frontend wiring.
- **Existing `application_point_picker` cellType** (built in spec 4 ecosystem; existed pre-Infra) — used unchanged for source side of Rels 1, 3, 4.
- **Existing `data_entity_point_picker` cellType** — used unchanged for source side of Rel 2.
- **Existing `exposureOptions` and `protocolOptions`** in `defaults.ts` — reused for Rel 4 (and Rel 3's `protocol`).
- **Existing `getRelationshipsForDomain` derivation** — automatically surfaces each new relationship under both its Application/Data source domain AND the Infrastructure target domain, no new visibility logic required.

### Scope Boundaries

**In Scope:**
- 4 new cross-domain relationships (full backend + frontend types + grid + diagram + inspector).
- Liquibase changesets `114-` through `117-`.
- 4 new picklist option arrays in `defaults.ts`.
- Reuse of existing `exposureOptions` and `protocolOptions`.
- Edge rendering with distinct styles per relationship.
- Minimal `SelectionInspector` arms (description + tags only).
- Backend round-trip / delete-and-replace / scoping test (one class).
- Frontend Vitest config test (one file).
- Palette extension for Infrastructure, Application, and Data diagrams.

**Out of Scope** (raw idea exclusions plus Q12 spec-7 deferrals):
- Terraform import / export / generation (raw idea).
- Discovery-service integration (raw idea).
- Gateway changes (raw idea).
- MCP tools (raw idea).
- Security group / firewall / IAM modelling (raw idea).
- Detailed Traffic Flow modelling (raw idea).
- Data lineage modelling (raw idea).
- Behavioural event-to-infrastructure mapping (raw idea + Q12).
- UI hosting / CDN beyond what Rel 3 covers (raw idea + Q12).
- Automatic inference of relationships from code, Terraform, or cloud inventory (raw idea + Q12).
- Live cloud provider integration (raw idea).
- Cost / observability / compliance integrations (raw idea).
- **Deferred to spec 7** (per Q12):
  - Deeper Behavioural / UI domain links to Infrastructure.
  - Terraform / IaC metadata.
  - Discovery inference of cross-domain relationships.
  - Automatic relationship creation from runtime telemetry.
  - Full diagram interaction tests.
- **No** renderer tests, **no** component tests, **no** picker-cell tests in this spec (Q11).
- **No** new Infrastructure entities (per raw idea — relationships only).
- **No** changes to existing 16 `gridConfigs` entries or existing 3 Infra-internal relationships.
- **No** XLSX import/export wiring for the new relationships.
- **No** MetaModelSummary extension.

### Technical Considerations

- **Changeset numbering is strict** — new changesets start at `114-`. Per `feedback_liquibase_immutable_changesets.md`, do not edit any applied changeset.
- **Endpoint-side patterns are locked** — Rels 1, 3, 4 use `application_point_id` (existing hybrid pattern); Rel 2 uses `data_entity_point_id` (existing typed-FK pattern). No new point types introduced.
- **Infrastructure-side targets are concrete FKs** — no `InfrastructurePoint` polymorphic picker for cross-domain relationships. Each relationship has a single primary Infra target type (Compute Resource / Data Store Instance / Infrastructure Resource / Load Balancer).
- **`environment_id` is nullable** on all 4 cross-domain relationships (Q7) — differs from spec 1's `NOT NULL` choice on Infra-internal relationships.
- **`description` + `tags` only** — `notes` is dropped (Q5). Matches the standard envelope used elsewhere in the codebase.
- **Distinct edge styles per relationship** (Q9) — simple visual differentiation; spec-writer chooses concrete colours/dash patterns.
- **Default edge labels** (Q9) — Rel 1 → `deployment_role`; Rel 2 → `hosting_role`; Rel 3 → `dependency_type` with optional secondary `access_mode`; Rel 4 → `protocol target_port` (e.g. "HTTPS 443").
- **`SelectionInspector` minimum** (Q10) — description + tags only. Full attribute editing remains via the relationship grid tabs.
- **Numeric-as-text** — `confidence` and `target_port` use `cellType: 'text'` in grids (no `'number'` cellType in the codebase; matches spec 4 precedent).
- **`getRelationshipsForDomain` derivation handles cross-domain visibility automatically** — relationships appear under each domain whose entity type appears in `endpointEntityTypes`. No new visibility logic required.
- **Backward compatibility** — older saved models without these arrays load cleanly via 4 new `??=` lines in `normalizeModelFromApi`. Existing Business / Application / Data / Behavioural / UI / Infrastructure-V1 behaviour remains unchanged.

## Acceptance Criteria

(Copied from raw idea; preserved verbatim.)

- Backend supports full-model save/load for the cross-domain relationships in scope.
- Frontend types and default model state include the cross-domain relationships in scope.
- Cross-domain relationship tables or equivalent relationship editing UI are available.
- Users can link an Application concept to a Compute Resource.
- Users can optionally link a Deployment Unit to the Application-to-Compute relationship.
- Users can link a Data concept to a Data Store Instance.
- Users can link an Application concept to an Infrastructure Resource.
- Users can link an Application concept to a Load Balancer / Ingress or Listener / Exposure.
- Cross-domain links can be viewed from the relevant Infrastructure-side records.
- Infrastructure diagrams can optionally display the cross-domain links without requiring them.
- Existing Business, Application, Data, Behavioural, UI, and Infrastructure V1 behaviours remain unchanged.
- No Terraform, Discovery, Gateway, MCP, security/IAM/firewall, or live cloud integration is included in this spec.

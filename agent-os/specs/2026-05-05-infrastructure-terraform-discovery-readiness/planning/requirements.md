# Spec Requirements: Infrastructure Terraform & Discovery Readiness

## Initial Description

Add Terraform and discovery-readiness support for the Infrastructure Architecture domain **without** implementing full Terraform import, cloud inventory import, or automated provisioning. This is **spec 7 of 7** in the Infrastructure delivery sequence and the finale of the V1 Infrastructure work. Specs 1-6 landed:

- **Spec 1** — backend Infra schema (12 entity tables, `infrastructure_points` polymorphic supertype, 3 Infra-internal relationships). Liquibase changesets `098-` through `113-` applied.
- **Spec 2** — backend API/persistence integration (`MetaModelEntitiesDto` 13 new lists, `MetaModelRelationshipsDto` 3 new lists, `ArchitectureCloneService` Block A/B updates, `ArchitectureElementInventoryService` Infrastructure entry).
- **Spec 3** — frontend types/model integration (`MetaModelEntities` + `MetaModelRelationships` extensions, `EntityType` + `AnyEntity` + `RelationshipType` + `AnyRelationship` unions, `RELATIONSHIP_DEFINITIONS`, `ENTITY_TYPE_TO_DOMAIN`, `emptyModel`, `normalizeModelFromApi` backfill).
- **Spec 4** — frontend Infrastructure tables UI (16 `gridConfigs` entries, 23 picklist option arrays in `defaults.ts`, `'infrastructure_point_picker'` cellType + cell + derivation helper).
- **Spec 5** — frontend Infrastructure diagram support (`RELATIONSHIP_EDGE_TYPES` for the 3 Infra-internal relationships, palette sections, `createRelationshipEdge`, `getEdgeColor`, `getRelationshipEdgeDefaults`, `isRelationshipRowEnabled`, `SelectionInspector` minimal arms).
- **Spec 6** — backend + frontend cross-domain relationships (4 new tables: `application_compute_deployments`, `data_entity_data_store_hostings`, `application_infrastructure_resource_uses`, `application_load_balancer_exposures`; Liquibase `114-` through `117-`).

This spec adds the **Terraform & discovery readiness** layer:

1. Two **new entity-shaped concepts**:
   - `iac_sources` — IaC source-of-record (Terraform repo/path/workspace and similar). Listed under **entities**.
   - `iac_resource_bindings` — mapping between an Infrastructure entity (via `InfrastructurePoint`) and a future/current IaC resource address. Listed under **relationships** (per Q3).

2. **Provenance + readiness fields** on the existing 12 Infrastructure entity tables and the 3 Infrastructure-internal relationship tables (per Q2):
   - 6 provenance fields per entity + relationship (`source_origin`, `source_system`, `source_reference`, `generation_status`, `generation_notes`, `last_verified_at`).
   - 5 Terraform-readiness fields per **entity only** (`terraform_ready`, `terraform_module_hint`, `terraform_resource_hint`, `terraform_variable_hints`, `terraform_notes`).
   - The 4 spec-6 cross-domain relationships do **NOT** receive provenance/readiness fields (per Q2).

3. **Frontend wiring** = backend + DTOs + roundtrip + 2 new table tabs only (per Q4):
   - 2 new `gridConfigs` tabs (`iac_sources`, `iac_resource_bindings`).
   - **No** per-entity provenance/readiness columns on the existing 12 entity grids.
   - **No** diagram palette / shapes / edges for IaC Source or IaC Resource Binding (per Q5).

4. **Zero Gateway / MCP / Discovery code changes** (per Q7). Future-contract shape is **documented only** in `spec.md`.

The full raw idea is preserved at `agent-os/specs/2026-05-05-infrastructure-terraform-discovery-readiness/planning/00-raw-idea.md`.

## Requirements Discussion

### First Round Questions

**Q1: Ambition level — full raw idea, or trimmed (entities only, or entities + bindings only)?**
**Answer:** Full ambition per raw idea. Both new concepts (`iac_sources`, `iac_resource_bindings`), provenance fields on Infra entities + relationships, Terraform readiness fields on Infra entities, and round-trippable IaC Source + Binding. No trimming.

**Q2: Where do provenance/readiness fields apply — all 12 entities + all 7 relationships, or only Infra-internal relationships?**
**Answer:** Provenance/readiness on **12 Infra entity tables + 3 Infra-internal relationship tables only** (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`). The 4 spec-6 cross-domain relationships (`application_compute_deployments`, `data_entity_data_store_hostings`, `application_infrastructure_resource_uses`, `application_load_balancer_exposures`) are **NOT** extended — they sit at a logical/cross-domain layer, not at the IaC-resource layer. Readiness fields apply to the **12 entities only**, never to relationships.

**Q3: Is `iac_resource_bindings` an entity-list item or a relationship-list item?**
**Answer:** **Relationship-list item.** `iac_resource_bindings` is conceptually an N:N mapping (`iac_source` × `infrastructure_point`) and goes into `MetaModelRelationshipsDto`, `DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure`, and `RelationshipType` / `AnyRelationship` unions. By contrast, `iac_sources` is a true entity (top-level addressable concept with name/description/tags) and goes into `MetaModelEntitiesDto`, `ENTITY_TYPE_TO_DOMAIN.iac_sources = 'infrastructure'`, and `EntityType` / `AnyEntity` unions.

**Q4: Frontend shape — full provenance/readiness column expansion across all 12 entity grids (option a), or backend + roundtrip + 2 new table tabs only (option b)?**
**Answer:** **Option (b)** — backend + DTOs + roundtrip + 2 new table tabs only. **No** per-entity provenance/readiness columns added to the existing 12 entity grids. **No** per-relationship provenance columns on the existing 3 Infra-internal relationship grids. The existing 16 grids remain visually unchanged. Provenance/readiness data is round-trippable through save/load even though it isn't surfaced in the V1 grid UI; future specs can add column visibility incrementally.

**Q5: Diagram palette / shapes / edges for IaC Source and IaC Resource Binding — V1 in-scope, or tables-only?**
**Answer:** **Tables-only for V1.** No diagram palette section, no node shape for IaC Source, no edge type for IaC Resource Binding. Rationale: IaC Sources and Bindings are metadata about how Infra concepts map to code, not first-class architecture diagram concepts. Adding them to diagrams would clutter the V1 view. Future specs can revisit.

**Q6: Provider options — extend existing `providerOptions` to add `MULTI`, or use a separate `iacSourceProviderOptions` array?**
**Answer:** **Separate `iacSourceProviderOptions = ['GCP', 'AWS', 'AZURE', 'ON_PREM', 'MULTI', 'OTHER']`.** Do NOT add `MULTI` to existing spec-4 `providerOptions = ['GCP', 'AWS', 'AZURE', 'ON_PREM', 'OTHER']` (which is reused on `cloud_accounts.provider`). Rationale: `MULTI` only makes sense for an IaC source spanning multiple providers; on a `cloud_accounts` row it would be nonsensical. Keeping the arrays separate preserves the precise semantics of each.

**Q7: Discovery / Gateway / MCP code changes — what exactly lands in this spec?**
**Answer:** **Zero Gateway / MCP / Discovery code changes.** This spec only documents the future-contract shape in `spec.md` (a short section describing how a future Discovery pipeline would post `iac_sources` + `iac_resource_bindings` candidates, conforming to the existing candidate/evidence/confidence/decision-task contract). No changes to gateway/, no changes to MCP server, no changes to discovery-service/. All wiring stays inside `architecture-model-service/` + `frontend/`.

**Q8: Liquibase changeset numbering — single mega-changeset, or split per concern?**
**Answer:** **4 separate changesets**, in this order:
- `118-iac-sources.sql` — new `iac_sources` table (entity-shaped).
- `119-iac-resource-bindings.sql` — new `iac_resource_bindings` table (relationship-shaped, polymorphic-target via `infrastructure_point_id`).
- `120-infrastructure-provenance-fields.sql` — `ALTER TABLE ADD COLUMN` for the 6 provenance fields × (12 entities + 3 Infra-internal relationships) = 15 tables.
- `121-infrastructure-terraform-readiness-fields.sql` — `ALTER TABLE ADD COLUMN` for the 5 Terraform-readiness fields × 12 entity tables.

Last applied changeset on `master` is `117-application-load-balancer-exposures.sql` (per spec 6). New changesets MUST start at `118-` and MUST NOT amend any prior changeset (per `feedback_liquibase_immutable_changesets.md`).

**Q9: `terraform_variable_hints` storage — JSONB or TEXT?**
**Answer:** **TEXT** (raw JSON string), not JSONB. Rationale: matches the `tags` column convention used everywhere else in the codebase (TEXT-encoded JSON arrays/objects). Avoids introducing a Hibernate-JSONB mapping wrinkle for a single field. Frontend serialises/deserialises through the existing tags-style helper or a parallel one in `modelSerialization.ts`.

**Q10: Test scope — what tests should this spec write?**
**Answer:**
- **Backend**: 1 round-trip test class (`InfrastructureTerraformReadinessRoundTripTest.java` or similar) covering save/load + delete-and-replace + projectId/architectureId scoping for `iac_sources` and `iac_resource_bindings`, plus a smoke check that provenance + readiness fields round-trip on a representative entity (e.g. `compute_resources`) and a representative Infra-internal relationship (e.g. `deployment_unit_compute_resources`). Modelled on the spec-2 / spec-6 round-trip test classes.
- **Frontend**: 1 Vitest config test (`infrastructureTerraformReadinessConfig.test.ts`) asserting (a) 2 new `gridConfigs` entries exist for `iac_sources` and `iac_resource_bindings`, (b) `ENTITY_TYPE_TO_DOMAIN.iac_sources === 'infrastructure'`, (c) `DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure` includes `iac_resource_bindings`, (d) `iac_resource_bindings` is wired in `RELATIONSHIP_DEFINITIONS`, (e) all 6 new picklist arrays exist in `defaults.ts`.
- **No** renderer tests, **no** component tests, **no** picker-cell tests (no new cell types), **no** diagram interaction tests in this spec.

**Q11: Domain registration — confirm exact wiring in `ENTITY_TYPE_TO_DOMAIN` and `DOMAIN_TO_RELATIONSHIP_TYPES`?**
**Answer:** Confirmed:
- `ENTITY_TYPE_TO_DOMAIN.iac_sources = 'infrastructure'` (in `frontend/src/types/architectureDomain.ts` or wherever the existing 12 Infra entries live).
- `DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure` gets one new entry: `'iac_resource_bindings'`. Existing entries (3 Infra-internal + 4 spec-6 cross-domain Infra-side entries) remain.
- No changes to `ENTITY_TYPE_TO_DOMAIN` for the existing 12 Infra entities.

**Q12: Clone + inventory wiring — what exactly to update?**
**Answer:** Confirmed:
- `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`: append `iac_sources` to **Block A** (BASE rows — `iac_sources` has no FK dependency on any spec-1/spec-2 Infra table beyond `model_files`/`environments`); append `iac_resource_bindings` to **Block B** (DEPENDENT rows — depends on `iac_sources` AND `infrastructure_points`). Order in Block B: after the 16 spec-1/2 Infra tables AND after the 4 spec-6 cross-domain relationships.
- `ArchitectureElementInventoryService.TABLES_BY_DOMAIN.Infrastructure`: append `iac_sources` and `iac_resource_bindings` to the existing Infrastructure entry.
- `ArchitectureElementInventoryService.DISPLAY_NAME_FALLBACK_TABLES`: append `iac_resource_bindings` (relationship — no `name` column; uses fallback). `iac_sources` does **NOT** need to be in the fallback list because it has a `name` column.

**Q13: Out-of-scope — what to add beyond the raw idea's exclusion list?**
**Answer:** Add 3 explicit additional exclusions on top of the raw idea's exclusion list:
- **No** per-entity provenance/readiness grid columns added to the existing 12 entity grids in V1 (deferred — the data round-trips, just isn't displayed).
- **No** IaC diagram support (no palette section, no node shape, no edge type) in V1.
- **No** Gateway / MCP / Discovery code changes — only `spec.md` documentation of the future contract shape.

The full raw-idea exclusion list (Terraform parsing/generation/plan/apply/state, OpenTofu beyond hints, live GCP API integration, Cloud Asset Inventory integration, Discovery-service infrastructure scanning, LLM-based IaC generation, security/firewall/IAM modelling, cost estimation, drift detection, policy/compliance scanning, automatic diagram generation from Terraform) is preserved verbatim.

### Inferred Decisions (all 22 accepted)

These were inferred from the codebase grounding and prior-spec patterns and accepted by the user without override:

1. **Liquibase changeset numbering** — `118-` through `121-` (last applied is `117-application-load-balancer-exposures.sql`). One changeset per concern (per Q8).
2. **DTO conventions** — Java records, `@JsonProperty("snake_case")`, IDs as `String`, booleans as nullable `Boolean`, decimals as `BigDecimal`, `terraform_ready` as nullable `Boolean`, `last_scanned_at` / `last_imported_at` / `last_seen_at` / `last_verified_at` as ISO-8601 string `Instant` columns mapped via existing convention. Matches spec 1-2 + spec 6 conventions.
3. **JPA entities follow spec 1 pattern** — `@Entity`, `@Table(name = "...")`, `@Id String id`, `@Column(name = "...")`, FKs as raw `String` columns matching existing pattern. `IaCSourceEntity` and `IaCResourceBindingEntity` mirror spec-2 + spec-6 conventions.
4. **Repositories** — Spring Data JPA `JpaRepository<T, String>` with `findByModelFileId(String modelFileId)` plus delete-and-replace semantics. Matches spec 2 + spec 6 precedents.
5. **`EntityMapper` arms** — 2 new `toDto` / `toEntity` arms (one per new table). Matches spec 2 + spec 6 precedents.
6. **`MetaModelEntitiesDto` extension** — append 1 new `List<IaCSourceDto>` field with `@JsonProperty("iac_sources")`.
7. **`MetaModelRelationshipsDto` extension** — append 1 new `List<IaCResourceBindingDto>` field with `@JsonProperty("iac_resource_bindings")`.
8. **`ModelService` save/load/delete-and-replace** — append 2 new arms in each pipeline (one for `iac_sources`, one for `iac_resource_bindings`). Pattern strictly mirrors spec 2 + spec 6.
9. **Snake_case field names everywhere** — all DTO `@JsonProperty` keys, TypeScript interface fields, and grid `field` keys use snake_case matching DB column names exactly.
10. **`iac_resource_bindings.infrastructure_point_id`** uses the existing `infrastructure_points` polymorphic supertype (per raw idea) — no new point type introduced. Reuses spec-4's `infrastructure_point_picker` cellType for the source-side endpoint.
11. **`iac_sources` standard entity envelope** — `id`, `model_file_id`, `name`, `description`, `tags`, `valid_from`, `valid_to`. Matches spec-1 entity precedent (e.g. `environments`, `compute_resources`).
12. **`iac_resource_bindings` standard relationship envelope** — `id`, `model_file_id`, `description`, `tags` only. **No** `name` column (relationships don't have names; matches spec-1 + spec-6 precedent). Uses `valid_from` / `valid_to` if and only if the existing 3 Infra-internal relationships use them — otherwise omitted to match relationship convention.
13. **`environment_id` on `iac_sources`** — `TEXT NULL` (nullable). Per raw idea.
14. **`environment_id` on `iac_resource_bindings`** — `TEXT NULL` (nullable). Per raw idea.
15. **`confidence` on `iac_resource_bindings`** — `DECIMAL(4,3) NULL` no DB CHECK. Matches spec-1 + spec-6 precedent.
16. **`tags` columns are TEXT** (JSON-encoded). Matches existing convention.
17. **`terraform_variable_hints` is TEXT** (per Q9), parallel to `tags`. Frontend treats as raw JSON string in the model and serialises/deserialises only when displaying or accepting input.
18. **Backfill in `normalizeModelFromApi`** — 2 new `??=` lines (one for `iac_sources`, one for `iac_resource_bindings`); existing `??=` lines for spec-1/2/6 arrays are unchanged. Provenance/readiness fields on existing entities/relationships have no `??=` backfill needed (they are nullable columns; missing-from-payload reads as `undefined`/`null` cleanly).
19. **`emptyModel` extension** — append 1 entry to `entities` (`iac_sources: []`) and 1 entry to `relationships` (`iac_resource_bindings: []`).
20. **`paletteData.ts`** — append 2 new sections per Q5? **NO.** Re-reading Q5: tables-only for V1, no palette. Inferred decision 20 corrected: **NO new `paletteData.ts` entries** for IaC Source or IaC Resource Binding. The user-supplied summary mentions "+2 new sections" in `paletteData.ts` for completeness of the file-touch list; this is interpreted as a forward-compatibility stub only if the codebase requires registration even for non-rendered types. If the codebase requires `paletteData.ts` registration for type recognition, add minimal sections; otherwise omit. **The spec-writer should resolve this against the actual codebase shape.**
21. **No new cell types** — `iac_sources` grid uses standard `text` / `tags` / `dropdown` / `fk_typeahead` cells. `iac_resource_bindings` grid uses `infrastructure_point_picker` (existing from spec 4) for the source endpoint plus `fk_typeahead` for `iac_source_id` and standard cells for the rest.
22. **`spec.md` future-contract section** — short, narrative only. Document how a future discovery pipeline would emit `iac_sources` + `iac_resource_bindings` candidates conforming to the existing candidate/evidence/confidence/decision-task contract. No code, no schema files. ~100-200 words.

### Existing Code to Reference

The grounding identified the following reference points:

**Backend:**
- **Spec 1 changesets** at `architecture-model-service/src/main/resources/db/changelog/` (`098-` through `113-`) — Liquibase format pattern for `118-` through `121-`.
- **Spec 6 changesets** (`114-` through `117-`) — most recent precedent for new-table changesets.
- **Spec 1 entities** (`EnvironmentEntity`, `ComputeResourceEntity`, etc.) — entity shape pattern for `IaCSourceEntity`.
- **Spec 1 relationship entities** (`ResourceSubnetHostingEntity` etc.) — entity shape pattern for `IaCResourceBindingEntity` (polymorphic via `infrastructure_point_id`).
- **`InfrastructurePointEntity`** — polymorphic supertype reused without changes.
- **Spec 2 `MetaModelEntitiesDto`** — append `iac_sources` list field.
- **Spec 2 `MetaModelRelationshipsDto`** — append `iac_resource_bindings` list field.
- **Spec 2 + Spec 6 `EntityMapper` arms** — direct template.
- **Spec 2 + Spec 6 `ModelService` save/load/delete-and-replace arms** — direct template.
- **Spec 6 `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`** — current state has spec-6 tables at end of Block B; append `iac_sources` to Block A and `iac_resource_bindings` to Block B after spec-6 tables.
- **Spec 2 `ArchitectureElementInventoryService.TABLES_BY_DOMAIN.Infrastructure`** — extend with 2 new entries.
- **Spec 6 round-trip test class** — direct template for the new round-trip test.

**Frontend:**
- **Spec 3 `MetaModelEntities` type** at `frontend/src/types/model.ts` — extend with `iac_sources: IaCSource[]`.
- **Spec 3 `MetaModelRelationships` type** — extend with `iac_resource_bindings: IaCResourceBinding[]`.
- **Spec 3 `EntityType` + `AnyEntity` unions** — extend with `IaCSource`.
- **Spec 3 `RelationshipType` + `AnyRelationship` unions** — extend with `IaCResourceBinding`.
- **Spec 3 `RELATIONSHIP_DEFINITIONS`** — append 1 entry for `iac_resource_bindings`.
- **Spec 3 `ENTITY_TYPE_TO_DOMAIN`** at `frontend/src/types/architectureDomain.ts` — add `iac_sources: 'infrastructure'`.
- **Spec 3 `normalizeModelFromApi`** — append 2 new `??=` backfill lines.
- **Spec 3 `emptyModel`** — append 2 new `[]` entries.
- **Spec 3 `DOMAIN_TO_RELATIONSHIP_TYPES`** at `frontend/src/utils/contextPickerDomainMappings.ts` — extend `infrastructure` entry with `iac_resource_bindings`.
- **Spec 4 `gridConfigs`** — append 2 new grid configs (`iac_sources`, `iac_resource_bindings`).
- **Spec 4 picklist patterns** in `defaults.ts` — model the 6 new arrays.
- **Spec 4 `infrastructure_point_picker` cellType** — used unchanged by the `iac_resource_bindings` grid for `infrastructure_point_id`.
- **Spec 6 Vitest config test pattern** — model `infrastructureTerraformReadinessConfig.test.ts` after `infrastructureCrossDomainConfig.test.ts`.

### Follow-up Questions

No follow-up questions were required. The user provided concrete answers on all 13 open questions and accepted all 22 inferred decisions.

## Visual Assets

### Files Provided

Bash check on `agent-os/specs/2026-05-05-infrastructure-terraform-discovery-readiness/planning/visuals/` returned no image/PDF files.

No visual assets provided.

### Visual Insights

N/A — full-stack readiness/metadata spec, no UI artefacts. Reference UX is the existing relationship grid tabs landed in spec 4 and spec 6.

## Requirements Summary

### Functional Requirements

The system must:

1. **Persist** `iac_sources` (entity) and `iac_resource_bindings` (relationship) through full-model save/load/delete-and-replace, scoped by `projectId` and `architectureId`, using the existing `ModelService` pipeline.
2. **Persist** 6 provenance fields on each of the 12 existing Infrastructure entity tables and the 3 existing Infra-internal relationship tables.
3. **Persist** 5 Terraform-readiness fields on each of the 12 existing Infrastructure entity tables.
4. **Round-trip** every documented column on the new + existing tables through DTO ↔ JPA ↔ DB without loss.
5. **Expose** `iac_sources` and `iac_resource_bindings` as 2 new tabs in the relationship-grid UI under the Infrastructure domain. **Do not** add provenance/readiness columns to the existing 12 entity grids in V1 (per Q4).
6. **Backfill** older saved models without these arrays via 2 new `??=` lines in `normalizeModelFromApi`.
7. **Preserve** all existing Business / Application / Data / Behavioural / UI / Infrastructure-V1 / Infrastructure-cross-domain (spec 6) behaviour. No edits to existing relationship grids, existing palette sections, or existing inspector arms.
8. **Document** future Discovery / Gateway / MCP contract shape in `spec.md` (no code).

### Per-Table Column Shapes

#### New Entity Table: `iac_sources` (changeset `118-iac-sources.sql`)

Standard entity envelope + 13 source-specific fields per raw idea.

| column | type | nullability | notes |
|---|---|---|---|
| `id` | TEXT | NOT NULL | PK |
| `model_file_id` | TEXT | NOT NULL | server-side only; FK |
| `name` | TEXT | NOT NULL | |
| `description` | TEXT | NULL | |
| `tags` | TEXT | NULL | JSON-encoded array |
| `valid_from` | TEXT | NULL | ISO-8601 timestamp |
| `valid_to` | TEXT | NULL | ISO-8601 timestamp |
| `environment_id` | TEXT | NULL | FK -> `environments(id)` |
| `source_type` | TEXT | NULL | UI dropdown via `iacSourceTypeOptions` |
| `repository_url` | TEXT | NULL | |
| `repository_provider` | TEXT | NULL | UI dropdown via `repositoryProviderOptions` |
| `branch` | TEXT | NULL | |
| `commit_sha` | TEXT | NULL | |
| `path` | TEXT | NULL | |
| `workspace` | TEXT | NULL | |
| `module_name` | TEXT | NULL | |
| `module_path` | TEXT | NULL | |
| `provider` | TEXT | NULL | UI dropdown via `iacSourceProviderOptions` (separate from spec-4 `providerOptions` due to `MULTI`) |
| `owner` | TEXT | NULL | |
| `last_scanned_at` | TEXT | NULL | ISO-8601 timestamp |
| `last_imported_at` | TEXT | NULL | ISO-8601 timestamp |

Grid columns (UI) — order roughly: `name` (required text), `source_type` (dropdown, optional), `provider` (dropdown, optional), `repository_url` (text), `repository_provider` (dropdown), `branch` (text), `commit_sha` (text), `path` (text), `workspace` (text), `module_name` (text), `module_path` (text), `environment_id` (fk_typeahead `environments`), `owner` (text), `last_scanned_at` (text), `last_imported_at` (text), `description` (text), `tags` (tags), `valid_from` (text), `valid_to` (text).

#### New Relationship Table: `iac_resource_bindings` (changeset `119-iac-resource-bindings.sql`)

Standard relationship envelope (no `name`) + polymorphic-target metadata fields per raw idea.

| column | type | nullability | notes |
|---|---|---|---|
| `id` | TEXT | NOT NULL | PK |
| `model_file_id` | TEXT | NOT NULL | server-side only; FK |
| `iac_source_id` | TEXT | NOT NULL | FK -> `iac_sources(id)` |
| `infrastructure_point_id` | TEXT | NOT NULL | FK -> `infrastructure_points(id)` (polymorphic supertype) |
| `environment_id` | TEXT | NULL | FK -> `environments(id)` |
| `iac_address` | TEXT | NOT NULL | e.g. `module.orders.google_cloud_run_v2_service.service` |
| `iac_resource_type` | TEXT | NOT NULL | e.g. `google_cloud_run_v2_service` |
| `iac_resource_name` | TEXT | NULL | |
| `provider` | TEXT | NULL | UI dropdown via `iacSourceProviderOptions` (the raw idea omits `MULTI` here but reusing the same array is sensible) |
| `file_path` | TEXT | NULL | |
| `start_line` | INTEGER | NULL | |
| `end_line` | INTEGER | NULL | |
| `state_resource_id` | TEXT | NULL | |
| `external_id` | TEXT | NULL | |
| `binding_status` | TEXT | NULL | UI dropdown via `bindingStatusOptions` |
| `confidence` | DECIMAL(4,3) | NULL | no DB CHECK |
| `last_seen_at` | TEXT | NULL | ISO-8601 timestamp |
| `description` | TEXT | NULL | |
| `tags` | TEXT | NULL | JSON-encoded array |

Grid columns (UI): `infrastructure_point_id` (cellType `infrastructure_point_picker`, required), `iac_source_id` (cellType `fk_typeahead`, fkTarget `iac_sources`, required), `environment_id` (fk_typeahead `environments`, optional), `iac_address` (text, required), `iac_resource_type` (text, required), `iac_resource_name` (text), `provider` (dropdown, options `iacSourceProviderOptions`), `file_path` (text), `start_line` (text — numeric-as-text per spec-4 precedent), `end_line` (text — numeric-as-text), `state_resource_id` (text), `external_id` (text), `binding_status` (dropdown, options `bindingStatusOptions`), `confidence` (text — numeric-as-text), `last_seen_at` (text), `description` (text), `tags` (tags).

### Field-Addition Matrix

#### 11 fields added to each of the 12 existing Infrastructure entity tables (changesets `120-` + `121-`)

The 12 tables: `environments`, `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`.

**6 provenance fields** (changeset `120-infrastructure-provenance-fields.sql`):

| column | type | nullability | notes |
|---|---|---|---|
| `source_origin` | TEXT | NULL | enum-shaped freetext; `sourceOriginOptions` available for future grid display |
| `source_system` | TEXT | NULL | e.g. `terraform`, `gcp-cloud-asset-inventory`, `discovery-service`, `manual` |
| `source_reference` | TEXT | NULL | e.g. Terraform address, cloud resource id, repo path |
| `generation_status` | TEXT | NULL | enum-shaped freetext; `generationStatusOptions` available for future grid display |
| `generation_notes` | TEXT | NULL | |
| `last_verified_at` | TEXT | NULL | ISO-8601 timestamp |

**5 Terraform-readiness fields** (changeset `121-infrastructure-terraform-readiness-fields.sql`):

| column | type | nullability | notes |
|---|---|---|---|
| `terraform_ready` | BOOLEAN | NULL | nullable; tri-state (NULL = not assessed) |
| `terraform_module_hint` | TEXT | NULL | |
| `terraform_resource_hint` | TEXT | NULL | |
| `terraform_variable_hints` | TEXT | NULL | raw JSON string per Q9 |
| `terraform_notes` | TEXT | NULL | |

#### 6 provenance fields added to each of the 3 Infra-internal relationship tables (changeset `120-`)

The 3 tables: `resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`.

Same 6 provenance fields as above. **No** Terraform-readiness fields on relationships (per Q2 — readiness applies only to entities).

#### Tables explicitly NOT extended (per Q2)

The 4 spec-6 cross-domain relationship tables are **NOT** extended with provenance/readiness fields:
- `application_compute_deployments`
- `data_entity_data_store_hostings`
- `application_infrastructure_resource_uses`
- `application_load_balancer_exposures`

Rationale: cross-domain relationships sit at a logical/architectural layer, not at the IaC-resource layer. They will never have a Terraform address.

### Picklist Option Arrays

Six **new** arrays to add in `frontend/src/config/defaults.ts`:

```ts
// Provenance enums (used on 12 entities + 3 Infra-internal relationships; UI display deferred)
export const sourceOriginOptions = ['MANUAL', 'DISCOVERED', 'IMPORTED', 'GENERATED', 'SUGGESTED', 'OTHER'];
export const generationStatusOptions = ['NOT_READY', 'READY', 'GENERATED', 'BLOCKED', 'NOT_APPLICABLE', 'UNKNOWN'];

// IaC Source enums
export const iacSourceTypeOptions = ['TERRAFORM', 'OPENTOFU', 'CLOUDFORMATION', 'BICEP', 'PULUMI', 'KUBERNETES', 'HELM', 'OTHER'];
export const repositoryProviderOptions = ['GITHUB', 'GITLAB', 'BITBUCKET', 'AZURE_DEVOPS', 'OTHER'];
export const iacSourceProviderOptions = ['GCP', 'AWS', 'AZURE', 'ON_PREM', 'MULTI', 'OTHER']; // separate from existing providerOptions due to MULTI

// IaC Resource Binding enum
export const bindingStatusOptions = ['PLANNED', 'SUGGESTED', 'CONFIRMED', 'STALE', 'REMOVED', 'UNKNOWN'];
```

**Reused** from spec 4's `defaults.ts` — none directly reused; `providerOptions` is intentionally NOT reused (per Q6).

### Spec 4 Picklist Verification Pass

Cross-checked the new arrays against spec 4's `requirements.md` (lines 485-543) for any potential drift:

| New picklist | Existing spec-4 picklist | Drift? | Decision |
|---|---|---|---|
| `iacSourceProviderOptions = ['GCP', 'AWS', 'AZURE', 'ON_PREM', 'MULTI', 'OTHER']` | `providerOptions = ['GCP', 'AWS', 'AZURE', 'ON_PREM', 'OTHER']` (used on `cloud_accounts.provider`) | **Yes** — `MULTI` added | **Separate array** per Q6. `providerOptions` stays untouched on `cloud_accounts`. `iacSourceProviderOptions` is used on `iac_sources.provider` and `iac_resource_bindings.provider`. |
| `sourceOriginOptions` | none | new | clean add |
| `generationStatusOptions` | none | new | clean add |
| `iacSourceTypeOptions` | none | new | clean add |
| `repositoryProviderOptions` | none | new | clean add |
| `bindingStatusOptions` | none | new | clean add |

**No unexpected drift.** The only divergence (`iacSourceProviderOptions` adding `MULTI`) is explicit per Q6 and resolved by keeping the arrays separate. All other 5 new arrays are net-new and don't conflict with any spec-4 array.

The 5 net-new arrays come from the raw idea verbatim — no upstream spec defines them.

### Liquibase Changeset Numbering

| # | Changeset | Purpose |
|---|---|---|
| 118 | `118-iac-sources.sql` | new `iac_sources` table |
| 119 | `119-iac-resource-bindings.sql` | new `iac_resource_bindings` table |
| 120 | `120-infrastructure-provenance-fields.sql` | add 6 provenance columns to 12 entities + 3 Infra-internal relationships |
| 121 | `121-infrastructure-terraform-readiness-fields.sql` | add 5 Terraform readiness columns to 12 entities |

Last applied changeset on `master` is `117-application-load-balancer-exposures.sql` (per spec 6). New changesets MUST start at `118-` and MUST NOT amend any prior changeset (per `feedback_liquibase_immutable_changesets.md`).

### Future-Contract Documentation (for `spec.md`)

The spec writer should add a short narrative section in `spec.md` describing the future Discovery / Gateway / MCP contract shape **without writing any code**. Suggested content:

> **Future Discovery Pipeline Contract Shape (V2+)**
>
> A future Infrastructure discovery pipeline will produce candidates conforming to the existing discovery-service contract (`candidate`, `evidence`, `confidence`, `decision_task`, `approved_candidate`):
> - **`iac_sources` candidates**: produced by repo scanners (filesystem walk, GitHub API). Evidence: file path, commit SHA, parsed `terraform { backend ... }` blocks. Confidence based on parse-success and signature heuristics. Approved candidates land in `iac_sources` via the existing save pipeline.
> - **`iac_resource_bindings` candidates**: produced by Terraform AST parsers + cloud inventory matchers. Evidence: parsed `.tf` file address, optional state-file `terraform.tfstate` resource id, optional cloud-asset-inventory match. Confidence based on parser success + match quality. Decision tasks surface ambiguous matches for user review. Approved candidates land in `iac_resource_bindings` via the existing save pipeline.
> - **Provenance fields on existing Infra entities**: discovery candidates set `source_origin = 'DISCOVERED'`, `source_system`, `source_reference` to facilitate audit and re-running discovery.
> - **Readiness fields on existing Infra entities**: a future "Terraform readiness analyser" computes `terraform_ready`, `terraform_module_hint`, `terraform_resource_hint` and surfaces them as suggestions; users approve/edit via the existing approve-candidate UI.
>
> No code is added in this spec; this section exists so the model shape is forward-compatible.

### File Touch Summary

#### Backend

| # | File | Change |
|---|---|---|
| 1 | `architecture-model-service/src/main/resources/db/changelog/118-iac-sources.sql` | **NEW** Liquibase changeset for `iac_sources` table per the column shape above. |
| 2 | `architecture-model-service/src/main/resources/db/changelog/119-iac-resource-bindings.sql` | **NEW** Liquibase changeset for `iac_resource_bindings` table. |
| 3 | `architecture-model-service/src/main/resources/db/changelog/120-infrastructure-provenance-fields.sql` | **NEW** Liquibase changeset adding 6 provenance columns to 12 entity tables + 3 Infra-internal relationship tables (15 tables total). |
| 4 | `architecture-model-service/src/main/resources/db/changelog/121-infrastructure-terraform-readiness-fields.sql` | **NEW** Liquibase changeset adding 5 readiness columns to 12 entity tables. |
| 5 | `architecture-model-service/src/main/java/.../entities/IaCSourceEntity.java` | **NEW** JPA entity for `iac_sources`. |
| 6 | `architecture-model-service/src/main/java/.../entities/IaCResourceBindingEntity.java` | **NEW** JPA entity for `iac_resource_bindings`. |
| 7 | `architecture-model-service/src/main/java/.../entities/<existing 12 entity classes>` | Add 11 new fields per class (6 provenance + 5 readiness) with `@Column(name = "...")`. |
| 8 | `architecture-model-service/src/main/java/.../entities/<existing 3 Infra-internal relationship entities>` | Add 6 new provenance fields per class with `@Column(name = "...")`. |
| 9 | `architecture-model-service/src/main/java/.../dto/IaCSourceDto.java` | **NEW** DTO record for `iac_sources`. |
| 10 | `architecture-model-service/src/main/java/.../dto/IaCResourceBindingDto.java` | **NEW** DTO record for `iac_resource_bindings`. |
| 11 | `architecture-model-service/src/main/java/.../dto/<existing 12 entity DTOs>` | Extend each with 11 new fields (6 provenance + 5 readiness) with `@JsonProperty("snake_case")` keys. |
| 12 | `architecture-model-service/src/main/java/.../dto/<existing 3 Infra-internal relationship DTOs>` | Extend each with 6 new provenance fields. |
| 13 | `architecture-model-service/src/main/java/.../repositories/IaCSourceRepository.java` | **NEW** Spring Data JPA repository. |
| 14 | `architecture-model-service/src/main/java/.../repositories/IaCResourceBindingRepository.java` | **NEW** Spring Data JPA repository. |
| 15 | `architecture-model-service/src/main/java/.../service/EntityMapper.java` | Append 2 new `toDto`/`toEntity` arms (one per new table); extend the existing 12 entity arms + 3 Infra-internal relationship arms with the new fields. |
| 16 | `architecture-model-service/src/main/java/.../dto/MetaModelEntitiesDto.java` | Append 1 new `List<IaCSourceDto>` field with `@JsonProperty("iac_sources")`. |
| 17 | `architecture-model-service/src/main/java/.../dto/MetaModelRelationshipsDto.java` | Append 1 new `List<IaCResourceBindingDto>` field with `@JsonProperty("iac_resource_bindings")`. |
| 18 | `architecture-model-service/src/main/java/.../service/ModelService.java` | Append 2 new arms in save/load/delete-and-replace pipelines (mirrors spec 2 + 6 patterns). |
| 19 | `architecture-model-service/src/main/java/.../service/ArchitectureCloneService.java` | Update `IN_SCOPE_TABLES_IN_ORDER`: append `iac_sources` to Block A (BASE); append `iac_resource_bindings` to Block B (DEPENDENT) at the very end after spec-6 tables. |
| 20 | `architecture-model-service/src/main/java/.../service/ArchitectureElementInventoryService.java` | Append `iac_sources` and `iac_resource_bindings` to `TABLES_BY_DOMAIN.Infrastructure`; append `iac_resource_bindings` to `DISPLAY_NAME_FALLBACK_TABLES` (no `name` column). `iac_sources` is **not** added to fallback because it has a `name` column. |
| 21 | `architecture-model-service/src/test/java/.../service/InfrastructureTerraformReadinessRoundTripTest.java` | **NEW** 1 round-trip test class covering save/load + delete-and-replace + projectId/architectureId scoping for `iac_sources` and `iac_resource_bindings`, plus a smoke check that provenance + readiness fields round-trip on a representative entity and a representative Infra-internal relationship. |

#### Frontend

| # | File | Change |
|---|---|---|
| 22 | `frontend/src/types/model.ts` | Add 2 new TypeScript interface types (`IaCSource`, `IaCResourceBinding`); extend `MetaModelEntities` with `iac_sources: IaCSource[]`; extend `MetaModelRelationships` with `iac_resource_bindings: IaCResourceBinding[]`; extend `EntityType` + `AnyEntity` + `RelationshipType` + `AnyRelationship` unions; add 11 new fields per existing 12 Infra entity type interfaces (6 provenance + 5 readiness); add 6 new provenance fields per 3 Infra-internal relationship interfaces. |
| 23 | `frontend/src/config/relationshipDefinitions.ts` | Append 1 new `RELATIONSHIP_DEFINITIONS` entry for `iac_resource_bindings` with `endpointEntityTypes` mixing `iac_sources` + the 12 Infra entity types (via `infrastructure_point_id` polymorphic source); append entry to `RELATIONSHIP_TAB_ORDER`. |
| 24 | `frontend/src/types/architectureDomain.ts` | Add `ENTITY_TYPE_TO_DOMAIN.iac_sources = 'infrastructure'`. |
| 25 | `frontend/src/utils/contextPickerDomainMappings.ts` | Extend `DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure` with `iac_resource_bindings`. |
| 26 | `frontend/src/config/gridConfigs.ts` | Append 2 new grid configs (`iac_sources`, `iac_resource_bindings`); append 2 new keys to `relationshipTabToType` (just `iac_resource_bindings`); append 2 new entries to `relationshipTabNames`. |
| 27 | `frontend/src/config/defaults.ts` | Append 6 new picklist option arrays (`sourceOriginOptions`, `generationStatusOptions`, `iacSourceTypeOptions`, `repositoryProviderOptions`, `iacSourceProviderOptions`, `bindingStatusOptions`); append `iac_sources: []` to `emptyModel.entities` and `iac_resource_bindings: []` to `emptyModel.relationships`. **Do NOT** redeclare or modify existing `providerOptions`. |
| 28 | `frontend/src/utils/paletteData.ts` | Per Q5 + inferred decision 20: add 2 minimal stub sections **only if** the codebase requires palette registration for type recognition; otherwise omit entirely. The summary mentions "+2 new sections" — this is interpreted as registration-stub only. **Spec writer to resolve against actual code shape.** No diagram-visible palette entries. |
| 29 | `frontend/src/api/modelSerialization.ts` | Append 2 new `??=` backfill lines in `normalizeModelFromApi` (one for `iac_sources`, one for `iac_resource_bindings`). |
| 30 | `frontend/src/config/__tests__/infrastructureTerraformReadinessConfig.test.ts` | **NEW** 1 Vitest config test asserting (a) 2 new `gridConfigs` entries, (b) `ENTITY_TYPE_TO_DOMAIN.iac_sources === 'infrastructure'`, (c) `DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure` includes `iac_resource_bindings`, (d) `iac_resource_bindings` wired in `RELATIONSHIP_DEFINITIONS`, (e) all 6 new picklist arrays exist in `defaults.ts`. |

**Files NOT to touch**:
- Existing 12 Infra entity `gridConfigs` entries — not modified (per Q4: no new provenance/readiness columns added to existing grids in V1).
- Existing 3 Infra-internal relationship `gridConfigs` entries — not modified (per Q4).
- Existing 4 spec-6 cross-domain relationship `gridConfigs` entries — not modified.
- `frontend/src/utils/relationshipUtils.ts` — not modified (no edge logic for `iac_resource_bindings` per Q5).
- `frontend/src/utils/rendering.ts` — not modified (no edge defaults for `iac_resource_bindings`).
- `frontend/src/components/SelectionInspector/SelectionInspector.tsx` — not modified (no edge inspector arm — bindings aren't rendered as edges per Q5).
- `gateway/`, `mcp-server/`, `discovery-service/` — **zero** code changes per Q7.
- Existing Liquibase changesets `001-` through `117-` — never amend (per `feedback_liquibase_immutable_changesets.md`).

### Reusability Opportunities

- **Spec 1 entity stack** — direct template for `IaCSourceEntity` (full entity envelope with `name`, `description`, `tags`, `valid_from`, `valid_to`, plus type-specific fields).
- **Spec 1 + Spec 6 relationship stack** — direct template for `IaCResourceBindingEntity` (relationship envelope without `name`, plus polymorphic-target shape via `infrastructure_point_id`).
- **Spec 4 `gridConfigs` patterns for the 12 Infra entity grids** — direct template for the new `iac_sources` grid.
- **Spec 4 `gridConfigs` patterns for the 3 Infra-internal relationship grids** — direct template for the new `iac_resource_bindings` grid.
- **Spec 4 `infrastructure_point_picker` cellType** — used unchanged by `iac_resource_bindings.infrastructure_point_id`.
- **Spec 4 picklist conventions** in `defaults.ts` — direct template for the 6 new arrays.
- **Spec 6 round-trip test class** — direct template for the new round-trip test.
- **Spec 6 Vitest config test** (`infrastructureCrossDomainConfig.test.ts`) — direct template for `infrastructureTerraformReadinessConfig.test.ts`.
- **Existing `getRelationshipsForDomain` derivation** — automatically surfaces `iac_resource_bindings` under the Infrastructure domain tab via `endpointEntityTypes`.

### Scope Boundaries

**In Scope:**
- 2 new tables (`iac_sources` entity, `iac_resource_bindings` relationship) — full backend + DTOs + roundtrip + 2 new grid tabs.
- 6 provenance fields on each of 12 existing Infra entity tables + 3 existing Infra-internal relationship tables (backend + DTO + TS interfaces only; **not** displayed in V1 grids).
- 5 Terraform-readiness fields on each of 12 existing Infra entity tables (backend + DTO + TS interfaces only; **not** displayed in V1 grids).
- Liquibase changesets `118-` through `121-`.
- 6 new picklist option arrays in `defaults.ts`.
- Backend round-trip test class.
- Frontend Vitest config test.
- `spec.md` future-contract documentation section (narrative only, no code).

**Out of Scope** (raw idea exclusions plus 13 explicit Q13 exclusions):
- Full Terraform import (raw idea).
- Terraform parsing (raw idea).
- Terraform state parsing (raw idea).
- Terraform generation (raw idea).
- Terraform plan/apply (raw idea).
- OpenTofu support beyond `source_type`/hints (raw idea).
- Live GCP API integration (raw idea).
- Cloud Asset Inventory integration (raw idea).
- Discovery-service infrastructure scanning (raw idea).
- LLM-based IaC generation (raw idea).
- Security group / firewall / IAM modelling (raw idea).
- Cost estimation (raw idea).
- Drift detection (raw idea).
- Policy/compliance scanning (raw idea).
- Automatic diagram generation from Terraform (raw idea).
- **Per-entity provenance/readiness grid columns added to existing 12 entity grids in V1** (Q4 + Q13 explicit exclusion).
- **Per-relationship provenance grid columns added to existing 3 Infra-internal relationship grids in V1** (Q4 + Q13).
- **IaC Source / IaC Resource Binding diagram support** (no palette section, no shape, no edge type) (Q5 + Q13).
- **Gateway / MCP / Discovery code changes** — `spec.md` documentation only (Q7 + Q13).
- **Provenance/readiness fields on the 4 spec-6 cross-domain relationships** (Q2).
- **Renderer tests, component tests, picker-cell tests** (Q10).
- **XLSX import/export wiring** for the 2 new tables.
- **MetaModelSummary extension** for the 2 new tables.

### Technical Considerations

- **Changeset numbering is strict** — new changesets start at `118-`. Per `feedback_liquibase_immutable_changesets.md`, do not edit any applied changeset.
- **`iac_sources` is an entity, `iac_resource_bindings` is a relationship** — the type/domain registrations differ (per Q3 + Q11): entity goes into `MetaModelEntitiesDto` + `EntityType` + `ENTITY_TYPE_TO_DOMAIN`; relationship goes into `MetaModelRelationshipsDto` + `RelationshipType` + `DOMAIN_TO_RELATIONSHIP_TYPES`.
- **Polymorphic target via `infrastructure_point_id`** on `iac_resource_bindings` — reuses the existing `infrastructure_points` supertype landed in spec 1; reuses spec-4's `infrastructure_point_picker` cellType.
- **`environment_id` is nullable** on both new tables.
- **Provenance/readiness fields are append-only on existing tables** — pure `ALTER TABLE ADD COLUMN ... NULL`. Backwards-compatible: existing rows have NULL in the new columns; reads/writes against older models work cleanly.
- **`terraform_variable_hints` is TEXT** (raw JSON string, per Q9) — frontend treats it as opaque string in V1; no schema-aware editor.
- **`terraform_ready` is nullable Boolean** — tri-state (NULL = not assessed, TRUE = ready, FALSE = blocked).
- **`iacSourceProviderOptions` is intentionally separate** from spec-4's `providerOptions` (per Q6) due to the `MULTI` value — do **not** merge them.
- **No frontend palette/edge wiring** for `iac_resource_bindings` (per Q5) — bindings appear only in the table tab, not in any diagram.
- **No frontend per-entity column expansion** (per Q4) — provenance/readiness data round-trips through save/load but is not displayed in the existing 12 grids in V1.
- **Numeric-as-text** — `start_line`, `end_line`, `confidence` use `cellType: 'text'` in the `iac_resource_bindings` grid (matches spec-4 / spec-6 precedent).
- **Backward compatibility** — older saved models without these arrays load cleanly via 2 new `??=` lines in `normalizeModelFromApi`. Older models without the new entity/relationship-table columns work because the columns are nullable.
- **Zero downstream-system changes** — gateway/, mcp-server/, discovery-service/ untouched (per Q7).

## Acceptance Criteria

(Adapted from raw idea; preserved verbatim where applicable.)

- Backend supports `iac_sources` records scoped by project and architecture.
- Backend supports `iac_resource_bindings` records scoped by project and architecture.
- `iac_resource_bindings` references Infrastructure entities through `infrastructure_points` (polymorphic supertype).
- Full-model save/load preserves `iac_sources` and `iac_resource_bindings` data.
- Infrastructure entities can store provenance metadata (`source_origin`, `source_system`, `source_reference`, `generation_status`, `generation_notes`, `last_verified_at`) at the DB + DTO + TS-type layer.
- Infrastructure-internal relationships can store the same 6 provenance fields at the DB + DTO + TS-type layer.
- Infrastructure entities can store Terraform readiness/hint metadata (`terraform_ready`, `terraform_module_hint`, `terraform_resource_hint`, `terraform_variable_hints`, `terraform_notes`) at the DB + DTO + TS-type layer.
- Frontend types include `IaCSource` and `IaCResourceBinding` interfaces and the field extensions on existing 12 entity types + 3 Infra-internal relationship types.
- Frontend default model state safely handles missing `iac_sources` and `iac_resource_bindings` arrays via `??=` backfill.
- Users can view and edit `iac_sources` and `iac_resource_bindings` through the 2 new table tabs in the Infrastructure domain.
- Existing 16 Infra grids and 4 spec-6 cross-domain grids continue to work unchanged.
- Existing Infrastructure V1 diagrams continue to work unchanged (no palette/edge changes).
- Existing Business / Application / Data / Behavioural / UI domains continue to work unchanged.
- Discovery / Gateway / MCP changes are limited to `spec.md` documentation only — zero code changes.
- No Terraform parser, generator, importer, plan/apply, live cloud integration, or LLM IaC workflow is implemented in this spec.

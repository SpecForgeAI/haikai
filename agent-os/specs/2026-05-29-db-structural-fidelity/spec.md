# Specification: DB Structural Fidelity for Discovery (Sybase + Postgres)

## Goal
Capture the structural truth a like-for-like Sybase->Postgres schema migration needs by enriching EXISTING architecture entities (Group A) and landing procedural-object reality as rich, persisted Findings fed from the discovery IR (Group B). Core principle: ARCHITECTURE != REALITY -- the meta-model holds architecture only; procedural reality is Findings, never new entity types. ("Oracle" = source-of-truth, not Oracle DB.)

## User Stories
- As a migration architect, I want column scale/precision/default/ordinal/identity, FK join+referenced columns, and constraint/index metadata captured verbatim so the target Postgres schema is a faithful transform of the Sybase source.
- As a migration architect, I want stored procedures, triggers, views, and sequences captured as findings with their complete verbatim bodies (secrets scrubbed) so embedded database logic is visible to the book-of-work and shape-spec.

## Specific Requirements

**Group A: enrich `physical_data_attributes` (extend existing entity)**
- Add verbatim fields: `source_type`, `scale`, `precision`, `default`, `ordinal`, plus a column-level identity/auto-increment flag -- alongside the existing `is_nullable` / `is_primary_key`.
- NEW Liquibase changeset (>=163) adding these nullable columns; numerics as boxed types (Double/Long) and the identity flag as boxed Boolean to avoid the primitive-PATCH-wipe hazard. NO type normalization -- source type captured verbatim.
- FIX three IR drops in the introspectors: Postgres `numeric_scale`/`numeric_precision` (SELECTed then discarded at `postgresIntrospection.ts` ~L229-244 -- they are aliased `num_precision`/`num_scale` but never mapped); Sybase default (hardcoded `defaultExpression: null` at `sybaseIntrospection.ts` ~L118); sequence/identity introspection (never done in either pack).
- Extend `ColumnMetadata` in `databasePacks/types.ts` to carry scale, precision, identity/auto-increment, and a sequence reference so the new fields have an IR source.

**Group A: enrich `physical_data_entities` with constraint/index JSONB metadata (extend existing entity)**
- NEW changeset (>=163) adding ONE nullable JSONB column to `physical_data_entities` (mirrors the 162-business-logic-behavior.sql precedent: nullable JSONB on an existing table).
- Shape: `{ primary_key:{name,columns[]}, unique_constraints:[{name,columns[]}], check_constraints:[{name,expression}], indexes:[{name,columns[],is_unique}] }`. This is metadata ON the entity -- NOT separate entity types.
- Sourced from the existing `KeyOrIndexMetadata` IR (`kind` already covers primary_key/unique_constraint/foreign_key/index/check_constraint).
- Views stay as `physical_data_entities` with `physical_type='View'`; their columns remain architecture on the entity. The defining SQL goes to a Finding (Group B `view_definition`), NOT onto the entity.

**Group A: enrich `logical_data_entity_relationships` with FK detail (extend existing entity)**
- Add join-columns + referenced-columns to the relationship (the FK column list on each side). It already connects physical entities via `data_entity_points` (`from_data_entity_point_id` / `to_data_entity_point_id`).
- NEW changeset (>=163); store as nullable columns or a small nullable JSONB block, snake_case.
- Sourced from `KeyOrIndexMetadata.columns` + `referencedColumns` (already present on the IR) and `RelationshipInference.fromColumns`/`toColumns`.

**Group A: NO logical<->physical mapping reconciliation (DEFERRED to Issue 2)**
- Spec 3 does NOT populate `logical_data_entity_physical_data_entities`. Reconciling DB-physical entities against pre-existing code-discovered logical entities is model-aware and belongs to Issue 2 (model-aware dedup/enrichment), which will reuse Spec 1's identity primitive.
- Invariant: NEVER synthesize a 1:1 mapping. A DB-only scan produces physical entities ONLY -- no logical layer, no mapping. Spec 3 persists physical entities standalone.
- Spec 1's identity primitive (`normalizeNameForMatch` / `resolveEntityToPointId`, 1.0/0.7/0.0 ladder in `candidateSaveBackService.ts`) is still used at save-back to resolve entity NAMES for Group A's FK relationship endpoints -- but creates NO new logical<->physical mapping.

**Group A: meta-model reference doc update**
- Update `gateway/src/config/prompts/shared/architecture-context-explainer.md` for the new attribute fields, the entity constraint/index JSONB metadata, and the relationship FK join/referenced columns.
- These are FIELD ADDITIONS to EXISTING entities only -- introduce NO new entity types to the reference.

**Group B: keep + extend the procedural-object finding vocabulary**
- KEEP the existing live vocabulary emitted by the DB packs: `stored_procedure_logic`, `hidden_business_logic`, `procedure_data_write`, `procedure_dependency`, `complex_view_logic` (the latter via `db_migration_risk` riskCategory).
- ADD three finding types: `trigger_logic`, `view_definition`, `sequence_definition`. Standardise categories across the set (`hidden_logic` for procedural bodies).
- Keep the light risk-weighting already present: DML-writing procedures `medium`, read-only procedures `info`. Triggers/views/sequences weighted by migration concern, not blanket INFO.
- All findings emit through the `FindingEmitter` singleton via the existing builders in `databasePackFindingBuilders.ts` and the per-engine `postgresFindings.ts` / `sybaseFindings.ts`.

**Group B: complete verbatim body in `detail_json` with hardened redaction + size cap**
- DROP the 200-char truncation (`redactSnippet(body, 200)` in `postgresFindings.ts` ~L440/448/513 and the Sybase equivalent). Capture the COMPLETE verbatim body.
- Harden `snippetRedaction.redactSnippet`: over a FULL body it must reliably scrub embedded credentials / connection strings / API keys (extend steps 1-3) and stamp `redacted: true` when anything was scrubbed. Unredacted bodies would otherwise persist AND reach the external LLM via `MigrationDiscoveryContextService` -- a credential-exfiltration risk.
- Replace step 4 (hard truncate) with a GENEROUS size cap (~64KB) that stamps `truncated: true` when hit -- no unbounded bodies (they would bloat the findings table + the migration-context transport). The defensive `redactSnippet(...)` double-redact inside the builders (`databasePackFindingBuilders.ts` ~L317/358/399) then inherits the new behaviour automatically.
- Alongside the body, capture complete metadata in `detail_json`: name, schema, params, the table a trigger fires on, object kind, and migration concern.

**Group B: v1 = raw verbatim body only -- NO LLM**
- v1 captures the raw verbatim (redacted, size-capped) body only. NO LLM-generated behaviour summary; a Gap-C-style behaviour block over proc bodies is explicitly DEFERRED to a later enhancement.
- This spec introduces NO gateway-relay dependency, keeping Group B offline-testable.

**Group B: reliable persistence + oracle feed**
- Findings must PERSIST reliably (the Issue 1 persistence-path fix) and feed the migration oracle via `MigrationDiscoveryContextService` -> book-of-work / shape-spec + architect/PM conversations. The service already prioritises by category (`migration_risk`, `data_quality`) and has an `includeDbFindings` path -- the new procedural findings flow through it unchanged.

**Validation / done-bar**
- DONE: offline introspection -> candidate/finding mappers + AMS model round-trips green (unit-tested). Cover the IR-drop fixes (scale/precision/default/identity/sequence), the constraint/index JSONB shape, the FK join/referenced columns, the new finding types, and the redaction+truncation behaviour (secret scrub stamps `redacted`, >64KB stamps `truncated`).
- NOT blocking: live fidelity validation against a real sample Sybase + Postgres schema (with procs/triggers/views/constraints/sequences) -- leans on the user's environment.

## Visual Design
No visual assets provided (`planning/visuals/` is empty). The feature reuses the existing Candidates stream + `FindingsTab` + candidate-details panels; the SQL body viewer reuses the existing expandable read-only pattern. No new mockups required.

## Existing Code to Leverage

**Discovery DB packs + IR types (`discovery-service/src/services/databasePacks/`)**
- `types.ts`: `IntrospectionResult` / `ProcedureMetadata` / `TriggerMetadata` / `ViewMetadata` / `ColumnMetadata` / `KeyOrIndexMetadata` -- the source for Group A fields and Group B bodies. `ColumnMetadata` needs scale/precision/identity/sequence added; `KeyOrIndexMetadata` already carries `columns` + `referencedColumns`; no sequence IR type exists yet.
- `postgresIntrospection.ts` (numeric_scale discard) + `sybaseIntrospection.ts` (hardcoded null default) -- the IR-drop fix sites.

**Finding builders + redaction (`discovery-service/src/services/`)**
- `databasePacks/postgres/postgresFindings.ts` + `sybase/sybaseFindings.ts` -- the `redactSnippet(body, 200)` call sites to de-cap; `bodyHasDml`/`bodyHasProcCall` already drive the medium/info risk-weighting.
- `findings/databasePackFindingScanners/databasePackFindingBuilders.ts` -- `buildStoredProcedureLogicFinding` / `buildHiddenBusinessLogicFinding` / `buildDbMigrationRiskFinding` accept a `bodySnippet` and already do a defensive `redactSnippet`; add `trigger_logic` / `view_definition` / `sequence_definition` builders here.
- `utils/snippetRedaction.ts` -- harden steps 1-3 (secret scrub + `redacted` stamp) and replace step 4's hard truncate with the ~64KB cap + `truncated` stamp.
- `findings/FindingEmitter.ts` -- the `findingEmitter` singleton all findings emit through.

**AMS entities + changeset precedent (`architecture-model-service/`)**
- `PhysicalDataAttributeEntity` / `PhysicalDataEntityEntity` / `LogicalDataEntityRelationshipEntity` (+ matching DTOs / services / repositories) -- the entities to extend, snake_case wire (NO `@CamelCaseWire`).
- `161-endpoint-data-effects.sql` + `162-business-logic-behavior.sql` -- the JSONB + boxed-Double changeset precedent (nullable JSONB on an existing table, DOUBLE inside JSONB mapped to boxed `Double`). Next free changeset is >=163.
- `MigrationDiscoveryContextService` -- the oracle feed; loads + prioritises findings by category, has an `includeDbFindings` path.

**Frontend (`frontend/src/`)**
- `types/model.ts`: `PhysicalDataAttribute` (~L597) + `PhysicalDataEntity` (~L585) interfaces -- extend with the new snake_case fields/metadata for the Group A ripple.
- Existing Candidates stream + `FindingsTab` + candidate-details panels -- the read-only SQL body viewer reuses the existing expandable pattern.

**RIPPLE -- Group A fields must thread through every layer (or be explicitly scoped out)**
- Group A enriches CENTRAL, already-populated entities. The new fields/metadata MUST thread through: AMS entity + DTO + mapper + (de)serialisation; frontend `model.ts` typings; the meta-model grid UI (to surface scale/precision/default/identity + the constraint/index metadata); and XLSX ingestion column maps. An AMS-only change leaves the grids / typings / XLSX silently lagging. This spec must either implement each layer or explicitly scope it out per layer in tasks.

## Out of Scope
- NO new architecture entity types (no proc / trigger / view / sequence / standalone-constraint / index entity types).
- NO 1:1 logical synthesis -- a DB-only scan produces physical entities only.
- Logical<->physical mapping reconciliation -- DEFERRED to Issue 2 (model-aware). Spec 3 persists physical entities standalone and creates no mapping.
- NO LLM in this spec -- the LLM behaviour summary over proc bodies is DEFERRED (Gap-C-style); no gateway-relay dependency introduced.
- NO type normalization -- source type captured verbatim; the Sybase->Postgres type mapping is a downstream migration / shape-spec concern.
- NO unbounded finding bodies -- bodies are size-capped (~64KB) with a `truncated` flag.
- Live fidelity validation against a real sample Sybase + Postgres schema -- leans on the user's environment; NOT blocking.
- NO edits to applied Liquibase changesets (NEW changeset files >=163 only; 161/162 are uncommitted in the working tree and must not be edited either).
- NO `discovery-service/src/**` edits during an in-flight discovery run (tsx watch auto-reload kills runs).

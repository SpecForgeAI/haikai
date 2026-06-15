# Task Breakdown: DB Structural Fidelity for Discovery (Sybase + Postgres)

## Overview
Total Tasks: 6 task groups

Two-group split per spec.md:
- **Group A — Architecture fidelity:** enrich EXISTING entities (`physical_data_attributes`, `physical_data_entities`, `logical_data_entity_relationships`) with structural truth; NO new entity types. Threads AMS -> discovery introspection fixes -> frontend ripple -> reference doc.
- **Group B — Reality findings:** extend the procedural-object finding vocabulary, harden redaction, and capture complete verbatim bodies + metadata. discovery-service only.

Core invariant (spec.md): **ARCHITECTURE != REALITY.** The meta-model holds architecture only; procedural reality is Findings. No new entity types, no 1:1 logical synthesis, no logical<->physical mapping (DEFERRED to Issue 2), no LLM, no type normalization, no unbounded bodies.

### Constraints that apply to EVERY task group (from spec.md)
- **NO new architecture entity types** (no proc / trigger / view / sequence / standalone-constraint / index entity types). Group A is FIELD ADDITIONS to existing entities only.
- **NO 1:1 logical synthesis and NO logical<->physical mapping** — `logical_data_entity_physical_data_entities` is NOT populated here (DEFERRED to Issue 2). A DB-only scan persists physical entities standalone. NEVER synthesize a 1:1 mapping.
- **NO LLM in this spec** — v1 is raw verbatim body only; the Gap-C-style behaviour summary is DEFERRED. Introduce NO gateway-relay dependency (keeps Group B offline-testable).
- **NO type normalization** — source type captured verbatim; Sybase->Postgres type mapping is a downstream concern.
- **NO unbounded finding bodies** — bodies are size-capped (~64KB) with a `truncated` flag.
- **Liquibase:** NEW changeset files only, next free number **>=163** (161/162 are uncommitted in the working tree — number off the working tree). NEVER edit applied OR working-tree changesets (even comment-only edits break startup via checksum validation).
- **AMS wire format:** snake_case (NO `@CamelCaseWire`). New numerics are boxed (`Double`/`Long`) and the identity flag is boxed `Boolean` to avoid the primitive-PATCH-wipe hazard.
- **NO `discovery-service/src/**` edits during an in-flight discovery run** (tsx watch auto-reload kills runs). Coordinate with the user before touching discovery-service src.
- **Frontend `tsc` baseline:** ~513 pre-existing errors. The bar is **no NEW errors**, not zero.
- **Findings emission:** all findings emit through the `FindingEmitter` (`findingEmitter` singleton) via the existing builders.
- **Done-bar:** offline introspection -> candidate/finding mappers + AMS model round-trips green (unit-tested). Live fidelity validation against a real Sybase + Postgres schema is NOT blocking.
- **Focused tests:** each development group writes 2-8 tests and runs ONLY those; the final gap group adds <=10 more.

---

## Task List

### Database / AMS Layer (Group A)

#### Task Group 1: AMS entity enrichment + Liquibase changesets
**Dependencies:** None

Extend three EXISTING AMS entities and thread the new fields through DTOs + mappers + repositories + (de)serialisation. snake_case wire, boxed numerics. NEW changeset files >=163 (number off the working tree; 161/162 already exist uncommitted).

- [x] 1.0 Complete AMS entity enrichment + migrations
  - [x] 1.1 Write 2-8 focused Java tests (TDD-first)
    - Limit to 2-8 highly focused tests maximum
    - Suggested: (a) `PhysicalDataAttributeEntity` round-trips the new boxed fields (`source_type`, `scale`, `precision`, `default`, `ordinal`, identity flag) with null preserved through a PATCH-style save; (b) `PhysicalDataEntityEntity` round-trips the constraint/index JSONB shape (`primary_key`/`unique_constraints[]`/`check_constraints[]`/`indexes[]`); (c) `LogicalDataEntityRelationshipEntity` round-trips FK join-columns + referenced-columns; (d) a boxed-numeric null-preservation test mirroring `project_primitive_double_dto_overwrite.md`
    - Co-locate with existing AMS tests (pattern: `DiscoveryFindingBulkReviewTest.java` under `src/test/java/.../service/discovery/`)
    - Skip exhaustive coverage of every field permutation
  - [x] 1.2 Enrich `PhysicalDataAttributeEntity` (`model/entity/PhysicalDataAttributeEntity.java`)
    - Add nullable columns alongside existing `is_nullable` / `is_primary_key`: `source_type` (String, verbatim — NO normalization), `scale` (boxed `Integer`/`Long`), `precision` (boxed `Integer`/`Long`), `default` (String — column maps to a non-reserved name e.g. `default_expression`/`column_default`; confirm against existing convention), `ordinal` (boxed `Integer`/`Long`), and an identity/auto-increment flag (boxed `Boolean`, e.g. `is_identity`)
    - Numerics boxed; identity flag boxed `Boolean` (primitive-PATCH-wipe hazard)
  - [x] 1.3 Enrich `PhysicalDataEntityEntity` (`model/entity/PhysicalDataEntityEntity.java`)
    - Add ONE nullable JSONB column (e.g. `constraints_metadata`) — mirrors the `162-business-logic-behavior.sql` precedent (nullable JSONB on an existing table, `DOUBLE`-in-JSONB -> boxed `Double`)
    - Shape: `{ primary_key:{name,columns[]}, unique_constraints:[{name,columns[]}], check_constraints:[{name,expression}], indexes:[{name,columns[],is_unique}] }`
    - Metadata ON the entity — NOT separate entity types
    - Views stay as `physical_data_entities` with `physical_type='View'`; their defining SQL goes to a Finding (Group B), NOT onto the entity
  - [x] 1.4 Enrich `LogicalDataEntityRelationshipEntity` (`model/entity/LogicalDataEntityRelationshipEntity.java`)
    - Add join-columns + referenced-columns (the FK column list on each side) as nullable columns OR a small nullable JSONB block, snake_case
    - It already connects physical entities via `data_entity_points` (`from_data_entity_point_id` / `to_data_entity_point_id`) — do NOT change those
  - [x] 1.5 Author NEW Liquibase changesets (>=163)
    - One changeset file per logical change under `architecture-model-service/src/main/resources/db/changelog/sql/` (e.g. `163-physical-attribute-structural-fidelity.sql`, `164-physical-entity-constraints-jsonb.sql`, `165-relationship-fk-columns.sql`) and register in the changelog include order
    - All new columns nullable + additive; JSONB column mirrors 162 precedent
    - Confirm the next free number off the WORKING TREE (161/162 present uncommitted). NEVER edit 161/162 or any applied changeset
  - [x] 1.6 Thread new fields through DTOs + mappers + repositories
    - `PhysicalDataAttributeDto`, `PhysicalDataEntityDto`, `LogicalDataEntityRelationshipDto` (`model/dto/entity/` + `model/dto/relationship/`) — add the same fields; snake_case wire, NO `@CamelCaseWire` (global SNAKE_CASE default applies)
    - Entity<->DTO mappers and any (de)serialisation; verify repositories (`PhysicalDataAttributeRepository`, `PhysicalDataEntityRepository`, `LogicalDataEntityRelationshipRepository`) need no signature changes beyond the new fields
    - JSONB columns map to a typed-enough Java structure (or `JsonNode`/String) consistent with the 162 approach; `DOUBLE`-in-JSONB -> boxed `Double`
  - [x] 1.7 Run ONLY the 1.1 tests
    - Verify the new changesets apply cleanly (migration runs) and round-trips pass
    - Do NOT run the entire AMS test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass; new Liquibase changesets (>=163) apply cleanly
- New attribute fields, the entity constraint/index JSONB, and the relationship FK columns persist and round-trip; nulls preserved through PATCH (boxed types)
- Wire format is snake_case (no `@CamelCaseWire`); no edits to 161/162 or any applied changeset
- NO new entity types introduced; `logical_data_entity_physical_data_entities` untouched

---

### Discovery Introspection Layer (Group A)

#### Task Group 2: IR-drop fixes + ColumnMetadata extension + candidate feed
**Dependencies:** Task Group 1 (the AMS fields the IR feeds into)

Fix three introspection drops and extend the IR so the new Group A fields have a source. discovery-service src — coordinate with the user (no edits during an in-flight run).

- [x] 2.0 Complete introspection fixes + IR extension
  - [x] 2.1 Write 2-8 focused discovery tests (TDD-first)
    - Limit to 2-8 highly focused tests maximum; follow existing discovery test conventions (co-locate under `discovery-service/src/__tests__/`)
    - Suggested: (a) Postgres introspection maps `num_scale`/`num_precision` (aliased at `postgresIntrospection.ts` ~L229-230) into `ColumnMetadata.scale`/`.precision` instead of discarding; (b) Sybase introspection extracts the column default instead of hardcoding `defaultExpression: null` (`sybaseIntrospection.ts` ~L118); (c) sequence/identity introspection populates the new identity/sequence IR fields for both engines; (d) the physical entity/attribute candidate mapper carries scale/precision/default/ordinal/identity + the constraint/index metadata + FK join/referenced columns through to the candidate
    - Use offline fixtures/mocked catalog rows — NO live DB (done-bar is offline)
  - [x] 2.2 Extend `ColumnMetadata` + IR types (`databasePacks/types.ts`)
    - Add to `ColumnMetadata`: `scale`, `precision` (numeric), an identity/auto-increment flag, and a sequence reference (`ordinalPosition` + `defaultExpression` + `maxLength` already exist)
    - Add a sequence IR carrier (no sequence type exists yet) — minimal shape sufficient to populate the attribute identity/sequence fields and the Group B `sequence_definition` finding
    - `KeyOrIndexMetadata` already carries `columns` + `referencedColumns` (no change needed) — it is the source for the entity constraint/index JSONB and the relationship FK columns
  - [x] 2.3 FIX Postgres `numeric_scale`/`numeric_precision` drop (`postgres/postgresIntrospection.ts`)
    - Map the SELECTed-then-discarded `num_precision`/`num_scale` aliases (~L229-244) into `ColumnMetadata.precision`/`.scale`
    - Do NOT regress the existing `maxLength` fallback logic
  - [x] 2.4 FIX Sybase hardcoded null default (`sybase/sybaseIntrospection.ts`)
    - Replace `defaultExpression: null` (~L118) with the extracted column default (the SELECT at ~L80 already references a default — wire it through)
  - [x] 2.5 ADD sequence/identity introspection (both engines)
    - Postgres: identity columns + serial/sequence defaults. Sybase: identity columns + numbered/sequence semantics
    - Populate the new `ColumnMetadata` identity/sequence fields; surface a sequence record for Group B `sequence_definition`
  - [x] 2.6 Feed new fields into physical entity/attribute candidates (DB pack)
    - Thread scale/precision/default/ordinal/identity onto the physical ATTRIBUTE candidate
    - Build the constraint/index JSONB (from `KeyOrIndexMetadata.kind` = primary_key/unique_constraint/check_constraint/index) onto the physical ENTITY candidate
    - Thread FK join-columns + referenced-columns (from `KeyOrIndexMetadata.columns`/`referencedColumns` + `RelationshipInference.fromColumns`/`toColumns`) onto the relationship candidate
    - DB-only scans persist physical entities STANDALONE — do NOT synthesize logical entities or any logical<->physical mapping (DEFERRED to Issue 2). Spec 1's identity primitive (`normalizeNameForMatch`/`resolveEntityToPointId`, 1.0/0.7/0.0 ladder in `mcp-server/src/services/candidateSaveBackService.ts`) is reused at save-back ONLY to resolve entity NAMES for the FK relationship endpoints — it creates NO new mapping
  - [x] 2.7 Run ONLY the 2.1 tests
    - Verify the three drops are fixed and candidates carry the new fields offline
    - Do NOT run the entire discovery test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass (offline, no live DB)
- Postgres scale/precision mapped through; Sybase default extracted; sequence/identity introspected for both engines
- Physical attribute/entity/relationship candidates carry the new fields; constraint/index JSONB and FK columns sourced from existing IR
- NO logical synthesis and NO logical<->physical mapping created; physical entities persist standalone

---

### Frontend Layer (Group A ripple)

#### Task Group 3: model.ts typings + meta-model grid UI + XLSX column maps
**Dependencies:** Task Group 1 (snake_case field names/shape are the contract)

Thread the new Group A fields through the frontend so the grids/typings/XLSX do not silently lag the AMS change.

- [x] 3.0 Complete frontend ripple
  - [x] 3.1 Write 2-8 focused Vitest tests (TDD-first)
    - Limit to 2-8 highly focused tests maximum
    - Suggested: (a) a `PhysicalDataAttribute` carrying scale/precision/default/ordinal/identity renders those columns in the meta-model grid; (b) a `PhysicalDataEntity` with the constraint/index JSONB surfaces it (PK / unique / check / index summary) in the grid/detail; (c) XLSX ingestion maps the new attribute columns when present and tolerates their absence (back-compat)
    - Follow existing Vitest conventions
  - [x] 3.2 Extend `model.ts` typings (`frontend/src/types/model.ts`)
    - `PhysicalDataAttribute` (~L597): add `source_type`, `scale`, `precision`, `default` (or the chosen snake_case name from 1.2), `ordinal`, identity flag (e.g. `is_identity`) — all optional, snake_case, matching the AMS DTO names exactly
    - `PhysicalDataEntity` (~L585): add the optional constraint/index metadata field (snake_case, matching the AMS DTO)
    - Add the relationship FK join/referenced-columns field to the corresponding relationship interface
  - [x] 3.3 Surface the new attribute fields in the meta-model grid UI
    - Add scale / precision / default / ordinal / identity columns (or a compact composite) to the physical attribute grid; read-only display of verbatim values
  - [x] 3.4 Surface the entity constraint/index metadata
    - Render the PK / unique / check / index summary on the physical entity grid or its detail view; reuse the existing expandable read-only pattern (no new mockups — `planning/visuals/` is empty)
  - [x] 3.5 Check + update XLSX ingestion column maps
    - Locate the XLSX column maps for physical attributes/entities; add the new attribute fields where the import format carries them; tolerate absence (additive, back-compatible)
    - If a given layer genuinely does not apply (e.g. XLSX has no source for a field), EXPLICITLY scope it out here rather than leaving it silently lagging
  - [x] 3.6 Run ONLY the 3.1 tests + confirm no NEW tsc errors
    - Run ONLY the 3.1 Vitest tests
    - Run `tsc` and confirm the error count has NOT increased above the ~513 pre-existing baseline (no NEW errors); do NOT attempt to clear the baseline
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- `model.ts` interfaces carry the new snake_case fields (names match the AMS DTOs exactly)
- Meta-model grid surfaces scale/precision/default/ordinal/identity + the constraint/index metadata (read-only)
- XLSX column maps updated where applicable, or each non-applicable layer explicitly scoped out
- No NEW tsc errors above the ~513 baseline

---

### Documentation (Group A)

#### Task Group 4: meta-model reference doc update
**Dependencies:** Task Groups 1-3 (final field/shape names)

- [x] 4.0 Update the meta-model reference doc
  - [x] 4.1 Update `gateway/src/config/prompts/shared/architecture-context-explainer.md`
    - Document the new `physical_data_attributes` fields (`source_type`, `scale`, `precision`, `default`, `ordinal`, identity flag)
    - Document the `physical_data_entities` constraint/index JSONB metadata (PK / unique / check / index shape)
    - Document the `logical_data_entity_relationships` FK join/referenced columns
    - These are FIELD ADDITIONS to EXISTING entities only — introduce NO new entity types to the reference; match the exact snake_case names landed in Groups 1-3
  - [x] 4.2 Verify consistency
    - Field names in the doc match the AMS DTOs (Group 1) and `model.ts` (Group 3) exactly; no proc/trigger/view/sequence/constraint/index entity types described

**Acceptance Criteria:**
- Reference doc describes the new attribute fields, entity constraint/index metadata, and relationship FK columns
- Names are consistent with the AMS DTOs and frontend typings
- NO new entity types added to the reference

---

### Discovery Findings Layer (Group B)

#### Task Group 5: extended finding vocabulary + hardened redaction + complete verbatim bodies
**Dependencies:** Task Group 2 (the IR carriers, esp. the sequence record for `sequence_definition`)

Build on the EXISTING emission. discovery-service src only — coordinate with the user (no edits during an in-flight run). NO LLM, NO gateway-relay dependency (offline-testable).

- [x] 5.0 Complete Group B findings
  - [x] 5.1 Write 2-8 focused discovery tests (TDD-first)
    - Limit to 2-8 highly focused tests maximum; follow existing discovery test conventions (extend `discovery-service/src/__tests__/snippetRedaction.test.ts` and add a findings test)
    - Suggested: (a) `redactSnippet` over a FULL body scrubs embedded credentials / connection strings / API keys (steps 1-3) and stamps `redacted: true`; (b) a >64KB body is capped and stamps `truncated: true`; a small clean body stamps neither; (c) the new `trigger_logic` / `view_definition` / `sequence_definition` builders emit through `FindingEmitter` with complete `detail_json` (name, schema, params, trigger's table, object kind, migration concern) + the full redacted body; (d) DML-writing proc -> `medium`, read-only proc -> `info` (risk-weighting preserved)
    - Offline only — NO LLM, NO gateway relay
  - [x] 5.2 Harden `redactSnippet` (`discovery-service/src/utils/snippetRedaction.ts`)
    - Strengthen the secret-scrub (steps 1-3: Basic-auth header, secret-bearing keys, quoted-literal collapse) so a FULL body is robustly redacted; emit a `redacted: true` marker when anything was scrubbed
    - REPLACE step 4's hard truncate (currently `slice(0, maxLen)`, default 200) with a GENEROUS size cap (~64KB) that emits `truncated: true` when hit — no unbounded bodies
    - Return shape must carry the body + the `redacted`/`truncated` flags (change the signature/return to an object, OR add a sibling function); update ALL existing call sites accordingly. Note the function is shared by code-pack scanners (`javaFindingScanner.ts`, `springClassicFindingScanner.ts`) — preserve their behaviour (e.g. keep a 200-style snippet path where they pass an explicit small `maxLen`)
  - [x] 5.3 De-cap the DB-pack call sites (`postgres/postgresFindings.ts` + `sybase/sybaseFindings.ts`)
    - Replace `redactSnippet(v.definition, 200)` / `redactSnippet(p.body, 200)` / `redactSnippet(t.actionStatement, 200)` (postgres ~L440/448/513; sybase ~L379/386/446) with the full-body + size-cap path
    - Capture the COMPLETE verbatim body (redacted, size-capped) plus the `redacted`/`truncated` flags into `detail_json`
  - [x] 5.4 Add `trigger_logic` / `view_definition` / `sequence_definition` builders (`findings/databasePackFindingScanners/databasePackFindingBuilders.ts`)
    - ADD three builders alongside the existing set (`buildStoredProcedureLogicFinding`, `buildHiddenBusinessLogicFinding`, `buildDbMigrationRiskFinding`, etc.)
    - KEEP the existing vocabulary (`stored_procedure_logic`, `hidden_business_logic`, `procedure_data_write`, `procedure_dependency`, `complex_view_logic` via `db_migration_risk`)
    - Standardise categories (`hidden_logic` for procedural bodies)
    - The defensive double-redact inside the builders (~L317/358/399) inherits the new behaviour automatically — verify it does NOT re-truncate at 200
    - `detail_json` for each: name, schema, params, the table a trigger fires on (for `trigger_logic`), object kind, migration concern, plus the full redacted/size-capped body + `redacted`/`truncated` flags
  - [x] 5.5 Wire the new builders into the per-engine finding emission
    - Emit `trigger_logic` from `TriggerMetadata`, `view_definition` from `ViewMetadata`, `sequence_definition` from the new sequence IR record (Group 2) — both Postgres and Sybase
    - Risk-weighting: DML-writing procs `medium`, read-only `info` (keep `bodyHasDml`/`bodyHasProcCall`); triggers/views/sequences weighted by migration concern, NOT blanket INFO
    - All emit through the `FindingEmitter` singleton
    - v1 = raw verbatim body only — NO LLM summary, NO gateway-relay dependency
  - [x] 5.6 Confirm the oracle feed path
    - Findings flow through `MigrationDiscoveryContextService` (existing `includeDbFindings` path + category prioritisation `migration_risk`/`data_quality`) UNCHANGED — verify the new finding types are not filtered out; no code change expected beyond confirmation
  - [x] 5.7 Run ONLY the 5.1 tests
    - Verify redaction hardening, the size cap + flags, and the three new finding types offline
    - Do NOT run the entire discovery test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass (offline; no LLM, no gateway relay)
- `redactSnippet` robustly scrubs secrets over full bodies and stamps `redacted: true`; >64KB stamps `truncated: true`; no unbounded bodies
- All existing call sites (incl. code-pack scanners) updated and behaviour-preserved
- `trigger_logic` / `view_definition` / `sequence_definition` emit via `FindingEmitter` with complete verbatim bodies + full `detail_json` metadata; existing vocabulary kept
- Risk-weighting preserved (DML procs `medium`, read-only `info`); procedural categories standardised to `hidden_logic`
- Findings flow through `MigrationDiscoveryContextService` unchanged

---

### Testing

#### Task Group 6: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Group 1 (AMS Java, 2-8), Group 2 (discovery introspection, 2-8), Group 3 (frontend Vitest, 2-8), Group 5 (discovery findings, 2-8)
    - Total existing: approximately 8-32 tests
  - [x] 6.2 Analyze coverage gaps for THIS feature only
    - Identify critical workflows lacking coverage; focus ONLY on this spec's requirements
    - Priority end-to-end paths: introspect -> candidate/finding mappers -> AMS model round-trip (Group A); introspect -> findings -> `detail_json` body + redaction/size-cap behaviour (Group B)
    - Do NOT assess whole-application coverage
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Maximum of 10 new tests to fill critical gaps
    - Cover the end-to-end introspect->persist->(findings)->display path AND the redaction/cap behaviour (secret scrub stamps `redacted`; >64KB stamps `truncated`)
    - Scope: Sybase + Postgres. Done-bar is offline mappers + AMS round-trips green — do NOT add live-DB fidelity tests (not blocking)
    - Skip edge cases / performance / accessibility unless business-critical
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests for this spec (Groups 1, 2, 3, 5, and 6.3) — approximately 18-42 tests
    - Confirm frontend still has no NEW tsc errors above the ~513 baseline
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-42 total)
- End-to-end introspect->persist->(findings)->display covered for Sybase + Postgres; redaction `redacted`/`truncated` behaviour covered
- No more than 10 additional tests added
- Testing focused exclusively on this spec; offline mappers + AMS round-trips green (live fidelity not blocking)

---

## Execution Order

Recommended implementation sequence:
1. AMS entity enrichment + Liquibase changesets (Task Group 1) — defines the snake_case contract
2. Discovery introspection fixes + IR extension + candidate feed (Task Group 2) — depends on Group 1 fields
3. Frontend ripple: typings + grid + XLSX (Task Group 3) — depends on Group 1 contract
4. Meta-model reference doc update (Task Group 4) — depends on final names from 1-3
5. Discovery findings: vocabulary + redaction + bodies (Task Group 5) — depends on Group 2 IR (sequence record)
6. Test Review & Gap Analysis (Task Group 6)

Groups 3, 4, and 5 can proceed in parallel once their dependencies (1 / 2) are in place. Groups 2 and 5 touch `discovery-service/src/**` — do NOT edit during an in-flight discovery run.

# Spec Requirements: DB Structural Fidelity for Discovery (Sybase + Postgres) — Gap D

## Initial Description

Part of the HAIKAI discovery richness program (like-for-like API/DB migration tool). This is the DB-side specification oracle (Specs 1 and 2 — endpoint→data-effect graph and business-logic behaviour — are already built).

TERMINOLOGY: "oracle" = source-of-truth / specification authority (NOT Oracle Database). DB packs in scope are **Sybase** (legacy source) and **PostgreSQL** (target).

**Core principle — ARCHITECTURE ≠ REALITY.** The architecture meta-model holds **ARCHITECTURE only**. Important non-architecture reality (the runnable detail of procedural database objects) is captured as **Findings**, fed from the discovery IR — **never** as new meta-model entity types. The migration specification oracle is the combination of: the architecture meta-model (kept clean — structural truth only), PLUS Findings (the evidence/reality layer), PLUS architect / PM conversations.

This corrects an earlier WRONG framing that proposed (a) synthesizing 1:1 logical entities from physical tables and (b) minting NEW meta-model entity types for stored procedures, triggers, views, sequences, and standalone constraints/indexes. That approach is **rejected**. No new architecture entity types. No 1:1 logical synthesis.

A DB migration (Sybase→Postgres) is a STATIC schema transform — there is no runtime "fire the same request at both" for a schema, so Discovery's captured schema IS the migration source of truth. Today the DB scan captures table / column / type-name / nullable / PK but DROPS or under-captures the detail a like-for-like schema migration needs (scale / precision / default / ordinal / identity, FK join+referenced columns, unique/index/check constraints, and the SQL bodies of stored procedures / triggers / views / sequences). Much is introspected-THEN-DISCARDED or under-persisted because the work has had nowhere structured to land.

The work splits into TWO task groups: enrich EXISTING architecture entities for structural truth (Group A), and make the procedural reality land as RICH, PERSISTED findings fed from the IR (Group B).

## Requirements Discussion

### First Round Questions

**Q1: Findings vocabulary for procedural objects** — the `findingType` / `category` names + the severity model (procs/triggers as INFO evidence, or risk-weighted by migration concern?), and exactly what goes in `detail_json`. A vocabulary already exists in the packs today (`stored_procedure_logic`, `hidden_business_logic`, `procedure_data_write`, `procedure_dependency`, `complex_view_logic`, categories like `hidden_logic`, mixed severities) — the call is whether to keep/extend that or rationalise it for v1.

**Answer:** KEEP and EXTEND the existing vocabulary (do not throw it away). The DB packs already emit structured procedural-object findings via `FindingEmitter` with a populated `detail_json` and a live vocabulary: `stored_procedure_logic`, `hidden_business_logic`, `procedure_data_write`, `procedure_dependency`, `complex_view_logic`. Add three new finding types to cover the gaps: `trigger_logic`, `view_definition`, and `sequence_definition`. Standardise the categories across the set. Keep the light risk-weighting already present: DML-writing procedures are `medium`, read-only procedures are `info`.

**Q2(a): What goes in `detail_json` (richness)** — currently the body goes through `redactSnippet(body, 200)` (a 200-char snippet, not the full verbatim body).

**Answer:** Capture the **complete verbatim body** in `detail_json`, with two hardening requirements (added 2026-05-29 pre-build review):
  - **Robust full-body secret-redaction.** `redactSnippet` only ever had to scrub a 200-char snippet; over a FULL body it must reliably redact embedded credentials / connection strings / API keys (proc/trigger bodies commonly contain them) and stamp a `redacted: true` marker when anything was scrubbed. Unredacted bodies would otherwise be persisted AND sent to the external LLM via `MigrationDiscoveryContextService` — a credential-exfiltration risk.
  - **Generous size cap with a `truncated` flag** (≈64KB). Drop the 200-char cap, but DO NOT store unbounded bodies (a giant proc would bloat the findings table + the migration-context transport); cap and mark `truncated: true`.

  Alongside the body, capture complete metadata: name, schema, params, the table a trigger fires on, object kind, and migration concern.

**Q2(b): LLM behaviour summary?** — Do proc/trigger findings get an LLM-generated behaviour summary (mirroring Gap C / business-logic `behavior` block) so the migration can re-implement, or just the raw verbatim body in v1?

**Answer:** **v1 = raw verbatim body only. DEFER the LLM behaviour summary.** No gateway-relay dependency in this spec — this keeps Group B offline-testable. A Gap-C-style behaviour summary over proc bodies is a noted later enhancement, explicitly out of scope here.

**Q3: Constraints/indexes JSONB shape** — the exact structured shape attached to the physical entity (unique constraints, check constraints + expressions, indexes + columns + uniqueness).

**Answer:** Attach structured JSONB metadata to `physical_data_entities` with this shape:
```
{
  primary_key:        { name, columns[] },
  unique_constraints: [ { name, columns[] } ],
  check_constraints:  [ { name, expression } ],
  indexes:            [ { name, columns[], is_unique } ]
}
```
These are metadata on the table entity — NOT separate entity types.

**Q4: Reconciliation aggressiveness** for the logical↔physical mapping — confidence threshold; auto-link vs reviewer. (The shared primitive grades exact=1.0 / normalized=0.7 / none=0.0.)

**Answer (revised 2026-05-29 pre-build review): DEFERRED to Issue 2.** Spec 3 does NOT populate the `logical_data_entity_physical_data_entities` mapping. Reconciling DB-physical entities against pre-existing code-discovered logical entities is inherently model-aware — it is a slice of Issue 2 (model-aware dedup/enrichment), and building it here risks half-implementing Issue 2. Spec 3 persists physical entities standalone. The invariant still holds: NEVER synthesize a 1:1 mapping; a DB-only scan produces physical entities ONLY (no logical layer, no mapping). Issue 2 will own the reconciliation, reusing Spec 1's identity primitive.

**Q5: Validation / done-bar** — does the user have a sample Sybase + Postgres schema (with procs/triggers/views/constraints) to run against; is the done-bar offline mappers + model round-trips green?

**Answer:** The done-bar for THIS spec is **offline introspection→candidate/finding mappers + AMS model round-trips green** (unit-tested). Live fidelity validation leans on the user's environment (needs a sample Sybase + Postgres schema with procs/triggers/views/constraints/sequences) and is **NOT blocking** this spec.

**Q6: Confirm the meta-model reference doc update** for the enriched attribute fields + constraint/index metadata + FK join-columns.

**Answer:** CONFIRMED. Update the meta-model reference doc (`gateway/src/config/prompts/shared/architecture-context-explainer.md`) for these field/metadata additions. These are FIELD ADDITIONS to EXISTING entities; NO new entity types are introduced to the reference.

### Existing Code to Reference

**Similar Features Identified:**

- **Discovery DB packs (introspection + IR)** — Path: `discovery-service/src/services/databasePacks/*` and `discovery-service/src/services/databasePacks/types.ts`. The IR types the introspectors already build: `IntrospectionResult`, `ProcedureMetadata`, `TriggerMetadata`, `ViewMetadata`, `ColumnMetadata`, `KeyOrIndexMetadata`. Group A's enriched fields and Group B's finding bodies are sourced from this IR.
- **Existing proc/trigger/view finding builders** — Path: `discovery-service/src/services/databasePacks/postgres/postgresFindings.ts` (and the Sybase equivalent `sybase/sybaseFindings.ts`). These contain the `redactSnippet(body, 200)` cap that must be removed (keep secret-redaction, drop length truncation).
- **Finding emission** — Path: `discovery-service/src/services/findings/FindingEmitter.ts` (`findingEmitter` singleton). All findings emit through this.
- **Identity primitive (from Spec 1)** — Path: `mcp-server/src/services/candidateSaveBackService.ts` — `normalizeNameForMatch` + `resolveEntityToPointId` + the exact/normalized/none confidence ladder (1.0 / 0.7 / 0.0). Used at save-back to resolve entity names for Group A's FK relationships. (The Q4 logical↔physical mapping reconciliation that would also use it is DEFERRED to Issue 2.)
- **AMS entities to extend** — `PhysicalDataAttributeEntity`, `PhysicalDataEntityEntity`, `LogicalDataEntityRelationshipEntity` (+ their matching DTOs / services / repositories). Changesets live under `architecture-model-service/src/main/resources/db/changelog/sql/`.
- **AMS migration-context feed** — `MigrationDiscoveryContextService` → book-of-work / shape-spec. This is how persisted findings reach the oracle.
- **Frontend** — candidate-details panels + `FindingsTab` (the read-only SQL body viewer reuses the existing expandable pattern here).

### Follow-up Questions

No follow-up questions. All six questions were resolved and user-approved before requirements documentation; the spec was relayed as COMPLETE.

## Visual Assets

### Files Provided:

No visual assets provided. (Bash check of `planning/visuals/` returned no image files.)

### Visual Insights:

None. The feature reuses the existing Candidates stream + Findings tab + a read-only SQL body viewer (expandable pattern); no new design mockups are required.

## Requirements Summary

### Functional Requirements

**Group A — Architecture fidelity (extend EXISTING meta-model entities; NO new types):**

- **`physical_data_attributes`**: add verbatim **source_type**, **scale**, **precision**, **default**, **ordinal**, and a column-level **identity/auto-increment** flag (alongside existing `is_nullable` / `is_primary_key`). FIX the introspection drops:
  - Postgres `numeric_scale` — currently queried then discarded.
  - Sybase default — currently hardcoded null.
  - sequence/identity introspection — never done.
- **`physical_data_entities`**: add structured JSONB metadata `{ primary_key:{name,columns[]}, unique_constraints:[{name,columns[]}], check_constraints:[{name,expression}], indexes:[{name,columns[],is_unique}] }`. Metadata on the entity — not separate types. **Views stay as `physical_data_entities`** (`physical_type='View'`); their columns are architecture and stay on the entity (the defining SQL goes to a Finding, see Group B).
- **`logical_data_entity_relationships`**: enrich with **join-columns + referenced-columns** (FK detail). It already connects physical entities via `data_entity_points`.
- **`logical_data_entity_physical_data_entities` mapping**: NOT populated in this spec — **DEFERRED to Issue 2** (model-aware dedup/enrichment), which owns reconciling DB-physical entities against pre-existing code-discovered logical entities (reusing Spec 1's identity primitive). Spec 3 persists physical entities standalone; it still NEVER synthesizes a 1:1 mapping, and a DB-only scan produces physical entities only (no logical layer, no mapping).
- Update the meta-model reference doc (`gateway/src/config/prompts/shared/architecture-context-explainer.md`) for the field/metadata additions (NO new entity types).

**Group B — Reality findings (rich, persisted; fed from the IR; NOT entities; building on existing emission):**

- KEEP + EXTEND the existing procedural-object finding vocabulary (`stored_procedure_logic`, `hidden_business_logic`, `procedure_data_write`, `procedure_dependency`, `complex_view_logic`). ADD: `trigger_logic`, `view_definition`, `sequence_definition`. Standardise categories.
- Capture the **complete verbatim body** in `detail_json` — DROP the 200-char `redactSnippet` cap, but apply **robust full-body secret-redaction** (scrub embedded credentials / connection strings / keys; stamp `redacted` when scrubbed) and a **generous size cap (≈64KB) with a `truncated` flag** (no unbounded bodies). Plus complete metadata (name, schema, params, the table a trigger fires on, object kind, migration concern).
- **v1 = raw verbatim body only**; LLM behaviour summary deferred (no gateway-relay dependency in this spec; keeps Group B offline-testable).
- Keep the light risk-weighting already present: DML-writing procs `medium`, read-only `info`.
- Findings must PERSIST reliably (Issue 1 fix) and feed the migration oracle via `MigrationDiscoveryContextService` → book-of-work / shape-spec + architect/PM conversations.

### Reusability Opportunities

- Source Group A enriched fields and Group B finding bodies from the existing IR (`IntrospectionResult` / `ProcedureMetadata` / `TriggerMetadata` / `ViewMetadata` / `ColumnMetadata` / `KeyOrIndexMetadata`) in `discovery-service/src/services/databasePacks/types.ts`.
- Extend the existing finding builders in `postgres/postgresFindings.ts` + `sybase/sybaseFindings.ts` (remove the `redactSnippet(body,200)` length cap; keep secret-redaction). Emit via the `FindingEmitter` singleton.
- Reuse the Spec 1 identity primitive in `candidateSaveBackService.ts` (`normalizeNameForMatch` / `resolveEntityToPointId` / the 1.0 / 0.7 / 0.0 ladder) for the Q4 logical↔physical reconciliation.
- Extend existing AMS entities (`PhysicalDataAttributeEntity` / `PhysicalDataEntityEntity` / `LogicalDataEntityRelationshipEntity`) and their DTOs/services/repositories; reuse the 161/162 JSONB + boxed-Double changeset precedent.
- Reuse the existing Candidates stream + `FindingsTab` + candidate-details panels; the SQL body viewer reuses the existing expandable read-only pattern.
- Reuse `MigrationDiscoveryContextService` as the oracle feed for persisted findings.

### Scope Boundaries

**In Scope:**

- Group A: enriched `physical_data_attributes` fields (source_type, scale, precision, default, ordinal, identity flag) + the three introspection-drop fixes; `physical_data_entities` constraint/index JSONB metadata; `logical_data_entity_relationships` FK join/referenced columns; meta-model reference doc update.
- Group B: extended procedural-object finding vocabulary (+ `trigger_logic` / `view_definition` / `sequence_definition`); full verbatim bodies + complete `detail_json` metadata; reliable persistence; risk-weighting kept; oracle feed.
- Validation: offline introspection→candidate/finding mappers + AMS model round-trips, unit-tested.

**Out of Scope:**

- NO new architecture entity types (no proc/trigger/view/sequence/standalone-constraint/index entity types).
- NO 1:1 logical synthesis (DB-only scan = physical-only).
- **Logical↔physical mapping reconciliation — DEFERRED to Issue 2.** It presupposes pre-existing logical entities and is model-aware; building it here would half-implement Issue 2. Spec 3 persists physical entities standalone.
- NO LLM in this spec — the LLM behaviour summary over proc bodies is DEFERRED to a later enhancement (Gap-C-style); no gateway-relay dependency here.
- NO type normalization — source type captured verbatim (the Sybase→Postgres type mapping is a downstream migration / shape-spec concern).
- Live fidelity validation against a real sample Sybase + Postgres schema — leans on the user's environment; NOT blocking this spec.

### Technical Considerations

- **AMS wire format**: snake_case by default; new boxed numerics (boxed Double/Long) to avoid the primitive-PATCH-wipe hazard.
- **Liquibase**: NEW changeset files ONLY (never edit applied; highest applied is 162, so next free is **≥163**). Reuse the 161/162 JSONB + boxed-Double precedent.
- **Discovery runtime**: NO `discovery-service/src/**` edits during an in-flight run (tsx watch auto-reload kills runs).
- **Findings emission**: all findings via the `FindingEmitter` (`findingEmitter` singleton).
- **No LLM**: any future LLM work would route through the gateway relay; this spec introduces no such dependency.
- **Reconciliation**: the logical↔physical mapping population is **DEFERRED to Issue 2** (model-aware). Spec 3 does not reconcile; physical entities persist standalone. Spec 1's identity primitive is still used at save-back to resolve entity names for Group A's FK relationships, but NO new logical↔physical mapping is created here.
- **Blast radius / ripple (pre-build review):** Group A enriches CENTRAL, already-populated entities, so the new fields must be threaded through every layer or explicitly scoped out: AMS entity + DTO + mapper + (de)serialisation; frontend `model.ts` typings; the meta-model grid UI (to surface scale / precision / default / identity + the constraint/index metadata); and XLSX ingestion column maps. An AMS-only change will leave the grids / typings / XLSX silently lagging.
- **Persistence**: relies on the Issue 1 persistence-path fix so findings land reliably and feed `MigrationDiscoveryContextService`.

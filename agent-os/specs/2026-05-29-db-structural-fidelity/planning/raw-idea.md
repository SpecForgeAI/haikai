# Spec 3 — DB structural fidelity for discovery (Sybase + Postgres) — Gap D

Part of the HAIKAI discovery richness program (like-for-like API/DB migration tool). North star: memory `project_migration_ultimate_goal`. Specs 1 (endpoint→data-effect graph) and 2 (business-logic behaviour) are built. This is the DB-side specification oracle.

TERMINOLOGY: "oracle" = source-of-truth / specification authority (NOT Oracle Database). DB packs in scope are **Sybase** (legacy source) and **PostgreSQL** (target).

## Core principle (settled with the user) — ARCHITECTURE ≠ REALITY

The architecture meta-model holds **ARCHITECTURE only**. Important non-architecture reality (the runnable detail of procedural database objects) is captured as **Findings**, fed from the discovery IR — **never** as new meta-model entity types.

The migration specification ORACLE is the combination of:
- the architecture meta-model (kept clean — structural truth only), PLUS
- Findings (the evidence/reality layer), PLUS
- architect / PM conversations.

This corrects an earlier WRONG framing of this spec that proposed (a) synthesizing 1:1 logical entities from physical tables and (b) minting NEW meta-model entity types for stored procedures, triggers, views, sequences, and standalone constraints/indexes. That approach is rejected. **No new architecture entity types. No 1:1 logical synthesis.**

## Problem / goal

A DB migration (Sybase→Postgres) is a STATIC schema transform — there is no runtime "fire the same request at both" for a schema, so Discovery's captured schema IS the migration source of truth (the one place Discovery is genuinely the oracle). Today the DB scan captures table / column / type-name / nullable / PK but DROPS or under-captures the detail a like-for-like schema migration needs:
- column scale / precision / default / ordinal (some introspected-then-discarded; see drops below),
- FK join-columns + referenced columns,
- unique / index / check constraints,
- stored procedures / triggers / views (with SQL bodies) / sequences / identity.

Much is introspected-THEN-DISCARDED or under-persisted because the work has had nowhere structured to land. The fix is two distinct groups: enrich EXISTING architecture entities for structural truth (Group A), and make the procedural reality land as RICH, PERSISTED findings fed from the IR (Group B).

## ONE spec, TWO task groups

### (A) Architecture fidelity — extend EXISTING meta-model entities; NO new entity types

- **`physical_data_attributes`**: add verbatim **source type**, **scale**, **precision**, **default**, **ordinal** (alongside the existing `is_nullable` / `is_primary_key`). FIX the introspection drops:
  - Postgres `numeric_scale` — currently queried then discarded.
  - Sybase default — currently hardcoded null.
  - sequences — never introspected.
- **`physical_data_entities`**: **structured metadata** (JSONB) for unique constraints, check constraints (with expressions), and indexes (columns + uniqueness). These are metadata on the table entity — NOT separate entity types.
- **FK relationships**: enrich the EXISTING `logical_data_entity_relationships` (it already connects physical entities too, via `data_entity_points`) with **join-columns + referenced-columns**.
- **Views**: keep as `physical_data_entities` (already emitted with `physical_type='View'`); the view's columns are architecture and stay on the entity; the **defining SQL goes to a Finding** (reality), not the entity.
- **`logical_data_entity_physical_data_entities` mapping**: when BOTH a code scan (logical) and a DB scan (physical) exist, populate the REAL mapping by **conservative reconciliation** using Spec 1's normalized-name + confidence identity primitive (high-confidence auto-link only; otherwise the reviewer links). **NEVER synthesize a 1:1 mapping. A DB-only scan produces physical entities ONLY — no logical layer is auto-created.**
- The **meta-model reference doc** (`gateway/src/config/prompts/shared/architecture-context-explainer.md`) must be updated for the enriched `physical_data_attributes` fields + the constraint/index metadata + the FK join-columns. These are FIELD ADDITIONS to EXISTING entities; NO new types are introduced to the reference.

### (B) Reality — rich, persisted Findings, fed from the IR; NOT entities

- **Stored procedures, triggers, sequences, view-defining SQL** → `discovery_findings` carrying the **full body** + structured metadata in `detail_json` (name, schema, params, the table a trigger fires on, object kind, migration concern). Sourced from the IR the introspectors already build (`IntrospectionResult`: `ProcedureMetadata` / `TriggerMetadata` / `ViewMetadata`).
- Today these findings are emitted but **thin/truncated** (the body goes through `redactSnippet(body, 200)` — a 200-char snippet, not the full verbatim body) and persistence has been unreliable (Issue 1 fixed the persistence path). Make them **RICH** (full verbatim body + complete structured `detail_json`) + reliably **PERSISTED**.
- They feed the oracle via `MigrationDiscoveryContextService` → book-of-work / shape-spec + the architect/PM conversations.

## Settled — carry as constraints, do NOT re-ask

- No new architecture entity types.
- Procedural objects (procs / triggers / sequences / view SQL) → findings, not entities.
- No 1:1 logical synthesis; a DB-only scan = physical-only.
- Type captured **verbatim** (no normalization — the Sybase→Postgres type mapping is a downstream migration/shape-spec concern).
- SQL bodies captured **verbatim** (full body, not a snippet).
- ONE spec / TWO task groups (A = architecture fidelity, B = procedural findings).
- Reviewable items surface in the EXISTING Candidates stream, plus a **read-only SQL body viewer** for finding bodies.

## Genuine open questions (relay to user — do NOT auto-resolve)

1. **Findings vocabulary for procedural objects** — the `findingType` / `category` names + the severity model (procs/triggers as INFO evidence, or risk-weighted by migration concern?), and exactly what goes in `detail_json`. NOTE: a vocabulary already exists in the packs today (`stored_procedure_logic`, `hidden_business_logic`, `procedure_data_write`, `procedure_dependency`, `complex_view_logic`, categories like `hidden_logic`, mixed severities). The call is whether to keep/extend that or rationalise it for v1.
2. **LLM behaviour summary?** Do proc/trigger findings get an LLM-generated behaviour summary (mirroring Gap C / business-logic `behavior` block) so the migration can re-implement, or just the raw verbatim body in v1 (LLM summary deferred)?
3. **Constraints/indexes JSONB shape** — the exact structured shape attached to the physical entity (unique constraints, check constraints + expressions, indexes + columns + uniqueness).
4. **Reconciliation aggressiveness** for the logical↔physical mapping — confidence threshold; auto-link vs reviewer. (The shared primitive grades exact=1.0 / normalized=0.7 / none=0.0.)
5. **Validation** — does the user have a sample Sybase + Postgres schema (with procs/triggers/views/constraints) to run against; is the done-bar offline mappers + model round-trips green?
6. **Confirm the meta-model reference doc update** for the enriched attribute fields + constraint/index metadata + FK join-columns.

## Repo conventions / constraints

- AMS snake_case by default.
- NEW Liquibase changeset files only (never edit applied — highest applied is 162, so next free is **≥163**); reuse the 161/162 JSONB + boxed-Double precedent; boxed numerics.
- No `discovery-service/src/**` edits during an in-flight run (tsx watch auto-reload kills runs).
- Findings via `FindingEmitter` (`findingEmitter` singleton); any LLM via the gateway relay.

## Relevant code

- Discovery: `discovery-service/src/services/databasePacks/*` + `types.ts` (`IntrospectionResult`, `ProcedureMetadata`, `TriggerMetadata`, `ViewMetadata`, `ColumnMetadata`, `KeyOrIndexMetadata`); the existing proc/trigger/view finding builders live in `postgres/postgresFindings.ts` + `sybase/sybaseFindings.ts` (currently truncate body to 200 chars via `redactSnippet`).
- Findings: `discovery-service/src/services/findings/FindingEmitter.ts`.
- AMS: `PhysicalDataEntityEntity` / `PhysicalDataAttributeEntity` / `LogicalDataEntityRelationshipEntity` (+ matching DTOs/services/repositories) + changesets under `src/main/resources/db/changelog/sql/`.
- Identity primitive (Spec 1): `mcp-server/src/services/candidateSaveBackService.ts` — `normalizeNameForMatch` + `resolveEntityToPointId` + the exact/normalized/none confidence ladder.
- Context feed: AMS `MigrationDiscoveryContextService` → book-of-work / shape-spec.
- Frontend: candidate-details panels + `FindingsTab` (read-only body viewer for finding bodies).

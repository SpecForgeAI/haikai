# Spec Requirements: Source-Grade DB Schema + Data Migration Pack (Sybase -> Postgres) with Schema Verification

> Status: AUTHORITATIVE / BUILD-READY. All eight clarifying questions from the
> shaping session have been answered by the user and are baked in below as settled.
> Do NOT re-ask. The raw idea in `planning/raw-idea.md` carries the full problem
> statement, solution outline, and the decisions that were already settled before
> shaping (treat those as settled too).

## Initial Description

See `planning/raw-idea.md` (comprehensive). Summary:

Discovery's DB pack already captures source-grade schema fact for the current
(Sybase ASE) database — tables/columns + types, collation/case-sensitivity,
computed columns WITH expressions, sequence/IDENTITY current values (high-water
marks), FK referential actions, index ordering/clustering, constraints, stored
proc/trigger/view bodies (as findings), and DB scheduled jobs — and the Architect
conversation captures db.* target decisions (db.engine = PostgreSQL). Today those
facts only become LLM prose in the migration plan. This spec makes discovery the
EXECUTABLE schema-migration source:

1. **Schema Migration Pack (deterministic, NO LLM in the structural path):**
   a generator reading the COMMITTED AMS physical model + schema-metadata
   findings + captured db.* decisions, emitting Liquibase changelogs (master
   changelog + ordered formatted-SQL changesets), Sybase ASE -> PostgreSQL only
   in v1. Fixed deterministic type-mapping table; ambiguous mappings are NEVER
   guessed — they become needs_decision flags. Coverage is a CODE guarantee:
   every discovered table/column is exactly one of translated |
   explicitly-skipped(reason) | flagged needs_decision, with per-object
   provenance back to the discovered entity/finding.
2. **Data Migration Pack (bulk + incremental):** per-table bulk load scripts in
   FK-topological order with type-cast SELECT/COPY templates, constraint
   application after load, sequence reseed after load; incremental top-up
   scripts driven by a detected per-table delta key, parameterised by
   last-high-water; a "Refresh seeds" action re-scanning ONLY sequence/identity
   current values.
3. **UI surface:** read-mostly pack view + focused decision queue, hung off the
   Migration Delivery Plan page next to the book of work; actions Regenerate,
   Refresh seeds, Download pack (zip); pack attaches to the DB epic in the book
   of work.
4. **Schema verification loop:** scan the TARGET Postgres database with the
   existing discovery DB pack introspection, deterministic schema-diff of
   expected (generated pack schema) vs actual (target scan) — the DB sibling of
   the API drift report. Re-runnable per area; designed not to preclude a later
   external implementation+verification service callback.

This is SPEC 1 of 2. SPEC 2 (later, separate): LLM-assisted T-SQL -> PL/pgSQL
translation drafts for stored procs/triggers/views with judge verification.
Translation is OUT OF SCOPE here; proc/trigger/view objects are listed in the
pack manifest as "requires translation (spec 2)".

## Codebase Research Findings (RECORD — these constrain the design)

1. **Findings are a mandatory generator input, not just the committed model.**
   Collation, computed-column `is_generated` / `generation_expression`, and
   sequence high-water values do NOT survive into the committed AMS physical
   model — they live only in candidate JSON payloads and in persisted findings
   (`collation_case_sensitivity_hazard`, `sequence_definition`,
   `sequence_cutover_hazard`, `sequence_restart_collision`). The generator must
   therefore read findings alongside the committed physical model
   (physical_data_entities / physical_data_attributes) to reach source grade.
2. **No binary artifact store exists.** Text/JSONB persistence is the repo
   precedent (e.g. `migration_story_spec_generations`,
   `generated_migration_books_of_work`). The pack must persist as text/JSONB
   rows, with the zip assembled on demand.
3. **Credentials are never persisted and purge at run end.** Refresh-seeds and
   verification scans therefore require credential re-entry per invocation
   (reusing the existing DB pack connection flow/UI).
4. **db.* decision codes available** in target_state_captured_decisions:
   `db.engine`, `db.migrations`, `db.connectionPool`, `db.transactionStrategy`,
   `db.readReplicaUsage`, `db.driver`.

## Requirements Discussion

### First Round Questions (all answered — settled)

**Q1: Pack persistence.** Where do the generated files live?
**Answer:** New AMS table(s) storing the manifest + each generated file as
text/JSONB rows; the zip is assembled on-demand at download time; NO files on
disk. This matches the `migration_story_spec_generations` /
`generated_migration_books_of_work` precedents.

**Q2: needs_decision persistence.** Where do decision-queue resolutions live?
**Answer:** A PACK-SCOPED decision table — decisions are versioned with the pack
and cleanly regenerable. NOT `target_state_captured_decisions` (optional
mirroring into captured decisions is a future idea, explicitly out of scope).

**Q3: Changeset granularity.** How are the Liquibase changelogs sliced?
**Answer:** Liquibase formatted SQL. One changeset per table for the structural
phase; one consolidated changeset per cross-cutting phase (sequence seeding, FK
application, indexes). Changeset ids are logicalFilePath-stable so regeneration
does not churn checksums for unchanged objects.

**Q4: FK/index timing for bulk + incremental.** When are FKs and indexes applied?
**Answer:** FK constraints AND non-PK indexes are applied ONCE after the BULK
load, then kept enforced through all incremental top-up runs (safer increments).
Non-PK indexes are deferred to post-bulk for fast load. This ordering is stated
explicitly in the manifest.

**Q5: Delta-key detection + DELETE propagation.**
**Answer:** (a) A monotonic identity column -> insert-only delta; a
name-heuristic timestamp column (updated_at / modified_date etc. with a datetime
type) -> insert+update delta; the chosen key is surfaced as a per-table
reviewable item; a table with neither -> needs_decision (full reload | skip |
manual key). (b) DELETE propagation is OUT OF SCOPE for incremental v1 — stated
plainly in the manifest; full-reload tables catch deletes.

**Q6: Verification scan mechanics + drift report lifetime.**
**Answer:** A lightweight verification-only mode reusing the Postgres pack
introspection that writes NOTHING to the model; it produces only the drift
report, tied to the pack. Drift reports PERSIST as a history of runs (audit
trail; the future external implementation+verification service callback appends
per-area re-verifications to that history).

**Q7: Attachment to the book of work.**
**Answer:** The pack row carries a `work_item_id` link to the DB epic; the
book-of-work item drawer shows a pack chip with download. The user picks which
epic is the DB epic ONCE in the pack UI (no naming-convention magic). Jira push
of the zip: OUT OF SCOPE v1 (in-tool download only — the external
implementation/verification service may change the artifact flow later).

**Q8: Staleness model.**
**Answer:** Snapshot-hash comparison of the generation inputs -> a
"stale — inputs changed since generation" banner; explicit Regenerate only
(NEVER auto-regenerate). Resolving a needs_decision also marks the pack stale.
No additional scope exclusions beyond those already in raw-idea.md
(proc/trigger/view T-SQL -> PL/pgSQL translation = separate spec 2;
external-service callback integration = out of scope, just don't preclude it).

### Existing Code to Reference

**Similar Features Identified:**
- Drift report UI: model on
  `frontend/src/components/DashboardView/DriftReportTab.tsx` +
  `DiffFindingDetailDrawer.tsx` (the API drift report — this spec builds its DB
  sibling).
- Decision queue UI: model on the FindingsTab list + bulk-action pattern (NOT
  the Architecture Room conversational agenda).
- Coverage-guarantee philosophy: mirror spec
  `agent-os/specs/2026-06-11-two-phase-migration-plan-generation` — every item
  is translated | skipped(reason) | flagged; nothing silent; coverage enforced
  in code, not by LLM diligence.
- Pack persistence precedent: `migration_story_spec_generations` /
  `generated_migration_books_of_work` AMS tables (text/JSONB rows).
- Introspection source: `discovery-service/src/services/databasePacks/{sybase,postgres}/`
  (profiler, high-water capture; sybase sidecar at :8093) and
  `databasePackFindingBuilders.ts` (proc/trigger/view findings,
  type-conversion notes incl. T-SQL -> Postgres token hints).
- UI surface: `frontend/.../MigrationDeliveryPlan/` — the page this hangs off;
  book-of-work items for attachment.

### Follow-up Questions

None required — all eight first-round answers were accepted via the recommended
options, and no contradictions were found against the raw idea or the codebase
research.

## Visual Assets

### Files Provided:

No visual assets provided (visuals folder checked — empty).

### Visual Insights:

- Follow the existing Migration Delivery Plan styling for the pack view,
  decision queue, and drift report surfaces.

## Requirements Summary

### Functional Requirements

**Part 1 — Schema Migration Pack (deterministic, no LLM in the structural path):**
- Generator inputs: committed AMS physical model (physical_data_entities /
  attributes), schema-metadata findings (collation, computed columns,
  sequences/identity high-water, FK actions, clustering), captured db.*
  decisions. Findings are mandatory — high-water/collation/generation
  expressions exist ONLY there (see research finding 1).
- Output: Liquibase (NOT Flyway) master changelog + ordered formatted-SQL
  changesets; Sybase ASE -> PostgreSQL only in v1.
- Fixed deterministic type-mapping table (datetime -> timestamptz,
  money -> numeric(19,4), bit -> boolean, identity -> GENERATED ALWAYS AS
  IDENTITY, text/image -> text/bytea, etc.); ambiguous mappings become
  needs_decision flags, never guesses.
- Tables, PKs, constraints; FK constraints in a post-data-load changeset;
  indexes (clustered -> btree + CLUSTER note); computed columns -> Postgres
  generated columns where expressible, else needs_decision; collation handling
  per decision; sequences seeded from captured high-water marks + configurable
  margin.
- Changeset layout per Q3 (per-table structural; consolidated per cross-cutting
  phase; checksum-stable ids on regeneration).
- Coverage as a code guarantee: every discovered table/column is exactly one of
  translated | explicitly-skipped(reason) | flagged needs_decision, with
  per-object provenance to the discovered entity/finding. Proc/trigger/view
  objects listed in the manifest as "requires translation (spec 2)".

**Part 2 — Data Migration Pack:**
- BULK: per-table load scripts/manifest in FK-topological order, type-cast
  SELECT/COPY templates (Sybase extract -> Postgres COPY), FK + non-PK index
  application once after bulk (then kept enforced), sequence reseed after load
  (timing per Q4, stated in the manifest).
- INCREMENTAL top-up: per-table delta strategy from the detected delta key per
  Q5; scripts parameterised by last-high-water; chosen key reviewable per
  table; no-key tables -> needs_decision; DELETE propagation out of scope v1
  (stated in the manifest).
- Refresh-seeds action: re-scan ONLY sequence/identity current values via the
  existing DB pack connection flow (credential re-entry required per research
  finding 3) and regenerate the seeding + incremental parameters.

**Part 3 — UI surface (on the Migration Delivery Plan page):**
- Read-mostly pack contents view + coverage summary (translated / skipped /
  flagged counts; per-object provenance).
- Decision queue (FindingsTab list + bulk-action pattern): resolve
  needs_decision flags; resolutions persist in the pack-scoped decision table;
  resolving marks the pack stale and enables Regenerate.
- Actions: Regenerate (explicit only), Refresh seeds, Download pack (zip of
  liquibase changelogs + data scripts + manifest, assembled on demand from AMS
  rows).
- Attachment: pack row carries `work_item_id` to the user-chosen DB epic;
  book-of-work item drawer shows a pack chip with download.
- Staleness: snapshot-hash of generation inputs -> stale banner; never
  auto-regenerate.

**Part 4 — Schema verification loop (DB drift report):**
- Verification-only scan mode reusing the existing Postgres pack introspection;
  writes NOTHING to the model; credential re-entry per invocation.
- Deterministic schema-diff: expected (generated pack schema) vs actual (target
  scan) -> per-object classification (match / missing / mismatch with detail).
- Drift reports persist as a history of runs tied to the pack (audit trail);
  re-runnable per area; the future external-service callback appends per-area
  re-verifications (integration itself out of scope — just don't preclude it).

### Reusability Opportunities

- DriftReportTab.tsx + DiffFindingDetailDrawer.tsx for the DB drift report UI.
- FindingsTab list + bulk-action pattern for the decision queue.
- `migration_story_spec_generations` / `generated_migration_books_of_work`
  text/JSONB persistence pattern for pack storage.
- `discovery-service/src/services/databasePacks/{sybase,postgres}/` introspection
  (incl. profiler + high-water capture) for refresh-seeds and verification scan.
- Existing DB pack connection/credential flow for any live-DB action.
- Coverage-guarantee + manifest philosophy from
  2026-06-11-two-phase-migration-plan-generation.

### Scope Boundaries

**In Scope:**
- Deterministic Liquibase schema pack (Sybase ASE -> PostgreSQL).
- Bulk + incremental data migration scripts; refresh-seeds.
- Pack persistence in AMS (text/JSONB), on-demand zip download.
- Pack-scoped decision queue + staleness/regenerate lifecycle.
- DB-epic attachment via `work_item_id` (user-chosen epic, pack chip in drawer).
- Verification-only target scan + persisted drift-report history.

**Out of Scope:**
- Stored proc / trigger / view T-SQL -> PL/pgSQL translation (separate spec 2;
  listed in the manifest as "requires translation (spec 2)").
- DELETE propagation in incremental top-ups (v1; full-reload tables catch
  deletes; stated in the manifest).
- Jira push of the pack zip (in-tool download only in v1).
- Mirroring pack decisions into target_state_captured_decisions (future idea).
- External implementation+verification service callback integration (don't
  preclude; drift history is designed to receive appended runs).
- Any source/target engine pair other than Sybase ASE -> PostgreSQL.
- Auto-regeneration of any kind.

### Technical Considerations

- Generator must merge committed physical model + findings
  (`collation_case_sensitivity_hazard`, `sequence_definition`,
  `sequence_cutover_hazard`, `sequence_restart_collision`) — the committed
  model alone is NOT source-grade (research finding 1).
- No filesystem artifacts: all generated content as AMS text/JSONB rows; zip
  built on demand.
- Credentials never persisted; refresh-seeds and verification scans prompt for
  credentials each invocation.
- Liquibase changeset ids + logicalFilePath must be stable across regeneration
  for unchanged objects (checksum stability).
- Staleness via snapshot-hash of generation inputs (model + findings +
  db.* decisions + pack decisions).
- New AMS tables require new Liquibase changesets (never edit applied ones).
- db.* decision codes available: db.engine, db.migrations, db.connectionPool,
  db.transactionStrategy, db.readReplicaUsage, db.driver.
- AMS wire format: new DTOs default to snake_case; apply `@CamelCaseWire` only
  if a camelCase consumer is introduced (per repo CLAUDE.md).

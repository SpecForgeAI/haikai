# Source-Grade DB Schema + Data Migration Pack (Sybase→Postgres) with Schema Verification

## Problem / north star
The product is a like-for-like migration oracle (current service+DB as black box → e.g. Java 21/Spring Boot/Postgres inside). Discovery's DB pack already captures source-grade schema fact — tables/columns + types, collation/case-sensitivity, computed columns WITH expressions, sequence/IDENTITY current values (high-water marks), FK referential actions, index ordering/clustering, constraints, stored proc/trigger/view bodies (as findings), DB scheduled jobs — and the Architect conversation captures db.* target decisions (db.engine = PostgreSQL). But today those facts only become LLM prose in the migration plan. This spec makes discovery the EXECUTABLE schema-migration source: a deterministic generator producing a downloadable migration pack, plus a verification loop.

This is SPEC 1 of 2 (phases A + C of the agreed design). SPEC 2 (later, separate): LLM-assisted T-SQL → PL/pgSQL translation drafts for stored procs/triggers/views with judge verification (phase B). Translation is OUT OF SCOPE here; proc/trigger/view objects are listed in the pack manifest as "requires translation (spec 2)".

## Scope — Part 1: the Schema Migration Pack (deterministic, NO LLM in the structural path)
Generator inputs: the COMMITTED physical model (physical_data_entities/attributes in AMS), the schema-metadata findings (collation, computed columns, sequences/identity high-water, FK actions, clustering), and the captured db.* decisions.
Output: **Liquibase** changelogs (the user's standard — NOT Flyway): a generated master changelog + ordered changesets (formatted SQL), Sybase ASE → PostgreSQL ONLY in v1.
- Fixed deterministic type-mapping table (datetime→timestamptz, money→numeric(19,4), bit→boolean, identity→GENERATED ALWAYS AS IDENTITY, text/image→text/bytea, etc.). Ambiguous mappings are NEVER guessed — they become needs_decision flags.
- Tables, PKs, constraints; FK constraints emitted in a post-data-load changeset (cutover ordering); indexes (clustered → btree + CLUSTER note); computed columns → Postgres generated columns where expressible, else needs_decision; collation/case-sensitivity handling per decision; sequences/identity seeded from captured high-water marks + configurable margin.
- COVERAGE IS A CODE GUARANTEE: every discovered table/column is exactly one of translated | explicitly-skipped(reason) | flagged needs_decision. Nothing silently dropped. Per-object provenance back to the discovered entity/finding.

## Scope — Part 2: the Data Migration Pack (bulk + incremental)
- BULK: per-table load scripts/manifest in FK-topological order, type-cast SELECT/COPY templates (Sybase extract → Postgres COPY), constraint-application after load, sequence reseed after load.
- INCREMENTAL top-up (user requirement: bulk first, then small incremental migrations until big-bang cutover): per-table delta strategy derived from a DETECTED delta key (identity or timestamp column — discovery knows all columns). Tables with no usable delta key → needs_decision (full reload | skip | other). Incremental scripts parameterised by last-high-water.
- Refresh-seeds action: re-scan ONLY sequence/identity current values (reusing the existing DB pack connection flow) and regenerate the seeding + incremental parameters. IN SCOPE v1.

## Scope — Part 3: UI surface (hangs off the Migration Delivery Plan page, next to the book of work)
READ-MOSTLY + a focused decision queue (user confirmed: not a workbench):
- Pack contents view + coverage summary (translated / skipped / flagged counts; per-object provenance).
- Decision queue: resolve needs_decision flags (choices persisted; resolving enables regenerate).
- Actions: Regenerate, Refresh seeds, Download pack (zip: liquibase changelogs + data scripts + manifest).
- Attachment: the pack attaches to the DB epic/story in the book of work (user model: ONE epic for the database work; single downloadable pack attached to it).

## Scope — Part 4: Schema verification loop (the DB drift report)
- Scan the TARGET Postgres database with the EXISTING discovery DB pack (it already scans Postgres).
- Deterministic schema-diff: expected (generated pack schema) vs actual (target scan) → per-object classification (match / missing / mismatch with detail), the DB sibling of the API drift report.
- Re-runnable per area — designed to be triggered later by the external implementation+verification service's callback for scoped re-reconciliation (that integration itself is OUT OF SCOPE here; just don't preclude it).

## Settled decisions (do NOT re-ask)
- Liquibase, not Flyway. Sybase ASE → PostgreSQL only v1. Single downloadable pack attached to the single DB epic/story. Bulk + incremental data migration both in scope. Sequence/seed refresh in scope. UI = read-mostly + decision queue, hung off the Migration Delivery Plan. Spec slicing: this spec = schema pack + data pack + verification; proc/trigger translation = separate later spec.

## Existing foundations (verify in repo)
- discovery-service/src/services/databasePacks/{sybase,postgres}/ — the introspection source incl. profiler, high-water capture; sybase sidecar at :8093.
- discovery-service findings builders: databasePackFindingBuilders.ts (stored proc/trigger/view findings, type-conversion notes incl. T-SQL→Postgres token hints).
- AMS physical model (physical_data_entities/attributes), architecture_element_mappings, target_state_captured_decisions (db.* codes), discovery findings.
- frontend MigrationDeliveryPlan/ — the surface this hangs off; book-of-work items for attachment.
- The template-stamping/coverage-guarantee + judge philosophy from spec 2026-06-11-two-phase-migration-plan-generation (the verification pattern precedent).

# Task Breakdown: Source-Grade DB Schema + Data Migration Pack (Sybase ASE → PostgreSQL) with Schema Verification

## Overview

Total Tasks: 7 task groups (44 sub-tasks)

Turn discovery's source-grade DB facts (committed physical model +
schema-metadata findings + captured db.* decisions) into an executable,
downloadable migration pack — deterministic Liquibase schema changelogs plus
bulk/incremental data-load scripts — with a pack-scoped decision queue, DB-epic
attachment, and a re-runnable verification scan that diffs the target Postgres
database against the generated schema (the DB sibling of the API drift report).

**Cross-cutting constraints (apply to every group):**

- **NO LLM anywhere** in the structural generation path or the schema diff —
  the gateway handler is pure deterministic code (no LLM client import).
- **Sybase ASE → PostgreSQL is the ONLY supported pair in v1** — the generator
  rejects any other combination (target engine read from the `db.engine`
  captured decision).
- **Never edit applied Liquibase changesets.** All four new AMS tables arrive
  via NEW changeset files under
  `architecture-model-service/src/main/resources/db/changelog/sql/` using the
  next free numbers after `171-capture-session-scenario-counts.sql`
  (i.e. `172-...` onward).
- **AMS wire format:** all new DTOs use the default snake_case wire — NO
  `@CamelCaseWire` (all consumers are new). Any numeric DTO field that
  participates in PATCH semantics MUST be a boxed type (`Long`/`Integer`/
  `Double`), never a primitive (primitive defaults silently wipe to 0 on
  partial updates), with null guards in update handlers.
- **No filesystem or binary artifacts:** all generated content persists as AMS
  text/JSONB rows; the zip is assembled on demand at download time.
- **Credentials are never persisted** — refresh-seeds and verification scans
  prompt per invocation; the discovery-service `secretsStore.ts` in-process
  bundle is reused and purged at completion.
- **NEVER auto-regenerate.** Regenerate is always an explicit user action;
  staleness only ever shows a banner.
- **Checksum stability:** Liquibase changeset ids and `logicalFilePath` are
  stable functions of object identity so regeneration produces byte-identical
  changesets for unchanged objects.
- **Out of scope (do not build):** proc/trigger/view T-SQL → PL/pgSQL
  translation (manifest lists them as `requires_translation_spec_2`), DELETE
  propagation in increments, Jira push of the zip, mirroring pack decisions
  into `target_state_captured_decisions`, the external verification-service
  callback (don't preclude it — the drift `source` string field receives it),
  executing the migration from inside the tool.
- **Three test stacks:** AMS = JUnit (`mvn test -Dtest=...`), gateway +
  discovery-service = Jest, frontend = Vitest. Each group runs ONLY its own
  newly-written tests; never whole suites.

## Task List

### AMS Persistence Layer

#### Task Group 1: Pack tables, entities, services, controllers
**Dependencies:** None

The four new pack tables and their full JPA/service/controller stack,
following the `MigrationStorySpecGenerationEntity` /
`GeneratedMigrationBookOfWorkEntity` text/JSONB precedents (changesets
`139`/`140`, staleness columns per `146-...`/`150-...`).

- [x] 1.0 Complete the AMS pack persistence layer
  - [x] 1.1 Write 2-8 focused tests for the pack persistence stack
    - Limit to 2-8 highly focused tests maximum (JUnit, modeled on
      `GeneratedMigrationBookOfWorkServiceTest.java` / controller-slice
      conventions).
    - Cover ONLY: (a) create pack + files + read-back round trip (snake_case
      wire, manifest_json/jsonb intact); (b) one-active-pack-per
      project+architecture — regeneration updates the pack row in place and
      replaces files while decisions + drift reports survive by pack id;
      (c) decision resolve flips `open` → `resolved` with `resolution_json`
      persisted, and decision_key uniqueness within a pack re-links rather
      than duplicates on upsert; (d) drift reports are append-only history
      (second append leaves the first untouched); (e) PATCH of
      `work_item_id` updates only that field (boxed-type/null-guard check —
      coverage counts and seed_margin untouched by a sparse PATCH).
    - Skip exhaustive validation-permutation coverage.
  - [x] 1.2 Create the four NEW Liquibase changeset files
    - New files numbered `172-...` onward (never touch applied files):
      `db_migration_packs` (id, project_id, architecture_id, status
      `generated`|`stale`, stale_reason, input_snapshot_hash, generated_at,
      work_item_id nullable text, translated/skipped/flagged coverage counts,
      seed_margin, manifest_json jsonb),
      `db_migration_pack_files` (pack_id FK, file_path, file_kind
      `liquibase_master`|`liquibase_changeset`|`bulk_load_script`|
      `incremental_script`|`manifest`|`readme`, content text, sort_order),
      `db_migration_pack_decisions` (pack_id FK, decision_key — stable object
      identity + question kind, unique per pack — object_ref, category
      `type_mapping`|`computed_column`|`collation`|`delta_key`|`other`,
      question, options_json, resolution_json, status `open`|`resolved`,
      resolved_at),
      `db_migration_pack_drift_reports` (pack_id FK, scan_scope_json,
      match/missing/mismatch summary counts, report_json, source free text
      — `in_tool` now — created_at).
    - Indexes/uniques: pack lookup by project_id+architecture_id (one active
      pack), files by pack_id+sort_order, decisions unique on
      (pack_id, decision_key), drift reports by pack_id+created_at.
  - [x] 1.3 Create JPA entities + repositories per table
    - Follow `MigrationStorySpecGenerationEntity` /
      `GeneratedMigrationBookOfWorkEntity` patterns (jsonb columns, status +
      staleness fields). Boxed types for all numerics that any PATCH can
      touch (counts, seed_margin).
  - [x] 1.4 Create services + DTOs (snake_case wire)
    - Service methods: create/regenerate-in-place (replace files, preserve
      decisions + drift history by pack id), get pack (+ files, + manifest),
      list/resolve decisions (single + bulk resolve, decision_key upsert
      semantics), append drift report, PATCH `work_item_id`, update
      status/stale_reason.
    - DTOs use the AMS snake_case default — no `@CamelCaseWire`, no
      camelCase consumers exist.
  - [x] 1.5 Create controllers under `/api/projects/{projectId}/db-migration-packs`
    - Endpoints: pack CRUD (create/regenerate is an upsert by
      project+architecture), `/files`, `/decisions` (list + resolve single +
      bulk), `/drift-reports` (list + append), PATCH for `work_item_id`.
    - Error conventions (404 unknown pack/project, 400 invalid resolve)
      matching the existing AMS controller patterns.
  - [x] 1.6 Ensure the AMS tests pass
    - Run ONLY the 2-8 tests written in 1.1 (`mvn test -Dtest=...` on the
      touched classes); verify the new changesets apply cleanly on a fresh
      context start.
    - Do NOT run the entire AMS suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass; changesets `172-...`+ apply cleanly.
- One active pack per project+architecture; regeneration preserves decisions
  and drift history by pack id.
- Decisions re-link by decision_key on regeneration; drift reports are
  append-only.
- All DTOs are snake_case; PATCH-mutable numerics are boxed with null guards.

### Gateway — Deterministic Schema Generation Core

#### Task Group 2: Type mapping, IR merge, Liquibase emission, coverage guarantee
**Dependencies:** Task Group 1

The deterministic heart of the spec: a new
`gateway/src/services/dbMigrationPackHandler.ts` that reads the committed
physical model + persisted findings + captured `db.*` decisions + resolved
pack decisions, and emits checksum-stable Liquibase changelogs with a coverage
ledger enforced in code. No LLM import anywhere in this module.

- [x] 2.0 Complete the deterministic schema generation core
  - [x] 2.1 Write 2-8 focused tests for the generation core
    - Limit to 2-8 highly focused tests maximum (Jest, new
      `gateway/src/__tests__/dbMigrationPackGeneration*.test.ts`, AMS +
      model fetch mocked via the `architectureModelClient` requireActual
      spread pattern).
    - Cover ONLY: (a) type-mapping table v1 — representative deterministic
      mappings (`money`→`numeric(19,4)`, `datetime`→`timestamptz`,
      `bit`→`boolean`, `numeric(p,s)` verbatim, identity →
      `GENERATED ALWAYS AS IDENTITY`) and Sybase `timestamp` → a
      `type_mapping` needs_decision, never a guess; (b) findings merge —
      collation hazard → `collation` needs_decision, `getdate()` non-portable
      default → `now()` rewrite, sequence high-water finding seeds the
      sequences-seed changeset with the margin, value-unavailable high-water
      → needs_decision; (c) coverage assertion — every table/column lands in
      exactly one of translated|skipped|flagged with provenance, and an
      artificially unaccounted object FAILS the run; (d) checksum stability —
      two generations over identical inputs produce byte-identical changeset
      files and the same `input_snapshot_hash`; (e) non-Sybase→Postgres
      input combination is rejected; (f) procs/triggers/views/scheduled jobs
      land in the manifest as `requires_translation_spec_2` /
      manual-recreation with finding provenance, never as changesets.
    - Skip exhaustive per-type and per-finding permutation coverage.
  - [x] 2.2 Build the input snapshot + source-schema IR
    - Pipeline stages 1-2: fetch ALL mandatory inputs — committed AMS
      physical model (`physical_data_entities` incl. `constraints_metadata`
      jsonb, `physical_data_attributes` incl. scale/precision/is_identity/
      sequence_name, relationship `fk_columns` with on_delete/on_update),
      persisted discovery findings, captured `db.*` decisions from
      `target_state_captured_decisions`, resolved pack decisions — via
      `architectureModelClient.ts` patterns.
    - Canonically serialize all inputs → SHA-256 `input_snapshot_hash`
      (this hash is also the staleness comparator in Group 4).
    - Merge findings into the IR by object identity BEFORE translation:
      `collation_case_sensitivity_hazard` (+
      `collationImpliesCaseInsensitive`), computed-column
      generation expressions, `sequence_definition` /
      `sequence_cutover_hazard` high-water marks, `non_portable_default`
      (+ `detectNonPortableDefault`) — these facts exist ONLY in findings
      (see `databasePackFindingBuilders.ts`), never on committed attributes.
    - Align the IR with the discovery-service shapes in
      `discovery-service/src/services/databasePacks/types.ts`
      (`ColumnMetadata`, `SequenceMetadata.currentValue`,
      `KeyOrIndexMetadata`) so Group 5's diff consumes the same vocabulary.
    - Reject any source/target pair other than Sybase ASE → PostgreSQL.
  - [x] 2.3 Implement the fixed deterministic type-mapping table (v1)
    - A versioned code table exactly per the spec list (`int`→`integer` …
      `time`/`bigtime`→`time`); identity columns →
      `GENERATED ALWAYS AS IDENTITY` seeded from the captured high-water.
    - NEVER guess: Sybase `timestamp` (rowversion), any unlisted type, and
      any column whose findings flag an un-neutralizable hazard each emit a
      `type_mapping` needs_decision with concrete options.
    - Computed columns: `GENERATED ALWAYS AS (expr) STORED` ONLY when the
      expression translates by deterministic token translation; else a
      `computed_column` needs_decision carrying the verbatim Sybase
      expression. Collation hazards → `collation` needs_decision (options:
      `citext` | expression indexes + app discipline | accept
      case-sensitive). Non-portable defaults rewritten where safe
      (`getdate()`→`now()`), else flagged.
  - [x] 2.4 Emit the Liquibase formatted-SQL changelogs (checksum-stable)
    - One master changelog (`liquibase/db.changelog-master.xml` include
      list) referencing ordered changeset files.
    - Granularity: ONE changeset per table for the structural phase (table +
      PK + check/unique constraints + comments) in FK-topological order
      (cycles broken deterministically and noted in the manifest); ONE
      consolidated changeset each for `sequences-seed` (identity restart
      values = high-water + configurable pack-level margin, default stated
      in the manifest), `foreign-keys` (all FKs, post-data-load, ON
      DELETE/ON UPDATE reproduced verbatim from `fk_columns`), `indexes`
      (all non-PK indexes, post-data-load).
    - Changeset ids + `logicalFilePath` are stable functions of object
      identity (e.g. `table--dbo.orders`) — regeneration is byte-identical
      for unchanged objects.
    - Clustered Sybase indexes → plain btree + explicit `-- CLUSTER` note in
      the changeset and a manifest entry; index column ordering/direction
      verbatim from `constraints_metadata.indexes[]`.
  - [x] 2.5 Build the coverage ledger + post-generation assertion
    - Every discovered table and column ends in exactly one bucket —
      `translated` | `skipped` (explicit reason) | `flagged` (needs_decision)
      — enforced by a post-generation assertion that FAILS the run if any
      object is unaccounted for (philosophy from
      `2026-06-11-two-phase-migration-plan-generation`).
    - Per-object provenance (source entity/attribute id + contributing
      finding ids) recorded in the manifest; procs/triggers/views listed as
      `requires_translation_spec_2`, `db_resident_scheduled_job` findings as
      manual-recreation items.
    - Emit the expected-schema JSON into the manifest at generation time —
      this is Group 5's diff baseline.
  - [x] 2.6 Persist atomically to AMS
    - Stage 6: write manifest + coverage counts + files + needs_decision
      flags to the Group 1 endpoints in one logical operation (pack upsert →
      files replace → decisions upsert by decision_key); set status
      `generated` and store `input_snapshot_hash`.
    - `[diag-gateway]` stage-marker logs per pipeline stage (snapshot / IR /
      mapping / emit / coverage / persist), following the
      `migrationBookOfWorkHandler.ts` convention.
  - [x] 2.7 Ensure the generation-core tests pass
    - Run ONLY the 2-8 tests written in 2.1.
    - Do NOT run the entire gateway suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass.
- No LLM client import anywhere in the generation path.
- Findings-only facts (collation, computed expressions, high-water marks,
  non-portable defaults) demonstrably reach the output via the IR merge.
- Coverage assertion fails the run on any unaccounted object; manifest carries
  per-object provenance + expected-schema JSON.
- Regeneration over unchanged inputs is byte-identical (no checksum churn) and
  reproduces the same snapshot hash.

### Gateway — Data Migration Pack Generator

#### Task Group 3: Bulk load scripts, incremental top-up, delta keys
**Dependencies:** Task Group 2

The data half of the pack, generated in the same pipeline run and persisted as
additional `db_migration_pack_files` rows: FK-topological bulk manifest +
scripts, post-bulk constraint application, sequence reseed, and detected
delta-key incremental scripts.

- [x] 3.0 Complete the data migration pack generator
  - [x] 3.1 Write 2-8 focused tests for the data pack generator
    - Limit to 2-8 highly focused tests maximum (Jest, extending the Group 2
      test file or a sibling `dbMigrationPackDataScripts*.test.ts`).
    - Cover ONLY: (a) bulk scripts emitted per table in FK-topological order
      with type-cast SELECT expressions aligned to the v1 mapping table and
      a `COPY ... FROM STDIN` template; (b) generated columns excluded from
      COPY column lists and identity columns documented with
      `OVERRIDING SYSTEM VALUE` in the header; (c) delta-key detection —
      identity column → insert-only script, name-heuristic timestamp column
      (`updated_at`-family + datetime type) → upsert script, identity
      preferred when both exist, neither → `delta_key` needs_decision with
      the three options; (d) incremental scripts parameterised by
      `:last_high_water` with delta key + strategy stated in the header;
      (e) the bulk manifest states the five-phase ordering and the
      DELETE-propagation exclusion (full-reload tables noted as the
      delete-catching mechanism).
    - Skip exhaustive per-table and per-heuristic permutation coverage.
  - [x] 3.2 Generate per-table bulk load scripts (FK-topological order)
    - Sybase extract `SELECT` with explicit type-cast expressions aligned to
      the type-mapping table, paired with a Postgres `COPY ... FROM STDIN`
      template — the pack documents the pipe, it does NOT execute it.
    - Generated columns excluded from COPY column lists (Postgres computes
      them); identity loading documented with `OVERRIDING SYSTEM VALUE`
      semantics in the script header.
  - [x] 3.3 Generate the bulk-load manifest + phase-ordering statement
    - Manifest file lists table order, expected source row counts (from
      discovery profiling where available), per-table cast notes.
    - Explicit five-phase ordering stated: (1) structural changesets (no
      FKs, no non-PK indexes); (2) bulk load all tables; (3) apply FKs +
      non-PK indexes ONCE (the consolidated changesets); (4) reseed
      sequences/identities; (5) all incremental runs execute WITH FKs and
      indexes enforced.
  - [x] 3.4 Implement delta-key detection + incremental scripts
    - Deterministic detection: monotonic identity column → insert-only delta
      script; name-heuristic timestamp column (`updated_at`,
      `modified_date`, `last_modified`, `last_updated`, `mod_ts` and
      similar, datetime-family type) → insert+update (upsert) delta script;
      identity preferred when both exist.
    - Scripts parameterised by `:last_high_water`; each states its delta key
      and strategy in a header comment.
    - No usable delta key → `delta_key` needs_decision (full reload each
      increment | skip from incremental | manually specified key); resolved
      pack decisions (incl. delta-key overrides from the UI) feed back into
      generation via the Group 2 inputs.
    - DELETE propagation stated plainly as out of scope in the manifest.
  - [x] 3.5 Record per-table delta strategy in the pack manifest
    - The chosen delta key per table is part of the manifest JSON so the
      Group 6 pack view can render it as a reviewable item (override path =
      the decision queue).
  - [x] 3.6 Ensure the data pack tests pass
    - Run ONLY the 2-8 tests written in 3.1.
    - Do NOT run the entire gateway suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass.
- Bulk scripts are FK-topological with mapping-aligned casts and COPY
  templates; generated/identity column handling is correct.
- Delta detection follows identity-over-timestamp preference; keyless tables
  flag a `delta_key` decision; increments are `:last_high_water`
  parameterised.
- The manifest states phase ordering and the DELETE exclusion verbatim.

### Discovery-Service Scan Modes + Gateway API Surface

#### Task Group 4: Verification/seed scan modes, pack routes, zip download, staleness
**Dependencies:** Task Groups 1-3

The two narrow model-write-free scan modes in discovery-service (the
introspection home), plus the full gateway route surface in a new
`gateway/src/routes/dbMigrationPack.ts`.

- [x] 4.0 Complete the scan modes and gateway API surface
  - [x] 4.1 Write 2-8 focused tests for scan modes + routes
    - Limit to 2-8 highly focused tests maximum (Jest — discovery-service
      tests for the scan modes with DB clients mocked; gateway route tests
      modeled on the `migrationBookOfWork.ts` route test conventions with
      AMS + discovery-service mocked).
    - Cover ONLY: (a) verification-only mode returns the normalized actual
      schema snapshot and performs ZERO model writes (no candidates, no
      findings, no run rows — assert the write paths are never invoked);
      (b) refresh-seeds mode returns ONLY sequence/identity current values
      and writes nothing to the model; (c) credentials flow through the
      per-invocation `secretsStore` bundle and are purged at completion;
      (d) generate route happy path persists a pack and regenerate requires
      the explicit route call (no auto-trigger from staleness); (e) download
      assembles a zip on demand whose entry paths match
      `db_migration_pack_files.file_path` rows; (f) the staleness check
      recomputes the input snapshot hash and the pack GET exposes
      `is_stale` + reason on mismatch and after a decision resolve.
    - Skip exhaustive per-route error-permutation coverage.
  - [x] 4.2 Add the verification-only Postgres scan mode (discovery-service)
    - Extend `discovery-service/src/services/databasePacks/postgres/postgresIntrospection.ts`
      with a mode flag that runs introspection against the TARGET Postgres
      database and returns the normalized actual-schema snapshot to the
      caller — writing NOTHING to the model (no candidates, no findings, no
      run rows).
    - Accepts a scope filter (schemas/tables) for per-area re-verification.
    - Expose via a narrow discovery-service route following the
      `routes/database.ts` test-connection precedent.
  - [x] 4.3 Add the refresh-seeds scan mode (discovery-service)
    - A narrow seed-scan over the Sybase pack/sidecar path
      (`databasePacks/sybase/`, sidecar at :8093) that re-reads ONLY
      sequence/identity current values and returns them — nothing else
      scanned, nothing written to the model or findings.
    - Per-invocation credentials via the existing `secretsStore.ts`
      in-process bundle (never persisted, purged at completion — same
      contract as discovery runs).
  - [x] 4.4 Create `gateway/src/routes/dbMigrationPack.ts` + register it
    - Routes: generate, regenerate (explicit only), refresh-seeds, verify
      (drift scan — calls 4.2 then Group 5's diff), get pack/files/manifest,
      list/resolve decisions (single + bulk), list drift reports, attach
      work item (PATCH `work_item_id`), download. Registered in
      `gateway/src/routes/index.ts`.
    - Conventions from `gateway/src/routes/migrationBookOfWork.ts`: AMS
      error round-trip (status + body), `[diag-gateway]` stage markers.
    - Refresh-seeds regenerates ONLY the `sequences-seed` changeset +
      incremental high-water parameters in the persisted files — nothing
      else in the pack changes.
  - [x] 4.5 Implement on-demand zip download
    - Assemble the zip from AMS `db_migration_pack_files` rows (file_path →
      entry path): liquibase changelogs + data scripts + manifest + readme.
      No filesystem artifacts at any point; stream the archive in the
      response.
  - [x] 4.6 Implement the staleness check
    - Recompute the input snapshot hash from current inputs (Group 2's
      canonical serialization, shared code — define once) and compare to the
      stored `input_snapshot_hash`; expose `is_stale` + reason on the pack
      GET. Resolving a decision also marks the pack stale (status update via
      the Group 1 service). NEVER auto-regenerate.
  - [x] 4.7 Ensure the scan-mode and route tests pass
    - Run ONLY the 2-8 tests written in 4.1.
    - Do NOT run the entire gateway or discovery-service suites at this
      stage.

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass.
- Both scan modes provably write nothing to the model; credentials are
  per-invocation and purged.
- All routes exist with the migrationBookOfWork error conventions; download
  zips on demand from AMS rows only.
- `is_stale` reflects both input-hash drift and decision resolution;
  regeneration only ever happens via the explicit route.

### Gateway — Verification Diff (DB Drift Report)

#### Task Group 5: Expected-vs-actual schema diff + persisted drift history
**Dependencies:** Task Groups 2, 4

The deterministic diff, colocated with the generation logic that defines
"expected": expected = the pack manifest's expected-schema JSON (emitted in
2.5), actual = the verification scan snapshot from 4.2.

- [x] 5.0 Complete the verification diff
  - [x] 5.1 Write 2-8 focused tests for the diff
    - Limit to 2-8 highly focused tests maximum (Jest, new
      `gateway/src/__tests__/dbMigrationPackDrift*.test.ts`).
    - Cover ONLY: (a) classification — an identical object → `match`, an
      absent expected object → `missing`, a differing object → `mismatch`
      with a structured detail list (property/expected/actual, e.g. column
      type, nullability, identity, FK action, index composition);
      (b) objects present in target but not expected land in the
      informational `unexpected_in_target` section; (c) a scope filter
      restricts the diff to the requested schemas/tables and the persisted
      report records `scan_scope_json`; (d) each verify run appends a new
      `db_migration_pack_drift_reports` row (source `in_tool`) without
      touching prior rows.
    - Skip exhaustive per-property mismatch permutation coverage.
  - [x] 5.2 Implement the deterministic schema diff
    - New module alongside the generator (e.g.
      `gateway/src/services/dbMigrationPackDrift.ts`): per-object
      classification `match` | `missing` | `mismatch` over tables, columns,
      PKs, FKs (incl. referential actions), indexes (composition/order/
      direction), identity, defaults, nullability — comparing the manifest
      expected-schema JSON against the normalized scan snapshot (the shared
      `types.ts` vocabulary from 2.2).
    - `unexpected_in_target` reported informationally; mismatch detail is a
      structured property list, drawer-ready for Group 6.
  - [x] 5.3 Wire verify → diff → persisted history
    - The verify route (4.4) runs scan → diff → appends a drift-report row
      via the Group 1 endpoint with summary counts, `report_json`,
      `scan_scope_json`, and `source: 'in_tool'` (free string — a future
      external verification service appends per-area runs without schema
      change; build nothing for it).
  - [x] 5.4 Ensure the diff tests pass
    - Run ONLY the 2-8 tests written in 5.1.
    - Do NOT run the entire gateway suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass.
- Classification vocabulary and mismatch detail match the spec exactly;
  unexpected objects are informational, never errors.
- Per-area re-runs append to the persisted history; history is never
  overwritten.

### Frontend — Pack Surface, Decision Queue, Drift Report

#### Task Group 6: Pack view, decisions, actions, epic attachment, drift history UI
**Dependencies:** Task Groups 1-5

All user-facing surfaces, mounted off `MigrationDeliveryPlanRoute.tsx` next to
the book of work, styled with the Migration Delivery Plan conventions
(`MigrationBookOfWork.module.css`).

- [x] 6.0 Complete the frontend pack surface
  - [x] 6.1 Write 2-8 focused tests for the UI surfaces
    - Limit to 2-8 highly focused tests maximum (Vitest, under
      `frontend/src/components/ProductManager/MigrationDeliveryPlan/__tests__/`
      and the DashboardView test conventions for the drift pieces; API
      module mocked).
    - Cover ONLY: (a) pack view renders the file tree + coverage summary
      (translated/skipped/flagged counts) from a mocked pack payload;
      (b) decision queue lists open decisions, filters by category/status,
      and a bulk-resolve posts the resolution and surfaces the stale state +
      enabled Regenerate; (c) the staleness banner renders when `is_stale`
      and there is NO auto-regenerate call; (d) the epic picker sets
      `work_item_id` via PATCH and `MigrationBookOfWorkItemDrawer` shows the
      pack chip with a download action on the attached epic; (e) the drift
      tab renders the run-history list + per-run summary chips and opens the
      expected-vs-actual detail drawer for a mismatch.
    - Skip exhaustive per-state and styling coverage.
  - [x] 6.2 Create the API module `frontend/src/api/dbMigrationPackApi.ts`
    - Typed snake_case against the gateway routes from 4.4: pack/files/
      manifest get, generate/regenerate, refresh-seeds, verify (with
      optional scope), decisions list/resolve (single + bulk), drift-report
      list, work-item PATCH, download URL.
  - [x] 6.3 Mount the pack surface off `MigrationDeliveryPlanRoute.tsx`
    - New tab/section next to the book of work per the existing route
      structure; Migration Delivery Plan styling conventions.
  - [x] 6.4 Build the read-mostly pack contents view
    - File tree (changelogs/scripts/manifest/readme) with content preview;
      coverage summary (translated / skipped / flagged counts); per-object
      disposition table with provenance links; per-table delta-key strategy
      display (override path = the decision queue); the phase-ordering
      statement rendered from the manifest.
  - [x] 6.5 Build the decision queue (FindingsTab pattern)
    - Modeled on `frontend/src/components/Discovery/FindingsTab.tsx` list +
      bulk-action pattern (NOT a conversational agenda): filter by
      category/status; resolve individually or bulk-resolve with the same
      option; resolving persists to the pack-scoped decision table, marks
      the pack stale, and enables Regenerate.
  - [x] 6.6 Build the actions bar + staleness banner + credential prompt
    - Actions: Regenerate (explicit only; enabled when stale or decisions
      resolved), Refresh seeds (credential prompt), Download pack (zip),
      Verify schema (credential prompt + optional area scope).
    - Credential prompt reuses the connection-form pattern from
      `StartDiscoveryRunModal.tsx` (dbSource section) — credentials sent per
      invocation, never stored client-side.
    - Staleness banner: "stale — inputs changed since generation" on hash
      mismatch or decision resolve; NEVER auto-regenerate.
  - [x] 6.7 Build the epic attachment + drawer chip
    - One-time picker in the pack UI listing book-of-work epics (no
      naming-convention magic) → PATCH `work_item_id`.
    - `MigrationBookOfWorkItemDrawer.tsx`: pack chip with a download action
      on the attached epic.
  - [x] 6.8 Build the drift report tab + detail drawer
    - Modeled on `frontend/src/components/DashboardView/DriftReportTab.tsx`
      + `DiffFindingDetailDrawer.tsx`: run-history list, per-run summary
      chips (match/missing/mismatch counts), object table with
      classification badges (incl. the informational `unexpected_in_target`
      section), and a detail drawer showing the expected-vs-actual property
      diff.
  - [x] 6.9 Ensure the UI tests pass
    - Run ONLY the 2-8 tests written in 6.1.
    - Confirm net-zero NEW `tsc` errors from this group's changes (large
      pre-existing baseline — verify net-zero new, do NOT chase the
      baseline).
    - Do NOT run the entire frontend suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass; no new `tsc` errors beyond the baseline.
- Pack view, decision queue, actions bar, stale banner, epic picker + drawer
  chip, and drift tab all render from API data and follow the named existing
  patterns.
- Resolving decisions marks the pack stale and enables Regenerate; nothing
  ever auto-regenerates.
- Both live-DB actions (Refresh seeds, Verify) prompt for credentials every
  invocation.

### Testing

#### Task Group 7: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 2-8 tests from each group: AMS persistence (1.1),
      generation core (2.1), data pack (3.1), scan modes + routes (4.1),
      drift diff (5.1), UI (6.1).
    - Total existing tests: approximately 12-48 across JUnit, Jest, and
      Vitest.
  - [x] 7.2 Analyze test coverage gaps for THIS feature only
    - Priority end-to-end candidates: (a) generate → resolve decision →
      pack goes stale → explicit regenerate (decision re-links by
      decision_key, files updated, drift history intact) → download zip,
      through the gateway routes with AMS + discovery mocked;
      (b) generate → verify → drift-report row appended → second scoped
      verify appends a second row (history grows, first row untouched);
      (c) refresh-seeds changes ONLY the sequences-seed changeset +
      high-water parameters with everything else byte-identical;
      (d) the coverage guarantee surviving a realistic mixed model
      (translated + skipped + flagged + requires_translation_spec_2 in one
      run).
    - Focus ONLY on gaps related to this spec's requirements; do NOT assess
      whole-application coverage.
  - [x] 7.3 Write up to 10 additional strategic tests maximum
    - Fill the identified critical gaps only — integration points and
      end-to-end workflows over unit gaps.
    - Skip edge cases, performance tests, and accessibility tests unless
      business-critical.
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests related to this spec (those from 1.1, 2.1, 3.1, 4.1,
      5.1, 6.1, and 7.3) — expected total approximately 22-58 tests.
    - Do NOT run the entire test suite of any of the four services.
    - Verify the critical workflows pass.

**Acceptance Criteria:**
- All feature-specific tests pass across AMS (JUnit), gateway +
  discovery-service (Jest), and frontend (Vitest).
- The generate → decide → regenerate → download and generate → verify → drift
  workflows are covered end-to-end at the mocked-service level.
- No more than 10 additional tests added.
- Testing stays scoped to this spec's feature.

## Execution Order

Recommended implementation sequence (dependency-ordered):

1. **AMS Persistence Layer** (Task Group 1) — the four pack tables +
   entity/service/controller stack everything else writes to.
2. **Deterministic Schema Generation Core** (Task Group 2) — type mapping, IR
   merge with findings, Liquibase emission, coverage guarantee, expected-schema
   manifest.
3. **Data Migration Pack Generator** (Task Group 3) — bulk + incremental
   scripts in the same pipeline run.
4. **Scan Modes + Gateway API Surface** (Task Group 4) — verification-only and
   refresh-seeds scan modes, the full route surface, zip download, staleness.
5. **Verification Diff** (Task Group 5) — expected-vs-actual classification +
   persisted drift history.
6. **Frontend** (Task Group 6) — pack view, decision queue, actions, epic
   attachment, drift report UI.
7. **Test Review & Gap Analysis** (Task Group 7).

## Notes

- **One IR/schema vocabulary, defined once:** the generator's IR (2.2), the
  manifest expected-schema JSON (2.5), and the diff (5.2) all speak the
  `discovery-service/src/services/databasePacks/types.ts` shape family
  (`ColumnMetadata`, `SequenceMetadata`, `KeyOrIndexMetadata`) — do not invent
  a parallel schema model per layer.
- **One snapshot-hash implementation:** the canonical input serialization is
  shared between generation (2.2) and the staleness check (4.6).
- **Decision lifecycle is the regeneration loop:** flagged objects emit
  decisions keyed by stable decision_key (1.2); resolutions feed back as a
  mandatory generation input (2.2); resolving marks the pack stale (4.6);
  regeneration re-links resolved decisions instead of duplicating.
- **Groups 2 and 3 are one pipeline:** the data pack generates in the same
  run/persist as the schema pack; they are separate groups only because the
  schema core must exist (type mapping, topological order, manifest) before
  the data scripts can align to it.
- **No-model-write proof matters:** the two scan modes (4.2/4.3) are the
  riskiest reuse in the spec — their tests must assert the candidate/finding/
  run write paths are never invoked, not merely that a snapshot returns.
- **`tsx` watch caution (repo rule):** do not edit `discovery-service/src/**`
  while a discovery run is active — the watcher reload kills in-flight runs.
- **Frontend `tsc` baseline:** verify net-zero NEW errors per group; do NOT
  chase the large pre-existing baseline.

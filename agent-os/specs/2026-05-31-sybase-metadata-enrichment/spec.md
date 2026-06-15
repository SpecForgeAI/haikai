# Specification: Sybase metadata enrichment (data-layer fidelity parity)

## Goal
Bring Sybase data-layer discovery to parity with Postgres by making the
`sybase-discovery-sidecar` surface six metadata groups from the ASE system
catalogs and wiring `discovery-service` to consume them, so the partially-filled
optional slots + evidence-gap Findings already on the discovery side are
populated. This metadata is migration reality persisted as Findings + JSONB; no
new architecture meta-model entity types and no `architecture-model-service`
change.

## User Stories
- As a migration architect, I want the discovery oracle to capture Sybase
  collation, computed columns, sequence/identity high-water marks, FK referential
  actions, index clustering/ordering, and DB-resident jobs so the schema
  migration and book-of-work are complete rather than structure-only.
- As a migration reviewer, I want a captured value, a deliberate "not applicable
  for this engine" mark, and a genuine "couldn't read it" gap to be three
  distinct states so reconciliation never misreads an ASE structural absence as a
  capture failure.

## Specific Requirements

**Scope: two services only; AMS untouched**
- Touch only `sybase-discovery-sidecar` (Java/Spring Boot) and
  `discovery-service` (TypeScript).
- The sidecar is its OWN Spring Boot module/DTOs; AMS `snake_case` /
  `@CamelCaseWire` conventions do NOT apply to it.
- Everything lands in EXISTING discovery slots: per-attribute JSONB,
  `constraints_metadata`, `fk_columns`, and EXISTING Finding types. No AMS DTO,
  changeset, or entity-type change.
- All six groups ship in v1. Groups 1-4 and 6 are ~80% pre-wired on the discovery
  side; group 5 (index clustering/ordering/predicate) needs NEW plumbing on BOTH
  sides.

**Contract additions to `IntrospectionResponse` / `SidecarIntrospectionResponse` (additive only)**
- Add NEW optional index fields on each `keys[]` row, matching the discovery IR
  `KeyOrIndexMetadata`: `indexDefinition`, `indexMethod`, `isClustered`,
  `indexPredicate`, `columnDirections` (group 5).
- Add a top-level `capabilities: string[]` listing the metadata groups this
  sidecar build surfaces (decision 3).
- Add a top-level engine-version string carrying ASE `@@version` (decision 4).
- Add a top-level `databaseCollation` value (group 1 DB-level sort order).
- Mirror every new field on the sidecar Java record AND the TS
  `SidecarIntrospectionResponse` interface. The TS mapper is already per-field
  null-tolerant; older discovery ignores unknown fields and newer discovery
  tolerates their absence.

**Group 1 — collation / case-sensitivity / sort-order (catalog query only)**
- Sidecar: query the base catalog for per-column collation + the database sort
  order; guard-clean base-table reads only — do NOT use `sp_helpsort`.
- Wire: `columns[].collation` (EXISTS) + new top-level `databaseCollation`.
- Discovery: `transformSidecarIntrospection` already maps `c.collation` to the
  per-attribute payload; ADD a line populating `IntrospectionResult.databaseCollation`
  from the new top-level wire field (the IR carries `databaseCollation` but the
  Sybase mapper does not set it yet). `collation_case_sensitivity_hazard` then
  fires unchanged via `emitCollationHazardFindings`.

**Group 2 — computed columns (catalog query only)**
- Sidecar: read `syscolumns` computed status + `syscomments` for the verbatim
  expression text inside `/introspect`; carry a materialized-vs-virtual signal
  where ASE exposes it.
- Wire: `columns[].isComputed` / `computedExpression` (EXISTS).
- Discovery: already folds to `isGenerated` / `generationExpression` (verbatim) in
  the column mapper and into the `is_generated` / `generation_expression`
  per-attribute JSONB keys — no discovery change beyond the test.

**Group 3 — sequence / identity current value (catalog + identity synthesis + data-read fallback)**
- Sidecar IDENTITY columns: read `syscolumns` identity status; synthesize a
  `sequences[]`-shaped record per IDENTITY column with
  `sequenceName = "<table>.<col> (identity)"`, `ownedByTable`/`ownedByColumn` set
  so the existing `sequence_cutover_hazard` Finding fires unchanged (decision 7).
- Sidecar native SEQUENCE: read the ASE16 `SEQUENCE` catalog on the real-sequence
  path, version-branched (decision 4) so a pre-ASE16 catalog does not hard-error.
- Current-value read = cheap path first (catalog high-water / `ident_current()`),
  then a `MAX(<identity_col>)` SCAN FALLBACK only where the cheap path is null.
  The `MAX(col)` read is a DATA read on the `/introspect` path (not a catalog
  read), so it MUST respect the existing read-only / profiling controls and the
  per-query timeout; the scan cost is proportional to table size — document this
  cost and keep the fallback strictly conditional on a null cheap value.
- Wire: `sequences[].currentValue` (EXISTS); identity rows reuse the same shape.
- Discovery: `transformSidecarIntrospection` maps `currentValue`/`ownedBy*`
  already; `emitSequenceCutoverFindings` fires unchanged — no discovery change
  beyond the test.

**Group 4 — FK referential actions (catalog query only)**
- Sidecar: extend the `sysreferences` / `sysconstraints` FK walk to project
  `on_delete` / `on_update` (verbatim engine strings). Classic ASE FKs are often
  RESTRICT / NO ACTION; CASCADE is ASE15.7+, so the read is version-tolerant.
- Wire: `keys[].updateRule` / `deleteRule` (EXISTS).
- Discovery: already folds to `fk_columns.on_delete` / `on_update` via the key
  mapper + `buildFkColumnsMetadata` — no discovery change beyond the test.

**Group 5 — index ordering / clustering / partial-predicate (NEW on both sides)**
- Sidecar: query `sysindexes` (clustered vs nonclustered via index status bits),
  key column order + ASC/DESC, and key columns (`syscolumns` /
  `syspartitionkeys`). Populate `isClustered`, `columnDirections`, and an
  `indexDefinition`/`indexMethod` where derivable. ASE has NO filtered/partial
  indexes, so `indexPredicate` is always absent for this engine (resolves to
  `not_applicable_for_engine` on the discovery side, NOT an evidence gap).
- Discovery: ADD mapper lines in `sybaseIntrospection.ts` (currently a bare
  `TODO(oracle-W3)` comment on the `keys[]` map) to copy the new fields onto
  `KeyOrIndexMetadata`. Reference `postgres/postgresIntrospection.ts`
  (`parsePostgresIndexDef`, the `isClustered` decode at lines ~732-757) for the
  parse/clustered-decode shape; the Postgres path proves the IR fields end to
  end. The `candidateStructuralFidelity.ts` `constraints_metadata.indexes[]`
  reshaper already covers all five fields (`definition`/`method`/`is_clustered`/
  `predicate`/`column_directions`) — verify, no change expected.

**Group 6 — DB-resident jobs (allowlisted read-only procs)**
- Sidecar: read the Sybase Job Scheduler via read-only Job Scheduler procs and/or
  `sybmgmtdb..js*` base tables; project `scheduledJobs[]` (name + verbatim
  schedule + verbatim command + enabled).
- Add a NARROW, explicitly-documented allowlist of exactly those read-only procs
  to `SidecarSqlGuard`, usable ONLY by the introspection job path; the `/query`
  endpoint keeps blanket-blocking all `sp_*` / `xp_*` (decision 8). The
  `/introspect` PreparedStatements already bypass the guard; the allowlist exists
  to make the proc usage explicit and auditable. Name the allowlisted procs in
  the code comment and in this spec at implementation time.
- Wire: `scheduledJobs[]` (EXISTS).
- Discovery: already fires `db_resident_scheduled_job` via
  `emitUnsupportedFeatureFindings` — no discovery change beyond the test.

**Three-state applicability model (NEW discovery logic)**
- Per group/field, discovery resolves exactly one of: `present` (value captured);
  `not_applicable_for_engine` (ASE structurally lacks the construct —
  partial-index predicate; native SEQUENCE pre-ASE16 — a deliberate N/A, NO
  `TODO(oracle-W3)` evidence-gap Finding, optionally a benign N/A note);
  `unavailable` (engine supports it and/or the sidecar advertises the capability
  but the value could not be read — the existing `TODO(oracle-W3)` evidence-gap
  Finding).
- Resolution inputs: the `capabilities[]` array (was the group surfaced by this
  sidecar build?), engine-structural knowledge encoded on the discovery side (does
  ASE support the construct at all?), and value presence.
- An absent capability from an OLDER sidecar resolves to `unavailable` (distinct
  from a structural N/A) — capability-absent is a read gap, not a structural N/A.
- Plumb the applicability marker through `types.ts` and consume it in the Sybase
  finding emitters so the `not_applicable_for_engine` cases SUPPRESS the
  evidence-gap Finding that a bare-null currently would (or never emits one for
  structurally-absent constructs).

**Version-tolerant catalog queries**
- Write catalog queries that null-out absent objects and record the engine
  version on the response. Branch by ASE version ONLY where an older catalog would
  hard-error (e.g. the ASE16 `SEQUENCE` catalog). Target ASE15-and-up; degrade
  gracefully. Exact ASE system-catalog columns per group are confirmed at
  implementation time against the target ASE version.

**Sidecar per-row mapper extraction for unit-testability**
- Extract the per-row catalog→object mapping for each group into pure,
  unit-testable methods in `SybaseQueryService` (taking primitive row inputs, NOT
  a fake JDBC `ResultSet`), so `SybaseQueryServiceTest` can cover each group's row
  mapping + the identity-synthesis + the version-branch null-out behaviour without
  a live DB. Follow the existing pure-helper test style (`matchesSchemaFilter`,
  `maskPassword`, `FakeStrategy`).

## Existing Code to Leverage

**`discovery-service/src/services/databasePacks/postgres/postgresIntrospection.ts`**
- `parsePostgresIndexDef` + the `isClustered` decode (~lines 145-224, 732-757) is
  the reference for group 5 ordering/clustering/predicate parsing and how the five
  IR index fields are populated; the Postgres path proves the IR slots end to end.
- The Postgres collation / computed / sequence-current-value / FK-action / jobs
  queries (collation_name, is_generated, pg_sequences.last_value, update_rule/
  delete_rule, pg_cron/pgAgent) show the exact target IR shape Sybase must reach.

**`discovery-service/src/services/databasePacks/sybase/sybaseIntrospection.ts`**
- `transformSidecarIntrospection` already null-tolerantly maps `collation`,
  `isComputed`/`computedExpression`, `deleteRule`/`updateRule`, `currentValue`/
  `ownedBy*`, and `scheduledJobs`; the only mapping gaps are the group-5 `keys[]`
  index fields (bare TODO today) and setting `databaseCollation` on the result.

**`discovery-service/src/services/databasePacks/candidateStructuralFidelity.ts`**
- `constraints_metadata.indexes[]` reshaper (lines ~143-160) already maps all five
  index fields, `fk_columns` reshaper maps `on_delete`/`on_update` (~205-214), and
  the per-attribute reshaper maps `collation`/`is_generated`/`generation_expression`
  (~248-252). Verify the index reshaper covers the new fields; no change expected.

**`discovery-service/src/services/databasePacks/sybase/sybaseFindings.ts` + `findings/.../databasePackFindingBuilders.ts`**
- `emitCollationHazardFindings`, `emitSequenceCutoverFindings`,
  `emitUnsupportedFeatureFindings`, `buildSequenceCutoverHazardFinding`,
  `buildCollationHazardFinding`, `buildScheduledJobFinding`,
  `buildDbEvidenceGapFinding` already encode the present/unavailable behaviour
  (the cutover builder already toggles `currentValueAvailable`). Extend ONLY to add
  the `not_applicable_for_engine` suppression path; reuse the rest as-is.

**`sybase-discovery-sidecar/src/main/java/com/example/sybasesidecar/service/SybaseQueryService.java`**
- `introspectColumns` / `introspectKeysAndIndexes` (the `sysindexes` status-bit
  decode at ~561-566 and the `sysreferences` FK walk at ~581-616) are the queries
  to extend; reuse the schema/table-filter helpers, the per-request connection +
  `applyReadOnly` + timeout pattern, and the `IntrospectionResponse` constructor
  (which must grow the new fields).

## Out of Scope
- Any `architecture-model-service` change (no DTO, Liquibase changeset, entity
  type, or wire-format change).
- Any UI / frontend change.
- New architecture meta-model entity types — this is reality, captured as Findings
  + JSONB only.
- Relaxing the general `/query` SQL guard beyond the one narrow, documented
  read-only Job Scheduler proc allowlist; `/query` stays SELECT-only and keeps
  blanket-blocking `sp_*` / `xp_*`.
- Re-architecting the discovery profiling ladder or the read-only/profiling
  controls (the `MAX(col)` fallback runs WITHIN them, it does not change them).
- Other database engines (Postgres is the parity reference, already complete).
- Any LLM call (none expected; if added it would go via the gateway relay only).

## Testing Requirements

**Mandatory — extend `discovery-service/src/__tests__/sybaseDiscoveryPack.test.ts` (always-on, fetch-mocked)**
- Populate EVERY new optional field on the mocked `SidecarIntrospectionResponse`
  (group-5 index fields, `capabilities`, engine version, `databaseCollation`,
  and the already-wired collation/computed/sequence-current-value/FK-action/jobs
  fields) and assert: the TS mapping into the per-attribute JSONB /
  `constraints_metadata` / `fk_columns`, the Findings fire
  (`collation_case_sensitivity_hazard`, `sequence_cutover_hazard`,
  `db_resident_scheduled_job`, index-fidelity reshaping), and the three-state
  logic — `present`, `not_applicable_for_engine` (ASE partial-index predicate /
  pre-ASE16 sequence: NO evidence-gap Finding), and `unavailable` INCLUDING the
  older-sidecar missing-capability case (absent `capabilities` entry ⇒ `unavailable`,
  not N/A).

**Also — sidecar mapper units**
- Add `SybaseQueryServiceTest` (or a new mapper test) coverage for each group's
  pure per-row mapping method, the identity-synthesis (`sequenceName` /
  `ownedByTable` / `ownedByColumn` shape), and the version-branch null-out
  behaviour, WITHOUT a live DB and WITHOUT a full fake JDBC `ResultSet`.
- Extend `SidecarSqlGuardTest` for the new job-proc allowlist: the allowlisted
  read-only procs pass on the introspection path; the same procs (and all other
  `sp_*` / `xp_*`) are still rejected on the `/query` path.

**End-to-end (CI-optional)**
- The opt-in `SYBASE_INTEGRATION` live-Docker discovery test remains the real
  end-to-end check; no change required beyond it continuing to pass.

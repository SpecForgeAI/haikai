# Task Breakdown: Sybase metadata enrichment (data-layer fidelity parity)

## Overview
Total Tasks: 6 task groups

Bring Sybase data-layer discovery to parity with Postgres by surfacing six
metadata groups from the `sybase-discovery-sidecar` (Java) and wiring
`discovery-service` (TypeScript) to consume them. AMS is untouched.

**Dependency / file-overlap shape.** The sidecar (Java) and discovery
(TypeScript) work touch disjoint files, so the two sides can be implemented in
parallel working trees with minimal conflict. The one coupling is the WIRE
SHAPE: discovery's consumption depends on the exact additive
`IntrospectionResponse` field names (incl. the new group-5 index fields,
`capabilities[]`, and the engine-version string). Group 1 settles that contract
shape FIRST; Groups 2-4 (sidecar) and Groups 5-6 (discovery) then implement
against it independently. Group 6 is the final cross-side verification.

The discovery IR already carries the destinations: `KeyOrIndexMetadata` has all
five group-5 index fields (`types.ts` ~494-505), `IntrospectionResult.databaseCollation`
exists (~635), and the `candidateStructuralFidelity.ts` index reshaper already
maps all five index keys (~143-162). The new discovery work is therefore the
`sybaseIntrospection.ts` mapper lines, the one-line `databaseCollation` set, and
the NEW three-state applicability logic + plumbing. There is no existing
applicability marker in `types.ts` — that is genuinely new.

## Task List

### Contract (settle the wire shape first)

#### Task Group 1: Additive `IntrospectionResponse` contract + per-row mapper extraction
**Side:** SIDECAR (Java) — `sybase-discovery-sidecar`
**Dependencies:** None
**Why first:** every other group binds to these exact field names. Land the
record shape + mapper seams before either side fills them in.

- [x] 1.0 Settle the additive contract and make per-row mapping unit-testable
  - [x] 1.1 Write 2-8 focused tests for the new contract + mapper seams
    - In `SybaseQueryServiceTest`: assert each newly-extracted pure per-row
      mapper method exists and round-trips primitive row inputs into the
      `IntrospectionResponse` records (NOT a fake JDBC `ResultSet` — primitives in,
      record out), following the existing pure-helper test style
      (`matchesSchemaFilter`, `maskPassword`, `FakeStrategy` at
      `SybaseQueryServiceTest.java`).
    - Cover the existing `KeyRow` index-mapper seam carrying the five new fields
      and a `capabilities[]`/engine-version round-trip on the response.
    - Limit to 2-8 highly focused tests; this group proves the SEAMS, not every
      group's content (that lands in Groups 2-4).
  - [x] 1.2 Extend `IntrospectionResponse` (`model/IntrospectionResponse.java`) additively
    - Add to `KeyRow`: `indexDefinition`, `indexMethod`, `isClustered`,
      `indexPredicate`, `columnDirections` (mirror the discovery IR
      `KeyOrIndexMetadata` field names exactly — group 5).
    - Add top-level: `capabilities` (`List<String>`), an engine-version string
      carrying ASE `@@version`, and `databaseCollation` (group 1 DB-level sort order).
    - Add to `ColumnRow` any group-1/2/3 fields not already present that the
      sidecar must now project (collation; `isComputed`/`computedExpression`;
      identity status) so the record can carry them; keep all additions optional/nullable.
    - The sidecar is its OWN Spring Boot module — AMS `snake_case` /
      `@CamelCaseWire` conventions do NOT apply; do not add those annotations.
  - [x] 1.3 Extract per-row catalog→object mappers as pure methods in `SybaseQueryService`
    - For EACH group, extract the row→record mapping out of the JDBC `while
      (rs.next())` loops into pure package-visible methods taking primitive row
      inputs (the `introspectKeysAndIndexes` index-status decode at ~561-566 and
      the `sysreferences` FK walk at ~603-613 are the first to factor out).
    - These pure methods are the unit-test surface for Groups 1-4; the JDBC loops
      become thin "read row → call mapper" shells. Do NOT change query behaviour
      in this task — pure refactor + the new (still-empty/defaulted) fields.
  - [x] 1.4 Update the `IntrospectionResponse` construction site
    - Grow the constructor call in `SybaseQueryService.introspect(...)` to pass the
      new top-level fields (`capabilities`, engine version, `databaseCollation`),
      seeded conservatively (empty/derivable) so the module compiles and existing
      introspection still round-trips.
  - [x] 1.5 Run ONLY the new/extracted mapper-seam tests
    - Run ONLY the 2-8 tests written in 1.1 (single-class Maven run, e.g.
      `mvn -q -pl sybase-discovery-sidecar test -Dtest=SybaseQueryServiceTest`).
    - Do NOT run the whole module suite yet.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass.
- `IntrospectionResponse` carries every new field; all additions optional/nullable.
- Per-row mapping for each group is a pure, unit-testable method (no JDBC in the seam).
- Module compiles; existing introspection round-trips unchanged.
- No AMS annotations added to the sidecar DTOs.

### Sidecar catalog queries

#### Task Group 2: Per-group catalog queries (collation, computed columns, FK actions)
**Side:** SIDECAR (Java) — `sybase-discovery-sidecar`
**Dependencies:** Task Group 1
**Note:** these three are catalog-read-only (no data scans, no guard change).

- [x] 2.0 Surface groups 1, 2, 4 from the ASE system catalogs
  - [x] 2.1 Write 2-8 focused tests for these groups' per-row mappers
    - In `SybaseQueryServiceTest`, drive the pure mappers from 1.3 with primitive
      rows representing: a collation/sort-order value (group 1); a computed column
      with verbatim expression + materialized-vs-virtual signal (group 2); an FK
      row carrying verbatim `on_delete`/`on_update` strings (group 4).
    - Assert the resulting records carry the values verbatim. Limit to 2-8 tests.
  - [x] 2.2 Group 1 — collation / sort-order catalog query
    - Read per-column collation + the database sort order from the base catalog;
      guard-clean base-table reads ONLY — do NOT use `sp_helpsort`.
    - Populate `ColumnRow.collation` and the top-level `databaseCollation`.
  - [x] 2.3 Group 2 — computed columns catalog query
    - Read `syscolumns` computed status + `syscomments` for the verbatim
      expression text inside `/introspect`; carry a materialized-vs-virtual signal
      where ASE exposes it. Populate `isComputed` / `computedExpression`.
  - [x] 2.4 Group 4 — FK referential actions catalog query
    - Extend the `sysreferences` / `sysconstraints` FK walk (~581-616) to project
      `on_delete` / `on_update` as verbatim engine strings onto `KeyRow`
      (`updateRule` / `deleteRule`). Version-tolerant: classic ASE FKs are often
      RESTRICT / NO ACTION, CASCADE is ASE15.7+ — null-out where absent.
  - [x] 2.5 Add these three group keys to `capabilities[]`
    - When the query path runs (engine supports the read), advertise the group in
      `capabilities` so discovery can resolve `present` vs `unavailable`.
  - [x] 2.6 Run ONLY this group's mapper tests
    - Run ONLY the 2-8 tests written in 2.1 (single-class Maven run). Do NOT run
      the whole module suite yet.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass.
- Collation (+ `databaseCollation`), computed-column flag/expression, and FK
  actions are projected verbatim and version-tolerantly.
- The three groups appear in `capabilities[]` when surfaced.
- All reads are catalog-only base-table reads; no `sp_helpsort`; no guard change.

#### Task Group 3: Sequence/identity current value + index clustering/ordering (group 5)
**Side:** SIDECAR (Java) — `sybase-discovery-sidecar`
**Dependencies:** Task Group 1
**Note:** the two heaviest new chunks. Group 3 (identity synthesis + MAX-scan
fallback — a DATA read) and group 5 (the largest single new query). Kept
together as the catalog-plus-derivation queries, distinct from the pure
catalog reads in Group 2.

- [x] 3.0 Surface groups 3 and 5
  - [x] 3.1 Write 2-8 focused tests for the synthesis + index mappers
    - Identity synthesis: assert a `sequences[]`-shaped record is synthesized per
      IDENTITY column with `sequenceName = "<table>.<col> (identity)"` and
      `ownedByTable`/`ownedByColumn` set (decision 7), so the existing
      `sequence_cutover_hazard` Finding fires unchanged downstream.
    - Cheap-path-vs-`MAX(col)` selection logic: assert the synthesized record
      carries the cheap-path value when present, and that the `MAX(col)` fallback
      is invoked ONLY when the cheap value is null (test the selection, not a live scan).
    - Version-branch null-out: assert the ASE16 `SEQUENCE` catalog path null-outs
      (not hard-errors) on a simulated pre-ASE16 / absent-catalog input.
    - Group-5 index mapper: assert `isClustered`, `columnDirections`, and
      `indexDefinition`/`indexMethod` are populated from index status bits + key
      column order/direction primitives. Limit to 2-8 tests.
  - [x] 3.2 Group 3 — IDENTITY columns + native SEQUENCE
    - Read `syscolumns` identity status; synthesize the per-IDENTITY-column
      `sequences[]` record (decision 7). Read the ASE16 `SEQUENCE` catalog on the
      real-sequence path, VERSION-BRANCHED (decision 4) so a pre-ASE16 catalog
      null-outs rather than hard-errors.
  - [x] 3.3 Group 3 — current-value read: cheap path then `MAX(col)` scan fallback
    - Cheap path first (catalog high-water / `ident_current()`); fall back to
      `MAX(<identity_col>)` ONLY where the cheap path is null. The `MAX(col)` read
      is a DATA read on the `/introspect` path — it MUST respect the existing
      read-only / profiling controls and the per-query timeout (reuse the
      per-request connection + `applyReadOnly` + timeout pattern). Keep the
      fallback strictly conditional on a null cheap value; add a code comment
      noting the scan cost is proportional to table size.
  - [x] 3.4 Group 5 — index ordering / clustering query
    - Query `sysindexes` (clustered vs nonclustered via index status bits — the
      `(status & ...)` decode pattern at ~561-566), key column order + ASC/DESC,
      and key columns (`syscolumns` / `syspartitionkeys`). Populate `isClustered`,
      `columnDirections`, and `indexDefinition`/`indexMethod` where derivable.
    - Do NOT attempt `indexPredicate` — ASE has no filtered/partial indexes (it
      resolves to `not_applicable_for_engine` on the discovery side; leave it absent).
  - [x] 3.5 Add groups 3 and 5 to `capabilities[]`
  - [x] 3.6 Run ONLY this group's mapper tests
    - Run ONLY the 2-8 tests written in 3.1 (single-class Maven run). Do NOT run
      the whole module suite yet.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass.
- Identity columns synthesize the documented `sequences[]` shape; the
  `sequence_cutover_hazard` Finding will fire unchanged on the discovery side.
- Current value uses cheap-path-first with a strictly-conditional `MAX(col)`
  fallback that respects the read-only/profiling controls + per-query timeout.
- Group-5 index fields (clustering/ordering/definition) are populated;
  `indexPredicate` is left absent; the ASE16 SEQUENCE path is version-branched.
- Groups 3 and 5 appear in `capabilities[]` when surfaced.

#### Task Group 4: DB-resident jobs + `SidecarSqlGuard` narrow allowlist
**Side:** SIDECAR (Java) — `sybase-discovery-sidecar`
**Dependencies:** Task Group 1
**Note:** the only group that touches `SidecarSqlGuard`; isolated here so the
guard change lands in one place with its own test.

- [x] 4.0 Surface group 6 (DB-resident jobs) behind a narrow read-only allowlist
  - [x] 4.1 Write 2-8 focused tests across the jobs mapper and the guard
    - `SybaseQueryServiceTest`: assert the jobs per-row mapper projects
      `scheduledJobs[]` (name + verbatim schedule + verbatim command + enabled)
      from primitive rows.
    - `SidecarSqlGuardTest`: assert the named read-only Job Scheduler procs PASS on
      the introspection job path, while the SAME procs and all other
      `sp_*` / `xp_*` are STILL rejected on the `/query` path (the existing
      `SP_CALL_PATTERN` block at `SidecarSqlGuard.java` ~70-73, 121-126 stays).
    - Limit to 2-8 tests total across both classes.
  - [x] 4.2 Group 6 — Job Scheduler read
    - Read the Sybase Job Scheduler via read-only Job Scheduler procs and/or
      `sybmgmtdb..js*` base tables; project `scheduledJobs[]` (name + verbatim
      schedule + verbatim command + enabled).
  - [x] 4.3 Add the narrow `SidecarSqlGuard` allowlist
    - Add a NARROW, explicitly-documented allowlist of EXACTLY the read-only procs
      used by the jobs read, usable ONLY by the introspection job path. NAME each
      allowlisted proc in the code comment (and back-fill the names into spec.md
      group 6 at implementation time per the spec's "name at implementation time").
    - The `/query` endpoint keeps blanket-blocking all `sp_*` / `xp_*` (decision 8);
      do NOT relax `assertReadonlySelect`. The `/introspect` PreparedStatements
      already bypass the guard — the allowlist exists to make the proc usage
      explicit and auditable.
  - [x] 4.4 Add group 6 to `capabilities[]`
  - [x] 4.5 Run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 4.1 (single-class Maven runs for
      `SybaseQueryServiceTest` and `SidecarSqlGuardTest`). Do NOT run the whole
      module suite yet.

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass.
- `scheduledJobs[]` is projected verbatim; group 6 appears in `capabilities[]`.
- The allowlisted procs pass on the introspection path and are rejected on `/query`;
  all other `sp_*` / `xp_*` stay blocked on `/query`.
- The allowlisted procs are named in the code comment.

### Sidecar verification

#### Task Group 5: Sidecar full-module verification
**Side:** SIDECAR (Java) — `sybase-discovery-sidecar`
**Dependencies:** Task Groups 1-4

- [x] 5.0 Verify the sidecar module end to end
  - [x] 5.1 Run the full `sybase-discovery-sidecar` Maven test suite
    - Run `mvn -q -pl sybase-discovery-sidecar test` (the full module, including
      `SybaseQueryServiceTest` + `SidecarSqlGuardTest`).
    - This is the MANDATORY sidecar-side verification gate. Confirm green.
  - [x] 5.2 Confirm no regressions to existing sidecar behaviour
    - Existing introspection/query/test-connection paths still pass; the
      `SYBASE_INTEGRATION` opt-in live-Docker path is unchanged (not run in CI).

**Acceptance Criteria:**
- `mvn -pl sybase-discovery-sidecar test` is green.
- No pre-existing sidecar tests regress.

### Discovery consumption

#### Task Group 6: Discovery wiring + three-state applicability + always-on tests
**Side:** DISCOVERY (TypeScript) — `discovery-service`
**Dependencies:** Task Group 1 (wire-shape names settled). Can run in PARALLEL
with sidecar Groups 2-5 once the contract field names from Group 1 are fixed.

- [x] 6.0 Consume the new contract and resolve the three applicability states
  - [x] 6.1 Extend the always-on, fetch-mocked discovery test FIRST
    - In `discovery-service/src/__tests__/sybaseDiscoveryPack.test.ts`, populate
      EVERY new optional field on the mocked `SidecarIntrospectionResponse`
      (group-5 index fields, `capabilities`, engine version, `databaseCollation`,
      plus the already-wired collation / computed / sequence-current-value /
      FK-action / jobs fields).
    - Assert: the TS mapping into the per-attribute JSONB / `constraints_metadata`
      (index reshaping via `candidateStructuralFidelity.ts`) / `fk_columns`; the
      Findings fire (`collation_case_sensitivity_hazard`, `sequence_cutover_hazard`,
      `db_resident_scheduled_job`, index-fidelity reshaping); and the three-state
      logic — `present`, `not_applicable_for_engine` (ASE partial-index predicate
      and pre-ASE16 native sequence: NO `TODO(oracle-W3)` evidence-gap Finding),
      and `unavailable` INCLUDING the older-sidecar missing-capability case (absent
      `capabilities` entry ⇒ `unavailable`, NOT N/A).
    - This is the MANDATORY discovery-side test surface; cover every new field +
      all three states here (this is the test-first sub-task for the group; the
      assertions may exceed the 2-8 cap because the testing decision mandates full
      field + three-state coverage in this single always-on suite).
  - [x] 6.2 Extend the wire type `SidecarIntrospectionResponse`
    - In `sybase/sybaseSidecarClient.ts`, add the group-5 `keys[]` index fields
      (`indexDefinition`, `indexMethod`, `isClustered`, `indexPredicate`,
      `columnDirections`), the top-level `capabilities: string[]`, the
      engine-version string, and the top-level `databaseCollation` — all optional,
      matching the sidecar record names from Task 1.2. The TS mapper is already
      per-field null-tolerant; older discovery ignores unknown fields and newer
      discovery tolerates their absence.
  - [x] 6.3 Add the group-5 mapper lines + the `databaseCollation` fix in `sybaseIntrospection.ts`
    - Replace the bare `TODO(oracle-W3)` comment on the `keys[]` map (~186-188)
      with lines copying the five new index fields onto `KeyOrIndexMetadata`
      (null-tolerant, mirroring the existing `onDelete`/`onUpdate` style).
    - Reference `postgres/postgresIntrospection.ts` (`parsePostgresIndexDef`, the
      `isClustered` decode ~lines 145-224, 732-757) for the parse/clustered-decode
      shape — the Postgres path proves the IR fields end to end.
    - Add the one line populating `IntrospectionResult.databaseCollation` from the
      new top-level wire field (the IR carries it at `types.ts` ~635 but the Sybase
      mapper does not set it yet); `collation_case_sensitivity_hazard` then fires
      unchanged via `emitCollationHazardFindings`.
    - Consume `capabilities[]` from the response so it is available to the
      applicability resolver in 6.5.
  - [x] 6.4 Verify the `candidateStructuralFidelity.ts` index reshaper (no change expected)
    - Confirm the `constraints_metadata.indexes[]` reshaper (~143-162) already maps
      all five fields (`definition`/`method`/`is_clustered`/`predicate`/
      `column_directions`). Expected: VERIFY, no edit. If a gap is found, fix it.
  - [x] 6.5 Add the three-state applicability marker + plumbing
    - Add an applicability marker (no existing one in `types.ts` today) and plumb it
      through `types.ts`. Resolution inputs: `capabilities[]` (was the group
      surfaced by this sidecar build?), engine-structural knowledge encoded on the
      discovery side (does ASE support the construct at all?), and value presence.
    - Resolve exactly one of: `present`; `not_applicable_for_engine` (ASE
      structurally lacks it — partial-index predicate; native SEQUENCE pre-ASE16);
      `unavailable` (engine supports it and/or the capability is advertised but the
      value could not be read). An ABSENT capability from an older sidecar resolves
      to `unavailable`, NOT a structural N/A.
  - [x] 6.6 Consume the marker in the Sybase finding emitters
    - In `sybase/sybaseFindings.ts` + `findings/.../databasePackFindingBuilders.ts`,
      extend the emitters so `not_applicable_for_engine` SUPPRESSES the
      evidence-gap `TODO(oracle-W3)` Finding a bare-null currently would emit (or
      never emits one for structurally-absent constructs), optionally leaving a
      benign N/A note. Reuse the existing builders
      (`emitCollationHazardFindings`, `emitSequenceCutoverFindings`,
      `emitUnsupportedFeatureFindings`, `buildSequenceCutoverHazardFinding` —
      which already toggles `currentValueAvailable` — `buildCollationHazardFinding`,
      `buildScheduledJobFinding`, `buildDbEvidenceGapFinding`); add ONLY the
      `not_applicable_for_engine` suppression path.
  - [x] 6.7 Run ONLY the Sybase discovery suites
    - Run ONLY the Sybase-related vitest suites (`sybaseDiscoveryPack.test.ts` plus
      any sibling Sybase mapper/findings unit suites). Confirm green. Do NOT run the
      entire discovery test suite at this stage.

**Acceptance Criteria:**
- `sybaseDiscoveryPack.test.ts` (always-on, fetch-mocked) passes with every new
  field populated and all three applicability states asserted (incl. the
  older-sidecar missing-capability ⇒ `unavailable` case).
- The Sybase discovery vitest suites run green.
- Group-5 index fields map onto `KeyOrIndexMetadata` and reshape into
  `constraints_metadata.indexes[]`; `databaseCollation` is set on the IR.
- `not_applicable_for_engine` cases (partial-index predicate; pre-ASE16 sequence)
  emit NO `TODO(oracle-W3)` evidence-gap Finding; `unavailable` cases still do.
- No AMS / frontend / meta-model change.

## Execution Order

Recommended implementation sequence:
1. **Task Group 1** — settle the additive `IntrospectionResponse` contract +
   extract pure per-row mappers (gates everything; fixes the wire-shape names).
2. Then in PARALLEL (disjoint files):
   - **SIDECAR**: Task Group 2 (catalog reads) → Task Group 3 (synthesis +
     index) → Task Group 4 (jobs + guard) → **Task Group 5** (full Maven verify).
   - **DISCOVERY**: Task Group 6 (wiring + three-state + always-on tests), which
     depends only on the Group 1 field names.

## Final Verification (per side)
- **SIDECAR:** `mvn -pl sybase-discovery-sidecar test` green (Task Group 5).
- **DISCOVERY:** the Sybase discovery vitest suites
  (`sybaseDiscoveryPack.test.ts` + Sybase siblings) green (Task Group 6.7).
- **End-to-end (CI-optional):** the opt-in `SYBASE_INTEGRATION` live-Docker
  discovery test remains the real end-to-end check; no change required beyond it
  continuing to pass.

## Out of Scope (no tasks)
- `architecture-model-service` — no DTO, Liquibase changeset, entity type, or
  wire-format change.
- Any UI / frontend change.
- New architecture meta-model entity types (this is reality → Findings + JSONB only).
- Relaxing the general `/query` SQL guard beyond the one narrow documented
  read-only job-proc allowlist.
- Re-architecting the discovery profiling ladder or read-only/profiling controls.
- Other database engines (Postgres is the parity reference, already complete).
- Any LLM call.

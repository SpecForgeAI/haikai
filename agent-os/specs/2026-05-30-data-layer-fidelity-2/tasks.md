# Task Breakdown: Data-Layer Fidelity 2 — Cross-Engine DB Capture Completeness (Sybase + Postgres)

## Overview
Total Tasks: 8 task groups

Phase-2 "oracle perfection" **Spec #6 of 6 — the FINAL spec**, built **STRICTLY SEQUENTIALLY LAST** on COMMITTED HEAD `2247065` (Specs 1-5 done; Spec #5's `CallIR.args` is committed at `extract.ts:79` — `args: c.args`). Everything here is **ADDITIVE**: database reality → Findings + on-attribute / on-relationship JSONB metadata. **NEVER a new meta-model entity TYPE** (architecture ≠ reality). **Prefer NO Liquibase changeset** — the SQL-text keys go into the existing free-form `endpoint_data_effects.path_metadata_json` (`Map<String,Object>`, verified at `EndpointDataEffectEntity` lines 110-111), and the collation / computed-column / generation-expression / proc-signature data goes into the existing `physical_data_attributes` metadata. Only if a first-class column is genuinely unavoidable, the next free changeset number is **≥170** (highest applied is **169**, verified), boxed numeric types with null guards.

### Global build cautions (apply to EVERY task group)
- **Build on `2247065`; ADD / EXTEND only — do NOT revert or re-do prior committed work.**
- **W3 (FK referential actions `on_delete`/`on_update` in `fk_columns`; index ordering/clustering/partial-predicate detail `definition`/`method`/`is_clustered`/`predicate`/`column_directions` in `constraints_metadata`) is ALREADY COMMITTED on HEAD — EXTEND alongside it, do NOT redo.** Confirmed present in `types.ts` (`onDelete`/`onUpdate` ~L376-377, ~L560-561; index fields ~L368-558) and `candidateStructuralFidelity.ts` (`is_clustered`/`column_directions`/`on_delete`/`on_update` keys).
- **Reuse — never fork:** Spec #3 introspection (`postgresIntrospection.ts` / `sybaseIntrospection.ts` / `sybaseSidecarClient.ts`), Spec #3 structural-fidelity builders (`candidateStructuralFidelity.ts`), Spec #3 DB-pack finding builders (`databasePackFindingBuilders.ts` / `postgresFindings.ts` / `sybaseFindings.ts`), Spec #1's data-effect path (`endpointDataEffectResolver.ts` / `endpointDataEffectCandidates.ts`), Spec #5's committed `CallIR.args` + `AnnotationIR.args`, and the existing `FindingEmitter` singleton.
- **Capture every engine string VERBATIM** — collation, default expression, generation expression, SQL text, proc definition — NO normalization, NO rewrite. The cross-engine hazard lives in the Finding, never as a mutation of the stored value.
- **Do NOT modify the external Sybase sidecar** — consume only what `sybaseSidecarClient.ts` exposes; leave a `TODO(oracle-W3)`-style note where it does not expose a needed value.
- **NO `discovery-service/src/**` edits during an in-flight discovery run** (tsx watch auto-reload kills runs).
- **All new Findings emit through the existing `FindingEmitter` singleton** — no parallel emit path; fill (do not bypass) the existing `emitUnsupportedFeatureFindings` stubs.

### Verification note — PRE-EXISTING tree-sitter test isolation issue
There is a confirmed, spec-unrelated tree-sitter test-isolation problem: many Java-parsing Jest suites fail when run together in one process (e.g. `endpointDataEffectResolver.test.ts`, `javaFindingScanner.test.ts`, `springClassicFindingScanner.test.ts`). **Run each group's tests IN ISOLATION by path** (a single `--testPathPattern` / single-file invocation per suite), never the whole discovery suite in one process. The DB-introspection groups (B/C/D/E/F/G) feed **synthetic IR / synthetic rows — no live DB** — so those suites are isolation-safe; the SQL-text group (A) and the frontend group (H) touch the Java-parsing path and MUST be run alone. Runner per service: **discovery = Jest**, **AMS = Maven** (only if an AMS field is added), **frontend = Vitest**.

---

## Task List

### Endpoint Data-Effect Capture

#### Task Group A: Per-endpoint SQL TEXT capture (Spec #1 data-effect path + Spec #5 retained literals)
**Dependencies:** None within this spec (relies on Spec #5's already-committed `CallIR.args`). Build FIRST so the shared `endpointDataEffectResolver.ts` / `endpointDataEffectCandidates.ts` edits land before the frontend group (H) consumes them.

**CAUTION:** Build on `2247065`; ADD/EXTEND only. REUSE Spec #1's resolver/candidate path — do NOT fork a parallel `@Query`/native-SQL scanner (verified none exists today). CONSUME Spec #5's committed `CallIR.args` (`extract.ts:79` = `args: c.args`) and the existing `AnnotationIR.args` (`Record<string,string>`, `astUtils.ts` ~L219-238) — do NOT re-implement literal extraction. Capture SQL VERBATIM. This group touches the Java-parsing path — run its tests IN ISOLATION. No `src/**` edits during an in-flight run.

- [x] A.0 Complete per-endpoint SQL TEXT capture
  - [x] A.1 Write 2-8 focused tests FIRST for SQL-text capture
    - New suite e.g. `discovery-service/src/__tests__/endpointSqlTextCaptureGroupA.test.ts`, feeding synthetic IR (`AnnotationIR.args` + `CallIR.args`) into the resolver/candidate path
    - Cover ONLY: (1) `@Query` JPQL → `query_text` + `query_kind: 'jpql'` on resolved `path_metadata_json`; (2) `@Query(nativeQuery=true)` → `query_kind: 'native'`; (3) JdbcTemplate string SQL from `CallIR.args` → `query_kind: 'jdbc_template'`; (4) MyBatis mapper SQL → `query_kind: 'mybatis'`; (5) unresolved native/dynamic SQL → verbatim SQL attached to the `endpoint_data_effect_unresolved` Finding `detail` instead of discarded
    - Skip exhaustive coverage of every controller→service→repository chain shape
  - [x] A.2 Add `query_text` + `query_kind` to the resolved metadata type and `toPathMetadata`
    - `endpointDataEffectCandidates.ts`: extend `EndpointDataEffectPathMetadata` (~L60) and `toPathMetadata` (~L65) to assemble `query_text` (verbatim SQL/JPQL) + `query_kind` alongside the existing `hops` / `operation_hint` / `transactional` keys
    - Additive keys into the existing free-form `path_metadata_json` JSONB — NO new column, NO changeset (`Map<String,Object>`, verified `EndpointDataEffectEntity` L110-111)
  - [x] A.3 Resolve the SQL string in `endpointDataEffectResolver.ts`
    - Read `@Query` value from `AnnotationIR.args` (JPQL vs native distinguished by the `nativeQuery=true` arg)
    - Read JdbcTemplate / `createNativeQuery` string SQL from Spec #5's committed `CallIR.args` (no longer `[]`)
    - Read MyBatis mapper SQL from the existing mapper-resolution path
    - Carry the resolved `queryText` + `queryKind` onto `ResolvedDataEffect` so `toPathMetadata` can emit them
  - [x] A.4 Attach verbatim SQL to the unresolved Finding instead of discarding it
    - At the dynamic-persistence escape / unresolved emit (`endpointDataEffectResolver.ts` ~L700 escape / ~L1045 emit; `UnresolvedDataEffect` shape ~L232), include the verbatim SQL string in the `endpoint_data_effect_unresolved` Finding `detail`
    - Keep VERBATIM — no normalization
  - [x] A.5 Thread `query_text`/`query_kind` through the AMS DTO/mapper (additive, NO changeset)
    - `EndpointDataEffectDto` + `EndpointDataEffectMapper`: since `path_metadata_json` is a free-form `Map<String,Object>`, the additive keys round-trip without a schema change — verify the map passes through unmodified; add a focused AMS round-trip assertion ONLY if the mapper reshapes the map
    - If (and only if) the mapper proves it drops unknown keys, run AMS via Maven for this assertion; otherwise no AMS test is required
  - [x] A.6 Mark A tasks `- [x]` and run ONLY this group's tests IN ISOLATION
    - Run ONLY the suite from A.1 by path (single `--testPathPattern`), NOT the whole discovery suite (tree-sitter isolation)
    - If an AMS round-trip assertion was added in A.5, run ONLY that AMS test via Maven
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests from A.1 pass in isolation
- `query_text` + `query_kind` appear on resolved `path_metadata_json` for `@Query` (JPQL + native), JdbcTemplate string, and MyBatis SQL
- Unresolved native/dynamic SQL is captured verbatim on the `endpoint_data_effect_unresolved` Finding `detail`, not discarded
- No new column, no changeset; SQL kept verbatim; no parallel scanner forked

**Verification note:** Discovery = Jest, single-suite-by-path (Java-parsing path → isolation-required). AMS = Maven only if A.5 adds a round-trip assertion.

---

### DB Introspection IR (shared foundation for B/C/E/G)

#### Task Group B: Collation / case-sensitivity capture + cross-engine hazard Finding
**Dependencies:** None within this spec. Touches the shared introspection + IR-types + structural-fidelity files; orderable with C/E/G (all extend `types.ts` / `candidateStructuralFidelity.ts` — sequence B→C→E→G to serialize edits to those shared files cleanly).

**CAUTION:** Build on `2247065`; ADD/EXTEND only. EXTEND Spec #3 introspection + the `ColumnMetadata` IR type + `candidateStructuralFidelity.ts` ALONGSIDE W3's already-committed fields — do NOT touch or redo W3. Sybase reads collation from the sidecar where exposed — consume only, never modify the sidecar. Collation string VERBATIM. Synthetic-IR tests → isolation-safe. No `src/**` edits during an in-flight run.

- [x] B.0 Complete collation capture + hazard Finding
  - [x] B.1 Write 2-8 focused tests FIRST for collation
    - New suite e.g. `discovery-service/src/__tests__/dbCollationGroupB.test.ts`, synthetic IR/rows (no live DB)
    - Cover ONLY: (1) Postgres column + DB-level collation introspected onto the IR; (2) Sybase column collation read from the sidecar shape (and the absent-value path); (3) column collation appears in the `physical_data_attributes` metadata via the builder; (4) a cross-engine hazard Finding emitted when source collation implies case-insensitive (Sybase CI) vs Postgres CS default
    - Skip exhaustive per-collation-name coverage
  - [x] B.2 Extend introspection to read collation
    - `postgresIntrospection.ts`: add column-level + database-level collation to the column/DB query (verbatim string)
    - `sybaseIntrospection.ts` / `sybaseSidecarClient.ts`: read collation where the sidecar exposes it; `TODO(oracle-W3)`-style note + mark unavailable otherwise (do NOT modify the sidecar)
  - [x] B.3 Add additive collation fields to the IR types
    - `databasePacks/types.ts`: add an additive optional `collation` field to `ColumnMetadata` (~L268-304) + a DB-level collation carrier — alongside the W3 fields, NOT touching them
  - [x] B.4 Add column collation to the physical-attribute JSONB
    - `candidateStructuralFidelity.ts`: add `collation` to the per-attribute `physical_data_attributes` `data` payload (alongside `source_type` / `column_default` ~L227-232), snake_case verbatim
  - [x] B.5 Emit the CI→CS cross-engine hazard Finding
    - Via `databasePackFindingBuilders.ts` / `postgresFindings.ts` / `sybaseFindings.ts` through the existing `FindingEmitter` — flag when a Sybase CI collation would NOT be reproduced by Postgres's CS default (silent `WHERE name='smith'` divergence)
  - [x] B.6 Thread collation through the AMS physical-attribute DTO/mapper if it lands as a first-class field
    - Default: collation rides in the existing `physical_data_attributes` metadata (no changeset). VERIFY whether it needs a first-class column on `PhysicalDataAttributeEntity` — only if genuinely unavoidable, changeset floor ≥170; otherwise no AMS change
  - [x] B.7 Mark B tasks `- [x]` and run ONLY this group's tests IN ISOLATION
    - Run ONLY the suite from B.1 by path; isolation-safe (synthetic rows)
    - AMS via Maven ONLY if B.6 added a first-class field
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- The 2-8 tests from B.1 pass in isolation
- Column + DB-level collation captured verbatim into the IR and onto the `physical_data_attributes` metadata
- Sybase collation read from the sidecar where exposed; unavailable path noted, sidecar untouched
- CI→CS cross-engine hazard Finding emitted via `FindingEmitter`
- W3 fields untouched; no normalization

**Verification note:** Discovery = Jest, single-suite-by-path (isolation-safe synthetic IR). AMS = Maven only if a first-class column was added.

---

#### Task Group C: Sequence current value + cutover-hazard Finding
**Dependencies:** None within this spec; sequences `types.ts` edit orderable after B (shared `types.ts`).

**CAUTION:** Build on `2247065`; ADD/EXTEND only. EXTEND `SequenceMetadata` (today start/increment/min/max/cycle ONLY, ~L316). Postgres `last_value`/`currval` introspected; Sybase via sidecar `sequences` if a current-value field exists, else `TODO(oracle-W3)` note + Finding marked value-unavailable — do NOT modify the sidecar. Synthetic-IR tests → isolation-safe. No `src/**` edits during an in-flight run.

- [x] C.0 Complete sequence current-value capture + cutover Finding
  - [x] C.1 Write 2-8 focused tests FIRST for sequence current value
    - New suite e.g. `discovery-service/src/__tests__/dbSequenceCurrentValueGroupC.test.ts`, synthetic IR/rows
    - Cover ONLY: (1) Postgres `last_value`/`currval` introspected onto `SequenceMetadata`; (2) cutover-hazard Finding emitted carrying the high-water-mark value; (3) Sybase path where the sidecar exposes no current-value → Finding marked value-unavailable + `TODO(oracle-W3)` note
    - Skip exhaustive sequence-shape coverage
  - [x] C.2 Extend introspection to read the current value
    - `postgresIntrospection.ts`: add `last_value` / `currval` to the sequence query (verbatim)
    - Sybase: read current value from `sybaseSidecarClient.ts` `sequences` ONLY if exposed; else note + mark unavailable (sidecar untouched)
  - [x] C.3 Add additive current-value field to `SequenceMetadata`
    - `databasePacks/types.ts`: additive optional `currentValue` / `lastValue` on `SequenceMetadata` (~L316), alongside the existing start/increment/min/max/cycle
  - [x] C.4 Emit the cutover-hazard Finding
    - Via the DB-pack finding builders through `FindingEmitter`: first post-cutover INSERT would collide with existing PKs unless the target sequence is advanced past the captured high-water mark; include the value (or "unavailable")
  - [x] C.5 Mark C tasks `- [x]` and run ONLY this group's tests IN ISOLATION
    - Run ONLY the suite from C.1 by path; isolation-safe
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- The 2-8 tests from C.1 pass in isolation
- Postgres `last_value`/`currval` captured onto `SequenceMetadata` verbatim
- Cutover-hazard Finding emitted via `FindingEmitter` with the high-water mark (or value-unavailable for Sybase)
- Sybase handled via the sidecar if exposed, else TODO-noted; sidecar untouched

**Verification note:** Discovery = Jest, single-suite-by-path (isolation-safe synthetic IR). No AMS / frontend change required by this group (Finding-only + IR field).

---

### DB-Pack Cross-Engine Hazard Findings (D/F build on the finding builders)

#### Task Group D: Engine-specific default-expression hazard Findings
**Dependencies:** None within this spec; uses the captured `column_default` (already present from Spec #3). Orderable any time after the finding-builder file is understood.

**CAUTION:** Build on `2247065`; ADD/EXTEND only. **FLAG only — never rewrite.** KEEP the verbatim `column_default` exactly as captured (the hazard lives in the Finding, NOT in a mutation of the stored expression). Emit via `FindingEmitter`. Synthetic-IR tests → isolation-safe. No `src/**` edits during an in-flight run.

- [x] D.0 Complete non-portable-default hazard Findings
  - [x] D.1 Write 2-8 focused tests FIRST for default-expression hazards
    - New suite e.g. `discovery-service/src/__tests__/dbDefaultExprHazardGroupD.test.ts`, synthetic IR with `column_default` values
    - Cover ONLY: (1) `getdate()` flagged; (2) `newid()` flagged; (3) a non-engine-specific default (e.g. `0` / literal) NOT flagged; (4) the verbatim `column_default` string is unchanged on the attribute after the Finding is emitted
    - Skip exhaustive coverage of every engine builtin
  - [x] D.2 Detect engine-specific server defaults
    - In `databasePackFindingBuilders.ts` (+ `postgresFindings.ts` / `sybaseFindings.ts` as appropriate): detect `getdate()` / `newid()` / `suser_name()` / `host_name()` and the like in the captured `column_default`
  - [x] D.3 Emit the non-portable-default Finding for the book-of-work
    - Via `FindingEmitter`; include the verbatim default string and the owning table/column; do NOT mutate the stored `column_default`
  - [x] D.4 Mark D tasks `- [x]` and run ONLY this group's tests IN ISOLATION
    - Run ONLY the suite from D.1 by path; isolation-safe
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- The 2-8 tests from D.1 pass in isolation
- Engine-specific server defaults (`getdate()`/`newid()`/`suser_name()`/`host_name()` etc.) emit a non-portable-default Finding via `FindingEmitter`
- The stored `column_default` is unchanged (verbatim) — flag-only, no rewrite
- Non-engine-specific defaults are NOT flagged

**Verification note:** Discovery = Jest, single-suite-by-path (isolation-safe synthetic IR). Finding-only — no AMS / frontend schema change.

---

#### Task Group E: Computed / generated columns (flag + verbatim generation expression)
**Dependencies:** Shares `types.ts` + `candidateStructuralFidelity.ts` with B/C/G — order after B (serialize shared-file edits).

**CAUTION:** Build on `2247065`; ADD/EXTEND only, alongside W3 fields. Capture the generation expression VERBATIM. Postgres `GENERATED ALWAYS AS (expr)`; Sybase computed-column flag via the sidecar where exposed (sidecar untouched). Synthetic-IR tests → isolation-safe. No `src/**` edits during an in-flight run.

- [x] E.0 Complete computed/generated-column capture
  - [x] E.1 Write 2-8 focused tests FIRST for computed columns
    - New suite e.g. `discovery-service/src/__tests__/dbComputedColumnGroupE.test.ts`, synthetic IR/rows
    - Cover ONLY: (1) Postgres `GENERATED ALWAYS AS (expr)` → computed flag set + expression captured verbatim on the IR; (2) a plain writable column → flag NOT set; (3) the flag + generation expression appear in the `physical_data_attributes` metadata via the builder; (4) Sybase computed-column path where the sidecar exposes the flag
    - Skip exhaustive expression-shape coverage
  - [x] E.2 Extend introspection to detect computed/generated columns
    - `postgresIntrospection.ts`: detect generated columns + capture the generation expression verbatim
    - `sybaseIntrospection.ts` / `sybaseSidecarClient.ts`: read the computed flag/expression where exposed; note + skip otherwise (sidecar untouched)
  - [x] E.3 Add additive computed-flag + generation-expression fields to `ColumnMetadata`
    - `databasePacks/types.ts`: additive optional `isGenerated` (boolean-style) + `generationExpression` on `ColumnMetadata` (~L268-304), alongside the W3 fields
  - [x] E.4 Add the flag + expression to the physical-attribute JSONB
    - `candidateStructuralFidelity.ts`: add the computed flag + verbatim generation expression to the per-attribute `physical_data_attributes` `data` payload (alongside `source_type`/`column_default`/`is_identity`), snake_case verbatim
  - [x] E.5 Thread through the AMS physical-attribute DTO/mapper if first-class
    - Default: rides in the existing `physical_data_attributes` metadata (no changeset). VERIFY whether a first-class column is genuinely needed on `PhysicalDataAttributeEntity` — only if unavoidable, changeset floor ≥170, boxed types + null guards; otherwise no AMS change
  - [x] E.6 Mark E tasks `- [x]` and run ONLY this group's tests IN ISOLATION
    - Run ONLY the suite from E.1 by path; isolation-safe
    - AMS via Maven ONLY if E.5 added a first-class field
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- The 2-8 tests from E.1 pass in isolation
- Generated/computed columns flagged + generation expression captured verbatim into the IR and onto the `physical_data_attributes` metadata
- Plain writable columns are NOT flagged; Sybase handled via the sidecar where exposed, sidecar untouched
- W3 fields untouched; no normalization

**Verification note:** Discovery = Jest, single-suite-by-path (isolation-safe synthetic IR). AMS = Maven only if a first-class column was added.

---

#### Task Group F: Database-resident jobs / agents Findings (fill the empty `emitUnsupportedFeatureFindings` stubs)
**Dependencies:** None within this spec; uses the finding builders + `FindingEmitter`. Orderable any time.

**CAUTION:** Build on `2247065`; ADD/EXTEND only. **FILL the empty stubs — do NOT bypass them with a parallel emit path.** Both `postgresFindings.ts` ~L587 and `sybaseFindings.ts` ~L510 currently `return []` (verified). Jobs/agents are procedural reality → Findings, **NOT entity types**. Verbatim job/agent detail. Sybase scheduler via the sidecar where exposed (sidecar untouched). Synthetic-IR tests → isolation-safe. No `src/**` edits during an in-flight run.

- [x] F.0 Complete DB-resident jobs/agents Findings
  - [x] F.1 Write 2-8 focused tests FIRST for jobs/agents Findings
    - New suite e.g. `discovery-service/src/__tests__/dbScheduledJobsGroupF.test.ts`, synthetic introspection input
    - Cover ONLY: (1) `emitUnsupportedFeatureFindings` in `postgresFindings.ts` now returns a job/agent Finding for a scheduled-job input (no longer `[]`); (2) the same for `sybaseFindings.ts` (Sybase scheduler input); (3) empty input → no spurious Finding; (4) the Finding carries the verbatim job/agent detail and routes through `FindingEmitter`
    - Skip exhaustive scheduler-shape coverage
  - [x] F.2 Introspect database scheduled jobs / agents
    - Postgres: introspect the scheduled-job/agent equivalent where present; Sybase: read scheduler jobs/agents from `sybaseSidecarClient.ts` where exposed (note + skip otherwise; sidecar untouched)
    - Carry the job/agent rows into the introspection shape the finding builders read
  - [x] F.3 Fill `emitUnsupportedFeatureFindings` in BOTH packs
    - `postgresFindings.ts` ~L587 and `sybaseFindings.ts` ~L510: replace `return []` with rich Findings for genuinely-unsupported / non-portable DB-resident features (scheduled jobs/agents), emitted through `FindingEmitter` — procedural reality, NOT entity types
  - [x] F.4 Mark F tasks `- [x]` and run ONLY this group's tests IN ISOLATION
    - Run ONLY the suite from F.1 by path; isolation-safe
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- The 2-8 tests from F.1 pass in isolation
- `emitUnsupportedFeatureFindings` in BOTH packs returns rich job/agent Findings (no longer `return []`), via `FindingEmitter`
- Findings carry verbatim job/agent detail; empty input emits nothing spurious
- No new entity types minted; Sybase sidecar untouched

**Verification note:** Discovery = Jest, single-suite-by-path (isolation-safe synthetic input). Finding-only — no AMS / frontend schema change.

---

### Postgres Procedure Capture

#### Task Group G: Fuller Postgres procedure capture
**Dependencies:** Shares `postgresIntrospection.ts` + `types.ts` with B/C/E — order after E (serialize shared-file edits). Independent of the Sybase path.

**CAUTION:** Build on `2247065`; ADD/EXTEND only. Today `p.prosrc AS proc_src` ONLY (verified `postgresIntrospection.ts:824`); the body still goes to its EXISTING Finding — the richer signature/volatility/`SECURITY DEFINER` metadata is captured ALONGSIDE it. Capture VERBATIM. Synthetic-IR tests → isolation-safe. No `src/**` edits during an in-flight run.

- [x] G.0 Complete fuller Postgres procedure capture
  - [x] G.1 Write 2-8 focused tests FIRST for fuller proc capture
    - New suite e.g. `discovery-service/src/__tests__/dbProcedureCaptureGroupG.test.ts`, synthetic proc rows
    - Cover ONLY: (1) `pg_get_functiondef`-based definition (or signature/args/return/volatility/`SECURITY DEFINER`) captured onto `ProcedureMetadata` alongside `prosrc`; (2) an overloaded function is distinguishable by signature; (3) a `SECURITY DEFINER` function flagged; (4) the existing body Finding still emitted unchanged
    - Skip exhaustive proc-shape coverage
  - [x] G.2 Extend the Postgres procedure query
    - `postgresIntrospection.ts` ~L818-839: add `pg_get_functiondef(p.oid)` (or signature / arguments / return type / volatility / `SECURITY DEFINER`) ALONGSIDE the existing `p.prosrc AS proc_src` (L824) — keep `prosrc` for the body Finding
  - [x] G.3 Add additive fuller-capture fields to `ProcedureMetadata`
    - `databasePacks/types.ts`: additive optional signature / arguments / return type / volatility / `SECURITY DEFINER` (and/or full `functiondef`) carrier on `ProcedureMetadata` (~L426), verbatim
  - [x] G.4 Route body to the existing Finding; capture richer metadata alongside
    - Body still flows to its existing procedure Finding unchanged; the richer signature/volatility/security metadata is captured alongside (so overloaded + security-context functions are recreatable)
  - [x] G.5 Mark G tasks `- [x]` and run ONLY this group's tests IN ISOLATION
    - Run ONLY the suite from G.1 by path; isolation-safe
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- The 2-8 tests from G.1 pass in isolation
- `pg_get_functiondef` / signature / args / return / volatility / `SECURITY DEFINER` captured onto `ProcedureMetadata` verbatim alongside `prosrc`
- The existing body Finding still emits unchanged; overloaded + security-context functions are distinguishable
- W3 fields untouched; no normalization

**Verification note:** Discovery = Jest, single-suite-by-path (isolation-safe synthetic rows). Finding/IR-only — no AMS / frontend schema change unless a first-class field is added.

---

### Frontend

#### Task Group H: Render new signals in existing candidate-details + finding-type labels
**Dependencies:** Task Groups A-G (consumes the new `query_text`/`query_kind`, collation, computed-column, default-hazard, sequence, jobs/agents, and proc signals and the new finding types). Build LAST.

**CAUTION:** Build on `2247065`; ADD/EXTEND only. Render into the EXISTING candidate-details surfaces + `FindingsTab` — **no bespoke widget**; reuse the existing expandable read-only SQL-viewer pattern for the SQL text. Add the new finding-type labels to `findingTypeLabels.ts`. This group touches the frontend (Vitest) — isolation concern is N/A for Vitest, but still run ONLY this group's suite.

- [x] H.0 Complete frontend rendering of new signals
  - [x] H.1 Write 2-8 focused tests FIRST for the new frontend signals
    - New suite e.g. `frontend/src/components/Discovery/FindingsTab.dataLayerFidelity2.test.tsx` (+ a candidate-details render assertion where applicable)
    - Cover ONLY: (1) `query_text` renders in the existing expandable read-only SQL viewer with the `query_kind` label; (2) collation shows on the candidate-details physical-attribute surface; (3) the computed-column flag + generation expression render; (4) the new finding-type labels (collation CI→CS, sequence cutover, non-portable default, DB-resident jobs/agents) resolve via `findingTypeLabels.ts`
    - Skip exhaustive UI-state coverage
  - [x] H.2 Add the new finding-type labels
    - `frontend/src/components/Discovery/findingTypeLabels.ts`: add labels for the new finding types (collation CI→CS hazard, sequence cutover hazard, non-portable default hazard, DB-resident jobs/agents)
  - [x] H.3 Render `query_text` / `query_kind` in candidate-details
    - Surface the SQL text via the EXISTING expandable read-only viewer pattern in the candidate-details panel, labelled by `query_kind` — no new widget
  - [x] H.4 Render collation / computed-column / default-hazard signals
    - Surface collation, the computed-column flag + generation expression, and the default-hazard signal in the EXISTING physical-attribute candidate-details surfaces
  - [x] H.5 Mark H tasks `- [x]` and run ONLY this group's tests
    - Run ONLY the suite(s) from H.1 via Vitest, NOT the whole frontend suite
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- The 2-8 tests from H.1 pass
- `query_text` renders in the existing expandable read-only viewer with its `query_kind` label
- Collation, computed-column flag + generation expression, and default-hazard signals render in the existing candidate-details surfaces
- New finding-type labels resolve via `findingTypeLabels.ts`; no bespoke widget added

**Verification note:** Frontend = Vitest, single-suite-by-path.

---

## Phase-2 Build Ordering & File-Overlap

**This is Spec #6 of 6 — the FINAL spec — built STRICTLY SEQUENTIALLY LAST** on COMMITTED HEAD `2247065`. It is the most downstream spec and EXTENDS every prior committed spec rather than running in parallel.

- **Hard ordering — built AFTER Spec #5 (already committed on this HEAD).** Group A consumes Spec #5's retained call-argument literals: `extract.ts:79` is now `args: c.args` (no longer `args: []`), so `CallIR.args: string[]` is populated for JdbcTemplate / `createNativeQuery` SQL strings, and `AnnotationIR.args` (`Record<string,string>`) carries the `@Query` value. Building A before #5 would mean the SQL literals were still dropped at the extractor.
- **Extends W3 (already committed on this HEAD) — do NOT redo.** Groups B/C/E/G share the DB introspection (`postgresIntrospection.ts` / `sybaseIntrospection.ts`), the IR types (`types.ts`), and the structural-fidelity builder (`candidateStructuralFidelity.ts`). W3's FK-action (`on_delete`/`on_update` in `fk_columns`) and index ordering/clustering/partial-predicate detail (`definition`/`method`/`is_clustered`/`predicate`/`column_directions` in `constraints_metadata`) ALREADY live in these files — add collation / computed-column flag / generation expression / sequence current value / fuller proc capture ALONGSIDE, never re-doing W3.
- **Extends Spec #1's data-effect path + Spec #5.** Group A shares the endpoint data-effect path (`endpointDataEffectResolver.ts` / `endpointDataEffectCandidates.ts`): it adds `query_text`/`query_kind` to the resolved `path_metadata_json` and attaches the verbatim SQL to the `endpoint_data_effect_unresolved` Finding — additive into the same path, no parallel scanner.
- **Extends Spec #3's DB-pack Finding builders + `FindingEmitter`.** Groups B/C/D/F (and any hazard Finding) share `databasePackFindingBuilders.ts` / `postgresFindings.ts` / `sybaseFindings.ts` and the `FindingEmitter` singleton; this spec adds the new cross-engine hazard Findings and FILLS the empty `emitUnsupportedFeatureFindings` stubs (`postgresFindings.ts` ~L587, `sybaseFindings.ts` ~L510, both `return []`) Spec #3 left as placeholders.
- **Shared introspection / IR files are orderable WITHIN this spec.** Because B/C/E/G all extend `types.ts` and B/E extend `candidateStructuralFidelity.ts`, sequence them **B → C → E → G** to serialize edits to those shared files; D and F (Finding-builder-only) can slot in any time after the builder file is understood; A is independent (data-effect path); H is strictly last (consumes all of A-G).
- **Net effect:** all shared files already carry the prior specs' committed changes; this spec's job is to EXTEND them additively — never fork a parallel implementation, never re-do W3.

## Execution Order

Recommended implementation sequence:
1. Task Group A — Per-endpoint SQL TEXT capture (independent; data-effect path)
2. Task Group B — Collation capture + hazard Finding (first shared `types.ts` / `candidateStructuralFidelity.ts` edit)
3. Task Group C — Sequence current value + cutover Finding (shared `types.ts`)
4. Task Group D — Default-expression hazard Findings (Finding-builder-only; slottable any time after the builder is understood)
5. Task Group E — Computed/generated columns (shared `types.ts` / `candidateStructuralFidelity.ts`)
6. Task Group F — DB-resident jobs/agents Findings (fill the empty stubs; Finding-builder-only)
7. Task Group G — Fuller Postgres procedure capture (shared `postgresIntrospection.ts` / `types.ts`)
8. Task Group H — Frontend rendering + finding-type labels (LAST; consumes A-G)

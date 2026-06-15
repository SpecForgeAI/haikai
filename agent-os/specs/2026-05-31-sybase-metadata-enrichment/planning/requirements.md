# Requirements — Sybase metadata enrichment (data-layer fidelity parity)

## Context & goal

HAIKAI does like-for-like API/DB migration; for the **database** black box,
discovery IS the schema-migration source of truth (see memory
`project_migration_ultimate_goal`). The discovery-service data-layer capture is
**fully populated for PostgreSQL** (it reads the catalogs directly) but only
**partially populated for Sybase**, because Sybase is reached solely through the
in-repo `sybase-discovery-sidecar` Spring Boot service, which today surfaces
structural shape but not the richer metadata. The discovery side already carries
optional slots + "value unavailable → `TODO(oracle-W3)`" evidence-gap Findings
(added by Spec-6, `agent-os/specs/2026-05-30-data-layer-fidelity-2`) that are
waiting to be filled for Sybase.

**Goal:** bring Sybase data-layer fidelity to **parity with Postgres** by making
the sidecar surface six metadata groups and wiring discovery to consume them.

**Grounding (non-negotiable):** this metadata is migration **reality**, persisted
as **Findings + JSONB**, NOT new architecture meta-model entity types (see
`gateway/src/config/prompts/shared/architecture-context-explainer.md`, memories
`feedback_read_meta_model`, `project_architecture_vs_reality`). No new entity
types.

**Key finding from shaping:** the discovery side is already ~80% wired. Five of
the six groups have named optional fields on `SidecarIntrospectionResponse`, a
null-tolerant TS mapper (`sybaseIntrospection.ts`), JSONB reshapers
(`candidateStructuralFidelity.ts`), and Finding builders that already fire. The
real work is (a) the per-group Sybase **catalog queries in the sidecar**, and
(b) **index ordering/clustering/partial-predicate** — the single group missing a
sidecar wire field AND discovery mapper lines on both sides.

## Scope

**In scope (two services only):** `sybase-discovery-sidecar` (Java/Spring Boot)
and `discovery-service` (TypeScript).

**Out of scope:** `architecture-model-service` (no DTO/changeset/entity-type
change — everything lands in existing JSONB + Finding types); any UI; relaxing
the general `/query` SQL guard beyond the one narrow introspection allowlist
below; re-architecting the discovery profiling ladder; other DB engines.

## Resolved decisions

1. **v1 field scope = ALL SIX groups** in this one spec (collation; computed
   columns; sequence/identity current value; FK referential actions; index
   ordering/clustering/partial-predicate; DB-resident jobs). Rationale: marginal
   sidecar cost per already-wired group is ~one catalog query; the perfection
   bar (no cuts). Index clustering is the largest single new chunk.
2. **Three applicability states.** Introduce a distinct `not_applicable_for_engine`
   state alongside `present` and `unavailable`, so a feature Sybase ASE
   structurally lacks (partial/filtered-index predicate; native SEQUENCE objects
   pre-ASE16) is recorded as a deliberate N/A, NOT misread by
   reconciliation/book-of-work as a capture failure.
3. **Capability marker on the contract.** Add a `capabilities: string[]` array to
   the sidecar introspection response listing the groups that sidecar build
   surfaces. Lets discovery distinguish "this sidecar build doesn't surface group
   X" from "group X surfaced but genuinely null". Additive; mirrors the repo's
   dual-tolerance idiom (CLAUDE.md). Older sidecar omits it → discovery treats an
   absent capability as `unavailable` (not `not_applicable`).
4. **Version-tolerant queries.** Write catalog queries that null-out absent
   objects and record `@@version` on the response for evidence; branch by ASE
   version ONLY where a query would hard-error on an older catalog (e.g. the
   ASE16 `SEQUENCE` catalog). Target ASE15-and-up, degrade gracefully.
5. **Testing bar = discovery tests + sidecar mapper units.** (a) MANDATORY:
   extend the always-on `fetch`-mocked `sybaseDiscoveryPack.test.ts` with the new
   optional fields populated, proving the TS mapping + Findings + three-state
   logic. (b) ALSO: extract the sidecar per-row catalog→object mapping into pure,
   unit-testable methods and unit-test them, covering the Java SQL→object mapping
   without a live DB (NOT a full fake JDBC ResultSet). The opt-in
   `SYBASE_INTEGRATION` live-Docker path remains for real end-to-end.
6. **AMS untouched.** Confirmed: everything flows through existing
   `constraints_metadata` / `fk_columns` / per-attribute JSONB + existing Finding
   types. No AMS DTO, changeset, or entity-type change.
7. **Identity ↔ sequence keying + read method.**
   - Keying: synthesize a `SequenceMetadata`-shaped record per IDENTITY column
     (`sequenceName = "<table>.<col> (identity)"`, `ownedByTable`/`ownedByColumn`
     set) so the existing `sequence_cutover_hazard` Finding fires unchanged.
     Reserve the real-SEQUENCE path for ASE16 native sequences.
   - Current-value read = **cheap path first, then `MAX(col)` scan fallback**:
     read the catalog high-water / `ident_current()` where ASE exposes it; where
     null, fall back to a `MAX(<identity_col>)` scan to get the true high-water.
     NB this is a **data** read (not catalog) — it runs on the `/introspect`
     path and must respect the existing read-only/profiling controls; flag the
     scan-cost consideration in the spec.
8. **DB-resident jobs via a narrow guard allowlist.** Job discovery uses the
   read-only Sybase Job Scheduler procs (e.g. `sp_sjobhistory` / job-scheduler
   catalog procs). Add a **narrow, explicitly-documented allowlist** of exactly
   those read-only procs to `SidecarSqlGuard`, used ONLY by the new introspection
   paths; the general `/query` endpoint keeps blanket-blocking all `sp_*`/`xp_*`.
   Document precisely which procs are allowlisted and why.

## The six metadata groups

For each: Sybase source → sidecar wire field → discovery slot/Finding → work
needed. Discovery-side field names below are shaper-verified; exact ASE catalog
columns are confirmed against the target ASE version at implementation time
(queries are version-tolerant per decision 4).

1. **Collation / case-sensitivity / sort-order**
   - Source: base catalog (column collation + database sort order); guard-clean
     base-table reads — do NOT use `sp_helpsort`.
   - Wire: `columns[].collation` (+ top-level `databaseCollation`) — EXISTS.
   - Discovery: per-attribute JSONB; fires `collation_case_sensitivity_hazard` — wired.
   - Work: sidecar catalog query only.

2. **Computed columns**
   - Source: `syscolumns` computed status + `syscomments` for the expression text
     (base-table read inside `/introspect`); materialized vs virtual flag.
   - Wire: `columns[].isComputed` / `computedExpression` — EXISTS.
   - Discovery: folds to `is_generated` / `generation_expression` — wired.
   - Work: sidecar catalog query only.

3. **Sequence / identity current value**
   - Source: ASE16 native `SEQUENCE` via catalog (version-branched); IDENTITY
     columns via `syscolumns` identity status; current value via cheap path then
     `MAX(col)` fallback (decision 7).
   - Wire: `sequences[].currentValue` — EXISTS; identity rows synthesized into
     the same `sequences[]` shape (decision 7).
   - Discovery: fires `sequence_cutover_hazard` (was value-unavailable) — wired.
   - Work: sidecar catalog query + identity synthesis + `MAX(col)` data-read fallback.

4. **FK referential actions**
   - Source: `sysreferences` / `sysconstraints` for `on_delete` / `on_update`
     (NB classic ASE FKs are often RESTRICT/NO ACTION; cascade is ASE15.7+ →
     version-tolerant).
   - Wire: `keys[].updateRule` / `deleteRule` — EXISTS.
   - Discovery: folds to `fk_columns.on_delete` / `on_update` — wired.
   - Work: sidecar catalog query only.

5. **Index ordering / clustering / partial-predicate** — the big new one
   - Source: `sysindexes` (clustered vs nonclustered via index status bits), key
     column order + ASC/DESC, key columns (`syscolumns` / `syspartitionkeys`).
     ASE has NO filtered/partial indexes → predicate is `not_applicable_for_engine`.
   - Wire: NEW optional fields on `keys[]` to match the discovery IR
     `KeyOrIndexMetadata`: `indexDefinition` / `indexMethod` / `isClustered` /
     `indexPredicate` / `columnDirections`.
   - Discovery: IR slot + JSONB reshaper EXIST; ADD mapper lines in
     `sybaseIntrospection.ts` (currently a bare TODO). Reference for the
     parse/clustered-decode: `postgres/postgresIntrospection.ts`.
   - Work: NEW sidecar wire shape + NEW catalog query + NEW TS mapper lines.

6. **DB-resident jobs**
   - Source: Sybase Job Scheduler — allowlisted read-only job procs
     (decision 8) and/or `sybmgmtdb..js*` base tables.
   - Wire: `scheduledJobs[]` — EXISTS.
   - Discovery: fires `db_resident_scheduled_job` — wired.
   - Work: sidecar query via allowlisted procs/base tables + `SidecarSqlGuard`
     narrow allowlist.

## Contract changes (`IntrospectionResponse`, additive only)

- Add `keys[]` index fields: `indexDefinition`, `indexMethod`, `isClustered`,
  `indexPredicate`, `columnDirections` (group 5).
- Add `capabilities: string[]` (decision 3).
- Add the ASE `@@version` / engine-version string on the response (decision 4).
- All additions optional; older discovery ignores unknown fields, newer
  discovery tolerates their absence (the TS mapper is already per-field
  null-tolerant).

## Three-state applicability model (decision 2)

Per group/field, discovery resolves one of:
- **present** — value captured.
- **not_applicable_for_engine** — Sybase ASE structurally lacks the construct
  (partial-index predicate; native sequences pre-ASE16). Deliberate N/A; NO
  `TODO(oracle-W3)` evidence-gap Finding (optionally a benign N/A note).
- **unavailable** — engine supports it and/or the sidecar advertises the
  capability, but the value couldn't be read → the existing `TODO(oracle-W3)`
  evidence-gap Finding.

Resolution inputs: the `capabilities[]` array (was the group surfaced by this
sidecar build?), whether ASE structurally supports the construct (engine
knowledge encoded discovery-side), and whether the value is present. A capability
NOT advertised by an older sidecar resolves to `unavailable` (distinct from a
structural N/A).

## SidecarSqlGuard policy (decision 8)

- `/introspect` catalog reads are hardcoded `PreparedStatement`s that already
  bypass the guard — base-table catalog reads need no guard change.
- NEW: a narrow, documented allowlist of read-only Job Scheduler procs, usable
  ONLY by the introspection job path. `/query` continues to blanket-block all
  `sp_*` / `xp_*`. The spec documents the exact allowlisted procs.

## Testing requirements (decision 5)

- Extend always-on `discovery-service/src/__tests__/sybaseDiscoveryPack.test.ts`
  (fetch-mocked) to populate every new optional field and assert: TS mapping into
  JSONB, the Findings fire, and the three-state logic (present /
  not_applicable_for_engine / unavailable, incl. the older-sidecar
  missing-capability case).
- Refactor the sidecar per-row catalog→object mapping into pure, unit-testable
  methods and add `SybaseQueryServiceTest` (or a new mapper test) coverage for
  each group's row mapping + the identity-synthesis + the version-branch null-out
  behavior, WITHOUT a live DB.
- Add/extend `SidecarSqlGuardTest` for the new job-proc allowlist (allowlisted
  procs pass on the introspection path; `/query` still blocks them).
- The opt-in `SYBASE_INTEGRATION` live-Docker discovery test remains the
  end-to-end check (CI-optional).

## Affected files

**Sidecar (`sybase-discovery-sidecar/src/main/java/com/example/sybasesidecar/`):**
- `model/IntrospectionResponse.java` — additive fields (index group, capabilities,
  engine version).
- `service/SybaseQueryService.java` — new per-group catalog queries; identity
  synthesis + `MAX(col)` fallback; job reads; extract per-row mappers as pure
  methods.
- `service/SidecarSqlGuard.java` — narrow read-only job-proc allowlist.
- tests: `service/SybaseQueryServiceTest.java`, `service/SidecarSqlGuardTest.java`.

**Discovery (`discovery-service/src/services/databasePacks/`):**
- `sybase/sybaseIntrospection.ts` — index-group mapper lines; three-state
  resolution; consume `capabilities[]`.
- `sybase/sybaseSidecarClient.ts` / the `SidecarIntrospectionResponse` type — add
  index fields + `capabilities` + engine version.
- `candidateStructuralFidelity.ts` — verify index reshaper covers the new fields
  (reshapers already exist for the other five groups).
- `findings/databasePackFindingScanners/databasePackFindingBuilders.ts` +
  `sybase/sybaseFindings.ts` — three-state Findings (N/A vs unavailable).
- `types.ts` — any applicability marker plumbing.
- tests: `__tests__/sybaseDiscoveryPack.test.ts`.
- Reference (read-only): `postgres/postgresIntrospection.ts`.

## Conventions & constraints

- The sidecar is its OWN Spring Boot module/DTOs — AMS snake_case/`@CamelCaseWire`
  conventions do NOT apply to it.
- Discovery changes additive + version-tolerant.
- New sidecar catalog reads either bypass the guard via `/introspect`
  `PreparedStatement`s or use the narrow documented job-proc allowlist; `/query`
  stays read-only/blanket-blocking.
- No edits to applied AMS Liquibase changesets (no AMS change at all).
- Any LLM use via the gateway relay only (none expected here).
- No new meta-model entity types — Findings + JSONB only.

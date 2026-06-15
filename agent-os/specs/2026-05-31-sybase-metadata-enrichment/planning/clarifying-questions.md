# Clarifying Questions — Sybase metadata enrichment (data-layer fidelity parity)

Raw questions produced during shaping. Grounded in a full read of the sidecar
module (`SidecarController`, `SybaseQueryService`, `SidecarSqlGuard`,
`IntrospectionRequest/Response`, `JtdsDriverStrategy`, all three sidecar test
classes) and the discovery side (`types.ts`, `sybaseSidecarClient.ts`,
`sybaseIntrospection.ts`, `SybaseDiscoveryPack.ts`, `candidateStructuralFidelity.ts`,
`databasePackFindingBuilders.ts`, `sybaseFindings.ts`, the discovery tests, and the
Postgres pack as the fully-populated reference).

## Key grounding facts discovered (so the questions are concrete)

- **The discovery side is almost fully prepared.** Five of the six target groups
  already have NAMED optional fields on `SidecarIntrospectionResponse` that the TS
  mapper (`sybaseIntrospection.ts`) already reads defensively, the IR slots
  (`types.ts`) already exist, the structural-fidelity reshapers
  (`candidateStructuralFidelity.ts`) already fold them into `constraints_metadata`
  / `fk_columns` / per-attribute JSONB, and the Finding builders + `sybaseFindings.ts`
  already FIRE the relevant findings when a value is present:
    - collation -> `columns[].collation` (+ `databaseCollation`); fires `collation_case_sensitivity_hazard`.
    - computed columns -> `columns[].isComputed` / `computedExpression`; folds to `is_generated` / `generation_expression`.
    - sequence/identity current value -> `sequences[].currentValue`; fires `sequence_cutover_hazard` (marked value-unavailable today).
    - FK actions -> `keys[].updateRule` / `deleteRule`; folds to `fk_columns.on_delete` / `on_update`.
    - DB-resident jobs -> `scheduledJobs[]`; fires `db_resident_scheduled_job`.
- **The ONE group with NO sidecar-side wire field yet is index ordering/clustering/partial-predicate.**
  The discovery IR (`KeyOrIndexMetadata.indexDefinition`/`indexMethod`/`isClustered`/`indexPredicate`/`columnDirections`)
  and the JSONB reshaper exist, but `SidecarIntrospectionResponse.keys[]` declares NO
  corresponding optional fields, and `sybaseIntrospection.ts` has a bare TODO with nothing to read.
  So this group needs BOTH a new sidecar wire shape AND new TS mapper lines.
- **The sidecar `/introspect` queries are hardcoded `PreparedStatement`s that bypass `SidecarSqlGuard`.**
  New catalog reads added inside `introspect` do NOT have to pass the guard.
- **BUT `SidecarSqlGuard` blocks every `sp_*` / `xp_*` token** (even `SELECT * FROM sp_help`),
  and the discovery `sybaseSidecarClient.ts` TODOs suggest some fields are reachable
  via `sp_helpsort` / `sp_help` / `sp_helptext`. Using a system proc anywhere on the
  `/query` path is therefore blocked; base-table catalog reads (`sysindexes`,
  `syscolumns`, `syscomments`, `sysreferences`, `syspartitionkeys`, `sysjars`/`js_*`)
  are the guard-clean route.
- **No fake-ResultSet harness exists on the sidecar side.** Java tests use in-memory
  `FakeStrategy` proxies whose Connection THROWS on `createStatement`; the controller
  test hits `127.0.0.1:1` for an error shape; the only real catalog coverage is the
  opt-in `SYBASE_INTEGRATION=true` discovery integration test against a live Sybase
  Docker container. New catalog SQL/mapping cannot be asserted by today's harness.
- **`IntrospectionResponse` has no version/capability marker.** Additive-only today.

## Numbered questions

1. **v1 FIELD SCOPE.** Given that five of the six groups are already fully wired on
   the discovery side (only the per-engine catalog query + the additive wire field
   are missing) and ONLY index ordering/clustering needs new plumbing on BOTH sides,
   do we do all six groups in this one spec, or split: core-first
   (collation, identity/sequence current value, FK on_delete/on_update, index
   clustering/order) now, with computed-columns + DB-resident jobs as a fast-follow?
   My lean: all six in one spec, because the marginal sidecar cost per group is one
   catalog query and the discovery side is already done — but index clustering is the
   biggest single chunk of NEW work (new wire field + new mapper + Sybase
   `sysindexes`/`syspartitionkeys` decode of clustered-vs-nonclustered + key order).

2. **"NOT-APPLICABLE" vs "UNAVAILABLE" — third state?** Sybase ASE lacks some Postgres
   constructs (filtered/partial indexes do not exist; native SEQUENCE objects are
   ASE16+ only, pre-16 it is IDENTITY columns). Today the discovery side has only
   `value present` vs `unavailable -> TODO(oracle-W3)` evidence-gap findings. Should
   we introduce a distinct THIRD state, `not-applicable-for-engine`, so a structurally
   absent feature (e.g. "Sybase has no partial-index predicate") is recorded as a
   deliberate N/A rather than a capture gap that reconciliation/book-of-work might
   misread as "discovery failed to read it"? My lean: yes, a lightweight
   `engineApplicability: 'not_applicable'` marker (or an `evidence_gap` subtype) so an
   engine difference is never confused with a read failure.

3. **CONTRACT EVOLUTION / capability marker.** The `IntrospectionResponse` is additive
   only and has no version/capability field. Do we add a capability/version marker
   (e.g. `capabilities: ["fk_actions","computed_cols","index_clustering","seq_current_value","db_jobs","collation"]`
   or a numeric `introspectionContractVersion`) so a newer discovery-service can tell
   whether an older sidecar surfaced a given group — and so an older discovery-service
   ignores unknown fields from a newer sidecar? The TS mapper is ALREADY null-tolerant
   per field, so this is mostly a belt-and-braces signal for clearer
   "unavailable vs not-asked-for" Findings (mirrors the dual-tolerance `coerce(snake,camel)`
   idiom in the repo CLAUDE.md). My lean: add a simple capabilities array; cheap and it
   sharpens the evidence-gap reasoning in Q2.

4. **Sybase EDITION/VERSION variance (ASE 15 vs 16).** The catalog differs across ASE
   versions (native SEQUENCE objects + some `sysindexes`/partition details are 16+;
   computed-column and sort-order exposure differs). The sidecar already reads
   `@@version` on test-connection. Do we (a) target a single baseline ASE version and
   degrade gracefully (emit unavailable on older), (b) detect the version and branch
   the catalog queries, or (c) write version-agnostic queries that simply return null
   columns where a catalog object is absent? My lean: (c)+(a) — version-tolerant
   queries that null-out missing pieces, with `@@version` recorded on the response for
   evidence, and branch ONLY where a query would hard-error on an older catalog.

5. **TESTING without a live Sybase.** Today there is NO fake-ResultSet harness: the
   sidecar Java tests never assert mapped catalog rows, and the only real coverage is
   the opt-in live-Docker integration test. For the new catalog queries + field
   mapping, which bar do we set: (a) discovery-side only — extend the always-on
   `fetch`-mocked `sybaseDiscoveryPack.test.ts` with the new optional fields populated
   (proves the TS mapping + findings fire, but NOT the Java SQL); (b) ALSO add a
   sidecar-side JDBC fake (e.g. an H2/recorded-ResultSet `DriverStrategy` double or a
   row-mapper extracted from the JDBC walk and unit-tested in isolation) so the new
   Java mapping is covered without a live server; (c) rely on the live `SYBASE_INTEGRATION`
   path for the Java side and treat it as manual/CI-optional? My lean: (a) is
   mandatory; for (b) I would extract the per-row mapping into pure, unit-testable
   methods and test those, rather than standing up a full fake JDBC ResultSet — but I
   want your call on whether sidecar-side automated coverage of the SQL is required.

6. **AMS — confirm zero change.** Expectation (per `candidateStructuralFidelity.ts`
   and the meta-model reference): everything lands in EXISTING free-form JSONB
   (`constraints_metadata`, `fk_columns`, per-attribute metadata) and existing Finding
   types — so NO `architecture-model-service` DTO/changeset change and NO new
   meta-model entity type. Please confirm that is the intent (i.e. this spec touches
   only `sybase-discovery-sidecar` + `discovery-service`, with AMS untouched).

7. **IDENTITY high-water vs SEQUENCE slot (keying decision).** The discovery `SequenceMetadata`
   slot is keyed by `schemaName` + `sequenceName` with `ownedByTable`/`ownedByColumn`,
   and the cutover-hazard finding is per-sequence. Sybase ASE pre-16 has NO sequence
   objects — the high-water mark lives on the IDENTITY COLUMN (readable via
   `syscolumns` identity status + the table's max-identity / `@@identity` / `sp_help`
   territory). How should an IDENTITY column's high-water value be represented so the
   existing cutover-hazard finding still fires: (a) synthesize a `SequenceMetadata`
   record per identity column (e.g. `sequenceName = "<table>.<col> (identity)"`,
   `ownedByTable`/`ownedByColumn` set) so the existing finding path is reused
   unchanged; (b) carry the current value on the column instead and add an
   identity-specific cutover finding; or (c) both, where a real ASE16 SEQUENCE uses the
   sequence path and an identity column uses the synthesized path? My lean: (a) —
   synthesize a sequence-shaped record for identity columns so the already-built
   `sequence_cutover_hazard` finding fires with no new finding type, and reserve the
   real-SEQUENCE path for ASE16. (Note: reading a table's current max identity value
   is a data read, not a catalog read — confirm whether we read it from the catalog
   high-water where ASE exposes it, vs. a `MAX(col)`/`SELECT @@identity`-style probe
   that the read-only/profiling-ladder + SQL guard would have to permit.)

8. **DB-resident jobs source + guard policy.** The Sybase Job Scheduler catalog lives
   in `sybmgmtdb..js*` / `js_*` tables and is classically read via `sp_sjobhistory` /
   the job-scheduler procs — but `SidecarSqlGuard` blocks all `sp_*`. Do we (a) restrict
   job discovery to direct base-table reads of the job-scheduler catalog (guard-clean,
   added inside `/introspect`), accepting that some detail may need a documented
   minimal guard allowlist; or (b) introduce a narrow, explicitly-allowlisted set of
   read-only system procs in `SidecarSqlGuard` (e.g. an allowlist that permits a fixed
   set like `sp_helptext`) used ONLY by the new introspection paths, with the `/query`
   endpoint still blanket-blocking? This is the one place the read-only guard policy
   may need to move; I want an explicit decision and will document exactly what the
   guard allows/blocks either way. My lean: (a) base-table reads inside `/introspect`,
   no guard change, to keep the read-only contract maximally tight.

## Existing code reuse (already identified — no need to ask)

- Sidecar: extend `IntrospectionResponse` nested records additively + add new catalog
  queries in `SybaseQueryService.introspect*`; respect `SidecarSqlGuard`.
- Discovery: the consumption path is already built — `SidecarIntrospectionResponse`
  (add index fields), `sybaseIntrospection.ts` mapper, `candidateStructuralFidelity.ts`
  reshapers, `databasePackFindingBuilders.ts` builders, `sybaseFindings.ts` emission.
- Reference implementation for the index parse + clustering decode:
  `discovery-service/src/services/databasePacks/postgres/postgresIntrospection.ts`
  (the `pg_indexes.indexdef` parser producing `columnDirections`/`method`/`predicate`/`isClustered`).

## Visual assets

None requested — this is a backend catalog-query + contract-plumbing spec with no UI surface.

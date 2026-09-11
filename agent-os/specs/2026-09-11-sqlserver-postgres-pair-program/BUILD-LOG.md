# SQL Server 16 → PostgreSQL 18 pair programme — Build Log

## STATUS: IN PROGRESS (started 2026-09-11)

Design of record: `agent-os/planning/2026-09-11-sqlserver-postgres-pair-shaping.md` (read FIRST:
doctrine, the owner rulings, hard-item designs, the user prerequisite).

| # | Spec | Size | Depends on | Branch | Status |
|---|------|------|------------|--------|--------|
| 0 | Foundations (vocabulary, pair-per-project, rules lib, guard) | M | — | `feat/mssql-pair-s0-foundations` | built 2026-09-11 |
| 1 | Sidecar multi-engine (`db-discovery-sidecar`) | L | 0 | | pending |
| 2 | Discovery `mssql` pack + scan UI | L | 1 | `worktree-agent-a21a029156a542a75` | built 2026-09-11 (__S2_SHA__) |
| 3 | Ruleset + `MssqlAdapter` + data plane | L | 1 | | pending |
| 4 | State discipline on SQL Server | M | 3 | | pending |
| 5 | Pack generation for SQL Server | L | 2 | | pending |
| 6 | Translation dialect (items 3, 7) + code tier | L | 4, 5 | | pending |
| 7 | Frontend + ops + shakedown | M | 6 | | pending |

Build order 0 → 1 → (2 ∥ 3) → (4 ∥ 5) → 6 → 7. One branch per spec, `--no-ff` merge to main +
push when green. Regression gate every spec: the Sybase ASE 15 → PG 18 corpus stays green.

Build conventions (standing): direct implementation with the agent-os trail kept; anchored edits
only; verify failing suites against a baseline before touching them; pre-existing reds listed in
the shaping doc §8 stay untouched; never write client-derived tokens; WideWorldImporters is
vendored offline fixture material only.

## User prerequisite (no SQL Server reachable from the work machine yet)

See shaping doc §7. Short form:
1. SQL Server 2022 (16.x) reachable on TCP 1433 (Developer Edition locally is fine; enable TCP/IP).
2. A login: SQL login (Mixed Mode) or Windows domain account (NTLM). Read-only login for scan +
   parity (`VIEW DEFINITION`, `SELECT`; `SQLAgentReaderRole` for job harvest); a writable login
   for behaviour capture / S0 restore (`INSERT/UPDATE/DELETE`, `ALTER` for `SET IDENTITY_INSERT`,
   `db_ddladmin` for `DBCC CHECKIDENT`).
3. TLS: self-signed certificate → tick "trust server certificate" in the connection form.
4. Firewall: TCP 1433 (or the instance port) from the sidecar host. No internet needed.
5. Target PG 18 with `citext`; `pg_cron` for re-homed jobs; PostGIS for spatial columns; `ltree`
   for hierarchyid.
6. Optional dry run estate: restore `WideWorldImporters` into the local instance.

## Per-spec notes

### S0 — Foundations (2026-09-11)
As-built: engine key `mssql` in every union (discovery `DATABASE_ENGINES` +
`DEFAULT_PORT_BY_ENGINE`, AMVS `DB_TYPES`/`isDbType`, gateway
`SUPPORTED_DB_ENGINES`, frontend `src/api/dbEngines.ts`); adapter factories
refuse `mssql` loudly until S3; `migrationPairRules.ts` registry
(`listPairRulesets`, `resolvePairRuleset`, `loadPairRulesetById`,
`pairRulesetForSource`, `procRulePrefix`, `sessionProfileRule`,
`pairRegistryStamp`) — byte-identical ×3 + `migrationPairRulesCopies.test`;
AMVS routes resolve the pair from `source_db.db_type`; proc-parity accepts
`source_engine`; gateway pack consumers resolve from the manifest
(`dbMigrationPack/pairRuleset.ts`); manifest gains `pair_id`,
`ruleset_version`, `source_engine_display`, `target_engine_display`;
`source_engine` is the engine KEY (`sybase`, was `sybase_ase`); `inputs.ts`
gate = ruleset present AND `GENERATOR_SUPPORTED_SOURCE_ENGINES`; guard regex +
`mssql|sql server`. Pre-existing reds (verified untouched): AMVS
`procCapture.test.ts` FakeClient typing + `captureSessionActions.inventoryReconciliation`
timeout under load; discovery `archModelClientCandidateDelete`/`integrationLayer`
ARCH_ID redeclare + `requestContractScanner`.

### S2 — Discovery `mssql` pack + scan UI (2026-09-11)

**As-built.** A SQL Server scan now runs the same pipeline a Sybase scan does
— introspection → profiling → collation detection → proc harvest → routine
profile → sequences → relationships → candidates → findings → S0 pin — and
cross-engine conformance holds for three engines.

*Shared client.* `databasePacks/sybase/sybaseSidecarClient.ts` was generalised
into `databasePacks/sidecarClient.ts`: the transport, the readonly-SELECT
guard, and the full WIRE-CONTRACT v2 §2 response shape now live there, with
`engine` on every request's connection block and the SQL-Server-only extras
(`authScheme`, `domain`, `encrypt`, `trustServerCertificate`, `instanceName`)
emitted only for `mssql`. Base-URL precedence is `DB_SIDECAR_URL` →
`SYBASE_SIDECAR_URL` (legacy alias) → `http://localhost:8093`, resolved lazily
per call. The old module survives as a thin facade that pins
`engine: 'sybase'` on every call, so all six enrichment suites, the proc
harvest and the profiler keep their import paths and their behaviour.

*Shared heuristics.* `deriveCandidateParentName` / `buildPkMap` /
`nameBasedInferences` moved VERBATIM out of `sybaseRelationshipInference.ts`
into `databasePacks/relationshipHeuristics.ts`; both T-SQL packs now call one
implementation. Declared-FK surfacing stays per-engine (the catalog quirks
differ).

*New pack* (`databasePacks/mssql/`): `MssqlDiscoveryPack` (engineKey `mssql`,
display "SQL Server", `db://mssql/…`, clientId prefix `mstab:`),
`mssqlIntrospection` (wire → IR plus a pack-private `MssqlEngineExtras`
carrier for the SQL-Server-only facts), `mssqlProfiler` (the Sybase probe SQL
verbatim — it is valid T-SQL on SQL Server — with `datetime2` /
`datetimeoffset` / `uniqueidentifier` added to `isOrderedType`),
`mssqlFindings`, `mssqlRelationshipInference`, `mssqlProcHarvest` (one row per
routine from `sys.sql_modules`, schema-qualified, CLR routines kept with their
assembly binding rather than dropped).

*Applicability inversion.* `index_predicate` and `native_sequence` — the two
groups the ASE mapper resolves to `not_applicable_for_engine` — are ordinary
capability-resolved groups here, so an unread filtered predicate is a real
evidence gap instead of a suppressed structural N/A.
No group ever resolves to `not_applicable_for_engine` on a supported version.

*Findings.* Every Sybase emitter is mirrored (same order, `engineKey: 'mssql'`,
`createdByStage: 'mssqlDiscoveryPack.findings.*'`, `METADATA_GROUP_GAP_DETAIL`
naming the `sys.*` / `msdb` sources). New: `temporal_table_detected`,
`memory_optimized_table`, `clr_object_detected`, `service_broker_detected`,
`filestream_column`, `fulltext_index_detected`, `xml_typed_column`,
`sql_variant_column`, `hierarchyid_column`, `spatial_column`,
`columnstore_index`, `synonym_detected`, `user_defined_table_type`,
`computed_column_not_persisted`, plus the two named-OUT reasons
`cross_database_reference` and `indexed_view` (each carries
`detailJson.untranslatableReason`). The cross-database detector is
keyword-anchored on purpose: a bare three-dot scan would flag
`Sales.Customers.CustomerID`, an ordinary in-database COLUMN reference.

*Neutral core.* `types.ts` gained `ExtendedObjectMetadata` (free `kind` +
`detail`, no engine named), `IntrospectionResult.extendedObjects?`, and
`DatabaseDiscoveryConfig.mssqlAuth` / `RedactedDatabaseDiscoveryConfig.mssqlAuth`
(copied field-by-field in `toRedactedConfig`, secrets excluded).
`DatabaseDiscoveryPack` gained the OPTIONAL `introspectExtendedObjects` and the
orchestrator carries it; Sybase and Postgres declare neither and are unaffected.

*T-SQL routine profiler* (shared by both packs, still in `sybase/`): new
constructs `try_catch`, `throw`, `xact_abort`, `trancount`, `save_tran`,
`merge`, `output_clause`, `table_variable`, `offset_fetch`, `apply`, `iif`,
`try_convert`, `string_agg`, `sp_executesql_params`, `next_value_for`,
`for_system_time`, `contains_freetext`, `xml_method`, `openquery_linked`,
`three_part_name`, `error_continuation` (+ the exported
`CROSS_DATABASE_CONSTRUCTS` set). THROW sites join `raiserror_sites` with
`severity: null` — THROW's third argument is the STATE, not a severity.
Parameters now parse `OUTPUT`/`OUT`, `READONLY` (→ optional
`RoutineParam.is_readonly`, only ever set to `true`), defaults, bracketed
names and schema-qualified table types; `findBodyAs` skips the `AS` inside
`WITH EXECUTE AS OWNER`. `error_continuation` is a HAZARD flag, deliberately
NOT a `non_compensatable_reason`.

*Registry + routes.* `databasePackFactory` registers `mssql`;
`refresh-seeds-scan` takes `dbEngine` (`sybase`|`mssql`, default `sybase`) and
rejects `postgres` with a message naming the accepted SOURCE engines;
`verification-scan` stays PostgreSQL (it reads the TARGET);
`s0AutoSnapshot` posts `db_type: 'mssql'` with no arm of its own;
`db/dbAdapterFactory` keeps its documented throw (discovery's sidecar packs
bypass `DbAdapter`).

*Frontend.* Scan entry offers "SQL Server" (port 1433 from
`DB_ENGINE_DEFAULT_PORT`, options + labels driven by `api/dbEngines.ts`), with
an MSSQL-only extras block (auth scheme sql|ntlm, Windows domain when NTLM,
named instance, encrypt ON by default, trust-server-certificate OFF by
default); `DiscoveryDatabaseConnectionConfig.mssqlAuth?` is sent only on an
`mssql` payload; `coreTechPersistenceCheck` moves SQL Server (and the `t-sql`
/ `tsql` tokens) from `OTHER_DATABASES` to `SUPPORTED_DATABASES`;
`findingTypeLabels` covers all 16 new finding types.

*Fixtures* (`discovery-service/src/__tests__/fixtures/mssql/`, offline, no
network ever): `wwi-introspect.json` + `wwi-proc-bodies.json` derived from
Microsoft's MIT-licensed WideWorldImporters SSDT DDL, plus
`hard-features-introspect.json` — clearly labelled as HAND-AUTHORED, because
WideWorldImporters contains no filtered index, trigger, indexed view,
columnstore index, CLR routine, Service Broker object, synonym,
`sql_variant` / `hierarchyid` / `xml` column or cross-database reference. The
folder README states the provenance and the split.

*Verification.* discovery `npx jest --silent` → **292 suites / 2159 tests, all
green** (`npx tsc --noEmit` clean). The reds the brief listed as pre-existing
(`archModelClient*` ARCH_ID redeclare, `requestContractScanner`,
`springClassicCodeFormatWireContract.crossProcess`) were purely a missing
`api-migration-validation-service/node_modules` in a fresh worktree; with the
sibling dependencies present the whole suite passes. frontend: 32 Discovery
suites + `coreTechPersistenceCheck` (273 tests) green; `tsc --noEmit` clean
for every touched file (whole-repo baseline stays red for unrelated reasons).

*Decisions worth carrying forward.*
1. `tsqlRoutineProfiler.ts` stays in `sybase/` and the `mssql` pack imports
   it. T-SQL is genuinely one dialect; moving the file would rewrite every
   importer for no behavioural gain, and the SQL-Server-only constructs simply
   never fire on an ASE body.
2. `computed_column_not_persisted` is a finding type the spec did not list. A
   non-persisted computed column cannot be reproduced by PostgreSQL's
   always-STORED generated columns, and without this the difference would have
   lived only in pack-private extras and reached no reviewer.
3. The `wwi-introspect.json` fixture deliberately does NOT advertise the
   `db_jobs` capability: it models a scan account with `VIEW DEFINITION` but no
   `SQLAgentReaderRole`, which is what pins the evidence-gap side of the
   three-state model. `hard-features-introspect.json` advertises it and carries
   a job, pinning the other side.
4. `MssqlDiscoveryPack.ts` was added to the `modelScopeGuard` ratchet baseline
   alongside the Postgres and Sybase packs: it CONSTRUCTS the
   `physical_data_entities` candidate-type key for the rows it emits and never
   reads the raw model collection.


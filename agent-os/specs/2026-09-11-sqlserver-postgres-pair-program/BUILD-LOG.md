# SQL Server 16 → PostgreSQL 18 pair programme — Build Log

## STATUS: IN PROGRESS (started 2026-09-11)

Design of record: `agent-os/planning/2026-09-11-sqlserver-postgres-pair-shaping.md` (read FIRST:
doctrine, the owner rulings, hard-item designs, the user prerequisite).

| # | Spec | Size | Depends on | Branch | Status |
|---|------|------|------------|--------|--------|
| 0 | Foundations (vocabulary, pair-per-project, rules lib, guard) | M | — | `feat/mssql-pair-s0-foundations` | built 2026-09-11 |
| 1 | Sidecar multi-engine (`db-discovery-sidecar`) | L | 0 | | pending |
| 2 | Discovery `mssql` pack + scan UI | L | 1 | | pending |
| 3 | Ruleset + `MssqlAdapter` + data plane | L | 1 (contract) | `feat/mssql-pair-s3-ruleset-data-plane` | built 2026-09-11 |
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

### S3 — Ruleset + MssqlAdapter + data plane (2026-09-11)
As-built: `migration-pairs/sqlserver16-postgres18.rules.json` (v2, prefix `MSPG.`,
36 rules: DT.001–005 incl. the cited datetime2(7) loss + datetimeoffset instant,
STR.001–003, COLL.001 ENABLED by ruling, NUM.001–003, BIT/INT/LOB/BIN/UUID/SEQ,
XML.001–002, VARIANT, HIER, GEO, TEMPORAL, FULLTEXT, the PROC family with
TRY/CATCH + XACT_ABORT + continuation + savepoint conventions and THROW carriage,
mssql-jdbc session profile with NAMED isolation level, table_function /
scalar_function shapes in ABI + CALLSITE; `translation_profile` block for S6;
33 construct_refs). Library (×3 copies): `granularity_us` on timestamp-truncate
(string truncation), `instant`, `uuid-canonical`, `xml-canonical`. AMVS:
`types/db.ts` `MssqlAuth` + `parseMssqlAuthWire` (snake/camel), `mssqlAuth` on
`DbConnectionConfig`; `services/db/MssqlAdapter.ts` (bracket quoting, N'…' /
0x… / 7-digit cursor literals, COUNT_BIG, `engine: 'mssql'` + auth extras on
every sidecar body, `/call` params under `sourceType`), shared
`sidecarCallEnvelope.ts`; factory arm live; `config.ts` `DB_SIDECAR_URL` (+
`SYBASE_SIDECAR_URL` alias); five DB routes accept `mssql_auth`; forward
transform: uuid lower-casing + the cited 7→6 fraction truncation on load;
unorderable types + sql_variant/geography/geometry/hierarchyid. Gateway
`migrationCodeSpecCarriage` heading is data-derived across pairs (common stem).
Tests: `MssqlAdapter.test`, `migrationPairRulesetsRepo.test` (both files valid,
strategies all known, session profile named form), `migrationPairStrategiesV3.test`
(AMVS + gateway); ruleset-consuming tests resolve by engine. NOTE: with two
rulesets present `loadPairRuleset()` is null unless pinned — every runtime
caller resolves per source engine (S0); legacy callers with no engine degrade
to no rule citations (visible in reports as empty `rules_available`).

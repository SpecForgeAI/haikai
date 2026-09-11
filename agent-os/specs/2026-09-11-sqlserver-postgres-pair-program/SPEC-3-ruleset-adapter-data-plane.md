# SPEC 3 — Ruleset `sqlserver16-postgres18` + AMVS `MssqlAdapter` + data plane

Design of record: shaping §4, §5 items 2 and 4. Size: L. Depends on: S1. Wave C (parallel with S2).

## Goal
The pair exists as data; AMVS can read SQL Server through the sidecar; bulk load, incremental sync
and data parity run end to end SQL Server → PostgreSQL with rule-cited comparison.

## Tasks
- 3.1 `migration-pairs/sqlserver16-postgres18.rules.json` (version 2, `rules_prefix: "MSPG."`,
  source `{engine: mssql, version: "16", display: "SQL Server 2022 (16.x)"}`, target PG 18,
  guidance_heading "T-SQL dialect rewrite guidance (SQL Server → PostgreSQL)"). Rules:
  `MSPG.DT.001` datetime 1/300 s (timestamp-truncate tps 300), `MSPG.DT.002` datetime2(7)/time(7)
  100 ns → µs (timestamp-truncate granularity_us 1 → implement `granularity_us` in the library
  operating on the 7-digit wire string, never via epoch ms), `MSPG.DT.003` smalldatetime minute,
  `MSPG.DT.004` datetimeoffset → timestamptz instant equality (new strategy `instant` = compare
  epoch µs incl. offset), `MSPG.DT.005` date/time granularity, `MSPG.STR.001` trailing-space
  padding compare (string-rtrim) — note SQL Server keeps '' (no single-space coercion),
  `MSPG.STR.002` nvarchar UTF-16 → UTF-8 NFC (charset-normalize), `MSPG.STR.003` varchar code-page
  collation → UTF-8 (charset-normalize + note), `MSPG.COLL.001` case-insensitive default
  (collation-case, **enabled_by_default: true**, applies when column collation contains `_CI_`),
  `MSPG.NUM.001` money 4-scale, `MSPG.NUM.002` float/real epsilon, `MSPG.NUM.003` numeric
  canonical, `MSPG.BIT.001`, `MSPG.INT.001` tinyint, `MSPG.BIN.001` bytes-hex (binary/varbinary/
  image/rowversion), `MSPG.LOB.001` text/ntext/varchar(max)/nvarchar(max), `MSPG.UUID.001`
  uniqueidentifier → uuid lowercase canonical (new strategy `uuid-canonical`), `MSPG.SEQ.001`
  identity (SCOPE_IDENTITY note; cache gaps), `MSPG.XML.001` xml → xml canonical whitespace
  (strategy `xml-canonical`: collapse inter-element whitespace), `MSPG.VARIANT.001` sql_variant
  (guidance), `MSPG.HIER.001` hierarchyid → ltree (string form), `MSPG.GEO.001` spatial WKT
  compare, PROC family: `MSPG.PROC.ABI.001` (same convention block), `MSPG.PROC.ERR.001`
  (RAISERROR + THROW; `source_error` DETAIL; THROW numbers ≥ 50000), `MSPG.PROC.MSG.001`,
  `MSPG.PROC.RS.ORDER.001`, `MSPG.PROC.RS.COLNAME.001`, `MSPG.PROC.RS.TYPE.001` (type_map with
  nvarchar/datetime2/datetimeoffset/uniqueidentifier/rowversion/xml/sql_variant/bit/money…),
  `MSPG.PROC.TXN.001` (XACT_ABORT ON/OFF, nested BEGIN TRAN + @@TRANCOUNT, SAVE TRAN, statement-
  level continuation convention), `MSPG.PROC.VOL.001/.002`, `MSPG.PROC.SESSION.001`
  (`driver: mssql-jdbc`, set: `ansi_nulls on`, `ansi_padding on`, `ansi_warnings on`,
  `arithabort on`, `quoted_identifier on`, `concat_null_yields_null on`, `nocount off`,
  `xact_abort off`, `dateformat mdy`, `transaction isolation level read committed`),
  `MSPG.PROC.CALLSITE.001` (matrix prose for `SQLServerException.getErrorCode()`), and
  `construct_refs` for the S2 constructs (try_catch, throw, xact_abort, merge, output_clause,
  offset_fetch, apply, iif, try_convert, string_agg, sp_executesql_params, next_value_for,
  table_variable, tvp_param, for_system_time, contains_freetext, xml_method, getdate, isnull,
  convert, @@identity, @@rowcount, @@error, TOP, NOLOCK, HOLDLOCK, temp_table, RAISERROR).
- 3.2 Library additions (`migrationPairRules.ts`, all 3 copies): strategies `granularity_us`
  param on timestamp-truncate (string-based), `instant`, `uuid-canonical`, `xml-canonical`;
  `KNOWN_STRATEGIES` updated; tests.
- 3.3 `services/db/MssqlAdapter.ts`: fork of `SybaseAdapter` with bracket quoting (`[name]`,
  `]` doubled), `engine: 'mssql'` on every sidecar body, MSSQL creds extras (authScheme, domain,
  encrypt, trustServerCertificate, instanceName) from `DbConnectionConfig` (add optional
  `mssqlAuth` to `types/db.ts`), literal renderer `mssqlLiteral` (N'…' for nvarchar-typed
  columns, `0x…` binary literals, 7-digit datetime2 literal `'yyyy-MM-dd HH:mm:ss.fffffff'`,
  datetimeoffset ISO literal, uniqueidentifier quoted), `NUMERIC_TYPE_BASES` for MSSQL, keyset
  + probes + count identical. `dbAdapterFactory.ts` arm. `MAX_SINGLE_FETCH_ROWS` unchanged.
- 3.4 Data plane: `runDataMigrationCli.ts` source `dbType` from `SOURCE_DB_TYPE` env (default
  sybase), port default per engine; `buildLoadPlan.ts` `UNORDERABLE_TYPE_FRAGMENTS` add `xml`,
  `sql_variant`, `geography`, `geometry`, `hierarchyid`(orderable as string? NO → unorderable);
  `pairRuleForwardTransform.ts`: bit→bool keyed on `divergence_class` + type `bit` (works for both),
  uuid lowercase on load for `uniqueidentifier`, datetime2 fraction trimmed to 6 digits at load
  (cited `MSPG.DT.002`), datetimeoffset passed as ISO string (PG timestamptz parses it);
  `dataParityComparator.ts` `UNORDERABLE_TYPE_FRAGMENTS` extended; comparator uses `orderByTypes`
  for MSSQL cursors (already generic). Incremental sync unchanged (delta key logic generic).
- 3.5 Routes: `dataParityRun`, `dataMigrationRun` (+incremental), pass `mssqlAuth` through
  `toConfig`; `pairRulesetForSource(source.db_type)` (S0) already selects the pair.
- 3.6 Tests: `MssqlAdapter.test.ts` (twin of the Sybase adapter test: bracket quoting, N-literals,
  7-digit cursor, uuid), `migrationPairRules` new strategies, `dataMigrationForwardTransform` mssql
  cases, a `dataParityComparator` mssql fixture run (collation-case applied only on `_CI_` columns),
  ruleset validation test loads BOTH files and asserts unique rule ids per file + prefix match.

## Verification
AMVS `npx jest --silent` + `tsc --noEmit`; gateway + discovery jest (library copies) green;
`migrationPairRulesCopies` identical.

## Done when
A SQL Server source loads into PG 18 through the runner with cited rules, parity reports read
`migration_pair: sqlserver16-postgres18`, and every new strategy is pinned.

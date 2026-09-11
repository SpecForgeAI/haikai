# SPEC 1 — Sidecar multi-engine (`db-discovery-sidecar`)

Design of record: shaping §3 rulings 2, 4; §5 item 4. Size: L. Depends on: S0. Wave B.

## Goal
One Java sidecar serves Sybase ASE AND SQL Server. Every request names its engine; the catalog,
guard and binder layers dispatch per engine; the wire contract preserves sub-millisecond precision.
Sybase behaviour is byte-for-byte unchanged (its 90 tests stay green, plus new twins).

## Tasks

### 1.1 Rename + config (ruling 2)
- `git mv sybase-discovery-sidecar db-discovery-sidecar`; Java package `com.example.sybasesidecar` →
  `com.example.dbsidecar` (class names keep `Sybase*` where the class IS Sybase-specific; new
  `Mssql*` siblings; neutral classes renamed `Sidecar*`/`Db*`). `pom.xml` artifactId
  `db-discovery-sidecar`; add `com.microsoft.sqlserver:mssql-jdbc:12.8.1.jre11` (regular dep);
  keep the jconnect profile as is. Dockerfile / README / `docker-compose.yml:184-197` service key
  `db-discovery-sidecar`, container `arch-db-sidecar`, port 8093 unchanged. `install-run-all.ps1:50`,
  `stop-all.ps1:53`, root `README.md:22`.
- Consumers: AMVS `config.ts:73` `DB_SIDECAR_URL = env.DB_SIDECAR_URL ?? env.SYBASE_SIDECAR_URL ??
  'http://localhost:8093'` (export both names; `SYBASE_SIDECAR_URL` const kept as alias);
  discovery `sybaseSidecarClient.ts:37-40` same precedence (lazy per call). compose env lines
  `:144,:174` → `DB_SIDECAR_URL`. `application.yml`: delete the two DEAD `sybase.*` keys; bind
  real defaults via `@ConfigurationProperties(prefix="sidecar")` (`default-query-timeout-seconds`,
  `default-max-rows`) used by the controller.
- UTC pin for bare runs: `SidecarApplication.main` sets `TimeZone.setDefault(UTC)` +
  `System.setProperty("user.timezone","UTC")` if unset (Dockerfile flag stays).

### 1.2 `engine` on every request
- `TestConnectionRequest`, `IntrospectionRequest`, `QueryRequest`, `MutationRequest`, `CallRequest`
  gain `engine` (`SidecarEngine` enum: `SYBASE`, `MSSQL`; Jackson case-insensitive; **missing →
  SYBASE** for back-compat, logged once). Connection options gain `authScheme` (`sql` | `ntlm`),
  `domain`, `encrypt` (default true), `trustServerCertificate` (default false), `instanceName`
  (nullable). `driver` stays Sybase-only (ignored for MSSQL).
- `DriverStrategy` gains engine-aware URL building: `JtdsDriverStrategy.buildJdbcUrl(engine, …)` →
  `jdbc:jtds:sybase://` or `jdbc:jtds:sqlserver://host:port/db[;instance=…][;domain=…]`;
  new `MssqlJdbcDriverStrategy` (`jdbc:sqlserver://host[\\instance]:port;databaseName=…;
  encrypt=…;trustServerCertificate=…;authenticationScheme=NTLM;domain=…` when ntlm). MSSQL AUTO =
  mssql-jdbc first, jTDS fallback. One `ConnectionFactory` replaces the three duplicated AUTO loops
  (`SybaseQueryService:201-238`, `SybaseMutationService:149-182`, `SybaseCallService:1032-1067`).
- `/test-connection` response gains `engine`, `driverUsed`, `serverVersion` (MSSQL:
  `SERVERPROPERTY('ProductVersion')` + edition).

### 1.3 Catalog layer per engine
- Extract an `EngineCatalog` interface from `SybaseQueryService` (schemas, tables, columns, keys,
  fks, indexColumns, identity/sequences, jobs, collation, views, procedures, triggers, capabilities).
  `SybaseCatalog` = today's SQL verbatim. New `MssqlCatalog`:
  - schemas `sys.schemas` (exclude `sys`, `INFORMATION_SCHEMA`, `guest`, `db_*` roles);
    tables `sys.tables` (+ `temporal_type`, `is_memory_optimized`, `is_filetable`, `history_table_id`);
    columns `sys.columns`+`sys.types` (user types resolved to system base + `user_type_name`),
    `max_length` (÷2 for n-types; -1 = MAX), `precision`, `scale`, `is_nullable`, `is_identity`,
    `is_computed` + `sys.computed_columns.definition` + `is_persisted`, `collation_name`,
    `sys.default_constraints.definition` + name, `is_rowguidcol`, `is_sparse`, `generated_always_type`,
    `is_hidden`, `is_filestream`, `is_xml_document` + xml schema collection name;
  - keys/indexes `sys.indexes` + `sys.index_columns` (`is_descending_key`, `is_included_column`,
    `key_ordinal`), `type_desc` (CLUSTERED/NONCLUSTERED/CLUSTERED COLUMNSTORE/NONCLUSTERED
    COLUMNSTORE/XML/SPATIAL/HEAP), `is_unique`, `is_primary_key`, `is_unique_constraint`,
    `filter_definition`, `has_filter`; full-text `sys.fulltext_indexes` + columns;
  - FKs `sys.foreign_keys` + `sys.foreign_key_columns` (columns POPULATED both sides),
    `delete_referential_action_desc`, `update_referential_action_desc`, `is_disabled`,
    `is_not_trusted`; check constraints `sys.check_constraints` (definition, `is_disabled`);
  - identity `sys.identity_columns` (`seed_value`, `increment_value`, `last_value` — no MAX scan
    needed); sequences `sys.sequences` (start/increment/min/max/cycle/cache/current_value/type);
  - views `sys.views` + `sys.sql_modules.definition` (+ `is_schema_bound` from `sys.sql_modules`,
    indexed = any row in `sys.indexes` for the view → flagged `indexed_view` (OUT by ruling 6, carried
    for the named reason)); procedures `sys.procedures` + functions `sys.objects` type IN
    ('FN','IF','TF','AF') + `sys.sql_modules.definition` (single value; no reassembly) +
    `sys.parameters` (name, type, max_length, precision, scale, `is_output`, `has_default_value`,
    `is_readonly` (TVP)) + `execute_as_principal_id`, CLR objects (`type IN ('PC','FS','FT')`) →
    `language: "CLR"` + assembly name; triggers `sys.triggers` (`is_instead_of_trigger`,
    `is_disabled`, parent view/table) + `sys.trigger_events` (real events) + ordering
    (`OBJECTPROPERTYEX(id,'ExecIsFirstInsertTrigger'…)`) + definition; DML triggers on views
    included; database triggers listed separately;
  - jobs `msdb.dbo.sysjobs` + `sysjobsteps` (command, subsystem) + `sysjobschedules` + `sysschedules`
    (freq decoded to a cron-like text) — read fail-soft (permission) → capability not advertised;
  - collation `DATABASEPROPERTYEX(db,'Collation')` + `SERVERPROPERTY('Collation')`; per-column
    collation rides the column row; version `SERVERPROPERTY('ProductMajorVersion')`,
    `ProductVersion`, `Edition`; temporal/system-versioned tables → `sys.periods` +
    `history_table_id`; Service Broker objects (`sys.service_queues`, `sys.services`), FILESTREAM
    columns, user-defined table types (`sys.table_types`), synonyms (`sys.synonyms`), CDC/CT enabled
    flags → new `IntrospectionResponse` sections (`extendedObjects[]`, kind-tagged) so packs can
    raise decisions.
  - capabilities advertised for MSSQL: `collation`, `computed_columns`, `sequence_current_value`,
    `fk_actions`, `index_clustering`, `db_jobs` (when msdb readable), + new `filtered_indexes`,
    `included_columns`, `trigger_events`, `extended_objects`, `column_defaults`, `check_constraints`.
- `IntrospectionResponse` rows gain the new nullable fields; Sybase rows leave them null.

### 1.4 Wire precision (item 4)
- `normalizeWireValue`: `Timestamp` → `yyyy-MM-dd HH:mm:ss` + fraction rendered from `getNanos()`
  trimmed of trailing zeros, minimum 3 digits (Sybase values keep rendering `.SSS` exactly as today —
  pin with the existing tests); `Time` → `HH:mm:ss[.fraction]`; `microsoft.sql.DateTimeOffset` →
  ISO `yyyy-MM-ddTHH:mm:ss.fffffff+HH:MM`; `java.sql.Blob` → hex; `UUID`/`uniqueidentifier` →
  lowercase canonical string; `sql_variant` → the driver's Java value through the same switch;
  `byte[]` unchanged (`\x` hex). Inverse parsers accept 7-digit fractions (already lenient; add
  pins).

### 1.5 Guards + binder per engine
- `SidecarSqlGuard` unchanged (shared T-SQL) + add `EXECUTE`, `OPENROWSET`, `OPENQUERY`, `BULK`
  to the forbidden list for BOTH engines.
- `MutationSqlGuard`: reseed form per engine — Sybase `EXEC sp_chgattribute … identity_burn_max`;
  MSSQL `DBCC CHECKIDENT ('<t>', RESEED, <n>)` (quoted or bracket name, `WITH NO_INFOMSGS`
  optional). Everything else shared.
- `CallSqlGuard`: SET allowlist per engine — MSSQL: `set (ansi_nulls|ansi_padding|ansi_warnings|
  arithabort|quoted_identifier|nocount|xact_abort|concat_null_yields_null|implicit_transactions|
  numeric_roundabort|ansi_null_dflt_on) (on|off)`, `set rowcount \d+`, `set textsize \d+`,
  `set dateformat (mdy|dmy|ymd|ydm|myd|dym)`, `set datefirst [1-7]`, `set language \w+`,
  `set transaction isolation level (read uncommitted|read committed|repeatable read|snapshot|
  serializable)`, `set lock_timeout -?\d+`; param cap 2100 for MSSQL.
- `SybaseCallService` → `RoutineCallService` with an engine-keyed type table: MSSQL families
  (`nvarchar/nchar/ntext`→NVARCHAR, `datetime2`→TIMESTAMP, `datetimeoffset`→
  `microsoft.sql.Types.DATETIMEOFFSET`, `date`, `time`→TIME, `uniqueidentifier`→CHAR(36),
  `rowversion/timestamp`→BINARY, `xml`→SQLXML/LONGNVARCHAR, `sql_variant`→OTHER, `varbinary(max)`,
  `bit`, `money`, `hierarchyid`/`geography`/`geometry`→ string (`ToString()`/WKT via VARCHAR),
  table-valued param → refused with `tvp_unsupported_in_call` (named)). Severity/state: MSSQL via
  `SQLServerException.getSQLServerError()`; Sybase reflective path unchanged. `THROW` errors
  (number ≥ 50000, severity 16) classified `raiserror` (kind stays the wire vocabulary).
  Message drain unchanged (`getWarnings`).

### 1.6 Tests
- Existing 5 classes green after the package move. New: `MssqlCatalogTest` (row mappers +
  bitless decoders + capability set), `RoutineCallServiceMssqlTest` (type table twins),
  `MutationSqlGuardTest` DBCC forms, `CallSqlGuardTest` MSSQL SET forms + 2100 cap,
  `WirePrecisionTest` (7-digit fraction, DateTimeOffset, UUID, Blob), `ConnectionFactoryTest`
  (URL forms incl. instance/NTLM/encrypt), `SidecarControllerTest` engine default + 400 on
  unknown engine.

## Verification
`cd db-discovery-sidecar && mvn -q test` (all green). Node consumers: AMVS + discovery jest
green after the env alias change. `docker compose config` parses.

## Done when
Sidecar answers both engines behind one URL; all catalog reads for MSSQL implemented with the
field list above; Sybase tests untouched and green; BUILD-LOG row + the prerequisite text (§7 of
the shaping doc) copied into the sidecar README.

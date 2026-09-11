# Sidecar wire contract v2 (engine-aware) — binding for S1 (Java), S2 (discovery pack), S3/S4 (AMVS)

All endpoints stay `POST` JSON on the same port (8093). Request/response property names are
**camelCase** exactly as today (the sidecar is NOT on the AMS snake_case wire), except `/call`'s
response which is snake_case today and stays so. Every new field is **nullable and optional**;
Sybase responses leave the new fields `null` / `[]` so existing consumers are unaffected.

## 1. Connection block (every request)

| field | type | engines | notes |
|---|---|---|---|
| `engine` | `"sybase" \| "mssql"` | both | **missing → `sybase`** (back-compat, logged once per process) |
| `host`, `port`, `database`, `username`, `password` | as today | both | |
| `charset` | string? | sybase | as today |
| `driver` | `auto\|jtds\|jconnect` | sybase | as today; ignored for mssql |
| `authScheme` | `"sql" \| "ntlm"` | mssql | default `sql` |
| `domain` | string? | mssql | required when `authScheme=ntlm` |
| `encrypt` | boolean | mssql | default `true` |
| `trustServerCertificate` | boolean | mssql | default `false` |
| `instanceName` | string? | mssql | named instance; port still honoured when given |

JDBC URL forms: mssql-jdbc `jdbc:sqlserver://host[\instance]:port;databaseName=db;encrypt=…;
trustServerCertificate=…[;authenticationScheme=NTLM;domain=…]`; jTDS fallback
`jdbc:jtds:sqlserver://host:port/db[;instance=…][;domain=…]`. MSSQL AUTO = mssql-jdbc then jTDS.

`/test-connection` response gains `engine`, `serverEdition` (mssql `SERVERPROPERTY('Edition')`),
keeps `ok, error, serverVersion, driverUsed`.

## 2. `/introspect` response — new nullable fields

Top level: `engine`, `serverVersion`, `serverEdition`, `databaseCollation`, `serverCollation`,
`capabilities[]` (existing six + `filtered_indexes`, `included_columns`, `trigger_events`,
`extended_objects`, `column_defaults`, `check_constraints`, `identity_seed`, `column_precision`,
`routine_parameters`), and a new array `extendedObjects[]`.

`ColumnRow` (+): `precision`, `scale`, `identitySeed`, `identityIncrement` (strings),
`defaultExpression`, `defaultConstraintName`, `isPersistedComputed`, `isRowGuidCol`, `isSparse`,
`userTypeName` (alias type name when the column uses one; `dataType` is then the base type),
`generatedAlwaysType` (`"as_row_start" | "as_row_end" | null`), `isHidden`, `isFilestream`,
`xmlSchemaCollection`.

`TableRow` (+): `temporalType` (`"system_versioned" | "history" | null`), `historyTable`
(`"schema.name"` | null), `periodStartColumn`, `periodEndColumn`, `isMemoryOptimized`,
`isFiletable`.

`KeyRow` (+): `filterDefinition`, `includeColumns[]`, `indexType`
(`clustered | nonclustered | clustered_columnstore | nonclustered_columnstore | xml | spatial |
fulltext | heap | null`), `isDisabled`, `isNotTrusted`, `isUniqueConstraint`,
`checkDefinition` (rows with `kind = "check_constraint"` — NEW kind), `fulltextCatalog`.
FK rows on MSSQL carry `columns[]` and `referencedColumns[]` POPULATED.

`ViewRow` (+): `isSchemaBound`, `isIndexedView`.

`ProcedureRow`: `routineKind` ∈ `procedure | function | clr_procedure | clr_function`;
(+) `functionKind` (`scalar | inline_table | multi_statement_table | aggregate | null`),
`parameters[]` = `{ name, dataType, maxLength, precision, scale, isOutput, hasDefault,
isReadonly, ordinal, userTypeName }`, `returnsType`, `executeAs`, `assemblyName`, `language`
(`"TSQL" | "CLR"`). Body is the full `sys.sql_modules.definition` (no 4096 cap on MSSQL —
`truncated` flag stays for the Sybase path).

`TriggerRow`: `timing` REAL on MSSQL (`after | instead_of`), `events[]` from
`sys.trigger_events`; (+) `isDisabled`, `parentKind` (`table | view`), `orderFirstEvents[]`,
`orderLastEvents[]`, `isDatabaseTrigger`.

`ScheduledJobRow`: `scheduler = "sql_server_agent"`; (+) `steps[]` = `{ ordinal, subsystem,
command, databaseName }`, `scheduleText` (human), `scheduleFrequency` (raw msdb freq fields as a
map).

`SequenceRow` (MSSQL native): full `startValue`, `increment`, `minValue`, `maxValue`,
`isCycling`, `cacheSize`, `currentValue`, `dataType`.

`extendedObjects[]` = `{ kind, schema, name, definition, detail }` with `kind` ∈
`service_broker_queue | service_broker_service | service_broker_contract |
user_defined_table_type | synonym | fulltext_catalog | assembly | xml_schema_collection |
partition_scheme | partition_function | cdc_capture_instance | change_tracking |
filestream_filegroup | database_trigger | rowlevel_security_policy | external_table |
temporal_history_link` (`detail` is a free map, e.g. table type columns, synonym base object,
assembly permission set).

## 3. `/query` — unchanged shape + `engine`. Wire value contract (both engines)

| Java value | wire |
|---|---|
| `java.sql.Timestamp` | `yyyy-MM-dd HH:mm:ss.fff…` — fraction from `getNanos()`, trailing zeros trimmed, **minimum 3 digits** (Sybase values render exactly as today) |
| `java.sql.Time` | `HH:mm:ss[.fff…]` (fraction only when non-zero) |
| `microsoft.sql.DateTimeOffset` | ISO `yyyy-MM-ddTHH:mm:ss.fffffff+HH:MM` |
| `java.util.UUID` / uniqueidentifier | lowercase canonical string |
| `byte[]`, `Blob` | `\x` + lowercase hex |
| `BigDecimal` / `Long` / `BigInteger` | plain string (as today) |
| `Clob` / `SQLXML` | string content |
| `sql_variant` | the driver's Java value through the same switch |
| `hierarchyid`, `geography`, `geometry` | the driver's string form (`ToString()` / WKT via `CONVERT(varchar(max), …)` in the query) |

## 4. `/mutate` — unchanged + `engine`

Guard grammar per engine: shared DML + `SET IDENTITY_INSERT`; reseed form
Sybase `EXEC sp_chgattribute '<t>', 'identity_burn_max', 0, '<n>'`; MSSQL
`DBCC CHECKIDENT ('<t>', RESEED, <n>)` (optionally `WITH NO_INFOMSGS`; `<t>` quoted `'…'` or
bracketed). Restore mode additionally admits `TRUNCATE TABLE <t>` (both) and, MSSQL only,
bare `DELETE FROM <t>` (no WHERE) for FK-referenced parents.

## 5. `/call` — `engine` + `CallParam.sourceType`

`CallParam` gains `sourceType` (verbatim catalog type token); `sybaseType` is accepted as an
alias for one release and mapped onto it. Param cap: Sybase 255, MSSQL 2100. Session SET
allowlist per engine (S1 spec §1.5). Response unchanged; `messages[].kind` keeps
`print | raiserror | info` (THROW → `raiserror`). Severity/state from `SQLServerError` on MSSQL.

## 6. Consumer env

`DB_SIDECAR_URL` (new) → `SYBASE_SIDECAR_URL` (alias) → `http://localhost:8093`.

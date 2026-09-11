# SQL Server 16 → PostgreSQL 18 pair programme — Build Log

## STATUS: IN PROGRESS (started 2026-09-11)

Design of record: `agent-os/planning/2026-09-11-sqlserver-postgres-pair-shaping.md` (read FIRST:
doctrine, the owner rulings, hard-item designs, the user prerequisite).

| # | Spec | Size | Depends on | Branch | Status |
|---|------|------|------------|--------|--------|
| 0 | Foundations (vocabulary, pair-per-project, rules lib, guard) | M | — | `feat/mssql-pair-s0-foundations` | built 2026-09-11 |
| 1 | Sidecar multi-engine (`db-discovery-sidecar`) | L | 0 | `feat/mssql-pair-s1-sidecar` | built 2026-09-11 (5e8b9c25) |
| 2 | Discovery `mssql` pack + scan UI | L | 1 | | pending |
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

### S1 — Sidecar multi-engine (2026-09-11)

As-built. Branch `feat/mssql-pair-s1-sidecar`, commit `5e8b9c25`. `mvn test`: **225 tests, 0
failures, 0 errors** (126 pre-existing + 99 new); `mvn -DskipTests package`
produces `target/db-discovery-sidecar-1.0.0-SNAPSHOT.jar`.

**Rename.** `sybase-discovery-sidecar` → `db-discovery-sidecar` (`git mv`,
rename detection intact); Java package `com.example.sybasesidecar` →
`com.example.dbsidecar`. Class names follow the rule "Sybase-specific keeps
`Sybase*`": `SybaseDriverChoice`, `SybaseCatalog`, `JConnectDriverStrategy`
unchanged; the neutral services became `DbQueryService`, `DbMutationService`,
`RoutineCallService`; new siblings `MssqlCatalog`, `MssqlJdbcDriverStrategy`.
pom `artifactId` = `db-discovery-sidecar`, `com.microsoft.sqlserver:mssql-jdbc:12.8.1.jre11`
added as a regular dependency (MIT, Maven Central — no jConnect-style
proprietary-jar problem), jconnect profile untouched. Dockerfile, sidecar
README, root `README.md` service row, `install-run-all.ps1:50`,
`stop-all.ps1` port comment, and `docker-compose.yml` (service key
`db-discovery-sidecar`, container `arch-db-sidecar`, `DB_SIDECAR_URL` in both
Node service blocks) all follow. Port 8093 unchanged.

**Consumers (minimal, exactly two).** AMVS `config.ts` exports
`DB_SIDECAR_URL = env.DB_SIDECAR_URL ?? env.SYBASE_SIDECAR_URL ??
'http://localhost:8093'` and keeps `SYBASE_SIDECAR_URL` as a literal ALIAS of
that constant (assigned from it, so they cannot drift); discovery
`sybaseSidecarClient.resolveSidecarBaseUrl()` gains the same precedence, still
read lazily per call. Nothing else in either service was touched — S2 owns the
discovery client.

**`engine` on every request.** New `SidecarEngine` enum (`sybase` | `mssql`,
Jackson case-insensitive). MISSING → `SYBASE`, logged ONCE per process;
UNKNOWN → `IllegalArgumentException` → HTTP 400 via a controller
`@ExceptionHandler` (a silent fallback would run one engine's catalog SQL
against the other and report the empty result as though the database were
empty). The mssql connection options (`authScheme`, `domain`, `encrypt`,
`trustServerCertificate`, `instanceName`) live in ONE `EngineOptions` bean
mixed into each of the five request beans with `@JsonUnwrapped`, so the wire
stays flat while the definition exists once; `ConnectionRequest` (interface)
gives every bean `toConnectionOptions()`.

**One ConnectionFactory.** The three duplicated AUTO loops (query, mutation,
call) are gone. Sybase: forced driver, or jTDS→jConnect with jConnect skipped
when its jar is absent and the ORIGINAL jTDS error surfacing — byte-identical
to the pre-SPEC-1 behaviour, pinned by the existing tests. MSSQL: mssql-jdbc
then jTDS (`jdbc:jtds:sqlserver://`), with the Sybase-only `driver` field
ignored. Every URL token (instance, domain, database) is validated against a
bare-token pattern before it reaches the connection string, so a caller cannot
inject an extra `;property=value` pair.

**Catalog layer.** `EngineCatalog` interface extracted (`engine()`,
`probe()`, `readServerVersion()`, `readServerEdition()`, `introspect()`, plus
the shared pure helpers). `SybaseCatalog` carries today's ASE SQL VERBATIM —
the extraction moved code between classes and changed no query text, which is
why the Sybase suite stayed green throughout. `MssqlCatalog` implements the
full SPEC-1 §1.3 / wire-contract §2 field list over `sys.*`: schemas, tables
(+ temporal type / history link / period columns / memory-optimized /
FileTable), columns (base type resolved from alias types, byte→declared length
normalisation, precision/scale, identity seed+increment, DEFAULT constraint +
name, computed + persisted, rowguidcol, sparse, filestream, hidden,
generated-always, XML schema collection), indexes (`type_desc`, filtered
predicate, INCLUDE columns, key ordinal + direction, disabled), FKs with BOTH
column lists populated and the referential actions, CHECK constraints (new
`check_constraint` kind), full-text indexes (new `fulltext_index` kind),
native sequences in full detail plus IDENTITY synthesized into the SAME shape
the ASE path emits (`last_value` is the high-water mark — no `MAX(col)` scan
on this engine), views (schema-bound + indexed-view flag for the named
`indexed_view` untranslatable reason), routines `P/FN/IF/TF/AF/PC/FS/FT` with
the FULL `sys.sql_modules.definition` (no 4 KB clip), `sys.parameters`,
`EXECUTE AS`, assembly + `language=CLR`, triggers with REAL timing and
`sys.trigger_events` (+ first/last ordering, disabled, view parents, database
triggers listed separately), msdb Agent jobs with steps + decoded schedule
text (fail-soft on permission — the capability is then NOT advertised), and
`extendedObjects[]` for the sixteen kinds with no like-for-like target shape.
Every statement is a `PreparedStatement` over a CONSTANT string; the
schema/table filters are applied in Java, so there is no dynamic SQL on the
path at all.

**Wire precision (item 4).** `Timestamp` now renders its fraction from
`getNanos()` with trailing zeros trimmed and a MINIMUM of 3 digits — which
reproduces the old `.SSS` output byte-for-byte for every millisecond-resolution
value (i.e. every ASE `datetime`) while a `datetime2(7)` keeps all seven
digits. `Time` gains a fraction when non-zero; SQL Server `time(p)` is read as
`LocalTime` (JDBC 4.1) on the MSSQL path ONLY, because `java.sql.Time` holds
milliseconds and `time(7)` would silently lose four digits. `DateTimeOffset` →
ISO with a fixed 7-digit fraction and an explicit numeric offset (never `Z`);
`UUID`/`uniqueidentifier` → lowercase (Postgres renders `uuid` lowercase, so a
parity run would otherwise flag every GUID); `Blob` → `\x` hex; `SQLXML` →
string. Inverse parsers stay lenient and now have pins, including a
7-digit-fraction round trip.

**Guards.** `SidecarSqlGuard` adds `EXECUTE` (the `EXEC` word-boundary pattern
never matched it), `OPENROWSET`, `OPENQUERY`, `BULK` for both engines.
`MutationSqlGuard` is engine-keyed: Sybase `sp_chgattribute … identity_burn_max`
vs MSSQL `DBCC CHECKIDENT ('<t>', RESEED, <n>)` (quoted or bracketed,
optional `WITH NO_INFOMSGS`); the two forms do NOT cross engines (pinned).
Restore mode admits `TRUNCATE TABLE` on both and, MSSQL only, a WHERE-less
`DELETE FROM <t>` (SQL Server refuses TRUNCATE on ANY FK-referenced table).
`CallSqlGuard` gets the SQL Server SET allowlist from §1.5 and a 2100-parameter
cap; the ASE allowlist and 255 cap are untouched.

**Call service.** Engine-keyed bind-family + JDBC-type tables (`nvarchar`
family → `setNString`, `datetime2` → TIMESTAMP, `datetimeoffset` →
`microsoft.sql.Types.DATETIMEOFFSET`, `uniqueidentifier` → CHAR(36),
`rowversion`/`timestamp` → BINARY on BOTH engines, `xml` → LONGNVARCHAR,
`sql_variant` → OTHER, hierarchyid/geography/geometry → string). `CallParam`
gains `sourceType` with `sybaseType` / `sybase_type` / `source_type` accepted
as aliases and the old accessors kept (`@JsonIgnore`d so Jackson sees one
property). A table-valued parameter is REFUSED by name
(`tvp_unsupported_in_call`) rather than bound as something else. Severity /
state come from `SQLServerException.getSQLServerError()` on MSSQL and the
reflective jConnect path is unchanged; `THROW` (number ≥ 50000) classifies as
`raiserror` on MSSQL only — the Sybase classification is untouched.

**Config.** `SidecarApplication.main` pins `TimeZone`/`user.timezone` to UTC
when unset (the work machine runs bare, where the Dockerfile flag does not
apply). The two DEAD `sybase.*` keys in `application.yml` are replaced by
`sidecar.*`, bound via `@ConfigurationProperties` and actually READ by the
controller for the default timeout / row cap.

**Tests (99 new).** `MssqlCatalogTest` (31) row mappers + decoders +
capability set; `RoutineCallServiceMssqlTest` (16) type-table twins, the
`sourceType` alias, TVP refusal, THROW classification; `WirePrecisionTest`
(14) including the "Sybase renders exactly as before" regression pins;
`ConnectionFactoryTest` (19) URL forms (instance / NTLM / encrypt / trust /
injection refusal) + resolution order; `SidecarApplicationTest` (2) the UTC
pin; plus new cases appended to `MutationSqlGuardTest` (+6),
`CallSqlGuardTest` (+5) and `SidecarControllerTest` (+6). No live database is
needed by any of them — there is no SQL Server reachable yet (shaping §7).

**Decisions / deviations.**
- `ProcedureRow.truncated` was ADDED (nullable) per the wire contract, but the
  Sybase path leaves it null rather than being edited to populate it: the ASE
  body already carries its own inline `...[truncated]` marker and the spec's
  regression rule is that Sybase behaviour stays byte-for-byte unchanged.
- `SequenceRow` reuses its existing `cycle` field for the contract's
  `isCycling` (adding a second boolean for the same fact would be worse) and
  adds `cacheSize`.
- `datetimeoffset` renders a FIXED 7-digit fraction, following the contract's
  literal `yyyy-MM-ddTHH:mm:ss.fffffff+HH:MM` shape rather than the
  trimmed-with-minimum rule that `Timestamp` and `Time` use.
- `CallParam` gains an optional `tableValued` flag (additive, nullable) on top
  of the contract's `sourceType`, because a TVP cannot otherwise be recognised
  from its catalog type name alone; the binder also infers it from a `table` /
  `… READONLY` source type.
- Database-scoped (DDL) triggers appear BOTH in `triggers[]`
  (`isDatabaseTrigger = true`) and as a `database_trigger` extended object,
  since the contract lists that kind under `extendedObjects[]`.
- Verification not run here: the two Node consumers' `tsc` / jest — neither
  service has `node_modules` in this worktree. `docker compose config` fails
  on a PRE-EXISTING missing `implement-verify-service/.env`, unrelated to this
  spec; the compose file was validated by parsing it directly (service key,
  container name and both `DB_SIDECAR_URL` values confirmed).

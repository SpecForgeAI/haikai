# SQL Server 16 → PostgreSQL 18 migration pair — shaping (design of record)

Date: 2026-09-11. Owner ask: "extend the tool's DB migration (scan
tables/views/procs/functions, reconcile schema/data/procs) from the only
working pair, Sybase ASE 15 → PostgreSQL 18, to SQL Server 16 (2022) →
PostgreSQL 18, with the same functionality and the same quality."

This document is the design of record. Read it FIRST. The specs under
`agent-os/specs/2026-09-11-sqlserver-postgres-pair-program/` cite it.

## 1. Doctrine (carried, not re-litigated)

- **Two kinds of code, one kind of data** (Data-Tier Oracle Spec O):
  generic core never names an engine; engine knowledge lives in PACK code
  (`discovery-service/src/services/databasePacks/<engine>/`,
  `gateway/src/services/dbMigrationPack/**`, the sidecar catalog layer,
  the AMVS engine adapters) or in the PAIR ruleset
  (`migration-pairs/<pair>.rules.json`). The gateway `engineNameGuard`
  test pins this with an exact-count burn-down allowlist.
- **Gold standard**: nothing deferred, no "v2 follow-up" language, no manual
  residue. Loud halts are waypoints; every gap becomes a decision with
  options or an emulation the tool builds.
- **Staleness is a signal, never a lock.**
- **Like-for-like**: behaviour capture (API, data, proc) is the oracle;
  the translation preserves observed behaviour, including "continue after
  error" in procedures where the source relies on it.
- **Regression rule for THIS programme**: the entire Sybase ASE 15 → PG 18
  test corpus stays green in every spec. A spec that reds a Sybase suite is
  not done.

## 2. Analysis summary (2026-09-11, six parallel deep crawls)

~70% of the DB-migration surface is engine-neutral and needs no change:
AMS (engine-blind schema; the engine rides JSON), the implement-verify
service, `schema-apply-runner` (target-only), the Postgres adapters and
loaders, the data-parity comparator, the plane-based execution driver and
gates, the translation reconcile loop, the evidence ladder. The
engine-specific 30%:

| Area | Engine-specific today | Size |
|---|---|---|
| discovery `databasePacks/sybase/` | pack, introspection transform, profiler, findings, relationship inference, proc harvest, T-SQL routine profiler, sidecar client | ~2,000 lines |
| `sybase-discovery-sidecar` (Java) | catalog SQL over `sysobjects`/`syscolumns`/… (~1,300 lines), status bitmask decoders, `syscomments` reassembly, jTDS/jConnect strategies, ASE SET allowlist, `sp_chgattribute` reseed grammar, `/call` binder type tables; ~70% of the 6,200 lines is neutral plumbing | ~1,900 lines bound |
| gateway `dbMigrationPack/**` | `inputs.ts` hard gate (source must be sybase), `typeMapping.ts`, `liquibase.ts` (filtered-index THROW, per-table name scoping), `sybaseSystemObjects.ts`, `dataScripts.ts` (`bintostr`, convert style 23), `syncPack.ts` (isql section), translation prompts ("Sybase ASE" ×7), `callSiteCompatibility.ts` error-number regex | ~1,500 lines touched |
| AMVS | `SybaseAdapter` (~90% common T-SQL), `dbAdapterFactory`, compensation reseed `sp_chgattribute` + both guard grammars, S0 restore TRUNCATE posture, `runDataMigrationCli` hardcodes, `/call` wire key `sybaseType`, scenario seed type defaults, two hardcoded `SYBPG.PROC.` prefixes, 7 route validators, capture-session adapter guard | ~800 lines touched |
| frontend | 2-value engine unions in 8 API files + 6 components, 9 "Sybase ASE" labels, credentials modal implies engine from mode, proc wizard defaults to Sybase, tech-stack check lists SQL Server as unsupported | ~20 files |
| pair rules | `resolveRulesetPath()` = env pin OR "exactly one file" fallback (a second file → null → pair "none" silently); the 3 copies of `migrationPairRules.ts` are NOT byte-identical (AMVS superset; discovery stale floor-vs-round) | |
| code tier | `sqlDialectClassifier` classifies shared T-SQL as `tsql` correctly; lacks SQL-Server-only constructs; 5 notes + 1 finding string say "Sybase" verbatim | small |

Verified facts that shape the design:
- The sidecar wire renders `Timestamp` to `yyyy-MM-dd HH:mm:ss.SSS` and
  `Time` to seconds → `datetime2(7)` / `time(7)` would silently truncate.
- jTDS on the sidecar classpath already supports SQL Server
  (`jdbc:jtds:sqlserver://`); one URL literal binds it to Sybase.
  `mssql-jdbc` is on Maven Central (no proprietary-jar problem like jConnect).
- SQL Server refuses `TRUNCATE` on ANY FK-referenced table (even with empty
  children) → S0 restore needs a `DELETE` fallback.
- Identity reseed on SQL Server is `DBCC CHECKIDENT (t, RESEED, n)`; it
  appears nowhere in the repo.
- The target-state conversation already offers "MS SQL Server" — as a
  TARGET. The SOURCE engine is never asked; it comes from the DB scan.

## 3. Owner rulings (2026-09-11) — bind

1. **Pair selection is PER PROJECT.** The DB scan's discovered engine key
   selects the ruleset (source engine + target engine → pair id). The pair
   id is stamped on the pack manifest and on report rows. `MIGRATION_PAIR`
   / `MIGRATION_PAIR_RULESET_PATH` remain as a deployment-level PIN
   (override) only. Owner note: a user rarely runs two projects at once,
   but per-project is agreed.
2. **ONE multi-engine sidecar**, renamed `db-discovery-sidecar`; every
   request carries an `engine` field; env `DB_SIDECAR_URL` with
   `SYBASE_SIDECAR_URL` honoured as an alias.
3. **Hard features IN**: (2) case-insensitive collation as the estate
   default; (3) proc error/transaction semantics (TRY/CATCH, THROW,
   XACT_ABORT, @@TRANCOUNT, continue-after-error); (4) `datetime2` /
   `datetimeoffset` / `time(7)` precision incl. the wire fix; (5) objects
   with no like-for-like shape → emulation where possible, decision gate
   otherwise (temporal tables, CLR, Service Broker, FILESTREAM, full-text,
   XML methods, `sql_variant`, `hierarchyid`, geography/geometry);
   (7) triggers (INSTEAD OF on views, ordering, `inserted`/`deleted` →
   transition tables). **OUT by ruling**: (1) cross-database references /
   linked servers, (6) indexed views. Routines or objects that hit an OUT
   item are marked with a NAMED untranslatable reason (`cross_database_reference`,
   `indexed_view`), never attempted, never silent.
4. **Authentication**: SQL logins + NTLM domain logins (pure Java via
   `mssql-jdbc`: `authenticationScheme=NTLM;domain=…`). Encryption ON by
   default with a `trustServerCertificate` toggle; optional named instance.
   Kerberos SSO (native DLL) OUT.
5. **CI collation default** = `citext` for affected string columns; ICU
   nondeterministic collation as an explicit alternative (documented LIKE /
   regex restriction); "accept case-sensitive change" third.
6. **PostGIS** may be installed on the target → loud runbook prerequisite;
   `citext` and `pg_cron` already assumed the same way.
7. **Merge cadence**: one branch per spec, `--no-ff` merge to main + push as
   each goes green; Sybase corpus = regression gate every time.
8. **No SQL Server is reachable from the work machine yet.** The tool and
   the BUILD-LOG state the exact prerequisite (§7) so the user can prepare.
9. **WideWorldImporters**: use it ONLY as vendored offline test fixtures.
   Never a runtime or build-time network dependency.
10. Owner: "continue one after another until all specs are complete; don't
    stop once started."

## 4. Engine vocabulary (S0)

- Engine key: **`mssql`** (wire value everywhere: `dbEngine`, `dbType`,
  `db_type`, finding `engineKey`, candidate `data.dbEngine`, `db://mssql/…`).
  Display: "SQL Server". Default port 1433.
- Pair id: **`sqlserver16-postgres18`**; ruleset `source.engine = "mssql"`,
  `source.version = "16"`, `source.display = "SQL Server 2022 (16.x)"`.
  Rule id prefix: **`MSPG.`**. Code never hardcodes a prefix: the PROC
  family prefix is derived from the ruleset (`rules_prefix` field, default
  `<pair upper>.`), and the session rule is looked up by `applies_to.dimensions`
  / a `role: "session_profile"` marker, not by id.
- Pair resolution (`migrationPairRules.ts`, canonical = AMVS copy, byte-
  identical ×3): `listPairRulesets()` (all `*.rules.json`, validated,
  cached), `resolvePairRuleset({ sourceEngine, targetEngine = 'postgres',
  sourceVersion? })` (exact version match preferred, else the highest),
  `loadPairRulesetById(id)`, `pairRulesetForSource(dbType)` (env PIN wins,
  else resolve by source engine). `loadPairRuleset()` keeps its env-pin
  semantics; the "exactly one file" fallback survives for back-compat but
  the multi-file case logs the resolver hint. Boot headers list
  `migration_pairs: [ids]` + `pinned_pair`.

## 5. Hard-item designs (summary; details in the specs)

- **Item 4 (precision)** — S1: sidecar wire renders `Timestamp` with the
  driver's full fraction (`yyyy-MM-dd HH:mm:ss.SSSSSSS` trimmed of trailing
  zeros, min 3 digits), `Time` with fraction; inverse parser already
  lenient. `datetime2(p)` → PG `timestamp(min(p,6))`, `datetimeoffset(p)` →
  `timestamptz(min(p,6))`, `time(p)` → `time(min(p,6))`; p=7 is LOSSY →
  rule `MSPG.DT.002` (granularity 1 µs) governs parity; the pack manifest
  flags every p=7 column (`precision_loss: 100ns→1µs`).
- **Item 2 (collation)** — S3/S5: `MSPG.COLL.001` `enabled_by_default: true`;
  scan detects DB + column collations (`_CI_`); pack-wide decision
  `collation` defaults `citext`; emitter maps affected `varchar/nvarchar/char`
  to `citext` (or `COLLATE "<icu>"` for the ICU option) and keeps UNIQUE
  semantics; parity uses `collation-case` on affected columns.
- **Item 3 (error semantics)** — S6: routine profiler tags `try_catch`,
  `throw`, `xact_abort`, `trancount`, `error_continuation` (statements after
  a fallible statement without TRY/CATCH); translation KIND_INSTRUCTIONS
  for these constructs come from ruleset `rewrite_guidance`; scenario seeds
  add an "error mid-proc" family; `MSPG.PROC.ERR.001` maps RAISERROR and
  THROW (error number ≥ 50000 → `source_error` DETAIL), `MSPG.PROC.TXN.001`
  covers XACT_ABORT ON/OFF + nested BEGIN TRAN + SAVE TRAN.
- **Item 5 (no like-for-like)** — S5: new pack decision categories
  (`temporal_table`, `clr_object`, `service_broker`, `filestream`,
  `fulltext_index`, `xml_method`, `sql_variant_column`, `hierarchyid_column`,
  `spatial_column`) each with options; emulations the tool BUILDS:
  temporal → history table + `SYSTEM_TIME` trigger pair + `FOR SYSTEM_TIME`
  rewrite guidance; full-text → `tsvector` column + GIN + `to_tsquery`
  rewrite; XML methods → `xpath()` / `xmltable` guidance; hierarchyid →
  `ltree`; spatial → PostGIS (`geometry`/`geography`) with the runbook
  prerequisite; `sql_variant` → decision (`jsonb` | typed split | drop);
  CLR / Service Broker / FILESTREAM → decision (`rewrite_in_app` |
  `drop` | `external_service`) with the object body carried for review.
- **Item 7 (triggers)** — S6: `inserted`/`deleted` → statement-level
  triggers with `REFERENCING NEW TABLE AS inserted OLD TABLE AS deleted`;
  INSTEAD OF on views → row-level INSTEAD OF trigger with a documented
  semantic note; ordering (`sp_settriggerorder`) → name prefixes
  (`a_`, `z_`) with a manifest note; recursive/nested trigger settings → a
  decision when detected.

## 6. Spec split and build order

| Wave | Spec | Depends on |
|---|---|---|
| A | S0 Foundations: engine vocabulary + pair-per-project + rules-lib unification + guard | — |
| B | S1 Sidecar multi-engine (rename, `engine` field, mssql-jdbc + jTDS SQL Server form, `sys.*` catalogs, wire precision, guards, binder types) | S0 |
| C | S2 Discovery `mssql` pack + scan UI | S1 |
| C | S3 Ruleset `sqlserver16-postgres18` + AMVS `MssqlAdapter` + data plane (load / sync / parity) | S1 |
| D | S4 State discipline on SQL Server (compensation reseed, S0 restore, proc capture) | S3 |
| D | S5 Pack generation for SQL Server (gate, type map, DDL, decisions incl. item 5, collation) | S2 |
| E | S6 Translation dialect (items 3 + 7) + code-tier classifier | S4, S5 |
| F | S7 Frontend + ops + shakedown checklist | S6 |

One branch per spec (`feat/mssql-pair-s<N>-…`), `--no-ff` merge to main
and push when green. Build log:
`agent-os/specs/2026-09-11-sqlserver-postgres-pair-program/BUILD-LOG.md`.

## 7. Prerequisite for the tool user (no SQL Server reachable yet)

Before running a SQL Server → PostgreSQL migration with this tool, the user
needs:
1. A **SQL Server 2022 (16.x)** instance reachable from the machine that
   runs the sidecar (work machine = bare services, no Docker). For a local
   shakedown: SQL Server 2022 **Developer Edition** (free), default
   instance on TCP **1433** with TCP/IP enabled in SQL Server Configuration
   Manager (named instances need the port or SQL Browser UDP 1434).
2. A **login** the tool can use: SQL login (`Mixed Mode` authentication
   enabled) or a Windows domain account (NTLM: user + password + domain).
   Grants for discovery/parity: `VIEW DEFINITION` + `SELECT` on the source
   database (a read-only login is enough for the scan and parity); a
   separate **writable** login for behaviour capture / S0 restore
   (compensation brackets need `INSERT/UPDATE/DELETE`, `ALTER` on identity
   tables for `SET IDENTITY_INSERT`, and `db_ddladmin` or `db_owner` for
   `DBCC CHECKIDENT`). SQL Agent job harvest needs `SELECT` on
   `msdb.dbo.sysjobs` / `sysjobsteps` / `sysjobschedules` / `sysschedules`
   (role `SQLAgentReaderRole`).
3. **TLS**: `mssql-jdbc` 12.x encrypts by default. A self-signed corporate
   certificate needs the "trust server certificate" toggle in the
   connection form (or a CA-trusted certificate on the server).
4. **Firewall**: TCP 1433 (or the instance port) open from the sidecar host;
   nothing else. The tool never needs outbound internet access — the
   WideWorldImporters fixtures are vendored in the repo.
5. **Target**: PostgreSQL 18 with `citext` available; `pg_cron` if
   scheduled jobs are re-homed; **PostGIS** if the source has
   geography/geometry columns (the pack runbook says so loudly).
6. Optional test estate for a dry run: restore Microsoft's
   `WideWorldImporters` sample backup into the local Developer instance
   (temporal tables, sequences, TRY/CATCH procs, triggers, full-text,
   columnstore all present).

## 8. Assumptions stated

- Like-for-like is preserved even where the source relies on statement
  continuation after an error; capture evidence decides.
- Routines referencing another database, a linked server, or an indexed
  view get a named untranslatable reason (items 1 and 6 are OUT).
- `mssql` engine key, `MSPG.` rule prefix, pair id `sqlserver16-postgres18`.
- Frontend whole-repo build is red on main (known); features verified in
  isolation.
- Pre-existing red suites (AMVS config/testConnectionAction/
  captureSessionSeeding; gateway manifestCodeMapping/azureOpenaiClient/
  llmClient; AMS 4 classes) stay untouched.

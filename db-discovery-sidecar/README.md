# DB Discovery Sidecar

JVM HTTP sidecar that wraps the SOURCE-database JDBC drivers and exposes a
minimal HTTP surface to the Node services (`discovery-service` and
`api-migration-validation-service`). One sidecar serves **both** supported
source engines:

| `engine` | Engine | Drivers (auto order) | Default port |
|---|---|---|---|
| `sybase` | Sybase ASE 15/16 | jTDS, then jConnect | 5000 |
| `mssql` | SQL Server 2022 (16.x) | mssql-jdbc, then jTDS | 1433 |

Built for spec `2026-05-16-database-discovery-packs-sybase-postgres`
(Task Group 4) under user override D1 (Sybase MUST be executable in v1, not
stubbed), and extended to SQL Server by
`agent-os/specs/2026-09-11-sqlserver-postgres-pair-program/SPEC-1-sidecar-multi-engine.md`
(ruling 2: ONE multi-engine sidecar, renamed from `sybase-discovery-sidecar`).

## Why a sidecar

Both Node services are TypeScript processes and the canonical drivers for both
source engines are JVM-only:

- `jTDS` (`net.sourceforge.jtds:jtds:1.3.1`) — LGPL, Maven-available, speaks
  TDS to Sybase ASE (`jdbc:jtds:sybase://`) AND SQL Server
  (`jdbc:jtds:sqlserver://`). Development paused around 2014 but the driver
  remains functional; it is the Sybase first-attempt driver and the SQL Server
  fallback.
- `jconn4` (SAP / Sybase official) — ships with SAP ASE; redistribution
  restrictions make it inconvenient to vendor into a public repository, so it
  is an OPTIONAL operator-supplied jar (see `lib/`) loaded reflectively.
- `mssql-jdbc` (`com.microsoft.sqlserver:mssql-jdbc:12.8.1.jre11`) — MIT, on
  Maven Central (no proprietary-jar problem), and the source of the pure-Java
  NTLM authentication scheme. First-attempt driver for `mssql`.

## The `engine` field

Every request carries an `engine` field (`sybase` | `mssql`).

- **Missing → `sybase`**, logged once per process. Every consumer that predates
  the multi-engine split omits the field and the sidecar served exactly one
  engine then, so the default is unambiguous back-compat.
- **Unknown → HTTP 400.** Defaulting an unrecognised engine would run SQL
  Server catalog SQL against ASE (or the reverse) and report the resulting
  empty introspection as though the database were empty — a wrong answer that
  looks like a right one.

Connection options beyond the shared five (`host`, `port`, `database`,
`username`, `password`):

| field | engines | default | notes |
|---|---|---|---|
| `charset` | sybase | — | detected server charset declared on the connection |
| `driver` | sybase | `auto` | `auto` \| `jtds` \| `jconnect`; IGNORED for `mssql` |
| `authScheme` | mssql | `sql` | `sql` \| `ntlm` (pure-Java NTLM; no native DLL) |
| `domain` | mssql | — | required when `authScheme=ntlm` |
| `encrypt` | mssql | `true` | mssql-jdbc 12.x encrypts by default |
| `trustServerCertificate` | mssql | `false` | explicit opt-in for a self-signed certificate |
| `instanceName` | mssql | — | named instance; the port is still honoured |

The full wire contract (every response field, per engine) lives in
`agent-os/specs/2026-09-11-sqlserver-postgres-pair-program/WIRE-CONTRACT.md`.

## HTTP surface

All endpoints are `POST` so credentials never travel in a URL or query string.

### `POST /test-connection`

Request:
```json
{ "host": "...", "port": 5000, "database": "...", "username": "...", "password": "..." }
```
Response:
```json
{ "ok": true, "error": null, "serverVersion": "Adaptive Server Enterprise/16.0..." }
```
On failure: `{ "ok": false, "error": "<masked>", "serverVersion": null }`.

### `POST /introspect`

Request: as above, plus optional `includeSchemas: string[]`,
`includeTables: string[]`, `queryTimeoutSeconds: number`.

Response: structured introspection containing arrays of `schemas`, `tables`,
`columns`, `keys`, `views`, `procedures`, `triggers`, `sequences`,
`scheduledJobs` and (SQL Server) `extendedObjects`, plus `capabilities[]`,
`serverVersion`, `serverEdition`, `databaseCollation` and `serverCollation`.
Sybase snippet bodies are pre-trimmed to ~4 KB (the ASE catalog stores them as
`syscomments` fragments); SQL Server bodies are the FULL
`sys.sql_modules.definition` with no clip. The discovery-service further
redacts via `snippetRedaction.redactSnippet` before any persistence.

Every field the SQL Server catalog adds is nullable and optional, and Sybase
responses leave it `null` / `[]` — an existing consumer is unaffected.

### `POST /query`

Request: as above, plus required `sql: string`, optional
`queryTimeoutSeconds: number`, optional `maxRows: number`.

Response: `{ ok, error, rows, rowCount, truncated }`. SQL guard rejections
return HTTP 400 with `ok=false` and a guard-specific `error` string.

Row values are normalised to ONE wire shape across both engines: decimals and
bigints as strings (a JSON number loses precision at `JSON.parse`), datetimes
as the naive wall-clock string with the driver's full fraction (trailing zeros
trimmed, minimum 3 digits — so a Sybase `datetime` still renders `.SSS`
exactly as before while a SQL Server `datetime2(7)` keeps all seven digits),
`datetimeoffset` as ISO with an explicit numeric offset, GUIDs lower-cased,
and binaries as `\x`-prefixed lowercase hex.

## Security contract

- **No connection pool in v1.** Every request opens its own JDBC
  connection and closes it in a `finally` block. This is intentional:
  pooling would force the sidecar to retain credentials beyond the request
  lifetime, which raises the security blast radius significantly for a v1
  service that talks to live production data sources. The per-request
  connect cost (~50–300 ms) is acceptable for discovery workflows.
- **Three-layer SELECT-only guard.** (1) DB user is expected to be granted
  read-only at the database; (2) discovery-service's `sqlGuard.ts` rejects
  non-SELECT before send; (3) sidecar's `SidecarSqlGuard` re-enforces at
  the JVM layer, including a block on `sp_*`/`xp_*` system stored
  procedures and on `EXEC`/`EXECUTE`, `OPENROWSET`, `OPENQUERY` and `BULK`
  (each of which reads or writes OUTSIDE the connected database).
- **Per-engine write grammars.** `/mutate` admits only the compensation
  grammar plus THIS engine's identity reseed — Sybase
  `EXEC sp_chgattribute … identity_burn_max`, SQL Server
  `DBCC CHECKIDENT ('<t>', RESEED, <n>)`. Restore mode additionally admits
  `TRUNCATE TABLE <t>` and, on SQL Server only, a WHERE-less
  `DELETE FROM <t>` (SQL Server refuses TRUNCATE on any FK-referenced table).
  `/call` carries no SQL text at all and matches its session `SET` lines
  against a per-engine allowlist.
- **Multi-statement block.** Any `;` followed by non-whitespace SQL is
  rejected by both `sqlGuard.ts` and `SidecarSqlGuard`.
- **Password masking on error paths.** Every error message returned to the
  client passes through `SybaseQueryService.maskPassword` so the raw
  password cannot leak via a JDBC exception that quoted the connection URL.
- **No credential logging.** Log lines emit a query category string only
  (e.g. `query_category=introspect_tables`); the raw SQL and password are
  never written to a log file.

## Build + run

### Local Maven build
```
cd db-discovery-sidecar
mvn -DskipTests package
java -jar target/db-discovery-sidecar-1.0.0-SNAPSHOT.jar
```
Default port 8093. Override via `SERVER_PORT` env var or `--server.port=...`.

### Docker
```
docker build -t db-discovery-sidecar:dev .
docker run --rm -p 8093:8093 db-discovery-sidecar:dev
```

### Tests
```
mvn test
```
The sidecar test suite mocks the JDBC boundary and drives the pure row
mappers, decoders, guards and URL builders directly. It does NOT require a
real Sybase ASE or SQL Server instance — which matters, because the SQL Server
catalog mappers were written before any SQL Server was reachable (see the
prerequisites below).

## Wiring into the Node services

Both consumers resolve the sidecar base URL the SAME way:

```
DB_SIDECAR_URL  ->  SYBASE_SIDECAR_URL  ->  http://localhost:8093
```

`DB_SIDECAR_URL` is the name to use. `SYBASE_SIDECAR_URL` is kept as an ALIAS
of the same value (not a second, independent setting) so an existing
deployment keeps working with no change; in `api-migration-validation-service`
the `SYBASE_SIDECAR_URL` constant is literally assigned from
`DB_SIDECAR_URL`, so the two can never drift apart.

The discovery-service's database pack POSTs to `/test-connection`,
`/introspect` and `/query`; AMVS additionally uses `/mutate` (the compensation
write surface) and `/call` (routine behaviour capture).

If the sidecar is unreachable, the discovery-service's Sybase pack
fail-soft: every introspection step throws and is caught by the
orchestrator's `withDbPackSoftFail` wrapper, emitting a `db_pack_warning`
finding so the operator sees what happened. Falling back to a stub-only
Sybase implementation is a separate product decision documented in the
spec; this sidecar makes Sybase executable in v1.

## Source database prerequisites

Copied VERBATIM from §7 of the design of record
(`agent-os/planning/2026-09-11-sqlserver-postgres-pair-shaping.md`). Before
running a SQL Server → PostgreSQL migration with this tool, the user needs:

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

For **Sybase ASE** the prerequisites are unchanged: a reachable ASE 15/16
instance, a read-only login for the scan (plus a writable one for capture),
and — only if jTDS cannot log in to that particular ASE build — the operator's
own `jconn4.jar` placed in `lib/` (see below).

## Driver licensing notes

`mssql-jdbc` is MIT-licensed and ships from Maven Central, so it raises no
redistribution question at all.

jTDS is LGPL v2.1. Distributing jTDS unmodified as a Maven dependency on
the sidecar's classpath is permitted by LGPL. If a future deployment
context requires a different license profile (e.g. fully BSD-compatible),
options include:
- Replacing jTDS with the official `jconn4` driver and shipping it as a
  user-supplied artifact (driver outside the container, mounted at
  runtime).
- Wrapping jTDS in a thin dynamic-load layer so the LGPL boundary is
  clearer.

This is out of scope for v1 of this spec.

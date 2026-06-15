# Sybase Discovery Sidecar

JVM HTTP sidecar that wraps the Sybase ASE JDBC driver and exposes a minimal
HTTP surface to the Node-based `discovery-service`. Built for spec
`2026-05-16-database-discovery-packs-sybase-postgres` (Task Group 4) under
user override D1: Sybase MUST be executable in v1, not stubbed.

## Why a sidecar

Discovery-service is a Node/TypeScript process. The canonical Sybase ASE JDBC
drivers are JVM-only:

- `jconn4` (SAP / Sybase official) — ships with SAP ASE; redistribution
  restrictions make it inconvenient to vendor into a public-ish repository.
- `jTDS` (`net.sourceforge.jtds:jtds:1.3.1`) — LGPL, Maven-available,
  supports Sybase ASE alongside MS SQL Server via the TDS protocol.
  Development paused around 2014 but the driver remains functional for
  read-only introspection use cases.

This sidecar uses **jTDS 1.3.1** to avoid the jconn4 license / redistribution
question. If jTDS proves unsuitable for a particular Sybase ASE build,
swapping the driver is a one-line `pom.xml` change plus a small URL builder
update in `SybaseQueryService.buildJdbcUrl`.

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
`columns`, `keys`, `views`, `procedures`, `triggers`. Snippet bodies are
pre-trimmed to ~4 KB; the discovery-service further redacts via
`snippetRedaction.redactSnippet` before any persistence.

### `POST /query`

Request: as above, plus required `sql: string`, optional
`queryTimeoutSeconds: number`, optional `maxRows: number`.

Response: `{ ok, error, rows, rowCount, truncated }`. SQL guard rejections
return HTTP 400 with `ok=false` and a guard-specific `error` string.

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
  procedures.
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
cd sybase-discovery-sidecar
mvn -DskipTests package
java -jar target/sybase-discovery-sidecar-1.0.0-SNAPSHOT.jar
```
Default port 8093. Override via `SERVER_PORT` env var or `--server.port=...`.

### Docker
```
docker build -t sybase-discovery-sidecar:dev .
docker run --rm -p 8093:8093 sybase-discovery-sidecar:dev
```

### Tests
```
mvn test
```
The default sidecar test suite uses H2 with Sybase-mode quirks where
possible and mocks the JDBC boundary elsewhere. It does NOT require a real
Sybase server.

## Wiring into `discovery-service`

The discovery-service's `SybaseDiscoveryPack` locates this sidecar via the
`SYBASE_SIDECAR_URL` environment variable. Default
`http://localhost:8093`. The pack POSTs to `/test-connection`,
`/introspect`, and `/query`; no other endpoints are used.

If the sidecar is unreachable, the discovery-service's Sybase pack
fail-soft: every introspection step throws and is caught by the
orchestrator's `withDbPackSoftFail` wrapper, emitting a `db_pack_warning`
finding so the operator sees what happened. Falling back to a stub-only
Sybase implementation is a separate product decision documented in the
spec; this sidecar makes Sybase executable in v1.

## Driver licensing notes

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

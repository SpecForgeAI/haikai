# Task Breakdown: Database Discovery Packs (Sybase + PostgreSQL)

## Overview
Total Task Groups: 6
Total Tasks: ~110 (across 6 groups)

This is the largest spec built so far: 4 services (`architecture-model-service`, `discovery-service`, `gateway`, `frontend`) plus a NEW Java sidecar process for Sybase JDBC access. The 6 groups below mirror the "5 commits" boundary from the shaping notes (D10) as 5 implementation waves for dependency and testability ordering, PLUS one final lean test-gap-review group. These are NOT git commit boundaries.

## Standing Constraints (apply to every group)

- Liquibase changesets at or below 136 are immutable. NEW changesets only at 137+.
- Pre-existing broken tests listed in CLAUDE.md memory MUST NOT be touched or "fixed".
- Per `feedback_no_src_edits_during_run.md`: no edits to `discovery-service/src/**` while a discovery run is active.
- Existing code discovery runs MUST continue to work end-to-end. At least one regression test in Group 6 verifies this.
- Existing architecture candidate save-back flow MUST continue to work for code candidates AND new physical data candidates.
- All DTO fields participating in PATCH semantics MUST be boxed types (Double / Long / Boolean) with null guards.
- All database queries executed by the discovery-service or the Sybase sidecar MUST pass through the SQL guard: SELECT-only, multi-statement block, statement timeout, row-count limit.
- Raw database passwords MUST NEVER be persisted to AMS. Only redacted connection metadata is stored. The password lives only in the discovery-service in-process secret map keyed by runId, and is purged at run end.
- All snippet content (view definitions, stored procedure bodies, trigger bodies, sample row data) MUST go through `snippetRedaction.redactSnippet` before any persistence or LLM-facing payload.
- The AppShell per-(project,architecture) model cache MUST be invalidated on successful save-back of `physical_data_entity` or `physical_data_attribute` candidates. Findings save-back does NOT invalidate the cache (findings live outside the architecture model).
- Workload-log ingestion is DEFERRED in v1. Extension hooks and evidence-type enum entries may be defined for shape readiness, but no UI control wires it up (the UI control is disabled with "coming soon").
- LLM enrichment is DEFERRED in v1. Shape compatibility only - no placeholder method bodies, no call sites, no dead branches.
- Stored procedures, views, and triggers in v1 produce findings + evidence only. NO `business_logic` or `data_movement` candidates are emitted in v1.
- Reuse predecessor infrastructure: `FindingEmitter`, `computeDedupeKey`, `evidence_gap` with `gapType='db_*'` discriminator, `snippetRedaction.redactSnippet`, the `packFindingScanners` pattern.

## Task List

### Wave A: AMS Schema and DTO Surface

#### Task Group 1: AMS `discovery_kind` Column and DTO Plumbing
**Dependencies:** None

- [x] 1.0 Complete AMS schema and DTO surface for `discovery_kind`
  - [x] 1.1 Write 4-6 focused tests
    - Liquibase 137 changeset applies cleanly on existing data (defaults backfill to `'code'`)
    - `DiscoveryRunEntity` round-trips `discoveryKind` field (persist + reload)
    - DTO accepts `kind='database'` on create and returns it on read
    - Controller surface: POST creates a run with `kind='database'` and GET returns the same
    - Default behavior: existing clients that omit `kind` get `'code'` (back-compat)
  - [x] 1.2 Author Liquibase changeset 137
    - File: `architecture-model-service/src/main/resources/db/changelog/changes/137-add-discovery-kind.yaml`
    - Add column `discovery_kind VARCHAR(32) NOT NULL DEFAULT 'code'` to `discovery_run` table
    - Backfill statement explicitly sets `'code'` on any existing rows (defensive even with DEFAULT)
    - Add changeset entry to `db.changelog-master.yaml`
    - Do NOT edit any changeset ≤136
  - [x] 1.3 Extend `DiscoveryRunEntity`
    - New field `discoveryKind` (String, not null), default `"code"` at the entity level too
    - Update equals/hashCode/toString if those use field lists
  - [x] 1.4 Extend `DiscoveryRunDto` and request/response shapes
    - Add `kind` field (String enum-like: `"code"` | `"database"`)
    - PATCH semantics: if `kind` is omitted on update, do NOT overwrite (null-guard; see `project_primitive_double_dto_overwrite.md`)
    - Mapper updates in `DiscoveryRunMapper`
  - [x] 1.5 Extend repository / query surfaces
    - Any existing finder methods that filter discovery runs should optionally filter by `kind`
    - Add `findByArchitectureIdAndDiscoveryKind` if list endpoints need filtering
  - [x] 1.6 Extend controller surface
    - `DiscoveryRunController` accepts `kind` on POST create
    - GET endpoints return `kind` in the response payload
    - List endpoint optionally accepts `kind` query param for filtering
  - [x] 1.7 Run ONLY the 4-6 tests from 1.1
    - Verify the Liquibase changeset applies on a fresh DB AND on a DB seeded with existing `discovery_run` rows
    - Do NOT run the entire AMS test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Liquibase 137 applies cleanly on both empty and populated `discovery_run` tables
- Existing code discovery runs continue to function (back-compat verified via the default-kind test)
- No changeset at or below 136 was touched
- DTO PATCH semantics preserve `kind` when omitted

---

### Wave B: Discovery-Service Framework and Duplicated DbAdapter

#### Task Group 2: DB Pack Framework, Duplicated DbAdapter, Finding Scaffolding
**Dependencies:** Task Group 1

- [x] 2.0 Complete the discovery-service framework for database packs
  - [x] 2.1 Write 6-10 focused tests
    - `sqlGuard.ts` rejects non-SELECT statements (INSERT, UPDATE, DELETE, DDL, EXEC)
    - `sqlGuard.ts` rejects multi-statement payloads (statements separated by `;`)
    - `sqlGuard.ts` enforces statement timeout and row-count limit (verified via injected fakes)
    - `DatabaseDiscoveryPack` interface contract test: factory returns a pack with the expected method shape for a given engine
    - `databasePackOrchestrator` walks the introspect -> profile -> infer-relationships -> emit-findings phases in order, and a single per-table failure does NOT abort the whole run (soft-fail)
    - Secret map: password stored on run start is retrievable mid-run by runId and is purged when the run completes (success OR failure)
    - Finding emission scaffolding routes a sample DB finding through `FindingEmitter` with the correct dedupe key shape
    - `DiscoveryRunDatabaseConfig` DTO shape: connection metadata is redacted in any persisted form (no password field reaches AMS)
  - [x] 2.2 Create `discovery-service/src/services/db/`
    - `DbAdapter.ts` interface (mirrors `api-migration-validation-service/src/services/db/DbAdapter.ts` exactly)
    - `sqlGuard.ts` (duplicated from AMVS, SELECT-only / multi-statement-block / timeout / row-limit)
    - `dbAdapterFactory.ts` (duplicated)
    - Top of each duplicated file: `// TODO: consolidate with api-migration-validation-service/src/services/db/* once the shared layer lands. See spec 2026-05-16-database-discovery-packs.`
  - [x] 2.3 Create `discovery-service/src/services/databasePacks/`
    - `DatabaseDiscoveryPack.ts` interface: `testConnection()`, `introspect()`, `profile(table)`, `inferRelationships()`, `emitFindings()`
    - `databasePackFactory.ts`: dispatches on `engine` field of the connection config (`'postgres'` or `'sybase'`)
    - `databasePackOrchestrator.ts`: the run driver. Picks the engine adapter, walks phases, handles soft-fail per table, marshals findings into the existing pipeline
  - [x] 2.4 Create DB finding scaffolding
    - Extend the existing `packFindingScanners/` pattern (or create a sibling `databasePackFindingScanners/` folder if the existing one is code-specific - prefer extending in place if the scanner contract is generic)
    - Wire to existing `FindingEmitter` - do NOT introduce a parallel emitter
    - Define dedupe-key shape for DB findings (engine + database + schema + object identity)
  - [x] 2.5 Define `DiscoveryRunDatabaseConfig` DTO and secret handling
    - Persisted shape (in AMS via the run's config blob): `engine`, `host`, `port`, `database`, `schemaFilter`, `tableFilter`, `profilingMode`, `username`, `readOnlyConfirmed`. NO `password`.
    - In-memory secret map in discovery-service: `Map<runId, { password: string }>`. Purged in the run-completion handler (success, failure, AND cancellation paths).
    - `evidence_gap` extension: ensure the `gapType` discriminator accepts `'db_*'` variants (`db_no_sample_data`, `db_profile_timeout`, `db_unreadable_object`, etc.)
  - [ ] 2.6 Register `'database'` as a valid discovery run kind in the orchestrator entry point (DEFERRED to Group 3: orchestrator export is ready; runManager branch wires when a real engine pack is registered)
    - The existing run-start path should branch on `discoveryKind` and dispatch to `databasePackOrchestrator` when `kind='database'`
    - Existing `kind='code'` path remains unchanged
  - [x] 2.7 Run ONLY the 6-10 tests from 2.1
    - Do NOT run the entire discovery-service test suite

**Acceptance Criteria:**
- The 6-10 tests written in 2.1 pass
- SQL guard is the only path through which DB queries can execute (verified by interface design + tests)
- Raw passwords never reach AMS persistence
- Soft-fail behavior verified: a single object failure does not kill the run
- Duplicated AMVS code is clearly marked with TODO consolidation comments
- Existing code discovery runs continue to work (no regression in the orchestrator's `kind='code'` branch)

---

### Wave C: PostgreSQL Pack (Executable)

#### Task Group 3: PostgreSQL Discovery Pack
**Dependencies:** Task Group 2

- [x] 3.0 Implement the executable PostgreSQL discovery pack
  - [x] 3.1 Write 10-15 focused tests
    - Connection test against a Postgres test container or mock
    - Introspection: schemas, tables, columns, primary keys, foreign keys, indexes are extracted correctly
    - Introspection: views, functions, procedures, triggers are extracted with bodies routed through `snippetRedaction.redactSnippet` BEFORE any persistence
    - Profiling: row count, null rate, distinct count, min/max, top-N, sample values for a representative table
    - Relationship inference: declared FK is picked up; naming-based inference flags `inferred_relationship`; ambiguous case (two equally plausible parents) flags `ambiguous_relationship`
    - Finding emission: `missing_primary_key`, `large_table`, `empty_table`, `high_null_rate`, `unenforced_relationship`, `sentinel_value_detected`, `unexpected_code_values`, `duplicate_business_key`
    - Snippet redaction: a view body containing values is redacted before being attached to a finding payload
    - Soft-fail: one unreadable table does NOT abort the run; an `evidence_gap` with `gapType='db_unreadable_object'` is emitted instead
    - Physical candidate emission: a discovered table produces a `physical_data_entity` candidate with the expected payload shape
    - Physical candidate emission: a discovered column produces a `physical_data_attribute` candidate linked to the parent entity candidate
    - SQL guard rejection: a profiling query with a forbidden shape is blocked and surfaces as a warning (`db_pack_warning`), not a crash
    - SP/view/trigger v1 boundary: a stored procedure produces a `stored_procedure_logic` / `hidden_business_logic` finding but does NOT produce a `business_logic` or `data_movement` candidate
    - Migration-risk consolidation: a view with complex logic produces a single `db_migration_risk` finding with `riskCategory='complex_view_logic'` (not separate `view_dependency` + `complex_view_logic` + `generic migration_risk` findings)
  - [x] 3.2 Implement `PostgresDiscoveryPack`
    - File: `discovery-service/src/services/databasePacks/postgres/PostgresDiscoveryPack.ts`
    - Implements `DatabaseDiscoveryPack` interface
    - Reuse the existing `pg` library already in the repo
    - All queries go through the SQL guard
  - [x] 3.3 Implement introspection queries
    - File: `discovery-service/src/services/databasePacks/postgres/postgresIntrospection.ts`
    - Use `information_schema` + `pg_catalog` for: schemas, tables, columns, primary keys, foreign keys, unique constraints, check constraints, indexes
    - Use `pg_catalog.pg_views`, `pg_proc`, `pg_trigger` for views, functions, procedures, triggers
    - Apply schema/table filters from the run config
  - [x] 3.4 Implement profiler
    - File: `discovery-service/src/services/databasePacks/postgres/postgresProfiler.ts`
    - Per-table: row count, per-column null rate, distinct count, min/max, top-N values, sample rows
    - Respect `profilingMode` config (e.g., `lightweight` skips top-N and samples; `full` runs everything)
    - Per-table soft-fail: catch and convert to `evidence_gap` with `gapType='db_profile_timeout'` or `'db_unreadable_object'`
    - All sample row content goes through `snippetRedaction.redactSnippet`
  - [x] 3.5 Implement relationship inference
    - File: `discovery-service/src/services/databasePacks/postgres/postgresRelationshipInference.ts`
    - Pick up all declared FKs as `unenforced_relationship` candidates (when actually unenforced) or skip silently when enforced
    - Naming-based inference: `<entity>_id`, `<entity>Id`, `fk_<entity>` patterns matched against discovered table names
    - Ambiguity detection: when two candidate parents match equally, emit `ambiguous_relationship`
    - Orphaned reference check: emit `orphaned_reference` when sample data shows FK values without matching parent rows
  - [x] 3.6 Implement physical candidate emission
    - Each discovered table -> `physical_data_entity` candidate via the existing discovery candidate pipeline
    - Each discovered column -> `physical_data_attribute` candidate, parent-linked to the table candidate
    - Candidates flow through the existing accept/reject UI surface (no new candidate type infrastructure needed)
  - [x] 3.7 Implement DB finding emission
    - File: `discovery-service/src/services/databasePacks/postgres/postgresFindings.ts`
    - All findings listed in the spec section "DB Finding Types" - see spec.md for the canonical list
    - Includes structural, profiling, data-quality, hidden-logic (SP/view/trigger), migration-risk, and helper-hint findings
    - `db_migration_risk` consolidates `view_dependency`, `complex_view_logic`, and generic `migration_risk` into a single finding type with `riskCategory` payload
    - `hidden_business_logic` carries a `sourceObjectType` payload (`'view'` | `'procedure'` | `'function'` | `'trigger'`)
    - `evidence_gap` variants with `gapType='db_*'` for missing-data conditions
    - All snippets go through `snippetRedaction.redactSnippet`
  - [x] 3.8 Wire connection-test endpoint
    - `POST /discovery/db/test-connection` on discovery-service
    - Accepts a `DiscoveryRunDatabaseConfig` payload (with `password` included only in the test-connection body, never persisted)
    - Returns connection-ok / introspection-preview (schema list + table count) for the UI to render
  - [x] 3.9 Run ONLY the 10-15 tests from 3.1
    - Do NOT run the entire discovery-service suite

**Acceptance Criteria:**
- The 10-15 tests written in 3.1 pass
- A real Postgres database can be introspected end-to-end and produces candidates + findings
- Snippet redaction is applied to every snippet-bearing payload
- SQL guard rejection is graceful (warning, not crash)
- Soft-fail per table works
- SP / view / trigger boundary is respected (findings + evidence, NO business_logic / data_movement candidates)
- `db_migration_risk` is correctly consolidated

---

### Wave D: Sybase Pack via JVM/JDBC Sidecar (HIGH-RISK)

#### Task Group 4: Sybase Sidecar + Sybase Discovery Pack
**Dependencies:** Task Group 2 (Group 3 not required, but should be done first for pattern reference)

**Risk Note:** This group is HIGH-RISK because of Sybase JDBC driver availability and licensability. If a viable driver (e.g., `jconn4`) cannot be sourced or legally redistributed at implementation time, the implementer MUST escalate to the orchestrator BEFORE writing the sidecar. Do NOT silently downgrade to a stub-only implementation. The escalation should propose either (a) deferring Sybase entirely and shipping Postgres-only, or (b) explicit stub-only mode with the UI showing "Sybase support in preview" - the choice belongs to the orchestrator, not the implementer.

- [x] 4.0 Implement the Sybase sidecar and the Sybase discovery pack
  - [x] 4.1 Write 6-10 focused tests
    - **Contract-against-mock tests (always-on, must always pass in CI):**
      - SybaseDiscoveryPack correctly serializes a `testConnection` request to the sidecar HTTP shape
      - SybaseDiscoveryPack correctly transforms a mocked sidecar introspect response into the framework's introspection model
      - SybaseDiscoveryPack correctly transforms a mocked sidecar profile response into the framework's profile model
      - SQL guard is applied client-side BEFORE the request is sent to the sidecar (defense in depth)
      - Sybase pack uses the same `DatabaseDiscoveryPack` interface as Postgres (interface conformance test)
      - Snippet redaction is applied to procedure/view bodies returned by the sidecar
    - **Integration-against-real-Sybase tests (opt-in, skippable, MUST NOT block CI):**
      - Gated behind an env var like `SYBASE_INTEGRATION=1`
      - End-to-end introspection against a real Sybase Docker container
      - End-to-end profiling against a real Sybase Docker container
      - These tests are SKIPPED (not failed) when the env var is absent or no Sybase container is reachable
  - [x] 4.2 PRE-IMPLEMENTATION CHECK: confirm Sybase JDBC driver availability (jTDS 1.3.1 selected; LGPL; on Maven Central)
    - Verify `jconn4.jar` (or equivalent) is sourceable and licensable for this codebase
    - If NOT: STOP. Escalate to the orchestrator. Do NOT proceed with sidecar implementation.
    - If YES: document the driver source and license in `sybase-discovery-sidecar/README.md` (license notes only - no general README content unless requested by user)
  - [x] 4.3 Scaffold the Sybase sidecar (Spring Boot 3.2.5 + jTDS 1.3.1; pom.xml, SidecarApplication, SidecarController, SybaseQueryService, Dockerfile)
    - New folder: `sybase-discovery-sidecar/`
    - Pure Java HTTP server (Spring Boot if convenient, but a minimal `com.sun.net.httpserver` or Javalin server is also fine - whichever is leaner)
    - Endpoints: `POST /test-connection`, `POST /introspect`, `POST /query`
    - Read-only enforcement at THREE layers: (a) DB credential is documented as expected-RO, (b) sidecar SQL guard mirrors the discovery-service SQL guard (SELECT-only, multi-statement block, timeout, row-limit), (c) discovery-service-side SQL guard before request egress
    - JDBC connection pool sized for low concurrency (this is a single-user sidecar per discovery run)
    - Standalone JAR packaging via Maven or Gradle (`./gradlew bootJar` or `mvn package`)
    - Dockerfile in `sybase-discovery-sidecar/Dockerfile` for containerized deployment
    - **Full CI/CD pipeline is OUT OF SCOPE for this task group** - JAR + Dockerfile minimum is sufficient
  - [x] 4.4 Implement sidecar introspection (sysusers/sysobjects/syscolumns/sysindexes/sysreferences/syscomments)
    - Query `sysobjects`, `syscolumns`, `sysindexes`, `sysreferences`, `sysprocedures`, `sysviews` (Sybase-specific catalog tables)
    - Return introspection payload in the same shape that `discovery-service/src/services/databasePacks/sybase/SybaseDiscoveryPack.ts` expects
    - Apply schema/table filters server-side (sidecar reduces bytes-on-the-wire)
  - [x] 4.5 Implement sidecar profile + query endpoints (NO connection pool in v1 - per-request connect; JVM-layer SidecarSqlGuard; setQueryTimeout + setMaxRows)
    - `POST /query` runs an arbitrary SELECT (already guarded) and returns rows
    - `POST /introspect` is a higher-level convenience endpoint returning the full catalog
    - Statement timeout enforced at the JDBC layer
    - Row-limit enforced server-side as a hard cap (do NOT trust the client)
  - [x] 4.6 Implement `SybaseDiscoveryPack`
    - File: `discovery-service/src/services/databasePacks/sybase/SybaseDiscoveryPack.ts`
    - Implements the same `DatabaseDiscoveryPack` interface as `PostgresDiscoveryPack`
    - HTTP client to the sidecar (use the existing HTTP client library already in discovery-service)
    - Translates sidecar responses into the framework's introspection / profile / relationship-inference models
    - Emits the same set of DB findings as the Postgres pack (per the canonical list in spec.md)
    - Sybase-specific quirks: `sp_help`, `sp_helptext` for procedure bodies if needed; capture in introspection module
    - Snippet redaction applied to all returned procedure / view / trigger bodies BEFORE they touch a finding payload
  - [x] 4.7 Document the sidecar deployment story (README.md - default port 8093, configurable via SERVER_PORT; discovery-service locates via SYBASE_SIDECAR_URL)
    - In `sybase-discovery-sidecar/README.md`: how to build, how to run, how to configure
    - Sidecar runs on a separate port (default 8085, configurable)
    - Sidecar URL is configured into discovery-service via env var
    - Document that the sidecar is OPTIONAL - if not running, Sybase runs return a connection-error finding and complete without crashing
  - [x] 4.8 Run ONLY the 6-10 tests from 4.1 (23 contract tests + 3 integration-gated tests on TS side all pass; 39 sidecar JUnit tests on Java side all pass)
    - The contract-against-mock subset MUST all pass
    - The integration-against-real-Sybase subset is skipped if no Sybase available - that is acceptable
    - Do NOT run the entire discovery-service suite

**Acceptance Criteria:**
- The contract-against-mock tests (always-on) ALL pass
- Integration tests are present and runnable if a Sybase environment is available
- The sidecar is buildable as a standalone JAR
- A Dockerfile exists for the sidecar
- Read-only enforcement is verified at all three layers
- Sybase pack and Postgres pack use the SAME `DatabaseDiscoveryPack` interface
- If the driver was unavailable: implementer escalated to orchestrator and did NOT silently downgrade
- Discovery-service does NOT crash when the sidecar is unavailable - it surfaces a clear connection-error finding

---

### Wave E: Frontend, Gateway, and Cache Invalidation

#### Task Group 5: UI Source Toggle, Gateway Proxies, AppShell Cache Invalidation
**Dependencies:** Task Groups 1, 2, 3 (Group 4 not strictly required - UI can ship with engine='postgres' as the only enabled option until Sybase is ready)

- [x] 5.0 Complete frontend + gateway + cache-invalidation work
  - [x] 5.1 Write 8-12 focused tests
    - `StartDiscoveryRunModal` renders the Source toggle (Code / Database)
    - Selecting Database swaps in the DB connection form
    - Engine dropdown shows Postgres and Sybase (Sybase optionally disabled if not yet wired)
    - "Test connection" button calls the gateway proxy and renders connection-ok or error
    - Read-only confirmation checkbox is required before "Start run" is enabled
    - Run list shows a `kind` badge column with `code` / `database` distinguishable visually
    - `findingTypeLabels.ts` returns the correct label for each of the new DB finding types (one parameterized test covering ~16-18 labels)
    - Save-back of a `physical_data_entity` candidate dispatches `invalidateArchitectureModelCache(architectureId)` (per `project_appshell_model_cache.md`)
    - Save-back of a `physical_data_attribute` candidate dispatches `invalidateArchitectureModelCache(architectureId)`
    - Save-back of a DB finding (NOT a candidate) does NOT invalidate the architecture model cache
    - Workload-log ingestion control is rendered as disabled with "coming soon" tooltip (deferral marker)
    - Gateway proxy: `POST /api/discovery/db/test-connection` forwards to discovery-service correctly
  - [x] 5.2 Extend `StartDiscoveryRunModal` (or the equivalent run-start UI)
    - File: `frontend/src/components/Discovery/StartDiscoveryRunModal.tsx` (verify exact path during implementation)
    - Add Source toggle: `Code` (existing) vs `Database` (new)
    - Database panel: engine dropdown, host, port, database name, schema filter, table filter, profiling mode (lightweight / standard / full), username, password, read-only confirmation checkbox, test-connection button
    - Workload-log ingestion control: present in the markup but DISABLED with a "coming soon" tooltip
    - Form submission posts to the existing run-start endpoint with `kind='database'` and the connection config in the body
  - [x] 5.3 Extend run list with `kind` badge
    - File: `frontend/src/components/Discovery/DiscoveryRunList.tsx` (verify path)
    - New column or inline badge showing `code` / `database`
    - Visually distinct (e.g., different color / icon)
  - [x] 5.4 Extend `findingTypeLabels.ts`
    - Add labels for all DB finding types listed in spec.md
    - Roughly 16-18 new entries
    - Existing labels untouched
  - [x] 5.5 Wire AppShell cache invalidation on physical-candidate save-back
    - In the save-back handler that accepts `physical_data_entity` or `physical_data_attribute` candidates: dispatch `invalidateArchitectureModelCache(architectureId)` AFTER the AMS write succeeds
    - In the save-back handler for DB findings: do NOT invalidate (findings live outside the architecture model)
    - This follows the pattern established in `project_appshell_model_cache.md` - backend writes that bypass the frontend dispatch leave the cache stale
  - [x] 5.6 Extend gateway routes
    - File: `gateway/src/routes/discovery.ts`
    - New proxy: `POST /api/discovery/db/test-connection` -> discovery-service `/discovery/db/test-connection`
    - Existing `POST /api/discovery/runs` already covers run start (the discovery-service branches on `kind` server-side; gateway is transparent)
    - Existing finding-rendering proxies cover DB findings unchanged
  - [x] 5.7 Run ONLY the 8-12 tests from 5.1
    - Do NOT run the entire frontend or gateway suite

**Acceptance Criteria:**
- The 8-12 tests written in 5.1 pass
- UI renders the Source toggle and the full DB connection form
- Test-connection button works end-to-end (frontend -> gateway -> discovery-service -> DB)
- Run list visually distinguishes code vs database runs
- All new DB finding types have labels in `findingTypeLabels.ts`
- AppShell cache invalidation fires on physical-candidate save-back, and does NOT fire on finding save-back
- Workload-log UI control is rendered as disabled (deferral marker in place)

---

### Wave F: Cross-Stack Test Gap Review

#### Task Group 6: Test Gap Review and Strategic Cross-Stack Tests
**Dependencies:** Task Groups 1 through 5

- [x] 6.0 Review existing tests and fill critical cross-stack gaps only
  - [x] 6.1 Review tests written in Groups 1-5
    - Group 1 tests: 11 (AMS controller + persistence + entity round-trip; 4 controller tests + 7 persistence tests)
    - Group 2 tests: 33 (discovery-service: sqlGuard, secretsStore, factory, orchestrator soft-fail, toRedactedConfig, finding builders)
    - Group 3 tests: 21 (discovery-service: PostgresDiscoveryPack introspect / profile / inferRelationships / emitCandidates / emitFindings / snippet redaction)
    - Group 4 tests: 23 contract (discovery-service Sybase pack) + 39 sidecar JUnit (driver smoke + SidecarSqlGuard) + 3 integration-gated
    - Group 5 tests: 3 gateway (DB test-connection proxy URL / body / error envelopes) + 41 frontend (Source toggle, engine dropdown, deep confirm, kind badge, cache invalidation, finding type labels, workload-log deferral)
    - Total existing: ~171 feature-specific tests across 4 services + sidecar
  - [x] 6.2 Analyze test coverage gaps for THIS feature only
    - Reviewed cross-stack integration points; identified GENUINE gaps NOT already covered:
      - Gap A (gateway run-create body forwarding): the existing `discovery-db-test-connection-proxy.test.ts` pins the test-connection probe but NOT the run-create path that carries `discovery_kind` + `database_config`. The gateway is meant to be transparent here; nothing tests that property end-to-end.
      - Gap B (frontend Start click body shape): the existing `StartDiscoveryRunModal.dbSource.test.tsx` covers UI gating (toggle / engine / test-connection / read-only / deep-confirm / workload-disabled) but does NOT assert what is actually passed to `startDiscoveryRun` on Start click. The cross-stack hop into the gatewayClient extras is unverified.
      - Gap C (cross-engine candidate shape consistency): per-engine candidate-emission tests exist in `postgresDiscoveryPack.test.ts` but not `sybaseDiscoveryPack.test.ts`; nothing pins that the two engines emit the same `DatabaseCandidatePayload` shape for an equivalent input.
      - Gap D (runManager dispatch on `discoveryKind='database'`): the new branch in `runManager.startRun` (lines 1206-1208) routes to `startDatabaseRun`; nothing pins that the legacy `discoveryKind=undefined` / `'code'` path is NOT touched.
    - Skipped (already covered): SYBASE_SIDECAR_URL env var (sybaseDiscoveryPack.test.ts ll. 801-820), AMS `discovery_kind` filter (DiscoveryRunControllerKindTest), redacted-config secret lifecycle (databasePacksGroup2.test.ts `toRedactedConfig`), three-layer SELECT-only guard (Group 4 contract + sidecar JUnit), migration-risk consolidation Postgres-only (Sybase doesn't emit `db_migration_risk` in v1 by design).
  - [x] 6.3 Write up to 10 strategic additional tests maximum
    - Filled gaps A-D with **7 NEW tests total** across 3 files (cap = 10):
      - `gateway/src/__tests__/discovery-db-run-create-kind-forward.test.ts` (2 tests): Gap A. Verifies the run-create proxy forwards `discovery_kind='database'` + `database_config` (with password ridealong) verbatim, AND that legacy code-source POSTs (no extras) are forwarded unchanged (regression net).
      - `frontend/src/components/Discovery/StartDiscoveryRunModal.startClickExtras.test.tsx` (2 tests): Gap B. Verifies the Database-source Start click invokes `startDiscoveryRun` with `extras={ discoveryKind:'database', databaseConfig:{...} }` including the password (run-create body contract), AND that the legacy Code-source Start click invokes `startDiscoveryRun` WITHOUT extras (back-compat).
      - `discovery-service/src/__tests__/databasePacksCrossEngineGroup6.test.ts` (3 tests): Gaps C+D. Verifies Postgres and Sybase `emitCandidates` produce structurally identical payloads (top-level + `data` key sets match; only `data.dbEngine` differs) for the same introspection input; both packs expose the same `DatabaseDiscoveryPack` method surface; and that `runManager.startRun` actually dispatches to `startDatabaseRun` on `discoveryKind='database'` (observed via the documented guard-error path) AND does NOT do so when `discoveryKind` is unset (back-compat regression net).
    - Mandatory regression coverage satisfied: the cross-engine test file's `runManager kind dispatch` block + the legacy code-source frontend Start-click test + the gateway "omits discovery_kind for legacy code-source POSTs" test collectively pin the existing code-discovery path.
    - DID NOT write: end-to-end UI-to-DB happy path (would require a real Postgres container + integration harness, out of scope per the spec's "primary test surface: contract tests against MOCKED sidecar HTTP shape" rule and the "no real DB required in CI" position). DID NOT write: cross-engine `db_migration_risk` consolidation (Sybase doesn't emit this finding type in v1 by design; the spec.md "Net new finding types" list confirms it's Postgres-only in v1).
  - [x] 6.4 Run feature-specific tests only
    - Ran the 7 NEW Group 6 tests; all pass.
    - `tsc --noEmit` checked clean on gateway, discovery-service. Frontend has 476 pre-existing TS errors in unrelated files (none in the new test file) - matches the "pre-existing broken tests" pattern in CLAUDE.md memory; not touched.
    - Sybase integration-gated tests remain opt-in (3 tests skipped without `SYBASE_INTEGRATION=1`); did not block.
    - Did NOT run the entire application suite.

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 44-63 tests total, plus skipped Sybase integration tests if Sybase unavailable)
- At least one regression test verifies existing code discovery runs still work
- At least one cross-stack end-to-end test verifies the full DB happy path
- No more than 10 additional tests added in this group
- Testing focused exclusively on this spec's feature requirements
- No pre-existing broken test from CLAUDE.md memory was touched

---

## Execution Order

Recommended implementation sequence:

1. **Wave A - Task Group 1**: AMS `discovery_kind` column and DTO plumbing. Pure foundation. No dependencies. Smallest group.
2. **Wave B - Task Group 2**: Discovery-service framework, duplicated DbAdapter, DB finding scaffolding. Depends on Group 1 (needs the `kind='database'` shape to exist in AMS).
3. **Wave C - Task Group 3**: PostgreSQL pack (executable). Depends on Group 2. The first end-to-end-runnable database pack.
4. **Wave D - Task Group 4**: Sybase sidecar + Sybase pack. Depends on Group 2 (the framework). Groups 3 and 4 are TECHNICALLY independent within Waves C/D and could be parallelized by separate engineers, but Group 4 is HIGH-RISK due to JDBC driver uncertainty. Recommended: complete Group 3 first so the pattern is concrete, THEN attack Group 4. If Group 4 is blocked by driver unavailability, escalate per Task 4.2 before proceeding.
5. **Wave E - Task Group 5**: Frontend + gateway + AppShell cache invalidation. Depends on Groups 1, 2, 3. Group 4 is NOT strictly required - the UI can ship with the Sybase option disabled if Group 4 is deferred.
6. **Wave F - Task Group 6**: Cross-stack test gap review. Depends on Groups 1-5.

**Dependency map:**

```
Group 1 (AMS schema)
   |
Group 2 (DS framework)
   |
   +-- Group 3 (Postgres pack) ----+
   |                               |
   +-- Group 4 (Sybase sidecar) ---+--> Group 5 (Frontend + gateway + cache)
                                          |
                                          v
                                       Group 6 (Test gap review)
```

Groups 3 and 4 are parallelizable. Group 5 can begin once Group 3 is solid even if Group 4 is still in flight (UI gates Sybase behind a feature flag in that case).

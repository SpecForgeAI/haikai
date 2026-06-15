# Specification: Database Discovery Packs (Sybase + PostgreSQL)

## Goal
Extend discovery-service with database discovery packs that connect read-only to deployed current-state databases (Sybase via a JVM/JDBC sidecar; PostgreSQL via the existing `pg` library), producing physical data entity/attribute candidates plus first-class Discovery Findings and Evidence to feed future migration planning.

## User Stories
- As an architect, I want to point discovery at a live Sybase or PostgreSQL database so the current-state architecture is grounded in real schema, profile, and procedural-logic facts rather than guessed from code alone.
- As a migration engineer, I want database-specific findings (missing PKs, inferred relationships, high-null columns, hidden stored procedure logic) surfaced as reviewable Discovery Findings so I can plan migration risk before any code is written.
- As a project lead, I want database discovery runs to live alongside code discovery runs in the same UI so a single architecture has one unified discovery history regardless of source.

## Specific Requirements

**AMS schema change: `discovery_kind` column on `discovery_runs` (D3)**
- New Liquibase changeset **137-discovery-runs-kind.sql** (existing tail is 136-discovery-finding-links.sql); never edit changesets at or below 136 per `feedback_liquibase_immutable_changesets.md`.
- Column: `discovery_kind VARCHAR NOT NULL DEFAULT 'code'`; allowed values `code | database | combined`.
- Backfill rule: existing rows get `'code'` via the default; no data migration script required.
- Extend `DiscoveryRunEntity`, request/response DTOs, and the run repository with the field; add filter-by-kind on the run list query.
- DTO PATCH fields stay boxed (`Boolean`, `Long`, `Double`) per `project_primitive_double_dto_overwrite.md`; this column itself is non-PATCH (set at create only) but the rule applies to any companion fields touched.
- Do NOT conflate with existing `mode` column (`'A' | 'B' | 'C'` V3 pipeline tier).

**Discovery-service DB pack framework**
- New `DatabaseDiscoveryPack` interface: `engineKey`, `displayName`, `testConnection`, `introspectSchemas/Tables/Columns/KeysAndIndexes/Views/Procedures/Triggers`, `profileTables`, `inferRelationships`, `ingestWorkloadLogs` (no-op default per D4), `emitCandidates`, `emitFindings`, `close`.
- Duplicate DbAdapter pieces into `discovery-service/src/services/db/` (per D2): `DbAdapter` interface, connection/guard pattern, `sqlGuard.ts` (strips comments, blocks INSERT/UPDATE/DELETE/MERGE/DROP/ALTER/TRUNCATE/EXEC/CALL/GRANT/REVOKE/CREATE plus multi-statement, requires first token SELECT/WITH, injects trailing LIMIT). Add a `// TODO: consolidate with api-migration-validation-service into a shared workspace package` comment at the top of both copies.
- Async pack runner sibling to `packFindingScanners/index.ts`: new `dbDiscoveryRunner.ts` orchestrates per-pack `introspect*` + `profile*` + `emit*` calls with the same soft-fail-per-scanner pattern, but async (each scanner returns `Promise<FindingEmitInput[]>`).
- Reuse `FindingEmitter` + `computeDedupeKey` from `2026-05-16-discovery-findings-first-class/` and the `snippetRedaction.redactSnippet` helper from `2026-05-16-wire-java-spring-maven-findings/` for SP/view/trigger body truncation.
- DB config DTO fields: `dbEngine`, `host`, `port`, `databaseName`, `schemaName`, `username`, `password` (in-memory only), `includeSchemas/excludeSchemas/includeTables/excludeTables`, `profilingMode` (`none|basic|standard|deep`, default `standard`), `maxTablesToProfile`, `maxRowsPerProfileQuery`, `queryTimeoutSeconds`, `allowWorkloadLogUpload` (D4 placeholder).
- Persisted config snapshot is redacted: host, dbName, schema/table filters, profilingMode, workloadLogProvided flag ONLY — NEVER raw username/password.
- All DB queries MUST go through the SQL guard (SELECT-only, multi-statement block, timeout, row limit); guard violations log query category only, never the raw SQL.

**PostgreSQL pack (executable v1)**
- `PostgresDatabaseDiscoveryPack` uses the existing `pg` library; mirror the connection / `Pool` / `SET statement_timeout` / identifier quoting pattern from `api-migration-validation-service/src/services/db/PostgresAdapter.ts` with `application_name='discovery-service'`.
- Deterministic introspection via `information_schema` and `pg_catalog`: schemas, tables, columns, keys/indexes/constraints, declared FKs, views/materialized views, functions/procedures, triggers.
- Profiler (per `profilingMode`): row counts, null counts/rates, distinct counts (exact for small tables, estimate for large), min/max numeric/date, top-N for code-like columns, empty string counts, sample values, sentinel detection (`9999-12-31`, `-1`).
- Relationship inference module: declared FKs + inference from column name similarity, PK/FK naming, value-overlap sampling under safe row caps, index structure, naming conventions. Emits `inferred_relationship`, `unenforced_relationship`, `ambiguous_relationship` findings.
- Emits `physical_data_entities` and `physical_data_attributes` candidates (PLURAL canonical names per `candidateTypes.ts`); synthetic source URI `db://postgres/{schema}/{table}` used as candidate `filePath`.
- `deep` profiling mode requires that the request payload include an explicit confirmation flag; otherwise the pack rejects the run with a finding-emitter warning.

**Sybase pack via JVM/JDBC sidecar (D1 — executable v1)**
- New Java sidecar process living at `sybase-discovery-sidecar/` (separate top-level service folder; standalone Spring Boot or pure-Java HTTP server) wrapping a Sybase JDBC driver (`jconn4` if licensable; document alternative options explored during implementation).
- Sidecar HTTP API (loopback or cluster-internal): `POST /test-connection` (validates credentials, returns version/edition metadata), `POST /introspect` (read-only metadata queries for schemas/tables/columns/keys/indexes/views/procedures/triggers, returns structured JSON), `POST /query` (guarded read-only SELECT — sidecar enforces SELECT-only AND multi-statement block AND query timeout in addition to discovery-service's `sqlGuard`).
- Read-only enforcement at THREE layers: (1) DB credential issued must be read-only; (2) discovery-service `sqlGuard` rejects non-SELECT before send; (3) sidecar JDBC layer re-enforces SELECT-only + multi-statement block + timeout.
- `SybaseDiscoveryAdapter` in discovery-service is a thin HTTP client over the sidecar; discovery-service stack stays pure Node.
- Packaging: separate Docker container OR standalone JAR — spec implementer chooses; deployment doc must capture chosen model and how discovery-service locates the sidecar (env var `SYBASE_SIDECAR_URL`).
- **Fallback escalation (D1)**: if no viable Sybase JDBC driver path is achievable during implementation, implementer escalates to product/user with a written blocker — does NOT silently downgrade to stub.

**DB Evidence model**
- Reuse existing `DiscoveryEvidenceEntity` (free-form `type` column — no schema change).
- Evidence types: `db_schema_metadata`, `db_table_metadata`, `db_column_metadata`, `db_index_metadata`, `db_constraint_metadata`, `db_view_definition`, `db_procedure_definition`, `db_trigger_definition`, `db_profile_summary`, `db_relationship_inference`, `db_data_quality_check`, `db_sample_value`, `db_query_usage`, `db_migration_risk`.
- `db_workload_log` evidence type is **defined for readiness only** (D4 deferred); no emitter wired in v1.
- Evidence `data` is structured JSON; SP/view/trigger bodies are truncated and redacted via `snippetRedaction.redactSnippet`.

**Finding emission (consolidated types per D6)**
- Net new finding types: **~16-18** after consolidation.
- Consolidation 1: unified `db_migration_risk` with `riskCategory` payload (consumes legacy `view_dependency` + `complex_view_logic` + generic `migration_risk`).
- Consolidation 2: existing `evidence_gap` extended with `gapType` discriminator values `db_schema_metadata_gap`, `db_object_definition_missing`, `db_relationship_inference_low_confidence`, `db_profile_skipped`, etc. (consumes legacy `db_discovery_evidence_gap`).
- Consolidation 3: single `hidden_business_logic` with `sourceObjectType` payload (`stored_procedure | trigger | function | view`) — consumes procedure-vs-trigger variants.
- New types kept: `missing_primary_key`, `no_foreign_keys_declared`, `inferred_relationship`, `unenforced_relationship`, `ambiguous_relationship`, `large_table`, `empty_table`, `sparse_column`, `high_null_rate`, `duplicate_business_key`, `orphaned_reference`, `unexpected_code_values`, `sentinel_value_detected`, `sample_data_hint`, `reconciliation_hint`, `api_test_data_candidate`, `unsupported_db_feature`, `db_pack_warning`.
- All findings carry `source`, `createdByStage`, `confidence`, `summary`, `detailJson` for shape-compatibility with future LLM enrichment (D5 deferred — no enrichment call site in v1).
- SP/view/trigger discovery emits FINDINGS + EVIDENCE only in v1 (D7); NO `business_logics` or `data_movements` candidates.

**Profiling modes (D8)**
- Ladder: `none | basic | standard | deep`.
- Default: `standard` (row count + null rate + min/max + sample values for selected columns).
- `basic`: row count + null rate only.
- `none`: introspection only, no profile queries.
- `deep`: adds distinct-count exacts on large tables and value-overlap sampling for relationship inference; requires explicit user confirmation (UI second-click pattern) and an explicit confirmation flag on the request payload.

**Frontend Source toggle + DB run setup (D9)**
- Extend the existing discovery run setup with a Code vs Database toggle at the top.
- Database path swaps in a DB connection form: engine dropdown (Sybase, PostgreSQL), host, port, database, schema filter, table filter, profiling mode dropdown, read-only confirmation checkbox, `deep` mode second-click confirmation, Test Connection button.
- Workload log upload control hidden in v1 (D4 deferred) OR shown disabled with "coming soon" tooltip — implementer chooses simplest.
- Unified Discovery Runs list with a `kind` badge column (`code` / `database` / `combined`).
- Canonical Discovery Run Detail view: `Discovery/DiscoveryRunDetailViewWithTabs.tsx`. Reuse existing Findings and Evidence tabs; add DB finding labels per the consolidated finding-type set. No new tab in v1 unless implementer judges it strictly necessary.
- Candidate review screen renders `physical_data_entities` / `physical_data_attributes` from DB packs through the existing review/save-back flow.

**AppShell cache invalidation on save-back**
- DB candidates ARE architecture entities (`physical_data_entities`, `physical_data_attributes`), unlike findings — per `project_appshell_model_cache.md`, save-back of these candidates MUST trigger an AppShell model-cache refresh.
- Same-architecture save-back: dispatch `LOAD_MODEL` to repopulate the cache.
- Cross-architecture save-back: invalidate the cache entry for the target architecture.
- Confirm the existing candidate save-back path emits this dispatch; do NOT bypass via direct AMS write.

**Gateway proxies**
- Add proxy routes for: DB discovery run create/start, test-connection (proxies to discovery-service which proxies to sidecar for Sybase), DB profile/evidence summary fetch (if any new endpoints added beyond existing run-summary endpoints).
- Gateway must NOT own DB discovery logic; pure passthrough with auth.

**Sidecar tests + contract tests**
- Primary test surface: contract tests in discovery-service against a MOCKED sidecar HTTP shape — these define the wire contract and always run in CI.
- Optional integration tests against a real Sybase Docker container — skipped automatically when no container is available; MUST NOT block the build.
- Sidecar's own tests: minimal driver-smoke + endpoint-shape tests using a Java mock or stubbed JDBC layer.
- Implementer must avoid `discovery-service/src/**` edits while an active discovery run is in flight (per `feedback_no_src_edits_during_run.md`); tsx watch auto-reloads kill runs.

## Existing Code to Leverage

**`api-migration-validation-service/src/services/db/` — DbAdapter + sqlGuard + PostgresAdapter**
- DbAdapter interface (5 methods: `testConnection`, `listMetadata`, `runReadonlySelect`, `sampleValues`, `dispose`) plus PostgresAdapter `pg`-based implementation with Pool, per-query `SET statement_timeout`, identifier quoting, `ensureLimit`, `assertReadonlySelect`.
- Per D2 these are DUPLICATED into `discovery-service/src/services/db/` (not extracted to a shared package in v1); both copies carry a TODO comment for future consolidation.
- The narrower DbAdapter surface covers SQL execution + guard + connection management only; introspection methods are NOT in DbAdapter and must be built fresh in each pack.

**`discovery-service/src/services/findings/packFindingScanners/index.ts` — soft-fail-per-scanner pattern**
- Synchronous fan-out shim `runPackFindingScanners(input): FindingEmitInput[]` with per-pack scanner soft-fail wrapper.
- DB packs are async (network I/O) — define an ASYNC SIBLING (`dbDiscoveryRunner.ts`) that mirrors the soft-fail-per-scanner pattern but with `Promise<FindingEmitInput[]>` returns; do NOT extend the sync index.

**`FindingEmitter` + `computeDedupeKey` (from `2026-05-16-discovery-findings-first-class/`)**
- Use as-is for all DB finding emission; reuse `computeDedupeKey` so re-runs do not duplicate findings.
- `snippetRedaction.redactSnippet` (from `2026-05-16-wire-java-spring-maven-findings/`) used for SP/view/trigger body truncation in evidence payloads.

**Existing candidate emission pipeline — `bulkSaveCandidates` + `makeCandidate`**
- `bulkSaveCandidates(projectId, runId, candidates[])` in `archModelClient`, and `makeCandidate(type, name, filePath, data, runId, parentCandidateId)`.
- DB packs reuse both with synthetic `filePath` URIs like `db://postgres/{schema}/{table}` or `db://sybase/{schema}/{table}`.
- `physical_data_entities` / `physical_data_attributes` (PLURAL) are already emitted by framework adapters (springBoot, springClassic, django, flask, nestjs, aspNetCore, symfony, kratos); the candidate review/save-back UI flow works as-is.

**`DiscoveryEvidenceEntity` — free-form `type` column**
- No schema change required to add new `db_*` evidence types; just emit with the new type string.
- Structured JSON `data` column carries DB-specific payloads.

## Out of Scope
- Workload log ingestion v1 emission (D4 deferred): the 5 workload-only finding types (`high_usage_table`, `high_usage_procedure`, `slow_query_hotspot`, `workload_migration_risk`, `unused_table_candidate`) are NOT shipped in v1; extension hooks + `db_workload_log` evidence type defined for readiness only.
- LLM enrichment implementation (D5 deferred): shape compatibility only on findings; no placeholder method, no call site in v1.
- `business_logics` / `data_movements` candidate emission from DB packs (D7 deferred): SP/view/trigger discovery emits findings + evidence only in v1.
- Cross-engine database schema diff (e.g. Sybase source vs PostgreSQL target).
- Drift detection across re-runs (single-snapshot v1).
- Persistent secrets vault / DB credential storage (in-memory for the run only; redacted config snapshot only).
- Encrypted-column awareness / row-level security awareness.
- DB user/role/permission discovery.
- DB candidate cross-linking to upstream code-pack `services`/`applications` candidates.
- Multi-database-per-run (one engine + one database name per run).
- Full Sybase sidecar release pipeline (auto-publish to registry, version skew handling) — sidecar build + packaging is in scope per D1; full CI/CD tooling is out.

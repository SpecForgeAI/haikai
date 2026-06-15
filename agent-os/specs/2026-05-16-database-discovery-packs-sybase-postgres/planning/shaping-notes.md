# Shaping Notes — Database Discovery Packs (Sybase + PostgreSQL)

Spec folder: `agent-os/specs/2026-05-16-database-discovery-packs-sybase-postgres/`
Raw idea: `planning/raw-idea.md` (~410 lines)
Shaper: spec-shaper subagent
Date: 2026-05-16
Status: **SHAPING COMPLETE — ready for `/write-spec`**

---

## Final Summary

**Scope (v1):**
- **Executable Sybase via JVM/JDBC sidecar** (user override of original recommendation) — primary v1 path.
- **Executable PostgreSQL** via Node `pg` adapter (extending the existing one).
- **Consolidated finding types: ~16-18** new types (down from ~30 in the raw idea) after consolidation + workload deferral.
- **5 implementation task groups** (logical dependency-ordered groupings; NOT git commits).
- **No visuals required** — backend-heavy with additive frontend only.

**Key decisions (all resolved with user):**
- D1 Sybase: executable via Java/JDBC HTTP sidecar (primary), with explicit escalation fallback if no safe driver path exists.
- D2 DbAdapter reuse: duplicate inside discovery-service with TODO for future consolidation.
- D3 Run kind: new `discovery_kind VARCHAR` column on `discovery_run`, Liquibase changeset 137.
- D4 Workload log ingestion: deferred to a follow-up spec (extension hooks + evidence-type readiness only).
- D5 LLM enrichment: deferred (shape compatibility only; no placeholder method or call site).
- D6 Finding-type consolidation: 3 consolidations confirmed (see D6 below).
- D7 SP/views/triggers: findings + evidence only in v1; NO `business_logics` / `data_movements` candidates from DB packs.
- D8 Profiling modes: `none | basic | standard | deep`, default `standard`, `deep` requires explicit confirmation.
- D9 UI: extend existing run-setup flow with Source toggle (Code vs Database); unified run list with `kind` badge.
- D10 Five implementation task groups (dependency order only; git commit boundaries handled separately).

**Services touched:**
- `architecture-model-service` (Java/Spring): Liquibase changeset 137, `DiscoveryRunEntity` field, DTOs, repository filters.
- `discovery-service` (Node/TypeScript): new DB pack framework, PostgreSQL pack, Sybase pack (HTTP client to sidecar), async pack runner sibling.
- **NEW** Sybase sidecar (Java/JVM): minimal HTTP server wrapping Sybase JDBC driver (e.g. `jconn4`) — read-only.
- `gateway` (Node/Express): proxy routes for DB run setup, test-connection.
- `frontend` (React): Source toggle, DB connection form, kind badge in run list, finding labels.

**Out of scope (explicit):**
1. Cross-engine database schema diff (Sybase source vs Postgres target).
2. Drift detection across re-runs (single-snapshot v1).
3. DB connection credential storage / secrets vault integration (in-memory for the run only).
4. Encrypted columns / row-level security awareness.
5. DB user/role/permission discovery.
6. Candidate cross-linking (DB candidates ↔ code-pack `services`/`applications`).
7. Workload log ingestion (D4 — deferred, hooks only).
8. LLM enrichment (D5 — deferred, shape compatibility only).
9. `business_logics` / `data_movements` candidate emission from DB packs (D7).
10. Multi-database-per-run (one engine + one database name per run).
11. **JVM sidecar packaging/distribution is IN SCOPE** for v1 because Sybase is now executable (user override D1) — but full release pipeline tooling for the sidecar (auto-publish to registry, version skew handling) is out of scope.

---

## Resolved Decisions (D1-D10)

### D1. Sybase driver approach — EXECUTABLE via JVM/JDBC sidecar (user override)

**Original shaper recommendation:** stub-only Sybase in v1.

**User decision (verbatim):** "Do not ship Sybase as stub-only unless implementation proves there is no viable safe driver path. Prefer a Java/JDBC helper sidecar using a suitable Sybase JDBC driver if Node support is unsuitable."

**v1 plan:**
- Build a small Java/JVM HTTP sidecar wrapping a Sybase JDBC driver (likely `jconn4` from SAP/Sybase; explore free/open alternatives during implementation).
- Sidecar exposes a minimal HTTP surface to discovery-service:
  - `POST /test-connection` — validates credentials, returns version/edition metadata.
  - `POST /introspect` — runs read-only metadata queries (schemas, tables, columns, keys, indexes, views, procedures, triggers); returns structured JSON.
  - `POST /query` — executes a guarded read-only SELECT (sidecar enforces SELECT-only at the JDBC boundary as well as relying on discovery-service `sqlGuard`).
- All connections opened by the sidecar are read-only (driver flags + statement-level guards).
- discovery-service's `SybaseDatabaseDiscoveryPack` is a thin HTTP client speaking to the sidecar; discovery-service stack stays pure Node.
- Sidecar packaged as a separate process / container; deployment doc updated.

**Explicit fallback condition:** if during implementation no viable safe driver path is achievable (e.g. no commercially or legally usable driver, or unresolvable security blocker), the implementer **escalates** rather than silently downgrading to stub. spec-writer documents this escalation path; the stub remains a last-resort fallback only on explicit re-decision.

### D2. DbAdapter reuse — duplicate inside discovery-service

Duplicate the relevant pieces (`DbAdapter` interface, `PostgresAdapter` connection/guard pattern, `sqlGuard`) inside `discovery-service/src/services/db/`. Add a TODO comment noting future consolidation with `api-migration-validation-service` into a shared workspace package if/when both services' surfaces converge.

### D3. Discovery run kind field — new column `discovery_kind`

- Column: `discovery_kind VARCHAR`
- Values: `code | database | combined`
- Default: `code`
- Liquibase changeset: **137** (additive only; tail is currently 136).
- AMS entity + DTO field; repository filters by kind for run list UI.

### D4. Workload log ingestion — DEFER to follow-up spec

V1 ships:
- Extension hooks: `ingestWorkloadLogs(optional)` method on the pack interface (no-op default).
- `db_workload_log` evidence type **defined** as readiness for the follow-up spec.
- UI: file-upload control shown disabled with "coming soon" tooltip (if needed) OR omitted entirely from v1 UI (spec-writer to choose simplest).
- The 5 workload-only finding types (`high_usage_table`, `high_usage_procedure`, `slow_query_hotspot`, `workload_migration_risk`, `unused_table_candidate`) are NOT shipped in v1.

### D5. LLM enrichment — DEFER

V1 ships shape compatibility ONLY:
- DB findings carry `source`, `createdByStage`, `confidence`, `summary`, `detailJson` fields ready for a future enrichment pass.
- NO placeholder method or call site in v1.
- Predecessor precedent (Discovery Findings first-class; Wire Java/Spring/Maven Findings) followed.

### D6. Finding-type consolidation — confirmed

Three consolidations:
1. `db_migration_risk` with `riskCategory` payload (consumes `view_dependency` + `complex_view_logic` + generic `migration_risk`).
2. Existing `evidence_gap` with `gapType='db_*'` discriminator (consumes `db_discovery_evidence_gap`) — matches Discovery Findings spec pattern.
3. Single `hidden_business_logic` with `sourceObjectType` payload (consumes the procedure-vs-trigger variants).

Net new finding types after consolidation + D4 deferral: **~16-18** (down from ~30).

### D7. SP/views/triggers — findings + evidence only in v1

V1 emits findings + evidence ONLY for stored procedures, views, triggers (`stored_procedure_logic`, `trigger_side_effect`, `complex_view_logic`, `procedure_data_write`, etc.). NO `business_logics` or `data_movements` candidates emitted from DB packs in v1 — extending those candidate semantics to non-class-backed business logic is a follow-up spec. Findings + evidence carry the full SP body (truncated/redacted) so nothing is lost.

### D8. Profiling modes — four-step ladder confirmed

`none | basic | standard | deep`. Default `standard`. `deep` requires explicit user confirmation in the UI before the run starts.

### D9. DB discovery run UI — extend existing run-setup flow

- Source toggle (Code vs Database) at the top of the existing Discovery run-creation flow.
- Database selection swaps in the DB connection form (engine dropdown including Sybase + PostgreSQL, host, port, database, schema filter, table filter, profiling mode, read-only confirmation, test connection button).
- Runs go in the **same** Discovery Runs list with a `kind` badge (`code` / `database` / `combined`).
- Discovery Run Detail page stays unified — same tabs (Candidates, Findings, Evidence) populated differently per run kind.

### D10. Implementation task groups — FIVE logical groups (NOT git commits)

**User clarification (verbatim):** "ignore literal git commit structure. Treat the proposed 'commits' as implementation task groups only. The important thing is dependency order, safe implementation, and testability; actual code repo commits are handled separately."

The five groups below exist to enforce **dependency ordering, safe implementation, and testability**. They are NOT git commit boundaries; actual repo commits are handled separately by the implementer / committer. task-list-creator can mirror these as logical group boundaries in the task list.

1. **Group 1 — AMS schema + DTOs.** Liquibase changeset 137 (`discovery_kind` column on `discovery_run`), entity + DTO updates, repository filters by kind, secret-redaction rules for config snapshot.
2. **Group 2 — discovery-service DB pack framework.** `DatabaseDiscoveryPack` interface, `discovery-service/src/services/db/` (duplicated per D2), DB-specific finding types + emitters, profiler, relationship-inference module, SP/view/trigger dependency analyzer skeletons, async pack runner sibling to `packFindingScanners`, run-orchestration wiring.
3. **Group 3 — PostgreSQL pack.** `PostgresDatabaseDiscoveryPack`, deterministic introspection (schemas/tables/columns/keys/indexes/views/functions/triggers), profiling, sample-value emission, relationship inference. Tests against a real or mocked Postgres.
4. **Group 4 — Sybase pack (executable via sidecar).** Java/JVM sidecar (HTTP server + JDBC driver wrapper); `SybaseDatabaseDiscoveryPack` as the discovery-service-side HTTP client; sidecar packaging notes; tests per the sidecar test approach below.
5. **Group 5 — Frontend + gateway.** DB run setup UI (source toggle + connection form + test-connection button), kind badge on run list, Findings tab labels for new DB finding types, candidate review for DB-emitted `physical_data_entities` / `physical_data_attributes`, gateway proxy routes, app-shell cache invalidation hook on save-back.

---

## Sybase sidecar technical risk + mitigation

**Risk:**
- Sybase JDBC drivers are commercial (`jconn4` ships with SAP ASE / has license constraints) or have limited free/open options. The implementer must verify a legally and operationally viable driver during Group 4.
- Deployment requires a JVM (added ops surface for any environment that previously ran discovery-service as Node-only).

**Mitigation:**
- **HTTP boundary** keeps the discovery-service stack pure Node. The sidecar can be packaged and deployed as a **separate container or process**; discovery-service speaks to it over loopback/cluster HTTP.
- Sidecar exposes the **minimum** surface needed (`/test-connection`, `/introspect`, `/query`) — no general SQL passthrough. Read-only enforced at both the discovery-service `sqlGuard` and the sidecar JDBC layer.
- Sidecar is built once; PostgreSQL path is unaffected.

**Fallback (escalation, not silent downgrade):**
- If during Group 4 no driver path is viable (license blocker, security blocker, no maintained free option), the implementer **escalates** to product/user with a written blocker report. Stub-only Sybase is reconsidered as a last-resort fallback on explicit re-decision.

**Test approach:**
- **Contract tests** against a mocked sidecar HTTP shape (default; always runs in CI).
- **Optional integration tests** against a real Sybase Docker container if one is available in the dev/CI environment. Tests **must NOT block** on real Sybase availability — they are skipped when no container is present.
- Sidecar itself has its own minimal test surface (driver smoke test + endpoint shape).

---

## Codebase reality-check (preserved)

### Existing `DbAdapter` shape (api-migration-validation-service)

Files at `api-migration-validation-service/src/services/db/`:
- `DbAdapter.ts` — interface with **5 methods only**: `testConnection`, `listMetadata(allowlist)`, `runReadonlySelect(sql, params, limits)`, `sampleValues({schema, table, column, ...})`, `dispose`.
- `PostgresAdapter.ts` — working `pg`-based implementation; uses `Pool`, per-query `SET statement_timeout`, identifier quoting, `application_name='api-migration-validation'`, `ensureLimit` to inject LIMIT, `assertReadonlySelect` guard.
- `SybaseAdapter.stub.ts` — throws `'Sybase support is not yet implemented in v1'` on every call.
- `dbAdapterFactory.ts` — exhaustive `switch(config.dbType)`.
- `sqlGuard.ts` — strips comments, blocks INSERT/UPDATE/DELETE/MERGE/DROP/ALTER/TRUNCATE/EXEC/CALL/GRANT/REVOKE/CREATE plus multi-statement; requires first token SELECT or WITH; `ensureLimit` injects trailing LIMIT.

The `DbAdapter` surface is **narrower** than the DB pack's introspection layer; the realistic reuse is SQL execution + guard + connection management, not the introspection methods themselves. Per D2, this is duplicated into discovery-service with a TODO for future consolidation.

### `DiscoveryRunEntity.mode` is already taken

- `mode` column is in use (`'A' | 'B' | 'C'` — V3 pipeline tier). DO NOT conflate with run kind.
- New column `discovery_kind` added per D3 (changeset 137).
- `configSnapshot` (JSONB) carries the immutable Phase 0 discovery config; could discriminate via a JSON key but a top-level column wins for indexing/filtering.

### Canonical candidate types — PLURAL forms

`discovery-service/src/constants/candidateTypes.ts`:
`interfaces`, `endpoints`, `logical_data_entities`, `physical_data_entities`, `physical_data_attributes`, `logical_data_attributes`, `business_logics`, `logical_data_entity_relationships`, `interface_logical_entities`, `ui_screens`, `ui_components`.

**`physical_data_entities` / `physical_data_attributes` are already emitted** by framework adapters (springBoot, springClassic, django, flask, nestjs, aspNetCore, symfony, kratos). DB packs reuse:
- `bulkSaveCandidates(projectId, runId, candidates[])` in `archModelClient`
- The candidate review/save-back UI flow
- `makeCandidate(type, name, filePath, data, runId, parentCandidateId)` pattern (file path → synthetic `db://engine/schema/table` URI)

**Naming correction**: raw idea writes singular forms (`physical_data_entity`, `physical_data_attribute`). Canonical is **plural**. spec-writer must use the plural form throughout.

### Pack-finding scanner framework — async sibling needed

`discovery-service/src/services/findings/packFindingScanners/`:
- `index.ts` shim — **synchronous** `runPackFindingScanners(input): FindingEmitInput[]`, fans out to per-pack scanners, soft-fail wrapper.
- Per-scanner pattern: pure function `(PackFindingScannerInput) => FindingEmitInput[]`.

**DB packs are inherently async** (network I/O for DB queries). spec-writer must define an **async sibling** (e.g. `dbDiscoveryRunner.ts`) that orchestrates per-pack `introspect*` + `profile*` + `emit*` calls following the same soft-fail-per-scanner pattern — NOT a drop-in extension of the existing sync scanner index.

### Liquibase tail = 136; immutable changesets rule

Last changeset: `136-discovery-finding-links.sql`. Per `feedback_liquibase_immutable_changesets.md`: never edit existing changesets, always add new. DB discovery kind column → **changeset 137**.

### App-shell model cache invalidation

Per `project_appshell_model_cache.md`: DB candidates **are** architecture entities (`physical_data_entities`, `physical_data_attributes`). On save-back to current-state architecture, the AppShell's per-(project,architecture) in-memory model cache MUST be invalidated (LOAD_MODEL same-arch or cache invalidate cross-arch). spec-writer confirms the existing save-back path is reused, not bypassed.

---

## Items resolved by shaper (NOT for the user)

- **Plural canonical names** — DB packs emit `physical_data_entities` / `physical_data_attributes` / `business_logics` / `data_movements` / `data_store_instances` (plural).
- **Pack-finding scanner async sibling** — new `dbDiscoveryRunner.ts` (or similar) parallels the existing sync scanner index; same soft-fail pattern.
- **Evidence type naming** — `db_*_metadata`, `db_profile_summary`, `db_relationship_inference`, etc. map cleanly into existing `DiscoveryEvidenceEntity` (`type` column is free-form). No schema change for evidence types.
- **Cache invalidation pattern** — LOAD_MODEL dispatch reused per the AppShell memory; spec-writer documents the dispatch in the save-back flow.
- **Pre-existing test failures** — items listed in CLAUDE.md (`bootstrap-summary-fetching`, `chatV2-panel-*`) are unrelated to this spec.
- **No edits during active run** — per `feedback_no_src_edits_during_run.md`, spec-writer notes the implementer should pause for active runs before editing `discovery-service/src/**`.
- **No visuals required** — backend-heavy with additive frontend only. Empty `visuals/` folder confirms this.

---

## Out-of-scope items for spec-writer to record

1. **Cross-engine database schema diff** (Sybase source vs Postgres target).
2. **Drift detection** across re-runs (single-snapshot v1).
3. **Secrets vault integration / persistent DB credential storage** (in-memory for the run only).
4. **Encrypted columns / row-level security awareness** (metadata only in v1).
5. **DB user/role/permission discovery** (not architecture-relevant for v1).
6. **Candidate cross-linking** (DB candidates ↔ code-pack `services`/`applications` candidates).
7. **Workload log ingestion** (D4 — deferred; hooks only).
8. **LLM enrichment** (D5 — deferred; shape compatibility only).
9. **`business_logics` / `data_movements` candidate emission from DB packs** (D7).
10. **Multi-database-per-run** (one engine + one database name per run).
11. **JVM sidecar release pipeline tooling** (auto-publish, version skew handling) — sidecar **build and packaging** is in scope per D1, but full release tooling is not.

---

## Risk callouts for spec-writer

- **Liquibase changeset 137** for new `discovery_kind` column — additive only.
- **Cache invalidation on save-back** of DB candidates — call out explicitly per CLAUDE.md guidance.
- **Naming**: plural canonical entity names — DO NOT carry forward raw idea's singular forms.
- **Async pack framework** — do not try to extend the synchronous `packFindingScanners/` framework for DB packs; define an async sibling.
- **Sybase sidecar contract** — define the HTTP shape (request/response schemas for `/test-connection`, `/introspect`, `/query`) clearly enough that the discovery-service-side HTTP client can be implemented and tested against a mock first.
- **Sybase driver risk + escalation path** — capture explicitly that the implementer escalates if no viable driver path is achievable (D1 fallback condition).
- **DbAdapter reuse decision** — record D2 in the spec and reference the future shared-package follow-up via TODO.
- **`DiscoveryRunEntity.mode` is taken** — new field `discovery_kind` per D3; don't conflate.
- **Sidecar tests must NOT block on real Sybase availability** — contract tests against mocked sidecar are the default; real-Sybase integration tests are optional and skip when no container is available.

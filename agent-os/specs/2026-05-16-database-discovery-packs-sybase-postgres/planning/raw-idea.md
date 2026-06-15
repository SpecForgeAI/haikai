# Add Database Discovery Packs: Sybase First, PostgreSQL Next

## Feature summary

Extend discovery-service with database discovery packs that can connect read-only to deployed current-state database engines, starting with Sybase and then PostgreSQL, and produce both Current State Architecture candidates and first-class Discovery Findings/Evidence.

Database discovery should complement existing code/log discovery. Code discovery primarily analyses source repos, framework patterns, dependencies, and logs. Database discovery primarily analyses a deployed current-state database through read-only metadata queries, profiling queries, optional DB logs/workload evidence, and LLM enrichment over deterministic findings.

## Primary goal

Enable discovery-service to understand the current-state database deeply enough to support future migration planning, target-state backlog generation, API behaviour baseline capture, data migration work, database/schema implementation work, and migration test harness planning.

## Key product principle

Discovery + evidence + target architecture + mappings + API baselines must be rich enough to generate an accurate, implementation-ready hierarchical book of work.

## V1 scope

- Add database discovery pack framework to discovery-service.
- Add Sybase database discovery pack first.
- Add PostgreSQL database discovery pack next, reusing the same framework.
- Support read-only DB connections only.
- Discover database schema/catalog metadata.
- Produce architecture candidates for physical data entities and physical attributes.
- Produce architecture candidates for database views/procedures/triggers where they fit existing architecture model concepts, or otherwise emit findings/evidence.
- Produce Discovery Findings/Evidence for database migration intelligence.
- Support deterministic DB discovery first.
- Support optional DB logs/workload input where available.
- Support LLM enrichment over deterministic DB evidence/findings.
- Add frontend review support for database findings/evidence using the existing Discovery Findings UI.
- Do not mutate source databases.
- Do not execute database migration.
- Do not perform post-migration reconciliation.

## Out of scope

- Actual data migration.
- Target database creation.
- Source-to-target data mapping.
- Database reconciliation after migration.
- Production database execution.
- Free-form unrestricted SQL.
- Stored procedure execution.
- Full performance benchmarking.
- Query rewrite recommendations beyond findings/hints.
- Automatic creation of migration backlog items.
- API Behaviour Baseline execution changes, except where future integration points are noted.

## Services touched

- discovery-service
- architecture-model-service, if new candidate/finding DTO fields or DB discovery run config are needed
- frontend, for DB discovery run setup/review UI additions
- gateway, if discovery routes are proxied there

## Assumptions

- Discovery Findings/Evidence model exists (predecessor `2026-05-16-discovery-findings-first-class/`).
- FindingEmitter exists.
- Java/Spring/Maven findings may already be wired (predecessor `2026-05-16-wire-java-spring-maven-findings/`).
- Current architecture model supports physical data entities and physical attributes (already in MetaModelEntities).
- Infrastructure/data-store instance modelling may already exist and should be reused where practical.
- Discovery run model can support a database discovery mode/source or can be extended to do so.
- **POTENTIAL REUSE OPPORTUNITY:** The API Behaviour Baseline Capture spec (`2026-05-15-api-behaviour-baseline-capture-service/`) built `DbAdapter`, `PostgresAdapter`, `SybaseAdapter.stub`, `dbAdapterFactory`, `sqlGuard` in `api-migration-validation-service/src/services/db/`. The spec-shaper should investigate whether to (a) reuse by moving to a shared package, (b) duplicate the pattern in discovery-service, or (c) have discovery-service call api-migration-validation-service's DB endpoints.

---

## High-level database discovery pipeline

1. User starts a database discovery run for a project/architecture.
2. User selects DB engine: Sybase or PostgreSQL.
3. User provides read-only non-prod/current-state DB connection details (host, port, database/catalog, schema/owner filters, username/password, optional table allowlist/blocklist, optional profiling depth).
4. User optionally provides DB logs/workload evidence (query logs, slow query logs, audit logs, stored procedure execution logs, exported workload samples).
5. discovery-service creates a DB discovery run.
6. DB pack connects read-only.
7. Deterministic discovery runs: catalog/schema introspection, table/column discovery, key/index/constraint discovery, view/procedure/trigger discovery where supported, row counts/profile summaries, relationship inference, data quality checks, sample-value/test-data hint discovery.
8. Optional logs/workload discovery runs if logs are provided.
9. Architecture candidates are produced for model-suitable outputs.
10. Discovery Findings/Evidence are produced for migration intelligence.
11. LLM enrichment may summarise and prioritise deterministic findings.
12. User reviews: architecture candidates, findings/evidence, relationship inferences, migration risks, sample-data hints, reconciliation hints.
13. User saves selected candidates to Current State Architecture.
14. Discovery findings remain durable and reviewable.

---

## Core distinction

**Architecture candidates** represent stable architecture structure (physical data entity/table, physical attribute/column, data store instance if supported, logical data entity suggestions if confidence sufficient, business logic candidate from stored procedure where model supports it, data movement candidate where evidence supports it).

**Discovery Findings/Evidence** represent migration-useful intelligence (row counts, null rates, distinct values, top code values, data quality issues, inferred but unenforced relationships, orphaned records, duplicate keys, sparse columns, large/high-risk tables, stored procedure dependency details, trigger side effects, view dependency complexity, workload/query usage hints, sample records useful for API baseline capture, reconciliation hints, open questions).

Do not force non-architecture diagnostics into the architecture model.

---

## Database discovery pack framework requirements

### 1. Database pack abstraction

```
DatabaseDiscoveryPack:
- engineKey
- displayName
- connect(config)
- testConnection(config)
- introspectSchemas(config)
- introspectTables(config)
- introspectColumns(config)
- introspectKeysAndIndexes(config)
- introspectViews(config)
- introspectProcedures(config)
- introspectTriggers(config)
- profileTables(config)
- inferRelationships(config)
- ingestWorkloadLogs(optional)
- emitCandidates()
- emitFindings()
- close()
```

Engine keys: `sybase`, `postgres`.

### 2. DB connection/config DTOs

Discovery run DB config: dbEngine, host, port, databaseName, catalogName?, schemaName/ownerName?, username, password, connectionOptions?, includeSchemas?, excludeSchemas?, includeTables?, excludeTables?, profilingMode, maxTablesToProfile, maxRowsPerProfileQuery, queryTimeoutSeconds, allowWorkloadLogUpload.

Profiling modes: `none`, `basic`, `standard`, `deep`. V1 default: `standard`; require user confirmation before `deep`.

### 3. Secret handling

- Do NOT persist raw DB password in AMS.
- Keep secrets in discovery-service memory for the run.
- Persist only redacted connection metadata.
- Redact credentials from logs and diagnostics.
- If existing discovery run config snapshots persist secrets, update to redact DB secrets.

### 4. Read-only enforcement

- DB credentials should be read-only.
- Service must enforce read-only query guard.
- Only SELECT/system-catalog queries allowed.
- Block INSERT, UPDATE, DELETE, MERGE, DROP, ALTER, TRUNCATE, CREATE, EXEC, CALL, stored procedure execution, multi-statement SQL.
- Apply query timeouts, row limits.
- Avoid full table scans where possible unless profiling mode allows and user confirmed.

### 5. DB evidence model

Reuse DiscoveryEvidence. Evidence types: `db_schema_metadata`, `db_table_metadata`, `db_column_metadata`, `db_index_metadata`, `db_constraint_metadata`, `db_view_definition`, `db_procedure_definition`, `db_trigger_definition`, `db_profile_summary`, `db_relationship_inference`, `db_data_quality_check`, `db_sample_value`, `db_workload_log`, `db_query_usage`, `db_migration_risk`. Evidence data structured JSON, not only text.

---

## Sybase discovery pack requirements

Pack name: `SybaseDatabaseDiscoveryPack`. Engine: Sybase ASE.

**Connection:** safe maintainable driver; if Node support is limited, encapsulate driver access behind the database pack abstraction; do not leak driver-specific logic outside the Sybase pack.

### Deterministic introspection

1. **Schemas/owners**: database name, owner/schema names, table counts, object counts.
2. **Tables**: table name, owner/schema, type, description/comments, row count estimate or exact, creation/update metadata. Candidate: `physical_data_entity`.
3. **Columns**: table, column name, data type, length, precision/scale, nullable, default, identity/autoincrement, ordinal position, comments. Candidate: `physical_data_attribute`.
4. **Keys, indexes, constraints**: PKs, unique constraints, indexes, FKs if declared, check/default constraints, clustered/non-clustered. Findings: `missing_primary_key`, `no_foreign_keys_declared`, `high_index_count`, `no_index_on_likely_fk`, `composite_key_migration_risk`.
5. **Relationship inference** (legacy Sybase often lacks FKs): column name similarity, PK/FK-like names, value overlap sampling where safe, index structure, code-discovered SQL relationships (later integration), naming conventions. Findings: `inferred_relationship`, `unenforced_relationship`, `ambiguous_relationship`, `orphaned_reference_risk`. Candidate: relationship candidate only if existing model supports it; otherwise keep as finding/evidence.
6. **Data profiling** (for selected tables/columns): row count, null count/rate, distinct count estimate or exact for small tables, min/max for numeric/date, top N for code-like columns, empty string counts, sample values for ID/code/date fields, potential sentinel values (`9999-12-31`, `-1`). Findings: `high_null_rate`, `sparse_column`, `unexpected_code_values`, `sentinel_value_detected`, `empty_table`, `large_table`, `high_cardinality_code_column`, `sample_data_hint`.
7. **Data quality checks**: duplicate key-like values, orphaned inferred references, invalid date ranges, unexpected nulls in likely required columns, inconsistent code values, possible encoding/truncation issues, records with missing parent/child relationships. Findings: `duplicate_business_key`, `orphaned_reference`, `invalid_date_value`, `unexpected_nulls`, `inconsistent_reference_data`, `migration_data_quality_risk`.
8. **Views**: view name, definition text (truncated/redacted), referenced tables if inferable, complexity indicators. Findings: `view_dependency`, `complex_view_logic`, `migration_risk`. Candidate: only if current meta-model has appropriate concept; otherwise finding/evidence.
9. **Stored procedures/functions**: procedure name, owner/schema, definition text (truncated/redacted), input/output parameters, referenced tables if inferable, called procedures if inferable, DML operations detected from definition text, transaction usage indicators. Findings: `stored_procedure_logic`, `procedure_data_write`, `procedure_dependency`, `hidden_business_logic`, `migration_risk`. Candidate: `business_logic` where appropriate; `data_movement` candidate if procedure clearly moves data; NOT method/class candidate unless tied to code discovery.
10. **Triggers**: trigger name, table, trigger event, definition text (truncated/redacted), affected tables if inferable. Findings: `trigger_side_effect`, `hidden_business_logic`, `migration_risk`, `data_integrity_logic_in_trigger`.
11. **DB logs/workload (optional)**: ingest query/SP execution logs, identify frequently used tables/procedures, slow/error-prone queries, migration-critical tables, correlate workload with discovered schema objects. Findings: `high_usage_table`, `high_usage_procedure`, `slow_query_hotspot`, `workload_migration_risk`, `unused_table_candidate`.

---

## PostgreSQL discovery pack requirements

Pack name: `PostgresDatabaseDiscoveryPack`. Engine: PostgreSQL. Reuse as much framework code as possible from Sybase pack.

### Deterministic introspection

1. **Schemas**: from `information_schema` and `pg_catalog`.
2. **Tables**: physical_data_entity candidates.
3. **Columns**: physical_data_attribute candidates.
4. **Keys, constraints, indexes**: use `information_schema` and `pg_catalog`.
5. **Relationships**: declared FKs plus inferred where missing.
6. **Data profiling**: same categories as Sybase.
7. **Views/materialized views**: capture definitions and dependencies.
8. **Functions/procedures/triggers**: function/procedure metadata, language, arguments, return type, definition where accessible/safe, trigger associations. Findings: `stored_procedure_logic`, `trigger_side_effect`, `hidden_business_logic`, `migration_risk`, `function_dependency`.
9. **Optional logs/workload**: future-compatible input if provided.

---

## Architecture candidate requirements

Candidate types: `physical_data_entity`, `physical_data_attribute`, `logical_data_entity` (only if confidently inferred or LLM-enriched and marked proposed), `logical_data_attribute` (same), `data_store_instance` (if model supports and connection metadata is enough), `business_logic` (for stored procedures/triggers/functions with business logic), `data_movement` (where procedure/view/job evidence supports), relationship candidates (if existing discovery relationship model supports).

Candidate data: dbEngine, databaseName, schemaName/ownerName, objectName, objectType, sourceEvidenceIds, confidence, profilingSummaryId/evidenceId.

Save-back: existing candidate review/save-back flow must work. User can save physical data entities/attributes into Current State Architecture. Findings remain available even if candidate is not saved.

---

## Discovery Finding requirements

Database packs must emit findings via FindingEmitter.

### Required finding types

**Schema/structure**: `missing_primary_key`, `no_foreign_keys_declared`, `inferred_relationship`, `unenforced_relationship`, `ambiguous_relationship`, `large_table`, `empty_table`, `sparse_column`.

**Data profile/data quality**: `high_null_rate`, `unexpected_nulls`, `duplicate_business_key`, `orphaned_reference`, `unexpected_code_values`, `sentinel_value_detected`, `invalid_date_value`, `inconsistent_reference_data`, `migration_data_quality_risk`.

**Procedural/business logic**: `stored_procedure_logic`, `procedure_data_write`, `procedure_dependency`, `trigger_side_effect`, `hidden_business_logic`, `complex_view_logic`.

**Workload/log**: `high_usage_table`, `high_usage_procedure`, `slow_query_hotspot`, `workload_migration_risk`, `unused_table_candidate`.

**Testing/reconciliation**: `sample_data_hint`, `reconciliation_hint`, `api_test_data_candidate`.

**General**: `db_discovery_evidence_gap`, `unsupported_db_feature`, `db_pack_warning`.

### Categories

`architecture`, `migration_risk`, `data_quality`, `business_logic`, `runtime_usage`, `performance`, `testability`, `reconciliation`, `sample_data`, `ambiguity`, `evidence_gap`, `unsupported_pattern`.

### Severity guidance

- **info**: sample values, ordinary profile summaries, declared schema observations
- **low**: minor evidence gaps, small sparse/empty tables
- **medium**: inferred relationships, high null rates, unexpected code values, stored procedure references
- **high**: orphaned references, duplicate business keys, major stored procedure/trigger business logic, large high-risk tables, heavy workload hotspots
- **critical**: only for proven migration blockers; avoid overuse

### Finding links

Link to DB evidence records, physical entity/attribute candidates, relationship candidates/evidence, decision tasks if user decision required.

---

## LLM enrichment requirements

LLM enrichment is optional but supported after deterministic DB evidence exists. **LLM must not invent database facts.**

LLM can: summarise migration risks, group tables into likely data domains, suggest logical data entity names, interpret stored procedure purpose from deterministic text/evidence, propose reconciliation hints, identify open questions, identify sample-data scenarios for API baseline capture, prioritise findings for review.

LLM cannot: execute SQL directly, mutate DB, replace deterministic profiling, mark findings confirmed without user review, fabricate row counts/constraints/object definitions.

Enriched findings: `source='db-llm-enrichment'`, `createdByStage='llm_db_enrichment'`, links back to deterministic evidence/findings, `status='new'` or `'needs_review'`, confidence < 1 unless directly supported.

---

## Decision tasks

Create DiscoveryDecisionTasks where user input is required. Examples: confirm inferred relationship between `ORDER.CUST_ID` and `CUSTOMER.CUST_ID`; confirm whether `sp_calculate_risk` is business logic to preserve; confirm whether `LEGACY_TMP_CUSTOMER` is in migration scope; confirm interpretation of code value `X` in `CUSTOMER_STATUS`; confirm whether high-null `EMAIL` should be migrated or cleansed.

Each decision task links to finding, evidence, candidate if relevant.

---

## Frontend requirements

### 1. Discovery run setup

Add discovery source/mode option: Code repository discovery, Database discovery, Combined (future). For database: DB engine (Sybase/PostgreSQL), connection fields, schema/table filters, profiling mode, optional logs/workload upload, read-only confirmation, test connection button.

### 2. DB discovery run detail

Use existing Discovery Run Detail but add DB-specific tabs/sections if helpful: Architecture Candidates, Findings, Evidence, Data Profile, Relationships, Stored Procedures & DB Logic, Samples, Decision Tasks. If adding tabs is too large, ensure Findings and Evidence tabs can display DB findings clearly.

### 3. Data Profile view

Minimum v1: table profile summary, row count, column count, key/index summary, high-risk finding count, top findings per table. Nice-to-have: per-column profile details, top values, null rates, sample values.

### 4. Relationship inference view

Show: source table/column, target table/column, confidence, reason, declared vs inferred, user actions (accept finding, ignore, needs review).

### 5. Stored procedure/view/trigger review

Show: object name, object type, referenced tables, detected writes, migration risk findings, truncated definition preview if safe, link to evidence.

### 6. Findings review

Existing Findings UI should support DB finding labels and detail_json. Add labels for: `missing_primary_key`, `no_foreign_keys_declared`, `inferred_relationship`, `unenforced_relationship`, `high_null_rate`, `duplicate_business_key`, `orphaned_reference`, `unexpected_code_values`, `stored_procedure_logic`, `trigger_side_effect`, `hidden_business_logic`, `sample_data_hint`, `reconciliation_hint`, `api_test_data_candidate`.

### 7. Candidate review

Physical data entity/attribute candidates should appear in existing candidate review and save-back flow.

---

## Gateway requirements

If discovery routes are proxied by gateway, add/adjust proxy coverage for: starting DB discovery run, testing DB connection (if routed through discovery-service), fetching DB profile/evidence summaries if new endpoints added, uploading optional DB logs/workload files (if v1). Gateway should NOT own DB discovery logic.

---

## Discovery-service implementation requirements

1. **DB discovery route/actions**: POST/GET routes under `/discovery/projects/{projectId}/architectures/{architectureId}/database/...` OR integrate into existing run-creation routes with mode/source = database.
2. **DB discovery config snapshot**: persist redacted config (engine, host display-safe, databaseName, schema filters, table filters, profilingMode, workloadLogProvided; NO raw password).
3. **DB adapters**: shared interface `DbDiscoveryAdapter`; implement `SybaseDiscoveryAdapter`, `PostgresDiscoveryAdapter`.
4. **SQL guard**: allow SELECT only, block multi-statement, enforce timeout, enforce max rows, log query category not full sensitive query.
5. **Profiler**: shared profiler computes row count, null rates, distinct counts, min/max, top values, sample values, basic data quality indicators; uses DB-specific SQL where needed.
6. **Relationship inference module**: inputs (declared constraints, column names, indexes, sample value overlap where safe, naming conventions); outputs (relationship evidence, relationship findings, optional relationship candidates).
7. **DB object dependency analyzer**: for views/procedures/triggers — extract referenced table names where possible, identify DML operations, identify called procedures/functions, emit evidence/findings. Start simple with text parsing; improve later.
8. **Workload/log parser hooks** (V1 optional): support uploaded text/CSV logs if simple, parse table/procedure/query mentions, emit workload findings. If too much, create clear extension points and only store uploaded workload evidence as discovery evidence.
9. **Finding emission**: use FindingEmitter for all DB findings.
10. **Candidate emission**: use existing discovery candidate pipeline where possible.

---

## Testing requirements (~46 tests)

### Sybase pack tests
1. Connects using read-only/test adapter or mocked Sybase connection.
2-5. Introspects schemas, tables, columns, indexes/keys/constraints.
6-7. Emits `physical_data_entity` + `physical_data_attribute` candidates.
8-9. Emits `missing_primary_key` + `no_foreign_keys_declared` findings.
10. Infers relationship from naming/value overlap; emits `inferred_relationship`.
11-13. Profiles row counts/null rates/top values; emits `high_null_rate` + `unexpected_code_values`/`sample_data_hint`.
14-15. Detects stored procedure + trigger; emits `stored_procedure_logic` + `trigger_side_effect`.
16-17. Blocks non-SELECT SQL; applies query timeout + row limit.

### PostgreSQL pack tests
18-24. Introspects schemas/tables/columns/keys; emits physical candidates; profiles; emits DB findings; detects functions/triggers/views.

### Shared DB discovery tests
25-26. DB run persists redacted config only; raw password not persisted.
27-29. FindingEmitter used; candidate + finding both happen in same run; findings link to DB evidence.
30. Decision task created for ambiguous inferred relationship.
31. Run continues when profiling one table fails; emits warning/finding.
32. Deep profiling requires explicit config.
33. Table/schema allowlist limits discovery scope.
34. Existing code discovery runs still work.

### Frontend tests
35-39. DB setup UI renders; Sybase + Postgres options available; read-only confirmation required; schema/table filters; profiling mode selection.
40-44. DB findings render in Findings tab; physical candidates in candidate review; data profile summaries; SP/trigger detail view; relationship inference review.

### Gateway tests (if routes added)
45-46. DB discovery start + connection test routes proxy correctly.

### AMS tests
Only add if new candidate/finding fields or DTO support is required beyond existing generic persistence.

---

## Acceptance criteria (19 items)

1. User can start a database discovery run for a Current State Architecture.
2. User can select Sybase or PostgreSQL as the DB engine.
3. Database discovery uses read-only connection details and never mutates the database.
4. Raw DB passwords/secrets are not persisted.
5. Sybase pack can discover schema/table/column metadata.
6. PostgreSQL pack can discover schema/table/column metadata.
7. Database packs emit physical data entity and physical data attribute candidates.
8. Database packs emit Discovery Evidence for DB metadata/profiling/dependencies.
9. Database packs emit Discovery Findings for migration-relevant DB intelligence.
10. Database packs can profile selected tables/columns according to configured profiling mode.
11. Database packs can infer likely relationships where declared constraints are absent.
12. Stored procedures/views/triggers are discovered where supported and represented as findings/evidence, with candidates only where the architecture model supports them.
13. Optional DB logs/workload evidence can be ingested or at least represented through extension-ready evidence handling.
14. DB findings are visible and reviewable in the Discovery Run Detail UI.
15. Physical data candidates can be reviewed and saved to Current State Architecture.
16. Findings do not pollute the architecture model.
17. LLM enrichment, if used, only enriches deterministic DB facts and links back to evidence.
18. Existing code discovery continues to work.
19. The output is suitable as future input to migration planning and API/database reconciliation work.

---

## Implementation notes

- Prioritise Sybase because the target migration pattern is older Sybase on-prem to modern PostgreSQL/cloud.
- Implement PostgreSQL using the same pack abstraction so it proves portability.
- Keep deterministic database facts separate from LLM interpretation.
- Keep profiling bounded and configurable.
- Use evidence/finding links aggressively so users can understand why a risk was raised.
- Avoid flooding the UI with low-value per-column findings; aggregate where useful.
- Prefer "finding plus evidence" for migration intelligence that does not belong in the architecture model.
- Use detail_json for DB-specific payloads rather than adding many columns.
- Make all DB discovery code safe by default.
- This spec should materially improve the ability to later generate an accurate hierarchical migration book of work.

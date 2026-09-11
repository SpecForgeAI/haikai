# Migration Discovery Diagnostic Runbook

**Purpose:** when you run the discovery / API baseline / migration-context flow on a real Java 8 / Spring Classic / Maven service + Sybase ASE database on your work machine, capture the behavioural signals below and send them back. No data values needed — only counts, timings, error categories, and pass/fail outcomes.

**Scope:** this runbook covers everything we built in the 2026-05-16 session:
- Discovery Findings/Evidence platform
- Java / Spring Classic / Maven pack-emitted findings
- PostgreSQL + Sybase database discovery packs (Sybase via JVM/JDBC sidecar)
- API Behaviour Baseline Capture (with discovery context injection)
- Migration Discovery Context aggregation

---

## How to use this runbook

1. Pause any active discovery runs before pulling latest code (`feedback_no_src_edits_during_run.md` — tsx watch reload kills runs).
2. Pull / build the four services + sidecar.
3. Walk each scenario below.
4. For each numbered question, paste back the **counts / timings / pass-fail / error category**. Skip anything you can't observe.
5. If a step fails or behaves oddly, copy the **log line that mentions `[diag]`** — those are the structured diagnostic markers added for this purpose.

**What NOT to share back:**
- Actual table/column/schema names
- Actual code snippets, SQL bodies, URL values, dependency coordinates
- Anything customer- or business-identifiable
- Connection credentials (obviously)

**What IS useful to share back:**
- Counts (X tables scanned, Y findings emitted, Z soft-fails)
- Timings (introspection took N seconds, sidecar query took N ms)
- Error categories ("got 404 from AMS", "JDBC connect timed out", "tsc error in file X")
- Pass/fail outcomes per scenario
- The `[diag]` log lines (already redacted-by-design)

---

## Scenario 0 — Pre-flight (5 min)

Before any discovery work, confirm the stack starts cleanly.

| # | Check | What to report |
|---|---|---|
| 0.1 | `architecture-model-service` starts; Liquibase applies through changeset **137** without error | pass / fail; if fail, which changeset; mention any `[diag-ams]` line in startup |
| 0.2 | `discovery-service` starts; `tsx --watch` loads without TS errors | pass / fail; tsc error count if any |
| 0.3 | `gateway` starts | pass / fail |
| 0.4 | `frontend` builds + serves | pass / fail |
| 0.5 | `sybase-discovery-sidecar` builds with `mvn package` | pass / fail |
| 0.6 | `sybase-discovery-sidecar` starts on its port (default 8093); `GET /` or health endpoint responds | pass / fail; startup time |
| 0.7 | `discovery-service` + `api-migration-validation-service` env var `DB_SIDECAR_URL` set (the pre-rename `SYBASE_SIDECAR_URL` is honoured as an alias); services log that they found it | pass / fail; value (host:port only is fine) |

---

## Scenario 1 — Code discovery on the Java/Spring/Maven service (20 min)

Start a fresh **code-kind discovery run** against your legacy service repo.

### 1.A — Run completion

| # | Check | What to report |
|---|---|---|
| 1.1 | Run started without crash | pass / fail; if fail, error category |
| 1.2 | Run reached `COMPLETED` status (not `FAILED`) | pass / fail; final status |
| 1.3 | Total run wall-clock time | seconds |
| 1.4 | Number of files scanned (look for `[diag-scan] files=N`) | N |
| 1.5 | Any unhandled exceptions in the discovery-service log | count + error category |

### 1.B — Pack-emitted findings (counts only, no values)

Look at the AMS `discovery_findings` table or the frontend Findings tab. Filter by `run_id` of this run.

| # | Finding source | Count by severity (info/low/med/high/critical) | Notes |
|---|---|---|---|
| 1.6 | `java-language-pack` | | |
| 1.7 | `spring-classic-framework-pack` | | |
| 1.8 | `maven-dependency-pack` | | |
| 1.9 | All `evidence_gap` findings | | per `gapType` if visible |

### 1.C — Specific high-signal categories

| # | Finding type | Did any fire? (yes/no/count) | Looks plausible? (y/n) |
|---|---|---|---|
| 1.10 | `raw_sql_detected` | | |
| 1.11 | `hardcoded_endpoint_or_url` | | |
| 1.12 | `legacy_java_api_usage` | | |
| 1.13 | `spring_xml_bean_wiring` | | |
| 1.14 | `legacy_transaction_configuration` | | |
| 1.15 | `security_filter_or_interceptor_detected` | | |
| 1.16 | `scheduled_or_batch_job_detected` | | |
| 1.17 | `stored_procedure_or_jdbc_usage` (in Java code) | | |
| 1.18 | `spring_classic_migration_risk` | | |
| 1.19 | `java_version_detected` | | matches actual? y/n |
| 1.20 | `spring_version_detected` | | matches actual? y/n |
| 1.21 | `risky_dependency` | | how many matches against our 26-rule seed list? |
| 1.22 | `database_driver_detected` | | did it correctly identify Sybase jconn / jTDS? y/n |
| 1.23 | `maven_build_plugin_risk` | | |
| 1.24 | `dependency_version_conflict` | | |
| 1.25 | `test_build_gap` | | |

### 1.D — Architecture candidates

| # | Check | What to report |
|---|---|---|
| 1.26 | Candidate counts by type (application / service / interface / endpoint / class / method / etc.) | per-type counts |
| 1.27 | Did the candidate review UI render those candidates? | pass / fail |
| 1.28 | Did "save approved candidates" successfully write to the architecture model? | pass / fail |

### 1.E — Quality signal (subjective; one line is fine)

- **Did the findings look migration-relevant or noisy?** Quick gut check — e.g. "raw_sql findings hit our DAO classes correctly", "hardcoded URL findings included lots of false positives from log strings", "Spring XML wiring found the right files".

---

## Scenario 2 — Database discovery on Sybase (30 min)

Start a fresh **database-kind discovery run** against your Sybase ASE instance, using a read-only account.

### 2.A — Connection + sidecar

| # | Check | What to report |
|---|---|---|
| 2.1 | Frontend Source toggle shows `Database`; engine dropdown shows both `PostgreSQL` and `Sybase ASE` | pass / fail |
| 2.2 | "Test Connection" button in the wizard succeeded | pass / fail; latency in ms; sidecar response status |
| 2.3 | Sidecar logged the test-connection request (`[diag-sidecar] op=test_connection`) | pass / fail; password masked? y/n |
| 2.4 | `discovery_kind='database'` made it to the `runs` route handler (the hot-fix we applied) and on to `startDatabaseRun` | pass / fail; check for `[diag-runs] discoveryKind=database` log |

### 2.B — Introspection counts

| # | Stage | Count | Time (s) | Soft-fails |
|---|---|---|---|---|
| 2.5 | Schemas/owners | | | |
| 2.6 | Tables | | | |
| 2.7 | Columns (total across all tables) | | | |
| 2.8 | Keys + indexes | | | |
| 2.9 | Views | | | |
| 2.10 | Procedures | | | |
| 2.11 | Triggers | | | |

Look for `[diag-pack] sybase stage=<name> count=<N> elapsed_ms=<M>` log lines.

### 2.C — Profiling

| # | Check | What to report |
|---|---|---|
| 2.12 | Profiling mode used | none / basic / standard / deep |
| 2.13 | Number of tables profiled successfully | N |
| 2.14 | Number of tables that soft-failed during profiling | N (per-table soft-fail count from `[diag-pack] sybase profile soft_fail=`) |
| 2.15 | Slowest profile query observed | ms (if logged) |
| 2.16 | Did the SELECT-only guard reject anything at the sidecar layer? (it shouldn't normally) | yes/no; if yes, category |

### 2.D — Findings emitted by DB pack

| # | Finding type | Count |
|---|---|---|
| 2.17 | `missing_primary_key` | |
| 2.18 | `no_foreign_keys_declared` | |
| 2.19 | `inferred_relationship` | |
| 2.20 | `unenforced_relationship` | |
| 2.21 | `ambiguous_relationship` | |
| 2.22 | `large_table` | |
| 2.23 | `empty_table` | |
| 2.24 | `sparse_column` | |
| 2.25 | `high_null_rate` | |
| 2.26 | `unexpected_nulls` | |
| 2.27 | `duplicate_business_key` | (note: v1 deliberately skips emission; should be 0) |
| 2.28 | `orphaned_reference` | |
| 2.29 | `unexpected_code_values` | |
| 2.30 | `sentinel_value_detected` | |
| 2.31 | `invalid_date_value` | |
| 2.32 | `migration_data_quality_risk` | |
| 2.33 | `stored_procedure_logic` | |
| 2.34 | `procedure_data_write` | |
| 2.35 | `trigger_side_effect` | |
| 2.36 | `hidden_business_logic` | (with `sourceObjectType` = trigger or procedure) |
| 2.37 | `db_migration_risk` (consumes view_dependency, complex_view_logic, generic) | |
| 2.38 | `sample_data_hint` | |
| 2.39 | `unsupported_db_feature` | |
| 2.40 | `db_pack_warning` | |
| 2.41 | `evidence_gap` with `gapType` starting `db_` | |

### 2.E — Candidates

| # | Check | What to report |
|---|---|---|
| 2.42 | `physical_data_entity` candidates emitted | N (should ≈ table count) |
| 2.43 | `physical_data_attribute` candidates emitted | N (should ≈ total columns) |
| 2.44 | Candidate review UI shows them with a `kind` badge for `database` | pass / fail |
| 2.45 | Saving approved candidates wrote `physical_data_entity` / `physical_data_attribute` rows | pass / fail |
| 2.46 | AppShell cache was invalidated after save-back so new entities appeared in current view | pass / fail |

### 2.F — Sidecar health

| # | Check | What to report |
|---|---|---|
| 2.47 | Total sidecar HTTP requests during the run | N |
| 2.48 | Sidecar error rate | non-2xx count / total |
| 2.49 | Any 5xx from sidecar | category (timeout / driver error / sql guard reject / other) |
| 2.50 | Did the sidecar log any masked-password lines? | pass / fail |
| 2.51 | Sidecar peak memory (if observable) | MB |

### 2.G — Quality signal

- **Did the DB findings look migration-relevant or noisy?** e.g. "missing_primary_key correctly fired on temp/staging tables", "inferred_relationship caught the obvious *_id naming convention", "stored procedure findings caught most of our actual SP usage".

---

## Scenario 3 — API Behaviour Baseline capture (40 min, optional)

Only run this if you have a non-prod API to point at AND an OAS spec for it. This is the heaviest scenario and uses the LLM.

| # | Check | What to report |
|---|---|---|
| 3.1 | Capture wizard opens; discovery context section appears on step 1 | pass / fail |
| 3.2 | Discovery context auto-expands if findings exist for current architecture | pass / fail |
| 3.3 | Latest completed run pre-selected in the run selector | pass / fail |
| 3.4 | Finding summary panel shows non-zero counts | pass / fail |
| 3.5 | Test Connection against your API succeeded | pass / fail; HTTP status seen |
| 3.6 | Capture started; LLM loop emitted scenarios | pass / fail; scenarios count |
| 3.7 | Captures persisted in AMS (`api_behaviour_captures`) — count | N |
| 3.8 | `attempt_number` values look correct (1, 2, 3 per scenario; not all 1) | pass / fail |
| 3.9 | Mutating-call gate behaved as expected (POST blocked when not confirmed) | pass / fail |
| 3.10 | Migration discovery context was fetched at `/start` — check log `[diag-amvs] context_fetched=...` | pass / fail; or `context_unavailable` |
| 3.11 | If `context_unavailable`: capture still ran and finished | pass / fail |
| 3.12 | Capture review UI shows discovery annotations (runtime-usage badge, sample-data badge, etc.) | which annotations appeared? |
| 3.13 | Save baseline succeeded; baseline items persisted | pass / fail; item count |

---

## Scenario 4 — Migration Discovery Context aggregation (10 min)

Even without running a full capture, you can exercise the aggregation endpoint directly.

| # | Check | What to report |
|---|---|---|
| 4.1 | Hit `POST /api/v1/projects/{projectId}/migration-discovery-context` with `{ currentArchitectureId: "..." }` via curl or the frontend network tab | HTTP status; response time |
| 4.2 | Response includes `findingsSummary`, `highPriorityFindings`, `readinessAssessment` | pass / fail |
| 4.3 | `readinessAssessment.overallStatus` value | sufficient / partial / insufficient |
| 4.4 | `readinessAssessment.gaps` array contains expected codes given your project state | pass / fail; list of gap codes |
| 4.5 | Response size respects `maxFindings: 100` / `maxEvidenceItems: 100` | pass / fail |
| 4.6 | Did the gateway-side resolver `migration-discovery-context` produce a bounded prompt-ready string? (test via gateway resolver registry tooling if exposed) | pass / fail; approx char count |

---

## Scenario 5 — Cross-cutting observations

Things I'd particularly like to know:

| # | Observation | What to report |
|---|---|---|
| 5.1 | Total findings persisted across all packs after a full code+DB session | N |
| 5.2 | Findings deduplicated (emitted count vs persisted count gap) | gap if any (look for `[diag-emitter] deduped=N` line) |
| 5.3 | Largest single AMS POST payload during the run | KB |
| 5.4 | Number of `MAX_FINDINGS_PER_TYPE_PER_RUN=50` cap hits per pack | per-pack counts |
| 5.5 | Discovery run total time vs your subjective expectation | actual / expected |
| 5.6 | Frontend responsiveness during a large findings list (>500 findings) | smooth / sluggish / broken |
| 5.7 | Any browser console errors | count + category |
| 5.8 | Any tsc errors on `npx tsc --noEmit` in `discovery-service` after a fresh pull | count + filenames |
| 5.9 | Any tsc errors in `gateway` | count + filenames |
| 5.10 | Any tsc errors in `frontend` related to NEW files from this session (`findingsApi.ts`, `migrationDiscoveryContextApi.ts`, scanner-related files) | count + filenames |

---

## What I'd most like a one-line gut check on

After you've run the scenarios:

1. **Did discovery actually understand the service?** — would you say the candidates + findings represent ~50%, ~75%, ~90% of what a human reviewer would catch?
2. **Did DB discovery actually understand the database?** — same gut-percentage.
3. **What's the single biggest false-positive category?** — one line.
4. **What's the single biggest miss?** — one line.
5. **What's the most useful finding you saw?** — one line, no specifics.
6. **Anything crashed / hung / silently produced nothing?** — yes/no per area.

---

## Diagnostic log markers

After the logging-additions commit lands, look for these structured log prefixes:

| Prefix | Service | Meaning |
|---|---|---|
| `[diag-ams]` | architecture-model-service | AMS startup + endpoint timing |
| `[diag-emitter]` | discovery-service | FindingEmitter persistence + dedupe |
| `[diag-pack]` | discovery-service | Per-pack stage timings + counts |
| `[diag-scan]` | discovery-service | File scan stats |
| `[diag-runs]` | discovery-service | Run dispatch (code vs database) |
| `[diag-sidecar]` | sybase-discovery-sidecar | Sidecar request/response (password masked) |
| `[diag-amvs]` | api-migration-validation-service | Context fetch + capture loop boundaries |
| `[diag-gw]` | gateway | Proxy forwarding |

Each line includes structured key=value pairs; values are counts/timings/categories only — never raw data, never credentials.

---

## Reporting format

Send back a single message structured like:

```
Scenario 0: 0.1 pass, 0.2 pass, 0.3 pass, 0.4 pass, 0.5 pass, 0.6 pass (1.2s), 0.7 pass
Scenario 1.A: 1.1 pass, 1.2 pass COMPLETED, 1.3 47s, 1.4 1,832 files, 1.5 0 unhandled
Scenario 1.B: java-language-pack: info=2 low=14 med=23 high=0 crit=0; spring-classic: low=1 med=18 high=3; maven: info=1 med=6 high=2; evidence_gap: 7 (mostly java_class_no_methods)
Scenario 1.C: 1.10 yes(31), 1.11 yes(12), 1.12 yes(8), ... [continue in any compact form]
...
Gut check:
- Discovery service coverage: ~70%
- DB coverage: ~80%
- Biggest false positive: hardcoded_endpoint_or_url on log message strings
- Biggest miss: business-logic in a Quartz job class wasn't flagged
- Most useful: stored_procedure_logic correctly tied SPs to their caller classes
- Crashes: none
```

Skip anything you can't observe — partial signal is fine. The structured `[diag]` log lines I can read back without you having to manually transcribe counts.

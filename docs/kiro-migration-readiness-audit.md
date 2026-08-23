# Migration Readiness Audit — Brief for the Estate Assistant ("Kiro")

You are auditing a specific legacy application (below: **APP** — substitute the
real name locally; never echo real org/package/host identifiers into any file
that will be committed to this tool repo) against the **Haikai** migration
tool's end-to-end workflow. You have what Haikai's static pipeline does not:
the full APP source tree, the LIVE running service, and the LIVE database.

Your deliverable: a findings register answering one question — **given this
specific application, what will make the migration not work, degrade, or
require a human decision — at EVERY step of the workflow?**

Ground rules:

- **READ-ONLY** against live systems. Catalog queries and HTTP GETs only.
  Never write to the live DB, never call mutating endpoints.
- Cite evidence as `file:line`, a catalog query result, or an observed HTTP
  response — no unverified claims.
- Keep the summary register compact (one screen); details per finding below it.
- You already produced per-endpoint chain traces and per-table reverse traces.
  **Reuse them** — do not re-derive what you have already proven.

---

## Part 1 — The Haikai workflow, stage by stage

Audit against what each stage CONSUMES and ASSUMES.

### Stage 1 — Database discovery scan
Connects to the live DB catalog; emits table/column/constraint candidates
(PKs, unique indexes, FKs, types) and findings. A **Foundations review** then
asks estate-triage questions (backup/temp table exclusions, keyless-table
policy, PK promotion from unique indexes, legacy-type hazards); answers become
durable model decisions (scope tags, key policies) that every later stage
cites. Assumes: one database, one schema of interest; catalog access rights.

### Stage 2 — Code discovery scan
Slices the Java tree into a behaviour corpus: endpoint roots (JAX-RS/Spring
annotations, any verb), internal roots (main(), @Scheduled, listeners,
XML-declared processes), call-graph walks to DAO boundaries, verbatim SQL
mining (inline, constants, cross-class constants, concatenations,
interface→impl, case-insensitive `dao|repository` suffixes), Guava
LoadingCache transparency (constructor-built anonymous CacheLoader bridged),
known-class dispatch fan-out up to 40 implementations, stored-proc bodies
harvested from repo `.sql` files (nested `exec` closed transitively),
config-held SQL from referenced field initializers. Emits read/write effect
edges per endpoint (`via_legacy_cache` tagged). Joint foundations questions
follow (tables never touched, write-only sinks, read-only reference data,
scope conflicts, target caching strategy).

### Stage 3 — API baseline capture (against the LIVE legacy service)
Fires every in-scope endpoint to capture request/response baselines:
happy-path closure per endpoint (DB-mined ids → LLM repair → Postman
round-trip), per-format variants (JSON and XML captured separately),
scenario variations, SSO/auth token handling (pauses on auth expiry).
**Write scenarios run inside compensation brackets**: the effect map (from
Stage 2) names the tables a scenario may touch; each is diffed PK-keyed and
undone. Keyless-policy tables run count-only detection. An **S0 snapshot**
(full dump + per-table fingerprint) pins the database state first; the
end-of-job fingerprint must match (volatile tables tolerated). Assumes: the
service is reachable and quiet (no concurrent writers), the DB user can dump
AND restore, effect maps are complete for every write path capture will fire.

### Stage 4 — Target-state decisions & migration plan
Target stack decisions (language/framework/DB versions, vuln reduction),
plan generation with readiness preflight, books of work split into a service
plane and a DB plane, deterministic scaffold story.

### Stage 5 — Spec generation
Specs are carried DETERMINISTICALLY from the corpus (behaviour rows verbatim
with citations; legacy cache mechanics normalized to "data effect is the
requirement"); TDD acceptance criteria; DB-plane review specs.

### Stage 6 — DB migration pack
Schema translation (legacy engine → PostgreSQL types, check-expression
translation, quoted-case DDL), full data movement (keyset-paginated bulk
load), surrogate PKs for keyless-policy tables, scope receipt (excluded
tables dropped with their attributes), incremental sync family, drift check.
Assumes: every in-scope table has usable identity (declared, promoted, or
surrogate-policy), types are mappable, data fits the paginated reader.

### Stage 7 — Execution & verification
The implementer service builds the target Spring Boot app from specs on
chained run branches (boot acceptance gates); the DB plane chains schema
apply → data load → **reconcile parity** (PK-keyed row join, counts,
checksums per table). Behaviour verification replays the captured baseline
against the target and judges responses (both formats) plus DB effects.
Assumes: git hosting reachable, the captured baseline is complete and
correct, parity is decidable per table (needs keys), the target can be
booted and pointed at the migrated DB.

---

## Part 2 — The audit. Work through EVERY item.

For each item: verify against APP, classify (see Part 3), and cite evidence.

### A. Source completeness (feeds Stage 2)
1. Inventory every place application logic lives that is NOT walked Java:
   MyBatis/iBatis XML mappers, `.sql` scripts executed at runtime (not just
   CREATE PROC bodies), shell scripts that run SQL directly, reports, ETL
   definitions. Haikai harvests repo `CREATE PROC/FUNCTION` bodies — anything
   else SQL-bearing is a gap candidate.
2. **Live-vs-repo proc drift**: list procs/functions in the LIVE DB catalog
   and diff against repo `db/**/*.sql`. A proc that exists live but not in
   the repo (or differs) silently breaks effect maps and specs.
3. **Triggers**: list live triggers per in-scope table. Haikai does not
   expand trigger effects — any trigger that writes another table makes
   compensation diffs and parity see "unexplained" changes.
4. **Dynamic SQL from data**: procs or Java that assemble SQL from rows
   (validation-rule tables, query-definition tables). List which tables'
   effective read/write sets depend on DATA. These stay invisible; the
   question is whether any WRITE path depends on them.
5. Frameworks: confirm the endpoint surface is fully annotation-derived
   (JAX-RS/Spring). List any servlet-mapped, filter-served, SOAP, or
   reflection-dispatched endpoints the annotation pass would miss.
6. Cross-module wiring: Spring XML bean properties that carry SQL or table
   names into generic loaders (runtime-constructed statements). Confirm the
   affected tables are connected via some other path; if a table's ONLY
   writer is a config-driven loader, flag it.

### B. Database shape (feeds Stages 1, 6, 7)
1. **Cross-database references**: any query with a `<otherdb>.dbo.` prefix,
   linked servers, or replication INTO/OUT OF the in-scope database. Haikai
   migrates ONE database; every cross-DB edge is a cutover design question.
2. Which tables are populated by EXTERNAL systems (feeds, replication,
   DBA-run procs)? For each: what is the target-state feed plan? (The tool
   will correctly show them as "never touched by scanned code" — the
   decision, not the scan, owns them.)
3. Keyless tables (no PK, no non-null unique index): list them and confirm
   the foundations keyless policy (count-only compensation, surrogate on
   target) is acceptable per table — especially any that are LARGE or hot.
4. Legacy types in use (`money`, `text`, `image`, `unitext`,
   `smalldatetime`, user-defined types): list columns; any type NOT in that
   set that PostgreSQL lacks a direct mapping for.
5. Identity/sequence mechanics: identity columns, sequence tables,
   `max(id)+1` idioms, stored sequence functions. The target needs an
   explicit equivalent; note every generator idiom found.
6. Data volume + time: row counts for the biggest tables; estimate S0 dump
   and bulk-load duration. Anything that makes "dump, capture, restore"
   operationally implausible gets flagged with numbers.
7. Collation/encoding/timezone: case-sensitivity of the live server,
   non-ASCII data presence, how datetimes are stored vs. server TZ.

### C. Live service & capture feasibility (feeds Stage 3)
1. Auth: exactly how a capture client obtains and refreshes credentials;
   token lifetime vs. expected capture duration.
2. **Concurrent writers during capture**: the batch schedule (nightly jobs),
   scheduled in-app writers (audit flushers, cache refreshers), other
   consumers writing the same DB. The S0 fingerprint assumes a quiet system
   — name every writer and the safe capture window.
3. Endpoints that mutate on GET (audit inserts, last-accessed stamps):
   already derivable from effect edges — confirm the list and that each is
   either bracketed or tolerated (audit-sink policy).
4. Environment parity: is the capture environment's data representative
   (enough rows to mine ids for every endpoint)? List endpoints whose happy
   path needs data that environment lacks.
5. Multi-instance topology: if capture and traffic hit different nodes,
   node-local caches serve stale reads — confirm capture will target one
   quiet instance.
6. Statefulness beyond the DB: filesystem artifacts, FTP drops, MQ/JMS,
   email — anything a scenario touches that S0 restore does NOT reset.
7. Log-replay evidence: confirm the service log format is stable and which
   log file should seed runtime evidence (the induction can fail —
   note a known-good sample).

### D. Batch plane (feeds Stages 2, 4, 7)
1. Enumerate every scheduler entry (e.g. Autosys jil): job → script → Java
   main/proc → tables. Confirm each is represented in the corpus as an
   internal root (or flag it).
2. The feed-file contract (formats, arrival, filters): the target needs an
   equivalent ingest — is that in scope? If not, what keeps the migrated DB
   fed after cutover?
3. Manually-run procs that are load-bearing (one-off imports): who runs
   them, when, and what is the target equivalent?

### E. Migration execution & cutover (Stages 6-7)
1. Reconcile-parity decidability: for every in-scope table, is there a key
   (declared/promoted/surrogate) the PK-keyed parity join can use? List the
   exceptions.
2. Rows the legacy app treats as soft-versioned (bi-temporal
   ValidFrom/ValidTo close-outs): confirm parity semantics (row identity =
   PK incl. temporal columns) match how the app actually versions rows.
3. Cutover sequencing: while the legacy batch keeps running, the migrated
   DB drifts — confirm the incremental-sync / drift-check family covers the
   tables the batch writes, and name any it does not.
4. Anything (other app, report, extract) that READS this database besides
   APP: each is a consumer that must be repointed or fed post-cutover.

### F. Haikai's own workflow — sanity checks
From the Haikai clone (`discovery-service/`, `gateway/`,
`api-migration-validation-service/`, `mcp-server/`, `frontend/`,
`architecture-model-service/`), confirm your understanding of each stage
above matches the code (e.g. `discovery-service/src/scl/` for the corpus,
`api-migration-validation-service/src/services/` for capture/S0/compensation,
`gateway/src/services/dbMigrationPack/` for the pack). Where APP has an idiom
none of the handled idioms cover, say precisely which extractor/walker misses
it and why.

---

## Part 3 — Output format

Produce ONE summary table first (kept to one screen), then a detail section
per finding.

| ID | Stage | Severity | Class | One-line finding |
|----|-------|----------|-------|------------------|

- **Severity**: `BLOCKER` (migration step fails or silently lies) /
  `DEGRADED` (works with reduced fidelity) / `DECISION` (needs a human
  ruling, tool is fine) / `INFO`.
- **Class**: `HAIKAI-GAP` (the tool must change) / `ESTATE-QUIRK` (APP
  behaviour the tool handles but a human should know) / `DECISION-NEEDED`
  (route through the foundations/target-state decision flows) /
  `VERIFY-ONLY` (confirmed fine — say so explicitly; absence of a finding
  must be distinguishable from an unchecked item).

Each detail entry: evidence (`file:line` / query / response), why it breaks
or degrades WHICH workflow stage, and the smallest remedy (tool fix, recorded
decision, or manual preparation step) with a suggested owner.

Close with the two lists that matter most:
1. **"Will not work today"** — every BLOCKER, ordered by workflow stage.
2. **"Decide before capture"** — every DECISION, phrased as the question a
   human must answer.

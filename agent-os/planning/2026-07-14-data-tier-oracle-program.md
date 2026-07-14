# Data-Tier Oracle Program (2026-07-14) — Specs O–U

**Vision:** two migrations, one oracle. (A) The API like-for-like migration
(service + DB) gains the data tier it lacks — load reconciliation, DB coverage
accounting, divergence-driven capture — so behaviour breaks are attributable
and the DB surface is verified, not assumed. (B) The same investments compose
into a **DB-only migration** (same app build against source and target
engines), where the existing API replay + diff + state-delta machinery IS the
reconciliation instrument: identical code, two databases, any divergence is by
construction a database divergence. No new reconciliation engine is built.

## Architecture principle (locked 2026-07-14): two kinds of code, one kind of data

1. **Generic core (code)** — never names an engine. Comparator framework,
   gates, floors, coverage accounting, inventory, diff classification,
   replay, reports. Consumes dialect labels and divergence classes as opaque
   data.
2. **Engine pack (code)** — owns ONE engine: introspection SQL, row/checksum
   readers, dialect classifiers (source-specific classification is fine —
   it must LIVE in the pack). Scales linearly: one pack per engine.
3. **Migration-pair ruleset (data)** — a versioned repo file
   (`migration-pairs/<pair>.rules.json`) owning the pair's knowledge:
   divergence classes, equality/canonicalization rules (strategy + params),
   tolerances, rewrite guidance, scenario seed hints — with stable rule ids
   so diffs, judges and acceptance reports can CITE rules. A new migration
   pair costs authoring a document, not writing a codebase. Rules reference
   comparison STRATEGIES from a small generic library; a pair needing a new
   strategy adds it to the generic library under a neutral name.

Governance: an engine-name guard test (repo's anti-pattern-guard idiom) scans
the generic modules for engine tokens; existing leaks ride an explicit
shrinking allowlist (never `>= N` — exact counts). LLM prompts/templates are
exempt (prompt text is configuration; the model knows engines).

## User decisions (2026-07-14) — all four resolved, BUILD IS GO

1. **Ruleset home: repo file** (git-versioned, diffable; pair id + version
   stamped into the BOOT trace config headers). Not an AMS table.
2. **Data-parity gate: fail-closed in BOTH visions** (`data_parity_failed` /
   `data_parity_unverified` block execution; standard waiver path applies).
3. **Sampling defaults: assistant-picked, env-tunable** — per-table sampled
   row cap 1,000; hot tables (Spec S heat map) ×5; full-scan below 10,000
   rows; all overridable per run/env.
4. **Waves: wave 1 = O + Q (parallel) then P; CHECKPOINT** (fold in the
   first live judged run's findings); **wave 2 = R, S, T, U.**

## Specs

### Spec O — Migration-pair ruleset foundation (wave 1)
- **Generic:** rule schema + loader/validator (byte-identical copies in
  gateway / discovery-service / api-migration-validation-service, trace.ts
  pattern); strategy library v1: `timestamp-truncate`, `string-rtrim`,
  `numeric-rescale`, `numeric-epsilon`, `charset-normalize`,
  `collation-case`; `canonicalize`/`compareWithRules` helpers returning
  applied rule ids (citation model). Env: `MIGRATION_PAIR` (default
  `sybase15-postgres18`), `MIGRATION_PAIR_RULESET_PATH` override; loader
  walks up from cwd to find `migration-pairs/`, fail-soft to null.
- **Data:** `migration-pairs/sybase15-postgres18.rules.json` v1 — datetime
  1/300s + smalldatetime minute precision, char/varchar trailing-space
  semantics (also covers the Sybase `''`→`' '` insert quirk), money scale,
  float/real epsilon, bit nullability, tinyint range, text/image LOB
  mapping, CI-sort-order collation (disabled by default; enable per estate),
  identity-gap seed hint — plus `construct_refs` keyed to the existing
  sqlDialectClassifier construct ids (the classifier stays the DETECTOR —
  pack code; the ruleset owns pair guidance/seeds keyed by construct id).
- **Leak burn-down:** the spec-carriage dialect-guidance heading renders
  from the ruleset's `guidance_heading` (neutral fallback); SPEC.DIAL.01
  predicate updated to the same constant. The planner/AMS `tsql_dialect_sql`
  reason strings are WIRE VOCABULARY shared cross-service — allowlisted, not
  renamed (recorded follow-up).
- **Trace:** BOOT config headers gain `migration_pair`, `ruleset_version`,
  `rule_count` in all three Node services.
- **Verification:** loader/strategy/canonicalize jest tests; guard test
  green with exact allowlist counts; tsc ×3.

### Spec P — Data parity gate (wave 1, after O; the largest spec)
- **Generic (AMVS-hosted):** per-table reconciliation with escalation ladder
  (counts → checksums → typed sampled row diffs); per-table verdict
  `match | divergent | unverifiable(reason)`; run-level data-parity report
  persisted to AMS (NEW changeset); gate codes `data_parity_unverified` /
  `data_parity_failed` wired into the execution gates, waiver-able.
  Two-tier checksumming: engine-side hash for rule-free columns;
  client-side canonical hash (via Spec O rules) for rule-affected columns.
  Sampling knobs per decision 3 (`DATA_PARITY_SAMPLE_ROWS=1000`,
  `DATA_PARITY_FULLSCAN_MAX_ROWS=10000`, hot-multiplier ×5 once S exists).
- **Pack:** Sybase (sidecar) + Postgres row/checksum readers.
- **Credentials:** per-invocation, in-memory both sides (existing posture).
- **Predicates:** new `DATA.*` stage — DATA.CNT.01 counts compared,
  DATA.SUM.01 checksums, DATA.ROW.01 sampled diffs (rule citations in
  actual), DATA.GATE.01 gate evaluated both ways.
- **Checkpoint input:** comparator internals finalised against Spec O's
  as-built rule shapes.

### Spec Q — DB surface inventory + unclaimed surface (wave 1, parallel with O)
- **Generic:** computed inventory READ (AMS service + controller, snake_case
  wire; gateway proxy): tables/procs/triggers with per-object status —
  translation-dispositioned, exercised-by-scenario (effects join),
  state-verified / data-verified (filled by R / P later — v1 reads what
  exists, absent = false). **Unclaimed surface** derivation: introspected
  objects no discovered effect references → `unclaimed_db_surface` findings
  at scan time (discovery post-pass), write-capable unclaimed objects
  severity-raised (other-client risk). No new table in v1 (computed read;
  persistence arrives when P writes verdicts).
- **Predicates:** SCAN.DBINV.01 inventory computed (object counts by kind),
  SCAN.DBINV.02 unclaimed surface enumerated (count + finding parity).

### Spec R — DB state-parity floor (wave 2; depends on Q)
Every write-effect table exercised by ≥1 state-verified scenario; floor
evaluated beside the code coverage floor; gate code `db_state_floor_unmet`;
coverage summary extension. Mostly wiring over Spec N + Tier-1 item 3.
Predicates: CAP.STATEFLOOR.01, REC state-dimension per-table accounting.

### Spec S — Observed DB heat map (wave 2, small; depends on Q + RUNT)
RUNT observed endpoints × endpoint_data_effects → per-table/proc observed
traffic weight on the Q inventory; consumed by P sampling depth, R floor
priority, plan ordering hint. Predicate: RUNT.DB.01.

### Spec T — Divergence-driven capture (wave 2; depends on O)
Scenario seeding from rule seed hints (endpoints whose effects match a rule
get targeted boundary/failure scenarios); error-surface floor (declared
non-2xx statuses exercised per endpoint). Predicates: CAP.SEED.01,
CAP.ERR.01.

### Spec U — Dual-DB replay mode (wave 2 capstone; depends on P, Q, R)
Declared migration mode `service_and_db | db_only`. In `db_only`: current +
target = same app build against the two engines; capture/replay/diff/state
runs unchanged as the DB-only oracle; plan generator gains a db_only variant
(Q inventory + translation dispositions; DB streams only); reports, judge
doc and acceptance framing relabel. Mode stamped in config headers. Shape
held loosely until P/Q/R exist (checkpoint item).

## Deferred (named, out of program)
Performance-parity dimension; acceptance-pack generator; DB-side logs as a
runtime-evidence source; AMS-side proc/table consumer-count dimensions
(Tier-1 item-5 follow-up); wire-vocabulary neutralisation of
`tsql_dialect_sql` reason strings.

## Build log (append per slice)

- **Spec O BUILT (2026-07-14, commit 1 on feature/data-tier-oracle-program).**
  `migration-pairs/sybase15-postgres18.rules.json` v1 (10 rules + 13
  construct_refs keyed to the classifier's stable construct names; the
  CI-collation rule ships `enabled_by_default: false`).
  `migrationPairRules.ts` canonical in gateway, byte-identical copies in
  discovery + AMVS (SHA256-verified): fail-soft cached loader
  (MIGRATION_PAIR / MIGRATION_PAIR_RULESET_PATH / single-file discovery —
  the generic module cannot even carry a default pair id), rule selection
  helpers, strategy library v1 (timestamp-truncate, string-rtrim,
  numeric-rescale, numeric-epsilon, charset-normalize, collation-case),
  `compareWithRules` with rule-id citation + unknown-strategy flagging +
  strict-when-ruleless semantics. BOOT config headers in all three Node
  services stamp `migration_pair`/`ruleset_version`/`rule_count` ('none'
  when absent). Leak burn-down: the carriage dialect-guidance heading now
  renders from the ruleset's `guidance_heading` (neutral fallback);
  SPEC.DIAL.01 checks the same constant. Governance: engineNameGuard jest
  test pins EXACT engine-token line counts per generic module (13/9/3/3/2/5
  allowlisted with reasons; 5 modules pinned at 0 incl. the new library);
  `services/dbMigrationPack/**` and discovery's sqlDialectClassifier are
  DESIGNATED PACK CODE, excluded by classification. Verified: 27 new jest
  tests + dbChangeConsumerResolver heading test green; tsc exit 0 ×3.
- **Spec Q BUILT (2026-07-15, commit 2).** AMS
  `DbSurfaceInventoryService` + controller:
  `GET /api/projects/{p}/architectures/{a}/db-surface-inventory` — computed
  on read (no changesets) from `physical_data_entities` (tables/views) +
  `db_migration_pack_translations` (procs/triggers/views with dispositions)
  + `endpoint_data_effects` (claims). Claim resolution: direct `dep_phy_*`
  point, dep_log NAME-BRIDGE (logical name == physical name,
  case/schema/bracket-normalised — mapping-table join is the recorded
  follow-up), and `path_metadata_json.proc_name` vs translation
  `object_ref` tail for procs. Pack view rows MERGE onto their physical
  rows. Unclaimed = zero claims (triggers: null, dimension n/a). Predicates
  SCAN.DBINV.01/.02 emitted at compute with corr project+arch; judge doc
  updated ([E, on-demand]). Gateway proxy on migrationContextRouter.
  **Deviations from shaping:** discovery-side `unclaimed_db_surface`
  findings DEFERRED (cross-scan timing — the read endpoint + predicates
  carry the signal; findings ride the P/R write path later);
  unclaimed-write-capable summary dimension dropped (unclaimed objects have
  no mode evidence by definition). Verified: 7 JUnit tests green (Mockito),
  gateway tsc exit 0.
- **NEXT: Spec P** (data parity gate, AMVS-hosted) — comparator internals to
  be finalised against Spec O's as-built rule shapes per the wave-1 plan;
  then the checkpoint (fold in the first live judged run) before wave 2.

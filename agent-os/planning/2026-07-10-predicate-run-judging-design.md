# Predicate Run-Judging Design (2026-07-10) — AGREED, NOT BUILT

**Goal:** the tool self-scores every migration-workflow run by emitting boolean
predicates into the existing single combined log. After (or during) a run, the
log + an instructions doc go to a judging LLM (Opus 4.8) on the user's work
machine, which produces a scorecard + 2–3 paragraphs (problem + proposed
solution) per failure. The user feeds that back; we fix. Replaces the
human-checklist shakedown; predicates are PERMANENT run telemetry, not a
one-off.

## Design rules (locked)

1. **Structured predicate lines, stable IDs.** One greppable marker:
   `HAIKAI_PREDICATE {"id":"CAP.RAW.02","title":"...","verdict":"pass|fail|skip",
   "expected":"...","actual":"...","corr":{...}}`. Ternary verdicts; never silent.
2. **Absence detection.** The judge gets a predicate CATALOGUE (id → meaning →
   fires-when) + stage START/END banners, and flags expected-but-absent as its
   own failure class.
3. **Config-aware judging.** Each service logs a startup config header (git
   sha, trace on, comparison profile, caps, DB creds present y/n, prod logs
   ingested y/n). Fail-closed degradations score as PASSES of the fail-closed
   design when the config explains them (e.g. no DB password ⇒ state_unverified
   everywhere is correct).
4. **No secrets in predicate lines.** Counts/ids/classifications/capped
   snippets only — existing redaction discipline.

**Mechanics:** a `predicate()` + scorecard accumulator added to each service's
existing trace module (gateway TS, AMVS TS, discovery TS, AMS Java HaikaiTrace,
IVS Python), gated behind the SAME trace switch (zero production noise).
Stage-END banners emit `HAIKAI_SCORECARD {"stage","service","pass","fail",
"skip","failed":[{id,actual}],"cumulative":{...}}` — deterministic, no LLM —
so the user greps the running score after every stage (checkpoint protocol:
any fail ⇒ stop, judge the partial log, fix, resume). Judge instructions
support partial logs ("judge up to latest STAGE_END", mark rest not-reached,
reason about CASCADE — early fails explain later absences, don't double-report).

## Stage/predicate inventory (~60–70 predicates, 11 stages)

- **BOOT.\*** — per-service config headers; AMS changesets 205–209 applied;
  drift scheduler state; PARITY_REPAIR_CAP value; trace enabled + git sha.
- **SCAN.\*** (discovery) — endpoint candidates per protocol; view endpoints
  ALL carry out-of-parity-scope marker; internal processes minted with entry
  metadata (Quartz/task/batch/JMS counts); every edge with query_text carries
  sql_dialect (tsql/ansi/unknown counts + constructs); every extracted proc
  name matched-or-finding (zero silent); combined-run proc edges minted /
  code-only zero by design; finding counts per type + cap status;
  response-fidelity facts extracted.
- **RUNT.\*** (production log parsing, inside scan) — RUNT.01 ingestion health
  (files, parse rate, formats, TIME WINDOW); RUNT.02 observed endpoints +
  top-N frequencies; RUNT.03 **observed-surface ⊆ discovered-surface**
  (unmatched=0 or finding per miss — the killer predicate); RUNT.04 top-N
  traffic endpoints all have baseline coverage; RUNT.05 runtime summary
  persisted + insufficient_runtime_evidence gap consistency; RUNT.06 observed
  job executions matched to Spec M internal processes (where parser extracts
  them). NOTE: validate specifics against the actual parser outputs when
  instrumenting.
- **COMMIT.\*** — accepted counts by type; POST-COMMIT READ-BACK: sampled
  committed effect still carries sql_dialect + constructs (save-back
  preservation); endpoint-baseline-coverage read returns rows w/ method+path.
- **CAP.\*** (AMVS) — operations persisted = inventory; scenario counts per
  dimension kind, floor-bearing vs reported-only; raw persisted vs
  raw_unavailable + raw-only-when-redaction-noop; volatility envelopes;
  CAP.STATE.01 conditional on db bundle (present ⇒ deltas non-null; absent ⇒
  null AND logged as fail-closed pass); sequences assembled; coverage summary
  persisted w/ kinds; baseline activated + hash stamped + items inherit
  raw/state via server-side copy.
- **CONV.\*** (target-state conversation) — CONV.01 decisions persisted BOUND
  to correct target architecture id (both ids logged); CONV.02 required keys
  per selected streams (db.engine when persistence in scope; versions;
  framework) — missing ⇒ pending question raised, zero silent defaults;
  CONV.03 version-unknown ⇒ pending question; CONV.04 vuln recompute deltas +
  OSV bridge reachable-or-visible-degrade; CONV.05 plan-consumption
  round-trip (gen-time decision set/target == conversation-persisted — the
  June binding-bug catcher); CONV.06 readiness snapshot baked at gen time w/
  timestamp; CONV.07 api-lock derived values consumed — **KNOWN-OPEN, fails by
  design day one** (catalogue marks it pre-existing tracked issue).
- **PLAN.\*** (gateway) — model view fetched or degraded-with-warning;
  dialect-affected resolution ran (count + reasons) or fail-soft warning;
  clusters ≤ cap + verb splits; flagged split-outs per flag type incl.
  dialect_affected; capture stories manual-gate; **PLAN.EXP.01 zero LLM calls
  on code/DB epics**; drift/duplicate checks passed or honest regenerate throw.
- **SPEC.\*** — carriage engaged (not LLM); fact counts embedded; dialect
  guidance block when tsql edges; internal DB-delta recipe for internal
  stories; omissions enumerated (never silent) + length under cap.
- **GATE.\*** — every gate EVALUATION logged with inputs+verdict both ways
  (hard-block reasons; 4b DB gate; 4c code gate incl. story-scoped floor;
  dispatch set excludes manual-gate). Instructions include optional
  negative-path detours (Migrate before pin ⇒ expect block).
- **EXEC.\*** (gateway+IVS) — per-story dispatch w/ job id + spec name;
  implemented/deployed callbacks correlated; target_base_url recorded. IVS
  run-flow-graph provides intra-IVS visibility.
- **REC.\*** — replay lifecycle counts; diff completed FULL-surface
  (endpoint_scope_json null) + count summary; per-dimension classification
  counts (status/shape/value/header/BYTE/STATE) w/ raw_unavailable +
  state_unverified reported against config; breaks + auto-disposition counts;
  verdict emission summary (evaluated/posted/unverified/post-failures);
  IVS parity inbound per story (recorded, repair queued/exhausted, attempt vs
  cap); REC.STAT.01 run parity-status computed + LOGGED in the reconcile tail
  (per-story completable/blocked + closure + drift posture).
- **AUX.\*** (optional detours) — drift check ⇒ purpose:drift_check diff +
  gate posture; revalidate-db-consumers ⇒ affected set + scoped diff blob ==
  affected keys; waiver ⇒ clean-with-waivers + waiver id on verdict.

## Deliverables & order

1. Trace primitives: `predicate()` + scorecard accumulator + stage banners +
   config headers in all 5 services (one commit).
2. Stage instrumentation in workflow order, one commit per stage group.
3. `docs/run-judge/predicate-catalogue.md` (doubles as judge manifest) +
   `docs/run-judge/judge-instructions.md` (Opus 4.8: role, inputs, scorecard
   format, expected-degradation rules from config headers, per-failure 2–3
   paragraph format w/ cited log lines, cascade reasoning, partial-log
   protocol, closing machine-readable summary block for feeding back).
4. Branch `feature/predicate-run-judging`, merge to main at end.

Constraints: emission-only (NO behaviour changes); trace-gated; no secrets;
baseline-red discipline. If the log exceeds the judge's context, the
instructions include a pre-filter (grep HAIKAI_PREDICATE|HAIKAI_SCORECARD|
STAGE banners + config headers first; DETAIL lines fetched selectively).

## Open questions for the user (blocking-ish)

- Q1: confirm the "single combined log" = the HAIKAI_TRACE file per
  docs/trace-logging.md, and that ALL FIVE services (incl. IVS Python + AMS
  Java) write to ONE file on the work machine today. If any don't, name them
  — their predicate emission gets wired to the same file.
- Q2: include the Windows test-fixture fix (read-only .git objects vs
  shutil.copytree in test_orchestration_batch_single_branch /
  test_orchestration_multispec_b2) in this batch?
- Q3: how will Opus 4.8 be invoked on the work machine (Claude Code session
  pointed at the files vs upload)? Affects instructions phrasing only.
- Q4 (non-blocking, informs skip-semantics testing): will the pilot run have
  production logs (RUNT) and/or SOAP endpoints?

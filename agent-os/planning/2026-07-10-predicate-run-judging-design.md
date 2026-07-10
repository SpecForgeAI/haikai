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

## User answers (2026-07-10) — Q1–Q4 RESOLVED, BUILD IS GO

- **Q1:** YES — the combined log is the docs/trace-logging.md mechanism;
  EXTEND it. **Known bug — FIXED in this batch:** the doc says
  `~/.haikai/trace.log`, but all five tracer modules hardcoded a
  `C:\dev\data\haikai-trace.log` default instead (the documented default was
  never implemented; `homedir` sat imported-but-unused in the TS copies).
  Fixed to `~/.haikai/trace.log` in all five; parent dir already auto-created
  on first write. AUDIT RESULT: all five services emit today
  (gateway 3 files, AMVS 8, discovery 1 — thin, SCAN instrumentation will add
  more, AMS 2, IVS 8). The trace.ts doc header claims an mcp-server copy that
  does NOT exist — noted, out of scope.
- **Q2:** YES — include the Windows test-fixture fix (read-only .git objects
  vs shutil.copytree in test_orchestration_batch_single_branch /
  test_orchestration_multispec_b2 fixtures).
- **Q3:** the user will COPY/PASTE files into a Kiro workspace running Opus
  4.8 and say: "please read instructions <name>.MD and log file <name>.log
  and summarise the results and issues". So: instructions must be ONE
  self-contained file with a sensible name — `RUN_JUDGE_INSTRUCTIONS.md`
  (embed the predicate catalogue INSIDE it rather than a second file, so the
  paste is two files total), written to `docs/run-judge/`. The judge prompt
  must work with exactly those two files and no repo access.
- **Q4:** production log files WILL be available (RUNT.* fires for real);
  NO SOAP endpoints in the pilot (SOAP predicates will `skip` — verify skip
  semantics render correctly).

## As-built log (2026-07-11)

- **Commit 1 (`a3490af`)** — trace default-path fix all 5 stacks
  (`~/.haikai/trace.log`); audit result (all 5 emit; no mcp-server tracer);
  root cause of the 3 IVS test failures was the `_git_one_spec` product-root
  sync running for single-repo targets (fixed: polyrepo-gated, all repo
  folders + `.git` excluded); tests/job_queue+git 310 pass.
- **Commit 2 (`cb96c1d`)** — predicate primitives in all 5 trace modules:
  `predicate()`/`predicateSkip()`/`stageStart()`/`stageEnd()`/`configHeader()`
  emitting HAIKAI_PREDICATE / HAIKAI_STAGE_START / HAIKAI_SCORECARD /
  HAIKAI_CONFIG on the SUMMARY tier; per-process tally keyed by id stage
  prefix; caps failed[]=25, actual 160/400; tests in all 3 stacks
  (jest 6, JUnit 8, pytest 16); docs/trace-logging.md §Predicates.
- **Commit 3** — BOOT/SCAN/RUNT/COMMIT instrumentation. As-built predicate
  IDs (catalogue source of truth for RUN_JUDGE_INSTRUCTIONS.md):
  - **BOOT**: HAIKAI_CONFIG at startup in all 5 services (gateway: git_sha +
    drift knobs + plan caps; discovery: log-parse caps + vuln enrich; AMVS
    `capture-svc`: db_creds_per_request_only + volatility/replay/LLM knobs;
    AMS: git_sha + changesets_applied via `TraceBootHeader`
    CommandLineRunner; IVS: workspace/git_provider/parity_repair_cap).
    Predicate **BOOT.AMS.01** changesets ≥ 209 (BOOT banners emitted by AMS
    only; other services contribute headers, not predicates).
  - **SCAN** (discovery; banners at run start / scorecard at COMPLETED — a
    run that dies mid-scan leaves STAGE_START without SCORECARD): code runs
    emit **SCAN.CAND.01** (endpoints minted, by-type counts),
    **SCAN.VIEW.01** (view-html endpoints all carry
    parity_scope=out_of_scope_view; skip when none), **SCAN.PROC.01**
    (internal processes minted, subtype counts + verbatim-metadata count;
    skip when none), **SCAN.DIAL.01** (query_text effects all carry
    sql_dialect; dialect counts + constructs total; skip when no explicit
    SQL), **SCAN.FID.01** (response_contract coverage), **SCAN.FIND.01**
    (findings persisted without loss) — helper
    `discovery-service/src/services/scanPredicates.ts`. Database runs emit
    **SCAN.DB.01** (introspection surface) + **SCAN.DB.02** (persisted ==
    minted).
  - **RUNT** (inside `runDiscoveryRuntimeEvidence`, nested within the SCAN
    window): **RUNT.01** ingestion healthy (skip=no_log_artifacts;
    fail=all-files-failed or boundary error; actual carries
    processed/attempted + time window + per-file format reasons),
    **RUNT.02** endpoints observed (observations/matched/noUsage/unmatched),
    **RUNT.03** observed ⊆ discovered OR unmatched_runtime_endpoint finding
    per miss, **RUNT.05** evidence atoms + summary persisted, **RUNT.06**
    skip (parser is HTTP-only this build). **RUNT.04 is judge-derived**
    (RUNT.02 top hints vs the CAP coverage summary) — no code emission.
  - **COMMIT** (gateway save-approved proxy — MCP server has no tracer):
    **COMMIT.01** commit completed with accepted counts (skip on
    commit=false dry-run; fail on MCP-unavailable/proxy error; actual embeds
    a capped response-body excerpt with the counts). sql_dialect save-back
    preservation is verified downstream by the PLAN dialect predicate
    reading committed effects; the endpoint-baseline-coverage read predicate
    moves to the CAP slice.
- **Commit 4** — CAP/CONV/SPEC instrumentation (first half of the
  CAP/CONV/PLAN/SPEC group; the remainder rides the GATE/EXEC/REC/AUX slice):
  - **CAP** (AMVS captureSessionOrchestrator; STAGE_START at session start,
    scorecard at completion — a session that dies mid-capture leaves no
    scorecard): **CAP.OPS.01** (no infra error + ≥1 scenario persisted;
    tallies + infra error in actual), **CAP.COV.01** (coverage summary
    assembled + persisted on the completion PATCH), **CAP.STATE.01** (mode
    predicate, passes in both modes: db bundle ⇒ snapshots enabled; absent ⇒
    deltas null fail-closed — judge cross-refs REC state classifications).
  - **CONV.01** at the gateway writer boundary
    (`targetStateCapturedDecisionsWriter.postCapturedDecision`): one line per
    persisted decision (decision code + scope + target architecture id);
    fail on non-2xx.
  - **SPEC** (migrationCodeSpecCarriage completion): **SPEC.CARRIAGE.01**
    (deterministic zero-LLM carriage engaged + fact counts — the design's
    PLAN.EXP.01 intent folds in here, since epic EXPANSION legitimately uses
    LLM batches + a judge), **SPEC.DIAL.01** (T-SQL guidance block present
    iff tsql-classified edges exist; skip when none — this is also the
    downstream verifier for COMMIT save-back dialect preservation),
    **SPEC.OMIT.01** (omission manifest agrees with the trimmed-warning;
    chars vs cap in actual).
  - **DEFERRED to the next slice:** CAP.BASE.01 (AMS baseline activate +
    hash stamp), CONV.02/03 (pending-question raise sites), CONV.04 (OSV
    bridge reachable-or-degraded), CONV.05 (plan gen-time decision read ==
    persisted set), CONV.07 (api-lock known-open, fails by design), PLAN
    banners + counts (migrationBookOfWork handlers), SPEC/PLAN stage
    banners (shape-spec handler).

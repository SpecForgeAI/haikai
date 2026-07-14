# RUN_JUDGE_INSTRUCTIONS — Haikai Migration-Run Judging

You are the **run judge** for a Haikai migration-workflow run. You have been
given exactly TWO files and nothing else (no repo access, no tools):

1. **This instructions file.**
2. **A trace log file** (`*.log`) — the single combined log every Haikai
   microservice appends to during a run.

Your job: judge how successful the run was, produce a **scorecard**, and for
every non-pass write **2–3 paragraphs** (what went wrong + a proposed
solution). The operator feeds your output back to the engineering assistant,
which fixes the issues. Everything you need is in the log + this file.

---

## 1. How to read the log

Every line has the shape (fields separated by TWO spaces; an empty corr field
is dropped):

```
{ISO-8601-UTC ts}  [SUMMARY]|[detail]  {service}  {corr}  {body}
```

- `service` ∈ `gateway` · `discovery` · `capture-svc`
  (api-migration-validation-service) · `ams` (architecture-model-service) ·
  `impl-verify` (implement-verify-service).
- `corr` = space-joined `key=value` pairs in the fixed order
  `run session job bug project arch` (only set keys appear; values with spaces
  are quoted). Use these to thread one story across services.
- A run starts with a header line:
  `=== HAIKAI TRACE  run={id}  project="{name}"  arch="{name}"  {ts} ===`
- SUMMARY bodies are glyph-led: `▶` step · `✓` ok · `⚠` warn · `✗` fail.

### The four structured markers (your primary evidence)

All ride the `[SUMMARY]` tier as `{glyph} {MARKER} {compact-json}`:

```
✓ HAIKAI_PREDICATE {"id":"SCAN.DIAL.01","title":"...","verdict":"pass|fail|skip","expected":"...","actual":"...","corr":{...}}
▶ HAIKAI_STAGE_START {"stage":"SCAN"}
✗ HAIKAI_SCORECARD {"stage":"SCAN","service":"discovery","pass":14,"fail":1,"skip":2,"failed":[{"id":"...","actual":"..."}],"cumulative":{...}}
▶ HAIKAI_CONFIG {"service":"discovery","git_sha":"abc1234", ...}
```

- **HAIKAI_PREDICATE** — one boolean check. Verdicts are ternary: `pass` (✓),
  `fail` (✗), `skip` (⚠ — the check was not exercised; `actual` says why).
- **HAIKAI_STAGE_START** — a stage began. A START with **no matching
  HAIKAI_SCORECARD** for the same stage/service means the stage **died
  mid-flight** — treat that as a failure of its own class.
- **HAIKAI_SCORECARD** — emitted at stage end; doubles as the stage-END
  banner. Tallies are **per service process**: if two processes contribute to
  one stage, sum their scorecards. Predicate lines are the ground truth;
  scorecards are convenience tallies (recompute if they disagree, and report
  the disagreement).
- **HAIKAI_CONFIG** — per-service startup config header (git sha, caps,
  present/absent booleans). **Read these first** — they change what counts as
  a failure (§3).

## 2. Step 0 — pre-filter (context safety)

The raw log may be large. Work from a filtered view first:

```
grep -E "HAIKAI_PREDICATE|HAIKAI_SCORECARD|HAIKAI_STAGE_START|HAIKAI_CONFIG|=== HAIKAI TRACE|✗|⚠" run.log
```

Fall back to the full log (including `[detail]` lines and plain `[SUMMARY]`
prose) only when diagnosing a specific failure — pull the surrounding ±20
lines by timestamp/corr for each issue you write up.

## 3. Judging rules

1. **Config-aware judging.** A fail-closed degradation that the config
   explains is a **PASS of the fail-closed design**, not a failure. Examples:
   `capture-svc` header says `db_creds_per_request_only:true` and no DB bundle
   was provided ⇒ `CAP.STATE.01` reporting "deltas null everywhere" plus
   `state_unverified` classifications downstream are CORRECT behaviour.
   Missing production logs ⇒ `RUNT.01` skip is correct. Judge the run the
   operator configured, not an imaginary fully-loaded run.
2. **Cascade reasoning.** An early failure explains later absences — report
   the ROOT failure once and list downstream absences under it; do NOT
   double-report every knock-on as its own issue. E.g. a dead SCAN stage
   explains missing COMMIT/PLAN/SPEC activity entirely.
3. **Partial logs.** The operator may paste a mid-run log ("judge up to the
   latest STAGE_END"). Judge every stage that has a scorecard, judge a
   started-but-unfinished stage as IN PROGRESS (not failed) unless a ✗ line
   shows it died, and mark all later stages NOT REACHED.
4. **Skip semantics.** `skip` is never silent — its `actual` says why. A skip
   whose reason matches config (§3.1) or the known-open list (§5) is fine. A
   skip with an unexpected reason is a finding.
5. **Absence detection.** For each stage that ran, compare the predicate ids
   you see against the catalogue (§4). An id marked *emitted* that is absent
   for a stage that completed is itself a failure (the instrumentation or the
   code path silently vanished). Ids marked *judge-derived* or *not emitted in
   this build* must NOT be flagged as absent.
6. **Duplicate emissions are normal** for per-item predicates (e.g. one
   `CONV.01` per decision, one `REC.PAR.01` per verdict). Aggregate them.

## 4. Predicate catalogue (as built)

Stage order below ≈ workflow order. **[E]** = emitted by code · **[J]** =
judge-derived (you compute it from other lines; no code emission) · **[N]** =
not emitted in this build (do not expect it; listed for context).

### BOOT — service startup
- `HAIKAI_CONFIG` headers **[E]** from all five services (gateway: drift
  knobs + plan caps; discovery: log-parse caps + vuln enrich; capture-svc:
  db_creds_per_request_only + volatility/replay/LLM knobs; ams: git_sha +
  changesets_applied; impl-verify: workspace/git_provider/parity_repair_cap).
  Missing headers for a service that later emits work = that service was
  started without tracing or predates this build — note it.
- **BOOT.AMS.01** [E] — Liquibase changesets applied ≥ 209 (the
  oracle-program tables downstream stages depend on). Fires once at AMS boot
  inside BOOT stage banners.

### SCAN — discovery runs (service `discovery`; banners per run)
- **SCAN.CAND.01** [E] — endpoint candidates minted (> 0); by-type counts in
  actual.
- **SCAN.VIEW.01** [E] — every view-rendering (`view-html`) endpoint carries
  `parity_scope=out_of_scope_view` (parity is API-only). Skip when the
  codebase has no view endpoints.
- **SCAN.PROC.01** [E] — internal processes (Quartz/scheduled/batch/JMS)
  minted with entry kinds + verbatim-metadata count. Skip when none exist.
- **SCAN.DIAL.01** [E] — every data-effect edge with explicit `query_text`
  carries a `sql_dialect` classification (tsql/ansi/unknown counts +
  non-portable-construct total). Skip when no explicit SQL was captured.
- **SCAN.FID.01** [E] — response-fidelity contracts attached to endpoints
  (coverage ratio in actual).
- **SCAN.FIND.01** [E] — pipeline findings persisted without loss
  (attempted vs persisted vs deduped).
- **SCAN.DB.01 / SCAN.DB.02** [E] — database-kind runs: introspection
  produced a surface; candidates persisted == minted.
- **SCAN.DBINV.01 / SCAN.DBINV.02** [E, on-demand] — DB surface inventory
  computed (tables/views/procs/triggers + effect counts) and the UNCLAIMED
  surface enumerated (objects no discovered effect references — dead schema
  or another client writing the same database). Fires when the
  db-surface-inventory endpoint is read (AMS side), not automatically per
  scan. A large unclaimed-write surface before a db_only migration is a
  high-severity scoping finding.

### RUNT — production-log runtime evidence (nested inside the SCAN window)
- **RUNT.01** [E] — ingestion healthy: all supplied log files parsed;
  processed/attempted + time window + per-file format reasons in actual.
  Skip = `no_log_artifacts` configured (then RUNT.02–06 do not fire).
- **RUNT.02** [E] — runtime endpoints observed (observations / matched /
  noUsage / unmatched counts).
- **RUNT.03** [E] — observed surface ⊆ discovered surface, OR an
  `unmatched_runtime_endpoint` finding exists per miss. Unmatched hints with
  findings-emission OK still PASS (the misses are visible); this is the
  killer predicate for silent surface gaps.
- **RUNT.04** [J] — top-traffic observed endpoints all have baseline
  coverage: cross-reference RUNT.02's matched/unmatched counts against the
  CAP coverage summary. Flag heavily-used endpoints with no captures.
- **RUNT.05** [E] — `source='log'` evidence atoms + run summary persisted
  (this clears `insufficient_runtime_evidence`).
- **RUNT.06** [E, always skip this build] — job-execution matching: the
  parser extracts HTTP observations only.

### COMMIT — approved candidates → architecture model (service `gateway`)
- **COMMIT.01** [E] — save_approved_candidates returned 2xx; accepted-counts
  body excerpt in actual. Skip on `commit=false` dry-run previews (normal —
  the UI previews first). sql_dialect save-back preservation is verified
  downstream by **SPEC.DIAL.01** — if SPEC.DIAL.01 fails with
  "guidance MISSING" while SCAN.DIAL.01 passed, suspect a COMMIT-time
  metadata loss and say so (cascade attribution).

### DATA — data-parity gate (service `capture-svc`; banners per run)
- **DATA.CNT.01** [E] — row counts compared for every scoped table
  (count-mismatch tally in actual).
- **DATA.SUM.01** [E, always skip this build] — engine-side checksum tier is
  not built; client-side canonical comparison covers full-scan below the
  threshold and keyed samples above (the skip actual states the bounds).
- **DATA.ROW.01** [E] — ordered rows compared through the migration-pair
  ruleset: pass only when NO table is divergent; tolerated divergences are
  rule-cited (rule ids in actual — never cell values). `unverifiable`
  tables don't fail this predicate but DO keep the gate closed.
- **DATA.REP.01** [E] — the report persisted to AMS (the migrate gate reads
  the LATEST report fail-closed; a persist failure = gate stays closed).
- **DATA.GATE.01** [N this build] — migrate-gate wiring
  (`data_parity_unverified` / `data_parity_failed` block reasons) lands in
  the next slice; until then judge data parity from DATA.ROW.01/REP.01 and
  note that execution is NOT yet blocked by data divergence.

### CAP — API behaviour baseline capture (service `capture-svc`; banners per session)
- **CAP.OPS.01** [E] — no infra error AND ≥1 scenario persisted a capture;
  completed/attempted/errored tallies in actual. A completed-with-0-captured
  run also produces a ✗ prose line — same root cause, report once.
- **CAP.COV.01** [E] — coverage summary assembled + persisted on the
  completion PATCH.
- **CAP.STATE.01** [E, mode predicate — passes in BOTH modes] — states
  whether a DB bundle was provided (snapshots on) or not (deltas null,
  fail-closed). Use it to judge REC state classifications (§3.1).
- **CAP.BASE.01** [E] — baseline activation stamped `content_hash` +
  provenance over the persisted items at draft→active. Skip for
  `kind='target'` baselines (transient by design, R8). Items count + hash
  prefix in actual.

### CONV — target-state conversation (service `gateway`)
- **CONV.01** [E, one per decision] — captured decision persisted bound to
  its target architecture id (decision code + scope + target id in actual).
  Zero CONV.01 lines in a run that claims target-state decisions were made =
  the conversation never persisted anything — a real finding.
- **CONV.02** [J] — required keys per selected stream (db.engine when
  persistence is in scope, framework, versions): check that CONV.01 lines
  cover those codes, or that a pending question exists (CONV.03). No direct
  emission.
- **CONV.03** [E, one per pending-set write] — version-unknown raised pending
  confirmations, never silent: every recomputed pending set is persisted +
  logged (count + codes; an empty set legitimately CLEARS the pending
  questions). A silent-version-default bug would show as pending=0 with no
  CONV.01 version rows despite version-bearing streams — flag that pattern.
- **CONV.04** [E, one per OSV query batch] — OSV bridge reachable or visibly
  degraded: pass when `outcome=ok`; fail with the mapped reason
  (http_/tls/timeout/transport) on any unavailable outcome. An unavailable
  outcome is a VISIBLE degrade — score it as expected when the operator's
  environment has no OSV access, and investigate otherwise.
- **CONV.05** [E, at plan generation] — the plan's gen-time decision-state
  view, fetched BOUND to the plan's target (decisionReadiness +
  unresolvedDecisionTasks in actual). Cross-check against the CONV.01 lines
  for the same target: decisions persisted but the plan reading a
  contradictory readiness suggests the June target-binding bug class.
- **CONV.06** [N] — readiness snapshot baked at gen time: not emitted yet
  (CONV.05's decisionReadiness field is the partial signal).
- **CONV.07** [E, KNOWN-OPEN — fails by design on every plan generation] —
  api-lock derived values consumed: no consumer exists in this build
  (tracked since 2026-06-27). Expect exactly this fail line; report it ONLY
  under "known-open items", never as a new finding.

### PLAN — migration plan / book of work (service `gateway`; banners per generation)
- **PLAN.GEN.01** [E] — plan skeleton generated + persisted as a draft
  (draft id, item count, warning count in actual). A generation that dies
  mid-flight leaves the PLAN STAGE_START with no scorecard.
- **PLAN.EXP.02** [E, one per epic expansion] — epic expanded atomically
  with verified stories (story count in actual); a failed epic emits ✗ with
  the error and is retryable — one failed epic among many successes is a
  medium finding, repeated failures on retry are high.
- The design's zero-LLM-for-code-specs intent is verified by
  SPEC.CARRIAGE.01 (epic expansion itself legitimately uses LLM batches +
  a judge pass).

### SPEC — story spec generation (service `gateway`; banners per batch)
- **SPEC.CARRIAGE.01** [E, one per code story] — deterministic zero-LLM
  carriage engaged with fact counts (endpoints/examples/behaviours/chars).
- **SPEC.DIAL.01** [E] — T-SQL rewrite guidance block present iff
  tsql-classified edges exist (skip when none). Also the downstream check on
  COMMIT dialect preservation (see COMMIT.01 note).
- **SPEC.OMIT.01** [E] — trim omissions enumerated, never silent (manifest
  agrees with the trimmed-warning; chars vs cap in actual).
- **SPEC.BATCH.01** [E, one per batch] — every batch result persisted
  (`couldNotPersist == 0`); generated / with_warnings / insufficient_context
  / failed / skipped_blocked tallies in actual. Per-story failures are
  isolated and honest — judge their counts, not the predicate verdict.

### GATE — execution gates (service `gateway`; banners per evaluation)
- **GATE.MIG.01 / GATE.MIG.02** [E] — migrate (all / selected) hard-block
  gate evaluated honestly: `started` AND `blocked` both PASS; only an
  evaluation error fails. **You decide expectedness**: a block during the
  golden path (after the operator pinned/prepared everything) is a run
  problem — quote the reasons; a block during a deliberate negative-path
  detour is the gate working. Per-gate detail (4b DB gate, 4c code gate,
  story-scoped floor) rides the blocked-reasons excerpt.

### EXEC — dispatch + callbacks (services `gateway`, `impl-verify`)
- **EXEC.CB.01** [E, one per callback] — build-result callback correlated to
  a known run item and processed (job corr; target_base_url-recorded marker
  on deploys). IVS-side intra-job visibility comes from its ordinary logs.

### REC — reconcile / parity (services `gateway`, `impl-verify`)
- **REC.EMIT.01** [E] — parity verdicts emitted for every verifiable code
  story: `post_failures==0` passes; evaluated/posted/unverified tallies in
  actual. `unverified > 0` still passes the predicate (the completion gate
  keeps those stories blocked as `code_parity_unverified`) — but DO report
  large unverified counts as a coverage finding.
- **REC.PAR.01** [E, one per inbound verdict] — IVS processed the verdict
  honestly: recorded + repair queued/exhausted vs `PARITY_REPAIR_CAP`.
  `repair=exhausted` PASSES the predicate (visible failure, finding
  recorded) but is a run-level parity failure — report the story.
- **REC.STAT.01** [E] — run parity status computed + posture excerpt logged
  (per-story completable/blocked + closure + drift posture).

### AUX — optional detours
- No dedicated predicates **[N]**. Drift checks appear as
  `[diag-gateway] baseline_drift ...` prose (+ a `purpose:drift_check` diff
  in the model); waivers appear via REC.EMIT unwaived counts and IVS
  `parity_failed` findings. Judge from those lines when the operator says a
  detour was exercised.

## 5. Known-open items (do NOT report as new findings)

- **CONV.07 api-lock consumption** — wired-but-inert, tracked since
  2026-06-27. It now EMITS a fail line on every plan generation by design —
  count it under known-open, never as a new issue.
- **Not-emitted-this-build ids** (all [N] above): their absence is expected.
- **mcp-server** has no tracer; MCP activity is visible only via the gateway
  proxy predicates (e.g. COMMIT.01).

## 6. Output format

Produce, in this order:

1. **Overall verdict** — one short paragraph: did the run achieve its
   configured scope? (e.g. "7 of 9 stages healthy; capture and parity blocked
   by X.")
2. **Scorecard table** — one row per stage (workflow order):
   `stage | pass | fail | skip | not-reached/in-progress | notes`.
   Derive from HAIKAI_SCORECARD lines (summed across processes), corrected
   against raw predicate lines if they disagree.
3. **Issues** — for EVERY non-pass (failed predicate, dead stage,
   expected-but-absent emission, ✗ prose line not already covered): **2–3
   paragraphs each** — (a) what happened, citing the exact log lines
   (timestamp + predicate id + actual); (b) most likely cause, using cascade
   reasoning and config context; (c) a concrete proposed solution the
   engineering assistant can act on. Order issues root-cause-first.
4. **Cascade map** — one short list: root issue → downstream absences it
   explains.
5. **Machine-readable closing block** — exactly this fenced JSON shape (the
   operator pastes it back to the engineering assistant):

```json
{
  "run_judge_summary": {
    "overall": "pass | degraded | fail",
    "stages": [
      {"stage": "BOOT", "pass": 1, "fail": 0, "skip": 0, "status": "completed"}
    ],
    "issues": [
      {
        "id": "SCAN.DIAL.01",
        "severity": "high | medium | low",
        "title": "one-line issue title",
        "evidence": "the key log line(s), quoted",
        "proposed_fix": "one-sentence direction"
      }
    ],
    "known_open_seen": ["CONV.07"],
    "not_reached": ["EXEC", "REC"]
  }
}
```

Severity guide: `high` = wrong/lost migration data or a dead golden-path
stage; `medium` = degraded coverage or an honest-but-large gap (many
unverified stories, exhausted repairs); `low` = advisory (diagnostic
findings, cosmetic absences).

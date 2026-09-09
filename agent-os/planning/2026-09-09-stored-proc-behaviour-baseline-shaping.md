# Stored Procedure & Function Behaviour Baseline + Reconciliation — Design Agreement (2026-09-09)

Agreed in discussion 2026-09-09. Trigger: the DB migration pack translates
Sybase T-SQL procs/functions to PL/pgSQL, a reviewer approves the LLM draft,
and Liquibase creates the function on the target. "Stored procs migrated"
on the progress report counts those approvals. Nothing executes a translated
routine against real inputs, so behaviour is verified only indirectly (an
API scenario that happens to call the proc, attributed to the endpoint, not
the proc) and routines reached only by batch jobs, schedulers, manual runs
or external tools are never exercised at all. A DB-ONLY migration (service
tier untouched) has no oracle for its procedural surface.

The feature: capture the behaviour of every in-scope routine against the
current-state DB at S0 (LLM-generated scenarios, same posture as the API
behaviour baseline), then replay the same inputs against the translated
routine on the target and judge like-for-like across return status, output
parameters, result sets, messages/errors and state delta. The replay is the
test oracle for a translate → apply → reconcile → re-translate loop that
runs in the pack's Translations tab BEFORE any plan executes, and re-runs
as a check inside the DB plane at execution.

Prior art honoured: `2026-06-11-db-object-translation-drafts` requirements
Q7 ("proc-level usage evidence is its own future spec"); Spec Q per-object
ledger; Spec M's "run on both sides, compare DB deltas" precedent; the
capture-state discipline doctrine (`2026-08-18-...-design.md`); the
remediation rulings (`2026-08-27-...-remediation/SPEC.md`).

## Doctrine

- **Same oracle, one tier down.** Same inputs at the same pinned S0 state
  must produce the same outputs AND the same state delta. S0 is the law for
  proc capture exactly as for API capture; every proc scenario is bracketed
  by the derived, verified compensation engine (bracket over rollback —
  rollback distorts routines that manage their own transactions and hides
  committed-effect semantics; ruling 2026-09-09).
- **A routine's output is five things**: return status, OUTPUT parameter
  values, an ordered list of result sets, messages and errors, and the
  state delta on the tables it writes. Capture and comparison cover all
  five or the oracle is partial.
- **DB-native, independent of the API path.** Nothing in the proc path may
  depend on an API capture session, OAS inventory, base URL, API auth, API
  baseline, API target session or the service plane. A Persistence-only
  migration runs capture + workbench + DB-plane parity with no service
  plane at all. Shared pieces are shared because they are DB-native:
  compensation bracket, S0, DB credential handling, pair ruleset, LLM tool
  loop, 202+poll run pattern, trace/predicates.
- **The T-SQL source is the specification; captured scenarios are tests.**
  Runtime evidence enters a translation prompt only after a test fails, one
  rung at a time (evidence ladder). Attempt one carries the source plus the
  deterministic contract and ZERO scenarios (ruling 2026-09-09, grounded in
  the observed over-weighting of runtime evidence during spec generation).
- **Two kinds of code, one kind of data.** Sybase invocation, PG invocation
  and the T-SQL profiler are pack code; the envelope, comparator driver,
  loop engine, gate and UI are generic; every pair fact (shape classes,
  error carriage, session profile, ordering rule, volatility, call-site
  compatibility matrix) is a cited rule in `migration-pairs/*.rules.json`
  (ruleset v2 with new `applies_to` selectors). `engineNameGuard` counts
  stay exact.
- **Strict comparison, relaxed only by cited rules.** No canonicaliser, no
  mask lists. Clock/random/identity-derived cells are volatility BY RULE
  and BY EVIDENCE (double-fire for profile-flagged routines), never by
  hand-written exclusion.
- **Heal, don't halt; staleness is a signal; never a dead button.** Every
  non-reconciled routine can proceed with a recorded reason (waiver) or a
  recorded override. Nothing about proc state ever stops a plan executing.
- **Gold standard.** Nothing is deferred. Items are IN or OUT by decision
  (see "Out by decision").

## Decisions (2026-09-09, owner-confirmed)

1. Sibling pipeline on shared services; separate AMS tables (never the
   HTTP-shaped api_behaviour_* tables; method/path there are NOT NULL and
   the diff pairs on METHOD|path|scenario).
2. Calling convention = **shape-adaptive**, one deterministic rule set,
   descriptor stamped per routine into the pack manifest:
   - `return_status` — no result set, no OUTPUT: PG function RETURNS integer.
   - `single_result_set` — exactly one result set, trivial return status:
     RETURNS TABLE(...)/SETOF.
   - `out_params` — OUTPUT params, no result set: function with OUT args.
   - `rich` — >1 result set, or result set + OUTPUT/non-trivial return:
     OUT refcursors in order + OUT `return_status` + OUT params.
   The first three keep the application's existing JDBC call patterns
   working on pgjdbc (DB-only requirement). `rich` requires a Java change
   (autocommit off + registered cursor param) and no PG shape avoids it.
   The code scan's call-site patterns × descriptor = a deterministic
   **call-site compatibility count** reported per pack.
3. State discipline for capture = the existing compensation bracket
   (`runCompensationBracket`, opaque `fire`), tables = profile write closure
   ∪ trigger-expanded writes ∪ reads (defensive union), reseed after undo.
   Non-compensatable routines (xp_/system procs, remote 4-part calls,
   cross-database DML, dynamic SQL with no static write set, WAITFOR) fail
   closed BEFORE firing with the reason; these coincide with the translation
   pre-pass "untranslatable constructs" so buckets align.
4. Scenario sourcing = LLM-generated (research loop over the DB with the
   existing tools + one new routine-execution tool), seeded internally by
   deterministic DB-mined parameter domains (parse `column = @param`
   comparisons in the body → sample real values) and by the ruleset's
   `construct_refs` families (zero-row @@rowcount path, constraint-violation
   @@error path, #temp path, TOP tie, isnull typing, RAISERROR path).
   **Sequences in scope**: ordered multi-invocation scenarios in one bracket
   (reuse the API sequence machinery + id-fact learning).
5. Coverage floor per routine (deterministic denominator) = statically
   enumerated exit outcomes (each distinct RETURN value, each RAISERROR
   site, the implicit success exit) + seeded families present in the body.
   Numerator = distinct outcomes observed. Reported-only kinds: null,
   default, boundary variants. Waivable per routine with a reason. Every
   routine ends in exactly one bucket: verified | divergent | unverifiable
   (reason) | not_exercised | dispositioned_away.
6. Credentials: capture fires with the DB credentials the user enters in
   the wizard (write-capable; a proc call is never read-only-safe). No new
   credential role. The envelope records the login; the profile notes
   session-user-dependent routines as information.
7. Session settings: the pair ruleset carries a session profile equal to
   the application driver's (jConnect) defaults; applied as explicit SET
   statements on every capture connection regardless of sidecar driver
   (jTDS default) and recorded in the envelope.
8. Error carriage on the target: fixed SQLSTATE `P0001` for translated
   business errors + structured DETAIL `{"source_error":n,"severity":s,
   "state":st}`; comparator matches on `source_error`; message text
   advisory. Java code branching on Sybase error numbers = flagged call
   site in the compatibility count.
9. Result-set column names: lower-case unquoted in translations; cited rule
   compares names case-insensitively; pgjdbc column lookup is
   case-insensitive so DB-only call sites keep working.
10. Translation may run before a proc baseline exists (descriptor
    confidence `static`); reconcile waits for the pinned baseline; the shape
    class is refined `capture_refined` once the coverage floor is met.
11. Workbench target build = FULL S0 load (same artifact the migration
    uses), into the DECLARED target database from the target conversation
    (`db.databaseName`), rebuilt idempotently by the plan's DB plane later.
    "Rebuild from scratch" = Liquibase drop-all + re-apply + reload.
12. Waivers per scenario AND per routine, reason mandatory; a separate
    "reconciled with waivers" bucket (never counted as fully reconciled).
13. **Graduated gate policy** (owner rejected fail-closed-on-everything as
    too strict): plan start never blocked by proc state; DB plane always
    runs to completion (unapproved translations are not applied = "not
    migrated", today's behaviour); the pause before the NEXT plane lists
    block reasons ONLY for routines the next plane depends on (routines
    with proc_call edges from endpoints/jobs in that plane's stories and
    not reconciled) — everything else is a warning line with a count;
    per-routine waivers + recorded override remain; final plane (DB-only =
    the DB plane) never blocks — the run completes `completed_with_findings`
    listing the non-reconciled routines.
14. Translate loop = automatic translate → apply → reconcile → re-translate
    with evidence, attempt cap 4 (config), **evidence ladder**: attempt 1
    none; 2 one failing scenario (inputs + the one divergent dimension,
    expected vs actual); 3 one representative per distinct failure
    signature (dimension + first divergent column/field); 4 all failing
    scenarios with full envelopes. Reconcile ALWAYS runs against every
    scenario; only the prompt is rationed. Evidence framed as a bug report
    against a fixed spec; judge flags literal captured values absent from
    the source as `overfit_suspected`. Every attempt kept as a versioned
    draft with verdict; on exhaustion the best attempt (fewest failing)
    stays as the draft and the user is told loudly.
15. Dependency order everywhere: routines with no proc calls first, callers
    after every callee is reconciled; a caller failing because of a
    divergent callee is `blocked_by_callee`, not divergent; cycles applied
    and reconciled as a group; emitted translation changeset ordered
    callee-first.
16. Human intervention = **guidance & retry** (reviewer guidance field
    feeds the next attempt — the carry-over "amend" pattern). No direct
    editing of the PL/pgSQL draft (reviewer banner doctrine: no manual
    translation outside the tool). Manual-step loop REJECTED.
17. Approval stays human and becomes evidence-gated: Approve enabled for
    reconciled routines or with a recorded waiver; "Approve all reconciled".
18. Progress report DB cell becomes **"Stored procs migrated/reconciled:
    X of Y"** fed by verdicts (pre- and post-execution), with buckets
    Not captured | Divergent/exhausted | Unverified | Reconciled with
    waivers | Fully reconciled, and moved-to-code / dropped shown alongside.
    Denominator = routines in scope minus dispositioned-away.
19. Workflow placement: routine catalog+profile ride the DB scan (one
    action, with S0); proc capture is a second kind on the Live behaviour
    surface; the loop lives on the pack Translations tab; pack generation
    becomes triggerable straight after the target conversation so the
    workbench exists before any plan; execution re-checks (DB plane step 6).
20. No scenario carriage into specs of any plane (routines dispositioned
    rewrite_in_app are verified through the service plane's API
    reconciliation). Views reconcile through the existing table comparator.

## Out by decision (not deferred — OUT)

- Side-channel observation of proc calls during API capture (MDA tables /
  JDBC proxy). API capture already covers those paths end to end.
- Scenario file import (Postman analogue) — LLM generates scenarios.
- Manual-step loop; direct draft editing.
- Standalone DML scenarios for triggers (triggers are exercised through the
  DML inside routine scenarios; their writes are in the bracket via
  trigger expansion).
- Performance parity (prior ruling).

## Mechanism 1: routine catalog + static profile (DB scan)

First-class AMS entity `db_routines` (procs, functions, triggers): full
harvested body (unbounded — retires the 64KB truncation + supply-full-body
workaround), body hash, params (name/type/direction/default/ordinal),
deterministic profile (RETURN sites/values, RAISERROR sites, result-producing
SELECTs with ORDER BY/TOP flags + static select-list, temp tables, cursors,
transaction control, dynamic SQL, sp_/xp_/remote/cross-db, volatile fns,
session-user fns, SET options), reads/writes/proc calls with UNCAPPED
cycle-safe closure and trigger-expanded writes. Live-wins merge unchanged.
Written by discovery at scan completion (fail-soft, loud) — facts, not
candidates. Claims, the translation queue (routine_id FK, body from the
entity) and the Spec Q ledger key on it. Fixes the two drifted proc-call
regexes (gateway backfill mirror; dialect classifier: `{? = call}` and
`exec @rc =` arms).

## Mechanism 2: invocation surface + descriptor

Sidecar `POST /call` (composes the call itself — callers never send SQL):
CallableStatement with return-status placeholder, typed binds, registered
OUT params, execute + getMoreResults loop, warnings drained (PRINT /
low-severity RAISERROR), exceptions projected with engine number; guard =
third grammar (identifier-only routine name, sp_/xp_ blocked, no SQL text);
timeout = long-fetch ceiling (not the 300s /query clamp); per-result-set
row cap 10k with `truncated`. AMVS `DbAdapter.callRoutine` (Sybase via
sidecar; Postgres per descriptor shape: SELECT FROM fn / refcursor FETCH ALL
in a transaction; NOTICE subscription; SQLSTATE/DETAIL projection; pool
mirrors the UTC pin + raw datetime parsers). Engine-neutral
`RoutineInvocationEnvelope`. Ruleset v2 `SYBPG.PROC.*` family. Translator
prompt/validator enforce the descriptor; manifest carries descriptor +
call-site compatibility.

## Mechanism 3: capture (Live behaviour, second kind)

AMS proc_behaviour_* tables; AMVS orchestrator per routine: deterministic
seeds → LLM loop (captureLoopRunner reuse, research rounds free) → fire
inside the bracket → envelope + state delta → coverage floor → save-as-
baseline + pin with S0 fingerprint. Double-fire for volatility-flagged
routines. Retry-uncovered / exclude-with-reason / Not-possible parity with
the API session screen. Wizard = scope (routines) + DB credential block +
tuning; no base URL, no API auth.

## Mechanism 4: workbench loop (pack Translations tab)

Build target from pack (schema → S0 data → post-load translations; per-
invocation target creds like Verify; async; recorded) → Translate &
reconcile all (callee-first, concurrency 3, evidence ladder, cap 4) →
per-routine verdict + per-scenario detail → guidance & retry / waive /
disposition → evidence-gated approval. Proc parity reports are the source
of truth (mirrors data parity: reports + gate + waivers, NO reconciliation
breaks). Scoped re-apply = DROP IF EXISTS + CREATE in one transaction.

## Mechanism 5: execution integration

DB-plane completion step 6 = proc parity (fail-open execute, like data
parity); graduated gate (decision 13); manual Run-reconciliation modal DB
group gains the proc checkbox, API group hidden when the service plane is
out of scope; progress cells (decision 18); banner Live behaviour counts
proc baselines; drift = body-hash change → stale flags (baseline items +
translation demoted to needs_rework) → banner signal; views through the
table comparator; predicates PROC.* documented in the judge registry.

## Build assumptions (stated pre-build, unobjected)

- Pack generation exposed after the target conversation (Generate button
  already exists on the pack surface; plan creation reuses a found pack).
- Attempt cap 4, concurrency cap 3, ladder rungs 0/1/cluster/full — all
  env-tunable: PROC_TRANSLATE_ATTEMPT_CAP, PROC_TRANSLATE_CONCURRENCY,
  PROC_TRANSLATE_EVIDENCE_LADDER.
- Per-result-set cap 10k rows (PROC_CALL_MAX_ROWS_PER_RESULT_SET), honest
  `unverifiable(result_set_truncated)`.
- Result-set rows compared ORDERED only when the producing SELECT has ORDER
  BY, otherwise canonical multiset; unnamed columns compared positionally.
- Redaction: the existing literal-redaction policy applies to stored
  envelopes and to everything shown to the LLM.
- Naming: UI says "Stored procs and functions"; ruleset version 2.
- Work machine: live PG is 15 (all target shapes are PG-15 compatible),
  no Docker (sidecar jar rebuilt and run bare), pickup = clone + copy.
- Pre-existing red baselines untouched (frontend whole-repo tsc; the known
  AMVS env-dependent suites; the two gateway Config-mock reds).

## Not changing

- API behaviour capture/replay/diff/breaks — untouched.
- Data parity comparator table driver, gate 4d, DB-plane steps 1–5.
- Translation dispositions (translate | rewrite_in_app | drop) and the
  source-body-hash demotion rule (approval never survives a source change).
- S0 pinning (automatic at DB scan), compensation engine, credential split.

## Proposed spec program (one commit per spec; --no-ff merge at the end)

1. **Routine catalog + static profile** (M) — discovery profiler, AMS
   `db_routines` (changeset 229) + translation `routine_id`, save at scan
   completion, claim rewiring, uncapped closure + trigger expansion, regex
   drift fixes, run-detail row, SCAN.ROUTINE.* predicates.
2. **Invocation surface + descriptor** (L) — sidecar `/call` + guard,
   `DbAdapter.callRoutine` ×2, envelope type, ruleset v2 `SYBPG.PROC.*`
   (+ selectors, strategies ×3 copies), descriptor derivation, translator
   prompt/validator alignment, manifest descriptor + compatibility count.
3. **Proc behaviour capture** (L) — AMS proc_behaviour_* (changeset 230),
   AMVS orchestrator + tools + routes, coverage floor, baseline + pin,
   gateway proxies, frontend kind/wizard/session/baseline screens,
   PROC.CAP.* predicates.
4. **Translation workbench loop** (L) — target build action, loop engine
   (ladder/clustering/cap/callee-first/attempt history), AMVS routine-apply
   + proc-parity comparator/report (changeset 231), waivers, evidence-gated
   approval, Translations tab + reviewer redesign, pack-before-plan,
   PROC.LOOP.* / PROC.REC.* / PROC.BUILD.* predicates.
5. **Execution integration** (M) — DB-plane step 6, graduated gate, modal
   checkbox, progress cells + banner, drift staleness, views via table
   comparator, PROC.GATE.* + judge registry docs.

Order = dependency order 1 → 2 → 3 → 4 → 5; 2 and 3 can overlap once 1's
entity exists (3 needs 2's Sybase side; 4 needs 2's Postgres side).
Spec files: `agent-os/specs/2026-09-09-stored-proc-behaviour-program/`.

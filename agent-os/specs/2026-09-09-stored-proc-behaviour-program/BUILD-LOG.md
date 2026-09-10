# Stored Proc & Function Behaviour Program — Build Log

## STATUS: BUILT 2026-09-10 — Specs 1–5 on `feature/stored-proc-behaviour-program` (one commit per spec); merge to main + work-machine shakedown pending

Design of record:
`agent-os/planning/2026-09-09-stored-proc-behaviour-baseline-shaping.md`
(read FIRST: doctrine, the 20 owner-confirmed decisions, out-by-decision
list, build assumptions). Specs in this folder:

| # | Spec | Size | Depends on | Status |
|---|------|------|------------|--------|
| 1 | Routine catalog + static profile | M | — | built 2026-09-09 (8519e9fd) |
| 2 | Invocation surface + descriptor | L | 1 | built 2026-09-09 (92d276d2) |
| 3 | Proc behaviour capture | L | 1, 2 (Sybase side) | built 2026-09-09 (1e7e3682) |
| 4 | Translation workbench loop | L | 1, 2 (Postgres side), 3 | built 2026-09-10 (16ba122a) |
| 5 | Execution integration | M | 4 | built 2026-09-10 (see the per-spec notes) |

Build order 1 → 2 → 3 → 4 → 5 (2 and 3 may overlap once 1's entity
exists). One commit per spec on `feature/stored-proc-behaviour-program`;
--no-ff merge to main at the end; push.

Build conventions (standing): direct implementation with the agent-os trail
kept; anchored edits only (never bulk-rewrite files); verify failing suites
against a baseline worktree before touching them; pre-existing reds listed
in the shaping doc stay untouched; never write client-derived tokens.

### Work-machine pickup (clone + copy convention — big change ⇒ FRESH CLONE)

This is a BIG change (five specs, every service) ⇒ take a FRESH CLONE of
main after the merge and make it the new working area.

1. AMS FULL REBUILD (`mvn -q package`, restart bare). Changesets 229
   (routines), 230 (proc behaviour), 231 (workbench / attempts / target
   builds / parity reports) apply on boot. Code beyond the changesets:
   `service/discovery/DbRoutineService` (catalog upsert + DRIFT hook),
   `service/procbehaviour/ProcBehaviourService`, `controller/procbehaviour/*`,
   `controller/DbMigrationPackWorkbenchController`, `DbRoutineController`,
   translation entity/DTO/mapper/service (loop fields), `DbSurfaceInventoryService`,
   `EndpointDataEffects…/proc-calls` read.
2. REBUILD the sybase-discovery-sidecar jar (`POST /call` + `CallSqlGuard`)
   and restart it bare (no Docker on the work machine; the UTC pin in the
   Dockerfile does not apply there).
3. Restart discovery-service (routine profiler + catalog save), AMVS
   (proc capture, proc parity, routine apply), gateway (workbench routes,
   proc-behaviour proxies, gate, step 6, progress cells, manual modal
   branch), frontend.
4. Env knobs — ALL optional, defaults in the shaping doc / code:
   - discovery: `SCL_PROC_CLOSURE_MAX_DEPTH` (0 = uncapped, default).
   - AMVS: `PROC_CALL_SESSION_SET`, `PROC_CALL_MAX_ROWS_PER_RESULT_SET`,
     `PROC_CALL_MAX_RESULT_SETS`, `PROC_CALL_TIMEOUT_SECONDS`,
     `PROC_CAPTURE_QUIET_WINDOW_SECONDS` (120), `PROC_LLM_ATTEMPTS_PER_ROUTINE`,
     `PROC_LLM_ROUND_LIMIT`, `PROC_LLM_RESEARCH_ROUND_CEILING`,
     `PROC_LLM_SCENARIO_WALL_CLOCK_MS`, `PROC_LLM_TOOL_CALL_TIMEOUT_MS`.
   - gateway: `PROC_TRANSLATE_ATTEMPT_CAP` (4), `PROC_TRANSLATE_CONCURRENCY`
     (3), `PROC_TRANSLATE_EVIDENCE_LADDER`.
5. FIRST OPERATIONAL STEPS: re-run the DB scan (routine catalog + S0 pin)
   → Baselines → Stored procs → capture → Save as baseline → Pin →
   generate the DB pack → Translations tab (workbench) → Build target →
   Translate & reconcile all → review / Guidance & retry / Waive →
   Approve all reconciled → progress report → (plan) Migrate.
   Transfer = screenshots only; the shakedown checklist below is written to
   be screenshotable one line per item.

### Shakedown checklist (live) — work machine, in this order

1. AMS boots: changesets 229 / 230 / 231 applied (Liquibase log); the
   `db_routines`, `proc_behaviour_*`, `db_migration_pack_translation_attempts`,
   `db_migration_pack_target_builds`, `proc_parity_reports` tables exist.
2. DB scan → the run page shows the **Routine catalog** row (profiled /
   unparsed counts; `routine_signature_unparsed` findings name the rest).
   `GET .../db-routines?kind=procedure` lists rows with `proc_calls_json`.
3. Baselines → **Stored procs** tab → Start capture (DB creds from the
   wizard) → session runs: compensation bracket on every writing routine
   (trace `PROC.CAP.01`), coverage panel per routine, exit-outcome buckets,
   retry-uncovered / exclude / not-possible paths; Save as baseline → Pin.
4. Generate the DB pack (no plan needed) → Translations tab = workbench:
   Build target (per-invocation creds) → phases schema → data → post-load;
   `rebuild` refused honestly.
5. Translate & reconcile all → attempt 1 shows ZERO scenarios in the prompt
   evidence (trace `PROC.LOOP.01`), callee-first order (`blocked_by_callee`
   on callers), exhaustion banner after 4 attempts; Guidance & retry; Waive
   with reason; Approve is refused (409, inline reason) on an unreconciled,
   unwaived routine; Approve all reconciled emits callee-first.
6. Re-scan the DB after editing one proc body on the source → baseline page
   shows the drift banner; the routine's translation flips to `stale`
   (signal only — every button still works).
7. Progress report: "Stored procs migrated/reconciled: X of Y" + the six
   buckets + out-of-scope line BEFORE any plan runs; Live behaviour counts
   captured routines; DB-only book renders no service section.
8. Run reconciliation modal: DB-only book hides the API group; "Stored
   procs and functions" with target creds only → started / named block
   reasons (no pack / no pinned baseline / no creds).
9. Execute the DB plane: trace shows step 6 `proc-parity reconcile (DB
   plane)` after data parity; a DB-only run ends DEPLOYED with
   `proc_parity_findings` on the decision log when routines remain
   unreconciled (never halted); a multi-plane run's service start is
   blocked ONLY by routines the service code calls (`proc_parity_failed` /
   `proc_parity_unverified`), warnings listed amber on the migrate panel.
10. Views: the data-parity report carries the approved views as keyless
    relations (multiset under the bound, else `unverifiable` naming it).

### Per-spec notes

#### Spec 1 — Routine catalog + static profile (BUILT 2026-09-09)

As built:
- discovery-service: `services/databasePacks/routineTypes.ts` (engine-neutral
  `RoutineRecord`), `services/databasePacks/sybase/tsqlRoutineProfiler.ts`
  (tokenizer-level T-SQL profiler: params/defaults/OUTPUT, RETURNS, trigger
  ON/FOR, RETURN + RAISERROR sites, result-producing SELECTs with ORDER BY /
  TOP, constructs, volatile + session-user fns, non-compensatable reasons,
  SET options, reads/writes/proc_calls via the shared parsers),
  `services/databasePacks/routineCatalog.ts` (uncapped cycle-safe closures +
  trigger expansion + `orderCalleesFirst`). Pack capability `profileRoutine?`
  on `DatabaseDiscoveryPack`; Sybase pack sets `profileRoutine = profileTsqlRoutine`.
  Orchestrator phase 4c' builds `result.routines`, emits
  `routine_signature_unparsed` warning findings (category proc_catalog).
  `runManager` saves the catalog at scan completion via
  `archModelClient.bulkUpsertDbRoutines` (fail-soft, loud) and records
  `steps_payload.database.routineCatalog {status, profiled, unparsed, detail}`.
  `sqlProcHarvester.closeProcCatalog` cap → `SCL_PROC_CLOSURE_MAX_DEPTH`
  (default 0 = uncapped). `sqlDialectClassifier.extractProcCallNames` gains
  the `exec @rc =` arm.
- AMS: changeset 229 (`db_routines` + `db_migration_pack_translations.routine_id`),
  `DbRoutineEntity` / `DbRoutineRepository` / `DbRoutineService` (bulk upsert
  by natural key, stable ids) / `DbRoutineController`
  (`GET|GET/{id}|PUT /bulk` under `/api/projects/{p}/architectures/{a}/db-routines`),
  translation DTO + mapper + upsert mapping carry `routine_id`;
  `DbSurfaceInventoryService` adds catalog routines no translation row
  represents (source `routine_catalog`, same claim rule).
- gateway: `translations.ts` — `RoutineBodySource`, `indexRoutineBodies`,
  `resolveSeedSources(entries, findings, routines)` prefers the FULL catalog
  body (truncated=false, legacy_redacted=false, routine_id linked),
  `defaultFetchRoutines` (fail-soft), `syncPackTranslations` gains
  `architectureId`; the generation translation hook passes it.
  `effectMapBackfill.ts` PROC_CALL_RE now mirrors the emitter (adds the
  `{? = call}` and `exec @rc =` arms).
- frontend: `DiscoveryRunDetailPage` "Routine catalog" row (green N profiled /
  amber with unparsed count / red FAILED + reason).

Verification: discovery `tsqlRoutineProfiler.test.ts` 13/13 + 12 touched
suites 125/125 + tsc clean; gateway
`dbMigrationPackTranslationsRoutineCatalog.test.ts` 7/7 + 5 pack suites
41/41 + tsc clean; AMS compile clean + `DbRoutineServiceTest`,
`DbSurfaceInventoryServiceTest`, `DbMigrationPackTranslationServiceTest`
green; frontend `DiscoveryRunDetailPage.s0.test.tsx` 6/6.

Risk notes: the profiler is heuristic by design (statement-start SELECT
classification; parenthesis-depth `AS` finder) — unparsed headers are loud
findings, never silent.

#### Spec 2 — Invocation surface + descriptor (BUILT 2026-09-09)

As built:
- Pair ruleset `migration-pairs/sybase15-postgres18.rules.json` → version 2:
  `SYBPG.PROC.ABI.001` (shape-adaptive convention as data: return_status /
  single_result_set / out_params / rich + selection predicate + naming),
  `ERR.001` (SQLSTATE P0001 + DETAIL JSON source_error/severity/state),
  `MSG.001` (PRINT → NOTICE, advisory), `RS.ORDER.001` (ordered only with
  ORDER BY, else multiset), `RS.COLNAME.001` (case-insensitive names),
  `RS.TYPE.001` (driver-type → ruleset column-type map), `TXN.001`
  (sub-blocks; inner ROLLBACK → P0002), `VOL.001` (clock: timestamp-window),
  `VOL.002` (random: masked), `SESSION.001` (jConnect-default SET list;
  env override PROC_CALL_SESSION_SET), `CALLSITE.001` (JDBC pattern × shape
  compatibility matrix). Loader copies ×3 gain the `applies_to` selectors
  (object_kinds / constructs / dimensions), the v2 payload fields and the new
  strategy names; the AMVS copy implements `timestamp-window` + `masked`
  pairwise and treats multiset / error-source-number / advisory as
  driver-level (never "unknown"); `rulesForDimension`, `ruleById`,
  `canonicalColumnType` added.
- Sidecar `POST /call` (subagent-built, 126 module tests green): `CallRequest`
  (camelCase keys, snake_case aliases; nested or flat limits), `CallResponse`
  (snake_case envelope), `CallSqlGuard` (reasons bad_routine_name /
  system_proc_blocked / too_many_params / bad_session_set → HTTP 400
  pre-JDBC), `SybaseCallService` (writable AUTO/forced connection, session
  SETs, `{?= call}` composition, typed binds, OUT registration, result-set
  walk with sentinel cap, warnings drained, error projection with reflective
  severity/state). Clamps: rows/set [1,10000], sets [1,50], timeout
  [1,86400] (`MAX_CALL_TIMEOUT_SECONDS`). Function result = ordinal-0
  descriptor → `output_params.return_value` (+ `return_status` when integral).
- AMVS: `services/db/routineEnvelope.ts` (engine-neutral envelope +
  descriptor types), `DbAdapter.callRoutine?`, `SybaseAdapter.callRoutine`
  (→ `/call`, sends the RETURNS type as the ordinal-0 slot for functions),
  `PostgresAdapter.callRoutine` → `postgresRoutineInvoker.ts` (BEGIN → per-
  shape SELECT → refcursor FETCH ALL in descriptor order → COMMIT/ROLLBACK;
  NOTICE capture; DETAIL-JSON error projection; dedicated client from the
  UTC-pinned raw-datetime pool).
- Gateway (pack code): `dbMigrationPack/routineInvocationDescriptor.ts`
  (`deriveRoutineDescriptor`, `selectRoutineShape`, `mapRoutineArgType`,
  `renderRequiredHeader`, `renderRoutineContract` — STATIC facts only),
  `descriptorValidator.ts` (`validateDraftAgainstDescriptor`: name, IN
  order, OUT set, RETURNS form, refcursor types), `callSiteCompatibility.ts`
  (pattern classifier + matrix verdicts + honest unknowns).
  `translations.ts`: pipeline fetches the routine catalog by the pack's
  architecture, derives the contract per row (`routine_id`), the translate
  prompt carries a "Calling-convention contract" section (never scenarios),
  the draft header is validated → ONE automatic re-prompt naming violations
  → second mismatch fails the object `abi_mismatch:` (retryable); the
  descriptor summary rides `judge_verdict_json.invocation_descriptor`.
  `translationEmission.ts`: manifest gains `invocation_descriptors` (per
  routine) + `call_site_compatibility` (counts + first 500 sites +
  undescribed routines); predicates `PACK.ABI.01/.02`.
  `endpointDataEffectsClient.fetchProcCallEffects` ← new AMS read.
- AMS: `GET .../endpoint-data-effects/proc-calls` (architecture-wide
  proc-call effects via the model file; 404 without a model file).
- Frontend: pack view "Stored proc call-site compatibility" section
  (counts + needs-change rows).

Verification: AMVS `routineInvocation.test.ts` + comparator suite 32/32,
tsc clean; gateway `routineInvocationDescriptor.test.ts` + all 21 DB-pack
suites 181/181 + engineNameGuard, tsc clean; discovery tsc clean; AMS
compile + `EndpointDataEffectControllerTest` 5/5; sidecar 126/126; frontend
pack view 13/13.

Notes: the invoker runs each call in its own transaction and COMMITs — the
target-side compensation bracket (Spec 4) owns undo, as target replay does
today. The SESSION.001 SET list is the ASE login default as jConnect leaves
it; verify on the work machine against the application's actual driver
properties and override with PROC_CALL_SESSION_SET if they differ.

#### Spec 3 — Proc behaviour capture (BUILT 2026-09-09)

As built:
- AMS changeset 230 (subagent-built): `proc_behaviour_capture_sessions`
  (state machine draft→configured→running→terminal; 409 on illegal),
  `proc_behaviour_scenarios` (upsert by session+routine+name),
  `proc_behaviour_captures`, `proc_behaviour_baselines` (ONE pinned per
  architecture+kind; pin supersedes), `proc_behaviour_baseline_items`
  (`stale`/`stale_reason` + `POST /baselines/{id}/items/stale` for Spec 5
  drift), `proc_behaviour_diagnostics`. Controllers under
  `/api/projects/{p}/architectures/{a}/proc-behaviour/...`; content hash =
  sha-256 over sorted routine|scenario|envelope lines.
- AMVS (DB-native, independent of the API session model):
  `services/procCapture/{types,routineScenarioSeeds,routineCoverageFloor,
  procToolLoop,procTools,procConfig,procBaseline,procCaptureOrchestrator}.ts`,
  `services/procBehaviourClient.ts` (AMS client for db-routines +
  proc-behaviour), `routes/procCaptureSessionActions.ts`
  (`/api/proc-capture-sessions/:id/{secrets,start,status,cancel,
  retry-uncovered,exclude-routine,not-possible,save-baseline}`; start guards:
  configured + secrets + S0 pinned + catalog non-empty; 202 fire-and-forget;
  own `procRunRegistry`, never the API runManager).
  Seeds: parameter → column domains mined from `col = @param` comparisons
  (alias + statement-table resolution) for real-value sampling; plan = happy
  + one per RAISERROR site + one per non-zero RETURN + zero_rows (when
  @@rowcount) + reported-only null/default/boundary. Floor = static exit
  outcomes ∪ seeded families; buckets verified | not_exercised |
  unverifiable(reason) | excluded. Loop = proc-specific tool loop (research
  rounds free, wall clock, abort, terminal note) with tools
  get_routine_context / sample_routine_db_values / run_routine_readonly_sql /
  record_routine_scenario (sequences supported; last step = the routine) /
  execute_routine (fires through the ORCHESTRATOR's bracket; attempt budget)
  / record_routine_note. Every fire = `runCompensationBracket` over
  writes_closure ∪ trigger_expanded_writes with reads as the defensive
  union; unbracketed only when nothing resolves; non-compensatable
  constructs refuse BEFORE firing; compensation inactive → writing routines
  refused, write-free routines still capture. Double-fire for
  volatile-function routines → `volatile_cells_json` evidence. Capture fires
  with the DB credentials the user entered (readonly split observational).
  End-of-job S0 fingerprint reused; session ends completed /
  completed_with_findings / failed / cancelled with the coverage summary.
  Baseline = first accepted capture per fired scenario, keyed by body hash.
- gateway `routes/procBehaviour.ts`: AMVS action proxies + AMS data-plane
  passthrough (`/proc-behaviour/*`, `/db-routines*`) under
  `/api/v1/projects/:p/architectures/:a`; mounted in server.ts.
- frontend (subagent-built): `api/procBehaviourApi.ts`,
  `components/ProcBehaviour/` (tab on ApiBaselinesListPage, wizard scope /
  DB block / tuning, session page with default-collapsed coverage panel +
  envelope viewer + retry-uncovered/not-possible/exclude + save-as-baseline,
  baseline page with stale badges); routes in App.tsx.

Verification: AMVS `procCapture.test.ts` 13/13 + `procCaptureSessionActions.test.ts`
5/5 + tsc clean; gateway `procBehaviourRoutes.test.ts` 4/4 + tsc clean; AMS
230 `ProcBehaviourServiceTest` 7/7 + JPA context checks; frontend 16/16
(4 new suites + the page suite).

Notes: pack generation needs only `architecture_id` (no plan/book), and
the pack view lives on the delivery-plan landing, so the workbench (Spec 4)
is reachable straight after the target conversation — the design's
pack-before-plan assumption holds without a change. The proc capture's
quiet-window gap defaults to 120s (PROC_CAPTURE_QUIET_WINDOW_SECONDS, or
`capture_tuning_json.quiet_window_seconds`; 0 skips).

#### Spec 4 — Translation workbench loop (BUILT 2026-09-10)

As built:
- gateway `dbMigrationPack/evidenceLadder.ts`: the four rungs (attempt 1 =
  source + contract, ZERO scenarios; 2 = one failing scenario; 3 = one per
  failure signature; 4 = all failing), `clusterBySignature`,
  `findSpecialCasedLiterals` (overfit guard: captured input literals that
  appear in the draft but not the source), knobs from env
  (`PROC_TRANSLATE_ATTEMPT_CAP` default 4, `PROC_TRANSLATE_CONCURRENCY` 3).
- gateway `dbMigrationPack/translationReconcileLoop.ts`: the automatic
  translate → apply → reconcile → re-translate engine (`runTranslationReconcileLoop`):
  callee-first groups (Tarjan SCC; cycles loop as a group), `blocked_by_callee`
  for callers whose callee is not reconciled, best attempt kept as the draft
  on exhaustion, overfit = divergence for the ladder, evidence-gated
  `reconciled`; `verdict_json` carries `status / attempt_no / attempts (cap) /
  attempts_made / scenarios / scenarios_failing / signatures / blocked_by /
  apply_error`. Every attempt persists (AMS 231) with its evidence rung.
- gateway `dbMigrationPack/procWorkbench.ts` + `procWorkbenchClients.ts` +
  `targetBuild.ts`: the loop's real deps (LLM draft+judge via the extracted
  `draftAndJudgeObject`, AMVS apply + parity, AMS attempts/reports/builds,
  comparison-waiver rows with `dimension='proc-parity'` and targets
  `<routine>` / `<routine>::<scenario>`); target build = schema → data →
  post-load against the DECLARED target binding; `rebuild` is refused
  honestly (`rebuild_unsupported`) because the schema-apply runner has no
  drop-all — drop/recreate the database, then build.
- gateway `routes/dbMigrationPackWorkbench.ts` (base
  `/api/v1/projects/:p/db-migration-packs/:packId`): `POST/GET target/build[/status]`,
  `POST translations/translate-and-reconcile` (202) + `GET loop-status`,
  `POST translations/:id/retry-loop {guidance}`, `POST translations/:id/reconcile`,
  `POST translations/:id/waive {scope, scenario?, reason}` (reason mandatory),
  `POST translations/approve-all-reconciled`, `GET translations/baseline-status`,
  `GET translations/:id/attempts`, `GET translations/:id/parity-report`.
  The pack review route now answers 409 when a routine-linked stored
  procedure is approved without `loop_status=reconciled` or a routine
  waiver (evidence-gated approval); emission orders approved routines
  callee-first.
- AMVS `services/procParity/` (comparator: outcome / return_status /
  output_params / result_sets strict with rule-cited tolerance only;
  messages + update_counts advisory; state_delta only when both sides
  exist; signature = `dimension:first_divergence`; runner replays every
  pinned item, `unverifiable` on no descriptor / stale items / replay
  failure) + `services/db/postgresRoutineApply.ts` (drop-then-create in one
  transaction) + routes `POST /api/routine-apply/run`,
  `POST /api/proc-parity/run` (descriptors keyed by BARE routine name; one
  persisted report per routine; PROC.APPLY.01 / PROC.REC.01).
- AMS 231 (subagent): `db_migration_pack_translation_attempts`,
  `db_migration_pack_target_builds`, `proc_parity_reports`; translation
  rows gain `loop_status / current_attempt_no / best_attempt_no /
  verdict_json / parity_report_id / stale_reason` (DTO components APPENDED
  at the end, prefix unchanged); routes under the pack base
  (`translations/{id}/attempts`, `translation-attempts`, `target-builds[/latest|/{id}]`)
  and `/api/projects/{p}/architectures/{a}/proc-parity-reports`
  (`POST`, `GET /{id}`, `GET /latest?routine_id=`, `GET /latest-by-routine`).
- frontend (subagent): Translations tab = the WORKBENCH (target build +
  pinned baseline + cap header; Translate & reconcile all / Reconcile all /
  Approve all reconciled; filter Needs you | Reconciled | Blocked |
  Unverified | All — default All so nothing hides on first paint; routine
  rows with loop status / verdict / attempts; loud exhaustion banner);
  reviewer gains the behaviour verdict, failing scenarios (expected vs
  actual per dimension), attempt history with diff-vs-previous, guidance
  textarea + Guidance & retry, Waive dialog, inline 409 reason on Approve;
  `DbMigrationPackTargetBuildModal` collects per-invocation credentials
  (memory only). NO draft-editing affordance exists (owner ruling).
  "Reconcile all" iterates the per-routine route (no bulk route by design).

Verification: gateway `translationReconcileLoop` 10/10,
`dbMigrationPackWorkbenchRoutes` 6/6, all DB-pack suites green, tsc clean;
AMVS `procParity` 10/10 + `procParityRun` 4/4, tsc clean; AMS full suite
2483 run / 0 failures (231 controller + service tests, translation service
5/5); frontend 13 new + 7 existing (folder 26 files / 203 tests).

Notes: the evidence ladder starts at ZERO scenarios by owner ruling (the
LLMs over-weighted runtime evidence in spec generation); a first attempt
that cites scenarios is a PROC.LOOP.01 finding. Waivers never break
reconciliation: a waived routine is "reconciled with waivers" in every
count. The workbench needs no plan, book or service plane.

#### Spec 5 — Execution integration (BUILT 2026-09-10)

As built:
- gateway `services/migrationProcParityReconcile.ts`: `checkProcParityPreconditions`
  (pack / translate-dispositioned routines / pinned proc baseline as NAMED
  block reasons), `runProcParityForArchitecture` (descriptors from the
  routine catalog keyed by bare name, waivers, purpose `execution` |
  `manual`, one AMVS call), `createProcParityReconcileTrigger` = DB-plane
  STEP 6 (after the data-parity reconcile; target creds only — the pinned
  baseline is the source side; loud skip when creds are missing; never
  throws). Wired as `deps.triggerProcParityReconcile` in the driver defaults
  and called from `migrationDbPlaneCompletion.ts` (fail-open execute).
- gateway `services/migrationProcParityGate.ts`: the shared resolver
  (`resolveRoutineParityStates`: disposition > approval > routine waiver >
  latest report (execution purpose first) > workbench loop status; states
  reconciled / reconciled_with_waivers / divergent / unverified /
  not_captured / not_migrated / moved_to_code / dropped) + the GRADUATED
  gate (`evaluateProcParityGate` pure, `evaluateProcParityReadiness` reads):
  block reasons ONLY for routines the next plane calls (call-site edges from
  `endpoint_data_effects.path_metadata_json.proc_name`, schema stripped)
  that are divergent / not migrated (`proc_parity_failed`) or without a
  verdict (`proc_parity_unverified`); everything else = warnings with
  counts; final plane = findings only. Read failure: fail-closed for the
  service plane, a warning on the final plane. `PROC.GATE.01`.
- driver: plane-precedence check (DB → next plane) and the resume-time gate
  evaluate the proc gate beside data parity (same `parityOverride`
  break-glass); non-blocking warnings ride the start result (`warnings` on
  both `started` and `blocked`).
- DB-plane completion, FINAL plane (DB-only included): the run completes
  DEPLOYED and every non-reconciled routine lands in a `proc_parity_findings`
  decision-log entry (routines + counts + note). A dedicated
  `completed_with_findings` RUN STATUS was deliberately NOT introduced: it
  would re-block the next plane's precedence check and every status
  consumer — the findings entry IS the with-findings marker, and the
  progress report / trace narrate it.
- manual Run-reconciliation: `run_proc_parity` (request `runProcParity`) →
  target creds (body or registered) → preconditions → fire-and-forget AMVS
  run with purpose `manual`; result `procParity: started | blocked(reason)`.
  Works with no service plane.
- progress summary: `DbSectionTotals.routines` (catalog procs + functions /
  reconciled), `procsMigratedReconciled {reconciled, total, pct}` (total =
  translate-dispositioned routines; dispositioned-away tail outside it),
  `procBuckets` {notCaptured, divergent, unverified, notMigrated,
  reconciledWithWaivers, fullyReconciled, movedToCode, dropped} — a sixth
  `notMigrated` bucket was added to the shaped five because an unapproved
  translation is honestly "not on the target", not "unverified";
  `procsMigrated` kept one release. Computed from the workbench states
  BEFORE any plan runs (progress = the loop getting routines reconciled).
  Live-behaviour cell now counts captured routines too (DB-only gets an
  honest cell; complete only when every in-scope routine is captured).
- views: `defaultResolveDataParityTables` appends every APPROVED translate
  view as a KEYLESS relation (canonical multiset under the AMVS bound, else
  honest unverifiable naming the bound).
- drift (AMS, code only — no schema change): `DbRoutineService.bulkUpsert`
  detects body-hash changes on re-scan → `ProcBehaviourService.markItemsStaleForArchitecture`
  (every pinned baseline's items for those routines → `stale`,
  `body_changed`) + linked translations → `loop_status=stale`,
  `stale_reason=body_changed` (dispositioned rows untouched); the shaped
  pickup line "no AMS change" was wrong — AMS must be REBUILT.
- docs: `docs/run-judge/RUN_JUDGE_INSTRUCTIONS.md` PROC family (CAP.01/02,
  APPLY.01, BUILD.01, LOOP.01, REC.01, GATE.01) between DATA and CAP.
- frontend (subagent): Run-reconciliation modal "Stored procs and
  functions" checkbox (`rrm-check-proc`, target DB block only; API group
  hidden when the service plane is out of scope; `rrm-result-proc`);
  progress report "Stored procs migrated/reconciled" + six-bucket strip +
  out-of-scope line + catalog routines row + DB-only layout; migrate panel
  amber `mdd-migrate-warnings` (both outcomes); proc baseline page drift
  banner (`proc-baseline-drift-banner`).

Verification: gateway `migrationProcParityGate` 10/10, `migrationProcParityReconcile`
6/6, `migrationDbPlaneCompletion` +3, `migrationManualReconcileTriggers` +2,
`migrationProgressSummary` +3, `migrationDataParityReconcile` +1, driver
suites green with the gate stubbed, tsc clean; AMS `DbRoutineServiceTest`
4/4 + `ProcBehaviourServiceTest` 7/7 + test-compile clean; frontend touched
suites 46/46 (8 files) + neighbouring migrate/dashboard/rail suites 35/35,
tsc/eslint clean on the touched files.

Notes: the frontend reads `warnings` as a top-level `string[]` on BOTH
migrate outcomes (absent → no banner) and treats `procParity` on the
reconciliation result as optional (an older gateway still types); the
progress page carries `data-layout=db-only` when the service section is
null so the DB section spans.

# Stored Proc & Function Behaviour Program — Build Log

## STATUS: SHAPED 2026-09-09 — awaiting the owner's explicit build go

Design of record:
`agent-os/planning/2026-09-09-stored-proc-behaviour-baseline-shaping.md`
(read FIRST: doctrine, the 20 owner-confirmed decisions, out-by-decision
list, build assumptions). Specs in this folder:

| # | Spec | Size | Depends on | Status |
|---|------|------|------------|--------|
| 1 | Routine catalog + static profile | M | — | shaped |
| 2 | Invocation surface + descriptor | L | 1 | shaped |
| 3 | Proc behaviour capture | L | 1, 2 (Sybase side) | shaped |
| 4 | Translation workbench loop | L | 1, 2 (Postgres side), 3 | shaped |
| 5 | Execution integration | M | 4 | shaped |

Build order 1 → 2 → 3 → 4 → 5 (2 and 3 may overlap once 1's entity
exists). One commit per spec on `feature/stored-proc-behaviour-program`;
--no-ff merge to main at the end; push.

Build conventions (standing): direct implementation with the agent-os trail
kept; anchored edits only (never bulk-rewrite files); verify failing suites
against a baseline worktree before touching them; pre-existing reds listed
in the shaping doc stay untouched; never write client-derived tokens.

### Work-machine pickup (clone + copy convention — big change ⇒ FRESH CLONE)

To be completed per spec at build time. Expected shape:
1. AMS REBUILD — changesets 229 (routines), 230 (proc behaviour), 231
   (workbench/parity) apply on boot.
2. REBUILD the sybase-discovery-sidecar jar (`/call` + guard) and restart
   it bare (no Docker on the work machine).
3. Restart discovery-service, AMVS, gateway, frontend. New env knobs (all
   optional, defaults in the shaping doc): PROC_CALL_SESSION_SET,
   PROC_CALL_MAX_ROWS_PER_RESULT_SET, PROC_LLM_ATTEMPTS_PER_ROUTINE,
   PROC_TRANSLATE_ATTEMPT_CAP, PROC_TRANSLATE_CONCURRENCY,
   PROC_TRANSLATE_EVIDENCE_LADDER, SCL_PROC_CLOSURE_MAX_DEPTH.
4. FIRST OPERATIONAL STEPS: re-run the DB scan (routine catalog + S0) →
   Live behaviour → "Stored procs and functions" capture → pin → pack
   Translations tab → Build target → Translate & reconcile all.

### Shakedown checklist (live) — to be filled at build time

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

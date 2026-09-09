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

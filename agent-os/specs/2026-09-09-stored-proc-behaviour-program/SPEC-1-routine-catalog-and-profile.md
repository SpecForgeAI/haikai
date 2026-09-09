# Spec 1 — Routine Catalog + Static Profile (DB scan)

Program: `2026-09-09-stored-proc-behaviour-program` (design of record:
`agent-os/planning/2026-09-09-stored-proc-behaviour-baseline-shaping.md`).
Size M. Prerequisite for Specs 2–5.

## Goal

Give every stored procedure, function and trigger a first-class identity
in the architecture model, with its full body, parsed signature and a
deterministic static profile, produced by the existing DB scan as one user
action. Today procs exist only as findings (4KB-trimmed or 64KB-capped
bodies) and translation-queue rows; read/write sets live on the run only;
no parameter metadata exists anywhere
(`discovery-service/src/services/databasePacks/sybase/sybaseIntrospection.ts:406-414`
records the gap as `TODO(oracle-W3)`).

## Scope

IN: profiler, AMS entity + bulk upsert, save at scan completion, claim and
translation-queue rewiring, uncapped closure with trigger expansion, run
detail row, the two proc-call regex drift fixes, predicates.
OUT (by decision): a full T-SQL parser (tokenizer-level profiler only, as
Spec F ruled); candidate/review flow for routines (they are facts).

## Design

### Discovery — profiler (pack code)

- New `discovery-service/src/services/databasePacks/sybase/tsqlRoutineProfiler.ts`
  exporting `profileRoutine(source: {name, objType: 'P'|'F'|'TR', text})`
  → `RoutineRecord` (generic type in `databasePacks/types.ts`):
  - identity: `schema_name` (default `dbo`), `routine_name`, `routine_kind`
    (`procedure|function|trigger`), `language: 'TSQL'`, `full_body`,
    `body_hash` (sha256 of whitespace-normalised body; keep `bodyMd5` for
    merge parity with `sqlProcHarvester.ts:53-56`).
  - `params[]`: `{name, ordinal, sybase_type, direction: 'in'|'output',
    default_literal|null}` parsed from the header between
    `CREATE PROC[EDURE] <name>` and the body `AS` (parenthesised or bare
    lists; `OUT`/`OUTPUT`; `= default`). Functions: `(@p type, …) RETURNS
    <type>` → `returns_type`. Triggers: `ON <table> FOR insert|update|delete`
    → `trigger_on_table`, `trigger_events[]`.
  - `profile`: `return_sites[] {value: int|null, expr?}`,
    `return_status_trivial` (all RETURN bare/0), `raiserror_sites[]
    {number?, severity?, text_preview}`, `result_selects[] {ordinal,
    has_order_by, has_top, select_list_static?}` (top-level SELECT not
    INTO/assignment/subquery — statement-start heuristic),
    `max_result_sets`, `constructs[]` (temp_table, cursor, transaction
    control, dynamic_sql, system_proc, remote_call, cross_db_dml, waitfor,
    set_rowcount, set_nocount), `volatile_functions[]` (getdate, newid,
    rand, @@identity, @@spid), `session_user_functions[]` (suser_name,
    user_name, host_name), `non_compensatable_reasons[]` (derived: system
    procs, remote, cross-db DML, dynamic SQL, waitfor).
  - `reads[]`, `writes[]`, `proc_calls[]` via the existing parsers
    (`effectCandidateEmitter.ts:117-133, 182, 293`).
- Closure: `sqlProcHarvester.ts:333-362 closeProcCatalog` depth cap 3 →
  cycle-safe uncapped BFS (`SCL_PROC_CLOSURE_MAX_DEPTH`, default 0 =
  uncapped). Trigger expansion: for each written table, union the writes of
  triggers ON that table → `writes_closure[]`, `reads_closure[]`,
  `trigger_expanded_writes[]`.
- Orchestrator phase 4c in `databasePackOrchestrator.ts` (after 4b
  `harvestProcSources`, `:409-429`): profile every source; envelope gains
  `routines: RoutineRecord[]`; unparsable header → `routine_signature_unparsed`
  finding with the header excerpt (never silent).
- Save at scan completion: in `runManager.ts` where `proc_sources` land
  (`:3736`), call AMS `PUT …/db-routines/bulk` with the records; outcome on
  `steps_payload.database.routineCatalog {status, profiled, unparsed,
  error}` (fail-soft, loud — same shape as `s0Snapshot`).

### AMS — entity (changeset 229)

`229-db-routines.sql`:
- `db_routines` (id uuid pk, project_id, architecture_id, discovery_run_id,
  schema_name, routine_name, routine_kind, language, full_body text,
  body_hash, body_md5, params_json jsonb, returns_type, trigger_on_table,
  trigger_events_json, profile_json jsonb, reads_json, writes_json,
  proc_calls_json, reads_closure_json, writes_closure_json,
  trigger_expanded_writes_json, source ('live'|'repo'), harvested_at,
  created_at, updated_at); unique (architecture_id, schema_name,
  routine_name, routine_kind); index (architecture_id, routine_kind).
- `ALTER TABLE db_migration_pack_translations ADD COLUMN routine_id uuid NULL`
  + index.
- Entity `model/entity/discovery/DbRoutineEntity`, repository, service
  `DbRoutineService` (bulk upsert by natural key, no truncation), controller
  `DbRoutineController`: `GET /api/v1/projects/{p}/architectures/{a}/db-routines`
  (`?kind=&schema=&q=`), `GET …/db-routines/{id}`, `PUT …/db-routines/bulk`.
  Snake_case wire, no annotation (`CLAUDE.md`).
- `DbSurfaceInventoryService.java:44-58`: routine counts + claims read
  `db_routines` when present for the architecture (fallback: introspection
  counts); `unclaimedStoredProcedures` unchanged in meaning.

### Gateway / frontend

- `dbMigrationPack/translations.ts:245-320 resolveSeedSources`: prefer the
  routine entity (by schema+name+kind) → `source_body = full_body`,
  `truncated = false`, link `routine_id`; finding-body path stays as
  fallback. AMS client `listDbRoutines`.
- Regex drift fixes: `gateway/src/services/effectMapBackfill.ts:191-192`
  PROC_CALL_RE ← copy of `effectCandidateEmitter.ts:117`;
  `discovery-service/src/services/findings/sqlDialectClassifier.ts:346`
  gains the `exec @rc =` arm. Parity test on shared fixture strings.
- `DiscoveryRunDetailPage.tsx` (beside the S0 row `:1389-1412`): "Routine
  catalog" row: green `N profiled` / amber `M signatures unparsed` / red
  `FAILED + reason`.

### Predicates

`SCAN.ROUTINE.01` profiled == harvested; `SCAN.ROUTINE.02` unparsed == 0
(actual lists names). Stage derives from the prefix (docs/trace-logging.md).

## Verification (lean)

- Profiler fixtures (invented vocabulary): params with defaults/OUTPUT,
  parenthesised and bare lists, function with RETURNS, trigger ON/FOR,
  multiple result SELECTs incl. INTO and assignment (excluded), RAISERROR
  three forms, RETURN forms, #temp, cursor, begin/commit/rollback tran,
  exec(@sql), sp_/xp_, 4-part remote, cross-db 3-part DML, getdate/newid,
  suser_name, nested `exec @rc = proc`.
- Closure: uncapped chain of 6, cycle A→B→A, trigger expansion.
- AMS: controller/service tests in the existing style (bulk upsert
  idempotent; unique key; unbounded body).
- Gateway: seed-source preference test; regex parity test.
- Frontend: run-detail row vitest (three states).

## Acceptance

- After a DB scan, every harvested routine is a `db_routines` row with a
  parsed signature or a loud `routine_signature_unparsed` finding.
- Translation queue seeds from the entity body; the 64KB truncation path is
  never taken when the entity exists.
- Claims and counts on the DB surface inventory are unchanged in value.

## Pickup (work machine, clone + copy)

AMS REBUILD (changeset 229 on boot); restart discovery-service, gateway,
frontend. Re-run the DB scan once to populate routines (S0 pins as usual).

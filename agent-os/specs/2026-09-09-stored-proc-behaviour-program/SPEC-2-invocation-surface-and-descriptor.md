# Spec 2 — Invocation Surface + Calling-Convention Descriptor

Program: `2026-09-09-stored-proc-behaviour-program`. Size L. Depends on
Spec 1 (routine entity + profile). Unlocks Spec 3 (Sybase side) and Spec 4
(Postgres side).

## Goal

Make routines invocable by the tool on both engines through one
engine-neutral envelope, and make translated routines invocable by the
application through one deterministic, shape-adaptive calling convention
carried as pair-ruleset data and stamped per routine into the pack manifest.
Today both SQL guards deny EXEC/CALL
(`sybase-discovery-sidecar/.../SidecarSqlGuard.java:66-82`,
`api-migration-validation-service/src/services/db/sqlGuard.ts:20-38`), the
sidecar has no CallableStatement path, and the translator asks for "one
PL/pgSQL function" with no contract
(`gateway/src/services/dbMigrationPack/translations.ts:760-785`).

## Scope

IN: sidecar `/call` + guard; `DbAdapter.callRoutine` for Sybase and
Postgres; envelope type; ruleset v2 `SYBPG.PROC.*` + selectors + strategies
(×3 byte-identical loader copies); descriptor derivation; translator prompt
+ validator alignment; manifest descriptor + call-site compatibility count;
pack-view chip. OUT (by decision): any free-form SQL execution; procedures
via CALL (functions only — pgjdbc-compatible).

## Design

### Pair ruleset v2 (`migration-pairs/sybase15-postgres18.rules.json`)

`version: 2`. `applies_to` gains optional `object_kinds[]`, `constructs[]`,
`dimensions[]` (existing `column_types[]` untouched). New rules (comparison
strategies added to the generic library under neutral names, in all three
loader copies — locate via `migrationPairRules.ts` in AMVS/gateway/discovery):
- `SYBPG.PROC.ABI.001` shape classes (data): `return_status`,
  `single_result_set`, `out_params`, `rich`; selection predicate over the
  profile (`max_result_sets`, OUTPUT params, `return_status_trivial`);
  naming: function = routine name lower-case in the mapped schema; OUT
  names = source names without `@`, lower-case; `return_status` OUT;
  refcursors `rs1..rsN` in source order.
- `SYBPG.PROC.ERR.001` error carriage: SQLSTATE `P0001` + DETAIL JSON
  `{source_error, severity, state}`; compare on `source_error`; text advisory.
- `SYBPG.PROC.MSG.001` PRINT → RAISE NOTICE; dimension `messages` advisory.
- `SYBPG.PROC.RS.ORDER.001` ordered compare only when the producing SELECT
  has ORDER BY, else canonical multiset (strategy `multiset`).
- `SYBPG.PROC.RS.COLNAME.001` lower-case unquoted names; compare
  case-insensitively (strategy `collation-case`, existing).
- `SYBPG.PROC.RS.TYPE.001` JDBC/PG type → ruleset column-type mapping so
  the existing DT/STR/NUM cell rules apply to result-set cells.
- `SYBPG.PROC.TXN.001` inner begin/commit → sub-blocks; inner rollback →
  RAISE with SQLSTATE `P0002` marker (caller aborts).
- `SYBPG.PROC.VOL.001` clock-derived cells: strategy `timestamp-window`
  (non-null, within the run window); random/newid: strategy `masked`;
  identity → `SYBPG.SEQ.001`.
- `SYBPG.PROC.SESSION.001` session profile: the SET list equal to jConnect
  connection defaults (pinned at build from jConnect documentation:
  ansinull, arithabort, chained, quoted_identifier, textsize, rowcount 0,
  nocount off, dateformat, transaction isolation level); env override
  `PROC_CALL_SESSION_SET`.
- `SYBPG.PROC.CALLSITE.001` compatibility matrix: JDBC call pattern
  (`{? = call}`, `{call}`+executeQuery, registered OUT, SimpleJdbcCall
  withProcedureName/withFunctionName, `exec` text, error-number branching)
  × shape → `compatible | needs_change(reason)`.

### Sidecar — `POST /call`

- `CallRequest`: connection fields as `QueryRequest`; `schemaName`,
  `routineName`, `routineKind`, `params[] {name, ordinal, sybaseType,
  direction, value|null}`, `returnStatus`, `sessionSet[]`, `limits
  {maxRowsPerResultSet, maxResultSets, queryTimeoutSeconds}`. NO SQL text
  field exists — the service composes `{?= call schema.name(?,…)}` itself.
- `CallSqlGuard`: identifier parts `^[A-Za-z_][A-Za-z0-9_]*$` (≤3 parts);
  `sp_`/`xp_` blocked unless in `ALLOWLISTED_INTROSPECTION_PROCS`;
  `sessionSet` lines must match an allowlist of SET forms; params ≤ 255.
- `SybaseCallService`: writable connection via the existing strategies
  (`SybaseQueryService.java:201-238`), autocommit on, apply session SETs,
  typed binds (Sybase type → JDBC setter map; NULL by type), OUT registered,
  `execute()` then loop `getResultSet()/getMoreResults()/getUpdateCount()`
  until exhausted (sentinel row cap per set → `truncated`), OUT values +
  return status read after the loop, warnings drained (statement +
  connection; PRINT and severity ≤10 messages), exceptions projected
  `{number: getErrorCode, sqlstate, severity (driver subclass when
  exposed, else parsed), message}`. Timeout clamp `[1, 86400]`
  (separate constant from the `/query` 300s clamp).
- `CallResponse` = the envelope below in JSON.

### Envelope (engine-neutral, AMVS `services/db/routineEnvelope.ts`)

```
RoutineInvocationEnvelope {
  outcome: 'success' | 'error',
  return_status: number | null,
  output_params: Record<string, unknown>,
  result_sets: [{ ordinal, columns: [{name, type}], rows: unknown[][],
                  row_count, truncated }],
  update_counts: number[],
  messages: [{ kind: 'print'|'info'|'raiserror', number?, severity?, text }],
  error: { number?, sqlstate?, severity?, message, detail? } | null,
  timing_ms, session: { login, set_options: string[] }
}
RoutineDescriptor { shape, pg_schema, pg_function, args[] {name, pg_type,
  source_param}, out_params[], refcursors[], return_status_carriage,
  error_carriage, session_profile_rule, confidence: 'static'|'capture_refined' }
```

### AMVS adapters

- `DbAdapter.callRoutine?(req: RoutineInvocationRequest): Promise<Envelope>`
  (optional method; free SQL guard untouched).
- `SybaseAdapter.callRoutine` → sidecar `/call` via `postJson`/long fetch.
- `PostgresAdapter.callRoutine(descriptor, args)`: dedicated client from the
  same pool (types + `TimeZone=UTC`): BEGIN; shapes 1–3 `SELECT * FROM
  fn($1..$n)` → map scalar / rows / OUT columns; `rich` → OUT row with
  refcursor names → `FETCH ALL FROM "<name>"` in descriptor order; NOTICE
  via `client.on('notice')`; COMMIT (the bracket owns undo); on error
  ROLLBACK + projection `{sqlstate, message, detail (JSON → source_error),
  hint, constraint}`.

### Gateway (pack code)

- `dbMigrationPack/routineInvocationDescriptor.ts`: `deriveDescriptor(
  routine, ruleset, captureShape?)` (arg PG types via the existing
  `typeMapping`; confidence).
- `translations.ts`: `KIND_INSTRUCTIONS` for procedure/function become
  descriptor-driven (exact CREATE FUNCTION header to emit, OUT names,
  refcursor protocol, ERR/MSG/TXN/RS rules, lower-case names, keep ORDER
  BY); `buildTranslationPrompt` adds the signature + profile summary as the
  static contract — NO captured scenarios (evidence enters only through
  Spec 4's ladder).
- `translationValidators.ts`: `validateDraftAgainstDescriptor` (header
  regex: name, arg count/names/order, OUT names, RETURNS form) →
  `abi_mismatch` → one automatic re-prompt within the same attempt, then
  the attempt fails with the reason.
- `dbMigrationPack/callSiteCompatibility.ts`: AMS `endpoint_data_effects`
  proc_call edges (`path_metadata_json.query_text`, `proc_name`) →
  pattern class → matrix rule → `{compatible, needs_change[] {endpoint_key,
  routine, pattern, reason}, unknown}`.
- Manifest (`translationEmission.ts:180-217` section): per routine
  `invocation_descriptor`; pack-level `call_site_compatibility`.
  Pack view: compatibility chip + needs-change list in manifest highlights.

### Predicates

`PACK.ABI.01` every translate-dispositioned routine has a descriptor;
`PACK.ABI.02` compatibility computed (known/unknown counts);
`EXEC.CALL.01` `/call` guard rejections are loud (test-only).

## Verification (lean)

- Sidecar: guard tests (identifiers, sp_/xp_, SET allowlist); envelope
  mapping with a JDBC fake (multi result set, OUT, return status, warnings,
  error projection, truncation).
- AMVS: Postgres `callRoutine` with a fake client per shape (refcursor
  order, notices, error DETAIL parsing); Sybase request mapping.
- Gateway: descriptor derivation table (profile → shape, names, types);
  validator header cases; compatibility classification cases; ruleset
  schema validation for v2 selectors (all three loaders).
- `engineNameGuard` counts updated exactly for the new pack-code files.

## Acceptance

- A routine in the catalog can be invoked on Sybase through AMVS and
  returns the full envelope; a translated routine can be invoked on
  Postgres per its descriptor and returns the same envelope shape.
- Every translated routine's draft header matches its descriptor or the
  attempt fails loudly with `abi_mismatch`.
- The pack manifest reports the call-site compatibility count.

## Pickup

Sidecar jar REBUILD + restart (bare on the work machine); restart AMVS,
gateway, frontend. Ruleset file is data (copied with the clone).

# Spec 3 — Proc Behaviour Capture (Live behaviour, second kind)

Program: `2026-09-09-stored-proc-behaviour-program`. Size L. Depends on
Spec 1 (routines) and Spec 2 (Sybase `callRoutine`, session profile,
envelope).

## Goal

Capture, at S0, LLM-generated scenarios for every in-scope routine against
the current-state database, bracketed by the derived compensation engine,
and pin the result as a proc behaviour baseline that the workbench (Spec 4)
and the execution check (Spec 5) replay. Mirrors the API capture posture
(scenario generation, coverage floor, retry-uncovered, exclude-with-reason,
save-as-baseline, pin) but is DB-native and independent of any API session.

## Scope

IN: AMS proc_behaviour_* tables (changeset 230), AMVS orchestrator + tools
+ routes, deterministic seeds, sequences, volatility double-fire, coverage
floor, baseline + pin, gateway proxies, frontend kind/wizard/session/
baseline screens, predicates. OUT (by decision): scenario file import;
side-channel observation; standalone trigger DML scenarios.

## Design

### AMS (changeset 230, all snake_case)

- `proc_behaviour_capture_sessions` (id, project_id, architecture_id, name,
  status: draft|configured|running|completed|completed_with_findings|
  failed|cancelled, kind: current|target, scope_routine_ids_json,
  db_config_redacted_json, session_profile_json, capture_tuning_json,
  coverage_summary_json, s0_fingerprint_json, started_at, completed_at,
  created_at, updated_at).
- `proc_behaviour_scenarios` (id, session_id, routine_id, scenario_name,
  scenario_type: happy_path|error_path|zero_rows|boundary|null_param|
  default_param|business_edge|sequence, generation_source: db_seed|
  llm_generated|llm_refined, inputs_json [{name, value, is_null}],
  sequence_json (steps[] {routine_id, inputs_json}) | null, status:
  proposed|fired|excluded, exclusion_reason, notes, created_at; unique
  (session_id, routine_id, scenario_name)).
- `proc_behaviour_captures` (id, session_id, scenario_id, routine_id,
  attempt_number, envelope_json, state_delta_json, volatile_cells_json,
  bracket_outcome, duration_ms, error_type, error_message, accepted,
  captured_at).
- `proc_behaviour_baselines` (id, session_id, name, status: draft|pinned|
  superseded, kind, s0_fingerprint_json, content_hash, routine_count,
  scenario_count, created_at). One pinned per (architecture, kind).
- `proc_behaviour_baseline_items` (id, baseline_id, routine_id,
  routine_body_hash, scenario_id, scenario_name, scenario_type,
  exit_outcome: success|return:<n>|error:<n>, inputs_json, sequence_json,
  expected_envelope_json, state_delta_json, volatile_cells_json,
  business_notes, stale boolean default false, stale_reason).
- `proc_behaviour_diagnostics` (id, session_id, routine_id,
  diagnostic_type allowlist: routine_skipped | non_compensatable |
  bracket_residue | coverage_floor_unmet | excluded_by_user | not_possible
  | captured_as_error | result_set_truncated | login_dependent, message,
  detail_json, created_at).
- Controllers: sessions CRUD + transitions (draft→configured→running→
  terminal; same state machine shape as API sessions), scenarios batch,
  captures batch, baselines + items batch + `pin`, diagnostics.

### AMVS — orchestrator

- Routes `src/routes/procCaptureSessionActions.ts` (mounted in
  `routes/index.ts`): `POST /api/proc-capture-sessions/:id/secrets` (DB
  block; optional readonly split reused for observation reads), `/start`
  (202; guards: configured, secrets loaded, S0 pinned and fingerprint
  verified, scope routines resolved from AMS), `/status`, `/cancel`,
  `/closure-status`, `/retry-uncovered` (routine ids; 202), `/exclude-routine`
  (reason), `/not-possible` (reason), `/save-baseline` (+ pin).
- `services/procCapture/procCaptureOrchestrator.ts`:
  1. Load routines by scope; order by call depth (callees first) so
     sequences can chain; skip `dispositioned` (rewrite_in_app/drop from
     the translation queue when a pack exists — informational only, not a
     dependency).
  2. Per routine build `RoutineContext`: body, params, profile, referenced
     tables + columns (metadata index), seeded families =
     ruleset `construct_refs` ∩ profile constructs, DB-mined parameter
     domains (`column = @param` comparisons → `sample_db_values` on that
     column, bounded; FK parents for id-like params).
  3. Preflight refusal: `profile.non_compensatable_reasons` non-empty →
     diagnostic `non_compensatable`, bucket `unverifiable`, routine skipped
     BEFORE any fire (fail closed). Login-dependent functions → diagnostic
     `login_dependent` (information).
  4. Scenario planning: `defaultRoutineScenarioSet` (deterministic: happy
     path from mined domains; one per RAISERROR site; zero-row path when
     `@@rowcount` branches; null/default variants) then the LLM loop
     (`runScenarioLoop` reuse; research rounds free; budgets
     `PROC_LLM_ATTEMPTS_PER_ROUTINE` default 15, round limits as API).
  5. Fire via `execute_routine` inside `runCompensationBracket` (tables =
     `writes_closure ∪ trigger_expanded_writes`, readTables =
     `reads_closure`; `fire` = adapter `callRoutine` with the session
     profile SETs); envelope + `computeStateDelta`; bracket outcome on the
     capture; residue → heal-not-halt per remediation rules.
  6. Sequences: `record_routine_scenario` accepts `steps[]`; fired inside
     ONE bracket; id facts learned from output params / result-set cells
     (`_idFacts` analogue) feed later steps.
  7. Volatility: routines with `volatile_functions` non-empty fire each
     accepted scenario twice; differing cells → `volatile_cells_json`
     (evidence) on the capture/item.
  8. Coverage: `routineCoverageFloor.ts` — denominator = distinct RETURN
     values + RAISERROR sites + success + seeded families present;
     numerator = distinct `exit_outcome`s observed + families exercised;
     reported-only kinds excluded from the floor; per-routine waiver via
     `not-possible`/exclude with reason. Session roll-up in
     `coverage_summary_json`.
  9. End-of-job fingerprint + quiet window reuse; session terminal status
     `completed` / `completed_with_findings`.
- Tools (`services/tools/`): `get_routine_context` (research), `execute_routine`
  (fires; threads `BracketCallHooks`), `record_routine_scenario`
  (routine-keyed; validates param names/types; sequences); reuse
  `list_db_metadata`, `sample_db_values`, `run_readonly_sql`.
- Prompt `buildRoutineScenarioPrompt`: the source is the spec; target each
  branch and exit outcome; use the seeded families; resolve real values
  from the database; chain steps only when state must exist; never invent
  ids; record every scenario before firing.
- Save-as-baseline: canonical capture per scenario = the first accepted
  capture with bracket outcome clean|compensated; items carry
  `routine_body_hash`; pin supersedes the previous pinned baseline of the
  kind; `s0_fingerprint_json` from the session.

### Gateway

Proxies `…/architectures/:a/proc-behaviour/capture-sessions/:id/<action>`
(action allow-list + registration loop, as
`routes/apiMigrationValidation.ts:539-562, 731-745`), AMS proxies for
sessions/baselines/items/diagnostics lists.

### Frontend

- `components/ProcBehaviour/`: third tab "Stored procs and functions" in
  `ApiBaselinesListPage.tsx` (sessions + baselines lists, same stylesheet).
- `StartProcCaptureSessionWizard.tsx`: Step 1 scope (routine table: kind,
  caller-less flag, non-compensatable flag, dispositioned flag; select
  all/filter); Step 2 DB credentials (the DB block + readonly fields lifted
  from the API wizard step 3) + session profile display; Step 3 tuning
  (attempts per routine, result-set cap) + Start. No base URL, no API auth.
- `ProcCaptureSessionDetailPage.tsx`: routine coverage panel (default
  collapsed), scenarios/captures with an envelope viewer (result sets as
  grids, OUT params, messages, error, state delta), retry-uncovered modal
  with Not-possible, exclude-with-reason, Save-as-baseline modal.
- `ProcBaselineDetailPage.tsx`: items, envelope viewer, pin state, S0
  fingerprint, stale badges.
- `api/procBehaviourApi.ts` (dual-accept `coerce` idiom).

### Predicates

`PROC.CAP.OPS.01` scope routines resolved; `PROC.CAP.COV.01` floor met per
routine (actual lists unmet); `PROC.CAP.STATE.01` every fired scenario
clean|compensated|healed, end-of-job fingerprint matches S0;
`PROC.CAP.BASE.01` baseline pinned with S0 fingerprint.

## Verification (lean)

- Orchestrator with fakes (adapter, LLM, AMS): planning seeds, refusal
  preflight, bracket integration, sequences + id facts, double-fire
  volatility, coverage floor, save/pin.
- Tool validation tests; coverage floor pure tests.
- AMS controller tests (state machine, unique keys, pin supersede).
- Frontend vitest: wizard steps, tab, session page states, baseline page.

## Acceptance

- A session over the catalog produces, per routine, either a set of
  scenarios with envelopes meeting the floor, or a loud diagnostic naming
  why not; the DB is at S0 at the end.
- A pinned proc baseline exists with items keyed by routine body hash.

## Pickup

AMS REBUILD (changeset 230); restart AMVS, gateway, frontend. Requires
Spec 2's sidecar `/call` running.

# Spec 4 — Translation Workbench Loop (pack Translations tab)

Program: `2026-09-09-stored-proc-behaviour-program`. Size L. Depends on
Specs 1–3 (routines, Postgres `callRoutine` + descriptor, pinned proc
baseline). The centre of the program.

## Goal

Turn the pack's Translations tab into a workbench: build the target
database from the pack, then for every translate-dispositioned routine run
translate → apply → reconcile → re-translate-with-evidence automatically
(callee-first, attempt cap, evidence ladder) until it reconciles or the
cap is reached, and gate approval on evidence. Proc parity reports are the
source of truth (mirrors data parity: reports + waivers, no reconciliation
breaks).

## Scope

IN: target build action, loop engine, AMVS routine-apply + proc-parity
comparator/report, attempt history, waivers, evidence-gated approval,
Translations tab + reviewer redesign, pack-before-plan, predicates.
OUT (by decision): manual-step loop; direct draft editing; scenario
carriage into specs.

## Design

### AMS (changeset 231)

- `db_migration_pack_target_builds` (id, pack_id, project_id,
  target_binding_json, status: running|succeeded|failed, phases_json
  {schema, data, translations: {status, started_at, ended_at, error}},
  s0_fingerprint_json, pack_version, rebuild boolean, started_at, ended_at).
- `db_migration_pack_translation_attempts` (id, translation_id,
  attempt_no, draft_content, judge_verdict_json, apply_result_json,
  parity_report_id, verdict: reconciled|divergent|apply_failed|
  abi_mismatch|overfit_suspected|blocked_by_callee, evidence_rungs_json,
  guidance_text, created_at).
- `db_migration_pack_translations` + columns: loop_status (idle|queued|
  translating|applying|reconciling|reconciled|exhausted|apply_failed|
  unverified|stale|blocked_by_callee|dispositioned), current_attempt_no,
  best_attempt_no, verdict_json, parity_report_id, stale_reason.
- `proc_parity_reports` (id, project_id, architecture_id, pack_id,
  routine_id, baseline_id, translation_attempt_id, purpose: workbench|
  execution|manual, status: clean|clean_with_waivers|divergent|
  unverifiable, migration_pair, ruleset_version, summary_json,
  report_json (per-scenario results), created_at). `GET latest` per routine
  and per pack; list by purpose.
- Waivers: `api_behaviour_comparison_waivers` (generic, changeset 206) with
  scope `proc-parity`, target `<schema.routine>` or
  `<schema.routine>::<scenario>`, dimension, reason.

### AMVS

- `POST /api/routine-apply/run`: target creds; `{descriptor, draft_sql,
  drop_first: true}`; one transaction: `DROP FUNCTION IF EXISTS` (by
  descriptor signature) + CREATE; returns `{ok, error {sqlstate, message,
  position}}`.
- `POST /api/proc-parity/run` (202 + `runManager`/closure poll): target
  creds, baseline id, routine scope, purpose; per routine, per item:
  target-side bracket (`recStateDiscipline` reuse) → `callRoutine` per
  descriptor (sequences step-wise in one bracket) → envelope → comparator
  → per-scenario result; report persisted; `PROC.REC.01`.
- `services/procParity/procParityComparator.ts` (generic; cell engine
  reuse `compareWithRules`/`canonicalize`): dimensions in order —
  `outcome` (success/error; error by `source_error` per ERR.001),
  `return_status`, `output_params` (per param, typed), `result_sets`
  (count; per set: columns [COLNAME rule], row count, rows ordered per
  RS.ORDER or canonical multiset; cells via RS.TYPE mapping → DT/STR/NUM
  rules; VOL rule + `volatile_cells_json` evidence), `messages` (advisory),
  `state_delta` (`compareStateDeltas`), `update_counts` (advisory).
  Precondition: latest data-parity divergent tables ∩ routine reads →
  `unverifiable(upstream_data_divergence)`. Truncated sets →
  `unverifiable(result_set_truncated)`. Verdict ladder match | tolerated
  (rules cited) | divergent (dimension) | unverifiable (reason).
  Failure signature = dimension + first divergent column/field.

### Gateway (pack code)

- Routes (`routes/dbMigrationPack.ts`): `POST /:packId/target/build`
  (per-invocation target creds as `verify`; `{rebuild}`; 202 +
  `GET /:packId/target/builds/:buildId`); `POST /:packId/translations/
  translate-and-reconcile` (optional routine scope; 202 + status);
  `POST /:packId/translations/:id/retry` ({guidance}); `…/:id/reconcile`;
  `…/:id/waive` ({scope: scenario|routine, target, dimension, reason});
  review route: approve requires `reconciled` or a routine/scenario waiver
  covering every failing scenario, else 409 with the reason;
  `approve-all-reconciled`.
- `services/dbMigrationPack/targetBuild.ts`: chain schema-apply
  (structural) → data-migration → schema-apply (post-load) by factoring the
  step functions out of `migrationDbPlaneCompletion.ts` into a run-agnostic
  module both callers use; rebuild = Liquibase drop-all first; records the
  build row; stamps the loaded S0 fingerprint.
- `services/dbMigrationPack/translationReconcileLoop.ts` (deps injectable:
  translate, judge, apply, reconcile, persist, clock):
  - order: routines with empty `proc_calls` first; a caller is queued only
    when every callee is `reconciled` (or waived); otherwise
    `blocked_by_callee`; cycles applied together and reconciled as a group.
  - per routine: attempts 1..`PROC_TRANSLATE_ATTEMPT_CAP` (4): translate
    (prompt = Spec 2 contract + evidence rung) → judge (+ overfit check:
    captured input literals present in the draft but absent from the
    source → `overfit_suspected`, treated as divergent) → apply
    (`apply_failed` carries the error into the next rung) → reconcile
    (all scenarios, always) → verdict; stop on `reconciled`.
  - evidence ladder `PROC_TRANSLATE_EVIDENCE_LADDER` (default
    `none,one,cluster,full`): rung 1 none; rung 2 one failing scenario
    (inputs + the divergent dimension, expected vs actual for that
    dimension only); rung 3 one representative per failure signature;
    rung 4 all failing scenarios with full envelopes. Framing: "the source
    is the specification; these are failing tests; do not special-case
    their inputs".
  - attempt rows persisted; on exhaustion `best_attempt_no` = fewest
    failing scenarios and its draft becomes `draft_content`;
    `loop_status = exhausted`.
  - `unverified` when the pinned baseline has no items for the routine
    (translation proceeds judge-only; approval needs a routine waiver).
  - concurrency `PROC_TRANSLATE_CONCURRENCY` (3); reuses the rate-limit
    cooldown; every state change traced.
- Emission (`translationEmission.ts`): translations changeset ordered
  callee-first; manifest per-routine `verdict_summary` + `target_build_id`.
- Pack-before-plan: `MigrationDeliveryPlanRoute` already mounts the pack
  view beside the book list; ensure `generate` resolves the target binding
  from captured decisions without a book (fix if it currently requires
  one); plan creation reuses a fresh pack.

### Frontend (`DbMigrationPackTranslationsTab.tsx`, reviewer)

Header: target build status (+ Build/Rebuild modal with per-invocation
creds and phase progress), pinned proc baseline status (S0, scenario and
routine counts), attempt cap. Actions: Translate & reconcile all, Reconcile
all, Approve all reconciled; filters (Needs you | Reconciled | Blocked |
Unverified | All). Row columns: routine, kind, scenarios, attempts, loop
status, verdict (match n of m / divergent n / blocked by <callee> / no
scenarios / apply failed), review state. Reviewer additions: failing
scenarios with expected vs actual per divergent dimension, attempt history
with diff vs previous attempt, guidance field + "Guidance & retry", waive
dialog (scope + reason), disposition control, approve gating message.
`dbMigrationPackApi.ts` extensions.

### Predicates

`PROC.BUILD.01` all three build phases succeeded; `PROC.LOOP.01` every
translate-dispositioned routine reached a terminal loop state;
`PROC.LOOP.02` no caller reconciled before its callees; `PROC.REC.01` a
parity report exists per reconciled routine.

## Verification (lean)

- Loop engine with fakes: ladder rung contents, clustering, cap, best
  attempt, callee-first, blocked_by_callee, cycles, stale, overfit flag,
  apply-failed rung.
- Comparator: dimension matrix, ordering rule, multiset, error mapping,
  volatility (rule + evidence), upstream precondition, truncation.
- Target build chain with fakes; review-route gating; AMS controllers.
- Frontend vitest: tab states/filters, reviewer evidence + retry, build
  modal, approve gating.

## Acceptance

- Translate & reconcile all drives every routine to a terminal state with
  attempt history; exhausted routines surface with the best attempt and
  the surviving failure signatures.
- Approve is enabled only with evidence or a recorded waiver.
- The loop runs before any plan exists.

## Pickup

AMS REBUILD (changeset 231); restart gateway, AMVS, frontend.

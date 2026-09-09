# Spec 5 — Execution Integration (DB plane, gate, modal, progress, drift)

Program: `2026-09-09-stored-proc-behaviour-program`. Size M. Depends on
Spec 4 (proc parity route + reports).

## Goal

Re-check proc behaviour inside the DB plane at execution, apply the
graduated gate policy, expose proc parity on the manual reconciliation
modal, report "Stored procs migrated/reconciled: X of Y" with buckets on
the progress report, treat source drift as a signal, and reconcile views
through the table comparator — all working with no service plane at all.

## Scope

IN: DB-plane step 6, `migrationProcParityGate`, migrate-panel warnings,
run-reconciliation modal checkbox + DB-only rendering, progress cells +
banner, drift staleness, views in data parity, judge registry docs.
OUT (by decision): any block on plan start; blocks on routines the next
plane does not depend on.

## Design

### DB-plane step 6

`migrationDbPlaneCompletion.ts` after the data-parity block (`:497-510`):
`deps.triggerProcParityReconcile` via new
`services/migrationProcParityReconcile.ts` (`runProcParityViaAmvs` +
`createProcParityReconcileTrigger`, mirroring
`migrationDataParityReconcile.ts:84,209`): creds from the credential stores
(target) — source creds unnecessary; baseline = pinned proc baseline;
routines = pack translate-dispositioned; purpose `execution`; non-fatal
(fail-open execute, fail-closed gate). Dep declared beside
`triggerDataParityReconcile` (`migrationExecutionDriver.ts:346-357`) and
defaulted at `:945`.

### Graduated gate — `services/migrationProcParityGate.ts`

Inputs: latest proc parity report per routine (execution purpose
preferred, else workbench), translation loop states, waivers with prefix
`proc-parity:`, and the NEXT plane's dependency set = routines with
proc_call edges (`endpoint_data_effects.path_metadata_json.proc_name`)
from endpoints/jobs referenced by that plane's stories.
Result `{blockReasons[], warnings[], counts}`:
- block reason ONLY for a dependent routine not reconciled (divergent,
  exhausted, apply_failed, unverified, stale, not migrated) and not waived;
- every other non-reconciled routine → warning line with a count;
- final plane (DB-only: the DB plane): no block reasons ever; run status
  `completed_with_findings` with the routine list when any remain.
Consumed at the plane-precedence check (`migrationExecutionDriver.ts:228-241`)
alongside gate 4d; override recorded as today. `PROC.GATE.01`.
Migrate panel: warnings list rendered under block reasons
(`MigrationDeliveryMigratePanel.tsx:636`).

### Manual Run-reconciliation modal

`RunReconciliationModal.tsx`: DB group = "Data parity" + "Stored procs and
functions" (`run_proc_parity`); API group hidden when the service plane is
out of scope (plane composition from the progress summary). Gateway
`startManualReconciliation` branch → AMVS proc-parity run (purpose
`manual`), same synchronous precondition style (`:20-32`): no pinned proc
baseline / no target creds / no target build → named block reason.

### Progress report

`migrationProgressSummary.ts`: `DbSectionTotals.routines`; new cell
`procsMigratedReconciled {reconciled, total, pct}` replacing `procsMigrated`
(wire kept one release with both keys populated); buckets `notCaptured`,
`divergent` (incl. exhausted/apply_failed), `unverified`,
`reconciledWithWaivers`, `fullyReconciled`; `movedToCode`, `dropped`.
Sources: `db_routines` (denominator minus dispositions), pinned proc
baseline (captured set), latest proc parity reports (verdicts), waivers.
Banner Live behaviour cell counts captured routines (with or without an
API baseline). `MigrationProgressReport.tsx:375-408`: label "Stored procs
migrated/reconciled", bucket row, DB-only render (no service section).

### Drift

On a DB re-scan, routine `body_hash` change → AMS marks the pinned
baseline's items for that routine `stale=true` (`stale_reason=body_changed`)
and the translation `stale` (existing source-hash demotion). Translations
tab + baseline page banner: "N routines changed since capture; re-capture
(scoped) and re-run the loop" — signal, never a lock.

### Views

`defaultResolveDataParityTables` (`migrationDataParityReconcile.ts:135`)
includes pack views as keyless tables (canonical multiset ≤ bound, else
honest unverifiable naming the bound).

### Docs

`docs/run-judge/RUN_JUDGE_INSTRUCTIONS.md`: PROC family (CAP/BUILD/LOOP/
REC/GATE) beside DATA/CAP.

## Verification (lean)

- Gate matrix: dependent/non-dependent × states × waivers × final plane.
- Driver seam test (step 6 fires; non-fatal on error).
- Progress summary tests (full and DB-only; buckets sum; both wire keys).
- Modal vitest (DB-only hides API group; proc checkbox in body); migrate
  panel warnings; drift banner.

## Acceptance

- A DB-only run completes with proc parity re-checked and
  `completed_with_findings` listing non-reconciled routines, never blocked.
- A multi-plane run pauses with block reasons only for dependent routines.
- The progress report shows "Stored procs migrated/reconciled: X of Y"
  with the five buckets.

## Pickup

Restart gateway + frontend. No AMS change (stale columns landed in 230).

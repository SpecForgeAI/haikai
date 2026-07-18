# Spec W — Phased human-gated execution

**Status:** core built (lean). Part of the plane-based migration reframe
(`agent-os/planning/2026-07-17-plane-based-migration-execution-shaping.md`
§4, §6). Replaces the big-bang migration executor with **per-plane
build/verify/reconcile + hard human-review pauses**.

## What's built

- **`AWAITING_APPROVAL` run status.** The pause state. `MigrationExecutionRunStatus`
  is plain-TEXT string constants with **no DB CHECK** (validated at the service
  layer against `ALL`), so this needed **no Liquibase changeset** — just the
  Java constant + `ALL` entry and the gateway `RUN_STATUS`.
- **Plane model** (`migrationExecutionDriver.ts`): `planeForWorkstream` /
  `planeForItem` map each item to a plane (`db` / `service` / `ui`) from its
  workstream (Spec V vocabulary) or `stream:<name>` tag. `service` is the
  default (API + internal + cross-cutting); infra defaults to `db` (positionable,
  v1), cutover to `ui`.
- **`buildPhasedDispatchSet`**: groups the ordered dispatch set into plane
  phases (db → service → ui), re-sequences globally, and marks the **LAST item
  of EACH phase** `deployOnComplete=true` so every plane deploys + reconciles
  before the run pauses. Empty planes drop out → **tier-driven inclusion**
  (DB-only / service-only migrations have one phase).
- **Phased advance** (`advanceRunOnBuildResult` deployed handler): a `deployed`
  callback on a NON-final plane (pending items remain) runs the plane's
  reconcile and sets the run `awaiting_approval` (**hard pause**); the FINAL
  plane marks the run deployed. Per-plane reconcile: `service` → API baseline
  replay (existing), `db` → data-parity comparator seam (Spec P), `ui` → none.
- **`resumeMigration`** ("approve & continue"): only a paused run resumes;
  dispatches the next plane's first pending item and returns to `dispatching`.
- **Data-parity gate repositioned** (§2.12): removed from the pre-migrate
  hard-block (a chicken-and-egg — target data loads *during* the migration) to
  the **post-DB-plane approval pause**, Persistence-conditional, with human
  override.

## Tests

33 executor tests green (`migrationExecutionDriver.test.ts` +
`migrationExecutionDriverPhased.test.ts`): plane assignment, phased grouping +
per-phase deploy flags + tier-driven drop-out, deployed→pause + DB reconcile,
resume dispatches next plane, resume no-op when not paused. Gateway `tsc` + AMS
`compile` clean.

## Deferred (W.4 / Z / shakedown)

- The **resume HTTP route** + frontend **"approve & continue"** button — built
  with Spec Z (the UI pass), since the route's only consumer is that button.
- **Live per-plane reconcile wiring**: the DB-plane data-parity invocation
  against AMVS + the X/Y runner dispatch are work-machine shakedown seams
  (`triggerDataParityReconcile` is injectable; the default records intent).
- Predicate re-alignment to per-plane GATE/EXEC/REC (trace lines are
  plane-labelled; full predicate stages are a follow-up).

# Spec D — Side-by-Side Sync & Reconciliation Pack

**Program:** Persistence-Tier Oracle (see program decisions file).
**Status:** built + verified.
**Delivers:** the user's operating model as pack artifacts — weekend bulk load, then ONE-WAY
daily incremental sync into the shadow target until confidence, then swap-over. No dual-write.

## What was built

**New generator `gateway/src/services/dbMigrationPack/syncPack.ts`** (pure, deterministic, no
LLM), wired into the pack pipeline; five new files ride every pack:

| File | Kind | Content |
|---|---|---|
| `sync/000-sync-state.sql` | `sync_runner` | `haikai_sync_state` high-water table DDL (idempotent daily runs) |
| `sync/run-incremental-sync.sh` | `sync_runner` | Rerunnable daily runner: keyed tables in FK order with high-water read/advance, full-reload tables documented, **pending-delta-key tables explicitly BLOCKED**, per-run reconciliation gate at the end |
| `reconcile/reconciliation.sql` | `reconciliation_script` | Per-table `count(*)` + `max(delta_key)` queries for BOTH engines (PostgreSQL + Sybase sections); v1 scope honest — cross-engine value checksums are a manual escalation |
| `reconcile/build-report.sh` | `reconciliation_script` | Merges source/target CSVs → markdown drift report; **exits 2 on drift** (the gateable cutover contract) |
| `cutover/swap-over-runbook.md` | `cutover_runbook` | Ordered checklist: freeze → final delta → zero-drift gate → **sequence seeding NOW (not at bulk load)** → job re-homing (`[decision:db.jobsRehoming]`, no job runs twice) → switch → verify → source read-only fallback period |

- Manifest gains a `sync` section (runner/state/reconciliation/runbook paths + per-table
  strategy mirror).
- **AMS changeset 204** (`chk_dmpf_file_kind` drop/recreate — 177's idiom; changesets ≤203
  untouched) + `DbMigrationPackFileEntity` KIND constants/ALL_KINDS extended to 10 kinds.
- **Planner carriage (Spec B/C composition):** incremental group stories now carry the runner +
  state DDL alongside their per-table delta scripts; the reconciliation story carries both
  reconcile artifacts; the final-delta story carries the runbook — all verbatim via Spec C.

## Verification

- `dbMigrationPackSyncPack.test.ts` (NEW, 7 tests): emitter pins (one-way-only, blocked
  pending-decision tables, both engine sections, exit-2 drift gate, seed-at-swap-over wording,
  jobs-run-once) + a full `generateDbMigrationPack` pipeline integration asserting the five
  files persist with the right kinds and the manifest `sync` section.
- Gateway sweep `dbMigrationPackSyncPack + migrationDbPackPlanner + dbMigrationPack* +
  migrationBookOfWorkDbExpansion`: 11 suites / 73 tests ✅; `tsc --noEmit` clean.
- AMS Maven `DbMigrationPack*Test` (incl. both changeset tests over the new 204): 12 tests ✅
  BUILD SUCCESS.

Judgment call: the runner/extract mechanics keep the pack's established "documents the
extract → COPY pipe" posture (env-var header + per-table function stubs referencing the
per-table scripts) rather than pretending a fully turnkey cross-engine executable — IVS builds
the operable job from these files per the Spec C carriage stories.

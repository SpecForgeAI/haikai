# Spec E — DB Execution Gate & Verify Loop

**Program:** Persistence-Tier Oracle (see program decisions file).
**Status:** built + verified.
**Delivers:** the persistence-tier analogue of the driver's CD-7 API-oracle hard block.

## What was built

**New module `gateway/src/services/migrationDbExecutionGate.ts`**, wired into
`migrationExecutionDriver.startMigration` alongside (stacking with) the existing hard-block
gate, so the user sees every blocker at once:

- **Scope detection** (`dbStoriesInScope`): the gate applies only when the run's dispatch scope
  contains DB-pack stories (`provenance:pack` or DB delivery-stream tags), honouring deferral
  and subset-migrate selection.
- **Gate conditions** (`evaluateDbPackReadiness`, all reasons stack):
  - `db_pack_missing` — no pack for the book's current architecture;
  - `db_pack_stale` — input-snapshot hash drift, AMS decision-resolution staleness, **or the
    pack bound to a different target than the book** (the specs carry pack files verbatim, so a
    stale pack means the specs no longer match reality);
  - `db_pack_decisions_unresolved` — open needs-decision entries (sample keys in the message);
  - `db_translations_unapproved` — translate-disposition rows still `unreviewed`/`needs_rework`
    (`rejected` is a terminal human disposition and does not block; `rewrite_in_app` rows are
    service-tier work and do not block);
  - `db_pack_read_failed` — **FAIL-CLOSED**: unreadable pack state blocks the run (contrast the
    carry-over dimension, which fail-softs because it is advisory bookkeeping).
- Driver deps gain optional `dbPackGateReads` (lazily defaulted — pre-existing mocks compile
  unchanged; the gate never fires for non-DB books).

## The verify loop (already existed — wired by reference, not rebuilt)

`POST /db-migration-packs/:packId/verify` (2026-06-11 Task Group 5) already runs a credentialed
target-DB scan → deterministic expected-schema diff → drift-report row appended to history.
**The driver cannot invoke it automatically**: DB credentials are per-invocation and never
persisted (hard pack-spec constraint), and the app/DB run on machines the gateway can't assume
reachable. The swap-over runbook (Spec D, step 7) makes it the explicit human verification step,
and the reconciliation report's exit-2 drift contract gates the swap itself. Recorded as a
deliberate constraint, not an omission.

## Verification

- `migrationDbExecutionGate.test.ts` (NEW, 8 tests): scope detection (deferral/selection/stream
  tags), all five block reasons incl. fail-closed and reason stacking, clean pass.
- Existing driver + carry-over suites re-run green (5 suites / 59 tests total with the new one);
  `tsc --noEmit` clean.

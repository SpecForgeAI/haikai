# Spec B — Verification

**Date:** overnight build 2026-07-02→03.

## Test runs (all green)

| Suite | Result |
|---|---|
| gateway jest `migrationDbPackPlanner` (NEW) | 14 tests ✅ — includes the two program pins: **ANTI-EXPLOSION** (250 tables → 10 cluster stories, ≤13 schema stories total) and **COVERAGE** (every manifest table in exactly one story, drift → throw) |
| gateway jest `migrationBookOfWorkDbExpansion` (NEW) | 3 tests ✅ — real per-epic pipeline: zero LLM calls (throwing mock), ensure re-run with book tuple, one atomic append, merged hierarchy valid; drift → `failed` state-only; prerequisite epic → blocked stories |
| gateway jest `migrationBookOfWorkPackEnsureWiring` (rewritten) | 5 tests ✅ — deterministic DB skeleton in posted draft, mixed-stream = exactly 1 LLM call, prerequisite skeleton on skipped/failed |
| gateway jest full sweep `migrationBookOfWork* + dbMigrationPack* + migrationDbPackPlanner` | 21 suites, 143 tests ✅ |
| gateway `tsc --noEmit` | exit 0 ✅ |
| frontend vitest `gapWayfindingRegistry` | 5 tests ✅ (18 entries) |

## Deliberate judgment calls

1. **DB streams are fully deterministic in phase 1** (not LLM-with-facts): the pack manifest IS
   the plan content; prose framing adds nothing an LLM should invent. Per-stream self-containment
   is preserved (two initiatives — "schema & DB code" and "data" — because assembly namespaces
   per stream; a shared cross-stream initiative would break the existing assembly contract).
2. **Cluster lists persisted on skeleton features AND recomputed at expansion** — recompute
   against the CURRENT manifest with equality asserted; mismatch fails the epic with
   "regenerate the migration plan" (honest staleness, not silent re-shaping).
3. **Swap-over items live in the `data_migration` stream** (workstream vocabulary unchanged) —
   sequence seeding / final delta / job enablement are persistence-specific mechanics, distinct
   from the generic `cutover_rollback_decommission` stream which stays LLM-planned.
4. **Existing LLM-mechanics tests switched from the DB stream to infrastructure** — their intent
   (per-stream calls, retry-once, skeleton prompts, pool bounding) is stream-agnostic; the DB
   stream no longer exercises those paths by design.
5. **Baseline repair:** stale camelCase `postedBody.bookOfWork` read in
   `migrationBookOfWorkExpansion.test.ts` (pre-existing failure, verified by stash-run) fixed to
   the snake_case wire shape.
6. **Encoding incident (self-inflicted, fixed):** a PowerShell bulk string-replace mojibake'd
   `migrationBookOfWorkHandler.test.ts` em-dashes; the file was restored from git and re-edited
   with the encoding-safe Edit path. Final state verified green + tsc clean. No other file was
   touched by that method.

## Known limitations / follow-ups

- `INVENTORY_STREAM_SOURCES` still lists the two DB streams (now unreachable through
  `runEpicPipeline`); left in place because `migrationBookOfWorkExpansionBaselineScoping.test.ts`
  exercises the shared describe/inventory helpers. Candidate cleanup after Spec C.
- Non-table object stories derive from the pack's translation rows/manifest; when the AMS
  translations endpoint is absent (older AMS), the planner degrades to manifest counts only.
- The wizard UI does not yet render the deterministic skeletons differently — they appear as
  normal epics/features with `provenance:pack` tags (review workspace already shows tags).

# Spec A — Verification

**Date:** overnight build 2026-07-02→03. Verified by direct test-suite runs (no live stack —
the app runs on the user's other machine; morning shakedown is the user's).

## Test runs (all green)

| Suite | Result |
|---|---|
| gateway jest: `src/config/architect-conversation` + `src/services/architectConversation` + tier-gating route | 23 suites, 207 tests ✅ |
| gateway jest: `dbMigrationPackEnsure` (NEW, 7 tests), `dbMigrationPackGeneration`, `dbMigrationPackRoutes`, `dbMigrationPackTranslationLifecycle`, `dbMigrationPackTranslations`, `migrationBookOfWorkHandler`, `migrationBookOfWorkSeedAtCreation`, `migrationBookOfWorkFindingsCoverage`, `migrationBookOfWorkRoute`, `migrationBookOfWorkPackEnsureWiring` (NEW, 4 tests) | all ✅ |
| gateway `tsc --noEmit` | exit 0 ✅ |
| AMS Maven `MigrationDiscoveryContext*Test` + `MigrationDualContextSuppressionIntegrationTest` (incl. NEW `MigrationDiscoveryContextDbPackReadinessTest`, 4 tests) | 36 tests ✅ BUILD SUCCESS |

## Deliberate judgment calls

1. **`db.migrationWindow` is single-choice, not free-text** — the library's `free-text` shape has
   zero production uses; introducing its first use overnight on an unshaken frontend path was
   avoidable risk. The four choices encode the user's stated pattern as the default.
2. **All four new questions `independent`** — hard-dependent/grey would require branch-list /
   compatibility-matrix coverage (loader-enforced). Policy questions apply regardless of engine
   choice; independence is semantically defensible and validation-safe.
3. **Binding persisted in `manifest_json`, not a new AMS column** — avoids a Liquibase changeset
   for what is persistence metadata; the zip's `manifest.json` file content is unchanged
   (documents the transform, not the binding).
4. **Prefill banner denominator bumped 51→55** (`TECH_STACK_PREFILL_BANNER_DENOMINATOR`) with its
   test — the hardcoding comment said "stable", not "forever stale".
5. **Baseline repair:** `migrationBookOfWorkFindingsCoverage.test.ts` had 7 pre-existing failures
   (verified by stashing all Spec-A work and re-running on HEAD: same 7 failed). The tests read
   `postedBody.generationSummary` (camelCase) but the handler has posted snake_case
   `generation_summary_json` since the 2026-06-23 fix. Repaired the reads; suite now 8/8.

## Known limitations / follow-ups

- The ensure step runs only when a DB stream is selected in the wizard; the legacy no-streams
  path never ensures (by design — legacy combined path untouched).
- Frontend wizard does not yet label the four new gap codes with wayfinding entries (safe
  fallback rendering covers them); proper entries + preflight UX ride with Spec B.
- `sourceEngines` dedupes to lowercase; multi-engine estates produce multiple entries — the pack
  engine gate still enforces Sybase-only sources for v1.

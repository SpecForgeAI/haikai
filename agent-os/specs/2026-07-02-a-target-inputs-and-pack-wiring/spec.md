# Spec A — Target Inputs & Pack Wiring

**Program:** Persistence-Tier Oracle (see `agent-os/planning/2026-07-02-persistence-oracle-program-decisions.md`)
**Status:** built + verified (overnight autonomous build, Fable 5 direct implementation — no agent-os subagents)
**Closes gaps:** #7 (decision-binding bug), #2 first half (pack becomes an internal stage of Create Migration Plan), plus first-class engine facts + pack-aware readiness.

## What was built

### 1. Four new target-conversation questions (Group C, persistence-gated)

`gateway/src/config/architect-conversation/questionLibrary.ts` — library grew 51 → 55:

| Code | Shape | Choices (default first) |
|---|---|---|
| `db.schemaMapping` | single-choice | map-default-schema-to-public, keep-source-schema-names, consolidate-to-single-schema |
| `db.extensions` | multi-choice | citext, pg_cron, uuid-ossp, pgcrypto, none-restricted-policy (default "citext, pg_cron") |
| `db.jobsRehoming` | single-choice | pg_cron, external-scheduler, application-scheduled, decommission-jobs |
| `db.migrationWindow` | single-choice | weekend-bulk-plus-daily-incremental-sync, extended-outage-big-bang, near-zero-downtime-cdc, flexible-no-constraint |

All four: `independent`, `versioned:false`, no cascades → no branch-list coverage needed, no
frontend versioned-code registration, `mappingMutationRules` covers them via its library-walk
fallback automatically. `db.migrationWindow` was made single-choice (not free-text) because the
library has zero free-text uses today — avoids an unshaken frontend rendering path.

### 2. Pack decision-binding fixed to the plan's target (bug #7)

`defaultFetchDbDecisions` (dbMigrationPack/inputs.ts) now accepts `targetArchitectureId` and reads
`db.*` decisions from THAT target, falling back to the active target only for legacy callers —
mirrors the 2026-06-27 migration-discovery-context fix. Threaded through
`fetchGenerationInputs` → `generateDbMigrationPack` (request gains `targetArchitectureId`) →
`POST /generate|/regenerate` body (`target_architecture_id`) → `evaluatePackStaleness` (input gains
`targetArchitectureId`). The binding is persisted as `manifest_json.target_architecture_id` so the
GET-time staleness recompute reads decisions from the SAME target the pack was generated for.

### 3. Pack ensure-fresh inside Create Migration Plan

New `gateway/src/services/dbMigrationPackEnsure.ts` (`ensureFreshDbMigrationPack`):
missing pack → generate; different/legacy target binding → regenerate; stale → regenerate;
fresh+same binding → no write. NEVER throws: engine-gate rejection (no `db.engine` decision,
non-Sybase→PG pair) → `'skipped'`; anything else → `'failed'`.

Wired into `generateMigrationBookOfWork` as Stage 0 (before the context fetch, so readiness sees
the ensured pack) — runs only when a DB delivery stream (`target_database_schema_implementation`
/ `data_migration`) is selected. `'skipped'`/`'failed'` surface in `result.warnings`; the outcome is
recorded at `generationInputs.dbMigrationPack` on the persisted draft. The 2026-06-11 "staleness
never auto-regenerates" constraint still holds for the GET path; plan creation is an explicit
user generation action (program decision supersedes the old trigger-scope).

### 4. Engine facts + pack-aware readiness (AMS)

- `DatabaseDiscoverySummary` gains `sourceEngines` (deduped, lowercased `detail_json.engineKey`
  off db-pack findings) and `dbMigrationPack` (`DbMigrationPackSummary`: packId, status,
  openDecisionCount, unapprovedTranslationCount; null = no pack).
- New `MigrationGapCodes`: `no_physical_schema_promoted` (db findings but nothing promoted — the
  silent-freeform precursor state), `db_migration_pack_missing`, `unresolved_db_pack_decisions`,
  `unapproved_db_translations` (advisory → `downgradeToPartial(dataReadiness)`).
- New repo finders: `countByPackIdAndStatus` (decisions), `countByPackIdAndReviewStatusIn`
  (translations; unreviewed + needs_rework count as unapproved, rejected is terminal).
- Service constructor +3 nullable pack collaborators (established test-isolation pattern).
- Gateway TS `MigrationDatabaseDiscoverySummary` extended additively. Frontend gap registry needs
  no change to avoid crashes (total fallback) — proper wayfinding entries ride with Spec B.

## Verification

See `verification.md`. Baseline repair included: `migrationBookOfWorkFindingsCoverage.test.ts`
had 7 PRE-EXISTING failures (stale camelCase reads of the posted AMS body from before the
2026-06-23 snake_case fix — confirmed by stash-run against HEAD) — repaired to read
`generation_summary_json`.

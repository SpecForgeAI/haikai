# Spec B — Clustered DB Plan Generation

**Program:** Persistence-Tier Oracle (see `agent-os/planning/2026-07-02-persistence-oracle-program-decisions.md`)
**Status:** built + verified.
**Closes gaps:** #1 (story-per-table explosion), #2 (plan blind to the pack), #3 (non-table objects invisible), #4 (risk-blind facts), #5 (silent freeform-LLM fallback).

## What was built

**Core module: `gateway/src/services/migrationDbPackPlanner.ts`.** The two DB delivery streams
(`target_database_schema_implementation`, `data_migration`) are now generated **deterministically
from the DB migration pack** in BOTH phases — no LLM call, no token spend, no freeform fallback.

### Phase 1 — deterministic skeletons (`buildDbStreamSkeleton`)

- Schema stream: initiative → **Build target schema** epic (foundations / mechanical table
  clusters / exceptional tables / constraints features) + **Translate DB code objects** epic
  (per-kind features for procs, triggers, views, scheduled jobs — only when the manifest lists
  them).
- Data stream: initiative → **Data migration** epic (bulk / incremental / reconciliation) +
  **Persistence cutover & seeding** epic (final delta / sequence seeding / job re-homing /
  verification).
- Pack unavailable (`ensure` skipped/failed, or read-back failed) → **prerequisite skeleton**
  (blocked epic; expansion emits explicit "Generate the DB migration pack" stories) — Gap #5's
  silent LLM path is gone.
- Features carry structured extras (`dbFeatureKind`, `dbClusterIndex`, `dbClusterTables`) that
  survive the validators/AMS round-trip (scaffold `kind:'operational'` precedent).

### Clustering (the anti-explosion guarantee)

`computeTableLayers` = FK dependency layer (1 + max parent layer) over the expected-schema FK
edges, restricted to forward edges in the pack's bulk-load topological order (cycle-break
back-edges dropped deterministically). `clusterMechanicalTables` walks bulk-load order, skips
flagged tables, groups by layer, chunks at `MIGRATION_PLAN_DB_CLUSTER_MAX_TABLES` (new config
knob, default 25). **Pinned by test: 250 mechanical tables → 10 cluster stories, never 250.**

### Phase 2 — deterministic stories (`buildDbEpicStories`)

- Schema epic: 1 foundations story (master changelog + schemas changeset), **1 story per
  cluster** (per-table changeset paths carried as `packFilePaths` + `seed_db_pack_files` tag for
  Spec C), **1 story per flagged table** (readiness `needs_user_decision`, open decision keys as
  `missingInputs`, finding/entity references from coverage provenance), 1 constraints story
  (FK/index/sequence-seed changesets). **Coverage is code-asserted**: every manifest table lands
  in exactly one cluster or exceptional story or the epic FAILS (retryable).
- Code-objects epic: per kind — review-workload story (gated `needs_user_decision` while drafts
  unapproved), apply-approved story (carries emitted translation files verbatim; `blocked` until
  any approval exists), individual stories for `rewrite_in_app` objects, jobs re-home story
  tagged `[decision:db.jobsRehoming]`.
- Data epic: ONE bulk-load story (FK order, expected row counts), incremental stories **grouped
  by delta strategy** (insert-only / insert+update / full-reload / needs-decision — the last
  gated on the pack's delta-key decisions), reconciliation story.
- Cutover epic: final delta, sequence seeding **at swap-over** (side-by-side semantics), job
  enablement, post-swap verification (expected-schema diff green).
- Skeleton/manifest drift (pack changed since plan creation) → **loud failure** with
  "regenerate the migration plan", never silent re-shaping.

### Integration

- Phase 1: `generateMigrationBookOfWork` fetches ONE `PackView` (pack row + manifest + decision
  queue + translation rows) after the ensure step and branches DB streams to the deterministic
  builder. Mixed selections: DB streams deterministic, others LLM (pinned by test: exactly one
  LLM call for one non-DB + one DB stream).
- Phase 2: `runEpicPipeline` branches DB epics before any inventory/LLM machinery; the ensure
  step re-runs at expansion time (stale packs refresh; the plan may be expanded days later).
  DB epics skip the scaffold-manifest gate (maven/npm only — pointless AMS read avoided).
- Frontend: 4 wayfinding entries for the Spec A gap codes (registry 14 → 18 entries).

## Verification

See `verification.md`. Existing per-stream LLM tests that used the DB stream to exercise LLM
mechanics were switched to the infrastructure stream (intent preserved); the pure
`assembleBookOfWork` ordering test keeps the DB stream (assembly is stream-agnostic). One more
pre-existing baseline repair: `migrationBookOfWorkExpansion.test.ts` read camelCase
`postedBody.bookOfWork` (stale since the 2026-06-23 snake_case fix) — now reads
`book_of_work_json.items`.

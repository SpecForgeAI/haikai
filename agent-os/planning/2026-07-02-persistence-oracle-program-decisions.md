# Persistence-Tier Oracle Program — Decisions & Build Log

**Date:** 2026-07-02 (overnight autonomous build, user-approved "all defaults fine, build all 6")
**Branch:** `feature/persistence-oracle-program` — one commit per spec, NO push.
**Morning review doc:** `agent-os/planning/2026-07-03-persistence-oracle-program-review.md` (written last).

## Program goal (acceptance test)

One dry run against a real Sybase ASE 15 estate yields: a migration plan of ~40–70 persistence
stories across four epics (NOT one story per table), specs carrying deterministic DDL/scripts
verbatim, a built PostgreSQL 18 schema with a green expected-schema diff, a runnable daily
incremental sync with a per-run reconciliation report, and every skipped/flagged object visible —
never silent. This extends the recorded "oracle standard" (see pre-merge memory
`project_migration_ultimate_goal`) through the PLAN layer for the persistence tier.

## Agreed end-state journey (user-agreed this session)

1. **Scan the source DB** (Sybase 15): promote tables/views/columns/relationships into the Data
   domain; accept the deep-detail findings (procs, triggers, view bodies, sequences+high-water,
   jobs, collation hazards, computed columns, non-portable defaults). Architecture ≠ reality by
   design: deep facts live in findings, merged into the pack IR at generation time.
2. **Target conversation** captures `db.*` decisions — existing six (engine, migrations, driver,
   connectionPool, transactionStrategy, readReplicaUsage) plus four new (Spec A).
3. **Pack is internal**: Create Migration Plan auto-generates/refreshes the deterministic
   Sybase→PG migration pack (staleness-hash guarded). No longer a dead-end side tab.
4. **Create Migration Plan** emits a four-epic persistence initiative at cluster granularity:
   schema build / DB code objects / data migration / cutover.
5. **Specs carry pack artifacts verbatim** (seed-story pattern); LLM invents little/nothing.
6. **IVS builds**; execution driver gates on DB readiness; expected-schema diff verifies; failures
   land as findings (the DB analogue of API reconciliation).

## Gaps being closed

| # | Gap |
|---|-----|
| 1 | Story-per-table explosion (250 tables → ~500 stories/specs) |
| 2 | Plan generated blind to the schema pack (pack is a dead end) |
| 3 | Non-table objects (procs/triggers/views/sequences/jobs) invisible to the plan |
| 4 | Risk-blind table facts (name-only inventory; views mislabeled) |
| 5 | Silent freeform-LLM fallback when no schema was promoted |
| 6 | App-tier T-SQL affinity unplanned (Sybase→PG specific) |
| 7 | Pack reads db.* decisions from ACTIVE target; plan reads from PLAN's target (binding bug) |

## The six specs

| Spec | Folder slug | Delivers | Depends on |
|------|-------------|----------|------------|
| A | `2026-07-02-a-target-inputs-and-pack-wiring` | 4 new conversation questions; pack decision-binding fixed to plan's target; pack auto-gen/refresh inside plan creation (fail-soft); source/target engine facts + new readiness gap codes | — |
| B | `2026-07-02-b-clustered-db-plan-generation` | Four-epic persistence initiative generated deterministically from pack manifest; cluster stories (FK layers, cap 25); non-table objects; pack decisions → needs_user_decision stories; preflight gates (no freeform LLM for DB streams) | A |
| C | `2026-07-02-c-verbatim-db-specs` | Spec generation for pack-tagged DB stories carries pack artifacts byte-for-byte (deterministic, non-LLM branch); mechanical acceptance criteria | B |
| D | `2026-07-02-d-side-by-side-sync-pack` | Pack extension: daily incremental sync runner, per-run reconciliation report (counts+checksums), swap-over artifacts (final delta, sequence seeding, job re-homing checklist) | B (manifest contract), parallel-safe with C |
| E | `2026-07-02-e-db-execution-gate-and-verify` | Migrate driver hard-gate (pack fresh + decisions resolved + translations approved); post-build expected-schema diff → findings | C |
| F | `2026-07-02-f-tsql-affinity-and-consumer-revalidation` | T-SQL affinity sweep stories from code findings; endpoint→table data effects → post-swap revalidation test stories | B; FIRST TO DROP if night runs short |

## User-approved defaults (verbatim from approval)

- **Git:** branch + one commit per spec, no push. NEVER stage the pre-existing dirty files
  (`implement-verify-service/.env.api.example`, `.env.docker`, `.env.example`, `haikai-skills/`).
- **Clustering:** mechanical tables grouped by FK-dependency layer, cap ~25 tables per cluster
  story (configurable); hazard/decision-flagged tables → individual stories.
- **Conversation defaults (all user-overridable):** schema mapping `dbo → public`; extensions
  policy "citext + pg_cron permitted" (opt-out available); DB-resident jobs re-home to pg_cron;
  migration window free-text, suggested "weekend bulk load + daily incremental sync until swap-over".
- **Sync mechanics:** file-staged ONE-WAY sync (Sybase-side delta extract per pack cast notes →
  staged files → Postgres COPY), rerunnable runner + per-run reconciliation report. Sequence/identity
  seeding at SWAP-OVER, not bulk load. NO dual-write anywhere.
- **Fallback:** guarantee A–E; drop F first.

## Implementation conventions (this build)

- I (Fable 5) implement directly — no agent-os implementer subagents (user-approved steer-away;
  reasons: prior 5h/2-spec builds, Write-only clobber risk). Keep agent-os ARTIFACT trail: per-spec
  folder with `spec.md` + `verification.md`.
- Targeted test suites only (whole-repo frontend baseline is red): gateway jest per touched file,
  AMS Maven per touched module, frontend vitest per touched component.
- App runs on ANOTHER machine — no localhost probes, no runtime shakedown; morning shakedown is the user's.
- AMS speaks snake_case at the wire (CLAUDE.md); `@CamelCaseWire` only for camel consumers.
- New Liquibase changesets are NEW files, registered after the latest in `db.changelog-master.yaml`.
- Four-epic structure maps onto EXISTING workstream enum values (no enum changes):
  schema build + DB code objects → `target_database_schema_implementation`; data migration →
  `data_migration`; cutover → `cutover_rollback_decommission`.
- Pack auto-generation fail-soft: pack generation failure (no db.engine, unsupported pair) →
  plan proceeds with warnings + prerequisite stories; never a hard plan failure.

## Per-spec design log

(Appended as each spec is designed/built — see per-spec `spec.md` for full detail.)

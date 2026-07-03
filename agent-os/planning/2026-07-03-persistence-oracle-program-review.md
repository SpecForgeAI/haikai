# Persistence-Tier Oracle Program — Morning Review (2026-07-03)

**Branch:** `feature/persistence-oracle-program` — 6 commits (Specs A–E, with the program
decisions file riding commit A, + this docs commit). **Merged to `main` and pushed on
2026-07-03** (merge commit `3f441ee`, clean merge — the overnight upstream IVS self-repair work
touched disjoint paths). Your pre-existing working-tree changes (IVS `.env*`, `haikai-skills/`)
were never staged. See the Appendix for the exact pass/fail predicates per shakedown step.

## TL;DR

**5 of 6 specs built, tested and committed overnight; Spec F deliberately dropped under your
approved fallback rule.** The persistence tier now runs the oracle standard end-to-end: point
at a Sybase 15 DB → discovery → target conversation (4 new policy questions) → Create Migration
Plan **auto-generates the pack and derives both DB streams deterministically from it** (~a dozen
cluster stories for 250 tables, never 250) → specs **carry the pack's files byte-for-byte** (no
LLM invention) → Migrate **hard-blocks** until the pack is fresh, decisions resolved,
translations approved → the pack now also ships the **daily one-way sync runner, per-run
reconciliation with a gateable drift exit, and the swap-over runbook** (sequence seeding at
swap-over, jobs run exactly once).

**Zero regressions:** gateway 406 suites / 3001 tests — only the 2 KNOWN pre-existing baseline
failures remain (verified by stash-runs against HEAD); AMS full suite base-vs-branch is
identical at 4F+8E with my +4 tests passing (verified by a worktree run at the base commit).
Along the way I repaired 8 OTHER pre-existing test failures (stale camelCase wire reads).

## What to shake down on the live stack (in order)

1. **Conversation**: persistence-tier walk now asks 55 questions (4 new in Group C). Check the
   4 render + capture correctly (`db.schemaMapping`, `db.extensions` [multi-choice],
   `db.jobsRehoming`, `db.migrationWindow`).
2. **Create Migration Plan** with both DB streams selected against your Sybase estate:
   - warnings when `db.engine` isn't captured (prerequisite skeleton, no LLM guessing);
   - with decisions captured: pack generates automatically; the review workspace shows the
     four-epic persistence structure with `provenance:pack` tags; check the epic expansion
     produces cluster stories with real table lists.
3. **Spec generation** on a cluster story: the spec text should embed the Liquibase changesets
   verbatim (`/agent-os:shape-spec …` + fenced files).
4. **Migrate**: with an open pack decision, Start must return `blocked` with
   `db_pack_decisions_unresolved` (stacked alongside any CD-7 reasons).
5. **Pack zip**: download and eyeball `sync/run-incremental-sync.sh`,
   `reconcile/build-report.sh` (exit 2 on drift), `cutover/swap-over-runbook.md`.
6. AMS boots Liquibase changeset **204** (file-kind CHECK extension) — watch the startup log
   on your work machine.

## The six specs

| Spec | Folder | Status |
|---|---|---|
| A — Target inputs & pack wiring | `agent-os/specs/2026-07-02-a-target-inputs-and-pack-wiring/` | ✅ |
| B — Clustered DB plan generation | `…-b-clustered-db-plan-generation/` | ✅ |
| C — Verbatim DB specs | `…-c-verbatim-db-specs/` | ✅ |
| D — Side-by-side sync pack | `…-d-side-by-side-sync-pack/` | ✅ |
| E — DB execution gate & verify | `…-e-db-execution-gate-and-verify/` | ✅ |
| F — T-SQL affinity & consumer revalidation | — | ⛔ dropped (your fallback rule) |

Each folder has `spec.md` (+ `verification.md` for A/B) with the judgment calls. The program
decisions file (`agent-os/planning/2026-07-02-persistence-oracle-program-decisions.md`) has the
full per-spec log, cross-cutting decisions, and the exact baseline-red inventory.

**Why F was dropped, precisely:** its two pillars need (a) an AMS REST read over
`endpoint_data_effects` (entity + repository exist; no controller exposes them) and (b) a
deterministic T-SQL-affinity classifier over code findings. Building those hurriedly at the end
of the night would have produced heuristic, unverifiable stories — the exact failure mode this
program exists to eliminate. It's shaped enough to be its own daytime spec.

## Gaps → closure map (from the original analysis)

| # | Gap | Closed by |
|---|---|---|
| 1 | Story-per-table explosion (250 → ~500 stories) | B (clusters, cap 25, pinned: 250 tables → 10 cluster stories) |
| 2 | Plan blind to the pack / pack a dead end | A (auto-generate in plan creation) + B (manifest drives both phases) + C (files → specs verbatim) |
| 3 | Non-table objects invisible | B (per-kind translation review/apply stories, rewrite-in-app stories, job re-homing) |
| 4 | Risk-blind table facts | B (flagged tables individually gated with decision keys + finding refs) |
| 5 | Silent freeform-LLM fallback | B (prerequisite skeleton/stories; DB epics can never reach an LLM) + A (`no_physical_schema_promoted` gap code) |
| 6 | T-SQL affinity unplanned | ⛔ F (dropped — see above) |
| 7 | Decision-binding bug (active vs plan target) | A (threaded end-to-end incl. staleness recompute) + E (gate re-checks binding) |

## Things I'd flag for a decision (no action taken)

- `INVENTORY_STREAM_SOURCES` still maps the DB streams (now unreachable in the expansion
  pipeline); left because a baseline-scoping test exercises the shared helpers. Cleanup
  candidate.
- The 2 gateway + 12 AMS pre-existing baseline failures (inventoried in the decisions file) —
  none mine, all verified; the two stale-wire-read suites I DID repair suggest the rest of the
  camelCase-era tests are worth a sweep someday.
- One self-inflicted incident, fully recovered and verified: a PowerShell bulk-edit mojibake'd
  one test file's em-dashes; restored from git and redone with safe edits (Spec B
  verification.md documents it). No other file was touched that way.

---

## Appendix — exact pass/fail predicates per shakedown step

Every predicate is an exact string, count, or status from the code. A step PASSES iff ALL its
predicates hold (P3 in step 5 is optional evidence). Program result = conjunction of all steps.

### Step 0 — AMS boots changeset 204 (prerequisite)
- P1: startup log runs `204-db-migration-pack-file-kind-sync` without error, or
  `SELECT count(*) FROM databasechangelog WHERE id='204-db-migration-pack-file-kind-sync'` = 1.
- P2: `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='chk_dmpf_file_kind'`
  contains `sync_runner`.

### Step 1 — four new conversation questions (persistence tier in scope)
- P1: after db.driver, exactly four further Group C questions, in order:
  db.schemaMapping -> db.extensions -> db.jobsRehoming -> db.migrationWindow.
- P2: db.schemaMapping has exactly 3 choices (map-default-schema-to-public,
  keep-source-schema-names, consolidate-to-single-schema); answering creates a captured-decision
  row with that code.
- P3: db.extensions renders MULTI-choice with exactly 5 options; selecting citext + pg_cron
  captures ONE decision whose answer contains both values.
- P4: db.jobsRehoming has exactly 4 choices (pg_cron, external-scheduler,
  application-scheduled, decommission-jobs).
- P5: db.migrationWindow has exactly 4 choices, first = weekend-bulk-plus-daily-incremental-sync.
- P6 (optional negative): with no persistence tier in scope, none of the four is asked.

### Step 2a — Generate WITHOUT db.engine (prerequisite path; >=1 DB stream selected)
- P1: a draft is created (no error).
- P2: warnings include a string starting `DB migration pack not generated` AND containing
  `db.engine`.
- P3: the DB stream contains exactly ONE epic, titled `DB migration pack prerequisites`,
  readiness blocked, tag `provenance:prerequisite` — and nothing else.
- P4: expanding it appends exactly 2 stories: `Generate the DB migration pack` (blocked) and
  `Confirm the discovered schema is promoted into the Data domain`.
- P5: gateway log has `stage=deterministic_db_skeleton ... pack=none` and NO
  `stage=calling_generator stream=<db stream>` line.

### Step 2b — Generate WITH db.engine (pack path). Let T=promoted tables, F=flagged, J=jobs.
- P1: warnings contain NO `DB migration pack` string.
- P2: a pack exists for the current architecture and its
  `manifest_json.target_architecture_id` equals the plan's target id.
- P3: schema stream = initiative
  `Persistence tier migration — schema & DB code (sybase_ase → postgresql)`; epic
  `Build target schema (postgresql)` with features exactly: `Schema foundations`,
  `Table cluster i — X tables (dependency layer L)` features, `Exceptional tables (F)` iff F>0,
  `Constraints, indexes & sequence seeding changesets`; epic `Translate DB code objects` iff the
  manifest lists procs/triggers/views/jobs.
- P4: sum(X over cluster features) + F = T, and no per-table feature exists outside
  `Exceptional tables`.
- P5: data stream = epics `Data migration (bulk + incremental)` (features Initial bulk load /
  Daily incremental sync / Reconciliation) and `Persistence cutover & seeding` (Final delta at
  swap-over / Sequence & identity seeding / `Re-home DB-resident scheduled jobs (J)` iff J>0 /
  Post-swap verification).
- P6: every DB-stream item carries tags `provenance:pack` + `pack:<packId>`; exactly one
  `calling_generator` log line (the non-DB stream), zero for DB streams.

### Step 3 — deterministic expansion. Let C = cluster-feature count.
- P1: epic reaches `expanded`; storiesAppended = 2 + C + F exactly. (`failed` with a
  "regenerate the migration plan" error on FIRST run = FALSE.)
- P2: each cluster story titled `Apply schema changesets — cluster i (X tables, layer L)`,
  tagged `seed_db_pack_files` + `db_cluster:<i>`, ACs exactly
  `All X table changesets apply cleanly in the structural context.` and
  `The pack's expected-schema diff is green for every table in this cluster.`
- P3: each flagged story `Migrate table <schema.table> (flagged)` readiness
  needs_user_decision with decision keys in missingInputs.
- P4: log shows `stage=expansion_db_deterministic`; NO `expansion_batch`/`expansion_judge`
  lines for these epics.
- P5: Data epic = `Build the initial bulk load (T tables, ~R rows)` + one
  `Daily incremental sync — n ... table(s)` per non-empty strategy group (needs-decision group
  readiness needs_user_decision with `delta_key--<table>` missing inputs) +
  `Build the per-run reconciliation report`; cutover epic = final-delta +
  `Seed S sequence(s)/identities above source high-water at swap-over` + jobs story iff J>0 +
  `Post-swap verification: expected-schema diff green + reconciliation clean`.

### Step 4 — verbatim spec on a cluster story (save to backlog first)
- P1: row status `generated` (or `generated_with_warnings` only when >300k chars),
  confidence `high`.
- P2: spec text starts exactly `/agent-os:shape-spec Apply schema changesets — cluster`.
- P3: contains `## Files to reproduce byte-for-byte (X)` with X = cluster table count, and a
  spot-checked `### `+backtick+`liquibase/changesets/010-tables/<schema>.<table>.sql`+backtick
  section whose fenced content is byte-identical to the pack file.
- P4: log shows `db_pack_carriage workItemId=...`; no LLM/context-resolver lines for that story.

### Step 5 — Migrate hard gate (>=1 open pack decision)
- P1: Start returns status `blocked`; no run created.
- P2: reasons[] contains code exactly `db_pack_decisions_unresolved` with the open count and a
  sample decision key. (Other stacked CD-7 codes may coexist — they do not falsify.)
- P3 (optional): resolve a decision -> pack flips stale -> Start again -> blocked with code
  `db_pack_stale`, message containing `regenerate the migration plan`.

### Step 6 — pack zip artifacts
- P1: all five paths exist: `sync/000-sync-state.sql`, `sync/run-incremental-sync.sh`,
  `reconcile/reconciliation.sql`, `reconcile/build-report.sh`, `cutover/swap-over-runbook.md`.
- P2: runner first line `#!/usr/bin/env bash`; one `sync_table '<schema.table>' '<key>'` line
  per keyed table (= insert_only + insert_update strategies); contains `ONE-WAY only`.
- P3: reconciliation.sql has both `PostgreSQL (TARGET)` and `Sybase ASE (SOURCE)` sections with
  one SELECT per table each (2 x T total).
- P4: build-report.sh contains `exit 2`.
- P5: runbook steps numbered 1-8; step 4 contains `NOW — not at bulk load`; step 5 names every
  job iff J>0; a `**BLOCKED**` banner names any needs-decision tables iff any exist.
- P6: manifest.json contains a `sync` section with `runner_path` =
  `sync/run-incremental-sync.sh` and `tables` of length T.

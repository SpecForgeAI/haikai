# Persistence-Tier Oracle Program — Morning Review (2026-07-03)

**Branch:** `feature/persistence-oracle-program` — 6 commits (Specs A–E, with the program
decisions file riding commit A, + this docs commit), **not pushed**. Your pre-existing
working-tree changes (IVS `.env*`, `haikai-skills/`) were never staged.

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

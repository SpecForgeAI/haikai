# Phase 0 — One readiness function (spec preflight)

**Program:** Plan-screen unification (Phases 0 → 1a → 1b → 1c), agreed 2026-07-20.
**Problem:** The plan screen's `readiness` chip is baked into `book_of_work_json`
at expansion time from static model facts; actual generation is decided at run
time by a DIFFERENT function (carriage routing + AMS focused-context resolver +
`detectInsufficientContext`). Nothing keeps them consistent — 6 of 27 stories
predicted `ready_for_spec` generated as `insufficient_context` with generic
"missing data mapping/findings" messages. Principle (user): *test a function's
inputs before running it; never say "ready" in one place and "missing" in
another.*

## FR1 — Gateway preflight

`POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/spec-generations/preflight`

For every `type='story'` item in the book, run the generator's OWN first half
and stop before the LLM:

| Route (same order as the batch loop) | Check | Cost |
|---|---|---|
| `db_pack` (`isDbPackCarriageStory`) | `runDbPackSpecCarriage` (deterministic, LLM-free) — keep status + missingInputs, discard spec text | pack-files read, memoised per packId |
| `manual_gate` (`isManualGateCarriageStory`) | always ready (deterministic text) | none |
| `code_facts` (`isCodeCarriageStory`) | `runCodeSpecCarriage` — same treatment | code-facts read, memoised per call |
| `description` (`isManualAdd` / `isSeedBuildFilesStory`) | ready (description-grounded; the LLM path relaxes the short-circuit for these) | none |
| `resolver` (everything else) | no `workItemId` → `save_required`; else `fetchMigrationSpecContext` + `detectInsufficientContext` | one AMS resolver read per story |

Response rows: `{ book_item_id, work_item_id, title, route, ready, missing_inputs[], note }`.
Fail-soft per story (a read failure = `ready:false` with the error as a missing
input, never a thrown 500 for the whole book).

## FR2 — Plan screen renders preflight truth

- Workspace fetches preflight on load + a **Re-check readiness** button.
- Tree readiness chip: preflight-driven once loaded (`ready ✓` / `blocked (n)`);
  baked value only while loading. Drawer gains a "Readiness check (live)"
  section listing the preflight missing inputs in the generation vocabulary.
- Baked `readiness` demoted to provenance (still stored, no longer authoritative).

## FR3 — Planner readiness/carriage alignment (bug)

`migrationDbPackPlanner.ts` "Apply approved translations" story: readiness gated
on `approved.length` while the carriage tag is gated on `approvedFiles.length`.
Align readiness to the CARRIABLE condition (emitted files present) with an
honest reason when approvals exist but no files are emitted.

## FR4 — Manual-gate heading warnings (bug)

AMS `MigrationStorySpecGenerationService.applyShapeSpecParserOutput` appends
`parser_missing_heading` warnings (decisions/interfaces/assumptions) to EVERY
persisted spec. Manual-gate specs (`focused_context_refs_json.source ==
'code_plan_manual_gate'`) intentionally omit those sections — skip the
missing-heading warnings for them (sections still parsed; other warnings kept).

## Out of scope (later phases)

Spec chips/Generate actions on the plan screen (1a), execution rail (1b),
standalone screen removal (1c).

## Verification

Gateway jest: preflight routing/fail-soft/memoisation; planner alignment; route.
AMS H2: manual-gate exemption. Frontend vitest: chip override + re-check.

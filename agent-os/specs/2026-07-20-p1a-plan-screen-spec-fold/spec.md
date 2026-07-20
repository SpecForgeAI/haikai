# Phase 1a — fold spec generation into the plan screen

**Program:** Plan-screen unification (0 → 1a → 1b → 1c), agreed 2026-07-20.
Phase 0 gave the ONE readiness function (preflight). 1a makes the plan screen
the single lifecycle surface for specs: chips, generation, viewing, manual
supply, and story deletion — the standalone Generate Specs screen dies in 1c.

## FR1 — Spec chip per story row

Tree story rows gain a spec chip fed from the book's persisted spec rows
(`GET .../spec-generations`, keyed by workItemId):
`—` (none) → `generating` → `spec ✓ (confidence)` / `spec ⚠ (n)` /
`spec ✕` (insufficient/failed) / `spec ✎ manual` (manual-ready). Header strip
shows compact counts (generated / warnings / blocked / manual).

## FR2 — Generate specs from the toolbar

"Generate specs" actions on the plan toolbar (never a separate screen):
- **for saved** (default): every saved story not yet generated (backend batch
  selection unchanged).
- **for selected**: the tree's existing selection → `targetWorkItemIds`.
Batch runs via the existing gateway generate-batch; progress banner + chip
updates; preflight re-runs after the batch so readiness stays live.

## FR3 — Drawer "Generated spec" section

Story drawer gains the spec surface: status chips, spec text (copy), warnings,
missing inputs, **Regenerate this story** (manual-edit overwrite confirm kept),
**Edit spec** (textarea → existing AMS manual-edit endpoint, audit fields
preserved), and **Mark ready (manual)**.

## FR4 — Mark ready (manual) — story by story, never bulk

User doctrine: a story enters a plane only with a spec — tool-generated or
human-supplied. New AMS additive columns on `migration_story_spec_generations`
(changeset 214): `manual_ready` / `manual_ready_at` / `manual_ready_by`.
Endpoint `POST /api/projects/{pid}/spec-generations/{specId}/manual-ready`
(X-User-Id audit; requires non-blank spec text when ready=true; un-markable).
Stage-gate semantics (consumed in 1b): satisfied = status ∈
{generated, generated_with_warnings} OR manual_ready. The chip renders `✎
manual` so substituted trust stays visible. No bulk endpoint exists on purpose.

## FR5 — Story deletion (tombstone, resurrect-proof)

For "the plan created something unwanted" (distinct from unresolved problems):
`POST .../migration-books-of-work/{bookId}/items/{itemId}/delete` — story-type
only, per-story confirm. Mechanics: remove the blob item AND record its id in
`book_of_work_json.suppressed_item_ids`; `appendItems` skips suppressed ids so
deterministic re-expansion cannot resurrect the story; a linked WorkItem is
best-effort archived (`status='ARCHIVED'`). Oracle unshrunk: pack surfaces stay
in parity scope — deleting a story that mattered shows up in reconcile.

## Out of scope

Execution rail + gates (1b); removing the standalone screen (1c).

## Verification

AMS H2/Mockito: manual-ready lifecycle, delete+suppression, append-skip.
Frontend vitest: chips, generate-batch wiring, drawer spec section,
mark-ready, delete confirm. Gateway untouched beyond existing endpoints.

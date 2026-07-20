# Phase 1c — remove the standalone Generate Specs screen

**Program:** Plan-screen unification (0 → 1a → 1b → 1c), agreed 2026-07-20.
User decision: no redirect, no remnant — "as if it never existed". The plan
REVIEW screen owns the whole spec lifecycle (1a) and execution kickoff (1b).

## What was removed

- Route `migration-books-of-work/:bookId/spec-generation` + its `App.tsx`
  registration and import.
- `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/` in
  full: SpecGenerationWorkspace(+Route), BatchResultsTable,
  BatchGenerationControls, SpecGenerationSummaryHeader, Filters,
  StoryResultDrawer, module CSS, and the folder's tests.
- The review screen's "Generate specs →" navigation button
  (`onOpenSpecGeneration`) — generation lives ON the screen now.

## Link retargeting (no dead ends)

- Implement-tab drill-back (`ImplementTabShapeSpecCard` →
  `ProductImplementPage.handleDrillBackToWorkspace`) now navigates to
  `.../review?workItemId=...`; the review route reads the param and the
  workspace AUTO-SELECTS the owning story (drawer + spec section open) — the
  behavioural replacement for the old auto-open drawer.
- Delivery dashboard's `onOpenGeneratedSpecs` → `.../review`.

## What deliberately survives

- The whole `specGenerationApi` client (rows/summary/batch/regenerate/
  manual-edit/manual-ready/preflight) — the plan screen + Implement-tab card
  consume it.
- `ImplementTabShapeSpecCard` (Implement-tab read-only spec card): its
  stylesheet moved beside it as `ImplementTabShapeSpecCard.module.css` (it was
  the deleted folder's last consumer).

## Verification

Affected suites green (ImplementTabShapeSpec, product-roadmap-stage3,
specGenerationApi wire-case, full plan-screen + rail: 183 tests); only the
pre-existing MigrationDeliveryPlanRoute baseline failure remains. tsc adds no
new errors in touched files.

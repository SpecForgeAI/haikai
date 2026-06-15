# Specification: In-Product Spec Editor + Confirm-Overwrite

## Goal
Let users edit a generated shape-spec inline in the story drawer (Markdown-aware editor, explicit Save, audit trail, auto re-parse + re-score), and gate every regeneration path (single-story Regenerate, Generate-all, Retry-batch) with a confirm-overwrite check so manual edits are never silently clobbered.

## User Stories
- As a product manager reviewing a D/F-graded spec, I want to fix wording in place and have the grade refresh automatically so I can improve specs without copy-pasting externally.
- As a tech lead running Generate-all across a book of work, I want to be shown which stories were hand-edited and decide per-row whether to overwrite so I do not lose curated edits.
- As any user re-opening a manually-edited spec, I want to see an "Edited" chip and a diff against the prior LLM version so I can quickly understand what changed and revert one slot back if needed.

## Specific Requirements

**AMS persistence — manual-edit columns on `migration_story_spec_generations`**
- New Liquibase changeset `154-migration-story-spec-generations-manual-edit.sql` (next free slot after 153).
- `manually_edited` BOOLEAN NOT NULL DEFAULT false.
- `last_manually_edited_at` TIMESTAMPTZ nullable.
- `last_manually_edited_by` VARCHAR(255) nullable.
- `previous_spec_text` TEXT nullable (single-slot prior version).
- Extend `MigrationStorySpecGenerationEntity` with boxed fields (`Boolean manuallyEdited`, `Instant lastManuallyEditedAt`, `String lastManuallyEditedBy`, `String previousSpecText`); JPA reads existing rows as `false` / `null` via the column defaults.
- Extend `MigrationStorySpecGenerationDto` + `MigrationStorySpecGenerationMapper` to carry the four new fields downstream.

**AMS endpoint — `POST /api/projects/{projectId}/spec-generations/{specId}/manual-edit`**
- Body `{ "specText": string }`; `editedBy` comes from `X-User-Id` request header (NOT body).
- 404 if the spec row does not exist or does not belong to the project.
- New `MigrationStorySpecGenerationService.applyManualEdit(projectId, specId, specText, editedBy)`:
  - Copy current `generated_spec_text` into `previous_spec_text` BEFORE overwriting (single-slot history).
  - Set `generated_spec_text = body.specText`, `manually_edited = true`, `last_manually_edited_at = Instant.now()`, `last_manually_edited_by = editedBy`.
  - Re-run `ShapeSpecHeadingParser` → refresh `decisions_json` / `interfaces_json` / `assumptions_json` (mirrors `persistOne`).
  - Re-run `SpecQualityScorer` → refresh `quality_score` / `quality_grade` / `quality_dimensions_json`, and copy the previous score into `previous_quality_score` so the drawer's grade-delta indicator works.
  - SKIP `SpecQualityScorer` when status is `insufficient_context` or `failed` (existing rule); still persist text + parser fields + audit fields.
- Returns the full updated DTO so the frontend refreshes drawer + hierarchy node from one round-trip.

**AMS regeneration entry points — opt-in overwrite of manually-edited rows**
- Three existing entry points each take a new optional `overwriteManuallyEdited: boolean` (default `false`):
  - Single-story regenerate (`MigrationStorySpecGenerationController` regenerate endpoint).
  - Batch Generate-all (handler invoked by `migrationShapeSpecGenerationHandler.ts`).
  - Retry-batch (from the missing-input resolver flow).
- When `overwriteManuallyEdited=false`: skip rows where `manually_edited=true`. Batch response carries `skippedManuallyEditedCount: int` and `skippedManuallyEditedWorkItemIds: string[]` so the frontend can show "X stories skipped because they were manually edited".
- When `overwriteManuallyEdited=true`: regenerate those rows as normal. After successful regeneration, CLEAR `manually_edited` back to `false` (the row is now LLM-generated again, not user-edited); `previous_spec_text` is overwritten with the most recent LLM output, so the manual edit drops out of the single slot.
- Single-story regenerate accepts the flag as a query param (`?overwriteManuallyEdited=true`) or request body field — pick the convention already used by the existing regenerate endpoint.

**AMS pre-flight — manually-edited-in-scope listing**
- New AMS endpoint `GET /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations/manually-edited-in-scope` returning `[{ workItemId, workItemTitle, lastManuallyEditedAt, lastManuallyEditedBy }]` for every story under the book whose `manually_edited=true` AND would otherwise be touched by a Generate-all run.
- Same shape reusable by the retry-batch flow (the resolver modal already knows the candidate work-item-id set; pass it through and filter server-side).

**Hierarchy DTO extension**
- Add `manuallyEdited: Boolean` on `MigrationDeliveryHierarchyNodeDto`.
- Follow the recent back-compat constructor pattern: existing constructors default to `false`; the JPQL projection passes the new column through.
- Frontend renders the "Edited" chip directly from this field — no extra fetch per node.

**Gateway — manual-edit proxy + overwrite flag pass-through**
- New gateway route `POST /api/projects/:projectId/spec-generations/:specId/manual-edit`: thin proxy, forwards `X-User-Id` header to AMS, passes `{ specText }` body through, relays AMS status + response body verbatim.
- Extend existing batch route + retry-batch route to accept `overwriteManuallyEdited?: boolean` and (optionally) a `manuallyEditedWorkItemIdsToOverwrite?: string[]` field — whichever shape the frontend chosen pattern below uses.
- New gateway route `GET /api/projects/:projectId/migration-books-of-work/:bookId/spec-generations/manually-edited-in-scope`: thin proxy of the AMS pre-flight endpoint.
- No new LLM calls or token-counting logic in the gateway.

**Frontend — `SpecMarkdownEditor` component**
- New `frontend/src/components/.../SpecMarkdownEditor.tsx`, thin wrapper around CodeMirror 6 (add `@uiw/react-codemirror` + `@codemirror/lang-markdown` to `frontend/package.json`).
- Props: `value`, `onChange`, `onSave`, `readOnly`, `dirty`.
- Markdown syntax highlighting; monospace font; auto-resizes to drawer width.
- Cmd/Ctrl+S keymap with `preventDefault` calls `onSave`; active only while the editor has focus.
- Exports the current text via controlled value so the parent owns dirty state and saving lifecycle.

**Frontend — drawer integration (`MigrationDeliveryStoryDrawer.tsx`)**
- Header shows a View/Edit toggle. Default = View (read-only Markdown render, today's behaviour).
- Edit mode swaps in `SpecMarkdownEditor` for the generated-spec body. Save / Discard buttons appear in the drawer footer; dirty-state indicator cycles "Save" → "Saving…" → "Saved".
- Save calls the gateway manual-edit endpoint; on 2xx, replace the in-memory spec row with the returned DTO (refreshes the existing quality-breakdown panel, decisions/interfaces/assumptions tabs, and grade chip without a manual reload).
- On failure: keep editor open with user text intact; surface an error toast; do not close the drawer; do not discard buffered edits.
- Discard while dirty: show confirmation dialog "You have unsaved changes. Discard them?" before reverting to the last-saved text and returning to View mode.
- On save, if the submitted text does not start with `/agent-os:shape-spec`, show a non-blocking warning toast ("Spec doesn't start with /agent-os:shape-spec — saved anyway") and still persist.
- "Edited" indicator in the drawer header with tooltip "Last edited by {lastManuallyEditedBy} on {lastManuallyEditedAt}" when `manuallyEdited=true`.

**Frontend — Edited chip on hierarchy tree (`MigrationDeliveryHierarchyTree.tsx`)**
- Render a small "Edited" pill on every story node whose DTO `manuallyEdited=true`, alongside the existing quality-grade chip.
- Click on chip opens the drawer (same as clicking the row).
- Chip styling: subtle (matches the existing stale / generated-status chip vocabulary; not alarming).

**Frontend — diff toggle in drawer**
- When `previous_spec_text` is non-null, the drawer shows a "View previous version" toggle in the spec-text section.
- Toggled on: render an inline unified line-by-line diff (GitHub PR-style; additions green, deletions red, interleaved).
- Reuse the existing pass-1 / pass-2 diff renderer from the cross-story-context spec if it already exposes a generic component; otherwise add a small LCS-backed line-diff utility under `frontend/src/utils/lineDiff.ts`. Do NOT pull in a heavy library — the `diff` npm package or equivalent ~3KB module is acceptable.
- Diff is read-only; user must exit diff view to re-enter edit mode.

**Frontend — single-story confirm-overwrite modal**
- New `ManualEditOverwriteConfirmModal.tsx` component used by the drawer's Regenerate button.
- Trigger condition: `manuallyEdited === true` on the row.
- Copy: "This spec was edited by {user} on {date}. Regenerate will replace those edits with a fresh LLM output. Continue?"
- Buttons: Cancel (close) / Continue (calls regenerate with `overwriteManuallyEdited=true`).
- If `manuallyEdited === false`, regenerate proceeds without the modal (existing behaviour).

**Frontend — bulk confirm-overwrite picker (Generate-all + Retry-batch)**
- New `ManualEditOverwriteBulkModal.tsx` (or extend the existing Generate-all dialog with a second step).
- Generate-all flow: existing cost-preview step FIRST; on Continue, gateway pre-flights `manually-edited-in-scope` for the book; if the list is empty proceed to regenerate; otherwise show the bulk picker as step 2.
- Retry-batch flow: same pre-flight call against the candidate work-item-id set; if any are manually-edited, show the picker before running the batch.
- Picker UI: per-row checkbox (one per manually-edited story) labelled with title + `lastManuallyEditedBy` + `lastManuallyEditedAt`; default UNCHECKED (skip). "Overwrite all" / "Skip all" header toggle.
- On Confirm: re-submit the batch request to gateway with the explicit `manuallyEditedWorkItemIdsToOverwrite: string[]` (and `overwriteManuallyEdited: true` if the array is non-empty). Skipped rows are excluded from the regenerate batch and reported in the result summary.

## Existing Code to Leverage

**`MigrationStorySpecGenerationService.persistOne`**
- Already calls `ShapeSpecHeadingParser` then `SpecQualityScorer` after writing `generated_spec_text`.
- New `applyManualEdit` method mirrors this exact post-write pipeline so parser + scorer behaviour stays consistent with LLM-generated rows.
- Reuse the existing scorer-skip rule for `insufficient_context` / `failed` statuses.

**`MigrationStorySpecGenerationEntity` extension pattern**
- Already extended four times (cross-story-context, missing-input-resolver, target-arch-authoring, spec-quality-scoring), each time adding boxed fields + nullable columns + back-compat behaviour.
- Follow the same recipe: boxed types only (the `primitive_double_dto_overwrite` lesson) and back-compat constructors on DTOs / projections.

**`MigrationDeliveryHierarchyNodeDto`**
- Already extended with `qualityGrade` / `qualityScore` from the spec-quality-scoring spec; add `manuallyEdited` with the same constructor-overload + JPQL-projection pattern.
- Frontend hierarchy tree already pulls grade off this DTO — adding the chip is one more field on the same render path.

**`MigrationDeliveryStoryDrawer.tsx` + `MigrationDeliveryStoryDrawerResolverPanel.tsx`**
- Drawer already houses the quality-breakdown panel, missing-input resolver panel, and Regenerate button; we extend the same drawer with View/Edit toggle and the editor pane.
- The drawer's existing post-action refresh pattern (replace in-memory row with server response) is reused on Save.

**`migrationShapeSpecGenerationHandler.ts` (gateway)**
- Already orchestrates the batch Generate-all flow with cost-preview pre-step and per-row work-item dispatch to AMS.
- Extend to accept the optional overwrite list and pass it through; add the pre-flight call to `manually-edited-in-scope`.

## Out of Scope
- Auto-save (Save button + Cmd/Ctrl+S only).
- Bulk edit across multiple specs in one editor.
- Rich-text / WYSIWYG editor (Markdown source only).
- Full edit-history table (single-slot `previous_spec_text` only).
- LLM-assisted refinement co-pilot inside the editor.
- Collaborative editing or operational transforms.
- Edit-then-execute integration with Claude Code (Wave 2 #8).
- Server-side spec syntax validation beyond the `/agent-os:shape-spec` prefix warning toast.
- Locking / concurrency conflict resolution; v1 is last-write-wins.
- Restoring arbitrary historical versions beyond the single prior slot.

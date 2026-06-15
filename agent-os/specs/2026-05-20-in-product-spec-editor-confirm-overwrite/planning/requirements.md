Today users can VIEW a generated shape-spec in the story drawer but cannot edit it inside the product. To refine a spec — fix wording, add context, correct mistakes — they have to copy out, edit externally, and there's no path back. With the just-shipped spec quality scoring (2026-05-20-spec-quality-scoring) users can SEE which specs are weak (D / F grades), but they still can't fix them in place.

This feature adds an inline Markdown editor in the story drawer with a view/edit toggle, explicit save, audit-trail fields, automatic re-parse + re-score on save, single-slot prior-version history with a diff toggle, and a confirm-overwrite gate on every regeneration path so manual edits aren't silently clobbered.

Working assumptions (already agreed with user, treat as decided unless a real product question arises):

1. Editor placement: inline within the existing story drawer with a view/edit toggle.
2. Editor type: Markdown-aware code editor (e.g., CodeMirror) with light syntax highlighting. NOT rich-text / WYSIWYG.
3. Saving model: explicit Save button + dirty-state indicator. Discard reverts. NO auto-save.
4. Edit metadata audit: `manually_edited` (boolean default false), `last_manually_edited_at` (timestamp nullable), `last_manually_edited_by` (varchar nullable). "Edited" chip on hierarchy node + drawer.
5. Confirm-overwrite trigger scope: single-story Regenerate + Generate-all batch + Retry-batch all fire the check based on `manually_edited`.
6. Confirm-overwrite UX: single-story → simple modal Cancel/Continue. Bulk → per-row checkbox list with Skip-all / Overwrite-all toggles.
7. Re-parse + re-score on save: AMS auto-runs ShapeSpecHeadingParser + SpecQualityScorer; refreshes decisions/interfaces/assumptions + quality fields. No LLM.
8. Edit history: single-slot prior-version (`previous_spec_text` column). No full history table.
9. View original / diff toggle: inline line-diff vs `previous_spec_text` in the drawer.
10. Save-time validation: warn-but-allow if text doesn't start with `/agent-os:shape-spec`.

Out of scope:
- Auto-save
- Bulk-edit-multiple-specs
- Rich-text / WYSIWYG
- Full edit history table
- LLM-assisted refinement co-pilot
- Collaborative editing / OT
- Edit-then-execute integration with Claude Code (that's Wave 2 #8)
- Server-side spec syntax validation beyond the prefix warning
- Locking / concurrency conflict resolution (last-write-wins in v1)
- Restoring arbitrary historical versions

Services touched:
- AMS: new persistence columns on migration_story_spec_generations (`manually_edited`, `last_manually_edited_at`, `last_manually_edited_by`, `previous_spec_text`); new POST /api/projects/{projectId}/spec-generations/{specId}/manual-edit endpoint; extend MigrationDeliveryHierarchyNodeDto with `manuallyEdited`; extend batch/retry entry points with `overwriteManuallyEdited` flag.
- Gateway: thin proxy for manual-edit endpoint; pass-through of overwriteManuallyEdited flag on existing batch/retry routes. No new LLM.
- Frontend: Markdown editor inside MigrationDeliveryStoryDrawer; View/Edit toggle; Save/Discard + dirty-state; Edited chip on node + drawer; inline diff toggle; confirm-overwrite modal (two variants); warning toast.

Inputs: existing generated_spec_text, story title, audit channel.

Outputs: updated generated_spec_text + manually_edited audit fields + previous_spec_text + refreshed parser fields + refreshed quality fields + overwriteManuallyEdited flag flowing through regen paths.

## Visual Assets

No visual assets provided.

## Confirmed product decisions (from clarifying answers)

User confirmed "all defaults" on 2026-05-20 in response to `planning/clarifying-questions.md`. The full verbatim record is in `planning/clarifying-answers.md`. Summary of binding decisions:

1. **Editor library:** CodeMirror 6 (Markdown mode). Not Monaco; not plain textarea.
2. **Save shortcut:** Cmd/Ctrl+S triggers Save inside the editor, with `preventDefault` to suppress the browser "Save Page" dialog. Shortcut is additive to the Save button.
3. **Discard confirmation:** When dirty, prompt "You have unsaved changes. Discard them?" before reverting. No silent revert.
4. **"Edited" chip placement:** Both hierarchy node AND drawer header.
5. **Audit `editedBy` source:** Request header (`X-User-Id` / existing auth header). Not a body field.
6. **Generate-all ordering:** Two-step modal sequence — existing cost-preview first; then, if any selected rows are manually-edited, the per-row overwrite picker as a second step. Do not merge into one combined modal.
7. **Bulk modal default for manually-edited rows:** Skip (checkbox unchecked by default). Users can flip Overwrite-all.
8. **Re-score after save:** Auto-refresh the drawer and hierarchy node from the save response. No "Refresh grade" button.
9. **Save failure UX:** Keep the editor open with the user's text intact and surface an error toast. Do not close the drawer; do not discard in-flight edits.
10. **Diff styling:** Inline unified line-by-line diff (GitHub PR-style). Not side-by-side.

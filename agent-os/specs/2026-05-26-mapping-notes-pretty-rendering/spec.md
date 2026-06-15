# Specification: Mapping-Notes Pretty Rendering in Selective Copy Mapping Review

## Goal

Replace the single-line `<input>` Notes field in the Selective Copy Mapping Review step with a read/edit-toggle cell that preserves whitespace, auto-linkifies `http(s)://` URLs in read mode, and provides a multi-line auto-grow `<textarea>` in edit mode. Frontend-only, one commit, ~100-200 LOC.

## User Stories

- As a migration reviewer recording mapping rationale, I want to write multi-line notes with clickable URLs (Jira tickets, PR refs, internal docs) so that I can capture context-rich justifications without losing line breaks or having to copy-paste URLs from the cell.
- As a reviewer reading notes another teammate wrote, I want long notes to truncate cleanly with a Show more affordance and URLs to render as clickable links so that the Mapping Review table stays compact and navigable.

## Specific Requirements

**New `LinkifiedText` utility component**
- New file `frontend/src/components/common/LinkifiedText.tsx` (~30-50 LOC).
- Props: `{ text: string; className?: string; truncateLines?: number }`.
- Splits `text` on URL boundaries using `/(https?:\/\/[^\s)]+)/g`; multi-URL support is load-bearing (regex-loop must emit one anchor per match).
- For each URL match, strip trailing punctuation `.,;:!?` before building the `href` (URLs in prose like "see https://example.com/path." must not include the trailing period in the link).
- Wraps each URL in `<a href={url} target="_blank" rel="noopener noreferrer">{url}</a>`. Mirror the external-anchor convention from `WorkItemDetailsPanel.tsx`.
- Surrounding text rendered as plain React children (no `dangerouslySetInnerHTML`; XSS-safe by construction).
- When `truncateLines` is set, render with `-webkit-line-clamp` CSS (mirror `WorkItemTree.tsx`'s `.descriptionPreview` pattern); show a Show more / Show less button that toggles unclamped state.

**Read/edit toggle on per-row Notes cell in `SelectiveCopyMappingReviewStep.tsx`**
- Read mode (default): render `<LinkifiedText text={draft.notes} className={styles.notesReadMode} truncateLines={4} />`. Inline `lucide-react` Pencil icon button next to the text flips to edit mode. Pencil-only edit trigger (not click-anywhere) preserves text-selection in read mode for copy-paste.
- Edit mode: render an auto-grow `<textarea>` replacing the current `<input>`. Existing `onChange` → `handleDraftChange(m.id, { notes: ... })` plumbing unchanged.
- Auto-grow via native CSS `field-sizing: content`; CSS-only fallback (`min-height`, `max-height`, `resize: vertical`, `rows={3}`) for browsers without support. No JS auto-grow hook.
- Cancel button (next to existing Save) + ESC keypress while textarea is focused both dismiss edit mode without saving. No click-outside dismissal (risky when user clicks another cell to scroll/inspect).
- Save commits via the existing per-row Save button and flips the cell back to read mode on success.
- In-flight save disables the pencil and Cancel controls.

**Editing-state map**
- New state `editing: Record<string, { notesSnapshot: string } | undefined>` keyed by mapping id.
- Entering edit mode: `editing[m.id] = { notesSnapshot: draft.notes }`.
- Cancel: `handleDraftChange(m.id, { notes: editing[m.id].notesSnapshot }); delete editing[m.id]` — restores ONLY the Notes field, preserving any unsaved changes on the same row's status / mapping-type / confidence.
- Successful Save: `delete editing[m.id]` so the cell naturally flips back to read mode.
- Refetch behaviour: clear the `editing` map alongside the existing draft wipe in `refetchMappings()` — semantics stay consistent with the pre-existing refetch-wipes-drafts behaviour (not extended to be more durable).

**Manual-add row Notes field**
- Always-on `<textarea>` (replacing the current `<input>`) with the same auto-grow CSS class as the per-row textarea.
- No read/edit toggle — the row is mid-creation, always in edit state.
- No pencil icon, no Cancel button — commit semantics are owned by the existing manual-add commit flow.

**CSS additions**
- Append to `SelectiveCopyMappingReviewStep.module.css` (or the matching `.module.css` file for the component).
- `.notesReadMode` — `white-space: pre-wrap; word-break: break-word; min-height: 1em;` (NOT `cursor: pointer` — pencil is the trigger).
- `.notesReadModeTruncated` — `display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;` (mirror `WorkItemTree.module.css` `.descriptionPreview`).
- `.notesShowMoreButton` — small inline-link button styling.
- `.notesEditTextarea` — `width: 100%; min-height: 3em; max-height: 12em; resize: vertical; field-sizing: content;`.
- `.notesEditCellWrapper` — flex column wrapping the textarea and the Cancel/Save row.
- `.notesPencilButton` — small icon button styling.
- `.notesLink` — link colour matching existing link styles.

**Tests (5 frontend Vitest, 0 backend)**
- `LinkifiedText` with no-URL input emits zero `<a>` tags.
- `LinkifiedText` with two URLs in one string emits exactly two `<a target="_blank" rel="noopener noreferrer">` anchors (multi-match regex-loop assertion is load-bearing).
- Truncation: notes longer than 4 lines render the Show more affordance; clicking expands to full text.
- Per-row Edit: pencil click flips the cell to a `<textarea>`; typing multi-line content + Save flips back to read mode with the new value rendered.
- Manual-add row's notes field is a `<textarea>` (not `<input>`) and accepts multi-line input.

**Verification anchors**
- Open Mapping Review. Notes render in read mode with `white-space: pre-wrap`. URLs render as clickable `<a target="_blank" rel="noopener noreferrer">`; trailing punctuation in prose (`.,;:!?`) is not part of the `href`.
- Pencil click flips cell to a `<textarea>` that auto-grows with content (up to `max-height` then scroll).
- Multi-line text + Save flips back to read mode showing the new content.
- Edit → Cancel (or ESC) reverts notes to the pre-edit value; other unsaved changes on the same row (status / mapping-type / confidence) are preserved.
- Long notes (>4 lines) truncate with Show more; clicking expands.
- Manual-add row's notes field is a textarea from the start.
- No regression to filters, search, mapping-type / status / confidence editing, Save/Delete actions, manual-add commit flow, or the 9-column table structure.

## Existing Code to Leverage

**`frontend/src/components/ProductView/WorkItemTree.tsx` + `WorkItemTree.module.css` (lines 202-222 / 218-260)**
- Direct precedent for truncated-preview-with-line-clamp + Show more / Show less toggle.
- Reuse the CSS pattern (`-webkit-line-clamp`, `display: -webkit-box`, `-webkit-box-orient: vertical`, `overflow: hidden`) and the button copy.
- Adjust clamp count from 2 to 4 (notes are typically longer than work-item descriptions).
- Expansion state lives in the parent component (mirror that separation).

**`frontend/src/components/ProductView/WorkItemDetailsPanel.tsx` (lines 416-427)**
- Established convention for external `<a>` tags: `target="_blank" rel="noopener noreferrer"`.
- `LinkifiedText` mirrors this exactly for each URL anchor it emits.

**`frontend/src/components/common/`**
- Established home for small presentational utilities (`Button.tsx`, `Modal.tsx`, `Toast.tsx`, `MultiValueChipsInput.tsx`).
- New `LinkifiedText.tsx` lives here; sibling `LinkifiedText.module.css` if styles are component-local.

**`frontend/src/components/TopBar/SelectiveCopyMappingReviewStep.tsx` draft state machine**
- Existing `drafts: Record<string, RowDraft>` keyed by mapping id and `handleDraftChange(id, patch)` plumbing is reused unchanged.
- The new `editing` state map sits alongside `drafts`; cleared on Save success and on `refetchMappings()`.
- Existing per-row Save button is the commit mechanism — no save-on-blur introduced.

**`frontend/src/components/Architecture/CapturedDecisionChip.tsx`**
- Reference for ESC-key handling in a small interactive cell (clean precedent for the Cancel-via-ESC path on the edit textarea).

## Out of Scope

- Markdown rendering (bold, italic, lists, headings).
- Internal-link pattern recognition (Jira keys, GitHub PR refs, etc.) — v2.
- Rich-text editor or formatting toolbar.
- Character / token counters.
- Mentions / @-references / autocomplete.
- History / revision tracking for notes.
- Notes rendered in any other surface (investigation confirmed Mapping Review is the only surface that displays mapping notes).
- AMS persistence changes (notes column stays `TEXT`; wire shape unchanged).
- Notes export / import.
- Diff view between revisions of notes.
- Notes templates / quick-fill.
- Save-on-blur behaviour (existing explicit Save button retained).
- Click-outside dismissal of edit mode (risky UX; deferred).
- URL trimming for visual display (full URL rendered; v2 if users complain about long URLs).
- JS-based auto-grow fallback for browsers without `field-sizing: content` (CSS-only `min/max-height` + `resize: vertical` + `rows={3}` is sufficient).

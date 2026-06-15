# Raw Idea: Mapping-Notes Pretty Rendering in Selective Copy Mapping Review

## Why this spec exists

The Selective Copy Mapping Review step (`frontend/src/components/TopBar/SelectiveCopyMappingReviewStep.tsx`, 823 LOC) renders one row per cross-architecture element mapping with an editable "Notes" column. Today that column is a **plain single-line `<input type="text">`** (line 624-633). Users can type free text but:

- Newlines aren't visible while editing or after save — multi-line notes are functionally impossible.
- URLs (Jira tickets, GitHub PRs, internal docs) render as plain text — no clickable navigation.
- Long notes truncate visually inside the input width — the user can't see what they typed without selecting and scrolling.
- The manual-add row's notes field has the same limitation.

This isn't a functional bug — notes still persist correctly to `architecture_element_mappings.notes` on AMS — but it actively discourages users from writing useful notes. The natural place to record migration rationale ("merged X and Y because legacy team retired", "see PROJ-123 for full discussion") is the Notes column, and the current rendering punishes that workflow.

This spec gives mapping notes a **modest visual upgrade**:

1. Multi-line editing via `<textarea>` instead of `<input>`.
2. URL auto-linkification in read mode (clickable `http(s)://` links).
3. Whitespace preservation so newlines render correctly.
4. (Optional) Click-to-edit pattern so the default state is a clean read view; the textarea appears when the user wants to edit.

This is a **Small** spec — one component, one new small utility, ~100-200 LOC frontend-only, no backend changes, no AMS DTO changes.

## What this spec is (and isn't)

**This spec is:**

- A read/edit-mode pattern for the Notes cell:
  - **Read mode** (default): formatted display with `white-space: pre-wrap`, URLs converted to clickable `<a target="_blank" rel="noopener noreferrer">` links. Truncate visually long notes with a "Show more" affordance.
  - **Edit mode**: an auto-grow `<textarea>` (or fixed `rows={3}` minimum) supporting multi-line entry. Save button commits and flips back to read mode.
- A small new utility component `LinkifiedText.tsx` (or equivalent) that renders text with URLs detected via a focused regex and wrapped in safe anchor tags. Pure presentational, ~30 LOC.
- A CSS refresh for the Notes cell (and the manual-add row's notes field): preserve whitespace, sensible max-height in read mode with overflow indicator.
- Applies to **both** the per-row Notes cell and the manual-add row's Notes input.

**This spec is not:**

- A markdown renderer. Bold / italic / lists / headings are explicitly out of scope. The notes are short-form free text + URLs, not documentation.
- A rich-text editor. No WYSIWYG, no formatting toolbar.
- A change to the AMS persistence (notes stay as `TEXT` column; nothing about the wire shape changes).
- A change to validation rules (notes still optional, still free-text, still capped only by Postgres `TEXT` limit).
- A change to who can edit notes (existing reviewer flow unchanged).
- A change to any OTHER surface that displays notes. As of investigation, the Mapping Review is the only surface that renders mapping notes in the UI — no read-only display elsewhere.
- A backfill or migration of existing notes. Existing notes that happen to be single-line render as a single line in read mode (no semantic loss); existing notes with literal `\n` characters (unusual but possible via API direct edit) render with the newlines preserved.
- A "mentions" / @-reference / autocomplete feature.
- A history / revision-tracking surface for notes.
- A character / token counter (defer to v2 if useful).
- Internal-link recognition (e.g. auto-link `PROJ-123` to Jira). Generic `http(s)://` linkification only; internal-link patterns are a v2 if users adopt the pattern.

## Decisions already made (don't re-litigate in shape-spec)

These were settled while drafting this raw idea:

1. **No markdown.** Plain text + URL linkification only. Markdown would require a renderer dep and adds complexity for marginal value on this surface.
2. **Generic `http(s)://` URL linkification only.** Internal-link pattern recognition (Jira keys, GitHub PR refs, etc.) is a v2 if users adopt the pattern. v1 keeps the regex small and safe.
3. **Read/edit toggle (click-to-edit) preferred over always-textarea.** Cleaner default presentation; URLs render as links in read mode; edit mode is one click away.
4. **Auto-grow textarea (or fixed `rows={3}` minimum).** No external dep — either a small `useLayoutEffect` height adjustment or a CSS `field-sizing: content` (modern browsers) shim. Implementer picks.
5. **Truncation with "Show more"** in read mode when notes exceed ~4 visible lines. Avoid pushing the Mapping Review table row height unboundedly for chatty notes.
6. **Linkification is XSS-safe by construction**: regex extracts only well-formed `http(s)://` URLs; the wrapping component uses React's default text-escaping (no `dangerouslySetInnerHTML`).
7. **Same treatment applies to the manual-add row** (line 777-784) — the manual-add row stays in "edit" state always (since the whole row is being created), so it just gets the auto-grow textarea, not the read/edit toggle.
8. **One commit, frontend-only.**

## Specific requirements (rough — let shape-spec refine)

### New utility component `LinkifiedText.tsx`

Location: `frontend/src/components/common/LinkifiedText.tsx` (or `frontend/src/utils/LinkifiedText.tsx` — match existing convention; check whether `common/` exists).

```ts
interface LinkifiedTextProps {
  text: string;
  className?: string;
  truncateLines?: number;     // optional; renders "Show more" when text exceeds this
}
```

- Splits `text` on URL boundaries using a focused regex (e.g. `/(https?:\/\/[^\s)]+)/g`).
- Wraps each URL match in `<a href={url} target="_blank" rel="noopener noreferrer">{url}</a>`.
- Renders surrounding text as plain text (React's default escaping handles HTML/script tags safely).
- Applies `white-space: pre-wrap` via the passed `className` so newlines render.
- When `truncateLines` is set: render with `display: -webkit-box; -webkit-line-clamp: {N}; -webkit-box-orient: vertical; overflow: hidden;` (legacy but well-supported) plus a "Show more" button below that toggles unclamped state. Modern `text-overflow: ellipsis` doesn't support multi-line.

### Read/edit toggle in `SelectiveCopyMappingReviewStep.tsx`

Per-row Notes cell:

- **Read mode (default)**: render `<LinkifiedText text={draft.notes} className={styles.notesReadMode} truncateLines={4} />`. Clicking the cell (or a small "Edit" icon button) flips to edit mode.
- **Edit mode**: render an auto-grow `<textarea>` (replacing the current `<input>`). Standard `onChange` → `handleDraftChange(m.id, { notes: ... })` plumbing unchanged. Save commits via the existing per-row Save button AND flips the cell back to read mode on success. Cancel button (or click-outside) flips back without saving.
- Newly-added rows (after manual-add commits) default to read mode.
- Rows being saved (in-flight) show a small spinner / disabled state on the toggle.

Manual-add row Notes field:

- Always in edit mode (auto-grow `<textarea>`), since the whole row is being created.
- After successful create, the new row in the table appears in read mode by default.

### CSS additions

Append to `SelectiveCopyMappingReviewStep.module.css` (or the relevant `.module.css` file):

- `.notesReadMode` — `white-space: pre-wrap; word-break: break-word; cursor: pointer; min-height: 1em;`
- `.notesReadModeTruncated` — `-webkit-line-clamp: 4` ... etc.
- `.notesShowMoreButton` — small inline button styling
- `.notesEditTextarea` — `width: 100%; min-height: 3em; resize: vertical; field-sizing: content; (with fallback)`
- `.notesCellEditToggleButton` — small icon button inline within the read-mode cell
- `.notesLink` — link styling for embedded URLs (match existing link colour)

### Tests

Frontend Vitest tests (~4-5):

1. `LinkifiedText` renders plain text without URL → no `<a>` tags emitted.
2. `LinkifiedText` renders text with one URL → exactly one `<a target="_blank" rel="noopener noreferrer">` wrapping the URL.
3. `LinkifiedText` with `truncateLines={4}` and long text shows "Show more"; clicking expands.
4. Mapping Review row: clicking a read-mode notes cell flips to textarea; typing + saving flips back to read mode with the new value.
5. Manual-add row: notes field renders as textarea (not input); accepts multi-line input.

### Verification

- Open Mapping Review wizard step. Confirm:
  - Existing notes render in read mode with whitespace preserved.
  - URLs in notes are clickable and open in a new tab.
  - Clicking the Notes cell flips it to a multi-line textarea.
  - Typing multi-line text + Save → row flips back to read mode showing the new multi-line content.
  - Long notes truncate to ~4 lines with "Show more"; expanding shows the full text.
  - Manual-add row's notes field is a textarea from the start.
- All previously-passing tests still pass; no regressions to the existing 9-column table structure.

## Out of Scope

- Markdown rendering of any kind.
- Internal-link pattern recognition (Jira keys, GitHub PR refs, etc.).
- Rich-text editor / formatting toolbar.
- Character / token counters.
- Mentions / @-references / autocomplete.
- History / revision tracking for notes.
- Notes rendered in any OTHER surface (no other surface displays mapping notes today).
- AMS persistence changes (notes column stays `TEXT`).
- Notes export / import.
- A diff view between revisions of notes.
- Notes templates / quick-fill.
- Server-side validation of URL safety (client side already uses `rel="noopener noreferrer"` and React's escaping; server keeps accepting any string per existing contract).

## Dependencies

- `2026-05-15-create-target-baseline-from-current-state` (shipped) — introduced the Mapping Review step + notes column.

No new external dependencies.

## Open questions for shape-spec to clarify

1. **Read/edit toggle vs always-textarea?** v1 raw-idea proposes read/edit toggle. Alternative: always-on textarea (simpler; loses clickable URLs unless we add a sibling read display). My instinct: **read/edit toggle**. Click-to-edit feels natural for inline cells and gives clean read-mode rendering.

2. **Trigger for entering edit mode — click anywhere in cell, or only on an explicit "Edit" icon?** Click-anywhere is more discoverable but conflicts with text-selection (user can't select URL text to copy). My instinct: **explicit "Edit" icon button** (small pencil), preserving text-selection for read mode. Slight UX hit on discoverability; net win on copy-paste usability.

3. **Truncation threshold.** v1 raw-idea proposes 4 lines. Adjustable. My instinct: **4 lines** — enough for short rationale, short enough to keep table compact.

4. **Auto-grow textarea implementation.** Native `field-sizing: content` (Chrome 123+, Safari 17+, Firefox 121+) vs `useLayoutEffect` height adjustment. My instinct: **native `field-sizing: content` with a sensible `min-height` fallback for older browsers** — zero JS.

5. **Save-on-blur vs explicit Save button?** Today the row has an explicit Save button. Changing to save-on-blur would surprise users. My instinct: **keep explicit Save** — matches existing flow. The read/edit toggle flips back to read on Save (or on Cancel without committing).

6. **What happens if user clicks "Edit" then immediately clicks outside without saving?** Treat as Cancel (discard draft changes, flip back to read mode) or hold the draft until explicit Cancel/Save? My instinct: **hold the draft** — matches the existing draft-state semantics elsewhere in the form. Click-outside is not a commit-or-discard signal.

7. **URL linkification regex scope.** `https?://` plus any non-whitespace, non-paren characters? Or include mailto, www. (without scheme), Jira keys? My instinct: **`https?://` only for v1** — minimal regex, no false positives, deferred enrichment in v2.

8. **Linkified URL display — full URL or trimmed?** Long URLs become visually noisy. Trim to e.g. "example.com/..." style display while preserving the full `href`? My instinct: **full URL display** in v1 — simpler; users can hover to see the full path anyway. v2 can trim if needed.

9. **Affects only the Mapping Review surface?** Confirmed via grep: notes are only displayed in `SelectiveCopyMappingReviewStep.tsx`. The `architecture_element_mappings.notes` column is fetched via `architecturesApi.ts` but only consumed by this one component. My instinct: **yes, single-surface change**.

10. **Test cap.** 4-5 frontend tests, 0 backend. My instinct: **yes**.

11. **Commit boundary.** Single commit, frontend-only. My instinct: **yes**.

## Verification

After this spec:
- Mapping Review notes render in read mode with preserved whitespace + clickable URLs.
- Clicking the per-row Edit icon opens an auto-grow textarea for multi-line editing.
- Save commits the new notes and flips the cell back to read mode.
- Long notes truncate with "Show more"; expanding reveals the full text.
- Manual-add row's notes field is a textarea (not single-line input).
- No regressions to other Mapping Review functionality (mapping_type / status / confidence editing, manual-add, filters, search).

## Commit boundary

One commit, all-frontend. ~100-200 LOC: 1 new utility component + small modifications to `SelectiveCopyMappingReviewStep.tsx` + CSS additions + 4-5 tests.

# Spec Requirements: Mapping-Notes Pretty Rendering

## Initial Description

See `planning/raw-idea.md`. Summary: replace the single-line `<input>` notes
field in `SelectiveCopyMappingReviewStep.tsx` with a read/edit-toggle cell
that supports multi-line text, preserves whitespace, and auto-linkifies
`http(s)://` URLs. Same treatment for the manual-add row. New small utility
`LinkifiedText.tsx`. Frontend-only, one commit, ~100-200 LOC.

## Validated Findings (pre-research)

### 1. Single-surface claim — VERIFIED

Grep for `notes` references against `architecture_element_mappings` /
mapping DTO surfaces produced three matches besides the target component:

| File | Reference | Verdict |
|---|---|---|
| `frontend/src/api/architecturesApi.ts:841` | Comment in the `updateArchitectureMapping` JSDoc listing the four mutable fields | Not a display surface |
| `frontend/src/components/targetState/architectConversation/ConversationMainPane.tsx:376` | `Notes decorations: {turn.notesDecorations}` — renders an integer **count** of notes-touching decorations from a mutation-summary turn payload | Not a notes-content display surface |
| `frontend/src/components/DashboardView/codeDetectionEvidenceBuilder.ts:48` | TODO comment: `notes — no populator yet; defer to the spec that first uses notes.` | Unrelated `notes` field on a different DTO (code-detection evidence), not mapping notes |

Conclusion: **`SelectiveCopyMappingReviewStep.tsx` is the only surface that
renders mapping notes content.** Single-surface claim stands. No other
component needs updating.

### 2. Component location — DECIDED

`frontend/src/components/common/` exists and is the established home for
small presentational utilities (`Button.tsx`, `Modal.tsx`, `Toast.tsx`,
`MultiValueChipsInput.tsx`). `frontend/src/utils/` is heavily skewed toward
diagram / layout / data-transform logic — no pure presentational
components live there.

**Decision: place the new component at
`frontend/src/components/common/LinkifiedText.tsx`** (with a sibling
`LinkifiedText.module.css` if needed, matching the `common/` convention).

### 3. `field-sizing: content` browser support — STANCE

Native support: Chrome 123 (Mar 2024), Edge 123 (Mar 2024), Safari 17.4
(Mar 2024). Firefox enabled it more recently. Global support is ~80%+ as
of mid-2025 but Firefox users on older versions still hit the unsupported
path.

Codebase has **zero existing uses** of `field-sizing` or any
`useLayoutEffect` based textarea auto-grow. `browserslist` is not
configured — Vite + React defaults apply (no explicit floor).

**Stance: use native `field-sizing: content` as the primary mechanism,
with a CSS-only fallback that ships sensible defaults for browsers that
ignore the property** — `min-height: 3em; max-height: 12em; resize:
vertical;` plus `rows={3}` on the `<textarea>`. Unsupported browsers get a
fixed-3-row textarea that the user can manually drag to resize; supported
browsers get auto-grow for free. No JS auto-grow hook needed in v1; we
can revisit in v2 if Firefox-floor users complain.

### 4. Existing draft state machine — INTEGRATION POINTS

Reading `SelectiveCopyMappingReviewStep.tsx`:

- **Drafts live in component state**: `drafts: Record<string, RowDraft>`
  keyed by mapping id. Each row's `<input>` is a controlled component
  reading from `drafts[m.id]`.
- **Draft seeding**: `refetchMappings()` rebuilds `drafts` from scratch
  whenever it runs — on mount, on filter change, AND after every
  successful Save/Delete on ANY row.
- **Consequence relevant to this spec**: if a user is in edit mode on row
  A and saves row B (or changes a filter), the refetch wipes A's draft.
  This already happens today with the `<input>` (the typed value is lost
  too) — so it's a pre-existing footgun, not a new issue introduced by
  this spec. We do NOT need to fix it here.
- **No Cancel button today** — the per-row action cell has only Save and
  Delete. The raw-idea proposes adding a Cancel (or relying on
  click-outside) when in edit mode. This is a small new UI element
  worth confirming.
- **`handleSaveRow` on success calls `refetchMappings()`** which reseeds
  drafts. So when Save commits, the row's draft is replaced by a fresh
  one from server state — the cell can naturally flip back to read mode
  on save because the edit-mode-open state lives in a separate map
  (`editing: Record<string, boolean>`), and we can clear that entry on
  successful Save.

**Integration approach for the read/edit toggle:**

- Add a new state map `editing: Record<string, boolean>` (or
  `editingRowIds: Set<string>`) alongside `drafts`.
- Cell renders `<LinkifiedText>` when `editing[m.id]` is falsy; renders
  the auto-grow `<textarea>` otherwise.
- Pencil/Edit icon button in read mode flips `editing[m.id] = true`.
- On `handleSaveRow` success, clear `editing[m.id]` so the cell flips
  back to read.
- On Cancel (or click-outside, depending on Q decision below), clear
  `editing[m.id]` AND restore the row's draft from the latest server
  value (re-derive via `rowDraftFromMapping(m)`).

### 5. Table layout & truncation — COMPATIBLE

CSS audit of `SelectiveCopyWizardModal.module.css`:

- `.mappingTable td` has `vertical-align: top` — already friendly to
  variable-height cells.
- `.mappingTable input, .mappingTable select` are `width: 100%;
  box-sizing: border-box;` — replacing the `<input>` with a `<textarea>`
  inheriting the same classes is layout-safe.
- No fixed `<th>` widths or `table-layout: fixed` rule — column widths
  are intrinsic, so variable row heights from a 4-line-clamped read
  mode won't break neighbouring rows.

`-webkit-line-clamp` already used in the codebase
(`WorkItemTree.module.css:223` for description preview, mirror-style:
2 lines). **Verified pattern: `-webkit-line-clamp` + `display:
-webkit-box` + `-webkit-box-orient: vertical` + `overflow: hidden`** —
this is the established convention. The `.notesReadModeTruncated`
class can mirror `WorkItemTree`'s `.descriptionPreview` directly.

### 6. Existing read/edit-toggle precedent — GOLD-STANDARD MATCH

Best in-codebase mirror is **`WorkItemTree.tsx` + `WorkItemTree.module.css`**:

- `descriptionPreview` (truncated, line-clamp 2) ⇄ `descriptionExpanded`
  (`white-space: pre-wrap`, no clamp).
- `Show more` / `Show less` toggle button with `.showMoreLink` class
  styled as inline link button.
- The expansion state lives in the parent (`expandedDescriptionIds` Set),
  not the row component — clean separation that we can mirror.

**This spec should explicitly mirror that pattern** for the truncation /
expand affordance. Visual rhythm will then feel consistent across the
product. The button copy "Show more" / "Show less" matches.

For the read↔edit toggle itself (pencil icon → textarea), the closest
local precedents are `Grid/FreeTextTypeaheadSingleToken.tsx`,
`Grid/DataEntityPointSelect.tsx`, `Grid/ApplicationPointPickerCell.tsx`
— all `isEditing` boolean state with `<div>` read-mode and `<input>`
edit-mode, click/double-click to enter edit, click-outside to commit.
The Grid pattern commits on click-outside (no Save button). **The
mapping-review row has an explicit per-row Save button instead, so the
Grid commit-on-blur pattern doesn't transfer directly.** The
read/edit-toggle here is more of a "show as read view by default, swap
in the textarea for editing, the existing Save button is what commits".

`CapturedDecisionChip.tsx` is a popover-on-click pattern, not a swap
pattern — not a match for the read/edit toggle, but its click-outside +
ESC handling is a clean reference for "Cancel from edit mode" if we
want ESC support.

### 7. New utility — no precedent, hand-roll

No existing `LinkifiedText`, `Autolink`, or similar utility. No
markdown / linkify lib in `package.json`. The component is new and
small (~30-40 LOC including the URL-split regex helper). Render via
React array of text/anchor fragments — `dangerouslySetInnerHTML` is
explicitly avoided (XSS-safe by construction).

### 8. No new tests file exists yet

Grep confirms there is no `SelectiveCopyMappingReviewStep.test.tsx`.
The spec will add a new test file. Vitest + `@testing-library/react`
are already wired (per `package.json`). For the new
`LinkifiedText.tsx`, sibling `.test.tsx` alongside the component.

## Existing Code to Reference

**Similar features identified:**

- **`frontend/src/components/ProductView/WorkItemTree.tsx` (lines 202-222)
  and `WorkItemTree.module.css` (lines 218-260)** — direct precedent for
  truncated-preview-with-line-clamp + Show more/less toggle. Reuse the
  CSS pattern (`-webkit-line-clamp`, `-webkit-box`, `-webkit-box-orient:
  vertical`, `overflow: hidden`) and the button copy. Adjust line-clamp
  count from 2 to 4 per the raw-idea decision.
- **`frontend/src/components/Grid/FreeTextTypeaheadSingleToken.tsx`,
  `Grid/DataEntityPointSelect.tsx`, `Grid/ApplicationPointPickerCell.tsx`**
  — `isEditing` boolean state with read-mode `<div>` ⇄ edit-mode
  `<input>` swap. Useful structural reference; commit semantics differ
  (Grid uses click-outside-to-commit, our Mapping Review uses an
  explicit Save button).
- **`frontend/src/components/Architecture/CapturedDecisionChip.tsx`** —
  click-outside + ESC handler reference if we add ESC-to-cancel.
- **`frontend/src/components/ProductView/WorkItemDetailsPanel.tsx:416-427`**
  — established convention for external `<a>` tags: `target="_blank"
  rel="noopener noreferrer"`. Mirror exactly in `LinkifiedText`.
- **`frontend/src/components/common/`** — established home for small
  presentational utilities (Button, Modal, Toast, MultiValueChipsInput).
  Place `LinkifiedText.tsx` here.

**Backend logic to reference:** None. AMS wire shape unchanged.

## Visual Assets

No visual assets provided. The spec is code-only on an existing surface;
the look-and-feel is determined by mirroring `WorkItemTree` for
truncation and the existing `.mappingTable` styles for the rest.

## Requirements Summary

### Functional requirements

- Per-row Notes cell defaults to a **read mode** showing notes with
  whitespace preserved and `http(s)://` URLs as clickable links opening
  in a new tab (`target="_blank" rel="noopener noreferrer"`).
- Long notes truncate at **4 visible lines** with a `Show more` button
  that toggles to `Show less` and reveals the full text.
- A pencil/Edit icon button in the cell flips the cell to **edit mode**,
  swapping the read view for an auto-grow `<textarea>` seeded with the
  current draft value.
- Edit-mode textarea supports multi-line entry; existing per-row Save
  button commits and flips the cell back to read mode on success.
- Cancel-from-edit-mode behaviour (see Q1 below).
- The **manual-add row's notes field** is permanently in edit mode (a
  `<textarea>`, not the read/edit toggle), since the row is being
  created. Auto-grow applies.
- New `LinkifiedText` utility component at
  `frontend/src/components/common/LinkifiedText.tsx`.

### Reusability opportunities

- Mirror `WorkItemTree.module.css` `.descriptionPreview` /
  `.descriptionExpanded` / `.showMoreLink` for read-mode CSS.
- Mirror `WorkItemDetailsPanel.tsx`'s `<a target="_blank"
  rel="noopener noreferrer">` for linkified URLs.
- Use `common/` directory convention for the new utility.

### Scope boundaries

**In scope:**

- Read/edit toggle in the per-row Notes cell.
- Always-textarea in the manual-add row Notes field.
- `LinkifiedText` utility component (plain text + `http(s)://` URL
  detection + anchor wrapping + optional truncation).
- CSS additions in `SelectiveCopyWizardModal.module.css` (or sibling
  CSS module for `LinkifiedText`).
- 4-5 Vitest tests (per raw-idea cap).

**Out of scope:**

- Markdown rendering.
- Internal-link recognition (Jira keys, PR refs, etc.) — v2.
- Rich-text editor / toolbar.
- Character / token counter.
- Notes rendered on any other surface (none exist).
- AMS persistence changes.
- A JS-based auto-grow fallback for browsers without
  `field-sizing: content` (the CSS-only fallback is sufficient).
- Cross-row "leave-with-unsaved-changes" warnings — the existing
  draft-wipe-on-refetch behaviour is unchanged.

### Technical considerations

- Frontend-only, one commit, ~100-200 LOC.
- `LinkifiedText` MUST NOT use `dangerouslySetInnerHTML` — render text
  and anchors as React children using the URL-split regex pattern.
- URL regex: `/(https?:\/\/[^\s]+)/g` (raw-idea proposes excluding `)`
  too; this is a small refinement worth confirming in Q5).
- Auto-grow textarea uses native `field-sizing: content` with CSS-only
  fallback (`min-height`, `max-height`, `resize: vertical`, `rows={3}`).
  No `useLayoutEffect`.
- Existing `refetchMappings()` wipe-on-refetch behaviour applies to
  the new `editing[m.id]` state too — on successful Save the row's
  edit state must be cleared (so the cell flips back to read).
- Add a per-row Cancel control next to Save when in edit mode (or
  rely on ESC / click-outside — Q1).
- Edit-mode entry point: pencil icon button (per raw-idea Q2 instinct
  — "explicit Edit icon, preserves text-selection in read mode for
  copy-paste"). Q2 below confirms.

## Clarifying Questions

The raw-idea's 11 open questions, refined and merged after investigation.
Some are now settled by the investigation; the remaining real product
calls are below. I have stated my recommended default after each.

1. **Cancel-from-edit-mode mechanism.** When the user has clicked Edit
   and started typing, how do they back out without saving?
   Options:
   (a) Explicit Cancel button alongside Save in the row's actions cell
   (only visible while editing).
   (b) ESC key while textarea is focused.
   (c) Click outside the row.
   (d) All of the above.
   The existing draft model HOLDS the draft until refetch — i.e. there
   is no "discard local changes" path today. For this spec we need a
   way to explicitly discard.
   **My instinct: (a) + (b). Explicit Cancel button + ESC.** Skip
   click-outside (matches CapturedDecisionChip / popover patterns but
   not table-cell patterns — and click-outside is risky when the user
   is just clicking another cell to scroll/inspect). Cancel restores
   `drafts[m.id]` from the latest server value and clears
   `editing[m.id]`.

2. **Edit-mode entry trigger.** Pencil icon button only, or also
   click-on-the-read-text? Raw-idea Q2 leaned pencil-only (preserves
   text-selection in read mode so users can copy URLs / quote text).
   **My instinct: pencil-only.** Aligns with raw-idea preference and
   the discoverability hit is mitigated by the icon being right next
   to the rendered text.

3. **Where does the pencil/Edit icon live?** Two options:
   (a) Inline within the Notes cell itself (e.g. a small icon button
   at the top-right of the read content, or after the text).
   (b) In the Actions column (Save/Delete) as a third Edit button that
   flips edit mode for the row's notes specifically.
   **My instinct: (a) inline within the cell.** The Actions column
   today is about row-level commit/delete; adding a per-field
   Edit button there muddies the model. Inline keeps the affordance
   right next to the content it edits. Use a `lucide-react` Pencil
   icon (the lib is already a dep).

4. **Truncation threshold.** Raw-idea proposes 4 lines. Settled.
   **My instinct: 4 lines.** Mirror `WorkItemTree`'s line-clamp pattern
   (just with N=4 instead of N=2 since notes are likely longer than
   work-item descriptions). No change requested.

5. **URL regex exact form.** Raw-idea proposes
   `/(https?:\/\/[^\s)]+)/g` (excludes spaces and close-paren so URLs
   inside parens render correctly). Trailing punctuation
   (`.`, `,`, `;`, `:`) commonly hangs off URLs in prose — should we
   strip those from the match too, so "see https://example.com/path."
   doesn't include the trailing period in the href?
   **My instinct: keep raw-idea regex `/(https?:\/\/[^\s)]+)/g` AS-IS,
   plus a post-match trim of trailing `.,;:!?` from each captured URL
   before building the `<a href>`.** Five-character trailing-trim
   adds zero complexity and fixes the common case. Encoded URLs that
   legitimately end in `%2E` etc. are unaffected (the trim only
   strips literal punctuation).

6. **Linkified URL display.** Show the full URL or trim long ones
   visually (e.g. `example.com/...`)? Raw-idea instinct: full URL.
   **My instinct: full URL, no trimming.** Simpler; users hover for
   the full path is moot when the link text IS the full path. v2 can
   trim if users complain.

7. **`Show more` interaction in edit mode.** Truncation only applies
   in read mode — when the user is in edit mode, the textarea shows
   everything (subject to auto-grow + max-height). Confirm: when the
   user enters edit mode on a truncated note, they don't need to
   click `Show more` first; the textarea expands to fit the content
   (up to max-height with scroll).
   **My instinct: yes, confirm.** Edit mode bypasses the truncation
   entirely; the auto-grow textarea handles its own height.

8. **Cancel restores from latest server or from edit-entry snapshot?**
   When the user clicks Edit, makes changes, then clicks Cancel,
   should the draft revert to:
   (a) The latest server value (what `rowDraftFromMapping(m)`
   produces — i.e. what would appear after a refetch).
   (b) The value the cell had at the moment they clicked Edit (which
   could include other unsaved draft fields from before).
   These differ only when there are unsaved changes to OTHER fields
   on the same row (status / mapping-type / confidence). The draft
   model holds those across edits too.
   **My instinct: (b) — snapshot at edit-entry.** Cancel should only
   discard changes made AFTER clicking Edit on Notes, not blow away
   unsaved changes to other fields on the same row. Implementation:
   capture `draft.notes` on entering edit mode, restore that single
   field on Cancel.

9. **Manual-add textarea — auto-grow or fixed rows?** Manual-add is
   always in edit mode. Same auto-grow `field-sizing: content` +
   `rows={3}` + `max-height` as the per-row textarea?
   **My instinct: yes, same behaviour.** Consistency keeps the
   implementation small (one CSS class on both textareas).

10. **Test cap.** Raw-idea proposes 4-5 tests:
    1. `LinkifiedText` no URL → no `<a>`.
    2. `LinkifiedText` with URL → one `<a target="_blank"
       rel="noopener noreferrer">`.
    3. `LinkifiedText` truncation → Show more, click expands.
    4. Mapping-review row: click Edit → flips to textarea; type +
       Save → flips back, value shown.
    5. Manual-add row: notes is a textarea, accepts multi-line input.
    **My instinct: confirm 4-5 tests, same five as above.** I would
    add inside test (2) an assertion that two URLs in one string both
    render as anchors (the regex-loop is the load-bearing bit).

11. **Commit boundary.** Single commit, frontend-only.
    **My instinct: yes, single commit.** Confirmed by investigation —
    no AMS changes needed, no other surfaces touched.

## Accepted Answers (2026-05-26)

User accepted all defaults. Decisions to encode in the spec:

- **Q1 Cancel mechanism**: explicit Cancel button (next to Save, only
  while editing) + ESC keypress. No click-outside dismissal — risky
  if user clicks another cell to scroll/inspect.
- **Q2 Edit-mode entry trigger**: pencil icon only, NOT click-anywhere
  on the read text. Preserves text-selection for copy-paste in read
  mode.
- **Q3 Pencil icon location**: inline inside the Notes cell next to
  the text. Use `lucide-react` Pencil (already a dep). Keeps affordance
  next to the content.
- **Q4 Truncation threshold**: 4 lines. Mirror `WorkItemTree.tsx`'s
  pattern (N=2 there, N=4 here). Use the same `-webkit-line-clamp`
  CSS technique already proven in the codebase.
- **Q5 URL regex with trailing-punctuation strip**: regex stays
  `/(https?:\/\/[^\s)]+)/g`; add a 5-char trailing-trim post-match for
  `.,;:!?` so URLs in prose ("see https://example.com/path.") don't
  capture the trailing punctuation in the `href`.
- **Q6 Linkified URL display**: full URL text, no visual trimming.
  v2 can trim if users complain about long URLs.
- **Q7 `Show more` in edit mode**: edit mode bypasses the line-clamp
  entirely — the textarea auto-grows to content (no Show-more click
  needed first). Confirmed.
- **Q8 Cancel scope**: snapshot the Notes value on edit-entry; on
  Cancel, restore only that field. Other unsaved changes on the row
  (status / mapping-type / confidence) are preserved. Clean semantics.
- **Q9 Manual-add textarea behaviour**: same auto-grow CSS class
  (`field-sizing: content` + min/max-height + `rows={3}`) as the per-
  row textarea. Consistency, smallest implementation.
- **Q10 Test cap (5 tests)**:
  1. `LinkifiedText` no-URL input → zero `<a>` tags emitted.
  2. `LinkifiedText` with two URLs in one string → exactly two
     `<a target="_blank" rel="noopener noreferrer">` (multi-match
     regex-loop assertion is load-bearing).
  3. Truncation: notes longer than 4 lines → "Show more" appears;
     clicking expands to full text.
  4. Per-row Edit: pencil click → textarea; type + Save → back to
     read mode with the new value rendered.
  5. Manual-add row's notes field is a `<textarea>` (not `<input>`),
     accepts multi-line input.
- **Q11 Commit boundary**: single commit, frontend-only. No AMS or
  gateway changes. Investigation confirmed mapping notes are
  displayed in exactly one surface.

**Net effect on sizing:** Confirmed **Small**. ~100-200 LOC frontend-
only across:

- New `frontend/src/components/common/LinkifiedText.tsx` (~30-50 LOC).
- Modifications to `frontend/src/components/TopBar/SelectiveCopyMappingReviewStep.tsx`
  (read/edit toggle, draft snapshot/restore, editing state map).
- CSS additions to the relevant `.module.css` file (~30 LOC).
- 5 Vitest tests.

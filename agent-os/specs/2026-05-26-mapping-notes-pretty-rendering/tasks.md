# Task Breakdown: Mapping-Notes Pretty Rendering

## Overview
Total Tasks: 4 task groups, 20 sub-tasks
Commit Boundary: One commit covering all four task groups. Frontend-only, ~100-200 LOC.

## Critical Pitfalls (read before starting any task group)

1. **Pencil-only edit trigger** — NOT click-anywhere on the read text. The pencil icon is the SOLE entry point into edit mode. Preserves text-selection in read mode so users can copy URLs / quote text into other tools. Do NOT add an onClick to the `<LinkifiedText>` wrapper or the read-mode `<div>`.
2. **NO click-outside dismissal of edit mode.** Risky UX — the user might click another cell merely to scroll or inspect. Edit mode dismisses ONLY via the explicit Cancel button or ESC keypress while the textarea is focused. Do NOT register a `document.mousedown` listener for this cell.
3. **Cancel snapshot scope is Notes-only.** Snapshot is taken at edit-entry and captures `draft.notes` ONLY. On Cancel, restore ONLY that single field via `handleDraftChange(m.id, { notes: snapshot })`. Any unsaved changes on the same row to status / mapping-type / confidence MUST be preserved. Do NOT call `rowDraftFromMapping(m)` or reseed the whole draft.
4. **Trailing-punctuation strip on URL matches.** Strip `.,;:!?` from the END of each captured URL before building the `href`. The regex pattern itself stays simple — `/(https?:\/\/[^\s)]+)/g`. The trim is a post-match string operation, not a regex backreference. Encoded URLs ending in `%2E` etc. are untouched (the trim strips literal punctuation only).
5. **Multi-URL regex-loop is load-bearing.** One `<a>` element per URL match in a single string. Test 2 in Task Group 1 asserts this with a two-URL input — that assertion catches regressions where the implementation only handles the first match. Use `String.prototype.matchAll` or a `while ((match = regex.exec(text)) !== null)` loop with `regex.lastIndex` tracking.
6. **Auto-grow via native CSS `field-sizing: content` + min/max-height fallback.** NO JS auto-grow shim, NO `useLayoutEffect` height adjustment. The CSS-only fallback (`min-height`, `max-height`, `resize: vertical`, `rows={3}`) is sufficient for browsers without `field-sizing` support.
7. **Refetch wipes the editing map too.** When `refetchMappings()` clears the drafts (existing behaviour on Save success, filter change, mount), also clear the `editing` map in the same step. Consistency with pre-existing draft-wipe semantics. Do NOT try to "fix" this footgun — preserving an open edit mode across a refetch would require draft-survival logic that is explicitly out of scope.

## Task List

### Frontend Utility Component

#### Task Group 1: New `LinkifiedText.tsx` utility component
**Dependencies:** None

- [x] 1.0 Build the linkified-text + truncation primitive
  - [x] 1.1 Write 3 focused Vitest tests
    - File: `frontend/src/components/common/__tests__/LinkifiedText.test.tsx`
    - Test 1 (no-URL input): render `<LinkifiedText text="Plain prose without any links." />`. Assert zero `<a>` elements in the rendered output.
    - Test 2 (multi-URL multi-match): render `<LinkifiedText text="See https://example.com/one and https://example.com/two for details." />`. Assert exactly two `<a>` elements; each carries `target="_blank"` AND `rel="noopener noreferrer"`; their `href` attributes are `https://example.com/one` and `https://example.com/two` respectively (no trailing characters). This assertion is load-bearing — it catches single-match regressions in the regex loop.
    - Test 3 (truncation + Show more): render `<LinkifiedText text={longMultiLineString} truncateLines={4} />` where `longMultiLineString` has 8+ newline-separated lines. Assert the rendered container has the truncated CSS class. Find and click the "Show more" button. Assert the container is no longer truncated AND the button copy is now "Show less". Click again. Assert truncation returns.
    - Trailing-punctuation strip behaviour is implicitly covered if Test 2's input includes a trailing period in the prose (e.g. `"see https://example.com/path."` — the `href` should be `https://example.com/path` with no period). Add this assertion inline within Test 2 if a separate concern matters; otherwise consider it covered as part of the multi-URL test.
  - [x] 1.2 Create the component file
    - File: `frontend/src/components/common/LinkifiedText.tsx` (~30-50 LOC).
    - Props: `{ text: string; className?: string; truncateLines?: number }`.
    - Split `text` on URL boundaries using `/(https?:\/\/[^\s)]+)/g`. Use `matchAll` or an `exec`-loop to yield one anchor per match (multi-URL support is load-bearing per Pitfall 5).
    - For each captured URL string, strip trailing punctuation `.,;:!?` via a small helper (e.g. `url.replace(/[.,;:!?]+$/, '')`) before building the `href`. The displayed link text uses the trimmed URL too (no mismatch between text and href).
    - Wrap each trimmed URL in `<a href={trimmedUrl} target="_blank" rel="noopener noreferrer" className={styles.notesLink}>{trimmedUrl}</a>`. Mirror the external-anchor convention from `WorkItemDetailsPanel.tsx` lines 416-427.
    - Surrounding text is rendered as plain React children (string fragments interleaved with anchor elements). Do NOT use `dangerouslySetInnerHTML` — XSS-safe by construction.
    - When `truncateLines` is set: render an `expanded` state via `useState(false)`. The outer wrapper carries `styles.notesReadMode` always, plus `styles.notesReadModeTruncated` when `!expanded`. Below the text, render a "Show more" / "Show less" button (using `styles.notesShowMoreButton`) that toggles `expanded`. Mirror `WorkItemTree.tsx` lines 202-222.
    - When `truncateLines` is not set: render only the text content; no Show-more button.
  - [x] 1.3 Add the component CSS (or inline into `SelectiveCopyMappingReviewStep.module.css`)
    - Decision: place CSS in a sibling `frontend/src/components/common/LinkifiedText.module.css` for the four classes that are presentationally local to the utility (`.notesReadMode`, `.notesReadModeTruncated`, `.notesShowMoreButton`, `.notesLink`). The mapping-review-specific classes (textarea, pencil button, edit wrapper) go in the mapping-review module per Task Group 2.
    - `.notesReadMode` — `white-space: pre-wrap; word-break: break-word; min-height: 1em;`. CRITICAL: NO `cursor: pointer` — the pencil is the trigger (Pitfall 1).
    - `.notesReadModeTruncated` — `display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;`. Mirror `WorkItemTree.module.css` `.descriptionPreview` (which uses `-webkit-line-clamp: 2`; adjust to 4 here).
    - `.notesShowMoreButton` — small inline-link button styling (transparent background, link colour, no border, padding 0, cursor pointer).
    - `.notesLink` — link colour matching existing link styles in the codebase (sample from `WorkItemDetailsPanel`'s external-anchor styling).
  - [x] 1.4 Ensure LinkifiedText tests pass
    - Run ONLY the 3 tests written in 1.1: `npm test -- LinkifiedText.test.tsx` (or project equivalent).
    - Do NOT run the entire frontend test suite at this stage.

**Acceptance Criteria:**
- The 3 LinkifiedText tests in 1.1 pass.
- `LinkifiedText.tsx` exists at `frontend/src/components/common/LinkifiedText.tsx` and exports a default React component matching the prop signature.
- Multi-URL inputs emit one anchor per match (verified by Test 2).
- Trailing punctuation `.,;:!?` is stripped from anchor `href` values.
- No use of `dangerouslySetInnerHTML`.
- Truncation uses `-webkit-line-clamp` CSS only; no JS height-measurement.

### Frontend Mapping Review Read/Edit Toggle

#### Task Group 2: Read/edit toggle in `SelectiveCopyMappingReviewStep.tsx`
**Dependencies:** Task Group 1

- [x] 2.0 Replace the per-row Notes `<input>` with a read/edit-toggle cell
  - [x] 2.1 Write 1 focused integration test
    - File: `frontend/src/components/TopBar/__tests__/SelectiveCopyMappingReviewStep.notesEdit.test.tsx` (or extend an existing sibling test file if the team's convention is consolidation).
    - Test 1 (pencil → textarea → Save → read mode): render the Mapping Review step with a mock mapping whose `notes` field is `"existing notes"`. Confirm the cell renders in read mode (a `<LinkifiedText>` showing "existing notes", a pencil icon button visible). Click the pencil. Assert a `<textarea>` is now in the DOM with the value `"existing notes"` and the pencil is gone. Type `"new\nmulti-line\nnotes"` into the textarea (replacing the value). Click the per-row Save button. Assert the Save handler was called with the new value; the cell flips back to read mode and the rendered `<LinkifiedText>` content reflects the new multi-line value.
    - Skip exhaustive Cancel / ESC dismissal coverage — those paths are covered by manual smoke in Task Group 4. The 5-test cap (per spec) is fully consumed across the three groups.
  - [x] 2.2 Add the `editing` state map
    - Inside `SelectiveCopyMappingReviewStep.tsx`, add `const [editing, setEditing] = useState<Record<string, { notesSnapshot: string } | undefined>>({})`.
    - Position the state declaration alongside the existing `drafts` state declaration for clarity.
  - [x] 2.3 Render the read/edit toggle in the per-row Notes cell
    - Locate the existing per-row Notes `<input>` (lines ~624-633 per the spec).
    - When `editing[m.id]` is falsy: render `<div className={styles.notesReadModeCell}>` containing `<LinkifiedText text={draft.notes ?? ''} className={styles.notesReadMode} truncateLines={4} />` PLUS a small `<button className={styles.notesPencilButton}><Pencil size={14} /></button>` from `lucide-react` (already a dep). The pencil button's `onClick` calls a new handler `handleEnterEditMode(m.id, draft.notes ?? '')` which sets `editing[m.id] = { notesSnapshot: draft.notes ?? '' }` and does NOT call `handleDraftChange`.
    - CRITICAL (Pitfall 1): the pencil is the ONLY edit trigger. Do NOT add an `onClick` to the read-mode wrapper or the `<LinkifiedText>` — read mode must remain selectable.
    - When `editing[m.id]` is truthy: render `<div className={styles.notesEditCellWrapper}>` containing a `<textarea>` (replacing the current `<input>`) plus a Cancel button (next to the existing per-row Save button in the row's Actions cell — see 2.4).
    - The textarea: `value={draft.notes ?? ''}`, `onChange` calls `handleDraftChange(m.id, { notes: e.target.value })` (existing plumbing, unchanged). Apply `className={styles.notesEditTextarea}` and `rows={3}`.
    - The textarea registers an `onKeyDown` that closes edit mode on ESC: `if (e.key === 'Escape') { handleCancelEdit(m.id); }`. Mirror the ESC-handler pattern from `CapturedDecisionChip.tsx`.
    - In-flight save: when the row is mid-save (existing `savingIds` / `inflightId` state — name per the existing convention), disable the pencil button AND the Cancel button. The textarea itself may stay enabled (existing in-flight UX for the form fields is preserved).
  - [x] 2.4 Add the Cancel button + the `handleCancelEdit` handler
    - Position: alongside the existing per-row Save button in the row's Actions cell. Visible ONLY while `editing[m.id]` is truthy.
    - `handleCancelEdit(mappingId: string)`: read `const snap = editing[mappingId]?.notesSnapshot ?? ''`; call `handleDraftChange(mappingId, { notes: snap })` to restore ONLY the Notes field (Pitfall 3 — do NOT reseed the whole draft); clear the editing entry via `setEditing(prev => { const next = { ...prev }; delete next[mappingId]; return next; })`.
    - CRITICAL (Pitfall 2): do NOT register a click-outside listener for the row. The Cancel button + ESC keypress are the only dismissal paths.
  - [x] 2.5 Wire Save success to exit edit mode
    - Locate the existing `handleSaveRow` function (or equivalent name) in `SelectiveCopyMappingReviewStep.tsx`.
    - On successful Save (inside the existing success branch), clear the editing entry: `setEditing(prev => { const next = { ...prev }; delete next[mappingId]; return next; })`. The cell naturally flips back to read mode on the next render because `editing[m.id]` is now falsy.
    - Note: the existing `refetchMappings()` call on Save success already reseeds drafts; that flow is unchanged.
  - [x] 2.6 Wire `refetchMappings()` to wipe the editing map alongside drafts
    - Locate the existing `refetchMappings()` function where the drafts are rebuilt from scratch.
    - In the same step that reseeds drafts, also reset the editing map: `setEditing({})`. Pitfall 7 — semantics stay consistent with the pre-existing draft-wipe-on-refetch.
  - [x] 2.7 Add the mapping-review-specific CSS classes
    - Append to `frontend/src/components/TopBar/SelectiveCopyWizardModal.module.css` (the module CSS used by `SelectiveCopyMappingReviewStep.tsx` — confirm the exact filename when starting; the spec leaves it as "the matching `.module.css` file").
    - `.notesReadModeCell` — flex row aligning the LinkifiedText content with the pencil button (gap ~4-6px, align-items flex-start so the pencil sits at the top of multi-line read content).
    - `.notesEditCellWrapper` — flex column wrapping the textarea (the Cancel button itself lives in the existing Actions cell, not inside this wrapper — confirm during implementation; if the Cancel needs to sit visually adjacent to the textarea, adjust this layout).
    - `.notesPencilButton` — small icon button styling (transparent background, no border, padding ~2px, cursor pointer, colour matching existing icon-button styles in the file).
    - `.notesEditTextarea` — `width: 100%; min-height: 3em; max-height: 12em; resize: vertical; field-sizing: content; box-sizing: border-box;`. The `field-sizing: content` is the primary auto-grow mechanism; the min/max-height + resize-vertical + `rows={3}` on the element together form the CSS-only fallback (Pitfall 6).
  - [x] 2.8 Ensure the read/edit toggle test passes
    - Run ONLY the test written in 2.1.
    - Do NOT run the entire frontend test suite at this stage.

**Acceptance Criteria:**
- The 1 test in 2.1 passes.
- Pencil click flips the cell to a `<textarea>` (Pitfall 1 enforced: read-mode wrapper has no onClick).
- Cancel button + ESC dismiss edit mode without saving; click-outside does NOT dismiss (Pitfall 2).
- Cancel restores ONLY the Notes field from the snapshot taken at edit-entry; other unsaved row fields are preserved (Pitfall 3).
- Save success flips the cell back to read mode via the cleared `editing` map.
- `refetchMappings()` wipes both `drafts` AND `editing` together (Pitfall 7).
- In-flight save disables the pencil and Cancel controls.

### Frontend Manual-Add Row

#### Task Group 3: Manual-add textarea + CSS reuse
**Dependencies:** Task Group 2 (reuses `.notesEditTextarea` CSS class added in 2.7)

- [x] 3.0 Replace the manual-add row's notes `<input>` with a `<textarea>`
  - [x] 3.1 Write 1 focused integration test
    - File: same test file as 2.1, or a sibling — team convention dependent. The test must render the Mapping Review step in a state where the manual-add row is visible (existing convention for triggering the manual-add UI applies).
    - Test 1 (manual-add textarea + multi-line input): assert the manual-add row's notes field is a `<textarea>` (not an `<input>`). Type a multi-line string (e.g. `"line one\nline two\nline three"`) into the textarea. Assert the textarea's `value` reflects the full multi-line content including the `\n` characters (or the equivalent based on how the testing library normalises textarea values).
    - Skip exhaustive coverage of the manual-add commit flow — that flow is unchanged by this spec.
  - [x] 3.2 Replace the `<input>` element in the manual-add row
    - Locate the manual-add row's notes `<input>` (line ~777-784 per the spec).
    - Replace with a `<textarea>` carrying:
      - `className={styles.notesEditTextarea}` (the same class added in 2.7 — Pitfall 6 auto-grow applies uniformly).
      - `rows={3}`.
      - `value` and `onChange` plumbing matching the existing manual-add state shape (whatever local state holds the manual-add row's draft values — preserve the existing pattern).
      - `placeholder` matching the existing input's placeholder (preserve the existing copy).
    - NO pencil icon button. NO Cancel button. The manual-add row is permanently in edit mode (the row is mid-creation).
    - NO read/edit toggle state — the manual-add row never participates in the `editing` map.
  - [x] 3.3 Ensure the manual-add test passes
    - Run ONLY the test written in 3.1.
    - Do NOT run the entire frontend test suite at this stage.

**Acceptance Criteria:**
- The 1 test in 3.1 passes.
- The manual-add row's notes field is a `<textarea>` (not an `<input>`) reusing the `.notesEditTextarea` class.
- Multi-line input is accepted by the textarea.
- No pencil, no Cancel, no read/edit toggle on the manual-add row.
- The manual-add commit flow is unchanged.

### Verification

#### Task Group 4: End-to-end manual smoke + regression sweep
**Dependencies:** Task Groups 1-3

- [ ] 4.0 Manual smoke on a real Selective Copy Mapping Review session + final regression check
  - [ ] 4.1 Run the 5 frontend tests written in Task Groups 1-3
    - Command: `npm test -- LinkifiedText.test.tsx SelectiveCopyMappingReviewStep.notesEdit.test.tsx` (or project equivalent based on the actual test filenames chosen).
    - Expected: all 5 pass.
  - [ ] 4.2 Run the wider frontend test suite for regression check
    - Command: `npm test` in `frontend/` (or project equivalent).
    - All previously-passing tests continue to pass. Pre-existing unrelated failures listed in CLAUDE.md may stay red — do NOT touch them.
  - [ ] 4.3 Manual smoke: read-mode rendering of existing notes
    - Open the Selective Copy wizard, advance to the Mapping Review step on a project with existing mappings that have multi-line notes containing at least one `http(s)://` URL (seed test data if necessary).
    - Confirm the Notes cells render in read mode with `white-space: pre-wrap` (newlines visible).
    - Confirm URLs render as clickable `<a>` elements with `target="_blank"` (verified via devtools or by clicking). Trailing punctuation in prose (`.,;:!?`) is NOT part of the `href`.
    - Confirm text-selection inside the read content works for copy-paste (the pencil-only trigger from Pitfall 1).
  - [ ] 4.4 Manual smoke: pencil → textarea auto-grow
    - Click the pencil icon on a row. Confirm the cell flips to a `<textarea>` containing the row's current notes.
    - Type additional multi-line content. Confirm the textarea auto-grows with content (assumes `field-sizing: content` support in the browser; on Firefox older versions, confirm the CSS fallback `min-height: 3em` + manual resize-vertical drag works).
    - Confirm the textarea stops growing at `max-height: 12em` and switches to internal scrolling beyond that.
  - [ ] 4.5 Manual smoke: Save flow from edit mode
    - With multi-line content in the textarea, click the per-row Save button.
    - Confirm the cell flips back to read mode and the rendered `<LinkifiedText>` shows the new multi-line content with whitespace preserved.
    - Confirm the row's other fields (status, mapping-type, confidence) reflect their committed values.
  - [ ] 4.6 Manual smoke: Cancel + ESC dismissal
    - On a row, click the pencil to enter edit mode. Modify the notes textarea content. Click Cancel. Confirm the cell flips back to read mode showing the ORIGINAL pre-edit notes (the snapshot restoration).
    - Repeat: enter edit mode, modify the notes, press ESC while the textarea is focused. Confirm the same revert behaviour.
    - CRITICAL test (Pitfall 3): on a row, FIRST change the row's status / mapping-type / confidence (without saving). THEN enter edit mode on the Notes cell, modify the notes, click Cancel. Confirm:
      - The Notes field reverts to the pre-edit snapshot value.
      - The status / mapping-type / confidence changes are STILL THERE (not wiped).
  - [ ] 4.7 Manual smoke: click-outside does NOT dismiss edit mode
    - Enter edit mode on a row's Notes cell. Click on a different cell in the same row (or on whitespace outside the cell). Confirm edit mode REMAINS OPEN (Pitfall 2). The Notes textarea must still be visible.
  - [ ] 4.8 Manual smoke: truncation + Show more
    - Identify or seed a row with notes longer than 4 lines. Confirm the read-mode rendering truncates at 4 lines with a "Show more" button visible.
    - Click "Show more". Confirm the cell expands to show the full text; the button copy is now "Show less".
    - Click "Show less". Confirm the cell re-truncates.
  - [ ] 4.9 Manual smoke: manual-add row
    - In the Mapping Review step, trigger the manual-add row (existing UX — typically a + button or empty row at the bottom of the table).
    - Confirm the notes field is a `<textarea>` (not an `<input>`) from the start.
    - Type multi-line content into it. Confirm newlines are accepted.
    - Confirm there is NO pencil icon and NO Cancel button on the manual-add row.
  - [ ] 4.10 Manual smoke: refetch wipes editing map
    - Enter edit mode on a row. Without clicking Save on that row, click Save on a DIFFERENT row (which triggers `refetchMappings()` on success).
    - Confirm the originally-editing row's cell has flipped back to read mode (Pitfall 7) — the editing map was wiped alongside drafts. Any unsaved Notes content on that row is lost — this matches the pre-existing draft-wipe-on-refetch footgun and is intentional.
  - [ ] 4.11 Manual smoke: in-flight save disables pencil + Cancel
    - On a row, enter edit mode and modify the notes. Click Save. While the save request is in-flight (throttle the network in devtools to make this observable), confirm the pencil button and the Cancel button are disabled.
  - [ ] 4.12 Final regression sweep
    - Confirm the Mapping Review table still has its existing 9-column structure (no new column added).
    - Confirm filters and search still work as before.
    - Confirm mapping-type / status / confidence editing still works on rows in both read and edit Notes modes.
    - Confirm per-row Save and Delete actions still work.
    - Confirm the manual-add commit flow still works (text typed into the manual-add textarea is committed when the existing commit affordance is used).
  - [ ] 4.13 Final grep sweep
    - `frontend/src/` for any introduced `dangerouslySetInnerHTML` within the changed files — confirm none added.
    - `frontend/src/` for any introduced `document.mousedown` / click-outside listener in `SelectiveCopyMappingReviewStep.tsx` — confirm none added (Pitfall 2).
    - `frontend/src/` for any introduced `useLayoutEffect` or JS-based height shim for the textarea — confirm none added (Pitfall 6).
    - Confirm the only edit-mode entry trigger is the pencil button (Pitfall 1) — grep the read-mode wrapper render path for `onClick`; should be absent.

**Acceptance Criteria:**
- The 5 frontend tests pass.
- The wider frontend test suite is green (modulo pre-existing unrelated failures in CLAUDE.md).
- All manual smoke sub-tasks (4.3 through 4.11) verify successfully on a real Selective Copy Mapping Review session.
- All pitfalls are confirmed non-violated by the grep sweep in 4.13.
- Single commit covers all four task groups per the spec's Commit Boundary.

## Execution Order

Recommended implementation sequence:
1. Task Group 1 — `LinkifiedText.tsx` utility component (foundation; consumed by Task Group 2).
2. Task Group 2 — Read/edit toggle in `SelectiveCopyMappingReviewStep.tsx` (the bulk of the change; introduces the `editing` state map, pencil trigger, Cancel button, ESC handler, CSS additions).
3. Task Group 3 — Manual-add textarea (reuses the `.notesEditTextarea` CSS class added in Group 2; tiny change).
4. Task Group 4 — Manual smoke + regression sweep (final gate before commit).

All four task groups land in a single commit per the spec's Commit Boundary.

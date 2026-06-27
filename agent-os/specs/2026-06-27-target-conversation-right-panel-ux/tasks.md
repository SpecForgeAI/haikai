# Task Breakdown: Target-state Architect-Conversation Right-Panel UX (Spec A)

## Overview
Total Tasks: 3 task groups

Frontend-only UX change to the Target State -> Architect Conversation 3-pane view:
(1) reorder/declutter the right column panels with Title-Case headings,
(2) make the right column resizable + wider with persistence + a11y, and
(3) fix the scroll model so only the transcript scrolls. No backend / gateway /
AMS changes.

**Verification note (applies to every group):** the whole-repo `tsc` / lint
baseline is pre-existingly RED on `main`. Do NOT verify by relying on a clean
whole-repo build. Verify IN ISOLATION: typecheck/build only the touched frontend
files (or scope `tsc`/`vite build` to them) and run only the relevant component
tests for the files changed in that group.

## Task List

---

### UI Edits Layer

#### Task Group 1: Panel Reorder, Subheading Removal, Title-Case Headings
**Dependencies:** None

This group is pure JSX/text edits across five files. No logic, props, or
callbacks change.

- [x] 1.0 Complete the right-column reorder + declutter + heading edits
  - [x] 1.1 Write 2-4 focused tests for the reorder + heading edits
    - Test the right column renders children in order: `DecisionsFileUploadPanel`
      -> `ManifestUploadPanel` -> `SummaryPanel` -> `VulnerabilityReductionPanel`
      -> `CloseConversationFlow`
    - Test the Title-Case headings render ("Target Dependency Manifests",
      "Decisions Captured", Title-Cased estimated vulnerability reduction heading)
    - Test the removed `subheading` helper `<p>` is no longer in the DOM for
      `ManifestUploadPanel` and `DecisionsFileUploadPanel`
    - Keep to 2-4 tests; do not exhaustively snapshot the panels
  - [x] 1.2 Reorder the right-column children in `ArchitectConversationTab.tsx`
    - File: `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx` (~1398-1493)
    - New order: `DecisionsFileUploadPanel` -> `ManifestUploadPanel` ->
      `SummaryPanel` -> `VulnerabilityReductionPanel` -> `CloseConversationFlow`
    - JSX reorder ONLY: preserve every existing prop, callback, and comment on
      each panel exactly as-is
  - [x] 1.3 Remove the redundant `subheading` helper text
    - `ManifestUploadPanel.tsx` (~296-301): fully remove the
      `<p className={styles.subheading}>...</p>` block
    - `DecisionsFileUploadPanel.tsx` (~113-117): fully remove the same block
    - Full DOM removal: NO screen-reader-only / `aria-describedby` retention
    - Leave the `<section>` `aria-label` and the file-input label intact
  - [x] 1.4 Title-Case the box headings only
    - `ManifestUploadPanel.tsx` `<h3>`: "Target dependency manifests" ->
      "Target Dependency Manifests"
    - `SummaryPanel` `<h3>`: "Decisions captured" -> "Decisions Captured"
    - `VulnerabilityReductionPanel`: Title-Case the call-site string at
      `ArchitectConversationTab.tsx:1415` (`heading="Estimated vulnerability reduction"`)
      AND the component default heading at `VulnerabilityReductionPanel.tsx:141`
    - Do NOT touch "Manually Answer Target State" (already correct) or any
      internal section labels / sub-headings
  - [x] 1.5 Verify Task Group 1 IN ISOLATION
    - Run ONLY the 2-4 tests written in 1.1
    - Typecheck ONLY the touched files (`ArchitectConversationTab.tsx`,
      `ManifestUploadPanel.tsx`, `DecisionsFileUploadPanel.tsx`, `SummaryPanel`,
      `VulnerabilityReductionPanel.tsx`); do NOT rely on a clean whole-repo build
    - Confirm no leftover references to the removed `styles.subheading` class

**Acceptance Criteria:**
- Right column renders in the new order; CloseConversationFlow stays last
- The three target headings are Title-Cased; no other headings changed
- The `subheading` `<p>` is gone from both upload panels (no SR-only retention)
- All existing props/callbacks/comments preserved (reorder/text only)
- The 2-4 tests written in 1.1 pass

**Files Modified:**
- `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx`
- `frontend/src/components/targetState/architectConversation/ManifestUploadPanel.tsx`
- `frontend/src/components/targetState/architectConversation/DecisionsFileUploadPanel.tsx`
- `SummaryPanel` component file (target-state architect conversation)
- `frontend/src/components/targetState/architectConversation/VulnerabilityReductionPanel.tsx`

---

### Resizable Layout Layer

#### Task Group 2: Resizable + Wider Right Column
**Dependencies:** Task Group 1

Build a focused, right-anchored splitter inside `.layout`. The chat/left pane
flexes; the right column holds a fixed, drag-adjustable px width persisted in
localStorage. Do NOT generalise `shared/ResizableSplitPane`.

- [x] 2.0 Complete the resizable right column
  - [x] 2.1 Write 2-6 focused tests for the splitter + persistence
    - Test default width 440px applied when no localStorage value present
    - Test width clamps to min 320px and max `min(620px, 60% of layout width)`
    - Test arrow-key / shift-arrow keyboard steps adjust `aria-valuenow` and clamp
    - Test the width read/write helpers use the machine-global key
      `architect-conversation.rightColumnWidth` and are try/catch-guarded
    - Keep to 2-6 tests; mock `localStorage` and `getBoundingClientRect` as needed
  - [x] 2.2 Add the width read/write helpers
    - Mirror the pattern in `ConversationMainPane.tsx:173-193`
      (`readAutoSelectVersionPref` / `writeAutoSelectVersionPref`): try/catch-guarded
      `window.localStorage`, default applied when absent/blocked
    - ONE machine-global key: `architect-conversation.rightColumnWidth` (not per-project)
    - Default 440; clamp helper: min 320, max `min(620, 60% of layout width)`
    - Do NOT touch the overlay's per-project key `rhs-panel-width-2:{projectId}`
  - [x] 2.3 Replace the fixed `320px` track with the persisted, adjustable width
    - `ArchitectConversation.module.css:16-22`: `.layout` currently
      `grid-template-columns: minmax(0, 1fr) 320px` -> drive the right track from
      the persisted px width (chat pane stays `minmax(0, 1fr)`)
    - Desktop-only: two columns side-by-side at all widths (rely on the clamp);
      NO responsive stacking / breakpoint
  - [x] 2.4 Build the right-anchored splitter (drag maths)
    - Reuse the pointer/drag implementation from `RightHandPanelShell`
      (`handleResizeStart` + the `mousemove`/`mouseup` effect, ~120-146)
    - Compute width against the layout container's RIGHT edge via
      `getBoundingClientRect` (right column is the fixed pane, inverse of the
      overlay's left-edge drag); clamp on each move; persist on drag end
  - [x] 2.5 Add keyboard a11y + window-resize re-clamp
    - Reuse the a11y logic from `shared/ResizableSplitPane`: `role="separator"`,
      `tabIndex={0}`, `aria-valuenow/min/max`, arrow + shift-arrow steps
      (~161-183), and the window-resize re-clamp effect (~189-204)
    - Take only this logic; do NOT generalise `ResizableSplitPane`
  - [x] 2.6 Style the splitter handle
    - Reuse the `UnifiedChatPanel.module.css .resizeHandle` styling (~257-273,
      incl. `:hover` / `:active`) to match the overlay's existing handle look
  - [x] 2.7 Verify Task Group 2 IN ISOLATION
    - Run ONLY the 2-6 tests written in 2.1
    - Typecheck ONLY the touched files; do NOT rely on a clean whole-repo build
    - Manually confirm drag + keyboard resize, clamp at both bounds, and that the
      width persists across reload via the global key

**Acceptance Criteria:**
- Right column defaults to 440px, clamps to [320, `min(620, 60% layout)`]
- Drag and arrow/shift-arrow keyboard both resize the right column; chat pane
  never collapses below ~40%
- Width persists in `architect-conversation.rightColumnWidth` (machine-global);
  overlay per-project key untouched
- Splitter exposes `role="separator"` + `aria-valuenow/min/max`; re-clamps on
  window resize
- `ResizableSplitPane` is NOT generalised
- The 2-6 tests written in 2.1 pass

**Files Modified:**
- `frontend/src/components/targetState/architectConversation/ArchitectConversation.module.css`
- The right-column layout component in `architectConversation/` (splitter + helpers)

---

### Scroll Model Layer

#### Task Group 3: Transcript-Only Scroll Fix
**Dependencies:** Task Groups 1-2

Bound the height chain so only `.transcript` scrolls; pin the input bar / latest
pending question; right column scrolls independently; auto-scroll to newest turn.

- [x] 3.0 Complete the scroll model fix
  - [x] 3.1 Write 2-4 focused tests for the scroll behaviour
    - Test the shell content wrapper uses `overflow: hidden` (not `auto`)
    - Test the transcript scrolls to bottom (newest turn) when a new turn arrives
    - Keep to 2-4 tests; mock `scrollIntoView` / `scrollTop` as needed
  - [x] 3.2 Change the shell content wrapper overflow
    - `RightHandPanelShell.tsx:240`: content wrapper
      `<div style={{ flex:1, minHeight:0, overflow:'auto' }}>{children}</div>`
      -> change `overflow:'auto'` to `overflow:'hidden'`
    - `RightHandPanelShell` is used only by the architect conversation today, so
      this is scoped to this view; per-project width key stays untouched
  - [x] 3.3 Bound the inner height chain so only `.transcript` scrolls
    - Ensure the existing chain resolves: `.container{height:100%;min-height:0}`,
      `.layout{flex:1;min-height:0}`, `.transcript{flex:1;overflow-y:auto}`
    - Input bar / latest pending question stays pinned at the bottom of the main
      pane; the right column scrolls independently (panels already use
      `overflow-y:auto` where needed)
  - [x] 3.4 Add auto-scroll-to-newest-turn
    - Scroll the transcript to the bottom when a new turn arrives; ON by default
  - [x] 3.5 Verify Task Group 3 IN ISOLATION
    - Run ONLY the 2-4 tests written in 3.1
    - Typecheck ONLY the touched files (`RightHandPanelShell.tsx`, the transcript
      component, `ArchitectConversation.module.css`); do NOT rely on a clean
      whole-repo build
    - Manually confirm only the transcript scrolls, the input bar stays pinned,
      the right column scrolls independently, and new turns auto-scroll into view

**Acceptance Criteria:**
- `RightHandPanelShell.tsx:240` wrapper is `overflow: hidden` and the height
  chain resolves so ONLY `.transcript` scrolls
- Input bar / latest pending question stays pinned at the bottom
- Right column scrolls independently of the transcript
- New turns auto-scroll the transcript to the newest turn (on by default)
- The 2-4 tests written in 3.1 pass

**Files Modified:**
- `frontend/src/components/common/RightHandPanelShell.tsx`
- `frontend/src/components/targetState/architectConversation/ArchitectConversation.module.css`
- The transcript component in `architectConversation/` (auto-scroll)

---

## Execution Order

Recommended implementation sequence:
1. Task Group 1: Panel Reorder, Subheading Removal, Title-Case Headings
2. Task Group 2: Resizable + Wider Right Column
3. Task Group 3: Transcript-Only Scroll Fix

Groups 1-3 touch overlapping files (`ArchitectConversationTab.tsx`,
`ArchitectConversation.module.css`); run them sequentially to avoid clobbering.
All verification is done IN ISOLATION (touched-file typecheck + targeted
component tests), never against the pre-existingly RED whole-repo build.

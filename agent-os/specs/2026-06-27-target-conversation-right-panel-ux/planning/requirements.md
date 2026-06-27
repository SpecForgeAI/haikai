# Spec Requirements: Target-state architect-conversation right-panel UX (Spec A)

## Initial Description
Frontend-only UX improvements to the Target State -> Architect Conversation view
(the 3-pane workspace). All changes live in
`frontend/src/components/targetState/architectConversation/` and related CSS
modules. No backend/gateway changes. Four problem areas:

1. Reorder right-column panels (bulk-input boxes above "Decisions Captured"),
   remove the small `<p className=subheading>` helper text under each upload box
   heading, and Title-Case the box `<h3>` titles only (not internal section
   labels).
2. Add a draggable splitter so the right column is resizable + wider by default
   (~420-460px), sticky in localStorage, with a min/max clamp so chat never
   collapses.
3. Make ONLY the transcript scroll (input bar / latest pending question pinned;
   right column scrolls independently) by bounding the height chain; auto-scroll
   to newest turn on by default.

(Points 4 & 5 from the broader discussion -- version-unknown pending questions,
live vuln-reduction recompute + OSV bridge -- are SEPARATE Specs B and C and are
out of scope here.)

See `raw-idea.md` for the full original text.

## Requirements Discussion

### First Round Questions

**Q1 (Splitter reuse):** For the inner right column we want the chat pane to FLEX
and the right column to hold a FIXED adjustable width -- the inverse of
`shared/ResizableSplitPane` (which fixes the LEFT pane). Build a focused
right-anchored splitter inside `.layout` reusing the proven drag maths from
`RightHandPanelShell` plus the keyboard-arrow a11y + window-resize re-clamp from
`ResizableSplitPane`, rather than generalising `ResizableSplitPane` into a
right-fixed mode?
**Answer (confirmed):** Yes. Build a focused right-anchored splitter inside
`.layout`, reusing the drag maths from `RightHandPanelShell` and the
keyboard-arrow a11y + resize re-clamp from `ResizableSplitPane`. Do NOT
generalise `ResizableSplitPane`.

**Q2 (Where the scroll fix lives):** The real cause of "the whole window scrolls"
is the shell content wrapper's `overflow:auto` (`RightHandPanelShell.tsx:240`),
not the page shell. Change that wrapper `overflow:auto` -> `overflow:hidden` (it
is used only by this conversation) and bound the inner height so only the
transcript scrolls. OK to touch the shared `RightHandPanelShell`?
**Answer (confirmed):** Yes. Fix the scroll at the shared `RightHandPanelShell`:
change its content wrapper `overflow:auto` -> `overflow:hidden` and bound the
inner height so only the transcript scrolls.

**Q3 (Handle styling):** Should the new inner splitter reuse the existing
`UnifiedChatPanel.module.css .resizeHandle` look (matching the overlay's own
outer handle) rather than the `ResizableSplitPane.module.css .dragHandle` style?
**Answer (confirmed):** Yes. Reuse the `UnifiedChatPanel.module.css .resizeHandle`
handle styling.

**Q4 (Exact width clamps):** Recommended default 440px, min 320px,
max = `min(620px, 60% of the current layout width)` so the chat pane can never
collapse below ~40%. Confirm these numbers?
**Answer (confirmed):** Yes. Default 440px, min 320px,
max = `min(620px, 60% of layout width)`.

**Q5 (Width persistence key):** One machine-global localStorage key
(`architect-conversation.rightColumnWidth`), not per-project, mirroring the
machine-level `auto-select-recommended-version` pref pattern. The overlay's own
width stays per-project as today. Confirm global?
**Answer (confirmed):** Yes. One machine-global key
`architect-conversation.rightColumnWidth`. The overlay's own width stays
per-project.

**Q6 (Lower-panel order + Vuln/Close positions):** Proposed order
DecisionsFileUploadPanel -> ManifestUploadPanel -> SummaryPanel ->
VulnerabilityReductionPanel -> CloseConversationFlow. This moves
VulnerabilityReductionPanel from just-after-SummaryPanel to just-above
CloseConversationFlow, keeping CloseConversationFlow last. Confirm?
**Answer (confirmed):** Yes. Panel order: DecisionsFileUploadPanel ->
ManifestUploadPanel -> SummaryPanel -> VulnerabilityReductionPanel ->
CloseConversationFlow.

**Q7 (Subheading removal & a11y):** The `<p className=subheading>` helper text is
redundant with each box's heading + file-input label; remove it from the DOM
entirely (no SR-only/`aria-describedby` retention)?
**Answer (confirmed):** Yes. Remove the `<p class="subheading">` helper text from
the DOM entirely. No SR-only retention.

**Q8 (Narrow-viewport behaviour):** This is a desktop authoring tool; keep the
two-column layout side-by-side at all widths (relying on the clamp), with NO
responsive stack-below-breakpoint. Confirm desktop-only / no mobile-stacking?
**Answer (confirmed):** Yes. Desktop-only. Keep two columns side-by-side at all
widths (rely on the clamp). No responsive stacking.

### Existing Code to Reference

**Similar Features / reuse candidates identified (from reading the code):**
- Mount point: the conversation is mounted INSIDE `RightHandPanelShell` -
  `frontend/src/components/common/RightHandPanelShell.tsx`. This is a
  right-anchored overlay that defaults to ~50% of the viewport and already has
  its own left-edge drag-resize + per-project localStorage width
  (`rhs-panel-width-2:{projectId}`). The "right column" to widen is the INNER
  column of `.layout`, nested two levels inside that overlay.
- Drag maths to reuse: `RightHandPanelShell` (its existing pointer/drag-resize
  implementation for the overlay's left edge).
- a11y + re-clamp to reuse: `frontend/src/components/shared/ResizableSplitPane.tsx`
  (px width + localStorage + clamp + keyboard arrow-key a11y + window-resize
  re-clamp). NOTE: it fixes the LEFT pane with the right pane flexing - our need
  is the inverse (chat/left flexes, right column is the fixed adjustable width),
  so take only the a11y + re-clamp logic, do not reuse wholesale.
- Handle styling to reuse: `UnifiedChatPanel.module.css .resizeHandle` (the look
  the conversation overlay already uses via `RightHandPanelShell`).
- localStorage pref pattern to mirror: `ConversationMainPane.tsx:173-193`
  (the `auto-select-recommended-version` machine-level pref read/write pattern).
- Right-column build site / current grid: `ArchitectConversationTab.tsx`
  (~lines 1398-1493) and `ArchitectConversation.module.css:16-22`
  (`.layout { grid-template-columns: minmax(0, 1fr) 320px }`).
- Subheadings to remove: `ManifestUploadPanel.tsx:296-301` and
  `DecisionsFileUploadPanel.tsx:113-117`.

## Visual Assets

### Files Provided:
No visual assets provided. The `planning/visuals/` folder was checked via bash
and is empty.

### Visual Insights:
None - grounding is on the code only (as agreed; no screenshot to be provided).

## Requirements Summary

### Functional Requirements
- Reorder the right-hand column panels to:
  DecisionsFileUploadPanel -> ManifestUploadPanel -> SummaryPanel ->
  VulnerabilityReductionPanel -> CloseConversationFlow.
- Remove the `<p className={styles.subheading}>` helper text from the upload
  boxes entirely (no SR-only retention).
- Title-Case the box `<h3>` headings only (box titles, not internal section
  labels): "Target dependency manifests" -> "Target Dependency Manifests";
  "Decisions captured" -> "Decisions Captured"; title-case the estimated
  vulnerability reduction default heading. ("Manually Answer Target State" is
  already title-case.)
- Add a draggable, right-anchored splitter inside `.layout` so the user can
  resize the right column; the chat pane flexes, the right column holds the
  fixed adjustable width.
- Default right-column width 440px; min 320px; max = `min(620px, 60% of layout
  width)`.
- Persist the right-column width in ONE machine-global localStorage key
  `architect-conversation.rightColumnWidth`.
- Keyboard arrow-key a11y on the splitter; re-clamp width on window resize.
- Make ONLY the transcript scroll: input bar / latest pending question pinned at
  the bottom of the pane; right-hand column scrolls independently; auto-scroll to
  newest turn ON by default.

### Reusability Opportunities
- `RightHandPanelShell` drag maths (overlay left-edge resize) -> inner splitter
  drag behaviour.
- `ResizableSplitPane` keyboard-arrow a11y + window-resize re-clamp logic only
  (do not generalise the component).
- `UnifiedChatPanel.module.css .resizeHandle` -> inner splitter handle styling.
- `ConversationMainPane.tsx:173-193` localStorage pref pattern -> width
  persistence read/write.

### Scope Boundaries
**In Scope:**
- All four UI/UX fixes above, frontend-only, within
  `frontend/src/components/targetState/architectConversation/` and related CSS
  modules.
- A single targeted change to the shared `RightHandPanelShell` content wrapper
  (`overflow:auto` -> `overflow:hidden` + inner height bounding) for the scroll
  fix.

**Out of Scope:**
- Any backend/gateway changes.
- Generalising `ResizableSplitPane` into a right-fixed mode.
- Responsive / mobile stacking (desktop-only).
- SR-only retention of the removed subheading text.
- Spec B (version-unknown -> pending questions) and Spec C (live
  vulnerability-reduction recompute + OSV bridge + logging).

### Technical Considerations
- Key code findings (grounded on reading the code):
  - The conversation is mounted INSIDE `RightHandPanelShell`, a right-anchored
    overlay (~50% viewport default) with its own left-edge drag-resize +
    per-project localStorage width (`rhs-panel-width-2:{projectId}`). The column
    to widen is the INNER `.layout` column, nested two levels in.
  - Scroll culprit: the shell content wrapper
    `<div style={{ flex:1, minHeight:0, overflow:'auto' }}>{children}</div>` at
    `RightHandPanelShell.tsx:240`. That `overflow:auto` is why the whole
    conversation body scrolls instead of just the transcript - NOT the page shell
    (`ArchitectureDesignTargetStatePage` / `TargetArchitectureWorkspace`) named in
    the raw idea. `RightHandPanelShell` appears to be used ONLY by the architect
    conversation today, so the change is safely scoped.
  - The inner split is currently a fixed CSS grid
    `.layout { grid-template-columns: minmax(0, 1fr) 320px }`
    (`ArchitectConversation.module.css:16-22`); the new splitter replaces the
    fixed 320px track with the adjustable persisted width.
  - Existing CSS already attempts transcript-only scroll
    (`.container{height:100%;min-height:0}`, `.layout{flex:1;min-height:0}`,
    `.transcript{flex:1;overflow-y:auto}`) - it just never resolves because the
    height chain is unbounded at the shell wrapper above it.

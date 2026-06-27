# Specification: Target-state Architect-Conversation Right-Panel UX (Spec A)

## Goal
Improve the Target State -> Architect Conversation 3-pane view with a reordered/decluttered right column, a resizable + wider right column, and a corrected scroll model so only the transcript scrolls. Frontend-only; no backend/gateway/AMS changes.

## User Stories
- As an architect using the conversation view, I want the bulk-input boxes ordered logically and the right column wide enough (and resizable) so I can work without cramped panels.
- As an architect, I want only the transcript to scroll with the input bar / latest pending question pinned, so the page never scrolls away from where I am answering.

## Specific Requirements

**Right-column panel reorder**
- In `ArchitectConversationTab.tsx` (~1398-1493), reorder the right column's children to: `DecisionsFileUploadPanel` -> `ManifestUploadPanel` -> `SummaryPanel` -> `VulnerabilityReductionPanel` -> `CloseConversationFlow`.
- This moves both upload boxes above `SummaryPanel` and moves `VulnerabilityReductionPanel` to just above `CloseConversationFlow`; `CloseConversationFlow` stays last.
- Preserve every existing prop, callback, and comment on each panel exactly as-is; this is a JSX reorder only.

**Remove redundant subheading helper text**
- Fully remove the `<p className={styles.subheading}>...</p>` block in `ManifestUploadPanel.tsx` (~296-301) and in `DecisionsFileUploadPanel.tsx` (~113-117).
- Full DOM removal: no screen-reader-only / `aria-describedby` retention of the copy.
- Leave the box `aria-label` on each `<section>` and the file-input label intact for accessibility.

**Title-Case box headings only**
- `ManifestUploadPanel.tsx` `<h3>`: "Target dependency manifests" -> "Target Dependency Manifests".
- `SummaryPanel` `<h3>`: "Decisions captured" -> "Decisions Captured".
- `VulnerabilityReductionPanel` heading: Title-Case the default heading; note the call site in `ArchitectConversationTab.tsx:1415` passes `heading="Estimated vulnerability reduction"` explicitly, so Title-Case that call-site string (and the component default at `VulnerabilityReductionPanel.tsx:141` for consistency).
- "Manually Answer Target State" is already correct; do NOT touch internal section labels or other sub-headings.

**Resizable + wider right column**
- The conversation is mounted INSIDE `RightHandPanelShell` (a right-anchored overlay with its own per-project left-edge resize); the column to make adjustable is the INNER `.layout` grid in `ArchitectConversation.module.css:16-22` (currently `grid-template-columns: minmax(0, 1fr) 320px`).
- Build a focused, right-anchored splitter inside `.layout`: the chat/left pane flexes (`minmax(0, 1fr)`), the right column holds a fixed, drag-adjustable px width. Replace the fixed `320px` track with the persisted width.
- Reuse the pointer/drag maths from `RightHandPanelShell` (`window.innerWidth - e.clientX` style; here compute against the layout container's right edge via `getBoundingClientRect`). Reuse the keyboard arrow-key a11y (`role="separator"`, `tabIndex={0}`, `aria-valuenow/min/max`, arrow + shift-arrow steps) and the window-resize re-clamp from `shared/ResizableSplitPane`. Do NOT generalise `ResizableSplitPane`.
- Width clamps: default 440px; min 320px; max = `min(620px, 60% of layout width)` so the chat pane can never collapse below ~40%.
- Desktop-only: two columns side-by-side at all widths (rely on the clamp); no responsive stacking / breakpoint.

**Width persistence**
- Persist the right-column width in ONE machine-global localStorage key `architect-conversation.rightColumnWidth` (not per-project).
- Mirror the read/write helper pattern in `ConversationMainPane.tsx:173-193` (try/catch-guarded `window.localStorage`, default applied when absent/blocked).
- The overlay's own per-project width key (`rhs-panel-width-2:{projectId}`) is unchanged.

**Scroll model fix (transcript-only scroll)**
- Root cause: the shared shell content wrapper `<div style={{ flex:1, minHeight:0, overflow:'auto' }}>{children}</div>` at `RightHandPanelShell.tsx:240` lets the whole conversation body scroll.
- Change that wrapper `overflow:'auto'` -> `overflow:'hidden'` and ensure its inner height is bounded so the existing height chain (`.container{height:100%;min-height:0}`, `.layout{flex:1;min-height:0}`, `.transcript{flex:1;overflow-y:auto}`) resolves and only `.transcript` scrolls.
- `RightHandPanelShell` is used only by the architect conversation today, so this change is scoped to this view.
- The input bar / latest pending question stays pinned at the bottom of the main pane; the right column scrolls independently (its panels already use `overflow-y:auto` where needed).
- Add auto-scroll-to-newest-turn behaviour in the transcript (scroll to bottom when a new turn arrives), ON by default.

## Visual Design
No visual assets provided (`planning/visuals/` is empty). Grounding is on the code only.

## Existing Code to Leverage

**`RightHandPanelShell.tsx` (overlay drag-resize + scroll-fix site)**
- `handleResizeStart` + the `mousemove`/`mouseup` effect (lines ~120-146) are the proven drag maths to mirror for the inner splitter.
- Line 240 content wrapper is the exact scroll-fix site (`overflow:auto` -> `overflow:hidden` + height bounding).
- Per-project width key `rhs-panel-width-2:{projectId}` stays untouched.

**`shared/ResizableSplitPane.tsx` (a11y + re-clamp only)**
- Reuse `clamp`, the `handleKeyDown` arrow/shift-arrow logic (lines ~161-183), and the window-resize re-clamp effect (lines ~189-204).
- It fixes the LEFT pane; our need is the inverse (right column fixed), so take only the a11y + re-clamp logic, not the component wholesale.

**`UnifiedChat/UnifiedChatPanel.module.css` `.resizeHandle`**
- Reuse this handle styling (lines ~257-273, incl. `:hover`/`:active`) for the new inner splitter, matching the overlay's existing handle look.

**`ConversationMainPane.tsx:173-193` (localStorage pref pattern)**
- Mirror `readAutoSelectVersionPref` / `writeAutoSelectVersionPref` (try/catch-guarded, default-on-absent) for the `architect-conversation.rightColumnWidth` read/write helpers.

**`ArchitectConversation.module.css` (inner grid + height chain)**
- `.layout` (lines 16-22) holds the fixed `320px` track to replace with the adjustable width; `.container`/`.transcript` already define the intended height/scroll chain that the shell fix unblocks.

## Out of Scope
- Any backend, gateway, or AMS changes.
- Generalising `ResizableSplitPane` into a right-fixed mode.
- Responsive / mobile stacking or breakpoints (desktop-only).
- Screen-reader-only retention of the removed subheading copy.
- Changing the overlay's own per-project width key or default.
- Editing internal section labels / sub-headings other than the three specified box `<h3>`/heading titles.
- Spec B (version-unknown -> pending questions).
- Spec C (live vulnerability-reduction recompute + OSV bridge + logging).
</content>
</invoke>

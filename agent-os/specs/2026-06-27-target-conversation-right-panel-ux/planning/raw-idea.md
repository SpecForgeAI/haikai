# Spec A — Target-state architect-conversation right-panel UX

Frontend-only UX improvements to the Target State → Architect Conversation view (the 3-pane workspace). All changes are in `frontend/src/components/targetState/architectConversation/` and the related CSS modules. No backend/gateway changes.

Four problems to fix:

1. **Panel order + clutter + heading casing.**
   - In the right-hand column (built in `ArchitectConversationTab.tsx` ~lines 1398-1493), move the two bulk-input boxes — "Manually Answer Target State" (`DecisionsFileUploadPanel`) and "Target Dependency Manifests" (`ManifestUploadPanel`) — ABOVE the "Decisions Captured" box (`SummaryPanel`). Proposed new order: DecisionsFileUploadPanel → ManifestUploadPanel → SummaryPanel → VulnerabilityReductionPanel → CloseConversationFlow.
   - Remove the explanatory small `<p className={styles.subheading}>` text that sits between each upload box's `<h3>` title and its "Choose File" input. It only takes up space. (`ManifestUploadPanel.tsx:296-301`, `DecisionsFileUploadPanel.tsx:113-117`).
   - Title-Case the box `<h3>` headings (box titles only, not internal section labels): "Target dependency manifests" → "Target Dependency Manifests"; "Decisions captured" → "Decisions Captured"; "Estimated vulnerability reduction" → title-case its default heading. "Manually Answer Target State" is already title-case.

2. **Adjustable + wider right column.**
   - The split is currently a fixed CSS grid `.layout { grid-template-columns: minmax(0, 1fr) 320px }` in `ArchitectConversation.module.css:16-22`.
   - Add a draggable splitter between the main conversation pane and the right-hand boxes so the user can resize.
   - The default right-column width should be WIDER by default (~420-460px). Width should be sticky per-machine in localStorage (mirror the existing `auto-select-recommended-version` localStorage pref pattern in `ConversationMainPane.tsx:173-193`). Apply a sensible min/max clamp so the chat never collapses.

3. **Scroll the transcript, not the whole window.**
   - Currently the entire chat window / page scrolls. The intended behaviour (the CSS in `ArchitectConversation.module.css` already attempts this: `.container{height:100%;min-height:0}`, `.layout{flex:1;min-height:0}`, `.transcript{flex:1;overflow-y:auto}`) is that ONLY the transcript scrolls, with the input bar / latest pending question pinned at the bottom of the pane, and the right-hand column scrolling independently.
   - Root cause: the height chain is not bounded at the top — an ancestor above `.container` (the page shell / sub-tab wrapper / `TargetArchitectureWorkspace` → `ArchitectureDesignTargetStatePage`) lets content dictate height instead of clamping to the viewport, so the document scrolls. The fix is to bound the height up the ancestor chain so `height:100%`/`min-height:0` resolves.
   - Goal: right-hand area easily fits on screen, full chat messages are scrollable within the transcript pane, and the latest question is always visible at the bottom. Add auto-scroll-to-bottom on new turns.

These are UI/UX only. Points 4 and 5 from the broader discussion (version-unknown→pending questions; live vulnerability-reduction recompute + OSV bridge + logging) are SEPARATE specs (B and C) and are out of scope here.

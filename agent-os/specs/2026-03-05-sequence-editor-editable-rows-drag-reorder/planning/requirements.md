# Spec Requirements: sequence-editor-editable-rows-drag-reorder

## Initial Description

For Sequence diagrams only, make Participants / Message Exchanges / Fragments editable via a new row-level Edit icon (modal opens in edit mode with prefilled values and Update/Cancel), and enable fast reordering of Flow items via drag-and-drop (in addition to existing up/down arrows).

Motivation:
- After adding Sequence Participants / Message Exchanges / Fragments, users cannot edit them without deleting and re-adding.
- Reordering long Flow lists via repeated up/down clicks is slow and frustrating.
- Editing Participants must safely update all dependent Message Exchanges that reference them.

## Requirements Discussion

### First Round Questions

**Q1:** No drag-and-drop list library is currently installed. I'm assuming we should use `@dnd-kit/core` + `@dnd-kit/sortable` since it is the modern, well-maintained React DnD library with excellent accessibility and touch support. Is that correct, or would you prefer a different library?
**Answer:** Use @dnd-kit/core + @dnd-kit/sortable (keep it minimal: PointerSensor + KeyboardSensor, vertical list strategy, and a simple drag handle).

**Q2:** When a participant's ref_kind and/or ref_id change, the raw idea says to update all Message Exchanges referencing that participant. I'm assuming the participant's stable id stays the same, and since Message Exchanges only store from_participant_id / to_participant_id (the stable ID), propagation is automatic via label refresh. Is that correct, or is there an additional data update needed on the message objects themselves?
**Answer:** If message exchanges reference participants by stable participantId and that id stays the same, then "propagation" is mostly automatic label/lookup refresh; no message objects should be rewritten unless you currently denormalize/copy participant ref_kind/ref_id onto message records -- in that case update those cached fields for any message referencing the participantId.

**Research Finding (Q2 follow-up):** Codebase verification confirms that `SequenceMessage` does NOT denormalize/copy participant `ref_kind`/`ref_id`. Messages only store `from_participant_id` and `to_participant_id` (stable participant IDs). Therefore, participant edit propagation is purely automatic: updating the participant's `ref_kind`/`ref_id` in place causes all message labels to resolve correctly on the next render. No message object rewriting is required.

**Q3:** A message exchange consists of a Request message and optionally a Response message sharing an exchange_id. When the user clicks "Edit" on a message node, should editing be at the exchange level (editing both request and response together), or should each individual message node be independently editable?
**Answer:** Edit at the exchange level: one "Edit Message Exchange" edits the Request and optional Response together (same exchange_id); do not support editing individual request/response nodes independently in this increment.

**Q4:** The Flow tab has a tree structure with root-level nodes and nodes nested inside fragment operands. I'm assuming drag-and-drop only reorders items within their current sibling scope. Dragging between nesting levels or between operands would be out of scope. Is that correct?
**Answer:** DnD only reorders within the current sibling scope (same parent list / same fragment operand); no dragging between nesting levels or between operands.

**Q5:** The raw idea says DnD is for "Flow tab items" only. The Participants tab already has a visual drag handle icon. I'm assuming we should NOT add functional DnD to the Participants tab in this spec. Is that correct?
**Answer:** Keep Participants tab as-is (no functional DnD in this increment); up/down arrows remain the only reordering mechanism for participants.

**Q6:** The raw idea specifies the Edit icon should be placed "immediately left of the existing Delete icon." I'm assuming the button order from left to right would be: [Move Up] [Move Down] [Edit] [Delete], and we should use lucide-react icons. Is that correct?
**Answer:** Yes button order is [Move Up] [Move Down] [Edit] [Delete], and yes use lucide-react icons with the same size/weight as existing controls (e.g., Pencil for edit, Trash/X for delete).

**Q7:** When editing a fragment, should the user be able to add/remove operands during edit, and what happens when fragment_kind changes?
**Answer:** On fragment_kind change, reset operands to the new kind's default structure (to avoid invalid combinations); do not add/remove operands during edit in this increment beyond what the modal already supports today.

**Q8:** Is anything explicitly excluded that I should be aware of?
**Answer:** Explicitly exclude undo/redo, cross-scope drag, confirmation dialogs before edits (only delete confirm remains if already present), advanced validation beyond existing rules, and any changes to non-Sequence diagrams or to period/zoom/export controls.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: AddParticipantDrawer - Path: `frontend/src/components/DiagramsView/SequenceEditor/AddParticipantDrawer.tsx`
  - Simple two-field drawer (refKind dropdown, refId dropdown). Will need edit mode: accept optional initial data, change title to "Edit Participant", change submit button to "Update", pre-populate fields.
- Feature: AddMessageExchangeDrawer - Path: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
  - Complex multi-section form (from/to participants, request content mode toggle, response content, collection flags, endpoint show flags). Will need edit mode: accept existing exchange data, pre-populate all fields from the Request + optional Response messages, change title/button text.
- Feature: AddFragmentDrawer - Path: `frontend/src/components/DiagramsView/SequenceEditor/AddFragmentDrawer.tsx`
  - Fragment kind selector, label text, operand guard expressions with add/remove for Alternative. Will need edit mode: accept existing fragment + operands, pre-populate, reset operands on fragment_kind change.
- Feature: ParticipantsTab - Path: `frontend/src/components/DiagramsView/SequenceEditor/ParticipantsTab.tsx`
  - Contains `ParticipantRow` with existing drag handle (visual only), up/down arrows, delete. Edit icon will be added here.
- Feature: SequenceNodeRow - Path: `frontend/src/components/DiagramsView/SequenceEditor/SequenceNodeRow.tsx`
  - Contains message and fragment row rendering with up/down and delete buttons. Edit icon and drag handle will be added here.
- Feature: FlowTab - Path: `frontend/src/components/DiagramsView/SequenceEditor/FlowTab.tsx`
  - Contains tree building logic, move/delete handlers, drawer state management. DnD integration and edit handlers will be added here.
- Feature: useSequenceDiagram hook - Path: `frontend/src/hooks/useSequenceDiagram.ts`
  - Manages local SequenceDiagram state with debounced autosave. All updates flow through `updateSequenceDiagram(partialUpdates)`.
- Feature: sequenceDiagramUtils - Path: `frontend/src/utils/sequenceDiagramUtils.ts`
  - Contains participant CRUD utilities (add, remove, moveUp, moveDown, reindex). Will need update/edit utilities.
- Feature: SequenceEditorPanel CSS - Path: `frontend/src/components/DiagramsView/SequenceEditorPanel.module.css`
  - Contains `.dragHandle`, `.actionButton`, `.listItem`, `.itemActions` styles. DnD drag-active and drag-over styles will be added here.
- Feature: CreateAndPlaceDrawer CSS - Path: `frontend/src/components/DiagramsView/CreateAndPlaceDrawer.module.css`
  - Shared drawer/modal styling used by all three add drawers.
- Feature: lucide-react icons - Already installed in `package.json` dependencies; use `Pencil` (or `PencilLine`) for edit, consistent sizing with existing icon usage.

### Follow-up Questions

No follow-up questions were needed. The user's answers were comprehensive and the codebase research confirmed the data model assumptions (no denormalization of participant data onto messages).

## Visual Assets

### Files Provided:
No visual assets provided. Bash check confirmed no image files exist in the visuals directory.

### Visual Insights:
Not applicable -- no visual assets were provided.

## Requirements Summary

### Functional Requirements

**A. Edit Icon on Row Items**
- Add an Edit icon button to each row in the Participants tab (ParticipantRow) and Flow tab (SequenceNodeRow for both Message and Fragment nodes).
- Button order from left to right: [Move Up] [Move Down] [Edit] [Delete].
- Use lucide-react `Pencil` icon for the Edit button, matching the size and weight of existing action buttons.
- Edit icon only appears on hover (matching existing `.itemActions` opacity behavior).
- Applies ONLY when diagram_type === 'Sequence'.

**B. Edit Participant Modal**
- Clicking Edit on a ParticipantRow opens the AddParticipantDrawer in "edit mode".
- Edit mode changes: title becomes "Edit Participant", submit button becomes "Update", fields pre-populated with the participant's current `ref_kind` and `ref_id`.
- On Update: the participant's `ref_kind` and `ref_id` are updated in place; the participant's stable `id` does NOT change.
- Participant edit propagation is automatic: since `SequenceMessage.from_participant_id` and `to_participant_id` reference the stable participant `id` (not the entity ref_kind/ref_id), all message labels refresh correctly when the participant's underlying entity changes.
- No message object rewriting is required (confirmed: messages do not denormalize participant data).

**C. Edit Message Exchange Modal**
- Clicking Edit on a Message node in the Flow tab opens the AddMessageExchangeDrawer in "edit mode".
- Editing is always at the exchange level: the modal shows the full exchange (Request + optional Response) for the given `exchange_id`.
- If the user clicks Edit on a Response node, the modal should still open showing the full exchange (locate the Request message via shared `exchange_id`).
- Edit mode changes: title becomes "Edit Message Exchange", submit button becomes "Update", all fields pre-populated from the existing Request and Response messages.
- Pre-population includes: fromParticipantId, toParticipantId, requestMode (reference vs label), request content fields, includeResponse checkbox, response content fields, collection flags, endpoint show flags, and response_mode.
- On Update: existing message objects are updated in place (same `id` values preserved); no new IDs generated.
- If the user toggles "Include Response" off during edit (removing an existing response), the response message and its node should be removed.
- If the user toggles "Include Response" on during edit (adding a response to a request-only exchange), a new response message and node should be created.

**D. Edit Fragment Modal**
- Clicking Edit on a Fragment node in the Flow tab opens the AddFragmentDrawer in "edit mode".
- Edit mode changes: title becomes "Edit Fragment", submit button becomes "Update", fields pre-populated from the existing fragment's `fragment_kind`, `label_text`, and operand `guard_expression` values.
- On fragment_kind change during edit: operands are reset to the new kind's default structure (Loop/Optional = 1 operand, Alternative = 2 operands) to avoid invalid combinations.
- Add/remove operand functionality during edit mirrors what the add drawer supports today (Alternative can add branches, minimum 2).
- On Update: existing fragment and operand objects are updated in place where possible; if fragment_kind changed, operands are recreated with new IDs.

**E. Drag-and-Drop Reorder for Flow Tab**
- Install `@dnd-kit/core` and `@dnd-kit/sortable` as new dependencies.
- Add functional drag-and-drop to Flow tab items (Message Exchange nodes and Fragment nodes) using `@dnd-kit/sortable` with vertical list strategy.
- Sensors: PointerSensor + KeyboardSensor (minimal configuration).
- Each Flow tab row gets a drag handle (already exists visually for participants but not for flow nodes; add the hamburger/grip icon).
- DnD only reorders within the current sibling scope: root-level items reorder among root-level siblings; nested items reorder within the same fragment operand.
- No dragging between nesting levels, between operands, or between tabs.
- On drop: update `order_index` values for all affected nodes in the sibling scope to reflect the new order.
- Preserve existing up/down arrow buttons (DnD is an addition, not a replacement).

**F. No DnD for Participants Tab**
- Participants tab retains its current behavior: up/down arrows only, no functional drag-and-drop in this increment.
- The existing visual drag handle in ParticipantRow remains as-is (decorative).

**G. Diagram Refresh After Operations**
- All edit/reorder operations must trigger the existing autosave flow via `updateSequenceDiagram(partialUpdates)` which debounces and persists changes through `onUpdateDiagram`.
- The diagram canvas must re-render to reflect changes (this should happen automatically via the existing state management pipeline; ensure no regressions).

### Reusability Opportunities
- The three existing "Add" drawers can be extended with an `editData` (or `initialData` + `mode`) prop pattern rather than creating separate edit components. This keeps a single component per entity type.
- The existing `.actionButton` CSS class and pattern can be reused for the Edit button.
- The existing `sequenceDiagramUtils.ts` utility functions can be extended with update/edit variants (e.g., `updateParticipantInDiagram`, `updateMessageExchangeInDiagram`, `updateFragmentInDiagram`).
- The `@dnd-kit/sortable` integration could potentially be extracted into a reusable `DraggableList` component if other parts of the app need similar functionality in the future, but for this increment it can be built directly into FlowTab.

### Scope Boundaries

**In Scope:**
- Edit icon on Participant rows, Message node rows, and Fragment node rows (Sequence diagrams only)
- Edit mode for AddParticipantDrawer (pre-populated, Update/Cancel)
- Edit mode for AddMessageExchangeDrawer (exchange-level editing, pre-populated, Update/Cancel)
- Edit mode for AddFragmentDrawer (pre-populated, operand reset on kind change, Update/Cancel)
- Participant edit propagation (automatic via stable ID references)
- Drag-and-drop reordering for Flow tab items within sibling scope
- Installing @dnd-kit/core and @dnd-kit/sortable
- Replacing unicode action button characters with lucide-react icons
- Preserving existing up/down arrow and delete functionality

**Out of Scope:**
- Changes to non-Sequence diagram types
- Undo/redo support for edits
- Cross-scope drag (between nesting levels, between operands, between tabs)
- Functional DnD for Participants tab
- Confirmation dialogs before edits (only delete confirm remains if already present)
- Advanced validation beyond existing rules
- New diagram data model redesign or backend persistence changes
- Batch operations or multi-select editing
- Additional keyboard shortcuts beyond what @dnd-kit provides by default
- Changes to period/zoom/export controls or other toolbar elements
- Editing individual request/response messages independently (always exchange-level)

### Technical Considerations
- **New dependency:** `@dnd-kit/core` and `@dnd-kit/sortable` must be added to `frontend/package.json`.
- **Sensor configuration:** Use `PointerSensor` (with activation constraint to avoid accidental drags) and `KeyboardSensor` for accessibility.
- **Sortable strategy:** Use `verticalListSortingStrategy` from `@dnd-kit/sortable`.
- **Drag handle:** Use `useSortable` hook's `attributes` and `listeners` on the drag handle element only (not the entire row), so row clicks still work normally.
- **DnD within nested scopes:** Each sibling group (root level, or within a specific operand) should be its own `SortableContext`. This ensures items can only be reordered within their scope.
- **State management:** All updates flow through the existing `updateSequenceDiagram(partialUpdates)` pattern in `useSequenceDiagram` hook. No new reducer actions or context changes needed.
- **Drawer edit mode pattern:** Extend drawer props with optional `editData` / `mode` prop. When in edit mode, skip form reset, pre-populate from editData, and change title/button text.
- **Exchange-level editing:** When Edit is clicked on any message node, look up all messages with the same `exchange_id` to find the Request and optional Response, then populate the edit form from both.
- **Icon library:** `lucide-react` is already a project dependency. Use `Pencil` for edit, and consider replacing the existing unicode characters (`&#x25B2;`, `&#x25BC;`, `&#x2715;`) with appropriate lucide-react icons (`ChevronUp`, `ChevronDown`, `X`) for visual consistency.
- **CSS considerations:** Add DnD-related styles (drag-active overlay, drop placeholder) to `SequenceEditorPanel.module.css`. The existing `.dragHandle` class already has `cursor: grab` styling.
- **Testing:** Use Vitest + React Testing Library (existing test stack). Test edit mode pre-population, update submission, DnD reordering, and participant propagation.

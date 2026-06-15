# Specification: Sequence Editor Editable Rows and Drag-Reorder

## Goal
Enable editing of existing Sequence diagram Participants, Message Exchanges, and Fragments via row-level Edit icons that open the existing Add drawers in edit mode, and add drag-and-drop reordering to Flow tab items using @dnd-kit.

## User Stories
- As a solution architect, I want to edit an existing participant's entity reference without deleting and re-adding it, so that all dependent message exchanges automatically reflect the change.
- As a solution architect, I want to drag Flow tab items to reorder them quickly, so that I do not have to click up/down arrows repeatedly for long lists.
- As a solution architect, I want to edit the details of an existing message exchange or fragment in place, so that I can correct mistakes without recreating complex configurations.

## Specific Requirements

**Edit icon on all Sequence row items**
- Add a `Pencil` icon button from lucide-react to each ParticipantRow (in `ParticipantsTab.tsx`) and each message/fragment row (in `SequenceNodeRow.tsx`).
- Button order left-to-right: [Move Up] [Move Down] [Edit] [Delete].
- Replace existing unicode characters for move up (`&#x25B2;`), move down (`&#x25BC;`), and delete (`&#x2715;` / `x`) with lucide-react icons: `ChevronUp`, `ChevronDown`, `Pencil`, and `X` respectively, sized at 14px to match the existing 24x24 `.actionButton` container.
- Edit icon inherits the existing `.actionButton` CSS class and the hover-reveal behavior from `.itemActions` opacity transition.
- Applies only when `diagram_type === 'Sequence'` (already enforced by component hierarchy; no additional guard needed).

**Edit Participant drawer (edit mode for AddParticipantDrawer)**
- Extend `AddParticipantDrawer` props with an optional `editData` prop: `{ participantId: string; refKind: ParticipantRefKind; refId: string }`.
- When `editData` is provided: title becomes "Edit Participant", submit button text becomes "Update", and form fields are pre-populated with `editData.refKind` and `editData.refId` instead of resetting to empty.
- The `useEffect` that resets form on `isOpen` must check whether `editData` is present; if so, populate from `editData` instead of clearing.
- On submit in edit mode, call a new `onUpdate` callback (separate from `onSubmit`) that receives `(participantId, refKind, refId)`.
- In `ParticipantsTab`, the update handler maps over `sequenceDiagram.participants`, replacing the matching participant's `ref_kind` and `ref_id` in place while preserving its `id` and `order_index`.
- Participant edit propagation is automatic: `SequenceMessage.from_participant_id` and `to_participant_id` reference the stable `id`, not the entity ref data. No message object rewriting is needed.

**Edit Message Exchange drawer (edit mode for AddMessageExchangeDrawer)**
- Extend `AddMessageExchangeDrawer` props with an optional `editData` prop containing the full exchange: `{ exchangeId: string; requestMessage: SequenceMessage; responseMessage?: SequenceMessage; requestNode: SequenceNode; responseNode?: SequenceNode }`.
- When `editData` is provided: title becomes "Edit Message Exchange", submit button becomes "Update", and all `FormData` fields are pre-populated from the request and optional response messages.
- Pre-population mapping: `fromParticipantId`, `toParticipantId` from request; `requestMode` derived from whether `ref_kind` or `label_text` is set; all reference fields, collection flags, and endpoint show flags mapped from the corresponding message properties; `includeResponse` set to `true` if a response message exists; `responseContentMode` derived from `response_mode` field.
- When the user clicks Edit on a Response node, `FlowTab` must look up the Request message via the shared `exchange_id` and provide both messages as `editData`.
- On submit in edit mode: update existing message objects in place (preserve original `id` values), do not generate new IDs.
- If user toggles "Include Response" off during edit (removing existing response): remove the response message from `sequenceDiagram.messages` and the response node from `sequenceDiagram.sequence_nodes`.
- If user toggles "Include Response" on during edit (adding response to request-only exchange): create a new response message and node with generated IDs.

**Edit Fragment drawer (edit mode for AddFragmentDrawer)**
- Extend `AddFragmentDrawer` props with an optional `editData` prop: `{ fragmentId: string; fragment: SequenceFragment; operands: SequenceOperand[]; node: SequenceNode }`.
- When `editData` is provided: title becomes "Edit Fragment", submit button becomes "Update", and form fields are pre-populated from the fragment's `fragment_kind`, `label_text`, and operand `guard_expression` values.
- On `fragment_kind` change during edit: reset operands to the new kind's default structure using the existing `getDefaultOperands()` function (Loop/Optional = 1 operand, Alternative = 2 operands).
- On submit in edit mode: if `fragment_kind` did not change, update the existing fragment and operands in place (preserve IDs); if `fragment_kind` changed, recreate operands with new IDs while keeping the same `fragment_id`.

**Drag-and-drop reorder for Flow tab items**
- Install `@dnd-kit/core` and `@dnd-kit/sortable` as new dependencies in `frontend/package.json`.
- In `FlowTab`, wrap the node list with `DndContext` (from `@dnd-kit/core`) and `SortableContext` (from `@dnd-kit/sortable`) using `verticalListSortingStrategy`.
- Configure sensors: `PointerSensor` with an activation constraint (distance: 5px to avoid accidental drags) and `KeyboardSensor` for accessibility.
- Each root-level item in the Flow tab becomes a sortable item using the `useSortable` hook; the drag handle element (not the entire row) receives `attributes` and `listeners` from the hook.
- Add a drag handle icon (lucide-react `GripVertical`, 14px) to each `SequenceNodeRow` for flow items, matching the existing `styles.dragHandle` CSS pattern already used in `ParticipantRow`.
- DnD only reorders within the current sibling scope: root-level items among root siblings, nested items within their parent operand. Each sibling group gets its own `SortableContext` with the IDs of that scope's items.
- On `DragEnd`: compute the new ordering from `@dnd-kit/sortable`'s `arrayMove`, then update `order_index` values for all affected nodes in that sibling scope and call `onUpdate({ sequence_nodes: updatedNodes })`.
- Add visual feedback CSS: `.dragOverlay` style for the item being dragged (slight elevation/opacity), and `.dropPlaceholder` style for the target position. Add these to `SequenceEditorPanel.module.css`.

**No DnD for Participants tab**
- Participants tab remains unchanged: up/down arrows only, no functional DnD. The existing decorative `&#x2630;` drag handle in `ParticipantRow` stays as-is (but replace the unicode with lucide-react `GripVertical` for visual consistency).

**Diagram refresh after edit/reorder operations**
- All edit and reorder operations flow through the existing `updateSequenceDiagram(partialUpdates)` from `useSequenceDiagram` hook, which triggers debounced autosave via `onUpdateDiagram`. No new state management patterns needed.

## Visual Design
No visual assets were provided. UI follows existing patterns from the SequenceEditorPanel and CreateAndPlaceDrawer CSS modules.

## Existing Code to Leverage

**AddParticipantDrawer (`frontend/src/components/DiagramsView/SequenceEditor/AddParticipantDrawer.tsx`)**
- Simple two-field drawer (refKind dropdown, refId dropdown) with form reset on open, validation, and submit/cancel buttons.
- Extend with `editData` prop to switch between "Add" and "Edit" modes; conditionally change title (line 156), submit button text (line 245), and form initialization logic (lines 56-62).
- Reuse existing `handleRefKindChange`, `handleRefIdChange`, and `validateForm` logic unchanged.

**AddMessageExchangeDrawer (`frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`)**
- Complex multi-section form with `FormData` interface (lines 58-78) and `INITIAL_FORM_DATA` constant (lines 80-100) that can be used as a template for building `editData`-to-`FormData` mapping.
- The `handleSubmit` function (lines 413-531) builds `SequenceMessage` and `SequenceNode` objects; in edit mode this logic must update in place instead of creating new IDs.
- Reuse all existing validation, field change handlers, and conditional UI rendering unchanged.

**AddFragmentDrawer (`frontend/src/components/DiagramsView/SequenceEditor/AddFragmentDrawer.tsx`)**
- Contains `getDefaultOperands()` helper (lines 87-101) which should be reused for operand reset on `fragment_kind` change during edit.
- The `handleSubmit` function (lines 235-279) creates fragment, operands, and node; in edit mode this must update in place.
- Form initialization (lines 142-152) must branch on `editData` presence to populate from existing fragment data.

**FlowTab (`frontend/src/components/DiagramsView/SequenceEditor/FlowTab.tsx`)**
- Contains `buildNodeTree()` (lines 56-112) which produces the `TreeNode[]` structure; DnD `SortableContext` items should be derived from this tree's root-level and per-operand children arrays.
- Contains `handleMoveNode()` (lines 220-258) with sibling scope filtering logic (lines 228-233) that should be replicated for DnD reorder index recalculation.
- Drawer state management pattern (lines 149-154) should be extended with `editData` state variables for each drawer type.

**SequenceEditorPanel.module.css (`frontend/src/components/DiagramsView/SequenceEditorPanel.module.css`)**
- `.actionButton` (lines 190-203) and `.actionButtonDanger` (lines 211-215): reuse for the Edit button.
- `.dragHandle` (lines 308-316): reuse for Flow tab drag handles; extend with `.dragActive` and `.dropPlaceholder` classes for DnD visual feedback.
- `.itemActions` (lines 177-187): hover-reveal opacity transition applies to the new Edit button automatically.

## Out of Scope
- Changes to non-Sequence diagram types (Activity, Deployment, etc.)
- Undo/redo support for edit or reorder operations
- Cross-scope drag (dragging between nesting levels, between fragment operands, or between tabs)
- Functional drag-and-drop for the Participants tab (up/down arrows remain the only reorder mechanism)
- Confirmation dialogs before edits (only existing delete confirmation behavior is preserved)
- Advanced validation beyond existing form rules (e.g., duplicate participant detection)
- Backend persistence or data model changes (all updates use existing `updateSequenceDiagram` flow)
- Batch operations or multi-select editing
- Additional keyboard shortcuts beyond what @dnd-kit provides by default
- Changes to period/zoom/export controls or other toolbar elements
- Editing individual request/response messages independently (always exchange-level editing)

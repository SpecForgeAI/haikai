# Task Breakdown: Sequence Editor Editable Rows and Drag-Reorder

## Overview
Total Tasks: 6 Task Groups, ~38 sub-tasks

This is a **frontend-only** spec. No backend or API changes are required. All updates flow through the existing `updateSequenceDiagram(partialUpdates)` hook pattern with debounced autosave.

## Task List

### Icon Replacement and Edit Button Foundation

#### Task Group 1: Replace Unicode Action Icons with Lucide-React and Add Edit Button
**Dependencies:** None

- [x] 1.0 Complete icon replacement and Edit button addition across all row components
  - [x] 1.1 Write 4 focused tests for icon replacement and edit button rendering
    - Test that `ParticipantRow` renders `ChevronUp`, `ChevronDown`, `Pencil`, and `X` lucide-react icons instead of unicode characters
    - Test that `SequenceNodeRow` (message node) renders `ChevronUp`, `ChevronDown`, `Pencil`, and `X` icons in correct left-to-right order: [Move Up] [Move Down] [Edit] [Delete]
    - Test that `SequenceNodeRow` (fragment node) renders the Edit button alongside existing move and delete buttons
    - Test that `ParticipantRow` renders `GripVertical` lucide-react icon instead of unicode `&#x2630;` for the decorative drag handle
  - [x] 1.2 Replace unicode icons in `ParticipantRow` within `ParticipantsTab.tsx`
    - Replace `&#x25B2;` (move up) with lucide-react `ChevronUp` at size 14px
    - Replace `&#x25BC;` (move down) with lucide-react `ChevronDown` at size 14px
    - Replace `&#x2715;` (delete) with lucide-react `X` at size 14px
    - Replace `&#x2630;` (drag handle) with lucide-react `GripVertical` at size 14px
    - Add `Pencil` icon button (14px) between Move Down and Delete buttons
    - Pencil button uses existing `.actionButton` CSS class
    - Add `onEdit` callback prop to `ParticipantRowProps`: `onEdit: (id: string) => void`
    - Wire Pencil button `onClick` to call `onEdit(participant.id)`
    - File: `frontend/src/components/DiagramsView/SequenceEditor/ParticipantsTab.tsx`
  - [x] 1.3 Replace unicode icons in `SequenceNodeRow` for message nodes and fragment nodes
    - Replace `^` (move up) with lucide-react `ChevronUp` at size 14px
    - Replace `v` (move down) with lucide-react `ChevronDown` at size 14px
    - Replace `x` (delete) with lucide-react `X` at size 14px
    - Add `Pencil` icon button (14px) between Move Down and Delete buttons in both message and fragment node renders
    - Add `onEdit` callback prop to `SequenceNodeRowProps`: `onEdit: (nodeId: string) => void`
    - Wire Pencil button `onClick` to call `onEdit(node.id)`
    - Add `GripVertical` drag handle icon (14px) to each row item, reusing existing `styles.dragHandle` CSS class (visual only for now; will become functional in Task Group 5)
    - File: `frontend/src/components/DiagramsView/SequenceEditor/SequenceNodeRow.tsx`
  - [x] 1.4 Update `FlowTab` and `ParticipantsTab` to pass `onEdit` handlers to row components
    - In `ParticipantsTab`: add placeholder `handleEditParticipant` callback and pass it as `onEdit` to `ParticipantRow`
    - In `FlowTab`: add placeholder `handleEditNode` callback and pass it as `onEdit` to `SequenceNodeRow`
    - Placeholder handlers can be empty functions or `console.log` stubs; they will be fully wired in Task Groups 2-4
    - Files: `frontend/src/components/DiagramsView/SequenceEditor/ParticipantsTab.tsx`, `frontend/src/components/DiagramsView/SequenceEditor/FlowTab.tsx`
  - [x] 1.5 Ensure icon replacement tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify all lucide-react icons render correctly
    - Verify button order is [Move Up] [Move Down] [Edit] [Delete]
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- All unicode characters (`&#x25B2;`, `&#x25BC;`, `&#x2715;`, `&#x2630;`, `^`, `v`, `x`) are replaced with lucide-react equivalents
- Edit (Pencil) button appears on every ParticipantRow and SequenceNodeRow
- Button order is consistently [Move Up] [Move Down] [Edit] [Delete]
- All icon buttons are 14px within existing 24x24 `.actionButton` containers
- GripVertical replaces unicode drag handle in ParticipantRow; GripVertical added to SequenceNodeRow

---

### Edit Participant Drawer

#### Task Group 2: Extend AddParticipantDrawer with Edit Mode
**Dependencies:** Task Group 1 (Edit button exists on ParticipantRow)

- [x] 2.0 Complete edit mode for AddParticipantDrawer and wire into ParticipantsTab
  - [x] 2.1 Write 4 focused tests for participant edit functionality
    - Test that `AddParticipantDrawer` displays "Edit Participant" title and "Update" button text when `editData` prop is provided
    - Test that `AddParticipantDrawer` pre-populates `refKind` and `refId` fields from `editData` on open
    - Test that `AddParticipantDrawer` calls `onUpdate` (not `onSubmit`) with `(participantId, refKind, refId)` when submitted in edit mode
    - Test that `ParticipantsTab` update handler replaces the matching participant's `ref_kind` and `ref_id` in place while preserving `id` and `order_index`
  - [x] 2.2 Extend `AddParticipantDrawer` props with edit mode support
    - Add optional `editData` prop: `{ participantId: string; refKind: ParticipantRefKind; refId: string }`
    - Add optional `onUpdate` callback prop: `(participantId: string, refKind: ParticipantRefKind, refId: string) => void`
    - When `editData` is provided: set title to "Edit Participant", submit button text to "Update"
    - Modify the `useEffect` that resets form on `isOpen`: when `editData` is present, populate `refKind` and `refId` from `editData` instead of clearing to empty
    - In `handleSubmit`: if `editData` is present, call `onUpdate(editData.participantId, refKind, refId)` instead of `onSubmit(refKind, refId)`
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddParticipantDrawer.tsx`
  - [x] 2.3 Wire edit participant handler in `ParticipantsTab`
    - Add `editParticipantData` state: `useState<{ participantId: string; refKind: ParticipantRefKind; refId: string } | null>(null)`
    - Implement `handleEditParticipant(participantId: string)`: look up the participant by id, set `editParticipantData` with its current `ref_kind` and `ref_id`, and open the drawer
    - Implement `handleUpdateParticipant(participantId, refKind, refId)`: map over `sequenceDiagram.participants`, replace matching participant's `ref_kind` and `ref_id` while preserving `id` and `order_index`, call `onUpdate({ participants: updatedParticipants })`, close drawer
    - Pass `editData={editParticipantData}` and `onUpdate={handleUpdateParticipant}` to `AddParticipantDrawer`
    - Pass `handleEditParticipant` as the `onEdit` prop to `ParticipantRow` (replacing the placeholder from 1.4)
    - Clear `editParticipantData` to `null` when opening drawer for "Add" mode
    - File: `frontend/src/components/DiagramsView/SequenceEditor/ParticipantsTab.tsx`
  - [x] 2.4 Ensure participant edit tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify edit mode drawer renders correctly with pre-populated data
    - Verify update handler correctly modifies participant in place
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- Clicking Edit on a participant opens the drawer with "Edit Participant" title and pre-populated fields
- Updating a participant preserves its stable `id` and `order_index`
- Message exchanges referencing the participant automatically reflect the change (no message rewriting needed)
- Existing "Add Participant" flow remains unaffected

---

### Edit Message Exchange Drawer

#### Task Group 3: Extend AddMessageExchangeDrawer with Edit Mode
**Dependencies:** Task Group 1 (Edit button exists on SequenceNodeRow)

- [x] 3.0 Complete edit mode for AddMessageExchangeDrawer and wire into FlowTab
  - [x] 3.1 Write 6 focused tests for message exchange edit functionality
    - Test that `AddMessageExchangeDrawer` displays "Edit Message Exchange" title and "Update" button when `editData` is provided
    - Test that `AddMessageExchangeDrawer` pre-populates all form fields from `editData` request message (fromParticipantId, toParticipantId, requestMode, reference fields, label text)
    - Test that `AddMessageExchangeDrawer` pre-populates response fields and sets `includeResponse=true` when `editData` contains a response message
    - Test that submitting in edit mode preserves original message `id` values (does not generate new IDs)
    - Test that toggling "Include Response" off during edit of a two-message exchange removes the response message and node from the diagram
    - Test that toggling "Include Response" on during edit of a request-only exchange creates new response message and node with generated IDs
  - [x] 3.2 Define the `editData` type and extend `AddMessageExchangeDrawer` props
    - Define `MessageExchangeEditData`: `{ exchangeId: string; requestMessage: SequenceMessage; responseMessage?: SequenceMessage; requestNode: SequenceNode; responseNode?: SequenceNode }`
    - Add optional `editData` prop of type `MessageExchangeEditData`
    - Add optional `onUpdate` callback: `(messages: SequenceMessage[], nodes: SequenceNode[], removedMessageIds?: string[], removedNodeIds?: string[]) => void`
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
  - [x] 3.3 Implement `editData`-to-`FormData` mapping in AddMessageExchangeDrawer
    - In the `useEffect` that resets form on `isOpen`: when `editData` is present, build `FormData` from `editData` instead of using `INITIAL_FORM_DATA`
    - Map `fromParticipantId` and `toParticipantId` from request message
    - Derive `requestMode`: if `requestMessage.ref_kind` is set then `'reference'`, else `'label'`
    - Map `requestRefKind`, `requestRefId`, `requestLabelText`, `requestIsCollection`, `showEndpointName`, `showEndpointVerbPath`, `showEndpointReqResData` from request message properties
    - Set `includeResponse = true` if `editData.responseMessage` exists
    - Derive `responseContentMode` from response message's `response_mode` field: `'endpoint_response'` if set, else derive from ref_kind/label_text presence
    - Map all response reference fields, label text, collection flags, and endpoint show flags from response message
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
  - [x] 3.4 Implement edit-mode submission logic in AddMessageExchangeDrawer
    - When `editData` is present and `handleSubmit` fires:
      - Build updated request message reusing `editData.requestMessage.id` and `editData.exchangeId` (do not generate new IDs)
      - Build updated request node reusing `editData.requestNode.id` and preserving `order_index`, `parent_node_id`, `parent_operand_id`
      - If `includeResponse` is true and `editData.responseMessage` exists: update response message reusing existing `id`; update response node reusing existing `id`
      - If `includeResponse` is true and `editData.responseMessage` does NOT exist: create new response message and node with `generateId()`
      - If `includeResponse` is false and `editData.responseMessage` exists: include `editData.responseMessage.id` and `editData.responseNode.id` in `removedMessageIds` and `removedNodeIds`
    - Change title to "Edit Message Exchange" and submit button to "Update" / "Updating..." when `editData` is present
    - Call `onUpdate` instead of `onSubmit` in edit mode
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
  - [x] 3.5 Wire edit message exchange handler in `FlowTab`
    - Add `editMessageExchangeData` state: `useState<MessageExchangeEditData | null>(null)`
    - Implement `handleEditNode(nodeId: string)`: determine if the node is a message or fragment
      - For message nodes: look up the message by `node.message_id`, find the exchange by `message.exchange_id`, find the request message (exchange_role === 'Request') and optional response message, find corresponding nodes, build `editData`, set state and open message drawer
      - For Response nodes: look up the Request message via shared `exchange_id`, provide both messages as `editData`
      - For fragment nodes: delegate to fragment edit handler (Task Group 4)
    - Implement `handleUpdateMessageExchange(messages, nodes, removedMessageIds, removedNodeIds)`:
      - Build updated `sequenceDiagram.messages`: replace existing messages by id, add new ones, remove ones in `removedMessageIds`
      - Build updated `sequenceDiagram.sequence_nodes`: replace existing nodes by id, add new ones, remove ones in `removedNodeIds`
      - Call `onUpdate({ messages: updatedMessages, sequence_nodes: updatedNodes })`
      - Close drawer and clear editData state
    - Pass `editData` and `onUpdate` to `AddMessageExchangeDrawer`
    - Clear `editMessageExchangeData` to `null` when opening drawer for "Add" mode
    - File: `frontend/src/components/DiagramsView/SequenceEditor/FlowTab.tsx`
  - [x] 3.6 Ensure message exchange edit tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify pre-population, update submission, response toggle on/off during edit
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 3.1 pass
- Clicking Edit on any message node opens the drawer with the full exchange pre-populated
- Clicking Edit on a Response node still opens the full exchange (not just the response)
- Update preserves original message and node IDs
- Toggling Include Response on/off during edit correctly adds or removes response entities
- Existing "Add Message Exchange" flow remains unaffected

---

### Edit Fragment Drawer

#### Task Group 4: Extend AddFragmentDrawer with Edit Mode
**Dependencies:** Task Group 1 (Edit button exists on SequenceNodeRow)

- [x] 4.0 Complete edit mode for AddFragmentDrawer and wire into FlowTab
  - [x] 4.1 Write 4 focused tests for fragment edit functionality
    - Test that `AddFragmentDrawer` displays "Edit Fragment" title and "Update" button when `editData` is provided
    - Test that `AddFragmentDrawer` pre-populates `fragment_kind`, `label_text`, and operand `guard_expression` values from `editData`
    - Test that changing `fragment_kind` during edit resets operands to new kind's default structure via `getDefaultOperands()`
    - Test that submitting in edit mode without changing `fragment_kind` preserves existing fragment and operand IDs, while changing `fragment_kind` recreates operands with new IDs
  - [x] 4.2 Extend `AddFragmentDrawer` props with edit mode support
    - Define `FragmentEditData`: `{ fragmentId: string; fragment: SequenceFragment; operands: SequenceOperand[]; node: SequenceNode }`
    - Add optional `editData` prop of type `FragmentEditData`
    - Add optional `onUpdate` callback: `(fragment: SequenceFragment, operands: SequenceOperand[], node: SequenceNode, removedOperandIds?: string[]) => void`
    - When `editData` is provided: title becomes "Edit Fragment", submit button becomes "Update"
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddFragmentDrawer.tsx`
  - [x] 4.3 Implement edit-mode form initialization and submission in AddFragmentDrawer
    - In the `useEffect` that resets form on `isOpen`: when `editData` is present, populate `fragmentKind` from `editData.fragment.fragment_kind`, `labelText` from `editData.fragment.label_text`, and `operands` from `editData.operands` (mapping `guard_expression` to `guardExpression` and preserving `id`)
    - Track original `fragment_kind` to detect if it changed during edit (store in a ref or state)
    - On `fragment_kind` change during edit: reset operands using `getDefaultOperands()` (existing behavior already handles this in the `handleFragmentKindChange` callback)
    - On submit in edit mode:
      - If `fragment_kind` did NOT change: reuse existing `fragmentId`, fragment `id`, and operand `id` values; update fields in place
      - If `fragment_kind` changed: reuse `fragmentId` and fragment `id`, but recreate operands with new IDs (using `generateId()`); pass the old operand IDs as `removedOperandIds` for cleanup
      - Reuse the existing `node.id`, `order_index`, `parent_node_id`, `parent_operand_id` from `editData.node`
    - Call `onUpdate` instead of `onSubmit` in edit mode
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddFragmentDrawer.tsx`
  - [x] 4.4 Wire edit fragment handler in `FlowTab`
    - Add `editFragmentData` state: `useState<FragmentEditData | null>(null)`
    - Extend `handleEditNode(nodeId)` (from 3.5) to handle fragment nodes:
      - For fragment nodes: look up the fragment by `node.fragment_id`, find its operands from `sequenceDiagram.operands`, build `editData`, set state and open fragment drawer
    - Implement `handleUpdateFragment(fragment, operands, node, removedOperandIds)`:
      - Replace fragment in `sequenceDiagram.fragments` by `id`
      - Replace/add operands in `sequenceDiagram.operands`: remove `removedOperandIds`, replace existing by `id`, add new ones
      - Replace node in `sequenceDiagram.sequence_nodes` by `id`
      - Call `onUpdate({ fragments, operands, sequence_nodes })`
      - Close drawer and clear editData state
    - Pass `editData` and `onUpdate` to `AddFragmentDrawer`
    - Clear `editFragmentData` to `null` when opening drawer for "Add" mode
    - File: `frontend/src/components/DiagramsView/SequenceEditor/FlowTab.tsx`
  - [x] 4.5 Ensure fragment edit tests pass
    - Run ONLY the 4 tests written in 4.1
    - Verify pre-population, fragment_kind change operand reset, update submission
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 4.1 pass
- Clicking Edit on a fragment node opens the drawer with pre-populated fragment data and operands
- Changing fragment_kind resets operands to the new kind's default structure
- Update with unchanged fragment_kind preserves existing IDs
- Update with changed fragment_kind recreates operands with new IDs while keeping the same fragment_id
- Existing "Add Fragment" flow remains unaffected

---

### Drag-and-Drop Reorder for Flow Tab

#### Task Group 5: Install @dnd-kit and Implement DnD Reorder in FlowTab
**Dependencies:** Task Group 1 (GripVertical drag handles exist on SequenceNodeRow)

- [x] 5.0 Complete drag-and-drop reorder functionality for Flow tab items
  - [x] 5.1 Install `@dnd-kit/core` and `@dnd-kit/sortable` dependencies
    - Run `npm install @dnd-kit/core @dnd-kit/sortable` in the `frontend/` directory
    - Verify packages are added to `frontend/package.json` dependencies
  - [x] 5.2 Write 5 focused tests for drag-and-drop reorder functionality
    - Test that `FlowTab` renders `DndContext` and `SortableContext` wrappers around the node list
    - Test that `SequenceNodeRow` provides `useSortable` attributes and listeners on the drag handle element (not the entire row)
    - Test that `DragEnd` handler correctly computes new ordering using `arrayMove` and updates `order_index` for all affected siblings
    - Test that DnD reorder within a nested operand scope only affects sibling nodes within that operand (not root-level nodes)
    - Test that sensors are configured with `PointerSensor` (distance: 5px activation constraint) and `KeyboardSensor`
  - [x] 5.3 Make `SequenceNodeRow` a sortable item using `useSortable` hook
    - Import `useSortable` from `@dnd-kit/sortable` and `CSS` from `@dnd-kit/utilities`
    - Accept new optional props: `sortableId: string` and `isDndEnabled: boolean`
    - When `isDndEnabled` is true: call `useSortable({ id: sortableId })`, apply `transform` and `transition` styles to the row element
    - Attach `attributes` and `listeners` from `useSortable` to the `GripVertical` drag handle element only (not the entire row)
    - Apply `.dragActive` CSS class when `isDragging` is true (from `useSortable`)
    - File: `frontend/src/components/DiagramsView/SequenceEditor/SequenceNodeRow.tsx`
  - [x] 5.4 Wrap `FlowTab` node list with DnD context and sortable contexts
    - Import `DndContext`, `closestCenter`, `PointerSensor`, `KeyboardSensor`, `useSensor`, `useSensors` from `@dnd-kit/core`
    - Import `SortableContext`, `verticalListSortingStrategy`, `arrayMove` from `@dnd-kit/sortable`
    - Configure sensors: `PointerSensor` with `activationConstraint: { distance: 5 }` and `KeyboardSensor`
    - Wrap the root-level node list with `DndContext` and `SortableContext` using `verticalListSortingStrategy`
    - Set `SortableContext` items to the root-level tree node IDs (derived from `nodeTree`)
    - For nested items within fragment operands: each operand's children get their own `SortableContext` with the IDs of that scope's items (this affects the recursive rendering in `SequenceNodeRow`)
    - Pass `sortableId={treeNode.node.id}` and `isDndEnabled={true}` to each root-level `SequenceNodeRow`
    - File: `frontend/src/components/DiagramsView/SequenceEditor/FlowTab.tsx`
  - [x] 5.5 Implement `DragEnd` handler in `FlowTab`
    - On `DragEnd` event: extract `active.id` and `over.id`
    - Determine the sibling scope of the dragged item (root-level or within a specific operand): find the node's `parent_node_id` and `parent_operand_id`
    - Filter `sequenceDiagram.sequence_nodes` to get only siblings in the same scope
    - Sort siblings by `order_index`
    - Compute old and new indices from `active.id` and `over.id` positions within the sorted siblings
    - Use `arrayMove` to get the new ordering
    - Reassign `order_index` values (0, 1, 2, ...) for all siblings in the scope
    - Build `updatedNodes`: merge the reindexed siblings back into the full `sequence_nodes` array
    - Call `onUpdate({ sequence_nodes: updatedNodes })`
    - Reuse the sibling scope filtering logic pattern from `handleMoveNode` (lines 228-233 in FlowTab.tsx)
    - File: `frontend/src/components/DiagramsView/SequenceEditor/FlowTab.tsx`
  - [x] 5.6 Add DnD visual feedback CSS styles
    - Add `.dragActive` class to `SequenceEditorPanel.module.css`: slight elevation (box-shadow), reduced opacity (0.8), background highlight
    - Add `.dragOverlay` class: for the drag overlay item appearance (if using `DragOverlay` component)
    - Add `.dropPlaceholder` class: visual indicator for the drop target position
    - Ensure `.dragHandle` class gets `cursor: grabbing` when actively dragging (via `.dragActive .dragHandle`)
    - File: `frontend/src/components/DiagramsView/SequenceEditorPanel.module.css`
  - [x] 5.7 Ensure DnD reorder tests pass
    - Run ONLY the 5 tests written in 5.2
    - Verify DnD context renders, drag handle receives sortable props, reorder logic works
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 5.2 pass
- `@dnd-kit/core` and `@dnd-kit/sortable` are installed in `frontend/package.json`
- Flow tab items can be dragged via the GripVertical handle to reorder within their sibling scope
- Root-level items reorder among root siblings; nested items reorder within their parent operand
- No cross-scope dragging is possible
- `order_index` values are correctly updated for all affected siblings after a drag
- Visual feedback (drag overlay, placeholder) appears during drag operations
- Existing up/down arrow buttons continue to work alongside DnD
- PointerSensor has 5px distance activation constraint to prevent accidental drags
- KeyboardSensor is configured for accessibility
- Participants tab is NOT affected (no functional DnD)

---

### Test Review and Integration Verification

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 4 tests from Task Group 1 (icon replacement and edit button)
    - Review the 4 tests from Task Group 2 (participant edit)
    - Review the 6 tests from Task Group 3 (message exchange edit)
    - Review the 4 tests from Task Group 4 (fragment edit)
    - Review the 5 tests from Task Group 5 (DnD reorder)
    - Total existing tests: approximately 23 tests
  - [x] 6.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack coverage
    - Focus ONLY on gaps related to edit mode, DnD reorder, and icon rendering requirements
    - Do NOT assess entire application test coverage
    - Priority areas to check:
      - Edit drawer opening and closing lifecycle (open edit, cancel, reopen for different item)
      - State cleanup when switching between "Add" and "Edit" modes for the same drawer
      - DnD reorder followed by edit (ensuring the correct item is edited after reorder)
      - Participant edit propagation: verify that after updating a participant's ref, message labels still resolve correctly
  - [x] 6.3 Write up to 8 additional strategic tests to fill critical gaps
    - Add a maximum of 8 new tests to fill identified gaps
    - Focus on integration points and end-to-end workflows
    - Suggested gap tests (adjust based on 6.2 findings):
      - Test that the drawer switches correctly between Add and Edit modes when reopened
      - Test that editing a participant does NOT cause any message object to be rewritten (only participant array changes)
      - Test that editing a message exchange where response is removed also removes the response node from the tree
      - Test that editing a fragment with changed fragment_kind correctly removes old operands and creates new ones
      - Test that DnD reorder of nested items within an operand does not affect root-level node ordering
      - Test that all edit/reorder operations trigger `onUpdate` with the correct partial updates (integration with `updateSequenceDiagram`)
    - Do NOT write exhaustive edge-case coverage
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.2, and 6.3)
    - Expected total: approximately 23-31 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 23-31 tests total)
- Critical user workflows for this feature are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements
- No regressions in existing add-mode drawer behavior

---

## Execution Order

Recommended implementation sequence:

```
1. Task Group 1: Icon Replacement and Edit Button Foundation
   (No dependencies - sets the foundation for all subsequent groups)
        |
        +--> 2. Task Group 2: Edit Participant Drawer
        |    (Depends on 1: Edit button on ParticipantRow)
        |
        +--> 3. Task Group 3: Edit Message Exchange Drawer
        |    (Depends on 1: Edit button on SequenceNodeRow)
        |    (Note: 3.5 FlowTab wiring also handles fragment node routing to Task Group 4)
        |
        +--> 4. Task Group 4: Edit Fragment Drawer
        |    (Depends on 1: Edit button on SequenceNodeRow)
        |    (Shares FlowTab handler with Task Group 3)
        |
        +--> 5. Task Group 5: DnD Reorder for Flow Tab
             (Depends on 1: GripVertical handles on SequenceNodeRow)
                  |
                  v
            6. Task Group 6: Test Review and Gap Analysis
               (Depends on all above groups being complete)
```

**Parallelism note:** Task Groups 2, 3, 4, and 5 are largely independent of each other and can be developed in parallel after Task Group 1 completes. The one coupling point is that Task Groups 3 and 4 both modify `FlowTab.tsx` -- specifically the `handleEditNode` handler needs to route to the correct drawer based on node type. Coordinate this by having Task Group 3 implement the handler skeleton with the message branch, and Task Group 4 extends it with the fragment branch.

## Key Files Modified

| File | Task Groups |
|------|-------------|
| `frontend/src/components/DiagramsView/SequenceEditor/ParticipantsTab.tsx` | 1, 2 |
| `frontend/src/components/DiagramsView/SequenceEditor/SequenceNodeRow.tsx` | 1, 5 |
| `frontend/src/components/DiagramsView/SequenceEditor/FlowTab.tsx` | 1, 3, 4, 5 |
| `frontend/src/components/DiagramsView/SequenceEditor/AddParticipantDrawer.tsx` | 2 |
| `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx` | 3 |
| `frontend/src/components/DiagramsView/SequenceEditor/AddFragmentDrawer.tsx` | 4 |
| `frontend/src/components/DiagramsView/SequenceEditorPanel.module.css` | 5 |
| `frontend/src/components/DiagramsView/SequenceEditor/__tests__/fragmentEdit.test.tsx` | 4 |
| `frontend/src/components/DiagramsView/SequenceEditor/__tests__/participantEdit.test.tsx` | 2 |
| `frontend/src/components/DiagramsView/SequenceEditor/__tests__/messageExchangeEdit.test.tsx` | 3 |
| `frontend/src/components/DiagramsView/SequenceEditor/__tests__/gapAnalysis.test.tsx` | 6 |
| `frontend/package.json` | 5 |

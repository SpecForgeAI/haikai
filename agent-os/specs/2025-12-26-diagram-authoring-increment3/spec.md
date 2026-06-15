# Specification: Diagram Type Authoring (Increment 3) — Sequence Diagram Editor + Enhanced State/Activity Inspectors

## Goal
Introduce a diagram-native authoring experience for Sequence diagrams with participants, messages, and fragments management, while enhancing State and Activity diagrams with richer edge inspectors for StateTransitions and ActivityFlows.

## User Stories
- As a user, I want to author Sequence diagrams by adding participants, message exchanges, and control flow fragments so that I can model interaction sequences visually.
- As a user, I want to edit StateTransition edges (trigger/guard/effect) and ActivityFlow edges (trigger/condition/flowKind) directly in the diagram view so that I can fully define behavioural semantics without leaving the canvas.

## Specific Requirements

**Sequence Diagram RHS Editor Panel**
- When `getDiagramType(activeDiagram) === 'Sequence'`, replace the standard palette with a tabbed "Sequence Editor" panel
- Two tabs: "Participants" and "Flow" (Messages + Fragments)
- Hide the existing "Add existing palette" list for Sequence diagrams
- Panel should match existing PalettePanel styling patterns
- Include "Saving..." indicator in header for autosave feedback

**Participants Tab**
- Display list of SequenceParticipant entries sorted by `order_index`
- Each row shows participant label (derived from refKind/refId lookup) with drag handle for reordering
- "+ Add Participant" button opens a drawer with refKind dropdown (BusinessUser, Application, ApplicationComponent, Service, Interface, InterfaceEndpoint, Class) and refId selector
- On save: POST to backend, update local participants list, reindex orderIndex sequentially
- Support delete action per participant row

**Flow Tab (Messages + Fragments)**
- Display linear outline of sequenceNodes as indented tree structure
- Message nodes show from/to participant labels and message content (refKind/refId label OR labelText)
- Fragment nodes show fragmentKind badge (Loop/Optional/Alternative) with nested operand blocks
- "+ Add Message Exchange" button opens drawer for creating request+optional response pair
- "+ Add Fragment" button opens drawer for creating Loop/Optional/Alternative with operands

**Message Exchange Create Flow**
- Drawer fields: fromParticipant dropdown, toParticipant dropdown
- Request content: toggle between "Reference" (refKind/refId selectors) and "Label" (labelText input) - one required
- Response content: optional, same toggle pattern
- On save: create 2 SequenceMessage records with shared exchangeId, create 2 SequenceNode records at correct orderIndex
- Backend validates message content one-of constraint (ref pair XOR labelText)

**Fragment Create Flow**
- Drawer fields: fragmentKind dropdown (Loop/Optional/Alternative), operand guardExpression inputs
- Loop/Optional: single operand with guard expression
- Alternative: 2 operands by default, "+ Add Operand" button for additional branches
- On save: create SequenceFragment, SequenceOperand(s), and SequenceNode at correct position
- Fragment nodes become containers; child nodes added via "Add inside..." actions

**Sequence Node Ordering**
- sequenceNodes determine visual ordering via orderIndex field
- Move up/down actions reindex affected siblings
- Parent-child nesting via parent_node_id and parent_operand_id for fragments
- Indentation in Flow tab reflects nesting depth

**StateTransition Edge Inspector**
- When a DiagramEdge with edge_type='STATE_TRANSITION' is selected, show enhanced inspector
- Fields: fromStateId/toStateId (read-only display), trigger (required), guard (optional), effect (optional)
- Trigger: mode selector (Event|Method|Text) with refKind/refId OR labelText input
- Guard: mode selector (None|Method|Expression) with refId OR expression input
- Effect: mode selector (None|Method|Text) with refId OR labelText input
- Save on blur/change via PUT to state-transitions endpoint, update ArchitectureContext

**ActivityFlow Edge Inspector**
- When a DiagramEdge with edge_type='ACTIVITY_FLOW' is selected, show enhanced inspector
- Fields: fromActivityId/toActivityId (read-only display), flowKind dropdown (Control/Data), trigger (optional), condition (optional)
- Trigger: mode selector (None|Event|Method|Text) with appropriate input
- Condition: mode selector (None|Method|Expression) with appropriate input
- Save on blur/change via PUT to activity-flows endpoint, update ArchitectureContext

**Backend Sequence Diagram Write Endpoints**
- Implement `PUT /api/sequence-diagrams/{id}/content` endpoint using "save whole diagram" strategy
- Request body: full SequenceDiagram JSON with all children (participants, messages, fragments, operands, sequence_nodes)
- Server deletes existing children for diagram id, inserts new children transactionally
- Run validation on full payload before persisting
- Return normalized SequenceDiagramDto after save

**Frontend Autosave Integration**
- Debounce sequence diagram saves by 500-1000ms on any change
- Track dirty state and show "Saving..." indicator during save
- Call PUT endpoint with full SequenceDiagram payload
- Update local state from response to ensure consistency

## Existing Code to Leverage

**`frontend/src/types/sequenceDiagram.ts`**
- Complete TypeScript types for SequenceParticipant, SequenceMessage, SequenceFragment, SequenceOperand, SequenceNode, SequenceDiagram
- Enum arrays (PARTICIPANT_REF_KINDS, MESSAGE_REF_KINDS, FRAGMENT_KINDS, etc.) for dropdown options
- Type guards (isParticipantRefKind, isMessageRefKind, etc.) for validation

**`frontend/src/components/DiagramsView/CreateAndPlaceDrawer.tsx`**
- Reusable drawer pattern with form fields, validation, and submit handling
- Field configuration approach (FieldConfig interface) for dynamic form rendering
- Reference options lookup pattern (getReferenceOptions function) for typeahead selectors
- CSS module patterns in CreateAndPlaceDrawer.module.css for consistent styling

**`frontend/src/components/DiagramsView/SelectionInspector.tsx`**
- Entity inspector pattern for editing selected nodes
- lookupEntity/getEntityTypeForDispatch patterns for meta-model access
- handleTextBlur/handleDropdownChange patterns for save-on-change behavior
- Can be extended to handle edge selection for StateTransition/ActivityFlow

**`architecture-model-service/.../SequenceDiagramService.java`**
- Existing read methods (getSequenceDiagram, getSequenceDiagramsByModelFileId)
- toDto mapper methods for all child entities
- Validation methods (validateParticipantRefKind, validateMessageContentOneOf, validateNodeKind, etc.)
- Needs write methods added: saveSequenceDiagramContent with transactional replace

**`frontend/src/types/model.ts` (StateTransition, ActivityFlow interfaces)**
- StateTransition: trigger_ref_kind/trigger_ref_id/trigger_label_text, guard_ref_kind/guard_ref_id/guard_expression, effect_ref_kind/effect_ref_id/effect_label_text
- ActivityFlow: trigger_ref_kind/trigger_ref_id/trigger_label_text, condition_ref_kind/condition_ref_id/condition_expression, flow_kind
- TriggerRefKind, GuardRefKind, EffectRefKind type definitions for mode selectors

## Out of Scope
- Advanced UML rendering polish (activation bars, message arrow styles, lifeline dashed lines)
- Complex typeahead search across all refKinds (simple dropdown acceptable for v1)
- Importing/exporting sequence diagrams to PlantUML or other formats
- Drag-and-drop reordering of sequence nodes (move up/down buttons acceptable)
- Minimal canvas representation for sequence diagrams (optional enhancement, not required)
- Fine-grained CRUD endpoints for sequence diagram children (using whole-diagram save instead)
- Creating new SequenceDiagram records (POST endpoint for new diagrams)
- StateTransition or ActivityFlow creation from inspector (separate "+ New Transition/Flow" buttons)
- Undo/redo for sequence diagram edits
- Real-time collaboration or conflict resolution

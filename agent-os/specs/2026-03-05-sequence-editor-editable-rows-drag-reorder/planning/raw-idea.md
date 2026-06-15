# Raw Idea: sequence-editor-editable-rows-drag-reorder

name: sequence-editor-editable-rows-drag-reorder
summary: For Sequence diagrams only, make Participants / Message Exchanges / Fragments editable via a new row-level Edit icon (modal opens in edit mode with prefilled values and Update/Cancel), and enable fast reordering of Flow items via drag-and-drop (in addition to existing up/down arrows).

motivation:
- After adding Sequence Participants / Message Exchanges / Fragments, users cannot edit them without deleting and re-adding.
- Reordering long Flow lists via repeated up/down clicks is slow and frustrating.
- Editing Participants must safely update all dependent Message Exchanges that reference them.

in_scope:
- Applies ONLY when current diagram.diagram_type === 'Sequence'.
- RHS Sequence Editor list rows gain a new "Edit" icon positioned immediately left of the existing Delete icon.
- Edit icon opens the existing "Add …" modal in an "edit mode" variant:
  - title changes to "Edit …"
  - fields pre-populated from the selected row
  - buttons: [Update] [Cancel]
- Implement editable flows for:
  1) Participant rows (Participants tab)
  2) Message Exchange rows (Flow tab)
  3) Fragment rows (Flow tab)
- Add drag-and-drop reordering for Flow tab items (Message Exchanges + Fragments) to allow moving an item quickly to any position.
- Preserve existing up/down arrow reordering and delete functionality.
- Diagram refresh/redraw must occur after Update/Reorder/Delete (already happens; ensure no regressions).

out_of_scope:
- Changes to non-Sequence diagram types.
- New diagram data model redesign or backend persistence changes.
- Cross-tab drag-and-drop (Participants list not draggable unless already planned).
- Dragging between groups or batch operations.
- Additional keyboard shortcuts beyond what the chosen DnD lib provides by default.
- Changes to period/zoom/export controls and other toolbar elements.

domain_rules (critical):
- Participants are shared nodes referenced by Message Exchanges (and potentially Fragments if applicable).
- Editing a Participant may change its referenced meta-model entity (e.g., Interface "My API" -> Service "My Service").
- When a Participant's underlying reference changes, ALL Message Exchanges that reference that Participant must be updated to reference the edited Participant's new reference, using the Participant's stable internal participantId/key (NOT by name matching).
  - i.e., do NOT leave Message Exchanges pointing at the old interface/service entity after a Participant is edited.
  - Update occurs in the background meta-model state and then the diagram refreshes.

assumptions:
- Sequence diagram state stores Participants with a stable participant identifier (e.g., participantId) and Message Exchanges refer to participants by that identifier.
- Existing modals for Add Participant / Add Message Exchange / Add Fragment already exist and can be extended to support edit mode.

implementation_plan:
A) UI: add Edit icon to list rows
B) Modal "edit mode" support (3 modals)
C) State/actions (ArchitectureContext or SequenceDiagram reducer area)
D) Participant edit propagation rule
E) Drag-and-drop reorder for Flow tab
F) Validation / safety

files_to_touch (typical; adjust to actual paths):
- src/components/DiagramsView/SequenceEditor/ParticipantsTab*.tsx
- src/components/DiagramsView/SequenceEditor/FlowTab*.tsx
- src/components/DiagramsView/SequenceEditor/modals/AddParticipantModal.tsx
- src/components/DiagramsView/SequenceEditor/modals/AddMessageExchangeModal.tsx
- src/components/DiagramsView/SequenceEditor/modals/AddFragmentModal.tsx
- src/contexts/ArchitectureContext.tsx
- Optional new component: src/components/common/DraggableList.tsx

acceptance_criteria:
1) Sequence-only scope
2) Edit icon placement
3) Edit Participant modal
4) Participant edit propagation
5) Edit Message Exchange modal
6) Edit Fragment modal
7) Drag-and-drop reorder (Flow)
8) No regression

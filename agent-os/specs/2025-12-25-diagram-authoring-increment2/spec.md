# Specification: Diagram Type Authoring Increment 2 - Create & Place for ER, State, Activity Diagrams

## Goal
Extend the Diagram View RHS panel with "Create & Place" workflows for ER, State, and Activity diagram types, enabling users to create new entities directly in-context and immediately place them on the active diagram while keeping the meta-model clean.

## User Stories
- As an architect working on an ER diagram, I want to create new Logical/Physical Entities directly from the diagram panel so that I can model data structures in-context without switching views.
- As a modeler building a State diagram, I want to create new States and immediately see them on my diagram so that I can design state machines efficiently.
- As a process designer using an Activity diagram, I want to create new Activities and Partitions in-place so that I can build workflows without leaving the diagram context.

## Specific Requirements

**RHS Panel Create Section for ER Diagrams**
- Show "+ New Logical Entity" and "+ New Physical Entity" buttons when activeDiagram.diagram_type is 'ER'
- Buttons appear in a new "Create" section above the existing "Add existing" palette sections
- Clicking a create button opens a lightweight drawer/modal form
- Section header should clearly distinguish "Create" from "Add Existing"

**RHS Panel Create Section for State Diagrams**
- Show "+ New State" button when activeDiagram.diagram_type is 'State'
- Same visual pattern as ER diagram create section
- Button opens State creation form with state_kind dropdown

**RHS Panel Create Section for Activity Diagrams**
- Show "+ New Partition" and "+ New Activity" buttons when activeDiagram.diagram_type is 'Activity'
- Same visual pattern as ER/State diagram create sections
- Each button opens its respective creation form

**CreateAndPlaceDrawer Component**
- Reusable drawer component for all create-and-place forms
- Fields are type-specific based on entity being created
- Required fields: name (all entities)
- Optional fields: description (all entities)
- Type-specific fields: state_kind (State), activity_kind (Activity), ref_kind/ref_id/name (Partition)
- Primary action: "Create & Add" button
- Secondary action: "Cancel" button
- Form validation prevents submit if required fields empty

**Entity Creation and State Update Flow**
- On "Create & Add": generate new entity with generatePrefixedId
- Dispatch ADD_ENTITY action to ArchitectureContext to persist in meta-model
- Create DiagramNode referencing the new entity (entity_type, entity_id)
- Dispatch ADD_DIAGRAM_NODE action to add node to active diagram
- Auto-select the new node after placement (for inspector editing)
- Close the drawer after successful creation

**Node Placement Strategy**
- Place new nodes at viewport center using getViewportCenter callback
- If multiple creates in sequence, apply cascade offset (+40px x, +40px y) to avoid overlap
- Use existing calculateZIndex to ensure new nodes appear on top
- Use DEFAULT_NODE_WIDTH and DEFAULT_NODE_HEIGHT for standard sizing

**Selection Inspector for Created Entities**
- When a node with refKind in {LogicalDataEntity, PhysicalDataEntity, State, Activity, ActivityPartition} is selected, show editable fields in RHS lower area
- Editable fields: name, description (all types)
- State-specific: state_kind dropdown (Initial/Normal/Final)
- Activity-specific: activity_kind dropdown (Initial/Action/Decision/Merge/Final)
- Partition-specific: ref_kind dropdown (optional), ref_id (conditional), name (conditional)
- Save changes on blur or via explicit "Save" button using UPDATE_ENTITY action

**Form Field Specifications for State Entity**
- name: text input, required
- state_kind: dropdown with values ['Initial', 'Normal', 'Final'], default 'Normal'
- description: textarea, optional

**Form Field Specifications for Activity Entity**
- name: text input, required
- activity_kind: dropdown with values ['Initial', 'Action', 'Decision', 'Merge', 'Final'], default 'Action'
- description: textarea, optional

**Form Field Specifications for ActivityPartition Entity**
- name: text input, required if ref_kind is not set
- ref_kind: optional dropdown with values ['BusinessUser', 'Application', 'ApplicationComponent', 'Service', 'Interface', 'Class']
- ref_id: dropdown populated based on ref_kind selection, required if ref_kind is set
- description: textarea, optional

## Existing Code to Leverage

**PalettePanel.tsx (frontend/src/components/DiagramsView/PalettePanel.tsx)**
- Existing RHS panel with palette sections and section expand/collapse logic
- getDiagramType helper usage for diagram type detection
- handleItemClick and handleAddRelationship patterns for node creation
- getCurrentViewportCenter helper for viewport-centered placement
- Integration point for adding the new "Create" section above existing palette sections

**ArchitectureContext.tsx (frontend/src/contexts/ArchitectureContext.tsx)**
- ADD_ENTITY action for persisting new entities to meta-model
- ADD_DIAGRAM_NODE action for adding nodes to diagrams
- UPDATE_ENTITY action for inspector save functionality
- Dispatch patterns for state updates

**model.ts (frontend/src/types/model.ts)**
- State interface with state_kind: StateKind field
- Activity interface with activity_kind: ActivityKind field
- ActivityPartition interface with ref_kind, ref_id, name, and order_index fields
- LogicalDataEntity and PhysicalDataEntity interfaces
- StateKind, ActivityKind, and ActivityPartitionRefKind type definitions

**Modal.tsx (frontend/src/components/common/Modal.tsx)**
- Existing modal component pattern with overlay, header, content, and footer sections
- Can be extended or used as reference for drawer component styling

**nodeCreation.ts (frontend/src/utils/nodeCreation.ts)**
- createDiagramNodeFromEntity helper for creating DiagramNode from entity
- calculateZIndex for z-index management
- DEFAULT_NODE_WIDTH and DEFAULT_NODE_HEIGHT constants
- ViewportCenter interface for positioning

## Out of Scope
- Sequence diagram editor (participants, messages, fragments)
- Canvas rendering changes beyond placing standard rectangular nodes
- Advanced ER attribute authoring inside entity boxes (visual nesting of attributes)
- Advanced State diagram rendering semantics (special shapes for Initial/Final states)
- Advanced Activity diagram rendering semantics (diamond shapes for decisions, swimlane layout)
- Editing LogicalDataAttribute or PhysicalDataAttribute entities from inspector
- Drag-and-drop placement (click-to-place on canvas)
- Undo/redo support for create actions
- Bulk creation of multiple entities
- Template-based entity creation

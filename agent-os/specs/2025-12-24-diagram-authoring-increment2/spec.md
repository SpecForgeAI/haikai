# Specification: Diagram Type Authoring Increment 2 - Create & Place for ER, State, Activity Diagrams

## Goal
Extend the Diagram View RHS panel to support in-context "Create & Place" workflows for ER, State, and Activity diagram types, allowing users to create new meta-model entities and immediately place them on the active diagram without leaving the Diagram View.

## User Stories
- As a data architect working on an ER diagram, I want to create a new Logical or Physical Entity directly from the Diagram View so that I can model entities in context without switching to Meta-Model tables.
- As a behavioral modeler working on a State diagram, I want to create new States directly on the diagram so that I can quickly sketch out state machines.
- As a process analyst working on an Activity diagram, I want to create new Activities and Partitions in-context so that I can build activity flows without interrupting my diagram workflow.

## Specific Requirements

**Create Buttons in RHS Panel by Diagram Type**
- When activeDiagram.type is 'ER': show "+ New Logical Entity" and "+ New Physical Entity" buttons
- When activeDiagram.type is 'State': show "+ New State" button
- When activeDiagram.type is 'Activity': show "+ New Partition" and "+ New Activity" buttons
- Buttons appear in a new "Create" section above the existing "Add existing" palette list
- Use getDiagramType() helper from types/diagramType.ts to determine current diagram type
- Buttons should be disabled when no diagram is selected (use existing hasActiveSelectedDiagram() pattern)

**CreateAndPlaceDrawer Component**
- Implement a reusable drawer/modal component for create forms
- Props: title, fields schema, onSubmit callback returning Promise of created entity
- Support field types: text input (required/optional), dropdown select
- Include "Create & Add" primary action and "Cancel" secondary action
- Use existing Modal component (components/common/Modal.tsx) as base or extend it
- Match existing AdvancedAddDialog.module.css styling patterns for consistency

**ER Entity Forms**
- Logical Entity form: name (required text), description (optional text)
- Physical Entity form: name (required text), description (optional text)
- Both forms follow same minimal pattern; no database/physical_type fields in this increment

**State Form**
- Fields: name (required text), stateKind (required dropdown: Initial/Normal/Final), description (optional text)
- stateKind defaults to 'Normal' for most common use case
- Use StateKind type from types/model.ts for dropdown values

**Activity Form**
- Fields: name (required text), activityKind (required dropdown: Initial/Action/Decision/Merge/Final), description (optional text)
- activityKind defaults to 'Action' for most common use case
- Use ActivityKind type from types/model.ts for dropdown values

**Partition Form**
- Fields: refKind (optional dropdown), refId (optional FK typeahead/text), name (optional text), description (optional text)
- refKind dropdown values: BusinessUser, Application, ApplicationComponent, Service, Interface, Class
- If refKind is set, refId becomes required; if refKind is unset, name becomes required
- Use ActivityPartitionRefKind type from types/model.ts

**Create Flow and Context Updates**
- On "Create & Add" click: call existing ADD_ENTITY dispatch action via useArchitectureDispatch()
- Entity types map: LogicalDataEntity->logical_data_entities, PhysicalDataEntity->physical_data_entities, State->states, Activity->activities, ActivityPartition->activity_partitions
- Generate entity ID using generatePrefixedId() from utils/idGenerator.ts
- After successful entity creation, immediately add diagram node using ADD_DIAGRAM_NODE action

**Node Placement Behavior**
- Use deterministic default positioning at viewport center
- Leverage existing getCurrentViewportCenter() pattern from PalettePanel.tsx
- Apply cascading offset (+40px x/y) for consecutive creates to avoid overlap
- Use createDiagramNodeFromEntity() from utils/nodeCreation.ts for node creation
- New nodes should be auto-selected after placement (for inspector editing)

**Selection Inspector for Created Entities**
- When a node with refKind in {LOGICAL_DATA_ENTITY, PHYSICAL_DATA_ENTITY, STATE, ACTIVITY, ACTIVITY_PARTITION} is selected, show editable fields
- Common fields for all: name (text input), description (textarea)
- State-specific: stateKind dropdown (Initial/Normal/Final)
- Activity-specific: activityKind dropdown (Initial/Action/Decision/Merge/Final)
- Partition-specific: refKind dropdown, refId selector, name (with conditional required rule)
- Save on blur or explicit "Save" button; use UPDATE_ENTITY dispatch action
- Inspector updates must sync to ArchitectureContext so Meta-Model tables reflect changes

**Preserve Existing Palette Behavior**
- Existing "Add existing" palette list must remain unchanged
- Create section appears above palette sections, visually separated
- No regressions to General diagram type palette behavior
- Maintain existing domain filtering and search functionality

## Existing Code to Leverage

**PalettePanel.tsx (DiagramsView)**
- Contains diagram type detection via getDiagramType() and fullDiagram lookup pattern
- Has existing hasActiveSelectedDiagram() check pattern for button disabling
- getCurrentViewportCenter() helper for positioning new nodes
- handleContextMenuAdd pattern shows how to create and add nodes

**ArchitectureContext.tsx**
- ADD_ENTITY action for persisting new entities to meta-model state
- ADD_DIAGRAM_NODE action for adding nodes to diagrams
- UPDATE_ENTITY action for inspector edits
- Entity type constants in action.entityType for dispatching

**Modal.tsx (components/common)**
- Base modal component with overlay, header, content, footer pattern
- Can be extended or wrapped for drawer-style create forms
- ErrorModal pattern shows how to handle form validation display

**types/model.ts**
- State interface with state_kind: StateKind field
- Activity interface with activity_kind: ActivityKind field
- ActivityPartition interface with ref_kind, ref_id, name, description fields
- LogicalDataEntity and PhysicalDataEntity interfaces for ER entities

**utils/nodeCreation.ts**
- createDiagramNodeFromEntity() creates DiagramNode with proper positioning
- calculateZIndex() for z-index calculation
- ViewportCenter type for positioning parameter

## Out of Scope
- Sequence diagram editor (participants/messages/fragments) - planned for later increment
- Canvas rendering changes beyond placing standard nodes
- Advanced ER attribute authoring inside entity boxes (visual nesting of attributes) - planned for later
- Advanced State/Activity diagram-specific rendering semantics (swimlanes, decision diamonds) - planned for later
- Backend API changes - assumes existing CRUD endpoints for all entity types already exist
- Drag-and-drop placement (click-to-place on canvas) - this increment uses deterministic auto-placement
- Attribute creation for ER entities in this increment
- ActivityFlow edge creation - separate from Activity/Partition entity creation
- StateTransition edge creation - separate from State entity creation
- Inline renaming directly on diagram canvas - use inspector panel instead

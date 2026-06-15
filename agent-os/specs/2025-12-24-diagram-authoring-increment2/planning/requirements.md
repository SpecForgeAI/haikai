# Diagram Type Authoring (Increment 2) - Requirements

## Title
Diagram Type authoring (Increment 2) - Create & place in Diagram View for ER, State, Activity

## Intent
- Extend the Diagram View RHS panel to support "Create & place" workflows for diagram types where users typically author elements in-context:
    - ER: create Logical/Physical Entity (and optionally Attributes) and immediately place on the diagram
    - State: create State and immediately place on the diagram
    - Activity: create ActivityPartition and Activity and immediately place on the diagram
- Keep the meta-model clean:
    - creation still persists via existing backend CRUD endpoints (no diagram-only shadow entities)
    - diagram nodes reference the created meta-model records by refKind/refId
- Provide a minimal, consistent UX for inline creation and light editing without turning Diagram View into a full meta-model editor.

## Scope

### In Scope
- frontend Diagram View:
    - RHS panel additions ("Create" actions) for ER/State/Activity diagrams
    - create-and-place flow (call backend -> update context -> add node)
    - selection inspector for editing basic fields of created entities (name/description + key fields)
- backend:
    - none required if CRUD endpoints for entities already exist (LogicalEntity/PhysicalEntity/Attributes, State, Activity*, ActivityPartition)
    - only add missing endpoints if any are not yet implemented

### Out of Scope
- Sequence diagram editor (participants/messages/fragments) - later increment
- canvas rendering changes beyond placing standard nodes
- advanced ER attribute authoring inside entity boxes (visual nesting) - later
- advanced State/Activity diagram-specific rendering semantics - later

## Acceptance Criteria

### ER diagram
- RHS shows "+ New Logical Entity" and "+ New Physical Entity"
- creating one persists to backend and immediately adds a node to the active diagram

### State diagram
- RHS shows "+ New State"
- creating one persists and immediately adds a node to the active diagram

### Activity diagram
- RHS shows "+ New Partition" and "+ New Activity"
- creating one persists and immediately adds a node to the active diagram

### General
- Newly created items appear:
    - in the diagram canvas
    - in the Meta-Model tables (via shared architecture context state) without requiring a full reload
- Selection inspector allows editing:
    - name + description (all created entities)
    - State.kind (Initial/Normal/Final)
    - Activity.kind (Initial/Action/Decision/Merge/Final)
    - Partition binding fields (refKind/refId optional, name optional rules)
- No regressions to existing "place existing" palette behaviour.

## Frontend Design (High Level)

### RHS Panel Structure
For ER/State/Activity diagrams, the panel gets two sections:
1. **Create (new)** - small buttons for diagram-relevant entities
2. **Add existing** - current palette list (filtered by diagram type) remains

### Create Modal/Drawer Pattern
Clicking a "+ New ..." button opens a lightweight form (drawer preferred, modal acceptable):
- required fields only
- optional description
- type-specific fields (stateKind/activityKind, partition binding)

**Primary action:** "Create & Add"
- calls backend create endpoint
- updates ArchitectureContext entity list
- adds a diagram node referencing the new entity
- selects the new node (so inspector shows)

**Secondary action:** "Cancel"

### Placement Behaviour
Add node at a deterministic default position:
- near the viewport center OR
- cascade placement with offsets (e.g. +40px x/y each create) to avoid overlap
- do not ask the user to click on canvas for placement in this increment

### Selection Inspector
When a node is selected:
- show minimal editable fields based on refKind
- save on blur or explicit "Save" button (use existing update endpoints)
- not required for create flow to work, but improves UX and prevents forcing users back to Meta-Model tables

## Frontend Implementation Steps

### A) Add Create buttons per diagram type
file(s): Diagram RHS panel component(s) (e.g. PalettePanel/DiagramSidebar)

- If activeDiagram.type == 'ER':
    show buttons:
    - + New Logical Entity
    - + New Physical Entity
    (optional bonus in this increment, if low effort):
    - when a Logical/Physical Entity node is selected, show:
        + New Attribute (Logical/Physical depending on entity)
    otherwise omit attributes for increment 2.

- If activeDiagram.type == 'State':
    show button:
    - + New State

- If activeDiagram.type == 'Activity':
    show buttons:
    - + New Partition
    - + New Activity

### B) Implement create forms and submit handlers
Create reusable component:
```
CreateAndPlaceDrawer
  props:
    - title
    - fields schema
    - onSubmit(createPayload) -> Promise<createdEntity>
```

**ER forms:**
1. Logical Entity:
    - name (required)
    - description (optional)
2. Physical Entity:
    - name (required)
    - description (optional)

**State form:**
- name (required)
- stateKind (dropdown required: Initial | Normal | Final)
- description (optional)

**Activity form:**
- name (required)
- activityKind (dropdown required: Initial | Action | Decision | Merge | Final)
- description (optional)

**Partition form (latest agreement):**
- refKind (optional dropdown: BusinessUser | Application | ApplicationComponent | Service | Interface | Class)
- refId (optional; required if refKind set; fk typeahead if feasible else text)
- name (optional)
  rule:
    - if refKind+refId provided, name may be blank (display name derives later)
    - if refKind not provided, name is required
- description (optional)

### C) API calls + state updates
Use existing frontend API clients (or add if missing):
- createLogicalEntity(...)
- createPhysicalEntity(...)
- createState(...)
- createActivity(...)
- createActivityPartition(...)

After create succeeds:
1. update ArchitectureContext entity list for that type (append created row)
2. add diagram node to active diagram:
    ```
    node = {
      id: new uuid,
      refKind: <entity kind>,
      refId: created.id,
      position: defaultPosition(),
      ...existing node fields (size/label handled by existing code)
    }
    ```
3. persist diagram update using existing diagram save flow (if you already save on every edit, keep consistent)

### D) Selection Inspector (minimal editing)
When a node with refKind in {LogicalEntity, PhysicalEntity, State, Activity, ActivityPartition} is selected:
- show editable fields and save via update endpoints:
    - name/description (all; partition name optional)
    - stateKind (State)
    - activityKind (Activity)
    - partition refKind/refId/name rules (Partition)
- Ensure inspector edits update ArchitectureContext list so Meta-Model tables reflect changes.

### E) Keep "Add existing" palette unchanged
- Existing list remains and continues to allow adding existing items.

## Backend Notes / Gap Check
- This increment assumes backend CRUD endpoints already exist for:
    - Logical Entities / Physical Entities / Attributes (if attributes included)
    - State
    - Activity
    - ActivityPartition
- If any endpoint is missing, add it in the same style as existing meta-model CRUD:
    POST /api/model-files/{modelFileId}/{entity-plural}
- No schema changes expected in Increment 2.

## Tests / Verification

### Manual
- Create ER diagram:
    - click + New Logical Entity -> Create & Add
    - confirm node appears on canvas
    - confirm entity appears in Meta-Model Logical Entities table
- Create State diagram:
    - + New State -> Create & Add
    - confirm node appears + shows stateKind in inspector
- Create Activity diagram:
    - + New Partition -> Create & Add (name-only)
    - + New Activity -> Create & Add
    - confirm both appear and are editable in inspector
- Verify no regressions to General diagram behaviour and palette.

### Non-functional
- No UI crashes when switching diagram types/domains.
- Created entities persist after page reload (backend state).

## Deliverables
- Diagram View supports in-context authoring for ER, State, Activity via Create & Place.
- Entities are persisted to the meta-model and immediately placed on the diagram.
- Minimal inspector enables basic attribute edits without leaving Diagram View.

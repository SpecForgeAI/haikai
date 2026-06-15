# Specification: Diagram Creation UX for Empty Models

## Goal
Improve the Diagram view user experience when working with new or empty models by:
1. Adding a clear way to create the first diagram via a name input and [+ New] button in the top toolbar
2. Blocking palette additions with a helpful warning message when no diagram exists

## User Stories
- As a user opening an empty model, I want to see a clear way to create my first diagram so that I can start adding content immediately.
- As a user, when I try to add items from the palette without a diagram, I want to see a helpful message explaining what I need to do first.

## Current Behaviour (Problems)

When a JSON file has no diagrams:
- The Diagram view shows "No diagrams defined in this model"
- The right-hand palette still shows meta-model entities (Business Processes, Applications, etc.)
- There is no obvious way to create a first diagram from this view
- Clicking palette items does nothing (no feedback)

## Specific Requirements

### 1. Top Bar: Diagram Name Input + [+ New] Button

**1.1 Controls Layout**

In the Diagram view header, always reserve a standard area for diagram selection/creation:

```
Diagram: [ diagram selector OR placeholder ] [ Name input ] [ + New ] [ existing controls... ]
```

**1.2 When No Diagrams Exist**

- Hide or disable the diagram dropdown (or show a disabled "No diagrams defined" placeholder)
- Show a **text input** for the new diagram name
  - Placeholder text: `"Enter diagram name..."`
- Show a **[+ New]** button next to the input
- The canvas shows the existing "No diagrams defined in this model" message until a diagram is created

**1.3 When Diagrams Exist**

- The existing dropdown/select for diagrams remains as today
- The **Name input + [+ New]** controls remain visible for adding additional diagrams
  - Name input placeholder: `"Enter new diagram name..."`
  - [+ New]: creates another diagram with that name

**1.4 New Diagram Creation Flow**

When the user types a name and clicks **[+ New]**:

1. **Validate:**
   - Name must be non-empty
   - (Optional for v0.x) Name uniqueness check - if duplicate, show warning or allow with conscious choice

2. **If validation passes:**
   - Create a new diagram object:
     ```json
     {
       "id": "<generated uuid>",
       "name": "<user-entered name>",
       "description": "",
       "diagram_type": null,
       "settings": {},
       "diagram_nodes": [],
       "diagram_edges": [],
       "decorations": []
     }
     ```
   - Append to `diagrams[]` array
   - Set as the **currently selected** diagram:
     - Update the diagram dropdown to select it
     - Clear the "No diagrams defined" message
     - Show an empty canvas ready for editing
   - Clear the name input field

3. **If name is empty:**
   - Do not create a diagram
   - Show inline error or toast: `"Please enter a diagram name before creating a new diagram."`

### 2. Block Palette Actions When No Diagram Exists

**2.1 Detection Condition**

Define "diagram is active" as:
- `diagrams[]` is non-empty AND
- There is a valid `selectedDiagramId`

When this condition is **false**, there is no active diagram.

**2.2 Palette Interactions When No Active Diagram**

When the user attempts to add items without an active diagram:

- **Left-click** on a palette item (to add to canvas)
- **Right-click** context menu actions ("Add", "Add with business processes", "Add with app components", etc.)

**Action:**
- Do NOT attempt to add anything to the canvas
- Show a clear warning message (modal or toast):
  ```
  Add a new diagram before trying to add items.
  ```

**2.3 Normal Behaviour Once Diagram Exists**

Once at least one diagram exists and is selected:
- Palette behaviour returns to normal
- Left-click / context menu actions add nodes/edges/decorations to the currently selected diagram
- Warning is no longer shown

## Implementation Approach

### Phase 1: Add Top Bar Controls

**DiagramsView.tsx or Header Component:**
- Add state for `newDiagramName` input value
- Add text input component with placeholder
- Add [+ New] button with click handler
- Implement `handleCreateDiagram()`:
  - Validate name is non-empty
  - Generate UUID for new diagram
  - Dispatch action to create diagram (e.g., `ADD_DIAGRAM`)
  - Set as selected diagram
  - Clear input

**ArchitectureContext.tsx:**
- Add `ADD_DIAGRAM` action to reducer
- Handle appending new diagram to `diagrams[]`
- Set `selectedDiagramId` to new diagram's ID

### Phase 2: Block Palette Actions

**PalettePanel.tsx or PaletteItem.tsx:**
- Check if `selectedDiagramId` is valid and diagram exists
- If no active diagram:
  - On left-click: show warning instead of adding
  - Pass prop to disable add functionality

**PaletteContextMenu.tsx:**
- Check for active diagram before executing add actions
- If no active diagram: show warning, abort action

**Warning Display:**
- Use existing modal/toast pattern
- Message: "Add a new diagram before trying to add items."

## Existing Code to Leverage

**DiagramsView.tsx - Main View Component**
- Contains diagram selector dropdown
- Add input + button to existing header layout

**ArchitectureContext.tsx - State Management**
- `selectedDiagramId` state already exists
- Add new `ADD_DIAGRAM` action case

**PalettePanel.tsx / PaletteItem.tsx - Palette Components**
- Contains click handlers for adding items
- Add active diagram check before add operations

**PaletteContextMenu.tsx - Context Menu**
- Contains "Add" action handlers
- Add active diagram check before add operations

**Modal.tsx - Warning Display**
- Existing modal patterns for displaying messages

## Visual Design

**Top Bar Layout (no diagrams):**
```
┌─────────────────────────────────────────────────────────────────┐
│ Diagram: [No diagrams defined ▼] [Enter diagram name...] [+ New]│
└─────────────────────────────────────────────────────────────────┘
```

**Top Bar Layout (with diagrams):**
```
┌─────────────────────────────────────────────────────────────────┐
│ Diagram: [Architecture Overview ▼] [Enter new name...] [+ New] │
└─────────────────────────────────────────────────────────────────┘
```

**Warning Message (modal/toast):**
```
┌────────────────────────────────────────┐
│  Add a new diagram before trying to    │
│  add items.                            │
│                              [OK]      │
└────────────────────────────────────────┘
```

## Acceptance Criteria

**Empty Model Experience:**
- [ ] When tool opens with empty JSON (no diagrams), the Diagram view top bar shows:
  - A text input for new diagram name with placeholder "Enter diagram name..."
  - A [+ New] button
- [ ] Right-hand palette lists meta-model entities but cannot add them yet
- [ ] Attempting to add from palette (left-click) shows warning: "Add a new diagram before trying to add items."
- [ ] Attempting to add from palette context menu shows same warning

**Creating First Diagram:**
- [ ] User enters name and clicks [+ New]
- [ ] New diagram is created and becomes the active diagram
- [ ] Canvas becomes editable (no longer shows "No diagrams defined")
- [ ] Diagram dropdown now lists this diagram
- [ ] Name input is cleared
- [ ] Palette items can now be added to diagram (no warning)

**Creating Additional Diagrams:**
- [ ] When diagrams already exist, name input + [+ New] controls are still visible
- [ ] User can create additional diagrams using same interaction
- [ ] Newly created diagram becomes selected
- [ ] Palette actions operate on currently selected diagram

**Validation:**
- [ ] Empty name shows error: "Please enter a diagram name before creating a new diagram."
- [ ] [+ New] button does nothing if name is empty (except show error)

## Out of Scope

- Diagram name uniqueness enforcement (allow duplicates for v0.x)
- Diagram deletion from this view
- Diagram renaming from this view
- Drag-and-drop diagram reordering
- Diagram templates or presets
- Persisting "last selected diagram" across sessions

# Specification: Diagram Creation and Copy

## Goal
Enable users to create new empty diagrams and copy existing diagrams directly from the Diagrams view UI, with proper name validation and in-memory model persistence.

## User Stories
- As a user, I want to create a new empty diagram from the UI so that I can start building a diagram without manually editing JSON
- As a user, I want to copy an existing diagram so that I can use it as a template for a new diagram with similar content

## Specific Requirements

**Updated Diagram Selector Panel Layout**
- Replace existing panel with horizontal row containing: "Diagram:" label, dropdown, " - New Diagram " text, text input, [+ New] button, [+ Copy] button
- All elements must sit on the same horizontal row without wrapping
- Text input should be reasonably sized (minimum 150px width) to accommodate typical diagram names
- Use existing Button component styling for visual consistency
- Buttons should use the secondary variant styling to match existing UI patterns

**Name Validation for New Diagrams**
- Trim whitespace from input name before validation
- If input name is empty, show validation error: "Please enter a name for the new diagram."
- If another diagram already has exactly the same name, show validation error: "A diagram with this name already exists. Please choose a different name."
- Do NOT auto-suffix with "(2)" - require explicit unique names for clarity
- Validation errors should be displayed using existing toast/alert pattern or inline message near the input

**Creating Empty Diagram with [+ New] Button**
- Generate unique diagram ID using existing `generatePrefixedId('diag')` pattern from idGenerator.ts
- Create new diagram object with: id (generated), name (from input), description: "", diagram_type: "", settings: {}, diagram_nodes: [], diagram_edges: []
- Push new diagram to in-memory diagrams[] array via new reducer action
- After creation: select new diagram in dropdown, clear canvas (empty diagram), clear text input field
- The dropdown must immediately reflect the new diagram name

**Copying Diagram with [+ Copy] Button**
- Apply same name validation as [+ New]: empty name error, duplicate name error
- Create deep copy of currently selected diagram with new ID and name from input
- Deep copy must include: all settings, all diagram_nodes (including all properties), all diagram_edges (including edge_points arrays)
- Preserve original description (do not prefix with "Copy" - keep it simple)
- Node/edge/edge_point IDs do not need regeneration since IDs only need to be unique within a diagram
- After creation: select copied diagram in dropdown, render the copied content on canvas, clear text input field

**New Reducer Actions**
- Add `ADD_DIAGRAM` action type to AppAction union in ArchitectureContext.tsx
- Action payload should contain the complete Diagram object to add
- Reducer should push diagram to diagrams[] array and set it as selectedDiagramId
- Ensure immutable state updates following existing reducer patterns

**Model Persistence**
- All diagrams[] changes from [+ New] and [+ Copy] must be in-memory and included in Save JSON output
- Load JSON continues to work as before - these features build on existing structure
- No changes needed to fileOperations.ts load logic

**Clear Input After Success**
- Clear the "New Diagram" text input field after successful creation or copy
- This provides clear feedback that operation completed and prepares for next operation

## Visual Design

No visual mockups provided. Follow existing DiagramsView header bar styling patterns:
- Header bar uses flexbox with space-between layout
- Left side contains diagram selector elements
- Existing gap of 12px between selector elements
- Input and button styles should match existing `.selector` and `.fitButton` patterns

## Existing Code to Leverage

**DiagramSelector.tsx**
- Current component renders only dropdown select element
- Uses `useArchitecture()` and `useArchitectureDispatch()` hooks
- Dispatches `SELECT_DIAGRAM` action on selection change
- Must be expanded to include text input and buttons, or new sibling component created

**ArchitectureContext.tsx**
- Contains all reducer actions and state management
- `AppAction` union type needs new `ADD_DIAGRAM` action
- Reducer `appReducer` needs new case to handle diagram addition
- Follow existing patterns like `ADD_ENTITY` for immutable state updates
- Set `selectedDiagramId` to new diagram ID after adding

**idGenerator.ts**
- `generatePrefixedId('diag')` generates unique diagram IDs
- Already has 'diagrams' prefix mapped in `getEntityPrefix`
- Use this for consistent ID generation across the application

**Button.tsx and Button.module.css**
- Reusable Button component with variant props (primary, secondary, danger)
- Use secondary variant for [+ New] and [+ Copy] buttons to match existing UI style
- Provides consistent styling and hover states

**DiagramsView.module.css**
- Contains `.selector` class for dropdown styling (padding, border, border-radius, min-width)
- Contains `.selectorContainer` with gap spacing and alignment
- Add new CSS classes for text input and action buttons following same patterns

## Out of Scope
- Auto-generating unique names with suffixes like "(2)" - require explicit unique names instead
- Regenerating node/edge/edge_point IDs within copied diagrams
- Undo/redo functionality for diagram creation or copy
- Keyboard shortcuts for create/copy operations
- Confirmation dialogs before creation
- Diagram deletion from UI (future feature)
- Renaming existing diagrams from UI (future feature)
- Drag-and-drop reordering of diagrams in dropdown
- Multi-select or bulk operations on diagrams
- Toast notification system (use simple alert or inline error messages)

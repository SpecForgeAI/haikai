# Task Breakdown: Architecture Capture & Diagram Tool v0.1

## Overview
Total Tasks: 14 Task Groups (47 primary tasks)

This task list breaks down the implementation of a React/TypeScript single-page application for enterprise architecture meta-model capture and diagram rendering.

---

## Task List

### Foundation Layer

#### Task Group 1: Project Setup & Configuration
**Dependencies:** None
**Estimated Effort:** M (2-3 hours)

- [x] 1.0 Complete project setup and configuration
  - [x] 1.1 Initialize Vite project with React 18.x + TypeScript 5.x
    - Run `npm create vite@latest frontend -- --template react-ts`
    - Configure TypeScript strict mode in `tsconfig.json`
    - Set up path aliases for clean imports
  - [x] 1.2 Configure project structure
    - Create directory structure per spec (components, contexts, types, utils, config)
    - Set up CSS Modules configuration
    - Create index files for barrel exports
  - [x] 1.3 Create configuration defaults
    - Files: `frontend/src/config/defaults.ts`
    - Define AppConfig interface and default values
    - Define entity colors, dropdown options
    - Define zoom levels, canvas dimensions, node/edge styling constants
  - [x] 1.4 Set up development environment
    - Configure ESLint and Prettier
    - Add development scripts to package.json
    - Verify hot reload works correctly

**Acceptance Criteria:**
- Project builds without errors
- TypeScript strict mode enabled
- All directories created per spec file structure
- Configuration constants accessible throughout app

---

### Data Model Layer

#### Task Group 2: TypeScript Types & Data Model
**Dependencies:** Task Group 1
**Estimated Effort:** S (1-2 hours)

- [x] 2.0 Complete TypeScript type definitions
  - [x] 2.1 Create base entity types
    - Files: `frontend/src/types/model.ts`
    - Define BusinessUser, BusinessProcess interfaces
    - Define LogicalDataEntity interface
  - [x] 2.2 Create application domain types
    - Define Application, ApplicationComponent, Service, ApplicationPoint interfaces
    - Include all fields with proper types (string, boolean, number)
  - [x] 2.3 Create data domain types
    - Define PhysicalDataEntity, Attribute interfaces
    - Define RelationshipType union type
    - Define Relationship interface
  - [x] 2.4 Create diagram structure types
    - Define Diagram, DiagramNode, DiagramEdge, EdgePoint interfaces
    - Ensure proper nullable types for parent_node_id
  - [x] 2.5 Create root ArchitectureModel interface
    - Aggregate all entity arrays
    - Include all diagram structure arrays
  - [x] 2.6 Create configuration types
    - Files: `frontend/src/types/config.ts`
    - Define AppConfig interface
    - Define ValidationError interface
    - Define GridColumnConfig type

**Acceptance Criteria:**
- All 10 entity types defined with correct fields
- All 4 diagram structures defined
- ArchitectureModel root interface complete
- No TypeScript errors in type definitions
- Types match spec section 3 exactly

---

### State Management Layer

#### Task Group 3: State Management & Context
**Dependencies:** Task Group 2
**Estimated Effort:** M (2-3 hours)

- [x] 3.0 Complete state management implementation
  - [x] 3.1 Define AppState interface
    - Files: `frontend/src/contexts/ArchitectureContext.tsx`
    - Include model, currentView, selectedTab, selectedDiagramId
    - Include loadedFileName, validationErrors
  - [x] 3.2 Define action types
    - Create AppAction union type
    - Actions: LOAD_MODEL, SET_VIEW, SELECT_TAB, SELECT_DIAGRAM
    - Actions: UPDATE_ENTITY, ADD_ENTITY, DELETE_ENTITY
    - Actions: SET_VALIDATION_ERRORS
  - [x] 3.3 Implement reducer function
    - Handle all action types
    - Ensure immutable state updates
    - Return empty model structure for initial state
  - [x] 3.4 Create Context provider component
    - Create ArchitectureProvider component
    - Initialize with empty ArchitectureModel
    - Expose dispatch and state via context
  - [x] 3.5 Create custom hooks for state access
    - Create useArchitecture() hook
    - Create useArchitectureDispatch() hook
    - Add type safety for context consumers
  - [x] 3.6 Create utility functions for ID generation
    - Files: `frontend/src/utils/idGenerator.ts`
    - Implement UUID generation or incrementing pattern
    - Ensure uniqueness within entity type

**Acceptance Criteria:**
- Context provider wraps entire app
- State persists across view switches
- Reducer handles all defined actions
- Custom hooks provide typed access to state
- New entities get auto-generated unique IDs

---

### Application Shell

#### Task Group 4: Top Navigation Bar
**Dependencies:** Task Group 3
**Estimated Effort:** M (2-3 hours)

- [x] 4.0 Complete top navigation bar implementation
  - [x] 4.1 Create TopBar component structure
    - Files: `frontend/src/components/TopBar/TopBar.tsx`, `TopBar.module.css`
    - Fixed position, 60px height
    - White background with subtle bottom border
  - [x] 4.2 Implement logo/title section
    - Left-aligned "Architecture Tool" text
    - Apply appropriate typography
  - [x] 4.3 Implement view toggle buttons
    - Center-aligned "Meta-model" and "Diagrams" buttons
    - Active state styling (distinct highlight)
    - Connect to SET_VIEW action
  - [x] 4.4 Implement file name display
    - Show currently loaded filename
    - Default to "Untitled" for new models
    - Update when file is loaded
  - [x] 4.5 Implement Load/Save button placeholders
    - Create Load JSON button (right side)
    - Create Save JSON button (right side)
    - Wire up to file operation utilities (Task Group 9)

**Acceptance Criteria:**
- Top bar always visible
- View toggle switches main content area
- Active view clearly indicated
- Filename displays correctly
- Buttons positioned per spec layout

---

### Meta-model View

#### Task Group 5: Meta-model View - Tab Bar
**Dependencies:** Task Group 4
**Estimated Effort:** S (1-2 hours)

- [x] 5.0 Complete meta-model tab bar implementation
  - [x] 5.1 Create MetaModelView container
    - Files: `frontend/src/components/MetaModelView/MetaModelView.tsx`, `MetaModelView.module.css`
    - Tab bar at top
    - Grid fills remaining vertical space
  - [x] 5.2 Create TabBar component
    - Files: `frontend/src/components/MetaModelView/TabBar.tsx`
    - 10 tabs in spec order: Users, Processes, Applications, App Components, Services, Application Points, Logical Entities, Physical Entities, Attributes, Relationships
  - [x] 5.3 Implement tab selection
    - Click to select tab
    - Active tab styling
    - Connect to SELECT_TAB action
  - [x] 5.4 Map tabs to entity types
    - Create mapping from tab name to entity array key
    - Pass selected entity type to Grid component

**Acceptance Criteria:**
- All 10 tabs display in correct order
- Tab selection changes displayed grid
- Active tab visually distinguished
- Tabs positioned horizontally below top bar

---

#### Task Group 6: Grid Component - Core
**Dependencies:** Task Group 5
**Estimated Effort:** L (3-4 hours)

- [x] 6.0 Complete core grid component implementation
  - [x] 6.1 Create Grid component structure
    - Files: `frontend/src/components/Grid/Grid.tsx`, `Grid.module.css`
    - Toolbar with Add Row and Delete Row buttons
    - Header row with column names
    - Scrollable body for data rows
  - [x] 6.2 Define grid column configurations
    - Files: `frontend/src/config/gridConfigs.ts`
    - Configuration for each entity type's columns
    - Include: field name, display name, cell type, required flag, width
  - [x] 6.3 Implement row rendering
    - Map entity array to rows
    - Apply fixed column widths
    - Default row height: 36px
  - [x] 6.4 Implement row selection
    - Single row selection on click
    - Selected row background highlight
    - Track selected row ID in local state
  - [x] 6.5 Implement Add Row functionality
    - Create new entity with auto-generated ID
    - Dispatch ADD_ENTITY action
    - Focus first editable cell
    - Initialize optional fields with defaults
  - [x] 6.6 Implement Delete Row functionality
    - Delete selected row on button click
    - Dispatch DELETE_ENTITY action
    - Clear selection after delete
    - Disable button when no row selected
  - [x] 6.7 Handle empty grid state
    - Show column headers with no rows
    - Add Row button always available

**Acceptance Criteria:**
- Grid displays entity data in rows/columns
- Row selection works with visual feedback
- Add Row creates entity with unique ID
- Delete Row removes selected entity
- Empty grids display correctly

---

#### Task Group 7: Grid Component - Cell Types
**Dependencies:** Task Group 6
**Estimated Effort:** L (4-5 hours)

- [x] 7.0 Complete grid cell type implementations
  - [x] 7.1 Create GridCell wrapper component
    - Files: `frontend/src/components/Grid/GridCell.tsx`
    - Route to appropriate cell type based on config
    - Handle edit mode toggle
  - [x] 7.2 Implement Text Input cell
    - Click to enter edit mode
    - Enter to confirm, Escape to cancel
    - Tab moves to next cell
    - Dispatch UPDATE_ENTITY on confirm
  - [x] 7.3 Implement Tags Input cell
    - Same behavior as text input
    - Store as comma-separated string
    - Display as plain text
  - [x] 7.4 Implement Boolean Toggle cell
    - Render checkbox
    - Click to toggle value immediately
    - No separate edit mode needed
  - [x] 7.5 Implement Dropdown cell
    - Render select element
    - Options from configuration
    - Change dispatches UPDATE_ENTITY
  - [x] 7.6 Implement FK Typeahead cell
    - Files: `frontend/src/components/Grid/TypeaheadCell.tsx`
    - Text input with autocomplete dropdown
    - Filter entities as user types
    - Show max 10 matching results
    - Display entity name, store entity ID
    - Support different FK targets per entity type

**Acceptance Criteria:**
- Text cells support inline editing with keyboard navigation
- Tags stored as comma-separated strings
- Boolean cells render as checkboxes
- Dropdown cells show configured options
- Typeahead filters and shows matching entities
- All cell types dispatch UPDATE_ENTITY correctly

---

#### Task Group 8: Grid Component - Validation
**Dependencies:** Task Group 7
**Estimated Effort:** M (2-3 hours)

- [x] 8.0 Complete grid validation implementation
  - [x] 8.1 Create validation utility functions
    - Files: `frontend/src/utils/validation.ts`
    - validateRequiredFields() - check for empty required fields
    - validateFKReferences() - check FK references exist
    - validateUniqueIds() - check for duplicate IDs
  - [x] 8.2 Implement required field validation display
    - Highlight empty required fields with red border
    - Tooltip: "This field is required"
    - Run on blur and on cell edit
  - [x] 8.3 Implement FK reference validation display
    - Highlight invalid FK references in red
    - Tooltip: "Referenced entity not found"
    - Re-validate when target entity deleted
  - [x] 8.4 Implement duplicate ID validation display
    - Highlight duplicate IDs in red
    - Tooltip: "Duplicate ID"
  - [x] 8.5 Implement Relationship grid special behavior
    - Filter source/target typeahead by relationship_type
    - Update filters when relationship_type changes
    - Use relationship type constraints from spec
  - [x] 8.6 Aggregate validation state
    - Track all validation errors in context
    - Update SET_VALIDATION_ERRORS action
    - Block save when errors exist

**Acceptance Criteria:**
- Required fields show red border when empty
- Invalid FK references highlighted with tooltip
- Duplicate IDs detected and highlighted
- Relationship grid filters source/target by type
- Validation errors prevent model save

---

### File Operations

#### Task Group 9: JSON Load/Save Operations
**Dependencies:** Task Group 8
**Estimated Effort:** L (3-4 hours)

- [x] 9.0 Complete JSON file operations
  - [x] 9.1 Create file operation utilities
    - Files: `frontend/src/utils/fileOperations.ts`
    - parseJSON() - parse with error handling
    - serializeModel() - convert to formatted JSON
  - [x] 9.2 Implement Load JSON flow
    - Open file picker (accept: .json)
    - Read file content via FileReader
    - Parse JSON with try/catch
    - Call validation functions
    - Dispatch LOAD_MODEL on success
  - [x] 9.3 Implement load validation
    - Validate JSON syntax
    - Validate all required arrays present
    - Validate required fields on entities
    - Validate all FK references
    - Validate no duplicate IDs
  - [x] 9.4 Create error modal component
    - Files: `frontend/src/components/common/Modal.tsx`
    - Display error messages
    - OK button to dismiss
    - Show specific error types per spec
  - [x] 9.5 Implement Save JSON flow
    - Run full validation
    - If errors, show modal with error list
    - If valid, serialize to JSON (2-space indent)
    - Trigger browser download
  - [x] 9.6 Handle filename logic
    - Track loaded filename in state
    - Save with original filename
    - Default to "architecture-model.json" for new models
  - [x] 9.7 Wire up TopBar buttons
    - Connect Load button to file picker
    - Connect Save button to save flow

**Acceptance Criteria:**
- Can load valid JSON files
- Invalid JSON shows specific error messages
- All validation errors listed in modal
- Save produces properly formatted JSON
- Filename logic works correctly
- Round-trip preserves all data

---

### Diagrams View

#### Task Group 10: Diagrams View - Canvas
**Dependencies:** Task Group 3
**Estimated Effort:** M (2-3 hours)

- [x] 10.0 Complete diagrams view canvas setup
  - [x] 10.1 Create DiagramsView container
    - Files: `frontend/src/components/DiagramsView/DiagramsView.tsx`, `DiagramsView.module.css`
    - Diagram selector at top
    - Canvas fills remaining space
    - Zoom controls overlay
  - [x] 10.2 Create DiagramSelector component
    - Files: `frontend/src/components/DiagramsView/DiagramSelector.tsx`
    - Dropdown with diagram names
    - "No diagrams defined" message when empty
    - Dispatch SELECT_DIAGRAM on change
  - [x] 10.3 Create Canvas component
    - Files: `frontend/src/components/DiagramsView/Canvas.tsx`
    - SVG or HTML5 Canvas element
    - Default size: 2000x2000px (configurable)
    - Origin (0,0) at top-left
  - [x] 10.4 Implement canvas navigation
    - Scrollable within viewport OR drag-to-pan
    - Basic scroll bars for overflow

**Acceptance Criteria:**
- Diagram selector shows all diagrams
- Canvas renders at correct size
- Empty state shows appropriate message
- Canvas is scrollable or pannable

---

#### Task Group 11: Diagrams View - Node Rendering
**Dependencies:** Task Group 10
**Estimated Effort:** L (3-4 hours)

- [x] 11.0 Complete node rendering implementation
  - [x] 11.1 Create rendering utility functions
    - Files: `frontend/src/utils/rendering.ts`
    - getEntityLabel() - get entity name from ID
    - getEntityColor() - get colors by entity type
    - measureTextWidth() - calculate text dimensions
  - [x] 11.2 Implement basic node rendering
    - Rectangle with 4px rounded corners
    - 2px solid border
    - Label centered horizontally, 8px top padding
    - Apply entity-type colors from config
  - [x] 11.3 Implement node size calculation
    - Minimum size: 60x40px
    - Label-based width calculation
    - Apply auto-size algorithm from spec
  - [x] 11.4 Implement containment rendering
    - Bottom-up traversal for parent sizing
    - Children rendered inside parent bounds
    - 10px padding around children
  - [x] 11.5 Implement rendering order
    - Parent background and border first
    - Parent label second
    - Child nodes recursively
    - Apply proper z-ordering

**Acceptance Criteria:**
- Nodes render at correct positions
- Entity-type colors applied correctly
- Labels display entity names
- Child nodes render inside parents
- Auto-sizing works for containers

---

#### Task Group 12: Diagrams View - Edge Rendering
**Dependencies:** Task Group 11
**Estimated Effort:** M (2-3 hours)

- [x] 12.0 Complete edge rendering implementation
  - [x] 12.1 Implement polyline edge rendering
    - Draw line segments following edge_points
    - If no edge_points, draw straight line
    - 2px line width
    - Color by relationship type
  - [x] 12.2 Implement connection point calculation
    - Connect to center of source/target nodes
    - Or nearest edge point
  - [x] 12.3 Implement arrowhead rendering
    - Triangle at target end
    - 8px size
    - Point in direction of final segment
  - [x] 12.4 Implement edge labels (optional)
    - Relationship type abbreviation at midpoint
    - White background with slight opacity
    - 10px font size
  - [x] 12.5 Validate entity references
    - Check diagram nodes reference valid entities
    - Show error dialog if invalid
    - Prevent diagram render with invalid references

**Acceptance Criteria:**
- Edges render as polylines
- Arrowheads point to target
- Relationship colors applied
- Invalid references show error and prevent render
- Edge points followed correctly

---

#### Task Group 13: Diagrams View - Zoom & Navigation
**Dependencies:** Task Group 12
**Estimated Effort:** M (2-3 hours)

- [x] 13.0 Complete zoom and navigation implementation
  - [x] 13.1 Create ZoomControls component
    - Files: `frontend/src/components/DiagramsView/ZoomControls.tsx`
    - Position: bottom-right overlay
    - [-] and [+] buttons
    - Current zoom percentage display
    - "Fit to View" button
  - [x] 13.2 Implement zoom state management
    - Local state for current zoom level
    - Min: 25%, Max: 200%, Default: 100%
    - Steps: 25% increments
  - [x] 13.3 Implement button zoom controls
    - [-] decreases by one step
    - [+] increases by one step
    - Clamp to min/max
  - [x] 13.4 Implement scroll wheel zoom
    - Scroll up to zoom in
    - Scroll down to zoom out
    - Zoom centers on mouse cursor
  - [x] 13.5 Implement Fit to View
    - Calculate bounding box of all nodes
    - Set zoom and pan to show all content
    - Add padding around content

**Acceptance Criteria:**
- Zoom buttons change zoom level
- Zoom percentage displays correctly
- Scroll wheel zooms at cursor position
- Fit to View shows all diagram content
- Zoom respects min/max limits

---

### Integration & Finalization

#### Task Group 14: Integration & Testing
**Dependencies:** Task Groups 1-13
**Estimated Effort:** L (3-4 hours)

- [x] 14.0 Complete integration and testing
  - [x] 14.1 Integrate all components in App.tsx
    - Files: `frontend/src/App.tsx`
    - Wrap with ArchitectureProvider
    - Conditional rendering of views
    - TopBar always visible
  - [x] 14.2 Create common UI components
    - Files: `frontend/src/components/common/Button.tsx`
    - Consistent button styling
    - Variants: primary, secondary, danger
  - [x] 14.3 Test meta-model CRUD operations
    - Add/edit/delete for each entity type
    - Verify FK typeahead filtering
    - Verify validation highlighting
  - [x] 14.4 Test JSON round-trip
    - Load sample JSON
    - Make edits
    - Save and reload
    - Verify no data loss
  - [x] 14.5 Test diagram rendering
    - Verify node positions and sizes
    - Verify containment hierarchy
    - Verify edge routing
    - Test zoom and pan
  - [x] 14.6 Test error handling
    - Invalid JSON files
    - Missing required fields
    - Invalid FK references
    - Duplicate IDs
  - [x] 14.7 Create sample data file
    - Files: `frontend/public/sample-architecture.json`
    - Include entities of each type
    - Include sample diagram with nodes/edges
    - Use for testing and demo

**Acceptance Criteria:**
- All views integrated and switching works
- State persists across view changes
- All entity types support full CRUD
- JSON load/save works without data loss
- Diagrams render correctly with zoom/pan
- All validation errors display correctly
- Sample data demonstrates all features

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1**: Project Setup & Configuration
2. **Task Group 2**: TypeScript Types & Data Model
3. **Task Group 3**: State Management & Context
4. **Task Group 4**: Top Navigation Bar
5. **Task Group 5**: Meta-model View - Tab Bar
6. **Task Group 6**: Grid Component - Core
7. **Task Group 7**: Grid Component - Cell Types
8. **Task Group 8**: Grid Component - Validation
9. **Task Group 9**: JSON Load/Save Operations
10. **Task Group 10**: Diagrams View - Canvas
11. **Task Group 11**: Diagrams View - Node Rendering
12. **Task Group 12**: Diagrams View - Edge Rendering
13. **Task Group 13**: Diagrams View - Zoom & Navigation
14. **Task Group 14**: Integration & Testing

---

## Effort Summary

| Size | Count | Description |
|------|-------|-------------|
| XS | 0 | < 1 hour |
| S | 2 | 1-2 hours |
| M | 7 | 2-3 hours |
| L | 5 | 3-5 hours |
| XL | 0 | > 5 hours |

**Total Estimated Effort:** 35-50 hours

---

## Risk Areas

1. **FK Typeahead Performance**: May need optimization for large datasets
2. **Canvas Rendering**: Auto-size algorithm complexity for deep containment hierarchies
3. **Zoom at Cursor**: Requires careful coordinate transformation math
4. **Validation Timing**: Balance between responsive validation and performance

---

## Key Files Summary

### Types
- `frontend/src/types/model.ts` - All entity and diagram interfaces
- `frontend/src/types/config.ts` - Configuration interfaces

### Configuration
- `frontend/src/config/defaults.ts` - App configuration constants
- `frontend/src/config/gridConfigs.ts` - Grid column definitions per entity

### State
- `frontend/src/contexts/ArchitectureContext.tsx` - Global state management

### Utilities
- `frontend/src/utils/validation.ts` - Validation functions
- `frontend/src/utils/fileOperations.ts` - JSON load/save
- `frontend/src/utils/rendering.ts` - Diagram rendering helpers
- `frontend/src/utils/idGenerator.ts` - Unique ID generation

### Components
- `frontend/src/components/TopBar/TopBar.tsx` - Navigation bar
- `frontend/src/components/MetaModelView/MetaModelView.tsx` - Grid view container
- `frontend/src/components/Grid/Grid.tsx` - Reusable grid component
- `frontend/src/components/Grid/TypeaheadCell.tsx` - FK typeahead cell
- `frontend/src/components/DiagramsView/DiagramsView.tsx` - Canvas view container
- `frontend/src/components/DiagramsView/Canvas.tsx` - Diagram canvas
- `frontend/src/components/common/Modal.tsx` - Error/dialog modal

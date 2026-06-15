# Task Breakdown: Diagram Palette Panel

## Overview
Total Task Groups: 6
Estimated Complexity: High (v0.3+ substantial feature)

This feature adds a collapsible right-hand panel to the Diagrams view for browsing and adding meta-model entities to diagrams via click-to-add functionality.

## Task List

### State Management Layer

#### Task Group 1: State and Reducer Foundation
**Dependencies:** None

- [x] 1.0 Complete state management foundation
  - [x] 1.1 Write 2-8 focused tests for state management
    - Test ADD_DIAGRAM_NODE reducer action creates node correctly
    - Test ADD_DIAGRAM_NODE prevents duplicate entity additions
    - Test ADD_DIAGRAM_NODE updates diagram nodes array immutably
    - Test node ID generation uses correct prefix pattern
    - Skip exhaustive coverage of all node properties and edge cases
  - [x] 1.2 Add palette panel state to AppState interface
    - Add isPalettePanelCollapsed: boolean field to AppState in ArchitectureContext.tsx
    - Add sectionExpandStates: Record<string, boolean> to track section collapse state
    - Add paletteSearchQuery: string for search filter text
    - Default isPalettePanelCollapsed to false (expanded by default)
  - [x] 1.3 Create new action types for palette operations
    - Add TOGGLE_PALETTE_PANEL action type to AppAction union
    - Add TOGGLE_PALETTE_SECTION action type with payload: { sectionId: string }
    - Add SET_PALETTE_SEARCH action type with payload: string
    - Add ADD_DIAGRAM_NODE action type with payload: { diagramId: string; node: DiagramNode }
  - [x] 1.4 Implement reducer cases for palette actions
    - TOGGLE_PALETTE_PANEL: flip isPalettePanelCollapsed boolean
    - TOGGLE_PALETTE_SECTION: toggle specific section in sectionExpandStates map
    - SET_PALETTE_SEARCH: update paletteSearchQuery string
    - ADD_DIAGRAM_NODE: add node to diagram's nodes array with duplicate check
  - [x] 1.5 Add node creation helper function
    - Create createDiagramNodeFromEntity() helper in utils/nodeCreation.ts
    - Accept entity_type, entity_id, diagram_id, existing nodes for z_index calculation
    - Use generatePrefixedId('node') from idGenerator.ts for node ID
    - Implement cascading placement logic: center-left base + 30px x/y offset per existing node
    - Return complete DiagramNode object with defaults (parent_node_id: null, style_override: {})
  - [x] 1.6 Ensure state management tests pass
    - Run ONLY the 2-8 tests written in 1.1
    - Verify reducer actions update state correctly
    - Verify node creation helper generates valid nodes
    - Do NOT run entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- State interface includes all palette-related fields
- All reducer actions handle palette state immutably
- Node creation helper generates valid DiagramNode objects with unique IDs
- Duplicate entity check prevents multiple nodes for same entity in diagram

---

### Panel UI Component Layer

#### Task Group 2: Panel Container and Layout
**Dependencies:** Task Group 1

- [x] 2.0 Complete panel container and layout
  - [x] 2.1 Write 2-8 focused tests for panel layout
    - Test PalettePanel component renders when in DiagramsView
    - Test PalettePanel does not render in MetaModelView
    - Test collapse/expand button toggles panel width
    - Test panel width is 300px when expanded, 30px when collapsed
    - Skip exhaustive testing of all layout variations and styling
  - [x] 2.2 Create PalettePanel.tsx component structure
    - Create new file: frontend/src/components/DiagramsView/PalettePanel.tsx
    - Accept props: isCollapsed, onToggleCollapse, metaModel, currentDiagramId
    - Create container div with fixed 300px width (expanded) or 30px (collapsed)
    - Use CSS modules for styling: PalettePanel.module.css
    - Position as flexbox sibling to Canvas component
  - [x] 2.3 Implement collapse/expand toggle button
    - Position chevron button on left edge of panel
    - When expanded: show ">>" or collapse icon
    - When collapsed: show "<<" or expand icon on 30px bar
    - Wire onClick to dispatch TOGGLE_PALETTE_PANEL action
    - Add hover state for visual feedback
  - [x] 2.4 Integrate PalettePanel into DiagramsView.tsx
    - Update DiagramsView.tsx layout from 2-column to 3-column flexbox
    - Add PalettePanel as third sibling after Canvas
    - Pass isPalettePanelCollapsed from context state
    - Pass dispatch for onToggleCollapse callback
    - Only render PalettePanel when currentView === 'diagrams'
  - [x] 2.5 Update Canvas container to flex-grow with panel state
    - Modify canvasContainer styles to use flex-grow for dynamic width
    - Canvas should expand to fill space when panel collapses
    - Canvas should shrink when panel expands
    - Maintain existing zoom and pan functionality
  - [x] 2.6 Ensure panel layout tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Verify panel renders in correct view
    - Verify collapse/expand toggles width correctly
    - Do NOT run entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- PalettePanel component renders only in DiagramsView
- Panel width toggles between 300px (expanded) and 30px (collapsed)
- Chevron button changes icon based on collapsed state
- Canvas dynamically resizes when panel toggles
- Layout uses flexbox for responsive width management

---

### Search and Filter Layer

#### Task Group 3: Search Input and Filter Logic
**Dependencies:** Task Group 2

- [x] 3.0 Complete search and filter functionality
  - [x] 3.1 Write 2-8 focused tests for search filtering
    - Test search input filters items by name (case-insensitive)
    - Test empty search shows all items
    - Test search with no matches shows empty section bodies
    - Test search preserves section expand/collapse states
    - Skip exhaustive testing of all search edge cases and character sets
  - [x] 3.2 Add search input component to PalettePanel
    - Position text input at top of panel below collapse button
    - Use placeholder text: "Search..."
    - Wire value to paletteSearchQuery from context state
    - Wire onChange to dispatch SET_PALETTE_SEARCH action
    - Style consistently with existing input components
  - [x] 3.3 Implement search filter helper function
    - Create filterItemsBySearch() in utils/paletteFilters.ts
    - Accept items array and search query string
    - Return filtered array matching name field (case-insensitive substring match)
    - Handle empty/null search query by returning all items
    - Reusable for both entity and relationship item lists
  - [x] 3.4 Create data aggregation helper for palette sections
    - Create getPaletteSections() in utils/paletteData.ts
    - Accept metaModel object and search query
    - Return array of section objects with: { id, label, items, type: 'entity' | 'relationship' }
    - Map entity types to display labels (e.g., 'business_users' -> 'Business Users')
    - Map relationship types to display labels (e.g., 'business_user_processes' -> 'User ↔ Process')
    - Apply search filter to each section's items
  - [x] 3.5 Wire search input to section rendering
    - Pass paletteSearchQuery from context to PalettePanel
    - Use getPaletteSections() with search query to generate filtered sections
    - Re-render section lists when search query changes
    - Preserve section expand/collapse states during search
  - [x] 3.6 Ensure search filter tests pass
    - Run ONLY the 2-8 tests written in 3.1
    - Verify search filters items correctly
    - Verify section states preserved during search
    - Do NOT run entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Search input appears at top of expanded panel
- Search filters items in real-time (case-insensitive)
- Empty search displays all items
- Search with no matches shows empty section bodies
- Section expand/collapse states persist during search operations

---

### Grouped Sections Layer

#### Task Group 4: Collapsible Section Components
**Dependencies:** Task Group 3

- [x] 4.0 Complete section grouping and collapse functionality
  - [x] 4.1 Write 2-8 focused tests for section behavior
    - Test section header click toggles expanded/collapsed state
    - Test collapsed section shows only header
    - Test expanded section shows filtered item list
    - Test section state persists independently across sections
    - Skip exhaustive testing of all section variations and animations
  - [x] 4.2 Create PaletteSection.tsx component
    - Create file: frontend/src/components/DiagramsView/PaletteSection.tsx
    - Accept props: sectionId, label, items, isExpanded, onToggle, onItemClick, itemType
    - Render header row with expand/collapse triangle and label
    - Triangle shows ▶ when collapsed, ▼ when expanded
    - Wire header onClick to onToggle callback
  - [x] 4.3 Implement section body with item list
    - Render scrollable list of items when isExpanded is true
    - Hide item list when isExpanded is false (show header only)
    - If items array is empty, show empty section body when expanded
    - Use consistent padding and margins for readability
    - Apply max-height and overflow-y: auto for scrolling within section
  - [x] 4.4 Create PaletteItem.tsx component for list items
    - Create file: frontend/src/components/DiagramsView/PaletteItem.tsx
    - Accept props: item (entity or relationship object), onClick, itemType
    - Display primary text: item.name
    - Display secondary text: item.id in smaller grey font (e.g., "(app_oms)")
    - Add hover state with background highlight
    - Wire onClick to parent callback with item data
  - [x] 4.5 Wire section state to context
    - Use sectionExpandStates from context for each section's isExpanded prop
    - Dispatch TOGGLE_PALETTE_SECTION action with sectionId on header click
    - Initialize all sections as expanded by default in initial state
    - Ensure section states are independent and toggle correctly
  - [x] 4.6 Render all entity and relationship sections in PalettePanel
    - Map getPaletteSections() result to PaletteSection components
    - Group entity sections first, relationship sections second
    - Pass filtered items to each section based on search query
    - Maintain consistent ordering: Users, Processes, Applications, Components, Services, Points, Logical Entities, Physical Entities, then relationships
  - [x] 4.7 Ensure section component tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Verify section expand/collapse works independently
    - Verify items render correctly in expanded sections
    - Do NOT run entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- Section headers display type label with expand/collapse triangle
- Click on header or triangle toggles section state
- Collapsed sections show header only
- Expanded sections show filtered item list
- Each section state is independent and persists during search
- All 14 sections render in correct order (8 entity + 6 relationship)

---

### Click-to-Add Interaction Layer

#### Task Group 5: Node Addition from Palette
**Dependencies:** Task Group 4

- [x] 5.0 Complete click-to-add node creation
  - [x] 5.1 Write 2-8 focused tests for click-to-add behavior
    - Test clicking entity item creates new diagram node
    - Test clicking entity item does not create duplicate if node exists
    - Test new node appears on canvas immediately
    - Test new node has correct entity_type and entity_id
    - Skip exhaustive testing of all node properties and positioning variations
  - [x] 5.2 Implement duplicate node detection
    - Create nodeExistsForEntity() helper in utils/nodeCreation.ts
    - Accept diagram's nodes array, entity_type, entity_id
    - Return true if any node matches both entity_type and entity_id
    - Use for duplicate prevention before creating node
  - [x] 5.3 Implement cascading placement algorithm
    - Create calculateNodePlacement() in utils/nodeCreation.ts
    - Accept existing nodes array, canvas viewport dimensions
    - Base position: center-left of viewport (e.g., x=150, y=center)
    - Offset: +30px x and +30px y for each existing node in diagram
    - Return { pos_x, pos_y } for new node placement
  - [x] 5.4 Wire PaletteItem click to node creation
    - Add onItemClick handler in PalettePanel
    - Check itemType prop: if 'relationship', do nothing (browse-only for v0.3)
    - If 'entity', check for duplicate using nodeExistsForEntity()
    - If duplicate exists, optionally highlight existing node (or show toast/no-op)
    - If no duplicate, create node using createDiagramNodeFromEntity()
    - Dispatch ADD_DIAGRAM_NODE action with new node
  - [x] 5.5 Ensure Canvas re-renders with new node
    - Verify Canvas.tsx reads nodes from current diagram in context
    - Confirm Canvas re-renders when nodes array updates
    - New node should appear immediately after dispatch
    - Use existing node rendering logic from Canvas component
  - [x] 5.6 Map entity types to ENTITY_TYPES constants
    - Create getEntityTypeConstant() in utils/paletteData.ts
    - Map metaModel entity keys to ENTITY_TYPES enum values
    - Examples: 'business_users' -> 'BUSINESS_USER', 'applications' -> 'APPLICATION'
    - Use in createDiagramNodeFromEntity() for entity_type field
  - [x] 5.7 Ensure click-to-add tests pass
    - Run ONLY the 2-8 tests written in 5.1
    - Verify node creation works for entities
    - Verify duplicate prevention works correctly
    - Do NOT run entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- Clicking entity item in palette creates diagram node
- Duplicate entities are not added to same diagram
- New nodes appear on canvas immediately
- Node placement uses cascading algorithm from center-left
- Clicking relationship items does nothing (browse-only)
- Entity types map correctly to ENTITY_TYPES constants
- Changes persist in context state and save to JSON

---

### Integration and Polish Layer

#### Task Group 6: Styling, Edge Cases, and Integration Testing
**Dependencies:** Task Groups 1-5

- [x] 6.0 Complete styling and integration
  - [x] 6.1 Review existing tests and identify critical gaps
    - Review tests from Task Groups 1-5 (approximately 10-40 tests)
    - Identify critical integration gaps: panel + search + add node workflow
    - Identify critical edge case gaps: empty meta-model, collapsed panel + search, etc.
    - Focus ONLY on gaps related to palette panel feature
    - Do NOT assess entire application test coverage
  - [x] 6.2 Write up to 10 additional strategic tests maximum
    - Test end-to-end workflow: search -> expand section -> click item -> node appears
    - Test panel state persists during diagram switching
    - Test empty meta-model displays empty sections correctly
    - Test adding multiple nodes uses correct cascading placement
    - Test panel collapse during search preserves search state
    - Do NOT write comprehensive coverage for all scenarios
    - Skip performance tests and accessibility tests unless business-critical
  - [x] 6.3 Apply consistent styling to all palette components
    - Use CSS modules for PalettePanel, PaletteSection, PaletteItem
    - Match existing UI component styles from MetaModelView and DiagramsView
    - Consistent colors: headers similar to TabBar, items similar to GridCell
    - Consistent spacing: 8px padding for items, 12px for section headers
    - Hover states: subtle background color change on items and headers
    - Search input: consistent with existing form inputs in application
  - [x] 6.4 Add loading and empty states
    - If metaModel is empty/null, display "No meta-model loaded" message in panel
    - If section has no items after search filter, show empty state in section body
    - If all sections are empty due to search, show "No results found" message
    - Style empty states with muted text color and centered alignment
  - [x] 6.5 Handle edge cases and error states
    - Handle null/undefined currentDiagramId: disable add functionality or hide panel
    - Handle missing entity data: skip broken items, log warning to console
    - Handle z_index overflow: cap at reasonable max value (e.g., 9999)
    - Handle viewport size changes: ensure cascading placement adapts to canvas size
  - [x] 6.6 Add visual feedback for user actions
    - Brief highlight or animation when node is added to canvas
    - Disable or grey-out entity items that already exist in current diagram
    - Visual indication if trying to add duplicate (e.g., flash existing node)
    - Smooth transitions for panel expand/collapse (CSS transitions)
  - [x] 6.7 Run feature-specific test suite
    - Run ALL tests related to palette panel feature (from 1.1, 2.1, 3.1, 4.1, 5.1, 6.2)
    - Expected total: approximately 20-50 tests maximum
    - Do NOT run entire application test suite
    - Verify all critical workflows pass
    - Fix any failing tests before marking complete
  - [x] 6.8 Manual testing and polish
    - Test full workflow: load model -> switch to diagrams -> expand/collapse panel
    - Test search functionality with various queries and edge cases
    - Test adding multiple entities and verify placement
    - Test panel behavior when switching between diagrams
    - Verify styles match existing UI patterns
    - Test responsive behavior with different viewport sizes

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-50 tests total)
- No more than 10 additional tests added when filling gaps
- Styling is consistent with existing DiagramsView and MetaModelView components
- Empty states display appropriate messages
- Edge cases handled gracefully without crashes
- Visual feedback provided for user actions
- Panel collapse/expand has smooth transitions
- Duplicate entities are visually indicated or disabled
- Full end-to-end workflow functions correctly

---

## Execution Order

Recommended implementation sequence:
1. **State Management Layer** (Task Group 1) - Foundation for all palette operations
2. **Panel UI Component Layer** (Task Group 2) - Basic panel structure and layout
3. **Search and Filter Layer** (Task Group 3) - Search functionality for filtering items
4. **Grouped Sections Layer** (Task Group 4) - Section display and collapse behavior
5. **Click-to-Add Interaction Layer** (Task Group 5) - Core feature: adding nodes to diagram
6. **Integration and Polish Layer** (Task Group 6) - Styling, edge cases, and testing

## Key Technical Decisions

**State Management Approach:**
- All palette state (collapse, section expand, search) lives in ArchitectureContext
- Follows existing reducer pattern for consistency
- Session-only persistence (resets on page reload)

**Component Architecture:**
- PalettePanel (container) -> PaletteSection (collapsible groups) -> PaletteItem (individual entries)
- Reuses patterns from MetaModelView.tsx TabBar for section headers
- CSS modules for styling isolation

**Node Creation Strategy:**
- Central helper function (createDiagramNodeFromEntity) for consistency
- Cascading placement algorithm for predictable positioning
- Duplicate detection at entity_type + entity_id level

**Data Flow:**
- MetaModel entities/relationships -> getPaletteSections() -> filtered by search -> PaletteSection components
- Click event -> duplicate check -> createNode -> dispatch ADD_DIAGRAM_NODE -> Canvas re-renders

## Out of Scope Reminders

- Panel width is fixed at 300px (no resizing in v0.3)
- Drag-and-drop not implemented (click-to-add only)
- Relationship items are browse-only (no edge creation)
- No undo/redo for node additions
- No visual preview before adding
- No keyboard shortcuts
- No batch operations
- No context menus on items
- No item counts in section headers

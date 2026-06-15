# Specification: Diagram Palette Panel

## Goal
Provide a collapsible right-hand panel in the Diagrams view for browsing and adding existing meta-model entities and relationships to the current diagram.

## User Stories
- As a user, I want to browse existing meta-model entities in a palette panel so that I can easily find and add them to my diagram without leaving the Diagrams view
- As a user, I want to collapse the palette panel when not needed so that I have more canvas space for diagram editing

## Specific Requirements

**Right-hand Panel Layout and Positioning**
- Panel appears only in DiagramsView, not in MetaModelView
- Panel is visible by default but collapsible via chevron button on left edge of panel
- Panel sits to the right of the diagram canvas with fixed width of 300px
- When collapsed, only a slim vertical bar (30px width) with expand icon is visible, canvas expands to use freed space
- When expanded, full panel shows with search box at top and scrollable grouped list below
- Main layout becomes: header bar (top), canvas (center-left), palette panel (right)

**Panel Collapse/Expand Control**
- Chevron button positioned on left edge of panel for toggling visibility
- When open: chevron points right (">>" or collapse icon)
- When collapsed: chevron points left ("<<" or expand icon) on the slim vertical bar
- Click behavior toggles between expanded and collapsed states
- Collapse state persists during user's session but resets to expanded on page reload

**Search Input Area**
- Single text input at top of panel with placeholder "Search..."
- Filters content in real-time as user types based on name field substring matching (case-insensitive)
- When search box is empty, all sections show with their current expand/collapse states preserved
- When searching with text, sections remain visible but show only matching items in their lists
- Sections with no matching items display empty body when expanded

**Grouped List Sections**
- Scrollable area below search displays sections grouped by entity/relationship type
- Each section has header row with expand/collapse triangle (▶ collapsed, ▼ expanded) and label
- Entity sections: Business Users, Business Processes, Applications, App Components, Services, Application Points, Logical Entities, Physical Entities
- Relationship sections displayed separately: User ↔ Process, App Point ↔ Process, Logical ER, Logical ↔ Physical Entities, Logical ↔ Physical Attrs, Data Movements

**Section Header and State Management**
- Each section header shows type label (e.g. "Applications", "Business Processes")
- Click on header or triangle toggles between expanded and collapsed states
- Collapsed state shows only header row
- Expanded state shows list of items filtered by search text
- Section expand/collapse states persist during search operations

**Item Row Display**
- Each item row represents one meta-model entry with primary label showing name field
- Secondary text shows ID in smaller/grey text for disambiguation (e.g. "(app_oms)")
- Rows have consistent height and margin for readability
- Hover state provides visual feedback with background highlight
- Rows are clickable to trigger add-to-diagram action

**Data Source Mappings**
- Business Users → metaModel.entities.business_users
- Business Processes → metaModel.entities.business_processes
- Applications → metaModel.entities.applications
- App Components → metaModel.entities.app_components
- Services → metaModel.entities.services
- Application Points → metaModel.entities.application_points
- Logical Entities → metaModel.entities.logical_data_entities
- Physical Entities → metaModel.entities.physical_data_entities
- User ↔ Process → metaModel.relationships.business_user_processes
- App Point ↔ Process → metaModel.relationships.application_point_business_processes
- Logical ER → metaModel.relationships.logical_data_entity_relationships
- Logical ↔ Physical Entities → metaModel.relationships.logical_data_entity_physical_data_entities
- Logical ↔ Physical Attrs → metaModel.relationships.logical_data_attribute_physical_data_attributes
- Data Movements → metaModel.relationships.data_movements

**Click-to-Add Entity Behavior**
- Clicking an item in entity sections adds it to current diagram as a diagram_node
- If diagram_node already exists for that entity in current diagram, do not create duplicate (optionally highlight existing node)
- If no diagram_node exists, create new node with entity_type and entity_id from clicked item
- New nodes placed at default position: cascading placement starting from center-left, offset +30px x/y from last added node
- Use default width/height from existing node rendering logic, auto_size default value, z_index set above existing nodes
- Parent_node_id set to null, style_override set to empty object
- Canvas updates immediately to show new node, changes persist in in-memory model and Save JSON

**Diagram Node Creation Details**
- diagram_id: ID of currently selected diagram
- entity_type: appropriate ENTITY_TYPES constant (e.g. "APPLICATION", "BUSINESS_PROCESS")
- entity_id: the id field of selected meta-model entity
- pos_x/pos_y: default placement using cascading strategy near viewport center
- width/height: use default sizes from existing node rendering
- z_index: increment from max existing z_index to place on top
- parent_node_id: null
- style_override: empty object {}

**Relationship Items Browse-Only Behavior**
- Relationship items appear in palette sections and are searchable/filterable
- For v0.3, clicking relationship items does not create edges or modify diagram
- Future versions may add functionality to create diagram_edges from relationship clicks when endpoints exist

## Visual Design

No visual mockups provided. Follow existing DiagramsView patterns:
- Panel uses similar styling to existing UI components with consistent padding and borders
- Search input follows existing input field styling patterns
- Section headers use button styling similar to existing tab components
- Item rows use hover states consistent with existing interactive elements
- Collapsed panel bar uses minimal width with centered icon
- Color scheme and fonts match existing application theme

## Existing Code to Leverage

**DiagramsView.tsx layout structure**
- Current layout has headerBar at top and canvasContainer below
- Add palettePanel as third sibling in container using flexbox
- Use existing styles.container and add new styles for panel area
- Leverage existing zoom state and diagram selection logic

**MetaModelView.tsx section grouping pattern**
- Reuse concept of entity sections with header rows and expandable content
- Adapt tabBar interaction pattern for section expand/collapse
- Use similar header styling with tab-like appearance for section headers

**ArchitectureContext reducer actions**
- Leverage existing ADD_DIAGRAM pattern for creating new reducer action
- Add new UPDATE_DIAGRAM_NODE_LIST or ADD_DIAGRAM_NODE action type
- Follow immutable state update patterns from existing node/edge actions
- Dispatch new action when user clicks palette item to add node

**idGenerator.ts for node ID generation**
- Use generatePrefixedId('node') for new diagram_node IDs
- Follows existing pattern used in diagram and entity creation
- Ensures unique IDs across all nodes in all diagrams

**Canvas.tsx node rendering and positioning**
- Reuse getNodesInRenderOrder for determining z_index values
- Leverage existing node rendering logic to display newly added nodes immediately
- Use existing default dimensions from diagramEditing config for new nodes

## Out of Scope
- Resizing palette panel width (fixed 300px width for v0.3)
- Drag-and-drop from palette to canvas (simple click-to-add only)
- Creating diagram_edges by clicking relationship items (browse-only for relationships in v0.3)
- Automatic edge creation when adding entities that have relationships
- Visual preview of entity before adding to canvas
- Undo/redo for adding nodes from palette
- Batch adding multiple entities at once
- Keyboard shortcuts for palette operations
- Palette customization or section reordering
- Filtering by entity attributes beyond name field
- Saved search queries or search history
- Context menu on palette items for additional actions
- Showing count of items in each section header
- Highlighting relationships involving selected entity in palette

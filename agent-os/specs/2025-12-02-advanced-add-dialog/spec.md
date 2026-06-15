# Specification: Advanced Add Dialog for Flexible Graph Expansion

## Goal
Enable users to add an entity from the RHS meta-model tables along with an arbitrary combination of related entities and relationships to the diagram in a single operation, using a tree-based selection UI driven by existing meta-model parent/child and association relationships.

## User Stories
- As an architect, I want to add an Application along with a selected subset of its related Business Processes, App Components, and Services in one operation so that I can quickly populate my diagram with relevant context.
- As a modeler, I want to visually choose which relationship paths to include when adding an entity so that I have precise control over the neighbourhood being added to the diagram.

## Specific Requirements

**Context Menu "Advanced Add..." Entry**
- Add a new context menu item "Advanced Add..." below existing "Add with X" options in PaletteContextMenu.tsx
- Only visible/enabled for entity types that have at least one expandable relationship (parent/child or association)
- Clicking "Advanced Add..." opens the AdvancedAddDialog modal component
- Uses the existing context menu infrastructure: ContextMenuState, ContextMenuAction, handleItemContextMenu patterns

**AdvancedAddDialog Modal Component**
- Create new component AdvancedAddDialog.tsx in frontend/src/components/DiagramsView/
- Title format: "Advanced Add: <EntityType> \"<EntityName>\"" (e.g., "Advanced Add: Application \"Payments App\"")
- Modal should use the existing Modal.tsx component as base, extending it with a scrollable tree content area
- Footer contains "Add to Diagram" (primary) and "Cancel" (secondary) buttons
- Maximum width 700px to accommodate tree depth; max-height 70vh with scrollable content area

**Tree Structure and Rendering**
- Root node displays the selected entity with format "<EntityType>: <Name>" (checked, disabled checkbox)
- Child nodes represent expandable relationships, showing target entity type and relationship kind
- Text labels distinguish "(parent/child)" from "(association)" relationship kinds
- Tree nodes use indentation (20px per level) and expand/collapse toggles for multi-level hierarchies
- Render using recursive TreeNode sub-component with props for label, checked state, indeterminate state, and children

**Selection Semantics**
- Root entity is always selected and cannot be deselected (checkbox checked and disabled)
- Selecting a child node implicitly selects all ancestor nodes up to root
- Deselecting a node deselects all descendant nodes but leaves ancestors unchanged
- Support indeterminate checkbox state when some but not all descendants are selected
- Multiple branches can be selected simultaneously
- Default state: only root is selected; all expansion nodes are unchecked

**Relationship Definitions for Tree**
- Define expandable relationships map in new file frontend/src/utils/advancedAddRelationships.ts
- Map each entity type to its parent/child relationships (where entity is parent OR child)
- Map each entity type to its association relationships (bidirectional lookup)
- Use existing meta-model relationship structures from model.ts without changing semantics
- Example: Application -> AppComponent (parent/child), Application -> BusinessProcess (association via ApplicationPoint)

**Backend API: Advanced Add Expansion Endpoint**
- Create new POST endpoint /api/diagram/advanced-add-expansion in a new DiagramExpansionController.java
- Request body: { rootEntityType, rootEntityId, diagramId, selections: SelectionDescriptor[] }
- SelectionDescriptor includes: relationshipType, direction (CHILD|PARENT|ASSOCIATION), depth (integer)
- Response: { nodes: NodeDescriptor[], edges: EdgeDescriptor[] } with alreadyOnDiagram flag per item
- Validate root entity exists and requested relationship paths are valid for that entity type

**Backend Traversal Logic**
- Implement graph traversal in new DiagramExpansionService.java
- Traverse from root entity following specified relationship paths to requested depth
- Accumulate unique entity instances and relationship instances along traversed paths
- Query diagram_nodes to determine which entities/relationships already exist on the target diagram
- Set alreadyOnDiagram flag for items that exist, enabling frontend to skip creation

**Frontend API Integration**
- Add advancedAddExpansion function to frontend/src/utils/diagramApi.ts (or create new file)
- Call backend endpoint when user clicks "Add to Diagram" in the dialog
- Handle loading state with spinner in dialog during API call
- Handle errors with ErrorModal or inline error message display

**Diagram Update on Advanced Add**
- For each node in response where alreadyOnDiagram is false: create DiagramNode using createDiagramNodeFromEntity
- For each edge in response where alreadyOnDiagram is false: create DiagramEdge using createRelationshipEdge
- Reuse existing nodes/edges; no duplicate creation for items where alreadyOnDiagram is true
- Use onAddNodes batch callback for atomic addition of multiple nodes
- Use onAddEdge for each edge (or add batch onAddEdges callback if needed)

**Layout Positioning**
- Position new nodes relative to root entity node using existing layout utilities from compoundLayout.ts
- Apply parent/child containment positioning using calculateChildPositionWithHeights for nested nodes
- Use viewport center (getViewportCenter) as base for root node if not already on diagram
- Avoid overlapping existing content by checking existing node positions

## Visual Design
No mockups provided. Implement a standard modal dialog with tree view following existing Modal component styling patterns.

## Existing Code to Leverage

**PaletteContextMenu.tsx**
- Existing context menu rendering with menu items for Add, Delete, Add with X options
- Pattern for adding new menu items with data-testid and onClick handlers
- ReactDOM.createPortal pattern for rendering menu outside normal DOM hierarchy

**Modal.tsx and Modal.module.css**
- Base modal component with overlay, header, content, footer structure
- Extend for AdvancedAddDialog with custom content (tree) and footer (Add/Cancel buttons)
- CSS patterns for scrollable content, button styling, overlay backdrop

**compoundLayout.ts**
- findLinkedBusinessProcesses, findAppComponents, findProcessActivities helper functions
- calculateChildPositionWithHeights, calculateParentSizeWithHeights for parent/child layout
- Existing pattern for traversing meta-model relationships to find related entities

**model.ts**
- MetaModel, MetaModelEntities, MetaModelRelationships interface definitions
- ENTITY_TYPES constants for entity type checking
- Relationship interfaces (BusinessUserProcess, ApplicationPointBusinessProcess, etc.) defining FK fields

**PalettePanel.tsx**
- handleAddWithBusinessProcesses, handleAddWithAppComponents patterns for compound add operations
- onAddNodes batch callback for adding multiple nodes atomically
- Viewport center calculation using getCurrentViewportCenter helper

## Out of Scope
- Progressive in-diagram "expand/collapse" interactions (clicking nodes to expand neighbours on canvas)
- Saved creation templates or presets (persisting user's tree selection for reuse)
- Any changes to existing "Add", "Add with X" context menu item behaviour
- Visual distinction (icons, colors) for parent/child vs association in tree beyond text labels
- Keyboard navigation within the tree component
- Drag-and-drop reordering of selected items
- Preview visualization of what will be added before confirming
- Undo/redo integration for the advanced add operation
- Multi-select from palette to add multiple root entities at once
- Filter/search within the Advanced Add tree

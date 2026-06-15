# Specification: Palette Context Menu

## Goal
Add a custom right-click context menu to palette panel items that provides Add/Delete actions for all items, plus extended "Add with business processes" and "Add with app components" options specifically for APPLICATION entities, enabling compound node creation with automatic parent-child layout.

## User Stories
- As a diagram editor, I want to right-click a palette item to see context-aware actions (Add or Delete) so that I can quickly manage diagram contents without using only left-click.
- As an architect, I want to add an Application along with its linked business processes or app components in one action so that I can rapidly build hierarchical diagram structures.

## Specific Requirements

**Custom Context Menu Component**
- Create a new `PaletteContextMenu` component that renders when right-clicking on a `PaletteItem`
- Intercept `onContextMenu` event on palette items and call `e.preventDefault()` to suppress browser default
- Position menu near cursor using mouse event coordinates (clientX, clientY)
- Style with white background, border/shadow, and clickable rows matching existing UI patterns
- Auto-dismiss when clicking outside (document click listener) or pressing Escape key

**Context Menu State Management**
- Store menu state in PalettePanel: `contextMenuState: { visible: boolean; x: number; y: number; item: PaletteItem; sectionId: string } | null`
- Pass `onContextMenu` handler from PaletteSection to PaletteItem
- Reset state to null when menu dismissed or action completed

**Base Menu Options (All Items)**
- Show "Add" option only if `nodeExistsForEntity()` returns false for the item
- Show "Delete" option only if `nodeExistsForEntity()` returns true for the item
- "Add" action uses existing `handleItemClick` logic from PalettePanel
- "Delete" action dispatches `DELETE_DIAGRAM_ELEMENTS` with the node ID found via entity lookup

**Extended Options for APPLICATION Entities**
- When `sectionId === 'applications'` (entity_type is APPLICATION), show additional options:
  - "Add with business processes"
  - "Add with app components"
- These appear alongside (not replacing) the base Add/Delete options
- Extended options are always visible for APPLICATION items regardless of whether parent already exists

**"Add with business processes" Behavior**
- If Application node does not exist, create it first using `createDiagramNodeFromEntity`
- Query `metaModel.relationships.application_point_business_processes` to find all records where `application_point_id` matches any ApplicationPoint belonging to this Application
- For each linked `business_process_id`, create a child DiagramNode with `parent_node_id` set to the Application node's ID
- Skip any BusinessProcess nodes that already exist on the diagram
- After adding all children, recalculate parent sizing using layout algorithm

**"Add with app components" Behavior**
- If Application node does not exist, create it first using `createDiagramNodeFromEntity`
- Query `metaModel.entities.app_components` and filter by `application_id === application.id`
- For each matching ApplicationComponent, create a child DiagramNode with entity_type `APP_COMPONENT` and `parent_node_id` set to Application node's ID
- Skip any AppComponent nodes that already exist on the diagram
- After adding all children, recalculate parent sizing using layout algorithm

**Layout Algorithm for Compound Add**
- All child nodes share same X position: `parent.pos_x + 5` (5px left padding)
- Child Y positions stack vertically starting at: `parent.pos_y + 5 + parent_label_height + 5` (5px top padding + label + 5px gap)
- Gap between consecutive children: 5px
- Child width/height: Use default node dimensions (120x60) from `createDiagramNodeFromEntity`
- Parent width: `5 + max(child.width) + 5` (5px padding on each side)
- Parent height: `5 + label_height + 5 + sum(child.height + 5px gaps)` where label_height defaults to 20px

**Batch Node Addition**
- Create a new action type `ADD_DIAGRAM_NODES` (plural) in ArchitectureContext to add multiple nodes in single dispatch
- Alternatively, dispatch multiple `ADD_DIAGRAM_NODE` actions sequentially (parent first, then children)
- After all nodes added, dispatch `UPDATE_DIAGRAM_NODE` to resize parent with calculated dimensions

**Palette Refresh After Actions**
- After Add, Delete, or compound add operations complete, the palette naturally reflects state because it re-queries `nodeExistsForEntity` on render
- No explicit refresh action needed since palette reads from diagram state

## Existing Code to Leverage

**PaletteItem Component (`frontend/src/components/DiagramsView/PaletteItem.tsx`)**
- Already uses `nodeExistsForEntity` to determine duplicate status
- Add `onContextMenu` prop to capture right-click events
- Pass through `sectionId` for determining entity type

**nodeCreation Utilities (`frontend/src/utils/nodeCreation.ts`)**
- `nodeExistsForEntity(nodes, entity_type, entity_id)` - use to check if entity already on diagram
- `createDiagramNodeFromEntity(entity_type, entity_id, existingNodes)` - use to create new nodes with auto-placement
- `calculateZIndex(existingNodes)` - ensures proper z-ordering for new nodes

**ArchitectureContext Actions (`frontend/src/contexts/ArchitectureContext.tsx`)**
- `ADD_DIAGRAM_NODE` action - use for adding individual nodes to diagram
- `DELETE_DIAGRAM_ELEMENTS` action - use for deleting nodes (with edge cascade)
- `UPDATE_DIAGRAM_NODE` action - use for resizing parent after children added

**paletteData Utilities (`frontend/src/utils/paletteData.ts`)**
- `getEntityTypeConstant(sectionId)` - maps section ID (e.g., 'applications') to ENTITY_TYPES constant (e.g., 'APPLICATION')
- Use to determine when extended options should appear

## Out of Scope
- Context menu for relationship items (they remain browse-only)
- Drag-and-drop from palette to canvas
- Custom positioning/layout options in context menu
- Nested context menu submenus
- Keyboard navigation within context menu
- Context menu on canvas nodes (only palette items)
- Undo/redo for compound add operations
- Animation or transitions for menu appearance
- Touch device long-press support
- Compound delete operations (delete parent with all children)

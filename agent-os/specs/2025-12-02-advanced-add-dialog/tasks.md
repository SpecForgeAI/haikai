# Task Breakdown: Advanced Add Dialog for Flexible Graph Expansion

## Overview
Total Tasks: 42 sub-tasks across 5 task groups

This feature enables users to add an entity along with an arbitrary combination of related entities and relationships to a diagram in a single operation, using a tree-based selection UI driven by existing meta-model relationships.

## Task List

### Frontend - Relationship Definitions

#### Task Group 1: Expandable Relationships Map
**Dependencies:** None

- [x] 1.0 Complete relationship definitions layer
  - [x] 1.1 Write 4 focused tests for relationship mapping functionality
    - Test: getExpandableRelationships returns correct relationships for APPLICATION entity type
    - Test: getExpandableRelationships returns correct relationships for BUSINESS_PROCESS entity type
    - Test: getExpandableRelationships returns empty array for entity types with no relationships
    - Test: relationship definitions distinguish between parent/child and association kinds
    - Test file: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\advanced-add-relationships.test.ts`
  - [x] 1.2 Create advancedAddRelationships.ts utility file
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\advancedAddRelationships.ts`
    - Define `RelationshipKind` type: 'PARENT_CHILD' | 'ASSOCIATION'
    - Define `RelationshipDirection` type: 'CHILD' | 'PARENT' | 'ASSOCIATION'
    - Define `ExpandableRelationship` interface with fields:
      - `targetEntityType: string`
      - `relationshipKind: RelationshipKind`
      - `direction: RelationshipDirection`
      - `relationshipTableName: string`
      - `foreignKeyField: string`
    - Reference existing relationship patterns from `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\types\model.ts` (lines 189-262)
  - [x] 1.3 Define EXPANDABLE_RELATIONSHIPS map
    - Map entity types to their expandable relationships
    - APPLICATION -> AppComponent (parent/child, direction: CHILD)
    - APPLICATION -> BusinessProcess (association via ApplicationPoint)
    - APPLICATION -> Service (parent/child, direction: CHILD)
    - BUSINESS_PROCESS -> ProcessActivity (parent/child, direction: CHILD)
    - BUSINESS_PROCESS -> Application (association via ApplicationPoint)
    - APP_COMPONENT -> Service (parent/child, direction: CHILD)
    - SERVICE -> Interface (parent/child, direction: CHILD)
    - LOGICAL_DATA_ENTITY -> LogicalDataAttribute (parent/child, direction: CHILD)
    - LOGICAL_DATA_ENTITY -> PhysicalDataEntity (association via relationship table)
    - PHYSICAL_DATA_ENTITY -> PhysicalDataAttribute (parent/child, direction: CHILD)
  - [x] 1.4 Create getExpandableRelationships helper function
    - Signature: `(entityType: string) => ExpandableRelationship[]`
    - Return empty array for entity types not in map
  - [x] 1.5 Create hasExpandableRelationships helper function
    - Signature: `(entityType: string) => boolean`
    - Used to determine "Advanced Add..." menu item visibility
  - [x] 1.6 Ensure relationship definitions tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify all helper functions work correctly

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- EXPANDABLE_RELATIONSHIPS map covers all required entity type relationships
- Helper functions correctly identify expandable entity types
- Relationship kinds are properly distinguished (parent/child vs association)

---

### Frontend - UI Components

#### Task Group 2: AdvancedAddDialog Modal Component
**Dependencies:** Task Group 1

- [x] 2.0 Complete AdvancedAddDialog modal component
  - [x] 2.1 Write 6 focused tests for AdvancedAddDialog component
    - Test: Dialog renders with correct title format "Advanced Add: <EntityType> \"<EntityName>\""
    - Test: Root node is checked and disabled (cannot be deselected)
    - Test: Selecting child node automatically selects all ancestor nodes
    - Test: Deselecting node deselects all descendants but leaves ancestors unchanged
    - Test: Indeterminate checkbox state displays when some but not all descendants selected
    - Test: "Add to Diagram" button triggers onAdd callback with selected nodes
    - Test file: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\advanced-add-dialog.test.ts`
  - [x] 2.2 Create AdvancedAddDialog.tsx component
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\AdvancedAddDialog.tsx`
    - Props interface:
      - `isOpen: boolean`
      - `onClose: () => void`
      - `onAdd: (selections: SelectionDescriptor[]) => void`
      - `rootEntity: { id: string; name: string; type: string }`
      - `metaModel: MetaModel`
    - Use existing Modal.tsx as base (lines 11-31 of `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\common\Modal.tsx`)
    - Title format: "Advanced Add: <EntityType> \"<EntityName>\""
  - [x] 2.3 Create AdvancedAddDialog.module.css stylesheet
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\AdvancedAddDialog.module.css`
    - Modal max-width: 700px (wider than standard 600px for tree depth)
    - Modal max-height: 70vh with scrollable content area
    - Follow existing Modal.module.css patterns (lines 1-122 of `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\common\Modal.module.css`)
    - Tree indentation: 20px per level
    - Checkbox styling for normal, checked, disabled, and indeterminate states
  - [x] 2.4 Create TreeNode sub-component
    - Recursive component for rendering tree hierarchy
    - Props: label, checked, indeterminate, disabled, children, onToggle, depth
    - Expand/collapse toggle for nodes with children
    - Visual distinction for relationship kind labels: "(parent/child)" vs "(association)"
  - [x] 2.5 Implement selection state management
    - useState for tracking selected node paths
    - Root entity always selected (checked + disabled)
    - Selection cascades: selecting child selects ancestors
    - Deselection cascades: deselecting parent deselects all descendants
    - Compute indeterminate state from children selection state
  - [x] 2.6 Build tree data from metaModel
    - Use getExpandableRelationships from Task Group 1
    - Query metaModel for actual entity instances per relationship
    - Build hierarchical tree structure with entity instances
    - Format node labels as "<EntityType>: <Name>"
  - [x] 2.7 Implement dialog footer with action buttons
    - "Add to Diagram" primary button (blue, following .okButton style)
    - "Cancel" secondary button
    - Disable "Add to Diagram" during loading state
    - Show spinner during API call
  - [x] 2.8 Ensure AdvancedAddDialog tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify all component behaviors work correctly

**Acceptance Criteria:**
- The 6 tests written in 2.1 pass
- Dialog renders with scrollable tree content
- Root node is always selected and disabled
- Selection semantics work correctly (ancestor/descendant cascading)
- Indeterminate checkbox states display correctly
- Modal styling matches design requirements (700px width, 70vh height)

---

#### Task Group 3: Context Menu Integration
**Dependencies:** Task Group 2

- [x] 3.0 Complete context menu integration
  - [x] 3.1 Write 4 focused tests for context menu integration
    - Test: "Advanced Add..." menu item appears for entity types with expandable relationships
    - Test: "Advanced Add..." menu item hidden for entity types without expandable relationships
    - Test: Clicking "Advanced Add..." opens AdvancedAddDialog with correct entity data
    - Test: Dialog closes when Cancel is clicked or onClose triggered
    - Test file: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\advanced-add-context-menu.test.ts`
  - [x] 3.2 Add onAdvancedAdd prop to PaletteContextMenu
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PaletteContextMenu.tsx`
    - Add new prop: `onAdvancedAdd: ContextMenuAction`
    - Add to PaletteContextMenuProps interface (lines 6-23)
  - [x] 3.3 Add "Advanced Add..." menu item to renderEntityMenu
    - Add after existing "Add with X" options (after line 184)
    - Check visibility using hasExpandableRelationships from advancedAddRelationships.ts
    - Add separator before "Advanced Add..." item
    - data-testid: "context-menu-advanced-add"
  - [x] 3.4 Update PalettePanel to handle Advanced Add
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PalettePanel.tsx`
    - Add state for AdvancedAddDialog: `advancedAddDialogState: { isOpen: boolean; entity: {...} | null }`
    - Create handleAdvancedAdd callback to open dialog
    - Create handleAdvancedAddConfirm callback to process selections
    - Pass onAdvancedAdd prop to PaletteContextMenu (around line 1270)
  - [x] 3.5 Render AdvancedAddDialog in PalettePanel
    - Add AdvancedAddDialog component to PalettePanel render (after line 1296)
    - Pass required props: isOpen, onClose, onAdd, rootEntity, metaModel
  - [x] 3.6 Ensure context menu integration tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify menu item visibility and dialog opening work correctly

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- "Advanced Add..." appears only for entity types with expandable relationships
- Clicking menu item opens dialog with correct entity context
- Dialog properly closes on Cancel

---

### Backend - API Layer

#### Task Group 4: Advanced Add Expansion Endpoint
**Dependencies:** None (can run in parallel with Task Groups 1-3)

- [x] 4.0 Complete backend API layer
  - [x] 4.1 Write 6 focused tests for backend API
    - Test: POST /api/diagram/advanced-add-expansion returns nodes and edges for valid request
    - Test: Endpoint validates that root entity exists
    - Test: Endpoint validates that requested relationship paths are valid for entity type
    - Test: Response includes alreadyOnDiagram flag for existing items
    - Test: Graph traversal respects depth parameter
    - Test: Endpoint returns 400 for invalid rootEntityType
    - Test file: `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\test\java\com\example\archtool\service\DiagramExpansionServiceTest.java`
  - [x] 4.2 Create request/response DTOs
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\main\java\com\example\archtool\model\dto\diagram\AdvancedAddRequest.java`
    - Fields: rootEntityType, rootEntityId, diagramId, selections (List<SelectionDescriptor>)
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\main\java\com\example\archtool\model\dto\diagram\SelectionDescriptor.java`
    - Fields: relationshipType, direction (CHILD|PARENT|ASSOCIATION), depth
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\main\java\com\example\archtool\model\dto\diagram\AdvancedAddResponse.java`
    - Fields: nodes (List<NodeDescriptor>), edges (List<EdgeDescriptor>)
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\main\java\com\example\archtool\model\dto\diagram\NodeDescriptor.java`
    - Fields: entityType, entityId, entityName, alreadyOnDiagram
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\main\java\com\example\archtool\model\dto\diagram\EdgeDescriptor.java`
    - Fields: relationshipType, relationshipId, sourceEntityId, targetEntityId, alreadyOnDiagram
  - [x] 4.3 Create DiagramExpansionController
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\main\java\com\example\archtool\controller\DiagramExpansionController.java`
    - Follow patterns from ConfluenceDiagramController (lines 25-112 of existing controller)
    - POST endpoint: /api/diagram/advanced-add-expansion
    - Request body validation for required fields
    - Delegate to DiagramExpansionService
  - [x] 4.4 Create DiagramExpansionService
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\main\java\com\example\archtool\service\DiagramExpansionService.java`
    - Implement graph traversal logic
    - Traverse from root entity following specified relationship paths
    - Accumulate unique entity instances and relationship instances
    - Query diagram_nodes to determine alreadyOnDiagram status
  - [x] 4.5 Implement relationship path validation
    - Validate rootEntityType is a known entity type
    - Validate each selection's relationshipType is valid for the entity type
    - Return 400 Bad Request with descriptive error for invalid paths
  - [x] 4.6 Ensure backend API tests pass
    - Run ONLY the 6 tests written in 4.1
    - Verify endpoint returns correct response structure
    - Verify validation errors return appropriate status codes

**Acceptance Criteria:**
- The 6 tests written in 4.1 pass
- POST endpoint accepts and validates request body
- Graph traversal returns correct nodes and edges
- alreadyOnDiagram flag correctly identifies existing diagram items
- Invalid requests return 400 with descriptive error messages

---

### Frontend - API Integration & Diagram Update

#### Task Group 5: Frontend API Integration and Diagram Updates
**Dependencies:** Task Groups 2, 3, 4

- [x] 5.0 Complete frontend API integration and diagram update logic
  - [x] 5.1 Write 6 focused tests for API integration and diagram updates
    - Test: advancedAddExpansion function calls backend endpoint with correct request body
    - Test: Loading spinner appears during API call
    - Test: Error modal displays on API failure
    - Test: New nodes are created for items where alreadyOnDiagram is false
    - Test: Existing nodes are not duplicated when alreadyOnDiagram is true
    - Test: New nodes are positioned using compoundLayout utilities
    - Test file: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\advanced-add-integration.test.ts`
  - [x] 5.2 Create diagramApi.ts utility file
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\diagramApi.ts`
    - Create advancedAddExpansion async function
    - Signature: `(request: AdvancedAddRequest) => Promise<AdvancedAddResponse>`
    - Use fetch API to call POST /api/diagram/advanced-add-expansion
    - Handle network errors and non-2xx responses
  - [x] 5.3 Define TypeScript interfaces for API types
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\types\advancedAdd.ts`
    - SelectionDescriptor interface
    - AdvancedAddRequest interface
    - AdvancedAddResponse interface
    - NodeDescriptor interface
    - EdgeDescriptor interface
  - [x] 5.4 Implement handleAdvancedAddConfirm in PalettePanel
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PalettePanel.tsx`
    - Call advancedAddExpansion API function
    - Show loading state in dialog during API call
    - Handle API errors with ErrorModal
    - Close dialog on success
  - [x] 5.5 Create nodes and edges from API response
    - Filter response items where alreadyOnDiagram is false
    - Use createDiagramNodeFromEntity for each new node
    - Use createRelationshipEdge for each new edge
    - Reference existing patterns in PalettePanel.tsx (lines 726-751 for node creation)
  - [x] 5.6 Implement layout positioning for new nodes
    - Use calculateChildPositionWithHeights from compoundLayout.ts for parent/child relationships
    - Use getViewportCenter for root node positioning if not on diagram
    - Apply proper z-index using calculateZIndex
    - Reference existing compound add patterns (lines 763-796 in PalettePanel.tsx)
  - [x] 5.7 Add batch node addition
    - Use onAddNodes callback for atomic addition of multiple nodes
    - Add edges using onAddEdge for each edge (or implement batch onAddEdges if needed)
    - Reference existing batch add patterns (lines 800-802 in PalettePanel.tsx)
  - [x] 5.8 Ensure API integration tests pass
    - Run ONLY the 6 tests written in 5.1
    - Verify end-to-end flow works correctly

**Acceptance Criteria:**
- The 6 tests written in 5.1 pass
- API integration calls backend correctly
- Loading and error states display appropriately
- New nodes and edges are created correctly
- Duplicate nodes/edges are not created
- Layout positioning avoids overlapping existing content

---

### Testing

#### Task Group 6: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 4 tests written by Task Group 1 (relationship definitions)
    - Review the 6 tests written by Task Group 2 (AdvancedAddDialog component)
    - Review the 4 tests written by Task Group 3 (context menu integration)
    - Review the 6 tests written by Task Group 4 (backend API)
    - Review the 6 tests written by Task Group 5 (API integration)
    - Total existing tests: 26 tests
  - [x] 6.2 Analyze test coverage gaps for Advanced Add feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Prioritize end-to-end workflows over unit test gaps
    - Do NOT assess entire application test coverage
  - [x] 6.3 Write up to 8 additional strategic tests maximum
    - Integration test: Full flow from context menu -> dialog -> API -> diagram update
    - Integration test: Multiple entity types with different relationship kinds
    - Edge case: Adding entities when some related entities already on diagram
    - Edge case: Deeply nested relationship tree (3+ levels)
    - Error handling: API timeout scenario
    - Error handling: Invalid entity ID in request
    - UI: Tree expand/collapse behavior with many items
    - UI: Dialog scroll behavior with large tree
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to Advanced Add feature
    - Expected total: approximately 26-34 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 26-34 tests total)
- Critical user workflows for Advanced Add are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Relationship Definitions** (Frontend)
   - No dependencies, can start immediately
   - Foundation for tree building logic

2. **Task Group 4: Backend API** (Backend)
   - Can run in parallel with Task Groups 1-3
   - Independent of frontend work

3. **Task Group 2: AdvancedAddDialog Component** (Frontend)
   - Depends on Task Group 1 for relationship definitions
   - Core UI component

4. **Task Group 3: Context Menu Integration** (Frontend)
   - Depends on Task Group 2 for dialog component
   - Wires dialog into existing context menu

5. **Task Group 5: API Integration** (Frontend)
   - Depends on Task Groups 2, 3 (frontend) and 4 (backend)
   - Final integration layer

6. **Task Group 6: Test Review & Gap Analysis**
   - Depends on all previous task groups
   - Final validation pass

---

## Key File Locations

### Files Created
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\advancedAddRelationships.ts`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\AdvancedAddDialog.tsx`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\AdvancedAddDialog.module.css`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\diagramApi.ts`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\types\advancedAdd.ts`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\main\java\com\example\archtool\controller\DiagramExpansionController.java`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\main\java\com\example\archtool\service\DiagramExpansionService.java`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\main\java\com\example\archtool\model\dto\diagram\AdvancedAddRequest.java`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\main\java\com\example\archtool\model\dto\diagram\AdvancedAddResponse.java`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\main\java\com\example\archtool\model\dto\diagram\SelectionDescriptor.java`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\main\java\com\example\archtool\model\dto\diagram\NodeDescriptor.java`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\main\java\com\example\archtool\model\dto\diagram\EdgeDescriptor.java`

### Files Modified
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PaletteContextMenu.tsx` (lines 6-23, 152-186)
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PalettePanel.tsx` (lines 76-82, 1269-1286)

### Test Files Created
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\advanced-add-relationships.test.ts`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\advanced-add-dialog.test.ts`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\advanced-add-context-menu.test.ts`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\advanced-add-integration.test.ts`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\test\java\com\example\archtool\service\DiagramExpansionServiceTest.java`

### Reference Files (Read Only)
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\types\model.ts` - Entity and relationship type definitions
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\common\Modal.tsx` - Base modal component pattern
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\common\Modal.module.css` - Modal styling patterns
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\compoundLayout.ts` - Layout calculation utilities
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\types\contextMenu.ts` - Context menu type definitions
- `C:\Workspaces\SSD\architecture-store-and-diagrams\backend\src\main\java\com\example\archtool\controller\ConfluenceDiagramController.java` - Backend controller patterns

# Task Breakdown: Advanced Add - Merge Subtrees, App Point Process Chain, and Recursive Wrapping

## Overview
Total Tasks: 31

This feature enhances the Advanced Add dialog with three key improvements:
1. Tree node deduplication and subtree merging (max depth 10)
2. App Point to Process association chain visibility in the tree
3. Recursive wrapping from leaf nodes to root when placing nodes on the diagram

## Task List

### Tree Building Layer

#### Task Group 1: Node Deduplication and Subtree Merging
**Dependencies:** None

- [x] 1.0 Complete tree building with node deduplication
  - [x] 1.1 Write 2-8 focused tests for tree deduplication functionality
    - Test that same entity (entityType, entityId) appearing via multiple paths results in single tree node
    - Test that children from multiple paths are merged into single node's children array
    - Test Application -> App Component -> Service -> Interface merges with Application -> Service -> Interface
    - Test cycle detection prevents infinite loops
  - [x] 1.2 Add node lookup map to buildTreeData function
    - File: `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`
    - Create Map keyed by `${entityType}-${entityId}` to store created nodes
    - Check lookup before creating new nodes
  - [x] 1.3 Implement node reuse when duplicate entity discovered
    - When traversal finds entity already in lookup map, return existing node
    - Merge new child branches into existing node's children array
    - Ensure merged children are not duplicated
  - [x] 1.4 Add depth tracking parameter to recursive tree building
    - Pass depth parameter (starting at 0 for root) through recursive calls
    - Increment depth at each level of recursion
  - [x] 1.5 Implement max depth 10 enforcement
    - Stop expanding when depth exceeds 10
    - Do not render child nodes beyond depth 10
    - Optional: log when truncation occurs for debugging
  - [x] 1.6 Implement cycle detection using lookup map
    - Before traversing to a related entity, check if it would create a cycle back to an ancestor
    - Use lookup map to detect if entity is already on current traversal path
  - [x] 1.7 Ensure tree building tests pass
    - Run ONLY the 2-8 tests written in 1.1
    - Verify deduplication works correctly
    - Verify max depth enforcement works

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- Tree shows each entity only once regardless of traversal path
- Child branches from multiple paths are merged
- Tree depth never exceeds 10 levels
- No infinite loops from cyclic relationships

**Files to Modify:**
- `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` - buildTreeData function

---

### App Point Process Chain

#### Task Group 2: App Point to Process Association in Tree
**Dependencies:** Task Group 1

- [x] 2.0 Complete App Point to Process chain visibility
  - [x] 2.1 Write 2-8 focused tests for App Point to Process tree traversal
    - Test Application root shows Business Process children via App Point association
    - Test Business Process shows Process Activity children (parent/child)
    - Test relationship kind label shows "(association)" for App Point to Process
    - Test full chain: Application -> Business Process -> Process Activity appears in tree
  - [x] 2.2 Verify EXPANDABLE_RELATIONSHIPS includes App Point to Process
    - File: `frontend/src/utils/advancedAddRelationships.ts`
    - Confirm APPLICATION entry includes BUSINESS_PROCESS with relationshipKind 'ASSOCIATION'
    - Confirm relationshipTableName is 'application_point_business_processes'
  - [x] 2.3 Verify findRelatedEntities handles App Point to Process traversal
    - File: `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`
    - Confirm case for 'application_point_business_processes' correctly:
      - Gets application points for application
      - Queries application_point_business_processes for linked processes
      - Returns unique business process ids
  - [x] 2.4 Verify Business Process to Process Activity traversal works
    - Confirm BUSINESS_PROCESS entry in EXPANDABLE_RELATIONSHIPS includes PROCESS_ACTIVITY
    - Confirm findRelatedEntities handles process_activities lookup by business_process_id
  - [x] 2.5 Ensure App Point Process chain tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Verify full chain appears in tree for Application root
    - Verify relationship labels are correct

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- Application root shows Business Process children (via App Point association)
- Business Process nodes show Process Activity children
- Relationship kind "(association)" displays for App Point to Process link
- Full chain Application -> Business Process -> Process Activity visible

**Files to Modify:**
- `frontend/src/utils/advancedAddRelationships.ts` - verify EXPANDABLE_RELATIONSHIPS
- `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` - verify findRelatedEntities

---

### Recursive Wrapping Layer

#### Task Group 3: Ancestor Selection and Wrapping Infrastructure
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete ancestor selection and wrapping infrastructure
  - [x] 3.1 Write 2-8 focused tests for ancestor selection
    - Test selecting leaf node (e.g., Logical Data Entity) includes all ancestors to root
    - Test getAncestorKeys returns complete path from root to target node
    - Test selection of middle-level node includes ancestors but not unrelated branches
  - [x] 3.2 Verify getAncestorKeys helper covers all tree paths
    - File: `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`
    - Confirm recursive path finding works with merged subtrees
    - Ensure all ancestor keys are collected regardless of which path led to node
  - [x] 3.3 Update handleToggleSelection to use verified ancestor selection
    - Confirm selecting a node adds all ancestor keys to selectedKeys
    - Confirm deselecting removes node and descendants but not ancestors
  - [x] 3.4 Create helper to build ordered node list from leaf to root
    - Create function that takes selected keys and tree data
    - Returns array of nodes ordered from leaves up to root
    - Groups nodes by their parent relationship
  - [x] 3.5 Ensure ancestor selection tests pass
    - Run ONLY the 2-8 tests written in 3.1
    - Verify ancestor selection works correctly

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Selecting any leaf node implicitly includes all ancestors
- getAncestorKeys returns complete path to root
- Selection algorithm works with merged subtrees

**Files to Modify:**
- `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` - getAncestorKeys, handleToggleSelection

---

#### Task Group 4: Recursive Wrapping Implementation
**Dependencies:** Task Group 3

- [x] 4.0 Complete recursive wrapping from leaf to root
  - [x] 4.1 Write 2-8 focused tests for recursive wrapping
    - Test leaf node is positioned inside parent container
    - Test parent node has text_v_align='TOP' and text_font_weight='bold'
    - Test parent dimensions calculated using calculateParentSizeWithHeights
    - Test existing parent node is reused and resized (not duplicated)
  - [x] 4.2 Create recursive wrapping helper function
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Create function buildWrappedNodeHierarchy(selectedNodes, metaModel, diagram, viewportCenter)
    - Process nodes from leaves up to root
    - Return array of nodes with parent_node_id set correctly
  - [x] 4.3 Implement node existence check with nodeExistsForEntity
    - Use existing nodeExistsForEntity helper to check if ancestor already on diagram
    - If exists, reuse existing node as container
    - If not exists, create new node
  - [x] 4.4 Apply containment visual styling to parent nodes
    - Set text_v_align to 'TOP' for all parent nodes
    - Set text_font_weight to 'bold' for all parent nodes
    - Apply 5px padding (use PADDING constant from compoundLayout.ts)
  - [x] 4.5 Calculate child positions using calculateChildPositionWithHeights
    - File: `frontend/src/utils/compoundLayout.ts`
    - Use calculateChildPositionWithHeights for accurate child placement
    - Account for variable text heights in children
    - Use calculateApplicationLabelHeight for parent label heights
  - [x] 4.6 Calculate parent dimensions using calculateParentSizeWithHeights
    - Use calculateParentSizeWithHeights to size containers
    - Account for all children including newly added ones
    - Update existing parents with onUpdateNode if they need resizing
  - [x] 4.7 Ensure recursive wrapping tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Verify containment relationships are correct
    - Verify visual styling matches existing "Add with..." operations

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- Leaf nodes positioned inside parent containers
- Parent nodes have correct containment styling (bold, top-aligned)
- Existing diagram nodes reused as containers
- Parent dimensions calculated correctly

**Files to Modify:**
- `frontend/src/components/DiagramsView/PalettePanel.tsx` - new helper function, handleAdvancedAddConfirm
- `frontend/src/utils/compoundLayout.ts` - may need minor updates

---

#### Task Group 5: Integration with handleAdvancedAddConfirm
**Dependencies:** Task Group 4

- [x] 5.0 Complete integration of recursive wrapping with Advanced Add
  - [x] 5.1 Write 2-8 focused tests for end-to-end Advanced Add with wrapping
    - Test adding Application with selected Business Processes creates wrapped hierarchy
    - Test adding Service with selected Interfaces creates wrapped hierarchy
    - Test adding multiple levels (Application -> Service -> Interface) creates nested containment
    - Test idempotency: adding to diagram with existing nodes reuses them
  - [x] 5.2 Update handleAdvancedAddConfirm to use recursive wrapping
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Replace flat node addition with recursive wrapping logic
    - Call buildWrappedNodeHierarchy with selected nodes
    - Process returned nodes with correct z-index ordering
  - [x] 5.3 Handle batch node creation with proper ordering
    - Add nodes in parent-first order (parents before children)
    - Use onAddNodes for batch creation
    - Calculate z-index so children are above parents
  - [x] 5.4 Handle existing node updates
    - Identify existing nodes that need resizing
    - Call onUpdateNode for each existing parent that needs styling/sizing update
    - Preserve existing node positions when adding children
  - [x] 5.5 Verify integration does not break existing "Add with..." operations
    - Confirm handleAddWithBusinessProcesses still works
    - Confirm handleAddWithAppComponents still works
    - Confirm handleAddWithProcessActivities still works
  - [x] 5.6 Ensure end-to-end tests pass
    - Run ONLY the 2-8 tests written in 5.1
    - Verify complete workflow from dialog selection to diagram placement

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- Advanced Add creates proper containment hierarchy
- Existing diagram nodes are reused correctly
- Z-index ordering correct (children above parents)
- Existing "Add with..." context menu options unchanged

**Files to Modify:**
- `frontend/src/components/DiagramsView/PalettePanel.tsx` - handleAdvancedAddConfirm

---

### Testing

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 2-8 tests written for tree deduplication (Task 1.1)
    - Review the 2-8 tests written for App Point Process chain (Task 2.1)
    - Review the 2-8 tests written for ancestor selection (Task 3.1)
    - Review the 2-8 tests written for recursive wrapping (Task 4.1)
    - Review the 2-8 tests written for end-to-end integration (Task 5.1)
    - Total existing tests: approximately 10-40 tests
  - [x] 6.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize edge cases in tree merging and wrapping
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Add maximum of 10 new tests to fill identified critical gaps
    - Focus on integration points between tree building and diagram placement
    - Test edge cases: empty selections, very deep trees, many siblings
    - Skip comprehensive coverage for all scenarios
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 20-50 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-50 tests total)
- Critical user workflows for this feature are covered
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

**Test File Locations:**
- `frontend/src/__tests__/advanced-add-tree-building.test.ts` (new)
- `frontend/src/__tests__/advanced-add-app-point-process.test.ts` (new)
- `frontend/src/__tests__/advanced-add-ancestor-selection.test.ts` (new)
- `frontend/src/__tests__/advanced-add-recursive-wrapping.test.ts` (new)

---

## Execution Order

Recommended implementation sequence:

1. **Tree Building Layer (Task Group 1)** - Foundation for correct tree display
   - Node deduplication and max depth are prerequisites for all other features

2. **App Point Process Chain (Task Group 2)** - Extends tree content
   - Depends on Task Group 1 for correct tree structure

3. **Ancestor Selection Infrastructure (Task Group 3)** - Selection logic
   - Depends on Task Groups 1-2 for complete tree structure

4. **Recursive Wrapping Implementation (Task Group 4)** - Core wrapping logic
   - Depends on Task Group 3 for correct selection propagation

5. **Integration with handleAdvancedAddConfirm (Task Group 5)** - Wire everything together
   - Depends on Task Group 4 for wrapping helpers

6. **Test Review and Gap Analysis (Task Group 6)** - Final validation
   - Depends on all previous groups

---

## Key Code Patterns to Reuse

### From PalettePanel.tsx
- `handleAddWithBusinessProcesses` - Pattern for compound add with wrapping
- `handleAddWithAppComponents` - Pattern for compound add with wrapping
- `handleAddProcessActivity` - Pattern for auto-creating parent if needed

### From compoundLayout.ts
- `calculateChildPositionWithHeights` - Child positioning with variable heights
- `calculateParentSizeWithHeights` - Parent sizing to contain children
- `calculateApplicationLabelHeight` - Dynamic label height calculation
- `PADDING` constant (5px) - Consistent spacing

### From rendering.ts
- `supportsChildNodes` - Check if entity type can contain children
- `getParentEntityType` - Get parent type for child entity
- `isChildEntityType` - Check if entity should be contained

### From nodeCreation.ts
- `nodeExistsForEntity` - Check for duplicate nodes
- `createDiagramNodeFromEntity` - Create new diagram node
- `calculateZIndex` - Calculate proper z-index

---

## Out of Scope Reminders

The following are explicitly out of scope per the spec:
- Changes to meta-model semantics
- Changes to non-Advanced-Add context menu options
- Persisting user tree selections as templates
- Progressive expand/collapse on diagram canvas
- Preview visualization before confirming
- Keyboard navigation within tree
- Undo/redo integration
- Multi-select from palette
- Filter/search within tree
- Visual icons/colors to distinguish relationship types

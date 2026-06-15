# Task Breakdown: Advanced Add Hierarchical Layout

## Overview
Total Tasks: 23 sub-tasks across 4 task groups

This feature implements a recursive two-pass layout algorithm for Advanced Add that ensures diagram nodes are properly positioned with no overlaps. The algorithm uses bottom-up measurement followed by top-down positioning to create nested containment hierarchies that match the Advanced Add tree selection.

## Task List

### Algorithm Implementation Layer

#### Task Group 1: Core Layout Algorithm
**Dependencies:** None

- [x] 1.0 Complete core layout algorithm implementation
  - [x] 1.1 Write 4-6 focused tests for layout algorithm functionality
    - Test `measure()` function returns correct dimensions for leaf nodes
    - Test `measure()` function calculates correct dimensions for containers with children
    - Test `assignPositions()` positions siblings vertically without overlap
    - Test `assignPositions()` positions children inside parent with correct padding
    - Test `layoutAdvancedAddSelection()` produces correct layout for multi-level hierarchy
    - Test multi-branch layout (Application with both App Component and Business Process branches)
  - [x] 1.2 Add TypeScript interfaces to `frontend/src/types/advancedAdd.ts`
    - Add `MeasuredNode` interface with id, type, label, children, measuredWidth, measuredHeight
    - Add `LayoutNode` interface with id, type, label, x, y, width, height, children
    - Add `LayoutTreeNode` interface if not already present (id, type, label, children)
  - [x] 1.3 Add layout constants to `frontend/src/utils/compoundLayout.ts`
    - `PADDING_X = 20` (horizontal padding inside containers)
    - `PADDING_Y = 20` (vertical padding inside containers)
    - `CHILD_VERTICAL_GAP = 10` (vertical gap between siblings)
    - `LABEL_PADDING = 10` (space below parent label)
    - `MIN_NODE_WIDTH = 120` (minimum width for any node)
    - `MIN_NODE_HEIGHT = 40` (minimum height for leaf nodes)
    - `DEFAULT_FONT_SIZE = 12`
    - `CONTAINER_FONT_WEIGHT = 'bold'`
  - [x] 1.4 Implement `measure(node: LayoutTreeNode): MeasuredNode` function
    - Calculate label dimensions using existing `wrapText()` and `calculateTextBlockHeight()` utilities
    - Recursively measure children first (bottom-up)
    - For leaf nodes: size = max(MIN, label + padding)
    - For containers: width = max(label width, max child width) + 2 * PADDING_X
    - For containers: height = label height + LABEL_PADDING + sum(child heights) + gaps + 2 * PADDING_Y
    - Return MeasuredNode with computed dimensions
  - [x] 1.5 Implement `assignPositions(node: MeasuredNode, originX: number, originY: number): LayoutNode` function
    - Position root at specified origin
    - Calculate inner content area (width - 2 * PADDING_X)
    - Calculate label height for the container
    - Start child Y position below label with padding
    - For each child: center horizontally within inner area
    - Stack children vertically with CHILD_VERTICAL_GAP between them
    - Recursively position children
    - Return LayoutNode with absolute coordinates
  - [x] 1.6 Implement `layoutAdvancedAddSelection(rootTreeNode, viewportCenter): LayoutNode` function
    - Call `measure()` to get bottom-up dimensions
    - Calculate root origin (centered at viewport)
    - Call `assignPositions()` for top-down coordinate assignment
    - Return complete LayoutNode tree
  - [x] 1.7 Ensure layout algorithm tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify measure() produces correct dimensions
    - Verify assignPositions() produces non-overlapping coordinates
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- `measure()` calculates correct dimensions bottom-up
- `assignPositions()` places nodes top-down with no overlaps
- Multi-branch hierarchies are handled correctly
- Layout constants are exported for use by other modules

---

### Integration Layer

#### Task Group 2: Integration with PalettePanel
**Dependencies:** Task Group 1 (COMPLETED)

- [x] 2.0 Complete integration with PalettePanel
  - [x] 2.1 Write 3-5 focused tests for integration functionality
    - Test `convertTodiagramNodes()` creates correct DiagramNode array from LayoutNode tree
    - Test parent_node_id is correctly set for all children
    - Test z_index ordering (parents have lower z_index than children)
    - Test container styling (text_v_align='TOP', text_font_weight='bold') is applied
    - Test node reuse: existing diagram nodes are found and updated, not duplicated
  - [x] 2.2 Implement `convertTodiagramNodes(layoutNode: LayoutNode, zIndexBase: number): DiagramNode[]` function
    - Traverse layout tree depth-first
    - Increment z_index for each node (parents get lower z_index)
    - Create DiagramNode for each LayoutNode with:
      - id from generatePrefixedId('node')
      - entity_type from LayoutNode.type
      - entity_id from LayoutNode.id
      - pos_x, pos_y, width, height from LayoutNode
      - auto_size: false
      - z_index: incrementing counter
      - parent_node_id: from parent DiagramNode.id
      - Container nodes get text_v_align='TOP', text_font_weight='bold'
    - Return flat array of DiagramNodes
  - [x] 2.3 Implement node reuse logic in `buildWrappedNodeHierarchy()`
    - Check if entity already exists on diagram before creating new node
    - If exists: reuse existing node, update geometry if needed
    - If new: create via layout algorithm
    - Track created/reused nodes to set correct parent_node_id references
  - [x] 2.4 Refactor `buildWrappedNodeHierarchy()` to use new layout algorithm
    - Replace current positioning logic with `layoutAdvancedAddSelection()`
    - Convert tree structure from `TreeNodeData` to `LayoutTreeNode`
    - Call `convertTodiagramNodes()` to produce final nodes
    - Preserve existing node update logic for styling existing parents
  - [x] 2.5 Update `handleAdvancedAddConfirm()` callback in PalettePanel
    - Ensure it passes correct tree structure to buildWrappedNodeHierarchy
    - Verify viewport center is obtained correctly
    - Test with actual Advanced Add dialog selections
  - [x] 2.6 Ensure integration tests pass
    - Run ONLY the 3-5 tests written in 2.1
    - Verify diagram nodes are created with correct properties
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-5 tests written in 2.1 pass
- DiagramNodes are created with correct parent_node_id references
- z_index ordering ensures parents render behind children
- Container styling is applied to nodes with children
- Existing nodes are reused without duplication

---

### Utility Functions Layer

#### Task Group 3: Helper Function Updates
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete helper function updates
  - [x] 3.1 Write 2-4 focused tests for helper functions
    - Test label width estimation matches expected values
    - Test label height calculation with multi-line text wrapping
    - Test tree-to-LayoutTreeNode conversion produces correct structure
    - Test entity name lookup works for all supported entity types
  - [x] 3.2 Create or update `estimateLabelWidth()` helper function
    - Use existing `measureTextWidth()` from rendering.ts
    - Accept text, fontSize, fontWeight parameters
    - Return pixel width for label text
  - [x] 3.3 Create or update `estimateLabelHeight()` helper function
    - Use existing `wrapText()` and `calculateTextBlockHeight()` from rendering.ts
    - Accept text, maxWidth, fontSize, fontWeight parameters
    - Calculate number of lines when text wraps
    - Return pixel height for label text block
  - [x] 3.4 Create `convertTreeNodeToLayoutTree()` helper function
    - Convert TreeNodeData structure to LayoutTreeNode structure
    - Map entityType -> type, entityId -> id, entityName -> label
    - Recursively convert children
    - Return LayoutTreeNode suitable for layout algorithm
  - [x] 3.5 Ensure helper function tests pass
    - Run ONLY the 2-4 tests written in 3.1
    - Verify text measurement functions return reasonable values
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 3.1 pass
- Text measurement functions produce accurate estimates
- Tree conversion preserves all necessary data
- Helper functions are reusable across the codebase

---

### Testing Layer

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 14 tests written by Task Group 1 (layout algorithm) - file: `hierarchical-layout.test.ts`
    - Review the 9 tests written by Task Group 2 (integration) - file: `hierarchical-layout-integration.test.ts`
    - Review the 28 tests written by Task Group 3 (helper functions) - file: `hierarchical-layout-helper-functions.test.ts`
    - Total existing tests: 51 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identified critical user workflows that lacked test coverage
    - Focused ONLY on gaps related to hierarchical layout feature
    - Prioritized end-to-end workflows over unit test gaps
  - [x] 4.3 Write up to 8 additional strategic tests maximum
    - End-to-end test: Select multi-branch tree, verify no overlaps in result (ADDED)
    - End-to-end test: Re-run Advanced Add, verify idempotency (no duplicates) (ADDED)
    - Edge case: Single leaf node produces correct minimum dimensions (ADDED)
    - Edge case: Deeply nested hierarchy (5+ levels) positions correctly (ADDED)
    - Edge case: Long label text wraps and expands container appropriately (ADDED - 2 tests)
    - Integration test: Verify z-index increments through full hierarchy (ADDED)
    - Edge case: Empty children array handled correctly (ADDED)
    - End-to-end: Multiple siblings at leaf level stack correctly (ADDED)
    - Total new tests: 9 tests in `hierarchical-layout-gaps.test.ts`
  - [x] 4.4 Run feature-specific tests only
    - Ran all 4 test files related to hierarchical layout feature
    - Final total: 60 tests (51 existing + 9 new gap tests)
    - All 60 tests pass

**Acceptance Criteria:**
- All feature-specific tests pass (60 tests total)
- Critical user workflows for hierarchical layout are covered
- 9 additional tests added to fill testing gaps (within acceptable range)
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Core Layout Algorithm** - Implement the fundamental measure() and assignPositions() functions
2. **Task Group 2: Integration with PalettePanel** - Connect the new algorithm to the existing UI flow
3. **Task Group 3: Helper Function Updates** - Add supporting utilities for text measurement and tree conversion
4. **Task Group 4: Test Review and Gap Analysis** - Ensure comprehensive coverage of critical workflows

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/utils/compoundLayout.ts` | Add `measure()`, `assignPositions()`, `layoutAdvancedAddSelection()`, new layout constants |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Update `buildWrappedNodeHierarchy()` to use new layout algorithm |
| `frontend/src/types/advancedAdd.ts` | Add `MeasuredNode`, `LayoutNode`, `LayoutTreeNode` interfaces |
| `frontend/src/__tests__/hierarchical-layout.test.ts` | New test file for layout algorithm tests |
| `frontend/src/__tests__/hierarchical-layout-integration.test.ts` | New test file for integration tests (Task Group 2) |
| `frontend/src/__tests__/hierarchical-layout-helper-functions.test.ts` | New test file for helper function tests (Task Group 3) |
| `frontend/src/__tests__/hierarchical-layout-gaps.test.ts` | New test file for gap analysis tests (Task Group 4) |

## Key Implementation Notes

1. **Bottom-up then top-down**: The algorithm MUST measure leaves first before containers can know their size
2. **No overlap guarantee**: Mathematical positioning ensures siblings never overlap
3. **Reuse existing utilities**: Use `wrapText()`, `calculateTextBlockHeight()`, `measureTextWidth()` from rendering.ts
4. **Preserve existing patterns**: Follow existing node creation patterns with `generatePrefixedId()`, `calculateZIndex()`
5. **Containment styling**: Containers get `text_v_align: 'TOP'`, `text_font_weight: 'bold'`
6. **Idempotency**: Re-running Advanced Add should reuse existing nodes, not duplicate

# Task Breakdown: Fix Interface Custom Visualisation - Parent Wrapping and Advanced Add Integration

## Overview
Total Tasks: 28 tasks across 4 task groups

This implementation fixes two core issues:
1. **Parent Wrapping Issue**: Entity boxes appear outside the Interface border instead of inside it when using "Add with all children"
2. **Advanced Add Integration Issue**: Full hierarchy chains render Interface nodes with standard layout instead of custom contract layout

## Task List

### Phase 1: Parent Wrapping Fix (handleAddWithAllChildren)

#### Task Group 1: Fix Entity Positioning and Parent References
**Dependencies:** None
**Specialist:** Frontend TypeScript Developer

- [x] 1.0 Complete handleAddWithAllChildren parent wrapping fix
  - [x] 1.1 Write 4-6 focused tests for handleAddWithAllChildren entity positioning
    - Test: Entity nodes are positioned inside Interface bounds (pos_y within Interface height)
    - Test: Entity nodes have parent_node_id set to Interface node ID
    - Test: Interface height calculation includes space for child entities
    - Test: Interface width is calculated to accommodate entity box widths
    - Test: Entity boxes are horizontally centered within Interface
    - Reference existing pattern: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\add-with-all-children.test.ts`
  - [x] 1.2 Add size calculation functions to interfaceCustomRenderer.ts
    - Add `calculateInterfaceWithEntitiesHeight(headerHeight, endpointLines, entityHeights, padding)` function
    - Add `calculateInterfaceWithEntitiesWidth(headerWidth, endpointLineWidths, entityWidths, padding)` function
    - Export new constants: `INTERFACE_ENTITIES_SECTION_GAP`, `INTERFACE_ENTITY_GAP`
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\interfaceCustomRenderer.ts`
  - [x] 1.3 Update handleAddWithAllChildren to calculate correct Interface dimensions
    - Calculate total height: headerHeight + endpointSectionHeight + entitiesAreaHeight + padding
    - Calculate width to accommodate widest entity box plus padding
    - Apply calculated dimensions to interfaceNode before creating child nodes
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PalettePanel.tsx` (lines ~1723-1828)
  - [x] 1.4 Update handleAddWithAllChildren to position entities INSIDE Interface
    - Calculate childPosX: interfaceNode.pos_x + paddingX + ((entitiesAreaWidth - entityWidth) / 2)
    - Calculate childPosY: interfaceNode.pos_y + headerHeight + endpointSectionHeight + sectionGap + (childIndex * (entityHeight + gap))
    - Set entity nodes' parent_node_id to interfaceNode.id
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PalettePanel.tsx`
  - [x] 1.5 Add embedded_entity_ids to Interface node for rendering
    - Store logical entity IDs in Interface node's embedded_entity_ids field
    - This enables Canvas to identify child entities for custom rendering
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PalettePanel.tsx`
  - [x] 1.6 Ensure Task Group 1 tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify entity positioning is correct
    - Verify parent_node_id references are set
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Entity nodes are positioned inside the Interface bounds
- Entity nodes have parent_node_id set to Interface node ID
- Interface dimensions are calculated to wrap all child content
- embedded_entity_ids field is populated on Interface node

---

### Phase 2: Canvas Rendering Updates

#### Task Group 2: Update Canvas Interface Custom Rendering
**Dependencies:** Task Group 1
**Specialist:** Frontend React/SVG Developer

- [x] 2.0 Complete Canvas Interface custom rendering with child entities
  - [x] 2.1 Write 4-6 focused tests for Canvas Interface rendering with entities
    - Test: Interface with embedded_entity_ids renders entity boxes inside
    - Test: Entity boxes are positioned below endpoints section
    - Test: Entity boxes render with ERD-style (header + attributes)
    - Test: Correct z-index ordering (Interface background behind entity boxes)
    - Reference existing pattern: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\interface-custom-renderer.test.ts`
  - [x] 2.2 Add helper function to get child entity nodes for Interface
    - Create `getChildEntityNodesForInterface(interfaceNode, allNodes, metaModel)` function
    - Returns array of DiagramNode objects for entities with parent_node_id matching Interface
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\interfaceCustomRenderer.ts`
  - [x] 2.3 Extend Interface custom rendering in Canvas to render entity boxes
    - Locate Interface rendering block (lines ~2204-2264) in Canvas.tsx
    - After rendering endpoint lines, render entity boxes inside the Interface
    - Use ERD-style rendering for each entity box (header + attribute rows)
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\Canvas.tsx`
  - [x] 2.4 Calculate entity box positions within Interface
    - Position entities in entities section (below endpoints)
    - Support horizontal layout (side-by-side) if width permits
    - Apply consistent spacing and padding
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\Canvas.tsx`
  - [x] 2.5 Ensure child entity boxes are excluded from separate rendering
    - Nodes with parent_node_id pointing to an Interface with custom rendering should NOT render separately
    - Add check in renderNode function to skip these nodes
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\Canvas.tsx`
  - [x] 2.6 Ensure Task Group 2 tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify entity boxes render inside Interface
    - Verify ERD-style rendering is applied
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- Entity boxes render inside the Interface node (below endpoints)
- Entity boxes use ERD-style rendering (header + attributes)
- Child entity nodes are not duplicated as separate nodes on canvas

---

### Phase 3: Advanced Add Integration

#### Task Group 3: Custom Layout Detection and Integration
**Dependencies:** Task Groups 1 and 2
**Specialist:** Frontend TypeScript Developer

- [x] 3.0 Complete Advanced Add custom Interface layout integration
  - [x] 3.1 Write 4-6 focused tests for Interface custom layout detection
    - Test: isInterfaceCustomLayoutCandidate returns true for Interface + Endpoints selection
    - Test: isInterfaceCustomLayoutCandidate returns true for Interface + Logical Entities selection
    - Test: isInterfaceCustomLayoutCandidate returns false for Interface only (no children)
    - Test: Detection works for Interface nested in full hierarchy (App > Component > Service > Interface)
    - Reference existing pattern: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\erd-advanced-add.test.ts`
  - [x] 3.2 Create isInterfaceCustomLayoutCandidate function
    - Create new function in erdAdvancedAddUtils.ts (or new file)
    - Returns true when: node.entityType is INTERFACE AND has selected ENDPOINT or LOGICAL_DATA_ENTITY children
    - Export function for use in PalettePanel and compoundLayout
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\erdAdvancedAddUtils.ts`
  - [x] 3.3 Update buildWrappedNodeHierarchy to detect Interface custom candidates
    - Before calling layoutAdvancedAddSelection, identify Interface nodes that qualify for custom layout
    - For qualifying Interfaces: collect selected endpoints for embedded_endpoint_ids
    - For qualifying Interfaces: mark node for custom layout (customLayout: 'interface-contract')
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PalettePanel.tsx`
  - [x] 3.4 Update convertTodiagramNodes for Interface custom layout
    - When processing INTERFACE node with customLayout flag, add embedded_endpoint_ids
    - Add render_style: 'contract' to trigger custom rendering
    - Skip creating separate DiagramNodes for endpoints (they are embedded as text)
    - Create child entity nodes with parent_node_id set to Interface
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\compoundLayout.ts`
  - [x] 3.5 Update measure/measureWithGrid for Interface custom layout
    - When measuring Interface with custom layout, include endpoint list height
    - Include entity boxes height in Interface measurement
    - Return correct bounding box so parent containers wrap correctly
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\compoundLayout.ts`
  - [x] 3.6 Ensure Task Group 3 tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify custom layout detection works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Interface custom layout is detected when endpoints or entities are selected
- Advanced Add produces correct node structure with custom Interface rendering
- Parent containers correctly wrap the custom Interface node

---

### Phase 4: Test Review and Integration Verification

#### Task Group 4: Test Review, Gap Analysis, and Integration Testing
**Dependencies:** Task Groups 1-3
**Specialist:** QA/Test Engineer

- [x] 4.0 Review existing tests and verify full integration
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 tests written by Task Group 1 (handleAddWithAllChildren)
    - Review the 4-6 tests written by Task Group 2 (Canvas rendering)
    - Review the 4-6 tests written by Task Group 3 (Advanced Add detection)
    - Total existing tests: approximately 12-18 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify critical workflows lacking test coverage
    - Focus ONLY on gaps related to Interface custom visualisation
    - Prioritize end-to-end workflows over unit test gaps
    - Check edge cases: no endpoints, no entities, partial selections
  - [x] 4.3 Write up to 10 additional integration tests
    - Test: Full chain rendering (App > Component > Service > Interface > Endpoints + Entities)
    - Test: handleAddWithAllChildren and Advanced Add produce visually identical results
    - Test: Partial selection (some endpoints, some entities)
    - Test: Mixed selection with existing nodes on diagram
    - Test: Interface with no children renders as standard layout
    - Test: Z-index ordering is correct for all elements
    - Additional edge case tests as needed (max 10 total)
    - Reference existing pattern: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\custom-interface-integration.test.ts`
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to Interface custom visualisation
    - Include tests from 1.1, 2.1, 3.1, and 4.3
    - Expected total: approximately 22-28 tests
    - Verify all acceptance criteria from the spec are met
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 22-28 tests total)
- AC1: "Add with all children" correctly wraps entity boxes inside Interface
- AC2: Advanced Add detects custom layout for Interface + children selections
- AC3: Full hierarchy chain renders with custom Interface layout
- AC4: Partial selections work correctly
- AC5: handleAddWithAllChildren and Advanced Add produce identical visual results

---

## Test Summary

**Total Feature Tests: 68 passing**

| Test File | Tests | Description |
|-----------|-------|-------------|
| `interface-entity-positioning.test.ts` | 13 | Task Group 1: Entity positioning and parent references |
| `canvas-interface-entity-rendering.test.ts` | 15 | Task Group 2: Canvas rendering with embedded entities |
| `interface-custom-layout-detection.test.ts` | 11 | Task Group 3: Advanced Add custom layout detection |
| `interface-custom-renderer.test.ts` | 15 | Existing Interface custom rendering tests |
| `custom-interface-integration.test.ts` | 14 | Integration tests for complete flow |

---

## Files Modified Summary

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | 1, 3 | Fix handleAddWithAllChildren, update buildWrappedNodeHierarchy |
| `frontend/src/components/DiagramsView/Canvas.tsx` | 2 | Update Interface custom rendering to include child entities |
| `frontend/src/utils/compoundLayout.ts` | 3 | Update convertTodiagramNodes, update measure functions |
| `frontend/src/utils/interfaceCustomRenderer.ts` | 1, 2 | Add size calculation functions, add helper for child entities |
| `frontend/src/utils/erdAdvancedAddUtils.ts` | 3 | Add isInterfaceCustomLayoutCandidate function |
| `frontend/src/types/model.ts` | - | Verify embedded_entity_ids field exists (already present) |

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Parent Wrapping Fix** (Phase 1) - COMPLETE
   - Fix the immediate issue with handleAddWithAllChildren
   - Entity positioning and parent references
   - Size calculation utilities

2. **Task Group 2: Canvas Rendering** (Phase 2) - COMPLETE
   - Update Canvas to render entity boxes inside Interface
   - ERD-style rendering for embedded entities

3. **Task Group 3: Advanced Add Integration** (Phase 3) - COMPLETE
   - Detection of Interface custom layout candidates
   - Integration with layout algorithm
   - Measurement updates for correct wrapping

4. **Task Group 4: Integration Testing** (Phase 4) - COMPLETE
   - Review all tests
   - Fill critical gaps
   - End-to-end verification

---

## Risk Notes

- **Backward Compatibility**: Interfaces without custom layout (no endpoints/entities) should continue to render normally
- **Z-Index Ordering**: Ensure parent Interface has lower z-index than child entity boxes
- **Performance**: Entity rendering inside Interface should not impact canvas performance (typically small entity count)
- **Edge Cases**: Handle empty endpoints list, empty entities list, and combinations gracefully

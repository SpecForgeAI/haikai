# Task Breakdown: ERD/UML-Style Rendering for Logical & Physical Entities With Attributes

## Overview
Total Tasks: 24 sub-tasks across 5 task groups

This feature introduces ERD/UML-style rendering for Logical and Physical Entities when added with their attributes. The entity displays as a single class-box with entity name header, divider line, and attribute rows.

## Task List

### Type Definitions Layer

#### Task Group 1: Extend DiagramNode Type for ERD Rendering
**Dependencies:** None

- [x] 1.0 Complete type extensions for ERD rendering
  - [x] 1.1 Write 4-5 focused tests for type extensions
    - Test DiagramNode has optional `render_style` field
    - Test `render_style` accepts 'standard' | 'erd' values
    - Test DiagramNode has optional `embedded_attribute_ids` field
    - Test `embedded_attribute_ids` is string array type
    - **Test file:** `frontend/src/__tests__/erd-node-types.test.ts`
  - [x] 1.2 Add `render_style` field to DiagramNode interface
    - Location: `frontend/src/types/model.ts`
    - Add: `render_style?: 'standard' | 'erd';`
    - Add JSDoc comment explaining the field
  - [x] 1.3 Add `embedded_attribute_ids` field to DiagramNode interface
    - Add: `embedded_attribute_ids?: string[];`
    - Add JSDoc comment: "For ERD-style: attribute IDs rendered inside this node"
  - [x] 1.4 Ensure Task Group 1 tests pass
    - Run: `cd frontend && npm test -- erd-node-types.test.ts`

**Acceptance Criteria:**
- DiagramNode type extended with new fields
- TypeScript compiles without errors
- Tests verify type structure

**Files to modify:**
- `frontend/src/types/model.ts`
- `frontend/src/__tests__/erd-node-types.test.ts` (new)

---

### Utility Functions Layer

#### Task Group 2: Create ERD Utility Functions
**Dependencies:** Task Group 1

- [x] 2.0 Complete ERD utility functions
  - [x] 2.1 Write 5-6 focused tests for ERD utilities
    - Test `getAttributesForEntity` returns attributes for logical entity
    - Test `getAttributesForEntity` returns attributes for physical entity
    - Test `getAttributesByIds` returns filtered attributes
    - Test `calculateERDNodeSize` calculates correct dimensions
    - Test `formatAttribute` formats "name : type" correctly
    - Test `formatAttribute` handles missing type
    - **Test file:** `frontend/src/__tests__/erd-utils.test.ts`
  - [x] 2.2 Create `erdUtils.ts` file
    - Location: `frontend/src/utils/erdUtils.ts`
    - Export utility functions for ERD rendering
  - [x] 2.3 Implement `getAttributesForEntity` function
    - Query metaModel for logical_data_attributes or physical_data_attributes
    - Filter by entity ID (logical_entity_id or physical_entity_id)
    - Return array of { id, name, data_type }
  - [x] 2.4 Implement `getAttributesByIds` function
    - Accept attributeIds array and parent entity type
    - Filter metaModel attributes by ID set
    - Return matching attributes
  - [x] 2.5 Implement `calculateERDNodeSize` function
    - Accept entity name, attributes array, spacing preset
    - Calculate width from longest text (name vs attributes)
    - Calculate height from header + rows + padding
    - Return { width, height }
  - [x] 2.6 Implement `formatAttribute` helper
    - Format as "name : type" if type exists
    - Format as "name" if no type
  - [x] 2.7 Ensure Task Group 2 tests pass
    - Run: `cd frontend && npm test -- erd-utils.test.ts`

**Acceptance Criteria:**
- All utility functions implemented and exported
- Functions handle both logical and physical entities
- Sizing calculation respects spacing presets

**Files to modify:**
- `frontend/src/utils/erdUtils.ts` (new)
- `frontend/src/__tests__/erd-utils.test.ts` (new)

---

### Context Menu Layer

#### Task Group 3: Add "Add with attributes" Context Menu Option
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete context menu implementation
  - [x] 3.1 Write 4-5 focused tests for context menu
    - Test menu shows "Add with attributes" for logical_data_entities section
    - Test menu shows "Add with attributes" for physical_data_entities section
    - Test menu does NOT show option for other entity types
    - Test clicking option calls onAddWithAttributes handler
    - Test menu closes after click
    - **Test file:** `frontend/src/__tests__/erd-context-menu.test.ts`
  - [x] 3.2 Add `onAddWithAttributes` prop to PaletteContextMenu
    - Location: `frontend/src/components/DiagramsView/PaletteContextMenu.tsx`
    - Add prop: `onAddWithAttributes?: (item: PaletteItemData, sectionId: string) => void`
  - [x] 3.3 Add menu item for data entities
    - Check `sectionId === 'logical_data_entities' || sectionId === 'physical_data_entities'`
    - Render "Add with attributes" menu item
    - Call `onAddWithAttributes` on click
  - [x] 3.4 Implement `handleAddWithAttributes` in PalettePanel
    - Location: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Query attributes from metaModel using `getAttributesForEntity`
    - Calculate ERD node size using `calculateERDNodeSize`
    - Create DiagramNode with `render_style: 'erd'` and `embedded_attribute_ids`
    - Dispatch ADD_DIAGRAM_NODE action
  - [x] 3.5 Pass handler to PaletteContextMenu
    - Pass `onAddWithAttributes={handleAddWithAttributes}` prop
  - [x] 3.6 Ensure Task Group 3 tests pass
    - Run: `cd frontend && npm test -- erd-context-menu.test.ts`

**Acceptance Criteria:**
- "Add with attributes" option appears for data entities only
- Handler creates ERD-style node with all attributes
- Node added to diagram with correct dimensions

**Files to modify:**
- `frontend/src/components/DiagramsView/PaletteContextMenu.tsx`
- `frontend/src/components/DiagramsView/PalettePanel.tsx`
- `frontend/src/__tests__/erd-context-menu.test.ts` (new)

---

### Advanced Add Layer

#### Task Group 4: Update Advanced Add for ERD-Style
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete Advanced Add ERD support
  - [x] 4.1 Write 5-6 focused tests for Advanced Add ERD
    - Test selecting entity + attributes produces ERD-style node
    - Test selecting entity only produces standard node
    - Test ERD node has correct embedded_attribute_ids
    - Test multiple attributes collapse into single ERD box
    - Test findERDCandidates identifies logical entities with attributes
    - Test findERDCandidates identifies physical entities with attributes
    - **Test file:** `frontend/src/__tests__/erd-advanced-add.test.ts`
  - [x] 4.2 Add `findERDCandidates` function
    - Location: `frontend/src/utils/erdAdvancedAddUtils.ts`
    - Find Logical/Physical Entities with selected attribute children
    - Return array of { entity: TreeNodeData, attributes: TreeNodeData[] }
  - [x] 4.3 Modify `buildWrappedNodeHierarchy` for ERD detection
    - Call `findERDCandidates` on orderedNodes
    - If ERD candidates exist, process them separately
    - Create ERD-style nodes instead of hierarchical containment
  - [x] 4.4 Implement `buildWithERDNodes` function
    - Create ERD nodes for entities with attributes
    - Process remaining nodes normally
    - Return combined { nodesToAdd, nodesToUpdate }
  - [x] 4.5 Update node creation for ERD candidates
    - Set `render_style: 'erd'`
    - Set `embedded_attribute_ids` from selected attributes
    - Calculate size using `calculateERDNodeSize`
    - Exclude attribute nodes from normal rendering
  - [x] 4.6 Ensure Task Group 4 tests pass
    - Run: `cd frontend && npm test -- erd-advanced-add.test.ts`

**Acceptance Criteria:**
- Entity + attributes selection produces ERD-style box
- Attributes not rendered as separate child nodes
- Entity-only selection produces standard node

**Files to modify:**
- `frontend/src/utils/erdAdvancedAddUtils.ts` (new)
- `frontend/src/__tests__/erd-advanced-add.test.ts` (new)

---

### Canvas Rendering Layer

#### Task Group 5: Implement ERD-Style Canvas Rendering
**Dependencies:** Task Groups 1-4

- [x] 5.0 Complete ERD canvas rendering
  - [x] 5.1 Write 5-6 focused tests for ERD rendering
    - Test `shouldRenderAsERD` returns true for ERD-style data entities
    - Test `shouldRenderAsERD` returns false for standard nodes
    - Test ERD node renders entity name in header
    - Test ERD node renders divider line
    - Test ERD node renders attribute rows
    - Test ERD node renders selection indicator when selected
    - **Test file:** `frontend/src/__tests__/erd-canvas-rendering.test.ts`
  - [x] 5.2 Add `shouldRenderAsERD` helper function
    - Check `node.render_style === 'erd'`
    - Check entity type is LOGICAL_DATA_ENTITY or PHYSICAL_DATA_ENTITY
  - [x] 5.3 Add rendering dispatch in Canvas node map
    - Location: `frontend/src/components/DiagramsView/Canvas.tsx` (around line 2370)
    - If `shouldRenderAsERD(node)`, render ERD-style node
    - Otherwise use existing standard rendering
  - [x] 5.4 Implement `renderERDNode` function
    - Render outer rectangle with entity colors
    - Render entity name (bold, centered) in header compartment
    - Render horizontal divider line
    - Render attribute rows (left-aligned, formatted)
    - Render selection indicator if selected
    - Render resize handles if selected
  - [x] 5.5 Import erdUtils in Canvas.tsx
    - Import `getAttributesByIds`, `formatAttribute` from erdUtils
    - Use to query and format attributes for rendering
  - [x] 5.6 Ensure ERD node respects styling
    - Use node colors (background_color, line_color, text_color)
    - Fall back to entity type defaults
  - [x] 5.7 Ensure Task Group 5 tests pass
    - Run: `cd frontend && npm test -- erd-canvas-rendering.test.ts`

**Acceptance Criteria:**
- ERD-style nodes render with header, divider, attributes
- Standard nodes continue to render normally
- ERD nodes support selection, resize, styling

**Files to modify:**
- `frontend/src/components/DiagramsView/Canvas.tsx`
- `frontend/src/__tests__/erd-canvas-rendering.test.ts` (new)

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type Definitions** - Extend DiagramNode interface
2. **Task Group 2: Utility Functions** - Create erdUtils.ts with helpers
3. **Task Group 3: Context Menu** - Add "Add with attributes" option
4. **Task Group 4: Advanced Add** - Detect and handle ERD candidates
5. **Task Group 5: Canvas Rendering** - Render ERD-style nodes

## Files Summary

| File | Changes |
|------|---------|
| `frontend/src/types/model.ts` | Add `render_style` and `embedded_attribute_ids` to DiagramNode |
| `frontend/src/utils/erdUtils.ts` | New file: attribute queries, sizing, formatting |
| `frontend/src/utils/erdAdvancedAddUtils.ts` | New file: ERD candidate detection for Advanced Add |
| `frontend/src/components/DiagramsView/PaletteContextMenu.tsx` | Add "Add with attributes" menu item |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Add handler, modify Advanced Add |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Add ERD rendering dispatch and function |

**New Test Files:**
| File | Purpose |
|------|---------|
| `frontend/src/__tests__/erd-node-types.test.ts` | Type definition tests |
| `frontend/src/__tests__/erd-utils.test.ts` | Utility function tests |
| `frontend/src/__tests__/erd-context-menu.test.ts` | Context menu tests |
| `frontend/src/__tests__/erd-advanced-add.test.ts` | Advanced Add ERD tests |
| `frontend/src/__tests__/erd-canvas-rendering.test.ts` | Canvas rendering tests |

## Key Implementation Notes

1. **ERD Header Height**: Fixed at 30px for name compartment
2. **Attribute Row Height**: Fixed at 20px per row
3. **Minimum Width**: 150px for ERD nodes
4. **Attribute Format**: "name : type" or just "name" if no type

5. **Entity Type Constants**:
   - `ENTITY_TYPES.LOGICAL_DATA_ENTITY`
   - `ENTITY_TYPES.PHYSICAL_DATA_ENTITY`
   - `ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE`
   - `ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE`

6. **Spacing Preset Support**: ERD sizing should use active preset for padding

7. **Selection**: Only entity box is selectable, not individual attribute rows

8. **Persistence**: `render_style` and `embedded_attribute_ids` save to JSON

## Test Count Summary

| Task Group | Test Count | Focus Area |
|------------|------------|------------|
| TG1: Types | 12 tests | Type definitions |
| TG2: Utilities | 20 tests | erdUtils functions |
| TG3: Context Menu | 11 tests | Menu option, handler |
| TG4: Advanced Add | 7 tests | ERD detection, node creation |
| TG5: Rendering | 13 tests | Canvas ERD rendering |
| **Total** | **63 tests** | Full feature coverage |

## Visual Reference

### ERD-Style Node

```
+----------------------------+
|     Customer Entity        |  <- Header (bold, centered)
+----------------------------+  <- Divider line (1px)
| customer_id : INTEGER      |  <- Attribute rows
| name : VARCHAR(100)        |     (left-aligned)
| email : VARCHAR(255)       |
| created_at : TIMESTAMP     |
+----------------------------+
```

### Standard Node (unchanged)

```
+----------------------------+
|     Customer Entity        |
+----------------------------+
```

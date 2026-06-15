# Specification: Fix Interface Custom Visualisation – Parent Wrapping and Advanced Add Integration

## Overview

This specification fixes two issues with the Interface custom visualisation:

1. **Parent Wrapping Issue**: When "Add with all children" is used, the Interface box does NOT wrap its child entity boxes. The entity boxes appear visually below and outside the Interface border instead of inside it.

2. **Advanced Add Integration Issue**: In Advanced Add, when a full chain is selected (Application → Component → Service → Interface → Logical Entities → Endpoints), the Interface renders using the standard layout with separate child boxes instead of the custom Interface layout (header + numbered endpoints list + ERD-style entities inside).

## Current Implementation Analysis

### handleAddWithAllChildren (PalettePanel.tsx:1723-1828)

The current implementation has these problems:

```typescript
// Entity nodes positioned BELOW the interface (WRONG)
const childPosY = interfaceNode.pos_y + interfaceHeight + 20 + (childIndex * (entityHeight + 10));

// Entity nodes have no parent reference (WRONG)
const entityNode: DiagramNode = {
  ...
  parent_node_id: null,  // Should be interfaceNode.id
  ...
};
```

### convertTodiagramNodes (compoundLayout.ts:546-614)

The function creates diagram nodes from the layout tree but has no special handling for INTERFACE nodes with custom rendering. It treats INTERFACE like any other container type.

### Canvas.tsx Interface Rendering (lines 2205-2264)

The custom Interface rendering in Canvas.tsx only renders:
- Interface background/border
- Header with interface name
- Divider line
- Endpoint text lines

It does NOT render child entity boxes inside the Interface - those are rendered as separate nodes positioned outside.

## Required Changes

### Issue 1: Parent Wrapping Fix

#### 1.1 Update handleAddWithAllChildren

**File**: `frontend/src/components/DiagramsView/PalettePanel.tsx`

**Changes**:
1. Calculate Interface size to include entity boxes:
   ```
   interfaceHeight = headerHeight + endpointSectionHeight + entitiesAreaHeight + padding
   ```

2. Position entity boxes INSIDE the Interface:
   ```
   childPosX = interfaceNode.pos_x + paddingX + ((entitiesAreaWidth - entityWidth) / 2)
   childPosY = interfaceNode.pos_y + headerHeight + endpointSectionHeight + sectionGap + (childIndex * (entityHeight + gap))
   ```

3. Set entity nodes' `parent_node_id` to the Interface node's ID

4. Store entity IDs in a new `embedded_entity_ids` field on the Interface node (for rendering)

#### 1.2 Update Canvas Interface Rendering

**File**: `frontend/src/components/DiagramsView/Canvas.tsx`

**Changes**:
1. When rendering an Interface with custom layout, render child entity boxes INSIDE the Interface rectangle
2. Use the `embedded_entity_ids` or lookup child nodes by `parent_node_id`
3. Draw entity boxes in the entities section (below endpoints)
4. Each entity box should use ERD-style rendering (header + attributes)

#### 1.3 Size Calculation Updates

**File**: `frontend/src/utils/interfaceCustomRenderer.ts`

**New functions**:
- `calculateInterfaceWithEntitiesHeight(headerHeight, endpointLines, entityHeights)` - Total Interface height including entities
- `calculateInterfaceWithEntitiesWidth(headerWidth, endpointLineWidths, entityWidths, padding)` - Interface width

### Issue 2: Advanced Add Integration

#### 2.1 Detect Custom Interface Selection

**File**: `frontend/src/utils/erdAdvancedAddUtils.ts` (or new file)

**New function**: `isInterfaceCustomLayoutCandidate(node, selectedKeys)`

Returns true when:
- Node's entityType is INTERFACE
- At least one selected child is an ENDPOINT, OR
- At least one selected child is a LOGICAL_DATA_ENTITY (with or without attributes)

#### 2.2 Update buildWrappedNodeHierarchy

**File**: `frontend/src/components/DiagramsView/PalettePanel.tsx`

**Changes**:
1. Before calling `layoutAdvancedAddSelection`, check for Interface custom layout candidates
2. For each Interface that qualifies:
   - Collect selected endpoints → store in `embedded_endpoint_ids`
   - Collect selected logical entities → create as child nodes with ERD rendering
   - Filter these children from the normal layout tree (they become embedded, not separate nodes)
3. Mark the Interface node for custom layout

#### 2.3 Update convertTodiagramNodes

**File**: `frontend/src/utils/compoundLayout.ts`

**Changes**:
1. When processing an INTERFACE node, check if it should use custom layout
2. If custom layout:
   - Add `embedded_endpoint_ids` to the DiagramNode
   - Add `render_style: 'contract'` to trigger custom rendering
   - Skip creating separate nodes for endpoints (they're embedded as text)
   - Create child entity nodes with `parent_node_id` set to the Interface

#### 2.4 Update Layout Measurement

**File**: `frontend/src/utils/compoundLayout.ts`

**Changes to measure() or measureWithGrid()**:
1. When measuring an Interface with custom layout:
   - Include endpoint list height in the Interface's height
   - Include entity boxes height in the Interface's height
   - Return the total bounding box so parent containers wrap correctly

## Data Model

### DiagramNode Fields for Custom Interface

```typescript
interface DiagramNode {
  // Existing fields...

  // Custom Interface rendering fields
  render_style?: 'contract' | 'erd' | undefined;  // 'contract' = custom Interface layout
  embedded_endpoint_ids?: string[];               // Endpoints to show as text lines
  embedded_entity_ids?: string[];                 // Entity IDs contained inside (optional)
  embedded_attribute_ids?: string[];              // Attributes for ERD rendering (existing)
}
```

### Layout Tree Changes

The LayoutTreeNode for Interface nodes with custom layout:
```typescript
interface LayoutTreeNode {
  // Existing fields...

  // For custom Interface layout
  customLayout?: 'interface-contract';
  embeddedEndpointIds?: string[];
}
```

## Visual Layout Specification

### Interface with Custom Layout

```
+------------------------------------------+
|            Interface Name                |  <- Header (bold, centered)
+------------------------------------------+
| 1. GET /users/{id} - Get User           |  <- Endpoint lines
| 2. POST /users - Create User            |     (left-aligned, numbered)
| 3. DELETE /users/{id} - Delete User     |
+------------------------------------------+
|  +----------------+  +----------------+  |  <- Entity boxes (ERD-style)
|  | CustomerDTO    |  | AddressDTO     |  |     inside Interface
|  |----------------|  |----------------|  |
|  | id: number     |  | street: string |  |
|  | name: string   |  | city: string   |  |
|  | email: string  |  | zip: string    |  |
|  +----------------+  +----------------+  |
+------------------------------------------+
```

### Spacing Constants

```typescript
const INTERFACE_HEADER_HEIGHT = 24;      // Height of header section
const INTERFACE_SECTION_GAP = 8;         // Gap between sections
const INTERFACE_PADDING_X = 10;          // Horizontal padding
const INTERFACE_PADDING_Y = 10;          // Vertical padding (top/bottom)
const ENTITY_GAP = 10;                   // Gap between entity boxes
```

### Size Calculation Formula

```typescript
// Interface height
interfaceHeight =
  INTERFACE_PADDING_Y +                    // Top padding
  INTERFACE_HEADER_HEIGHT +                // Header
  (endpointLines.length > 0 ?
    ENDPOINT_SECTION_PADDING * 2 +
    endpointLines.length * ENDPOINT_LINE_HEIGHT : 0) +  // Endpoints section
  (entityBoxes.length > 0 ?
    INTERFACE_SECTION_GAP +
    totalEntityBoxesHeight +
    (entityBoxes.length - 1) * ENTITY_GAP : 0) +  // Entities section
  INTERFACE_PADDING_Y;                     // Bottom padding

// Interface width
interfaceWidth = Math.max(
  minHeaderWidth,
  maxEndpointLineWidth + INTERFACE_PADDING_X * 2,
  totalEntityBoxesWidth + INTERFACE_PADDING_X * 2
);
```

## Acceptance Criteria

### AC1: "Add with all children" Parent Wrapping
- [ ] Interface box fully wraps the endpoint list lines
- [ ] Interface box fully wraps all entity ERD boxes
- [ ] No entity boxes appear visually outside the Interface border
- [ ] Entity nodes have `parent_node_id` set to the Interface node's ID
- [ ] Entity boxes are positioned inside the Interface content area

### AC2: Advanced Add Custom Layout Detection
- [ ] Selecting Interface + Endpoints triggers custom layout
- [ ] Selecting Interface + Logical Entities triggers custom layout
- [ ] Selecting Interface + Endpoints + Logical Entities triggers custom layout
- [ ] Selecting only Interface (no children) uses standard layout
- [ ] Detection works at any depth in the hierarchy (App → ... → Interface)

### AC3: Advanced Add Rendering Parity
- [ ] Full chain (App → Component → Service → Interface → children) renders correctly
- [ ] Application wraps Component wraps Service wraps custom Interface
- [ ] Custom Interface shows header + numbered endpoints + ERD entities
- [ ] No separate endpoint boxes are created
- [ ] Logical Entity boxes render with ERD style inside Interface

### AC4: Partial Selection Handling
- [ ] Only selected endpoints appear in the endpoint list
- [ ] Only selected entities appear as ERD boxes
- [ ] Only selected attributes appear in entity ERD boxes
- [ ] Mixed partial selections work correctly

### AC5: Visual Consistency
- [ ] "Add with all children" and Advanced Add produce identical results
- [ ] Custom Interface layout matches the visual specification
- [ ] Proper spacing between sections
- [ ] Correct z-index ordering (Interface → child entities)

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Fix handleAddWithAllChildren, update buildWrappedNodeHierarchy |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Update Interface custom rendering to include child entities |
| `frontend/src/utils/compoundLayout.ts` | Update convertTodiagramNodes, update measure functions |
| `frontend/src/utils/interfaceCustomRenderer.ts` | Add size calculation functions for Interface with entities |
| `frontend/src/utils/erdAdvancedAddUtils.ts` | Add isInterfaceCustomLayoutCandidate function |
| `frontend/src/types/model.ts` | Verify embedded_entity_ids field exists |

## Test Coverage

### Unit Tests
- Test `isInterfaceCustomLayoutCandidate()` with various selection combinations
- Test Interface size calculations with entities
- Test entity positioning inside Interface

### Integration Tests
- Test "Add with all children" produces correct node structure
- Test Advanced Add with full hierarchy produces custom Interface layout
- Test partial selections produce correct subset rendering
- Test parent containers correctly wrap custom Interface nodes

## Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| Breaking existing Interface rendering | Medium | Ensure backward compatibility for Interfaces without custom layout |
| Layout algorithm complexity | Medium | Thorough unit tests for measurement and positioning |
| Canvas rendering performance | Low | Entity count inside Interface is typically small |
| Z-index conflicts | Low | Follow existing z-index rules |

## Implementation Order

1. **Phase 1**: Fix handleAddWithAllChildren (Issue 1 quick fix)
   - Update positioning to place entities inside
   - Update parent_node_id references
   - Update Canvas to render child entities

2. **Phase 2**: Add detection and integration for Advanced Add (Issue 2)
   - Add isInterfaceCustomLayoutCandidate
   - Update buildWrappedNodeHierarchy
   - Update convertTodiagramNodes

3. **Phase 3**: Size calculation refinements
   - Add proper Interface sizing functions
   - Update layout measurement for parent wrapping

4. **Phase 4**: Testing and edge cases
   - Comprehensive test coverage
   - Edge case handling (no endpoints, no entities, etc.)

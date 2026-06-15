# ERD/UML-Style Rendering for Logical & Physical Entities With Attributes

## Overview

This specification introduces a new rendering style for Logical Entities and Physical Entities when they are added to the diagram together with their attributes. Instead of rendering attributes as separate nested child boxes, the entity displays as a single ERD/UML-style class box:

- **Top compartment**: Entity name (centered, bold)
- **Divider line**: 1px horizontal stroke
- **Lower compartment**: Vertical list of attribute rows (text only, no boxes)

Two mechanisms trigger this rendering:
1. **"Add with attributes"** context menu option on RHS panel
2. **Advanced Add** when entity + attributes are both selected

---

## Current State Analysis

### Existing Implementation

1. **Node Rendering** (`Canvas.tsx:2256-2406`):
   - All nodes render as standard rectangles (except BUSINESS_USER which is a stick figure)
   - No concept of rendering modes currently exists
   - Colors defined per entity type in `config/defaults.ts`

2. **DiagramNode Structure** (`model.ts:595-620`):
   - Has `parent_node_id` for containment relationships
   - No field for rendering style/mode
   - Supports text styling, colors, and positioning

3. **RHS Panel Context Menu** (`PaletteContextMenu.tsx`):
   - Already has extended options for specific entity types:
     - APPLICATION: "Add with business processes", "Add with app components"
     - BUSINESS_PROCESS: "Add with process activities"
   - Pattern exists for adding entity-specific context menu options

4. **Advanced Add** (`AdvancedAddDialog.tsx`, `PalettePanel.tsx`):
   - Tree-based selection of entities and children
   - Attributes already defined as children in `EXPANDABLE_RELATIONSHIPS`:
     - `LOGICAL_DATA_ENTITY` → `LOGICAL_DATA_ATTRIBUTE`
     - `PHYSICAL_DATA_ENTITY` → `PHYSICAL_DATA_ATTRIBUTE`
   - Currently renders attributes as separate child boxes when both are selected

5. **Attribute Data Model**:
   - `logical_data_attributes` table: FK `logical_entity_id` → parent entity
   - `physical_data_attributes` table: FK `physical_entity_id` → parent entity
   - Attributes have `name` and `data_type` fields

### Current Gaps

1. No ERD-style rendering mode for nodes
2. No "Add with attributes" option in context menu
3. Advanced Add renders attributes as separate boxes, not embedded rows

---

## Specification

### 1. Extend DiagramNode with Rendering Style

**Location**: `frontend/src/types/model.ts`

Add a new optional field to DiagramNode:

```typescript
interface DiagramNode {
  // ... existing fields ...

  /** Rendering style for the node */
  render_style?: 'standard' | 'erd';

  /** For ERD-style: list of embedded attribute IDs (not rendered as separate nodes) */
  embedded_attribute_ids?: string[];
}
```

**Purpose**:
- `render_style: 'erd'` indicates the node should render in ERD/UML class-box style
- `embedded_attribute_ids` tracks which attributes are rendered inside this box (not as separate nodes)

---

### 2. Add "Add with attributes" Context Menu Option

**Location**: `frontend/src/components/DiagramsView/PaletteContextMenu.tsx`

Add a new menu item for Logical and Physical Data Entities:

```typescript
// In menu rendering (around line 162)
{(sectionId === 'logical_data_entities' || sectionId === 'physical_data_entities') && (
  <li onClick={() => { onAddWithAttributes?.(item, sectionId); onClose(); }}>
    Add with attributes
  </li>
)}
```

**Props to add**:
```typescript
interface PaletteContextMenuProps {
  // ... existing props ...
  onAddWithAttributes?: (item: PaletteItemData, sectionId: string) => void;
}
```

---

### 3. Implement "Add with attributes" Handler

**Location**: `frontend/src/components/DiagramsView/PalettePanel.tsx`

Create handler function:

```typescript
const handleAddWithAttributes = useCallback(
  (item: PaletteItemData, sectionId: string) => {
    if (!selectedDiagramId || !diagram) return;

    const entityType = item.entityType;
    const entityId = item.id;

    // Determine attribute type based on entity type
    const attributeType = entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY
      ? ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE
      : ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE;

    // Query attributes from metaModel
    const attributes = getAttributesForEntity(metaModel, entityId, entityType);

    // Calculate position (center of viewport)
    const center = getViewportCenter();

    // Calculate dimensions based on attributes
    const { width, height } = calculateERDNodeSize(item.name, attributes);

    // Create the ERD-style node
    const erdNode: DiagramNode = {
      id: generateId(),
      entity_type: entityType,
      entity_id: entityId,
      pos_x: center.x - width / 2,
      pos_y: center.y - height / 2,
      width,
      height,
      parent_node_id: null,
      render_style: 'erd',
      embedded_attribute_ids: attributes.map(a => a.id),
      auto_size: true,
    };

    // Dispatch to add the node
    dispatch({
      type: 'ADD_DIAGRAM_NODE',
      diagramId: selectedDiagramId,
      node: erdNode,
    });
  },
  [selectedDiagramId, diagram, metaModel, dispatch]
);
```

---

### 4. Update Advanced Add to Support ERD-Style

**Location**: `frontend/src/components/DiagramsView/PalettePanel.tsx`

Modify `buildWrappedNodeHierarchy` to detect entity + attributes selection:

```typescript
function buildWrappedNodeHierarchy(
  orderedNodes: TreeNodeData[],
  treeData: TreeNodeData,
  metaModel: MetaModel,
  diagram: Diagram,
  viewportCenter: { x: number; y: number },
  spacingPreset: SpacingPreset = 'normal'
): WrappedNodeResult {
  // Check for ERD-style rendering case
  const erdCandidates = findERDCandidates(orderedNodes, treeData);

  if (erdCandidates.length > 0) {
    // Process ERD-style entities separately
    return buildWithERDNodes(erdCandidates, orderedNodes, treeData, ...);
  }

  // Otherwise, use existing hierarchical layout
  // ... existing code ...
}

function findERDCandidates(orderedNodes: TreeNodeData[], treeData: TreeNodeData): ERDCandidate[] {
  const candidates: ERDCandidate[] = [];

  // Find Logical/Physical Entities that have selected attributes
  for (const node of orderedNodes) {
    if (node.entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY ||
        node.entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY) {

      // Find selected attributes for this entity
      const attributeChildren = node.children.filter(child =>
        child.entityType === ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE ||
        child.entityType === ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE
      );

      if (attributeChildren.length > 0) {
        candidates.push({
          entity: node,
          attributes: attributeChildren,
        });
      }
    }
  }

  return candidates;
}
```

---

### 5. ERD-Style Node Rendering

**Location**: `frontend/src/components/DiagramsView/Canvas.tsx`

Add rendering dispatch in the node rendering section:

```typescript
// Around line 2256, in nodes.map()
nodes.map((nodeData) => {
  const node = getDisplayNode(nodeData);

  // ERD-style rendering for data entities with attributes
  if (node.render_style === 'erd' &&
      (node.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY ||
       node.entity_type === ENTITY_TYPES.PHYSICAL_DATA_ENTITY)) {
    return renderERDNode(node, nodeData, isSelected);
  }

  // Standard rendering for all other nodes
  return renderStandardNode(node, nodeData, isSelected);
});
```

**ERD Node Rendering Function**:

```typescript
function renderERDNode(
  node: DiagramNode,
  displayNode: DisplayNode,
  isSelected: boolean
): JSX.Element {
  const { pos_x, pos_y, width, height, embedded_attribute_ids = [] } = node;
  const entityName = displayNode.label;

  // Get attributes from metaModel
  const attributes = getAttributesByIds(metaModel, embedded_attribute_ids, node.entity_type);

  // Calculate compartment heights
  const headerHeight = 30; // Name compartment
  const attributeRowHeight = 20;
  const dividerY = pos_y + headerHeight;

  // Colors
  const colors = getEntityColors(node.entity_type);
  const fillColor = node.background_color || colors.background;
  const strokeColor = node.line_color || colors.border;
  const textColor = node.text_color || '#333';

  return (
    <g key={node.id} onClick={() => onNodeSelect(node.id)}>
      {/* Outer rectangle */}
      <rect
        x={pos_x}
        y={pos_y}
        width={width}
        height={height}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={isSelected ? 2 : 1}
      />

      {/* Entity name (header compartment) */}
      <text
        x={pos_x + width / 2}
        y={pos_y + headerHeight / 2 + 5}
        textAnchor="middle"
        fontWeight="bold"
        fontSize={12}
        fill={textColor}
      >
        {entityName}
      </text>

      {/* Divider line */}
      <line
        x1={pos_x}
        y1={dividerY}
        x2={pos_x + width}
        y2={dividerY}
        stroke={strokeColor}
        strokeWidth={1}
      />

      {/* Attribute rows */}
      {attributes.map((attr, index) => (
        <text
          key={attr.id}
          x={pos_x + 8}
          y={dividerY + (index + 1) * attributeRowHeight - 5}
          fontSize={11}
          fill={textColor}
        >
          {attr.name}{attr.data_type ? ` : ${attr.data_type}` : ''}
        </text>
      ))}

      {/* Selection indicator */}
      {isSelected && (
        <rect
          x={pos_x - 2}
          y={pos_y - 2}
          width={width + 4}
          height={height + 4}
          fill="none"
          stroke="#2196f3"
          strokeWidth={2}
          strokeDasharray="5,5"
        />
      )}

      {/* Resize handles */}
      {isSelected && renderResizeHandles(node)}
    </g>
  );
}
```

---

### 6. ERD Node Sizing

**Location**: `frontend/src/utils/erdUtils.ts` (new file)

Create utility functions for ERD node sizing:

```typescript
import { SPACING_PRESETS, SpacingPreset } from '../types/advancedAdd';

const ERD_HEADER_HEIGHT = 30;
const ERD_ATTRIBUTE_ROW_HEIGHT = 20;
const ERD_MIN_WIDTH = 150;

export function calculateERDNodeSize(
  entityName: string,
  attributes: Array<{ name: string; data_type?: string }>,
  spacingPreset: SpacingPreset = 'normal'
): { width: number; height: number } {
  const config = SPACING_PRESETS[spacingPreset];
  const { paddingX, paddingY } = config;

  // Calculate width based on longest text
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = 'bold 12px sans-serif';
  const nameWidth = ctx.measureText(entityName).width;

  ctx.font = '11px sans-serif';
  const maxAttrWidth = Math.max(
    ...attributes.map(a => ctx.measureText(formatAttribute(a)).width),
    0
  );

  const contentWidth = Math.max(nameWidth, maxAttrWidth);
  const width = Math.max(ERD_MIN_WIDTH, contentWidth + 2 * paddingX);

  // Calculate height based on header + attributes
  const headerHeight = ERD_HEADER_HEIGHT;
  const attributesHeight = attributes.length * ERD_ATTRIBUTE_ROW_HEIGHT;
  const height = headerHeight + attributesHeight + paddingY;

  return { width, height };
}

export function formatAttribute(attr: { name: string; data_type?: string }): string {
  return attr.data_type ? `${attr.name} : ${attr.data_type}` : attr.name;
}
```

---

### 7. Attribute Query Functions

**Location**: `frontend/src/utils/erdUtils.ts`

```typescript
export function getAttributesForEntity(
  metaModel: MetaModel,
  entityId: string,
  entityType: string
): Array<{ id: string; name: string; data_type?: string }> {
  if (entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY) {
    return metaModel.logical_data_attributes
      .filter(attr => attr.logical_entity_id === entityId)
      .map(attr => ({
        id: attr.id,
        name: attr.name,
        data_type: attr.data_type,
      }));
  }

  if (entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY) {
    return metaModel.physical_data_attributes
      .filter(attr => attr.physical_entity_id === entityId)
      .map(attr => ({
        id: attr.id,
        name: attr.name,
        data_type: attr.data_type,
      }));
  }

  return [];
}

export function getAttributesByIds(
  metaModel: MetaModel,
  attributeIds: string[],
  parentEntityType: string
): Array<{ id: string; name: string; data_type?: string }> {
  const idSet = new Set(attributeIds);

  if (parentEntityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY) {
    return metaModel.logical_data_attributes
      .filter(attr => idSet.has(attr.id))
      .map(attr => ({
        id: attr.id,
        name: attr.name,
        data_type: attr.data_type,
      }));
  }

  if (parentEntityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY) {
    return metaModel.physical_data_attributes
      .filter(attr => idSet.has(attr.id))
      .map(attr => ({
        id: attr.id,
        name: attr.name,
        data_type: attr.data_type,
      }));
  }

  return [];
}
```

---

### 8. Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/types/model.ts` | Add `render_style` and `embedded_attribute_ids` to DiagramNode |
| `frontend/src/components/DiagramsView/PaletteContextMenu.tsx` | Add "Add with attributes" menu item |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Add `handleAddWithAttributes` handler, modify Advanced Add |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Add ERD-style rendering dispatch and render function |
| `frontend/src/utils/erdUtils.ts` | New file: ERD sizing and attribute query utilities |

---

### 9. Acceptance Criteria

1. **"Add with attributes" Context Menu**
   - Right-click on Logical Entity → "Add with attributes" option visible
   - Right-click on Physical Entity → "Add with attributes" option visible
   - Click option → ERD-style box appears on canvas
   - Box shows entity name (bold, centered) + divider + attribute list

2. **Advanced Add ERD-Style**
   - Open Advanced Add for Logical/Physical Entity
   - Select entity + one or more attributes
   - Click Add → ERD-style box appears (not separate boxes)
   - Attributes not selected are not shown in the ERD box

3. **ERD Box Structure**
   - Header: Entity name (bold, centered)
   - Divider: 1px horizontal line
   - Attributes: "name : type" format, left-aligned

4. **ERD Box Behavior**
   - Selectable as single unit
   - Movable via drag
   - Resizable via handles
   - Supports z-index changes
   - Context menu works (auto-size, z-index)
   - POSITION controls work

5. **Persistence**
   - Save diagram → JSON includes `render_style: 'erd'` and `embedded_attribute_ids`
   - Reload diagram → ERD box renders correctly
   - Attributes remain in JSON as references, not rendered as separate nodes

6. **Standard Mode Preserved**
   - Entity added without "with attributes" → standard rectangular box
   - Entity added via basic "Add" → no ERD rendering

---

### 10. Visual Reference

#### ERD-Style Node

```
┌────────────────────────────┐
│     Customer Entity        │  ← Header (bold, centered)
├────────────────────────────┤  ← Divider line
│ customer_id : INTEGER      │  ← Attribute rows
│ name : VARCHAR(100)        │
│ email : VARCHAR(255)       │
│ created_at : TIMESTAMP     │
└────────────────────────────┘
```

#### Standard Node (unchanged)

```
┌────────────────────────────┐
│     Customer Entity        │
└────────────────────────────┘
```

---

### 11. Implementation Notes

1. **Spacing Presets**: ERD nodes should respect the active spacing preset for padding and row spacing

2. **Auto-Size**: When `auto_size: true`, the ERD box should size to fit the longest attribute + entity name

3. **Manual Resize**: When manually resized, extra height creates whitespace below attributes (no overflow)

4. **Attributes Not Selectable**: Individual attributes within ERD box cannot be selected; only the entity box is selectable

5. **Attribute Updates**: If attributes are added/removed in metaModel, the ERD box should reflect changes on next render (via `embedded_attribute_ids` lookup)

6. **Upgrade Path**: If entity exists without attributes, then "Add with attributes" is used again, upgrade the node to ERD-style (merge attributes)

---

### 12. Summary

This specification adds:

1. **New `render_style` field** on DiagramNode for ERD-style rendering
2. **"Add with attributes"** context menu option for data entities
3. **ERD-aware Advanced Add** that collapses entity + attributes into one box
4. **ERD rendering function** in Canvas.tsx for class-box visualization
5. **Utility functions** for attribute queries and ERD sizing

The implementation maintains backward compatibility - entities added without attributes continue to use standard rendering.

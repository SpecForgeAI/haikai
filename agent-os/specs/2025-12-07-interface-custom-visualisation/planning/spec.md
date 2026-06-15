# Custom Interface Visualisation (Endpoints + Entities) + Advanced Add Child Layout Controls

## Overview

This specification introduces:
1. A custom visualisation for Interface nodes showing endpoints as text rows and ERD-style entity boxes
2. A new "Add with all children" context menu item for Interfaces
3. Advanced Add layout controls for child columns and node width
4. Text wrapping support for child nodes

---

## Current State Analysis

### Interface and Endpoint Relationships

**File:** `frontend/src/utils/advancedAddRelationships.ts` (lines 307-332)

Interfaces have two child relationships:
- `LOGICAL_DATA_ENTITY` via `interface_logical_entities` association table
- `ENDPOINT` as parent/child via `endpoints.interface_id`

**File:** `frontend/src/types/model.ts` (lines 110-134)

Endpoint interface includes fields needed for display:
- `operation_verb` (e.g., "GET", "POST", "PUBLISH")
- `path_or_address` (e.g., "/api/v1/customers/{id}")
- `name` (e.g., "Get customer by id")

### Existing Layout Infrastructure

**File:** `frontend/src/types/advancedAdd.ts`

Current layout controls:
- `SpacingPreset`: 'spacious' | 'normal' | 'tight'
- `SpacingConfig`: paddingX, paddingY, childVerticalGap

Missing controls:
- Child columns (grid layout)
- Child node width (target width)

**File:** `frontend/src/utils/compoundLayout.ts`

Layout algorithm:
- `measure()` - Bottom-up dimension calculation
- `assignPositions()` - Top-down position assignment
- `convertTodiagramNodes()` - Convert to DiagramNode array

### Existing ERD Rendering

**File:** `frontend/src/utils/erdUtils.ts`

Functions for ERD-style entity boxes:
- `getAttributesForEntity()` - Gets attributes for entity
- `calculateERDNodeSize()` - Calculates node size with attributes

---

## Specification

### 1. Custom Interface Visualisation

#### 1.1 Interface Node Structure

When an Interface is rendered with children (via "Add with all children" or Advanced Add), it displays:

```
┌──────────────────────────────────────┐
│ INTERFACE NAME                       │ ← Header (bold)
├──────────────────────────────────────┤
│ 1. GET /customers/{id} - Get by ID   │ ← Endpoint list
│ 2. POST /customers - Create          │    (text rows)
│ 3. PUT /customers/{id} - Update      │
├──────────────────────────────────────┤
│ ┌────────────┐  ┌────────────┐       │ ← Entity boxes
│ │ Customer   │  │ Order      │       │    (ERD-style)
│ ├────────────┤  ├────────────┤       │
│ │ id: INT    │  │ id: INT    │       │
│ │ name: STR  │  │ total: DEC │       │
│ └────────────┘  └────────────┘       │
└──────────────────────────────────────┘
```

#### 1.2 Endpoint List Format

Each endpoint line follows the format:
```
<index>. <operation_verb> <path_or_address> - <endpoint_name>
```

Where:
- `index` = 1-based ordinal (sorted by endpoint name or id)
- `operation_verb` = Endpoint.operation_verb (default to empty string if null)
- `path_or_address` = Endpoint.path_or_address
- `endpoint_name` = Endpoint.name

Example lines:
- `1. GET /customers/{id} - Get customer by id`
- `2. POST /customers - Create customer`
- `3. PUBLISH CustomerEventsQueue - Publish customer events`

#### 1.3 Add Field to Track Embedded Endpoints

**File to modify:** `frontend/src/types/model.ts`

Add optional field to DiagramNode interface:

```typescript
export interface DiagramNode {
  // ... existing fields ...

  /**
   * Optional list of endpoint IDs for Interface custom rendering.
   * When present, these endpoints are rendered as text rows inside the Interface box.
   * Only applicable to INTERFACE nodes.
   */
  embedded_endpoint_ids?: string[];
}
```

---

### 2. Context Menu: "Add with all children"

#### 2.1 Add Menu Item

**File to modify:** `frontend/src/components/DiagramsView/PaletteContextMenu.tsx`

Add new context menu item for Interfaces:

```typescript
// In the interfaces section context menu items
{
  label: 'Add with all children',
  action: 'add-with-all-children',
  disabled: false,
}
```

#### 2.2 Handler Implementation

**File to modify:** `frontend/src/components/DiagramsView/PalettePanel.tsx`

Add handler for "Add with all children":

```typescript
const handleAddWithAllChildren = useCallback((item: PaletteItemData, sectionId: string) => {
  if (!currentDiagramId || !diagram || !metaModel) {
    setShowNoDiagramWarning(true);
    return;
  }

  // Only for interfaces
  if (sectionId !== 'interfaces') return;

  // Get the interface
  const interfaceEntity = metaModel.entities.interfaces.find(i => i.id === item.id);
  if (!interfaceEntity) return;

  // Get all endpoints for this interface
  const endpoints = metaModel.entities.endpoints.filter(e => e.interface_id === item.id);

  // Get all logical entities via interface_logical_entities relationship
  const logicalEntityIds = metaModel.relationships.interface_logical_entities
    .filter(rel => rel.interface_id === item.id)
    .map(rel => rel.logical_entity_id);

  const logicalEntities = metaModel.entities.logical_data_entities
    .filter(e => logicalEntityIds.includes(e.id));

  // Create Interface node with embedded endpoints and entity children
  // ... (build custom visualisation)
}, [currentDiagramId, diagram, metaModel]);
```

---

### 3. Advanced Add Layout Controls

#### 3.1 Extend SpacingConfig

**File to modify:** `frontend/src/types/advancedAdd.ts`

Add new layout controls:

```typescript
/**
 * Extended layout configuration for Advanced Add.
 */
export interface LayoutConfig extends SpacingConfig {
  /** Number of columns for child node grid (1-10) */
  childColumns: number;
  /** Target width for child nodes in pixels (10-1000) */
  childNodeWidth: number;
}

/**
 * Default layout configuration values.
 */
export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  paddingX: 10,
  paddingY: 10,
  childVerticalGap: 7,
  childColumns: 1,
  childNodeWidth: 160,
};

/**
 * Layout control constraints.
 */
export const LAYOUT_CONSTRAINTS = {
  childColumns: { min: 1, max: 10 },
  childNodeWidth: { min: 10, max: 1000 },
};
```

#### 3.2 Update AdvancedAddResult

**File to modify:** `frontend/src/types/advancedAdd.ts`

Update result interface:

```typescript
export interface AdvancedAddResult {
  treeData: TreeNodeData;
  selectedKeys: Set<string>;
  selections: SelectionDescriptor[];
  spacingPreset?: SpacingPreset;
  /** Number of columns for child layout (1-10) */
  childColumns?: number;
  /** Target width for child nodes (10-1000 px) */
  childNodeWidth?: number;
}
```

#### 3.3 Add UI Controls to Dialog

**File to modify:** `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`

Add state for new controls:

```typescript
// Child columns state (1-10)
const [childColumns, setChildColumns] = useState<number>(1);

// Child node width state (10-1000)
const [childNodeWidth, setChildNodeWidth] = useState<number>(160);
```

Add controls to footer:

```jsx
<div className={styles.footer}>
  {/* Existing spacing dropdown */}
  <div className={styles.spacingControl}>
    <label>Spacing:</label>
    <select value={spacingPreset} onChange={handleSpacingChange}>...</select>
  </div>

  {/* New: Child columns dropdown */}
  <div className={styles.layoutControl}>
    <label htmlFor="child-columns">Child columns:</label>
    <select
      id="child-columns"
      value={childColumns}
      onChange={(e) => setChildColumns(Number(e.target.value))}
      data-testid="child-columns-select"
    >
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
        <option key={n} value={n}>{n}</option>
      ))}
    </select>
  </div>

  {/* New: Child node width input */}
  <div className={styles.layoutControl}>
    <label htmlFor="child-node-width">Child width:</label>
    <input
      id="child-node-width"
      type="number"
      min="10"
      max="1000"
      value={childNodeWidth}
      onChange={(e) => setChildNodeWidth(Math.max(10, Math.min(1000, Number(e.target.value))))}
      data-testid="child-node-width-input"
    />
  </div>

  {/* Existing buttons */}
  <button onClick={handleClose}>Cancel</button>
  <button onClick={handleAdd}>Add to Diagram</button>
</div>
```

---

### 4. Layout Algorithm Updates

#### 4.1 Update measure() for Grid Layout

**File to modify:** `frontend/src/utils/compoundLayout.ts`

Add grid layout support to measure pass:

```typescript
/**
 * Measure node dimensions with grid layout support.
 *
 * @param node - The node to measure
 * @param config - Layout configuration including childColumns and childNodeWidth
 * @returns MeasuredNode with computed dimensions
 */
export function measureWithGrid(
  node: LayoutTreeNode,
  config: LayoutConfig
): MeasuredNode {
  const { paddingX, paddingY, childVerticalGap, childColumns, childNodeWidth } = config;

  // If no children, measure as leaf node
  if (node.children.length === 0) {
    const labelWidth = estimateLabelWidth(node.label, LAYOUT_DEFAULT_FONT_SIZE, 'bold');
    const width = Math.max(LAYOUT_MIN_NODE_WIDTH, childNodeWidth, labelWidth + 2 * paddingX);
    const height = Math.max(LAYOUT_MIN_NODE_HEIGHT, estimateLabelHeight(node.label, width - 2 * paddingX) + 2 * paddingY);
    return {
      ...node,
      children: [],
      measuredWidth: width,
      measuredHeight: height,
    };
  }

  // Recursively measure children
  const measuredChildren = node.children.map(child => measureWithGrid(child, config));

  // Calculate grid layout
  const columns = Math.min(childColumns, measuredChildren.length);
  const rows = Math.ceil(measuredChildren.length / columns);

  // Find max dimensions per column
  const columnWidths: number[] = new Array(columns).fill(0);
  const rowHeights: number[] = new Array(rows).fill(0);

  measuredChildren.forEach((child, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[col] = Math.max(columnWidths[col], child.measuredWidth);
    rowHeights[row] = Math.max(rowHeights[row], child.measuredHeight);
  });

  // Calculate total children area
  const childrenWidth = columnWidths.reduce((sum, w) => sum + w, 0) + (columns - 1) * paddingX;
  const childrenHeight = rowHeights.reduce((sum, h) => sum + h, 0) + (rows - 1) * childVerticalGap;

  // Calculate container dimensions
  const labelHeight = estimateLabelHeight(node.label, childrenWidth, LAYOUT_DEFAULT_FONT_SIZE, 'bold');
  const width = Math.max(childrenWidth + 2 * paddingX, estimateLabelWidth(node.label) + 2 * paddingX);
  const height = paddingY + labelHeight + LAYOUT_LABEL_PADDING + childrenHeight + paddingY;

  return {
    ...node,
    children: measuredChildren,
    measuredWidth: width,
    measuredHeight: height,
  };
}
```

#### 4.2 Update assignPositions() for Grid Layout

**File to modify:** `frontend/src/utils/compoundLayout.ts`

```typescript
/**
 * Assign positions with grid layout support.
 *
 * @param node - The measured node
 * @param originX - X coordinate for this node
 * @param originY - Y coordinate for this node
 * @param config - Layout configuration
 * @returns LayoutNode with positions
 */
export function assignPositionsWithGrid(
  node: MeasuredNode,
  originX: number,
  originY: number,
  config: LayoutConfig
): LayoutNode {
  const { paddingX, paddingY, childVerticalGap, childColumns } = config;

  const layoutNode: LayoutNode = {
    id: node.id,
    type: node.type,
    label: node.label,
    x: originX,
    y: originY,
    width: node.measuredWidth,
    height: node.measuredHeight,
    children: [],
  };

  if (node.children.length === 0) {
    return layoutNode;
  }

  // Calculate grid dimensions
  const columns = Math.min(childColumns, node.children.length);
  const rows = Math.ceil(node.children.length / columns);

  // Find max dimensions per column and row
  const columnWidths: number[] = new Array(columns).fill(0);
  const rowHeights: number[] = new Array(rows).fill(0);

  node.children.forEach((child, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[col] = Math.max(columnWidths[col], child.measuredWidth);
    rowHeights[row] = Math.max(rowHeights[row], child.measuredHeight);
  });

  // Calculate label height
  const innerWidth = node.measuredWidth - 2 * paddingX;
  const labelHeight = estimateLabelHeight(node.label, innerWidth, LAYOUT_DEFAULT_FONT_SIZE, 'bold');

  // Position children in grid
  let currentY = originY + paddingY + labelHeight + LAYOUT_LABEL_PADDING;

  for (let row = 0; row < rows; row++) {
    let currentX = originX + paddingX;

    for (let col = 0; col < columns; col++) {
      const index = row * columns + col;
      if (index >= node.children.length) break;

      const child = node.children[index];

      // Center child within column cell
      const cellWidth = columnWidths[col];
      const childX = currentX + (cellWidth - child.measuredWidth) / 2;

      const childLayout = assignPositionsWithGrid(child, childX, currentY, config);
      layoutNode.children.push(childLayout);

      currentX += cellWidth + paddingX;
    }

    currentY += rowHeights[row] + childVerticalGap;
  }

  return layoutNode;
}
```

---

### 5. Interface Custom Rendering

#### 5.1 Create Interface Custom Renderer

**File to create:** `frontend/src/utils/interfaceCustomRenderer.ts`

```typescript
import { DiagramNode, MetaModel, Endpoint, ENTITY_TYPES } from '../types/model';
import { wrapText, calculateTextBlockHeight } from './rendering';

/**
 * Format an endpoint as a display string.
 *
 * @param endpoint - The endpoint to format
 * @param index - 1-based index for numbering
 * @returns Formatted string: "<index>. <verb> <path> - <name>"
 */
export function formatEndpointLine(endpoint: Endpoint, index: number): string {
  const verb = endpoint.operation_verb || '';
  const path = endpoint.path_or_address || '';
  const name = endpoint.name || '';

  // Format: "1. GET /customers/{id} - Get customer by id"
  const parts = [
    `${index}.`,
    verb,
    path,
    name ? `- ${name}` : '',
  ].filter(Boolean);

  return parts.join(' ');
}

/**
 * Get formatted endpoint lines for an Interface.
 *
 * @param metaModel - The meta-model
 * @param interfaceId - ID of the interface
 * @returns Array of formatted endpoint strings
 */
export function getEndpointLinesForInterface(
  metaModel: MetaModel,
  interfaceId: string
): string[] {
  const endpoints = metaModel.entities.endpoints
    .filter(e => e.interface_id === interfaceId)
    .sort((a, b) => a.name.localeCompare(b.name));

  return endpoints.map((ep, idx) => formatEndpointLine(ep, idx + 1));
}

/**
 * Calculate the height needed for endpoint lines section.
 *
 * @param endpointLines - Array of formatted endpoint strings
 * @param width - Available width for text
 * @param fontSize - Font size
 * @returns Height in pixels
 */
export function calculateEndpointSectionHeight(
  endpointLines: string[],
  width: number,
  fontSize: number = 12
): number {
  let totalHeight = 0;

  for (const line of endpointLines) {
    const wrapped = wrapText(line, width, fontSize, 'normal', 'normal');
    totalHeight += calculateTextBlockHeight(wrapped.length, fontSize);
  }

  return totalHeight;
}

/**
 * Check if an Interface node should use custom rendering.
 *
 * @param node - The diagram node
 * @returns True if node has embedded endpoints or entities
 */
export function isInterfaceWithCustomRendering(node: DiagramNode): boolean {
  return (
    node.entity_type === ENTITY_TYPES.INTERFACE &&
    ((node.embedded_endpoint_ids?.length ?? 0) > 0 ||
     (node.selected_attribute_ids?.length ?? 0) > 0)
  );
}
```

#### 5.2 Update Canvas Rendering

**File to modify:** `frontend/src/components/DiagramsView/Canvas.tsx`

In `renderNode()`, add handling for Interface custom rendering:

```typescript
function renderNode(node: DiagramNode): JSX.Element | null {
  // Check for Interface custom rendering
  if (isInterfaceWithCustomRendering(node)) {
    return renderInterfaceCustomNode(node);
  }

  // ... existing rendering logic
}

function renderInterfaceCustomNode(node: DiagramNode): JSX.Element {
  const endpointLines = node.embedded_endpoint_ids
    ? getEndpointLinesForInterface(metaModel, node.entity_id)
    : [];

  return (
    <g key={node.id} data-testid={`node-${node.id}`}>
      {/* Background rect */}
      <rect
        x={node.pos_x}
        y={node.pos_y}
        width={node.width}
        height={node.height}
        fill={getEntityColor(node.entity_type).background}
        stroke={getEntityColor(node.entity_type).border}
        strokeWidth={1}
      />

      {/* Header */}
      <text
        x={node.pos_x + node.width / 2}
        y={node.pos_y + 20}
        textAnchor="middle"
        fontWeight="bold"
        fontSize={12}
      >
        {getEntityLabel(metaModel, node)}
      </text>

      {/* Divider line */}
      <line
        x1={node.pos_x}
        y1={node.pos_y + 30}
        x2={node.pos_x + node.width}
        y2={node.pos_y + 30}
        stroke={getEntityColor(node.entity_type).border}
      />

      {/* Endpoint lines */}
      {endpointLines.map((line, idx) => (
        <text
          key={`endpoint-${idx}`}
          x={node.pos_x + 5}
          y={node.pos_y + 45 + idx * 16}
          fontSize={11}
        >
          {line}
        </text>
      ))}

      {/* Child entity boxes are rendered separately via parent_node_id */}
    </g>
  );
}
```

---

### 6. Text Wrapping Support

#### 6.1 Ensure Text Wrapping in Measure Pass

**File to verify:** `frontend/src/utils/compoundLayout.ts`

The existing `estimateLabelHeight()` function already uses `wrapText()`:

```typescript
export function estimateLabelHeight(
  text: string,
  maxWidth: number,
  fontSize: number = LAYOUT_DEFAULT_FONT_SIZE,
  fontWeight: string = 'normal'
): number {
  if (!text) return 0;
  const lines = wrapText(text, maxWidth, fontSize, fontWeight, 'normal');
  return calculateTextBlockHeight(lines.length, fontSize);
}
```

This needs to be used consistently in all measure functions with the `childNodeWidth` constraint.

---

## Files Summary

| File | Changes |
|------|---------|
| `frontend/src/types/model.ts` | Add `embedded_endpoint_ids` field to DiagramNode |
| `frontend/src/types/advancedAdd.ts` | Add `LayoutConfig`, `LAYOUT_CONSTRAINTS`, update `AdvancedAddResult` |
| `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` | Add child columns dropdown and child node width input |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Add `handleAddWithAllChildren` handler |
| `frontend/src/components/DiagramsView/PaletteContextMenu.tsx` | Add "Add with all children" menu item for interfaces |
| `frontend/src/utils/compoundLayout.ts` | Add `measureWithGrid()`, `assignPositionsWithGrid()` |
| `frontend/src/utils/interfaceCustomRenderer.ts` | New file with Interface custom rendering utilities |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Add Interface custom node rendering |

---

## Acceptance Criteria

1. **"Add with all children" menu item**
   - Right-click on Interface in RHS → shows "Add with all children"
   - Creates Interface node with embedded endpoints and entity children

2. **Interface custom rendering**
   - Interface header displays name
   - Endpoints shown as numbered text lines below header
   - ERD-style entity boxes below endpoints
   - No separate endpoint nodes created

3. **Advanced Add layout controls**
   - Child columns dropdown (1-10, default 1)
   - Child node width input (10-1000, default 160)
   - Controls affect resulting layout

4. **Grid layout**
   - Children arranged in specified number of columns
   - Row-by-row assignment
   - Proper spacing between cells

5. **Text wrapping**
   - Long text wraps within node bounds
   - Node height increases to accommodate wrapped text
   - Applies to endpoint lines, entity names, attributes

6. **Backward compatibility**
   - Existing diagrams continue to work
   - Default layout config matches current behavior

---

## Implementation Notes

1. **Endpoint sorting**: Sort endpoints by name for deterministic display order.

2. **Empty sections**: Handle cases where Interface has no endpoints or no entities gracefully.

3. **Performance**: Memoize expensive calculations (text measurement, grid layout).

4. **Validation**: Clamp childColumns to 1-10 range, childNodeWidth to 10-1000.

5. **Test coverage**: Add tests for new menu item, layout controls, grid positioning, text wrapping.

---

## Risk Assessment

**Low Risk:**
- Adding `embedded_endpoint_ids` field (optional, backward compatible)
- Adding new context menu item
- Adding layout controls to dialog

**Medium Risk:**
- Grid layout algorithm (affects existing column-1 behavior)
- Text wrapping consistency (may affect existing node sizes)

**High Risk:**
- Interface custom rendering integration with existing Canvas rendering

**Testing Strategy:**
1. Unit tests for `formatEndpointLine()`, grid layout functions
2. Integration tests for "Add with all children"
3. Visual tests for Interface custom rendering
4. Regression tests for existing layout behavior

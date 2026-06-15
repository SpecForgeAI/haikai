# Diagram Rendering Enhancements - Specification

## Overview

Four enhancements to the Diagrams view rendering in v0.1:
1. Special stick man rendering for BUSINESS_USER nodes
2. Font styling options for node labels and edge labels
3. Fix missing edge label rendering at label_pos_x/label_pos_y
4. Default label_text for DATA_MOVEMENT edges using logical_data_entity name

## Problem Statement

The current diagram rendering has several limitations:
- BUSINESS_USER nodes render as plain rectangles instead of recognizable stick man icons
- No ability to customize font size, weight, or style for labels
- Edge labels (label_text) are not being rendered on the canvas
- DATA_MOVEMENT edges have no sensible default label when label_text is empty

## Requirements

### 1. Special BUSINESS_USER Node Rendering (Stick Man)

#### Schema Changes

Add optional field to `DiagramNode`:

```typescript
export interface DiagramNode {
  // ... existing fields ...
  text_area_width?: number; // Optional; controls text wrapping width for BUSINESS_USER
}
```

#### Stick Man Rendering

When `entity_type === "BUSINESS_USER"`:

**Visual Structure:**
- Do NOT render as a rectangle/box
- Render as a simple stick man figure:
  - Circle for head
  - Vertical line for body (torso)
  - Two diagonal lines for arms
  - Two diagonal lines for legs

**Dimensions:**
- The stick man figure height is based on the `diagram_node.height`
- Horizontal position: stick man is centered within `diagram_node.width`

**Proportions (relative to node height):**
- Head circle: top 20% of figure height
- Body: middle 40% of figure height
- Legs: bottom 40% of figure height
- Arms: extend from top of body, spanning ~60% of node width

**Text Rendering for BUSINESS_USER:**
- Label text (business user name) renders **below** the stick man's feet
- Text wrapping width:
  - If `text_area_width` is defined: wrap when text exceeds `text_area_width`
  - If `text_area_width` is undefined: use normal padded width (`node.width - 10px`)
- Text area begins directly under the feet
- Text can extend vertically beyond the original node height if necessary
- Same line wrapping rules apply (5px vertical spacing between lines)
- `text_h_align` applies to text block horizontal alignment
- `text_v_align` applies relative to text block under stick man (not whole node)

**For all other entity_types:**
- Continue rendering as rectangular boxes with text inside

### 2. Font Styling Options

#### Schema Changes

Add to `DiagramNode`:

```typescript
export interface DiagramNode {
  // ... existing fields ...
  text_font_size?: string;   // CSS font-size (e.g., "12px", "0.9rem")
  text_font_weight?: string; // CSS font-weight (e.g., "normal", "bold", "400", "700")
  text_font_style?: string;  // CSS font-style (e.g., "normal", "italic", "oblique")
}
```

Add to `DiagramEdge`:

```typescript
export interface DiagramEdge {
  // ... existing fields ...
  label_font_size?: string;   // CSS font-size
  label_font_weight?: string; // CSS font-weight
  label_font_style?: string;  // CSS font-style
}
```

#### Rendering Behavior

**For diagram_nodes:**
- Apply `text_font_size`, `text_font_weight`, `text_font_style` to entity name text
- For BUSINESS_USER: applies to text below stick man
- For other types: applies to text inside rectangle
- If not specified, use default font styling (12px, normal weight, normal style)

**For diagram_edges:**
- Apply `label_font_size`, `label_font_weight`, `label_font_style` to `label_text`
- If not specified, use default font styling

### 3. Fix Edge Label Rendering

#### Problem

Edge labels (`label_text`) are currently not appearing on the diagram at all.

#### Required Behavior

For any `diagram_edge` where `label_text` is a non-empty string:
- The label **MUST** be rendered on the canvas at:
  - `x = label_pos_x`
  - `y = label_pos_y`
- These are absolute canvas coordinates
- Rendering occurs regardless of `relationship_type`
- Edge polyline rendering (from `edge_points`) must not interfere with label rendering

#### Example

```json
{
  "label_text": "Daily Batch",
  "label_pos_x": 290,
  "label_pos_y": 80
}
```

Must result in "Daily Batch" being visibly drawn at position (290, 80).

#### Edge Cases

- If `label_text` is empty string, null, or undefined: acceptable to not render label
- See requirement 4 for DATA_MOVEMENT default label behavior

### 4. Default Label for DATA_MOVEMENT Edges

#### Rule

When `relationship_type === "DATA_MOVEMENT"` and `label_text` is not provided or empty:
- Default the rendered label to the name of the referenced `logical_data_entity`

#### Lookup Process

1. Let `e` be a `diagram_edge`
2. If `e.relationship_type === "DATA_MOVEMENT"` AND `!e.label_text`:
   - Find `data_movement m` where `m.id === e.relationship_id` in `metaModel.relationships.data_movements`
   - Get `lde_id = m.data_entity_id`
   - Find `logical_data_entity lde` where `lde.id === lde_id` in `metaModel.entities.logical_data_entities`
   - Use `lde.name` as the display label

#### Pseudo-code

```typescript
function getEdgeDisplayLabel(edge: DiagramEdge, model: ArchitectureModel): string {
  if (edge.label_text) {
    return edge.label_text;
  }

  if (edge.relationship_type === 'DATA_MOVEMENT') {
    const dataMovement = model.metaModel.relationships.data_movements
      .find(dm => dm.id === edge.relationship_id);

    if (dataMovement) {
      const lde = model.metaModel.entities.logical_data_entities
        .find(e => e.id === dataMovement.data_entity_id);

      if (lde) {
        return lde.name;
      }
    }
  }

  return '';
}
```

#### Important Notes

- Default is computed at **render time** (not saved to JSON)
- Explicit `label_text` in JSON always takes precedence
- If lookup fails, render empty label (no error)

## Implementation Changes

### Files to Modify

1. **`frontend/src/types/model.ts`**
   - Add `text_area_width` to `DiagramNode`
   - Add font styling fields to `DiagramNode`
   - Add font styling fields to `DiagramEdge`

2. **`frontend/src/utils/fileOperations.ts`**
   - Parse new optional fields from JSON

3. **`frontend/src/utils/rendering.ts`**
   - Add `getEdgeDisplayLabel()` function for DATA_MOVEMENT default
   - Add stick man rendering calculations
   - Update text measurement to handle custom font sizes

4. **`frontend/src/components/DiagramsView/Canvas.tsx`**
   - Add stick man SVG rendering for BUSINESS_USER nodes
   - Render edge labels at `label_pos_x`, `label_pos_y`
   - Apply font styling to node and edge labels
   - Use `getEdgeDisplayLabel()` for label text

5. **`frontend/public/sample-architecture.json`**
   - Add examples demonstrating:
     - BUSINESS_USER stick man with text_area_width
     - Font styling on nodes and edges
     - Edge labels with positions
     - DATA_MOVEMENT with default label

### Type Definition Updates

```typescript
export interface DiagramNode {
  id: string;
  entity_type: string;
  entity_id: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  auto_size?: boolean;
  z_index?: number;
  parent_node_id: string | null;
  style_override?: Record<string, unknown>;
  text_h_align?: 'LEFT' | 'CENTER' | 'RIGHT';
  text_v_align?: 'TOP' | 'MIDDLE' | 'BOTTOM';
  text_area_width?: number;
  text_font_size?: string;
  text_font_weight?: string;
  text_font_style?: string;
}

export interface DiagramEdge {
  id: string;
  relationship_type: string;
  relationship_id: string;
  source_node_id: string;
  target_node_id: string;
  label_text?: string;
  label_pos_x?: number;
  label_pos_y?: number;
  line_weight?: string;
  line_type?: string;
  arrow_start?: string;
  arrow_end?: string;
  style_override?: Record<string, unknown>;
  edge_points: EdgePoint[];
  label_font_size?: string;
  label_font_weight?: string;
  label_font_style?: string;
}
```

### Stick Man Rendering Algorithm

```typescript
function renderBusinessUserNode(node: DiagramNode, label: string) {
  const centerX = node.pos_x + node.width / 2;
  const topY = node.pos_y;
  const figureHeight = node.height;

  // Proportions
  const headRadius = figureHeight * 0.1;
  const headCenterY = topY + headRadius;
  const bodyStartY = headCenterY + headRadius;
  const bodyEndY = topY + figureHeight * 0.6;
  const armY = bodyStartY + (bodyEndY - bodyStartY) * 0.2;
  const armSpan = node.width * 0.3;
  const legEndY = topY + figureHeight;
  const legSpan = node.width * 0.2;

  // Draw head (circle)
  drawCircle(centerX, headCenterY, headRadius);

  // Draw body (vertical line)
  drawLine(centerX, bodyStartY, centerX, bodyEndY);

  // Draw arms (two diagonal lines)
  drawLine(centerX - armSpan, armY, centerX + armSpan, armY);

  // Draw legs (two diagonal lines)
  drawLine(centerX, bodyEndY, centerX - legSpan, legEndY);
  drawLine(centerX, bodyEndY, centerX + legSpan, legEndY);

  // Render text below feet
  const textAreaWidth = node.text_area_width || (node.width - 10);
  const textStartY = legEndY + 5; // 5px gap below feet
  renderWrappedText(label, centerX, textStartY, textAreaWidth, node);
}
```

### Edge Label Rendering

```typescript
function renderEdgeLabel(edge: DiagramEdge, model: ArchitectureModel) {
  const displayLabel = getEdgeDisplayLabel(edge, model);

  if (!displayLabel) return;

  // Must have position coordinates
  if (edge.label_pos_x === undefined || edge.label_pos_y === undefined) return;

  // Apply font styling
  const fontSize = edge.label_font_size || '12px';
  const fontWeight = edge.label_font_weight || 'normal';
  const fontStyle = edge.label_font_style || 'normal';

  renderText(
    displayLabel,
    edge.label_pos_x,
    edge.label_pos_y,
    { fontSize, fontWeight, fontStyle }
  );
}
```

## Acceptance Criteria

### 1. BUSINESS_USER Stick Man

- [ ] BUSINESS_USER nodes render as stick man (not rectangle)
- [ ] Stick man is centered horizontally within node width
- [ ] Stick man proportions are visually appropriate
- [ ] Label text renders below stick man's feet
- [ ] `text_area_width` controls text wrapping when specified
- [ ] Default text wrapping uses padded node width
- [ ] Text can extend beyond original node height
- [ ] Text alignment settings apply to label block

### 2. Font Styling

- [ ] `text_font_size` applied to node labels
- [ ] `text_font_weight` applied to node labels
- [ ] `text_font_style` applied to node labels
- [ ] `label_font_size` applied to edge labels
- [ ] `label_font_weight` applied to edge labels
- [ ] `label_font_style` applied to edge labels
- [ ] Default styling used when fields not specified

### 3. Edge Label Rendering

- [ ] Edge labels render at `label_pos_x`, `label_pos_y`
- [ ] Labels visible on canvas at correct positions
- [ ] Label rendering independent of edge polyline
- [ ] Empty/undefined labels not rendered

### 4. DATA_MOVEMENT Default Label

- [ ] Default label uses logical_data_entity.name
- [ ] Lookup follows data_movement → logical_data_entity chain
- [ ] Explicit label_text overrides default
- [ ] Failed lookup results in empty label (no error)

### Visual Verification

With test diagram containing BUSINESS_USER "Risk Manager":
- [ ] Renders as stick man figure (not rectangle)
- [ ] Name "Risk Manager" appears below the figure
- [ ] Text wrapping respects text_area_width

With DATA_MOVEMENT edge referencing "Trade" entity:
- [ ] Label displays "Trade" at specified position when label_text empty
- [ ] Label displays explicit value when label_text provided

With font styling example:
- [ ] Bold, italic, and custom size labels render correctly

## Out of Scope

- Animated stick man
- Configurable stick man colors/line weights
- Edge label rotation or curved text
- Label collision detection/avoidance

## Testing

### Test 1: BUSINESS_USER Rendering

1. Load diagram with BUSINESS_USER node
2. Verify stick man shape (head, body, arms, legs)
3. Verify label position below figure
4. Test with/without text_area_width
5. Verify text wrapping behavior

### Test 2: Font Styling

1. Load diagram with font styling fields
2. Verify node labels have custom font size/weight/style
3. Verify edge labels have custom font size/weight/style
4. Verify defaults when fields not specified

### Test 3: Edge Labels

1. Load diagram with edge labels
2. Verify labels appear at label_pos_x, label_pos_y
3. Verify multiple edge labels all visible
4. Test empty label_text (should not render)

### Test 4: DATA_MOVEMENT Default

1. Load diagram with DATA_MOVEMENT edge
2. Set label_text to empty string
3. Verify default label shows logical_data_entity name
4. Override with explicit label_text
5. Verify explicit value displayed instead

### Test 5: Round-Trip

1. Load sample data with all new features
2. Save model
3. Reload and verify all rendering preserved
4. Verify new fields present in saved JSON

# Diagram View Enhancements - Specification

## Overview

Four enhancements to the Diagrams view in v0.1:
1. Text alignment fields and padding rules for node labels
2. Text wrapping and line spacing inside nodes
3. Strict edge rendering using only edge_points (no auto-generated connector lines)
4. Relocated and restyled zoom controls

## Problem Statement

The current diagram rendering has several issues:
- Node text is always centered with no control over alignment
- Text does not wrap within nodes, causing overflow
- Edges draw extra connector lines from node centers instead of using only edge_points
- Zoom controls are at the bottom-right of the canvas and can be off-screen when scrolled

## Requirements

### 1. Text Alignment Fields and Padding Rules

#### Schema Changes

Add two optional fields to `DiagramNode`:

```typescript
export interface DiagramNode {
  // ... existing fields ...
  text_h_align?: 'LEFT' | 'CENTER' | 'RIGHT';
  text_v_align?: 'TOP' | 'MIDDLE' | 'BOTTOM';
}
```

#### Default Values

- If `text_h_align` is not specified, default to `"CENTER"`
- If `text_v_align` is not specified, default to `"MIDDLE"`

#### Padding Rules

- Fixed 5px padding on all four sides of the node content area (not configurable in v0.1)
- Text drawing area boundaries:
  - X range: `[pos_x + 5, pos_x + width - 5]`
  - Y range: `[pos_y + 5, pos_y + height - 5]`
  - For auto-sized nodes, the equivalent padded area applies

#### Horizontal Alignment Behavior

Within the padded area:
- **LEFT**: Text is anchored 5px from the left edge of the padded area
- **CENTER**: Each line is horizontally centered in the padded area
- **RIGHT**: Text is anchored 5px from the right edge of the padded area

#### Vertical Alignment Behavior

Within the padded area:
- **TOP**: The first line starts 5px from the top of the padded area
- **MIDDLE**: The block of text is vertically centered within the padded area
- **BOTTOM**: The last line ends 5px from the bottom of the padded area

### 2. Text Wrapping and Line Spacing

#### Wrapping Rules

- Effective text width = `(node width) - 10px` (5px left padding + 5px right padding)
- If text is wider than the effective text width, it must wrap onto multiple lines
- Break lines at word boundaries where possible
- If a single word is too long, break the token mid-word

#### Line Spacing

- Fixed 5px vertical gap between consecutive lines of text
- Vertical alignment rules apply to the entire block of wrapped lines, not individual lines

#### Scope

These rules apply consistently to all node types:
- Applications
- Application Points
- Business Processes
- Business Users
- App Components
- Services
- Logical Data Entities
- Physical Data Entities

### 3. Edge Rendering (edge_points Only)

#### Current Problem

The implementation incorrectly draws extra connector lines from node centers to the first/last edge points. This must be removed.

#### Correct Behavior

Edges are rendered **only** using the coordinates in `edge_points[]`:

1. Sort `edge_points` by `sequence_order`
2. Draw straight line segments between consecutive points: 0→1→2→...→n
3. **Do not** add any implicit segments from node centers or node edges
4. The polyline consists only of the segments defined by edge_points

#### Arrow Head Positioning

- If `arrow_end = "ARROW"` (or any non-`"NONE"` value):
  - Draw the arrow head at the final segment end
  - The **tip** of the arrow must be exactly at `edge_points[n].pos_x`, `edge_points[n].pos_y`
  - The arrow wings extend back along the final segment direction
- Same logic applies for `arrow_start` if used (tip at first point, wings extend forward)

#### Example

Given edge_points: `[{seq: 0, pos_x: 280, pos_y: 240}, {seq: 1, pos_x: 400, pos_y: 240}]`
- Draw one line segment from (280, 240) to (400, 240)
- Arrow tip at (400, 240)
- No extra lines to/from node centers

### 4. Zoom Controls Relocation

#### Current Problem

Zoom controls are rendered at the bottom-right corner of the canvas, which can be off-screen when scrolled.

#### New Layout

Place zoom controls on the same horizontal bar as the diagram selector:

```
┌─────────────────────────────────────────────────────────────────┐
│ Diagram: [dropdown ▼]                    [+] 100% [-] [Fit to View] │
└─────────────────────────────────────────────────────────────────┘
```

#### Control Details

- **Left side**: "Diagram: [dropdown]" (unchanged)
- **Right side**: Zoom controls in order:
  - `[+]` button - zooms in by increment (e.g., 25%)
  - Percentage display (e.g., "100%") - shows current zoom level
  - `[-]` button - zooms out by increment
  - `[Fit to View]` button - resets zoom and pan to fit entire diagram in visible area

#### Requirements

- All four zoom elements must be on a single line (no wrapping)
- Remove the existing bottom-right canvas zoom widget
- Fit to View should calculate bounds of all nodes and adjust zoom/pan accordingly

## Implementation Changes

### Files to Modify

1. **`frontend/src/types/model.ts`**
   - Add `text_h_align` and `text_v_align` to `DiagramNode` interface

2. **`frontend/src/components/DiagramsView/Canvas.tsx`**
   - Implement text wrapping with word breaks
   - Implement horizontal/vertical alignment
   - Apply 5px padding and 5px line spacing
   - Remove extra edge connector lines (render only edge_points)
   - Fix arrow tip positioning at final edge_point
   - Remove bottom-right zoom controls

3. **`frontend/src/components/DiagramsView/DiagramsView.tsx`**
   - Add zoom controls to header bar (right side)
   - Implement [+], [-], percentage display, [Fit to View]

4. **`frontend/src/utils/rendering.ts`**
   - Update `getEdgePoints` to return only edge_points (no node center points)
   - Add text measurement/wrapping utilities
   - Add `calculateDiagramFitZoom` for Fit to View

5. **`frontend/src/utils/fileOperations.ts`**
   - Parse `text_h_align` and `text_v_align` fields

6. **`frontend/public/sample-architecture.json`**
   - Add example text alignment fields to demonstrate feature

### Type Definition Update

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
}
```

### Text Rendering Algorithm

```typescript
function renderNodeText(node: DiagramNode, label: string) {
  const padding = 5;
  const lineSpacing = 5;
  const fontSize = 12;

  // Calculate text area
  const textAreaX = node.pos_x + padding;
  const textAreaY = node.pos_y + padding;
  const textAreaWidth = node.width - (padding * 2);
  const textAreaHeight = node.height - (padding * 2);

  // Wrap text into lines
  const lines = wrapText(label, textAreaWidth, fontSize);

  // Calculate total text block height
  const lineHeight = fontSize;
  const blockHeight = (lines.length * lineHeight) + ((lines.length - 1) * lineSpacing);

  // Determine vertical start position
  let startY: number;
  switch (node.text_v_align || 'MIDDLE') {
    case 'TOP':
      startY = textAreaY + lineHeight;
      break;
    case 'BOTTOM':
      startY = textAreaY + textAreaHeight - blockHeight + lineHeight;
      break;
    case 'MIDDLE':
    default:
      startY = textAreaY + (textAreaHeight - blockHeight) / 2 + lineHeight;
      break;
  }

  // Render each line
  lines.forEach((line, index) => {
    const y = startY + (index * (lineHeight + lineSpacing));

    // Determine horizontal position
    let x: number;
    let anchor: string;
    switch (node.text_h_align || 'CENTER') {
      case 'LEFT':
        x = textAreaX;
        anchor = 'start';
        break;
      case 'RIGHT':
        x = textAreaX + textAreaWidth;
        anchor = 'end';
        break;
      case 'CENTER':
      default:
        x = textAreaX + textAreaWidth / 2;
        anchor = 'middle';
        break;
    }

    // Draw text line
    renderTextLine(line, x, y, anchor);
  });
}
```

### Edge Rendering Algorithm

```typescript
function renderEdge(edge: DiagramEdge) {
  // Sort edge points by sequence
  const points = [...edge.edge_points].sort((a, b) => a.sequence_order - b.sequence_order);

  if (points.length < 2) return; // Need at least 2 points

  // Build path from edge_points ONLY - no node center points
  const pathData = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.pos_x} ${p.pos_y}`)
    .join(' ');

  // Draw polyline
  drawPath(pathData);

  // Draw arrow at end if specified
  if (edge.arrow_end && edge.arrow_end !== 'NONE') {
    const lastPoint = points[points.length - 1];
    const secondLastPoint = points[points.length - 2];

    // Arrow tip is exactly at the last point
    drawArrowHead(
      secondLastPoint.pos_x, secondLastPoint.pos_y,
      lastPoint.pos_x, lastPoint.pos_y
    );
  }
}
```

## Acceptance Criteria

### 1. Text Alignment and Padding

- [ ] Node labels respect 5px padding on all sides
- [ ] Default alignment is CENTER horizontal, MIDDLE vertical
- [ ] `text_h_align: "LEFT"` anchors text to the left
- [ ] `text_h_align: "RIGHT"` anchors text to the right
- [ ] `text_v_align: "TOP"` places text at the top
- [ ] `text_v_align: "BOTTOM"` places text at the bottom

### 2. Text Wrapping

- [ ] Text wraps when wider than `width - 10px`
- [ ] Lines break at word boundaries
- [ ] Long words break mid-token if necessary
- [ ] 5px vertical gap between consecutive lines
- [ ] Alignment applies to the entire text block

### 3. Edge Rendering

- [ ] Edges use only edge_points coordinates
- [ ] No extra lines from/to node centers
- [ ] Arrow tip is exactly at the final edge_point
- [ ] Multiple edge_points create polyline segments

### 4. Zoom Controls

- [ ] Zoom controls appear in the diagram header bar
- [ ] Layout: `[+] 100% [-] [Fit to View]` on right side
- [ ] Percentage reflects current zoom level
- [ ] [+] zooms in
- [ ] [-] zooms out
- [ ] [Fit to View] fits entire diagram in visible area
- [ ] Bottom-right canvas zoom widget is removed

### 5. Visual Verification

With the test diagram containing "OMS System", "Risk System", and "VaR Interrogation and Reporting":
- [ ] Wrapped text displays with correct padding (5px) and line spacing (5px)
- [ ] Text alignment defaults to center/middle
- [ ] Exactly one polyline between nodes matching edge_points
- [ ] No extra "connector" lines from node centers
- [ ] Arrow tip at final edge_point coordinate
- [ ] Zoom controls visible in header bar

## Out of Scope

- Configurable padding values (fixed at 5px for v0.1)
- Configurable line spacing (fixed at 5px for v0.1)
- Custom fonts or font sizes per node
- Curved edges or bezier paths
- Pan gesture handling for Fit to View

## Testing

### Test 1: Text Wrapping and Alignment

1. Load a diagram with nodes containing long text
2. Verify text wraps within the node boundaries
3. Verify 5px padding is visible on all sides
4. Verify 5px spacing between wrapped lines
5. Test all alignment combinations (9 total)

### Test 2: Edge Points Only

1. Load a diagram with edge_points defining a polyline
2. Verify only the edge_points segments are drawn
3. Verify no lines extend to/from node centers
4. Verify arrow tip is at the exact final edge_point coordinate

### Test 3: Zoom Controls

1. Load any diagram
2. Verify zoom controls appear in header bar
3. Click [+] and verify zoom increases
4. Click [-] and verify zoom decreases
5. Click [Fit to View] and verify diagram fits in view
6. Verify bottom-right zoom widget is gone

### Test 4: Round-Trip

1. Load a diagram with text alignment fields
2. Save the model
3. Reload and verify alignment settings preserved
4. Verify visual rendering matches original

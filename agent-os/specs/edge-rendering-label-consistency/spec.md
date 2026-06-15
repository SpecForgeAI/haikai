# Edge Rendering and Label Consistency - Specification

## Overview

This specification enhances the editable Diagrams view with:
1. Correct rendering of `line_weight`, `line_type`, and new `line_dashes` fields on diagram_edges
2. Consistent label position updates when node movement indirectly moves edge_points

## Problem Statement

### Edge Rendering Issues

The current implementation does not properly apply edge styling:
- `line_weight` and `line_type` fields have no visible effect on rendered lines
- No support for custom dash patterns
- All edges render with the same default appearance regardless of JSON settings

### Label Consistency Issues

When a node moves and causes attached edge_points to shift:
- The edge_points move correctly (per v0.2 spec)
- But the edge label does NOT move consistently
- This creates visual misalignment between the line and its label

The same label adjustment logic that applies when users directly drag edge_points should also apply when node movement indirectly moves those points.

## Requirements

### 1. Edge Line Rendering with line_weight, line_type, and line_dashes

#### Schema

Existing fields on `DiagramEdge`:
```typescript
interface DiagramEdge {
  // ... existing fields ...
  line_weight?: string;  // CSS pixel width, e.g., "1px", "2px", "3px"
  line_type?: string;    // "SOLID" | "DASHED" | "DOTTED"
  line_dashes?: string;  // Optional CSS dash pattern, e.g., "6px 4px"
}
```

#### line_weight Semantics

**Format:** CSS-style pixel width string (e.g., "1px", "2px", "3px")

**Behavior:**
- Parse the numeric pixel value from the string
- Apply as stroke width
- If absent or invalid: use default width (2px)

**Parsing:**
```typescript
function parseLineWeight(weight?: string): number {
  if (!weight) return 2; // default
  const match = weight.match(/^(\d+(?:\.\d+)?)\s*px$/i);
  return match ? parseFloat(match[1]) : 2;
}
```

#### line_type Semantics

**Supported values:** `"SOLID"`, `"DASHED"`, `"DOTTED"`

**Behavior:**

| line_type | Visual | Default dash pattern |
|-----------|--------|---------------------|
| SOLID | Continuous line | None (solid) |
| DASHED | Long dashes | "6 4" (6px on, 4px off) |
| DOTTED | Dots | "2 4" (2px on, 4px off) |

**If line_type absent:** Default to "SOLID"

#### line_dashes Semantics

**Format:** Space-separated pixel values (e.g., "6px 4px", "6 4", "1px 4px")

**Behavior:**
- Custom override for dash pattern when line_type is "DASHED" or "DOTTED"
- Ignored when line_type is "SOLID"
- Parsed into numeric array for SVG `stroke-dasharray`

**Parsing:**
```typescript
function parseLineDashes(dashes?: string): number[] {
  if (!dashes) return [];
  return dashes
    .split(/\s+/)
    .map(s => parseFloat(s.replace(/px$/i, '')))
    .filter(n => !isNaN(n) && n >= 0);
}
```

#### Combined Rendering Logic

```typescript
function getEdgeStrokeStyle(edge: DiagramEdge): {
  strokeWidth: number;
  strokeDasharray: string;
} {
  // Parse weight
  const strokeWidth = parseLineWeight(edge.line_weight);

  // Determine dash pattern
  let strokeDasharray = '';
  const lineType = edge.line_type || 'SOLID';

  if (lineType === 'DASHED') {
    const dashes = edge.line_dashes
      ? parseLineDashes(edge.line_dashes)
      : [6, 4]; // default dashed
    strokeDasharray = dashes.join(' ');
  } else if (lineType === 'DOTTED') {
    const dashes = edge.line_dashes
      ? parseLineDashes(edge.line_dashes)
      : [2, 4]; // default dotted
    strokeDasharray = dashes.join(' ');
  }
  // SOLID: strokeDasharray remains ''

  return { strokeWidth, strokeDasharray };
}
```

#### SVG Rendering

Apply to the polyline/path element:

```tsx
const { strokeWidth, strokeDasharray } = getEdgeStrokeStyle(edge);

<path
  d={pathData}
  stroke={edgeColor}
  strokeWidth={strokeWidth}
  strokeDasharray={strokeDasharray || undefined}
  fill="none"
/>
```

#### Examples

**Example 1: Thick solid line**
```json
{
  "line_weight": "3px",
  "line_type": "SOLID"
}
```
Result: 3px wide solid line

**Example 2: Dashed line with custom pattern**
```json
{
  "line_weight": "2px",
  "line_type": "DASHED",
  "line_dashes": "10px 5px"
}
```
Result: 2px wide dashed line with 10px segments and 5px gaps

**Example 3: Dotted line**
```json
{
  "line_weight": "1px",
  "line_type": "DOTTED"
}
```
Result: 1px wide dotted line with default "2 4" pattern

**Example 4: SOLID ignores line_dashes**
```json
{
  "line_weight": "3px",
  "line_type": "SOLID",
  "line_dashes": "6px 4px"
}
```
Result: 3px wide solid line (dashes ignored)

### 2. Consistent Label Updates When Node Movement Moves Edge Points

#### Context

The v0.2 spec established:
- Moving a node cascades movement to attached edge_points
- When user directly drags an edge_point of a 2-point edge, label moves by (dx/2, dy/2)

This spec extends that logic to node-induced edge_point movement.

#### Straight-Line Edges (2 points)

**Case A: One endpoint moves**

When node movement causes exactly ONE of the two edge_points to move by (dx, dy):
- Update the edge_point position
- Also update label:
  ```typescript
  edge.label_pos_x += dx / 2;
  edge.label_pos_y += dy / 2;
  ```

This mirrors manual endpoint dragging behavior.

**Case B: Both endpoints move by same delta**

When node movement causes BOTH endpoints to move by the same (dx, dy):
- Both connected nodes moved together (e.g., contained in same parent)
- Update both edge_points
- Move label by full delta:
  ```typescript
  edge.label_pos_x += dx;
  edge.label_pos_y += dy;
  ```

This keeps label in same relative position along translated line.

#### Non-Straight Edges (3+ points)

For edges with more than 2 edge_points:
- Move attached edge_points as before
- Do NOT auto-adjust label position
- User can manually drag label if needed

This avoids complexity for multi-segment polylines where "center" is ambiguous.

#### Implementation Approach

**Unified edge point update function:**

```typescript
function updateEdgePointsWithLabelAdjust(
  edge: DiagramEdge,
  pointUpdates: Array<{ index: number; dx: number; dy: number }>
): void {
  // Apply all point updates
  for (const update of pointUpdates) {
    edge.edge_points[update.index].pos_x += update.dx;
    edge.edge_points[update.index].pos_y += update.dy;
  }

  // Label adjustment for straight-line edges
  if (edge.edge_points.length === 2 && edge.label_pos_x !== undefined) {
    if (pointUpdates.length === 1) {
      // One endpoint moved - half adjustment
      const { dx, dy } = pointUpdates[0];
      edge.label_pos_x += dx / 2;
      edge.label_pos_y += dy / 2;
    } else if (pointUpdates.length === 2) {
      // Check if both moved by same delta (translation)
      const [u1, u2] = pointUpdates;
      if (u1.dx === u2.dx && u1.dy === u2.dy) {
        // Full translation
        edge.label_pos_x += u1.dx;
        edge.label_pos_y += u1.dy;
      } else {
        // Different deltas - use average
        edge.label_pos_x += (u1.dx + u2.dx) / 2;
        edge.label_pos_y += (u1.dy + u2.dy) / 2;
      }
    }
  }
}
```

#### Integration with MOVE_NODE_WITH_CASCADE

The existing `MOVE_NODE_WITH_CASCADE` action must be updated:

```typescript
// In the reducer for MOVE_NODE_WITH_CASCADE

// 1. Move the node and its descendants (existing)
// 2. Find attached edge points (existing)
// 3. Group edge point movements by edge
// 4. For each edge, apply movements with label adjustment

const edgePointMoves = new Map<string, Array<{ index: number; dx: number; dy: number }>>();

for (const point of attachedPoints) {
  const edgeId = point.edgeId;
  if (!edgePointMoves.has(edgeId)) {
    edgePointMoves.set(edgeId, []);
  }
  edgePointMoves.get(edgeId)!.push({
    index: point.index,
    dx: action.dx,
    dy: action.dy
  });
}

// Apply to each edge with label adjustment
for (const [edgeId, updates] of edgePointMoves) {
  const edge = findEdge(edgeId);
  updateEdgePointsWithLabelAdjust(edge, updates);
}
```

#### Persistence

All updates must be persisted:
- edge_points[].pos_x, pos_y (already handled)
- edge.label_pos_x, label_pos_y (NEW: must be included)

The existing save mechanism should already serialize these fields.

## Implementation Changes

### Files to Modify

1. **`frontend/src/utils/rendering.ts`**
   - Add `parseLineWeight()` function
   - Add `parseLineDashes()` function
   - Add `getEdgeStrokeStyle()` function
   - Add `updateEdgePointsWithLabelAdjust()` function

2. **`frontend/src/components/DiagramsView/Canvas.tsx`**
   - Update edge rendering to use `getEdgeStrokeStyle()`
   - Apply `strokeWidth` and `strokeDasharray` to path elements

3. **`frontend/src/contexts/ArchitectureContext.tsx`**
   - Update `MOVE_NODE_WITH_CASCADE` reducer to include label adjustment
   - Group attached points by edge and apply unified update

4. **`frontend/src/types/model.ts`**
   - Add `line_dashes?: string` to DiagramEdge interface (if not present)

5. **`frontend/src/config/defaults.ts`**
   - Add default values for edge rendering:
     - `defaultLineWeight: 2`
     - `defaultDashedPattern: [6, 4]`
     - `defaultDottedPattern: [2, 4]`

### Type Definition Updates

```typescript
// In model.ts
export interface DiagramEdge {
  // ... existing fields ...
  line_weight?: string;
  line_type?: string;
  line_dashes?: string;  // NEW
}
```

## Acceptance Criteria

### Edge Rendering

- [ ] `line_weight` controls stroke width (e.g., "3px" renders 3px thick)
- [ ] `line_type: "SOLID"` renders continuous line
- [ ] `line_type: "DASHED"` renders dashed line with default or custom pattern
- [ ] `line_type: "DOTTED"` renders dotted line with default or custom pattern
- [ ] `line_dashes` custom pattern applied for DASHED/DOTTED
- [ ] `line_dashes` ignored for SOLID type
- [ ] Missing fields use sensible defaults
- [ ] Changes in JSON immediately visible on canvas

### Label Consistency

- [ ] One endpoint of 2-point edge moved by node: label moves by (dx/2, dy/2)
- [ ] Both endpoints of 2-point edge moved by same delta: label moves by full delta
- [ ] Both endpoints moved by different deltas: label moves by average
- [ ] Non-straight edges (3+ points): label not auto-adjusted
- [ ] Label adjustments persist to JSON on save
- [ ] Reload shows label at adjusted position

### Persistence

- [ ] edge_points positions persist after node cascade
- [ ] label_pos_x/y persist after node cascade
- [ ] line_weight, line_type, line_dashes preserved on save/reload

## Out of Scope

- Animated dash patterns
- Custom line caps or joins
- Gradient strokes
- Label rotation based on line angle
- Auto-centering labels for 3+ point edges

## Testing

### Test 1: Line Weight Rendering

1. Create edge with `line_weight: "4px"`
2. Verify line renders visibly thicker than default
3. Change to `line_weight: "1px"`
4. Verify line renders thinner

### Test 2: Line Type Rendering

1. Create edge with `line_type: "DASHED"`
2. Verify dashed line appears
3. Change to `line_type: "DOTTED"`
4. Verify dotted line appears
5. Change to `line_type: "SOLID"`
6. Verify solid line appears

### Test 3: Custom Dash Pattern

1. Create edge with `line_type: "DASHED"`, `line_dashes: "10px 5px"`
2. Verify long dashes with short gaps
3. Change to `line_dashes: "2px 8px"`
4. Verify short dashes with long gaps

### Test 4: Node Cascade with Single Endpoint

1. Create 2-point edge between two nodes
2. Note label position (centered between nodes)
3. Move one node by (+40, +20)
4. Verify attached endpoint moves (+40, +20)
5. Verify label moves (+20, +10)

### Test 5: Node Cascade with Both Endpoints

1. Create 2-point edge
2. Place both nodes inside same container
3. Move container by (+30, +30)
4. Verify both endpoints move (+30, +30)
5. Verify label moves (+30, +30)

### Test 6: Non-Straight Edge Label

1. Create edge with 4 edge_points
2. Move a node to shift middle points
3. Verify edge_points move
4. Verify label does NOT move automatically

### Test 7: Round-Trip Persistence

1. Create edges with various line styles
2. Move nodes to trigger cascade
3. Save JSON
4. Reload JSON
5. Verify all line styles preserved
6. Verify all edge_point positions preserved
7. Verify all label positions preserved

## Configuration Constants

```typescript
// In frontend/src/config/defaults.ts

export const edgeRendering = {
  // Default stroke width
  defaultLineWeight: 2,

  // Default dash patterns
  defaultDashedPattern: [6, 4],
  defaultDottedPattern: [2, 4],

  // Line types
  lineTypes: {
    SOLID: 'SOLID',
    DASHED: 'DASHED',
    DOTTED: 'DOTTED',
  },
};
```

## Visual Examples

### Line Types

```
SOLID:   ─────────────────────────

DASHED:  ── ── ── ── ── ── ── ──

DOTTED:  · · · · · · · · · · · · ·
```

### Label Adjustment Scenarios

```
Case A: One endpoint moves

Before:   A ─────────[Label]───────── B
After:    A ─────────────[Label]───── B'
          (Label shifted halfway toward B')

Case B: Both endpoints move together

Before:   A ─────────[Label]───────── B
After:    A' ────────[Label]──────── B'
          (Label maintains relative position)
```

# Task Breakdown: Edge Rendering and Label Consistency

## Overview

**Total Tasks:** 24 subtasks across 5 task groups

This feature implements two enhancements:
1. Correct rendering of `line_weight`, `line_type`, and `line_dashes` fields on diagram edges
2. Consistent label position updates when node movement cascades to edge points

## Key Constants

```typescript
// Edge rendering defaults (to be added to defaults.ts)
export const edgeRendering = {
  defaultLineWeight: 2,
  defaultDashedPattern: [6, 4],
  defaultDottedPattern: [2, 4],
  lineTypes: {
    SOLID: 'SOLID',
    DASHED: 'DASHED',
    DOTTED: 'DOTTED',
  },
};
```

## Files to Modify

| File | Purpose |
|------|---------|
| `frontend/src/types/model.ts` | Add `line_dashes` to DiagramEdge interface |
| `frontend/src/config/defaults.ts` | Add edge rendering defaults |
| `frontend/src/utils/rendering.ts` | Parse functions and label adjustment utility |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Apply stroke styles to edge paths |
| `frontend/src/contexts/ArchitectureContext.tsx` | Update MOVE_NODE_WITH_CASCADE for label adjustment |

---

## Task List

### Task Group 1: Type Definitions and Configuration
**Effort:** Small (S)
**Dependencies:** None

- [ ] 1.0 Complete type definitions and configuration
  - [ ] 1.1 Write 2-4 focused tests for edge rendering types and defaults
    - Test `line_dashes` field exists on DiagramEdge type
    - Test edge rendering constants are exported correctly
    - Test default values (defaultLineWeight=2, defaultDashedPattern=[6,4], defaultDottedPattern=[2,4])
  - [ ] 1.2 Add `line_dashes` field to DiagramEdge interface
    - **File:** `frontend/src/types/model.ts`
    - Add: `line_dashes?: string;` (line ~181, after `line_type`)
    - Format: Space-separated pixel values (e.g., "6px 4px", "10 5")
  - [ ] 1.3 Add edge rendering configuration constants
    - **File:** `frontend/src/config/defaults.ts`
    - Add `edgeRendering` object with:
      - `defaultLineWeight: 2`
      - `defaultDashedPattern: [6, 4]`
      - `defaultDottedPattern: [2, 4]`
      - `lineTypes: { SOLID, DASHED, DOTTED }`
  - [ ] 1.4 Ensure type definition tests pass
    - Run ONLY the 2-4 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- DiagramEdge interface includes `line_dashes?: string`
- Edge rendering constants are exported from defaults.ts
- TypeScript compilation passes without errors
- Tests from 1.1 pass

---

### Task Group 2: Edge Stroke Parsing Utilities
**Effort:** Medium (M)
**Dependencies:** Task Group 1

- [ ] 2.0 Complete edge stroke parsing utilities
  - [ ] 2.1 Write 6-8 focused tests for parsing functions
    - Test `parseLineWeight()`:
      - Returns 2 for undefined/null input
      - Parses "3px" to 3
      - Parses "1.5px" to 1.5
      - Returns 2 for invalid input (e.g., "abc")
    - Test `parseLineDashes()`:
      - Returns [] for undefined/null input
      - Parses "6px 4px" to [6, 4]
      - Parses "10 5 2" to [10, 5, 2]
      - Filters invalid values
    - Test `getEdgeStrokeStyle()`:
      - Returns correct strokeWidth and strokeDasharray for SOLID
      - Returns correct pattern for DASHED with custom line_dashes
      - Returns correct pattern for DOTTED with default pattern
  - [ ] 2.2 Implement `parseLineWeight()` function
    - **File:** `frontend/src/utils/rendering.ts`
    - **Algorithm from spec:**
      ```typescript
      function parseLineWeight(weight?: string): number {
        if (!weight) return 2; // default
        const match = weight.match(/^(\d+(?:\.\d+)?)\s*px$/i);
        return match ? parseFloat(match[1]) : 2;
      }
      ```
  - [ ] 2.3 Implement `parseLineDashes()` function
    - **File:** `frontend/src/utils/rendering.ts`
    - **Algorithm from spec:**
      ```typescript
      function parseLineDashes(dashes?: string): number[] {
        if (!dashes) return [];
        return dashes
          .split(/\s+/)
          .map(s => parseFloat(s.replace(/px$/i, '')))
          .filter(n => !isNaN(n) && n >= 0);
      }
      ```
  - [ ] 2.4 Implement `getEdgeStrokeStyle()` function
    - **File:** `frontend/src/utils/rendering.ts`
    - Returns: `{ strokeWidth: number; strokeDasharray: string }`
    - Uses edgeRendering constants from defaults.ts
    - **Logic:**
      - Parse strokeWidth from line_weight
      - For SOLID: strokeDasharray = ''
      - For DASHED: use line_dashes or default [6, 4]
      - For DOTTED: use line_dashes or default [2, 4]
  - [ ] 2.5 Export all new functions from rendering.ts
    - Export `parseLineWeight`, `parseLineDashes`, `getEdgeStrokeStyle`
  - [ ] 2.6 Ensure parsing utility tests pass
    - Run ONLY the 6-8 tests written in 2.1
    - Verify all edge cases handled correctly
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- All parsing functions correctly handle valid and invalid inputs
- Default values used when fields are missing
- getEdgeStrokeStyle returns correct object for all line types
- Tests from 2.1 pass

---

### Task Group 3: Canvas Edge Rendering Updates
**Effort:** Medium (M)
**Dependencies:** Task Group 2

- [ ] 3.0 Complete canvas edge rendering updates
  - [ ] 3.1 Write 4-6 focused tests for edge rendering
    - Test edge with line_weight="3px" renders with strokeWidth=3
    - Test edge with line_type="DASHED" renders with correct strokeDasharray
    - Test edge with line_type="DOTTED" and custom line_dashes renders correctly
    - Test edge with line_type="SOLID" ignores line_dashes
    - Test edge with no styling uses defaults (strokeWidth=2, no dash)
  - [ ] 3.2 Import `getEdgeStrokeStyle` in Canvas.tsx
    - **File:** `frontend/src/components/DiagramsView/Canvas.tsx`
    - Add to imports from `../../utils/rendering`
  - [ ] 3.3 Apply stroke styles to edge path elements
    - Locate edge rendering code in Canvas.tsx
    - Call `getEdgeStrokeStyle(edge)` for each edge
    - Apply returned `strokeWidth` to path element
    - Apply `strokeDasharray || undefined` to path element
    - **Example from spec:**
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
  - [ ] 3.4 Ensure edge rendering tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify visual rendering matches expected styles
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- Edges render with correct stroke width based on line_weight
- Dashed edges show correct dash pattern
- Dotted edges show correct dot pattern
- Solid edges show continuous line
- Custom line_dashes override defaults for DASHED/DOTTED
- Tests from 3.1 pass

---

### Task Group 4: Label Adjustment Utility and Context Update
**Effort:** Large (L)
**Dependencies:** Task Groups 1-3

- [ ] 4.0 Complete label adjustment functionality
  - [ ] 4.1 Write 6-8 focused tests for label adjustment
    - Test 2-point edge with one endpoint moved: label moves by (dx/2, dy/2)
    - Test 2-point edge with both endpoints moved same delta: label moves by (dx, dy)
    - Test 2-point edge with both endpoints moved different deltas: label moves by average
    - Test 3+ point edge: label does NOT auto-adjust
    - Test edge without label_pos_x/y: no error occurs
    - Test label adjustment persists to state
  - [ ] 4.2 Implement `updateEdgePointsWithLabelAdjust()` utility function
    - **File:** `frontend/src/utils/rendering.ts`
    - **Algorithm from spec:**
      ```typescript
      function updateEdgePointsWithLabelAdjust(
        edge: DiagramEdge,
        pointUpdates: Array<{ index: number; dx: number; dy: number }>
      ): { updatedEdge: DiagramEdge }
      ```
    - **Label adjustment logic:**
      - Only for edges with 2 points and defined label_pos_x/y
      - One point moved: label += (dx/2, dy/2)
      - Both points same delta: label += (dx, dy)
      - Both points different delta: label += average
      - 3+ points: no adjustment
  - [ ] 4.3 Export `updateEdgePointsWithLabelAdjust` from rendering.ts
  - [ ] 4.4 Update MOVE_NODE_WITH_CASCADE reducer for label adjustment
    - **File:** `frontend/src/contexts/ArchitectureContext.tsx`
    - **Changes to existing logic (lines 270-375):**
      1. Group edge point movements by edge ID
      2. Track which points move per edge with their indices and deltas
      3. For each edge, calculate label adjustment based on:
         - Number of points in edge
         - Number of points moving
         - Delta values
      4. Apply both edge_point updates AND label_pos updates
    - **Implementation approach:**
      ```typescript
      // Create map: edgeId -> Array<{index, dx, dy}>
      const edgePointMoves = new Map<string, Array<{index: number; dx: number; dy: number}>>();

      // Populate map during attachment check
      // Then apply updates with label adjustment
      ```
  - [ ] 4.5 Ensure label_pos_x and label_pos_y are updated in state
    - Verify both edge_points AND label positions persist
    - Ensure existing UPDATE_EDGE_LABEL_POSITION action still works
  - [ ] 4.6 Ensure label adjustment tests pass
    - Run ONLY the 6-8 tests written in 4.1
    - Verify all cascade scenarios work correctly
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- One endpoint moved on 2-point edge: label moves half delta
- Both endpoints moved same delta: label moves full delta
- Both endpoints moved different deltas: label moves average
- 3+ point edges: label position unchanged
- Label adjustments persist correctly to state
- Tests from 4.1 pass

---

### Task Group 5: Test Review and Gap Analysis
**Effort:** Medium (M)
**Dependencies:** Task Groups 1-4

- [ ] 5.0 Review existing tests and fill critical gaps only
  - [ ] 5.1 Review tests from Task Groups 1-4
    - Review 2-4 tests from Task Group 1 (types/config)
    - Review 6-8 tests from Task Group 2 (parsing utilities)
    - Review 4-6 tests from Task Group 3 (canvas rendering)
    - Review 6-8 tests from Task Group 4 (label adjustment)
    - Total existing tests: approximately 18-26 tests
  - [ ] 5.2 Analyze test coverage gaps for this feature only
    - Focus ONLY on edge rendering and label consistency features
    - Identify critical end-to-end workflows lacking coverage
    - Prioritize integration between components
    - Do NOT assess entire application test coverage
  - [ ] 5.3 Write up to 8 additional strategic tests maximum
    - **Potential gap areas:**
      - Round-trip persistence (save/load with line styles)
      - Multiple edges with different styles on same diagram
      - Edge style changes reflected immediately on canvas
      - Label persistence after multiple cascade operations
      - Combined scenarios (style + cascade in same operation)
    - Skip exhaustive edge cases and performance tests
  - [ ] 5.4 Run feature-specific tests only
    - Run ONLY tests related to edge rendering and label consistency
    - Expected total: approximately 26-34 tests maximum
    - Do NOT run entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass
- Critical integration points covered
- No more than 8 additional tests added
- Round-trip persistence verified for all new fields

---

## Execution Order

**Recommended implementation sequence:**

1. **Task Group 1: Type Definitions and Configuration** (S)
   - Foundation for all other work
   - No dependencies

2. **Task Group 2: Edge Stroke Parsing Utilities** (M)
   - Pure functions, easy to test
   - Depends on types from Group 1

3. **Task Group 3: Canvas Edge Rendering Updates** (M)
   - Visual implementation
   - Depends on parsing utilities from Group 2

4. **Task Group 4: Label Adjustment Utility and Context Update** (L)
   - Most complex logic
   - Can be developed in parallel with Group 3 after Group 2 completes

5. **Task Group 5: Test Review and Gap Analysis** (M)
   - Final verification
   - Depends on all previous groups

---

## Algorithm Reference

### Edge Stroke Style Algorithm (from spec)

```typescript
function getEdgeStrokeStyle(edge: DiagramEdge): {
  strokeWidth: number;
  strokeDasharray: string;
} {
  const strokeWidth = parseLineWeight(edge.line_weight);
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

  return { strokeWidth, strokeDasharray };
}
```

### Label Adjustment Algorithm (from spec)

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

---

## Notes

- **Existing code patterns:** The UPDATE_EDGE_POINT action (lines 377-441 in ArchitectureContext.tsx) already implements label adjustment for single endpoint drag - reuse this pattern
- **Immutability:** All state updates must be immutable (use spread operators, not direct mutation)
- **Persistence:** The existing save mechanism serializes all DiagramEdge fields, so label_pos_x/y should persist automatically
- **Out of scope:** Animated dash patterns, custom line caps/joins, gradient strokes, label rotation

# Specification: Line Enhancements - Labels and Bend Points

## Goal
Implement two enhancements to ALL line-based elements in the diagram canvas:
1. Make decorative line labels selectable and draggable (matching relationship edge label behaviour)
2. Allow adding bend points via mid-segment handles on all lines (decorative and relationship edges)

These changes apply equally to:
- Relationship edges (`diagram_edges[]`)
- Decorative lines (`decorations[]` with `type = "LINE"`)

## User Stories
- As an architect, I want to drag decorative line labels to position them exactly where I need them.
- As a user, I want to add bend points to any line so I can route lines around nodes cleanly.
- As a user, I want decorative lines and relationship edges to behave identically for a consistent editing experience.

## Design Principle

**Unified line behaviour across all line types.**

- Decorative lines and relationship edges share the same interaction patterns
- Label selection, dragging, and positioning work identically
- Bend point insertion works identically on both line types
- No JSON schema changes required

## Specific Requirements

### 1. Enhancement: Selectable and Draggable Labels on Decorative Lines

#### 1.1 Current Behaviour (Problems)
- Decorative lines may have `text` defined
- Label auto-positions at the midpoint of the polyline unless `label_pos_x`/`label_pos_y` are provided
- Label moves when the underlying line moves
- BUT decorative line labels cannot be:
  - Individually selected
  - Highlighted
  - Dragged to adjust position

#### 1.2 Label Selection
For any decorative line with non-empty `text`:
- The label must render as a selectable element
- Clicking the label selects it (same as relationship labels)
- Selected labels visually highlight (same highlight style as relationship labels)

#### 1.3 Label Dragging
When the label is selected:
- User may click-and-drag it
- Dragging updates:
  - `label_pos_x`
  - `label_pos_y`
- Once manually dragged, these values become authoritative and override auto-placement

#### 1.4 Auto-Centering Rules
If a decorative line has `text` AND does NOT have explicit `label_pos_x`/`label_pos_y`:
- Renderer computes label position as:
  - `label_pos_x = average(all line_points.x)`
  - `label_pos_y = average(all line_points.y)`

After user manually moves the label:
- Auto-centering stops
- Renderer always uses the explicit pos fields

#### 1.5 Unified Behaviour
All label behaviour must match existing relationship label behaviour:
- Hit testing
- Selection
- Dragging
- Z-index layering
- Serialization back to JSON

### 2. Enhancement: Mid-Segment Handles for Bend Points

#### 2.1 Current Behaviour (Problems)
- A line with 2 points is straight
- Selecting a line shows only endpoint handles (small circles)
- User can move endpoints but cannot:
  - Add new points
  - Create bends
  - Shape lines around other nodes

#### 2.2 Mid-Segment Handles
When a line is selected (relationship edge OR decorative line):
- For each pair of consecutive points P(i) → P(i+1):
  - Render a **small square handle** at the midpoint of the segment
  - Position: `((P(i).x + P(i+1).x) / 2, (P(i).y + P(i+1).y) / 2)`

**Visual Distinction:**
- Endpoint handles: **circles** (existing)
- Mid-segment handles: **squares** (new)

#### 2.3 Adding a New Bend Point
When the user clicks and drags a midpoint square:
1. A **new point** is inserted into the underlying data structure:
   - `line_points[]` for decorative lines
   - `edge_points[]` for relationship edges
2. New point is inserted at index (i+1), between P(i) and P(i+1)
3. While dragging:
   - New point follows the cursor
   - Polyline visually updates in real time
4. On drag release:
   - Updated points array is committed to state and JSON model

#### 2.4 Unlimited Bends
- Users may continue adding midpoint handles indefinitely
- After adding a new point:
  - The new point generates two new midpoint handles for the new segments
- No practical limit to the number of bend points

#### 2.5 Label Behaviour with Bends
**Auto-centering:**
- If label is not manually positioned, its auto midpoint uses ALL available points
- Formula: `average(all_points.x)`, `average(all_points.y)`

**Manual positioning:**
- If `label_pos_x`/`label_pos_y` exist, they are preserved regardless of line shape changes

#### 2.6 Unified Behaviour Across All Line Types
- Decorative lines (`decorations[].type = "LINE"`) and relationship edges (`diagram_edges`) share the same implementation
- Handle rendering, insertion, dragging logic, and JSON updates must be identical

### 3. JSON Model (No Schema Changes)

**Decorative Lines:**
- Continue using `line_points[]` with objects `{x, y}`
- Optional fields: `text`, `label_pos_x`, `label_pos_y`

**Relationship Edges:**
- Continue using `edge_points[]` with `{id, sequence_order, pos_x, pos_y}`
- Existing label fields remain unchanged

No changes to schema types or additional properties required.

### 4. Visual Design

**Line with Mid-Segment Handles (selected):**
```
    [●]─────────[■]─────────[●]─────────[■]─────────[●]
    start       mid1        bend1       mid2        end
    (circle)    (square)    (circle)    (square)    (circle)
```

**After dragging mid1:**
```
    [●]                     [●]                     [●]
    start                   new                     end
      \                    /   \                   /
       \                  /     \                 /
        [■]              [■]     [■]            [■]
        mid-a            mid-b   mid-c          mid-d
```

**Label on Line:**
```
    [●]─────────────────[●]
              │
           [Label]  ← selectable, draggable
```

### 5. Handle Styling

**Endpoint Handles (existing circles):**
- Shape: Circle
- Size: ~8px diameter
- Fill: White
- Stroke: Blue (#4a90d9)
- Cursor: Move

**Mid-Segment Handles (new squares):**
- Shape: Square
- Size: ~6px side
- Fill: White
- Stroke: Blue (#4a90d9)
- Cursor: Pointer (or crosshair)

**Selected Label:**
- Background highlight or border to indicate selection
- Match existing relationship label selection style

## Implementation Approach

### Phase 1: Decorative Line Label Selection and Dragging
- Extend hit testing to include decorative line labels
- Add label selection state for decorative lines
- Implement label drag handling for decorative lines
- Update `label_pos_x`/`label_pos_y` on drag end

### Phase 2: Mid-Segment Handle Rendering
- Calculate midpoint positions for all line segments
- Render square handles at midpoints when line is selected
- Apply to both decorative lines and relationship edges

### Phase 3: Bend Point Insertion
- Handle mouse down on mid-segment square
- Insert new point at correct index in points array
- Implement drag tracking for new point
- Commit updated points on drag end

### Phase 4: Unified Implementation
- Ensure decorative lines and relationship edges share implementation
- Abstract common line manipulation logic into shared utilities
- Verify identical behaviour across line types

## Existing Code to Leverage

**Canvas.tsx - Line Rendering and Interaction**
- Existing edge rendering with endpoint handles
- Existing label hit testing for relationship edges
- Extend for decorative lines and mid-segment handles

**decorationUtils.ts - Decorative Line Utilities**
- `calculateLineLabelPosition()` for midpoint calculation
- `isPointNearLineDecoration()` for hit testing
- Extend for label hit testing

**rendering.ts - Render Utilities**
- `renderLineDecoration()` for line rendering
- Add mid-segment handle rendering

**ArchitectureContext.tsx - State Management**
- `UPDATE_DECORATION` action for line updates
- Existing edge point update actions

## Acceptance Criteria

**Decorative Line Labels:**
- [ ] Labels appear at midpoint by default (average of all points)
- [ ] Labels can be selected and show selection highlight
- [ ] Labels can be dragged, updating `label_pos_x` and `label_pos_y`
- [ ] Labels maintain custom position after line edits or dragging
- [ ] Label behaviour matches relationship edge labels

**Relationship Edges:**
- [ ] Continue to behave as they do now
- [ ] Now also show midpoint square handles when selected
- [ ] Midpoint handles allow adding bend points

**Bend Point Insertion:**
- [ ] Selecting any line shows endpoint circles AND midpoint squares
- [ ] Midpoint squares appear between every pair of consecutive points
- [ ] Dragging a midpoint square inserts a new point
- [ ] Line geometry updates live during drag
- [ ] Updated points are committed to JSON on drag end

**Auto-Centering Labels:**
- [ ] Decorative and relationship labels both use average of all points
- [ ] Auto-centering respects all points including newly added bends
- [ ] Manual positioning overrides auto-centering

**Behaviour Parity:**
- [ ] Decorative lines and relationship edges behave identically
- [ ] Selection, dragging, and point editing work the same way
- [ ] JSON serialization is consistent

**Visual Consistency:**
- [ ] Endpoint handles are circles
- [ ] Mid-segment handles are squares
- [ ] Handle styling is consistent between line types
- [ ] Selected labels have visible highlight

## Out of Scope

- Removing bend points (delete functionality)
- Snapping bend points to grid or other elements
- Curved lines or bezier segments
- Automatic line routing around obstacles
- Undo/redo for bend point operations
- Keyboard shortcuts for adding/removing points
- Context menu actions for line editing

## TypeScript Types (No Changes)

Existing types remain unchanged:

```typescript
// Decorative Line (existing)
interface LineDecoration extends DecorationBase {
  type: 'LINE';
  line_points: Array<{ x: number; y: number }>;
  label_pos_x?: number;
  label_pos_y?: number;
  arrow_start?: ArrowType;
  arrow_end?: ArrowType;
}

// Relationship Edge Points (existing)
interface EdgePoint {
  id: string;
  sequence_order: number;
  pos_x: number;
  pos_y: number;
}
```

No new types required - implementation uses existing data structures.

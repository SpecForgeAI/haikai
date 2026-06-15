# Task Breakdown: Diagram Rendering Enhancements

## Overview

Total Tasks: 6 Task Groups, 38 Sub-tasks

This spec implements four enhancements to the Diagrams view rendering:
1. Special stick man rendering for BUSINESS_USER nodes
2. Font styling options for node labels and edge labels
3. Fix missing edge label rendering at label_pos_x/label_pos_y
4. Default label_text for DATA_MOVEMENT edges using logical_data_entity name

## Task List

---

### Type Definitions & Data Layer

#### Task Group 1: Schema Updates and Data Parsing
**Dependencies:** None
**Effort:** S (Small)

- [x] 1.0 Complete schema and data parsing updates
  - [x] 1.1 Write 4 focused tests for type definitions and parsing
    - Test that DiagramNode accepts new font styling fields (text_font_size, text_font_weight, text_font_style)
    - Test that DiagramNode accepts text_area_width field
    - Test that DiagramEdge accepts label font styling fields (label_font_size, label_font_weight, label_font_style)
    - Test that parsing handles missing optional fields gracefully
  - [x] 1.2 Update DiagramNode interface in model.ts
    - **File:** `frontend/src/types/model.ts`
    - Add `text_area_width?: number`
    - Add `text_font_size?: string`
    - Add `text_font_weight?: string`
    - Add `text_font_style?: string`
  - [x] 1.3 Update DiagramEdge interface in model.ts
    - **File:** `frontend/src/types/model.ts`
    - Add `label_font_size?: string`
    - Add `label_font_weight?: string`
    - Add `label_font_style?: string`
  - [x] 1.4 Update fileOperations.ts to parse new fields
    - **File:** `frontend/src/utils/fileOperations.ts`
    - Parse all new optional fields from JSON
    - No defaults needed (undefined is acceptable)
  - [x] 1.5 Run type definition and parsing tests
    - Run only the 4 tests from 1.1
    - Verify TypeScript compiles without errors
    - Verify JSON parsing works correctly

**Acceptance Criteria:**
- TypeScript interfaces updated with all new fields
- JSON parsing extracts all new values correctly
- Optional fields handled gracefully when missing
- 4 tests pass

---

### Font Styling Implementation

#### Task Group 2: Font Styling for Nodes and Edges
**Dependencies:** Task Group 1
**Effort:** S (Small)

- [x] 2.0 Complete font styling implementation
  - [x] 2.1 Write 4 focused tests for font styling
    - Test node label renders with custom font_size
    - Test node label renders with custom font_weight (bold)
    - Test node label renders with custom font_style (italic)
    - Test edge label renders with custom label_font_* properties
  - [x] 2.2 Update measureTextWidth to accept font parameters
    - **File:** `frontend/src/utils/rendering.ts`
    - Modify `measureTextWidth(text: string, fontSize: number, fontWeight?: string, fontStyle?: string): number`
    - Apply font properties to canvas context measurement
  - [x] 2.3 Apply font styling to node text rendering
    - **File:** `frontend/src/components/DiagramsView/Canvas.tsx`
    - Use `text_font_size || '12px'` for fontSize
    - Use `text_font_weight || 'normal'` for fontWeight
    - Use `text_font_style || 'normal'` for fontStyle
    - Apply to SVG text elements
  - [x] 2.4 Run font styling tests
    - Run only the 4 tests from 2.1
    - Verify font properties applied correctly
    - Do NOT run entire test suite

**Acceptance Criteria:**
- Node labels display with custom font size, weight, style
- Defaults applied when properties not specified (12px, normal, normal)
- Text measurement accounts for font properties
- 4 tests pass

---

### Edge Label Rendering

#### Task Group 3: Fix Edge Label Rendering
**Dependencies:** Task Group 2
**Effort:** M (Medium)

- [x] 3.0 Complete edge label rendering fix
  - [x] 3.1 Write 4 focused tests for edge label rendering
    - Test edge label renders at exact label_pos_x, label_pos_y coordinates
    - Test edge label renders with font styling applied
    - Test edge with empty label_text does not render label
    - Test multiple edge labels all appear correctly
  - [x] 3.2 Add edge label rendering to Canvas.tsx
    - **File:** `frontend/src/components/DiagramsView/Canvas.tsx`
    - Inside edge rendering block, after polyline path
    - Check if label_text is non-empty string
    - Check if label_pos_x and label_pos_y are defined
    - Render SVG text element at absolute coordinates
  - [x] 3.3 Apply font styling to edge labels
    - **File:** `frontend/src/components/DiagramsView/Canvas.tsx`
    - Use `label_font_size || '12px'`
    - Use `label_font_weight || 'normal'`
    - Use `label_font_style || 'normal'`
    - Apply to edge label text element
  - [x] 3.4 Run edge label rendering tests
    - Run only the 4 tests from 3.1
    - Verify labels appear at correct positions
    - Do NOT run entire test suite

**Acceptance Criteria:**
- Edge labels render at label_pos_x, label_pos_y
- Labels visible on canvas at correct positions
- Font styling applied to edge labels
- Empty/undefined labels not rendered
- 4 tests pass

---

### DATA_MOVEMENT Default Label

#### Task Group 4: Default Label for DATA_MOVEMENT Edges
**Dependencies:** Task Group 3
**Effort:** M (Medium)

- [x] 4.0 Complete DATA_MOVEMENT default label implementation
  - [x] 4.1 Write 4 focused tests for DATA_MOVEMENT default label
    - Test getEdgeDisplayLabel returns explicit label_text when provided
    - Test getEdgeDisplayLabel returns logical_data_entity.name for DATA_MOVEMENT with empty label
    - Test getEdgeDisplayLabel returns empty string when lookup fails
    - Test default label displays correctly on canvas
  - [x] 4.2 Implement getEdgeDisplayLabel function
    - **File:** `frontend/src/utils/rendering.ts`
    - Add `getEdgeDisplayLabel(edge: DiagramEdge, model: ArchitectureModel): string`
    - Return edge.label_text if defined and non-empty
    - For DATA_MOVEMENT: lookup data_movement -> logical_data_entity -> name
    - Return empty string if lookup fails
  - [x] 4.3 Update Canvas.tsx to use getEdgeDisplayLabel
    - **File:** `frontend/src/components/DiagramsView/Canvas.tsx`
    - Import getEdgeDisplayLabel from rendering.ts
    - Replace direct edge.label_text usage with getEdgeDisplayLabel(edge, state.model)
    - Render returned label at label_pos_x, label_pos_y
  - [x] 4.4 Run DATA_MOVEMENT default label tests
    - Run only the 4 tests from 4.1
    - Verify lookup chain works correctly
    - Do NOT run entire test suite

**Acceptance Criteria:**
- Default label uses logical_data_entity.name
- Lookup follows data_movement -> logical_data_entity chain
- Explicit label_text overrides default
- Failed lookup results in empty label (no error)
- 4 tests pass

---

### BUSINESS_USER Stick Man Rendering

#### Task Group 5: Stick Man Rendering for BUSINESS_USER Nodes
**Dependencies:** Task Group 4
**Effort:** L (Large)

- [x] 5.0 Complete BUSINESS_USER stick man rendering
  - [x] 5.1 Write 6 focused tests for stick man rendering
    - Test BUSINESS_USER node renders as stick man (not rectangle)
    - Test stick man is horizontally centered within node width
    - Test stick man proportions: head 20%, body 40%, legs 40%
    - Test label renders below stick man feet
    - Test text_area_width controls text wrapping
    - Test text alignment (text_h_align, text_v_align) applies to label block
  - [x] 5.2 Add stick man calculation utility functions
    - **File:** `frontend/src/utils/rendering.ts`
    - Add `calculateStickManDimensions(node: DiagramNode): StickManDimensions`
    - Calculate: headRadius, headCenterY, bodyStartY, bodyEndY, armY, armSpan, legEndY, legSpan
    - Based on node.height proportions: 20% head, 40% body, 40% legs
  - [x] 5.3 Add calculateBusinessUserTextPosition function
    - **File:** `frontend/src/utils/rendering.ts`
    - Add `calculateBusinessUserTextPosition(node: DiagramNode, lines: string[], fontSize: number): TextPosition`
    - Text starts below feet (legEndY + 5px gap)
    - Use text_area_width or default (node.width - 10px)
    - Apply text_h_align and text_v_align to label block
  - [x] 5.4 Implement stick man SVG rendering in Canvas.tsx
    - **File:** `frontend/src/components/DiagramsView/Canvas.tsx`
    - Check if node.entity_type === 'BUSINESS_USER'
    - Render SVG elements:
      - Circle for head
      - Line for body (vertical)
      - Line for arms (horizontal at armY)
      - Two lines for legs (diagonal from bodyEnd to legEnd)
    - Use stroke color from entity colors, no fill for stick figure
  - [x] 5.5 Implement BUSINESS_USER text rendering
    - **File:** `frontend/src/components/DiagramsView/Canvas.tsx`
    - Calculate effective text width using text_area_width or default
    - Wrap text using wrapText utility
    - Position text below stick man feet
    - Apply font styling (text_font_size, text_font_weight, text_font_style)
    - Text can extend beyond original node height
  - [x] 5.6 Refactor node rendering to conditionally choose renderer
    - **File:** `frontend/src/components/DiagramsView/Canvas.tsx`
    - Check entity_type at render time
    - BUSINESS_USER: render stick man with text below
    - All other types: render rectangle with text inside (existing behavior)
  - [x] 5.7 Run stick man rendering tests
    - Run only the 6 tests from 5.1
    - Verify visual rendering matches spec
    - Do NOT run entire test suite

**Acceptance Criteria:**
- BUSINESS_USER nodes render as stick man (not rectangle)
- Stick man is centered horizontally within node width
- Stick man proportions are visually appropriate (20/40/40)
- Label text renders below stick man's feet
- text_area_width controls text wrapping when specified
- Default text wrapping uses padded node width
- Text can extend beyond original node height
- Text alignment settings apply to label block
- 6 tests pass

---

### Integration & Sample Data

#### Task Group 6: Sample Data and Integration Testing
**Dependencies:** Task Groups 1-5
**Effort:** S (Small)

- [x] 6.0 Complete sample data and integration testing
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review 4 tests from Task Group 1 (type definitions)
    - Review 4 tests from Task Group 2 (font styling)
    - Review 4 tests from Task Group 3 (edge label rendering)
    - Review 4 tests from Task Group 4 (DATA_MOVEMENT default)
    - Review 6 tests from Task Group 5 (stick man rendering)
    - Total existing: 22 tests
  - [x] 6.2 Update sample-architecture.json with examples
    - **File:** `frontend/public/sample-architecture.json`
    - Add BUSINESS_USER node with text_area_width
    - Add nodes with font styling (text_font_size, text_font_weight, text_font_style)
    - Add edges with label_text at label_pos_x, label_pos_y
    - Add DATA_MOVEMENT edge without label_text (to test default)
    - Add edges with label font styling
  - [x] 6.3 Write up to 8 additional integration tests
    - Test full workflow: load diagram with BUSINESS_USER, verify stick man rendering
    - Test round-trip: save diagram with new fields, reload, verify persistence
    - Test edge label with DATA_MOVEMENT default displays correct entity name
    - Test BUSINESS_USER text wrapping with text_area_width
    - Test combined font styling on nodes and edges
    - Test BUSINESS_USER with all text alignment combinations
    - Test edge labels with font styling render correctly
    - Test non-BUSINESS_USER nodes still render as rectangles
  - [x] 6.4 Run all feature-specific tests
    - Run tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3
    - Expected total: approximately 22-30 tests
    - Do NOT run entire application test suite
    - Verify all enhancements work together
  - [x] 6.5 Manual visual verification
    - Load sample-architecture.json with all new features
    - Verify BUSINESS_USER renders as stick man with label below
    - Verify edge labels appear at correct positions
    - Verify DATA_MOVEMENT default labels work
    - Verify font styling on nodes and edges
    - Verify text_area_width affects wrapping

**Acceptance Criteria:**
- All 22-30 feature tests pass
- Sample data demonstrates all new features
- Round-trip data persistence works
- Visual rendering matches spec requirements
- No regressions in existing diagram functionality
- All four enhancements work together correctly

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Schema Updates and Data Parsing** (S)
   - Foundation for all other work
   - No dependencies

2. **Task Group 2: Font Styling for Nodes and Edges** (S)
   - Simpler feature, establishes font handling patterns
   - Depends on type definitions from Group 1

3. **Task Group 3: Fix Edge Label Rendering** (M)
   - Simpler fix, needed before DATA_MOVEMENT default
   - Depends on font styling from Group 2

4. **Task Group 4: Default Label for DATA_MOVEMENT Edges** (M)
   - Requires edge label rendering to be working
   - Depends on edge label fix from Group 3

5. **Task Group 5: Stick Man Rendering for BUSINESS_USER Nodes** (L)
   - Most complex feature, benefits from all prior work
   - Depends on font styling from Group 2

6. **Task Group 6: Sample Data and Integration Testing** (S)
   - Final verification
   - Depends on all previous groups

## Effort Summary

| Task Group | Effort | Description |
|------------|--------|-------------|
| 1 | S | Schema and parsing updates |
| 2 | S | Font styling implementation |
| 3 | M | Edge label rendering fix |
| 4 | M | DATA_MOVEMENT default label |
| 5 | L | Stick man rendering |
| 6 | S | Sample data and integration |

**Total Estimated Effort:** M-L (Medium to Large)

## Files to Modify Summary

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/types/model.ts` | 1 | Add DiagramNode and DiagramEdge fields |
| `frontend/src/utils/fileOperations.ts` | 1 | Parse new optional fields |
| `frontend/src/utils/rendering.ts` | 2, 4, 5 | Font measurement, getEdgeDisplayLabel, stick man calculations |
| `frontend/src/components/DiagramsView/Canvas.tsx` | 2, 3, 4, 5 | Font styling, edge labels, stick man SVG |
| `frontend/public/sample-architecture.json` | 6 | Add examples for all features |

## Key Constants

These values are fixed for v0.1 (not configurable):

- **Default font size:** 12px
- **Default font weight:** normal
- **Default font style:** normal
- **Stick man head proportion:** 20% of height
- **Stick man body proportion:** 40% of height
- **Stick man legs proportion:** 40% of height
- **Stick man arm span:** ~60% of node width
- **Stick man leg span:** ~40% of node width
- **Text gap below feet:** 5px
- **Default text_area_width:** node.width - 10px

## Key Type Definitions

```typescript
// StickManDimensions interface (to add in rendering.ts)
interface StickManDimensions {
  centerX: number;
  headRadius: number;
  headCenterY: number;
  bodyStartY: number;
  bodyEndY: number;
  armY: number;
  armSpan: number;
  legEndY: number;
  legSpan: number;
}

// getEdgeDisplayLabel function signature
function getEdgeDisplayLabel(edge: DiagramEdge, model: ArchitectureModel): string

// calculateStickManDimensions function signature
function calculateStickManDimensions(node: DiagramNode): StickManDimensions

// calculateBusinessUserTextPosition function signature
function calculateBusinessUserTextPosition(
  node: DiagramNode,
  lines: string[],
  fontSize: number
): { startY: number; getLineX: (index: number, line: string) => number; anchor: string }
```

## Algorithm Reference

### DATA_MOVEMENT Label Lookup

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

### Stick Man Proportions

```typescript
function calculateStickManDimensions(node: DiagramNode): StickManDimensions {
  const centerX = node.pos_x + node.width / 2;
  const topY = node.pos_y;
  const figureHeight = node.height;

  const headRadius = figureHeight * 0.1; // Head is 20% total (radius is 10%)
  const headCenterY = topY + headRadius;
  const bodyStartY = headCenterY + headRadius;
  const bodyEndY = topY + figureHeight * 0.6;
  const armY = bodyStartY + (bodyEndY - bodyStartY) * 0.2;
  const armSpan = node.width * 0.3;
  const legEndY = topY + figureHeight;
  const legSpan = node.width * 0.2;

  return {
    centerX,
    headRadius,
    headCenterY,
    bodyStartY,
    bodyEndY,
    armY,
    armSpan,
    legEndY,
    legSpan
  };
}
```

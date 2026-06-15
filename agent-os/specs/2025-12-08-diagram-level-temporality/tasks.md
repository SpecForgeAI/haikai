# Task Breakdown: Diagram-Level Temporality with Versioned Nodes/Edges

## Overview
Total Tasks: 36

This implementation adds temporal versioning (valid_from/valid_to) to diagram-level elements (DiagramNode, DiagramEdge, Decoration), enabling diagram layouts to evolve across time periods while automatically preserving historical versions through version splitting.

## Task List

### Type Definitions Layer

#### Task Group 1: Add Temporal Fields to Type Definitions
**Dependencies:** None

- [x] 1.0 Complete type definitions layer
  - [x] 1.1 Write 4-6 focused tests for temporal type definitions
    - Test DiagramNode with valid_from/valid_to fields
    - Test DiagramEdge with valid_from/valid_to fields
    - Test DecorationBase with valid_from/valid_to fields
    - Test backward compatibility (undefined fields treated as timeless)
  - [x] 1.2 Add valid_from and valid_to fields to DiagramNode interface
    - File: `frontend/src/types/model.ts` (line ~895)
    - Fields: `valid_from?: string` and `valid_to?: string`
    - Format: "YYYY-Qn" (e.g., "2026-Q2")
    - Reuse pattern from existing temporal entities (e.g., Application, Service)
  - [x] 1.3 Add valid_from and valid_to fields to DiagramEdge interface
    - File: `frontend/src/types/model.ts` (line ~847)
    - Fields: `valid_from?: string` and `valid_to?: string`
    - Apply to all edge types including DiagramInteractionEdge
  - [x] 1.4 Add valid_from and valid_to fields to DecorationBase interface
    - File: `frontend/src/types/model.ts` (line ~765)
    - Both ShapeDecoration and LineDecoration inherit these fields automatically
  - [x] 1.5 Ensure type definitions compile and tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- DiagramNode, DiagramEdge, and DecorationBase interfaces include optional temporal fields
- Existing code compiles without changes (backward compatible)
- Type tests validate field presence and optionality

---

### Utility Functions Layer

#### Task Group 2: Create Diagram Element Visibility Utilities
**Dependencies:** Task Group 1

- [x] 2.0 Complete visibility utilities
  - [x] 2.1 Write 5-7 focused tests for diagram element visibility
    - Test element with no temporal fields (always visible)
    - Test element with valid_from only (visible from that quarter onward)
    - Test element with valid_to only (visible until that quarter)
    - Test element with both fields (visible in window)
    - Test edge cases: viewQuarter equals valid_from, viewQuarter equals valid_to
  - [x] 2.2 Create isDiagramElementVisibleInPeriod() function
    - File: `frontend/src/utils/quarterUtils.ts`
    - Signature: `isDiagramElementVisibleInPeriod(element: { valid_from?: string; valid_to?: string }, viewQuarter: string): boolean`
    - Visibility rule: `(valid_from is null OR valid_from <= V) AND (valid_to is null OR valid_to > V)`
    - Reuse pattern from existing `isEntityVisibleInPeriod()`
  - [x] 2.3 Create helper type for temporal diagram elements
    - Type: `TemporalDiagramElement = { valid_from?: string; valid_to?: string }`
    - Use in isDiagramElementVisibleInPeriod signature
  - [x] 2.4 Ensure visibility utility tests pass
    - Run ONLY the 5-7 tests written in 2.1
    - Verify all visibility scenarios work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- isDiagramElementVisibleInPeriod() correctly filters elements by viewQuarter
- Null/undefined temporal fields treated as "always visible"
- Boundary conditions handled correctly (inclusive start, exclusive end)

---

#### Task Group 3: Create Version Splitting Utilities
**Dependencies:** Task Group 1, Task Group 2

- [x] 3.0 Complete version splitting utilities
  - [x] 3.1 Write 6-8 focused tests for version splitting logic
    - Test splitting timeless element when editing in future period
    - Test splitting timeless element when editing in past period
    - Test splitting already-versioned element
    - Test no split when edit is within existing validity window
    - Test period_before and period_after calculations
    - Test edge case: element with valid_from equals viewQuarter
  - [x] 3.2 Create splitDiagramNode() function
    - File: `frontend/src/utils/temporalSplitting.ts` (new file)
    - Signature: `splitDiagramNode(node: DiagramNode, viewQuarter: string, updates: Partial<DiagramNode>): { original: DiagramNode; newVersion: DiagramNode } | null`
    - Returns null if no split needed (edit within existing validity)
    - Uses addQuarters() for period_before/period_after calculations
  - [x] 3.3 Create splitDiagramEdge() function
    - Same pattern as splitDiagramNode
    - Signature: `splitDiagramEdge(edge: DiagramEdge, viewQuarter: string, updates: Partial<DiagramEdge>): { original: DiagramEdge; newVersion: DiagramEdge } | null`
  - [x] 3.4 Create splitDecoration() function
    - Same pattern for Decoration elements
    - Signature: `splitDecoration(decoration: Decoration, viewQuarter: string, updates: Partial<Decoration>): { original: Decoration; newVersion: Decoration } | null`
  - [x] 3.5 Create shouldTriggerSplit() helper function
    - Determines if a given set of updates should trigger version splitting
    - Position changes (pos_x, pos_y): YES
    - Dimension changes (width, height): YES
    - Style changes (colors, line_style): YES
    - Edge routing changes (edge_points): YES
    - Selection/z_index changes: NO
  - [x] 3.6 Create generateVersionId() helper function
    - Generates unique ID for new version (e.g., `${originalId}_v${timestamp}`)
    - Ensures new version has distinct ID from original
  - [x] 3.7 Ensure splitting utility tests pass
    - Run ONLY the 6-8 tests written in 3.1
    - Verify all splitting scenarios work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Version splitting creates correct validity windows
- Original element validity is adjusted correctly
- New version has correct valid_from/valid_to based on edit context
- Non-splitting edits return null (no version created)

---

### Reducer Integration Layer

#### Task Group 4: Integrate Splitting into Reducer Actions
**Dependencies:** Task Group 3

- [x] 4.0 Complete reducer integration
  - [x] 4.1 Write 4-6 focused tests for reducer splitting behavior
    - Test UPDATE_DIAGRAM_NODE triggers split when editing in future period
    - Test UPDATE_DIAGRAM_EDGE triggers split correctly
    - Test UPDATE_DECORATION triggers split correctly
    - Test MOVE_NODE_WITH_CASCADE includes splitting logic
    - Test no split when edit is within current validity window
  - [x] 4.2 Modify UPDATE_DIAGRAM_NODE action handler
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Get diagram.view_quarter as temporal context
    - Call shouldTriggerSplit() to check if splitting is needed
    - If split needed, call splitDiagramNode() and add both versions to diagram
    - If no split, update node as before (existing behavior)
  - [x] 4.3 Modify UPDATE_DIAGRAM_EDGE action handler
    - Same splitting logic pattern as UPDATE_DIAGRAM_NODE
    - Handle edge_points updates that trigger splitting
  - [x] 4.4 Modify UPDATE_DECORATION action handler
    - Same splitting logic pattern for decorations
  - [x] 4.5 Modify MOVE_NODE_WITH_CASCADE action handler
    - Position changes (dx, dy) should trigger splitting
    - Split node before applying cascade logic
    - Ensure attached edge points are handled correctly with split nodes
  - [x] 4.6 Ensure reducer integration tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify splitting triggers correctly in reducer
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Reducer actions detect temporal context from diagram.view_quarter
- Splitting triggers for position, dimension, and style changes
- Both original and new versions are added to diagram arrays
- Non-splitting changes work as before (backward compatible)

---

### Temporal Filtering Layer

#### Task Group 5: Update Rendering Functions for Temporal Filtering
**Dependencies:** Task Group 2

- [x] 5.0 Complete temporal filtering in rendering
  - [x] 5.1 Write 4-6 focused tests for temporal rendering filtering
    - Test getNodesInRenderOrder filters by both entity AND diagram node validity
    - Test getEdgesForDiagram filters by both relationship AND diagram edge validity
    - Test decorations are filtered by decoration validity
    - Test combined filtering (entity invalid but node valid - should not render)
  - [x] 5.2 Update getNodesInRenderOrder() to include diagram node filtering
    - File: `frontend/src/utils/rendering.ts`
    - After entity visibility check, also check isDiagramElementVisibleInPeriod(node, viewQuarter)
    - Node is visible only if BOTH entity AND diagram node are visible
  - [x] 5.3 Update getEdgesForDiagram() to include diagram edge filtering
    - After relationship and endpoint visibility checks
    - Add isDiagramElementVisibleInPeriod(edge, viewQuarter) check
    - Edge is visible only if relationship AND diagram edge are visible
  - [x] 5.4 Create getDecorationsForDiagram() function
    - New function: `getDecorationsForDiagram(diagramId: string, model: ArchitectureModel, viewQuarter?: string): Decoration[]`
    - Filter decorations array by isDiagramElementVisibleInPeriod()
    - Return all decorations if viewQuarter is not provided
  - [x] 5.5 Ensure temporal filtering tests pass
    - Run ONLY the 4-6 tests written in 5.1
    - Verify combined filtering works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Nodes require both entity AND diagram node to be visible
- Edges require relationship, endpoints, AND diagram edge to be visible
- Decorations are filtered by their own temporal fields only
- Missing viewQuarter falls back to showing all elements

---

### Rendering Integration Layer

#### Task Group 6: Update Canvas.tsx for Temporal Filtering
**Dependencies:** Task Group 5

- [x] 6.0 Complete Canvas rendering integration
  - [x] 6.1 Write 2-4 focused tests for Canvas temporal rendering
    - Test Canvas renders only visible nodes for given viewQuarter
    - Test Canvas renders only visible edges for given viewQuarter
    - Test Canvas renders only visible decorations for given viewQuarter
  - [x] 6.2 Update Canvas.tsx to use filtered decorations
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Import getDecorationsForDiagram() from rendering.ts
    - Replace direct diagram.decorations access with filtered function
    - Pass diagram.view_quarter (or getDefaultViewQuarter()) to filtering
  - [x] 6.3 Verify nodes and edges already use temporal filtering
    - Confirm getNodesInRenderOrder() is called with viewQuarter parameter
    - Confirm getEdgesForDiagram() is called with viewQuarter parameter
    - Add viewQuarter parameter if not already passed
  - [x] 6.4 Update useMemo dependencies for temporal filtering
    - Ensure renderOrder memoization includes viewQuarter dependency
    - Ensure edges memoization includes viewQuarter dependency
    - Ensure decorations memoization includes viewQuarter dependency
  - [x] 6.5 Ensure Canvas rendering tests pass
    - Run ONLY the 2-4 tests written in 6.1
    - Verify Canvas renders correct elements for viewQuarter
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Canvas renders only temporally-valid elements for current view_quarter
- Changing view_quarter updates visible elements immediately
- Memoization correctly recalculates when view_quarter changes

---

### Persistence Layer

#### Task Group 7: Verify Persistence and Backward Compatibility
**Dependencies:** Task Group 1

- [x] 7.0 Complete persistence verification
  - [x] 7.1 Write 3-4 focused tests for persistence
    - Test loading diagram without temporal fields (legacy file)
    - Test saving diagram with temporal fields
    - Test loading diagram with temporal fields on some elements
    - Test round-trip: save then load preserves temporal fields
  - [x] 7.2 Verify JSON serialization includes temporal fields
    - No code changes needed (TypeScript optional fields serialize as-is)
    - Test that undefined/null fields are not written to JSON
    - Test that present fields are correctly serialized
  - [x] 7.3 Verify LOAD_MODEL action handles temporal fields
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Confirm existing LOAD_MODEL logic does not strip optional fields
    - No changes expected (optional fields pass through)
  - [x] 7.4 Document backward compatibility behavior
    - Create inline code comments explaining null = "always valid"
    - Ensure no migration script is needed
  - [x] 7.5 Ensure persistence tests pass
    - Run ONLY the 3-4 tests written in 7.1
    - Verify save/load works correctly with and without temporal fields
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Existing diagrams without temporal fields load and work correctly
- Diagrams with temporal fields save and load correctly
- No data migration required for existing files

---

### Testing Layer

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 4-6 tests written by type definitions (Task 1.1)
    - Review the 5-7 tests written for visibility utilities (Task 2.1)
    - Review the 6-8 tests written for splitting utilities (Task 3.1)
    - Review the 4-6 tests written for reducer integration (Task 4.1)
    - Review the 4-6 tests written for rendering filtering (Task 5.1)
    - Review the 2-4 tests written for Canvas integration (Task 6.1)
    - Review the 3-4 tests written for persistence (Task 7.1)
    - Total existing tests: approximately 28-41 tests
  - [x] 8.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus ONLY on gaps related to diagram-level temporality
    - Prioritize: user edits node in future period triggers split
    - Prioritize: changing view_quarter shows different element versions
    - Do NOT assess entire application test coverage
  - [x] 8.3 Write up to 6 additional strategic tests maximum
    - E2E test: Edit node position in future period creates two versions
    - E2E test: Both versions visible at their respective time periods
    - E2E test: Edit within existing validity window does not split
    - Integration test: Canvas renders correct version for viewQuarter
    - Integration test: Edge attached to split node updates correctly
    - Regression test: Non-temporal features still work after changes
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY tests related to diagram-level temporality
    - Expected total: approximately 34-47 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 34-47 tests total)
- Critical user workflows for diagram-level temporality are covered
- No more than 6 additional tests added to fill gaps
- Testing focused exclusively on this feature's requirements

---

## Execution Order

Recommended implementation sequence:

1. **Type Definitions Layer (Task Group 1)** - Add temporal fields to interfaces
2. **Visibility Utilities (Task Group 2)** - Create diagram element visibility function
3. **Splitting Utilities (Task Group 3)** - Create version splitting functions
4. **Reducer Integration (Task Group 4)** - Hook splitting into UPDATE actions
5. **Temporal Filtering (Task Group 5)** - Update rendering.ts filtering functions
6. **Rendering Integration (Task Group 6)** - Update Canvas.tsx to use filtered elements
7. **Persistence (Task Group 7)** - Verify save/load works correctly
8. **Test Review (Task Group 8)** - Fill any critical test gaps

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `frontend/src/types/model.ts` | DiagramNode, DiagramEdge, DecorationBase interfaces |
| `frontend/src/utils/quarterUtils.ts` | Quarter comparison and visibility utilities |
| `frontend/src/utils/temporalSplitting.ts` | **NEW** Version splitting functions |
| `frontend/src/utils/rendering.ts` | Node/edge filtering functions |
| `frontend/src/contexts/ArchitectureContext.tsx` | Reducer actions (UPDATE_DIAGRAM_NODE, etc.) |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Diagram rendering component |

---

## Implementation Notes

- **Time format**: "YYYY-Qn" (e.g., "2024-Q3") - matches existing meta-model temporality
- **Visibility rule**: `(valid_from is null OR valid_from <= V) AND (valid_to is null OR valid_to > V)`
- **Splitting trigger**: Position, dimension, or style changes in a period outside current validity
- **No split**: Edits within existing validity range update in place
- **Backward compatibility**: Null/undefined temporal fields mean "always valid"
- **ID generation**: New versions get unique IDs (e.g., `node_123_v1702000000000`)

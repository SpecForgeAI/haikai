# Task Breakdown: Activity Diagram Visualisation v1

## Overview
Total Tasks: 42 (across 6 task groups)

This specification upgrades Activity diagrams from generic boxes to UML/BPMN-style activity diagrams with swimlanes (Activity Partitions), typed activity node shapes based on activityKind, and Activity Flow edges. This is a frontend-only implementation.

## Task List

### Configuration & Constants Layer

#### Task Group 1: Activity Diagram Defaults and Type Definitions
**Dependencies:** None

- [x] 1.0 Complete configuration and type definitions
  - [x] 1.1 Write 4 focused tests for ACTIVITY_NODE_DEFAULTS constant
    - Test that ACTIVITY_NODE_DEFAULTS exports correct shape definitions for all activityKind types
    - Test that Initial node defaults include black fill, 18px diameter
    - Test that Action node defaults include green theme, rounded rectangle dimensions
    - Test that Decision/Merge/Final node defaults have correct neutral styling
  - [x] 1.2 Create ACTIVITY_NODE_DEFAULTS constant in defaults.ts
    - Define Initial: solid black circle, diameter 18px, no label area
    - Define Action: rounded rectangle 140x50px, green theme from entityColors.ACTIVITY
    - Define Decision: diamond 60x60px, optional label, neutral black/white
    - Define Merge: diamond 20x20px, no label, neutral black/white
    - Define Final: bullseye 22px diameter, neutral black/white
    - Include stroke_width, fill, stroke colours for each kind
  - [x] 1.3 Create ACTIVITY_PARTITION_DEFAULTS constant in defaults.ts
    - Define header_height: 30px
    - Define header_background: slightly darker than body
    - Define body_background: light fill matching entityColors.ACTIVITY_PARTITION
    - Define border_color, border_width, divider_style
    - Define default_width: 200px, min_width: 150px
    - Define orientation: 'VERTICAL' as default
  - [x] 1.4 Create ACTIVITY_FLOW_DEFAULTS constant in defaults.ts
    - Define line_color, line_width, arrow_size
    - Define label_font_size, label_offset
    - Define flowKind default: 'Control'
  - [x] 1.5 Add ActivityDiagramOrientation type if not present in model.ts
    - Type: 'VERTICAL' | 'HORIZONTAL'
  - [x] 1.6 Ensure configuration tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify all constants export correctly

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- ACTIVITY_NODE_DEFAULTS exports all 5 activityKind configurations
- ACTIVITY_PARTITION_DEFAULTS exports header/body styling
- ACTIVITY_FLOW_DEFAULTS exports edge styling defaults
- Constants follow existing DECORATION_DEFAULTS pattern

---

### Activity Node Shape Rendering

#### Task Group 2: Activity Node Shape Functions
**Dependencies:** Task Group 1

- [x] 2.0 Complete activity node shape rendering functions
  - [x] 2.1 Write 6 focused tests for activity node shape rendering
    - Test renderInitialNode returns filled black circle path with 18px diameter
    - Test renderActionNode returns rounded rectangle path with label area
    - Test renderDecisionNode returns diamond path at 60x60px
    - Test renderMergeNode returns diamond path at 20x20px (smaller than Decision)
    - Test renderFinalNode returns bullseye path (outer + inner circles)
    - Test renderActivityNode dispatches correctly based on activityKind
  - [x] 2.2 Create activityNodeRendering.ts utility file
    - Import ShapeRenderResult interface from shapeRendering.ts
    - Import ACTIVITY_NODE_DEFAULTS from defaults.ts
    - Define ActivityNodeRenderResult extending ShapeRenderResult with showLabel flag
  - [x] 2.3 Implement renderInitialNode function
    - Use renderCircle pattern from shapeRendering.ts
    - Fill: black, stroke: black
    - Return showLabel: false
  - [x] 2.4 Implement renderActionNode function
    - Render rounded rectangle with pill-like corners (rx=25)
    - Fill: entityColors.ACTIVITY.background
    - Stroke: entityColors.ACTIVITY.border
    - Return showLabel: true with centered text position
  - [x] 2.5 Implement renderDecisionNode function
    - Reuse renderDiamond pattern from shapeRendering.ts
    - Apply 60x60px sizing
    - Return showLabel: true with optional above/centered position
  - [x] 2.6 Implement renderMergeNode function
    - Reuse renderDiamond pattern at 20x20px
    - Neutral black/white styling
    - Return showLabel: false
  - [x] 2.7 Implement renderFinalNode function
    - Render bullseye: outer circle stroke + inner filled circle
    - Outer: 22px diameter, stroke only
    - Inner: 14px diameter, filled black
    - Return showLabel: false
  - [x] 2.8 Implement renderActivityNode dispatcher function
    - Accept activity entity and position
    - Default to renderActionNode if activityKind is missing
    - Return appropriate ActivityNodeRenderResult
  - [x] 2.9 Ensure activity node shape tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify all node kinds render correctly

**Acceptance Criteria:**
- The 6 tests written in 2.1 pass
- All 5 activity node kinds render correctly
- Backward compatibility: nodes without activityKind render as Action
- Functions follow existing shapeRendering.ts patterns

---

### Activity Partition Swimlane Rendering

#### Task Group 3: Partition Swimlane Component
**Dependencies:** Task Group 1

- [x] 3.0 Complete partition swimlane rendering
  - [x] 3.1 Write 5 focused tests for partition rendering
    - Test partition renders with header and body regions
    - Test VERTICAL orientation renders header at top, lane extending down
    - Test HORIZONTAL orientation renders header on left, lane extending right
    - Test partition without orientation defaults to VERTICAL
    - Test partition name displays centered in header
  - [x] 3.2 Create ActivityPartitionRenderer component
    - Accept partition entity, position, dimensions as props
    - Accept orientation prop (default: 'VERTICAL')
    - Accept children activities for containment reference
  - [x] 3.3 Implement VERTICAL partition layout
    - Header at top with distinct background
    - Divider line between header and body
    - Body extends from divider to bottom of partition
    - Full border around partition
  - [x] 3.4 Implement HORIZONTAL partition layout
    - Header on left with distinct background
    - Divider line between header and body
    - Body extends from divider to right edge
    - Full border around partition
  - [x] 3.5 Implement partition header text rendering
    - Center partition name in header region
    - Use wrapText for long names
    - Apply text styling from ACTIVITY_PARTITION_DEFAULTS
  - [x] 3.6 Export renderPartition function for use in ActivityDiagramRenderer
    - Return SVG group containing header rect, body rect, divider, text
    - Include data attributes for selection/interaction
  - [x] 3.7 Ensure partition rendering tests pass
    - Run ONLY the 5 tests written in 3.1
    - Verify both orientations render correctly

**Acceptance Criteria:**
- The 5 tests written in 3.1 pass
- Partitions render with clear header/body distinction
- Both VERTICAL and HORIZONTAL orientations work
- Partition names display correctly in headers

---

### Activity Flow Edge Rendering

#### Task Group 4: Activity Flow Edge Component and Creation UX
**Dependencies:** Task Groups 1, 2

- [x] 4.0 Complete activity flow edge rendering and creation
  - [x] 4.1 Write 6 focused tests for activity flow rendering and creation
    - Test activity flow renders as straight line between activities
    - Test arrowhead points to target activity
    - Test flow with condition/trigger displays label at midpoint
    - Test flow creation mode activates on button click
    - Test clicking source then target creates ActivityFlow and DiagramEdge
    - Test Escape key exits flow creation mode
  - [x] 4.2 Create renderActivityFlow function in activityNodeRendering.ts
    - Accept source and target activity positions
    - Accept flowKind (Control/Data) for potential styling variation
    - Use calculateArrowhead from rendering.ts
    - Return path data for line and arrowhead
  - [x] 4.3 Implement activity flow label rendering
    - Calculate midpoint of edge
    - Render condition/trigger text at midpoint
    - For Decision outgoing flows, position "Yes"/"No" labels near edge
  - [x] 4.4 Add "+ New Activity Flow" button to PalettePanel CREATE section
    - Only visible when diagram.type === 'Activity'
    - Button text: "+ New Activity Flow"
    - On click: dispatch flow creation mode state
  - [x] 4.5 Implement flow creation mode state in DiagramsView
    - Add flowCreationMode state: { active: boolean, sourceActivityId: string | null }
    - Add handleStartFlowCreation callback
    - Add handleCancelFlowCreation callback (Escape key)
  - [x] 4.6 Implement flow creation click handling in Canvas
    - When flowCreationMode.active and sourceActivityId is null: first click sets source
    - When flowCreationMode.active and sourceActivityId is set: second click creates flow
    - Create ActivityFlow entity in metaModel
    - Create DiagramEdge referencing the flow
    - Exit flow creation mode on success
  - [x] 4.7 Wire Escape key to cancel flow creation mode
    - Add keydown listener for Escape
    - Reset flowCreationMode state
  - [x] 4.8 Ensure activity flow tests pass
    - Run ONLY the 6 tests written in 4.1
    - Verify flow rendering and creation work correctly

**Acceptance Criteria:**
- The 6 tests written in 4.1 pass
- Activity flows render with arrowheads pointing to target
- Labels display at midpoints when present
- Flow creation UX works: button -> click source -> click target -> done
- Escape key cancels flow creation mode

---

### Activity Diagram Renderer Component

#### Task Group 5: ActivityDiagramRenderer Integration
**Dependencies:** Task Groups 2, 3, 4

- [x] 5.0 Complete ActivityDiagramRenderer component
  - [x] 5.1 Write 6 focused tests for ActivityDiagramRenderer
    - Test renderer renders when diagram.type === 'Activity'
    - Test partitions render at lowest z-index (behind activities)
    - Test activities render above partitions
    - Test flows render above activities
    - Test activities render with correct shapes based on activityKind
    - Test general diagrams still use existing renderer (no regression)
  - [x] 5.2 Create ActivityDiagramRenderer.tsx component
    - Follow SequenceDiagramRenderer.tsx architecture pattern
    - Accept diagram, metaModel, zoom props
    - Define local constants for styling
  - [x] 5.3 Implement partition collection and rendering
    - Filter diagram_nodes for ACTIVITY_PARTITION entity_type
    - Render partitions first (lowest z-index)
    - Apply partition orientation from entity or default VERTICAL
  - [x] 5.4 Implement activity node collection and rendering
    - Filter diagram_nodes for ACTIVITY entity_type
    - Render using renderActivityNode based on activityKind
    - Position labels for Action/Decision nodes
    - Skip labels for Initial/Merge/Final nodes
  - [x] 5.5 Implement activity flow edge rendering
    - Filter diagram_edges for ACTIVITY_FLOW relationship_type
    - Render using renderActivityFlow function
    - Position labels at edge midpoints
  - [x] 5.6 Implement z-index layering
    - Partitions: z-index 50 (below standard nodes at 100)
    - Activities: z-index 100 (standard node level)
    - Flows: z-index 110 (above activities for visibility)
  - [x] 5.7 Integrate ActivityDiagramRenderer into Canvas.tsx
    - Import ActivityDiagramRenderer
    - Add conditional: if diagram.type === 'Activity', use ActivityDiagramRenderer
    - Preserve existing rendering for all other diagram types
  - [x] 5.8 Ensure ActivityDiagramRenderer tests pass
    - Run ONLY the 6 tests written in 5.1
    - Verify no regression for existing diagram types

**Acceptance Criteria:**
- The 6 tests written in 5.1 pass
- Activity diagrams render with new component
- Z-index layering correct: partitions < activities < flows
- Other diagram types unaffected (no regression)
- Component follows SequenceDiagramRenderer patterns

---

### Activity Flow Inspector and Interaction

#### Task Group 6: Flow Inspector and Partition/Node Interaction
**Dependencies:** Task Group 5

- [x] 6.0 Complete inspector and interaction features
  - [x] 6.1 Write 5 focused tests for inspector and interaction
    - Test selecting flow edge shows SelectionInspector
    - Test inspector displays editable fields: condition, trigger, flowKind
    - Test changing flowKind updates edge label live
    - Test activities are draggable within canvas
    - Test partitions are draggable and resizable as unit
  - [x] 6.2 Extend SelectionInspector for ACTIVITY_FLOW edges
    - Add condition field (text input)
    - Add trigger field (text input)
    - Add flowKind field (dropdown: Control/Data)
    - Wire onChange handlers to update entity and edge
  - [x] 6.3 Implement live edge label update
    - When condition or trigger changes, update edge label_text
    - Trigger re-render to show updated label on canvas
  - [x] 6.4 Ensure activities are draggable
    - Activities follow existing node drag patterns
    - Soft constraint: visual feedback when dragging outside partition
    - No hard constraint enforcement (manual layout preservation)
  - [x] 6.5 Ensure partitions are draggable and resizable
    - Partitions follow existing node drag patterns
    - Resize handles on partition corners and edges
    - Header/body maintain proportions during resize
  - [x] 6.6 Implement automatic flow repositioning
    - When activity node moves, connected flow endpoints update
    - Use existing edge point attachment patterns
  - [x] 6.7 Ensure inspector and interaction tests pass
    - Run ONLY the 5 tests written in 6.1
    - Verify all interaction features work correctly

**Acceptance Criteria:**
- The 5 tests written in 6.1 pass
- Flow edges selectable and inspectable
- Inspector shows condition, trigger, flowKind fields
- Live canvas updates when inspector fields change
- Activities and partitions draggable/resizable

---

### Testing

#### Task Group 7: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 4 tests from Task Group 1 (configuration)
    - Review the 6 tests from Task Group 2 (node shapes)
    - Review the 5 tests from Task Group 3 (partitions)
    - Review the 6 tests from Task Group 4 (flows/creation)
    - Review the 6 tests from Task Group 5 (renderer)
    - Review the 5 tests from Task Group 6 (inspector/interaction)
    - Total existing tests: 32 tests
  - [x] 7.2 Analyze test coverage gaps for Activity Diagram Visualisation
    - Identify critical end-to-end workflows lacking coverage
    - Focus on integration between partition, activity, and flow
    - Do NOT assess entire application test coverage
  - [x] 7.3 Write up to 10 additional strategic tests maximum
    - E2E: Create activity diagram with partition, activities, and flows
    - E2E: Change activity activityKind and verify shape updates
    - Integration: Drag activity within partition boundary
    - Integration: Resize partition and verify contained activities adjust
    - Integration: Flow creation from Decision node with "Yes"/"No" labels
    - Skip edge cases unless business-critical
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests related to Activity Diagram Visualisation
    - Expected total: approximately 32-42 tests
    - Do NOT run entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 32-42 tests total)
- Critical user workflows for Activity Diagram Visualisation are covered
- No more than 10 additional tests added
- Testing focused exclusively on this spec's requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Configuration & Constants** (No dependencies)
   - Foundation for all other task groups
   - Defines ACTIVITY_NODE_DEFAULTS, ACTIVITY_PARTITION_DEFAULTS, ACTIVITY_FLOW_DEFAULTS

2. **Task Group 2: Activity Node Shape Rendering** (Depends on Group 1)
   - Implements shape functions for all 5 activityKind types
   - Essential for visualizing activity nodes

3. **Task Group 3: Partition Swimlane Rendering** (Depends on Group 1)
   - Can be developed in parallel with Group 2
   - Implements swimlane containers with header/body regions

4. **Task Group 4: Activity Flow Edge Rendering** (Depends on Groups 1, 2)
   - Implements flow edge rendering and creation UX
   - Requires node shapes to be complete for endpoint positioning

5. **Task Group 5: ActivityDiagramRenderer Integration** (Depends on Groups 2, 3, 4)
   - Main renderer component integrating all pieces
   - Canvas.tsx integration for conditional rendering

6. **Task Group 6: Flow Inspector and Interaction** (Depends on Group 5)
   - Inspector fields for flow editing
   - Drag/resize interactions for partitions and activities

7. **Task Group 7: Test Review & Gap Analysis** (Depends on Groups 1-6)
   - Final verification and strategic test additions

---

## Files to Create/Modify

### New Files
- `frontend/src/utils/activityNodeRendering.ts` - Activity node shape rendering functions
- `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx` - Main renderer component
- `frontend/src/components/DiagramsView/ActivityPartitionRenderer.tsx` - Partition swimlane component (optional, can be in main renderer)
- `frontend/src/__tests__/activity-diagram-rendering.test.ts` - Unit tests

### Files to Modify
- `frontend/src/config/defaults.ts` - Add ACTIVITY_NODE_DEFAULTS, ACTIVITY_PARTITION_DEFAULTS, ACTIVITY_FLOW_DEFAULTS
- `frontend/src/components/DiagramsView/Canvas.tsx` - Conditional rendering for Activity diagrams
- `frontend/src/components/DiagramsView/PalettePanel.tsx` - Add "+ New Activity Flow" button
- `frontend/src/components/DiagramsView/DiagramsView.tsx` - Flow creation mode state
- `frontend/src/components/DiagramsView/SelectionInspector.tsx` - ACTIVITY_FLOW edge fields

---

## Key Patterns to Follow

### From SequenceDiagramRenderer.tsx
- Component architecture with typed props interface
- Local constants for font sizes, stroke widths, colours
- Layout computation followed by element rendering
- Memoization with useMemo for performance

### From shapeRendering.ts
- ShapeRenderResult interface for shape output
- renderDiamond(), renderCircle() reuse for Decision/Merge and Initial/Final
- Path data generation patterns

### From rendering.ts
- calculateArrowhead() for flow arrowheads
- wrapText() and measureTextWidth() for labels
- getEntityLabel() for activity name resolution

### From defaults.ts
- DECORATION_DEFAULTS pattern for new constants
- baseShapeDefaults structure for consistent styling

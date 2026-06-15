# Task Breakdown: Relationship Visualisation and RHS Palette Behaviour

## Overview
Total Tasks: 48

This feature standardises how meta-model relationships are visualised on diagrams and how the RHS Relationships palette enables/disables rows and handles add interactions (left-click and context menu), ensuring each relationship type renders with its correct visual pattern.

## Task List

### Foundation Layer - Types and Data Structures

#### Task Group 1: Type Definitions and Data Structures
**Dependencies:** None

- [x] 1.0 Complete type definitions and data structures
  - [x] 1.1 Write 4-6 focused tests for type definitions and utilities
    - Test RelationshipEdgeType enum value validation
    - Test multiplicity label type structures
    - Test source/target label position field presence on DiagramEdge
    - Test cardinality-to-label mapping utility
  - [x] 1.2 Define/extend RelationshipEdgeType enum in `model.ts`
    - Add constants: `BUSINESS_USER_PROCESS`, `APPLICATION_POINT_BUSINESS_PROCESS`, `LOGICAL_DATA_ENTITY_RELATIONSHIP`, `LOGICAL_DATA_ENTITY_PHYSICAL_DATA_ENTITY`, `LOGICAL_DATA_ATTRIBUTE_PHYSICAL_DATA_ATTRIBUTE`, `DATA_MOVEMENT`
    - Ensure alignment with existing `relationshipTypeMap` in `rendering.ts`
  - [x] 1.3 Extend DiagramEdge interface for multiplicity labels
    - Add `source_label_text?: string` for source-side multiplicity
    - Add `source_label_pos_x?: number`, `source_label_pos_y?: number`
    - Add `target_label_text?: string` for target-side multiplicity
    - Add `target_label_pos_x?: number`, `target_label_pos_y?: number`
  - [x] 1.4 Create cardinality-to-multiplicity mapping utility
    - Create `getMultiplicityLabels(relationshipType: string): { source: string; target: string }` in `rendering.ts`
    - Map: ONE_TO_ONE -> ("1", "1"), ONE_TO_MANY -> ("1", "m"), MANY_TO_ONE -> ("m", "1"), MANY_TO_MANY -> ("m", "m")
  - [x] 1.5 Ensure type definition tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- DiagramEdge interface includes source/target label fields
- Cardinality mapping utility returns correct labels
- TypeScript compiles without errors

---

### Enable/Disable Logic Layer

#### Task Group 2: Endpoint Detection Utilities
**Dependencies:** Task Group 1

- [x] 2.0 Complete endpoint detection utilities
  - [x] 2.1 Write 6-8 focused tests for endpoint detection
    - Test finding node by entity_type and entity_id
    - Test checking if both endpoints are on diagram (true/false cases)
    - Test checking App Point + Process containment scenarios
    - Test checking source/target Application Points for Data Movements
  - [x] 2.2 Create `findNodeForEntity` utility in new file `relationshipUtils.ts`
    - Signature: `findNodeForEntity(nodes: DiagramNode[], entityType: string, entityId: string): DiagramNode | undefined`
    - Search `diagram_nodes` for matching `entity_type` and `entity_id`
  - [x] 2.3 Create `areEndpointsOnDiagram` utility
    - Signature: `areEndpointsOnDiagram(nodes: DiagramNode[], entityType1: string, entityId1: string, entityType2: string, entityId2: string): boolean`
    - Return true only if both entities have corresponding nodes on the diagram
  - [x] 2.4 Create `getContainmentState` utility for App Point-Process
    - Signature: `getContainmentState(nodes: DiagramNode[], appPointId: string, processId: string): 'A_ONLY' | 'NEITHER' | 'BOTH'`
    - Check if Application Point node exists, if Business Process node exists, and if Process is already a child of App Point
  - [x] 2.5 Create `findAppPointNode` utility for Data Movements
    - Signature: `findAppPointNode(nodes: DiagramNode[], applicationPointId: string): DiagramNode | undefined`
    - Find APPLICATION_POINT node matching the given ID
  - [x] 2.6 Ensure endpoint detection tests pass
    - Run ONLY the 6-8 tests written in 2.1
    - Verify all utility functions work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 2.1 pass
- All endpoint detection utilities work correctly
- Utilities handle edge cases (missing nodes, empty arrays)

---

#### Task Group 3: Enable/Disable Logic Per Relationship Type
**Dependencies:** Task Group 2

- [x] 3.0 Complete enable/disable logic for all 6 relationship types
  - [x] 3.1 Write 6-8 focused tests for enable/disable logic
    - Test User-Process: enabled when both on diagram, disabled otherwise
    - Test App Point-Process: 3 cases (A only = enabled, neither = enabled, both = disabled)
    - Test Logical ER: enabled when both entities on diagram
    - Test Logical-Physical Entity: enabled when both on diagram
    - Test Logical-Physical Attribute: enabled when both on diagram
    - Test Data Movements: enabled when both App Points on diagram
  - [x] 3.2 Create `isRelationshipRowEnabled` master function
    - Signature: `isRelationshipRowEnabled(relationship: AnyRelationship, relationshipType: string, diagramNodes: DiagramNode[], metaModel: MetaModel): boolean`
    - Dispatch to type-specific enable/disable logic
  - [x] 3.3 Implement User-Process enable logic
    - Check: BusinessUser node exists AND BusinessProcess node exists
    - Return true only if both present
  - [x] 3.4 Implement App Point-Process enable logic
    - Get containment state from Task 2.4
    - Return true for 'A_ONLY' or 'NEITHER', false for 'BOTH'
  - [x] 3.5 Implement Logical ER enable logic
    - Check: source_entity_id node exists AND target_entity_id node exists
    - Both must be LOGICAL_DATA_ENTITY type
  - [x] 3.6 Implement Logical-Physical Entity enable logic
    - Check: logical_entity_id node exists AND physical_entity_id node exists
  - [x] 3.7 Implement Logical-Physical Attribute enable logic
    - Check: logical_attribute_id node exists AND physical_attribute_id node exists
  - [x] 3.8 Implement Data Movements enable logic
    - Lookup source_application_id -> find corresponding ApplicationPoint
    - Lookup target_application_id -> find corresponding ApplicationPoint
    - Check both Application Point nodes are on diagram
  - [x] 3.9 Ensure enable/disable logic tests pass
    - Run ONLY the 6-8 tests written in 3.1
    - Verify all relationship types have correct enable/disable behaviour
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 3.1 pass
- Each of the 6 relationship types has working enable/disable logic
- App Point-Process has correct 3-case logic

---

### Add Relationship Actions

#### Task Group 4: Edge Creation Utilities
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete edge creation utilities
  - [x] 4.1 Write 4-6 focused tests for edge creation
    - Test edge_points calculation connecting node edges
    - Test DiagramEdge creation with correct fields
    - Test label position calculation (midpoint, near-source, near-target)
    - Test dashed line type setting for User-Process
  - [x] 4.2 Create `calculateEdgePoints` utility
    - Signature: `calculateEdgePoints(sourceNode: DiagramNode, targetNode: DiagramNode): EdgePoint[]`
    - Calculate points on outer edges of nodes (not centres)
    - Return array with source and target EdgePoints (sequence_order 0 and 1)
  - [x] 4.3 Create `createRelationshipEdge` factory function
    - Signature: `createRelationshipEdge(relationship: AnyRelationship, relationshipType: string, sourceNode: DiagramNode, targetNode: DiagramNode, options?: EdgeOptions): DiagramEdge`
    - Generate unique edge ID
    - Set relationship_type, relationship_id, source_node_id, target_node_id
    - Calculate and set edge_points using Task 4.2
    - Apply line_type, arrow_end based on relationship type
  - [x] 4.4 Create `calculateLabelPosition` utilities
    - `calculateMidpointLabelPosition(edgePoints: EdgePoint[]): { x: number; y: number }`
    - `calculateSourceLabelPosition(edgePoints: EdgePoint[], offset: number): { x: number; y: number }`
    - `calculateTargetLabelPosition(edgePoints: EdgePoint[], offset: number): { x: number; y: number }`
  - [x] 4.5 Ensure edge creation tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify edge points connect to node edges correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 4.1 pass
- Edge points connect to outer edges of nodes
- Label positions are calculated correctly

---

#### Task Group 5: Add Relationship Handlers
**Dependencies:** Task Group 4

- [x] 5.0 Complete add relationship handlers for all 6 types
  - [x] 5.1 Write 6-8 focused tests for add handlers
    - Test User-Process creates dashed edge with no arrow
    - Test App Point-Process creates containment (parent_node_id set)
    - Test Logical ER creates edge with multiplicity labels
    - Test Data Movement creates edge with arrow and entity name label
    - Test Logical-Physical creates simple solid line edge
  - [x] 5.2 Create `handleAddUserProcessRelationship`
    - Find BusinessUser and BusinessProcess nodes
    - Create DiagramEdge with line_type = 'DASHED', no arrow_end
    - Add edge to diagram.diagram_edges via reducer
  - [x] 5.3 Create `handleAddAppPointProcessRelationship`
    - Handle 'A_ONLY' case: create Process node inside existing App Point (set parent_node_id)
    - Handle 'NEITHER' case: create both App Point and Process nodes with containment
    - Use existing `calculateChildPositionWithHeights`, `calculateParentSizeWithHeights` from `compoundLayout.ts`
    - No edge created - containment is visual representation
  - [x] 5.4 Create `handleAddLogicalERRelationship`
    - Find source and target LOGICAL_DATA_ENTITY nodes
    - Create DiagramEdge with solid line
    - Get multiplicity labels from relationship_type (ONE_TO_ONE, etc.)
    - Set source_label_text, target_label_text
    - Calculate and set source_label_pos_x/y, target_label_pos_y/y near respective nodes
  - [x] 5.5 Create `handleAddLogicalPhysicalEntityRelationship`
    - Find LOGICAL_DATA_ENTITY and PHYSICAL_DATA_ENTITY nodes
    - Create simple solid line DiagramEdge, no labels or arrows
  - [x] 5.6 Create `handleAddLogicalPhysicalAttributeRelationship`
    - Find logical attribute and physical attribute nodes
    - Create simple solid line DiagramEdge, no labels or arrows
  - [x] 5.7 Create `handleAddDataMovementRelationship`
    - Find source and target APPLICATION_POINT nodes
    - Create DiagramEdge with arrow_end = 'ARROW', line_type = 'SOLID'
    - Lookup logical_data_entities[data_movement.data_entity_id].name for label_text
    - Set label_pos_x/y at midpoint of edge
  - [x] 5.8 Ensure add handler tests pass
    - Run ONLY the 6-8 tests written in 5.1
    - Verify each relationship type creates correct diagram structures
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 5.1 pass
- Each relationship type creates correct visual representation
- Containment uses parent_node_id, lines use diagram_edges

---

### Palette UI Integration

#### Task Group 6: PaletteItem Enable/Disable UI
**Dependencies:** Task Groups 3, 5

- [x] 6.0 Complete PaletteItem enable/disable UI for relationships
  - [x] 6.1 Write 4-6 focused tests for PaletteItem relationship handling
    - Test relationship rows show enabled state when endpoints present
    - Test relationship rows show disabled (greyed) state when endpoints missing
    - Test disabled rows block left-click
    - Test enabled rows trigger add action on left-click
  - [x] 6.2 Extend PaletteItem props for relationship enable state
    - Add `isRelationshipEnabled?: boolean` prop
    - Import `isRelationshipRowEnabled` from `relationshipUtils.ts`
  - [x] 6.3 Update PaletteItem click handling for relationships
    - For `itemType === 'relationship'`:
      - If enabled, call onClick (trigger add)
      - If disabled, no-op (block click)
    - Keep entity click handling unchanged
  - [x] 6.4 Update PaletteItem styling for disabled relationships
    - Apply greyed-out text colour for disabled rows
    - Update CSS class `.itemDisabled` or create `.itemRelationshipDisabled`
    - Set cursor to 'default' instead of 'pointer' for disabled
    - Update title tooltip to indicate why disabled
  - [x] 6.5 Update PaletteSection/PalettePanel to compute enable state
    - For each relationship item, call `isRelationshipRowEnabled`
    - Pass result to PaletteItem as `isRelationshipEnabled`
  - [x] 6.6 Ensure PaletteItem tests pass
    - Run ONLY the 4-6 tests written in 6.1
    - Verify visual feedback and click blocking work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 6.1 pass
- Disabled relationship rows are visually greyed out
- Disabled rows block left-click interactions
- Enabled rows trigger add action

---

#### Task Group 7: PaletteContextMenu Enable/Disable UI
**Dependencies:** Task Groups 3, 5, 6

- [x] 7.0 Complete PaletteContextMenu for relationships
  - [x] 7.1 Write 4-6 focused tests for context menu relationship handling
    - Test right-click on enabled row shows menu with enabled "Add" item
    - Test right-click on disabled row shows menu with disabled "Add" item
    - Test clicking disabled "Add" is no-op
    - Test clicking enabled "Add" triggers add action
  - [x] 7.2 Extend PaletteContextMenu to support relationship items
    - Add `itemType: 'entity' | 'relationship'` prop
    - Add `isEnabled: boolean` prop for relationship enable state
    - Add `onAddRelationship?: ContextMenuAction` prop
  - [x] 7.3 Update context menu rendering for relationship items
    - Show "Add" item for relationships (not "Add with business processes" etc.)
    - Apply disabled styling to "Add" when `isEnabled === false`
    - Add CSS class `.menuItemDisabled` with greyed colour and `cursor: default`
  - [x] 7.4 Update context menu click handling
    - If relationship and enabled, call `onAddRelationship`
    - If relationship and disabled, close menu (no action)
  - [x] 7.5 Wire up context menu in PalettePanel
    - Pass relationship item type and enable state to context menu
    - Connect `onAddRelationship` to appropriate handler from Task Group 5
  - [x] 7.6 Ensure context menu tests pass
    - Run ONLY the 4-6 tests written in 7.1
    - Verify "Add" item disabled state and click behaviour
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 7.1 pass
- Right-click shows context menu for relationships
- "Add" item is disabled when relationship cannot be added
- Enabled "Add" triggers same action as left-click

---

### Relationship Visualisation Rendering

#### Task Group 8: Edge Rendering Updates
**Dependencies:** Task Groups 1, 4

- [x] 8.0 Complete edge rendering for all relationship types
  - [x] 8.1 Write 4-6 focused tests for edge rendering
    - Test User-Process renders as dashed line
    - Test Data Movement renders with arrow at target
    - Test Logical ER renders with source and target multiplicity labels
    - Test label text colour and font styling apply correctly
  - [x] 8.2 Update Canvas.tsx edge rendering for dashed User-Process lines
    - Check relationship_type === 'BUSINESS_USER_PROCESS'
    - Apply dashed stroke pattern from `getEdgeStrokeStyle`
    - Use `edgeRendering.defaultDashedPattern` from config
  - [x] 8.3 Update Canvas.tsx for Data Movement arrow rendering
    - Check relationship_type === 'DATA_MOVEMENT'
    - Render arrow head at target end using existing `calculateArrowhead`
    - Render label text at label_pos_x/y using `getEdgeDisplayLabel`
  - [x] 8.4 Implement multiplicity label rendering for Logical ER
    - Check relationship_type === 'LOGICAL_DATA_ENTITY_RELATIONSHIP'
    - Render source_label_text near source node at source_label_pos_x/y
    - Render target_label_text near target node at target_label_pos_x/y
    - Apply font styling from edge fields (label_font_size, etc.)
  - [x] 8.5 Ensure solid line rendering for Logical-Physical relationships
    - Check relationship_type === 'LOGICAL_DATA_ENTITY_PHYSICAL_DATA_ENTITY' or `LOGICAL_DATA_ATTRIBUTE_PHYSICAL_DATA_ATTRIBUTE`
    - Render simple solid line using existing edge rendering
  - [x] 8.6 Ensure edge rendering tests pass
    - Run ONLY the 4-6 tests written in 8.1
    - Verify all relationship types render correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 8.1 pass
- User-Process renders as dashed line
- Data Movement renders with arrow and label
- Logical ER renders with two multiplicity labels

---

### Label Interaction System

#### Task Group 9: Label Selection and Dragging
**Dependencies:** Task Group 8

- [x] 9.0 Complete label selection and dragging system
  - [x] 9.1 Write 4-6 focused tests for label interactions
    - Test clicking on multiplicity label selects it
    - Test clicking on data movement label selects it
    - Test dragging selected label updates position
    - Test label position persists after drag
  - [x] 9.2 Extend hit-testing for multiplicity labels
    - Update `isPointOnLabel` or create similar for source/target labels
    - Check click coordinates against source_label_pos_x/y and target_label_pos_x/y
    - Use `measureTextWidth` for label bounding box calculation
  - [x] 9.3 Implement label selection state
    - Add selection state for edge labels: `selectedLabelType: 'main' | 'source' | 'target' | null`
    - Update Canvas selection handling to track which label is selected
    - Apply visual highlight (outline, colour change) to selected label
  - [x] 9.4 Implement label drag handling
    - On mousedown on selected label, enter drag mode
    - Track drag delta during mousemove
    - Update appropriate label_pos_x/y fields (main, source, or target)
    - On mouseup, commit position update to reducer
  - [x] 9.5 Ensure label positions persist in JSON
    - Verify label_pos_x/y, source_label_pos_x/y, target_label_pos_x/y saved to diagram
    - Test save/load cycle preserves label positions
  - [x] 9.6 Ensure label interaction tests pass
    - Run ONLY the 4-6 tests written in 9.1
    - Verify selection, dragging, and persistence work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 9.1 pass
- Labels are individually selectable
- Labels can be dragged to new positions
- Label positions persist in JSON

---

### Testing

#### Task Group 10: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-9

- [x] 10.0 Review existing tests and fill critical gaps only
  - [x] 10.1 Review tests from Task Groups 1-9
    - Review the 4-6 tests written by Task Group 1 (types)
    - Review the 6-8 tests written by Task Group 2 (endpoint detection)
    - Review the 6-8 tests written by Task Group 3 (enable/disable logic)
    - Review the 4-6 tests written by Task Group 4 (edge creation)
    - Review the 6-8 tests written by Task Group 5 (add handlers)
    - Review the 4-6 tests written by Task Group 6 (PaletteItem UI)
    - Review the 4-6 tests written by Task Group 7 (context menu)
    - Review the 4-6 tests written by Task Group 8 (edge rendering)
    - Review the 4-6 tests written by Task Group 9 (label interactions)
    - Total existing tests: approximately 46-62 tests
  - [x] 10.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to relationship visualisation requirements
    - Prioritise end-to-end workflows over unit test gaps
    - Check for missing tests: left-click vs right-click parity, round-trip JSON persistence
  - [x] 10.3 Write up to 10 additional strategic tests maximum
    - Add test: left-click and right-click "Add" result in identical diagram changes
    - Add test: App Point-Process containment auto-sizes parent correctly
    - Add test: Edge created between correct nodes (not centres, but edges)
    - Add test: Multiple relationships can be added to same diagram
    - Add test: Editing/moving a node updates connected edge points
    - Focus on integration points and end-to-end workflows
    - Do NOT write comprehensive coverage for all scenarios
  - [x] 10.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from Groups 1-9 and 10.3)
    - Expected total: approximately 56-72 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 56-72 tests total)
- Critical user workflows for relationship visualisation are covered
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Foundation Layer** (Task Group 1)
   - Type definitions and data structures must be in place first

2. **Enable/Disable Logic Layer** (Task Groups 2-3)
   - Endpoint detection utilities (Task Group 2)
   - Enable/disable logic per relationship type (Task Group 3)

3. **Add Relationship Actions** (Task Groups 4-5)
   - Edge creation utilities (Task Group 4)
   - Add relationship handlers for all 6 types (Task Group 5)

4. **Palette UI Integration** (Task Groups 6-7)
   - PaletteItem enable/disable UI (Task Group 6)
   - PaletteContextMenu enable/disable UI (Task Group 7)

5. **Relationship Visualisation Rendering** (Task Group 8)
   - Edge rendering updates for all relationship types

6. **Label Interaction System** (Task Group 9)
   - Label selection, dragging, and persistence

7. **Testing** (Task Group 10)
   - Test review and gap analysis

---

## File References

### Files to Modify
- `frontend/src/types/model.ts` - DiagramEdge interface extension
- `frontend/src/utils/rendering.ts` - Multiplicity mapping, label utilities
- `frontend/src/components/DiagramsView/PaletteItem.tsx` - Enable/disable UI
- `frontend/src/components/DiagramsView/PaletteContextMenu.tsx` - Relationship menu items
- `frontend/src/components/DiagramsView/PalettePanel.tsx` - Wire up handlers
- `frontend/src/components/DiagramsView/Canvas.tsx` - Edge and label rendering

### Files to Create
- `frontend/src/utils/relationshipUtils.ts` - All enable/disable and add relationship utilities

### Existing Files to Leverage
- `frontend/src/utils/compoundLayout.ts` - Containment sizing utilities
- `frontend/src/config/defaults.ts` - Edge rendering defaults
- `frontend/src/contexts/ArchitectureContext.tsx` - Reducer actions for diagram updates

---

## Key Dependencies and Patterns

### Existing Patterns to Follow
1. **Entity add via PaletteItem**: Left-click and context menu patterns in `PalettePanel.tsx`
2. **Compound layout**: `calculateParentSizeWithHeights`, `calculateChildPositionWithHeights` for containment
3. **Edge rendering**: `getEdgeStrokeStyle`, `calculateArrowhead` in `rendering.ts`
4. **Label hit-testing**: `isPointOnLabel`, `measureTextWidth` in `rendering.ts`
5. **Data Movement label**: `getEdgeDisplayLabel` for entity name lookup

### Meta-Model Relationship References
- `business_user_processes`: business_user_id, business_process_id
- `application_point_business_processes`: application_point_id, business_process_id
- `logical_data_entity_relationships`: source_entity_id, target_entity_id, relationship_type
- `logical_data_entity_physical_data_entities`: logical_entity_id, physical_entity_id
- `logical_data_attribute_physical_data_attributes`: logical_attribute_id, physical_attribute_id
- `data_movements`: source_application_id, target_application_id, data_entity_id

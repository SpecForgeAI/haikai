# Task Breakdown: Relationship Eligibility Per-Diagram Fix

## Overview
Total Tasks: 34

This bug fix addresses incorrect enable/disable logic for relationship rows in the Palette panel. The core issues are:
1. Data Movement rows show disabled even when both endpoints are on the diagram
2. Eligibility state persists incorrectly when switching diagrams
3. The RHS panel uses stale or global state instead of the ACTIVE diagram's nodes

## Task List

### Core Utility Layer

#### Task Group 1: Create getEntitiesOnDiagram Helper Function
**Dependencies:** None
**File:** `frontend/src/utils/relationshipUtils.ts`

- [x] 1.0 Complete getEntitiesOnDiagram helper implementation
  - [x] 1.1 Write 4-6 focused tests for getEntitiesOnDiagram helper
    - Test empty diagram returns empty Sets for all entity types
    - Test diagram with single Business User node populates businessUsersOnDiagram Set correctly
    - Test diagram with Application/Component/Service nodes correctly maps to applicationPointsOnDiagram via application_point.id lookup
    - Test diagram with mixed entity types populates multiple Sets correctly
    - Test diagram with Logical/Physical Data Entities and Attributes populates respective Sets
    - Test that duplicate entity_ids are deduplicated in Sets
  - [x] 1.2 Define EntitiesOnDiagram interface/type
    - applicationPointsOnDiagram: Set<string>
    - businessUsersOnDiagram: Set<string>
    - businessProcessesOnDiagram: Set<string>
    - logicalDataEntitiesOnDiagram: Set<string>
    - physicalDataEntitiesOnDiagram: Set<string>
    - logicalDataAttributesOnDiagram: Set<string>
    - physicalDataAttributesOnDiagram: Set<string>
  - [x] 1.3 Implement getEntitiesOnDiagram pure function
    - Accept metaModel and activeDiagram as parameters
    - Iterate over activeDiagram.diagram_nodes[]
    - For each node, use entity_type and entity_id to populate appropriate Set
    - Handle APPLICATION_POINT entity_type directly (add entity_id to applicationPointsOnDiagram)
    - Handle BUSINESS_USER entity_type (add entity_id to businessUsersOnDiagram)
    - Handle BUSINESS_PROCESS entity_type (add entity_id to businessProcessesOnDiagram)
    - Handle LOGICAL_DATA_ENTITY entity_type (add entity_id to logicalDataEntitiesOnDiagram)
    - Handle PHYSICAL_DATA_ENTITY entity_type (add entity_id to physicalDataEntitiesOnDiagram)
    - Handle LOGICAL_DATA_ATTRIBUTE entity_type (add entity_id to logicalDataAttributesOnDiagram)
    - Handle PHYSICAL_DATA_ATTRIBUTE entity_type (add entity_id to physicalDataAttributesOnDiagram)
  - [x] 1.4 Implement Application Point abstraction mapping
    - For APPLICATION entity_type: lookup metaModel.entities.application_points where application_id matches entity_id, add those application_point.id values to applicationPointsOnDiagram
    - For APP_COMPONENT entity_type: lookup metaModel.entities.application_points where app_component_id matches entity_id, add those application_point.id values
    - For SERVICE entity_type: lookup metaModel.entities.application_points where service_id matches entity_id, add those application_point.id values
  - [x] 1.5 Export getEntitiesOnDiagram and EntitiesOnDiagram type from relationshipUtils.ts
  - [x] 1.6 Ensure helper tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all edge cases for entity type mapping

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- getEntitiesOnDiagram returns correct Sets for all entity types
- Application Point abstraction correctly maps Application/Component/Service nodes to application_point IDs
- Function is pure and has no side effects

---

### Eligibility Logic Layer

#### Task Group 2: Fix Per-Relationship Eligibility Functions
**Dependencies:** Task Group 1
**File:** `frontend/src/utils/relationshipUtils.ts`

- [x] 2.0 Complete per-relationship eligibility refactoring
  - [x] 2.1 Write 6-8 focused tests for eligibility functions using Set-based lookups
    - Test isUserProcessEnabledWithSets: enabled when both user_id AND process_id in respective Sets
    - Test isUserProcessEnabledWithSets: disabled when user_id missing from Set
    - Test isAppPointProcessEnabledWithSets: enabled when either endpoint NOT on diagram
    - Test isAppPointProcessEnabledWithSets: disabled when BOTH already on diagram with containment
    - Test isLogicalEREnabledWithSets: enabled when both source AND target entity IDs in logicalDataEntitiesOnDiagram
    - Test isDataMovementEnabledWithSets: enabled when both source AND target app point IDs in applicationPointsOnDiagram
    - Test isDataMovementEnabledWithSets: disabled when one app point missing from Set
    - Test isLogicalPhysicalEntityEnabledWithSets: enabled when both IDs in respective Sets
  - [x] 2.2 Refactor isUserProcessEnabled to use EntitiesOnDiagram
    - Change signature to accept EntitiesOnDiagram instead of raw nodes array
    - Check relationship.business_user_id in entitiesOnDiagram.businessUsersOnDiagram
    - Check relationship.business_process_id in entitiesOnDiagram.businessProcessesOnDiagram
    - Return true only if BOTH are present
  - [x] 2.3 Refactor isAppPointProcessEnabled to use EntitiesOnDiagram
    - Check if application_point_id is in applicationPointsOnDiagram
    - Check if business_process_id is in businessProcessesOnDiagram
    - Return true if EITHER is NOT on diagram (can still add containment)
    - Return false if BOTH are already on diagram (containment exists)
    - Note: Keep existing getContainmentState for detailed state checking during add operation
  - [x] 2.4 Refactor isLogicalEREnabled to use EntitiesOnDiagram
    - Check relationship.source_entity_id in entitiesOnDiagram.logicalDataEntitiesOnDiagram
    - Check relationship.target_entity_id in entitiesOnDiagram.logicalDataEntitiesOnDiagram
    - Return true only if BOTH are present
  - [x] 2.5 Refactor isLogicalPhysicalEntityEnabled to use EntitiesOnDiagram
    - Check relationship.logical_entity_id in entitiesOnDiagram.logicalDataEntitiesOnDiagram
    - Check relationship.physical_entity_id in entitiesOnDiagram.physicalDataEntitiesOnDiagram
    - Return true only if BOTH are present
  - [x] 2.6 Refactor isLogicalPhysicalAttributeEnabled to use EntitiesOnDiagram
    - Check relationship.logical_attribute_id in entitiesOnDiagram.logicalDataAttributesOnDiagram
    - Check relationship.physical_attribute_id in entitiesOnDiagram.physicalDataAttributesOnDiagram
    - Return true only if BOTH are present
  - [x] 2.7 Refactor isDataMovementEnabled to use EntitiesOnDiagram
    - Check relationship.source_application_point_id in entitiesOnDiagram.applicationPointsOnDiagram
    - Check relationship.target_application_point_id in entitiesOnDiagram.applicationPointsOnDiagram
    - Return true only if BOTH are present
    - CRITICAL: Data Movement relationships use source_application_point_id and target_application_point_id directly (not application IDs)
  - [x] 2.8 Update isRelationshipRowEnabled master function
    - Add optional EntitiesOnDiagram parameter
    - If EntitiesOnDiagram provided, use it; otherwise compute from diagramNodes for backward compatibility
    - Pass EntitiesOnDiagram to each per-type enable function
  - [x] 2.9 Ensure eligibility function tests pass
    - Run ONLY the 6-8 tests written in 2.1
    - Verify all relationship types correctly use Set-based lookups

**Acceptance Criteria:**
- The 6-8 tests written in 2.1 pass
- All eligibility functions use Set-based lookups from EntitiesOnDiagram
- isRelationshipRowEnabled maintains backward compatibility
- Data Movement eligibility correctly checks application_point IDs (not application IDs)

---

### Palette Integration Layer

#### Task Group 3: Wire Helper into Palette Components
**Dependencies:** Task Group 2
**Files:** `frontend/src/components/DiagramsView/PaletteSection.tsx`, `frontend/src/components/DiagramsView/PalettePanel.tsx`

- [x] 3.0 Complete Palette component integration
  - [x] 3.1 Write 4-6 focused tests for Palette eligibility computation
    - Test PaletteSection re-renders when diagram prop changes
    - Test PaletteSection uses active diagram's nodes for eligibility (not stale state)
    - Test eligibility recomputes when diagram_nodes array changes (add/remove)
    - Test eligibility uses fresh EntitiesOnDiagram on each render cycle
    - Test empty diagram results in all relationship rows disabled
    - Test switching from diagram with nodes to empty diagram disables rows immediately
  - [x] 3.2 Update PaletteSection to compute EntitiesOnDiagram
    - Import getEntitiesOnDiagram from relationshipUtils
    - In getRelationshipEnabled, call getEntitiesOnDiagram(metaModel, diagram) before checking eligibility
    - Pass computed EntitiesOnDiagram to isRelationshipRowEnabled
    - Ensure computation happens on every render (React will handle memoization if needed)
  - [x] 3.3 Ensure PalettePanel passes correct diagram prop
    - Verify diagram prop is derived from state.model.diagrams.find(d => d.id === currentDiagramId) in parent DiagramsView
    - Confirm diagram prop updates when currentDiagramId changes (SELECT_DIAGRAM action)
    - Confirm diagram prop updates when diagram_nodes changes (ADD_DIAGRAM_NODE, DELETE_DIAGRAM_ELEMENTS actions)
  - [x] 3.4 Update PalettePanel getContextMenuRelationshipEnabled
    - Use getEntitiesOnDiagram helper for context menu eligibility check
    - Ensure context menu uses same eligibility logic as main palette rows
  - [x] 3.5 Verify React dependency tracking for recomputation triggers
    - PaletteSection receives diagram prop that changes when:
      - User selects different diagram (SELECT_DIAGRAM)
      - User clicks +New or +Copy (ADD_DIAGRAM followed by SELECT_DIAGRAM)
      - Nodes added (ADD_DIAGRAM_NODE, ADD_DIAGRAM_NODES)
      - Nodes removed (DELETE_DIAGRAM_ELEMENTS)
    - Confirm props change triggers re-render and fresh eligibility computation
  - [x] 3.6 Ensure Palette integration tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify diagram switching correctly updates eligibility

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Eligibility recomputes when active diagram changes
- Eligibility recomputes when diagram_nodes changes
- Context menu uses same eligibility logic as main palette

---

### Tooltip Enhancement Layer

#### Task Group 4: Implement Distinct Tooltip Messages
**Dependencies:** Task Group 3
**File:** `frontend/src/components/DiagramsView/PaletteItem.tsx`

- [x] 4.0 Complete tooltip message enhancements
  - [x] 4.1 Write 2-4 focused tests for tooltip messages
    - Test disabled relationship row shows "Both endpoints must be on diagram to add this relationship." tooltip
    - Test App Point Process row when both on diagram shows "Already visualised on this diagram." tooltip
    - Test enabled relationship row shows "Click to add relationship to diagram" tooltip
  - [x] 4.2 Update PaletteItem tooltip logic for relationship items
    - Keep existing default disabled message: "Both endpoints must be on diagram to add this relationship"
    - Add new prop disabledReason to distinguish reason for disabled state
  - [x] 4.3 Add disabledReason prop to PaletteItem
    - Type: 'endpoints_missing' | 'already_visualised' | null
    - Default to null when enabled
    - Set to 'endpoints_missing' when standard disabled (endpoints not on diagram)
    - Set to 'already_visualised' when App Point Process both already on diagram
  - [x] 4.4 Update PaletteSection to compute disabledReason
    - For App Point Process relationships: check getContainmentState
    - If state is 'BOTH', set disabledReason to 'already_visualised'
    - For all other disabled states, set disabledReason to 'endpoints_missing'
  - [x] 4.5 Update PaletteItem to display appropriate tooltip
    - If disabledReason === 'already_visualised': "Already visualised on this diagram."
    - If disabledReason === 'endpoints_missing': "Both endpoints must be on diagram to add this relationship."
    - If enabled: "Click to add relationship to diagram"
  - [x] 4.6 Ensure tooltip tests pass
    - Run ONLY the 2-4 tests written in 4.1

**Acceptance Criteria:**
- The 2-4 tests written in 4.1 pass
- Disabled rows show contextually appropriate tooltip messages
- App Point Process shows distinct message when already visualised

---

### Regression Prevention Layer

#### Task Group 5: Data Movement Arrow Regression Test
**Dependencies:** Task Group 2
**File:** `frontend/src/utils/relationshipUtils.ts` (verification only)

- [x] 5.0 Verify Data Movement arrow rendering is preserved
  - [x] 5.1 Write 2 focused regression tests for Data Movement edge creation
    - Test createRelationshipEdge for DATA_MOVEMENT sets line_type to 'SOLID'
    - Test createRelationshipEdge for DATA_MOVEMENT sets arrow_end to 'ARROW'
  - [x] 5.2 Verify existing createRelationshipEdge implementation
    - Confirm DATA_MOVEMENT case in switch statement sets edge.line_type = 'SOLID'
    - Confirm DATA_MOVEMENT case sets edge.arrow_end = 'ARROW'
    - Confirm label_text is set from options.labelText (entity name)
    - Do NOT modify this code - verification only
  - [x] 5.3 Document Data Movement edge styling contract
    - Add JSDoc comment to createRelationshipEdge for DATA_MOVEMENT case
    - Specify: solid line, arrow at target end, label from logical data entity name
  - [x] 5.4 Ensure regression tests pass
    - Run ONLY the 2 tests written in 5.1
    - Verify arrow rendering behavior is preserved

**Acceptance Criteria:**
- The 2 tests written in 5.1 pass
- Data Movement edges have line_type: 'SOLID'
- Data Movement edges have arrow_end: 'ARROW'
- No changes made to existing edge creation logic

---

### Testing Layer

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 4-6 tests from Task Group 1 (getEntitiesOnDiagram helper)
    - Review the 6-8 tests from Task Group 2 (eligibility functions)
    - Review the 4-6 tests from Task Group 3 (Palette integration)
    - Review the 2-4 tests from Task Group 4 (tooltips)
    - Review the 2 tests from Task Group 5 (regression)
    - Total existing tests: approximately 18-26 tests
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows lacking coverage:
      - Diagram switching workflow (select different diagram from dropdown)
      - New diagram creation workflow (+New button)
      - Copy diagram workflow (+Copy button)
      - Node deletion triggering eligibility update
    - Focus ONLY on gaps related to relationship eligibility per-diagram
    - Prioritize integration tests over additional unit tests
  - [x] 6.3 Write up to 8 additional integration tests maximum
    - Test: Start with empty diagram, all relationship rows disabled
    - Test: Add both endpoints for a Data Movement, row becomes enabled
    - Test: Switch to new empty Diagram 2, same Data Movement row is disabled
    - Test: Add nodes to Diagram 2, row becomes enabled for Diagram 2
    - Test: Switch back to Diagram 1, eligibility reflects Diagram 1's nodes
    - Test: Add App Point Process where both end up on diagram, row becomes disabled
    - Test: Delete one endpoint node, relationship row becomes disabled
    - Test: Meta-model relationship deletion removes row from palette
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 26-34 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 26-34 tests total)
- Critical diagram switching workflows are covered
- Node add/remove triggering eligibility update is covered
- No more than 8 additional tests added when filling gaps
- Testing focused exclusively on relationship eligibility per-diagram feature

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Core Helper** (Day 1)
   - Create getEntitiesOnDiagram helper with Set-based lookups
   - This is the foundation for all other work

2. **Task Group 2: Eligibility Functions** (Day 1-2)
   - Refactor all per-relationship eligibility functions to use Sets
   - Depends on Task Group 1 being complete

3. **Task Group 3: Palette Integration** (Day 2)
   - Wire helper into PaletteSection and PalettePanel
   - Ensure proper React dependency tracking
   - Depends on Task Group 2 being complete

4. **Task Group 4: Tooltips** (Day 2-3)
   - Add distinct tooltip messages for different disabled states
   - Can run in parallel with late Task Group 3 work

5. **Task Group 5: Regression Test** (Day 3)
   - Verify Data Movement arrow rendering is preserved
   - Can run in parallel with Task Group 4

6. **Task Group 6: Test Gap Analysis** (Day 3)
   - Review all tests, identify gaps, add integration tests
   - Must run after all implementation complete

---

## Key Files to Modify

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/utils/relationshipUtils.ts` | 1, 2, 5 | Add getEntitiesOnDiagram, refactor eligibility functions |
| `frontend/src/components/DiagramsView/PaletteSection.tsx` | 3, 4 | Use helper for eligibility, pass disabledReason |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | 3 | Verify diagram prop derivation, update context menu |
| `frontend/src/components/DiagramsView/PaletteItem.tsx` | 4 | Add disabledReason prop, conditional tooltips |

---

## Risk Mitigation

1. **Backward Compatibility**: Task 2.8 ensures isRelationshipRowEnabled maintains backward compatibility by optionally accepting EntitiesOnDiagram.

2. **Data Movement Regression**: Task Group 5 explicitly verifies arrow rendering is preserved before and after changes.

3. **React Re-render Issues**: Task 3.5 explicitly verifies React dependency tracking ensures eligibility recomputes on diagram changes.

4. **Application Point Abstraction**: Task 1.4 explicitly handles the mapping from Application/Component/Service nodes to application_point IDs.

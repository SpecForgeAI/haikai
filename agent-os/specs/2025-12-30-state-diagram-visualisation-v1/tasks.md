# Task Breakdown: State Diagram Visualisation v1

## Overview
Total Tasks: 24
Estimated Task Groups: 5

This spec brings State diagrams to visual parity with Activity diagrams by:
1. Registering STATE_TRANSITION in the entity type registry (validation fix)
2. Rendering typed state shapes (Initial/Normal/Final)
3. Creating State Transition edges via RHS palette UX
4. Implementing StateDiagramRenderer component
5. Enabling State Transition inspector editing

## Task List

### Configuration & Registry Layer

#### Task Group 1: Entity Type Registry and Defaults Configuration
**Dependencies:** None

This group establishes the foundational configuration needed before any rendering work can begin.

- [x] 1.0 Complete configuration and registry layer
  - [x] 1.1 Write 4 focused tests for configuration changes
    - Test STATE_TRANSITION exists in DIAGRAM_NODE_ENTITY_TYPE_MAP
    - Test STATE_NODE_DEFAULTS contains Initial, Normal, Final configurations
    - Test StateNodeShape type is defined correctly
    - Test entityColors.STATE is used in Normal state defaults
  - [x] 1.2 Add STATE_TRANSITION to DIAGRAM_NODE_ENTITY_TYPE_MAP in entityTypeRegistry.ts
    - Add entry: `STATE_TRANSITION: 'state_transitions'`
    - Place in Behavioural Domain section with existing STATE entry
    - Follow existing comment documentation pattern
  - [x] 1.3 Create StateNodeShape type in defaults.ts
    - Define type following ActivityNodeShape pattern: `'circle' | 'roundedRectangle' | 'bullseye'`
    - Place near ActivityNodeShape type definition
  - [x] 1.4 Create StateNodeDefaultConfig interface in defaults.ts
    - Follow ActivityNodeDefaultConfig interface structure
    - Include: shape, fill, stroke, stroke_width, showLabel, diameter, width, height, cornerRadius, innerDiameter
  - [x] 1.5 Create STATE_NODE_DEFAULTS constant in defaults.ts
    - Initial: circle shape, fill #000000, stroke #000000, diameter 18px, showLabel false
    - Normal: roundedRectangle shape, fill entityColors.STATE.background, stroke entityColors.STATE.border, width 140px, height 50px, cornerRadius 8px, showLabel true
    - Final: bullseye shape, fill #000000, stroke #000000, diameter 22px, innerDiameter 14px, showLabel false
  - [x] 1.6 Ensure configuration layer tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Verify no import errors

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- STATE_TRANSITION is recognized by validation.ts (eliminates "unknown entity type" errors)
- STATE_NODE_DEFAULTS follows same structure as ACTIVITY_NODE_DEFAULTS
- Normal state uses entityColors.STATE (light green background, green border)
- Initial and Final use neutral black matching Activity control nodes

**Files to Modify:**
- `frontend/src/utils/entityTypeRegistry.ts`
- `frontend/src/config/defaults.ts`

---

### State Node Rendering Layer

#### Task Group 2: State Node Shape Rendering Functions
**Dependencies:** Task Group 1

This group implements the rendering functions for state node shapes, following activityNodeRendering.ts patterns.

- [x] 2.0 Complete state node rendering functions
  - [x] 2.1 Write 5 focused tests for state node rendering
    - Test renderInitialStateNode returns correct circle path data
    - Test renderNormalStateNode returns correct rounded rectangle path data
    - Test renderFinalStateNode returns bullseye with outer and inner path data
    - Test renderStateNode dispatches correctly based on state_kind
    - Test states without state_kind default to Normal rendering
  - [x] 2.2 Create stateNodeRendering.ts utility file
    - Create new file at `frontend/src/utils/stateNodeRendering.ts`
    - Import STATE_NODE_DEFAULTS from defaults.ts
    - Import State, StateKind types from model.ts
    - Follow activityNodeRendering.ts file structure
  - [x] 2.3 Define StateNodeRenderResult interface
    - Extend ShapeRenderResult from shapeRendering.ts
    - Add showLabel, width, height, outerPathData, innerPathData fields
    - Follow ActivityNodeRenderResult pattern exactly
  - [x] 2.4 Implement renderInitialStateNode function
    - Accept position parameter: { x: number; y: number }
    - Return circle path using arc commands (M, A, A, Z pattern)
    - Use STATE_NODE_DEFAULTS.Initial for styling
    - Set showLabel: false
  - [x] 2.5 Implement renderNormalStateNode function
    - Accept position and optional customWidth/customHeight parameters
    - Return rounded rectangle path with corner arcs
    - Use STATE_NODE_DEFAULTS.Normal for styling
    - Set showLabel: true, include width/height in result
  - [x] 2.6 Implement renderFinalStateNode function
    - Accept position parameter
    - Return bullseye paths (outerPathData stroke-only, innerPathData filled)
    - Use STATE_NODE_DEFAULTS.Final for styling
    - Set showLabel: false
  - [x] 2.7 Implement renderStateNode dispatcher function
    - Accept State entity and position as parameters
    - Read state.state_kind, default to 'Normal' if undefined
    - Route to appropriate render function based on state_kind
    - Handle unknown state_kind by defaulting to Normal
  - [x] 2.8 Ensure state node rendering tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify all shape paths are valid SVG path data

**Acceptance Criteria:**
- The 5 tests written in 2.1 pass
- Initial renders as solid black circle (18px diameter)
- Normal renders as rounded rectangle with green theme
- Final renders as bullseye (outer stroke + inner fill)
- States without state_kind default to Normal for backward compatibility

**Files to Create:**
- `frontend/src/utils/stateNodeRendering.ts`

---

### State Transition Rendering Layer

#### Task Group 3: State Transition Edge Rendering and Label Resolution
**Dependencies:** Task Group 2

This group implements state transition edge rendering including label resolution from trigger/guard/effect references.

- [x] 3.0 Complete state transition rendering
  - [x] 3.1 Write 6 focused tests for state transition rendering
    - Test renderStateTransition returns valid line path and arrowhead
    - Test label resolution priority 1: triggerRefKind/triggerRefId resolves to Method/Event name
    - Test label resolution priority 2: triggerLabelText used when no ref
    - Test label resolution priority 3: guardExpression wrapped in brackets
    - Test label resolution priority 4: effectRefKind/effectRefId resolves to Method name
    - Test combined label format when multiple fields present
  - [x] 3.2 Create stateTransitionRendering.ts utility file
    - Create new file at `frontend/src/utils/stateTransitionRendering.ts`
    - Import calculateArrowhead from rendering.ts
    - Import StateTransition, MetaModel types
    - Follow activityNodeRendering.ts flow rendering pattern
  - [x] 3.3 Define StateTransitionRenderResult interface
    - Include: linePath, arrowheadPath, strokeColor, strokeWidth, arrowheadFill
    - Include: labelPosition, labelText, labelFontSize, labelOffset
    - Follow ActivityFlowRenderResult pattern
  - [x] 3.4 Implement resolveTransitionLabel function
    - Accept StateTransition and MetaModel parameters
    - Priority 1: If triggerRefKind and triggerRefId, lookup Method or Event name
    - Priority 2: Return triggerLabelText if present
    - Priority 3: If guardExpression present, return `[${guardExpression}]`
    - Priority 4: If effectRefKind and effectRefId, lookup Method name
    - Combine multiple parts with "/" separator if applicable
    - Return undefined if no label content
  - [x] 3.5 Implement renderStateTransition function
    - Accept sourcePosition, targetPosition, label parameters
    - Calculate line path from source to target (straight line initially)
    - Calculate arrowhead using calculateArrowhead utility
    - Calculate label position at midpoint
    - Return StateTransitionRenderResult with all rendering data
  - [x] 3.6 Ensure state transition rendering tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify label resolution follows priority order

**Acceptance Criteria:**
- The 6 tests written in 3.1 pass
- Transitions render as solid lines with arrowheads pointing to target
- Labels resolve following documented priority order
- Guard expressions display wrapped in square brackets

**Files to Create:**
- `frontend/src/utils/stateTransitionRendering.ts`

---

### StateDiagramRenderer Component Layer

#### Task Group 4: StateDiagramRenderer Component and Canvas Integration
**Dependencies:** Task Groups 2, 3

This group creates the StateDiagramRenderer component and integrates it into Canvas.tsx.

- [x] 4.0 Complete StateDiagramRenderer component
  - [x] 4.1 Write 5 focused tests for StateDiagramRenderer
    - Test component renders state nodes filtered by entity_type === 'STATE'
    - Test component renders transitions filtered by relationship_type === 'STATE_TRANSITION'
    - Test state nodes render at z-index 100
    - Test transitions render at z-index 110
    - Test empty diagram shows appropriate placeholder text
  - [x] 4.2 Create StateDiagramRenderer.tsx component file
    - Create at `frontend/src/components/DiagramsView/StateDiagramRenderer.tsx`
    - Follow ActivityDiagramRenderer.tsx structure exactly
    - Define StateDiagramRendererProps interface with diagram, metaModel, zoom props
  - [x] 4.3 Implement StateNodeElement sub-component
    - Accept node, renderResult, label props
    - Handle bullseye (Final) nodes with separate outer/inner paths
    - Render label using wrapText utility for Normal nodes
    - Apply cursor: pointer style and z-index 100
  - [x] 4.4 Implement StateTransitionElement sub-component
    - Accept edge, sourceNode, targetNode, label props
    - Calculate source/target centers from node positions
    - Render line path, arrowhead path, and optional label
    - Apply z-index 110
  - [x] 4.5 Implement main StateDiagramRenderer component logic
    - Filter diagram_nodes for entity_type === 'STATE'
    - Filter diagram_edges for relationship_type === 'STATE_TRANSITION'
    - Build nodeMap for efficient edge endpoint lookup
    - Compute render results for all nodes and edges
    - Render nodes first, then transitions
  - [x] 4.6 Add helper functions for entity lookups
    - getStateById: lookup State from metaModel.entities.states
    - getStateTransitionById: lookup StateTransition from metaModel.entities.state_transitions
    - getStateLabel: return state.name or fallback to stateId
    - getTransitionLabel: delegate to resolveTransitionLabel
  - [x] 4.7 Integrate StateDiagramRenderer into Canvas.tsx
    - Import StateDiagramRenderer component
    - Add isStateDiagram check: `diagram?.diagram_type === 'State'`
    - Add conditional render similar to isActivityDiagram pattern
    - Pass diagram, metaModel, zoom props
  - [x] 4.8 Ensure StateDiagramRenderer tests pass
    - Run ONLY the 5 tests written in 4.1
    - Verify Canvas correctly switches to State renderer

**Acceptance Criteria:**
- The 5 tests written in 4.1 pass
- State diagrams render via StateDiagramRenderer when diagram_type === 'State'
- Nodes render at z-index 100, transitions at z-index 110
- Live endpoint updates work as nodes are moved (inherited from Canvas patterns)

**Files to Create:**
- `frontend/src/components/DiagramsView/StateDiagramRenderer.tsx`

**Files to Modify:**
- `frontend/src/components/DiagramsView/Canvas.tsx`

---

### State Transition Creation UX Layer

#### Task Group 5: RHS Palette State Transition Creation and Inspector
**Dependencies:** Task Group 4

This group implements the "+ New State Transition" button UX flow and inspector editing.

- [x] 5.0 Complete State Transition creation UX
  - [x] 5.1 Write 4 focused tests for State Transition creation
    - Test "+ New State Transition" button appears for State diagram type
    - Test clicking button enters transition-creation mode
    - Test clicking two states creates StateTransition entity and DiagramEdge
    - Test Escape key cancels creation mode
  - [x] 5.2 Add State Transition creation state to PalettePanel or Canvas
    - Define transitionCreationMode state: { active: boolean, sourceStateNodeId: string | null }
    - Add handler for entering creation mode
    - Add handler for Escape key to cancel mode
  - [x] 5.3 Add "+ New State Transition" button to PalettePanel
    - Add to CREATE section when getDiagramType returns 'State'
    - Style as action button similar to other creation buttons
    - onClick triggers entering transition-creation mode
    - Button text: "+ New State Transition"
  - [x] 5.4 Implement state click handlers for transition creation
    - When in creation mode and no source: set clicked state node as source
    - When in creation mode and have source: target is clicked state node
    - Create StateTransition entity with from_state_id, to_state_id
    - Create DiagramEdge with relationship_type 'STATE_TRANSITION'
    - Exit creation mode and select the new edge
  - [x] 5.5 Implement StateTransition entity creation utility
    - Generate unique id using generatePrefixedId pattern
    - Set from_state_id from source state entity_id
    - Set to_state_id from target state entity_id
    - Initialize trigger/guard/effect fields as empty
    - Return created StateTransition for adding to metaModel
  - [x] 5.6 Implement DiagramEdge creation for StateTransition
    - Generate unique edge id
    - Set source_node_id, target_node_id from diagram node ids
    - Set relationship_type: 'STATE_TRANSITION'
    - Set relationship_id: StateTransition entity id
    - Return DiagramEdge for adding to diagram
  - [x] 5.7 Add StateTransition fields to SelectionInspector
    - Detect when selected edge is STATE_TRANSITION type
    - Show editable dropdowns for fromStateId, toStateId
    - Show text inputs for trigger fields (triggerRefKind, triggerRefId, triggerLabelText)
    - Show text input for guardExpression
    - Show text inputs for effect fields (effectRefKind, effectRefId)
    - Changes dispatch updates to StateTransition entity
  - [x] 5.8 Ensure State Transition creation tests pass
    - Run ONLY the 4 tests written in 5.1
    - Verify full creation workflow works end-to-end

**Acceptance Criteria:**
- The 4 tests written in 5.1 pass
- "+ New State Transition" button visible only for State diagrams
- Two-click workflow creates StateTransition entity and DiagramEdge
- Escape cancels creation mode
- SelectionInspector shows editable fields for selected transitions
- Edge label updates immediately when entity fields change

**Files to Modify:**
- `frontend/src/components/DiagramsView/PalettePanel.tsx`
- `frontend/src/components/DiagramsView/Canvas.tsx` (click handlers)
- `frontend/src/components/DiagramsView/SelectionInspector.tsx`

**Files to Create:**
- `frontend/src/utils/stateTransitionCreation.ts`
- `frontend/src/__tests__/state-transition-creation.test.ts`

---

### Testing & Gap Analysis

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 4 tests written by Task Group 1 (configuration)
    - Review the 5 tests written by Task Group 2 (state node rendering)
    - Review the 6 tests written by Task Group 3 (state transition rendering)
    - Review the 5 tests written by Task Group 4 (StateDiagramRenderer)
    - Review the 4 tests written by Task Group 5 (creation UX)
    - Total existing tests: 24 tests
  - [x] 6.2 Analyze test coverage gaps for State Diagram feature only
    - Identify critical user workflows lacking coverage
    - Focus ONLY on gaps related to State diagram visualization
    - Prioritize integration tests over additional unit tests
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Focus on end-to-end workflows not covered by unit tests
    - Test backward compatibility: states without state_kind render as Normal
    - Test validation: STATE_TRANSITION nodes no longer cause errors on load
    - Test live updates: moving nodes updates transition endpoints
    - Test label rendering with various trigger/guard/effect combinations
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to State Diagram Visualisation
    - Expected total: approximately 24-34 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-34 tests total)
- Critical user workflows for State diagrams are covered
- No more than 10 additional tests added
- Backward compatibility verified for existing State data

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Configuration & Registry** (Foundation)
   - Must complete first - provides types and defaults for all other groups
   - Small scope, low risk

2. **Task Group 2: State Node Rendering** (Core Rendering)
   - Depends on Task Group 1 for STATE_NODE_DEFAULTS
   - Pure utility functions, easily testable in isolation

3. **Task Group 3: State Transition Rendering** (Edge Rendering)
   - Can potentially run in parallel with Task Group 2
   - Pure utility functions, easily testable in isolation

4. **Task Group 4: StateDiagramRenderer Component** (Integration)
   - Depends on Task Groups 2 and 3 for rendering utilities
   - Integrates all rendering into a cohesive component

5. **Task Group 5: Creation UX** (User Interaction)
   - Depends on Task Group 4 for rendering to verify results
   - Most complex user interaction logic

6. **Task Group 6: Test Review & Gap Analysis** (Quality Assurance)
   - Final validation after all features implemented
   - Fill any critical coverage gaps

---

## Notes

### Existing Patterns to Follow
- **ActivityDiagramRenderer.tsx**: Primary architectural template for StateDiagramRenderer
- **activityNodeRendering.ts**: Template for stateNodeRendering.ts utility structure
- **ACTIVITY_NODE_DEFAULTS**: Template for STATE_NODE_DEFAULTS constant structure
- **entityTypeRegistry.ts**: Pattern for adding new entity type mappings

### Key Design Decisions
- Initial and Final states use identical styling to Activity Initial/Final (neutral black)
- Normal states use entityColors.STATE (light green) to differentiate from Activity nodes
- Label resolution follows explicit priority order for predictable behavior
- Two-click transition creation mirrors common diagramming tool patterns

### Out of Scope Reminders
- No backend changes needed (StateTransition entity exists)
- No advanced routing (straight lines only)
- No nested states, swimlanes, or history pseudo-states
- No transition animation or execution logic

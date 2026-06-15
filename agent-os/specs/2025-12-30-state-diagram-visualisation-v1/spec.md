# Specification: State Diagram Visualisation v1

## Goal
Bring State diagrams to visual parity with Activity diagrams by rendering typed state shapes (Initial/Normal/Final), enabling State Transition creation via RHS palette, and fixing validation by registering STATE_TRANSITION as a known entity type.

## User Stories
- As a solution architect, I want State diagrams to render with proper UML-style state shapes so that I can clearly communicate state machine behavior.
- As a diagram editor, I want to create State Transitions between state nodes so that I can model transitions with triggers, guards, and effects.

## Specific Requirements

**Register STATE_TRANSITION in Entity Type Registry**
- Add `STATE_TRANSITION: 'state_transitions'` entry to `DIAGRAM_NODE_ENTITY_TYPE_MAP` in entityTypeRegistry.ts
- Ensures validation.ts diagram node validation recognizes STATE_TRANSITION as valid
- Eliminates "unknown entity type" errors when loading State diagrams with transitions

**State Node Shape Rendering by stateKind**
- Initial: Solid filled black circle, diameter ~18px, no label (matches Activity Initial)
- Normal: Rounded rectangle (~140x50px), moderate corner radius, label centered (matches Activity Action)
- Final: Bullseye shape (outer stroke circle + inner filled circle), diameter ~22px, no label (matches Activity Final)
- States without stateKind default to Normal for backward compatibility
- Use existing shapeRendering.ts patterns for circle/bullseye rendering

**State Node Colour Scheme**
- Normal state nodes use entityColors.STATE (light green background, green border)
- Initial and Final states use neutral black fill/stroke matching Activity control nodes
- Create STATE_NODE_DEFAULTS constant in defaults.ts following ACTIVITY_NODE_DEFAULTS pattern

**State Transition Creation UX**
- Add "+ New State Transition" button in RHS palette CREATE section for State diagrams
- Clicking button enters transition-creation mode: user clicks source State, then target State
- On completion: StateTransition entity created, DiagramEdge created referencing transition
- Exit creation mode on successful creation or Escape key press
- Select created transition edge to show inspector panel

**State Transition Edge Rendering**
- Render as solid line connecting source and target state nodes
- Arrowhead points to target state
- Compute endpoints from border points of source/target shapes toward each other
- Apply standard edge styling from edgeRendering defaults

**State Transition Label Resolution**
- Priority 1: triggerRefKind/triggerRefId -> resolve referenced Method or Event name
- Priority 2: triggerLabelText if present
- Priority 3: guardExpression if present (wrap in square brackets "[condition]")
- Priority 4: effectRefKind/effectRefId -> resolve referenced Method name
- Label rendered at edge midpoint, slightly above line

**Live Transition Endpoint Updates**
- As state nodes are moved/resized, recompute edge endpoints immediately
- No save/reload required - transitions follow connected nodes in real-time
- Use existing edge point recalculation patterns from Canvas.tsx

**StateDiagramRenderer Component**
- Create new StateDiagramRenderer.tsx following ActivityDiagramRenderer.tsx architecture
- Filter diagram_nodes for entity_type === 'STATE'
- Filter diagram_edges for relationship_type === 'STATE_TRANSITION'
- Render state nodes at z-index 100, transitions at z-index 110
- Integrate into Canvas.tsx with conditional render when diagram.type === 'State'

**State Transition Inspector Editing**
- Selecting a STATE_TRANSITION edge shows SelectionInspector
- Editable fields: fromStateId, toStateId (dropdowns), trigger, guard, effect fields
- Changes update underlying StateTransition entity and refresh edge label immediately

## Visual Design

No visual mockups provided in planning/visuals folder.

## Existing Code to Leverage

**ActivityDiagramRenderer.tsx**
- Follow identical component structure for StateDiagramRenderer
- Reuse z-index layering pattern (nodes at 100, edges at 110)
- Use same props interface pattern (diagram, metaModel, zoom)
- Reference ActivityNodeElement and ActivityFlowElement as templates for StateNodeElement and StateTransitionElement

**ACTIVITY_NODE_DEFAULTS in defaults.ts**
- Follow same structure for STATE_NODE_DEFAULTS constant
- Reuse ActivityNodeShape type pattern to define StateNodeShape type
- Copy Initial and Final configurations directly (same visual appearance)
- Adapt Action configuration for Normal state

**shapeRendering.ts**
- Reuse renderCircle() for Initial state (filled black)
- Reuse circle path generation for Final state bullseye pattern
- renderBox() pattern adaptable for Normal state rounded rectangles

**entityTypeRegistry.ts**
- Add STATE_TRANSITION to DIAGRAM_NODE_ENTITY_TYPE_MAP mapping
- Ensures validation and rendering recognize the entity type

**rendering.ts**
- Use getEntityLabel() pattern for resolving state names
- Reuse calculateArrowhead() for transition arrowheads
- Use wrapText() for state name labels in Normal nodes

## Out of Scope
- Backend schema changes (StateTransition entity already exists)
- Advanced routing algorithms (orthogonal routing, waypoints)
- Nested/composite states
- Swimlane partitions for State diagrams
- State entry/exit action rendering
- Transition guard/effect evaluation or execution
- State history (shallow/deep history pseudo-states)
- Fork/join concurrent state constructs
- Multiple simultaneous transitions from same source
- Transition animation or highlighting during execution

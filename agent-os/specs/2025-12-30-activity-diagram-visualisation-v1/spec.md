# Specification: Activity Diagram Visualisation v1

## Goal
Upgrade Activity diagrams from generic boxes to a recognisable UML/BPMN-style activity diagram with swimlanes (Activity Partitions), typed activity node shapes based on activityKind, and Activity Flow edges between activities.

## User Stories
- As a solution architect, I want Activity diagrams to render with proper swimlanes and typed node shapes so that I can communicate workflow and process responsibility clearly.
- As a diagram editor, I want to create Activity Flows between activity nodes so that I can model the control and data flow through a process.

## Specific Requirements

**Activity Partition Swimlane Rendering**
- Partitions render as a container with distinct header region and body region
- Header displays partition name centered; body is the swimlane area containing activities
- Clear border around full partition with divider line between header and body
- Header background subtly distinct from body (e.g., slightly darker or different hue)
- Partition containers are resizable and draggable as a unit
- Activities can be dragged within partition body; soft constraint keeps activities visually inside

**Partition Orientation Support**
- Support two orientations: VERTICAL (default) and HORIZONTAL
- VERTICAL: Header at top, lane extends top-to-bottom, multiple partitions arranged left-to-right
- HORIZONTAL: Header on left, lane extends left-to-right, multiple partitions arranged top-to-bottom
- Partitions without explicit orientation default to VERTICAL for backward compatibility

**Activity Node Shape Rendering by activityKind**
- Initial: Solid filled black circle, diameter ~18px, no label
- Action: Rounded rectangle (~140x50px), moderate corner radius (pill-like), label centered, green theme
- Decision: Diamond shape (~60x60px), optional label centered or above
- Merge: Diamond shape (~20x20px), significantly smaller than Decision, no label by default
- Final: Bullseye shape (outer circle stroke + inner filled circle), diameter ~22px, no label
- Activities without activityKind default to Action for backward compatibility

**Activity Node Colour Scheme**
- Action nodes use existing green theme from entityColors
- Control nodes (Initial, Decision, Merge, Final) use neutral black/white styling
- Shape stroke and fill colours defined in a new ACTIVITY_NODE_DEFAULTS constant

**Activity Flow Creation UX**
- Add "+ New Activity Flow" button in RHS palette panel CREATE section for Activity diagrams
- Clicking button enters flow-creation mode: user clicks source Activity, then target Activity
- On completion: ActivityFlow entity created, DiagramEdge created referencing flow, edge appears immediately
- Exit flow-creation mode on successful creation or Escape key press

**Activity Flow Edge Rendering**
- Render as straight line connecting source and target activity nodes
- Arrowhead points to target activity
- Optional label at midpoint if flow has condition or trigger text
- For Decision outgoing flows, labels like "Yes" / "No" rendered near edge
- Edge styling follows existing edge rendering patterns (line_type, arrow_end)

**Activity Flow Editing via Inspector**
- Selecting a flow edge shows existing SelectionInspector
- Editable fields: condition, trigger, flowKind (Control/Data)
- Changes update edge label live on canvas

**Manual Layout Preservation**
- Activity diagrams remain fully manually editable (no auto-layout)
- Nodes are draggable within the canvas and within partitions
- Partitions are draggable and resizable
- Activity Flows reposition automatically based on connected node positions

**Rendering Architecture**
- Create new ActivityDiagramRenderer component similar to SequenceDiagramRenderer pattern
- In Canvas.tsx, conditionally render ActivityDiagramRenderer when diagram.type === 'Activity'
- General diagrams and other types use existing renderers unchanged

**Partition Layering and Z-Index**
- Partitions render behind activities and flows (lower z-index)
- Activities always render above partition body
- Flows render above activities for visibility

## Visual Design

No visual mockups provided in planning/visuals folder.

## Existing Code to Leverage

**SequenceDiagramRenderer.tsx**
- Follow the same component architecture pattern for ActivityDiagramRenderer
- Reuse constants pattern for font sizes, stroke widths, colours
- Use similar props interface (diagram data, metaModel, spacing)
- Reference the layout computation pattern (compute layout then render elements)

**shapeRendering.ts**
- Reuse renderDiamond() for Decision and Merge nodes (different sizing)
- Reuse renderCircle() for Initial and Final nodes (with fill variations)
- Pattern for ShapeRenderResult with pathData, fill, stroke can be extended
- renderBox pattern can be adapted for Action node rounded rectangles

**rendering.ts**
- Reuse calculateArrowhead() for Activity Flow arrowheads
- Reuse wrapText() and measureTextWidth() for node labels
- Reuse getEntityLabel() pattern for resolving activity names
- Use existing edge styling defaults from getRelationshipEdgeDefaults()

**CreateAndPlaceDrawer.tsx**
- Already supports ACTIVITY and ACTIVITY_PARTITION entity creation
- Already has ACTIVITY_KIND_OPTIONS and field configurations
- Extend to support ACTIVITY_FLOW creation or add separate flow creation mode

**defaults.ts**
- Follow DECORATION_DEFAULTS pattern to create ACTIVITY_NODE_DEFAULTS
- Reuse baseShapeDefaults structure for consistent styling
- Reference diagramEditing constants for selection styling

## Out of Scope
- Backend schema changes (entities already exist)
- Auto-layout algorithms for automatic positioning of activities
- Advanced flow routing (orthogonal routing, waypoints, bend points)
- Fork and Join activity nodes (parallel flow constructs)
- Swimlane nesting (partitions containing partitions)
- Activity edge condition guards with complex expressions
- Signal/Event intermediate nodes
- Object flow pins on action nodes
- Interruptible activity regions
- Expansion regions for collections

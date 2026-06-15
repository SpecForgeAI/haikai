# Specification: Activity Diagram UX and Rendering Improvements

## Goal
Implement five improvements to Activity diagrams: partition header name resolution for referenced entities, edge-to-edge flow anchoring, decision flow condition modal, ACTIVITY_FLOW entity type validation fix, and movable/resizable labels with default positioning rules.

## User Stories
- As a user, I want partition headers to display the referenced entity name (when set) so that swimlanes correctly identify their responsible actor or system.
- As a user, I want activity flow arrows to connect at shape boundaries so that diagrams look professional and edges do not overlap node interiors.
- As a user, I want to enter flow condition details in a modal when creating flows from Decision nodes so that guard conditions are captured at creation time.

## Specific Requirements

**Partition Header Name Resolution**
- When rendering an ACTIVITY_PARTITION node, check if `partition.ref_kind` and `partition.ref_id` are set
- If referenced, resolve the entity name from metaModel using the ref_kind (e.g., BUSINESS_USER, APP_COMPONENT) and ref_id
- Fall back to `partition.name` if the referenced entity cannot be found, then to `partition.id` as last resort
- Header text must use `text-anchor="middle"` and `dominant-baseline="middle"` for centering
- Position text at center of header bar: `x = partitionRect.x + headerWidth/2`, `y = partitionRect.y + headerHeight/2`

**Flow Boundary Anchoring**
- Create a geometry utility function `getBoundaryAnchorPoint(sourceRect, targetRect, shapeKind)` where shapeKind includes RoundedRect, Diamond, Circle
- For rectangles/rounded-rects: compute ray from source center to target center and find intersection with rect bounds
- For diamonds: intersect ray with the 4-point polygon boundary
- For circles (Initial/Final nodes): intersect ray with the circle radius
- Update `activityFlowCreation.ts` edge point generation to use boundary anchors instead of center coordinates
- Preserve arrowhead orientation based on the final edge direction vector

**Decision Flow Condition Modal**
- Create `EditActivityFlowConditionModal.tsx` in `frontend/src/components/DiagramsView/modals/`
- After activity flow creation, check if the source Activity has `activity_kind === 'Decision'`
- If Decision, immediately open modal with fields: condType (select), condRefKind/condRefId (entity picker), conditionText (textarea)
- Modal has "Save" to persist to ActivityFlow entity and "Skip" to close without changes
- Use existing enum options from the meta-model grid for condType dropdown
- Update the ArchitectureContext dispatch pattern to handle ADD_ENTITY followed by entity updates

**ACTIVITY_FLOW Entity Type Validation**
- Add 'ACTIVITY_FLOW' to `DIAGRAM_NODE_ENTITY_TYPE_MAP` in `frontend/src/utils/entityTypeRegistry.ts` pointing to 'activity_flows'
- Update the "add existing Activity Flow from RHS list" handler in PalettePanel.tsx to create a diagram EDGE (not node)
- Edge must have: `fromNodeId` = node for `flow.from_activity_id`, `toNodeId` = node for `flow.to_activity_id`, and `relationship_type: 'ACTIVITY_FLOW'`
- If either activity node is missing from diagram, show toast warning and do not create dangling edge
- Ensure both add paths (new flow creation + add existing) produce identical edge schema

**Movable/Resizable Label Decorations**
- Define a new decoration kind `LABEL` in the diagram decorations type system
- Label decoration properties: `targetKind` (NODE or EDGE), `targetId`, `x`, `y`, `width`, `height`, optional `text` override
- When creating new Activity nodes, also create label decoration with default placement based on activity_kind
- Action activity: label centered inside the rounded-rect bounds
- Decision activity: label positioned below diamond (y = diamondBottom + 8) with center alignment
- Activity Flow edges: label decoration near edge midpoint, offset slightly above the line
- Implement drag handlers for label decorations that update x/y without moving underlying node/edge
- Implement resize handlers for label decorations that update width/height independently

**Default Label Rendering Without Explicit Decoration**
- When rendering, check if a label decoration exists for each Activity node and Activity Flow edge
- If no label decoration exists, compute default position and render text in a "virtual" mode
- Persist label decoration on first user interaction (drag or resize) to enable future customization
- Action labels use center/center alignment; Decision labels use center/top alignment within their box

## Visual Design
N/A - No visual mockups provided in planning/visuals folder.

## Existing Code to Leverage

**`frontend/src/utils/activityPartitionRendering.ts`**
- Contains `renderPartition()` function that already builds header rect, body rect, and text element
- Currently uses `partition.name` directly; needs extension to resolve referenced entity names
- Has `renderVerticalTextElement()` and `renderHorizontalTextElement()` for text positioning

**`frontend/src/utils/activityFlowCreation.ts`**
- Contains `createActivityFlowDiagramEdge()` which calculates center coordinates for edge points
- Provides `ActivityFlowCreationMode` interface and state management functions
- Already integrated with DiagramsView.tsx for flow creation workflow

**`frontend/src/utils/activityNodeRendering.ts`**
- Contains shape rendering for Initial, Action, Decision, Merge, Final activity nodes
- Provides dimensions and path data for each shape type needed for boundary calculations
- Has `renderActivityFlow()` for edge path generation

**`frontend/src/utils/entityTypeRegistry.ts`**
- Single source of truth for `DIAGRAM_NODE_ENTITY_TYPE_MAP`
- Currently maps 18 entity types; needs ACTIVITY_FLOW added for edge validation
- Used by rendering.ts and validation.ts for entity lookups

**`frontend/src/components/common/Modal.tsx`**
- Provides base Modal component with overlay, header, content, and footer
- Follow this pattern for EditActivityFlowConditionModal with custom footer buttons (Save/Skip)

## Out of Scope
- Backend schema changes (all changes are frontend-only)
- Advanced edge routing with waypoints or automatic path finding
- Multi-condition editor supporting more than condType, condRefKind/condRefId, and conditionText fields
- Partition nesting or hierarchical partition structures
- Automatic layout or spacing algorithms for activity diagrams
- Sequence diagram or State diagram label improvements (Activity diagram only)
- Label persistence for diagrams other than Activity diagrams
- Animated edge transitions or flow simulation
- Undo/redo support specifically for label movements
- Collaborative editing or real-time sync of label positions

# Specification: Fix Advanced Add Parent Wrapping for Interface Composite

## Goal
Ensure that parent nodes (Application, Component, Service) in Advanced Add correctly resize to wrap the Interface composite node, using the children's actual measured dimensions rather than fixed/minimum sizes.

## User Stories
- As a user, I want to use Advanced Add with Application -> Component -> Service -> Interface so that the parent boxes visually wrap and contain the Interface composite correctly.
- As a user, I want the spacing presets (Spacious/Normal/Tight) to apply consistently to parent wrapping around Interface composites.

## Specific Requirements

**Interface composite node must be attached to the layout tree**
- When `buildInterfaceCompositeNodes()` creates an Interface composite, the resulting node must be attached as the child of Service in the LayoutTreeNode structure
- The tree hierarchy must be: Application -> Component -> Service -> Interface (composite)
- The same node instances used for rendering MUST be passed into measure/assignPositions
- No "shadow" or stale copies of Interface should exist during parent measurement

**Measure phase must use actual child dimensions**
- The `measure()` function in `compoundLayout.ts` must recursively compute parent sizes based on children's `measuredWidth` and `measuredHeight`
- For Interface composite nodes, their pre-computed width/height (from `buildInterfaceCompositeNodes`) must be used as the child dimensions
- Service.height >= InterfaceComposite.height + 2 * paddingY
- Component.height >= Service.height + 2 * paddingY
- Application.height >= Component.height + 2 * paddingY
- Parent width must be: max(child widths) + 2 * paddingX

**AssignPositions phase must respect computed sizes**
- The `assignPositions()` function must use the `measuredWidth` and `measuredHeight` from the measure phase
- Child positioning must start below the parent label with proper padding
- Children must be centered horizontally within their parent's content area
- Vertical stacking must account for childVerticalGap from spacing presets

**Integration with buildWrappedNodeHierarchy**
- The `buildWrappedNodeHierarchy()` function in `PalettePanel.tsx` must properly convert Interface custom candidates to LayoutTreeNodes
- When an Interface is detected as a custom candidate via `findInterfaceCustomCandidates()`, its pre-computed dimensions must flow through the layout algorithm
- The `convertTreeNodeToLayoutTreeWithExistingHandling()` function must include Interface composite dimensions

**convertTodiagramNodes must preserve Interface composite dimensions**
- When converting LayoutNode to DiagramNode for Interface custom candidates, the width/height from layout must be preserved
- The Interface node created by `buildInterfaceCompositeNodes()` must use the layout-computed position, not just center the Interface

**Spacing presets must be respected throughout**
- paddingX, paddingY, and childVerticalGap from SPACING_PRESETS must propagate to all layout calculations
- Switching between Tight/Normal/Spacious must cause all parent boxes to expand/contract accordingly
- Interface composite content (header + endpoints + entities) must respect internal padding constants from `interfaceCustomRenderer.ts`

**No hard-coded minimum heights for containers with children**
- Service, Component, and Application must NOT override height with a hard-coded minimum when they have children
- Container height must always be: childrenHeight + labelHeight + LAYOUT_LABEL_PADDING + 2 * paddingY

**JSON representation correctness**
- The resulting diagram JSON must contain proper width/height values for all nodes
- Each parent's width/height must reflect the layout computed during measurement
- No zero-sized or placeholder nodes should exist

## Existing Code to Leverage

**compoundLayout.ts - measure() and assignPositions()**
- The two-pass layout algorithm already exists with proper recursive dimension calculation
- `measure()` at lines 171-221 computes dimensions bottom-up
- `assignPositions()` at lines 235-291 positions nodes top-down
- These functions correctly pass spacing config through the recursion
- The issue is likely in how Interface composite nodes connect to this algorithm

**interfaceCompositeBuilder.ts - buildInterfaceCompositeNodes()**
- Correctly calculates Interface dimensions using `calculateInterfaceWithEntitiesHeight()` and `calculateInterfaceWithEntitiesWidth()`
- Creates Interface node with proper width/height at lines 244-261
- Creates child entity nodes positioned inside the Interface
- This function should be called and its dimensions integrated into the parent layout

**PalettePanel.tsx - buildWrappedNodeHierarchy()**
- Entry point for Advanced Add layout at lines 187-413
- Uses `findInterfaceCustomCandidates()` to detect Interface custom candidates
- Calls `layoutAdvancedAddSelection()` which invokes measure/assignPositions
- Calls `convertTodiagramNodes()` which handles Interface composite creation
- The integration between Interface composite creation and parent measurement may be the gap

**erdAdvancedAddUtils.ts - findInterfaceCustomCandidates()**
- Correctly identifies Interface nodes that should use custom composite layout
- Returns InterfaceCustomCandidate objects with endpoints and logicalEntities arrays
- Used to filter out embedded children from the standard layout tree

**interfaceCustomRenderer.ts - dimension calculation constants**
- INTERFACE_HEADER_HEIGHT, INTERFACE_PADDING_X, INTERFACE_PADDING_Y constants
- calculateInterfaceWithEntitiesHeight() and calculateInterfaceWithEntitiesWidth() functions
- These must align with the dimensions used in measure/assignPositions

## Out of Scope
- Changes to the Interface custom rendering appearance (header style, endpoint formatting)
- Adding new entity types or relationships
- Modifying the Advanced Add dialog UI or tree selection logic
- Changes to edge/relationship creation or routing
- Performance optimization of the layout algorithm
- Multi-column grid layout for Interface composites
- Drag-and-drop repositioning of nodes after layout
- Undo/redo functionality for Advanced Add operations
- Backend API changes for Advanced Add
- Changes to ERD-style entity rendering within Interface composites

# Specification: Reclassify Interactions as Relationships

## Goal
Reclassify User Interactions from entities to relationships in the meta-model and diagram palette, removing Interaction nodes (yellow boxes) and rendering them as dotted edges with movable labels instead.

## User Stories
- As an architecture modeler, I want Interactions displayed in the relationships row so that the conceptual model correctly represents Interactions as relationships between Users and App_Business_Points.
- As a diagram creator, I want Interactions rendered as dotted edge lines with labels so that I can visualize user journeys without cluttering diagrams with unnecessary node boxes.

## Specific Requirements

**Meta-model Tab Reclassification**
- Remove "Interactions" from `entityTabNames` array in `gridConfigs.ts`
- Remove "Interactions" from `domainGroupings.business` array
- Add "Interactions" to `relationshipTabNames` array after "App Point <-> Business Point" and before "Logical ER"
- Add mapping to `relationshipTabToType` for the new "Interactions" tab
- Keep the grid config (`interactions`) unchanged as it still defines the table columns

**Palette Section Reorganization**
- Move the "User Interactions" section from entity sections to relationship sections in `paletteData.ts`
- Change the section `type` from `'entity'` to `'relationship'`
- Position after "App Point <-> Business Point" section in the relationships array
- Update `getEntityTypeConstant` mapping if needed for palette item handling

**Interaction Edge Visualization Design**
- Two-point case: Render dotted line between primary and secondary App_Business_Point nodes, plus a second dotted line from User node to the midpoint of the main line
- Single-point case: Render single dotted line from User node directly to the primary App_Business_Point
- Label displays the Interaction name, positioned at the center of the main edge line
- Label is movable/draggable with position persisted in edge data
- Use existing `interactionRendering.ts` utilities for path calculations

**New DiagramInteractionEdge Type**
- Create new interface `DiagramInteractionEdge` in `model.ts` to replace `DiagramUserInteraction`
- Include fields: `id`, `interaction_id`, `relationship_type: 'USER_INTERACTION'`
- Include edge point fields: `source_node_id`, `target_node_id`, `edge_points`
- Include label position fields: `label_text`, `label_pos_x`, `label_pos_y`
- Include optional user link fields: `user_node_id`, `user_link_edge_points`
- Store in `diagram.interaction_edges` array (new field on Diagram interface)

**Remove Interaction Node Rendering**
- Remove INTERACTION from node rendering logic in `Canvas.tsx`
- Remove the yellow box color configuration for INTERACTION entity type
- Interactions should NOT appear as draggable nodes on the diagram
- Keep INTERACTION in entity type maps only for backward compatibility during migration

**Edge Rendering Implementation**
- Extend `renderUserInteractionLines` function in `Canvas.tsx` to use new edge structure
- Render main edge as dotted line with configurable stroke color (purple #8E44AD)
- Render user-link edge as dotted line from user node to midpoint/primary
- Add interaction edge label rendering with proper text positioning
- Apply z-index so interaction edges render above regular edges but below selection indicators

**Label Positioning and Dragging**
- Add label drag handlers similar to existing edge label drag in `Canvas.tsx`
- Store `label_pos_x` and `label_pos_y` in the interaction edge structure
- On drag end, dispatch action to update label position in diagram state
- Calculate default label position as midpoint of the main edge segment

**CRUD Synchronization**
- When Interaction entity is updated in the meta-model table, update corresponding diagram edges
- When Interaction entity is deleted, remove all corresponding edges from diagrams
- When User or App_Business_Point is deleted, cascade delete Interactions referencing them
- Sync Interaction name changes to edge label_text on all diagrams

## Visual Design
No mockups provided - implementation based on existing edge rendering patterns and requirements description.

## Existing Code to Leverage

**`frontend/src/utils/interactionRendering.ts`**
- Already implements `calculateInteractionPaths`, `generateLinePath`, `getStrokeDasharray`
- Provides `Point` interface, `InteractionLinePaths` interface for line calculations
- Use `getNodeCenter`, `calculateMidpoint` for positioning logic
- Extend rather than replace these utilities

**`frontend/src/components/DiagramsView/Canvas.tsx` edge rendering**
- Existing `renderUserInteractionLines` function at line ~2718 provides foundation
- Edge drag handlers (`edgeDragState`, `handleMouseDown/Move/Up`) can be adapted
- Label drag pattern from regular edges (`previewLabelPos`) should be replicated
- Selection and z-index patterns from `sortedElements` rendering loop

**`frontend/src/config/gridConfigs.ts`**
- `entityTabNames`, `relationshipTabNames` arrays control tab ordering
- `tabToEntityType`, `relationshipTabToType` maps link tabs to data keys
- `domainGroupings` controls visual grouping of entity tabs

**`frontend/src/utils/paletteData.ts`**
- `getPaletteSections` function builds entity and relationship sections
- Section ordering in arrays determines palette display order
- `type: 'entity' | 'relationship'` controls visual grouping

**`frontend/src/types/model.ts`**
- `DiagramUserInteraction` interface exists (replace with `DiagramInteractionEdge`)
- `DiagramEdge` interface shows edge structure with `edge_points`, label fields
- `RELATIONSHIP_EDGE_TYPES` constant for edge type identifiers

## Out of Scope
- Migration script for existing diagrams with Interaction nodes (future task)
- Backend/server-side changes for the reclassification
- Changes to Interaction entity data structure in meta-model (entity stays same, only classification changes)
- Adding new visual styling options for interaction edges beyond existing dotted line
- Multi-segment polyline support for interaction edges (keep as straight lines)
- Interaction edge selection and resize handles (read-only visualization initially)
- Multiplicity labels on interaction edges
- Undo/redo integration for interaction edge changes
- Export/import format changes for interaction edges
- Real-time collaboration sync for interaction edges

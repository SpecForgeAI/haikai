# Spec Requirements: Diagram Finalization and Completion UX (Increment 7)

## Initial Description

**Title:** Add Diagram Finalization and Completion UX (Persist Native Diagram from Confirmed Mapping)

**Objective:**
Take a fully resolved mapping (from Increment 5 auto-mapping or Increment 6 modal confirmation) and convert the TemporaryArchitectureDiagram into the native diagram format, persist it, replace the temporary view with the finalized diagram, and provide completion feedback.

**Context - Increment Series:**
- Increment 1: Contract definition (complete)
- Increment 2: Architect task framework (complete)
- Increment 3: MCP endpoint for saving (complete)
- Increment 4: Render temporary diagrams (complete)
- Increment 5: Deterministic auto-mapping framework (complete)
- Increment 6: Mapping confirmation modal (complete)
- Increment 7: Diagram finalization and completion UX (THIS increment)

## Requirements Discussion

### First Round Questions

**Q1:** I found that the `ADD_DIAGRAM` dispatch action automatically sets `selectedDiagramId` to the new diagram's ID. I assume that after finalization, the flow is: (a) build native `Diagram` object from `CompletedDiagramMapping`, (b) dispatch `ADD_DIAGRAM`, (c) deactivate temporary diagram mode -- and the `ADD_DIAGRAM` action naturally switches the view to show the newly finalized diagram. Is that correct, or should there be an intermediate confirmation step before the diagram is added?
**Answer:** Yes -- build the native Diagram, dispatch ADD_DIAGRAM so it becomes the active diagram, then exit/deactivate temporary diagram mode; no intermediate confirmation step is needed in this increment.

**Q2:** For the fully_matched auto-mapping case: I see the current code at line 751 has a comment "If fully_matched: do not open modal; future increments will proceed downstream." I assume for fully_matched, the finalization should happen automatically (no modal, no extra user click) -- the CompletedDiagramMapping is built from the mapping result directly, and finalization proceeds immediately. Is that correct, or should the user still get a "Confirm & Save" button even when all mappings are auto-resolved?
**Answer:** Yes -- when mapping is fully_matched, finalize automatically with no modal and no extra user click, by deriving CompletedDiagramMapping directly from the deterministic mapping result.

**Q3:** For the partially_matched / no_matches case: after the user confirms in the MappingConfirmationModal (which sets `completedDiagramMapping` on the state), should finalization happen automatically as a React effect triggered by `completedDiagramMapping` becoming non-null, or should there be a separate "Finalize Diagram" button the user clicks after the modal closes?
**Answer:** After the modal confirmation completes, finalization should happen automatically; do not require a separate "Finalize" button in this increment.

**Q4:** The `Diagram` interface requires `typedContent` (a `TypedContentEnvelope` with `ERContent` containing `entityRefs` and `relationshipRefs`), `diagram_type` (should be `'ER'`), and nodes/edges need native IDs. I see `generatePrefixedId` is the standard ID generator. I assume I should use these same generators for all new native IDs (diagram, node, edge, edge_point). Is that correct?
**Answer:** Yes -- use generatePrefixedId for all newly created native diagram object IDs (diagram, nodes, edges, edge points, and any other generated native IDs).

**Q5:** For edge conversion, the native `DiagramEdge` requires `relationship_id` and `relationship_type`. The `CompletedEdgeMapping` provides `resolvedRelationshipId`. I assume the conversion should: (a) map `resolvedRelationshipId` to `relationship_id`, (b) set `relationship_type` to `'DATA_ENTITY_RELATIONSHIP'`, (c) flatten source/target labels into the native flat fields, and (d) generate IDs for each `EdgePoint`. Does this match your expectation?
**Answer:** Yes -- set relationship_id from the resolved mapping, use relationship_type = "DATA_ENTITY_RELATIONSHIP" (or the agreed native constant for ER relationships in the codebase), flatten source/target labels into native edge fields, and generate native EdgePoint IDs for copied routing points.

**Q6:** For node conversion, the native `DiagramNode` needs `entity_type`, `entity_id`, `render_style: 'erd'`, and `embedded_attribute_ids` / `selected_attribute_ids`. I assume `entity_type` should be derived from the temporary diagram's `view_mode` and both attribute ID arrays should be populated with resolved attribute IDs. Is that the right approach?
**Answer:** Derive node.entity_type from view_mode, populate embedded_attribute_ids from the resolved attribute mappings, and leave selected_attribute_ids aligned with the rendered attributes as well (populate it with the same resolved attribute IDs unless existing native UX conventions strongly require null).

**Q7:** Regarding persistence/saving: After dispatching `ADD_DIAGRAM`, should the finalization flow also trigger `saveModelToBackend()` automatically, or should it rely on the user's normal manual save?
**Answer:** Do not auto-save to the backend in this increment; create the native diagram in client state via ADD_DIAGRAM and rely on the product's existing save flow/manual save semantics unless there is already an established automatic persistence pattern for diagram additions.

**Q8:** For completion UX feedback: I see the existing `Toast` component. I assume a success toast is sufficient. Is a toast sufficient, or do you want a more elaborate success state?
**Answer:** A success toast/message is sufficient for this increment, e.g. "Diagram Complete" or "Diagram '<name>' created successfully"; no elaborate animation or dialog is required.

**Q9:** For error recovery: if the conversion from temporary to native fails mid-way, should we show an error toast and keep the temporary diagram displayed so the user can try again?
**Answer:** Yes -- on finalization/persistence error, show an error toast/message and keep the temporary diagram (and confirmed mapping state if applicable) visible so the user can retry without losing work.

**Q10:** Is there anything that should be explicitly excluded from this increment?
**Answer:** Explicitly exclude groups, advanced style overrides/custom theming transfer, non-ER diagram finalization, diagram editing workflows post-finalization, export/print, version history, and any automatic architecture-model mutation beyond creating the finalized native diagram.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: DiagramSelector new diagram creation - Path: `frontend/src/components/DiagramsView/DiagramSelector.tsx` (lines 52-65) -- the standard flow for creating a native `Diagram` via `ADD_DIAGRAM` dispatch, including `generatePrefixedId('diag')` for ID generation
- Feature: ID generation utilities - Path: `frontend/src/utils/idGenerator.ts` -- `generatePrefixedId(prefix)` for all native IDs with prefixes: `'diag'` (diagrams), `'node'` (diagram_nodes), `'edge'` (diagram_edges), `'edgept'` (edge_points)
- Feature: Toast notification component - Path: `frontend/src/components/common/Toast.tsx` -- reusable toast with success/error types, auto-dismiss (5s success, 30s error), used in `CreateOrganisationModal` and `GenerateProjectStandardsModal` with `ToastState` pattern (`{ visible, message, type }`)
- Feature: Save utilities - Path: `frontend/src/utils/saveUtils.ts` -- `saveModelToBackend()` for reference on how model persistence works (NOT to be called in this increment, but good context)
- Feature: TypedContent types - Path: `frontend/src/types/typedContent.ts` -- `TypedContentEnvelope`, `ERContent`, `EREntityRef`, `ERRelationshipRef`, `createDefaultERContent()`
- Feature: CompletedDiagramMapping contract (Increment 6 output) - Path: `frontend/src/utils/mappingConfirmationUtils.ts` -- `CompletedDiagramMapping`, `CompletedNodeMapping`, `CompletedAttributeMapping`, `CompletedEdgeMapping`
- Feature: TemporaryArchitectureDiagram contract (Increment 1) - Path: `frontend/src/types/temporaryArchitectureDiagram.ts` -- source temporary diagram types
- Feature: Native diagram types - Path: `frontend/src/types/model.ts` -- `Diagram` (line 2010), `DiagramNode` (line 1833), `DiagramEdge` (line 1763), `EdgePoint` (line 1756)
- Feature: ArchitectureContext ADD_DIAGRAM action - Path: `frontend/src/contexts/ArchitectureContext.tsx` (line 1908) -- the reducer case that adds diagram to model and sets `selectedDiagramId`
- Feature: DiagramsView TemporaryDiagramState - Path: `frontend/src/components/DiagramsView/DiagramsView.tsx` (line 541) -- current temporary diagram state management including `mappingResult`, `completedDiagramMapping`, and the fully_matched placeholder at line 751
- Feature: TemporaryDiagramContext - Path: `frontend/src/contexts/TemporaryDiagramContext.tsx` -- activation/deactivation mechanism for temporary diagram mode
- Feature: Diagram type definitions - Path: `frontend/src/types/diagramType.ts` -- `DiagramType` union including `'ER'`, `getDiagramType()`, `normalizeDiagramType()`
- Feature: Temporary diagram mapping - Path: `frontend/src/utils/temporaryDiagramMapping.ts` -- `mapTemporaryDiagram()`, `DiagramMappingResult` with `overallStatus` ('fully_matched', 'partially_matched', 'no_matches')

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided. Bash check of `agent-os/specs/2026-03-27-diagram-finalization-completion-ux/planning/visuals/` confirmed no image files present.

### Visual Insights:
N/A -- no visuals to analyze.

## Requirements Summary

### Functional Requirements

**Core Conversion Logic:**
- Build a pure function that converts a `CompletedDiagramMapping` + `TemporaryArchitectureDiagram` into a native `Diagram` object
- Generate all native IDs using `generatePrefixedId` with appropriate prefixes (`'diag'`, `'node'`, `'edge'`, `'edgept'`)
- Set `diagram_type` to `'ER'` on the native diagram
- Populate `typedContent` as a `TypedContentEnvelope` with type `'ER'`, version `1`, and `ERContent` containing `entityRefs` (from completed node mappings) and `relationshipRefs` (from completed edge mappings)

**Node Conversion:**
- Map each `CompletedNodeMapping` to a native `DiagramNode`
- Set `entity_type` derived from `view_mode`: `'LOGICAL'` -> `'LOGICAL_DATA_ENTITY'`, `'PHYSICAL'` -> `'PHYSICAL_DATA_ENTITY'`
- Set `entity_id` from `resolvedEntityId`
- Set `render_style` to `'erd'`
- Copy position (`pos_x`, `pos_y`) and dimensions (`width`, `height`) from the temporary node
- Copy `z_index` if present on the temporary node
- Set `parent_node_id` to `null` (no containment in ER diagrams from this flow)
- Populate `embedded_attribute_ids` with resolved attribute IDs from `CompletedAttributeMapping` entries belonging to this node
- Populate `selected_attribute_ids` with the same resolved attribute IDs (aligned with rendered attributes)

**Edge Conversion:**
- Map each `CompletedEdgeMapping` to a native `DiagramEdge`
- Set `relationship_id` from `resolvedRelationshipId`
- Set `relationship_type` to `'DATA_ENTITY_RELATIONSHIP'` (the native constant for ER relationships)
- Map `source_node_id` and `target_node_id` from temporary node IDs to newly generated native node IDs (requires a temporary-to-native ID lookup map)
- Flatten `source_label` and `target_label` from the temporary edge into native flat fields: `source_label_text`, `source_label_pos_x`, `source_label_pos_y`, `target_label_text`, `target_label_pos_x`, `target_label_pos_y`
- Convert `edge_points` from temporary format (no `id`) to native `EdgePoint` format (with generated `id` via `generatePrefixedId('edgept')`)

**Finalization Triggers (Two Entry Points):**
- **Fully matched (auto-finalization):** When `mappingResult.overallStatus === 'fully_matched'`, derive a `CompletedDiagramMapping` directly from the `DiagramMappingResult` (all mappings have non-null resolved IDs) and proceed to finalization immediately with no user interaction
- **Partially matched / no matches (post-modal):** When `completedDiagramMapping` becomes non-null after the MappingConfirmationModal closes, trigger finalization automatically as a React effect

**Finalization Flow (shared by both triggers):**
1. Convert `CompletedDiagramMapping` to native `Diagram` object
2. Dispatch `ADD_DIAGRAM` with the native diagram (this automatically sets `selectedDiagramId`)
3. Deactivate temporary diagram mode (reset `TemporaryDiagramState` to initial)
4. Show success toast: "Diagram '<name>' created successfully"

**Completion UX:**
- Show a success `Toast` notification after successful finalization using the existing Toast component pattern
- Show an error `Toast` notification if conversion/finalization fails

**Error Recovery:**
- On finalization error, show error toast and keep temporary diagram state (including `completedDiagramMapping` if applicable) intact so the user can retry
- Do not exit temporary diagram mode on error

**No Auto-Save:**
- Do not call `saveModelToBackend()` after adding the diagram
- Rely on existing manual save flow (user clicks Save in TopBar)

### Reusability Opportunities
- `generatePrefixedId` from `utils/idGenerator.ts` for all ID generation
- `Toast` component from `components/common/Toast.tsx` with the `ToastState` pattern (`{ visible, message, type }`)
- `ADD_DIAGRAM` dispatch action from `ArchitectureContext` -- the existing reducer handles adding to `model.diagrams` and setting `selectedDiagramId`
- `createDefaultERContent()` from `types/typedContent.ts` as a reference for building `ERContent`
- `EREntityRef` and `ERRelationshipRef` from `types/typedContent.ts` for typed content population
- `handleCloseTemporaryDiagram` pattern in `DiagramsView` for deactivating temporary mode
- `buildCompletedMapping()` from `mappingConfirmationUtils.ts` can be referenced or extended for the fully_matched auto-derivation case
- `initializeSelectionsFromMappingResult()` from `mappingConfirmationUtils.ts` for understanding how mapping results translate to resolved IDs

### Scope Boundaries

**In Scope:**
- Pure conversion function: `CompletedDiagramMapping` + `TemporaryArchitectureDiagram` -> native `Diagram`
- Node conversion with entity_type derivation, render_style, embedded/selected attribute IDs
- Edge conversion with relationship mapping, label flattening, edge point ID generation
- Temporary-to-native node ID mapping (for edge source/target resolution)
- TypedContent (ERContent) population with entityRefs and relationshipRefs
- Fully_matched auto-finalization trigger (derive CompletedDiagramMapping from DiagramMappingResult, finalize immediately)
- Post-modal auto-finalization trigger (React effect on completedDiagramMapping becoming non-null)
- ADD_DIAGRAM dispatch to client state
- Temporary diagram mode deactivation after successful finalization
- Success toast notification
- Error toast notification with retry capability (keep temporary state on error)
- Unit tests for pure conversion functions
- Integration with existing DiagramsView TemporaryDiagramState

**Out of Scope:**
- Groups from temporary diagram (native `Diagram` has no group concept)
- Advanced style overrides / custom theming transfer from temporary nodes/edges
- Non-ER diagram finalization (only ER diagrams are supported in this increment)
- Diagram editing workflows post-finalization
- Export/print of finalized diagrams
- Version history
- Automatic architecture-model mutation beyond creating the finalized native diagram
- Auto-save to backend (`saveModelToBackend` is not called)
- Elaborate success animations or confirmation dialogs

### Technical Considerations
- The conversion function should be **pure** (no hooks, no side effects) for testability, following the pattern established in `mappingConfirmationUtils.ts`
- A temporary-to-native node ID mapping (`Map<string, string>`) must be built during node conversion and used during edge conversion to remap `source_node_id`/`target_node_id`
- The fully_matched auto-derivation needs a function that builds `CompletedDiagramMapping` from `DiagramMappingResult` when `overallStatus === 'fully_matched'` (all `matchedEntityId`, `matchedAttributeId`, `matchedRelationshipId` fields are guaranteed non-null in this case)
- The React effect in `DiagramsView` at line 742-752 needs modification to handle the fully_matched case (currently has a placeholder comment)
- A new React effect (or extension of existing ones) is needed to trigger finalization when `completedDiagramMapping` becomes non-null
- Toast state should follow the existing pattern from `CreateOrganisationModal`: `useState<ToastState>({ visible: false, message: '', type: 'success' })`
- The `Diagram.name` should come from `TemporaryArchitectureDiagram.name` (the source diagram's name)
- The `Diagram.description` should come from `TemporaryArchitectureDiagram.description` or default to empty string
- Edge `line_color`, `line_type`, `line_weight` from temporary edge styles could be mapped to native edge fields as a simple passthrough (not custom theming, just direct field mapping) -- but this is borderline with "style overrides" exclusion, so defer to spec writer judgment
- Node `background_color`, `line_color`, `text_color` from temporary node styles could similarly be passed through to native node color fields -- same consideration applies

# Specification: Diagram Finalization and Completion UX (Increment 7)

## Goal
Convert a fully resolved `CompletedDiagramMapping` (from Increment 5 auto-mapping or Increment 6 modal confirmation) into a native `Diagram` object, add it to client state via `ADD_DIAGRAM`, deactivate temporary diagram mode, and show a success toast -- completing the temporary-to-native diagram lifecycle.

## User Stories
- As a user, I want my fully auto-matched temporary diagram to be finalized immediately without any extra clicks so that I can start working with the native diagram right away.
- As a user, I want my manually confirmed mapping (from the modal) to automatically produce a native diagram after I click Confirm so that finalization feels seamless.
- As a user, I want to see a success message when finalization completes and an error message if it fails (while keeping my temporary diagram intact for retry) so that I always know the outcome.

## Specific Requirements

**Pure conversion function: `buildNativeDiagramFromMapping`**
- Create a new utility file `frontend/src/utils/diagramFinalizationUtils.ts` containing all pure conversion functions
- The top-level function accepts `CompletedDiagramMapping` and `TemporaryArchitectureDiagram` and returns a native `Diagram` object
- Generate the diagram ID with `generatePrefixedId('diag')`
- Set `diagram_type` to `'ER'`, `name` from the temporary diagram's `name`, `description` from the temporary diagram's `description` (default to `''`)
- Build `typedContent` as a `TypedContentEnvelope` with `type: 'ER'`, `version: 1`, and `ERContent` populated with `entityRefs` and `relationshipRefs` derived from the completed mappings
- Initialize `diagram_nodes`, `diagram_edges`, `decorations: []`, `label_decorations: []`, `settings: {}`

**Node conversion logic**
- For each `CompletedNodeMapping`, generate a native `DiagramNode` ID with `generatePrefixedId('node')`
- Build a `Map<string, string>` mapping temporary node IDs to native node IDs during this step (needed by edge conversion)
- Set `entity_type`: `'LOGICAL_DATA_ENTITY'` when `viewMode === 'LOGICAL'`, `'PHYSICAL_DATA_ENTITY'` when `viewMode === 'PHYSICAL'`
- Set `entity_id` from `resolvedEntityId`, `render_style` to `'erd'`, `parent_node_id` to `null`
- Copy `pos_x`, `pos_y`, `width`, `height` directly from the temporary node; copy `z_index` if present
- Populate `embedded_attribute_ids` and `selected_attribute_ids` with the resolved attribute IDs from `CompletedAttributeMapping` entries whose `parentTemporaryNodeId` matches this node
- Add an `EREntityRef` (`{ id: generatePrefixedId('eref'), entity_id: resolvedEntityId }`) to the `entityRefs` array for each node

**Edge conversion logic**
- For each `CompletedEdgeMapping`, generate a native `DiagramEdge` ID with `generatePrefixedId('edge')`
- Set `relationship_id` from `resolvedRelationshipId` and `relationship_type` to `'DATA_ENTITY_RELATIONSHIP'`
- Remap `source_node_id` and `target_node_id` from temporary IDs to native IDs using the temp-to-native node ID map; throw if a mapping is missing
- Flatten `source_label` and `target_label` from the temporary edge into `source_label_text`/`source_label_pos_x`/`source_label_pos_y` and `target_label_text`/`target_label_pos_x`/`target_label_pos_y` (set to `undefined` if the label object is absent)
- Convert each `edge_points` entry to a native `EdgePoint` with a generated ID via `generatePrefixedId('edgept')`, preserving `sequence_order`, `pos_x`, `pos_y`
- Add an `ERRelationshipRef` (`{ id: generatePrefixedId('rref'), relationship_id: resolvedRelationshipId }`) to the `relationshipRefs` array for each edge

**Fully matched auto-finalization derivation**
- Create a function `buildCompletedMappingFromFullMatch` in `diagramFinalizationUtils.ts` that accepts a `DiagramMappingResult` (guaranteed `overallStatus === 'fully_matched'`) and the `TemporaryArchitectureDiagram` and returns a `CompletedDiagramMapping`
- Cast every `matchedEntityId`, `matchedAttributeId`, `matchedRelationshipId` to non-null strings (they are guaranteed non-null when fully_matched)
- Reuse the same output shape as `buildCompletedMapping` from `mappingConfirmationUtils.ts`

**Finalization trigger: fully_matched path**
- In `DiagramsView.tsx`, modify the existing `useEffect` at line 742 that currently has the placeholder comment for `fully_matched`
- When `mappingResult.overallStatus === 'fully_matched'`, call `buildCompletedMappingFromFullMatch` to derive the `CompletedDiagramMapping`, then set it on the state via `setTemporaryDiagramState(prev => ({ ...prev, completedDiagramMapping: derived }))`
- This causes the shared finalization effect (below) to trigger

**Finalization trigger: shared finalization effect**
- Add a new `useEffect` in `DiagramsView.tsx` that watches `temporaryDiagramState.completedDiagramMapping`
- When `completedDiagramMapping` becomes non-null (and `temporaryDiagramState.data` is present), execute the finalization flow inside a try/catch
- Finalization flow: (1) call `buildNativeDiagramFromMapping`, (2) dispatch `ADD_DIAGRAM`, (3) call `handleCloseTemporaryDiagram` to reset temporary state, (4) show success toast
- On error: show error toast, do NOT reset temporary diagram state

**Toast notifications**
- Add `ToastState` (`{ visible, message, type }`) state to `DiagramsView` using the existing pattern from `CreateOrganisationModal`
- On success: `"Diagram '<name>' created successfully"` with type `'success'`
- On error: `"Failed to create diagram: <error message>"` with type `'error'`
- Render the `Toast` component (from `components/common/Toast.tsx`) at the bottom of the `DiagramsView` JSX

**Style passthrough decision**
- Do NOT pass through node `background_color`/`line_color`/`text_color` or edge `line_color`/`line_type`/`line_weight` from temporary styles to native fields -- this falls under "advanced style overrides" which is explicitly out of scope
- Native nodes and edges should use default styling (no color fields set)

**Unit tests for pure conversion functions**
- Create `frontend/src/utils/diagramFinalizationUtils.test.ts`
- Test `buildNativeDiagramFromMapping` with a full happy-path scenario (multiple nodes, edges, attributes) and verify all native fields are correctly populated
- Test node conversion: entity_type derivation for both LOGICAL and PHYSICAL view modes, position/dimension copy, attribute ID population
- Test edge conversion: source/target node ID remapping, label flattening (both present and absent labels), edge point ID generation
- Test `buildCompletedMappingFromFullMatch`: verify all resolved IDs are extracted from a fully_matched `DiagramMappingResult`
- Test error case: missing temp-to-native node mapping for an edge throws an error

## Visual Design
No visual assets were provided for this spec.

## Existing Code to Leverage

**`DiagramSelector.tsx` ADD_DIAGRAM dispatch pattern (lines 52-65)**
- Shows the standard flow for creating a native `Diagram` via `generatePrefixedId('diag')` and dispatching `ADD_DIAGRAM`
- The new finalization flow should follow this same pattern: build a `Diagram` object and dispatch it
- `ADD_DIAGRAM` reducer (line 1908 in `ArchitectureContext.tsx`) automatically sets `selectedDiagramId` to the new diagram, which means no additional navigation logic is needed

**`mappingConfirmationUtils.ts` pure function patterns and output types**
- `CompletedDiagramMapping`, `CompletedNodeMapping`, `CompletedAttributeMapping`, `CompletedEdgeMapping` are the input contracts for the conversion function
- `buildCompletedMapping()` and `initializeSelectionsFromMappingResult()` demonstrate how mapping results translate to resolved IDs and should be referenced for the fully_matched auto-derivation function
- The module's pure-function-only design (no hooks, no DOM) should be replicated in the new `diagramFinalizationUtils.ts`

**`typedContent.ts` ERContent types and factory**
- `EREntityRef` (`{ id, entity_id }`) and `ERRelationshipRef` (`{ id, relationship_id }`) define the typed content entries to populate
- `createDefaultERContent()` returns `{ entityRefs: [], relationshipRefs: [] }` and can be used as a starting point, then populated during conversion

**`Toast.tsx` component and `ToastState` usage pattern**
- Existing `Toast` component with `success`/`error` types, auto-dismiss (5s success, 30s error)
- `ToastState` pattern: `useState<{ visible: boolean; message: string; type: ToastType }>({ visible: false, message: '', type: 'success' })` as used in `CreateOrganisationModal` and `GenerateProjectStandardsModal`

**`DiagramsView.tsx` temporary diagram state management (lines 541-761)**
- `TemporaryDiagramState` interface includes `completedDiagramMapping` field (added in Increment 6)
- `handleCloseTemporaryDiagram` callback (line 755) resets all temporary state and should be called after successful finalization
- The `useEffect` at line 742 with the `fully_matched` placeholder comment is the exact location to add the auto-finalization derivation logic

## Out of Scope
- Groups from the temporary diagram (native `Diagram` has no group concept in this flow)
- Advanced style overrides or custom theming transfer from temporary node/edge styles to native fields
- Non-ER diagram finalization (only ER diagrams are supported)
- Diagram editing workflows post-finalization
- Export or print of finalized diagrams
- Version history or undo/redo for the finalization action
- Automatic architecture-model mutation beyond creating the finalized native diagram in client state
- Auto-save to backend (`saveModelToBackend` must NOT be called; rely on existing manual save)
- Elaborate success animations, confirmation dialogs, or intermediate "Finalize" buttons
- Any changes to the `MappingConfirmationModal` component itself (Increment 6 is complete)

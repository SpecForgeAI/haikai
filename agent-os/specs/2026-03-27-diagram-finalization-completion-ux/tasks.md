# Task Breakdown: Diagram Finalization and Completion UX (Increment 7)

## Overview
Total Tasks: 24
Spec: Convert a confirmed `CompletedDiagramMapping` + `TemporaryArchitectureDiagram` into a native `Diagram`, persist via `ADD_DIAGRAM` dispatch, deactivate temporary diagram mode, and show success/error toast notifications.

## Task List

### Pure Conversion Logic

#### Task Group 1: Core Conversion Functions (`diagramFinalizationUtils.ts`)
**Dependencies:** None

This task group creates the new utility file with all pure conversion functions. These functions have no React dependencies, no hooks, and no side effects -- following the same pattern established by `mappingConfirmationUtils.ts`.

- [x] 1.0 Complete core conversion functions
  - [x] 1.1 Write 6 focused tests for pure conversion functions
    - Create `frontend/src/utils/diagramFinalizationUtils.test.ts`
    - Test 1: `buildNativeDiagramFromMapping` happy path -- multiple nodes, edges, and attributes; verify diagram ID prefix is `'diag'`, `diagram_type` is `'ER'`, `name` and `description` are copied from temporary diagram, `typedContent` envelope has `type: 'ER'`, `version: 1`, and `ERContent` with correct `entityRefs`/`relationshipRefs` counts
    - Test 2: Node conversion with `viewMode === 'LOGICAL'` -- verify `entity_type` is `'LOGICAL_DATA_ENTITY'`, `entity_id` matches `resolvedEntityId`, `render_style` is `'erd'`, `parent_node_id` is `null`, position/dimension fields copied, `z_index` copied when present
    - Test 3: Node conversion with `viewMode === 'PHYSICAL'` -- verify `entity_type` is `'PHYSICAL_DATA_ENTITY'`, `embedded_attribute_ids` and `selected_attribute_ids` populated with resolved attribute IDs from matching `CompletedAttributeMapping` entries
    - Test 4: Edge conversion -- verify `relationship_id` set from `resolvedRelationshipId`, `relationship_type` is `'DATA_ENTITY_RELATIONSHIP'`, `source_node_id` and `target_node_id` remapped to native IDs via the temp-to-native map, edge point IDs generated with `'edgept'` prefix preserving `sequence_order`/`pos_x`/`pos_y`
    - Test 5: Edge label flattening -- verify `source_label` object flattened to `source_label_text`/`source_label_pos_x`/`source_label_pos_y`, and `target_label` to `target_label_text`/`target_label_pos_x`/`target_label_pos_y`; verify absent labels produce `undefined` fields
    - Test 6: Error case -- edge references a temporary node ID not in the temp-to-native map; verify an error is thrown with a descriptive message
  - [x] 1.2 Create `frontend/src/utils/diagramFinalizationUtils.ts` with module header and imports
    - Import `generatePrefixedId` from `utils/idGenerator`
    - Import `Diagram`, `DiagramNode`, `DiagramEdge`, `EdgePoint` from `types/model`
    - Import `TemporaryArchitectureDiagram`, `TemporaryArchitectureDiagramEdge` from `types/temporaryArchitectureDiagram`
    - Import `CompletedDiagramMapping`, `CompletedNodeMapping`, `CompletedAttributeMapping`, `CompletedEdgeMapping` from `utils/mappingConfirmationUtils`
    - Import `TypedContentEnvelope`, `ERContent`, `EREntityRef`, `ERRelationshipRef` from `types/typedContent`
    - Add module doc comment following the `mappingConfirmationUtils.ts` pure-function-only pattern
  - [x] 1.3 Implement node conversion helper
    - Internal function (not exported) or inline within `buildNativeDiagramFromMapping`
    - For each `CompletedNodeMapping`: generate native ID via `generatePrefixedId('node')`, build `Map<string, string>` entry (temp ID -> native ID)
    - Derive `entity_type`: `'LOGICAL_DATA_ENTITY'` when `viewMode === 'LOGICAL'`, `'PHYSICAL_DATA_ENTITY'` when `viewMode === 'PHYSICAL'`
    - Set `entity_id` from `resolvedEntityId`, `render_style` to `'erd'`, `parent_node_id` to `null`
    - Look up the temporary node from `sourceTemporaryDiagram.nodes` by `temporaryNodeId` and copy `pos_x`, `pos_y`, `width`, `height`, `z_index` (if present)
    - Populate `embedded_attribute_ids` and `selected_attribute_ids` by filtering `completedAttributes` where `parentTemporaryNodeId` matches and collecting `resolvedAttributeId` values
    - Build and collect `EREntityRef` (`{ id: generatePrefixedId('eref'), entity_id: resolvedEntityId }`) for each node
  - [x] 1.4 Implement edge conversion helper
    - For each `CompletedEdgeMapping`: generate native ID via `generatePrefixedId('edge')`
    - Look up the temporary edge from `sourceTemporaryDiagram.edges` by `temporaryEdgeId`
    - Set `relationship_id` from `resolvedRelationshipId`, `relationship_type` to `'DATA_ENTITY_RELATIONSHIP'`
    - Remap `source_node_id` and `target_node_id` using the temp-to-native node ID map; throw a descriptive error if a mapping is missing
    - Flatten `source_label`: if present, set `source_label_text`, `source_label_pos_x`, `source_label_pos_y` from the nested object; if absent, leave fields as `undefined`
    - Flatten `target_label` with the same pattern
    - Convert each `edge_points` entry to native `EdgePoint` with `id: generatePrefixedId('edgept')`, preserving `sequence_order`, `pos_x`, `pos_y`
    - Build and collect `ERRelationshipRef` (`{ id: generatePrefixedId('rref'), relationship_id: resolvedRelationshipId }`) for each edge
    - Do NOT copy style fields (`line_color`, `line_type`, `line_weight`) from temporary edge -- out of scope
  - [x] 1.5 Implement top-level `buildNativeDiagramFromMapping` function
    - Export function accepting `(completedMapping: CompletedDiagramMapping, temporaryDiagram: TemporaryArchitectureDiagram)` and returning `Diagram`
    - Generate diagram ID: `generatePrefixedId('diag')`
    - Set `name` from `temporaryDiagram.name`, `description` from `temporaryDiagram.description ?? ''`, `diagram_type` to `'ER'`
    - Call node conversion (1.3) to produce `diagram_nodes`, the temp-to-native ID map, and `entityRefs`
    - Call edge conversion (1.4) to produce `diagram_edges` and `relationshipRefs`
    - Build `typedContent: TypedContentEnvelope` with `{ type: 'ER', version: 1, content: { entityRefs, relationshipRefs } }`
    - Set `decorations: []`, `label_decorations: []`, `settings: {}`
    - Return the assembled `Diagram` object
  - [x] 1.6 Ensure core conversion tests pass
    - Run ONLY the 6 tests in `diagramFinalizationUtils.test.ts`
    - Verify all pass before proceeding

**Acceptance Criteria:**
- All 6 tests in `diagramFinalizationUtils.test.ts` pass
- `buildNativeDiagramFromMapping` produces a valid `Diagram` object with correct `typedContent`, nodes, and edges
- Node entity_type correctly derived from viewMode for both LOGICAL and PHYSICAL
- Edge source/target node IDs correctly remapped; missing mapping throws error
- Labels flattened correctly; absent labels result in undefined fields
- All generated IDs use appropriate prefixes (`diag`, `node`, `edge`, `edgept`, `eref`, `rref`)

---

### Fully Matched Auto-Derivation

#### Task Group 2: `buildCompletedMappingFromFullMatch` Function
**Dependencies:** None (can be developed in parallel with Task Group 1)

This task group creates the pure function that derives a `CompletedDiagramMapping` from a fully_matched `DiagramMappingResult`, enabling auto-finalization without user interaction.

- [x] 2.0 Complete fully matched auto-derivation function
  - [x] 2.1 Write 2 focused tests for `buildCompletedMappingFromFullMatch`
    - Add to `frontend/src/utils/diagramFinalizationUtils.test.ts` (same test file as Task Group 1)
    - Test 1: Given a `DiagramMappingResult` with `overallStatus: 'fully_matched'` containing nodes, attributes, and edges all with non-null matched IDs, verify the returned `CompletedDiagramMapping` has correct `completedNodes` (each with `temporaryNodeId` and `resolvedEntityId`), `completedAttributes` (each with `temporaryItemId`, `parentTemporaryNodeId`, and `resolvedAttributeId`), `completedEdges` (each with `temporaryEdgeId` and `resolvedRelationshipId`), plus `sourceTemporaryDiagram` and `viewMode` set correctly
    - Test 2: Verify array lengths match input lengths (e.g., 3 nodes in -> 3 completedNodes out, 5 attributes in -> 5 completedAttributes out)
  - [x] 2.2 Implement `buildCompletedMappingFromFullMatch` in `diagramFinalizationUtils.ts`
    - Export function accepting `(mappingResult: DiagramMappingResult, temporaryDiagram: TemporaryArchitectureDiagram)` and returning `CompletedDiagramMapping`
    - Import `DiagramMappingResult` from `utils/temporaryDiagramMapping`
    - Map `mappingResult.nodes` to `CompletedNodeMapping[]` by casting `matchedEntityId` to non-null string (guaranteed when fully_matched)
    - Map `mappingResult.attributes` to `CompletedAttributeMapping[]` by casting `matchedAttributeId` to non-null string and including `parentTemporaryNodeId`
    - Map `mappingResult.edges` to `CompletedEdgeMapping[]` by casting `matchedRelationshipId` to non-null string
    - Set `sourceTemporaryDiagram` to the input `temporaryDiagram` and `viewMode` from `temporaryDiagram.view_mode`
    - Output shape must match `CompletedDiagramMapping` from `mappingConfirmationUtils.ts`
  - [x] 2.3 Ensure auto-derivation tests pass
    - Run ONLY the 2 tests added in 2.1
    - Verify all pass

**Acceptance Criteria:**
- Both tests pass
- `buildCompletedMappingFromFullMatch` produces a `CompletedDiagramMapping` identical in shape to what `buildCompletedMapping` from `mappingConfirmationUtils.ts` produces
- All matched IDs are correctly cast to non-null strings
- `sourceTemporaryDiagram` and `viewMode` are set correctly

---

### DiagramsView Integration

#### Task Group 3: Finalization Triggers and Toast UX in `DiagramsView.tsx`
**Dependencies:** Task Groups 1 and 2

This task group wires the pure conversion functions into the React component, adding the two finalization trigger paths (fully_matched auto-trigger and post-modal auto-trigger), the shared finalization effect, and toast notifications.

- [x] 3.0 Complete DiagramsView finalization integration
  - [x] 3.1 Write 4 focused tests for finalization integration
    - Create `frontend/src/utils/diagramFinalizationUtils.integration.test.ts` or add to existing test file
    - Test 1: Verify that when `temporaryDiagramState.mappingResult.overallStatus === 'fully_matched'`, the existing `useEffect` at line 742 calls `buildCompletedMappingFromFullMatch` and sets `completedDiagramMapping` on the state (test the logic path, not the React effect directly -- can be tested via the pure function call chain)
    - Test 2: Verify `buildNativeDiagramFromMapping` is called with correct args when `completedDiagramMapping` is non-null and `data` is present (verify the assembled Diagram object is correct for dispatch)
    - Test 3: Verify error handling -- when `buildNativeDiagramFromMapping` throws, the temporary diagram state is NOT reset (error recovery: keep temporary diagram intact)
    - Test 4: Verify toast message format -- success: `"Diagram '<name>' created successfully"`, error: `"Failed to create diagram: <error message>"`
  - [x] 3.2 Add Toast state to `DiagramsView.tsx`
    - Import `Toast` from `components/common/Toast` and `ToastType` from same module
    - Add state: `const [toastState, setToastState] = useState<{ visible: boolean; message: string; type: ToastType }>({ visible: false, message: '', type: 'success' })`
    - Add dismiss handler: `const handleDismissToast = useCallback(() => setToastState(prev => ({ ...prev, visible: false })), [])`
    - Render `<Toast visible={toastState.visible} message={toastState.message} type={toastState.type} onDismiss={handleDismissToast} />` at the bottom of the DiagramsView JSX return
  - [x] 3.3 Implement fully_matched auto-finalization trigger
    - In the existing `useEffect` at line 742 (the one with the `// If fully_matched: do not open modal; future increments will proceed downstream` comment)
    - Import `buildCompletedMappingFromFullMatch` from `utils/diagramFinalizationUtils`
    - Add an `else if (mappingResult.overallStatus === 'fully_matched')` branch after the partially_matched/no_matches check
    - In that branch: call `const derived = buildCompletedMappingFromFullMatch(mappingResult, temporaryDiagramState.data!)` and then `setTemporaryDiagramState(prev => ({ ...prev, completedDiagramMapping: derived }))`
    - Guard: only proceed if `temporaryDiagramState.data` is non-null
  - [x] 3.4 Implement shared finalization effect
    - Add a new `React.useEffect` in `DiagramsView.tsx` that watches `temporaryDiagramState.completedDiagramMapping`
    - Guard: return early if `completedDiagramMapping` is null or `temporaryDiagramState.data` is null
    - Import `buildNativeDiagramFromMapping` from `utils/diagramFinalizationUtils`
    - Inside a try/catch block:
      - Call `const nativeDiagram = buildNativeDiagramFromMapping(temporaryDiagramState.completedDiagramMapping, temporaryDiagramState.data)`
      - Dispatch `dispatch({ type: 'ADD_DIAGRAM', payload: nativeDiagram })`
      - Call `handleCloseTemporaryDiagram()` to reset temporary state
      - Set success toast: `setToastState({ visible: true, message: \`Diagram '${nativeDiagram.name}' created successfully\`, type: 'success' })`
    - In the catch block:
      - Set error toast: `setToastState({ visible: true, message: \`Failed to create diagram: ${err instanceof Error ? err.message : String(err)}\`, type: 'error' })`
      - Do NOT call `handleCloseTemporaryDiagram` -- keep temporary diagram intact for retry
    - Dependency array: `[temporaryDiagramState.completedDiagramMapping, temporaryDiagramState.data, dispatch, handleCloseTemporaryDiagram]`
  - [x] 3.5 Verify the post-modal auto-finalization path works
    - The `MappingConfirmationModal` (Increment 6) already sets `completedDiagramMapping` on the state when the user clicks Confirm
    - The new shared finalization effect (3.4) will automatically trigger when `completedDiagramMapping` becomes non-null after the modal closes
    - Verify that no additional code changes are needed in the modal callback -- the existing `onConfirm` handler in DiagramsView that calls `setTemporaryDiagramState(prev => ({ ...prev, completedDiagramMapping }))` should be sufficient
  - [x] 3.6 Ensure integration tests pass
    - Run ONLY the 4 tests written in 3.1 plus the 8 tests from Task Groups 1-2
    - Verify all pass

**Acceptance Criteria:**
- All 4 integration tests pass
- Fully_matched diagrams auto-finalize immediately (no modal, no extra clicks)
- Post-modal confirmation auto-finalizes via the shared React effect
- `ADD_DIAGRAM` dispatch creates the native diagram and sets `selectedDiagramId` automatically
- Temporary diagram mode deactivates after successful finalization
- Success toast shows: "Diagram '<name>' created successfully"
- Error toast shows: "Failed to create diagram: <error message>"
- Temporary diagram state is preserved on error (retry capability)

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 6 tests written in Task 1.1 (core conversion functions) in `frontend/src/utils/diagramFinalizationUtils.test.ts`
    - Review the 2 tests written in Task 2.1 (auto-derivation function) in `frontend/src/utils/diagramFinalizationUtils.test.ts`
    - Review the 4 tests written in Task 3.1 (integration) in `frontend/src/utils/diagramFinalizationUtils.integration.test.ts`
    - Total existing tests: 12 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify critical workflows that lack test coverage, specifically:
      - The complete end-to-end flow from fully_matched -> derived CompletedDiagramMapping -> native Diagram -> ADD_DIAGRAM dispatch
      - The complete end-to-end flow from post-modal CompletedDiagramMapping -> native Diagram -> ADD_DIAGRAM dispatch
      - Edge cases in the conversion that could silently produce incorrect data
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
  - [x] 4.3 Write up to 6 additional strategic tests maximum
    - Possible gap-filling tests (write only those that address actual gaps found in 4.2):
      - Test: `buildNativeDiagramFromMapping` with zero edges (nodes-only diagram) produces valid Diagram with empty `diagram_edges` and empty `relationshipRefs`
      - Test: `buildNativeDiagramFromMapping` with zero attributes (no compartments) produces nodes with empty `embedded_attribute_ids` and `selected_attribute_ids`
      - Test: `buildNativeDiagramFromMapping` with missing temporary node for a CompletedNodeMapping (handles gracefully or throws clear error)
      - Test: `buildCompletedMappingFromFullMatch` preserves `parentTemporaryNodeId` from the mapping result's attribute records
      - Test: Edge conversion with multiple edge points verifies all points get unique IDs and correct field copies
      - Test: `description` defaults to `''` when `temporaryDiagram.description` is `undefined`
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests in `frontend/src/utils/diagramFinalizationUtils.test.ts` and `frontend/src/utils/diagramFinalizationUtils.integration.test.ts`
    - Expected total: approximately 12-18 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 12-18 tests total)
- Critical conversion workflows are covered (happy path, edge cases, error handling)
- No more than 6 additional tests added beyond what Task Groups 1-3 wrote
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:

1. **Task Group 1** (Core Conversion Functions) and **Task Group 2** (Auto-Derivation Function) -- **in parallel**
   - Both are pure functions in the same utility file with no React dependencies
   - Task Group 1 builds `buildNativeDiagramFromMapping` (node/edge conversion)
   - Task Group 2 builds `buildCompletedMappingFromFullMatch` (mapping derivation)
   - They share `diagramFinalizationUtils.ts` but operate on independent function signatures
2. **Task Group 3** (DiagramsView Integration) -- after Task Groups 1 and 2
   - Depends on both exported functions from `diagramFinalizationUtils.ts`
   - Wires the pure functions into React effects and adds Toast UX
3. **Task Group 4** (Test Review and Gap Analysis) -- after Task Groups 1-3
   - Reviews all tests, identifies gaps, and fills them

## Key Files

| File | Action | Purpose |
|------|--------|---------|
| `frontend/src/utils/diagramFinalizationUtils.ts` | CREATE | Pure conversion functions |
| `frontend/src/utils/diagramFinalizationUtils.test.ts` | CREATE | Unit tests for pure functions |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | MODIFY | Add finalization triggers + Toast |
| `frontend/src/utils/diagramFinalizationUtils.integration.test.ts` | CREATE (optional) | Integration tests if needed |

## Dependencies Map

```
Task Group 1 ──┐
               ├──> Task Group 3 ──> Task Group 4
Task Group 2 ──┘
```

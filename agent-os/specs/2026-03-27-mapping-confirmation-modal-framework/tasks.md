# Task Breakdown: Mapping Confirmation Modal Framework (Increment 6)

## Overview
Total Tasks: 34
Pure frontend feature -- React/TypeScript, CSS Modules, Vitest. No backend or API changes.

## Task List

### Types & Candidate Utilities Layer

#### Task Group 1: Output Types and Candidate-Building Pure Functions
**Dependencies:** None

This group defines the `CompletedDiagramMapping` output contract and the pure utility functions that produce candidate lists for entity, attribute, and relationship dropdowns. All functions are pure (no hooks, no DOM), making them trivially testable in isolation.

- [x] 1.0 Complete output types and candidate utilities
  - [x] 1.1 Write 6 focused tests for output types and candidate utilities
    - Test `buildEntityCandidates` returns logical entities for LOGICAL viewMode and physical entities for PHYSICAL viewMode
    - Test `buildAttributeCandidates` returns only attributes belonging to the specified parentEntityId (filtered by `logical_entity_id` or `physical_entity_id`)
    - Test `buildAttributeCandidates` returns empty array when parentEntityId is empty string or does not match any entity
    - Test `buildRelationshipCandidates` returns matching relationships when source/target entity IDs produce a valid canonical DEP ID key (reuse `generateDataEntityPointId` + sorted join)
    - Test `buildRelationshipCandidates` returns empty array when no relationship connects the given entity pair
    - Test `buildRelationshipCandidates` returns empty array when either entityId is empty string
  - [x] 1.2 Define `CompletedDiagramMapping` and related interfaces
    - Create file `frontend/src/utils/mappingConfirmationTypes.ts`
    - `CompletedNodeMapping`: `{ temporaryNodeId: string; resolvedEntityId: string }`
    - `CompletedAttributeMapping`: `{ temporaryItemId: string; parentTemporaryNodeId: string; resolvedAttributeId: string }`
    - `CompletedEdgeMapping`: `{ temporaryEdgeId: string; resolvedRelationshipId: string }`
    - `CompletedDiagramMapping`: `{ completedNodes: CompletedNodeMapping[]; completedAttributes: CompletedAttributeMapping[]; completedEdges: CompletedEdgeMapping[]; sourceTemporaryDiagram: TemporaryArchitectureDiagram; viewMode: string }`
    - All resolved ID fields are `string` (guaranteed non-null), not `string | null`
  - [x] 1.3 Implement `buildEntityCandidates(metaModel, viewMode)` utility
    - Create file `frontend/src/utils/mappingCandidateUtils.ts`
    - Returns `Array<{ id: string; name: string }>` from `metaModel.entities.logical_data_entities` when viewMode is `'LOGICAL'`, or from `metaModel.entities.physical_data_entities` when `'PHYSICAL'`
    - Defensive: return empty array for null/undefined collections or unrecognized viewMode
  - [x] 1.4 Implement `buildAttributeCandidates(metaModel, viewMode, parentEntityId)` utility
    - Returns `Array<{ id: string; name: string }>` filtered by `logical_entity_id` (LOGICAL) or `physical_entity_id` (PHYSICAL)
    - Return empty array when `parentEntityId` is empty string
    - Reuses the same filtering logic as `buildAttributeIndex` from `temporaryDiagramMapping.ts`, but returns a flat array instead of a nested Map
  - [x] 1.5 Implement `buildRelationshipCandidates(metaModel, sourceEntityId, targetEntityId, viewMode)` utility
    - Returns `Array<{ id: string; label: string }>` where label includes cardinality and relationship type for disambiguation (e.g., "One to Many - Association")
    - Constructs DEP IDs via `generateDataEntityPointId(entityType, entityId)` from `dataEntityPointOptions.ts`
    - Builds canonical key by sorting the two DEP IDs and joining with `'|'`
    - Looks up `metaModel.relationships.logical_data_entity_relationships` using the canonical key approach from `buildRelationshipIndex`
    - Returns empty array when either entityId is empty string
  - [x] 1.6 Ensure candidate utility tests pass
    - Run ONLY the 6 tests written in 1.1
    - Verify all pure functions return correct results for LOGICAL and PHYSICAL viewModes

**Acceptance Criteria:**
- `CompletedDiagramMapping` type is exported and importable
- All three `build*Candidates` functions are pure, exported, and pass their tests
- Candidate functions correctly handle empty/missing meta-model collections
- Relationship candidate labels include cardinality and relationship type for user disambiguation

---

### State Management & Cascade Logic

#### Task Group 2: Editable Selections State and Cascade Logic
**Dependencies:** Task Group 1

This group implements the editable selections state management and the cascade logic that resets/revalidates downstream selections when an entity changes. These are also pure functions (cascade handlers) plus a state initialization function, testable without rendering React components.

- [x] 2.0 Complete editable selections state and cascade logic
  - [x] 2.1 Write 7 focused tests for state initialization and cascade behavior
    - Test `initializeSelectionsFromMappingResult` correctly pre-populates matched entities and leaves unmatched as empty string
    - Test `initializeSelectionsFromMappingResult` correctly pre-populates matched attributes and edges
    - Test entity cascade: changing an entity selection resets all child attribute selections for that node to empty string
    - Test entity cascade: after reset, attributes whose `ref_name` exactly matches an attribute name in the new entity are auto-revalidated (pre-selected)
    - Test entity cascade: changing an entity selection triggers relationship re-evaluation for all edges connected to that node
    - Test relationship re-evaluation: when both endpoint entities are selected, the edge selection is preserved if it still appears in the new candidate list, otherwise reset to empty string
    - Test relationship re-evaluation: when one endpoint entity is unselected (empty), the edge selection is reset to empty string
  - [x] 2.2 Implement `initializeSelectionsFromMappingResult` function
    - Create within `frontend/src/utils/mappingConfirmationState.ts`
    - Input: `DiagramMappingResult`
    - Output: `{ entitySelections: Record<string, string>; attributeSelections: Record<string, string>; edgeSelections: Record<string, string> }`
    - For each `NodeMappingRecord`: key is `temporaryNodeId`, value is `matchedEntityId ?? ''`
    - For each `AttributeMappingRecord`: key is `temporaryItemId`, value is `matchedAttributeId ?? ''`
    - For each `EdgeMappingRecord`: key is `temporaryEdgeId`, value is `matchedRelationshipId ?? ''`
  - [x] 2.3 Implement `cascadeEntityChange` function
    - Input: `changedNodeId`, `newEntityId`, current `attributeSelections`, current `edgeSelections`, `temporaryDiagram` (for edge source/target lookup), `metaModel`, `viewMode`, `mappingResult` (for attribute parentTemporaryNodeId lookup)
    - Step 1: Identify all `AttributeMappingRecord` entries with `parentTemporaryNodeId === changedNodeId`; reset their `attributeSelections` values to `''`
    - Step 2: If `newEntityId` is non-empty, run same-name revalidation: for each reset attribute, look up the attribute's `ref_name` from the temporary diagram, call `buildAttributeCandidates`, and if an exact name match exists, pre-select it
    - Step 3: Identify all edges where `source_node_id === changedNodeId` or `target_node_id === changedNodeId`
    - Step 4: For each affected edge, look up the other endpoint's current entity selection; if both endpoints have non-empty entity selections, call `buildRelationshipCandidates` to get the new candidate list; if current edge selection is in the candidate list, preserve it; otherwise reset to `''`; if either endpoint is empty, reset edge selection to `''`
    - Returns new `{ attributeSelections, edgeSelections }` (entity selection is handled by the caller)
  - [x] 2.4 Implement validation computation function `computeValidationState`
    - Input: `entitySelections`, `attributeSelections`, `edgeSelections`
    - Returns `{ isAllResolved: boolean; resolvedCount: number; totalCount: number }`
    - `isAllResolved` is `true` only when every value across all three Records is non-empty string
    - `resolvedCount` and `totalCount` drive the "X of Y resolved" summary display
  - [x] 2.5 Implement `buildCompletedMapping` function
    - Input: `entitySelections`, `attributeSelections`, `edgeSelections`, `temporaryDiagram`, `viewMode`, `mappingResult` (for parentTemporaryNodeId on attributes)
    - Output: `CompletedDiagramMapping`
    - Only callable when `isAllResolved` is `true` (all selections non-empty)
    - Maps each selection Record entry into the corresponding `Completed*Mapping` with guaranteed non-null resolved IDs
    - Attaches `sourceTemporaryDiagram` and `viewMode`
  - [x] 2.6 Ensure state management and cascade tests pass
    - Run ONLY the 7 tests written in 2.1
    - Verify initialization, cascade, validation, and output builder all behave correctly

**Acceptance Criteria:**
- Selections initialize correctly from auto-mapped results
- Entity change cascades correctly to attributes (reset + same-name revalidation) and edges (re-evaluation)
- Validation correctly computes resolved/total counts and all-resolved gate
- `buildCompletedMapping` produces a well-formed `CompletedDiagramMapping` with all non-null IDs

---

### Modal UI Component

#### Task Group 3: MappingConfirmationModal Component and Styles
**Dependencies:** Task Groups 1, 2

This group builds the standalone React modal component with its CSS Module. It consumes the candidate utilities from Task Group 1 and the state/cascade logic from Task Group 2.

- [x] 3.0 Complete modal UI component
  - [x] 3.1 Write 6 focused tests for the modal component
    - Test modal renders when `isOpen` is true and does not render when false
    - Test entity section: each `NodeMappingRecord` renders a row with `ref_name` label, status badge ("Auto" or "Unresolved"), and a `<select>` pre-populated with entity candidates
    - Test attribute section: attribute dropdowns are disabled when parent entity selection is empty; enabled when parent has a selection
    - Test entity cascade in component: changing an entity select triggers attribute dropdown rebuild (verify attribute dropdown options change)
    - Test confirm button is disabled when any selection is empty; enabled when all selections are non-empty
    - Test `onConfirm` callback receives a `CompletedDiagramMapping` when Confirm is clicked with all selections resolved
  - [x] 3.2 Create CSS Module `MappingConfirmationModal.module.css`
    - File: `frontend/src/components/DiagramsView/MappingConfirmationModal.module.css`
    - Replicate overlay/modal/header/content/footer structure from `LogicalErCreateModal.module.css`
    - Set `max-width: 900px` on `.modal` to accommodate wider three-column table rows
    - Add `.section` styling for Entities, Attributes, Relationships sections (reuse section pattern from LogicalErCreateModal)
    - Add `.mappingRow` for three-column layout: temporary name, status badge, select dropdown
    - Add `.statusBadge` with `.auto` (green-ish) and `.unresolved` (amber/orange) variants
    - Add `.disabledHint` for the "Select parent entity first" message on disabled attribute/edge rows
    - Add `.warningRow` for `mode_mismatch` non-editable rows
    - Add `.summaryBar` for the "X of Y resolved" indicator in header or footer
    - Reuse `.select`, `.primaryButton`, `.secondaryButton`, `.closeButton` patterns from LogicalErCreateModal.module.css
  - [x] 3.3 Create `MappingConfirmationModal` component scaffold
    - File: `frontend/src/components/DiagramsView/MappingConfirmationModal.tsx`
    - Props: `isOpen: boolean`, `onClose: () => void`, `onConfirm: (completed: CompletedDiagramMapping) => void`, `mappingResult: DiagramMappingResult`, `temporaryDiagram: TemporaryArchitectureDiagram`, `metaModel: MetaModel`
    - Guard: return `null` when `!isOpen`
    - Overlay with click-to-close (click on overlay background calls `onClose`)
    - Escape key handling via `useEffect` document keydown listener
    - Header: title "Confirm Diagram Mappings", close button, summary status ("X of Y resolved")
    - Footer: Cancel button (calls `onClose`), Confirm button (disabled until all resolved, calls `onConfirm` with `CompletedDiagramMapping`)
  - [x] 3.4 Implement entity mappings section
    - Extract `viewMode` from `temporaryDiagram.view_mode`
    - Build entity candidates via `buildEntityCandidates(metaModel, viewMode)` in a `useMemo`
    - For each `NodeMappingRecord` in `mappingResult.nodes`:
      - Look up the corresponding node in `temporaryDiagram.nodes` by `temporaryNodeId` to get `ref_name` / `display_name`
      - If `reasonCode === 'mode_mismatch'`, render a non-editable warning row with explanation text instead of a dropdown
      - Otherwise render: temporary name label, status badge ("Auto" if `status === 'matched'`, "Unresolved" if `status === 'unmatched'`), and a `<select>` dropdown with entity candidates
      - Pre-select to current `entitySelections[temporaryNodeId]`
      - Include `<option value="">-- Select Entity --</option>` placeholder
    - On change: update `entitySelections`, then call `cascadeEntityChange` to get new `attributeSelections` and `edgeSelections`; apply all three state updates
  - [x] 3.5 Implement attribute mappings section
    - Group `AttributeMappingRecord` entries by `parentTemporaryNodeId`
    - Render a sub-heading for each parent node (using the node's `ref_name`)
    - For each attribute record under a node:
      - Look up the compartment item in `temporaryDiagram.nodes` -> `compartments` -> `items` by `temporaryItemId` to get `ref_name` / `display_name`
      - Build attribute candidates via `buildAttributeCandidates(metaModel, viewMode, entitySelections[parentTemporaryNodeId])` in a `useMemo` keyed on the parent entity selection
      - If parent entity selection is empty: render a disabled `<select>` with hint message "Select parent entity first"
      - Otherwise render: temporary name label, status badge, and a `<select>` with attribute candidates
      - Pre-select to current `attributeSelections[temporaryItemId]`
    - On change: update only `attributeSelections` (no further cascades)
  - [x] 3.6 Implement relationship mappings section
    - For each `EdgeMappingRecord` in `mappingResult.edges`:
      - Look up the edge in `temporaryDiagram.edges` by `temporaryEdgeId` to get `source_ref_name` and `target_ref_name`
      - Determine source/target node IDs from the edge's `source_node_id` / `target_node_id`
      - Build relationship candidates via `buildRelationshipCandidates(metaModel, entitySelections[sourceNodeId], entitySelections[targetNodeId], viewMode)` in a `useMemo`
      - If either endpoint entity selection is empty: render a disabled `<select>` with hint message "Select both endpoint entities first"
      - Otherwise render: source/target ref_name labels, status badge, and a `<select>` with relationship candidates (options show cardinality + relationship type)
      - Pre-select to current `edgeSelections[temporaryEdgeId]`
    - On change: update only `edgeSelections`
  - [x] 3.7 Wire validation, confirm gating, and summary display
    - Compute validation via `useMemo` calling `computeValidationState(entitySelections, attributeSelections, edgeSelections)`
    - Display summary in header or footer: "X of Y resolved" with reactive update
    - Disable Confirm button when `!isAllResolved`
    - On Confirm click: call `buildCompletedMapping(...)` and pass result to `onConfirm`
  - [x] 3.8 Handle metaModel null edge case and empty collections
    - If `metaModel` is null at render time (should not happen given prop typing, but defensive): show disabled state with "Meta-model not available" message
    - If entity/attribute/relationship candidate lists are empty after filtering: show empty `<select>` with a single `<option>` reading "No candidates available"
  - [x] 3.9 Ensure modal component tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify rendering, interaction, cascade, validation gating, and confirm callback

**Acceptance Criteria:**
- Modal renders three sections (Entities, Attributes, Relationships) with correct data
- Auto-matched items show "Auto" badge and are pre-selected but editable
- Unresolved items show "Unresolved" badge and start with empty selection
- Entity change cascades to attribute reset/revalidation and edge re-evaluation within the modal
- Attribute/relationship dropdowns are disabled with hint when parent entity is not selected
- Confirm button is disabled until all selections are non-empty
- Summary status updates reactively as user resolves items
- `onConfirm` delivers a well-formed `CompletedDiagramMapping`
- `mode_mismatch` rows render as non-editable warnings
- CSS Module follows existing codebase visual language at 900px max-width

---

### DiagramsView Integration

#### Task Group 4: DiagramsView Integration and Modal Trigger
**Dependencies:** Task Group 3

This group wires the modal into `DiagramsView.tsx` -- adding trigger logic, state, and callback handlers.

- [x] 4.0 Complete DiagramsView integration
  - [x] 4.1 Write 4 focused tests for DiagramsView integration
    - Test modal does NOT open when `mappingResult.overallStatus` is `'fully_matched'`
    - Test modal opens automatically when `mappingResult.overallStatus` is `'partially_matched'`
    - Test modal opens automatically when `mappingResult.overallStatus` is `'no_matches'`
    - Test modal only opens once per mapping result (re-render does not re-trigger the modal)
  - [x] 4.2 Add modal state and open-once guard to DiagramsView
    - Add `showMappingConfirmationModal` boolean state, initialized to `false`
    - Add `completedDiagramMapping` state of type `CompletedDiagramMapping | null`, initialized to `null`
    - Add a ref (`mappingResultHandledRef`) to track whether the current mapping result has already been evaluated for modal opening; prevents re-opening on re-renders
    - Reset the ref and `completedDiagramMapping` when `temporaryDiagramState` is deactivated or a new temporary diagram is loaded
  - [x] 4.3 Implement trigger logic after mapping result is set
    - In the `.then()` callback of the temporary diagram fetch (around line 715), or in a `useEffect` that watches `temporaryDiagramState.mappingResult`:
      - If `mappingResult` is non-null, `mappingResultHandledRef.current` is false, and `overallStatus` is `'partially_matched'` or `'no_matches'`: set `showMappingConfirmationModal = true` and mark the ref as handled
      - If `overallStatus` is `'fully_matched'`: do NOT open the modal; mark ref as handled; future increments will proceed directly downstream
  - [x] 4.4 Render `MappingConfirmationModal` conditionally and wire callbacks
    - Render `<MappingConfirmationModal>` in the DiagramsView JSX, conditionally on `showMappingConfirmationModal`
    - Pass props: `isOpen={showMappingConfirmationModal}`, `onClose` (sets `showMappingConfirmationModal = false`), `onConfirm` (receives `CompletedDiagramMapping`, stores it on `completedDiagramMapping` state, closes modal), `mappingResult={temporaryDiagramState.mappingResult!}`, `temporaryDiagram={temporaryDiagramState.data!}`, `metaModel={state.model.metaModel!}`
    - `onCancel`/`onClose`: closes modal, user returns to temporary diagram preview; does NOT exit temporary diagram mode
    - `onConfirm`: stores `CompletedDiagramMapping` for future Increment 7 consumption and closes modal
  - [x] 4.5 Ensure DiagramsView integration tests pass
    - Run ONLY the 4 tests written in 4.1
    - Verify trigger logic, open-once guard, and callback behavior

**Acceptance Criteria:**
- Modal auto-opens for `partially_matched` and `no_matches` results
- Modal does NOT open for `fully_matched` results
- Modal opens at most once per mapping result (no re-trigger on re-render)
- `onConfirm` stores the `CompletedDiagramMapping` on DiagramsView state for future increments
- `onCancel` closes modal without exiting temporary diagram mode
- `completedDiagramMapping` state resets when temporary diagram mode is deactivated or a new diagram loads

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 6 tests written in Task 1.1 (candidate utilities)
    - Review the 7 tests written in Task 2.1 (state/cascade logic)
    - Review the 6 tests written in Task 3.1 (modal component)
    - Review the 4 tests written in Task 4.1 (DiagramsView integration)
    - Total existing tests: 23
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to the mapping confirmation modal feature
    - Prioritize end-to-end workflows over unit test gaps
    - Do NOT assess entire application test coverage
  - [x] 5.3 Write up to 8 additional strategic tests maximum to fill critical gaps
    - Potential gap areas (write tests only where coverage is genuinely missing):
      - Full cascade chain: entity change -> attribute revalidation finds exact name match -> relationship re-evaluation preserves valid selection (end-to-end cascade)
      - Overlay click-to-close and Escape key close the modal
      - `mode_mismatch` node rows are non-editable in the modal
      - Empty meta-model collections: dropdowns show "No candidates available"
      - PHYSICAL viewMode path through candidate utilities (if only LOGICAL was tested in Task Group 1)
      - `buildCompletedMapping` produces correct output structure matching `CompletedDiagramMapping` interface
      - Attribute dropdown disables and re-enables as parent entity is selected/cleared
      - Confirm callback is not called when button is disabled (clicking a disabled button)
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 23-31 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 23-31 tests total)
- Critical user workflows for this feature are covered (candidate building, cascade, modal interaction, integration trigger)
- No more than 8 additional tests added when filling in gaps
- Testing focused exclusively on the mapping confirmation modal feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Output Types and Candidate Utilities** -- pure functions with no dependencies; establishes the foundation types and candidate-building logic
2. **Task Group 2: Editable Selections State and Cascade Logic** -- depends on candidate utilities from Group 1; pure state management functions
3. **Task Group 3: MappingConfirmationModal Component** -- depends on Groups 1 and 2; the main UI implementation
4. **Task Group 4: DiagramsView Integration** -- depends on Group 3; wires the modal into the existing application
5. **Task Group 5: Test Review and Gap Analysis** -- depends on Groups 1-4; reviews all tests and fills critical coverage gaps

## Key File Locations

| Purpose | Path |
|---------|------|
| Output types | `frontend/src/utils/mappingConfirmationTypes.ts` (new) |
| Candidate utilities | `frontend/src/utils/mappingCandidateUtils.ts` (new) |
| State/cascade logic | `frontend/src/utils/mappingConfirmationState.ts` (new) |
| Modal component | `frontend/src/components/DiagramsView/MappingConfirmationModal.tsx` (new) |
| Modal styles | `frontend/src/components/DiagramsView/MappingConfirmationModal.module.css` (new) |
| Integration point | `frontend/src/components/DiagramsView/DiagramsView.tsx` (modified) |
| Existing mapping engine | `frontend/src/utils/temporaryDiagramMapping.ts` (read-only reference) |
| DEP ID utilities | `frontend/src/utils/dataEntityPointOptions.ts` (imported, not modified) |
| Modal pattern reference | `frontend/src/components/DiagramsView/ER/LogicalErCreateModal.tsx` (read-only reference) |
| CSS pattern reference | `frontend/src/components/DiagramsView/ER/LogicalErCreateModal.module.css` (read-only reference) |

## Testing Notes

- All tests use **Vitest** (not Jest) -- the frontend uses Vitest as its test runner
- Test files should be co-located: `mappingCandidateUtils.test.ts`, `mappingConfirmationState.test.ts`, `MappingConfirmationModal.test.tsx`, and integration tests alongside DiagramsView
- Component tests should use `@testing-library/react` for rendering and interaction
- Pure utility tests do not need React rendering -- direct function calls with assertions

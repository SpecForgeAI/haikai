# Specification: Mapping Confirmation Modal Framework

## Goal
Build a standalone confirmation modal that auto-opens when deterministic auto-mapping (Increment 5) produces a `partially_matched` or `no_matches` result, allowing users to manually resolve unresolved mappings and override auto-matched items via dropdown selects before producing a fully-resolved `CompletedDiagramMapping` output.

## User Stories
- As a user reviewing an LLM-generated temporary diagram, I want to manually resolve unresolved entity/attribute/relationship mappings so that every element maps to a real architecture meta-model element before conversion.
- As a user reviewing an LLM-generated temporary diagram, I want to override auto-matched mappings when the deterministic engine chose incorrectly so that the final diagram accurately reflects my intent.

## Specific Requirements

**Modal trigger logic**
- Auto-open the modal when `temporaryDiagramState.mappingResult.overallStatus` is `'partially_matched'` or `'no_matches'`
- Skip the modal entirely for `'fully_matched'` and proceed directly downstream
- Trigger check runs in `DiagramsView.tsx` after `setTemporaryDiagramState` sets both `data` and `mappingResult` (around line 715)
- The modal should only open once per mapping result; guard with a ref or state flag to prevent re-opening on re-renders

**CompletedDiagramMapping output type**
- Define a `CompletedDiagramMapping` interface exported from a new types file or from `temporaryDiagramMapping.ts`
- Contains `completedNodes: CompletedNodeMapping[]`, `completedAttributes: CompletedAttributeMapping[]`, `completedEdges: CompletedEdgeMapping[]`
- Each completed record has the same temporary-diagram IDs as the input record but with `resolvedEntityId: string`, `resolvedAttributeId: string`, or `resolvedRelationshipId: string` guaranteed non-null
- Include a `sourceTemporaryDiagram: TemporaryArchitectureDiagram` reference and the `viewMode` used
- The `onConfirm` callback prop receives this `CompletedDiagramMapping`; the `onCancel` callback receives nothing

**Modal component architecture**
- Build a standalone `MappingConfirmationModal` component with its own CSS Module, following the `LogicalErCreateModal` overlay/modal/header/content/footer pattern
- Use wider max-width (~900px) to accommodate three-column table rows (temporary name, status badge, select dropdown)
- Props: `isOpen`, `onClose`, `onConfirm(completed: CompletedDiagramMapping)`, `mappingResult: DiagramMappingResult`, `temporaryDiagram: TemporaryArchitectureDiagram`, `metaModel: MetaModel`
- Overlay click-to-close, Escape key handling, scroll within the content area
- Internal state managed with `useState`/`useMemo`/`useCallback`; no new React context needed

**Entity mappings section**
- Render one row per `NodeMappingRecord` showing the node's `ref_name` / `display_name` from the `TemporaryArchitectureDiagram`
- Each row has a `<select>` dropdown populated with all entities from the mode-appropriate meta-model collection: `logical_data_entities` when `view_mode === 'LOGICAL'`, `physical_data_entities` when `view_mode === 'PHYSICAL'`
- Pre-select to `matchedEntityId` for auto-matched rows; show a visual badge (e.g., "Auto" pill) for auto-matched items vs "Unresolved" for unmatched
- Rows are always editable regardless of auto-match status, enabling user overrides
- Include a `-- Select Entity --` placeholder option with empty string value

**Attribute mappings section**
- Render one row per `AttributeMappingRecord`, grouped visually under their parent node
- Each row has a `<select>` dropdown populated with attributes belonging to the currently selected parent entity only: filter `logical_data_attributes` by `logical_entity_id` or `physical_data_attributes` by `physical_entity_id`
- When the parent entity selection changes, reset all child attribute selections to empty, rebuild the candidate list from the new entity's attributes, then auto-revalidate by name: if an attribute's `ref_name` exactly matches an attribute name in the new entity, pre-select it
- The revalidation logic should reuse the exact-match-by-name pattern from `mapAttributes` in `temporaryDiagramMapping.ts`
- If the parent node has no entity selected yet, the attribute dropdown should be disabled with a hint message

**Relationship mappings section**
- Render one row per `EdgeMappingRecord` showing source/target `ref_name` labels from the `TemporaryArchitectureDiagram` edges
- Each row has a `<select>` dropdown populated with relationships from the meta-model that connect the currently selected source and target entities
- Build relationship candidates using the same canonical DEP ID key approach as `buildRelationshipIndex` and `mapRelationships`: construct DEP IDs from selected entity IDs via `generateDataEntityPointId`, sort to form the canonical key, and look up matching `LogicalDataEntityRelationship` entries
- When either endpoint entity selection changes, automatically re-evaluate: rebuild the candidate list and either preserve the selection if still valid or reset to empty
- If either endpoint node has no entity selected, the relationship dropdown should be disabled with a hint message
- Display relationship details in the dropdown option labels (e.g., cardinality, relationship type) to help users distinguish candidates

**Candidate list building utilities**
- Create pure utility functions (no hooks) for building candidate lists, co-located with or near `temporaryDiagramMapping.ts`
- `buildEntityCandidates(metaModel, viewMode)` returns `Array<{id, name}>` from the appropriate entity collection
- `buildAttributeCandidates(metaModel, viewMode, parentEntityId)` returns `Array<{id, name}>` filtered by parent entity
- `buildRelationshipCandidates(metaModel, sourceEntityId, targetEntityId, viewMode)` returns `Array<{id, label}>` using DEP ID canonical key lookup
- These functions reuse `buildEntityNameIndex`, `buildAttributeIndex`, `buildRelationshipIndex`, `generateDataEntityPointId` from existing code

**Validation and confirm gating**
- The Confirm button is disabled until every `NodeMappingRecord`, `AttributeMappingRecord`, and `EdgeMappingRecord` has a non-empty selected value
- Compute validation state reactively via `useMemo` over the current editable selections map
- Show a summary status indicator in the modal header or footer (e.g., "5 of 12 resolved") that updates as the user resolves items
- No partial confirmation or skip-unresolved behavior

**Editable selections state management**
- Maintain three parallel `Map` or `Record` state objects: `entitySelections: Record<temporaryNodeId, selectedEntityId>`, `attributeSelections: Record<temporaryItemId, selectedAttributeId>`, `edgeSelections: Record<temporaryEdgeId, selectedRelationshipId>`
- Initialize from the `DiagramMappingResult`: pre-populate matched items, leave unmatched as empty string
- On entity change: update `entitySelections`, then cascade to reset/revalidate affected `attributeSelections` entries and re-evaluate affected `edgeSelections` entries
- On attribute change: update `attributeSelections` only (no further cascades in this increment)
- On edge change: update `edgeSelections` only

**DiagramsView integration**
- Add a `showMappingConfirmationModal` boolean state to `DiagramsView`
- After `mappingResult` is set on `temporaryDiagramState`, check `overallStatus` and set `showMappingConfirmationModal = true` if not fully matched
- Render `<MappingConfirmationModal>` conditionally, passing the required props from `temporaryDiagramState` and `state.model.metaModel`
- `onConfirm` callback receives the `CompletedDiagramMapping` and stores it on state for future conversion increments; also closes the modal
- `onCancel` callback closes the modal and returns the user to the temporary diagram preview (does not exit temporary diagram mode)

**Error handling**
- If `metaModel` is null at render time, show a disabled state with an informative message instead of the form
- Gracefully handle edge cases: empty entity/attribute/relationship collections in the meta-model (show empty dropdown with "No candidates available" text)
- If a `NodeMappingRecord` has `reasonCode: 'mode_mismatch'`, display a non-editable warning row explaining the mismatch rather than a dropdown

## Visual Design
No visual mockups were provided.

## Existing Code to Leverage

**`LogicalErCreateModal.tsx` and `LogicalErCreateModal.module.css`**
- Standalone modal with overlay/header/content/footer and CSS Modules; replicate this structure at a wider max-width
- Cascading dropdown pattern: when `fromKind` changes, the entity list is rebuilt via `getEntitiesForKind()` and invalid selections are cleared; use this as the model for entity-to-attribute cascading
- Form validation with `errors` state, disabled submit via `isFormValid` useMemo, and `isSubmitting` loading state
- `<select>` element styling (`.select`, `.inputError`, dropdown arrow SVG) should be reused directly

**`temporaryDiagramMapping.ts` (Increment 5 mapping engine)**
- Reuse `buildEntityNameIndex`, `buildAttributeIndex`, `buildRelationshipIndex` for constructing candidate lists and revalidation
- Reuse `generateDataEntityPointId` from `dataEntityPointOptions.ts` for DEP ID construction during relationship re-evaluation
- Reference `mapAttributes` name-matching logic for the same-name revalidation step when a parent entity changes
- The `DiagramMappingResult`, `NodeMappingRecord`, `AttributeMappingRecord`, `EdgeMappingRecord` types are the direct input to this modal

**`ArchitectureContext.tsx` and `MetaModel` types**
- The modal receives `metaModel: MetaModel` as a prop (passed from DiagramsView which already has it via `useArchitecture()`)
- `MetaModelEntities` provides `logical_data_entities`, `logical_data_attributes`, `physical_data_entities`, `physical_data_attributes`
- `MetaModelRelationships` provides `logical_data_entity_relationships`

**`dataEntityPointOptions.ts` (DEP ID utilities)**
- `generateDataEntityPointId(entityType, entityId)` builds the `dep_log_` / `dep_phy_` prefixed IDs needed for relationship canonical key construction
- `parseDepId(depId)` extracts type and entityId from a DEP ID for display label resolution

**`ImportDecisionModal.tsx`**
- Example of decision modal with overlay-click-to-close, Escape key via document event listener, radio options, and Cancel/Continue footer buttons
- Demonstrates the `isOpen` guard pattern and state reset on open via `useEffect`

## Out of Scope
- "Create New" entity, attribute, or relationship from within the modal
- Bulk auto-fix, batch resolution, or "resolve all" actions
- Fuzzy matching, approximate name suggestions, or similarity-based candidate ranking
- Multi-step wizard behavior; this modal is a single-step confirmation
- Keyboard-heavy power-user shortcuts (e.g., arrow key navigation between rows, tab-to-next-dropdown)
- Audit trail or history of manual selection changes within the modal
- Final persistence or conversion logic (converting `CompletedDiagramMapping` into a native `Diagram`)
- Editing the temporary diagram content itself (positions, names, structure) from within the modal
- Undo/redo within the modal
- Physical data entity relationship support (only `logical_data_entity_relationships` exist in `MetaModelRelationships` currently)

# Spec Requirements: Mapping Confirmation Modal Framework (Increment 6)

## Initial Description
Build a confirmation modal that appears only when deterministic auto-mapping (Increment 5) does not fully resolve all nodes, attributes, and/or edges in a TemporaryArchitectureDiagram. This is Increment 6 in the temporary diagram pipeline series (Increments 1-5 are complete). The modal allows users to manually resolve unresolved mapping items and override auto-matched items before proceeding to native diagram conversion.

## Requirements Discussion

### First Round Questions

**Q1:** I assume the modal should appear automatically when `temporaryDiagramState.mappingResult` has `overallStatus === 'partially_matched'` (i.e., some but not all elements resolved). If `overallStatus` is `'fully_matched'`, the modal is skipped and proceeds directly to diagram conversion. If `'no_matches'`, the modal still appears (showing all items as unresolved). Is that correct, or should the modal also appear for `'fully_matched'` results so the user can review/override even successful auto-matches?
**Answer:** Auto-open the modal for any mapping result that is not fully matched, including both partially_matched and no_matches; do not open it for fully_matched, and do not require a review modal when everything already resolved deterministically.

**Q2:** I'm thinking a three-section approach: Entities (nodes), Attributes, and Relationships (edges), each as a collapsible or tabbed section within a single scrollable modal. Each section would show a table/list of items where unmatched items have a `<select>` dropdown for manual resolution and matched items show their resolved match (read-only or overridable). Should matched items be editable (allowing overrides), or should only `status: 'unmatched'` items be presented for resolution?
**Answer:** Use a single scrollable modal with three sections (Entities, Attributes, Relationships); auto-matched items should be editable/overridable, but clearly marked as auto-matched so the user can distinguish them from unresolved items.

**Q3:** For an unmatched node, the candidate dropdown should list all entities from the corresponding meta-model collection based on view_mode. Should the dropdown also include a "Create New" option that would create a new meta-model entity with the ref_name, or should it be strictly pick-from-existing?
**Answer:** Strictly pick-from-existing architecture elements in the current mode; do not include any "Create New" option in this increment.

**Q4:** When a user changes the entity mapping for a node (from auto-matched Entity A to manually-selected Entity B), all attribute mappings under that node become invalid because attributes are scoped to their parent entity. I assume that changing a node's entity selection should reset all its child attribute mappings to "unresolved" and rebuild the candidate lists from Entity B's attributes. Is that the correct cascading behavior?
**Answer:** Yes -- when an entity mapping changes, reset all child attribute mappings for that node to unresolved (or revalidate if an exact same-name match exists in the newly selected entity) and rebuild the candidate list from that entity's attributes only.

**Q5:** When either endpoint entity of an edge changes, the relationship candidate list changes. Should this re-evaluation happen automatically on entity change, or should there be a manual "Re-check" action?
**Answer:** Relationship mappings should be automatically re-evaluated whenever relevant endpoint entity or attribute selections change; do not require a manual "Re-check" action in this increment.

**Q6:** After the user confirms all mappings, the modal needs to produce a "completed" result. What should happen if the user clicks "Confirm" but some items are still unresolved -- should the Confirm button be disabled until all items are resolved, or should unresolved items be excluded/skipped from the final diagram?
**Answer:** Disable Confirm until all required mappings are resolved; do not allow partial confirmation or skipping unresolved items in this increment.

**Q7:** The existing `Modal` component has a `max-width: 600px` and a single "OK" footer button. This mapping confirmation modal will likely need to be wider and needs custom footer buttons. I assume we should follow the `LogicalErCreateModal` pattern -- building a standalone modal with its own overlay, header, content, footer, and CSS Module. Is that correct?
**Answer:** Build a dedicated modal patterned after the richer custom modal flows in the codebase (closer to LogicalErCreateModal / decision modals) rather than forcing everything into the generic 600px Modal, because this workflow needs more space, sectioning, and footer actions.

**Q8:** Anything explicitly out of scope?
**Answer:** Explicitly keep "create new architecture element," bulk auto-fix actions, fuzzy suggestions, multi-step wizard behavior, keyboard-heavy power-user shortcuts, audit/history of manual selections, and any final persistence/conversion logic out of scope for this increment.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: LogicalErCreateModal - Path: `frontend/src/components/DiagramsView/ER/LogicalErCreateModal.tsx` and `LogicalErCreateModal.module.css`
  - Demonstrates form-based modal with dynamic `<select>` dropdowns filtered by entity type (LOGICAL_ENTITY vs PHYSICAL_ENTITY)
  - Shows cascading dependency pattern: when `fromKind` or `toKind` changes, the entity dropdown list is rebuilt via `getEntitiesForKind()` and the selected entity is cleared if no longer valid
  - Uses standalone overlay/modal/header/content/footer structure with CSS Modules (not the common Modal wrapper)
  - Has form validation, error state per field, and disabled submit button until form is valid
  - Uses `isOpen` / `onClose` / `onSubmit` prop pattern

- Feature: Common Modal - Path: `frontend/src/components/common/Modal.tsx` and `Modal.module.css`
  - Base overlay/modal/header/content/footer pattern with `z-index: 1000`
  - Too constrained for this use case (600px max-width, single OK button) but establishes the visual language (border-radius, shadow, colors)

- Feature: ImportDecisionModal - Path: `frontend/src/components/Import/ImportDecisionModal.tsx`
  - Example of decision/confirmation modal with radio button options and conditional logic

- Feature: TemporaryDiagramState in DiagramsView - Path: `frontend/src/components/DiagramsView/DiagramsView.tsx` (lines ~538-563, ~690-725)
  - The `TemporaryDiagramState` interface already has `mappingResult: DiagramMappingResult | null`
  - Mapping is computed inline after fetch: `mapTemporaryDiagram(data, state.model.metaModel)` and stored on state
  - This is the integration point where the modal would be triggered

- Feature: Deterministic Auto-Mapping Engine - Path: `frontend/src/utils/temporaryDiagramMapping.ts`
  - Defines all the input types: `DiagramMappingResult`, `NodeMappingRecord`, `AttributeMappingRecord`, `EdgeMappingRecord`, `MappingReasonCode`, `MappingOverallStatus`, `MappingSummary`
  - Index-building functions (`buildEntityNameIndex`, `buildAttributeIndex`, `buildRelationshipIndex`) can potentially be reused or referenced for candidate list construction in the modal

- Feature: ArchitectureContext - Path: `frontend/src/contexts/ArchitectureContext.tsx`
  - Provides `useArchitecture()` hook for accessing `state.model.metaModel` (the `MetaModel` containing all entity/attribute/relationship collections)
  - The modal will need access to `metaModel.entities` and `metaModel.relationships` for candidate lists

- Feature: TemporaryDiagramContext - Path: `frontend/src/contexts/TemporaryDiagramContext.tsx`
  - Lightweight context for activating/deactivating temporary diagram mode
  - The modal sits within the DiagramsView temporary diagram flow

- Feature: Meta-model types - Path: `frontend/src/types/model.ts`
  - `LogicalDataEntity` (id, name, description, tags) at line 485
  - `LogicalDataAttribute` (id, name, logical_entity_id, data_type, is_primary_key, is_nullable) at line 495
  - `PhysicalDataEntity` (id, name, physical_type, database) at line 511
  - `PhysicalDataAttribute` (id, name, physical_entity_id, data_type, is_primary_key, is_nullable) at line 523
  - `LogicalDataEntityRelationship` (id, cardinality, relationship, fromDataEntityPointId, toDataEntityPointId) at line 1167
  - `MetaModelEntities` at line 2088 -- contains `logical_data_entities[]`, `logical_data_attributes[]`, `physical_data_entities[]`, `physical_data_attributes[]`
  - `MetaModelRelationships` at line 2125 -- contains `logical_data_entity_relationships[]`
  - `MetaModel` at line 2141 -- `{ entities: MetaModelEntities; relationships: MetaModelRelationships }`

- Feature: Temporary Architecture Diagram contract - Path: `frontend/src/types/temporaryArchitectureDiagram.ts`
  - `TemporaryArchitectureDiagram` with `view_mode` ('LOGICAL' | 'PHYSICAL'), `nodes[]`, `edges[]`
  - `TemporaryArchitectureDiagramNode` with `id`, `ref_name`, `display_name`, `semantic_type`, `compartments[]`
  - `TemporaryArchitectureDiagramEdge` with `id`, `source_node_id`, `target_node_id`, `source_ref_name`, `target_ref_name`
  - `TemporaryArchitectureDiagramCompartmentItem` with `id`, `ref_name`, `display_name`, `item_kind`

- Feature: Entity type registry and DEP ID utilities - Path: `frontend/src/utils/entityTypeRegistry.ts` and `frontend/src/utils/dataEntityPointOptions.ts`
  - `DIAGRAM_NODE_ENTITY_TYPE_MAP` maps semantic types to collection keys
  - `parseDepId` and `generateDataEntityPointId` are used for relationship matching via DEP ID pairs

### Follow-up Questions
No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements
- **Modal trigger**: Automatically open the mapping confirmation modal when `DiagramMappingResult.overallStatus` is `'partially_matched'` or `'no_matches'`; skip the modal entirely for `'fully_matched'`
- **Three-section layout**: Single scrollable modal with three distinct sections -- Entities (nodes), Attributes (compartment items), and Relationships (edges)
- **Display all mapping records**: Show both auto-matched and unresolved items in each section; auto-matched items are clearly visually distinguished (e.g., badge/indicator) but remain editable/overridable
- **Entity resolution dropdowns**: Each node row shows the temporary diagram `ref_name` / `display_name` and a `<select>` dropdown populated with all entities from the relevant meta-model collection (logical or physical based on `view_mode`); pre-selected to the auto-matched entity if one exists
- **Attribute resolution dropdowns**: Each attribute row shows the temporary diagram compartment item `ref_name` / `display_name` and a `<select>` dropdown populated with attributes belonging to the currently selected parent entity only; pre-selected to the auto-matched attribute if one exists
- **Relationship resolution dropdowns**: Each edge row shows source/target info and a `<select>` dropdown populated with relationships from the meta-model relationship index that connect the currently selected source and target entities; pre-selected to the auto-matched relationship if one exists
- **Cascading entity-to-attribute dependency**: When a node's entity selection changes, all child attribute mappings for that node are reset to unresolved, the attribute candidate lists are rebuilt from the newly selected entity's attributes, and any exact same-name matches are automatically revalidated
- **Cascading entity-to-relationship dependency**: When a node's entity selection changes, all edges connected to that node are automatically re-evaluated against the relationship index using the new entity's DEP IDs; edges may gain or lose matches
- **Confirm button gating**: The "Confirm" button is disabled until every mapping record (node, attribute, edge) has a resolved/selected value; no partial confirmation is allowed
- **Cancel functionality**: A "Cancel" button closes the modal without producing output, returning the user to the temporary diagram preview
- **CompletedDiagramMapping output**: On Confirm, produce a data structure (e.g., `CompletedDiagramMapping`) guaranteeing all `matchedEntityId`, `matchedAttributeId`, and `matchedRelationshipId` fields are non-null, along with the source `TemporaryArchitectureDiagram` reference

### Reusability Opportunities
- Reuse the overlay/modal/header/content/footer CSS pattern from `LogicalErCreateModal.module.css` (wider max-width, sectioned content, Cancel + Confirm footer)
- Reference `LogicalErCreateModal`'s cascading dropdown pattern (Kind change resets Entity selection) as the model for entity-to-attribute cascading
- Reuse index-building functions from `temporaryDiagramMapping.ts` (`buildEntityNameIndex`, `buildAttributeIndex`, `buildRelationshipIndex`) for constructing candidate lists and revalidation logic
- Use the same `<select>` element styling from `LogicalErCreateModal.module.css` (`.select` class with custom dropdown arrow, focus states, error states)
- Access meta-model data via `useArchitecture()` from `ArchitectureContext` -- same pattern used by `LogicalErCreateModal`
- Reference `generateDataEntityPointId` from `dataEntityPointOptions.ts` for building DEP IDs during relationship re-evaluation

### Scope Boundaries
**In Scope:**
- Modal component with three sections for entities, attributes, and relationships
- `<select>` dropdowns for each mapping record populated from meta-model collections
- Visual distinction between auto-matched and unresolved items
- Override capability for auto-matched items
- Cascading dependency: entity change resets and rebuilds child attribute candidates (with same-name revalidation)
- Cascading dependency: entity change triggers automatic relationship re-evaluation
- Confirm button disabled until all items resolved
- `CompletedDiagramMapping` output type with guaranteed non-null IDs
- Integration point in DiagramsView where the modal is triggered after mapping result is computed
- CSS Module for modal styling following existing codebase patterns

**Out of Scope:**
- "Create New" entity/attribute/relationship from within the modal
- Bulk auto-fix or batch resolution actions
- Fuzzy matching or approximate name suggestion algorithms
- Multi-step wizard behavior (the modal is a single-step confirmation)
- Keyboard-heavy power-user shortcuts within the modal
- Audit trail or history of manual selection changes
- Final persistence/conversion logic (converting the CompletedDiagramMapping into a native Diagram) -- that is a future increment
- Editing the temporary diagram content itself (positions, names, structure)
- Undo/redo within the modal

### Technical Considerations
- **Integration point**: The modal is triggered from `DiagramsView.tsx` where `temporaryDiagramState.mappingResult` is already computed and stored after the temporary diagram fetch completes (lines ~710-715)
- **Data flow**: The modal receives `DiagramMappingResult` + `TemporaryArchitectureDiagram` + `MetaModel` as inputs and produces a `CompletedDiagramMapping` as output
- **View mode awareness**: All candidate lists must be filtered by the temporary diagram's `view_mode` ('LOGICAL' or 'PHYSICAL') to show only the correct entity/attribute collections
- **Attribute scoping**: Attribute candidate lists are scoped to the currently selected parent entity ID -- when the parent entity changes, the attribute list must be rebuilt from `metaModel.entities.logical_data_attributes` (filtered by `logical_entity_id`) or `metaModel.entities.physical_data_attributes` (filtered by `physical_entity_id`)
- **Relationship matching via DEP IDs**: Relationship candidates use the same canonical key approach as `buildRelationshipIndex` -- construct DEP IDs from the selected source and target entity IDs, sort them to form a canonical key, and look up matching `LogicalDataEntityRelationship` records
- **Component pattern**: Standalone modal component with its own CSS Module, following `LogicalErCreateModal` patterns (overlay click-to-close, Escape key handling, disabled submit when invalid, loading state)
- **State management**: Modal-internal state managed with React `useState`/`useMemo`/`useCallback` hooks; no need for a new React context
- **Tech stack**: React 18.x, TypeScript 5.x, CSS Modules, Vitest for testing

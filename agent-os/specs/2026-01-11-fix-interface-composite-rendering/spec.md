# Specification: Fix Interface Composite Rendering

## Goal
Restore diagram rendering for Interface composites by fixing the data shape mismatch where `buildInterfaceCompositeNodes` receives a `string[]` instead of the expected `DataEntityIdsForInterface` object, and normalize legacy Interface-Entity relationship rows missing `dataEntityPointId`.

## User Stories
- As a diagram user, I want to add Interface entities with their schema (endpoints, logical entities, physical entities) via Advanced Add so that the canvas renders without runtime errors.
- As a diagram user, I want legacy Interface-Entity relationships to load correctly so that existing diagrams render without console warnings about missing point-id fields.

## Specific Requirements

**Fix compoundLayout.ts buildInterfaceCompositeNodes call site**
- Location: `frontend/src/utils/compoundLayout.ts` line 656
- Currently passes `selectedLogicalEntityIds` (string[]) as third argument
- Must pass `DataEntityIdsForInterface` object: `{ logicalEntityIds: string[], physicalEntityIds: string[] }`
- Build object from `candidate.logicalEntities.map(le => le.entityId)` and `candidate.physicalEntities.map(pe => pe.entityId)`
- Use empty array for physicalEntityIds if candidate.physicalEntities is undefined (defensive)

**Extend InterfaceCustomCandidate type to include physicalEntities**
- Location: `frontend/src/utils/erdAdvancedAddUtils.ts` lines 35-42
- Add new field: `physicalEntities: TreeNodeData[]`
- This enables the candidate to carry both logical and physical entity selections from Advanced Add

**Update isInterfaceCustomLayoutCandidate to check PHYSICAL_DATA_ENTITY**
- Location: `frontend/src/utils/erdAdvancedAddUtils.ts` lines 258-265
- Currently only checks for ENDPOINT or LOGICAL_DATA_ENTITY children
- Add PHYSICAL_DATA_ENTITY to the condition: `child.entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY`
- Interface qualifies for custom layout if it has any selected endpoint OR logical entity OR physical entity child

**Update findInterfaceCustomCandidates to collect physical entities**
- Location: `frontend/src/utils/erdAdvancedAddUtils.ts` lines 296-306
- Add filter for selected PHYSICAL_DATA_ENTITY children (similar to lines 297-300 for logical)
- Include `physicalEntities: selectedPhysicalEntities` in the candidate object pushed to results

**Update PalettePanel calculateInterfaceCompositeDimensions**
- Location: `frontend/src/components/DiagramsView/PalettePanel.tsx` lines 244-259
- Location: `frontend/src/components/DiagramsView/PalettePanel_tmp.tsx` lines 210-226
- Include physical entity boxes in dimension calculations alongside logical entities
- Physical entities should be counted in entity box rows/columns same as logical entities

**Add legacy dataEntityPointId normalization in LOAD_MODEL reducer**
- Location: `frontend/src/contexts/ArchitectureContext.tsx` lines 369-393
- Create `normalizeInterfaceLogicalEntities()` function
- For each `interface_logical_entities` row where `dataEntityPointId` is missing/blank:
  - If legacy `logical_entity_id` exists: set `dataEntityPointId = "dep_log_" + logical_entity_id`
  - If legacy `physical_entity_id` exists: set `dataEntityPointId = "dep_phy_" + physical_entity_id`
- Call normalization after `entitiesWithDefaults` and before `reconcileApplicationPoints`
- Do not remove legacy fields; only ensure `dataEntityPointId` is populated

**Add regression tests for the fixes**
- Test 1: buildInterfaceCompositeNodes does not throw when given valid DataEntityIdsForInterface with both logical and physical entities
- Test 2: Attribute selection map correctly uses raw entity IDs as keys (not point IDs)
- Test 3: Legacy normalization fills dataEntityPointId from logical_entity_id or physical_entity_id when missing

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**DataEntityIdsForInterface type definition**
- Location: `frontend/src/utils/interfaceCompositeBuilder.ts` lines 72-77
- Already defines the correct shape: `{ logicalEntityIds: string[], physicalEntityIds: string[] }`
- Export and use this type in compoundLayout.ts and erdAdvancedAddUtils.ts

**resolveDataEntitiesForInterface shared utility**
- Location: `frontend/src/utils/dataEntityPointOptions.ts` lines 233-274
- Already parses dataEntityPointId and returns `{ logicalEntityIds, physicalEntityIds }`
- Use as reference for the prefix format: `dep_log_` for logical, `dep_phy_` for physical

**LOAD_MODEL migration pattern**
- Location: `frontend/src/contexts/ArchitectureContext.tsx` lines 369-393
- Shows pattern for migrating data on load (migrateLogicalAttributes, reconcileApplicationPoints)
- Follow same pattern: create normalization function, call it in reducer pipeline

**ENTITY_TYPES constants**
- Location: `frontend/src/config/entityTypes.ts`
- Use `ENTITY_TYPES.PHYSICAL_DATA_ENTITY` constant for type checking in erdAdvancedAddUtils.ts

**getDataEntityIdsForInterface helper**
- Location: `frontend/src/utils/interfaceCompositeBuilder.ts` lines 95-101
- Delegates to resolveDataEntitiesForInterface; can be used as model for consistent shape handling

## Out of Scope
- Backend/model service database migrations (frontend normalization is sufficient for legacy rows)
- New UI features or enhancements to Advanced Add dialog
- Changes to AdvancedAddDialog tree building logic (already uses resolveDataEntitiesForInterface correctly)
- Modifications to the interfaceCompositeBuilder rendering logic itself (only call sites need fixing)
- Schema validation changes for Interface-Entity relationships
- Performance optimizations to the normalization or rendering pipeline
- Changes to how attributes are stored or managed in the meta-model
- API endpoint changes for saving/loading Interface relationships
- Unit tests for unrelated components
- Documentation updates outside of code comments

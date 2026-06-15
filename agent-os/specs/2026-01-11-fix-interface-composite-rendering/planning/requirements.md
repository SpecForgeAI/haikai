# Spec Requirements: Fix Interface Composite Rendering

## Initial Description

Title: Fix Interface composite rendering after Interface-Entity refactor (dataEntities shape, attribute keying, and legacy dataEntityPointId normalization)

Goal: Fully restore diagram rendering for Interface composites after the Interface-Entity refactor by:
1. Updating Advanced Add -> candidate -> layout pipeline to pass Interface-selected entities in the new unified shape (logical + physical).
2. Fixing attribute-selection mapping so logical/physical entity attributes render correctly.
3. Eliminating runtime warnings/errors caused by legacy Interface-Entity rows missing `dataEntityPointId`.

This must remove the canvas render failure:
- `selectedDataEntityIds.logicalEntityIds is not iterable`
and prevent the next likely failures around attribute lookup and missing point-id.

## Requirements Discussion

### First Round Questions

**Q1:** buildInterfaceCompositeNodes() function signature and broken call sites
**Answer:** Code analysis confirmed the issue:
- **Function signature** (interfaceCompositeBuilder.ts:194-202):
  ```typescript
  export function buildInterfaceCompositeNodes(
    interfaceId: string,
    selectedEndpointIds: string[],
    selectedDataEntityIds: DataEntityIdsForInterface,  // Expects { logicalEntityIds: string[], physicalEntityIds: string[] }
    selectedAttributeIdsByEntity: Map<string, string[]>,
    metaModel: MetaModel,
    basePosition: { x: number; y: number },
    baseZIndex: number,
    parentNodeId: string | null
  ): InterfaceCompositeResult
  ```
- **Broken call site** (compoundLayout.ts:653-662):
  ```typescript
  const { interfaceNode, entityNodes } = buildInterfaceCompositeNodes(
    node.id,
    selectedEndpointIds,
    selectedLogicalEntityIds,        // BUG: Passing string[] instead of DataEntityIdsForInterface
    selectedAttributeIdsByEntity,
    metaModel,
    { x: node.x + node.width / 2, y: node.y + node.height / 2 },
    currentZIndex,
    parentDiagramNodeId
  );
  ```

**Q2:** InterfaceCustomCandidate structure in erdAdvancedAddUtils.ts
**Answer:** Code analysis shows the current structure only has `logicalEntities`:
```typescript
export interface InterfaceCustomCandidate {
  interface: TreeNodeData;
  endpoints: TreeNodeData[];
  logicalEntities: TreeNodeData[];  // Missing physicalEntities
}
```
This needs to be extended to support physical entities.

**Q3:** How dataEntityPointId is parsed and resolved
**Answer:** The `resolveDataEntitiesForInterface()` function in dataEntityPointOptions.ts correctly parses the dataEntityPointId format:
- Logical entities: `dep_log_<entityId>` prefix
- Physical entities: `dep_phy_<entityId>` prefix

This shared utility already returns `{ logicalEntityIds: string[], physicalEntityIds: string[] }` and is used by:
- AdvancedAddDialog.tsx findRelatedEntities() for tree building
- interfaceCompositeBuilder.ts getDataEntityIdsForInterface() for composite rendering

**Q4:** Legacy InterfaceLogicalEntity type and normalization location
**Answer:**
- **Current type** (model.ts:1143-1165): Only has `dataEntityPointId: string` as a required field
- **Legacy fields mentioned** (model.ts:1131): "Supports backward compatibility with legacy logical_entity_id field"
- **Best normalization location**: The `LOAD_MODEL` reducer in ArchitectureContext.tsx (line 331) already performs migrations (e.g., `migrateLogicalAttributes`). A new `normalizeInterfaceLogicalEntities()` function should be added here.

**Q5:** Attribute selection keying
**Answer:** Code analysis shows the attribute map in compoundLayout.ts (line 645) is built as:
```typescript
const selectedAttributeIdsByEntity = new Map<string, string[]>();
```
The buildInterfaceCompositeNodes function (lines 233-256, 268-291) correctly looks up attributes by raw entity ID:
```typescript
if (selectedAttributeIdsByEntity.has(logicalEntityId)) {
  attributeIds = selectedAttributeIdsByEntity.get(logicalEntityId) || [];
}
```
The keying is correct when attributes are present, but empty map means "use all attributes".

**Q6:** PalettePanel Interface candidate handling
**Answer:** Both PalettePanel.tsx and PalettePanel_tmp.tsx:
- Use `findInterfaceCustomCandidates()` to detect Interface candidates (line 391 in both)
- Build `interfaceCandidateMap` keyed by interface entity ID (lines 394-397)
- Use `buildInterfaceDimensionsMap()` for pre-computing Interface dimensions (line 401)
- Only reference `candidate.logicalEntities` - missing physical entity support

### Existing Code to Reference

**Similar Features Identified:**
- Feature: resolveDataEntitiesForInterface - Path: `frontend/src/utils/dataEntityPointOptions.ts` (lines 233-274)
  - Already parses dataEntityPointId and returns both logical and physical entity IDs
- Feature: DataEntityIdsForInterface type - Path: `frontend/src/utils/interfaceCompositeBuilder.ts` (lines 72-77)
  - Already defines the correct shape: `{ logicalEntityIds: string[], physicalEntityIds: string[] }`
- Feature: LOAD_MODEL normalization pattern - Path: `frontend/src/contexts/ArchitectureContext.tsx` (lines 369-393)
  - Shows pattern for migrating data on load (migrateLogicalAttributes, reconcileApplicationPoints, etc.)

### Follow-up Questions
None needed - code analysis provided sufficient detail.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements

1. **Fix Data Shape Mismatch (compoundLayout.ts:653)**
   - Change the call to `buildInterfaceCompositeNodes` to pass `{ logicalEntityIds: string[], physicalEntityIds: string[] }` instead of `string[]`
   - Build the object from `candidate.logicalEntities` and `candidate.physicalEntities` (new field)

2. **Extend InterfaceCustomCandidate Type (erdAdvancedAddUtils.ts)**
   - Add `physicalEntities: TreeNodeData[]` field to the interface
   - Update `findInterfaceCustomCandidates()` to populate physical entities from tree selections
   - Update `isInterfaceCustomLayoutCandidate()` to check for selected PHYSICAL_DATA_ENTITY children

3. **Extend PalettePanel Interface Dimension Calculations**
   - Update `calculateInterfaceCompositeDimensions()` in both PalettePanel.tsx and PalettePanel_tmp.tsx
   - Include physical entity boxes in dimension calculations alongside logical entities

4. **Add Legacy dataEntityPointId Normalization (ArchitectureContext.tsx)**
   - Create `normalizeInterfaceLogicalEntities()` function
   - For each interface_logical_entities row where `dataEntityPointId` is missing/blank:
     - If legacy `logical_entity_id` exists: set `dataEntityPointId = "dep_log_" + logical_entity_id`
     - If legacy `physical_entity_id` exists: set `dataEntityPointId = "dep_phy_" + physical_entity_id`
   - Call this normalization in LOAD_MODEL reducer before other reconciliations

5. **Ensure Attribute Selection Keying is Consistent**
   - Verify attribute selection maps use raw entity IDs (not point IDs)
   - Add defensive defaults: missing map entries should result in "no attributes" rather than errors

### Reusability Opportunities

- `resolveDataEntitiesForInterface()` in dataEntityPointOptions.ts already provides the correct shape
- `DataEntityIdsForInterface` type in interfaceCompositeBuilder.ts already defines the needed interface
- LOAD_MODEL migration pattern in ArchitectureContext.tsx provides template for normalization

### Scope Boundaries

**In Scope:**
- Fix compoundLayout.ts call site to pass correct data shape
- Extend InterfaceCustomCandidate to include physical entities
- Update PalettePanel dimension calculations for physical entities
- Add legacy dataEntityPointId normalization in LOAD_MODEL reducer
- Add/update regression tests for the fixes

**Out of Scope:**
- Backend/model service migrations (frontend normalization is sufficient)
- New UI features (purely correctness/regression fix)
- Changes to AdvancedAddDialog tree building (already uses resolveDataEntitiesForInterface correctly)

### Technical Considerations

**Exact Broken Locations:**

| File | Line | Issue | Fix |
|------|------|-------|-----|
| compoundLayout.ts | 656 | Passes `selectedLogicalEntityIds` (string[]) instead of DataEntityIdsForInterface | Build object: `{ logicalEntityIds: candidate.logicalEntities.map(le => le.entityId), physicalEntityIds: candidate.physicalEntities.map(pe => pe.entityId) }` |
| erdAdvancedAddUtils.ts | 35-42 | InterfaceCustomCandidate missing `physicalEntities` field | Add `physicalEntities: TreeNodeData[]` |
| erdAdvancedAddUtils.ts | 259-265 | `isInterfaceCustomLayoutCandidate` only checks LOGICAL_DATA_ENTITY | Add check for PHYSICAL_DATA_ENTITY |
| erdAdvancedAddUtils.ts | 297-300 | `findInterfaceCustomCandidates` only collects logical entities | Add collection of physical entities |
| PalettePanel.tsx | 244-259 | `calculateInterfaceCompositeDimensions` only handles logical entities | Add physical entity dimension calculations |
| PalettePanel_tmp.tsx | 210-226 | Same as above | Same fix |
| ArchitectureContext.tsx | 369-393 | No normalization for legacy interface_logical_entities | Add normalizeInterfaceLogicalEntities() call |

**Type Definition Location:**
- `DataEntityIdsForInterface` - frontend/src/utils/interfaceCompositeBuilder.ts:72-77
- `InterfaceCustomCandidate` - frontend/src/utils/erdAdvancedAddUtils.ts:35-42
- `InterfaceLogicalEntity` - frontend/src/types/model.ts:1143-1165

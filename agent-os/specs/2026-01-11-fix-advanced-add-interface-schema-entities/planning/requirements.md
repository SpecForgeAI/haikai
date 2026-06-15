# Spec Requirements: Fix Advanced Add Interface Schema Entities

## Initial Description

Fix the Advanced Add modal (right-click Application -> Advanced Add) to restore the previously working behaviour where schema entities nested under an Interface are shown and selectable, based on the meta-model relationship.

This regressed after changing the relationship from **Interface <-> Logical Entity** to **Interface <-> Entity** (logical OR physical).

## Requirements Discussion

### First Round Questions

This spec was provided with comprehensive requirements in the raw-idea.md file. Based on code analysis, the following clarifications were established:

**Q1:** The spec states the problem is in AdvancedAddDialog.tsx reading `logical_entity_id`. Where exactly is this code located?

**Answer (from code analysis):** The broken code is in `AdvancedAddDialog.tsx` at lines 328-337 in the `findRelatedEntities` function:
```typescript
case 'interface_logical_entities': {
  const interfaceLogicalEntities = metaModel.relationships.interface_logical_entities || [];
  const ldeIds = interfaceLogicalEntities
    .filter((rel) => rel.interface_id === rootEntityId)
    .map((rel) => rel.logical_entity_id);  // <-- BROKEN: reads old field

  const uniqueLdeIds = [...new Set(ldeIds)];
  return metaModel.entities.logical_data_entities  // <-- BROKEN: only searches logical entities
    .filter((lde) => uniqueLdeIds.includes(lde.id))
    .map((lde) => ({ id: lde.id, name: lde.name }));
}
```

**Q2:** The spec mentions `dataEntityPointId` as the new unified field. What is its format?

**Answer (from code analysis):** Per `InterfaceLogicalEntity` interface in `model.ts` (lines 1143-1165) and `dataEntityPointOptions.ts`:
- Format: `dep_log_<entityId>` for logical entities
- Format: `dep_phy_<entityId>` for physical entities
- The field `dataEntityPointId` is the required field for data entity selection

**Q3:** The spec mentions updating interfaceCompositeBuilder.ts. Where is the stale code?

**Answer (from code analysis):** The broken code is in `interfaceCompositeBuilder.ts` at lines 73-81:
```typescript
export function getLogicalEntityIdsForInterface(
  interfaceId: string,
  metaModel: MetaModel
): string[] {
  const relationships = metaModel.relationships.interface_logical_entities || [];
  return relationships
    .filter(rel => rel.interface_id === interfaceId)
    .map(rel => rel.logical_entity_id);  // <-- BROKEN: reads old field, ignores dataEntityPointId
}
```

And in `buildInterfaceCompositeNodes` (lines 151-314) which only handles `selectedLogicalEntityIds` and only searches `metaModel.entities.logical_data_entities`.

**Q4:** The spec mentions updating advancedAddRelationships.ts config. What needs to change?

**Answer (from code analysis):** In `advancedAddRelationships.ts` lines 322-343, the INTERFACE expandable relationships only define:
```typescript
[ENTITY_TYPES.INTERFACE]: [
  {
    targetEntityType: ENTITY_TYPES.LOGICAL_DATA_ENTITY,  // <-- Only logical, needs physical too
    relationshipKind: 'ASSOCIATION',
    direction: 'ASSOCIATION',
    relationshipTableName: 'interface_logical_entities',
    foreignKeyField: 'interface_id',
    displayLabel: 'Logical Data Entities',  // <-- Should be "Data Entities" or split
    actsAsContainment: true,
  },
  // ... ENDPOINT relationship
]
```
This needs to support both LOGICAL_DATA_ENTITY and PHYSICAL_DATA_ENTITY targets.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Data Entity Point resolution - Path: `frontend/src/utils/dataEntityPointOptions.ts`
  - Contains `parseDataEntityPointId()` function that parses `dep_log_<id>` and `dep_phy_<id>` formats
  - Contains `resolveDataEntityPointLabel()` for display labels
- Feature: DataEntityPointSelect component - Path: `frontend/src/components/Grid/DataEntityPointSelect.tsx`
  - Shows how the UI handles both logical and physical entities
- Feature: Logical ER relationship handling - Path: `frontend/src/utils/erdUtils.ts` (referenced in interfaceCompositeBuilder)
  - Uses `getAttributesForEntity()` which already handles both entity types

### Follow-up Questions

No follow-up questions were needed as the raw-idea.md provided comprehensive requirements and the code analysis confirmed the exact locations of the broken code.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements

1. **Correctly resolve Interface schema entities from relationship rows**
   - Read `dataEntityPointId` field from `interface_logical_entities` relationship rows
   - Parse the field using existing `parseDataEntityPointId()` utility from `dataEntityPointOptions.ts`
   - Resolve to either logical or physical entity based on prefix (`dep_log_` or `dep_phy_`)
   - Collect entity IDs from appropriate collection (`logical_data_entities` or `physical_data_entities`)

2. **Display schema entities under Interface in Advanced Add tree**
   - Show both logical and physical data entities under Interface nodes
   - Display with type tags: `[LOGICAL_DATA_ENTITY]` or `[PHYSICAL_DATA_ENTITY]`
   - Maintain existing "Advanced Add" nesting behaviour for other entity types

3. **Update Interface composite/contract rendering**
   - Update `getLogicalEntityIdsForInterface()` to return both logical and physical entity IDs
   - Update `buildInterfaceCompositeNodes()` to handle physical entities
   - Ensure contract rendering includes both entity types in the embedded section

4. **Update advancedAddRelationships.ts configuration**
   - Update INTERFACE relationship config to support both entity types
   - Consider whether to use single entry with polymorphic handling or two separate entries

### Reusability Opportunities

The following existing utilities should be reused:
- `parseDataEntityPointId()` from `dataEntityPointOptions.ts` - parses `dep_log_<id>` and `dep_phy_<id>` format
- `resolveDataEntityPointLabel()` from `dataEntityPointOptions.ts` - generates display labels
- `DATA_ENTITY_POINT_PREFIXES` constants from `dataEntityPointOptions.ts`
- `getAttributesForEntity()` from `erdUtils.ts` - already handles both entity types

### Scope Boundaries

**In Scope:**
- Frontend-only fix in `AdvancedAddDialog.tsx`
- Frontend-only fix in `interfaceCompositeBuilder.ts`
- Config update in `advancedAddRelationships.ts`
- Adding a regression test

**Out of Scope:**
- Backend/model-service changes (relationship data already exists)
- Changes to how Interface<->Entity relationship is authored in grids
- Other Advanced Add nesting behaviours (applications/components/services/endpoints)

### Technical Considerations

**Files to Modify:**

1. `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`
   - Location: `findRelatedEntities()` function, case `'interface_logical_entities'` (lines 328-337)
   - Change: Use `parseDataEntityPointId()` to decode `rel.dataEntityPointId` and resolve to correct entity collection

2. `frontend/src/utils/interfaceCompositeBuilder.ts`
   - Location: `getLogicalEntityIdsForInterface()` function (lines 73-81)
   - Change: Parse `dataEntityPointId` and return object with both logical and physical IDs
   - Location: `buildInterfaceCompositeNodes()` function (lines 151-314)
   - Change: Accept both logical and physical entity IDs, handle both entity types in rendering

3. `frontend/src/utils/advancedAddRelationships.ts`
   - Location: INTERFACE entry (lines 322-343)
   - Change: Update to support both LOGICAL_DATA_ENTITY and PHYSICAL_DATA_ENTITY

**Shared Resolver Utility (Suggested):**
Create a new shared utility function to avoid code divergence:
```typescript
// In dataEntityPointOptions.ts or new file
export function resolveDataEntitiesForInterface(
  metaModel: MetaModel,
  interfaceId: string
): { logicalEntityIds: string[], physicalEntityIds: string[] }
```
This would:
- Filter `interface_logical_entities` by `interface_id`
- Read `dataEntityPointId` from each relationship
- Use `parseDataEntityPointId()` to decode kind + ID
- Return grouped results

**Type Updates:**
The `InterfaceLogicalEntity` interface in `model.ts` already has the correct `dataEntityPointId` field (lines 1143-1165). No type changes needed.

**Test Requirements:**
Add regression test that:
- Creates minimal metaModel with an Interface
- Creates one logical data entity
- Creates one physical data entity
- Creates Interface<->Entity relationship rows using `dataEntityPointId` referencing both
- Asserts Advanced Add tree includes both entities under the Interface

## Code Analysis Details

### AdvancedAddDialog.tsx - Broken Code Location

```typescript
// Lines 328-337 in findRelatedEntities()
case 'interface_logical_entities': {
  const interfaceLogicalEntities = metaModel.relationships.interface_logical_entities || [];
  const ldeIds = interfaceLogicalEntities
    .filter((rel) => rel.interface_id === rootEntityId)
    .map((rel) => rel.logical_entity_id);  // BROKEN: should use dataEntityPointId

  const uniqueLdeIds = [...new Set(ldeIds)];
  return metaModel.entities.logical_data_entities  // BROKEN: only checks logical
    .filter((lde) => uniqueLdeIds.includes(lde.id))
    .map((lde) => ({ id: lde.id, name: lde.name }));
}
```

### interfaceCompositeBuilder.ts - Broken Code Location

```typescript
// Lines 73-81
export function getLogicalEntityIdsForInterface(
  interfaceId: string,
  metaModel: MetaModel
): string[] {
  const relationships = metaModel.relationships.interface_logical_entities || [];
  return relationships
    .filter(rel => rel.interface_id === interfaceId)
    .map(rel => rel.logical_entity_id);  // BROKEN: should use dataEntityPointId
}
```

### InterfaceLogicalEntity Interface (Correct)

```typescript
// model.ts lines 1143-1165
export interface InterfaceLogicalEntity {
  id: string;
  interface_id: string;
  dataEntityPointId: string;  // CORRECT: unified field for logical OR physical
  description: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
}
```

### parseDataEntityPointId Utility (Reusable)

```typescript
// dataEntityPointOptions.ts lines 164-184
export function parseDataEntityPointId(pointId: string): {
  entityType: 'logical' | 'physical';
  entityId: string
} | null {
  if (!pointId) return null;

  if (pointId.startsWith(DATA_ENTITY_POINT_PREFIXES.LOGICAL)) {  // 'dep_log_'
    return {
      entityType: 'logical',
      entityId: pointId.slice(DATA_ENTITY_POINT_PREFIXES.LOGICAL.length),
    };
  }

  if (pointId.startsWith(DATA_ENTITY_POINT_PREFIXES.PHYSICAL)) {  // 'dep_phy_'
    return {
      entityType: 'physical',
      entityId: pointId.slice(DATA_ENTITY_POINT_PREFIXES.PHYSICAL.length),
    };
  }

  return null;
}
```

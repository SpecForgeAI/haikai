# Specification: Fix ER Relationship Addability

## Goal
Fix the ER diagram relationship palette so Logical Data Entity Relationship rows become enabled when their endpoints are on the canvas, and ensure edge creation uses correct raw entity IDs instead of `dep_*` point IDs.

## User Stories
- As a diagram author, I want Logical ER relationship rows to become clickable when both endpoint entities are on the canvas so that I can visualize data relationships
- As a diagram author, I want added ER edges to correctly attach to existing entity nodes so that the diagram renders properly

## Specific Requirements

**Update isLogicalEREnabledWithSets() to parse dataEntityPointId fields**
- Location: `frontend/src/utils/relationshipUtils.ts` lines 453-485
- Current code references deprecated `from_ref_id`, `to_ref_id`, `from_ref_kind`, `to_ref_kind` fields
- LogicalDataEntityRelationship now uses `fromDataEntityPointId` and `toDataEntityPointId` fields (format: `dep_log_<id>` or `dep_phy_<id>`)
- Import and use `parseDataEntityPointId()` from `frontend/src/utils/dataEntityPointOptions.ts`
- Parse `relationship.fromDataEntityPointId` to extract `{ entityType, entityId }`
- Parse `relationship.toDataEntityPointId` to extract `{ entityType, entityId }`
- If parse returns null for either endpoint, return `{ enabled: false, disabledReason: 'endpoints_missing' }`
- Check `entityType === 'logical'` against `logicalDataEntitiesOnDiagram` Set
- Check `entityType === 'physical'` against `physicalDataEntitiesOnDiagram` Set

**Update getLogicalERNodes() to resolve dataEntityPointId to raw entity IDs and types**
- Location: `frontend/src/utils/relationshipUtils.ts` lines 967-988
- Current code references deprecated `from_ref_id` and `to_ref_id` fields
- Use `parseDataEntityPointId()` to resolve `fromDataEntityPointId` and `toDataEntityPointId`
- Determine source node entity type from parsed `entityType` ('logical' -> `ENTITY_TYPES.LOGICAL_DATA_ENTITY`, 'physical' -> `ENTITY_TYPES.PHYSICAL_DATA_ENTITY`)
- Determine target node entity type similarly
- Use `findNodeForEntity()` with resolved entity type and entity ID
- Return null if either parse fails or node not found

**Update getPolymorphicLogicalERNodes() or deprecate it**
- Location: `frontend/src/utils/relationshipUtils.ts` lines 1001-1028
- This function also references deprecated fields
- Either update to use `parseDataEntityPointId()` with the new `fromDataEntityPointId`/`toDataEntityPointId` fields, or remove if redundant with updated `getLogicalERNodes()`
- The polymorphic behavior (logical-to-physical) is now implicit in the dataEntityPointId format

**Ensure edge creation uses raw entity IDs for source_node_id and target_node_id**
- Location: `frontend/src/components/DiagramsView/PalettePanel.tsx` lines 1510-1523
- The `getLogicalERNodes()` function is called to get source and target nodes
- After fixing `getLogicalERNodes()`, the returned `sourceNode.id` and `targetNode.id` will be diagram node IDs (not `dep_*` IDs)
- `createRelationshipEdge()` already uses `sourceNode.id` and `targetNode.id` for `source_node_id`/`target_node_id`
- No changes needed in PalettePanel.tsx if `getLogicalERNodes()` is fixed correctly

**Add regression tests for dataEntityPointId parsing in addability logic**
- Location: `frontend/src/__tests__/`
- Test file name: `er-relationship-addability.test.ts`
- Test A: Given diagram with two `PHYSICAL_DATA_ENTITY` nodes (IDs A and B), and ER relationship with `fromDataEntityPointId: 'dep_phy_A'` and `toDataEntityPointId: 'dep_phy_B'`, expect `isRelationshipRowEnabled()` to return true
- Test B: Given diagram with one `LOGICAL_DATA_ENTITY` node (ID C) and one `PHYSICAL_DATA_ENTITY` node (ID D), and ER relationship with `fromDataEntityPointId: 'dep_log_C'` and `toDataEntityPointId: 'dep_phy_D'`, expect enabled
- Test C: Given diagram missing one endpoint, expect `isRelationshipRowEnabled()` to return false with `disabledReason: 'endpoints_missing'`

**Add regression tests for edge node resolution**
- Location: `frontend/src/__tests__/er-relationship-addability.test.ts`
- Test D: Given `getLogicalERNodes()` with relationship using `dep_phy_A`/`dep_phy_B` and diagram nodes for A and B as PHYSICAL_DATA_ENTITY, expect returned nodes to match the diagram nodes (not undefined)
- Test E: Verify that after adding relationship edge, `edge.source_node_id` and `edge.target_node_id` reference the diagram node IDs (not `dep_*` strings)

## Existing Code to Leverage

**parseDataEntityPointId() in dataEntityPointOptions.ts**
- Location: `frontend/src/utils/dataEntityPointOptions.ts` lines 177-197
- Parses `dep_log_<id>` -> `{ entityType: 'logical', entityId: <id> }`
- Parses `dep_phy_<id>` -> `{ entityType: 'physical', entityId: <id> }`
- Returns null for invalid format - use this for strict validation (do not guess)
- Reuse directly in `relationshipUtils.ts` for both addability and node resolution

**DATA_ENTITY_POINT_PREFIXES constants**
- Location: `frontend/src/utils/dataEntityPointOptions.ts` lines 65-68
- `LOGICAL: 'dep_log_'` and `PHYSICAL: 'dep_phy_'`
- Already exported, can be used if prefix checking is needed directly

**ENTITY_TYPES constants**
- Location: `frontend/src/types/model.ts` lines 1246-1247
- `LOGICAL_DATA_ENTITY` and `PHYSICAL_DATA_ENTITY` string constants
- Already imported in `relationshipUtils.ts`

**EntitiesOnDiagram interface and getEntitiesOnDiagram()**
- Location: `frontend/src/utils/relationshipUtils.ts` lines 68-198
- Already provides `logicalDataEntitiesOnDiagram` and `physicalDataEntitiesOnDiagram` Sets
- No changes needed to this infrastructure

**findNodeForEntity() helper**
- Location: `frontend/src/utils/relationshipUtils.ts` lines 212-218
- Takes `(nodes, entityType, entityId)` and returns matching DiagramNode
- Reuse in updated `getLogicalERNodes()` with resolved entity type and ID

## Out of Scope
- Backend/API changes - this is frontend-only
- Database migrations or schema changes
- Changes to how `dataEntityPointId` values are stored or authored
- Relationship authoring UI (Create/Edit ER modal)
- Other palette types (Data Movement, User-Business Point, App Point-Business Point)
- Changes to other relationship types beyond `logical_data_entity_relationships`
- Removing or modifying `getPolymorphicLogicalERNodes()` if it is used elsewhere (verify usage first)
- Changes to `LogicalDataEntityRelationship` TypeScript interface (already updated)
- Tooltip text changes - existing message is appropriate

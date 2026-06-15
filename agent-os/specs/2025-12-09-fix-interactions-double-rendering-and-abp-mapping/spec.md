# Specification: Fix Interactions Double-Rendering and App_Business_Point Mapping

## Goal
Fix two bugs: (1) the Interactions grid appearing twice in Meta-Model view due to presence in both `tabToEntityType` and `relationshipTabToType`, and (2) User Interaction palette rows staying disabled because enablement logic checks for APP_BUSINESS_POINT nodes instead of resolving to concrete entity nodes on the diagram.

## User Stories
- As a user viewing the Meta-Model Interactions tab, I want to see only one grid so that I am not confused by duplicate tables.
- As a user working in the Diagrams view, I want User Interaction palette rows to be enabled when the underlying Applications (or other concrete entities) are on the diagram, so that I can draw interaction edges.

## Specific Requirements

**Remove Interactions from tabToEntityType mapping**
- In `config/gridConfigs.ts`, remove the line `'Interactions': 'interactions'` from `tabToEntityType`
- This entry was retained for "grid config lookup" but causes `isEntityTab` to be true for Interactions
- After removal, `isEntityTab` will be false and only `isRelationshipTab` will be true for Interactions
- The grid column configuration in `gridConfigs.interactions` should remain for RelationshipGrid to use

**Verify Interactions remains only in relationshipTabToType**
- Confirm `relationshipTabToType['Interactions']` equals `'interactions'`
- Confirm `relationshipTabNames` array includes `'Interactions'` exactly once
- No duplicate entries should exist in relationship tab mappings

**Fix getAppBusinessPointNodeId to resolve ABP to concrete diagram nodes**
- Current implementation in `userInteractionUtils.ts` looks up the ABP and maps `kind` to entity type
- Uses `findNodeForEntity(nodes, entityType, abp.source_entity_id)` to find matching node
- This logic is correct but needs verification that ABP records have proper `kind` and `source_entity_id` values
- Supported kinds: APPLICATION, APP_COMPONENT, SERVICE, INTERFACE, BUSINESS_PROCESS, PROCESS_ACTIVITY

**Update isUserInteractionRowEnabled to use correct mapping**
- Case A (both primary and secondary ABP defined): enable when both P and S concrete nodes exist on diagram and no edges exist
- Case B (only primary ABP defined): enable when P concrete node and User node exist on diagram and no edges exist
- The function already calls `getAppBusinessPointNodeId` which should resolve to concrete nodes
- Verify the lookup path correctly traverses ABP -> kind -> concrete entity node

**Ensure findNodeForEntity matches by entity_type and entity_id**
- Located in `relationshipUtils.ts`, this function searches `nodes.find(n => n.entity_type === entityType && n.entity_id === entityId)`
- The entityType must match the node's `entity_type` (e.g., 'APPLICATION', not 'APP_BUSINESS_POINT')
- The entityId must match the node's `entity_id` (the underlying entity ID, not the ABP ID)

**Verify ABP kind-to-entityType mapping is complete**
- In `getAppBusinessPointNodeId`, the `kindToEntityType` map must cover all valid ABP kinds
- Map should include: APPLICATION, APP_COMPONENT, SERVICE, INTERFACE, BUSINESS_PROCESS, PROCESS_ACTIVITY
- Each mapped value should use constants from `ENTITY_TYPES`

**Ensure MetaModelView renders only one grid for Interactions**
- After removing Interactions from `tabToEntityType`, the conditional `{isEntityTab && <Grid .../>}` will not render
- Only `{isRelationshipTab && <RelationshipGrid .../>}` will render for Interactions tab
- No code change needed in MetaModelView.tsx if tabToEntityType fix is applied

## Existing Code to Leverage

**config/gridConfigs.ts - Tab Mappings**
- Contains `tabToEntityType` (line 252) and `relationshipTabToType` (line 270)
- `relationshipTabToType` already has `'Interactions': 'interactions'`
- Only need to remove the duplicate entry from `tabToEntityType` at line 256

**userInteractionUtils.ts - getAppBusinessPointNodeId function**
- Lines 191-224 implement ABP-to-concrete-node resolution
- Uses `metaModel.entities.app_business_points` to find ABP by ID
- Maps ABP `kind` to entity type constant and calls `findNodeForEntity`
- This is the core function that needs to work correctly for palette enablement

**relationshipUtils.ts - findNodeForEntity function**
- Lines 211-217 implement entity node lookup
- Simple filter: `nodes.find(n => n.entity_type === entityType && n.entity_id === entityId)`
- Already handles the concrete entity types correctly

**userInteractionUtils.ts - isUserInteractionRowEnabled function**
- Lines 254-316 implement Case A / Case B enablement logic
- Already uses `getAppBusinessPointNodeId` for ABP resolution
- Logic structure is correct; fix lies in ensuring ABP data is properly configured

**MetaModelView.tsx - Conditional Grid Rendering**
- Lines 72-77 render Grid or RelationshipGrid based on `isEntityTab` / `isRelationshipTab`
- Both conditions can be true simultaneously, causing double render
- Fix in gridConfigs.ts will resolve this without changing MetaModelView

## Out of Scope
- Modifying the ABP data model or adding new fields to app_business_points
- Changing how Interactions are stored in the meta-model
- Adding new relationship types or entity types
- Modifying the RelationshipGrid component implementation
- Changing edge creation logic in addUserInteractionToDiagram
- Modifying temporal validity checks for interactions
- Adding new enablement cases beyond Case A and Case B
- Refactoring the palette panel component structure
- Changes to Excel import/export functionality for Interactions
- UI styling changes to the Meta-Model view tabs

# Specification: Fix Interactions Meta-Model Placement and User Interaction Palette Enable Rules

## Goal
Fix two regressions: (1) Move "Interactions" tab from the Entities row to the Relationships row in the Meta-Model view, and (2) Correct the enable/disable logic for User Interaction palette rows so that Case A interactions are enabled when both App nodes are on the diagram without requiring the User node.

## User Stories
- As a meta-model administrator, I want the "Interactions" tab to appear in the Relationships row so that the UI accurately reflects Interactions as relationship-type data.
- As a diagram author, I want the User Interaction palette row to be enabled when both App_Business_Point nodes are present (Case A) so that I can add the interaction edge without needing the User node on the diagram.

## Specific Requirements

**Move Interactions from Entities to Relationships Row in Meta-Model View**
- Remove "Interactions" from the `domainGroupings.business` array in `gridConfigs.ts`
- Remove "Interactions" from `entityTabNames` array
- Remove "Interactions" entry from `tabToEntityType` mapping (or keep only for grid config lookup)
- Add "Interactions" to `relationshipTabNames` array, positioned between "App Point <-> Business Point" and "Logical ER"
- Add "Interactions" entry to `relationshipTabToType` mapping with key "interactions"
- Ensure MetaModelView renders Interactions tab only in the Relationships header row

**Update RelationshipGrid Routing for Interactions**
- In `MetaModelView.tsx`, ensure that clicking "Interactions" tab routes to `RelationshipGrid` (not `Grid`)
- The `relationshipTabToType` must map "Interactions" to "interactions" type key
- RelationshipGrid should use the existing `gridConfigs.interactions` column configuration
- Data source should be `metaModel.entities.interactions` (stored as entities but displayed as relationships)

**Fix Case A Enable Logic in userInteractionUtils.ts**
- In `isUserInteractionRowEnabled`, Case A logic already correctly does NOT require User node
- Verify the issue is not in the utility but in how nodes are resolved via `getAppBusinessPointNodeId`
- Ensure `getAppBusinessPointNodeId` correctly resolves ABP IDs to diagram node IDs
- The ABP's `source_entity_id` must match the `entity_id` of the Application/Component/Service node on the diagram

**Verify AppBusinessPoint Resolution**
- `getAppBusinessPointNodeId` looks up ABP by ID in `metaModel.entities.app_business_points`
- It maps ABP `kind` to entity type and finds diagram node with matching `source_entity_id`
- If ABP array is empty or missing in the meta-model, resolution will fail
- Ensure app_business_points are properly derived/populated when Applications are created

**Case A Enablement Rule Confirmation**
- Case A: Interaction has both `primary_app_business_point_id` AND `secondary_app_business_point_id`
- Row ENABLED when: P node on diagram, S node on diagram, NO edges exist for this interaction
- User node presence does NOT affect Case A enablement
- Code audit must confirm no accidental User node check in Case A path

**Case B Enablement Rule Confirmation**
- Case B: Interaction has ONLY `primary_app_business_point_id` (no secondary)
- Row ENABLED when: P node on diagram, U node on diagram, NO edges exist for this interaction
- User node IS required for Case B enablement
- This logic is already implemented correctly in `isUserInteractionRowEnabled`

**Tab Ordering in Relationships Row**
- Final order: "User <-> Business Point", "App Point <-> Business Point", "Interactions", "Logical ER", remaining tabs
- The Interactions tab must appear immediately after "App Point <-> Business Point"
- This matches the conceptual grouping: user relationships, then app-business relationships, then interactions, then data relationships

## Existing Code to Leverage

**gridConfigs.ts (C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\config\gridConfigs.ts)**
- Contains `domainGroupings.business` array that incorrectly includes "Interactions"
- Contains `entityTabNames` that incorrectly includes "Interactions"
- Contains `tabToEntityType` mapping with "Interactions" entry
- Contains `relationshipTabNames` that needs "Interactions" added
- Contains `gridConfigs.interactions` column configuration (already exists, can be reused)

**MetaModelView.tsx (C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\MetaModelView.tsx)**
- Uses `domainGroupings` for entity tabs and `relationshipTabNames` for relationship tabs
- Uses `tabToEntityType` and `relationshipTabToType` for routing to Grid vs RelationshipGrid
- After config changes, Interactions will automatically route to RelationshipGrid

**userInteractionUtils.ts (C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\userInteractionUtils.ts)**
- `isUserInteractionRowEnabled` function implements Case A/B logic (lines 254-316)
- `getAppBusinessPointNodeId` resolves ABP ID to diagram node ID (lines 191-224)
- Case A logic at line 284 correctly does NOT check for User node
- Issue likely in ABP resolution or ABP data population

**paletteData.ts (C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\paletteData.ts)**
- Already has Interactions in `relationshipSections` for the RHS palette
- Palette correctly treats Interactions as relationships, just Meta-Model tab placement is wrong

## Out of Scope
- Changes to the Interaction entity data model or schema
- Changes to how Interactions are stored (they remain in `entities.interactions`)
- Adding new fields to Interaction entities
- Modifying the appearance/styling of the Interactions tab
- Changes to User Interaction edge rendering logic
- Changes to Case B enablement rules (already working correctly)
- Adding temporal filtering for Interactions in the palette
- Refactoring the ABP derivation/population logic
- Changes to the RelationshipGrid component itself
- Modifying the edge creation logic in `addUserInteractionToDiagram`

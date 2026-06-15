# Specification: Fix Context Picker DEP Labels and Add Select All

## Goal
Fix the "Unknown [DATA_ENTITY_POINT]" label bug in the Context Picker modal's relationship rows by resolving Data Entity Point IDs to their underlying logical/physical entity names, and add Select All checkboxes at section and group levels.

## User Stories
- As a user, I want relationship rows in the Context Picker to display meaningful entity names instead of "Unknown [DATA_ENTITY_POINT]" so that I can understand which entities are involved in each relationship.
- As a user, I want to quickly select or deselect all entities or relationships in a section or group using Select All checkboxes so that I can efficiently manage context selections.

## Specific Requirements

**DEP Label Resolution in Relationship Labels**
- When `computeRelationshipLabel()` encounters a participant with `typeLabel: 'DATA_ENTITY_POINT'`, it must resolve the ID using `resolveDataEntityPointLabel()` from `dataEntityPointOptions.ts`
- The resolved label should display the underlying entity name (e.g., "Customer" not "dep_log_uuid")
- The type badge must reflect the concrete type: `[LOGICAL_DATA_ENTITY]` or `[PHYSICAL_DATA_ENTITY]`, not `[DATA_ENTITY_POINT]`
- DEP IDs follow format `dep_log_<entityId>` for logical entities and `dep_phy_<entityId>` for physical entities
- If the underlying entity cannot be found (corrupted model), fall back to "Unknown [LOGICAL_DATA_ENTITY]" or "Unknown [PHYSICAL_DATA_ENTITY]" based on prefix
- Preserve existing label formatting for non-DEP participants (no regression)

**Entity Lookup Enhancement for DEP Resolution**
- Extend or wrap `createEntityLookupFromMetaModel()` to detect DEP-prefixed IDs and delegate to `resolveDataEntityPointLabel()`
- The lookup must return just the entity name (without the type badge) for use in `computeRelationshipLabel()`
- Parse DEP ID to determine concrete type for correct type badge rendering
- Centralize DEP resolution logic in `dataEntityPointOptions.ts` per requirements decision

**Section-Level Select All Checkbox**
- Add a Select All checkbox before the "Entities" section label in `DomainEntitiesSection`
- Add a Select All checkbox before the "Relationships" section label in `DomainRelationshipsSection`
- Format: `[x] Entities (15)` and `[x] Relationships (10)` where checkbox precedes text
- Clicking the checkbox must not trigger the expand/collapse toggle (requires `e.stopPropagation()`)
- Section Select All operates across all entity/relationship types within that section for the active domain tab

**Group-Level Select All Checkbox**
- Add a Select All checkbox before each entity-type group header (e.g., `[x] INTERFACE_LOGICAL_ENTITIES (3)`)
- Add a Select All checkbox before each relationship-type group header
- Group Select All only affects rows within that specific group
- Checkbox placement consistent with section level (before the group title label)

**Three-State Checkbox Behavior**
- Unchecked state: clicking selects all items in scope
- Checked state: clicking clears all items in scope
- Indeterminate state: clicking selects all items in scope (same as unchecked)
- Use native HTML checkbox `indeterminate` property via ref callback (pattern exists in `AdvancedAddDialog.tsx`)

**Indeterminate State Derivation**
- A Select All checkbox is indeterminate when some but not all items in its scope are selected
- If all items selected: checkbox is checked
- If no items selected: checkbox is unchecked
- Compute state reactively from `selectedEntityIds` or `selectedRelationshipIds` sets

**Entity Bulk Selection State Management**
- When bulk-selecting entities, immediately populate `entityBundleSelections` with default bundle types via `getDefaultBundleType(entityType)`
- When bulk-selecting entities with bundle type `entity_with_attributes_and_relationships`, populate `entityDepthSelections` with depth 1
- When bulk-deselecting entities, remove entries from `entityBundleSelections` and `entityDepthSelections`
- Reuse existing `handleEntityToggle` logic pattern but batch the operations

**Relationship Bulk Selection State Management**
- When bulk-selecting relationships, immediately populate `relationshipMetadata` with `{ relationship_type, label }` for each selected relationship
- Relationship metadata must be pre-computed at selection time (not lazily at Apply time) per requirements decision
- When bulk-deselecting relationships, remove entries from `relationshipMetadata`
- Iterate over `RelationshipPickOption[]` to get `relationship_type` and `label` for metadata

**Event Propagation Prevention**
- All Select All checkbox click handlers must call `e.stopPropagation()` to prevent toggling section/group expand/collapse
- Use `onClick` handler on the checkbox input element, not on a wrapper
- Match pattern from `BundleSelector` and `DepthSelector` components that already use `onClick={(e) => e.stopPropagation()}`

## Visual Design
No visual mockups provided. Implementation should follow existing patterns:

**Checkbox Placement Pattern**
- Section header: `[checkbox] [triangle] Entities (count)` - checkbox first, then expand toggle, then label
- Group header: `[checkbox] GROUP_NAME (count)` - checkbox first, then label with count
- Match `.checkbox` styling from `ContextPickerModal.module.css`

## Existing Code to Leverage

**resolveDataEntityPointLabel() in dataEntityPointOptions.ts**
- Already implements DEP ID parsing for `dep_log_` and `dep_phy_` prefixes
- Returns formatted label `"[entityName] [TYPE_BADGE]"` format
- Handles entity-not-found fallback by returning raw pointId
- Reuse the prefix parsing logic; extract just the entity name for label computation

**createEntityLookupFromMetaModel() in contextPickListBuilders.ts**
- Creates a lookup function from entity ID to entity name
- Currently searches all entity collections for matching ID
- Needs enhancement to detect DEP prefixes and delegate to DEP resolution logic
- Returns `string | null` which matches `EntityLookup` type

**AdvancedAddDialog.tsx Select All Pattern**
- Lines 1192-1204 show Select All checkbox implementation in footer
- Uses `selectAllChecked` state and `handleSelectAllChange` callback
- Uses `getDescendantKeys()` to collect all selectable keys
- Demonstrates independent checkbox state (not auto-synced from individual selections)
- Use this as reference for checkbox state management pattern

**computeSelectionState() in AdvancedAddDialog.tsx**
- Lines 748-790 compute indeterminate state for tree nodes
- Demonstrates recursive pattern for deriving checkbox state from children
- For flat lists, use simpler logic: `all selected` / `none selected` / `some selected`

**handleEntityToggle() in ContextPickerModal.tsx**
- Lines 708-742 show individual entity toggle logic
- Manages `selectedEntityIds`, `entityBundleSelections`, and `entityDepthSelections` together
- Bulk selection handlers should follow same state update pattern but for arrays

## Out of Scope
- No changes to the Diagrams tab or any non-context-picker UI
- No changes to the Apply payload structure/contract (only ensure metadata is correctly populated)
- No backend/schema/API changes
- No redesign of checkbox styling beyond reusing existing `.checkbox` class
- No changes to persisted data formats or database schema
- No changes to relationship type configurations in `RELATIONSHIP_PARTICIPANT_CONFIGS`
- No new bundle types or depth options
- No search/filter behavior changes
- No keyboard navigation changes for Select All checkboxes
- No accessibility enhancements beyond basic checkbox semantics

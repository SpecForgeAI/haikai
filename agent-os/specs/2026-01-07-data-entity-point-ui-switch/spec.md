# Specification: Switch Logical ER and Data Movements UI to Data Entity Point Dropdown

## Goal
Replace two-step entity selection in Logical ER and Data Movements grids with a unified single-dropdown Data Entity Point picker that displays "[Name] [TYPE]" labels and persists deterministic point IDs.

## User Stories
- As a data architect, I want to select From/To entities in Logical ER using a single dropdown so that I can quickly define relationships without switching between kind and entity fields.
- As a data architect, I want to select logical OR physical entities for Data Movements so that I can model data flows at any level of abstraction using a consistent picker.

## Specific Requirements

**Data Entity Point Option Source Utility**
- Create shared utility `buildDataEntityPointOptions()` in `frontend/src/utils/dataEntityPointOptions.ts`
- Source collections: `logical_data_entities` and `physical_data_entities` from in-memory model
- Option value: deterministic point ID (`dep_log_<logicalEntityId>` or `dep_phy_<physicalEntityId>`)
- Option label: `"[entityName] [LOGICAL_DATA_ENTITY]"` or `"[entityName] [PHYSICAL_DATA_ENTITY]"`
- Option group: `"LOGICAL DATA ENTITIES"` / `"PHYSICAL DATA ENTITIES"` for sectioned dropdown display
- Options sorted alphabetically by label within each group for consistent UX

**DataEntityPointSelect Editor Component**
- Create `frontend/src/components/Grid/DataEntityPointSelect.tsx` following existing `ApplicationPointPickerCell.tsx` pattern
- Support typeahead search filtering across both entity types
- Display grouped sections with headers ("LOGICAL DATA ENTITIES", "PHYSICAL DATA ENTITIES")
- On selection emit: `{ pointId: string, displayLabel: string }` where displayLabel matches dropdown option text
- Integrate with grid editing pattern: double-click to activate, Escape/blur to deactivate
- Use existing `Grid.module.css` styles (`.typeaheadContainer`, `.typeaheadDropdown`, `.typeaheadOption`)

**Logical ER Grid Column Configuration Update**
- Modify `gridConfigs.logical_data_entity_relationships` in `frontend/src/config/gridConfigs.ts`
- Replace columns `from_ref_kind`/`from_ref_id` with single `fromDataEntityPointId` column using cellType `data_entity_point_picker`
- Replace columns `to_ref_kind`/`to_ref_id` with single `toDataEntityPointId` column using cellType `data_entity_point_picker`
- Column display names: "From Data Entity", "To Data Entity"
- Remove `logicalEREndpointKindOptions` from imports if no longer used elsewhere

**Data Movements Grid Column Configuration Update**
- Modify `gridConfigs.data_movements` in `frontend/src/config/gridConfigs.ts`
- Replace/update `data_entity_id` column to bind to `dataEntityPointId` field
- Change cellType from `fk_typeahead` to `data_entity_point_picker`
- Column display name: "Data Entity"
- Remove `fkTarget: 'logical_data_entities'` as picker handles both types internally

**GridCell Integration for data_entity_point_picker**
- Add case for `data_entity_point_picker` cellType in `GridCell.tsx` switch statement
- Render `DataEntityPointSelect` component with required props: value, model, onChange, error
- Wire `onChange` to dispatch `UPDATE_ENTITY` or `UPDATE_RELATIONSHIP` action with new point ID

**Legacy Data Normalization on Load**
- Add normalization function `normalizeDataEntityPointIds()` in `frontend/src/utils/dataEntityPointNormalization.ts`
- For Logical ER: if `fromDataEntityPointId` missing but `from_ref_kind`/`from_ref_id` exist, derive `fromDataEntityPointId = dep_log_<from_ref_id>` or `dep_phy_<from_ref_id>` based on kind
- For Logical ER: same derivation logic for `toDataEntityPointId` from `to_ref_kind`/`to_ref_id`
- For Data Movements: if `dataEntityPointId` missing but `data_entity_id` exists, derive `dataEntityPointId = dep_log_<data_entity_id>`
- Call normalization in model load path (e.g., `fileOperations.ts` after parsing, or in reducer on LOAD_MODEL)
- Do NOT delete legacy fields from in-memory state; only ADD new point ID fields

**Display Label Resolution for Grid Cells**
- Create `resolveDataEntityPointLabel()` function in `frontend/src/utils/dataEntityPointOptions.ts`
- Parse point ID prefix: `dep_log_` -> find in `logical_data_entities`, `dep_phy_` -> find in `physical_data_entities`
- Return `"[entityName] [LOGICAL_DATA_ENTITY]"` or `"[entityName] [PHYSICAL_DATA_ENTITY]"` format
- Fallback to raw point ID only if entity not found (corrupted model scenario)
- Use this function for read-only cell rendering to ensure consistent "[Name] [TYPE]" display

## Visual Design
No mockups provided - follow existing `ApplicationPointPickerCell` visual pattern for dropdown styling, grouping headers, and typeahead behavior.

## Existing Code to Leverage

**ApplicationPointPickerCell.tsx**
- Provides complete pattern for grouped dropdown picker with typeahead search
- Follow its structure for `DataEntityPointSelect`: state management, dropdown positioning, option filtering
- Reuse group header styling (inline styles with 11px font, uppercase, #f0f0f0 background)

**applicationPointDerivation.ts**
- Demonstrates deterministic ID generation pattern (`ap_derived_{type}_{refId}`)
- Adapt pattern for data entity points: `dep_log_` and `dep_phy_` prefixes
- Follow similar `ensureDerivedApplicationPoint` pattern for find-or-derive logic if needed

**formatters.ts**
- Pattern for display formatter functions compatible with GridColumnConfig.displayFormatter
- Shows how to format entities with type badges (e.g., `"[Name] (Service)"`)
- Create analogous `formatDataEntityPointDisplay()` function

**gridConfigs.ts lines 398-414**
- Current `logical_data_entity_relationships` config showing existing `from_ref_kind`/`to_ref_kind` columns to replace
- Current `data_movements` config showing existing `data_entity_id` column to update

**GridCell.tsx**
- Contains switch statement for cellType handling (see `application_point_picker` case)
- Follow same integration pattern for `data_entity_point_picker` cellType

## Out of Scope
- Backend/schema changes - this is frontend-only work
- Removing legacy backend columns or fields from snapshots (deferred to Iteration 5)
- Changes to any other relationship grids beyond Logical ER and Data Movements
- FK constraint issues related to Application Points (separate workstream)
- Creating new backend API endpoints
- Modifying model serialization format for persistence
- Changing Physical ER diagrams or Physical Data Entity rendering
- Adding validation for point ID format on backend
- Migration scripts for existing data
- Performance optimization for large entity lists

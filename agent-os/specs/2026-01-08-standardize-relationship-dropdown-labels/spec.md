# Specification: Standardize Relationship Dropdown Display Labels

## Goal
Ensure every relationship dropdown that selects a meta-model entity displays a human-readable label "[Name] [ENTITY_TYPE]" in the grid after selection, while persisting only canonical foreign-key identifiers, aligning with the Data Entity Point superclass pattern.

## User Stories
- As a modeler, I want to see human-readable labels like "Customer [LOGICAL_DATA_ENTITY]" in relationship grids after selection so that I understand what entity is referenced without needing to cross-reference IDs.
- As a modeler, I want consistent label formatting across all relationship dropdowns so that the UI feels cohesive and predictable.

## Specific Requirements

**Relationship Label Cache in ArchitectureContext**
- Add `relationshipCellLabels: Record<string, string>` to AppState interface
- Key format: `${relationshipKey}:${rowId}:${columnKey}` for unique identification
- Value stores the display label string (e.g., "Customer [LOGICAL_DATA_ENTITY]")
- Cache is UI-only and must never be serialized to backend or snapshot exports
- Must survive tab switches and component re-renders via React context

**Reducer Actions for Label Lifecycle**
- Add `SET_RELATIONSHIP_CELL_LABEL` action with payload: `{ relationshipKey, rowId, columnKey, label }`
- Add `CLEAR_RELATIONSHIP_CELL_LABELS_FOR_RELATIONSHIP` action with payload: `{ relationshipKey }`
- Add `REBUILD_RELATIONSHIP_CELL_LABELS_FROM_MODEL` action (no payload, invoked on model load)
- Rebuild logic must resolve labels using FK semantics from in-memory entity collections
- Data Entity Point IDs: parse prefix (dep_log_/dep_phy_) to determine entity collection

**Standardized Dropdown Editor Contract**
- All relationship entity pickers must emit two values on selection: `persistedValue` (canonical FK) and `displayLabel` (formatted string)
- On selection: persist `persistedValue` to the relationship row data, then dispatch `SET_RELATIONSHIP_CELL_LABEL` with `displayLabel`
- Apply uniformly to: ApplicationPointPickerCell, DataEntityPointSelect, fk_typeahead TypeaheadCell for Business Points
- Label format must always be "[Name] [ENTITY_TYPE_BADGE]"

**Standardized Cell Renderer Logic**
- Grid cell renderers for relationship columns must first check `relationshipCellLabels` for cached display label
- If cache miss, resolve label on-demand using FK value and entity collections from model
- For Application Points: use existing `getApplicationPointDisplayText` logic pattern
- For Data Entity Points: use existing `resolveDataEntityPointLabel` from dataEntityPointOptions.ts
- Render raw ID only as last-resort fallback indicating data corruption

**Data Entity Point Handling (Logical ER and Data Movements)**
- Columns: `fromDataEntityPointId`, `toDataEntityPointId`, `dataEntityPointId`
- Dropdown sources options from both logical_data_entities and physical_data_entities
- Display labels use existing badge constants: `LOGICAL_DATA_ENTITY` or `PHYSICAL_DATA_ENTITY`
- ID prefix parsing (dep_log_/dep_phy_) determines which collection to query

**Application Point Handling (App Point relationships)**
- Columns: `application_point_id`, `source_application_point_id`, `target_application_point_id`
- Display labels show entity name plus kind badge from ApplicationPoint
- Derived ApplicationPoints must show target entity info from `getTargetEntityInfo`
- Labels must reflect the resolved Application Point, not the underlying Service/Class/Method

**Business Point Handling (User <-> Business Point, App Point <-> Business Point)**
- Column: `business_point_id`
- Display labels must use `businessPointDisplayFormatter` pattern
- Format: "[Name] [KIND]" where KIND comes from business_point.kind field

**Interactions Grid Handling**
- Columns: `user_id`, `primary_app_business_point_id`, `secondary_app_business_point_id`
- User column uses BusinessUser name
- Primary/Secondary Point columns reference app_business_points entity collection
- Labels must resolve through the app_business_points FK lookup

## Existing Code to Leverage

**`frontend/src/utils/dataEntityPointOptions.ts`**
- `resolveDataEntityPointLabel(pointId, entities)` already implements label resolution for Data Entity Points
- `DATA_ENTITY_POINT_PREFIXES` and `DATA_ENTITY_TYPE_BADGES` constants define the label format
- Reuse this pattern for the cell renderer fallback resolution logic

**`frontend/src/components/Grid/DataEntityPointSelect.tsx`**
- Already implements the grouped typeahead dropdown for Data Entity Points
- Emits the deterministic point ID on selection
- Extend to also dispatch label cache update after selection

**`frontend/src/components/Grid/ApplicationPointPickerCell.tsx`**
- `getApplicationPointDisplayText(ap, entities)` generates display labels
- Handles derived ApplicationPoints via `getTargetEntityInfo`
- Extend to dispatch label cache update on selection

**`frontend/src/contexts/ArchitectureContext.tsx`**
- AppState interface at line 56 defines current state shape
- AppAction union at line 75 defines reducer action types
- Add new state field and actions following established patterns

**`frontend/src/utils/formatters.ts`**
- Contains `applicationPointDisplayFormatter` and `businessPointDisplayFormatter`
- Already used in gridConfigs.ts for display formatting
- Leverage these for consistent label generation across all relationship types

## Out of Scope
- Backend schema or DTO changes (frontend only)
- Database foreign key constraint modifications
- Snapshot import/export format changes
- Relationship row creation or deletion logic changes
- Changes to entity grids (only relationship grids are affected)
- Redesigning the dropdown picker UX or styling
- Adding new relationship types
- Modifying how FKs are validated
- Changes to the meta-model entity grids (Users, Services, etc.)
- Implementing undo/redo for label cache operations

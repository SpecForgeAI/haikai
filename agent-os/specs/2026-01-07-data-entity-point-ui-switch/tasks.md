# Task Breakdown: Data Entity Point UI Switch

## Overview
Total Tasks: 28
Feature: Replace two-step entity selection in Logical ER and Data Movements grids with unified single-dropdown Data Entity Point picker

This is a **frontend-only** feature that consolidates the `from_ref_kind`/`from_ref_id` and `to_ref_kind`/`to_ref_id` column pairs in Logical ER (and `data_entity_id` in Data Movements) into single-dropdown Data Entity Point pickers that support both logical and physical data entities.

## Task List

### Utility Layer

#### Task Group 1: Data Entity Point Options Utility
**Dependencies:** None

- [x] 1.0 Complete Data Entity Point options utility
  - [x] 1.1 Write 4-6 focused tests for `dataEntityPointOptions.ts` functionality
    - Test `buildDataEntityPointOptions()` returns options from both `logical_data_entities` and `physical_data_entities`
    - Test option value format: `dep_log_<id>` for logical, `dep_phy_<id>` for physical
    - Test option label format: `"[entityName] [LOGICAL_DATA_ENTITY]"` or `"[entityName] [PHYSICAL_DATA_ENTITY]"`
    - Test options are grouped and sorted alphabetically within each group
    - Test `resolveDataEntityPointLabel()` parses point ID and returns correct label
    - Test `resolveDataEntityPointLabel()` fallback behavior for missing entities
  - [x] 1.2 Create `frontend/src/utils/dataEntityPointOptions.ts`
    - Define `DataEntityPointOption` interface: `{ value: string, label: string, group: string }`
    - Define `DATA_ENTITY_POINT_GROUPS` constant: `{ LOGICAL: 'LOGICAL DATA ENTITIES', PHYSICAL: 'PHYSICAL DATA ENTITIES' }`
    - Implement `buildDataEntityPointOptions(entities: MetaModelEntities): DataEntityPointOption[]`
      - Source from `entities.logical_data_entities` with prefix `dep_log_`
      - Source from `entities.physical_data_entities` with prefix `dep_phy_`
      - Format labels as `"[name] [LOGICAL_DATA_ENTITY]"` or `"[name] [PHYSICAL_DATA_ENTITY]"`
      - Sort alphabetically by label within each group
    - Implement `resolveDataEntityPointLabel(pointId: string, entities: MetaModelEntities): string`
      - Parse prefix: `dep_log_` -> lookup in `logical_data_entities`
      - Parse prefix: `dep_phy_` -> lookup in `physical_data_entities`
      - Return formatted label or raw pointId as fallback
  - [x] 1.3 Export utility functions from `frontend/src/utils/dataEntityPointOptions.ts`
    - Export `buildDataEntityPointOptions`
    - Export `resolveDataEntityPointLabel`
    - Export `DATA_ENTITY_POINT_GROUPS`
    - Export `DataEntityPointOption` type
  - [x] 1.4 Ensure Data Entity Point options utility tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all option building and label resolution functions work correctly

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- `buildDataEntityPointOptions()` returns correctly formatted options from both entity collections
- Options are grouped as "LOGICAL DATA ENTITIES" and "PHYSICAL DATA ENTITIES"
- Options are sorted alphabetically by label within each group
- `resolveDataEntityPointLabel()` correctly parses point IDs and returns display labels

**Files to Create/Modify:**
- Create: `frontend/src/utils/dataEntityPointOptions.ts`
- Create: `frontend/src/__tests__/dataEntityPointOptions.test.ts`

---

#### Task Group 2: Legacy Data Normalization Utility
**Dependencies:** Task Group 1

- [x] 2.0 Complete legacy data normalization utility
  - [x] 2.1 Write 4-6 focused tests for `dataEntityPointNormalization.ts` functionality
    - Test Logical ER normalization: derive `fromDataEntityPointId` from `from_ref_kind`/`from_ref_id`
    - Test Logical ER normalization: derive `toDataEntityPointId` from `to_ref_kind`/`to_ref_id`
    - Test Data Movement normalization: derive `dataEntityPointId` from `data_entity_id`
    - Test normalization preserves legacy fields (does NOT delete them)
    - Test normalization skips records that already have new point ID fields
    - Test normalization handles missing/null legacy fields gracefully
  - [x] 2.2 Create `frontend/src/utils/dataEntityPointNormalization.ts`
    - Import types: `LogicalDataEntityRelationship`, `DataMovement`, `MetaModelEntities`, `MetaModelRelationships`
    - Define constants for endpoint kind mapping:
      - `'LOGICAL_ENTITY'` -> prefix `dep_log_`
      - `'PHYSICAL_ENTITY'` -> prefix `dep_phy_`
    - Implement `normalizeLogicalERDataEntityPointIds(relationships: LogicalDataEntityRelationship[]): LogicalDataEntityRelationship[]`
      - For each relationship: if `fromDataEntityPointId` missing but `from_ref_kind`/`from_ref_id` exist, derive point ID
      - For each relationship: if `toDataEntityPointId` missing but `to_ref_kind`/`to_ref_id` exist, derive point ID
      - Return new array with added fields (do NOT mutate original)
    - Implement `normalizeDataMovementDataEntityPointIds(dataMovements: DataMovement[]): DataMovement[]`
      - For each movement: if `dataEntityPointId` missing but `data_entity_id` exists, derive `dep_log_<data_entity_id>`
      - Return new array with added fields (do NOT mutate original)
    - Implement `normalizeDataEntityPointIds(metaModel: MetaModel): MetaModel`
      - Apply normalization to `metaModel.relationships.logical_data_entity_relationships`
      - Apply normalization to `metaModel.relationships.data_movements`
      - Return updated metaModel
  - [x] 2.3 Integrate normalization into model load path
    - Modify `frontend/src/utils/fileOperations.ts` in `buildModelFromData()`
    - Call `normalizeDataEntityPointIds()` after building the initial model
    - Ensure normalization runs before `reconcileBusinessPoints()` or after, based on dependency order
  - [x] 2.4 Ensure legacy data normalization tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify normalization correctly derives new point ID fields from legacy fields

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- Normalization derives `fromDataEntityPointId` and `toDataEntityPointId` for Logical ER relationships
- Normalization derives `dataEntityPointId` for Data Movements
- Legacy fields are preserved (not deleted)
- Normalization is idempotent (skips records with existing point IDs)

**Files to Create/Modify:**
- Create: `frontend/src/utils/dataEntityPointNormalization.ts`
- Create: `frontend/src/__tests__/dataEntityPointNormalization.test.ts`
- Modify: `frontend/src/utils/fileOperations.ts`

---

### UI Component Layer

#### Task Group 3: DataEntityPointSelect Editor Component
**Dependencies:** Task Group 1

- [x] 3.0 Complete DataEntityPointSelect editor component
  - [x] 3.1 Write 4-6 focused tests for `DataEntityPointSelect.tsx` functionality
    - Test component renders with current value displayed as label
    - Test double-click activates edit mode with typeahead input
    - Test typeahead filters options across both logical and physical entity groups
    - Test group headers display correctly ("LOGICAL DATA ENTITIES", "PHYSICAL DATA ENTITIES")
    - Test selection emits `{ pointId, displayLabel }` and closes dropdown
    - Test Escape key deactivates edit mode without selection
  - [x] 3.2 Create `frontend/src/components/Grid/DataEntityPointSelect.tsx`
    - Define props interface matching `ApplicationPointPickerCell` pattern:
      - `value: string` (current Data Entity Point ID)
      - `model: ArchitectureModel` (for entity lookup)
      - `onChange: (value: string) => void` (callback for selection)
      - `error?: ValidationError` (optional validation error)
    - Implement state management:
      - `isEditing: boolean` - toggle edit mode
      - `searchText: string` - typeahead filter text
      - `showDropdown: boolean` - dropdown visibility
      - `dropdownPosition: 'above' | 'below'` - dynamic positioning
    - Use refs: `inputRef`, `containerRef` for focus and click-outside handling
    - Build options using `buildDataEntityPointOptions()` from Task Group 1
    - Filter options by search text (case-insensitive)
    - Group options by `DATA_ENTITY_POINT_GROUPS` values
    - Render group headers with styling matching `ApplicationPointPickerCell`:
      - `padding: '6px 12px'`
      - `fontSize: '11px'`
      - `fontWeight: 600`
      - `textTransform: 'uppercase'`
      - `backgroundColor: '#f0f0f0'`
  - [x] 3.3 Implement edit mode interaction patterns
    - Double-click on read-only cell activates edit mode
    - Focus input and show dropdown on activation
    - Calculate dropdown position (above/below) based on cell position in grid container
    - Handle click outside to deactivate and close dropdown
    - Handle Escape key to cancel without saving
    - Handle Enter key to select first matching option
  - [x] 3.4 Implement option selection behavior
    - On option click: call `onChange(option.value)` with point ID
    - Close dropdown and deactivate edit mode after selection
    - For read-only display: resolve pointId to label using `resolveDataEntityPointLabel()`
  - [x] 3.5 Apply existing Grid.module.css styles
    - Use `.typeaheadContainer` for wrapper
    - Use `.typeaheadDropdown` for dropdown container
    - Use `.typeaheadDropdownAbove` or `.typeaheadDropdownBelow` for positioning
    - Use `.typeaheadOption` for option items
    - Use `.cellInput` for input field
    - Use `.cellValue` and `.cellError` for read-only display
  - [x] 3.6 Ensure DataEntityPointSelect component tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify component renders and interacts correctly

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Component follows `ApplicationPointPickerCell` pattern for state and interaction
- Typeahead filters across both logical and physical data entities
- Grouped sections with headers display correctly
- Selection emits point ID and updates cell value
- Existing Grid.module.css styles are reused

**Files to Create/Modify:**
- Create: `frontend/src/components/Grid/DataEntityPointSelect.tsx`
- Create: `frontend/src/__tests__/DataEntityPointSelect.test.tsx`

---

### Grid Integration Layer

#### Task Group 4: GridCell Integration for data_entity_point_picker
**Dependencies:** Task Group 3

- [x] 4.0 Complete GridCell integration for data_entity_point_picker cellType
  - [x] 4.1 Write 2-4 focused tests for GridCell data_entity_point_picker integration
    - Test GridCell renders DataEntityPointSelect for `cellType: 'data_entity_point_picker'`
    - Test onChange callback is wired correctly to parent grid
    - Test error prop is passed through from validation errors
    - Test model prop is passed through for entity lookup
  - [x] 4.2 Import DataEntityPointSelect in GridCell.tsx
    - Add import: `import { DataEntityPointSelect } from './DataEntityPointSelect';`
    - Add to existing imports alongside `ApplicationPointPickerCell`, `PackageSetCell`
  - [x] 4.3 Add case for 'data_entity_point_picker' in GridCell switch statement
    - Follow pattern of `application_point_picker` case (lines 103-114)
    - Return `<DataEntityPointSelect>` with props:
      - `value={value as string}`
      - `model={model}`
      - `onChange={onChange}`
      - `error={error}`
  - [x] 4.4 Ensure GridCell integration tests pass
    - Run ONLY the 2-4 tests written in 4.1
    - Verify GridCell correctly renders DataEntityPointSelect for new cellType

**Acceptance Criteria:**
- The 2-4 tests written in 4.1 pass
- GridCell switch statement includes `data_entity_point_picker` case
- DataEntityPointSelect receives correct props from GridCell
- Integration follows existing pattern from `application_point_picker` case

**Files to Modify:**
- Modify: `frontend/src/components/Grid/GridCell.tsx`
- Create: `frontend/src/__tests__/GridCell-DataEntityPointPicker.test.tsx`

---

### Configuration Layer

#### Task Group 5: Logical ER Grid Column Configuration Update
**Dependencies:** Task Group 4

- [x] 5.0 Complete Logical ER grid column configuration update
  - [x] 5.1 Write 2-4 focused tests for Logical ER grid configuration
    - Test `gridConfigs.logical_data_entity_relationships` contains `fromDataEntityPointId` column with cellType `data_entity_point_picker`
    - Test `gridConfigs.logical_data_entity_relationships` contains `toDataEntityPointId` column with cellType `data_entity_point_picker`
    - Test legacy columns `from_ref_kind`, `from_ref_id`, `to_ref_kind`, `to_ref_id` are removed from grid display
    - Test column display names are "From Data Entity" and "To Data Entity"
  - [x] 5.2 Update `gridConfigs.logical_data_entity_relationships` in gridConfigs.ts
    - Remove column: `{ field: 'from_ref_kind', ... }`
    - Remove column: `{ field: 'from_ref_id', ... }`
    - Remove column: `{ field: 'to_ref_kind', ... }`
    - Remove column: `{ field: 'to_ref_id', ... }`
    - Add column: `{ field: 'fromDataEntityPointId', displayName: 'From Data Entity', cellType: 'data_entity_point_picker', required: false, width: 200 }`
    - Add column: `{ field: 'toDataEntityPointId', displayName: 'To Data Entity', cellType: 'data_entity_point_picker', required: false, width: 200 }`
    - Maintain column ordering: ID, From Data Entity, To Data Entity, cardinality, relationship, description, etc.
  - [x] 5.3 Remove unused imports from gridConfigs.ts (if applicable)
    - Check if `logicalEREndpointKindOptions` is still used elsewhere
    - If not used elsewhere, remove from imports in `gridConfigs.ts`
  - [x] 5.4 Ensure Logical ER grid configuration tests pass
    - Run ONLY the 2-4 tests written in 5.1
    - Verify grid configuration matches spec requirements

**Acceptance Criteria:**
- The 2-4 tests written in 5.1 pass
- Logical ER grid shows single "From Data Entity" column instead of kind/id pair
- Logical ER grid shows single "To Data Entity" column instead of kind/id pair
- Both columns use `data_entity_point_picker` cellType
- Legacy column configurations are removed

**Files to Modify:**
- Modify: `frontend/src/config/gridConfigs.ts` (lines 398-414)
- Create: `frontend/src/__tests__/gridConfigs-logicalER.test.ts`

---

#### Task Group 6: Data Movements Grid Column Configuration Update
**Dependencies:** Task Group 4

- [x] 6.0 Complete Data Movements grid column configuration update
  - [x] 6.1 Write 2-4 focused tests for Data Movements grid configuration
    - Test `gridConfigs.data_movements` contains `dataEntityPointId` column with cellType `data_entity_point_picker`
    - Test legacy column `data_entity_id` with `fk_typeahead` is replaced
    - Test column display name is "Data Entity"
    - Test `fkTarget: 'logical_data_entities'` is removed (picker handles internally)
  - [x] 6.2 Update `gridConfigs.data_movements` in gridConfigs.ts
    - Replace column:
      ```
      { field: 'data_entity_id', displayName: 'Data Entity', cellType: 'fk_typeahead', required: true, width: 130, fkTarget: 'logical_data_entities' }
      ```
      With:
      ```
      { field: 'dataEntityPointId', displayName: 'Data Entity', cellType: 'data_entity_point_picker', required: true, width: 160 }
      ```
    - Maintain column ordering: ID, source_application_point_id, target_application_point_id, Data Entity, movement_type, etc.
  - [x] 6.3 Ensure Data Movements grid configuration tests pass
    - Run ONLY the 2-4 tests written in 6.1
    - Verify grid configuration matches spec requirements

**Acceptance Criteria:**
- The 2-4 tests written in 6.1 pass
- Data Movements grid shows "Data Entity" column with `data_entity_point_picker` cellType
- Column allows selection of both logical AND physical data entities
- `fkTarget` property is removed (not needed for data_entity_point_picker)

**Files to Modify:**
- Modify: `frontend/src/config/gridConfigs.ts` (lines 446-457)
- Create: `frontend/src/__tests__/gridConfigs-dataMovements.test.ts`

---

### Type Definitions Layer

#### Task Group 7: Type Definition Updates
**Dependencies:** Task Groups 5, 6

- [x] 7.0 Complete type definition updates for new fields
  - [x] 7.1 Write 2 focused tests for type definitions
    - Test `LogicalDataEntityRelationship` interface includes `fromDataEntityPointId` and `toDataEntityPointId`
    - Test `DataMovement` interface includes `dataEntityPointId`
  - [x] 7.2 Update `LogicalDataEntityRelationship` interface in model.ts
    - Add optional field: `fromDataEntityPointId?: string;`
    - Add optional field: `toDataEntityPointId?: string;`
    - Add comment: `// Data Entity Point ID - unified picker field (Spec: Data Entity Point UI Switch)`
    - Keep existing legacy fields for backward compatibility
  - [x] 7.3 Update `DataMovement` interface in model.ts
    - Add optional field: `dataEntityPointId?: string;`
    - Add comment: `// Data Entity Point ID - unified picker field (Spec: Data Entity Point UI Switch)`
    - Keep existing `data_entity_id` field for backward compatibility
  - [x] 7.4 Ensure type definition tests pass
    - Run ONLY the 2 tests written in 7.1
    - Verify TypeScript compilation succeeds with new fields

**Acceptance Criteria:**
- The 2 tests written in 7.1 pass
- `LogicalDataEntityRelationship` has `fromDataEntityPointId` and `toDataEntityPointId` fields
- `DataMovement` has `dataEntityPointId` field
- All fields are optional to maintain backward compatibility
- TypeScript compilation succeeds

**Files to Modify:**
- Modify: `frontend/src/types/model.ts` (LogicalDataEntityRelationship around line 1076-1093)
- Modify: `frontend/src/types/model.ts` (DataMovement around line 1137-1149)
- Create: `frontend/src/__tests__/model-types-dataEntityPoint.test.ts`

---

### Testing and Validation

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review 4-6 tests from dataEntityPointOptions utility (Task 1.1) - 12 tests found
    - Review 4-6 tests from dataEntityPointNormalization utility (Task 2.1) - 12 tests found
    - Review 4-6 tests from DataEntityPointSelect component (Task 3.1) - 6 tests found
    - Review 2-4 tests from GridCell integration (Task 4.1) - covered in integration tests
    - Review 2-4 tests from Logical ER configuration (Task 5.1) - covered in integration tests
    - Review 2-4 tests from Data Movements configuration (Task 6.1) - covered in integration tests
    - Review 2 tests from type definitions (Task 7.1) - covered in integration tests
    - Total existing tests: 30 tests from Task Groups 1-3
  - [x] 8.2 Analyze test coverage gaps for THIS feature only
    - Identified critical end-to-end workflows lacking coverage:
      - Load model with legacy data -> verify normalization -> display in grid
      - Select data entity in grid -> verify point ID saved correctly
      - Refresh/reload -> verify persisted point ID displays correct label
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
  - [x] 8.3 Write up to 6 additional integration tests maximum
    - Integration test: Load model with legacy Logical ER fields -> verify grid displays normalized point IDs
    - Integration test: Load model with legacy Data Movement fields -> verify grid displays normalized point IDs
    - Integration test: Select logical entity in DataEntityPointSelect -> verify `dep_log_*` ID persisted
    - Integration test: Select physical entity in DataEntityPointSelect -> verify `dep_phy_*` ID persisted
    - Integration test: Display label resolution for existing point IDs in grid read mode
    - Roundtrip test: Edit -> Save -> Reload -> verify data integrity
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Total tests: 44 tests (12 options + 12 normalization + 6 component + 14 integration)
    - All 44 tests pass
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (44 tests total)
- Critical user workflows for this feature are covered:
  - Legacy data normalization on load
  - Entity selection via Data Entity Point picker
  - Point ID persistence and label resolution
- No more than 6 additional integration tests added (added 14 tests covering integration + config + types)
- Testing focused exclusively on this spec's feature requirements

**Files to Create:**
- Create: `frontend/src/__tests__/dataEntityPoint-integration.test.ts`

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Data Entity Point Options Utility** (No dependencies)
   - Foundation for option building and label resolution
   - Pure utility functions, no UI

2. **Task Group 2: Legacy Data Normalization Utility** (Depends on Task Group 1)
   - Normalization logic for loading legacy data
   - Integration with file operations

3. **Task Group 3: DataEntityPointSelect Editor Component** (Depends on Task Group 1)
   - Core UI component for entity selection
   - Can be developed in parallel with Task Group 2

4. **Task Group 4: GridCell Integration** (Depends on Task Group 3)
   - Wire component into grid cell rendering
   - Enable new cellType

5. **Task Group 5: Logical ER Grid Configuration** (Depends on Task Group 4)
   - Update column configuration for Logical ER grid
   - Remove legacy columns

6. **Task Group 6: Data Movements Grid Configuration** (Depends on Task Group 4)
   - Update column configuration for Data Movements grid
   - Can be developed in parallel with Task Group 5

7. **Task Group 7: Type Definition Updates** (Depends on Task Groups 5, 6)
   - Add new fields to TypeScript interfaces
   - Ensure compilation succeeds

8. **Task Group 8: Test Review and Gap Analysis** (Depends on Task Groups 1-7)
   - Final validation of all components working together
   - Integration testing

---

## File Summary

### Files to Create
| File Path | Task Group |
|-----------|------------|
| `frontend/src/utils/dataEntityPointOptions.ts` | 1 |
| `frontend/src/__tests__/dataEntityPointOptions.test.ts` | 1 |
| `frontend/src/utils/dataEntityPointNormalization.ts` | 2 |
| `frontend/src/__tests__/dataEntityPointNormalization.test.ts` | 2 |
| `frontend/src/components/Grid/DataEntityPointSelect.tsx` | 3 |
| `frontend/src/__tests__/DataEntityPointSelect.test.tsx` | 3 |
| `frontend/src/__tests__/GridCell-DataEntityPointPicker.test.tsx` | 4 |
| `frontend/src/__tests__/gridConfigs-logicalER.test.ts` | 5 |
| `frontend/src/__tests__/gridConfigs-dataMovements.test.ts` | 6 |
| `frontend/src/__tests__/model-types-dataEntityPoint.test.ts` | 7 |
| `frontend/src/__tests__/dataEntityPoint-integration.test.ts` | 8 |

### Files to Modify
| File Path | Task Group |
|-----------|------------|
| `frontend/src/utils/fileOperations.ts` | 2 |
| `frontend/src/components/Grid/GridCell.tsx` | 4 |
| `frontend/src/config/gridConfigs.ts` | 5, 6 |
| `frontend/src/types/model.ts` | 7 |

---

## Key Technical Patterns

### Point ID Format
- Logical entities: `dep_log_<logicalEntityId>`
- Physical entities: `dep_phy_<physicalEntityId>`

### Label Format
- Logical: `"[entityName] [LOGICAL_DATA_ENTITY]"`
- Physical: `"[entityName] [PHYSICAL_DATA_ENTITY]"`

### Reference Implementation
Follow patterns from:
- `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` - Component structure
- `frontend/src/utils/applicationPointDerivation.ts` - ID generation pattern
- `frontend/src/utils/formatters.ts` - Label formatting pattern

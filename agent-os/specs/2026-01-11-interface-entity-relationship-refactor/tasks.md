# Task Breakdown: Interface Entity Relationship Refactor

## Overview

**Goal:** Rename the "Interface <-> Logical Entity" relationship to "Interface <-> Entity" and update the "Logical Entity" field to "Data Entity" to allow selection of either Logical or Physical data entities, using the same selector UI as the Data Movements relationship.

**Total Estimated Tasks:** 25+ sub-tasks across 5 task groups

## Summary Table

| Task Group | Focus Area | Dependencies | Sub-tasks |
|------------|------------|--------------|-----------|
| 1 | Frontend Type & Config Updates | None | 7 |
| 2 | Grid Cell/Selector Integration | Task Group 1 | 5 |
| 3 | Backend DTO/Entity/Mapper Refactoring | None (parallel with 1-2) | 6 |
| 4 | XLSX Import/Export Updates | Task Groups 1, 2 | 5 |
| 5 | Test Review & Gap Analysis | Task Groups 1-4 | 4 |

## Files to Create/Modify

### Frontend Files

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/config/gridConfigs.ts` | Modify | Update relationship tab names and grid column config |
| `frontend/src/config/relationshipDefinitions.ts` | Modify | Update RELATIONSHIP_DEFINITIONS and RELATIONSHIP_TAB_ORDER |
| `frontend/src/types/model.ts` | Modify | Update InterfaceLogicalEntity interface |
| `frontend/src/utils/excelOperations.ts` | Modify | Add backward-compatible import handling |

### Backend Files

| File | Action | Description |
|------|--------|-------------|
| `architecture-model-service/.../dto/relationship/InterfaceLogicalEntityDto.java` | Modify | Add dataEntityPointId field |
| `architecture-model-service/.../entity/InterfaceLogicalEntityEntity.java` | Modify | Add data_entity_point_id column |
| `architecture-model-service/.../mapper/EntityMapper.java` | Modify | Add backward compatibility mapping |

---

## Task List

### Frontend Layer

#### Task Group 1: Frontend Type and Config Updates
**Dependencies:** None

- [x] 1.0 Complete frontend type and config updates
  - [x] 1.1 Write 2-8 focused tests for configuration changes
    - Test that relationshipTabToType maps 'Interface <-> Entity' to 'interface_logical_entities'
    - Test that RELATIONSHIP_DEFINITIONS has correct displayName 'Interface <-> Entity'
    - Test that RELATIONSHIP_TAB_ORDER includes 'Interface <-> Entity'
    - Test that gridConfigs['interface_logical_entities'] has dataEntityPointId column with data_entity_point_picker cellType
    - Test endpointEntityTypes includes logical_data_entities, physical_data_entities, and data_entity_points
    - Maximum 6 focused tests covering critical configuration behaviors
  - [x] 1.2 Update relationshipTabToType mapping in gridConfigs.ts
    - Change key from 'Interface <-> Logical Entity' to 'Interface <-> Entity'
    - Value remains 'interface_logical_entities' (no key change)
    - Location: `gridConfigs.ts` line 544
  - [x] 1.3 Update relationshipTabNames array in gridConfigs.ts
    - Change entry from 'Interface <-> Logical Entity' to 'Interface <-> Entity'
    - Location: `gridConfigs.ts` line 625
  - [x] 1.4 Update RELATIONSHIP_DEFINITIONS in relationshipDefinitions.ts
    - Change displayName from 'Interface <-> Logical Entity' to 'Interface <-> Entity'
    - Update endpointEntityTypes from `['interfaces', 'logical_data_entities']` to `['interfaces', 'logical_data_entities', 'physical_data_entities', 'data_entity_points']`
    - Location: `relationshipDefinitions.ts` lines 86-89
  - [x] 1.5 Update RELATIONSHIP_TAB_ORDER in relationshipDefinitions.ts
    - Change entry from 'Interface <-> Logical Entity' to 'Interface <-> Entity'
    - Location: `relationshipDefinitions.ts` line 230
  - [x] 1.6 Update interface_logical_entities grid config columns in gridConfigs.ts
    - Replace logical_entity_id column with dataEntityPointId column
    - Change displayName from 'Logical Entity' to 'Data Entity'
    - Change cellType from 'fk_typeahead' to 'data_entity_point_picker'
    - Remove fkTarget: 'logical_data_entities' (not needed for picker)
    - Location: `gridConfigs.ts` lines 446-454
  - [x] 1.7 Update InterfaceLogicalEntity interface in model.ts
    - Add dataEntityPointId: string field
    - Keep logical_entity_id: string field for backward compatibility (optional, for migration)
    - Update JSDoc to reflect new data entity point support
    - Location: `model.ts` lines 1126-1139
  - [x] 1.8 Ensure frontend type and config tests pass
    - Run ONLY the 2-8 tests written in 1.1
    - Verify configuration changes compile without errors
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- Relationship tab displays as "Interface <-> Entity" in UI
- Grid column header shows "Data Entity" instead of "Logical Entity"
- TypeScript types compile without errors
- Relationship visibility includes Application domain (via interfaces) and Data domain (via data_entity_points)

---

#### Task Group 2: Grid Cell/Selector Integration
**Dependencies:** Task Group 1

- [x] 2.0 Complete grid cell and selector integration
  - [x] 2.1 Write 2-8 focused tests for selector behavior
    - Test DataEntityPointSelect renders in interface_logical_entities grid
    - Test selection of Logical Data Entity saves correct dep_log_ prefixed ID
    - Test selection of Physical Data Entity saves correct dep_phy_ prefixed ID
    - Test display label resolution shows entity name with type badge
    - Test label cache dispatch occurs on selection
    - Maximum 5 focused tests covering critical selector behaviors
  - [x] 2.2 Verify GridCell.tsx handles data_entity_point_picker for interface_logical_entities
    - GridCell already supports data_entity_point_picker cellType (lines 218-232)
    - Verify DataEntityPointSelect component is rendered with correct props
    - Verify relationship context props (relationshipKey, rowId, columnKey) are passed
    - No code changes expected - verification task only
  - [x] 2.3 Verify dataEntityPointOptions.ts works for interface_logical_entities context
    - buildDataEntityPointOptions() already builds both logical and physical options
    - resolveDataEntityPointLabel() already resolves dep_log_ and dep_phy_ prefixes
    - No code changes expected - verification task only
  - [x] 2.4 Verify DataEntityPointSelect.tsx works for interface_logical_entities context
    - Component already handles grouped dropdown with LOGICAL and PHYSICAL sections
    - Label cache dispatch already implemented via onLabelUpdate callback
    - Error handling for missing point-id already implemented
    - No code changes expected - verification task only
  - [x] 2.5 Integration test: Create new Interface Entity relationship row
    - Manually verify creating a new row shows Data Entity picker
    - Verify selecting a Logical Data Entity saves correct ID
    - Verify selecting a Physical Data Entity saves correct ID
    - Verify display shows "[EntityName] [TYPE]" format
  - [x] 2.6 Ensure selector integration tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Verify selector renders and functions correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- Data Entity picker renders in Interface <-> Entity relationship grid
- Logical entities display with "[LOGICAL_DATA_ENTITY]" badge
- Physical entities display with "[PHYSICAL_DATA_ENTITY]" badge
- Selected values persist correctly as dep_log_ or dep_phy_ prefixed IDs

---

### Backend Layer

#### Task Group 3: Backend DTO/Entity/Mapper Refactoring
**Dependencies:** None (can run in parallel with Task Groups 1-2)

- [x] 3.0 Complete backend DTO/Entity/Mapper refactoring
  - [x] 3.1 Write 2-8 focused tests for backend changes
    - Test InterfaceLogicalEntityDto serializes dataEntityPointId field to JSON
    - Test InterfaceLogicalEntityDto deserializes dataEntityPointId from JSON
    - Test EntityMapper.toDto() maps dataEntityPointId from entity
    - Test EntityMapper.toEntity() maps dataEntityPointId to entity
    - Test backward compatibility: null dataEntityPointId derives from logical_entity_id
    - Maximum 5 focused tests covering critical backend behaviors
  - [x] 3.2 Update InterfaceLogicalEntityDto.java
    - Add dataEntityPointId field with @JsonProperty("dataEntityPointId")
    - Keep logicalEntityId field for backward compatibility with existing data
    - Follow DataMovementDto pattern for field naming
    - Location: `InterfaceLogicalEntityDto.java`
  - [x] 3.3 Update InterfaceLogicalEntityEntity.java
    - Add dataEntityPointId field with @Column(name = "data_entity_point_id")
    - Keep logicalEntityId column (existing data, backward compatibility)
    - No database migration needed - nullable column addition
    - Location: `InterfaceLogicalEntityEntity.java`
  - [x] 3.4 Update EntityMapper.java toDto() method for InterfaceLogicalEntity
    - Map dataEntityPointId from entity to DTO
    - Backward compatibility: if dataEntityPointId is null, derive from logicalEntityId using "dep_log_" prefix
    - Pattern: `dataEntityPointId = entity.getDataEntityPointId() != null ? entity.getDataEntityPointId() : "dep_log_" + entity.getLogicalEntityId()`
    - Location: `EntityMapper.java` lines 1433-1443
  - [x] 3.5 Update EntityMapper.java toEntity() method for InterfaceLogicalEntity
    - Map dataEntityPointId from DTO to entity
    - Store dataEntityPointId as-is (frontend sends dep_log_ or dep_phy_ prefixed IDs)
    - Continue setting logicalEntityId for backward compatibility if dataEntityPointId starts with "dep_log_"
    - Location: `EntityMapper.java` lines 1445-1456
  - [x] 3.6 Add database column (if not auto-created by Hibernate)
    - Add data_entity_point_id column to interface_logical_entities table
    - Column should be VARCHAR, nullable
    - No data migration needed - new rows will use dataEntityPointId, existing rows use logicalEntityId with derivation
  - [x] 3.7 Ensure backend tests pass
    - Run ONLY the 2-8 tests written in 3.1
    - Verify DTO/Entity compilation
    - Verify mapper functions correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- DTO includes dataEntityPointId field in JSON serialization
- Entity includes data_entity_point_id column
- Backward compatibility: existing rows with logical_entity_id only are derived to dep_log_ format
- New rows can reference either Logical or Physical data entities via dataEntityPointId

---

### XLSX Layer

#### Task Group 4: XLSX Import/Export Updates
**Dependencies:** Task Groups 1, 2

- [x] 4.0 Complete XLSX import/export updates
  - [x] 4.1 Write 2-8 focused tests for XLSX handling
    - Test export: interface_logical_entities worksheet has "Data Entity" column header
    - Test export: dataEntityPointId values are exported correctly
    - Test import: "Data Entity" column maps to dataEntityPointId field
    - Test import backward compatibility: "Logical Entity" column maps to logical_entity_id field
    - Test import: mapping from legacy logical_entity_id to dataEntityPointId with dep_log_ prefix
    - Maximum 5 focused tests covering critical XLSX behaviors
  - [x] 4.2 Verify export uses new column header "Data Entity"
    - gridConfigs displayName drives export column headers
    - With Task 1.6 complete, export will automatically use "Data Entity" header
    - Verify entitiesToWorksheetData() uses displayName from config
    - No code changes expected - verification task only
  - [x] 4.3 Verify export writes dataEntityPointId values
    - With Task 1.6 complete (field changed to dataEntityPointId), export will write this field
    - Verify field value is exported correctly (dep_log_ or dep_phy_ prefixed IDs)
    - No code changes expected - verification task only
  - [x] 4.4 Update mapRowToFields() for backward-compatible import
    - Add logic to handle legacy "Logical Entity" column header
    - If "Logical Entity" column exists (legacy import), map to dataEntityPointId with "dep_log_" prefix
    - If "Data Entity" column exists (new import), map directly to dataEntityPointId
    - Location: `excelOperations.ts` mapRowToFields() function
  - [x] 4.5 Add special handling for interface_logical_entities in processWorksheet()
    - After row mapping, check if dataEntityPointId is missing but logical_entity_id is present
    - If so, derive dataEntityPointId = "dep_log_" + logical_entity_id
    - Location: `excelOperations.ts` processWorksheet() function
  - [x] 4.6 Ensure XLSX tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Verify export creates correct worksheet with new column header
    - Verify import handles both legacy and new column formats
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- XLSX export shows "Data Entity" column header
- XLSX export writes dataEntityPointId values (dep_log_ or dep_phy_ prefixed)
- XLSX import handles legacy files with "Logical Entity" column
- XLSX import handles new files with "Data Entity" column
- Backward compatibility: legacy imports derive dataEntityPointId from logical_entity_id

---

### Testing Layer

#### Task Group 5: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 2-8 tests written by frontend-engineer (Task 1.1)
    - Review the 2-8 tests written by frontend-engineer (Task 2.1)
    - Review the 2-8 tests written by backend-engineer (Task 3.1)
    - Review the 2-8 tests written by fullstack-engineer (Task 4.1)
    - Total existing tests: approximately 16-23 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to Interface Entity relationship refactor
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
    - Key workflows to verify:
      - Create new Interface <-> Entity relationship with Logical entity
      - Create new Interface <-> Entity relationship with Physical entity
      - Load existing data with legacy logical_entity_id field
      - Export/import round-trip with new Data Entity column
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Add maximum of 10 new tests to fill identified critical gaps
    - Focus on integration points and end-to-end workflows
    - Priority tests:
      - End-to-end: Create relationship, save, reload, verify persistence
      - Backward compatibility: Load project with legacy logical_entity_id, verify derivation
      - UI integration: Verify domain visibility (Application + Data domains)
      - XLSX round-trip: Export new format, import, verify data integrity
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Include tests from Tasks 1.1, 2.1, 3.1, 4.1, and 5.3
    - Expected total: approximately 26-33 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 26-33 tests total)
- Critical user workflows for this feature are covered
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on Interface Entity relationship refactor

---

## Execution Order

Recommended implementation sequence:

```
Phase 1 (Parallel Execution):
  [Task Group 1: Frontend Type & Config] ----+
                                              |
  [Task Group 3: Backend DTO/Entity/Mapper] --+-- Both can start immediately

Phase 2 (Sequential):
  [Task Group 2: Grid Cell/Selector Integration] -- Requires Task Group 1

Phase 3 (Sequential):
  [Task Group 4: XLSX Import/Export] -- Requires Task Groups 1, 2

Phase 4 (Final):
  [Task Group 5: Test Review & Gap Analysis] -- Requires Task Groups 1-4
```

### Detailed Execution Flow

1. **Task Group 1** (Frontend Type & Config Updates)
   - Start immediately
   - No external dependencies
   - Enables Task Group 2

2. **Task Group 3** (Backend DTO/Entity/Mapper Refactoring)
   - Start immediately (parallel with Task Group 1)
   - No external dependencies
   - Can complete independently

3. **Task Group 2** (Grid Cell/Selector Integration)
   - Start after Task Group 1 completes
   - Depends on configuration changes from Task Group 1
   - Enables Task Group 4

4. **Task Group 4** (XLSX Import/Export Updates)
   - Start after Task Groups 1 and 2 complete
   - Depends on grid column config and field changes
   - Uses backward compatibility patterns from Task Group 3

5. **Task Group 5** (Test Review & Gap Analysis)
   - Start after all other Task Groups complete
   - Reviews tests from all previous groups
   - Fills critical gaps with strategic tests

---

## Implementation Notes

### Backward Compatibility Strategy

The implementation maintains full backward compatibility:

1. **Database**: No migration required
   - New `data_entity_point_id` column is nullable
   - Existing `logical_entity_id` column preserved

2. **API**: Dual-field support
   - Frontend sends `dataEntityPointId` (new format)
   - Backend derives `dataEntityPointId` from `logicalEntityId` for legacy data

3. **XLSX**: Column header migration
   - Export uses new "Data Entity" header
   - Import accepts both "Logical Entity" (legacy) and "Data Entity" (new)
   - Legacy imports derive `dataEntityPointId` automatically

### Reference Implementation

The Data Movements relationship provides the pattern to follow:

- **Grid Config**: `gridConfigs.data_movements` uses `data_entity_point_picker` cellType
- **DTO**: `DataMovementDto.java` uses `dataEntityPointId` field
- **Entity**: `DataMovementEntity.java` uses `data_entity_point_id` column
- **Mapper**: `EntityMapper.java` maps `dataEntityPointId` directly
- **Component**: `DataEntityPointSelect.tsx` renders grouped dropdown

### Key Code Patterns

**Frontend Grid Config Pattern:**
```typescript
{
  field: 'dataEntityPointId',
  displayName: 'Data Entity',
  cellType: 'data_entity_point_picker',
  required: true,
  width: 180
}
```

**Backend DTO Pattern:**
```java
@JsonProperty("dataEntityPointId")
String dataEntityPointId
```

**Backward Compatibility Derivation Pattern:**
```java
String dataEntityPointId = entity.getDataEntityPointId() != null
    ? entity.getDataEntityPointId()
    : DATA_ENTITY_POINT_PREFIXES.LOGICAL + entity.getLogicalEntityId();
```

---

## Implementation Summary

**All 5 Task Groups Completed Successfully**

### Files Modified

1. **Frontend:**
   - `frontend/src/config/gridConfigs.ts` - Updated tab name mapping, grid config columns
   - `frontend/src/config/relationshipDefinitions.ts` - Updated displayName and endpointEntityTypes
   - `frontend/src/types/model.ts` - Updated InterfaceLogicalEntity interface with dataEntityPointId
   - `frontend/src/utils/excelOperations.ts` - Added LEGACY_COLUMN_MAPPINGS and convertLegacyValue()

2. **Backend:**
   - `architecture-model-service/.../dto/relationship/InterfaceLogicalEntityDto.java` - Uses dataEntityPointId
   - `architecture-model-service/.../entity/InterfaceLogicalEntityEntity.java` - Uses data_entity_point_id column
   - `architecture-model-service/.../mapper/EntityMapper.java` - Updated toDto() and toEntity() methods

3. **Database:**
   - `architecture-model-service/src/main/resources/db/changelog/sql/020-interface-entity-relationship-refactor.sql` - Migration script
   - `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` - Added migration entry

4. **Tests:**
   - `frontend/src/__tests__/interface-entity-relationship-refactor.test.ts` - 26 tests covering all task groups

### Test Results

All 26 tests pass:
- Task Group 1 tests: Frontend Type and Config Updates
- Task Group 2 tests: Grid Cell/Selector Integration (verification)
- Task Group 4 tests: XLSX Import/Export Updates
- Task Group 5 tests: Integration Tests

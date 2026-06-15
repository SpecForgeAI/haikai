# Task Breakdown: Data Movement Interface Schema Extension

## Overview
Total Tasks: 32

**Goal:** Extend Data Movement relationship to support Interface (with Schema) level OR Data Entity level, plus add Bi-directional flag.

**Key Features:**
- XOR Validation: Exactly ONE of dataEntityPointId OR interfaceWithSchemaId must be set
- Mutual Exclusivity UX: When user selects one field, auto-clear the other with inline hint
- New field: interfaceWithSchemaId (nullable FK to interfaces, fk_typeahead cellType)
- New field: biDirectional (boolean, default false)
- Update dataEntityPointId to optional (required: false)
- Database migration: make data_entity_point_id nullable, add new columns
- XLSX export/import: add new columns, handle XOR validation

## Task List

### Frontend Type & Config Layer

#### Task Group 1: Frontend Type & Config Updates
**Dependencies:** None

- [x] 1.0 Complete frontend type and config updates
  - [x] 1.1 Write 4 focused tests for type and config changes
    - Test 1: DataMovement interface accepts optional dataEntityPointId
    - Test 2: DataMovement interface accepts optional interfaceWithSchemaId
    - Test 3: DataMovement interface accepts optional biDirectional boolean
    - Test 4: gridConfigs data_movements has correct column definitions
  - [x] 1.2 Update DataMovement interface in types/model.ts
    - Change `dataEntityPointId: string` to `dataEntityPointId?: string` (optional)
    - Add `interfaceWithSchemaId?: string` (optional FK to interfaces)
    - Add `biDirectional?: boolean` (optional, default false)
    - Add JSDoc comments explaining XOR constraint
  - [x] 1.3 Update gridConfigs.ts data_movements configuration
    - Change `dataEntityPointId` column: set `required: false`
    - Add `interfaceWithSchemaId` column after `dataEntityPointId`:
      ```typescript
      { field: 'interfaceWithSchemaId', displayName: 'Interface (with Schema)', cellType: 'fk_typeahead', required: false, width: 180, fkTarget: 'interfaces' }
      ```
    - Add `biDirectional` column after `interfaceWithSchemaId`:
      ```typescript
      { field: 'biDirectional', displayName: 'Bi-directional?', cellType: 'boolean', required: false, width: 100 }
      ```
  - [x] 1.4 Update relationshipDefinitions.ts data_movements endpoint types
    - Add `'interfaces'` to `endpointEntityTypes` array for data_movements
    - Current: `['application_points', 'data_entity_points']`
    - Updated: `['application_points', 'data_entity_points', 'interfaces']`
  - [x] 1.5 Ensure frontend type and config tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- DataMovement interface correctly typed with optional fields
- gridConfigs has all 3 columns (dataEntityPointId optional, interfaceWithSchemaId, biDirectional)
- relationshipDefinitions includes interfaces in data_movements endpoints

---

### XOR Validation Layer

#### Task Group 2: XOR Validation Implementation
**Dependencies:** Task Group 1

- [x] 2.0 Complete XOR validation implementation
  - [x] 2.1 Write 5 focused tests for XOR validation
    - Test 1: validateDataMovementXOR returns no error when only dataEntityPointId is set
    - Test 2: validateDataMovementXOR returns no error when only interfaceWithSchemaId is set
    - Test 3: validateDataMovementXOR returns error when both fields are set
    - Test 4: validateDataMovementXOR returns error when neither field is set
    - Test 5: Grid mutual exclusivity clears opposite field on selection
  - [x] 2.2 Add xor_constraint validation error type in types/config.ts
    - Add `'xor_constraint'` to ValidationError type union
    - Ensure type is exported and available to validation.ts
  - [x] 2.3 Create validateDataMovementXOR function in validation.ts
    - Function signature: `validateDataMovementXOR(dataMovements: DataMovement[]): ValidationError[]`
    - Error when both set: `"DATA_MOVEMENT ['<name or id>'] must specify either Data Entity OR Interface (with Schema), not both"`
    - Error when neither set: `"DATA_MOVEMENT ['<name or id>'] requires either Data Entity or Interface (with Schema)"`
    - Return ValidationError with type: `'xor_constraint'`
    - Follow existing validation function patterns (lines 253-323)
  - [x] 2.4 Integrate validateDataMovementXOR into validateModel function
    - Call validateDataMovementXOR with data_movements from synced model
    - Add errors to the errors array
    - Position after other relationship validations
  - [x] 2.5 Implement mutual exclusivity handler in Grid.tsx
    - Detect when dataEntityPointId or interfaceWithSchemaId changes
    - If dataEntityPointId is set and interfaceWithSchemaId already has value: clear interfaceWithSchemaId
    - If interfaceWithSchemaId is set and dataEntityPointId already has value: clear dataEntityPointId
    - Show brief inline hint after clearing: "Cleared [field name] (use one or the other)"
    - Implement in cell change handler with field-pair awareness
  - [x] 2.6 Ensure XOR validation tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify validation errors display correctly in UI
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 2.1 pass
- XOR validation correctly identifies both/neither violations
- Mutual exclusivity UX auto-clears opposite field with hint
- Validation errors are non-blocking (rows remain visible)

---

### Backend Layer

#### Task Group 3: Backend DTO/Entity/Mapper Updates
**Dependencies:** None (can be done in parallel with Task Groups 1-2)

- [x] 3.0 Complete backend DTO, Entity, and Mapper updates
  - [x] 3.1 Write 4 focused tests for backend changes
    - Test 1: DataMovementDto accepts null dataEntityPointId
    - Test 2: DataMovementDto accepts interfaceWithSchemaId field
    - Test 3: DataMovementDto accepts biDirectional field with default false
    - Test 4: EntityMapper correctly maps new fields between DTO and Entity
  - [x] 3.2 Update DataMovementDto.java
    - Add `@JsonProperty("interfaceWithSchemaId") String interfaceWithSchemaId`
    - Add `@JsonProperty("biDirectional") Boolean biDirectional`
    - Ensure dataEntityPointId allows null values
    - Follow existing record pattern
  - [x] 3.3 Update DataMovementEntity.java
    - Change `@Column(name = "data_entity_point_id", nullable = false)` to `nullable = true`
    - Add `@Column(name = "interface_with_schema_id", nullable = true) private String interfaceWithSchemaId`
    - Add `@Column(name = "bi_directional", nullable = false) private Boolean biDirectional = false`
    - Add getters/setters for new fields
  - [x] 3.4 Update EntityMapper.java toDto/toEntity methods
    - Add mapping for `interfaceWithSchemaId` field
    - Add mapping for `biDirectional` field with null handling (default to false)
    - Follow existing DataMovement mapping pattern (lines 1397-1431)
  - [x] 3.5 Create database migration 028-data-movement-interface-schema.sql
    - Location: `src/main/resources/db/changelog/sql/028-data-movement-interface-schema.sql`
    - SQL statements:
      ```sql
      -- Make existing data_entity_point_id nullable
      ALTER TABLE data_movements ALTER COLUMN data_entity_point_id DROP NOT NULL;

      -- Add new interface_with_schema_id column
      ALTER TABLE data_movements ADD COLUMN interface_with_schema_id VARCHAR(255) NULL;

      -- Add new bi_directional column with default
      ALTER TABLE data_movements ADD COLUMN bi_directional BOOLEAN NOT NULL DEFAULT FALSE;
      ```
  - [x] 3.6 Update db.changelog-master.yaml
    - Add include for 028-data-movement-interface-schema.sql
    - Follow existing changelog entry pattern
  - [x] 3.7 Ensure backend tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify migration runs successfully
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- DTO and Entity properly handle new nullable fields
- Migration runs without errors
- Existing data preserved (dataEntityPointId values unchanged)

---

### XLSX Import/Export Layer

#### Task Group 4: XLSX Import/Export Updates
**Dependencies:** Task Groups 1, 3

- [x] 4.0 Complete XLSX import/export updates
  - [x] 4.1 Write 5 focused tests for XLSX operations
    - Test 1: Export includes "Interface (with Schema)" column in correct position
    - Test 2: Export includes "Bi-directional?" column with TRUE/FALSE values
    - Test 3: Export leaves Data Entity blank when Interface is used (and vice versa)
    - Test 4: Import correctly parses interfaceWithSchemaId from column
    - Test 5: Import correctly parses biDirectional as boolean
  - [x] 4.2 Update XLSX export in excelOperations.ts
    - Add "Interface (with Schema)" column after "Data Entity" column
    - Add "Bi-directional?" column after "Interface (with Schema)" column
    - Export biDirectional as "TRUE" or "FALSE" string (follow existing boolean pattern)
    - Export interfaceWithSchemaId as interface ID string
    - Leave Data Entity column blank if row uses Interface
    - Leave Interface column blank if row uses Data Entity
  - [x] 4.3 Update column header mapping for export
    - Ensure displayName-to-field mapping includes new columns
    - Position new columns before "Type" column
  - [x] 4.4 Update XLSX import in excelOperations.ts
    - Read "Interface (with Schema)" column and map to interfaceWithSchemaId
    - Read "Bi-directional?" column and parse as boolean
    - Parse biDirectional: "TRUE"/"YES"/"1" -> true, other values -> false (case-insensitive)
    - Resolve interfaceWithSchemaId by ID matching against interfaces collection
  - [x] 4.5 Add XOR validation during import (non-blocking)
    - Check if both dataEntityPointId and interfaceWithSchemaId are set
    - Check if neither dataEntityPointId nor interfaceWithSchemaId are set
    - If XOR violated: import row but add error to ImportError array
    - Do NOT block import - allow row with validation error
  - [x] 4.6 Ensure XLSX import/export tests pass
    - Run ONLY the 5 tests written in 4.1
    - Verify round-trip export/import preserves data correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 4.1 pass
- Export produces correct columns in correct order
- Import correctly parses new columns
- XOR validation errors are captured but don't block import

---

### Testing Layer

#### Task Group 5: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4 tests written by frontend-engineer (Task 1.1)
    - Review the 5 tests written by validation-engineer (Task 2.1)
    - Review the 4 tests written by backend-engineer (Task 3.1)
    - Review the 5 tests written by xlsx-engineer (Task 4.1)
    - Total existing tests: approximately 18 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to Data Movement Interface Schema feature
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 5.3 Write up to 8 additional strategic tests maximum
    - Add maximum of 8 new tests to fill identified critical gaps
    - Suggested gap areas:
      - Integration test: Create data movement with interfaceWithSchemaId, save, reload
      - Integration test: Mutual exclusivity UX clears field and shows hint
      - Integration test: XOR validation displays in grid error indicator
      - Integration test: XLSX roundtrip with mixed entity/interface rows
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 18-26 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-26 tests total)
- Critical user workflows for this feature are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on Data Movement Interface Schema feature

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Frontend Type & Config Updates** (no dependencies)
   - Can start immediately
   - Updates types/model.ts, gridConfigs.ts, relationshipDefinitions.ts

2. **Task Group 3: Backend DTO/Entity/Mapper Updates** (no dependencies)
   - Can be done in parallel with Task Group 1
   - Updates DataMovementDto, DataMovementEntity, EntityMapper, migration

3. **Task Group 2: XOR Validation Implementation** (depends on Task Group 1)
   - Must wait for frontend types to be complete
   - Updates types/config.ts, validation.ts, Grid.tsx

4. **Task Group 4: XLSX Import/Export Updates** (depends on Task Groups 1, 3)
   - Must wait for frontend types and backend fields
   - Updates excelOperations.ts

5. **Task Group 5: Test Review & Gap Analysis** (depends on Task Groups 1-4)
   - Final integration testing and gap analysis
   - Must be done last

---

## Files Modified

### Frontend Files
| File | Changes |
|------|---------|
| `frontend/src/types/model.ts` | DataMovement interface: add optional fields |
| `frontend/src/types/config.ts` | Add 'xor_constraint' to ValidationError type |
| `frontend/src/config/gridConfigs.ts` | data_movements: update dataEntityPointId, add 2 columns |
| `frontend/src/config/relationshipDefinitions.ts` | Add 'interfaces' to data_movements endpoints |
| `frontend/src/utils/validation.ts` | Add validateDataMovementXOR function |
| `frontend/src/components/Grid/Grid.tsx` | Add mutual exclusivity handler |
| `frontend/src/utils/excelOperations.ts` | Add export/import for new columns |

### Backend Files
| File | Changes |
|------|---------|
| `architecture-model-service/.../DataMovementDto.java` | Add interfaceWithSchemaId, biDirectional |
| `architecture-model-service/.../DataMovementEntity.java` | Update nullable, add columns |
| `architecture-model-service/.../EntityMapper.java` | Update toDto/toEntity mapping |
| `architecture-model-service/.../028-data-movement-interface-schema.sql` | New migration |
| `architecture-model-service/.../db.changelog-master.yaml` | Include new migration |

### Test Files
| File | Tests |
|------|-------|
| `frontend/src/__tests__/data-movement-interface-schema-types.test.ts` | 5 tests - Type & Config |
| `frontend/src/__tests__/data-movement-interface-schema-xor-validation.test.ts` | 8 tests - XOR Validation |
| `frontend/src/__tests__/data-movement-xlsx-operations.test.ts` | 8 tests - XLSX Operations |
| `frontend/src/__tests__/data-movement-interface-schema-integration.test.ts` | 21 tests - Integration Tests |

**Total Feature Tests: 42 tests (all passing)**

---

## Out of Scope (per spec)
- Diagram rendering changes for Data Movement visualization
- Auto-generation of per-entity movements from interface schema
- Changes to Interface <-> Entity relationship definition
- Backend XOR validation (frontend-only validation for this spec)
- Changes to movement_type dropdown options
- Changes to Source/Target App Point picker behavior
- Creating new cell type components (use existing fk_typeahead and boolean)
- Validation warning toast/notification system changes
- API endpoint changes beyond DTO/Entity field additions
- Changes to other relationship grids

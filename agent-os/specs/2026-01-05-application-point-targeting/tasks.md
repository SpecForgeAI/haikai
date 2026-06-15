# Task Breakdown: Expand Application Points to Reference Service/Class/Method and Add UI to Attach/Detach Business Logic

## Overview
Total Tasks: 42
Total Task Groups: 7

This spec extends ApplicationPoint entities with `target_type` and `target_ref_id` fields to enable precise targeting of Service, Class, or Method entities, and adds UI workflows for attaching/detaching Business Logic to Application Points.

## Task List

### Backend Database Layer

#### Task Group 1: Liquibase Migration for Target Fields
**Dependencies:** None

- [x] 1.0 Complete database migration for application_points targeting
  - [x] 1.1 Write 3 focused tests for migration correctness
    - Test that existing application_points rows have target_type='SERVICE' after migration
    - Test that target_ref_id is populated from service_id for existing rows
    - Test that check constraint rejects invalid target_type values
  - [x] 1.2 Create migration file `016-application-point-targeting.sql`
    - File path: `architecture-model-service/src/main/resources/db/changelog/sql/016-application-point-targeting.sql`
    - Add `target_type VARCHAR(16)` column to `application_points` table
    - Add `target_ref_id VARCHAR(255)` column to `application_points` table
    - Add check constraint: `CHECK (target_type IN ('SERVICE', 'CLASS', 'METHOD'))`
    - Add index on `target_ref_id` for query performance
    - Follow pattern from existing migration `009-logical-er-polymorphic-endpoints.sql`
  - [x] 1.3 Create data migration for backward compatibility
    - UPDATE existing rows: SET `target_type = 'SERVICE'`
    - UPDATE existing rows: SET `target_ref_id = service_id` WHERE `service_id IS NOT NULL`
    - Handle NULL service_id cases gracefully (leave target_ref_id NULL)
  - [x] 1.4 Register migration in db.changelog-master.yaml
    - File path: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Add changeset `016-application-point-targeting` following existing pattern (lines 228-242)
    - Precondition: column `target_type` does not exist in `application_points` table
  - [x] 1.5 Ensure database migration tests pass
    - Run migration tests to verify schema changes
    - Verify backward compatibility data migration executed correctly

**Acceptance Criteria:**
- Migration adds `target_type` and `target_ref_id` columns to `application_points` table
- Existing rows have `target_type='SERVICE'` and `target_ref_id` populated from `service_id`
- Check constraint enforces valid `target_type` values
- Index created on `target_ref_id`
- Migration registered in changelog and runs successfully

---

### Backend Entity/DTO Layer

#### Task Group 2: Extend ApplicationPoint Entity and DTO
**Dependencies:** Task Group 1

- [x] 2.0 Complete entity and DTO extensions for ApplicationPoint targeting
  - [x] 2.1 Write 4 focused tests for entity/DTO mapping
    - Test ApplicationPointEntity includes targetType and targetRefId fields
    - Test ApplicationPointDto serializes/deserializes target_type and target_ref_id
    - Test EntityMapper maps targetType/targetRefId in both directions
    - Test JSON property names are snake_case (`target_type`, `target_ref_id`)
  - [x] 2.2 Extend ApplicationPointEntity
    - File path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationPointEntity.java`
    - Add field: `@Column(name = "target_type") private String targetType;` (after line 41)
    - Add field: `@Column(name = "target_ref_id") private String targetRefId;` (after targetType field)
    - Follow existing field pattern from `interfaceId` field (line 40-41)
  - [x] 2.3 Extend ApplicationPointDto
    - File path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ApplicationPointDto.java`
    - Add record parameter: `@JsonProperty("target_type") String targetType` (after line 36)
    - Add record parameter: `@JsonProperty("target_ref_id") String targetRefId` (after targetType)
    - Follow existing pattern for validFrom/validTo fields
  - [x] 2.4 Update EntityMapper for ApplicationPoint
    - File path: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
    - Update `toDto(ApplicationPointEntity)` method (lines 328-341) to include targetType, targetRefId
    - Update `toEntity(ApplicationPointDto, String)` method (lines 344-358) to include targetType, targetRefId
    - Add `.targetType(dto.targetType())` and `.targetRefId(dto.targetRefId())` to builder
  - [x] 2.5 Ensure entity/DTO tests pass
    - Run the 4 tests from 2.1
    - Verify round-trip serialization works correctly

**Acceptance Criteria:**
- ApplicationPointEntity has targetType and targetRefId fields with JPA annotations
- ApplicationPointDto has target_type and target_ref_id with correct JSON property names
- EntityMapper correctly maps fields in both directions
- All 4 tests pass

---

### Backend Validation Layer

#### Task Group 3: Target Validation on Save
**Dependencies:** Task Group 2

- [x] 3.0 Complete backend validation for ApplicationPoint target references
  - [x] 3.1 Write 5 focused tests for target validation
    - Test valid SERVICE target_type with existing service_id passes validation
    - Test valid CLASS target_type with existing class_id passes validation
    - Test valid METHOD target_type with existing method_id passes validation
    - Test invalid target_ref_id (non-existent entity) returns HTTP 400
    - Test mismatched target_type and target_ref_id returns HTTP 400
  - [x] 3.2 Add validation method to ModelService
    - File path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Create `validateApplicationPointTargets(List<ApplicationPointDto> points, String modelFileId)` method
    - Validate target_type is one of: SERVICE, CLASS, METHOD (or null for backward compatibility)
    - Validate target_ref_id references existing entity of correct type within same model
  - [x] 3.3 Implement type-specific validation logic
    - For target_type='SERVICE': query `serviceRepository.findById(targetRefId)` and verify modelFileId matches
    - For target_type='CLASS': query `classRepository.findById(targetRefId)` and verify modelFileId matches
    - For target_type='METHOD': query `methodRepository.findById(targetRefId)` and verify modelFileId matches
    - Use existing repository pattern from ModelService (lines 45-71)
  - [x] 3.4 Integrate validation into save flow
    - Call `validateApplicationPointTargets()` in `saveModel()` method before saving entities
    - Throw `IllegalArgumentException` with descriptive message on validation failure
    - Spring will convert to HTTP 400 response automatically
  - [x] 3.5 Ensure validation tests pass
    - Run the 5 tests from 3.1
    - Verify error messages are descriptive and actionable

**Acceptance Criteria:**
- ModelService validates ApplicationPoint target references on save
- Invalid target_ref_id returns HTTP 400 with descriptive error
- Mismatched target_type/target_ref_id returns HTTP 400
- Valid references pass validation without error
- All 5 tests pass

---

### Frontend Model Layer

#### Task Group 4: Extend Frontend ApplicationPoint Type
**Dependencies:** Task Group 2 (backend must define API contract first)

- [x] 4.0 Complete frontend type extensions for ApplicationPoint
  - [x] 4.1 Write 3 focused tests for type definitions
    - Test ApplicationPoint type includes target_type and target_ref_id optional fields
    - Test ApplicationPointTargetType enum has SERVICE, CLASS, METHOD values
    - Test type guards work correctly for target fields
  - [x] 4.2 Add ApplicationPointTargetType enum
    - File path: `frontend/src/types/model.ts`
    - Add after ApplicationPointKind type (around line 324):
    ```typescript
    /** Target type for ApplicationPoint - indicates what entity the point targets */
    export type ApplicationPointTargetType = 'SERVICE' | 'CLASS' | 'METHOD';
    ```
  - [x] 4.3 Extend ApplicationPoint interface
    - File path: `frontend/src/types/model.ts`
    - Add to ApplicationPoint interface (around line 326-344):
    ```typescript
    /** Target type - indicates whether this point targets a Service, Class, or Method */
    target_type?: ApplicationPointTargetType;
    /** Target reference ID - UUID of the targeted Service, Class, or Method */
    target_ref_id?: string;
    ```
  - [x] 4.4 Add target type options to defaults.ts
    - File path: `frontend/src/config/defaults.ts`
    - Add: `export const applicationPointTargetTypeOptions = ['SERVICE', 'CLASS', 'METHOD'];`
    - Follow pattern from existing `pointTypeOptions`
  - [x] 4.5 Ensure frontend type tests pass
    - Run the 3 tests from 4.1
    - Verify TypeScript compilation succeeds without errors

**Acceptance Criteria:**
- ApplicationPoint interface has optional target_type and target_ref_id fields
- ApplicationPointTargetType enum defined with SERVICE, CLASS, METHOD
- Target type options exported from defaults.ts
- TypeScript compilation passes

---

### Frontend Grid Layer

#### Task Group 5: Update Application Points Grid Configuration
**Dependencies:** Task Group 4

- [x] 5.0 Complete Application Points grid updates for target columns
  - [x] 5.1 Write 4 focused tests for grid configuration
    - Test application_points grid includes target_type dropdown column
    - Test application_points grid includes target_ref_id fk_typeahead column
    - Test target_type dropdown has SERVICE, CLASS, METHOD options
    - Test fkTarget dynamically resolves based on target_type value
  - [x] 5.2 Add Target Type dropdown column to grid
    - File path: `frontend/src/config/gridConfigs.ts`
    - Add to `application_points` config after `service_id` column (line 164):
    ```typescript
    { field: 'target_type', displayName: 'Target Type', cellType: 'dropdown', required: false, width: 120, options: applicationPointTargetTypeOptions },
    ```
    - Import `applicationPointTargetTypeOptions` from defaults.ts
  - [x] 5.3 Add Target Reference fk_typeahead column
    - Add to `application_points` config after `target_type`:
    ```typescript
    { field: 'target_ref_id', displayName: 'Target Reference', cellType: 'fk_typeahead', required: false, width: 180, fkTarget: 'services' },
    ```
    - Note: Initial fkTarget is 'services', will be dynamically changed based on target_type
  - [x] 5.4 Implement dynamic fkTarget resolution in Grid component
    - File path: `frontend/src/components/Grid/TypeaheadCell.tsx`
    - Added dynamicFkTargetField and dynamicFkTargetMap to GridColumnConfig interface
    - Implemented getTargetEntities() to resolve fkTarget based on target_type value:
      - If target_type='SERVICE', fkTarget='services'
      - If target_type='CLASS', fkTarget='classes'
      - If target_type='METHOD', fkTarget='methods'
  - [x] 5.5 Update defaults.ts imports in gridConfigs.ts
    - Add `applicationPointTargetTypeOptions` to the import statement (line 36-37)
  - [x] 5.6 Ensure grid tests pass
    - Run the 4 tests from 5.1
    - Verify grid renders correctly with new columns

**Acceptance Criteria:**
- application_points grid has Target Type dropdown column
- Target Type dropdown shows SERVICE, CLASS, METHOD options
- application_points grid has Target Reference fk_typeahead column
- fk_typeahead dynamically filters based on Target Type selection
- All 4 tests pass

---

### Frontend Modals Layer

#### Task Group 6: Quick Attach Modals for Business Logic
**Dependencies:** Task Group 5

- [x] 6.0 Complete quick attach modals for Business Logic
  - [x] 6.1 Write 6 focused tests for attach modals
    - Test AttachBusinessLogicModal renders list of available Business Logics
    - Test already-attached Business Logics are marked/disabled in modal
    - Test selecting Business Logic creates join record on submit
    - Test AttachToApplicationPointModal renders list of Application Points
    - Test already-attached Application Points are marked/disabled
    - Test duplicate attach attempt shows user-friendly error
  - [x] 6.2 Create AttachBusinessLogicModal component
    - File path: `frontend/src/components/DiagramsView/modals/AttachBusinessLogicModal.tsx`
    - Follow pattern from `LogicalErCreateModal.tsx` (lines 1-469)
    - Props: `isOpen`, `onClose`, `onSubmit`, `metaModel`, `applicationPointId`
    - Display searchable/filterable list of Business Logic entities
    - Mark already-attached items (gray out or disable checkbox)
    - Submit creates `ApplicationPointBusinessLogic` join record
  - [x] 6.3 Create AttachBusinessLogicModal CSS module
    - File path: `frontend/src/components/DiagramsView/modals/AttachBusinessLogicModal.module.css`
    - Reuse styles from `LogicalErCreateModal.module.css`
    - Add `.attached` class for marking already-attached items
  - [x] 6.4 Create AttachToApplicationPointModal component
    - File path: `frontend/src/components/DiagramsView/modals/AttachToApplicationPointModal.tsx`
    - Props: `isOpen`, `onClose`, `onSubmit`, `metaModel`, `businessLogicId`
    - Display searchable/filterable list of Application Points
    - Use `formatApplicationPointDisplay` for display names
    - Mark already-attached Application Points
    - Submit creates `ApplicationPointBusinessLogic` join record
  - [x] 6.5 Implement duplicate prevention in modal submit
    - Before creating join record, check if relationship already exists
    - If duplicate, show error message: "This Business Logic is already attached to this Application Point"
    - Use existing `application_point_business_logics` data from metaModel.relationships
  - [x] 6.6 Add Attach buttons to Grid component
    - File path: `frontend/src/components/Grid/Grid.tsx`
    - When Application Point row is selected, show "Attach Business Logic" button in toolbar
    - When Business Logic row is selected, show "Attach to Application Point" button in toolbar
    - Wire buttons to open respective modals
    - Buttons disabled when no row is selected
  - [x] 6.7 Implement detach functionality in modals
    - In AttachToApplicationPointModal: show Detach button for each attached item
    - Detach removes join table row via DELETE_RELATIONSHIP action
    - Detach does NOT delete either entity
  - [x] 6.8 Ensure modal tests pass
    - Run the tests for attach modals (24 tests in attach-business-logic-modal.test.ts)
    - Verify modals open, display correct data, and submit correctly

**Acceptance Criteria:**
- AttachBusinessLogicModal displays available Business Logics with search/filter
- Already-attached items are marked and cannot be re-selected
- AttachToApplicationPointModal displays Application Points with formatter
- Submit creates join record in application_point_business_logics
- Duplicate attempts show user-friendly error
- Detach removes join record without deleting entities
- Attach buttons appear in Grid toolbar for application_points and business_logics tabs
- All tests pass (24 tests)

---

### Integration Testing

#### Task Group 7: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review 3 tests from database migration (Task 1.1)
    - Review 4 tests from entity/DTO (Task 2.1)
    - Review 5 tests from validation (Task 3.1)
    - Review 3 tests from frontend types (Task 4.1)
    - Review 4 tests from grid config (Task 5.1)
    - Review 24 tests from modals (Task 6.1, 6.8)
    - Total existing tests: 43 tests
  - [x] 7.2 Analyze test coverage gaps for THIS feature only
    - Identified critical user workflows that lack test coverage
    - Focus on end-to-end flow: Create ApplicationPoint -> Set Target -> Attach Business Logic -> Save
    - Focus on backward compatibility: Existing data with NULL target fields still works
  - [x] 7.3 Write up to 8 additional strategic tests maximum
    - Test E2E: Full create-target-attach-save flow
    - Test E2E: Load model with existing ApplicationPoints (backward compatibility)
    - Test E2E: Attach multiple business logics to same application point
    - Test E2E: Attach same business logic to multiple application points
    - Test E2E: Detach Business Logic and verify join record removed
    - Test E2E: Display formatting for application points
    - Test E2E: Multiple attachments workflow
    - Test E2E: Complete traceability chain
    - Test E2E: Edge cases and error handling
    - Implemented in: `frontend/src/__tests__/application-point-business-logic-e2e.test.ts`
  - [x] 7.4 Run feature-specific tests only
    - Ran 24 tests (attach-business-logic-modal.test.ts)
    - Ran 13 tests (application-point-business-logic-e2e.test.ts)
    - All 37 tests pass
    - End-to-end user workflows verified working

**Acceptance Criteria:**
- All 24 attach modal tests pass
- All 13 E2E integration tests pass
- Total test count: 37 tests
- End-to-end user workflows verified working
- Backward compatibility confirmed

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Database Migration** (Backend DB)
   - No dependencies
   - Creates schema foundation

2. **Task Group 2: Entity/DTO Extensions** (Backend Entity)
   - Depends on: Task Group 1
   - Extends Java models

3. **Task Group 3: Backend Validation** (Backend Validation)
   - Depends on: Task Group 2
   - Implements save-time validation

4. **Task Group 4: Frontend Types** (Frontend Model)
   - Depends on: Task Group 2 (API contract)
   - Extends TypeScript types

5. **Task Group 5: Grid Configuration** (Frontend Grid)
   - Depends on: Task Group 4
   - Updates grid columns

6. **Task Group 6: Attach Modals** (Frontend Modals)
   - Depends on: Task Group 5
   - Creates UI workflows

7. **Task Group 7: Integration Testing** (Testing)
   - Depends on: All previous groups
   - Validates end-to-end

---

## File Reference Summary

### Backend Files
| File | Line Numbers | Changes |
|------|--------------|---------|
| `architecture-model-service/src/main/resources/db/changelog/sql/016-application-point-targeting.sql` | New file | Migration script |
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | 244+ | Add changeset entry |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationPointEntity.java` | 40-42 | Add targetType, targetRefId fields |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ApplicationPointDto.java` | 35-37 | Add targetType, targetRefId parameters |
| `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` | 328-358 | Update toDto/toEntity methods |
| `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java` | 127-157 | Add validation in saveModel |

### Frontend Files
| File | Line Numbers | Changes |
|------|--------------|---------|
| `frontend/src/types/model.ts` | 324-344 | Add ApplicationPointTargetType, extend ApplicationPoint |
| `frontend/src/config/defaults.ts` | TBD | Add applicationPointTargetTypeOptions |
| `frontend/src/config/gridConfigs.ts` | 157-169 | Add target_type, target_ref_id columns |
| `frontend/src/components/Grid/TypeaheadCell.tsx` | TBD | Add dynamic fkTarget resolution |
| `frontend/src/types/config.ts` | TBD | Add dynamicFkTargetField and dynamicFkTargetMap to GridColumnConfig |
| `frontend/src/components/Grid/Grid.tsx` | 37-38, 107-119, 214-274, 332-356, 425-444 | Add Attach buttons and modals |
| `frontend/src/components/Grid/Grid.module.css` | 55-78 | Add attachButton styles |
| `frontend/src/components/DiagramsView/modals/AttachBusinessLogicModal.tsx` | New file | Attach modal |
| `frontend/src/components/DiagramsView/modals/AttachBusinessLogicModal.module.css` | New file | Modal styles |
| `frontend/src/components/DiagramsView/modals/AttachToApplicationPointModal.tsx` | New file | Reverse attach modal |
| `frontend/src/components/DiagramsView/modals/AttachToApplicationPointModal.module.css` | New file | Modal styles |

### Test Files
| File | Test Count | Description |
|------|------------|-------------|
| `frontend/src/__tests__/attach-business-logic-modal.test.ts` | 24 tests | Unit tests for attach modals |
| `frontend/src/__tests__/application-point-business-logic-e2e.test.ts` | 13 tests | E2E integration tests |

### Existing Code Patterns to Follow
| Pattern | Reference File | Line Numbers |
|---------|----------------|--------------|
| Liquibase migration | `009-logical-er-polymorphic-endpoints.sql` | Full file |
| Entity field | `ApplicationPointEntity.java` | 38-41 |
| DTO record | `ApplicationPointDto.java` | Full file |
| EntityMapper | `EntityMapper.java` | 328-358 |
| Modal component | `LogicalErCreateModal.tsx` | Full file |
| Grid config | `gridConfigs.ts` | 157-169 |
| Join table | `015-business-logic.sql` | 26-36 |

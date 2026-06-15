# Task Breakdown: Class Entity Single Application Point Owner Picker

## Overview
Total Tasks: 29 (across 4 task groups)

This specification replaces the Class entity's two-column ownership model (`owned_by_ref_kind` + `owned_by_ref_id`) with a single `application_point_id` foreign key, using the same searchable Application Point picker UI as other relationship grids.

## Task List

### Backend Layer

#### Task Group 1: Database Migration and Entity Updates
**Dependencies:** None

- [ ] 1.0 Complete database migration and backend entity layer
  - [ ] 1.1 Write 4-6 focused tests for Class entity with application_point_id
    - Test ClassEntity creation with applicationPointId field
    - Test ClassDto serialization/deserialization with application_point_id JSON property
    - Test EntityMapper.toDto(ClassEntity) maps applicationPointId correctly
    - Test EntityMapper.toEntity(ClassDto, String) maps applicationPointId correctly
    - Skip exhaustive coverage of all mapper edge cases
  - [ ] 1.2 Create database migration 025-class-application-point-id.sql
    - Add new column: `ALTER TABLE classes ADD COLUMN application_point_id TEXT REFERENCES application_points(id);`
    - Keep column nullable initially to avoid breaking existing data
    - Drop legacy columns: `ALTER TABLE classes DROP COLUMN owned_by_ref_kind;`
    - Drop legacy columns: `ALTER TABLE classes DROP COLUMN owned_by_ref_id;`
    - File path: `architecture-model-service/src/main/resources/db/changelog/sql/025-class-application-point-id.sql`
  - [ ] 1.3 Register migration in db.changelog-master.yaml
    - Add changeset after 024b-remove-legacy-data-entity-columns-apply
    - Use precondition: `not columnExists tableName: classes columnName: application_point_id`
    - Follow existing pattern from 016-application-point-targeting
  - [ ] 1.4 Update ClassEntity.java
    - Remove `ownedByRefKind` field with `@Column(name = "owned_by_ref_kind")`
    - Remove `ownedByRefId` field with `@Column(name = "owned_by_ref_id")`
    - Add `applicationPointId` field with `@Column(name = "application_point_id")`
    - Maintain field order: id, modelFileId, name, description, namespace, applicationPointId
    - Keep existing Lombok annotations (`@Builder`, `@Getter`, `@Setter`, etc.)
    - File path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ClassEntity.java`
  - [ ] 1.5 Update ClassDto.java
    - Remove `@JsonProperty("owned_by_ref_kind") String ownedByRefKind` record parameter
    - Remove `@JsonProperty("owned_by_ref_id") String ownedByRefId` record parameter
    - Add `@JsonProperty("application_point_id") String applicationPointId` record parameter
    - Maintain parameter order: id, name, description, namespace, applicationPointId
    - File path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ClassDto.java`
  - [ ] 1.6 Update EntityMapper.java Class mapping methods
    - In `toDto(ClassEntity)`: replace `entity.getOwnedByRefKind()`, `entity.getOwnedByRefId()` with `entity.getApplicationPointId()`
    - In `toEntity(ClassDto, String)`: replace `.ownedByRefKind(dto.ownedByRefKind())`, `.ownedByRefId(dto.ownedByRefId())` with `.applicationPointId(dto.applicationPointId())`
    - File path: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
  - [ ] 1.7 Ensure backend layer tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify migration runs successfully on test database
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Database migration adds application_point_id column and drops owned_by_ref_kind/owned_by_ref_id columns
- ClassEntity and ClassDto compile without errors
- EntityMapper correctly maps between entity and DTO

### Frontend Layer

#### Task Group 2: Frontend Type and Configuration Updates
**Dependencies:** Task Group 1

- [ ] 2.0 Complete frontend type and configuration updates
  - [ ] 2.1 Write 4-6 focused tests for frontend Class type changes
    - Test Class interface has application_point_id property
    - Test Class interface does NOT have owned_by_ref_kind or owned_by_ref_id properties
    - Test gridConfigs.classes has application_point_id column with cellType 'application_point_picker'
    - Test gridConfigs.classes does NOT have owned_by_ref_kind or owned_by_ref_id columns
    - Skip exhaustive testing of all grid column properties
  - [ ] 2.2 Update types/model.ts Class interface
    - Remove `owned_by_ref_kind?: OwnedByRefKind` property
    - Remove `owned_by_ref_id?: string` property
    - Add `application_point_id?: string` property
    - Remove `OwnedByRefKind` type export entirely (no longer needed after this change)
    - File path: `frontend/src/types/model.ts`
  - [ ] 2.3 Update config/defaults.ts
    - Remove `ownedByRefKindOptions` array constant (line 552-557)
    - Remove `OwnedByRefKind` from the import statement at top of file
    - Clean up any other references to the removed type
    - File path: `frontend/src/config/defaults.ts`
  - [ ] 2.4 Update config/gridConfigs.ts classes configuration
    - Remove column: `{ field: 'owned_by_ref_kind', displayName: 'Owner Type', cellType: 'dropdown', ... }`
    - Remove column: `{ field: 'owned_by_ref_id', displayName: 'Owner ID', cellType: 'text', ... }`
    - Add column: `{ field: 'application_point_id', displayName: 'Application Point', cellType: 'application_point_picker', required: false, width: 260 }`
    - Remove `ownedByRefKindOptions` from imports at top of file
    - File path: `frontend/src/config/gridConfigs.ts`
  - [ ] 2.5 Update applicationPointDerivation.ts deriveApplicationIdForClass function
    - Remove switch statement on `classEntity.owned_by_ref_kind`
    - Look up Application Point by `classEntity.application_point_id` from `entities.application_points`
    - Return `applicationPoint?.application_id || ''`
    - Keep function signature and return type unchanged for API compatibility
    - File path: `frontend/src/utils/applicationPointDerivation.ts`
  - [ ] 2.6 Ensure frontend type tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- Class interface correctly typed with application_point_id
- OwnedByRefKind type is removed from model.ts
- Grid configuration uses application_point_picker cell type
- deriveApplicationIdForClass function works with new field

### Backend Testing

#### Task Group 3: Backend Test Updates
**Dependencies:** Task Groups 1 and 2

- [ ] 3.0 Complete backend test updates
  - [ ] 3.1 Write 2-4 focused tests for updated backend test fixtures
    - Test ModelController Class endpoint returns application_point_id in JSON
    - Test ModelService saves Class with applicationPointId correctly
    - Skip exhaustive coverage of all controller/service methods
  - [ ] 3.2 Update ModelControllerTest.java Class JSON fixtures
    - Replace `"owned_by_ref_kind": "..."` with `"application_point_id": "..."`
    - Replace `"owned_by_ref_id": "..."` with appropriate application point ID value
    - Update assertions to check for application_point_id in response
    - File path: `architecture-model-service/src/test/java/com/example/architecturemodel/controller/`
  - [ ] 3.3 Update ModelServiceSaveTest.java Class entity creation
    - Replace `.ownedByRefKind("...")` with `.applicationPointId("...")`
    - Replace `.ownedByRefId("...")` with appropriate application point ID value
    - Update assertions to verify applicationPointId field
    - File path: `architecture-model-service/src/test/java/com/example/architecturemodel/service/`
  - [ ] 3.4 Update TypedContentCreateSaveFlowTest.java if applicable
    - Search for any Class-related test data
    - Replace owned_by_ref_kind/owned_by_ref_id with application_point_id
    - File path: `architecture-model-service/src/test/java/com/example/architecturemodel/`
  - [ ] 3.5 Ensure backend test updates pass
    - Run ONLY the tests written in 3.1 plus updated tests from 3.2-3.4
    - Verify all Class-related tests pass with new field structure
    - Do NOT run the entire backend test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 3.1 pass
- All updated backend tests pass with application_point_id field
- No references to owned_by_ref_kind or owned_by_ref_id in Class test fixtures

### Frontend Testing

#### Task Group 4: Frontend Test Updates and Gap Analysis
**Dependencies:** Task Groups 1-3

- [ ] 4.0 Complete frontend test updates and gap analysis
  - [ ] 4.1 Review existing tests from Task Groups 1-3
    - Review the 4-6 tests written by backend engineer (Task 1.1)
    - Review the 4-6 tests written by frontend engineer (Task 2.1)
    - Review the 2-4 tests written by backend test engineer (Task 3.1)
    - Total existing tests: approximately 10-16 tests
  - [ ] 4.2 Update application-point-picker.test.ts
    - Ensure Class entities in test fixtures use `application_point_id`
    - Remove any references to `owned_by_ref_kind` or `owned_by_ref_id` on Class entities
    - Verify ApplicationPointPickerCell can be used in Classes grid
    - File path: `frontend/src/__tests__/application-point-picker.test.ts`
  - [ ] 4.3 Search and update any other frontend tests referencing Class owned_by fields
    - Search for `owned_by_ref_kind` in frontend test files
    - Search for `owned_by_ref_id` in frontend test files
    - Update any Class-related test fixtures to use `application_point_id`
  - [ ] 4.4 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to Class application_point_id feature
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [ ] 4.5 Write up to 6 additional strategic tests maximum
    - Integration test: Class grid displays Application Point picker cell
    - Integration test: Selecting Application Point updates Class entity correctly
    - Integration test: deriveApplicationIdForClass returns correct application_id from ApplicationPoint
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [ ] 4.6 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, and 4.5)
    - Expected total: approximately 16-22 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-22 tests total)
- Critical user workflows for Class application_point_id feature are covered
- No more than 6 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements
- No remaining references to owned_by_ref_kind or owned_by_ref_id in Class-related code

## Execution Order

Recommended implementation sequence:
1. **Task Group 1: Database Migration and Entity Updates** - Must be completed first as all other changes depend on the new data model
2. **Task Group 2: Frontend Type and Configuration Updates** - Can begin after backend entity layer is complete
3. **Task Group 3: Backend Test Updates** - Can begin after Task Groups 1 and 2 are complete
4. **Task Group 4: Frontend Test Updates and Gap Analysis** - Final step to ensure complete coverage

## Files to Modify

### Backend Files
| File | Action |
|------|--------|
| `architecture-model-service/src/main/resources/db/changelog/sql/025-class-application-point-id.sql` | CREATE |
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | MODIFY |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ClassEntity.java` | MODIFY |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ClassDto.java` | MODIFY |
| `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` | MODIFY |
| `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ModelControllerTest.java` | MODIFY |
| `architecture-model-service/src/test/java/com/example/architecturemodel/service/ModelServiceSaveTest.java` | MODIFY |

### Frontend Files
| File | Action |
|------|--------|
| `frontend/src/types/model.ts` | MODIFY |
| `frontend/src/config/defaults.ts` | MODIFY |
| `frontend/src/config/gridConfigs.ts` | MODIFY |
| `frontend/src/utils/applicationPointDerivation.ts` | MODIFY |
| `frontend/src/__tests__/application-point-picker.test.ts` | MODIFY |

## Existing Code to Leverage

**ApplicationPointPickerCell.tsx** (`frontend/src/components/Grid/ApplicationPointPickerCell.tsx`)
- Complete searchable dropdown component for selecting Application Points
- Already used in relationship grids (application_point_business_points, data_movements, etc.)
- No modifications needed - reuse as-is

**gridConfigs.ts application_point_picker pattern**
- Example from `application_point_business_points`: `{ field: 'application_point_id', displayName: 'Application Point', cellType: 'application_point_picker', required: true, width: 220, fkTarget: 'application_points', displayFormatter: applicationPointDisplayFormatter }`
- Use same pattern but with `required: false` for Class ownership

**EntityMapper.java patterns**
- Follow existing single-field FK patterns from ServiceEntity (`applicationId`, `packageSetId`)
- Reference lines 145-160 for ApplicationEntity mapping pattern

**Database migration patterns**
- Recent migrations (017-024b) show FK column addition with REFERENCES clause
- Use precondition pattern from 016-application-point-targeting

## Out of Scope

- Changes to other entity types (Service, Method, Interface, etc.)
- Changes to relationship grids or their configurations
- Backend validation enforcement (NOT NULL constraint on application_point_id)
- Data migration of existing `owned_by_ref_kind`/`owned_by_ref_id` values to `application_point_id`
- Auto-creation of Application Points for existing Class data
- Changes to ApplicationPointPickerCell component itself
- Changes to the diagram rendering for Class nodes
- Changes to the Application Point entity or its derivation logic beyond deriveApplicationIdForClass
- Rollback migration script

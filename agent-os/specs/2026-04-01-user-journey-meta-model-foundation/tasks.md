# Task Breakdown: User Journey Meta-Model Foundation

## Overview
Total Tasks: 37 sub-tasks across 5 task groups

This spec introduces two new first-class Business Architecture entities -- USER_JOURNEY and ACTIVITY_STEP -- with full backend persistence (Liquibase migration, JPA entities, DTOs, repositories, mapper, ModelService wiring, MetaModelSummary integration) plus frontend TypeScript type definitions. No new REST endpoints or UI components are needed; the entities flow through the existing GET/PUT `/api/model` endpoints automatically once wired into MetaModelEntitiesDto and ModelService.

## Task List

### Database & Persistence Layer

#### Task Group 1: Liquibase Migration
**Dependencies:** None

- [x] 1.0 Complete Liquibase migration for user_journeys and activity_steps tables
  - [x] 1.1 Create SQL migration file `architecture-model-service/src/main/resources/db/changelog/sql/059-user-journeys-activity-steps.sql`
    - `user_journeys` table: `id` TEXT PK, `model_file_id` TEXT NOT NULL FK to `model_files(id)` ON DELETE CASCADE, `name` TEXT NOT NULL, `description` TEXT, `tags` TEXT, `primary_business_user_id` TEXT nullable FK to `business_users(id)` with NO ACTION, `parent_business_process_id` TEXT nullable FK to `business_processes(id)` with NO ACTION
    - `activity_steps` table: `id` TEXT PK, `model_file_id` TEXT NOT NULL FK to `model_files(id)` ON DELETE CASCADE, `user_journey_id` TEXT NOT NULL FK to `user_journeys(id)` ON DELETE CASCADE, `name` TEXT NOT NULL, `description` TEXT, `tags` TEXT, `sequence_order` INTEGER nullable, `process_activity_id` TEXT NOT NULL FK to `process_activities(id)` with NO ACTION, `business_user_id` TEXT NOT NULL FK to `business_users(id)` with NO ACTION, `application_id` TEXT NOT NULL FK to `applications(id)` with NO ACTION
    - Indexes: `idx_user_journeys_model_file` on `user_journeys(model_file_id)`, `idx_activity_steps_model_file` on `activity_steps(model_file_id)`, `idx_activity_steps_user_journey` on `activity_steps(user_journey_id)`
    - Follow pattern from `sql/010-ui-screens-ui-workflow-transitions.sql` for CREATE TABLE + FK + INDEX structure
    - Cross-entity FKs (to process_activities, business_users, applications) must use NO ACTION (not CASCADE)
  - [x] 1.2 Add changeset entry in `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Changeset id: `059-user-journeys-activity-steps`, author: `architecture-tool`
    - preCondition: `not: tableExists: user_journeys` with `onFail: MARK_RAN`
    - Reference: `db/changelog/sql/059-user-journeys-activity-steps.sql`
    - Append after the existing `058-node-line-weight` changeset entry (line ~1100)
  - [x] 1.3 Verify migration file syntax
    - Confirm all FK references point to correct tables and columns
    - Confirm ON DELETE CASCADE only on model_file_id and user_journey_id parent-child FKs
    - Confirm NO ACTION (or omitted, which defaults to NO ACTION) on cross-entity FKs

**Acceptance Criteria:**
- SQL file creates both tables with correct columns, types, and constraints
- Changelog YAML references the new SQL file with correct precondition
- FK cascade behavior is correct: CASCADE for model_file_id and parent-child, NO ACTION for cross-entity references

---

### JPA Entity & DTO Layer

#### Task Group 2: JPA Entities, DTOs, Repositories, and Mapper
**Dependencies:** Task Group 1 (tables must exist for entity mapping)

- [x] 2.0 Complete JPA entity, DTO, repository, and mapper layer
  - [x] 2.1 Write 4 focused unit tests for EntityMapper UserJourney/ActivityStep toDto and toEntity methods
    - Test file: `architecture-model-service/src/test/java/com/example/architecturemodel/mapper/EntityMapperUserJourneyTest.java`
    - Test 1: `toDto_UserJourneyEntity_mapsAllFields` -- verify all fields map correctly, including nullable primaryBusinessUserId and parentBusinessProcessId
    - Test 2: `toEntity_UserJourneyDto_injectsModelFileId` -- verify modelFileId is injected via builder and not present on DTO
    - Test 3: `toDto_ActivityStepEntity_mapsAllFields` -- verify all fields including sequenceOrder, processActivityId, businessUserId, applicationId
    - Test 4: `toEntity_ActivityStepDto_injectsModelFileId` -- verify modelFileId injection and all FK fields preserved
    - Follow pattern from existing `DataEntityPointMapperTest.java` or similar mapper tests
  - [x] 2.2 Create `UserJourneyEntity.java` in `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/`
    - `@Entity @Table(name = "user_journeys")` with Lombok `@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder`
    - Fields: `id` (String, @Id), `modelFileId` (String, @Column not null), `name` (String, @Column not null), `description` (String), `tags` (String), `primaryBusinessUserId` (String), `parentBusinessProcessId` (String)
    - Follow exact pattern of `BusinessProcessEntity.java` -- all fields as simple `@Column` mapped Strings, no JPA relationship annotations
  - [x] 2.3 Create `ActivityStepEntity.java` in `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/`
    - `@Entity @Table(name = "activity_steps")` with same Lombok annotations
    - Fields: `id` (String, @Id), `modelFileId` (String, @Column not null), `userJourneyId` (String, @Column not null), `name` (String, @Column not null), `description` (String), `tags` (String), `sequenceOrder` (Integer), `processActivityId` (String, @Column not null), `businessUserId` (String, @Column not null), `applicationId` (String, @Column not null)
    - Follow exact pattern of `ProcessActivityEntity.java` -- parent FK (`userJourneyId`) stored as plain String, not @ManyToOne
  - [x] 2.4 Create `UserJourneyDto.java` in `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/`
    - Java record with `@JsonProperty` snake_case annotations
    - Fields: `id`, `name`, `description`, `tags`, `primary_business_user_id`, `parent_business_process_id`
    - No `model_file_id` field (stripped in mapper per convention)
    - Follow pattern of `BusinessProcessDto.java`
  - [x] 2.5 Create `ActivityStepDto.java` in `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/`
    - Java record with `@JsonProperty` snake_case annotations
    - Fields: `id`, `user_journey_id`, `name`, `description`, `tags`, `sequence_order`, `process_activity_id`, `business_user_id`, `application_id`
    - No `model_file_id` field per convention
    - Follow pattern of `ProcessActivityDto.java`
  - [x] 2.6 Create `UserJourneyRepository.java` in `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/`
    - Extend `JpaRepository<UserJourneyEntity, String>`
    - Methods: `findByModelFileId(String)` returning `List<UserJourneyEntity>`, `deleteByModelFileId(String)`
    - Follow exact interface pattern of `ProcessActivityRepository.java`
  - [x] 2.7 Create `ActivityStepRepository.java` in `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/`
    - Extend `JpaRepository<ActivityStepEntity, String>`
    - Methods: `findByModelFileId(String)` returning `List<ActivityStepEntity>`, `deleteByModelFileId(String)`
    - Follow exact interface pattern of `ProcessActivityRepository.java`
  - [x] 2.8 Add EntityMapper methods in `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
    - Add `toDto(UserJourneyEntity)` returning `UserJourneyDto` -- map all fields except modelFileId
    - Add `toEntity(UserJourneyDto, String modelFileId)` returning `UserJourneyEntity` -- inject modelFileId via builder
    - Add `toDto(ActivityStepEntity)` returning `ActivityStepDto` -- map all fields except modelFileId
    - Add `toEntity(ActivityStepDto, String modelFileId)` returning `ActivityStepEntity` -- inject modelFileId via builder
    - Place in the Business Domain section, after the existing ProcessActivity mapper methods (after line ~97)
    - Follow the exact pattern of the BusinessProcess/ProcessActivity toDto/toEntity methods
  - [x] 2.9 Run the 4 mapper tests from 2.1 and verify they pass
    - Run: `EntityMapperUserJourneyTest` only
    - All 4 tests should pass confirming correct field mapping and modelFileId injection

**Acceptance Criteria:**
- All 4 EntityMapper tests pass
- Entity classes compile with correct JPA annotations and Lombok builders
- DTO records compile with correct `@JsonProperty` annotations
- Repository interfaces follow the established pattern
- Mapper correctly strips modelFileId in toDto and injects it in toEntity

---

### Service Integration Layer

#### Task Group 3: MetaModelEntitiesDto, ModelService, and MetaModelSummary Wiring
**Dependencies:** Task Group 2 (entities, DTOs, repositories, and mapper must exist)

- [x] 3.0 Complete service layer integration
  - [x] 3.1 Write 6 focused tests for ModelService and MetaModelSummary integration
    - Test file 1: Add 2 tests to existing `ModelServiceLoadTest.java` (or create a focused supplement)
      - Test 1: `loadModel_includesUserJourneysAndActivitySteps` -- mock both repositories to return entities, verify they appear in the loaded MetaModelEntitiesDto
      - Test 2: `loadModel_handlesEmptyUserJourneysAndActivitySteps` -- verify empty lists are returned when no data exists
    - Test file 2: Add 2 tests to existing `ModelServiceSaveTest.java` (or create a focused supplement)
      - Test 3: `saveModel_persistsUserJourneys` -- verify UserJourneyRepository.saveAll is called with correctly mapped entities
      - Test 4: `saveModel_persistsActivitySteps` -- verify ActivityStepRepository.saveAll is called
    - Test file 3: New or existing test for MetaModelSummaryService
      - Test 5: `getMetaModelSummary_includesUserJourneys` -- mock UserJourneyRepository, verify userJourneys list appears in summary with entityType "userJourneys"
      - Test 6: `getMetaModelSummary_emptyUserJourneys` -- verify empty list when no user journeys exist
    - NOTE: These tests will require updating existing test setup (mock declarations, constructor calls) to include the new repositories
  - [x] 3.2 Add `user_journeys` and `activity_steps` fields to `MetaModelEntitiesDto.java`
    - Add `@JsonProperty("user_journeys") List<UserJourneyDto> userJourneys` after the existing `packageSetDefaultRules` entry
    - Add `@JsonProperty("activity_steps") List<ActivityStepDto> activitySteps` immediately after `userJourneys`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
    - This is a Java record, so adding fields changes the positional constructor -- all callers must be updated
  - [x] 3.3 Wire ModelService constructor with new repositories
    - Add `private final UserJourneyRepository userJourneyRepository` after existing entity repositories (after `packageSetDefaultRuleRepository`)
    - Add `private final ActivityStepRepository activityStepRepository` after `userJourneyRepository`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Since `@RequiredArgsConstructor` is used, no explicit constructor change needed -- just add the fields
  - [x] 3.4 Wire `loadEntities()` method in ModelService
    - Append two new repository fetch lines at the end of the MetaModelEntitiesDto constructor call (after `packageSetDefaultRules` fetch around line 763)
    - Line 1: `userJourneyRepository.findByModelFileId(modelFileId).stream().map(entityMapper::toDto).collect(Collectors.toList())`
    - Line 2: `activityStepRepository.findByModelFileId(modelFileId).stream().map(entityMapper::toDto).collect(Collectors.toList())`
  - [x] 3.5 Wire `createEmptyModel()` method in ModelService
    - Add two `List.of()` arguments at the end of the MetaModelEntitiesDto constructor (after the existing `packageSetDefaultRules` `List.of()` around line 223)
    - Add `List.of(), // userJourneys` and `List.of()  // activitySteps`
  - [x] 3.6 Wire `saveEntities()` method in ModelService
    - Save `userJourneys` AFTER `businessUsers`, `businessProcesses`, `processActivities`, and `applications` (FK dependencies on business_users, business_processes)
    - Save `activitySteps` AFTER `userJourneys`, `processActivities`, `businessUsers`, and `applications` (FK dependencies on all four)
    - Place both blocks near the end of `saveEntities()`, before the UI domain section (before line ~1103)
    - Use standard null-check-then-saveAll pattern:
      ```
      if (entities.userJourneys() != null) {
          userJourneyRepository.saveAll(entities.userJourneys().stream()
              .map(dto -> entityMapper.toEntity(dto, modelFileId))
              .collect(Collectors.toList()));
      }
      ```
    - Same pattern for activitySteps
  - [x] 3.7 Wire `deleteAllDataForModelFile()` method in ModelService
    - Delete `activitySteps` BEFORE `userJourneys` (child-first: activity_steps FK to user_journeys)
    - Delete `userJourneys` BEFORE `processActivities`, `businessProcesses`, and `businessUsers` (FK dependencies)
    - Place both deletes early in the entity deletion section -- after UI domain deletes but before the line that deletes `processActivityRepository.deleteByModelFileId()` (around line 888)
    - Pattern: `activityStepRepository.deleteByModelFileId(modelFileId);` then `userJourneyRepository.deleteByModelFileId(modelFileId);`
  - [x] 3.8 Add `user_journeys` field to `MetaModelSummaryDto.java`
    - Add `@JsonProperty("user_journeys") List<EntitySummary> userJourneys` positioned after `uiScreens` and before `dataStoreCount`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelSummaryDto.java`
    - This changes the positional constructor -- all callers must be updated
  - [x] 3.9 Wire `MetaModelSummaryService.java`
    - Add `private final UserJourneyRepository userJourneyRepository` constructor-injected field (after `uiScreenRepository`)
    - Add private method `fetchUserJourneys(String modelFileId)` following the exact pattern of `fetchUIScreens` -- returning `List<EntitySummary>` with entityType `"userJourneys"`
    - Update `getMetaModelSummary()`:
      - Call `List<EntitySummary> userJourneys = fetchUserJourneys(modelFileId);` after the `uiScreens` fetch
      - Pass `userJourneys` to the MetaModelSummaryDto constructor (between `uiScreens` and `dataStoreCount`)
    - Update the debug log message to include `userJourneys.size()` -- add `{} user journeys,` to the format string and `userJourneys.size()` to the arguments
  - [x] 3.10 Update all existing test files that construct MetaModelEntitiesDto or MetaModelSummaryDto
    - Any test that calls the MetaModelEntitiesDto constructor must add two new positional arguments (null or List.of()) for `userJourneys` and `activitySteps`
    - Any test that calls the MetaModelSummaryDto constructor must add one new positional argument for `userJourneys`
    - Any test that constructs ModelService must add mock declarations and constructor arguments for `UserJourneyRepository` and `ActivityStepRepository`
    - Any test that constructs MetaModelSummaryService must add mock declaration and constructor argument for `UserJourneyRepository`
    - Affected files include but are not limited to:
      - `ModelServiceLoadTest.java`, `ModelServiceSaveTest.java`
      - `ProjectSnapshotImportServiceTest.java`, `ProjectSnapshotOverwriteImportServiceTest.java`
      - `DiagramExportServiceTest.java`, `LegacySnapshotImportTest.java`
      - `ProjectSnapshotServiceTest.java` (if not .bak)
      - Any other test that references MetaModelEntitiesDto or MetaModelSummaryDto constructors
    - This is the most labor-intensive sub-task -- search for all usages of `new MetaModelEntitiesDto(` and `new MetaModelSummaryDto(` across the test source tree
  - [x] 3.11 Run the 6 tests from 3.1 and verify they pass
    - Run tests from the targeted test files only
    - Verify load, save, and summary integration work correctly

**Acceptance Criteria:**
- All 6 new integration tests pass
- ModelService correctly loads, saves, and deletes user_journeys and activity_steps
- MetaModelSummaryService includes user_journeys in the summary
- All existing tests that were updated still compile (constructor argument count matches)
- Snapshot export flows automatically via loadEntities returning the new lists
- Snapshot import flows automatically via saveEntities persisting the new lists
- Backward compatibility: importing snapshots without user_journeys/activity_steps works (null-check in saveEntities handles gracefully)

---

### Frontend Type Definitions

#### Task Group 4: TypeScript Interfaces and Type Updates
**Dependencies:** Task Group 3 (backend must define the JSON shape that frontend types mirror)

- [x] 4.0 Complete frontend TypeScript type definitions
  - [x] 4.1 Add `UserJourney` interface to `frontend/src/types/model.ts`
    - Place in the Business Domain section after `BusinessProcess` interface (around line 17)
    - Fields: `id: string`, `name: string`, `description: string`, `tags: string`, `primary_business_user_id?: string`, `parent_business_process_id?: string`
    - Optional FK fields use `?` suffix per codebase convention
  - [x] 4.2 Add `ActivityStep` interface to `frontend/src/types/model.ts`
    - Place immediately after the `UserJourney` interface
    - Fields: `id: string`, `user_journey_id: string`, `name: string`, `description: string`, `tags: string`, `sequence_order?: number`, `process_activity_id: string`, `business_user_id: string`, `application_id: string`
    - Required FK fields omit `?` per convention; only `sequence_order` is optional
  - [x] 4.3 Add fields to `MetaModelEntities` interface
    - Add `user_journeys: UserJourney[];` after `package_set_default_rules` (around line 2132)
    - Add `activity_steps: ActivityStep[];` after `user_journeys`
  - [x] 4.4 Add entries to `EntityType` union type
    - Add `| 'user_journeys'  // Business domain: user_journeys EntityType` after `packages` (around line 2194)
    - Add `| 'activity_steps';  // Business domain: activity_steps EntityType` after `user_journeys`
    - Ensure the previous last entry (`'packages'`) changes from having a semicolon to not having one (adding a pipe to continue the union)
  - [x] 4.5 Verify TypeScript compilation
    - Run `npx tsc --noEmit` from the `frontend/` directory to confirm no type errors introduced
    - Alternatively run `npm run build` to verify full build succeeds

**Acceptance Criteria:**
- `UserJourney` and `ActivityStep` interfaces are correctly defined with proper field types and optionality
- `MetaModelEntities` includes both new entity arrays
- `EntityType` union includes both new entity type strings
- TypeScript compilation succeeds with no errors

---

### Test Review & Verification

#### Task Group 5: Test Review, Gap Analysis, and Full Feature Verification
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps
  - [x] 5.1 Review all tests written in previous task groups
    - Review 4 mapper tests from Task 2.1 (EntityMapperUserJourneyTest)
    - Review 6 service integration tests from Task 3.1 (ModelService load/save + MetaModelSummary)
    - Total existing tests: 10 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Check: Is backward-compatible import tested? (snapshot with missing user_journeys/activity_steps fields should import cleanly)
    - Check: Is the delete ordering tested? (activity_steps deleted before user_journeys)
    - Check: Is DTO JSON serialization/deserialization correct? (snake_case property names)
    - Focus ONLY on gaps related to this spec's feature requirements
  - [x] 5.3 Write up to 6 additional strategic tests to fill identified gaps
    - Potential test 1: `UserJourneyDto_jsonSerialization` -- verify `@JsonProperty` snake_case names serialize correctly (similar to existing `ProjectDtoTest.java` or `ProjectSnapshotDtoTest.java`)
    - Potential test 2: `ActivityStepDto_jsonSerialization` -- verify snake_case serialization of all FK fields
    - Potential test 3: `MetaModelEntitiesDto_backwardCompatibility` -- deserialize JSON without `user_journeys`/`activity_steps` fields, verify they are null (Jackson default for missing record fields)
    - Potential test 4: `saveEntities_nullUserJourneys_skipsGracefully` -- verify no repository call when userJourneys is null (backward compat import path)
    - Potential test 5: `deleteAllDataForModelFile_deletesActivityStepsBeforeUserJourneys` -- verify delete ordering via InOrder mock verification
    - Potential test 6: `createEmptyModel_includesEmptyUserJourneysAndActivitySteps` -- verify the empty model has empty lists (not null) for the new entity types
    - Only write tests that fill genuine gaps -- skip if already covered
  - [x] 5.4 Run all feature-specific tests
    - Run all tests written in Task Groups 2, 3, and 5 (approximately 10-16 tests)
    - Also run the existing test files that were modified in Task 3.10 to confirm they still pass (the modified existing tests, not the entire application suite)
    - Verify no regressions in modified test files
  - [x] 5.5 Run a broader compilation and smoke check
    - Run `mvn compile` from `architecture-model-service/` to verify full Java compilation
    - Run `npx tsc --noEmit` from `frontend/` to verify TypeScript compilation
    - Optionally run `mvn test` on the full architecture-model-service to confirm no regressions (note: this is a broader check, not strictly required)

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 10-16 tests total)
- Critical backward compatibility path is tested (null user_journeys/activity_steps on import)
- Delete ordering is verified (child before parent)
- DTO serialization produces correct snake_case JSON
- Both Java and TypeScript compilation succeed
- No regressions in modified existing test files

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Liquibase Migration** -- Foundation database tables; no code dependencies
2. **Task Group 2: JPA Entities, DTOs, Repositories, Mapper** -- Data layer types that ModelService needs
3. **Task Group 3: MetaModelEntitiesDto, ModelService, MetaModelSummary** -- Wires everything together; this is the largest and most complex group due to MetaModelEntitiesDto record constructor changes rippling through all callers and tests
4. **Task Group 4: Frontend TypeScript Types** -- Independent of backend compilation, but logically depends on the JSON contract being finalized in Group 3
5. **Task Group 5: Test Review & Verification** -- Final validation across all layers

## Key Risk Notes

- **Task 3.2 (MetaModelEntitiesDto field addition)** is the highest-impact change. Since this is a Java record, adding two fields changes the positional constructor. Every call site in production code AND test code must be updated with the new arguments in the correct position. A search for `new MetaModelEntitiesDto(` across the entire codebase is essential.
- **Task 3.8 (MetaModelSummaryDto field addition)** has the same positional constructor ripple effect, though fewer callers.
- **Task 3.10 (updating existing tests)** is the most time-consuming sub-task. Multiple test files construct ModelService, MetaModelEntitiesDto, or MetaModelSummaryDto, and each needs mock additions and constructor argument updates.
- **Task 3.7 (delete ordering)** requires careful placement: activity_steps must be deleted before user_journeys, and both must be deleted before processActivities, businessProcesses, and businessUsers due to FK constraints.

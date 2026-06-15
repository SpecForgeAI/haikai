# Task Breakdown: Business Logic Entity + ApplicationPoint Join Table (v1)

## Overview
Total Tasks: 7 Task Groups with 39 sub-tasks

This feature introduces a new behavioural architecture concept "Business Logic" that can be stored in the meta-model and persisted in the database, along with a many-to-many join table linking Business Logic to Application Points.

## Task List

### Backend Database Layer

#### Task Group 1: Liquibase Migration
**Dependencies:** None

- [x] 1.0 Complete database migration for business_logics and join table
  - [x] 1.1 Create SQL migration file `015-business-logic.sql`
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/015-business-logic.sql`
    - Create `business_logics` table with columns:
      - `id` VARCHAR(255) PRIMARY KEY
      - `model_file_id` VARCHAR(255) NOT NULL FK to model_files.id
      - `name` VARCHAR(255) NOT NULL
      - `type_text` VARCHAR(255)
      - `description_md` TEXT
      - `tags` VARCHAR(1000)
      - `valid_from` VARCHAR(50)
      - `valid_to` VARCHAR(50)
    - Create `application_point_business_logics` join table with columns:
      - `id` VARCHAR(255) PRIMARY KEY
      - `model_file_id` VARCHAR(255) NOT NULL FK to model_files.id
      - `application_point_id` VARCHAR(255) NOT NULL FK to application_points.id
      - `business_logic_id` VARCHAR(255) NOT NULL FK to business_logics.id
      - `description` VARCHAR(1000)
      - `tags` VARCHAR(1000)
      - `valid_from` VARCHAR(50)
      - `valid_to` VARCHAR(50)
    - Add ON DELETE CASCADE for all foreign keys
    - Add indexes on `model_file_id`, `application_point_id`, `business_logic_id`
    - Add unique composite constraint on `(application_point_id, business_logic_id)`
    - **Reference pattern:** `architecture-model-service/src/main/resources/db/changelog/sql/010-ui-screens-ui-workflow-transitions.sql`
  - [x] 1.2 Register changeset in `db.changelog-master.yaml`
    - **File:** `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Add changeset with id `015-business-logic`
    - Add precondition checking `business_logics` table does not exist
    - **Reference:** Lines 147-161 for existing changeset pattern
  - [x] 1.3 Verify migration runs successfully
    - Start application and verify tables created
    - Verify indexes exist on FK columns
    - Verify unique constraint on join table

**Acceptance Criteria:**
- `business_logics` table created with all columns
- `application_point_business_logics` join table created with all columns
- Foreign keys with ON DELETE CASCADE working correctly
- Indexes created on FK columns
- Unique constraint prevents duplicate application_point/business_logic pairs

---

### Backend Entity/Repository Layer

#### Task Group 2: JPA Entities and Repositories
**Dependencies:** Task Group 1

- [x] 2.0 Complete JPA entity and repository layer
  - [x] 2.1 Write 3-4 focused tests for entity persistence
    - Test BusinessLogicEntity save/load
    - Test ApplicationPointBusinessLogicEntity save/load with FK
    - Test cascade delete behavior
    - Test unique constraint enforcement on join table
    - **Place tests in:** `architecture-model-service/src/test/java/com/example/architecturemodel/integration/BusinessLogicIntegrationTest.java`
  - [x] 2.2 Create `BusinessLogicEntity` JPA entity
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/BusinessLogicEntity.java`
    - Use `@Table(name = "business_logics")`
    - Add Lombok annotations: `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`
    - Fields: `id`, `modelFileId`, `name`, `typeText`, `descriptionMd`, `tags`, `validFrom`, `validTo`
    - Use `@Column(name = "snake_case")` for all fields
    - **Reference pattern:** `ApplicationPointEntity.java` lines 6-42
  - [x] 2.3 Create `ApplicationPointBusinessLogicEntity` JPA entity
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationPointBusinessLogicEntity.java`
    - Use `@Table(name = "application_point_business_logics")`
    - Add Lombok annotations
    - Fields: `id`, `modelFileId`, `applicationPointId`, `businessLogicId`, `description`, `tags`, `validFrom`, `validTo`
    - **Reference pattern:** `ApplicationPointBusinessPointEntity.java` lines 1-39
  - [x] 2.4 Create `BusinessLogicRepository` interface
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/BusinessLogicRepository.java`
    - Extend `JpaRepository<BusinessLogicEntity, String>`
    - Add `List<BusinessLogicEntity> findByModelFileId(String modelFileId)`
    - Add `void deleteByModelFileId(String modelFileId)`
    - **Reference pattern:** `EventRepository.java`
  - [x] 2.5 Create `ApplicationPointBusinessLogicRepository` interface
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/ApplicationPointBusinessLogicRepository.java`
    - Extend `JpaRepository<ApplicationPointBusinessLogicEntity, String>`
    - Add `List<ApplicationPointBusinessLogicEntity> findByModelFileId(String modelFileId)`
    - Add `void deleteByModelFileId(String modelFileId)`
    - **Reference pattern:** `ApplicationPointBusinessPointRepository.java`
  - [x] 2.6 Run entity persistence tests
    - Execute tests from 2.1
    - Verify all CRUD operations work
    - Verify FK constraints enforced

**Acceptance Criteria:**
- Entity tests pass
- Both entities map correctly to database tables
- Repositories provide required findByModelFileId and deleteByModelFileId methods
- Foreign key constraints work correctly

---

### Backend DTO/Mapper Layer

#### Task Group 3: DTOs and EntityMapper
**Dependencies:** Task Group 2

- [x] 3.0 Complete DTO and mapper layer
  - [x] 3.1 Write 2-4 focused tests for DTO mapping
    - Test BusinessLogicDto JSON serialization (snake_case)
    - Test ApplicationPointBusinessLogicDto JSON serialization
    - Test EntityMapper toDto/toEntity bidirectional mapping
    - **Place tests in:** `architecture-model-service/src/test/java/com/example/architecturemodel/integration/BusinessLogicIntegrationTest.java`
  - [x] 3.2 Create `BusinessLogicDto` record
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/BusinessLogicDto.java`
    - Use Java record with `@JsonProperty` annotations for snake_case:
      - `id`, `name`
      - `@JsonProperty("type_text")` typeText
      - `@JsonProperty("description_md")` descriptionMd
      - `tags`
      - `@JsonProperty("valid_from")` validFrom
      - `@JsonProperty("valid_to")` validTo
    - **Reference pattern:** `EventDto.java`
  - [x] 3.3 Create `ApplicationPointBusinessLogicDto` record
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/ApplicationPointBusinessLogicDto.java`
    - Use Java record with `@JsonProperty` annotations:
      - `id`
      - `@JsonProperty("application_point_id")` applicationPointId
      - `@JsonProperty("business_logic_id")` businessLogicId
      - `description`, `tags`
      - `@JsonProperty("valid_from")` validFrom
      - `@JsonProperty("valid_to")` validTo
    - **Reference pattern:** `ApplicationPointBusinessPointDto.java`
  - [x] 3.4 Update `MetaModelEntitiesDto` with businessLogics field
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
    - Add field after `activityPartitions` (line ~79):
      ```java
      @JsonProperty("business_logics")
      List<BusinessLogicDto> businessLogics
      ```
    - Update record constructor parameter list
  - [x] 3.5 Update `MetaModelRelationshipsDto` with applicationPointBusinessLogics field
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelRelationshipsDto.java`
    - Add field after `uiWorkflowTransitions` (line ~31):
      ```java
      @JsonProperty("application_point_business_logics")
      List<ApplicationPointBusinessLogicDto> applicationPointBusinessLogics
      ```
    - Update record constructor parameter list
  - [x] 3.6 Add EntityMapper methods for BusinessLogic
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
    - Add in Behavioural Domain section (after line ~689):
      ```java
      // ============================================================================
      // Business Logic Entity Mappings (Behavioural Domain)
      // ============================================================================

      public BusinessLogicDto toDto(BusinessLogicEntity entity) { ... }
      public BusinessLogicEntity toEntity(BusinessLogicDto dto, String modelFileId) { ... }
      ```
    - **Reference pattern:** Lines 614-631 (ActivityDto methods)
  - [x] 3.7 Add EntityMapper methods for ApplicationPointBusinessLogic
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
    - Add in Relationship Mappings section (after line ~999):
      ```java
      public ApplicationPointBusinessLogicDto toDto(ApplicationPointBusinessLogicEntity entity) { ... }
      public ApplicationPointBusinessLogicEntity toEntity(ApplicationPointBusinessLogicDto dto, String modelFileId) { ... }
      ```
    - **Reference pattern:** Lines 976-999 (ApplicationPointBusinessPoint methods)
  - [x] 3.8 Run DTO mapping tests
    - Execute tests from 3.1
    - Verify JSON serialization uses snake_case
    - Verify bidirectional mapping preserves all fields

**Acceptance Criteria:**
- DTO tests pass
- JSON serialization uses snake_case field names
- EntityMapper correctly converts between Entity and DTO
- MetaModel DTOs include new fields

---

### Backend ModelService Layer

#### Task Group 4: ModelService Load/Save Integration
**Dependencies:** Task Group 3

- [x] 4.0 Complete ModelService integration for load/save
  - [x] 4.1 Write 3-4 focused tests for load/save operations
    - Test loading model with businessLogics
    - Test saving model with businessLogics
    - Test loading model with applicationPointBusinessLogics
    - Test saving model with applicationPointBusinessLogics
    - Test deleteAllDataForModelFile includes new entities
    - **Place tests in:** `architecture-model-service/src/test/java/com/example/architecturemodel/integration/BusinessLogicIntegrationTest.java`
  - [x] 4.2 Inject repositories into ModelService
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Add repository fields (after line ~69):
      ```java
      private final BusinessLogicRepository businessLogicRepository;
      private final ApplicationPointBusinessLogicRepository applicationPointBusinessLogicRepository;
      ```
    - Lombok `@RequiredArgsConstructor` will auto-inject via constructor
  - [x] 4.3 Update `loadEntities()` method
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Add businessLogics loading in `loadEntities()` after activityPartitions (around line ~465):
      ```java
      businessLogicRepository.findByModelFileId(modelFileId).stream()
          .map(entityMapper::toDto).collect(Collectors.toList()),
      ```
    - Update MetaModelEntitiesDto constructor call to include new parameter
  - [x] 4.4 Update `loadRelationships()` method
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Add applicationPointBusinessLogics loading after uiWorkflowTransitions (around line ~496):
      ```java
      applicationPointBusinessLogicRepository.findByModelFileId(modelFileId).stream()
          .map(entityMapper::toDto).collect(Collectors.toList())
      ```
    - Update MetaModelRelationshipsDto constructor call
  - [x] 4.5 Update `saveEntities()` method
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Add businessLogics saving in Behavioural domain section (after activityPartitions, around line ~742):
      ```java
      // Behavioural domain: BusinessLogics have no FK dependencies
      if (entities.businessLogics() != null) {
          businessLogicRepository.saveAll(entities.businessLogics().stream()
              .map(dto -> entityMapper.toEntity(dto, modelFileId))
              .collect(Collectors.toList()));
      }
      ```
  - [x] 4.6 Update `saveRelationships()` method
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Add applicationPointBusinessLogics saving (after uiWorkflowTransitions, around line ~832):
      ```java
      if (relationships.applicationPointBusinessLogics() != null) {
          applicationPointBusinessLogicRepository.saveAll(relationships.applicationPointBusinessLogics().stream()
              .map(dto -> entityMapper.toEntity(dto, modelFileId))
              .collect(Collectors.toList()));
      }
      ```
  - [x] 4.7 Update `deleteAllDataForModelFile()` method
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Add delete calls with correct dependency ordering:
      - Delete `applicationPointBusinessLogicRepository.deleteByModelFileId(modelFileId)` BEFORE businessLogics (join table first)
      - Delete `businessLogicRepository.deleteByModelFileId(modelFileId)` in Behavioural domain section
    - Place applicationPointBusinessLogics delete around line ~551 (after applicationPointBusinessPoints)
    - Place businessLogics delete around line ~564 (before eventRepository)
  - [x] 4.8 Run ModelService integration tests
    - Execute tests from 4.1
    - Verify round-trip load/save works
    - Verify delete cascade works correctly

**Acceptance Criteria:**
- ModelService tests pass
- GET /api/model returns business_logics and application_point_business_logics
- PUT /api/model persists both collections
- Delete cascades correctly (join table deleted before business_logics)

---

### Frontend Model Layer

#### Task Group 5: Frontend Types and Defaults
**Dependencies:** Task Group 4

- [x] 5.0 Complete frontend type definitions and defaults
  - [x] 5.1 Add `BusinessLogic` interface to model.ts
    - **File:** `frontend/src/types/model.ts`
    - Add in Behavioural Domain section (after ActivityPartition, around line ~606):
      ```typescript
      /**
       * BusinessLogic entity - represents reusable business rules and logic
       * in the Behavioural Architecture domain.
       */
      export interface BusinessLogic {
        id: string;
        name: string;
        type_text?: string;
        description_md?: string;
        tags?: string;
        valid_from?: string;
        valid_to?: string;
      }
      ```
  - [x] 5.2 Add `ApplicationPointBusinessLogic` interface to model.ts
    - **File:** `frontend/src/types/model.ts`
    - Add in Relationships section (after ApplicationPointBusinessPoint, around line ~912):
      ```typescript
      /**
       * ApplicationPointBusinessLogic - join relationship linking
       * Application Points to Business Logic entities.
       */
      export interface ApplicationPointBusinessLogic {
        id: string;
        application_point_id: string;
        business_logic_id: string;
        description?: string;
        tags?: string;
        valid_from?: string;
        valid_to?: string;
      }
      ```
  - [x] 5.3 Update `MetaModelEntities` interface
    - **File:** `frontend/src/types/model.ts`
    - Add field in MetaModelEntities (around line ~1776):
      ```typescript
      business_logics: BusinessLogic[];  // Behavioural domain: Business Logic entities
      ```
  - [x] 5.4 Update `MetaModelRelationships` interface
    - **File:** `frontend/src/types/model.ts`
    - Add field in MetaModelRelationships (around line ~1790):
      ```typescript
      application_point_business_logics: ApplicationPointBusinessLogic[];
      ```
  - [x] 5.5 Update `EntityType` union type
    - **File:** `frontend/src/types/model.ts`
    - Add 'business_logics' to EntityType union (around line ~1831):
      ```typescript
      | 'business_logics'  // Behavioural domain: business_logics EntityType
      ```
  - [x] 5.6 Update `RelationshipType` union type
    - **File:** `frontend/src/types/model.ts`
    - Add 'application_point_business_logics' to RelationshipType union (around line ~1843):
      ```typescript
      | 'application_point_business_logics';  // Application Point to Business Logic relationship
      ```
  - [x] 5.7 Update `AnyEntity` and `AnyRelationship` union types
    - **File:** `frontend/src/types/model.ts`
    - Add `BusinessLogic` to AnyEntity union (around line ~1872)
    - Add `ApplicationPointBusinessLogic` to AnyRelationship union (around line ~1884)
  - [x] 5.8 Update `emptyModel` in defaults.ts
    - **File:** `frontend/src/config/defaults.ts`
    - Add to entities (around line ~1145):
      ```typescript
      business_logics: [],  // Behavioural domain: Business Logic entities
      ```
    - Add to relationships (around line ~1160):
      ```typescript
      application_point_business_logics: [],  // Application Point to Business Logic relationships
      ```

**Acceptance Criteria:**
- TypeScript compiles without errors
- BusinessLogic interface matches backend DTO field names (snake_case)
- ApplicationPointBusinessLogic interface matches backend DTO
- emptyModel includes empty arrays for both new collections
- Type unions updated for type-safe operations

---

### Frontend UI Layer

#### Task Group 6: Frontend Grid Configuration
**Dependencies:** Task Group 5

- [x] 6.0 Complete frontend grid configuration
  - [x] 6.1 Add `business_logics` grid config
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Add in Behavioural Domain section (after activity_partitions, around line ~298):
      ```typescript
      // ============================================================================
      // Behavioural Domain: Business Logics Entity Grid Configuration
      // ============================================================================
      business_logics: [
        { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
        { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
        { field: 'type_text', displayName: 'Type', cellType: 'text', required: false, width: 150 },
        { field: 'description_md', displayName: 'Description (MD)', cellType: 'text', required: false, width: 250 },
        { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 150 },
        { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
        { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
      ],
      ```
    - **Reference pattern:** Lines 265-298 (activities/events grid configs)
  - [x] 6.2 Add `tabToEntityType` mapping for Business Logics
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Add in tabToEntityType (around line ~460):
      ```typescript
      'Business Logics': 'business_logics',
      ```
  - [x] 6.3 Add to `entityTabNames` array
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Add 'Business Logics' to entityTabNames (around line ~498):
      ```typescript
      'Business Logics',
      ```
  - [x] 6.4 Add to `domainGroupings.behavioural` array
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Add 'Business Logics' to behavioural domain (line ~515):
      ```typescript
      behavioural: ['Events', 'States', 'State Transitions', 'Activity Nodes', 'Activity Flows', 'Activity Partitions', 'Business Logics'],
      ```
  - [x] 6.5 Add to `DOMAIN_ENTITY_TYPES.behavioural` array
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Add 'business_logics' to behavioural types (line ~533):
      ```typescript
      behavioural: ['events', 'states', 'state_transitions', 'activities', 'activity_flows', 'activity_partitions', 'business_logics'],
      ```
  - [x] 6.6 Add entity colors for BUSINESS_LOGIC
    - **File:** `frontend/src/config/defaults.ts`
    - Add in entityColors (around line ~418):
      ```typescript
      BUSINESS_LOGIC: { background: '#FCE4EC', border: '#C2185B' }, // Light pink - behavioural domain business logic entity
      ```
  - [x] 6.7 Add ENTITY_TYPES constant for BUSINESS_LOGIC
    - **File:** `frontend/src/types/model.ts`
    - Add in ENTITY_TYPES constant (around line ~1030):
      ```typescript
      BUSINESS_LOGIC: 'BUSINESS_LOGIC',  // Behavioural domain: Business Logic entity type
      ```
  - [x] 6.8 Add relationship grid config for application_point_business_logics
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Add grid config for join table
  - [x] 6.9 Add relationshipTabToType mapping
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Add 'App Point <-> Business Logic': 'application_point_business_logics'
  - [x] 6.10 Add to relationshipTabNames array
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Add 'App Point <-> Business Logic'
  - [x] 6.11 Update fileOperations.ts with BusinessLogic import and array
    - **File:** `frontend/src/utils/fileOperations.ts`
    - Add BusinessLogic to import and buildModelFromData
  - [x] 6.12 Update sanitize.ts with business_logics and application_point_business_logics
    - **File:** `frontend/src/utils/sanitize.ts`
    - Add both arrays to sanitizeMetaModel
  - [x] 6.13 Update validation.ts with BUSINESS_LOGIC display name and validation arrays
    - **File:** `frontend/src/utils/validation.ts`
    - Add to ENTITY_TYPE_DISPLAY_NAMES, entityTypes array, entityArrays, relationshipArrays

**Acceptance Criteria:**
- Business Logics tab appears in Behavioural domain in MetaModel UI
- Grid displays all columns with correct types
- Users can create/edit/delete Business Logic rows
- ID auto-generates on new row creation
- Tags column supports tag input

---

### Integration Testing

#### Task Group 7: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 2-4
    - Review entity persistence tests from Task 2.1
    - Review DTO mapping tests from Task 3.1
    - Review ModelService tests from Task 4.1
    - Total existing tests: approximately 10-12 tests
  - [x] 7.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to business_logics feature requirements
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 7.3 Write up to 5 additional strategic tests maximum
    - Test end-to-end save/load round-trip via API
    - Test unique constraint prevents duplicate join records
    - Test cascade delete removes join records when business_logic deleted
    - Test cascade delete removes join records when application_point deleted
    - Test JSON serialization matches frontend expected format
    - **Place tests in:** `architecture-model-service/src/test/java/com/example/architecturemodel/integration/BusinessLogicIntegrationTest.java`
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests related to business_logics feature
    - Expected total: approximately 15-17 tests maximum
    - Verify critical workflows pass
  - [ ] 7.5 Manual verification of MetaModel UI
    - Start frontend application
    - Navigate to Meta-Model View
    - Select Behavioural domain
    - Verify "Business Logics" tab appears
    - Create a new Business Logic row
    - Edit the row
    - Save model via File -> Save
    - Reload page and verify data persisted
    - Delete the row and save again

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 15-17 tests total)
- Critical user workflows for this feature are covered
- No more than 5 additional tests added when filling in testing gaps
- Manual verification confirms end-to-end workflow works
- Model save/load round-trips without errors

---

## Execution Order

Recommended implementation sequence:

1. **Database Layer (Task Group 1)** - Creates tables, must complete first
2. **JPA Entities/Repositories (Task Group 2)** - Depends on database tables
3. **DTOs/Mappers (Task Group 3)** - Depends on entities for mapping
4. **ModelService Integration (Task Group 4)** - Depends on DTOs and repositories
5. **Frontend Types/Defaults (Task Group 5)** - Can start after backend API working
6. **Frontend Grid Configuration (Task Group 6)** - Depends on types being defined
7. **Integration Testing (Task Group 7)** - Final verification after all components complete

---

## File Reference Summary

### Backend Files to Create
- `architecture-model-service/src/main/resources/db/changelog/sql/015-business-logic.sql`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/BusinessLogicEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationPointBusinessLogicEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/BusinessLogicRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/ApplicationPointBusinessLogicRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/BusinessLogicDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/ApplicationPointBusinessLogicDto.java`

### Backend Files to Modify
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelRelationshipsDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`

### Frontend Files to Modify
- `frontend/src/types/model.ts`
- `frontend/src/config/defaults.ts`
- `frontend/src/config/gridConfigs.ts`
- `frontend/src/utils/fileOperations.ts`
- `frontend/src/utils/sanitize.ts`
- `frontend/src/utils/validation.ts`

---

## Out of Scope (Per Spec)

The following are explicitly NOT part of this v1 implementation:
- UI to attach/detach Business Logic to Application Points (deferred to Spec 2)
- Expanding Application Point selection to include Class/Method entities (deferred to Spec 2)
- Business Logic type suggestions or templates (deferred to Spec 3/4)
- Business Logic type as enum/dropdown - remains free-text in v1
- Palette panel integration for Business Logic nodes
- Diagram rendering of Business Logic entities
- Validation rules for Business Logic type_text values
- API endpoints beyond the existing /api/model GET/PUT
- Frontend grid for application_point_business_logics relationship (join table not exposed in UI in v1)

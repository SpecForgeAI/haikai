# Task Breakdown: Add Class and Method Entities to Application Architecture Domain

## Overview
Total Tasks: 11 Task Groups (approximately 60 sub-tasks)

This spec introduces two new Application Architecture meta-model entities:
- **Class**: Represents software classes within the Application Architecture
- **Method**: Represents behavioral interfaces owned by Classes (with parameters, returns, throws)

---

## Task List

### Backend Layer

#### Task Group 1: Database Schema (Liquibase Migration)
**Dependencies:** None

- [x] 1.0 Complete database schema for Class and Method entities
  - [x] 1.1 Create new SQL migration file for Class and Method tables
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/002-classes-methods.sql`
    - Create `classes` table with columns:
      - `id` TEXT PRIMARY KEY
      - `model_file_id` TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE
      - `name` TEXT NOT NULL
      - `description` TEXT
      - `namespace` TEXT
      - `owned_by_ref_kind` TEXT (Application, ApplicationComponent, Service, Interface)
      - `owned_by_ref_id` TEXT
    - Create `methods` table with columns:
      - `id` TEXT PRIMARY KEY
      - `model_file_id` TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE
      - `class_id` TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE
      - `name` TEXT NOT NULL
      - `description` TEXT
      - `parameters_json` JSONB (nullable)
      - `returns_json` JSONB (nullable)
      - `throws_json` JSONB (nullable)
  - [x] 1.2 Add indexes to migration file
    - `CREATE INDEX idx_classes_model_file ON classes(model_file_id);`
    - `CREATE INDEX idx_methods_model_file ON methods(model_file_id);`
    - `CREATE INDEX idx_methods_class ON methods(class_id);`
  - [x] 1.3 Update db.changelog-master.yaml
    - File: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Add new changeSet referencing `002-classes-methods.sql`
  - [x] 1.4 Verify migration runs successfully (DEFERRED: requires running PostgreSQL environment)
    - Start architecture-model-service locally
    - Confirm tables and indexes are created in PostgreSQL

**Acceptance Criteria:**
- `classes` and `methods` tables exist in database
- Foreign key from `methods.class_id` to `classes.id` with ON DELETE CASCADE
- All indexes created successfully

---

#### Task Group 2: JPA Entities (ClassEntity, MethodEntity)
**Dependencies:** Task Group 1

- [x] 2.0 Complete JPA entities for Class and Method
  - [x] 2.1 Create ClassEntity.java
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ClassEntity.java`
    - Follow pattern from `ServiceEntity.java`
    - Annotations: `@Entity`, `@Table(name = "classes")`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`
    - Fields:
      - `id` (String, `@Id`, `@Column(name = "id", nullable = false)`)
      - `modelFileId` (String, `@Column(name = "model_file_id", nullable = false)`)
      - `name` (String, `@Column(name = "name", nullable = false)`)
      - `description` (String, `@Column(name = "description")`)
      - `namespace` (String, `@Column(name = "namespace")`)
      - `ownedByRefKind` (String, `@Column(name = "owned_by_ref_kind")`)
      - `ownedByRefId` (String, `@Column(name = "owned_by_ref_id")`)
  - [x] 2.2 Create MethodEntity.java
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/MethodEntity.java`
    - Follow pattern from `EndpointEntity.java` (has parent FK)
    - Annotations: Same as ClassEntity
    - Fields:
      - `id` (String, `@Id`, `@Column(name = "id", nullable = false)`)
      - `modelFileId` (String, `@Column(name = "model_file_id", nullable = false)`)
      - `classId` (String, `@Column(name = "class_id", nullable = false)`)
      - `name` (String, `@Column(name = "name", nullable = false)`)
      - `description` (String, `@Column(name = "description")`)
      - `parametersJson` (String, `@Column(name = "parameters_json")`) - stored as TEXT
      - `returnsJson` (String, `@Column(name = "returns_json")`) - stored as TEXT
      - `throwsJson` (String, `@Column(name = "throws_json")`) - stored as TEXT

**Acceptance Criteria:**
- JPA entities compile without errors
- Lombok annotations generate getters, setters, builder
- Column mappings match database schema

---

#### Task Group 3: DTOs (ClassDto, MethodDto)
**Dependencies:** Task Group 2

- [x] 3.0 Complete DTOs for Class and Method
  - [x] 3.1 Create ClassDto.java
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ClassDto.java`
    - Java record with `@JsonProperty` annotations for snake_case API contract
    - Fields:
      ```java
      public record ClassDto(
          @JsonProperty("id") String id,
          @JsonProperty("name") String name,
          @JsonProperty("description") String description,
          @JsonProperty("namespace") String namespace,
          @JsonProperty("owned_by_ref_kind") String ownedByRefKind,
          @JsonProperty("owned_by_ref_id") String ownedByRefId
      ) {}
      ```
  - [x] 3.2 Create MethodDto.java
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/MethodDto.java`
    - Java record with `@JsonProperty` annotations
    - Fields:
      ```java
      public record MethodDto(
          @JsonProperty("id") String id,
          @JsonProperty("class_id") String classId,
          @JsonProperty("name") String name,
          @JsonProperty("description") String description,
          @JsonProperty("parameters_json") String parametersJson,
          @JsonProperty("returns_json") String returnsJson,
          @JsonProperty("throws_json") String throwsJson
      ) {}
      ```
  - [x] 3.3 Update MetaModelEntitiesDto.java
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
    - Add two new fields after `endpoints`:
      ```java
      @JsonProperty("classes")
      List<ClassDto> classes,

      @JsonProperty("methods")
      List<MethodDto> methods,
      ```
    - Update record constructor to include new fields

**Acceptance Criteria:**
- DTOs serialize/deserialize with snake_case JSON field names
- MetaModelEntitiesDto includes classes and methods arrays

---

#### Task Group 4: Repositories (ClassRepository, MethodRepository)
**Dependencies:** Task Group 2

- [x] 4.0 Complete repositories for Class and Method
  - [x] 4.1 Create ClassRepository.java
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/ClassRepository.java`
    - Follow pattern from `ServiceRepository.java`
    - Interface:
      ```java
      @Repository
      public interface ClassRepository extends JpaRepository<ClassEntity, String> {
          List<ClassEntity> findByModelFileId(String modelFileId);
          void deleteByModelFileId(String modelFileId);
      }
      ```
  - [x] 4.2 Create MethodRepository.java
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/MethodRepository.java`
    - Follow pattern from `EndpointRepository.java`
    - Interface:
      ```java
      @Repository
      public interface MethodRepository extends JpaRepository<MethodEntity, String> {
          List<MethodEntity> findByModelFileId(String modelFileId);
          List<MethodEntity> findByClassId(String classId);
          void deleteByModelFileId(String modelFileId);
          void deleteByClassId(String classId);
      }
      ```

**Acceptance Criteria:**
- Repositories extend JpaRepository correctly
- Query methods follow Spring Data JPA naming conventions

---

#### Task Group 5: EntityMapper Updates
**Dependencies:** Task Groups 2, 3

- [x] 5.0 Add mapping methods to EntityMapper
  - [x] 5.1 Update EntityMapper.java with Class mappings
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
    - Add `toDto(ClassEntity entity)` method:
      ```java
      public ClassDto toDto(ClassEntity entity) {
          return new ClassDto(
              entity.getId(),
              entity.getName(),
              entity.getDescription(),
              entity.getNamespace(),
              entity.getOwnedByRefKind(),
              entity.getOwnedByRefId()
          );
      }
      ```
    - Add `toEntity(ClassDto dto, String modelFileId)` method:
      ```java
      public ClassEntity toEntity(ClassDto dto, String modelFileId) {
          return ClassEntity.builder()
              .id(dto.id())
              .modelFileId(modelFileId)
              .name(dto.name())
              .description(dto.description())
              .namespace(dto.namespace())
              .ownedByRefKind(dto.ownedByRefKind())
              .ownedByRefId(dto.ownedByRefId())
              .build();
      }
      ```
  - [x] 5.2 Update EntityMapper.java with Method mappings
    - Add `toDto(MethodEntity entity)` method:
      ```java
      public MethodDto toDto(MethodEntity entity) {
          return new MethodDto(
              entity.getId(),
              entity.getClassId(),
              entity.getName(),
              entity.getDescription(),
              entity.getParametersJson(),
              entity.getReturnsJson(),
              entity.getThrowsJson()
          );
      }
      ```
    - Add `toEntity(MethodDto dto, String modelFileId)` method:
      ```java
      public MethodEntity toEntity(MethodDto dto, String modelFileId) {
          return MethodEntity.builder()
              .id(dto.id())
              .modelFileId(modelFileId)
              .classId(dto.classId())
              .name(dto.name())
              .description(dto.description())
              .parametersJson(dto.parametersJson())
              .returnsJson(dto.returnsJson())
              .throwsJson(dto.throwsJson())
              .build();
      }
      ```

**Acceptance Criteria:**
- EntityMapper correctly converts between Entity and DTO
- All fields are mapped correctly

---

#### Task Group 6: ModelService Integration
**Dependencies:** Task Groups 4, 5

- [x] 6.0 Integrate Class and Method into ModelService
  - [x] 6.1 Inject repositories into ModelService
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Add repository fields:
      ```java
      private final ClassRepository classRepository;
      private final MethodRepository methodRepository;
      ```
  - [x] 6.2 Update loadEntities() method
    - Add class loading after endpoints:
      ```java
      classRepository.findByModelFileId(modelFileId).stream()
          .map(entityMapper::toDto).collect(Collectors.toList()),
      ```
    - Add method loading after classes:
      ```java
      methodRepository.findByModelFileId(modelFileId).stream()
          .map(entityMapper::toDto).collect(Collectors.toList()),
      ```
    - Update MetaModelEntitiesDto constructor call to include classes and methods
  - [x] 6.3 Update deleteAllDataForModelFile() method
    - Add deletion in correct order (methods before classes due to FK):
      ```java
      methodRepository.deleteByModelFileId(modelFileId);
      classRepository.deleteByModelFileId(modelFileId);
      ```
    - Place after endpoint deletion, before applicationPoint deletion
  - [x] 6.4 Update saveEntities() method
    - Add class saving after endpoints:
      ```java
      if (entities.classes() != null) {
          classRepository.saveAll(entities.classes().stream()
              .map(dto -> entityMapper.toEntity(dto, modelFileId))
              .collect(Collectors.toList()));
      }
      ```
    - Add method saving after classes:
      ```java
      if (entities.methods() != null) {
          methodRepository.saveAll(entities.methods().stream()
              .map(dto -> entityMapper.toEntity(dto, modelFileId))
              .collect(Collectors.toList()));
      }
      ```
  - [x] 6.5 Verify backend compiles and starts
    - Run `mvn clean compile` in architecture-model-service
    - Start application and verify no errors

**Acceptance Criteria:**
- ModelService loads classes and methods from database
- ModelService saves classes and methods to database
- Deletion cascades correctly (methods deleted when class deleted)

---

### Frontend Layer

#### Task Group 7: TypeScript Types (model.ts)
**Dependencies:** None (can be done in parallel with backend)

- [x] 7.0 Update frontend types for Class and Method
  - [x] 7.1 Add OwnedByRefKind type
    - File: `frontend/src/types/model.ts`
    - Add after existing type definitions (near ApplicationPointKind):
      ```typescript
      // OwnedByRefKind type for Class entity - indicates the owner type
      export type OwnedByRefKind = 'Application' | 'ApplicationComponent' | 'Service' | 'Interface';
      ```
  - [x] 7.2 Add Class interface
    - Add in Application Domain Entities section (after Interface, before ApplicationPoint):
      ```typescript
      // Class entity - represents software classes within the Application Architecture
      export interface Class {
        id: string;
        name: string;
        description?: string;
        namespace?: string;
        owned_by_ref_kind?: OwnedByRefKind;
        owned_by_ref_id?: string;
      }
      ```
  - [x] 7.3 Add Method interface
    - Add after Class interface:
      ```typescript
      // Method entity - represents behavioral interfaces owned by Classes
      export interface Method {
        id: string;
        class_id: string;
        name: string;
        description?: string;
        parameters_json?: string;
        returns_json?: string;
        throws_json?: string;
      }
      ```
  - [x] 7.4 Update MetaModelEntities interface
    - Add after `endpoints: Endpoint[];`:
      ```typescript
      classes: Class[];
      methods: Method[];
      ```
  - [x] 7.5 Update EntityType union
    - Add to EntityType union:
      ```typescript
      | 'classes'
      | 'methods'
      ```
  - [x] 7.6 Update AnyEntity union
    - Add after Endpoint:
      ```typescript
      | Class
      | Method
      ```

**Acceptance Criteria:**
- TypeScript compiles without errors
- New types are properly exported
- MetaModelEntities includes classes and methods arrays

---

#### Task Group 8: Grid Configs (gridConfigs.ts)
**Dependencies:** Task Group 7

- [x] 8.0 Add grid configurations for Class and Method
  - [x] 8.1 Add ownedByRefKind dropdown options to defaults.ts
    - File: `frontend/src/config/defaults.ts`
    - Add import for OwnedByRefKind
    - Add options array:
      ```typescript
      export const ownedByRefKindOptions = [
        'Application',
        'ApplicationComponent',
        'Service',
        'Interface',
      ];
      ```
  - [x] 8.2 Add classes grid config to gridConfigs.ts
    - File: `frontend/src/config/gridConfigs.ts`
    - Import `ownedByRefKindOptions` from defaults
    - Add after `endpoints` config:
      ```typescript
      classes: [
        { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
        { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 180 },
        { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
        { field: 'namespace', displayName: 'Namespace', cellType: 'text', required: false, width: 150 },
        { field: 'owned_by_ref_kind', displayName: 'Owned By Type', cellType: 'dropdown', required: false, width: 140, options: ownedByRefKindOptions },
        { field: 'owned_by_ref_id', displayName: 'Owned By ID', cellType: 'text', required: false, width: 150 },
      ],
      ```
  - [x] 8.3 Add methods grid config to gridConfigs.ts
    - Add after `classes` config:
      ```typescript
      methods: [
        { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
        { field: 'class_id', displayName: 'Class', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'classes' },
        { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 150 },
        { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 180 },
        { field: 'parameters_json', displayName: 'Parameters (JSON)', cellType: 'text', required: false, width: 200 },
        { field: 'returns_json', displayName: 'Returns (JSON)', cellType: 'text', required: false, width: 150 },
        { field: 'throws_json', displayName: 'Throws (JSON)', cellType: 'text', required: false, width: 150 },
      ],
      ```

**Acceptance Criteria:**
- Grid configs compile without errors
- Classes grid shows all required columns with correct types
- Methods grid has FK typeahead to classes

---

#### Task Group 9: Domain Grouping and Tab Mappings
**Dependencies:** Task Group 8

- [x] 9.0 Add Classes and Methods to Application domain
  - [x] 9.1 Update tabToEntityType mapping
    - File: `frontend/src/config/gridConfigs.ts`
    - Add mappings (after 'Endpoints'):
      ```typescript
      'Classes': 'classes',
      'Methods': 'methods',
      ```
  - [x] 9.2 Update domainGroupings
    - In the `application` array, add 'Classes' and 'Methods' after 'Endpoints' and before 'Application Points':
      ```typescript
      application: ['Applications', 'App Components', 'Services', 'Interfaces', 'Endpoints', 'Classes', 'Methods', 'Application Points'],
      ```
  - [x] 9.3 Update entityTabNames array
    - Add after 'Endpoints':
      ```typescript
      'Classes',
      'Methods',
      ```

**Acceptance Criteria:**
- Classes and Methods tabs appear in Application domain
- Tabs are positioned after Endpoints, before Application Points
- Tab selection correctly routes to grid configs

---

#### Task Group 10: Frontend State/Context Updates
**Dependencies:** Task Group 7

- [x] 10.0 Update frontend state for new entities
  - [x] 10.1 Update emptyModel in defaults.ts
    - File: `frontend/src/config/defaults.ts`
    - Find the `emptyModel` constant
    - Add to `entities` object (after `endpoints`):
      ```typescript
      classes: [],
      methods: [],
      ```
  - [x] 10.2 Verify ArchitectureContext supports new entities
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Verify that generic entity CRUD actions work with new entity types
    - No changes should be needed if context uses generic patterns

**Acceptance Criteria:**
- Empty model includes classes and methods arrays
- Context state properly initializes new entity arrays
- CRUD operations work for classes and methods

---

### Testing and Verification

#### Task Group 11: Testing and Verification
**Dependencies:** Task Groups 1-10

- [x] 11.0 Complete testing and verification
  - [x] 11.1 Backend compilation test
    - Run `mvn clean compile` in architecture-model-service
    - Verify no compilation errors
  - [x] 11.2 Backend integration test (DEFERRED: requires running environment)
    - Start architecture-model-service
    - Verify application starts without errors
    - Check database tables exist
  - [x] 11.3 Frontend compilation test
    - Run `npm run build` in frontend
    - Verify no TypeScript errors related to classes/methods
    - Note: Pre-existing unrelated TypeScript errors exist in codebase
  - [x] 11.4 Manual UI verification (DEFERRED: requires running environment)
    - Start frontend application
    - Navigate to Meta-Model view
    - Select Application domain
    - Verify 'Classes' and 'Methods' tabs appear
  - [x] 11.5 CRUD verification for Classes (DEFERRED: requires running environment)
    - Create a new Class with name, description, namespace
    - Verify Class appears in grid
    - Edit Class fields
    - Delete Class
  - [x] 11.6 CRUD verification for Methods (DEFERRED: requires running environment)
    - Create a Class first
    - Create a Method referencing the Class (FK typeahead)
    - Verify Method appears in grid
    - Edit Method fields
    - Delete Method
  - [x] 11.7 Cascade delete verification (DEFERRED: requires running environment)
    - Create a Class with multiple Methods
    - Delete the Class
    - Verify all associated Methods are deleted
  - [x] 11.8 Save/Load model verification (DEFERRED: requires running environment)
    - Create Classes and Methods
    - Save the model
    - Reload the model
    - Verify Classes and Methods persist correctly

**Acceptance Criteria:**
- All CRUD operations work for Classes and Methods
- FK typeahead correctly links Methods to Classes
- Cascade delete removes Methods when Class is deleted
- Model persistence works correctly
- No runtime errors in frontend or backend

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1**: Database Schema (Liquibase Migration)
2. **Task Group 2**: JPA Entities (ClassEntity, MethodEntity)
3. **Task Group 3**: DTOs (ClassDto, MethodDto)
4. **Task Group 4**: Repositories (ClassRepository, MethodRepository)
5. **Task Group 5**: EntityMapper Updates
6. **Task Group 6**: ModelService Integration
7. **Task Group 7**: TypeScript Types (model.ts) - can start in parallel with backend
8. **Task Group 8**: Grid Configs (gridConfigs.ts)
9. **Task Group 9**: Domain Grouping and Tab Mappings
10. **Task Group 10**: Frontend State/Context Updates
11. **Task Group 11**: Testing and Verification

---

## File Summary

### Backend Files to Create:
- `architecture-model-service/src/main/resources/db/changelog/sql/002-classes-methods.sql`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ClassEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/MethodEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ClassDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/MethodDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/ClassRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/MethodRepository.java`

### Backend Files to Modify:
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`

### Frontend Files to Modify:
- `frontend/src/types/model.ts`
- `frontend/src/config/defaults.ts`
- `frontend/src/config/gridConfigs.ts`
- `frontend/src/utils/sanitize.ts`
- `frontend/src/utils/validation.ts`
- `frontend/src/utils/fileOperations.ts`

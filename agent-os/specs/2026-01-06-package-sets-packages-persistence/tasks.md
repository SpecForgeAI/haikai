# Task Breakdown: Persist Package Sets and Packages in DB and Round-Trip via /api/model

## Overview
Total Tasks: 8 Task Groups

This feature introduces persistence for Package Sets and Packages to the architecture meta-model. Package Sets represent groups of packages used for service design, and Services can optionally reference a Package Set. All changes must round-trip through the `/api/model` endpoint.

## Task List

### Backend Database Layer

#### Task Group 1: Liquibase Migration
**Dependencies:** None

- [x] 1.0 Complete database migration for package_sets and packages tables
  - [x] 1.1 Create migration file `017-package-sets.sql`
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/resources/db/changelog/sql/017-package-sets.sql`
    - Create `package_sets` table:
      - `id` TEXT PRIMARY KEY
      - `model_file_id` TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE
      - `name` TEXT NOT NULL
      - `created_at` TIMESTAMP
      - `updated_at` TIMESTAMP
    - Create `packages` table:
      - `id` TEXT PRIMARY KEY
      - `model_file_id` TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE
      - `package_set_id` TEXT NOT NULL REFERENCES package_sets(id) ON DELETE CASCADE
      - `name` TEXT NOT NULL
      - `purpose` TEXT (nullable)
      - `sort_order` INTEGER (nullable)
    - Add UNIQUE constraint: `packages(package_set_id, name)`
    - Add `package_set_id` column to `services` table:
      - `package_set_id` TEXT REFERENCES package_sets(id) ON DELETE SET NULL
    - Create indexes:
      - `idx_package_sets_model_file` ON package_sets(model_file_id)
      - `idx_packages_model_file` ON packages(model_file_id)
      - `idx_packages_package_set` ON packages(package_set_id)
    - Follow pattern from: `015-business-logic.sql` (lines 1-46)
  - [x] 1.2 Update db.changelog-master.yaml
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Add changeSet id: `017-package-sets` after existing changeSet `016-application-point-targeting` (line 260)
    - Use `tableExists: package_sets` precondition
    - Follow pattern from existing changeSets (lines 228-243)
  - [x] 1.3 Verify migration runs successfully
    - Start application and confirm Liquibase applies migration
    - Verify tables created with correct schema

**Acceptance Criteria:**
- `package_sets` table exists with correct columns and constraints
- `packages` table exists with correct columns and UNIQUE constraint
- `services.package_set_id` column added with FK and ON DELETE SET NULL
- All indexes created for query performance
- Migration recorded in `db.changelog-master.yaml`

---

### Backend Entity/Repository Layer

#### Task Group 2: JPA Entities and Repositories
**Dependencies:** Task Group 1

- [x] 2.0 Complete JPA entities and repositories for PackageSet and Package
  - [x] 2.1 Write 4 focused tests for repository functionality
    - Test PackageSetRepository.findByModelFileId returns empty list for new model
    - Test PackageSetRepository.findByModelFileId returns saved entities
    - Test PackageRepository.findByPackageSetId returns packages for a set
    - Test PackageRepository.deleteByModelFileId cascades correctly
  - [x] 2.2 Create PackageSetEntity JPA entity
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/PackageSetEntity.java`
    - Annotations: @Entity, @Table(name = "package_sets"), @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder
    - Fields:
      - `id` (String, @Id, @Column(name = "id", nullable = false))
      - `modelFileId` (String, @Column(name = "model_file_id", nullable = false))
      - `name` (String, @Column(name = "name", nullable = false))
      - `createdAt` (OffsetDateTime, @Column(name = "created_at"))
      - `updatedAt` (OffsetDateTime, @Column(name = "updated_at"))
    - Follow pattern from: `BusinessLogicEntity.java` (lines 1-39)
  - [x] 2.3 Create PackageEntity JPA entity
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/PackageEntity.java`
    - Annotations: @Entity, @Table(name = "packages"), @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder
    - Fields:
      - `id` (String, @Id, @Column(name = "id", nullable = false))
      - `modelFileId` (String, @Column(name = "model_file_id", nullable = false))
      - `packageSetId` (String, @Column(name = "package_set_id", nullable = false))
      - `name` (String, @Column(name = "name", nullable = false))
      - `purpose` (String, @Column(name = "purpose"))
      - `sortOrder` (Integer, @Column(name = "sort_order"))
    - Follow pattern from: `BusinessLogicEntity.java`
  - [x] 2.4 Update ServiceEntity with packageSetId field
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ServiceEntity.java`
    - Add field after line 47:
      - `packageSetId` (String, @Column(name = "package_set_id"), nullable)
  - [x] 2.5 Create PackageSetRepository interface
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/PackageSetRepository.java`
    - Extend JpaRepository<PackageSetEntity, String>
    - Methods:
      - `List<PackageSetEntity> findByModelFileId(String modelFileId)`
      - `void deleteByModelFileId(String modelFileId)`
    - Follow pattern from: `BusinessLogicRepository.java` (lines 1-16)
  - [x] 2.6 Create PackageRepository interface
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/PackageRepository.java`
    - Extend JpaRepository<PackageEntity, String>
    - Methods:
      - `List<PackageEntity> findByModelFileId(String modelFileId)`
      - `List<PackageEntity> findByPackageSetId(String packageSetId)`
      - `void deleteByModelFileId(String modelFileId)`
  - [x] 2.7 Ensure repository tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify entities persist correctly
    - Verify cascade deletes work

**Acceptance Criteria:**
- PackageSetEntity and PackageEntity classes created with correct JPA annotations
- ServiceEntity updated with packageSetId field
- PackageSetRepository and PackageRepository interfaces created
- All 4 repository tests pass
- Entities follow existing codebase patterns

---

### Backend DTO/Mapper Layer

#### Task Group 3: DTOs and EntityMapper Updates
**Dependencies:** Task Group 2

- [x] 3.0 Complete DTOs and mapper methods for PackageSet and Package
  - [x] 3.1 Write 4 focused tests for mapper functionality
    - Test PackageSetEntity to PackageSetDto mapping
    - Test PackageSetDto to PackageSetEntity mapping
    - Test PackageEntity to PackageDto mapping
    - Test ServiceEntity with packageSetId maps correctly
  - [x] 3.2 Create PackageSetDto record
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/PackageSetDto.java`
    - Fields with @JsonProperty annotations:
      - `id` (@JsonProperty("id"))
      - `name` (@JsonProperty("name"))
    - Follow pattern from: `BusinessLogicDto.java` (lines 1-27)
  - [x] 3.3 Create PackageDto record
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/PackageDto.java`
    - Fields with @JsonProperty annotations:
      - `id` (@JsonProperty("id"))
      - `packageSetId` (@JsonProperty("package_set_id"))
      - `name` (@JsonProperty("name"))
      - `purpose` (@JsonProperty("purpose"))
      - `sortOrder` (@JsonProperty("sort_order"))
  - [x] 3.4 Update ServiceDto record with package_set_id field
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ServiceDto.java`
    - Add field after `validTo` (line 34):
      - `packageSetId` (@JsonProperty("package_set_id"), String, nullable)
  - [x] 3.5 Add EntityMapper methods for PackageSet
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
    - Add after BusinessLogic mappings (around line 740):
    - `public PackageSetDto toDto(PackageSetEntity entity)` - maps entity fields to DTO
    - `public PackageSetEntity toEntity(PackageSetDto dto, String modelFileId)` - maps DTO to entity with modelFileId, createdAt, updatedAt
  - [x] 3.6 Add EntityMapper methods for Package
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
    - Add after PackageSet mappings:
    - `public PackageDto toDto(PackageEntity entity)` - maps entity fields to DTO
    - `public PackageEntity toEntity(PackageDto dto, String modelFileId)` - maps DTO to entity with modelFileId
  - [x] 3.7 Update Service mapping to include packageSetId
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
    - Update `toDto(ServiceEntity entity)` (line 177) to include packageSetId
    - Update `toEntity(ServiceDto dto, String modelFileId)` (line 192) to include packageSetId
  - [x] 3.8 Ensure mapper tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify bidirectional mapping works correctly

**Acceptance Criteria:**
- PackageSetDto and PackageDto records created with correct @JsonProperty annotations
- ServiceDto updated with package_set_id field
- EntityMapper has toDto/toEntity methods for PackageSet and Package
- Service mapping includes packageSetId field
- All 4 mapper tests pass

---

### Backend MetaModelEntitiesDto Update

#### Task Group 4: MetaModelEntitiesDto Integration
**Dependencies:** Task Group 3

- [x] 4.0 Update MetaModelEntitiesDto to include packageSets and packages
  - [x] 4.1 Add packageSets and packages fields to MetaModelEntitiesDto
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
    - Add after `businessLogics` field (line 93-94):
      - `@JsonProperty("package_sets") List<PackageSetDto> packageSets`
      - `@JsonProperty("packages") List<PackageDto> packages`
    - Add import statements for PackageSetDto and PackageDto

**Acceptance Criteria:**
- MetaModelEntitiesDto has packageSets and packages fields
- JSON serialization uses snake_case: `package_sets`, `packages`
- Fields positioned after businessLogics in the record

---

### Backend ModelService Integration

#### Task Group 5: ModelService Load/Save Integration
**Dependencies:** Task Group 4

- [x] 5.0 Complete ModelService integration for package_sets and packages
  - [x] 5.1 Write 4 focused tests for load/save round-trip
    - Test saveEntities persists package_sets
    - Test saveEntities persists packages with FK to package_sets
    - Test loadEntities returns package_sets and packages
    - Test Service with package_set_id round-trips correctly
  - [x] 5.2 Add repository field injections to ModelService
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Add after businessLogicRepository (line 72):
      - `private final PackageSetRepository packageSetRepository;`
      - `private final PackageRepository packageRepository;`
  - [x] 5.3 Update loadEntities to include packageSets and packages
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Update MetaModelEntitiesDto constructor call in loadEntities method (lines 422-484)
    - Add after businessLogics:
      ```java
      packageSetRepository.findByModelFileId(modelFileId).stream()
          .map(entityMapper::toDto).collect(Collectors.toList()),
      packageRepository.findByModelFileId(modelFileId).stream()
          .map(entityMapper::toDto).collect(Collectors.toList())
      ```
  - [x] 5.4 Update saveEntities to save package_sets before packages before services
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Add after businessLogics save block (around line 766):
    - Save package_sets first (they have FK to model_files)
    - Then save packages (they have FK to package_sets)
    - Services already saved - they now have FK to package_sets
    - Pattern:
      ```java
      // Package Sets must be saved before Packages (FK dependency)
      if (entities.packageSets() != null) {
          packageSetRepository.saveAll(entities.packageSets().stream()
              .map(dto -> entityMapper.toEntity(dto, modelFileId))
              .collect(Collectors.toList()));
      }

      if (entities.packages() != null) {
          packageRepository.saveAll(entities.packages().stream()
              .map(dto -> entityMapper.toEntity(dto, modelFileId))
              .collect(Collectors.toList()));
      }
      ```
  - [x] 5.5 Update deleteAllDataForModelFile to delete packages before package_sets
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Add before serviceRepository.deleteByModelFileId (around line 592):
      ```java
      // Delete packages before package_sets (FK dependency order)
      packageRepository.deleteByModelFileId(modelFileId);
      packageSetRepository.deleteByModelFileId(modelFileId);
      ```
  - [x] 5.6 Ensure ModelService tests pass
    - Run ONLY the 4 tests written in 5.1
    - Verify round-trip works correctly

**Acceptance Criteria:**
- PackageSetRepository and PackageRepository injected into ModelService
- loadEntities returns packageSets and packages in MetaModelEntitiesDto
- saveEntities saves in FK dependency order: package_sets -> packages
- deleteAllDataForModelFile deletes in reverse FK order: packages -> package_sets
- All 4 ModelService tests pass

---

### Backend Validation

#### Task Group 6: Backend Validation Rules
**Dependencies:** Task Group 5

- [x] 6.0 Add validation rules for PackageSet and Package
  - [x] 6.1 Write 4 focused tests for validation
    - Test PackageSet.name blank throws IllegalArgumentException
    - Test Package.name blank throws IllegalArgumentException
    - Test Package with invalid package_set_id fails at DB level
    - Test Service with invalid package_set_id fails at DB level
  - [x] 6.2 Add validation in saveEntities for PackageSet.name
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Before saving package_sets, validate:
      ```java
      for (PackageSetDto dto : entities.packageSets()) {
          if (dto.name() == null || dto.name().isBlank()) {
              throw new IllegalArgumentException(
                  "PackageSet validation failed for id '" + dto.id() + "': name must not be blank"
              );
          }
      }
      ```
  - [x] 6.3 Add validation in saveEntities for Package.name
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Before saving packages, validate:
      ```java
      for (PackageDto dto : entities.packages()) {
          if (dto.name() == null || dto.name().isBlank()) {
              throw new IllegalArgumentException(
                  "Package validation failed for id '" + dto.id() + "': name must not be blank"
              );
          }
      }
      ```
  - [x] 6.4 Ensure validation tests pass
    - Run ONLY the 4 tests written in 6.1
    - Verify proper error messages returned

**Acceptance Criteria:**
- PackageSet.name blank throws IllegalArgumentException with descriptive message
- Package.name blank throws IllegalArgumentException with descriptive message
- Package.package_set_id FK constraint enforced at DB level
- Service.package_set_id FK constraint enforced at DB level
- All 4 validation tests pass

---

### Frontend Types

#### Task Group 7: Frontend TypeScript Types
**Dependencies:** Task Group 5 (backend must be complete for type alignment)

- [x] 7.0 Update frontend model.ts with PackageSet and Package types
  - [x] 7.1 Add PackageSet interface to model.ts
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/types/model.ts`
    - Add after BusinessLogic interface (around line 692):
      ```typescript
      /**
       * PackageSet entity - represents a group of packages for service design.
       * Package Sets organize packages that can be referenced by Services.
       */
      export interface PackageSet {
        id: string;
        name: string;
      }
      ```
  - [x] 7.2 Add Package interface to model.ts
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/types/model.ts`
    - Add after PackageSet interface:
      ```typescript
      /**
       * Package entity - represents a package within a Package Set.
       * Packages belong to a Package Set and have a name, optional purpose, and sort order.
       */
      export interface Package {
        id: string;
        package_set_id: string;
        name: string;
        purpose?: string;
        sort_order?: number;
      }
      ```
  - [x] 7.3 Update Service interface with package_set_id
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/types/model.ts`
    - Add to Service interface (around line 267):
      ```typescript
      // Optional reference to a Package Set for service-to-package mapping
      package_set_id?: string;
      ```
  - [x] 7.4 Update MetaModelEntities interface
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/types/model.ts`
    - Add to MetaModelEntities interface after business_logics (around line 1883):
      ```typescript
      package_sets: PackageSet[];  // Package Sets for service design
      packages: Package[];  // Packages within Package Sets
      ```
  - [x] 7.5 Update EntityType union type
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/types/model.ts`
    - Add to EntityType union (around line 1945):
      ```typescript
      | 'package_sets'  // Package Sets EntityType
      | 'packages';  // Packages EntityType
      ```
  - [x] 7.6 Update ENTITY_TYPES constant
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/types/model.ts`
    - Add to ENTITY_TYPES constant (around line 1140):
      ```typescript
      PACKAGE_SET: 'PACKAGE_SET',
      PACKAGE: 'PACKAGE',
      ```
  - [x] 7.7 Update AnyEntity type
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/types/model.ts`
    - Add to AnyEntity union (around line 1988):
      ```typescript
      | PackageSet  // Package Set in AnyEntity union
      | Package;  // Package in AnyEntity union
      ```

**Acceptance Criteria:**
- PackageSet and Package interfaces defined with correct field types
- Service interface has optional package_set_id field
- MetaModelEntities includes package_sets and packages arrays
- EntityType union includes 'package_sets' and 'packages'
- ENTITY_TYPES constant includes PACKAGE_SET and PACKAGE
- AnyEntity union includes PackageSet and Package

---

### Frontend Defaults

#### Task Group 8: Frontend Defaults Configuration
**Dependencies:** Task Group 7

- [x] 8.0 Update frontend defaults.ts with empty arrays for package_sets and packages
  - [x] 8.1 Update emptyModel in defaults.ts
    - File: `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/config/defaults.ts`
    - Add to emptyModel.metaModel.entities after business_logics (around line 1180):
      ```typescript
      package_sets: [],  // Package Sets for service design
      packages: [],  // Packages within Package Sets
      ```

**Acceptance Criteria:**
- emptyModel includes package_sets: [] and packages: []
- Fields positioned after business_logics in entities object
- New models created via frontend include empty package_sets and packages arrays

---

### Integration Testing

#### Task Group 9: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-8

- [x] 9.0 Review existing tests and fill critical gaps
  - [x] 9.1 Review tests from Task Groups 2, 3, 5, 6
    - Review the 4 repository tests from Task 2.1
    - Review the 4 mapper tests from Task 3.1
    - Review the 4 ModelService tests from Task 5.1
    - Review the 4 validation tests from Task 6.1
    - Total existing tests: approximately 16 tests
  - [x] 9.2 Analyze test coverage gaps for package_sets and packages feature
    - Identify critical end-to-end workflows lacking coverage
    - Focus on /api/model round-trip scenarios
    - Check Service.package_set_id FK scenarios
  - [x] 9.3 Write up to 6 additional integration tests
    - Test full save/load round-trip via /api/model endpoint
    - Test Service with package_set_id persists and loads correctly
    - Test Package UNIQUE constraint (package_set_id, name) enforced
    - Test cascading delete: delete model_file cascades to package_sets and packages
    - Test ON DELETE SET NULL: delete package_set sets services.package_set_id to null
    - Test frontend emptyModel includes package_sets and packages arrays
  - [x] 9.4 Run all feature-specific tests
    - Run all tests from Task Groups 2, 3, 5, 6, and 9.3
    - Expected total: approximately 22 tests
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 22 tests total)
- Full /api/model round-trip verified
- FK constraints and cascades work correctly
- No more than 6 additional tests added

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Liquibase Migration** - Create database schema first
2. **Task Group 2: JPA Entities and Repositories** - Create entities and data access layer
3. **Task Group 3: DTOs and EntityMapper** - Create transfer objects and mappers
4. **Task Group 4: MetaModelEntitiesDto** - Update DTO to include new fields
5. **Task Group 5: ModelService Integration** - Wire up load/save functionality
6. **Task Group 6: Backend Validation** - Add business rule validation
7. **Task Group 7: Frontend Types** - Update TypeScript type definitions
8. **Task Group 8: Frontend Defaults** - Update empty model defaults
9. **Task Group 9: Integration Testing** - Verify end-to-end functionality

---

## Key File Paths Summary

### Files to Create (Backend)
- `architecture-model-service/src/main/resources/db/changelog/sql/017-package-sets.sql`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/PackageSetEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/PackageEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/PackageSetRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/PackageRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/PackageSetDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/PackageDto.java`

### Files to Modify (Backend)
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ServiceEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ServiceDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`

### Files to Modify (Frontend)
- `frontend/src/types/model.ts`
- `frontend/src/config/defaults.ts`

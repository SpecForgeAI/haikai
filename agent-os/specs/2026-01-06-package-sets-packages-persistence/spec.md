# Specification: Persist Package Sets and Packages (Iteration 1)

## Goal
Introduce persistence for Service package design by adding Package Sets and Packages to the architecture meta-model. This iteration delivers DB schema, backend model load/save, and frontend model types/defaults so Package Sets and Packages round-trip through /api/model (File -> Save/Open).

## User Stories
- As an architect, I want Package Sets and Packages to persist when I save the model so that package configuration is preserved across sessions
- As a developer, I want Services to optionally reference a Package Set so that service-to-package mapping can be persisted for future matching rules

## Specific Requirements

**Liquibase Migration: sql/017-package-sets.sql**
- Create `package_sets` table with columns: id (TEXT PRIMARY KEY), model_file_id (FK to model_files with ON DELETE CASCADE), name (TEXT NOT NULL), created_at (TIMESTAMP), updated_at (TIMESTAMP)
- Create `packages` table with columns: id (TEXT PRIMARY KEY), model_file_id (FK to model_files with ON DELETE CASCADE), package_set_id (FK to package_sets with ON DELETE CASCADE), name (TEXT NOT NULL), purpose (TEXT), sort_order (INTEGER)
- Add UNIQUE constraint on packages(package_set_id, name) to prevent duplicate package names within a set
- Add nullable `package_set_id` column to services table referencing package_sets(id) with ON DELETE SET NULL
- Create indexes on model_file_id and package_set_id columns for query performance
- Update db.changelog-master.yaml to include new migration file

**PackageSetEntity JPA Entity**
- Create PackageSetEntity class in model/entity package following BusinessLogicEntity pattern
- Use Lombok @Entity, @Table(name = "package_sets"), @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder
- Fields: id (String, @Id), modelFileId (String, NOT NULL), name (String, NOT NULL), createdAt (OffsetDateTime), updatedAt (OffsetDateTime)
- Column mappings use snake_case: model_file_id, created_at, updated_at

**PackageEntity JPA Entity**
- Create PackageEntity class in model/entity package following BusinessLogicEntity pattern
- Fields: id (String, @Id), modelFileId (String, NOT NULL), packageSetId (String, NOT NULL), name (String, NOT NULL), purpose (String, nullable), sortOrder (Integer, nullable)
- Column mappings use snake_case: model_file_id, package_set_id, sort_order

**ServiceEntity Update**
- Add packageSetId field (String, nullable) to existing ServiceEntity
- Column mapping: package_set_id

**PackageSetRepository and PackageRepository**
- Create PackageSetRepository interface in repository/entity package following BusinessLogicRepository pattern
- Methods: findByModelFileId(String modelFileId), deleteByModelFileId(String modelFileId)
- Create PackageRepository interface with same methods plus findByPackageSetId(String packageSetId)

**PackageSetDto and PackageDto Records**
- Create PackageSetDto record in model/dto/entity package following BusinessLogicDto pattern
- Fields: id, name with @JsonProperty annotations for snake_case serialization
- Create PackageDto record with fields: id, package_set_id, name, purpose, sort_order

**ServiceDto Update**
- Add package_set_id field (String, nullable) to existing ServiceDto record
- Add @JsonProperty("package_set_id") annotation

**EntityMapper Updates**
- Add toDto(PackageSetEntity) and toEntity(PackageSetDto, modelFileId) methods
- Add toDto(PackageEntity) and toEntity(PackageDto, modelFileId) methods
- Update ServiceEntity/ServiceDto mapping to include packageSetId field

**MetaModelEntitiesDto Update**
- Add packageSets (List<PackageSetDto>) with @JsonProperty("package_sets")
- Add packages (List<PackageDto>) with @JsonProperty("packages")
- Position these after businessLogics in the record parameter list

**ModelService Load/Save Integration**
- Add PackageSetRepository and PackageRepository field injections
- In saveEntities: save package_sets before packages before services (FK dependency order)
- In loadEntities: load packageSets and packages from repositories and include in MetaModelEntitiesDto constructor
- In deleteAllDataForModelFile: delete packages before package_sets (reverse FK order), positioned before services deletion

**Backend Validation**
- PackageSet.name must be non-blank (throw IllegalArgumentException)
- Package.name must be non-blank (throw IllegalArgumentException)
- Package.package_set_id must reference valid package_set (DB constraint handles this)
- Service.package_set_id if provided must reference valid package_set (DB constraint handles this)

**Frontend model.ts Types**
- Add PackageSet interface: id (string), name (string)
- Add Package interface: id (string), package_set_id (string), name (string), purpose (string optional), sort_order (number optional)
- Extend Service interface with optional package_set_id (string optional)
- Extend MetaModelEntities interface with package_sets (PackageSet[]) and packages (Package[])
- Add 'package_sets' and 'packages' to EntityType union type

**Frontend defaults.ts Updates**
- Add package_sets: [] to emptyModel.metaModel.entities
- Add packages: [] to emptyModel.metaModel.entities
- Position after business_logics in the entities object

## Existing Code to Leverage

**BusinessLogicEntity/Dto/Repository Pattern**
- Located at architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/BusinessLogicEntity.java
- Follows Lombok @Entity/@Builder pattern with String id and modelFileId
- Repository has findByModelFileId and deleteByModelFileId standard methods
- Use as template for PackageSetEntity and PackageEntity

**EntityMapper Structure**
- Located at architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java
- Standard toDto(Entity) and toEntity(Dto, modelFileId) method pattern
- Use BusinessLogic mapping methods as template for new mappers

**ModelService Load/Save Pattern**
- Located at architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java
- saveEntities method saves entities in FK dependency order
- deleteAllDataForModelFile deletes in reverse FK order
- loadEntities constructs MetaModelEntitiesDto with all entity lists

**SQL Migration Pattern (015-business-logic.sql)**
- Located at architecture-model-service/src/main/resources/db/changelog/sql/015-business-logic.sql
- Shows TABLE creation with model_file_id FK, indexes, and constraints
- Use as template for 017-package-sets.sql

**Frontend emptyModel Pattern**
- Located at frontend/src/config/defaults.ts line 1153
- Shows entity array initialization pattern with empty arrays
- Add package_sets and packages following existing entity order

## Out of Scope
- Company-level package-sets.json import functionality
- Package Sets UI (navigation, grids, editors)
- Create/Clone modals for Package Sets or Packages
- Service default matching rules based on package set
- Package Set assignment UI on Service entity
- Automatic Package Set creation or population
- Package sorting or reordering UI
- Package Set validation beyond name non-blank
- Package purpose dropdown options or suggestions
- API endpoints specific to Package Sets (beyond /api/model round-trip)

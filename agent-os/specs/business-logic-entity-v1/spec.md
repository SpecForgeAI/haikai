# Specification: Business Logic Entity + ApplicationPoint Join Table (v1)

## Goal
Introduce a new behavioural architecture concept "Business Logic" that can be stored in the meta-model and persisted in the database, along with a many-to-many join table linking Business Logic to Application Points, enabling core persistence and basic CRUD via the existing whole-model load/save mechanism.

## User Stories
- As an architect, I want to define Business Logic entities in the meta-model so that I can document reusable business rules and logic separately from their application points
- As a user, I want to create/edit/delete Business Logic rows in the MetaModel UI grid and persist them via File -> Save so that my business logic documentation is stored in the database

## Specific Requirements

**Liquibase Migration (015-business-logic.sql)**
- Create `business_logics` table with columns: id (PK), model_file_id (FK), name (NOT NULL), type_text, description_md (TEXT), tags, valid_from, valid_to
- Create `application_point_business_logics` join table with columns: id (PK), model_file_id (FK), application_point_id (FK), business_logic_id (FK), description, tags, valid_from, valid_to
- Add ON DELETE CASCADE for all foreign keys referencing model_files, application_points, and business_logics
- Add indexes on model_file_id, application_point_id, and business_logic_id columns
- Add unique composite constraint on (application_point_id, business_logic_id) to prevent duplicate links
- Register changeset in db.changelog-master.yaml with precondition checking `business_logics` table does not exist

**BusinessLogicEntity JPA Entity**
- Map to `business_logics` table following existing ApplicationPointEntity pattern
- Use String id fields with @Column annotations for snake_case column names
- Include Lombok @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder annotations
- Fields: id, modelFileId, name, typeText, descriptionMd, tags, validFrom, validTo

**ApplicationPointBusinessLogicEntity JPA Entity**
- Map to `application_point_business_logics` table following ApplicationPointBusinessPointEntity pattern
- Include model_file_id for consistency with existing relationship entities
- Fields: id, modelFileId, applicationPointId, businessLogicId, description, tags, validFrom, validTo

**Repository Interfaces**
- Create BusinessLogicRepository extending JpaRepository with findByModelFileId and deleteByModelFileId methods
- Create ApplicationPointBusinessLogicRepository extending JpaRepository with findByModelFileId and deleteByModelFileId methods
- Place in appropriate repository packages following existing entity/relationship separation

**DTOs with JsonProperty Annotations**
- Create BusinessLogicDto as Java record with @JsonProperty for snake_case serialization (type_text, description_md, valid_from, valid_to)
- Create ApplicationPointBusinessLogicDto as Java record with @JsonProperty for snake_case serialization
- Place in model.dto.entity and model.dto.relationship packages respectively

**MetaModel DTO Updates**
- Add `businessLogics` field (List of BusinessLogicDto) to MetaModelEntitiesDto with @JsonProperty("business_logics")
- Add `applicationPointBusinessLogics` field (List of ApplicationPointBusinessLogicDto) to MetaModelRelationshipsDto with @JsonProperty("application_point_business_logics")

**EntityMapper Updates**
- Add toDto(BusinessLogicEntity) and toEntity(BusinessLogicDto, String modelFileId) methods following existing patterns
- Add toDto(ApplicationPointBusinessLogicEntity) and toEntity(ApplicationPointBusinessLogicDto, String modelFileId) methods
- Place in Behavioural Domain section with appropriate comment header

**ModelService Load/Save Integration**
- Inject BusinessLogicRepository and ApplicationPointBusinessLogicRepository via constructor
- Add businessLogics loading in loadEntities() method after activityPartitions
- Add applicationPointBusinessLogics loading in loadRelationships() method after uiWorkflowTransitions
- Add businessLogics saving in saveEntities() method in Behavioural domain section
- Add applicationPointBusinessLogics saving in saveRelationships() method
- Add repository delete calls in deleteAllDataForModelFile() with correct dependency ordering (delete join table before business_logics)

**Frontend TypeScript Interfaces (model.ts)**
- Add BusinessLogic interface with fields: id, name, type_text (optional), description_md (optional), tags (optional), valid_from (optional), valid_to (optional)
- Add ApplicationPointBusinessLogic interface with fields: id, application_point_id, business_logic_id, description (optional), tags (optional), valid_from (optional), valid_to (optional)
- Add business_logics to MetaModelEntities interface
- Add application_point_business_logics to MetaModelRelationships interface

**Frontend Defaults (defaults.ts)**
- Add business_logics: [] to emptyModel.metaModel.entities
- Add application_point_business_logics: [] to emptyModel.metaModel.relationships

**Frontend Grid Configuration (gridConfigs.ts)**
- Add business_logics grid config with columns: id (autoGenerate), name (required), type_text, description_md, tags, valid_from, valid_to
- Add tabToEntityType mapping: 'Business Logics' -> 'business_logics'
- Add to entityTabNames array
- Add 'Business Logics' to domainGroupings.behavioural array
- Add 'business_logics' to DOMAIN_ENTITY_TYPES.behavioural array

## Existing Code to Leverage

**ApplicationPointBusinessPointEntity/Dto/Repository Pattern**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationPointBusinessPointEntity.java`
- Use as template for ApplicationPointBusinessLogicEntity structure
- Replicate field naming conventions and Lombok annotations

**EntityMapper Behavioural Domain Section**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` lines 515-689
- Follow existing toDto/toEntity method patterns for Events, States, Activities
- Add new methods in Behavioural Domain section with consistent formatting

**ModelService Load/Save Pattern**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
- Follow repository injection pattern at constructor (lines 39-93)
- Follow entity loading pattern in loadEntities() method (lines 417-477)
- Follow save pattern in saveEntities() and saveRelationships() methods

**Grid Configuration Pattern**
- Located at `frontend/src/config/gridConfigs.ts`
- Use activities/events grid configs as template (lines 265-298)
- Follow domainGroupings.behavioural pattern for tab grouping

**SQL Migration Pattern**
- Located at `architecture-model-service/src/main/resources/db/changelog/sql/010-ui-screens-ui-workflow-transitions.sql`
- Use as template for table creation with FK constraints and indexes

## Out of Scope
- UI to attach/detach Business Logic to Application Points (relationship management UX deferred to Spec 2)
- Expanding Application Point selection to include Class/Method entities (deferred to Spec 2)
- Business Logic type suggestions or templates (deferred to Spec 3/4)
- Business Logic type as enum/dropdown - remains free-text in v1
- Palette panel integration for Business Logic nodes
- Diagram rendering of Business Logic entities
- Validation rules for Business Logic type_text values
- API endpoints beyond the existing /api/model GET/PUT
- Frontend grid for application_point_business_logics relationship (join table not exposed in UI in v1)

# Specification: Add Class and Method Entities to Application Architecture Domain

## Goal
Introduce two new Application Architecture meta-model entities (Class and Method) with full CRUD support in both the backend (architecture-model-service) and frontend (Meta-Model UI grids), following existing patterns for entity ownership via FK fields.

## User Stories
- As an architect, I want to define Classes within my Application Architecture so that I can document the software structure at a code-level abstraction.
- As an architect, I want to define Methods owned by Classes so that I can capture the behavioral interface of each class including parameters, returns, and exceptions.

## Specific Requirements

**Backend: Database Schema (Liquibase)**
- Create `classes` table with columns: id (TEXT PK), model_file_id (TEXT FK to model_files ON DELETE CASCADE), name (TEXT NOT NULL), description (TEXT), namespace (TEXT), owned_by_ref_kind (TEXT), owned_by_ref_id (TEXT)
- Create `methods` table with columns: id (TEXT PK), model_file_id (TEXT FK), class_id (TEXT FK to classes ON DELETE CASCADE), name (TEXT NOT NULL), description (TEXT), parameters_json (JSONB), returns_json (JSONB), throws_json (JSONB)
- Add indexes on `classes(model_file_id)` and `methods(model_file_id, class_id)`
- Add changeset to db.changelog-master.yaml referencing new SQL migration file

**Backend: JPA Entities**
- Create `ClassEntity.java` following pattern from ServiceEntity.java with fields: id, modelFileId, name, description, namespace, ownedByRefKind, ownedByRefId
- Create `MethodEntity.java` following pattern from EndpointEntity.java with fields: id, modelFileId, classId, name, description, parametersJson (String for JSONB), returnsJson (String for JSONB), throwsJson (String for JSONB)
- Use Lombok annotations: @Entity, @Table, @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder
- Store JSONB columns as TEXT/String type and parse JSON in service layer (consistent with existing approach if no Hibernate Types JSONB mapping present)

**Backend: DTOs**
- Create `ClassDto.java` as Java record with @JsonProperty annotations for snake_case API contract: id, name, description, namespace, ownedByRefKind, ownedByRefId
- Create `MethodDto.java` as Java record: id, classId, name, description, parametersJson, returnsJson, throwsJson
- Add both DTOs to `MetaModelEntitiesDto.java` with @JsonProperty("classes") and @JsonProperty("methods")

**Backend: Repositories**
- Create `ClassRepository.java` extending JpaRepository<ClassEntity, String> with methods: findByModelFileId(String), deleteByModelFileId(String)
- Create `MethodRepository.java` extending JpaRepository<MethodEntity, String> with methods: findByModelFileId(String), findByClassId(String), deleteByModelFileId(String), deleteByClassId(String)

**Backend: EntityMapper Updates**
- Add toDto(ClassEntity) and toEntity(ClassDto, modelFileId) methods following existing patterns in EntityMapper.java
- Add toDto(MethodEntity) and toEntity(MethodDto, modelFileId) methods
- Parse/serialize JSON fields as needed for parameters_json, returns_json, throws_json

**Backend: ModelService Integration**
- Inject ClassRepository and MethodRepository into ModelService
- Update loadModel() to fetch and map classes and methods for the model file
- Update saveModel() to delete-and-insert classes and methods (following existing replace-all pattern)
- Ensure method.classId validation: referenced class must exist and belong to same model_file_id

**Frontend: TypeScript Types (model.ts)**
- Add `ClassRow` interface: id, name, description?, namespace?, ownedByRefKind?, ownedByRefId?
- Add `MethodRow` interface: id, class_id, name, description?, parameters_json?, returns_json?, throws_json?
- Add `OwnedByRefKind` type: 'Application' | 'ApplicationComponent' | 'Service' | 'Interface'
- Add 'classes' and 'methods' to EntityType union
- Add ClassRow and MethodRow to AnyEntity union
- Add classes: ClassRow[] and methods: MethodRow[] to MetaModelEntities interface

**Frontend: Grid Configs (gridConfigs.ts)**
- Add 'classes' grid config with columns: id (autoGenerate), name (required), description (optional), namespace (optional), ownedByRefKind (optional dropdown), ownedByRefId (optional text)
- Add 'methods' grid config with columns: id (autoGenerate), class_id (required, fk_typeahead to classes), name (required), description (optional), parameters_json (optional text), returns_json (optional text), throws_json (optional text)
- Add dropdown options for ownedByRefKind in defaults.ts: ['Application', 'ApplicationComponent', 'Service', 'Interface']

**Frontend: Domain Grouping**
- Add 'Classes' and 'Methods' tabs to domainGroupings.application array in gridConfigs.ts (after 'Endpoints', before 'Application Points')
- Add mapping in tabToEntityType: 'Classes' -> 'classes', 'Methods' -> 'methods'

**Frontend: State/Context Updates**
- Update emptyModel in defaults.ts to include classes: [] and methods: [] in entities
- ArchitectureContext will automatically support new entity types via existing generic entity CRUD actions

## Existing Code to Leverage

**ServiceEntity.java / EndpointEntity.java**
- Follow identical JPA annotation patterns: @Entity, @Table, @Column with name mappings
- Use same String-based ID pattern (not UUID) with nullable = false for required fields
- Reference EndpointEntity for parent FK pattern (interfaceId) which mirrors method.classId

**ServiceRepository.java / EndpointRepository.java**
- Extend JpaRepository with same method signatures: findByModelFileId, deleteByModelFileId
- Follow repository/entity package structure

**EntityMapper.java**
- Follow existing toDto/toEntity method patterns exactly
- Use record constructor pattern for DTOs, Builder pattern for entities
- modelFileId is passed as second parameter to toEntity methods

**MetaModelEntitiesDto.java**
- Add new fields following existing pattern with @JsonProperty for snake_case serialization
- Order new fields logically within Application domain section

**gridConfigs.ts**
- Follow exact column config structure with field, displayName, cellType, required, width, and optional fkTarget/options
- Use existing fk_typeahead pattern for Method.class_id referencing 'classes'
- Reference interfaces grid for similar structure (service_id FK typeahead)

## Out of Scope
- Diagram rendering/placement for Class/Method nodes (no DiagramNode support)
- Sequence diagram, state diagram, or activity diagram entities
- Gateway or MCP server changes
- Separate relationship entity/table for Class-Method link (use FK only)
- Complex UI widgets for parameters/returns/throws (JSON text fields are acceptable for v1)
- Cascade delete of Methods when Class is deleted from frontend (backend handles via ON DELETE CASCADE)
- ApplicationPoint or AppBusinessPoint synchronization for Classes/Methods
- Temporal validity fields (valid_from, valid_to) for Classes/Methods in v1
- Any new relationship types referencing Classes or Methods

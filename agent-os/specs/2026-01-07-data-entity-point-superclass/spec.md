# Specification: Data Entity Point Superclass

## Goal
Introduce a new first-class meta-model superclass entity (Data Entity Point) that acts as a polymorphic reference wrapper for Logical Data Entities and Physical Data Entities, enabling future relationship tables to point to either entity type through a single foreign key.

## User Stories
- As a backend developer, I want Data Entity Points automatically created for each Logical and Physical Data Entity so that relationship tables can reference either entity type polymorphically.
- As a system administrator, I want snapshot export/import to include Data Entity Points so that deterministic, repeatable imports produce identical database state without duplicates.

## Specific Requirements

**Database Migration (020-data-entity-points.sql)**
- Create table `data_entity_points` with columns: id (TEXT PK), model_file_id (TEXT NOT NULL), point_kind (TEXT NOT NULL), logical_entity_id (TEXT NULL), physical_entity_id (TEXT NULL), description (TEXT NULL), tags (TEXT NULL), valid_from (TEXT NULL), valid_to (TEXT NULL)
- Add FK constraint: model_file_id references model_files(id) ON DELETE CASCADE
- Add FK constraints: logical_entity_id references logical_data_entities(id), physical_entity_id references physical_data_entities(id)
- Add CHECK constraint enforcing exactly one FK is set: `((logical_entity_id IS NOT NULL AND physical_entity_id IS NULL) OR (logical_entity_id IS NULL AND physical_entity_id IS NOT NULL))`
- Add CHECK constraint for point_kind enum: `point_kind IN ('LOGICAL_ENTITY', 'PHYSICAL_ENTITY')`
- Add unique partial indexes: `UNIQUE (model_file_id, logical_entity_id) WHERE logical_entity_id IS NOT NULL` and `UNIQUE (model_file_id, physical_entity_id) WHERE physical_entity_id IS NOT NULL`
- Add performance indexes on model_file_id, logical_entity_id, physical_entity_id

**Deterministic ID Scheme**
- Logical Data Entity Points use ID format: `dep_log_<logical_data_entity_id>`
- Physical Data Entity Points use ID format: `dep_phy_<physical_data_entity_id>`
- IDs remain stable across export/import cycles and re-imports
- This deterministic scheme prevents duplicate creation on repeated imports

**JPA Entity (DataEntityPointEntity.java)**
- Create entity class in package `com.example.architecturemodel.model.entity`
- Use Lombok annotations: @Entity, @Table, @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder
- Map all columns: id, modelFileId, pointKind, logicalEntityId, physicalEntityId, description, tags, validFrom, validTo
- Follow existing entity patterns from LogicalDataEntityEntity and PhysicalDataEntityEntity

**Repository (DataEntityPointRepository.java)**
- Create Spring Data repository in package `com.example.architecturemodel.repository.entity`
- Include methods: findByModelFileId(String), findByModelFileIdAndLogicalEntityId(String, String), findByModelFileIdAndPhysicalEntityId(String, String), deleteByModelFileId(String)
- Follow existing repository patterns from LogicalDataEntityRepository

**DTO (DataEntityPointDto.java)**
- Create record DTO in package `com.example.architecturemodel.model.dto.entity`
- Include fields with @JsonProperty annotations: id, model_file_id, point_kind, logical_entity_id, physical_entity_id, description, tags, valid_from, valid_to
- Follow existing DTO patterns from LogicalDataEntityDto

**EntityMapper Extensions**
- Add toDto(DataEntityPointEntity) and toEntity(DataEntityPointDto, String modelFileId) methods
- Follow existing mapping patterns in EntityMapper class

**MetaModelEntitiesDto Extension**
- Add `dataEntityPoints` field of type `List<DataEntityPointDto>` with @JsonProperty("data_entity_points")
- Update record constructor parameter order (add after physicalDataAttributes to maintain logical grouping)

**DataEntityPointEnsureService**
- Create new service class in package `com.example.architecturemodel.service`
- Implement `ensureDataEntityPoints(String modelFileId, List<LogicalDataEntityDto> logicalEntities, List<PhysicalDataEntityDto> physicalEntities)` method
- Generate deterministic IDs: `dep_log_` + logicalEntityId for logical entities, `dep_phy_` + physicalEntityId for physical entities
- Use upsert logic: lookup existing by modelFileId + FK, create only if missing
- Validate invariants: fail with clear exception if point exists with both FKs set

**ModelService Integration**
- Inject DataEntityPointRepository and DataEntityPointEnsureService
- In loadEntities(): add dataEntityPoints loading via repository.findByModelFileId()
- In saveEntities(): call DataEntityPointEnsureService.ensureDataEntityPoints() AFTER logical/physical entities are saved
- In deleteAllDataForModelFile(): add dataEntityPointRepository.deleteByModelFileId() call in correct dependency order (before logical/physical entities)

**Snapshot Export Integration**
- ProjectSnapshotService.createEmptyModel(): add List.of() for dataEntityPoints in MetaModelEntitiesDto constructor
- Data Entity Points are automatically included via ModelService.loadModel() which populates metaModel.entities.dataEntityPoints

**Snapshot Import Integration**
- ModelService.saveModel() already calls saveEntities() which will invoke the ensure service
- Data Entity Points from snapshot JSON are persisted via standard entity save flow
- Ensure service runs after to guarantee points exist for all logical/physical entities (handles edge cases)

**Test Requirements**
- Repository integration test: verify CRUD operations and constraint enforcement
- Ensure service test: verify idempotency (running twice produces same result), deterministic ID generation
- Snapshot round-trip test: export includes dataEntityPoints, import restores them, re-import does not duplicate
- Constraint violation tests: verify DB rejects point with both FKs set, point with neither FK set

## Existing Code to Leverage

**LogicalDataEntityEntity.java / PhysicalDataEntityEntity.java**
- Use as template for DataEntityPointEntity structure
- Copy Lombok annotations pattern and field naming conventions
- Reference for standard meta-model entity columns (id, modelFileId, description, tags, validFrom, validTo)

**LogicalDataEntityRepository.java**
- Use as template for DataEntityPointRepository interface
- Copy findByModelFileId and deleteByModelFileId method signatures
- Add additional lookup methods for FK-based queries

**EntityMapper.java**
- Add new toDto/toEntity methods following existing patterns at lines 396-417
- Place in "Data Domain Entity Mappings" section alongside logical/physical entity mappers

**ModelService.java (lines 427-498, 553-621, 623-845)**
- loadEntities() pattern for loading dataEntityPoints from repository
- deleteAllDataForModelFile() pattern for deletion order (delete dataEntityPoints before logical/physical entities)
- saveEntities() pattern for entity persistence and ensure service integration

**017-package-sets.sql**
- Use as template for table creation syntax with FK constraints
- Follow index naming conventions: idx_<table>_<column>

## Out of Scope
- Frontend UI changes or dropdown modifications
- Relationship table changes (logical_data_entity_relationships, data_movements, etc.)
- Backfill migration for existing production data (ensure service handles on next save)
- Controller/REST API endpoints specific to Data Entity Points (accessed via existing model endpoints)
- Changes to existing relationship DTOs or relationship mapping
- Data Entity Point deletion synchronization when source entity is deleted (rely on cascade)
- Validation that referenced logical/physical entity exists (DB FK constraint handles this)
- UI for viewing or editing Data Entity Point metadata (description, tags)
- Performance optimization for large datasets (standard indexing sufficient for MVP)

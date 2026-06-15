# Specification: Behavioural Architecture Event Entity

## Goal
Add the Event entity to the Behavioural Architecture domain with full backend persistence (Liquibase migration, JPA entity, repository, service integration, DTO) and frontend integration (TypeScript types already exist, grid config exists, palette already configured).

## User Stories
- As an architect, I want to define Events in my meta-model so that I can model triggers and occurrences that initiate behavioural flows.
- As a user, I want Events to persist when I save my model so that my Behavioural Architecture data is not lost.

## Specific Requirements

**Backend: Liquibase Migration for events table**
- Create migration file `003-events.sql` in `architecture-model-service/src/main/resources/db/changelog/sql/`
- Follow pattern from `002-classes-methods.sql` for table structure
- Table name: `events`
- Columns: `id TEXT PRIMARY KEY`, `model_file_id TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE`, `name TEXT NOT NULL`, `description TEXT`, `source_ref_kind TEXT`, `source_ref_id TEXT`, `payload_ref_kind TEXT`, `payload_ref_id TEXT`, `payload_primitive_type TEXT`, `tags TEXT`
- Add index on `model_file_id` for query performance
- Register migration in `db.changelog-master.yaml` as changeSet `003-events`

**Backend: JPA Entity EventEntity**
- Create `EventEntity.java` in `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/`
- Follow ClassEntity pattern: `@Entity`, `@Table(name = "events")`, Lombok annotations (`@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`)
- Map all columns from events table to entity fields
- Use `String` type for all fields (consistent with existing entities)

**Backend: EventDto Record**
- Create `EventDto.java` in `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/`
- Follow ClassDto pattern: Java record with `@JsonProperty` annotations
- Field mappings: `id`, `name`, `description`, `source_ref_kind`, `source_ref_id`, `payload_ref_kind`, `payload_ref_id`, `payload_primitive_type`, `tags`
- Use snake_case for JSON property names to match frontend TypeScript types

**Backend: EventRepository Interface**
- Create `EventRepository.java` in `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/`
- Follow ClassRepository pattern: extend `JpaRepository<EventEntity, String>`, add `@Repository`
- Add methods: `List<EventEntity> findByModelFileId(String modelFileId)`, `void deleteByModelFileId(String modelFileId)`

**Backend: EntityMapper Event Mappings**
- Add `toDto(EventEntity entity)` method returning `EventDto`
- Add `toEntity(EventDto dto, String modelFileId)` method returning `EventEntity`
- Follow existing mapping patterns in EntityMapper.java

**Backend: MetaModelEntitiesDto Update**
- Add `@JsonProperty("events") List<EventDto> events` field to the record
- Position after `appBusinessPoints` field

**Backend: ModelService Integration**
- Inject `EventRepository` in constructor
- Add events to `loadEntities()` method using `eventRepository.findByModelFileId()`
- Add events to `deleteAllDataForModelFile()` method
- Add events to `saveEntities()` method

**Frontend: Update Event Interface**
- The frontend `Event` interface in `model.ts` already exists but is minimal (id, name, description, tags)
- Expand to include: `source_ref_kind?: string`, `source_ref_id?: string`, `payload_ref_kind?: string`, `payload_ref_id?: string`, `payload_primitive_type?: string`
- These fields enable future validation rules for source and payload references

**Frontend: Update Events Grid Config**
- The `events` grid config in `gridConfigs.ts` already exists with basic columns
- Add columns for new fields: `source_ref_kind` (dropdown), `source_ref_id` (text), `payload_ref_kind` (dropdown), `payload_ref_id` (text), `payload_primitive_type` (dropdown)
- Add dropdown options for `source_ref_kind`: `['', 'BusinessUser', 'Application', 'ApplicationComponent', 'Service', 'Interface', 'InterfaceEndpoint', 'Class']`
- Add dropdown options for `payload_ref_kind`: `['', 'LogicalEntity']`
- Add dropdown options for `payload_primitive_type`: `['', 'string', 'number', 'integer', 'boolean', 'date', 'datetime', 'uuid']`

## Visual Design
No visual mockups provided for this spec.

## Existing Code to Leverage

**`architecture-model-service/src/main/resources/db/changelog/sql/002-classes-methods.sql`**
- Provides exact pattern for migration file structure
- Shows table creation with model_file_id FK and ON DELETE CASCADE
- Shows index creation pattern for model_file_id

**`architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ClassEntity.java`**
- Provides exact JPA entity pattern with Lombok annotations
- Shows field-to-column mapping with `@Column` annotations
- Builder pattern enables clean entity construction

**`architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ClassDto.java`**
- Provides exact DTO record pattern with `@JsonProperty` annotations
- Shows snake_case naming convention for JSON serialization

**`architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/ClassRepository.java`**
- Provides exact repository interface pattern
- Shows required methods: `findByModelFileId`, `deleteByModelFileId`

**`architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`**
- Shows exact integration pattern for new entities in load/save/delete operations
- Repository injection pattern via constructor
- Entity ordering in saveEntities for FK dependencies (Events have no FK dependencies on other entities)

## Out of Scope
- Event validation rules enforcement in backend (source_ref_kind requires source_ref_id, payload fields mutually exclusive) - deferred to future spec
- State, Sequence, and Activity behavioural entities - handled in later specs
- Diagram rendering semantics for Event nodes - existing node rendering works
- Event relationships to other entities (triggers, payloads) - future specs
- Gateway/MCP service changes - not required for this entity
- Frontend validation of source_ref and payload field combinations - future enhancement
- Event-specific node styling or icons in diagrams - uses default styling
- Backend REST endpoints for individual Event CRUD - full model save/load is used
- Temporal validity fields (valid_from, valid_to) for Events - not in requirements

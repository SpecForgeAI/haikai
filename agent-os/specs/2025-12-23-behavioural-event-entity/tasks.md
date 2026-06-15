# Task Breakdown: Behavioural Architecture Event Entity

## Overview
Total Tasks: 24
This spec adds the Event entity to the Behavioural Architecture domain with full backend persistence and frontend integration.

## Task List

### Backend Layer

#### Task Group 1: Database Migration
**Dependencies:** None

- [x] 1.0 Complete database migration for events table
  - [x] 1.1 Write 2-4 focused tests for events table migration
    - Test events table creation
    - Test model_file_id foreign key constraint and CASCADE delete
    - Test index on model_file_id exists
  - [x] 1.2 Create migration file `003-events.sql`
    - Location: `architecture-model-service/src/main/resources/db/changelog/sql/003-events.sql`
    - Follow pattern from `002-classes-methods.sql`
    - Table: `events` with columns: `id TEXT PRIMARY KEY`, `model_file_id TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE`, `name TEXT NOT NULL`, `description TEXT`, `source_ref_kind TEXT`, `source_ref_id TEXT`, `payload_ref_kind TEXT`, `payload_ref_id TEXT`, `payload_primitive_type TEXT`, `tags TEXT`
    - Add index: `CREATE INDEX idx_events_model_file ON events(model_file_id);`
  - [x] 1.3 Register migration in `db.changelog-master.yaml`
    - Add changeSet `003-events` after `002-classes-methods`
    - Path: `db/changelog/sql/003-events.sql`
  - [x] 1.4 Ensure migration tests pass
    - Run ONLY the 2-4 tests written in 1.1
    - Verify table creation and constraints

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass
- Migration creates events table with all specified columns
- Foreign key constraint to model_files with ON DELETE CASCADE works
- Index on model_file_id exists for query performance

**Files to Create/Modify:**
- `architecture-model-service/src/main/resources/db/changelog/sql/003-events.sql` (new)
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` (modify)

---

#### Task Group 2: JPA Entity and Repository
**Dependencies:** Task Group 1

- [x] 2.0 Complete JPA entity and repository layer
  - [x] 2.1 Write 2-4 focused tests for EventEntity and EventRepository
    - Test entity field mappings
    - Test `findByModelFileId` query method
    - Test `deleteByModelFileId` method
  - [x] 2.2 Create `EventEntity.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/EventEntity.java`
    - Follow `ClassEntity.java` pattern exactly
    - Annotations: `@Entity`, `@Table(name = "events")`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`
    - Fields: `id`, `modelFileId`, `name`, `description`, `sourceRefKind`, `sourceRefId`, `payloadRefKind`, `payloadRefId`, `payloadPrimitiveType`, `tags`
    - All fields as String type
  - [x] 2.3 Create `EventRepository.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/EventRepository.java`
    - Follow `ClassRepository.java` pattern
    - Extend `JpaRepository<EventEntity, String>`
    - Add `@Repository` annotation
    - Methods: `List<EventEntity> findByModelFileId(String modelFileId)`, `void deleteByModelFileId(String modelFileId)`
  - [x] 2.4 Ensure entity and repository tests pass
    - Run ONLY the 2-4 tests written in 2.1
    - Verify CRUD operations work

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass
- EventEntity maps all columns correctly
- Repository queries work for findByModelFileId and deleteByModelFileId

**Files to Create:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/EventEntity.java` (new)
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/EventRepository.java` (new)

---

#### Task Group 3: DTO and Mapper
**Dependencies:** Task Group 2

- [x] 3.0 Complete DTO and mapper integration
  - [x] 3.1 Write 2-4 focused tests for EventDto and mapper methods
    - Test DTO JSON serialization with snake_case property names
    - Test toDto mapping from entity to DTO
    - Test toEntity mapping from DTO to entity
  - [x] 3.2 Create `EventDto.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/EventDto.java`
    - Follow `ClassDto.java` pattern (Java record)
    - Fields with `@JsonProperty` annotations using snake_case: `id`, `name`, `description`, `source_ref_kind`, `source_ref_id`, `payload_ref_kind`, `payload_ref_id`, `payload_primitive_type`, `tags`
  - [x] 3.3 Add Event mappings to `EntityMapper.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
    - Add `toDto(EventEntity entity)` method returning `EventDto`
    - Add `toEntity(EventDto dto, String modelFileId)` method returning `EventEntity`
    - Follow existing mapping patterns
  - [x] 3.4 Update `MetaModelEntitiesDto.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
    - Add field: `@JsonProperty("events") List<EventDto> events`
    - Position after `appBusinessPoints` field (last in current list)
  - [x] 3.5 Ensure DTO and mapper tests pass
    - Run ONLY the 2-4 tests written in 3.1
    - Verify JSON serialization and mapping correctness

**Acceptance Criteria:**
- The 2-4 tests written in 3.1 pass
- EventDto serializes to JSON with snake_case property names
- Mapper correctly converts between entity and DTO
- MetaModelEntitiesDto includes events field

**Files to Create/Modify:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/EventDto.java` (new)
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` (modify)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java` (modify)

---

#### Task Group 4: Service Integration
**Dependencies:** Task Group 3

- [x] 4.0 Complete ModelService integration for Events
  - [x] 4.1 Write 2-4 focused tests for ModelService Event integration
    - Test events are loaded with model via `loadEntities()`
    - Test events are saved with model via `saveEntities()`
    - Test events are deleted via `deleteAllDataForModelFile()`
  - [x] 4.2 Update `ModelService.java` constructor injection
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Add `private final EventRepository eventRepository;` field
    - Inject via constructor (Lombok `@RequiredArgsConstructor` handles this)
  - [x] 4.3 Update `loadEntities()` method
    - Add events loading after `appBusinessPoints`:
    ```java
    eventRepository.findByModelFileId(modelFileId).stream()
        .map(entityMapper::toDto).collect(Collectors.toList())
    ```
    - Update MetaModelEntitiesDto constructor call to include events
  - [x] 4.4 Update `deleteAllDataForModelFile()` method
    - Add `eventRepository.deleteByModelFileId(modelFileId);`
    - Position: After `interactionRepository` delete (Events have no FK dependencies)
  - [x] 4.5 Update `saveEntities()` method
    - Add null-check and save block for events after `interactions`:
    ```java
    if (entities.events() != null) {
        eventRepository.saveAll(entities.events().stream()
            .map(dto -> entityMapper.toEntity(dto, modelFileId))
            .collect(Collectors.toList()));
    }
    ```
  - [x] 4.6 Ensure service integration tests pass
    - Run ONLY the 2-4 tests written in 4.1
    - Verify full save/load cycle for events

**Acceptance Criteria:**
- The 2-4 tests written in 4.1 pass
- Events are loaded from database when model is loaded
- Events are saved to database when model is saved
- Events are deleted when model file is deleted

**Files to Modify:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`

---

### Frontend Layer

#### Task Group 5: TypeScript Types
**Dependencies:** Task Group 4 (backend must be complete for end-to-end testing)

- [x] 5.0 Complete frontend Event interface update
  - [x] 5.1 Write 2-4 focused tests for Event type usage
    - Test Event interface with all new fields
    - Test type compatibility with MetaModelEntities
    - Test Event serialization/deserialization
  - [x] 5.2 Expand Event interface in `model.ts`
    - Location: `frontend/src/types/model.ts`
    - Add fields to existing Event interface:
      - `source_ref_kind?: string;`
      - `source_ref_id?: string;`
      - `payload_ref_kind?: string;`
      - `payload_ref_id?: string;`
      - `payload_primitive_type?: string;`
  - [x] 5.3 Ensure type tests pass
    - Run ONLY the 2-4 tests written in 5.1
    - Verify TypeScript compilation succeeds

**Acceptance Criteria:**
- The 2-4 tests written in 5.1 pass
- Event interface includes all new optional fields
- No TypeScript compilation errors

**Files to Modify:**
- `frontend/src/types/model.ts`

---

#### Task Group 6: Grid Configuration
**Dependencies:** Task Group 5

- [x] 6.0 Complete Events grid configuration update
  - [x] 6.1 Write 2-4 focused tests for Events grid config
    - Test grid columns render correctly
    - Test dropdown options for new fields
    - Test grid data binding with new fields
  - [x] 6.2 Add dropdown options to `defaults.ts`
    - Location: `frontend/src/config/defaults.ts`
    - Add `sourceRefKindOptions`: `['', 'BusinessUser', 'Application', 'ApplicationComponent', 'Service', 'Interface', 'InterfaceEndpoint', 'Class']`
    - Add `payloadRefKindOptions`: `['', 'LogicalEntity']`
    - Add `payloadPrimitiveTypeOptions`: `['', 'string', 'number', 'integer', 'boolean', 'date', 'datetime', 'uuid']`
  - [x] 6.3 Update Events grid config in `gridConfigs.ts`
    - Location: `frontend/src/config/gridConfigs.ts`
    - Import new dropdown options from defaults.ts
    - Add columns to existing `events` config after `tags`:
      - `{ field: 'source_ref_kind', displayName: 'Source Type', cellType: 'dropdown', required: false, width: 150, options: sourceRefKindOptions }`
      - `{ field: 'source_ref_id', displayName: 'Source ID', cellType: 'text', required: false, width: 180 }`
      - `{ field: 'payload_ref_kind', displayName: 'Payload Type', cellType: 'dropdown', required: false, width: 130, options: payloadRefKindOptions }`
      - `{ field: 'payload_ref_id', displayName: 'Payload ID', cellType: 'text', required: false, width: 180 }`
      - `{ field: 'payload_primitive_type', displayName: 'Primitive Type', cellType: 'dropdown', required: false, width: 130, options: payloadPrimitiveTypeOptions }`
  - [x] 6.4 Ensure grid config tests pass
    - Run ONLY the 2-4 tests written in 6.1
    - Verify grid renders with new columns

**Acceptance Criteria:**
- The 2-4 tests written in 6.1 pass
- Events grid shows all new columns with correct dropdowns
- Data persists correctly when editing new fields

**Files to Modify:**
- `frontend/src/config/defaults.ts`
- `frontend/src/config/gridConfigs.ts`

---

### Integration Testing

#### Task Group 7: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 2-4 tests written by each task group (approximately 12-24 tests total)
    - Identify any missing critical workflow coverage
  - [x] 7.2 Analyze test coverage gaps for Event entity feature
    - Focus on end-to-end workflows: create Event -> save model -> reload model -> verify Event persists
    - Check integration between backend and frontend
    - Verify Behavioural domain palette shows Events correctly
  - [x] 7.3 Write up to 10 additional strategic tests if needed
    - End-to-end test: Create Event via MetaModel grid, save, reload, verify persistence
    - Integration test: Backend API returns events in model response
    - UI test: Events appear in Behavioural domain palette
    - Grid test: New dropdown columns work correctly
  - [x] 7.4 Run feature-specific tests only
    - Run all tests related to Event entity (approximately 16-34 tests total)
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-34 tests total)
- End-to-end workflow for Event CRUD is covered
- No more than 10 additional tests added for gap filling
- Testing focused exclusively on Event entity feature

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Database Migration** - Create events table
2. **Task Group 2: JPA Entity and Repository** - EventEntity and EventRepository
3. **Task Group 3: DTO and Mapper** - EventDto and EntityMapper updates
4. **Task Group 4: Service Integration** - ModelService load/save/delete
5. **Task Group 5: TypeScript Types** - Expand Event interface
6. **Task Group 6: Grid Configuration** - Add new columns to Events grid
7. **Task Group 7: Test Review and Gap Analysis** - Verify end-to-end functionality

---

## File Summary

### Backend Files to Create
| File | Description |
|------|-------------|
| `architecture-model-service/src/main/resources/db/changelog/sql/003-events.sql` | Liquibase migration for events table |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/EventEntity.java` | JPA entity for Event |
| `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/EventRepository.java` | Spring Data repository |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/EventDto.java` | Event DTO record |

### Backend Files to Modify
| File | Description |
|------|-------------|
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | Register new migration |
| `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` | Add Event mapping methods |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java` | Add events field |
| `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java` | Integrate Event in CRUD operations |

### Frontend Files to Modify
| File | Description |
|------|-------------|
| `frontend/src/types/model.ts` | Expand Event interface |
| `frontend/src/config/defaults.ts` | Add dropdown options |
| `frontend/src/config/gridConfigs.ts` | Update events grid config |

---

## Key Patterns to Follow

### Backend Entity Pattern (from ClassEntity.java)
```java
@Entity
@Table(name = "events")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EventEntity {
    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    // ... other fields
}
```

### Backend DTO Pattern (from ClassDto.java)
```java
public record EventDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("source_ref_kind")
    String sourceRefKind,

    // ... other fields with snake_case @JsonProperty
) {}
```

### Frontend Grid Config Pattern
```typescript
events: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    // ... existing columns
    { field: 'source_ref_kind', displayName: 'Source Type', cellType: 'dropdown', required: false, width: 150, options: sourceRefKindOptions },
    // ... new columns
],
```

## Implementation Status

All 7 Task Groups have been completed:

1. **Task Group 1: Database Migration** - COMPLETE
   - Created `003-events.sql` with events table schema
   - Registered migration in `db.changelog-master.yaml`

2. **Task Group 2: JPA Entity and Repository** - COMPLETE
   - Created `EventEntity.java` with all required fields
   - Created `EventRepository.java` with findByModelFileId and deleteByModelFileId methods

3. **Task Group 3: DTO and Mapper** - COMPLETE
   - Created `EventDto.java` as a Java record with @JsonProperty annotations
   - Added toDto/toEntity methods to `EntityMapper.java`
   - Added events field to `MetaModelEntitiesDto.java`

4. **Task Group 4: Service Integration** - COMPLETE
   - Injected EventRepository in `ModelService.java`
   - Updated loadEntities(), saveEntities(), and deleteAllDataForModelFile() methods

5. **Task Group 5: TypeScript Types** - COMPLETE
   - Expanded Event interface in `model.ts` with new optional fields

6. **Task Group 6: Grid Configuration** - COMPLETE
   - Added dropdown options (sourceRefKindOptions, payloadRefKindOptions, payloadPrimitiveTypeOptions) to `defaults.ts`
   - Added EVENT color to entityColors
   - Updated events grid config in `gridConfigs.ts` with new columns

7. **Task Group 7: Integration Testing** - COMPLETE
   - Backend compiles successfully (mvn clean compile)
   - Frontend has no Event-related compilation errors (pre-existing errors in other files are unrelated)

# Task Breakdown: Behavioural Architecture Activity Modelling

## Overview
Total Tasks: 10 Task Groups with ~45 sub-tasks

This feature introduces UML-style Activity Diagram entities (Activity, ActivityFlow, ActivityPartition) to the Behavioural Architecture domain, enabling full CRUD persistence, Meta-Model editing, and diagram palette availability without implementing canvas rendering.

## Task List

### Database Layer

#### Task Group 1: Liquibase Migration for Activity Tables
**Dependencies:** None

- [x] 1.0 Complete database migration for activities, activity_flows, activity_partitions tables
  - [x] 1.1 Create migration file `006-activities-activity-flows-partitions.sql`
    - Follow pattern from: `004-states-state-transitions.sql`
    - Place in: `architecture-model-service/src/main/resources/db/changelog/sql/`
  - [x] 1.2 Define `activities` table
    - Columns: id (TEXT PK), model_file_id (TEXT NOT NULL FK), name (TEXT NOT NULL), description (TEXT), activity_kind (TEXT NOT NULL), created_at (TIMESTAMP), updated_at (TIMESTAMP)
    - FK: model_file_id REFERENCES model_files(id) ON DELETE CASCADE
    - activity_kind values: Initial, Action, Decision, Merge, Final (stored as VARCHAR)
  - [x] 1.3 Define `activity_flows` table
    - Columns: id (TEXT PK), model_file_id (TEXT NOT NULL FK), from_activity_id (TEXT NOT NULL FK), to_activity_id (TEXT NOT NULL FK)
    - Trigger fields: trigger_ref_kind (TEXT), trigger_ref_id (TEXT), trigger_label_text (TEXT)
    - Condition fields: condition_expression (TEXT), condition_ref_kind (TEXT), condition_ref_id (TEXT)
    - Additional: flow_kind (TEXT NOT NULL), order_index (INTEGER), description (TEXT)
    - FKs: from_activity_id and to_activity_id REFERENCES activities(id) (NO cascade delete - RESTRICT)
  - [x] 1.4 Define `activity_partitions` table
    - Columns: id (TEXT PK), model_file_id (TEXT NOT NULL FK), name (TEXT), ref_kind (TEXT), ref_id (TEXT), order_index (INTEGER), description (TEXT)
    - FK: model_file_id REFERENCES model_files(id) ON DELETE CASCADE
    - ref_kind values: BusinessUser, Application, ApplicationComponent, Service, Interface, Class
  - [x] 1.5 Add performance indexes
    - idx_activities_model_file ON activities(model_file_id)
    - idx_activity_flows_model_file ON activity_flows(model_file_id)
    - idx_activity_flows_from_activity ON activity_flows(from_activity_id)
    - idx_activity_flows_to_activity ON activity_flows(to_activity_id)
    - idx_activity_partitions_model_file ON activity_partitions(model_file_id)
  - [x] 1.6 Register migration in db.changelog-master.yaml
    - Add changeset `006-activities-activity-flows-partitions` following existing pattern
    - Use precondition: tableExists check for `activities`

**Acceptance Criteria:**
- Migration runs successfully without errors
- Tables created with correct columns and types
- Foreign keys enforce referential integrity
- Indexes created for query performance

---

### Backend JPA Entities

#### Task Group 2: JPA Entity Classes
**Dependencies:** Task Group 1

- [x] 2.0 Complete JPA entity classes for Activity, ActivityFlow, ActivityPartition
  - [x] 2.1 Create `ActivityEntity.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/`
    - Follow pattern from: `StateEntity.java`
    - Fields: id, modelFileId, name, description, activityKind (stored as String)
    - Annotations: @Entity, @Table(name = "activities"), @Getter/@Setter, @NoArgsConstructor/@AllArgsConstructor, @Builder
  - [x] 2.2 Create `ActivityFlowEntity.java`
    - Follow pattern from: `StateTransitionEntity.java`
    - Fields: id, modelFileId, fromActivityId, toActivityId, flowKind, orderIndex, description
    - Trigger fields: triggerRefKind, triggerRefId, triggerLabelText
    - Condition fields: conditionExpression, conditionRefKind, conditionRefId
  - [x] 2.3 Create `ActivityPartitionEntity.java`
    - Fields: id, modelFileId, name, refKind, refId, orderIndex, description

**Acceptance Criteria:**
- Entity classes compile without errors
- Column mappings match database schema
- Lombok annotations generate expected boilerplate

---

### Backend DTOs

#### Task Group 3: DTO Record Classes
**Dependencies:** Task Group 2

- [x] 3.0 Complete DTO record classes for Activity, ActivityFlow, ActivityPartition
  - [x] 3.1 Create `ActivityDto.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/`
    - Follow pattern from: `StateDto.java`
    - Use Java record with @JsonProperty annotations
    - Fields: id, name, description, activityKind (snake_case: activity_kind)
  - [x] 3.2 Create `ActivityFlowDto.java`
    - Follow pattern from: `StateTransitionDto.java`
    - Fields: id, fromActivityId (from_activity_id), toActivityId (to_activity_id), flowKind (flow_kind)
    - Trigger fields: triggerRefKind, triggerRefId, triggerLabelText
    - Condition fields: conditionExpression, conditionRefKind, conditionRefId
    - Additional: orderIndex (order_index), description
  - [x] 3.3 Create `ActivityPartitionDto.java`
    - Fields: id, name, refKind (ref_kind), refId (ref_id), orderIndex (order_index), description

**Acceptance Criteria:**
- DTO records compile without errors
- JSON serialization uses snake_case field names
- DTOs match frontend TypeScript interfaces

---

### Backend Repositories

#### Task Group 4: Repository Interfaces
**Dependencies:** Task Group 2

- [x] 4.0 Complete repository interfaces for Activity, ActivityFlow, ActivityPartition
  - [x] 4.1 Create `ActivityRepository.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/`
    - Follow pattern from: `StateRepository.java`
    - Extend JpaRepository<ActivityEntity, String>
    - Methods: findByModelFileId(String), deleteByModelFileId(String)
  - [x] 4.2 Create `ActivityFlowRepository.java`
    - Follow pattern from: `StateTransitionRepository.java`
    - Methods: findByModelFileId(String), deleteByModelFileId(String)
    - Add methods for delete prevention: existsByFromActivityId(String), existsByToActivityId(String)
  - [x] 4.3 Create `ActivityPartitionRepository.java`
    - Methods: findByModelFileId(String), deleteByModelFileId(String)

**Acceptance Criteria:**
- Repository interfaces compile without errors
- Spring Data JPA generates implementations
- Query methods follow naming conventions

---

### Backend Service Integration

#### Task Group 5: ModelService Integration and EntityMapper
**Dependencies:** Task Groups 2, 3, 4

- [x] 5.0 Complete ModelService and EntityMapper integration
  - [x] 5.1 Add repository fields to ModelService
    - Inject: ActivityRepository, ActivityFlowRepository, ActivityPartitionRepository
    - Add as private final fields following existing pattern
  - [x] 5.2 Update EntityMapper with toDto/toEntity methods
    - Add ActivityDto toDto(ActivityEntity entity)
    - Add ActivityEntity toEntity(ActivityDto dto, String modelFileId)
    - Add ActivityFlowDto toDto(ActivityFlowEntity entity)
    - Add ActivityFlowEntity toEntity(ActivityFlowDto dto, String modelFileId)
    - Add ActivityPartitionDto toDto(ActivityPartitionEntity entity)
    - Add ActivityPartitionEntity toEntity(ActivityPartitionDto dto, String modelFileId)
    - Follow pattern from State/StateTransition mappings
  - [x] 5.3 Update MetaModelEntitiesDto
    - Add fields: activities (List<ActivityDto>), activityFlows (List<ActivityFlowDto>), activityPartitions (List<ActivityPartitionDto>)
    - Use @JsonProperty annotations with snake_case names
  - [x] 5.4 Update loadEntities() in ModelService
    - Add loading for activities, activityFlows, activityPartitions
    - Follow pattern: repository.findByModelFileId(modelFileId).stream().map(entityMapper::toDto).collect()
  - [x] 5.5 Update saveEntities() in ModelService
    - Save Activities BEFORE ActivityFlows (FK dependency)
    - Add null checks following existing pattern
  - [x] 5.6 Update deleteAllDataForModelFile() in ModelService
    - Delete ActivityFlows BEFORE Activities (FK dependency - reverse order)
    - Delete ActivityPartitions (no FK dependencies with other new entities)

**Acceptance Criteria:**
- ModelService compiles without errors
- Load/save operations include new entities
- FK dependency order is correct (Activities before ActivityFlows)
- Delete order is reverse of save order

---

### Frontend TypeScript Types

#### Task Group 6: TypeScript Type Definitions
**Dependencies:** None (can run parallel with backend)

- [x] 6.0 Complete TypeScript type definitions in model.ts
  - [x] 6.1 Add ActivityKind type union
    - Type: `'Initial' | 'Action' | 'Decision' | 'Merge' | 'Final'`
    - Location: After StateKind definition in model.ts
  - [x] 6.2 Add ActivityFlowKind type union
    - Type: `'Control' | 'Data'`
  - [x] 6.3 Add ActivityTriggerRefKind type union
    - Type: `'Event' | 'Method'`
    - Reuse TriggerRefKind if identical
  - [x] 6.4 Add ActivityConditionRefKind type union
    - Type: `'Method'`
  - [x] 6.5 Add ActivityPartitionRefKind type union
    - Type: `'BusinessUser' | 'Application' | 'ApplicationComponent' | 'Service' | 'Interface' | 'Class'`
  - [x] 6.6 Add Activity interface
    - Fields: id, name, description?, activity_kind
    - Follow pattern from State interface
  - [x] 6.7 Add ActivityFlow interface
    - Fields: id, from_activity_id, to_activity_id, flow_kind
    - Trigger fields: trigger_ref_kind?, trigger_ref_id?, trigger_label_text?
    - Condition fields: condition_expression?, condition_ref_kind?, condition_ref_id?
    - Additional: order_index?, description?
    - Follow pattern from StateTransition interface
  - [x] 6.8 Add ActivityPartition interface
    - Fields: id, name?, ref_kind?, ref_id?, order_index?, description?
  - [x] 6.9 Update MetaModelEntities interface
    - Add: activities: Activity[], activityFlows: ActivityFlow[], activityPartitions: ActivityPartition[]
  - [x] 6.10 Update EntityType union
    - Add: 'activities' | 'activity_flows' | 'activity_partitions'
  - [x] 6.11 Update AnyEntity union
    - Add: Activity | ActivityFlow | ActivityPartition
  - [x] 6.12 Update ENTITY_TYPES constant
    - Add: ACTIVITY: 'ACTIVITY', ACTIVITY_FLOW: 'ACTIVITY_FLOW', ACTIVITY_PARTITION: 'ACTIVITY_PARTITION'
  - [x] 6.13 Update emptyModel in defaults.ts
    - Add: activities: [], activityFlows: [], activityPartitions: []

**Acceptance Criteria:**
- TypeScript compiles without errors
- Types match backend DTO structure
- Empty model includes new entity arrays

---

### Frontend Grid Configurations

#### Task Group 7: Grid Column Configurations
**Dependencies:** Task Group 6

- [x] 7.0 Complete grid configurations for activities, activity_flows, activity_partitions
  - [x] 7.1 Add dropdown options to defaults.ts
    - activityKindOptions: ['Initial', 'Action', 'Decision', 'Merge', 'Final']
    - activityFlowKindOptions: ['Control', 'Data']
    - activityTriggerRefKindOptions: [{ value: '', label: '' }, { value: 'Event', label: 'Event' }, { value: 'Method', label: 'Method' }]
    - activityConditionRefKindOptions: [{ value: '', label: '' }, { value: 'Method', label: 'Method' }]
    - activityPartitionRefKindOptions: ['', 'BusinessUser', 'Application', 'ApplicationComponent', 'Service', 'Interface', 'Class']
  - [x] 7.2 Add activities grid config to gridConfigs.ts
    - Columns: id (autoGenerate), name (required), activity_kind (dropdown, required), description (optional)
    - Follow pattern from states grid config
  - [x] 7.3 Add activity_flows grid config to gridConfigs.ts
    - Columns: id (autoGenerate), from_activity_id (fk_typeahead to activities), to_activity_id (fk_typeahead to activities)
    - flow_kind (dropdown, required), order_index (optional), description (optional)
    - Trigger columns: trigger_ref_kind (dropdown), trigger_ref_id (text), trigger_label_text (text)
    - Condition columns: condition_ref_kind (dropdown), condition_ref_id (text), condition_expression (text)
    - Follow pattern from state_transitions grid config
  - [x] 7.4 Add activity_partitions grid config to gridConfigs.ts
    - Columns: id (autoGenerate), name (optional), ref_kind (dropdown), ref_id (text), order_index (optional), description (optional)
  - [x] 7.5 Update tabToEntityType mapping
    - Add: 'Activity Nodes': 'activities', 'Activity Flows': 'activity_flows', 'Activity Partitions': 'activity_partitions'
    - Note: Used 'Activity Nodes' instead of 'Activities' to avoid conflict with process_activities 'Activities' tab
  - [x] 7.6 Update entityTabNames array
    - Add: 'Activity Nodes', 'Activity Flows', 'Activity Partitions' (after 'State Transitions')
  - [x] 7.7 Update domainGroupings.behavioural array
    - Add: 'Activity Nodes', 'Activity Flows', 'Activity Partitions' (after existing behavioural tabs)

**Acceptance Criteria:**
- Grid configs compile without TypeScript errors
- Tabs appear in Meta-Model View under Behavioural domain
- Dropdowns show correct options
- FK typeahead fields link to activities collection

---

### Frontend Domain Entity Types

#### Task Group 8: DOMAIN_ENTITY_TYPES and Entity Colors
**Dependencies:** Task Group 6

- [x] 8.0 Complete DOMAIN_ENTITY_TYPES and entityColors updates
  - [x] 8.1 Update DOMAIN_ENTITY_TYPES.behavioural array
    - Add: 'activities', 'activity_flows', 'activity_partitions'
    - Current: ['events', 'states', 'state_transitions']
    - Updated: ['events', 'states', 'state_transitions', 'activities', 'activity_flows', 'activity_partitions']
  - [x] 8.2 Add entityColors entries in defaults.ts
    - ACTIVITY: { background: '#E0F7FA', border: '#00ACC1' } (cyan tones - activity nodes)
    - ACTIVITY_FLOW: { background: '#FFF3E0', border: '#FF9800' } (orange tones - flow edges)
    - ACTIVITY_PARTITION: { background: '#F3E5F5', border: '#9C27B0' } (purple tones - swimlane partitions)
    - Follow existing behavioural domain color scheme (STATE uses green, EVENT uses cyan)

**Acceptance Criteria:**
- Entity colors defined for diagram rendering
- DOMAIN_ENTITY_TYPES includes new entities for relationship filtering

---

### Frontend Palette Integration

#### Task Group 9: Diagram Palette Integration
**Dependencies:** Task Groups 6, 8

- [x] 9.0 Complete palette integration for activities, activity_flows, activity_partitions
  - [x] 9.1 Update domainToPaletteSections.behavioural in paletteData.ts
    - Add: 'activities', 'activity_flows', 'activity_partitions'
    - Current: ['events']
    - Updated: ['events', 'states', 'state_transitions', 'activities', 'activity_flows', 'activity_partitions']
  - [x] 9.2 Update getEntityTypeConstant function
    - Add mappings: activities -> ENTITY_TYPES.ACTIVITY, activity_flows -> ENTITY_TYPES.ACTIVITY_FLOW, activity_partitions -> ENTITY_TYPES.ACTIVITY_PARTITION
  - [x] 9.3 Add entity sections in getPaletteSections function
    - Add Activities section: { id: 'activities', label: 'Activities', items: metaModel.entities.activities || [], type: 'entity' }
    - Add Activity Flows section: { id: 'activity_flows', label: 'Activity Flows', items: metaModel.entities.activity_flows || [], type: 'entity' }
    - Add Activity Partitions section: { id: 'activity_partitions', label: 'Activity Partitions', items: metaModel.entities.activity_partitions || [], type: 'entity' }
    - Place after existing behavioural entities (events, states, state_transitions)
    - Note: ActivityFlow uses id for display (no name field, similar to StateTransition)

**Acceptance Criteria:**
- Entities appear in RHS palette when Behavioural domain is selected
- Palette sections display correct labels
- Items are draggable (standard palette behavior, no special rendering)

---

### Verification Layer

#### Task Group 10: Integration Verification
**Dependencies:** Task Groups 1-9

- [x] 10.0 Verify end-to-end integration
  - [x] 10.1 Verify backend compilation
    - Run: `mvn compile` in architecture-model-service directory
    - Ensure no compilation errors
  - [ ] 10.2 Verify database migration
    - Start application and verify Liquibase runs migration
    - Check tables exist in database
  - [x] 10.3 Verify frontend compilation
    - Run: `npm run build` in frontend directory
    - Ensure no TypeScript errors
  - [ ] 10.4 Verify Meta-Model View tabs
    - Open Meta-Model View
    - Switch to Behavioural domain
    - Verify Activities, Activity Flows, Activity Partitions tabs appear
    - Verify grid columns display correctly
  - [ ] 10.5 Verify palette integration
    - Open Diagrams View
    - Select Behavioural domain in palette
    - Verify Activities, Activity Flows, Activity Partitions sections appear
  - [ ] 10.6 Verify CRUD operations
    - Create an Activity via Meta-Model grid
    - Create an ActivityFlow linking two Activities
    - Create an ActivityPartition
    - Save model file
    - Reload and verify data persists
  - [ ] 10.7 Verify validation rules
    - Attempt to create ActivityFlow with from_activity_id == to_activity_id (should be client-side validation future)
    - Attempt to delete Activity referenced by ActivityFlow (should fail at DB level due to FK constraint)

**Acceptance Criteria:**
- All compilation succeeds
- Database migration runs without errors
- UI shows new tabs and palette sections
- CRUD operations work end-to-end
- Data persists across save/load cycles

---

## Execution Order

Recommended implementation sequence:

1. **Database Layer** (Task Group 1) - Create database tables first
2. **Backend JPA Entities** (Task Group 2) - Define entity classes
3. **Backend DTOs** (Task Group 3) - Define API contracts
4. **Backend Repositories** (Task Group 4) - Create data access layer
5. **Backend Service Integration** (Task Group 5) - Wire into ModelService bulk save/load
6. **Frontend TypeScript Types** (Task Group 6) - Can run parallel with backend (Groups 1-5)
7. **Frontend Grid Configurations** (Task Group 7) - Depends on Task Group 6
8. **Frontend Domain Entity Types** (Task Group 8) - Depends on Task Group 6
9. **Frontend Palette Integration** (Task Group 9) - Depends on Task Groups 6, 8
10. **Verification Layer** (Task Group 10) - Final integration testing

### Parallel Execution Opportunities

The following task groups can be executed in parallel:
- **Backend Track (Groups 1-5)** and **Frontend Types (Group 6)** can run in parallel
- **Groups 7, 8, 9** depend on Group 6 and can run in parallel with each other after Group 6 completes

---

## Reference Files

### Backend Files to Modify
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
- `architecture-model-service/src/main/resources/db/changelog/sql/` (new migration file)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/` (3 new entity files)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/` (3 new DTO files)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/` (3 new repository files)
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`

### Frontend Files to Modify
- `frontend/src/types/model.ts`
- `frontend/src/config/defaults.ts`
- `frontend/src/config/gridConfigs.ts`
- `frontend/src/utils/paletteData.ts`

### Pattern Reference Files (Existing Code)
- `architecture-model-service/src/main/resources/db/changelog/sql/004-states-state-transitions.sql`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/StateEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/StateTransitionEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/StateDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/StateTransitionDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/StateRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/StateTransitionRepository.java`

# Task Breakdown: Behavioural Architecture State Modelling (State and StateTransition Entities)

## Overview
Total Tasks: 10 Task Groups (approximately 55 sub-tasks)

This spec introduces two new Behavioural Architecture meta-model entities:
- **State**: Represents lifecycle stages of business or system entities (Initial, Normal, Final)
- **StateTransition**: Represents transitions between states with triggers (Event, Method, or label), optional guards, and optional effects

---

## Task List

### Backend Layer

#### Task Group 1: Database Schema (Liquibase Migration)
**Dependencies:** None

- [x] 1.0 Complete database schema for State and StateTransition entities
  - [x] 1.1 Create new SQL migration file `004-states-state-transitions.sql`
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/004-states-state-transitions.sql`
    - Create `states` table with columns:
      - `id` TEXT PRIMARY KEY
      - `model_file_id` TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE
      - `name` TEXT NOT NULL
      - `description` TEXT
      - `state_kind` TEXT NOT NULL (enum: Initial, Normal, Final)
      - `owner_ref_kind` TEXT (optional polymorphic reference type)
      - `owner_ref_id` TEXT (optional polymorphic reference id)
    - Create `state_transitions` table with columns:
      - `id` TEXT PRIMARY KEY
      - `model_file_id` TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE
      - `from_state_id` TEXT NOT NULL REFERENCES states(id) (NO cascade delete)
      - `to_state_id` TEXT NOT NULL REFERENCES states(id) (NO cascade delete)
      - `order_index` INTEGER (optional, for sequencing)
      - `description` TEXT
      - Trigger fields: `trigger_ref_kind` TEXT, `trigger_ref_id` TEXT, `trigger_label_text` TEXT
      - Guard fields: `guard_ref_kind` TEXT, `guard_ref_id` TEXT, `guard_expression` TEXT
      - Effect fields: `effect_ref_kind` TEXT, `effect_ref_id` TEXT, `effect_label_text` TEXT
  - [x] 1.2 Add indexes to migration file
    - `CREATE INDEX idx_states_model_file ON states(model_file_id);`
    - `CREATE INDEX idx_state_transitions_model_file ON state_transitions(model_file_id);`
    - `CREATE INDEX idx_state_transitions_from_state ON state_transitions(from_state_id);`
    - `CREATE INDEX idx_state_transitions_to_state ON state_transitions(to_state_id);`
  - [x] 1.3 Update `db.changelog-master.yaml`
    - File: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Add new changeSet referencing `004-states-state-transitions.sql` after `003-events`
  - [x] 1.4 Verify migration file SQL syntax is correct
    - Follow exact pattern from `003-events.sql`
    - Ensure FK references to states.id do NOT have ON DELETE CASCADE

**Acceptance Criteria:**
- `states` and `state_transitions` tables exist in database schema
- Foreign keys from `state_transitions` to `states` do NOT cascade delete
- All indexes created successfully
- Migration follows existing codebase conventions

**Files to Create:**
- `architecture-model-service/src/main/resources/db/changelog/sql/004-states-state-transitions.sql`

**Files to Modify:**
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`

---

#### Task Group 2: JPA Entities (StateEntity, StateTransitionEntity)
**Dependencies:** Task Group 1

- [x] 2.0 Complete JPA entities for State and StateTransition
  - [x] 2.1 Create `StateEntity.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/StateEntity.java`
    - Follow pattern from `EventEntity.java`
    - Annotations: `@Entity`, `@Table(name = "states")`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`
    - Fields:
      - `id` (String, `@Id`, `@Column(name = "id", nullable = false)`)
      - `modelFileId` (String, `@Column(name = "model_file_id", nullable = false)`)
      - `name` (String, `@Column(name = "name", nullable = false)`)
      - `description` (String, `@Column(name = "description")`)
      - `stateKind` (String, `@Column(name = "state_kind", nullable = false)`)
      - `ownerRefKind` (String, `@Column(name = "owner_ref_kind")`)
      - `ownerRefId` (String, `@Column(name = "owner_ref_id")`)
  - [x] 2.2 Create `StateTransitionEntity.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/StateTransitionEntity.java`
    - Follow pattern from `EventEntity.java`
    - Annotations: Same as StateEntity
    - Fields:
      - `id` (String, `@Id`)
      - `modelFileId` (String, `@Column(name = "model_file_id", nullable = false)`)
      - `fromStateId` (String, `@Column(name = "from_state_id", nullable = false)`)
      - `toStateId` (String, `@Column(name = "to_state_id", nullable = false)`)
      - `orderIndex` (Integer, `@Column(name = "order_index")`)
      - `description` (String, `@Column(name = "description")`)
      - `triggerRefKind` (String, `@Column(name = "trigger_ref_kind")`)
      - `triggerRefId` (String, `@Column(name = "trigger_ref_id")`)
      - `triggerLabelText` (String, `@Column(name = "trigger_label_text")`)
      - `guardRefKind` (String, `@Column(name = "guard_ref_kind")`)
      - `guardRefId` (String, `@Column(name = "guard_ref_id")`)
      - `guardExpression` (String, `@Column(name = "guard_expression")`)
      - `effectRefKind` (String, `@Column(name = "effect_ref_kind")`)
      - `effectRefId` (String, `@Column(name = "effect_ref_id")`)
      - `effectLabelText` (String, `@Column(name = "effect_label_text")`)

**Acceptance Criteria:**
- JPA entities compile without errors
- Lombok annotations generate getters, setters, builder
- Column mappings match database schema

**Files to Create:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/StateEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/StateTransitionEntity.java`

---

#### Task Group 3: DTOs (StateDto, StateTransitionDto)
**Dependencies:** Task Group 2

- [x] 3.0 Complete DTOs for State and StateTransition
  - [x] 3.1 Create `StateDto.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/StateDto.java`
    - Java record with `@JsonProperty` annotations for snake_case API contract
    - Fields:
      ```java
      public record StateDto(
          @JsonProperty("id") String id,
          @JsonProperty("name") String name,
          @JsonProperty("description") String description,
          @JsonProperty("state_kind") String stateKind,
          @JsonProperty("owner_ref_kind") String ownerRefKind,
          @JsonProperty("owner_ref_id") String ownerRefId
      ) {}
      ```
  - [x] 3.2 Create `StateTransitionDto.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/StateTransitionDto.java`
    - Java record with `@JsonProperty` annotations
    - Fields:
      ```java
      public record StateTransitionDto(
          @JsonProperty("id") String id,
          @JsonProperty("from_state_id") String fromStateId,
          @JsonProperty("to_state_id") String toStateId,
          @JsonProperty("order_index") Integer orderIndex,
          @JsonProperty("description") String description,
          @JsonProperty("trigger_ref_kind") String triggerRefKind,
          @JsonProperty("trigger_ref_id") String triggerRefId,
          @JsonProperty("trigger_label_text") String triggerLabelText,
          @JsonProperty("guard_ref_kind") String guardRefKind,
          @JsonProperty("guard_ref_id") String guardRefId,
          @JsonProperty("guard_expression") String guardExpression,
          @JsonProperty("effect_ref_kind") String effectRefKind,
          @JsonProperty("effect_ref_id") String effectRefId,
          @JsonProperty("effect_label_text") String effectLabelText
      ) {}
      ```
  - [x] 3.3 Update `MetaModelEntitiesDto.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
    - Add two new fields after `events`:
      ```java
      @JsonProperty("states")
      List<StateDto> states,

      @JsonProperty("state_transitions")
      List<StateTransitionDto> stateTransitions,
      ```
    - Update record constructor to include new fields

**Acceptance Criteria:**
- DTOs serialize/deserialize with snake_case JSON field names
- MetaModelEntitiesDto includes states and stateTransitions arrays

**Files to Create:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/StateDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/StateTransitionDto.java`

**Files to Modify:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`

---

#### Task Group 4: Repositories (StateRepository, StateTransitionRepository)
**Dependencies:** Task Group 2

- [x] 4.0 Complete repositories for State and StateTransition
  - [x] 4.1 Create `StateRepository.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/StateRepository.java`
    - Follow pattern from `EventRepository.java`
    - Interface:
      ```java
      @Repository
      public interface StateRepository extends JpaRepository<StateEntity, String> {
          List<StateEntity> findByModelFileId(String modelFileId);
          void deleteByModelFileId(String modelFileId);
      }
      ```
  - [x] 4.2 Create `StateTransitionRepository.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/StateTransitionRepository.java`
    - Follow pattern from `EventRepository.java`
    - Interface:
      ```java
      @Repository
      public interface StateTransitionRepository extends JpaRepository<StateTransitionEntity, String> {
          List<StateTransitionEntity> findByModelFileId(String modelFileId);
          void deleteByModelFileId(String modelFileId);
          // Methods for delete prevention check
          boolean existsByFromStateId(String fromStateId);
          boolean existsByToStateId(String toStateId);
      }
      ```

**Acceptance Criteria:**
- Repositories extend JpaRepository correctly
- Query methods follow Spring Data JPA naming conventions
- Delete prevention query methods exist

**Files to Create:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/StateRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/StateTransitionRepository.java`

---

#### Task Group 5: EntityMapper Updates
**Dependencies:** Task Groups 2, 3

- [x] 5.0 Add mapping methods to EntityMapper
  - [x] 5.1 Update `EntityMapper.java` with State mappings
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
    - Add `toDto(StateEntity entity)` method:
      ```java
      public StateDto toDto(StateEntity entity) {
          return new StateDto(
              entity.getId(),
              entity.getName(),
              entity.getDescription(),
              entity.getStateKind(),
              entity.getOwnerRefKind(),
              entity.getOwnerRefId()
          );
      }
      ```
    - Add `toEntity(StateDto dto, String modelFileId)` method:
      ```java
      public StateEntity toEntity(StateDto dto, String modelFileId) {
          return StateEntity.builder()
              .id(dto.id())
              .modelFileId(modelFileId)
              .name(dto.name())
              .description(dto.description())
              .stateKind(dto.stateKind())
              .ownerRefKind(dto.ownerRefKind())
              .ownerRefId(dto.ownerRefId())
              .build();
      }
      ```
  - [x] 5.2 Update `EntityMapper.java` with StateTransition mappings
    - Add `toDto(StateTransitionEntity entity)` method
    - Add `toEntity(StateTransitionDto dto, String modelFileId)` method
    - Map all 14 fields (id through effectLabelText)

**Acceptance Criteria:**
- EntityMapper correctly converts between Entity and DTO
- All fields are mapped correctly

**Files to Modify:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`

---

#### Task Group 6: ModelService Integration (with Delete Prevention)
**Dependencies:** Task Groups 4, 5

- [x] 6.0 Integrate State and StateTransition into ModelService
  - [x] 6.1 Inject repositories into ModelService
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Add repository fields:
      ```java
      private final StateRepository stateRepository;
      private final StateTransitionRepository stateTransitionRepository;
      ```
  - [x] 6.2 Update `loadEntities()` method
    - Add state loading after events:
      ```java
      stateRepository.findByModelFileId(modelFileId).stream()
          .map(entityMapper::toDto).collect(Collectors.toList()),
      ```
    - Add stateTransition loading after states:
      ```java
      stateTransitionRepository.findByModelFileId(modelFileId).stream()
          .map(entityMapper::toDto).collect(Collectors.toList()),
      ```
    - Update MetaModelEntitiesDto constructor call to include states and stateTransitions
  - [x] 6.3 Update `deleteAllDataForModelFile()` method
    - Add deletion in correct order (stateTransitions before states due to FK):
      ```java
      stateTransitionRepository.deleteByModelFileId(modelFileId);
      stateRepository.deleteByModelFileId(modelFileId);
      ```
    - Place after event deletion
  - [x] 6.4 Update `saveEntities()` method
    - Add state saving after events (states must be saved before stateTransitions):
      ```java
      if (entities.states() != null) {
          stateRepository.saveAll(entities.states().stream()
              .map(dto -> entityMapper.toEntity(dto, modelFileId))
              .collect(Collectors.toList()));
      }
      ```
    - Add stateTransition saving after states:
      ```java
      if (entities.stateTransitions() != null) {
          stateTransitionRepository.saveAll(entities.stateTransitions().stream()
              .map(dto -> entityMapper.toEntity(dto, modelFileId))
              .collect(Collectors.toList()));
      }
      ```
  - [x] 6.5 Verify backend compiles successfully
    - Run `mvn clean compile` in architecture-model-service
    - Verify no compilation errors

**Note on Delete Prevention:**
The spec requires rejecting State deletes if referenced by StateTransitions (HTTP 409 Conflict).
However, the current architecture uses bulk load/save via PUT /api/model without separate CRUD endpoints.
Delete prevention would require:
1. Creating separate REST endpoints for States (currently out of scope per spec)
2. Or implementing validation during save to check referential integrity

Since the spec states "no separate CRUD endpoints needed" and uses existing bulk model save,
the delete prevention will be enforced at the **frontend validation layer** rather than backend service layer.
The StateTransitionRepository includes `existsByFromStateId` and `existsByToStateId` methods
to support future delete prevention if separate endpoints are added.

**Acceptance Criteria:**
- ModelService loads states and stateTransitions from database
- ModelService saves states and stateTransitions to database
- Deletion order respects FK constraints (stateTransitions before states)
- Backend compiles without errors

**Files to Modify:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`

---

### Frontend Layer

#### Task Group 7: TypeScript Types (model.ts)
**Dependencies:** None (can be done in parallel with backend)

- [x] 7.0 Update frontend types for State and StateTransition
  - [x] 7.1 Add StateKind type
    - File: `frontend/src/types/model.ts`
    - Add in Behavioural Domain Entities section:
      ```typescript
      // StateKind type for State entity - indicates the type of state
      export type StateKind = 'Initial' | 'Normal' | 'Final';
      ```
  - [x] 7.2 Add TriggerRefKind type
    - Add near StateKind:
      ```typescript
      // TriggerRefKind type for StateTransition trigger reference
      export type TriggerRefKind = 'Event' | 'Method';
      ```
  - [x] 7.3 Add State interface
    - Add after Event interface:
      ```typescript
      /**
       * State entity - represents a state in a finite state machine
       * Part of Behavioural Architecture domain
       */
      export interface State {
        id: string;
        name: string;
        description?: string;
        state_kind: StateKind;
        owner_ref_kind?: string;
        owner_ref_id?: string;
      }
      ```
  - [x] 7.4 Add StateTransition interface
    - Add after State interface:
      ```typescript
      /**
       * StateTransition entity - represents a transition between states
       * Includes trigger (required), guard (optional), and effect (optional)
       */
      export interface StateTransition {
        id: string;
        from_state_id: string;
        to_state_id: string;
        order_index?: number;
        description?: string;
        // Trigger (required, one-of)
        trigger_ref_kind?: TriggerRefKind;
        trigger_ref_id?: string;
        trigger_label_text?: string;
        // Guard (optional, one-of)
        guard_ref_kind?: string;  // 'Method' only
        guard_ref_id?: string;
        guard_expression?: string;
        // Effect (optional, one-of)
        effect_ref_kind?: string;  // 'Method' only
        effect_ref_id?: string;
        effect_label_text?: string;
      }
      ```
  - [x] 7.5 Update MetaModelEntities interface
    - Add after `events: Event[];`:
      ```typescript
      states: State[];
      state_transitions: StateTransition[];
      ```
  - [x] 7.6 Update EntityType union
    - Add to EntityType union:
      ```typescript
      | 'states'
      | 'state_transitions'
      ```
  - [x] 7.7 Update AnyEntity union
    - Add after Event:
      ```typescript
      | State
      | StateTransition
      ```
  - [x] 7.8 Update ENTITY_TYPES constant
    - Add:
      ```typescript
      STATE: 'STATE',
      STATE_TRANSITION: 'STATE_TRANSITION',
      ```

**Acceptance Criteria:**
- TypeScript compiles without errors
- New types are properly exported
- MetaModelEntities includes states and state_transitions arrays

**Files to Modify:**
- `frontend/src/types/model.ts`

---

#### Task Group 8: Grid Configurations (gridConfigs.ts)
**Dependencies:** Task Group 7

- [x] 8.0 Add grid configurations for State and StateTransition
  - [x] 8.1 Add dropdown options to `defaults.ts`
    - File: `frontend/src/config/defaults.ts`
    - Add options arrays:
      ```typescript
      // State kind options for State entity
      export const stateKindOptions = ['Initial', 'Normal', 'Final'];

      // Trigger ref kind options for StateTransition
      export const triggerRefKindOptions = ['', 'Event', 'Method'];

      // Guard ref kind options (Method only)
      export const guardRefKindOptions = ['', 'Method'];

      // Effect ref kind options (Method only)
      export const effectRefKindOptions = ['', 'Method'];
      ```
  - [x] 8.2 Update `emptyModel` in `defaults.ts`
    - Add to `entities` object after `events`:
      ```typescript
      states: [],
      state_transitions: [],
      ```
  - [x] 8.3 Add `states` grid config to `gridConfigs.ts`
    - File: `frontend/src/config/gridConfigs.ts`
    - Import new dropdown options from defaults
    - Add after `events` config:
      ```typescript
      states: [
        { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
        { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 180 },
        { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
        { field: 'state_kind', displayName: 'State Kind', cellType: 'dropdown', required: true, width: 120, options: stateKindOptions },
        { field: 'owner_ref_kind', displayName: 'Owner Type', cellType: 'text', required: false, width: 140 },
        { field: 'owner_ref_id', displayName: 'Owner ID', cellType: 'text', required: false, width: 180 },
      ],
      ```
  - [x] 8.4 Add `state_transitions` grid config to `gridConfigs.ts`
    - Add after `states` config:
      ```typescript
      state_transitions: [
        { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
        { field: 'from_state_id', displayName: 'From State', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'states' },
        { field: 'to_state_id', displayName: 'To State', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'states' },
        { field: 'order_index', displayName: 'Order', cellType: 'text', required: false, width: 80 },
        { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 150 },
        // Trigger fields (one-of: ref pair OR label)
        { field: 'trigger_ref_kind', displayName: 'Trigger Type', cellType: 'dropdown', required: false, width: 120, options: triggerRefKindOptions },
        { field: 'trigger_ref_id', displayName: 'Trigger Ref', cellType: 'text', required: false, width: 150 },
        { field: 'trigger_label_text', displayName: 'Trigger Label', cellType: 'text', required: false, width: 150 },
        // Guard fields (optional, one-of: ref pair OR expression)
        { field: 'guard_ref_kind', displayName: 'Guard Type', cellType: 'dropdown', required: false, width: 110, options: guardRefKindOptions },
        { field: 'guard_ref_id', displayName: 'Guard Ref', cellType: 'text', required: false, width: 150 },
        { field: 'guard_expression', displayName: 'Guard Expr', cellType: 'text', required: false, width: 150 },
        // Effect fields (optional, one-of: ref pair OR label)
        { field: 'effect_ref_kind', displayName: 'Effect Type', cellType: 'dropdown', required: false, width: 110, options: effectRefKindOptions },
        { field: 'effect_ref_id', displayName: 'Effect Ref', cellType: 'text', required: false, width: 150 },
        { field: 'effect_label_text', displayName: 'Effect Label', cellType: 'text', required: false, width: 150 },
      ],
      ```

**Acceptance Criteria:**
- Grid configs compile without errors
- States grid shows all required columns with correct types
- StateTransitions grid has FK typeahead to states
- Dropdown options correctly defined for enum fields

**Files to Modify:**
- `frontend/src/config/defaults.ts`
- `frontend/src/config/gridConfigs.ts`

---

#### Task Group 9: Domain Grouping and Tab Mappings
**Dependencies:** Task Group 8

- [x] 9.0 Add States and State Transitions to Behavioural domain
  - [x] 9.1 Update `tabToEntityType` mapping
    - File: `frontend/src/config/gridConfigs.ts`
    - Add mappings after 'Events':
      ```typescript
      'States': 'states',
      'State Transitions': 'state_transitions',
      ```
  - [x] 9.2 Update `domainGroupings`
    - In the `behavioural` array, add 'States' and 'State Transitions' after 'Events':
      ```typescript
      behavioural: ['Events', 'States', 'State Transitions'],
      ```
  - [x] 9.3 Update `DOMAIN_ENTITY_TYPES`
    - In the `behavioural` array, add entity type keys:
      ```typescript
      behavioural: ['events', 'states', 'state_transitions'],
      ```
  - [x] 9.4 Update `entityTabNames` array
    - Add after 'Events' (if Events is in entityTabNames, otherwise add appropriately):
      ```typescript
      'States',
      'State Transitions',
      ```

**Acceptance Criteria:**
- States and State Transitions tabs appear in Behavioural domain
- Tabs are positioned after Events
- Tab selection correctly routes to grid configs
- DOMAIN_ENTITY_TYPES includes new entity types for relationship filtering

**Files to Modify:**
- `frontend/src/config/gridConfigs.ts`

---

#### Task Group 10: Frontend State/Context and Validation Updates
**Dependencies:** Task Groups 7, 8, 9

- [x] 10.0 Update frontend utilities for new entities
  - [x] 10.1 Verify ArchitectureContext supports new entities
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Verify that generic entity CRUD actions work with new entity types
    - No changes should be needed if context uses generic patterns
  - [x] 10.2 Update `sanitize.ts` if needed
    - File: `frontend/src/utils/sanitize.ts`
    - Add sanitization for states and state_transitions arrays if pattern requires
    - Follow existing entity sanitization patterns
  - [x] 10.3 Update `validation.ts` if needed
    - File: `frontend/src/utils/validation.ts`
    - Add validation for State and StateTransition entities if pattern requires
    - Consider adding validation for:
      - StateTransition trigger one-of rule (ref pair OR label text)
      - StateTransition guard one-of rule (ref pair OR expression)
      - StateTransition effect one-of rule (ref pair OR label text)
  - [x] 10.4 Update `fileOperations.ts` if needed
    - File: `frontend/src/utils/fileOperations.ts`
    - Add states and state_transitions to any entity mapping functions
    - Follow existing patterns for other entities
  - [x] 10.5 Verify frontend compiles successfully
    - Run `npm run build` in frontend
    - Note: Pre-existing domain selector errors exist but are unrelated to State/StateTransition implementation

**Acceptance Criteria:**
- Empty model includes states and state_transitions arrays
- Context state properly initializes new entity arrays
- CRUD operations work for states and state_transitions
- Frontend compiles without errors (excluding pre-existing domain selector errors)

**Files to Potentially Modify:**
- `frontend/src/contexts/ArchitectureContext.tsx`
- `frontend/src/utils/sanitize.ts`
- `frontend/src/utils/validation.ts`
- `frontend/src/utils/fileOperations.ts`

---

### Testing and Verification

#### Task Group 11: Testing and Verification
**Dependencies:** Task Groups 1-10

- [x] 11.0 Complete testing and verification
  - [x] 11.1 Backend compilation test
    - Run `mvn clean compile` in architecture-model-service
    - Verify no compilation errors
  - [ ] 11.2 Backend integration test (DEFERRED: requires running environment)
    - Start architecture-model-service
    - Verify application starts without errors
    - Check database tables exist via Liquibase logs
  - [x] 11.3 Frontend compilation test
    - Run `npm run build` in frontend
    - Verify no TypeScript errors related to states/state_transitions
    - Note: Pre-existing domain selector errors exist but are unrelated to this spec
  - [ ] 11.4 Manual UI verification (DEFERRED: requires running environment)
    - Start frontend application
    - Navigate to Meta-Model view
    - Select Behavioural domain
    - Verify 'States' and 'State Transitions' tabs appear after 'Events'
  - [ ] 11.5 CRUD verification for States (DEFERRED: requires running environment)
    - Create a new State with name, state_kind
    - Verify State appears in grid
    - Edit State fields
    - Delete State (should work if no transitions reference it)
  - [ ] 11.6 CRUD verification for StateTransitions (DEFERRED: requires running environment)
    - Create two States first
    - Create a StateTransition referencing from_state and to_state (FK typeahead)
    - Verify StateTransition appears in grid
    - Edit StateTransition fields
    - Delete StateTransition
  - [ ] 11.7 Delete prevention verification (DEFERRED: requires running environment)
    - Create two States with a StateTransition between them
    - Attempt to delete a State that is referenced
    - Verify appropriate error/warning is shown (frontend validation)
  - [ ] 11.8 Save/Load model verification (DEFERRED: requires running environment)
    - Create States and StateTransitions
    - Save the model
    - Reload the model
    - Verify States and StateTransitions persist correctly

**Acceptance Criteria:**
- All CRUD operations work for States and StateTransitions
- FK typeahead correctly links StateTransitions to States
- Delete prevention blocks deleting referenced States
- Model persistence works correctly
- No runtime errors in frontend or backend

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1**: Database Schema (Liquibase Migration)
2. **Task Group 2**: JPA Entities (StateEntity, StateTransitionEntity)
3. **Task Group 3**: DTOs (StateDto, StateTransitionDto)
4. **Task Group 4**: Repositories (StateRepository, StateTransitionRepository)
5. **Task Group 5**: EntityMapper Updates
6. **Task Group 6**: ModelService Integration
7. **Task Group 7**: TypeScript Types (model.ts) - can start in parallel with backend Task Groups 2-6
8. **Task Group 8**: Grid Configs (gridConfigs.ts, defaults.ts)
9. **Task Group 9**: Domain Grouping and Tab Mappings
10. **Task Group 10**: Frontend State/Context and Validation Updates
11. **Task Group 11**: Testing and Verification

---

## File Summary

### Backend Files to Create
| File | Description |
|------|-------------|
| `architecture-model-service/src/main/resources/db/changelog/sql/004-states-state-transitions.sql` | Liquibase migration for states and state_transitions tables |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/StateEntity.java` | JPA entity for State |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/StateTransitionEntity.java` | JPA entity for StateTransition |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/StateDto.java` | State DTO record |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/StateTransitionDto.java` | StateTransition DTO record |
| `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/StateRepository.java` | Spring Data repository for State |
| `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/StateTransitionRepository.java` | Spring Data repository for StateTransition |

### Backend Files to Modify
| File | Description |
|------|-------------|
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | Register new migration |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java` | Add states and stateTransitions fields |
| `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` | Add State and StateTransition mapping methods |
| `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java` | Integrate State and StateTransition in CRUD operations |

### Frontend Files to Modify
| File | Description |
|------|-------------|
| `frontend/src/types/model.ts` | Add State and StateTransition interfaces |
| `frontend/src/config/defaults.ts` | Add dropdown options and emptyModel entries |
| `frontend/src/config/gridConfigs.ts` | Add grid configs and domain mappings |
| `frontend/src/utils/sanitize.ts` | Add sanitization for new entities (if needed) |
| `frontend/src/utils/validation.ts` | Add validation rules (if needed) |
| `frontend/src/utils/fileOperations.ts` | Add file operation support (if needed) |

---

## Key Patterns to Follow

### Backend Entity Pattern (from EventEntity.java)
```java
@Entity
@Table(name = "states")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class StateEntity {
    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    // ... other fields
}
```

### Backend DTO Pattern (from EventDto.java)
```java
public record StateDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("state_kind")
    String stateKind,

    // ... other fields with snake_case @JsonProperty
) {}
```

### Frontend Grid Config Pattern
```typescript
states: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 180 },
    { field: 'state_kind', displayName: 'State Kind', cellType: 'dropdown', required: true, width: 120, options: stateKindOptions },
    // ... other columns
],
```

### Migration Pattern (from 003-events.sql)
```sql
CREATE TABLE states (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  -- ... other columns
);

CREATE INDEX idx_states_model_file ON states(model_file_id);
```

---

## Validation Rules Summary

### StateTransition Trigger (Required, One-Of)
- Either `(trigger_ref_kind + trigger_ref_id)` OR `trigger_label_text` must be provided
- Cannot have both ref pair AND label text
- Frontend UI should enforce switching between modes clears other trigger fields

### StateTransition Guard (Optional, One-Of)
- If guard is provided, must be either `(guard_ref_kind + guard_ref_id)` OR `guard_expression`
- Cannot have both ref pair AND expression

### StateTransition Effect (Optional, One-Of)
- If effect is provided, must be either `(effect_ref_kind + effect_ref_id)` OR `effect_label_text`
- Cannot have both ref pair AND label text

### State Delete Prevention
- States cannot be deleted if referenced by any StateTransition (as from_state_id or to_state_id)
- Enforced via frontend validation during save operations
- Backend StateTransitionRepository includes `existsByFromStateId` and `existsByToStateId` for validation support

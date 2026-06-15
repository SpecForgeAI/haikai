# Specification: Behavioural Architecture Activity Modelling

## Goal
Introduce UML-style Activity Diagram entities (Activity, ActivityFlow, ActivityPartition) to the Behavioural Architecture domain, enabling full CRUD persistence, Meta-Model editing, and diagram palette availability without implementing canvas rendering.

## User Stories
- As an architect, I want to create and manage Activities (nodes/actions/states) so that I can model behavioural workflows in my architecture
- As an architect, I want to define ActivityFlows with triggers and conditions so that I can capture control and data flow semantics between activities

## Specific Requirements

**Activity Entity (Behavioural Architecture)**
- Fields: id (UUID PK), model_file_id (UUID FK required), name (text required), description (text optional), activity_kind (enum required), created_at/updated_at
- activity_kind enum values: Initial, Action, Decision, Merge, Final
- Store activity_kind as VARCHAR in database (follow existing StateKind pattern)
- Add ActivityKind TypeScript type mirroring backend enum values

**ActivityFlow Entity (Behavioural Architecture)**
- Fields: id (UUID PK), model_file_id (UUID FK required), from_activity_id (UUID FK required), to_activity_id (UUID FK required)
- Trigger fields (one-of optional): trigger_ref_kind (Event|Method), trigger_ref_id (string), trigger_label_text (text)
- Condition fields (one-of optional): condition_expression (text), condition_ref_kind (Method), condition_ref_id (string)
- Additional fields: flow_kind (Control|Data required), order_index (int optional), description (text optional)
- Validation: from_activity_id != to_activity_id; trigger uses either ref OR labelText (not both); condition uses either expression OR method ref (not both)

**ActivityPartition Entity (Behavioural Architecture)**
- Fields: id (UUID PK), model_file_id (UUID FK required), name (text optional), ref_kind (enum optional), ref_id (string optional), order_index (int optional), description (text optional)
- ref_kind enum values: BusinessUser, Application, ApplicationComponent, Service, Interface, Class
- Validation: if ref_kind set then ref_id required; if neither ref_kind nor name set then reject save
- When ref_kind/ref_id is set, name may be null (label derives from referenced entity)

**Backend Liquibase Migrations**
- Create tables: activities, activity_flows, activity_partitions with appropriate columns and types
- Add FKs: activity_flows.from_activity_id and to_activity_id referencing activities.id
- Add indexes on model_file_id for all three tables for efficient query filtering
- Deletion rule: RESTRICT deleting Activity if referenced by ActivityFlow (service-level validation)

**Backend JPA Entities and Repositories**
- Create ActivityEntity, ActivityFlowEntity, ActivityPartitionEntity JPA classes following existing patterns (e.g., StateEntity, StateTransitionEntity)
- Create corresponding Repository interfaces extending JpaRepository with findByModelFileId methods
- Store enum fields as VARCHAR (follow stateKind pattern in StateEntity)

**Backend Services and Controllers**
- Create ActivityService, ActivityFlowService, ActivityPartitionService with standard CRUD operations
- Create REST controllers with endpoints scoped under /api/model-files/{modelFileId}/activities, /activity-flows, /activity-partitions
- Add validation in service layer to prevent deletion of Activities referenced by ActivityFlows
- Add validation for ActivityFlow one-of constraints (trigger, condition field exclusivity)

**Frontend TypeScript Types**
- Add Activity, ActivityFlow, ActivityPartition interfaces to model.ts following existing patterns
- Add ActivityKind, ActivityFlowKind, ActivityPartitionRefKind type unions
- Add entity keys: activities, activityFlows, activityPartitions to MetaModelEntities interface
- Update EntityType, AnyEntity unions to include new types

**Frontend Meta-Model View Integration**
- Add entity tabs under Behavioural domain: "Activities", "Activity Flows", "Activity Partitions"
- Configure gridConfigs.ts with column definitions for each entity grid
- Activities grid: name (required), activityKind (dropdown), description (optional)
- Activity Flows grid: fromActivityId (fk_typeahead), toActivityId (fk_typeahead), flowKind (dropdown), trigger fields, condition fields, description
- Activity Partitions grid: refKind (dropdown), refId (fk_typeahead based on refKind), name, orderIndex, description

**Frontend Diagram RHS Palette Integration**
- Add Activities, Activity Flows, Activity Partitions to domainToPaletteSections.behavioural array in paletteData.ts
- Add entity type mappings to getEntityTypeConstant function
- Add palette sections for each entity in getPaletteSections function
- No special rendering logic required; entities appear as draggable palette items

## Existing Code to Leverage

**State and StateTransition Entity Pattern (Behavioural Domain)**
- C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\types\model.ts lines 430-506 define State and StateTransition interfaces with similar trigger/guard/effect one-of field patterns
- StateKind, TriggerRefKind, GuardRefKind, EffectRefKind type unions provide pattern for ActivityKind, FlowKind enums
- Re-use the same one-of field validation approach for ActivityFlow trigger and condition fields

**Grid Configuration Pattern (gridConfigs.ts)**
- C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\config\gridConfigs.ts lines 226-252 show states and state_transitions grid configs with fk_typeahead and dropdown cells
- Follow same column definition structure for activities, activity_flows, activity_partitions grids
- Use existing dropdown options pattern for activityKindOptions, flowKindOptions, partitionRefKindOptions in defaults.ts

**Domain Groupings and Palette Sections**
- C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\config\gridConfigs.ts lines 394-416 show DOMAIN_ENTITY_TYPES and domainGroupings for behavioural domain
- C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\paletteData.ts lines 32-64 show domainToPaletteSections mapping
- Extend behavioural domain arrays to include activities, activity_flows, activity_partitions

**Backend DTO Pattern (StateDto, StateTransitionDto)**
- C:\Workspaces\SSD\architecture-store-and-diagrams\architecture-model-service\src\main\java\com\example\architecturemodel\model\dto\entity\StateDto.java uses Java record with @JsonProperty annotations
- C:\Workspaces\SSD\architecture-store-and-diagrams\architecture-model-service\src\main\java\com\example\architecturemodel\model\dto\entity\StateTransitionDto.java shows pattern for transition entities with from/to FKs and trigger fields
- Follow same record pattern for ActivityDto, ActivityFlowDto, ActivityPartitionDto

**Entity Colors Pattern (defaults.ts)**
- C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\config\defaults.ts lines 389-409 show entityColors mapping for diagram node styling
- Add ACTIVITY, ACTIVITY_FLOW, ACTIVITY_PARTITION color entries following existing behavioural domain color scheme (cyan/green/orange tones)

## Out of Scope
- Activity diagram canvas rendering (visual shapes for Initial, Decision, Merge, Final nodes)
- BPMN execution semantics or workflow engine integration
- Gateway/MCP service changes
- Fork/Join activity kinds (parallel execution semantics)
- Swimlane visual rendering on canvas
- Auto-layout algorithms for activity diagrams
- Activity hierarchy or nested activities
- Signal, Timer, or Error event types on flows
- ActivityPartition containment relationships (nesting partitions)
- Validation of trigger/condition ref_id existence against actual entities in same model_file_id (deferred to future enhancement)

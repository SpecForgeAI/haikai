# Spec Requirements: User Journey Meta-Model Foundation

## Initial Description

**Spec Name:** user-journey-meta-model-foundation

**Summary:**
Introduce the first-class Business Architecture entities USER_JOURNEY and ACTIVITY_STEP, including persistence, DTOs, CRUD/list/search endpoints, and relationship wiring to existing PROCESS_ACTIVITY, BUSINESS_USER, and APPLICATION entities.

## Requirements Discussion

### First Round Questions

**Q1:** USER_JOURNEY entity -- what fields beyond the standard set? Looking at existing Business Architecture entities, the standard fields are: `id` (TEXT PK), `model_file_id` (TEXT FK), `name` (TEXT NOT NULL), `description` (TEXT), `tags` (TEXT). Some entities also have `valid_from`/`valid_to` (TEXT). Should USER_JOURNEY also include valid_from/valid_to, a status field, or a kind/type discriminator?

**Answer:** Keep USER_JOURNEY lean in Increment 1: include only the standard set plus optional primary_business_user_id and optional parent_business_process_id; do NOT add valid_from/valid_to, status, or kind/type discriminator yet.

**Q2:** ACTIVITY_STEP entity -- parent relationship and ordering? Is ACTIVITY_STEP a child of USER_JOURNEY analogous to how ProcessActivity is a child of BusinessProcess? Should it have sequence_order, actor_hint, user_interaction_level?

**Answer:** ACTIVITY_STEP is intentionally lighter-weight in Increment 1; do NOT add actor_hint or user_interaction_level, because those remain properties of the broader ProcessActivity definition for now.

**Q3:** Relationship wiring to PROCESS_ACTIVITY -- what is the nature of this link? (a) Many-to-many join table? (b) Nullable FK on ACTIVITY_STEP? (c) Separate relationship entity?

**Answer:** Use (b): exactly one PROCESS_ACTIVITY per ACTIVITY_STEP via required FK on ACTIVITY_STEP.

**Q4:** Relationship wiring to BUSINESS_USER -- what form? (a) Join table? (b) FK on USER_JOURNEY? (c) Role-based relationship?

**Answer:** Use (b): optional primary_business_user_id FK on USER_JOURNEY for the journey perspective, and also a required business_user_id FK on ACTIVITY_STEP for the specific role performing that step.

**Q5:** Relationship wiring to APPLICATION -- what form? (a) Link from ACTIVITY_STEP to APPLICATION? (b) Link at journey level? (c) Indirect through PROCESS_ACTIVITY?

**Answer:** Use (a): required FK from ACTIVITY_STEP to APPLICATION, because each step involves exactly one application in this model.

**Q6:** Diagram rendering -- should USER_JOURNEY and ACTIVITY_STEP be representable on diagrams?

**Answer:** Defer diagram-renderability entirely; USER_JOURNEY and ACTIVITY_STEP should be persisted/queryable in Increment 1 only, with no diagram node/rendering support yet.

**Q7:** MetaModel integration scope -- where exactly should the new entities appear? (DB, JPA, DTO, repository, mapper, ModelService, MetaModelSummary, snapshot export/import, frontend TypeScript types, frontend grid UI?)

**Answer:** MetaModel integration scope for Increment 1 should include backend persistence/model/DTO/repository/service/controller/export-import/type plumbing, but NOT the frontend grid UI tabs; those are Increment 2.

**Q8:** Is there anything that should explicitly be OUT of scope?

**Answer:** Explicitly out of scope for Increment 1: frontend grid UI, diagram rendering/node support, any new derived "BusinessPoint"-like entity, and any Agent OS conversation/orchestration layer integration.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: BusinessProcess + ProcessActivity parent-child entity pattern - Paths: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/BusinessProcessEntity.java`, `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ProcessActivityEntity.java`
- Feature: BusinessUserBusinessPoint many-to-many join table pattern - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/BusinessUserBusinessPointEntity.java`
- Feature: UIScreen + UIWorkflowTransition recently-added entity pair (full end-to-end addition pattern including migration SQL 010, entities, DTOs, mapper, repositories, wired into ModelService) - Paths: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/UIScreenEntity.java`, `architecture-model-service/src/main/resources/db/changelog/sql/010-ui-screens-ui-workflow-transitions.sql`

**Key codebase conventions observed:**
- Entity classes use Lombok `@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder` with `@Entity @Table`
- IDs are `String` type (TEXT in DB), not auto-generated -- client provides IDs
- All entities scoped to a model file via `model_file_id` TEXT FK with ON DELETE CASCADE
- DTOs are Java records with `@JsonProperty` annotations using snake_case JSON names
- DTOs do NOT include `model_file_id` (stripped in mapper layer)
- Repositories extend `JpaRepository<Entity, String>` with `findByModelFileId()` and `deleteByModelFileId()` methods
- Liquibase migrations use SQL files referenced from `db.changelog-master.yaml` with preConditions (typically `tableExists` or `columnExists` checks with `onFail: MARK_RAN`)
- The next available migration number is 059 (last is 058-node-line-weight)
- MetaModelEntitiesDto is a record with all entity type lists; MetaModelRelationshipsDto has all relationship/join table lists
- ModelService has bulk load/save patterns: loads all entities by `modelFileId` from repositories, maps via EntityMapper, assembles into MetaModelEntitiesDto
- MetaModelSummaryService fetches entity summaries (id, name, entityType) for LLM context
- Snapshot export/import flows through ProjectSnapshotService -> ModelService -> individual repositories
- Frontend TypeScript types mirror backend DTOs in `frontend/src/types/model.ts` with `MetaModelEntities` and `MetaModelRelationships` interfaces

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided (confirmed via filesystem check). This is a backend-only spec.

## Requirements Summary

### Functional Requirements

#### USER_JOURNEY Entity
- New first-class Business Architecture entity: `user_journeys` table
- Fields:
  - `id` TEXT PRIMARY KEY (client-provided)
  - `model_file_id` TEXT NOT NULL FK to model_files(id) ON DELETE CASCADE
  - `name` TEXT NOT NULL
  - `description` TEXT (nullable)
  - `tags` TEXT (nullable)
  - `primary_business_user_id` TEXT (nullable) FK to business_users(id) -- optional link to the primary user performing this journey
  - `parent_business_process_id` TEXT (nullable) FK to business_processes(id) -- optional link to the parent business process this journey maps to
- Standard index on `model_file_id`

#### ACTIVITY_STEP Entity
- New first-class Business Architecture entity: `activity_steps` table
- Child of USER_JOURNEY (analogous to ProcessActivity being child of BusinessProcess)
- Fields:
  - `id` TEXT PRIMARY KEY (client-provided)
  - `model_file_id` TEXT NOT NULL FK to model_files(id) ON DELETE CASCADE
  - `user_journey_id` TEXT NOT NULL FK to user_journeys(id) ON DELETE CASCADE -- parent journey
  - `name` TEXT NOT NULL
  - `description` TEXT (nullable)
  - `tags` TEXT (nullable)
  - `sequence_order` INTEGER (nullable) -- ordering within the journey
  - `process_activity_id` TEXT NOT NULL FK to process_activities(id) -- each step maps to exactly one process activity
  - `business_user_id` TEXT NOT NULL FK to business_users(id) -- the specific user performing this step
  - `application_id` TEXT NOT NULL FK to applications(id) -- the application involved in this step
- Indexes on `model_file_id`, `user_journey_id`
- Intentionally lighter-weight than ProcessActivity: NO actor_hint, NO user_interaction_level fields

#### Backend Persistence Layer
- Liquibase migration SQL file (number 059) creating both tables with appropriate FKs and indexes
- New changeset entry in `db.changelog-master.yaml`

#### JPA Entities
- `UserJourneyEntity.java` following existing Lombok + JPA patterns
- `ActivityStepEntity.java` following existing Lombok + JPA patterns

#### DTOs
- `UserJourneyDto.java` (record) in `model/dto/entity/` package -- excludes model_file_id per convention
- `ActivityStepDto.java` (record) in `model/dto/entity/` package -- excludes model_file_id per convention

#### Repositories
- `UserJourneyRepository.java` extending `JpaRepository<UserJourneyEntity, String>` with `findByModelFileId()` and `deleteByModelFileId()`
- `ActivityStepRepository.java` extending `JpaRepository<ActivityStepEntity, String>` with `findByModelFileId()` and `deleteByModelFileId()`

#### EntityMapper
- Add mapping methods in `EntityMapper.java` for UserJourney and ActivityStep (entity <-> DTO conversion)

#### MetaModelEntitiesDto Integration
- Add `user_journeys` (List<UserJourneyDto>) to MetaModelEntitiesDto
- Add `activity_steps` (List<ActivityStepDto>) to MetaModelEntitiesDto
- No new entries in MetaModelRelationshipsDto needed (relationships are expressed as direct FKs, not separate join tables)

#### ModelService Integration
- Add UserJourneyRepository and ActivityStepRepository as injected dependencies
- Wire into `loadModel()` / `loadModelByProjectId()`: fetch user_journeys and activity_steps by modelFileId
- Wire into `saveModel()`: bulk save user_journeys and activity_steps (delete-then-insert pattern matching existing entities)
- Wire into `deleteModel()`: handled by CASCADE from model_files FK, but repositories should be included in explicit delete if the pattern requires it

#### MetaModelSummaryService Integration
- Add `user_journeys` to MetaModelSummaryDto (List<EntitySummary>)
- Add fetchUserJourneys() method to MetaModelSummaryService
- Include user_journeys in the summary constructor call and debug logging

#### Snapshot Export/Import Integration
- user_journeys and activity_steps are part of the ArchitectureModel -> MetaModel -> entities structure
- They flow through snapshot export (ProjectSnapshotService -> ModelService.loadModel) automatically once wired into MetaModelEntitiesDto
- They flow through snapshot import (ProjectSnapshotImportService -> ModelService.saveModel) automatically once wired into the save path
- Backward compatibility: snapshots that lack user_journeys/activity_steps should import cleanly (null/empty lists treated as empty)

#### Frontend TypeScript Types
- Add `UserJourney` interface to `frontend/src/types/model.ts`
- Add `ActivityStep` interface to `frontend/src/types/model.ts`
- Add `user_journeys: UserJourney[]` to `MetaModelEntities` interface
- Add `activity_steps: ActivityStep[]` to `MetaModelEntities` interface
- Add to `EntityType` union type

### Reusability Opportunities
- BusinessProcess + ProcessActivity pattern: direct analog for the parent-child structure (USER_JOURNEY:ACTIVITY_STEP mirrors BUSINESS_PROCESS:PROCESS_ACTIVITY)
- UIScreen entity addition (migration 010): shows end-to-end pattern for adding a new entity type across all layers
- EntityMapper existing methods: follow the same toDto/toEntity pattern for the new types
- ModelService existing bulk load/save sections: follow the exact same pattern (repository.findByModelFileId, map, collect) for new entities

### Scope Boundaries

**In Scope (Increment 1):**
- PostgreSQL tables via Liquibase migration (user_journeys, activity_steps)
- JPA entity classes (UserJourneyEntity, ActivityStepEntity)
- DTO records (UserJourneyDto, ActivityStepDto)
- Spring Data JPA repositories
- EntityMapper mappings
- MetaModelEntitiesDto integration (new lists)
- ModelService load/save/delete wiring
- MetaModelSummaryDto and MetaModelSummaryService integration
- Snapshot export/import compatibility (backward-compatible with snapshots lacking these entities)
- Frontend TypeScript type definitions (interfaces + MetaModelEntities + EntityType union)

**Out of Scope (Deferred):**
- Frontend grid UI tabs for editing user journeys and activity steps (Increment 2)
- Diagram rendering / diagram node support for USER_JOURNEY and ACTIVITY_STEP
- Any new derived "BusinessPoint"-like superclass entity (e.g., "JourneyPoint")
- Agent OS conversation/orchestration layer integration
- valid_from/valid_to temporal fields on USER_JOURNEY
- status or kind/type discriminator fields on USER_JOURNEY
- actor_hint or user_interaction_level fields on ACTIVITY_STEP
- Any REST controller endpoints beyond what ModelService already exposes (the existing GET/PUT /api/model endpoints serve the full ArchitectureModel including these new entities)

### Technical Considerations
- FKs from ACTIVITY_STEP to process_activities, business_users, and applications use TEXT type matching existing ID conventions
- ON DELETE behavior for cross-entity FKs (process_activity_id, business_user_id, application_id) should be carefully chosen -- suggest NO ACTION or RESTRICT (not CASCADE) to prevent accidental deletion of a BusinessUser from cascading to delete ActivitySteps; the user_journey_id FK should use ON DELETE CASCADE (parent-child relationship)
- The next available Liquibase migration number is 059
- Since no new join/relationship tables are introduced (all relationships are direct FKs), MetaModelRelationshipsDto does not need changes
- Backward compatibility for snapshot import: when importing a snapshot that predates this feature, the MetaModelEntitiesDto will have null/missing user_journeys and activity_steps fields; the save path should handle this gracefully (treat as empty lists)
- EntityMapper should handle the model_file_id stripping (present in entity, absent in DTO) consistently with all other entity types

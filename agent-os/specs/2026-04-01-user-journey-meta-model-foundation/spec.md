# Specification: User Journey Meta-Model Foundation

## Goal
Introduce two new first-class Business Architecture entities -- USER_JOURNEY and ACTIVITY_STEP -- with full backend persistence, DTO, mapper, repository, service, and summary integration, plus frontend TypeScript type definitions, enabling user journey data to be stored, loaded, exported, and imported alongside all existing meta-model entities.

## User Stories
- As an architect, I want to define User Journeys that map to Business Processes and Business Users so that I can model how specific users experience end-to-end business flows through applications.
- As an architect, I want each User Journey to contain ordered Activity Steps that reference existing Process Activities, Business Users, and Applications so that I can trace which systems and roles are involved at each step of a journey.

## Specific Requirements

**Liquibase Migration 059 -- user_journeys and activity_steps tables**
- Create file `sql/059-user-journeys-activity-steps.sql` with both CREATE TABLE statements, FKs, and indexes
- `user_journeys` table: `id` TEXT PK, `model_file_id` TEXT NOT NULL FK to `model_files(id)` ON DELETE CASCADE, `name` TEXT NOT NULL, `description` TEXT, `tags` TEXT, `primary_business_user_id` TEXT nullable FK to `business_users(id)` (NO ACTION on delete), `parent_business_process_id` TEXT nullable FK to `business_processes(id)` (NO ACTION on delete)
- `activity_steps` table: `id` TEXT PK, `model_file_id` TEXT NOT NULL FK to `model_files(id)` ON DELETE CASCADE, `user_journey_id` TEXT NOT NULL FK to `user_journeys(id)` ON DELETE CASCADE, `name` TEXT NOT NULL, `description` TEXT, `tags` TEXT, `sequence_order` INTEGER nullable, `process_activity_id` TEXT NOT NULL FK to `process_activities(id)` (NO ACTION on delete), `business_user_id` TEXT NOT NULL FK to `business_users(id)` (NO ACTION on delete), `application_id` TEXT NOT NULL FK to `applications(id)` (NO ACTION on delete)
- Indexes: `idx_user_journeys_model_file` on `user_journeys(model_file_id)`, `idx_activity_steps_model_file` on `activity_steps(model_file_id)`, `idx_activity_steps_user_journey` on `activity_steps(user_journey_id)`
- Add changeset entry in `db.changelog-master.yaml` with id `059-user-journeys-activity-steps`, preCondition `not: tableExists: user_journeys` with `onFail: MARK_RAN`
- Cross-entity FKs (process_activity_id, business_user_id, application_id) must use NO ACTION (not CASCADE) to prevent cascading deletes from referenced entities silently destroying activity steps

**UserJourneyEntity JPA entity**
- New file `model/entity/UserJourneyEntity.java` with `@Entity @Table(name = "user_journeys")` and standard Lombok annotations (`@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder`)
- Fields: `id` (String, @Id), `modelFileId` (String, not null), `name` (String, not null), `description` (String), `tags` (String), `primaryBusinessUserId` (String), `parentBusinessProcessId` (String)
- Follow exact pattern of `BusinessProcessEntity` -- all fields are simple `@Column` mapped Strings, no JPA relationship annotations

**ActivityStepEntity JPA entity**
- New file `model/entity/ActivityStepEntity.java` with same Lombok/JPA annotations as above
- Fields: `id` (String, @Id), `modelFileId` (String, not null), `userJourneyId` (String, not null), `name` (String, not null), `description` (String), `tags` (String), `sequenceOrder` (Integer), `processActivityId` (String, not null), `businessUserId` (String, not null), `applicationId` (String, not null)
- Follow exact pattern of `ProcessActivityEntity` -- parent FK stored as plain String, not a JPA @ManyToOne

**UserJourneyDto and ActivityStepDto records**
- `UserJourneyDto.java` in `model/dto/entity/` as a Java record with `@JsonProperty` snake_case annotations
- Fields: `id`, `name`, `description`, `tags`, `primary_business_user_id`, `parent_business_process_id` (no `model_file_id` per convention)
- `ActivityStepDto.java` in `model/dto/entity/` as a Java record with `@JsonProperty` snake_case annotations
- Fields: `id`, `user_journey_id`, `name`, `description`, `tags`, `sequence_order`, `process_activity_id`, `business_user_id`, `application_id` (no `model_file_id` per convention)

**UserJourneyRepository and ActivityStepRepository**
- `UserJourneyRepository.java` in `repository/entity/` extending `JpaRepository<UserJourneyEntity, String>` with `findByModelFileId(String)` and `deleteByModelFileId(String)` methods
- `ActivityStepRepository.java` in `repository/entity/` extending `JpaRepository<ActivityStepEntity, String>` with `findByModelFileId(String)` and `deleteByModelFileId(String)` methods
- Follow the exact interface pattern of `ProcessActivityRepository` and `UIScreenRepository`

**EntityMapper toDto/toEntity methods**
- Add `toDto(UserJourneyEntity)` returning `UserJourneyDto` and `toEntity(UserJourneyDto, String modelFileId)` returning `UserJourneyEntity` in the Business Domain section of `EntityMapper.java`
- Add `toDto(ActivityStepEntity)` returning `ActivityStepDto` and `toEntity(ActivityStepDto, String modelFileId)` returning `ActivityStepEntity`
- The `toEntity` methods must inject `modelFileId` via the builder (same as all other entity mappings) since DTOs do not carry `model_file_id`

**MetaModelEntitiesDto integration**
- Add `@JsonProperty("user_journeys") List<UserJourneyDto> userJourneys` to the `MetaModelEntitiesDto` record, positioned after the existing `package_set_default_rules` entry (end of the record)
- Add `@JsonProperty("activity_steps") List<ActivityStepDto> activitySteps` immediately after `userJourneys`
- No changes to `MetaModelRelationshipsDto` since all relationships are expressed as direct FKs on the entities, not via separate join tables

**ModelService load/save/delete wiring**
- Add `UserJourneyRepository` and `ActivityStepRepository` as constructor-injected final fields in ModelService (placed after existing entity repositories)
- In `loadEntities()`: add two new repository fetch lines at the end of the `MetaModelEntitiesDto` constructor call, following the `.findByModelFileId(modelFileId).stream().map(entityMapper::toDto).collect(Collectors.toList())` pattern
- In `createEmptyModel()`: add two additional `List.of()` arguments for `userJourneys` and `activitySteps` at the end of the MetaModelEntitiesDto constructor
- In `saveEntities()`: save `userJourneys` AFTER `businessUsers`, `businessProcesses`, and `processActivities` (FK dependencies); save `activitySteps` AFTER `userJourneys`, `processActivities`, `businessUsers`, and `applications` (FK dependencies). Use the standard null-check-then-saveAll pattern
- In `deleteAllDataForModelFile()`: delete `activitySteps` BEFORE `userJourneys` (child-first); delete `userJourneys` BEFORE `businessProcesses` and `businessUsers` (FK dependency). Place both deletes early in the entity deletion section, before the lines that delete `processActivities`, `businessProcesses`, and `businessUsers`

**MetaModelSummaryService and MetaModelSummaryDto integration**
- Add `UserJourneyRepository` as a constructor-injected dependency in `MetaModelSummaryService`
- Add a `fetchUserJourneys(String modelFileId)` private method following the exact pattern of `fetchUIScreens` -- returning `List<EntitySummary>` with entityType `"userJourneys"`
- Add `@JsonProperty("user_journeys") List<EntitySummary> userJourneys` to the `MetaModelSummaryDto` record (positioned after `uiScreens`, before `dataStoreCount`)
- Update `getMetaModelSummary()` to call `fetchUserJourneys(modelFileId)` and pass the result into the MetaModelSummaryDto constructor
- Update the debug log message to include `userJourneys` count

**Snapshot export/import backward compatibility**
- Export flows automatically once `loadEntities()` returns the new lists in MetaModelEntitiesDto -- no additional export code needed
- Import flows automatically once `saveEntities()` persists the new lists -- no additional import code needed
- Backward compatibility: when importing a snapshot that predates this feature, Jackson will deserialize missing `user_journeys` and `activity_steps` JSON fields as `null`; the `saveEntities()` null-checks (`if (entities.userJourneys() != null)`) handle this gracefully by skipping the save

**Frontend TypeScript type definitions**
- Add `UserJourney` interface to `frontend/src/types/model.ts` in the Business Domain section (after `BusinessProcess`): fields `id: string`, `name: string`, `description: string`, `tags: string`, `primary_business_user_id?: string`, `parent_business_process_id?: string`
- Add `ActivityStep` interface after `UserJourney`: fields `id: string`, `user_journey_id: string`, `name: string`, `description: string`, `tags: string`, `sequence_order?: number`, `process_activity_id: string`, `business_user_id: string`, `application_id: string`
- Add `user_journeys: UserJourney[]` and `activity_steps: ActivityStep[]` to the `MetaModelEntities` interface
- Add `'user_journeys'` and `'activity_steps'` to the `EntityType` union type

## Visual Design
No visual assets -- this is a backend-only spec with frontend type additions only.

## Existing Code to Leverage

**BusinessProcess + ProcessActivity parent-child entity pattern**
- Direct structural analog: USER_JOURNEY is to ACTIVITY_STEP as BUSINESS_PROCESS is to PROCESS_ACTIVITY
- `BusinessProcessEntity.java` and `ProcessActivityEntity.java` show the exact Lombok/JPA field pattern to replicate (parent FK as plain String column, not @ManyToOne)
- `BusinessProcessDto.java` and `ProcessActivityDto.java` show the DTO record pattern (snake_case @JsonProperty, no model_file_id)
- The EntityMapper toDto/toEntity methods for these two entities are the template for the new mapper methods

**UIScreen entity addition (migration 010) -- end-to-end new entity pattern**
- `sql/010-ui-screens-ui-workflow-transitions.sql` demonstrates the SQL CREATE TABLE + FK + INDEX pattern for adding new tables
- Shows how cross-entity FKs (to other tables) should omit CASCADE: `REFERENCES ui_screens(id)` with no ON DELETE clause (defaults to NO ACTION)
- The UIScreenEntity/UIScreenDto/UIScreenRepository trio shows the minimal file set needed for each new entity type

**ModelService bulk load/save/delete pattern**
- `loadEntities()` uses positional constructor args in the `new MetaModelEntitiesDto(...)` call -- new entity loads must be appended in the same position as the new record fields
- `saveEntities()` uses the `if (entities.xxx() != null) { repo.saveAll(stream.map(toEntity).collect()) }` pattern for every entity type
- `deleteAllDataForModelFile()` deletes in reverse dependency order (children before parents) and must be updated to delete activity_steps before user_journeys

**MetaModelSummaryService fetch pattern**
- Each entity type has a private `fetchXxx(modelFileId)` method that queries the repository and maps to `EntitySummary(id, name, entityType)`
- The `getMetaModelSummary()` method calls all fetch methods and passes results positionally to the MetaModelSummaryDto constructor
- Adding user_journeys requires: one new repository field, one new fetch method, one new MetaModelSummaryDto field, and updates to the constructor call and debug log

**Frontend model.ts type conventions**
- Interfaces use snake_case field names matching JSON property names from the backend DTOs
- Optional FK fields use `?` suffix (e.g., `primary_business_user_id?: string`)
- Required FK fields omit the `?` (e.g., `process_activity_id: string`)
- MetaModelEntities interface lists every entity collection; EntityType union lists every collection key

## Out of Scope
- Frontend grid UI tabs for editing user journeys and activity steps (deferred to Increment 2)
- Diagram rendering or diagram node support for USER_JOURNEY and ACTIVITY_STEP entities
- Any new derived superclass entity (e.g., "JourneyPoint" analogous to BusinessPoint or DataEntityPoint)
- Agent OS conversation, orchestration, or task layer integration
- `valid_from` / `valid_to` temporal fields on USER_JOURNEY
- `status` or `kind`/`type` discriminator fields on USER_JOURNEY
- `actor_hint` or `user_interaction_level` fields on ACTIVITY_STEP (those remain on ProcessActivity)
- Dedicated REST controller endpoints -- the existing GET/PUT `/api/model` endpoints in ModelService already serve the full ArchitectureModel including these new entities
- Any new entries in MetaModelRelationshipsDto -- all relationships are direct FKs, not join tables
- UI contracts, components, or actions related to user journeys

# Spec Requirements: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)

## Initial Description
Introduce Delivery Teams as first-class, DB-backed entities so future roadmap planning can assign Initiatives/Epics to delivery teams (internal/external). This increment adds backend persistence + minimal REST endpoints only. No UI changes and no gateway changes.

## Codebase Research Observations

### Entity Patterns Observed
- All JPA entities use: `@Entity`, `@Table`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder` (Lombok)
- UUID primary keys are the norm for newer entities (ProjectEntity, WorkItemEntity, ProductDefinitionEntity)
- OrganisationEntity is an exception -- uses String ID with "org-" prefix
- Timestamp fields use `Instant` type with `@PrePersist`/`@PreUpdate` lifecycle callbacks
- `@Builder.Default` used for timestamp defaults (`Instant.now()`)
- No base entity class exists -- each entity defines its own timestamps and lifecycle hooks
- WorkItemEntity stores enums as plain TEXT strings (not Java enums, not PostgreSQL ENUMs)

### Repository Patterns Observed
- All repositories extend `JpaRepository<EntityType, IdType>`
- Annotated with `@Repository`
- Use Spring Data derived query methods (e.g., `findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc`)
- Custom queries use `@Query` annotation (e.g., `ProjectRepository.deactivateAll()`)
- `@Modifying` annotation used for update/delete queries
- Repository placement: top-level entities in `repository/` package, domain entities in `repository/entity/`

### Service Layer Patterns Observed
- All services use `@Service`, `@Slf4j`, and `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
- `@Transactional(readOnly = true)` for reads, `@Transactional` for writes
- Validation done in service layer (not via Bean Validation annotations)
- `IllegalArgumentException` thrown for bad input (maps to 400 via GlobalExceptionHandler)
- `ResourceNotFoundException` thrown for missing entities (maps to 404)
- `ConflictException` thrown for duplicates (maps to 409)
- Some services use constructor injection with `@RequiredArgsConstructor`, others use explicit constructors

### Controller Patterns Observed
- `@RestController` + `@ConditionalOnProperty` (same feature flag as service)
- URL patterns vary:
  - `/api/model/projects/{projectId}/work-items` (WorkItemController)
  - `/api/projects/{projectId}/product` (ProductDefinitionController)
  - `/api/v1/organisations` (OrganisationController -- not project-scoped)
- Inner `record` classes used for request bodies (e.g., `CreateOrganisationRequest`, `SaveProductDefinitionRequest`)
- Response codes: 200 for GET/PUT, 201 for POST, 204 for DELETE
- `@PathVariable` for path params, `@RequestParam` for query params
- Null/blank checking done in controller for path variables

### DTO Patterns Observed
- Java records with `@JsonProperty` for snake_case (WorkItemDto) or `@JsonAlias` for dual case support (OrganisationDto)
- Global Jackson config: `property-naming-strategy: SNAKE_CASE` means fields auto-serialize as snake_case
- ProductDefinitionDto has no annotations -- relies on global SNAKE_CASE strategy
- DTOs live in `model/dto/` package

### Mapper Patterns Observed
- Two styles exist:
  1. Static utility class with private constructor (WorkItemMapper) -- not a Spring bean
  2. `@Component` bean (OrganisationMapper, ProductDefinitionMapper)
- Both handle null checks and provide toDto/toEntity methods
- WorkItemMapper also has `updateEntityFromDto` for patch semantics

### Migration Patterns Observed
- Liquibase with YAML master (`db.changelog-master.yaml`) referencing SQL files
- SQL files in `db/changelog/sql/` with numeric prefix (next would be `044-...`)
- ChangeSet IDs use descriptive format: `NNN-descriptive-name`
- PreConditions: typically `onFail: MARK_RAN`, `onError: HALT`, with `not: tableExists:` or `not: columnExists:` guards
- SQL uses PostgreSQL syntax: `UUID`, `TEXT`, `TIMESTAMPTZ`, `JSONB`
- FK constraints named explicitly (e.g., `fk_project_organisation`)
- Indexes named with `idx_` prefix

### project_id Type Inconsistency
- `project` table PK is `UUID`
- `work_item.project_id` is `TEXT NOT NULL` (no FK constraint to project table)
- `product_definitions.project_id` is `UUID NOT NULL` with FK to `project(id)`
- The raw idea says "project_id FK" for delivery_teams -- type needs clarification

### Test Patterns Observed
- Controller tests: JUnit 5 + `@ExtendWith(MockitoExtension.class)` + `MockMvc` standalone setup with `GlobalExceptionHandler`
- Service tests: JUnit 5 + Mockito mocks of repositories
- Integration tests: `@SpringBootTest` with H2 in-memory (Liquibase disabled, `ddl-auto: create-drop`)
- ObjectMapper configured with SNAKE_CASE + JavaTimeModule in tests

## Requirements Discussion

### First Round Questions

**Q1:** The raw idea specifies `project_id FK` on the `delivery_teams` table. However, I found a type inconsistency in the codebase: `project.id` is `UUID`, `product_definitions.project_id` is `UUID NOT NULL` with a real FK constraint, but `work_item.project_id` is `TEXT NOT NULL` with no FK constraint. I am assuming DeliveryTeam should follow the newer/cleaner pattern (matching `product_definitions`): `project_id UUID NOT NULL` with a real FK constraint to `project(id)`. Is that correct, or should it follow the legacy TEXT pattern used by work_item?
**Answer:** Yes -- use the cleaner pattern: `project_id UUID NOT NULL` with a real FK to `project(id)` and `ON DELETE CASCADE` (matching product_definitions).

**Q2:** The raw idea says `type ENUM INTERNAL/EXTERNAL`. The existing codebase stores all enum-like values as plain TEXT strings in the database (e.g., WorkItem type = "INITIATIVE", status = "PLANNED") and validates in the Java service layer. No PostgreSQL ENUM types are used anywhere. I am assuming we should follow this existing pattern: store `type` as `TEXT NOT NULL` and validate allowed values ("INTERNAL", "EXTERNAL") in the Java service layer. Is that correct, or do you want to introduce a PostgreSQL ENUM for this?
**Answer:** Use TEXT + Java-side validation (no PostgreSQL ENUM) to match existing codebase conventions.

**Q3:** The raw idea says to add `delivery_team_id FK` to `work_item` with `ON DELETE SET NULL`. However, `work_item.project_id` is currently TEXT and the table has no FK to `project`. If `delivery_teams.id` is UUID, then `work_item.delivery_team_id` would need to be UUID as well. I am assuming we add `delivery_team_id UUID NULL` with `FOREIGN KEY REFERENCES delivery_teams(id) ON DELETE SET NULL`. Is that correct? Should we also add an index on `work_item.delivery_team_id` for efficient lookups?
**Answer:** Yes -- `delivery_team_id UUID NULL` with FK to `delivery_teams(id) ON DELETE SET NULL`; also add an index on `work_item.delivery_team_id`.

**Q4:** The raw idea specifies the REST endpoint as `/api/projects/{projectId}/delivery-teams`. The codebase has two URL prefix patterns: `/api/model/projects/{projectId}/...` (used by WorkItemController) and `/api/projects/{projectId}/...` (used by ProductDefinitionController). Which pattern should the DeliveryTeamController use? I am assuming `/api/projects/{projectId}/delivery-teams` (matching the raw idea and the ProductDefinitionController pattern). Is that correct?
**Answer:** Yes -- use `/api/projects/{projectId}/delivery-teams` (project-level pattern, matching ProductDefinitionController).

**Q5:** For the mapper, the codebase has two styles: static utility class (like WorkItemMapper) and Spring `@Component` bean (like OrganisationMapper). I am assuming we should use the `@Component` bean style since it is the more recent pattern and supports easier testing with dependency injection. Is that correct?
**Answer:** Use the `@Component` mapper bean style (align with the newer pattern).

**Q6:** For the `UNIQUE(project_id, name)` constraint, the raw idea does not specify case sensitivity. The OrganisationEntity uses case-insensitive uniqueness (`existsByNameIgnoreCase`). I am assuming delivery team names should also be case-insensitively unique per project (i.e., "Team Alpha" and "team alpha" are considered duplicates within the same project). Is that correct?
**Answer:** Yes -- case-insensitive uniqueness per project (treat "Team Alpha" and "team alpha" as duplicates).

**Q7:** For the DELETE endpoint, the raw idea says "204, sets linked work_items to NULL". The `ON DELETE SET NULL` FK will handle the database side automatically. I am assuming the service layer does NOT need to manually update work items before deletion -- the FK cascade handles it. However, should the DELETE response include any information about how many work items were unlinked, or is a plain 204 No Content sufficient?
**Answer:** Plain 204 No Content is sufficient (no unlink counts in response for v0.1).

**Q8:** The raw idea does not mention a GET-by-ID endpoint (`GET /api/projects/{projectId}/delivery-teams/{teamId}`). I am assuming we should include one for consistency with other CRUD controllers (WorkItemController has getWorkItem by ID). Is that correct?
**Answer:** Yes -- include `GET /{teamId}` for completeness/consistency.

**Q9:** For the `description` field on DeliveryTeam, should there be a maximum length constraint (similar to `name: max 120 chars`)? The existing codebase stores descriptions as `TEXT` with no length limit. I am assuming `description` should be nullable TEXT with no max length (matching the existing pattern). Is that correct?
**Answer:** Yes -- nullable TEXT with no max length (match existing conventions).

**Q10:** Are there any ordering requirements for the GET (list) endpoint? For example, WorkItems use `ORDER BY sort_order, created_at, id`. I am assuming delivery teams should be listed alphabetically by name (`ORDER BY name ASC`) since there is no sort_order field. Is that correct?
**Answer:** Yes -- return list ordered by name ASC.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: WorkItem CRUD -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/` (entity, service, controller, mapper, repository, DTO, migration, tests)
- Feature: Organisation CRUD -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/` (closest analog for a standalone entity with name uniqueness + conflict detection)
- Feature: ProductDefinition CRUD -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/` (closest analog for a project-scoped entity with UUID FK to project)
- Exception handling: `exception/GlobalExceptionHandler.java`, `exception/ConflictException.java`, `exception/ResourceNotFoundException.java`
- Migration master: `src/main/resources/db/changelog/db.changelog-master.yaml` (next changeset ID would be 044)
- Feature flag pattern: `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`

### Follow-up Questions
No follow-up questions needed -- all decisions are clear from the first round answers.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A -- this is a backend-only increment with no UI components.

## Requirements Summary

### Functional Requirements
- New `delivery_teams` database table with UUID PK, `project_id UUID NOT NULL` FK to `project(id)` with `ON DELETE CASCADE`, name (max 120 chars), type (TEXT, validated as INTERNAL/EXTERNAL in Java), description (nullable TEXT, no max length), timestamps, and `UNIQUE(project_id, name)` with case-insensitive enforcement
- New DeliveryTeam JPA entity with Lombok annotations following existing patterns
- New DeliveryTeamRepository extending JpaRepository with findByProjectId (ordered by name ASC), findByProjectIdAndNameIgnoreCase for uniqueness checks
- New DeliveryTeamService with list, get-by-id, create, update, delete operations and validation (type values validated in service layer)
- New DeliveryTeamController at `/api/projects/{projectId}/delivery-teams` with GET (list, ordered by name ASC), GET /{teamId}, POST (create, 201), PUT (update, 200), DELETE (204 No Content)
- New DeliveryTeamDto Java record
- New DeliveryTeamMapper as `@Component` bean
- Add nullable `delivery_team_id UUID` FK column to `work_item` table with `ON DELETE SET NULL` and an index on `work_item.delivery_team_id`
- Update WorkItemEntity with deliveryTeamId field
- Liquibase migration(s) for new table and work_item alteration

### Reusability Opportunities
- WorkItemController/Service/Mapper pattern for CRUD structure
- OrganisationService pattern for name uniqueness validation with ConflictException (case-insensitive)
- ProductDefinitionEntity pattern for project-scoped UUID FK with ON DELETE CASCADE
- ProductDefinitionController pattern for `/api/projects/{projectId}/...` URL structure
- OrganisationMapper / ProductDefinitionMapper pattern for `@Component` mapper bean style
- GlobalExceptionHandler already handles ConflictException (409), ResourceNotFoundException (404), IllegalArgumentException (400)
- Existing test patterns (MockMvc standalone + Mockito for controller tests, Mockito for service tests)

### Scope Boundaries
**In Scope:**
- architecture-model-service: DeliveryTeam JPA entity + table
- architecture-model-service: minimal CRUD endpoints (list, get-by-id, create, update, delete)
- architecture-model-service: nullable delivery_team_id FK on work_item with index
- DTOs + service layer + repository + mapper
- Liquibase migrations

**Out of Scope:**
- Any frontend/UI work
- Any gateway changes
- Any assignment logic in roadmap conversation
- Any Jira sync logic
- Any changes to work item creation flows
- Updating WorkItemDto to include delivery_team_id (not specified in raw idea -- may be needed)

### Technical Considerations
- Must use `@ConditionalOnProperty` feature flag pattern for all new beans
- Must integrate with existing Liquibase migration chain (next number: 044)
- H2 compatibility required for tests (ddl-auto: create-drop, no Liquibase in tests)
- Global Jackson SNAKE_CASE strategy applies -- DTO field names auto-serialize
- WorkItemEntity update to add deliveryTeamId field needs careful migration (nullable, backward compatible)
- The work_item table currently has no FK to project -- the new delivery_team_id FK would be the first real FK on work_item besides self-referential parent_id
- project_id FK uses ON DELETE CASCADE (if a project is deleted, all its delivery teams are removed)
- delivery_team_id FK on work_item uses ON DELETE SET NULL (if a delivery team is deleted, work items keep their data but lose the team reference)
- Case-insensitive uniqueness for team names within a project -- implement via service-layer check using repository method (e.g., `findByProjectIdAndNameIgnoreCase`)
- DELETE response is plain 204 No Content with no body (database ON DELETE SET NULL handles work item unlinking automatically)

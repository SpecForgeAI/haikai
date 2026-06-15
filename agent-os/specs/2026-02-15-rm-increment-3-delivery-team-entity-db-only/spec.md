# Specification: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)

## Goal
Introduce Delivery Teams as first-class, database-backed entities in the architecture-model-service so that future roadmap planning can assign Initiatives/Epics to internal or external delivery teams. This increment adds backend persistence and minimal REST CRUD endpoints only -- no UI, gateway, or roadmap logic changes.

## User Stories
- As a project administrator, I want to create and manage delivery teams within a project so that work items can later be assigned to the teams responsible for delivering them.
- As a roadmap planner, I want delivery teams to be persisted with a type (INTERNAL/EXTERNAL) so that future capacity and allocation features can distinguish between in-house and vendor teams.
- As a system integrator, I want work items to carry an optional delivery_team_id reference so that downstream tooling can query which team owns a given work item.

## Specific Requirements

**Flyway Migration: Create `delivery_teams` table**
- New SQL migration file `044-delivery-teams.sql` in `src/main/resources/db/changelog/sql/`
- Table columns: `id UUID PRIMARY KEY`, `project_id UUID NOT NULL`, `name TEXT NOT NULL`, `type TEXT NOT NULL`, `description TEXT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`
- FK constraint named `fk_delivery_teams_project` referencing `project(id) ON DELETE CASCADE` (matching the `product_definitions` pattern)
- Composite UNIQUE constraint on `(project_id, name)` -- standard case-sensitive at DB level; case-insensitive uniqueness enforced in Java service layer
- Index `idx_delivery_teams_project_id` on `project_id` for efficient lookups
- New changeset entry `044-delivery-teams` in `db.changelog-master.yaml` with `preConditions: not: tableExists: delivery_teams`, `onFail: MARK_RAN`, `onError: HALT`

**Flyway Migration: Add `delivery_team_id` to `work_item`**
- Separate SQL migration file `045-work-item-delivery-team-id.sql`
- `ALTER TABLE work_item ADD COLUMN delivery_team_id UUID NULL`
- FK constraint named `fk_work_item_delivery_team` referencing `delivery_teams(id) ON DELETE SET NULL`
- Index `idx_work_item_delivery_team_id` on `work_item(delivery_team_id)`
- New changeset entry `045-work-item-delivery-team-id` in `db.changelog-master.yaml` with `preConditions: not: columnExists: tableName: work_item, columnName: delivery_team_id`

**DeliveryTeamType enum**
- Java enum in `model/entity/` (or a sibling package) with values `INTERNAL` and `EXTERNAL`
- Used for Java-side validation only; the database stores the value as plain `TEXT` (consistent with how WorkItemEntity stores type/status as String)
- The service layer validates that the incoming type string matches a valid enum value

**DeliveryTeam JPA Entity**
- Class `DeliveryTeamEntity` in package `model/entity/` annotated with `@Entity`, `@Table(name = "delivery_teams")`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`
- Fields: `id` (UUID, `@Id`, `@Column(name = "id", nullable = false)`), `projectId` (UUID, `@Column(name = "project_id", nullable = false)`), `name` (String, `@Column(name = "name", nullable = false)`), `type` (String, `@Column(name = "type", nullable = false)`) stored as TEXT matching the WorkItemEntity pattern, `description` (String, nullable), `createdAt` (Instant), `updatedAt` (Instant)
- `@PrePersist` and `@PreUpdate` lifecycle callbacks for timestamp management, following the WorkItemEntity pattern
- `@Builder.Default` on `createdAt` and `updatedAt` with `Instant.now()`
- ID generation: `UUID.randomUUID()` assigned in the service layer (matching ProductDefinitionService pattern), not via `@GeneratedValue`

**WorkItem Entity Update**
- Add field `deliveryTeamId` (UUID, nullable) to `WorkItemEntity` with `@Column(name = "delivery_team_id")`
- No JPA `@ManyToOne` relationship object -- use bare UUID foreign key field only (consistent with how WorkItemEntity handles `projectId` and `parentId`)
- No changes to existing WorkItemEntity behavior, constructors, or builder defaults

**DeliveryTeamRepository**
- Interface `DeliveryTeamRepository` in package `repository/` (top-level, alongside `OrganisationRepository` and `ProductDefinitionRepository`) extending `JpaRepository<DeliveryTeamEntity, UUID>` with `@Repository`
- Methods: `List<DeliveryTeamEntity> findByProjectIdOrderByNameAsc(UUID projectId)`, `Optional<DeliveryTeamEntity> findByProjectIdAndNameIgnoreCase(UUID projectId, String name)`, `boolean existsByProjectIdAndNameIgnoreCase(UUID projectId, String name)`
- Placement at repository root level (not in `repository/entity/`) since DeliveryTeam is a top-level domain entity like Organisation and ProductDefinition

**DeliveryTeamMapper (@Component bean)**
- Class `DeliveryTeamMapper` in package `mapper/` annotated with `@Component`
- Method `toDto(DeliveryTeamEntity entity)` returning `DeliveryTeamDto`, with null-check guard returning null
- Follow the `ProductDefinitionMapper` pattern: simple field-by-field mapping via the record constructor
- No `toEntity` method needed -- entity construction happens directly in the service via `@Builder`

**DeliveryTeamDto (Java record)**
- Record `DeliveryTeamDto` in package `model/dto/`
- Fields: `UUID id`, `UUID projectId`, `String name`, `String type`, `String description`, `Instant createdAt`, `Instant updatedAt`
- No `@JsonProperty` annotations needed -- relies on global Jackson `SNAKE_CASE` property naming strategy (matching `ProductDefinitionDto` pattern)

**DeliveryTeamService**
- Class `DeliveryTeamService` in package `service/` annotated with `@Service`, `@Slf4j`, `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
- Constructor injection of `DeliveryTeamRepository` and `DeliveryTeamMapper`
- `list(UUID projectId)`: `@Transactional(readOnly = true)`, returns `List<DeliveryTeamDto>` ordered by name ASC via repository
- `getById(UUID projectId, UUID teamId)`: `@Transactional(readOnly = true)`, returns `DeliveryTeamDto`, throws `ResourceNotFoundException` if not found or if the team does not belong to the given project
- `create(UUID projectId, String name, String type, String description)`: `@Transactional`, validates name non-null/non-blank and max 120 chars (throw `IllegalArgumentException`), validates type is a valid `DeliveryTeamType` enum value (throw `IllegalArgumentException`), checks `existsByProjectIdAndNameIgnoreCase` for duplicate (throw `ConflictException`), generates `UUID.randomUUID()` for ID, builds entity via `@Builder`, saves, returns mapped DTO
- `update(UUID projectId, UUID teamId, String name, String type, String description)`: `@Transactional`, finds existing entity (throw `ResourceNotFoundException` if not found), same validation as create, duplicate name check excludes self (find by name, check if found entity has different ID), updates fields, saves, returns mapped DTO
- `delete(UUID projectId, UUID teamId)`: `@Transactional`, finds existing entity (throw `ResourceNotFoundException` if not found), deletes (FK `ON DELETE SET NULL` automatically nulls work item references)

**DeliveryTeamController**
- Class `DeliveryTeamController` in package `controller/` annotated with `@RestController`, `@RequestMapping("/api/projects/{projectId}/delivery-teams")`, `@Slf4j`, `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
- Constructor injection of `DeliveryTeamService`
- Inner request record `CreateDeliveryTeamRequest(String name, String type, String description)` and `UpdateDeliveryTeamRequest(String name, String type, String description)`
- `GET /` -> `ResponseEntity<List<DeliveryTeamDto>>` with HTTP 200
- `GET /{teamId}` -> `ResponseEntity<DeliveryTeamDto>` with HTTP 200 (404 via `ResourceNotFoundException` if not found)
- `POST /` -> `ResponseEntity<DeliveryTeamDto>` with HTTP 201 via `ResponseEntity.status(HttpStatus.CREATED).body(...)` (400 on validation failure, 409 on duplicate name)
- `PUT /{teamId}` -> `ResponseEntity<DeliveryTeamDto>` with HTTP 200 (404 if not found, 409 on duplicate name)
- `DELETE /{teamId}` -> `ResponseEntity<Void>` with HTTP 204 via `ResponseEntity.noContent().build()` (404 if not found)
- `@PathVariable UUID projectId` on all methods; `@PathVariable UUID teamId` on single-resource methods

## Existing Code to Leverage

**ProductDefinitionEntity / ProductDefinitionService / ProductDefinitionController**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ProductDefinitionEntity.java`, `service/ProductDefinitionService.java`, `controller/ProductDefinitionController.java`
- Closest analog for a project-scoped entity with `UUID projectId` FK to `project(id)` with `ON DELETE CASCADE`
- Use as template for: entity annotations and field structure, service UUID generation (`UUID.randomUUID()`), controller URL pattern (`/api/projects/{projectId}/...`), DTO as plain Java record with no Jackson annotations

**OrganisationService / OrganisationRepository (case-insensitive uniqueness pattern)**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/service/OrganisationService.java`, `repository/OrganisationRepository.java`
- Provides the exact pattern for case-insensitive duplicate name checking: `existsByNameIgnoreCase()` in repository, `ConflictException` throw in service (lines 159-161 of OrganisationService)
- Adapt to project-scoped variant: `existsByProjectIdAndNameIgnoreCase(UUID, String)`

**WorkItemEntity / WorkItemController (full CRUD + delete pattern)**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/WorkItemEntity.java`, `controller/WorkItemController.java`, `service/WorkItemService.java`
- Template for `@PrePersist`/`@PreUpdate` timestamp lifecycle callbacks (lines 83-96 of WorkItemEntity)
- Template for `@Builder.Default` on `createdAt`/`updatedAt` with `Instant.now()`
- Template for DELETE returning 204 (`ResponseEntity.noContent().build()`) and POST returning 201 (`ResponseEntity.status(HttpStatus.CREATED)`)
- WorkItemEntity is also the target for adding the new `deliveryTeamId` field

**OrganisationMapper / ProductDefinitionMapper (@Component mapper pattern)**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/OrganisationMapper.java`, `mapper/ProductDefinitionMapper.java`
- Both use `@Component` annotation making them injectable Spring beans
- `ProductDefinitionMapper` is the simpler of the two (single `toDto` method with null guard) and is the best template for `DeliveryTeamMapper`

**Migration 043-product-definitions.sql and db.changelog-master.yaml**
- Located at `architecture-model-service/src/main/resources/db/changelog/sql/043-product-definitions.sql`, `db/changelog/db.changelog-master.yaml`
- Template for table creation SQL syntax: `UUID PRIMARY KEY`, `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`, explicit FK constraint via `ALTER TABLE ... ADD CONSTRAINT`, named indexes
- Template for changelog YAML entry structure: changeset ID format `NNN-descriptive-name`, author `architecture-tool`, preConditions with `onFail: MARK_RAN` and `onError: HALT`, `not: tableExists:` guard
- Next available migration numbers are 044 and 045

## Out of Scope
- Any frontend/UI work (no React components, no CSS, no routing changes)
- Any gateway service changes (no new routes or proxy logic)
- Any assignment logic in the roadmap conversation (no LLM prompt changes for team assignment)
- Any Jira sync logic (no external system integration for delivery teams)
- Any changes to work item creation flows (existing create/update work item APIs remain unchanged)
- Delivery team capacity or velocity tracking (no capacity fields, no sprint metrics)
- Team member management (no person/user entities linked to delivery teams)
- Updating WorkItemDto to include delivery_team_id (deferred to a future increment when UI needs it)
- Any test implementation (tests are a separate task; this spec covers production code only)
- Seeding or backfilling delivery_team_id on existing work items

# Task Breakdown: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)

## Overview
Total Tasks: 5 Task Groups, 34 sub-tasks

This is a backend-only increment in the `architecture-model-service` Java/Spring Boot project. It introduces Delivery Teams as first-class, database-backed entities with full CRUD REST endpoints, two Flyway migrations, and a minor update to the existing WorkItemEntity. No frontend, gateway, or LLM prompt changes are required.

**Base path for all source files:**
`architecture-model-service/src/main/java/com/example/architecturemodel/`

**Base path for all test files:**
`architecture-model-service/src/test/java/com/example/architecturemodel/`

**Base path for migrations:**
`architecture-model-service/src/main/resources/db/changelog/`

---

## Task List

### Database Layer

#### Task Group 1: Flyway Migrations
**Dependencies:** None

- [x] 1.0 Complete database migration layer
  - [x] 1.1 Create migration `044-delivery-teams.sql`
    - File: `sql/044-delivery-teams.sql`
    - Follow pattern from: `sql/043-product-definitions.sql`
    - Table `delivery_teams` with columns:
      - `id UUID PRIMARY KEY`
      - `project_id UUID NOT NULL`
      - `name TEXT NOT NULL`
      - `type TEXT NOT NULL`
      - `description TEXT NULL`
      - `created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`
      - `updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`
    - FK constraint `fk_delivery_teams_project` referencing `project(id) ON DELETE CASCADE`
    - Composite UNIQUE constraint on `(project_id, name)`
    - Index `idx_delivery_teams_project_id` on `project_id`
  - [x] 1.2 Create migration `045-work-item-delivery-team-id.sql`
    - File: `sql/045-work-item-delivery-team-id.sql`
    - `ALTER TABLE work_item ADD COLUMN delivery_team_id UUID NULL`
    - FK constraint `fk_work_item_delivery_team` referencing `delivery_teams(id) ON DELETE SET NULL`
    - Index `idx_work_item_delivery_team_id` on `work_item(delivery_team_id)`
  - [x] 1.3 Register both migrations in `db.changelog-master.yaml`
    - Add changeset `044-delivery-teams`:
      - author: `architecture-tool`
      - preConditions: `onFail: MARK_RAN`, `onError: HALT`, `not: tableExists: delivery_teams`
      - sqlFile path: `db/changelog/sql/044-delivery-teams.sql`
    - Add changeset `045-work-item-delivery-team-id`:
      - author: `architecture-tool`
      - preConditions: `onFail: MARK_RAN`, `onError: HALT`, `not: columnExists: tableName: work_item, columnName: delivery_team_id`
      - sqlFile path: `db/changelog/sql/045-work-item-delivery-team-id.sql`
    - Follow exact YAML structure from the `043-product-definitions` entry
  - [x] 1.4 Write 2 focused tests for migration correctness
    - File: `test/.../migration/DeliveryTeamMigrationTest.java`
    - Test 1: Verify `delivery_teams` table columns and constraints exist after migration (use `@SpringBootTest` with H2 if Liquibase is enabled in test, or verify entity persistence via `@DataJpaTest`)
    - Test 2: Verify `work_item.delivery_team_id` column is nullable and accepts UUID values
    - Note: Since existing tests use `ddl-auto: create-drop` (Liquibase disabled in tests), these tests may need to verify schema indirectly through entity persistence rather than raw SQL inspection
  - [x] 1.5 Verify migration tests pass
    - Run ONLY the 2 tests written in 1.4
    - Confirm no compilation errors in migration SQL

**Acceptance Criteria:**
- Both SQL migration files exist with correct syntax
- Both changesets are registered in `db.changelog-master.yaml` with proper preconditions
- Migration SQL follows PostgreSQL conventions used elsewhere in the codebase (UUID, TEXT, TIMESTAMPTZ)
- The 2 migration-related tests pass

---

### Domain Layer

#### Task Group 2: Entities, Enum, and Repository
**Dependencies:** Task Group 1

- [x] 2.0 Complete domain layer
  - [x] 2.1 Create `DeliveryTeamType` enum
    - File: `model/entity/DeliveryTeamType.java`
    - Package: `com.example.architecturemodel.model.entity`
    - Values: `INTERNAL`, `EXTERNAL`
    - Used for Java-side validation only; database stores as plain TEXT
  - [x] 2.2 Create `DeliveryTeamEntity` JPA entity
    - File: `model/entity/DeliveryTeamEntity.java`
    - Follow pattern from: `ProductDefinitionEntity.java` and `WorkItemEntity.java`
    - Annotations: `@Entity`, `@Table(name = "delivery_teams")`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`
    - Fields:
      - `id` (UUID, `@Id`, `@Column(name = "id", nullable = false)`)
      - `projectId` (UUID, `@Column(name = "project_id", nullable = false)`)
      - `name` (String, `@Column(name = "name", nullable = false)`)
      - `type` (String, `@Column(name = "type", nullable = false)`) -- stored as TEXT, not enum
      - `description` (String, `@Column(name = "description")`, nullable)
      - `createdAt` (Instant, `@Column(name = "created_at", nullable = false, updatable = false)`, `@Builder.Default` with `Instant.now()`)
      - `updatedAt` (Instant, `@Column(name = "updated_at", nullable = false)`, `@Builder.Default` with `Instant.now()`)
    - `@PrePersist` method `onCreate()` and `@PreUpdate` method `onUpdate()` following WorkItemEntity pattern (lines 83-96)
    - ID generation: `UUID.randomUUID()` assigned in service layer, not via `@GeneratedValue`
  - [x] 2.3 Update `WorkItemEntity` with `deliveryTeamId` field
    - File: `model/entity/WorkItemEntity.java`
    - Add field: `@Column(name = "delivery_team_id") private UUID deliveryTeamId;`
    - No `@ManyToOne` relationship -- bare UUID FK only (matches `projectId` and `parentId` pattern)
    - No changes to existing constructors, builder defaults, or lifecycle callbacks
  - [x] 2.4 Create `DeliveryTeamRepository` interface
    - File: `repository/DeliveryTeamRepository.java`
    - Package: `com.example.architecturemodel.repository` (top-level, alongside `OrganisationRepository`, `ProductDefinitionRepository`)
    - Extends: `JpaRepository<DeliveryTeamEntity, UUID>`
    - Annotation: `@Repository`
    - Methods:
      - `List<DeliveryTeamEntity> findByProjectIdOrderByNameAsc(UUID projectId)`
      - `Optional<DeliveryTeamEntity> findByProjectIdAndNameIgnoreCase(UUID projectId, String name)`
      - `boolean existsByProjectIdAndNameIgnoreCase(UUID projectId, String name)`
  - [x] 2.5 Write 4 focused tests for entity and repository behavior
    - File: `test/.../repository/DeliveryTeamRepositoryTest.java`
    - Test 1: `DeliveryTeamEntity` can be persisted and retrieved with all fields correctly mapped
    - Test 2: `findByProjectIdOrderByNameAsc` returns teams for a project ordered alphabetically, excludes teams from other projects
    - Test 3: `existsByProjectIdAndNameIgnoreCase` returns true for case-insensitive match (e.g., "Team Alpha" matches "team alpha") and false for non-matching names
    - Test 4: `WorkItemEntity` with `deliveryTeamId` field persists correctly and accepts null values
    - Use `@DataJpaTest` or `@ExtendWith(MockitoExtension.class)` depending on whether real DB interaction is needed
    - Follow pattern from: `WorkItemRepositoryTest.java`, `OrganisationRepositoryTest.java`
  - [x] 2.6 Ensure domain layer tests pass
    - Run ONLY the 4 tests written in 2.5
    - Verify entity compiles and maps correctly to the table schema

**Acceptance Criteria:**
- `DeliveryTeamType` enum has exactly two values: `INTERNAL` and `EXTERNAL`
- `DeliveryTeamEntity` follows all Lombok/JPA annotation conventions from the codebase
- `WorkItemEntity` has a new `deliveryTeamId` field with no other changes
- `DeliveryTeamRepository` has all 3 query methods with correct Spring Data naming conventions
- The 4 repository/entity tests pass

---

### Service Layer

#### Task Group 3: DTO, Mapper, and Service
**Dependencies:** Task Group 2

- [x] 3.0 Complete service layer
  - [x] 3.1 Create `DeliveryTeamDto` record
    - File: `model/dto/DeliveryTeamDto.java`
    - Package: `com.example.architecturemodel.model.dto`
    - Follow pattern from: `ProductDefinitionDto.java`
    - Fields: `UUID id`, `UUID projectId`, `String name`, `String type`, `String description`, `Instant createdAt`, `Instant updatedAt`
    - No `@JsonProperty` or `@JsonAlias` annotations -- relies on global Jackson `SNAKE_CASE` property naming strategy
  - [x] 3.2 Create `DeliveryTeamMapper` component
    - File: `mapper/DeliveryTeamMapper.java`
    - Package: `com.example.architecturemodel.mapper`
    - Annotation: `@Component`
    - Follow pattern from: `ProductDefinitionMapper.java`
    - Method: `DeliveryTeamDto toDto(DeliveryTeamEntity entity)` with null-check guard returning null
    - No `toEntity` method -- entity construction happens in service via `@Builder`
  - [x] 3.3 Create `DeliveryTeamService`
    - File: `service/DeliveryTeamService.java`
    - Package: `com.example.architecturemodel.service`
    - Annotations: `@Service`, `@Slf4j`, `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
    - Constructor injection of `DeliveryTeamRepository` and `DeliveryTeamMapper`
    - Methods:
      - `list(UUID projectId)`: `@Transactional(readOnly = true)`, returns `List<DeliveryTeamDto>` via `findByProjectIdOrderByNameAsc`, maps each entity to DTO
      - `getById(UUID projectId, UUID teamId)`: `@Transactional(readOnly = true)`, returns `DeliveryTeamDto`, throws `ResourceNotFoundException` if not found or if entity's `projectId` does not match the given `projectId`
      - `create(UUID projectId, String name, String type, String description)`: `@Transactional`, validates name non-null/non-blank and max 120 chars (`IllegalArgumentException`), validates type against `DeliveryTeamType` enum (`IllegalArgumentException`), checks `existsByProjectIdAndNameIgnoreCase` for duplicate (`ConflictException`), generates `UUID.randomUUID()`, builds entity via `@Builder`, saves, returns mapped DTO
      - `update(UUID projectId, UUID teamId, String name, String type, String description)`: `@Transactional`, finds existing (`ResourceNotFoundException`), same validation as create, duplicate name check excludes self (find by name, check if found entity has different ID), updates fields on existing entity, saves, returns mapped DTO
      - `delete(UUID projectId, UUID teamId)`: `@Transactional`, finds existing (`ResourceNotFoundException`), deletes entity (FK `ON DELETE SET NULL` automatically nulls work item references)
    - Follow validation pattern from: `OrganisationService.java` (lines 148-162 for case-insensitive duplicate check)
    - Follow CRUD pattern from: `ProductDefinitionService.java` (UUID generation, builder usage)
    - Exception classes already exist: `exception/ConflictException.java`, `exception/ResourceNotFoundException.java`
  - [x] 3.4 Write 6 focused tests for service layer
    - File: `test/.../service/DeliveryTeamServiceTest.java`
    - Use `@ExtendWith(MockitoExtension.class)` with `@Mock` repository and `@Spy` mapper
    - Follow pattern from: `ProductDefinitionServiceTest.java`
    - Test 1: `create` with valid inputs generates UUID, builds entity, saves, and returns DTO
    - Test 2: `create` with duplicate name (case-insensitive) throws `ConflictException`
    - Test 3: `create` with invalid type (not INTERNAL/EXTERNAL) throws `IllegalArgumentException`
    - Test 4: `create` with blank name throws `IllegalArgumentException`; name exceeding 120 chars throws `IllegalArgumentException`
    - Test 5: `update` with valid inputs updates fields on existing entity and returns updated DTO; `update` on non-existent team throws `ResourceNotFoundException`
    - Test 6: `delete` removes entity; `delete` on non-existent team throws `ResourceNotFoundException`
  - [x] 3.5 Ensure service layer tests pass
    - Run ONLY the 6 tests written in 3.4
    - Verify all service methods compile and follow transactional patterns

**Acceptance Criteria:**
- `DeliveryTeamDto` is a Java record with 7 fields matching the entity
- `DeliveryTeamMapper.toDto()` correctly maps all fields and handles null input
- `DeliveryTeamService` implements all 5 CRUD operations with proper validation
- Name validation: non-null, non-blank, max 120 characters
- Type validation: must be a valid `DeliveryTeamType` enum value
- Duplicate name check: case-insensitive, per-project, excludes self on update
- Correct exceptions: `IllegalArgumentException` (400), `ResourceNotFoundException` (404), `ConflictException` (409)
- The 6 service tests pass

---

### REST Controller Layer

#### Task Group 4: REST Controller
**Dependencies:** Task Group 3

- [x] 4.0 Complete REST controller layer
  - [x] 4.1 Create `DeliveryTeamController`
    - File: `controller/DeliveryTeamController.java`
    - Package: `com.example.architecturemodel.controller`
    - Annotations: `@RestController`, `@RequestMapping("/api/projects/{projectId}/delivery-teams")`, `@Slf4j`, `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
    - Constructor injection of `DeliveryTeamService`
    - Inner request records:
      - `CreateDeliveryTeamRequest(String name, String type, String description)`
      - `UpdateDeliveryTeamRequest(String name, String type, String description)`
    - Endpoints:
      - `GET /` -> `ResponseEntity<List<DeliveryTeamDto>>` with HTTP 200; delegates to `service.list(projectId)`
      - `GET /{teamId}` -> `ResponseEntity<DeliveryTeamDto>` with HTTP 200 (404 via `ResourceNotFoundException`); delegates to `service.getById(projectId, teamId)`
      - `POST /` -> `ResponseEntity<DeliveryTeamDto>` with HTTP 201 via `ResponseEntity.status(HttpStatus.CREATED).body(...)`; delegates to `service.create(projectId, request.name(), request.type(), request.description())`
      - `PUT /{teamId}` -> `ResponseEntity<DeliveryTeamDto>` with HTTP 200; delegates to `service.update(projectId, teamId, request.name(), request.type(), request.description())`
      - `DELETE /{teamId}` -> `ResponseEntity<Void>` with HTTP 204 via `ResponseEntity.noContent().build()`; delegates to `service.delete(projectId, teamId)`
    - `@PathVariable UUID projectId` on all methods; `@PathVariable UUID teamId` on single-resource methods
    - `@RequestBody` on POST and PUT methods
    - Follow pattern from: `ProductDefinitionController.java` (URL structure, annotations, inner records), `WorkItemController.java` (POST 201, DELETE 204 patterns)
  - [x] 4.2 Write 8 focused tests for controller endpoints
    - File: `test/.../controller/DeliveryTeamControllerTest.java`
    - Use `@WebMvcTest(DeliveryTeamController.class)` with `@MockBean DeliveryTeamService`
    - Follow pattern from: `ProductDefinitionControllerTest.java`
    - Test 1: `GET /api/projects/{projectId}/delivery-teams` returns 200 with list of DTOs (JSON fields in snake_case)
    - Test 2: `GET /api/projects/{projectId}/delivery-teams/{teamId}` returns 200 with single DTO
    - Test 3: `GET /api/projects/{projectId}/delivery-teams/{teamId}` returns 404 when service throws `ResourceNotFoundException`
    - Test 4: `POST /api/projects/{projectId}/delivery-teams` with valid body returns 201 with created DTO
    - Test 5: `POST /api/projects/{projectId}/delivery-teams` with invalid input returns 400 when service throws `IllegalArgumentException`
    - Test 6: `POST /api/projects/{projectId}/delivery-teams` with duplicate name returns 409 when service throws `ConflictException`
    - Test 7: `PUT /api/projects/{projectId}/delivery-teams/{teamId}` with valid body returns 200 with updated DTO
    - Test 8: `DELETE /api/projects/{projectId}/delivery-teams/{teamId}` returns 204 with no body
  - [x] 4.3 Ensure controller tests pass
    - Run ONLY the 8 tests written in 4.2
    - Verify all endpoints return correct HTTP status codes
    - Verify JSON response bodies use snake_case field names via global Jackson config

**Acceptance Criteria:**
- Controller has all 5 endpoints (GET list, GET by ID, POST, PUT, DELETE)
- URL pattern is `/api/projects/{projectId}/delivery-teams` matching spec
- POST returns HTTP 201, DELETE returns HTTP 204
- `GlobalExceptionHandler` handles `IllegalArgumentException` -> 400, `ResourceNotFoundException` -> 404, `ConflictException` -> 409 (no changes needed to exception handler; mappings already exist)
- The 8 controller tests pass

---

### Integration & Gap Analysis

#### Task Group 5: Integration Tests and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 2 tests from TG1 (migration/entity persistence)
    - Review the 4 tests from TG2 (repository and entity)
    - Review the 6 tests from TG3 (service logic)
    - Review the 8 tests from TG4 (controller endpoints)
    - Total existing tests: approximately 20 tests
  - [x] 5.2 Analyze test coverage gaps for DeliveryTeam feature only
    - Identify critical workflows that lack coverage
    - Focus ONLY on gaps related to this spec's requirements
    - Prioritize end-to-end / integration flows over additional unit test granularity
    - Consider the following gap areas:
      - Mapper null handling and field mapping accuracy
      - Service `update` duplicate name check that excludes self (find by name, different ID)
      - Service `getById` project-scoping validation (team exists but belongs to different project)
      - Controller integration with actual Spring context (if `@WebMvcTest` does not cover `GlobalExceptionHandler` wiring)
      - WorkItemEntity `deliveryTeamId` field round-trip through existing WorkItem CRUD (non-regression)
  - [x] 5.3 Write up to 10 additional strategic tests to fill critical gaps
    - File: `test/.../integration/DeliveryTeamIntegrationTest.java` (or split across targeted test files)
    - Suggested gap-fill tests:
      - Test 1: `DeliveryTeamMapper.toDto()` returns null for null input and correctly maps all 7 fields for non-null input
      - Test 2: Service `update` allows renaming to a name not used by another team in the same project
      - Test 3: Service `update` with duplicate name (same project, different team) throws `ConflictException`
      - Test 4: Service `update` allows "renaming" to the same name (no self-conflict) when only other fields change
      - Test 5: Service `getById` throws `ResourceNotFoundException` when team exists but belongs to a different project
      - Test 6: Service `create` trims name before duplicate check and persistence
      - Test 7: Service `list` returns empty list when project has no delivery teams
      - Test 8: Controller `GET /` returns empty JSON array `[]` when no teams exist (not 404)
      - Test 9: Controller `POST` request body JSON uses snake_case field names and deserializes correctly
      - Test 10: `WorkItemEntity` with `deliveryTeamId` set persists and loads correctly without affecting existing fields (non-regression)
    - Do NOT write exhaustive edge case tests for all input combinations
    - Do NOT write performance, load, or accessibility tests
  - [x] 5.4 Run all feature-specific tests
    - Run ONLY tests related to the DeliveryTeam feature (tests from TG1-TG4 and TG5)
    - Expected total: approximately 20-30 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-30 tests total)
- Critical user workflows for DeliveryTeam CRUD are covered
- No more than 10 additional tests added in this task group
- Non-regression confirmed: existing WorkItemEntity behavior unaffected by new `deliveryTeamId` field
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Flyway Migrations** -- Create the database schema foundation. No Java dependencies.
2. **Task Group 2: Entities, Enum, and Repository** -- Build the JPA domain model on top of the schema. Depends on TG1 for table structure.
3. **Task Group 3: DTO, Mapper, and Service** -- Implement business logic, validation, and data transformation. Depends on TG2 for entities and repository.
4. **Task Group 4: REST Controller** -- Expose the service layer via HTTP endpoints. Depends on TG3 for service methods.
5. **Task Group 5: Integration Tests and Gap Analysis** -- Review all tests, fill critical gaps, and run final verification. Depends on TG1-TG4 being complete.

---

## Files Created or Modified (Summary)

| Action   | File Path |
|----------|-----------|
| CREATE   | `architecture-model-service/src/main/resources/db/changelog/sql/044-delivery-teams.sql` |
| CREATE   | `architecture-model-service/src/main/resources/db/changelog/sql/045-work-item-delivery-team-id.sql` |
| MODIFY   | `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` |
| CREATE   | `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DeliveryTeamType.java` |
| CREATE   | `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DeliveryTeamEntity.java` |
| MODIFY   | `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/WorkItemEntity.java` |
| CREATE   | `architecture-model-service/src/main/java/com/example/architecturemodel/repository/DeliveryTeamRepository.java` |
| CREATE   | `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DeliveryTeamDto.java` |
| CREATE   | `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/DeliveryTeamMapper.java` |
| CREATE   | `architecture-model-service/src/main/java/com/example/architecturemodel/service/DeliveryTeamService.java` |
| CREATE   | `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DeliveryTeamController.java` |
| CREATE   | `architecture-model-service/src/test/java/com/example/architecturemodel/migration/DeliveryTeamMigrationTest.java` |
| CREATE   | `architecture-model-service/src/test/java/com/example/architecturemodel/repository/DeliveryTeamRepositoryTest.java` |
| CREATE   | `architecture-model-service/src/test/java/com/example/architecturemodel/service/DeliveryTeamServiceTest.java` |
| CREATE   | `architecture-model-service/src/test/java/com/example/architecturemodel/controller/DeliveryTeamControllerTest.java` |
| CREATE   | `architecture-model-service/src/test/java/com/example/architecturemodel/integration/DeliveryTeamIntegrationTest.java` |

**Total production files:** 11 (9 new, 2 modified)
**Total test files:** 5 (all new)

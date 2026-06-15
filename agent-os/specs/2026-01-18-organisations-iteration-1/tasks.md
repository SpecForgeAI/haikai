# Task Breakdown: Organisations Iteration 1

## Overview
Total Tasks: 28

This feature introduces a new Organisation entity with unique name constraint and establishes a 1:M relationship from Organisation to Project via a foreign key on the Project table. Full CRUD API support for organisations and updated project create/update flows are included.

## Task List

### Database Layer

#### Task Group 1: Schema Migration and Data Models
**Dependencies:** None

- [x] 1.0 Complete database layer for Organisation
  - [x] 1.1 Write 4-6 focused tests for Organisation entity and repository
    - Test OrganisationEntity basic construction and field mapping
    - Test OrganisationRepository.findByName() returns organisation when exists
    - Test OrganisationRepository.existsByName() returns true/false correctly
    - Test OrganisationRepository.findAllByOrderByNameAsc() returns sorted list
    - Test unique constraint violation throws exception (integration test)
  - [x] 1.2 Create Liquibase migration 029-organisations.sql
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/029-organisations.sql`
    - CREATE TABLE `organisations` with columns: `id` (UUID PK), `name` (TEXT NOT NULL UNIQUE), `description` (TEXT nullable)
    - Add UNIQUE index on `name` column
    - ALTER TABLE `project` ADD COLUMN `organisation_id` UUID NULLABLE
    - ADD FK constraint on `project.organisation_id` REFERENCES `organisations(id)` ON DELETE RESTRICT
    - Follow existing migration patterns (header comment referencing spec)
  - [x] 1.3 Update Liquibase changelog to include new migration
    - Add changeset entry for 029-organisations.sql in `db.changelog-master.yaml`
  - [x] 1.4 Create OrganisationEntity.java
    - Package: `com.example.architecturemodel.model.entity`
    - Fields: UUID id, String name, String description
    - Annotations: @Entity, @Table(name = "organisations"), @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder
    - @Column annotations with nullable specifications
    - Follow ProjectEntity.java pattern
  - [x] 1.5 Create OrganisationRepository.java
    - Package: `com.example.architecturemodel.repository`
    - Extends JpaRepository<OrganisationEntity, UUID>
    - Methods: findByName(String name), existsByName(String name), findAllByOrderByNameAsc()
    - Follow ProjectRepository.java pattern
  - [x] 1.6 Update ProjectEntity.java to add organisationId field
    - Add field: `UUID organisationId` with @Column(name = "organisation_id", nullable = true)
    - Field is nullable to support safe migration (existing projects have NULL)
  - [x] 1.7 Ensure database layer tests pass
    - Run ONLY the tests written in 1.1
    - Verify migration runs successfully against test database
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Migration 029 creates organisations table with unique name constraint
- Migration 029 adds nullable organisation_id FK column to project table
- OrganisationEntity maps correctly to organisations table
- OrganisationRepository query methods work as expected
- ProjectEntity includes new organisationId field
- The 4-6 tests from 1.1 pass

### Service Layer

#### Task Group 2: Organisation Service Implementation
**Dependencies:** Task Group 1

- [x] 2.0 Complete service layer for Organisation
  - [x] 2.1 Write 4-6 focused tests for OrganisationService
    - Test createOrganisation() with valid name creates organisation
    - Test createOrganisation() with duplicate name throws ConflictException
    - Test createOrganisation() with blank name throws IllegalArgumentException
    - Test listOrganisations() returns ordered list
    - Test getOrganisationByName() returns organisation when found
    - Test getOrganisationByName() throws ResourceNotFoundException when not found
  - [x] 2.2 Create OrganisationDto.java
    - Package: `com.example.architecturemodel.model.dto`
    - Java record with fields: UUID id, String name, String description
    - Use @JsonAlias annotations for camelCase compatibility
    - Follow ProjectDto.java pattern
  - [x] 2.3 Create OrganisationListItemDto.java
    - Package: `com.example.architecturemodel.model.dto`
    - Java record with fields: UUID id, String name (subset for list responses)
    - Use @JsonAlias annotations for camelCase compatibility
  - [x] 2.4 Create OrganisationMapper.java
    - Package: `com.example.architecturemodel.mapper`
    - Methods: toDto(OrganisationEntity), toListItemDto(OrganisationEntity), toEntity(OrganisationDto)
    - Follow existing mapper patterns
  - [x] 2.5 Create OrganisationService.java
    - Package: `com.example.architecturemodel.service`
    - Inject OrganisationRepository
    - Method: listOrganisations() - returns List<OrganisationListItemDto> ordered by name
    - Method: getOrganisationByName(String name) - returns OrganisationDto or throws ResourceNotFoundException
    - Method: getOrganisationById(UUID id) - returns OrganisationDto or throws ResourceNotFoundException
    - Method: createOrganisation(String name, String description) - validates name non-empty, checks duplicate, returns OrganisationDto
    - Use @Transactional annotations appropriately
  - [x] 2.6 Ensure service layer tests pass
    - Run ONLY the tests written in 2.1
    - Verify all service methods work as expected
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- OrganisationDto and OrganisationListItemDto records exist with proper JSON annotations
- OrganisationMapper converts between entity and DTOs correctly
- OrganisationService validates input, handles duplicates with 409, and returns ordered lists
- The 4-6 tests from 2.1 pass

### API Layer

#### Task Group 3: Organisation Controller and Project Integration
**Dependencies:** Task Group 2

- [x] 3.0 Complete API layer for Organisations
  - [x] 3.1 Write 6-8 focused tests for Organisation API endpoints
    - Test GET /api/v1/organisations returns empty array when no organisations
    - Test GET /api/v1/organisations returns ordered list of organisations
    - Test GET /api/v1/organisations/by-name/{name} returns organisation when found
    - Test GET /api/v1/organisations/by-name/{name} returns 404 when not found
    - Test POST /api/v1/organisations creates organisation and returns 201
    - Test POST /api/v1/organisations returns 400 for blank name
    - Test POST /api/v1/organisations returns 409 for duplicate name
    - Test POST /api/projects with organisationId links project to organisation
  - [x] 3.2 Create OrganisationController.java
    - Package: `com.example.architecturemodel.controller`
    - Base path: @RequestMapping("/api/v1/organisations")
    - Inner record: CreateOrganisationRequest(String name, String description) with @JsonAlias
    - Inject OrganisationService
  - [x] 3.3 Implement GET /api/v1/organisations endpoint
    - Returns List<OrganisationListItemDto> with HTTP 200
    - Call organisationService.listOrganisations()
  - [x] 3.4 Implement GET /api/v1/organisations/by-name/{name} endpoint
    - Path variable: name (exact organisation name)
    - Returns OrganisationDto with HTTP 200
    - Throws ResourceNotFoundException (HTTP 404) if not found
  - [x] 3.5 Implement POST /api/v1/organisations endpoint
    - Request body: CreateOrganisationRequest
    - Returns OrganisationDto with HTTP 201
    - Validate name is non-empty (400)
    - Check duplicate name (409)
  - [x] 3.6 Update ProjectDto.java to include organisationId
    - Add field: UUID organisationId with @JsonAlias("organisationId")
  - [x] 3.7 Update ProjectMapper.java to map organisationId
    - Update toDto() to include organisationId from entity
    - Update toEntity() if applicable
  - [x] 3.8 Update CreateProjectRequest in ProjectController.java
    - Add fields: String organisationName (optional), UUID organisationId (optional)
    - Add @JsonAlias annotations for both camelCase and snake_case
  - [x] 3.9 Update ProjectService.createProject() to accept organisationId
    - Add UUID organisationId parameter
    - If organisationId provided: validate organisation exists via OrganisationService
    - If organisationName provided: lookup by exact name, fail with 400 if not found
    - Set organisationId on ProjectEntity before save
    - Update existing callers to pass null for organisationId (backward compatible)
  - [x] 3.10 Update ProjectController.createProject() to handle organisation
    - Resolve organisationName to organisationId if provided
    - Pass organisationId to ProjectService
    - Handle ResourceNotFoundException from organisation lookup as 400 response
  - [x] 3.11 Ensure API layer tests pass
    - Run ONLY the tests written in 3.1
    - Verify all endpoints return correct status codes and response bodies
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- GET /api/v1/organisations returns ordered list of {id, name} objects
- GET /api/v1/organisations/by-name/{name} returns full org or 404
- POST /api/v1/organisations creates org with 201, validates name, handles duplicates
- POST /api/projects accepts organisationName or organisationId to link project
- ProjectDto now includes organisationId field
- The 6-8 tests from 3.1 pass

### Gateway Layer

#### Task Group 4: Gateway Proxy Routes
**Dependencies:** Task Group 3

- [x] 4.0 Complete Gateway proxy routes for Organisations
  - [x] 4.1 Write 3-4 focused tests for gateway organisation routes
    - Test GET /api/v1/organisations proxies to model-service
    - Test GET /api/v1/organisations/by-name/:name proxies with path param
    - Test POST /api/v1/organisations proxies request body
    - Test error responses are forwarded correctly
  - [x] 4.2 Create organisationRoutes.ts
    - File: `gateway/src/routes/organisations.ts`
    - Create Express Router with organisation endpoints
    - Use axios or fetch to proxy to architecture-model-service
    - Follow existing route patterns (chat.ts, orchestrations.ts)
  - [x] 4.3 Implement GET /api/v1/organisations proxy route
    - Proxy to architecture-model-service /api/v1/organisations
    - Forward response directly to client
    - Handle errors appropriately
  - [x] 4.4 Implement GET /api/v1/organisations/by-name/:name proxy route
    - Proxy to architecture-model-service /api/v1/organisations/by-name/{name}
    - Encode path parameter correctly
    - Forward response including 404 errors
  - [x] 4.5 Implement POST /api/v1/organisations proxy route
    - Proxy request body to architecture-model-service
    - Forward 201, 400, 409 responses appropriately
  - [x] 4.6 Register organisation routes in server.ts
    - Import organisationsRouter from routes
    - Mount at /api/v1/organisations in Express app
    - Update routes/index.ts to export new router
  - [x] 4.7 Ensure gateway tests pass
    - Run ONLY the tests written in 4.1
    - Verify proxy routes forward requests and responses correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Gateway exposes GET /api/v1/organisations proxied to model-service
- Gateway exposes GET /api/v1/organisations/by-name/:name with correct path encoding
- Gateway exposes POST /api/v1/organisations with request body forwarding
- All gateway routes handle errors and status codes correctly
- The 3-4 tests from 4.1 pass

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4-6 tests written by database layer (Task 1.1)
    - Review the 4-6 tests written by service layer (Task 2.1)
    - Review the 6-8 tests written by API layer (Task 3.1)
    - Review the 3-4 tests written by gateway layer (Task 4.1)
    - Total existing tests: approximately 17-24 tests
  - [x] 5.2 Analyze test coverage gaps for Organisation feature only
    - Identify critical workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Prioritize end-to-end workflows: create org -> create project with org -> verify linkage
    - Check for missing integration tests between service and controller layers
  - [x] 5.3 Write up to 6 additional strategic tests maximum
    - Integration test: Create organisation then create project linked to it
    - Integration test: Verify FK constraint prevents orphan projects (ON DELETE RESTRICT)
    - Controller test: Verify ProjectController rejects unknown organisationName with 400
    - Service test: Verify ProjectService sets organisationId correctly on entity
    - Edge case test: Organisation name with special characters
    - Edge case test: Organisation name with leading/trailing whitespace trimmed
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to Organisation feature
    - Expected total: approximately 23-30 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 23-30 tests total)
- Critical user workflows for Organisation feature are covered
- No more than 6 additional tests added to fill gaps
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:
1. **Database Layer** (Task Group 1) - Schema migration, entities, repositories
2. **Service Layer** (Task Group 2) - DTOs, mapper, OrganisationService
3. **API Layer** (Task Group 3) - OrganisationController, ProjectController integration
4. **Gateway Layer** (Task Group 4) - Proxy routes for frontend access
5. **Test Review & Gap Analysis** (Task Group 5) - Fill critical test gaps

## Key Files to Create/Modify

### New Files
| File | Description |
|------|-------------|
| `architecture-model-service/src/main/resources/db/changelog/sql/029-organisations.sql` | Liquibase migration |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/OrganisationEntity.java` | JPA entity |
| `architecture-model-service/src/main/java/com/example/architecturemodel/repository/OrganisationRepository.java` | Spring Data repository |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/OrganisationDto.java` | Full DTO record |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/OrganisationListItemDto.java` | List DTO record |
| `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/OrganisationMapper.java` | Entity-DTO mapper |
| `architecture-model-service/src/main/java/com/example/architecturemodel/service/OrganisationService.java` | Business logic service |
| `architecture-model-service/src/main/java/com/example/architecturemodel/controller/OrganisationController.java` | REST controller |
| `gateway/src/routes/organisations.ts` | Express proxy router |

### Modified Files
| File | Change Description |
|------|-------------------|
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | Include new migration |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ProjectEntity.java` | Add organisationId field |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ProjectDto.java` | Add organisationId field |
| `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/ProjectMapper.java` | Map organisationId |
| `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectController.java` | Add org fields to CreateProjectRequest |
| `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectService.java` | Handle organisationId in createProject |
| `gateway/src/routes/index.ts` | Export organisationsRouter |
| `gateway/src/server.ts` | Mount organisation routes |

## Notes

- Migration uses nullable FK for safe migration; NOT NULL enforcement deferred to future iteration
- Existing projects will have NULL organisation_id until manually backfilled
- No UI changes in this iteration (backend-only)
- No organisation update/delete APIs in this iteration
- Gateway routes are simple pass-through proxies with no additional logic

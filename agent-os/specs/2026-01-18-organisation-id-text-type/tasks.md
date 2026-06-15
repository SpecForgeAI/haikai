# Task Breakdown: Organisation ID Type Change (UUID to TEXT)

## Overview
Total Tasks: 21

This task list covers the migration of `organisation.id` from UUID to TEXT type across the database, persistence layer, DTOs, services, and controllers. The frontend already uses string IDs, so no UI changes are required.

## Task List

### Database Layer

#### Task Group 1: Database Migration
**Dependencies:** None

- [x] 1.0 Complete database migration for Organisation ID type change
  - [x] 1.1 Write 3-4 focused tests for migration validation
    - Test that `organisations.id` column accepts TEXT values
    - Test that `project.organisation_id` column accepts TEXT values
    - Test that FK constraint `fk_project_organisation` is properly enforced
    - Test that prefixed IDs (e.g., "org-xxxx") can be inserted
  - [x] 1.2 Create Liquibase migration script `030-organisation-id-text.sql`
    - Add changeset with appropriate preconditions
    - Drop existing FK constraint `fk_project_organisation` from `project` table
    - Alter `organisations.id` column from UUID to TEXT
    - Alter `project.organisation_id` column from UUID to TEXT
    - Re-add FK constraint `fk_project_organisation` referencing TEXT columns
    - Follow existing migration patterns from `020-xxx.sql` or similar
  - [x] 1.3 Verify migration runs successfully
    - Run Liquibase migration against local database
    - Confirm no errors during constraint drop/add operations
    - Verify column types are correctly changed
  - [x] 1.4 Ensure database layer tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify TEXT IDs can be inserted and queried
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Migration script executes without errors
- `organisations.id` column is TEXT type
- `project.organisation_id` column is TEXT type
- FK constraint properly enforces referential integrity with TEXT IDs
- The 3-4 tests written in 1.1 pass

---

### Persistence Layer

#### Task Group 2: Entity and Repository Updates
**Dependencies:** Task Group 1

- [x] 2.0 Complete persistence layer updates
  - [x] 2.1 Write 4-5 focused tests for entity and repository changes
    - Test OrganisationEntity can be created with String id
    - Test OrganisationEntity can be persisted and retrieved by String id
    - Test ProjectEntity can be created with String organisationId
    - Test OrganisationRepository.findById works with String parameter
    - Test ProjectRepository queries work with String organisationId
  - [x] 2.2 Update OrganisationEntity
    - Change `private UUID id` to `private String id`
    - Remove `import java.util.UUID` if no longer needed
    - Ensure `@Id` annotation remains compatible with String type
    - Keep all other fields and annotations unchanged
    - File: `OrganisationEntity.java`
  - [x] 2.3 Update OrganisationRepository
    - Change interface from `JpaRepository<OrganisationEntity, UUID>` to `JpaRepository<OrganisationEntity, String>`
    - Remove UUID import
    - Keep query methods unchanged: `findByName`, `existsByName`, `findAllByOrderByNameAsc`
    - File: `OrganisationRepository.java`
  - [x] 2.4 Update ProjectEntity
    - Change `private UUID organisationId` to `private String organisationId`
    - Keep UUID import if still needed for `id` field
    - Keep `@Column(nullable = true)` annotation unchanged
    - File: `ProjectEntity.java`
  - [x] 2.5 Ensure persistence layer tests pass
    - Run ONLY the 4-5 tests written in 2.1
    - Verify entities can be saved and retrieved
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- OrganisationEntity uses String id field
- OrganisationRepository uses String as ID type parameter
- ProjectEntity uses String organisationId field
- The 4-5 tests written in 2.1 pass
- No compilation errors in persistence layer

---

### DTO Layer

#### Task Group 3: DTO Updates
**Dependencies:** Task Group 2

- [x] 3.0 Complete DTO layer updates
  - [x] 3.1 Write 3-4 focused tests for DTO serialization/deserialization
    - Test OrganisationDto serializes with String id
    - Test OrganisationListItemDto serializes with String id
    - Test ProjectDto serializes with String organisationId
    - Test JSON deserialization works with prefixed string IDs
  - [x] 3.2 Update OrganisationDto
    - Change record parameter from `UUID id` to `String id`
    - Remove UUID import
    - Keep all other record parameters unchanged
    - File: `OrganisationDto.java`
  - [x] 3.3 Update OrganisationListItemDto
    - Change record parameter from `UUID id` to `String id`
    - Remove UUID import
    - Keep all other record parameters unchanged
    - File: `OrganisationListItemDto.java`
  - [x] 3.4 Update ProjectDto
    - Change record parameter from `UUID organisationId` to `String organisationId`
    - Keep `@JsonAlias("organisationId")` annotation unchanged
    - Keep UUID import if needed for `id` field
    - File: `ProjectDto.java`
  - [x] 3.5 Verify OrganisationMapper requires no changes
    - Confirm mapper automatically handles String type from entity getter
    - No explicit code changes needed - just verification
    - File: `OrganisationMapper.java`
  - [x] 3.6 Ensure DTO layer tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify JSON serialization/deserialization works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- OrganisationDto uses String id
- OrganisationListItemDto uses String id
- ProjectDto uses String organisationId
- JSON serialization produces string IDs (not UUID format)
- The 3-4 tests written in 3.1 pass

---

### Service Layer

#### Task Group 4: Service Updates
**Dependencies:** Task Group 3

- [x] 4.0 Complete service layer updates
  - [x] 4.1 Write 4-5 focused tests for service layer changes
    - Test OrganisationService.createOrganisation generates "org-" prefixed ID
    - Test OrganisationService.getOrganisationById accepts String parameter
    - Test ProjectService.createProject accepts String organisationId
    - Test ProjectService correctly associates project with organisation using String ID
    - Test organisation lookup by ID returns correct organisation
  - [x] 4.2 Update OrganisationService ID generation
    - Change `.id(UUID.randomUUID())` to `.id("org-" + UUID.randomUUID().toString())`
    - Maintain existing logging and error handling patterns
    - File: `OrganisationService.java` (around line 114)
  - [x] 4.3 Update OrganisationService.getOrganisationById
    - Change method signature from `getOrganisationById(UUID id)` to `getOrganisationById(String id)`
    - Update any internal references to use String type
    - Maintain existing validation logic
    - File: `OrganisationService.java`
  - [x] 4.4 Update ProjectService.createProject
    - Change `UUID organisationId` parameter to `String organisationId`
    - Entity builder `.organisationId(organisationId)` remains unchanged
    - Maintain existing validation and conflict-checking logic
    - File: `ProjectService.java`
  - [x] 4.5 Ensure service layer tests pass
    - Run ONLY the 4-5 tests written in 4.1
    - Verify ID generation produces prefixed strings
    - Verify organisation lookup works with String IDs
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- New organisations receive "org-" prefixed string IDs
- getOrganisationById accepts String parameter
- ProjectService handles String organisationId correctly
- The 4-5 tests written in 4.1 pass
- No compilation errors in service layer

---

### Controller Layer

#### Task Group 5: Controller Updates
**Dependencies:** Task Group 4

- [x] 5.0 Complete controller layer updates
  - [x] 5.1 Write 2-3 focused tests for controller endpoints
    - Test organisation creation returns response with String id
    - Test project creation with String organisationId succeeds
    - Test listing organisations returns String IDs in response
  - [x] 5.2 Update ProjectController.resolveOrganisationId
    - Change return type from `UUID` to `String`
    - Change parameter type from `UUID organisationId` to `String organisationId`
    - Validation logic via `organisationService.getOrganisationById()` remains unchanged
    - File: `ProjectController.java`
  - [x] 5.3 Verify OrganisationController requires no changes
    - Confirm no ID-based endpoints exist currently
    - Document that future ID-based endpoints should accept String path variables
    - File: `OrganisationController.java`
  - [x] 5.4 Ensure controller layer tests pass
    - Run ONLY the 2-3 tests written in 5.1
    - Verify API responses contain String IDs
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- ProjectController.resolveOrganisationId returns String
- API responses contain String organisation IDs
- The 2-3 tests written in 5.1 pass
- No compilation errors in controller layer

---

### Integration Testing

#### Task Group 6: Test Review and Integration Validation
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and validate end-to-end integration
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review 3-4 database migration tests (Task 1.1)
    - Review 4-5 persistence layer tests (Task 2.1)
    - Review 3-4 DTO layer tests (Task 3.1)
    - Review 4-5 service layer tests (Task 4.1)
    - Review 2-3 controller layer tests (Task 5.1)
    - Total existing tests: approximately 16-21 tests
  - [x] 6.2 Analyze test coverage gaps for this feature
    - Identify critical workflows lacking coverage
    - Focus on end-to-end organisation and project creation flows
    - Prioritize FK constraint enforcement scenarios
  - [x] 6.3 Write up to 5 additional integration tests if needed
    - Test full organisation creation workflow (API to database)
    - Test full project creation with organisation association
    - Test organisation listing returns all organisations with String IDs
    - Test error handling when invalid organisation ID provided
    - Test FK constraint prevents orphaned projects
  - [x] 6.4 Run all feature-specific tests
    - Run all tests from Task Groups 1-5 plus any new tests from 6.3
    - Expected total: approximately 21-26 tests
    - Verify all critical workflows pass
    - Do NOT run unrelated application tests
  - [x] 6.5 Manual verification of acceptance criteria
    - Verify organisation can be created with TEXT id via API
    - Verify project can be linked to organisation via organisation_id
    - Verify listing organisations returns string IDs
    - Verify no UUID-related errors occur

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 21-26 tests)
- Full organisation creation workflow verified
- Full project-organisation association verified
- No UUID type errors in any layer
- Database constraints properly enforced

---

## Execution Order

Recommended implementation sequence:

1. **Database Layer (Task Group 1)** - Foundation must be in place first
   - Migration must complete before any code changes can be tested

2. **Persistence Layer (Task Group 2)** - Entities and repositories
   - Depends on database schema being updated
   - Required before DTOs can be updated

3. **DTO Layer (Task Group 3)** - Data transfer objects
   - Depends on entity types being correct
   - Required before services can compile

4. **Service Layer (Task Group 4)** - Business logic
   - Depends on DTOs and entities
   - Required before controllers can be updated

5. **Controller Layer (Task Group 5)** - API endpoints
   - Depends on services and DTOs
   - Final code layer before integration testing

6. **Integration Testing (Task Group 6)** - End-to-end validation
   - Depends on all code layers being complete
   - Final verification before completion

---

## Files Modified Summary

| File | Change Type |
|------|-------------|
| `030-organisation-id-text.sql` | New migration script |
| `OrganisationEntity.java` | UUID id -> String id |
| `OrganisationRepository.java` | JpaRepository<..., UUID> -> JpaRepository<..., String> |
| `ProjectEntity.java` | UUID organisationId -> String organisationId |
| `OrganisationDto.java` | UUID id -> String id |
| `OrganisationListItemDto.java` | UUID id -> String id |
| `ProjectDto.java` | UUID organisationId -> String organisationId |
| `OrganisationService.java` | ID generation + method signature |
| `ProjectService.java` | UUID organisationId -> String organisationId |
| `ProjectController.java` | UUID organisationId -> String organisationId |

---

## Risk Considerations

1. **Migration on existing data**: If organisations exist with UUID values, they will be converted to TEXT representation. Verify existing data compatibility.

2. **FK constraint timing**: Dropping and re-adding FK constraint must happen in correct order to avoid constraint violations.

3. **Cascade effects**: Ensure no other entities reference `organisation.id` beyond `project.organisation_id`.

4. **API contract**: While frontend already uses strings, verify any other API consumers are compatible with string IDs.

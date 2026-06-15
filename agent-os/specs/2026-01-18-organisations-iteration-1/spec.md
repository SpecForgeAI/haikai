# Specification: Organisations Iteration 1 - Add Organisation Model + Project FK + APIs

## Goal
Introduce a new Organisation entity with a unique name constraint and establish a 1:M relationship (Organisation to Project) via a foreign key on the Project table, with full CRUD API support for organisations and updated project creation/update flows.

## User Stories
- As a system administrator, I want to create organisations with unique names so that I can logically group projects under business entities.
- As a project owner, I want to associate my project with an existing organisation so that it belongs to the correct business context.

## Specific Requirements

**Organisation Table and Entity**
- Create `organisations` table with columns: `id` (UUID PK), `name` (TEXT NOT NULL UNIQUE), `description` (TEXT nullable)
- Add unique constraint on `name` to enforce organisation uniqueness at DB level
- Create `OrganisationEntity.java` JPA entity following ProjectEntity patterns (UUID id, Lombok annotations, @Builder, @PrePersist/@PreUpdate for timestamps if needed)
- Organisation name must be non-empty; validate at service layer with IllegalArgumentException

**Project FK to Organisation**
- Add `organisation_id` column to `project` table as UUID, initially NULLABLE for safe migration
- Add FK constraint referencing `organisations(id)` with ON DELETE RESTRICT to prevent orphaned projects
- Update `ProjectEntity.java` to include `organisationId` field (UUID, nullable initially)
- Do NOT auto-create organisations when creating projects; require explicit organisation reference

**Safe Migration Strategy**
- Migration 031: Create `organisations` table with id, name (UNIQUE), description columns
- Migration 031 also adds `organisation_id` column to `project` table as NULLABLE with FK constraint
- Existing projects will have NULL `organisation_id` until manually backfilled
- Future iteration will enforce NOT NULL after data migration is complete

**Organisation List API (GET /api/v1/organisations)**
- Return array of `{ id, name }` objects ordered by name ascending
- Create `OrganisationDto.java` as Java record with id, name, description fields
- Create `OrganisationListItemDto.java` as Java record with just id, name for list responses
- Use `OrganisationRepository.findAllByOrderByNameAsc()` query method

**Organisation by Name API (GET /api/v1/organisations/by-name/{name})**
- Path variable `name` is the exact organisation name to lookup
- Return full OrganisationDto `{ id, name, description }` if found
- Throw ResourceNotFoundException (HTTP 404) if not found

**Organisation Create API (POST /api/v1/organisations)**
- Request body: `{ name: string, description?: string }`
- Validate name is non-empty (IllegalArgumentException -> 400)
- Check for existing organisation with same name; throw ConflictException (HTTP 409) if duplicate
- Return created OrganisationDto with HTTP 201 status

**Project Create/Update with Organisation**
- Update `CreateProjectRequest` record in ProjectController to add `organisationName` and `organisationId` fields (both optional but one should be provided for new projects)
- If `organisationId` provided: validate organisation exists; link project to it
- If `organisationName` provided: lookup by exact name; if found, link project; if not found, return 400 with "Organisation not found"
- Update ProjectService.createProject() to accept organisationId parameter
- Update ProjectEntity and ProjectDto to include organisationId field

**Gateway Proxy Routes**
- Add pass-through routes in gateway to proxy to architecture-model-service
- Route GET `/api/v1/organisations` -> architecture-model-service
- Route GET `/api/v1/organisations/by-name/:name` -> architecture-model-service
- Route POST `/api/v1/organisations` -> architecture-model-service
- Use http-proxy-middleware or axios forwarding consistent with existing gateway patterns

## Visual Design
No visual mockups provided for this iteration (backend-only changes).

## Existing Code to Leverage

**ProjectEntity.java pattern**
- Follow same JPA entity structure: UUID id, Lombok @Getter/@Setter/@NoArgsConstructor/@AllArgsConstructor/@Builder
- Use @Column annotations with nullable/name specifications
- Organisation entity is simpler (no isActive, no parent folder) but follows same pattern

**ProjectDto.java pattern**
- Use Java record with @JsonAlias annotations for camelCase deserialization compatibility
- OrganisationDto should follow same pattern for consistency

**ProjectController.java pattern**
- OrganisationController at `/api/v1/organisations` should follow same structure
- Use inner record classes for request bodies (e.g., CreateOrganisationRequest)
- Return ResponseEntity with appropriate HTTP status codes

**ProjectRepository.java pattern**
- OrganisationRepository extends JpaRepository<OrganisationEntity, UUID>
- Add custom query methods: findByName(String), existsByName(String), findAllByOrderByNameAsc()

**Migration SQL patterns (013-project-table.sql, 027-project-hierarchy.sql)**
- Use same SQL formatting with header comments referencing spec
- CREATE TABLE with column definitions, then add indexes
- ALTER TABLE for adding columns to existing tables

## Out of Scope
- No UI changes in this iteration (handled in later iterations)
- No automatic backfill of existing projects to organisations
- No organisation editing/updating API (only create and read)
- No organisation deletion API
- No enforcement of NOT NULL on project.organisation_id (deferred to future migration)
- No authentication or authorization for organisation endpoints
- No organisation description editing UI
- No cascading updates when organisation name changes
- No organisation search/filtering beyond exact name lookup
- No validation that organisation has at least one project before any future deletion

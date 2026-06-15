# Specification: Organisation ID Type Change (UUID to TEXT)

## Goal
Change `organisation.id` from UUID to TEXT type throughout the system to maintain consistency with existing database patterns and resolve insertion errors caused by type mismatch.

## User Stories
- As a developer, I want organisation IDs to use the same TEXT pattern as other entities so that the data model is consistent across the system
- As an API consumer, I want organisation IDs returned as prefixed strings (e.g., "org-xxxx") so that they follow the established ID conventions

## Specific Requirements

**Database Migration (030-organisation-id-text.sql)**
- Create new Liquibase migration script `030-organisation-id-text.sql`
- Drop existing FK constraint `fk_project_organisation` from `project` table
- Alter `organisations.id` column from UUID to TEXT
- Alter `project.organisation_id` column from UUID to TEXT
- Re-add FK constraint `fk_project_organisation` referencing TEXT column
- Use Liquibase changeset with preconditions to ensure safe migration
- No pgcrypto or UUID generation functions required for organisations

**OrganisationEntity Changes**
- Change `private UUID id` to `private String id`
- Remove `import java.util.UUID`
- Keep all other fields and annotations unchanged
- Ensure `@Id` annotation works with String type

**OrganisationDto Changes**
- Change record parameter from `UUID id` to `String id`
- Remove UUID import
- No other changes required to the record structure

**OrganisationListItemDto Changes**
- Change record parameter from `UUID id` to `String id`
- Remove UUID import
- No other changes required

**OrganisationRepository Changes**
- Change interface from `JpaRepository<OrganisationEntity, UUID>` to `JpaRepository<OrganisationEntity, String>`
- Remove UUID import
- Keep all query methods unchanged (findByName, existsByName, findAllByOrderByNameAsc)

**OrganisationService ID Generation**
- Replace `UUID.randomUUID()` with `"org-" + UUID.randomUUID().toString()`
- Change `getOrganisationById(UUID id)` parameter to `String id`
- Prefix "org-" ensures IDs are human-identifiable as organisation IDs
- Maintain existing validation and conflict-checking logic

**OrganisationController Changes**
- No path variable changes needed (controller does not expose ID-based endpoints currently)
- Ensure any future ID-based endpoints accept String path variables

**OrganisationMapper Changes**
- No explicit changes needed - already maps `entity.getId()` directly to DTO
- Entity getter return type change will flow through automatically

**ProjectEntity Changes**
- Change `private UUID organisationId` to `private String organisationId`
- Remove UUID import if no longer needed (check id field type first)
- Update `@Column` annotation if necessary (nullable = true remains)

**ProjectDto Changes**
- Change record parameter from `UUID organisationId` to `String organisationId`
- Keep `@JsonAlias("organisationId")` annotation unchanged
- UUID import may still be needed for project `id` field

## Existing Code to Leverage

**Database Schema Pattern (schema.sql)**
- All existing tables use `TEXT PRIMARY KEY` pattern (model_files, applications, services, etc.)
- Follow existing `CREATE TABLE` conventions with TEXT id columns
- Reference existing FK patterns from `business_points`, `process_activities` etc.

**OrganisationService createOrganisation Method**
- Existing method already handles ID generation at line 114: `.id(UUID.randomUUID())`
- Simply change to string concatenation: `.id("org-" + UUID.randomUUID())`
- Maintain existing logging and error handling patterns

**Frontend organisationsApi.ts**
- Already defines `id: string` in both `OrganisationDto` and `OrganisationDtoSnake` interfaces
- No frontend changes required - backend change aligns with existing frontend types
- Mapping function `mapOrganisationFromSnake` already treats id as string

**ProjectController resolveOrganisationId Method**
- Currently returns `UUID`, will need to return `String`
- Validation logic via `organisationService.getOrganisationById()` remains the same
- Change parameter type from `UUID organisationId` to `String organisationId`

**ProjectService createProject Method**
- Currently accepts `UUID organisationId` parameter
- Change to `String organisationId` parameter
- Entity builder `.organisationId(organisationId)` remains unchanged

## Out of Scope
- No UI changes required (frontend already uses string IDs)
- No changes to organisation name uniqueness rules
- No migration or backfill of existing organisation data values (only type change)
- No changes to organisation description field handling
- No changes to organisation creation/listing API contracts (only ID type changes)
- No changes to other entities that don't reference organisations
- No introduction of new ID generation utilities (use simple string concatenation)
- No changes to Project entity `id` field (remains UUID per existing pattern)
- No changes to OrganisationController endpoint paths
- No renaming of database tables or columns (only type alteration)

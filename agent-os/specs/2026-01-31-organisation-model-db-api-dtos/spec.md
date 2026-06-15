# Specification: Organisation Model + DB + API DTOs (Backend Foundation)

## Goal

Extend the Architecture Model Service to persist and expose new Organisation fields needed for future "global standards generation", including six List<String> document categorization fields and a boolean techStandardsGenerated flag, with case-insensitive name uniqueness enforcement at the database level.

## User Stories

- As a backend service, I want to persist document categorization lists and standards generation state per organisation so that future standards generation features can access and update this configuration
- As an API consumer, I want case-insensitive uniqueness enforcement on organisation names so that "Acme" and "acme" cannot coexist as separate organisations

## Specific Requirements

**Database Migration - New Organisation Columns**
- Create Liquibase migration file `042-organisation-standards-fields.sql` in `architecture-model-service/src/main/resources/db/changelog/sql/`
- Add six TEXT columns for storing JSON-serialized List<String> values: `docs_applied_to_all_sources`, `docs_applied_to_tech_stack`, `docs_applied_to_coding_styles`, `docs_applied_to_conventions`, `docs_applied_to_error_handling`, `docs_applied_to_validation`
- Add BOOLEAN column `tech_standards_generated` with DEFAULT FALSE
- Group all docsAppliedTo* columns together, with techStandardsGenerated at the end
- All new columns should be nullable to maintain backward compatibility with existing data

**Database Migration - Case-Insensitive Unique Index**
- Replace or supplement the existing `idx_organisations_name` with a case-insensitive unique index
- Use `CREATE UNIQUE INDEX idx_organisations_name_ci ON organisations(LOWER(name))` pattern for PostgreSQL
- Drop the existing case-sensitive unique index if present to avoid conflicts
- The migration should be idempotent and safe to run on existing data

**Liquibase Changelog Entry**
- Add changeSet entry in `db.changelog-master.yaml` with id `042-organisation-standards-fields`
- Use precondition `columnExists: false` on `docs_applied_to_all_sources` to ensure idempotency
- Follow existing pattern: author `architecture-tool`, sqlFile reference, splitStatements true, stripComments true

**JPA AttributeConverter for List<String> to JSON**
- Create new class `StringListJsonConverter` in `com.example.architecturemodel.model.converter` package
- Implement `AttributeConverter<List<String>, String>` interface using Jackson ObjectMapper
- Handle null DB values by returning empty ArrayList (not null) in `convertToEntityAttribute`
- Handle null entity values by returning null (not empty JSON) in `convertToDatabaseColumn`
- Use @Converter annotation without autoApply (apply explicitly per field)

**OrganisationEntity Updates**
- Add seven new fields to `OrganisationEntity.java` with appropriate JPA annotations
- Apply `@Convert(converter = StringListJsonConverter.class)` to all six List<String> fields
- Use `@Builder.Default` to initialize List fields to `new ArrayList<>()` and techStandardsGenerated to `false`
- Column names should use snake_case: `docs_applied_to_all_sources`, etc.

**OrganisationDto Updates**
- Add seven new fields to the `OrganisationDto` record matching entity field names (camelCase)
- All List<String> fields should be non-null in the DTO (empty list if no data)
- Add @JsonAlias annotations for snake_case compatibility if needed

**OrganisationMapper Updates**
- Update `toDto()` method to map all seven new fields, converting null lists to empty lists
- Update `toEntity()` method to map all seven new fields from DTO to entity
- Update `toListItemDto()` - no changes needed as it only includes id and name

**OrganisationRepository Updates**
- Add `boolean existsByNameIgnoreCase(String name)` method for case-insensitive duplicate checking
- Add `Optional<OrganisationEntity> findByNameIgnoreCase(String name)` for case-insensitive lookup

**OrganisationService Updates**
- Modify `createOrganisation()` to use `existsByNameIgnoreCase()` for duplicate checking
- Throw `ConflictException` with message "Organisation with name 'X' already exists (case-insensitive)" for duplicates
- Ensure new fields are initialized with defaults when not provided during creation

**Snapshot Export Updates (ProjectSnapshotService)**
- No changes needed - OrganisationDto is not directly included in ProjectSnapshotDto
- ProjectDto includes organisationId FK only, which already works

**Snapshot Import Updates (ProjectSnapshotImportService)**
- No changes needed for this iteration - organisations are not imported via snapshot
- Future iteration may add organisation import if needed

**Error Handling - 409 Conflict Response**
- Continue using existing `ConflictException` class in `com.example.architecturemodel.exception`
- The existing `GlobalExceptionHandler.handleConflictException()` already returns proper 409 response
- Error response format: `{timestamp, status: 409, error: "Conflict", message: "..."}`

## Visual Design

No visual assets provided - this is a backend-only iteration with no UI changes.

## Existing Code to Leverage

**OrganisationEntity (architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/OrganisationEntity.java)**
- Existing entity with id, name, description fields using Lombok @Builder pattern
- Add new fields following the same @Column annotation pattern
- Use @Convert annotation for List<String> fields (new pattern for this service)

**WorkItemEntity JSON Column Pattern (architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/WorkItemEntity.java)**
- Uses `@Type(JsonType.class)` from hypersistence-utils for JSONB columns
- Alternative pattern available if AttributeConverter approach encounters issues
- Demonstrates Map<String, Object> JSON handling for PostgreSQL and H2 compatibility

**Existing Liquibase Migrations (architecture-model-service/src/main/resources/db/changelog/sql/)**
- Follow pattern from `029-organisations.sql` and `030-organisation-id-text.sql`
- Use consistent header comments with spec reference and step-by-step documentation
- Migration numbering: next available is `042-*.sql`

**GlobalExceptionHandler (architecture-model-service/src/main/java/com/example/architecturemodel/exception/GlobalExceptionHandler.java)**
- Already handles ConflictException -> 409 response with standard format
- No changes needed; just throw ConflictException from service layer

**OrganisationServiceTest (architecture-model-service/src/test/java/com/example/architecturemodel/service/OrganisationServiceTest.java)**
- Existing unit tests for createOrganisation, duplicate detection, listing
- Extend with tests for case-insensitive uniqueness and new field persistence

## Out of Scope

- Frontend Create Organisation modal or any UI changes
- Gateway changes or routing updates
- Calling external /api/v1/standards/global/generate endpoint
- Any orchestration or job handling for standards generation
- Soft-delete handling for organisations
- Audit columns (createdAt, updatedAt) for organisations
- Validation rules beyond name uniqueness (field length limits, format validation)
- Organisation import via project snapshot
- Updating organisation records (PUT/PATCH endpoints)
- Deleting organisations
- Assigning documents to organisations (only persisting the field structure)

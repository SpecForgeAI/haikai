# Task Breakdown: Organisation Model + DB + API DTOs (Backend Foundation)

## Overview
Total Tasks: 19 sub-tasks across 4 task groups

This spec extends the Organisation entity with new fields for document categorization and standards generation state, plus case-insensitive name uniqueness enforcement.

## Task List

### Database Layer

#### Task Group 1: Database Migration and Schema Changes
**Dependencies:** None

- [x] 1.0 Complete database migration layer
  - [x] 1.1 Write 4 focused tests for migration and schema validation
    - Test that new columns exist after migration (`docs_applied_to_all_sources`, etc.)
    - Test that `tech_standards_generated` column has DEFAULT FALSE
    - Test case-insensitive unique index prevents duplicate names (e.g., "Acme" vs "acme")
    - Test that existing organisations without new columns remain accessible (backward compatibility)
  - [x] 1.2 Create Liquibase migration file `042-organisation-standards-fields.sql`
    - File path: `architecture-model-service/src/main/resources/db/changelog/sql/042-organisation-standards-fields.sql`
    - Add six TEXT columns for JSON-serialized List<String>:
      - `docs_applied_to_all_sources`
      - `docs_applied_to_tech_stack`
      - `docs_applied_to_coding_styles`
      - `docs_applied_to_conventions`
      - `docs_applied_to_error_handling`
      - `docs_applied_to_validation`
    - Add BOOLEAN column `tech_standards_generated` with DEFAULT FALSE
    - All new columns should be nullable for backward compatibility
    - Follow header comment pattern from `029-organisations.sql`
  - [x] 1.3 Add case-insensitive unique index in same migration file
    - Drop existing `idx_organisations_name` index if present
    - Create `idx_organisations_name_ci` using `CREATE UNIQUE INDEX idx_organisations_name_ci ON organisations(LOWER(name))`
    - Ensure migration is idempotent and safe on existing data
  - [x] 1.4 Add changeSet entry in `db.changelog-master.yaml`
    - File path: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Use id: `042-organisation-standards-fields`
    - Author: `architecture-tool`
    - Precondition: `columnExists: false` on `docs_applied_to_all_sources`
    - Follow existing pattern with sqlFile, splitStatements: true, stripComments: true
  - [x] 1.5 Ensure database migration tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify migration runs successfully on clean database
    - Verify migration is idempotent (runs safely on already-migrated database)

**Acceptance Criteria:**
- Migration file `042-organisation-standards-fields.sql` exists with all 7 new columns
- Case-insensitive unique index `idx_organisations_name_ci` created
- Changelog entry added to `db.changelog-master.yaml`
- The 4 tests written in 1.1 pass
- Migration is idempotent and backward compatible

---

### JPA Converter Layer

#### Task Group 2: JPA AttributeConverter for List<String> JSON Serialization
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete JPA converter implementation
  - [x] 2.1 Write 4 focused tests for StringListJsonConverter
    - Test `convertToDatabaseColumn` with valid List<String> returns JSON string
    - Test `convertToDatabaseColumn` with null entity value returns null (not empty JSON)
    - Test `convertToEntityAttribute` with valid JSON returns List<String>
    - Test `convertToEntityAttribute` with null DB value returns empty ArrayList (not null)
  - [x] 2.2 Create converter package directory
    - Directory path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/converter/`
  - [x] 2.3 Create `StringListJsonConverter` class
    - File path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/converter/StringListJsonConverter.java`
    - Implement `AttributeConverter<List<String>, String>` interface
    - Use Jackson ObjectMapper for JSON serialization/deserialization
    - Use `@Converter` annotation without `autoApply` (apply explicitly per field)
    - Handle null DB values by returning `new ArrayList<>()` in `convertToEntityAttribute`
    - Handle null entity values by returning `null` in `convertToDatabaseColumn`
    - Add proper error handling for JSON parsing exceptions
  - [x] 2.4 Ensure converter tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify null handling behavior is correct in both directions

**Acceptance Criteria:**
- `StringListJsonConverter` class exists in converter package
- Implements `AttributeConverter<List<String>, String>` correctly
- Null handling matches spec requirements
- The 4 tests written in 2.1 pass

---

### Entity, DTO, and Mapper Layer

#### Task Group 3: Entity, DTO, Repository, and Mapper Updates
**Dependencies:** Task Group 1 (migration), Task Group 2 (converter)

- [x] 3.0 Complete entity/DTO/mapper layer updates
  - [x] 3.1 Write 6 focused tests for entity, DTO, mapper, and repository
    - Test OrganisationEntity builder initializes List fields to empty ArrayList by default
    - Test OrganisationEntity builder initializes `techStandardsGenerated` to false by default
    - Test OrganisationMapper.toDto() converts null lists to empty lists
    - Test OrganisationMapper.toEntity() maps all seven new fields correctly
    - Test `existsByNameIgnoreCase()` repository method returns true for case variations
    - Test `findByNameIgnoreCase()` repository method finds organisation regardless of case
  - [x] 3.2 Update `OrganisationEntity.java` with new fields
    - File path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/OrganisationEntity.java`
    - Add six `List<String>` fields with `@Convert(converter = StringListJsonConverter.class)`:
      - `docsAppliedToAllSources`
      - `docsAppliedToTechStack`
      - `docsAppliedToCodingStyles`
      - `docsAppliedToConventions`
      - `docsAppliedToErrorHandling`
      - `docsAppliedToValidation`
    - Add `Boolean techStandardsGenerated` field
    - Use `@Column(name = "snake_case_name")` for each field
    - Use `@Builder.Default` to initialize List fields to `new ArrayList<>()`
    - Use `@Builder.Default` to initialize `techStandardsGenerated` to `false`
    - Update spec reference comment at top of class
  - [x] 3.3 Update `OrganisationDto.java` with new fields
    - File path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/OrganisationDto.java`
    - Add seven new record fields matching entity field names (camelCase)
    - All List<String> fields should be non-null (empty list if no data)
    - Add `@JsonAlias` annotations for snake_case compatibility if needed
    - Update spec reference comment
  - [x] 3.4 Update `OrganisationRepository.java` with case-insensitive methods
    - File path: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/OrganisationRepository.java`
    - Add `boolean existsByNameIgnoreCase(String name)` method
    - Add `Optional<OrganisationEntity> findByNameIgnoreCase(String name)` method
    - Update spec reference comment
  - [x] 3.5 Update `OrganisationMapper.java` to map new fields
    - File path: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/OrganisationMapper.java`
    - Update `toDto()` method to map all seven new fields
    - Convert null lists to empty lists in `toDto()`
    - Update `toEntity()` method to map all seven new fields from DTO
    - No changes needed to `toListItemDto()` (only includes id and name)
    - Update spec reference comment
  - [x] 3.6 Ensure entity/DTO/mapper/repository tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify all mappings work correctly
    - Verify repository methods work with H2 test database

**Acceptance Criteria:**
- OrganisationEntity has all 7 new fields with proper JPA annotations
- OrganisationDto has all 7 new fields as record components
- OrganisationRepository has case-insensitive lookup methods
- OrganisationMapper handles all new fields with proper null->empty list conversion
- The 6 tests written in 3.1 pass

---

### Service Layer

#### Task Group 4: Service Layer Updates for Case-Insensitive Uniqueness
**Dependencies:** Task Group 3 (entity, repository, mapper)

- [x] 4.0 Complete service layer updates
  - [x] 4.1 Write 4 focused tests for service layer case-insensitive logic
    - Test `createOrganisation()` throws ConflictException when name differs only by case
    - Test ConflictException message contains "(case-insensitive)" text
    - Test `createOrganisation()` initializes new fields with defaults when not provided
    - Test that existing organisation retrieval includes new fields with default values
  - [x] 4.2 Update `OrganisationService.java` for case-insensitive duplicate checking
    - File path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/OrganisationService.java`
    - Modify `createOrganisation()` to use `existsByNameIgnoreCase()` instead of `existsByName()`
    - Update ConflictException message to: `"Organisation with name 'X' already exists (case-insensitive)"`
    - Ensure new fields are initialized with defaults when creating organisation
    - Update spec reference comment
  - [x] 4.3 Update existing `OrganisationServiceTest.java` tests
    - File path: `architecture-model-service/src/test/java/com/example/architecturemodel/service/OrganisationServiceTest.java`
    - Update duplicate name test to use `existsByNameIgnoreCase()` mock
    - Add new test for case-insensitive duplicate detection (e.g., "ACME" vs "acme")
    - Update test entity setup to include new fields where relevant
  - [x] 4.4 Ensure service layer tests pass
    - Run ONLY the 4 tests written in 4.1 plus updated existing tests
    - Verify case-insensitive uniqueness enforcement works correctly
    - Verify ConflictException is thrown with correct message

**Acceptance Criteria:**
- OrganisationService uses `existsByNameIgnoreCase()` for duplicate checking
- ConflictException includes "(case-insensitive)" in message
- New fields initialized with defaults during creation
- The 4 tests written in 4.1 pass
- Existing tests updated and passing

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Database Migration** - Creates the schema foundation
2. **Task Group 2: JPA Converter** - Can run in parallel with Task Group 1
3. **Task Group 3: Entity/DTO/Mapper/Repository** - Depends on Groups 1 and 2
4. **Task Group 4: Service Layer** - Depends on Group 3

**Parallel Execution Opportunity:** Task Groups 1 and 2 have no dependencies on each other and can be implemented simultaneously by different engineers or in parallel.

---

## File Reference Summary

| File | Action | Task Group |
|------|--------|------------|
| `architecture-model-service/src/main/resources/db/changelog/sql/042-organisation-standards-fields.sql` | CREATE | 1 |
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | UPDATE | 1 |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/converter/StringListJsonConverter.java` | CREATE | 2 |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/OrganisationEntity.java` | UPDATE | 3 |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/OrganisationDto.java` | UPDATE | 3 |
| `architecture-model-service/src/main/java/com/example/architecturemodel/repository/OrganisationRepository.java` | UPDATE | 3 |
| `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/OrganisationMapper.java` | UPDATE | 3 |
| `architecture-model-service/src/main/java/com/example/architecturemodel/service/OrganisationService.java` | UPDATE | 4 |
| `architecture-model-service/src/test/java/com/example/architecturemodel/service/OrganisationServiceTest.java` | UPDATE | 4 |

---

## Notes

- **No changes needed** to `ProjectSnapshotService` or `ProjectSnapshotImportService` per spec
- **No changes needed** to `GlobalExceptionHandler` - ConflictException handling already exists
- **Out of scope**: Frontend UI, gateway changes, standards generation orchestration, PUT/PATCH/DELETE endpoints
- All new database columns are nullable to maintain backward compatibility with existing data

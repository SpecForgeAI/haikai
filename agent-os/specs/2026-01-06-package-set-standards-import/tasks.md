# Task Breakdown: Package Set Standards Import (Iteration 6)

## Overview
Total Tasks: 6 Task Groups, ~35 Sub-tasks

This feature enables standards-driven Package Sets by importing pre-defined company-level and project-level package set definitions from JSON files, and resolves "Default (Auto)" for Services based on matching rules when `service.package_set_id` is null.

## Task List

### Database Layer

#### Task Group 1: Database Schema and Migrations
**Dependencies:** None

- [x] 1.0 Complete database schema for package set standards import
  - [x] 1.1 Write 4-6 focused tests for database schema
    - Test package_sets table accepts standard_key and standard_source columns
    - Test unique constraint on (model_file_id, standard_source, standard_key) for package_sets
    - Test packages table unique constraint on (model_file_id, package_set_id, name)
    - Test package_set_default_rules table CRUD operations
    - Test package_set_standards_import_status table CRUD operations
    - Test cascade delete behavior when model_file or package_set is deleted
  - [x] 1.2 Create Liquibase migration `018-package-set-standards-import.sql`
    - Add columns to `package_sets`: `standard_key` VARCHAR NULL, `standard_source` VARCHAR(16) NULL
    - Add partial unique constraint: `UNIQUE(model_file_id, standard_source, standard_key)` WHERE standard_source IS NOT NULL
    - Add columns to `packages`: `standard_source` VARCHAR(16) NULL, `standard_key` VARCHAR NULL
    - Add unique constraint on `packages`: `UNIQUE(model_file_id, package_set_id, name)`
    - Create `package_set_default_rules` table with columns: id (UUID PK), model_file_id (UUID FK), standard_source VARCHAR(16), package_set_id (UUID FK), core_tech_includes (JSONB), service_type_includes (JSONB), priority (INT), created_at, updated_at
    - Create `package_set_standards_import_status` table with columns: id (UUID PK), model_file_id (UUID FK), imported_at (TIMESTAMPTZ), company_file_path, project_file_path, company_revision, project_revision, inserted_sets, updated_sets, inserted_packages, updated_packages, inserted_rules, updated_rules
    - Add indexes on (model_file_id), (package_set_id), (standard_source) for default_rules table
  - [x] 1.3 Register migration in `db.changelog-master.yaml`
  - [x] 1.4 Ensure database layer tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify migration runs successfully
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Migration 018 runs without errors
- New columns exist on package_sets and packages tables
- New tables package_set_default_rules and package_set_standards_import_status created
- Unique constraints prevent duplicate imported package sets and packages
- Cascade deletes work correctly

---

#### Task Group 2: JPA Entities and Repositories
**Dependencies:** Task Group 1

- [x] 2.0 Complete JPA entities and repository layer
  - [x] 2.1 Write 4-6 focused tests for entities and repositories
    - Test PackageSetDefaultRuleEntity persistence and retrieval
    - Test PackageSetStandardsImportStatusEntity persistence and retrieval
    - Test repository query: find rules by model_file_id ordered by priority DESC
    - Test repository query: find import status by model_file_id
    - Test JSONB fields (core_tech_includes, service_type_includes) serialize/deserialize correctly
  - [x] 2.2 Update `PackageSetEntity` with new columns
    - Add fields: `standardKey` (String), `standardSource` (String)
    - Add appropriate JPA annotations for column mapping
  - [x] 2.3 Update `PackageEntity` with new columns
    - Add fields: `standardSource` (String), `standardKey` (String)
  - [x] 2.4 Create `PackageSetDefaultRuleEntity`
    - Fields: id, modelFileId, standardSource, packageSetId, coreTechIncludes (List<String>), serviceTypeIncludes (List<String>), priority, createdAt, updatedAt
    - Use `@Type(JsonType.class)` for JSONB fields (follow existing pattern)
    - Add ManyToOne relationship to PackageSetEntity
  - [x] 2.5 Create `PackageSetStandardsImportStatusEntity`
    - Fields: id, modelFileId, importedAt, companyFilePath, projectFilePath, companyRevision, projectRevision, insertedSets, updatedSets, insertedPackages, updatedPackages, insertedRules, updatedRules
  - [x] 2.6 Create `PackageSetDefaultRuleRepository` interface
    - Method: `List<PackageSetDefaultRuleEntity> findByModelFileIdOrderByPriorityDesc(UUID modelFileId)`
    - Method: `void deleteByModelFileIdAndStandardSource(UUID modelFileId, String standardSource)`
  - [x] 2.7 Create `PackageSetStandardsImportStatusRepository` interface
    - Method: `Optional<PackageSetStandardsImportStatusEntity> findTopByModelFileIdOrderByImportedAtDesc(UUID modelFileId)`
  - [x] 2.8 Ensure entity and repository tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify all CRUD operations work
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- All entity classes compile and map correctly to database tables
- Repository queries return expected results
- JSONB fields properly serialize/deserialize string arrays

---

### API Layer

#### Task Group 3: DTOs and Mapper Extensions
**Dependencies:** Task Group 2

- [x] 3.0 Complete DTOs and mapper layer
  - [x] 3.1 Write 3-5 focused tests for DTOs and mappers
    - Test PackageSetDefaultRuleDto serialization/deserialization
    - Test PackageSetStandardsImportStatusDto serialization/deserialization
    - Test EntityMapper correctly maps entity to DTO and vice versa
    - Test PackageSetDto includes new standardKey and standardSource fields
  - [x] 3.2 Update `PackageSetDto` record
    - Add fields: `standardKey` (String), `standardSource` (String)
    - Update `@JsonProperty` annotations as needed
  - [x] 3.3 Update `PackageDto` record
    - Add fields: `standardSource` (String), `standardKey` (String)
  - [x] 3.4 Create `PackageSetDefaultRuleDto` record
    - Fields: id, standardSource, packageSetId, coreTechIncludes (List<String>), serviceTypeIncludes (List<String>), priority
    - Add appropriate `@JsonProperty` annotations
  - [x] 3.5 Create `PackageSetStandardsImportStatusDto` record
    - Fields: id, modelFileId, importedAt, companyFilePath, projectFilePath, companyRevision, projectRevision, insertedSets, updatedSets, insertedPackages, updatedPackages, insertedRules, updatedRules
  - [x] 3.6 Create `PackageSetStandardsImportResultDto` record (for API response)
    - Fields: success, message, importStatus (PackageSetStandardsImportStatusDto)
  - [x] 3.7 Extend `EntityMapper` with new mapping methods
    - `toDto(PackageSetDefaultRuleEntity)` and `toEntity(PackageSetDefaultRuleDto)`
    - `toDto(PackageSetStandardsImportStatusEntity)` and `toEntity(...)`
    - Update existing `toDto/toEntity` for PackageSet and Package with new fields
  - [x] 3.8 Ensure DTO and mapper tests pass
    - Run ONLY the 3-5 tests written in 3.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- All DTOs serialize/deserialize correctly via Jackson
- EntityMapper correctly converts between entities and DTOs
- Existing PackageSet/Package DTOs include new standard fields

---

#### Task Group 4: Import Service and API Endpoints
**Dependencies:** Task Group 3

- [x] 4.0 Complete import service and API endpoints
  - [x] 4.1 Write 6-8 focused tests for import service and API
    - Test JSON parsing of standards file with packageSets and defaults
    - Test project-level overrides company-level on key conflict
    - Test deterministic UUID generation for imported package sets
    - Test delete-and-reinsert behavior for default rules
    - Test import counts are correctly recorded in status
    - Test POST /api/standards/package-sets/import endpoint returns expected response
    - Test GET /api/standards/package-sets/import-status returns last import or 404
    - Test error handling when no standards files exist
  - [x] 4.2 Create internal POJO for JSON parsing
    - Create `PackageSetStandardsJson` class with fields: packageSets (List), defaults (List)
    - Create nested `PackageSetStandardJson` class: key, name, packages (List)
    - Create nested `PackageStandardJson` class: name, purpose
    - Create nested `DefaultRuleJson` class: match (MatchJson), packageSetKey
    - Create nested `MatchJson` class: coreTechIncludes (List<String>), serviceTypeIncludes (List<String>)
  - [x] 4.3 Create `PackageSetStandardsImporter` service
    - Follow pattern from `RoadmapImportService` for project resolution
    - Implement `resolveStandardsPaths()`: return company and project file paths
    - Implement `parseStandardsFile(Path)`: read JSON, return parsed object or null if not exists
    - Implement `mergeStandards(companyJson, projectJson)`: project overrides company by key
    - Implement `generateDeterministicUuid(modelFileId, standardSource, standardKey)`: use UUID v5 or hash-based approach
    - Implement `importStandards(UUID modelFileId)`: main orchestration method
      - Upsert package_sets by (model_file_id, standard_source, standard_key)
      - Upsert packages by (model_file_id, package_set_id, name)
      - Delete-and-reinsert rules per source in transaction
      - Write import status with counts
  - [x] 4.4 Create `PackageSetStandardsController`
    - `POST /api/standards/package-sets/import`: call importer, return PackageSetStandardsImportResultDto
    - `GET /api/standards/package-sets/import-status`: return last status or 404
    - Derive model_file_id from current opened file context (follow ModelService pattern)
  - [x] 4.5 Extend `/api/model` response with default rules
    - Add `packageSetDefaultRules` field to `MetaModelEntitiesDto` or new standards section
    - Query rules by model_file_id in ModelService.loadModel()
    - Map to DTOs using EntityMapper
  - [x] 4.6 Ensure import service and API tests pass
    - Run ONLY the 6-8 tests written in 4.1
    - Verify import creates expected entities
    - Verify API endpoints return correct responses
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Import service successfully parses JSON and persists entities
- Project-level standards override company-level on key conflicts
- Deterministic UUIDs ensure idempotent imports
- API endpoints work correctly
- /api/model response includes packageSetDefaultRules array

---

### Frontend Layer

#### Task Group 5: Import UI and Status Display
**Dependencies:** Task Group 4

- [x] 5.0 Complete frontend import functionality
  - [x] 5.1 Write 4-6 focused tests for import UI
    - Test import button renders on Package Sets screen
    - Test clicking import button calls POST /api/standards/package-sets/import
    - Test success response triggers model refresh
    - Test import status displays after successful import
    - Test error message displays on import failure
  - [x] 5.2 Add TypeScript types for new DTOs
    - Add `PackageSetDefaultRule` interface in `model.ts`
    - Add `PackageSetStandardsImportStatus` interface
    - Add `PackageSetStandardsImportResult` interface
    - Extend `PackageSet` and `Package` types with standardKey, standardSource
  - [x] 5.3 Add import API functions in `fileOperations.ts` or new service file
    - `importPackageSetStandards()`: POST /api/standards/package-sets/import
    - `getPackageSetStandardsImportStatus()`: GET /api/standards/package-sets/import-status
  - [x] 5.4 Update `PackageSetsView.tsx` with import button
    - Add "Import Package Set Standards" button in header next to "Create Package Set"
    - Add state for loading and import status
    - On click: call import API, handle loading state
    - On success: refresh model via context, display inline status (time + counts)
    - On error: display error message with file path details
  - [x] 5.5 Add import status display component
    - Show last imported timestamp
    - Show counts: inserted/updated sets, packages, rules
    - Style inline in Package Sets header area
  - [x] 5.6 Ensure import UI tests pass
    - Run ONLY the 4-6 tests written in 5.1
    - Verify button functionality
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Import button appears on Package Sets screen
- Clicking import triggers API call with loading indicator
- Success refreshes model and shows status
- Errors display clearly with actionable information

---

#### Task Group 6: Service Package Set Default Resolution Display
**Dependencies:** Task Group 5

- [x] 6.0 Complete default resolution display in Service Package Set dropdown
  - [x] 6.1 Write 4-6 focused tests for default resolution
    - Test resolution logic selects highest priority matching rule
    - Test resolution returns null when no rules match
    - Test tie-breaker: PROJECT source wins over COMPANY for same priority
    - Test display shows "Default (Auto) -> <Name>" when matched
    - Test display shows "Default (Auto) (no match)" when unmatched
    - Test package preview renders for resolved default
  - [x] 6.2 Create `useDefaultPackageSetResolution` hook or utility function
    - Accept: service (with core_tech, service_type), rules array, packageSets array
    - Implement matching logic:
      - Filter rules where ALL coreTechIncludes substrings appear in service.core_tech (case-insensitive)
      - Filter rules where ALL serviceTypeIncludes substrings appear in service.service_type (case-insensitive)
      - Sort by priority DESC, then by standardSource (PROJECT > COMPANY)
      - Return first match's packageSetId, or null
    - Return: resolved packageSetId, resolved packageSet name, hasMatch boolean
  - [x] 6.3 Update `PackageSetCell.tsx` for resolution display
    - Extend props to accept: defaultRules, service (for core_tech, service_type), packageSets
    - Use resolution hook/utility to compute best match when service.package_set_id is null
    - Update display text:
      - When matched: "Default (Auto) -> {resolvedPackageSetName}"
      - When unmatched: "Default (Auto) (no match)"
    - IMPORTANT: Do NOT write resolved id to service.package_set_id
  - [x] 6.4 Update package preview for resolved default
    - When in Default (Auto) mode and match exists, show PackageSetPreview for resolved set
    - Use existing PackageSetPreview component pattern
  - [x] 6.5 Wire props through Service grid/form components
    - Pass defaultRules from model context to PackageSetCell
    - Pass current service data (core_tech, service_type) to PackageSetCell
    - Pass packageSets for name lookup
  - [x] 6.6 Ensure default resolution tests pass
    - Run ONLY the 4-6 tests written in 6.1
    - Verify resolution logic works correctly
    - Verify display updates appropriately
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Service Package Set dropdown shows resolved default when set to "Default (Auto)"
- Resolution follows priority and source precedence rules
- Package preview displays for resolved default
- No automatic write-back to service.package_set_id

---

### Testing

#### Task Group 7: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review 4-6 tests from database layer (Task 1.1)
    - Review 4-6 tests from entity/repository layer (Task 2.1)
    - Review 3-5 tests from DTO/mapper layer (Task 3.1)
    - Review 6-8 tests from import service/API layer (Task 4.1)
    - Review 4-6 tests from import UI (Task 5.1)
    - Review 4-6 tests from default resolution (Task 6.1)
    - Total existing tests: approximately 25-37 tests
  - [x] 7.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus on integration points between backend and frontend
    - Prioritize: full import flow, resolution accuracy, error handling
  - [x] 7.3 Write up to 8 additional strategic tests maximum
    - E2E test: Import from both company and project files, verify merge behavior
    - E2E test: Re-import updates existing records without duplicates
    - E2E test: Service with matching core_tech/service_type shows correct resolved default
    - Integration test: Import failure (invalid JSON) returns proper error
    - Integration test: Delete model cascades deletes imported standards
    - Add other critical gap tests as identified (max 8 total)
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 33-45 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass
- Critical user workflows for package set standards import are covered
- No more than 8 additional tests added
- Testing focused exclusively on this feature's requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Database Schema and Migrations** - Foundation for all other work
2. **Task Group 2: JPA Entities and Repositories** - Enables data access
3. **Task Group 3: DTOs and Mapper Extensions** - Enables API contracts
4. **Task Group 4: Import Service and API Endpoints** - Core backend functionality
5. **Task Group 5: Import UI and Status Display** - Frontend import capability
6. **Task Group 6: Service Package Set Default Resolution Display** - Frontend resolution display
7. **Task Group 7: Test Review and Gap Analysis** - Final quality assurance

**Parallel Opportunities:**
- Task Groups 5 and 6 can be worked in parallel after Task Group 4 completes
- TypeScript types (5.2) can begin as soon as DTOs are defined (after 3.x)

---

## Key Implementation Notes

### Deterministic UUID Generation
```java
// Example approach for deterministic UUID
public static UUID generateDeterministicUuid(UUID modelFileId, String source, String key) {
    String combined = modelFileId.toString() + ":" + source + ":" + key;
    return UUID.nameUUIDFromBytes(combined.getBytes(StandardCharsets.UTF_8));
}
```

### Matching Rule Algorithm
```typescript
// Pseudocode for rule matching
function matchRule(rule, service): boolean {
  const coreTechLower = (service.core_tech || '').toLowerCase();
  const serviceTypeLower = (service.service_type || '').toLowerCase();

  const coreTechMatches = rule.coreTechIncludes.every(
    keyword => coreTechLower.includes(keyword.toLowerCase())
  );
  const serviceTypeMatches = rule.serviceTypeIncludes.every(
    keyword => serviceTypeLower.includes(keyword.toLowerCase())
  );

  return coreTechMatches && serviceTypeMatches;
}
```

### Files to Reference
- `RoadmapImportService.java` - Pattern for project resolution and file reading
- `EntityMapper.java` - Pattern for DTO mapping
- `PackageSetsView.tsx` - Location for import button
- `PackageSetCell.tsx` - Location for resolution display
- `017-package-sets.sql` - Previous migration for context

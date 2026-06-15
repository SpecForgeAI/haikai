# Specification: Package Set Standards Import (Iteration 6)

## Goal
Enable standards-driven Package Sets by importing pre-defined company-level and project-level package set definitions from JSON files, and resolve "Default (Auto)" for Services based on matching rules when service.package_set_id is null.

## User Stories
- As an architect, I want to import package set standards from JSON files so that I can apply company/project conventions consistently across services.
- As a developer, I want the Service Package Set dropdown to show the resolved default when set to "Default (Auto)" so that I can see which Package Set will be applied based on the service's core_tech and service_type.

## Specific Requirements

**Liquibase Migration for Package Set Standards**
- Create SQL changelog `018-package-set-standards-import.sql` (next after 017-package-sets.sql)
- Add columns to `package_sets` table: `standard_key` VARCHAR NULL, `standard_source` VARCHAR(16) NULL
- Add unique constraint on `package_sets`: `(model_file_id, standard_source, standard_key)` for imported sets only
- Add columns to `packages` table: `standard_source` VARCHAR(16) NULL, `standard_key` VARCHAR NULL
- Add unique constraint on `packages`: `(model_file_id, package_set_id, name)` to prevent duplicate package names within a set
- Create new table `package_set_default_rules` with columns: id, model_file_id, standard_source, package_set_id, core_tech_includes (JSONB), service_type_includes (JSONB), priority (INT), created_at, updated_at
- Create new table `package_set_standards_import_status` with columns: id, model_file_id, imported_at, company_file_path, project_file_path, company_revision, project_revision, inserted_sets, updated_sets, inserted_packages, updated_packages, inserted_rules, updated_rules

**JSON Schema for Standards Files**
- Company-level path: `<project_parent_folder>/agent-os/company/architecture/package-sets.json`
- Project-level path: `<project_parent_folder>/agent-os/product/architecture/package-sets.json`
- Schema includes `packageSets` array with objects containing: `key` (unique string), `name` (display string), `packages` array
- Each package object contains: `name` (string), `purpose` (string optional)
- Schema includes `defaults` array with matching rule objects containing: `match` object with `coreTechIncludes` (string array) and `serviceTypeIncludes` (string array), plus `packageSetKey` (string)
- Both company and project files are optional; at least one must exist to import

**Matching Rule Semantics**
- `coreTechIncludes`: List of case-insensitive substrings that must ALL be present in Service.core_tech (free text field)
- `serviceTypeIncludes`: List of case-insensitive substrings that must ALL be present in Service.service_type (free text field)
- A rule matches if all specified lists match; empty list matches trivially
- If multiple rules match, choose most specific (highest total keyword count); tie-breaker: project-level wins over company-level
- `priority` field in DB stores computed specificity score: `len(coreTechIncludes) + len(serviceTypeIncludes)`

**PackageSetStandardsImporter Service**
- Follow pattern from `RoadmapImportService` for resolving active project and parent folder
- Parse JSON from company and project file paths; project-level definitions override company-level by matching `packageSet.key`
- Upsert `package_sets` by unique constraint `(model_file_id, standard_source, standard_key)`; use deterministic UUID derived from `model_file_id + standard_source + standard_key`
- Upsert `packages` by constraint `(model_file_id, package_set_id, name)`; maintain `sort_order` from array index
- Delete-and-reinsert all default rules per source within a transaction for simplicity
- Write import status row with file paths, revisions (file lastModified millis), and counts

**API Endpoints**
- `POST /api/standards/package-sets/import`: Imports standards for current active model file; returns summary counts and import metadata
- `GET /api/standards/package-sets/import-status`: Returns last import status for current model file; returns 404 if never imported
- Both endpoints derive `model_file_id` from current opened file context (follow existing pattern in ModelService)

**Expose Default Rules in /api/model Response**
- Extend `MetaModelRelationshipsDto` or add new `standards` section to include `package_set_default_rules` array
- Each rule DTO includes: id, standard_source, package_set_id, core_tech_includes (string array), service_type_includes (string array), priority
- Frontend receives rules alongside package_sets/packages in the model payload

**Frontend Import Button on Package Sets Screen**
- Add "Import Package Set Standards" button next to existing "Create Package Set" button in `PackageSetsView.tsx` header
- Clicking button calls `POST /api/standards/package-sets/import`
- On success: refresh model (re-fetch /api/model) to show imported sets; display inline status with last imported time and counts
- On error: show clear message including file path and parse error details

**Service Package Set Dropdown Default Resolution Display**
- Modify `PackageSetCell.tsx` to accept default rules and service entity as additional props
- When `service.package_set_id` is null (Default Auto mode), compute best-matching rule using service.core_tech and service.service_type
- Display format: "Default (Auto) -> <Resolved Package Set Name>" when match exists; "Default (Auto) (no match)" when no match
- Show package preview for resolved set when available using existing `PackageSetPreview` component
- IMPORTANT: Do NOT write resolved id back to `service.package_set_id` automatically; keep null unless user explicitly selects

## Existing Code to Leverage

**RoadmapImportService Pattern**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/service/RoadmapImportService.java`
- Follow pattern for resolving active project via `ProjectService.getActiveProjectEntity()`
- Use `Path.of(parentFolder).resolve(relativePath)` for file path resolution
- Pattern for reading file content with `Files.readString()` and error handling with `ResourceNotFoundException`

**EntityMapper for DTO Mapping**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
- Add `toDto/toEntity` methods for `PackageSetDefaultRuleDto` and `PackageSetStandardsImportStatusDto`
- Follow existing record-based DTO pattern with `@JsonProperty` annotations

**PackageSetsView.tsx for Button Placement**
- Located at `frontend/src/components/MetaModelView/PackageSetsView.tsx`
- Add import button in `masterHeader` div alongside existing "Create Package Set" button
- Follow existing pattern for modal state management and API calls

**PackageSetCell.tsx for Dropdown Enhancement**
- Located at `frontend/src/components/Grid/PackageSetCell.tsx`
- Extend props interface to accept `defaultRules` and `service` (for core_tech, service_type)
- Add resolution logic in component using `useMemo` to compute best match
- Modify display text generation to show resolved set name with arrow notation

**Existing Package Set and Service DTOs**
- `PackageSetDto` at `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/PackageSetDto.java` - extend with standard_key, standard_source
- `ServiceDto` has core_tech and service_type fields used for matching rules

## Out of Scope
- UI for authoring/editing standards JSON files directly in the application
- Auto-import of standards on application startup (can be added in future iteration)
- Language-specific package naming convention enforcement or validation
- "Apply resolved default" action that permanently sets package_set_id from resolved value
- Editing imported package sets/packages (they remain read-only/immutable)
- Validation that packageSetKey in defaults references existing packageSet in same file
- Real-time file watching for standards file changes
- Multiple model file support in single import operation
- Export of standards back to JSON files
- Version history or diff of standards imports

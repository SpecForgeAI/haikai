# Import Company/Project Package Set Standards from JSON and Resolve "Default (Auto)" for Services (Iteration 6)

## Title
Import company/project Package Set standards from JSON and resolve "Default (Auto)" for Services (Iteration 6)

## Intent
Enable standards-driven Package Sets by importing pre-defined company-level and project-level package set definitions from JSON files, and use their matching rules (based on Service "Core Tech" and "Service Type") to resolve the Service "Package Set" selection when it is set to "Default (Auto)" (i.e., service.package_set_id is null).

This iteration assumes the standards JSON files already exist on disk; creating/editing those files in the tool UI is out of scope.

## Scope
- **Backend (architecture-model-service):**
  - Standards JSON import (deterministic, repeatable) using active project parent folder
  - Persistence of imported package sets + packages + default matching rules
  - API to trigger import and retrieve last-import status
- **Frontend:**
  - Add "Import Package Set Standards" action on Package Sets screen
  - Update Service Package Set dropdown to display the resolved default package set name/preview when in Default (Auto)
  - No UI for editing standards rules/files

## Non-Goals
- UI to author standards files
- Auto-import on startup (optional; can be added later)
- Enforcing naming conventions for packages (language-specific)

---

## Standards File Locations (Filesystem)

- **Company-level:**
  `<project_parent_folder>/agent-os/company/architecture/package-sets.json`
- **Project-level:**
  `<project_parent_folder>/agent-os/product/architecture/package-sets.json`

**Notes:**
- Use the ACTIVE project's project_parent_folder (same principle as roadmap import).
- Project-level definitions take precedence over company-level when keys overlap.

---

## JSON Schema (v1)

```json
{
  "packageSets": [
    {
      "key": "JavaCrud",
      "name": "Java CRUD",
      "packages": [
        { "name": "controller", "purpose": "HTTP endpoints" },
        { "name": "service", "purpose": "Business orchestration" },
        { "name": "dto", "purpose": "Transport objects" },
        { "name": "model", "purpose": "Domain / persistence models" },
        { "name": "repo", "purpose": "Persistence access" },
        { "name": "util", "purpose": "Helpers" }
      ]
    }
  ],
  "defaults": [
    {
      "match": {
        "coreTechIncludes": ["java", "spring"],
        "serviceTypeIncludes": ["crud"]
      },
      "packageSetKey": "JavaCrud"
    }
  ]
}
```

---

## Matching Rules Semantics

- **coreTechIncludes:** List of case-insensitive substrings that must ALL be present in Service.core_tech (free text)
- **serviceTypeIncludes:** List of case-insensitive substrings that must ALL be present in Service.service_type (free text)
- A rule matches if all specified lists match (empty list matches trivially).
- If multiple rules match, choose the most specific (highest total keyword count), tie-breaker: project-level wins over company-level.

---

## Data Model Additions (DB)

### 1) package_sets table (add columns)
- Add columns to package_sets:
  - `standard_key` VARCHAR NULL - e.g., "JavaCrud" for imported sets; NULL for user-created sets
  - `standard_source` VARCHAR(16) NULL - "COMPANY" | "PROJECT" (for imported); NULL for user-created sets
- Add unique constraint for imported sets:
  `UNIQUE(model_file_id, standard_source, standard_key)`
  (Allows deterministic upsert without impacting user-created sets.)

### 2) packages table (add columns)
- Add columns:
  - `standard_source` VARCHAR(16) NULL
  - `standard_key` VARCHAR NULL - optional; can store "<packageSetKey>:<packageName>" if needed
- Add unique constraint to prevent duplicates for imported packages within a set:
  `UNIQUE(model_file_id, package_set_id, name)`

### 3) package_set_default_rules table (new)
- Table: `package_set_default_rules`
  - `id` UUID PK
  - `model_file_id` UUID NOT NULL (FK model_files.id ON DELETE CASCADE)
  - `standard_source` VARCHAR(16) NOT NULL - "COMPANY" | "PROJECT"
  - `package_set_id` UUID NOT NULL (FK package_sets.id ON DELETE CASCADE)
  - `core_tech_includes` JSONB NOT NULL default '[]'
  - `service_type_includes` JSONB NOT NULL default '[]'
  - `priority` INT NOT NULL default 0 - computed specificity score (keyword count)
  - `created_at`, `updated_at` timestamps
- Indexes:
  - (model_file_id)
  - (package_set_id)
  - (standard_source)

### 4) import status (persisted)
- Add table: `package_set_standards_import_status` (or reuse an existing "import status" pattern if present)
  - `id` UUID PK
  - `model_file_id` UUID NOT NULL FK
  - `imported_at` TIMESTAMPTZ NOT NULL
  - `company_file_path` VARCHAR
  - `project_file_path` VARCHAR
  - `company_revision` VARCHAR NULL (e.g., file lastModified millis or hash)
  - `project_revision` VARCHAR NULL
  - `inserted_sets` INT, `updated_sets` INT, `inserted_packages` INT, `updated_packages` INT, `inserted_rules` INT, `updated_rules` INT

---

## Backend Implementation

### 1) Liquibase
- Add SQL changelog:
  - `src/main/resources/db/changelog/sql/016-package-set-standards-import.sql`
- Include in master changelog.

### 2) Standards import service
- Add service: `PackageSetStandardsImporter`

**Responsibilities:**
- **Resolve active project:**
  - Read active Project from DB
  - Get project_parent_folder
- **Resolve file paths:**
  - `<parent>/agent-os/company/architecture/package-sets.json`
  - `<parent>/agent-os/product/architecture/package-sets.json`
- **Parse JSON if file exists:**
  - Company file is optional; project file is optional; at least one must exist to import.
- **Merge packageSets:**
  - Project overrides company by matching packageSet.key
- **Upsert package_sets:**
  - Determine existing row by (model_file_id, standard_source, standard_key)
  - If exists: update name (and updated_at)
  - If not: create new with deterministic UUID:
    - UUIDv5-like stable id derived from: model_file_id + standard_source + standard_key
    (Implement with a deterministic UUID function already used elsewhere; if none exists, add one.)
- **Upsert packages for each set:**
  - Use package_set_id from above
  - Upsert by (model_file_id, package_set_id, name)
  - Maintain sort_order based on array index (1..N)
  - Update purpose/sort_order on reimport
- **Upsert default rules:**
  - Resolve packageSetKey -> package_set_id (respect project/company source precedence)
  - Compute priority = len(coreTechIncludes) + len(serviceTypeIncludes)
  - Upsert rules by (model_file_id, standard_source, package_set_id, core_tech_includes, service_type_includes)
    - For v1, simplest is to delete-and-reinsert all rules for that source each import, within a transaction.
- **Write import status row** (counts + file revisions).

### 3) API endpoints
- **POST /api/standards/package-sets/import**
  - Imports standards for the current active model file (or current opened model context)
  - Returns summary counts + last imported data
- **GET /api/standards/package-sets/import-status**
  - Returns last import status (or 404 if never imported)

**Notes on model_file_id context:**
- If your backend has a single "current model file" loaded by filename/save/open, use that model_file_id.
- If model_file_id is passed in requests or derived from current opened file, follow the existing pattern.
- Do not introduce a second persistence context; standards are imported into the same model's package_sets/packages collections.

### 4) Expose rules to frontend
- Extend /api/model payload to include default rules:
  - `metaModel.standards.package_set_default_rules` (new section), OR
  - `metaModel.relationships/package_set_default_rules` if you keep everything flat

Include fields:
  - id, standard_source, package_set_id, core_tech_includes[], service_type_includes[], priority

---

## Frontend Implementation

### 1) Package Sets screen import action
- On Package Sets screen:
  - Add a button: "Import Package Set Standards"
  - Clicking calls POST /api/standards/package-sets/import
  - On success:
    - Refresh model (re-fetch /api/model) so imported sets appear
    - Show small inline status (last imported time + counts) in the Package Sets screen header
  - On error: show clear message (file missing/parse error/path shown)

### 2) Service "Default (Auto)" resolution display
- Update the Service Package Set selector:
  - If service.package_set_id is null (Default Auto):
    - Compute best-matching rule using:
      - service.core_tech text
      - service.service_type text
      - loaded rules list
    - Show display as:
      - "Default (Auto) → <Resolved Package Set Name>" when match exists
      - "Default (Auto) (no match)" when no match exists
    - Preview packages for the resolved set when available
- **IMPORTANT:** Do NOT write the resolved id back into service.package_set_id automatically. Keep it null unless the user explicitly selects a concrete package set.

### 3) Optional: "Apply resolved default" action (defer)
- Do NOT add in this iteration unless needed. Keep "Auto" purely computed.

---

## Constraints
- Imported package sets/packages remain immutable (consistent with overall design).
- User-created package sets (standard_key/source null) must not be modified by standards import.
- Project-level standards override company-level on key conflicts.
- No UI for editing standards files or rules.

---

## Acceptance Criteria
1. Clicking "Import Package Set Standards" successfully imports package sets/packages from any present standards file(s) under the active project parent folder, and they appear in Package Sets list after refresh.
2. Re-import is deterministic: running import repeatedly does not create duplicates; it updates existing imported records.
3. User-created package sets are not overwritten or altered by import.
4. Service Package Set selector, when set to Default (Auto), displays the resolved default package set (if matched) based on Service.core_tech and Service.service_type and shows a correct package preview.
5. If no rules match, selector indicates no match without errors.

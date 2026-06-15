# Spec Initialization

## Title
Iteration 1 — Organisation model + DB + API DTOs (backend foundation)

## Raw Idea/Intent

```yaml
intent:
  Extend the Architecture Model Service to persist and expose new Organisation fields needed for future "global standards generation".
  This iteration is backend-only: no UI changes and no external standards service calls.

scope:
  in_scope:
    - Database schema update for organisations
    - Update Organisation JPA entity + persistence mapping
    - Update Organisation API DTOs + controller/service plumbing
    - Ensure list-organisations endpoint exposes organisation names for uniqueness checks
    - Ensure import/export (project snapshot / model serialization) round-trips the new organisation fields
    - Add/adjust backend tests for persistence + DTO mapping + uniqueness constraint
  out_of_scope:
    - Frontend Create Organisation modal
    - Gateway changes
    - Calling external /api/v1/standards/global/generate
    - Any orchestration/job handling

data_model:
  entity: Organisation
  existing_fields:
    - id: string/uuid (existing)
    - name: string (existing, must be unique)
    - description: string? (existing)
  new_fields:
    - docsAppliedToAllSources: List<string> (nullable -> treated as empty list)
    - docsAppliedToTechStack: List<string> (nullable -> treated as empty list)
    - docsAppliedToCodingStyles: List<string> (nullable -> treated as empty list)
    - docsAppliedToConventions: List<string> (nullable -> treated as empty list)
    - docsAppliedToErrorHandling: List<string> (nullable -> treated as empty list)
    - docsAppliedToValidation: List<string> (nullable -> treated as empty list)
    - techStandardsGenerated: boolean (default false)

persistence_rules:
  - Organisation.name must be unique at the database level (unique constraint/index).
  - All new List<string> fields must be stored durably and returned intact.
  - Null list values in DB/DTO are normalized to [] in service responses.
  - techStandardsGenerated defaults to false for existing rows and new rows unless explicitly set.

storage_representation:
  - Store each List<string> field as a single column using JSON array serialization (e.g., TEXT containing JSON like '["a","b"]').
  - Implement a reusable JPA AttributeConverter for List<string> <-> JSON text.
  - Column defaults for list fields should represent empty lists (or be nullable with service-layer normalization).
  - Do not create join tables for these lists in this iteration.

database_migration:
  - Add a new migration (matching the service's existing migration system) that:
    - Adds columns for each new field to the organisations table.
    - Adds techStandardsGenerated boolean with default false.
    - Ensures a unique constraint/index exists on organisation name (case-sensitivity consistent with current DB behavior).
    - Backfills existing rows so techStandardsGenerated=false and list fields are empty (or null but handled).
  - Migration must be idempotent in the project's migration framework (no destructive operations).

api_contract:
  endpoints_affected:
    - List Organisations (used by Create Project org autocomplete)
    - Create Organisation
    - Get Organisation (if exists)
    - Update Organisation (if exists)
  dto_changes:
    - Organisation DTOs must include all new fields above.
    - List organisations response must include at least: id, name (and may include description + new fields as per existing conventions).
  error_handling:
    - Attempting to create/update an organisation with a duplicate name returns a 409 Conflict (or the service's established equivalent).
    - Validation errors return the service's established 400 format.

serialization_import_export:
  - Update any project snapshot / model serialization that includes organisations so that:
    - Export includes all new fields.
    - Import restores all new fields.
    - Missing fields during import default to empty lists / false without failing.

tests:
  add_or_update_tests:
    - Persist and retrieve Organisation with non-empty list fields; verify round-trip equality.
    - Creating two organisations with same name triggers uniqueness error.
    - DTO mapping: nulls normalize to [] and techStandardsGenerated defaults false.
    - Snapshot export/import round-trip preserves new fields.

acceptance_criteria:
  - DB migration applies cleanly on an existing database and on a fresh database.
  - OrganisationEntity persists and returns the new list fields and techStandardsGenerated correctly.
  - List-organisations endpoint returns stable names suitable for client-side uniqueness checks.
  - Duplicate organisation names are rejected consistently with a clear API error.
  - Export/import round-trips organisation data including all new fields.
```

## Created
2026-01-31

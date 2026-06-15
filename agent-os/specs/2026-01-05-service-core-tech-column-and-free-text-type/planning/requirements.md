# Requirements: Add Service.Core Tech Column and Change Service Type to Free-Text

## Intent
Enhance the Architecture meta-model Service entity by:
1) Adding a new "Core Tech" field for languages/tools/frameworks used by the service.
2) Changing "Service Type" from a fixed dropdown (REST/SOAP/gRPC/GraphQL/Message) to a free-text field
   so users can describe the service's functional nature (e.g., CRUD service over DB X, ETL pipeline, etc.).
Preserve existing Service Type values as plain text (no data loss).

## Scope
- backend: DB schema + JPA model + API DTOs/validation
- frontend: Service entity table/grid column definitions + editing controls
- migration: keep existing service_type values intact and editable

## Requirements

### Data Model
- Add new Service attribute:
  - core_tech (TEXT / VARCHAR; nullable)
- Change semantics of existing service_type:
  - Continue storing as text, but treat as free text (no enum constraints)
  - Existing values (REST/SOAP/...) remain as-is and become editable text.

### Backend API
- Service CRUD endpoints must include the new field in:
  - GET responses
  - POST/PUT/PATCH requests
- Validation:
  - Do not enforce enum validation on service_type
  - Keep existing required/optional constraints for other fields unchanged
  - core_tech should be optional (nullable)

### Frontend UI
- In the Architecture meta-model Service table:
  1) Add a new editable column labeled "Core Tech"
     - free-text input (same UX as other text columns like Description/Tags if applicable)
  2) Change "Service Type" column editing from dropdown to free-text input
     - same inline editing behavior as other text inputs
     - display whatever text is stored, including prior dropdown values.

### Ordering/Layout
- Insert "Core Tech" in the Service table near Service Type (preferred):
  - ... App Component | Service Type | Core Tech | Tags ...
  (Exact placement should follow existing column conventions; keep it consistent.)

### Migration/Backward Compatibility
- Existing records:
  - service_type values remain unchanged in DB
  - no data transformation required
- Any previously sent/expected enum values from the frontend must be removed; backend must accept any string.

## Implementation Notes

### Backend (architecture-model-service)
1) Liquibase
- Add a new column to the service table (or equivalent Service entity table):
  - column: core_tech
  - type: TEXT (or VARCHAR(1024) if consistent with existing columns)
  - nullable: true

2) JPA entity
- Add field:
  - private String coreTech;
- Map to column:
  - @Column(name="core_tech")
- Ensure existing serviceType remains String and has no enum converter/validation.

3) DTOs + mappers
- Extend request/response DTOs for Service to include:
  - coreTech (JSON: core_tech if using SNAKE_CASE, and tolerate camelCase via @JsonAlias if applicable)
- Remove any validation annotations or code paths that restrict serviceType to a known set.

4) Tests (if present in project)
- Add/adjust tests to confirm:
  - create/update Service with arbitrary serviceType text succeeds
  - coreTech persists and returns

### Frontend (React + TS)
1) Service model + API mapping
- Update Service DTO/type to include:
  - coreTech
- Ensure API mapping covers snake_case <-> camelCase if used elsewhere.

2) Service table/grid columns
- Add "Core Tech" column:
  - uses same editable text cell component as other text columns
- Update "Service Type" column:
  - replace dropdown cell/editor with text input cell/editor
  - remove the options list and any enum-like UI constraints

3) UX consistency
- Ensure new/changed fields participate in existing row add/edit/save flows.
- Ensure empty values render as blank (no placeholder "--" unless that's the table standard).

## Constraints
- Do not introduce new entities or redesign the meta-model UI.
- Do not rename existing database columns other than adding core_tech.
- Do not break existing Service CRUD endpoints; only extend payloads.

## Acceptance Criteria
- Service table shows a new "Core Tech" column and it is editable.
- "Service Type" is editable as free text (no dropdown).
- Existing Services that had Service Type set to REST/SOAP/etc still display those values and can be edited to any text.
- Backend persists and returns core_tech and accepts any service_type string without constraint errors.

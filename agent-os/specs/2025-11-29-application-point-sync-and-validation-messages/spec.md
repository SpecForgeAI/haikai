# Specification: Application Point Name Sync and Validation Message Improvements

## Goal
Improve the behaviour and usability of automatically-created Application Points and validation error reporting through two targeted fixes:
1. Ensure Application Points automatically copy their source entity's name on creation and synchronisation
2. Replace generic validation error messages with specific, actionable messages that identify the entity type, row name, and failing field

## User Stories
- As an architect, I want Application Points to automatically have the same name as their underlying Application/Component/Service so that dropdowns and labels are always meaningful.
- As a user, I want validation errors to tell me exactly which entity, row, and field has a problem so that I can quickly locate and fix issues.

## Specific Requirements

### 1. Auto-created Application Points Must Copy Source Entity Name

**1.1 On Create**

When a new Application is created:
- Create Application Point with:
  - `kind = "APPLICATION"`
  - `application_id = application.id`
  - `name = application.name`

When a new Application Component is created:
- Create Application Point with:
  - `kind = "APP_COMPONENT"`
  - `application_component_id = app_component.id`
  - `name = app_component.name`

When a new Service is created:
- Create Application Point with:
  - `kind = "SERVICE"`
  - `service_id = service.id`
  - `name = service.name`

**1.2 On Synchronisation (JSON Load or Consistency Pass)**

- If an Application Point exists but has an empty or null `name`:
  - Look up the underlying Application / App Component / Service
  - Set the Application Point's `name` to the underlying entity's `name`
- If both exist and names differ:
  - Prefer the underlying entity's name as the source of truth
  - Copy the underlying entity's name into `application_point.name`
  - Document in code comments: "Application/Component/Service name is the canonical source for Application Point name"

**1.3 Usage Impact**

- The "App Point <-> Process" dropdown will have meaningful labels (shows `<Application Point Name> (<entity type>)`, where Application Point Name is never blank)
- Application Points will no longer fail validation due to missing name (assuming the underlying entity has a name, which is already required)
- Diagrams that reference Application Points will always have a usable default label

**1.4 Implementation Approach**

- Locate the reducer actions that create Application Points when Applications/Components/Services are added
- Update these actions to copy the source entity's `name` to the Application Point's `name`
- Add or update a synchronisation function (possibly in `applicationPointSync.ts` or similar) that:
  - Runs on model load/import
  - Iterates through all Application Points
  - For each Application Point with empty/null name, looks up the source entity and copies its name
  - For each Application Point where name differs from source entity, updates the Application Point name
- Integrate this sync function into the model loading/import flow

### 2. Improve Validation Error Messages

**2.1 Error Message Format**

For each validation error, use the format:

```
<ENTITY_TYPE> ['<row_name>'] requires a value in field '<field_name>'
```

Where:
- `<ENTITY_TYPE>` = canonical meta-model identifier in SCREAMING_SNAKE_CASE:
  - `APPLICATION_POINT`
  - `APPLICATION`
  - `APP_COMPONENT`
  - `SERVICE`
  - `BUSINESS_PROCESS`
  - `DATA_MOVEMENT`
  - `LOGICAL_DATA_ENTITY`
  - `LOGICAL_DATA_ATTRIBUTE`
  - `PHYSICAL_DATA_ENTITY`
  - `PHYSICAL_DATA_ATTRIBUTE`
  - etc.

- `<row_name>` = the `name` value from that row
  - If the `name` is blank, null, or undefined, show placeholder: `unnamed row`
  - Example: `['unnamed row']`

- `<field_name>` = the exact field that failed validation:
  - e.g., `name`, `application_point_id`, `logical_data_entity_id`, `frequency`, etc.

**2.2 Error Message Examples**

```
APPLICATION_POINT ['OMS System'] requires a value in field 'name'
DATA_MOVEMENT ['Trades OMS -> Risk'] requires a value in field 'logical_data_entity_id'
BUSINESS_PROCESS ['Risk Reporting'] requires a value in field 'description'
APPLICATION_POINT ['unnamed row'] requires a value in field 'name'
SERVICE [''] requires a value in field 'name'
```

**2.3 Aggregation and Display**

- When multiple validation errors exist, the error dialog lists each message on its own line:
  ```
  APPLICATION_POINT ['OMS System'] requires a value in field 'name'
  DATA_MOVEMENT ['Trades OMS -> Risk'] requires a value in field 'logical_data_entity_id'
  ```
- Do not show generic "This field is required" messages anymore
- Remove or replace any existing generic error message generation

**2.4 Implementation Approach**

- Update the `ValidationError` interface to ensure it includes:
  - `entityType: EntityType` - the table/entity type
  - `entityId: string` - the row ID
  - `entityName?: string` - the row's name (for display purposes)
  - `field: string` - the field that failed
  - `message: string` - the formatted error message
- Create a helper function `formatValidationErrorMessage()` that:
  - Takes entity type, entity name, and field name
  - Returns the formatted string: `<ENTITY_TYPE> ['<row_name>'] requires a value in field '<field_name>'`
  - Handles null/empty names by substituting `unnamed row`
- Update all validation functions to use this formatter
- Update the error dialog component to display these formatted messages line-by-line
- Keep existing grid cell highlighting (red border) as a complement to the textual errors

## Existing Code to Leverage

**ArchitectureContext.tsx - Application Point Creation**
- Locate `ADD_APPLICATION`, `ADD_APP_COMPONENT`, `ADD_SERVICE` reducer cases
- These should already create corresponding Application Points
- Update to copy `name` from source entity to Application Point

**applicationPointSync.ts - Synchronisation Logic**
- If exists, update to sync names
- If not, create this utility for Application Point synchronisation

**validation.ts - Validation Functions**
- `validateRequiredFields()` - update to include entity context in errors
- `validateModel()` - ensure all errors include entity type, ID, and name
- Add `formatValidationErrorMessage()` helper function

**types/config.ts - ValidationError Interface**
- Ensure interface has `entityType`, `entityId`, `entityName`, `field`, `message` properties

**Error Dialog Component**
- Locate the component that displays validation errors
- Update to render formatted messages line-by-line instead of generic text

## Visual Design

No mockups required. Changes are refinements to existing patterns:
- Validation error dialog should display formatted messages in a list/pre-formatted block
- Grid cell highlighting (red border) remains unchanged

## Acceptance Criteria

**Application Point Name Sync:**
- [x] When creating a new Application, the auto-created Application Point has `name = application.name`
- [x] When creating a new App Component, the auto-created Application Point has `name = app_component.name`
- [x] When creating a new Service, the auto-created Application Point has `name = service.name`
- [x] When loading JSON where Application Points have empty names, sync populates names from linked entities
- [x] When Application Point name differs from source entity name, sync updates Application Point name
- [x] "App Point <-> Process" dropdown shows meaningful names (no blank entries)

**Validation Error Messages:**
- [x] Validation errors display in format: `<ENTITY_TYPE> ['<row_name>'] requires a value in field '<field_name>'`
- [x] Entity type is shown in SCREAMING_SNAKE_CASE (e.g., `APPLICATION_POINT`, `DATA_MOVEMENT`)
- [x] Row name is shown in quotes; if blank, shows `unnamed row`
- [x] Field name is shown in quotes
- [x] No generic "This field is required" messages appear
- [x] Multiple errors are listed line-by-line in the error dialog
- [x] Grid cell red border highlighting still works alongside textual errors

## Out of Scope

- Bidirectional name sync (Application Point name changes updating the source entity)
- Persisting sync preferences or allowing users to override sync behavior
- Internationalization of error messages
- Custom error message templates per entity type
- Validation error grouping by entity type or severity
- Application Point name uniqueness validation (handled separately if needed)

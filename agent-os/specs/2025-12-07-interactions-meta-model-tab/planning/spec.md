# Specification: Interactions Meta-Model Tab

## Goal
Add an "Interactions" tab to the meta-model view that allows users to create, edit, and delete Interaction records, enabling the "User Interactions" palette section to be populated from user-defined data.

## User Stories
- As an architecture modeler, I want to define Interactions in the meta-model so that I can create reusable user interaction patterns for my diagrams.
- As an architecture modeler, I want the "User Interactions" palette to reflect my defined Interactions so that I can add them to diagrams with pre-configured user and App_Business_Point references.

## Specific Requirements

**Add Interactions tab to meta-model top bar**
- Insert "Interactions" tab in the Business domain group, between "Activities" and the domain separator
- Tab order becomes: Users | Processes | Activities | Interactions | (divider) | Applications...
- Tab label must be "Interactions" (plural)
- Update `domainGroupings.business` array in `gridConfigs.ts` to include 'Interactions'

**Create Interactions grid configuration**
- Add `interactions` entry to `gridConfigs` object with columns: ID, Name, Description, User, Primary Point, Secondary Point, Tags
- ID column: cellType 'text', required, autoGenerate true, width 100
- Name column: cellType 'text', required, width 180
- Description column: cellType 'text', optional, width 180
- User column: cellType 'fk_typeahead', required, fkTarget 'business_users', width 150
- Primary Point column: cellType 'fk_typeahead', required, width 200, uses polymorphic lookup
- Secondary Point column: cellType 'fk_typeahead', optional, width 200, uses polymorphic lookup
- Tags column: cellType 'tags', optional, width 120

**Implement App_Business_Point polymorphic autocomplete**
- Create new `appBusinessPointDisplayFormatter` in `formatters.ts` for Primary/Secondary Point columns
- Display format must show: `<name> (<entity_type>)` e.g. "Order Processing (Business Process)"
- Formatter must search across all 7 App_Business_Point entity collections using `resolveAppBusinessPoint()`
- Create helper function to aggregate all App_Business_Point entities for typeahead dropdown
- Entity type labels: APPLICATION, APP_COMPONENT, SERVICE, INTERFACE, ENDPOINT, BUSINESS_PROCESS, PROCESS_ACTIVITY

**Update tabToEntityType mapping**
- Add 'Interactions': 'interactions' entry to `tabToEntityType` mapping in `gridConfigs.ts`
- Ensures clicking tab loads the correct Grid component with interactions entityType

**Add interactions to createEmptyEntity function**
- Add case 'interactions' to `createEmptyEntity()` in `Grid.tsx`
- Empty Interaction defaults: id (auto-generated), name '', description '', user_id '', primary_app_business_point_id '', secondary_app_business_point_id '', tags undefined

**Add interactions ID prefix to idGenerator**
- Add 'interactions': 'int' to prefixMap in `idGenerator.ts`
- Generated IDs will follow pattern: `int-<timestamp>-<random>`

**Validation integration**
- Existing `validateInteractionReferences()` in `validation.ts` already handles:
  - Required user_id validation
  - Required primary_app_business_point_id validation
  - Optional secondary_app_business_point_id validation (if present)
- Validation uses `resolveAppBusinessPoint()` to verify polymorphic FK references
- Add 'interactions' to entityTypes array in `validateModel()` for required field validation

## Visual Design
No visual mockups provided. Follow existing meta-model tab and grid patterns.

## Existing Code to Leverage

**`frontend/src/config/gridConfigs.ts`**
- Contains all entity grid configurations with column definitions
- Has `tabToEntityType` and `domainGroupings` mappings to update
- Pattern: each entity type has array of GridColumnConfig objects with field, displayName, cellType, required, width, options/fkTarget

**`frontend/src/components/Grid/Grid.tsx`**
- Main grid component handles rendering and CRUD operations
- `createEmptyEntity()` switch statement needs new 'interactions' case
- Existing pattern shows how to handle FK fields with empty string defaults

**`frontend/src/utils/formatters.ts`**
- Contains `applicationPointDisplayFormatter` and `businessPointDisplayFormatter`
- Pattern for creating displayFormatter functions compatible with GridColumnConfig
- New `appBusinessPointDisplayFormatter` should follow same pattern but search multiple collections

**`frontend/src/utils/validation.ts`**
- Already has `validateInteractionReferences()` function for Interaction validation
- Uses `resolveAppBusinessPoint()` for polymorphic FK validation
- Pattern shows how to add entity type to validation flow

**`frontend/src/types/model.ts`**
- `Interaction` interface already defined with all required fields
- `APP_BUSINESS_POINT_TYPES` array lists all 7 valid entity types
- `resolveAppBusinessPoint()` helper already implemented for polymorphic lookup

## Out of Scope
- Adding new columns to the Interaction entity beyond those in the existing interface
- Modifying the "User Interactions" palette section rendering behavior (already implemented)
- Changing how Interactions are added to diagrams from the palette
- Adding temporal validity fields (valid_from/valid_to) to Interactions
- Creating relationship tables for Interactions
- Modifying diagram user interaction line rendering
- Adding context menu or right-click functionality for Interaction grid rows
- Batch import/export of Interactions
- Interaction filtering or sorting beyond default grid behavior
- Undo/redo for Interaction CRUD operations

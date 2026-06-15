# Specification: User Journey & Activity Step Business Architecture Table UI

## Goal
Extend the Business domain entity tab strip with two new entity grid tabs -- User Journeys and Activity Steps -- using the same configuration-driven, table-first interaction model already established for Users, Processes, and Activities.

## User Stories
- As an architect, I want to define User Journeys in a grid table so that I can capture end-to-end user flows and link them to existing Business Users and Business Processes.
- As an architect, I want to define Activity Steps within a User Journey so that I can break a journey into ordered steps referencing Process Activities, Business Users, and Applications.

## Specific Requirements

**FR1: User Journeys Grid Column Configuration**
- Add a `user_journeys` entry to `gridConfigs` in `frontend/src/config/gridConfigs.ts`
- Columns in order: `id` (text, required, width 120, autoGenerate), `name` (text, required, width 200), `description` (text, optional, width 250), `primary_business_user_id` (fk_typeahead, optional, width 180, fkTarget `business_users`), `parent_business_process_id` (fk_typeahead, optional, width 180, fkTarget `business_processes`), `tags` (tags, optional, width 150)
- Follow the same column config structure as `business_processes` and `process_activities` entries
- Both FK columns are optional, matching the `UserJourney` TypeScript interface where these fields are `string | undefined`

**FR2: Activity Steps Grid Column Configuration**
- Add an `activity_steps` entry to `gridConfigs` in `frontend/src/config/gridConfigs.ts`
- Columns in order: `id` (text, required, width 120, autoGenerate), `user_journey_id` (fk_typeahead, required, width 180, fkTarget `user_journeys`), `name` (text, required, width 200), `description` (text, optional, width 250), `sequence_order` (text, optional, width 100), `process_activity_id` (fk_typeahead, required, width 180, fkTarget `process_activities`), `business_user_id` (fk_typeahead, required, width 180, fkTarget `business_users`), `application_id` (fk_typeahead, required, width 180, fkTarget `applications`), `tags` (tags, optional, width 150)
- All four FK columns (`user_journey_id`, `process_activity_id`, `business_user_id`, `application_id`) must have `required: true`
- `sequence_order` uses cellType `text` (plain editable column), matching the `process_activities` pattern for its `sequence_order` field
- Note: `application_id` is a cross-domain FK referencing Application domain entities; the existing `TypeaheadCell` already supports this

**FR3: Tab Strip Registration**
- In `tabToEntityType`: add `'User Journeys': 'user_journeys'` and `'Activity Steps': 'activity_steps'`
- In `entityTabNames`: append `'User Journeys'` and `'Activity Steps'` (position within array is not critical since `domainGroupings` controls what appears in UI)
- In `domainGroupings.business`: change from `['Users', 'Processes', 'Activities']` to `['Users', 'Processes', 'Activities', 'User Journeys', 'Activity Steps']`
- In `DOMAIN_ENTITY_TYPES.business`: add `'user_journeys'` and `'activity_steps'` to the array (alongside existing `business_users`, `business_processes`, `process_activities`, `business_points`)

**FR4: Empty Entity Creation**
- Add a `'user_journeys'` case to the `createEmptyEntity` switch in `Grid.tsx` returning: `{ id, name: '', description: '', tags: '', primary_business_user_id: '', parent_business_process_id: '' }`
- Add an `'activity_steps'` case returning: `{ id, user_journey_id: '', name: '', description: '', tags: '', sequence_order: undefined, process_activity_id: '', business_user_id: '', application_id: '' }`
- Follow the established pattern where FK string fields default to `''` and optional numeric fields default to `undefined`
- The `id` is generated via the existing `generateEntityId(entityType)` utility

**FR5: Validation Registration**
- Add `'user_journeys'` and `'activity_steps'` to the `entityTypes` array in the `validateModel` function in `frontend/src/utils/validation.ts` (around line 1094)
- The existing generic validation loop already handles required-field enforcement (via `validateRequiredFields`) and FK referential integrity (via `validateFKReferences`) for any entity type that has a `gridConfigs` entry
- No custom/specialized validation function is needed since the generic loop covers all requirements
- `sequence_order` positive-integer validation: add a small post-loop check for `activity_steps` entities, validating that if `sequence_order` is provided and non-empty, it parses to a positive integer; emit a validation error of type `'required'` (or a suitable existing type) if it fails

**FR6: Standard Grid Interactions**
- Both new entity tables inherit all standard grid behaviors from the `Grid` component with zero additional code: Add Row, Delete Row, inline cell editing, search-by-name filtering, and `@dnd-kit/sortable` drag-reorder
- FK typeahead columns use the existing `TypeaheadCell` component which resolves `fkTarget` to `model.metaModel.entities[fkTarget]` automatically
- No special modal intercepts, context menus, or custom cell types are needed for these entity types

**FR7: ENTITY_TYPE_DISPLAY_NAMES Verification**
- Confirm that `ENTITY_TYPE_DISPLAY_NAMES` in `validation.ts` already contains entries for `'user_journeys': 'USER_JOURNEY'` and `'activity_steps': 'ACTIVITY_STEP'` (these were observed in the codebase at lines 64-65)
- No changes needed; this is a verification step only

## Existing Code to Leverage

**`process_activities` grid config in `gridConfigs.ts` (line 58)**
- Closest analog: a child entity with FK to parent `business_processes`, has `sequence_order`, belongs to Business domain
- Use its column structure as the primary template for both new grid configs
- Its `fk_typeahead` cell type with `fkTarget` property demonstrates the exact FK lookup pattern needed
- Its `sequence_order` column uses `cellType: 'text'` with `required: false` and `width: 100` -- replicate this for Activity Steps

**`Grid.tsx` `createEmptyEntity` function (line 810)**
- Switch statement that creates default empty entity objects per entity type
- Existing cases like `process_activities` show the pattern: spread `baseEntity`, add FK fields as empty strings, add enum fields with defaults
- New cases for `user_journeys` and `activity_steps` follow this exact pattern
- No other changes needed to `Grid.tsx`; the main rendering logic, DnD, search, Add Row, and Delete Row are fully generic

**`TypeaheadCell.tsx` `getTargetEntities` function (line 269)**
- Resolves FK targets by reading `model.metaModel.entities[fkTarget]`
- Already supports cross-domain lookups (e.g., `application_id` referencing the Application domain)
- No changes needed; all FK targets for User Journeys and Activity Steps (`business_users`, `business_processes`, `user_journeys`, `process_activities`, `applications`) are standard entity array keys

**`validateModel` in `validation.ts` (line 1085)**
- Generic validation loop iterates over an `entityTypes` array, running `validateRequiredFields` and `validateFKReferences` for each
- Simply adding `'user_journeys'` and `'activity_steps'` to this array enables full validation coverage
- The `gridConfigs` entries drive which fields are required and which are FK lookups

**`MetaModelView.tsx` component**
- Reads `domainGroupings[state.selectedDomain]` to render entity tabs dynamically
- Renders `<Grid entityType={...} />` for selected entity tab
- No changes needed; updating `domainGroupings.business` automatically surfaces the new tabs

## Out of Scope
- Diagram node support: do NOT add `USER_JOURNEY` or `ACTIVITY_STEP` to `DIAGRAM_NODE_ENTITY_TYPE_MAP` in `entityTypeRegistry.ts`
- New relationship types or relationship tabs for User Journeys or Activity Steps
- Spreadsheet import for these entity types
- Chat/persona integration for these entity types
- Temporary or generated diagram flows involving these entities
- Drag-reorder-driven sequence ordering beyond existing `@dnd-kit` infrastructure (no auto-increment or reorder-writes-sequence_order behavior)
- Bulk actions such as multi-select or bulk delete
- Bespoke create/edit modals (no `CreateBusinessLogicModal`-style flows for these entities)
- Cascade delete UI behavior beyond whatever the backend already provides
- Any backend changes (TypeScript interfaces, DTOs, JPA entities, and API endpoints already exist)

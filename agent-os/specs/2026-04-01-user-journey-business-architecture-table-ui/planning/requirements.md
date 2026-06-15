# Spec Requirements: User Journey & Activity Step Business Architecture Table UI

## Initial Description
Extend the existing Architecture & Design -> Business domain entity table UI with two new entity tables, User Journey and Activity Step, using the same table-first interaction model as existing Business Architecture entities.

## Requirements Discussion

### First Round Questions

**Q1:** The existing Business domain tabs are `['Users', 'Processes', 'Activities']`. Should the two new tabs be named "User Journeys" and "Activity Steps", placed after "Activities" so the Business domain becomes `['Users', 'Processes', 'Activities', 'User Journeys', 'Activity Steps']`? Or should User Journeys appear elsewhere?
**Answer:** Yes, that order is correct: `['Users', 'Processes', 'Activities', 'User Journeys', 'Activity Steps']` within the existing Business domain entity tab strip.

**Q2:** The `UserJourney` interface has two optional FK fields: `primary_business_user_id` (FK to `business_users`) and `parent_business_process_id` (FK to `business_processes`). Should both appear as `fk_typeahead` columns?
**Answer:** Correct: `primary_business_user_id` and `parent_business_process_id` should both be `fk_typeahead` columns using the existing Business User and Business Process lookup/search-select pattern.

**Q3:** `ActivityStep` has four FK fields: `user_journey_id` (required FK to `user_journeys`), `process_activity_id` (required FK to `process_activities`), `business_user_id` (required FK to `business_users`), and `application_id` (required FK to `applications`). Should all four be marked as required in the grid, or should any be optional for initial data entry flexibility?
**Answer:** All four Activity Step FK fields should be required in the grid to match the backend model: `user_journey_id`, `process_activity_id`, `business_user_id`, and `application_id` are all mandatory; do not make any optional just for easier entry.

**Q4:** The `ActivityStep` interface has an optional `sequence_order?: number` field. Should this be a plain text column following the existing pattern, or something different (auto-increment, drag-reorder driven)?
**Answer:** Sequence Order should be a plain editable numeric column in this increment, following the existing table pattern; no auto-increment magic and no drag-reorder UI yet.

**Q5:** The `DIAGRAM_NODE_ENTITY_TYPE_MAP` in `entityTypeRegistry.ts` currently has no entries for `USER_JOURNEY` or `ACTIVITY_STEP`. Should they be added so they can appear as diagram nodes?
**Answer:** Diagram support is out of scope for this increment, so do NOT add `USER_JOURNEY` or `ACTIVITY_STEP` to `DIAGRAM_NODE_ENTITY_TYPE_MAP` yet.

**Q6:** Standard validation should apply: required fields enforced plus FK referential integrity checks. Are there any additional validation rules?
**Answer:** Standard required-field enforcement plus FK referential integrity is enough for this increment. Additionally enforce that `sequence_order` is a positive integer, but do not add any more advanced validation UX.

**Q7:** Is this spec strictly limited to adding the two entity grid tabs, or should it also include new relationship types, relationship tabs, cascade delete behavior, or special modal/context-menu features?
**Answer:** Scope is strictly limited to the two new entity grid tabs and their standard CRUD/search/edit wiring; no new relationship types/tabs, no special modal features, and no extra cascade-delete UI behavior beyond whatever backend already does.

**Q8:** Are there any features related to User Journeys or Activity Steps that you want to explicitly defer to a future spec?
**Answer:** Explicitly out of scope: diagram support of any kind, relationship tabs/types, spreadsheet import, chat/persona integration, temporary/generated diagram flows, drag-reorder, bulk actions, and any bespoke create/edit modal outside the existing table interaction pattern.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Process Activities entity grid -- Path: `frontend/src/config/gridConfigs.ts` (the `process_activities` grid config starting around line 58)
  - This is the closest analog: a child entity with FK to parent `business_processes`, has `sequence_order`, belongs to the Business domain
  - The `fk_typeahead` cell type with `fkTarget` property demonstrates the FK lookup pattern
- Feature: Grid component -- Path: `frontend/src/components/Grid/Grid.tsx`
  - The `createEmptyEntity` switch statement (line ~810) needs new cases for `user_journeys` and `activity_steps`
  - The overall Grid component is the shared rendering engine for all entity tables
- Feature: TypeaheadCell component -- Path: `frontend/src/components/Grid/TypeaheadCell.tsx`
  - Implements the FK search-select dropdown used by `fk_typeahead` cells
- Feature: Domain groupings and tab registration -- Path: `frontend/src/config/gridConfigs.ts` (lines ~550-696)
  - `tabToEntityType`, `entityTabNames`, `domainGroupings`, `DOMAIN_ENTITY_TYPES` all need new entries
- Feature: MetaModelView -- Path: `frontend/src/components/MetaModelView/MetaModelView.tsx`
  - This component renders the domain selector, entity tabs, and Grid; no changes expected here since it reads from `domainGroupings` dynamically

### Follow-up Questions
No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided. Confirmed via filesystem check.

## Requirements Summary

### Existing Infrastructure (Already in Place -- Do NOT Recreate)

The following are already implemented and should be referenced, not recreated:

1. **TypeScript interfaces** in `frontend/src/types/model.ts`:
   - `UserJourney` (lines 19-26): `id`, `name`, `description`, `tags`, `primary_business_user_id?`, `parent_business_process_id?`
   - `ActivityStep` (lines 28-38): `id`, `user_journey_id`, `name`, `description`, `tags`, `sequence_order?`, `process_activity_id`, `business_user_id`, `application_id`

2. **MetaModelEntities arrays** in `frontend/src/types/model.ts` (lines 2154-2155):
   - `user_journeys: UserJourney[]`
   - `activity_steps: ActivityStep[]`

3. **EntityType union values** in `frontend/src/types/model.ts` (lines 2218-2219):
   - `'user_journeys'` and `'activity_steps'` are already members of `EntityType`

4. **Default empty arrays** in `frontend/src/config/defaults.ts` (lines 1234-1235):
   - `user_journeys: []` and `activity_steps: []`

5. **File deserialization** in `frontend/src/utils/fileOperations.ts` (lines 358-359):
   - Both entity types are parsed from JSON files

6. **Sanitization** in `frontend/src/utils/sanitize.ts` (lines 91-92):
   - Both entity arrays are sanitized on load

7. **Validation entity-to-diagram-type mapping** in `frontend/src/utils/validation.ts` (lines 64-65):
   - `'user_journeys': 'USER_JOURNEY'` and `'activity_steps': 'ACTIVITY_STEP'` mappings exist

### Functional Requirements

**FR1: User Journeys Grid Configuration**
- Add a `user_journeys` entry to `gridConfigs` in `frontend/src/config/gridConfigs.ts` with the following columns:
  - `id`: text, required, width ~120, autoGenerate: true
  - `name`: text, required, width ~200
  - `description`: text, optional, width ~250
  - `primary_business_user_id`: fk_typeahead, optional, width ~180, fkTarget: `business_users`
  - `parent_business_process_id`: fk_typeahead, optional, width ~180, fkTarget: `business_processes`
  - `tags`: tags, optional, width ~150
- Column widths should follow the conventions used by existing Business domain entity grids

**FR2: Activity Steps Grid Configuration**
- Add an `activity_steps` entry to `gridConfigs` with the following columns:
  - `id`: text, required, width ~120, autoGenerate: true
  - `user_journey_id`: fk_typeahead, required, width ~180, fkTarget: `user_journeys`
  - `name`: text, required, width ~200
  - `description`: text, optional, width ~250
  - `sequence_order`: text (numeric input), optional, width ~100
  - `process_activity_id`: fk_typeahead, required, width ~180, fkTarget: `process_activities`
  - `business_user_id`: fk_typeahead, required, width ~180, fkTarget: `business_users`
  - `application_id`: fk_typeahead, required, width ~180, fkTarget: `applications`
  - `tags`: tags, optional, width ~150
- All four FK fields (`user_journey_id`, `process_activity_id`, `business_user_id`, `application_id`) must be marked `required: true`

**FR3: Tab Registration**
- Add `'User Journeys'` and `'Activity Steps'` entries to:
  - `tabToEntityType`: `'User Journeys': 'user_journeys'` and `'Activity Steps': 'activity_steps'`
  - `entityTabNames` array: append both after the existing entries (or at the appropriate position for the tab strip)
  - `domainGroupings.business`: change from `['Users', 'Processes', 'Activities']` to `['Users', 'Processes', 'Activities', 'User Journeys', 'Activity Steps']`
  - `DOMAIN_ENTITY_TYPES.business`: add `'user_journeys'` and `'activity_steps'` to the array

**FR4: Empty Entity Creation**
- Add cases for `'user_journeys'` and `'activity_steps'` to the `createEmptyEntity` switch in `frontend/src/components/Grid/Grid.tsx`:
  - `user_journeys`: `{ id, name: '', description: '', tags: '', primary_business_user_id: '', parent_business_process_id: '' }`
  - `activity_steps`: `{ id, user_journey_id: '', name: '', description: '', tags: '', sequence_order: undefined, process_activity_id: '', business_user_id: '', application_id: '' }`

**FR5: Standard Grid Interactions**
- Both new entity tables must support the full standard grid interaction set:
  - **Add Row**: "+ Add Row" button creates empty entity via `createEmptyEntity` and dispatches `ADD_ENTITY`
  - **Delete Row**: "Delete Row" button dispatches `DELETE_ENTITY` for the selected row
  - **Inline Cell Editing**: All cells editable inline via the existing `GridCell` component
  - **Search/Filter**: The existing search-by-name filter must work for both tables
  - **Drag-Reorder**: The existing `@dnd-kit/sortable` row reordering must work (standard infrastructure, no special implementation)
  - **FK Typeahead**: All FK columns use the existing `TypeaheadCell` component to search and select referenced entities

**FR6: Validation**
- Standard required-field validation for:
  - `UserJourney`: `name` is required
  - `ActivityStep`: `name`, `user_journey_id`, `process_activity_id`, `business_user_id`, `application_id` are all required
- FK referential integrity checks for all FK columns (same pattern as existing entities)
- `sequence_order` on ActivityStep: if provided, must be a positive integer
- Validation errors should display using the existing red-highlight cell error pattern

### Reusability Opportunities
- **Grid component** (`frontend/src/components/Grid/Grid.tsx`): No changes needed to the main rendering logic; only `createEmptyEntity` switch needs new cases
- **GridCell component** (`frontend/src/components/Grid/GridCell.tsx`): No changes needed; existing cell types (`text`, `tags`, `fk_typeahead`) cover all columns
- **TypeaheadCell component** (`frontend/src/components/Grid/TypeaheadCell.tsx`): No changes needed; existing FK lookup handles all fkTarget values
- **MetaModelView** (`frontend/src/components/MetaModelView/MetaModelView.tsx`): No changes needed; reads from `domainGroupings` dynamically
- **DomainSelector** (`frontend/src/components/MetaModelView/DomainSelector.tsx`): No changes needed
- **ArchitectureContext reducer** (`frontend/src/contexts/ArchitectureContext.tsx`): No changes needed; `ADD_ENTITY`, `UPDATE_ENTITY`, `DELETE_ENTITY`, `REORDER_ENTITIES` actions are generic and work with any `EntityType`
- **Validation** (`frontend/src/utils/validation.ts`): Entity-to-diagram-type mapping already exists; may need required-field and FK referential integrity rule additions
- **process_activities grid config**: Use as the primary template for both new grid configs (FK pattern, sequence_order column, Business domain membership)

### Scope Boundaries

**In Scope:**
- Grid column configuration for `user_journeys` entity type
- Grid column configuration for `activity_steps` entity type
- Tab registration in `tabToEntityType`, `entityTabNames`, `domainGroupings`, `DOMAIN_ENTITY_TYPES`
- `createEmptyEntity` switch cases for both new entity types
- Standard CRUD interactions: add row, delete row, inline edit, search, drag-reorder
- FK typeahead columns for all foreign key fields
- Required-field and FK referential integrity validation
- Positive integer validation for `sequence_order`

**Out of Scope:**
- Diagram node support (`DIAGRAM_NODE_ENTITY_TYPE_MAP` entries) -- deferred to future increment
- New relationship types or relationship tabs
- Spreadsheet import for these entity types
- Chat/persona integration for these entity types
- Temporary/generated diagram flows
- Drag-reorder-driven sequence ordering (beyond existing `@dnd-kit` infrastructure)
- Bulk actions (multi-select, bulk delete, etc.)
- Bespoke create/edit modals (no `CreateBusinessLogicModal`-style flows)
- Cascade delete UI behavior beyond existing backend behavior
- Any backend changes (types, DTOs, JPA entities, and API endpoints already exist)

### Technical Considerations
- **No new components needed**: All UI is rendered through the existing `Grid` -> `GridCell` -> `TypeaheadCell` component hierarchy
- **Configuration-driven**: The primary work is adding entries to `gridConfigs.ts` configuration objects and the `createEmptyEntity` switch
- **TypeScript types already exist**: `UserJourney`, `ActivityStep`, `EntityType` union values, and `MetaModelEntities` arrays are already defined in `model.ts`
- **Backend already supports these entities**: Deserialization (`fileOperations.ts`), sanitization (`sanitize.ts`), and default initialization (`defaults.ts`) are already wired
- **Validation mapping exists**: `validation.ts` already has `'user_journeys': 'USER_JOURNEY'` and `'activity_steps': 'ACTIVITY_STEP'` but may need required-field and FK referential integrity rules added to the validation logic
- **Cross-domain FK columns**: `ActivityStep.application_id` references the Application domain (`applications`), which means the `TypeaheadCell` must load entities from a different domain; this already works in the existing codebase (e.g., `process_activities` grids reference `business_processes`)

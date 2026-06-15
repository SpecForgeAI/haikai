# Specification: Process Activity Frequency Attribute

## Goal
Add a new optional `frequency` enum attribute to Process Activities that captures how frequently an activity is performed, and display it as an editable dropdown column in the Activity table positioned between Description and Sequence Order.

## User Stories
- As an architecture modeler, I want to specify how frequently a Process Activity is performed (e.g., daily, weekly, monthly) so that I can document operational cadence alongside process flows.
- As a business analyst, I want to view and edit activity frequency in the Activity table so that I can quickly assess and update execution patterns across processes.

## Specific Requirements

**ProcessActivityFrequency Type Definition**
- Define new type alias `ProcessActivityFrequency` in `frontend/src/types/model.ts`
- Union of 9 string literals: `CONTINUOUSLY`, `DAILY`, `WEEKLY`, `MONTHLY`, `QUARTERLY`, `SEMI-ANNUALLY`, `ANNUALLY`, `ADHOC`, `OTHER`
- Follow existing pattern used by `ActorHint`, `UserInteractionLevel`, and `InterfaceType` types

**ProcessActivity Interface Update**
- Add `frequency?: ProcessActivityFrequency` field to `ProcessActivity` interface
- Field is optional (nullable/undefined) with no default value
- Position the field logically after `sequence_order` in the interface definition
- No validation required - empty value is acceptable

**Frequency Options Array for Dropdown**
- Create `processActivityFrequencyOptions` array in `frontend/src/config/defaults.ts`
- Export typed array of all 9 enum values for grid dropdown configuration
- Follow existing pattern of `actorHintOptions`, `userInteractionLevelOptions`, and `interfaceTypeOptions`

**Activity Table Column Configuration**
- Add new column config to `process_activities` array in `frontend/src/config/gridConfigs.ts`
- Position between `description` (index 3) and `sequence_order` (index 4) - insert at index 4
- Column config: `{ field: 'frequency', displayName: 'Frequency', cellType: 'dropdown', required: false, width: 120, options: processActivityFrequencyOptions }`
- Import `processActivityFrequencyOptions` from defaults.ts

**JSON Persistence - Saving**
- Field automatically persisted via existing `serializeModel` function - no changes needed
- When `frequency` is undefined/null, field omitted from JSON output (standard JSON.stringify behavior)
- When set, value saved as string (e.g., `"frequency": "DAILY"`)

**JSON Persistence - Loading**
- Update `migrateProcessActivity` function in `frontend/src/utils/fileOperations.ts`
- Add `frequency: rawActivity.frequency as ProcessActivityFrequency | undefined` to returned object
- No migration logic needed - simply pass through the value if present

**Backward Compatibility**
- Loading JSON without `frequency` field must work without errors
- Field defaults to `undefined` when missing (already handled by optional typing)
- Existing Process Activities display empty/placeholder in Frequency column
- No automatic default assignment - users must explicitly set value

**Live Update Behaviour**
- Changes via dropdown trigger existing `UPDATE_ENTITY` dispatch mechanism
- No additional code required - grid cell editing already handles dropdown changes
- State updates and re-renders automatically via existing MetaModelContext

## Visual Design
No visual assets provided - implementation follows existing Activity table patterns for dropdown columns (e.g., Actor Hint, User Interaction Level columns).

## Existing Code to Leverage

**ActorHint and UserInteractionLevel Pattern (model.ts)**
- Lines 20-32 define `ActorHint` and `UserInteractionLevel` type aliases as string literal unions
- `ProcessActivityFrequency` should follow identical pattern
- Both are used as optional/required fields on `ProcessActivity` interface

**Dropdown Options Arrays (defaults.ts)**
- Lines 328-344 define `actorHintOptions` and `userInteractionLevelOptions` arrays
- These typed arrays are used in gridConfigs for dropdown cellType columns
- `processActivityFrequencyOptions` should follow same export pattern

**Grid Column Configuration (gridConfigs.ts)**
- Lines 32-43 define `process_activities` grid configuration
- `actor_hint` and `user_interaction_level` columns use `cellType: 'dropdown'` with `options` property
- New frequency column should use identical structure

**migrateProcessActivity Function (fileOperations.ts)**
- Lines 127-183 handle ProcessActivity field mapping during JSON load
- Function already passes through optional fields with type casting
- Add frequency field to return object following same pattern as `valid_from`/`valid_to`

**Grid Dropdown Rendering**
- Existing grid components handle dropdown cellType automatically
- Empty option rendered for nullable fields when value is undefined
- No component changes required - configuration-driven

## Out of Scope
- Backend API changes (frontend-only scope)
- Database schema changes
- Diagram rendering based on frequency value
- Color coding or visual styling based on frequency (no color mapping like user_interaction_level)
- Default value assignment or auto-population
- Required field validation
- Frequency-based filtering or reporting features
- Frequency aggregation or analytics
- Import/export to non-JSON formats
- Frequency value display labels (display raw enum values like other dropdowns)

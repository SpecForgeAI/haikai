# Spec Requirements: Process Activity User Interaction Level Update

## Initial Description

Update the process_activity meta-model and diagram rendering to replace the two fields "Is Manual" (`is_manual`) and "User Input Amount" (`user_input_amount`) with a single "User Interaction Level" enum (`user_interaction_level`), and ensure diagrams update colours automatically when this value changes.

This consolidation eliminates confusion caused by the current two-field approach where `user_input_amount: "NA"` only makes sense when `is_manual: false`, leading to awkward validation logic and rendering inconsistencies.

## Context / Current Behaviour

The current process_activity meta-model and UI use two fields to represent how much user interaction is required:

- **is_manual**: boolean - indicates whether the activity involves manual work
- **user_input_amount**: `"NA"` | `"MINIMAL"` | `"MODERATE"` | `"SIGNIFICANT"` - indicates level of user input required

**Problems with current approach:**

1. **Semantic Confusion**: The value `"NA"` for `user_input_amount` only makes sense when `is_manual=false`. This creates a confusing state model where field values are interdependent.

2. **Awkward Validation Logic**: Validation must handle conditional rules (e.g., if `is_manual` is false, `user_input_amount` should be `"NA"`; if true, it should be one of the other values).

3. **Diagram Colouring Issues**: The diagram colouring logic for process_activity nodes (background colours based on user input level) is not behaving correctly and is hard to reason about with the split fields.

4. **UI Complexity**: Two columns in the Activities grid for a single conceptual property adds unnecessary complexity.

## Desired Behaviour

### Section 1: Meta-model Changes

**Remove old fields from ProcessActivity interface:**
- `is_manual: boolean`
- `user_input_amount: "NA" | "MINIMAL" | "MODERATE" | "SIGNIFICANT"`

**Add new field:**
- `user_interaction_level: "AUTOMATED" | "MINIMAL" | "MODERATE" | "SIGNIFICANT"`

**File to update:**
- `frontend/src/types/model.ts` - Update `ProcessActivity` interface

**New JSON schema shape for a process_activity:**
```json
{
  "id": "pa_...",
  "business_process_id": "bp_...",
  "name": "Review Market Data",
  "description": "Short text...",
  "sequence_order": 10,
  "actor_hint": "END_USER",
  "user_interaction_level": "MODERATE",
  "tags": [],
  "valid_from": null,
  "valid_to": null
}
```

**Default value for new rows:**
- When adding a new process_activity row, default `user_interaction_level` to `"AUTOMATED"`.

### Section 2: Activities Grid UI

**Replace two columns with single column:**
- Remove: "Is Manual" column
- Remove: "User Input Amount" column
- Add: "User Interaction Level" column

**Column configuration:**
- Header: "User Interaction Level"
- Control type: Dropdown/select
- Options (display label -> internal value):
  - "Automated" -> `"AUTOMATED"`
  - "Minimal" -> `"MINIMAL"`
  - "Moderate" -> `"MODERATE"`
  - "Significant" -> `"SIGNIFICANT"`

**Column behaviour:**
- Directly binds to `processActivity.user_interaction_level`
- No conditional enabling/disabling logic (unlike the old approach)
- Required field - validation message example:
  `PROCESS_ACTIVITY ['Review Market Data'] requires a value in field 'user_interaction_level'.`

**Files likely involved:**
- Components under `frontend/src/components/metaModel/` (where Activities grid is implemented)
- Shared column configuration files

### Section 3: Diagram Rendering

**Colour mapping by user_interaction_level:**

| Level | Background Colour |
|-------|------------------|
| `AUTOMATED` | Medium green (slightly darker than light green used for Business Processes, still light enough for black text) |
| `MINIMAL` | Light green |
| `MODERATE` | Light yellow |
| `SIGNIFICANT` | Light red |

**Rendering rules:**
- Process_activity node shape remains a rounded rectangle with the activity name as label
- Positioning and layout rules stay as-is (stacked inside parent Business Process with padding, moving with parent)
- Exact hex values can be chosen to fit existing palette, respecting the above semantics

**Centralised colour logic:**
- Introduce helper function: `getProcessActivityFill(activity: ProcessActivity): string`
- This helper maps `user_interaction_level` to a fill colour
- Use this helper everywhere process_activity nodes are rendered
- Do NOT persist colours into diagram metadata - colours must be derived from meta-model at render time

**Files likely involved:**
- `frontend/src/utils/rendering.ts` (or equivalent)
- Any specific node renderer for PROCESS_ACTIVITY type

### Section 4: Live Update Behaviour

**Requirement:** When a user edits the Activities grid and changes the User Interaction Level for a given process_activity, any currently visible diagrams that contain nodes for that activity must update their background colour immediately.

**Implementation approach:**
- Diagram renderer consumes process_activity state directly from shared context/store (ArchitectureContext or equivalent)
- When Activities grid updates a process_activity's `user_interaction_level`, this updates shared state and triggers React re-render
- On re-render, renderer recomputes fill colours via `getProcessActivityFill(...)` and redraws with new colour
- No manual refresh or reload of JSON should be required

### Section 5: Migration and Backwards Compatibility

**Migration logic for JSON load:**

When loading a JSON model that still has the old fields (`is_manual`, `user_input_amount`), derive `user_interaction_level` as follows:

| Old Fields | New Value |
|------------|-----------|
| `is_manual === false` (any `user_input_amount`) | `"AUTOMATED"` |
| `is_manual === true` AND `user_input_amount === "MINIMAL"` | `"MINIMAL"` |
| `is_manual === true` AND `user_input_amount === "MODERATE"` | `"MODERATE"` |
| `is_manual === true` AND `user_input_amount === "SIGNIFICANT"` | `"SIGNIFICANT"` |
| Neither pattern matches (missing values) | `"AUTOMATED"` (default) |

**Save behaviour:**
- After migration in-memory, only the new `user_interaction_level` should be persisted on save
- The old fields (`is_manual`, `user_input_amount`) must NOT be written back to JSON

**Clean-up requirements:**
- Remove all references to `is_manual` and `user_input_amount` from:
  - Types
  - Components
  - Validation rules
  - Any tests

## Acceptance Criteria

### AC1: ProcessActivity Interface Updated
- `ProcessActivity` interface in `frontend/src/types/model.ts` has `user_interaction_level: "AUTOMATED" | "MINIMAL" | "MODERATE" | "SIGNIFICANT"`
- `ProcessActivity` interface does NOT have `is_manual` or `user_input_amount` fields

### AC2: Grid Shows Single Dropdown Column
- Activities grid displays a single "User Interaction Level" column
- Column is a dropdown with exactly 4 options: Automated, Minimal, Moderate, Significant
- No "Is Manual" or "User Input Amount" columns exist

### AC3: Migration Converts Old Fields
- Loading a JSON file with old fields (`is_manual`, `user_input_amount`) correctly derives `user_interaction_level`:
  - `is_manual=false` with any `user_input_amount` -> `"AUTOMATED"`
  - `is_manual=true` with `user_input_amount="MINIMAL"` -> `"MINIMAL"`
  - `is_manual=true` with `user_input_amount="MODERATE"` -> `"MODERATE"`
  - `is_manual=true` with `user_input_amount="SIGNIFICANT"` -> `"SIGNIFICANT"`
- Saving after migration only persists `user_interaction_level` (old fields not written)

### AC4: Diagram Nodes Show Correct Colours
- Process_activity nodes on diagrams display background colour based on `user_interaction_level`:
  - `AUTOMATED` -> medium green
  - `MINIMAL` -> light green
  - `MODERATE` -> light yellow
  - `SIGNIFICANT` -> light red

### AC5: Live Colour Updates
- Changing `user_interaction_level` in the Activities grid immediately updates the corresponding diagram node colour
- No JSON reload or manual refresh required
- Works for any diagram currently visible that contains the edited activity

### AC6: Default Value for New Rows
- When creating a new process_activity row in the grid, `user_interaction_level` defaults to `"AUTOMATED"`

### AC7: Validation Works Correctly
- Required field validation for `user_interaction_level` produces appropriate error message
- No validation logic references old fields

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A - This is a data model and rendering logic change; no visual mockups required.

## Scope Boundaries

### In Scope:
- Meta-model changes to `ProcessActivity` interface (remove old fields, add new field)
- Activities grid UI changes (single dropdown column replacing two columns)
- Diagram rendering colour mapping by `user_interaction_level`
- Centralised helper function `getProcessActivityFill()`
- Live update behaviour when meta-model is edited
- Migration logic for loading old JSON formats
- Clean save behaviour (only new field persisted)
- Removal of all old field references from types, components, validation, tests
- New/updated tests for migration, grid, rendering, and integration

### Out of Scope:
- Changes to other `ProcessActivity` fields (name, description, sequence_order, actor_hint, tags, valid_from, valid_to, etc.)
- New features beyond the field consolidation
- Changes to other entity types
- Changes to diagram layout or positioning logic
- Backend changes (this is frontend-only scope)
- Performance optimizations beyond what's necessary for live updates

## Requirements Summary

### Functional Requirements
- Single `user_interaction_level` enum field replaces `is_manual` and `user_input_amount`
- Four valid values: AUTOMATED, MINIMAL, MODERATE, SIGNIFICANT
- Default value for new activities: AUTOMATED
- Grid column with dropdown for selecting value
- Diagram nodes coloured by interaction level
- Colours derived at render time from meta-model state
- Live updates to diagrams when meta-model changes
- Backwards-compatible loading of old JSON format

### Reusability Opportunities
- `getProcessActivityFill()` helper can be reused anywhere process_activity rendering occurs
- Migration pattern could serve as template for future field consolidations
- Shared context update pattern already exists in ArchitectureContext

### Technical Considerations
- TypeScript interface changes require updating all consumers
- Migration logic should be in file loading utilities (`frontend/src/utils/fileOperations.ts`)
- Rendering utilities in `frontend/src/utils/rendering.ts`
- Grid configuration likely in `frontend/src/config/gridConfigs.ts`
- Shared state via React Context (ArchitectureContext)
- Test framework: Vitest with React Testing Library

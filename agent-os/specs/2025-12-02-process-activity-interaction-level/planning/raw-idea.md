# Process Activity User Interaction Level Update

Update the process_activity meta-model and diagram rendering to replace the two fields "Is Manual" and "User Input Amount" with a single "User Interaction Level" enum, and ensure diagrams update colours automatically when this value changes.

## Problem
The current process_activity meta-model and UI use two fields to represent how much user interaction is required:
- is_manual: boolean
- user_input_amount: "NA" | "MINIMAL" | "MODERATE" | "SIGNIFICANT"

This leads to confusion and awkward logic (e.g. "NA" only makes sense when is_manual=false). The diagram colouring logic for process_activity nodes (background colours based on user_input_amount) is also not behaving correctly and is hard to reason about with the split fields.

We want a single, clear field representing user interaction level, and we want process_activity boxes on diagrams to reliably change background colour when that field changes in the meta-model.

## Required Changes

### 1. Meta-model and TypeScript model

Entity: process_activities

1. Remove the two fields:
   - is_manual: boolean
   - user_input_amount: "NA" | "MINIMAL" | "MODERATE" | "SIGNIFICANT"

2. Add a single field:
   - user_interaction_level: "AUTOMATED" | "MINIMAL" | "MODERATE" | "SIGNIFICANT"

3. Update all TypeScript interfaces and model code:
   - frontend/src/types/model.ts:
     - Update ProcessActivity interface to include user_interaction_level and remove is_manual + user_input_amount.
   - Update any validation logic that referenced the old fields to use the new enum.

4. Backwards-compatibility / migration for JSON load:
   - When loading a JSON model that still has the old fields, derive user_interaction_level as:
     - If is_manual === false → user_interaction_level = "AUTOMATED"
     - If is_manual === true and user_input_amount === "MINIMAL" → "MINIMAL"
     - If is_manual === true and user_input_amount === "MODERATE" → "MODERATE"
     - If is_manual === true and user_input_amount === "SIGNIFICANT" → "SIGNIFICANT"
   - If neither pattern matches (e.g. missing values), default to "AUTOMATED".
   - After migration in-memory, only the new user_interaction_level should be persisted on save; the old fields must not be written back to JSON.

5. New JSON schema shape for a process_activity (for docs / comments):
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

6. Default value for new rows:
   - When adding a new process_activity row, default user_interaction_level to "AUTOMATED".

### 2. Activities grid (Meta-model view UI)

File(s): components under frontend/src/components/metaModel/ (where Activities grid is implemented) plus any shared column config.

1. Replace the two columns "Is Manual" and "User Input Amount" with a single column:
   - Header: User Interaction Level
   - Control: a dropdown/select with the following options:
     - Automated
     - Minimal
     - Moderate
     - Significant

2. Column behaviour:
   - The column must directly bind to processActivity.user_interaction_level.
   - The dropdown's internal values should be the enum codes "AUTOMATED" | "MINIMAL" | "MODERATE" | "SIGNIFICANT", while labels are user-friendly (capitalised).
   - Remove any conditional disabling logic that depended on is_manual or "NA"; that logic is no longer relevant.

3. Ensure grid-level validation:
   - user_interaction_level is required for each process_activity row.
   - Validation message should follow our improved pattern, for example:
     - PROCESS_ACTIVITY ['Review Market Data'] requires a value in field 'user_interaction_level'.

### 3. Diagram rendering for process_activity nodes

There is already a notion of process_activity nodes nested inside a parent business_process box. We need to adjust their fill colour logic to use the new user_interaction_level enum.

Files likely involved:
- frontend/src/utils/rendering.ts (or equivalent)
- Any specific node renderer for PROCESS_ACTIVITY

1. Colour mapping:

Use the following mapping for the background colour of a process_activity node:

- user_interaction_level === "AUTOMATED"
  - Background: medium green (slightly darker than the light green used for Business Processes, but still light enough for black text to be readable).
- user_interaction_level === "MINIMAL"
  - Background: light green.
- user_interaction_level === "MODERATE"
  - Background: light yellow.
- user_interaction_level === "SIGNIFICANT"
  - Background: light red.

The exact hex values can be chosen to fit our existing palette, but must respect the above semantics.

2. Rendering rules:
   - The process_activity node shape remains a rounded rectangle with the activity name as its label.
   - Positioning and layout rules stay as they are now (stacked inside the parent Business Process with padding, moving with the parent).

3. Centralised colour logic:
   - Introduce a helper such as getProcessActivityFill(activity: ProcessActivity): string that maps user_interaction_level to a fill colour. Use this helper everywhere process_activity nodes are rendered.
   - Do not persist these colours into diagram meta-data; colours must be derived from the meta-model at render time.

### 4. Live update behaviour when the meta-model changes

When a user edits the Activities grid and changes the User Interaction Level for a given process_activity, any currently visible diagrams that contain nodes for that activity must update their background colour immediately.

Implementation detail:

- Ensure the diagram renderer consumes process_activity state directly from the shared context/store (ArchitectureContext or equivalent).
- When the Activities grid updates a process_activity's user_interaction_level, this should update the shared state and trigger a React re-render of the diagrams.
- On re-render, the renderer should recompute fill colours via getProcessActivityFill(...) and redraw with the new colour.
- No manual refresh or reload of JSON should be required.

### 5. Clean-up and tests

1. Remove all references to is_manual and user_input_amount from:
   - Types
   - Components
   - Validation rules
   - Any tests

2. Add / update tests:

- Model / migration tests:
  - Loading old JSON with is_manual=false and any user_input_amount → user_interaction_level="AUTOMATED".
  - Loading old JSON with is_manual=true and each of "MINIMAL" | "MODERATE" | "SIGNIFICANT" maps correctly.
  - Saving after migration only persists user_interaction_level.

- Grid tests:
  - Activities grid shows the User Interaction Level column as a dropdown with 4 options.
  - Edits are reflected in the underlying model.

- Rendering tests:
  - For each user_interaction_level value, the rendered process_activity node uses the expected colour token.
  - When user_interaction_level changes in the model, re-render updates the fill colour.

- Integration-style test:
  - Given a model with one Business Process and multiple process_activities with different interaction levels, the diagram shows those activities with different colours; changing a level in the grid changes the colour on the diagram without reloading JSON.

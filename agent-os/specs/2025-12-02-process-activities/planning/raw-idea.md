# Process Activities Feature - Raw Idea

Extend the meta-model and UI to introduce Process Activities as a first-class entity, including
meta-model schema, meta-model grid changes, palette updates, diagram rendering, and colour
semantics based on user input amount.

## 1. Meta-model: new `process_activities` entity

### 1.1 JSON schema

Add a new top-level entity collection under `metaModel.entities`:

- `process_activities`: array of objects with fields:

  - `id: string`
    - Primary key, required, unique.
  - `business_process_id: string`
    - FK to `business_processes.id`. Required.
  - `name: string`
    - Short label for the activity. Required, unique **within** a given `business_process_id`.
  - `description?: string`
  - `sequence_order?: number`
    - Optional numeric ordering hint for the activities within a process. Lower numbers appear earlier.
  - `actor_hint: "END_USER" | "EXTERNAL_USER" | "INTERNAL_SYSTEM" | "EXTERNAL_SYSTEM" | "HYBRID_USER_SYSTEM" | "BATCH_JOB" | "BOT_OR_RPA" | "OTHER"`
    - Required enum describing the primary actor.
  - `is_manual: boolean`
    - Required. Indicates whether this activity involves manual user interaction.
  - `user_input_amount: "NA" | "MINIMAL" | "MODERATE" | "SIGNIFICANT"`
    - Required enum describing the amount of user input if `is_manual=true`.
    - Behavioural rule:
      - If `is_manual=false`, `user_input_amount` **must** be `"NA"`.
      - If `is_manual=true`, `user_input_amount` **must not** be `"NA"` (i.e. must be one of `"MINIMAL"`, `"MODERATE"`, `"SIGNIFICANT"`).
  - Optional common fields (mirror other entities, if they already exist in the model):
    - `tags?: string`
    - `valid_from?: string` (`YYYY-QQ` format)
    - `valid_to?: string` (`YYYY-QQ` format)

Update `frontend/src/types/model.ts` to add the `ProcessActivity` interface and wire it into:

- `MetaModelEntities` (add `process_activities: ProcessActivity[]`).
- Any relevant helper types or discriminated unions.

### 1.2 Validation rules

Add validation rules wherever entity validation is performed:

- Ensure `business_process_id` is present and points to an existing `BusinessProcess`.
- Ensure `name` is non-empty.
- Enforce the `(is_manual, user_input_amount)` constraints:
  - If `is_manual === false` and `user_input_amount !== "NA"`, raise a validation error.
  - If `is_manual === true` and `user_input_amount === "NA"`, raise a validation error.
- Optionally enforce uniqueness of `name` **per process**:
  - No two `process_activities` with the same `business_process_id` may share the same `name`.

Include meaningful error messages in the existing validation dialog, following the same pattern:
`PROCESS_ACTIVITY ['Activity Name'] requires a value in field 'business_process_id'` etc.

---

## 2. Meta-model UI: Entities header and Activities grid

### 2.1 Entities header bar grouping

Update the meta-model header tabs (in `MetaModelView` / equivalent component) to:

- Show the entities grouped visually as:

  - **Business Architecture**:
    - `Users`
    - `Processes`
    - `Activities` (new)
  - Vertical separator (`|`)
  - **Application Architecture**:
    - `Applications`
    - `App Components`
    - `Services`
    - (Application Points remain JSON-only, not a tab)
  - Vertical separator (`|`)
  - **Data Architecture**:
    - `Logical Entities`
    - `Logical Attributes`
    - `Physical Entities`
    - `Physical Attributes`

The separators can be implemented as simple styled dividers between logical groups.

### 2.2 Activities grid

Add a new tab and grid for **Activities**:

- When the user clicks the **Activities** tab, show a table bound to `metaModel.entities.process_activities`.

Columns:

1. `ID` (read-only or auto-generated as per other entity tables).
2. `Business Process` (FK):
   - Typeahead / autocomplete over `metaModel.entities.business_processes`.
   - Searchable by `name` and/or `id` (using the "search by name or id" pattern used elsewhere).
   - Internally stores `business_process_id`.
3. `Name`:
   - Simple text column.
4. `Description`:
   - Text column (optional).
5. `Sequence Order`:
   - Numeric column (can be free text constrained to numbers).
6. `Actor Hint`:
   - Dropdown/autocomplete over the enum values:
     - END_USER, EXTERNAL_USER, INTERNAL_SYSTEM, EXTERNAL_SYSTEM,
       HYBRID_USER_SYSTEM, BATCH_JOB, BOT_OR_RPA, OTHER.
7. `Is Manual`:
   - Boolean dropdown (Yes/No) or checkbox, consistent with other boolean fields.
8. `User Input Amount`:
   - Dropdown over: NA, Minimal, Moderate, Significant.
   - Behaviour:
     - When `Is Manual = false`:
       - Field is disabled in the UI.
       - Value is automatically set to `"NA"` when editing and on save.
     - When `Is Manual = true`:
       - Field is enabled and required, may not be `"NA"`.

All add/edit/delete behaviour should match other entity tables, including inline editing and validation messages.

---

## 3. Diagram: Process Activities visualisation and containment

### 3.1 New `diagram_node` entity type

Update the diagram node type system to support a `PROCESS_ACTIVITY` node type:

- Extend the node type enum or equivalent union so it can represent:
  - `entity_type: "PROCESS_ACTIVITY"`
  - `entity_id: ProcessActivity.id`

Where we have mappings from `diagram_node.entity_type` to meta-model entities (e.g. to look up labels and default styling), add support for `PROCESS_ACTIVITY`:

- Label text = `process_activity.name`.
- Tooltips or other metadata may also include the parent process name, actor_hint, etc (optional).

### 3.2 Containment rules

Process Activities must be visually contained within their parent Business Process node:

- When a Process Activity node is created for activity `A` with `business_process_id = P`:
  - The node's `parent_node_id` should be set to the Business Process diagram node representing P (if present).
- When the Business Process node is moved or resized:
  - All contained Process Activity nodes move by the same delta (this is already implemented for other containment relationships; reuse that mechanism).
- Process Activity nodes cannot be dragged outside the bounds of their parent process box in v0 (optional but ideal); at minimum, they should move with the parent.

If the parent Business Process node is not on the diagram yet and a Process Activity is added directly, we can:

- Option A (simple): Also create the Business Process node automatically and place the activity inside it.
- For this spec, choose Option A and make that explicit:
  - When adding an individual activity and its parent process is not on the diagram:
    - Create the Business Process node at the current "new node position" (centre of viewport).
    - Add the Process Activity node inside that process box using the stacking layout rules described below.

### 3.3 Layout rules for Process Activities inside a Business Process

Use similar layout rules to "Add with business processes" for an Application:

- Activities for a given process should be stacked vertically inside the process box with:
  - 5px vertical gap between activity boxes.
  - 5px left/right padding from the process box border.
- Activity box height:
  - `5px padding (top) + text height + 5px padding (bottom)`.
- The Business Process box height and width must adjust to enclose all child activities plus padding:
  - Width >= max child box width + 2 * 5px padding.
  - Height >= 5px padding above first activity + sum(child box heights + 5px gap between) + any process title area.

When using "Add with process activities" (see below), apply this layout in one shot.

---

## 4. Palette (RHS) updates

### 4.1 New "Process Activities" section

In the RHS Palette panel:

- Under the "Business" group, sections should appear in this order:

  - `Business Users` (existing)
  - `Business Processes` (existing)
  - **`Process Activities`** (new)
  - then Applications / App Components / Services / etc as currently implemented.

**Process Activities section behaviour:**

- Each row corresponds to a `ProcessActivity` from the meta-model.
- Row enable/disable logic:
  - If there is already a `PROCESS_ACTIVITY` diagram node referencing that `process_activity.id` on the current diagram:
    - Row is **disabled** and shows a tooltip such as "Already on diagram".
  - Otherwise the row is **enabled**.

**Interactions:**

- Left-click on an enabled Process Activity row:
  - Add the Process Activity node to the diagram:
    - If the parent process node is present:
      - Add the activity inside the existing process box at the next available vertical position (below other activities).
      - Adjust the process box size as necessary.
    - If the parent process node is not present:
      - Auto-create the process box at the centre of the viewport.
      - Add the activity inside it (per layout rules).
- Right-click on an enabled row:
  - Show a context menu with at least:
    - `Add` (same behaviour as left-click).
  - Future options (e.g. "Add with siblings") can be added later, but not required now.

### 4.2 Enhancing Business Processes palette with "Add with process activities"

For each Business Process row in the Palette:

- Existing behaviour:
  - Left-click `Add` adds just the Business Process node.
- New behaviour:
  - Right-click context menu options:
    - `Add` (existing behaviour).
    - **`Add with process activities`** (new).

`Add with process activities` must:

1. Create the Business Process node for the selected process (if not already on the diagram) at the centre of the viewport.
2. Look up all `process_activities` where `business_process_id === <this process id>`.
3. Create a `PROCESS_ACTIVITY` node for each of those activities and place them inside the process box using the layout rules in §3.3:
   - Stacked vertically with 5px gaps.
   - Process box sized to contain all activities plus padding.
4. Ensure that all newly added nodes are centre-aligned relative to the viewport, consistent with the existing "new node spawn" rules (recently updated to use the visible viewport rather than entire canvas).

If the process node already exists and some activities are already present on the diagram:

- `Add with process activities` should:
  - Add only those activities not already on the diagram.
  - Re-run the containment layout to pack all activities neatly.
  - Keep the process box's top-left position constant, expanding height/width as needed.

Palette state must refresh after adding nodes so that relevant Process Activity rows become disabled.

---

## 5. Visual styling for Process Activity nodes

### 5.1 Base node appearance

Process Activity nodes should appear as rectangular boxes:

- Border style consistent with other nodes (e.g. 1px solid with default node border colour).
- Label text = `name`.
- Text layout inherits the existing node text rules (padding, wrapping, alignment) unless overridden by the inspector.

### 5.2 Background colour based on `user_input_amount`

By default (before any custom overrides via the inspector), the Process Activity background colour is driven by `user_input_amount`:

- `NA`:
  - Very light grey background (e.g. `#f5f5f5` or equivalent).
- `MINIMAL`:
  - Light green, darker than the business process's pale green but still light enough for black text to be legible.
- `MODERATE`:
  - Light orange background.
- `SIGNIFICANT`:
  - Light red background.

Implementation detail:

- Introduce a helper function, e.g. `getProcessActivityDefaultFill(activity: ProcessActivity): string`.
- Use this when constructing the node's initial `style` or `background_color`.
- If the user later overrides the node's colour via the inspector colour picker, that override should take precedence (existing behaviour for style overrides).

---

## 6. Diagram JSON and inspector compatibility

Ensure that:

- `PROCESS_ACTIVITY` nodes fully participate in:
  - JSON load/save (no loss of `entity_type`, `entity_id`, containment, or styling).
  - Canvas selection, multi-select, drag/move, resize, delete, and undo/redo, the same way as other nodes.
  - Inspector panel (font size, font styles, alignment, colours) in the left-hand inspector pane.
- The new entity type doesn't break any existing switch statements or exhaustive checks on node types.

Add/update tests to cover:

- JSON roundtrip for `process_activities` and `PROCESS_ACTIVITY` nodes.
- Palette enable/disable logic for Process Activities and Business Processes.
- `Add with process activities` behaviour:
  - Positions and sizes of process and activity nodes.
  - Containment and movement together.
- Colour mapping from `user_input_amount` to background colour.

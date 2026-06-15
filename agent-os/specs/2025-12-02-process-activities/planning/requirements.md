# Spec Requirements: Process Activities

## Initial Description

Extend the meta-model and UI to introduce Process Activities as a first-class entity, including meta-model schema, meta-model grid changes, palette updates, diagram rendering, and colour semantics based on user input amount.

This feature adds a new entity type `ProcessActivity` that represents individual activities within a Business Process, enabling architects to capture finer-grained detail about what happens within each process, who performs each activity, and how much user interaction is required.

## Context / Current Behaviour

Business Processes exist as a core entity in the Business Architecture domain, but currently have no sub-activities. Architects can model processes at a high level but cannot decompose them into constituent activities. This limits the ability to:

- Understand the detailed flow within a process
- Identify which activities require user input vs automated execution
- Visualize the internal structure of processes on diagrams
- Track which actors (end users, systems, bots) are involved at each step

The current meta-model supports:
- Business Users and Business Processes in Business Architecture
- Applications, App Components, Services, and Application Points in Application Architecture
- Logical/Physical Entities and Attributes in Data Architecture
- Relationships connecting entities across domains

Business Process nodes on diagrams are rendered as simple rectangles without any internal structure or contained elements.

## Desired Behaviour

### Section 1: Meta-model Schema (ProcessActivity Interface)

Add a new top-level entity collection `process_activities` under `metaModel.entities` with the following structure:

**ProcessActivity Interface Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Primary key, unique across all process activities |
| `business_process_id` | string | Yes | Foreign key to `business_processes.id` |
| `name` | string | Yes | Short label for the activity, unique within a given `business_process_id` |
| `description` | string | No | Optional description of the activity |
| `sequence_order` | number | No | Numeric ordering hint; lower numbers appear earlier |
| `actor_hint` | ActorHint enum | Yes | Primary actor performing this activity |
| `is_manual` | boolean | Yes | Whether activity involves manual user interaction |
| `user_input_amount` | UserInputAmount enum | Yes | Amount of user input required |
| `tags` | string | No | Optional tags (consistent with other entities) |
| `valid_from` | string | No | Temporal validity start (`YYYY-QQ` format) |
| `valid_to` | string | No | Temporal validity end (`YYYY-QQ` format) |

**ActorHint Enum Values:**
- `END_USER` - Activity performed by end user
- `EXTERNAL_USER` - Activity performed by external user
- `INTERNAL_SYSTEM` - Activity performed by internal system
- `EXTERNAL_SYSTEM` - Activity performed by external system
- `HYBRID_USER_SYSTEM` - Combination of user and system
- `BATCH_JOB` - Scheduled batch process
- `BOT_OR_RPA` - Robotic process automation
- `OTHER` - Other actor type

**UserInputAmount Enum Values:**
- `NA` - Not applicable (for non-manual activities)
- `MINIMAL` - Minimal user input required
- `MODERATE` - Moderate user input required
- `SIGNIFICANT` - Significant user input required

**Validation Rules:**

1. `business_process_id` must be present and reference an existing `BusinessProcess`
2. `name` must be non-empty
3. `name` must be unique within the same `business_process_id` (no duplicate activity names per process)
4. If `is_manual === false`, then `user_input_amount` must be `"NA"`
5. If `is_manual === true`, then `user_input_amount` must NOT be `"NA"` (must be MINIMAL, MODERATE, or SIGNIFICANT)

**Validation Error Messages:**
Following existing pattern: `PROCESS_ACTIVITY ['Activity Name'] requires a value in field 'business_process_id'`

**TypeScript Updates:**
- Add `ProcessActivity` interface to `frontend/src/types/model.ts`
- Add `process_activities: ProcessActivity[]` to `MetaModelEntities`
- Add relevant helper types and discriminated unions as needed

### Section 2: Meta-model UI (Header Grouping and Activities Grid)

**2.1 Entities Header Bar Grouping**

Update the meta-model header tabs to show entities grouped visually with vertical separators:

```
Business Architecture          | Application Architecture                              | Data Architecture
Users | Processes | Activities | Applications | App Components | Services              | Logical Entities | Logical Attributes | Physical Entities | Physical Attributes
```

Note: Application Points remain JSON-only (not a visible tab)

**2.2 Activities Grid**

Add a new "Activities" tab bound to `metaModel.entities.process_activities` with the following columns:

| Column | Type | Behaviour |
|--------|------|-----------|
| ID | Read-only or auto-generated | Same pattern as other entity tables |
| Business Process | Typeahead/autocomplete | Search over `business_processes` by name or id; stores `business_process_id` |
| Name | Text | Simple text input |
| Description | Text | Optional text input |
| Sequence Order | Numeric | Free text constrained to numbers |
| Actor Hint | Dropdown | Enum values: END_USER, EXTERNAL_USER, INTERNAL_SYSTEM, EXTERNAL_SYSTEM, HYBRID_USER_SYSTEM, BATCH_JOB, BOT_OR_RPA, OTHER |
| Is Manual | Boolean dropdown/checkbox | Yes/No, consistent with other boolean fields |
| User Input Amount | Dropdown | Values: NA, Minimal, Moderate, Significant |

**User Input Amount Field Behaviour:**
- When `Is Manual = false`: Field is disabled; value automatically set to `"NA"`
- When `Is Manual = true`: Field is enabled and required; may not be `"NA"`

All add/edit/delete behaviour matches other entity tables including inline editing and validation messages.

### Section 3: Diagram Visualization (PROCESS_ACTIVITY Node Type)

**3.1 New Diagram Node Entity Type**

Extend the diagram node type system to support `PROCESS_ACTIVITY`:

```typescript
entity_type: "PROCESS_ACTIVITY"
entity_id: ProcessActivity.id
```

- Label text = `process_activity.name`
- Tooltips may include parent process name, actor_hint, etc. (optional enhancement)

**3.2 Containment Rules**

Process Activities must be visually contained within their parent Business Process node:

1. When creating a Process Activity node for activity `A` with `business_process_id = P`:
   - Set `parent_node_id` to the Business Process diagram node representing P (if present)

2. When Business Process node is moved or resized:
   - All contained Process Activity nodes move by the same delta (reuse existing containment mechanism)

3. Process Activity nodes cannot be dragged outside parent process bounds (or at minimum, move with parent)

4. **Auto-creation of parent:** If adding a Process Activity when its parent Business Process is not on the diagram:
   - Create the Business Process node at centre of viewport
   - Add the Process Activity node inside it using stacking layout rules

**3.3 Layout Rules for Process Activities Inside a Business Process**

Similar to "Add with business processes" for Applications:

- Activities stacked vertically inside process box
- **5px vertical gap** between activity boxes
- **5px left/right padding** from process box border
- Activity box height: `5px padding (top) + text height + 5px padding (bottom)`

**Business Process box sizing:**
- Width >= max child box width + 2 * 5px padding
- Height >= 5px padding above first activity + sum(child box heights + 5px gap between) + process title area

### Section 4: Palette Updates

**4.1 New "Process Activities" Section**

In the RHS Palette panel, under "Business" group, sections appear in order:
1. Business Users (existing)
2. Business Processes (existing)
3. **Process Activities** (new)
4. Applications / App Components / Services / etc.

**Process Activities Section Behaviour:**

- Each row corresponds to a `ProcessActivity` from the meta-model
- **Row enable/disable logic:**
  - If `PROCESS_ACTIVITY` diagram node for this `process_activity.id` already exists on current diagram: Row is **disabled** with tooltip "Already on diagram"
  - Otherwise: Row is **enabled**

**Interactions:**

- **Left-click on enabled row:**
  - If parent process node is present: Add activity inside existing process box at next available vertical position; adjust process box size as needed
  - If parent process node is not present: Auto-create process box at centre of viewport; add activity inside per layout rules

- **Right-click on enabled row:**
  - Context menu with `Add` option (same as left-click)
  - Future options (e.g., "Add with siblings") can be added later

**4.2 Enhancing Business Processes Palette with "Add with process activities"**

For each Business Process row in Palette:

- **Existing behaviour:** Left-click adds just the Business Process node
- **New right-click context menu options:**
  - `Add` (existing behaviour)
  - **`Add with process activities`** (new)

**"Add with process activities" must:**

1. Create Business Process node (if not already on diagram) at centre of viewport
2. Look up all `process_activities` where `business_process_id === <this process id>`
3. Create `PROCESS_ACTIVITY` node for each activity inside the process box
4. Apply layout rules: stacked vertically with 5px gaps, process box sized to contain all activities plus padding
5. Centre-align all newly added nodes relative to visible viewport

**If process node already exists and some activities already present:**
- Add only activities not already on diagram
- Re-run containment layout to pack all activities neatly
- Keep process box top-left position constant; expand height/width as needed

**Palette state must refresh** after adding nodes so Process Activity rows become disabled appropriately.

### Section 5: Visual Styling (Background Colours Based on user_input_amount)

**5.1 Base Node Appearance**

Process Activity nodes appear as rectangular boxes:
- Border style consistent with other nodes (1px solid with default node border colour)
- Label text = `name`
- Text layout inherits existing node text rules (padding, wrapping, alignment) unless overridden by inspector

**5.2 Background Colour Based on `user_input_amount`**

Default background colours (before any custom inspector overrides):

| user_input_amount | Background Colour | Description |
|-------------------|-------------------|-------------|
| `NA` | `#f5f5f5` | Very light grey |
| `MINIMAL` | Light green | Darker than pale green of business process, legible with black text |
| `MODERATE` | Light orange | Indicates moderate user interaction |
| `SIGNIFICANT` | Light red | Indicates significant user interaction |

**Implementation:**
- Helper function: `getProcessActivityDefaultFill(activity: ProcessActivity): string`
- Used when constructing node's initial `style` or `background_color`
- If user overrides colour via inspector colour picker, override takes precedence (existing behaviour)

### Section 6: JSON and Inspector Compatibility

**Full participation in existing systems:**

- **JSON load/save:** No loss of `entity_type`, `entity_id`, containment, or styling
- **Canvas operations:** Selection, multi-select, drag/move, resize, delete, undo/redo
- **Inspector panel:** Font size, font styles, alignment, colours in left-hand inspector pane

**Code safety:**
- New entity type must not break existing switch statements or exhaustive checks on node types
- Add/update tests to cover:
  - JSON roundtrip for `process_activities` and `PROCESS_ACTIVITY` nodes
  - Palette enable/disable logic for Process Activities and Business Processes
  - "Add with process activities" behaviour: positions, sizes, containment, movement
  - Colour mapping from `user_input_amount` to background colour

## Acceptance Criteria

### Process Activity Entity CRUD in Grid

- [ ] Activities tab appears in meta-model UI under Business Architecture group
- [ ] Header shows grouping with `|` separators between Business/Application/Data architecture
- [ ] Can add new Process Activity with all required fields
- [ ] Can edit existing Process Activity inline
- [ ] Can delete Process Activity
- [ ] Business Process field uses typeahead searching by name or id
- [ ] Actor Hint dropdown shows all 8 enum values
- [ ] User Input Amount dropdown shows all 4 enum values

### Validation of is_manual/user_input_amount Constraints

- [ ] When `is_manual = false`, User Input Amount field is disabled and auto-set to "NA"
- [ ] When `is_manual = true`, User Input Amount field is enabled and required
- [ ] Validation error shown if `is_manual = true` and `user_input_amount = "NA"`
- [ ] Validation error shown if `is_manual = false` and `user_input_amount != "NA"`
- [ ] Validation error shown if `business_process_id` references non-existent process
- [ ] Validation error shown for duplicate `name` within same process

### Activities Appear in Palette and Can Be Added to Diagram

- [ ] "Process Activities" section appears in RHS palette under Business group
- [ ] Each ProcessActivity from meta-model shown as palette row
- [ ] Rows for activities already on diagram are disabled with tooltip
- [ ] Left-click on enabled row adds activity to diagram
- [ ] Right-click shows context menu with "Add" option

### Containment Within Parent Business Process

- [ ] Process Activity nodes have `parent_node_id` set to parent process node
- [ ] When parent process is moved, contained activities move together
- [ ] When parent process is resized, contained activities remain properly positioned
- [ ] If adding activity when parent process not on diagram, process is auto-created

### "Add with process activities" Creates Process + All Activities

- [ ] Right-click on Business Process row shows "Add with process activities" option
- [ ] Option creates process node at viewport centre if not present
- [ ] All activities for that process are added inside the process box
- [ ] Activities are stacked vertically with 5px gaps
- [ ] Process box is sized to contain all activities with proper padding
- [ ] Only activities not already on diagram are added
- [ ] Palette refreshes to disable newly-added activity rows

### Background Colour Reflects user_input_amount

- [ ] `NA` activities have `#f5f5f5` (light grey) background
- [ ] `MINIMAL` activities have light green background
- [ ] `MODERATE` activities have light orange background
- [ ] `SIGNIFICANT` activities have light red background
- [ ] Inspector colour override takes precedence over default colours

### Inspector Styling Works for Process Activity Nodes

- [ ] Process Activity nodes can be selected on canvas
- [ ] Inspector panel shows styling options for selected activity node
- [ ] Can change font size, font style, alignment
- [ ] Can change background colour (overrides default)
- [ ] Can change border colour
- [ ] Styling persists through JSON save/load

## Visual Assets

No visual assets provided.

## Scope Boundaries

### In Scope

1. **Meta-model schema:** `ProcessActivity` interface with all specified fields and enums
2. **Meta-model UI:** Header grouping with separators, Activities grid with all columns
3. **Diagram visualization:** `PROCESS_ACTIVITY` node type with containment and layout rules
4. **Palette updates:** New Process Activities section, "Add with process activities" context menu option
5. **Visual styling:** Background colours based on `user_input_amount` enum
6. **JSON and inspector compatibility:** Full participation in existing systems

### Out of Scope

- **Activity-to-activity relationships/flows:** No modelling of sequence flows or transitions between activities
- **BPMN-style swimlanes:** No swimlane or pool visualization
- **Activity dependencies:** No dependency tracking between activities
- **Activity-level Application Points:** No direct linking of activities to application points
- **Import from BPMN:** No import capability from BPMN XML or other process modelling formats
- **Activity execution metrics:** No capture of timing, cost, or performance data
- **Sub-activities:** No nesting of activities within activities

## Requirements Summary

### Functional Requirements

- Introduce `ProcessActivity` as a first-class entity in the meta-model
- Provide full CRUD operations through the Activities grid
- Enable Process Activities to appear on diagrams contained within their parent Business Process
- Support adding activities individually or in bulk via "Add with process activities"
- Apply visual distinction based on `user_input_amount` through background colouring
- Ensure full compatibility with existing selection, styling, and persistence mechanisms

### Reusability Opportunities

Based on product context and existing codebase:

- **Containment mechanism:** Reuse existing containment logic used for components within applications
- **Typeahead components:** Reuse existing FK typeahead pattern from relationship editing
- **Palette section pattern:** Follow existing Business Users / Business Processes section structure
- **"Add with X" pattern:** Reference existing "Add with business processes" implementation for Applications
- **Colour mapping:** May reference existing node styling/colour utilities
- **Validation pattern:** Follow existing validation error message format and display

### Technical Considerations

- Update `frontend/src/types/model.ts` for `ProcessActivity` interface
- Update `frontend/src/config/gridConfigs.ts` for Activities grid configuration
- Update palette data utilities for new section
- Update rendering utilities for `PROCESS_ACTIVITY` node type
- Ensure exhaustive switch statements handle new entity type
- Add comprehensive test coverage for new functionality

# Specification: Process Activities

## Goal
Introduce ProcessActivity as a first-class entity in the architecture meta-model, enabling architects to decompose Business Processes into constituent activities with full support for CRUD operations, diagram visualization with containment, and visual styling based on user input amount.

## User Stories
- As a business analyst, I want to define activities within a business process so that I can capture detailed process flows.
- As a diagram author, I want to visualize process activities contained within their parent process so that I can show process decomposition.
- As a diagram author, I want activities coloured by user input amount so that I can quickly identify manual vs automated activities.

## Specific Requirements

**ProcessActivity Interface and Schema**
- Add `ProcessActivity` interface to `frontend/src/types/model.ts` with fields: id, business_process_id, name, description, sequence_order, actor_hint, is_manual, user_input_amount, tags, valid_from, valid_to
- Add `ActorHint` type with values: END_USER, EXTERNAL_USER, INTERNAL_SYSTEM, EXTERNAL_SYSTEM, HYBRID_USER_SYSTEM, BATCH_JOB, BOT_OR_RPA, OTHER
- Add `UserInputAmount` type with values: NA, MINIMAL, MODERATE, SIGNIFICANT
- Add `process_activities: ProcessActivity[]` to `MetaModelEntities` interface
- Update `emptyModel` in defaults.ts to include empty `process_activities` array

**PROCESS_ACTIVITY Entity Type Constant**
- Add `PROCESS_ACTIVITY: 'PROCESS_ACTIVITY'` to `ENTITY_TYPES` const in model.ts
- Update `DiagramEntityType` type to include the new value
- Add `'process_activities'` to `EntityType` union type
- Update `AnyEntity` union to include `ProcessActivity`

**Validation Rules for ProcessActivity**
- `business_process_id` required and must reference existing BusinessProcess
- `name` required and unique within same `business_process_id` (scoped uniqueness)
- If `is_manual === false`, then `user_input_amount` must be `"NA"` (auto-set in UI)
- If `is_manual === true`, then `user_input_amount` must NOT be `"NA"`
- Error message format: `PROCESS_ACTIVITY ['Activity Name'] requires a value in field 'field_name'`

**Meta-model Header Bar Grouping**
- Update header tabs to show vertical separator groupings: Business (Users, Processes, Activities) | Application (Applications, App Components, Services) | Data (Logical Entities, Logical Attributes, Physical Entities, Physical Attributes)
- Add CSS styling for `|` separator between architecture domain groups
- "Activities" tab positioned immediately after "Processes" within Business group

**Activities Grid Configuration**
- Add `process_activities` entry to gridConfigs with columns: ID (auto-generate), Business Process (fk_typeahead to business_processes), Name (text), Description (text), Sequence Order (numeric), Actor Hint (dropdown), Is Manual (boolean), User Input Amount (dropdown)
- User Input Amount field: disabled and auto-set to "NA" when Is Manual is false; enabled and required when Is Manual is true
- Add `actorHintOptions` and `userInputAmountOptions` arrays to defaults.ts

**PROCESS_ACTIVITY Diagram Node Type**
- Support `entity_type: "PROCESS_ACTIVITY"` in DiagramNode with `entity_id` referencing ProcessActivity.id
- Node label displays `process_activity.name`
- Set `parent_node_id` to the Business Process diagram node when activity is added
- Child activities move with parent when parent is dragged (existing containment mechanism)

**Containment and Layout Rules**
- Activities stacked vertically inside parent Business Process box with 5px gaps between activities
- 5px left/right padding from process box border
- Activity box height: 5px top padding + text height + 5px bottom padding
- Process box auto-sizes: width >= max child width + 10px padding; height includes label area + all activities with gaps
- Reuse `calculateChildPositionWithHeights` and `calculateParentSizeWithHeights` from compoundLayout.ts

**Auto-Create Parent Process**
- When adding a ProcessActivity whose parent BusinessProcess is not on diagram, auto-create the process node at viewport center
- Add the activity inside using stacking layout rules
- This applies to both left-click and context menu "Add" actions

**Palette Panel Updates**
- Add "Process Activities" section in palette after "Business Processes" section
- Section lists all ProcessActivity entities from meta-model
- Rows disabled with tooltip "Already on diagram" when PROCESS_ACTIVITY node exists for that entity
- Left-click on enabled row adds activity to diagram (auto-creates parent process if needed)
- Right-click context menu with "Add" option

**Business Process Context Menu Enhancement**
- Add "Add with process activities" option to Business Process palette context menu
- Behaviour: creates process node (if not present), finds all activities where `business_process_id` matches, creates PROCESS_ACTIVITY nodes inside using vertical stacking layout
- Only adds activities not already on diagram
- Process box sized to contain all activities with proper padding
- Palette refreshes to disable newly-added activity rows

**Background Colour by user_input_amount**
- NA: `#f5f5f5` (light grey) - automated activities
- MINIMAL: `#c8e6c9` (light green) - low user interaction
- MODERATE: `#ffe0b2` (light orange) - medium user interaction
- SIGNIFICANT: `#ffcdd2` (light red) - high user interaction
- Add `PROCESS_ACTIVITY` entry to `entityColors` in defaults.ts (default colour for border)
- Create helper function `getProcessActivityDefaultFill(activity: ProcessActivity): string`

**Colour Override Precedence**
- Inspector panel colour picker overrides take precedence over default user_input_amount colours
- If `background_color` is set on DiagramNode, use that; otherwise apply default based on user_input_amount
- Apply colour logic in rendering.ts when drawing PROCESS_ACTIVITY nodes

**JSON Load/Save Compatibility**
- Ensure `process_activities` array is saved/loaded in metaModel.entities
- PROCESS_ACTIVITY diagram nodes persist with entity_type, entity_id, parent_node_id, and all styling properties
- Backward compatibility: missing `process_activities` array defaults to empty array on load

**Inspector Panel Support**
- Process Activity nodes selectable on canvas with resize handles
- Inspector panel shows styling options: font size, font weight, font style, text alignment, background colour, border colour, text colour
- Drag, resize, delete, undo/redo all function for PROCESS_ACTIVITY nodes

## Existing Code to Leverage

**ENTITY_TYPES and entityColors in model.ts and defaults.ts**
- Follow existing pattern for adding new entity type constant
- Add PROCESS_ACTIVITY entry following APPLICATION, APP_COMPONENT, SERVICE pattern for colours

**Containment Mechanism (parent_node_id, child movement)**
- Existing containment logic in Canvas.tsx handles child node movement when parent moves
- Reuse for ProcessActivity nodes inside BusinessProcess nodes

**compoundLayout.ts Utilities**
- Reuse `calculateChildPositionWithHeights`, `calculateParentSizeWithHeights`, `countExistingChildren`
- Add `findProcessActivities(metaModel, businessProcessId)` helper following `findAppComponents` pattern

**TypeaheadCell Component and gridConfigs Pattern**
- Follow `app_components` grid config for FK typeahead to parent entity
- `business_process_id` column uses `fk_typeahead` with `fkTarget: 'business_processes'`

**"Add with business processes" Pattern in PalettePanel.tsx**
- Implement "Add with process activities" following `handleAddWithBusinessProcesses` handler pattern
- Similar logic: find or create parent, look up children, filter already-present, create nodes with layout

## Out of Scope
- Activity-to-activity relationships or sequence flows between activities
- BPMN-style swimlanes, pools, or lane assignments
- Activity dependencies, gateways, or branching logic
- Activity-level Application Point linking
- Import from BPMN XML or other process modelling formats
- Activity execution metrics (timing, cost, performance data)
- Sub-activities or nested activity hierarchies
- Automatic process discovery or mining
- Drag activities between different Business Process containers
- Activity reordering via drag-and-drop within a process

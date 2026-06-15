# Spec Requirements: Data Movement Application Points

## Initial Description

Update the Data Movements relationship to use Application Points instead of Applications, and keep the meta-model UI, palette enable/disable logic, and edge creation behaviour consistent with the App Point <-> Process relationship.

Data Movements should model data flows between **Application Points** (the unified representation of Applications, App Components, and Services), not directly between Applications. The meta-model, meta-model UI, palette behaviour, and diagram edge creation must all be updated accordingly.

## Context / Current Behaviour

Data Movements currently use `source_application_id` and `target_application_id` fields that reference Applications directly. This approach:

- Does not align with the Application Points abstraction that unifies Applications, Application Components, and Services
- Is inconsistent with other relationships like "App Point <-> Process" which already use Application Points
- Limits the ability to model data flows between Application Components or Services directly

The current `DataMovement` interface in `frontend/src/types/model.ts` has:
- `source_app_id: string` - FK to applications
- `target_app_id: string` - FK to applications

## Desired Behaviour

### Section 1: Meta-model JSON Changes

#### 1.1 Data Movements Shape

In `frontend/src/types/model.ts`, update the `DataMovement` interface:

**Old fields** (to be removed/deprecated):
- `source_app_id: string`
- `target_app_id: string`

**New fields** (canonical going forward):
- `source_application_point_id: string` - FK to application_points.id
- `target_application_point_id: string` - FK to application_points.id

Other fields (`id`, `logical_data_entity_id`, `type`, `description`, `tags`, `valid_from`, `valid_to`, etc.) remain unchanged.

If there is any existing compatibility shim that still refers to `source_app_id` / `target_app_id`, update it so that:
- The canonical internal representation uses `source_application_point_id` / `target_application_point_id`
- Any legacy JSON is either migrated on load (if currently supported) or clearly rejected with a helpful error

#### 1.2 Validation

Update validation utilities so that:
- `source_application_point_id` and `target_application_point_id` are required fields
- Both must correspond to an existing `application_points[id]` entry
- Any remaining logic that referenced `applications` for Data Movements now references `application_points` instead

### Section 2: Meta-model UI Updates

#### 2.1 Column Headings

In the **Meta-model -> Data Movements** tab, change the headings:
- From: **Source App**, **Target App**
- To: **Source App Point**, **Target App Point**

#### 2.2 Autocomplete Behaviour

For both `Source App Point` and `Target App Point` columns:

- Use the exact same autocomplete component/behaviour that is already used for the **Application Point** column in the **"App Point <-> Process"** relationship table

Concretely:
- The dropdown searches over all `application_points` in the meta-model
- Display label format: `"<application_point.name> (<type>)"` where `<type>` is one of:
  - `"Application"`
  - `"Application Component"`
  - `"Service"`
- Internally, the selected value must store **`application_points.id`** into:
  - `data_movements[n].source_application_point_id`
  - `data_movements[n].target_application_point_id`

Ensure the placeholder text and validation messages are updated to say "App Point" or "Application Point" (not "App").

### Section 3: Palette Behaviour

#### 3.1 Enable/Disable Rules (per diagram)

For each Data Movement `dm`:

**Endpoint IDs:**
- `source_ap_id = dm.source_application_point_id`
- `target_ap_id = dm.target_application_point_id`

On the **currently selected diagram only**, determine whether the endpoints are present as **nodes that represent those application points**.

A node "represents" an application point if **any** of these is true:
1. Node type is `APPLICATION_POINT` and `node.entity_id === source_ap_id / target_ap_id`, or
2. Node type is `APPLICATION`, and the application has an associated `application_point` with `id === source_ap_id / target_ap_id`, or
3. Node type is `APP_COMPONENT`, and its associated `application_point` matches the endpoint, or
4. Node type is `SERVICE`, and its associated `application_point` matches the endpoint

**Enabled state:**
- If at least one representing node exists on the current diagram for **both** endpoints:
  - Row is **enabled** (clickable)
  - Tooltip: e.g. `"Click to add this data movement to the diagram"`
- Otherwise:
  - Row is **disabled**
  - Tooltip: `"Both endpoints must be on diagram to add this relationship"`

This evaluation must be re-run whenever:
- The current diagram changes
- Nodes are added/removed from the diagram
- Nodes are deleted via multi-select or context menu

#### 3.2 Adding a Data Movement Edge

When the user left-clicks an enabled Data Movement row, **or** right-clicks and chooses **"Add"** in the context menu, then:

1. **Resolve endpoints:** `source_ap_id` and `target_ap_id` from the Data Movement row

2. **Choose concrete source/target nodes** on the current diagram:
   - Prefer a stable, deterministic strategy
   - E.g. first node found representing `source_ap_id` and `target_ap_id` using the same logic as the enablement check
   - Optionally favour node types in this priority order: `APPLICATION` -> `APP_COMPONENT` -> `SERVICE` -> `APPLICATION_POINT`, but consistency is more important than exact order

3. **Create a `diagram_edge`:**
   - `relationship_type: "DATA_MOVEMENT"`
   - `relationship_id: dm.id`
   - `source_node_id: <chosen source node.id>`
   - `target_node_id: <chosen target node.id>`

   **Styling:**
   - `line_type`: solid (or existing default for data movements)
   - `line_weight` / `line_dashes`: use current defaults for data movements
   - **Arrow**: make sure the edge has an arrow pointing to the **target** node:
     - `arrow_start = "NONE"`
     - `arrow_end = "ARROW"` (or the equivalent enum)

4. **Label behaviour** (unchanged semantics):
   - If `diagram_edge.label_text` is empty/undefined:
     - Default it to the Logical Data Entity name: `logical_data_entities[dm.logical_data_entity_id].name`
   - Place the label at the mid-point of the edge's points as today
   - Ensure the label remains clickable, draggable to a new position, and that its position is persisted in `label_pos_x`, `label_pos_y`

5. **After creation**, refresh palette state so that:
   - Any logic that avoids duplicate edges behaves consistently with how other relationships work

### Section 4: Helper Functions Consistency

Review and update any helper utilities involved in data-movement resolution, including but not limited to:
- `getRelationshipEndpointEntities(...)`
- `getDataMovementNodes(...)`
- Any `isDataMovementEligibleForDiagram(...)`-style functions

Requirements:
1. They should **only** use `source_application_point_id` / `target_application_point_id` from the meta-model
2. They must resolve "endpoint represented on diagram" via application points, using the same abstraction as the palette enablement logic described above
3. Any previous references to `source_app_id` / `target_app_id` must be removed or replaced

Reuse or mirror the abstraction already used for:
- App Point <-> Process relationship eligibility
- `getEntitiesOnDiagram()` / `getDataMovementNodes()` helpers

## Acceptance Criteria

### Key Scenarios

1. **DataMovement interface uses source_application_point_id/target_application_point_id**
   - The `DataMovement` interface in `frontend/src/types/model.ts` has `source_application_point_id` and `target_application_point_id` fields
   - Old fields `source_app_id` / `target_app_id` are removed or deprecated
   - Validation requires both fields reference existing application_points entries

2. **Grid columns show "Source App Point" / "Target App Point"**
   - Meta-model Data Movements tab displays columns titled "Source App Point" and "Target App Point"
   - Column headers no longer reference "Source App" / "Target App"

3. **Autocomplete searches application_points with type label**
   - Dropdown searches over all `application_points` in the meta-model
   - Display format shows: `"<app_point.name> (<type>)"` where type is Application/Application Component/Service
   - Selected value stores the `application_points.id`

4. **Palette enables row when both app points represented on diagram**
   - Data Movement row is enabled when both source and target application points have at least one representing node on the current diagram
   - A node represents an application point if it is: APPLICATION_POINT with matching entity_id, or APPLICATION/APP_COMPONENT/SERVICE with associated application_point matching the endpoint
   - Row is disabled with appropriate tooltip when endpoints are missing

5. **Edge creation finds correct nodes via app point abstraction**
   - When adding a Data Movement edge, system resolves which nodes represent the source and target application points
   - Uses deterministic selection strategy (e.g., first matching node, optionally with type priority)
   - Creates `diagram_edge` with correct `source_node_id` and `target_node_id`

6. **Arrow points to target node**
   - Created edges have `arrow_start = "NONE"` and `arrow_end = "ARROW"`
   - Visual arrow head points toward the target node (data destination)

### Unit Test Coverage

Add/extend unit tests to cover:
- A Data Movement between two Applications (via their `application_points`)
- A Data Movement between an Application Component and a Service
- Diagrams where only one endpoint is present (row disabled)
- Diagrams where both endpoints are present (row enabled, edge added correctly with arrow pointing to target)
- Palette behaviour when switching between diagrams

## Visual Assets

### Files Provided
No visual assets provided.

## Scope Boundaries

### In Scope

- **Meta-model schema**: Update `DataMovement` interface with new fields
- **Grid UI**: Update column headings and autocomplete behaviour in Data Movements tab
- **Palette logic**: Update enable/disable rules and edge creation for Data Movements section
- **Helper functions**: Update all data movement resolution utilities to use application points
- **Validation**: Update validators for new required fields
- **Unit tests**: Cover key scenarios for the updated behaviour

### Out of Scope

- Other relationship types (App Point <-> Process already uses this pattern)
- New Data Movement features beyond the field migration
- Migration tooling for existing JSON files (manual update or clear error messaging)
- UI changes beyond what is necessary for the field migration
- Backend changes (this is a frontend-only update)

## Technical Considerations

### Files Likely Involved

- `frontend/src/types/model.ts` - DataMovement interface
- `frontend/src/config/gridConfigs.ts` - Grid column configurations
- `frontend/src/components/Grid/TypeaheadCell.tsx` - Autocomplete component
- `frontend/src/utils/validation.ts` - Validation utilities
- `frontend/src/utils/paletteData.ts` - Palette enable/disable logic
- `frontend/src/utils/rendering.ts` - Edge creation utilities
- Components under `frontend/src/components/DiagramsView/Palette*` - Palette UI
- `frontend/src/utils/diagramUtils.ts` or similar - Helper functions

### Existing Patterns to Follow

- **App Point <-> Process relationship**: Already uses application points; follow same patterns
- **`getEntitiesOnDiagram()`**: Existing helper for determining entity representation
- **`getDataMovementNodes()`**: Helper that needs updating for application points
- **TypeaheadCell component**: Already implements application point autocomplete for other relationships

### Technical Details

- Old fields: `source_app_id`, `target_app_id` (FK to applications)
- New fields: `source_application_point_id`, `target_application_point_id` (FK to application_points)
- Display format: `"<app_point.name> (<type>)"` where type is Application/Application Component/Service
- Node representation: APPLICATION, APP_COMPONENT, SERVICE, or APPLICATION_POINT nodes can represent an app point
- Arrow styling: `arrow_start=NONE`, `arrow_end=ARROW`

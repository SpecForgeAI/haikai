Update the Data Movements relationship to use Application Points instead of Applications, and keep the meta-model UI, palette enable/disable logic, and edge creation behaviour consistent with the App Point ↔ Process relationship.

## Goal

Data Movements should model data flows between **Application Points** (the unified representation of Applications, App Components, and Services), not directly between Applications. The meta-model, meta-model UI, palette behaviour, and diagram edge creation must all be updated accordingly.

---

## 1. Meta-model JSON changes

### 1.1 Data Movements shape

In `frontend/src/types/model.ts`, update the `DataMovement` interface:

- **Old fields** (to be removed/deprecated):
  - `source_app_id: string`
  - `target_app_id: string`

- **New fields** (canonical going forward):
  - `source_application_point_id: string`  // FK to application_points.id
  - `target_application_point_id: string`  // FK to application_points.id

Other fields (`id`, `logical_data_entity_id`, `type`, `description`, `tags`, `valid_from`, `valid_to`, etc.) remain unchanged.

If there is any existing compatibility shim that still refers to `source_app_id` / `target_app_id`, update it so that:

- The canonical internal representation uses `source_application_point_id` / `target_application_point_id`.
- Any legacy JSON is either migrated on load (if currently supported) or clearly rejected with a helpful error.

### 1.2 Validation

Update validation utilities so that:

- `source_application_point_id` and `target_application_point_id` are required fields.
- Both must correspond to an existing `application_points[id]` entry.
- Any remaining logic that referenced `applications` for Data Movements now references `application_points` instead.

---

## 2. Meta-model UI: Data Movements grid

In the **Meta-model → Data Movements** tab:

### 2.1 Column headings

Change the headings:

- From: **Source App**, **Target App**
- To: **Source App Point**, **Target App Point**

### 2.2 Autocomplete behaviour

For both `Source App Point` and `Target App Point` columns:

- Use the exact same autocomplete component/behaviour that is already used for the **Application Point** column in the **"App Point ↔ Process"** relationship table.

Concretely:

- The dropdown searches over all `application_points` in the meta-model.
- Display label:
  `"<application_point.name> (<type>)"`
  where `<type>` is one of:
  - `"Application"`
  - `"Application Component"`
  - `"Service"`

- Internally, the selected value must store **`application_points.id`** into:
  - `data_movements[n].source_application_point_id`
  - `data_movements[n].target_application_point_id`

Ensure the placeholder text and validation messages are updated to say "App Point" or "Application Point" (not "App").

---

## 3. Palette (RHS) – Data Movements section

The Data Movements section in the Palette must now operate on **Application Points**, consistent with the updated meta-model.

Files likely involved:
- Components under `frontend/src/components/diagram/Palette*`
- Relationship helpers under `frontend/src/utils/relationshipUtils.ts` (or equivalent)

### 3.1 Enable/disable rules (per diagram)

For each Data Movement `dm`:

- Endpoint IDs:
  - `source_ap_id = dm.source_application_point_id`
  - `target_ap_id = dm.target_application_point_id`

- On the **currently selected diagram only**, determine whether the endpoints are present as **nodes that represent those application points**.

A node "represents" an application point if **any** of these is true:

1. Node type is `APPLICATION_POINT` and `node.entity_id === source_ap_id / target_ap_id`, or
2. Node type is `APPLICATION`, and the application has an associated `application_point` with `id === source_ap_id / target_ap_id`, or
3. Node type is `APP_COMPONENT`, and its associated `application_point` matches the endpoint, or
4. Node type is `SERVICE`, and its associated `application_point` matches the endpoint.

You can reuse or mirror the abstraction already used for:
- App Point ↔ Process relationship eligibility; and/or
- `getEntitiesOnDiagram()` / `getDataMovementNodes()` helpers that were recently updated.

**Enabled state:**

- If at least one representing node exists on the current diagram for **both** endpoints:
  - Row is **enabled** (clickable).
  - Tooltip: e.g. `"Click to add this data movement to the diagram"`.

- Otherwise:
  - Row is **disabled**.
  - Tooltip: `"Both endpoints must be on diagram to add this relationship"`.

This evaluation must be re-run whenever:
- The current diagram changes,
- Nodes are added/removed from the diagram,
- Nodes are deleted via multi-select or context menu.

### 3.2 Adding a Data Movement edge

When the user:

- Left-clicks an enabled Data Movement row, **or**
- Right-clicks and chooses **"Add"** in the context menu,

then:

1. Resolve endpoints:
   - `source_ap_id` and `target_ap_id` from the Data Movement row.
2. On the current diagram, choose concrete source/target nodes:
   - Prefer a stable, deterministic strategy:
     - E.g. first node found representing `source_ap_id` and `target_ap_id` using the same logic as the enablement check.
     - Optionally favour node types in this priority order: `APPLICATION` → `APP_COMPONENT` → `SERVICE` → `APPLICATION_POINT`, but consistency is more important than exact order.
3. Create a `diagram_edge`:

   - `relationship_type: "DATA_MOVEMENT"`
   - `relationship_id: dm.id`
   - `source_node_id: <chosen source node.id>`
   - `target_node_id: <chosen target node.id>`

   Styling:

   - `line_type`: solid (or existing default for data movements).
   - `line_weight` / `line_dashes`: use current defaults for data movements.
   - **Arrow**: make sure the edge has an arrow pointing to the **target** node:
     - `arrow_start = "NONE"`
     - `arrow_end = "ARROW"` (or the equivalent enum you use).

4. Label behaviour (unchanged semantics):

   - If `diagram_edge.label_text` is empty/undefined:
     - Default it to the Logical Data Entity name:
       - `logical_data_entities[dm.logical_data_entity_id].name`
   - Place the label at the mid-point of the edge's points as today.
   - Ensure the label remains:
     - Clickable,
     - Draggable to a new position,
     - And that its position is persisted in `label_pos_x`, `label_pos_y`.

5. After creation, refresh palette state so that:
   - Any logic that avoids duplicate edges behaves consistently with how other relationships work (follow existing pattern for Data Movements – e.g. if you previously allowed multiple edges per relationship, keep that behaviour, otherwise disable the row after the first edge is added).

---

## 4. Helper functions and consistency

Review and update any helper utilities involved in data-movement resolution, including but not limited to:

- `getRelationshipEndpointEntities(...)`
- `getDataMovementNodes(...)`
- Any `isDataMovementEligibleForDiagram(...)`-style functions

Requirements:

1. They should **only** use `source_application_point_id` / `target_application_point_id` from the meta-model.
2. They must resolve "endpoint represented on diagram" via application points, using the same abstraction as the palette enablement logic described above.
3. Any previous references to `source_app_id` / `target_app_id` must be removed or replaced.

Add/extend unit tests to cover:

- A Data Movement between two Applications (via their `application_points`).
- A Data Movement between an Application Component and a Service.
- Diagrams where only one endpoint is present (row disabled).
- Diagrams where both endpoints are present (row enabled, edge added correctly with arrow pointing to target).
- Palette behaviour when switching between diagrams.

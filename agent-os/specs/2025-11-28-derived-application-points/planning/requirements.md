# Derived Application Points - Requirements

## Overview
Refine how "Application Points" are handled across the meta-model and diagrams so that they become a derived, internal concept rather than something the user manages directly.

Conceptually:
- Users will continue to manage Applications, Application Components, and Services.
- The tool will automatically maintain a one-to-one Application Point for each of those.
- Diagrams and relationships will still use Application Points under the hood, but the user will be "blissfully unaware" of this implementation detail.

---

## 1) Meta-model: Application Points become derived, not directly editable

### Current state
- metaModel.entities includes:
  - applications
  - app_components
  - services
  - application_points
- There is a visible "Application Points" tab in the Meta-model view.
- Users can manually create/edit/delete Application Points.

### Target behaviour
- For every record in:
  - applications
  - app_components
  - services
  there must be exactly one corresponding application_point record.
- Users no longer manage application_points directly; they are automatically maintained by the tool.

### 1.1 One-to-one derivation rules

Define a mapping:

- For each Application row:
  - An Application Point with:
    - kind = "APPLICATION"
    - application_id = application.id
- For each App Component row:
  - An Application Point with:
    - kind = "APP_COMPONENT"
    - application_component_id = app_component.id
- For each Service row:
  - An Application Point with:
    - kind = "SERVICE"
    - service_id = service.id

The following invariants must hold:

- There is exactly one Application Point for each Application / App Component / Service.
- The Application Point's name (or display label) should be derived from the underlying entity's name (e.g., copy-on-create; future changes may sync, but for v0.x copying once is acceptable if documented).

### 1.2 Automatic creation / deletion / sync

Create a meta-model synchronisation layer that enforces these invariants whenever:

- An Application / App Component / Service is created, edited, or deleted.
- A JSON file is loaded.

Rules:

**On create:**
- When a new Application / App Component / Service row is created:
  - Automatically create its corresponding Application Point if it does not already exist.
  - Assign a stable application_point.id (for example, "ap_" + underlying id, or a generated id; must be deterministic across load/save for the same entity if possible).

**On delete:**
- When an Application / App Component / Service is deleted:
  - Automatically delete the associated Application Point.
  - Additionally:
    - Remove or mark invalid any relationships that reference that Application Point:
      - application_point_business_processes
      - data_movements source_application_point_id / target_application_point_id
    - For v0.x, the simplest rule is: delete those relationship rows as part of the delete cascade.

**On load:**
- When a JSON file is loaded:
  - Treat application_points in the file as authoritative only if they are consistent.
  - Then run a synchronisation pass:
    - Ensure an Application Point exists for every Application / App Component / Service.
    - Remove any application_points that do not map to an existing Application / App Component / Service.
  - If application_points are missing, create them.
  - If extra orphaned application_points exist, remove them (or log a warning).

### 1.3 Meta-model grid view changes

Meta-model view:

- Remove the "Application Points" tab entirely from the bottom tab strip.
- Users no longer see or edit application_points directly.
- The JSON data still contains application_points, but they are not exposed to users in the grids.

---

## 2) Diagram Right-hand Palette: hide Application Points, show Apps/Components/Services

### Current state
- Right-hand Diagram palette lists Application Points directly (or at least treats them as a separate type).
- Users may add an Application Point to the diagram explicitly.

### Target behaviour

### 2.1 Palette categories

In the diagram palette, show:

- Applications
- Application Components
- Services
- (other entities such as Business Processes, Logical Entities, etc., as before)

Do NOT show a separate "Application Points" category.

Each palette item representing an application-ish entity should be derived from the underlying meta-model entity (Application, App Component, or Service), but when used, it must add the corresponding Application Point node to the diagram.

### 2.2 Adding to diagrams: internal Application Point mapping

When a user adds something from the right-hand palette to the diagram:

- If the item is an Application:
  - Locate (or create, if missing) the Application Point corresponding to that Application.
  - Create a diagram_node whose:
    - entity_type = "APPLICATION_POINT" (or equivalent enum value currently used)
    - entity_id = application_point.id
  - The visual label should still be the Application's name.

- If the item is an App Component:
  - Same logic, but using the corresponding Application Point with kind = "APP_COMPONENT".

- If the item is a Service:
  - Same logic, but using the corresponding Application Point with kind = "SERVICE".

Therefore:
- Diagrams always reference Application Points as the underlying node entity, BUT
- The user experiences them as "Application", "App Component", or "Service".

### 2.3 Node display (UX)

For v0.x, the presentation of these nodes can remain as-is (e.g. same styling as existing Application boxes). Just ensure:

- The node's displayed label is taken from the underlying Application / App Component / Service.
- Internal linking uses Application Point IDs.

---

## 3) Relationship semantics: keep App Points in relationships, transparently

### Existing relationships

- application_point_business_processes
- data_movements.source_application_point_id / target_application_point_id
- Any others that already point to application_points.

These should remain unchanged in the meta-model schema.

### 3.1 Creating or editing relationships

- When the user configures relationships in the meta-model grids:
  - For fields that currently reference application_point_id:
    - Continue to reference application_points internally.
  - For typeahead / FK selection:
    - The dropdown should show human-friendly Application / App Component / Service names, but under the hood:
      - The stored FK value remains the application_point.id.

Example:

- In the App Point ↔ Process grid:
  - The "Application Point" FK column should display:
    - "OMS System (Application)" or similar.
  - Under the hood:
    - It stores application_point.id.
  - The user conceptually thinks they're linking "Application ↔ Process".

### 3.2 Diagrams using relationships

- When rendering diagrams based on relationships (e.g., App Point ↔ Process, data movements):
  - The source/target nodes on the canvas are Application Point nodes (entity_type = APPLICATION_POINT).
  - But visually they are labelled as the underlying Application / Component / Service name.

No change here, just make sure the internal Application Point modelling remains consistent with the new derived nature.

---

## 4) JSON model and synchronisation

JSON still has:

```
metaModel.entities.application_points: [ ... ]
```

But:

- application_points should be managed by the synchronisation logic and not directly by user actions.
- When saving JSON:
  - All derived application_points are persisted so existing diagrams and relationships remain valid.
- When loading JSON:
  - Run the sync pass described above to reconcile application_points with current Applications / Components / Services.

This ensures backwards-compatibility with older JSON files that may already contain application_points.

---

## 5) UI & UX summary

From the user's perspective:

- **Meta-model view:**
  - They see tabs for:
    - Applications
    - App Components
    - Services
    - (other entities/relationships as before)
  - They do NOT see a tab for Application Points.

- **Diagram palette:**
  - They see:
    - Applications
    - App Components
    - Services
  - They do NOT see Application Points.
  - When they add one of these entities to the diagram, the correct Application Point node is created/used under the hood.

- **Relationships:**
  - They configure App Point ↔ Process and data movements in the same place as before.
  - Typeahead FKs remain intuitive, showing app/service names, even if they store Application Point IDs.

---

## 6) Acceptance criteria

- After this change:
  - The "Application Points" tab is removed from the Meta-model view.
  - The diagram palette no longer shows "Application Points"; only Applications, App Components, and Services.
- When a user creates an Application / App Component / Service:
  - A corresponding application_point is automatically created.
- When a user deletes an Application / App Component / Service:
  - The corresponding application_point is automatically deleted.
  - Relationships that reference that application_point are removed or handled safely (no dangling FKs).
- When adding an Application / App Component / Service from the palette to a diagram:
  - The created diagram_node internally references the correct application_point.id (entity_type = APPLICATION_POINT).
  - The node visually shows the underlying entity's name.
- Loading and saving JSON:
  - Automatically maintains a consistent set of application_points according to the rules above.
  - Existing files that already contain application_points continue to work; extra orphaned application_points are cleaned up or ignored per the sync logic.

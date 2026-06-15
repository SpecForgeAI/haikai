Title: Add Interaction entity + App_Business_Point super-type + diagram integration

## 1. Add new meta-model entity: Interaction

Create a new entity table **Interaction** with the following columns:

- id (string, uuid)
- name (string, required)
- description (string, optional)
- user_id (FK → Business User)
- primary_app_business_point_id (FK → App_Business_Point, required)
- secondary_app_business_point_id (FK → App_Business_Point, optional)

This entity represents a user interaction spanning one or two App_Business_Points.

### Display name vs meta-model name
- Meta-model tab label: "Interactions"
- Diagram section label: "User Interactions"

### Position in the meta-model top bar
Insert Interaction directly after Activities and before Applications:

[Business Users] [Business Processes] [Process Activities] [Interactions] | [Applications] [App Components] ...

## 2. Introduce new super-type: App_Business_Point

Create a new indirect entity App_Business_Point that is NOT shown as a separate section.

It acts only as a polymorphic parent for:
- Application
- Application Component
- Service
- Interface
- Endpoint
- Business Process
- Process Activity

Rules:
- No separate UI section for App_Business_Point.
- Any autocomplete that expects an App_Business_Point shows:
  "<name> (<entity_type>)".

## 3. Update entity definitions to register them as App_Business_Points

Extend the meta-model for these entities with:
super_type: App_Business_Point

Affected entities:
- Application
- Application Component
- Service
- Interface
- Endpoint
- Business Process
- Process Activity

## 4. No relationship table required

Interaction itself stores:
- a User
- one required App_Business_Point
- one optional App_Business_Point

## 5. Diagram behaviour for User Interactions

Add a new diagram section "User Interactions", listing each Interaction by name.

### Rendering rules:
- When a User Interaction is added to the diagram:
  - If two App_Business_Points are referenced:
    - Draw a dotted line between the corresponding rendered nodes.
    - If the interaction's user node is present:
      - Draw a dotted line from the user node to the midpoint of the main interaction line.
  - If only one App_Business_Point is referenced:
    - Draw a dotted line between the user node and the App_Business_Point node.
    - If the user node is not yet present, prompt the user to add it.

### Z-index rules:
- Interaction dotted lines behave like edges.
- They must respect z-index ordering in the edge rendering pipeline.

## 6. Advanced Add… integration

In the Interactions section, add an "Advanced Add…" item.

The tree must show:
- The Interaction
- Its user (if present)
- Its primary and secondary App_Business_Points, resolved to concrete entity nodes

When selected, the diagram must render using the custom dotted-line semantics.

## 7. JSON persistence format

Extend the diagram JSON schema:

user_interactions: [
  {
    "id": "ui-123",
    "interaction_id": "int-xyz",
    "primary_node_id": "node-abc",
    "secondary_node_id": "node-def",   # nullable
    "user_node_id": "node-u99",        # nullable
    "line_style": "dotted"
  }
]

These must save & load exactly like node_edges and decorations.

On load, the diagram engine must rebuild dotted lines using the z-index rendering pipeline.

## 8. Palette integration (optional but recommended)

Add a "Show User Interactions" toggle so users can hide/show all dotted interaction lines.

## 9. Validation rules

A valid Interaction must have:
- user_id
- primary_app_business_point_id
A secondary_app_business_point_id may be null.

Errors must appear in the validation dialog with entity names resolved.

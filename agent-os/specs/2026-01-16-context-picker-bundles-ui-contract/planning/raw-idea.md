# Context Picker Iteration 1 — Introduce Context Bundles (UI + Selection Contract Only)

## Requirements

```yaml
context:
  The Implement screen includes a Context Picker modal that lets users attach architecture
  and diagrams as context for a feature/work item. Today, selections are limited to a subset
  of entities and require manual, granular picking. Users frequently want to select an item
  along with a sensible set of related items (e.g., an interface with its endpoints and
  schemas, or a data entity with its attributes and relationships). This iteration introduces
  "Context Bundles" as a UI-level concept and extends the selection payload contract to record
  the user's intended bundle scope, without changing any backend expansion/resolution logic.

goal:
  Allow users to choose predefined bundle scopes when selecting context items, and persist
  those bundle choices as part of the feature's selected context so later iterations can
  expand them automatically. This iteration MUST NOT change what is sent to the Planner LLM
  (still uses existing ID-based selection/resolution flow).

scope:
  - Frontend UI and selection contract changes
  - Store bundle selections alongside existing context selections for a feature/work item
  - No backend "expansion" logic yet
  - No changes to implement-context resolution behavior
  - No changes to prompt structure or condensed DTO payloads

definitions:
  - Context Bundle: a user-selected scope rule applied to a selected root item, indicating
    which associated items should be included in future context expansion.
  - Root Selection: the entity (or diagram) explicitly chosen by the user.

bundle_types_v1:
  - For Interfaces:
      1) interface_only
      2) interface_with_endpoints
      3) interface_with_endpoints_and_schemas   # recommended default
  - For Services:
      1) service_only
      2) service_with_parents_and_children      # includes parents/children conceptually
  - For Physical Data Entities:
      1) entity_only
      2) entity_with_attributes_and_relationships  # recommended default
  - For Diagrams:
      1) diagram_only   # bundles for diagrams can be extended later; keep minimal now

requirements:
  frontend_ui:
    - Update the Context Picker modal to support selecting a bundle scope for each selected item.
    - When a user selects an item, the UI MUST allow choosing a bundle option appropriate for
      that item type (interfaces/services/entities/diagrams).
    - The UI MUST present sensible defaults:
        - Interfaces default to: interface_with_endpoints_and_schemas
        - Physical data entities default to: entity_with_attributes_and_relationships
        - Services default to: service_with_parents_and_children
        - Diagrams default to: diagram_only
    - The UI MUST allow users to adjust the bundle choice per item (e.g., a small dropdown or
      segmented control per selected chip/list row).
    - The UI MUST NOT add relationship items as selectable nodes in this iteration.

  selection_contract:
    - Extend the feature/work-item context data structure persisted for Implement to include
      bundle metadata per selected item.
    - For each selected architecture entity, persist:
        - entity_id (existing)
        - entity_type/category (existing if present)
        - bundle_type (new; one of bundle_types_v1 applicable to the entity kind)
    - For each selected diagram, persist:
        - diagram_id (existing)
        - bundle_type (new; diagram_only)
    - If existing persistence format uses entity_refs/diagram_refs arrays, extend each ref object
      to include bundle_type while remaining backward compatible (older saved contexts without
      bundle_type must still load and behave with defaults).

  persistence_and_loading:
    - On loading an existing feature's context selections:
        - If bundle_type is missing, the UI must infer the default bundle_type for that item kind.
    - Saving/applying context MUST persist the selected bundle_type values.

  chat_payload_no_behavior_change:
    - This iteration MUST NOT change the data sent to the Planner LLM.
    - The existing highlighted context behavior continues to send only selected IDs (and any
      existing typed-ID formatting), ignoring bundle_type for now.

acceptance_criteria:
  - Users can select an Interface and choose between:
      - Interface only
      - Interface + endpoints
      - Interface + endpoints + schemas
    and the chosen bundle_type is persisted with that selection.
  - Users can select a Physical Data Entity and choose:
      - Entity only
      - Entity + attributes + relationships
    and the chosen bundle_type is persisted with that selection.
  - Users can select a Service and choose:
      - Service only
      - Service with parents and children
    and the chosen bundle_type is persisted with that selection.
  - Existing saved contexts without bundle_type load successfully and show defaults.
  - Implement chat behavior is unchanged in this iteration (bundle_type stored but not yet used).

non_goals:
  - No backend context expansion implementation
  - No relationship selection UI
  - No condensed LLM payload DTOs
  - No changes to prompt templates or resolution logic beyond storing bundle_type
```

# Spec Requirements: Relationship Eligibility Per-Diagram Fix

## Initial Description

We need to fix and tighten the enable/disable logic for relationship rows in the Diagram view's right-hand "Palette" panel so that it correctly reflects the state of the CURRENT diagram only and always stays in sync as the diagram changes.

## Context

We already have:
- A meta-model with relationship tables:
  - business_user_processes (User ↔ Process)
  - application_point_business_processes (App Point ↔ Process)
  - logical_data_entity_relationships (Logical ER)
  - logical_data_entity_physical_data_entities (Logical ↔ Physical Entities)
  - logical_data_attribute_physical_data_attributes (Logical ↔ Physical Attributes)
  - data_movements (Data Movements)
- A diagrams[] array, where each diagram has its own diagram_nodes[] and diagram_edges[].
- A right-hand Palette panel that lists relationships under headings:
  - User ↔ Process
  - App Point ↔ Process
  - Logical ER
  - Logical ↔ Physical Entities
  - Logical ↔ Physical Attrs
  - Data Movements
- Rows in those sections can be "enabled" (clickable / right-clickable) or "disabled" with a tooltip "Both endpoints must be on diagram to add this relationship."

We recently added logic to disable a relationship row when both endpoints are not "on the diagram", but the behaviour is wrong:
- In a diagram where both apps are visible, the corresponding Data Movement row is still disabled.
- When switching to a new empty diagram, relationship rows do not immediately disable even though there are no nodes in that diagram.

**Root cause:** The RHS panel's enabled/disabled state is NOT being recomputed reliably based on the ACTIVE diagram's nodes; it is either using stale or global state.

## Goal

Make relationship row enable/disable logic:
- Strictly per-diagram (based on the currently selected diagram only).
- Always up to date with the current diagram contents.
- Correct for all relationship types.

Also ensure that Data Movements, when added, still create a solid line with an arrowhead pointing to the target Application Point (this behaviour should NOT regress).

## Implementation Requirements

### 1) Define a reusable "relationship eligibility" helper for a diagram

Add a pure helper (likely in a utils or hooks module shared by the Palette) that, given:
- metaModel
- activeDiagram (or activeDiagramId + diagrams[])

returns, for that diagram:
- a fast lookup structure of which meta-model entities are "present on this diagram":
  - applicationPointsOnDiagram: Set<application_point.id>
  - businessUsersOnDiagram: Set<business_user.id>
  - businessProcessesOnDiagram: Set<business_process.id>
  - logicalDataEntitiesOnDiagram: Set<logical_data_entity.id>
  - physicalDataEntitiesOnDiagram: Set<physical_data_entity.id>
  - logicalDataAttributesOnDiagram: Set<logical_data_attribute.id>
  - physicalDataAttributesOnDiagram: Set<physical_data_attribute.id>

The helper must derive these sets from diagram_nodes[] where:
- For each diagram_node:
  - entity_type and entity_id tell us which meta-model table and row it corresponds to.
  - For Application / App Component / Service we use the corresponding application_point.id that the node represents (as per existing "Application Point" abstraction).

Then, for the active diagram, define per-relationship eligibility functions:

#### User ↔ Process (business_user_processes)
- Enabled if:
  - business_user_id ∈ businessUsersOnDiagram AND
  - business_process_id ∈ businessProcessesOnDiagram.

#### App Point ↔ Process (application_point_business_processes)
- Enabled state should reflect the richer rules we already have:
  - If Application Point is NOT on diagram:
    - The row should be enabled only if:
      - The App Point's underlying Application/Component/Service can be added (as per existing logic) and
      - The Business Process can be added.
    - On Add, behave like "Add with business processes" but for ONE process:
      - If neither Application Point nor Process are on the diagram, create an Application Point node and an inner Process node (with containment + auto sizing).
      - If the Application Point is already on the diagram but the Process is not, add the Process inside the Application Point and resize.
  - If Application Point AND its Business Process are BOTH already on the diagram:
    - The row should be DISABLED (since the containment visualisation already exists).
- For the eligibility helper, we mainly need to know:
  - If Application Point is on this diagram.
  - If Business Process is on this diagram.
- Palette row state:
  - Enabled if:
    - (App Point NOT on diagram) OR (Process NOT on diagram).
  - Disabled if:
    - App Point and Process are both already on this diagram.

#### Logical ER (logical_data_entity_relationships)
- Enabled if:
  - source_logical_data_entity_id ∈ logicalDataEntitiesOnDiagram AND
  - target_logical_data_entity_id ∈ logicalDataEntitiesOnDiagram.

#### Logical ↔ Physical Entities (logical_data_entity_physical_data_entities)
- Enabled if:
  - logical_data_entity_id ∈ logicalDataEntitiesOnDiagram AND
  - physical_data_entity_id ∈ physicalDataEntitiesOnDiagram.

#### Logical ↔ Physical Attributes (logical_data_attribute_physical_data_attributes)
- Enabled if:
  - logical_data_attribute_id ∈ logicalDataAttributesOnDiagram AND
  - physical_data_attribute_id ∈ physicalDataAttributesOnDiagram.

#### Data Movements (data_movements)
- Enabled if:
  - source_application_point_id ∈ applicationPointsOnDiagram AND
  - target_application_point_id ∈ applicationPointsOnDiagram.
- NOTE: Do NOT forget that, when added:
  - The diagram_edge must be a solid line.
  - The arrowhead must point from source to target (arrow_end on target side).
  - The label_text is defaulted to the Logical Data Entity name as we already implemented.

### 2) Wire this helper into the Palette panel (right-hand side)

Wherever we currently compute the list of items to show in each section, we must now also compute:
- isEnabled (boolean)
- disabledTooltip (string | null)

for each relationship row, based on the ACTIVE diagram only.

The Palette should recompute this per-diagram eligibility in these situations:

a) When the active diagram changes (user selects a different diagram from the dropdown, clicks +New, or +Copy):
   - Immediately recompute sets of nodes-on-diagram and all row enablement states.

b) When the active diagram's diagram_nodes[] changes:
   - Node added (from palette, context menu, "Add with business processes", etc.)
   - Node removed (single delete, multi-select delete).
   - Node created as part of adding a relationship (e.g. App Point ↔ Process that also creates a Process node).
   - Node moved or resized alone does NOT affect eligibility.

c) When meta-model entities or relationships are deleted:
   - If an entity or relationship referenced by a Palette row is deleted, the row should disappear or be disabled as appropriate (existing behaviour should be preserved but must trigger a recompute).

#### Disabled row behaviour:
- If a row is disabled because endpoints aren't on the diagram:
  - The tooltip should still say "Both endpoints must be on diagram to add this relationship." (or the equivalent message we already use).
- If a row is disabled because the visualisation is already fully present (e.g. App Point + Process already on diagram):
  - Use a more specific tooltip, e.g. "Already visualised on this diagram." (if easy to add).
- Left-click or right-click on a disabled row must not attempt to add the relationship.

#### Enabled row behaviour:
- Left-click on the row OR choosing "Add" from its context menu must:
  - Re-check eligibility at the time of click (to avoid race conditions).
  - If still eligible, create the appropriate diagram_edge and any required nodes (for App Point ↔ Process) on the CURRENT diagram only.
  - After mutation, trigger a recompute of eligibility for that diagram so the row may flip to disabled (e.g. App Point ↔ Process when both nodes now exist).

### 3) Per-diagram state, not global

Clarify in the spec and code that:
- Relationship enablement is a function of (relationshipId, activeDiagramId), NOT global state.
- The same relationship can be:
  - Enabled in Diagram A (both endpoints present).
  - Disabled in Diagram B (one or both endpoints absent).

Add tests to cover:
- Diagram A:
  - Add both application points → target Data Movement row must be enabled.
- Switch to new blank Diagram B:
  - Without nodes, the exact same Data Movement row must be disabled immediately.
- Add apps to Diagram B:
  - The row becomes enabled.
- Back to Diagram A:
  - Eligibility uses Diagram A's nodes, not B's.

### 4) Testing

Add/extend tests for Palette eligibility:

#### Unit tests for the new eligibility helper:
- Each relationship type with combinations of:
  - Endpoints both present.
  - One present, one missing.
  - Both missing.

#### Integration tests for the Diagram view:
- Start with empty diagram:
  - All relationship rows disabled with "Both endpoints must be on diagram…" tooltip.
- Add nodes for a Data Movement's source and target to Diagram 1:
  - Data Movement row becomes enabled for Diagram 1.
- Create Diagram 2 (empty) and select it:
  - Data Movement row disabled for Diagram 2.
- Switch back to Diagram 1:
  - Row enabled again.
- Add an App Point ↔ Process where both endpoints end up on diagram:
  - Row becomes disabled and can't be added a second time.

#### Regression test for arrowheads on Data Movements:
- After adding a Data Movement edge, assert that:
  - line_type is solid.
  - Arrow is rendered at the target side (consistent with existing style config).

## Non-goals / Constraints

- Do not change the existing meta-model JSON schema.
- Do not change the basic visual style of the lines and labels we already have, beyond ensuring the Data Movement arrowhead remains correct.
- Focus on correctness and per-diagram behaviour; no need to introduce caching optimisations for now.

## Visual Assets

No visual assets provided.

## Scope Boundaries

### In Scope

- Fix relationship eligibility to be per-diagram based on active diagram's nodes
- Create reusable eligibility helper with Set-based lookups
- Wire helper into Palette panel with proper recomputation triggers
- Update tooltips for different disabled states
- Ensure Data Movement arrow rendering doesn't regress
- Add unit and integration tests for eligibility logic

### Out of Scope

- Meta-model schema changes
- Visual style changes (except ensuring existing arrowhead behaviour)
- Caching optimizations
- Changes to relationship add behaviour (beyond fixing eligibility)

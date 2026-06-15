# Fix Interactions Double-Rendering in Meta-Model and Correct User Interaction Palette Enablement via App_Business_Point Mapping

Two problems remain after previous changes:
1) In the Meta-Model view, the "Interactions" relationship table is rendered **twice** (duplicate grid).
2) In the Diagrams view, the "User Interactions" palette row for an Interaction with a User + two Applications ("My App", "Your App") is still **disabled**, even though the User node and both Applications are on the diagram.

Root causes:
- "Interactions" is still treated as an **entity tab** in the `tabToEntityType` mapping, so both `Grid` and `RelationshipGrid` render when the Interactions tab is selected.
- The palette enablement logic is checking for **App_Business_Point diagram nodes**, but on the canvas we only ever draw concrete entities (APPLICATION, APP_COMPONENT, SERVICE, BUSINESS_PROCESS, PROCESS_ACTIVITY, INTERFACE). There is no node whose entityType is "APP_BUSINESS_POINT", so the check fails and the row stays disabled.

This spec:
- Ensures "Interactions" is only treated as a **relationship** tab, not an entity tab (fixing the duplicate grid).
- Defines explicit mapping from **App_Business_Point** to the corresponding concrete diagram node, and updates the User Interaction enablement logic to use that mapping.

------------------------------------------------------------
## 1. Meta-Model: remove Interactions from entity tab mapping (fix double grid)

Current behaviour:
- `MetaModelView` determines what to render via:
  - `isEntityTab = state.selectedTab in tabToEntityType`
  - `isRelationshipTab = state.selectedTab in relationshipTabToType`
- The JSX then conditionally renders:
  - `{isEntityTab && <Grid ... />}`
  - `{isRelationshipTab && <RelationshipGrid ... />}`
- Because "Interactions" exists in BOTH `tabToEntityType` (entity) and `relationshipTabToType` (relationship), selecting "Interactions" causes **both** grids to render, resulting in two identical tables stacked vertically.

Required changes:

### 1.1 Remove Interactions from `tabToEntityType`
In `config/gridConfigs.ts` (or equivalent), ensure the entity tab mapping **does not** include an entry for Interactions.

Example (desired) `tabToEntityType`:

```typescript
tabToEntityType: Record<string, string> = {
  'Users': 'business_users',
  'Processes': 'business_processes',
  'Activities': 'process_activities',
  'Applications': 'applications',
  'App Components': 'app_components',
  'Services': 'services',
  'Interfaces': 'interfaces',
  'Endpoints': 'endpoints',
  'Logical Entities': 'logical_data_entities',
  'Logical Attributes': 'logical_data_attributes',
  'Physical Entities': 'physical_data_entities',
  'Physical Attributes': 'physical_data_attributes',
  // IMPORTANT: no 'Interactions' entry here
};
```

If any entry exists such as:

```typescript
'Interactions': 'interactions',
```

it MUST be removed.

### 1.2 Ensure Interactions exists only in `relationshipTabToType`
In the same config file, ensure that `relationshipTabToType` includes Interactions exactly once:

```typescript
export const relationshipTabToType: Record<string, string> = {
  'User <-> Business Point': 'business_user_business_points',
  'App Point <-> Business Point': 'application_point_business_points',
  'Interactions': 'interactions',
  'Logical ER': 'logical_data_entity_relationships',
  'Logical <-> Physical Entities': 'logical_data_entity_physical_data_entities',
  'Logical <-> Physical Attributes': 'logical_data_attribute_physical_data_attributes',
  'Interface <-> Logical Entity': 'interface_logical_entities',
  'Data Movements': 'data_movements',
};
```

Also ensure `relationshipTabNames` includes "Interactions" exactly once, in the correct position.

### 1.3 Acceptance for section 1
- In Meta-Model view, selecting "Interactions" renders **one** grid only (RelationshipGrid), not two stacked tables.
- Checking the code shows:
  - `tabToEntityType` has **no** "Interactions" key.
  - `relationshipTabToType["Interactions"] === "interactions"`.

------------------------------------------------------------
## 2. Diagrams RHS: correctly enable User Interaction rows using App_Business_Point → concrete entity mapping

Current problem:
- The Interaction row under "User Interactions" remains disabled even when:
  - User "My User" is on the canvas as a stick-man node.
  - Applications "My App" and "Your App" are on the canvas as nodes.
  - Meta-model Interaction row is defined with:
    - User = "My User"
    - Primary Point = "My App"
    - Secondary Point = "Your App"
- Root cause: the enablement code is checking something like:
  - `isNodeOnDiagram("APP_BUSINESS_POINT", primaryAppBusinessPointId)`
  - but the diagram never has nodes with entityType = "APP_BUSINESS_POINT"; it only has APPLICATION, APP_COMPONENT, SERVICE, BUSINESS_PROCESS, PROCESS_ACTIVITY, INTERFACE, etc.

We must:
- Resolve an App_Business_Point to its underlying concrete entity (kind + source_entity_id).
- Then check for presence of that **concrete** node type on the diagram.

### 2.1 App_Business_Point structure (assumed)
Each App_Business_Point record has at least:

- `id`: string
- `name`: string
- `kind`: enum, e.g. "APPLICATION" | "APP_COMPONENT" | "SERVICE" | "BUSINESS_PROCESS" | "PROCESS_ACTIVITY" | "INTERFACE"
- `source_entity_id`: string (the id of the underlying entity)

### 2.2 Utility: resolve App_Business_Point to concrete diagram node(s)

Add a utility function in a shared place (e.g. `diagramUtils.ts`):

```typescript
function getConcreteNodeIdsForAppBusinessPoint(
  model: ArchitectureModel,
  diagram: Diagram,
  appBusinessPointId: string,
  time: QuarterPeriod
): string[] {
  const abp = model.app_business_points.find(p => p.id === appBusinessPointId);
  if (!abp) return [];

  // Map ABP kind → entity collection name used in the model
  const abpKindToEntityType: Record<string, string> = {
    'APPLICATION': 'applications',
    'APP_COMPONENT': 'app_components',
    'SERVICE': 'services',
    'BUSINESS_PROCESS': 'business_processes',
    'PROCESS_ACTIVITY': 'process_activities',
    'INTERFACE': 'interfaces',
    // extend if endpoints are ever included
  };

  const entityCollectionName = abpKindToEntityType[abp.kind];
  if (!entityCollectionName) return [];

  // Underlying entity id
  const entityId = abp.source_entity_id;

  // Find diagram nodes that represent this underlying entity
  return diagram.nodes
    .filter(node =>
      node.entity_type === abp.kind &&
      node.entity_id === entityId &&
      isDiagramNodeVisibleInPeriod(node, time) // existing temporality helper
    )
    .map(node => node.id);
}
```

Notes:
- `node.entity_type` should store the concrete type (APPLICATION, APP_COMPONENT, etc.).
- `entity_id` is the underlying meta-model entity id.
- This function returns 0, 1, or more matching node IDs; for enablement we only care whether the array is non-empty.

### 2.3 Replace APP_BUSINESS_POINT checks with concrete mapping

In the palette logic for "User Interactions" (where the rows are created/updated):

Current (incorrect) pattern (conceptual):

```typescript
const primaryOnDiagram = isNodeOnDiagram('APP_BUSINESS_POINT', primaryPointId, time);
const secondaryOnDiagram = isNodeOnDiagram('APP_BUSINESS_POINT', secondaryPointId, time);
```

Required change:

- Instead of checking for APP_BUSINESS_POINT nodes, resolve to concrete nodes:

```typescript
const primaryNodeIds   = getConcreteNodeIdsForAppBusinessPoint(model, diagram, primaryPointId, time);
const secondaryNodeIds = secondaryPointId
    ? getConcreteNodeIdsForAppBusinessPoint(model, diagram, secondaryPointId, time)
    : [];

const primaryOnDiagram   = primaryNodeIds.length > 0;
const secondaryOnDiagram = secondaryPointId ? secondaryNodeIds.length > 0 : true;
```

This function must be used consistently everywhere the interaction enablement logic checks for P/S presence.

### 2.4 Re-apply agreed enablement rules using the mapping

For each Interaction I at time T:

Let:
- U = user_id
- P = primary_app_business_point_id
- S = secondary_app_business_point_id (nullable)
- edgesExist = hasInteractionEdges(I.id, T) // any MAIN or USER_LINK edges

Case A: P and S are both defined
- Determine:
  - `primaryOnDiagram` from primaryNodeIds.length > 0
  - `secondaryOnDiagram` from secondaryNodeIds.length > 0

Enable rule:
- Palette row for I is enabled if:
  - primaryOnDiagram === true
  - secondaryOnDiagram === true
  - edgesExist === false
- Note: **User node presence is NOT required** for Case A.

Case B: Only P is defined (S is null)
- Determine:
  - `primaryOnDiagram` as above.
  - `userOnDiagram` = isNodeOnDiagram('BUSINESS_USER', U, T);

Enable rule:
- Palette row for I is enabled if:
  - primaryOnDiagram === true
  - userOnDiagram === true
  - edgesExist === false.

### 2.5 Ensure `hasInteractionEdges` only returns true when edges exist for THIS interaction

Double-check `hasInteractionEdges` implementation so that it:

- Filters edges by `edge.relationship_type === 'USER_INTERACTION'` (or equivalent), AND
- `edge.interaction_id === I.id`, AND
- edge is valid at time T.

This prevents stale or unrelated edges from wrongly disabling the row.

### 2.6 Acceptance for section 2

Using the example in the screenshots:

- Meta-model:
  - One Interaction "Interaction A" with:
    - User: "My User"
    - Primary Point: App_Business_Point for "My App"
    - Secondary Point: App_Business_Point for "Your App"
- Diagram:
  - Business User node for "My User" is present.
  - Application node for "My App" is present.
  - Application node for "Your App" is present.
  - No interaction edges exist yet for "Interaction A".

Expected behaviour after changes:
- `getConcreteNodeIdsForAppBusinessPoint` finds the nodes for "My App" and "Your App".
- `primaryOnDiagram` and `secondaryOnDiagram` are true.
- `edgesExist` is false.
- Since this is Case A:
  - The "Interaction A" row under "User Interactions" is **enabled**.
  - Clicking/dragging the row draws:
    - A MAIN dotted line between "My App" and "Your App" with label "Interaction A".
    - Optionally a USER_LINK dotted line from "My User" to the midpoint, if such behaviour is implemented.

------------------------------------------------------------
## 3. Overall acceptance criteria

AC1 – Only one Interactions table in Meta-Model:
- Selecting "Interactions" in Meta-Model shows a single grid.
- Inspecting config shows no "Interactions" entry in `tabToEntityType`.

AC2 – Interactions relationship mapping:
- `relationshipTabToType["Interactions"] === "interactions"`.
- RelationshipGrid uses this type to load/save rows.

AC3 – Correct palette enablement:
- In Case A (User + P + S, both Apps on diagram, no edges):
  - "Interaction A" row in "User Interactions" is enabled.
- In Case B (User + P, both present on diagram, no edges):
  - Row is enabled.
- If required concrete nodes are missing, or any edges already exist for I:
  - Row is disabled.

AC4 – Mapping via App_Business_Point:
- Adding an Interaction involving Apps, Processes, Activities, Services, or Interfaces works without any special-case hacks, because the palette always resolves App_Business_Points to their concrete node(s) via `kind + source_entity_id`.

This spec removes the double-rendering and ensures Interaction rows are enabled/disabled correctly using App_Business_Point mapping to real diagram nodes.

Title: Fix Interactions Meta-Model Placement and User Interaction Palette Enable Rules

Summary:
Two regressions need to be fixed:
1) In the Meta-Model view, "Interactions" still appears in the **Entities** row instead of the **Relationships** row.
2) In the Diagrams RHS "User Interactions" section, the Interaction row is incorrectly disabled even when the underlying Interaction has a User and two App_Business_Points whose nodes are already on the diagram (Case A). The row should be enabled in this scenario.

This spec:
- Explicitly re-classifies "Interactions" as a Relationship tab (and removes any Entity tab configuration).
- Updates the palette/enable logic so that Interaction rows are enabled/disabled according to the previously agreed rules.

------------------------------------------------------------
1. Meta-Model: move Interactions from Entities row to Relationships row

1.1 Remove Interactions from Entities tab configuration
In the meta-model UI configuration (e.g. `metaModelTabs`, `entityTabs`, or similar), locate any entry that defines "Interactions" as an **Entity** tab, roughly like:

  // Example (current, incorrect):
  {
    key: "INTERACTION",
    label: "Interactions",
    type: "entity",
    group: "entities",
    component: EntityGrid,
    ...
  }

This entity-tab configuration MUST be removed or disabled.

Requirements:
- After this change, there must be **no** configuration that places "Interactions" in the **Entities** row.

1.2 Add / verify Interactions in Relationships row
In the relationships tab configuration (e.g. `relationshipTabs`, `relationshipDefinitions`, etc.), ensure that Interactions is explicitly defined as a **Relationship** tab.

Example (conceptual):

  {
    key: "INTERACTION",
    label: "Interactions",
    type: "relationship",
    group: "relationships",
    component: RelationshipGrid,
    definitionKey: "INTERACTION"
  }

Requirements:
- The `key` MUST be exactly the same key used by `RelationshipGrid` / `relationshipDefinitions` (e.g. "INTERACTION" or "USER_INTERACTION", consistent across the codebase).
- This tab must appear between:
  - `App Point <-> Business Point`
  - `Logical ER`
  in the Relationships row.

1.3 Ensure MetaModelView routes Interactions to RelationshipGrid
In `MetaModelView` (or equivalent), when the active tab key is "INTERACTION":

- It MUST route to `RelationshipGrid` with:
  - `relationshipKey = "INTERACTION"` (consistent).
  - `rows = interactions` from meta-model state.
  - Columns and participants from `relationshipDefinitions["INTERACTION"]`.

There must be **no code path** that tries to render `Interaction` using an entity grid.

Acceptance:
- In Meta-Model view, the "Interactions" tab is visible only in the Relationships row.
- Clicking "Interactions" shows the RelationshipGrid with properly configured columns.
- The Entities row does NOT contain an "Interactions" tab.

------------------------------------------------------------
2. Diagrams RHS: Correct enable/disable rules for User Interactions

Context:
- We previously agreed on:
  - Case A: Interaction has Primary + Secondary App_Business_Point.
  - Case B: Interaction has only Primary App_Business_Point.
- In Case A, the User node is OPTIONAL for the row to be enabled; only the two App_Business_Point nodes must be present.
- The current implementation appears to require a User node or otherwise miscomputes presence, leaving the row disabled even when Primary + Secondary nodes are on the diagram.

We must explicitly modernise the palette enablement logic.

2.1 Palette item definition for User Interactions
In the Diagrams palette configuration for "User Interactions" (e.g. `paletteSections`, `userInteractionPaletteSection`), ensure that each row:

- Is keyed by `interactionId` (I.id).
- Has an `isEnabled` function that uses the logic defined below.
- Considers the current time period (T) and diagram contents.

2.2 Utility functions (conceptual)

Introduce/verify helper functions:

- `isNodeOnDiagram(entityType, entityId, time)`:
  - Returns true if there is at least one diagram node representing the given meta-model entity at time T (respecting diagram-level temporality).

- `hasInteractionEdges(interactionId, time)`:
  - Returns true if any edge (MAIN or USER_LINK) for that interactionId is present on the diagram at time T.

- `getInteractionMeta(interactionId)`:
  - Returns { userId, primaryAppBusinessPointId, secondaryAppBusinessPointId }.

Ensure that App_Business_Point relationships are resolved correctly so that:
- "My App" and "Your App" boxes appearing on the canvas are detected as the P and S nodes for the interaction when they correspond to those App_Business_Point records.

2.3 Correct `isEnabled` logic (Case A & Case B)

For each Interaction I at time T:

Let:
- U = I.user_id
- P = I.primary_app_business_point_id
- S = I.secondary_app_business_point_id (may be null)

First filter by meta-model validity:
- If I, U, P (and S if defined) are not valid at T → row is hidden or disabled (but NOT enabled).

Then apply case logic:

**Case A – P and S both defined (two App_Business_Points)**

  const isCaseA = !!P && !!S;

  if (isCaseA) {
    const primaryOnDiagram   = isNodeOnDiagram("APP_BUSINESS_POINT", P, T);
    const secondaryOnDiagram = isNodeOnDiagram("APP_BUSINESS_POINT", S, T);
    const edgesExist         = hasInteractionEdges(I.id, T);

    // Enable rule:
    // - Both P and S nodes must be on diagram.
    // - No edges for this interaction may exist.
    if (primaryOnDiagram && secondaryOnDiagram && !edgesExist) {
      paletteRow.enabled = true;
    } else {
      paletteRow.enabled = false;
    }
  }

Notes:
- DO NOT check `isNodeOnDiagram("BUSINESS_USER", U, T)` for Case A enablement.
- Presence of the User node does NOT affect whether the row is enabled in Case A.

**Case B – Only P defined (single App_Business_Point)**

  const isCaseB = !!P && !S;

  if (isCaseB) {
    const primaryOnDiagram = isNodeOnDiagram("APP_BUSINESS_POINT", P, T);
    const userOnDiagram    = isNodeOnDiagram("BUSINESS_USER", U, T);
    const edgesExist       = hasInteractionEdges(I.id, T);

    // Enable rule:
    // - P and U nodes must be on diagram.
    // - No edges for this interaction may exist.
    if (primaryOnDiagram && userOnDiagram && !edgesExist) {
      paletteRow.enabled = true;
    } else {
      paletteRow.enabled = false;
    }
  }

If neither Case A nor Case B apply (e.g., malformed Interaction), the row should be disabled.

2.4 Ensure User-node condition is NOT globally required

Audit the current implementation for any logic like:

  const userOnDiagram = isNodeOnDiagram("BUSINESS_USER", U, T);
  if (!userOnDiagram) paletteRow.enabled = false;

Remove or refactor such checks so that:
- In Case A, userOnDiagram does NOT gate enablement.
- Only in Case B does userOnDiagram matter.

2.5 Styling: disabled vs enabled

Ensure that:
- `paletteRow.enabled = false` maps to the existing "greyed out" style used for disabled palette rows (e.g. CSS class `palette-row--disabled`).
- `paletteRow.enabled = true` uses the normal clickable style.

Acceptance test:
- With:
  - One Interaction I (Case A: user + primary app + secondary app).
  - Primary and Secondary apps on the diagram.
  - User node may or may not be on the diagram.
  - No interaction edges yet.
- The "Interaction" row under "User Interactions" MUST be enabled (clickable).

------------------------------------------------------------
3. Double-check the Case A scenario from the screenshot

For the specific scenario in the screenshot:

- Meta-model:
  - User: "My User"
  - Application "My App" (mapped to an App_Business_Point)
  - Application "Your App" (mapped to another App_Business_Point)
  - Interaction I with:
    - user_id = "My User"
    - primary_app_business_point_id = App_Business_Point("Your App")
    - secondary_app_business_point_id = App_Business_Point("My App")

- Diagram:
  - Nodes present at T:
    - Business User node for "My User".
    - Application node for "Your App".
    - Application node for "My App".
  - No interaction edges present for I.

Expected behaviour after this spec:
- Meta-Model view:
  - "Interactions" appears only in the Relationships row.
- Diagrams RHS:
  - "User Interactions" → row for I is **enabled** (since this is Case A, and both P and S are on the diagram, edgesExist = false).
  - Clicking/dragging the row creates the MAIN dotted line + label, and optionally a USER_LINK if the User node is present.

------------------------------------------------------------
4. Acceptance criteria

AC1 – Meta-Model placement:
- "Interactions" tab appears only in the Relationships row, between "App Point <-> Business Point" and "Logical ER".
- It no longer appears in the Entities row.

AC2 – Case A enablement:
- For an Interaction with both Primary and Secondary App_Business_Points defined:
  - If both nodes are on the diagram and there are no interaction edges:
    - The corresponding row under "User Interactions" is enabled, regardless of whether the User node is present.
  - Adding the interaction draws the MAIN dotted line between the two App nodes and disables the row.

AC3 – Case B enablement:
- For an Interaction with only a Primary App_Business_Point defined:
  - If both the Primary node and the User node are on the diagram, and there are no interaction edges:
    - The row is enabled.
  - Otherwise it is disabled or hidden.

AC4 – No accidental User dependency in Case A:
- Code audit shows no condition that requires userOnDiagram for enabling the row in Case A.

AC5 – Screenshot scenario:
- With "My User", "My App", and "Your App" on the diagram, and a Case A interaction linking "Your App" and "My App":
  - The Interaction row is visibly enabled after these fixes.

This spec ensures the Interactions tab is correctly classified as a Relationship and that User Interaction rows enable/disable correctly according to the intended rules.

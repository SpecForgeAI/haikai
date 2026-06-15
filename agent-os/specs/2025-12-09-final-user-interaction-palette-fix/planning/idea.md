---
Title: Final Fix for User Interaction Palette Enablement and Removal of "Show User Interactions" Toggle

Summary:
Two issues remain:

1) In the Diagrams RHS "Palette" panel, the **User Interaction row is still disabled** even when the User node and both Application nodes ("My App" and "Your App") are present on the diagram and there are no interaction edges. This indicates the enablement logic is still not correctly linking App_Business_Points to the concrete diagram nodes.

2) There is an unwanted **"Show User Interactions"** checkbox at the top of the palette, which was not requested and should be removed. User interactions should always be visible when present; we do not need a separate toggle.

This spec:
- Defines an explicit, concrete mapping from App_Business_Point → diagram node so the enablement logic can correctly detect that "My App" and "Your App" support enabling the interaction row.
- Encapsulates the enablement logic in a single function with clear Case A / Case B rules.
- Removes the "Show User Interactions" checkbox and any associated filtering logic.

------------------------------------------------------------
1. App_Business_Point → diagram node mapping (authoritative definition)

We standardise how App_Business_Points relate to diagram nodes.

1.1 App_Business_Point structure
Each App_Business_Point record MUST store, at minimum:

- id: string
- name: string
- related_entity_type: enum
  - One of:
    - "APPLICATION"
    - "APP_COMPONENT"
    - "SERVICE"
    - "BUSINESS_PROCESS"
    - "PROCESS_ACTIVITY"
    - "INTERFACE"
- related_entity_id: string
  - The id of the underlying entity in the corresponding meta-model table.

Note:
- We MUST NOT expect any diagram node with entity_type "APP_BUSINESS_POINT". Only concrete entity types are drawn.

1.2 Diagram node structure (assumed, to be used by the mapping)
Each diagram node has:

- node.id
- node.entity_type: enum matching the same values as above ("APPLICATION" etc.)
- node.entity_id: string – id of the meta-model entity.
- node.valid_from / node.valid_to (for diagram temporality).

1.3 Mapping function
Implement a shared helper (e.g. in `diagramUtils.ts`) that, given an App_Business_Point id, returns the list of concrete diagram nodes representing it at time T:

  function getDiagramNodesForAppBusinessPoint(
    model: ArchitectureModel,
    diagram: Diagram,
    appBusinessPointId: string,
    time: QuarterPeriod
  ): DiagramNode[] {
    const abp = model.app_business_points.find(p => p.id === appBusinessPointId);
    if (!abp) return [];

    const { related_entity_type, related_entity_id } = abp;

    return diagram.nodes.filter(node =>
      node.entity_type === related_entity_type &&
      node.entity_id === related_entity_id &&
      isDiagramNodeVisibleInPeriod(node, time) // existing temporality helper
    );
  }

Requirements:
- This function MUST be used for all User Interaction enablement logic when checking presence of P/S points on the diagram.
- Do NOT attempt to match by App_Business_Point id directly to node.entity_id.
- Do NOT go via ApplicationPoint or other superclasses for this mapping; rely solely on related_entity_type + related_entity_id.

------------------------------------------------------------
2. Encapsulate User Interaction enablement logic

2.1 Single source of truth function

Create a function, e.g. `isInteractionEnabledInPalette`, in a shared module used by the palette:

  function isInteractionEnabledInPalette(
    model: ArchitectureModel,
    diagram: Diagram,
    interaction: Interaction,
    time: QuarterPeriod
  ): boolean {
    const { user_id: U, primary_app_business_point_id: P, secondary_app_business_point_id: S } = interaction;

    // 1) Temporality & existence checks
    if (!isInteractionValidInPeriod(interaction, time)) return false;
    if (!isUserValidInPeriod(model, U, time)) return false;
    if (!isAppBusinessPointValidInPeriod(model, P, time)) return false;
    if (S && !isAppBusinessPointValidInPeriod(model, S, time)) return false;

    // 2) Edges already present?
    const edgesExist = diagram.node_edges.some(edge =>
      edge.relationship_type === "USER_INTERACTION" &&
      edge.interaction_id === interaction.id &&
      isDiagramEdgeVisibleInPeriod(edge, time)
    );
    if (edgesExist) return false;

    // 3) Case A vs Case B
    const hasSecondary = !!S;

    if (hasSecondary) {
      // Case A: P + S must both be on diagram (User optional)
      const primaryNodes   = getDiagramNodesForAppBusinessPoint(model, diagram, P, time);
      const secondaryNodes = getDiagramNodesForAppBusinessPoint(model, diagram, S, time);

      const primaryOnDiagram   = primaryNodes.length > 0;
      const secondaryOnDiagram = secondaryNodes.length > 0;

      return primaryOnDiagram && secondaryOnDiagram;
    } else {
      // Case B: Only P – requires User node AND P node
      const primaryNodes = getDiagramNodesForAppBusinessPoint(model, diagram, P, time);
      const primaryOnDiagram = primaryNodes.length > 0;

      const userOnDiagram = diagram.nodes.some(node =>
        node.entity_type === "BUSINESS_USER" &&
        node.entity_id === U &&
        isDiagramNodeVisibleInPeriod(node, time)
      );

      return primaryOnDiagram && userOnDiagram;
    }
  }

Notes:
- `isInteractionValidInPeriod`, `isUserValidInPeriod`, `isAppBusinessPointValidInPeriod` can reuse existing meta-model temporality helpers.
- For Case A (two App_Business_Points), **do not require** the User node to be present.
- For Case B (no secondary), **do require** the User node.

2.2 Use this function in the palette

In whatever code constructs the "User Interactions" section rows (e.g. `buildUserInteractionPaletteSection`):

Replace any prior ad-hoc enablement logic with:

  const enabled = isInteractionEnabledInPalette(model, diagram, interaction, currentPeriod);

  rows.push({
    id: interaction.id,
    label: interaction.name,
    enabled,
    // other fields...
  });

Requirements:
- Delete or refactor any previous checks such as:
  - `isNodeOnDiagram("APP_BUSINESS_POINT", ...)`
  - or any global requirement for userOnDiagram in Case A.
- The palette's disabled state must map `enabled === false` to the greyed-out row style.

2.3 Behaviour for the current example

Given:
- Interaction "Interaction A" defined with:
  - User = "My User"
  - Primary Point = App_Business_Point referencing "My App"
  - Secondary Point = App_Business_Point referencing "Your App"
- Diagram currently has nodes:
  - Business User "My User"
  - Application "My App"
  - Application "Your App"
- No USER_INTERACTION edges exist.

At time T:
- `getDiagramNodesForAppBusinessPoint` returns nodes for P and S.
- edgesExist === false
- hasSecondary === true ⇒ Case A
- primaryOnDiagram === true, secondaryOnDiagram === true
⇒ `isInteractionEnabledInPalette` returns true ⇒ row enabled.

------------------------------------------------------------
3. Remove the "Show User Interactions" checkbox

3.1 Remove from JSX / UI

In the Diagrams RHS Palette component (e.g. `Palette.tsx` or similar):

- Remove the JSX that renders the checkbox:

  <Checkbox
    checked={showUserInteractions}
    onChange={...}
  >
    Show User Interactions
  </Checkbox>

- Remove any layout spacing or container specific to this checkbox.

3.2 Remove state and filtering logic

- Remove `showUserInteractions` (and any related state) from:
  - Context / provider state.
  - Palette props or Redux store, if used.
- Remove any conditional logic that hides interaction edges or hides the Interactions section based on this flag, e.g.:

  if (!showUserInteractions) {
    // hide dotted lines or skip Interactions section
  }

After this change:
- User Interaction edges (MAIN & USER_LINK) are always rendered when present.
- The "User Interactions" palette section is always shown (subject to existing overall palette filtering).

3.3 Acceptance for section 3

- The "Show User Interactions" checkbox no longer appears at the top of the palette.
- There is no code path that uses `showUserInteractions` to filter or hide anything.

------------------------------------------------------------
4. Overall acceptance criteria

AC1 – Mapping:
- For an Interaction involving Applications, the enablement logic correctly detects App_Business_Points as long as the relevant Application nodes are on the diagram.
- `getDiagramNodesForAppBusinessPoint` matches nodes based solely on (related_entity_type, related_entity_id).

AC2 – Case A enablement:
- For a valid Interaction with User + P + S and both concrete nodes for P and S present on the diagram (no edges yet):
  - The row under "Interactions" in the palette is **enabled**, regardless of whether the User node is present.

AC3 – Case B enablement:
- For a valid Interaction with only P defined and both User + P nodes present (no edges yet):
  - The row is enabled.
- If User or P node is missing, the row is disabled.

AC4 – Edges disable rows:
- After adding an interaction (creating MAIN edge and optional USER_LINK edge), the row becomes disabled.
- After deleting all edges for a given interaction id at time T (MAIN and USER_LINK), and with required nodes still present, the row becomes enabled again.

AC5 – UI cleanup:
- The Palette panel no longer shows "Show User Interactions".
- Interactions are always visible and controllable solely via the palette section and context-menu operations.

This spec provides a precise mapping from App_Business_Point to concrete diagram nodes and centralises enablement logic so that User Interaction rows behave correctly and the unwanted checkbox is removed.

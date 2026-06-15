Title: Finalise User Interaction Relationship Visualisation and Enable/Disable Rules

Summary:
This spec refines the behaviour of User Interactions as a relationship (not an entity), and fully defines:
- How User Interactions are visualised as dotted edges with a label.
- When a User Interaction row in the Diagrams RHS panel is enabled vs disabled.
- How deleting one or both interaction edges affects the RHS state.
- The different rules for:
  - Case A: Interaction has Primary + Secondary App_Business_Point.
  - Case B: Interaction has ONLY a Primary App_Business_Point (no Secondary).

This builds on previous specs where:
- Interactions are a relationship in the Meta-Model (not an entity).
- App_Business_Point is a super-type for Business Process, Process Activity, Application, Application Component, Service, Interface, (and optionally Endpoint).

------------------------------------------------------------
1. Meta-Model reminder (context only)

The Interactions relationship table has at least:
- name (string, required)
- description (string, optional)
- user_id (FK → Business User, required)
- primary_app_business_point_id (FK → App_Business_Point, required)
- secondary_app_business_point_id (FK → App_Business_Point, optional)
- valid_from / valid_to (optional, meta-model temporality)

In the Meta-Model view:
- Interactions appear in the Relationships row between:
  - App Point <-> Business Point
  - Logical ER

In the Diagram RHS panel:
- "User Interactions" appears immediately below "App Point <-> Business Point".

------------------------------------------------------------
2. Diagram representation: edges, not nodes

2.1 No Interaction node
- A User Interaction is NEVER drawn as a node/box.
- It is represented purely as:
  - One **main dotted edge**, plus
  - An optional **user link dotted edge** (Case A only),
  - A moveable text label.

2.2 Edge types
- Introduce two conceptual edge types for User Interactions:
  - MAIN edge:
    - For Case A: between Primary and Secondary App_Business_Point nodes.
    - For Case B: between User and Primary App_Business_Point node.
  - USER_LINK edge (Case A only):
    - Between User node and the midpoint of the MAIN edge.

- Both edges:
  - Are dotted lines.
  - Respect edge z_index rules.
  - Are stored as normal node_edges with a relationshipType of "USER_INTERACTION" and a subType of "MAIN" or "USER_LINK".

2.3 Label
- The Interaction name is rendered as a text label attached to the MAIN edge:
  - Initially positioned at the geometric centre of that MAIN line.
  - Moveable via drag (updates stored label position).
- Deleting edges does NOT automatically delete the underlying Interaction meta-model row.

------------------------------------------------------------
3. Enable/disable rules for User Interaction rows (RHS panel)

Let:
- T = current time period.
- I = an Interaction record.
- U = its user.
- P = primary App_Business_Point.
- S = secondary App_Business_Point (optional).

3.1 Temporal validity pre-filter
An Interaction I is visible in the RHS "User Interactions" list if and only if:
- I is valid at T (I.valid_from <= T <= I.valid_to, with null treated as open-ended), AND
- U, P (and S if defined) are valid at T as meta-model elements.

If any of these are invalid at T, the row does not appear at all.

3.2 Definitions
- "Node exists on the diagram" means:
  - A diagram node for the underlying entity (Business User or App_Business_Point) is present and visible at T (considering diagram-level temporality if already implemented).

- "Interaction edges exist for I at T" means:
  - There is at least one MAIN or USER_LINK edge whose interaction_id = I.id and whose diagram-level validity includes T.

3.3 Case A – Interaction with Primary + Secondary App_Business_Point

Case A is when I has:
- primary_app_business_point_id = P
- secondary_app_business_point_id = S (non-null)

Enable rule for RHS row (Case A):
- The Interaction row for I is **enabled** (clickable/drag-able) if **all** of the following are true:
  1) P node is on the diagram at T.
  2) S node is on the diagram at T.
  3) There are **no** interaction edges for I on the diagram at T (no MAIN, no USER_LINK).

- The Presence of U (User) node is NOT required for the row to be enabled.

Disabled rule (Case A):
- The Interaction row for I is **disabled (greyed out)** if:
  - P and S are valid but at least one interaction edge (MAIN or USER_LINK) for I exists on the diagram at T.
- If P or S nodes are missing from the diagram:
  - The row may either be hidden or appear as disabled (implementation choice); it MUST NOT be enabled.

3.4 Case B – Interaction with only a Primary App_Business_Point

Case B is when I has:
- primary_app_business_point_id = P
- secondary_app_business_point_id = null

Here a single dotted line must be drawn between User and P, so both nodes must exist.

Enable rule for RHS row (Case B):
- The Interaction row for I is **enabled** if **all** of the following are true:
  1) P node is on the diagram at T.
  2) U (User) node is on the diagram at T.
  3) There are **no** interaction edges for I on the diagram at T.

Disabled rule (Case B):
- The row is **disabled** if there is any MAIN edge for I on the diagram at T.
- If P or U nodes are missing from the diagram:
  - The row must be disabled (or hidden), since there is nowhere sensible to draw the dotted line.

------------------------------------------------------------
4. Behaviour when adding an Interaction to the diagram

4.1 Case A – Primary + Secondary

When the Interaction row I (Case A) is enabled and the user adds it to the diagram:

1) Ensure nodes:
   - Do NOT auto-add any user node.
   - Require that P and S nodes are already present (this is enforced by the enable rule).
   - If P or S are missing (due to inconsistency), abort with an error message.

2) Draw edges:
   - Draw a MAIN dotted line between node(P) and node(S).
   - Attach the Interaction name label to this MAIN edge (centre by default).

3) User-link edge (optional, only if User node is present):
   - If U node exists on the diagram at T:
     - Also draw a USER_LINK dotted line from U node to the midpoint of the MAIN edge.
   - If U node does not exist:
     - Do NOT block adding the interaction.
     - Simply omit the USER_LINK edge.

4) After drawing at least the MAIN edge:
   - Mark I as "present" on the diagram at T.
   - The RHS row for I becomes disabled/greyed out (because an interaction edge now exists).

4.2 Case B – Primary only (User required on canvas)

When the Interaction row I (Case B) is enabled and the user adds it:

1) Ensure nodes:
   - P node must be present (enforced by enable rule).
   - U node must be present (enforced by enable rule).
   - If either is missing, abort.

2) Draw edges:
   - Draw a MAIN dotted line between U node and P node.
   - Attach the Interaction name label in the middle of this line (moveable).

3) No separate USER_LINK edge in this case:
   - The MAIN edge is "user interaction" itself.

4) After drawing the MAIN edge:
   - Mark I as "present" on the diagram at T.
   - The RHS row becomes disabled/greyed out.

------------------------------------------------------------
5. Deleting edges and how it affects RHS enable/disable

5.1 Deleting only the USER_LINK edge (Case A only)

- The user may delete the USER_LINK edge (User → midpoint) while leaving the MAIN edge (P ↔ S) intact.

Effect:
- The Interaction is still considered present on the diagram, because the MAIN edge still exists.
- The RHS Interaction row for I remains **disabled/greyed out**.
- The user can later re-add a USER_LINK edge by:
  - Selecting the interaction and choosing an action (future enhancement), or
  - Re-adding the user line via a separate context action (implementation detail).

5.2 Deleting the MAIN edge (with or without USER_LINK)

If the MAIN edge is deleted:

- If a USER_LINK edge still exists:
  - That USER_LINK edge should also be removed or treated as orphaned and removed automatically (recommended).
- After removing all interaction edges (MAIN and USER_LINK) for I at T:
  - I is no longer visually represented on the diagram at T.
  - Provided the node presence conditions still hold:
    - Case A: P and S nodes are still present.
    - Case B: P and U nodes are still present.
  - The RHS Interaction row state:
    - Becomes **enabled** again, allowing the user to re-add the interaction.

5.3 Summary rule
- For both Case A and Case B:
  - Interaction row for I is disabled if there is ANY interaction edge (MAIN or USER_LINK) for I on the diagram at T.
  - Interaction row becomes enabled only when:
    - All interaction edges for I are removed for that period; and
    - Required nodes exist (Case A: P+S; Case B: P+U).

------------------------------------------------------------
6. Temporality interaction (high level)

- All interaction edges (MAIN and USER_LINK) respect diagram-level valid_from / valid_to.
- When editing interaction edges at a different time period, they follow the same version-splitting logic as other edges.
- The enable/disable rules are evaluated per period T using:
  - Meta-model validity of I, U, P, S.
  - Diagram validity of nodes and edges for that period.

------------------------------------------------------------
7. Acceptance criteria

AC1 – Case A enabling:
- For an Interaction I with both P and S defined:
  - If P and S nodes are on the diagram and there are no interaction edges for I:
    - I's RHS row is enabled, even if the User node is not present.
  - Adding the interaction draws at least the MAIN edge between P and S plus label.
  - If U node is present, USER_LINK is also drawn.
  - After adding, I's RHS row is disabled.

AC2 – Case B enabling:
- For an Interaction I with only P defined (no S):
  - If both P and U nodes are on the diagram and there are no interaction edges for I:
    - I's RHS row is enabled.
  - Adding the interaction draws a MAIN dotted line between U and P plus label.
  - After adding, I's RHS row is disabled.

AC3 – Deleting only USER_LINK:
- In Case A, deleting the USER_LINK edge while keeping the MAIN edge:
  - Leaves I's RHS row disabled.
  - The interaction remains represented by the MAIN edge.

AC4 – Deleting both edges:
- When all edges for Interaction I (MAIN and USER_LINK) are deleted at T:
  - I is no longer visually represented on the diagram at T.
  - If required nodes are still present:
    - I's RHS row becomes enabled again.

AC5 – No Interaction nodes:
- At no point is an Interaction drawn as a node/box.
- All Interaction visualisation is via dotted edges and an attached label.

This spec finalises the User Interaction relationship behaviour, especially enabling/disabling rules, optional user-edge in Case A, and re-add behaviour after deletion.

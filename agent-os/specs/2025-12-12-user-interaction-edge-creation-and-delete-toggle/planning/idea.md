# Idea: Implement User Interaction Edge Creation on "Add" and Toggle Row Action to "Delete" When Present

## Summary

The current implementation of User Interactions has partially working enablement: when the User node and both Applications ("My App", "Your App") corresponding to the Interaction's Primary/Secondary App_Business_Points are on the diagram, the Interaction row in the "User Interactions" section becomes clickable and shows an "Add" option. However:

1) Clicking "Add" does not visibly add the Interaction to the diagram (no dotted lines or label appear).
2) After adding, the row continues to show "Add" instead of switching to "Delete" like other palette sections (e.g. Applications).

This spec defines:
- Exactly how the diagram engine must create MAIN and USER_LINK edges for a User Interaction on "Add".
- How the Interaction label is created and positioned.
- How the palette must switch the row's context action between "Add" and "Delete" based on presence of Interaction edges.

## Data Model Conventions

### Edge Fields
User Interactions reuse the existing diagram `node_edges` collection. Each edge must have:
- id: string
- relationship_type: "USER_INTERACTION"
- interaction_id: string (FK → Interactions row id)
- subtype: "MAIN" or "USER_LINK"
- source_node_id: string
- target_node_id: string
- line_style: "dotted"
- z_index: number

### Label Fields
- Label associated with MAIN edge only
- Label text = Interaction name
- Label position = geometric midpoint of MAIN edge

## Behaviour on "Add"

### Case A (Primary + Secondary ABP)
1. Resolve diagram nodes for P and S
2. Create MAIN edge between primary and secondary nodes
3. Compute midpoint and create label with interaction name
4. If User node exists: create USER_LINK edge from User to midpoint
5. Row switches to "Delete" action

### Case B (Primary ABP only)
1. Resolve diagram nodes for P and User
2. Create MAIN edge between User and Primary
3. Label at midpoint
4. Row switches to "Delete"

## Palette Row Add/Delete Toggle

### Row Model
- If no edges exist and enablement conditions met: enabled=true, action="Add"
- If edges exist: enabled=true, action="Delete"
- If not applicable: enabled=false

### Delete Behaviour
- Remove ALL edges where relationship_type="USER_INTERACTION" and interaction_id matches
- After deletion: row returns to "Add" state

## Acceptance Criteria

1. AC1: Adding Case A interaction draws MAIN edge (dotted), label at midpoint, optional USER_LINK
2. AC2: Deleting removes all edges and restores "Add" action
3. AC3: No-op prevention - clear error if preconditions fail
4. AC4: Consistency with other palette sections (Add/Delete toggle)

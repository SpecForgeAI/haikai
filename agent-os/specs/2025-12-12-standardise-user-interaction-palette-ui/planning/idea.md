# Idea: Standardise User Interaction Palette Row UI and Context Menu Behaviour

## Summary

The "User Interactions" rows in the Diagrams RHS palette currently behave and look different from all other sections:

- Each User Interaction row shows an extra inline "Add"/"Remove" badge on the right.
- The row is styled differently (pink/red background when edges are present, blue when adding).
- The context menu for the row always shows "Add", even when an Interaction is already present on the diagram.

## Desired Behaviour

User Interaction rows must behave exactly like Application, Business Process, etc. rows:

- No extra inline action badges (the "Add"/"Remove" indicator).
- No special pink/red/blue row styling for interaction-specific states.
- A single context menu item that dynamically shows **"Add"** when the item is not on the diagram and **"Delete"** when it is.
- The add/delete action should rely on the same `hasInteractionEdges` logic already defined.

## Current Implementation Issues

1. **Inline Action Indicator Badge** - Shows "Add" (blue) or "Remove" (red) badge on the right side of the row
2. **Special Row Styling** - Pink/red background (`#fff3f3`) for delete state, blue hover for add state
3. **Context Menu Always Shows "Add"** - Even when edges exist and should show "Delete"
4. **Inconsistent with Other Sections** - Applications, Business Processes don't have these visual indicators

## Acceptance Criteria

1. User Interaction rows have the same visual styling as other relationship sections
2. No inline "Add"/"Remove" badge on rows
3. Context menu shows "Add" when no edges exist, "Delete" when edges exist
4. Left-click behaviour remains unchanged (toggle add/delete based on edge existence)

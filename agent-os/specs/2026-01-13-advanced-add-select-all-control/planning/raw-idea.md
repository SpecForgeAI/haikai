---
title: Add Global "Select All" Control to Advanced Add Diagram Modal

context:
  The "Advanced Add" modal in the Diagram view allows users to select architecture
  entities and relationships (via a hierarchical checkbox tree) to add to a diagram.
  When adding complex interfaces or applications, users frequently want to include
  all nested items in the hierarchy, but currently must manually select each checkbox.

scope:
  - Frontend-only change
  - Applies only to the "Advanced Add" modal opened from the Diagram view RHS panel
  - No backend, persistence, or diagram insertion logic changes

requirements:
  ui:
    - Increase the overall width of the Advanced Add modal to:
        - Allow clearer visibility of deeply nested hierarchy labels
        - Fit a new bottom-row control without wrapping
    - Add a new bottom-row control consisting of:
        - Label: "Select All"
        - Checkbox aligned on the same row as the label
    - The control must be visually separated from the hierarchy tree (e.g. footer area)

  behavior:
    - When the "Select All" checkbox is checked:
        - All checkboxes in the hierarchy above must become checked
        - This must override any existing partial or mixed selection state
    - When the "Select All" checkbox is unchecked:
        - All checkboxes in the hierarchy above must become unchecked
        - This must override any existing partial or mixed selection state
    - The "Select All" checkbox acts as a deterministic override:
        - It does not toggle relative to current selection
        - It does not depend on prior state of the hierarchy
    - Manual checking/unchecking of individual items in the hierarchy:
        - Does not automatically update or sync the "Select All" checkbox state

  add_to_diagram:
    - Clicking "Add to Diagram" continues to add exactly the items currently selected
    - No change to diagram creation, persistence, or rendering logic

non_goals:
  - No tri-state or indeterminate checkbox behavior
  - No automatic detection of "all selected" or "partially selected" states
  - No changes to backend APIs or data models
  - No changes to which entity types can be added to diagrams

acceptance_criteria:
  - Users can fully select or fully deselect the entire hierarchy with a single click
  - The behavior works reliably even when the hierarchy was previously partially selected
  - The modal layout remains usable for large and deeply nested hierarchies
---

title: Improve Context Picker Modal UI (Resize + 6 Icon Tabs + Entities/Relationships Sections)

context:
  The Implement "Add Context" modal currently has two tabs ("Architecture" and "Diagrams") and
  only exposes a subset of context selection needs. Users need to select both entities and
  relationships, and the modal should align visually with the 5-domain architecture tabs used
  elsewhere in the product. The modal also needs more space for large hierarchies.

goal:
  Update the Context Picker modal to:
    1) increase overall size (width + height),
    2) replace the 2 text tabs with 6 icon tabs matching the existing 5 architecture-domain tab
       styling plus a new Diagrams tab, and
    3) for each architecture domain tab, show two sections ("Entities" and "Relationships")
       with checkbox tree rows, while keeping Diagrams content equivalent to the current
       Diagrams tab.

scope:
  - Frontend only (modal layout + tab UI + wiring to existing selection lists)
  - No backend changes required in this iteration (relationships selection UI only)
  - No change to selection persistence format beyond adding relationship selections if needed
    (handled in a separate iteration unless already supported)

requirements:
  1_modal_resize:
    - Increase modal width by 100% relative to current rendered size.
    - Increase modal height by 50% relative to current rendered size.
    - Ensure the modal remains usable on smaller screens by:
        - enabling internal scroll within the modal body
        - keeping header/footer (Cancel/Apply) fixed/sticky as today.

  2_tabs_replace_architecture_diagrams_with_6_icon_tabs:
    - Replace the current "Architecture" and "Diagrams" tabs with a 6-tab strip that visually
      matches the existing architecture domain tab component styling (icon + label):
        - Business
        - Application
        - Data
        - Behavioural
        - UI
        - Diagrams
    - Use the same lucide icons and labels as the existing 5 domain tabs for the first five tabs.
    - The new "Diagrams" tab MUST use the lucide icon: chart-network.
    - Default selected tab should be the most recently used tab for the user within the modal
      session; otherwise default to "Business".

  3_tab_contents_architecture_domains_entities_and_relationships_sections:
    - For each of the 5 architecture domain tabs (Business/Application/Data/Behavioural/UI),
      render two collapsible (or clearly separated) sections in the modal body:
        a) Entities
        b) Relationships
    - Section content MUST mirror the structure used in the Diagram RHS "add items" panel:
        - Each section lists the relevant categories for that domain.
    - Rows MUST be rendered as checkbox-selectable items using the same checkbox tree approach
      currently used in the context picker (expand/collapse, nested nodes).
    - The Entities section MUST show the same entity hierarchy currently available for that domain.
    - The Relationships section MUST show relationship categories relevant to that domain.
      (Initial implementation may include categories even if empty; must not crash.)

  4_diagrams_tab_content:
    - The "Diagrams" tab MUST show the exact same content and behavior as the current "Diagrams"
      tab in the modal (checkbox list of diagrams with any existing filters/search).

  5_selection_behavior_and_apply:
    - Selecting/unselecting checkboxes in any tab updates the modal selection state.
    - "Apply" returns the accumulated selections exactly as today for entities/diagrams.
    - Relationship selections must be stored in the modal state separately from entity selections.
    - If the current persistence contract does not yet support relationships, store relationship
      selections in modal state and include them in the Apply payload under a new field:
        - selectedRelationshipRefs (or equivalent), without breaking existing entity/diagram payloads.

  6_accessibility_and_polish:
    - Tab strip must be keyboard navigable (arrow keys / tab focus) consistent with existing UI.
    - Ensure the increased modal size does not clip the close button or action buttons.

acceptance_criteria:
  - The Add Context modal is visibly wider (2x) and taller (1.5x) than before, with internal scrolling.
  - The modal shows 6 icon tabs matching the existing architecture domain tab styling, plus a
    Diagrams tab using lucide chart-network.
  - Each of the 5 domain tabs shows "Entities" and "Relationships" sections with checkbox tree rows.
  - The Diagrams tab shows the same diagram selection UI as before.
  - Apply/Cancel behavior remains functional and does not regress existing entity/diagram context selection.

non_goals:
  - No backend expansion logic for relationship selections in this change
  - No changes to how the Planner LLM consumes relationships yet (handled in later iteration)

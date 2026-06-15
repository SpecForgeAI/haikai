# Raw Idea

name: implement-button-three-phase-enablement-and-warning
scope:
  product_area: "Product & Delivery"
  screen: "Implement Feature"
  target: "Implement button enablement + warning behavior"
  services:
    - frontend

intent:
  - Implement a clear 3-phase state model for the "Implement" button based on planner definition availability and open-question completion.
  - Ensure the button enablement is driven by the current planner-response state (not legacy transcript markers), while preserving the existing warning UX when questions remain open.

changes:
  frontend:
    - Define 3-phase Implement button state model:
        - Phase 1 (No Planner Definition Yet):
            - Condition: no planner/PO definition data available for the feature.
            - Behavior: "Implement" button disabled (greyed out, not clickable).
        - Phase 2 (Planner Definition Present + Open Questions Unanswered):
            - Condition: planner/PO definition data is present AND at least one open question remains unanswered.
            - Behavior: "Implement" button enabled.
            - On click: show existing warning/confirmation UX before proceeding.
        - Phase 3 (Planner Definition Present + All Open Questions Answered):
            - Condition: planner/PO definition data is present AND all open questions are answered.
            - Behavior: "Implement" button enabled.
            - On click: proceed directly (no warning).

    - Planner definition presence (canonical gating):
        - Replace any gating logic that depends on legacy chat transcript markers (e.g., "PROPOSED" / "Part 4" extraction) with a check based on the latest structured planner response used to render:
            - Product Owner Understanding
            - Scope
            - Acceptance Criteria
            - Assumptions
            - Open Questions
        - The "planner definition present" check should consider the above fields meaningfully populated (non-empty / non-whitespace, non-empty arrays where applicable).
        - Keep the computation local to the Implement screen state so it updates correctly on load, rehydrate, and planner refresh.

    - Button enablement:
        - Drive the disabled/enabled state from:
            - global loading/bootstrapping/implementing flags (as today)
            - work item availability (as today)
            - AND the new "planner definition present" condition (Phase 1 disables)
        - Do not disable the button purely because open questions exist (Phase 2 requires enabled).

    - Warning behavior:
        - Preserve the existing confirmation/warning behavior for Phase 2 (open questions remaining).
        - Ensure Phase 3 bypasses the warning.

tests:
  - Update/add frontend tests to assert the full 3-phase behavior:
      - Phase 1: with empty/no planner response → Implement disabled.
      - Phase 2: planner response populated + some unanswered open questions → Implement enabled; click triggers warning.
      - Phase 3: planner response populated + all questions answered → Implement enabled; click proceeds directly.

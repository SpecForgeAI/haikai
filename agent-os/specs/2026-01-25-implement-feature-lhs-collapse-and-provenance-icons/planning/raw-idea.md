# Raw Idea

name: implement-feature-lhs-collapse-and-provenance-icons
scope:
  product_area: "Product & Delivery"
  screen: "Implement Feature"
  target: "LHS Feature area layout + section headers"
  services:
    - frontend

intent:
  - Create more vertical space in the Implement Feature LHS by consolidating sections.
  - Make section provenance explicit (user-authored vs planner/LLM-generated) using lucide icons.
  - Reorder sections so Open Questions is the final section the user interacts with.

changes:
  frontend:
    - Section header iconography (lucide):
        - Use icon "square-user-round" for user-authored/source-input sections.
        - Use icon "bot" for planner/LLM-generated sections.
        - For "Open Questions" header, render both icons separated by "&":
            [bot] & [square-user-round] Open Questions
        - Apply icons consistently across the Implement Feature LHS sections as listed below.

    - Consolidate Description + Context into one top section:
        - Replace the separate "Description" and "Context" sections with a single section:
            [square-user-round] Initial Description & Context
        - Within the section body:
            - Render existing Description content first.
            - Then insert an explicit line break (no divider rule) before the Context UI.
            - Render existing Context chips row and "+ Add context" button after the line break.
        - Visually differentiate this top section from the others:
            - Use a distinct border and subtle background tint (keep consistent with app styling).
            - Keep the rest of the layout/controls unchanged.

    - Consolidate Scope + Out of Scope into one section with a 2-column layout:
        - Replace "Scope" and "Out of Scope" sections with a single section:
            [bot] Scope
        - Section body layout:
            - One-row grid with two columns (50% / 50%).
            - Left column titled (underlined): "In Scope" containing the previous Scope bullets/content.
            - Right column titled (underlined): "Out of Scope" containing the previous Out of Scope bullets/content.
        - Preserve existing bullet rendering/content semantics; only restructure the layout.

    - Section ordering adjustment:
        - Ensure the LHS sections appear in this order (top → bottom):
            1) [square-user-round] Initial Description & Context
            2) [bot] Product Owner Understanding
            3) [bot] Scope
            4) [bot] Acceptance Criteria
            5) [bot] Assumptions
            6) [bot] & [square-user-round] Open Questions
        - Swap the current positions of "Assumptions" and "Open Questions" so Open Questions is last.

    - Styling:
        - Add minimal CSS changes required to:
            - Align icons within section headers.
            - Apply the distinct border/background style to the "Initial Description & Context" section.
            - Implement the 2-column grid for the combined Scope section.
        - Do not introduce heavy padding/dividers.

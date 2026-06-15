# Raw Idea

name: fix-context-picker-data-entity-point-labels-and-select-all
scope:
  product_area: "Product & Delivery"
  screen: "Implement Feature"
  component: "Add Context selector modal"
  services:
    - frontend
    - architecture-model-service (no functional changes expected)

intent:
  - Fix incorrect relationship label rendering where DATA_ENTITY_POINT participants display as "Unknown".
  - Add "Select All" checkboxes at:
      (1) section level for Entities and Relationships
      (2) group/type level for each entity/relationship type group

changes:
  frontend:
    - context relationship label rendering:
        - Ensure any relationship participant that is a DATA_ENTITY_POINT resolves its display name to the underlying concrete entity name:
            - Logical Data Entity name when the point refers to a logical entity
            - Physical Data Entity name when the point refers to a physical entity
        - Ensure the rendered type label for the resolved participant reflects the concrete type (LOGICAL_DATA_ENTITY or PHYSICAL_DATA_ENTITY), not DATA_ENTITY_POINT.
        - Preserve existing formatting for non-DATA_ENTITY_POINT participants and existing row label layout.
        - Update/extend tests covering label rendering so this case is explicitly validated.

    - context picker modal "Select All":
        - Add a Select All checkbox at the top of the Entities section:
            - When checked: selects all entity rows currently available in that section (across all entity types/groups)
            - When unchecked: clears all selected entity rows from that section
        - Add a Select All checkbox at the top of the Relationships section:
            - When checked: selects all relationship rows currently available in that section (across all relationship types/groups)
            - When unchecked: clears all selected relationship rows from that section

        - Add a Select All checkbox for each entity-type group and each relationship-type group (e.g. INTERFACE_LOGICAL_ENTITIES):
            - When checked: selects all rows in that group only
            - When unchecked: clears all rows in that group only

        - Selection state correctness requirements:
            - Bulk selection/deselection must keep related selection metadata consistent:
                - For entities: ensure any required bundle/depth defaults are present for newly-selected entities; remove associated metadata when deselecting.
                - For relationships: ensure required relationship metadata used by Apply/commit is present for newly-selected relationships; remove it when deselecting.
            - Select All checkboxes should reflect current selection state:
                - Checked when all rows in scope are selected
                - Unchecked when none are selected
                - Indeterminate state is allowed/encouraged when partially selected (if supported by current UI patterns)

        - UX behavior:
            - Clicking a Select All checkbox must not trigger expand/collapse toggles for the section/group header (prevent event propagation as needed).
            - Maintain current layout and styling conventions; add minimal styling only where needed.

  model_service:
    - No API/schema change required for these fixes.
    - If any service-side helper already exists for parsing data entity point IDs, it may be referenced as a guide but do not introduce new endpoints.

files_hint:
  frontend_likely_touchpoints:
    - "src/components/**/ContextPickerModal.tsx"
    - "src/utils/**/contextRelationshipLabel*.ts"
    - existing context pick list builders / label utils
    - related tests under "src/__tests__/**"
  model_service_reference_only:
    - any existing context bundle expansion / DEP parsing helper (do not change behavior)

acceptance_criteria:
  - In the Add Context modal, relationship rows no longer show "Unknown [DATA_ENTITY_POINT]" for data entity points when the underlying entity exists.
  - Data entity point participant labels display the underlying logical/physical entity name and show the concrete type label.
  - Entities section Select All selects/clears all entity rows in the section correctly and does not break bundle/depth defaults.
  - Relationships section Select All selects/clears all relationship rows in the section correctly and does not break Apply/commit due to missing metadata.
  - Each entity/relationship type group has a Select All that selects/clears only that group's rows.
  - Checkbox actions do not accidentally expand/collapse groups/sections.
  - Automated tests updated/added to cover:
      - DEP label resolution for both logical and physical backing entities (at least one of each)
      - Select All behavior (section + group) for entities and relationships
      - No regression in Apply/commit payload formation for selections

non_goals:
  - No changes to persisted data formats, API contracts, or database schema.
  - No redesign of the modal UI beyond adding Select All controls and fixing the label bug.

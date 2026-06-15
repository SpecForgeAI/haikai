title: Context Picker Iteration 5 — Smart Defaults and Heuristic Suggestions (Reduce Manual Context Work)

context:
  Context Bundles allow users to attach meaningful slices of architecture context, and the
  backend can expand bundles and produce condensed context DTOs for the Planner LLM. However,
  users still need to manually choose bundles, adjust scopes, and may omit important context
  needed for good planning (e.g., selecting an interface but not including schemas). This
  iteration introduces smart defaults and lightweight heuristics that:
    - preselect recommended bundles automatically
    - suggest additional context when likely needed
    - keep user control (no silent overreach)

goal:
  Reduce user effort and improve context quality by implementing:
    1) smarter, type-based default bundle choices
    2) heuristic-driven suggestions to include related bundles
    3) optional depth controls for entity relationship expansion (bounded)

scope:
  - Frontend UI enhancements in Context Picker
  - Gateway assistive suggestions based on current selections and/or condensed DTO analysis
  - No changes to core bundle types, expansion rules, or DTO schema (only selection guidance)
  - Suggestions are non-blocking and user-confirmed

requirements:
  smart_defaults:
    frontend:
      - When a user selects an item in the Context Picker, automatically assign a default bundle_type:
          - Interface -> interface_with_endpoints_and_schemas
          - Service   -> service_with_parents_and_children
          - Physical Data Entity -> entity_with_attributes_and_relationships
          - Logical Data Entity  -> entity_with_attributes_and_relationships
          - Diagram -> diagram_only
      - Display the chosen default bundle_type in the UI and allow the user to change it.

  heuristics_suggestions_ui:
    frontend:
      - Add a "Suggested Context" area in the Context Picker modal that can display one or more
        suggestions. Each suggestion must have:
          - title (short)
          - rationale (1–2 sentences)
          - action: "Add" (applies suggestion) and "Dismiss"
      - Suggestions must be non-blocking; users can proceed without accepting them.

  heuristic_rules_v1:
    gateway (or frontend if context is already locally available):
      - Compute suggestions using these initial rules:

        rule_interface_needs_schema:
          - If user selects an interface or endpoint bundle that does NOT include schemas,
            suggest upgrading to include schemas, or adding relevant schema entities.
          - Rationale: endpoint IO typically requires schema understanding.

        rule_service_needs_interfaces:
          - If user selects a service but no interfaces/endpoints are present in the expanded context,
            suggest including service_with_parents_and_children or explicitly adding interfaces.

        rule_entity_relationships_depth:
          - If user selects multiple data entities and there are known relationships among them,
            suggest enabling relationship depth=1 (if currently entity_only) or keeping depth=1
            but confirming inclusion of relationships.

        rule_diagram_as_context:
          - If user selects entities that are heavily connected and a diagram exists that references
            many of them, suggest adding that diagram (diagram_only).

      - Suggestions MUST be conservative:
          - Prefer 1–3 suggestions max
          - Do not suggest large expansions that could exceed context limits

  optional_depth_control_v1:
    frontend:
      - For entity_with_attributes_and_relationships bundle selections, add an optional depth selector:
          - Depth 1 (default)
          - Depth 2 (advanced)
      - Depth 2 must be clearly marked as potentially increasing context size.
    backend:
      - If depth is provided in the selection contract for entity bundles, pass it through to
        expansion (bounded).
      - Depth 2 must still respect max expansion limits and truncate deterministically if needed.

  selection_contract_extensions:
    - Extend stored bundle selection metadata to optionally include:
        - depth: integer (only for entity bundles; allowed values 1 or 2; default 1)
    - Maintain backward compatibility for existing selections with no depth field.

acceptance_criteria:
  - Selecting an interface automatically defaults to interface_with_endpoints_and_schemas and is visible/editable.
  - The Context Picker shows heuristic suggestions when applicable (e.g., interface selected without schemas).
  - Users can accept a suggestion and see selections update accordingly.
  - Users can dismiss suggestions and continue without changes.
  - Entity bundle selections offer a depth control defaulting to 1; selecting depth 2 increases included context
    (subject to backend bounds).
  - No silent changes: suggestions only apply when the user clicks "Add".

non_goals:
  - No automatic bundle expansion without user confirmation (beyond defaults on newly selected items)
  - No new bundle types introduced
  - No changes to condensed DTO schema beyond what already exists
  - No status tracking or persistence changes beyond storing optional depth

title: Ensure Physical Data Entity Attributes Reach Planner LLM (Persist Bundle+Depth and Resolve Attributes)

context:
  Implement Assistant context is selected via the Context Picker (entities/diagrams) and is
  intended to include bundle scopes and entity depth (e.g., physical data entities with
  attributes at depth>=1). Despite prior changes, the Planner LLM still receives physical
  data entities without any attributes/columns. This is due to two breaks:
    1) Bundle selections (bundle_type, depth) are not persisted and are lost on reload, so
       backend receives only raw IDs and behaves as entity_only.
    2) Even when expansion includes attribute entities, the resolver/response does not return
       physical attributes/columns to the caller.

goal:
  Make physical data entity attributes (columns) appear in the Planner LLM highlighted context
  deterministically:
    - attributes must be included for physical data entities at depth>=1
    - bundle_type/depth must persist per selected entity and be sent to backend
    - model service expand-resolve must return attributes in resolved output

scope:
  - Frontend: persist and send bundle selections (bundle_type, depth)
  - Gateway: pass structured selections to expand-resolve and inject resolved attributes
  - architecture-model-service: extend expand-resolve DTOs and resolution output to include
    physical data entity attributes (name/type at minimum)
  - No UI redesign beyond ensuring existing depth/bundle settings are saved and applied
  - No condensed DTO redesign; attributes may be included via existing summaryFields

requirements:
  1_persist_bundle_and_depth_per_feature_context:
    architecture-model-service:
      - Update the saved work-item context model (feature implement context) to store structured
        selections, not only ID arrays.
      - Persist for each selected entity:
          { entity_type: string, entity_id: string, bundle_type: string, depth: number? }
        and for each selected diagram:
          { diagram_id: string, bundle_type: string }
      - Backward compatibility:
          - If existing saved context contains only selected_entity_ids/selected_diagram_ids,
            return structured selections by mapping:
              - entity_type inferred by prefix/category if available; otherwise mark as "unknown"
              - bundle_type default based on entity type:
                  interfaces -> interface_with_endpoints_and_schemas
                  services -> service_with_parents_and_children
                  physical/logical data entities -> entity_with_attributes_and_relationships
                  others -> *_only
              - depth default = 1 for data entities, otherwise omitted

    frontend:
      - When saving/applying context from the Context Picker for a feature:
          - send structured selections including bundle_type and depth
      - When loading existing context:
          - render bundle_type and depth from persisted structured selections (not inferred each time)

  2_send_structured_selections_to_gateway_chat:
    frontend:
      - For implement_feature chat requests, include architectureContext as:
          {
            entities: [{ entity_type, entity_id, bundle_type, depth? }],
            diagrams: [{ diagram_id, bundle_type }]
          }
      - Do not send only legacy entityIds/diagramIds when structured selections exist.

    gateway:
      - If architectureContext.entities exists and length>0, call model service expand-resolve using
        the structured selections and ignore legacy ID-only resolution for highlighted context.

  3_expand_resolve_support_depth_and_include_attributes_in_resolved_output:
    architecture-model-service:
      - Extend expand-resolve request DTO entity selection to accept:
          depth: integer? (allowed values 1 or 2; default 1)
      - Implement semantics:
          - For physical/logical data entities:
              depth >= 1 MUST include the entity's attributes/columns in resolved output
              (at minimum: attribute name + type)
              depth >= 1 SHOULD include direct relationship metadata where available
              depth == 2 MAY include second-hop related entities/relationships (bounded)
      - Update resolved_entities element for physicalDataEntities to include attributes in a
        consistent field, e.g.:
          summaryFields.attributes = [{ name, type, pk?, nullable? }]
        (or equivalent existing field), for every returned physical data entity when depth>=1.

      - If your model currently stores physical data entity attributes separately as entities
        (physicalDataAttributes), either:
          a) resolve them and embed into the parent entity's summaryFields.attributes, OR
          b) embed attributes directly from the stored parent entity attribute list.
        In both cases, the expand-resolve response MUST include attributes for PDEs.

  4_gateway_prompt_injection_must_show_attributes:
    gateway:
      - When injecting highlighted feature context into the Planner prompt, ensure that for each
        physical data entity in resolved context the attribute list is included in the prompt
        (directly or via condensed DTOs).
      - Add a safeguard: if any selected physical data entity resolves without attributes at
        depth>=1, log an error and include a visible warning line in the prompt indicating
        which entity ids are missing attributes.

  5_tests_regression:
    - Add/extend tests so this cannot regress:
      a) Model service: expand-resolve called with a physical data entity at depth=1 returns
         resolved entity with summaryFields.attributes length > 0.
      b) Gateway: when receiving structured selections, gateway uses expand-resolve and the
         injected prompt contains at least one attribute name for a PDE.
      c) Persistence: saving and reloading a feature context preserves bundle_type and depth.

acceptance_criteria:
  - Selecting physical data entities with depth=1 results in Planner LLM context that includes
    each table/entity name and its attributes (column name + type at minimum).
  - Selecting depth=2 includes attributes and additional relationship/related context subject
    to bounds.
  - Navigating away and returning does not lose bundle_type/depth; the same attributes remain
    visible in subsequent Planner turns.
  - Existing projects with old saved context continue to load and work using defaults.

non_goals:
  - No manual relationship selection UI
  - No new bundle types beyond those already defined
  - No changes to orchestration/executor API calls

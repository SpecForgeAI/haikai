# Context Picker Iteration 4 — Condensed Context DTOs for Planner LLM (Compact, LLM-Shaped Payloads)

title: Context Picker Iteration 4 — Condensed Context DTOs for Planner LLM (Compact, LLM-Shaped Payloads)

context:
  The Implement Assistant currently injects expanded/resolved context as generic entity lists,
  diagrams, and relationship metadata. While correct, this payload can be verbose and not
  optimally shaped for LLM reasoning. To improve token efficiency and semantic clarity, the
  highlighted context sent to the Planner LLM should be transformed into compact, purpose-built
  "Condensed Context DTOs" that summarize architecture slices (data entities, interface contracts,
  and service slices) in a structured and consistent format.

goal:
  Produce and inject condensed, LLM-shaped context payloads derived from the expanded+resolved
  bundle context, replacing (or augmenting) generic resolved lists in the Planner prompt with a
  compact DTO array that is easier for the LLM to consume.

scope:
  - Gateway: transform expanded+resolved context into condensed DTOs and inject into prompts
  - architecture-model-service: no required changes if existing expand-resolve output includes
    enough information; only extend if essential fields are missing
  - Frontend: no changes required
  - Applies to mode=implement_feature, phase=refine highlighted context injection
  - No changes to bundle selection UI or expansion rules

dto_set_v1:
  The Gateway MUST produce an array of DTO objects. Each DTO MUST have:
    - kind: string
    - id: string (stable within DTO kind)
    - title/name fields as applicable
    - compact fields suitable for LLM consumption

  DTO kinds (v1):
    1) entity_and_attributes
    2) interface_contract
    3) service_slice
    4) diagram_summary (minimal)

dto_definitions:
  1) entity_and_attributes:
    - Represents a logical or physical data entity with key attributes and direct relationships.
    - Shape:
      {
        "kind": "entity_and_attributes",
        "id": "<entityType>::<entityId>",
        "entity_type": "physical_data_entity" | "logical_data_entity" | "other",
        "name": "<entity name/table name>",
        "attributes": [
          { "name": string, "type": string, "pk": boolean?, "nullable": boolean? }
        ],
        "relationships": [
          { "type": string, "to": string, "via": string?, "cardinality": string? }
        ]
      }

  2) interface_contract:
    - Represents an interface with endpoints and referenced schemas/entities.
    - Shape:
      {
        "kind": "interface_contract",
        "id": "<interfaceId>",
        "name": "<interface name>",
        "endpoints": [
          { "name": string, "input": string?, "output": string?, "notes": string? }
        ],
        "schemas": [ "<schema/entity name>", ... ],
        "key_relationships": [
          { "from": string, "to": string, "type": string, "notes": string? }
        ]
      }

  3) service_slice:
    - Represents a service with its surrounding structural context (parents/children) and key artefacts.
    - Shape:
      {
        "kind": "service_slice",
        "id": "<serviceId>",
        "application": string?,
        "component": string?,
        "service": string,
        "interfaces": [ string ],
        "endpoints": [ string ],
        "key_entities": [ string ],
        "dependencies": [
          { "type": string, "target": string, "notes": string? }
        ]
      }

  4) diagram_summary:
    - Minimal diagram metadata useful for reference.
    - Shape:
      {
        "kind": "diagram_summary",
        "id": "<diagramId>",
        "name": string,
        "diagram_type": string,
        "referenced_entities": [ string ]
      }

requirements:
  gateway_transformation:
    - When mode=implement_feature and phase=refine and highlighted context exists:
        - Call the existing expand-resolve endpoint (Iteration 2/3 output).
        - Transform the response into condensed DTOs:
            - Create entity_and_attributes DTOs for included data entities.
            - Create interface_contract DTOs for included interfaces (if endpoints/schemas included).
            - Create service_slice DTOs for included services (if parent/child bundle used).
            - Create diagram_summary DTOs for included diagrams.
        - De-duplicate DTOs (stable id).
        - Ensure DTOs are compact and avoid repeating full entity records across multiple DTOs.

  gateway_prompt_injection:
    - Replace the verbose "HIGHLIGHTED FEATURE CONTEXT" content with:
        - A single "HIGHLIGHTED FEATURE CONTEXT (CONDENSED)" section containing:
            - A short intro sentence instructing the Planner to rely on the DTOs.
            - The DTO JSON array (pretty-printed, bounded).
    - The prompt MUST instruct the Planner LLM:
        - Use DTOs as the source of truth for names, attributes, endpoints, and relationships.
        - Avoid inventing entities/relationships not present in DTOs.
        - Ask clarification questions if DTOs are insufficient.

  token_bounding:
    - Implement a deterministic size cap for the injected DTO payload:
        - maxDtoCount (default 50)
        - maxJsonChars (default 40,000) or equivalent token-safe cap
    - If truncation occurs:
        - include a "truncated": true marker in the prompt header
        - prioritize keeping:
            1) interface_contract DTOs
            2) entity_and_attributes DTOs for entities referenced by endpoints
            3) service_slice DTOs
            4) remaining entities/diagrams

  architecture-model-service_extensions_if_needed:
    - If the expand-resolve response lacks required fields to build DTOs (e.g., endpoint input/output
      schema names, entity attribute lists, FK metadata), extend the expand-resolve response to include
      minimal additional fields needed for DTO construction.
    - Do not add verbose dumps; include only what is needed for DTO shaping.

acceptance_criteria:
  - With highlighted context including physical data entities:
      - The Planner prompt contains entity_and_attributes DTOs with entity names and attribute lists.
  - With highlighted context including an interface bundle with endpoints+schemas:
      - The Planner prompt contains an interface_contract DTO listing endpoints and schema names.
  - With highlighted context including a service bundle with parents/children:
      - The Planner prompt contains a service_slice DTO including application/component/service names
        and interface/endpoint lists where available.
  - The injected context is smaller and more readable than prior verbose resolved lists while retaining
    essential semantics.
  - If payload is too large, truncation is deterministic and clearly indicated.

non_goals:
  - No changes to how bundles are selected or stored
  - No changes to expansion rules themselves
  - No changes to phases or conversation persistence
  - No executor/orchestration changes

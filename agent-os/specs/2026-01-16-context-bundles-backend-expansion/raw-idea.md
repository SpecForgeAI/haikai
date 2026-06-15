# Context Picker Iteration 2 — Expand Context Bundles into Resolved Context (Backend Graph Logic)

## Context

The Context Picker now persists "Context Bundles" for selected items (entities/diagrams),
recording the user's intended scope (e.g., interface_with_endpoints_and_schemas). However,
the system still sends only the raw selected root IDs to the Planner LLM. This is insufficient
for feature discussions because the LLM lacks the associated items that give the selection
meaning (endpoints, schemas, attributes, parent/child structures, etc.). This iteration adds
backend expansion rules to turn bundle selections into an expanded set of entities/diagrams
and resolves them into human-readable context for injection into the Planner prompt.

## Goal

Implement backend bundle expansion logic that, given root selections with bundle_type, produces
an expanded, de-duplicated context set (entities + diagrams + relationships metadata) and returns
resolved names/types/fields. The frontend continues selecting roots + bundles; the backend performs
expansion automatically.

## Scope

- architecture-model-service: implement graph expansion and an API to expand+resolve context bundles
- gateway: call the new expand+resolve endpoint and inject the expanded resolved context
- frontend: no selection UX changes required (uses existing stored bundle selections)
- No condensed DTO payloads yet (keep resolved output broadly similar to existing resolved context)
- Relationship selection remains implicit (auto-included only when required by bundle rules)

## Inputs

- projectId (or the system's canonical project identifier)
- featureId/workItemId (optional; for logging only)
- context bundle selections:
    - selected_entities: [{ entity_type_key, entity_id, bundle_type }]
    - selected_diagrams: [{ diagram_id, bundle_type }]

## Bundle Types Supported

- interface_only
- interface_with_endpoints
- interface_with_endpoints_and_schemas
- service_only
- service_with_parents_and_children
- entity_only
- entity_with_attributes_and_relationships
- diagram_only

## Requirements

### architecture-model-service_api

- Add a new endpoint to expand and resolve bundle selections in one call:
    POST /api/projects/{projectId}/implement-context/expand-resolve
  Request body:
    {
      "selected_entities": [
        { "entity_type": string, "entity_id": string, "bundle_type": string }
      ],
      "selected_diagrams": [
        { "diagram_id": string, "bundle_type": string }
      ]
    }
  Response body:
    {
      "expanded_entity_ids": [ "<canonicalType>::<id>", ... ],
      "expanded_diagram_ids": [ "diag-...", ... ],
      "resolved_entities": [
        {
          "id": string,
          "name": string,
          "type": string,
          "category": string,
          "summaryFields": object
        }
      ],
      "resolved_diagrams": [
        {
          "id": string,
          "name": string,
          "diagramType": string,
          "summaryFields": object
        }
      ]
    }
- The service MUST canonicalize/normalize entity_type keys to existing resolver canonical types.

### architecture-model-service_expansion_rules

- Expansion MUST be deterministic, de-duplicated, and bounded.

#### interfaces

- interface_only:
    - include: the interface entity only
- interface_with_endpoints:
    - include: interface + its endpoints
- interface_with_endpoints_and_schemas:
    - include: interface + endpoints
    - include: schema/data entities referenced by endpoint inputs/outputs (logical and/or physical as modelled)
    - include: relationship metadata among included data entities when available (no explicit relationship node selection)

#### services

- service_only:
    - include: the service entity only
- service_with_parents_and_children:
    - include: service
    - include parents: application_component and application (if present in model)
    - include children: interfaces and endpoints belonging to those interfaces
    - include additional implementation structure if present and directly linked:
        - package sets, classes, methods (only if explicit relationships exist)

#### data_entities (physical/logical)

- entity_only:
    - include: the entity only
- entity_with_attributes_and_relationships:
    - include: entity
    - include: attributes in resolved summaryFields
    - include: direct relationships (e.g., FKs/associations) in resolved summaryFields where available
    - do NOT traverse multi-hop by default (depth=1 only)

#### diagrams

- diagram_only:
    - include: the diagram
    - include referenced entities if the existing diagram model exposes node references (optional but recommended)
    - do not automatically expand beyond referenced nodes unless they are already included by other bundles

#### bounding_and_safety

- Implement hard limits to prevent runaway expansion:
    - maxExpandedEntities (configurable, default 250)
    - maxExpandedDiagrams (configurable, default 50)
- If limits are exceeded:
    - truncate deterministically (stable ordering)
    - include a warning flag in response summaryFields (e.g., "truncated": true)

### gateway_integration

- For mode=implement_feature, phase=refine (and optionally phase=bootstrap when highlighted selections exist):
    - Read the stored context selections including bundle_type.
    - Call expand-resolve endpoint.
    - Inject the returned resolved_entities/resolved_diagrams into the Planner system prompt as:
        "HIGHLIGHTED FEATURE CONTEXT"
- Continue existing behavior when no selections exist.

### frontend_integration

- Ensure saved context selections include:
    - entity_type (canonical or mappable)
    - entity_id
    - bundle_type
  so the gateway can pass them to expand-resolve.
- No UI changes required beyond ensuring bundle_type is present (from Iteration 1).

## Acceptance Criteria

- Selecting an interface with bundle interface_with_endpoints_and_schemas results in the expanded
  resolved context including:
    - the interface name
    - endpoint names
    - referenced schema/data entity names
- Selecting physical data entities with entity_with_attributes_and_relationships results in the
  resolved context including:
    - entity/table names
    - attribute lists (at least name/type)
    - direct relationship metadata when present
- Selecting a service with service_with_parents_and_children includes:
    - application + component parents (if present)
    - interfaces/endpoints children (if present)
- Expanded context is de-duplicated and bounded; the system remains responsive.

## Non-Goals

- No condensed LLM DTO payload format yet (keep resolved summaries similar to current resolver output)
- No explicit relationship selection UI
- No multi-hop relationship expansion beyond defined rules (depth=1 for entities)
- No persistence/status tracking changes

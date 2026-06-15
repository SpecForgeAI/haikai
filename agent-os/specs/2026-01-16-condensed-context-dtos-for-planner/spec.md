# Specification: Condensed Context DTOs for Planner LLM

## Goal
Transform expanded/resolved architecture context into compact, LLM-shaped DTOs that improve token efficiency and semantic clarity for the Planner LLM during the refine phase of implement_feature mode.

## User Stories
- As a Planner LLM, I want to receive architecture context in a compact, structured DTO format so that I can reason about entities, interfaces, and relationships without parsing verbose generic lists.
- As a developer, I want the highlighted context to be token-bounded and deterministically truncated so that LLM costs remain predictable and within limits.

## Specific Requirements

**Gateway Transformation Trigger Conditions**
- Apply condensed DTO transformation when ALL conditions are met: mode=implement_feature, phase=refine, and highlighted context exists (resolvedContext is not null/empty)
- For bootstrap and handoff phases, continue using existing formatting logic without condensed DTOs
- The transformation must occur AFTER expand-resolve returns but BEFORE building the system prompt
- If no highlighted context exists, fall back to existing "No items highlighted by user" message

**DTO Kind: entity_and_attributes**
- Represents logical or physical data entities with their attributes and relationships
- Shape: `{ kind: "entity_and_attributes", id: "<entityType>::<entityId>", entity_type: "physical_data_entity" | "logical_data_entity", name: string, attributes: [...], relationships: [...] }`
- Extract attributes array from resolved_entities[].relevant_fields if present (name, type, pk, nullable)
- Extract relationships from resolved_relationships where this entity is from or to endpoint
- For each relationship include: type, to/from entity name, cardinality from summary_fields

**DTO Kind: interface_contract**
- Represents an interface with its endpoints and referenced schemas
- Shape: `{ kind: "interface_contract", id: "<interfaceId>", name: string, endpoints: [...], schemas: [...], key_relationships: [...] }`
- Populate endpoints array from resolved_entities where entity_type="endpoints" and interface matches
- Populate schemas array by collecting target names from resolved_relationships where type="schema_ref" and from=this interface
- Include endpoint details: name from relevant_fields, input/output schema names if available, notes from description

**DTO Kind: service_slice**
- Represents a service with its surrounding structural context
- Shape: `{ kind: "service_slice", id: "<serviceId>", application: string?, component: string?, service: string, interfaces: [...], endpoints: [...], key_entities: [...], dependencies: [...] }`
- Extract application/component names from resolved_relationships where type="contains" and to=this service
- Extract interfaces from resolved_relationships where type="exposes" and from=this service
- Include key_entities array populated from schema_ref relationships of child interfaces

**DTO Kind: diagram_summary**
- Minimal diagram metadata for reference
- Shape: `{ kind: "diagram_summary", id: "<diagramId>", name: string, diagram_type: string, referenced_entities: [...] }`
- Use resolved_diagrams[].referenced_entity_names (prefer names over IDs when available)
- Keep this DTO minimal; diagrams are low-priority for truncation

**Prompt Injection Format**
- Replace verbose "HIGHLIGHTED FEATURE CONTEXT" section with "HIGHLIGHTED FEATURE CONTEXT (CONDENSED)"
- Include instruction header: "The following DTOs summarize the architecture context highlighted for this feature. Use these as the source of truth for entity names, attributes, endpoints, and relationships. Do not invent entities or relationships not present in these DTOs."
- Output DTOs as a pretty-printed JSON array (2-space indent)
- If truncated=true, include header note: "[TRUNCATED: Some items omitted due to size limits]"

**Token Bounding Configuration**
- maxDtoCount: default 50 (configurable via gateway config)
- maxJsonChars: default 40,000 characters (configurable via gateway config)
- Truncation must be deterministic: same input always produces same output
- Apply truncation after building full DTO array but before JSON serialization

**Truncation Priority Order**
- Priority 1 (keep): interface_contract DTOs (most valuable for understanding API surface)
- Priority 2 (keep): entity_and_attributes DTOs for entities referenced by interface schemas
- Priority 3 (keep): service_slice DTOs
- Priority 4 (deprioritize): entity_and_attributes DTOs not referenced by interfaces
- Priority 5 (lowest): diagram_summary DTOs
- When truncating within a priority tier, remove items from the end of the sorted list

**De-duplication by Stable ID**
- Each DTO must have a stable id field unique within its kind
- For entity_and_attributes: use "entityType::entityId" format
- For interface_contract: use the interface ID
- For service_slice: use the service ID
- For diagram_summary: use the diagram ID
- If the same entity appears in multiple contexts (e.g., both as standalone and as part of service bundle), emit only ONE DTO with merged information

**Transformation Function Signature**
- Create new function: `buildCondensedContextDtos(expandResponse: ExpandResolveResponseDto): CondensedContextDto[]`
- Create helper: `formatCondensedContextSection(dtos: CondensedContextDto[], truncated: boolean): string`
- Export TypeScript interfaces for all DTO kinds in gateway/src/types/chat.ts
- Add condensedContextConfig to gateway config for maxDtoCount and maxJsonChars

## Existing Code to Leverage

**gateway/src/services/promptBuilder.ts - formatHighlightedContext()**
- Currently formats resolved context as human-readable text with entities, diagrams, and relationships
- Replace calls to this function with new condensed DTO formatter when conditions are met
- Reuse the groupRelationshipsByType() helper for relationship organization

**gateway/src/types/chat.ts - ExpandResolveResponseDto**
- Already defines resolved_entities, resolved_diagrams, and resolved_relationships arrays
- ResolvedEntitySummary has id, name, entity_type, category, relevant_fields
- ResolvedRelationship has id, type, from/to endpoints with entity_type/entity_id/name, summary_fields
- Use these existing types as input to the DTO transformation

**gateway/src/services/architectureModelClient.ts - tryResolveImplementContextWithBundles()**
- Already handles bundle-based context expansion and returns ExpandResolveResponseDto
- No changes needed to this function; condensed DTO transformation happens downstream

**architecture-model-service ContextBundleExpansionService**
- Already returns rich resolved_relationships with cardinality, relationship_type, description in summary_fields
- Relationship types (fk, association, schema_ref, contains, exposes) map directly to DTO relationship fields
- No backend changes required if current expand-resolve output is sufficient

**gateway/src/config.ts**
- Add new config fields: condensedContext.maxDtoCount, condensedContext.maxJsonChars
- Follow existing config pattern with defaults and environment variable overrides

## Out of Scope
- No changes to bundle selection UI or Context Picker Modal
- No changes to entity/diagram expansion rules in ContextBundleExpansionService
- No changes to bootstrap phase prompt or product/meta-model summary fetching
- No changes to handoff phase prompt or handoff plan validation
- No changes to conversation persistence or transcript writing
- No changes to phases, phase transitions, or workflow state machine
- No executor, orchestration, or spec generation logic changes
- No frontend changes of any kind
- No backend (architecture-model-service) changes unless expand-resolve is missing critical fields
- No changes to how entityIds/diagramIds are stored or passed from frontend

## Data Flow Diagram

```
                                    Gateway (chat.ts)
                                          |
                                          v
                    +---------------------+---------------------+
                    |  tryResolveImplementContextWithBundles()  |
                    |         (architectureModelClient.ts)      |
                    +---------------------+---------------------+
                                          |
                                          v
                    +---------------------------------------------+
                    |         ExpandResolveResponseDto            |
                    |  - resolved_entities[]                      |
                    |  - resolved_diagrams[]                      |
                    |  - resolved_relationships[]                 |
                    |  - truncated, truncation_reason             |
                    +---------------------------------------------+
                                          |
                                          v
                    +---------------------------------------------+
                    |       buildCondensedContextDtos()           |
                    |         (NEW - promptBuilder.ts)            |
                    |                                             |
                    |  1. Group entities by type                  |
                    |  2. Build interface_contract DTOs           |
                    |  3. Build service_slice DTOs                |
                    |  4. Build entity_and_attributes DTOs        |
                    |  5. Build diagram_summary DTOs              |
                    |  6. De-duplicate by stable id               |
                    |  7. Apply truncation priority               |
                    +---------------------------------------------+
                                          |
                                          v
                    +---------------------------------------------+
                    |      formatCondensedContextSection()        |
                    |                                             |
                    |  - Add instruction header                   |
                    |  - JSON.stringify(dtos, null, 2)           |
                    |  - Add truncation warning if needed         |
                    |  - Enforce maxJsonChars limit               |
                    +---------------------------------------------+
                                          |
                                          v
                    +---------------------------------------------+
                    |         buildSystemPrompt()                 |
                    |                                             |
                    |  Inject condensed context section into      |
                    |  IMPLEMENT_PLANNER_PROMPT_TEMPLATE          |
                    |  replacing {resolvedContext} placeholder    |
                    +---------------------------------------------+
                                          |
                                          v
                              LLM Request with compact DTOs
```

## Acceptance Criteria

- With highlighted context including physical data entities: the Planner prompt contains entity_and_attributes DTOs with entity names and attribute lists from relevant_fields
- With highlighted context including an interface bundle with endpoints and schemas: the Planner prompt contains an interface_contract DTO listing endpoint names and schema entity names
- With highlighted context including a service bundle with parents and children: the Planner prompt contains a service_slice DTO including application/component/service names and interface/endpoint lists
- The injected context JSON is smaller (character count) than prior verbose formatHighlightedContext output while retaining essential semantic information
- If payload exceeds maxJsonChars (40,000), truncation occurs and "[TRUNCATED]" marker appears in the prompt
- Truncation is deterministic: given identical expand-resolve input, the same DTOs are kept/removed
- DTOs are de-duplicated: no duplicate entries with the same id within a kind
- Existing phase behaviors (bootstrap, handoff) are unchanged and do not receive condensed DTOs
- mode=oas_assistant conversations are unaffected
- All new code has corresponding unit tests verifying DTO shape, truncation, and de-duplication

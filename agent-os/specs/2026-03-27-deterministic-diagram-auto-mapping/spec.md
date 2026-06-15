# Specification: Deterministic Diagram Auto-Mapping Engine (Increment 5)

## Goal
Implement a deterministic, non-AI mapping engine that takes a rendered `TemporaryArchitectureDiagram` (from Increment 4) and resolves it to the architecture meta-model by matching nodes to entities, attributes to attributes, and edges to relationships -- producing mapping result data only, without performing native diagram conversion or persistence.

## User Stories
- As a diagram viewer, I want temporary diagram elements to be automatically matched against the architecture meta-model immediately after loading so that mapping results are available for subsequent processing without requiring a manual step.
- As a future increment consumer, I want categorized match/unmatch status with specific reason codes for every node, attribute, and edge so that I can deterministically decide which elements can be converted to native diagram objects and which require attention.

## Specific Requirements

**Mapping Result Type Definitions**
- Define a `DiagramMappingResult` interface containing per-node, per-attribute, and per-edge mapping records plus summary counts
- Each mapping record holds the temporary element ID, matched meta-model ID (or `null`), and a status of `'matched'` or `'unmatched'` with an optional reason code
- Define reason code union type: `'no_entity_match'` | `'no_attribute_match'` | `'no_relationship_match'` | `'invalid_node_reference'` | `'invalid_edge_reference'` | `'mode_mismatch'`
- Include an overall status enum: `'fully_matched'` | `'partially_matched'` | `'no_matches'`
- Summary section tracks total/matched/unmatched counts broken down by element category (nodes, attributes, edges)

**Mode-Specific Data Source Selection**
- When `view_mode === 'LOGICAL'`: resolve entities from `metaModel.entities.logical_data_entities`, attributes from `metaModel.entities.logical_data_attributes` (filtered by `logical_entity_id`), and relationships from `metaModel.relationships.logical_data_entity_relationships`
- When `view_mode === 'PHYSICAL'`: resolve entities from `metaModel.entities.physical_data_entities`, attributes from `metaModel.entities.physical_data_attributes` (filtered by `physical_entity_id`)
- If a node's `semantic_type` does not align with the diagram's `view_mode` (e.g., `LOGICAL_DATA_ENTITY` in a `PHYSICAL` diagram), flag with `mode_mismatch` reason code
- Use `DIAGRAM_NODE_ENTITY_TYPE_MAP` from `entityTypeRegistry.ts` to validate `semantic_type` against expected collection keys

**Entity Matching (Step 1 of 3)**
- For each `TemporaryArchitectureDiagramNode`, compare `ref_name` against entity `name` in the view-mode-appropriate collection
- Matching is strict: case-sensitive, no trimming, no lowercasing, no Unicode normalization -- exact string equality only
- On match, record the temporary node `id` mapped to the meta-model entity `id`
- On no match, record with reason code `no_entity_match`
- Build a name-to-entity-ID index (Map) from the meta-model entity collection before iterating nodes for O(1) lookups

**Attribute Matching (Step 2 of 3)**
- Only run for nodes that matched an entity in Step 1
- For each `TemporaryArchitectureDiagramCompartmentItem` (where `item_kind === 'ATTRIBUTE'`), compare `ref_name` against attribute `name` within the scope of the matched parent entity
- LOGICAL mode: filter `logical_data_attributes` where `logical_entity_id === matchedEntityId`, then match by `name`
- PHYSICAL mode: filter `physical_data_attributes` where `physical_entity_id === matchedEntityId`, then match by `name`
- Pre-index attributes by parent entity ID into a `Map<entityId, Map<attrName, attrId>>` for O(1) lookups
- If the parent node was unmatched, skip its compartment items entirely (they inherit the parent's unmatched status, do not create separate records for them)

**Relationship Matching (Step 3 of 3)**
- For each `TemporaryArchitectureDiagramEdge`, first validate that `source_node_id` and `target_node_id` reference nodes present in the temporary diagram; flag `invalid_node_reference` if not
- Next, check that both referenced source and target nodes resolved to matched entities in Step 1; if either is unmatched, flag with `no_relationship_match`
- Construct DEP IDs from the matched entity IDs using `DATA_ENTITY_POINT_PREFIXES` (e.g., `dep_log_<entityId>` for LOGICAL, `dep_phy_<entityId>` for PHYSICAL)
- Search `logical_data_entity_relationships` for a record where `fromDataEntityPointId`/`toDataEntityPointId` match the constructed pair -- check both directions (A->B and B->A) since directionality in the temporary diagram may not match the stored direction
- `source_item_ref_name` and `target_item_ref_name` on edges are informational only; do not use them as matching criteria
- On match, record the temporary edge `id` mapped to the meta-model relationship `id`

**Pure Function Architecture**
- Implement the mapping engine as a pure function (or set of composable pure functions) in a new utility module at `frontend/src/utils/temporaryDiagramMapping.ts`
- Signature: `mapTemporaryDiagram(diagram: TemporaryArchitectureDiagram, metaModel: MetaModel): DiagramMappingResult`
- No React hooks, no side effects, no DOM access -- enabling straightforward Vitest unit testing
- Internal helper functions for each step: `mapEntities`, `mapAttributes`, `mapRelationships`

**Performance: Pre-Indexing by Name**
- Before iterating temporary diagram elements, build lookup indexes from the MetaModel collections
- Entity index: `Map<string, string>` keyed by entity `name`, valued by entity `id`
- Attribute index: `Map<string, Map<string, string>>` keyed by parent entity `id`, then by attribute `name`, valued by attribute `id`
- Relationship index: `Map<string, LogicalDataEntityRelationship[]>` keyed by a canonical key derived from the sorted pair of DEP IDs, to support bidirectional lookup
- These indexes ensure the mapping engine scales linearly with diagram size, not quadratically with meta-model size

**Integration into DiagramsView**
- Extend `TemporaryDiagramState` interface with a new `mappingResult: DiagramMappingResult | null` field (default `null`)
- After the existing `fetchTemporaryDiagram` promise resolves with data (in the useEffect at ~line 691), invoke the mapping engine and store the result in state alongside the diagram data
- Access `MetaModel` via `useArchitecture()` which is already available in `DiagramsView`
- Do not block rendering on mapping -- set diagram data first, then compute and set mapping result synchronously (the mapping is CPU-only and expected to be fast for typical diagram sizes)

**Error Handling**
- If `diagram_kind` is not `'ER'` or `source_architecture_domain` is not `'DATA'`, return a `DiagramMappingResult` with all elements flagged as `mode_mismatch` and overall status `no_matches`
- If MetaModel entity/relationship collections are empty or undefined, handle gracefully with defensive checks (treat as no matches, not as errors)
- The mapping engine must never throw; all error conditions are expressed through the result data structure

**Unit Tests**
- Test the pure mapping function with Vitest
- Cover: fully matched diagram, partially matched diagram, completely unmatched diagram, empty diagram, empty meta-model, mixed LOGICAL/PHYSICAL mode_mismatch, bidirectional relationship matching, invalid node references on edges

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**`frontend/src/utils/entityTypeRegistry.ts` -- Entity type to collection key mapping**
- `DIAGRAM_NODE_ENTITY_TYPE_MAP` maps `semantic_type` strings (e.g., `'LOGICAL_DATA_ENTITY'`) to `MetaModelEntities` keys (e.g., `'logical_data_entities'`)
- Use this to validate that a node's `semantic_type` is recognized and to look up the correct entity collection
- Already imported by rendering.ts and validation.ts, so the pattern is well-established

**`frontend/src/utils/dataEntityPointOptions.ts` -- DEP ID construction and parsing**
- `DATA_ENTITY_POINT_PREFIXES` constants (`dep_log_`, `dep_phy_`) for constructing DEP IDs from matched entity IDs during relationship matching
- `generateDataEntityPointId(entityType, entityId)` constructs complete DEP IDs from type and entity ID
- `parseDepId()` parses DEP IDs back to type and entity ID -- useful if needed for validation

**`frontend/src/utils/rendering.ts` -- Entity lookup pattern (reverse direction needed)**
- `getEntityLabel()` resolves entity ID to name via `entityTypeMap` and `entities[arrayKey].find(e => e.id === entityId)`
- The mapping engine needs the reverse: name to ID -- build a `Map<name, id>` index instead of iterating with `.find()`
- Follows the same `model.metaModel.entities[collectionKey]` access pattern

**`frontend/src/components/DiagramsView/DiagramsView.tsx` -- Integration point**
- `TemporaryDiagramState` interface (line ~536) is the state structure to extend with `mappingResult`
- The `useEffect` at ~line 691 that calls `fetchTemporaryDiagram` is where mapping execution hooks in after data loads
- `useArchitecture()` is already called at line ~562, providing access to MetaModel

**`frontend/src/types/temporaryArchitectureDiagram.ts` -- Input contract**
- Defines `TemporaryArchitectureDiagram`, `TemporaryArchitectureDiagramNode`, `TemporaryArchitectureDiagramEdge`, `TemporaryArchitectureDiagramCompartmentItem`
- Key fields for matching: `ref_name` on nodes and compartment items, `source_node_id`/`target_node_id`/`source_ref_name`/`target_ref_name` on edges
- `view_mode` on the root diagram determines LOGICAL vs PHYSICAL data source selection

## Out of Scope
- Fuzzy matching, partial matching, or heuristic name suggestions for unmatched elements
- Automatic correction or normalization of unmatched names (trimming, lowercasing, etc.)
- Architecture model mutation (creating, updating, or deleting entities, attributes, or relationships)
- Native diagram conversion (creating `Diagram`, `DiagramNode`, or `DiagramEdge` objects from mapping results)
- Persistence of mapping results to the backend or any API calls
- Support for non-ER diagram kinds (`SEQUENCE`, `ACTIVITY`, `STATE`, `UI_WORKFLOW`, etc.)
- UI for reviewing, correcting, or approving mapping results (deferred to a separate increment)
- Attribute-level relationship matching (edges match at entity level only; `source_item_ref_name` / `target_item_ref_name` are informational)
- Physical-mode relationship matching beyond `logical_data_entity_relationships` (the same relationship collection is used for both modes since relationships use polymorphic DEP IDs)
- Performance optimization for diagrams with more than 500 nodes (not an expected use case for LLM-generated diagrams)

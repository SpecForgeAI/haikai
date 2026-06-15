# Spec Requirements: Deterministic Diagram Auto-Mapping Framework (Increment 5)

## Initial Description

Implement a deterministic, non-AI mapping engine that takes a rendered TemporaryArchitectureDiagram (from Increment 4) and resolves it to the architecture meta-model by matching nodes to entities, attributes to attributes, and edges to relationships.

This is Increment 5 in a series:
- Increment 1: Contract definition (complete)
- Increment 2: Architect task framework (complete)
- Increment 3: MCP endpoint for saving (complete)
- Increment 4: Render temporary diagrams (complete)
- Increment 5: Deterministic auto-mapping framework (THIS increment)

## Requirements Discussion

### First Round Questions

**Q1:** I see that `LogicalDataEntityRelationship` uses `fromDataEntityPointId` and `toDataEntityPointId` in the format `dep_log_<entityId>` or `dep_phy_<entityId>` rather than direct entity IDs. When the mapping engine resolves edges, should we construct DataEntityPoint IDs to find matching relationships, or match on some other criteria?

**Answer:** Match relationships by the architecture relationship records themselves after entity matching, not by reconstructing or depending on DataEntityPoint IDs as the primary matching mechanism. If those DEP-style endpoint IDs are needed later for final native conversion, derive them after a relationship has been deterministically identified, not during initial matching.

**Q2:** The temporary diagram contract supports `source_item_ref_name` and `target_item_ref_name` on edges for attribute-level relationships. However, the native `LogicalDataEntityRelationship` only has entity-level endpoints. Are attribute-level ref_names used only for visual annotation, or are there attribute-level relationship structures?

**Answer:** For this increment, treat `source_item_ref_name` / `target_item_ref_name` as temporary-diagram detail and optional matching aids only. Do not require attribute-level relationship identity in the meta-model if the native relationship model is entity-level only.

**Q3:** Where in the flow should mapping execute? Should it run automatically on load, or as a separate user-triggered action?

**Answer:** Run mapping automatically immediately after the temporary diagram loads, so the mapping result is always available for the next step without requiring a separate user-triggered action.

**Q4:** The raw idea says "resolves to the architecture meta-model." For this increment, are we building only the mapping engine and its result data structure, or also performing actual conversion to native diagram format?

**Answer:** Correct -- this increment outputs mapping data only (matched/unmatched entities, attributes, and relationships plus summary state) and does NOT perform native diagram conversion or persistence.

**Q5:** When a temporary diagram node's `ref_name` does not match any entity name in the meta-model, should we flag it as "unmatched" with categorized reasons, or is a simple matched/unmatched boolean sufficient?

**Answer:** Include categorized unmatched reasons, not just a boolean status. At minimum support reason codes such as `no_entity_match`, `no_attribute_match`, `no_relationship_match`, `invalid_node_reference`, `invalid_edge_reference`, and `mode_mismatch` to make Increment 6 clearer.

**Q6:** The temporary diagram contract says ref_name must match exactly. Should matching be case-sensitive and exact, or should we build in any tolerance?

**Answer:** Use strict exact match with case sensitivity and no normalization beyond reading the stored strings as-is. Do not trim, lowercase, or otherwise transform names in this increment.

**Q7:** The temporary diagram contract currently supports only `diagram_kind: 'ER'` with `source_architecture_domain: 'DATA'` and `view_mode: 'LOGICAL' | 'PHYSICAL'`. Is this increment ER-only?

**Answer:** Yes -- this increment is ER only, supporting both LOGICAL and PHYSICAL `view_mode` values.

**Q8:** Is there anything explicitly out of scope for this increment?

**Answer:** Explicitly keep the following out of scope: fuzzy matching, heuristic suggestions, automatic correction, architecture model mutation, final native diagram creation, persistence of finalized mappings, and support for non-ER diagram kinds.

### Existing Code to Reference

**Similar Features Identified:**

- Feature: DataEntityPoint utilities - Path: `frontend/src/utils/dataEntityPointOptions.ts`
  - `parseDepId()` and `resolveDepEntityName()` for DEP ID parsing and entity name resolution
  - `DATA_ENTITY_POINT_PREFIXES` constants (`dep_log_`, `dep_phy_`) for constructing DEP IDs post-matching
  - Relevant for deriving DEP IDs AFTER relationship matching (not as the primary matching mechanism)

- Feature: Entity Type Registry - Path: `frontend/src/utils/entityTypeRegistry.ts`
  - `DIAGRAM_NODE_ENTITY_TYPE_MAP` maps entity_type strings (e.g., `'LOGICAL_DATA_ENTITY'`) to MetaModelEntities collection keys (e.g., `'logical_data_entities'`)
  - Essential for looking up entities by semantic_type from the temporary diagram

- Feature: Node Creation - Path: `frontend/src/utils/nodeCreation.ts`
  - `createDiagramNodeFromEntity()` creates native `DiagramNode` from entity_type + entity_id
  - Pattern reference for future Increment 6 (native diagram conversion), not directly used in this increment

- Feature: Entity Label Resolution - Path: `frontend/src/utils/rendering.ts`
  - `getEntityLabel()` resolves entity names from entity_type + entity_id via MetaModelEntities
  - Pattern for entity lookups; this increment needs the reverse (name to ID)

- Feature: Temporary Diagram Rendering - Path: `frontend/src/components/DiagramsView/TemporaryDiagramRenderer.tsx`
  - Current SVG renderer for TemporaryArchitectureDiagram payloads
  - Does NOT perform meta-model lookups; all data is self-contained
  - Integration point: mapping runs after this data is loaded

- Feature: Temporary Diagram Context - Path: `frontend/src/contexts/TemporaryDiagramContext.tsx`
  - `TemporaryDiagramRequest` and activation mechanism
  - `useTemporaryDiagramContext()` hook consumed by DiagramsView

- Feature: Temporary Diagram State in DiagramsView - Path: `frontend/src/components/DiagramsView/DiagramsView.tsx` (lines ~540-720)
  - `TemporaryDiagramState` interface with `active`, `projectId`, `temporaryDiagramId`, `data`, `loading`, `error`
  - Mapping should integrate into this state management (e.g., adding mapping result alongside `data`)
  - The useEffect at ~line 692 that fetches data is where mapping should trigger after data loads

- Feature: Architecture Context - Path: `frontend/src/contexts/ArchitectureContext.tsx`
  - `useArchitecture()` provides access to the full `ArchitectureModel` including `metaModel.entities` and `metaModel.relationships`
  - The mapping engine needs the MetaModel to resolve names to IDs

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements

- **Entity Mapping (Nodes):** For each `TemporaryArchitectureDiagramNode`, match `ref_name` against entity names in the appropriate MetaModelEntities collection based on `view_mode`:
  - LOGICAL mode: match against `logical_data_entities[].name`
  - PHYSICAL mode: match against `physical_data_entities[].name`
  - Matching is strict exact-match, case-sensitive, no normalization
  - Produce a mapping record: temporary node ID -> matched entity ID (or unmatched reason code)

- **Attribute Mapping (Compartment Items):** For each `TemporaryArchitectureDiagramCompartmentItem` within a matched entity node, match `ref_name` against attribute names:
  - LOGICAL mode: match against `logical_data_attributes[].name` where `logical_entity_id` matches the parent entity
  - PHYSICAL mode: match against `physical_data_attributes[].name` where `physical_entity_id` matches the parent entity
  - Produce a mapping record: temporary compartment item ID -> matched attribute ID (or unmatched reason code)

- **Relationship Mapping (Edges):** For each `TemporaryArchitectureDiagramEdge`, after resolving source and target entity IDs via node mapping:
  - Look up `logical_data_entity_relationships` to find a relationship connecting the resolved source and target entities (via their `fromDataEntityPointId` / `toDataEntityPointId`)
  - `source_item_ref_name` / `target_item_ref_name` on edges are treated as optional detail, not required for matching
  - Produce a mapping record: temporary edge ID -> matched relationship ID (or unmatched reason code)

- **Mapping Result Data Structure:** Produce a comprehensive result containing:
  - Per-node mapping results (matched entity ID or categorized reason code)
  - Per-attribute mapping results (matched attribute ID or categorized reason code)
  - Per-edge mapping results (matched relationship ID or categorized reason code)
  - Summary counts (total nodes/attributes/edges, matched count, unmatched count per category)
  - Overall mapping status (e.g., fully matched, partially matched, no matches)

- **Categorized Unmatched Reason Codes:** At minimum:
  - `no_entity_match` -- node ref_name not found in meta-model
  - `no_attribute_match` -- attribute ref_name not found under matched entity
  - `no_relationship_match` -- no relationship found connecting resolved source and target entities
  - `invalid_node_reference` -- edge references a node ID not present in the temporary diagram
  - `invalid_edge_reference` -- edge structural validation failure
  - `mode_mismatch` -- view_mode does not align with semantic_type

- **Automatic Execution:** Mapping runs automatically immediately after temporary diagram data loads successfully (integrated into the existing `TemporaryDiagramState` lifecycle in DiagramsView)

- **Output Only (No Conversion):** This increment produces mapping data structures only. No native `Diagram`/`DiagramNode`/`DiagramEdge` objects are created. No meta-model entities are created or mutated.

### Reusability Opportunities

- `DIAGRAM_NODE_ENTITY_TYPE_MAP` from `entityTypeRegistry.ts` -- maps semantic_type strings to MetaModelEntities collection keys for entity lookups
- `parseDepId()` / `DATA_ENTITY_POINT_PREFIXES` from `dataEntityPointOptions.ts` -- for deriving DEP IDs from entity IDs after matching (needed for relationship endpoint comparison)
- `getEntityLabel()` pattern from `rendering.ts` -- reverse pattern: mapping needs name-to-ID lookup (build the reverse of this existing ID-to-name pattern)
- `TemporaryDiagramState` in `DiagramsView.tsx` -- extend this state to include mapping results
- `useArchitecture()` from `ArchitectureContext.tsx` -- provides MetaModel access needed by the mapping engine

### Scope Boundaries

**In Scope:**
- Pure mapping engine function(s) that take a `TemporaryArchitectureDiagram` and `MetaModel` as inputs and produce a typed mapping result
- Categorized reason codes for all unmatched items
- Support for both LOGICAL and PHYSICAL view modes for ER diagrams only
- Automatic execution after temporary diagram load
- Mapping result data structure definition (TypeScript interfaces)
- Integration into the existing `TemporaryDiagramState` lifecycle
- Unit tests for the mapping engine

**Out of Scope:**
- Fuzzy matching or heuristic suggestions
- Automatic correction of unmatched names
- Architecture model mutation (creating new entities/attributes/relationships)
- Final native diagram creation (conversion to `Diagram`/`DiagramNode`/`DiagramEdge`)
- Persistence of finalized mappings to backend
- Support for non-ER diagram kinds (SEQUENCE, ACTIVITY, STATE, etc.)
- UI for reviewing or correcting mapping results (may be a separate increment)

### Technical Considerations

- **Integration Point:** The mapping engine hooks into the existing `useEffect` in `DiagramsView.tsx` (~line 692) that fetches temporary diagram data. After `fetchTemporaryDiagram` resolves with data, the mapping engine runs against the current `MetaModel` from `useArchitecture()`
- **Key Data Structures for Entity Matching:**
  - `LogicalDataEntity { id, name }` -- matched by `name` when `view_mode === 'LOGICAL'`
  - `PhysicalDataEntity { id, name }` -- matched by `name` when `view_mode === 'PHYSICAL'`
- **Key Data Structures for Attribute Matching:**
  - `LogicalDataAttribute { id, name, logical_entity_id }` -- matched by `name` within parent entity when LOGICAL
  - `PhysicalDataAttribute { id, name, physical_entity_id }` -- matched by `name` within parent entity when PHYSICAL
- **Key Data Structures for Relationship Matching:**
  - `LogicalDataEntityRelationship { id, fromDataEntityPointId, toDataEntityPointId, cardinality?, relationship? }` -- matched by resolving entity IDs to DEP IDs and finding a relationship connecting source and target
  - DEP ID format: `dep_log_<entityId>` for logical entities, `dep_phy_<entityId>` for physical entities
  - Matching approach: after entity mapping resolves source/target entity IDs, construct DEP IDs and search `logical_data_entity_relationships` for a record where `fromDataEntityPointId`/`toDataEntityPointId` match the constructed pair (check both directions)
- **Strict Matching:** Case-sensitive exact string comparison. No trimming, lowercasing, or Unicode normalization.
- **Pure Function Design:** The mapping engine should be a pure function (or set of pure functions) in a utility module, separate from React component code, to enable straightforward unit testing
- **Framework:** React 18.x, TypeScript 5.x, Vitest for tests

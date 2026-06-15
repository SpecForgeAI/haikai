# Task Breakdown: Deterministic Diagram Auto-Mapping Engine (Increment 5)

## Overview
Total Tasks: 36
This is a pure frontend feature. All code lives under `frontend/src/`. Tests use Vitest.

## Task List

### Type Definitions

#### Task Group 1: Mapping Result Types and Reason Codes
**Dependencies:** None

- [x] 1.0 Complete mapping result type definitions
  - [x] 1.1 Write 4 focused tests for type structure validation
    - Test file: `frontend/src/utils/temporaryDiagramMapping.test.ts`
    - Test that `mapTemporaryDiagram` returns a result conforming to `DiagramMappingResult` shape (has `nodes`, `attributes`, `edges`, `summary`, `overallStatus` fields)
    - Test that an empty diagram + empty meta-model produces `overallStatus: 'no_matches'` with all counts at zero
    - Test that a non-ER diagram (`diagram_kind !== 'ER'`) returns all elements flagged as `mode_mismatch` with `overallStatus: 'no_matches'`
    - Test that a non-DATA source domain (`source_architecture_domain !== 'DATA'`) returns the same error result
  - [x] 1.2 Define `MappingReasonCode` union type
    - Type: `'no_entity_match' | 'no_attribute_match' | 'no_relationship_match' | 'invalid_node_reference' | 'invalid_edge_reference' | 'mode_mismatch'`
    - Define in: `frontend/src/utils/temporaryDiagramMapping.ts`
  - [x] 1.3 Define `MappingOverallStatus` union type
    - Type: `'fully_matched' | 'partially_matched' | 'no_matches'`
  - [x] 1.4 Define `NodeMappingRecord` interface
    - Fields: `temporaryNodeId: string`, `matchedEntityId: string | null`, `status: 'matched' | 'unmatched'`, `reasonCode?: MappingReasonCode`
  - [x] 1.5 Define `AttributeMappingRecord` interface
    - Fields: `temporaryItemId: string`, `parentTemporaryNodeId: string`, `matchedAttributeId: string | null`, `status: 'matched' | 'unmatched'`, `reasonCode?: MappingReasonCode`
  - [x] 1.6 Define `EdgeMappingRecord` interface
    - Fields: `temporaryEdgeId: string`, `matchedRelationshipId: string | null`, `status: 'matched' | 'unmatched'`, `reasonCode?: MappingReasonCode`
  - [x] 1.7 Define `MappingSummary` interface
    - Fields: `nodes: { total: number, matched: number, unmatched: number }`, `attributes: { total: number, matched: number, unmatched: number }`, `edges: { total: number, matched: number, unmatched: number }`
  - [x] 1.8 Define `DiagramMappingResult` interface
    - Fields: `nodes: NodeMappingRecord[]`, `attributes: AttributeMappingRecord[]`, `edges: EdgeMappingRecord[]`, `summary: MappingSummary`, `overallStatus: MappingOverallStatus`
  - [x] 1.9 Implement skeleton `mapTemporaryDiagram` function
    - Signature: `(diagram: TemporaryArchitectureDiagram, metaModel: MetaModel) => DiagramMappingResult`
    - Initial implementation: return empty result with `no_matches` status
    - Add early-return guard for non-ER `diagram_kind` or non-DATA `source_architecture_domain` -- return all elements flagged as `mode_mismatch`
    - Must never throw; all error conditions expressed via the result data structure
  - [x] 1.10 Ensure type definition tests pass
    - Run ONLY the 4 tests from 1.1
    - Command: `npx vitest run temporaryDiagramMapping.test.ts`

**Acceptance Criteria:**
- All 4 tests from 1.1 pass
- All interfaces and types are exported from `temporaryDiagramMapping.ts`
- The skeleton function handles error cases (non-ER, non-DATA) and empty inputs gracefully
- No runtime exceptions from the skeleton function under any input

---

### Index Builders

#### Task Group 2: Pre-Indexing Functions for O(1) Lookups
**Dependencies:** Task Group 1

- [x] 2.0 Complete index builder functions
  - [x] 2.1 Write 5 focused tests for index building
    - Test that `buildEntityNameIndex` for LOGICAL mode returns a `Map<string, string>` keyed by entity name, valued by entity ID, sourced from `metaModel.entities.logical_data_entities`
    - Test that `buildEntityNameIndex` for PHYSICAL mode returns a map from `physical_data_entities`
    - Test that `buildAttributeIndex` returns `Map<entityId, Map<attrName, attrId>>` correctly grouped by parent entity, for LOGICAL mode filtering on `logical_entity_id`
    - Test that `buildRelationshipIndex` builds a `Map<canonicalKey, LogicalDataEntityRelationship[]>` where the canonical key is derived from sorted DEP IDs, enabling bidirectional lookup
    - Test that all index builders handle empty/undefined collections gracefully (return empty Maps)
  - [x] 2.2 Implement `getEntityCollectionKey` helper
    - Given a `view_mode` string (`'LOGICAL'` or `'PHYSICAL'`), return the corresponding `MetaModelEntities` key (`'logical_data_entities'` or `'physical_data_entities'`)
    - Use `DIAGRAM_NODE_ENTITY_TYPE_MAP` from `entityTypeRegistry.ts` to validate `semantic_type` strings against expected collection keys
    - Return `null` for unrecognized view modes
  - [x] 2.3 Implement `buildEntityNameIndex`
    - Signature: `(entities: MetaModelEntities, viewMode: string) => Map<string, string>`
    - LOGICAL: iterate `logical_data_entities`, key by `name`, value is `id`
    - PHYSICAL: iterate `physical_data_entities`, key by `name`, value is `id`
    - Defensive: return empty Map if collection is undefined/empty
  - [x] 2.4 Implement `buildAttributeIndex`
    - Signature: `(entities: MetaModelEntities, viewMode: string) => Map<string, Map<string, string>>`
    - LOGICAL: iterate `logical_data_attributes`, group by `logical_entity_id`, then key by `name`, value is `id`
    - PHYSICAL: iterate `physical_data_attributes`, group by `physical_entity_id`, then key by `name`, value is `id`
    - Outer map key: parent entity ID; inner map key: attribute name; inner map value: attribute ID
  - [x] 2.5 Implement `buildRelationshipIndex`
    - Signature: `(relationships: MetaModelRelationships) => Map<string, LogicalDataEntityRelationship[]>`
    - Iterate `logical_data_entity_relationships`
    - For each relationship, extract entity IDs from `fromDataEntityPointId` and `toDataEntityPointId` using `parseDepId` from `dataEntityPointOptions.ts`
    - Build canonical key by sorting the two DEP IDs alphabetically and joining with `|` -- this ensures A->B and B->A both map to the same key
    - Group relationships under their canonical key (multiple relationships may connect the same entity pair)
  - [x] 2.6 Ensure index builder tests pass
    - Run ONLY the 5 tests from 2.1

**Acceptance Criteria:**
- All 5 tests from 2.1 pass
- Index builders produce correct Maps from sample MetaModel data
- Bidirectional relationship lookup works (A->B found when searching B->A)
- Empty/undefined input collections produce empty Maps without errors

---

### Mapping Engine: Entity Step

#### Task Group 3: Entity Matching (Step 1 of 3)
**Dependencies:** Task Group 2

- [x] 3.0 Complete entity mapping step
  - [x] 3.1 Write 5 focused tests for entity matching
    - Test that a node with `ref_name` exactly matching a logical entity name produces a `matched` record with the entity ID
    - Test that a node with `ref_name` not found in the meta-model produces an `unmatched` record with `no_entity_match` reason code
    - Test that matching is case-sensitive (e.g., `"Customer"` does not match `"customer"`)
    - Test that a node with `semantic_type: 'LOGICAL_DATA_ENTITY'` in a `PHYSICAL` view_mode diagram produces `mode_mismatch` reason code
    - Test that a node with `semantic_type: 'PHYSICAL_DATA_ENTITY'` in a `PHYSICAL` view_mode diagram matches against `physical_data_entities`
  - [x] 3.2 Implement `validateNodeSemanticType` helper
    - Given a node's `semantic_type` and the diagram's `view_mode`, determine if they are compatible
    - Use `DIAGRAM_NODE_ENTITY_TYPE_MAP` to resolve `semantic_type` to a collection key
    - LOGICAL mode expects `LOGICAL_DATA_ENTITY`; PHYSICAL mode expects `PHYSICAL_DATA_ENTITY`
    - Return `true` if compatible, `false` (mode_mismatch) otherwise
  - [x] 3.3 Implement `mapEntities` function
    - Signature: `(nodes: TemporaryArchitectureDiagramNode[], entityNameIndex: Map<string, string>, viewMode: string) => NodeMappingRecord[]`
    - For each node: validate semantic_type against view_mode (flag `mode_mismatch` if incompatible), then look up `ref_name` in entity name index
    - On match: record `{ temporaryNodeId: node.id, matchedEntityId, status: 'matched' }`
    - On no match: record `{ temporaryNodeId: node.id, matchedEntityId: null, status: 'unmatched', reasonCode: 'no_entity_match' }`
    - Strict exact string equality: no trimming, no lowercasing, no normalization
  - [x] 3.4 Wire `mapEntities` into `mapTemporaryDiagram`
    - Build entity name index via `buildEntityNameIndex`
    - Call `mapEntities` with diagram nodes and the index
    - Store results on the `DiagramMappingResult.nodes` field
    - Build a lookup Map from `temporaryNodeId -> matchedEntityId` for use by subsequent steps
  - [x] 3.5 Ensure entity mapping tests pass
    - Run ONLY the 5 tests from 3.1

**Acceptance Criteria:**
- All 5 tests from 3.1 pass
- Exact match semantics enforced (case-sensitive, no normalization)
- Mode mismatch correctly detected for cross-mode semantic types
- Node-to-entity lookup Map produced for downstream attribute and relationship steps

---

### Mapping Engine: Attribute Step

#### Task Group 4: Attribute Matching (Step 2 of 3)
**Dependencies:** Task Group 3

- [x] 4.0 Complete attribute mapping step
  - [x] 4.1 Write 4 focused tests for attribute matching
    - Test that a compartment item with `item_kind: 'ATTRIBUTE'` and `ref_name` matching an attribute under the matched parent entity produces a `matched` record
    - Test that an attribute `ref_name` not found under the matched parent entity produces `no_attribute_match`
    - Test that compartment items for unmatched parent nodes are entirely skipped (no records created for them)
    - Test PHYSICAL mode: attributes matched against `physical_data_attributes` filtered by `physical_entity_id`
  - [x] 4.2 Implement `mapAttributes` function
    - Signature: `(nodes: TemporaryArchitectureDiagramNode[], entityMappingLookup: Map<string, string>, attributeIndex: Map<string, Map<string, string>>) => AttributeMappingRecord[]`
    - For each node: check if node was matched (exists in `entityMappingLookup`); if unmatched, skip all its compartment items entirely
    - For matched nodes: iterate `compartments` -> `items` where `item_kind === 'ATTRIBUTE'`
    - Look up each item's `ref_name` in the attribute index under the matched entity ID
    - On match: record with `matchedAttributeId` and `status: 'matched'`
    - On no match: record with `reasonCode: 'no_attribute_match'`
  - [x] 4.3 Wire `mapAttributes` into `mapTemporaryDiagram`
    - Build attribute index via `buildAttributeIndex`
    - Call `mapAttributes` with nodes, entity mapping lookup, and attribute index
    - Store results on `DiagramMappingResult.attributes`
  - [x] 4.4 Ensure attribute mapping tests pass
    - Run ONLY the 4 tests from 4.1

**Acceptance Criteria:**
- All 4 tests from 4.1 pass
- Attributes for unmatched parent nodes are skipped (zero records)
- Attribute matching is scoped to the parent entity (not global)
- Both LOGICAL and PHYSICAL attribute matching works correctly

---

### Mapping Engine: Relationship Step

#### Task Group 5: Relationship Matching (Step 3 of 3)
**Dependencies:** Task Group 3 (needs entity mapping results)

- [x] 5.0 Complete relationship mapping step
  - [x] 5.1 Write 5 focused tests for relationship matching
    - Test that an edge connecting two matched nodes, where a relationship exists in the meta-model connecting those entities, produces a `matched` record with the relationship ID
    - Test that an edge whose `source_node_id` references a node ID not present in the temporary diagram produces `invalid_node_reference`
    - Test that an edge connecting two nodes where one is unmatched produces `no_relationship_match`
    - Test bidirectional matching: edge A->B matches a relationship stored as B->A in the meta-model
    - Test that `source_item_ref_name` and `target_item_ref_name` are ignored for matching purposes (informational only)
  - [x] 5.2 Implement `mapRelationships` function
    - Signature: `(edges: TemporaryArchitectureDiagramEdge[], nodeIdSet: Set<string>, entityMappingLookup: Map<string, string>, relationshipIndex: Map<string, LogicalDataEntityRelationship[]>, viewMode: string) => EdgeMappingRecord[]`
    - For each edge:
      1. Validate `source_node_id` and `target_node_id` exist in the temporary diagram's `nodeIdSet`; flag `invalid_node_reference` if not
      2. Check both source and target nodes resolved to matched entities via `entityMappingLookup`; flag `no_relationship_match` if either is unmatched
      3. Construct DEP IDs from matched entity IDs using `generateDataEntityPointId` from `dataEntityPointOptions.ts` (LOGICAL -> `'logical'`, PHYSICAL -> `'physical'`)
      4. Build canonical key (sorted DEP ID pair joined with `|`) and look up in relationship index
      5. On match: record with `matchedRelationshipId` (use first matching relationship) and `status: 'matched'`
      6. On no match: record with `reasonCode: 'no_relationship_match'`
  - [x] 5.3 Wire `mapRelationships` into `mapTemporaryDiagram`
    - Build node ID set from diagram nodes
    - Build relationship index via `buildRelationshipIndex`
    - Call `mapRelationships` with edges, node ID set, entity mapping lookup, relationship index, and view mode
    - Store results on `DiagramMappingResult.edges`
  - [x] 5.4 Ensure relationship mapping tests pass
    - Run ONLY the 5 tests from 5.1

**Acceptance Criteria:**
- All 5 tests from 5.1 pass
- Invalid node references detected before attempting entity lookup
- Bidirectional matching works (A->B matches B->A stored relationship)
- DEP IDs correctly constructed using `generateDataEntityPointId`
- `source_item_ref_name` / `target_item_ref_name` not used in matching logic

---

### Mapping Engine: Orchestrator

#### Task Group 6: Summary Computation and Orchestrator Finalization
**Dependencies:** Task Groups 3, 4, 5

- [x] 6.0 Complete orchestrator function
  - [x] 6.1 Write 4 focused tests for orchestrator and summary computation
    - Test fully matched diagram: all nodes, attributes, edges matched -> `overallStatus: 'fully_matched'`, all summary counts correct
    - Test partially matched diagram: some nodes matched, some not -> `overallStatus: 'partially_matched'`
    - Test completely unmatched diagram: no nodes match -> `overallStatus: 'no_matches'`, attribute and edge counts reflect skipped items
    - Test empty meta-model (empty entity/relationship collections): all elements unmatched, no errors thrown
  - [x] 6.2 Implement `computeSummary` function
    - Takes `nodes: NodeMappingRecord[]`, `attributes: AttributeMappingRecord[]`, `edges: EdgeMappingRecord[]`
    - Returns `MappingSummary` with `total`, `matched`, `unmatched` counts for each category
  - [x] 6.3 Implement `computeOverallStatus` function
    - Takes `MappingSummary`
    - If all totals are zero OR all matched counts are zero: `'no_matches'`
    - If all elements across all categories are matched: `'fully_matched'`
    - Otherwise: `'partially_matched'`
  - [x] 6.4 Finalize `mapTemporaryDiagram` orchestrator
    - Wire together: build indexes -> mapEntities -> mapAttributes -> mapRelationships -> computeSummary -> computeOverallStatus
    - Assemble and return the complete `DiagramMappingResult`
    - Verify the function never throws (wrap internal logic defensively if needed)
  - [x] 6.5 Ensure orchestrator tests pass
    - Run ONLY the 4 tests from 6.1

**Acceptance Criteria:**
- All 4 tests from 6.1 pass
- Summary counts are accurate for all element categories
- Overall status correctly reflects the mix of matched/unmatched elements
- The orchestrator never throws under any combination of inputs

---

### DiagramsView Integration

#### Task Group 7: Integration into DiagramsView Component
**Dependencies:** Task Group 6

- [x] 7.0 Complete DiagramsView integration
  - [x] 7.1 Write 2 focused tests for integration behavior
    - Test file: `frontend/src/components/DiagramsView/DiagramsView.test.tsx` (or colocated test)
    - Test that when `temporaryDiagramState.data` is set and the meta-model is available, `mappingResult` is populated on the state (not null)
    - Test that when `temporaryDiagramState.data` is null (not yet loaded), `mappingResult` remains null
  - [x] 7.2 Extend `TemporaryDiagramState` interface with `mappingResult` field
    - Add: `mappingResult: DiagramMappingResult | null` (default `null`)
    - Update `initialTemporaryDiagramState` to include `mappingResult: null`
    - Location: `frontend/src/components/DiagramsView/DiagramsView.tsx` (~line 536)
  - [x] 7.3 Add mapping execution after diagram data loads
    - In the `useEffect` at ~line 691 that calls `fetchTemporaryDiagram`:
    - After `setTemporaryDiagramState(prev => ({ ...prev, data, loading: false }))` in the `.then()` handler
    - Invoke `mapTemporaryDiagram(data, state.model.metaModel)` synchronously
    - Set the mapping result: `setTemporaryDiagramState(prev => ({ ...prev, data, loading: false, mappingResult: mapTemporaryDiagram(data, state.model.metaModel) }))`
    - Import `mapTemporaryDiagram` from `../../utils/temporaryDiagramMapping`
    - Access meta-model via `state.model.metaModel` (from `useArchitecture()` already called at line ~562)
  - [x] 7.4 Ensure mapping result resets when temporary diagram mode deactivates
    - Verify that `handleCloseTemporaryDiagram` resets to `initialTemporaryDiagramState` which includes `mappingResult: null`
    - Verify that the activation handler (`temporaryDiagramRequest` useEffect) sets `mappingResult: null`
  - [x] 7.5 Ensure integration tests pass
    - Run ONLY the 2 tests from 7.1

**Acceptance Criteria:**
- Both tests from 7.1 pass
- Mapping result is available on `temporaryDiagramState.mappingResult` immediately after diagram data loads
- Mapping result is null before data loads and after mode deactivation
- No blocking of diagram rendering (mapping runs synchronously after data is set)
- No new imports added beyond `mapTemporaryDiagram` and `DiagramMappingResult`

---

### Test Review and Verification

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 4 tests from Task Group 1 (type definitions and error guards)
    - Review the 5 tests from Task Group 2 (index builders)
    - Review the 5 tests from Task Group 3 (entity matching)
    - Review the 4 tests from Task Group 4 (attribute matching)
    - Review the 5 tests from Task Group 5 (relationship matching)
    - Review the 4 tests from Task Group 6 (orchestrator and summary)
    - Review the 2 tests from Task Group 7 (DiagramsView integration)
    - Total existing tests: 29 tests
  - [x] 8.2 Analyze test coverage gaps for THIS feature only
    - Identify any critical end-to-end workflows not covered
    - Check that mixed LOGICAL/PHYSICAL scenarios are adequately tested
    - Verify defensive handling of malformed inputs is tested (e.g., nodes with missing `compartments`, edges with missing fields)
    - Assess whether the relationship bidirectional matching is sufficiently covered for PHYSICAL mode DEP IDs
  - [x] 8.3 Write up to 8 additional strategic tests to fill gaps
    - Focus on integration-level scenarios combining multiple mapping steps
    - Potential gap tests:
      - End-to-end: full LOGICAL diagram with entities, attributes, and relationships all matching -- verify complete `DiagramMappingResult` structure
      - End-to-end: full PHYSICAL diagram with entities and attributes matching, relationships matching via `dep_phy_` prefixed DEP IDs
      - Edge case: node with empty `compartments` array (no attributes to map)
      - Edge case: node with compartments containing non-ATTRIBUTE `item_kind` items (should be skipped)
      - Edge case: multiple relationships between the same entity pair (first match used)
      - Edge case: self-referencing edge (source_node_id === target_node_id) with a self-relationship in meta-model
      - Defensive: `undefined` entity collections on MetaModel (not just empty arrays)
      - Defensive: diagram with zero nodes but some edges (all edges get `invalid_node_reference`)
  - [x] 8.4 Run all feature-specific tests
    - Run ONLY: `npx vitest run temporaryDiagramMapping.test.ts`
    - Expected total: approximately 29-37 tests
    - Do NOT run the entire application test suite
    - Verify all tests pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 29-37 tests total)
- Critical end-to-end workflows for both LOGICAL and PHYSICAL modes are covered
- Defensive edge cases for malformed/missing data are covered
- No more than 8 additional tests added
- Testing focused exclusively on this spec's mapping engine feature

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type Definitions** -- Establish the result types, reason codes, and skeleton function. All subsequent groups depend on these types.
2. **Task Group 2: Index Builders** -- Build the pre-indexing infrastructure needed by all three mapping steps. No dependency on mapping logic.
3. **Task Group 3: Entity Matching** -- First mapping step. Produces the entity lookup Map that attribute and relationship steps depend on.
4. **Task Group 4: Attribute Matching** -- Second mapping step. Depends on entity mapping results from Task Group 3.
5. **Task Group 5: Relationship Matching** -- Third mapping step. Depends on entity mapping results from Task Group 3 (parallel with Task Group 4 in principle, but sequential in the orchestrator).
6. **Task Group 6: Orchestrator** -- Wires all steps together with summary computation. Depends on Task Groups 3, 4, 5.
7. **Task Group 7: DiagramsView Integration** -- Minimal React integration. Depends on the completed orchestrator from Task Group 6.
8. **Task Group 8: Test Review** -- Final verification and gap filling. Depends on all prior groups.

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/utils/temporaryDiagramMapping.ts` | NEW -- Mapping engine module (all pure functions) |
| `frontend/src/utils/temporaryDiagramMapping.test.ts` | NEW -- All mapping engine tests (Vitest) |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | MODIFY -- Extend `TemporaryDiagramState`, add mapping call |
| `frontend/src/types/temporaryArchitectureDiagram.ts` | READ ONLY -- Input contract types |
| `frontend/src/types/model.ts` | READ ONLY -- MetaModel, entity, attribute, relationship types |
| `frontend/src/utils/entityTypeRegistry.ts` | READ ONLY -- `DIAGRAM_NODE_ENTITY_TYPE_MAP` for semantic_type validation |
| `frontend/src/utils/dataEntityPointOptions.ts` | READ ONLY -- `generateDataEntityPointId`, `parseDepId`, `DATA_ENTITY_POINT_PREFIXES` |

## Technical Notes

- **Pure functions only**: The mapping engine in `temporaryDiagramMapping.ts` must contain zero React hooks, zero DOM access, zero side effects. This enables straightforward Vitest testing without component mocking.
- **Never throws**: The `mapTemporaryDiagram` function must express all error conditions through the `DiagramMappingResult` data structure. No exceptions should escape the function boundary.
- **Strict matching**: Case-sensitive, no trimming, no lowercasing, no Unicode normalization. Exact string equality via `===`.
- **Pre-indexing pattern**: Build `Map` indexes from MetaModel collections before iterating temporary diagram elements. This ensures O(n) performance rather than O(n*m) nested iteration.
- **Bidirectional relationship lookup**: The canonical key for relationships uses sorted DEP IDs to handle cases where the temporary diagram's edge direction does not match the stored relationship direction.
- **Existing utilities to reuse**: `generateDataEntityPointId` and `parseDepId` from `dataEntityPointOptions.ts`; `DIAGRAM_NODE_ENTITY_TYPE_MAP` from `entityTypeRegistry.ts`.

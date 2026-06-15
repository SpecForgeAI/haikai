/**
 * Deterministic Diagram Auto-Mapping Engine
 *
 * Spec: Deterministic Diagram Auto-Mapping Framework (Increment 5)
 *
 * Pure mapping engine that takes a rendered TemporaryArchitectureDiagram and resolves it
 * to the architecture meta-model by matching nodes to entities, attributes to attributes,
 * and edges to relationships -- producing mapping result data only, without performing
 * native diagram conversion or persistence.
 *
 * Key design principles:
 * - Pure functions only: no React hooks, no DOM access, no side effects
 * - Never throws: all error conditions are expressed through the result data structure
 * - Strict matching: case-sensitive exact string equality via ===
 * - Pre-indexing: builds Map indexes from MetaModel collections for O(1) lookups
 *
 * @module temporaryDiagramMapping
 */

import {
  TemporaryArchitectureDiagram,
  TemporaryArchitectureDiagramNode,
  TemporaryArchitectureDiagramEdge,
} from '../types/temporaryArchitectureDiagram';
import {
  MetaModel,
  MetaModelEntities,
  MetaModelRelationships,
  LogicalDataEntityRelationship,
} from '../types/model';
import { DIAGRAM_NODE_ENTITY_TYPE_MAP } from './entityTypeRegistry';
import { parseDepId, generateDataEntityPointId } from './dataEntityPointOptions';

// ============================================================================
// TYPE DEFINITIONS (Task Group 1)
// ============================================================================

/**
 * Reason codes for unmatched mapping records.
 *
 * - `no_entity_match`: Node ref_name not found in meta-model entity collection
 * - `no_attribute_match`: Attribute ref_name not found under matched parent entity
 * - `no_relationship_match`: No relationship found connecting resolved source and target entities
 * - `invalid_node_reference`: Edge references a node ID not present in the temporary diagram
 * - `invalid_edge_reference`: Edge structural validation failure
 * - `mode_mismatch`: Node semantic_type does not align with diagram view_mode
 */
export type MappingReasonCode =
  | 'no_entity_match'
  | 'no_attribute_match'
  | 'no_relationship_match'
  | 'invalid_node_reference'
  | 'invalid_edge_reference'
  | 'mode_mismatch';

/**
 * Overall status of the mapping result.
 *
 * - `fully_matched`: All elements across all categories are matched
 * - `partially_matched`: Some elements matched, some unmatched
 * - `no_matches`: No elements matched (or all totals are zero)
 */
export type MappingOverallStatus = 'fully_matched' | 'partially_matched' | 'no_matches';

/**
 * Mapping record for a single temporary diagram node.
 */
export interface NodeMappingRecord {
  /** The local ID of the temporary diagram node */
  temporaryNodeId: string;
  /** The matched meta-model entity ID, or null if unmatched */
  matchedEntityId: string | null;
  /** Whether the node was matched or unmatched */
  status: 'matched' | 'unmatched';
  /** Reason code explaining why the node is unmatched (only present when status is 'unmatched') */
  reasonCode?: MappingReasonCode;
}

/**
 * Mapping record for a single temporary diagram compartment item (attribute).
 */
export interface AttributeMappingRecord {
  /** The local ID of the temporary diagram compartment item */
  temporaryItemId: string;
  /** The local ID of the parent temporary diagram node */
  parentTemporaryNodeId: string;
  /** The matched meta-model attribute ID, or null if unmatched */
  matchedAttributeId: string | null;
  /** Whether the attribute was matched or unmatched */
  status: 'matched' | 'unmatched';
  /** Reason code explaining why the attribute is unmatched (only present when status is 'unmatched') */
  reasonCode?: MappingReasonCode;
}

/**
 * Mapping record for a single temporary diagram edge (relationship).
 */
export interface EdgeMappingRecord {
  /** The local ID of the temporary diagram edge */
  temporaryEdgeId: string;
  /** The matched meta-model relationship ID, or null if unmatched */
  matchedRelationshipId: string | null;
  /** Whether the edge was matched or unmatched */
  status: 'matched' | 'unmatched';
  /** Reason code explaining why the edge is unmatched (only present when status is 'unmatched') */
  reasonCode?: MappingReasonCode;
}

/**
 * Summary counts for the mapping result, broken down by element category.
 */
export interface MappingSummary {
  nodes: { total: number; matched: number; unmatched: number };
  attributes: { total: number; matched: number; unmatched: number };
  edges: { total: number; matched: number; unmatched: number };
}

/**
 * Complete mapping result for a temporary architecture diagram.
 */
export interface DiagramMappingResult {
  /** Per-node mapping records */
  nodes: NodeMappingRecord[];
  /** Per-attribute mapping records */
  attributes: AttributeMappingRecord[];
  /** Per-edge mapping records */
  edges: EdgeMappingRecord[];
  /** Summary counts by category */
  summary: MappingSummary;
  /** Overall mapping status */
  overallStatus: MappingOverallStatus;
}

// ============================================================================
// HELPER: Empty Result Factory
// ============================================================================

/**
 * Creates an empty DiagramMappingResult with no_matches status and all counts at zero.
 */
function createEmptyResult(): DiagramMappingResult {
  return {
    nodes: [],
    attributes: [],
    edges: [],
    summary: {
      nodes: { total: 0, matched: 0, unmatched: 0 },
      attributes: { total: 0, matched: 0, unmatched: 0 },
      edges: { total: 0, matched: 0, unmatched: 0 },
    },
    overallStatus: 'no_matches',
  };
}

/**
 * Creates a DiagramMappingResult where all elements are flagged as mode_mismatch.
 * Used when diagram_kind is not 'ER' or source_architecture_domain is not 'DATA'.
 */
function createModeMismatchResult(diagram: TemporaryArchitectureDiagram): DiagramMappingResult {
  const nodes: NodeMappingRecord[] = (diagram.nodes || []).map((node) => ({
    temporaryNodeId: node.id,
    matchedEntityId: null,
    status: 'unmatched' as const,
    reasonCode: 'mode_mismatch' as const,
  }));

  const attributes: AttributeMappingRecord[] = [];
  for (const node of diagram.nodes || []) {
    for (const compartment of node.compartments || []) {
      for (const item of compartment.items || []) {
        attributes.push({
          temporaryItemId: item.id,
          parentTemporaryNodeId: node.id,
          matchedAttributeId: null,
          status: 'unmatched' as const,
          reasonCode: 'mode_mismatch' as const,
        });
      }
    }
  }

  const edges: EdgeMappingRecord[] = (diagram.edges || []).map((edge) => ({
    temporaryEdgeId: edge.id,
    matchedRelationshipId: null,
    status: 'unmatched' as const,
    reasonCode: 'mode_mismatch' as const,
  }));

  const summary: MappingSummary = {
    nodes: { total: nodes.length, matched: 0, unmatched: nodes.length },
    attributes: { total: attributes.length, matched: 0, unmatched: attributes.length },
    edges: { total: edges.length, matched: 0, unmatched: edges.length },
  };

  return {
    nodes,
    attributes,
    edges,
    summary,
    overallStatus: 'no_matches',
  };
}

// ============================================================================
// INDEX BUILDERS (Task Group 2)
// ============================================================================

/**
 * Returns the MetaModelEntities collection key for the given view mode.
 *
 * @param viewMode - 'LOGICAL' or 'PHYSICAL'
 * @returns The corresponding MetaModelEntities key, or null for unrecognized view modes
 */
export function getEntityCollectionKey(viewMode: string): keyof MetaModelEntities | null {
  if (viewMode === 'LOGICAL') {
    // Validate via DIAGRAM_NODE_ENTITY_TYPE_MAP
    const key = DIAGRAM_NODE_ENTITY_TYPE_MAP['LOGICAL_DATA_ENTITY'];
    return key || null;
  }
  if (viewMode === 'PHYSICAL') {
    const key = DIAGRAM_NODE_ENTITY_TYPE_MAP['PHYSICAL_DATA_ENTITY'];
    return key || null;
  }
  return null;
}

/**
 * Builds a name-to-ID index from the entity collection matching the given view mode.
 *
 * @param entities - MetaModelEntities containing all entity collections
 * @param viewMode - 'LOGICAL' or 'PHYSICAL'
 * @returns Map keyed by entity name, valued by entity ID
 */
export function buildEntityNameIndex(entities: MetaModelEntities, viewMode: string): Map<string, string> {
  const index = new Map<string, string>();

  if (viewMode === 'LOGICAL') {
    const collection = entities.logical_data_entities;
    if (collection) {
      for (const entity of collection) {
        index.set(entity.name, entity.id);
      }
    }
  } else if (viewMode === 'PHYSICAL') {
    const collection = entities.physical_data_entities;
    if (collection) {
      for (const entity of collection) {
        index.set(entity.name, entity.id);
      }
    }
  }

  return index;
}

/**
 * Builds a nested attribute index grouped by parent entity ID, then keyed by attribute name.
 *
 * @param entities - MetaModelEntities containing all attribute collections
 * @param viewMode - 'LOGICAL' or 'PHYSICAL'
 * @returns Map<parentEntityId, Map<attributeName, attributeId>>
 */
export function buildAttributeIndex(
  entities: MetaModelEntities,
  viewMode: string
): Map<string, Map<string, string>> {
  const index = new Map<string, Map<string, string>>();

  if (viewMode === 'LOGICAL') {
    const collection = entities.logical_data_attributes;
    if (collection) {
      for (const attr of collection) {
        const parentId = attr.logical_entity_id;
        if (!index.has(parentId)) {
          index.set(parentId, new Map<string, string>());
        }
        index.get(parentId)!.set(attr.name, attr.id);
      }
    }
  } else if (viewMode === 'PHYSICAL') {
    const collection = entities.physical_data_attributes;
    if (collection) {
      for (const attr of collection) {
        const parentId = attr.physical_entity_id;
        if (!index.has(parentId)) {
          index.set(parentId, new Map<string, string>());
        }
        index.get(parentId)!.set(attr.name, attr.id);
      }
    }
  }

  return index;
}

/**
 * Builds a relationship index keyed by canonical DEP ID pair for bidirectional lookup.
 *
 * The canonical key is formed by sorting the two DEP IDs alphabetically and joining with '|'.
 * This ensures that A->B and B->A both map to the same key.
 *
 * @param relationships - MetaModelRelationships containing logical_data_entity_relationships
 * @returns Map<canonicalKey, LogicalDataEntityRelationship[]>
 */
export function buildRelationshipIndex(
  relationships: MetaModelRelationships
): Map<string, LogicalDataEntityRelationship[]> {
  const index = new Map<string, LogicalDataEntityRelationship[]>();

  const collection = relationships.logical_data_entity_relationships;
  if (!collection) {
    return index;
  }

  for (const rel of collection) {
    const fromDepId = rel.fromDataEntityPointId;
    const toDepId = rel.toDataEntityPointId;

    if (!fromDepId || !toDepId) {
      continue;
    }

    // Validate DEP IDs are parseable
    const fromParsed = parseDepId(fromDepId);
    const toParsed = parseDepId(toDepId);
    if (!fromParsed || !toParsed) {
      continue;
    }

    // Build canonical key by sorting DEP IDs alphabetically
    const sortedPair = [fromDepId, toDepId].sort();
    const canonicalKey = sortedPair.join('|');

    if (!index.has(canonicalKey)) {
      index.set(canonicalKey, []);
    }
    index.get(canonicalKey)!.push(rel);
  }

  return index;
}

// ============================================================================
// ENTITY MATCHING (Task Group 3)
// ============================================================================

/**
 * Validates whether a node's semantic_type is compatible with the diagram's view_mode.
 *
 * Uses DIAGRAM_NODE_ENTITY_TYPE_MAP to resolve the semantic_type to a collection key,
 * then checks if it matches the expected collection for the given view mode.
 *
 * @param semanticType - The node's semantic_type (e.g., 'LOGICAL_DATA_ENTITY')
 * @param viewMode - The diagram's view_mode ('LOGICAL' or 'PHYSICAL')
 * @returns true if compatible, false (mode_mismatch) otherwise
 */
export function validateNodeSemanticType(semanticType: string, viewMode: string): boolean {
  const collectionKey = DIAGRAM_NODE_ENTITY_TYPE_MAP[semanticType];
  if (!collectionKey) {
    // Unrecognized semantic_type is a mode mismatch
    return false;
  }

  const expectedCollectionKey = getEntityCollectionKey(viewMode);
  if (!expectedCollectionKey) {
    // Unrecognized view mode
    return false;
  }

  return collectionKey === expectedCollectionKey;
}

/**
 * Maps temporary diagram nodes to meta-model entities using strict exact name matching.
 *
 * For each node:
 * 1. Validates semantic_type against view_mode (flags mode_mismatch if incompatible)
 * 2. Looks up ref_name in the entity name index (strict case-sensitive exact match)
 * 3. Produces a NodeMappingRecord with matched entity ID or unmatched reason code
 *
 * @param nodes - Array of temporary diagram nodes to map
 * @param entityNameIndex - Map<entityName, entityId> from buildEntityNameIndex
 * @param viewMode - The diagram's view_mode ('LOGICAL' or 'PHYSICAL')
 * @returns Array of NodeMappingRecord for each node
 */
export function mapEntities(
  nodes: TemporaryArchitectureDiagramNode[],
  entityNameIndex: Map<string, string>,
  viewMode: string
): NodeMappingRecord[] {
  const records: NodeMappingRecord[] = [];

  for (const node of nodes) {
    // Step 1: Validate semantic_type against view_mode
    if (!validateNodeSemanticType(node.semantic_type, viewMode)) {
      records.push({
        temporaryNodeId: node.id,
        matchedEntityId: null,
        status: 'unmatched',
        reasonCode: 'mode_mismatch',
      });
      continue;
    }

    // Step 2: Look up ref_name in entity name index (strict exact match)
    const matchedEntityId = entityNameIndex.get(node.ref_name);

    if (matchedEntityId !== undefined) {
      records.push({
        temporaryNodeId: node.id,
        matchedEntityId,
        status: 'matched',
      });
    } else {
      records.push({
        temporaryNodeId: node.id,
        matchedEntityId: null,
        status: 'unmatched',
        reasonCode: 'no_entity_match',
      });
    }
  }

  return records;
}

// ============================================================================
// ATTRIBUTE MATCHING (Task Group 4)
// ============================================================================

/**
 * Maps temporary diagram compartment items (attributes) to meta-model attributes.
 *
 * Only processes attributes for nodes that were matched to entities in Step 1.
 * Unmatched parent nodes have their compartment items entirely skipped (no records created).
 *
 * For matched nodes, iterates compartments -> items where item_kind === 'ATTRIBUTE',
 * and looks up each item's ref_name in the attribute index under the matched entity ID.
 *
 * @param nodes - Array of temporary diagram nodes (containing compartments)
 * @param entityMappingLookup - Map<temporaryNodeId, matchedEntityId> from entity mapping step
 * @param attributeIndex - Map<entityId, Map<attrName, attrId>> from buildAttributeIndex
 * @returns Array of AttributeMappingRecord for each processed attribute item
 */
export function mapAttributes(
  nodes: TemporaryArchitectureDiagramNode[],
  entityMappingLookup: Map<string, string>,
  attributeIndex: Map<string, Map<string, string>>
): AttributeMappingRecord[] {
  const records: AttributeMappingRecord[] = [];

  for (const node of nodes) {
    // Skip all compartment items for unmatched parent nodes
    const matchedEntityId = entityMappingLookup.get(node.id);
    if (matchedEntityId === undefined) {
      continue;
    }

    // Get the attribute name->id map for this entity
    const entityAttrs = attributeIndex.get(matchedEntityId);

    // Iterate compartments -> items
    for (const compartment of node.compartments || []) {
      for (const item of compartment.items || []) {
        // Only process items with item_kind === 'ATTRIBUTE'
        if (item.item_kind !== 'ATTRIBUTE') {
          continue;
        }

        // Look up ref_name in the attribute index for this entity
        const matchedAttributeId = entityAttrs?.get(item.ref_name);

        if (matchedAttributeId !== undefined) {
          records.push({
            temporaryItemId: item.id,
            parentTemporaryNodeId: node.id,
            matchedAttributeId,
            status: 'matched',
          });
        } else {
          records.push({
            temporaryItemId: item.id,
            parentTemporaryNodeId: node.id,
            matchedAttributeId: null,
            status: 'unmatched',
            reasonCode: 'no_attribute_match',
          });
        }
      }
    }
  }

  return records;
}

// ============================================================================
// RELATIONSHIP MATCHING (Task Group 5)
// ============================================================================

/**
 * Maps temporary diagram edges to meta-model relationships.
 *
 * For each edge:
 * 1. Validates that source_node_id and target_node_id reference nodes present in the diagram
 * 2. Checks that both source and target nodes resolved to matched entities
 * 3. Constructs DEP IDs from matched entity IDs using generateDataEntityPointId
 * 4. Builds canonical key and looks up in relationship index (bidirectional)
 * 5. Produces an EdgeMappingRecord with matched relationship ID or unmatched reason code
 *
 * Note: source_item_ref_name and target_item_ref_name on edges are informational only
 * and are NOT used for matching.
 *
 * @param edges - Array of temporary diagram edges to map
 * @param nodeIdSet - Set of all node IDs present in the temporary diagram
 * @param entityMappingLookup - Map<temporaryNodeId, matchedEntityId> from entity mapping step
 * @param relationshipIndex - Map<canonicalKey, LogicalDataEntityRelationship[]> from buildRelationshipIndex
 * @param viewMode - The diagram's view_mode ('LOGICAL' or 'PHYSICAL')
 * @returns Array of EdgeMappingRecord for each edge
 */
export function mapRelationships(
  edges: TemporaryArchitectureDiagramEdge[],
  nodeIdSet: Set<string>,
  entityMappingLookup: Map<string, string>,
  relationshipIndex: Map<string, LogicalDataEntityRelationship[]>,
  viewMode: string
): EdgeMappingRecord[] {
  const records: EdgeMappingRecord[] = [];

  // Determine the entity type for DEP ID construction
  const entityType: 'logical' | 'physical' = viewMode === 'PHYSICAL' ? 'physical' : 'logical';

  for (const edge of edges) {
    // Step 1: Validate node references exist in the temporary diagram
    if (!nodeIdSet.has(edge.source_node_id) || !nodeIdSet.has(edge.target_node_id)) {
      records.push({
        temporaryEdgeId: edge.id,
        matchedRelationshipId: null,
        status: 'unmatched',
        reasonCode: 'invalid_node_reference',
      });
      continue;
    }

    // Step 2: Check both source and target nodes resolved to matched entities
    const sourceEntityId = entityMappingLookup.get(edge.source_node_id);
    const targetEntityId = entityMappingLookup.get(edge.target_node_id);

    if (sourceEntityId === undefined || targetEntityId === undefined) {
      records.push({
        temporaryEdgeId: edge.id,
        matchedRelationshipId: null,
        status: 'unmatched',
        reasonCode: 'no_relationship_match',
      });
      continue;
    }

    // Step 3: Construct DEP IDs from matched entity IDs
    const sourceDepId = generateDataEntityPointId(entityType, sourceEntityId);
    const targetDepId = generateDataEntityPointId(entityType, targetEntityId);

    // Step 4: Build canonical key (sorted DEP ID pair) and look up in relationship index
    const sortedPair = [sourceDepId, targetDepId].sort();
    const canonicalKey = sortedPair.join('|');

    const matchingRelationships = relationshipIndex.get(canonicalKey);

    if (matchingRelationships && matchingRelationships.length > 0) {
      // Use first matching relationship
      records.push({
        temporaryEdgeId: edge.id,
        matchedRelationshipId: matchingRelationships[0].id,
        status: 'matched',
      });
    } else {
      records.push({
        temporaryEdgeId: edge.id,
        matchedRelationshipId: null,
        status: 'unmatched',
        reasonCode: 'no_relationship_match',
      });
    }
  }

  return records;
}

// ============================================================================
// SUMMARY COMPUTATION (will be finalized in Task Group 6)
// ============================================================================

/**
 * Computes summary counts from mapping records.
 *
 * @param nodes - Node mapping records
 * @param attributes - Attribute mapping records
 * @param edges - Edge mapping records
 * @returns MappingSummary with total/matched/unmatched counts per category
 */
function computeSummary(
  nodes: NodeMappingRecord[],
  attributes: AttributeMappingRecord[],
  edges: EdgeMappingRecord[]
): MappingSummary {
  const nodeMatched = nodes.filter((n) => n.status === 'matched').length;
  const attrMatched = attributes.filter((a) => a.status === 'matched').length;
  const edgeMatched = edges.filter((e) => e.status === 'matched').length;

  return {
    nodes: { total: nodes.length, matched: nodeMatched, unmatched: nodes.length - nodeMatched },
    attributes: { total: attributes.length, matched: attrMatched, unmatched: attributes.length - attrMatched },
    edges: { total: edges.length, matched: edgeMatched, unmatched: edges.length - edgeMatched },
  };
}

/**
 * Computes the overall mapping status from summary counts.
 *
 * @param summary - The mapping summary
 * @returns MappingOverallStatus
 */
function computeOverallStatus(summary: MappingSummary): MappingOverallStatus {
  const totalAll = summary.nodes.total + summary.attributes.total + summary.edges.total;
  const matchedAll = summary.nodes.matched + summary.attributes.matched + summary.edges.matched;

  if (totalAll === 0 || matchedAll === 0) {
    return 'no_matches';
  }

  if (matchedAll === totalAll) {
    return 'fully_matched';
  }

  return 'partially_matched';
}

// ============================================================================
// MAIN MAPPING FUNCTION
// ============================================================================

/**
 * Maps a temporary architecture diagram to the architecture meta-model.
 *
 * This is a pure function that produces mapping result data only. It never throws;
 * all error conditions are expressed through the DiagramMappingResult data structure.
 *
 * @param diagram - The temporary architecture diagram to map
 * @param metaModel - The architecture meta-model to match against
 * @returns A DiagramMappingResult containing per-element mapping records and summary
 */
export function mapTemporaryDiagram(
  diagram: TemporaryArchitectureDiagram,
  metaModel: MetaModel
): DiagramMappingResult {
  try {
    // Guard: non-ER or non-DATA diagrams get mode_mismatch for all elements
    if (diagram.diagram_kind !== 'ER' || diagram.source_architecture_domain !== 'DATA') {
      return createModeMismatchResult(diagram);
    }

    // Guard: empty diagram
    const nodes = diagram.nodes || [];
    const edges = diagram.edges || [];

    if (nodes.length === 0 && edges.length === 0) {
      return createEmptyResult();
    }

    const viewMode = diagram.view_mode;

    // Step 1: Build indexes
    const entityNameIndex = buildEntityNameIndex(metaModel.entities, viewMode);
    const attributeIndex = buildAttributeIndex(metaModel.entities, viewMode);
    const relationshipIndex = buildRelationshipIndex(metaModel.relationships);

    // Step 2: Entity matching
    const nodeRecords = mapEntities(nodes, entityNameIndex, viewMode);

    // Build lookup Map from temporaryNodeId -> matchedEntityId for downstream steps
    const entityMappingLookup = new Map<string, string>();
    for (const record of nodeRecords) {
      if (record.status === 'matched' && record.matchedEntityId !== null) {
        entityMappingLookup.set(record.temporaryNodeId, record.matchedEntityId);
      }
    }

    // Step 3: Attribute matching
    const attributeRecords = mapAttributes(nodes, entityMappingLookup, attributeIndex);

    // Step 4: Relationship matching
    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const edgeRecords = mapRelationships(edges, nodeIdSet, entityMappingLookup, relationshipIndex, viewMode);

    // Step 5: Compute summary and overall status
    const summary = computeSummary(nodeRecords, attributeRecords, edgeRecords);
    const overallStatus = computeOverallStatus(summary);

    return {
      nodes: nodeRecords,
      attributes: attributeRecords,
      edges: edgeRecords,
      summary,
      overallStatus,
    };
  } catch {
    // Never throw: return empty result on any unexpected error
    return createEmptyResult();
  }
}

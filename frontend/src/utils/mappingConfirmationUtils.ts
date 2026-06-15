/**
 * Mapping Confirmation Utilities
 *
 * Spec: Mapping Confirmation Modal Framework (Increment 6)
 *
 * This module defines:
 * - Task Group 1: CompletedDiagramMapping output contract, candidate-building pure functions
 * - Task Group 2: Editable selections state initialization, cascade logic,
 *   validation computation, and completed mapping builder
 *
 * All functions are pure (no hooks, no DOM, no side effects).
 *
 * @module mappingConfirmationUtils
 */

import { MetaModel, LogicalDataEntityRelationship, LogicalERCardinality, LogicalERRelationship } from '../types/model';
import {
  TemporaryArchitectureDiagram,
  TemporaryArchitectureDiagramNode,
} from '../types/temporaryArchitectureDiagram';
import {
  DiagramMappingResult,
} from './temporaryDiagramMapping';
import { generateDataEntityPointId, parseDepId } from './dataEntityPointOptions';
import { generatePrefixedId, getEntityPrefix } from './idGenerator';

// ============================================================================
// CARDINALITY AND RELATIONSHIP TYPE OPTIONS
// Used by the MappingConfirmationModal to let users pick values when creating
// a new LogicalDataEntityRelationship.
// ============================================================================

export const CARDINALITY_OPTIONS: readonly LogicalERCardinality[] = [
  'ONE_TO_ONE',
  'ONE_TO_MANY',
  'MANY_TO_ONE',
  'MANY_TO_MANY',
];

export const CARDINALITY_LABELS: Record<LogicalERCardinality, string> = {
  ONE_TO_ONE: 'One to One (1:1)',
  ONE_TO_MANY: 'One to Many (1:M)',
  MANY_TO_ONE: 'Many to One (M:1)',
  MANY_TO_MANY: 'Many to Many (M:M)',
};

export const RELATIONSHIP_TYPE_OPTIONS: readonly LogicalERRelationship[] = [
  'GENERALIZATION',
  'REALIZATION',
  'COMPOSITION',
  'AGGREGATION',
  'ASSOCIATION',
  'DEPENDENCY',
];

export const RELATIONSHIP_TYPE_LABELS: Record<LogicalERRelationship, string> = {
  GENERALIZATION: 'Generalization (is-a)',
  REALIZATION: 'Realization (implements)',
  COMPOSITION: 'Composition (has-a, strong)',
  AGGREGATION: 'Aggregation (has-a, weak)',
  ASSOCIATION: 'Association (general)',
  DEPENDENCY: 'Dependency (uses)',
};

/** Sentinel value used by the edge relationship dropdown to represent "create a new relationship". */
export const NEW_RELATIONSHIP_SENTINEL = '__NEW__';

// ============================================================================
// OUTPUT TYPES (Task 1.2)
// ============================================================================

/**
 * Completed mapping record for a single node -> entity resolution.
 * The resolvedEntityId is guaranteed non-null (string, not string | null).
 */
export interface CompletedNodeMapping {
  temporaryNodeId: string;
  resolvedEntityId: string;
}

/**
 * Completed mapping record for a single attribute -> meta-model attribute resolution.
 * The resolvedAttributeId is guaranteed non-null.
 */
export interface CompletedAttributeMapping {
  temporaryItemId: string;
  parentTemporaryNodeId: string;
  resolvedAttributeId: string;
}

/**
 * Data needed to create a new LogicalDataEntityRelationship when the user picked
 * [NEW] for an edge rather than an existing relationship.
 * The id is pre-generated so the edge's resolvedRelationshipId can reference it.
 */
export interface NewRelationshipData {
  id: string;
  cardinality: LogicalERCardinality;
  relationship: LogicalERRelationship;
  fromDataEntityPointId: string;
  toDataEntityPointId: string;
  description: string;
  tags: string;
}

/**
 * Completed mapping record for a single edge -> relationship resolution.
 * The resolvedRelationshipId is guaranteed non-null.
 *
 * When `newRelationship` is set, the resolvedRelationshipId refers to a
 * relationship that does not yet exist in the meta-model; the consumer must
 * persist the newRelationship before (or atomically with) adding the diagram.
 */
export interface CompletedEdgeMapping {
  temporaryEdgeId: string;
  resolvedRelationshipId: string;
  newRelationship?: NewRelationshipData;
}

/**
 * The mapping output produced when the user clicks Confirm.
 *
 * Items that the user left unresolved are excluded from the completed* arrays
 * (partial confirm). `newRelationships` lists any relationships the user asked
 * to create via the [NEW] option; the consumer must persist these to the
 * meta-model before linking diagram edges to them.
 */
export interface CompletedDiagramMapping {
  completedNodes: CompletedNodeMapping[];
  completedAttributes: CompletedAttributeMapping[];
  completedEdges: CompletedEdgeMapping[];
  /** New relationships the consumer must persist. Optional for backward-compat; treat undefined as []. */
  newRelationships?: NewRelationshipData[];
  sourceTemporaryDiagram: TemporaryArchitectureDiagram;
  viewMode: string;
}

// ============================================================================
// CANDIDATE LIST TYPES
// ============================================================================

/**
 * A candidate option for entity or attribute dropdown selection.
 */
export interface EntityCandidate {
  id: string;
  name: string;
}

/**
 * A candidate option for relationship dropdown selection.
 * The label includes cardinality and relationship type for user disambiguation.
 */
export interface RelationshipCandidate {
  id: string;
  label: string;
}

// ============================================================================
// CANDIDATE-BUILDING UTILITIES (Tasks 1.3, 1.4, 1.5)
// ============================================================================

/**
 * Builds a list of entity candidates from the meta-model for the given view mode.
 *
 * Returns entities from `metaModel.entities.logical_data_entities` when viewMode
 * is 'LOGICAL', or from `metaModel.entities.physical_data_entities` when 'PHYSICAL'.
 *
 * @param metaModel - The architecture meta-model
 * @param viewMode - 'LOGICAL' or 'PHYSICAL'
 * @returns Array of { id, name } candidates; empty array for null/undefined collections or unrecognized viewMode
 */
export function buildEntityCandidates(
  metaModel: MetaModel,
  viewMode: string
): EntityCandidate[] {
  if (!metaModel?.entities) {
    return [];
  }

  if (viewMode === 'LOGICAL') {
    const collection = metaModel.entities.logical_data_entities;
    if (!collection) {
      return [];
    }
    return collection.map((entity) => ({ id: entity.id, name: entity.name }));
  }

  if (viewMode === 'PHYSICAL') {
    const collection = metaModel.entities.physical_data_entities;
    if (!collection) {
      return [];
    }
    return collection.map((entity) => ({ id: entity.id, name: entity.name }));
  }

  // Unrecognized viewMode
  return [];
}

/**
 * Builds a list of attribute candidates for a specific parent entity.
 *
 * Filters attributes by `logical_entity_id` (LOGICAL) or `physical_entity_id` (PHYSICAL)
 * matching the provided parentEntityId.
 *
 * @param metaModel - The architecture meta-model
 * @param viewMode - 'LOGICAL' or 'PHYSICAL'
 * @param parentEntityId - The ID of the parent entity to filter attributes by
 * @returns Array of { id, name } candidates; empty array when parentEntityId is empty or no matches
 */
export function buildAttributeCandidates(
  metaModel: MetaModel,
  viewMode: string,
  parentEntityId: string
): EntityCandidate[] {
  if (!parentEntityId || !metaModel?.entities) {
    return [];
  }

  if (viewMode === 'LOGICAL') {
    const collection = metaModel.entities.logical_data_attributes;
    if (!collection) {
      return [];
    }
    return collection
      .filter((attr) => attr.logical_entity_id === parentEntityId)
      .map((attr) => ({ id: attr.id, name: attr.name }));
  }

  if (viewMode === 'PHYSICAL') {
    const collection = metaModel.entities.physical_data_attributes;
    if (!collection) {
      return [];
    }
    return collection
      .filter((attr) => attr.physical_entity_id === parentEntityId)
      .map((attr) => ({ id: attr.id, name: attr.name }));
  }

  // Unrecognized viewMode
  return [];
}

/**
 * Formats a relationship into a human-readable label for dropdown display.
 *
 * The label includes cardinality and relationship type for user disambiguation.
 * Example output: "One to Many - Association" or "Many to Many" (if no relationship type).
 *
 * @param rel - The LogicalDataEntityRelationship to format
 * @returns A human-readable label string
 */
function formatRelationshipLabel(rel: LogicalDataEntityRelationship): string {
  const parts: string[] = [];

  if (rel.cardinality) {
    // Convert SCREAMING_SNAKE_CASE to readable: ONE_TO_MANY -> "One to Many"
    const cardinalityLabel = rel.cardinality
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
    parts.push(cardinalityLabel);
  }

  if (rel.relationship) {
    // Convert SCREAMING_SNAKE_CASE to readable: ASSOCIATION -> "Association"
    const relationshipLabel = rel.relationship.charAt(0).toUpperCase() + rel.relationship.slice(1).toLowerCase();
    parts.push(relationshipLabel);
  }

  if (parts.length === 0) {
    return `Relationship (${rel.id})`;
  }

  return parts.join(' - ');
}

/**
 * Builds a list of relationship candidates that connect the given source and target entities.
 *
 * Uses the same canonical DEP ID key approach as `buildRelationshipIndex` and `mapRelationships`
 * from `temporaryDiagramMapping.ts`: constructs DEP IDs from entity IDs via
 * `generateDataEntityPointId`, sorts to form the canonical key, and looks up matching
 * `LogicalDataEntityRelationship` entries.
 *
 * @param metaModel - The architecture meta-model
 * @param sourceEntityId - The ID of the source entity
 * @param targetEntityId - The ID of the target entity
 * @param viewMode - 'LOGICAL' or 'PHYSICAL'
 * @returns Array of { id, label } candidates; empty array when either entityId is empty
 */
export function buildRelationshipCandidates(
  metaModel: MetaModel,
  sourceEntityId: string,
  targetEntityId: string,
  viewMode: string
): RelationshipCandidate[] {
  if (!sourceEntityId || !targetEntityId) {
    return [];
  }

  if (!metaModel?.relationships?.logical_data_entity_relationships) {
    return [];
  }

  // Determine entity type for DEP ID construction
  const entityType: 'logical' | 'physical' = viewMode === 'PHYSICAL' ? 'physical' : 'logical';

  // Construct DEP IDs from entity IDs
  const sourceDepId = generateDataEntityPointId(entityType, sourceEntityId);
  const targetDepId = generateDataEntityPointId(entityType, targetEntityId);

  // Build canonical key by sorting DEP IDs alphabetically
  const sortedPair = [sourceDepId, targetDepId].sort();
  const canonicalKey = sortedPair.join('|');

  // Build a relationship index from the meta-model and look up by canonical key
  const relationships = metaModel.relationships.logical_data_entity_relationships;
  const candidates: RelationshipCandidate[] = [];

  for (const rel of relationships) {
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

    // Build canonical key for this relationship
    const relSortedPair = [fromDepId, toDepId].sort();
    const relCanonicalKey = relSortedPair.join('|');

    if (relCanonicalKey === canonicalKey) {
      candidates.push({
        id: rel.id,
        label: formatRelationshipLabel(rel),
      });
    }
  }

  return candidates;
}

// ============================================================================
// STATE TYPES (Task Group 2)
// ============================================================================

/**
 * The editable selections state managed inside the modal.
 */
export interface EditableSelections {
  /** Map of temporaryNodeId -> selected entity ID (empty string = unresolved) */
  entitySelections: Record<string, string>;
  /** Map of temporaryItemId -> selected attribute ID (empty string = unresolved) */
  attributeSelections: Record<string, string>;
  /** Map of temporaryEdgeId -> selected relationship ID (empty string = unresolved) */
  edgeSelections: Record<string, string>;
}

/**
 * Validation state computed from current selections.
 */
export interface ValidationState {
  /** True when every selection across all three Records is non-empty */
  isAllResolved: boolean;
  /** Count of selections with non-empty values */
  resolvedCount: number;
  /** Total number of selections */
  totalCount: number;
}

/**
 * Result of the cascade operation triggered by an entity selection change.
 */
export interface CascadeResult {
  attributeSelections: Record<string, string>;
  edgeSelections: Record<string, string>;
}

// ============================================================================
// STATE INITIALIZATION (Task 2.2)
// ============================================================================

/**
 * Initializes the editable selections state from a DiagramMappingResult.
 *
 * Pre-populates matched items with their auto-matched IDs and
 * leaves unmatched items as empty string.
 *
 * @param mappingResult - The auto-mapping result from the deterministic engine
 * @returns Initialized editable selections
 */
export function initializeSelectionsFromMappingResult(
  mappingResult: DiagramMappingResult
): EditableSelections {
  const entitySelections: Record<string, string> = {};
  const attributeSelections: Record<string, string> = {};
  const edgeSelections: Record<string, string> = {};

  for (const node of mappingResult.nodes) {
    entitySelections[node.temporaryNodeId] = node.matchedEntityId ?? '';
  }

  for (const attr of mappingResult.attributes) {
    attributeSelections[attr.temporaryItemId] = attr.matchedAttributeId ?? '';
  }

  for (const edge of mappingResult.edges) {
    edgeSelections[edge.temporaryEdgeId] = edge.matchedRelationshipId ?? '';
  }

  return { entitySelections, attributeSelections, edgeSelections };
}

// ============================================================================
// CASCADE LOGIC (Task 2.3)
// ============================================================================

/**
 * Finds the ref_name for a temporary attribute item by searching the temporary diagram nodes.
 *
 * @param temporaryItemId - The local ID of the compartment item
 * @param nodes - Temporary diagram nodes to search
 * @returns The ref_name of the item, or null if not found
 */
function findAttributeRefName(
  temporaryItemId: string,
  nodes: TemporaryArchitectureDiagramNode[]
): string | null {
  for (const node of nodes) {
    for (const compartment of node.compartments || []) {
      for (const item of compartment.items || []) {
        if (item.id === temporaryItemId) {
          return item.ref_name;
        }
      }
    }
  }
  return null;
}

/**
 * Computes the cascading effects of changing an entity selection for a node.
 *
 * Cascade steps:
 * 1. Reset all child attribute selections for the changed node to empty string
 * 2. If newEntityId is non-empty, revalidate attributes by exact name match
 *    against the new entity's attribute candidates (same pattern as mapAttributes)
 * 3. Re-evaluate all edges connected to the changed node:
 *    - If both endpoints have entities selected, rebuild relationship candidates
 *      and preserve the current selection if still valid, otherwise reset to empty
 *    - If either endpoint is unselected, reset edge selection to empty string
 *
 * @param changedNodeId - The temporary node ID whose entity selection changed
 * @param newEntityId - The newly selected entity ID (empty string = deselected)
 * @param currentAttributeSelections - Current attribute selections state
 * @param currentEdgeSelections - Current edge selections state
 * @param temporaryDiagram - The temporary diagram for node/edge/attribute ref_name lookup
 * @param metaModel - The architecture meta-model
 * @param viewMode - 'LOGICAL' or 'PHYSICAL'
 * @param mappingResult - The mapping result for parentTemporaryNodeId lookup
 * @param entitySelections - Current entity selections (must already include the new value for changedNodeId)
 * @returns New attribute and edge selections after cascade
 */
export function cascadeEntityChange(
  changedNodeId: string,
  newEntityId: string,
  currentAttributeSelections: Record<string, string>,
  currentEdgeSelections: Record<string, string>,
  temporaryDiagram: TemporaryArchitectureDiagram,
  metaModel: MetaModel,
  viewMode: string,
  mappingResult: DiagramMappingResult,
  entitySelections: Record<string, string>
): CascadeResult {
  const newAttributeSelections = { ...currentAttributeSelections };
  const newEdgeSelections = { ...currentEdgeSelections };

  // Step 1: Identify all attributes belonging to the changed node and reset them
  const childAttributeRecords = mappingResult.attributes.filter(
    (a) => a.parentTemporaryNodeId === changedNodeId
  );

  for (const attrRecord of childAttributeRecords) {
    newAttributeSelections[attrRecord.temporaryItemId] = '';
  }

  // Step 2: If newEntityId is non-empty, revalidate by exact name match
  if (newEntityId) {
    const attributeCandidates = buildAttributeCandidates(metaModel, viewMode, newEntityId);
    // Build a name->id map for quick lookup (same pattern as mapAttributes)
    const nameToIdMap = new Map<string, string>();
    for (const candidate of attributeCandidates) {
      nameToIdMap.set(candidate.name, candidate.id);
    }

    for (const attrRecord of childAttributeRecords) {
      const refName = findAttributeRefName(
        attrRecord.temporaryItemId,
        temporaryDiagram.nodes || []
      );
      if (refName !== null) {
        const matchedId = nameToIdMap.get(refName);
        if (matchedId !== undefined) {
          newAttributeSelections[attrRecord.temporaryItemId] = matchedId;
        }
      }
    }
  }

  // Step 3: Re-evaluate edges connected to the changed node
  const edges = temporaryDiagram.edges || [];
  for (const edge of edges) {
    const edgeId = edge.id;
    // Only process edges tracked in the edgeSelections
    if (!(edgeId in currentEdgeSelections)) continue;

    if (edge.source_node_id === changedNodeId || edge.target_node_id === changedNodeId) {
      // Look up entity selections for both endpoints using the updated entitySelections
      const sourceEntityId = entitySelections[edge.source_node_id] ?? '';
      const targetEntityId = entitySelections[edge.target_node_id] ?? '';

      if (sourceEntityId && targetEntityId) {
        // Both endpoints selected - check if current edge selection is still valid
        const candidates = buildRelationshipCandidates(
          metaModel,
          sourceEntityId,
          targetEntityId,
          viewMode
        );
        const currentEdgeValue = currentEdgeSelections[edgeId] || '';
        const stillValid = candidates.some((c) => c.id === currentEdgeValue);
        newEdgeSelections[edgeId] = stillValid ? currentEdgeValue : '';
      } else {
        // One or both endpoints unselected - reset
        newEdgeSelections[edgeId] = '';
      }
    }
  }

  return {
    attributeSelections: newAttributeSelections,
    edgeSelections: newEdgeSelections,
  };
}

// ============================================================================
// VALIDATION COMPUTATION (Task 2.4)
// ============================================================================

/**
 * Determines whether a given edge selection is considered resolved.
 *
 * An edge is resolved when:
 *  - Box 1 holds an existing relationship ID (non-empty, not NEW sentinel), OR
 *  - Box 1 = NEW sentinel AND both cardinality and relationship type are selected.
 */
export function isEdgeResolved(
  edgeId: string,
  edgeSelections: Record<string, string>,
  edgeCardinalitySelections: Record<string, string>,
  edgeRelationshipTypeSelections: Record<string, string>
): boolean {
  const value = edgeSelections[edgeId] ?? '';
  if (!value) return false;
  if (value === NEW_RELATIONSHIP_SENTINEL) {
    return (
      !!edgeCardinalitySelections[edgeId] &&
      !!edgeRelationshipTypeSelections[edgeId]
    );
  }
  return true;
}

/**
 * Computes the validation state from current selections.
 *
 * Edge resolution accounts for the 3-box model: an edge counts as resolved if
 * it either references an existing relationship OR is marked NEW with both
 * cardinality and relationship type picked.
 *
 * @param entitySelections - Current entity selections
 * @param attributeSelections - Current attribute selections
 * @param edgeSelections - Current edge Box-1 selections (existing ID or NEW sentinel)
 * @param edgeCardinalitySelections - Current edge Box-2 selections (optional; defaults to {})
 * @param edgeRelationshipTypeSelections - Current edge Box-3 selections (optional; defaults to {})
 * @returns Validation state with isAllResolved flag and resolved/total counts
 */
export function computeValidationState(
  entitySelections: Record<string, string>,
  attributeSelections: Record<string, string>,
  edgeSelections: Record<string, string>,
  edgeCardinalitySelections: Record<string, string> = {},
  edgeRelationshipTypeSelections: Record<string, string> = {}
): ValidationState {
  const entityValues = Object.values(entitySelections);
  const attributeValues = Object.values(attributeSelections);
  const edgeIds = Object.keys(edgeSelections);

  const entityResolved = entityValues.filter((v) => v !== '').length;
  const attributeResolved = attributeValues.filter((v) => v !== '').length;
  const edgeResolved = edgeIds.filter((id) =>
    isEdgeResolved(id, edgeSelections, edgeCardinalitySelections, edgeRelationshipTypeSelections)
  ).length;

  const totalCount = entityValues.length + attributeValues.length + edgeIds.length;
  const resolvedCount = entityResolved + attributeResolved + edgeResolved;
  const isAllResolved = totalCount > 0 && resolvedCount === totalCount;

  return { isAllResolved, resolvedCount, totalCount };
}

// ============================================================================
// COMPLETED MAPPING BUILDER (Task 2.5)
// ============================================================================

/**
 * Builds a CompletedDiagramMapping from the current selections, supporting
 * partial confirmation.
 *
 * Filtering rules:
 *  - Entities with empty selection are excluded.
 *  - Attributes are excluded when their selection is empty OR their parent
 *    entity was excluded.
 *  - Edges are excluded when either endpoint entity was excluded OR the edge
 *    itself is not resolved (per `isEdgeResolved`).
 *
 * For edges where the user picked NEW, a `NewRelationshipData` entry is
 * generated, added to the top-level `newRelationships` list, and its id is
 * used as the `resolvedRelationshipId` on the completed edge.
 *
 * @param entitySelections - Entity selections (any empty values are skipped)
 * @param attributeSelections - Attribute selections (any empty values are skipped)
 * @param edgeSelections - Edge Box-1 selections (existing ID, NEW sentinel, or empty)
 * @param edgeCardinalitySelections - Edge Box-2 selections for NEW edges
 * @param edgeRelationshipTypeSelections - Edge Box-3 selections for NEW edges
 * @param temporaryDiagram - The source temporary diagram
 * @param viewMode - The diagram view mode ('LOGICAL' or 'PHYSICAL')
 * @param mappingResult - The mapping result (for parentTemporaryNodeId lookup on attributes)
 * @returns CompletedDiagramMapping with resolved items only
 */
export function buildCompletedMapping(
  entitySelections: Record<string, string>,
  attributeSelections: Record<string, string>,
  edgeSelections: Record<string, string>,
  edgeCardinalitySelectionsOrTemporaryDiagram: Record<string, string> | TemporaryArchitectureDiagram,
  edgeRelationshipTypeSelectionsOrViewMode: Record<string, string> | string,
  temporaryDiagramOrMappingResult: TemporaryArchitectureDiagram | DiagramMappingResult,
  viewMode?: string,
  mappingResult?: DiagramMappingResult
): CompletedDiagramMapping {
  // Overload: support the legacy 6-arg signature (no 3-box edge params) for
  // backward compatibility with fully-resolved callers.
  let edgeCardinalitySelections: Record<string, string>;
  let edgeRelationshipTypeSelections: Record<string, string>;
  let tempDiagram: TemporaryArchitectureDiagram;
  let resolvedViewMode: string;
  let resolvedMappingResult: DiagramMappingResult;

  if (mappingResult !== undefined && viewMode !== undefined) {
    // 8-arg modern signature
    edgeCardinalitySelections = edgeCardinalitySelectionsOrTemporaryDiagram as Record<string, string>;
    edgeRelationshipTypeSelections = edgeRelationshipTypeSelectionsOrViewMode as Record<string, string>;
    tempDiagram = temporaryDiagramOrMappingResult as TemporaryArchitectureDiagram;
    resolvedViewMode = viewMode;
    resolvedMappingResult = mappingResult;
  } else {
    // 6-arg legacy signature: (entities, attrs, edges, tempDiagram, viewMode, mappingResult)
    edgeCardinalitySelections = {};
    edgeRelationshipTypeSelections = {};
    tempDiagram = edgeCardinalitySelectionsOrTemporaryDiagram as TemporaryArchitectureDiagram;
    resolvedViewMode = edgeRelationshipTypeSelectionsOrViewMode as string;
    resolvedMappingResult = temporaryDiagramOrMappingResult as DiagramMappingResult;
  }
  // Entities: keep only those with non-empty selection
  const resolvedEntityIds = new Set<string>();
  const completedNodes: CompletedNodeMapping[] = [];
  for (const [temporaryNodeId, resolvedEntityId] of Object.entries(entitySelections)) {
    if (resolvedEntityId) {
      completedNodes.push({ temporaryNodeId, resolvedEntityId });
      resolvedEntityIds.add(temporaryNodeId);
    }
  }

  // Attributes: require non-empty selection AND an included parent entity
  const parentNodeLookup = new Map<string, string>();
  for (const attr of resolvedMappingResult.attributes) {
    parentNodeLookup.set(attr.temporaryItemId, attr.parentTemporaryNodeId);
  }
  const completedAttributes: CompletedAttributeMapping[] = [];
  for (const [temporaryItemId, resolvedAttributeId] of Object.entries(attributeSelections)) {
    if (!resolvedAttributeId) continue;
    const parent = parentNodeLookup.get(temporaryItemId) ?? '';
    if (!parent || !resolvedEntityIds.has(parent)) continue;
    completedAttributes.push({
      temporaryItemId,
      parentTemporaryNodeId: parent,
      resolvedAttributeId,
    });
  }

  // Edges: require both endpoint entities included AND edge resolved
  const tempEdgeById = new Map(
    (tempDiagram.edges || []).map((e) => [e.id, e])
  );
  const entityType: 'logical' | 'physical' = resolvedViewMode === 'PHYSICAL' ? 'physical' : 'logical';
  const completedEdges: CompletedEdgeMapping[] = [];
  const newRelationships: NewRelationshipData[] = [];

  for (const [temporaryEdgeId, boxOne] of Object.entries(edgeSelections)) {
    if (!isEdgeResolved(temporaryEdgeId, edgeSelections, edgeCardinalitySelections, edgeRelationshipTypeSelections)) {
      continue;
    }
    const tempEdge = tempEdgeById.get(temporaryEdgeId);
    if (!tempEdge) continue;
    if (!resolvedEntityIds.has(tempEdge.source_node_id) || !resolvedEntityIds.has(tempEdge.target_node_id)) {
      continue;
    }

    if (boxOne === NEW_RELATIONSHIP_SENTINEL) {
      const sourceEntityId = entitySelections[tempEdge.source_node_id];
      const targetEntityId = entitySelections[tempEdge.target_node_id];
      const newRel: NewRelationshipData = {
        id: generatePrefixedId(getEntityPrefix('logical_data_entity_relationships')),
        cardinality: edgeCardinalitySelections[temporaryEdgeId] as LogicalERCardinality,
        relationship: edgeRelationshipTypeSelections[temporaryEdgeId] as LogicalERRelationship,
        fromDataEntityPointId: generateDataEntityPointId(entityType, sourceEntityId),
        toDataEntityPointId: generateDataEntityPointId(entityType, targetEntityId),
        description: '',
        tags: '',
      };
      newRelationships.push(newRel);
      completedEdges.push({
        temporaryEdgeId,
        resolvedRelationshipId: newRel.id,
        newRelationship: newRel,
      });
    } else {
      completedEdges.push({
        temporaryEdgeId,
        resolvedRelationshipId: boxOne,
      });
    }
  }

  return {
    completedNodes,
    completedAttributes,
    completedEdges,
    newRelationships,
    sourceTemporaryDiagram: tempDiagram,
    viewMode: resolvedViewMode,
  };
}

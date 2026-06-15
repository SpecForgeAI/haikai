/**
 * Diagram Finalization Utilities
 *
 * Spec: Diagram Finalization and Completion UX (Increment 7)
 *
 * This module defines pure conversion functions for:
 * - Task Group 1: `buildNativeDiagramFromMapping` -- converts a CompletedDiagramMapping
 *   + TemporaryArchitectureDiagram into a native Diagram object
 * - Task Group 2: `buildCompletedMappingFromFullMatch` -- derives a CompletedDiagramMapping
 *   from a fully_matched DiagramMappingResult, enabling auto-finalization
 *
 * All functions are pure (no hooks, no DOM, no side effects).
 *
 * @module diagramFinalizationUtils
 */

import { generatePrefixedId } from './idGenerator';
import { Diagram, DiagramNode, DiagramEdge, EdgePoint } from '../types/model';
import {
  TemporaryArchitectureDiagram,
  TemporaryArchitectureDiagramEdge,
} from '../types/temporaryArchitectureDiagram';
import {
  CompletedDiagramMapping,
  CompletedNodeMapping,
  CompletedAttributeMapping,
  CompletedEdgeMapping,
} from './mappingConfirmationUtils';
import {
  TypedContentEnvelope,
  ERContent,
  EREntityRef,
  ERRelationshipRef,
} from '../types/typedContent';
import {
  DiagramMappingResult,
} from './temporaryDiagramMapping';

// ============================================================================
// NODE CONVERSION (Task Group 1, Task 1.3)
// ============================================================================

/**
 * Result of converting completed node mappings into native DiagramNode objects.
 */
interface NodeConversionResult {
  /** The native diagram nodes */
  diagramNodes: DiagramNode[];
  /** Map of temporary node ID -> native node ID */
  tempToNativeNodeMap: Map<string, string>;
  /** EREntityRef entries for typedContent */
  entityRefs: EREntityRef[];
}

/**
 * Converts completed node mappings into native DiagramNode objects.
 *
 * For each CompletedNodeMapping:
 * - Generates a native node ID with prefix 'node'
 * - Derives entity_type from viewMode ('LOGICAL' -> 'LOGICAL_DATA_ENTITY', 'PHYSICAL' -> 'PHYSICAL_DATA_ENTITY')
 * - Copies position, dimensions, and z_index from the temporary node
 * - Populates embedded_attribute_ids and selected_attribute_ids from matching completed attributes
 * - Builds an EREntityRef for the typedContent
 *
 * @param completedNodes - The completed node mappings
 * @param completedAttributes - The completed attribute mappings (for populating attribute IDs per node)
 * @param viewMode - The diagram view mode ('LOGICAL' or 'PHYSICAL')
 * @param temporaryDiagram - The source temporary diagram (for position/dimension lookup)
 * @returns Node conversion result with native nodes, temp-to-native ID map, and entity refs
 */
function convertNodes(
  completedNodes: CompletedNodeMapping[],
  completedAttributes: CompletedAttributeMapping[],
  viewMode: string,
  temporaryDiagram: TemporaryArchitectureDiagram
): NodeConversionResult {
  const diagramNodes: DiagramNode[] = [];
  const tempToNativeNodeMap = new Map<string, string>();
  const entityRefs: EREntityRef[] = [];

  // Build a lookup map of temporary nodes by ID for O(1) access
  const tempNodeMap = new Map(
    temporaryDiagram.nodes.map((n) => [n.id, n])
  );

  for (const nodeMapping of completedNodes) {
    const nativeNodeId = generatePrefixedId('node');
    tempToNativeNodeMap.set(nodeMapping.temporaryNodeId, nativeNodeId);

    // Derive entity_type from viewMode
    const entityType =
      viewMode === 'PHYSICAL' ? 'PHYSICAL_DATA_ENTITY' : 'LOGICAL_DATA_ENTITY';

    // Look up the temporary node for position/dimension data
    const tempNode = tempNodeMap.get(nodeMapping.temporaryNodeId);

    // Collect resolved attribute IDs for this node
    const nodeAttributeIds = completedAttributes
      .filter((attr) => attr.parentTemporaryNodeId === nodeMapping.temporaryNodeId)
      .map((attr) => attr.resolvedAttributeId);

    // Build the native DiagramNode
    const nativeNode: DiagramNode = {
      id: nativeNodeId,
      entity_type: entityType,
      entity_id: nodeMapping.resolvedEntityId,
      render_style: 'erd',
      parent_node_id: null,
      pos_x: tempNode?.pos_x ?? 0,
      pos_y: tempNode?.pos_y ?? 0,
      width: tempNode?.width ?? 180,
      height: tempNode?.height ?? 100,
      ...(tempNode?.z_index !== undefined ? { z_index: tempNode.z_index } : {}),
      embedded_attribute_ids: nodeAttributeIds,
      selected_attribute_ids: nodeAttributeIds,
    };

    diagramNodes.push(nativeNode);

    // Build EREntityRef for typedContent
    entityRefs.push({
      id: generatePrefixedId('eref'),
      entity_id: nodeMapping.resolvedEntityId,
    });
  }

  return { diagramNodes, tempToNativeNodeMap, entityRefs };
}

// ============================================================================
// EDGE CONVERSION (Task Group 1, Task 1.4)
// ============================================================================

/**
 * Result of converting completed edge mappings into native DiagramEdge objects.
 */
interface EdgeConversionResult {
  /** The native diagram edges */
  diagramEdges: DiagramEdge[];
  /** ERRelationshipRef entries for typedContent */
  relationshipRefs: ERRelationshipRef[];
}

/**
 * Converts completed edge mappings into native DiagramEdge objects.
 *
 * For each CompletedEdgeMapping:
 * - Generates a native edge ID with prefix 'edge'
 * - Sets relationship_id from resolvedRelationshipId and relationship_type to 'DATA_ENTITY_RELATIONSHIP'
 * - Remaps source_node_id and target_node_id using the temp-to-native node ID map
 * - Flattens source_label and target_label from the temporary edge into native flat fields
 * - Converts edge_points to native EdgePoint format with generated IDs
 * - Builds an ERRelationshipRef for the typedContent
 *
 * Does NOT copy style fields (line_color, line_type, line_weight) -- out of scope.
 *
 * @param completedEdges - The completed edge mappings
 * @param tempToNativeNodeMap - Map of temporary node ID -> native node ID
 * @param temporaryDiagram - The source temporary diagram (for edge data lookup)
 * @returns Edge conversion result with native edges and relationship refs
 * @throws Error if an edge references a temporary node ID not found in the temp-to-native map
 */
function convertEdges(
  completedEdges: CompletedEdgeMapping[],
  tempToNativeNodeMap: Map<string, string>,
  temporaryDiagram: TemporaryArchitectureDiagram
): EdgeConversionResult {
  const diagramEdges: DiagramEdge[] = [];
  const relationshipRefs: ERRelationshipRef[] = [];

  // Build a lookup map of temporary edges by ID for O(1) access
  const tempEdgeMap = new Map(
    (temporaryDiagram.edges || []).map((e) => [e.id, e])
  );

  for (const edgeMapping of completedEdges) {
    const nativeEdgeId = generatePrefixedId('edge');

    // Look up the temporary edge for layout data
    const tempEdge = tempEdgeMap.get(edgeMapping.temporaryEdgeId);

    // Remap source and target node IDs from temporary to native
    const sourceNodeId = tempEdge
      ? tempToNativeNodeMap.get(tempEdge.source_node_id)
      : undefined;
    const targetNodeId = tempEdge
      ? tempToNativeNodeMap.get(tempEdge.target_node_id)
      : undefined;

    if (tempEdge && !sourceNodeId) {
      throw new Error(
        `Edge '${edgeMapping.temporaryEdgeId}' references source node '${tempEdge.source_node_id}' ` +
          `which has no native ID mapping. Ensure all nodes are included in the completed mapping.`
      );
    }
    if (tempEdge && !targetNodeId) {
      throw new Error(
        `Edge '${edgeMapping.temporaryEdgeId}' references target node '${tempEdge.target_node_id}' ` +
          `which has no native ID mapping. Ensure all nodes are included in the completed mapping.`
      );
    }

    // Flatten source_label
    const sourceLabel = tempEdge?.source_label;
    const sourceLabelFields = sourceLabel
      ? {
          source_label_text: sourceLabel.text,
          source_label_pos_x: sourceLabel.pos_x,
          source_label_pos_y: sourceLabel.pos_y,
        }
      : {};

    // Flatten target_label
    const targetLabel = tempEdge?.target_label;
    const targetLabelFields = targetLabel
      ? {
          target_label_text: targetLabel.text,
          target_label_pos_x: targetLabel.pos_x,
          target_label_pos_y: targetLabel.pos_y,
        }
      : {};

    // Convert edge points to native EdgePoint format
    const nativeEdgePoints: EdgePoint[] = (tempEdge?.edge_points || []).map(
      (pt) => ({
        id: generatePrefixedId('edgept'),
        sequence_order: pt.sequence_order,
        pos_x: pt.pos_x,
        pos_y: pt.pos_y,
      })
    );

    // Build the native DiagramEdge
    // relationship_type must match the key in rendering.ts relationshipTypeMap
    // so that getRelationship() can resolve it during temporal edge filtering.
    // All data entity relationships (logical and physical) use 'LOGICAL_DATA_ENTITY_RELATIONSHIP'.
    const nativeEdge: DiagramEdge = {
      id: nativeEdgeId,
      relationship_id: edgeMapping.resolvedRelationshipId,
      relationship_type: 'LOGICAL_DATA_ENTITY_RELATIONSHIP',
      source_node_id: sourceNodeId ?? '',
      target_node_id: targetNodeId ?? '',
      edge_points: nativeEdgePoints,
      ...sourceLabelFields,
      ...targetLabelFields,
    };

    diagramEdges.push(nativeEdge);

    // Build ERRelationshipRef for typedContent
    relationshipRefs.push({
      id: generatePrefixedId('rref'),
      relationship_id: edgeMapping.resolvedRelationshipId,
    });
  }

  return { diagramEdges, relationshipRefs };
}

// ============================================================================
// TOP-LEVEL CONVERSION (Task Group 1, Task 1.5)
// ============================================================================

/**
 * Builds a native Diagram object from a fully resolved CompletedDiagramMapping
 * and the source TemporaryArchitectureDiagram.
 *
 * This is the main entry point for diagram finalization. It:
 * 1. Generates a new diagram ID via generatePrefixedId('diag')
 * 2. Converts all completed node mappings to native DiagramNode objects
 * 3. Converts all completed edge mappings to native DiagramEdge objects
 * 4. Builds the TypedContentEnvelope with ERContent (entityRefs + relationshipRefs)
 * 5. Returns the assembled Diagram ready for ADD_DIAGRAM dispatch
 *
 * @param completedMapping - The fully resolved mapping from Increment 5/6
 * @param temporaryDiagram - The source temporary architecture diagram
 * @returns A native Diagram object ready for dispatch
 * @throws Error if edge conversion encounters a missing temp-to-native node mapping
 */
export function buildNativeDiagramFromMapping(
  completedMapping: CompletedDiagramMapping,
  temporaryDiagram: TemporaryArchitectureDiagram
): Diagram {
  // Generate diagram ID
  const diagramId = generatePrefixedId('diag');

  // Convert nodes
  const { diagramNodes, tempToNativeNodeMap, entityRefs } = convertNodes(
    completedMapping.completedNodes,
    completedMapping.completedAttributes,
    completedMapping.viewMode,
    temporaryDiagram
  );

  // Convert edges
  const { diagramEdges, relationshipRefs } = convertEdges(
    completedMapping.completedEdges,
    tempToNativeNodeMap,
    temporaryDiagram
  );

  // Build TypedContent envelope
  const erContent: ERContent = {
    entityRefs,
    relationshipRefs,
  };

  const typedContent: TypedContentEnvelope = {
    type: 'ER',
    version: 1,
    content: erContent,
  };

  // Assemble the native Diagram
  const diagram: Diagram = {
    id: diagramId,
    name: temporaryDiagram.name,
    description: temporaryDiagram.description ?? '',
    diagram_type: 'ER',
    diagram_nodes: diagramNodes,
    diagram_edges: diagramEdges,
    typedContent,
    decorations: [],
    label_decorations: [],
    settings: {},
  };

  return diagram;
}

// ============================================================================
// FULLY MATCHED AUTO-DERIVATION (Task Group 2)
// ============================================================================

/**
 * Builds a CompletedDiagramMapping from a fully_matched DiagramMappingResult.
 *
 * This function is used for auto-finalization when the deterministic mapping engine
 * resolves all nodes, attributes, and edges without any unmatched items. Since
 * `overallStatus === 'fully_matched'` guarantees that every `matchedEntityId`,
 * `matchedAttributeId`, and `matchedRelationshipId` is non-null, this function
 * safely casts them to non-null strings.
 *
 * The output shape is identical to what `buildCompletedMapping` from
 * `mappingConfirmationUtils.ts` produces, ensuring both the auto-finalization
 * and manual confirmation paths feed the same downstream conversion pipeline.
 *
 * @param mappingResult - A DiagramMappingResult with overallStatus === 'fully_matched'
 * @param temporaryDiagram - The source temporary architecture diagram
 * @returns A CompletedDiagramMapping with all resolved IDs guaranteed non-null
 */
export function buildCompletedMappingFromFullMatch(
  mappingResult: DiagramMappingResult,
  temporaryDiagram: TemporaryArchitectureDiagram
): CompletedDiagramMapping {
  const completedNodes: CompletedNodeMapping[] = mappingResult.nodes.map((node) => ({
    temporaryNodeId: node.temporaryNodeId,
    resolvedEntityId: node.matchedEntityId as string,
  }));

  const completedAttributes: CompletedAttributeMapping[] = mappingResult.attributes.map((attr) => ({
    temporaryItemId: attr.temporaryItemId,
    parentTemporaryNodeId: attr.parentTemporaryNodeId,
    resolvedAttributeId: attr.matchedAttributeId as string,
  }));

  const completedEdges: CompletedEdgeMapping[] = mappingResult.edges.map((edge) => ({
    temporaryEdgeId: edge.temporaryEdgeId,
    resolvedRelationshipId: edge.matchedRelationshipId as string,
  }));

  return {
    completedNodes,
    completedAttributes,
    completedEdges,
    newRelationships: [],
    sourceTemporaryDiagram: temporaryDiagram,
    viewMode: temporaryDiagram.view_mode,
  };
}

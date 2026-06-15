/**
 * Standalone Validator for TemporaryArchitectureDiagram Payloads
 *
 * Performs comprehensive structural, ER-specific, semantic type consistency,
 * node, edge, compartment, and group validation. Returns an array of
 * human-readable error messages (empty array means valid).
 *
 * Semantics are aligned with the frontend validation helpers in
 * `frontend/src/types/temporaryArchitectureDiagramValidation.ts` but
 * implemented independently -- no imports from frontend.
 *
 * @module temporaryArchitectureDiagramValidator
 */

// ============================================================================
// Main Validator
// ============================================================================

/**
 * Validates a parsed TemporaryArchitectureDiagram payload.
 *
 * Accumulates all error messages and returns them as an array.
 * An empty array means the payload is valid.
 *
 * @param parsed - The unknown value to validate (should be a parsed JSON object)
 * @returns Array of error message strings (empty = valid)
 */
export function validateTemporaryArchitectureDiagram(parsed: unknown): string[] {
  const errors: string[] = [];

  // ========================================================================
  // Null / undefined / non-object guard
  // ========================================================================

  if (parsed === null || parsed === undefined || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errors.push('Diagram payload must be a non-null object');
    return errors;
  }

  const diagram = parsed as Record<string, unknown>;

  // ========================================================================
  // Structural checks: required top-level fields
  // ========================================================================

  if (typeof diagram.id !== 'string' || diagram.id.trim() === '') {
    errors.push('id is required and must be a non-empty string');
  }

  if (typeof diagram.name !== 'string' || diagram.name.trim() === '') {
    errors.push('name is required and must be a non-empty string');
  }

  if (typeof diagram.diagram_kind !== 'string' || diagram.diagram_kind.trim() === '') {
    errors.push('diagram_kind is required and must be a non-empty string');
  }

  if (typeof diagram.source_architecture_domain !== 'string' || diagram.source_architecture_domain.trim() === '') {
    errors.push('source_architecture_domain is required and must be a non-empty string');
  }

  if (typeof diagram.view_mode !== 'string' || diagram.view_mode.trim() === '') {
    errors.push('view_mode is required and must be a non-empty string');
  }

  if (typeof diagram.version !== 'number') {
    errors.push('version is required and must be a number');
  }

  if (!Array.isArray(diagram.nodes)) {
    errors.push('nodes is required and must be an array');
  }

  if (!Array.isArray(diagram.edges)) {
    errors.push('edges is required and must be an array');
  }

  // If structural checks failed for critical fields, return early to avoid
  // cascading errors from deeper validation
  if (!Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) {
    return errors;
  }

  const diagramKind = diagram.diagram_kind as string;
  const sourceArchDomain = diagram.source_architecture_domain as string;
  const viewMode = diagram.view_mode as string;

  // ========================================================================
  // ER-specific checks
  // ========================================================================

  if (typeof diagramKind === 'string' && diagramKind !== 'ER') {
    errors.push(`diagram_kind must be "ER" but got "${diagramKind}"`);
  }

  if (typeof sourceArchDomain === 'string' && sourceArchDomain !== 'DATA') {
    errors.push(`source_architecture_domain must be "DATA" but got "${sourceArchDomain}"`);
  }

  if (typeof viewMode === 'string' && viewMode !== 'LOGICAL' && viewMode !== 'PHYSICAL') {
    errors.push(`view_mode must be "LOGICAL" or "PHYSICAL" but got "${viewMode}"`);
  }

  // ========================================================================
  // Determine expected semantic types based on view_mode
  // ========================================================================

  const isValidViewMode = viewMode === 'LOGICAL' || viewMode === 'PHYSICAL';

  const expectedNodeSemanticType =
    viewMode === 'LOGICAL' ? 'LOGICAL_DATA_ENTITY' :
    viewMode === 'PHYSICAL' ? 'PHYSICAL_DATA_ENTITY' :
    null;

  const expectedItemSemanticType =
    viewMode === 'LOGICAL' ? 'LOGICAL_DATA_ATTRIBUTE' :
    viewMode === 'PHYSICAL' ? 'PHYSICAL_DATA_ATTRIBUTE' :
    null;

  // ========================================================================
  // Node validation
  // ========================================================================

  const nodes = diagram.nodes as unknown[];
  const nodeIdSet = new Set<string>();
  const nodeRefNameMap = new Map<string, string>(); // nodeId -> ref_name

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as Record<string, unknown> | null;

    if (node === null || node === undefined || typeof node !== 'object' || Array.isArray(node)) {
      errors.push(`nodes[${i}] must be a non-null object`);
      continue;
    }

    // Node ID: required, unique
    const nodeId = node.id;
    if (typeof nodeId !== 'string' || nodeId.trim() === '') {
      errors.push(`nodes[${i}].id is required and must be a non-empty string`);
    } else {
      if (nodeIdSet.has(nodeId)) {
        errors.push(`Duplicate node id: "${nodeId}"`);
      }
      nodeIdSet.add(nodeId);
    }

    // Node ref_name: required, non-empty
    const refName = node.ref_name;
    if (typeof refName !== 'string' || refName.trim() === '') {
      errors.push(`nodes[${i}].ref_name is required and must be a non-empty string`);
    } else if (typeof nodeId === 'string') {
      nodeRefNameMap.set(nodeId, refName);
    }

    // Semantic type consistency
    if (isValidViewMode && expectedNodeSemanticType) {
      const semanticType = node.semantic_type;
      if (typeof semanticType === 'string' && semanticType !== expectedNodeSemanticType) {
        errors.push(
          `Node "${nodeId}" has semantic_type "${semanticType}" but expected "${expectedNodeSemanticType}" for ${viewMode} view_mode`
        );
      }
    }

    // Position and size: required numbers
    if (typeof node.pos_x !== 'number') {
      errors.push(`nodes[${i}].pos_x must be a number`);
    }
    if (typeof node.pos_y !== 'number') {
      errors.push(`nodes[${i}].pos_y must be a number`);
    }
    if (typeof node.width !== 'number') {
      errors.push(`nodes[${i}].width must be a number`);
    }
    if (typeof node.height !== 'number') {
      errors.push(`nodes[${i}].height must be a number`);
    }

    // Compartment validation
    if (node.compartments !== undefined && node.compartments !== null) {
      if (!Array.isArray(node.compartments)) {
        errors.push(`nodes[${i}].compartments must be an array`);
      } else {
        const compartments = node.compartments as unknown[];
        let attributesCompartmentCount = 0;
        const attributeRefNames = new Set<string>();

        for (let c = 0; c < compartments.length; c++) {
          const comp = compartments[c] as Record<string, unknown> | null;

          if (comp === null || comp === undefined || typeof comp !== 'object' || Array.isArray(comp)) {
            errors.push(`nodes[${i}].compartments[${c}] must be a non-null object`);
            continue;
          }

          const compKind = comp.compartment_kind;
          if (typeof compKind === 'string' && compKind === 'ATTRIBUTES') {
            attributesCompartmentCount++;
          }

          // Compartment items validation
          if (!Array.isArray(comp.items)) {
            errors.push(`nodes[${i}].compartments[${c}].items must be an array`);
            continue;
          }

          const items = comp.items as unknown[];
          for (let j = 0; j < items.length; j++) {
            const item = items[j] as Record<string, unknown> | null;

            if (item === null || item === undefined || typeof item !== 'object' || Array.isArray(item)) {
              errors.push(`nodes[${i}].compartments[${c}].items[${j}] must be a non-null object`);
              continue;
            }

            // Item ref_name: required, non-empty
            const itemRefName = item.ref_name;
            if (typeof itemRefName !== 'string' || itemRefName.trim() === '') {
              errors.push(`nodes[${i}].compartments[${c}].items[${j}].ref_name is required and must be a non-empty string`);
            } else {
              // Check for duplicate attribute ref_name within this node
              if (attributeRefNames.has(itemRefName)) {
                errors.push(`Duplicate attribute ref_name "${itemRefName}" in node "${nodeId}"`);
              }
              attributeRefNames.add(itemRefName);
            }

            // Item semantic type consistency
            if (isValidViewMode && expectedItemSemanticType) {
              const itemSemanticType = item.semantic_type;
              if (typeof itemSemanticType === 'string' && itemSemanticType !== expectedItemSemanticType) {
                errors.push(
                  `Compartment item "${item.id}" in node "${nodeId}" has semantic_type "${itemSemanticType}" but expected "${expectedItemSemanticType}" for ${viewMode} view_mode`
                );
              }
            }
          }
        }

        // At most one ATTRIBUTES compartment per node
        if (attributesCompartmentCount > 1) {
          errors.push(`Node "${nodeId}" has ${attributesCompartmentCount} ATTRIBUTES compartments but at most 1 is allowed`);
        }
      }
    }
  }

  // ========================================================================
  // Edge validation
  // ========================================================================

  const edges = diagram.edges as unknown[];
  const edgeIdSet = new Set<string>();

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i] as Record<string, unknown> | null;

    if (edge === null || edge === undefined || typeof edge !== 'object' || Array.isArray(edge)) {
      errors.push(`edges[${i}] must be a non-null object`);
      continue;
    }

    // Edge ID: required, unique
    const edgeId = edge.id;
    if (typeof edgeId !== 'string' || edgeId.trim() === '') {
      errors.push(`edges[${i}].id is required and must be a non-empty string`);
    } else {
      if (edgeIdSet.has(edgeId)) {
        errors.push(`Duplicate edge id: "${edgeId}"`);
      }
      edgeIdSet.add(edgeId);
    }

    // source_node_id: must reference existing node
    const sourceNodeId = edge.source_node_id;
    if (typeof sourceNodeId !== 'string' || sourceNodeId.trim() === '') {
      errors.push(`edges[${i}].source_node_id is required and must be a non-empty string`);
    } else if (!nodeIdSet.has(sourceNodeId)) {
      errors.push(`Edge "${edgeId}" references source_node_id "${sourceNodeId}" which does not exist in nodes`);
    }

    // target_node_id: must reference existing node
    const targetNodeId = edge.target_node_id;
    if (typeof targetNodeId !== 'string' || targetNodeId.trim() === '') {
      errors.push(`edges[${i}].target_node_id is required and must be a non-empty string`);
    } else if (!nodeIdSet.has(targetNodeId)) {
      errors.push(`Edge "${edgeId}" references target_node_id "${targetNodeId}" which does not exist in nodes`);
    }

    // source_ref_name: must match source node's ref_name
    const sourceRefName = edge.source_ref_name;
    if (typeof sourceRefName === 'string' && typeof sourceNodeId === 'string' && nodeRefNameMap.has(sourceNodeId)) {
      const expectedRefName = nodeRefNameMap.get(sourceNodeId)!;
      if (sourceRefName !== expectedRefName) {
        errors.push(
          `Edge "${edgeId}" has source_ref_name "${sourceRefName}" but source node "${sourceNodeId}" has ref_name "${expectedRefName}"`
        );
      }
    }

    // target_ref_name: must match target node's ref_name
    const targetRefName = edge.target_ref_name;
    if (typeof targetRefName === 'string' && typeof targetNodeId === 'string' && nodeRefNameMap.has(targetNodeId)) {
      const expectedRefName = nodeRefNameMap.get(targetNodeId)!;
      if (targetRefName !== expectedRefName) {
        errors.push(
          `Edge "${edgeId}" has target_ref_name "${targetRefName}" but target node "${targetNodeId}" has ref_name "${expectedRefName}"`
        );
      }
    }

    // edge_points validation
    const edgePoints = edge.edge_points;
    if (!Array.isArray(edgePoints)) {
      errors.push(`edges[${i}].edge_points is required and must be an array`);
    } else if (edgePoints.length < 2) {
      errors.push(`Edge "${edgeId}" must have at least 2 edge_points but has ${edgePoints.length}`);
    } else {
      // Check contiguous sequence_order starting from 0
      const points = edgePoints as Record<string, unknown>[];
      for (let p = 0; p < points.length; p++) {
        const point = points[p];
        if (point === null || point === undefined || typeof point !== 'object' || Array.isArray(point)) {
          errors.push(`Edge "${edgeId}" edge_points[${p}] must be a non-null object`);
          continue;
        }
        const seqOrder = point.sequence_order;
        if (typeof seqOrder !== 'number' || seqOrder !== p) {
          errors.push(
            `Edge "${edgeId}" edge_points[${p}].sequence_order must be ${p} but got ${seqOrder}`
          );
        }
        if (typeof point.pos_x !== 'number') {
          errors.push(`Edge "${edgeId}" edge_points[${p}].pos_x must be a number`);
        }
        if (typeof point.pos_y !== 'number') {
          errors.push(`Edge "${edgeId}" edge_points[${p}].pos_y must be a number`);
        }
      }
    }
  }

  // ========================================================================
  // Group validation (optional groups array)
  // ========================================================================

  if (diagram.groups !== undefined && diagram.groups !== null) {
    if (!Array.isArray(diagram.groups)) {
      errors.push('groups must be an array');
    } else {
      const groups = diagram.groups as unknown[];
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i] as Record<string, unknown> | null;

        if (group === null || group === undefined || typeof group !== 'object' || Array.isArray(group)) {
          errors.push(`groups[${i}] must be a non-null object`);
          continue;
        }

        // Check child_node_ids reference existing nodes
        const childNodeIds = group.child_node_ids;
        if (Array.isArray(childNodeIds)) {
          for (const childId of childNodeIds as unknown[]) {
            if (typeof childId === 'string' && !nodeIdSet.has(childId)) {
              errors.push(
                `Group "${group.id}" references child_node_id "${childId}" which does not exist in nodes`
              );
            }
          }
        }
      }
    }
  }

  return errors;
}

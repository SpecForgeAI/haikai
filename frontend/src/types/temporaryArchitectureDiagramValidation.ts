/**
 * Validation Helpers for the Temporary Architecture Diagram JSON Contract
 *
 * This file provides lightweight, plain runtime validation functions for
 * `TemporaryArchitectureDiagram` payloads. All helpers are pure JavaScript/TypeScript
 * runtime checks -- no external validation libraries (Zod, io-ts, JSON Schema) are used.
 *
 * The helpers are organized into three categories:
 * 1. **Type guard**: `isTemporaryArchitectureDiagram` -- checks structural presence of required fields
 * 2. **ER-specific validators**: `isValidERDiagram`, `checkSemanticTypeConsistency` -- check ER constraints
 * 3. **Internal reference checker**: `checkReferenceConsistency` -- checks edge/group node ID references
 *
 * @module temporaryArchitectureDiagramValidation
 */

import type { TemporaryArchitectureDiagram } from './temporaryArchitectureDiagram';

// ============================================================================
// Type Guard
// ============================================================================

/**
 * Lightweight type guard that checks whether an unknown value has the shape
 * of a `TemporaryArchitectureDiagram`.
 *
 * Verifies presence and correct JavaScript types of all required top-level fields:
 * `id`, `name`, `diagram_kind`, `source_architecture_domain`, `view_mode`,
 * `version`, `nodes`, `edges`.
 *
 * This is a structural check only -- it does NOT validate semantic constraints
 * (e.g., correct `semantic_type` values for a given `view_mode`). Use
 * `checkSemanticTypeConsistency` for that.
 *
 * @param obj - The value to check.
 * @returns `true` if `obj` has the required shape of a `TemporaryArchitectureDiagram`.
 */
export function isTemporaryArchitectureDiagram(obj: unknown): obj is TemporaryArchitectureDiagram {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return false;
  }

  const candidate = obj as Record<string, unknown>;

  // Check all 8 required top-level fields exist and have correct types
  if (typeof candidate.id !== 'string') return false;
  if (typeof candidate.name !== 'string') return false;
  if (typeof candidate.diagram_kind !== 'string') return false;
  if (typeof candidate.source_architecture_domain !== 'string') return false;
  if (typeof candidate.view_mode !== 'string') return false;
  if (typeof candidate.version !== 'number') return false;
  if (!Array.isArray(candidate.nodes)) return false;
  if (!Array.isArray(candidate.edges)) return false;

  return true;
}

// ============================================================================
// ER-Specific Validators
// ============================================================================

/**
 * Checks whether a `TemporaryArchitectureDiagram` is a valid ER diagram.
 *
 * A valid ER diagram must have:
 * - `diagram_kind` equal to `'ER'`
 * - `view_mode` equal to `'LOGICAL'` or `'PHYSICAL'`
 *
 * @param diagram - The diagram to check.
 * @returns `true` if the diagram is a valid ER diagram.
 */
export function isValidERDiagram(diagram: TemporaryArchitectureDiagram): boolean {
  if (diagram.diagram_kind !== 'ER') {
    return false;
  }

  if (diagram.view_mode !== 'LOGICAL' && diagram.view_mode !== 'PHYSICAL') {
    return false;
  }

  return true;
}

/**
 * Checks semantic type consistency for an ER diagram.
 *
 * For LOGICAL diagrams, verifies:
 * - All nodes use `semantic_type = "LOGICAL_DATA_ENTITY"`
 * - All compartment items use `semantic_type = "LOGICAL_DATA_ATTRIBUTE"`
 *
 * For PHYSICAL diagrams, verifies:
 * - All nodes use `semantic_type = "PHYSICAL_DATA_ENTITY"`
 * - All compartment items use `semantic_type = "PHYSICAL_DATA_ATTRIBUTE"`
 *
 * Returns an empty array if all semantic types are consistent, or an array
 * of human-readable inconsistency messages describing each mismatch.
 *
 * @param diagram - The diagram to check. Should have `diagram_kind === 'ER'`.
 * @returns An array of inconsistency messages (empty if consistent).
 */
export function checkSemanticTypeConsistency(diagram: TemporaryArchitectureDiagram): string[] {
  const messages: string[] = [];

  const viewMode = diagram.view_mode;

  const expectedNodeSemanticType =
    viewMode === 'LOGICAL' ? 'LOGICAL_DATA_ENTITY' :
    viewMode === 'PHYSICAL' ? 'PHYSICAL_DATA_ENTITY' :
    null;

  const expectedItemSemanticType =
    viewMode === 'LOGICAL' ? 'LOGICAL_DATA_ATTRIBUTE' :
    viewMode === 'PHYSICAL' ? 'PHYSICAL_DATA_ATTRIBUTE' :
    null;

  if (expectedNodeSemanticType === null || expectedItemSemanticType === null) {
    messages.push(`Unknown view_mode "${viewMode}"; cannot determine expected semantic types.`);
    return messages;
  }

  for (const node of diagram.nodes) {
    if (node.semantic_type !== expectedNodeSemanticType) {
      messages.push(
        `Node "${node.id}" has semantic_type "${node.semantic_type}" but expected "${expectedNodeSemanticType}" for ${viewMode} view_mode.`
      );
    }

    if (node.compartments) {
      for (const compartment of node.compartments) {
        for (const item of compartment.items) {
          if (item.semantic_type !== expectedItemSemanticType) {
            messages.push(
              `Compartment item "${item.id}" in node "${node.id}" has semantic_type "${item.semantic_type}" but expected "${expectedItemSemanticType}" for ${viewMode} view_mode.`
            );
          }
        }
      }
    }
  }

  return messages;
}

// ============================================================================
// Internal Reference Consistency Checker
// ============================================================================

/**
 * Checks internal reference consistency within a temporary architecture diagram.
 *
 * Verifies:
 * - All `source_node_id` values on edges reference existing node IDs
 * - All `target_node_id` values on edges reference existing node IDs
 * - All `child_node_ids` values in groups reference existing node IDs
 *
 * Returns an empty array if all references are valid, or an array of
 * human-readable messages describing each broken reference.
 *
 * @param diagram - The diagram to check.
 * @returns An array of broken reference messages (empty if all references are valid).
 */
export function checkReferenceConsistency(diagram: TemporaryArchitectureDiagram): string[] {
  const messages: string[] = [];

  const nodeIds = new Set(diagram.nodes.map((node) => node.id));

  // Check edge source_node_id and target_node_id references
  for (const edge of diagram.edges) {
    if (!nodeIds.has(edge.source_node_id)) {
      messages.push(
        `Edge "${edge.id}" references source_node_id "${edge.source_node_id}" which does not exist in the diagram's nodes.`
      );
    }

    if (!nodeIds.has(edge.target_node_id)) {
      messages.push(
        `Edge "${edge.id}" references target_node_id "${edge.target_node_id}" which does not exist in the diagram's nodes.`
      );
    }
  }

  // Check group child_node_ids references
  if (diagram.groups) {
    for (const group of diagram.groups) {
      for (const childId of group.child_node_ids) {
        if (!nodeIds.has(childId)) {
          messages.push(
            `Group "${group.id}" references child_node_id "${childId}" which does not exist in the diagram's nodes.`
          );
        }
      }
    }
  }

  return messages;
}

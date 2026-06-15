/**
 * ERD Advanced Add Utilities
 * Task Group 4: Utility functions for ERD-style node detection in Advanced Add dialog
 *
 * These utilities help identify when a selection in the Advanced Add dialog
 * should produce ERD-style nodes instead of standard hierarchical containment.
 *
 * Spec: Fix Interface Composite Rendering
 * - Added physicalEntities to InterfaceCustomCandidate type
 * - Updated isInterfaceCustomLayoutCandidate to check PHYSICAL_DATA_ENTITY
 * - Updated findInterfaceCustomCandidates to collect physical entities
 */

import { MetaModel, ENTITY_TYPES } from '../types/model';
import { TreeNodeData } from '../types/advancedAdd';

// ============================================================================
// ERD Candidate Types
// ============================================================================

/**
 * Represents a candidate for ERD-style rendering.
 * Contains a data entity and its selected attribute children.
 */
export interface ERDCandidate {
  /** The parent entity node (LOGICAL_DATA_ENTITY or PHYSICAL_DATA_ENTITY) */
  entity: TreeNodeData;
  /** Selected attribute children of this entity */
  attributes: TreeNodeData[];
}

// ============================================================================
// Interface Custom Candidate Types (Task Group 3)
// Spec: Fix Interface Composite Rendering - Extended with physicalEntities
// ============================================================================

/**
 * Represents a candidate for Interface custom layout rendering.
 * Contains an Interface and its selected Endpoint, LogicalDataEntity, and/or PhysicalDataEntity children.
 *
 * Spec: Fix Interface Composite Rendering (Task Group 1.2)
 * - Added physicalEntities field to support physical entity children
 */
export interface InterfaceCustomCandidate {
  /** The Interface entity node */
  interface: TreeNodeData;
  /** Selected Endpoint children of this Interface */
  endpoints: TreeNodeData[];
  /** Selected LogicalDataEntity children of this Interface */
  logicalEntities: TreeNodeData[];
  /** Selected PhysicalDataEntity children of this Interface */
  physicalEntities: TreeNodeData[];
}

// ============================================================================
// Entity Type Checking
// ============================================================================

/**
 * Check if an entity type is a data entity (supports ERD rendering)
 */
export function isDataEntityType(entityType: string): boolean {
  return (
    entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY ||
    entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY
  );
}

/**
 * Check if an entity type is a data attribute
 */
export function isDataAttributeType(entityType: string): boolean {
  return (
    entityType === ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE ||
    entityType === ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE
  );
}

/**
 * Check if an entity type is an attribute type (LOGICAL_DATA_ATTRIBUTE or PHYSICAL_DATA_ATTRIBUTE).
 *
 * These entity types should NEVER be created as diagram nodes - they should only be used
 * for ERD-style rendering inside their parent entity nodes.
 *
 * Task Group 1: Shared helper function for attribute type detection.
 * Used by compoundLayout.ts and PalettePanel.tsx to filter out attribute nodes.
 *
 * @param entityType - The entity type to check
 * @returns true if the entity type is an attribute type, false otherwise
 */
export function isAttributeEntityType(entityType: string): boolean {
  // Handle null/undefined/empty string edge cases
  if (!entityType) {
    return false;
  }
  return (
    entityType === ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE ||
    entityType === ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE
  );
}

/**
 * Check if a parent entity type matches an attribute type.
 * - LOGICAL_DATA_ENTITY -> LOGICAL_DATA_ATTRIBUTE
 * - PHYSICAL_DATA_ENTITY -> PHYSICAL_DATA_ATTRIBUTE
 */
function attributeMatchesParent(parentType: string, attributeType: string): boolean {
  if (parentType === ENTITY_TYPES.LOGICAL_DATA_ENTITY) {
    return attributeType === ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE;
  }
  if (parentType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY) {
    return attributeType === ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE;
  }
  return false;
}

// ============================================================================
// ERD Candidate Detection
// ============================================================================

/**
 * Find ERD candidates in a selection.
 *
 * An ERD candidate is a data entity (Logical or Physical) that has one or more
 * of its attribute children selected. When an ERD candidate is detected,
 * the entity should be rendered in ERD-style (class-box) with the attributes
 * embedded as rows, rather than as separate child nodes.
 *
 * @param orderedNodes - Nodes ordered from the Advanced Add dialog
 * @param selectedKeys - Set of selected node keys
 * @param _metaModel - The meta-model for entity lookups (reserved for future use)
 * @returns Array of ERD candidates
 */
export function findERDCandidates(
  orderedNodes: TreeNodeData[],
  selectedKeys: Set<string>,
  _metaModel: MetaModel
): ERDCandidate[] {
  const candidates: ERDCandidate[] = [];

  // Process each node to find data entities with selected attributes
  function processNode(node: TreeNodeData): void {
    // Check if this is a data entity
    if (isDataEntityType(node.entityType) && selectedKeys.has(node.key)) {
      // Find selected attribute children
      const selectedAttributes = node.children.filter(child =>
        isDataAttributeType(child.entityType) &&
        attributeMatchesParent(node.entityType, child.entityType) &&
        selectedKeys.has(child.key)
      );

      // If entity has selected attributes, it's an ERD candidate
      if (selectedAttributes.length > 0) {
        candidates.push({
          entity: node,
          attributes: selectedAttributes,
        });
      }
    }

    // Recursively process children
    for (const child of node.children) {
      processNode(child);
    }
  }

  // Process all root nodes
  for (const node of orderedNodes) {
    processNode(node);
  }

  return candidates;
}

/**
 * Get attribute IDs from an ERD candidate.
 * Returns the entity IDs of the selected attributes.
 *
 * @param candidate - The ERD candidate
 * @returns Array of attribute entity IDs
 */
export function getERDCandidateAttributeIds(candidate: ERDCandidate): string[] {
  return candidate.attributes.map(attr => attr.entityId);
}

/**
 * Check if a tree node is part of an ERD candidate's attributes.
 * Used to filter out attribute nodes from normal rendering when they
 * will be embedded in an ERD-style node.
 *
 * @param node - The node to check
 * @param candidates - Array of ERD candidates
 * @returns True if the node is an embedded attribute
 */
export function isEmbeddedAttribute(
  node: TreeNodeData,
  candidates: ERDCandidate[]
): boolean {
  for (const candidate of candidates) {
    for (const attr of candidate.attributes) {
      if (attr.key === node.key) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a tree node is an ERD entity candidate.
 *
 * @param node - The node to check
 * @param candidates - Array of ERD candidates
 * @returns True if the node is an ERD entity candidate
 */
export function isERDEntityCandidate(
  node: TreeNodeData,
  candidates: ERDCandidate[]
): boolean {
  return candidates.some(c => c.entity.key === node.key);
}

/**
 * Get the ERD candidate for a given entity node.
 *
 * @param node - The entity node to look up
 * @param candidates - Array of ERD candidates
 * @returns The ERD candidate or undefined if not found
 */
export function getERDCandidateForEntity(
  node: TreeNodeData,
  candidates: ERDCandidate[]
): ERDCandidate | undefined {
  return candidates.find(c => c.entity.key === node.key);
}

// ============================================================================
// Interface Custom Layout Detection (Task Group 3)
// Spec: Fix Interface Composite Rendering - Updated for physical entity support
// ============================================================================

/**
 * Check if a node is an Interface with selected Endpoint, LogicalDataEntity, or PhysicalDataEntity children.
 *
 * An Interface should use custom layout rendering when:
 * 1. It is an INTERFACE entity type
 * 2. It is selected
 * 3. It has at least one selected ENDPOINT, LOGICAL_DATA_ENTITY, or PHYSICAL_DATA_ENTITY child
 *
 * Spec: Fix Interface Composite Rendering (Task Group 1.3)
 * - Updated to check for PHYSICAL_DATA_ENTITY children in addition to ENDPOINT and LOGICAL_DATA_ENTITY
 *
 * @param node - The tree node to check
 * @param selectedKeys - Set of selected node keys
 * @param _metaModel - The meta-model for entity lookups (reserved for future use)
 * @returns True if the node should use Interface custom layout
 */
export function isInterfaceCustomLayoutCandidate(
  node: TreeNodeData,
  selectedKeys: Set<string>,
  _metaModel: MetaModel
): boolean {
  // Must be an INTERFACE entity type
  if (node.entityType !== ENTITY_TYPES.INTERFACE) {
    return false;
  }

  // Must be selected itself
  if (!selectedKeys.has(node.key)) {
    return false;
  }

  // Must have at least one selected ENDPOINT, LOGICAL_DATA_ENTITY, or PHYSICAL_DATA_ENTITY child
  // Spec: Fix Interface Composite Rendering (Task Group 1.3) - Added PHYSICAL_DATA_ENTITY check
  const hasSelectedChild = node.children.some(child =>
    (child.entityType === ENTITY_TYPES.ENDPOINT ||
     child.entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY ||
     child.entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY) &&
    selectedKeys.has(child.key)
  );

  return hasSelectedChild;
}

/**
 * Find all Interface custom layout candidates in a selection.
 *
 * Recursively searches through the tree to find all Interface nodes
 * that qualify for custom layout rendering.
 *
 * Spec: Fix Interface Composite Rendering (Task Group 1.4)
 * - Updated to collect physical entities alongside logical entities
 *
 * @param orderedNodes - Root nodes from the Advanced Add dialog
 * @param selectedKeys - Set of selected node keys
 * @param metaModel - The meta-model for entity lookups
 * @returns Array of Interface custom layout candidates
 */
export function findInterfaceCustomCandidates(
  orderedNodes: TreeNodeData[],
  selectedKeys: Set<string>,
  metaModel: MetaModel
): InterfaceCustomCandidate[] {
  const candidates: InterfaceCustomCandidate[] = [];

  // Process each node to find Interface custom layout candidates
  function processNode(node: TreeNodeData): void {
    // Check if this is an Interface custom layout candidate
    if (isInterfaceCustomLayoutCandidate(node, selectedKeys, metaModel)) {
      // Find selected Endpoint children
      const selectedEndpoints = node.children.filter(child =>
        child.entityType === ENTITY_TYPES.ENDPOINT &&
        selectedKeys.has(child.key)
      );

      // Find selected LogicalDataEntity children
      const selectedLogicalEntities = node.children.filter(child =>
        child.entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY &&
        selectedKeys.has(child.key)
      );

      // Spec: Fix Interface Composite Rendering (Task Group 1.4)
      // Find selected PhysicalDataEntity children
      const selectedPhysicalEntities = node.children.filter(child =>
        child.entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY &&
        selectedKeys.has(child.key)
      );

      candidates.push({
        interface: node,
        endpoints: selectedEndpoints,
        logicalEntities: selectedLogicalEntities,
        physicalEntities: selectedPhysicalEntities,
      });
    }

    // Recursively process children
    for (const child of node.children) {
      processNode(child);
    }
  }

  // Process all root nodes
  for (const node of orderedNodes) {
    processNode(node);
  }

  return candidates;
}

/**
 * Get endpoint IDs from an Interface custom candidate.
 *
 * @param candidate - The Interface custom candidate
 * @returns Array of endpoint entity IDs
 */
export function getInterfaceCustomCandidateEndpointIds(
  candidate: InterfaceCustomCandidate
): string[] {
  return candidate.endpoints.map(ep => ep.entityId);
}

/**
 * Get logical entity IDs from an Interface custom candidate.
 *
 * @param candidate - The Interface custom candidate
 * @returns Array of logical entity IDs
 */
export function getInterfaceCustomCandidateEntityIds(
  candidate: InterfaceCustomCandidate
): string[] {
  return candidate.logicalEntities.map(le => le.entityId);
}

/**
 * Get physical entity IDs from an Interface custom candidate.
 *
 * Spec: Fix Interface Composite Rendering
 *
 * @param candidate - The Interface custom candidate
 * @returns Array of physical entity IDs
 */
export function getInterfaceCustomCandidatePhysicalEntityIds(
  candidate: InterfaceCustomCandidate
): string[] {
  return candidate.physicalEntities.map(pe => pe.entityId);
}

/**
 * Check if a tree node is part of an Interface custom candidate's children.
 * Used to filter out Endpoint/LogicalEntity/PhysicalEntity nodes from normal rendering
 * when they will be embedded in the Interface custom rendering.
 *
 * Spec: Fix Interface Composite Rendering
 * - Updated to also check physicalEntities array
 *
 * @param node - The node to check
 * @param candidates - Array of Interface custom candidates
 * @returns True if the node is an embedded child of an Interface
 */
export function isEmbeddedInterfaceChild(
  node: TreeNodeData,
  candidates: InterfaceCustomCandidate[]
): boolean {
  for (const candidate of candidates) {
    // Check if node is an embedded endpoint
    for (const ep of candidate.endpoints) {
      if (ep.key === node.key) {
        return true;
      }
    }
    // Check if node is an embedded logical entity
    for (const le of candidate.logicalEntities) {
      if (le.key === node.key) {
        return true;
      }
    }
    // Spec: Fix Interface Composite Rendering
    // Check if node is an embedded physical entity
    for (const pe of candidate.physicalEntities) {
      if (pe.key === node.key) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a tree node is an Interface custom layout candidate.
 *
 * @param node - The node to check
 * @param candidates - Array of Interface custom candidates
 * @returns True if the node is an Interface custom layout candidate
 */
export function isInterfaceCustomCandidate(
  node: TreeNodeData,
  candidates: InterfaceCustomCandidate[]
): boolean {
  return candidates.some(c => c.interface.key === node.key);
}

/**
 * Get the Interface custom candidate for a given Interface node.
 *
 * @param node - The Interface node to look up
 * @param candidates - Array of Interface custom candidates
 * @returns The Interface custom candidate or undefined if not found
 */
export function getInterfaceCustomCandidateForNode(
  node: TreeNodeData,
  candidates: InterfaceCustomCandidate[]
): InterfaceCustomCandidate | undefined {
  return candidates.find(c => c.interface.key === node.key);
}

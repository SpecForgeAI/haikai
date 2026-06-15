/**
 * AdvancedAddDialog Component
 *
 * Modal dialog for the Advanced Add feature that allows users to
 * add an entity along with related entities in a single operation.
 * Uses a tree-based selection UI driven by meta-model relationships.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { MetaModel, ENTITY_TYPES, Interaction, resolveAppBusinessPoint } from '../../types/model';
import {
  TreeNodeData,
  TreeSelectionState,
  SelectionDescriptor,
  AdvancedAddResult,
  SpacingPreset,
  DEFAULT_SPACING_PRESET,
  DEFAULT_LAYOUT_CONFIG,
  LAYOUT_CONSTRAINTS,
} from '../../types/advancedAdd';
import {
  getExpandableRelationships,
  getRelationshipKindLabel,
  ExpandableRelationship,
} from '../../utils/advancedAddRelationships';
import { resolveDataEntitiesForInterface } from '../../utils/dataEntityPointOptions';
import styles from './AdvancedAddDialog.module.css';

// ============================================================================
// Types
// ============================================================================

interface AdvancedAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (result: AdvancedAddResult) => void;
  rootEntity: {
    id: string;
    name: string;
    type: string;
  };
  metaModel: MetaModel;
  isLoading?: boolean;
  error?: string | null;
  mode?: 'add' | 'edit';
  initialSelectedKeys?: Set<string>;
}

interface TreeNodeComponentProps {
  node: TreeNodeData;
  selectionState: TreeSelectionState;
  expandedState: Record<string, boolean>;
  onToggleSelection: (nodeKey: string) => void;
  onToggleExpand: (nodeKey: string) => void;
  depth: number;
}

/**
 * Extended result from findRelatedEntities for polymorphic relationships.
 * Includes the resolved entity type which may differ from the relationship's targetEntityType.
 */
interface RelatedEntityResult {
  id: string;
  name: string;
  /** The actual resolved entity type (may differ from relationship.targetEntityType for POLYMORPHIC) */
  resolvedEntityType?: string;
  /** Display label prefix for the tree node (e.g., "Primary: ", "User: ") */
  displayLabelPrefix?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum depth for tree traversal (0 = root, max children at depth 10) */
const MAX_TREE_DEPTH = 10;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get entity display name from entity type constant
 * Task Group 6: Added ENDPOINT display name
 * Task Group 7: Added INTERACTION display name
 */
function getEntityTypeDisplayName(entityType: string): string {
  const displayNames: Record<string, string> = {
    [ENTITY_TYPES.APPLICATION]: 'Application',
    [ENTITY_TYPES.APP_COMPONENT]: 'App Component',
    [ENTITY_TYPES.SERVICE]: 'Service',
    [ENTITY_TYPES.INTERFACE]: 'Interface',
    [ENTITY_TYPES.ENDPOINT]: 'Endpoint',  // Task Group 6: Add ENDPOINT display name
    [ENTITY_TYPES.APPLICATION_POINT]: 'Application Point',
    [ENTITY_TYPES.BUSINESS_USER]: 'Business User',
    [ENTITY_TYPES.BUSINESS_PROCESS]: 'Business Process',
    [ENTITY_TYPES.PROCESS_ACTIVITY]: 'Process Activity',
    [ENTITY_TYPES.BUSINESS_POINT]: 'Business Point',
    [ENTITY_TYPES.LOGICAL_DATA_ENTITY]: 'Logical Data Entity',
    [ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE]: 'Logical Data Attribute',
    [ENTITY_TYPES.PHYSICAL_DATA_ENTITY]: 'Physical Data Entity',
    [ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE]: 'Physical Data Attribute',
    [ENTITY_TYPES.INTERACTION]: 'Interaction',  // Task Group 7: Add INTERACTION display name
  };
  return displayNames[entityType] || entityType;
}

/**
 * Find the Application Point for a given concrete entity (Application, App Component, or Service).
 *
 * Application Points are super-entities that unify Application, App Component, and Service
 * for relationship purposes. This helper finds the Application Point associated with
 * a concrete entity based on its type.
 *
 * IMPORTANT: For APPLICATION type, we need to find the AP where:
 * - application_id matches AND
 * - kind === 'APPLICATION' (or equivalently, application_component_id and service_id are undefined)
 *
 * This is necessary because all Application Points for entities belonging to an application
 * have the same application_id, but only the APPLICATION kind AP represents the application itself.
 *
 * @param metaModel - The meta-model containing all entities
 * @param entityId - The ID of the concrete entity
 * @param entityType - The type of the concrete entity (APPLICATION, APP_COMPONENT, or SERVICE)
 * @returns The Application Point entity, or undefined if not found
 */
function findApplicationPointForEntity(
  metaModel: MetaModel,
  entityId: string,
  entityType: string
): { id: string; name: string } | undefined {
  const applicationPoints = metaModel.entities.application_points || [];

  if (entityType === ENTITY_TYPES.APPLICATION) {
    // For APPLICATION, find the AP that:
    // 1. Has application_id matching the entity
    // 2. Is specifically for the APPLICATION (not an app component or service)
    // We check kind === 'APPLICATION' as the primary discriminator
    return applicationPoints.find(
      (ap) =>
        ap.application_id === entityId &&
        ap.kind === 'APPLICATION'
    );
  } else if (entityType === ENTITY_TYPES.APP_COMPONENT) {
    // For APP_COMPONENT, find by application_component_id
    return applicationPoints.find((ap) => ap.application_component_id === entityId);
  } else if (entityType === ENTITY_TYPES.SERVICE) {
    // For SERVICE, find by service_id
    return applicationPoints.find((ap) => ap.service_id === entityId);
  }

  return undefined;
}

/**
 * Resolve a Business Point to its underlying concrete entity.
 *
 * Business Points are super-entities that wrap either a Business Process or a Process Activity.
 * This helper resolves a Business Point to the actual underlying entity based on its kind.
 *
 * @param metaModel - The meta-model containing all entities
 * @param businessPoint - The Business Point to resolve
 * @param targetEntityType - The expected target type (BUSINESS_PROCESS or PROCESS_ACTIVITY)
 * @returns The resolved concrete entity with its type, or undefined if not matched
 */
function resolveBusinessPointToConcreteEntity(
  metaModel: MetaModel,
  businessPoint: { id: string; kind: string; business_process_id: string; process_activity_id?: string },
  targetEntityType: string
): { id: string; name: string } | undefined {
  // If targeting BUSINESS_PROCESS and the BP wraps a Business Process
  if (targetEntityType === ENTITY_TYPES.BUSINESS_PROCESS && businessPoint.kind === 'BUSINESS_PROCESS') {
    const process = metaModel.entities.business_processes.find(
      (p) => p.id === businessPoint.business_process_id
    );
    return process ? { id: process.id, name: process.name } : undefined;
  }

  // If targeting PROCESS_ACTIVITY and the BP wraps a Process Activity
  if (
    targetEntityType === ENTITY_TYPES.PROCESS_ACTIVITY &&
    businessPoint.kind === 'PROCESS_ACTIVITY' &&
    businessPoint.process_activity_id
  ) {
    const activity = metaModel.entities.process_activities.find(
      (a) => a.id === businessPoint.process_activity_id
    );
    return activity ? { id: activity.id, name: activity.name } : undefined;
  }

  return undefined;
}

/**
 * Find related entities from the meta-model based on relationship definition.
 *
 * This function implements super-class aware traversal:
 * - For Application/AppComponent/Service -> Business Process/Process Activity via
 *   application_point_business_points, it resolves Business Points to their
 *   concrete underlying entities (Business Process or Process Activity).
 * - Business Point and Application Point nodes NEVER appear in the tree.
 * - Users only see concrete entities.
 *
 * Task Group 6: Added ENDPOINT support for Interface -> Endpoint relationship
 * Task Group 7: Added POLYMORPHIC direction support for INTERACTION relationships
 *
 * Spec: Fix Advanced Add Interface Schema Entities (Task Group 2.2)
 * - Fixed interface_logical_entities case to use resolveDataEntitiesForInterface()
 * - Now correctly parses dataEntityPointId to resolve both logical and physical entities
 */
function findRelatedEntities(
  metaModel: MetaModel,
  rootEntityId: string,
  rootEntityType: string,
  relationship: ExpandableRelationship
): RelatedEntityResult[] {
  const { targetEntityType, relationshipTableName, direction, foreignKeyField, displayLabelPrefix, isOptional } = relationship;

  // For parent/child relationships, query the target entity table directly
  if (direction === 'CHILD') {
    switch (targetEntityType) {
      case ENTITY_TYPES.APP_COMPONENT:
        return metaModel.entities.app_components
          .filter((ac) => ac.application_id === rootEntityId)
          .map((ac) => ({ id: ac.id, name: ac.name }));

      case ENTITY_TYPES.SERVICE:
        if (rootEntityType === ENTITY_TYPES.APPLICATION) {
          return metaModel.entities.services
            .filter((s) => s.application_id === rootEntityId)
            .map((s) => ({ id: s.id, name: s.name }));
        } else if (rootEntityType === ENTITY_TYPES.APP_COMPONENT) {
          return metaModel.entities.services
            .filter((s) => s.app_component_id === rootEntityId)
            .map((s) => ({ id: s.id, name: s.name }));
        }
        break;

      case ENTITY_TYPES.INTERFACE:
        return metaModel.entities.interfaces
          .filter((i) => i.service_id === rootEntityId)
          .map((i) => ({ id: i.id, name: i.name }));

      // Task Group 6: Add ENDPOINT as child of INTERFACE
      case ENTITY_TYPES.ENDPOINT:
        return (metaModel.entities.endpoints || [])
          .filter((ep) => ep.interface_id === rootEntityId)
          .map((ep) => ({ id: ep.id, name: ep.name }));

      case ENTITY_TYPES.PROCESS_ACTIVITY:
        return metaModel.entities.process_activities
          .filter((pa) => pa.business_process_id === rootEntityId)
          .map((pa) => ({ id: pa.id, name: pa.name }));

      case ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE:
        return metaModel.entities.logical_data_attributes
          .filter((lda) => lda.logical_entity_id === rootEntityId)
          .map((lda) => ({ id: lda.id, name: lda.name }));

      case ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE:
        return metaModel.entities.physical_data_attributes
          .filter((pda) => pda.physical_entity_id === rootEntityId)
          .map((pda) => ({ id: pda.id, name: pda.name }));

      // Task Group 7: Handle BUSINESS_USER as direct CHILD of INTERACTION
      case ENTITY_TYPES.BUSINESS_USER:
        if (rootEntityType === ENTITY_TYPES.INTERACTION) {
          // Find the interaction and get its user_id
          const interactions = metaModel.entities.interactions || [];
          const interaction = interactions.find((i) => i.id === rootEntityId) as Interaction | undefined;
          if (interaction && interaction.user_id) {
            const user = metaModel.entities.business_users.find((u) => u.id === interaction.user_id);
            if (user) {
              return [{ id: user.id, name: user.name, displayLabelPrefix }];
            }
          }
        }
        break;
    }
  }

  // Task Group 7: Handle POLYMORPHIC direction for INTERACTION relationships
  // This resolves App_Business_Point IDs to their actual entity types using resolveAppBusinessPoint
  if (direction === 'POLYMORPHIC') {
    if (rootEntityType === ENTITY_TYPES.INTERACTION) {
      const interactions = metaModel.entities.interactions || [];
      const interaction = interactions.find((i) => i.id === rootEntityId) as Interaction | undefined;
      if (!interaction) return [];

      // Get the App_Business_Point ID from the appropriate field
      let appBusinessPointId: string | undefined;
      if (foreignKeyField === 'primary_app_business_point_id') {
        appBusinessPointId = interaction.primary_app_business_point_id;
      } else if (foreignKeyField === 'secondary_app_business_point_id') {
        appBusinessPointId = interaction.secondary_app_business_point_id;
      }

      // If no ID and this is optional, return empty (valid case)
      if (!appBusinessPointId) {
        if (isOptional) {
          return [];
        }
        return [];
      }

      // Resolve the App_Business_Point ID to its actual entity
      const resolved = resolveAppBusinessPoint(appBusinessPointId, metaModel);
      if (resolved) {
        return [{
          id: resolved.entity.id,
          name: (resolved.entity as { name: string }).name,
          resolvedEntityType: resolved.entityType,
          displayLabelPrefix,
        }];
      }
    }
    return [];
  }

  // For association relationships, query via the relationship table
  if (direction === 'ASSOCIATION') {
    switch (relationshipTableName) {
      case 'logical_data_entity_physical_data_entities': {
        const pdeIds = metaModel.relationships.logical_data_entity_physical_data_entities
          .filter((rel) => rel.logical_entity_id === rootEntityId)
          .map((rel) => rel.physical_entity_id);

        const uniquePdeIds = [...new Set(pdeIds)];
        return metaModel.entities.physical_data_entities
          .filter((pde) => uniquePdeIds.includes(pde.id))
          .map((pde) => ({ id: pde.id, name: pde.name }));
      }

      // ============================================================================
      // Spec: Fix Advanced Add Interface Schema Entities (Task Group 2.2)
      // Fixed to use resolveDataEntitiesForInterface() shared utility
      // Now correctly parses dataEntityPointId (dep_log_<id> / dep_phy_<id>) format
      // and resolves entities from both logical_data_entities and physical_data_entities
      // ============================================================================
      case 'interface_logical_entities': {
        // Use shared utility to resolve both logical and physical entities
        const resolvedEntities = resolveDataEntitiesForInterface(metaModel, rootEntityId);

        // Based on targetEntityType, return the appropriate entity collection
        if (targetEntityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY) {
          // Return logical entities
          return metaModel.entities.logical_data_entities
            .filter((lde) => resolvedEntities.logicalEntityIds.includes(lde.id))
            .map((lde) => ({ id: lde.id, name: lde.name }));
        } else if (targetEntityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY) {
          // Return physical entities
          return metaModel.entities.physical_data_entities
            .filter((pde) => resolvedEntities.physicalEntityIds.includes(pde.id))
            .map((pde) => ({ id: pde.id, name: pde.name }));
        }

        // Fallback: return empty if unknown target type
        return [];
      }

      case 'application_point_business_points': {
        // ============================================================================
        // Task Group 2: Super-class Aware Point Resolution
        // ============================================================================
        // For Application, App Component, or Service root entities:
        // 1. Find the Application Point for the concrete entity
        // 2. Query application_point_business_points for linked Business Points
        // 3. Resolve each Business Point to its concrete entity (Business Process or Process Activity)
        // 4. Return the CONCRETE entities, not the Business Points
        //
        // Key principle: Business Point nodes NEVER appear in the tree.
        // Users only see Business Processes and Process Activities.
        // ============================================================================

        // Get the relationship array with defensive check for undefined
        const appPointBusinessPoints = metaModel.relationships.application_point_business_points || [];

        if (
          rootEntityType === ENTITY_TYPES.APPLICATION ||
          rootEntityType === ENTITY_TYPES.APP_COMPONENT ||
          rootEntityType === ENTITY_TYPES.SERVICE
        ) {
          // Step 1: Find the Application Point for this concrete entity
          const appPoint = findApplicationPointForEntity(metaModel, rootEntityId, rootEntityType);
          if (!appPoint) return [];

          // Step 2: Find linked Business Points via application_point_business_points
          const businessPointIds = appPointBusinessPoints
            .filter((rel) => rel.application_point_id === appPoint.id)
            .map((rel) => rel.business_point_id);

          const uniqueBusinessPointIds = [...new Set(businessPointIds)];

          // Step 3: Resolve Business Points to concrete entities based on target type
          const results: RelatedEntityResult[] = [];
          const businessPoints = metaModel.entities.business_points || [];

          for (const bpId of uniqueBusinessPointIds) {
            const bp = businessPoints.find((b) => b.id === bpId);
            if (!bp) continue;

            // Resolve to concrete entity based on the relationship's target type
            const concreteEntity = resolveBusinessPointToConcreteEntity(
              metaModel,
              bp,
              targetEntityType
            );

            if (concreteEntity) {
              results.push(concreteEntity);
            }
          }

          return results;
        }

        // For BUSINESS_POINT root: find linked Applications
        // This case is kept for reverse traversal scenarios
        else if (rootEntityType === ENTITY_TYPES.BUSINESS_POINT) {
          const appPointIds = appPointBusinessPoints
            .filter((rel) => rel.business_point_id === rootEntityId)
            .map((rel) => rel.application_point_id);

          const applicationPoints = metaModel.entities.application_points || [];
          const appIds = applicationPoints
            .filter((ap) => appPointIds.includes(ap.id))
            .map((ap) => ap.application_id);

          const uniqueAppIds = [...new Set(appIds)];
          return metaModel.entities.applications
            .filter((app) => uniqueAppIds.includes(app.id))
            .map((app) => ({ id: app.id, name: app.name }));
        }
        break;
      }

      case 'business_user_business_points': {
        // Get the relationship array with defensive check for undefined
        const businessUserBusinessPoints = metaModel.relationships.business_user_business_points || [];
        const businessPoints = metaModel.entities.business_points || [];

        // Find business points linked to this business user
        if (rootEntityType === ENTITY_TYPES.BUSINESS_USER) {
          const bpIds = businessUserBusinessPoints
            .filter((rel) => rel.business_user_id === rootEntityId)
            .map((rel) => rel.business_point_id);

          const uniqueBpIds = [...new Set(bpIds)];
          return businessPoints
            .filter((bp) => uniqueBpIds.includes(bp.id))
            .map((bp) => ({ id: bp.id, name: bp.name }));
        }
        // Find business users linked to this business point
        else if (rootEntityType === ENTITY_TYPES.BUSINESS_POINT) {
          const userIds = businessUserBusinessPoints
            .filter((rel) => rel.business_point_id === rootEntityId)
            .map((rel) => rel.business_user_id);

          const uniqueUserIds = [...new Set(userIds)];
          return metaModel.entities.business_users
            .filter((user) => uniqueUserIds.includes(user.id))
            .map((user) => ({ id: user.id, name: user.name }));
        }
        break;
      }
    }
  }

  // Task Group 2: For UNDERLYING relationships, resolve Business Points to their underlying entities
  // This is used to expand from a Business Point super-entity to its actual
  // Business Process or Process Activity
  if (direction === 'UNDERLYING') {
    if (relationshipTableName === 'business_points') {
      const businessPoints = metaModel.entities.business_points || [];

      // For BUSINESS_POINT root: directly resolve to underlying entity
      if (rootEntityType === ENTITY_TYPES.BUSINESS_POINT) {
        const bp = businessPoints.find((b) => b.id === rootEntityId);
        if (!bp) return [];

        const concreteEntity = resolveBusinessPointToConcreteEntity(metaModel, bp, targetEntityType);
        return concreteEntity ? [concreteEntity] : [];
      }
    }
    return [];
  }

  return [];
}

/**
 * Generate a unique key for entity lookup based on entityType and entityId
 */
function getEntityKey(entityType: string, entityId: string): string {
  return `${entityType}-${entityId}`;
}

/**
 * Build tree data from meta-model for the Advanced Add dialog.
 *
 * This function implements:
 * - Node deduplication: same entity (entityType, entityId) appearing via multiple paths
 *   results in a single tree node (the first occurrence)
 * - Max depth enforcement: tree depth never exceeds MAX_TREE_DEPTH (10)
 * - Cycle detection: prevents infinite loops from cyclic relationships
 * - Super-class transparency: Business Point and Application Point nodes NEVER appear
 * - POLYMORPHIC resolution: App_Business_Point IDs are resolved to their actual entity types
 */
function buildTreeData(
  metaModel: MetaModel,
  rootEntity: { id: string; name: string; type: string }
): TreeNodeData {
  // Track which entities have already been added to the tree for deduplication
  const addedEntities = new Set<string>();

  // Key counter for generating unique keys
  let keyCounter = 0;

  /**
   * Recursive helper function to build tree nodes with deduplication
   */
  function buildNodeRecursive(
    entityType: string,
    entityId: string,
    entityName: string,
    depth: number,
    ancestorPath: Set<string>,
    parentKey: string | undefined,
    relationshipKind: 'PARENT_CHILD' | 'ASSOCIATION' | undefined,
    isRoot: boolean,
    displayLabelPrefix?: string
  ): TreeNodeData | null {
    const entityKey = getEntityKey(entityType, entityId);

    // Cycle detection: check if this entity is already on the current traversal path
    if (ancestorPath.has(entityKey)) {
      return null;
    }

    // Deduplication: if this entity has already been added to the tree, skip it
    if (addedEntities.has(entityKey)) {
      return null;
    }

    // Mark this entity as added to the tree
    addedEntities.add(entityKey);

    // Generate a unique key for this node
    const nodeKey = isRoot ? `root-${entityId}` : `node-${keyCounter++}-${entityType}-${entityId}`;

    // Build label with optional prefix (e.g., "Primary: ", "User: ")
    const labelPrefix = displayLabelPrefix || '';
    const label = `${labelPrefix}${getEntityTypeDisplayName(entityType)}: ${entityName}`;

    // Create the new node
    const node: TreeNodeData = {
      key: nodeKey,
      label,
      entityType,
      entityId,
      entityName,
      isRoot,
      relationshipKind,
      parentKey,
      children: [],
    };

    // Max depth enforcement: don't expand children beyond depth 10
    if (depth >= MAX_TREE_DEPTH) {
      return node;
    }

    // Add this entity to the ancestor path for cycle detection in children
    const childAncestorPath = new Set(ancestorPath);
    childAncestorPath.add(entityKey);

    // Get expandable relationships for this entity type
    const relationships = getExpandableRelationships(entityType);

    // Process each relationship to find and add children
    relationships.forEach((relationship) => {
      const relatedEntities = findRelatedEntities(
        metaModel,
        entityId,
        entityType,
        relationship
      );

      relatedEntities.forEach((relatedEntity) => {
        // For POLYMORPHIC relationships, use the resolved entity type
        // Otherwise use the relationship's target entity type
        const childEntityType = relatedEntity.resolvedEntityType || relationship.targetEntityType;

        const childNode = buildNodeRecursive(
          childEntityType,
          relatedEntity.id,
          relatedEntity.name,
          depth + 1,
          childAncestorPath,
          node.key,
          relationship.relationshipKind,
          false,
          relatedEntity.displayLabelPrefix
        );

        if (childNode) {
          node.children.push(childNode);
        }
      });
    });

    return node;
  }

  const rootNode = buildNodeRecursive(
    rootEntity.type,
    rootEntity.id,
    rootEntity.name,
    0,
    new Set<string>(),
    undefined,
    undefined,
    true
  );

  if (!rootNode) {
    return {
      key: `root-${rootEntity.id}`,
      label: `${getEntityTypeDisplayName(rootEntity.type)}: ${rootEntity.name}`,
      entityType: rootEntity.type,
      entityId: rootEntity.id,
      entityName: rootEntity.name,
      isRoot: true,
      children: [],
    };
  }

  return rootNode;
}

/**
 * Get all ancestor keys for a node.
 *
 * This function traverses the tree from root to find the target node,
 * collecting all ancestor keys along the path. It returns keys in order
 * from root to the immediate parent of the target node.
 *
 * Works correctly with merged/deduplicated subtrees since it finds the
 * actual path in the tree structure rather than relying on parentKey.
 *
 * @param tree - The root of the tree data structure
 * @param targetKey - The key of the node to find ancestors for
 * @returns Array of ancestor keys from root to parent (does not include targetKey)
 */
function getAncestorKeys(tree: TreeNodeData, targetKey: string): string[] {
  const ancestors: string[] = [];

  function findPath(node: TreeNodeData, path: string[]): boolean {
    if (node.key === targetKey) {
      ancestors.push(...path);
      return true;
    }
    for (const child of node.children) {
      if (findPath(child, [...path, node.key])) {
        return true;
      }
    }
    return false;
  }

  findPath(tree, []);
  return ancestors;
}

/**
 * Get all descendant keys for a node
 */
function getDescendantKeys(node: TreeNodeData): string[] {
  const descendants: string[] = [];
  node.children.forEach((child) => {
    descendants.push(child.key);
    descendants.push(...getDescendantKeys(child));
  });
  return descendants;
}

/**
 * Find a node by key in the tree
 */
function findNodeByKey(node: TreeNodeData, key: string): TreeNodeData | null {
  if (node.key === key) return node;
  for (const child of node.children) {
    const found = findNodeByKey(child, key);
    if (found) return found;
  }
  return null;
}

/**
 * Build an ordered list of nodes from leaves up to root.
 *
 * This function takes a set of selected node keys and the tree data,
 * and returns an array of TreeNodeData ordered from deepest leaves
 * up to the root. This ordering is essential for recursive wrapping
 * where child nodes must be processed before their parents.
 *
 * The algorithm:
 * 1. Traverse the tree to find all selected nodes and their depths
 * 2. Sort nodes by depth in descending order (deepest first)
 * 3. Return the ordered array of nodes
 *
 * @param selectedKeys - Set of node keys that are selected
 * @param tree - The root of the tree data structure
 * @returns Array of TreeNodeData ordered from leaves (deepest) to root (shallowest)
 */
function buildOrderedNodeListFromLeaves(
  selectedKeys: Set<string>,
  tree: TreeNodeData
): TreeNodeData[] {
  // If no keys selected, return empty array
  if (selectedKeys.size === 0) {
    return [];
  }

  // Collect selected nodes with their depths
  const nodesWithDepth: Array<{ node: TreeNodeData; depth: number }> = [];

  function collectSelectedNodes(node: TreeNodeData, depth: number): void {
    if (selectedKeys.has(node.key)) {
      nodesWithDepth.push({ node, depth });
    }
    node.children.forEach((child) => {
      collectSelectedNodes(child, depth + 1);
    });
  }

  collectSelectedNodes(tree, 0);

  // Sort by depth descending (deepest first = leaves first)
  nodesWithDepth.sort((a, b) => b.depth - a.depth);

  // Return just the nodes in order
  return nodesWithDepth.map((item) => item.node);
}

/**
 * Compute indeterminate state for parent nodes
 */
function computeSelectionState(
  tree: TreeNodeData,
  selectedKeys: Set<string>
): TreeSelectionState {
  const state: TreeSelectionState = {};

  function processNode(node: TreeNodeData): 'selected' | 'unselected' | 'indeterminate' {
    if (node.children.length === 0) {
      // Leaf node - directly selected or not
      const nodeState = selectedKeys.has(node.key) ? 'selected' : 'unselected';
      state[node.key] = nodeState;
      return nodeState;
    }

    // Process children first
    const childStates = node.children.map((child) => processNode(child));

    // Determine this node's state based on children
    const allSelected = childStates.every((s) => s === 'selected');
    const allUnselected = childStates.every((s) => s === 'unselected');

    let nodeState: 'selected' | 'unselected' | 'indeterminate';
    if (selectedKeys.has(node.key)) {
      nodeState = 'selected';
    } else if (allSelected) {
      nodeState = 'selected';
    } else if (allUnselected) {
      nodeState = 'unselected';
    } else {
      nodeState = 'indeterminate';
    }

    state[node.key] = nodeState;
    return nodeState;
  }

  processNode(tree);

  // Root is always selected
  state[tree.key] = 'selected';

  return state;
}

// ============================================================================
// TreeNode Component
// ============================================================================

function TreeNodeComponent({
  node,
  selectionState,
  expandedState,
  onToggleSelection,
  onToggleExpand,
  depth,
}: TreeNodeComponentProps) {
  const isExpanded = expandedState[node.key] !== false; // Default to expanded
  const hasChildren = node.children.length > 0;
  const state = selectionState[node.key] || 'unselected';

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (!node.isRoot) {
      onToggleSelection(node.key);
    }
  };

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand(node.key);
  };

  const indentation = depth * 20;

  return (
    <div className={`${styles.treeNode} ${node.isRoot ? styles.rootNode : ''}`}>
      <div
        className={styles.nodeRow}
        style={{ paddingLeft: indentation }}
        data-testid={`tree-node-${node.key}`}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <span
            className={styles.expandToggle}
            onClick={handleExpandClick}
            data-testid={`expand-toggle-${node.key}`}
          >
            {isExpanded ? '\u25BC' : '\u25B6'}
          </span>
        ) : (
          <span className={styles.expandTogglePlaceholder} />
        )}

        {/* Checkbox */}
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={state === 'selected'}
          ref={(input) => {
            if (input) {
              input.indeterminate = state === 'indeterminate';
            }
          }}
          onChange={handleCheckboxChange}
          disabled={node.isRoot}
          data-testid={`checkbox-${node.key}`}
        />

        {/* Label - now uses the pre-computed label which includes prefix */}
        <div className={styles.nodeLabel}>
          <span className={styles.nodeLabelText}>{node.label}</span>
          {node.relationshipKind && (
            <span className={styles.relationshipKind}>
              {getRelationshipKindLabel(node.relationshipKind)}
            </span>
          )}
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className={styles.children}>
          {node.children.map((child) => (
            <TreeNodeComponent
              key={child.key}
              node={child}
              selectionState={selectionState}
              expandedState={expandedState}
              onToggleSelection={onToggleSelection}
              onToggleExpand={onToggleExpand}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// AdvancedAddDialog Component
// ============================================================================

export function AdvancedAddDialog({
  isOpen,
  onClose,
  onAdd,
  rootEntity,
  metaModel,
  isLoading = false,
  error = null,
  mode = 'add',
  initialSelectedKeys,
}: AdvancedAddDialogProps) {
  // Build tree data from meta-model
  const treeData = useMemo(() => {
    return buildTreeData(metaModel, rootEntity);
  }, [metaModel, rootEntity]);

  // Track selected node keys (root is always selected)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => {
    if (initialSelectedKeys && initialSelectedKeys.size > 0) {
      return new Set(initialSelectedKeys);
    }
    return new Set([treeData.key]);
  });

  // Reset selectedKeys when initialSelectedKeys changes (e.g., re-opening dialog for a different node)
  useEffect(() => {
    if (initialSelectedKeys && initialSelectedKeys.size > 0) {
      setSelectedKeys(new Set(initialSelectedKeys));
    } else {
      setSelectedKeys(new Set([treeData.key]));
    }
  }, [initialSelectedKeys, treeData.key]);

  // Task Group 2: Select All checkbox state (independent from selectedKeys, no auto-sync)
  const [selectAllChecked, setSelectAllChecked] = useState<boolean>(false);

  // Track expanded nodes
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>({});

  // Spacing Presets: Track the selected spacing preset
  const [spacingPreset, setSpacingPreset] = useState<SpacingPreset>(DEFAULT_SPACING_PRESET);

  // Task Group 4: Child layout controls state
  const [childColumns, setChildColumns] = useState<number>(DEFAULT_LAYOUT_CONFIG.childColumns);
  const [childNodeWidth, setChildNodeWidth] = useState<number>(DEFAULT_LAYOUT_CONFIG.childNodeWidth);

  // Compute selection state including indeterminate
  const selectionState = useMemo(() => {
    return computeSelectionState(treeData, selectedKeys);
  }, [treeData, selectedKeys]);

  // Handle selection toggle
  const handleToggleSelection = useCallback(
    (nodeKey: string) => {
      const node = findNodeByKey(treeData, nodeKey);
      if (!node || node.isRoot) return;

      setSelectedKeys((prev) => {
        const newSelected = new Set(prev);
        const currentState = selectionState[nodeKey];

        if (currentState === 'selected') {
          // Deselecting - deselect this node and all descendants
          newSelected.delete(nodeKey);
          const descendants = getDescendantKeys(node);
          descendants.forEach((key) => newSelected.delete(key));
        } else {
          // Selecting - select this node and all ancestors
          newSelected.add(nodeKey);
          const ancestors = getAncestorKeys(treeData, nodeKey);
          ancestors.forEach((key) => newSelected.add(key));
        }

        return newSelected;
      });
    },
    [treeData, selectionState]
  );

  // Task Group 2: Handle Select All checkbox change
  // When checked: collect all keys via getDescendantKeys(treeData) and add to selectedKeys
  // When unchecked: reset selectedKeys to only contain treeData.key (root)
  // Does NOT sync back from individual selections (selectAllChecked is independent)
  const handleSelectAllChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const isChecked = event.target.checked;
      setSelectAllChecked(isChecked);

      if (isChecked) {
        // Select all: root + all descendants
        const allDescendantKeys = getDescendantKeys(treeData);
        setSelectedKeys(new Set([treeData.key, ...allDescendantKeys]));
      } else {
        // Deselect all: only root remains selected
        setSelectedKeys(new Set([treeData.key]));
      }
    },
    [treeData]
  );

  // Handle expand/collapse toggle
  const handleToggleExpand = useCallback((nodeKey: string) => {
    setExpandedState((prev) => ({
      ...prev,
      [nodeKey]: prev[nodeKey] === false ? true : false,
    }));
  }, []);

  // Build selections for API call
  const buildSelections = useCallback((): SelectionDescriptor[] => {
    const selections: SelectionDescriptor[] = [];
    const processedNodes = new Set<string>();

    // Get all selected nodes (excluding root)
    function processNode(node: TreeNodeData) {
      if (!node.isRoot && selectedKeys.has(node.key) && !processedNodes.has(node.key)) {
        processedNodes.add(node.key);

        // Find the relationship info
        const relationship = getExpandableRelationships(
          findNodeByKey(treeData, node.parentKey || '')?.entityType || rootEntity.type
        ).find((r) => r.targetEntityType === node.entityType);

        if (relationship) {
          selections.push({
            relationshipType: relationship.relationshipTableName,
            direction: relationship.direction,
            depth: 1,
            selectedEntityIds: [node.entityId],
          });
        }
      }

      node.children.forEach(processNode);
    }

    processNode(treeData);
    return selections;
  }, [treeData, selectedKeys, rootEntity.type]);

  // Handle Add to Diagram click - includes spacingPreset and layout controls in result
  const handleAdd = useCallback(() => {
    const selections = buildSelections();
    // Include spacingPreset and layout controls in the result for layout algorithm
    const result: AdvancedAddResult = {
      treeData,
      selectedKeys,
      selections,
      spacingPreset,
      childColumns,
      childNodeWidth,
    };
    onAdd(result);
  }, [buildSelections, onAdd, treeData, selectedKeys, spacingPreset, childColumns, childNodeWidth]);

  // Handle close
  const handleClose = useCallback(() => {
    if (!isLoading) {
      onClose();
    }
  }, [isLoading, onClose]);

  // Handle overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isLoading) {
        onClose();
      }
    },
    [isLoading, onClose]
  );

  // Handle spacing preset change
  const handleSpacingChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setSpacingPreset(event.target.value as SpacingPreset);
  }, []);

  // Task Group 4: Handle child columns change
  const handleChildColumnsChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setChildColumns(parseInt(event.target.value, 10));
  }, []);

  // Task Group 4: Handle child node width change
  const handleChildNodeWidthChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value, 10);
    if (!isNaN(value)) {
      // Clamp value within constraints
      const clampedValue = Math.max(
        LAYOUT_CONSTRAINTS.childNodeWidth.min,
        Math.min(LAYOUT_CONSTRAINTS.childNodeWidth.max, value)
      );
      setChildNodeWidth(clampedValue);
    }
  }, []);

  // Don't render if not open
  if (!isOpen) return null;

  const title = mode === 'edit'
    ? `Advanced Edit: ${getEntityTypeDisplayName(rootEntity.type)} "${rootEntity.name}"`
    : `Advanced Add: ${getEntityTypeDisplayName(rootEntity.type)} "${rootEntity.name}"`;

  // Generate options for child columns dropdown (1-10)
  const childColumnsOptions = [];
  for (let i = LAYOUT_CONSTRAINTS.childColumns.min; i <= LAYOUT_CONSTRAINTS.childColumns.max; i++) {
    childColumnsOptions.push(
      <option key={i} value={i}>{i}</option>
    );
  }

  const dialogContent = (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="advanced-add-dialog-overlay"
    >
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        data-testid="advanced-add-dialog"
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title} data-testid="advanced-add-dialog-title">
            {title}
          </h2>
          <button
            className={styles.closeButton}
            onClick={handleClose}
            disabled={isLoading}
            data-testid="advanced-add-dialog-close"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {error && (
            <div className={styles.error} data-testid="advanced-add-dialog-error">
              {error}
            </div>
          )}

          {treeData.children.length === 0 ? (
            <div className={styles.emptyState}>
              No related entities found for this {getEntityTypeDisplayName(rootEntity.type)}.
            </div>
          ) : (
            <div className={styles.tree} data-testid="advanced-add-tree">
              <TreeNodeComponent
                node={treeData}
                selectionState={selectionState}
                expandedState={expandedState}
                onToggleSelection={handleToggleSelection}
                onToggleExpand={handleToggleExpand}
                depth={0}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          {/* Spacing dropdown - positioned LEFT of buttons */}
          <div className={styles.spacingControl}>
            <label htmlFor="spacing-preset" className={styles.spacingLabel}>
              Spacing:
            </label>
            <select
              id="spacing-preset"
              value={spacingPreset}
              onChange={handleSpacingChange}
              className={styles.spacingSelect}
              data-testid="spacing-preset-select"
            >
              <option value="spacious">Spacious</option>
              <option value="normal">Normal</option>
              <option value="tight">Tight</option>
            </select>
          </div>

          {/* Task Group 4: Child columns dropdown */}
          <div className={styles.layoutControl}>
            <label htmlFor="child-columns" className={styles.layoutLabel}>
              Columns:
            </label>
            <select
              id="child-columns"
              value={childColumns}
              onChange={handleChildColumnsChange}
              className={styles.layoutSelect}
              data-testid="child-columns-select"
            >
              {childColumnsOptions}
            </select>
          </div>

          {/* Task Group 4: Child node width input */}
          <div className={styles.layoutControl}>
            <label htmlFor="child-node-width" className={styles.layoutLabel}>
              Width:
            </label>
            <input
              id="child-node-width"
              type="number"
              value={childNodeWidth}
              onChange={handleChildNodeWidthChange}
              min={LAYOUT_CONSTRAINTS.childNodeWidth.min}
              max={LAYOUT_CONSTRAINTS.childNodeWidth.max}
              className={styles.layoutInput}
              data-testid="child-node-width-input"
            />
          </div>

          {/* Task Group 3: Select All checkbox control */}
          <div className={styles.selectAllControl} data-testid="select-all-control">
            <input
              type="checkbox"
              id="select-all-checkbox"
              className={styles.checkbox}
              checked={selectAllChecked}
              onChange={handleSelectAllChange}
              data-testid="select-all-checkbox"
            />
            <label htmlFor="select-all-checkbox" className={styles.layoutLabel}>
              Select All
            </label>
          </div>

          {/* Spacer to push buttons to the right */}
          <div className={styles.footerSpacer} />

          <button
            className={styles.secondaryButton}
            onClick={handleClose}
            disabled={isLoading}
            data-testid="advanced-add-dialog-cancel"
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleAdd}
            disabled={isLoading}
            data-testid="advanced-add-dialog-add"
          >
            {isLoading && <span className={styles.spinner} />}
            {mode === 'edit' ? 'Edit' : 'Add to Diagram'}
          </button>
        </div>
      </div>
    </div>
  );

  // Render using portal to body
  return ReactDOM.createPortal(dialogContent, document.body);
}

// Export helpers for testing and use by other components
export { buildTreeData, getEntityTypeDisplayName, getAncestorKeys, buildOrderedNodeListFromLeaves, getDescendantKeys };

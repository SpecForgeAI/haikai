import { useState, useCallback, useEffect } from 'react';
import { MetaModel, DiagramNode, DiagramEdge, ENTITY_TYPES, AnyRelationship, RELATIONSHIP_EDGE_TYPES, BusinessUserBusinessPoint, ApplicationPointBusinessPoint, LogicalDataEntityRelationship, LogicalDataEntityPhysicalDataEntity, LogicalDataAttributePhysicalDataAttribute, DataMovement, ProcessActivity, Diagram, State, Activity, ActivityPartition, LogicalDataEntity, PhysicalDataEntity, EntityType, AnyEntity, StateTransition, UIScreen, ResourceSubnetHosting, DeploymentUnitComputeResource, LoadBalancerResourceRoute } from '../../types/model';
import { ContextMenuState, PaletteItemData } from '../../types/contextMenu';
import { AdvancedAddResult, TreeNodeData, LayoutTreeNode, SpacingPreset, DEFAULT_SPACING_PRESET, LayoutConfig, DEFAULT_LAYOUT_CONFIG, SPACING_PRESETS } from '../../types/advancedAdd';
import { PaletteSection } from './PaletteSection';
import { PaletteContextMenu } from './PaletteContextMenu';
import { AdvancedAddDialog, buildOrderedNodeListFromLeaves } from './AdvancedAddDialog';
import { Modal } from '../common/Modal';
import { getPaletteSections, getEntityTypeConstant } from '../../utils/paletteData';
import { createDiagramNodeFromEntity, nodeExistsForEntity, calculateZIndex, createERDNodeFromEntity, shouldCreateERDNode, DEFAULT_NODE_SPAWN_ORIGIN } from '../../utils/nodeCreation';
import { generatePrefixedId } from '../../utils/idGenerator';
import { GetViewportCenterFn, DEFAULT_CANVAS_CENTER } from '../../utils/viewportUtils';
import {
  calculateChildPositionWithHeights,
  calculateParentSizeWithHeights,
  calculateProcessNodeHeight,
  calculateApplicationLabelHeight,
  findLinkedBusinessProcesses,
  findAppComponents,
  findProcessActivities,
  countExistingChildren,
  DEFAULT_CHILD_WIDTH,
  PADDING,
  layoutAdvancedAddSelection,
  convertTodiagramNodes,
} from '../../utils/compoundLayout';
import {
  isRelationshipRowEnabled,
  createRelationshipEdge,
  getLogicalERNodes,
  getLogicalPhysicalEntityNodes,
  getLogicalPhysicalAttributeNodes,
  getDataMovementNodes,
  getDataMovementEntityName,
  getUserBusinessPointNodes,
  getAppPointBusinessPointNodes,
  isLogicalEREdgeOnDiagram,
} from '../../utils/relationshipUtils';
// Task Group 3: Import ERD utilities for "Add with attributes" feature
import {
  getAttributesForEntity,
  calculateERDNodeSize,
} from '../../utils/erdUtils';
// Task Group 4: Import ERD utilities for attribute filtering in Advanced Add
// Task Group 3 (Interface Parity): Import Interface candidate detection utilities
import {
  findERDCandidates,
  isAttributeEntityType,
  getERDCandidateAttributeIds,
  findInterfaceCustomCandidates,
  isEmbeddedInterfaceChild,
  InterfaceCustomCandidate,
} from '../../utils/erdAdvancedAddUtils';
// Task Group 2 (Interface Parity): Import shared Interface composite builder
import {
  buildInterfaceCompositeNodes,
  getLogicalEntityIdsForInterface,
} from '../../utils/interfaceCompositeBuilder';
// Interface Parent Wrapping Fix: Import Interface dimension calculation utilities
import {
  calculateInterfaceWithEntitiesHeight,
  calculateInterfaceWithEntitiesWidth,
  INTERFACE_HEADER_HEIGHT,
  INTERFACE_PADDING_X,
  INTERFACE_PADDING_Y,
} from '../../utils/interfaceCustomRenderer';
// Task Group 3: Import User Interaction edge creation utilities
import {
  isUserInteractionRowEnabled,
  addUserInteractionToDiagram,
} from '../../utils/userInteractionUtils';
// Task Group 6: Import getDiagramType for diagram type filtering
import { getDiagramType } from '../../types/diagramType';
import styles from './PalettePanel.module.css';
import { PaletteDomainSelector } from './PaletteDomainSelector';
import { useArchitecture, useArchitectureDispatch } from '../../contexts/ArchitectureContext';
// Task Group 2: Import CreateAndPlaceDrawer component
import { CreateAndPlaceDrawer } from './CreateAndPlaceDrawer';
// Task Group 3: Import SelectionInspector for entity editing
import { SelectionInspector } from './SelectionInspector';
// Task Group 5: Import State Transition creation utilities
import {
  TransitionCreationMode,
  initialTransitionCreationMode,
  enterTransitionCreationMode,
  exitTransitionCreationMode,
  getTransitionModeHintText,
  createStateTransitionEntity,
  createTransitionDiagramEdge,
} from '../../utils/stateTransitionCreation';

// Task Group 2 (Activity Flow): Import Activity Flow creation utilities
// Spec 2025-12-31 (A4): Added createActivityFlowDiagramEdge for adding existing flows as edges
import {
  ActivityFlowCreationMode,
  initialActivityFlowCreationMode,
  enterActivityFlowCreationMode,
  exitActivityFlowCreationMode,
  getActivityFlowModeHintText,
  createActivityFlowDiagramEdge,
} from '../../utils/activityFlowCreation';
// Task Group 4: Re-export ActivityFlowCreationMode for use by DiagramsView
export type { ActivityFlowCreationMode };
export { initialActivityFlowCreationMode };

// Spec 2026-01-02 Task Group 8: Import UI Workflow Transition creation utilities
import {
  WorkflowTransitionCreationMode,
  createInitialWorkflowTransitionMode,
  createIdleWorkflowTransitionMode,
  getWorkflowTransitionStatusMessage,
} from '../../utils/uiWorkflowTransitionCreation';
// Spec 2026-01-02 Task Group 8: Re-export WorkflowTransitionCreationMode for use by DiagramsView
export type { WorkflowTransitionCreationMode };
export const initialWorkflowTransitionMode = createIdleWorkflowTransitionMode();

// Task Group 3 & 4: Warning message constant for no active diagram
// Used consistently for both left-click and context menu blocking
const NO_DIAGRAM_WARNING_MESSAGE = 'Add a new diagram before trying to add items.';
// Task Group 7: Empty state message for diagram type filtering
const DIAGRAM_TYPE_EMPTY_STATE_MESSAGE = 'This diagram type supports creating elements directly in the diagram (coming next).';


// ============================================================================
// Task Group 4: Recursive Wrapping Types and Functions
// ============================================================================

/**
 * Result of building a wrapped node hierarchy.
 * Contains nodes to add and updates for existing nodes.
 */
export interface WrappedNodeResult {
  /** New nodes to add to the diagram */
  nodesToAdd: DiagramNode[];
  /** Updates to apply to existing nodes */
  nodesToUpdate: Array<{
    nodeId: string;
    updates: Partial<DiagramNode>;
  }>;
}

/**
 * Entity types that support child nodes (containment)
 * Task Group 3: Added INTERFACE to support Interface -> Logical Data Entity containment
 */
const CONTAINER_ENTITY_TYPES: Set<string> = new Set([
  ENTITY_TYPES.APPLICATION,
  ENTITY_TYPES.APP_COMPONENT,
  ENTITY_TYPES.SERVICE,
  ENTITY_TYPES.INTERFACE,           // Task Group 3: INTERFACE can contain Logical Data Entities
  ENTITY_TYPES.BUSINESS_PROCESS,
  ENTITY_TYPES.LOGICAL_DATA_ENTITY,
  ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
]);

/**
 * Check if an entity type supports child nodes
 */
function supportsChildNodes(entityType: string): boolean {
  return CONTAINER_ENTITY_TYPES.has(entityType);
}

/**
 * Find an existing diagram node for a given entity
 */
function findExistingNodeForEntity(
  diagramNodes: DiagramNode[],
  entityType: string,
  entityId: string
): DiagramNode | null {
  return diagramNodes.find(
    n => n.entity_type === entityType && n.entity_id === entityId
  ) || null;
}

/**
 * Get entity name from the meta-model
 */
function getEntityName(
  metaModel: MetaModel,
  entityType: string,
  entityId: string
): string {
  // Map entity types to their array names
  const entityArrayMap: Record<string, keyof MetaModel['entities']> = {
    [ENTITY_TYPES.APPLICATION]: 'applications',
    [ENTITY_TYPES.APP_COMPONENT]: 'app_components',
    [ENTITY_TYPES.SERVICE]: 'services',
    [ENTITY_TYPES.INTERFACE]: 'interfaces',
    [ENTITY_TYPES.BUSINESS_PROCESS]: 'business_processes',
    [ENTITY_TYPES.PROCESS_ACTIVITY]: 'process_activities',
    [ENTITY_TYPES.BUSINESS_USER]: 'business_users',
    [ENTITY_TYPES.APPLICATION_POINT]: 'application_points',
    [ENTITY_TYPES.LOGICAL_DATA_ENTITY]: 'logical_data_entities',
    [ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE]: 'logical_data_attributes',
    [ENTITY_TYPES.PHYSICAL_DATA_ENTITY]: 'physical_data_entities',
    [ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE]: 'physical_data_attributes',
  };

  const arrayName = entityArrayMap[entityType];
  if (!arrayName) return 'Unknown';

  const entities = metaModel.entities[arrayName] as Array<{ id: string; name: string }>;
  const entity = entities?.find(e => e.id === entityId);
  return entity?.name || 'Unknown';
}

// ============================================================================
// Interface Parent Wrapping Fix: Helper Functions for Interface Dimensions
// ============================================================================

/**
 * Calculate Interface composite dimensions for a given Interface candidate.
 *
 * This function computes the Interface's total width and height based on:
 * - Header height
 * - Endpoints (rendered as lines)
 * - Logical entity boxes (rendered as ERD-style children)
 *
 * These dimensions are computed BEFORE the layout tree is measured, allowing
 * parent nodes (Service, Component, Application) to correctly size themselves.
 *
 * @param candidate - The Interface custom candidate with endpoints and logical entities
 * @param metaModel - The meta-model for entity lookups
 * @returns { width, height } dimensions for the Interface composite
 */
function calculateInterfaceCompositeDimensions(
  candidate: InterfaceCustomCandidate,
  metaModel: MetaModel
): { width: number; height: number } {
  const interfaceId = candidate.interface.entityId;

  // Get the interface entity for header width calculation
  const interfaceEntity = metaModel.entities.interfaces.find(i => i.id === interfaceId);
  const interfaceName = interfaceEntity?.name || 'Interface';

  // Get selected endpoints
  const selectedEndpointIds = candidate.endpoints.map(ep => ep.entityId);
  const endpoints = metaModel.entities.endpoints.filter(
    ep => selectedEndpointIds.includes(ep.id)
  );

  // Get selected logical entities
  const selectedLogicalEntityIds = candidate.logicalEntities.map(le => le.entityId);

  // Spec: Fix Interface Composite Rendering (Task Group 2.4)
  // Get selected physical entities (in addition to logical entities)
  const selectedPhysicalEntityIds = candidate.physicalEntities?.map(pe => pe.entityId) || [];

  // Calculate entity box dimensions (both logical and physical entities)
  const entityBoxes: Array<{ width: number; height: number }> = [];

  // Process logical entities
  for (const logicalEntityId of selectedLogicalEntityIds) {
    const logicalEntity = metaModel.entities.logical_data_entities.find(
      e => e.id === logicalEntityId
    );
    if (!logicalEntity) continue;

    // Get all attributes for this entity
    const attributes = getAttributesForEntity(metaModel, logicalEntityId, ENTITY_TYPES.LOGICAL_DATA_ENTITY);

    // Calculate ERD node size
    const { width: entityWidth, height: entityHeight } = calculateERDNodeSize(logicalEntity.name, attributes);
    entityBoxes.push({ width: entityWidth, height: entityHeight });
  }

  // Spec: Fix Interface Composite Rendering (Task Group 2.4)
  // Process physical entities
  for (const physicalEntityId of selectedPhysicalEntityIds) {
    const physicalEntity = metaModel.entities.physical_data_entities.find(
      e => e.id === physicalEntityId
    );
    if (!physicalEntity) continue;

    // Get all attributes for this entity
    const attributes = getAttributesForEntity(metaModel, physicalEntityId, ENTITY_TYPES.PHYSICAL_DATA_ENTITY);

    // Calculate ERD node size
    const { width: entityWidth, height: entityHeight } = calculateERDNodeSize(physicalEntity.name, attributes);
    entityBoxes.push({ width: entityWidth, height: entityHeight });
  }

  // Calculate header width (estimate based on interface name)
  const headerWidth = Math.max(100, interfaceName.length * 8);

  // Calculate endpoint line widths (rough estimate)
  const endpointLineWidths = endpoints.map(ep => {
    const lineText = `${ep.operation_verb || ''} ${ep.path_or_address || ''} - ${ep.name}`;
    return lineText.length * 6;
  });

  // Extract entity dimensions
  const entityHeights = entityBoxes.map(e => e.height);
  const entityWidths = entityBoxes.map(e => e.width);

  // Calculate Interface total height
  const interfaceHeight = calculateInterfaceWithEntitiesHeight(
    INTERFACE_HEADER_HEIGHT,
    endpoints.length,
    entityHeights,
    INTERFACE_PADDING_Y
  );

  // Calculate Interface total width
  const calculatedWidth = calculateInterfaceWithEntitiesWidth(
    headerWidth,
    endpointLineWidths,
    entityWidths,
    INTERFACE_PADDING_X
  );
  const interfaceWidth = Math.max(300, calculatedWidth); // Minimum 300px width

  return { width: interfaceWidth, height: interfaceHeight };
}

/**
 * Build a map of Interface entity ID to its precomputed dimensions.
 *
 * @param interfaceCandidates - Array of Interface custom candidates
 * @param metaModel - The meta-model for entity lookups
 * @returns Map of interfaceId -> { width, height }
 */
function buildInterfaceDimensionsMap(
  interfaceCandidates: InterfaceCustomCandidate[],
  metaModel: MetaModel
): Map<string, { width: number; height: number }> {
  const dimensionsMap = new Map<string, { width: number; height: number }>();

  for (const candidate of interfaceCandidates) {
    const dimensions = calculateInterfaceCompositeDimensions(candidate, metaModel);
    dimensionsMap.set(candidate.interface.entityId, dimensions);
  }

  return dimensionsMap;
}

// ============================================================================
// Task Group 2: Helper Functions for Layout Integration
// ============================================================================

/**
 * Build wrapped node hierarchy from leaf to root using the new hierarchical layout algorithm.
 *
 * Task Group 2: Refactored to use the new layout algorithm.
 * Task Group 4: Added spacingPreset parameter for spacing presets feature.
 * Task Group 4 (No Attribute Nodes): Filter out attribute nodes from being created as DiagramNodes.
 * Task Group 4 (Layout Controls): Added layoutConfig parameter for grid layout support.
 * Task Group 3 (Interface Parity): Added Interface custom candidate detection and filtering.
 * Interface Parent Wrapping Fix: Pre-compute Interface dimensions and pass to layout tree.
 *
 * This function:
 * 1. Converts TreeNodeData to LayoutTreeNode
 * 2. Runs the hierarchical layout algorithm (measure + assign positions)
 * 3. Converts LayoutNode tree to DiagramNode array
 * 4. Handles node reuse for existing entities on the diagram
 * 5. Filters out attribute entity types (they are embedded in ERD nodes, not created as separate nodes)
 * 6. Detects Interface custom candidates and filters out their embedded endpoints/entities
 * 7. Pre-computes Interface composite dimensions and passes them through the layout tree
 *
 * Key behaviors:
 * - Reuses existing nodes as parents (does not duplicate)
 * - Applies containment styling (text_v_align='TOP', text_font_weight='bold') to parents
 * - Uses the two-pass layout algorithm for proper positioning
 * - Sets parent_node_id for child nodes
 * - Ensures children have higher z-index than parents
 * - Attribute types (LOGICAL_DATA_ATTRIBUTE, PHYSICAL_DATA_ATTRIBUTE) are NOT created as DiagramNodes
 * - Interface custom candidates produce contract-style nodes with embedded endpoints and entities
 * - Interface composite dimensions are pre-computed so parent nodes correctly wrap them
 *
 * @param orderedNodes - Nodes ordered from leaves to root (from buildOrderedNodeListFromLeaves)
 * @param treeData - Root of the tree structure (for finding parent relationships)
 * @param metaModel - The meta-model for entity lookups
 * @param diagram - Current diagram state
 * @param viewportCenter - Center point for positioning new nodes
 * @param spacingPreset - Optional spacing preset for layout (defaults to 'normal')
 * @param layoutConfig - Optional layout configuration for grid layout
 * @returns WrappedNodeResult with nodesToAdd and nodesToUpdate
 */
export function buildWrappedNodeHierarchy(
  orderedNodes: TreeNodeData[],
  treeData: TreeNodeData,
  metaModel: MetaModel,
  diagram: { diagram_nodes: DiagramNode[]; diagram_edges?: DiagramEdge[] },
  viewportCenter: { x: number; y: number },
  spacingPreset: SpacingPreset = DEFAULT_SPACING_PRESET,
  layoutConfig?: LayoutConfig
): WrappedNodeResult {
  const nodesToAdd: DiagramNode[] = [];
  const nodesToUpdate: Array<{ nodeId: string; updates: Partial<DiagramNode> }> = [];

  // If no nodes to add, return early
  if (orderedNodes.length === 0) {
    return { nodesToAdd, nodesToUpdate };
  }

  // Build a set of selected keys from orderedNodes for efficient lookup
  const selectedKeys = new Set<string>(orderedNodes.map(n => n.key));

  // Task Group 4: Find ERD candidates (data entities with selected attributes)
  // These will have their attributes embedded instead of created as separate nodes
  const erdCandidates = findERDCandidates(orderedNodes, selectedKeys, metaModel);

  // Build a map of entity ID -> selected attribute IDs for ERD rendering
  const erdCandidateMap = new Map<string, string[]>();
  for (const candidate of erdCandidates) {
    const attributeIds = getERDCandidateAttributeIds(candidate);
    erdCandidateMap.set(candidate.entity.entityId, attributeIds);
  }

  // Task Group 3 (Interface Parity): Find Interface custom layout candidates
  // These will have their endpoints and entities embedded instead of created as separate nodes
  const interfaceCandidates = findInterfaceCustomCandidates(orderedNodes, selectedKeys, metaModel);

  // Build a map of Interface ID -> candidate for quick lookup
  const interfaceCandidateMap = new Map<string, InterfaceCustomCandidate>();
  for (const candidate of interfaceCandidates) {
    interfaceCandidateMap.set(candidate.interface.entityId, candidate);
  }

  // Interface Parent Wrapping Fix: Pre-compute Interface composite dimensions
  // This ensures parent nodes (Service, Component, Application) correctly size to wrap Interfaces
  const interfaceDimensionsMap = buildInterfaceDimensionsMap(interfaceCandidates, metaModel);

  // Task Group 4: Filter out attribute nodes from orderedNodes
  // Task Group 3: Filter out endpoints and logical entities belonging to Interface candidates
  // Attributes will be embedded in their parent entity nodes, not created as separate diagram nodes
  const filteredOrderedNodes = orderedNodes.filter(node => {
    // Skip attribute entity types - they should not become diagram nodes
    if (isAttributeEntityType(node.entityType)) {
      return false;
    }

    // Task Group 3: Skip nodes that are embedded in Interface custom candidates
    if (isEmbeddedInterfaceChild(node, interfaceCandidates)) {
      return false;
    }

    return true;
  });

  // Check which entities already exist on the diagram (using filtered list)
  const existingEntityMap = new Map<string, DiagramNode>();
  for (const node of filteredOrderedNodes) {
    const existing = findExistingNodeForEntity(
      diagram.diagram_nodes,
      node.entityType,
      node.entityId
    );
    if (existing) {
      const key = `${node.entityType}:${node.entityId}`;
      existingEntityMap.set(key, existing);
    }
  }

  // If all entities already exist, no new nodes to add, just update styling
  const allExist = filteredOrderedNodes.every(n =>
    existingEntityMap.has(`${n.entityType}:${n.entityId}`)
  );

  if (allExist) {
    // Just apply containment styling updates to existing nodes that now have children
    const childrenByParent = buildChildrenMap(treeData);

    for (const node of filteredOrderedNodes) {
      const entityKey = `${node.entityType}:${node.entityId}`;
      const existingNode = existingEntityMap.get(entityKey);
      if (!existingNode) continue;

      // Check if this existing node will have new children (excluding attributes and Interface-embedded children)
      const selectedChildren = childrenByParent.get(entityKey)?.filter(
        child => selectedKeys.has(child.key) &&
          !isAttributeEntityType(child.entityType) &&
          !isEmbeddedInterfaceChild(child, interfaceCandidates)
      );

      if (selectedChildren && selectedChildren.length > 0 && supportsChildNodes(node.entityType)) {
        nodesToUpdate.push({
          nodeId: existingNode.id,
          updates: {
            text_v_align: 'TOP',
            text_font_weight: 'bold',
          },
        });
      }
    }

    return { nodesToAdd, nodesToUpdate };
  }

  // Convert TreeNodeData to LayoutTreeNode for nodes that need to be laid out
  // Only include nodes that don't already exist on the diagram
  // Task Group 4: Skip attribute types in conversion
  // Task Group 3: Skip Interface-embedded children in conversion
  // Interface Parent Wrapping Fix: Pass Interface dimensions map for precomputed dimensions
  const layoutTreeRoot = convertTreeNodeToLayoutTreeWithExistingHandling(
    treeData,
    metaModel,
    selectedKeys,
    existingEntityMap,
    interfaceCandidates,
    interfaceDimensionsMap
  );

  if (!layoutTreeRoot) {
    return { nodesToAdd, nodesToUpdate };
  }

  // Run the hierarchical layout algorithm with the spacing preset and layout config
  const layoutRoot = layoutAdvancedAddSelection(layoutTreeRoot, viewportCenter, spacingPreset, layoutConfig);

  // Convert to DiagramNodes, passing erdCandidateMap for selected_attribute_ids
  // Task Group 3: Pass interfaceCandidateMap for Interface custom candidates
  const baseZIndex = calculateZIndex(diagram.diagram_nodes);
  const layoutDiagramNodes = convertTodiagramNodes(layoutRoot, baseZIndex, erdCandidateMap, metaModel, interfaceCandidateMap);

  // Now we need to:
  // 1. Filter out nodes that already exist (they shouldn't be added)
  // 2. Update parent_node_id references to point to existing nodes where appropriate
  // 3. Collect styling updates for existing parent nodes

  // Build a map of entity_id to DiagramNode from the layout result
  const layoutNodeMap = new Map<string, DiagramNode>();
  for (const node of layoutDiagramNodes) {
    layoutNodeMap.set(node.entity_id, node);
  }

  // Build children map for existing node updates
  const childrenByParent = buildChildrenMap(treeData);

  // Process nodes: filter existing, fix parent references
  for (const layoutNode of layoutDiagramNodes) {
    const entityKey = `${layoutNode.entity_type}:${layoutNode.entity_id}`;
    const existingNode = existingEntityMap.get(entityKey);

    if (existingNode) {
      // Node already exists - don't add it, but track for parent reference updates
      // Check if this existing node will have new children that need styling
      const treeNode = findTreeNodeByEntityId(treeData, layoutNode.entity_id);
      if (treeNode) {
        const selectedChildren = childrenByParent.get(entityKey)?.filter(
          child => selectedKeys.has(child.key) &&
            !isAttributeEntityType(child.entityType) &&
            !isEmbeddedInterfaceChild(child, interfaceCandidates)
        );

        if (selectedChildren && selectedChildren.length > 0 && supportsChildNodes(layoutNode.entity_type)) {
          // Calculate new size to accommodate children
          const entityName = getEntityName(metaModel, layoutNode.entity_type, layoutNode.entity_id);
          const labelHeight = calculateApplicationLabelHeight(entityName, DEFAULT_CHILD_WIDTH + 2 * PADDING, 12, 'bold');

          // Get existing children count
          const existingChildCount = countExistingChildren(existingNode.id, diagram.diagram_nodes);

          // Calculate heights for new children (excluding attributes and Interface-embedded)
          const newChildHeights: number[] = [];
          for (const child of selectedChildren) {
            const childName = getEntityName(metaModel, child.entityType, child.entityId);
            newChildHeights.push(calculateProcessNodeHeight(childName, DEFAULT_CHILD_WIDTH, 12));
          }

          // Calculate new parent size
          const allChildHeights = [
            ...Array(existingChildCount).fill(60), // Existing children with default height
            ...newChildHeights,
          ];
          const newSize = calculateParentSizeWithHeights(allChildHeights, DEFAULT_CHILD_WIDTH, labelHeight);

          nodesToUpdate.push({
            nodeId: existingNode.id,
            updates: {
              text_v_align: 'TOP',
              text_font_weight: 'bold',
              width: newSize.width,
              height: newSize.height,
            },
          });
        }
      }
    } else {
      // New node - need to fix parent_node_id if parent is an existing node
      let finalParentNodeId = layoutNode.parent_node_id;

      // Find the parent entity from the tree
      const treeNode = findTreeNodeByEntityId(treeData, layoutNode.entity_id);
      if (treeNode) {
        const parentTreeNode = findParentTreeNode(treeData, treeNode.key);
        if (parentTreeNode) {
          const parentEntityKey = `${parentTreeNode.entityType}:${parentTreeNode.entityId}`;
          const existingParent = existingEntityMap.get(parentEntityKey);
          if (existingParent) {
            // Parent is an existing node - use its ID
            finalParentNodeId = existingParent.id;
          } else {
            // Parent is a new node - find it in the layout result
            const layoutParent = layoutNodeMap.get(parentTreeNode.entityId);
            if (layoutParent) {
              finalParentNodeId = layoutParent.id;
            }
          }
        }
      }

      nodesToAdd.push({
        ...layoutNode,
        parent_node_id: finalParentNodeId,
      });
    }
  }

  return { nodesToAdd, nodesToUpdate };
}

/**
 * Build a map of parent entity keys to their children
 */
function buildChildrenMap(node: TreeNodeData): Map<string, TreeNodeData[]> {
  const childrenByParent = new Map<string, TreeNodeData[]>();

  function traverse(current: TreeNodeData) {
    for (const child of current.children) {
      const parentKey = `${current.entityType}:${current.entityId}`;
      if (!childrenByParent.has(parentKey)) {
        childrenByParent.set(parentKey, []);
      }
      childrenByParent.get(parentKey)!.push(child);
      traverse(child);
    }
  }

  traverse(node);
  return childrenByParent;
}

/**
 * Find a TreeNodeData by entity ID
 */
function findTreeNodeByEntityId(root: TreeNodeData, entityId: string): TreeNodeData | null {
  if (root.entityId === entityId) return root;
  for (const child of root.children) {
    const found = findTreeNodeByEntityId(child, entityId);
    if (found) return found;
  }
  return null;
}

/**
 * Find the parent TreeNodeData for a given node key
 */
function findParentTreeNode(
  current: TreeNodeData,
  targetKey: string,
  parent: TreeNodeData | null = null
): TreeNodeData | null {
  if (current.key === targetKey) {
    return parent;
  }
  for (const child of current.children) {
    const found = findParentTreeNode(child, targetKey, current);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Convert TreeNodeData to LayoutTreeNode, handling existing nodes.
 * Existing nodes are still included in the tree structure (for layout calculation)
 * but will be filtered out when creating DiagramNodes.
 *
 * Task Group 4 (No Attribute Nodes): Skip attribute entity types - they should not
 * become separate diagram nodes. Attributes are embedded in ERD-style entity nodes.
 *
 * Task Group 3 (Interface Parity): Skip nodes that are embedded in Interface custom candidates.
 *
 * Interface Parent Wrapping Fix: Attach precomputed dimensions to Interface nodes
 * so that the measure() function uses them instead of calculating from label text.
 * This ensures parent nodes (Service, Component, Application) correctly size to wrap
 * Interface composites with their embedded endpoints and entity boxes.
 */
function convertTreeNodeToLayoutTreeWithExistingHandling(
  treeNode: TreeNodeData,
  metaModel: MetaModel,
  selectedKeys: Set<string>,
  existingEntityMap: Map<string, DiagramNode>,
  interfaceCandidates: InterfaceCustomCandidate[] = [],
  interfaceDimensionsMap: Map<string, { width: number; height: number }> = new Map()
): LayoutTreeNode | null {
  // Only include nodes that are selected
  if (!selectedKeys.has(treeNode.key)) {
    return null;
  }

  // Task Group 4: Skip attribute entity types - they should not become diagram nodes
  // They are embedded in their parent entity nodes for ERD-style rendering
  if (isAttributeEntityType(treeNode.entityType)) {
    return null;
  }

  // Task Group 3: Skip nodes that are embedded in Interface custom candidates
  if (isEmbeddedInterfaceChild(treeNode, interfaceCandidates)) {
    return null;
  }

  const entityName = getEntityName(metaModel, treeNode.entityType, treeNode.entityId);

  // Recursively convert children (excluding attributes and Interface-embedded children)
  const children: LayoutTreeNode[] = [];
  for (const child of treeNode.children) {
    const convertedChild = convertTreeNodeToLayoutTreeWithExistingHandling(
      child,
      metaModel,
      selectedKeys,
      existingEntityMap,
      interfaceCandidates,
      interfaceDimensionsMap
    );
    if (convertedChild) {
      children.push(convertedChild);
    }
  }

  // Interface Parent Wrapping Fix: Check if this is an Interface with precomputed dimensions
  const precomputedDimensions = interfaceDimensionsMap.get(treeNode.entityId);

  // Build the LayoutTreeNode with optional precomputed dimensions
  const layoutNode: LayoutTreeNode = {
    id: treeNode.entityId,
    type: treeNode.entityType,
    label: entityName,
    children,
  };

  // Attach precomputed dimensions for Interface custom candidates
  // This allows the measure() function to use these dimensions instead of label-based sizing
  if (precomputedDimensions) {
    layoutNode.precomputedWidth = precomputedDimensions.width;
    layoutNode.precomputedHeight = precomputedDimensions.height;
  }

  return layoutNode;
}

// ============================================================================
// End Task Group 4
// ============================================================================

// Advanced Add Dialog state interface
interface AdvancedAddDialogState {
  isOpen: boolean;
  entity: { id: string; name: string; type: string } | null;
  isLoading: boolean;
  error: string | null;
}

// Task Group 2: Drawer state interface for create-and-place flow
interface CreateDrawerState {
  isOpen: boolean;
  entityType: string | null;
  title: string;
}

// Task Group 2: Cascade offset tracking state
interface CascadeState {
  diagramId: string | null;
  count: number;
}

interface PalettePanelProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  metaModel: MetaModel | null;
  currentDiagramId: string | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sectionExpandStates: Record<string, boolean>;
  onToggleSection: (sectionId: string) => void;
  onAddNode: (node: DiagramNode) => void;
  onAddNodes: (nodes: DiagramNode[]) => void;
  onAddEdge?: (edge: DiagramEdge) => void;
  onUpdateNode: (nodeId: string, updates: Partial<DiagramNode>) => void;
  onDeleteNode: (nodeId: string) => void;
  // Task Group 3: Handler for deleting diagram edges (User Interaction toggle)
  onDeleteEdges?: (edgeIds: string[]) => void;
  diagram: { diagram_nodes: DiagramNode[]; diagram_edges?: DiagramEdge[] } | undefined;
  // Viewport center fix: On-demand function to get current viewport center
  getViewportCenter?: GetViewportCenterFn;
  // Task Group 2: Callback for selecting a node after creation
  onSelectNode?: (nodeId: string) => void;
  // Task Group 3: Callback for updating entities from SelectionInspector
  onAddEntity?: (entityType: EntityType, entity: AnyEntity) => void;
  selectedNodeIds?: Set<string>;
  nodes?: DiagramNode[];
  onUpdateEntity?: (entityType: EntityType, entity: AnyEntity) => void;
  // Task Group 5: Edge selection props for edge inspector
  selectedEdgeIds?: Set<string>;
  edges?: DiagramEdge[];
  // Task Group 4: Activity flow creation mode - controlled from parent
  activityFlowCreationModeValue?: ActivityFlowCreationMode;
  onActivityFlowCreationModeChange?: (mode: ActivityFlowCreationMode) => void;
  // Spec 2026-01-01 Task Group 4: State transition creation mode - controlled from parent
  stateTransitionCreationModeValue?: TransitionCreationMode;
  onStateTransitionCreationModeChange?: (mode: TransitionCreationMode) => void;
  // Spec 2026-01-02 Task Group 8: UI Workflow Transition creation mode - controlled from parent
  workflowTransitionCreationModeValue?: WorkflowTransitionCreationMode;
  onWorkflowTransitionCreationModeChange?: (mode: WorkflowTransitionCreationMode) => void;
}

export function PalettePanel({
  isCollapsed,
  onToggleCollapse,
  metaModel,
  currentDiagramId,
  searchQuery,
  onSearchChange,
  sectionExpandStates,
  onToggleSection,
  onAddNode,
  onAddNodes,
  onAddEdge,
  onUpdateNode,
  onDeleteNode,
  onDeleteEdges,
  diagram,
  getViewportCenter,
  onSelectNode,
  onAddEntity: _onAddEntity,
  selectedNodeIds,
  nodes,
  onUpdateEntity,
  // Task Group 5: Edge selection props
  selectedEdgeIds,
  edges,
  // Task Group 4: Activity flow creation mode - controlled from parent
  activityFlowCreationModeValue,
  onActivityFlowCreationModeChange,
  // Spec 2026-01-01 Task Group 4: State transition creation mode - controlled from parent
  stateTransitionCreationModeValue,
  onStateTransitionCreationModeChange,
  // Spec 2026-01-02 Task Group 8: UI Workflow Transition creation mode
  workflowTransitionCreationModeValue,
  onWorkflowTransitionCreationModeChange,
}: PalettePanelProps) {
  // Context menu state
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState>(null);

  // Task Group 3 & 4: Warning modal state for no active diagram
  // Single warning modal handles both left-click and context menu scenarios (DRY principle)
  const [showNoDiagramWarning, setShowNoDiagramWarning] = useState(false);

  // Advanced Add Dialog state
  const [advancedAddDialogState, setAdvancedAddDialogState] = useState<AdvancedAddDialogState>({
    isOpen: false,
    entity: null,
    isLoading: false,
    error: null,
  });

  // Task Group 2: Create drawer state for entity creation flow
  const [createDrawerState, setCreateDrawerState] = useState<CreateDrawerState>({
    isOpen: false,
    entityType: null,
    title: '',
  });

  // Task Group 2: Cascade offset tracking for consecutive creates
  const [cascadeState, setCascadeState] = useState<CascadeState>({
    diagramId: null,
    count: 0,
  });

  // Task Group 5: State Transition creation mode state
  // Spec 2026-01-01 Task Group 4: Support controlled mode from parent
  const [localTransitionCreationMode, setLocalTransitionCreationMode] = useState<TransitionCreationMode>(
    initialTransitionCreationMode
  );

  // Use prop value if provided (controlled mode), otherwise use local state (uncontrolled mode)
  const transitionCreationMode = stateTransitionCreationModeValue ?? localTransitionCreationMode;
  const setTransitionCreationMode = useCallback((mode: TransitionCreationMode) => {
    if (onStateTransitionCreationModeChange) {
      onStateTransitionCreationModeChange(mode);
    } else {
      setLocalTransitionCreationMode(mode);
    }
  }, [onStateTransitionCreationModeChange]);

  // Task Group 2 (Activity Flow): Activity Flow creation mode state
  // Task Group 4: Support controlled mode from parent
  const [localActivityFlowCreationMode, setLocalActivityFlowCreationMode] = useState<ActivityFlowCreationMode>(
    initialActivityFlowCreationMode
  );

  // Use prop value if provided (controlled mode), otherwise use local state (uncontrolled mode)
  const activityFlowCreationMode = activityFlowCreationModeValue ?? localActivityFlowCreationMode;
  const setActivityFlowCreationMode = useCallback((mode: ActivityFlowCreationMode) => {
    if (onActivityFlowCreationModeChange) {
      onActivityFlowCreationModeChange(mode);
    } else {
      setLocalActivityFlowCreationMode(mode);
    }
  }, [onActivityFlowCreationModeChange]);

  // Spec 2026-01-02 Task Group 8: UI Workflow Transition creation mode state
  const [localWorkflowTransitionMode, setLocalWorkflowTransitionMode] = useState<WorkflowTransitionCreationMode>(
    initialWorkflowTransitionMode
  );

  // Use prop value if provided (controlled mode), otherwise use local state (uncontrolled mode)
  const workflowTransitionMode = workflowTransitionCreationModeValue ?? localWorkflowTransitionMode;
  const setWorkflowTransitionMode = useCallback((mode: WorkflowTransitionCreationMode) => {
    if (onWorkflowTransitionCreationModeChange) {
      onWorkflowTransitionCreationModeChange(mode);
    } else {
      setLocalWorkflowTransitionMode(mode);
    }
  }, [onWorkflowTransitionCreationModeChange]);

  // Task Group 5: Get selectedDomain from context for palette filtering
  // Task Group 6: Get model to access the full diagram for diagram_type
  const { selectedDomain, model } = useArchitecture();

  // Task Group 2: Get dispatch for ADD_ENTITY action
  const dispatch = useArchitectureDispatch();

  // Task Group 6: Get full diagram from model to extract diagram_type
  // The diagram prop only contains diagram_nodes and diagram_edges
  // We need the full Diagram object to access diagram_type
  const fullDiagram = currentDiagramId
    ? model.diagrams.find((d: Diagram) => d.id === currentDiagramId)
    : null;

  // Task Group 6: Extract diagram type using getDiagramType helper (defaults to 'General')
  const diagramType = getDiagramType(fullDiagram);

  const sections = getPaletteSections(metaModel, searchQuery, selectedDomain, diagramType);

  // Task Group 2: Reset cascade count when diagram changes
  useEffect(() => {
    if (currentDiagramId !== cascadeState.diagramId) {
      setCascadeState({
        diagramId: currentDiagramId,
        count: 0,
      });
    }
  }, [currentDiagramId, cascadeState.diagramId]);

  // Viewport center fix: Helper to get viewport center on-demand with fallback
  const getCurrentViewportCenter = (): { x: number; y: number } => {
    if (getViewportCenter) {
      return getViewportCenter();
    }
    return { ...DEFAULT_CANVAS_CENTER };
  };

  // Task Group 3 & 4: Helper to check if there's an active diagram
  // Uses existing props instead of importing hasActiveDiagram since we have
  // the diagram object directly (which is undefined when no valid diagram exists)
  const hasActiveSelectedDiagram = (): boolean => {
    return currentDiagramId !== null && diagram !== undefined;
  };

  // Task Group 3 & 4: Handler to close the warning modal
  const handleCloseNoDiagramWarning = useCallback(() => {
    setShowNoDiagramWarning(false);
  }, []);

  // Get relationships array for a given section
  const getRelationshipsForSection = (sectionId: string): AnyRelationship[] => {
    if (!metaModel) return [];

    switch (sectionId) {
      case 'logical_data_entity_relationships':
        return metaModel.relationships.logical_data_entity_relationships;
      case 'logical_data_entity_physical_data_entities':
        return metaModel.relationships.logical_data_entity_physical_data_entities;
      case 'logical_data_attribute_physical_data_attributes':
        return metaModel.relationships.logical_data_attribute_physical_data_attributes;
      case 'data_movements':
        return metaModel.relationships.data_movements;
      case 'business_user_business_points':
        return metaModel.relationships.business_user_business_points;
      case 'application_point_business_points':
        return metaModel.relationships.application_point_business_points;
      // Spec 2026-05-05: Infrastructure Domain Diagram Support - 3 relationship sections
      case 'resource_subnet_hostings':
        return metaModel.relationships.resource_subnet_hostings;
      case 'deployment_unit_compute_resources':
        return metaModel.relationships.deployment_unit_compute_resources;
      case 'load_balancer_resource_routes':
        return metaModel.relationships.load_balancer_resource_routes;
      default:
        return [];
    }
  };

  // ============================================================================
  // Task Group 2: Create Section Button Handlers
  // ============================================================================

  /**
   * Open the create drawer with the specified entity type
   */
  const handleOpenCreateDrawer = useCallback((entityType: string, title: string) => {
    if (!hasActiveSelectedDiagram()) {
      setShowNoDiagramWarning(true);
      return;
    }

    setCreateDrawerState({
      isOpen: true,
      entityType,
      title,
    });
  }, [currentDiagramId, diagram]);

  /**
   * Close the create drawer
   */
  const handleCloseCreateDrawer = useCallback(() => {
    setCreateDrawerState({
      isOpen: false,
      entityType: null,
      title: '',
    });
  }, []);

  // ============================================================================
  // Task Group 5: State Transition Creation Handlers
  // ============================================================================

  /**
   * Enter transition creation mode.
   * Called when the "+ New State Transition" button is clicked.
   */
  const handleEnterTransitionCreationMode = useCallback(() => {
    if (!hasActiveSelectedDiagram()) {
      setShowNoDiagramWarning(true);
      return;
    }
    setTransitionCreationMode(enterTransitionCreationMode());
  }, [currentDiagramId, diagram]);

  /**
   * Exit transition creation mode.
   * Called when Escape is pressed or transition is completed.
   */
  const handleExitTransitionCreationMode = useCallback(() => {
    setTransitionCreationMode(exitTransitionCreationMode());
  }, []);

  /**
   * Handle Escape key to cancel transition creation mode.
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && transitionCreationMode.active) {
        handleExitTransitionCreationMode();
      }
    };

    if (transitionCreationMode.active) {
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [transitionCreationMode.active, handleExitTransitionCreationMode]);

  // ============================================================================
  // Task Group 2 (Activity Flow): Activity Flow Creation Handlers
  // ============================================================================

  /**
   * Enter activity flow creation mode.
   * Called when the "+ New Activity Flow" button is clicked.
   */
  const handleEnterActivityFlowCreationMode = useCallback(() => {
    if (!hasActiveSelectedDiagram()) {
      setShowNoDiagramWarning(true);
      return;
    }
    setActivityFlowCreationMode(enterActivityFlowCreationMode());
  }, [currentDiagramId, diagram]);

  /**
   * Exit activity flow creation mode.
   * Called when Escape is pressed or flow creation is completed.
   */
  const handleExitActivityFlowCreationMode = useCallback(() => {
    setActivityFlowCreationMode(exitActivityFlowCreationMode());
  }, []);

  /**
   * Handle Escape key to cancel activity flow creation mode.
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && activityFlowCreationMode.active) {
        handleExitActivityFlowCreationMode();
      }
    };

    if (activityFlowCreationMode.active) {
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [activityFlowCreationMode.active, handleExitActivityFlowCreationMode]);

  // ============================================================================
  // Spec 2026-01-02 Task Group 8: UI Workflow Transition Creation Handlers
  // ============================================================================

  /**
   * Enter UI workflow transition creation mode.
   * Called when the "+ New Workflow Transition" button is clicked.
   */
  const handleEnterWorkflowTransitionMode = useCallback(() => {
    if (!hasActiveSelectedDiagram()) {
      setShowNoDiagramWarning(true);
      return;
    }
    setWorkflowTransitionMode(createInitialWorkflowTransitionMode());
  }, [currentDiagramId, diagram]);

  /**
   * Exit UI workflow transition creation mode.
   * Called when Escape is pressed or transition is completed.
   */
  const handleExitWorkflowTransitionMode = useCallback(() => {
    setWorkflowTransitionMode(createIdleWorkflowTransitionMode()); // Reset to idle state
  }, []);

  /**
   * Handle Escape key to cancel UI workflow transition creation mode.
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && workflowTransitionMode.step !== 'idle') {
        handleExitWorkflowTransitionMode();
      }
    };

    if (workflowTransitionMode.step === 'selecting-source' || workflowTransitionMode.step === 'selecting-target') {
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [workflowTransitionMode.step, handleExitWorkflowTransitionMode]);

  /**
   * Handle button click in Create section.
   * Routes to appropriate handler based on entity type.
   */
  /**
   * Handle button click in Create section.
   * Routes to appropriate handler based on entity type.
   * Task Group 3 (Activity Flow): Extended to handle ACTIVITY_FLOW entity type
   * Spec 2026-01-02 Task Group 8: Extended to handle UI_WORKFLOW_TRANSITION entity type
   */
  const handleCreateButtonClick = useCallback((entityType: string, title: string) => {
    if (entityType === 'STATE_TRANSITION') {
      // Toggle transition creation mode
      if (transitionCreationMode.active) {
        handleExitTransitionCreationMode();
      } else {
        handleEnterTransitionCreationMode();
      }
    } else if (entityType === 'ACTIVITY_FLOW') {
      // Task Group 3: Toggle activity flow creation mode
      if (activityFlowCreationMode.active) {
        handleExitActivityFlowCreationMode();
      } else {
        handleEnterActivityFlowCreationMode();
      }
    } else if (entityType === 'UI_WORKFLOW_TRANSITION') {
      // Spec 2026-01-02 Task Group 8: Toggle workflow transition creation mode
      const isWorkflowTransitionActive = workflowTransitionMode.step === 'selecting-source' || workflowTransitionMode.step === 'selecting-target';
      if (isWorkflowTransitionActive) {
        handleExitWorkflowTransitionMode();
      } else {
        handleEnterWorkflowTransitionMode();
      }
    } else if (entityType === 'LOGICAL_DATA_ENTITY_RELATIONSHIP') {
      // Task Group 2 (ER Diagrams V1 Parity): Create new Logical ER relationship immediately (no drawer needed)
      if (!hasActiveSelectedDiagram()) {
        setShowNoDiagramWarning(true);
        return;
      }
      const newRelationship: LogicalDataEntityRelationship = {
        id: generatePrefixedId('ler'),
        // Logical ER Meta-Model Upgrade: Updated to use polymorphic endpoint fields
        from_ref_kind: 'LOGICAL_ENTITY',
        from_ref_id: '',
        to_ref_kind: 'LOGICAL_ENTITY',
        to_ref_id: '',
        cardinality: 'ONE_TO_ONE',
        // relationship is optional - user can set later
        description: '',
        tags: '',
      };
      dispatch({
        type: 'ADD_RELATIONSHIP',
        relationshipType: 'logical_data_entity_relationships',
        relationship: newRelationship,
      });
    } else {
      // Use the standard create drawer for other entity types
      handleOpenCreateDrawer(entityType, title);
    }
  }, [transitionCreationMode.active, activityFlowCreationMode.active, handleEnterTransitionCreationMode, handleExitTransitionCreationMode, handleEnterActivityFlowCreationMode, handleExitActivityFlowCreationMode, handleOpenCreateDrawer, dispatch]);
  /**
   * Map entity type constant to EntityType for ADD_ENTITY dispatch
   */
  const getEntityTypeKey = (entityType: string): EntityType => {
    const mapping: Record<string, EntityType> = {
      [ENTITY_TYPES.STATE]: 'states',
      [ENTITY_TYPES.ACTIVITY]: 'activities',
      [ENTITY_TYPES.ACTIVITY_PARTITION]: 'activity_partitions',
      [ENTITY_TYPES.LOGICAL_DATA_ENTITY]: 'logical_data_entities',
      [ENTITY_TYPES.PHYSICAL_DATA_ENTITY]: 'physical_data_entities',
      [ENTITY_TYPES.UI_SCREEN]: 'ui_screens',
    };
    return mapping[entityType] || (entityType.toLowerCase() as EntityType);
  };

  /**
   * Get ID prefix for entity type
   */
  const getIdPrefix = (entityType: string): string => {
    const prefixMap: Record<string, string> = {
      [ENTITY_TYPES.STATE]: 'state',
      [ENTITY_TYPES.ACTIVITY]: 'activity',
      [ENTITY_TYPES.ACTIVITY_PARTITION]: 'partition',
      [ENTITY_TYPES.LOGICAL_DATA_ENTITY]: 'lde',
      [ENTITY_TYPES.PHYSICAL_DATA_ENTITY]: 'pde',
      [ENTITY_TYPES.UI_SCREEN]: 'uiscreen',
    };
    return prefixMap[entityType] || 'entity';
  };

  /**
   * Build entity object from form data based on entity type
   */
  const buildEntityFromFormData = (
    entityType: string,
    entityId: string,
    formData: Record<string, unknown>
  ): State | Activity | ActivityPartition | LogicalDataEntity | PhysicalDataEntity | UIScreen => {
    switch (entityType) {
      case ENTITY_TYPES.STATE:
        return {
          id: entityId,
          name: String(formData.name || ''),
          description: String(formData.description || ''),
          state_kind: (formData.stateKind as 'Initial' | 'Normal' | 'Final') || 'Normal',
        } as State;

      case ENTITY_TYPES.ACTIVITY:
        return {
          id: entityId,
          name: String(formData.name || ''),
          description: String(formData.description || ''),
          activity_kind: (formData.activityKind as 'Initial' | 'Action' | 'Decision' | 'Merge' | 'Final') || 'Action',
        } as Activity;

      case ENTITY_TYPES.ACTIVITY_PARTITION:
        return {
          id: entityId,
          name: formData.refKind ? undefined : String(formData.name || ''),
          description: String(formData.description || ''),
          ref_kind: formData.refKind ? String(formData.refKind) as any : undefined,
          ref_id: formData.refId ? String(formData.refId) : undefined,
        } as ActivityPartition;

      case ENTITY_TYPES.LOGICAL_DATA_ENTITY:
        return {
          id: entityId,
          name: String(formData.name || ''),
          description: String(formData.description || ''),
          tags: String(formData.tags || ''),
        } as LogicalDataEntity;

      case ENTITY_TYPES.PHYSICAL_DATA_ENTITY:
        return {
          id: entityId,
          name: String(formData.name || ''),
          description: String(formData.description || ''),
          physical_type: String(formData.physical_type || ''),
          database: String(formData.database || ''),
          tags: String(formData.tags || ''),
        } as PhysicalDataEntity;

      case ENTITY_TYPES.UI_SCREEN:
        return {
          id: entityId,
          name: String(formData.name || ''),
          route: String(formData.route || '/'),
          description: formData.description ? String(formData.description) : undefined,
        } as UIScreen;

      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }
  };

  /**
   * Handle form submission from CreateAndPlaceDrawer
   * Task Group 2: Implements the complete create-and-place flow
   */
  const handleCreateAndPlace = useCallback(async (formData: Record<string, unknown>) => {
    const entityType = createDrawerState.entityType;
    if (!entityType || !currentDiagramId || !diagram) {
      throw new Error('No entity type or diagram selected');
    }

    // Step 1: Generate entity ID
    const idPrefix = getIdPrefix(entityType);
    const entityId = generatePrefixedId(idPrefix);

    // Step 2: Build entity object from form data
    const entity = buildEntityFromFormData(entityType, entityId, formData);

    // Step 3: Dispatch ADD_ENTITY action
    const entityTypeKey = getEntityTypeKey(entityType);
    dispatch({
      type: 'ADD_ENTITY',
      entityType: entityTypeKey,
      entity: entity as any,
    });

    // Step 4: Node positioning uses fixed spawn origin (100, 100)
    // Nodes now spawn at DEFAULT_NODE_SPAWN_ORIGIN regardless of viewport

    // Step 5: Create diagram node at fixed spawn position
    // Task Group 1 (ER Diagrams V1 Parity): Use ERD node creation for ER diagrams
    let newNode: DiagramNode;
    if (shouldCreateERDNode(entityType, diagramType) && metaModel) {
      // For ER diagrams with data entities, create ERD-style node with attributes
      const erdNode = createERDNodeFromEntity(
        entityType,
        entityId,
        diagram.diagram_nodes,
        metaModel
      );
      if (!erdNode) {
        throw new Error('Failed to create ERD node');
      }
      newNode = erdNode;
    } else {
      // Standard node creation for all other cases
      newNode = createDiagramNodeFromEntity(
        entityType,
        entityId,
        diagram.diagram_nodes
      );
    }

    // Step 6: Add node to diagram via ADD_DIAGRAM_NODE
    dispatch({
      type: 'ADD_DIAGRAM_NODE',
      payload: {
        diagramId: currentDiagramId,
        node: newNode,
      },
    });

    // Step 7: Auto-select the new node
    if (onSelectNode) {
      onSelectNode(newNode.id);
    }

    // Step 9: Close the drawer (handled by CreateAndPlaceDrawer after onSubmit resolves)
  }, [createDrawerState.entityType, currentDiagramId, diagram, dispatch, onSelectNode, diagramType, metaModel]);

  // ============================================================================
  // Task Group 3: Handle deleting a User Interaction from the diagram
  // Deletes all edges (MAIN and USER_LINK) for a given interaction
  // ============================================================================
  const handleDeleteUserInteraction = useCallback((item: { id: string; name: string }) => {
    if (!currentDiagramId || !diagram || !onDeleteEdges) {
      return;
    }

    // Find all edges for this interaction
    const edgesToDelete = (diagram.diagram_edges || []).filter(
      edge =>
        edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
        edge.relationship_id === item.id
    );

    if (edgesToDelete.length === 0) {
      console.log('No edges found for this interaction');
      return;
    }

    // Delete all edges for this interaction
    const edgeIds = edgesToDelete.map(edge => edge.id);
    onDeleteEdges(edgeIds);
  }, [currentDiagramId, diagram, onDeleteEdges]);

  // ============================================================================
  // Task Group 3 (ER Diagram UX Enhancements): Handle deleting a LogicalER edge
  // Deletes the LogicalER edge from diagram (NOT the meta-model relationship)
  // ============================================================================
  const handleDeleteLogicalER = useCallback((item: { id: string; name: string }) => {
    if (!currentDiagramId || !diagram || !onDeleteEdges) {
      return;
    }

    // Find the edge for this LogicalER relationship
    const edgeToDelete = (diagram.diagram_edges || []).find(
      edge =>
        edge.relationship_type === RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP &&
        edge.relationship_id === item.id
    );

    if (!edgeToDelete) {
      console.log('No LogicalER edge found for this relationship');
      return;
    }

    // Delete only the diagram edge (NOT the meta-model relationship)
    onDeleteEdges([edgeToDelete.id]);
  }, [currentDiagramId, diagram, onDeleteEdges]);

  // Task Group 3: Handle adding a User Interaction to the diagram
  const handleAddUserInteraction = useCallback((item: { id: string; name: string }) => {
    if (!currentDiagramId || !diagram || !metaModel || !onAddEdge) {
      return;
    }

    // Find the interaction in the meta-model
    const interaction = metaModel.entities.interactions?.find(i => i.id === item.id);
    if (!interaction) {
      console.warn('Interaction not found:', item.id);
      return;
    }

    // Create a proper Diagram object for the helper function
    const fullDiagramForInteraction: Diagram = {
      id: currentDiagramId,
      name: 'Current Diagram',
      description: '',
      diagram_nodes: diagram.diagram_nodes,
      diagram_edges: diagram.diagram_edges || [],
    };

    // Check if the interaction row is enabled (required nodes present, no existing edges)
    if (!isUserInteractionRowEnabled(interaction, fullDiagramForInteraction, metaModel)) {
      console.log('User Interaction row is not enabled - required nodes not on diagram or edges already exist');
      return;
    }

    try {
      // Create the User Interaction edges
      const result = addUserInteractionToDiagram(interaction, fullDiagramForInteraction, metaModel);

      // Add the MAIN edge
      onAddEdge(result.mainEdge);

      // Optionally add the USER_LINK edge (Case A with User node present)
      if (result.userLinkEdge) {
        onAddEdge(result.userLinkEdge);
      }
    } catch (error) {
      console.error('Failed to add User Interaction:', error);
    }
  }, [currentDiagramId, diagram, metaModel, onAddEdge]);

  // Handle adding a relationship to the diagram
  // Task Group 3: Updated to handle User Interaction add/delete toggle
  const handleAddRelationship = useCallback((item: { id: string; name: string }, sectionId: string) => {
    if (!currentDiagramId || !diagram || !metaModel || !onAddEdge) {
      return;
    }

    // Task Group 3: Handle User Interactions with add/delete toggle
    if (sectionId === 'interactions') {
      // Check if edges already exist for this interaction
      const existingEdges = (diagram.diagram_edges || []).filter(
        edge =>
          edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
          edge.relationship_id === item.id &&
          edge.subType === 'MAIN'
      );

      if (existingEdges.length > 0) {
        // Edges exist - delete them
        handleDeleteUserInteraction(item);
      } else {
        // No edges - try to add them
        handleAddUserInteraction(item);
      }
      return;
    }

    const relationships = getRelationshipsForSection(sectionId);
    const relationship = relationships.find((r) => r.id === item.id);

    if (!relationship) {
      console.warn('Relationship not found:', item.id);
      return;
    }

    // Check if relationship is enabled
    if (!isRelationshipRowEnabled(relationship, sectionId, diagram.diagram_nodes, metaModel)) {
      console.log('Relationship is not enabled - endpoints not on diagram');
      return;
    }

    let edge: DiagramEdge | null = null;

    switch (sectionId) {
      case 'logical_data_entity_relationships': {
        // Logical ER: solid line with multiplicity labels
        const nodes = getLogicalERNodes(relationship as LogicalDataEntityRelationship, diagram.diagram_nodes);
        if (nodes) {
          const rel = relationship as LogicalDataEntityRelationship;
          edge = createRelationshipEdge(
            relationship,
            RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
            nodes.sourceNode,
            nodes.targetNode,
            { multiplicityType: rel.cardinality }
          );
        }
        break;
      }

      case 'logical_data_entity_physical_data_entities': {
        // Logical-Physical Entity: simple solid line
        const nodes = getLogicalPhysicalEntityNodes(relationship as LogicalDataEntityPhysicalDataEntity, diagram.diagram_nodes);
        if (nodes) {
          edge = createRelationshipEdge(
            relationship,
            RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_PHYSICAL_DATA_ENTITY,
            nodes.sourceNode,
            nodes.targetNode
          );
        }
        break;
      }

      case 'logical_data_attribute_physical_data_attributes': {
        // Logical-Physical Attribute: simple solid line
        const nodes = getLogicalPhysicalAttributeNodes(relationship as LogicalDataAttributePhysicalDataAttribute, diagram.diagram_nodes);
        if (nodes) {
          edge = createRelationshipEdge(
            relationship,
            RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ATTRIBUTE_PHYSICAL_DATA_ATTRIBUTE,
            nodes.sourceNode,
            nodes.targetNode
          );
        }
        break;
      }

      case 'data_movements': {
        // Data Movement: solid line with arrow and entity name label
        const nodes = getDataMovementNodes(relationship as DataMovement, diagram.diagram_nodes, metaModel);
        if (nodes) {
          const labelText = getDataMovementEntityName(relationship as DataMovement, metaModel);
          edge = createRelationshipEdge(
            relationship,
            RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT,
            nodes.sourceNode,
            nodes.targetNode,
            { labelText }
          );
        }
        break;
      }

      case 'business_user_business_points': {
        // User-Business Point: dashed line, no arrow
        const nodes = getUserBusinessPointNodes(relationship as BusinessUserBusinessPoint, diagram.diagram_nodes, metaModel);
        if (nodes) {
          edge = createRelationshipEdge(
            relationship,
            RELATIONSHIP_EDGE_TYPES.USER_BUSINESS_POINT,
            nodes.sourceNode,
            nodes.targetNode
          );
        }
        break;
      }

      case 'application_point_business_points': {
        // App Point-Business Point: solid line, no arrow
        const nodes = getAppPointBusinessPointNodes(relationship as ApplicationPointBusinessPoint, diagram.diagram_nodes, metaModel);
        if (nodes) {
          edge = createRelationshipEdge(
            relationship,
            RELATIONSHIP_EDGE_TYPES.APP_POINT_BUSINESS_POINT,
            nodes.sourceNode,
            nodes.targetNode
          );
        }
        break;
      }

      // Spec 2026-05-05: Infrastructure Domain Diagram Support
      // resource_subnet_hostings is containment-only - NO DiagramEdge is created.
      // When both endpoints (resource node + Subnet node) are on the canvas, set the
      // resource node's parent_node_id to the Subnet node id. The existing compoundLayout
      // parent-with-children sizing handles container resize automatically.
      // (One-shot post-add hook; pre-existing rows on diagram open are NOT auto-converted.)
      case 'resource_subnet_hostings': {
        const rsh = relationship as ResourceSubnetHosting;
        // Resolve infrastructure_point_id to its concrete entity reference.
        const ip = (metaModel.entities.infrastructure_points || []).find(p => p.id === rsh.infrastructure_point_id);
        if (!ip) {
          break;
        }
        // Map InfrastructurePointKind to its typed FK field on infrastructure_points.
        const kindToFk: Record<string, string> = {
          COMPUTE_RESOURCE: 'compute_resource_id',
          DATA_STORE_INSTANCE: 'data_store_instance_id',
          LOAD_BALANCER: 'load_balancer_id',
          INFRASTRUCTURE_RESOURCE: 'infrastructure_resource_id',
        };
        const fkField = kindToFk[ip.point_kind];
        if (!fkField) {
          // point_kind not in spec 4 allowedKinds - no-op.
          break;
        }
        const concreteEntityId = (ip as unknown as Record<string, unknown>)[fkField] as string | undefined;
        if (!concreteEntityId) {
          break;
        }
        // Look up resource node and Subnet node on canvas.
        const resourceNode = diagram.diagram_nodes.find(
          n => n.entity_type === ip.point_kind && n.entity_id === concreteEntityId
        );
        const subnetNode = diagram.diagram_nodes.find(
          n => n.entity_type === 'SUBNET' && n.entity_id === rsh.subnet_id
        );
        if (!resourceNode || !subnetNode) {
          // Either endpoint missing - no-op (palette guard from isRelationshipRowEnabled
          // should already prevent reaching this case, but be defensive).
          break;
        }
        // Set parent_node_id to wire containment. NO DiagramEdge created.
        onUpdateNode(resourceNode.id, { parent_node_id: subnetNode.id });
        break;
      }

      case 'deployment_unit_compute_resources': {
        // Spec 2026-05-05: DeploymentUnit -> Compute resource edge (DASHED, no arrow, label "runs on" or version).
        const ducr = relationship as DeploymentUnitComputeResource;
        const ip = (metaModel.entities.infrastructure_points || []).find(p => p.id === ducr.compute_infrastructure_point_id);
        if (!ip) break;
        const kindToFk: Record<string, string> = {
          COMPUTE_RESOURCE: 'compute_resource_id',
          COMPUTE_CLUSTER: 'compute_cluster_id',
        };
        const fkField = kindToFk[ip.point_kind];
        if (!fkField) break;
        const concreteEntityId = (ip as unknown as Record<string, unknown>)[fkField] as string | undefined;
        if (!concreteEntityId) break;
        const sourceNode = diagram.diagram_nodes.find(
          n => n.entity_type === 'DEPLOYMENT_UNIT' && n.entity_id === ducr.deployment_unit_id
        );
        const targetNode = diagram.diagram_nodes.find(
          n => n.entity_type === ip.point_kind && n.entity_id === concreteEntityId
        );
        if (sourceNode && targetNode) {
          edge = createRelationshipEdge(
            relationship,
            RELATIONSHIP_EDGE_TYPES.DEPLOYMENT_UNIT_COMPUTE_RESOURCE,
            sourceNode,
            targetNode
          );
        }
        break;
      }

      case 'load_balancer_resource_routes': {
        // Spec 2026-05-05: LoadBalancer -> target resource edge (SOLID + ARROW, label "<protocol> <target_port>").
        const lbrr = relationship as LoadBalancerResourceRoute;
        const ip = (metaModel.entities.infrastructure_points || []).find(p => p.id === lbrr.target_infrastructure_point_id);
        if (!ip) break;
        const kindToFk: Record<string, string> = {
          COMPUTE_RESOURCE: 'compute_resource_id',
          COMPUTE_CLUSTER: 'compute_cluster_id',
          DATA_STORE_INSTANCE: 'data_store_instance_id',
          INFRASTRUCTURE_RESOURCE: 'infrastructure_resource_id',
        };
        const fkField = kindToFk[ip.point_kind];
        if (!fkField) break;
        const concreteEntityId = (ip as unknown as Record<string, unknown>)[fkField] as string | undefined;
        if (!concreteEntityId) break;
        const sourceNode = diagram.diagram_nodes.find(
          n => n.entity_type === 'LOAD_BALANCER' && n.entity_id === lbrr.load_balancer_id
        );
        const targetNode = diagram.diagram_nodes.find(
          n => n.entity_type === ip.point_kind && n.entity_id === concreteEntityId
        );
        if (sourceNode && targetNode) {
          edge = createRelationshipEdge(
            relationship,
            RELATIONSHIP_EDGE_TYPES.LOAD_BALANCER_RESOURCE_ROUTE,
            sourceNode,
            targetNode
          );
        }
        break;
      }
    }

    if (edge) {
      onAddEdge(edge);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDiagramId, diagram, metaModel, onAddEdge, onAddNode, onAddNodes, onUpdateNode, getViewportCenter, handleAddUserInteraction, handleDeleteUserInteraction]);

  // ==========================================================================
  // Spec 2025-12-31 (A4): Handle adding existing Activity Flow as edge (not node)
  // ==========================================================================

  /**
   * Handle adding an existing Activity Flow to the diagram.
   * Creates a diagram edge (not a node) connecting the source and target activity nodes.
   *
   * Validation:
   * - Both from_activity_id and to_activity_id must have nodes on the diagram
   * - If either is missing, show a toast warning and do not create dangling edge
   *
   * @param flowId - The ID of the existing ActivityFlow entity
   */
  const handleAddExistingActivityFlow = useCallback((flowId: string) => {
    if (!currentDiagramId || !diagram || !metaModel || !onAddEdge) {
      return;
    }

    // Find the activity flow entity
    const flow = metaModel.entities.activity_flows?.find(f => f.id === flowId);
    if (!flow) {
      console.warn('Activity flow not found:', flowId);
      return;
    }

    // Find the source activity node on the diagram
    const sourceNode = diagram.diagram_nodes.find(
      n => n.entity_type === 'ACTIVITY' && n.entity_id === flow.from_activity_id
    );

    // Find the target activity node on the diagram
    const targetNode = diagram.diagram_nodes.find(
      n => n.entity_type === 'ACTIVITY' && n.entity_id === flow.to_activity_id
    );

    // Validate both nodes are present
    if (!sourceNode || !targetNode) {
      // Show warning - cannot add flow without both activity nodes
      console.warn('Add both activities to the diagram before adding this flow.');
      // Note: In a future enhancement, this could show a toast notification
      return;
    }

    // Check if edge already exists for this flow
    const existingEdge = diagram.diagram_edges?.find(
      e => e.relationship_type === 'ACTIVITY_FLOW' && e.relationship_id === flowId
    );
    if (existingEdge) {
      console.log('Edge already exists for this activity flow');
      return;
    }

    // Create the diagram edge using the same function as new flow creation
    const edge = createActivityFlowDiagramEdge(
      flowId,
      sourceNode.id,
      targetNode.id,
      sourceNode,
      targetNode
    );

    // Add the edge to the diagram
    onAddEdge(edge);
  }, [currentDiagramId, diagram, metaModel, onAddEdge]);


  // Handle left-click to add item
  // Task Group 3: Updated to use viewport center for node positioning
  const handleItemClick = (item: { id: string; name: string }, sectionId: string, itemType: 'entity' | 'relationship') => {
    // Task Group 3: Check for active diagram FIRST and show warning modal if none
    if (!hasActiveSelectedDiagram()) {
      setShowNoDiagramWarning(true);
      return;
    }

    // Only add entities - the check below is now redundant but kept for safety
    if (!currentDiagramId || !diagram) {
      console.warn('No diagram selected');
      return;
    }

    // Handle relationship items
    if (itemType === 'relationship') {
      handleAddRelationship(item, sectionId);
      return;
    }

    // Spec 2025-12-31 (A4): Special handling for activity_flows section
    // Activity flows should be added as edges, not nodes
    if (sectionId === 'activity_flows') {
      handleAddExistingActivityFlow(item.id);
      return;
    }


    // Get entity type constant
    const entity_type = getEntityTypeConstant(sectionId);
    const entity_id = item.id;

    // Check for duplicate
    if (nodeExistsForEntity(diagram.diagram_nodes, entity_type, entity_id)) {
      console.log('Node already exists for this entity');
      return;
    }

    // Special handling for PROCESS_ACTIVITY: auto-create parent if needed
    if (entity_type === ENTITY_TYPES.PROCESS_ACTIVITY && metaModel) {
      handleAddProcessActivity(item, sectionId);
      return;
    }

    // Viewport center fix: Get viewport center on-demand at click time
    const viewportCenter = getCurrentViewportCenter();

    // Task Group 1 (ER Diagrams V1 Parity): Use ERD node creation for ER diagrams
    let newNode: DiagramNode;
    if (shouldCreateERDNode(entity_type, diagramType) && metaModel) {
      // For ER diagrams with data entities, create ERD-style node with attributes
      const erdNode = createERDNodeFromEntity(
        entity_type,
        entity_id,
        diagram.diagram_nodes,
        metaModel,
        viewportCenter
      );
      if (erdNode) {
        newNode = erdNode;
      } else {
        // Fallback to standard node if ERD creation fails
        newNode = createDiagramNodeFromEntity(
          entity_type,
          entity_id,
          diagram.diagram_nodes,
          viewportCenter
        );
      }
    } else {
      // Standard node creation for all other cases
      newNode = createDiagramNodeFromEntity(
        entity_type,
        entity_id,
        diagram.diagram_nodes,
        viewportCenter
      );
    }

    // Add node to diagram
    onAddNode(newNode);
  };

  // Handle adding a single process activity (with auto-create parent if needed)
  const handleAddProcessActivity = useCallback((item: { id: string; name: string }, _sectionId: string) => {
    if (!currentDiagramId || !diagram || !metaModel) {
      setShowNoDiagramWarning(true);
      return;
    }

    const activityId = item.id;
    const activity = metaModel.entities.process_activities.find(
      (a: ProcessActivity) => a.id === activityId
    );

    if (!activity) {
      console.warn('Activity not found:', activityId);
      return;
    }

    // Check if activity already on diagram
    if (nodeExistsForEntity(diagram.diagram_nodes, ENTITY_TYPES.PROCESS_ACTIVITY, activityId)) {
      console.log('Activity already on diagram');
      return;
    }

    // Find parent business process
    const businessProcessId = activity.business_process_id;
    const businessProcess = metaModel.entities.business_processes.find(
      p => p.id === businessProcessId
    );

    if (!businessProcess) {
      console.warn('Business process not found for activity:', businessProcessId);
      return;
    }

    // Check if parent process is on diagram
    let parentNode = diagram.diagram_nodes.find(
      n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS && n.entity_id === businessProcessId
    );

    const nodesToAdd: DiagramNode[] = [];
    let parentNodeId: string;
    const isNewParent = !parentNode;

    // Calculate parent width (fixed)
    const parentWidth = DEFAULT_CHILD_WIDTH + 10; // 130px

    // Calculate Process label height dynamically
    const labelHeight = calculateApplicationLabelHeight(businessProcess.name, parentWidth, 12, 'bold');

    if (!parentNode) {
      // Create new parent process node with styling
      parentNode = createDiagramNodeFromEntity(
        ENTITY_TYPES.BUSINESS_PROCESS,
        businessProcessId,
        diagram.diagram_nodes
      );

      // Apply styling
      parentNode = {
        ...parentNode,
        text_v_align: 'TOP',
        text_font_weight: 'bold',
      };

      nodesToAdd.push(parentNode);
      parentNodeId = parentNode.id;
    } else {
      parentNodeId = parentNode.id;

      // Apply styling for existing nodes
      onUpdateNode(parentNodeId, {
        text_v_align: 'TOP',
        text_font_weight: 'bold',
      });
    }

    // Count existing children of parent for positioning
    const currentChildCount = countExistingChildren(
      parentNodeId,
      [...diagram.diagram_nodes, ...nodesToAdd]
    );

    // Calculate height for the activity
    const activityHeight = calculateProcessNodeHeight(activity.name, DEFAULT_CHILD_WIDTH, 12);
    const childHeights = [activityHeight];

    // Calculate child position
    const tempParentForPositioning = parentNode || nodesToAdd[0];
    const baseZIndex = calculateZIndex([...diagram.diagram_nodes, ...nodesToAdd]);

    const childPos = calculateChildPositionWithHeights(
      tempParentForPositioning,
      0,
      currentChildCount,
      childHeights,
      labelHeight
    );

    const childNode: DiagramNode = {
      id: generatePrefixedId('node'),
      entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
      entity_id: activityId,
      pos_x: childPos.pos_x,
      pos_y: childPos.pos_y,
      width: DEFAULT_CHILD_WIDTH,
      height: activityHeight,
      auto_size: false,
      z_index: baseZIndex + 1,
      parent_node_id: parentNodeId,
      style_override: {},
    };

    nodesToAdd.push(childNode);

    // Calculate parent size with dynamic heights
    const allChildHeights = [
      ...Array(currentChildCount).fill(60),
      ...childHeights,
    ];

    const newSize = calculateParentSizeWithHeights(allChildHeights, DEFAULT_CHILD_WIDTH, labelHeight);

    // Position the parent if new
    if (isNewParent) {
      // Use fixed spawn position (100, 100) for new parent nodes
      const pos_x = DEFAULT_NODE_SPAWN_ORIGIN.x;
      const pos_y = DEFAULT_NODE_SPAWN_ORIGIN.y;

      if (nodesToAdd.length > 0 && nodesToAdd[0].id === parentNodeId) {
        nodesToAdd[0] = {
          ...nodesToAdd[0],
          pos_x,
          pos_y,
          width: newSize.width,
          height: newSize.height,
        };

        // Recalculate child position
        const updatedChildPos = calculateChildPositionWithHeights(
          nodesToAdd[0],
          0,
          currentChildCount,
          childHeights,
          labelHeight
        );
        nodesToAdd[1] = {
          ...nodesToAdd[1],
          pos_x: updatedChildPos.pos_x,
          pos_y: updatedChildPos.pos_y,
        };
      }
    }

    // Add all nodes
    if (nodesToAdd.length > 0) {
      onAddNodes(nodesToAdd);
    }

    // Update parent sizing for existing parents
    if (!isNewParent) {
      onUpdateNode(parentNodeId, {
        width: newSize.width,
        height: newSize.height,
      });
    }
  }, [currentDiagramId, diagram, metaModel, onAddNodes, onUpdateNode, getViewportCenter]);

  // Handle right-click context menu
  const handleItemContextMenu = useCallback((
    e: React.MouseEvent,
    item: { id: string; name: string },
    sectionId: string
  ) => {
    setContextMenuState({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      item,
      sectionId,
    });
  }, []);

  // Close context menu
  const handleCloseMenu = useCallback(() => {
    setContextMenuState(null);
  }, []);

  // Context menu: Add action
  // Task Group 3: Updated to use viewport center for node positioning
  const handleContextMenuAdd = useCallback((item: PaletteItemData, sectionId: string) => {
    // Task Group 4: Show warning modal if no active diagram
    if (!currentDiagramId || !diagram) {
      setShowNoDiagramWarning(true);
      return;
    }

    const entity_type = getEntityTypeConstant(sectionId);
    const entity_id = item.id;

    // Check for duplicate
    if (nodeExistsForEntity(diagram.diagram_nodes, entity_type, entity_id)) {
      console.log('Node already exists for this entity');
      return;
    }

    // Special handling for PROCESS_ACTIVITY: auto-create parent if needed
    if (entity_type === ENTITY_TYPES.PROCESS_ACTIVITY && metaModel) {
      handleAddProcessActivity(item, sectionId);
      return;
    }

    // Task Group 3: Get viewport center for positioning
    const viewportCenter = getCurrentViewportCenter();

    // Create new node at viewport center
    const newNode = createDiagramNodeFromEntity(
      entity_type,
      entity_id,
      diagram.diagram_nodes,
      viewportCenter
    );

    // Add node to diagram
    onAddNode(newNode);
  }, [currentDiagramId, diagram, metaModel, onAddNode, getViewportCenter, handleAddProcessActivity]);

  // Context menu: Add relationship action
  const handleContextMenuAddRelationship = useCallback((item: PaletteItemData, sectionId: string) => {
    if (!currentDiagramId || !diagram) {
      setShowNoDiagramWarning(true);
      return;
    }

    handleAddRelationship(item, sectionId);
  }, [currentDiagramId, diagram, handleAddRelationship]);

  // Standardise User Interaction Palette UI: Context menu delete relationship handler
  // This is called when the context menu "Delete" option is clicked for interactions
  const handleContextMenuDeleteRelationship = useCallback((item: PaletteItemData, sectionId: string) => {
    if (!currentDiagramId || !diagram) {
      return;
    }

    // Handle interactions section
    if (sectionId === 'interactions') {
      handleDeleteUserInteraction(item);
      return;
    }

    // Task Group 3 (ER Diagram UX Enhancements): Handle LogicalER section
    if (sectionId === 'logical_data_entity_relationships') {
      handleDeleteLogicalER(item);
      return;
    }
  }, [currentDiagramId, diagram, handleDeleteUserInteraction, handleDeleteLogicalER]);

  // Context menu: Delete action
  const handleContextMenuDelete = useCallback((item: PaletteItemData, sectionId: string) => {
    if (!currentDiagramId || !diagram) {
      console.warn('No diagram selected');
      return;
    }

    const entity_type = getEntityTypeConstant(sectionId);
    const entity_id = item.id;

    // Find the node ID by querying diagram_nodes
    const nodeToDelete = diagram.diagram_nodes.find(
      n => n.entity_type === entity_type && n.entity_id === entity_id
    );

    if (!nodeToDelete) {
      console.warn('Node not found on diagram');
      return;
    }

    // Delete the node (edge cascade handled by reducer)
    onDeleteNode(nodeToDelete.id);
  }, [currentDiagramId, diagram, onDeleteNode]);

  // Context menu: Add with business processes
  // Task Group 4: Updated to use shared getViewportCenter helper
  // Note: _sectionId is unused because this action is only available for APPLICATION items
  const handleAddWithBusinessProcesses = useCallback((item: PaletteItemData, _sectionId: string) => {
    // Task Group 4: Show warning modal if no active diagram or meta-model
    if (!currentDiagramId || !diagram || !metaModel) {
      setShowNoDiagramWarning(true);
      return;
    }

    const applicationId = item.id;
    const entity_type = ENTITY_TYPES.APPLICATION;

    // Step 1: Find or create parent Application node
    let parentNode = diagram.diagram_nodes.find(
      n => n.entity_type === entity_type && n.entity_id === applicationId
    );

    const nodesToAdd: DiagramNode[] = [];
    let parentNodeId: string;
    const isNewParent = !parentNode;

    // Look up Application name for label height calculation
    const application = metaModel.entities.applications.find(a => a.id === applicationId);
    const appName = application?.name || 'Application';

    // Calculate parent width (fixed)
    const parentWidth = DEFAULT_CHILD_WIDTH + 10; // 130px

    // Calculate Application label height dynamically
    const labelHeight = calculateApplicationLabelHeight(appName, parentWidth, 12, 'bold');

    if (!parentNode) {
      // Create new parent node with styling
      // Task Group 4.2: Apply Application label styling for NEW nodes
      parentNode = createDiagramNodeFromEntity(
        entity_type,
        applicationId,
        diagram.diagram_nodes
      );

      // Apply styling
      parentNode = {
        ...parentNode,
        text_v_align: 'TOP',
        text_font_weight: 'bold',
      };

      nodesToAdd.push(parentNode);
      parentNodeId = parentNode.id;
    } else {
      parentNodeId = parentNode.id;

      // Task Group 4.3: Apply Application label styling for EXISTING nodes
      onUpdateNode(parentNodeId, {
        text_v_align: 'TOP',
        text_font_weight: 'bold',
      });
    }

    // Step 2: Find linked business processes
    const businessProcessIds = findLinkedBusinessProcesses(metaModel, applicationId);

    if (businessProcessIds.length === 0) {
      // No business processes linked - just add the parent if it's new
      if (nodesToAdd.length > 0) {
        onAddNodes(nodesToAdd);
      }
      return;
    }

    // Step 3: Filter out processes that already exist on diagram
    const existingProcessNodes = diagram.diagram_nodes.filter(
      n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS &&
           businessProcessIds.includes(n.entity_id)
    );
    const existingProcessIds = new Set(existingProcessNodes.map(n => n.entity_id));

    const newProcessIds = businessProcessIds.filter(id => !existingProcessIds.has(id));

    // Count existing children of parent for positioning
    const currentChildCount = countExistingChildren(
      parentNodeId,
      [...diagram.diagram_nodes, ...nodesToAdd]
    );

    // Task Group 4.4: Calculate dynamic heights for Business Process children
    const childHeights: number[] = [];
    for (const processId of newProcessIds) {
      const process = metaModel.entities.business_processes.find(p => p.id === processId);
      const processName = process?.name || 'Process';
      const height = calculateProcessNodeHeight(processName, DEFAULT_CHILD_WIDTH, 12);
      childHeights.push(height);
    }

    // Step 4: Create child nodes with dynamic heights
    const tempParentForPositioning = parentNode || nodesToAdd[0];
    const baseZIndex = calculateZIndex([...diagram.diagram_nodes, ...nodesToAdd]);

    newProcessIds.forEach((processId, index) => {
      // Task Group 4.7: Use calculateChildPositionWithHeights for dynamic positioning
      const childPos = calculateChildPositionWithHeights(
        tempParentForPositioning,
        index,
        currentChildCount,
        childHeights,
        labelHeight
      );

      const childNode: DiagramNode = {
        id: generatePrefixedId('node'),
        entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
        entity_id: processId,
        pos_x: childPos.pos_x,
        pos_y: childPos.pos_y,
        width: DEFAULT_CHILD_WIDTH,
        height: childHeights[index], // Dynamic height based on text
        auto_size: false,
        z_index: baseZIndex + index + 1,
        parent_node_id: parentNodeId,
        style_override: {},
      };

      nodesToAdd.push(childNode);
    });

    // Task Group 4.5: Calculate dynamic Application parent height
    // Combine existing child heights (using default) + new child heights
    const allChildHeights = [
      ...Array(currentChildCount).fill(60), // Existing children use default height
      ...childHeights, // New children use calculated heights
    ];

    const newSize = calculateParentSizeWithHeights(allChildHeights, DEFAULT_CHILD_WIDTH, labelHeight);

    // Fixed Spawn Position: Use fixed position (100, 100) for new parent nodes
    if (isNewParent) {
      // Use fixed spawn position for new parent nodes
      const pos_x = DEFAULT_NODE_SPAWN_ORIGIN.x;
      const pos_y = DEFAULT_NODE_SPAWN_ORIGIN.y;

      // Update parent node position
      if (nodesToAdd.length > 0 && nodesToAdd[0].id === parentNodeId) {
        nodesToAdd[0] = {
          ...nodesToAdd[0],
          pos_x,
          pos_y,
          width: newSize.width,
          height: newSize.height,
        };

        // Recalculate child positions based on new parent position
        for (let i = 1; i < nodesToAdd.length; i++) {
          const childIndex = i - 1;
          const childPos = calculateChildPositionWithHeights(
            nodesToAdd[0],
            childIndex,
            currentChildCount,
            childHeights,
            labelHeight
          );
          nodesToAdd[i] = {
            ...nodesToAdd[i],
            pos_x: childPos.pos_x,
            pos_y: childPos.pos_y,
          };
        }
      }
    }

    // Step 5: Add all nodes
    if (nodesToAdd.length > 0) {
      onAddNodes(nodesToAdd);
    }

    // Step 6: Calculate and apply parent sizing for EXISTING parents
    // (NEW parents already have size set in nodesToAdd)
    if (!isNewParent) {
      onUpdateNode(parentNodeId, {
        width: newSize.width,
        height: newSize.height,
      });
    }
  }, [currentDiagramId, diagram, metaModel, onAddNodes, onUpdateNode, getViewportCenter]);

  // Context menu: Add with app components
  // Task Group 4: Updated to use shared getViewportCenter helper
  // Note: _sectionId is unused because this action is only available for APPLICATION items
  const handleAddWithAppComponents = useCallback((item: PaletteItemData, _sectionId: string) => {
    // Task Group 4: Show warning modal if no active diagram or meta-model
    if (!currentDiagramId || !diagram || !metaModel) {
      setShowNoDiagramWarning(true);
      return;
    }

    const applicationId = item.id;
    const entity_type = ENTITY_TYPES.APPLICATION;

    // Step 1: Find or create parent Application node
    let parentNode = diagram.diagram_nodes.find(
      n => n.entity_type === entity_type && n.entity_id === applicationId
    );

    const nodesToAdd: DiagramNode[] = [];
    let parentNodeId: string;
    const isNewParent = !parentNode;

    // Look up Application name for label height calculation
    const application = metaModel.entities.applications.find(a => a.id === applicationId);
    const appName = application?.name || 'Application';

    // Calculate parent width (fixed)
    const parentWidth = DEFAULT_CHILD_WIDTH + 10; // 130px

    // Calculate Application label height dynamically
    const labelHeight = calculateApplicationLabelHeight(appName, parentWidth, 12, 'bold');

    if (!parentNode) {
      // Create new parent node with styling
      parentNode = createDiagramNodeFromEntity(
        entity_type,
        applicationId,
        diagram.diagram_nodes
      );

      // Apply styling (consistent with business processes handler)
      parentNode = {
        ...parentNode,
        text_v_align: 'TOP',
        text_font_weight: 'bold',
      };

      nodesToAdd.push(parentNode);
      parentNodeId = parentNode.id;
    } else {
      parentNodeId = parentNode.id;

      // Apply styling for existing nodes
      onUpdateNode(parentNodeId, {
        text_v_align: 'TOP',
        text_font_weight: 'bold',
      });
    }

    // Step 2: Find app components
    const appComponents = findAppComponents(metaModel, applicationId);

    if (appComponents.length === 0) {
      // No app components - just add the parent if it's new
      if (nodesToAdd.length > 0) {
        onAddNodes(nodesToAdd);
      }
      return;
    }

    // Step 3: Filter out components that already exist on diagram
    const existingComponentNodes = diagram.diagram_nodes.filter(
      n => n.entity_type === ENTITY_TYPES.APP_COMPONENT &&
           appComponents.some(ac => ac.id === n.entity_id)
    );
    const existingComponentIds = new Set(existingComponentNodes.map(n => n.entity_id));

    const newComponents = appComponents.filter(ac => !existingComponentIds.has(ac.id));

    // Count existing children of parent for positioning
    const currentChildCount = countExistingChildren(
      parentNodeId,
      [...diagram.diagram_nodes, ...nodesToAdd]
    );

    // Calculate dynamic heights for app components
    const childHeights: number[] = [];
    for (const component of newComponents) {
      const height = calculateProcessNodeHeight(component.name, DEFAULT_CHILD_WIDTH, 12);
      childHeights.push(height);
    }

    // Step 4: Create child nodes
    const tempParentForPositioning = parentNode || nodesToAdd[0];
    const baseZIndex = calculateZIndex([...diagram.diagram_nodes, ...nodesToAdd]);

    newComponents.forEach((component, index) => {
      const childPos = calculateChildPositionWithHeights(
        tempParentForPositioning,
        index,
        currentChildCount,
        childHeights,
        labelHeight
      );

      const childNode: DiagramNode = {
        id: generatePrefixedId('node'),
        entity_type: ENTITY_TYPES.APP_COMPONENT,
        entity_id: component.id,
        pos_x: childPos.pos_x,
        pos_y: childPos.pos_y,
        width: DEFAULT_CHILD_WIDTH,
        height: childHeights[index],
        auto_size: false,
        z_index: baseZIndex + index + 1,
        parent_node_id: parentNodeId,
        style_override: {},
      };

      nodesToAdd.push(childNode);
    });

    // Calculate parent size with dynamic heights
    const allChildHeights = [
      ...Array(currentChildCount).fill(60),
      ...childHeights,
    ];

    const newSize = calculateParentSizeWithHeights(allChildHeights, DEFAULT_CHILD_WIDTH, labelHeight);

    // Task Group 4: Use shared getViewportCenter helper for viewport-centered placement
    if (isNewParent) {
      // Use fixed spawn position (100, 100) for new parent nodes
      const pos_x = DEFAULT_NODE_SPAWN_ORIGIN.x;
      const pos_y = DEFAULT_NODE_SPAWN_ORIGIN.y;

      if (nodesToAdd.length > 0 && nodesToAdd[0].id === parentNodeId) {
        nodesToAdd[0] = {
          ...nodesToAdd[0],
          pos_x,
          pos_y,
          width: newSize.width,
          height: newSize.height,
        };

        // Recalculate child positions
        for (let i = 1; i < nodesToAdd.length; i++) {
          const childIndex = i - 1;
          const childPos = calculateChildPositionWithHeights(
            nodesToAdd[0],
            childIndex,
            currentChildCount,
            childHeights,
            labelHeight
          );
          nodesToAdd[i] = {
            ...nodesToAdd[i],
            pos_x: childPos.pos_x,
            pos_y: childPos.pos_y,
          };
        }
      }
    }

    // Step 5: Add all nodes
    if (nodesToAdd.length > 0) {
      onAddNodes(nodesToAdd);
    }

    // Step 6: Calculate and apply parent sizing for EXISTING parents
    if (!isNewParent) {
      onUpdateNode(parentNodeId, {
        width: newSize.width,
        height: newSize.height,
      });
    }
  }, [currentDiagramId, diagram, metaModel, onAddNodes, onUpdateNode, getViewportCenter]);

  // Context menu: Add with process activities
  // Similar to handleAddWithAppComponents but for BUSINESS_PROCESS -> PROCESS_ACTIVITY
  const handleAddWithProcessActivities = useCallback((item: PaletteItemData, _sectionId: string) => {
    if (!currentDiagramId || !diagram || !metaModel) {
      setShowNoDiagramWarning(true);
      return;
    }

    const businessProcessId = item.id;
    const entity_type = ENTITY_TYPES.BUSINESS_PROCESS;

    // Step 1: Find or create parent Business Process node
    let parentNode = diagram.diagram_nodes.find(
      n => n.entity_type === entity_type && n.entity_id === businessProcessId
    );

    const nodesToAdd: DiagramNode[] = [];
    let parentNodeId: string;
    const isNewParent = !parentNode;

    // Look up Business Process name for label height calculation
    const businessProcess = metaModel.entities.business_processes.find(p => p.id === businessProcessId);
    const processName = businessProcess?.name || 'Process';

    // Calculate parent width (fixed)
    const parentWidth = DEFAULT_CHILD_WIDTH + 10; // 130px

    // Calculate Process label height dynamically
    const labelHeight = calculateApplicationLabelHeight(processName, parentWidth, 12, 'bold');

    if (!parentNode) {
      // Create new parent node with styling
      parentNode = createDiagramNodeFromEntity(
        entity_type,
        businessProcessId,
        diagram.diagram_nodes
      );

      // Apply styling
      parentNode = {
        ...parentNode,
        text_v_align: 'TOP',
        text_font_weight: 'bold',
      };

      nodesToAdd.push(parentNode);
      parentNodeId = parentNode.id;
    } else {
      parentNodeId = parentNode.id;

      // Apply styling for existing nodes
      onUpdateNode(parentNodeId, {
        text_v_align: 'TOP',
        text_font_weight: 'bold',
      });
    }

    // Step 2: Find process activities
    const processActivities = findProcessActivities(metaModel, businessProcessId);

    if (processActivities.length === 0) {
      // No activities - just add the parent if it's new
      if (nodesToAdd.length > 0) {
        onAddNodes(nodesToAdd);
      }
      return;
    }

    // Step 3: Filter out activities that already exist on diagram
    const existingActivityNodes = diagram.diagram_nodes.filter(
      n => n.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY &&
           processActivities.some(a => a.id === n.entity_id)
    );
    const existingActivityIds = new Set(existingActivityNodes.map(n => n.entity_id));

    const newActivities = processActivities.filter(a => !existingActivityIds.has(a.id));

    // Count existing children of parent for positioning
    const currentChildCount = countExistingChildren(
      parentNodeId,
      [...diagram.diagram_nodes, ...nodesToAdd]
    );

    // Calculate dynamic heights for activities
    const childHeights: number[] = [];
    for (const activity of newActivities) {
      const height = calculateProcessNodeHeight(activity.name, DEFAULT_CHILD_WIDTH, 12);
      childHeights.push(height);
    }

    // Step 4: Create child nodes
    const tempParentForPositioning = parentNode || nodesToAdd[0];
    const baseZIndex = calculateZIndex([...diagram.diagram_nodes, ...nodesToAdd]);

    newActivities.forEach((activity, index) => {
      const childPos = calculateChildPositionWithHeights(
        tempParentForPositioning,
        index,
        currentChildCount,
        childHeights,
        labelHeight
      );

      const childNode: DiagramNode = {
        id: generatePrefixedId('node'),
        entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
        entity_id: activity.id,
        pos_x: childPos.pos_x,
        pos_y: childPos.pos_y,
        width: DEFAULT_CHILD_WIDTH,
        height: childHeights[index],
        auto_size: false,
        z_index: baseZIndex + index + 1,
        parent_node_id: parentNodeId,
        style_override: {},
      };

      nodesToAdd.push(childNode);
    });

    // Calculate parent size with dynamic heights
    const allChildHeights = [
      ...Array(currentChildCount).fill(60),
      ...childHeights,
    ];

    const newSize = calculateParentSizeWithHeights(allChildHeights, DEFAULT_CHILD_WIDTH, labelHeight);

    // Center placement for new parent
    if (isNewParent) {
      // Use fixed spawn position (100, 100) for new parent nodes
      const pos_x = DEFAULT_NODE_SPAWN_ORIGIN.x;
      const pos_y = DEFAULT_NODE_SPAWN_ORIGIN.y;

      if (nodesToAdd.length > 0 && nodesToAdd[0].id === parentNodeId) {
        nodesToAdd[0] = {
          ...nodesToAdd[0],
          pos_x,
          pos_y,
          width: newSize.width,
          height: newSize.height,
        };

        // Recalculate child positions
        for (let i = 1; i < nodesToAdd.length; i++) {
          const childIndex = i - 1;
          const childPos = calculateChildPositionWithHeights(
            nodesToAdd[0],
            childIndex,
            currentChildCount,
            childHeights,
            labelHeight
          );
          nodesToAdd[i] = {
            ...nodesToAdd[i],
            pos_x: childPos.pos_x,
            pos_y: childPos.pos_y,
          };
        }
      }
    }

    // Step 5: Add all nodes
    if (nodesToAdd.length > 0) {
      onAddNodes(nodesToAdd);
    }

    // Step 6: Update parent sizing for existing parents
    if (!isNewParent) {
      onUpdateNode(parentNodeId, {
        width: newSize.width,
        height: newSize.height,
      });
    }
  }, [currentDiagramId, diagram, metaModel, onAddNodes, onUpdateNode, getViewportCenter]);

  // Context menu: Advanced Add - opens the AdvancedAddDialog
  const handleAdvancedAdd = useCallback((item: PaletteItemData, sectionId: string) => {
    // Check for active diagram
    if (!currentDiagramId || !diagram || !metaModel) {
      setShowNoDiagramWarning(true);
      return;
    }

    const entityType = getEntityTypeConstant(sectionId);

    // Open the Advanced Add dialog
    setAdvancedAddDialogState({
      isOpen: true,
      entity: {
        id: item.id,
        name: item.name,
        type: entityType,
      },
      isLoading: false,
      error: null,
    });
  }, [currentDiagramId, diagram, metaModel]);

  // Handle Advanced Add dialog close
  const handleAdvancedAddClose = useCallback(() => {
    setAdvancedAddDialogState({
      isOpen: false,
      entity: null,
      isLoading: false,
      error: null,
    });
  }, []);

  // Handle Advanced Add confirmation - process selections and add nodes using recursive wrapping
  // Task Group 4: Updated to extract and pass spacingPreset and layoutConfig to buildWrappedNodeHierarchy
  const handleAdvancedAddConfirm = useCallback((result: AdvancedAddResult) => {
    if (!currentDiagramId || !diagram || !metaModel || !advancedAddDialogState.entity) {
      return;
    }

    const { treeData, selectedKeys, spacingPreset, childColumns, childNodeWidth } = result;
    const center = getCurrentViewportCenter();

    // Get ordered list of nodes from leaves to root (deepest first for proper z-index)
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    if (orderedNodes.length === 0) {
      handleAdvancedAddClose();
      return;
    }

    // Task Group 4: Extract spacingPreset from result and pass to buildWrappedNodeHierarchy
    // Use DEFAULT_SPACING_PRESET as fallback if not specified
    const effectiveSpacingPreset = spacingPreset || DEFAULT_SPACING_PRESET;

    // Task Group 4: Build layoutConfig from result if childColumns or childNodeWidth are specified
    let layoutConfig: LayoutConfig | undefined = undefined;
    if (childColumns !== undefined || childNodeWidth !== undefined) {
      const spacingConfig = SPACING_PRESETS[effectiveSpacingPreset];
      layoutConfig = {
        ...spacingConfig,
        childColumns: childColumns ?? DEFAULT_LAYOUT_CONFIG.childColumns,
        childNodeWidth: childNodeWidth ?? DEFAULT_LAYOUT_CONFIG.childNodeWidth,
      };
    }

    // Use buildWrappedNodeHierarchy to create properly nested nodes with spacing preset and layout config
    const wrappedResult = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      center,
      effectiveSpacingPreset,
      layoutConfig
    );

    // Add new nodes to the diagram
    if (wrappedResult.nodesToAdd.length > 0) {
      onAddNodes(wrappedResult.nodesToAdd);
    }

    // Update existing nodes (resize, restyle for containment)
    for (const update of wrappedResult.nodesToUpdate) {
      onUpdateNode(update.nodeId, update.updates);
    }

    // Close the dialog
    handleAdvancedAddClose();
  }, [currentDiagramId, diagram, metaModel, advancedAddDialogState.entity, onAddNodes, onUpdateNode, getViewportCenter, handleAdvancedAddClose]);

  // ============================================================================
  // Task Group 3: "Add with attributes" handler for ERD-style rendering
  // ============================================================================

  /**
   * Context menu: Add with attributes - creates an ERD-style node
   * This adds a Logical/Physical Data Entity with its attributes embedded
   * as rows within the node (ERD/UML class-box style).
   */
  const handleAddWithAttributes = useCallback((item: PaletteItemData, sectionId: string) => {
    // Check for active diagram
    if (!currentDiagramId || !diagram || !metaModel) {
      setShowNoDiagramWarning(true);
      return;
    }

    // Determine entity type from section
    const entityType = getEntityTypeConstant(sectionId);
    const entityId = item.id;

    // Check for duplicate
    if (nodeExistsForEntity(diagram.diagram_nodes, entityType, entityId)) {
      console.log('Node already exists for this entity');
      return;
    }

    // Get attributes for this entity
    const attributes = getAttributesForEntity(metaModel, entityId, entityType);

    // Calculate ERD node size based on entity name and attributes
    const { width, height } = calculateERDNodeSize(item.name, attributes);

    // Use fixed spawn position (100, 100)
    // Calculate base z-index
    const baseZIndex = calculateZIndex(diagram.diagram_nodes);

    // Create ERD-style node at fixed spawn position
    const erdNode: DiagramNode = {
      id: generatePrefixedId('node'),
      entity_type: entityType,
      entity_id: entityId,
      pos_x: DEFAULT_NODE_SPAWN_ORIGIN.x,
      pos_y: DEFAULT_NODE_SPAWN_ORIGIN.y,
      width,
      height,
      auto_size: false,
      z_index: baseZIndex,
      parent_node_id: null,
      style_override: {},
      // ERD-specific fields
      render_style: 'erd',
      embedded_attribute_ids: attributes.map(a => a.id),
    };

    // Add the node
    onAddNode(erdNode);
  }, [currentDiagramId, diagram, metaModel, onAddNode, getViewportCenter]);

  // ============================================================================
  // "Add with all children" handler for Interface custom rendering
  // Task Group 2 (Interface Parity): Refactored to use shared buildInterfaceCompositeNodes helper
  // ============================================================================

  /**
   * Context menu: Add with all children - creates an Interface with embedded endpoints
   * and child logical entity nodes (ERD-style) positioned INSIDE the Interface.
   *
   * This adds an Interface node with:
   * - embedded_endpoint_ids: All endpoints belonging to this interface
   * - embedded_entity_ids: IDs of logical entities for custom rendering
   * - Child ERD-style nodes for each logical entity with parent_node_id set to Interface
   *
   * Task Group 2 (Interface Parity): Refactored to use shared buildInterfaceCompositeNodes helper
   */
  const handleAddWithAllChildren = useCallback((item: PaletteItemData, _sectionId: string) => {
    // Check for active diagram
    if (!currentDiagramId || !diagram || !metaModel) {
      setShowNoDiagramWarning(true);
      return;
    }

    const interfaceId = item.id;
    const entityType = ENTITY_TYPES.INTERFACE;

    // Check for duplicate
    if (nodeExistsForEntity(diagram.diagram_nodes, entityType, interfaceId)) {
      console.log('Interface node already exists on diagram');
      return;
    }

    // Get all endpoints for this interface
    const endpoints = metaModel.entities.endpoints.filter(
      ep => ep.interface_id === interfaceId
    );
    const allEndpointIds = endpoints.map(ep => ep.id);

    // Get all logical entity IDs via the helper
    const allLogicalEntityIds = getLogicalEntityIdsForInterface(interfaceId, metaModel);

    // Filter out logical entities that already exist on diagram
    const newLogicalEntityIds = allLogicalEntityIds.filter(
      id => !nodeExistsForEntity(diagram.diagram_nodes, ENTITY_TYPES.LOGICAL_DATA_ENTITY, id)
    );

    // Use fixed spawn position (100, 100)
    // Calculate base z-index
    const baseZIndex = calculateZIndex(diagram.diagram_nodes);

    // Use the shared helper to build the Interface composite
    const { interfaceNode, entityNodes } = buildInterfaceCompositeNodes(
      interfaceId,
      allEndpointIds,
      newLogicalEntityIds,
      new Map(), // Empty map means all attributes selected
      metaModel,
      DEFAULT_NODE_SPAWN_ORIGIN, // Fixed spawn position
      baseZIndex,
      null // No parent node
    );

    // Add all nodes
    onAddNodes([interfaceNode, ...entityNodes]);
  }, [currentDiagramId, diagram, metaModel, onAddNodes, getViewportCenter]);

  // Task Group 4: Check if section should be expanded (default to collapsed/false if not set)
  const isSectionExpanded = (sectionId: string): boolean => {
    return sectionExpandStates[sectionId] === true;
  };

  // Check if current context menu item is on the diagram
  const isItemOnDiagram = contextMenuState
    ? nodeExistsForEntity(
        diagram?.diagram_nodes || [],
        getEntityTypeConstant(contextMenuState.sectionId),
        contextMenuState.item.id
      )
    : false;

  // Check if context menu section is a relationship section
  const getContextMenuItemType = (): 'entity' | 'relationship' => {
    if (!contextMenuState) return 'entity';
    const section = sections.find(s => s.id === contextMenuState.sectionId);
    return section?.type || 'entity';
  };

  // Check if context menu relationship is enabled
  // Task Group 3: Added special handling for 'interactions' section
  const getContextMenuRelationshipEnabled = (): boolean => {
    if (!contextMenuState || !metaModel || !diagram) return false;
    const section = sections.find(s => s.id === contextMenuState.sectionId);
    if (section?.type !== 'relationship') return false;

    // Task Group 3: Special handling for User Interactions
    if (contextMenuState.sectionId === 'interactions') {
      const interaction = metaModel.entities.interactions?.find(i => i.id === contextMenuState.item.id);
      if (!interaction) return false;

      // Create a proper Diagram object for the helper function
      const fullDiagramForCheck: Diagram = {
        id: currentDiagramId || '',
        name: 'Current Diagram',
        description: '',
        diagram_nodes: diagram.diagram_nodes,
        diagram_edges: diagram.diagram_edges || [],
      };

      // For interactions, we need to check if edges exist
      // If MAIN edges exist, the row is still "enabled" but action should be 'delete'
      // Note: We only check for MAIN edges, not USER_LINK edges
      const existingEdges = (diagram.diagram_edges || []).filter(
        edge =>
          edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
          edge.relationship_id === contextMenuState.item.id &&
          edge.subType === 'MAIN'
      );

      // If edges exist, return true (enabled for delete action)
      if (existingEdges.length > 0) {
        return true;
      }

      // Otherwise check if it can be added
      return isUserInteractionRowEnabled(interaction, fullDiagramForCheck, metaModel);
    }

    // Task Group 3 (ER Diagram UX Enhancements): Special handling for LogicalER
    if (contextMenuState.sectionId === 'logical_data_entity_relationships') {
      // Check if edge already exists on diagram
      const isOnDiagram = isLogicalEREdgeOnDiagram(contextMenuState.item.id, diagram.diagram_edges);
      if (isOnDiagram) {
        // Edge exists - return true (enabled for delete action)
        return true;
      }
      // Edge doesn't exist - check standard relationship eligibility for add action
      const relationships = getRelationshipsForSection(contextMenuState.sectionId);
      const relationship = relationships.find(r => r.id === contextMenuState.item.id);
      if (!relationship) return false;
      return isRelationshipRowEnabled(relationship, contextMenuState.sectionId, diagram.diagram_nodes, metaModel);
    }

    const relationships = getRelationshipsForSection(contextMenuState.sectionId);
    const relationship = relationships.find(r => r.id === contextMenuState.item.id);
    if (!relationship) return false;

    return isRelationshipRowEnabled(relationship, contextMenuState.sectionId, diagram.diagram_nodes, metaModel);
  };

  // Standardise User Interaction Palette UI: Compute action for context menu relationship items
  // Note: "on diagram" is determined by presence of MAIN edge (not USER_LINK)
  // Task Group 3 (ER Diagram UX Enhancements): Also handles LogicalER action
  const getContextMenuRelationshipAction = (): 'add' | 'delete' => {
    if (!contextMenuState || !diagram) return 'add';

    // Handle interactions section
    if (contextMenuState.sectionId === 'interactions') {
      const existingMainEdges = (diagram.diagram_edges || []).filter(
        edge =>
          edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
          edge.relationship_id === contextMenuState.item.id &&
          edge.subType === 'MAIN'
      );
      return existingMainEdges.length > 0 ? 'delete' : 'add';
    }

    // Task Group 3 (ER Diagram UX Enhancements): Handle LogicalER section
    if (contextMenuState.sectionId === 'logical_data_entity_relationships') {
      const isOnDiagram = isLogicalEREdgeOnDiagram(contextMenuState.item.id, diagram.diagram_edges);
      return isOnDiagram ? 'delete' : 'add';
    }

    return 'add';
  };

  // Task Group 7: Check if palette is empty due to diagram type filtering
  // We check if sections array is empty AND we have a non-General diagram type
  const isPaletteEmptyDueToDiagramType = (): boolean => {
    if (!metaModel) return false;
    if (sections.length > 0) return false;
    // Only show diagram type empty state if we have a specific diagram type
    return diagramType !== 'General';
  };

  // ============================================================================
  // Task Group 2: Render Create Section buttons based on diagram type
  // ============================================================================

  /**
   * Get create section buttons based on current diagram type
   */
  const getCreateSectionButtons = (): Array<{ label: string; entityType: string; title: string }> => {
    switch (diagramType) {
      case 'ER':
        return [
          { label: '+ New Logical Entity', entityType: ENTITY_TYPES.LOGICAL_DATA_ENTITY, title: 'Create Logical Data Entity' },
          { label: '+ New Physical Entity', entityType: ENTITY_TYPES.PHYSICAL_DATA_ENTITY, title: 'Create Physical Data Entity' },
          { label: '+ New Logical ER', entityType: 'LOGICAL_DATA_ENTITY_RELATIONSHIP', title: 'Create Logical ER' },
        ];
      case 'State':
        return [
          { label: '+ New State', entityType: ENTITY_TYPES.STATE, title: 'Create State' },
          { label: '+ New State Transition', entityType: 'STATE_TRANSITION', title: 'Create State Transition' },
        ];
      case 'Activity':
        return [
          { label: '+ New Partition', entityType: ENTITY_TYPES.ACTIVITY_PARTITION, title: 'Create Activity Partition' },
          { label: '+ New Activity', entityType: ENTITY_TYPES.ACTIVITY, title: 'Create Activity' },
          { label: '+ New Activity Flow', entityType: 'ACTIVITY_FLOW', title: 'Create Activity Flow' },
        ];
      // Spec 2026-01-02 Task Group 8: UI Workflow diagram buttons
      case 'UI_Workflow':
        return [
          { label: '+ New UI Screen', entityType: ENTITY_TYPES.UI_SCREEN, title: 'Create UI Screen' },
          { label: '+ New Workflow Transition', entityType: 'UI_WORKFLOW_TRANSITION', title: 'Create Workflow Transition' },
        ];
      default:
        return [];
    }
  };

  const createSectionButtons = getCreateSectionButtons();
  const showCreateSection = createSectionButtons.length > 0;

  // Spec 2026-05-05 Task Group 3.2: Infrastructure V2 has no palette / authoring posture is view-mostly.
  // Belt-and-braces -- DiagramsView.tsx already short-circuits this panel for V2, but if a future
  // refactor changes that, this guarantees PalettePanel renders nothing. Spec 5 palette wiring
  // (DOMAIN_ENTITY_SECTIONS.infrastructure, DIAGRAM_TYPE_PALETTE_RULES.Infrastructure, etc.) is
  // not modified -- still used by the General DiagramType authoring playground.
  // Placed after all hooks to comply with React rules of hooks.
  if (diagramType === 'Infrastructure') {
    return null;
  }

  if (isCollapsed) {
    return (
      <div className={styles.panelCollapsed}>
        <button
          className={styles.toggleButton}
          onClick={onToggleCollapse}
          title="Expand palette panel"
        >
          &lt;&lt;
        </button>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <button
          className={styles.toggleButton}
          onClick={onToggleCollapse}
          title="Collapse palette panel"
        >
          &gt;&gt;
        </button>
        <h3 className={styles.title}>Palette</h3>
      </div>

      <div className={styles.searchContainer}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {/* Task Group 5: Domain selector for palette filtering */}
      <PaletteDomainSelector />

      {/* Task Group 2: Create Section for ER, State, Activity diagram types */}
      {/* Task Group 5: Updated to handle State Transition creation mode */}
      {showCreateSection && (
        <div className={styles.createSection}>
          <h4 className={styles.createSectionTitle}>Create</h4>
          <div className={styles.createButtonsContainer}>
            {createSectionButtons.map((button) => {
              // Task Group 5: Special handling for State Transition button
              // Task Group 3 (Activity Flow): Added handling for Activity Flow button
              const isTransitionButton = button.entityType === 'STATE_TRANSITION';
              const isActivityFlowButton = button.entityType === 'ACTIVITY_FLOW';
              const isWorkflowTransitionButton = button.entityType === 'UI_WORKFLOW_TRANSITION';
              const isTransitionActive = isTransitionButton && transitionCreationMode.active;
              const isActivityFlowActive = isActivityFlowButton && activityFlowCreationMode.active;
              const isWorkflowTransitionActive = isWorkflowTransitionButton && (workflowTransitionMode.step === 'selecting-source' || workflowTransitionMode.step === 'selecting-target');
              const isActive = isTransitionActive || isActivityFlowActive || isWorkflowTransitionActive;
              const buttonClass = isActive ? styles.createButtonActive : styles.createButton;

              // Determine display text based on active mode
              let displayText = button.label.replace('+ ', '');
              if (isTransitionActive) {
                displayText = 'Cancel Transition';
              } else if (isActivityFlowActive) {
                displayText = 'Cancel Flow';
              } else if (isWorkflowTransitionActive) {
                displayText = 'Cancel Transition';
              }

              return (
                <button
                  key={button.entityType}
                  className={buttonClass}
                  onClick={() => handleCreateButtonClick(button.entityType, button.title)}
                  disabled={!hasActiveSelectedDiagram()}
                  data-testid={`create-button-${button.entityType}`}
                >
                  <span className={styles.createButtonIcon}>{isActive ? 'x' : '+'}</span>
                  <span className={styles.createButtonText}>
                    {displayText}
                  </span>
                </button>
              );
            })}
            {/* Task Group 5: Show hint text when in transition creation mode */}
            {transitionCreationMode.active && (
              <div className={styles.transitionModeHint}>
                {getTransitionModeHintText(transitionCreationMode)}
              </div>
            )}
            {/* Task Group 3 (Activity Flow): Show hint text when in activity flow creation mode */}
            {activityFlowCreationMode.active && (
              <div className={styles.transitionModeHint}>
                {getActivityFlowModeHintText(activityFlowCreationMode)}
              </div>
            )}
            {/* Spec 2026-01-02 Task Group 8: Show hint text when in workflow transition creation mode */}
            {(workflowTransitionMode.step === 'selecting-source' || workflowTransitionMode.step === 'selecting-target') && (
              <div className={styles.transitionModeHint}>
                {getWorkflowTransitionStatusMessage(workflowTransitionMode.step)}
              </div>
            )}
          </div>
        </div>
      )}

      <div className={styles.sectionsContainer}>
        {!metaModel && (
          <div className={styles.emptyState}>No meta-model loaded</div>
        )}

        {/* Task Group 7: Show diagram type empty state message */}
        {metaModel && isPaletteEmptyDueToDiagramType() && (
          <div className={styles.diagramTypeEmptyState}>
            {DIAGRAM_TYPE_EMPTY_STATE_MESSAGE}
          </div>
        )}

        {/* Show regular empty state only if not due to diagram type */}
        {metaModel && sections.length === 0 && !isPaletteEmptyDueToDiagramType() && (
          <div className={styles.emptyState}>No items found</div>
        )}

        {metaModel && sections.map((section) => (
          <PaletteSection
            key={section.id}
            sectionId={section.id}
            label={section.label}
            items={section.items}
            isExpanded={isSectionExpanded(section.id)}
            onToggle={() => onToggleSection(section.id)}
            onItemClick={(item) => handleItemClick(item, section.id, section.type)}
            onItemContextMenu={(e, item) => handleItemContextMenu(e, item, section.id)}
            itemType={section.type}
            diagram={diagram}
            metaModel={metaModel}
            relationships={getRelationshipsForSection(section.id)}
          />
        ))}

        {/* Task Group 3: Selection Inspector for editing selected entities */}
        {/* Task Group 3 & 5: Selection Inspector for nodes and edges */}
        {metaModel && onUpdateEntity && (
          ((selectedNodeIds && selectedNodeIds.size === 1 && nodes) || (selectedEdgeIds && selectedEdgeIds.size === 1 && edges)) && (
            <SelectionInspector
              selectedNode={selectedNodeIds && selectedNodeIds.size === 1 && nodes ? (nodes.find(n => selectedNodeIds.has(n.id)) || null) : null}
              selectedEdge={selectedEdgeIds && selectedEdgeIds.size === 1 && edges ? (edges.find(e => selectedEdgeIds.has(e.id)) || null) : null}
              metaModel={metaModel}
              onUpdateEntity={onUpdateEntity}
            />
          )
        )}
      </div>

      {/* Context Menu */}
      {contextMenuState && (
        <PaletteContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          item={contextMenuState.item}
          sectionId={contextMenuState.sectionId}
          isOnDiagram={isItemOnDiagram}
          itemType={getContextMenuItemType()}
          isRelationshipEnabled={getContextMenuRelationshipEnabled()}
          action={getContextMenuRelationshipAction()}
          onAdd={handleContextMenuAdd}
          onAddRelationship={handleContextMenuAddRelationship}
          onDeleteRelationship={handleContextMenuDeleteRelationship}
          onDelete={handleContextMenuDelete}
          onAddWithBusinessProcesses={handleAddWithBusinessProcesses}
          onAddWithAppComponents={handleAddWithAppComponents}
          onAddWithProcessActivities={handleAddWithProcessActivities}
          onAdvancedAdd={handleAdvancedAdd}
          onAddWithAttributes={handleAddWithAttributes}
          onAddWithAllChildren={handleAddWithAllChildren}
          onClose={handleCloseMenu}
        />
      )}

      {/* Advanced Add Dialog */}
      {advancedAddDialogState.isOpen && advancedAddDialogState.entity && metaModel && (
        <AdvancedAddDialog
          isOpen={advancedAddDialogState.isOpen}
          onClose={handleAdvancedAddClose}
          onAdd={handleAdvancedAddConfirm}
          rootEntity={advancedAddDialogState.entity}
          metaModel={metaModel}
          isLoading={advancedAddDialogState.isLoading}
          error={advancedAddDialogState.error}
        />
      )}

      {/* Task Group 2: CreateAndPlaceDrawer for entity creation */}
      {createDrawerState.isOpen && createDrawerState.entityType && (
        <CreateAndPlaceDrawer
          isOpen={createDrawerState.isOpen}
          onClose={handleCloseCreateDrawer}
          title={createDrawerState.title}
          entityType={createDrawerState.entityType}
          onSubmit={handleCreateAndPlace}
          metaModel={metaModel}
        />
      )}

      {/* Task Group 3 & 4: Warning modal for no active diagram
          Single modal handles both left-click and context menu scenarios (DRY principle) */}
      <Modal
        isOpen={showNoDiagramWarning}
        onClose={handleCloseNoDiagramWarning}
        title="Warning"
      >
        <p>{NO_DIAGRAM_WARNING_MESSAGE}</p>
      </Modal>
    </div>
  );
}

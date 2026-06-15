/**
 * Relationship Utilities
 * Utilities for relationship visualisation and RHS palette enable/disable logic
 */

import {
  DiagramNode,
  DiagramEdge,
  EdgePoint,
  MetaModel,
  Diagram,
  AnyRelationship,
  BusinessUserBusinessPoint,
  ApplicationPointBusinessPoint,
  LogicalDataEntityRelationship,
  LogicalDataEntityPhysicalDataEntity,
  LogicalDataAttributePhysicalDataAttribute,
  DataMovement,
  ENTITY_TYPES,
  RELATIONSHIP_EDGE_TYPES,
  LogicalEREndpointKind,
  ResourceSubnetHosting,
  DeploymentUnitComputeResource,
  LoadBalancerResourceRoute,
  InfrastructurePointKind,
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain relationship types
  ApplicationComputeDeployment,
  DataEntityDataStoreHosting,
  ApplicationInfrastructureResourceUse,
  ApplicationLoadBalancerExposure,
} from '../types/model';
import { generatePrefixedId } from './idGenerator';
import { generateBusinessPointId } from './businessPointSync';
import { parseDataEntityPointId } from './dataEntityPointOptions';

// ============================================================================
// Task Group 1: Multiplicity Label Utilities
// ============================================================================

/**
 * Get multiplicity labels based on cardinality type
 * Used for Logical ER relationships to display "1" or "m" near endpoints
 *
 * @param relationshipType - Cardinality type (ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY)
 * @returns Object with source and target label strings
 */
export function getMultiplicityLabels(relationshipType: string): { source: string; target: string } {
  switch (relationshipType) {
    case 'ONE_TO_ONE':
      return { source: '1', target: '1' };
    case 'ONE_TO_MANY':
      return { source: '1', target: 'm' };
    case 'MANY_TO_ONE':
      return { source: 'm', target: '1' };
    case 'MANY_TO_MANY':
      return { source: 'm', target: 'm' };
    default:
      // Default to one-to-one if unknown
      return { source: '1', target: '1' };
  }
}

// ============================================================================
// Per-Diagram Eligibility Helper (Spec: Relationship Eligibility Per-Diagram Fix)
// ============================================================================

/**
 * Spec 2026-05-05: Infrastructure Domain Diagram Support
 *
 * Maps each Infrastructure SCREAMING_SNAKE_CASE entity-type constant (matching
 * InfrastructurePointKind discriminator values) to the typed FK column on
 * `infrastructure_points` that pins that polymorphic row to a concrete entity.
 *
 * Used by getEntitiesOnDiagram to populate `infrastructurePointsOnDiagram`:
 * for each on-canvas concrete-entity node, look up the matching
 * `infrastructure_points` row via the typed FK column matching the node's
 * entity_id, and add the row's id to the Set. Mirrors the BUSINESS_POINT /
 * APPLICATION_POINT polymorphic-resolution pattern.
 */
const INFRASTRUCTURE_ENTITY_TYPE_TO_POINT_FK: Record<string, string> = {
  ENVIRONMENT: 'environment_id',
  CLOUD_ACCOUNT: 'cloud_account_id',
  LOCATION: 'location_id',
  NETWORK: 'network_id',
  SUBNET: 'subnet_id',
  COMPUTE_CLUSTER: 'compute_cluster_id',
  COMPUTE_RESOURCE: 'compute_resource_id',
  DEPLOYMENT_UNIT: 'deployment_unit_id',
  LOAD_BALANCER: 'load_balancer_id',
  LISTENER: 'listener_id',
  DATA_STORE_INSTANCE: 'data_store_instance_id',
  INFRASTRUCTURE_RESOURCE: 'infrastructure_resource_id',
};

/**
 * Interface representing all entity IDs present on a specific diagram.
 * Used for O(1) lookups when determining relationship eligibility.
 *
 * Each Set contains entity IDs (not node IDs) for the respective entity type.
 * The applicationPointsOnDiagram Set includes IDs derived from:
 * - Direct APPLICATION_POINT nodes
 * - APPLICATION nodes (mapped via application_points where application_id matches)
 * - APP_COMPONENT nodes (mapped via application_points where application_component_id matches)
 * - SERVICE nodes (mapped via application_points where service_id matches)
 */
export interface EntitiesOnDiagram {
  applicationPointsOnDiagram: Set<string>;
  businessUsersOnDiagram: Set<string>;
  businessProcessesOnDiagram: Set<string>;
  processActivitiesOnDiagram: Set<string>;
  businessPointsOnDiagram: Set<string>;
  logicalDataEntitiesOnDiagram: Set<string>;
  physicalDataEntitiesOnDiagram: Set<string>;
  logicalDataAttributesOnDiagram: Set<string>;
  physicalDataAttributesOnDiagram: Set<string>;
  /**
   * Spec 2026-05-05: Infrastructure Domain Diagram Support
   * Set of `infrastructure_points.id` values derived from on-canvas concrete-entity
   * nodes whose entity_type is one of the 12 InfrastructurePointKind constants.
   * Mirrors the BUSINESS_POINT polymorphic-resolution pattern - no
   * INFRASTRUCTURE_POINT nodes are ever drawn on the canvas.
   */
  infrastructurePointsOnDiagram: Set<string>;
}

/**
 * Compute Set-based lookups for all entity types present on a diagram.
 * This pure function derives entity presence from diagram_nodes[], enabling
 * O(1) eligibility checks for relationship rows in the palette.
 *
 * CRITICAL: Application Point abstraction - Application, App Component, and Service
 * nodes are mapped to their corresponding application_point.id values via metaModel lookup.
 * This ensures Data Movement eligibility correctly checks applicationPointsOnDiagram.
 *
 * @param metaModel - The meta-model containing application_points for abstraction mapping
 * @param activeDiagram - The currently active diagram (or undefined if none)
 * @returns EntitiesOnDiagram with Sets for each entity type
 */
export function getEntitiesOnDiagram(
  metaModel: MetaModel,
  activeDiagram: Diagram | { diagram_nodes: DiagramNode[] } | undefined
): EntitiesOnDiagram {
  // Initialize empty Sets
  const result: EntitiesOnDiagram = {
    applicationPointsOnDiagram: new Set<string>(),
    businessUsersOnDiagram: new Set<string>(),
    businessProcessesOnDiagram: new Set<string>(),
    processActivitiesOnDiagram: new Set<string>(),
    businessPointsOnDiagram: new Set<string>(),
    logicalDataEntitiesOnDiagram: new Set<string>(),
    physicalDataEntitiesOnDiagram: new Set<string>(),
    logicalDataAttributesOnDiagram: new Set<string>(),
    physicalDataAttributesOnDiagram: new Set<string>(),
    infrastructurePointsOnDiagram: new Set<string>(),
  };

  // Return empty sets if no diagram
  if (!activeDiagram || !activeDiagram.diagram_nodes) {
    return result;
  }

  const nodes = activeDiagram.diagram_nodes;

  // Iterate over diagram nodes and populate Sets
  for (const node of nodes) {
    const entityType = node.entity_type;
    const entityId = node.entity_id;

    switch (entityType) {
      case ENTITY_TYPES.APPLICATION_POINT:
        // Direct APPLICATION_POINT node - add entity_id directly
        result.applicationPointsOnDiagram.add(entityId);
        break;

      case ENTITY_TYPES.APPLICATION:
        // APPLICATION node - map to application_points via application_id
        // Find all application_points where application_id matches this Application
        for (const ap of metaModel.entities.application_points) {
          if (ap.application_id === entityId) {
            result.applicationPointsOnDiagram.add(ap.id);
          }
        }
        break;

      case ENTITY_TYPES.APP_COMPONENT:
        // APP_COMPONENT node - map to application_points via application_component_id
        for (const ap of metaModel.entities.application_points) {
          if (ap.application_component_id === entityId) {
            result.applicationPointsOnDiagram.add(ap.id);
          }
        }
        break;

      case ENTITY_TYPES.SERVICE:
        // SERVICE node - map to application_points via service_id
        for (const ap of metaModel.entities.application_points) {
          if (ap.service_id === entityId) {
            result.applicationPointsOnDiagram.add(ap.id);
          }
        }
        break;

      case ENTITY_TYPES.BUSINESS_USER:
        result.businessUsersOnDiagram.add(entityId);
        break;

      case ENTITY_TYPES.BUSINESS_PROCESS:
        result.businessProcessesOnDiagram.add(entityId);
        // BUSINESS_PROCESS node - map to business_points via deterministic ID pattern
        // For BUSINESS_PROCESS kind, the Business Point ID is bp_{processId}
        result.businessPointsOnDiagram.add(generateBusinessPointId(entityId));
        break;

      case ENTITY_TYPES.PROCESS_ACTIVITY:
        result.processActivitiesOnDiagram.add(entityId);
        // PROCESS_ACTIVITY node - map to business_points via deterministic ID pattern
        // For PROCESS_ACTIVITY kind, the Business Point ID is bp_{activityId}
        result.businessPointsOnDiagram.add(generateBusinessPointId(entityId));
        break;

      case ENTITY_TYPES.BUSINESS_POINT:
        // Direct BUSINESS_POINT node - add entity_id directly
        result.businessPointsOnDiagram.add(entityId);
        break;

      case ENTITY_TYPES.LOGICAL_DATA_ENTITY:
        result.logicalDataEntitiesOnDiagram.add(entityId);
        break;

      case ENTITY_TYPES.PHYSICAL_DATA_ENTITY:
        result.physicalDataEntitiesOnDiagram.add(entityId);
        break;

      case ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE:
        result.logicalDataAttributesOnDiagram.add(entityId);
        break;

      case ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE:
        result.physicalDataAttributesOnDiagram.add(entityId);
        break;

      default: {
        // Spec 2026-05-05: Infrastructure Domain Diagram Support
        // For each on-canvas concrete-entity node whose entity_type is one of the 12
        // SCREAMING_SNAKE_CASE InfrastructurePointKind constants, look up the matching
        // infrastructure_points row via the typed FK column (e.g. compute_resource_id)
        // and add the row's id. NO INFRASTRUCTURE_POINT nodes are ever drawn on the
        // canvas - concrete-entity nodes only (locked Q4).
        const fkField = INFRASTRUCTURE_ENTITY_TYPE_TO_POINT_FK[entityType];
        if (fkField) {
          const infraPoints = metaModel.entities.infrastructure_points || [];
          for (const ip of infraPoints) {
            if ((ip as unknown as Record<string, unknown>)[fkField] === entityId) {
              result.infrastructurePointsOnDiagram.add(ip.id);
            }
          }
        }
        break;
      }
    }
  }

  return result;
}

// ============================================================================
// Task Group 2: Endpoint Detection Utilities
// ============================================================================

/**
 * Find a diagram node by entity type and entity ID
 *
 * @param nodes - Array of diagram nodes to search
 * @param entityType - The entity type constant (e.g., ENTITY_TYPES.BUSINESS_USER)
 * @param entityId - The entity ID to find
 * @returns The matching DiagramNode or undefined
 */
export function findNodeForEntity(
  nodes: DiagramNode[],
  entityType: string,
  entityId: string
): DiagramNode | undefined {
  return nodes.find(n => n.entity_type === entityType && n.entity_id === entityId);
}

/**
 * Check if both endpoints of a relationship are present on the diagram
 *
 * @param nodes - Array of diagram nodes
 * @param entityType1 - First entity type
 * @param entityId1 - First entity ID
 * @param entityType2 - Second entity type
 * @param entityId2 - Second entity ID
 * @returns true if both endpoints have corresponding nodes on the diagram
 */
export function areEndpointsOnDiagram(
  nodes: DiagramNode[],
  entityType1: string,
  entityId1: string,
  entityType2: string,
  entityId2: string
): boolean {
  const node1 = findNodeForEntity(nodes, entityType1, entityId1);
  const node2 = findNodeForEntity(nodes, entityType2, entityId2);
  return node1 !== undefined && node2 !== undefined;
}

/**
 * Containment state for App Point-Process relationships
 */
export type ContainmentState = 'A_ONLY' | 'NEITHER' | 'BOTH';

/**
 * Get the containment state for an App Point-Process relationship
 *
 * @param nodes - Array of diagram nodes
 * @param appPointId - The Application Point entity ID
 * @param processId - The Business Process entity ID
 * @returns Containment state: 'A_ONLY', 'NEITHER', or 'BOTH'
 */
export function getContainmentState(
  nodes: DiagramNode[],
  appPointId: string,
  processId: string
): ContainmentState {
  const appPointNode = findNodeForEntity(nodes, ENTITY_TYPES.APPLICATION_POINT, appPointId);
  const processNode = findNodeForEntity(nodes, ENTITY_TYPES.BUSINESS_PROCESS, processId);

  if (!appPointNode && !processNode) {
    return 'NEITHER';
  }

  if (appPointNode && !processNode) {
    return 'A_ONLY';
  }

  if (appPointNode && processNode) {
    // Check if process is a child of app point (containment already exists)
    if (processNode.parent_node_id === appPointNode.id) {
      return 'BOTH';
    }
    // Process exists but not as child - treat as A_ONLY (can still add containment)
    return 'A_ONLY';
  }

  // Process exists without app point - unusual state, treat as NEITHER
  return 'NEITHER';
}

/**
 * Find an APPLICATION_POINT node by its entity ID
 *
 * @param nodes - Array of diagram nodes
 * @param applicationPointId - The Application Point entity ID
 * @returns The matching DiagramNode or undefined
 */
export function findAppPointNode(
  nodes: DiagramNode[],
  applicationPointId: string
): DiagramNode | undefined {
  return findNodeForEntity(nodes, ENTITY_TYPES.APPLICATION_POINT, applicationPointId);
}

// ============================================================================
// Task Group 3: Enable/Disable Logic Per Relationship Type
// Refactored to use EntitiesOnDiagram for O(1) Set-based lookups
// ============================================================================

/**
 * Disabled reason for relationship rows in the palette.
 * Used to determine which tooltip message to display.
 */
export type DisabledReason = 'endpoints_missing' | 'already_visualised' | null;

/**
 * Result of relationship eligibility check, including the reason if disabled.
 */
export interface RelationshipEligibility {
  enabled: boolean;
  disabledReason: DisabledReason;
}

/**
 * Master function to determine if a relationship row should be enabled.
 * Supports both legacy mode (diagramNodes array) and optimized mode (pre-computed EntitiesOnDiagram).
 *
 * @param relationship - The relationship object from the meta-model
 * @param relationshipType - The relationship type key (e.g., 'business_user_business_points')
 * @param diagramNodes - Array of nodes currently on the diagram
 * @param metaModel - The meta-model for lookups
 * @param entitiesOnDiagram - Optional pre-computed EntitiesOnDiagram for O(1) lookups
 * @returns true if the row should be enabled (clickable)
 */
export function isRelationshipRowEnabled(
  relationship: AnyRelationship,
  relationshipType: string,
  diagramNodes: DiagramNode[],
  metaModel: MetaModel,
  entitiesOnDiagram?: EntitiesOnDiagram
): boolean {
  const result = getRelationshipEligibility(relationship, relationshipType, diagramNodes, metaModel, entitiesOnDiagram);
  return result.enabled;
}

/**
 * Get detailed eligibility information for a relationship row, including disabled reason.
 * Uses EntitiesOnDiagram for O(1) Set-based lookups when provided.
 *
 * @param relationship - The relationship object from the meta-model
 * @param relationshipType - The relationship type key (e.g., 'business_user_business_points')
 * @param diagramNodes - Array of nodes currently on the diagram
 * @param metaModel - The meta-model for lookups
 * @param entitiesOnDiagram - Optional pre-computed EntitiesOnDiagram for O(1) lookups
 * @returns RelationshipEligibility with enabled status and disabledReason
 */
export function getRelationshipEligibility(
  relationship: AnyRelationship,
  relationshipType: string,
  diagramNodes: DiagramNode[],
  metaModel: MetaModel,
  entitiesOnDiagram?: EntitiesOnDiagram
): RelationshipEligibility {
  // Compute EntitiesOnDiagram if not provided (backward compatibility)
  const entities = entitiesOnDiagram || getEntitiesOnDiagram(metaModel, { diagram_nodes: diagramNodes });

  switch (relationshipType) {
    // New Business Point relationship types
    case 'business_user_business_points':
      return isUserBusinessPointEnabledWithSets(relationship as BusinessUserBusinessPoint, entities);

    case 'application_point_business_points':
      return isAppPointBusinessPointEnabledWithSets(relationship as ApplicationPointBusinessPoint, entities);

    case 'logical_data_entity_relationships':
      return isLogicalEREnabledWithSets(relationship as LogicalDataEntityRelationship, entities);

    case 'logical_data_entity_physical_data_entities':
      return isLogicalPhysicalEntityEnabledWithSets(relationship as LogicalDataEntityPhysicalDataEntity, entities);

    case 'logical_data_attribute_physical_data_attributes':
      return isLogicalPhysicalAttributeEnabledWithSets(relationship as LogicalDataAttributePhysicalDataAttribute, entities);

    case 'data_movements':
      return isDataMovementEnabledWithSets(relationship as DataMovement, entities);

    // Spec 2026-05-05: Infrastructure Domain Diagram Support - 3 polymorphic arms
    // Each resolves the *_infrastructure_point_id FK via metaModel.entities.infrastructure_points
    // and honours the locked allowedKinds from spec 4 (Tables UI) for the polymorphic endpoint.
    case 'resource_subnet_hostings':
      return isResourceSubnetHostingEnabledWithSets(relationship as ResourceSubnetHosting, entities, metaModel, diagramNodes);

    case 'deployment_unit_compute_resources':
      return isDeploymentUnitComputeResourceEnabledWithSets(relationship as DeploymentUnitComputeResource, entities, metaModel, diagramNodes);

    case 'load_balancer_resource_routes':
      return isLoadBalancerResourceRouteEnabledWithSets(relationship as LoadBalancerResourceRoute, entities, metaModel, diagramNodes);

    // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain arms
    // Each resolves the source-side application_point_id (or data_entity_point_id for Rel 2)
    // and the target-side concrete-FK by direct entity_type lookup on diagram nodes.
    case 'application_compute_deployments':
      return isApplicationComputeDeploymentEnabledWithSets(relationship as ApplicationComputeDeployment, entities, diagramNodes);

    case 'data_entity_data_store_hostings':
      return isDataEntityDataStoreHostingEnabledWithSets(relationship as DataEntityDataStoreHosting, entities, diagramNodes);

    case 'application_infrastructure_resource_uses':
      return isApplicationInfrastructureResourceUseEnabledWithSets(relationship as ApplicationInfrastructureResourceUse, entities, diagramNodes);

    case 'application_load_balancer_exposures':
      return isApplicationLoadBalancerExposureEnabledWithSets(relationship as ApplicationLoadBalancerExposure, entities, diagramNodes);

    default:
      return { enabled: false, disabledReason: 'endpoints_missing' };
  }
}

/**
 * User-Business Point: enabled if BOTH BusinessUser AND BusinessPoint are on diagram.
 * Uses Set-based lookups for O(1) performance.
 *
 * The businessPointsOnDiagram Set is populated by getEntitiesOnDiagram with:
 * - Direct BUSINESS_POINT node entity_ids
 * - Business Point IDs mapped from BUSINESS_PROCESS nodes (using bp_{processId})
 * - Business Point IDs mapped from PROCESS_ACTIVITY nodes (using bp_{activityId})
 *
 * @param relationship - BusinessUserBusinessPoint relationship
 * @param entities - Pre-computed EntitiesOnDiagram
 * @returns RelationshipEligibility with enabled status and disabledReason
 */
function isUserBusinessPointEnabledWithSets(
  relationship: BusinessUserBusinessPoint,
  entities: EntitiesOnDiagram
): RelationshipEligibility {
  const userOnDiagram = entities.businessUsersOnDiagram.has(relationship.business_user_id);
  const bpOnDiagram = entities.businessPointsOnDiagram.has(relationship.business_point_id);

  if (userOnDiagram && bpOnDiagram) {
    return { enabled: true, disabledReason: null };
  }

  return { enabled: false, disabledReason: 'endpoints_missing' };
}

/**
 * App Point-Business Point: enabled if BOTH ApplicationPoint AND BusinessPoint are on diagram.
 * Uses Set-based lookups for O(1) performance.
 *
 * The applicationPointsOnDiagram Set is populated by getEntitiesOnDiagram with:
 * - Direct APPLICATION_POINT node entity_ids
 * - Application Point IDs mapped from APPLICATION nodes
 * - Application Point IDs mapped from APP_COMPONENT nodes
 * - Application Point IDs mapped from SERVICE nodes
 *
 * The businessPointsOnDiagram Set is populated by getEntitiesOnDiagram with:
 * - Direct BUSINESS_POINT node entity_ids
 * - Business Point IDs mapped from BUSINESS_PROCESS nodes (using bp_{processId})
 * - Business Point IDs mapped from PROCESS_ACTIVITY nodes (using bp_{activityId})
 *
 * @param relationship - ApplicationPointBusinessPoint relationship
 * @param entities - Pre-computed EntitiesOnDiagram
 * @returns RelationshipEligibility with enabled status and disabledReason
 */
function isAppPointBusinessPointEnabledWithSets(
  relationship: ApplicationPointBusinessPoint,
  entities: EntitiesOnDiagram
): RelationshipEligibility {
  const apOnDiagram = entities.applicationPointsOnDiagram.has(relationship.application_point_id);
  const bpOnDiagram = entities.businessPointsOnDiagram.has(relationship.business_point_id);

  if (apOnDiagram && bpOnDiagram) {
    return { enabled: true, disabledReason: null };
  }

  return { enabled: false, disabledReason: 'endpoints_missing' };
}

/**
 * Logical ER: enabled if BOTH endpoints are on diagram.
 * Uses Set-based lookups for O(1) performance.
 *
 * Spec: Fix ER Relationship Addability
 * - Uses parseDataEntityPointId() to parse fromDataEntityPointId and toDataEntityPointId
 * - Supports logical-to-logical, physical-to-physical, and cross-kind relationships
 * - Checks parsed entityType against appropriate diagram entity Sets
 *
 * @param relationship - LogicalDataEntityRelationship with fromDataEntityPointId and toDataEntityPointId
 * @param entities - Pre-computed EntitiesOnDiagram
 * @returns RelationshipEligibility with enabled status and disabledReason
 */
function isLogicalEREnabledWithSets(
  relationship: LogicalDataEntityRelationship,
  entities: EntitiesOnDiagram
): RelationshipEligibility {
  // Parse fromDataEntityPointId using parseDataEntityPointId()
  const fromParsed = parseDataEntityPointId(relationship.fromDataEntityPointId);
  const toParsed = parseDataEntityPointId(relationship.toDataEntityPointId);

  // If either parse returns null (invalid format or empty), relationship cannot be visualized
  if (!fromParsed || !toParsed) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }

  // Determine if source is on diagram based on parsed entityType
  const sourceOnDiagram = fromParsed.entityType === 'physical'
    ? entities.physicalDataEntitiesOnDiagram.has(fromParsed.entityId)
    : entities.logicalDataEntitiesOnDiagram.has(fromParsed.entityId);

  // Determine if target is on diagram based on parsed entityType
  const targetOnDiagram = toParsed.entityType === 'physical'
    ? entities.physicalDataEntitiesOnDiagram.has(toParsed.entityId)
    : entities.logicalDataEntitiesOnDiagram.has(toParsed.entityId);

  if (sourceOnDiagram && targetOnDiagram) {
    return { enabled: true, disabledReason: null };
  }

  return { enabled: false, disabledReason: 'endpoints_missing' };
}

/**
 * Logical-Physical Entity: enabled if BOTH logical entity ID in logicalDataEntitiesOnDiagram
 * AND physical entity ID in physicalDataEntitiesOnDiagram.
 * Uses Set-based lookups for O(1) performance.
 */
function isLogicalPhysicalEntityEnabledWithSets(
  relationship: LogicalDataEntityPhysicalDataEntity,
  entities: EntitiesOnDiagram
): RelationshipEligibility {
  const logicalOnDiagram = entities.logicalDataEntitiesOnDiagram.has(relationship.logical_entity_id);
  const physicalOnDiagram = entities.physicalDataEntitiesOnDiagram.has(relationship.physical_entity_id);

  if (logicalOnDiagram && physicalOnDiagram) {
    return { enabled: true, disabledReason: null };
  }

  return { enabled: false, disabledReason: 'endpoints_missing' };
}

/**
 * Logical-Physical Attribute: enabled if BOTH logical attribute ID in logicalDataAttributesOnDiagram
 * AND physical attribute ID in physicalDataAttributesOnDiagram.
 * Uses Set-based lookups for O(1) performance.
 */
function isLogicalPhysicalAttributeEnabledWithSets(
  relationship: LogicalDataAttributePhysicalDataAttribute,
  entities: EntitiesOnDiagram
): RelationshipEligibility {
  const logicalOnDiagram = entities.logicalDataAttributesOnDiagram.has(relationship.logical_attribute_id);
  const physicalOnDiagram = entities.physicalDataAttributesOnDiagram.has(relationship.physical_attribute_id);

  if (logicalOnDiagram && physicalOnDiagram) {
    return { enabled: true, disabledReason: null };
  }

  return { enabled: false, disabledReason: 'endpoints_missing' };
}

/**
 * Data Movements: enabled if BOTH source AND target application_point IDs are on diagram.
 *
 * SIMPLIFIED IMPLEMENTATION: Data Movement relationships now directly reference
 * source_application_point_id and target_application_point_id, allowing direct
 * lookup against the applicationPointsOnDiagram Set without intermediate mapping.
 *
 * The applicationPointsOnDiagram Set is already populated by getEntitiesOnDiagram with:
 * - Direct APPLICATION_POINT node entity_ids
 * - Application Point IDs mapped from APPLICATION nodes
 * - Application Point IDs mapped from APP_COMPONENT nodes
 * - Application Point IDs mapped from SERVICE nodes
 */
function isDataMovementEnabledWithSets(
  relationship: DataMovement,
  entities: EntitiesOnDiagram
): RelationshipEligibility {
  // Direct check against applicationPointsOnDiagram Set
  const sourceOnDiagram = entities.applicationPointsOnDiagram.has(
    relationship.source_application_point_id
  );
  const targetOnDiagram = entities.applicationPointsOnDiagram.has(
    relationship.target_application_point_id
  );

  if (sourceOnDiagram && targetOnDiagram) {
    return { enabled: true, disabledReason: null };
  }

  return { enabled: false, disabledReason: 'endpoints_missing' };
}

// ============================================================================
// Spec 2026-05-05: Infrastructure Domain Diagram Support - eligibility helpers
// Each helper resolves the polymorphic infrastructure_point_id FK via metaModel
// and honours the locked allowedKinds array from spec 4 (Tables UI).
// ============================================================================

/**
 * Resolve an infrastructure_point_id to its concrete entity reference.
 * Returns the InfrastructurePointKind (point_kind) and the concrete entity id
 * the row pins to via its typed FK column. Returns null if the row is missing
 * or has no concrete-entity FK populated.
 */
function resolveInfrastructurePoint(
  metaModel: MetaModel,
  pointId: string
): { kind: InfrastructurePointKind; concreteEntityId: string } | null {
  const ip = (metaModel.entities.infrastructure_points || []).find(p => p.id === pointId);
  if (!ip) return null;
  const fkField = INFRASTRUCTURE_ENTITY_TYPE_TO_POINT_FK[ip.point_kind];
  if (!fkField) return null;
  const concreteEntityId = (ip as unknown as Record<string, unknown>)[fkField] as string | undefined;
  if (!concreteEntityId) return null;
  return { kind: ip.point_kind, concreteEntityId };
}

/**
 * Resource <-> Subnet hosting: enabled iff the row's `subnet_id` resolves to an
 * on-canvas SUBNET node AND the polymorphic `infrastructure_point_id` resolves
 * via infrastructure_points to an on-canvas concrete-entity node whose kind is
 * in the locked allowedKinds list.
 *
 * Locked allowedKinds (spec 4): COMPUTE_RESOURCE, DATA_STORE_INSTANCE,
 * LOAD_BALANCER, INFRASTRUCTURE_RESOURCE.
 */
function isResourceSubnetHostingEnabledWithSets(
  relationship: ResourceSubnetHosting,
  entities: EntitiesOnDiagram,
  metaModel: MetaModel,
  diagramNodes: DiagramNode[]
): RelationshipEligibility {
  const ALLOWED_KINDS: InfrastructurePointKind[] = ['COMPUTE_RESOURCE', 'DATA_STORE_INSTANCE', 'LOAD_BALANCER', 'INFRASTRUCTURE_RESOURCE'];

  // 1. Subnet node on canvas (direct FK to subnets table, no polymorphic resolution).
  const subnetOnDiagram = !!findNodeForEntity(diagramNodes, 'SUBNET', relationship.subnet_id);
  if (!subnetOnDiagram) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }

  // 2. Infrastructure point on canvas (via the polymorphic Set populated by getEntitiesOnDiagram).
  const ipOnDiagram = entities.infrastructurePointsOnDiagram.has(relationship.infrastructure_point_id);
  if (!ipOnDiagram) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }

  // 3. Resolved concrete entity is one of the locked allowedKinds (spec 4).
  const resolved = resolveInfrastructurePoint(metaModel, relationship.infrastructure_point_id);
  if (!resolved || !ALLOWED_KINDS.includes(resolved.kind)) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }

  return { enabled: true, disabledReason: null };
}

/**
 * Deployment Unit <-> Compute resource: enabled iff the row's `deployment_unit_id`
 * resolves to an on-canvas DEPLOYMENT_UNIT node AND the polymorphic
 * `compute_infrastructure_point_id` resolves via infrastructure_points to an
 * on-canvas concrete-entity node whose kind is in the locked allowedKinds list.
 *
 * Locked allowedKinds (spec 4): COMPUTE_RESOURCE, COMPUTE_CLUSTER.
 */
function isDeploymentUnitComputeResourceEnabledWithSets(
  relationship: DeploymentUnitComputeResource,
  entities: EntitiesOnDiagram,
  metaModel: MetaModel,
  diagramNodes: DiagramNode[]
): RelationshipEligibility {
  const ALLOWED_KINDS: InfrastructurePointKind[] = ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER'];

  const duOnDiagram = !!findNodeForEntity(diagramNodes, 'DEPLOYMENT_UNIT', relationship.deployment_unit_id);
  if (!duOnDiagram) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }

  const ipOnDiagram = entities.infrastructurePointsOnDiagram.has(relationship.compute_infrastructure_point_id);
  if (!ipOnDiagram) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }

  const resolved = resolveInfrastructurePoint(metaModel, relationship.compute_infrastructure_point_id);
  if (!resolved || !ALLOWED_KINDS.includes(resolved.kind)) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }

  return { enabled: true, disabledReason: null };
}

/**
 * Load Balancer routes: enabled iff the row's `load_balancer_id` resolves to an
 * on-canvas LOAD_BALANCER node AND the polymorphic `target_infrastructure_point_id`
 * resolves via infrastructure_points to an on-canvas concrete-entity node whose
 * kind is in the locked allowedKinds list. `listener_id` is optional (per spec 4).
 *
 * Locked allowedKinds (spec 4): COMPUTE_RESOURCE, COMPUTE_CLUSTER,
 * DATA_STORE_INSTANCE, INFRASTRUCTURE_RESOURCE.
 */
function isLoadBalancerResourceRouteEnabledWithSets(
  relationship: LoadBalancerResourceRoute,
  entities: EntitiesOnDiagram,
  metaModel: MetaModel,
  diagramNodes: DiagramNode[]
): RelationshipEligibility {
  const ALLOWED_KINDS: InfrastructurePointKind[] = ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER', 'DATA_STORE_INSTANCE', 'INFRASTRUCTURE_RESOURCE'];

  const lbOnDiagram = !!findNodeForEntity(diagramNodes, 'LOAD_BALANCER', relationship.load_balancer_id);
  if (!lbOnDiagram) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }

  const ipOnDiagram = entities.infrastructurePointsOnDiagram.has(relationship.target_infrastructure_point_id);
  if (!ipOnDiagram) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }

  const resolved = resolveInfrastructurePoint(metaModel, relationship.target_infrastructure_point_id);
  if (!resolved || !ALLOWED_KINDS.includes(resolved.kind)) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }

  return { enabled: true, disabledReason: null };
}

// ============================================================================
// Spec 2026-05-05: Infrastructure Cross-Domain Integration - eligibility helpers
// 4 cross-domain relationship arms. Source-side resolution uses applicationPointsOnDiagram
// (Rels 1, 3, 4) or parses data_entity_point_id and checks logical/physicalDataEntitiesOnDiagram
// (Rel 2). Target-side concrete FKs are resolved by findNodeForEntity with the matching
// SCREAMING_SNAKE_CASE entity_type on the diagram nodes.
// ============================================================================

/**
 * App <-> Compute deployment: enabled iff the row's application_point_id resolves to an
 * on-canvas application point AND its compute_resource_id resolves to an on-canvas
 * COMPUTE_RESOURCE node. deployment_unit_id and environment_id are optional and not gated.
 */
function isApplicationComputeDeploymentEnabledWithSets(
  relationship: ApplicationComputeDeployment,
  entities: EntitiesOnDiagram,
  diagramNodes: DiagramNode[]
): RelationshipEligibility {
  const apOnDiagram = entities.applicationPointsOnDiagram.has(relationship.application_point_id);
  if (!apOnDiagram) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }
  const computeOnDiagram = !!findNodeForEntity(diagramNodes, 'COMPUTE_RESOURCE', relationship.compute_resource_id);
  if (!computeOnDiagram) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }
  return { enabled: true, disabledReason: null };
}

/**
 * Data Entity <-> Data Store hosting: enabled iff the row's data_entity_point_id parses to a
 * logical/physical data entity that is on-canvas, AND its data_store_instance_id resolves to an
 * on-canvas DATA_STORE_INSTANCE node.
 */
function isDataEntityDataStoreHostingEnabledWithSets(
  relationship: DataEntityDataStoreHosting,
  entities: EntitiesOnDiagram,
  diagramNodes: DiagramNode[]
): RelationshipEligibility {
  const parsed = parseDataEntityPointId(relationship.data_entity_point_id);
  if (!parsed) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }
  const sourceOnDiagram = parsed.entityType === 'physical'
    ? entities.physicalDataEntitiesOnDiagram.has(parsed.entityId)
    : entities.logicalDataEntitiesOnDiagram.has(parsed.entityId);
  if (!sourceOnDiagram) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }
  const dsiOnDiagram = !!findNodeForEntity(diagramNodes, 'DATA_STORE_INSTANCE', relationship.data_store_instance_id);
  if (!dsiOnDiagram) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }
  return { enabled: true, disabledReason: null };
}

/**
 * App <-> Infrastructure Resource use: enabled iff the row's application_point_id resolves to an
 * on-canvas application point AND its infrastructure_resource_id resolves to an on-canvas
 * INFRASTRUCTURE_RESOURCE node.
 */
function isApplicationInfrastructureResourceUseEnabledWithSets(
  relationship: ApplicationInfrastructureResourceUse,
  entities: EntitiesOnDiagram,
  diagramNodes: DiagramNode[]
): RelationshipEligibility {
  const apOnDiagram = entities.applicationPointsOnDiagram.has(relationship.application_point_id);
  if (!apOnDiagram) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }
  const irOnDiagram = !!findNodeForEntity(diagramNodes, 'INFRASTRUCTURE_RESOURCE', relationship.infrastructure_resource_id);
  if (!irOnDiagram) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }
  return { enabled: true, disabledReason: null };
}

/**
 * App <-> Load Balancer exposure: enabled iff the row's application_point_id resolves to an
 * on-canvas application point AND its load_balancer_id resolves to an on-canvas LOAD_BALANCER
 * node. listener_id and environment_id are optional and not gated.
 */
function isApplicationLoadBalancerExposureEnabledWithSets(
  relationship: ApplicationLoadBalancerExposure,
  entities: EntitiesOnDiagram,
  diagramNodes: DiagramNode[]
): RelationshipEligibility {
  const apOnDiagram = entities.applicationPointsOnDiagram.has(relationship.application_point_id);
  if (!apOnDiagram) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }
  const lbOnDiagram = !!findNodeForEntity(diagramNodes, 'LOAD_BALANCER', relationship.load_balancer_id);
  if (!lbOnDiagram) {
    return { enabled: false, disabledReason: 'endpoints_missing' };
  }
  return { enabled: true, disabledReason: null };
}

// ============================================================================
// Task Group 3 (ER Diagram UX Enhancements): LogicalER Edge Detection
// Spec 2025-12-31: Check if a LogicalER edge already exists on the diagram
// ============================================================================

/**
 * Check if a LogicalER edge already exists on the diagram for the given relationship ID.
 * Used for duplicate prevention in the RHS palette.
 *
 * @param relationshipId - The LogicalDataEntityRelationship ID to check
 * @param diagramEdges - Array of diagram edges to search
 * @returns true if an edge with matching relationship_type and relationship_id exists
 */
export function isLogicalEREdgeOnDiagram(
  relationshipId: string,
  diagramEdges: DiagramEdge[] | undefined
): boolean {
  // Defensive: handle undefined or null edges array
  if (!diagramEdges || !Array.isArray(diagramEdges)) {
    return false;
  }

  return diagramEdges.some(
    edge =>
      edge.relationship_type === RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP &&
      edge.relationship_id === relationshipId
  );
}

// ============================================================================
// Task Group 4: Edge Creation Utilities
// ============================================================================

/**
 * Calculate edge points connecting the outer edges of two nodes
 * Points connect at the closest edges, not centers
 *
 * @param sourceNode - The source node
 * @param targetNode - The target node
 * @returns Array of EdgePoints with sequence_order 0 and 1
 */
export function calculateEdgePoints(
  sourceNode: DiagramNode,
  targetNode: DiagramNode
): EdgePoint[] {
  // Calculate centers
  const sourceCenter = {
    x: sourceNode.pos_x + sourceNode.width / 2,
    y: sourceNode.pos_y + sourceNode.height / 2,
  };
  const targetCenter = {
    x: targetNode.pos_x + targetNode.width / 2,
    y: targetNode.pos_y + targetNode.height / 2,
  };

  // Determine direction from source to target
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;

  // Calculate source connection point (on edge of source node)
  let sourcePoint: { x: number; y: number };
  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal connection
    if (dx > 0) {
      // Target is to the right - connect from right edge of source
      sourcePoint = {
        x: sourceNode.pos_x + sourceNode.width,
        y: sourceCenter.y,
      };
    } else {
      // Target is to the left - connect from left edge of source
      sourcePoint = {
        x: sourceNode.pos_x,
        y: sourceCenter.y,
      };
    }
  } else {
    // Vertical connection
    if (dy > 0) {
      // Target is below - connect from bottom edge of source
      sourcePoint = {
        x: sourceCenter.x,
        y: sourceNode.pos_y + sourceNode.height,
      };
    } else {
      // Target is above - connect from top edge of source
      sourcePoint = {
        x: sourceCenter.x,
        y: sourceNode.pos_y,
      };
    }
  }

  // Calculate target connection point (on edge of target node)
  let targetPoint: { x: number; y: number };
  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal connection
    if (dx > 0) {
      // Source is to the left - connect to left edge of target
      targetPoint = {
        x: targetNode.pos_x,
        y: targetCenter.y,
      };
    } else {
      // Source is to the right - connect to right edge of target
      targetPoint = {
        x: targetNode.pos_x + targetNode.width,
        y: targetCenter.y,
      };
    }
  } else {
    // Vertical connection
    if (dy > 0) {
      // Source is above - connect to top edge of target
      targetPoint = {
        x: targetCenter.x,
        y: targetNode.pos_y,
      };
    } else {
      // Source is below - connect to bottom edge of target
      targetPoint = {
        x: targetCenter.x,
        y: targetNode.pos_y + targetNode.height,
      };
    }
  }

  return [
    {
      id: generatePrefixedId('ep'),
      sequence_order: 0,
      pos_x: sourcePoint.x,
      pos_y: sourcePoint.y,
    },
    {
      id: generatePrefixedId('ep'),
      sequence_order: 1,
      pos_x: targetPoint.x,
      pos_y: targetPoint.y,
    },
  ];
}

/**
 * Calculate the border anchor point on a rectangular node toward a target point.
 *
 * This function determines which edge of the node (top, bottom, left, or right)
 * is closest to the direction of the target point, and returns the center of
 * that edge as the anchor point.
 *
 * Used for USER_LINK edges where the source is a node but the target is a
 * coordinate (MAIN edge midpoint), not another node.
 *
 * @param node - The DiagramNode to calculate the border anchor for
 * @param targetPoint - The target point { x, y } to anchor toward
 * @returns The border anchor point { x, y } on the node's edge
 */
export function calculateBorderAnchorPoint(
  node: DiagramNode,
  targetPoint: { x: number; y: number }
): { x: number; y: number } {
  // Calculate node center
  const nodeCenter = {
    x: node.pos_x + node.width / 2,
    y: node.pos_y + node.height / 2,
  };

  // Calculate direction from node center to target
  const dx = targetPoint.x - nodeCenter.x;
  const dy = targetPoint.y - nodeCenter.y;

  // Determine if horizontal or vertical anchor is closer
  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal - use left or right edge
    if (dx > 0) {
      // Target is to the right - use right edge center
      return { x: node.pos_x + node.width, y: nodeCenter.y };
    } else {
      // Target is to the left - use left edge center
      return { x: node.pos_x, y: nodeCenter.y };
    }
  } else {
    // Vertical - use top or bottom edge
    if (dy > 0) {
      // Target is below - use bottom edge center
      return { x: nodeCenter.x, y: node.pos_y + node.height };
    } else {
      // Target is above - use top edge center
      return { x: nodeCenter.x, y: node.pos_y };
    }
  }
}

/**
 * Calculate midpoint label position from edge points
 *
 * @param edgePoints - Array of edge points
 * @returns Position { x, y } at the midpoint of all edge points
 */
export function calculateMidpointLabelPosition(
  edgePoints: EdgePoint[]
): { x: number; y: number } {
  if (edgePoints.length === 0) {
    return { x: 0, y: 0 };
  }

  const sumX = edgePoints.reduce((sum, p) => sum + p.pos_x, 0);
  const sumY = edgePoints.reduce((sum, p) => sum + p.pos_y, 0);

  return {
    x: sumX / edgePoints.length,
    y: sumY / edgePoints.length,
  };
}

/**
 * Calculate source-side label position (near source node)
 *
 * @param edgePoints - Array of edge points (sorted by sequence_order)
 * @param offset - Distance from source point toward target (default 20px)
 * @returns Position { x, y } near the source endpoint
 */
export function calculateSourceLabelPosition(
  edgePoints: EdgePoint[],
  offset: number = 20
): { x: number; y: number } {
  if (edgePoints.length < 2) {
    return { x: 0, y: 0 };
  }

  const sorted = [...edgePoints].sort((a, b) => a.sequence_order - b.sequence_order);
  const source = sorted[0];
  const next = sorted[1];

  // Calculate direction vector
  const dx = next.pos_x - source.pos_x;
  const dy = next.pos_y - source.pos_y;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length === 0) {
    return { x: source.pos_x, y: source.pos_y };
  }

  // Normalize and apply offset
  const normalizedX = dx / length;
  const normalizedY = dy / length;

  return {
    x: source.pos_x + normalizedX * offset,
    y: source.pos_y + normalizedY * offset - 5, // Offset slightly above the line
  };
}

/**
 * Calculate target-side label position (near target node)
 *
 * @param edgePoints - Array of edge points (sorted by sequence_order)
 * @param offset - Distance from target point toward source (default 20px)
 * @returns Position { x, y } near the target endpoint
 */
export function calculateTargetLabelPosition(
  edgePoints: EdgePoint[],
  offset: number = 20
): { x: number; y: number } {
  if (edgePoints.length < 2) {
    return { x: 0, y: 0 };
  }

  const sorted = [...edgePoints].sort((a, b) => a.sequence_order - b.sequence_order);
  const target = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];

  // Calculate direction vector (from target toward prev)
  const dx = prev.pos_x - target.pos_x;
  const dy = prev.pos_y - target.pos_y;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length === 0) {
    return { x: target.pos_x, y: target.pos_y };
  }

  // Normalize and apply offset
  const normalizedX = dx / length;
  const normalizedY = dy / length;

  return {
    x: target.pos_x + normalizedX * offset,
    y: target.pos_y + normalizedY * offset - 5, // Offset slightly above the line
  };
}

/**
 * Options for creating a relationship edge
 */
export interface EdgeOptions {
  multiplicityType?: string;  // For Logical ER (ONE_TO_ONE, etc.)
  labelText?: string;         // For Data Movement
}

/**
 * Factory function to create a DiagramEdge for a relationship.
 *
 * DATA MOVEMENT EDGE STYLING CONTRACT:
 * - line_type: 'SOLID' - solid line style
 * - arrow_end: 'ARROW' - arrowhead pointing to target Application Point
 * - label_text: set from options.labelText (typically the Logical Data Entity name)
 * - label positioned at midpoint of edge
 *
 * @param relationship - The relationship object
 * @param relationshipEdgeType - The RELATIONSHIP_EDGE_TYPES constant
 * @param sourceNode - Source diagram node
 * @param targetNode - Target diagram node
 * @param options - Optional edge options (multiplicity, label)
 * @returns A new DiagramEdge
 */
export function createRelationshipEdge(
  relationship: AnyRelationship,
  relationshipEdgeType: string,
  sourceNode: DiagramNode,
  targetNode: DiagramNode,
  options?: EdgeOptions
): DiagramEdge {
  const edgePoints = calculateEdgePoints(sourceNode, targetNode);

  const edge: DiagramEdge = {
    id: generatePrefixedId('edge'),
    relationship_type: relationshipEdgeType,
    relationship_id: relationship.id,
    source_node_id: sourceNode.id,
    target_node_id: targetNode.id,
    edge_points: edgePoints,
  };

  // Apply type-specific styling and labels
  switch (relationshipEdgeType) {
    case RELATIONSHIP_EDGE_TYPES.USER_BUSINESS_POINT:
      // User - Business Point: DASHED line, no arrow
      edge.line_type = 'DASHED';
      break;

    case RELATIONSHIP_EDGE_TYPES.APP_POINT_BUSINESS_POINT:
      // App Point - Business Point: SOLID line, no arrow
      edge.line_type = 'SOLID';
      break;

    case RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP:
      // Solid line with multiplicity labels
      edge.line_type = 'SOLID';
      if (options?.multiplicityType) {
        const labels = getMultiplicityLabels(options.multiplicityType);
        edge.source_label_text = labels.source;
        edge.target_label_text = labels.target;

        // Calculate label positions
        const sourcePos = calculateSourceLabelPosition(edgePoints);
        const targetPos = calculateTargetLabelPosition(edgePoints);

        edge.source_label_pos_x = sourcePos.x;
        edge.source_label_pos_y = sourcePos.y;
        edge.target_label_pos_x = targetPos.x;
        edge.target_label_pos_y = targetPos.y;
      }
      break;

    case RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_PHYSICAL_DATA_ENTITY:
    case RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ATTRIBUTE_PHYSICAL_DATA_ATTRIBUTE:
      // Simple solid line, no labels or arrows
      edge.line_type = 'SOLID';
      break;

    case RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT:
      // DATA MOVEMENT EDGE STYLING:
      // - Solid line connecting source to target Application Point
      // - Arrow at target end indicating direction of data flow
      // - Label displays the Logical Data Entity name
      edge.line_type = 'SOLID';
      edge.arrow_end = 'ARROW';
      if (options?.labelText) {
        edge.label_text = options.labelText;
        const midpoint = calculateMidpointLabelPosition(edgePoints);
        edge.label_pos_x = midpoint.x;
        edge.label_pos_y = midpoint.y - 10; // Offset above the line
      }
      break;

    case RELATIONSHIP_EDGE_TYPES.DEPLOYMENT_UNIT_COMPUTE_RESOURCE: {
      // Spec 2026-05-05: Infrastructure Domain Diagram Support
      // V1 styling: DASHED line, no arrow, label "runs on" (or relationship.version if non-empty).
      edge.line_type = 'DASHED';
      edge.arrow_end = 'NONE';
      const versionField = (relationship as { version?: string }).version;
      const labelText = (versionField && versionField.trim().length > 0) ? versionField : 'runs on';
      edge.label_text = labelText;
      const midpoint = calculateMidpointLabelPosition(edgePoints);
      edge.label_pos_x = midpoint.x;
      edge.label_pos_y = midpoint.y - 10;
      break;
    }

    case RELATIONSHIP_EDGE_TYPES.LOAD_BALANCER_RESOURCE_ROUTE: {
      // Spec 2026-05-05: Infrastructure Domain Diagram Support
      // V1 styling: SOLID line, ARROW at target, label "<protocol> <target_port>" (e.g. "HTTPS 443")
      // when both fields are set, fallback to "routes to".
      edge.line_type = 'SOLID';
      edge.arrow_end = 'ARROW';
      const protocol = (relationship as { protocol?: string }).protocol;
      const targetPort = (relationship as { target_port?: number }).target_port;
      const hasProtocol = protocol && protocol.trim().length > 0;
      const hasTargetPort = typeof targetPort === 'number' && Number.isFinite(targetPort);
      const labelText = (hasProtocol && hasTargetPort)
        ? `${protocol} ${targetPort}`
        : (hasProtocol ? String(protocol) : (hasTargetPort ? String(targetPort) : 'routes to'));
      edge.label_text = labelText;
      const midpoint = calculateMidpointLabelPosition(edgePoints);
      edge.label_pos_x = midpoint.x;
      edge.label_pos_y = midpoint.y - 10;
      break;
    }

    // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain edge types
    // All use SOLID + ARROW at target. Default labels are documented per Q9.
    case RELATIONSHIP_EDGE_TYPES.APPLICATION_COMPUTE_DEPLOYMENT: {
      // Label: deployment_role (e.g. "PRIMARY"); fallback "deployed to".
      edge.line_type = 'SOLID';
      edge.arrow_end = 'ARROW';
      const role = (relationship as { deployment_role?: string }).deployment_role;
      edge.label_text = (role && role.trim().length > 0) ? role : 'deployed to';
      const midpoint = calculateMidpointLabelPosition(edgePoints);
      edge.label_pos_x = midpoint.x;
      edge.label_pos_y = midpoint.y - 10;
      break;
    }

    case RELATIONSHIP_EDGE_TYPES.DATA_ENTITY_DATA_STORE_HOSTING: {
      // Label: hosting_role (e.g. "REPLICA"); fallback "hosted on".
      edge.line_type = 'SOLID';
      edge.arrow_end = 'ARROW';
      const role = (relationship as { hosting_role?: string }).hosting_role;
      edge.label_text = (role && role.trim().length > 0) ? role : 'hosted on';
      const midpoint = calculateMidpointLabelPosition(edgePoints);
      edge.label_pos_x = midpoint.x;
      edge.label_pos_y = midpoint.y - 10;
      break;
    }

    case RELATIONSHIP_EDGE_TYPES.APPLICATION_INFRASTRUCTURE_RESOURCE_USE: {
      // Label: dependency_type (or access_mode if unset); fallback "uses".
      edge.line_type = 'SOLID';
      edge.arrow_end = 'ARROW';
      const dep = (relationship as { dependency_type?: string }).dependency_type;
      const access = (relationship as { access_mode?: string }).access_mode;
      let labelText: string;
      if (dep && dep.trim().length > 0) {
        labelText = dep;
      } else if (access && access.trim().length > 0) {
        labelText = access;
      } else {
        labelText = 'uses';
      }
      edge.label_text = labelText;
      const midpoint = calculateMidpointLabelPosition(edgePoints);
      edge.label_pos_x = midpoint.x;
      edge.label_pos_y = midpoint.y - 10;
      break;
    }

    case RELATIONSHIP_EDGE_TYPES.APPLICATION_LOAD_BALANCER_EXPOSURE: {
      // Label: "<protocol> <target_port>" (e.g. "HTTPS 443"); graceful fallback to single field
      // or "exposed via" when both unset.
      edge.line_type = 'SOLID';
      edge.arrow_end = 'ARROW';
      const protocol = (relationship as { protocol?: string }).protocol;
      const targetPort = (relationship as { target_port?: number }).target_port;
      const hasProtocol = protocol && protocol.trim().length > 0;
      const hasTargetPort = typeof targetPort === 'number' && Number.isFinite(targetPort);
      const labelText = (hasProtocol && hasTargetPort)
        ? `${protocol} ${targetPort}`
        : (hasProtocol ? String(protocol) : (hasTargetPort ? String(targetPort) : 'exposed via'));
      edge.label_text = labelText;
      const midpoint = calculateMidpointLabelPosition(edgePoints);
      edge.label_pos_x = midpoint.x;
      edge.label_pos_y = midpoint.y - 10;
      break;
    }

    default:
      // Default solid line
      edge.line_type = 'SOLID';
      break;
  }

  return edge;
}

// ============================================================================
// Task Group 5: Add Relationship Handlers
// These are helper functions that can be called from PalettePanel
// ============================================================================

/**
 * Get the source and target nodes for a Logical ER relationship.
 *
 * Spec: Fix ER Relationship Addability
 * - Uses parseDataEntityPointId() to parse fromDataEntityPointId and toDataEntityPointId
 * - Maps parsed entityType to ENTITY_TYPES constant for node lookup
 * - Returns null if either parse fails or node not found
 *
 * @param relationship - LogicalDataEntityRelationship with fromDataEntityPointId and toDataEntityPointId
 * @param nodes - Diagram nodes
 * @returns Object with sourceNode and targetNode, or null if not found
 */
export function getLogicalERNodes(
  relationship: LogicalDataEntityRelationship,
  nodes: DiagramNode[]
): { sourceNode: DiagramNode; targetNode: DiagramNode } | null {
  // Parse fromDataEntityPointId using parseDataEntityPointId()
  const fromParsed = parseDataEntityPointId(relationship.fromDataEntityPointId);
  const toParsed = parseDataEntityPointId(relationship.toDataEntityPointId);

  // If either parse fails, cannot find nodes
  if (!fromParsed || !toParsed) {
    return null;
  }

  // Map parsed entityType to ENTITY_TYPES constant
  const fromEntityType = fromParsed.entityType === 'physical'
    ? ENTITY_TYPES.PHYSICAL_DATA_ENTITY
    : ENTITY_TYPES.LOGICAL_DATA_ENTITY;

  const toEntityType = toParsed.entityType === 'physical'
    ? ENTITY_TYPES.PHYSICAL_DATA_ENTITY
    : ENTITY_TYPES.LOGICAL_DATA_ENTITY;

  // Find nodes using resolved entity type and entityId
  const sourceNode = findNodeForEntity(nodes, fromEntityType, fromParsed.entityId);
  const targetNode = findNodeForEntity(nodes, toEntityType, toParsed.entityId);

  if (!sourceNode || !targetNode) {
    return null;
  }

  return { sourceNode, targetNode };
}

/**
 * Get the source and target nodes for a polymorphic Logical ER relationship.
 * Supports both LOGICAL_ENTITY and PHYSICAL_ENTITY endpoint kinds.
 *
 * @deprecated This function uses deprecated from_ref_kind/from_ref_id/to_ref_kind/to_ref_id fields.
 * Use getLogicalERNodes() instead, which uses the new dataEntityPointId fields.
 *
 * Spec 2025-12-31 (ER Diagram UX Enhancements): This function handles the polymorphic
 * endpoint types introduced in the Logical ER Meta-Model Upgrade.
 *
 * @param relationship - LogicalDataEntityRelationship with from_ref_kind and to_ref_kind
 * @param nodes - Diagram nodes
 * @returns Object with sourceNode and targetNode, or null if either not found
 */
export function getPolymorphicLogicalERNodes(
  relationship: LogicalDataEntityRelationship,
  nodes: DiagramNode[]
): { sourceNode: DiagramNode; targetNode: DiagramNode } | null {
  // Use the new getLogicalERNodes() implementation which handles dataEntityPointId
  return getLogicalERNodes(relationship, nodes);
}

/**
 * Map LogicalEREndpointKind to ENTITY_TYPES constant
 *
 * @param kind - The endpoint kind ('LOGICAL_ENTITY' or 'PHYSICAL_ENTITY')
 * @returns The corresponding ENTITY_TYPES constant
 */
export function getEntityTypeForLogicalERKind(kind: LogicalEREndpointKind): string {
  switch (kind) {
    case 'PHYSICAL_ENTITY':
      return ENTITY_TYPES.PHYSICAL_DATA_ENTITY;
    case 'LOGICAL_ENTITY':
    default:
      return ENTITY_TYPES.LOGICAL_DATA_ENTITY;
  }
}

/**
 * Get the source and target nodes for a Logical-Physical Entity relationship
 *
 * @param relationship - LogicalDataEntityPhysicalDataEntity
 * @param nodes - Diagram nodes
 * @returns Object with sourceNode and targetNode, or null if not found
 */
export function getLogicalPhysicalEntityNodes(
  relationship: LogicalDataEntityPhysicalDataEntity,
  nodes: DiagramNode[]
): { sourceNode: DiagramNode; targetNode: DiagramNode } | null {
  const sourceNode = findNodeForEntity(nodes, ENTITY_TYPES.LOGICAL_DATA_ENTITY, relationship.logical_entity_id);
  const targetNode = findNodeForEntity(nodes, ENTITY_TYPES.PHYSICAL_DATA_ENTITY, relationship.physical_entity_id);

  if (!sourceNode || !targetNode) {
    return null;
  }

  return { sourceNode, targetNode };
}

/**
 * Get the source and target nodes for a Logical-Physical Attribute relationship
 *
 * @param relationship - LogicalDataAttributePhysicalDataAttribute
 * @param nodes - Diagram nodes
 * @returns Object with sourceNode and targetNode, or null if not found
 */
export function getLogicalPhysicalAttributeNodes(
  relationship: LogicalDataAttributePhysicalDataAttribute,
  nodes: DiagramNode[]
): { sourceNode: DiagramNode; targetNode: DiagramNode } | null {
  const sourceNode = findNodeForEntity(nodes, ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE, relationship.logical_attribute_id);
  const targetNode = findNodeForEntity(nodes, ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE, relationship.physical_attribute_id);

  if (!sourceNode || !targetNode) {
    return null;
  }

  return { sourceNode, targetNode };
}

/**
 * Get the source and target nodes for a Data Movement relationship.
 * Uses source_application_point_id and target_application_point_id from the DataMovement.
 *
 * Node Search Priority: APPLICATION -> APP_COMPONENT -> SERVICE -> APPLICATION_POINT
 *
 * For each application point endpoint, this function:
 * 1. Looks up the application_point by ID to get its kind and entity references
 * 2. Searches for a node representing that application point in priority order
 * 3. Returns the first matching node for each endpoint
 *
 * @param relationship - DataMovement relationship with source_application_point_id and target_application_point_id
 * @param nodes - Diagram nodes
 * @param metaModel - MetaModel for application point lookup
 * @returns Object with sourceNode and targetNode, or null if not found
 */
export function getDataMovementNodes(
  relationship: DataMovement,
  nodes: DiagramNode[],
  metaModel: MetaModel
): { sourceNode: DiagramNode; targetNode: DiagramNode } | null {
  /**
   * Helper to find a node representing an application point.
   * Searches by application_point_id using the app point's kind and entity references.
   *
   * Priority order: APPLICATION -> APP_COMPONENT -> SERVICE -> APPLICATION_POINT
   */
  const findNodeForApplicationPoint = (applicationPointId: string): DiagramNode | undefined => {
    // Find the application point to get its kind and entity references
    const ap = metaModel.entities.application_points.find(p => p.id === applicationPointId);
    if (!ap) return undefined;

    // Priority 1: APPLICATION node (if app point is for an Application)
    if (ap.kind === 'APPLICATION' && ap.application_id) {
      const appNode = nodes.find(
        n => n.entity_type === ENTITY_TYPES.APPLICATION && n.entity_id === ap.application_id
      );
      if (appNode) return appNode;
    }

    // Priority 2: APP_COMPONENT node (if app point is for an App Component)
    if (ap.kind === 'APP_COMPONENT' && ap.application_component_id) {
      const compNode = nodes.find(
        n => n.entity_type === ENTITY_TYPES.APP_COMPONENT && n.entity_id === ap.application_component_id
      );
      if (compNode) return compNode;
    }

    // Priority 3: SERVICE node (if app point is for a Service)
    if (ap.kind === 'SERVICE' && ap.service_id) {
      const svcNode = nodes.find(
        n => n.entity_type === ENTITY_TYPES.SERVICE && n.entity_id === ap.service_id
      );
      if (svcNode) return svcNode;
    }

    // Priority 4: Direct APPLICATION_POINT node
    return nodes.find(
      n => n.entity_type === ENTITY_TYPES.APPLICATION_POINT && n.entity_id === applicationPointId
    );
  };

  // Find nodes for source and target application points
  const sourceNode = findNodeForApplicationPoint(relationship.source_application_point_id);
  const targetNode = findNodeForApplicationPoint(relationship.target_application_point_id);

  if (!sourceNode || !targetNode) {
    return null;
  }

  return { sourceNode, targetNode };
}

/**
 * Get the logical data entity name for a data movement (used as default label)
 *
 * @param relationship - DataMovement
 * @param metaModel - MetaModel for entity lookup
 * @returns The entity name or empty string
 */
export function getDataMovementEntityName(
  relationship: DataMovement,
  metaModel: MetaModel
): string {
  // DataMovement uses dataEntityPointId, parse it to get the actual entity ID
  if (relationship.dataEntityPointId) {
    const parsed = parseDataEntityPointId(relationship.dataEntityPointId);
    if (parsed) {
      if (parsed.entityType === 'logical') {
        const entity = metaModel.entities.logical_data_entities.find(
          e => e.id === parsed.entityId
        );
        return entity?.name || '';
      } else {
        const entity = metaModel.entities.physical_data_entities.find(
          e => e.id === parsed.entityId
        );
        return entity?.name || '';
      }
    }
  }
  return '';
}

/**
 * Get the source and target nodes for a User-Business Point relationship.
 * Maps business_point_id to the underlying Business Process or Process Activity node.
 *
 * Node Search Priority for Business Point:
 * - BUSINESS_PROCESS node (if BP kind is BUSINESS_PROCESS)
 * - PROCESS_ACTIVITY node (if BP kind is PROCESS_ACTIVITY)
 * - Direct BUSINESS_POINT node
 *
 * @param relationship - BusinessUserBusinessPoint relationship
 * @param nodes - Diagram nodes
 * @param metaModel - MetaModel for business point lookup
 * @returns Object with sourceNode and targetNode, or null if not found
 */
export function getUserBusinessPointNodes(
  relationship: BusinessUserBusinessPoint,
  nodes: DiagramNode[],
  metaModel: MetaModel
): { sourceNode: DiagramNode; targetNode: DiagramNode } | null {
  // Find the source node (Business User)
  const sourceNode = findNodeForEntity(nodes, ENTITY_TYPES.BUSINESS_USER, relationship.business_user_id);

  // Find the target node (Business Point or underlying entity)
  const targetNode = findNodeForBusinessPoint(relationship.business_point_id, nodes, metaModel);

  if (!sourceNode || !targetNode) {
    return null;
  }

  return { sourceNode, targetNode };
}

/**
 * Get the source and target nodes for an App Point-Business Point relationship.
 * Maps application_point_id and business_point_id to their underlying entity nodes.
 *
 * Node Search Priority for Application Point:
 * - APPLICATION node (if AP kind is APPLICATION)
 * - APP_COMPONENT node (if AP kind is APP_COMPONENT)
 * - SERVICE node (if AP kind is SERVICE)
 * - Direct APPLICATION_POINT node
 *
 * Node Search Priority for Business Point:
 * - BUSINESS_PROCESS node (if BP kind is BUSINESS_PROCESS)
 * - PROCESS_ACTIVITY node (if BP kind is PROCESS_ACTIVITY)
 * - Direct BUSINESS_POINT node
 *
 * @param relationship - ApplicationPointBusinessPoint relationship
 * @param nodes - Diagram nodes
 * @param metaModel - MetaModel for entity lookups
 * @returns Object with sourceNode and targetNode, or null if not found
 */
export function getAppPointBusinessPointNodes(
  relationship: ApplicationPointBusinessPoint,
  nodes: DiagramNode[],
  metaModel: MetaModel
): { sourceNode: DiagramNode; targetNode: DiagramNode } | null {
  // Find the source node (Application Point or underlying entity)
  const sourceNode = findNodeForApplicationPointId(relationship.application_point_id, nodes, metaModel);

  // Find the target node (Business Point or underlying entity)
  const targetNode = findNodeForBusinessPoint(relationship.business_point_id, nodes, metaModel);

  if (!sourceNode || !targetNode) {
    return null;
  }

  return { sourceNode, targetNode };
}

/**
 * Helper to find a node representing an application point.
 * Searches by application_point_id using the app point's kind and entity references.
 *
 * Priority order: APPLICATION -> APP_COMPONENT -> SERVICE -> APPLICATION_POINT
 *
 * @param applicationPointId - The Application Point ID to search for
 * @param nodes - Diagram nodes
 * @param metaModel - MetaModel for application point lookup
 * @returns The matching DiagramNode or undefined
 */
function findNodeForApplicationPointId(
  applicationPointId: string,
  nodes: DiagramNode[],
  metaModel: MetaModel
): DiagramNode | undefined {
  // Find the application point to get its kind and entity references
  const ap = metaModel.entities.application_points.find(p => p.id === applicationPointId);
  if (!ap) return undefined;

  // Priority 1: APPLICATION node (if app point is for an Application)
  if (ap.kind === 'APPLICATION' && ap.application_id) {
    const appNode = nodes.find(
      n => n.entity_type === ENTITY_TYPES.APPLICATION && n.entity_id === ap.application_id
    );
    if (appNode) return appNode;
  }

  // Priority 2: APP_COMPONENT node (if app point is for an App Component)
  if (ap.kind === 'APP_COMPONENT' && ap.application_component_id) {
    const compNode = nodes.find(
      n => n.entity_type === ENTITY_TYPES.APP_COMPONENT && n.entity_id === ap.application_component_id
    );
    if (compNode) return compNode;
  }

  // Priority 3: SERVICE node (if app point is for a Service)
  if (ap.kind === 'SERVICE' && ap.service_id) {
    const svcNode = nodes.find(
      n => n.entity_type === ENTITY_TYPES.SERVICE && n.entity_id === ap.service_id
    );
    if (svcNode) return svcNode;
  }

  // Priority 4: Direct APPLICATION_POINT node
  return nodes.find(
    n => n.entity_type === ENTITY_TYPES.APPLICATION_POINT && n.entity_id === applicationPointId
  );
}

/**
 * Helper to find a node representing a business point.
 * Searches by business_point_id using the BP's kind and entity references.
 *
 * Priority order: BUSINESS_PROCESS -> PROCESS_ACTIVITY -> BUSINESS_POINT
 *
 * @param businessPointId - The Business Point ID to search for
 * @param nodes - Diagram nodes
 * @param metaModel - MetaModel for business point lookup
 * @returns The matching DiagramNode or undefined
 */
function findNodeForBusinessPoint(
  businessPointId: string,
  nodes: DiagramNode[],
  metaModel: MetaModel
): DiagramNode | undefined {
  // Find the business point to get its kind and entity references
  const bp = metaModel.entities.business_points.find(p => p.id === businessPointId);
  if (!bp) return undefined;

  // Priority 1: BUSINESS_PROCESS node (if BP kind is BUSINESS_PROCESS)
  if (bp.kind === 'BUSINESS_PROCESS' && bp.business_process_id) {
    const processNode = nodes.find(
      n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS && n.entity_id === bp.business_process_id
    );
    if (processNode) return processNode;
  }

  // Priority 2: PROCESS_ACTIVITY node (if BP kind is PROCESS_ACTIVITY)
  if (bp.kind === 'PROCESS_ACTIVITY' && bp.process_activity_id) {
    const activityNode = nodes.find(
      n => n.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY && n.entity_id === bp.process_activity_id
    );
    if (activityNode) return activityNode;
  }

  // Priority 3: Direct BUSINESS_POINT node
  return nodes.find(
    n => n.entity_type === ENTITY_TYPES.BUSINESS_POINT && n.entity_id === businessPointId
  );
}

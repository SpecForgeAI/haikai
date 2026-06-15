/**
 * Infrastructure Point Derivation Utilities
 *
 * Spec 2026-05-04: Infrastructure Domain Tables UI
 *
 * This module provides utilities for creating and managing derived InfrastructurePoints
 * when users select raw infrastructure entities (Environment, CloudAccount, Location,
 * Network, Subnet, ComputeCluster, ComputeResource, DeploymentUnit, LoadBalancer,
 * Listener, DataStoreInstance, InfrastructureResource) in the InfrastructurePointPickerCell.
 *
 * Derived InfrastructurePoints are auto-created proxy entities that:
 * - Have a deterministic ID based on point_kind and the raw entity ID
 * - Point to the source entity via the matching typed FK column
 *   (e.g. compute_resource_id, data_store_instance_id, etc.)
 * - Have point_kind set to the matching InfrastructurePointKind constant
 * - Inherit name and description from the target entity
 *
 * ID Pattern: ip_derived_{point_kind.toLowerCase()}_{rawEntityId}
 *
 * Modelled on `applicationPointDerivation.ts` find-or-create pattern.
 */

import {
  InfrastructurePoint,
  InfrastructurePointKind,
  Environment,
  CloudAccount,
  Location,
  Network,
  Subnet,
  ComputeCluster,
  ComputeResource,
  DeploymentUnit,
  LoadBalancer,
  Listener,
  DataStoreInstance,
  InfrastructureResource,
  MetaModelEntities,
  EntityType,
} from '../types/model';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Raw source entity types for derived Infrastructure Point creation.
 * Maps 1:1 to the 12 InfrastructurePointKind discriminator values.
 */
export type DerivedInfrastructureSourceEntityType =
  | 'environments'
  | 'cloud_accounts'
  | 'locations'
  | 'networks'
  | 'subnets'
  | 'compute_clusters'
  | 'compute_resources'
  | 'deployment_units'
  | 'load_balancers'
  | 'listeners'
  | 'data_store_instances'
  | 'infrastructure_resources';

/**
 * Source entity union type for derived Infrastructure Points.
 */
export type DerivedInfrastructureSourceEntity =
  | Environment
  | CloudAccount
  | Location
  | Network
  | Subnet
  | ComputeCluster
  | ComputeResource
  | DeploymentUnit
  | LoadBalancer
  | Listener
  | DataStoreInstance
  | InfrastructureResource;

/**
 * Result of finding or creating a derived Infrastructure Point.
 */
export interface DerivedInfrastructurePointResult {
  infrastructurePoint: InfrastructurePoint;
  isNew: boolean;
}

// ============================================================================
// MAPPING TABLES
// ============================================================================

/**
 * Mapping from raw entity type (collection name) to the InfrastructurePointKind
 * discriminator value used on InfrastructurePoint.point_kind.
 */
export const ENTITY_TYPE_TO_POINT_KIND: Record<
  DerivedInfrastructureSourceEntityType,
  InfrastructurePointKind
> = {
  environments: 'ENVIRONMENT',
  cloud_accounts: 'CLOUD_ACCOUNT',
  locations: 'LOCATION',
  networks: 'NETWORK',
  subnets: 'SUBNET',
  compute_clusters: 'COMPUTE_CLUSTER',
  compute_resources: 'COMPUTE_RESOURCE',
  deployment_units: 'DEPLOYMENT_UNIT',
  load_balancers: 'LOAD_BALANCER',
  listeners: 'LISTENER',
  data_store_instances: 'DATA_STORE_INSTANCE',
  infrastructure_resources: 'INFRASTRUCTURE_RESOURCE',
};

/**
 * Mapping from InfrastructurePointKind to the typed FK column on InfrastructurePoint.
 * E.g. point_kind === 'COMPUTE_RESOURCE' means the typed FK is `compute_resource_id`.
 */
export const POINT_KIND_TO_FK_FIELD: Record<
  InfrastructurePointKind,
  keyof InfrastructurePoint
> = {
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
 * Mapping from InfrastructurePointKind to the raw entity collection name on MetaModelEntities.
 */
export const POINT_KIND_TO_ENTITY_TYPE: Record<
  InfrastructurePointKind,
  DerivedInfrastructureSourceEntityType
> = {
  ENVIRONMENT: 'environments',
  CLOUD_ACCOUNT: 'cloud_accounts',
  LOCATION: 'locations',
  NETWORK: 'networks',
  SUBNET: 'subnets',
  COMPUTE_CLUSTER: 'compute_clusters',
  COMPUTE_RESOURCE: 'compute_resources',
  DEPLOYMENT_UNIT: 'deployment_units',
  LOAD_BALANCER: 'load_balancers',
  LISTENER: 'listeners',
  DATA_STORE_INSTANCE: 'data_store_instances',
  INFRASTRUCTURE_RESOURCE: 'infrastructure_resources',
};

// ============================================================================
// ID GENERATION
// ============================================================================

/**
 * Generate a deterministic ID for a derived Infrastructure Point.
 *
 * ID Pattern: ip_derived_{point_kind.toLowerCase()}_{rawEntityId}
 *
 * This pattern ensures:
 * - IDs are unique per point_kind and raw-entity combination
 * - IDs are deterministic and can be regenerated
 * - IDs don't collide with other entity IDs in the model
 *
 * @param pointKind - The InfrastructurePointKind discriminator
 * @param rawEntityId - The ID of the raw infrastructure entity
 * @returns Deterministic derived Infrastructure Point ID
 */
export function generateDerivedInfrastructurePointId(
  pointKind: InfrastructurePointKind,
  rawEntityId: string
): string {
  return `ip_derived_${pointKind.toLowerCase()}_${rawEntityId}`;
}

// ============================================================================
// INTERNAL: indexed access to InfrastructurePoint fields
// ============================================================================

/**
 * Read a typed FK field from an InfrastructurePoint by string key.
 * The field is one of the 12 typed FK columns (environment_id, ..., infrastructure_resource_id).
 */
function readPointFkField(
  ip: InfrastructurePoint,
  fkField: keyof InfrastructurePoint
): unknown {
  return (ip as unknown as Record<string, unknown>)[fkField as string];
}

/**
 * Set a typed FK field on an InfrastructurePoint by string key.
 * Used during InfrastructurePoint construction to populate the single matching FK column.
 */
function writePointFkField(
  ip: InfrastructurePoint,
  fkField: keyof InfrastructurePoint,
  value: string
): void {
  (ip as unknown as Record<string, unknown>)[fkField as string] = value;
}

// ============================================================================
// INFRASTRUCTURE POINT LOOKUP (find-or-create)
// ============================================================================

/**
 * Find an existing derived Infrastructure Point for a raw entity.
 *
 * Looks up by typed FK match: e.g. for a raw ComputeResource with id 'cr-123',
 * searches infrastructure_points for any row whose compute_resource_id === 'cr-123'.
 * This is more robust than ID-based lookup (handles models where the IP was created
 * via the deterministic ID and where it was hand-authored with a different id).
 *
 * @param entityType - The raw entity collection (e.g. 'compute_resources')
 * @param rawEntityId - The raw entity's id
 * @param infrastructurePoints - Array of InfrastructurePoint rows to search
 * @returns Matching InfrastructurePoint or undefined
 */
export function findDerivedInfrastructurePoint(
  entityType: DerivedInfrastructureSourceEntityType,
  rawEntityId: string,
  infrastructurePoints: InfrastructurePoint[]
): InfrastructurePoint | undefined {
  const pointKind = ENTITY_TYPE_TO_POINT_KIND[entityType];
  const fkField = POINT_KIND_TO_FK_FIELD[pointKind];
  return infrastructurePoints.find(
    ip => ip.point_kind === pointKind && readPointFkField(ip, fkField) === rawEntityId
  );
}

// ============================================================================
// INFRASTRUCTURE POINT CREATION
// ============================================================================

/**
 * Build a new derived InfrastructurePoint row for a raw entity.
 * Sets the matching point_kind, the matching typed FK column, and copies
 * name/description from the source entity.
 *
 * @param entityType - The raw entity collection name
 * @param rawEntity - The raw entity instance
 * @returns A fresh InfrastructurePoint row (not yet persisted)
 */
function buildDerivedInfrastructurePoint(
  entityType: DerivedInfrastructureSourceEntityType,
  rawEntity: DerivedInfrastructureSourceEntity
): InfrastructurePoint {
  const pointKind = ENTITY_TYPE_TO_POINT_KIND[entityType];
  const fkField = POINT_KIND_TO_FK_FIELD[pointKind];
  const id = generateDerivedInfrastructurePointId(pointKind, rawEntity.id);

  // Build the base row with required envelope fields
  const ip: InfrastructurePoint = {
    id,
    name: rawEntity.name,
    description: rawEntity.description ?? '',
    point_kind: pointKind,
    tags: '',
  };

  // Set the single matching typed FK column
  writePointFkField(ip, fkField, rawEntity.id);

  return ip;
}

// ============================================================================
// ENSURE DERIVED INFRASTRUCTURE POINT (MAIN API)
// ============================================================================

/**
 * Ensure a derived Infrastructure Point exists for a raw infrastructure entity.
 *
 * This is the main API for the InfrastructurePointPickerCell to use when
 * a user selects a raw entity from one of the 12 infrastructure collections.
 *
 * If a derived InfrastructurePoint already exists (by typed-FK match), returns it.
 * Otherwise, creates a new derived InfrastructurePoint and returns it with isNew: true.
 *
 * The caller is responsible for dispatching ADD_ENTITY to persist the new
 * InfrastructurePoint when isNew is true.
 *
 * @param entityType - The raw entity collection (e.g. 'compute_resources')
 * @param rawEntityId - The raw entity's id
 * @param entities - The MetaModelEntities containing all entities
 * @returns Result containing the InfrastructurePoint and whether it's new
 * @throws Error if the raw entity cannot be found in the matching collection
 */
export function ensureDerivedInfrastructurePoint(
  entityType: DerivedInfrastructureSourceEntityType,
  rawEntityId: string,
  entities: MetaModelEntities
): DerivedInfrastructurePointResult {
  // Check for existing derived InfrastructurePoint by typed-FK match
  const existing = findDerivedInfrastructurePoint(
    entityType,
    rawEntityId,
    entities.infrastructure_points
  );

  if (existing) {
    return {
      infrastructurePoint: existing,
      isNew: false,
    };
  }

  // Look up the raw entity in the matching collection
  const collection = entities[entityType] as DerivedInfrastructureSourceEntity[];
  const rawEntity = collection.find(e => e.id === rawEntityId);
  if (!rawEntity) {
    throw new Error(`Raw entity not found: ${entityType}/${rawEntityId}`);
  }

  const newIp = buildDerivedInfrastructurePoint(entityType, rawEntity);

  return {
    infrastructurePoint: newIp,
    isNew: true,
  };
}

// ============================================================================
// UTILITY: GET TARGET ENTITY INFO (for closed-cell display)
// ============================================================================

/**
 * Get information about the raw target entity for an Infrastructure Point.
 * Dispatches on point_kind and looks up the typed FK target.
 *
 * @param infrastructurePoint - The InfrastructurePoint to inspect
 * @param entities - The MetaModelEntities containing all entities
 * @returns Object with the source entity type, raw entity, and a display name; or null if not found
 */
export function getInfrastructurePointTargetInfo(
  infrastructurePoint: InfrastructurePoint,
  entities: MetaModelEntities
): {
  sourceEntityType: DerivedInfrastructureSourceEntityType;
  sourceEntity: DerivedInfrastructureSourceEntity;
  displayName: string;
} | null {
  const sourceEntityType = POINT_KIND_TO_ENTITY_TYPE[infrastructurePoint.point_kind];
  if (!sourceEntityType) {
    return null;
  }
  const fkField = POINT_KIND_TO_FK_FIELD[infrastructurePoint.point_kind];
  const rawId = readPointFkField(infrastructurePoint, fkField);
  if (typeof rawId !== 'string' || rawId.length === 0) {
    return null;
  }

  const collection = entities[sourceEntityType] as DerivedInfrastructureSourceEntity[];
  const sourceEntity = collection.find(e => e.id === rawId);
  if (!sourceEntity) {
    return null;
  }

  return {
    sourceEntityType,
    sourceEntity,
    displayName: sourceEntity.name,
  };
}

/**
 * Type guard checking that an EntityType corresponds to one of the 12 raw
 * infrastructure source entity types covered by the InfrastructurePoint picker.
 */
export function isInfrastructureSourceEntityType(
  entityType: EntityType
): entityType is DerivedInfrastructureSourceEntityType {
  return entityType in ENTITY_TYPE_TO_POINT_KIND;
}

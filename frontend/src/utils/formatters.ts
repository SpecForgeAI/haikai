/**
 * Display formatters for entity display in dropdowns and typeahead components.
 *
 * This module provides utilities for formatting entity display strings,
 * particularly for Application Points and Business Points which need to show
 * name and entity type.
 *
 * Spec: Global Application Point Picker with Derived ApplicationPoints
 * - Added 'CLASS' and 'METHOD' to APPLICATION_POINT_KIND_LABELS
 * - Enhanced formatApplicationPointDisplay to show target info for derived APs
 *
 * Spec 2026-05-04: Infrastructure Domain Tables UI
 * - Added InfrastructurePoint formatters mirroring the Application Point pattern.
 *   Dispatches on all 12 InfrastructurePointKind values, looks up the typed FK
 *   target, and renders "<TargetName> (<TypeLabel>)". Returns "(missing)" when
 *   the InfrastructurePoint id resolves to nothing; falls back to the point's
 *   own name when the typed FK target is missing.
 */

import {
  ApplicationPoint,
  ApplicationPointKind,
  BusinessPoint,
  BusinessPointKind,
  AppBusinessPointEntityType,
  AppBusinessPointKind,
  MetaModel,
  AnyEntity,
  resolveAppBusinessPoint,
  MetaModelEntities,
  InfrastructurePoint,
  InfrastructurePointKind,
} from '../types/model';

/**
 * Helper type for entities that have a 'name' property.
 * Used for type-safe access to entity names in formatters.
 */
type NamedEntity = AnyEntity & { name: string };

/**
 * Type guard to check if an entity has a 'name' property.
 */
function hasName(entity: AnyEntity): entity is NamedEntity {
  return 'name' in entity && typeof (entity as { name?: unknown }).name === 'string';
}

// ============================================================================
// Application Point Formatters
// ============================================================================

/**
 * Mapping from ApplicationPoint kind values to human-readable labels.
 * Used to display entity type in dropdown options.
 *
 * Spec: Global Application Point Picker with Derived ApplicationPoints
 * - Added 'CLASS' and 'METHOD' kinds for derived Application Points
 */
export const APPLICATION_POINT_KIND_LABELS: Record<ApplicationPointKind, string> = {
  'APPLICATION': 'Application',
  'APP_COMPONENT': 'Application Component',
  'SERVICE': 'Service',
  'CLASS': 'Class',
  'METHOD': 'Method',
  // Spec 2026-05-06: Library Frontend Types & Tables
  'LIBRARY': 'Library',
};

/**
 * Formats an ApplicationPoint for display in dropdown options.
 *
 * Spec: Global Application Point Picker with Derived ApplicationPoints
 * - Enhanced to show target info when target_type and target_ref_id are set
 * - For derived APs, shows the target entity name and type
 *
 * @param applicationPoint - The ApplicationPoint entity to format
 * @param entities - Optional MetaModelEntities for resolving target entities
 * @returns Formatted display string in format: "<Name> (<Entity Type>)"
 *
 * @example
 * formatApplicationPointDisplay({ name: 'OMS System', kind: 'APPLICATION', ... })
 * // Returns: "OMS System (Application)"
 *
 * @example
 * formatApplicationPointDisplay({ name: 'Pricing UI', kind: 'APP_COMPONENT', ... })
 * // Returns: "Pricing UI (Application Component)"
 *
 * @example
 * // Derived AP with target_type=CLASS, target_ref_id pointing to OrderController
 * formatApplicationPointDisplay(derivedAP, entities)
 * // Returns: "OrderController (Class)"
 */
export function formatApplicationPointDisplay(
  applicationPoint: ApplicationPoint,
  entities?: MetaModelEntities
): string {
  // Check if this is a derived AP with target info
  if (applicationPoint.target_type && applicationPoint.target_ref_id && entities) {
    const targetType = applicationPoint.target_type.toString().toUpperCase();
    const targetRefId = applicationPoint.target_ref_id;

    // Try to resolve the target entity name
    let targetName: string | undefined;

    switch (targetType) {
      case 'SERVICE': {
        const service = entities.services?.find(s => s.id === targetRefId);
        targetName = service?.name;
        break;
      }
      case 'CLASS': {
        const classEntity = entities.classes?.find(c => c.id === targetRefId);
        targetName = classEntity?.name;
        break;
      }
      case 'METHOD': {
        const method = entities.methods?.find(m => m.id === targetRefId);
        if (method) {
          // Include class name for methods
          const owningClass = entities.classes?.find(c => c.id === method.class_id);
          targetName = owningClass ? `${owningClass.name}.${method.name}` : method.name;
        }
        break;
      }
      case 'LIBRARY': {
        // Spec 2026-05-06: Library Frontend Types & Tables
        const library = entities.libraries?.find(l => l.id === targetRefId);
        targetName = library?.name ?? library?.id;
        break;
      }
    }

    if (targetName) {
      // Format the target type for display (e.g., "SERVICE" -> "Service")
      const formattedType = targetType.charAt(0) + targetType.slice(1).toLowerCase();
      return `${targetName} (${formattedType})`;
    }
  }

  // Fallback to standard kind-based formatting
  const kindLabel = APPLICATION_POINT_KIND_LABELS[applicationPoint.kind] || applicationPoint.kind;
  return applicationPoint.name + ' (' + kindLabel + ')';
}

/**
 * Creates a display formatter function for ApplicationPoint entities.
 * This formatter is compatible with the GridColumnConfig.displayFormatter signature.
 *
 * @returns A display formatter function that takes an ID and entities array
 *          and returns a formatted display string.
 *
 * @example
 * const formatter = createApplicationPointDisplayFormatter();
 * const displayText = formatter('ap-1', applicationPoints);
 * // Returns: "OMS System (Application)" or the ID if not found
 */
export function createApplicationPointDisplayFormatter(): (id: string, entities: unknown[]) => string {
  return (id: string, entities: unknown[]): string => {
    const applicationPoints = entities as ApplicationPoint[];
    const point = applicationPoints.find(e => e.id === id);

    if (point) {
      return formatApplicationPointDisplay(point);
    }

    // Return empty string for empty ID (common in new rows)
    if (!id) {
      return '';
    }

    // Fallback: return the ID if entity not found (should not happen in normal use)
    return id;
  };
}

/**
 * Pre-configured display formatter for Application Points.
 * Can be used directly in grid configurations.
 */
export const applicationPointDisplayFormatter = createApplicationPointDisplayFormatter();

// ============================================================================
// Business Point Formatters
// ============================================================================

/**
 * Mapping from BusinessPoint kind values to human-readable labels.
 * Used to display entity type in dropdown options.
 */
export const BUSINESS_POINT_KIND_LABELS: Record<BusinessPointKind, string> = {
  'BUSINESS_PROCESS': 'Business Process',
  'PROCESS_ACTIVITY': 'Process Activity',
};

/**
 * Formats a BusinessPoint for display in dropdown options.
 *
 * @param businessPoint - The BusinessPoint entity to format
 * @returns Formatted display string in format: "<Name> (<Entity Type>)"
 *
 * @example
 * formatBusinessPointDisplay({ name: 'Order Processing', kind: 'BUSINESS_PROCESS', ... })
 * // Returns: "Order Processing (Business Process)"
 *
 * @example
 * formatBusinessPointDisplay({ name: 'Validate Order', kind: 'PROCESS_ACTIVITY', ... })
 * // Returns: "Validate Order (Process Activity)"
 */
export function formatBusinessPointDisplay(businessPoint: BusinessPoint): string {
  const kindLabel = BUSINESS_POINT_KIND_LABELS[businessPoint.kind];
  return businessPoint.name + ' (' + kindLabel + ')';
}

/**
 * Creates a display formatter function for BusinessPoint entities.
 * This formatter is compatible with the GridColumnConfig.displayFormatter signature.
 *
 * @returns A display formatter function that takes an ID and entities array
 *          and returns a formatted display string.
 *
 * @example
 * const formatter = createBusinessPointDisplayFormatter();
 * const displayText = formatter('bp-1', businessPoints);
 * // Returns: "Order Processing (Business Process)" or the ID if not found
 */
export function createBusinessPointDisplayFormatter(): (id: string, entities: unknown[]) => string {
  return (id: string, entities: unknown[]): string => {
    const businessPoints = entities as BusinessPoint[];
    const point = businessPoints.find(e => e.id === id);

    if (point) {
      return formatBusinessPointDisplay(point);
    }

    // Return empty string for empty ID (common in new rows)
    if (!id) {
      return '';
    }

    // Fallback: return the ID if entity not found (should not happen in normal use)
    return id;
  };
}

/**
 * Pre-configured display formatter for Business Points.
 * Can be used directly in grid configurations.
 */
export const businessPointDisplayFormatter = createBusinessPointDisplayFormatter();

// ============================================================================
// App_Business_Point Formatters
// Used for Interaction entity's primary/secondary App_Business_Point FK fields
//
// IMPORTANT: App_Business_Point is now a real indirect entity that is auto-created
// and synced from source entities. The app_business_points collection contains
// lookup entries that reference source entities via source_entity_id.
// ============================================================================

/**
 * Mapping from App_Business_Point entity types to human-readable labels.
 * Covers all 7 entity types that can be App_Business_Points.
 */
export const APP_BUSINESS_POINT_KIND_LABELS: Record<AppBusinessPointEntityType, string> = {
  'APPLICATION': 'Application',
  'APP_COMPONENT': 'Application Component',
  'SERVICE': 'Service',
  'INTERFACE': 'Interface',
  'ENDPOINT': 'Endpoint',
  'BUSINESS_PROCESS': 'Business Process',
  'PROCESS_ACTIVITY': 'Process Activity',
};

/**
 * Mapping from AppBusinessPointKind (the 6 ABP source types) to human-readable labels.
 * Note: ENDPOINT is not an ABP kind because endpoints are children of interfaces.
 */
export const ABP_KIND_LABELS: Record<AppBusinessPointKind, string> = {
  'APPLICATION': 'Application',
  'APP_COMPONENT': 'Application Component',
  'SERVICE': 'Service',
  'INTERFACE': 'Interface',
  'BUSINESS_PROCESS': 'Business Process',
  'PROCESS_ACTIVITY': 'Process Activity',
};

/**
 * Formats an App_Business_Point entity for display in dropdown options.
 *
 * @param entity - The entity to format (must have a name property)
 * @param entityType - The entity type (one of the 7 App_Business_Point types)
 * @returns Formatted display string in format: "<Name> (<Entity Type>)"
 *
 * @example
 * formatAppBusinessPointDisplay({ name: 'Order System', ... }, 'APPLICATION')
 * // Returns: "Order System (Application)"
 *
 * @example
 * formatAppBusinessPointDisplay({ name: 'Order Processing', ... }, 'BUSINESS_PROCESS')
 * // Returns: "Order Processing (Business Process)"
 */
export function formatAppBusinessPointDisplay(
  entity: AnyEntity,
  entityType: AppBusinessPointEntityType
): string {
  const kindLabel = APP_BUSINESS_POINT_KIND_LABELS[entityType];
  // Use type guard to safely access name property
  const entityName = hasName(entity) ? entity.name : entity.id;
  return entityName + ' (' + kindLabel + ')';
}

/**
 * Creates a display formatter function for App_Business_Point polymorphic FK fields.
 * This formatter is compatible with the GridColumnConfig.displayFormatter signature.
 *
 * Unlike Application Point and Business Point formatters, this formatter needs
 * access to the entire MetaModel to search across all 7 App_Business_Point collections.
 *
 * @param metaModel - The MetaModel containing all entities
 * @returns A display formatter function that takes an ID and entities array
 *          and returns a formatted display string.
 *
 * @example
 * const formatter = createAppBusinessPointDisplayFormatter(metaModel);
 * const displayText = formatter('app-001', []); // entities param ignored
 * // Returns: "Order System (Application)" or the ID if not found
 */
export function createAppBusinessPointDisplayFormatter(
  metaModel: MetaModel
): (id: string, entities: unknown[]) => string {
  return (id: string, _entities: unknown[]): string => {
    // Return empty string for empty ID (common in new rows)
    if (!id) {
      return '';
    }

    // Use resolveAppBusinessPoint to search across all 7 collections
    const resolved = resolveAppBusinessPoint(id, metaModel);

    if (resolved) {
      return formatAppBusinessPointDisplay(resolved.entity, resolved.entityType);
    }

    // Fallback: return the ID if entity not found (should not happen in normal use)
    return id;
  };
}

/**
 * Aggregates all entities that are valid App_Business_Point targets.
 * Returns an array of objects with id, name, and entityType for typeahead display.
 *
 * UPDATED: Now returns entities from the app_business_points collection instead of
 * aggregating from 7 separate collections. This simplifies the lookup and ensures
 * consistency with the auto-created/synced ABP entries.
 *
 * For backward compatibility, also includes ENDPOINT entities which are not
 * auto-created as ABPs but can still be valid interaction targets.
 *
 * @param metaModel - The MetaModel containing all entities
 * @returns Array of App_Business_Point entities with their types
 */
export function getAllAppBusinessPointEntities(
  metaModel: MetaModel
): Array<{ id: string; name: string; entityType: AppBusinessPointEntityType; displayName: string }> {
  const result: Array<{ id: string; name: string; entityType: AppBusinessPointEntityType; displayName: string }> = [];

  // Primary source: app_business_points collection (auto-created lookup entities)
  const appBusinessPoints = metaModel.entities.app_business_points || [];
  for (const abp of appBusinessPoints) {
    result.push({
      id: abp.id,
      name: abp.name,
      entityType: abp.kind as AppBusinessPointEntityType,
      displayName: abp.name + ' (' + ABP_KIND_LABELS[abp.kind] + ')',
    });
  }

  // Also include Endpoints for backward compatibility
  // Endpoints are NOT auto-created as ABPs but can still be valid interaction targets
  for (const ep of metaModel.entities.endpoints) {
    result.push({
      id: ep.id,
      name: ep.name,
      entityType: 'ENDPOINT',
      displayName: formatAppBusinessPointDisplay(ep, 'ENDPOINT'),
    });
  }

  return result;
}

// ============================================================================
// Infrastructure Point Formatters
// Spec 2026-05-04: Infrastructure Domain Tables UI
//
// InfrastructurePoint is a polymorphic supertype across the 12 Infrastructure
// entity collections (Environment, CloudAccount, Location, Network, Subnet,
// ComputeCluster, ComputeResource, DeploymentUnit, LoadBalancer, Listener,
// DataStoreInstance, InfrastructureResource). Each row carries a `point_kind`
// discriminator plus the matching typed FK column (e.g. compute_resource_id).
// ============================================================================

/**
 * Mapping from InfrastructurePointKind values to human-readable labels.
 * Used to display entity type in InfrastructurePoint picker dropdown options.
 */
export const INFRASTRUCTURE_POINT_KIND_LABELS: Record<InfrastructurePointKind, string> = {
  'ENVIRONMENT': 'Environment',
  'CLOUD_ACCOUNT': 'Cloud Account',
  'LOCATION': 'Location',
  'NETWORK': 'Network',
  'SUBNET': 'Subnet',
  'COMPUTE_CLUSTER': 'Compute Cluster',
  'COMPUTE_RESOURCE': 'Compute Resource',
  'DEPLOYMENT_UNIT': 'Deployment Unit',
  'LOAD_BALANCER': 'Load Balancer',
  'LISTENER': 'Listener',
  'DATA_STORE_INSTANCE': 'Data Store',
  'INFRASTRUCTURE_RESOURCE': 'Infrastructure Resource',
};

/**
 * Mapping from InfrastructurePointKind to the typed FK column on the
 * InfrastructurePoint row. E.g. point_kind 'COMPUTE_RESOURCE' uses compute_resource_id.
 */
const INFRASTRUCTURE_POINT_KIND_TO_FK_FIELD: Record<InfrastructurePointKind, keyof InfrastructurePoint> = {
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
 * Mapping from InfrastructurePointKind to the source-entity collection key
 * on MetaModelEntities. E.g. point_kind 'COMPUTE_RESOURCE' looks up entities.compute_resources.
 */
const INFRASTRUCTURE_POINT_KIND_TO_COLLECTION: Record<InfrastructurePointKind, keyof MetaModelEntities> = {
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

/**
 * Formats an InfrastructurePoint for display in dropdown options and closed-cell views.
 *
 * Dispatches on `point_kind`, looks up the typed FK target in the matching
 * collection, and returns "<TargetName> (<TypeLabel>)". When the typed FK
 * target is missing, falls back to the InfrastructurePoint's own `name`.
 *
 * @param infrastructurePoint - The InfrastructurePoint entity to format
 * @param entities - Optional MetaModelEntities for resolving the typed FK target
 * @returns Formatted display string in format: "<TargetName> (<TypeLabel>)"
 *
 * @example
 * // ip with point_kind='COMPUTE_RESOURCE', compute_resource_id='cr-1' -> ComputeResource 'web-01'
 * formatInfrastructurePointDisplay(ip, entities)
 * // Returns: "web-01 (Compute Resource)"
 */
export function formatInfrastructurePointDisplay(
  infrastructurePoint: InfrastructurePoint,
  entities?: MetaModelEntities
): string {
  const kindLabel =
    INFRASTRUCTURE_POINT_KIND_LABELS[infrastructurePoint.point_kind] ||
    String(infrastructurePoint.point_kind);

  if (entities) {
    const fkField = INFRASTRUCTURE_POINT_KIND_TO_FK_FIELD[infrastructurePoint.point_kind];
    const collectionKey = INFRASTRUCTURE_POINT_KIND_TO_COLLECTION[infrastructurePoint.point_kind];
    if (fkField && collectionKey) {
      const fkValue = (infrastructurePoint as unknown as Record<string, unknown>)[fkField as string];
      if (typeof fkValue === 'string' && fkValue.length > 0) {
        const collection = entities[collectionKey] as Array<{ id: string; name: string }> | undefined;
        const target = collection?.find(e => e.id === fkValue);
        if (target && target.name) {
          return `${target.name} (${kindLabel})`;
        }
      }
    }
  }

  // Fallback: return the InfrastructurePoint's own name with the kind label
  return `${infrastructurePoint.name} (${kindLabel})`;
}

/**
 * Creates a display formatter function for InfrastructurePoint entities.
 * This formatter is compatible with the GridColumnConfig.displayFormatter signature.
 *
 * If the InfrastructurePoint id resolves to nothing (orphan reference), returns
 * "(missing)" rather than crashing — matches the degrade-gracefully convention
 * used by the picker component.
 *
 * @param entitiesProvider - Optional accessor returning MetaModelEntities for typed-FK lookups
 * @returns A display formatter function that takes an ID and entities array
 *          and returns a formatted display string
 */
export function createInfrastructurePointDisplayFormatter(
  entitiesProvider?: () => MetaModelEntities | undefined
): (id: string, entities: unknown[]) => string {
  return (id: string, entities: unknown[]): string => {
    // Return empty string for empty ID (common in new rows)
    if (!id) {
      return '';
    }

    const infrastructurePoints = entities as InfrastructurePoint[];
    const point = infrastructurePoints.find(e => e.id === id);

    if (!point) {
      return '(missing)';
    }

    const ents = entitiesProvider?.();
    return formatInfrastructurePointDisplay(point, ents);
  };
}

/**
 * Pre-configured display formatter for Infrastructure Points.
 * Can be used directly in grid configurations.
 *
 * Without an entities provider, this formatter cannot resolve the typed FK
 * target name, so it falls back to the InfrastructurePoint's own `name` plus
 * the kind label. The picker component (InfrastructurePointPickerCell) does
 * its own richer rendering via formatInfrastructurePointDisplay with the
 * full MetaModelEntities object available.
 */
export const infrastructurePointDisplayFormatter = createInfrastructurePointDisplayFormatter();

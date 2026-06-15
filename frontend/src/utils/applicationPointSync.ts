/**
 * Application Point Synchronization Utilities
 *
 * This module provides utilities for automatically synchronizing Application Points
 * with their source entities (Applications, App Components, Services).
 *
 * Application Points are now derived entities that maintain a one-to-one relationship
 * with source entities, hidden from users while preserving existing functionality.
 *
 * KEY DESIGN PRINCIPLE: `application_point.name` is a derived field.
 * The source entity name ALWAYS wins - AP names are never user-authored.
 */

import {
  ApplicationPoint,
  ApplicationPointKind,
  Application,
  ApplicationComponent,
  Service,
  MetaModel,
  MetaModelRelationships,
  MetaModelEntities,
  ENTITY_TYPES,
} from '../types/model';

// ========== TYPE DEFINITIONS ==========

/**
 * Source entity type for Application Point derivation
 */
export type SourceEntityType = 'applications' | 'app_components' | 'services';

/**
 * Source entity union type
 */
export type SourceEntity = Application | ApplicationComponent | Service;

/**
 * Minimal entity interface for Application Point creation
 * Supports passing partial entities with required fields
 */
export interface MinimalSourceEntity {
  id: string;
  name: string;
  application_id?: string;
}

/**
 * Result of resolving an entity to its Application Point
 */
export interface ResolvedApplicationPoint {
  entityType: string;
  entityId: string;
}

// ========== ID GENERATION ==========

/**
 * Generate a deterministic Application Point ID from a source entity ID
 * Uses pattern `ap_{source_entity_id}` for consistency across load/save cycles
 *
 * @param sourceEntityId - The ID of the source entity
 * @returns Deterministic Application Point ID
 */
export function generateApplicationPointId(sourceEntityId: string): string {
  return `ap_${sourceEntityId}`;
}

// ========== APPLICATION POINT CREATION ==========

/**
 * Map source entity type to ApplicationPointKind
 */
function getKindForSourceType(sourceType: SourceEntityType): ApplicationPointKind {
  switch (sourceType) {
    case 'applications':
      return 'APPLICATION';
    case 'app_components':
      return 'APP_COMPONENT';
    case 'services':
      return 'SERVICE';
    default:
      throw new Error(`Unknown source type: ${sourceType}`);
  }
}

/**
 * Safely get application_id from source entity
 * Works for both full SourceEntity types and MinimalSourceEntity
 */
function getApplicationId(sourceEntity: SourceEntity | MinimalSourceEntity): string {
  // Check if it's an ApplicationComponent (has application_id required)
  if ('application_id' in sourceEntity && sourceEntity.application_id) {
    return sourceEntity.application_id;
  }
  return '';
}

/**
 * Create an Application Point from a source entity.
 * Accepts either a full SourceEntity or a minimal entity with id, name, and optional application_id.
 *
 * Application/Component/Service name is the canonical source for Application Point name.
 * The Application Point name is copied directly from the source entity's name.
 *
 * @param sourceEntity - The source entity (Application, App Component, or Service) or minimal entity
 * @param sourceType - The type of source entity
 * @returns New ApplicationPoint with proper kind and foreign keys set
 */
export function createApplicationPointFromEntity(
  sourceEntity: SourceEntity | MinimalSourceEntity,
  sourceType: SourceEntityType
): ApplicationPoint {
  const id = generateApplicationPointId(sourceEntity.id);
  const kind = getKindForSourceType(sourceType);

  // Base Application Point with common fields
  // Application/Component/Service name is the canonical source for Application Point name
  const baseAP: ApplicationPoint = {
    id,
    name: sourceEntity.name, // Copy name from source entity - this is the canonical source
    description: '',
    kind,
    application_id: '',
    point_type: '', // Deprecated but kept for compatibility
    tags: '',
  };

  // Set foreign keys based on kind
  switch (kind) {
    case 'APPLICATION':
      return {
        ...baseAP,
        application_id: sourceEntity.id,
      };
    case 'APP_COMPONENT':
      return {
        ...baseAP,
        application_component_id: sourceEntity.id,
        // Also set application_id from the component's parent if available
        application_id: getApplicationId(sourceEntity),
      };
    case 'SERVICE':
      return {
        ...baseAP,
        service_id: sourceEntity.id,
        // Also set application_id from the service's parent if available
        application_id: getApplicationId(sourceEntity),
        // Discovery-service Service-rooted run flow (Fix #6a) and the derivation
        // pass (ensureDerivedApplicationPointForService) match by (target_type,
        // target_ref_id). Setting them here makes this AP serve both the legacy
        // ap_{id} convention AND the polymorphic tuple convention, so the
        // derivation pass finds it via tuple lookup and does not create a
        // duplicate AP.
        target_type: 'SERVICE',
        target_ref_id: sourceEntity.id,
      };
    default:
      return baseAP;
  }
}

// ========== APPLICATION POINT LOOKUP ==========

/**
 * Find the Application Point corresponding to a source entity
 * Uses deterministic ID pattern `ap_{entityId}` for lookup
 *
 * @param entityId - The ID of the source entity
 * @param applicationPoints - Array of Application Points to search
 * @returns The matching ApplicationPoint or undefined
 */
export function findApplicationPointForEntity(
  entityId: string,
  applicationPoints: ApplicationPoint[]
): ApplicationPoint | undefined {
  const expectedId = generateApplicationPointId(entityId);
  return applicationPoints.find(ap => ap.id === expectedId);
}

/**
 * Find the source entity for an Application Point based on its kind
 *
 * @param applicationPoint - The Application Point to resolve
 * @param entities - The MetaModelEntities containing all entities
 * @returns The source entity or undefined
 */
export function findSourceEntityForApplicationPoint(
  applicationPoint: ApplicationPoint,
  entities: MetaModelEntities
): SourceEntity | undefined {
  switch (applicationPoint.kind) {
    case 'APPLICATION':
      return entities.applications.find(a => a.id === applicationPoint.application_id);
    case 'APP_COMPONENT':
      return entities.app_components.find(ac => ac.id === applicationPoint.application_component_id);
    case 'SERVICE':
      return entities.services.find(s => s.id === applicationPoint.service_id);
    default:
      return undefined;
  }
}

// ========== APPLICATION POINT NAME SYNCHRONIZATION ==========

/**
 * Synchronize Application Point names with their source entities.
 *
 * KEY DESIGN PRINCIPLE: `application_point.name` is a derived field.
 * The source entity name ALWAYS wins.
 *
 * For each Application Point:
 * - Look up source entity based on `kind` field (APPLICATION, APP_COMPONENT, SERVICE)
 * - ALWAYS overwrite AP name with source entity name (source is canonical)
 * - Only preserve existing AP name if source entity name is empty/null
 *   (this prevents overwriting a valid AP name with an empty value)
 *
 * @param applicationPoints - Array of Application Points to sync
 * @param entities - The MetaModelEntities containing all source entities
 * @returns Updated array of Application Points with synchronized names
 */
export function syncApplicationPointNames(
  applicationPoints: ApplicationPoint[],
  entities: MetaModelEntities
): ApplicationPoint[] {
  return applicationPoints.map(ap => {
    // Find the source entity for this Application Point
    const sourceEntity = findSourceEntityForApplicationPoint(ap, entities);

    // If no source entity found, preserve existing Application Point
    // (orphan cleanup happens separately)
    if (!sourceEntity) {
      return ap;
    }

    // If source entity name is empty/null/undefined, preserve existing AP name
    // This prevents overwriting a valid AP name with an empty value
    if (!sourceEntity.name) {
      return ap;
    }

    // ALWAYS overwrite AP name with source entity name
    // Source entity name is the canonical source - AP name is derived
    // This ensures stale/different AP names are corrected on load
    if (ap.name !== sourceEntity.name) {
      return {
        ...ap,
        name: sourceEntity.name,
      };
    }

    // Names already match, no update needed
    return ap;
  });
}

/**
 * Force-update an existing Application Point's name from its source entity.
 * Used during reconciliation to ensure existing APs have correct names.
 *
 * @param existingAP - The existing Application Point to update
 * @param sourceEntity - The source entity (Application, App Component, or Service)
 * @returns Updated ApplicationPoint with name from source entity
 */
function forceUpdateApplicationPointName(
  existingAP: ApplicationPoint,
  sourceEntity: SourceEntity | MinimalSourceEntity
): ApplicationPoint {
  // If source entity has a name, always use it (source is canonical)
  // Only preserve existing AP name if source entity name is empty
  if (sourceEntity.name) {
    return {
      ...existingAP,
      name: sourceEntity.name,
    };
  }
  return existingAP;
}

/**
 * Force-reconcile an existing Application Point's name and FK fields from its source entity.
 * Used during reconciliation to ensure existing APs have correct names AND foreign keys.
 *
 * @param existingAP - The existing Application Point to update
 * @param sourceEntity - The source entity (Application, App Component, or Service)
 * @param kind - The ApplicationPointKind
 * @returns Updated ApplicationPoint with name and FK fields from source entity
 */
function forceReconcileApplicationPoint(
  existingAP: ApplicationPoint,
  sourceEntity: SourceEntity | MinimalSourceEntity,
  kind: ApplicationPointKind
): ApplicationPoint {
  // Start with name update
  let updated = forceUpdateApplicationPointName(existingAP, sourceEntity);

  // Update FK fields based on kind
  if (kind === 'APPLICATION') {
    updated = {
      ...updated,
      application_id: sourceEntity.id,
    };
  } else if (kind === 'APP_COMPONENT') {
    // For APP_COMPONENT, we need both application_component_id AND application_id
    const component = sourceEntity as ApplicationComponent;
    updated = {
      ...updated,
      application_component_id: sourceEntity.id,
      application_id: component.application_id || '',
    };
  } else if (kind === 'SERVICE') {
    // For SERVICE, we need both service_id AND application_id, plus the
    // polymorphic tuple (target_type, target_ref_id) that the derivation pass
    // and the discovery-service Service-rooted run flow rely on. Without
    // these, ensureDerivedApplicationPointForService creates a SECOND AP and
    // syncApplicationPointNames then unifies their names, tripping the
    // duplicate-name validator on save.
    const service = sourceEntity as Service;
    updated = {
      ...updated,
      service_id: sourceEntity.id,
      application_id: service.application_id || '',
      target_type: 'SERVICE',
      target_ref_id: sourceEntity.id,
    };
  }

  return updated;
}

// ========== EDIT-TIME SYNCHRONIZATION ==========

/**
 * Synchronize Application Point name for a specific source entity during edit operations.
 *
 * KEY DESIGN PRINCIPLE: `application_point.name` is a derived field.
 * Source entity name ALWAYS wins. Sync must happen immediately on edit.
 *
 * This function is called from the reducer's UPDATE_ENTITY case when:
 * - entityType is 'applications', 'app_components', or 'services'
 * - The entity's name field has changed
 *
 * Behavior:
 * - If AP exists, update its name to match the new entity name
 * - If AP does NOT exist, create it with the new name
 * - Returns the updated application_points array
 *
 * @param entities - Current MetaModelEntities (before the entity update is applied)
 * @param entityType - The type of entity being updated ('applications', 'app_components', 'services')
 * @param entityId - The ID of the entity being updated
 * @param newName - The new name for the entity
 * @returns Updated application_points array with the AP name synchronized
 */
export function syncApplicationPointNameForEntity(
  entities: MetaModelEntities,
  entityType: SourceEntityType,
  entityId: string,
  newName: string
): ApplicationPoint[] {
  const applicationPoints = [...entities.application_points];

  // Find the corresponding Application Point
  const existingAP = findApplicationPointForEntity(entityId, applicationPoints);

  if (existingAP) {
    // AP exists - update its name
    return applicationPoints.map(ap => {
      if (ap.id === existingAP.id) {
        return {
          ...ap,
          name: newName,
        };
      }
      return ap;
    });
  } else {
    // AP does NOT exist - create it
    // We need to get the source entity to create the AP with proper foreign keys
    // Since we're in an edit operation, the entity exists in the entities collection
    let sourceEntity: MinimalSourceEntity | undefined;

    switch (entityType) {
      case 'applications': {
        const app = entities.applications.find(a => a.id === entityId);
        if (app) {
          sourceEntity = { id: app.id, name: newName };
        }
        break;
      }
      case 'app_components': {
        const comp = entities.app_components.find(c => c.id === entityId);
        if (comp) {
          sourceEntity = { id: comp.id, name: newName, application_id: comp.application_id };
        }
        break;
      }
      case 'services': {
        const svc = entities.services.find(s => s.id === entityId);
        if (svc) {
          sourceEntity = { id: svc.id, name: newName, application_id: svc.application_id };
        }
        break;
      }
    }

    if (sourceEntity) {
      const newAP = createApplicationPointFromEntity(sourceEntity, entityType);
      return [...applicationPoints, newAP];
    }

    // Source entity not found (shouldn't happen in normal flow)
    // Return unchanged application_points
    return applicationPoints;
  }
}

// ========== ORPHAN DETECTION ==========

/**
 * Get Application Points that do not map to any existing source entity
 * These are orphans that should be cleaned up during reconciliation
 *
 * @param applicationPoints - All Application Points
 * @param applications - All Applications
 * @param appComponents - All App Components
 * @param services - All Services
 * @returns Array of orphaned Application Points
 */
export function getOrphanedApplicationPoints(
  applicationPoints: ApplicationPoint[],
  applications: Application[],
  appComponents: ApplicationComponent[],
  services: Service[]
): ApplicationPoint[] {
  const applicationIds = new Set(applications.map(a => a.id));
  const componentIds = new Set(appComponents.map(ac => ac.id));
  const serviceIds = new Set(services.map(s => s.id));

  return applicationPoints.filter(ap => {
    switch (ap.kind) {
      case 'APPLICATION':
        return !applicationIds.has(ap.application_id);
      case 'APP_COMPONENT':
        return !ap.application_component_id || !componentIds.has(ap.application_component_id);
      case 'SERVICE':
        return !ap.service_id || !serviceIds.has(ap.service_id);
      default:
        // Unknown kind - consider orphaned
        return true;
    }
  });
}

// ========== CASCADE DELETION ==========

/**
 * Result of cascade deletion containing updated relationships
 */
export interface CascadeDeleteResult {
  relationships: MetaModelRelationships;
}

/**
 * Cascade delete an Application Point and its related records
 * Removes:
 * - application_point_business_points referencing the AP
 * - data_movements where source or target matches the AP
 *
 * @param applicationPointId - ID of the Application Point to delete
 * @param relationships - Current MetaModelRelationships
 * @returns Updated relationships with cascade deletions applied
 */
export function cascadeDeleteApplicationPoint(
  applicationPointId: string,
  relationships: MetaModelRelationships
): MetaModelRelationships {
  return {
    ...relationships,
    // Filter out application_point_business_points referencing deleted AP
    application_point_business_points: relationships.application_point_business_points.filter(
      apbp => apbp.application_point_id !== applicationPointId
    ),
    // Note: data_movements use source_application_point_id/target_application_point_id
    // Filter out data movements referencing deleted AP
    data_movements: relationships.data_movements.filter(
      dm => dm.source_application_point_id !== applicationPointId &&
            dm.target_application_point_id !== applicationPointId
    ),
    // Other relationships unchanged
    business_user_business_points: relationships.business_user_business_points,
    logical_data_entity_relationships: relationships.logical_data_entity_relationships,
    logical_data_entity_physical_data_entities: relationships.logical_data_entity_physical_data_entities,
    logical_data_attribute_physical_data_attributes: relationships.logical_data_attribute_physical_data_attributes,
    interface_logical_entities: relationships.interface_logical_entities,
  };
}

// ========== COMPREHENSIVE CASCADE DELETE FUNCTIONS (Task Group 3) ==========

/**
 * Cascade delete a BusinessUser and its related records
 * Removes:
 * - business_user_business_points where business_user_id matches
 *
 * @param businessUserId - ID of the BusinessUser to delete
 * @param relationships - Current MetaModelRelationships
 * @returns Updated relationships with cascade deletions applied
 */
export function cascadeDeleteBusinessUser(
  businessUserId: string,
  relationships: MetaModelRelationships
): MetaModelRelationships {
  return {
    ...relationships,
    // Filter out business_user_business_points referencing deleted BusinessUser
    business_user_business_points: relationships.business_user_business_points.filter(
      bubp => bubp.business_user_id !== businessUserId
    ),
    // Other relationships unchanged
    application_point_business_points: relationships.application_point_business_points,
    logical_data_entity_relationships: relationships.logical_data_entity_relationships,
    logical_data_entity_physical_data_entities: relationships.logical_data_entity_physical_data_entities,
    logical_data_attribute_physical_data_attributes: relationships.logical_data_attribute_physical_data_attributes,
    data_movements: relationships.data_movements,
    interface_logical_entities: relationships.interface_logical_entities,
  };
}

/**
 * Cascade delete a BusinessProcess and its related records
 * Note: Business Point relationships are handled via cascadeDeleteForBusinessSourceEntity
 * in businessPointSync.ts. This function is kept for any remaining cleanup.
 *
 * @param businessProcessId - ID of the BusinessProcess to delete
 * @param relationships - Current MetaModelRelationships
 * @returns Updated relationships with cascade deletions applied
 */
export function cascadeDeleteBusinessProcess(
  _businessProcessId: string,
  relationships: MetaModelRelationships
): MetaModelRelationships {
  // Note: Business Point-based relationships are now the primary mechanism.
  // The cascadeDeleteForBusinessSourceEntity in businessPointSync.ts handles
  // the deletion of business_user_business_points and application_point_business_points
  // via the Business Point that corresponds to this Business Process.
  // This function is kept for backward compatibility but may be a no-op.
  return {
    ...relationships,
    // All relationship arrays unchanged - cascade is handled via Business Point
    business_user_business_points: relationships.business_user_business_points,
    application_point_business_points: relationships.application_point_business_points,
    logical_data_entity_relationships: relationships.logical_data_entity_relationships,
    logical_data_entity_physical_data_entities: relationships.logical_data_entity_physical_data_entities,
    logical_data_attribute_physical_data_attributes: relationships.logical_data_attribute_physical_data_attributes,
    data_movements: relationships.data_movements,
    interface_logical_entities: relationships.interface_logical_entities,
  };
}

/**
 * Cascade delete a LogicalDataEntity and its related records
 * Removes:
 * - logical_data_entity_relationships where from_ref_id OR to_ref_id matches
 *   (Logical ER Meta-Model Upgrade: from_ref_id was source_entity_id, to_ref_id was target_entity_id)
 * - logical_data_entity_physical_data_entities where logical_entity_id matches
 * - data_movements where data_entity_id matches
 * - interface_logical_entities where logical_entity_id matches
 *
 * @param logicalEntityId - ID of the LogicalDataEntity to delete
 * @param relationships - Current MetaModelRelationships
 * @returns Updated relationships with cascade deletions applied
 */
export function cascadeDeleteLogicalDataEntity(
  logicalEntityId: string,
  relationships: MetaModelRelationships
): MetaModelRelationships {
  // Rows that reference data entities now carry Data Entity Point IDs
  // (dep_log_<entityId> / dep_phy_<entityId>) instead of the legacy raw-id
  // fields (from_ref_id/to_ref_id, data_entity_id, logical_entity_id). The
  // legacy-field filters silently matched nothing after that migration,
  // leaving dangling rows behind on delete - so match the point id.
  const pointId = `dep_log_${logicalEntityId}`;
  return {
    ...relationships,
    // Filter out logical_data_entity_relationships where entity is source OR target
    logical_data_entity_relationships: relationships.logical_data_entity_relationships.filter(
      lder => lder.fromDataEntityPointId !== pointId && lder.toDataEntityPointId !== pointId
    ),
    // Filter out logical_data_entity_physical_data_entities referencing deleted LogicalDataEntity
    logical_data_entity_physical_data_entities: relationships.logical_data_entity_physical_data_entities.filter(
      ldepde => ldepde.logical_entity_id !== logicalEntityId
    ),
    // Filter out data_movements whose data entity point references the deleted entity
    data_movements: relationships.data_movements.filter(
      dm => dm.dataEntityPointId !== pointId
    ),
    // Filter out interface_logical_entities referencing deleted LogicalDataEntity
    interface_logical_entities: relationships.interface_logical_entities.filter(
      ile => ile.dataEntityPointId !== pointId
    ),
    // Other relationships unchanged
    business_user_business_points: relationships.business_user_business_points,
    application_point_business_points: relationships.application_point_business_points,
    logical_data_attribute_physical_data_attributes: relationships.logical_data_attribute_physical_data_attributes,
  };
}

/**
 * Cascade delete a PhysicalDataEntity and its related records
 * Removes:
 * - logical_data_entity_physical_data_entities where physical_entity_id matches
 *
 * @param physicalEntityId - ID of the PhysicalDataEntity to delete
 * @param relationships - Current MetaModelRelationships
 * @returns Updated relationships with cascade deletions applied
 */
export function cascadeDeletePhysicalDataEntity(
  physicalEntityId: string,
  relationships: MetaModelRelationships
): MetaModelRelationships {
  // Logical ER rows, data movements and interface schema rows can all
  // reference PHYSICAL entities via dep_phy_<entityId> point ids - clean
  // those up too (mirror of cascadeDeleteLogicalDataEntity).
  const pointId = `dep_phy_${physicalEntityId}`;
  return {
    ...relationships,
    // Filter out logical_data_entity_physical_data_entities referencing deleted PhysicalDataEntity
    logical_data_entity_physical_data_entities: relationships.logical_data_entity_physical_data_entities.filter(
      ldepde => ldepde.physical_entity_id !== physicalEntityId
    ),
    // Filter out logical_data_entity_relationships where the deleted physical
    // entity is either endpoint (ER rows support dep_phy_ endpoints)
    logical_data_entity_relationships: relationships.logical_data_entity_relationships.filter(
      lder => lder.fromDataEntityPointId !== pointId && lder.toDataEntityPointId !== pointId
    ),
    // Filter out data_movements whose data entity point references the deleted entity
    data_movements: relationships.data_movements.filter(
      dm => dm.dataEntityPointId !== pointId
    ),
    // Filter out interface_logical_entities referencing the deleted entity
    interface_logical_entities: relationships.interface_logical_entities.filter(
      ile => ile.dataEntityPointId !== pointId
    ),
    // Other relationships unchanged
    business_user_business_points: relationships.business_user_business_points,
    application_point_business_points: relationships.application_point_business_points,
    logical_data_attribute_physical_data_attributes: relationships.logical_data_attribute_physical_data_attributes,
  };
}

/**
 * Cascade delete a LogicalDataAttribute and its related records
 * Removes:
 * - logical_data_attribute_physical_data_attributes where logical_attribute_id matches
 *
 * @param logicalAttributeId - ID of the LogicalDataAttribute to delete
 * @param relationships - Current MetaModelRelationships
 * @returns Updated relationships with cascade deletions applied
 */
export function cascadeDeleteLogicalDataAttribute(
  logicalAttributeId: string,
  relationships: MetaModelRelationships
): MetaModelRelationships {
  return {
    ...relationships,
    // Filter out logical_data_attribute_physical_data_attributes referencing deleted LogicalDataAttribute
    logical_data_attribute_physical_data_attributes: relationships.logical_data_attribute_physical_data_attributes.filter(
      ldapda => ldapda.logical_attribute_id !== logicalAttributeId
    ),
    // Other relationships unchanged
    business_user_business_points: relationships.business_user_business_points,
    application_point_business_points: relationships.application_point_business_points,
    logical_data_entity_relationships: relationships.logical_data_entity_relationships,
    logical_data_entity_physical_data_entities: relationships.logical_data_entity_physical_data_entities,
    data_movements: relationships.data_movements,
    interface_logical_entities: relationships.interface_logical_entities,
  };
}

/**
 * Cascade delete a PhysicalDataAttribute and its related records
 * Removes:
 * - logical_data_attribute_physical_data_attributes where physical_attribute_id matches
 *
 * @param physicalAttributeId - ID of the PhysicalDataAttribute to delete
 * @param relationships - Current MetaModelRelationships
 * @returns Updated relationships with cascade deletions applied
 */
export function cascadeDeletePhysicalDataAttribute(
  physicalAttributeId: string,
  relationships: MetaModelRelationships
): MetaModelRelationships {
  return {
    ...relationships,
    // Filter out logical_data_attribute_physical_data_attributes referencing deleted PhysicalDataAttribute
    logical_data_attribute_physical_data_attributes: relationships.logical_data_attribute_physical_data_attributes.filter(
      ldapda => ldapda.physical_attribute_id !== physicalAttributeId
    ),
    // Other relationships unchanged
    business_user_business_points: relationships.business_user_business_points,
    application_point_business_points: relationships.application_point_business_points,
    logical_data_entity_relationships: relationships.logical_data_entity_relationships,
    logical_data_entity_physical_data_entities: relationships.logical_data_entity_physical_data_entities,
    data_movements: relationships.data_movements,
    interface_logical_entities: relationships.interface_logical_entities,
  };
}

// ========== Task Group 4: INTERFACE CASCADE DELETE ==========

/**
 * Result of cascade deletion for Interface entity
 * Includes both entities and relationships updates
 */
export interface InterfaceCascadeResult {
  entities: MetaModelEntities;
  relationships: MetaModelRelationships;
}

/**
 * Cascade delete an Interface and its related records
 * Removes:
 * - endpoints where interface_id matches (child entities)
 * - interface_logical_entities where interface_id matches (relationship records)
 *
 * @param interfaceId - ID of the Interface to delete
 * @param entities - Current MetaModelEntities
 * @param relationships - Current MetaModelRelationships
 * @returns Updated entities and relationships with cascade deletions applied
 */
export function cascadeDeleteInterface(
  interfaceId: string,
  entities: MetaModelEntities,
  relationships: MetaModelRelationships
): InterfaceCascadeResult {
  // Filter out endpoints that belong to this interface
  const updatedEndpoints = entities.endpoints.filter(
    ep => ep.interface_id !== interfaceId
  );

  // Filter out interface_logical_entities referencing this interface
  const updatedInterfaceLogicalEntities = relationships.interface_logical_entities.filter(
    ile => ile.interface_id !== interfaceId
  );

  return {
    entities: {
      ...entities,
      endpoints: updatedEndpoints,
    },
    relationships: {
      ...relationships,
      interface_logical_entities: updatedInterfaceLogicalEntities,
    },
  };
}

/**
 * Result of cascade deletion for source entity
 */
export interface SourceEntityCascadeResult {
  entities: MetaModelEntities;
  relationships: MetaModelRelationships;
}

/**
 * Cascade delete for a source entity (Application, App Component, Service)
 * Finds corresponding Application Point and removes it along with related records
 *
 * @param entityId - ID of the source entity being deleted
 * @param _entityType - Type of source entity ('applications', 'app_components', 'services') - used for type checking
 * @param entities - Current MetaModelEntities
 * @param relationships - Current MetaModelRelationships
 * @returns Updated entities and relationships
 */
export function cascadeDeleteForSourceEntity(
  entityId: string,
  _entityType: SourceEntityType,
  entities: MetaModelEntities,
  relationships: MetaModelRelationships
): SourceEntityCascadeResult {
  // Find corresponding Application Point
  const ap = findApplicationPointForEntity(entityId, entities.application_points);

  if (!ap) {
    // No AP found - return unchanged
    return { entities, relationships };
  }

  // Cascade delete the Application Point relationships
  const updatedRelationships = cascadeDeleteApplicationPoint(ap.id, relationships);

  // Remove the Application Point from entities
  const updatedEntities: MetaModelEntities = {
    ...entities,
    application_points: entities.application_points.filter(p => p.id !== ap.id),
  };

  return {
    entities: updatedEntities,
    relationships: updatedRelationships,
  };
}

// ========== JSON LOAD RECONCILIATION ==========

/**
 * Reconcile Application Points after loading a JSON model
 *
 * KEY DESIGN PRINCIPLE: `application_point.name` is a derived field.
 * The source entity name ALWAYS wins.
 *
 * Steps:
 * 1-3. For each source entity (Application, App Component, Service):
 *      - If AP is missing, create it with name from source entity
 *      - If AP exists, FORCE-UPDATE its name AND FK fields from source entity (source is canonical)
 * 4.   Run full name sync pass to catch any edge cases
 * 5.   Remove orphaned APs that don't map to any source entity
 *
 * Post-reconciliation guarantee:
 * - Every Application Point has the same name as its source entity
 * - Every Application Point has correct FK fields from its source entity
 * - No orphaned Application Points exist
 *
 * @param metaModel - The loaded MetaModel to reconcile
 * @returns Reconciled MetaModel with synced Application Points
 */
export function reconcileApplicationPoints(metaModel: MetaModel): MetaModel {
  const { entities, relationships } = metaModel;
  let applicationPoints = [...entities.application_points];
  let updatedRelationships = { ...relationships };

  // Build a map for efficient AP lookup and update
  const apMap = new Map<string, ApplicationPoint>();
  for (const ap of applicationPoints) {
    apMap.set(ap.id, ap);
  }

  // Step 1: Process Applications - create missing APs or update existing ones
  for (const app of entities.applications) {
    const expectedId = generateApplicationPointId(app.id);
    const existingAP = apMap.get(expectedId);

    if (!existingAP) {
      // Create missing AP
      console.warn(`Creating missing ApplicationPoint for Application ${app.id}`);
      const newAP = createApplicationPointFromEntity(app, 'applications');
      apMap.set(newAP.id, newAP);
    } else {
      // AP exists - FORCE UPDATE name and FK fields from source entity
      const updatedAP = forceReconcileApplicationPoint(existingAP, app, 'APPLICATION');
      apMap.set(expectedId, updatedAP);
    }
  }

  // Step 2: Process App Components - create missing APs or update existing ones
  for (const comp of entities.app_components) {
    const expectedId = generateApplicationPointId(comp.id);
    const existingAP = apMap.get(expectedId);

    if (!existingAP) {
      // Create missing AP
      console.warn(`Creating missing ApplicationPoint for App Component ${comp.id}`);
      const newAP = createApplicationPointFromEntity(comp, 'app_components');
      apMap.set(newAP.id, newAP);
    } else {
      // AP exists - FORCE UPDATE name and FK fields from source entity
      const updatedAP = forceReconcileApplicationPoint(existingAP, comp, 'APP_COMPONENT');
      apMap.set(expectedId, updatedAP);
    }
  }

  // Step 3: Process Services - create missing APs or update existing ones
  for (const service of entities.services) {
    const expectedId = generateApplicationPointId(service.id);
    const existingAP = apMap.get(expectedId);

    if (!existingAP) {
      // Create missing AP
      console.warn(`Creating missing ApplicationPoint for Service ${service.id}`);
      const newAP = createApplicationPointFromEntity(service, 'services');
      apMap.set(newAP.id, newAP);
    } else {
      // AP exists - FORCE UPDATE name and FK fields from source entity
      const updatedAP = forceReconcileApplicationPoint(existingAP, service, 'SERVICE');
      apMap.set(expectedId, updatedAP);
    }
  }

  // Convert map back to array
  applicationPoints = Array.from(apMap.values());

  // Step 4: Run full name sync pass to catch any edge cases
  // This ensures all Application Points have up-to-date names from their source entities
  // Source entity name is the canonical source for Application Point name
  const entitiesForSync: MetaModelEntities = {
    ...entities,
    application_points: applicationPoints,
  };
  applicationPoints = syncApplicationPointNames(applicationPoints, entitiesForSync);

  // Step 5: Remove orphaned APs (after name sync to avoid processing orphans)
  const orphans = getOrphanedApplicationPoints(
    applicationPoints,
    entities.applications,
    entities.app_components,
    entities.services
  );

  for (const orphan of orphans) {
    console.warn(`Removing orphaned ApplicationPoint ${orphan.id}`);
    // Cascade delete relationships for orphan
    updatedRelationships = cascadeDeleteApplicationPoint(orphan.id, updatedRelationships);
  }

  // Filter out orphans from application points
  const orphanIds = new Set(orphans.map(o => o.id));
  applicationPoints = applicationPoints.filter(ap => !orphanIds.has(ap.id));

  return {
    entities: {
      ...entities,
      application_points: applicationPoints,
    },
    relationships: updatedRelationships,
  };
}

// ========== PALETTE-TO-DIAGRAM MAPPING ==========

/**
 * Resolve an entity to its corresponding Application Point for diagram node creation
 * For Applications, App Components, and Services, returns the AP info
 * For other entity types, returns original values unchanged
 *
 * @param diagramEntityType - The entity type (e.g., 'APPLICATION', 'APP_COMPONENT', 'SERVICE')
 * @param entityId - The entity ID
 * @param applicationPoints - Array of Application Points
 * @returns Resolved entity type and ID for node creation
 */
export function resolveToApplicationPoint(
  diagramEntityType: string,
  entityId: string,
  applicationPoints: ApplicationPoint[]
): ResolvedApplicationPoint {
  // Check if this is a type that should be resolved to AP
  const shouldResolve =
    diagramEntityType === ENTITY_TYPES.APPLICATION ||
    diagramEntityType === ENTITY_TYPES.APP_COMPONENT ||
    diagramEntityType === ENTITY_TYPES.SERVICE;

  if (!shouldResolve) {
    return { entityType: diagramEntityType, entityId };
  }

  // Look up the corresponding Application Point
  const ap = findApplicationPointForEntity(entityId, applicationPoints);

  if (ap) {
    return {
      entityType: ENTITY_TYPES.APPLICATION_POINT,
      entityId: ap.id,
    };
  }

  // Fallback: return original if no AP found (shouldn't happen in normal flow)
  console.warn(`No ApplicationPoint found for ${diagramEntityType} ${entityId}`);
  return { entityType: diagramEntityType, entityId };
}

/**
 * Check if a source entity type requires Application Point resolution
 *
 * @param sectionId - The palette section ID
 * @returns True if the section represents a source entity type
 */
export function isSourceEntitySection(sectionId: string): boolean {
  return sectionId === 'applications' ||
         sectionId === 'app_components' ||
         sectionId === 'services';
}

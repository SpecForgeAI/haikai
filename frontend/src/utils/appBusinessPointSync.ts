/**
 * App Business Point Synchronization Utilities
 *
 * This module provides utilities for automatically synchronizing App Business Points
 * with their source entities (Applications, App Components, Services, Interfaces,
 * Business Processes, Process Activities).
 *
 * App Business Points are indirect/lookup entities that maintain a one-to-one relationship
 * with source entities. They are auto-created and synced, hidden from users while
 * providing a unified target for Interaction FK references.
 *
 * KEY DESIGN PRINCIPLE: `app_business_point.name` is a derived field.
 * The source entity name ALWAYS wins - ABP names are never user-authored.
 */

import {
  AppBusinessPoint,
  AppBusinessPointKind,
  Application,
  ApplicationComponent,
  Service,
  Interface,
  BusinessProcess,
  ProcessActivity,
  MetaModel,
  MetaModelRelationships,
  MetaModelEntities,
  AnyEntity,
} from '../types/model';

// ========== TYPE DEFINITIONS ==========

/**
 * Source entity type for App Business Point derivation
 * Maps collection key to ABP kind
 */
export type ABPSourceEntityType =
  | 'applications'
  | 'app_components'
  | 'services'
  | 'interfaces'
  | 'business_processes'
  | 'process_activities';

/**
 * Source entity union type
 */
export type ABPSourceEntity =
  | Application
  | ApplicationComponent
  | Service
  | Interface
  | BusinessProcess
  | ProcessActivity;

/**
 * Minimal entity interface for ABP creation
 * Supports passing partial entities with required fields
 */
export interface MinimalABPSourceEntity {
  id: string;
  name: string;
}

// ========== ID GENERATION ==========

/**
 * Generate a deterministic App Business Point ID from a source entity ID
 * Uses pattern `abp_{source_entity_id}` for consistency across load/save cycles
 *
 * @param sourceEntityId - The ID of the source entity
 * @returns Deterministic App Business Point ID
 */
export function generateAppBusinessPointId(sourceEntityId: string): string {
  return `abp_${sourceEntityId}`;
}

// ========== APP BUSINESS POINT CREATION ==========

/**
 * Map source entity collection key to AppBusinessPointKind
 */
function getKindForSourceType(sourceType: ABPSourceEntityType): AppBusinessPointKind {
  switch (sourceType) {
    case 'applications':
      return 'APPLICATION';
    case 'app_components':
      return 'APP_COMPONENT';
    case 'services':
      return 'SERVICE';
    case 'interfaces':
      return 'INTERFACE';
    case 'business_processes':
      return 'BUSINESS_PROCESS';
    case 'process_activities':
      return 'PROCESS_ACTIVITY';
    default:
      throw new Error(`Unknown source type: ${sourceType}`);
  }
}

/**
 * Create an App Business Point from a source entity.
 * Accepts either a full source entity or a minimal entity with id and name.
 *
 * Source entity name is the canonical source for ABP name.
 * The ABP name is copied directly from the source entity's name.
 *
 * @param sourceEntity - The source entity or minimal entity
 * @param sourceType - The type of source entity (collection key)
 * @returns New AppBusinessPoint with proper kind and source_entity_id set
 */
export function createAppBusinessPointFromEntity(
  sourceEntity: ABPSourceEntity | MinimalABPSourceEntity,
  sourceType: ABPSourceEntityType
): AppBusinessPoint {
  const id = generateAppBusinessPointId(sourceEntity.id);
  const kind = getKindForSourceType(sourceType);

  return {
    id,
    name: sourceEntity.name, // Copy name from source entity - this is the canonical source
    kind,
    source_entity_id: sourceEntity.id,
  };
}

// ========== APP BUSINESS POINT LOOKUP ==========

/**
 * Find the App Business Point corresponding to a source entity
 * Uses deterministic ID pattern `abp_{entityId}` for lookup
 *
 * @param entityId - The ID of the source entity
 * @param appBusinessPoints - Array of App Business Points to search
 * @returns The matching AppBusinessPoint or undefined
 */
export function findAppBusinessPointForEntity(
  entityId: string,
  appBusinessPoints: AppBusinessPoint[]
): AppBusinessPoint | undefined {
  const expectedId = generateAppBusinessPointId(entityId);
  return appBusinessPoints.find(abp => abp.id === expectedId);
}

/**
 * Find the source entity for an App Business Point based on its kind
 *
 * @param appBusinessPoint - The App Business Point to resolve
 * @param entities - The MetaModelEntities containing all entities
 * @returns The source entity or undefined
 */
export function findSourceEntityForAppBusinessPoint(
  appBusinessPoint: AppBusinessPoint,
  entities: MetaModelEntities
): ABPSourceEntity | undefined {
  const sourceId = appBusinessPoint.source_entity_id;

  switch (appBusinessPoint.kind) {
    case 'APPLICATION':
      return entities.applications.find(e => e.id === sourceId);
    case 'APP_COMPONENT':
      return entities.app_components.find(e => e.id === sourceId);
    case 'SERVICE':
      return entities.services.find(e => e.id === sourceId);
    case 'INTERFACE':
      return entities.interfaces.find(e => e.id === sourceId);
    case 'BUSINESS_PROCESS':
      return entities.business_processes.find(e => e.id === sourceId);
    case 'PROCESS_ACTIVITY':
      return entities.process_activities.find(e => e.id === sourceId);
    default:
      return undefined;
  }
}

// ========== APP BUSINESS POINT NAME SYNCHRONIZATION ==========

/**
 * Synchronize App Business Point names with their source entities.
 *
 * KEY DESIGN PRINCIPLE: `app_business_point.name` is a derived field.
 * The source entity name ALWAYS wins.
 *
 * For each App Business Point:
 * - Look up source entity based on `kind` field and `source_entity_id`
 * - ALWAYS overwrite ABP name with source entity name (source is canonical)
 * - Only preserve existing ABP name if source entity name is empty/null
 *   (this prevents overwriting a valid ABP name with an empty value)
 *
 * @param appBusinessPoints - Array of App Business Points to sync
 * @param entities - The MetaModelEntities containing all source entities
 * @returns Updated array of App Business Points with synchronized names
 */
export function syncAppBusinessPointNames(
  appBusinessPoints: AppBusinessPoint[],
  entities: MetaModelEntities
): AppBusinessPoint[] {
  return appBusinessPoints.map(abp => {
    // Find the source entity for this App Business Point
    const sourceEntity = findSourceEntityForAppBusinessPoint(abp, entities);

    // If no source entity found, preserve existing App Business Point
    // (orphan cleanup happens separately)
    if (!sourceEntity) {
      return abp;
    }

    // If source entity name is empty/null/undefined, preserve existing ABP name
    // This prevents overwriting a valid ABP name with an empty value
    if (!sourceEntity.name) {
      return abp;
    }

    // ALWAYS overwrite ABP name with source entity name
    // Source entity name is the canonical source - ABP name is derived
    // This ensures stale/different ABP names are corrected on load
    if (abp.name !== sourceEntity.name) {
      return {
        ...abp,
        name: sourceEntity.name,
      };
    }

    // Names already match, no update needed
    return abp;
  });
}

/**
 * Force-update an existing App Business Point's name from its source entity.
 * Used during reconciliation to ensure existing ABPs have correct names.
 *
 * @param existingABP - The existing App Business Point to update
 * @param sourceEntity - The source entity
 * @returns Updated AppBusinessPoint with name from source entity
 */
function forceUpdateAppBusinessPointName(
  existingABP: AppBusinessPoint,
  sourceEntity: ABPSourceEntity | MinimalABPSourceEntity
): AppBusinessPoint {
  // If source entity has a name, always use it (source is canonical)
  // Only preserve existing ABP name if source entity name is empty
  if (sourceEntity.name) {
    return {
      ...existingABP,
      name: sourceEntity.name,
    };
  }
  return existingABP;
}

// ========== EDIT-TIME SYNCHRONIZATION ==========

/**
 * Synchronize App Business Point name for a specific source entity during edit operations.
 *
 * KEY DESIGN PRINCIPLE: `app_business_point.name` is a derived field.
 * Source entity name ALWAYS wins. Sync must happen immediately on edit.
 *
 * This function is called from the reducer's UPDATE_ENTITY case when:
 * - entityType is one of the 6 ABP source types
 * - The entity's name field has changed
 *
 * Behavior:
 * - If ABP exists, update its name to match the new entity name
 * - If ABP does NOT exist, create it with the new name
 * - Returns the updated app_business_points array
 *
 * @param entities - Current MetaModelEntities (before the entity update is applied)
 * @param entityType - The type of entity being updated
 * @param entityId - The ID of the entity being updated
 * @param newName - The new name for the entity
 * @returns Updated app_business_points array with the ABP name synchronized
 */
export function syncAppBusinessPointNameForEntity(
  entities: MetaModelEntities,
  entityType: ABPSourceEntityType,
  entityId: string,
  newName: string
): AppBusinessPoint[] {
  const appBusinessPoints = [...(entities.app_business_points || [])];

  // Find the corresponding App Business Point
  const existingABP = findAppBusinessPointForEntity(entityId, appBusinessPoints);

  if (existingABP) {
    // ABP exists - update its name
    return appBusinessPoints.map(abp => {
      if (abp.id === existingABP.id) {
        return {
          ...abp,
          name: newName,
        };
      }
      return abp;
    });
  } else {
    // ABP does NOT exist - create it
    const sourceEntity: MinimalABPSourceEntity = { id: entityId, name: newName };
    const newABP = createAppBusinessPointFromEntity(sourceEntity, entityType);
    return [...appBusinessPoints, newABP];
  }
}

// ========== ORPHAN DETECTION ==========

/**
 * Get App Business Points that do not map to any existing source entity
 * These are orphans that should be cleaned up during reconciliation
 *
 * @param appBusinessPoints - All App Business Points
 * @param entities - The MetaModelEntities containing all source entities
 * @returns Array of orphaned App Business Points
 */
export function getOrphanedAppBusinessPoints(
  appBusinessPoints: AppBusinessPoint[],
  entities: MetaModelEntities
): AppBusinessPoint[] {
  const applicationIds = new Set(entities.applications.map(e => e.id));
  const componentIds = new Set(entities.app_components.map(e => e.id));
  const serviceIds = new Set(entities.services.map(e => e.id));
  const interfaceIds = new Set(entities.interfaces.map(e => e.id));
  const processIds = new Set(entities.business_processes.map(e => e.id));
  const activityIds = new Set(entities.process_activities.map(e => e.id));

  return appBusinessPoints.filter(abp => {
    const sourceId = abp.source_entity_id;
    switch (abp.kind) {
      case 'APPLICATION':
        return !applicationIds.has(sourceId);
      case 'APP_COMPONENT':
        return !componentIds.has(sourceId);
      case 'SERVICE':
        return !serviceIds.has(sourceId);
      case 'INTERFACE':
        return !interfaceIds.has(sourceId);
      case 'BUSINESS_PROCESS':
        return !processIds.has(sourceId);
      case 'PROCESS_ACTIVITY':
        return !activityIds.has(sourceId);
      default:
        // Unknown kind - consider orphaned
        return true;
    }
  });
}

// ========== CASCADE DELETION ==========

/**
 * Cascade delete an App Business Point and clear orphan references
 * Clears:
 * - interactions.primary_app_business_point_id references (sets to empty string)
 * - interactions.secondary_app_business_point_id references (clears field)
 *
 * @param appBusinessPointId - ID of the App Business Point to delete
 * @param entities - Current MetaModelEntities
 * @returns Updated entities with ABP removed and orphan refs cleared
 */
export function cascadeDeleteAppBusinessPoint(
  appBusinessPointId: string,
  entities: MetaModelEntities
): MetaModelEntities {
  // Remove the ABP from the collection
  const updatedABPs = entities.app_business_points.filter(
    abp => abp.id !== appBusinessPointId
  );

  // Clear orphan references in Interactions
  const updatedInteractions = entities.interactions.map(interaction => {
    const updates: Partial<typeof interaction> = {};

    // Clear primary reference if it matches
    if (interaction.primary_app_business_point_id === appBusinessPointId) {
      updates.primary_app_business_point_id = '';
    }

    // Clear secondary reference if it matches
    if (interaction.secondary_app_business_point_id === appBusinessPointId) {
      updates.secondary_app_business_point_id = undefined;
    }

    // Return updated interaction if any changes
    if (Object.keys(updates).length > 0) {
      return { ...interaction, ...updates };
    }
    return interaction;
  });

  return {
    ...entities,
    app_business_points: updatedABPs,
    interactions: updatedInteractions,
  };
}

/**
 * Result of cascade deletion for ABP source entity
 */
export interface ABPSourceEntityCascadeResult {
  entities: MetaModelEntities;
  relationships: MetaModelRelationships;
}

/**
 * Cascade delete for a source entity (Application, App Component, Service, Interface,
 * Business Process, Process Activity)
 * Finds corresponding App Business Point and removes it along with clearing orphan refs
 *
 * @param entityId - ID of the source entity being deleted
 * @param _entityType - Type of source entity (used for type checking)
 * @param entities - Current MetaModelEntities
 * @param relationships - Current MetaModelRelationships
 * @returns Updated entities and relationships
 */
export function cascadeDeleteForABPSourceEntity(
  entityId: string,
  _entityType: ABPSourceEntityType,
  entities: MetaModelEntities,
  relationships: MetaModelRelationships
): ABPSourceEntityCascadeResult {
  // Find corresponding App Business Point
  const abp = findAppBusinessPointForEntity(entityId, entities.app_business_points || []);

  if (!abp) {
    // No ABP found - return unchanged
    return { entities, relationships };
  }

  // Cascade delete the App Business Point and clear orphan refs
  const updatedEntities = cascadeDeleteAppBusinessPoint(abp.id, entities);

  return {
    entities: updatedEntities,
    relationships,
  };
}

// ========== JSON LOAD RECONCILIATION ==========

/**
 * Reconcile App Business Points after loading a JSON model
 *
 * KEY DESIGN PRINCIPLE: `app_business_point.name` is a derived field.
 * The source entity name ALWAYS wins.
 *
 * Steps:
 * 1-6. For each source entity type:
 *      - If ABP is missing, create it with name from source entity
 *      - If ABP exists, FORCE-UPDATE its name from source entity (source is canonical)
 * 7.   Run full name sync pass to catch any edge cases
 * 8.   Remove orphaned ABPs that don't map to any source entity
 *
 * Post-reconciliation guarantee:
 * - Every App Business Point has the same name as its source entity
 * - No orphaned App Business Points exist
 *
 * @param metaModel - The loaded MetaModel to reconcile
 * @returns Reconciled MetaModel with synced App Business Points
 */
export function reconcileAppBusinessPoints(metaModel: MetaModel): MetaModel {
  const { entities, relationships } = metaModel;

  // Initialize app_business_points if not present (backward compatibility)
  let appBusinessPoints = [...(entities.app_business_points || [])];
  let updatedEntities = { ...entities };

  // Build a map for efficient ABP lookup and update
  const abpMap = new Map<string, AppBusinessPoint>();
  for (const abp of appBusinessPoints) {
    abpMap.set(abp.id, abp);
  }

  // Helper to process a source entity collection
  const processSourceEntities = (
    sourceEntities: AnyEntity[],
    sourceType: ABPSourceEntityType
  ) => {
    for (const entity of sourceEntities) {
      const sourceEntity = entity as ABPSourceEntity;
      const expectedId = generateAppBusinessPointId(sourceEntity.id);
      const existingABP = abpMap.get(expectedId);

      if (!existingABP) {
        // Create missing ABP
        console.warn(`Creating missing AppBusinessPoint for ${sourceType} ${sourceEntity.id}`);
        const newABP = createAppBusinessPointFromEntity(sourceEntity, sourceType);
        abpMap.set(newABP.id, newABP);
      } else {
        // ABP exists - FORCE UPDATE name from source entity (source is canonical)
        const updatedABP = forceUpdateAppBusinessPointName(existingABP, sourceEntity);
        abpMap.set(expectedId, updatedABP);
      }
    }
  };

  // Step 1: Process Applications
  processSourceEntities(entities.applications, 'applications');

  // Step 2: Process App Components
  processSourceEntities(entities.app_components, 'app_components');

  // Step 3: Process Services
  processSourceEntities(entities.services, 'services');

  // Step 4: Process Interfaces
  processSourceEntities(entities.interfaces, 'interfaces');

  // Step 5: Process Business Processes
  processSourceEntities(entities.business_processes, 'business_processes');

  // Step 6: Process Process Activities
  processSourceEntities(entities.process_activities, 'process_activities');

  // Convert map back to array
  appBusinessPoints = Array.from(abpMap.values());

  // Step 7: Run full name sync pass to catch any edge cases
  const entitiesForSync: MetaModelEntities = {
    ...entities,
    app_business_points: appBusinessPoints,
  };
  appBusinessPoints = syncAppBusinessPointNames(appBusinessPoints, entitiesForSync);

  // Step 8: Remove orphaned ABPs
  const orphans = getOrphanedAppBusinessPoints(appBusinessPoints, entities);

  // Update entities reference with current ABPs for cascade delete
  updatedEntities = {
    ...entities,
    app_business_points: appBusinessPoints,
  };

  for (const orphan of orphans) {
    console.warn(`Removing orphaned AppBusinessPoint ${orphan.id}`);
    // Cascade delete and clear orphan refs
    updatedEntities = cascadeDeleteAppBusinessPoint(orphan.id, updatedEntities);
  }

  return {
    entities: {
      ...updatedEntities,
      app_business_points: updatedEntities.app_business_points,
    },
    relationships,
  };
}

// ========== SOURCE TYPE CHECKING ==========

/**
 * Check if an entity type is an ABP source entity type
 *
 * @param entityType - The entity type to check
 * @returns True if the entity type is an ABP source type
 */
export function isABPSourceEntityType(entityType: string): entityType is ABPSourceEntityType {
  return (
    entityType === 'applications' ||
    entityType === 'app_components' ||
    entityType === 'services' ||
    entityType === 'interfaces' ||
    entityType === 'business_processes' ||
    entityType === 'process_activities'
  );
}

/**
 * Check if a palette section ID is an ABP source entity type
 *
 * @param sectionId - The palette section ID
 * @returns True if the section represents an ABP source entity type
 */
export function isABPSourceEntitySection(sectionId: string): boolean {
  return isABPSourceEntityType(sectionId);
}

/**
 * Business Point Synchronization Utilities
 *
 * This module provides utilities for automatically synchronizing Business Points
 * with their source entities (Business Processes, Process Activities).
 *
 * Business Points are derived entities that maintain a one-to-one relationship
 * with source entities, hidden from users while preserving existing functionality.
 * This mirrors the ApplicationPoint pattern.
 *
 * KEY DESIGN PRINCIPLE: `business_point.name` is a derived field.
 * The source entity name ALWAYS wins - BP names are never user-authored.
 */

import {
  BusinessPoint,
  BusinessPointKind,
  BusinessProcess,
  ProcessActivity,
  MetaModel,
  MetaModelRelationships,
  MetaModelEntities,
} from '../types/model';

// ========== TYPE DEFINITIONS ==========

/**
 * Source entity type for Business Point derivation
 */
export type BusinessSourceEntityType = 'business_processes' | 'process_activities';

/**
 * Source entity union type
 */
export type BusinessSourceEntity = BusinessProcess | ProcessActivity;

/**
 * Minimal entity interface for Business Point creation
 * Supports passing partial entities with required fields
 */
export interface MinimalBusinessSourceEntity {
  id: string;
  name: string;
  description?: string;
  tags?: string;
  business_process_id?: string;
  valid_from?: string;
  valid_to?: string;
}

/**
 * Result of resolving an entity to its Business Point
 */
export interface ResolvedBusinessPoint {
  entityType: string;
  entityId: string;
}

// ========== ID GENERATION ==========

/**
 * Generate a deterministic Business Point ID from a source entity ID
 * Uses pattern `bp_{source_entity_id}` for consistency across load/save cycles
 *
 * @param sourceEntityId - The ID of the source entity
 * @returns Deterministic Business Point ID
 */
export function generateBusinessPointId(sourceEntityId: string): string {
  return `bp_${sourceEntityId}`;
}

// ========== BUSINESS POINT CREATION ==========

/**
 * Map source entity type to BusinessPointKind
 */
function getKindForSourceType(sourceType: BusinessSourceEntityType): BusinessPointKind {
  switch (sourceType) {
    case 'business_processes':
      return 'BUSINESS_PROCESS';
    case 'process_activities':
      return 'PROCESS_ACTIVITY';
    default:
      throw new Error(`Unknown source type: ${sourceType}`);
  }
}

/**
 * Create a Business Point from a source entity.
 * Accepts either a full BusinessSourceEntity or a minimal entity with id, name, and optional fields.
 *
 * Business Process/Process Activity name is the canonical source for Business Point name.
 * The Business Point name is copied directly from the source entity's name.
 *
 * @param sourceEntity - The source entity (Business Process or Process Activity) or minimal entity
 * @param sourceType - The type of source entity
 * @returns New BusinessPoint with proper kind and foreign keys set
 */
export function createBusinessPointFromEntity(
  sourceEntity: BusinessSourceEntity | MinimalBusinessSourceEntity,
  sourceType: BusinessSourceEntityType
): BusinessPoint {
  const id = generateBusinessPointId(sourceEntity.id);
  const kind = getKindForSourceType(sourceType);

  // Base Business Point with common fields
  // Business Process/Process Activity name is the canonical source for Business Point name
  const baseBP: BusinessPoint = {
    id,
    name: sourceEntity.name, // Copy name from source entity - this is the canonical source
    description: sourceEntity.description || '',
    kind,
    business_process_id: '',
    tags: sourceEntity.tags || '',
    valid_from: sourceEntity.valid_from,
    valid_to: sourceEntity.valid_to,
  };

  // Set foreign keys based on kind
  switch (kind) {
    case 'BUSINESS_PROCESS':
      return {
        ...baseBP,
        business_process_id: sourceEntity.id,
      };
    case 'PROCESS_ACTIVITY':
      // For Process Activities, we need the business_process_id from the activity itself
      const processActivityEntity = sourceEntity as ProcessActivity | MinimalBusinessSourceEntity;
      return {
        ...baseBP,
        business_process_id: processActivityEntity.business_process_id || '',
        process_activity_id: sourceEntity.id,
      };
    default:
      return baseBP;
  }
}

// ========== BUSINESS POINT LOOKUP ==========

/**
 * Find the Business Point corresponding to a source entity
 * Uses deterministic ID pattern `bp_{entityId}` for lookup
 *
 * @param entityId - The ID of the source entity
 * @param businessPoints - Array of Business Points to search
 * @returns The matching BusinessPoint or undefined
 */
export function findBusinessPointForEntity(
  entityId: string,
  businessPoints: BusinessPoint[]
): BusinessPoint | undefined {
  const expectedId = generateBusinessPointId(entityId);
  return businessPoints.find(bp => bp.id === expectedId);
}

/**
 * Find the source entity for a Business Point based on its kind
 *
 * @param businessPoint - The Business Point to resolve
 * @param entities - The MetaModelEntities containing all entities
 * @returns The source entity or undefined
 */
export function findSourceEntityForBusinessPoint(
  businessPoint: BusinessPoint,
  entities: MetaModelEntities
): BusinessSourceEntity | undefined {
  switch (businessPoint.kind) {
    case 'BUSINESS_PROCESS':
      return entities.business_processes.find(bp => bp.id === businessPoint.business_process_id);
    case 'PROCESS_ACTIVITY':
      return entities.process_activities.find(pa => pa.id === businessPoint.process_activity_id);
    default:
      return undefined;
  }
}

// ========== BUSINESS POINT NAME SYNCHRONIZATION ==========

/**
 * Synchronize Business Point names with their source entities.
 *
 * KEY DESIGN PRINCIPLE: `business_point.name` is a derived field.
 * The source entity name ALWAYS wins.
 *
 * For each Business Point:
 * - Look up source entity based on `kind` field (BUSINESS_PROCESS, PROCESS_ACTIVITY)
 * - ALWAYS overwrite BP name with source entity name (source is canonical)
 * - Only preserve existing BP name if source entity name is empty/null
 *   (this prevents overwriting a valid BP name with an empty value)
 *
 * @param businessPoints - Array of Business Points to sync
 * @param businessProcesses - Array of Business Processes
 * @param processActivities - Array of Process Activities
 * @returns Updated array of Business Points with synchronized names
 */
export function syncBusinessPointNames(
  businessPoints: BusinessPoint[],
  businessProcesses: BusinessProcess[],
  processActivities: ProcessActivity[]
): BusinessPoint[] {
  // Build lookup maps for efficient access
  const processMap = new Map(businessProcesses.map(bp => [bp.id, bp]));
  const activityMap = new Map(processActivities.map(pa => [pa.id, pa]));

  return businessPoints.map(bp => {
    // Find the source entity for this Business Point
    let sourceEntity: BusinessSourceEntity | undefined;

    switch (bp.kind) {
      case 'BUSINESS_PROCESS':
        sourceEntity = processMap.get(bp.business_process_id);
        break;
      case 'PROCESS_ACTIVITY':
        sourceEntity = bp.process_activity_id ? activityMap.get(bp.process_activity_id) : undefined;
        break;
    }

    // If no source entity found, preserve existing Business Point
    // (orphan cleanup happens separately)
    if (!sourceEntity) {
      return bp;
    }

    // If source entity name is empty/null/undefined, preserve existing BP name
    // This prevents overwriting a valid BP name with an empty value
    if (!sourceEntity.name) {
      return bp;
    }

    // ALWAYS overwrite BP name with source entity name
    // Source entity name is the canonical source - BP name is derived
    // This ensures stale/different BP names are corrected on load
    if (bp.name !== sourceEntity.name) {
      return {
        ...bp,
        name: sourceEntity.name,
      };
    }

    // Names already match, no update needed
    return bp;
  });
}

/**
 * Force-update an existing Business Point's name from its source entity.
 * Used during reconciliation to ensure existing BPs have correct names.
 *
 * @param existingBP - The existing Business Point to update
 * @param sourceEntity - The source entity (Business Process or Process Activity)
 * @returns Updated BusinessPoint with name from source entity
 */
function forceUpdateBusinessPointName(
  existingBP: BusinessPoint,
  sourceEntity: BusinessSourceEntity | MinimalBusinessSourceEntity
): BusinessPoint {
  // If source entity has a name, always use it (source is canonical)
  // Only preserve existing BP name if source entity name is empty
  if (sourceEntity.name) {
    return {
      ...existingBP,
      name: sourceEntity.name,
    };
  }
  return existingBP;
}

/**
 * Force-reconcile an existing Business Point's name and FK fields from its source entity.
 * Used during reconciliation to ensure existing BPs have correct names AND foreign keys.
 *
 * @param existingBP - The existing Business Point to update
 * @param sourceEntity - The source entity (Business Process or Process Activity)
 * @param kind - The BusinessPointKind
 * @returns Updated BusinessPoint with name and FK fields from source entity
 */
function forceReconcileBusinessPoint(
  existingBP: BusinessPoint,
  sourceEntity: BusinessSourceEntity | MinimalBusinessSourceEntity,
  kind: BusinessPointKind
): BusinessPoint {
  // Start with name update
  let updated = forceUpdateBusinessPointName(existingBP, sourceEntity);

  // Update FK fields based on kind
  if (kind === 'BUSINESS_PROCESS') {
    updated = {
      ...updated,
      business_process_id: sourceEntity.id,
    };
  } else if (kind === 'PROCESS_ACTIVITY') {
    // For PROCESS_ACTIVITY, we need both process_activity_id AND business_process_id
    const activity = sourceEntity as ProcessActivity | MinimalBusinessSourceEntity;
    updated = {
      ...updated,
      process_activity_id: sourceEntity.id,
      business_process_id: activity.business_process_id || '',
    };
  }

  return updated;
}

// ========== EDIT-TIME SYNCHRONIZATION ==========

/**
 * Synchronize Business Point name for a specific source entity during edit operations.
 *
 * KEY DESIGN PRINCIPLE: `business_point.name` is a derived field.
 * Source entity name ALWAYS wins. Sync must happen immediately on edit.
 *
 * This function is called from the reducer's UPDATE_ENTITY case when:
 * - entityType is 'business_processes' or 'process_activities'
 * - The entity's name field has changed
 *
 * Behavior:
 * - If BP exists, update its name to match the new entity name
 * - If BP does NOT exist, create it with the new name
 * - Returns the updated business_points array
 *
 * @param entities - Current MetaModelEntities (before the entity update is applied)
 * @param entityType - The type of entity being updated ('business_processes', 'process_activities')
 * @param entityId - The ID of the entity being updated
 * @param newName - The new name for the entity
 * @returns Updated business_points array with the BP name synchronized
 */
export function syncBusinessPointNameForEntity(
  entities: MetaModelEntities,
  entityType: BusinessSourceEntityType,
  entityId: string,
  newName: string
): BusinessPoint[] {
  const businessPoints = [...entities.business_points];

  // Find the corresponding Business Point
  const existingBP = findBusinessPointForEntity(entityId, businessPoints);

  if (existingBP) {
    // BP exists - update its name
    return businessPoints.map(bp => {
      if (bp.id === existingBP.id) {
        return {
          ...bp,
          name: newName,
        };
      }
      return bp;
    });
  } else {
    // BP does NOT exist - create it
    // We need to get the source entity to create the BP with proper foreign keys
    // Since we're in an edit operation, the entity exists in the entities collection
    let sourceEntity: MinimalBusinessSourceEntity | undefined;

    switch (entityType) {
      case 'business_processes': {
        const process = entities.business_processes.find(p => p.id === entityId);
        if (process) {
          sourceEntity = {
            id: process.id,
            name: newName,
            description: process.description,
            tags: process.tags,
            valid_from: process.valid_from,
            valid_to: process.valid_to,
          };
        }
        break;
      }
      case 'process_activities': {
        const activity = entities.process_activities.find(a => a.id === entityId);
        if (activity) {
          sourceEntity = {
            id: activity.id,
            name: newName,
            description: activity.description,
            tags: activity.tags,
            business_process_id: activity.business_process_id,
            valid_from: activity.valid_from,
            valid_to: activity.valid_to,
          };
        }
        break;
      }
    }

    if (sourceEntity) {
      const newBP = createBusinessPointFromEntity(sourceEntity, entityType);
      return [...businessPoints, newBP];
    }

    // Source entity not found (shouldn't happen in normal flow)
    // Return unchanged business_points
    return businessPoints;
  }
}

// ========== ORPHAN DETECTION ==========

/**
 * Get Business Points that do not map to any existing source entity
 * These are orphans that should be cleaned up during reconciliation
 *
 * @param businessPoints - All Business Points
 * @param businessProcesses - All Business Processes
 * @param processActivities - All Process Activities
 * @returns Array of orphaned Business Points
 */
export function getOrphanedBusinessPoints(
  businessPoints: BusinessPoint[],
  businessProcesses: BusinessProcess[],
  processActivities: ProcessActivity[]
): BusinessPoint[] {
  const processIds = new Set(businessProcesses.map(bp => bp.id));
  const activityIds = new Set(processActivities.map(pa => pa.id));

  return businessPoints.filter(bp => {
    switch (bp.kind) {
      case 'BUSINESS_PROCESS':
        return !processIds.has(bp.business_process_id);
      case 'PROCESS_ACTIVITY':
        return !bp.process_activity_id || !activityIds.has(bp.process_activity_id);
      default:
        // Unknown kind - consider orphaned
        return true;
    }
  });
}

// ========== CASCADE DELETION ==========

/**
 * Cascade delete a Business Point and its related records
 * Removes:
 * - business_user_business_points referencing the BP
 * - application_point_business_points referencing the BP
 *
 * @param businessPointId - ID of the Business Point to delete
 * @param relationships - Current MetaModelRelationships
 * @returns Updated relationships with cascade deletions applied
 */
export function cascadeDeleteBusinessPoint(
  businessPointId: string,
  relationships: MetaModelRelationships
): MetaModelRelationships {
  return {
    ...relationships,
    // Filter out business_user_business_points referencing deleted BP
    business_user_business_points: relationships.business_user_business_points.filter(
      bubp => bubp.business_point_id !== businessPointId
    ),
    // Filter out application_point_business_points referencing deleted BP
    application_point_business_points: relationships.application_point_business_points.filter(
      apbp => apbp.business_point_id !== businessPointId
    ),
    // Other relationships unchanged
    logical_data_entity_relationships: relationships.logical_data_entity_relationships,
    logical_data_entity_physical_data_entities: relationships.logical_data_entity_physical_data_entities,
    logical_data_attribute_physical_data_attributes: relationships.logical_data_attribute_physical_data_attributes,
    data_movements: relationships.data_movements,
    interface_logical_entities: relationships.interface_logical_entities,
  };
}

/**
 * Result of cascade deletion for source entity
 */
export interface BusinessSourceEntityCascadeResult {
  entities: MetaModelEntities;
  relationships: MetaModelRelationships;
}

/**
 * Cascade delete for a source entity (Business Process, Process Activity)
 * Finds corresponding Business Point and removes it along with related records
 *
 * @param entityId - ID of the source entity being deleted
 * @param _entityType - Type of source entity ('business_processes', 'process_activities') - used for type checking
 * @param entities - Current MetaModelEntities
 * @param relationships - Current MetaModelRelationships
 * @returns Updated entities and relationships
 */
export function cascadeDeleteForBusinessSourceEntity(
  entityId: string,
  _entityType: BusinessSourceEntityType,
  entities: MetaModelEntities,
  relationships: MetaModelRelationships
): BusinessSourceEntityCascadeResult {
  // Find corresponding Business Point
  const bp = findBusinessPointForEntity(entityId, entities.business_points);

  if (!bp) {
    // No BP found - return unchanged
    return { entities, relationships };
  }

  // Cascade delete the Business Point relationships
  const updatedRelationships = cascadeDeleteBusinessPoint(bp.id, relationships);

  // Remove the Business Point from entities
  const updatedEntities: MetaModelEntities = {
    ...entities,
    business_points: entities.business_points.filter(p => p.id !== bp.id),
  };

  return {
    entities: updatedEntities,
    relationships: updatedRelationships,
  };
}

// ========== JSON LOAD RECONCILIATION ==========

/**
 * Reconcile Business Points after loading a JSON model
 *
 * KEY DESIGN PRINCIPLE: `business_point.name` is a derived field.
 * The source entity name ALWAYS wins.
 *
 * Steps:
 * 1-2. For each source entity (Business Process, Process Activity):
 *      - If BP is missing, create it with name from source entity
 *      - If BP exists, FORCE-UPDATE its name AND FK fields from source entity (source is canonical)
 * 3.   Run full name sync pass to catch any edge cases
 * 4.   Remove orphaned BPs that don't map to any source entity
 *
 * Post-reconciliation guarantee:
 * - Every Business Point has the same name as its source entity
 * - Every Business Point has correct FK fields from its source entity
 * - No orphaned Business Points exist
 *
 * @param metaModel - The loaded MetaModel to reconcile
 * @returns Reconciled MetaModel with synced Business Points
 */
export function reconcileBusinessPoints(metaModel: MetaModel): MetaModel {
  const { entities, relationships } = metaModel;
  let businessPoints = [...(entities.business_points || [])];
  let updatedRelationships = { ...relationships };

  // Build a map for efficient BP lookup and update
  const bpMap = new Map<string, BusinessPoint>();
  for (const bp of businessPoints) {
    bpMap.set(bp.id, bp);
  }

  // Step 1: Process Business Processes - create missing BPs or update existing ones
  for (const process of entities.business_processes) {
    const expectedId = generateBusinessPointId(process.id);
    const existingBP = bpMap.get(expectedId);

    if (!existingBP) {
      // Create missing BP
      console.warn(`Creating missing BusinessPoint for Business Process ${process.id}`);
      const newBP = createBusinessPointFromEntity(process, 'business_processes');
      bpMap.set(newBP.id, newBP);
    } else {
      // BP exists - FORCE UPDATE name and FK fields from source entity
      const updatedBP = forceReconcileBusinessPoint(existingBP, process, 'BUSINESS_PROCESS');
      bpMap.set(expectedId, updatedBP);
    }
  }

  // Step 2: Process Process Activities - create missing BPs or update existing ones
  for (const activity of entities.process_activities) {
    const expectedId = generateBusinessPointId(activity.id);
    const existingBP = bpMap.get(expectedId);

    if (!existingBP) {
      // Create missing BP
      console.warn(`Creating missing BusinessPoint for Process Activity ${activity.id}`);
      const newBP = createBusinessPointFromEntity(activity, 'process_activities');
      bpMap.set(newBP.id, newBP);
    } else {
      // BP exists - FORCE UPDATE name and FK fields from source entity
      const updatedBP = forceReconcileBusinessPoint(existingBP, activity, 'PROCESS_ACTIVITY');
      bpMap.set(expectedId, updatedBP);
    }
  }

  // Convert map back to array
  businessPoints = Array.from(bpMap.values());

  // Step 3: Run full name sync pass to catch any edge cases
  // This ensures all Business Points have up-to-date names from their source entities
  // Source entity name is the canonical source for Business Point name
  businessPoints = syncBusinessPointNames(
    businessPoints,
    entities.business_processes,
    entities.process_activities
  );

  // Step 4: Remove orphaned BPs (after name sync to avoid processing orphans)
  const orphans = getOrphanedBusinessPoints(
    businessPoints,
    entities.business_processes,
    entities.process_activities
  );

  for (const orphan of orphans) {
    console.warn(`Removing orphaned BusinessPoint ${orphan.id}`);
    // Cascade delete relationships for orphan
    updatedRelationships = cascadeDeleteBusinessPoint(orphan.id, updatedRelationships);
  }

  // Filter out orphans from business points
  const orphanIds = new Set(orphans.map(o => o.id));
  businessPoints = businessPoints.filter(bp => !orphanIds.has(bp.id));

  return {
    entities: {
      ...entities,
      business_points: businessPoints,
    },
    relationships: updatedRelationships,
  };
}

// ========== PALETTE-TO-DIAGRAM MAPPING ==========

/**
 * Check if a source entity type requires Business Point resolution
 *
 * @param sectionId - The palette section ID
 * @returns True if the section represents a business source entity type
 */
export function isBusinessSourceEntitySection(sectionId: string): boolean {
  return sectionId === 'business_processes' || sectionId === 'process_activities';
}

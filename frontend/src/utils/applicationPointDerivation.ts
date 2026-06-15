/**
 * Application Point Derivation Utilities
 *
 * Spec: Global Application Point Picker with Derived ApplicationPoints
 *
 * This module provides utilities for creating and managing derived ApplicationPoints
 * when users select Services, Classes, or Methods in the ApplicationPointPickerCell.
 *
 * Derived ApplicationPoints are auto-created proxy entities that:
 * - Have a deterministic ID based on target type and ref ID
 * - Point to the source entity via target_type and target_ref_id fields
 * - Have kind set to the target type ('SERVICE', 'CLASS', 'METHOD')
 * - Inherit name from the target entity
 *
 * ID Pattern: ap_derived_{targetType.toLowerCase()}_{targetRefId}
 *
 * Updated in Extension Pack Framework spec:
 * - deriveApplicationIdForClass now uses service_id instead of application_point_id
 *   (classes now belong to services directly, not via application points)
 */

import {
  ApplicationPoint,
  ApplicationPointKind,
  Service,
  Class,
  Method,
  Library,
  MetaModelEntities,
} from '../types/model';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Target entity type for derived Application Point creation
 * Matches the ApplicationPointTargetType enum values
 */
export type DerivedTargetType = 'SERVICE' | 'CLASS' | 'METHOD' | 'LIBRARY';

/**
 * Source entity union type for derived Application Points
 */
export type DerivedSourceEntity = Service | Class | Method | Library;

/**
 * Result of finding or creating a derived Application Point
 */
export interface DerivedApplicationPointResult {
  applicationPoint: ApplicationPoint;
  isNew: boolean;
}

// ============================================================================
// ID GENERATION
// ============================================================================

/**
 * Generate a deterministic ID for a derived Application Point.
 *
 * ID Pattern: ap_derived_{targetType.toLowerCase()}_{targetRefId}
 *
 * This pattern ensures:
 * - IDs are unique per target type and entity combination
 * - IDs are deterministic and can be regenerated
 * - IDs don't collide with standard ApplicationPoint IDs (which use ap_{sourceEntityId})
 *
 * @param targetType - The type of target entity (SERVICE, CLASS, METHOD)
 * @param targetRefId - The ID of the target entity
 * @returns Deterministic derived Application Point ID
 */
export function generateDerivedApplicationPointId(
  targetType: DerivedTargetType,
  targetRefId: string
): string {
  return `ap_derived_${targetType.toLowerCase()}_${targetRefId}`;
}

// ============================================================================
// NAME GENERATION
// ============================================================================

/**
 * Generate a display name for a derived Application Point.
 *
 * The name is derived from the target entity's name, prefixed with the target type
 * in a human-readable format.
 *
 * Examples:
 * - Service "OrderService" -> "OrderService (Service)"
 * - Class "OrderController" -> "OrderController (Class)"
 * - Method "processOrder" -> "processOrder (Method)"
 *
 * @param targetType - The type of target entity (SERVICE, CLASS, METHOD)
 * @param targetEntityName - The name of the target entity
 * @returns Display name for the derived Application Point
 */
export function generateDerivedApplicationPointName(
  targetType: DerivedTargetType,
  targetEntityName: string
): string {
  // Format the target type for display (e.g., "SERVICE" -> "Service")
  const formattedType = targetType.charAt(0) + targetType.slice(1).toLowerCase();
  return `${targetEntityName} (${formattedType})`;
}

// ============================================================================
// APPLICATION POINT LOOKUP
// ============================================================================

/**
 * Find an existing derived Application Point for a target entity.
 *
 * Searches by the deterministic ID pattern.
 *
 * @param targetType - The type of target entity (SERVICE, CLASS, METHOD)
 * @param targetRefId - The ID of the target entity
 * @param applicationPoints - Array of Application Points to search
 * @returns The matching ApplicationPoint or undefined
 */
export function findDerivedApplicationPoint(
  targetType: DerivedTargetType,
  targetRefId: string,
  applicationPoints: ApplicationPoint[]
): ApplicationPoint | undefined {
  const expectedId = generateDerivedApplicationPointId(targetType, targetRefId);
  return applicationPoints.find(ap => ap.id === expectedId);
}

// ============================================================================
// APPLICATION ID DERIVATION
// ============================================================================

/**
 * Derive the application_id for a Class entity.
 *
 * Looks up the owning Service by classEntity.service_id and returns
 * the Service's application_id.
 *
 * Updated in Extension Pack Framework spec: classes now use service_id
 * instead of application_point_id. The derivation path is:
 * Class -> service_id -> Service -> application_id
 *
 * @param classEntity - The Class entity
 * @param entities - The MetaModelEntities containing all entities
 * @returns The derived application_id or empty string
 */
export function deriveApplicationIdForClass(
  classEntity: Class,
  entities: MetaModelEntities
): string {
  if (!classEntity.service_id) {
    return '';
  }

  const service = entities.services.find(
    s => s.id === classEntity.service_id
  );
  return service?.application_id || '';
}

/**
 * Derive the application_id for a Method entity.
 *
 * Finds the owning Class and delegates to deriveApplicationIdForClass.
 *
 * @param methodEntity - The Method entity
 * @param entities - The MetaModelEntities containing all entities
 * @returns The derived application_id or empty string
 */
export function deriveApplicationIdForMethod(
  methodEntity: Method,
  entities: MetaModelEntities
): string {
  const owningClass = entities.classes.find(c => c.id === methodEntity.class_id);
  if (!owningClass) {
    return '';
  }
  return deriveApplicationIdForClass(owningClass, entities);
}

// ============================================================================
// APPLICATION POINT CREATION
// ============================================================================

/**
 * Create a derived Application Point for a Service entity.
 *
 * @param service - The Service entity to derive from
 * @returns New ApplicationPoint configured for the Service
 */
function createDerivedApplicationPointForService(
  service: Service
): ApplicationPoint {
  const id = generateDerivedApplicationPointId('SERVICE', service.id);
  const name = generateDerivedApplicationPointName('SERVICE', service.name);

  return {
    id,
    name,
    description: `Derived Application Point for Service: ${service.name}`,
    kind: 'SERVICE' as ApplicationPointKind,
    application_id: service.application_id || '',
    service_id: service.id,
    target_type: 'SERVICE',
    target_ref_id: service.id,
    point_type: '', // Deprecated field
    tags: '',
  };
}

/**
 * Create a derived Application Point for a Class entity.
 *
 * @param classEntity - The Class entity to derive from
 * @param entities - The MetaModelEntities for application_id derivation
 * @returns New ApplicationPoint configured for the Class
 */
function createDerivedApplicationPointForClass(
  classEntity: Class,
  entities: MetaModelEntities
): ApplicationPoint {
  const id = generateDerivedApplicationPointId('CLASS', classEntity.id);
  const name = generateDerivedApplicationPointName('CLASS', classEntity.name);
  const applicationId = deriveApplicationIdForClass(classEntity, entities);

  return {
    id,
    name,
    description: `Derived Application Point for Class: ${classEntity.name}`,
    kind: 'CLASS' as ApplicationPointKind,
    application_id: applicationId,
    target_type: 'CLASS',
    target_ref_id: classEntity.id,
    point_type: '', // Deprecated field
    tags: '',
  };
}

/**
 * Create a derived Application Point for a Method entity.
 *
 * @param method - The Method entity to derive from
 * @param entities - The MetaModelEntities for application_id derivation
 * @returns New ApplicationPoint configured for the Method
 */
function createDerivedApplicationPointForMethod(
  method: Method,
  entities: MetaModelEntities
): ApplicationPoint {
  const id = generateDerivedApplicationPointId('METHOD', method.id);
  const name = generateDerivedApplicationPointName('METHOD', method.name);
  const applicationId = deriveApplicationIdForMethod(method, entities);

  return {
    id,
    name,
    description: `Derived Application Point for Method: ${method.name}`,
    kind: 'METHOD' as ApplicationPointKind,
    application_id: applicationId,
    target_type: 'METHOD',
    target_ref_id: method.id,
    point_type: '', // Deprecated field
    tags: '',
  };
}

/**
 * Create a derived Application Point for a Library entity.
 *
 * Spec 2026-05-06: Library Frontend Types & Tables
 * Library has no application_id - empty string satisfies the TS-required
 * ApplicationPoint.application_id: string field.
 *
 * @param library - The Library entity to derive from
 * @returns New ApplicationPoint configured for the Library
 */
function createDerivedApplicationPointForLibrary(
  library: Library
): ApplicationPoint {
  const libraryName = library.name ?? library.id;
  const id = generateDerivedApplicationPointId('LIBRARY', library.id);
  const name = generateDerivedApplicationPointName('LIBRARY', libraryName);

  return {
    id,
    name,
    description: `Derived Application Point for Library: ${libraryName}`,
    kind: 'LIBRARY' as ApplicationPointKind,
    application_id: '', // Library has no application_id
    target_type: 'LIBRARY',
    target_ref_id: library.id,
    point_type: '', // Deprecated field
    tags: '',
  };
}

// ============================================================================
// ENSURE DERIVED APPLICATION POINT (MAIN API)
// ============================================================================

/**
 * Ensure a derived Application Point exists for a target entity.
 *
 * This is the main API for the ApplicationPointPickerCell to use when
 * a user selects a Service, Class, or Method.
 *
 * If a derived AP already exists (by ID lookup), returns it.
 * Otherwise, creates a new derived AP and returns it with isNew: true.
 *
 * The caller is responsible for dispatching ADD_ENTITY to persist the new AP
 * when isNew is true.
 *
 * @param targetType - The type of target entity (SERVICE, CLASS, METHOD)
 * @param targetRefId - The ID of the target entity
 * @param entities - The MetaModelEntities containing all entities
 * @returns Result containing the ApplicationPoint and whether it's new
 */
export function ensureDerivedApplicationPoint(
  targetType: DerivedTargetType,
  targetRefId: string,
  entities: MetaModelEntities
): DerivedApplicationPointResult {
  // Check for existing derived AP
  const existingAP = findDerivedApplicationPoint(
    targetType,
    targetRefId,
    entities.application_points
  );

  if (existingAP) {
    return {
      applicationPoint: existingAP,
      isNew: false,
    };
  }

  // Create new derived AP based on target type
  let newAP: ApplicationPoint;

  switch (targetType) {
    case 'SERVICE': {
      const service = entities.services.find(s => s.id === targetRefId);
      if (!service) {
        throw new Error(`Service not found: ${targetRefId}`);
      }
      newAP = createDerivedApplicationPointForService(service);
      break;
    }

    case 'CLASS': {
      const classEntity = entities.classes.find(c => c.id === targetRefId);
      if (!classEntity) {
        throw new Error(`Class not found: ${targetRefId}`);
      }
      newAP = createDerivedApplicationPointForClass(classEntity, entities);
      break;
    }

    case 'METHOD': {
      const method = entities.methods.find(m => m.id === targetRefId);
      if (!method) {
        throw new Error(`Method not found: ${targetRefId}`);
      }
      newAP = createDerivedApplicationPointForMethod(method, entities);
      break;
    }

    case 'LIBRARY': {
      // Spec 2026-05-06: Library Frontend Types & Tables
      const library = entities.libraries.find(l => l.id === targetRefId);
      if (!library) {
        throw new Error(`Library not found: ${targetRefId}`);
      }
      newAP = createDerivedApplicationPointForLibrary(library);
      break;
    }

    default:
      throw new Error(`Invalid target type: ${targetType}`);
  }

  return {
    applicationPoint: newAP,
    isNew: true,
  };
}

// ============================================================================
// UTILITY: GET TARGET ENTITY INFO
// ============================================================================

/**
 * Get information about the target entity for a derived Application Point.
 *
 * @param applicationPoint - The ApplicationPoint to get target info for
 * @param entities - The MetaModelEntities containing all entities
 * @returns Object with targetType, targetEntity, and displayName, or null if not found
 */
export function getTargetEntityInfo(
  applicationPoint: ApplicationPoint,
  entities: MetaModelEntities
): {
  targetType: DerivedTargetType;
  targetEntity: DerivedSourceEntity;
  displayName: string;
} | null {
  const { target_type, target_ref_id } = applicationPoint;

  if (!target_type || !target_ref_id) {
    return null;
  }

  const normalizedType = target_type.toString().toUpperCase() as DerivedTargetType;

  switch (normalizedType) {
    case 'SERVICE': {
      const service = entities.services.find(s => s.id === target_ref_id);
      if (service) {
        return {
          targetType: 'SERVICE',
          targetEntity: service,
          displayName: generateDerivedApplicationPointName('SERVICE', service.name),
        };
      }
      break;
    }

    case 'CLASS': {
      const classEntity = entities.classes.find(c => c.id === target_ref_id);
      if (classEntity) {
        return {
          targetType: 'CLASS',
          targetEntity: classEntity,
          displayName: generateDerivedApplicationPointName('CLASS', classEntity.name),
        };
      }
      break;
    }

    case 'METHOD': {
      const method = entities.methods.find(m => m.id === target_ref_id);
      if (method) {
        return {
          targetType: 'METHOD',
          targetEntity: method,
          displayName: generateDerivedApplicationPointName('METHOD', method.name),
        };
      }
      break;
    }

    case 'LIBRARY': {
      // Spec 2026-05-06: Library Frontend Types & Tables
      const library = entities.libraries.find(l => l.id === target_ref_id);
      if (library) {
        const libraryName = library.name ?? library.id;
        return {
          targetType: 'LIBRARY',
          targetEntity: library,
          displayName: generateDerivedApplicationPointName('LIBRARY', libraryName),
        };
      }
      break;
    }
  }

  return null;
}

/**
 * Check if an Application Point is a derived Application Point
 * (has target_type and target_ref_id set).
 *
 * @param applicationPoint - The ApplicationPoint to check
 * @returns true if the AP is a derived AP with target info set
 */
export function isDerivedApplicationPoint(
  applicationPoint: ApplicationPoint
): boolean {
  return !!(applicationPoint.target_type && applicationPoint.target_ref_id);
}


// ============================================================================
// FIX #6a (PRE-SAVE HOOK): ENSURE DERIVED AP FOR EVERY SERVICE
// ----------------------------------------------------------------------------
// New UX requirement: when the user creates a Service in the Grid and clicks
// 'Start Discovery Run' from the row context menu, the run must succeed
// straight away without an explicit save step. The discovery-service requires
// a real ApplicationPoint UUID for the Service root (Fix #5), and that AP is
// only auto-created if the model has a derived AP row keyed by
// (target_type='SERVICE', target_ref_id=service.id).
//
// Previously the picker created derived APs only when a user explicitly
// selected a Service from the ApplicationPoint picker cell. This pre-save
// hook walks every Service in metaModel.entities.services and inserts the
// derived AP if absent, so saves always carry a complete graph.
//
// The id pattern matches the existing derived-AP convention
// (generateDerivedApplicationPointId), so the hook is idempotent across
// repeated saves.
// ============================================================================

/**
 * Ensure a derived ApplicationPoint exists for a Service entity. If the
 * application_points array already contains a derived AP for the Service
 * (matched by target_type='SERVICE' and target_ref_id=service.id, OR by
 * the deterministic id pattern), returns the existing AP unchanged.
 * Otherwise, returns a new derived AP ready to be appended to the
 * metaModel.entities.application_points array.
 *
 * Spec: Fix #6a (Service-without-save flow).
 *
 * @param service - The Service entity to derive an AP for
 * @param applicationPoints - Existing AP array to search
 * @returns Result with the matching or new ApplicationPoint and isNew flag
 */
export function ensureDerivedApplicationPointForService(
  service: Service,
  applicationPoints: ApplicationPoint[]
): DerivedApplicationPointResult {
  // Fast path: id-based deterministic match (existing derived-AP convention).
  const existingById = findDerivedApplicationPoint(
    'SERVICE',
    service.id,
    applicationPoints
  );
  if (existingById) {
    return { applicationPoint: existingById, isNew: false };
  }

  // Defensive: also check by (target_type, target_ref_id) tuple in case a row
  // was created with a non-conventional id (e.g. server-allocated UUID after
  // discovery-service self-heal).
  const existingByTuple = applicationPoints.find(
    ap => ap.target_type === 'SERVICE' && ap.target_ref_id === service.id
  );
  if (existingByTuple) {
    return { applicationPoint: existingByTuple, isNew: false };
  }

  return {
    applicationPoint: createDerivedApplicationPointForService(service),
    isNew: true,
  };
}

/**
 * Walk every Service in the metaModel and ensure a derived ApplicationPoint
 * row exists for each (Fix #6a).
 *
 * <p>Returns a NEW MetaModelEntities with the application_points array
 * appended with any newly-created derived APs. If no Services lack a
 * derived AP, the existing entities object is returned unchanged.</p>
 *
 * <p>This hook is called as part of the model save pipeline so a Service
 * created in the Grid can be discovered immediately without an explicit
 * save -> right-click cycle.</p>
 *
 * @param entities - The current MetaModelEntities
 * @returns New entities with derived APs ensured for every Service
 */
export function ensureDerivedApplicationPointsForServices(
  entities: MetaModelEntities
): MetaModelEntities {
  if (!entities.services || entities.services.length === 0) {
    return entities;
  }
  const newAPs: ApplicationPoint[] = [];
  // Use a working array so each ensure call sees the APs we just added (in
  // case two Services share the same id, which should not happen but defends
  // against test-data oddities).
  const working = [...entities.application_points];
  for (const service of entities.services) {
    const result = ensureDerivedApplicationPointForService(service, working);
    if (result.isNew) {
      newAPs.push(result.applicationPoint);
      working.push(result.applicationPoint);
    }
  }
  if (newAPs.length === 0) {
    return entities;
  }
  return {
    ...entities,
    application_points: working,
  };
}

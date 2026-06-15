import { ArchitectureModel, EntityType, AnyEntity, Service, Diagram, DiagramNode, ProcessActivity, Interface, Interaction, resolveAppBusinessPoint, StateTransition, ActivityFlow, DataMovement, UIAction, LogicalDataEntityRelationship, UserJourneyLink, ApplicationPoint } from '../types/model';
import { ValidationError, GridColumnConfig, XORValidationRule } from '../types/config';
import { gridConfigs } from '../config/gridConfigs';
import {
  syncApplicationPointNames,
  reconcileApplicationPoints,
} from './applicationPointSync';
import { reconcileBusinessPoints } from './businessPointSync';
import { reconcileAppBusinessPoints } from './appBusinessPointSync';
import { ensureDerivedApplicationPointsForServices } from './applicationPointDerivation';

import { DIAGRAM_NODE_ENTITY_TYPE_MAP } from './entityTypeRegistry';
// Exception tables that allow duplicate names
// Rationale: These tables often contain legitimately repeated names (e.g., multiple "id" or "created_at" attributes)
const DUPLICATE_NAME_EXCEPTION_TABLES: EntityType[] = [
  'logical_data_attributes',
  'physical_data_attributes',
  'physical_data_entities',
  'state_transitions', // StateTransitions don't have a name field, so no duplicate name check
  'activity_flows', // ActivityFlows don't have a name field, so no duplicate name check
];

// Polymorphic FK targets that are validated by specialized validators
// These fkTargets don't exist as actual entity collections in metaModel.entities
const POLYMORPHIC_FK_TARGETS: string[] = [
  'app_business_points', // Validated by validateInteractionReferences()
];

/**
 * Entity type display name mapping.
 * Maps EntityType (snake_case) to SCREAMING_SNAKE_CASE display format for error messages.
 */
export const ENTITY_TYPE_DISPLAY_NAMES: Record<EntityType, string> = {
  'application_points': 'APPLICATION_POINT',
  'applications': 'APPLICATION',
  'app_components': 'APP_COMPONENT',
  'services': 'SERVICE',
  'interfaces': 'INTERFACE',
  'endpoints': 'ENDPOINT',
  'business_processes': 'BUSINESS_PROCESS',
  'business_users': 'BUSINESS_USER',
  'business_points': 'BUSINESS_POINT',
  'process_activities': 'PROCESS_ACTIVITY',
  'logical_data_entities': 'LOGICAL_DATA_ENTITY',
  'logical_data_attributes': 'LOGICAL_DATA_ATTRIBUTE',
  'physical_data_entities': 'PHYSICAL_DATA_ENTITY',
  'physical_data_attributes': 'PHYSICAL_DATA_ATTRIBUTE',
  'interactions': 'INTERACTION',
  'app_business_points': 'APP_BUSINESS_POINT',
  'events': 'EVENT',
  'classes': 'CLASS',
  'methods': 'METHOD',
  'states': 'STATE',
  'state_transitions': 'STATE_TRANSITION',
  'activities': 'ACTIVITY',
  'activity_flows': 'ACTIVITY_FLOW',
  'activity_partitions': 'ACTIVITY_PARTITION',
  'ui_screens': 'UI_SCREEN',  // Spec 2026-01-02: UI Architecture
  'ui_components': 'UI_COMPONENT',  // Spec 2026-01-03: Meta-Model UI Domain Tab
  'ui_actions': 'UI_ACTION',  // Spec 2026-01-03: Meta-Model UI Domain Tab
  'business_logics': 'BUSINESS_LOGIC',  // Spec: Business Logic Entity v1
  'package_sets': 'PACKAGE_SET',  // Spec: Package Sets Persistence
  'packages': 'PACKAGE',  // Spec: Package Sets Persistence
  'ui_characteristics': 'UI_CHARACTERISTIC',
  'user_journeys': 'USER_JOURNEY',
  'activity_steps': 'ACTIVITY_STEP',  // Spec 2026-01-20: UI Characteristics
  // Spec 2026-05-04: Infrastructure Domain Frontend Types - 13 entity types
  'environments': 'ENVIRONMENT',
  'cloud_accounts': 'CLOUD_ACCOUNT',
  'locations': 'LOCATION',
  'networks': 'NETWORK',
  'subnets': 'SUBNET',
  'compute_clusters': 'COMPUTE_CLUSTER',
  'compute_resources': 'COMPUTE_RESOURCE',
  'deployment_units': 'DEPLOYMENT_UNIT',
  'load_balancers': 'LOAD_BALANCER',
  'listeners': 'LISTENER',
  'data_store_instances': 'DATA_STORE_INSTANCE',
  'infrastructure_resources': 'INFRASTRUCTURE_RESOURCE',
  'infrastructure_points': 'INFRASTRUCTURE_POINT',
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
  'iac_sources': 'IAC_SOURCE',
  // Spec 2026-05-06: Library Frontend Types & Tables
  'libraries': 'LIBRARY',
};

// ============================================================================
// Spec 2026-01-11: Data Movement Interface Schema Extension - XOR Validation
// ============================================================================

/**
 * XOR_VALIDATION_RULES - XOR constraint definitions for relationships
 *
 * Spec 2026-01-11: Data Movement Interface Schema Extension
 * Defines XOR constraints where exactly one of the specified fields must be set.
 */
export const XOR_VALIDATION_RULES: XORValidationRule[] = [
  {
    entityType: 'data_movements',
    fields: ['dataEntityPointId', 'interfaceWithSchemaId'],
    message: 'Exactly one of {fields} must be set',
  },
];

/**
 * Format XOR validation error message.
 *
 * Spec 2026-01-11: Data Movement Interface Schema Extension
 * Format: <ENTITY_TYPE> ['<row_name>'] requires exactly one of [field1, field2]
 *
 * @param entityType - The entity type (e.g., 'data_movements')
 * @param entityName - The entity's name (for display purposes)
 * @param fields - Array of field names in the XOR constraint
 * @returns Formatted error message
 */
export function formatXORValidationErrorMessage(
  entityType: EntityType | string,
  entityName: string | null | undefined,
  fields: string[]
): string {
  const displayEntityType = getEntityTypeDisplayName(entityType);
  const displayName = getEntityDisplayName(entityName);
  const fieldList = fields.join(', ');
  return `${displayEntityType} ['${displayName}'] requires exactly one of [${fieldList}]`;
}

/**
 * Validate XOR constraint for a DataMovement entity.
 *
 * Spec 2026-01-11: Data Movement Interface Schema Extension
 * Exactly one of dataEntityPointId OR interfaceWithSchemaId must be set.
 * Empty strings are treated as not set.
 *
 * @param dataMovement - The DataMovement entity to validate
 * @returns Array of ValidationErrors (empty if valid)
 */
export function validateDataMovementXOR(dataMovement: DataMovement): ValidationError[] {
  const errors: ValidationError[] = [];

  // Get field values, treating empty strings as not set
  const hasDataEntity = !!dataMovement.dataEntityPointId && dataMovement.dataEntityPointId !== '';
  const hasInterface = !!dataMovement.interfaceWithSchemaId && dataMovement.interfaceWithSchemaId !== '';

  // XOR: exactly one must be set
  const count = (hasDataEntity ? 1 : 0) + (hasInterface ? 1 : 0);

  if (count !== 1) {
    const entityName = dataMovement.description || dataMovement.id;
    errors.push({
      entityType: 'data_movements',
      entityId: dataMovement.id,
      entityName,
      field: 'dataEntityPointId', // Primary field for the error
      message: formatXORValidationErrorMessage('data_movements', entityName, ['dataEntityPointId', 'interfaceWithSchemaId']),
      type: 'xor_constraint',
    });
  }

  return errors;
}

// ============================================================================
// End XOR Validation Section
// ============================================================================

/**
 * Get the display name for an entity type.
 * Falls back to uppercasing the entity type if not found in the mapping.
 * @param entityType - The entity type to get the display name for
 * @returns The SCREAMING_SNAKE_CASE display name
 */
function getEntityTypeDisplayName(entityType: string): string {
  if (entityType in ENTITY_TYPE_DISPLAY_NAMES) {
    return ENTITY_TYPE_DISPLAY_NAMES[entityType as EntityType];
  }
  // Fallback: convert snake_case to SCREAMING_SNAKE_CASE and remove trailing 's' if present
  const normalized = entityType.toUpperCase().replace(/_/g, '_');
  // Handle plurals by removing trailing 'S' from the result
  if (normalized.endsWith('S') && !normalized.endsWith('SS')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Helper to get entity name or identifier for display.
 * Handles entities that may not have a name field (like StateTransition, ActivityFlow).
 * @param entity - The entity to get a display name from
 * @returns The entity name, or id if name doesn't exist, or 'unnamed row'
 */
function getEntityNameOrId(entity: AnyEntity): string | undefined {
  // Check if entity has a name property
  if ('name' in entity && typeof (entity as { name?: string }).name === 'string') {
    return (entity as { name: string }).name;
  }
  // For entities without name (like StateTransition, ActivityFlow), use id
  return entity.id;
}

/**
 * Get the display name for an entity, handling null/empty/undefined values.
 * @param entityName - The entity name (may be null, undefined, or empty)
 * @returns The entity name or 'unnamed row' if empty
 */
function getEntityDisplayName(entityName: string | null | undefined): string {
  if (entityName === null || entityName === undefined || entityName.trim() === '') {
    return 'unnamed row';
  }
  return entityName;
}

/**
 * Format a validation error message for required field validation.
 * Format: <ENTITY_TYPE> ['<row_name>'] requires a value in field '<field_name>'
 *
 * @param entityType - The entity type (e.g., 'application_points')
 * @param entityName - The entity's name (for display purposes)
 * @param fieldName - The field that failed validation
 * @returns Formatted error message
 */
export function formatValidationErrorMessage(
  entityType: EntityType | string,
  entityName: string | null | undefined,
  fieldName: string
): string {
  const displayEntityType = getEntityTypeDisplayName(entityType);
  const displayName = getEntityDisplayName(entityName);
  return `${displayEntityType} ['${displayName}'] requires a value in field '${fieldName}'`;
}

/**
 * Format a validation error message for FK reference validation.
 * Format: <ENTITY_TYPE> ['<row_name>'] requires a valid reference in field '<field_name>'
 *
 * @param entityType - The entity type (e.g., 'application_points')
 * @param entityName - The entity's name (for display purposes)
 * @param fieldName - The field that failed validation
 * @returns Formatted error message
 */
export function formatFKValidationErrorMessage(
  entityType: EntityType | string,
  entityName: string | null | undefined,
  fieldName: string
): string {
  const displayEntityType = getEntityTypeDisplayName(entityType);
  const displayName = getEntityDisplayName(entityName);
  return `${displayEntityType} ['${displayName}'] requires a valid reference in field '${fieldName}'`;
}

/**
 * Format a validation error message for duplicate name validation.
 * Format: <ENTITY_TYPE> ['<row_name>'] has a duplicate name
 *
 * @param entityType - The entity type (e.g., 'applications')
 * @param entityName - The entity's name (for display purposes)
 * @returns Formatted error message
 */
export function formatDuplicateNameErrorMessage(
  entityType: EntityType | string,
  entityName: string | null | undefined
): string {
  const displayEntityType = getEntityTypeDisplayName(entityType);
  const displayName = getEntityDisplayName(entityName);
  return `${displayEntityType} ['${displayName}'] has a duplicate name`;
}

/**
 * Format a validation error message for service-application consistency.
 * Format: SERVICE ['<service_name>'] Application must match the parent Application of the selected Application Component
 *
 * @param serviceName - The service's name (for display purposes)
 * @returns Formatted error message
 */
export function formatServiceConsistencyErrorMessage(
  serviceName: string | null | undefined
): string {
  const displayName = getEntityDisplayName(serviceName);
  return `SERVICE ['${displayName}'] Application must match the parent Application of the selected Application Component`;
}

/**
 * Format a validation error message for interface-service consistency.
 * Format: INTERFACE ['<interface_name>'] requires a valid service_id reference
 *
 * @param interfaceName - The interface's name (for display purposes)
 * @returns Formatted error message
 */
export function formatInterfaceServiceErrorMessage(
  interfaceName: string | null | undefined
): string {
  const displayName = getEntityDisplayName(interfaceName);
  return `INTERFACE ['${displayName}'] requires a valid service_id reference`;
}

/**
 * Format a validation error message for scoped duplicate name validation.
 * Format: <ENTITY_TYPE> ['<row_name>'] has a duplicate name within the same Business Process
 *
 * @param entityType - The entity type (e.g., 'process_activities')
 * @param entityName - The entity's name (for display purposes)
 * @returns Formatted error message
 */
export function formatScopedDuplicateNameErrorMessage(
  entityType: EntityType | string,
  entityName: string | null | undefined
): string {
  const displayEntityType = getEntityTypeDisplayName(entityType);
  const displayName = getEntityDisplayName(entityName);
  return `${displayEntityType} ['${displayName}'] has a duplicate name within the same Business Process`;
}

/**
 * Format a validation error message for scoped interface name uniqueness.
 * Format: INTERFACE ['<interface_name>'] has a duplicate name within the same Service
 *
 * @param interfaceName - The interface's name (for display purposes)
 * @returns Formatted error message
 */
export function formatScopedInterfaceNameErrorMessage(
  interfaceName: string | null | undefined
): string {
  const displayName = getEntityDisplayName(interfaceName);
  return `INTERFACE ['${displayName}'] has a duplicate name within the same Service`;
}

/**
 * Format a validation error message for Interaction reference validation.
 * Format: Interaction '<name>' is missing a <field_description>
 *
 * @param interactionName - The interaction's name
 * @param fieldDescription - Description of the missing/invalid field
 * @returns Formatted error message
 */
export function formatInteractionReferenceErrorMessage(
  interactionName: string | null | undefined,
  fieldDescription: string
): string {
  const displayName = getEntityDisplayName(interactionName);
  return `Interaction '${displayName}' is missing a ${fieldDescription}`;
}

// Helper function to get array or default to empty array
export function getArrayOrDefault(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value !== undefined && value !== null) {
    throw new Error(`Expected array but got ${typeof value}`);
  }
  return [];
}

// Validate required fields for a single entity
export function validateRequiredFields(
  entity: AnyEntity,
  entityType: EntityType,
  columns: GridColumnConfig[]
): ValidationError[] {
  const errors: ValidationError[] = [];
  const entityName = getEntityNameOrId(entity);

  columns.forEach((column) => {
    if (column.required) {
      const value = (entity as unknown as Record<string, unknown>)[column.field];
      if (value === undefined || value === null || value === '') {
        errors.push({
          entityType,
          entityId: entity.id,
          entityName,
          field: column.field,
          message: formatValidationErrorMessage(entityType, entityName, column.field),
          type: 'required',
        });
      }
    }
  });

  return errors;
}

// Validate FK references for a single entity
export function validateFKReferences(
  entity: AnyEntity,
  entityType: EntityType,
  model: ArchitectureModel,
  columns: GridColumnConfig[]
): ValidationError[] {
  const errors: ValidationError[] = [];
  const entityName = getEntityNameOrId(entity);

  columns.forEach((column) => {
    if (column.cellType === 'fk_typeahead' && column.fkTarget) {
      const value = (entity as unknown as Record<string, unknown>)[column.field] as string;
      const fkTarget = column.fkTarget as string;

      // Skip polymorphic FK targets - they are validated by specialized validators
      if (POLYMORPHIC_FK_TARGETS.includes(fkTarget)) {
        return;
      }

      if (value && value !== '') {
        let targetArray: AnyEntity[] = [];

        // Get target array from nested metaModel structure
        if (fkTarget in model.metaModel.entities) {
          targetArray = model.metaModel.entities[fkTarget as keyof typeof model.metaModel.entities] as AnyEntity[];
        }

        if (targetArray && !targetArray.find((item) => item.id === value)) {
          errors.push({
            entityType,
            entityId: entity.id,
            entityName,
            field: column.field,
            message: formatFKValidationErrorMessage(entityType, entityName, column.field),
            type: 'invalid_fk',
          });
        }
      }
    }
  });

  return errors;
}

// Validate unique IDs within an entity type
export function validateUniqueIds(
  entities: AnyEntity[],
  entityType: EntityType
): ValidationError[] {
  const errors: ValidationError[] = [];
  const idCounts = new Map<string, number>();

  entities.forEach((entity) => {
    const count = idCounts.get(entity.id) || 0;
    idCounts.set(entity.id, count + 1);
  });

  entities.forEach((entity) => {
    const count = idCounts.get(entity.id) || 0;
    if (count > 1) {
      errors.push({
        entityType,
        entityId: entity.id,
        entityName: getEntityNameOrId(entity),
        field: 'id',
        message: 'Duplicate ID',
        type: 'duplicate_id',
      });
    }
  });

  return errors;
}

// Validate unique names within an entity type (case-insensitive)
// Returns a ValidationError if a duplicate name is found, null otherwise
export function validateUniqueName(
  entities: AnyEntity[],
  entityType: EntityType,
  currentEntity: AnyEntity
): ValidationError | null {
  // Skip validation for exception tables
  if (DUPLICATE_NAME_EXCEPTION_TABLES.includes(entityType)) {
    return null;
  }

  // Get the current entity's name for comparison
  const entityName = getEntityNameOrId(currentEntity);
  const currentName = entityName?.toLowerCase();
  if (!currentName) {
    return null;
  }

  // Find other entities with the same name (case-insensitive)
  const duplicateExists = entities.some(
    (entity) =>
      entity.id !== currentEntity.id &&
      getEntityNameOrId(entity)?.toLowerCase() === currentName
  );

  if (duplicateExists) {
    return {
      entityType,
      entityId: currentEntity.id,
      entityName,
      field: 'name',
      message: formatDuplicateNameErrorMessage(entityType, entityName),
      type: 'duplicate_name',
    };
  }

  return null;
}

// Validate unique names for all entities in a collection
// Returns an array of ValidationErrors for all duplicates found
export function validateUniqueNames(
  entities: AnyEntity[],
  entityType: EntityType
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Skip validation for exception tables
  if (DUPLICATE_NAME_EXCEPTION_TABLES.includes(entityType)) {
    return errors;
  }

  // Track name occurrences (case-insensitive)
  const nameCounts = new Map<string, number>();
  entities.forEach((entity) => {
    const entityName = getEntityNameOrId(entity);
    const lowerName = entityName?.toLowerCase() || '';
    if (lowerName) {
      const count = nameCounts.get(lowerName) || 0;
      nameCounts.set(lowerName, count + 1);
    }
  });

  // Generate errors for all entities with duplicate names
  entities.forEach((entity) => {
    const entityName = getEntityNameOrId(entity);
    const lowerName = entityName?.toLowerCase() || '';
    if (lowerName && (nameCounts.get(lowerName) || 0) > 1) {
      errors.push({
        entityType,
        entityId: entity.id,
        entityName,
        field: 'name',
        message: formatDuplicateNameErrorMessage(entityType, entityName),
        type: 'duplicate_name',
      });
    }
  });

  return errors;
}

// Validate unique abbreviations for entities with abbreviation field (case-insensitive)
export function validateUniqueAbbreviations(
  entities: AnyEntity[],
  entityType: EntityType
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (entityType !== 'business_users' && entityType !== 'applications') return errors;

  const abbrevCounts = new Map<string, number>();
  entities.forEach((entity) => {
    const abbrev = ((entity as any).abbreviation || '').toLowerCase();
    if (abbrev) {
      abbrevCounts.set(abbrev, (abbrevCounts.get(abbrev) || 0) + 1);
    }
  });

  entities.forEach((entity) => {
    const abbrev = ((entity as any).abbreviation || '').toLowerCase();
    if (abbrev && (abbrevCounts.get(abbrev) || 0) > 1) {
      const entityName = getEntityNameOrId(entity);
      errors.push({
        entityType,
        entityId: entity.id,
        entityName,
        field: 'abbreviation',
        message: `${getEntityTypeDisplayName(entityType)} ['${getEntityDisplayName(entityName)}'] has a duplicate abbreviation`,
        type: 'duplicate_name',
      });
    }
  });

  return errors;
}

/**
 * Validate scoped name uniqueness for ProcessActivity entities.
 * Names must be unique within the same business_process_id.
 *
 * @param activities - Array of all ProcessActivity entities
 * @returns Array of ValidationErrors for duplicates within same process
 */
export function validateScopedUniqueNames(
  activities: ProcessActivity[]
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Group activities by business_process_id
  const activitiesByProcess = new Map<string, ProcessActivity[]>();
  activities.forEach((activity) => {
    const processId = activity.business_process_id || '';
    if (!activitiesByProcess.has(processId)) {
      activitiesByProcess.set(processId, []);
    }
    activitiesByProcess.get(processId)!.push(activity);
  });

  // Check for duplicate names within each process
  activitiesByProcess.forEach((processActivities) => {
    const nameCounts = new Map<string, number>();

    // Count names (case-insensitive)
    processActivities.forEach((activity) => {
      const lowerName = activity.name?.toLowerCase() || '';
      if (lowerName) {
        const count = nameCounts.get(lowerName) || 0;
        nameCounts.set(lowerName, count + 1);
      }
    });

    // Generate errors for duplicates
    processActivities.forEach((activity) => {
      const lowerName = activity.name?.toLowerCase() || '';
      if (lowerName && (nameCounts.get(lowerName) || 0) > 1) {
        errors.push({
          entityType: 'process_activities',
          entityId: activity.id,
          entityName: activity.name,
          field: 'name',
          message: formatScopedDuplicateNameErrorMessage('process_activities', activity.name),
          type: 'duplicate_name',
        });
      }
    });
  });

  return errors;
}

/**
 * Validate scoped name uniqueness for Interface entities.
 * Names must be unique within the same service_id.
 *
 * @param interfaces - Array of all Interface entities
 * @returns Array of ValidationErrors for duplicates within same service
 */
export function validateScopedInterfaceNames(
  interfaces: Interface[]
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Group interfaces by service_id
  const interfacesByService = new Map<string, Interface[]>();
  interfaces.forEach((iface) => {
    const serviceId = iface.service_id || '';
    if (!interfacesByService.has(serviceId)) {
      interfacesByService.set(serviceId, []);
    }
    interfacesByService.get(serviceId)!.push(iface);
  });

  // Check for duplicate names within each service
  interfacesByService.forEach((serviceInterfaces) => {
    const nameCounts = new Map<string, number>();

    // Count names (case-insensitive)
    serviceInterfaces.forEach((iface) => {
      const lowerName = iface.name?.toLowerCase() || '';
      if (lowerName) {
        const count = nameCounts.get(lowerName) || 0;
        nameCounts.set(lowerName, count + 1);
      }
    });

    // Generate errors for duplicates
    serviceInterfaces.forEach((iface) => {
      const lowerName = iface.name?.toLowerCase() || '';
      if (lowerName && (nameCounts.get(lowerName) || 0) > 1) {
        errors.push({
          entityType: 'interfaces',
          entityId: iface.id,
          entityName: iface.name,
          field: 'name',
          message: formatScopedInterfaceNameErrorMessage(iface.name),
          type: 'duplicate_name',
        });
      }
    });
  });

  return errors;
}

// Validate Service application-component consistency
export function validateServiceApplicationConsistency(
  service: Service,
  model: ArchitectureModel
): ValidationError | null {
  // If no app_component_id, no validation needed
  if (!service.app_component_id) {
    return null;
  }

  // Look up the component
  const component = model.metaModel.entities.app_components
    .find(c => c.id === service.app_component_id);

  if (!component) {
    // Component not found - this is a separate FK validation error
    return null;
  }

  const parentAppId = component.application_id;

  // If service has application_id and it doesn't match component's parent
  if (service.application_id && service.application_id !== parentAppId) {
    return {
      entityType: 'services',
      entityId: service.id,
      entityName: service.name,
      field: 'application_id',
      message: formatServiceConsistencyErrorMessage(service.name),
      type: 'consistency',
    };
  }

  return null;
}

/**
 * Validate Interaction entity references.
 *
 * Phase 5: Validates that Interaction entities have valid references:
 * - user_id must reference a valid BusinessUser
 * - primary_app_business_point_id must resolve via resolveAppBusinessPoint()
 * - secondary_app_business_point_id (if present) must resolve via resolveAppBusinessPoint()
 *
 * @param interactions - Array of all Interaction entities
 * @param model - The architecture model for lookups
 * @returns Array of ValidationErrors for invalid references
 */
export function validateInteractionReferences(
  interactions: Interaction[],
  model: ArchitectureModel
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const interaction of interactions) {
    // Validate user_id references a valid BusinessUser
    if (!interaction.user_id) {
      errors.push({
        entityType: 'interactions',
        entityId: interaction.id,
        entityName: interaction.name,
        field: 'user_id',
        message: formatInteractionReferenceErrorMessage(interaction.name, 'user'),
        type: 'required',
      });
    } else {
      const userExists = model.metaModel.entities.business_users.some(
        u => u.id === interaction.user_id
      );
      if (!userExists) {
        errors.push({
          entityType: 'interactions',
          entityId: interaction.id,
          entityName: interaction.name,
          field: 'user_id',
          message: formatInteractionReferenceErrorMessage(interaction.name, 'valid user reference'),
          type: 'invalid_fk',
        });
      }
    }

    // Validate primary_app_business_point_id resolves via resolveAppBusinessPoint
    if (!interaction.primary_app_business_point_id) {
      errors.push({
        entityType: 'interactions',
        entityId: interaction.id,
        entityName: interaction.name,
        field: 'primary_app_business_point_id',
        message: formatInteractionReferenceErrorMessage(interaction.name, 'primary App Business Point'),
        type: 'required',
      });
    } else {
      const resolved = resolveAppBusinessPoint(interaction.primary_app_business_point_id, model.metaModel);
      if (!resolved) {
        errors.push({
          entityType: 'interactions',
          entityId: interaction.id,
          entityName: interaction.name,
          field: 'primary_app_business_point_id',
          message: formatInteractionReferenceErrorMessage(interaction.name, 'valid primary App Business Point reference'),
          type: 'invalid_fk',
        });
      }
    }

    // Validate secondary_app_business_point_id if present
    if (interaction.secondary_app_business_point_id) {
      const resolved = resolveAppBusinessPoint(interaction.secondary_app_business_point_id, model.metaModel);
      if (!resolved) {
        errors.push({
          entityType: 'interactions',
          entityId: interaction.id,
          entityName: interaction.name,
          field: 'secondary_app_business_point_id',
          message: formatInteractionReferenceErrorMessage(interaction.name, 'valid secondary App Business Point reference'),
          type: 'invalid_fk',
        });
      }
    }
  }

  return errors;
}

/**
 * Validate StateTransition references.
 * - from_state_id must reference a valid State
 * - to_state_id must reference a valid State
 *
 * @param transitions - Array of all StateTransition entities
 * @param model - The architecture model for lookups
 * @returns Array of ValidationErrors for invalid references
 */
export function validateStateTransitionReferences(
  transitions: StateTransition[],
  model: ArchitectureModel
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const transition of transitions) {
    // Validate from_state_id references a valid State
    if (!transition.from_state_id) {
      errors.push({
        entityType: 'state_transitions',
        entityId: transition.id,
        entityName: transition.id, // StateTransition uses id as identifier
        field: 'from_state_id',
        message: `STATE_TRANSITION ['${transition.id}'] requires a value in field 'from_state_id'`,
        type: 'required',
      });
    } else {
      const stateExists = model.metaModel.entities.states.some(
        s => s.id === transition.from_state_id
      );
      if (!stateExists) {
        errors.push({
          entityType: 'state_transitions',
          entityId: transition.id,
          entityName: transition.id,
          field: 'from_state_id',
          message: `STATE_TRANSITION ['${transition.id}'] requires a valid reference in field 'from_state_id'`,
          type: 'invalid_fk',
        });
      }
    }

    // Validate to_state_id references a valid State
    if (!transition.to_state_id) {
      errors.push({
        entityType: 'state_transitions',
        entityId: transition.id,
        entityName: transition.id,
        field: 'to_state_id',
        message: `STATE_TRANSITION ['${transition.id}'] requires a value in field 'to_state_id'`,
        type: 'required',
      });
    } else {
      const stateExists = model.metaModel.entities.states.some(
        s => s.id === transition.to_state_id
      );
      if (!stateExists) {
        errors.push({
          entityType: 'state_transitions',
          entityId: transition.id,
          entityName: transition.id,
          field: 'to_state_id',
          message: `STATE_TRANSITION ['${transition.id}'] requires a valid reference in field 'to_state_id'`,
          type: 'invalid_fk',
        });
      }
    }
  }

  return errors;
}

/**
 * Validate ActivityFlow references.
 * - from_activity_id must reference a valid Activity
 * - to_activity_id must reference a valid Activity
 *
 * @param flows - Array of all ActivityFlow entities
 * @param model - The architecture model for lookups
 * @returns Array of ValidationErrors for invalid references
 */
export function validateActivityFlowReferences(
  flows: ActivityFlow[],
  model: ArchitectureModel
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const flow of flows) {
    // Validate from_activity_id references a valid Activity
    if (!flow.from_activity_id) {
      errors.push({
        entityType: 'activity_flows',
        entityId: flow.id,
        entityName: flow.id, // ActivityFlow uses id as identifier
        field: 'from_activity_id',
        message: `ACTIVITY_FLOW ['${flow.id}'] requires a value in field 'from_activity_id'`,
        type: 'required',
      });
    } else {
      const activityExists = model.metaModel.entities.activities.some(
        a => a.id === flow.from_activity_id
      );
      if (!activityExists) {
        errors.push({
          entityType: 'activity_flows',
          entityId: flow.id,
          entityName: flow.id,
          field: 'from_activity_id',
          message: `ACTIVITY_FLOW ['${flow.id}'] requires a valid reference in field 'from_activity_id'`,
          type: 'invalid_fk',
        });
      }
    }

    // Validate to_activity_id references a valid Activity
    if (!flow.to_activity_id) {
      errors.push({
        entityType: 'activity_flows',
        entityId: flow.id,
        entityName: flow.id,
        field: 'to_activity_id',
        message: `ACTIVITY_FLOW ['${flow.id}'] requires a value in field 'to_activity_id'`,
        type: 'required',
      });
    } else {
      const activityExists = model.metaModel.entities.activities.some(
        a => a.id === flow.to_activity_id
      );
      if (!activityExists) {
        errors.push({
          entityType: 'activity_flows',
          entityId: flow.id,
          entityName: flow.id,
          field: 'to_activity_id',
          message: `ACTIVITY_FLOW ['${flow.id}'] requires a valid reference in field 'to_activity_id'`,
          type: 'invalid_fk',
        });
      }
    }
  }

  return errors;
}

// ============================================================================
// Save-Validation Improvement Series Step 3:
// Frontend pre-save validators that mirror backend rules in
// architecture-model-service ModelService.java. The error messages mirror the
// backend wording so the same rule reads identically whether caught early
// (frontend pre-save) or late (backend save).
// ============================================================================

/**
 * Allowed values for UserJourneyLink.relationship_type.
 * Mirrors backend ModelService.java:1671 (allowedTypes set).
 */
export const VALID_USER_JOURNEY_LINK_RELATIONSHIP_TYPES = [
  'RELATES_TO',
  'PRECEDES',
  'DEPENDS_ON',
  'OPTIONALLY_LEADS_TO',
  'TRIGGERS',
] as const;

/**
 * Validator 1 - UIAction conditional contract_id.
 *
 * Mirrors backend rule (ModelService.java:1968-1973):
 *   If effect_type === 'CALL_API', then contract_id must be set.
 *
 * Note: The frontend UIAction type does not yet declare contract_id, so we
 * read it dynamically. Empty / null / blank-string values all count as missing.
 *
 * @param uiActions - Array of all UIAction entities
 * @returns Array of ValidationErrors (one per offending UIAction)
 */
export function validateUIActionContractId(uiActions: UIAction[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const action of uiActions) {
    const effectType = action.effect_type;
    if (typeof effectType === 'string' && effectType.toUpperCase() === 'CALL_API') {
      const contractId = (action as unknown as Record<string, unknown>).contract_id;
      const isBlank =
        contractId === undefined ||
        contractId === null ||
        (typeof contractId === 'string' && contractId.trim() === '');
      if (isBlank) {
        errors.push({
          entityType: 'ui_actions',
          entityId: action.id,
          entityName: action.name,
          field: 'contract_id',
          message: `UIAction ['${action.name}'] requires contract_id when effect_type is 'CALL_API'`,
          type: 'conditional_required',
        });
      }
    }
  }

  return errors;
}

/**
 * Validator 2 - LogicalDataEntityRelationship endpoints required.
 *
 * Mirrors backend rule (ModelService.java:1888-1902):
 *   Both fromDataEntityPointId and toDataEntityPointId must be non-blank.
 *
 * The frontend type uses camelCase (fromDataEntityPointId / toDataEntityPointId),
 * so we use those exact field names.
 *
 * @param rels - Array of all LogicalDataEntityRelationship entities
 * @returns Array of ValidationErrors - one per missing endpoint per row
 */
export function validateLogicalDataEntityRelationshipEndpoints(
  rels: LogicalDataEntityRelationship[]
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const rel of rels) {
    const identifier = rel.id;
    const fromBlank = !rel.fromDataEntityPointId || rel.fromDataEntityPointId.trim() === '';
    const toBlank = !rel.toDataEntityPointId || rel.toDataEntityPointId.trim() === '';

    if (fromBlank) {
      errors.push({
        entityType: 'logical_data_entity_relationships',
        entityId: rel.id,
        entityName: identifier,
        field: 'fromDataEntityPointId',
        message: `LOGICAL_DATA_ENTITY_RELATIONSHIP [${identifier}] is missing required field 'fromDataEntityPointId'`,
        type: 'missing_reference',
      });
    }

    if (toBlank) {
      errors.push({
        entityType: 'logical_data_entity_relationships',
        entityId: rel.id,
        entityName: identifier,
        field: 'toDataEntityPointId',
        message: `LOGICAL_DATA_ENTITY_RELATIONSHIP [${identifier}] is missing required field 'toDataEntityPointId'`,
        type: 'missing_reference',
      });
    }
  }

  return errors;
}

/**
 * Validator 3 - UserJourneyLink relationship_type enum.
 *
 * Mirrors backend rule (ModelService.java:1671-1678):
 *   relationship_type must be one of: RELATES_TO, PRECEDES, DEPENDS_ON,
 *   OPTIONALLY_LEADS_TO, TRIGGERS.
 *
 * Empty / null / undefined relationship_type is NOT flagged here. The audit
 * excerpt only mentions the enum-valid check; required-ness is left to the
 * grid's required-field validation if applicable.
 *
 * @param links - Array of all UserJourneyLink entities
 * @returns Array of ValidationErrors (one per offending link)
 */
export function validateUserJourneyLinkRelationshipType(
  links: UserJourneyLink[]
): ValidationError[] {
  const errors: ValidationError[] = [];
  const allowed: readonly string[] = VALID_USER_JOURNEY_LINK_RELATIONSHIP_TYPES;

  for (const link of links) {
    const value = link.relationship_type as unknown as string | undefined | null;
    // Skip blank values per spec note.
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      continue;
    }
    if (!allowed.includes(value)) {
      errors.push({
        entityType: 'user_journey_links',
        entityId: link.id,
        entityName: link.label || link.id,
        field: 'relationship_type',
        message: `USER_JOURNEY_LINK [${link.id}] has invalid relationship_type '${value}'. Allowed values: RELATES_TO, PRECEDES, DEPENDS_ON, OPTIONALLY_LEADS_TO, TRIGGERS`,
        type: 'invalid_enum',
      });
    }
  }

  return errors;
}

/**
 * Validator 4 - ApplicationPoint target_type / target_ref_id pairwise.
 *
 * Mirrors backend rule (ModelService.java:1815):
 *   target_type and target_ref_id must both be set or both be blank/null.
 *
 * If exactly one of the two is set, emit a pairwise_constraint error. The
 * `field` is set to whichever one IS populated (caller can highlight the
 * partner column based on the message text).
 *
 * @param aps - Array of all ApplicationPoint entities
 * @returns Array of ValidationErrors (one per offending AP)
 */
export function validateApplicationPointTargetPairwise(
  aps: ApplicationPoint[]
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const ap of aps) {
    const typeSet =
      ap.target_type !== undefined && ap.target_type !== null && String(ap.target_type).trim() !== '';
    const refSet =
      ap.target_ref_id !== undefined && ap.target_ref_id !== null && String(ap.target_ref_id).trim() !== '';

    if (typeSet !== refSet) {
      errors.push({
        entityType: 'application_points',
        entityId: ap.id,
        entityName: ap.name,
        field: typeSet ? 'target_type' : 'target_ref_id',
        message: `APPLICATION_POINT ['${ap.name}'] requires both target_type and target_ref_id, or neither`,
        type: 'pairwise_constraint',
      });
    }
  }

  return errors;
}

/**
 * Validate diagram name for creating new diagrams.
 *
 * @param name - The diagram name to validate
 * @param existingDiagrams - Array of existing diagrams to check for duplicates
 * @returns Error message string if validation fails, null if valid
 */
export function validateDiagramName(name: string, existingDiagrams: Diagram[]): string | null {
  const trimmedName = name.trim();

  // Check for empty name
  if (trimmedName === '') {
    return 'Please enter a diagram name before creating a new diagram.';
  }

  // Check for duplicate name (case-sensitive)
  const isDuplicate = existingDiagrams.some(diagram => diagram.name === trimmedName);
  if (isDuplicate) {
    return 'A diagram with this name already exists. Please choose a different name.';
  }

  // Valid name
  return null;
}

// =========================================
// Pre-Validation and Pre-Save Sync Functions
// =========================================

/**
 * Prepare model for validation by synchronizing Application Point names.
 *
 * KEY DESIGN PRINCIPLE: `application_point.name` is a derived field.
 * This function ensures AP names are aligned with source entity names
 * BEFORE validation runs.
 *
 * @param model - The architecture model to prepare
 * @returns Model with synchronized Application Point names
 */
export function prepareModelForValidation(model: ArchitectureModel): ArchitectureModel {
  // Sync Application Point names with their source entities
  const syncedApplicationPoints = syncApplicationPointNames(
    model.metaModel.entities.application_points,
    model.metaModel.entities
  );

  return {
    ...model,
    metaModel: {
      ...model.metaModel,
      entities: {
        ...model.metaModel.entities,
        application_points: syncedApplicationPoints,
      },
    },
  };
}

/**
 * Prepare model for save by reconciling all derived entity types.
 *
 * KEY DESIGN PRINCIPLE: Derived entities (ApplicationPoints, BusinessPoints, AppBusinessPoints)
 * have names and FK fields that are derived from their source entities.
 * This function ensures:
 * 1. All derived entity names are aligned with source entity names
 * 2. All derived entity FK fields are aligned with source entity FKs
 * 3. Missing derived entities are created
 * 4. Orphaned derived entities are removed
 *
 * This is more comprehensive than prepareModelForValidation because
 * saved JSON should have a fully reconciled state.
 *
 * Order matters: AP/BP must be correct before ABP references are rebuilt.
 *
 * @param model - The architecture model to prepare for save
 * @returns Model with fully reconciled derived entities
 */
export function prepareModelForSave(model: ArchitectureModel): ArchitectureModel {
  // Run full reconciliation for all derived entity types
  // Order matters: AP/BP must be correct before ABP references are rebuilt

  // 1. Reconcile Application Points (creates missing, fixes FK fields, removes orphans)
  let reconciledMetaModel = reconcileApplicationPoints(model.metaModel);

  // 1b. Fix #6a: ensure a DERIVED ApplicationPoint exists for every Service
  // (target_type='SERVICE', target_ref_id=service.id). This is required by the
  // discovery-service Service-rooted run flow (Fix #5) so a Service created in
  // the Grid can be discovered immediately after save without a separate
  // picker step. The legacy reconcileApplicationPoints pass above creates the
  // `ap_{service.id}` AP (kind='SERVICE') but does NOT set target_type/
  // target_ref_id; this step adds the canonical derived AP keyed by the
  // (target_type, target_ref_id) tuple that the discovery-service queries.
  reconciledMetaModel = {
    entities: ensureDerivedApplicationPointsForServices(reconciledMetaModel.entities),
    relationships: reconciledMetaModel.relationships,
  };

  // 2. Reconcile Business Points (creates missing, fixes FK fields, removes orphans)
  reconciledMetaModel = reconcileBusinessPoints(reconciledMetaModel);

  // 3. Reconcile App Business Points (ensures ABPs stay consistent)
  reconciledMetaModel = reconcileAppBusinessPoints(reconciledMetaModel);

  // 4. Remove orphaned diagram nodes (nodes referencing non-existent entities)
  const cleanedDiagrams = removeOrphanedDiagramNodes(model.diagrams, reconciledMetaModel.entities);

  return {
    ...model,
    diagrams: cleanedDiagrams,
    metaModel: reconciledMetaModel,
  };
}

/**
 * Remove diagram nodes that reference non-existent entities, and edges
 * that reference removed nodes. This handles data inconsistencies that
 * can arise when entities are deleted or re-imported with different IDs.
 *
 * Uses DIAGRAM_NODE_ENTITY_TYPE_MAP to resolve entity_type to the correct
 * metaModel.entities array for lookup.
 *
 * @param diagrams - The model's diagrams array
 * @param entities - The reconciled metaModel entities
 * @returns Cleaned diagrams with orphaned nodes/edges removed
 */
function removeOrphanedDiagramNodes(
  diagrams: Diagram[],
  entities: ArchitectureModel['metaModel']['entities']
): Diagram[] {
  // Build a set of all entity IDs keyed by their entity array key
  const entityIdSets: Record<string, Set<string>> = {};
  for (const [key, arr] of Object.entries(entities)) {
    if (Array.isArray(arr)) {
      entityIdSets[key] = new Set((arr as AnyEntity[]).map(e => e.id));
    }
  }

  // Extended entity type map (same as validation uses)
  const entityTypeMap: Record<string, string> = {
    ...DIAGRAM_NODE_ENTITY_TYPE_MAP,
    APP_BUSINESS_POINT: 'app_business_points',
    STATE_TRANSITION: 'state_transitions',
    ACTIVITY_FLOW: 'activity_flows',
  };

  let totalNodesRemoved = 0;
  let totalEdgesRemoved = 0;

  const cleanedDiagrams = diagrams.map(diagram => {
    const originalNodes = diagram.diagram_nodes || [];
    const originalEdges = diagram.diagram_edges || [];

    // Filter out nodes referencing non-existent entities
    const validNodes = originalNodes.filter((node: DiagramNode) => {
      const targetType = entityTypeMap[node.entity_type];
      if (!targetType) return true; // Unknown type — keep (validation will catch separately)

      const idSet = entityIdSets[targetType];
      if (!idSet) return true; // No entity array for this type — keep

      return idSet.has(node.entity_id);
    });

    const removedNodeCount = originalNodes.length - validNodes.length;
    if (removedNodeCount === 0) return diagram; // No changes needed

    totalNodesRemoved += removedNodeCount;

    // Build set of remaining node IDs for edge cleanup
    const validNodeIds = new Set(validNodes.map((n: DiagramNode) => n.id));

    // Filter out edges referencing removed nodes
    const validEdges = originalEdges.filter(edge =>
      validNodeIds.has(edge.source_node_id) && validNodeIds.has(edge.target_node_id)
    );
    totalEdgesRemoved += originalEdges.length - validEdges.length;

    // Also clean up parent_node_id references to removed nodes
    const cleanedNodes = validNodes.map((node: DiagramNode) => {
      if (node.parent_node_id && !validNodeIds.has(node.parent_node_id)) {
        return { ...node, parent_node_id: null };
      }
      return node;
    });

    return {
      ...diagram,
      diagram_nodes: cleanedNodes,
      diagram_edges: validEdges,
    };
  });

  if (totalNodesRemoved > 0) {
    console.warn(
      `Removed ${totalNodesRemoved} orphaned diagram node(s) and ${totalEdgesRemoved} associated edge(s) referencing non-existent entities`
    );
  }

  return cleanedDiagrams;
}

// Validate entire model
export function validateModel(model: ArchitectureModel): ValidationError[] {
  const errors: ValidationError[] = [];

  // PRE-VALIDATION SYNC: Ensure AP names are aligned with source entities
  // KEY DESIGN PRINCIPLE: `application_point.name` is a derived field.
  // Sync must happen before validation to prevent false positives.
  const syncedModel = prepareModelForValidation(model);

  // Entity types to validate
  const entityTypes: EntityType[] = [
    'business_users',
    'business_processes',
    'process_activities',
    'interactions',
    'applications',
    'app_components',
    'services',
    'interfaces',
    'application_points',
    'logical_data_entities',
    'logical_data_attributes',
    'physical_data_entities',
    'physical_data_attributes',
    'events',
    'states',
    'state_transitions',
    'activities',
    'activity_flows',
    'activity_partitions',
    'ui_screens',  // Spec 2026-01-02: UI Architecture
    'ui_components',  // Spec 2026-01-03: Meta-Model UI Domain Tab
    'ui_actions',  // Spec 2026-01-03: Meta-Model UI Domain Tab
    'business_logics',  // Spec: Business Logic Entity v1
    'ui_characteristics',  // Spec 2026-01-20: UI Characteristics
    'user_journeys',  // Spec 2026-04-01: User Journey & Activity Step Business Architecture
    'activity_steps',  // Spec 2026-04-01: User Journey & Activity Step Business Architecture
  ];

  entityTypes.forEach((entityType) => {
    const entities = syncedModel.metaModel.entities[entityType] as AnyEntity[];
    const columns = gridConfigs[entityType];

    if (!columns || !entities) return;

    // Check for duplicate IDs
    const uniqueIdErrors = validateUniqueIds(entities, entityType);
    errors.push(...uniqueIdErrors);

    // Check for duplicate names (case-insensitive, skips exception tables)
    // Note: process_activities and interfaces use scoped uniqueness validation instead
    if (entityType !== 'process_activities' && entityType !== 'interfaces') {
      const uniqueNameErrors = validateUniqueNames(entities, entityType);
      errors.push(...uniqueNameErrors);
    }

    // Check for duplicate abbreviations (business_users only)
    const uniqueAbbrevErrors = validateUniqueAbbreviations(entities, entityType);
    errors.push(...uniqueAbbrevErrors);

    // Validate each entity
    entities.forEach((entity) => {
      // Required fields
      const requiredErrors = validateRequiredFields(entity, entityType, columns);
      errors.push(...requiredErrors);

      // FK references
      const fkErrors = validateFKReferences(entity, entityType, syncedModel, columns);
      errors.push(...fkErrors);
    });
  });

  // ActivityStep-specific validations: sequence_order positive-integer check
  // Spec 2026-04-01: User Journey & Activity Step Business Architecture
  const activitySteps = syncedModel.metaModel.entities.activity_steps || [];
  activitySteps.forEach((step: any) => {
    const seqOrder = step.sequence_order;
    if (seqOrder !== undefined && seqOrder !== null && seqOrder !== '') {
      const parsed = Number(seqOrder);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        errors.push({
          entityType: 'activity_steps',
          entityId: step.id,
          field: 'sequence_order',
          message: `Sequence order must be a positive integer`,
          type: 'required',
          entityName: step.name,
        });
      }
    }
  });

  // ProcessActivity-specific validations
  const processActivities = syncedModel.metaModel.entities.process_activities || [];

  // Scoped name uniqueness (within same business_process_id)
  const scopedNameErrors = validateScopedUniqueNames(processActivities);
  errors.push(...scopedNameErrors);

  // Interface-specific validations
  const interfaces = syncedModel.metaModel.entities.interfaces || [];

  // Scoped name uniqueness (within same service_id)
  const scopedInterfaceNameErrors = validateScopedInterfaceNames(interfaces);
  errors.push(...scopedInterfaceNameErrors);

  // Service application-component consistency validation
  for (const service of syncedModel.metaModel.entities.services) {
    const error = validateServiceApplicationConsistency(service, syncedModel);
    if (error) {
      errors.push(error);
    }
  }

  // Phase 5: Interaction reference validation
  const interactions = syncedModel.metaModel.entities.interactions || [];
  const interactionErrors = validateInteractionReferences(interactions, syncedModel);
  errors.push(...interactionErrors);

  // StateTransition reference validation
  const stateTransitions = syncedModel.metaModel.entities.state_transitions || [];
  const stateTransitionErrors = validateStateTransitionReferences(stateTransitions, syncedModel);
  errors.push(...stateTransitionErrors);

  // ActivityFlow reference validation
  const activityFlows = syncedModel.metaModel.entities.activity_flows || [];
  const activityFlowErrors = validateActivityFlowReferences(activityFlows, syncedModel);
  errors.push(...activityFlowErrors);

  // ============================================================================
  // Spec 2026-01-11: Data Movement XOR Validation
  // Validates that exactly one of dataEntityPointId OR interfaceWithSchemaId is set
  // ============================================================================
  const dataMovements = syncedModel.metaModel.relationships?.data_movements || [];
  for (const dm of dataMovements) {
    const xorErrors = validateDataMovementXOR(dm as DataMovement);
    errors.push(...xorErrors);
  }

  // ============================================================================
  // Save-Validation Improvement Series Step 3 - Frontend pre-save validators
  // mirroring backend rules (architecture-model-service ModelService.java).
  // ============================================================================
  errors.push(
    ...validateUIActionContractId(syncedModel.metaModel.entities.ui_actions ?? [])
  );
  errors.push(
    ...validateLogicalDataEntityRelationshipEndpoints(
      syncedModel.metaModel.relationships?.logical_data_entity_relationships ?? []
    )
  );
  errors.push(
    ...validateUserJourneyLinkRelationshipType(
      syncedModel.metaModel.relationships?.user_journey_links ?? []
    )
  );
  errors.push(
    ...validateApplicationPointTargetPairwise(
      syncedModel.metaModel.entities.application_points ?? []
    )
  );


  // Use centralized entity type registry with additional types for relationship entities
  // that may also appear as diagram nodes in validation
  const entityTypeMap: Record<string, keyof typeof syncedModel.metaModel.entities> = {
    ...DIAGRAM_NODE_ENTITY_TYPE_MAP,
    // Additional types for relationship entities (not typically diagram nodes but validated for completeness)
    APP_BUSINESS_POINT: 'app_business_points',
    STATE_TRANSITION: 'state_transitions',
    ACTIVITY_FLOW: 'activity_flows',
    UI_WORKFLOW_TRANSITION: 'ui_screens',  // Spec 2026-01-02: UI_WORKFLOW_TRANSITION validates against ui_screens for endpoint resolution
  };

  // Validate diagram references - iterate through diagrams and their nested nodes/edges
  syncedModel.diagrams.forEach((diagram) => {
    const diagramNodes = diagram.diagram_nodes || [];
    const diagramEdges = diagram.diagram_edges || [];

    // Validate nodes within this diagram
    diagramNodes.forEach((node) => {
      // Check entity exists
      const targetType = entityTypeMap[node.entity_type];
      if (targetType) {
        const targetArray = syncedModel.metaModel.entities[targetType] as AnyEntity[];
        if (!targetArray.find((e) => e.id === node.entity_id)) {
          errors.push({
            entityType: 'diagram_nodes',
            entityId: node.id,
            field: 'entity_id',
            message: `Invalid reference: Node ${node.id} references non-existent entity ${node.entity_id}`,
            type: 'invalid_fk',
          });
        }
      } else if (node.entity_type) {
        errors.push({
          entityType: 'diagram_nodes',
          entityId: node.id,
          field: 'entity_type',
          message: `Unknown entity type: ${node.entity_type}`,
          type: 'invalid_fk',
        });
      }

      // Check parent node exists if specified (within same diagram)
      if (node.parent_node_id) {
        if (!diagramNodes.find((n) => n.id === node.parent_node_id)) {
          errors.push({
            entityType: 'diagram_nodes',
            entityId: node.id,
            field: 'parent_node_id',
            message: `Invalid reference: Node ${node.id} references non-existent parent node ${node.parent_node_id}`,
            type: 'invalid_fk',
          });
        }
      }
    });

    // Validate edges within this diagram
    diagramEdges.forEach((edge) => {
      // Check source node exists within this diagram
      if (!diagramNodes.find((n) => n.id === edge.source_node_id)) {
        errors.push({
          entityType: 'diagram_edges',
          entityId: edge.id,
          field: 'source_node_id',
          message: `Invalid reference: Edge ${edge.id} references non-existent source node ${edge.source_node_id}`,
          type: 'invalid_fk',
        });
      }

      // Check target node exists within this diagram
      if (!diagramNodes.find((n) => n.id === edge.target_node_id)) {
        errors.push({
          entityType: 'diagram_edges',
          entityId: edge.id,
          field: 'target_node_id',
          message: `Invalid reference: Edge ${edge.id} references non-existent target node ${edge.target_node_id}`,
          type: 'invalid_fk',
        });
      }
    });
  });

  return errors;
}

// Validate loaded JSON structure - permissive validation
export function validateJsonStructure(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof data !== 'object' || data === null) {
    errors.push({
      entityType: 'root',
      entityId: '',
      field: '',
      message: 'Invalid model: JSON must be an object',
      type: 'invalid_json',
    });
    return errors;
  }

  const obj = data as Record<string, unknown>;

  // Check nested structure if metaModel exists
  if (obj.metaModel !== undefined && obj.metaModel !== null) {
    if (typeof obj.metaModel !== 'object') {
      errors.push({
        entityType: 'root',
        entityId: '',
        field: 'metaModel',
        message: 'Invalid model: metaModel must be an object',
        type: 'invalid_json',
      });
      return errors;
    }

    const metaModel = obj.metaModel as Record<string, unknown>;

    // Check entities if present
    if (metaModel.entities !== undefined && metaModel.entities !== null) {
      if (typeof metaModel.entities !== 'object') {
        errors.push({
          entityType: 'root',
          entityId: '',
          field: 'metaModel.entities',
          message: 'Invalid model: entities must be an object',
          type: 'invalid_json',
        });
      } else {
        const entities = metaModel.entities as Record<string, unknown>;
        const entityArrays = [
          'business_users',
          'business_processes',
          'business_points',
          'process_activities',
          'applications',
          'app_components',
          'services',
          'interfaces',
          'endpoints',
          'application_points',
          'logical_data_entities',
          'logical_data_attributes',
          'physical_data_entities',
          'physical_data_attributes',
          'interactions',
          'app_business_points',  // New: App Business Point lookup entities
          'events',  // Behavioural domain: Events
          'classes',
          'methods',
          'states',  // Behavioural domain: States
          'state_transitions',  // Behavioural domain: State Transitions
          'activities',  // Behavioural domain: Activities
          'activity_flows',  // Behavioural domain: Activity Flows
          'activity_partitions',  // Behavioural domain: Activity Partitions
          'ui_screens',  // Spec 2026-01-02: UI Architecture
          'ui_components',  // Spec 2026-01-03: Meta-Model UI Domain Tab
          'ui_actions',  // Spec 2026-01-03: Meta-Model UI Domain Tab
          'business_logics',  // Spec: Business Logic Entity v1
          'ui_characteristics',  // Spec 2026-01-20: UI Characteristics
        ];

        entityArrays.forEach((arrayName) => {
          const value = entities[arrayName];
          if (value !== undefined && value !== null && !Array.isArray(value)) {
            errors.push({
              entityType: 'root',
              entityId: '',
              field: `metaModel.entities.${arrayName}`,
              message: `Invalid model: '${arrayName}' must be an array`,
              type: 'invalid_json',
            });
          }
        });
      }
    }

    // Check relationships if present
    if (metaModel.relationships !== undefined && metaModel.relationships !== null) {
      if (typeof metaModel.relationships !== 'object') {
        errors.push({
          entityType: 'root',
          entityId: '',
          field: 'metaModel.relationships',
          message: 'Invalid model: relationships must be an object',
          type: 'invalid_json',
        });
      } else {
        const relationships = metaModel.relationships as Record<string, unknown>;
        const relationshipArrays = [
          'business_user_business_points',
          'application_point_business_points',
          'logical_data_entity_relationships',
          'logical_data_entity_physical_data_entities',
          'logical_data_attribute_physical_data_attributes',
          'data_movements',
          'interface_logical_entities',
          'ui_workflow_transitions',  // Spec 2026-01-02: UI Architecture
          'application_point_business_logics',  // Spec: Business Logic Entity v1
        ];

        relationshipArrays.forEach((arrayName) => {
          const value = relationships[arrayName];
          if (value !== undefined && value !== null && !Array.isArray(value)) {
            errors.push({
              entityType: 'root',
              entityId: '',
              field: `metaModel.relationships.${arrayName}`,
              message: `Invalid model: '${arrayName}' must be an array`,
              type: 'invalid_json',
            });
          }
        });
      }
    }
  }

  // Check diagrams array at root level
  if (obj.diagrams !== undefined && obj.diagrams !== null && !Array.isArray(obj.diagrams)) {
    errors.push({
      entityType: 'root',
      entityId: '',
      field: 'diagrams',
      message: `Invalid model: 'diagrams' must be an array`,
      type: 'invalid_json',
    });
  }

  return errors;
}

// Get validation errors for a specific cell
export function getCellValidationError(
  entityId: string,
  field: string,
  errors: ValidationError[]
): ValidationError | undefined {
  return errors.find(
    (error) => error.entityId === entityId && error.field === field
  );
}

// Check if model has validation errors
export function hasValidationErrors(errors: ValidationError[]): boolean {
  return errors.length > 0;
}

/**
 * Advanced Add Relationships Utility
 *
 * Defines expandable relationships for the Advanced Add dialog.
 * Maps each entity type to its parent/child and association relationships
 * that can be used for flexible graph expansion.
 */

import { ENTITY_TYPES } from '../types/model';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Relationship kind: parent/child (containment) or association (logical link)
 */
export type RelationshipKind = 'PARENT_CHILD' | 'ASSOCIATION';

/**
 * Direction of relationship traversal from the root entity
 * - CHILD: traverse to child entities (root is parent)
 * - PARENT: traverse to parent entity (root is child)
 * - ASSOCIATION: traverse bidirectionally via association table
 * - UNDERLYING: resolve super-entities (e.g., Business Point) to their underlying
 *   entities (e.g., Business Process or Process Activity). Used when a "point"
 *   entity abstracts multiple concrete entity types and needs to be resolved
 *   to show the actual underlying entity in the tree view.
 * - POLYMORPHIC: resolve via polymorphic resolver function (e.g., resolveAppBusinessPoint)
 */
export type RelationshipDirection = 'CHILD' | 'PARENT' | 'ASSOCIATION' | 'UNDERLYING' | 'POLYMORPHIC';

/**
 * Describes an expandable relationship for the tree view
 */
export interface ExpandableRelationship {
  /** Target entity type that can be expanded to */
  targetEntityType: string;
  /** Kind of relationship (parent/child vs association) */
  relationshipKind: RelationshipKind;
  /** Direction of traversal from the root entity */
  direction: RelationshipDirection;
  /** Name of the relationship table (for associations) or entity table */
  relationshipTableName: string;
  /** Foreign key field used in the relationship */
  foreignKeyField: string;
  /** Display label for the tree node */
  displayLabel?: string;
  /**
   * Display label prefix for polymorphic relationships.
   * Used to show "User: ", "Primary: ", "Secondary: " prefixes.
   */
  displayLabelPrefix?: string;
  /**
   * Indicates how this relationship should be rendered on diagrams.
   *
   * - `true` (CONTAINMENT): Renders as nested boxes. The target entity is drawn
   *   inside the source entity as a child container. No edge lines are drawn.
   *   Examples: Application -> App Component, Business Process -> Process Activity,
   *   Application -> Business Process (via App Point/Business Point), Interface -> Logical Entity.
   *
   * - `false` (EDGE_ONLY): Renders as edge lines between nodes. The target entity
   *   is drawn separately and connected with a line/arrow.
   *   Examples: User -> Business Point, Logical ER relationships, Data Movements.
   */
  actsAsContainment: boolean;
  /**
   * For POLYMORPHIC relationships, indicates if the target is optional.
   * Used for secondary_app_business_point_id which may be undefined.
   */
  isOptional?: boolean;
}

// ============================================================================
// Expandable Relationships Map
// ============================================================================

/**
 * Map of entity types to their expandable relationships.
 *
 * Each entry defines what related entities can be added when
 * expanding from that entity type in the Advanced Add dialog.
 */
export const EXPANDABLE_RELATIONSHIPS: Record<string, ExpandableRelationship[]> = {
  // APPLICATION can expand to:
  // - AppComponents (parent/child, direction: CHILD)
  // - Services (parent/child, direction: CHILD)
  // - BusinessProcesses (association via ApplicationPointBusinessPoint - targets concrete type)
  // - ProcessActivities (association via ApplicationPointBusinessPoint - targets concrete type)
  // NOTE: BUSINESS_POINT is NOT a target - we always target concrete types
  [ENTITY_TYPES.APPLICATION]: [
    {
      targetEntityType: ENTITY_TYPES.APP_COMPONENT,
      relationshipKind: 'PARENT_CHILD',
      direction: 'CHILD',
      relationshipTableName: 'app_components',
      foreignKeyField: 'application_id',
      displayLabel: 'App Components',
      actsAsContainment: true,
    },
    {
      targetEntityType: ENTITY_TYPES.SERVICE,
      relationshipKind: 'PARENT_CHILD',
      direction: 'CHILD',
      relationshipTableName: 'services',
      foreignKeyField: 'application_id',
      displayLabel: 'Services',
      actsAsContainment: true,
    },
    {
      targetEntityType: ENTITY_TYPES.BUSINESS_PROCESS,
      relationshipKind: 'ASSOCIATION',
      direction: 'ASSOCIATION',
      relationshipTableName: 'application_point_business_points',
      foreignKeyField: 'application_point_id',
      displayLabel: 'Business Processes',
      actsAsContainment: true,
    },
    {
      targetEntityType: ENTITY_TYPES.PROCESS_ACTIVITY,
      relationshipKind: 'ASSOCIATION',
      direction: 'ASSOCIATION',
      relationshipTableName: 'application_point_business_points',
      foreignKeyField: 'application_point_id',
      displayLabel: 'Process Activities',
      actsAsContainment: true,
    },
  ],

  // BUSINESS_PROCESS can expand to:
  // - ProcessActivities (parent/child, direction: CHILD)
  // - Applications (association via ApplicationPointBusinessPoint - reverse direction, edge-only)
  [ENTITY_TYPES.BUSINESS_PROCESS]: [
    {
      targetEntityType: ENTITY_TYPES.PROCESS_ACTIVITY,
      relationshipKind: 'PARENT_CHILD',
      direction: 'CHILD',
      relationshipTableName: 'process_activities',
      foreignKeyField: 'business_process_id',
      displayLabel: 'Process Activities',
      actsAsContainment: true,
    },
    {
      targetEntityType: ENTITY_TYPES.APPLICATION,
      relationshipKind: 'ASSOCIATION',
      direction: 'ASSOCIATION',
      relationshipTableName: 'application_point_business_points',
      foreignKeyField: 'business_point_id',
      displayLabel: 'Applications',
      actsAsContainment: false,
    },
  ],

  // BUSINESS_POINT can expand to:
  // - Applications (association via ApplicationPointBusinessPoint)
  // - BusinessUsers (association via BusinessUserBusinessPoint)
  // - BusinessProcesses (underlying - resolve BP to its underlying Business Process)
  // - ProcessActivities (underlying - resolve BP to its underlying Process Activity)
  [ENTITY_TYPES.BUSINESS_POINT]: [
    {
      targetEntityType: ENTITY_TYPES.APPLICATION,
      relationshipKind: 'ASSOCIATION',
      direction: 'ASSOCIATION',
      relationshipTableName: 'application_point_business_points',
      foreignKeyField: 'business_point_id',
      displayLabel: 'Applications',
      actsAsContainment: false,
    },
    {
      targetEntityType: ENTITY_TYPES.BUSINESS_USER,
      relationshipKind: 'ASSOCIATION',
      direction: 'ASSOCIATION',
      relationshipTableName: 'business_user_business_points',
      foreignKeyField: 'business_point_id',
      displayLabel: 'Business Users',
      actsAsContainment: false,
    },
    {
      targetEntityType: ENTITY_TYPES.BUSINESS_PROCESS,
      relationshipKind: 'PARENT_CHILD',
      direction: 'UNDERLYING',
      relationshipTableName: 'business_points',
      foreignKeyField: 'business_process_id',
      displayLabel: 'Business Processes',
      actsAsContainment: true,
    },
    {
      targetEntityType: ENTITY_TYPES.PROCESS_ACTIVITY,
      relationshipKind: 'PARENT_CHILD',
      direction: 'UNDERLYING',
      relationshipTableName: 'business_points',
      foreignKeyField: 'process_activity_id',
      displayLabel: 'Process Activities',
      actsAsContainment: true,
    },
  ],

  // APP_COMPONENT can expand to:
  // - Services (parent/child, direction: CHILD)
  // - BusinessProcesses (association via ApplicationPointBusinessPoint - targets concrete type)
  // - ProcessActivities (association via ApplicationPointBusinessPoint - targets concrete type)
  [ENTITY_TYPES.APP_COMPONENT]: [
    {
      targetEntityType: ENTITY_TYPES.SERVICE,
      relationshipKind: 'PARENT_CHILD',
      direction: 'CHILD',
      relationshipTableName: 'services',
      foreignKeyField: 'app_component_id',
      displayLabel: 'Services',
      actsAsContainment: true,
    },
    {
      targetEntityType: ENTITY_TYPES.BUSINESS_PROCESS,
      relationshipKind: 'ASSOCIATION',
      direction: 'ASSOCIATION',
      relationshipTableName: 'application_point_business_points',
      foreignKeyField: 'application_point_id',
      displayLabel: 'Business Processes',
      actsAsContainment: true,
    },
    {
      targetEntityType: ENTITY_TYPES.PROCESS_ACTIVITY,
      relationshipKind: 'ASSOCIATION',
      direction: 'ASSOCIATION',
      relationshipTableName: 'application_point_business_points',
      foreignKeyField: 'application_point_id',
      displayLabel: 'Process Activities',
      actsAsContainment: true,
    },
  ],

  // SERVICE can expand to:
  // - Interfaces (parent/child, direction: CHILD)
  // - BusinessProcesses (association via ApplicationPointBusinessPoint - targets concrete type)
  // - ProcessActivities (association via ApplicationPointBusinessPoint - targets concrete type)
  [ENTITY_TYPES.SERVICE]: [
    {
      targetEntityType: ENTITY_TYPES.INTERFACE,
      relationshipKind: 'PARENT_CHILD',
      direction: 'CHILD',
      relationshipTableName: 'interfaces',
      foreignKeyField: 'service_id',
      displayLabel: 'Interfaces',
      actsAsContainment: true,
    },
    {
      targetEntityType: ENTITY_TYPES.BUSINESS_PROCESS,
      relationshipKind: 'ASSOCIATION',
      direction: 'ASSOCIATION',
      relationshipTableName: 'application_point_business_points',
      foreignKeyField: 'application_point_id',
      displayLabel: 'Business Processes',
      actsAsContainment: true,
    },
    {
      targetEntityType: ENTITY_TYPES.PROCESS_ACTIVITY,
      relationshipKind: 'ASSOCIATION',
      direction: 'ASSOCIATION',
      relationshipTableName: 'application_point_business_points',
      foreignKeyField: 'application_point_id',
      displayLabel: 'Process Activities',
      actsAsContainment: true,
    },
  ],

  // LOGICAL_DATA_ENTITY can expand to:
  // - LogicalDataAttributes (parent/child, direction: CHILD)
  // - PhysicalDataEntities (association via relationship table - edge-only)
  [ENTITY_TYPES.LOGICAL_DATA_ENTITY]: [
    {
      targetEntityType: ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE,
      relationshipKind: 'PARENT_CHILD',
      direction: 'CHILD',
      relationshipTableName: 'logical_data_attributes',
      foreignKeyField: 'logical_entity_id',
      displayLabel: 'Logical Attributes',
      actsAsContainment: true,
    },
    {
      targetEntityType: ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
      relationshipKind: 'ASSOCIATION',
      direction: 'ASSOCIATION',
      relationshipTableName: 'logical_data_entity_physical_data_entities',
      foreignKeyField: 'logical_entity_id',
      displayLabel: 'Physical Entities',
      actsAsContainment: false,
    },
  ],

  // PHYSICAL_DATA_ENTITY can expand to:
  // - PhysicalDataAttributes (parent/child, direction: CHILD)
  [ENTITY_TYPES.PHYSICAL_DATA_ENTITY]: [
    {
      targetEntityType: ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE,
      relationshipKind: 'PARENT_CHILD',
      direction: 'CHILD',
      relationshipTableName: 'physical_data_attributes',
      foreignKeyField: 'physical_entity_id',
      displayLabel: 'Physical Attributes',
      actsAsContainment: true,
    },
  ],

  // BUSINESS_USER can expand to:
  // - BusinessPoints (association via BusinessUserBusinessPoint relationship table - edge-only)
  [ENTITY_TYPES.BUSINESS_USER]: [
    {
      targetEntityType: ENTITY_TYPES.BUSINESS_POINT,
      relationshipKind: 'ASSOCIATION',
      direction: 'ASSOCIATION',
      relationshipTableName: 'business_user_business_points',
      foreignKeyField: 'business_user_id',
      displayLabel: 'Business Points',
      actsAsContainment: false,
    },
  ],

  // ============================================================================
  // INTERFACE can expand to:
  // - LogicalDataEntities (association via interface_logical_entities - containment)
  // - PhysicalDataEntities (association via interface_logical_entities - containment)
  //   Spec: Fix Advanced Add Interface Schema Entities (Task Group 1.3)
  //   Added PHYSICAL_DATA_ENTITY target to support both entity types
  // - Endpoints (parent/child - containment relationship for contract rendering)
  // ============================================================================
  [ENTITY_TYPES.INTERFACE]: [
    {
      targetEntityType: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      relationshipKind: 'ASSOCIATION',
      direction: 'ASSOCIATION',
      relationshipTableName: 'interface_logical_entities',
      foreignKeyField: 'interface_id',
      displayLabel: 'Logical Data Entities',
      actsAsContainment: true,
    },
    // Spec: Fix Advanced Add Interface Schema Entities (Task Group 1.3)
    // Physical Data Entity support for Interface schema
    {
      targetEntityType: ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
      relationshipKind: 'ASSOCIATION',
      direction: 'ASSOCIATION',
      relationshipTableName: 'interface_logical_entities',
      foreignKeyField: 'interface_id',
      displayLabel: 'Physical Data Entities',
      actsAsContainment: true,
    },
    // Task Group 3: ENDPOINT as child of INTERFACE
    // Endpoints are rendered as text rows inside Interface contract boxes
    {
      targetEntityType: ENTITY_TYPES.ENDPOINT,
      relationshipKind: 'PARENT_CHILD',
      direction: 'CHILD',
      relationshipTableName: 'endpoints',
      foreignKeyField: 'interface_id',
      displayLabel: 'Endpoints',
      actsAsContainment: true,
    },
  ],

  // ============================================================================
  // Phase 4: INTERACTION entity relationships
  // ============================================================================
  // INTERACTION can expand to:
  // - BusinessUser (via user_id - direct FK reference)
  // - Primary App_Business_Point (via primary_app_business_point_id - polymorphic)
  // - Secondary App_Business_Point (via secondary_app_business_point_id - polymorphic, optional)
  //
  // Note: INTERACTION uses POLYMORPHIC direction for App_Business_Point fields
  // because the target entity type is determined at runtime via resolveAppBusinessPoint()
  [ENTITY_TYPES.INTERACTION]: [
    {
      targetEntityType: ENTITY_TYPES.BUSINESS_USER,
      relationshipKind: 'ASSOCIATION',
      direction: 'CHILD',  // Direct FK lookup
      relationshipTableName: 'business_users',
      foreignKeyField: 'user_id',
      displayLabel: 'Business User',
      displayLabelPrefix: 'User: ',
      actsAsContainment: false,
    },
    {
      // Primary App_Business_Point - polymorphic target type
      // Will be resolved via resolveAppBusinessPoint() at runtime
      targetEntityType: 'APP_BUSINESS_POINT',  // Marker for polymorphic resolution
      relationshipKind: 'ASSOCIATION',
      direction: 'POLYMORPHIC',
      relationshipTableName: 'app_business_point_resolver',
      foreignKeyField: 'primary_app_business_point_id',
      displayLabel: 'Primary App Business Point',
      displayLabelPrefix: 'Primary: ',
      actsAsContainment: false,
    },
    {
      // Secondary App_Business_Point - polymorphic target type, optional
      // Will be resolved via resolveAppBusinessPoint() at runtime
      targetEntityType: 'APP_BUSINESS_POINT',  // Marker for polymorphic resolution
      relationshipKind: 'ASSOCIATION',
      direction: 'POLYMORPHIC',
      relationshipTableName: 'app_business_point_resolver',
      foreignKeyField: 'secondary_app_business_point_id',
      displayLabel: 'Secondary App Business Point',
      displayLabelPrefix: 'Secondary: ',
      actsAsContainment: false,
      isOptional: true,
    },
  ],
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get expandable relationships for a given entity type.
 *
 * @param entityType - The entity type to get relationships for (e.g., 'APPLICATION')
 * @returns Array of ExpandableRelationship objects, or empty array if none exist
 */
export function getExpandableRelationships(entityType: string): ExpandableRelationship[] {
  return EXPANDABLE_RELATIONSHIPS[entityType] || [];
}

/**
 * Check if an entity type has any expandable relationships.
 * Used to determine visibility of the "Advanced Add..." menu item.
 *
 * @param entityType - The entity type to check
 * @returns true if the entity type has at least one expandable relationship
 */
export function hasExpandableRelationships(entityType: string): boolean {
  const relationships = getExpandableRelationships(entityType);
  return relationships.length > 0;
}

/**
 * Get the display label for a relationship direction and kind.
 * Used in the tree view to show "(parent/child)" or "(association)".
 *
 * @param kind - The relationship kind
 * @returns Display string for the relationship kind
 */
export function getRelationshipKindLabel(kind: RelationshipKind): string {
  switch (kind) {
    case 'PARENT_CHILD':
      return '(parent/child)';
    case 'ASSOCIATION':
      return '(association)';
    default:
      return '';
  }
}

/**
 * Get all entity types that have expandable relationships.
 * Useful for testing and validation.
 *
 * @returns Array of entity type strings that have expandable relationships
 */
export function getExpandableEntityTypes(): string[] {
  return Object.keys(EXPANDABLE_RELATIONSHIPS);
}

/**
 * Get all containment relationships for a given entity type.
 * Returns only relationships where actsAsContainment is true.
 *
 * @param entityType - The entity type to get containment relationships for
 * @returns Array of ExpandableRelationship objects with actsAsContainment: true
 */
export function getContainmentRelationships(entityType: string): ExpandableRelationship[] {
  return getExpandableRelationships(entityType).filter((r) => r.actsAsContainment);
}

/**
 * Get all edge-only relationships for a given entity type.
 * Returns only relationships where actsAsContainment is false.
 *
 * @param entityType - The entity type to get edge-only relationships for
 * @returns Array of ExpandableRelationship objects with actsAsContainment: false
 */
export function getEdgeOnlyRelationships(entityType: string): ExpandableRelationship[] {
  return getExpandableRelationships(entityType).filter((r) => !r.actsAsContainment);
}

/**
 * Format display label for an entity in the Advanced Add tree.
 *
 * @param entityName - The entity's name
 * @param entityType - The entity's type (e.g., 'APPLICATION')
 * @param labelPrefix - Optional prefix (e.g., 'User: ', 'Primary: ')
 * @returns Formatted display string, e.g., "Primary: Order Service (SERVICE)"
 */
export function formatAdvancedAddLabel(
  entityName: string,
  entityType: string,
  labelPrefix?: string
): string {
  const prefix = labelPrefix || '';
  return `${prefix}${entityName} (${entityType})`;
}

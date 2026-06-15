/**
 * contextRelationshipLabelUtils.ts
 *
 * Spec 2026-01-17: Context Picker UX - Relationship Labels and Stable Chips
 * Task Group 2: Relationship label computation utilities
 *
 * Spec 2026-01-25: Fix Context Picker DEP Labels and Add Select All
 * Task Group 1.5: Updated computeRelationshipLabel() to resolve DEP IDs and use concrete type badges
 *
 * This module provides:
 * - RELATIONSHIP_TYPE_DISPLAY_LABELS: Human-friendly labels for 9 relationship types
 * - RELATIONSHIP_PARTICIPANT_CONFIGS: Participant extraction rules per relationship type
 * - computeRelationshipLabel(): Generates human-readable labels from relationship records
 *
 * Label format: "<NameA> [<TYPE_A>] | <NameB> [<TYPE_B>] | ..."
 * Fallback: "Unknown [<TYPE>]" for unresolvable participants (never raw IDs)
 *
 * DEP Resolution:
 * - When participant has typeLabel 'DATA_ENTITY_POINT', the entity ID is a DEP ID
 * - DEP IDs (dep_log_<id> or dep_phy_<id>) are resolved to underlying entity names
 * - Concrete type badges (LOGICAL_DATA_ENTITY or PHYSICAL_DATA_ENTITY) are used instead of DATA_ENTITY_POINT
 */

import { parseDepId, getDepTypeBadge, DATA_ENTITY_TYPE_BADGES } from './dataEntityPointOptions';

// ============================================================================
// Types
// ============================================================================

/**
 * Entity lookup function type
 * Takes an entity ID and returns the entity name or null if not found
 */
export type EntityLookup = (entityId: string) => string | null;

/**
 * Participant configuration for a relationship type
 */
export interface ParticipantConfig {
  /** Field name in the relationship record that holds the entity ID */
  idField: string;
  /** Display type label (e.g., "BUSINESS_USER", "APPLICATION_POINT") */
  typeLabel: string;
  /** Whether this participant is optional (omit if missing) */
  optional: boolean;
}

/**
 * Configuration for a relationship type defining its participants
 */
export interface RelationshipParticipantConfig {
  participants: ParticipantConfig[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Human-friendly display labels for the 9 supported relationship types.
 * Used for aggregated chip display (e.g., "3 Interface <-> Entity").
 */
export const RELATIONSHIP_TYPE_DISPLAY_LABELS: Record<string, string> = {
  business_user_business_points: 'User <-> Business Point',
  application_point_business_points: 'App Point <-> Business Point',
  interactions: 'Interactions',
  logical_data_entity_relationships: 'Data Entity Relationships',
  logical_data_entity_physical_data_entities: 'Logical <-> Physical Entity',
  logical_data_attribute_physical_data_attributes: 'Logical <-> Physical Attribute',
  interface_logical_entities: 'Interface <-> Entity',
  data_movements: 'Data Movements',
  application_point_business_logics: 'App Point <-> Business Logic',
};

/**
 * Participant extraction rules per relationship type.
 * Defines which fields to extract IDs from and their display type labels.
 *
 * Spec 2026-01-17 requirements:
 * - business_user_business_points: BusinessUser, BusinessPoint (neither optional)
 * - application_point_business_points: ApplicationPoint, BusinessPoint (neither optional)
 * - interactions: BusinessUser, PrimaryABP, SecondaryABP (all optional based on presence)
 * - logical_data_entity_relationships: DataEntityPoint from, DataEntityPoint to (via DEP fields)
 * - logical_data_entity_physical_data_entities: LogicalDataEntity, PhysicalDataEntity (neither optional)
 * - logical_data_attribute_physical_data_attributes: LogicalDataAttribute, PhysicalDataAttribute (neither optional)
 * - interface_logical_entities: Interface, DataEntityPoint (some optional)
 * - data_movements: SourceAP, TargetAP, DataEntityPoint, Interface (some optional)
 * - application_point_business_logics: ApplicationPoint, BusinessLogic (partially optional)
 */
export const RELATIONSHIP_PARTICIPANT_CONFIGS: Record<string, RelationshipParticipantConfig> = {
  business_user_business_points: {
    participants: [
      { idField: 'business_user_id', typeLabel: 'BUSINESS_USER', optional: false },
      { idField: 'business_point_id', typeLabel: 'BUSINESS_POINT', optional: false },
    ],
  },
  application_point_business_points: {
    participants: [
      { idField: 'application_point_id', typeLabel: 'APPLICATION_POINT', optional: false },
      { idField: 'business_point_id', typeLabel: 'BUSINESS_POINT', optional: false },
    ],
  },
  interactions: {
    participants: [
      { idField: 'user_id', typeLabel: 'BUSINESS_USER', optional: true },
      { idField: 'primary_app_business_point_id', typeLabel: 'APP_BUSINESS_POINT', optional: true },
      { idField: 'secondary_app_business_point_id', typeLabel: 'APP_BUSINESS_POINT', optional: true },
    ],
  },
  logical_data_entity_relationships: {
    participants: [
      { idField: 'fromDataEntityPointId', typeLabel: 'DATA_ENTITY_POINT', optional: true },
      { idField: 'toDataEntityPointId', typeLabel: 'DATA_ENTITY_POINT', optional: true },
    ],
  },
  logical_data_entity_physical_data_entities: {
    participants: [
      { idField: 'logical_entity_id', typeLabel: 'LOGICAL_DATA_ENTITY', optional: false },
      { idField: 'physical_entity_id', typeLabel: 'PHYSICAL_DATA_ENTITY', optional: false },
    ],
  },
  logical_data_attribute_physical_data_attributes: {
    participants: [
      { idField: 'logical_attribute_id', typeLabel: 'LOGICAL_DATA_ATTRIBUTE', optional: false },
      { idField: 'physical_attribute_id', typeLabel: 'PHYSICAL_DATA_ATTRIBUTE', optional: false },
    ],
  },
  interface_logical_entities: {
    participants: [
      { idField: 'interface_id', typeLabel: 'INTERFACE', optional: false },
      { idField: 'dataEntityPointId', typeLabel: 'DATA_ENTITY_POINT', optional: true },
    ],
  },
  data_movements: {
    participants: [
      { idField: 'source_application_point_id', typeLabel: 'APPLICATION_POINT', optional: true },
      { idField: 'target_application_point_id', typeLabel: 'APPLICATION_POINT', optional: true },
      { idField: 'dataEntityPointId', typeLabel: 'DATA_ENTITY_POINT', optional: true },
      { idField: 'interfaceWithSchemaId', typeLabel: 'INTERFACE', optional: true },
    ],
  },
  application_point_business_logics: {
    participants: [
      { idField: 'application_point_id', typeLabel: 'APPLICATION_POINT', optional: true },
      { idField: 'business_logic_id', typeLabel: 'BUSINESS_LOGIC', optional: true },
    ],
  },
};

// ============================================================================
// Functions
// ============================================================================

/**
 * Compute a human-readable label for a relationship record.
 *
 * Format: "<NameA> [<TYPE_A>] | <NameB> [<TYPE_B>] | ..."
 *
 * Spec 2026-01-25: Fix Context Picker DEP Labels and Add Select All
 * Task Group 1.5: When participant has typeLabel 'DATA_ENTITY_POINT':
 * - Parse the entity ID to determine if it's a DEP ID (dep_log_<id> or dep_phy_<id>)
 * - Resolve to the underlying entity name via entityLookup
 * - Use concrete type badge (LOGICAL_DATA_ENTITY or PHYSICAL_DATA_ENTITY) instead of DATA_ENTITY_POINT
 * - Fall back to "Unknown [CONCRETE_TYPE]" if entity not found
 *
 * @param relationship - The relationship record containing participant IDs
 * @param relationshipType - The relationship type key (e.g., "business_user_business_points")
 * @param entityLookup - Function to look up entity name by ID
 * @returns Human-readable label string
 *
 * Rules:
 * - For each participant in the config:
 *   - If ID is present in relationship: look up name via entityLookup
 *   - If name found: add "Name [TYPE]" to parts
 *   - If name not found: add "Unknown [TYPE]" to parts
 *   - If participant is optional and ID is missing: skip
 *   - For DATA_ENTITY_POINT participants: use concrete type badge based on DEP prefix
 * - Return parts joined by " | "
 *
 * @example
 * // Returns "John Doe [BUSINESS_USER] | Login Process [BUSINESS_POINT]"
 * computeRelationshipLabel(
 *   { business_user_id: 'u1', business_point_id: 'bp1' },
 *   'business_user_business_points',
 *   (id) => lookupById(id)?.name
 * );
 *
 * // Returns "Customer [LOGICAL_DATA_ENTITY] | Order [LOGICAL_DATA_ENTITY]"
 * computeRelationshipLabel(
 *   { fromDataEntityPointId: 'dep_log_log1', toDataEntityPointId: 'dep_log_log2' },
 *   'logical_data_entity_relationships',
 *   (id) => lookupById(id)?.name
 * );
 */
export function computeRelationshipLabel(
  relationship: Record<string, unknown>,
  relationshipType: string,
  entityLookup: EntityLookup
): string {
  const config = RELATIONSHIP_PARTICIPANT_CONFIGS[relationshipType];

  if (!config) {
    // Unknown relationship type - return fallback
    return 'Unknown Relationship';
  }

  const parts: string[] = [];

  for (const participant of config.participants) {
    const entityId = relationship[participant.idField] as string | undefined;

    if (!entityId) {
      // ID is missing
      if (participant.optional) {
        // Optional participant - skip
        continue;
      } else {
        // Required participant but missing - show Unknown with original type
        parts.push(`Unknown [${participant.typeLabel}]`);
      }
    } else {
      // ID is present - look up name
      const name = entityLookup(entityId);

      // Determine the type badge to display
      let typeBadge = participant.typeLabel;

      // If this is a DATA_ENTITY_POINT participant, resolve to concrete type badge
      if (participant.typeLabel === 'DATA_ENTITY_POINT') {
        const concreteTypeBadge = getDepTypeBadge(entityId);
        if (concreteTypeBadge) {
          typeBadge = concreteTypeBadge;
        }
        // If not a DEP ID (shouldn't happen for properly formed data),
        // fall back to DATA_ENTITY_POINT
      }

      if (name) {
        parts.push(`${name} [${typeBadge}]`);
      } else {
        // Name not found - show Unknown (never raw ID)
        parts.push(`Unknown [${typeBadge}]`);
      }
    }
  }

  // Return parts joined by " | " or fallback if empty
  return parts.length > 0 ? parts.join(' | ') : 'Unknown Relationship';
}

/**
 * Get the human-friendly display label for a relationship type.
 * Used for aggregated chip labels (e.g., "3 Interface <-> Entity").
 *
 * @param relationshipType - The relationship type key
 * @returns Human-friendly label string
 */
export function getRelationshipTypeDisplayLabel(relationshipType: string): string {
  return RELATIONSHIP_TYPE_DISPLAY_LABELS[relationshipType] || relationshipType;
}

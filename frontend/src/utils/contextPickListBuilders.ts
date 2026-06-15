/**
 * contextPickListBuilders.ts
 *
 * Spec 2026-01-04: Product Implement Context Picker v1
 * Task Group 2: Pick list builder utilities
 *
 * Spec 2026-01-17: Context Picker Modal UI Improvements
 * Task Group 1: Added RelationshipPickOption type
 * Task Group 2: Added buildRelationshipPickList function and RELATIONSHIP_COLLECTION_KEYS
 *
 * Spec 2026-01-17: Context Picker UX - Relationship Labels and Stable Chips
 * Task Group 3: Updated buildRelationshipPickList to use computeRelationshipLabel
 * Added application_point_business_logics to RELATIONSHIP_COLLECTION_KEYS (9th type)
 *
 * Spec 2026-01-25: Fix Context Picker DEP Labels and Add Select All
 * Task Group 1.4: Enhanced createEntityLookupFromMetaModel to handle DEP IDs
 *
 * This module provides:
 * - PickOption type for use in context picker modal
 * - RelationshipPickOption type for relationship context selection
 * - buildArchitecturePickList: Groups entities by collection key for architecture tab
 * - buildDiagramPickList: Creates flat list for diagrams tab
 * - buildRelationshipPickList: Groups relationships by collection key for domain tabs
 */

import type { MetaModelEntities, MetaModelRelationships, Diagram } from '../types/model';
import { computeRelationshipLabel, type EntityLookup } from './contextRelationshipLabelUtils';
import { parseDepId, DATA_ENTITY_TYPE_BADGES } from './dataEntityPointOptions';

// ============================================================================
// Types
// ============================================================================

/**
 * PickOption - represents a selectable item in the context picker
 */
export interface PickOption {
  /** The entity/diagram ID as the value */
  value: string;
  /** Display label for the option */
  label: string;
  /** Entity type (collection key) - only for entities, not diagrams */
  entity_type?: string;
}

/**
 * RelationshipPickOption - represents a selectable relationship item in the context picker
 *
 * Spec 2026-01-17: Context Picker Modal UI Improvements
 * Task Group 1: New type for relationship context selection
 */
export interface RelationshipPickOption {
  /** The relationship ID as the value */
  value: string;
  /** Display label for the option */
  label: string;
  /** Relationship type (collection key) */
  relationship_type: string;
}

// ============================================================================
// Entity Collection Keys
// ============================================================================

/**
 * Entity collection keys to include in the architecture pick list
 * Excludes derived/internal entities like application_points, business_points, app_business_points
 * Also excludes attribute collections as they are typically child entities
 */
const ARCHITECTURE_ENTITY_KEYS: (keyof MetaModelEntities)[] = [
  'business_users',
  'business_processes',
  'process_activities',
  'applications',
  'app_components',
  'services',
  'interfaces',
  'endpoints',
  'classes',
  'methods',
  'logical_data_entities',
  'physical_data_entities',
  'interactions',
  'events',
  'states',
  'activities',
  'ui_screens',
  'ui_components',
  'ui_actions',
];

// ============================================================================
// Relationship Collection Keys
// Spec 2026-01-17: Context Picker Modal UI Improvements - Task Group 2
// Spec 2026-01-17: Context Picker UX - Added application_point_business_logics (9th type)
// ============================================================================

/**
 * Relationship collection keys to include in the relationship pick list
 * These are the valid keys from MetaModelRelationships that users can select
 * Includes all relationship types defined in MetaModelRelationships:
 * - business_user_business_points
 * - application_point_business_points
 * - application_point_business_logics
 * - logical_data_entity_relationships
 * - logical_data_entity_physical_data_entities
 * - logical_data_attribute_physical_data_attributes
 * - data_movements
 * - interface_logical_entities
 * - ui_workflow_transitions
 *
 * Note: 'interactions' is not a relationship type in MetaModelRelationships
 * (it's an entity type in MetaModelEntities)
 */
export const RELATIONSHIP_COLLECTION_KEYS: (keyof MetaModelRelationships)[] = [
  'business_user_business_points',
  'application_point_business_points',
  'application_point_business_logics',
  'interface_logical_entities',
  'logical_data_entity_relationships',
  'logical_data_entity_physical_data_entities',
  'logical_data_attribute_physical_data_attributes',
  'data_movements',
  'ui_workflow_transitions',
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract label from an entity, checking name or title with fallback
 */
function extractEntityLabel(entity: Record<string, unknown>, entityType: string): string {
  // Try name field first
  if (entity.name && typeof entity.name === 'string' && entity.name.trim()) {
    return entity.name.trim();
  }

  // Try title field (some entities might use this)
  if (entity.title && typeof entity.title === 'string' && entity.title.trim()) {
    return entity.title.trim();
  }

  // Fallback to entity_type + id
  const id = entity.id as string;
  return `${entityType} ${id}`;
}

/**
 * Create an entity lookup function from MetaModelEntities
 * Searches all entity collections to find an entity by ID and return its name
 *
 * Spec 2026-01-25: Fix Context Picker DEP Labels and Add Select All
 * Task Group 1.4: Enhanced to handle DEP-prefixed IDs
 *
 * When a DEP ID (dep_log_<id> or dep_phy_<id>) is passed, this function:
 * 1. Parses the DEP prefix to determine entity type (logical or physical)
 * 2. Looks up the entity in the appropriate collection
 * 3. Returns the entity name if found, null otherwise
 *
 * For non-DEP IDs, falls back to standard lookup across all entity collections.
 */
export function createEntityLookupFromMetaModel(metaModelEntities: MetaModelEntities): EntityLookup {
  // Build a map of entity ID -> name for quick lookup
  const entityNameMap = new Map<string, string>();

  // Entity collection keys to search (all collections that have entities with names)
  const allEntityKeys: (keyof MetaModelEntities)[] = [
    'business_users',
    'business_processes',
    'process_activities',
    'business_points',
    'applications',
    'app_components',
    'services',
    'interfaces',
    'endpoints',
    'classes',
    'methods',
    'application_points',
    'logical_data_entities',
    'logical_data_attributes',
    'physical_data_entities',
    'physical_data_attributes',
    'interactions',
    'app_business_points',
    'events',
    'states',
    'activities',
    'business_logics',
    'ui_screens',
    'ui_components',
    'ui_actions',
  ];

  for (const key of allEntityKeys) {
    const collection = metaModelEntities[key];
    if (Array.isArray(collection)) {
      for (const entity of collection) {
        const entityRecord = entity as unknown as Record<string, unknown>;
        const id = entityRecord.id as string;
        const name = entityRecord.name as string | undefined;
        if (id && name) {
          entityNameMap.set(id, name);
        }
      }
    }
  }

  // Return lookup function that handles both DEP IDs and regular entity IDs
  return (entityId: string): string | null => {
    // First, check if this is a DEP ID
    const parsed = parseDepId(entityId);

    if (parsed) {
      // It's a DEP ID - look up in the appropriate collection
      if (parsed.type === 'logical') {
        const logicalEntities = metaModelEntities.logical_data_entities || [];
        const entity = logicalEntities.find((e) => e.id === parsed.entityId);
        return entity ? entity.name : null;
      } else if (parsed.type === 'physical') {
        const physicalEntities = metaModelEntities.physical_data_entities || [];
        const entity = physicalEntities.find((e) => e.id === parsed.entityId);
        return entity ? entity.name : null;
      }
    }

    // Not a DEP ID - use standard lookup
    return entityNameMap.get(entityId) || null;
  };
}

// ============================================================================
// Build Functions
// ============================================================================

/**
 * Build architecture pick list from meta-model entities
 *
 * Groups entities by their collection key and resolves labels from name/title fields.
 *
 * @param metaModelEntities - The entities object from state.model.metaModel.entities
 * @returns Record<string, PickOption[]> - Grouped pick options by collection key
 */
export function buildArchitecturePickList(
  metaModelEntities: MetaModelEntities
): Record<string, PickOption[]> {
  const result: Record<string, PickOption[]> = {};

  for (const key of ARCHITECTURE_ENTITY_KEYS) {
    const collection = metaModelEntities[key];

    if (!Array.isArray(collection)) {
      result[key] = [];
      continue;
    }

    const options: PickOption[] = collection.map((entity) => {
      const entityRecord = entity as unknown as Record<string, unknown>;
      const id = entityRecord.id as string;
      const label = extractEntityLabel(entityRecord, key);

      return {
        value: id,
        label,
        entity_type: key,
      };
    });

    result[key] = options;
  }

  return result;
}

/**
 * Build diagram pick list from diagrams array
 *
 * Uses diagram name if available, otherwise generates fallback from type and ID.
 *
 * @param diagrams - The diagrams array from state.model.diagrams
 * @returns PickOption[] - Flat list of diagram options
 */
export function buildDiagramPickList(diagrams: Diagram[]): PickOption[] {
  if (!Array.isArray(diagrams)) {
    return [];
  }

  return diagrams.map((diagram) => {
    let label: string;

    if (diagram.name && diagram.name.trim()) {
      label = diagram.name.trim();
    } else {
      // Fallback: use diagram_type or 'Diagram' with truncated ID
      const typeLabel = diagram.diagram_type || 'Diagram';
      const shortId = diagram.id.slice(0, 8);
      label = `${typeLabel} (${shortId})`;
    }

    return {
      value: diagram.id,
      label,
    };
  });
}

/**
 * Build relationship pick list from meta-model relationships
 *
 * Groups relationships by their collection key and computes human-readable labels
 * using the participant entities from metaModelEntities.
 *
 * Spec 2026-01-17: Context Picker Modal UI Improvements - Task Group 2
 * Spec 2026-01-17: Context Picker UX - Task Group 3: Updated to use computeRelationshipLabel
 *
 * @param metaModelRelationships - The relationships object from state.model.metaModel.relationships
 * @param metaModelEntities - The entities object for name lookup (optional for backward compatibility)
 * @returns Record<string, RelationshipPickOption[]> - Grouped pick options by collection key
 */
export function buildRelationshipPickList(
  metaModelRelationships: MetaModelRelationships,
  metaModelEntities?: MetaModelEntities
): Record<string, RelationshipPickOption[]> {
  const result: Record<string, RelationshipPickOption[]> = {};

  // Handle null/undefined input gracefully
  if (!metaModelRelationships) {
    for (const key of RELATIONSHIP_COLLECTION_KEYS) {
      result[key] = [];
    }
    return result;
  }

  // Create entity lookup function if metaModelEntities provided
  const entityLookup: EntityLookup = metaModelEntities
    ? createEntityLookupFromMetaModel(metaModelEntities)
    : () => null;

  for (const key of RELATIONSHIP_COLLECTION_KEYS) {
    const collection = metaModelRelationships[key];

    if (!Array.isArray(collection)) {
      result[key] = [];
      continue;
    }

    const options: RelationshipPickOption[] = collection.map((relationship) => {
      const relationshipRecord = relationship as unknown as Record<string, unknown>;
      const id = relationshipRecord.id as string;

      // Use computeRelationshipLabel if we have entity lookup, otherwise use name/description fallback
      let label: string;
      if (metaModelEntities) {
        label = computeRelationshipLabel(relationshipRecord, key, entityLookup);
      } else {
        // Fallback for backward compatibility when metaModelEntities not provided
        label = extractRelationshipLabelFallback(relationshipRecord);
      }

      return {
        value: id,
        label,
        relationship_type: key,
      };
    });

    result[key] = options;
  }

  return result;
}

/**
 * Fallback label extraction when metaModelEntities is not available.
 * Uses name/description fields from the relationship record.
 */
function extractRelationshipLabelFallback(
  relationship: Record<string, unknown>
): string {
  // Try name field first
  if (relationship.name && typeof relationship.name === 'string' && relationship.name.trim()) {
    return relationship.name.trim();
  }

  // Try description field for relationships that use description as label
  if (
    relationship.description &&
    typeof relationship.description === 'string' &&
    relationship.description.trim()
  ) {
    // Truncate long descriptions
    const desc = relationship.description.trim();
    return desc.length > 50 ? `${desc.substring(0, 47)}...` : desc;
  }

  // Fallback to "Unknown Relationship" (never raw IDs per spec)
  return 'Unknown Relationship';
}

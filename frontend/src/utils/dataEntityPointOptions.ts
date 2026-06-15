/**
 * Data Entity Point Options Utility
 *
 * Spec: Switch Logical ER and Data Movements UI to Data Entity Point Dropdown
 * Task Group 1: Data Entity Point Options Utility
 *
 * Spec: Fix Context Picker DEP Labels and Add Select All
 * Task Group 1: DEP Label Resolution - Added parseDepId() and resolveDepEntityName()
 *
 * This module provides utilities for building Data Entity Point options
 * for dropdown/typeahead components and resolving point IDs to display labels.
 *
 * Data Entity Point ID Format:
 * - Logical entities: `dep_log_<logicalEntityId>`
 * - Physical entities: `dep_phy_<physicalEntityId>`
 *
 * Display Label Format:
 * - Logical: "[entityName] [LOGICAL_DATA_ENTITY]"
 * - Physical: "[entityName] [PHYSICAL_DATA_ENTITY]"
 */

import { MetaModelEntities, MetaModel } from '../types/model';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Data Entity Point option for dropdown display
 */
export interface DataEntityPointOption {
  /** Deterministic point ID (dep_log_<id> or dep_phy_<id>) */
  value: string;
  /** Display label in format "[entityName] [TYPE]" */
  label: string;
  /** Group header for sectioned dropdown display */
  group: string;
}

/**
 * Result of resolving data entities for an interface.
 * Contains grouped entity IDs for both logical and physical types.
 *
 * Spec: Fix Advanced Add Interface Schema Entities (Task Group 1.2)
 */
export interface ResolvedDataEntitiesForInterface {
  /** IDs of logical data entities linked to the interface */
  logicalEntityIds: string[];
  /** IDs of physical data entities linked to the interface */
  physicalEntityIds: string[];
}

/**
 * Result of parsing a DEP ID
 *
 * Spec: Fix Context Picker DEP Labels and Add Select All
 * Task Group 1.2: DEP ID parsing utility
 */
export interface ParsedDepId {
  /** The type of entity: 'logical' or 'physical' */
  type: 'logical' | 'physical';
  /** The underlying entity ID (without DEP prefix) */
  entityId: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Group labels for sectioned dropdown display
 */
export const DATA_ENTITY_POINT_GROUPS = {
  LOGICAL: 'LOGICAL DATA ENTITIES',
  PHYSICAL: 'PHYSICAL DATA ENTITIES',
} as const;

/**
 * Prefix constants for deterministic point IDs
 */
export const DATA_ENTITY_POINT_PREFIXES = {
  LOGICAL: 'dep_log_',
  PHYSICAL: 'dep_phy_',
} as const;

/**
 * Type badge constants for display labels
 */
export const DATA_ENTITY_TYPE_BADGES = {
  LOGICAL: 'LOGICAL_DATA_ENTITY',
  PHYSICAL: 'PHYSICAL_DATA_ENTITY',
} as const;

// ============================================================================
// DEP ID PARSING AND RESOLUTION
// Spec: Fix Context Picker DEP Labels and Add Select All - Task Group 1
// ============================================================================

/**
 * Parse a DEP (Data Entity Point) ID to extract type and underlying entity ID.
 *
 * Spec: Fix Context Picker DEP Labels and Add Select All
 * Task Group 1.2: DEP ID parsing utility function
 *
 * @param depId - The DEP ID to parse (e.g., "dep_log_entity_123" or "dep_phy_table_456")
 * @returns Object with { type: 'logical' | 'physical', entityId: string } or null if not a DEP ID
 *
 * @example
 * parseDepId('dep_log_entity_123') // { type: 'logical', entityId: 'entity_123' }
 * parseDepId('dep_phy_table_456')  // { type: 'physical', entityId: 'table_456' }
 * parseDepId('regular_entity_id')  // null
 */
export function parseDepId(depId: string): ParsedDepId | null {
  if (!depId) {
    return null;
  }

  if (depId.startsWith(DATA_ENTITY_POINT_PREFIXES.LOGICAL)) {
    return {
      type: 'logical',
      entityId: depId.slice(DATA_ENTITY_POINT_PREFIXES.LOGICAL.length),
    };
  }

  if (depId.startsWith(DATA_ENTITY_POINT_PREFIXES.PHYSICAL)) {
    return {
      type: 'physical',
      entityId: depId.slice(DATA_ENTITY_POINT_PREFIXES.PHYSICAL.length),
    };
  }

  return null;
}

/**
 * Resolve a DEP ID to just the entity name (without type badge).
 *
 * Spec: Fix Context Picker DEP Labels and Add Select All
 * Task Group 1.3: Entity name extraction for DEP resolution
 *
 * This function is used for relationship label computation where only the
 * entity name is needed (the type badge is added separately).
 *
 * @param depId - The DEP ID to resolve (e.g., "dep_log_entity_123")
 * @param metaModel - The MetaModel containing entities
 * @returns The entity name if found, "Unknown" if entity not found but valid DEP format, or null if not a DEP ID
 *
 * @example
 * resolveDepEntityName('dep_log_log_1', metaModel) // "Customer" (if entity exists)
 * resolveDepEntityName('dep_log_missing', metaModel) // "Unknown" (valid DEP format but entity not found)
 * resolveDepEntityName('regular_id', metaModel) // null (not a DEP ID)
 */
export function resolveDepEntityName(depId: string, metaModel: MetaModel): string | null {
  const parsed = parseDepId(depId);

  if (!parsed) {
    // Not a DEP ID - return null to indicate the caller should use standard lookup
    return null;
  }

  const entities = metaModel.entities;

  if (parsed.type === 'logical') {
    const entity = (entities.logical_data_entities || []).find((e) => e.id === parsed.entityId);
    return entity ? entity.name : 'Unknown';
  }

  if (parsed.type === 'physical') {
    const entity = (entities.physical_data_entities || []).find((e) => e.id === parsed.entityId);
    return entity ? entity.name : 'Unknown';
  }

  return null;
}

/**
 * Get the concrete type badge for a DEP ID.
 *
 * Spec: Fix Context Picker DEP Labels and Add Select All
 * Task Group 1.5: Concrete type badge resolution
 *
 * @param depId - The DEP ID to get type badge for
 * @returns The concrete type badge (LOGICAL_DATA_ENTITY or PHYSICAL_DATA_ENTITY) or null if not a DEP ID
 */
export function getDepTypeBadge(depId: string): string | null {
  const parsed = parseDepId(depId);

  if (!parsed) {
    return null;
  }

  return parsed.type === 'logical'
    ? DATA_ENTITY_TYPE_BADGES.LOGICAL
    : DATA_ENTITY_TYPE_BADGES.PHYSICAL;
}

// ============================================================================
// OPTION BUILDING
// ============================================================================

/**
 * Build Data Entity Point options from MetaModelEntities.
 *
 * Sources options from:
 * - `entities.logical_data_entities` with prefix `dep_log_`
 * - `entities.physical_data_entities` with prefix `dep_phy_`
 *
 * Options are sorted alphabetically by label within each group.
 *
 * @param entities - MetaModelEntities containing logical and physical data entities
 * @returns Array of DataEntityPointOption sorted by label within each group
 */
export function buildDataEntityPointOptions(entities: MetaModelEntities): DataEntityPointOption[] {
  const options: DataEntityPointOption[] = [];

  // Build options from logical data entities
  const logicalOptions: DataEntityPointOption[] = (entities.logical_data_entities || []).map((entity) => ({
    value: `${DATA_ENTITY_POINT_PREFIXES.LOGICAL}${entity.id}`,
    label: `${entity.name} [${DATA_ENTITY_TYPE_BADGES.LOGICAL}]`,
    group: DATA_ENTITY_POINT_GROUPS.LOGICAL,
  }));

  // Build options from physical data entities
  const physicalOptions: DataEntityPointOption[] = (entities.physical_data_entities || []).map((entity) => ({
    value: `${DATA_ENTITY_POINT_PREFIXES.PHYSICAL}${entity.id}`,
    label: `${entity.name} [${DATA_ENTITY_TYPE_BADGES.PHYSICAL}]`,
    group: DATA_ENTITY_POINT_GROUPS.PHYSICAL,
  }));

  // Sort each group alphabetically by label
  logicalOptions.sort((a, b) => a.label.localeCompare(b.label));
  physicalOptions.sort((a, b) => a.label.localeCompare(b.label));

  // Combine groups: logical first, then physical
  options.push(...logicalOptions, ...physicalOptions);

  return options;
}

// ============================================================================
// LABEL RESOLUTION
// ============================================================================

/**
 * Resolve a Data Entity Point ID to its display label.
 *
 * Parses the point ID prefix to determine entity type:
 * - `dep_log_` -> lookup in `logical_data_entities`
 * - `dep_phy_` -> lookup in `physical_data_entities`
 *
 * Returns formatted label "[entityName] [TYPE]" or raw pointId as fallback
 * if entity not found (corrupted model scenario).
 *
 * @param pointId - The Data Entity Point ID to resolve
 * @param entities - MetaModelEntities containing logical and physical data entities
 * @returns Display label in format "[entityName] [TYPE]" or raw pointId
 */
export function resolveDataEntityPointLabel(pointId: string, entities: MetaModelEntities): string {
  // Handle empty/null/undefined
  if (!pointId) {
    return '';
  }

  // Check for logical entity prefix
  if (pointId.startsWith(DATA_ENTITY_POINT_PREFIXES.LOGICAL)) {
    const entityId = pointId.slice(DATA_ENTITY_POINT_PREFIXES.LOGICAL.length);
    const entity = (entities.logical_data_entities || []).find((e) => e.id === entityId);
    if (entity) {
      return `${entity.name} [${DATA_ENTITY_TYPE_BADGES.LOGICAL}]`;
    }
    // Entity not found, return raw pointId
    return pointId;
  }

  // Check for physical entity prefix
  if (pointId.startsWith(DATA_ENTITY_POINT_PREFIXES.PHYSICAL)) {
    const entityId = pointId.slice(DATA_ENTITY_POINT_PREFIXES.PHYSICAL.length);
    const entity = (entities.physical_data_entities || []).find((e) => e.id === entityId);
    if (entity) {
      return `${entity.name} [${DATA_ENTITY_TYPE_BADGES.PHYSICAL}]`;
    }
    // Entity not found, return raw pointId
    return pointId;
  }

  // Unknown prefix format, return raw pointId
  return pointId;
}

/**
 * Extract entity type and ID from a Data Entity Point ID.
 *
 * @deprecated Use parseDepId() instead - it has the same functionality with a cleaner interface.
 *
 * @param pointId - The Data Entity Point ID to parse
 * @returns Object with entityType ('logical' | 'physical') and entityId, or null if invalid format
 */
export function parseDataEntityPointId(pointId: string): { entityType: 'logical' | 'physical'; entityId: string } | null {
  if (!pointId) {
    return null;
  }

  if (pointId.startsWith(DATA_ENTITY_POINT_PREFIXES.LOGICAL)) {
    return {
      entityType: 'logical',
      entityId: pointId.slice(DATA_ENTITY_POINT_PREFIXES.LOGICAL.length),
    };
  }

  if (pointId.startsWith(DATA_ENTITY_POINT_PREFIXES.PHYSICAL)) {
    return {
      entityType: 'physical',
      entityId: pointId.slice(DATA_ENTITY_POINT_PREFIXES.PHYSICAL.length),
    };
  }

  return null;
}

/**
 * Generate a Data Entity Point ID from entity type and ID.
 *
 * @param entityType - 'logical' or 'physical'
 * @param entityId - The entity ID
 * @returns Formatted Data Entity Point ID
 */
export function generateDataEntityPointId(entityType: 'logical' | 'physical', entityId: string): string {
  if (entityType === 'logical') {
    return `${DATA_ENTITY_POINT_PREFIXES.LOGICAL}${entityId}`;
  }
  return `${DATA_ENTITY_POINT_PREFIXES.PHYSICAL}${entityId}`;
}

// ============================================================================
// INTERFACE DATA ENTITY RESOLUTION
// ============================================================================

/**
 * Resolve data entities linked to an interface via interface_logical_entities relationship.
 *
 * Spec: Fix Advanced Add Interface Schema Entities (Task Group 1.2)
 *
 * This utility parses the `dataEntityPointId` field from each relationship row
 * and groups the resulting entity IDs by type (logical vs physical).
 *
 * This shared utility is used by:
 * - AdvancedAddDialog.tsx findRelatedEntities() for tree building
 * - interfaceCompositeBuilder.ts getDataEntityIdsForInterface() for composite rendering
 *
 * @param metaModel - The full MetaModel containing relationships
 * @param interfaceId - The ID of the interface to resolve entities for
 * @returns Object with grouped logicalEntityIds and physicalEntityIds arrays
 */
export function resolveDataEntitiesForInterface(
  metaModel: MetaModel,
  interfaceId: string
): ResolvedDataEntitiesForInterface {
  const logicalEntityIds: string[] = [];
  const physicalEntityIds: string[] = [];

  // Get interface_logical_entities relationships with defensive check
  const interfaceLogicalEntities = metaModel.relationships.interface_logical_entities || [];

  // Filter by interface_id and parse each dataEntityPointId
  for (const rel of interfaceLogicalEntities) {
    if (rel.interface_id !== interfaceId) {
      continue;
    }

    // Parse the dataEntityPointId to extract type and ID
    const parsed = parseDataEntityPointId(rel.dataEntityPointId);
    if (!parsed) {
      // Invalid format, skip this relationship
      continue;
    }

    // Group by entity type
    if (parsed.entityType === 'logical') {
      // Only add if not already present (deduplicate)
      if (!logicalEntityIds.includes(parsed.entityId)) {
        logicalEntityIds.push(parsed.entityId);
      }
    } else if (parsed.entityType === 'physical') {
      // Only add if not already present (deduplicate)
      if (!physicalEntityIds.includes(parsed.entityId)) {
        physicalEntityIds.push(parsed.entityId);
      }
    }
  }

  return {
    logicalEntityIds,
    physicalEntityIds,
  };
}

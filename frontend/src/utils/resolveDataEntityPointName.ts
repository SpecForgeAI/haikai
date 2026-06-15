/**
 * resolveDataEntityPointName.ts
 *
 * Spec: Sequence Diagram Interface Endpoint Message Exchange Display and Endpoint Response
 * Task Group 5: Utility to resolve data entity point IDs to entity names.
 *
 * Data entity point IDs follow the format:
 * - dep_log_UUID -> logical_data_entities collection
 * - dep_phy_UUID -> physical_data_entities collection
 */

import type { MetaModel } from '../types/model';

/**
 * Resolves a data entity point ID to its entity name.
 *
 * @param depId - The data entity point ID (e.g., "dep_log_abc-123" or "dep_phy_xyz-456")
 * @param metaModel - The MetaModel containing all entities
 * @returns The resolved entity name, or undefined if not found or invalid format
 */
export function resolveDataEntityPointName(
  depId: string | undefined,
  metaModel: MetaModel
): string | undefined {
  if (!depId) return undefined;

  let collectionKey: 'logical_data_entities' | 'physical_data_entities';
  let entityUuid: string;

  if (depId.startsWith('dep_log_')) {
    collectionKey = 'logical_data_entities';
    entityUuid = depId.substring('dep_log_'.length);
  } else if (depId.startsWith('dep_phy_')) {
    collectionKey = 'physical_data_entities';
    entityUuid = depId.substring('dep_phy_'.length);
  } else {
    return undefined;
  }

  const collection = metaModel.entities[collectionKey];
  if (!collection || !Array.isArray(collection)) return undefined;

  const entity = collection.find((e: { id: string; name?: string }) => e.id === entityUuid);
  if (entity && 'name' in entity && typeof entity.name === 'string') {
    return entity.name;
  }

  return undefined;
}

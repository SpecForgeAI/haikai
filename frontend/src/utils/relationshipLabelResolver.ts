/**
 * Relationship Label Resolver Utilities
 *
 * Spec: Standardize Relationship Dropdown Display Labels
 * Task Group 1 & 2: Label resolution utilities for relationship dropdowns
 *
 * This module provides:
 * - Cache key building for relationship cell labels
 * - Label resolution functions for different FK column types
 * - Column-to-resolver mapping
 */

import { MetaModelEntities } from '../types/model';
import { resolveDataEntityPointLabel } from './dataEntityPointOptions';
import {
  formatBusinessPointDisplay,
  ABP_KIND_LABELS,
} from './formatters';

// ============================================================================
// Cache Key Building
// ============================================================================

/**
 * Build a cache key for a relationship cell label.
 *
 * Key format: `${relationshipKey}:${rowId}:${columnKey}`
 *
 * @param relationshipKey - The relationship type (e.g., 'data_movements')
 * @param rowId - The row entity ID
 * @param columnKey - The column field name (e.g., 'source_application_point_id')
 * @returns Cache key string
 */
export function buildCacheKeyForCell(
  relationshipKey: string,
  rowId: string,
  columnKey: string
): string {
  return `${relationshipKey}:${rowId}:${columnKey}`;
}

// ============================================================================
// Individual Label Resolver Functions
// ============================================================================

/**
 * Resolve an Application Point ID to its display label.
 *
 * Format: "[Name] [KIND]" (e.g., "Order Service [SERVICE]")
 *
 * For derived ApplicationPoints, shows target entity info from getTargetEntityInfo.
 * Falls back to raw ID if entity not found.
 *
 * @param apId - The Application Point ID
 * @param entities - MetaModelEntities
 * @returns Display label or raw ID
 */
export function resolveApplicationPointLabel(
  apId: string,
  entities: MetaModelEntities
): string {
  if (!apId) return '';

  const ap = entities.application_points?.find(p => p.id === apId);
  if (!ap) return apId;

  // For derived APs with target info, resolve the target entity name
  if (ap.target_type && ap.target_ref_id) {
    const targetType = String(ap.target_type).toUpperCase();
    let targetName: string | undefined;

    switch (targetType) {
      case 'SERVICE': {
        const service = entities.services?.find(s => s.id === ap.target_ref_id);
        targetName = service?.name;
        break;
      }
      case 'CLASS': {
        const classEntity = entities.classes?.find(c => c.id === ap.target_ref_id);
        targetName = classEntity?.name;
        break;
      }
      case 'METHOD': {
        const method = entities.methods?.find(m => m.id === ap.target_ref_id);
        if (method) {
          const owningClass = entities.classes?.find(c => c.id === method.class_id);
          targetName = owningClass ? `${owningClass.name}.${method.name}` : method.name;
        }
        break;
      }
    }

    if (targetName) {
      return `${targetName} [${targetType}]`;
    }
  }

  // Standard kind-based formatting
  const kindLabel = ap.kind || 'AP';
  return `${ap.name} [${kindLabel}]`;
}

/**
 * Resolve a Business Point ID to its display label.
 *
 * Format: "[Name] ([Kind Label])" (e.g., "Order Processing (Business Process)")
 *
 * @param bpId - The Business Point ID
 * @param entities - MetaModelEntities
 * @returns Display label or raw ID
 */
export function resolveBusinessPointLabel(
  bpId: string,
  entities: MetaModelEntities
): string {
  if (!bpId) return '';

  const bp = entities.business_points?.find(p => p.id === bpId);
  if (!bp) return bpId;

  return formatBusinessPointDisplay(bp);
}

/**
 * Resolve an App Business Point ID to its display label.
 *
 * Format: "[Name] ([Kind Label])" (e.g., "Order Service (Service)")
 *
 * @param abpId - The App Business Point ID
 * @param entities - MetaModelEntities
 * @returns Display label or raw ID
 */
export function resolveAppBusinessPointLabel(
  abpId: string,
  entities: MetaModelEntities
): string {
  if (!abpId) return '';

  const abp = entities.app_business_points?.find(p => p.id === abpId);
  if (!abp) return abpId;

  const kindLabel = ABP_KIND_LABELS[abp.kind] || abp.kind;
  return `${abp.name} (${kindLabel})`;
}

/**
 * Resolve a Business User ID to its display label.
 *
 * Format: "[Name]" (no badge needed for users)
 *
 * @param userId - The Business User ID
 * @param entities - MetaModelEntities
 * @returns Display label (name) or raw ID
 */
export function resolveBusinessUserLabel(
  userId: string,
  entities: MetaModelEntities
): string {
  if (!userId) return '';

  const user = entities.business_users?.find(u => u.id === userId);
  if (!user) return userId;

  return user.name;
}

// ============================================================================
// Column-to-Resolver Mapping
// ============================================================================

/**
 * Type for resolver functions
 */
type ResolverFunction = (fkValue: string, entities: MetaModelEntities) => string;

/**
 * Map of column keys to their resolver functions.
 *
 * Inventory from spec:
 * | Column Key | Resolver Function |
 * |------------|-------------------|
 * | source_application_point_id, target_application_point_id, application_point_id | resolveApplicationPointLabel |
 * | business_point_id | resolveBusinessPointLabel |
 * | fromDataEntityPointId, toDataEntityPointId, dataEntityPointId | resolveDataEntityPointLabel |
 * | user_id, business_user_id | resolveBusinessUserLabel |
 * | primary_app_business_point_id, secondary_app_business_point_id | resolveAppBusinessPointLabel |
 */
export const RELATIONSHIP_COLUMN_RESOLVERS: Record<string, ResolverFunction> = {
  // Application Point columns
  application_point_id: resolveApplicationPointLabel,
  source_application_point_id: resolveApplicationPointLabel,
  target_application_point_id: resolveApplicationPointLabel,

  // Business Point column
  business_point_id: resolveBusinessPointLabel,

  // Data Entity Point columns
  fromDataEntityPointId: resolveDataEntityPointLabel,
  toDataEntityPointId: resolveDataEntityPointLabel,
  dataEntityPointId: resolveDataEntityPointLabel,

  // Business User columns
  user_id: resolveBusinessUserLabel,
  business_user_id: resolveBusinessUserLabel,

  // App Business Point columns
  primary_app_business_point_id: resolveAppBusinessPointLabel,
  secondary_app_business_point_id: resolveAppBusinessPointLabel,
};

/**
 * Resolve a relationship cell label based on column key and FK value.
 *
 * Dispatches to the appropriate resolver function based on the column key.
 * Returns raw ID as fallback if no resolver found or entity not found.
 *
 * @param columnKey - The column field name (e.g., 'source_application_point_id')
 * @param fkValue - The foreign key value to resolve
 * @param entities - MetaModelEntities for entity lookup
 * @returns Display label string
 */
export function resolveRelationshipCellLabel(
  columnKey: string,
  fkValue: string,
  entities: MetaModelEntities
): string {
  if (!fkValue) return '';

  const resolver = RELATIONSHIP_COLUMN_RESOLVERS[columnKey];
  if (!resolver) {
    // No resolver for this column - return raw ID
    return fkValue;
  }

  return resolver(fkValue, entities);
}

// ============================================================================
// Relationship Keys for Cache Rebuild
// ============================================================================

/**
 * Mapping of relationship type keys to their FK column keys.
 * Used by REBUILD_RELATIONSHIP_CELL_LABELS_FROM_MODEL to iterate relationships.
 */
export const RELATIONSHIP_FK_COLUMNS: Record<string, string[]> = {
  data_movements: ['source_application_point_id', 'target_application_point_id', 'dataEntityPointId'],
  logical_data_entity_relationships: ['fromDataEntityPointId', 'toDataEntityPointId'],
  application_point_business_points: ['application_point_id', 'business_point_id'],
  business_user_business_points: ['business_user_id', 'business_point_id'],
  interactions: ['user_id', 'primary_app_business_point_id', 'secondary_app_business_point_id'],
  application_point_business_logics: ['application_point_id'],
};

/**
 * Build all labels for a relationship row.
 *
 * @param relationshipKey - The relationship type key
 * @param row - The relationship row data
 * @param entities - MetaModelEntities
 * @returns Record of column key to resolved label
 */
export function buildLabelsForRelationshipRow(
  relationshipKey: string,
  row: Record<string, unknown>,
  entities: MetaModelEntities
): Record<string, string> {
  const labels: Record<string, string> = {};
  const fkColumns = RELATIONSHIP_FK_COLUMNS[relationshipKey] || [];

  for (const columnKey of fkColumns) {
    const fkValue = row[columnKey];
    if (typeof fkValue === 'string' && fkValue) {
      labels[columnKey] = resolveRelationshipCellLabel(columnKey, fkValue, entities);
    }
  }

  return labels;
}

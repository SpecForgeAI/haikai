/**
 * useRelationshipCellLabel Hook
 *
 * Spec: Standardize Relationship Dropdown Display Labels
 * Task Group 4: Cell display hook for relationship cell labels
 *
 * This hook provides a cached label lookup for relationship FK cells.
 * It checks the AppState cache first, and falls back to on-demand resolution
 * if the cache doesn't have the entry.
 *
 * Usage:
 * ```tsx
 * const label = useRelationshipCellLabel(
 *   'data_movements',
 *   'dm_001',
 *   'source_application_point_id',
 *   'ap_001'
 * );
 * ```
 */

import { useMemo } from 'react';
import { useArchitecture, useArchitectureDispatch } from '../contexts/ArchitectureContext';
import {
  buildCacheKeyForCell,
  resolveRelationshipCellLabel,
} from '../utils/relationshipLabelResolver';

/**
 * Hook to get a display label for a relationship cell.
 *
 * Checks the relationshipCellLabels cache first. If not found, resolves
 * the label on-demand using the appropriate resolver function.
 *
 * @param relationshipKey - The relationship type (e.g., 'data_movements')
 * @param rowId - The row entity ID
 * @param columnKey - The column field name (e.g., 'source_application_point_id')
 * @param fkValue - The foreign key value to resolve
 * @param dispatchOnMiss - Whether to dispatch SET_RELATIONSHIP_CELL_LABEL on cache miss (default: false)
 * @returns Display label string
 */
export function useRelationshipCellLabel(
  relationshipKey: string,
  rowId: string,
  columnKey: string,
  fkValue: string,
  dispatchOnMiss: boolean = false
): string {
  const state = useArchitecture();
  const dispatch = useArchitectureDispatch();

  const label = useMemo(() => {
    // Return empty for empty FK value
    if (!fkValue) return '';

    // Build cache key
    const cacheKey = buildCacheKeyForCell(relationshipKey, rowId, columnKey);

    // Check cache first
    const cachedLabel = state.relationshipCellLabels[cacheKey];
    if (cachedLabel !== undefined) {
      return cachedLabel;
    }

    // Cache miss - resolve on-demand
    const resolvedLabel = resolveRelationshipCellLabel(
      columnKey,
      fkValue,
      state.model.metaModel.entities
    );

    // Optionally populate cache on miss
    if (dispatchOnMiss && resolvedLabel && resolvedLabel !== fkValue) {
      // Schedule dispatch in a microtask to avoid dispatch during render
      queueMicrotask(() => {
        dispatch({
          type: 'SET_RELATIONSHIP_CELL_LABEL',
          payload: {
            relationshipKey,
            rowId,
            columnKey,
            label: resolvedLabel,
          },
        });
      });
    }

    return resolvedLabel;
  }, [
    fkValue,
    relationshipKey,
    rowId,
    columnKey,
    state.relationshipCellLabels,
    state.model.metaModel.entities,
    dispatchOnMiss,
    dispatch,
  ]);

  return label;
}

/**
 * Hook to dispatch a label cache update.
 * Returns a function that can be called to update the cache.
 *
 * @returns Function to dispatch SET_RELATIONSHIP_CELL_LABEL
 */
export function useRelationshipCellLabelDispatch(): (
  relationshipKey: string,
  rowId: string,
  columnKey: string,
  label: string
) => void {
  const dispatch = useArchitectureDispatch();

  return (
    relationshipKey: string,
    rowId: string,
    columnKey: string,
    label: string
  ) => {
    dispatch({
      type: 'SET_RELATIONSHIP_CELL_LABEL',
      payload: {
        relationshipKey,
        rowId,
        columnKey,
        label,
      },
    });
  };
}

/**
 * Hook to get the label cache for direct access.
 * Useful when multiple labels need to be accessed without repeated hook calls.
 *
 * @returns The relationshipCellLabels cache Record
 */
export function useRelationshipCellLabelsCache(): Record<string, string> {
  const state = useArchitecture();
  return state.relationshipCellLabels;
}

/**
 * Get a label from the cache using the cache key directly.
 *
 * @param cache - The relationshipCellLabels cache
 * @param relationshipKey - The relationship type
 * @param rowId - The row entity ID
 * @param columnKey - The column field name
 * @returns Cached label or undefined if not found
 */
export function getLabelFromCache(
  cache: Record<string, string>,
  relationshipKey: string,
  rowId: string,
  columnKey: string
): string | undefined {
  const cacheKey = buildCacheKeyForCell(relationshipKey, rowId, columnKey);
  return cache[cacheKey];
}

/**
 * useDiscoveryOrigins Hook
 *
 * Spec: Discovery Results Visibility (Increment 12)
 * Task Group 6: Meta-Model Discovery-Origin Badges
 * Task 6.2: Custom hook for fetching and caching discovery origin data
 *
 * Extended: Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7
 * - Hook now takes `architectureId` and threads it into
 *   `getDiscoveryOriginEntities`. The entity-origins endpoint is filtered
 *   by `(projectId, architectureId)`, so the badges in the Meta-Model view
 *   reflect only the active architecture's discovery runs (a service
 *   discovered under "Current State" no longer earns a "Discovered" badge
 *   when the user is viewing "Target State").
 * - Cache key is now `${projectId}::${architectureId}` so switching
 *   architectures triggers a re-fetch.
 *
 * Fetches discovery entity-origin mappings for a project and returns
 * a lookup structure (Map<entityType, Set<entityId>>) for efficient
 * badge rendering in the Grid component.
 *
 * Features:
 * - Calls getDiscoveryOriginEntities(projectId, architectureId) on mount
 *   and whenever projectId or architectureId changes
 * - Returns Map<string, Set<string>> keyed by entityType, values are Sets of entityId strings
 * - Handles errors gracefully: logs a warning and returns an empty map (non-blocking)
 * - Caches results via useRef to avoid re-fetching on every Grid render
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getDiscoveryOriginEntities } from '../api/discoveryApi';

/**
 * Lookup structure for discovery origins.
 * Outer key: entityType (e.g., 'applications', 'services')
 * Inner value: Set of entityId strings that originated from discovery
 */
export type DiscoveryOriginsMap = Map<string, Set<string>>;

/** Empty map singleton to avoid creating new objects on every render */
const EMPTY_MAP: DiscoveryOriginsMap = new Map();

/**
 * Custom hook that fetches discovery origin data for a project + architecture
 * and returns a lookup map for efficient badge rendering.
 *
 * @param projectId - The project identifier, or undefined if no project is active
 * @param architectureId - The active architecture identifier, or undefined if
 *                         the URL has not yet resolved a `:architectureId` segment
 * @returns A Map<string, Set<string>> keyed by entityType with Sets of entityId strings.
 *          Returns an empty map if projectId or architectureId is undefined,
 *          fetch fails, or no data exists.
 */
export function useDiscoveryOrigins(
  projectId: string | undefined,
  architectureId: string | undefined | null
): DiscoveryOriginsMap {
  const [originsMap, setOriginsMap] = useState<DiscoveryOriginsMap>(EMPTY_MAP);

  // Cache the last fetched (projectId, architectureId) pair to avoid
  // redundant fetches across re-renders.
  const lastFetchedKeyRef = useRef<string | undefined>(undefined);

  const fetchOrigins = useCallback(async (pid: string, aid: string) => {
    try {
      const mappings = await getDiscoveryOriginEntities(pid, aid);

      // Build lookup map: Map<entityType, Set<entityId>>
      const map: DiscoveryOriginsMap = new Map();
      for (const mapping of mappings) {
        const entityType = mapping.entity_type;
        const entityId = mapping.entity_id;
        if (!map.has(entityType)) {
          map.set(entityType, new Set());
        }
        map.get(entityType)!.add(entityId);
      }

      setOriginsMap(map);
      lastFetchedKeyRef.current = `${pid}::${aid}`;
    } catch (error) {
      // Non-blocking: log warning and return empty map
      console.warn('Failed to fetch discovery origins, badges will not be shown:', error);
      setOriginsMap(EMPTY_MAP);
      lastFetchedKeyRef.current = `${pid}::${aid}`;
    }
  }, []);

  useEffect(() => {
    if (!projectId || !architectureId) {
      setOriginsMap(EMPTY_MAP);
      lastFetchedKeyRef.current = undefined;
      return;
    }

    const key = `${projectId}::${architectureId}`;

    // Skip fetch if we already fetched for this (projectId, architectureId) (cache)
    if (lastFetchedKeyRef.current === key) {
      return;
    }

    fetchOrigins(projectId, architectureId);
  }, [projectId, architectureId, fetchOrigins]);

  return originsMap;
}

/**
 * Work Item Search Service
 *
 * Calls the architecture-model-service search endpoint, resolves scope,
 * ranks results, and returns top 5.
 *
 * Spec: 2026-03-04 What's Next v1-C: Work Item Picker -- Task Group 4
 */

import { getConfig } from '../config';
import { fetchProductSummary } from './architectureModelClient';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Public result interface
// ---------------------------------------------------------------------------

export interface WorkItemSearchResult {
  id: string;
  title: string;
  type: 'FEATURE' | 'STORY' | 'TASK' | 'TEST';
  status: string;
  parentTitle: string | null;
  inScope: boolean;
}

// ---------------------------------------------------------------------------
// Raw DTO matching architecture-model-service response (snake_case)
// ---------------------------------------------------------------------------

interface WorkItemDto {
  id: string;
  project_id: string;
  type: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: string;
  sort_order: number;
  priority: string | null;
  target_window: string | null;
  tags: string | null;
  external_system: string | null;
  external_key: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Statuses considered "active" for boost ranking
// ---------------------------------------------------------------------------

const BOOSTED_STATUSES = new Set(['IN_PROGRESS', 'ACTIVE']);

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

/**
 * Search for work items (FEATURE and STORY) matching a text query,
 * resolve scope, rank, and return the top 5 results.
 *
 * @param projectId - The project to search within
 * @param query - Free-text search term (matched against title/description via ILIKE)
 * @param scopeType - Optional scope type for ranking (e.g. 'NEXT_5_EPICS', 'ENTIRE_PRODUCT')
 * @param scopeValue - Optional scope value (reserved for future use)
 * @returns Up to 5 ranked WorkItemSearchResult items; empty array on failure
 */
export async function searchWorkItems(
  projectId: string,
  query: string,
  scopeType?: string,
  scopeValue?: string,
): Promise<WorkItemSearchResult[]> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}/work-items/search?q=${encodeURIComponent(query)}&types=FEATURE,STORY,TASK,TEST&limit=10`;

  logger.debug('Searching work items via architecture-model-service', {
    projectId,
    query,
    scopeType,
    url,
  });

  try {
    // ------------------------------------------------------------------
    // 1. Call the search endpoint
    // ------------------------------------------------------------------
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.warn('Architecture model service returned non-OK response for work item search', {
        projectId,
        query,
        status: response.status,
        statusText: response.statusText,
      });
      return [];
    }

    const rawItems = (await response.json()) as WorkItemDto[];

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      logger.debug('No work items found for search query', { projectId, query });
      return [];
    }

    // ------------------------------------------------------------------
    // 2. Resolve scope (in-scope epic IDs) via product summary hierarchy
    // ------------------------------------------------------------------
    let inScopeEpicIds: Set<string> | null = null;
    // Map of work item id -> title for parent title resolution
    let workItemTitleMap: Map<string, string> = new Map();
    // Map of work item id -> parent_id for grandparent resolution (stories)
    let workItemParentMap: Map<string, string | null> = new Map();

    if (scopeType) {
      const productSummary = await fetchProductSummary(projectId);

      if (productSummary && productSummary.initiatives) {
        // Build flat list of all epics across all initiatives (preserve sort order from hierarchy)
        const allEpics: { id: string; title: string }[] = [];

        for (const initiative of productSummary.initiatives) {
          // Add initiative to title map
          if (initiative.id) {
            workItemTitleMap.set(initiative.id, initiative.title);
          }

          for (const epic of initiative.epics || []) {
            allEpics.push({ id: epic.id, title: epic.title });
            workItemTitleMap.set(epic.id, epic.title);

            for (const feature of epic.features || []) {
              workItemTitleMap.set(feature.id, feature.title);
              workItemParentMap.set(feature.id, epic.id);
            }
          }
        }

        // Derive in-scope epic IDs based on scopeType
        if (scopeType === 'NEXT_5_EPICS') {
          inScopeEpicIds = new Set(allEpics.slice(0, 5).map((e) => e.id));
        } else {
          // ENTIRE_PRODUCT or any other scope type: all epics
          inScopeEpicIds = new Set(allEpics.map((e) => e.id));
        }

        logger.debug('Resolved scope for work item search', {
          projectId,
          scopeType,
          inScopeEpicCount: inScopeEpicIds.size,
          totalEpicCount: allEpics.length,
        });
      }
    }

    // ------------------------------------------------------------------
    // 3-4. Map raw DTOs to result shape with inScope and parentTitle
    // ------------------------------------------------------------------
    const results: WorkItemSearchResult[] = rawItems.map((item) => {
      let inScope = false;
      let parentTitle: string | null = null;

      if (inScopeEpicIds && item.parent_id) {
        if (item.type === 'FEATURE') {
          // Feature's parent is an epic directly
          inScope = inScopeEpicIds.has(item.parent_id);
        } else if (item.type === 'STORY') {
          // Story's parent is a feature; grandparent is the epic
          const featureParentId = workItemParentMap.get(item.parent_id);
          if (featureParentId) {
            inScope = inScopeEpicIds.has(featureParentId);
          }
        }
      }

      // Derive parentTitle from the hierarchy title map
      if (item.parent_id) {
        parentTitle = workItemTitleMap.get(item.parent_id) || null;
      }

      return {
        id: item.id,
        title: item.title,
        type: item.type as 'FEATURE' | 'STORY' | 'TASK' | 'TEST',
        status: item.status,
        parentTitle,
        inScope,
      };
    });

    // ------------------------------------------------------------------
    // 5. Rank: partition into in-scope / out-of-scope, boost active items
    // ------------------------------------------------------------------
    const inScopeBucket: WorkItemSearchResult[] = [];
    const outOfScopeBucket: WorkItemSearchResult[] = [];

    for (const result of results) {
      if (result.inScope) {
        inScopeBucket.push(result);
      } else {
        outOfScopeBucket.push(result);
      }
    }

    const boostSort = (a: WorkItemSearchResult, b: WorkItemSearchResult): number => {
      const aBoost = BOOSTED_STATUSES.has(a.status) ? 0 : 1;
      const bBoost = BOOSTED_STATUSES.has(b.status) ? 0 : 1;
      return aBoost - bBoost;
      // If both have same boost level, keep original (database) order since sort is stable
    };

    inScopeBucket.sort(boostSort);
    outOfScopeBucket.sort(boostSort);

    // ------------------------------------------------------------------
    // 6. Concatenate and truncate to 5
    // ------------------------------------------------------------------
    const ranked = [...inScopeBucket, ...outOfScopeBucket].slice(0, 5);

    logger.debug('Work item search completed', {
      projectId,
      query,
      totalRaw: rawItems.length,
      inScopeCount: inScopeBucket.length,
      outOfScopeCount: outOfScopeBucket.length,
      returnedCount: ranked.length,
    });

    return ranked;
  } catch (error) {
    logger.warn('Failed to search work items from architecture model service', {
      projectId,
      query,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return [];
  }
}

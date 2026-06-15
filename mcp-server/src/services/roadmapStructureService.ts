/**
 * Roadmap Structure Service
 *
 * Core business logic for the save_roadmap_structure MCP tool.
 * Handles validation, matching, and two-phase upsert of initiatives and epics
 * as canonical work_items in the architecture-model-service.
 *
 * All functions are exported as named exports for testability.
 */

import {
  RoadmapInput,
  WorkItemDto,
  SaveRoadmapStructureResult,
  ExternalRefInput,
} from '../types/saveRoadmapStructure';
import { archModelClient } from './archModelClient';
import { createHttpError } from '../middleware/errorHandler';

// ============================================================================
// parseAndValidateRoadmapJson
// ============================================================================

/**
 * Parses the roadmapJson string and validates the payload.
 * Throws 400 errors with descriptive messages on validation failures.
 *
 * @param roadmapJson - The raw JSON string from the request
 * @returns Parsed and validated RoadmapInput
 * @throws HttpError with statusCode 400 on invalid input
 */
export function parseAndValidateRoadmapJson(roadmapJson: string): RoadmapInput {
  let parsed: any;
  try {
    parsed = JSON.parse(roadmapJson);
  } catch (e: any) {
    throw createHttpError(400, `Invalid JSON: ${e.message}`);
  }

  if (!parsed.initiatives || !Array.isArray(parsed.initiatives) || parsed.initiatives.length === 0) {
    throw createHttpError(400, 'initiatives array is required and must be non-empty');
  }

  // Validate initiative titles
  const initiativeTitleSet = new Set<string>();
  for (let i = 0; i < parsed.initiatives.length; i++) {
    const init = parsed.initiatives[i];
    if (!init.title || typeof init.title !== 'string' || init.title.trim() === '') {
      throw createHttpError(400, `initiatives[${i}].title is required and must be a non-empty string`);
    }
    const lowerTitle = init.title.trim().toLowerCase();
    if (initiativeTitleSet.has(lowerTitle)) {
      throw createHttpError(400, `Duplicate initiative title (case-insensitive): "${init.title}"`);
    }
    initiativeTitleSet.add(lowerTitle);

    // Validate epic titles within this initiative
    if (init.epics && Array.isArray(init.epics)) {
      const epicTitleSet = new Set<string>();
      for (let j = 0; j < init.epics.length; j++) {
        const epic = init.epics[j];
        if (!epic.title || typeof epic.title !== 'string' || epic.title.trim() === '') {
          throw createHttpError(400, `initiatives[${i}].epics[${j}].title is required and must be a non-empty string`);
        }
        const epicLower = epic.title.trim().toLowerCase();
        if (epicTitleSet.has(epicLower)) {
          throw createHttpError(400, `Duplicate epic title within initiative "${init.title}" (case-insensitive): "${epic.title}"`);
        }
        epicTitleSet.add(epicLower);
      }
    }
  }

  return parsed as RoadmapInput;
}

// ============================================================================
// buildMatchingMaps
// ============================================================================

/**
 * Builds matching maps from existing work items for upsert lookup.
 *
 * @param existingWorkItems - Array of existing WorkItemDto from the backend
 * @returns Object with externalRefMap and typeTitleMap for matching
 */
export function buildMatchingMaps(existingWorkItems: WorkItemDto[]): {
  externalRefMap: Record<string, WorkItemDto>;
  typeTitleMap: Record<string, WorkItemDto>;
} {
  const externalRefMap: Record<string, WorkItemDto> = {};
  const typeTitleMap: Record<string, WorkItemDto> = {};

  for (const item of existingWorkItems) {
    if (item.external_system && item.external_key) {
      externalRefMap[`${item.external_system}::${item.external_key}`] = item;
    }
    typeTitleMap[`${item.type}::${item.title.toLowerCase()}`] = item;
  }

  return { externalRefMap, typeTitleMap };
}

// ============================================================================
// upsertWorkItem (internal helper)
// ============================================================================

/**
 * Upserts a single work item (initiative or epic) using externalRef-first,
 * title-fallback matching.
 *
 * @param projectId - The project UUID
 * @param title - Work item title
 * @param description - Work item description or null
 * @param externalRef - External reference for matching, or null
 * @param type - Work item type: 'INITIATIVE' or 'EPIC'
 * @param sortOrder - Position index for sort_order
 * @param parentId - Parent work item ID, or null for top-level items
 * @param externalRefMap - Map of existing items keyed by external ref
 * @param typeTitleMap - Map of existing items keyed by type::title
 * @param warnings - Warnings accumulator array
 * @returns Object with action ('created' or 'updated') and the resulting WorkItemDto
 */
async function upsertWorkItem(
  projectId: string,
  title: string,
  description: string | null,
  externalRef: ExternalRefInput | null,
  type: string,
  sortOrder: number,
  parentId: string | null,
  externalRefMap: Record<string, WorkItemDto>,
  typeTitleMap: Record<string, WorkItemDto>,
  warnings: string[]
): Promise<{ action: 'created' | 'updated'; workItem: WorkItemDto }> {
  let matchedItem: WorkItemDto | undefined;

  // Match priority 1: externalRef match
  if (externalRef && externalRef.system && externalRef.key) {
    const refKey = `${externalRef.system}::${externalRef.key}`;
    matchedItem = externalRefMap[refKey];
    if (matchedItem && matchedItem.title.toLowerCase() !== title.toLowerCase()) {
      warnings.push(
        `ExternalRef match (${externalRef.system}::${externalRef.key}): existing title "${matchedItem.title}" differs from input title "${title}" (possible rename)`
      );
    }
  }

  // Match priority 2: title fallback (only if no externalRef match)
  if (!matchedItem) {
    const titleKey = `${type}::${title.toLowerCase()}`;
    matchedItem = typeTitleMap[titleKey];
    if (matchedItem) {
      warnings.push(
        `Title-fallback match for ${type} "${title}": matched existing work item ${matchedItem.id} by title`
      );
    }
  }

  if (matchedItem) {
    // UPDATE path
    const updateDto: Partial<WorkItemDto> = {
      title,
      description,
      sort_order: sortOrder,
      parent_id: parentId,
    };

    // Add external ref fields if provided
    if (externalRef && externalRef.system && externalRef.key) {
      updateDto.external_system = externalRef.system;
      updateDto.external_key = externalRef.key;
    }

    // Do NOT send status, tags, external_url, delivery_team_id
    const workItem = await archModelClient.updateWorkItem(projectId, matchedItem.id, updateDto);
    return { action: 'updated', workItem };
  } else {
    // CREATE path
    const createDto: Partial<WorkItemDto> = {
      type,
      title,
      description: description || null,
      status: 'PLANNED',
      sort_order: sortOrder,
      parent_id: parentId,
      priority: null,
      target_window: null,
      tags: null,
      external_system: externalRef?.system || null,
      external_key: externalRef?.key || null,
      external_url: null,
    };

    const workItem = await archModelClient.createWorkItem(projectId, createDto);
    return { action: 'created', workItem };
  }
}

// ============================================================================
// saveRoadmapStructure (main orchestrator)
// ============================================================================

/**
 * Main orchestrator function for saving a roadmap structure.
 *
 * Orchestration flow:
 * 1. Parse and validate the roadmapJson input
 * 2. Fetch existing work items from the backend
 * 3. Build matching maps for upsert lookup
 * 4. Phase 1: Upsert initiatives (collecting resolved IDs)
 * 5. Phase 2: Upsert epics (using resolved initiative IDs as parent_id)
 * 6. Tally and return results with warnings
 *
 * @param projectId - The project UUID
 * @param roadmapJson - The raw JSON string of the roadmap payload
 * @returns Promise resolving to the save result
 */
export async function saveRoadmapStructure(
  projectId: string,
  roadmapJson: string
): Promise<SaveRoadmapStructureResult> {
  // 1. Parse and validate
  const input = parseAndValidateRoadmapJson(roadmapJson);

  // 2. Fetch existing work items
  let existingWorkItems: WorkItemDto[];
  try {
    existingWorkItems = await archModelClient.listWorkItems(projectId);
  } catch (err: any) {
    throw createHttpError(502, `Failed to fetch existing work items: ${err.message}`);
  }

  // 3. Build matching maps
  const { externalRefMap, typeTitleMap } = buildMatchingMaps(existingWorkItems);

  // 4. Phase 1: Upsert initiatives
  const warnings: string[] = [];
  const initiativeIdMap: Record<number, string> = {};
  let createdInitiatives = 0;
  let updatedInitiatives = 0;

  for (let i = 0; i < input.initiatives.length; i++) {
    const init = input.initiatives[i];
    const result = await upsertWorkItem(
      projectId, init.title, init.description || null,
      init.externalRef || null, 'INITIATIVE', i, null,
      externalRefMap, typeTitleMap, warnings
    );
    initiativeIdMap[i] = result.workItem.id;
    if (result.action === 'created') createdInitiatives++;
    else updatedInitiatives++;
  }

  // 5. Phase 2: Upsert epics
  let createdEpics = 0;
  let updatedEpics = 0;

  for (let i = 0; i < input.initiatives.length; i++) {
    const init = input.initiatives[i];
    const parentId = initiativeIdMap[i];
    for (let j = 0; j < (init.epics || []).length; j++) {
      const epic = init.epics![j];
      const result = await upsertWorkItem(
        projectId, epic.title, epic.description || null,
        epic.externalRef || null, 'EPIC', j, parentId,
        externalRefMap, typeTitleMap, warnings
      );
      if (result.action === 'created') createdEpics++;
      else updatedEpics++;
    }
  }

  return { createdInitiatives, updatedInitiatives, createdEpics, updatedEpics, warnings };
}

/**
 * Backlog Items Service
 *
 * Core business logic for the save_backlog_items MCP tool.
 * Handles validation, matching, and multi-phase upsert of features and stories
 * as canonical work_items under a specific epic in the architecture-model-service.
 *
 * All functions are exported as named exports for testability.
 */

import {
  BacklogInput,
  BacklogFeatureInput,
  SaveBacklogItemsResult,
} from '../types/saveBacklogItems';
import { WorkItemDto } from '../types/saveRoadmapStructure';
import { archModelClient } from './archModelClient';
import { createHttpError } from '../middleware/errorHandler';

// ============================================================================
// parseAndValidateBacklogJson
// ============================================================================

/**
 * Parses the backlogJson string and validates the payload.
 * Throws 400 errors with descriptive messages on validation failures.
 *
 * @param backlogJson - The raw JSON string from the request
 * @returns Parsed and validated BacklogInput
 * @throws HttpError with statusCode 400 on invalid input
 */
export function parseAndValidateBacklogJson(backlogJson: string): BacklogInput {
  let parsed: any;
  try {
    parsed = JSON.parse(backlogJson);
  } catch (e: any) {
    throw createHttpError(400, `Invalid JSON: ${e.message}`);
  }

  // Validate epicId
  if (!parsed.epicId || typeof parsed.epicId !== 'string' || parsed.epicId.trim() === '') {
    throw createHttpError(400, 'epicId is required and must be a non-empty string');
  }

  // Validate features array
  if (!parsed.features || !Array.isArray(parsed.features) || parsed.features.length === 0) {
    throw createHttpError(400, 'features array is required and must be non-empty');
  }

  // Validate feature titles and uniqueness
  const featureTitleSet = new Set<string>();
  for (let i = 0; i < parsed.features.length; i++) {
    const feature = parsed.features[i];
    if (!feature.title || typeof feature.title !== 'string' || feature.title.trim() === '') {
      throw createHttpError(400, `features[${i}].title is required and must be a non-empty string`);
    }
    const lowerTitle = feature.title.trim().toLowerCase();
    if (featureTitleSet.has(lowerTitle)) {
      throw createHttpError(400, `Duplicate feature title (case-insensitive): "${feature.title}"`);
    }
    featureTitleSet.add(lowerTitle);

    // Validate story titles within this feature
    if (feature.stories && Array.isArray(feature.stories)) {
      const storyTitleSet = new Set<string>();
      for (let j = 0; j < feature.stories.length; j++) {
        const story = feature.stories[j];
        if (!story.title || typeof story.title !== 'string' || story.title.trim() === '') {
          throw createHttpError(400, `features[${i}].stories[${j}].title is required and must be a non-empty string`);
        }
        const storyLower = story.title.trim().toLowerCase();
        if (storyTitleSet.has(storyLower)) {
          throw createHttpError(400, `Duplicate story title within feature "${feature.title}" (case-insensitive): "${story.title}"`);
        }
        storyTitleSet.add(storyLower);
      }
    }
  }

  return parsed as BacklogInput;
}

// ============================================================================
// buildMatchingMaps (same pattern as roadmapStructureService)
// ============================================================================

/**
 * Builds matching maps from existing work items for upsert lookup.
 *
 * @param existingWorkItems - Array of existing WorkItemDto from the backend
 * @returns Object with idMap, externalRefMap, and typeTitleMap for matching
 */
export function buildMatchingMaps(existingWorkItems: WorkItemDto[]): {
  idMap: Record<string, WorkItemDto>;
  externalRefMap: Record<string, WorkItemDto>;
  typeTitleMap: Record<string, WorkItemDto>;
} {
  const idMap: Record<string, WorkItemDto> = {};
  const externalRefMap: Record<string, WorkItemDto> = {};
  const typeTitleMap: Record<string, WorkItemDto> = {};

  for (const item of existingWorkItems) {
    idMap[item.id] = item;
    if (item.external_system && item.external_key) {
      externalRefMap[`${item.external_system}::${item.external_key}`] = item;
    }
    typeTitleMap[`${item.type}::${item.title.toLowerCase()}`] = item;
  }

  return { idMap, externalRefMap, typeTitleMap };
}

// ============================================================================
// upsertWorkItem (internal helper)
// ============================================================================

/**
 * Upserts a single work item (feature or story) using ID-first, externalRef-second,
 * title-fallback matching.
 *
 * @param projectId - The project UUID
 * @param inputId - Existing work item ID from input (for updates/renames), or null for new items
 * @param title - Work item title
 * @param description - Work item description or null
 * @param externalRef - External reference for matching, or null
 * @param type - Work item type: 'FEATURE' or 'STORY'
 * @param sortOrder - Position index for sort_order
 * @param parentId - Parent work item ID
 * @param idMap - Map of existing items keyed by ID
 * @param externalRefMap - Map of existing items keyed by external ref
 * @param typeTitleMap - Map of existing items keyed by type::title
 * @param warnings - Warnings accumulator array
 * @returns Object with action ('created' or 'updated') and the resulting WorkItemDto
 */
async function upsertWorkItem(
  projectId: string,
  inputId: string | null,
  title: string,
  description: string | null,
  externalRef: { system: string; key: string } | null,
  type: string,
  sortOrder: number,
  parentId: string,
  idMap: Record<string, WorkItemDto>,
  externalRefMap: Record<string, WorkItemDto>,
  typeTitleMap: Record<string, WorkItemDto>,
  warnings: string[]
): Promise<{ action: 'created' | 'updated'; workItem: WorkItemDto }> {
  let matchedItem: WorkItemDto | undefined;

  // Match priority 0: explicit ID match (highest priority — supports renames)
  if (inputId) {
    matchedItem = idMap[inputId];
    if (matchedItem && matchedItem.title.toLowerCase() !== title.toLowerCase()) {
      warnings.push(
        `ID match (${inputId}): renaming "${matchedItem.title}" to "${title}"`
      );
    }
    if (!matchedItem) {
      warnings.push(
        `ID match attempted for ${type} "${title}" but ID ${inputId} not found — will try other matching or create new`
      );
    }
  }

  // Match priority 1: externalRef match
  if (!matchedItem && externalRef && externalRef.system && externalRef.key) {
    const refKey = `${externalRef.system}::${externalRef.key}`;
    matchedItem = externalRefMap[refKey];
    if (matchedItem && matchedItem.title.toLowerCase() !== title.toLowerCase()) {
      warnings.push(
        `ExternalRef match (${externalRef.system}::${externalRef.key}): existing title "${matchedItem.title}" differs from input title "${title}" (possible rename)`
      );
    }
  }

  // Match priority 2: title fallback scoped to items under this parent
  if (!matchedItem) {
    const titleKey = `${type}::${title.toLowerCase()}`;
    const candidateItem = typeTitleMap[titleKey];
    // Only match if the candidate is under the same parent
    if (candidateItem && candidateItem.parent_id === parentId) {
      matchedItem = candidateItem;
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
// buildStoryDescription
// ============================================================================

/**
 * Builds the description field for a story by concatenating the story description
 * and acceptance criteria into a single string.
 *
 * @param description - Optional story description
 * @param acceptanceCriteria - Optional array of acceptance criteria strings
 * @returns Combined description string, or null if both are empty
 */
function buildStoryDescription(
  description?: string,
  acceptanceCriteria?: string[]
): string | null {
  const parts: string[] = [];

  if (description && description.trim().length > 0) {
    parts.push(description.trim());
  }

  if (acceptanceCriteria && Array.isArray(acceptanceCriteria) && acceptanceCriteria.length > 0) {
    parts.push('');
    parts.push('Acceptance Criteria:');
    for (const ac of acceptanceCriteria) {
      parts.push(`- ${ac}`);
    }
  }

  const result = parts.join('\n');
  return result.length > 0 ? result : null;
}

// ============================================================================
// saveBacklogItems (main orchestrator)
// ============================================================================

/**
 * Main orchestrator function for saving backlog items (features and stories).
 *
 * Orchestration flow:
 * 0. (Optional) Update epic priorities
 * 1. Parse and validate the backlogJson input
 * 2. Fetch existing work items from the backend
 * 3. Build matching maps for upsert lookup
 * 4. Phase 1: Upsert features (collecting resolved IDs)
 * 5. Phase 2: Upsert stories (using resolved feature IDs as parent_id)
 * 6. Tally and return results with warnings
 *
 * @param projectId - The project UUID
 * @param backlogJson - The raw JSON string of the backlog payload
 * @returns Promise resolving to the save result
 */
export async function saveBacklogItems(
  projectId: string,
  backlogJson: string
): Promise<SaveBacklogItemsResult> {
  // 1. Parse and validate
  const input = parseAndValidateBacklogJson(backlogJson);

  const warnings: string[] = [];
  let updatedEpicPriorities = 0;

  // Phase 0: Update epic priorities if present
  if (input.epicPriorityUpdates && input.epicPriorityUpdates.length > 0) {
    for (const update of input.epicPriorityUpdates) {
      try {
        await archModelClient.updateWorkItem(projectId, update.id, {
          priority: String(update.priority),
        } as Partial<WorkItemDto>);
        updatedEpicPriorities++;
      } catch (err: any) {
        warnings.push(
          `Failed to update priority for epic "${update.title}" (${update.id}): ${err.message}`
        );
      }
    }
  }

  // 2. Fetch existing work items
  let existingWorkItems: WorkItemDto[];
  try {
    existingWorkItems = await archModelClient.listWorkItems(projectId);
  } catch (err: any) {
    throw createHttpError(502, `Failed to fetch existing work items: ${err.message}`);
  }

  // 3. Build matching maps
  const { idMap, externalRefMap, typeTitleMap } = buildMatchingMaps(existingWorkItems);

  // 4. Phase 1: Delete work items (before upsert, to avoid conflicts with renames)
  let deletedWorkItems = 0;
  if (input.deletedWorkItemIds && input.deletedWorkItemIds.length > 0) {
    for (const deleteId of input.deletedWorkItemIds) {
      try {
        await archModelClient.deleteWorkItem(projectId, deleteId);
        deletedWorkItems++;
        // Remove from maps so upsert doesn't match deleted items
        delete idMap[deleteId];
      } catch (err: any) {
        warnings.push(
          `Failed to delete work item ${deleteId}: ${err.message}`
        );
      }
    }
  }

  // 5. Phase 2: Upsert features
  const featureIdMap: Record<number, string> = {};
  let createdFeatures = 0;
  let updatedFeatures = 0;

  for (let i = 0; i < input.features.length; i++) {
    const feature = input.features[i];
    const result = await upsertWorkItem(
      projectId,
      feature.id || null,
      feature.title,
      feature.description || null,
      feature.externalRef || null,
      'FEATURE',
      i,
      input.epicId,
      idMap,
      externalRefMap,
      typeTitleMap,
      warnings
    );
    featureIdMap[i] = result.workItem.id;
    if (result.action === 'created') createdFeatures++;
    else updatedFeatures++;
  }

  // 6. Phase 3: Upsert stories (tracking upserted IDs for orphan cleanup)
  let createdStories = 0;
  let updatedStories = 0;
  const upsertedStoryIds = new Set<string>();

  for (let i = 0; i < input.features.length; i++) {
    const feature = input.features[i];
    const parentId = featureIdMap[i];
    for (let j = 0; j < (feature.stories || []).length; j++) {
      const story = feature.stories[j];
      const storyDescription = buildStoryDescription(story.description, story.acceptanceCriteria);
      const result = await upsertWorkItem(
        projectId,
        story.id || null,
        story.title,
        storyDescription,
        story.externalRef || null,
        'STORY',
        j,
        parentId,
        idMap,
        externalRefMap,
        typeTitleMap,
        warnings
      );
      upsertedStoryIds.add(result.workItem.id);
      if (result.action === 'created') createdStories++;
      else updatedStories++;
    }
  }

  // 7. Phase 4: Orphan cleanup — delete existing features/stories under this epic
  // that are NOT in the upserted set. This gives proposedFeatures "replace" semantics:
  // items the PM kept (with or without edits) are in the upserted set; items the PM
  // removed (merges, deletions) are not, and get cleaned up here.
  // Only FEATURE and STORY types are affected; TEST items are preserved.
  const upsertedFeatureIds = new Set(Object.values(featureIdMap));
  const alreadyDeletedIds = new Set(input.deletedWorkItemIds || []);

  // Delete orphaned features (ON DELETE CASCADE will remove their stories too)
  const existingFeaturesUnderEpic = existingWorkItems.filter(
    wi => wi.type === 'FEATURE' && wi.parent_id === input.epicId
  );
  for (const feature of existingFeaturesUnderEpic) {
    if (!upsertedFeatureIds.has(feature.id) && !alreadyDeletedIds.has(feature.id)) {
      try {
        await archModelClient.deleteWorkItem(projectId, feature.id);
        deletedWorkItems++;
        warnings.push(
          `Orphan cleanup: deleted feature "${feature.title}" (${feature.id}) — not in proposed features`
        );
      } catch (err: any) {
        warnings.push(
          `Failed to delete orphaned feature "${feature.title}" (${feature.id}): ${err.message}`
        );
      }
    }
  }

  // Delete orphaned stories under features that were kept
  for (const featureId of upsertedFeatureIds) {
    const existingStoriesUnderFeature = existingWorkItems.filter(
      wi => wi.type === 'STORY' && wi.parent_id === featureId
    );
    for (const story of existingStoriesUnderFeature) {
      if (!upsertedStoryIds.has(story.id) && !alreadyDeletedIds.has(story.id)) {
        try {
          await archModelClient.deleteWorkItem(projectId, story.id);
          deletedWorkItems++;
          warnings.push(
            `Orphan cleanup: deleted story "${story.title}" (${story.id}) — not in proposed stories`
          );
        } catch (err: any) {
          warnings.push(
            `Failed to delete orphaned story "${story.title}" (${story.id}): ${err.message}`
          );
        }
      }
    }
  }

  return {
    createdFeatures,
    updatedFeatures,
    createdStories,
    updatedStories,
    deletedWorkItems,
    updatedEpicPriorities,
    warnings,
  };
}

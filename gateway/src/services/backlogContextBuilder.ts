/**
 * Backlog Context Builder
 *
 * Builds a formatted epic list string for the backlog discovery task.
 * Groups epics by initiative and includes priority, feature/story details,
 * and work item statuses for edit-awareness.
 *
 * Spec: Manage Backlog structured discovery task
 */

import { getConfig } from '../config';
import { logger } from './logger';

/** Minimal work item shape needed by the context builder. */
interface BacklogWorkItem {
  id: string;
  type: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: string | null;
  priority: number | null;
  sort_order: number;
}

/**
 * Builds a formatted string listing all epics grouped by initiative.
 * Includes epic ID, title, priority (if set), and existing feature/story
 * breakdown with statuses. Status visibility allows the PM to warn before
 * editing work items that are already in progress.
 *
 * Returns null if no work items or no epics exist.
 *
 * @param projectId - The project UUID
 * @returns Formatted epic list string, or null if no data
 */
export async function buildEpicListForBacklog(projectId: string): Promise<string | null> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}/work-items`;

  let workItems: BacklogWorkItem[];
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      logger.warn('Work items fetch failed for backlog context', {
        projectId,
        status: response.status,
      });
      return null;
    }
    workItems = await response.json();
  } catch (err) {
    logger.warn('Work items fetch error for backlog context', {
      projectId,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
    return null;
  }

  if (!Array.isArray(workItems) || workItems.length === 0) {
    return null;
  }

  const initiatives = workItems.filter(wi => wi.type === 'INITIATIVE');
  const epics = workItems.filter(wi => wi.type === 'EPIC');
  const features = workItems.filter(wi => wi.type === 'FEATURE');
  const stories = workItems.filter(wi => wi.type === 'STORY');

  if (epics.length === 0) {
    return null;
  }

  // Build parent→children maps
  const storiesByFeature = new Map<string, BacklogWorkItem[]>();
  for (const s of stories) {
    if (s.parent_id) {
      const list = storiesByFeature.get(s.parent_id) || [];
      list.push(s);
      storiesByFeature.set(s.parent_id, list);
    }
  }

  const featuresByEpic = new Map<string, BacklogWorkItem[]>();
  for (const f of features) {
    if (f.parent_id) {
      const list = featuresByEpic.get(f.parent_id) || [];
      list.push(f);
      featuresByEpic.set(f.parent_id, list);
    }
  }

  const initiativeIds = new Set(initiatives.map(i => i.id));
  const epicsByInitiative = new Map<string, BacklogWorkItem[]>();
  const orphanEpics: BacklogWorkItem[] = [];
  for (const e of epics) {
    if (e.parent_id && initiativeIds.has(e.parent_id)) {
      const list = epicsByInitiative.get(e.parent_id) || [];
      list.push(e);
      epicsByInitiative.set(e.parent_id, list);
    } else {
      orphanEpics.push(e);
    }
  }

  // Render
  const lines: string[] = ['## Available Epics', ''];
  let totalEpics = 0;

  const renderEpics = (epicsToRender: BacklogWorkItem[]) => {
    for (const epic of epicsToRender) {
      const priorityStr = epic.priority != null ? `priority: ${epic.priority}` : 'priority: \u2014';
      const epicFeatures = featuresByEpic.get(epic.id) || [];
      const featureCount = epicFeatures.length;
      lines.push(`- [id: ${epic.id}] ${epic.title} (${priorityStr}, ${featureCount} feature${featureCount !== 1 ? 's' : ''})`);

      // Show feature breakdown with IDs, descriptions, statuses, and stories
      for (const feature of epicFeatures) {
        const featureStories = storiesByFeature.get(feature.id) || [];
        const statusStr = feature.status || 'PLANNED';
        const storyCountStr = featureStories.length > 0
          ? `${featureStories.length} stor${featureStories.length !== 1 ? 'ies' : 'y'}`
          : 'no stories';
        lines.push(`  - [id: ${feature.id}] Feature: ${feature.title} [status: ${statusStr}] (${storyCountStr})`);
        if (feature.description) {
          lines.push(`    Description: ${feature.description}`);
        }
        // Show individual stories with IDs, titles, statuses, and descriptions
        for (const story of featureStories) {
          const storyStatus = story.status || 'PLANNED';
          lines.push(`    - [id: ${story.id}] Story: ${story.title} [status: ${storyStatus}]`);
          if (story.description) {
            lines.push(`      Description: ${story.description}`);
          }
        }
      }

      totalEpics++;
    }
  };

  for (const initiative of initiatives) {
    const initiativeTitle = initiative.title?.trim() || 'Unassigned';
    const initEpics = epicsByInitiative.get(initiative.id) || [];
    if (initEpics.length === 0) continue;

    lines.push(`### Initiative: ${initiativeTitle}`);
    renderEpics(initEpics);
    lines.push('');
  }

  if (orphanEpics.length > 0) {
    lines.push(`### Initiative: Unassigned`);
    renderEpics(orphanEpics);
    lines.push('');
  }

  if (totalEpics === 0) {
    return null;
  }

  logger.debug('Built epic list for backlog context', {
    projectId,
    epicCount: totalEpics,
  });

  return lines.join('\n');
}

/**
 * Reusable architecture context builder for LLM task conversations.
 *
 * Provides functions to fetch the full architecture model, load the static
 * meta-model explainer, and combine them into a single context section string
 * suitable for injection into system prompts.
 *
 * Spec: 2026-03-14 Detailed Data Model Task -- End-to-End Fix
 * Task Group 2: Architecture Context Builder (Reusable Package)
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getConfig } from '../config';
import { logger } from './logger';
import { resolveDefaultArchitectureId } from './architectureModelClient';

/** Cached explainer content — loaded once on first access. */
let cachedExplainer: string | null = null;

/**
 * The 6 data-model-related keys to retain when building a filtered data model context.
 * Entity keys live under the `entities` sub-object; relationship keys live under `relationships`.
 */
const DATA_MODEL_KEYS = new Set([
  'logical_data_entities',
  'logical_data_attributes',
  'physical_data_entities',
  'physical_data_attributes',
  'logical_data_entity_relationships',
  'logical_data_entity_physical_data_entities',
]);

/**
 * Looks up the project name (used as the model filename) for a given project ID.
 *
 * Calls GET /api/projects/{projectId} and extracts the `name` field.
 *
 * @param projectId - The project ID (UUID string)
 * @returns The project name string, or null on error
 */
async function fetchProjectName(projectId: string): Promise<string | null> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      logger.warn('Failed to fetch project name for architecture context', {
        projectId,
        status: response.status,
      });
      return null;
    }

    const data = await response.json() as Record<string, unknown>;
    const name = data.name;
    if (name && typeof name === 'string' && name.trim().length > 0) {
      return name;
    }

    logger.warn('Project name missing or empty in project response', { projectId });
    return null;
  } catch (error) {
    logger.warn('Failed to fetch project name from architecture model service', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Fetches the full architecture model for a project from the architecture-model-service.
 *
 * Resolves the project name first via GET /api/projects/{projectId}, then fetches
 * the model via GET /api/model?filename={name}. This uses the filename-based lookup
 * which matches the save path used by save_architecture_baseline (GET-merge-PUT by
 * filename), ensuring newly saved data is always visible.
 *
 * Falls back to GET /api/model?projectId={projectId} if the project name lookup fails.
 *
 * Strips the `diagrams` array to reduce token count.
 *
 * @param projectId - The project ID (UUID string)
 * @returns Parsed model data object (with diagrams stripped) or null on error
 */
export async function fetchFullArchitectureContext(
  projectId: string
): Promise<object | null> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;

  // Resolve project name to use filename-based model lookup (matches save path).
  // Spec 2026-05-01 Multi-Architecture Plumbing - Task Group 3:
  //   the projectId fallback now uses the path-segment Bucket A endpoint
  //   `/api/model/projects/{projectId}/architectures/{architectureId}`. The old
  //   query-param form (`/api/model?projectId=...`) was removed.
  //   The filename branch (`/api/model?filename=...`) is preserved as-is --
  //   it is filename-keyed, not architecture-scoped.
  const projectName = await fetchProjectName(projectId);
  let url: string;
  if (projectName) {
    url = `${baseUrl}/api/model?filename=${encodeURIComponent(projectName)}`;
  } else {
    const architectureId = await resolveDefaultArchitectureId(projectId);
    if (!architectureId) {
      logger.warn('Cannot fetch full architecture context: no projectName and no default architecture', { projectId });
      return null;
    }
    url = `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}`;
  }

  logger.debug('Fetching full architecture context from architecture-model-service', {
    projectId,
    projectName,
    url,
  });

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.warn('Architecture model service returned non-OK response for full model', {
        projectId,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as Record<string, unknown>;

    // Strip diagrams array to reduce token count
    if ('diagrams' in data) {
      delete data.diagrams;
    }

    logger.debug('Successfully fetched full architecture context', {
      projectId,
      topLevelKeys: Object.keys(data),
    });

    return data;
  } catch (error) {
    logger.warn('Failed to fetch full architecture context from architecture model service', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Loads the static architecture meta-model explainer markdown from disk.
 *
 * Reads the file at gateway/src/config/prompts/shared/architecture-context-explainer.md
 * which contains descriptions of all entity types and relationship types in the
 * architecture meta-model.
 *
 * @returns The explainer markdown content as a string
 */
export async function loadArchitectureExplainer(): Promise<string> {
  const explainerPath = path.join(
    __dirname,
    '..',
    'config',
    'prompts',
    'shared',
    'architecture-context-explainer.md'
  );

  const content = await fs.readFile(explainerPath, 'utf-8');
  return content;
}

/**
 * Synchronous version of loadArchitectureExplainer.
 * Uses a module-level cache so the file is read at most once.
 * Suitable for use in synchronous prompt builder functions.
 *
 * @returns The explainer markdown content as a string, or empty string on error
 */
export function loadArchitectureExplainerSync(): string {
  if (cachedExplainer !== null) {
    return cachedExplainer;
  }

  const explainerPath = path.join(
    __dirname,
    '..',
    'config',
    'prompts',
    'shared',
    'architecture-context-explainer.md'
  );

  try {
    cachedExplainer = fsSync.readFileSync(explainerPath, 'utf-8');
    return cachedExplainer;
  } catch (error) {
    logger.warn('Failed to load architecture explainer synchronously', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return '';
  }
}

/**
 * Builds a complete architecture context section for injection into a system prompt.
 *
 * Combines the static meta-model explainer with the project's full architecture model
 * data (as JSON). Returns an empty string if the model fetch returns null (graceful
 * degradation -- the task can still proceed without architecture context).
 *
 * @param projectId - The project ID (UUID string)
 * @returns Combined context section string, or empty string if model fetch fails
 */
export async function buildArchitectureContextSection(
  projectId: string
): Promise<string> {
  const modelData = await fetchFullArchitectureContext(projectId);

  if (!modelData) {
    return '';
  }

  const explainer = await loadArchitectureExplainer();

  return `${explainer}\n\n## Current Architecture Model Data\n\n${JSON.stringify(modelData, null, 2)}`;
}

/**
 * Builds a filtered data model context section for injection into a system prompt.
 *
 * Fetches the full architecture model via fetchFullArchitectureContext, then filters
 * the result to include ONLY the 6 data-related keys:
 *   - logical_data_entities, logical_data_attributes (entity types)
 *   - physical_data_entities, physical_data_attributes (entity types)
 *   - logical_data_entity_relationships (relationship type)
 *   - logical_data_entity_physical_data_entities (relationship type)
 *
 * These keys may be nested under `entities` and/or `relationships` sub-objects in the
 * model data. The function preserves the nested structure but strips all non-data keys.
 *
 * Combines the filtered data with the architecture explainer markdown, following the
 * same compose pattern as buildArchitectureContextSection.
 *
 * Returns an empty string if the model fetch returns null (graceful degradation).
 *
 * @param projectId - The project ID (UUID string)
 * @returns Combined context section string with filtered data model, or empty string on failure
 */
export async function buildDataModelContextSection(
  projectId: string
): Promise<string> {
  const modelData = await fetchFullArchitectureContext(projectId);

  if (!modelData) {
    return '';
  }

  const raw = modelData as Record<string, unknown>;

  // The API returns { metaModel: { entities: {...}, relationships: {...} }, diagrams: [...] }.
  // Unwrap the metaModel wrapper so the filter operates on { entities, relationships }.
  const data: Record<string, unknown> =
    raw.metaModel && typeof raw.metaModel === 'object' && !Array.isArray(raw.metaModel)
      ? (raw.metaModel as Record<string, unknown>)
      : raw;

  const filtered: Record<string, unknown> = {};

  for (const [topKey, topValue] of Object.entries(data)) {
    if (topValue && typeof topValue === 'object' && !Array.isArray(topValue)) {
      // Sub-object (e.g. entities, relationships) -- filter its keys
      const subObj = topValue as Record<string, unknown>;
      const filteredSub: Record<string, unknown> = {};
      for (const [subKey, subValue] of Object.entries(subObj)) {
        if (DATA_MODEL_KEYS.has(subKey)) {
          filteredSub[subKey] = subValue;
        }
      }
      if (Object.keys(filteredSub).length > 0) {
        filtered[topKey] = filteredSub;
      }
    } else if (DATA_MODEL_KEYS.has(topKey)) {
      // Top-level key that matches (flat model structure)
      filtered[topKey] = topValue;
    }
  }

  const explainer = await loadArchitectureExplainer();

  return `${explainer}\n\n## Current Data Model\n\n${JSON.stringify(filtered, null, 2)}`;
}

/**
 * Jira Import Service for Roadmap Skeleton
 *
 * Orchestrates importing Jira Initiatives and Epics as canonical work items
 * in the architecture-model-service via a two-phase upsert approach.
 *
 * Spec 2026-02-15: RM Increment 4 -- Jira Import for Roadmap Skeleton (Initiatives + Epics)
 * Task Group 2: Jira Import Service Module
 */

import axios from 'axios';
import crypto from 'crypto';
import { getConfig } from '../config';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/**
 * Request payload for importing a Jira roadmap skeleton.
 */
export interface JiraImportRequest {
  projectId: string;
  jql: string;
  jiraProjectKey: string;
  maxResults?: number;
}

/**
 * Result of a Jira roadmap import operation.
 *
 * Extended in 2026-04-30 to cover all 7 work item types. Original four
 * roadmap-level fields (initiatives/epics) are preserved for backward
 * compatibility with existing callers.
 */
export interface JiraImportResult {
  createdInitiatives: number;
  updatedInitiatives: number;
  createdEpics: number;
  updatedEpics: number;
  createdFeatures: number;
  updatedFeatures: number;
  createdStories: number;
  updatedStories: number;
  createdTasks: number;
  updatedTasks: number;
  createdBugs: number;
  updatedBugs: number;
  createdTests: number;
  updatedTests: number;
  warnings: string[];
}

/**
 * Internal full-hierarchy partition by type, used by the v2 importer.
 */
interface FullFilterResult {
  initiatives: WorkItemDto[];
  epics: WorkItemDto[];
  features: WorkItemDto[];
  stories: WorkItemDto[];
  tasks: WorkItemDto[];
  bugs: WorkItemDto[];
  tests: WorkItemDto[];
  warnings: string[];
}

/**
 * Gateway-side WorkItemDto matching the architecture-model-service JSON contract.
 * Uses snake_case field names to match the JSON serialization.
 */
export interface WorkItemDto {
  id: string;
  project_id: string;
  type: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: string;
  sort_order: number;
  priority: number | null;
  target_window: string | null;
  tags: Record<string, unknown> | null;
  external_system: string | null;
  external_key: string | null;
  external_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * Internal result from filtering work items by type.
 */
interface FilterResult {
  initiatives: WorkItemDto[];
  epics: WorkItemDto[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Helper: Jira Service URL
// ---------------------------------------------------------------------------

/**
 * Returns the jira-service base URL from config.
 */
function getJiraServiceUrl(): string {
  return getConfig().jiraServiceBaseUrl;
}

// ---------------------------------------------------------------------------
// Helper: Fetch Jira Issues
// ---------------------------------------------------------------------------

/**
 * Calls the jira-service GET /jira/issues endpoint with the provided query
 * parameters.  Follows the axios pattern from gateway/src/routes/jiraIssues.ts.
 *
 * @param projectId - The tool project ID
 * @param jql - JQL query string
 * @param jiraProjectKey - The Jira project key (e.g. "PROJ")
 * @param maxResults - Maximum number of results to return
 * @returns Array of WorkItemDto objects from jira-service
 */
export async function fetchJiraIssues(
  projectId: string,
  jql: string,
  jiraProjectKey: string,
  maxResults: number,
  /**
   * Optional per-request Jira-issue-type → tool-type override (sync's dynamic
   * mapping). Sent to jira-service as URL-encoded JSON via the `typeMappingJson`
   * query param. When provided, jira-service uses it for type translation in
   * place of its static yml mapping.
   */
  jiraToToolOverride?: Record<string, string>,
): Promise<WorkItemDto[]> {
  const url = `${getJiraServiceUrl()}/jira/issues`;

  logger.debug('Fetching Jira issues from jira-service', {
    url,
    jql,
    jiraProjectKey,
    toolProjectId: projectId,
    maxResults,
  });

  const params: Record<string, unknown> = {
    jql,
    jiraProjectKey,
    toolProjectId: projectId,
    maxResults,
    expandChildren: false,
  };
  if (jiraToToolOverride && Object.keys(jiraToToolOverride).length > 0) {
    params.typeMappingJson = JSON.stringify(jiraToToolOverride);
  }
  const response = await axios.get<WorkItemDto[]>(url, {
    params,
    timeout: 30000,
  });

  logger.info('Fetched Jira issues from jira-service', {
    count: Array.isArray(response.data) ? response.data.length : 0,
  });

  return response.data;
}

// ---------------------------------------------------------------------------
// Helper: Filter to Initiatives and Epics
// ---------------------------------------------------------------------------

/**
 * Filters a list of work items to only INITIATIVE and EPIC types.
 * Emits warnings for any items with other types that are skipped.
 *
 * @param items - Array of WorkItemDto from jira-service
 * @returns Object with initiatives, epics, and warnings arrays
 */
export function filterToInitiativesAndEpics(items: WorkItemDto[]): FilterResult {
  const initiatives: WorkItemDto[] = [];
  const epics: WorkItemDto[] = [];
  const warnings: string[] = [];

  for (const item of items) {
    if (item.type === 'INITIATIVE') {
      initiatives.push(item);
    } else if (item.type === 'EPIC') {
      epics.push(item);
    } else {
      warnings.push(
        `Skipped item ${item.external_key} with type ${item.type} (only INITIATIVE and EPIC are imported)`,
      );
    }
  }

  return { initiatives, epics, warnings };
}

/**
 * Partitions work items into all 7 hierarchy buckets. Items with unknown types
 * (anything outside INITIATIVE/EPIC/FEATURE/STORY/TASK/BUG/TEST) produce a
 * warning and are dropped.
 */
function filterByType(items: WorkItemDto[]): FullFilterResult {
  const out: FullFilterResult = {
    initiatives: [],
    epics: [],
    features: [],
    stories: [],
    tasks: [],
    bugs: [],
    tests: [],
    warnings: [],
  };

  for (const item of items) {
    switch (item.type) {
      case 'INITIATIVE': out.initiatives.push(item); break;
      case 'EPIC': out.epics.push(item); break;
      case 'FEATURE': out.features.push(item); break;
      case 'STORY': out.stories.push(item); break;
      case 'TASK': out.tasks.push(item); break;
      case 'BUG': out.bugs.push(item); break;
      case 'TEST': out.tests.push(item); break;
      default:
        out.warnings.push(
          `Skipped item ${item.external_key} with unknown type ${item.type}`,
        );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helper: Generate Deterministic ID (UUIDv3)
// ---------------------------------------------------------------------------

/**
 * Replicates Java's UUID.nameUUIDFromBytes(input.getBytes(UTF_8)) in TypeScript.
 *
 * Algorithm:
 *   1. Compute MD5 hash of the UTF-8 input bytes
 *   2. Set version bits: byte[6] = (byte[6] & 0x0f) | 0x30  (version 3)
 *   3. Set variant bits: byte[8] = (byte[8] & 0x3f) | 0x80  (variant 2)
 *   4. Format as standard UUID string
 *
 * @param input - The input string to hash (e.g. "projectId:IMPORTED_ROADMAP")
 * @returns Deterministic UUID string
 */
export function generateDeterministicId(input: string): string {
  const md5Bytes = crypto.createHash('md5').update(input, 'utf8').digest();

  // Set version 3 bits on byte 6
  md5Bytes[6] = (md5Bytes[6] & 0x0f) | 0x30;

  // Set variant bits on byte 8
  md5Bytes[8] = (md5Bytes[8] & 0x3f) | 0x80;

  // Format as UUID: 8-4-4-4-12
  const hex = md5Bytes.toString('hex');
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32),
  ].join('-');
}

// ---------------------------------------------------------------------------
// Helper: Construct External URL
// ---------------------------------------------------------------------------

/**
 * Builds a Jira browse URL for the given external key.
 *
 * @param jiraBrowseBaseUrl - Base URL of the Jira instance (e.g. "https://jira.example.com")
 * @param externalKey - The Jira issue key (e.g. "PROJ-123")
 * @returns Full browse URL (e.g. "https://jira.example.com/browse/PROJ-123")
 */
export function constructExternalUrl(jiraBrowseBaseUrl: string, externalKey: string): string {
  const base = jiraBrowseBaseUrl.replace(/\/+$/, '');
  return `${base}/browse/${externalKey}`;
}

// ---------------------------------------------------------------------------
// Helper: Orphan Detection
// ---------------------------------------------------------------------------

/**
 * Detects orphan EPICs whose parent_id does not match any INITIATIVE in the
 * filtered result set.
 *
 * @param epics - Array of EPIC work items
 * @param initiatives - Array of INITIATIVE work items
 * @returns Array of orphan EPIC work items
 */
export function resolveOrphanEpics(
  epics: WorkItemDto[],
  initiatives: WorkItemDto[],
): WorkItemDto[] {
  const initiativeIds = new Set(initiatives.map((i) => i.id));

  return epics.filter(
    (epic) => epic.parent_id === null || !initiativeIds.has(epic.parent_id),
  );
}

// ---------------------------------------------------------------------------
// Helper: Build Synthetic Initiative
// ---------------------------------------------------------------------------

/**
 * Creates a synthetic "Imported Roadmap" initiative work item for grouping
 * orphan EPICs that have no parent INITIATIVE in the import set.
 *
 * Uses a deterministic ID derived from projectId + ":IMPORTED_ROADMAP" so that
 * re-imports produce the same initiative (idempotent).
 *
 * @param projectId - The tool project ID
 * @returns A WorkItemDto representing the synthetic initiative
 */
export function buildSyntheticInitiative(projectId: string): WorkItemDto {
  return {
    id: generateDeterministicId(projectId + ':IMPORTED_ROADMAP'),
    project_id: projectId,
    type: 'INITIATIVE',
    parent_id: null,
    title: 'Imported Roadmap',
    description: null,
    status: 'PLANNED',
    sort_order: 0,
    priority: null,
    target_window: null,
    tags: null,
    external_system: null,
    external_key: null,
    external_url: null,
    created_at: null,
    updated_at: null,
  };
}

// ---------------------------------------------------------------------------
// Helper: Architecture Model Service calls (native fetch)
// ---------------------------------------------------------------------------

/**
 * Lists all existing work items for a project from the architecture-model-service.
 * Uses native fetch following the pattern in architectureModelClient.ts.
 *
 * @param projectId - The project ID
 * @returns Array of existing WorkItemDto objects
 */
async function listExistingWorkItems(projectId: string): Promise<WorkItemDto[]> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}/work-items`;

  logger.debug('Listing existing work items from architecture-model-service', {
    projectId,
    url,
  });

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to list work items: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as WorkItemDto[];

  logger.debug('Listed existing work items', {
    projectId,
    count: data.length,
  });

  return data;
}

/**
 * Creates a work item in the architecture-model-service via POST.
 *
 * @param projectId - The project ID
 * @param item - The work item to create
 * @returns The created WorkItemDto
 */
async function createWorkItem(
  projectId: string,
  item: WorkItemDto,
): Promise<WorkItemDto> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}/work-items`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(item),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `Failed to create work item: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  return (await response.json()) as WorkItemDto;
}

/**
 * Updates an existing work item in the architecture-model-service via PUT.
 *
 * @param projectId - The project ID
 * @param itemId - The work item ID to update
 * @param item - The updated work item data
 * @returns The updated WorkItemDto
 */
async function updateWorkItem(
  projectId: string,
  itemId: string,
  item: WorkItemDto,
): Promise<WorkItemDto> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(itemId)}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(item),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `Failed to update work item: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  return (await response.json()) as WorkItemDto;
}

// ---------------------------------------------------------------------------
// Helper: Build Lookup Map
// ---------------------------------------------------------------------------

/**
 * Builds a lookup map of existing work items keyed by "external_system:external_key".
 * Items with null external_key are excluded from the map.
 *
 * @param existingItems - Array of existing work items
 * @returns Map keyed by "external_system:external_key"
 */
function buildLookupMap(existingItems: WorkItemDto[]): Map<string, WorkItemDto> {
  const map = new Map<string, WorkItemDto>();

  for (const item of existingItems) {
    if (item.external_key != null && item.external_system != null) {
      const key = `${item.external_system}:${item.external_key}`;
      map.set(key, item);
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Main Orchestrator
// ---------------------------------------------------------------------------

/**
 * Imports a Jira project (or scope filtered by JQL) into the architecture-model-service.
 *
 * Originally roadmap-only (Initiative + Epic). Extended 2026-04-30 to handle
 * the full hierarchy: INITIATIVE > EPIC > FEATURE > STORY > (TASK | BUG | TEST).
 * Function name kept for caller backward compatibility despite the broader scope.
 *
 * Orchestration:
 *   1. Fetch Jira issues via jira-service
 *   2. Partition by type (filterByType)
 *   3. Detect orphan EPICs and build synthetic "Imported Roadmap" initiative
 *      if needed (preserves legacy roadmap behaviour). Orphans at deeper levels
 *      keep parent_id=null and produce a warning.
 *   4. Phase 0: List existing work items and build lookup map
 *   5. Phase 1: Upsert INITIATIVEs (including synthetic if needed)
 *   6. Phase 2: Upsert EPICs with resolved parent_id
 *   7. Phase 3: Upsert FEATUREs
 *   8. Phase 4: Upsert STORIEs
 *   9. Phase 5: Upsert TASKs, BUGs, TESTs (peers under STORY)
 *
 * @param request - The import request parameters
 * @returns Import result with counts (per type) and warnings
 */
export async function importJiraRoadmap(
  request: JiraImportRequest,
): Promise<JiraImportResult> {
  const { projectId, jql, jiraProjectKey, maxResults = 200 } = request;

  logger.info('Starting Jira roadmap import', {
    projectId,
    jql,
    jiraProjectKey,
    maxResults,
  });

  const result: JiraImportResult = {
    createdInitiatives: 0,
    updatedInitiatives: 0,
    createdEpics: 0,
    updatedEpics: 0,
    createdFeatures: 0,
    updatedFeatures: 0,
    createdStories: 0,
    updatedStories: 0,
    createdTasks: 0,
    updatedTasks: 0,
    createdBugs: 0,
    updatedBugs: 0,
    createdTests: 0,
    updatedTests: 0,
    warnings: [],
  };

  // Step 1: Fetch Jira issues
  logger.info('Phase: Fetching Jira issues', { projectId });
  const jiraItems = await fetchJiraIssues(projectId, jql, jiraProjectKey, maxResults);

  logger.info('Fetched Jira issues', {
    projectId,
    totalItems: jiraItems.length,
  });

  // Step 2: Partition all 7 types
  logger.info('Phase: Partitioning items by type', { projectId });
  const {
    initiatives,
    epics,
    features,
    stories,
    tasks,
    bugs,
    tests,
    warnings: filterWarnings,
  } = filterByType(jiraItems);
  result.warnings.push(...filterWarnings);

  logger.info('Partitioned items', {
    projectId,
    initiatives: initiatives.length,
    epics: epics.length,
    features: features.length,
    stories: stories.length,
    tasks: tasks.length,
    bugs: bugs.length,
    tests: tests.length,
    warnings: filterWarnings.length,
  });

  // Step 3: Detect orphan epics
  logger.info('Phase: Detecting orphan EPICs', { projectId });
  const orphanEpics = resolveOrphanEpics(epics, initiatives);
  const needsSyntheticInitiative = orphanEpics.length > 0;

  if (needsSyntheticInitiative) {
    logger.info('Orphan EPICs detected; synthetic initiative will be created', {
      projectId,
      orphanCount: orphanEpics.length,
    });
  }

  // Build synthetic initiative if needed
  const syntheticInitiative = needsSyntheticInitiative
    ? buildSyntheticInitiative(projectId)
    : null;

  // Step 4 (Phase 0): List existing work items and build lookup map
  logger.info('Phase 0: Listing existing work items', { projectId });
  const existingItems = await listExistingWorkItems(projectId);
  const lookupMap = buildLookupMap(existingItems);

  // Also build an ID-based lookup for the synthetic initiative
  const existingById = new Map<string, WorkItemDto>();
  for (const item of existingItems) {
    existingById.set(item.id, item);
  }

  logger.info('Built lookup map', {
    projectId,
    existingCount: existingItems.length,
    lookupMapSize: lookupMap.size,
  });

  // Get the jiraBrowseBaseUrl from config for constructing external URLs
  const config = getConfig();
  const jiraBrowseBaseUrl: string = config.jiraBrowseBaseUrl;

  // Step 5 (Phase 1): Upsert INITIATIVEs
  logger.info('Phase 1: Upserting INITIATIVEs', {
    projectId,
    count: initiatives.length,
  });

  for (const initiative of initiatives) {
    // Enrich with external_url
    if (initiative.external_key) {
      initiative.external_url = constructExternalUrl(jiraBrowseBaseUrl, initiative.external_key);
    }

    const lookupKey = `${initiative.external_system}:${initiative.external_key}`;
    const existing = lookupMap.get(lookupKey);

    if (existing) {
      // Update existing initiative
      await updateWorkItem(projectId, existing.id, initiative);
      result.updatedInitiatives++;

      logger.debug('Updated INITIATIVE', {
        projectId,
        id: existing.id,
        externalKey: initiative.external_key,
      });
    } else {
      // Create new initiative
      await createWorkItem(projectId, initiative);
      result.createdInitiatives++;

      logger.debug('Created INITIATIVE', {
        projectId,
        id: initiative.id,
        externalKey: initiative.external_key,
      });
    }
  }

  // Upsert synthetic initiative if needed
  if (syntheticInitiative) {
    const existingSynthetic = existingById.get(syntheticInitiative.id);

    if (existingSynthetic) {
      // Synthetic initiative already exists, reuse it
      logger.debug('Synthetic initiative already exists, reusing', {
        projectId,
        id: syntheticInitiative.id,
      });
      // Still count as updated since we're acknowledging its existence
      await updateWorkItem(projectId, syntheticInitiative.id, syntheticInitiative);
      result.updatedInitiatives++;
    } else {
      // Create new synthetic initiative
      await createWorkItem(projectId, syntheticInitiative);
      result.createdInitiatives++;

      logger.debug('Created synthetic initiative', {
        projectId,
        id: syntheticInitiative.id,
      });
    }
  }

  // Step 6 (Phase 2): Upsert EPICs
  logger.info('Phase 2: Upserting EPICs', {
    projectId,
    count: epics.length,
  });

  // Build a set of orphan epic IDs for quick lookup
  const orphanEpicIds = new Set(orphanEpics.map((e) => e.id));

  for (const epic of epics) {
    // Enrich with external_url
    if (epic.external_key) {
      epic.external_url = constructExternalUrl(jiraBrowseBaseUrl, epic.external_key);
    }

    // Resolve parent_id: if orphan, use synthetic initiative's ID
    if (orphanEpicIds.has(epic.id) && syntheticInitiative) {
      epic.parent_id = syntheticInitiative.id;
    }

    const lookupKey = `${epic.external_system}:${epic.external_key}`;
    const existing = lookupMap.get(lookupKey);

    if (existing) {
      // Update existing epic
      await updateWorkItem(projectId, existing.id, epic);
      result.updatedEpics++;

      logger.debug('Updated EPIC', {
        projectId,
        id: existing.id,
        externalKey: epic.external_key,
      });
    } else {
      // Create new epic
      await createWorkItem(projectId, epic);
      result.createdEpics++;

      logger.debug('Created EPIC', {
        projectId,
        id: epic.id,
        externalKey: epic.external_key,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Phases 3-5: FEATURE / STORY / (TASK, BUG, TEST)
  //
  // For these levels we keep the same idempotent upsert pattern but skip the
  // synthetic-parent dance. If a child's parent isn't in the import set, the
  // jira-service mapper has already nulled its parent_id; we just upsert as-is
  // and emit a warning so the caller knows about the orphan.
  // -------------------------------------------------------------------------
  await upsertChildPhase('FEATURE', features, projectId, lookupMap, jiraBrowseBaseUrl,
    (n) => { result.createdFeatures += n; }, (n) => { result.updatedFeatures += n; }, result.warnings);
  await upsertChildPhase('STORY', stories, projectId, lookupMap, jiraBrowseBaseUrl,
    (n) => { result.createdStories += n; }, (n) => { result.updatedStories += n; }, result.warnings);
  await upsertChildPhase('TASK', tasks, projectId, lookupMap, jiraBrowseBaseUrl,
    (n) => { result.createdTasks += n; }, (n) => { result.updatedTasks += n; }, result.warnings);
  await upsertChildPhase('BUG', bugs, projectId, lookupMap, jiraBrowseBaseUrl,
    (n) => { result.createdBugs += n; }, (n) => { result.updatedBugs += n; }, result.warnings);
  await upsertChildPhase('TEST', tests, projectId, lookupMap, jiraBrowseBaseUrl,
    (n) => { result.createdTests += n; }, (n) => { result.updatedTests += n; }, result.warnings);

  logger.info('Jira import completed', {
    projectId,
    createdInitiatives: result.createdInitiatives,
    updatedInitiatives: result.updatedInitiatives,
    createdEpics: result.createdEpics,
    updatedEpics: result.updatedEpics,
    createdFeatures: result.createdFeatures,
    updatedFeatures: result.updatedFeatures,
    createdStories: result.createdStories,
    updatedStories: result.updatedStories,
    createdTasks: result.createdTasks,
    updatedTasks: result.updatedTasks,
    createdBugs: result.createdBugs,
    updatedBugs: result.updatedBugs,
    createdTests: result.createdTests,
    updatedTests: result.updatedTests,
    warningCount: result.warnings.length,
  });

  return result;
}

/**
 * Sorts items so that any item whose parent is also in the list comes after
 * its parent. Items whose parent is null or in an earlier phase are emitted
 * first. Cycles (shouldn't occur but be defensive) emit remaining items in
 * arbitrary order rather than looping forever.
 *
 * Needed because (e.g.) Jira Subtasks of Tasks both map to TASK and land in the
 * same import phase; without this sort a child can be upserted before its
 * parent exists, and architecture-model-service rejects the dangling reference.
 */
function topologicallySortByParent(items: WorkItemDto[]): WorkItemDto[] {
  const inPhaseIds = new Set(items.map((i) => i.id));
  const processed = new Set<string>();
  const sorted: WorkItemDto[] = [];
  const remaining = [...items];

  while (remaining.length > 0) {
    const before = remaining.length;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const item = remaining[i];
      const ready =
        item.parent_id === null ||
        !inPhaseIds.has(item.parent_id) ||
        processed.has(item.parent_id);
      if (ready) {
        sorted.push(item);
        processed.add(item.id);
        remaining.splice(i, 1);
      }
    }
    if (remaining.length === before) {
      // Cycle (or all remaining items reference each other). Emit as-is.
      sorted.push(...remaining);
      break;
    }
  }
  return sorted;
}

/**
 * Generic upsert phase for FEATURE/STORY/TASK/BUG/TEST levels.
 * Looks each item up by external_key in the existing lookup map; creates or
 * updates accordingly. Items with parent_id=null produce a warning (the parent
 * wasn't in the fetched Jira set) but are still upserted at top level.
 */
async function upsertChildPhase(
  typeName: string,
  items: WorkItemDto[],
  projectId: string,
  lookupMap: Map<string, WorkItemDto>,
  jiraBrowseBaseUrl: string,
  recordCreated: (n: number) => void,
  recordUpdated: (n: number) => void,
  warnings: string[],
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  // Sort so parents come before children when both are in this phase
  // (e.g. Jira Subtask of Task both map to TASK).
  const sortedItems = topologicallySortByParent(items);

  logger.info(`Phase: Upserting ${typeName}s`, { projectId, count: sortedItems.length });

  for (const item of sortedItems) {
    if (item.external_key) {
      item.external_url = constructExternalUrl(jiraBrowseBaseUrl, item.external_key);
    }

    if (item.parent_id === null) {
      warnings.push(
        `${typeName} ${item.external_key} has no parent in the import set; imported with parent_id=null`,
      );
    }

    const lookupKey = `${item.external_system}:${item.external_key}`;
    const existing = lookupMap.get(lookupKey);

    if (existing) {
      await updateWorkItem(projectId, existing.id, item);
      recordUpdated(1);
      logger.debug(`Updated ${typeName}`, {
        projectId,
        id: existing.id,
        externalKey: item.external_key,
      });
    } else {
      await createWorkItem(projectId, item);
      recordCreated(1);
      logger.debug(`Created ${typeName}`, {
        projectId,
        id: item.id,
        externalKey: item.external_key,
      });
    }
  }
}

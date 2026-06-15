/**
 * Jira Sync Analysis + Execute Service
 *
 * Phase B (analyzeSyncScope) compares a tool work item subtree against the
 * corresponding Jira subtree and proposes actions. Phase C (executeSyncActions)
 * applies the user-confirmed subset of those actions: CREATE_IN_TOOL first,
 * then CREATE_IN_JIRA, then UPDATE_JIRA / UPDATE_TOOL. Best-effort: per-action
 * results are returned, no rollback on failure.
 */

import axios from 'axios';
import { getConfig } from '../config';
import { constructExternalUrl, fetchJiraIssues, generateDeterministicId, type WorkItemDto } from './jiraImportService';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GoldenSource = 'TOOL' | 'JIRA';

export type SyncAction =
  | 'CREATE_IN_JIRA'
  | 'CREATE_IN_TOOL'
  | 'UPDATE_JIRA'
  | 'UPDATE_TOOL'
  | 'UPLOAD_SPEC_TO_JIRA'
  | 'NO_CHANGE';

/**
 * One spec file (per increment) to upload to Jira. Carried on
 * UPLOAD_SPEC_TO_JIRA actions so the UI can preview which files will land
 * and the executor knows which increments to fetch content for.
 */
export interface SpecToUpload {
  /** The increment ID inside the implement-workspace (e.g. "INC-1"). */
  incrementId: string;
  /** Increment title — drives both the filename and the comment text. */
  title: string;
  /** Final attachment filename (slugified title + ".md"). */
  filename: string;
}

/**
 * Per-sync mapping override (tool work-item type → Jira issue type name).
 * When provided on /analyze and /execute, takes precedence over the static yml
 * mapping in jira-service for both READ (Jira→tool translation, via inversion)
 * and WRITE (tool→Jira via the {@code jiraIssueType} query param on creates).
 */
export type TypeMapping = Record<string, string>;

export interface SyncAnalysisRequest {
  projectId: string;
  rootWorkItemId: string;
  goldenSource: GoldenSource;
  jiraProjectKey: string;
  /** Optional per-sync type-mapping override; falls back to static yml when absent. */
  typeMapping?: TypeMapping;
}

/**
 * Snapshot of the comparison-relevant fields for a single side (tool or Jira),
 * used to render diffs in the UI.
 */
export interface ItemSnapshot {
  title: string;
  description: string | null;
  priority: number | null;
  parentExternalKey: string | null;
  /** Tool-side status (PLANNED, IN_PROGRESS, DEV_COMPLETE, COMPLETED, CANCELLED). */
  status: string;
}

export interface SyncActionItem {
  action: SyncAction;
  /** Tool work item ID, null for Jira-only items not yet in tool */
  toolId: string | null;
  /** Jira issue key, null for tool-only items not yet in Jira */
  externalKey: string | null;
  /** Tool work item type (INITIATIVE, EPIC, FEATURE, STORY, TASK, BUG, TEST) */
  type: string;
  /** Title for UI display (taken from whichever side exists) */
  title: string;
  /** Parent's tool ID (null if root or Jira-only) */
  parentToolId: string | null;
  /** Parent's Jira key (null if root or tool-only-with-no-Jira-parent) */
  parentExternalKey: string | null;
  /** Field names that differ between sides — only populated for UPDATE_* actions */
  differences: string[];
  /** Tool's current values; null when the item is Jira-only */
  toolSnapshot: ItemSnapshot | null;
  /** Jira's current values; null when the item is tool-only */
  jiraSnapshot: ItemSnapshot | null;
  /**
   * Specs (per increment) to upload as Jira attachments — only populated for
   * UPLOAD_SPEC_TO_JIRA actions on stories. Already-attached filenames are
   * filtered out at analyze time so the list contains only pending uploads.
   */
  specsToUpload?: SpecToUpload[];
}

export interface SyncAnalysisResult {
  goldenSource: GoldenSource;
  jiraProjectKey: string;
  rootWorkItemId: string;
  actions: SyncActionItem[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap on Jira-side traversal depth to prevent runaway queries. */
const MAX_JIRA_DEPTH = 10;

/** Max items per Jira batch query. Mirrors jira-service ChildExpansionService. */
const JIRA_BATCH_SIZE = 50;

/** Comparison-relevant field set. */
const COMPARISON_FIELDS = ['title', 'description', 'priority', 'parent'] as const;

/**
 * The tool doesn't model priority as a first-class concern -- it just runs
 * through all work. So when the tool's priority is null, we normalise it to
 * Jira's typical default (Medium = 3) for both diff comparison AND push. This
 * means: a tool item with no priority and a Jira issue with the default priority
 * appear as "in sync"; if the Jira side drifts to e.g. High, we push Medium back.
 */
const PRIORITY_DEFAULT = 3;

// ---------------------------------------------------------------------------
// Helpers: spec-upload support (filename slugify, workspace fetch, attachments)
// ---------------------------------------------------------------------------

/**
 * Slugifies a string for use as a filename. Used to derive a unique-per-story
 * spec filename from the increment title. The slug also serves as the
 * idempotency key — uploading the same slug twice is a no-op.
 */
function slugifyForFilename(title: string): string {
  return (title ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'spec';
}

interface IncrementMeta {
  id: string;
  title: string;
  partIndex?: number;
}

interface SpecArtifactEntry {
  incrementId: string;
  title: string;
  content: string;
}

/**
 * Fetches the implement-workspace for a tool work item and extracts the list
 * of (increment, spec markdown) entries. Returns an empty array when the
 * workspace is empty / the work item has no shaped specs yet.
 */
async function fetchSpecArtifactsForWorkItem(
  projectId: string,
  workItemId: string,
): Promise<SpecArtifactEntry[]> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(workItemId)}/implement-workspace`;
  let data: any;
  try {
    const r = await axios.get(url, { timeout: 15000 });
    data = r.data;
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 404) return [];
    throw e;
  }

  const artifactsByIncrement: Record<string, any> | null =
    data?.execution_artifacts_by_increment ?? null;
  if (!artifactsByIncrement) return [];

  // Resolve increment titles from planner_payload.implementationPlan.increments[].
  // The planner payload is persisted as the raw camelCase object the frontend wrote.
  const increments: IncrementMeta[] =
    Array.isArray(data?.planner_payload?.implementationPlan?.increments)
      ? data.planner_payload.implementationPlan.increments
      : [];
  const titlesById = new Map<string, string>(
    increments.map((inc) => [inc.id, inc.title ?? inc.id]),
  );

  const result: SpecArtifactEntry[] = [];
  for (const [incrementId, raw] of Object.entries(artifactsByIncrement)) {
    if (!raw || typeof raw !== 'object') continue;
    const content: unknown = (raw as any).shapeSpecArtifact;
    if (typeof content !== 'string' || content.trim() === '') continue;
    result.push({
      incrementId,
      title: titlesById.get(incrementId) ?? incrementId,
      content,
    });
  }
  return result;
}

/**
 * Asks jira-service for the attachment filenames currently on a Jira issue.
 * Used at analyze time to filter out specs that are already attached.
 */
async function listJiraAttachmentFilenames(externalKey: string): Promise<string[]> {
  const baseUrl = getConfig().jiraServiceBaseUrl;
  const url = `${baseUrl}/jira/issues/${encodeURIComponent(externalKey)}/attachments`;
  const r = await axios.get<{ filenames: string[] }>(url, { timeout: 15000 });
  return Array.isArray(r.data?.filenames) ? r.data.filenames : [];
}

/**
 * Posts a single spec attachment + comment via jira-service. Multipart
 * is handled by jira-service; we send a JSON body here.
 */
async function jiraServiceUploadSpec(args: {
  externalKey: string;
  filename: string;
  content: string;
  commentText: string;
}): Promise<void> {
  const baseUrl = getConfig().jiraServiceBaseUrl;
  const url = `${baseUrl}/jira/issues/${encodeURIComponent(args.externalKey)}/specs`;
  // jira-service expects snake_case body keys due to its global Jackson SNAKE_CASE.
  const body = {
    filename: args.filename,
    content: args.content,
    comment_text: args.commentText,
  };
  await axios.post(url, body, {
    timeout: 60000,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Helpers: tool-side fetch and subtree walk
// ---------------------------------------------------------------------------

async function fetchAllToolWorkItems(projectId: string): Promise<WorkItemDto[]> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}/work-items`;

  const response = await axios.get<WorkItemDto[]>(url, { timeout: 15000 });
  return Array.isArray(response.data) ? response.data : [];
}

/**
 * Returns rootId + all its descendants, walking parent_id pointers.
 * Items not reachable from rootId are omitted.
 */
function collectToolSubtree(allItems: WorkItemDto[], rootId: string): WorkItemDto[] {
  const childrenByParent = new Map<string, WorkItemDto[]>();
  for (const item of allItems) {
    const key = item.parent_id ?? '';
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key)!.push(item);
  }

  const root = allItems.find((i) => i.id === rootId);
  if (!root) return [];

  const result: WorkItemDto[] = [root];
  const queue: WorkItemDto[] = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = childrenByParent.get(current.id) ?? [];
    for (const child of children) {
      result.push(child);
      queue.push(child);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers: Jira-side walk
// ---------------------------------------------------------------------------

/**
 * Extracts the project-key prefix from a Jira issue key (e.g. "KAN-5" → "KAN").
 * Returns null if the key doesn't follow the PREFIX-NUMBER convention.
 */
function extractJiraProjectKey(externalKey: string | null): string | null {
  if (!externalKey) return null;
  const dash = externalKey.indexOf('-');
  return dash > 0 ? externalKey.substring(0, dash) : null;
}

/**
 * Walks the Jira-side subtree starting at rootKey by issuing iterative
 * `key = X OR parent in (Y, Z, ...)` JQL queries level-by-level.
 *
 * Returns a flat list of WorkItemDtos (mapped through jira-service). Capped at
 * {@link MAX_JIRA_DEPTH} levels to prevent runaway queries.
 */
async function walkJiraSubtree(
  toolProjectId: string,
  rootKey: string,
  jiraProjectKey: string,
  jiraToToolOverride?: Record<string, string>,
): Promise<WorkItemDto[]> {
  const collected: WorkItemDto[] = [];
  const seenKeys = new Set<string>();

  // Level 0: just the root.
  const rootItems = await fetchJiraIssues(toolProjectId, `key = ${rootKey}`, jiraProjectKey, 5, jiraToToolOverride);
  for (const item of rootItems) {
    if (item.external_key && !seenKeys.has(item.external_key)) {
      collected.push(item);
      seenKeys.add(item.external_key);
    }
  }

  if (collected.length === 0) {
    // Root not found in Jira — nothing to walk.
    return collected;
  }

  // Levels 1..N: walk down by parent.
  let frontier = collected.map((i) => i.external_key!).filter(Boolean);
  let depth = 0;

  while (frontier.length > 0 && depth < MAX_JIRA_DEPTH) {
    const childItems: WorkItemDto[] = [];

    // Batch the frontier into groups of JIRA_BATCH_SIZE.
    // Include both `key in (frontier)` and `parent in (frontier)` so the parents
    // land in the same response — otherwise jira-service nulls the children's
    // parent_id (parent isn't in the same JQL fetch set) and our diff sees a
    // false-positive "parent" difference. seenKeys dedupes the parent re-fetch.
    for (let i = 0; i < frontier.length; i += JIRA_BATCH_SIZE) {
      const batch = frontier.slice(i, i + JIRA_BATCH_SIZE);
      const jql = `key in (${batch.join(', ')}) OR parent in (${batch.join(', ')})`;
      const items = await fetchJiraIssues(toolProjectId, jql, jiraProjectKey, JIRA_BATCH_SIZE * 2, jiraToToolOverride);
      childItems.push(...items);
    }

    if (childItems.length === 0) break;

    const nextFrontier: string[] = [];
    for (const child of childItems) {
      if (child.external_key && !seenKeys.has(child.external_key)) {
        collected.push(child);
        seenKeys.add(child.external_key);
        nextFrontier.push(child.external_key);
      }
    }

    frontier = nextFrontier;
    depth++;
  }

  return collected;
}

// ---------------------------------------------------------------------------
// Helpers: parent linkage rebuilding
// ---------------------------------------------------------------------------

/**
 * jira-service nulls parent_id when the parent isn't in the same JQL response.
 * Since we walk level-by-level, descendants' parents land in the previous batch,
 * so we rebuild the (deterministicUUID → externalKey) map across the full set
 * and use it to resolve parent linkage for diff comparison.
 */
function buildJiraParentKeyResolver(jiraItems: WorkItemDto[]): Map<string, string> {
  const idToKey = new Map<string, string>();
  for (const item of jiraItems) {
    if (item.id && item.external_key) {
      idToKey.set(item.id, item.external_key);
    }
  }
  return idToKey;
}

// ---------------------------------------------------------------------------
// Helpers: snapshot + diff
// ---------------------------------------------------------------------------

function snapshotTool(item: WorkItemDto, toolItemsById: Map<string, WorkItemDto>): ItemSnapshot {
  const parent = item.parent_id ? toolItemsById.get(item.parent_id) : null;
  return {
    title: item.title,
    description: item.description,
    // Normalise null tool priority to PRIORITY_DEFAULT so it compares cleanly
    // against Jira's default priority. See PRIORITY_DEFAULT comment for rationale.
    priority: item.priority === null ? PRIORITY_DEFAULT : Number(item.priority),
    parentExternalKey: parent?.external_key ?? null,
    status: item.status ?? 'PLANNED',
  };
}

function snapshotJira(
  item: WorkItemDto,
  jiraIdToKey: Map<string, string>,
): ItemSnapshot {
  return {
    title: item.title,
    description: item.description,
    // Same normalisation on the Jira side -- if Jira returns no priority (rare
    // because Jira usually defaults to Medium), treat as Medium for symmetry.
    priority: item.priority === null ? PRIORITY_DEFAULT : Number(item.priority),
    parentExternalKey: item.parent_id ? jiraIdToKey.get(item.parent_id) ?? null : null,
    // jira-service has already normalised the Jira workflow status into the
    // tool's vocabulary (PLANNED / IN_PROGRESS / DEV_COMPLETE / COMPLETED /
    // CANCELLED) via JiraIssueMappingService.normalizeStatus.
    status: item.status ?? 'PLANNED',
  };
}

/**
 * Compares two snapshots and returns the list of differing field names.
 * Whitespace-insensitive for description; numeric coercion for priority.
 */
function diffSnapshots(
  tool: ItemSnapshot,
  jira: ItemSnapshot,
  options: { skipParent: boolean },
): string[] {
  const diffs: string[] = [];

  if (tool.title !== jira.title) diffs.push('title');

  const toolDesc = (tool.description ?? '').trim();
  const jiraDesc = (jira.description ?? '').trim();
  if (toolDesc !== jiraDesc) diffs.push('description');

  if (tool.priority !== jira.priority) diffs.push('priority');

  // Status diff (E1) — both sides have the tool's normalised vocabulary.
  // jira-service translates Jira's workflow status names via normalizeStatus.
  if (tool.status !== jira.status) diffs.push('status');

  // Parent diff with extra rule: if the tool side's parent has no Jira-linked
  // counterpart in this project (toolSnapshot.parentExternalKey is null), we
  // can't meaningfully push the parent relationship — pushing null would clear
  // Jira's parent, which the user usually doesn't want when their tool parent
  // simply hasn't been linked yet. So we skip the diff entirely; re-analyzing
  // after linking the tool parent will surface it.
  if (
    !options.skipParent &&
    tool.parentExternalKey !== jira.parentExternalKey &&
    tool.parentExternalKey !== null
  ) {
    diffs.push('parent');
  }

  return diffs;
}

// ---------------------------------------------------------------------------
// Main: analyzeSyncScope
// ---------------------------------------------------------------------------

export async function analyzeSyncScope(
  request: SyncAnalysisRequest,
): Promise<SyncAnalysisResult> {
  const { projectId, rootWorkItemId, goldenSource, jiraProjectKey, typeMapping } = request;

  if (!projectId || !rootWorkItemId || !goldenSource || !jiraProjectKey) {
    throw new Error(
      'projectId, rootWorkItemId, goldenSource, and jiraProjectKey are all required',
    );
  }
  if (goldenSource !== 'TOOL' && goldenSource !== 'JIRA') {
    throw new Error(`goldenSource must be 'TOOL' or 'JIRA' (got '${goldenSource}')`);
  }

  // Build the inverse (Jira-issue-type → tool-type) for jira-service to use
  // when translating types in the GET /jira/issues response.
  const jiraToToolOverride = invertTypeMapping(typeMapping);

  logger.info('Starting Jira sync analysis', {
    projectId,
    rootWorkItemId,
    goldenSource,
    jiraProjectKey,
    hasTypeMappingOverride: !!typeMapping,
  });

  const warnings: string[] = [];

  // ----- 1. Tool side -----
  const allToolItems = await fetchAllToolWorkItems(projectId);
  const toolItemsById = new Map(allToolItems.map((i) => [i.id, i]));

  const root = toolItemsById.get(rootWorkItemId);
  if (!root) {
    throw new Error(`rootWorkItemId ${rootWorkItemId} not found in project ${projectId}`);
  }

  const toolSubtree = collectToolSubtree(allToolItems, rootWorkItemId);
  logger.info('Collected tool subtree', { rootWorkItemId, count: toolSubtree.length });

  // Partition tool subtree into in-project / cross-project / unlinked
  const inProjectTool: WorkItemDto[] = [];
  const unlinkedTool: WorkItemDto[] = [];
  for (const item of toolSubtree) {
    if (!item.external_key) {
      unlinkedTool.push(item);
      continue;
    }
    const key = extractJiraProjectKey(item.external_key);
    if (key === jiraProjectKey) {
      inProjectTool.push(item);
    } else {
      warnings.push(
        `Tool item "${item.title}" (${item.id}) has external_key ${item.external_key} for project ${key}, not ${jiraProjectKey}; excluded from sync`,
      );
    }
  }

  // ----- 2. Jira side -----
  let jiraItems: WorkItemDto[] = [];
  if (root.external_key && extractJiraProjectKey(root.external_key) === jiraProjectKey) {
    jiraItems = await walkJiraSubtree(projectId, root.external_key, jiraProjectKey, jiraToToolOverride);
    logger.info('Collected Jira subtree', {
      rootKey: root.external_key,
      count: jiraItems.length,
    });
  } else {
    logger.info('Tool root has no in-project Jira link; Jira-side will be empty', {
      rootWorkItemId,
      rootExternalKey: root.external_key ?? null,
    });
  }

  const jiraByKey = new Map(jiraItems.map((i) => [i.external_key!, i]));
  const jiraIdToKey = buildJiraParentKeyResolver(jiraItems);

  // ----- 3. Build actions -----
  const actions: SyncActionItem[] = [];

  // 3a. Tool items with no usable Jira link → CREATE_IN_JIRA
  for (const item of unlinkedTool) {
    const parent = item.parent_id ? toolItemsById.get(item.parent_id) : null;
    actions.push({
      action: 'CREATE_IN_JIRA',
      toolId: item.id,
      externalKey: null,
      type: item.type,
      title: item.title,
      parentToolId: item.parent_id,
      parentExternalKey: parent?.external_key ?? null,
      differences: [],
      toolSnapshot: snapshotTool(item, toolItemsById),
      jiraSnapshot: null,
    });
  }

  // 3b. Tool items with in-project Jira link → check Jira side
  for (const item of inProjectTool) {
    const jiraItem = jiraByKey.get(item.external_key!);
    if (!jiraItem) {
      // Tool says we're linked but Jira doesn't have it. Treat as create-anew.
      warnings.push(
        `Tool item "${item.title}" has external_key ${item.external_key} but no matching Jira issue; will be created anew (old key discarded)`,
      );
      const parent = item.parent_id ? toolItemsById.get(item.parent_id) : null;
      actions.push({
        action: 'CREATE_IN_JIRA',
        toolId: item.id,
        externalKey: null,
        type: item.type,
        title: item.title,
        parentToolId: item.parent_id,
        parentExternalKey: parent?.external_key ?? null,
        differences: [],
        toolSnapshot: snapshotTool(item, toolItemsById),
        jiraSnapshot: null,
      });
      continue;
    }

    const toolSnap = snapshotTool(item, toolItemsById);
    const jiraSnap = snapshotJira(jiraItem, jiraIdToKey);
    // Skip parent diff for the root item — its parent is outside the subtree
    // and we don't reliably have Jira's parent for it (see service header notes).
    const isRoot = item.id === rootWorkItemId;
    const differences = diffSnapshots(toolSnap, jiraSnap, { skipParent: isRoot });

    let action: SyncAction;
    if (differences.length === 0) {
      action = 'NO_CHANGE';
    } else {
      action = goldenSource === 'TOOL' ? 'UPDATE_JIRA' : 'UPDATE_TOOL';
    }

    actions.push({
      action,
      toolId: item.id,
      externalKey: item.external_key,
      type: item.type,
      title: item.title,
      parentToolId: item.parent_id,
      parentExternalKey: jiraSnap.parentExternalKey,
      differences,
      toolSnapshot: toolSnap,
      jiraSnapshot: jiraSnap,
    });
  }

  // 3c. Jira items not in tool → CREATE_IN_TOOL
  const toolKeysInProject = new Set(inProjectTool.map((i) => i.external_key));
  const knownToolTypes = new Set([
    'INITIATIVE', 'EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG', 'TEST',
  ]);

  for (const item of jiraItems) {
    if (!item.external_key || toolKeysInProject.has(item.external_key)) continue;

    if (!knownToolTypes.has(item.type)) {
      warnings.push(
        `Jira issue ${item.external_key} has unmapped type "${item.type}"; skipped`,
      );
      continue;
    }

    const parentExternalKey = item.parent_id ? jiraIdToKey.get(item.parent_id) ?? null : null;
    actions.push({
      action: 'CREATE_IN_TOOL',
      toolId: null,
      externalKey: item.external_key,
      type: item.type,
      title: item.title,
      parentToolId: null,
      parentExternalKey,
      differences: [],
      toolSnapshot: null,
      jiraSnapshot: snapshotJira(item, jiraIdToKey),
    });
  }

  // ----- 3d. Spec uploads (STORY-only) -----
  // For each story in the tool subtree that has at least one shaped spec, emit
  // an UPLOAD_SPEC_TO_JIRA action listing the per-increment files that aren't
  // already attached on the Jira side. Stories that are about to be created in
  // Jira (no external_key yet) get an action too — Pass 4 will resolve the
  // freshly-issued key from Pass 2's tracker.
  const specUploadActions = await buildSpecUploadActions({
    projectId,
    jiraProjectKey,
    toolItemsById,
    toolSubtree,
  });
  actions.push(...specUploadActions);

  // D-ext 3: when an explicit typeMapping is provided, treat it as authoritative.
  // Tool types missing from the mapping are deliberately excluded by the user
  // (the frontend marks them as "depth-mismatch" / unmappable and the user
  // proceeded). Drop those actions and surface a single summary warning.
  let finalActions = actions;
  if (typeMapping && Object.keys(typeMapping).length > 0) {
    const allowedToolTypes = new Set(Object.keys(typeMapping));
    const excluded = actions.filter((a) => !allowedToolTypes.has(a.type));
    if (excluded.length > 0) {
      const excludedTypeCounts = excluded.reduce((acc, a) => {
        acc[a.type] = (acc[a.type] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      warnings.push(
        `Excluded ${excluded.length} item(s) whose tool type isn't in the supplied typeMapping: ` +
          Object.entries(excludedTypeCounts).map(([t, n]) => `${t}=${n}`).join(', '),
      );
      finalActions = actions.filter((a) => allowedToolTypes.has(a.type));
    }
  }

  logger.info('Jira sync analysis complete', {
    rootWorkItemId,
    actionCount: finalActions.length,
    warningCount: warnings.length,
    breakdown: {
      CREATE_IN_JIRA: finalActions.filter((a) => a.action === 'CREATE_IN_JIRA').length,
      CREATE_IN_TOOL: finalActions.filter((a) => a.action === 'CREATE_IN_TOOL').length,
      UPDATE_JIRA: finalActions.filter((a) => a.action === 'UPDATE_JIRA').length,
      UPDATE_TOOL: finalActions.filter((a) => a.action === 'UPDATE_TOOL').length,
      UPLOAD_SPEC_TO_JIRA: finalActions.filter((a) => a.action === 'UPLOAD_SPEC_TO_JIRA').length,
      NO_CHANGE: finalActions.filter((a) => a.action === 'NO_CHANGE').length,
    },
  });

  return {
    goldenSource,
    jiraProjectKey,
    rootWorkItemId,
    actions: finalActions,
    warnings,
  };
}

/**
 * Builds UPLOAD_SPEC_TO_JIRA actions for any STORY in the tool subtree that
 * has at least one shaped spec to push. Stories with an existing in-project
 * Jira link are filtered against the issue's current attachments (filename =
 * idempotency key) so already-attached specs are excluded; if none remain,
 * no action is emitted for that story. Stories without a Jira link get an
 * action covering all their specs — Pass 4 of execute resolves the
 * freshly-issued Jira key from the CREATE_IN_JIRA pass.
 */
async function buildSpecUploadActions(args: {
  projectId: string;
  jiraProjectKey: string;
  toolItemsById: Map<string, WorkItemDto>;
  toolSubtree: WorkItemDto[];
}): Promise<SyncActionItem[]> {
  const { projectId, jiraProjectKey, toolItemsById, toolSubtree } = args;
  const actions: SyncActionItem[] = [];

  const stories = toolSubtree.filter((i) => (i.type ?? '').toUpperCase() === 'STORY');
  if (stories.length === 0) return actions;

  // Resolve specs per story (parallel for speed). Then resolve attachment
  // filenames in parallel for any story with an in-project Jira link.
  const perStory = await Promise.all(
    stories.map(async (story) => {
      const specs = await fetchSpecArtifactsForWorkItem(projectId, story.id);
      return { story, specs };
    }),
  );

  await Promise.all(
    perStory.map(async ({ story, specs }) => {
      if (specs.length === 0) return;

      // Determine candidate filenames first.
      const candidates: SpecToUpload[] = specs.map((s) => ({
        incrementId: s.incrementId,
        title: s.title,
        filename: `${slugifyForFilename(s.title)}.md`,
      }));

      let pending: SpecToUpload[] = candidates;

      const inProjectKey =
        story.external_key && extractJiraProjectKey(story.external_key) === jiraProjectKey
          ? story.external_key
          : null;

      if (inProjectKey) {
        try {
          const existing = await listJiraAttachmentFilenames(inProjectKey);
          const existingSet = new Set(existing.map((f) => f.toLowerCase()));
          pending = candidates.filter((c) => !existingSet.has(c.filename.toLowerCase()));
        } catch (e) {
          logger.warn('Could not list existing attachments — emitting all specs as pending', {
            externalKey: inProjectKey,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (pending.length === 0) return;

      const parent = story.parent_id ? toolItemsById.get(story.parent_id) : null;
      actions.push({
        action: 'UPLOAD_SPEC_TO_JIRA',
        toolId: story.id,
        externalKey: inProjectKey,
        type: story.type,
        title: story.title,
        parentToolId: story.parent_id,
        parentExternalKey: parent?.external_key ?? null,
        differences: [],
        toolSnapshot: null,
        jiraSnapshot: null,
        specsToUpload: pending,
      });
    }),
  );

  return actions;
}

// Internal exports for testing / future Phase C use
export {
  collectToolSubtree,
  walkJiraSubtree,
  diffSnapshots,
  extractJiraProjectKey,
  slugifyForFilename,
  COMPARISON_FIELDS,
};

// ===========================================================================
// Phase C: executeSyncActions
// ===========================================================================

export type SyncResultStatus = 'SUCCESS' | 'FAILED' | 'PARTIAL_FAILURE' | 'SKIPPED';

export interface SyncExecuteRequest {
  projectId: string;
  rootWorkItemId?: string;          // optional, for logging
  goldenSource: GoldenSource;
  jiraProjectKey: string;
  actions: SyncActionItem[];        // filtered subset from analysis (only checked rows)
  /** Optional per-sync type-mapping override; same semantics as on /analyze. */
  typeMapping?: TypeMapping;
}

export interface SyncExecuteResultItem extends SyncActionItem {
  /** Outcome of attempting this action. */
  status: SyncResultStatus;
  /** Error message when status != SUCCESS. */
  error?: string;
  /** Newly-issued Jira key for successful CREATE_IN_JIRA actions. */
  newExternalKey?: string;
  /** Newly-issued tool ID for successful CREATE_IN_TOOL actions. */
  newToolId?: string;
}

export interface SyncExecuteResult {
  results: SyncExecuteResultItem[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    partialFailures: number;
    skipped: number;
    byAction: Record<SyncAction, number>;
  };
}

/**
 * Tool type hierarchy ordering — used to ensure parents are processed before
 * children when running CREATE passes.
 */
const TYPE_HIERARCHY: Record<string, number> = {
  INITIATIVE: 0, EPIC: 1, FEATURE: 2, STORY: 3, TASK: 4, BUG: 4, TEST: 4,
};

/**
 * Sort actions by tool type hierarchy first, then topologically by parent within
 * the batch (so a TASK whose parent is another TASK in this batch lands after
 * its parent).
 */
function sortActionsForCreate(
  actions: SyncActionItem[],
  parentKeyOf: (a: SyncActionItem) => string | null,
  selfKeyOf: (a: SyncActionItem) => string | null,
): SyncActionItem[] {
  // Stable sort by type hierarchy
  const byHierarchy = [...actions].sort((a, b) => {
    const ai = TYPE_HIERARCHY[a.type] ?? 99;
    const bi = TYPE_HIERARCHY[b.type] ?? 99;
    return ai - bi;
  });

  // Topological pass: items whose parent isn't in the batch (or is already
  // processed) come first; iterate until empty.
  const inBatchKeys = new Set(byHierarchy.map(selfKeyOf).filter((k): k is string => k !== null));
  const processed = new Set<string>();
  const result: SyncActionItem[] = [];
  const remaining = [...byHierarchy];

  while (remaining.length > 0) {
    const before = remaining.length;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const item = remaining[i];
      const parentKey = parentKeyOf(item);
      const ready = parentKey === null || !inBatchKeys.has(parentKey) || processed.has(parentKey);
      if (ready) {
        result.push(item);
        const selfKey = selfKeyOf(item);
        if (selfKey !== null) processed.add(selfKey);
        remaining.splice(i, 1);
      }
    }
    if (remaining.length === before) {
      // Cycle (shouldn't happen) — emit remaining as-is
      result.push(...remaining);
      break;
    }
  }

  return result;
}

// ---- HTTP helpers ---------------------------------------------------------

async function getToolWorkItem(projectId: string, itemId: string): Promise<WorkItemDto | null> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(itemId)}`;
  try {
    const r = await axios.get<WorkItemDto>(url, { timeout: 10000 });
    return r.data;
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 404) return null;
    throw e;
  }
}

async function listToolWorkItems(projectId: string): Promise<WorkItemDto[]> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}/work-items`;
  const r = await axios.get<WorkItemDto[]>(url, { timeout: 15000 });
  return Array.isArray(r.data) ? r.data : [];
}

async function createToolWorkItem(projectId: string, item: WorkItemDto): Promise<WorkItemDto> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}/work-items`;
  const r = await axios.post<WorkItemDto>(url, item, {
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' },
  });
  return r.data;
}

async function updateToolWorkItem(projectId: string, itemId: string, item: Partial<WorkItemDto>): Promise<WorkItemDto> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(itemId)}`;
  const r = await axios.put<WorkItemDto>(url, item, {
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' },
  });
  return r.data;
}

async function jiraServiceCreate(args: {
  jiraProjectKey: string;
  toolProjectId: string;
  type: string;
  title: string;
  description: string | null;
  priority: number | null;
  parentExternalKey: string | null;
  /** When provided, jira-service uses this Jira issue type rather than the default-jira-type yml lookup. */
  jiraIssueTypeOverride?: string | null;
}): Promise<{ externalKey: string; externalUrl: string }> {
  const baseUrl = getConfig().jiraServiceBaseUrl;
  const url = `${baseUrl}/jira/issues`;
  const params: Record<string, string> = { jiraProjectKey: args.jiraProjectKey };
  if (args.parentExternalKey) params.parentExternalKey = args.parentExternalKey;
  if (args.jiraIssueTypeOverride) params.jiraIssueType = args.jiraIssueTypeOverride;

  // jira-service expects WorkItemDto-shaped body (snake_case). Only the writable
  // subset is consulted (type, title, description, priority).
  const body = {
    project_id: args.toolProjectId,
    type: args.type,
    title: args.title,
    description: args.description,
    priority: args.priority,
  };
  // Response keys are snake_case because jira-service uses Jackson SNAKE_CASE
  // globally. Translate to camelCase for our internal contract.
  const r = await axios.post<{ external_key: string; external_url: string }>(url, body, {
    params,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });
  return { externalKey: r.data.external_key, externalUrl: r.data.external_url };
}

/**
 * Calls jira-service's transitions endpoint to push a tool status into Jira.
 * Returns the outcome so callers can aggregate it with the field-update result.
 */
type TransitionOutcome =
  | { kind: 'TRANSITIONED'; toStatusName: string }
  | { kind: 'ALREADY_AT_TARGET'; currentStatusName: string }
  | { kind: 'NO_MATCH'; toolStatus: string; candidates: string[]; availableTargets: string[] };

async function jiraServiceTransition(externalKey: string, toolStatus: string): Promise<TransitionOutcome> {
  const baseUrl = getConfig().jiraServiceBaseUrl;
  const url = `${baseUrl}/jira/issues/${encodeURIComponent(externalKey)}/transitions`;
  try {
    const r = await axios.post<{ status: string; toStatusName?: string; currentStatusName?: string }>(
      url,
      null,
      { params: { targetStatus: toolStatus }, timeout: 30000 },
    );
    if (r.data.status === 'TRANSITIONED') {
      return { kind: 'TRANSITIONED', toStatusName: r.data.toStatusName ?? toolStatus };
    }
    return { kind: 'ALREADY_AT_TARGET', currentStatusName: r.data.currentStatusName ?? toolStatus };
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 422 && (e.response.data as any)?.code === 'NO_MATCHING_TRANSITION') {
      const data = e.response.data as { toolStatus: string; candidates: string[]; availableTargets: string[] };
      return { kind: 'NO_MATCH', toolStatus: data.toolStatus, candidates: data.candidates, availableTargets: data.availableTargets };
    }
    throw e;
  }
}

async function jiraServiceUpdate(args: {
  externalKey: string;
  toolProjectId: string;
  parentExternalKey: string | null;
  title: string | null;
  description: string | null;
  priority: number | null;
  clearFields: string[];
}): Promise<void> {
  const baseUrl = getConfig().jiraServiceBaseUrl;
  const url = `${baseUrl}/jira/issues/${encodeURIComponent(args.externalKey)}`;
  const params: Record<string, string> = {};
  if (args.parentExternalKey) params.parentExternalKey = args.parentExternalKey;
  if (args.clearFields.length > 0) {
    // Spring binds a comma-separated query value into a Set<String>
    params.clearFields = args.clearFields.join(',');
  }

  // PATCH semantics: only non-null SET fields are sent here. Clearing is
  // expressed via the clearFields query param above.
  const body: Record<string, unknown> = {
    project_id: args.toolProjectId,
    external_key: args.externalKey,
  };
  if (args.title !== null) body.title = args.title;
  if (args.description !== null) body.description = args.description;
  if (args.priority !== null) body.priority = args.priority;

  await axios.put(url, body, {
    params,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---- Main: executeSyncActions --------------------------------------------

export async function executeSyncActions(req: SyncExecuteRequest): Promise<SyncExecuteResult> {
  const { projectId, jiraProjectKey, actions, typeMapping } = req;
  const config = getConfig();
  const jiraBrowseBaseUrl: string = config.jiraBrowseBaseUrl;

  if (!projectId || !jiraProjectKey || !actions) {
    throw new Error('projectId, jiraProjectKey, and actions are required');
  }

  logger.info('Executing Jira sync actions', {
    projectId,
    jiraProjectKey,
    actionCount: actions.length,
    rootWorkItemId: req.rootWorkItemId,
  });

  // Snapshot of current tool state (for parent resolution + UPDATE_TOOL base)
  const allToolItems = await listToolWorkItems(projectId);
  const toolItemsById = new Map(allToolItems.map((i) => [i.id, i]));
  const toolItemsByExternalKey = new Map(
    allToolItems.filter((i) => i.external_key).map((i) => [i.external_key!, i]),
  );

  /**
   * Tracks tool work items that EXIST after each pass, by external_key.
   * Used to resolve parent_id for newly-created items whose parent was created
   * earlier in this same execute call.
   */
  const toolItemsByKnownExternalKey = new Map<string, WorkItemDto>(toolItemsByExternalKey);
  /**
   * Tracks newly-issued Jira keys, by tool work item ID. Used by Pass 2 so a
   * child created later in Jira can reference its parent's freshly-issued key.
   */
  const newJiraKeysByToolId = new Map<string, string>();

  const results: SyncExecuteResultItem[] = [];

  // ---------- Pass 1: CREATE_IN_TOOL ----------
  const createInTool = sortActionsForCreate(
    actions.filter((a) => a.action === 'CREATE_IN_TOOL'),
    (a) => a.parentExternalKey,    // parent identity inside this pass = its Jira key
    (a) => a.externalKey,          // self identity = its Jira key
  );

  for (const action of createInTool) {
    try {
      if (!action.externalKey) {
        throw new Error('CREATE_IN_TOOL action missing externalKey');
      }

      // Resolve parent_id via known tool items
      let parentToolId: string | null = null;
      if (action.parentExternalKey) {
        const parent = toolItemsByKnownExternalKey.get(action.parentExternalKey);
        parentToolId = parent?.id ?? null;
      }

      const newToolId = generateDeterministicId(`${projectId}:${action.externalKey}`);
      const newItem: WorkItemDto = {
        id: newToolId,
        project_id: projectId,
        type: action.type,
        parent_id: parentToolId,
        title: action.title,
        description: action.jiraSnapshot?.description ?? null,
        status: 'PLANNED',
        sort_order: 0,
        priority: action.jiraSnapshot?.priority ?? null,
        target_window: null,
        tags: null,
        external_system: 'JIRA',
        external_key: action.externalKey,
        external_url: constructExternalUrl(jiraBrowseBaseUrl, action.externalKey),
        created_at: null,
        updated_at: null,
      };

      const created = await createToolWorkItem(projectId, newItem);
      toolItemsByKnownExternalKey.set(action.externalKey, created);
      results.push({ ...action, status: 'SUCCESS', newToolId: created.id });
    } catch (e: unknown) {
      results.push({ ...action, status: 'FAILED', error: errorMessage(e) });
    }
  }

  // ---------- Pass 2: CREATE_IN_JIRA ----------
  const createInJira = sortActionsForCreate(
    actions.filter((a) => a.action === 'CREATE_IN_JIRA'),
    (a) => a.parentToolId,         // parent identity = its tool ID
    (a) => a.toolId,               // self identity = its tool ID
  );

  for (const action of createInJira) {
    try {
      if (!action.toolId || !action.toolSnapshot) {
        throw new Error('CREATE_IN_JIRA action missing toolId or toolSnapshot');
      }

      // Resolve parent's Jira key
      let parentExternalKey: string | null = null;
      if (action.parentToolId) {
        // Was the parent created earlier in this same execute pass?
        const freshKey = newJiraKeysByToolId.get(action.parentToolId);
        if (freshKey) {
          parentExternalKey = freshKey;
        } else {
          // Otherwise look up the parent's existing external_key in tool data
          const parent = toolItemsById.get(action.parentToolId);
          if (parent?.external_key && extractJiraProjectKey(parent.external_key) === jiraProjectKey) {
            parentExternalKey = parent.external_key;
          }
        }
      }

      const created = await jiraServiceCreate({
        jiraProjectKey,
        toolProjectId: projectId,
        type: action.type,
        title: action.toolSnapshot.title,
        description: action.toolSnapshot.description,
        priority: action.toolSnapshot.priority,
        parentExternalKey,
        // Per-sync mapping override: tell jira-service exactly which Jira issue
        // type to create. Falls back to its default-jira-type yml when absent.
        jiraIssueTypeOverride: typeMapping?.[action.type] ?? null,
      });

      // Write the new key back to the tool item. architecture-model-service's PUT
      // validates required fields (title etc.), so overlay onto the existing item
      // rather than sending a partial. Per agreed Q2(a) policy, if this fails we
      // report PARTIAL_FAILURE so the user can re-sync to link the orphan.
      try {
        const existing = toolItemsById.get(action.toolId);
        if (!existing) {
          throw new Error(`tool work item ${action.toolId} not found for write-back`);
        }
        await updateToolWorkItem(projectId, action.toolId, {
          ...existing,
          external_system: 'JIRA',
          external_key: created.externalKey,
          external_url: created.externalUrl,
        });
        newJiraKeysByToolId.set(action.toolId, created.externalKey);
        results.push({ ...action, status: 'SUCCESS', newExternalKey: created.externalKey });
      } catch (writeBackError) {
        results.push({
          ...action,
          status: 'PARTIAL_FAILURE',
          newExternalKey: created.externalKey,
          error:
            `Created in Jira as ${created.externalKey} but write-back to tool failed: ` +
            errorMessage(writeBackError) +
            '. Re-run sync analysis to link the orphan Jira issue to the tool work item.',
        });
      }
    } catch (e: unknown) {
      // Distinguish "tool type configured to skip" (jira-service returns 422
      // with code TOOL_TYPE_SKIPPED) from real failures. Skipping is intentional
      // user configuration, not an error.
      if (axios.isAxiosError(e) && e.response?.status === 422 && (e.response.data as any)?.code === 'TOOL_TYPE_SKIPPED') {
        const data = e.response.data as { message?: string; toolType?: string };
        results.push({
          ...action,
          status: 'SKIPPED',
          error: data.message ?? `Tool type '${data.toolType ?? action.type}' is configured to skip in Jira project.`,
        });
      } else {
        results.push({ ...action, status: 'FAILED', error: errorMessage(e) });
      }
    }
  }

  // ---------- Pass 3: UPDATE_JIRA / UPDATE_TOOL ----------
  const updates = actions.filter((a) => a.action === 'UPDATE_JIRA' || a.action === 'UPDATE_TOOL');

  for (const action of updates) {
    try {
      if (action.action === 'UPDATE_JIRA') {
        if (!action.externalKey || !action.toolSnapshot) {
          throw new Error('UPDATE_JIRA action missing externalKey or toolSnapshot');
        }
        const diffs = new Set(action.differences);
        const ts = action.toolSnapshot;

        // Field updates (title/description/priority/parent) go through the PUT
        // endpoint. Status (E2) is separate — Jira requires the transitions API,
        // so we issue a second call to /transitions and aggregate the outcome.
        const clearFields: string[] = [];

        const titleNonEmpty = ts.title !== null && ts.title.trim() !== '';
        const descNonEmpty = ts.description !== null && ts.description.trim() !== '';
        const priorityNonNull = ts.priority !== null;
        const parentNonEmpty = ts.parentExternalKey !== null && ts.parentExternalKey.trim() !== '';
        const statusPresent = diffs.has('status') && !!ts.status;

        const writableTitle = diffs.has('title') && titleNonEmpty ? ts.title : null;
        const writableDescription = diffs.has('description') && descNonEmpty ? ts.description : null;
        const writablePriority = diffs.has('priority') && priorityNonNull ? ts.priority : null;
        const writableParent = diffs.has('parent') && parentNonEmpty ? ts.parentExternalKey : null;

        if (diffs.has('description') && !descNonEmpty) clearFields.push('description');
        if (diffs.has('parent') && !parentNonEmpty) clearFields.push('parent');
        // title/priority with null tool values: silently skip (Jira can't accept null for either)

        const willWriteFields =
          writableTitle !== null ||
          writableDescription !== null ||
          writablePriority !== null ||
          writableParent !== null ||
          clearFields.length > 0;

        if (!willWriteFields && !statusPresent) {
          const reasons: string[] = [];
          if (diffs.has('priority') && !priorityNonNull) {
            reasons.push("priority (Jira's priority scheme has no null value -- clear it manually in Jira if desired)");
          }
          if (diffs.has('title') && !titleNonEmpty) {
            reasons.push('title (Jira requires a non-empty summary)');
          }
          results.push({
            ...action,
            status: 'SKIPPED',
            error: reasons.length > 0
              ? `Skipped: ${reasons.join('; ')}.`
              : `Skipped: no actionable changes for diff(s) [${[...diffs].join(', ')}].`,
          });
          continue;
        }

        logger.info('Pushing UPDATE_JIRA', {
          externalKey: action.externalKey,
          diffs: [...diffs],
          writing: {
            title: writableTitle !== null,
            description: writableDescription !== null,
            priority: writablePriority !== null,
            parent: writableParent !== null,
            status: statusPresent,
          },
          clearFields,
        });

        // 1) Field updates via PUT (only if there's something to write)
        if (willWriteFields) {
          await jiraServiceUpdate({
            externalKey: action.externalKey,
            toolProjectId: projectId,
            title: writableTitle,
            description: writableDescription,
            priority: writablePriority,
            parentExternalKey: writableParent,
            clearFields,
          });
        }

        // 2) Status push via the transitions endpoint (only if status diffs)
        let transitionNote: string | null = null;
        if (statusPresent) {
          const outcome = await jiraServiceTransition(action.externalKey, ts.status);
          if (outcome.kind === 'NO_MATCH') {
            transitionNote =
              `Status couldn't transition to '${outcome.toolStatus}' — no available Jira ` +
              `transition leads to any of [${outcome.candidates.join(', ')}]. ` +
              `Available transitions: [${outcome.availableTargets.join(', ') || '(none)'}].`;
          }
          // TRANSITIONED / ALREADY_AT_TARGET → silent success
        }

        if (transitionNote) {
          // Field updates may have succeeded but status couldn't transition. Mark
          // PARTIAL_FAILURE so the user knows status is still drifted in Jira.
          results.push({
            ...action,
            status: 'PARTIAL_FAILURE',
            error: transitionNote,
          });
          continue;
        }
      } else {
        // UPDATE_TOOL — overlay the differences onto the existing tool item to
        // satisfy architecture-model-service's full-body PUT validation.
        if (!action.toolId || !action.jiraSnapshot) {
          throw new Error('UPDATE_TOOL action missing toolId or jiraSnapshot');
        }
        const existing = toolItemsById.get(action.toolId);
        if (!existing) {
          throw new Error(`tool work item ${action.toolId} not found for UPDATE_TOOL`);
        }
        const diffs = new Set(action.differences);
        const updateBody: WorkItemDto = { ...existing };
        if (diffs.has('title')) updateBody.title = action.jiraSnapshot.title;
        if (diffs.has('description')) updateBody.description = action.jiraSnapshot.description;
        if (diffs.has('priority')) updateBody.priority = action.jiraSnapshot.priority;
        if (diffs.has('status')) updateBody.status = action.jiraSnapshot.status;
        if (diffs.has('parent')) {
          const newParentKey = action.jiraSnapshot.parentExternalKey;
          if (newParentKey) {
            const parent = toolItemsByKnownExternalKey.get(newParentKey);
            updateBody.parent_id = parent?.id ?? null;
          } else {
            updateBody.parent_id = null;
          }
        }
        logger.info('Pushing UPDATE_TOOL', {
          toolId: action.toolId,
          externalKey: action.externalKey,
          diffs: [...diffs],
        });
        await updateToolWorkItem(projectId, action.toolId, updateBody);
      }
      results.push({ ...action, status: 'SUCCESS' });
    } catch (e: unknown) {
      results.push({ ...action, status: 'FAILED', error: errorMessage(e) });
    }
  }

  // ---------- Pass 4: UPLOAD_SPEC_TO_JIRA ----------
  // Runs after CREATE_IN_JIRA so newly-created stories have an externalKey
  // available via newJiraKeysByToolId. For each spec on each story, we
  // re-fetch fresh content (can't trust the analyze-time payload), upload to
  // jira-service which posts the attachment + comment in a single call, and
  // aggregate per-story success/failure.
  const specUploads = actions.filter((a) => a.action === 'UPLOAD_SPEC_TO_JIRA');

  for (const action of specUploads) {
    try {
      // Resolve the target Jira key — either the existing external_key or a
      // freshly-issued key from Pass 2's CREATE_IN_JIRA.
      let externalKey: string | null = action.externalKey;
      if (!externalKey && action.toolId) {
        externalKey = newJiraKeysByToolId.get(action.toolId) ?? null;
      }
      if (!externalKey) {
        results.push({
          ...action,
          status: 'SKIPPED',
          error: 'No Jira issue key available — story is unlinked and CREATE_IN_JIRA was not selected or failed.',
        });
        continue;
      }

      if (!action.toolId) {
        throw new Error('UPLOAD_SPEC_TO_JIRA action missing toolId');
      }

      const specs = action.specsToUpload ?? [];
      if (specs.length === 0) {
        results.push({ ...action, status: 'SUCCESS' });
        continue;
      }

      // Re-list current attachments so a concurrent earlier upload (e.g., user
      // ran sync twice) isn't repeated. Pass 4 dupe-check is the safety net.
      let alreadyAttached = new Set<string>();
      try {
        const existing = await listJiraAttachmentFilenames(externalKey);
        alreadyAttached = new Set(existing.map((f) => f.toLowerCase()));
      } catch (e) {
        logger.warn('Could not list existing attachments at execute time', {
          externalKey,
          error: e instanceof Error ? e.message : String(e),
        });
      }

      // Re-fetch the spec content fresh — analyze may have happened minutes
      // before execute; the user might have re-shaped a spec in between.
      const fresh = await fetchSpecArtifactsForWorkItem(projectId, action.toolId);
      const freshById = new Map(fresh.map((e) => [e.incrementId, e]));

      logger.info('Pushing UPLOAD_SPEC_TO_JIRA', {
        externalKey,
        toolId: action.toolId,
        specCount: specs.length,
      });

      const failures: string[] = [];
      let uploadedCount = 0;
      let skippedDupeCount = 0;
      for (const spec of specs) {
        const entry = freshById.get(spec.incrementId);
        if (!entry || !entry.content) {
          failures.push(`${spec.filename}: spec content not found at upload time`);
          continue;
        }
        if (alreadyAttached.has(spec.filename.toLowerCase())) {
          skippedDupeCount++;
          continue;
        }
        try {
          await jiraServiceUploadSpec({
            externalKey,
            filename: spec.filename,
            content: entry.content,
            commentText: `New spec "${entry.title}" has been added`,
          });
          uploadedCount++;
        } catch (e) {
          failures.push(`${spec.filename}: ${errorMessage(e)}`);
        }
      }

      if (failures.length === 0) {
        results.push({
          ...action,
          status: 'SUCCESS',
          newExternalKey: action.externalKey ? undefined : externalKey,
        });
      } else if (uploadedCount === 0) {
        results.push({
          ...action,
          status: 'FAILED',
          error: `All spec uploads failed: ${failures.join('; ')}`,
        });
      } else {
        results.push({
          ...action,
          status: 'PARTIAL_FAILURE',
          error: `${uploadedCount} uploaded, ${failures.length} failed${skippedDupeCount ? `, ${skippedDupeCount} already attached` : ''}: ${failures.join('; ')}`,
        });
      }
    } catch (e: unknown) {
      results.push({ ...action, status: 'FAILED', error: errorMessage(e) });
    }
  }

  // NO_CHANGE rows passed through unchanged; they're a no-op
  for (const action of actions.filter((a) => a.action === 'NO_CHANGE')) {
    results.push({ ...action, status: 'SUCCESS' });
  }

  // ---------- Summary ----------
  const summary = {
    total: results.length,
    succeeded: results.filter((r) => r.status === 'SUCCESS').length,
    failed: results.filter((r) => r.status === 'FAILED').length,
    partialFailures: results.filter((r) => r.status === 'PARTIAL_FAILURE').length,
    skipped: results.filter((r) => r.status === 'SKIPPED').length,
    byAction: results.reduce((acc, r) => {
      acc[r.action] = (acc[r.action] ?? 0) + 1;
      return acc;
    }, {} as Record<SyncAction, number>),
  };

  logger.info('Jira sync execution complete', {
    projectId,
    rootWorkItemId: req.rootWorkItemId,
    summary,
  });

  return { results, summary };
}

/**
 * Inverts a tool→Jira mapping into Jira→tool. Returns undefined for null/empty.
 * If multiple tool types map to the same Jira type (collision), the last one wins —
 * we warn the caller in the UI before this point, but defensively keep the
 * invariant that the inverted map is well-formed.
 */
function invertTypeMapping(mapping?: TypeMapping): Record<string, string> | undefined {
  if (!mapping || Object.keys(mapping).length === 0) return undefined;
  const inverted: Record<string, string> = {};
  for (const [toolType, jiraType] of Object.entries(mapping)) {
    if (jiraType) inverted[jiraType] = toolType;
  }
  return Object.keys(inverted).length > 0 ? inverted : undefined;
}

// ---------------------------------------------------------------------------
// Project info lookup (for D-ext 1 dynamic mapping)
// ---------------------------------------------------------------------------

export interface JiraIssueTypeRef {
  id: string;
  name: string;
  hierarchyLevel: number | null;
  subtask?: boolean;
}

export interface ProjectIssueTypesResponse {
  types: JiraIssueTypeRef[];
  /** Raw Jira issue type name of the anchor item (if anchorKey was provided). */
  anchorType: string | null;
}

export async function fetchProjectIssueTypes(
  jiraProjectKey: string,
  anchorKey?: string,
): Promise<ProjectIssueTypesResponse> {
  const baseUrl = getConfig().jiraServiceBaseUrl;
  const url = `${baseUrl}/jira/projects/${encodeURIComponent(jiraProjectKey)}/issue-types`;
  const params: Record<string, string> = {};
  if (anchorKey) params.anchorKey = anchorKey;
  // jira-service serializes this response in snake_case because of its global
  // Jackson SNAKE_CASE strategy. Transform to camelCase here so our internal
  // contract (and the frontend) sees consistent camelCase keys.
  type RawType = { id: string; name: string; hierarchy_level: number | null; subtask?: boolean };
  type RawResponse = { types: RawType[]; anchor_type: string | null };
  const r = await axios.get<RawResponse>(url, { params, timeout: 15000 });
  return {
    types: (r.data.types ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      hierarchyLevel: t.hierarchy_level,
      subtask: t.subtask,
    })),
    anchorType: r.data.anchor_type ?? null,
  };
}

function errorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    if (e.response?.data) {
      const data = e.response.data;
      if (typeof data === 'string') return `${e.response.status}: ${data}`;
      return `${e.response.status}: ${JSON.stringify(data)}`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

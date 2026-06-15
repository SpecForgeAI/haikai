/**
 * Jira Sync API client
 *
 * Phase D: thin client wrapping the gateway's two sync endpoints.
 * Types mirror gateway/src/services/jiraSyncService.ts exactly — the gateway
 * already serializes camelCase JSON, so no transformation is needed.
 */

// ---------------------------------------------------------------------------
// Types (mirror gateway shapes)
// ---------------------------------------------------------------------------

export type GoldenSource = 'TOOL' | 'JIRA';

export type SyncAction =
  | 'CREATE_IN_JIRA'
  | 'CREATE_IN_TOOL'
  | 'UPDATE_JIRA'
  | 'UPDATE_TOOL'
  | 'UPLOAD_SPEC_TO_JIRA'
  | 'NO_CHANGE';

export interface SpecToUpload {
  incrementId: string;
  title: string;
  filename: string;
}

export type SyncResultStatus = 'SUCCESS' | 'FAILED' | 'PARTIAL_FAILURE' | 'SKIPPED';

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
  toolId: string | null;
  externalKey: string | null;
  type: string;
  title: string;
  parentToolId: string | null;
  parentExternalKey: string | null;
  differences: string[];
  toolSnapshot: ItemSnapshot | null;
  jiraSnapshot: ItemSnapshot | null;
  /** Pending spec uploads — only populated for UPLOAD_SPEC_TO_JIRA actions. */
  specsToUpload?: SpecToUpload[];
}

export interface SyncAnalysisResult {
  goldenSource: GoldenSource;
  jiraProjectKey: string;
  rootWorkItemId: string;
  actions: SyncActionItem[];
  warnings: string[];
}

export interface SyncExecuteResultItem extends SyncActionItem {
  status: SyncResultStatus;
  error?: string;
  newExternalKey?: string;
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
 * Per-sync type-mapping override. Tool work-item type → Jira issue type name.
 * Used by the dynamic-mapping flow (D-ext 1+) where the mapping is anchored on
 * the sync root's existing Jira link instead of the static yml config.
 */
export type TypeMapping = Record<string, string>;

// ---------------------------------------------------------------------------
// Project issue types (D-ext 1) — for dynamic mapping inference
// ---------------------------------------------------------------------------

export interface JiraIssueTypeRef {
  id: string;
  name: string;
  hierarchyLevel: number | null;
  subtask?: boolean;
}

export interface ProjectIssueTypesResponse {
  types: JiraIssueTypeRef[];
  /** Raw Jira issue type name of the anchor item (when anchorKey provided). */
  anchorType: string | null;
}

export async function fetchProjectIssueTypes(
  jiraProjectKey: string,
  anchorKey?: string,
): Promise<ProjectIssueTypesResponse> {
  const params = new URLSearchParams();
  if (anchorKey) params.set('anchorKey', anchorKey);
  const url = `/api/jira/sync/projects/${encodeURIComponent(jiraProjectKey)}/issue-types${params.toString() ? '?' + params.toString() : ''}`;
  const response = await fetch(url);
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.message || `Project issue types fetch failed: ${response.status}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export interface AnalyzeRequest {
  projectId: string;
  rootWorkItemId: string;
  goldenSource: GoldenSource;
  jiraProjectKey: string;
  typeMapping?: TypeMapping;
}

export async function analyzeSync(req: AnalyzeRequest): Promise<SyncAnalysisResult> {
  const response = await fetch('/api/jira/sync/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.message || `Analyze failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export interface ExecuteRequest {
  projectId: string;
  rootWorkItemId?: string;
  goldenSource: GoldenSource;
  jiraProjectKey: string;
  actions: SyncActionItem[];
  typeMapping?: TypeMapping;
}

export async function executeSync(req: ExecuteRequest): Promise<SyncExecuteResult> {
  const response = await fetch('/api/jira/sync/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.message || `Execute failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

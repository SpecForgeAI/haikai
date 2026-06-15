/**
 * Migration Discovery Context API Client
 *
 * Spec: 2026-05-16 Migration Discovery Context Integration -- Task Group 4
 *
 * Frontend client for the gateway proxy route
 * `POST /api/v1/projects/:projectId/migration-discovery-context`. The gateway
 * forwards the body verbatim to architecture-model-service's aggregation
 * endpoint and pipes the snake_case JSON DTO back. We surface a thin typed
 * wrapper here so the capture-session wizard (Step 1 Discovery Context
 * section) and the capture-review panel can read prioritised discovery
 * findings, evidence highlights, runtime/DB summaries, and the readiness
 * assessment for the current architecture.
 *
 * The DTO shape mirrors AMS's `MigrationDiscoveryContextDto` field-for-field
 * in camelCase (AMS uses Jackson `@JsonProperty` annotations to emit
 * camelCase explicitly for this DTO). Optional fields are typed as
 * `field?: T | null` so consumers can distinguish "absent" from "present but
 * zero/empty".
 *
 * Fail-soft contract: every call site must be ready to receive
 * `findingsSummary === null` / `discoveryRunsSummary === null` / etc., and
 * must NOT block the existing capture flow when this fetch fails. Errors
 * thrown from this module are intentionally generic -- callers catch and
 * render a degenerate-state placeholder rather than blocking submit.
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Request type
// ============================================================================

/**
 * Body for `POST /api/v1/projects/:projectId/migration-discovery-context`.
 *
 * Only `currentArchitectureId` is required. AMS applies the documented
 * defaults when other fields are omitted: include flags = true,
 * `maxFindings = 100`, `maxEvidenceItems = 100`, and latest completed runs
 * for the current architecture when `discoveryRunIds` is empty.
 */
export interface MigrationDiscoveryContextRequest {
  currentArchitectureId: string;
  targetArchitectureId?: string | null;
  discoveryRunIds?: string[];
  apiBehaviourBaselineIds?: string[];
  includeFindings?: boolean;
  includeEvidence?: boolean;
  includeRuntimeEvidence?: boolean;
  includeDbFindings?: boolean;
  includeMappings?: boolean;
  maxFindings?: number;
  maxEvidenceItems?: number;
}

// ============================================================================
// Response shape (mirrors AMS MigrationDiscoveryContextDto)
// ============================================================================

export interface MigrationArchitectureSummary {
  architectureId: string;
  name: string;
  applicationCount?: number | null;
  serviceCount?: number | null;
  interfaceCount?: number | null;
  dataEntityCount?: number | null;
  dataStoreCount?: number | null;
  businessUserCount?: number | null;
  processActivityCount?: number | null;
  uiScreenCount?: number | null;
  userJourneyCount?: number | null;
  hasModel?: boolean | null;
}

export interface MigrationDiscoveryRunHighlight {
  runId: string;
  architectureId: string;
  status: string;
  discoveryKind: string;
  createdAt: string;
  updatedAt: string;
}

export interface MigrationDiscoveryRunsSummary {
  totalRuns?: number | null;
  completedRuns?: number | null;
  runs?: MigrationDiscoveryRunHighlight[];
}

export interface MigrationFindingsSummary {
  totalFindings?: number | null;
  countsByStatus?: Record<string, number>;
  countsBySeverity?: Record<string, number>;
  countsByCategory?: Record<string, number>;
  highSeverityUnreviewedCount?: number | null;
  sampleDataHintCount?: number | null;
}

export interface MigrationFindingHighlight {
  findingId: string;
  runId: string;
  findingType: string;
  category: string;
  severity: string;
  status: string;
  title: string;
  summary?: string | null;
  source?: string | null;
  confidence?: number | null;
}

export interface MigrationEvidenceHighlight {
  evidenceId: string;
  runId: string;
  type: string;
  source?: string | null;
  filePath?: string | null;
  linkedFindingIds?: string[];
}

export interface MigrationCandidateSummary {
  totalCandidates?: number | null;
  countsByType?: Record<string, number>;
  countsByStatus?: Record<string, number>;
}

export interface MigrationDecisionTaskHighlight {
  taskId: string;
  runId: string;
  taskType: string;
  status: string;
  createdAt: string;
}

export interface MigrationRuntimeUsageSummary {
  runtimeEvidenceCount?: number | null;
  runtimeFindingCount?: number | null;
  hasRuntimeEvidence?: boolean | null;
}

export interface MigrationDatabaseDiscoverySummary {
  databaseFindingCount?: number | null;
  databaseRunCount?: number | null;
  sampleDataHintCount?: number | null;
  hasDatabaseDiscovery?: boolean | null;
}

export interface MigrationBaselineHighlight {
  baselineId: string;
  architectureId: string;
  sessionId?: string | null;
  name: string;
  status: string;
  operationCount?: number | null;
  acceptedCaptureCount?: number | null;
  createdAt: string;
}

export interface MigrationApiBehaviourBaselineSummary {
  totalBaselines?: number | null;
  activeBaselineCount?: number | null;
  draftBaselineCount?: number | null;
  baselines?: MigrationBaselineHighlight[];
}

export interface MigrationArchitectureMappingsSummary {
  totalMappings?: number | null;
  countsBySourceType?: Record<string, number>;
  countsByTargetType?: Record<string, number>;
  countsByMappingType?: Record<string, number>;
}

export interface MigrationReadinessAssessment {
  overallStatus: string;
  apiReadiness?: string | null;
  dataReadiness?: string | null;
  infrastructureReadiness?: string | null;
  discoveryReadiness?: string | null;
  mappingReadiness?: string | null;
  baselineReadiness?: string | null;
  decisionReadiness?: string | null;
  gaps?: string[];
}

export interface MigrationDiscoveryContext {
  projectId: string;
  currentArchitectureId: string;
  targetArchitectureId?: string | null;
  discoveryRunIds?: string[];
  apiBehaviourBaselineIds?: string[];
  generatedAt: string;
  summary?: string | null;
  currentArchitectureSummary?: MigrationArchitectureSummary | null;
  targetArchitectureSummary?: MigrationArchitectureSummary | null;
  discoveryRunsSummary?: MigrationDiscoveryRunsSummary | null;
  findingsSummary?: MigrationFindingsSummary | null;
  highPriorityFindings?: MigrationFindingHighlight[];
  findingsByCategory?: Record<string, number>;
  evidenceHighlights?: MigrationEvidenceHighlight[];
  candidateSummary?: MigrationCandidateSummary | null;
  unresolvedDecisionTasks?: MigrationDecisionTaskHighlight[];
  runtimeUsageSummary?: MigrationRuntimeUsageSummary | null;
  databaseDiscoverySummary?: MigrationDatabaseDiscoverySummary | null;
  apiBehaviourBaselineSummary?: MigrationApiBehaviourBaselineSummary | null;
  architectureMappingsSummary?: MigrationArchitectureMappingsSummary | null;
  readinessAssessment?: MigrationReadinessAssessment | null;
  contextWarnings?: string[];
}

// ============================================================================
// Typed error
// ============================================================================

export interface MigrationDiscoveryContextErrorBody {
  code?: string | number;
  message?: string;
  details?: string;
  [k: string]: unknown;
}

export class MigrationDiscoveryContextApiError extends Error {
  readonly status: number;
  readonly body: MigrationDiscoveryContextErrorBody;

  constructor(
    status: number,
    body: MigrationDiscoveryContextErrorBody,
    message?: string,
  ) {
    super(
      message ?? body.message ?? `Migration discovery context error (status ${status})`,
    );
    this.name = 'MigrationDiscoveryContextApiError';
    this.status = status;
    this.body = body;
  }
}

async function parseErrorBody(
  res: Response,
): Promise<MigrationDiscoveryContextErrorBody> {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const parsed = (await res.json()) as unknown;
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        const wrapped = obj.error;
        if (wrapped && typeof wrapped === 'object') {
          return wrapped as MigrationDiscoveryContextErrorBody;
        }
        return obj as MigrationDiscoveryContextErrorBody;
      }
      return { message: res.statusText };
    }
    const text = await res.text();
    return { message: text || res.statusText };
  } catch {
    return { message: res.statusText };
  }
}

// ============================================================================
// Client function
// ============================================================================

/**
 * Fetch the aggregated migration discovery context for a project / architecture.
 *
 * Hits the gateway proxy route `POST /api/v1/projects/:projectId/migration-discovery-context`.
 * The gateway forwards the body verbatim to architecture-model-service.
 *
 * Throws `MigrationDiscoveryContextApiError` on non-2xx responses; the wizard
 * and capture-review surfaces catch and render a degenerate-state placeholder
 * (the spec's fail-soft contract). Network / fetch failures bubble up as raw
 * errors -- the same catch path handles them.
 */
export async function fetchMigrationDiscoveryContext(
  projectId: string,
  body: MigrationDiscoveryContextRequest,
): Promise<MigrationDiscoveryContext> {
  const url = `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}/migration-discovery-context`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await parseErrorBody(res);
    throw new MigrationDiscoveryContextApiError(res.status, err);
  }
  return (await res.json()) as MigrationDiscoveryContext;
}

/**
 * Migration Discovery Context client.
 *
 * Thin typed wrapper over the architecture-model-service aggregation endpoint
 * `POST /api/projects/{projectId}/migration-discovery-context`. Returns the
 * `MigrationDiscoveryContextDto` verbatim (no business logic in the gateway).
 *
 * The DTO carries Current/Target State Architecture summaries, prioritised
 * discovery findings, evidence highlights, runtime/DB discovery roll-ups,
 * API Behaviour Baseline highlights, current-to-target element mapping counts,
 * and a deterministic readiness assessment. Every block carries durable IDs so
 * downstream prompt consumers can cite or re-fetch.
 *
 * Spec: 2026-05-16 Migration Discovery Context Integration -- Task Group 2.
 */

import { getConfig } from '../config';
import { ArchitectureModelHttpError } from './architectureModelClient';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Wire-format request / response types (mirror the Java DTOs verbatim).
// ---------------------------------------------------------------------------

/**
 * Request body for the aggregation endpoint. All fields except
 * `currentArchitectureId` are optional; AMS applies the documented defaults
 * (include flags = true, maxFindings = 100, maxEvidenceItems = 100, latest
 * completed runs when `discoveryRunIds` is omitted).
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

export interface MigrationArchitectureSummary {
  architectureId: string;
  name: string;
  applicationCount?: number;
  serviceCount?: number;
  interfaceCount?: number;
  dataEntityCount?: number;
  dataStoreCount?: number;
  businessUserCount?: number;
  processActivityCount?: number;
  uiScreenCount?: number;
  userJourneyCount?: number;
  hasModel?: boolean;
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
  totalRuns?: number;
  completedRuns?: number;
  runs?: MigrationDiscoveryRunHighlight[];
}

export interface MigrationFindingsSummary {
  totalFindings?: number;
  countsByStatus?: Record<string, number>;
  countsBySeverity?: Record<string, number>;
  countsByCategory?: Record<string, number>;
  highSeverityUnreviewedCount?: number;
  sampleDataHintCount?: number;
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
  totalCandidates?: number;
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
  runtimeEvidenceCount?: number;
  runtimeFindingCount?: number;
  hasRuntimeEvidence?: boolean;
}

export interface MigrationDatabaseDiscoverySummary {
  databaseFindingCount?: number;
  databaseRunCount?: number;
  sampleDataHintCount?: number;
  hasDatabaseDiscovery?: boolean;
}

export interface MigrationBaselineHighlight {
  baselineId: string;
  architectureId: string;
  sessionId?: string | null;
  name: string;
  status: string;
  operationCount?: number;
  acceptedCaptureCount?: number;
  createdAt: string;
}

export interface MigrationApiBehaviourBaselineSummary {
  totalBaselines?: number;
  activeBaselineCount?: number;
  draftBaselineCount?: number;
  baselines?: MigrationBaselineHighlight[];
}

export interface MigrationArchitectureMappingsSummary {
  totalMappings?: number;
  countsBySourceType?: Record<string, number>;
  countsByTargetType?: Record<string, number>;
  countsByMappingType?: Record<string, number>;
}

export interface MigrationReadinessAssessment {
  overallStatus: string;
  apiReadiness?: string;
  dataReadiness?: string;
  infrastructureReadiness?: string;
  discoveryReadiness?: string;
  mappingReadiness?: string;
  baselineReadiness?: string;
  decisionReadiness?: string;
  gaps?: string[];
}

export interface MigrationDiscoveryContext {
  projectId: string;
  currentArchitectureId: string;
  targetArchitectureId?: string | null;
  discoveryRunIds?: string[];
  apiBehaviourBaselineIds?: string[];
  generatedAt: string;
  summary?: string;
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

// ---------------------------------------------------------------------------
// Client function
// ---------------------------------------------------------------------------

/**
 * Calls `POST /api/projects/{projectId}/migration-discovery-context` on AMS and
 * returns the parsed `MigrationDiscoveryContextDto` verbatim.
 *
 * Throws `ArchitectureModelHttpError` on any non-2xx response so the proxy
 * route can forward upstream status + body byte-for-byte (404 architecture
 * mismatch, 400 validation, etc.). Network / fetch failures bubble up as the
 * raw error -- callers (resolver, proxy) handle them.
 *
 * @param projectId  the project ID (UUID string)
 * @param request    the typed request body
 * @returns          parsed `MigrationDiscoveryContext`
 * @throws ArchitectureModelHttpError on non-2xx responses
 */
export async function fetchMigrationDiscoveryContext(
  projectId: string,
  request: MigrationDiscoveryContextRequest
): Promise<MigrationDiscoveryContext> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/migration-discovery-context`;

  logger.debug('Fetching migration discovery context from architecture-model-service', {
    projectId,
    url,
    currentArchitectureId: request.currentArchitectureId,
    targetArchitectureId: request.targetArchitectureId,
    discoveryRunCount: request.discoveryRunIds?.length ?? 0,
    baselineCount: request.apiBehaviourBaselineIds?.length ?? 0,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(request),
  });

  const contentType = response.headers.get('content-type') || '';
  let body: unknown;
  if (contentType.includes('application/json')) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  } else {
    try {
      const text = await response.text();
      body = text === '' ? null : text;
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    logger.warn('Architecture model service returned non-OK response for migration-discovery-context', {
      projectId,
      status: response.status,
    });
    throw new ArchitectureModelHttpError(response.status, body);
  }

  return body as MigrationDiscoveryContext;
}

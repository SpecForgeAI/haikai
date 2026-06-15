/**
 * Dashboard Summary Route
 *
 * Provides a GET /summary endpoint that returns a DashboardSummaryDto
 * built entirely from real data sources: work-items stats endpoint,
 * product summary, meta-model summary, and filesystem artifact checks.
 *
 * Follows the self-contained route pattern from implementState.ts:
 * - Router() export, requestId extraction, inline validation,
 *   logger debug/info calls, async handler signature.
 *
 * Spec 2026-02-18: Dashboard Increment 2 -- Define Dashboard Summary Contract + Backend Mock Endpoint
 * Updated: Hub Bootstrap 1-4 -- Real artifact existence checks
 * Updated: Dashboard UX Improvements -- Updated field names for new type definitions
 * Updated: 2026-03-06 Dashboard Real Data -- Full rewrite to use real data (no mock service)
 */

import { Router, Request, Response } from 'express';
import { logger } from '../services/logger';
import {
  ScopeType,
  DashboardSummaryDto,
  DashboardScope,
  MetricCard,
} from '../types/dashboard';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fetchProjectFolder, fetchProductSummary, fetchMetaModelSummary, fetchWorkItemStats, resolveDefaultArchitectureId } from '../services/architectureModelClient';
import { hasExistingRoadmap, countRoadmapItems } from '../services/roadmapSummaryBuilder';
import { generateHeaderInsight, generateDeliveryInsight } from '../services/dashboardInsightGenerator';
import type { WorkItemStatsResponse } from '../services/architectureModelClient';

/** Valid scope type values */
const VALID_SCOPE_TYPES: ReadonlySet<string> = new Set<string>([
  'ENTIRE_PRODUCT',
  'NEXT_5_EPICS',
  'QTR',
  'CUSTOM',
]);

// ============================================================================
// Helper Functions
// Spec: 2026-03-06 Dashboard Real Data - Task Group 2
// ============================================================================

/**
 * Sums all status counts for a given work item type.
 *
 * @param typeCounts - The type_counts map from WorkItemStatsResponse
 * @param type - The work item type (e.g., 'EPIC', 'FEATURE', 'STORY')
 * @returns Total count across all statuses for that type, or 0 if type is missing
 */
function sumAllStatusesForType(
  typeCounts: Record<string, Record<string, number>> | undefined,
  type: string
): number {
  if (!typeCounts?.[type]) return 0;
  return Object.values(typeCounts[type]).reduce((sum, count) => sum + count, 0);
}

/**
 * Returns the count for a specific type+status combination.
 *
 * @param typeCounts - The type_counts map from WorkItemStatsResponse
 * @param type - The work item type (e.g., 'EPIC', 'FEATURE', 'STORY')
 * @param status - The status (e.g., 'IN_PROGRESS', 'COMPLETED', 'PLANNED')
 * @returns Count for that type+status, or 0 if not found
 */
function getStatusCount(
  typeCounts: Record<string, Record<string, number>> | undefined,
  type: string,
  status: string
): number {
  return typeCounts?.[type]?.[status] ?? 0;
}

/**
 * Gets the formatted mtime (DD/MM/YYYY) of a file.
 * Returns 'N/A' if the file does not exist or any error occurs.
 *
 * @param filePath - Absolute path to the file
 * @returns Formatted date string or 'N/A'
 */
async function getFileMtimeFormatted(filePath: string): Promise<string> {
  try {
    const stat = await fs.stat(filePath);
    const d = stat.mtime;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  } catch {
    return 'N/A';
  }
}

/**
 * Builds a MetricCard with the given label and value.
 */
function card(label: string, value: number | boolean | string): MetricCard {
  return { label, value };
}

/**
 * Resolves the scope label based on the scope type.
 */
function resolveScopeLabel(scopeType: ScopeType): string {
  switch (scopeType) {
    case 'ENTIRE_PRODUCT':
      return 'Entire Product';
    case 'NEXT_5_EPICS':
      return 'Next 5 Epics';
    case 'QTR':
      return 'Q1 2026';
    case 'CUSTOM':
      return 'Custom Scope';
    default:
      return 'Entire Product';
  }
}

export const dashboardSummaryRouter = Router();

/**
 * GET /summary
 *
 * Returns a DashboardSummaryDto built from real data sources.
 *
 * Query Parameters:
 * - projectId (string, required): The project identifier
 * - scope (string, optional): Scope type; defaults to ENTIRE_PRODUCT if absent or unrecognized
 * - scopeValue (string, optional): Scope value passed through to the response
 *
 * Responses:
 * - 200: DashboardSummaryDto JSON
 * - 400: { error: "projectId is required" } when projectId is missing/empty
 */
dashboardSummaryRouter.get('/summary', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';

  // Validate projectId
  const projectId = req.query.projectId as string | undefined;
  if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
    logger.warn('GET dashboard/summary validation failed', {
      requestId,
      error: 'projectId is required',
    });
    return res.status(400).json({ error: 'projectId is required' });
  }

  // Read optional scope, default to ENTIRE_PRODUCT if absent or unrecognized
  const rawScope = req.query.scope as string | undefined;
  const scopeType: ScopeType = (rawScope && VALID_SCOPE_TYPES.has(rawScope))
    ? rawScope as ScopeType
    : 'ENTIRE_PRODUCT';

  // Read optional scopeValue
  const scopeValue = (req.query.scopeValue as string | undefined) ?? null;

  logger.debug('GET dashboard/summary request', {
    requestId,
    projectId,
    scopeType,
    scopeValue,
  });

  // ========================================================================
  // Fetch all data sources in parallel
  // ========================================================================
  const [projectFolder, productSummary, metaModel, stats] = await Promise.all([
    fetchProjectFolder(projectId).catch((err) => {
      logger.warn('Dashboard: fetchProjectFolder failed (non-fatal)', {
        requestId, projectId, error: err instanceof Error ? err.message : 'Unknown error',
      });
      return null;
    }),
    fetchProductSummary(projectId).catch((err) => {
      logger.warn('Dashboard: fetchProductSummary failed (non-fatal)', {
        requestId, projectId, error: err instanceof Error ? err.message : 'Unknown error',
      });
      return null;
    }),
    // Spec 2026-05-01 Multi-Architecture Plumbing - Task Group 3:
    // resolve project's Default architecture before Bucket A meta-model-summary call.
    resolveDefaultArchitectureId(projectId).then((architectureId) => {
      if (!architectureId) {
        logger.debug('Dashboard: no default architecture; skipping meta-model summary', { requestId, projectId });
        return null;
      }
      return fetchMetaModelSummary(projectId, architectureId).catch((err) => {
        logger.warn('Dashboard: fetchMetaModelSummary failed (non-fatal)', {
          requestId, projectId, architectureId, error: err instanceof Error ? err.message : 'Unknown error',
        });
        return null;
      });
    }).catch((err) => {
      logger.warn('Dashboard: resolveDefaultArchitectureId failed (non-fatal)', {
        requestId, projectId, error: err instanceof Error ? err.message : 'Unknown error',
      });
      return null;
    }),
    fetchWorkItemStats(projectId).catch((err) => {
      logger.warn('Dashboard: fetchWorkItemStats failed (non-fatal)', {
        requestId, projectId, error: err instanceof Error ? err.message : 'Unknown error',
      });
      return null;
    }),
  ]) as [string | null, any, any, WorkItemStatsResponse | null];

  const artifactBasePath = projectFolder || process.cwd();
  const typeCounts = stats?.type_counts;

  // ========================================================================
  // Roadmap counts from productSummary
  // ========================================================================
  let initiativeCount = 0;
  let epicCountFromRoadmap = 0;
  try {
    if (productSummary && hasExistingRoadmap(productSummary)) {
      const counts = countRoadmapItems(productSummary);
      initiativeCount = counts.initiativeCount;
      epicCountFromRoadmap = counts.epicCount;
    }
  } catch (err) {
    logger.warn('Dashboard: countRoadmapItems failed (non-fatal)', {
      requestId, projectId, error: err instanceof Error ? err.message : 'Unknown error',
    });
  }

  // ========================================================================
  // Product Definition: MISSION.MD existence + mtime
  // ========================================================================
  let missionExists = false;
  let missionLastUpdated = 'N/A';
  const missionPath = path.join(artifactBasePath, 'agent-os', 'product', 'MISSION.MD');
  try {
    await fs.access(missionPath);
    missionExists = true;
    missionLastUpdated = await getFileMtimeFormatted(missionPath);
  } catch {
    // File does not exist
    missionExists = false;
    missionLastUpdated = 'N/A';
  }

  // ========================================================================
  // Standards: Org Tech Stack
  // Path: {artifactBasePath}/../agent-os/profiles/default/standards/global/TECH-STACK.MD
  // ========================================================================
  let orgTechStackStatus = 'Not Generated';
  try {
    const orgTechStackPath = path.join(
      artifactBasePath, '..', 'agent-os', 'profiles', 'default', 'standards', 'global', 'TECH-STACK.MD'
    );
    await fs.access(orgTechStackPath);
    orgTechStackStatus = 'Generated';
  } catch {
    // Uppercase not found -- try lowercase fallback
    try {
      const orgTechStackPathLower = path.join(
        artifactBasePath, '..', 'agent-os', 'profiles', 'default', 'standards', 'global', 'tech-stack.md'
      );
      await fs.access(orgTechStackPathLower);
      orgTechStackStatus = 'Generated';
    } catch {
      orgTechStackStatus = 'Not Generated';
    }
  }

  // ========================================================================
  // Standards: Product Tech Stack
  // Path: {artifactBasePath}/agent-os/product/TECH-STACK.MD
  // ========================================================================
  let productTechStackStatus = 'Not Generated';
  try {
    const productTechStackPath = path.join(
      artifactBasePath, 'agent-os', 'product', 'TECH-STACK.MD'
    );
    await fs.access(productTechStackPath);
    productTechStackStatus = 'Generated';
  } catch {
    // Uppercase not found -- try lowercase fallback
    try {
      const productTechStackPathLower = path.join(
        artifactBasePath, 'agent-os', 'product', 'tech-stack.md'
      );
      await fs.access(productTechStackPathLower);
      productTechStackStatus = 'Generated';
    } catch {
      productTechStackStatus = 'Not Generated';
    }
  }

  // ========================================================================
  // High-Level Architecture from metaModel
  // ========================================================================
  const hlaApplications = metaModel?.applications?.length ?? 0;
  const hlaServices = metaModel?.services?.length ?? 0;
  const hlaInterfaces = metaModel?.interfaces?.length ?? 0;
  const hlaDataStores = metaModel?.data_store_count ?? 0;
  const hlaOverall = hlaApplications + hlaServices + hlaInterfaces + hlaDataStores;

  // ========================================================================
  // Users & Interactions from metaModel
  // ========================================================================
  const businessUserCount = metaModel?.business_users?.length ?? 0;
  const processActivityCount = metaModel?.process_activities?.length ?? 0;
  const uiScreenCount = metaModel?.ui_screens?.length ?? 0;

  // ========================================================================
  // Test Strategy: TEST-STRATEGY.MD existence + mtime
  // ========================================================================
  let testStrategyExists = false;
  let testStrategyLastUpdated = 'N/A';
  const testStrategyPath = path.join(artifactBasePath, 'agent-os', 'product', 'TEST-STRATEGY.MD');
  try {
    await fs.access(testStrategyPath);
    testStrategyExists = true;
    testStrategyLastUpdated = await getFileMtimeFormatted(testStrategyPath);
  } catch {
    // Uppercase not found -- try lowercase fallback
    try {
      const testStrategyPathLower = path.join(
        artifactBasePath, 'agent-os', 'product', 'test-strategy.md'
      );
      await fs.access(testStrategyPathLower);
      testStrategyExists = true;
      testStrategyLastUpdated = await getFileMtimeFormatted(testStrategyPathLower);
    } catch {
      testStrategyExists = false;
      testStrategyLastUpdated = 'N/A';
    }
  }

  // ========================================================================
  // Detailed Architecture from metaModel
  // ========================================================================
  const interfaceEndpoints = metaModel?.interfaces?.length ?? 0;
  const logicalDataEntities = metaModel?.data_entities?.filter(
    (e: { entity_type: string }) => e.entity_type === 'logicalDataEntities'
  ).length ?? 0;
  const physicalDataEntities = metaModel?.data_entities?.filter(
    (e: { entity_type: string }) => e.entity_type === 'physicalDataEntities'
  ).length ?? 0;
  const processActivities = 0; // No data source exists in current meta-model
  const detailedArchOverall = interfaceEndpoints + logicalDataEntities + physicalDataEntities + processActivities;

  // ========================================================================
  // Backlog from stats endpoint
  // ========================================================================
  const epicsInScope = sumAllStatusesForType(typeCounts, 'EPIC');
  const featuresCount = sumAllStatusesForType(typeCounts, 'FEATURE');
  const storiesCount = sumAllStatusesForType(typeCounts, 'STORY');
  const storiesWithAC = stats?.stories_with_ac_count ?? 0;

  // ========================================================================
  // Implementation from stats endpoint
  // ========================================================================
  const featuresInProgress = getStatusCount(typeCounts, 'FEATURE', 'IN_PROGRESS');
  const storiesInProgress = getStatusCount(typeCounts, 'STORY', 'IN_PROGRESS');
  const storiesComplete = getStatusCount(typeCounts, 'STORY', 'COMPLETED');

  // ========================================================================
  // AI-generated insights (both run in parallel)
  // ========================================================================
  const [headerInsightText, deliveryInsightText] = await Promise.all([
    generateHeaderInsight({
      missionExists,
      missionLastUpdated,
      orgTechStackStatus,
      productTechStackStatus,
      testStrategyExists,
      testStrategyLastUpdated,
      hlaServices,
      hlaInterfaces,
      hlaDataStores,
      businessUserCount,
      processActivityCount,
      uiScreenCount,
      initiativeCount,
      epicCount: epicCountFromRoadmap,
      epicsCompleted: getStatusCount(typeCounts, 'EPIC', 'COMPLETED'),
      epicsInProgress: getStatusCount(typeCounts, 'EPIC', 'IN_PROGRESS'),
      featuresCount,
      storiesCount,
      storiesWithAC,
      storiesInProgress,
      storiesComplete,
    }, requestId),
    generateDeliveryInsight({
      epicsInScope,
      featuresCount,
      storiesCount,
      storiesWithAC,
      detailedArchOverall,
      interfaceEndpoints,
      logicalDataEntities,
      physicalDataEntities,
      e2eTests: 0,
      functionalTests: 0,
      featuresInProgress,
      storiesInProgress,
      storiesComplete,
      storiesVerified: 0,
      pendingReview: 0,
    }, requestId),
  ]);

  // ========================================================================
  // Assemble the scope
  // ========================================================================
  const scope: DashboardScope = {
    type: scopeType,
    label: resolveScopeLabel(scopeType),
    scopeValue: scopeValue,
  };

  // ========================================================================
  // Assemble the full DTO
  // ========================================================================
  const dto: DashboardSummaryDto = {
    header: {
      projectName: projectId,
      generatedAt: new Date().toISOString(),
      initiativesCount: initiativeCount,
      epicsCount: sumAllStatusesForType(typeCounts, 'EPIC'),
      activeEpicsCount: getStatusCount(typeCounts, 'EPIC', 'IN_PROGRESS'),
      storiesInProgressCount: getStatusCount(typeCounts, 'STORY', 'IN_PROGRESS'),
      lastUpdatedLabel: 'Just now',
      mode: 'GREENFIELD',
      headerInsight: headerInsightText,
    },
    strategicFoundation: {
      productDefinition: {
        missionExists: card('Mission Exists', missionExists),
        lastUpdatedLabel: card('Last Updated', missionLastUpdated),
      },
      highLevelArchitecture: {
        overall: card('Overall', hlaOverall),
        applications: card('Applications', hlaApplications),
        services: card('Services', hlaServices),
        interfaces: card('Interfaces', hlaInterfaces),
        dataStores: card('Data Stores', hlaDataStores),
      },
      roadmap: {
        initiativesCount: card('Initiatives', initiativeCount),
        epics: card('Epics', epicCountFromRoadmap),
        completed: card('Completed', getStatusCount(typeCounts, 'EPIC', 'COMPLETED')),
      },
      usersAndInteractions: {
        userRoles: card('User Roles', businessUserCount),
        businessActivities: card('Business Activities', processActivityCount),
        uiScreens: card('UI Screens', uiScreenCount === 0 ? 'No UI' : uiScreenCount),
      },
      standards: {
        orgTechStack: card('Org Tech Stack', orgTechStackStatus),
        productTechStack: card('Product Tech Stack', productTechStackStatus),
      },
      testStrategy: {
        exists: card('Exists', testStrategyExists),
        lastUpdated: card('Last Updated', testStrategyLastUpdated),
      },
      summaryInsight: {
        enabled: !!headerInsightText,
        message: headerInsightText,
      },
    },
    scope,
    detailedDefinitionAndDelivery: {
      preCoding: {
        backlog: {
          epicsInScope: card('Epics In Scope', epicsInScope),
          featuresCount: card('Features', featuresCount),
          storiesCount: card('Stories', storiesCount),
          storiesWithAcceptanceCriteriaCount: card('Stories with AC', storiesWithAC),
        },
        detailedArchitecture: {
          overall: card('Detailed Architecture', detailedArchOverall),
          processActivities: card('Process Activities', processActivities),
          interfaceEndpoints: card('Interface Endpoints', interfaceEndpoints),
          logicalDataEntities: card('Logical Data Entities', logicalDataEntities),
          physicalDataEntities: card('Physical Data Entities', physicalDataEntities),
        },
        testingSuite: {
          endToEndTestCount: card('E2E Tests', 0),
          functionalTestCount: card('Functional Tests', 0),
        },
      },
      postCoding: {
        implementation: {
          featuresInProgress: card('Features in Progress', featuresInProgress),
          storiesInProgress: card('Stories in Progress', storiesInProgress),
          storiesComplete: card('Stories Complete', storiesComplete),
        },
        verification: {
          storiesVerifiedCount: card('Stories Verified', 0),
          pendingReviewCount: card('Stories Pending Review', 0),
        },
        summaryInsight: {
          enabled: !!deliveryInsightText,
          message: deliveryInsightText,
        },
      },
    },
  };

  logger.info('GET dashboard/summary success', {
    requestId,
    projectId,
    scopeType,
  });

  return res.json(dto);
});

/**
 * Project Signals Service
 *
 * Spec 2026-03-04: Assistant "What's Next" v1
 * Task Group 1 (Task 1.1): Define ProjectSignals interface
 * Task Group 2 (Tasks 2.2-2.3): Implement buildProjectSignals
 *
 * Computes a real-time snapshot of project state signals by checking:
 * - Filesystem artifacts (MISSION.MD, TECH-STACK.MD, TEST-STRATEGY.MD) via fs.access
 * - Architecture-model-service (roadmap, meta-model) via existing HTTP client functions
 *
 * All signal sources degrade gracefully (return false/0 on error).
 */

import fs from 'fs/promises';
import path from 'path';
import { fetchProjectFolder, fetchMetaModelSummary, fetchProductSummary, resolveDefaultArchitectureId } from './architectureModelClient';
import { hasExistingRoadmap, countRoadmapItems } from './roadmapSummaryBuilder';

/**
 * Snapshot of project state signals used by the WhatsNextEvaluator
 * to determine recommended next actions.
 */
export interface ProjectSignals {
  /** Whether MISSION.MD exists on the filesystem */
  missionExists: boolean;
  /** Whether TECH-STACK.MD exists on the filesystem */
  techStandardsExists: boolean;
  /** Whether TEST-STRATEGY.MD exists on the filesystem */
  testStrategyExists: boolean;
  /** Whether any initiatives/epics exist in the product roadmap (DB) */
  roadmapExists: boolean;
  /** Whether the architecture meta-model has meaningful entities (DB) */
  architectureBaselineExists: boolean;
  /** Whether users & interactions domain has been defined (business_users > 0) */
  usersAndInteractionsExists: boolean;
  /** Number of epics in the roadmap */
  epicCount: number;
  /** Number of stories (hardcoded 0 in v1) */
  storyCount: number;
  /** Number of stories with acceptance criteria (hardcoded 0 in v1) */
  storiesWithAC: number;
  /** Number of stories in progress (hardcoded 0 in v1) */
  storiesInProgress: number;
  /** Number of stories done (hardcoded 0 in v1) */
  storiesDone: number;
  /** Number of stories verified (hardcoded 0 in v1) */
  storiesVerified: number;
}

/**
 * Private helper to check file existence via fs.access.
 * Returns true if the file exists and is accessible, false otherwise.
 */
async function fileExists(basePath: string, ...segments: string[]): Promise<boolean> {
  try {
    await fs.access(path.join(basePath, ...segments));
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds a ProjectSignals snapshot by checking filesystem artifacts
 * and querying the architecture-model-service in parallel.
 *
 * All signal sources degrade gracefully: on error, booleans default to false
 * and numbers default to 0. This function never throws.
 *
 * @param projectId - The project ID to compute signals for
 * @returns A complete ProjectSignals snapshot
 */
export async function buildProjectSignals(projectId: string): Promise<ProjectSignals> {
  const projectFolder = await fetchProjectFolder(projectId);
  const basePath = projectFolder || process.cwd();
  const productDir = path.join(basePath, 'agent-os', 'product');

  // Resolve project's Default architecture (Bucket A endpoints require it).
  // Spec 2026-05-01 Multi-Architecture Plumbing - Task Group 3.
  const architectureId = await resolveDefaultArchitectureId(projectId).catch(() => null);

  // Run all signal sources in parallel for performance
  const [
    missionExists,
    techStandardsExists,
    testStrategyExists,
    metaModelResult,
    productSummaryResult,
  ] = await Promise.all([
    fileExists(productDir, 'MISSION.MD').then(found => found || fileExists(productDir, 'mission.md')),
    fileExists(productDir, 'TECH-STACK.MD').then(found => found || fileExists(productDir, 'tech-stack.md')),
    fileExists(productDir, 'TEST-STRATEGY.MD').then(found => found || fileExists(productDir, 'test-strategy.md')),
    architectureId
      ? fetchMetaModelSummary(projectId, architectureId).catch(() => null)
      : Promise.resolve(null),
    fetchProductSummary(projectId).catch(() => null),
  ]);

  // Derive architecture baseline from meta-model summary
  const architectureBaselineExists = metaModelResult != null
    && ((metaModelResult.services?.length || 0)
      + (metaModelResult.data_entities?.length || 0)
      + (metaModelResult.interfaces?.length || 0)) > 0;

  // Derive users & interactions existence from business users
  const usersAndInteractionsExists = metaModelResult != null
    && (metaModelResult.business_users?.length || 0) > 0;

  // Derive roadmap signals from product summary
  const roadmapExists = productSummaryResult != null && hasExistingRoadmap(productSummaryResult);
  const epicCount = productSummaryResult != null ? countRoadmapItems(productSummaryResult).epicCount : 0;

  return {
    missionExists,
    techStandardsExists,
    testStrategyExists,
    roadmapExists,
    architectureBaselineExists,
    usersAndInteractionsExists,
    epicCount,
    // Story-level signals hardcoded to 0 in v1
    storyCount: 0,
    storiesWithAC: 0,
    storiesInProgress: 0,
    storiesDone: 0,
    storiesVerified: 0,
  };
}

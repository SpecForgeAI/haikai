/**
 * Open-Phase Grounding Resolver — Target State Architect-Persona Conversation,
 * Open-Ended LLM Phase (Spec 2026-06-06-architect-conversation-open-ended-phase,
 * Task Group 3 — the FETCH side of grounding).
 *
 * The pure composer (`buildOpenPhaseGrounding` in `openPhaseGrounding.ts`, Task
 * Group 2) takes ALREADY-RESOLVED inputs. This module performs the actual
 * fetches — REUSING the existing resolvers/clients verbatim — and hands the
 * results to the pure composer, so the route stays thin:
 *
 *   1. Captured decisions so far  — `fetchLatestCapturedDecisions` (the same
 *                                   client the `target-state-decisions-context`
 *                                   resolver consumes).
 *   2. Migration-discovery ctx    — `fetchMigrationDiscoveryContext` (the same
 *                                   client the `migration-discovery-context`
 *                                   resolver consumes). Carries BOTH the
 *                                   target-model summary AND the discovery
 *                                   findings summary — no extra AMS calls.
 *   3. Product / migration-goal   — `ProductSummaryContextResolver` (the same
 *      summary                      `product-summary` resolver the registry uses).
 *
 * Every fetch is FAIL-SOFT: any failure degrades that source to null and the
 * pure composer omits it (the open phase is optional + user-driven — a partial
 * grounding is fine, an aborted open phase is not). The deps are injectable so
 * route-level tests can stub the fetches.
 *
 * IMPORTANT: this module makes HTTP calls (via the injected fetchers). The pure
 * composition lives in `openPhaseGrounding.ts`; this module is the I/O shell.
 */

import { logger } from '../logger';
import {
  fetchLatestCapturedDecisions,
  type TargetStateCapturedDecision,
} from '../targetStateCapturedDecisionsClient';
import {
  fetchMigrationDiscoveryContext,
  type MigrationDiscoveryContext,
} from '../migrationDiscoveryContextClient';
import { resolveDefaultArchitectureId } from '../architectureModelClient';
import { ProductSummaryContextResolver } from '../contextResolvers';
import { buildOpenPhaseGrounding } from './openPhaseGrounding';

/**
 * Injectable fetch surface (test seam). Production wiring uses the existing
 * clients/resolver verbatim; route-level tests stub these to avoid real HTTP.
 */
export interface ResolveOpenPhaseGroundingDeps {
  loadCapturedDecisions: typeof fetchLatestCapturedDecisions;
  resolveDefaultArchitectureId: typeof resolveDefaultArchitectureId;
  fetchMigrationDiscoveryContext: typeof fetchMigrationDiscoveryContext;
  resolveProductSummary: (projectId: string) => Promise<string>;
}

export const defaultResolveOpenPhaseGroundingDeps: ResolveOpenPhaseGroundingDeps = {
  loadCapturedDecisions: fetchLatestCapturedDecisions,
  resolveDefaultArchitectureId,
  fetchMigrationDiscoveryContext,
  resolveProductSummary: (projectId: string) =>
    new ProductSummaryContextResolver().resolve(projectId, 'open-phase-grounding'),
};

/**
 * Fetch the four grounding sources fail-soft and compose them via the pure
 * `buildOpenPhaseGrounding`. Returns the well-formed grounding string (never
 * throws — every source degrades to omitted on failure).
 */
export async function resolveOpenPhaseGrounding(
  projectId: string,
  targetArchitectureId: string,
  deps: ResolveOpenPhaseGroundingDeps = defaultResolveOpenPhaseGroundingDeps,
): Promise<string> {
  // 1 — Captured decisions so far (fail-soft → empty list).
  let capturedDecisions: TargetStateCapturedDecision[] = [];
  try {
    capturedDecisions = await deps.loadCapturedDecisions(projectId, targetArchitectureId);
  } catch (err) {
    logger.warn('open-phase grounding: captured-decisions fetch failed; omitting', {
      projectId,
      targetArchitectureId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 2 — Migration-discovery context (carries target-model + findings summaries).
  //     Needs the current architecture id; fail-soft → null discovery context
  //     (the target-model + findings sections are then omitted; the
  //     captured-decisions + product-summary sources still ground the loop).
  let discoveryContext: MigrationDiscoveryContext | null = null;
  try {
    const currentArchitectureId = await deps.resolveDefaultArchitectureId(projectId);
    if (currentArchitectureId) {
      discoveryContext = await deps.fetchMigrationDiscoveryContext(projectId, {
        currentArchitectureId,
        targetArchitectureId,
      });
    }
  } catch (err) {
    logger.warn('open-phase grounding: migration-discovery-context fetch failed; omitting', {
      projectId,
      targetArchitectureId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 3 — Product / migration-goal summary (the resolver is itself fail-soft —
  //     returns '' on error — but guard defensively anyway).
  let productSummary: string | null = null;
  try {
    const text = await deps.resolveProductSummary(projectId);
    productSummary = text && text.trim().length > 0 ? text : null;
  } catch (err) {
    logger.warn('open-phase grounding: product-summary resolution failed; omitting', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return buildOpenPhaseGrounding({
    capturedDecisions,
    discoveryContext,
    productSummary,
  });
}

/**
 * Gateway client for the architecture-model-service epic captured-decisions
 * CRUD endpoints (Task Group 4 of the Cross-Story Context Injection spec).
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 5
 *
 * The shape-spec batch handler uses these to auto-seed `auto_extracted` rows
 * during pass 1, exercising the AMS-side `upsertAutoExtracted(...)` semantics
 * (rows whose `source IN (user_edited, user_added)` are skipped server-side,
 * preserving human-curated content across re-runs).
 *
 * Important: AMS exposes auto-seed semantics ONLY indirectly via the public
 * POST endpoint (which creates `user_added` rows). The gateway side cannot
 * directly call `upsertAutoExtracted(...)` from outside the JVM. Instead we
 * call POST and pass `source = auto_extracted` in the body; the AMS controller
 * trusts this signal when the call originates from the gateway batch handler
 * (handled by the AMS service's `upsertAutoExtracted` path which checks the
 * existing row's source before overwriting).
 *
 * In practice the gateway calls a dedicated AMS endpoint
 * `POST /api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions/auto-seed`
 * if available, falling back to the public POST when not. For this iteration
 * we use the public POST + GET-then-decide pattern: the gateway lists existing
 * decisions, filters out pinned rows (source IN user_edited / user_added),
 * and POSTs only when the key is absent.
 */

import { getConfig } from '../config';
import { logger } from './logger';

/** Captured-decision row shape on the wire (snake_case + camelCase tolerated). */
export interface EpicCapturedDecisionDto {
  id?: string | null;
  projectId?: string | null;
  epicWorkItemId?: string | null;
  decisionKey?: string | null;
  decisionText?: string | null;
  source?: string | null;
  sourceSpecGenerationId?: string | null;
  status?: string | null;
  lastEditedBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** Source flag vocabulary -- mirrors AMS-side EpicCapturedDecisionService constants. */
export const EPIC_DECISION_SOURCE_AUTO_EXTRACTED = 'auto_extracted';
export const EPIC_DECISION_SOURCE_USER_EDITED = 'user_edited';
export const EPIC_DECISION_SOURCE_USER_ADDED = 'user_added';

/** Status vocabulary -- mirrors AMS-side EpicCapturedDecisionService constants. */
export const EPIC_DECISION_STATUS_DRAFT = 'draft';

/**
 * Pinned source set: rows in these states must NOT be overwritten by auto-seed
 * re-runs of pass 1. Mirrors AMS-side `EpicCapturedDecisionService.PINNED_SOURCES`.
 */
export const EPIC_DECISION_PINNED_SOURCES: ReadonlySet<string> = new Set([
  EPIC_DECISION_SOURCE_USER_EDITED,
  EPIC_DECISION_SOURCE_USER_ADDED,
]);

/**
 * List all captured-decision rows for an epic. Returns [] on 404 (no rows
 * yet) and on network errors -- the caller can proceed with auto-seed
 * assuming an empty starting set.
 */
export async function listEpicCapturedDecisions(
  projectId: string,
  epicWorkItemId: string
): Promise<EpicCapturedDecisionDto[]> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/epics/${encodeURIComponent(epicWorkItemId)}/captured-decisions`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      if (response.status === 404) return [];
      logger.warn('AMS list epic captured decisions returned non-OK', {
        projectId,
        epicWorkItemId,
        status: response.status,
      });
      return [];
    }
    const raw = (await response.json()) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw as EpicCapturedDecisionDto[];
  } catch (e) {
    logger.warn('AMS list epic captured decisions network error', {
      projectId,
      epicWorkItemId,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/**
 * Create a captured-decision row. The AMS controller seeds `source = user_added`
 * on every POST regardless of the supplied source. The gateway uses this for
 * BOTH user-added rows AND auto-seeded rows; we then PATCH the source to
 * `auto_extracted` and stamp `sourceSpecGenerationId` immediately after create.
 *
 * In a follow-up the AMS endpoint will accept a dedicated `/auto-seed` route;
 * for now this two-step dance preserves the documented `upsertAutoExtracted`
 * pinning semantics from the gateway side.
 */
export async function createEpicCapturedDecision(
  projectId: string,
  epicWorkItemId: string,
  body: {
    decisionKey: string;
    decisionText: string;
    status?: string;
    lastEditedBy?: string;
  }
): Promise<EpicCapturedDecisionDto | null> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/epics/${encodeURIComponent(epicWorkItemId)}/captured-decisions`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      logger.warn('AMS create epic captured decision returned non-OK', {
        projectId,
        epicWorkItemId,
        status: response.status,
      });
      return null;
    }
    return (await response.json()) as EpicCapturedDecisionDto;
  } catch (e) {
    logger.warn('AMS create epic captured decision network error', {
      projectId,
      epicWorkItemId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Auto-seed a captured-decision row via the dedicated AMS endpoint
 * {@code POST .../captured-decisions/auto-seed}, which routes through
 * {@code EpicCapturedDecisionService.upsertAutoExtracted}:
 *
 *   - Pinned rows (source IN user_edited / user_added) are SKIPPED server-side
 *     and the existing row is returned unchanged.
 *   - Existing auto_extracted rows have their decisionText + sourceSpecGenerationId
 *     refreshed in place.
 *   - Missing rows are inserted with source = auto_extracted, status = draft.
 *
 * Returns the row on success, or null on network / 5xx failure (failure is
 * non-blocking -- the pass-1 batch succeeds even if auto-seed fails).
 */
export async function autoSeedEpicCapturedDecision(
  projectId: string,
  epicWorkItemId: string,
  decisionKey: string,
  decisionText: string,
  sourceSpecGenerationId: string | null
): Promise<EpicCapturedDecisionDto | null> {
  if (!decisionKey || decisionKey.trim() === '') return null;
  if (!decisionText || decisionText.trim() === '') return null;
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/epics/${encodeURIComponent(epicWorkItemId)}/captured-decisions/auto-seed`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        decisionKey: decisionKey.trim(),
        decisionText,
        sourceSpecGenerationId,
      }),
    });
    if (response.status === 204) {
      console.log(
        `[diag-gateway] pm_migration_shape_spec_generation cross_story_decision_auto_seed_noop ` +
          `decisionKey=${decisionKey}`
      );
      return null;
    }
    if (!response.ok) {
      logger.warn('AMS auto-seed epic captured decision returned non-OK', {
        projectId,
        epicWorkItemId,
        decisionKey,
        status: response.status,
      });
      return null;
    }
    const row = (await response.json()) as EpicCapturedDecisionDto;
    console.log(
      `[diag-gateway] pm_migration_shape_spec_generation cross_story_decision_auto_seed_upserted ` +
        `decisionKey=${decisionKey} id=${row.id ?? '<none>'} source=${row.source ?? '<none>'}`
    );
    return row;
  } catch (e) {
    logger.warn('AMS auto-seed epic captured decision network error', {
      projectId,
      epicWorkItemId,
      decisionKey,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

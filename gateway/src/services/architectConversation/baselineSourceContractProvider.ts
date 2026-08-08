/**
 * Production `SourceContractProvider` for the API like-for-like lock
 * (Spec 2026-06-24-target-conversation-tech-stack-constraints, FR9).
 *
 * `apiSurfaceLock.ts` defines the lock mechanism but ships only a hard-wired
 * `defaultSourceContractProvider` (`hasReconciledBaseline: () => false`). This
 * module is the thin, INJECTABLE production reader that wires the lock over the
 * EXISTING gateway AMS read for the pinned current-state API Behaviour Baseline
 * (`fetchActiveCurrentBaseline` in `migrationDriverAmsReads.ts`).
 *
 * --------------------------------------------------------------------------
 * DATA-SOURCE REALITY (updated 2026-08-08 — the lock is LIVE)
 * --------------------------------------------------------------------------
 * The six Group B values now DERIVE deterministically from the baseline's
 * raw captured samples via apiSurfaceDerivation.ts (content-types, paths,
 * auth headers, 4xx bodies, rate-limit headers) — evidence-counted, with
 * provenance on every value; ambiguous codes are OMITTED so their questions
 * are still asked. The historical context below records the original gap.
 * --------------------------------------------------------------------------
 * The lock needs TWO things from the source contract:
 *
 *   (1) DOES a reconciled current baseline exist?  -> drives the like_for_like
 *       default (FR9).  A gateway read FOR THIS EXISTS: `fetchActiveCurrentBaseline`
 *       returns the active `kind='current'` baseline (or null).
 *
 *   (2) The six DERIVED Group B answer VALUES (api.protocol, api.versioning,
 *       api.contractFormat, api.auth, api.errorContract, api.rateLimiting) so
 *       each question can be auto-answered + suppressed.  NO read yields these.
 *
 * The `api_behaviour_baselines` row + its `api_behaviour_baseline_items` carry
 * RAW captured HTTP samples (method / path / request_json / response_json), NOT
 * the six derived API-surface classifications. Deriving "REST/JSON", "URL-path
 * versioning", "RFC 7807 errors", etc. from raw samples IS the reconciliation /
 * inference engine — which the lock's own SCOPE note forbids this module from
 * rebuilding. There is no AMS endpoint that returns the derived values, so the
 * per-code value map is EMPTY today and the lock DEGRADES to asking Group B
 * exactly as before (no regression).
 *
 * Consequently `hasReconciledBaseline()` is gated on actually HAVING derived
 * values to lock from — baseline existence ALONE is deliberately NOT enough.
 * Flipping the mode to like_for_like with zero values would only emit six
 * "baseline gap" warnings per open and suppress nothing, i.e. a behaviour change
 * with no benefit. Returning `false` keeps the walk identical to today.
 *
 * --------------------------------------------------------------------------
 * FORWARD POINTER (how to light this up)
 * --------------------------------------------------------------------------
 * When an AMS read that returns the six DERIVED Group B values for the current
 * baseline is specced, populate `snapshot.groupBValues` in
 * `resolveBaselineSourceContractSnapshot` from it. Everything downstream
 * (mode default, auto-answer write, suppression, the route wiring, the tests)
 * then activates with ZERO further route changes — the only missing piece is the
 * derived-values read. (Note also: reading the CURRENT baseline needs the
 * CURRENT architecture id; the conversation route currently carries only the
 * TARGET architecture id, so resolving the workspace's current-architecture id
 * is a second prerequisite for the existence read to match real data.)
 */

import {
  fetchActiveCurrentBaseline as defaultFetchActiveCurrentBaseline,
  fetchBaselineItems as defaultFetchBaselineItems,
  type ApiBehaviourBaseline,
} from '../migrationDriverAmsReads';
import { resolveDefaultArchitectureId as defaultResolveDefaultArchitectureId } from '../architectureModelClient';
import { deriveGroupBValues } from './apiSurfaceDerivation';
import { logger } from '../logger';
import { LOCKABLE_GROUP_B_CODES } from '../../config/architect-conversation/apiSurfaceMode';
import type {
  SourceContractProvider,
  SourceContractValue,
} from './apiSurfaceLock';

/**
 * A point-in-time read of the source contract / current baseline, resolved
 * ASYNCHRONOUSLY at the route layer and handed to the SYNCHRONOUS provider the
 * lock consumes. Caching the read here keeps `SourceContractProvider`'s
 * `hasReconciledBaseline()` / `readGroupBValue()` pure + synchronous (as the
 * lock's interface requires) while the underlying AMS call is async.
 */
export interface BaselineSourceContractSnapshot {
  /** True iff an active `kind='current'` baseline was found for the architecture. */
  baselinePresent: boolean;
  /** The resolved current-baseline id (provenance / logging), or null. */
  baselineId: string | null;
  /**
   * Per-Group-B-code DERIVED values read from the source contract. EMPTY today
   * (no derived-values read exists — see the file header). When a derived-values
   * AMS read is specced, populate this map to light up the lock.
   */
  groupBValues: Record<string, SourceContractValue>;
}

/** Injectable deps for the snapshot resolver (test seam). */
export interface ResolveBaselineSourceContractDeps {
  fetchActiveCurrentBaseline: typeof defaultFetchActiveCurrentBaseline;
  /** 2026-08-08: the raw-sample read feeding the deterministic derivation. */
  fetchBaselineItems?: typeof defaultFetchBaselineItems;
  /**
   * 2026-08-08: baselines hang off the CURRENT-state architecture; the
   * conversation route only carries the TARGET id. The Default architecture
   * (oldest non-archived — the established dashboard/discovery rule) IS the
   * current-state model.
   */
  resolveCurrentArchitectureId?: typeof defaultResolveDefaultArchitectureId;
}

export const defaultResolveBaselineSourceContractDeps: ResolveBaselineSourceContractDeps = {
  fetchActiveCurrentBaseline: defaultFetchActiveCurrentBaseline,
  fetchBaselineItems: defaultFetchBaselineItems,
  resolveCurrentArchitectureId: defaultResolveDefaultArchitectureId,
};

/**
 * Resolve the source-contract snapshot for an architecture. NON-BLOCKING: any
 * baseline-read failure is caught + logged and degrades to "no baseline" so the
 * conversation never crashes and Group B is asked normally.
 */
export async function resolveBaselineSourceContractSnapshot(
  projectId: string,
  architectureId: string,
  deps: ResolveBaselineSourceContractDeps = defaultResolveBaselineSourceContractDeps,
): Promise<BaselineSourceContractSnapshot> {
  let baseline: ApiBehaviourBaseline | null = null;
  try {
    // Baselines hang off the CURRENT-state architecture; the conversation
    // passes the TARGET id (2026-08-08 fix — the read previously looked up
    // the wrong architecture and always found nothing). Resolve the Default
    // (oldest non-archived = current-state) and fall back to the passed id.
    const resolveCurrent =
      deps.resolveCurrentArchitectureId ?? defaultResolveDefaultArchitectureId;
    const currentArchitectureId = (await resolveCurrent(projectId)) ?? architectureId;
    baseline = await deps.fetchActiveCurrentBaseline(projectId, currentArchitectureId);
  } catch (err) {
    // Fail-soft: a baseline-read failure must never crash the conversation; it
    // degrades to asking Group B as today.
    logger.warn(
      'api-surface-lock: current-baseline read failed; degrading to ASK (Group B unchanged)',
      {
        projectId,
        architectureId,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    baseline = null;
  }

  const baselinePresent = baseline !== null;

  // CONV.07 CLOSED (2026-08-08): the six Group B values derive
  // DETERMINISTICALLY from the baseline's raw captured samples (see
  // apiSurfaceDerivation.ts) — no LLM, no new AMS endpoint. Codes without
  // positive observation are OMITTED (their questions are asked normally),
  // never guessed. Fail-soft: a derivation failure degrades to ASK.
  let groupBValues: Record<string, SourceContractValue> = {};
  if (baselinePresent && baseline?.id) {
    try {
      const fetchItems = deps.fetchBaselineItems ?? defaultFetchBaselineItems;
      const items = await fetchItems(projectId, baseline.id);
      const derivation = deriveGroupBValues(items, baseline.id);
      groupBValues = derivation.values;
      logger.info('api-surface-lock: Group B values derived from the baseline samples', {
        projectId,
        baselineId: baseline.id,
        itemCount: derivation.itemCount,
        derivedCodes: Object.keys(derivation.values).sort(),
        omitted: derivation.omitted,
      });
    } catch (err) {
      logger.warn(
        'api-surface-lock: Group B derivation failed; degrading to ASK (Group B unchanged)',
        {
          projectId,
          baselineId: baseline?.id ?? null,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      groupBValues = {};
    }
  }

  if (baselinePresent && Object.keys(groupBValues).length === 0) {
    logger.info(
      'api-surface-lock: current baseline present but no Group B value could be derived from its samples; degrading to ASK',
      {
        projectId,
        architectureId,
        baselineId: baseline?.id ?? null,
        lockableCodes: [...LOCKABLE_GROUP_B_CODES],
      },
    );
  }

  return {
    baselinePresent,
    baselineId: baseline?.id ?? null,
    groupBValues,
  };
}

/**
 * Build the SYNCHRONOUS `SourceContractProvider` the lock consumes from a
 * resolved snapshot.
 *
 * `hasReconciledBaseline()` is intentionally gated on HAVING derived values to
 * lock from — baseline existence alone is not enough (see the file header). With
 * no values it returns false and the lock no-ops (Group B asked normally).
 */
export function makeSourceContractProvider(
  snapshot: BaselineSourceContractSnapshot,
): SourceContractProvider {
  return {
    hasReconciledBaseline: () => Object.keys(snapshot.groupBValues).length > 0,
    readGroupBValue: (decisionCode: string): SourceContractValue | undefined =>
      snapshot.groupBValues[decisionCode],
  };
}

/**
 * Convenience: resolve the snapshot and return a ready provider. This is the
 * single production entry point the architect-conversation route wires.
 */
export async function resolveBaselineSourceContractProvider(
  projectId: string,
  architectureId: string,
  deps: ResolveBaselineSourceContractDeps = defaultResolveBaselineSourceContractDeps,
): Promise<SourceContractProvider> {
  const snapshot = await resolveBaselineSourceContractSnapshot(
    projectId,
    architectureId,
    deps,
  );
  return makeSourceContractProvider(snapshot);
}

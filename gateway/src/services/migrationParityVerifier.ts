/**
 * Migration Parity Verifier (Spec 2026-07-06-i — Parity Verify Loop &
 * Execution Gates, Code-Tier Oracle Program).
 *
 * Turns "same request → same response" from acceptance-criterion prose into a
 * machine verdict. Three entry points, all built on the EXISTING headless
 * reconcile lifecycle (`runHeadlessReconcile` — create target session → push
 * in-memory secrets → scoped start → poll → read diff items):
 *
 *   - {@link runScopedParityVerify} — a per-story scoped replay+diff against
 *     the deployed target (`endpoint_scope` from the story's committed
 *     endpoints; the diff row carries the scope as its audit blob).
 *   - {@link runBaselineDriftCheck} — the SAME machinery pointed at the
 *     CURRENT system's own base URL (`purpose: 'drift_check'`): drift means
 *     the legacy behaviour changed since capture (or volatility was
 *     under-modelled) — the pinned oracle is rotting and must be re-captured
 *     or waived.
 *   - {@link evaluateParityVerdict} — the pure verdict over diff items:
 *     FAIL-CLOSED (`clean=false` on transport failures, zero replayed, or
 *     unreadable state), state parity folded in (Spec N: `state_unverified`
 *     is UNCLEAN), per-break waivers consumed from the durable
 *     `api_behaviour_comparison_waivers` table (dimension
 *     `break_fingerprint`, built forward-compatible by Spec J).
 *
 * Credentials: the target auth config is per-invocation, held in memory,
 * pushed ONLY into the validation service's in-memory secretsStore — never
 * persisted, never logged (the Spec E credentials pattern).
 */

import { logger } from './logger';
import { getConfig } from '../config';
import {
  ReconciliationDiffItem,
  ReconciliationPollOptions,
  ReconciliationValidationDeps,
  defaultReconciliationValidationDeps,
  isDiffItemABreak,
  runHeadlessReconcile,
} from './migrationReconciliationValidationClient';
import type {
  TargetApiAuthSecret,
  TargetDbSecret,
} from './migrationTargetCredentialsStore';

// ---------------------------------------------------------------------------
// Verdict types
// ---------------------------------------------------------------------------

/** One confirmed (unwaived) parity break, serialisable for the repair loop. */
export interface ParityBreak {
  /** Stable waiver fingerprint: `${METHOD} ${path}::${scenario}::${kind}`. */
  fingerprint: string;
  method: string;
  path: string;
  scenarioName: string;
  /** The dominant break kind (status/body/header/state/byte classification). */
  kind: string;
  sourceStatus: number | null;
  targetStatus: number | null;
  /** The persisted comparator detail blob (paths/pointers/state detail). */
  detail: Record<string, unknown> | null;
  diffItemId: string;
}

/** A waived break — visible on the verdict, never silently dropped. */
export interface WaivedParityBreak extends ParityBreak {
  waiverId: string;
  waiverReason: string;
}

export interface ParityVerdict {
  /**
   * TRUE only when the run completed AND at least one item was compared AND
   * zero unwaived breaks remain. FAIL CLOSED: transport failures,
   * zero-replayed, unreadable state, and `state_unverified` are all NOT
   * clean.
   */
  clean: boolean;
  /** TRUE when clean was reached only via waivers (recorded below). */
  cleanWithWaivers: boolean;
  breaks: ParityBreak[];
  waivedBreaks: WaivedParityBreak[];
  coverage: {
    compared: number;
    breaks: number;
    waived: number;
    sourceOnly: number;
    stateUnverified: number;
  };
  /** Why the verdict is unclean when no break list explains it. */
  reason: string | null;
  diffId: string | null;
  targetBaselineId: string | null;
  /** The scope this verdict covers; null = FULL surface. */
  endpointScope: string[] | null;
}

// ---------------------------------------------------------------------------
// Break-fingerprint waivers (AMS comparison-waivers, dimension
// 'break_fingerprint' — the table Spec J built forward-compatible for I)
// ---------------------------------------------------------------------------

export interface BreakFingerprintWaiver {
  id: string;
  target: string;
  reason: string;
}

/**
 * Fetch the project's break-fingerprint waivers from AMS. Fail-soft to an
 * empty list (no waivers) — a fetch failure can only make the verdict
 * STRICTER, never looser.
 */
export async function fetchBreakFingerprintWaivers(
  projectId: string,
): Promise<BreakFingerprintWaiver[]> {
  try {
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/api-behaviour/comparison-waivers`;
    const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!response.ok) return [];
    const rows = (await response.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r) => r && r.dimension === 'break_fingerprint' && typeof r.target === 'string')
      .map((r) => ({
        id: String(r.id ?? ''),
        target: String(r.target),
        reason: String(r.reason ?? ''),
      }));
  } catch (error) {
    logger.warn('[diag-gateway] migration_parity waiver_fetch_failed', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// The pure verdict
// ---------------------------------------------------------------------------

/** Stable per-break fingerprint consumed by the waiver match. */
export function breakFingerprint(item: ReconciliationDiffItem): string {
  const method = (item.method ?? 'GET').toUpperCase();
  const path = item.path ?? '/';
  const scenario = item.scenario_name ?? '';
  return `${method} ${path}::${scenario}::${dominantBreakKind(item)}`;
}

/** The single kind label carried on the break (state > byte > header > status/body). */
function dominantBreakKind(item: ReconciliationDiffItem): string {
  const blob = (item.body_diff_json ?? {}) as Record<string, unknown>;
  const state = typeof blob.state_classification === 'string' ? blob.state_classification : null;
  if (state === 'state_drift' || state === 'state_unverified') return state;
  const byte = typeof blob.byte_classification === 'string' ? blob.byte_classification : null;
  if (byte === 'byte_drift') return 'byte_drift';
  const header = item.header_classification ?? null;
  if (header !== null && header !== 'header_match') return header;
  const status = item.status_classification ?? '';
  if (status !== 'status_match') return status || 'unclassified';
  const body = item.body_classification ?? null;
  if (body !== null && body !== 'body_match') return body;
  return 'unclassified';
}

function toParityBreak(item: ReconciliationDiffItem): ParityBreak {
  return {
    fingerprint: breakFingerprint(item),
    method: (item.method ?? 'GET').toUpperCase(),
    path: item.path ?? '/',
    scenarioName: item.scenario_name ?? '',
    kind: dominantBreakKind(item),
    sourceStatus: item.source_response_status ?? null,
    targetStatus: item.target_response_status ?? null,
    detail: item.body_diff_json ?? null,
    diffItemId: item.id,
  };
}

/**
 * Evaluate the FAIL-CLOSED parity verdict over a completed run's diff items.
 *
 * @param runOk    FALSE when the underlying replay/diff lifecycle failed
 *                 (session failed / timeout / unreadable) — always unclean.
 * @param runError the lifecycle failure reason for the verdict's `reason`.
 */
export function evaluateParityVerdict(params: {
  runOk: boolean;
  runError?: string | null;
  diffItems: ReconciliationDiffItem[];
  waivers: BreakFingerprintWaiver[];
  diffId?: string | null;
  targetBaselineId?: string | null;
  endpointScope?: string[] | null;
}): ParityVerdict {
  const endpointScope = params.endpointScope ?? null;
  const base = {
    diffId: params.diffId ?? null,
    targetBaselineId: params.targetBaselineId ?? null,
    endpointScope,
  };

  // FAIL CLOSED: an unreadable / failed lifecycle is never clean.
  if (!params.runOk) {
    return {
      ...base,
      clean: false,
      cleanWithWaivers: false,
      breaks: [],
      waivedBreaks: [],
      coverage: { compared: 0, breaks: 0, waived: 0, sourceOnly: 0, stateUnverified: 0 },
      reason: params.runError ?? 'parity run failed (unreadable state)',
    };
  }

  // FAIL CLOSED: zero compared items means NOTHING was verified — an empty
  // scope match or an empty baseline must not read as clean.
  if (params.diffItems.length === 0) {
    return {
      ...base,
      clean: false,
      cleanWithWaivers: false,
      breaks: [],
      waivedBreaks: [],
      coverage: { compared: 0, breaks: 0, waived: 0, sourceOnly: 0, stateUnverified: 0 },
      reason: 'zero items replayed/compared — nothing was verified',
    };
  }

  const waiverByFingerprint = new Map(params.waivers.map((w) => [w.target, w]));
  const breaks: ParityBreak[] = [];
  const waivedBreaks: WaivedParityBreak[] = [];
  let sourceOnly = 0;
  let stateUnverified = 0;

  for (const item of params.diffItems) {
    if (!isDiffItemABreak(item)) continue;
    const asBreak = toParityBreak(item);
    if (asBreak.kind === 'source_only') sourceOnly += 1;
    if (asBreak.kind === 'state_unverified') stateUnverified += 1;
    const waiver = waiverByFingerprint.get(asBreak.fingerprint);
    if (waiver) {
      waivedBreaks.push({ ...asBreak, waiverId: waiver.id, waiverReason: waiver.reason });
    } else {
      breaks.push(asBreak);
    }
  }

  const clean = breaks.length === 0;
  return {
    ...base,
    clean,
    cleanWithWaivers: clean && waivedBreaks.length > 0,
    breaks,
    waivedBreaks,
    coverage: {
      compared: params.diffItems.length,
      breaks: breaks.length,
      waived: waivedBreaks.length,
      sourceOnly,
      stateUnverified,
    },
    reason: clean ? null : `${breaks.length} unwaived parity break(s)`,
  };
}

// ---------------------------------------------------------------------------
// The verify runs (scoped parity + drift check)
// ---------------------------------------------------------------------------

export interface ParityVerifyDeps {
  validationDeps?: ReconciliationValidationDeps;
  fetchWaivers?: typeof fetchBreakFingerprintWaivers;
  pollOptions?: ReconciliationPollOptions;
}

/**
 * Run ONE scoped parity verify against a deployed target and return the
 * FAIL-CLOSED verdict. The target auth is per-invocation and in-memory only
 * (pushed to the validation service's secretsStore; never persisted here).
 */
export async function runScopedParityVerify(
  args: {
    projectId: string;
    architectureId: string;
    sourceBaselineId: string;
    targetBaseUrl: string;
    api: TargetApiAuthSecret;
    /** `"METHOD /path/template"` keys; null = FULL-surface verify. */
    endpointScope: string[] | null;
    /** OPTIONAL target-DB creds (Spec N, Tier-1 batch) — state snapshots. */
    db?: TargetDbSecret | null;
  },
  deps: ParityVerifyDeps = {},
): Promise<ParityVerdict> {
  const validationDeps = deps.validationDeps ?? defaultReconciliationValidationDeps();
  const fetchWaivers = deps.fetchWaivers ?? fetchBreakFingerprintWaivers;

  const result = await runHeadlessReconcile(
    {
      projectId: args.projectId,
      architectureId: args.architectureId,
      sourceBaselineId: args.sourceBaselineId,
      targetBaseUrl: args.targetBaseUrl,
      api: args.api,
      endpointScope: args.endpointScope,
      purpose: 'parity',
      db: args.db ?? null,
    },
    validationDeps,
    deps.pollOptions ?? {},
  );

  const waivers = await fetchWaivers(args.projectId);
  const verdict = evaluateParityVerdict({
    runOk: result.ok,
    runError: result.error,
    diffItems: result.diffItems,
    waivers,
    diffId: result.diffId,
    targetBaselineId: result.targetBaselineId,
    endpointScope: args.endpointScope,
  });

  logger.info('[diag-gateway] migration_parity verdict', {
    projectId: args.projectId,
    diffId: verdict.diffId,
    scoped: !!(args.endpointScope && args.endpointScope.length > 0),
    clean: verdict.clean,
    cleanWithWaivers: verdict.cleanWithWaivers,
    breaks: verdict.coverage.breaks,
    waived: verdict.coverage.waived,
    stateUnverified: verdict.coverage.stateUnverified,
  });
  return verdict;
}

/**
 * Baseline behavioural-drift check (Spec I amendment §6): the scoped-replay
 * machinery pointed at the CURRENT system's own base URL, diffing against
 * the pinned baseline. Breaks here mean the LEGACY behaviour changed since
 * capture (or volatility was under-modelled — the volatility envelope
 * disambiguates). The diff row is tagged `purpose: 'drift_check'` so the
 * gate can find the latest drift verdict. Waivers do NOT apply — drift is a
 * property of the oracle, not the target; re-capture or waive at the gate.
 */
export async function runBaselineDriftCheck(
  args: {
    projectId: string;
    architectureId: string;
    sourceBaselineId: string;
    /** The CURRENT (legacy) system's base URL — not the migration target. */
    currentBaseUrl: string;
    api: TargetApiAuthSecret;
    /** OPTIONAL current-DB creds — state deltas on the drift replay. */
    db?: TargetDbSecret | null;
  },
  deps: ParityVerifyDeps = {},
): Promise<ParityVerdict> {
  const validationDeps = deps.validationDeps ?? defaultReconciliationValidationDeps();

  const result = await runHeadlessReconcile(
    {
      projectId: args.projectId,
      architectureId: args.architectureId,
      sourceBaselineId: args.sourceBaselineId,
      targetBaseUrl: args.currentBaseUrl,
      api: args.api,
      endpointScope: null,
      purpose: 'drift_check',
      db: args.db ?? null,
    },
    validationDeps,
    deps.pollOptions ?? {},
  );

  const verdict = evaluateParityVerdict({
    runOk: result.ok,
    runError: result.error,
    diffItems: result.diffItems,
    waivers: [], // drift is never waived at the break level
    diffId: result.diffId,
    targetBaselineId: result.targetBaselineId,
    endpointScope: null,
  });

  logger.info('[diag-gateway] migration_parity drift_check', {
    projectId: args.projectId,
    diffId: verdict.diffId,
    clean: verdict.clean,
    breaks: verdict.coverage.breaks,
  });
  return verdict;
}

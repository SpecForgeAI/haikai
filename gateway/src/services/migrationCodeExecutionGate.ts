/**
 * Code-tier readiness + completion gate for the Migration Execution Driver
 * (Spec 2026-07-06-i — Parity Verify Loop & Execution Gates, Code-Tier
 * Oracle Program). Mirrors the DB-pack gate architecture
 * (`migrationDbExecutionGate.ts`, gate-4b stacking, FAIL-CLOSED).
 *
 * PRE-DISPATCH (gate 4c, stacks with `evaluateHardBlock` + the DB gate):
 *   - `code_baseline_unpinned`      — no active pinned current baseline.
 *   - `code_baseline_missing`       — an in-scope story's committed endpoint
 *     has no accepted baseline coverage (stories FLAGGED `missing_baseline`
 *     at plan time are exempt: their spec already says "no parity oracle" and
 *     the paired capture story's job is to create it).
 *   - `code_coverage_floor_unmet`   — the pinned baseline's persisted
 *     coverage summary fails Spec K's floor.
 *   - `code_gate_read_failed`       — FAIL CLOSED on unreadable state.
 *
 * COMPLETION (consumed by the run readiness surface + the reconcile tail):
 *   - `code_parity_unverified` — no completed parity diff covers the story's
 *     endpoints (or the run state is unreadable). FAIL CLOSED.
 *   - `code_parity_broken`     — the latest covering diff has unwaived breaks
 *     inside the story's endpoint scope.
 *   - Closure requires a FULL-surface (UNSCOPED) clean diff — a scoped-clean
 *     diff is REJECTED (the diff row's `endpoint_scope_json` audit blob makes
 *     this checkable; AMS changeset 208).
 *
 * BASELINE DRIFT (amendment §6 — the live legacy keeps running while
 * migration proceeds, so the oracle can silently rot):
 *   - `baseline_drift_unchecked`  — no drift-check run within the max age
 *     (default 14 days). WARNING level (configurable, non-blocking by
 *     default at the caller's discretion).
 *   - `baseline_behaviour_drift`  — the latest drift-check diff has breaks:
 *     the CURRENT system no longer matches the pinned baseline. BLOCKING
 *     until re-captured or waived.
 */

import { getConfig } from '../config';
import { logger } from './logger';
import {
  CODE_PROVENANCE_TAG,
  MANUAL_GATE_TAG,
} from './migrationCodeStreamPlanner';
import {
  fetchEndpointBaselineCoverageRows,
  type EndpointBaselineCoverageRow,
} from './apiBehaviourBaselineCoverageClient';
import {
  CoverageSummaryJson,
  evaluateCoverageFloor,
} from './apiBehaviourCoverageFloor';
import {
  ReconciliationDiffItem,
  isDiffItemABreak,
} from './migrationReconciliationValidationClient';
import {
  BreakFingerprintWaiver,
  breakFingerprint,
} from './migrationParityVerifier';
import type { BookOfWorkItem } from './migrationDriverAmsReads';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodeGateReason {
  code:
    | 'code_baseline_missing'
    | 'code_baseline_unpinned'
    | 'code_coverage_floor_unmet'
    | 'code_gate_read_failed'
    | 'code_parity_unverified'
    | 'code_parity_broken'
    | 'baseline_drift_unchecked'
    | 'baseline_behaviour_drift';
  message: string;
  workItemId?: string | null;
}

export interface CodeGateResult {
  ok: boolean;
  reasons: CodeGateReason[];
}

/** A completed diff row as the gate reads it (AMS by-target read). */
export interface GateDiffRow {
  id: string;
  status: string | null;
  computed_at?: string | null;
  endpoint_scope_json?: Record<string, unknown> | null;
}

export interface CodeGateReads {
  /**
   * RAW coverage rows (endpoint id + baseline id + method/path). The gate
   * derives BOTH the covered-id map (code_baseline_missing) and the
   * endpoint-id → key map that scopes the floor evaluation to in-scope
   * stories (Tier-1 batch).
   */
  fetchEndpointBaselineCoverageRows: typeof fetchEndpointBaselineCoverageRows;
  /** The pinned baseline's session coverage summary; null = none persisted. */
  fetchCoverageSummaryForBaseline(
    projectId: string,
    baselineId: string,
  ): Promise<CoverageSummaryJson | null>;
  /** Every diff whose SOURCE is the pinned baseline (via its target baselines). */
  listDiffsForBaseline(projectId: string, sourceBaselineId: string): Promise<GateDiffRow[]>;
  listDiffItems(projectId: string, diffId: string): Promise<ReconciliationDiffItem[]>;
}

/** The API-parity code streams THIS gate covers (internal stream is gated by
 * Spec M's internal-job oracle, not response parity — exempt here). */
const API_PARITY_STREAM_TAGS = new Set([
  // Spec V (2026-07-17): REST + SOAP merged into one api_migration stream.
  'stream:api_migration',
  // Pre-reframe stream tags — retained so plans built before Spec V still
  // resolve to API-parity applicability.
  'stream:target_service_api_implementation',
  'stream:api_soap_integration_compatibility',
]);

// ---------------------------------------------------------------------------
// Default reads (direct AMS)
// ---------------------------------------------------------------------------

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function defaultCodeGateReads(): CodeGateReads {
  const amsBase = () => getConfig().architectureModelServiceBaseUrl;
  return {
    fetchEndpointBaselineCoverageRows,

    async fetchCoverageSummaryForBaseline(projectId, baselineId) {
      const baselineUrl =
        `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
        `/api-behaviour/baselines/${encodeURIComponent(baselineId)}`;
      const baselineResponse = await fetch(baselineUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!baselineResponse.ok) {
        throw new Error(`baseline read failed (status ${baselineResponse.status})`);
      }
      const baseline = (await readJson(baselineResponse)) as { session_id?: string | null } | null;
      if (!baseline?.session_id) return null;
      const sessionUrl =
        `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
        `/api-behaviour/capture-sessions/${encodeURIComponent(baseline.session_id)}`;
      const sessionResponse = await fetch(sessionUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!sessionResponse.ok) {
        throw new Error(`capture session read failed (status ${sessionResponse.status})`);
      }
      const session = (await readJson(sessionResponse)) as {
        coverage_summary_json?: CoverageSummaryJson | null;
      } | null;
      return session?.coverage_summary_json ?? null;
    },

    async listDiffsForBaseline(projectId, sourceBaselineId) {
      const targetsUrl =
        `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
        `/api-behaviour/baselines/${encodeURIComponent(sourceBaselineId)}/target-baselines`;
      const targetsResponse = await fetch(targetsUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!targetsResponse.ok) {
        throw new Error(`target-baselines read failed (status ${targetsResponse.status})`);
      }
      const targets = ((await readJson(targetsResponse)) ?? []) as Array<{ id?: string }>;
      const diffs: GateDiffRow[] = [];
      for (const target of Array.isArray(targets) ? targets : []) {
        if (!target?.id) continue;
        const diffUrl =
          `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
          `/api-behaviour/diffs/by-target/${encodeURIComponent(target.id)}`;
        const diffResponse = await fetch(diffUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (diffResponse.status === 404) continue;
        if (!diffResponse.ok) {
          throw new Error(`diff by-target read failed (status ${diffResponse.status})`);
        }
        const diff = (await readJson(diffResponse)) as GateDiffRow | null;
        if (diff?.id) diffs.push(diff);
      }
      return diffs;
    },

    async listDiffItems(projectId, diffId) {
      const url =
        `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
        `/api-behaviour/diffs/${encodeURIComponent(diffId)}/items`;
      const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!response.ok) {
        throw new Error(`diff items read failed (status ${response.status})`);
      }
      const body = await readJson(response);
      return (Array.isArray(body) ? body : []) as ReconciliationDiffItem[];
    },
  };
}

// ---------------------------------------------------------------------------
// Scope detection + story markers (pure)
// ---------------------------------------------------------------------------

function tagsOf(item: BookOfWorkItem): string[] {
  const raw = (item as { tags?: unknown }).tags;
  return Array.isArray(raw) ? raw.map((t) => String(t)) : [];
}

function isApiParityCodeStory(item: BookOfWorkItem): boolean {
  const tags = tagsOf(item);
  if (tags.includes(MANUAL_GATE_TAG)) return false; // human/wizard work
  if (tags.some((t) => API_PARITY_STREAM_TAGS.has(t))) return true;
  // Deterministic code stories outside the two API streams (e.g. the
  // internal-processing stream) are NOT this gate's scope.
  return false;
}

/** Marker view of a story's committed endpoints (stamped by Spec G). */
interface StoryEndpointMarkers {
  workItemId: string;
  apiEndpointIds: string[];
  flaggedMissingBaseline: boolean;
}

function storyMarkersOf(item: BookOfWorkItem): StoryEndpointMarkers | null {
  const workItemId = (item as { workItemId?: unknown }).workItemId;
  if (typeof workItemId !== 'string' || workItemId.length === 0) return null;
  const blob = item as unknown as Record<string, unknown>;
  const rawIds = blob.apiEndpointIds ?? blob.api_endpoint_ids;
  const apiEndpointIds = Array.isArray(rawIds) ? rawIds.map((v) => String(v)) : [];
  const flagReason =
    (blob.flagReason as string | undefined) ?? (blob.flag_reason as string | undefined) ?? null;
  return {
    workItemId,
    apiEndpointIds,
    // The planner joins MULTIPLE flags with commas (e.g.
    // 'missing_baseline,dialect_affected') — membership, not equality, or a
    // multi-flagged story loses its exemption (Tier-1 batch fix).
    flaggedMissingBaseline: (flagReason ?? '')
      .split(',')
      .map((f) => f.trim())
      .includes('missing_baseline'),
  };
}

/**
 * True when the run's dispatch scope contains at least one API-parity code
 * story (Spec G streams; internal stream + manual-gate work excluded).
 * Mirrors `dbStoriesInScope`.
 */
export function codeStoriesInScope(params: {
  items: BookOfWorkItem[];
  deferredWorkItemIds: Set<string>;
  selectedWorkItemIds?: Set<string> | null;
}): boolean {
  const hasSelection =
    !!params.selectedWorkItemIds && params.selectedWorkItemIds.size > 0;
  for (const item of params.items) {
    if (!item.workItemId) continue;
    if (params.deferredWorkItemIds.has(item.workItemId)) continue;
    if (hasSelection && !params.selectedWorkItemIds!.has(item.workItemId)) continue;
    if (isApiParityCodeStory(item)) return true;
    // Provenance-tagged stories in the API streams are covered above; a
    // provenance tag alone (prerequisites etc.) does not demand the gate.
    void CODE_PROVENANCE_TAG;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Endpoint-scope key matching (template-tolerant; the gateway-side twin of
// the validation service's endpointScope module)
// ---------------------------------------------------------------------------

function segmentMatches(a: string, b: string): boolean {
  if (a === b) return true;
  return /^\{.+\}$/.test(a) || /^\{.+\}$/.test(b);
}

function pathsMatch(a: string, b: string): boolean {
  const clean = (p: string): string[] =>
    (p.split('?')[0].replace(/\/+$/, '') || '/').split('/').filter((s) => s.length > 0);
  const as = clean(a);
  const bs = clean(b);
  if (as.length !== bs.length) return false;
  for (let i = 0; i < as.length; i++) {
    if (!segmentMatches(as[i], bs[i])) return false;
  }
  return true;
}

/**
 * Template-tolerant `"METHOD /path"` key equality (either side may carry
 * `{param}` segments). Exported (Tier-1 batch) so the post-reconcile
 * parity-verdict emitter judges story membership with the SAME rule the
 * completion gate uses.
 */
export function endpointKeyMatches(keyA: string, keyB: string): boolean {
  return keyMatches(keyA, keyB);
}

function keyMatches(keyA: string, keyB: string): boolean {
  const splitKey = (k: string): [string, string] | null => {
    const at = k.indexOf(' ');
    return at > 0 ? [k.slice(0, at).toUpperCase(), k.slice(at + 1)] : null;
  };
  const a = splitKey(keyA);
  const b = splitKey(keyB);
  if (!a || !b) return false;
  return a[0] === b[0] && pathsMatch(a[1], b[1]);
}

function scopeKeysOf(diff: GateDiffRow): string[] | null {
  const blob = diff.endpoint_scope_json;
  if (!blob || typeof blob !== 'object') return null;
  const keys = (blob as Record<string, unknown>).keys;
  if (!Array.isArray(keys)) return null;
  const parsed = keys.filter((k): k is string => typeof k === 'string');
  return parsed.length > 0 ? parsed : null;
}

function purposeOf(diff: GateDiffRow): string {
  const blob = diff.endpoint_scope_json;
  if (!blob || typeof blob !== 'object') return 'parity';
  const purpose = (blob as Record<string, unknown>).purpose;
  return typeof purpose === 'string' && purpose.length > 0 ? purpose : 'parity';
}

/** Newest-first by computed_at (missing timestamps sort last). */
function newestFirst(a: GateDiffRow, b: GateDiffRow): number {
  return (b.computed_at ?? '').localeCompare(a.computed_at ?? '');
}

// ---------------------------------------------------------------------------
// PRE-DISPATCH readiness (gate 4c)
// ---------------------------------------------------------------------------

export async function evaluateCodeReadiness(params: {
  projectId: string;
  currentArchitectureId: string | null;
  items: BookOfWorkItem[];
  deferredWorkItemIds: Set<string>;
  selectedWorkItemIds?: Set<string> | null;
  /** The active pinned current baseline id; null = none. */
  pinnedBaselineId: string | null;
  reads?: CodeGateReads;
}): Promise<CodeGateResult> {
  const reads = params.reads ?? defaultCodeGateReads();
  const reasons: CodeGateReason[] = [];

  if (!params.pinnedBaselineId) {
    reasons.push({
      code: 'code_baseline_unpinned',
      message:
        'This run dispatches code stories but no ACTIVE current-state baseline is pinned. ' +
        'Capture + activate an API behaviour baseline before Migrate — parity cannot be ' +
        'verified without the oracle.',
    });
  }

  // --- Per-endpoint baseline coverage (FAIL CLOSED on unreadable state) ---
  const hasSelection =
    !!params.selectedWorkItemIds && params.selectedWorkItemIds.size > 0;
  const inScopeStories: StoryEndpointMarkers[] = [];
  for (const item of params.items) {
    if (!item.workItemId) continue;
    if (params.deferredWorkItemIds.has(item.workItemId)) continue;
    if (hasSelection && !params.selectedWorkItemIds!.has(item.workItemId)) continue;
    if (!isApiParityCodeStory(item)) continue;
    const markers = storyMarkersOf(item);
    if (markers && markers.apiEndpointIds.length > 0) inScopeStories.push(markers);
  }

  // endpoint element id → normalised `"METHOD /path"` key (from the coverage
  // rows) — scopes the floor evaluation to in-scope stories below.
  const endpointKeyById = new Map<string, string>();
  if (inScopeStories.length > 0) {
    let coverageRows: EndpointBaselineCoverageRow[];
    try {
      coverageRows = await reads.fetchEndpointBaselineCoverageRows(
        params.projectId,
        params.currentArchitectureId ?? '',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reasons: [
          ...reasons,
          {
            code: 'code_gate_read_failed',
            message:
              `The endpoint→baseline coverage could not be read (${message}). Migrate fails ` +
              'CLOSED on unknown parity inputs — retry once AMS is reachable.',
          },
        ],
      };
    }
    const coverage = new Map<string, string>();
    for (const row of coverageRows) {
      if (row?.endpoint_id && row?.baseline_id) coverage.set(row.endpoint_id, row.baseline_id);
      if (row?.endpoint_id && row.method && row.path) {
        endpointKeyById.set(row.endpoint_id, `${row.method.toUpperCase()} ${row.path}`);
      }
    }

    for (const story of inScopeStories) {
      if (story.flaggedMissingBaseline) continue; // its spec already says so
      const uncovered = story.apiEndpointIds.filter((id) => !coverage.has(id));
      if (uncovered.length > 0) {
        reasons.push({
          code: 'code_baseline_missing',
          workItemId: story.workItemId,
          message:
            `Story ${story.workItemId}: ${uncovered.length} of its committed endpoint(s) have ` +
            `no accepted baseline coverage (${uncovered.slice(0, 3).join(', ')}` +
            `${uncovered.length > 3 ? ', …' : ''}). Run the baseline capture story for this ` +
            'interface (or regenerate the plan to flag the story) before Migrate.',
        });
      }
    }
  }

  // --- Coverage floor (Spec K; persisted score on the pinned baseline) ---
  if (params.pinnedBaselineId) {
    try {
      const summary = await reads.fetchCoverageSummaryForBaseline(
        params.projectId,
        params.pinnedBaselineId,
      );
      if (summary) {
        const floor = evaluateCoverageFloor(summary);
        if (!floor.passed) {
          // Tier-1 batch: SCOPE floor misses to the run's in-scope story
          // endpoints — an uncovered dimension on an endpoint NO dispatched
          // story implements must not block THIS run. When the in-scope key
          // set is empty (no endpoint keys resolvable), fall back to the
          // whole-summary behaviour — fail closed, never silently narrower.
          const inScopeKeys = inScopeStories
            .flatMap((story) => story.apiEndpointIds)
            .map((id) => endpointKeyById.get(id))
            .filter((key): key is string => !!key);
          const failing = floor.operations
            .filter((op) => !op.passed)
            .filter(
              (op) =>
                inScopeKeys.length === 0 ||
                inScopeKeys.some((key) =>
                  keyMatches(key, `${op.method.toUpperCase()} ${op.path}`),
                ),
            );
          if (failing.length > 0) {
            const sample = failing
              .slice(0, 3)
              .map((op) => `${op.method.toUpperCase()} ${op.path}`)
              .join(', ');
            reasons.push({
              code: 'code_coverage_floor_unmet',
              message:
                `The pinned baseline's scenario coverage fails the floor on ${failing.length} ` +
                `in-scope operation(s) (${sample}${failing.length > 3 ? ', …' : ''}). Re-run ` +
                'capture to cover the floor-bearing dimensions (happy / error / validation / ' +
                'seed) or waive the specific (operation, dimension) misses.',
            });
          }
        }
      }
      // summary === null: pre-K session (no persisted score) — the floor is
      // not evaluable; deliberately NOT a block (no false gate on legacy
      // baselines), the missing-coverage dimension surfaces via capture UX.
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reasons.push({
        code: 'code_gate_read_failed',
        message:
          `The pinned baseline's coverage summary could not be read (${message}). Migrate ` +
          'fails CLOSED on unknown parity inputs — retry once AMS is reachable.',
      });
    }
  }

  const result = { ok: reasons.length === 0, reasons };
  logger.info('[diag-gateway] migration_code_gate readiness', {
    projectId: params.projectId,
    ok: result.ok,
    reasons: result.reasons.map((r) => r.code),
  });
  return result;
}

// ---------------------------------------------------------------------------
// COMPLETION evaluation (per story + stream closure)
// ---------------------------------------------------------------------------

/**
 * Evaluate whether ONE code story is completable: its latest covering parity
 * diff must be completed and clean (unwaived-break-free) INSIDE the story's
 * endpoint scope. FAIL CLOSED: no covering diff, an incomplete diff, or
 * unreadable state ⇒ `code_parity_unverified`.
 */
export async function evaluateCodeStoryCompletion(params: {
  projectId: string;
  /** The story's normalised `"METHOD /path"` endpoint keys. */
  storyEndpointKeys: string[];
  /** Every diff for the pinned baseline (reads.listDiffsForBaseline). */
  diffs: GateDiffRow[];
  waivers: BreakFingerprintWaiver[];
  reads?: CodeGateReads;
}): Promise<CodeGateResult> {
  const reads = params.reads ?? defaultCodeGateReads();

  // Candidate diffs: completed parity runs whose scope covers EVERY story
  // endpoint (a null scope = full surface = always covers).
  const covering = params.diffs
    .filter((d) => (d.status ?? '') === 'completed')
    .filter((d) => purposeOf(d) !== 'drift_check')
    .filter((d) => {
      const scope = scopeKeysOf(d);
      if (!scope) return true;
      return params.storyEndpointKeys.every((storyKey) =>
        scope.some((scopeKey) => keyMatches(scopeKey, storyKey)),
      );
    })
    .sort(newestFirst);

  if (covering.length === 0) {
    return {
      ok: false,
      reasons: [
        {
          code: 'code_parity_unverified',
          message:
            'No completed parity diff covers this story\'s endpoints. Run the scoped parity ' +
            'verify (or the full-baseline reconcile) against the deployed target — a code ' +
            'story is never completable on an unverified surface (FAIL CLOSED).',
        },
      ],
    };
  }

  const latest = covering[0];
  let items: ReconciliationDiffItem[];
  try {
    items = await reads.listDiffItems(params.projectId, latest.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reasons: [
        {
          code: 'code_parity_unverified',
          message:
            `The latest covering diff (${latest.id}) could not be read (${message}). ` +
            'Completion fails CLOSED on unreadable parity state.',
        },
      ],
    };
  }

  // Judge ONLY the story's endpoints (a broader diff may cover other stories).
  const storyItems = items.filter((item) =>
    params.storyEndpointKeys.some((storyKey) =>
      keyMatches(storyKey, `${(item.method ?? 'GET').toUpperCase()} ${item.path ?? '/'}`),
    ),
  );
  if (storyItems.length === 0) {
    return {
      ok: false,
      reasons: [
        {
          code: 'code_parity_unverified',
          message:
            `The latest covering diff (${latest.id}) contains no compared items for this ` +
            'story\'s endpoints — nothing was verified (FAIL CLOSED). Check baseline coverage ' +
            'for the interface.',
        },
      ],
    };
  }

  const waiverByFingerprint = new Map(params.waivers.map((w) => [w.target, w]));
  const unwaived = storyItems
    .filter(isDiffItemABreak)
    .filter((item) => !waiverByFingerprint.has(breakFingerprint(item)));
  if (unwaived.length > 0) {
    const sample = unwaived
      .slice(0, 3)
      .map((i) => `${(i.method ?? 'GET').toUpperCase()} ${i.path ?? '/'} (${i.scenario_name ?? ''})`)
      .join('; ');
    return {
      ok: false,
      reasons: [
        {
          code: 'code_parity_broken',
          message:
            `${unwaived.length} unwaived parity break(s) inside this story's endpoints on ` +
            `diff ${latest.id} (${sample}${unwaived.length > 3 ? '; …' : ''}). Fix and re-run ` +
            'the scoped verify, or waive each break fingerprint with a reason.',
        },
      ],
    };
  }

  return { ok: true, reasons: [] };
}

/**
 * Stream-closure readiness: requires a FULL-surface (UNSCOPED) completed
 * diff with zero unwaived breaks. A scoped-clean diff is REJECTED — the
 * scope audit blob (changeset 208) is exactly what makes this checkable.
 */
export async function evaluateClosureReadiness(params: {
  projectId: string;
  diffs: GateDiffRow[];
  waivers: BreakFingerprintWaiver[];
  reads?: CodeGateReads;
}): Promise<CodeGateResult> {
  const reads = params.reads ?? defaultCodeGateReads();
  const unscoped = params.diffs
    .filter((d) => (d.status ?? '') === 'completed')
    .filter((d) => purposeOf(d) !== 'drift_check')
    .filter((d) => scopeKeysOf(d) === null)
    .sort(newestFirst);

  if (unscoped.length === 0) {
    return {
      ok: false,
      reasons: [
        {
          code: 'code_parity_unverified',
          message:
            'Stream closure requires a FULL-surface parity diff — none exists (scoped diffs ' +
            'do not qualify; their endpoint_scope_json audit blob marks the narrower ' +
            'coverage). Run the full-baseline reconcile against the deployed target.',
        },
      ],
    };
  }

  const latest = unscoped[0];
  let items: ReconciliationDiffItem[];
  try {
    items = await reads.listDiffItems(params.projectId, latest.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reasons: [
        {
          code: 'code_parity_unverified',
          message: `The full-surface diff (${latest.id}) could not be read (${message}). FAIL CLOSED.`,
        },
      ],
    };
  }
  if (items.length === 0) {
    return {
      ok: false,
      reasons: [
        {
          code: 'code_parity_unverified',
          message:
            `The full-surface diff (${latest.id}) compared zero items — nothing was verified ` +
            '(FAIL CLOSED).',
        },
      ],
    };
  }

  const waiverByFingerprint = new Map(params.waivers.map((w) => [w.target, w]));
  const unwaived = items
    .filter(isDiffItemABreak)
    .filter((item) => !waiverByFingerprint.has(breakFingerprint(item)));
  if (unwaived.length > 0) {
    return {
      ok: false,
      reasons: [
        {
          code: 'code_parity_broken',
          message:
            `${unwaived.length} unwaived parity break(s) remain on the latest full-surface ` +
            `diff (${latest.id}). The closure story is not completable until the surface is ` +
            'clean or every break is waived with a reason.',
        },
      ],
    };
  }
  return { ok: true, reasons: [] };
}

// ---------------------------------------------------------------------------
// BASELINE DRIFT (amendment §6)
// ---------------------------------------------------------------------------

export const DEFAULT_DRIFT_MAX_AGE_DAYS = 14;

/**
 * Evaluate the pinned baseline's behavioural-drift posture off the persisted
 * drift-check diffs (`endpoint_scope_json.purpose === 'drift_check'`).
 */
export async function evaluateBaselineDrift(params: {
  projectId: string;
  diffs: GateDiffRow[];
  /** Warning threshold: max age of the newest drift check. Default 14 days. */
  maxAgeDays?: number;
  now?: () => number;
  reads?: CodeGateReads;
}): Promise<CodeGateResult> {
  const reads = params.reads ?? defaultCodeGateReads();
  const now = params.now ?? (() => Date.now());
  const maxAgeMs = (params.maxAgeDays ?? DEFAULT_DRIFT_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;

  const driftChecks = params.diffs
    .filter((d) => (d.status ?? '') === 'completed')
    .filter((d) => purposeOf(d) === 'drift_check')
    .sort(newestFirst);

  if (driftChecks.length === 0) {
    return {
      ok: false,
      reasons: [
        {
          code: 'baseline_drift_unchecked',
          message:
            'The pinned baseline has never had a behavioural drift check. The live legacy ' +
            'system keeps running while migration proceeds — schedule a drift-check run ' +
            '(the scoped-replay machinery pointed at the CURRENT base URL) so oracle rot ' +
            'is caught before reconcile trusts it.',
        },
      ],
    };
  }

  const latest = driftChecks[0];
  const computedAt = latest.computed_at ? Date.parse(latest.computed_at) : NaN;
  if (!Number.isFinite(computedAt) || now() - computedAt > maxAgeMs) {
    return {
      ok: false,
      reasons: [
        {
          code: 'baseline_drift_unchecked',
          message:
            `The newest drift check (${latest.id}) is older than the configured maximum ` +
            `(${params.maxAgeDays ?? DEFAULT_DRIFT_MAX_AGE_DAYS} days). Re-run the drift ` +
            'check against the CURRENT system before trusting the pinned oracle.',
        },
      ],
    };
  }

  let items: ReconciliationDiffItem[];
  try {
    items = await reads.listDiffItems(params.projectId, latest.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reasons: [
        {
          code: 'baseline_drift_unchecked',
          message: `The drift-check diff (${latest.id}) could not be read (${message}).`,
        },
      ],
    };
  }
  const breaks = items.filter(isDiffItemABreak);
  if (breaks.length > 0) {
    return {
      ok: false,
      reasons: [
        {
          code: 'baseline_behaviour_drift',
          message:
            `The latest drift check (${latest.id}) found ${breaks.length} break(s) against ` +
            'the CURRENT system: the legacy behaviour changed since capture (or volatility ' +
            'was under-modelled — the volatility envelope disambiguates). Re-capture the ' +
            'baseline (or waive with a reason) before reconcile trusts this oracle.',
        },
      ],
    };
  }
  return { ok: true, reasons: [] };
}

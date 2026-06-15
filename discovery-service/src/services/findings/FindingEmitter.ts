/**
 * FindingEmitter -- normalize + dedupe + persist Discovery Findings.
 *
 * Spec: 2026-05-16 Discovery Findings / Evidence as a First-Class Discovery
 * Concept -- Task Group 4 (Phase 3 / Commit 3).
 *
 * Responsibilities
 * ----------------
 * - Accept a `runContext` carrying (`runId`, `projectId`, `architectureId`)
 *   plus the per-finding payload (`findingType`, `category`, `severity`,
 *   `title`, optional `summary` / `detailJson` / `confidence` /
 *   `source` / `createdByStage`, optional `links`).
 * - Normalize: lowercase `findingType` / `category` / `severity`; trim
 *   `title` / `summary`; validate `severity` is in {info, low, medium, high,
 *   critical} and `reviewStatus` (when supplied) is in {pending_review,
 *   approved, rejected, deferred}. The pipeline only emits the initial state,
 *   so `reviewStatus` is OMITTED from the create payload -- AMS applies its
 *   `pending_review` default (Spec F, 2026-06-02; was `status='new'` per D5).
 * - Dedupe per D2: key is
 *   `runId | findingType | category | title | primaryLinkedTarget` where
 *   `primaryLinkedTarget` is derived from the link list using the priority
 *   `discovery_candidate > discovery_decision_task > discovery_relationship >
 *   discovery_evidence > discovery_cluster > architecture_element`. Tiebreak
 *   by lowest `targetId`. Empty string when the finding has no links.
 *   Maintain an in-process dedup cache keyed by `runId` so multiple emission
 *   sites that flag the same candidate in the same run produce a single
 *   finding. Duplicates are SKIPPED (the cache stores the dedupe key; the
 *   `Promise<DiscoveryFindingDto | null>` resolves to null for a skip).
 * - Persist via `archModelClient.createDiscoveryFinding` (single) or
 *   `bulkCreateDiscoveryFindings` (bulk). On `archModelClient` failure: log
 *   a warning and return `null` -- NEVER propagate. The discovery run must
 *   continue even when AMS is unavailable or rejects a finding.
 *
 * LLM enrichment (D7) -- shape compatibility only
 * ------------------------------------------------
 * The DTO fields `summary`, `detail_json`, `confidence`, `source`, and
 * `created_by_stage` are designed to host post-emission enrichment by an
 * LLM-driven pass in a future spec. `source = 'llm_enrichment'` is a
 * documented future value. In v1 there is NO stub method, NO placeholder
 * call site, NO no-op enrichment hook -- only this comment block, by
 * design. Future work adds the enrichment pass without an AMS schema
 * change.
 */

import {
  archModelClient,
  type DiscoveryFindingDto,
  type DiscoveryFindingCreatePayload,
  type DiscoveryFindingLinkPayload,
  type DiscoveryFindingLinkTargetType,
} from '../archModelClient';

/**
 * Severities accepted at emit time.
 */
export type FindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  'info',
  'low',
  'medium',
  'high',
  'critical',
]);

/**
 * Review-disposition values accepted at emit time. The pipeline only ever
 * emits the initial state, which is OMITTED from the create payload so AMS
 * applies its `pending_review` default (Spec F, 2026-06-02 -- findings now
 * share the candidate disposition vocabulary). This set guards an explicitly
 * supplied `reviewStatus` only.
 */
export type FindingStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'deferred';
const VALID_STATUSES: ReadonlySet<string> = new Set([
  'pending_review',
  'approved',
  'rejected',
  'deferred',
]);

/**
 * Per-run scoping passed to every emit call. Constructed once at run start
 * by the orchestrator and threaded into each emission site.
 */
export interface FindingEmitRunContext {
  runId: string;
  projectId: string;
  architectureId: string;
}

/**
 * Single-finding input accepted by {@link FindingEmitter.emitFinding} /
 * {@link FindingEmitter.emitFindings}.
 *
 * `runContext` is required for `emitFinding`; `emitFindings` accepts one
 * `runContext` plus N input shapes that omit it.
 *
 * `reviewStatus` is optional and almost never set by a scanner -- the
 * pipeline emits the initial state, which is left for AMS to default to
 * `pending_review`. When supplied it must be a valid disposition (Spec F).
 */
export interface FindingEmitInput {
  findingType: string;
  category: string;
  severity: string;
  title: string;
  summary?: string;
  detailJson?: Record<string, unknown> | null;
  confidence?: number | null;
  source?: string | null;
  createdByStage?: string | null;
  reviewStatus?: string;
  links?: DiscoveryFindingLinkPayload[];
}

/**
 * Per-target-type priority for the D2 primary-link computation.
 * Lower index = higher priority. Lookup is O(1) via the Map.
 */
const TARGET_TYPE_PRIORITY: ReadonlyMap<string, number> = new Map<
  DiscoveryFindingLinkTargetType,
  number
>([
  ['discovery_candidate', 0],
  ['discovery_decision_task', 1],
  ['discovery_relationship', 2],
  ['discovery_evidence', 3],
  ['discovery_cluster', 4],
  ['architecture_element', 5],
]);

/**
 * Compute the D2 "primary linked target" string for dedupe-key composition.
 *
 * Priority order:
 *   `discovery_candidate > discovery_decision_task > discovery_relationship >
 *    discovery_evidence > discovery_cluster > architecture_element`.
 *
 * Tiebreak: when multiple links share the highest-priority target_type, pick
 * the one with the lexicographically lowest `targetId`. Returns the empty
 * string when the finding has no links so that an empty-string segment still
 * participates in the dedupe key (preserves "no-link" findings as their own
 * unique slot rather than colliding on a placeholder).
 *
 * Spec 2026-05-16 Discovery Findings -- D2.
 */
export function computePrimaryLinkedTarget(
  links: DiscoveryFindingLinkPayload[] | undefined,
): string {
  if (!links || links.length === 0) return '';
  let bestPriority = Number.POSITIVE_INFINITY;
  let bestTargetId: string | null = null;
  for (const link of links) {
    const priority = TARGET_TYPE_PRIORITY.get(link.targetType);
    if (priority === undefined) continue; // unknown target type -- ignore for dedupe
    if (priority < bestPriority) {
      bestPriority = priority;
      bestTargetId = link.targetId;
    } else if (priority === bestPriority && bestTargetId !== null) {
      if (link.targetId < bestTargetId) {
        bestTargetId = link.targetId;
      }
    }
  }
  if (bestTargetId === null) return '';
  // The dedupe-key segment includes the target_type AND target_id so the
  // segment is self-describing -- a finding linked to `candidate:C1` does
  // not collide with a finding linked to `evidence:C1`.
  const targetTypeAtPriority = Array.from(TARGET_TYPE_PRIORITY.entries()).find(
    ([, p]) => p === bestPriority,
  );
  const targetTypeStr = targetTypeAtPriority ? targetTypeAtPriority[0] : '';
  return `${targetTypeStr}:${bestTargetId}`;
}

/**
 * Compute the full dedupe key per D2: combination of all five components.
 * The pipe character is reserved -- `findingType` / `category` / `title` are
 * already normalized (lowercased + trimmed) before this is called, and the
 * `primaryLinkedTarget` segment never contains a pipe.
 */
export function computeDedupeKey(args: {
  runId: string;
  findingType: string;
  category: string;
  title: string;
  primaryLinkedTarget: string;
}): string {
  return `${args.runId}|${args.findingType}|${args.category}|${args.title}|${args.primaryLinkedTarget}`;
}

/**
 * The arch-model-client surface FindingEmitter depends on. Defined as an
 * interface so tests can pass an in-memory stub without touching axios.
 */
export interface FindingEmitterArchClient {
  createDiscoveryFinding(
    projectId: string,
    runId: string,
    payload: DiscoveryFindingCreatePayload,
  ): Promise<DiscoveryFindingDto>;
  bulkCreateDiscoveryFindings(
    projectId: string,
    runId: string,
    payloads: DiscoveryFindingCreatePayload[],
  ): Promise<DiscoveryFindingDto[]>;
}

/**
 * Per-run aggregated counters used for the session-end diagnostic line.
 * Counts only -- no titles, no payload bodies. Kept on the emitter instance
 * keyed by runId so concurrent runs (e.g. test harnesses) do not poison
 * each other's totals.
 */
interface RunAggregate {
  totalEmitted: number;
  totalDeduped: number;
  totalPersisted: number;
}

/**
 * Short, low-cardinality correlation id for `[diag-*]` log lines. The runbook
 * pairs log lines using this 8-char prefix so we never leak the full uuid.
 */
function shortId(id: string): string {
  return (id || '').slice(0, 8);
}

/**
 * Classify a thrown error from the AMS client into a small, low-cardinality
 * category string for the diag log. We never log the raw error message or
 * URL. Only the broad shape (HTTP status if available, otherwise a coarse
 * network/unknown bucket) flows out.
 */
function classifyAmsError(err: unknown): { reason: string; status: string } {
  const anyErr = err as { response?: { status?: number }; code?: string };
  const status = anyErr?.response?.status;
  if (typeof status === 'number') {
    if (status === 503 || status === 504) return { reason: 'ams_unreachable', status: String(status) };
    if (status === 502) return { reason: 'ams_bad_gateway', status: String(status) };
    if (status === 429) return { reason: 'ams_rate_limited', status: String(status) };
    if (status >= 500) return { reason: 'ams_5xx', status: String(status) };
    if (status === 404) return { reason: 'ams_not_found', status: String(status) };
    if (status === 400 || status === 422) return { reason: 'ams_validation', status: String(status) };
    if (status >= 400) return { reason: 'ams_4xx', status: String(status) };
    return { reason: 'ams_other', status: String(status) };
  }
  const code = anyErr?.code;
  if (typeof code === 'string' && code.length > 0) {
    if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EAI_AGAIN') {
      return { reason: 'ams_unreachable', status: code };
    }
    if (code === 'ETIMEDOUT') return { reason: 'ams_timeout', status: code };
    return { reason: 'network_error', status: code };
  }
  return { reason: 'unknown', status: '0' };
}

/**
 * Stateful per-process emitter. The dedupe cache is keyed by `runId` so two
 * concurrent runs (rare but possible in test harnesses) do not poison each
 * other. Call {@link FindingEmitter.clearRunCache} when a run completes.
 */
export class FindingEmitter {
  private readonly client: FindingEmitterArchClient;
  private readonly dedupeCache: Map<string, Set<string>> = new Map();
  /** Per-run aggregate counters for the session-end diag log. */
  private readonly runAggregates: Map<string, RunAggregate> = new Map();

  constructor(client?: FindingEmitterArchClient) {
    this.client = client ?? archModelClient;
  }

  /**
   * Normalize + dedupe + persist a single finding.
   *
   * Returns:
   *   - the persisted `DiscoveryFindingDto` on success,
   *   - `null` when the finding was deduped (already emitted in this run) OR
   *     when persistence failed (warning logged; run NOT aborted).
   */
  async emitFinding(
    runContext: FindingEmitRunContext,
    input: FindingEmitInput,
  ): Promise<DiscoveryFindingDto | null> {
    const agg = this.ensureAggregate(runContext.runId);
    const emittedBefore = agg.totalEmitted;
    const dedupedBefore = agg.totalDeduped;
    const prepared = this.prepare(runContext, input);
    const dedupedDelta = agg.totalDeduped - dedupedBefore;
    const emittedDelta = agg.totalEmitted - emittedBefore;
    const source = typeof input.source === 'string' && input.source.length > 0 ? input.source : 'unknown';

    if (prepared === null) {
      // Either invalid or deduped -- log the boundary (counts only).
      console.log(
        `[diag-emitter] op=emitFinding run=${shortId(runContext.runId)} ` +
          `emitted=${emittedDelta} deduped=${dedupedDelta} persisted=0 source=${source}`,
      );
      return null;
    }
    try {
      const dto = await this.client.createDiscoveryFinding(
        runContext.projectId,
        runContext.runId,
        prepared.payload,
      );
      agg.totalPersisted += 1;
      console.log(
        `[diag-emitter] op=emitFinding run=${shortId(runContext.runId)} ` +
          `emitted=${emittedDelta} deduped=${dedupedDelta} persisted=1 source=${source}`,
      );
      return dto;
    } catch (err) {
      this.logEmitFailure(err, prepared.dedupeKey);
      const { reason, status } = classifyAmsError(err);
      console.warn(
        `[diag-emitter] op=emitFinding run=${shortId(runContext.runId)} soft_fail=true ` +
          `reason=${reason} status=${status} source=${source}`,
      );
      return null;
    }
  }

  /**
   * Bulk variant. Filters out duplicates (against the in-process dedupe
   * cache) BEFORE the network round-trip so we only POST what is new.
   */
  async emitFindings(
    runContext: FindingEmitRunContext,
    inputs: FindingEmitInput[],
  ): Promise<DiscoveryFindingDto[]> {
    const agg = this.ensureAggregate(runContext.runId);
    const emittedBefore = agg.totalEmitted;
    const dedupedBefore = agg.totalDeduped;

    const prepared: Array<{ payload: DiscoveryFindingCreatePayload; dedupeKey: string }> = [];
    for (const input of inputs) {
      const p = this.prepare(runContext, input);
      if (p !== null) prepared.push(p);
    }

    const emittedThisCall = agg.totalEmitted - emittedBefore;
    const dedupedThisCall = agg.totalDeduped - dedupedBefore;
    // Pick a representative source attribute for the diag line. We pick the
    // first non-null source on the input list; if all inputs are missing a
    // source, we surface `unknown`. This is informational only -- we never
    // log per-finding source.
    let source = 'unknown';
    for (const f of inputs) {
      if (typeof f.source === 'string' && f.source.length > 0) {
        source = f.source;
        break;
      }
    }

    if (prepared.length === 0) {
      console.log(
        `[diag-emitter] op=emitFindings run=${shortId(runContext.runId)} ` +
          `emitted=${emittedThisCall} deduped=${dedupedThisCall} persisted=0 source=${source}`,
      );
      return [];
    }
    try {
      const dtos = await this.client.bulkCreateDiscoveryFindings(
        runContext.projectId,
        runContext.runId,
        prepared.map((p) => p.payload),
      );
      const persistedThisCall = Array.isArray(dtos) ? dtos.length : prepared.length;
      agg.totalPersisted += persistedThisCall;
      console.log(
        `[diag-emitter] op=emitFindings run=${shortId(runContext.runId)} ` +
          `emitted=${emittedThisCall} deduped=${dedupedThisCall} ` +
          `persisted=${persistedThisCall} source=${source}`,
      );
      return dtos;
    } catch (err) {
      // Log against the first dedupe key just for context; soft-fail per spec.
      this.logEmitFailure(err, prepared[0].dedupeKey, prepared.length);
      const { reason, status } = classifyAmsError(err);
      console.warn(
        `[diag-emitter] op=emitFindings run=${shortId(runContext.runId)} soft_fail=true ` +
          `reason=${reason} status=${status} batch=${prepared.length} source=${source}`,
      );
      return [];
    }
  }

  /**
   * Clear the per-run dedupe cache. Call when a run ends so a subsequent
   * run with overlapping (run/type/category/title/primary-target) tuples
   * is not erroneously filtered.
   *
   * Also emits the per-run aggregate `[diag-emitter] session=...` line so the
   * runbook can read back a single summary at run end without summing across
   * per-call lines.
   */
  clearRunCache(runId: string): void {
    const agg = this.runAggregates.get(runId);
    if (agg) {
      console.log(
        `[diag-emitter] session=${shortId(runId)} ` +
          `total_emitted=${agg.totalEmitted} ` +
          `total_persisted=${agg.totalPersisted} ` +
          `total_deduped=${agg.totalDeduped}`,
      );
    }
    this.dedupeCache.delete(runId);
    this.runAggregates.delete(runId);
  }

  /**
   * Read-only snapshot of the per-run emit aggregate (undefined when the run
   * has emitted nothing yet). Used by `runManager` to surface findings-emit
   * success/failure into the run's `steps_payload` -- the prior silent
   * soft-fail is exactly how the "0 findings" bug hid: `attempted > persisted`
   * means AMS rejected some findings.
   */
  getRunAggregate(
    runId: string,
  ): { totalEmitted: number; totalPersisted: number; totalDeduped: number } | undefined {
    const agg = this.runAggregates.get(runId);
    if (agg === undefined) return undefined;
    return {
      totalEmitted: agg.totalEmitted,
      totalPersisted: agg.totalPersisted,
      totalDeduped: agg.totalDeduped,
    };
  }

  /**
   * Internal: normalize the input, validate, compute the dedupe key,
   * consult the per-run cache. Returns the wire payload + key on a hit,
   * or `null` when the finding should be skipped (already deduped or
   * invalid shape -- in both cases we never throw).
   */
  private prepare(
    runContext: FindingEmitRunContext,
    input: FindingEmitInput,
  ): { payload: DiscoveryFindingCreatePayload; dedupeKey: string } | null {
    const findingType = normalizeToken(input.findingType);
    const category = normalizeToken(input.category);
    const severity = normalizeToken(input.severity);
    const title = (input.title ?? '').trim();
    // The pipeline emits the initial state, so a scanner almost never sets a
    // disposition. We only normalize/validate when one is explicitly supplied;
    // otherwise the field is omitted from the payload and AMS applies its
    // `pending_review` default (Spec F).
    const reviewStatus =
      input.reviewStatus === undefined ? undefined : normalizeToken(input.reviewStatus);

    if (!findingType || !category || !severity || !title) {
      console.warn(
        '[FindingEmitter] Skipping finding with missing required field(s): ' +
          JSON.stringify({
            findingType: input.findingType,
            category: input.category,
            severity: input.severity,
            title: input.title,
          }),
      );
      return null;
    }
    if (!VALID_SEVERITIES.has(severity)) {
      console.warn(
        `[FindingEmitter] Skipping finding with invalid severity '${input.severity}' ` +
          `(must be one of info/low/medium/high/critical); title='${title}'.`,
      );
      return null;
    }
    if (reviewStatus !== undefined && !VALID_STATUSES.has(reviewStatus)) {
      console.warn(
        `[FindingEmitter] Skipping finding with invalid review_status '${input.reviewStatus}' ` +
          `(must be one of pending_review/approved/rejected/deferred); title='${title}'.`,
      );
      return null;
    }

    const links = input.links;
    const primaryLinkedTarget = computePrimaryLinkedTarget(links);
    const dedupeKey = computeDedupeKey({
      runId: runContext.runId,
      findingType,
      category,
      title,
      primaryLinkedTarget,
    });

    // Per-run dedupe cache lookup. Skip duplicates in v1 (no merging).
    let runCache = this.dedupeCache.get(runContext.runId);
    if (runCache === undefined) {
      runCache = new Set<string>();
      this.dedupeCache.set(runContext.runId, runCache);
    }
    const agg = this.ensureAggregate(runContext.runId);
    if (runCache.has(dedupeKey)) {
      agg.totalDeduped += 1;
      return null;
    }
    runCache.add(dedupeKey);
    agg.totalEmitted += 1;

    const summary = typeof input.summary === 'string' ? input.summary.trim() : input.summary;

    const payload: DiscoveryFindingCreatePayload = {
      findingType,
      category,
      severity,
      title,
    };
    // Only carry an explicitly supplied disposition; otherwise let AMS default
    // to `pending_review` (preferred -- least coupling; Spec F).
    if (reviewStatus !== undefined) payload.reviewStatus = reviewStatus;
    if (summary !== undefined) payload.summary = summary ?? null;
    if (input.detailJson !== undefined) payload.detailJson = input.detailJson;
    if (input.confidence !== undefined) payload.confidence = input.confidence;
    if (input.source !== undefined) payload.source = input.source;
    if (input.createdByStage !== undefined) payload.createdByStage = input.createdByStage;
    if (links !== undefined) payload.links = links;

    return { payload, dedupeKey };
  }

  /**
   * Lazy-init the per-run aggregate counters.
   */
  private ensureAggregate(runId: string): RunAggregate {
    let agg = this.runAggregates.get(runId);
    if (agg === undefined) {
      agg = { totalEmitted: 0, totalDeduped: 0, totalPersisted: 0 };
      this.runAggregates.set(runId, agg);
    }
    return agg;
  }

  private logEmitFailure(err: unknown, dedupeKey: string, count: number = 1): void {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[FindingEmitter] finding emit failed; continuing run. ` +
        `dedupeKey='${dedupeKey}' count=${count} error='${message}'`,
    );
  }
}

/**
 * Lower-case + trim a token-like string for normalization. Returns the empty
 * string when input is null/undefined/whitespace-only.
 */
function normalizeToken(s: string | undefined | null): string {
  if (s === undefined || s === null) return '';
  return String(s).trim().toLowerCase();
}

/**
 * Singleton emitter instance bound to the singleton archModelClient. Use
 * this from pipeline emission sites unless a test needs to inject a
 * different client.
 */
export const findingEmitter = new FindingEmitter();

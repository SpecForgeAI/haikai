/**
 * Endpoint Runtime Aggregator
 *
 * Groups parsed `HttpRuntimeObservation` rows by `method + normalizedPath`,
 * computes per-endpoint status distribution and timing windows, and emits
 * unmatched-route-hint candidates that cleared the configurable threshold.
 *
 * Aggregate key: `${method.toUpperCase()} ${normalizedPath}`
 *
 * Status semantics (per Spec 5):
 *   - `observedUsageCount` = `status2xxCount + status3xxCount` only
 *   - 4xx and 5xx are retained on the aggregate but do NOT contribute
 *     to `observedUsageCount`
 *   - Pure-404 routes (every observation 404, with zero 2xx/3xx and at
 *     least one 4xx that is exclusively 404s) are excluded entirely from
 *     the returned aggregates AND from the unmatched-hint candidate list
 *
 * Unmatched-hint threshold:
 *   - Read once at module init from `RUNTIME_UNMATCHED_HINT_THRESHOLD`
 *   - Default 5; applied globally (no per-host logic)
 *   - The aggregator does NOT yet know which aggregates will be matched;
 *     the matcher is responsible for filtering its returned set down to
 *     truly unmatched ones. The aggregator only enforces the threshold
 *     gate so callers can rely on the candidate list being already
 *     pre-filtered for `observedUsageCount >= threshold`.
 */

import {
  EndpointRuntimeAggregate,
  HttpRuntimeObservation,
} from './httpRuntimeObservation';

const UNMATCHED_HINT_THRESHOLD: number = Number(
  process.env.RUNTIME_UNMATCHED_HINT_THRESHOLD ?? 5,
);

/**
 * Bound on the number of `sampleLineRefs` retained per aggregate. Keeps
 * the persisted blob compact while still preserving traceability to a
 * handful of source lines.
 */
const MAX_SAMPLE_LINE_REFS = 5;

/**
 * Bound on the number of distinct top status codes returned per aggregate.
 */
const MAX_TOP_STATUS_CODES = 5;

interface AggregateAccumulator {
  method: string;
  normalizedPath: string;
  totalLogRequests: number;
  status2xxCount: number;
  status3xxCount: number;
  status4xxCount: number;
  status5xxCount: number;
  /** Map of distinct status code -> count, for `topStatusCodes` materialization. */
  statusCounts: Map<number, number>;
  /** Map of distinct 4xx code -> count, used to detect pure-404 routes. */
  fourXxCounts: Map<number, number>;
  firstSeen?: string;
  lastSeen?: string;
  sourceLogFiles: Set<string>;
  sampleLineRefs: Array<{ sourceArtifactId: string; lineNumber: number }>;
}

function createAccumulator(
  method: string,
  normalizedPath: string,
): AggregateAccumulator {
  return {
    method,
    normalizedPath,
    totalLogRequests: 0,
    status2xxCount: 0,
    status3xxCount: 0,
    status4xxCount: 0,
    status5xxCount: 0,
    statusCounts: new Map(),
    fourXxCounts: new Map(),
    sourceLogFiles: new Set(),
    sampleLineRefs: [],
  };
}

function applyObservation(
  acc: AggregateAccumulator,
  o: HttpRuntimeObservation,
): void {
  acc.totalLogRequests += 1;

  if (o.status >= 200 && o.status < 300) acc.status2xxCount += 1;
  else if (o.status >= 300 && o.status < 400) acc.status3xxCount += 1;
  else if (o.status >= 400 && o.status < 500) {
    acc.status4xxCount += 1;
    acc.fourXxCounts.set(o.status, (acc.fourXxCounts.get(o.status) ?? 0) + 1);
  } else if (o.status >= 500 && o.status < 600) acc.status5xxCount += 1;

  acc.statusCounts.set(o.status, (acc.statusCounts.get(o.status) ?? 0) + 1);

  if (o.timestampIso) {
    if (!acc.firstSeen || o.timestampIso < acc.firstSeen) acc.firstSeen = o.timestampIso;
    if (!acc.lastSeen || o.timestampIso > acc.lastSeen) acc.lastSeen = o.timestampIso;
  }

  if (o.sourceFileName) acc.sourceLogFiles.add(o.sourceFileName);

  if (acc.sampleLineRefs.length < MAX_SAMPLE_LINE_REFS) {
    acc.sampleLineRefs.push({
      sourceArtifactId: o.sourceArtifactId,
      lineNumber: o.lineNumber,
    });
  }
}

function isPure404(acc: AggregateAccumulator): boolean {
  // No 2xx, no 3xx, AT LEAST one 4xx, and EVERY 4xx is exactly status 404.
  if (acc.status2xxCount !== 0) return false;
  if (acc.status3xxCount !== 0) return false;
  if (acc.status4xxCount === 0) return false;
  for (const code of acc.fourXxCounts.keys()) {
    if (code !== 404) return false;
  }
  return true;
}

function materialize(acc: AggregateAccumulator): EndpointRuntimeAggregate {
  const observedUsageCount = acc.status2xxCount + acc.status3xxCount;
  const topStatusCodes = Array.from(acc.statusCounts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status - b.status)
    .slice(0, MAX_TOP_STATUS_CODES);

  return {
    method: acc.method,
    normalizedPath: acc.normalizedPath,
    totalLogRequests: acc.totalLogRequests,
    observedUsageCount,
    status2xxCount: acc.status2xxCount,
    status3xxCount: acc.status3xxCount,
    status4xxCount: acc.status4xxCount,
    status5xxCount: acc.status5xxCount,
    topStatusCodes,
    firstSeen: acc.firstSeen,
    lastSeen: acc.lastSeen,
    sourceLogFileCount: acc.sourceLogFiles.size,
    sourceLogFiles: Array.from(acc.sourceLogFiles),
    sampleLineRefs: acc.sampleLineRefs,
  };
}

/**
 * Aggregate a batch of `HttpRuntimeObservation` rows into per-endpoint
 * `EndpointRuntimeAggregate` entries keyed by `method + normalizedPath`.
 *
 * Returns:
 *   - `aggregates` — Map keyed by `${METHOD} ${normalizedPath}`. Pure-404
 *     routes are EXCLUDED entirely.
 *   - `unmatchedRouteHintCandidates` — flat array of aggregates whose
 *     `observedUsageCount` is `>= RUNTIME_UNMATCHED_HINT_THRESHOLD`. These
 *     are CANDIDATES for unmatched route hints; the matcher is the
 *     authority on which ones are truly unmatched (i.e. did not bind to
 *     any code endpoint candidate).
 */
export function aggregateObservations(
  observations: HttpRuntimeObservation[],
): {
  aggregates: Map<string, EndpointRuntimeAggregate>;
  unmatchedRouteHintCandidates: EndpointRuntimeAggregate[];
} {
  const accumulators = new Map<string, AggregateAccumulator>();

  for (const o of observations) {
    const method = (o.method ?? '').toUpperCase();
    if (!method) continue;
    const key = `${method} ${o.normalizedPath}`;

    let acc = accumulators.get(key);
    if (!acc) {
      acc = createAccumulator(method, o.normalizedPath);
      accumulators.set(key, acc);
    }
    applyObservation(acc, o);
  }

  const aggregates = new Map<string, EndpointRuntimeAggregate>();
  const unmatchedRouteHintCandidates: EndpointRuntimeAggregate[] = [];

  for (const [key, acc] of accumulators.entries()) {
    if (isPure404(acc)) continue;

    const materialized = materialize(acc);
    aggregates.set(key, materialized);

    if (materialized.observedUsageCount >= UNMATCHED_HINT_THRESHOLD) {
      unmatchedRouteHintCandidates.push(materialized);
    }
  }

  return { aggregates, unmatchedRouteHintCandidates };
}

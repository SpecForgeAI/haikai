/**
 * Coverage-floor evaluation (Spec 2026-07-06-k — Scenario Coverage Floor,
 * Code-Tier Oracle Program).
 *
 * PURE evaluator over the capture session's persisted
 * `coverage_summary_json` (written by the validation service's oracle
 * coverage scorer — one dimension per generated scenario, each carrying
 * `dimension_kind` + `reported_only` since Spec K; legacy summaries default
 * inside the scorer, so every summary reads uniformly).
 *
 * FLOOR POLICY (defaults; Spec K):
 *   floor-bearing  — `happy`, `error_status`, `validation`, `seed`
 *   reported-only  — `enum`, `filter`, `pagination`, `content_type`
 *                    (and anything flagged `reported_only: true`)
 *   auth           — the session-level auth dimension counts when present
 *
 * An operation MEETS the floor iff every floor-bearing dimension is achieved
 * or explicitly waived. Waivers are the Spec J table's per-(operation,
 * dimension) rows, passed in by the caller (Spec I's gate) — this module
 * stays pure.
 *
 * Consumed by Spec I's pre-dispatch gate (`code_coverage_floor_unmet`) and
 * by Spec G's capture-story planning (interface-level aggregation).
 */

export interface CoverageDimensionRow {
  name: string;
  type?: string;
  expected_status?: string;
  dimension_kind?: string;
  reported_only?: boolean;
  achieved: boolean;
  reason?: string | null;
}

export interface CoverageEndpointRow {
  operation_id: string;
  method: string;
  path: string;
  score?: number;
  dimensions: CoverageDimensionRow[];
}

export interface CoverageSummaryJson {
  per_endpoint?: CoverageEndpointRow[];
  auth_coverage?: { achieved?: boolean } | null;
  [key: string]: unknown;
}

export interface FloorPolicy {
  /** dimension_kind values that BLOCK the floor when missed. */
  floorBearingKinds: Set<string>;
}

export const DEFAULT_FLOOR_POLICY: FloorPolicy = {
  floorBearingKinds: new Set(['happy', 'error_status', 'validation', 'seed']),
};

export interface OperationFloorResult {
  operationId: string;
  method: string;
  path: string;
  passed: boolean;
  /** Floor-bearing dimensions that were MISSED and not waived. */
  missedDimensions: Array<{ name: string; kind: string; reason: string | null }>;
  /** Floor-bearing dimensions missed but WAIVED (enumerated, never silent). */
  waivedDimensions: string[];
  /** Reported-only dimensions missed (informational; never blocks). */
  reportedMisses: string[];
}

export interface FloorEvaluation {
  operations: OperationFloorResult[];
  /** True iff EVERY operation passed (auth dimension folded in when present). */
  passed: boolean;
  authAchieved: boolean | null;
}

/**
 * Evaluate the floor over a session coverage summary. `waivedKeys` contains
 * `${METHOD} ${path}::${dimensionName}` keys the caller resolved from the
 * Spec J waiver table (dimension `break_fingerprint` rows by convention).
 * Legacy dimensions (no kind) default: success-expected -> happy, everything
 * else -> error_status — matching the scorer's own defaulting.
 */
export function evaluateCoverageFloor(
  summary: CoverageSummaryJson | null | undefined,
  waivedKeys: Set<string> = new Set(),
  policy: FloorPolicy = DEFAULT_FLOOR_POLICY,
): FloorEvaluation {
  const operations: OperationFloorResult[] = [];
  for (const endpoint of summary?.per_endpoint ?? []) {
    const missed: OperationFloorResult['missedDimensions'] = [];
    const waived: string[] = [];
    const reported: string[] = [];
    for (const dimension of endpoint.dimensions ?? []) {
      if (dimension.achieved) continue;
      const kind =
        dimension.dimension_kind ??
        (dimension.expected_status === 'success' ? 'happy' : 'error_status');
      const isReportedOnly =
        dimension.reported_only === true || !policy.floorBearingKinds.has(kind);
      if (isReportedOnly) {
        reported.push(dimension.name);
        continue;
      }
      const waiverKey = `${endpoint.method.toUpperCase()} ${endpoint.path}::${dimension.name}`;
      if (waivedKeys.has(waiverKey)) {
        waived.push(dimension.name);
        continue;
      }
      missed.push({ name: dimension.name, kind, reason: dimension.reason ?? null });
    }
    operations.push({
      operationId: endpoint.operation_id,
      method: endpoint.method,
      path: endpoint.path,
      passed: missed.length === 0,
      missedDimensions: missed,
      waivedDimensions: waived,
      reportedMisses: reported,
    });
  }
  const authAchieved =
    typeof summary?.auth_coverage?.achieved === 'boolean'
      ? summary.auth_coverage.achieved
      : null;
  return {
    operations,
    passed: operations.every((o) => o.passed) && authAchieved !== false,
    authAchieved,
  };
}

/**
 * Interface-level aggregation (Spec K amendment; Spec G's capture stories):
 * group operation results by an endpointId->operation match the caller
 * supplies (committed endpoint ids -> `${METHOD} ${path}` keys), returning
 * per-interface pass/fail + the offending operations.
 */
export function aggregateFloorByInterface(
  evaluation: FloorEvaluation,
  endpointKeysByInterfaceId: Map<string, Set<string>>,
): Map<string, { passed: boolean; failingOperations: OperationFloorResult[] }> {
  const byKey = new Map<string, OperationFloorResult>();
  for (const op of evaluation.operations) {
    byKey.set(`${op.method.toUpperCase()} ${op.path}`, op);
  }
  const out = new Map<string, { passed: boolean; failingOperations: OperationFloorResult[] }>();
  for (const [interfaceId, keys] of endpointKeysByInterfaceId) {
    const failing: OperationFloorResult[] = [];
    for (const key of keys) {
      const op = byKey.get(key);
      if (op && !op.passed) failing.push(op);
    }
    out.set(interfaceId, { passed: failing.length === 0, failingOperations: failing });
  }
  return out;
}

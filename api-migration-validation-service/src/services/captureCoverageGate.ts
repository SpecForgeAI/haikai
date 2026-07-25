/**
 * Happy-path coverage gate (Spec: 2026-07-20 API Behaviour Baseline Coverage
 * Closure -- CC1).
 *
 * The dimensional coverage summary (`captureSessionOrchestrator.CoverageSummary`)
 * answers "how much of the intended behaviour did we observe" -- up to 12
 * scenarios per endpoint. The Coverage Closure programme adds a SEPARATE, harder
 * question the capture screen must gate on before the user leaves it:
 *
 *   Has EVERY included endpoint captured its happy-path baseline?
 *
 * That -- not full dimensional coverage -- is what actually unblocks spec
 * generation and the migration plan downstream (user decision 2026-07-20,
 * option a: "if we have happy path then we have a good chance of a decent spec
 * and reconciliation does have ability to do bug fixes post implementation").
 * Dimensional coverage stays REPORTED as information; only happy-path gates.
 *
 * This module is the SINGLE SOURCE for that gate. It is PURE (a CoverageSummary
 * in, a verdict out -- no I/O) and derives the included set from
 * `per_endpoint`, which the orchestrator assembles over exactly the
 * `included === true` operations. An endpoint excluded-with-reason via
 * `account-endpoints` (`included = false`) is therefore already absent from
 * `per_endpoint` and correctly OUT of the gate denominator -- "accounted", not
 * "unresolved" (same doctrine as story deletion: out-of-scope != unresolved).
 *
 * The frontend mirrors this verbatim in `CoverageSummaryPanel.computeHappyPathGate`
 * so the capture-screen banner and any server-side closure driver can never
 * disagree; and it speaks the same "complete / unresolved" vocabulary as the
 * plan-screen preflight so the two gates stay consistent end-to-end.
 */
import type {
  CoverageSummary,
  EndpointCoverageResult,
  CoverageDimensionResult,
  ScenarioExpectedStatus,
} from './captureSessionOrchestrator';

/** One included endpoint still missing its happy-path baseline. */
export interface UnresolvedEndpoint {
  operation_id: string;
  method: string;
  path: string;
  /** Honest reason (the happy dimension's miss reason, or a default). */
  reason: string;
}

/** The happy-path gate verdict for a capture session. snake_case wire. */
export interface HappyPathGate {
  /**
   * True IFF at least one endpoint is included AND every included endpoint has
   * captured its happy-path baseline. A session with no coverage recorded, or
   * with zero included endpoints, is NOT complete (there is nothing to stand
   * behind yet).
   */
  complete: boolean;
  /** Included (scored) endpoints -- the gate denominator. */
  included_total: number;
  /** Included endpoints whose happy-path dimension was achieved. */
  happy_achieved: number;
  /** The still-unresolved included endpoints (empty when complete). */
  unresolved: UnresolvedEndpoint[];
}

/** The happy-path dimension of an endpoint (type or name `happy_path`). */
function happyDimensionOf(
  ep: EndpointCoverageResult,
): CoverageDimensionResult | undefined {
  return ep.dimensions.find(
    (d) => d.type === 'happy_path' || d.name === 'happy_path',
  );
}

/**
 * Compute the happy-path gate from a (possibly null) coverage summary. Pure.
 *
 * - `null` summary (never captured / legacy / unrecorded) -> not complete,
 *   nothing accounted, no unresolved list (the caller shows "run capture
 *   first", not a red remnant list).
 * - Otherwise: every `per_endpoint` entry whose happy-path dimension is
 *   achieved counts toward `happy_achieved`; the rest become `unresolved`.
 */
export function computeHappyPathGate(
  summary: CoverageSummary | null | undefined,
): HappyPathGate {
  if (!summary || !Array.isArray(summary.per_endpoint)) {
    return {
      complete: false,
      included_total: 0,
      happy_achieved: 0,
      unresolved: [],
    };
  }
  const unresolved: UnresolvedEndpoint[] = [];
  let happyAchieved = 0;
  for (const ep of summary.per_endpoint) {
    const happy = happyDimensionOf(ep);
    if (happy && happy.achieved) {
      happyAchieved += 1;
    } else {
      unresolved.push({
        operation_id: ep.operation_id,
        method: ep.method,
        path: ep.path,
        reason:
          (happy && happy.reason) ||
          'happy-path baseline not captured (no successful reference request recorded)',
      });
    }
  }
  const includedTotal = summary.per_endpoint.length;
  return {
    complete: includedTotal > 0 && unresolved.length === 0,
    included_total: includedTotal,
    happy_achieved: happyAchieved,
    unresolved,
  };
}

// ---------------------------------------------------------------------------
// Dimensional retry set (2026-07-25 — closure retry for ALL failed coverage
// dimensions). The GATE stays happy-path-only; this collector feeds the
// OPTIONAL "also retry other failed coverage dimensions" pass, which drives
// dimensional coverage toward 100% without changing what gates.
// ---------------------------------------------------------------------------

/** One failed, retryable coverage dimension of an included endpoint. */
export interface FailedDimensionRef {
  operation_id: string;
  method: string;
  path: string;
  /** Scenario/dimension name (the summary's identity for the flip-on-close). */
  name: string;
  type: string;
  expected_status: ScenarioExpectedStatus;
  reason: string | null;
}

/** The happy-path dimension identity (Pass A/B territory, never in this set). */
function isHappyDimension(d: CoverageDimensionResult): boolean {
  return d.type === 'happy_path' || d.name === 'happy_path';
}

/**
 * Collect every retryable failed dimension: `achieved === false`, NOT
 * reported-only (those never block and are informational by design), and NOT
 * the happy-path dimension (the main closure passes own that). Pure.
 */
export function collectFailedDimensions(
  summary: CoverageSummary | null | undefined,
): FailedDimensionRef[] {
  if (!summary || !Array.isArray(summary.per_endpoint)) return [];
  const failed: FailedDimensionRef[] = [];
  for (const ep of summary.per_endpoint) {
    for (const d of ep.dimensions) {
      if (d.achieved || d.reported_only || isHappyDimension(d)) continue;
      failed.push({
        operation_id: ep.operation_id,
        method: ep.method,
        path: ep.path,
        name: d.name,
        type: d.type,
        expected_status: d.expected_status,
        reason: d.reason ?? null,
      });
    }
  }
  return failed;
}

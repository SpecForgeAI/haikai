/**
 * Micro-average aggregation for the V3 evaluation harness.
 *
 * Spec: `agent-os/specs/2026-04-19-v3-evaluation-harness` (Task Group 2.4).
 *
 * Per the spec's "Aggregation" bullet (and requirements.md Q10), metrics roll
 * up via MICRO-AVERAGE rather than arithmetic mean of per-fixture rates:
 *
 *     per-framework numerator   = sum(per-fixture numerator)
 *     per-framework denominator = sum(per-fixture denominator)
 *     per-framework rate        = numerator / denominator
 *
 *     global numerator   = sum(per-framework numerator)
 *     global denominator = sum(per-framework denominator)
 *     global rate        = numerator / denominator
 *
 * This preserves the weight of fixtures with more expected entries (or more
 * LLM candidates) — arithmetic-mean aggregation would let a 1/1 fixture wash
 * out a 0/9 fixture, which is NOT the behavior we want for regression gating.
 *
 * Per-fixture breakdown is kept in the framework report for debugging
 * (spec "Outputs" section); aggregation does not collapse it.
 */

import { computeValues } from './metrics';
import type {
  FixtureReport,
  FrameworkReport,
  MetricCountSet,
} from './types';

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Build a `FrameworkReport` from an array of per-fixture reports.
 *
 * Does NOT compute baseline verdicts — that is `baseline.ts`'s job. The
 * runner chains them together. We keep verdicts out of here so this module
 * can be exercised in isolation for its math.
 */
export function aggregateFramework(
  frameworkId: string,
  fixtureReports: FixtureReport[],
): FrameworkReport {
  const aggregateCounts = sumCounts(fixtureReports.map((fr) => fr.counts));
  const aggregateValues = computeValues(aggregateCounts);
  return {
    frameworkId,
    fixtureReports,
    aggregateCounts,
    aggregateValues,
    // Runner / baseline module fill these in post-hoc; we return a structure
    // that matches the contract but with placeholders that will be overwritten.
    verdicts: emptyVerdictPlaceholders(),
    overallStatus: 'pass',
  };
}

/**
 * Build a global aggregate (global counts + values) from an array of
 * framework reports. Returns the sum-of-framework-counts and derived values
 * only — the caller decides what to attach them to (typically the
 * `AggregateReport` top-level).
 */
export function aggregateGlobal(frameworkReports: FrameworkReport[]): {
  aggregateCounts: MetricCountSet;
  aggregateValues: ReturnType<typeof computeValues>;
} {
  const aggregateCounts = sumCounts(frameworkReports.map((fr) => fr.aggregateCounts));
  return {
    aggregateCounts,
    aggregateValues: computeValues(aggregateCounts),
  };
}

/**
 * Sum an array of `MetricCountSet`s component-wise. Exported so callers who
 * already hold counts (e.g. `runner.ts` mid-flow) can roll them up without
 * first building full reports.
 */
export function sumCounts(sets: MetricCountSet[]): MetricCountSet {
  const out = zeroedMetricCountSet();
  for (const s of sets) {
    out.packRecall.numerator += s.packRecall.numerator;
    out.packRecall.denominator += s.packRecall.denominator;
    out.gapFillPrecision.numerator += s.gapFillPrecision.numerator;
    out.gapFillPrecision.denominator += s.gapFillPrecision.denominator;
    out.gapFillRecall.numerator += s.gapFillRecall.numerator;
    out.gapFillRecall.denominator += s.gapFillRecall.denominator;
    out.duplicationRate.numerator += s.duplicationRate.numerator;
    out.duplicationRate.denominator += s.duplicationRate.denominator;
    out.hallucinationRate.numerator += s.hallucinationRate.numerator;
    out.hallucinationRate.denominator += s.hallucinationRate.denominator;
  }
  return out;
}

/**
 * Build a zeroed `MetricCountSet` — useful as an accumulator seed.
 */
export function zeroedMetricCountSet(): MetricCountSet {
  return {
    packRecall: { numerator: 0, denominator: 0 },
    gapFillPrecision: { numerator: 0, denominator: 0 },
    gapFillRecall: { numerator: 0, denominator: 0 },
    duplicationRate: { numerator: 0, denominator: 0 },
    hallucinationRate: { numerator: 0, denominator: 0 },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/**
 * Produce a placeholder verdict map for the `FrameworkReport` shape. Values
 * are overwritten by `baseline.ts` before the runner returns; we only need
 * them here so the object has the contractually-required shape if a caller
 * serializes it before baseline comparison runs.
 */
function emptyVerdictPlaceholders(): FrameworkReport['verdicts'] {
  const mk = (direction: 'decrease' | 'increase'): FrameworkReport['verdicts']['packRecall'] => ({
    current: NaN,
    baseline: null,
    delta: 0,
    direction,
    threshold: 0.05,
    status: 'no-baseline',
  });
  return {
    packRecall: mk('decrease'),
    gapFillPrecision: mk('decrease'),
    gapFillRecall: mk('decrease'),
    duplicationRate: mk('increase'),
    hallucinationRate: mk('increase'),
  };
}

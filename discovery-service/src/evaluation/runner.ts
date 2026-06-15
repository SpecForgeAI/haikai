/**
 * Shared evaluation runner library.
 *
 * Spec: `agent-os/specs/2026-04-19-v3-evaluation-harness`.
 *
 * This file exposes the `runEvaluation(options)` entry point the CLI
 * (`scripts/run-evaluation.ts`, built in Group 4) and any future consumers
 * (`run-pack-local.ts`, `run-spring-classic-local.ts`) will call.
 *
 * Flow:
 *
 *   load fixtures -> invoke pipeline per fixture -> score (metrics.ts) ->
 *   aggregate per-framework + global (aggregation.ts) -> compare baseline
 *   (baseline.ts) -> build AggregateReport
 *
 * Real implementations live in sibling modules:
 * - `metrics.ts`:           per-fixture scoring      (`scoreFixture`)
 * - `aggregation.ts`:       micro-average rollup     (`aggregateFramework`, `aggregateGlobal`)
 * - `baseline.ts`:          directional regression   (`compareToBaseline`)
 * - `pipelineInvoker.ts`:   default pipeline invoker (pack-pair dispatch)
 *
 * Group 3 wired the real fixture-replay + live + live/record LLM strategies
 * from `llmFixtureStrategy.ts` into the per-fixture loop below.
 *
 * CLI ergonomics / logging style are mirrored from
 * `scripts/run-pack-local.ts` and `scripts/run-spring-classic-local.ts`:
 *
 *   [evaluation] ...
 *   [evaluation:spring-classic] ...
 *   [evaluation:spring-classic/<case>] ...
 */

import { aggregateFramework, aggregateGlobal, zeroedMetricCountSet } from './aggregation';
import { compareToBaseline as compareToBaselineImpl } from './baseline';
import {
  DEFAULT_FIXTURES_ROOT,
  DEFAULT_LLM_FIXTURES_ROOT,
  loadAllFixtures,
  loadFrameworkFixtures,
} from './fixtureLoader';
import { computeValues, scoreFixture as scoreFixtureImpl } from './metrics';
import { defaultEvaluationPipelineInvoker } from './pipelineInvoker';
import type {
  AggregateReport,
  FixtureCase,
  FixtureReport,
  FrameworkReport,
  LlmFixtureSession,
  LlmFixtureStrategy,
  MetricCountSet,
  MetricValues,
  MetricVerdict,
  PipelineInvocationCandidate,
  PipelineInvocationResult,
  PipelineInvoker,
  RunEvaluationOptions,
} from './types';

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Run the full evaluation harness flow and return a structured
 * `AggregateReport`.
 *
 * Flow:
 *   1. Load fixtures (filtered by `frameworkIds` when provided).
 *   2. For each fixture: install the LLM fixture strategy, invoke the
 *      pipeline (in a try/finally so the patch is always restored).
 *   3. Score each fixture via `metrics.ts:scoreFixture`.
 *   4. Aggregate per framework via `aggregation.ts:aggregateFramework`, then
 *      globally via `aggregation.ts:aggregateGlobal`.
 *   5. For each framework, derive per-metric verdicts via
 *      `baseline.ts:compareToBaseline` (unless `skipBaselineComparison`).
 *   6. Return the `AggregateReport` for the CLI / JSON writer.
 *
 * This function is pure relative to its arguments and the filesystem — it
 * does NOT read CLI args, does NOT write JSON reports, and does NOT exit the
 * process. The CLI layer (Group 4) owns those concerns.
 */
export async function runEvaluation(
  options: RunEvaluationOptions = {},
): Promise<AggregateReport> {
  const fixturesRoot = options.fixturesRoot ?? DEFAULT_FIXTURES_ROOT;
  const invokePipeline = options.invokePipeline ?? defaultPipelineInvoker;
  const llmStrategy = options.llmStrategy ?? defaultLlmFixtureStrategy;

  const fixtures = selectFixtures(options.frameworkIds, fixturesRoot);
  if (fixtures.length === 0) {
    console.log('[evaluation] no fixtures matched the requested filter; nothing to run.');
    return buildEmptyReport();
  }

  // Run each fixture. We keep this sequential: the pipeline is IO-bound per
  // fixture (file read + pack adapt + optional LLM call) but the LLM
  // fixture-strategy swap on `gatewayClient.gapFill` is a GLOBAL patch and
  // must stay serialized to avoid cross-fixture leakage.
  //
  // Group 3 note: `beginFixture(fixture)` installs the `gatewayClient.gapFill`
  // patch for the fixture's duration; `session.end()` restores it. The
  // try/finally guarantees the patch is always removed even if the pipeline
  // invocation throws, so a mid-run failure never contaminates subsequent
  // fixtures with a stale replay shim.
  const fixtureReports: FixtureReport[] = [];
  for (const fixture of fixtures) {
    console.log(
      `[evaluation:${fixture.frameworkId}/${fixture.caseId}] invoking pipeline (${fixture.sourceFileName})`,
    );
    const session: LlmFixtureSession = await llmStrategy.beginFixture(fixture);
    let pipelineResult: PipelineInvocationResult;
    try {
      pipelineResult = await invokePipeline(fixture);
    } finally {
      await session.end();
    }
    fixtureReports.push(scoreFixtureImpl(fixture, pipelineResult));
  }

  // Aggregate per framework, then globally.
  const byFramework = new Map<string, FixtureReport[]>();
  for (const fr of fixtureReports) {
    const list = byFramework.get(fr.frameworkId) ?? [];
    list.push(fr);
    byFramework.set(fr.frameworkId, list);
  }

  const frameworkReports: FrameworkReport[] = [];
  for (const [frameworkId, reports] of byFramework.entries()) {
    // `aggregateFramework` returns the framework report with placeholder
    // verdicts; we overwrite verdicts + overallStatus based on baseline
    // comparison (or skip it for `skipBaselineComparison`).
    const base = aggregateFramework(frameworkId, reports);
    const verdicts = options.skipBaselineComparison
      ? passVerdicts(base.aggregateValues)
      : compareToBaselineImpl(frameworkId, base.aggregateValues, options);
    const overallStatus: 'pass' | 'fail' = Object.values(verdicts).some(
      (v) => v.status === 'fail',
    )
      ? 'fail'
      : 'pass';
    frameworkReports.push({
      ...base,
      verdicts,
      overallStatus,
    });
  }

  const globalAggregate = aggregateGlobal(frameworkReports);
  const overallStatus: 'pass' | 'fail' = frameworkReports.some(
    (fr) => fr.overallStatus === 'fail',
  )
    ? 'fail'
    : 'pass';

  return {
    frameworkReports,
    aggregateCounts: globalAggregate.aggregateCounts,
    aggregateValues: globalAggregate.aggregateValues,
    overallStatus,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Fixture selection.
// ---------------------------------------------------------------------------

/**
 * Resolve the `frameworkIds` filter into the fixture list. Exported for
 * focused tests that want to exercise selection without running the whole
 * orchestrator.
 */
export function selectFixtures(
  frameworkIds: string[] | undefined,
  fixturesRoot: string = DEFAULT_FIXTURES_ROOT,
  llmFixturesRoot: string = DEFAULT_LLM_FIXTURES_ROOT,
): FixtureCase[] {
  if (!frameworkIds || frameworkIds.length === 0) {
    return loadAllFixtures(fixturesRoot, llmFixturesRoot);
  }
  const out: FixtureCase[] = [];
  for (const fwId of frameworkIds) {
    out.push(...loadFrameworkFixtures(fwId, fixturesRoot, llmFixturesRoot));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Defaults / injection points.
// ---------------------------------------------------------------------------

/**
 * Default pipeline invoker.
 *
 * Delegates to `pipelineInvoker.ts:defaultEvaluationPipelineInvoker` which
 * runs the deterministic pack pair for `spring-classic` fixtures and returns
 * an empty result for frameworks whose V3 packs haven't yet been migrated
 * (django / rails — Spec 4 work).
 *
 * Tests that want to exercise the runner's scoring/aggregation logic without
 * touching the real pack pipeline continue to inject their own
 * `invokePipeline` via `RunEvaluationOptions`.
 */
export const defaultPipelineInvoker: PipelineInvoker = defaultEvaluationPipelineInvoker;

/**
 * Default LLM fixture strategy.
 *
 * A no-op strategy that installs no patch on `gatewayClient.gapFill`. This is
 * safe for tests that inject their own pipeline invoker and therefore never
 * reach the real gateway. CLI callers (Group 4) supply the real replay /
 * live / record strategies from `llmFixtureStrategy.ts`.
 */
export const defaultLlmFixtureStrategy: LlmFixtureStrategy = {
  mode: 'replay',
  async beginFixture(_fixture: FixtureCase): Promise<LlmFixtureSession> {
    return {
      async end() {
        // No-op. The default strategy doesn't patch gatewayClient.gapFill.
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Thin re-exports of Group 2 implementations for backward compatibility.
//
// The Group 1 test suite imported `scoreFixture` and `compareToBaseline`
// directly from this module; we re-expose them so those imports continue to
// work without forcing the tests to change their import paths.
// ---------------------------------------------------------------------------

/**
 * Per-fixture scoring — delegates to `metrics.ts:scoreFixture`.
 *
 * Returns a full `FixtureReport` (not just counts) so callers can push the
 * result straight into the framework report array.
 */
export function scoreFixture(
  fixture: FixtureCase,
  pipelineResult: PipelineInvocationResult,
): FixtureReport {
  return scoreFixtureImpl(fixture, pipelineResult);
}

/**
 * Baseline comparison — delegates to `baseline.ts:compareToBaseline`.
 */
export function compareToBaseline(
  frameworkId: string,
  currentValues: MetricValues,
  options: Pick<RunEvaluationOptions, 'baselineDir' | 'thresholdsPath'> = {},
): Record<keyof MetricCountSet, MetricVerdict> {
  return compareToBaselineImpl(frameworkId, currentValues, options);
}

// ---------------------------------------------------------------------------
// Small helpers kept in runner.ts for Group 1 test compatibility.
// ---------------------------------------------------------------------------

/**
 * Re-export `computeValues` from `metrics.ts`. Group 1's tests and any
 * Group-4 formatter can consume it either from here or directly from
 * `metrics.ts`.
 */
export { computeValues } from './metrics';

/**
 * Re-export `sumCounts` and `zeroedMetricCountSet` from `aggregation.ts`.
 */
export { sumCounts, zeroedMetricCountSet } from './aggregation';

/**
 * Build an all-`pass` verdict set for the provided current values. Used by
 * `skipBaselineComparison` and preserved for Group 1 test compatibility.
 *
 * This is NOT the same as the `'no-baseline'`-producing `baseline.ts`
 * behavior: `skipBaselineComparison` is an explicit caller opt-out (used for
 * `--update-baseline` and for smoke runs), so `'pass'` is the right status.
 */
export function emptyVerdicts(
  current: MetricValues,
): Record<keyof MetricCountSet, MetricVerdict> {
  return passVerdicts(current);
}

/**
 * Internal: build a uniform `'pass'` verdict set. Broken out so the runner's
 * skip-baseline branch and the public `emptyVerdicts` helper share one
 * implementation.
 */
function passVerdicts(
  current: MetricValues,
): Record<keyof MetricCountSet, MetricVerdict> {
  const mk = (
    currentValue: number,
    direction: 'decrease' | 'increase',
  ): MetricVerdict => ({
    current: currentValue,
    baseline: null,
    delta: 0,
    direction,
    threshold: 0.05,
    status: 'pass',
  });
  return {
    packRecall: mk(current.packRecall, 'decrease'),
    gapFillPrecision: mk(current.gapFillPrecision, 'decrease'),
    gapFillRecall: mk(current.gapFillRecall, 'decrease'),
    duplicationRate: mk(current.duplicationRate, 'increase'),
    hallucinationRate: mk(current.hallucinationRate, 'increase'),
  };
}

/**
 * Canonical empty `AggregateReport`. Exported so Group 4's CLI can render
 * a polite "no fixtures found" message in the same shape it would render a
 * real run.
 */
export function buildEmptyReport(): AggregateReport {
  const counts = zeroedMetricCountSet();
  return {
    frameworkReports: [],
    aggregateCounts: counts,
    aggregateValues: computeValuesInline(counts),
    overallStatus: 'pass',
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Local copy of `computeValues` to avoid the circular re-export trap. The
 * public `computeValues` re-exported above is the one external callers should
 * use; this internal one keeps `buildEmptyReport` self-contained.
 */
function computeValuesInline(counts: MetricCountSet): MetricValues {
  const v = (c: { numerator: number; denominator: number }) =>
    c.denominator === 0 ? NaN : c.numerator / c.denominator;
  return {
    packRecall: v(counts.packRecall),
    gapFillPrecision: v(counts.gapFillPrecision),
    gapFillRecall: v(counts.gapFillRecall),
    duplicationRate: v(counts.duplicationRate),
    hallucinationRate: v(counts.hallucinationRate),
  };
}

// ---------------------------------------------------------------------------
// Re-exports for convenience.
// ---------------------------------------------------------------------------

export type {
  AggregateReport,
  FixtureCase,
  FixtureReport,
  FrameworkReport,
  LlmFixtureSession,
  LlmFixtureStrategy,
  MetricCountSet,
  MetricValues,
  MetricVerdict,
  PipelineInvocationCandidate,
  PipelineInvocationResult,
  PipelineInvoker,
  RunEvaluationOptions,
} from './types';

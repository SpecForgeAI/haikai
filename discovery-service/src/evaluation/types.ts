/**
 * Shared type definitions for the V3 Evaluation Harness.
 *
 * Spec: `agent-os/specs/2026-04-19-v3-evaluation-harness` (Task Groups 1 + 2 + 3).
 *
 * These types describe the data shapes threaded through the harness:
 *
 *   fixture directory (on disk)
 *     -> `FixtureCase` (in-memory, loaded by `fixtureLoader.ts`)
 *     -> pipeline invocation + scoring (wired in Groups 2/3)
 *     -> `FixtureReport` / `FrameworkReport` / `AggregateReport`
 *
 * Intentional omissions:
 * - No `filePath` on `ExpectedCandidate`. The source file is the case's
 *   `<case>.source` file, so `filePath` is implicit and omitting it prevents
 *   drift between the fixture filename and the expectations.
 * - No `confidence` on `ExpectedCandidate`. Confidence is a producer output,
 *   not ground truth, so it has no place in the expected-value shape.
 *
 * Matching semantics (spec "Matching semantics" section):
 * - Expected items match candidates on the canonical dedup key from
 *   `services/prompts/dedup.ts`: `(type, normalizeName(name), forward-slash filePath)`.
 * - `shouldNotEmit` entries match on `{ type, name }` ONLY (filePath-agnostic)
 *   so negative-example detection is robust to path normalization differences.
 * - The harness MUST NOT re-implement normalization; Group 2's matching
 *   module imports the helpers from `services/prompts/dedup.ts` directly.
 */

// ---------------------------------------------------------------------------
// Expected value shapes (what a human-authored `expected.json` contains).
// ---------------------------------------------------------------------------

/**
 * Ground-truth tier tag indicating which producer stage a candidate should
 * originate from.
 *
 * - `'pack'`     — deterministic extension pack should emit this.
 * - `'gap-fill'` — LLM gap-fill stage should emit this (pack cannot).
 * - `'either'`   — pack OR LLM may emit; credit is given to whichever does.
 */
export type ExpectedTag = 'pack' | 'gap-fill' | 'either';

/**
 * One ground-truth expected candidate from `<case>.expected.json`.
 *
 * Required: `type`, `name`, `tag`.
 * Optional: `description`, `notes` — free-form human context not used by
 *          matching or scoring, carried through for debuggability.
 */
export interface ExpectedCandidate {
  type: string;
  name: string;
  tag: ExpectedTag;
  description?: string;
  notes?: string;
}

/**
 * One negative-example entry from `<case>.expected.json`.
 *
 * A produced candidate that matches any `shouldNotEmit` entry on
 * `{ type, name }` counts as a hallucination, regardless of what the main
 * `expected` array contains.
 */
export interface ShouldNotEmitEntry {
  type: string;
  name: string;
}

/**
 * The full parsed contents of `<case>.expected.json`.
 *
 * This is the on-disk schema the fixture loader validates.
 */
export interface FixtureExpectations {
  expected: ExpectedCandidate[];
  shouldNotEmit: ShouldNotEmitEntry[];
}

// ---------------------------------------------------------------------------
// Loaded fixture shape (the in-memory representation of one fixture case).
// ---------------------------------------------------------------------------

/**
 * One loaded fixture case, sufficient to reconstruct a full evaluation
 * invocation context.
 *
 * Carries:
 * - framework id (e.g. `'spring-classic'`)
 * - case id (the fixture directory name inside the framework folder)
 * - the absolute path to the source file (so the pipeline's filePath-driven
 *   detectors behave realistically — the loader preserves the original
 *   filename/extension from `<case>.source`)
 * - the relative source filename the pipeline should see (`<case>.source`)
 * - the source file contents (pre-read for convenient per-fixture invocation)
 * - the parsed expectations from `<case>.expected.json`
 * - an optional path to the recorded LLM fixture at
 *   `evaluation/llm-fixtures/<framework>/<case>.llm-response.json` — Group 3
 *   will use this path to drive the replay/record swap on
 *   `gatewayClient.gapFill`.
 * - optional README text (loaded for diagnostics but not used in matching).
 */
export interface FixtureCase {
  frameworkId: string;
  caseId: string;
  /** Absolute path to the fixture directory. */
  fixtureDir: string;
  /** Absolute path to `<case>.source`. */
  sourceFilePath: string;
  /** Filename component of `<case>.source` (preserves original ext). */
  sourceFileName: string;
  /** Contents of `<case>.source`. */
  sourceContents: string;
  /** Parsed `<case>.expected.json`. */
  expectations: FixtureExpectations;
  /**
   * Absolute path to the recorded LLM response fixture. The file itself may
   * or may not exist on disk; existence is checked at replay time by Group 3.
   */
  llmFixturePath: string;
  /** Optional README.md contents if present. */
  readme?: string;
}

// ---------------------------------------------------------------------------
// Scoring / report shapes.
//
// Groups 2 + 3 implement the actual scoring and aggregation; the shapes
// themselves are fixed here so Group 1's skeleton, Group 2's metric modules,
// and Group 4's CLI formatter all agree on the data contract.
// ---------------------------------------------------------------------------

/**
 * Per-metric raw-count tuple.
 *
 * Retained instead of a pre-divided rate so per-framework and global
 * aggregation can micro-average (sum numerators, sum denominators, then
 * divide) per spec requirement.
 */
export interface MetricCounts {
  numerator: number;
  denominator: number;
}

/**
 * The five metrics the harness computes, keyed by metric id.
 *
 * Ids match the spec wording for easy cross-reference in markdown + JSON
 * reports. Group 2 is responsible for filling these in.
 */
export interface MetricCountSet {
  packRecall: MetricCounts;
  gapFillPrecision: MetricCounts;
  gapFillRecall: MetricCounts;
  duplicationRate: MetricCounts;
  hallucinationRate: MetricCounts;
}

/**
 * The five metrics as computed rate values (numerator/denominator, 0-1).
 *
 * NaN when denominator is zero; Group 2's formatter decides how to display
 * this (typically `n/a`).
 */
export interface MetricValues {
  packRecall: number;
  gapFillPrecision: number;
  gapFillRecall: number;
  duplicationRate: number;
  hallucinationRate: number;
}

/**
 * Per-metric baseline comparison verdict.
 *
 * `direction` records whether a decrease or an increase counts as a
 * regression for this metric (pack-recall / gap-fill-precision /
 * gap-fill-recall fail on decrease; duplication-rate / hallucination-rate
 * fail on increase).
 *
 * `status` values:
 * - `'pass'`         — within directional threshold.
 * - `'fail'`         — regression exceeds threshold.
 * - `'no-baseline'`  — no recorded baseline for this framework yet (the
 *                      runner does not fail on missing baselines; a human
 *                      eventually commits them via `--update-baseline`).
 */
export interface MetricVerdict {
  current: number;
  baseline: number | null;
  delta: number;
  /** Direction that counts as a regression for this metric. */
  direction: 'decrease' | 'increase';
  /** Fractional threshold (e.g. 0.05 = 5%). */
  threshold: number;
  /** `pass` when no regression; `fail` when regression exceeds threshold; `'no-baseline'` when no baseline is available. */
  status: 'pass' | 'fail' | 'no-baseline';
}

/**
 * Per-fixture report: the smallest addressable unit in the JSON report.
 *
 * Carries raw counts (for aggregation) plus the derived metric values (for
 * the markdown per-fixture breakdown).
 */
export interface FixtureReport {
  frameworkId: string;
  caseId: string;
  sourceFileName: string;
  counts: MetricCountSet;
  values: MetricValues;
}

/**
 * Per-framework report: micro-averaged from the per-fixture counts plus
 * per-metric baseline comparison verdicts.
 */
export interface FrameworkReport {
  frameworkId: string;
  fixtureReports: FixtureReport[];
  aggregateCounts: MetricCountSet;
  aggregateValues: MetricValues;
  verdicts: Record<keyof MetricCountSet, MetricVerdict>;
  /** Overall framework verdict: `fail` if any metric verdict is `fail`. */
  overallStatus: 'pass' | 'fail';
}

/**
 * Top-level report produced by `runEvaluation` — per-framework rollups plus
 * a global micro-average across every fixture in the run.
 *
 * `overallStatus` is `fail` if any framework's `overallStatus` is `fail`, so
 * the CLI can map it to exit code 1 for regression gating.
 */
export interface AggregateReport {
  frameworkReports: FrameworkReport[];
  aggregateCounts: MetricCountSet;
  aggregateValues: MetricValues;
  overallStatus: 'pass' | 'fail';
  /** ISO timestamp when the report was built. */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Runner options / injection points.
// ---------------------------------------------------------------------------

/**
 * Minimal shape the runner needs from the discovery pipeline invocation per
 * fixture. Keeping this narrow so tests can inject a fake without pulling in
 * the whole `V3PipelineResult` shape.
 *
 * `packCandidates` and `llmCandidates` are split because the metric
 * calculators differentiate between the two sources.
 *
 * Each candidate carries the dedup-key triple (`type` / `name` / `filePath`)
 * so Group 2's matching module can feed them straight into the canonical
 * dedup helpers without any runner-side adaptation.
 */
export interface PipelineInvocationCandidate {
  type: string;
  name: string;
  filePath: string;
}

export interface PipelineInvocationResult {
  packCandidates: PipelineInvocationCandidate[];
  llmCandidates: PipelineInvocationCandidate[];
}

/**
 * The pipeline invoker the runner calls once per fixture.
 *
 * Default implementation wraps `runDiscoveryV3` (Group 2/3 wire that in).
 * Tests inject a fake to exercise the runner skeleton without spinning up
 * the whole pipeline.
 */
export type PipelineInvoker = (fixture: FixtureCase) => Promise<PipelineInvocationResult>;

// ---------------------------------------------------------------------------
// LLM fixture replay / record strategy (Task Group 3).
// ---------------------------------------------------------------------------

/**
 * Mode selector for the LLM fixture strategy.
 *
 * - `'replay'` (default) — load a recorded `<case>.llm-response.json` from
 *   `evaluation/llm-fixtures/<framework>/` and return it whenever
 *   `gatewayClient.gapFill` is called during the fixture's pipeline run.
 * - `'live'` — pass through to the real `gatewayClient.gapFill` without
 *   capturing anything. Used by the `--live` CLI flag.
 * - `'record'` — pass through to the real `gatewayClient.gapFill` AND
 *   capture the response to disk at the fixture's `llmFixturePath`. Used by
 *   `--live --record` to regenerate the recorded fixtures after a prompt
 *   change.
 */
export type LlmMode = 'replay' | 'live' | 'record';

/**
 * A per-fixture session returned by `LlmFixtureStrategy.beginFixture`.
 *
 * The session owns the temporary patch on `gatewayClient.gapFill`; `end()`
 * MUST restore the original method (and, in record mode, persist captured
 * responses to disk). Runners call `end()` in a try/finally so a pipeline
 * failure never leaves the patch installed.
 */
export interface LlmFixtureSession {
  /**
   * Restore the original `gatewayClient.gapFill` and — in record mode —
   * write captured responses to `<fixture>.llmFixturePath`.
   */
  end(): Promise<void>;
}

/**
 * The LLM fixture replay / record strategy the runner installs before each
 * fixture invocation.
 *
 * Default behaviour is fixture-replay from disk (see
 * `llmFixtureStrategy.ts`). `--live` and `--live --record` swap in different
 * strategies with the same interface.
 *
 * The runner calls `beginFixture(fixture)` BEFORE the pipeline runs and
 * `session.end()` AFTER (in a finally block). `beginFixture` patches
 * `gatewayClient.gapFill`; `session.end()` restores it.
 */
export interface LlmFixtureStrategy {
  /** Current mode — readable by runners for logging/debug. */
  mode: LlmMode;
  /** Install the per-fixture gatewayClient.gapFill patch. */
  beginFixture(fixture: FixtureCase): Promise<LlmFixtureSession>;
}

/**
 * Options accepted by `runEvaluation`.
 *
 * `frameworkIds` narrows the run to specific frameworks; omit or pass
 * `undefined` to run every framework found under the fixtures root.
 *
 * `baselineDir` and `thresholdsPath` are read by Group 2's baseline module;
 * they are threaded through here so the CLI can override the defaults.
 */
export interface RunEvaluationOptions {
  /** Framework ids to run (e.g. `['spring-classic']`). Omit for all. */
  frameworkIds?: string[];
  /** Root of the fixture tree; defaults to `discovery-service/evaluation/fixtures/`. */
  fixturesRoot?: string;
  /** Directory holding per-framework baseline JSON files. */
  baselineDir?: string;
  /** Path to `thresholds.json`. */
  thresholdsPath?: string;
  /**
   * When `true`, skip baseline comparison and simply report raw metrics.
   * Useful for `--update-baseline` and for early smoke runs before any
   * baseline has been recorded.
   */
  skipBaselineComparison?: boolean;
  /**
   * Injection point for the pipeline invoker. Default wraps
   * `runDiscoveryV3`; tests pass a fake.
   */
  invokePipeline?: PipelineInvoker;
  /**
   * Injection point for the LLM fixture replay/record strategy. Default is
   * fixture-replay from disk; `--live` / `--live --record` swap in other
   * implementations. Supply `undefined` to inherit the no-op default, which
   * is appropriate for tests that inject their own pipeline invoker and
   * therefore never reach `gatewayClient.gapFill`.
   */
  llmStrategy?: LlmFixtureStrategy;
}

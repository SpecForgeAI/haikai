/**
 * V3 Evaluation Harness CLI runner — Task Group 4.
 *
 * Spec: `agent-os/specs/2026-04-19-v3-evaluation-harness` (Task Group 4).
 *
 * Responsibilities:
 *   - Parse CLI flags.
 *   - Compose the shared `runEvaluation` call from
 *     `src/evaluation/runner.ts` with the requested LLM strategy
 *     (`replay` | `live` | `record`) built via
 *     `src/evaluation/llmFixtureStrategy.ts`.
 *   - Render a human-readable markdown summary table to stdout.
 *   - Write a full JSON report to
 *     `discovery-service/evaluation/reports/<framework>-<timestamp>.json`
 *     (or `global-<timestamp>.json` for `--all`).
 *   - Exit code `1` on any framework verdict `fail`; otherwise `0`.
 *   - Support `--update-baseline` which writes the current run's metrics to
 *     `discovery-service/evaluation/baselines/<framework>.json`.
 *
 * CLI shape (spec "Runner CLI" section):
 *
 *   npx tsx scripts/run-evaluation.ts [--framework <id> | --all]
 *                                     [--baseline <path>]
 *                                     [--update-baseline]
 *                                     [--live] [--record]
 *                                     [--report-dir <path>]
 *
 * Mirrors the lean CLI style of `scripts/run-pack-local.ts`,
 * `scripts/run-spring-classic-local.ts`, and `scripts/annotate-fixture.ts`:
 * tiny hand-rolled arg parser, `main()` wrapped for process exit, a testable
 * `runEvaluationCli(options)` export that the Group 4 test suite drives.
 *
 * Output columns (requirements):
 *
 *   | Metric              | Current | Baseline | Δ      | Direction | Verdict |
 *   |---------------------|--------:|---------:|-------:|-----------|---------|
 *   | Pack recall         | 0.945   | 0.942    | +0.003 | ↑ better  | pass    |
 *   | ...                                                                     |
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

import {
  DEFAULT_BASELINE_DIR,
  DEFAULT_THRESHOLDS_PATH,
  METRIC_DIRECTIONS,
  writeBaseline,
} from '../src/evaluation/baseline';
import { DEFAULT_FIXTURES_ROOT } from '../src/evaluation/fixtureLoader';
import { createLlmStrategy } from '../src/evaluation/llmFixtureStrategy';
import { runEvaluation } from '../src/evaluation/runner';
import type {
  AggregateReport,
  LlmMode,
  MetricCountSet,
  MetricValues,
  MetricVerdict,
  PipelineInvoker,
} from '../src/evaluation/types';

// ---------------------------------------------------------------------------
// Defaults.
// ---------------------------------------------------------------------------

/**
 * Default reports directory. Resolved against this script's own `__dirname`
 * so `npx tsx scripts/run-evaluation.ts` lands the report in the right
 * place regardless of `process.cwd()`.
 */
export const DEFAULT_REPORTS_DIR = path.resolve(
  __dirname,
  '..',
  'evaluation',
  'reports',
);

// ---------------------------------------------------------------------------
// CLI option + result shapes.
// ---------------------------------------------------------------------------

/**
 * Input to the testable `runEvaluationCli` entry point. Mirrors the CLI flag
 * surface plus a few injection points (pipeline invoker, LLM strategy override,
 * clock) the test suite uses.
 */
export interface RunEvaluationCliOptions {
  /** `--framework <id>` — run one framework. */
  framework?: string;
  /** `--all` — run every framework under `fixturesRoot`. */
  all?: boolean;
  /** `--baseline <path>` — override the default per-framework baseline file. */
  baselinePath?: string;
  /** `--update-baseline` — write the current run as the new baseline. */
  updateBaseline?: boolean;
  /** `--live` — use the real gatewayClient.gapFill (no replay). */
  live?: boolean;
  /** `--record` — (only with --live) capture responses to llm-fixtures. */
  record?: boolean;
  /** `--report-dir <path>` — override the default reports directory. */
  reportsDir?: string;

  // -----------------------------------------------------------------
  // Path overrides — exposed to tests, mirror `RunEvaluationOptions`.
  // -----------------------------------------------------------------
  /** Override the fixtures root; tests point at a tmp directory. */
  fixturesRoot?: string;
  /**
   * Override the LLM fixtures root. Retained as a testable hook even though
   * `runEvaluation` currently resolves this internally from the fixture
   * loader's default; keeping it on the interface means future runner
   * changes that thread it through won't require CLI plumbing changes.
   */
  llmFixturesRoot?: string;
  /** Override the baselines directory. */
  baselineDir?: string;
  /** Override the thresholds.json path. */
  thresholdsPath?: string;

  // -----------------------------------------------------------------
  // Test-only injection points.
  // -----------------------------------------------------------------
  /** Inject a fake pipeline invoker so tests skip the real pack pipeline. */
  invokePipeline?: PipelineInvoker;
  /** When true, bypass baseline comparison (used for bootstrap runs). */
  skipBaselineComparison?: boolean;
  /** Inject a stable ISO string for deterministic report filenames. */
  nowIso?: string;
}

/**
 * Result returned from the testable `runEvaluationCli` entry point. The CLI
 * `main()` wrapper uses `exitCode` + prints `markdown` to stdout; tests
 * inspect every field.
 */
export interface RunEvaluationCliResult {
  exitCode: 0 | 1;
  report: AggregateReport;
  markdown: string;
  /** Absolute path of the written JSON report (null when no fixtures ran). */
  reportPath: string | null;
  /** Absolute path of the written baseline (only with `--update-baseline`). */
  baselinePath: string | null;
  /** Resolved LLM mode (`replay` default; `live` / `record` via flags). */
  llmMode: LlmMode;
}

// ---------------------------------------------------------------------------
// Testable entry point.
// ---------------------------------------------------------------------------

/**
 * Compose the full CLI flow:
 *
 *   1. Validate flag combinations (`--record` requires `--live`,
 *      exactly one of `--framework`/`--all`).
 *   2. Resolve the LLM strategy (`replay` / `live` / `record`).
 *   3. Call `runEvaluation(...)` with the resolved paths.
 *   4. Render the markdown summary.
 *   5. Write the JSON report to `<reportsDir>/<scope>-<timestamp>.json`.
 *   6. If `--update-baseline`, write the new baseline.
 *   7. Return an aggregate result for the caller (`main()` or tests).
 *
 * The CLI layer DOES NOT call `process.exit` — the caller decides. Tests
 * therefore never accidentally tear down the Jest worker.
 */
export async function runEvaluationCli(
  options: RunEvaluationCliOptions,
): Promise<RunEvaluationCliResult> {
  validateFlagCombos(options);

  const fixturesRoot = options.fixturesRoot ?? DEFAULT_FIXTURES_ROOT;
  const baselineDir = options.baselineDir ?? DEFAULT_BASELINE_DIR;
  const reportsDir = options.reportsDir ?? DEFAULT_REPORTS_DIR;
  const thresholdsPath = options.thresholdsPath ?? DEFAULT_THRESHOLDS_PATH;

  // Resolve the LLM strategy.
  //
  // `record` implies `live` (we pass through to the real gateway AND capture);
  // `live` without `record` is plain pass-through; the default is replay.
  const llmMode: LlmMode = options.record
    ? 'record'
    : options.live
      ? 'live'
      : 'replay';

  // Work out which frameworks to run. `--framework` narrows to one;
  // `--all` walks the fixtures root. When tests inject an invokePipeline
  // they may rely on skipBaselineComparison, too — preserved here.
  const frameworkIds = options.framework ? [options.framework] : undefined;

  // When the caller supplied `invokePipeline`, they don't go through
  // gatewayClient.gapFill at all. In that case using the default no-op LLM
  // strategy (from runner.ts) is appropriate — passing the real
  // replay/live/record strategies would install a gatewayClient patch for
  // each fixture that's never invoked but still consumes file I/O. We only
  // wire a real strategy when the caller is going through the real pipeline.
  const llmStrategy = options.invokePipeline
    ? undefined
    : createLlmStrategy(llmMode);

  // For `--update-baseline` runs we skip baseline comparison — the baseline
  // we're about to write is the new baseline, so comparing the current run to
  // the old one would produce verdicts the operator doesn't care about.
  const skipBaselineComparison =
    options.skipBaselineComparison ?? Boolean(options.updateBaseline);

  const report = await runEvaluation({
    frameworkIds,
    fixturesRoot,
    baselineDir,
    thresholdsPath,
    skipBaselineComparison,
    invokePipeline: options.invokePipeline,
    llmStrategy,
  });

  const markdown = renderMarkdownSummary(report);
  const reportScope = options.framework ?? 'global';
  const reportPath = await writeJsonReport(
    reportsDir,
    reportScope,
    report,
    options.nowIso ?? report.generatedAt,
  );

  let baselinePath: string | null = null;
  if (options.updateBaseline) {
    // `--update-baseline` only makes sense per-framework. For `--all` we
    // write one baseline file per framework.
    for (const fr of report.frameworkReports) {
      baselinePath = writeBaseline(fr.frameworkId, fr.aggregateValues, baselineDir);
    }
  }

  return {
    exitCode: report.overallStatus === 'fail' ? 1 : 0,
    report,
    markdown,
    reportPath,
    baselinePath,
    llmMode,
  };
}

// ---------------------------------------------------------------------------
// Flag validation.
// ---------------------------------------------------------------------------

function validateFlagCombos(options: RunEvaluationCliOptions): void {
  if (options.record && !options.live) {
    throw new Error(
      '[run-evaluation] --record requires --live. Remove --record, or add --live to actually re-hit the LLM and capture its response.',
    );
  }
  if (options.framework && options.all) {
    throw new Error(
      '[run-evaluation] Pass exactly one of --framework <id> or --all, not both.',
    );
  }
  if (!options.framework && !options.all) {
    throw new Error(
      '[run-evaluation] Pass one of --framework <id> or --all.',
    );
  }
}

// ---------------------------------------------------------------------------
// Markdown summary rendering.
// ---------------------------------------------------------------------------

/**
 * Human-readable metric labels in the order the spec shows in the requirements.
 */
const METRIC_LABELS: Array<[keyof MetricCountSet, string]> = [
  ['packRecall', 'Pack recall'],
  ['gapFillPrecision', 'Gap-fill precision'],
  ['gapFillRecall', 'Gap-fill recall'],
  ['duplicationRate', 'Duplication rate'],
  ['hallucinationRate', 'Hallucination rate'],
];

/**
 * Render the stdout markdown summary. Per the spec:
 *   - One `### Framework: <id>` section + table per framework.
 *   - One aggregate row per metric showing value, baseline, delta,
 *     direction arrow, verdict.
 *   - Global aggregate section after all frameworks.
 *   - Final `OVERALL: PASS` / `OVERALL: FAIL` line.
 */
export function renderMarkdownSummary(report: AggregateReport): string {
  const lines: string[] = [];

  for (const fr of report.frameworkReports) {
    lines.push('');
    lines.push(`### Framework: ${fr.frameworkId}`);
    lines.push('');
    lines.push(renderMetricTable(fr.aggregateValues, fr.verdicts));
    lines.push('');
  }

  // Global aggregate (only meaningful with more than one framework).
  if (report.frameworkReports.length > 1) {
    lines.push('### Global aggregate');
    lines.push('');
    lines.push(renderMetricTable(report.aggregateValues, null));
    lines.push('');
  }

  lines.push(`OVERALL: ${report.overallStatus === 'fail' ? 'FAIL' : 'PASS'}`);
  return lines.join('\n');
}

/**
 * Render a single metric table — one row per metric, columns:
 * Metric, Current, Baseline, Δ, Direction, Verdict.
 *
 * `verdicts === null` means render with no baseline / verdict columns filled
 * (used for the global aggregate row, which isn't baseline-scored).
 */
function renderMetricTable(
  values: MetricValues,
  verdicts: Record<keyof MetricCountSet, MetricVerdict> | null,
): string {
  const rows: string[] = [];
  rows.push('| Metric              | Current | Baseline | Δ      | Direction | Verdict |');
  rows.push('|---------------------|--------:|---------:|-------:|-----------|---------|');
  for (const [key, label] of METRIC_LABELS) {
    const current = values[key];
    const verdict = verdicts?.[key];
    const baseline = verdict?.baseline ?? null;
    const delta = verdict ? verdict.delta : 0;
    const direction = verdict
      ? directionArrow(verdict)
      : arrowForDirection(METRIC_DIRECTIONS[key]);
    const status = verdict ? verdict.status : '—';
    rows.push(
      `| ${padLabel(label)} | ${fmtNumber(current)} | ${fmtNumber(baseline)} | ${fmtDelta(delta)} | ${direction} | ${status} |`,
    );
  }
  return rows.join('\n');
}

/**
 * Up/down arrow with "better" or "worse" word — picked from the spec's
 * markdown example.
 */
function directionArrow(verdict: MetricVerdict): string {
  if (verdict.baseline === null || verdict.status === 'no-baseline') {
    return '—';
  }
  if (verdict.delta === 0) {
    return '=';
  }
  // `direction` captures which direction counts as a REGRESSION for this
  // metric. Delta sign tells us which direction we're actually moving.
  const movingUp = verdict.delta > 0;
  // For decrease-bad metrics (recall/precision): up = better, down = worse.
  // For increase-bad metrics (duplication/hallucination): up = worse, down = better.
  const isRegression =
    (verdict.direction === 'decrease' && !movingUp) ||
    (verdict.direction === 'increase' && movingUp);
  const arrow = movingUp ? '↑' : '↓';
  const qualifier = isRegression ? 'worse' : 'better';
  return `${arrow} ${qualifier}`;
}

/**
 * Fallback arrow renderer when we don't have a verdict (global aggregate
 * row). Just shows the "which direction is a regression" hint.
 */
function arrowForDirection(direction: 'decrease' | 'increase'): string {
  return direction === 'decrease' ? '↓ = worse' : '↑ = worse';
}

function fmtNumber(n: number | null): string {
  if (n === null) return 'n/a';
  if (Number.isNaN(n)) return 'n/a';
  return n.toFixed(3);
}

function fmtDelta(n: number): string {
  if (Number.isNaN(n)) return 'n/a';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(3)}`;
}

function padLabel(label: string): string {
  // Keep label column visually aligned with the header width (19 chars).
  const target = 19;
  if (label.length >= target) return label;
  return label + ' '.repeat(target - label.length);
}

// ---------------------------------------------------------------------------
// JSON report writer.
// ---------------------------------------------------------------------------

/**
 * Write the `AggregateReport` as JSON to
 * `<reportsDir>/<scope>-<timestamp>.json`. The scope is the framework id for
 * a scoped run, or the literal string `global` for `--all`.
 *
 * Creates the reports directory if it doesn't exist.
 *
 * Returns the absolute path of the written file, or `null` when the report
 * has no frameworks (nothing to record).
 */
async function writeJsonReport(
  reportsDir: string,
  scope: string,
  report: AggregateReport,
  nowIso: string,
): Promise<string | null> {
  if (report.frameworkReports.length === 0) {
    return null;
  }
  await fsPromises.mkdir(reportsDir, { recursive: true });
  // Filesystem-safe timestamp: strip colons from the ISO form.
  const stamp = nowIso.replace(/[:.]/g, '-');
  const filename = `${scope}-${stamp}.json`;
  const outPath = path.join(reportsDir, filename);
  await fsPromises.writeFile(
    outPath,
    JSON.stringify(report, null, 2) + '\n',
    'utf-8',
  );
  return outPath;
}

// ---------------------------------------------------------------------------
// CLI argument parsing.
// ---------------------------------------------------------------------------

/**
 * Tiny hand-rolled arg parser — mirrors the style of
 * `scripts/annotate-fixture.ts` and `scripts/run-pack-local.ts`. Accepts
 * `--flag value` pairs and boolean switches (`--all`, `--live`, `--record`,
 * `--update-baseline`).
 */
export function parseArgs(argv: string[]): RunEvaluationCliOptions {
  const out: RunEvaluationCliOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const takeValue = (): string => {
      const v = argv[i + 1];
      if (v === undefined) {
        throw new Error(`[run-evaluation] Missing value for ${flag}`);
      }
      i++;
      return v;
    };
    switch (flag) {
      case '--framework':
        out.framework = takeValue();
        break;
      case '--all':
        out.all = true;
        break;
      case '--baseline':
        out.baselinePath = takeValue();
        break;
      case '--update-baseline':
        out.updateBaseline = true;
        break;
      case '--live':
        out.live = true;
        break;
      case '--record':
        out.record = true;
        break;
      case '--report-dir':
        out.reportsDir = takeValue();
        break;
      default:
        throw new Error(`[run-evaluation] Unknown argument: ${flag}`);
    }
  }
  return out;
}

function printUsageAndExit(): never {
  console.error(
    'Usage:\n' +
      '  npx tsx scripts/run-evaluation.ts [--framework <id> | --all]\n' +
      '                                    [--baseline <path>]\n' +
      '                                    [--update-baseline]\n' +
      '                                    [--live] [--record]\n' +
      '                                    [--report-dir <path>]\n',
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// `main()` — the process-exit-owning CLI wrapper.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let opts: RunEvaluationCliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    printUsageAndExit();
  }

  // `--baseline <path>` targets a specific baseline FILE, but `runEvaluation`
  // takes a baseline DIR. When the caller passes a file we reinterpret it as
  // its parent dir (the spec shows `<framework>.json` inside a dir) — and if
  // it's a directory we pass it through verbatim.
  if (opts.baselinePath) {
    const p = opts.baselinePath;
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      opts.baselineDir = p;
    } else {
      opts.baselineDir = path.dirname(p);
    }
  }

  let result: RunEvaluationCliResult;
  try {
    result = await runEvaluationCli(opts);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(result.markdown);
  if (result.reportPath) {
    console.log(`\n[run-evaluation] Report written to ${result.reportPath}`);
  }
  if (result.baselinePath) {
    console.log(`[run-evaluation] Baseline updated at ${result.baselinePath}`);
  }
  process.exit(result.exitCode);
}

// Only auto-run when invoked as a script (not when imported by tests).
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

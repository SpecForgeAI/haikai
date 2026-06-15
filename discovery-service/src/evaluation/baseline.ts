/**
 * Baseline load/save + directional threshold gating for the V3 evaluation
 * harness.
 *
 * Spec: `agent-os/specs/2026-04-19-v3-evaluation-harness` (Task Group 2.5).
 *
 * Responsibilities:
 * - Load per-framework baseline JSON from
 *   `discovery-service/evaluation/baselines/<framework>.json`.
 * - Load optional per-framework threshold overrides from
 *   `discovery-service/evaluation/thresholds.json`.
 * - Compare a current run's per-framework metric values against the baseline
 *   and return a `MetricVerdict` per metric with directional semantics.
 * - Write a baseline file back to disk for `--update-baseline`.
 *
 * Directional semantics (spec "Regression gating" + requirements.md Q9):
 *   pack recall          — fail on DECREASE > threshold
 *   gap-fill precision   — fail on DECREASE > threshold
 *   gap-fill recall      — fail on DECREASE > threshold
 *   duplication rate     — fail on INCREASE > threshold
 *   hallucination rate   — fail on INCREASE > threshold
 *
 * The default threshold is 5% (`0.05`, absolute percentage-point delta).
 * `thresholds.json` may override per-framework, per-metric values; missing
 * entries fall back to the default. A missing thresholds file entirely is
 * fine — the default is used across the board.
 *
 * Missing baselines emit `'no-baseline'` verdicts rather than failing the run:
 * first-time frameworks need a way to bootstrap via `--update-baseline`
 * without tripping the regression gate on their own introduction.
 */

import * as fs from 'fs';
import * as path from 'path';

import type {
  MetricCountSet,
  MetricValues,
  MetricVerdict,
  RunEvaluationOptions,
} from './types';

// ---------------------------------------------------------------------------
// Defaults + constants.
// ---------------------------------------------------------------------------

/**
 * Default baseline directory.
 *
 * Resolved against this module's own `__dirname` to keep behavior identical
 * between `npx tsx` script runs and Jest test runs (same trick as
 * `fixtureLoader.ts`).
 */
export const DEFAULT_BASELINE_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'evaluation',
  'baselines',
);

/**
 * Default per-framework thresholds file.
 */
export const DEFAULT_THRESHOLDS_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'evaluation',
  'thresholds.json',
);

/**
 * Default directional threshold (5%) used whenever no override is supplied.
 */
export const DEFAULT_THRESHOLD = 0.05;

/**
 * The direction each metric treats as a regression. Matches the spec's
 * "Regression gating" bullet exactly.
 */
export const METRIC_DIRECTIONS: Record<keyof MetricCountSet, 'decrease' | 'increase'> = {
  packRecall: 'decrease',
  gapFillPrecision: 'decrease',
  gapFillRecall: 'decrease',
  duplicationRate: 'increase',
  hallucinationRate: 'increase',
};

// ---------------------------------------------------------------------------
// Baseline file shape.
// ---------------------------------------------------------------------------

/**
 * The on-disk shape of a per-framework baseline JSON file.
 *
 * Matches `MetricValues` exactly — one rate value per metric. Extra fields
 * are ignored on read and omitted on write.
 */
export type BaselineValues = MetricValues;

/**
 * Optional per-framework threshold overrides.
 *
 * Shape:
 *   {
 *     "<framework>": {
 *       packRecall?: number,
 *       gapFillPrecision?: number,
 *       gapFillRecall?: number,
 *       duplicationRate?: number,
 *       hallucinationRate?: number
 *     },
 *     ...
 *   }
 *
 * Any missing framework or metric falls back to `DEFAULT_THRESHOLD`.
 */
export type ThresholdOverrides = {
  [frameworkId: string]: Partial<Record<keyof MetricCountSet, number>>;
};

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Compare a framework's current micro-averaged metric values to its recorded
 * baseline and return a per-metric verdict.
 *
 * If the baseline file is missing, every metric's verdict is `'no-baseline'`
 * (with `baseline: null`) rather than a fail — this is the intentional
 * bootstrap behavior.
 *
 * `options` carries `baselineDir` and `thresholdsPath` overrides so the CLI
 * can redirect reads without mutating this module.
 */
export function compareToBaseline(
  frameworkId: string,
  currentValues: MetricValues,
  options: Pick<RunEvaluationOptions, 'baselineDir' | 'thresholdsPath'> = {},
): Record<keyof MetricCountSet, MetricVerdict> {
  const baselineDir = options.baselineDir ?? DEFAULT_BASELINE_DIR;
  const thresholdsPath = options.thresholdsPath ?? DEFAULT_THRESHOLDS_PATH;

  const baseline = loadBaseline(frameworkId, baselineDir);
  const overrides = loadThresholdOverrides(thresholdsPath);

  const out = {} as Record<keyof MetricCountSet, MetricVerdict>;
  for (const metric of Object.keys(METRIC_DIRECTIONS) as Array<keyof MetricCountSet>) {
    const direction = METRIC_DIRECTIONS[metric];
    const threshold =
      overrides?.[frameworkId]?.[metric] !== undefined
        ? (overrides[frameworkId]![metric] as number)
        : DEFAULT_THRESHOLD;

    if (baseline === null) {
      out[metric] = {
        current: currentValues[metric],
        baseline: null,
        delta: 0,
        direction,
        threshold,
        status: 'no-baseline',
      };
      continue;
    }

    const baselineValue = baseline[metric];
    const current = currentValues[metric];
    const delta = current - baselineValue;

    // When current is NaN (zero-denominator metric), we cannot judge
    // direction meaningfully. Treat as a pass — the operator will see NaN in
    // the summary and know to investigate.
    let status: MetricVerdict['status'];
    if (Number.isNaN(current) || Number.isNaN(baselineValue)) {
      status = 'pass';
    } else if (direction === 'decrease') {
      // Fail when current is less than baseline - threshold.
      status = delta < -threshold ? 'fail' : 'pass';
    } else {
      // direction === 'increase'; fail when current > baseline + threshold.
      status = delta > threshold ? 'fail' : 'pass';
    }

    out[metric] = {
      current,
      baseline: baselineValue,
      delta,
      direction,
      threshold,
      status,
    };
  }
  return out;
}

/**
 * Load a per-framework baseline or return `null` if the file is missing.
 *
 * Throws if the file exists but is not parseable JSON — a malformed baseline
 * is an operator error that should fail fast, not silently degrade to "no
 * baseline" (which would mask real regressions).
 */
export function loadBaseline(
  frameworkId: string,
  baselineDir: string = DEFAULT_BASELINE_DIR,
): BaselineValues | null {
  const filePath = path.join(baselineDir, `${frameworkId}.json`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `[evaluation] failed to parse baseline for '${frameworkId}' at ${filePath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `[evaluation] baseline for '${frameworkId}' at ${filePath} must be a JSON object.`,
    );
  }
  return coerceBaselineValues(parsed as Record<string, unknown>, filePath);
}

/**
 * Write a framework's current metric values as the new baseline. Used by
 * `--update-baseline` (CLI-facing; exported here so the CLI does not need to
 * duplicate the path logic).
 */
export function writeBaseline(
  frameworkId: string,
  values: BaselineValues,
  baselineDir: string = DEFAULT_BASELINE_DIR,
): string {
  fs.mkdirSync(baselineDir, { recursive: true });
  const filePath = path.join(baselineDir, `${frameworkId}.json`);
  // Stable key order so the human-reviewed diff is deterministic.
  const ordered: BaselineValues = {
    packRecall: values.packRecall,
    gapFillPrecision: values.gapFillPrecision,
    gapFillRecall: values.gapFillRecall,
    duplicationRate: values.duplicationRate,
    hallucinationRate: values.hallucinationRate,
  };
  fs.writeFileSync(filePath, JSON.stringify(ordered, null, 2) + '\n', 'utf-8');
  return filePath;
}

/**
 * Load the optional per-framework threshold overrides file.
 *
 * Returns `null` when the file is missing — a missing overrides file is not
 * an error, just means "use defaults everywhere". Throws on malformed JSON
 * (operator error).
 */
export function loadThresholdOverrides(
  thresholdsPath: string = DEFAULT_THRESHOLDS_PATH,
): ThresholdOverrides | null {
  if (!fs.existsSync(thresholdsPath)) return null;
  const raw = fs.readFileSync(thresholdsPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `[evaluation] failed to parse thresholds file at ${thresholdsPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `[evaluation] thresholds file at ${thresholdsPath} must be a JSON object.`,
    );
  }
  return parsed as ThresholdOverrides;
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

function coerceBaselineValues(
  obj: Record<string, unknown>,
  filePath: string,
): BaselineValues {
  const metricKeys: Array<keyof MetricCountSet> = [
    'packRecall',
    'gapFillPrecision',
    'gapFillRecall',
    'duplicationRate',
    'hallucinationRate',
  ];
  const out = {} as BaselineValues;
  for (const k of metricKeys) {
    const v = obj[k];
    // `null` in the on-disk JSON represents a metric whose current-run
    // value was NaN (zero-denominator); JSON.stringify(NaN) produces null.
    // Accept null as a bootstrap marker � it's coerced back to NaN so the
    // downstream comparator's NaN-is-pass branch handles it correctly. Only
    // explicit non-null non-finite values are rejected.
    if (v === null) {
      out[k] = NaN;
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(
        `[evaluation] baseline at ${filePath}: '${k}' must be a finite number or null (got ${JSON.stringify(
          v,
        )}).`,
      );
    }
    out[k] = v;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

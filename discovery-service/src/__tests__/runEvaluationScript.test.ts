/**
 * Focused tests for the V3 evaluation harness Task Group 4:
 * `scripts/run-evaluation.ts` — CLI runner + output formatting + gitignore.
 *
 * Spec: `agent-os/specs/2026-04-19-v3-evaluation-harness` (Task Group 4.1).
 *
 * Scope of this file:
 *   1. `--framework <id>` selects a single framework's fixtures.
 *   2. `--all` runs across all frameworks found under the fixtures root.
 *   3. `--update-baseline` writes a baseline JSON file in the expected shape.
 *   4. Markdown summary includes all five metrics per framework (values,
 *      baseline column, delta column, direction column, verdict column).
 *   5. JSON report is written to the reports dir with the documented
 *      filename pattern (`<framework>-<timestamp>.json` or
 *      `global-<timestamp>.json` for `--all`).
 *   6. Exit code `1` on a forced regression (tight baseline + dropped
 *      pack output).
 *   7. `--record` without `--live` exits with a clear error.
 *   8. `--live` flag selects the live LLM strategy; the default is replay.
 *
 * Out of scope:
 *   - Exhaustive flag-combination coverage.
 *   - Full filesystem edge cases (we only cover the happy + one-error path
 *     per the spec's "Skip exhaustive…" note).
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

import { runEvaluationCli } from '../../scripts/run-evaluation';
import type {
  FixtureCase,
  PipelineInvocationResult,
} from '../evaluation/types';

// ---------------------------------------------------------------------------
// Temp-dir harness.
// ---------------------------------------------------------------------------

let tmpRoot: string;
let fixturesRoot: string;
let llmFixturesRoot: string;
let baselineDir: string;
let reportsDir: string;
let thresholdsPath: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-cli-'));
  fixturesRoot = path.join(tmpRoot, 'fixtures');
  llmFixturesRoot = path.join(tmpRoot, 'llm-fixtures');
  baselineDir = path.join(tmpRoot, 'baselines');
  reportsDir = path.join(tmpRoot, 'reports');
  thresholdsPath = path.join(tmpRoot, 'thresholds.json');
  await fs.mkdir(fixturesRoot, { recursive: true });
  await fs.mkdir(llmFixturesRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function scaffoldFixture(
  framework: string,
  caseId: string,
  sourceExt: string,
  sourceContents: string,
  expectedJson: unknown,
): Promise<string> {
  const dir = path.join(fixturesRoot, framework, caseId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${caseId}.${sourceExt}`), sourceContents, 'utf-8');
  await fs.writeFile(
    path.join(dir, `${caseId}.expected.json`),
    JSON.stringify(expectedJson, null, 2),
    'utf-8',
  );
  return dir;
}

// Emits one `pack`-tagged candidate per fixture, matching the expectation's
// (type, name) — guarantees pack recall = 1.0, zero LLM candidates.
const packOnlyInvoker = async (fx: FixtureCase): Promise<PipelineInvocationResult> => {
  const packCandidates = fx.expectations.expected
    .filter((e) => e.tag === 'pack')
    .map((e) => ({
      type: e.type,
      name: e.name,
      filePath: fx.sourceFileName,
    }));
  return {
    packCandidates,
    llmCandidates: [],
  };
};

// Returns no candidates at all — simulates a regression where the pack
// adapter stopped emitting. Pack recall collapses to 0.0.
const emptyInvoker = async (_fx: FixtureCase): Promise<PipelineInvocationResult> => ({
  packCandidates: [],
  llmCandidates: [],
});

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('run-evaluation CLI — Task Group 4', () => {
  // Test 1: `--framework <id>` narrows to a single framework.
  test('--framework <id> runs scoped evaluation and exits 0 on pass', async () => {
    await scaffoldFixture('spring-classic', 'case-a', 'java', 'class A {}', {
      expected: [{ type: 'Controller', name: 'AController', tag: 'pack' }],
      shouldNotEmit: [],
    });
    await scaffoldFixture('django', 'case-b', 'py', 'class B: pass', {
      expected: [{ type: 'Model', name: 'BModel', tag: 'pack' }],
      shouldNotEmit: [],
    });

    const result = await runEvaluationCli({
      framework: 'spring-classic',
      fixturesRoot,
      llmFixturesRoot,
      baselineDir,
      reportsDir,
      thresholdsPath,
      invokePipeline: packOnlyInvoker,
      skipBaselineComparison: true,
    });

    expect(result.exitCode).toBe(0);
    // Scoped to a single framework: exactly one FrameworkReport.
    expect(result.report.frameworkReports).toHaveLength(1);
    expect(result.report.frameworkReports[0].frameworkId).toBe('spring-classic');
  });

  // Test 2: `--all` runs across all frameworks in the fixtures dir.
  test('--all runs across every framework under the fixtures root', async () => {
    await scaffoldFixture('spring-classic', 'case-a', 'java', 'class A {}', {
      expected: [{ type: 'Controller', name: 'AController', tag: 'pack' }],
      shouldNotEmit: [],
    });
    await scaffoldFixture('django', 'case-b', 'py', 'class B: pass', {
      expected: [{ type: 'Model', name: 'BModel', tag: 'pack' }],
      shouldNotEmit: [],
    });
    await scaffoldFixture('rails', 'case-c', 'rb', 'class C; end', {
      expected: [{ type: 'Controller', name: 'CController', tag: 'pack' }],
      shouldNotEmit: [],
    });

    const result = await runEvaluationCli({
      all: true,
      fixturesRoot,
      llmFixturesRoot,
      baselineDir,
      reportsDir,
      thresholdsPath,
      invokePipeline: packOnlyInvoker,
      skipBaselineComparison: true,
    });

    expect(result.exitCode).toBe(0);
    const frameworkIds = result.report.frameworkReports
      .map((fr) => fr.frameworkId)
      .sort();
    expect(frameworkIds).toEqual(['django', 'rails', 'spring-classic']);
    // `--all` writes a `global-<ts>.json` report rather than
    // `<framework>-<ts>.json`.
    expect(result.reportPath).toBeTruthy();
    expect(path.basename(result.reportPath!)).toMatch(/^global-.+\.json$/);
  });

  // Test 3: `--update-baseline` writes a baseline JSON file.
  test('--update-baseline writes a baseline file with the metric-values shape', async () => {
    await scaffoldFixture('spring-classic', 'case-a', 'java', 'class A {}', {
      expected: [{ type: 'Controller', name: 'AController', tag: 'pack' }],
      shouldNotEmit: [],
    });

    const result = await runEvaluationCli({
      framework: 'spring-classic',
      updateBaseline: true,
      fixturesRoot,
      llmFixturesRoot,
      baselineDir,
      reportsDir,
      thresholdsPath,
      invokePipeline: packOnlyInvoker,
    });

    expect(result.exitCode).toBe(0);
    const baselineFilePath = path.join(baselineDir, 'spring-classic.json');
    expect(fsSync.existsSync(baselineFilePath)).toBe(true);
    const baseline = JSON.parse(
      await fs.readFile(baselineFilePath, 'utf-8'),
    );
    // The written baseline carries exactly the five metric keys.
    expect(Object.keys(baseline).sort()).toEqual(
      [
        'duplicationRate',
        'gapFillPrecision',
        'gapFillRecall',
        'hallucinationRate',
        'packRecall',
      ].sort(),
    );
    // packRecall should be 1.0 since the pipeline perfectly emitted the
    // one `pack`-tagged expected entry.
    expect(baseline.packRecall).toBe(1);
  });

  // Test 4: Markdown summary includes all five metrics per framework.
  test('markdown summary table includes all five metrics and per-framework rows', async () => {
    await scaffoldFixture('spring-classic', 'case-a', 'java', 'class A {}', {
      expected: [{ type: 'Controller', name: 'AController', tag: 'pack' }],
      shouldNotEmit: [],
    });

    const result = await runEvaluationCli({
      framework: 'spring-classic',
      fixturesRoot,
      llmFixturesRoot,
      baselineDir,
      reportsDir,
      thresholdsPath,
      invokePipeline: packOnlyInvoker,
      skipBaselineComparison: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.markdown).toMatch(/Framework: spring-classic/);
    expect(result.markdown).toMatch(/Pack recall/);
    expect(result.markdown).toMatch(/Gap-fill precision/);
    expect(result.markdown).toMatch(/Gap-fill recall/);
    expect(result.markdown).toMatch(/Duplication rate/);
    expect(result.markdown).toMatch(/Hallucination rate/);
    // The header row includes the documented columns.
    expect(result.markdown).toMatch(/Metric/);
    expect(result.markdown).toMatch(/Current/);
    expect(result.markdown).toMatch(/Baseline/);
    // A delta column (the requirements show `Δ`).
    expect(result.markdown).toMatch(/Δ|Delta/);
    expect(result.markdown).toMatch(/Verdict/);
  });

  // Test 5: JSON report written to reports dir with correct filename pattern.
  test('writes a JSON report to the reports dir with a framework-timestamp filename', async () => {
    await scaffoldFixture('spring-classic', 'case-a', 'java', 'class A {}', {
      expected: [{ type: 'Controller', name: 'AController', tag: 'pack' }],
      shouldNotEmit: [],
    });

    const result = await runEvaluationCli({
      framework: 'spring-classic',
      fixturesRoot,
      llmFixturesRoot,
      baselineDir,
      reportsDir,
      thresholdsPath,
      invokePipeline: packOnlyInvoker,
      skipBaselineComparison: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.reportPath).toBeTruthy();
    // The reports dir was created automatically.
    expect(fsSync.existsSync(reportsDir)).toBe(true);
    const filename = path.basename(result.reportPath!);
    // Filename shape: `<framework>-<timestamp>.json`.
    expect(filename).toMatch(/^spring-classic-.+\.json$/);
    const payload = JSON.parse(
      await fs.readFile(result.reportPath!, 'utf-8'),
    );
    // Payload is the full AggregateReport.
    expect(payload.frameworkReports).toHaveLength(1);
    expect(payload.frameworkReports[0].frameworkId).toBe('spring-classic');
    expect(payload.generatedAt).toBeDefined();
  });

  // Test 6: Exit code 1 on a forced regression.
  test('exits with code 1 when a metric regresses beyond its threshold', async () => {
    await scaffoldFixture('spring-classic', 'case-a', 'java', 'class A {}', {
      expected: [{ type: 'Controller', name: 'AController', tag: 'pack' }],
      shouldNotEmit: [],
    });
    // Record a perfect baseline — pack recall = 1.0 — while the current
    // run will produce pack recall = 0.0 (emptyInvoker emits nothing).
    await fs.mkdir(baselineDir, { recursive: true });
    await fs.writeFile(
      path.join(baselineDir, 'spring-classic.json'),
      JSON.stringify({
        packRecall: 1.0,
        gapFillPrecision: 1.0,
        gapFillRecall: 1.0,
        duplicationRate: 0.0,
        hallucinationRate: 0.0,
      }),
      'utf-8',
    );

    const result = await runEvaluationCli({
      framework: 'spring-classic',
      fixturesRoot,
      llmFixturesRoot,
      baselineDir,
      reportsDir,
      thresholdsPath,
      invokePipeline: emptyInvoker,
    });

    expect(result.exitCode).toBe(1);
    // The regressing metric is flagged in the markdown summary.
    expect(result.markdown).toMatch(/fail/i);
    // `OVERALL: FAIL` final status line before exit.
    expect(result.markdown).toMatch(/OVERALL:\s*FAIL/);
  });

  // Test 7: `--record` without `--live` exits with a clear error.
  test('--record without --live exits with a clear error', async () => {
    await expect(
      runEvaluationCli({
        framework: 'spring-classic',
        record: true,
        // No `live: true`.
        fixturesRoot,
        llmFixturesRoot,
        baselineDir,
        reportsDir,
        thresholdsPath,
        invokePipeline: packOnlyInvoker,
      }),
    ).rejects.toThrow(/--record.*--live/i);
  });

  // Test 8: `--live` flag selects the live LLM strategy; default is replay.
  test('--live selects the live LLM strategy; default is replay', async () => {
    await scaffoldFixture('spring-classic', 'case-a', 'java', 'class A {}', {
      expected: [{ type: 'Controller', name: 'AController', tag: 'pack' }],
      shouldNotEmit: [],
    });

    const replayResult = await runEvaluationCli({
      framework: 'spring-classic',
      fixturesRoot,
      llmFixturesRoot,
      baselineDir,
      reportsDir,
      thresholdsPath,
      invokePipeline: packOnlyInvoker,
      skipBaselineComparison: true,
    });
    expect(replayResult.llmMode).toBe('replay');

    const liveResult = await runEvaluationCli({
      framework: 'spring-classic',
      live: true,
      fixturesRoot,
      llmFixturesRoot,
      baselineDir,
      reportsDir,
      thresholdsPath,
      invokePipeline: packOnlyInvoker,
      skipBaselineComparison: true,
    });
    expect(liveResult.llmMode).toBe('live');

    const recordResult = await runEvaluationCli({
      framework: 'spring-classic',
      live: true,
      record: true,
      fixturesRoot,
      llmFixturesRoot,
      baselineDir,
      reportsDir,
      thresholdsPath,
      invokePipeline: packOnlyInvoker,
      skipBaselineComparison: true,
    });
    expect(recordResult.llmMode).toBe('record');
  });
});

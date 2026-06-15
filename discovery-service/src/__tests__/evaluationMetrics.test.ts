/**
 * Focused tests for the V3 evaluation harness Task Group 2:
 * per-metric calculators, micro-average aggregation, and baseline comparison.
 *
 * Spec: `agent-os/specs/2026-04-19-v3-evaluation-harness` (Task Group 2.1).
 *
 * Scope of this file:
 *   1. Pack recall on a hand-built fixture with some `'pack'` hits and misses.
 *   2. Gap-fill precision + recall against a fixture mixing `'gap-fill'`,
 *      `'either'`, and untagged LLM output.
 *   3. Duplication rate flags LLM candidates duplicating pack output on the
 *      canonical dedup key, and hallucination rate counts unmatched LLM
 *      candidates plus `shouldNotEmit` matches.
 *   4. Micro-average aggregation across two fixtures sums numerators and
 *      denominators before dividing (differs from arithmetic mean).
 *   5. Baseline directional regression: duplicationRate INCREASE >5% fails,
 *      packRecall DECREASE >5% fails, no-baseline produces `'no-baseline'`.
 *
 * Matching semantics (spec): `(type, normalizeName(name), forward-slash filePath)`,
 * using `normalizeName` imported from `services/prompts/dedup.ts`. The filePath
 * for all candidates derived from a single fixture is the fixture's
 * `sourceFileName`.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { scoreFixture } from '../evaluation/metrics';
import { aggregateFramework, aggregateGlobal } from '../evaluation/aggregation';
import { compareToBaseline, DEFAULT_THRESHOLD } from '../evaluation/baseline';
import type {
  ExpectedCandidate,
  FixtureCase,
  FixtureReport,
  MetricCountSet,
  PipelineInvocationResult,
  ShouldNotEmitEntry,
} from '../evaluation/types';

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Build a minimal `FixtureCase` shape sufficient for scoring. The scorer does
 * not read from disk — it only looks at `sourceFileName` (used as the
 * candidate filePath) and `expectations`.
 */
function makeFixture(
  frameworkId: string,
  caseId: string,
  sourceFileName: string,
  expected: ExpectedCandidate[],
  shouldNotEmit: ShouldNotEmitEntry[] = [],
): FixtureCase {
  return {
    frameworkId,
    caseId,
    fixtureDir: `/tmp/${frameworkId}/${caseId}`,
    sourceFilePath: `/tmp/${frameworkId}/${caseId}/${sourceFileName}`,
    sourceFileName,
    sourceContents: '',
    expectations: { expected, shouldNotEmit },
    llmFixturePath: `/tmp/llm/${frameworkId}/${caseId}.llm-response.json`,
  };
}

function makePipelineResult(
  packCandidates: Array<{ type: string; name: string; filePath?: string }>,
  llmCandidates: Array<{ type: string; name: string; filePath?: string }>,
  defaultFilePath: string,
): PipelineInvocationResult {
  return {
    packCandidates: packCandidates.map((c) => ({
      type: c.type,
      name: c.name,
      filePath: c.filePath ?? defaultFilePath,
    })),
    llmCandidates: llmCandidates.map((c) => ({
      type: c.type,
      name: c.name,
      filePath: c.filePath ?? defaultFilePath,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('evaluation harness — Task Group 2 metrics', () => {
  // Test 1: pack recall — 2 of 3 expected pack items emitted by the pack.
  test('pack recall counts pack-tagged expected hits over total pack-tagged expected', () => {
    // All matching goes through `normalizeName(name)` — we use names that
    // cross that normalization (underscores vs. spaces vs. case) to
    // prove the scorer uses the shared helper rather than string-equality.
    const fixture = makeFixture(
      'spring-classic',
      'pack-recall-case',
      'pack-recall-case.java',
      [
        { type: 'Controller', name: 'PatientController', tag: 'pack' },
        { type: 'Service', name: 'Patient Service', tag: 'pack' },
        { type: 'Entity', name: 'Patient', tag: 'pack' }, // intentionally missed
        { type: 'Endpoint', name: 'GET /patients', tag: 'gap-fill' }, // not counted for pack recall
      ],
    );
    const result = makePipelineResult(
      [
        // Matches 'PatientController' after lowercasing (both normalize to 'patientcontroller').
        { type: 'Controller', name: 'patientcontroller' },
        // Matches 'Patient Service' — the expected uses a space, the pack uses an underscore;
        // both normalize to 'patient service'.
        { type: 'Service', name: 'patient_service' },
      ],
      [],
      'pack-recall-case.java',
    );
    const report = scoreFixture(fixture, result);
    expect(report.counts.packRecall.denominator).toBe(3);
    expect(report.counts.packRecall.numerator).toBe(2);
    expect(report.values.packRecall).toBeCloseTo(2 / 3, 6);
  });

  // Test 2: gap-fill precision + recall with mixed tags and untagged output.
  test('gap-fill precision and recall differentiate pack vs LLM sources and handle either-tagged', () => {
    const fixture = makeFixture(
      'django',
      'gap-fill-case',
      'gap-fill-case.py',
      [
        { type: 'Endpoint', name: 'GET /users', tag: 'gap-fill' }, // LLM should find
        { type: 'Endpoint', name: 'POST /orders', tag: 'gap-fill' }, // LLM misses
        { type: 'Feature', name: 'ShoppingCart', tag: 'either' }, // LLM emits -> counts for precision
        { type: 'Model', name: 'User', tag: 'pack' }, // not counted for gap-fill precision/recall
      ],
    );
    const pipelineResult = makePipelineResult(
      [
        { type: 'Model', name: 'User' }, // pack-only
      ],
      [
        { type: 'Endpoint', name: 'GET /users' }, // matches gap-fill expected
        { type: 'Feature', name: 'ShoppingCart' }, // matches either expected
        { type: 'Endpoint', name: 'TotallyMadeUp' }, // hallucination (no match)
      ],
      'gap-fill-case.py',
    );
    const report = scoreFixture(fixture, pipelineResult);

    // gap-fill precision: 2 of 3 LLM candidates match 'gap-fill' or 'either'.
    expect(report.counts.gapFillPrecision).toEqual({ numerator: 2, denominator: 3 });
    // gap-fill recall: 1 of 2 'gap-fill'-tagged expected entries found by LLM.
    expect(report.counts.gapFillRecall).toEqual({ numerator: 1, denominator: 2 });
  });

  // Test 3: duplication rate + hallucination rate (shouldNotEmit included).
  test('duplication and hallucination rates behave correctly including shouldNotEmit triggers', () => {
    const fixture = makeFixture(
      'rails',
      'dup-halluc-case',
      'dup_halluc_case.rb',
      [
        { type: 'Model', name: 'User', tag: 'pack' },
        { type: 'Job', name: 'EmailJob', tag: 'gap-fill' },
      ],
      [{ type: 'Model', name: 'GhostModel' }],
    );
    const pipelineResult = makePipelineResult(
      // Pack emits: Model/User.
      [{ type: 'Model', name: 'User' }],
      // LLM emits four candidates:
      //   1. Model/User            -> duplicates pack output (dup +1)
      //   2. Job/EmailJob          -> matches gap-fill expected (clean)
      //   3. Class/RandomInvention -> no match anywhere (hallucination)
      //   4. Model/GhostModel      -> matches shouldNotEmit (hallucination)
      [
        { type: 'Model', name: 'User' },
        { type: 'Job', name: 'EmailJob' },
        { type: 'Class', name: 'RandomInvention' },
        { type: 'Model', name: 'GhostModel' },
      ],
      'dup_halluc_case.rb',
    );
    const report = scoreFixture(fixture, pipelineResult);

    // Duplication rate: 1 of 4 LLM candidates duplicate pack output.
    expect(report.counts.duplicationRate).toEqual({ numerator: 1, denominator: 4 });
    // Hallucination rate: 2 of 4 LLM candidates are hallucinations
    // (RandomInvention = unmatched, GhostModel = shouldNotEmit match).
    expect(report.counts.hallucinationRate).toEqual({ numerator: 2, denominator: 4 });
  });

  // Test 4: micro-average aggregation differs from per-fixture arithmetic mean.
  test('aggregateFramework micro-averages by summing numerators and denominators', () => {
    // Fixture A: 1/1  (per-fixture rate 1.0)
    // Fixture B: 0/9  (per-fixture rate 0.0)
    // Arithmetic mean of rates = 0.5; micro-average = 1/10 = 0.1.
    const fixtureReportA: FixtureReport = {
      frameworkId: 'spring-classic',
      caseId: 'a',
      sourceFileName: 'a.java',
      counts: mkCounts({ packRecall: { numerator: 1, denominator: 1 } }),
      values: {
        packRecall: 1,
        gapFillPrecision: NaN,
        gapFillRecall: NaN,
        duplicationRate: NaN,
        hallucinationRate: NaN,
      },
    };
    const fixtureReportB: FixtureReport = {
      frameworkId: 'spring-classic',
      caseId: 'b',
      sourceFileName: 'b.java',
      counts: mkCounts({ packRecall: { numerator: 0, denominator: 9 } }),
      values: {
        packRecall: 0,
        gapFillPrecision: NaN,
        gapFillRecall: NaN,
        duplicationRate: NaN,
        hallucinationRate: NaN,
      },
    };

    const frameworkReport = aggregateFramework('spring-classic', [fixtureReportA, fixtureReportB]);
    expect(frameworkReport.aggregateCounts.packRecall).toEqual({
      numerator: 1,
      denominator: 10,
    });
    expect(frameworkReport.aggregateValues.packRecall).toBeCloseTo(0.1, 6);
    // Explicitly NOT the arithmetic mean of 0.5.
    expect(frameworkReport.aggregateValues.packRecall).not.toBeCloseTo(0.5, 2);

    // Global aggregation should roll up the same way.
    const global = aggregateGlobal([frameworkReport]);
    expect(global.aggregateCounts.packRecall).toEqual({ numerator: 1, denominator: 10 });
    expect(global.aggregateValues.packRecall).toBeCloseTo(0.1, 6);
  });

  // Test 5: baseline directional regression (INCREASE on duplicationRate, DECREASE on packRecall, no-baseline).
  test('compareToBaseline enforces directional 5% thresholds and handles missing baselines', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-baseline-'));
    try {
      const baselineDir = path.join(tmpRoot, 'baselines');
      await fs.mkdir(baselineDir, { recursive: true });
      await fs.writeFile(
        path.join(baselineDir, 'spring-classic.json'),
        JSON.stringify({
          packRecall: 0.9,
          gapFillPrecision: 0.8,
          gapFillRecall: 0.7,
          duplicationRate: 0.1,
          hallucinationRate: 0.05,
        }),
        'utf-8',
      );

      // Current values: duplicationRate up 10% (fail), packRecall down 10% (fail),
      // other metrics within bounds.
      const current = {
        packRecall: 0.8, // baseline 0.9 -> delta -0.1 -> fail (decrease > 5%)
        gapFillPrecision: 0.79, // within 5% drop -> pass
        gapFillRecall: 0.7, // unchanged -> pass
        duplicationRate: 0.2, // baseline 0.1 -> delta +0.1 -> fail (increase > 5%)
        hallucinationRate: 0.05, // unchanged -> pass
      };
      const verdicts = compareToBaseline('spring-classic', current, {
        baselineDir,
      });

      // packRecall fails on decrease.
      expect(verdicts.packRecall.status).toBe('fail');
      expect(verdicts.packRecall.direction).toBe('decrease');
      expect(verdicts.packRecall.baseline).toBeCloseTo(0.9, 6);
      expect(verdicts.packRecall.delta).toBeCloseTo(-0.1, 6);
      expect(verdicts.packRecall.threshold).toBeCloseTo(DEFAULT_THRESHOLD, 6);

      // gapFillPrecision is within threshold -> pass.
      expect(verdicts.gapFillPrecision.status).toBe('pass');
      expect(verdicts.gapFillRecall.status).toBe('pass');

      // duplicationRate fails on increase.
      expect(verdicts.duplicationRate.status).toBe('fail');
      expect(verdicts.duplicationRate.direction).toBe('increase');
      expect(verdicts.duplicationRate.delta).toBeCloseTo(0.1, 6);

      // hallucinationRate is unchanged -> pass.
      expect(verdicts.hallucinationRate.status).toBe('pass');

      // No-baseline case: compare for a framework with no baseline file.
      const noBaselineVerdicts = compareToBaseline('nonexistent-framework', current, {
        baselineDir,
      });
      for (const key of [
        'packRecall',
        'gapFillPrecision',
        'gapFillRecall',
        'duplicationRate',
        'hallucinationRate',
      ] as const) {
        expect(noBaselineVerdicts[key].status).toBe('no-baseline');
        expect(noBaselineVerdicts[key].baseline).toBeNull();
      }
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Local helper: build a MetricCountSet with any subset of metrics overridden.
// ---------------------------------------------------------------------------
function mkCounts(overrides: Partial<MetricCountSet>): MetricCountSet {
  return {
    packRecall: { numerator: 0, denominator: 0 },
    gapFillPrecision: { numerator: 0, denominator: 0 },
    gapFillRecall: { numerator: 0, denominator: 0 },
    duplicationRate: { numerator: 0, denominator: 0 },
    hallucinationRate: { numerator: 0, denominator: 0 },
    ...overrides,
  };
}

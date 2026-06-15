/**
 * Focused tests for the V3 evaluation harness Task Group 1:
 * shared runner library + types + fixture loader.
 *
 * Spec: `agent-os/specs/2026-04-19-v3-evaluation-harness` (Task Group 1.1).
 *
 * Scope of this file:
 *   1. `expected.json` schema validation — happy path round-trips cleanly.
 *   2. `expected.json` schema validation — malformed `tag` fails with a
 *      contextual error message pointing at the offending entry.
 *   3. Fixture loader round-trips a well-formed on-disk fixture directory
 *      into the documented `FixtureCase` shape.
 *   4. `runEvaluation` produces the documented per-fixture / per-framework /
 *      aggregate report structure when driven by an injected pipeline fake.
 *   5. Empty fixture tree produces the documented empty-report shape (not a
 *      throw) so Group 4's CLI can render a polite "no fixtures" summary.
 *   6. `selectFixtures` narrows to a single framework when a filter is
 *      provided.
 *
 * Out of scope for Group 1:
 *   - Real metric math (Group 2 tests cover this).
 *   - LLM fixture replay (Group 3 tests cover this).
 *   - CLI flag parsing (Group 4 tests cover this).
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  FixtureValidationError,
  loadAllFixtures,
  loadFixtureCase,
  parseExpectedJson,
} from '../evaluation/fixtureLoader';
import {
  buildEmptyReport,
  runEvaluation,
  selectFixtures,
} from '../evaluation/runner';
import type {
  FixtureCase,
  PipelineInvocationResult,
} from '../evaluation/types';

// ---------------------------------------------------------------------------
// Test harness: temp directory rooting.
// ---------------------------------------------------------------------------

let tmpRoot: string;
let fixturesRoot: string;
let llmFixturesRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-harness-'));
  fixturesRoot = path.join(tmpRoot, 'fixtures');
  llmFixturesRoot = path.join(tmpRoot, 'llm-fixtures');
  await fs.mkdir(fixturesRoot, { recursive: true });
  await fs.mkdir(llmFixturesRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

/**
 * Scaffold a minimal fixture directory on disk:
 *   <fixturesRoot>/<framework>/<case>/
 *     <case>.<ext>             — source file
 *     <case>.expected.json     — expectations
 *     README.md                — optional
 */
async function scaffoldFixture(
  framework: string,
  caseId: string,
  sourceExt: string,
  sourceContents: string,
  expectedJson: unknown,
  readme?: string,
): Promise<string> {
  const dir = path.join(fixturesRoot, framework, caseId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${caseId}.${sourceExt}`), sourceContents, 'utf-8');
  await fs.writeFile(
    path.join(dir, `${caseId}.expected.json`),
    JSON.stringify(expectedJson, null, 2),
    'utf-8',
  );
  if (readme !== undefined) {
    await fs.writeFile(path.join(dir, 'README.md'), readme, 'utf-8');
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('evaluation harness — Task Group 1 skeleton', () => {
  // Test 1: schema validation happy path.
  test('parseExpectedJson accepts a well-formed expected.json payload', () => {
    const raw = JSON.stringify({
      expected: [
        { type: 'Service', name: 'PatientService', tag: 'pack' },
        {
          type: 'Endpoint',
          name: 'GET /patients',
          tag: 'gap-fill',
          description: 'REST endpoint exposing the patient list.',
          notes: 'human notes here',
        },
        { type: 'Class', name: 'Utils', tag: 'either' },
      ],
      shouldNotEmit: [{ type: 'Service', name: 'NotARealService' }],
    });
    const parsed = parseExpectedJson(raw, '/fake/dir');
    expect(parsed.expected).toHaveLength(3);
    expect(parsed.expected[0]).toEqual({
      type: 'Service',
      name: 'PatientService',
      tag: 'pack',
    });
    expect(parsed.expected[1].description).toBe('REST endpoint exposing the patient list.');
    expect(parsed.expected[2].tag).toBe('either');
    expect(parsed.shouldNotEmit).toEqual([
      { type: 'Service', name: 'NotARealService' },
    ]);
  });

  // Test 2: schema validation failure path — invalid tag.
  test('parseExpectedJson rejects an invalid tag with a pointer to the offending entry', () => {
    const raw = JSON.stringify({
      expected: [
        { type: 'Service', name: 'OK', tag: 'pack' },
        { type: 'Service', name: 'BAD', tag: 'not-a-valid-tag' },
      ],
      shouldNotEmit: [],
    });
    expect(() => parseExpectedJson(raw, '/fake/dir')).toThrow(FixtureValidationError);
    try {
      parseExpectedJson(raw, '/fake/dir');
    } catch (err) {
      expect(err).toBeInstanceOf(FixtureValidationError);
      const fe = err as FixtureValidationError;
      expect(fe.pointer).toBe('/expected/1/tag');
      expect(fe.message).toMatch(/pack/);
      expect(fe.message).toMatch(/gap-fill/);
      expect(fe.message).toMatch(/either/);
    }
  });

  // Test 3: fixture loader round-trip.
  test('loadFixtureCase round-trips a well-formed fixture directory', async () => {
    await scaffoldFixture(
      'spring-classic',
      'patient-controller',
      'java',
      'class PatientController {}\n',
      {
        expected: [
          { type: 'Controller', name: 'PatientController', tag: 'pack' },
        ],
        shouldNotEmit: [],
      },
      '# PatientController\n\nupstream: example/repo\n',
    );

    const fx = loadFixtureCase(
      'spring-classic',
      'patient-controller',
      fixturesRoot,
      llmFixturesRoot,
    );

    expect(fx.frameworkId).toBe('spring-classic');
    expect(fx.caseId).toBe('patient-controller');
    expect(fx.sourceFileName).toBe('patient-controller.java');
    expect(fx.sourceContents).toBe('class PatientController {}\n');
    expect(fx.expectations.expected).toHaveLength(1);
    expect(fx.expectations.shouldNotEmit).toEqual([]);
    expect(fx.readme).toMatch(/upstream: example\/repo/);
    // llmFixturePath is computed (file itself need not exist yet — Group 3 handles that).
    expect(fx.llmFixturePath).toBe(
      path.join(llmFixturesRoot, 'spring-classic', 'patient-controller.llm-response.json'),
    );
    // Filesystem integrity: the source file lives where we said it does.
    expect(fsSync.existsSync(fx.sourceFilePath)).toBe(true);
    expect(path.basename(fx.sourceFilePath)).toBe('patient-controller.java');
  });

  // Test 4: runner report shape builder, driven by an injected fake pipeline.
  // Expectations are deliberately empty so the test focuses on orchestration
  // shape (per-fixture / per-framework / aggregate + verdict keys), NOT on
  // metric values — those are covered by Group 2's dedicated tests.
  test('runEvaluation produces per-fixture, per-framework, and aggregate report shape', async () => {
    // Scaffold two fixtures across two frameworks so the aggregate layer has
    // something to fold across.
    await scaffoldFixture(
      'spring-classic',
      'case-a',
      'java',
      'class A {}',
      {
        expected: [],
        shouldNotEmit: [],
      },
    );
    await scaffoldFixture(
      'django',
      'case-b',
      'py',
      'class B: pass\n',
      {
        expected: [],
        shouldNotEmit: [],
      },
    );

    const invokePipeline = jest.fn(
      async (_fx: FixtureCase): Promise<PipelineInvocationResult> => ({
        packCandidates: [],
        llmCandidates: [],
      }),
    );

    const report = await runEvaluation({
      fixturesRoot,
      invokePipeline,
      skipBaselineComparison: true,
    });

    // Pipeline was invoked once per fixture.
    expect(invokePipeline).toHaveBeenCalledTimes(2);

    // Top-level shape: one FrameworkReport per framework we scaffolded.
    expect(report.frameworkReports).toHaveLength(2);
    const fwIds = report.frameworkReports.map((fr) => fr.frameworkId).sort();
    expect(fwIds).toEqual(['django', 'spring-classic']);

    // Each FrameworkReport carries one FixtureReport per fixture scaffolded
    // and the documented metric + verdict surface.
    for (const fr of report.frameworkReports) {
      expect(fr.fixtureReports).toHaveLength(1);
      expect(fr.aggregateCounts).toBeDefined();
      expect(fr.aggregateValues).toBeDefined();
      expect(fr.verdicts).toBeDefined();
      expect(fr.overallStatus).toBe('pass');
      // All five metric keys are present on the count set, value set, and verdicts map.
      const METRIC_KEYS = [
        'packRecall',
        'gapFillPrecision',
        'gapFillRecall',
        'duplicationRate',
        'hallucinationRate',
      ] as const;
      for (const k of METRIC_KEYS) {
        // With empty expected + empty pipeline output both numerator and
        // denominator are zero across every metric.
        expect(fr.aggregateCounts[k]).toEqual({ numerator: 0, denominator: 0 });
        expect(fr.verdicts[k].status).toBe('pass');
      }
      // Direction mapping: recall/precision -> decrease; duplication/hallucination -> increase.
      expect(fr.verdicts.packRecall.direction).toBe('decrease');
      expect(fr.verdicts.gapFillPrecision.direction).toBe('decrease');
      expect(fr.verdicts.gapFillRecall.direction).toBe('decrease');
      expect(fr.verdicts.duplicationRate.direction).toBe('increase');
      expect(fr.verdicts.hallucinationRate.direction).toBe('increase');
    }

    expect(report.overallStatus).toBe('pass');
    expect(typeof report.generatedAt).toBe('string');
    expect(() => new Date(report.generatedAt)).not.toThrow();
  });

  // Test 5: empty fixture tree returns a polite empty report.
  test('runEvaluation returns an empty report shape when no fixtures exist', async () => {
    const report = await runEvaluation({
      fixturesRoot,
      invokePipeline: jest.fn(),
    });
    expect(report.frameworkReports).toEqual([]);
    expect(report.overallStatus).toBe('pass');
    expect(report.aggregateCounts.packRecall).toEqual({ numerator: 0, denominator: 0 });

    // And the exported buildEmptyReport helper produces the same overall shape.
    const fromHelper = buildEmptyReport();
    expect(fromHelper.frameworkReports).toEqual([]);
    expect(fromHelper.overallStatus).toBe('pass');
  });

  // Test 6: selectFixtures with a framework filter loads only that framework.
  test('selectFixtures narrows to the requested framework', async () => {
    await scaffoldFixture('spring-classic', 'case-a', 'java', 'A', {
      expected: [],
      shouldNotEmit: [],
    });
    await scaffoldFixture('django', 'case-b', 'py', 'B', {
      expected: [],
      shouldNotEmit: [],
    });

    const all = loadAllFixtures(fixturesRoot, llmFixturesRoot);
    expect(all).toHaveLength(2);

    const onlySpring = selectFixtures(['spring-classic'], fixturesRoot, llmFixturesRoot);
    expect(onlySpring).toHaveLength(1);
    expect(onlySpring[0].frameworkId).toBe('spring-classic');
    expect(onlySpring[0].caseId).toBe('case-a');

    // Unknown framework id simply yields zero fixtures (loader is not a policy layer).
    const unknown = selectFixtures(['not-a-framework'], fixturesRoot, llmFixturesRoot);
    expect(unknown).toEqual([]);
  });
});

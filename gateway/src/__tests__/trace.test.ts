/**
 * Format tests for the predicate self-scoring layer of src/trace.ts — the
 * canonical copy (discovery-service and api-migration-validation-service carry
 * byte-identical copies, so this file pins the wire shape for all three).
 *
 * trace.ts reads HAIKAI_TRACE / HAIKAI_TRACE_FILE once at import, so each test
 * loads a FRESH module instance (jest.resetModules) with the env preset — this
 * also resets the per-process predicate tally between tests.
 *
 * The JSON key orders asserted here are the cross-stack contract: the Java
 * (HaikaiTrace) and Python (trace.py) emitters produce byte-identical bodies
 * for the same inputs, so the run judge parses every stack uniformly.
 */
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

type TraceModule = typeof import('../trace');

const ORIG_TRACE = process.env.HAIKAI_TRACE;
const ORIG_FILE = process.env.HAIKAI_TRACE_FILE;

function freshTracer(tier: string): { file: string; mod: TraceModule } {
  const file = join(mkdtempSync(join(tmpdir(), 'haikai-trace-test-')), 'trace.log');
  process.env.HAIKAI_TRACE = tier;
  process.env.HAIKAI_TRACE_FILE = file;
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../trace') as TraceModule;
  return { file, mod };
}

afterAll(() => {
  if (ORIG_TRACE === undefined) delete process.env.HAIKAI_TRACE;
  else process.env.HAIKAI_TRACE = ORIG_TRACE;
  if (ORIG_FILE === undefined) delete process.env.HAIKAI_TRACE_FILE;
  else process.env.HAIKAI_TRACE_FILE = ORIG_FILE;
  jest.resetModules();
});

const lines = (file: string): string[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '');

describe('predicate self-scoring layer', () => {
  test('predicate line: glyph + HAIKAI_PREDICATE + stable json key order + corr', () => {
    const { file, mod } = freshTracer('summary');
    const t = mod.createTracer('gateway');
    t.predicate('PLAN.EXP.01', 'zero LLM calls on code epics', true, '0', '0', { run: 'mig-1' });

    const [line] = lines(file);
    const parts = line.split('  ');
    expect(parts).toHaveLength(5);
    expect(parts[1]).toBe('[SUMMARY]');
    expect(parts[2]).toBe('gateway');
    expect(parts[3]).toBe('run=mig-1');
    expect(parts[4]).toBe(
      '✓ HAIKAI_PREDICATE {"id":"PLAN.EXP.01","title":"zero LLM calls on code epics",' +
        '"verdict":"pass","expected":"0","actual":"0","corr":{"run":"mig-1"}}',
    );
  });

  test('fail and skip verdicts render ✗ / ⚠ with ternary verdict values', () => {
    const { file, mod } = freshTracer('summary');
    const t = mod.createTracer('gateway');
    t.predicate('GATE.DB.01', 'db gate evaluated', false, 'pass', 'blocked: no pin');
    t.predicateSkip('CAP.SOAP.01', 'soap operations captured', 'pilot has no SOAP endpoints');

    const [failLine, skipLine] = lines(file);
    expect(failLine).toContain('✗ HAIKAI_PREDICATE ');
    expect(failLine).toContain('"verdict":"fail"');
    expect(skipLine).toContain('⚠ HAIKAI_PREDICATE ');
    expect(skipLine).toContain('"verdict":"skip"');
    expect(skipLine).toContain('"actual":"pilot has no SOAP endpoints"');
  });

  test('scorecard tallies by id stage prefix, lists failures, sums cumulative', () => {
    const { file, mod } = freshTracer('summary');
    const t = mod.createTracer('gateway');
    t.stageStart('SCAN');
    t.predicate('SCAN.A.01', 'a', true, 'x', 'x');
    t.predicate('SCAN.A.02', 'b', false, 'y', 'z');
    t.predicateSkip('SCAN.A.03', 'c', 'why');
    t.predicate('BOOT.B.01', 'other stage', true, '1', '1');
    t.stageEnd('SCAN');

    const all = lines(file);
    expect(all[0]).toContain('▶ HAIKAI_STAGE_START {"stage":"SCAN"}');
    // SCAN tallies exclude the BOOT predicate; cumulative includes it.
    expect(all[all.length - 1]).toContain(
      '✗ HAIKAI_SCORECARD {"stage":"SCAN","service":"gateway","pass":1,"fail":1,"skip":1,' +
        '"failed":[{"id":"SCAN.A.02","actual":"z"}],"cumulative":{"pass":2,"fail":1,"skip":1}}',
    );
  });

  test('scorecard glyph is ✓ when the stage has no failures', () => {
    const { file, mod } = freshTracer('summary');
    const t = mod.createTracer('gateway');
    t.predicate('BOOT.A.01', 'a', true, 'x', 'x');
    t.stageEnd('BOOT');
    expect(lines(file)[1]).toContain('✓ HAIKAI_SCORECARD {"stage":"BOOT",');
  });

  test('config header leads with service and merges the supplied config', () => {
    const { file, mod } = freshTracer('summary');
    const t = mod.createTracer('gateway');
    t.configHeader({ git_sha: 'abc1234', db_creds_present: false, parity_repair_cap: 5 });

    expect(lines(file)[0]).toContain(
      '▶ HAIKAI_CONFIG {"service":"gateway","git_sha":"abc1234",' +
        '"db_creds_present":false,"parity_repair_cap":5}',
    );
  });

  test('off tier: the whole predicate layer is a filesystem no-op', () => {
    const { file, mod } = freshTracer('off');
    const t = mod.createTracer('gateway');
    t.configHeader({ git_sha: 'abc' });
    t.stageStart('SCAN');
    t.predicate('SCAN.A.01', 'a', false, 'x', 'y');
    t.predicateSkip('SCAN.A.02', 'b', 'why');
    t.stageEnd('SCAN');
    expect(existsSync(file)).toBe(false);
  });
});

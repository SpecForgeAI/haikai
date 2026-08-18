/**
 * SCL shipped-suite integrity + quarantine + contest-threshold pins (SCL
 * pipeline spec 9 — red/green/no-modification guard + contested-test
 * circuit breakers; thresholds are CONFIG values).
 */

import {
  SclQuarantineEntry,
  buildShippedManifest,
  checkSuiteIntegrity,
  evaluateContestThresholds,
  parseQuarantineManifest,
  renderQuarantineManifest,
} from '../sclTestIntegrity';

const FILES = [
  { path: 'src/test/java/com/app/behaviour/A_BehaviourTest.java', content: 'class A {}' },
  { path: 'src/test/java/com/app/testkit/OrderFixtures.java', content: 'class OF {}' },
];

describe('buildShippedManifest / checkSuiteIntegrity', () => {
  it('is intact when every shipped file is present and byte-identical', () => {
    const shipped = buildShippedManifest(FILES);
    expect(shipped.files.map((f) => f.path)).toEqual([...FILES.map((f) => f.path)].sort());
    for (const f of shipped.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);

    const result = checkSuiteIntegrity(shipped, shipped.files);
    expect(result).toEqual({ modified: [], missing: [], intact: true });
  });

  it('flags modified shipped files', () => {
    const shipped = buildShippedManifest(FILES);
    const tampered = buildShippedManifest([
      { ...FILES[0], content: 'class A { /* edited */ }' },
      FILES[1],
    ]);
    const result = checkSuiteIntegrity(shipped, tampered.files);
    expect(result.modified).toEqual([FILES[0].path]);
    expect(result.missing).toEqual([]);
    expect(result.intact).toBe(false);
  });

  it('flags missing shipped files; extra (implementer-added) files are legal', () => {
    const shipped = buildShippedManifest(FILES);
    const current = buildShippedManifest([
      FILES[1],
      { path: 'src/test/java/com/app/extra/NewTest.java', content: 'class N {}' },
    ]);
    const result = checkSuiteIntegrity(shipped, current.files);
    expect(result.missing).toEqual([FILES[0].path]);
    expect(result.modified).toEqual([]);
    expect(result.intact).toBe(false);
  });
});

describe('quarantine manifest render/parse', () => {
  const entries: SclQuarantineEntry[] = [
    {
      test_path: 'src/test/java/com/app/behaviour/B_BehaviourTest.java',
      test_method: 'row3_bad_row',
      contract_key: 'T-BBB',
      row_index: 3,
      contest_evidence: 'row misreads the null guard at src/B.java:12',
      verdict: 'upheld',
      arbitrated_at: '2026-08-18T00:00:00Z',
    },
    {
      test_path: 'src/test/java/com/app/behaviour/A_BehaviourTest.java',
      test_method: 'row1_x',
      contract_key: 'T-AAA',
      row_index: 1,
      contest_evidence: 'evidence',
      verdict: 'upheld',
      arbitrated_at: '2026-08-18T00:00:00Z',
    },
  ];

  it('round-trips through stable JSON, sorted by (path, method, row)', () => {
    const text = renderQuarantineManifest(entries);
    expect(text.endsWith('\n')).toBe(true);
    // Stable: same entries in any order render byte-identically.
    expect(renderQuarantineManifest([...entries].reverse())).toBe(text);
    const parsed = parseQuarantineManifest(text);
    expect(parsed).toEqual([entries[1], entries[0]]); // sorted order
  });

  it('parses tolerantly: bare arrays OK, malformed entries skipped, garbage → []', () => {
    expect(parseQuarantineManifest('not json at all')).toEqual([]);
    expect(parseQuarantineManifest('{"entries": "nope"}')).toEqual([]);
    const bareArray = JSON.stringify([
      {
        test_path: 'p',
        test_method: 'm',
        contract_key: 'T-1',
        row_index: 0,
      },
      { test_path: 'missing-everything-else' },
    ]);
    const parsed = parseQuarantineManifest(bareArray);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      test_path: 'p',
      test_method: 'm',
      contract_key: 'T-1',
      row_index: 0,
      contest_evidence: '',
      verdict: 'upheld',
      arbitrated_at: '',
    });
  });
});

describe('evaluateContestThresholds', () => {
  const cfg = { specThreshold: 0.2, runThreshold: 0.05 };

  it('per-spec: 2/12 (0.167) does not halt at 0.2; 3/12 (0.25) halts', () => {
    const under = evaluateContestThresholds(
      { suiteTestCount: 12, quarantinedCount: 2, runTotalTests: 100, runQuarantined: 0 },
      cfg
    );
    expect(under.haltSpec).toBe(false);
    expect(under.specRate).toBeCloseTo(2 / 12, 5);

    const over = evaluateContestThresholds(
      { suiteTestCount: 12, quarantinedCount: 3, runTotalTests: 100, runQuarantined: 0 },
      cfg
    );
    expect(over.haltSpec).toBe(true);
    expect(over.specRate).toBeCloseTo(0.25, 5);
  });

  it('run-level 5% boundary: exactly AT the threshold does not halt; above does', () => {
    const at = evaluateContestThresholds(
      { suiteTestCount: 10, quarantinedCount: 0, runTotalTests: 100, runQuarantined: 5 },
      cfg
    );
    expect(at.runRate).toBe(0.05);
    expect(at.haltRun).toBe(false); // strict-exceed

    const above = evaluateContestThresholds(
      { suiteTestCount: 10, quarantinedCount: 0, runTotalTests: 100, runQuarantined: 6 },
      cfg
    );
    expect(above.haltRun).toBe(true);
  });

  it('zero denominators never halt (rates are 0)', () => {
    const result = evaluateContestThresholds(
      { suiteTestCount: 0, quarantinedCount: 0, runTotalTests: 0, runQuarantined: 0 },
      cfg
    );
    expect(result).toEqual({ haltSpec: false, haltRun: false, specRate: 0, runRate: 0 });
  });

  it('reads config defaults (0.2 spec / 0.05 run) when no cfg is injected', () => {
    // Same numbers as above, but through the config path (env unset ⇒ defaults).
    const under = evaluateContestThresholds({
      suiteTestCount: 12,
      quarantinedCount: 2,
      runTotalTests: 100,
      runQuarantined: 5,
    });
    expect(under.haltSpec).toBe(false);
    expect(under.haltRun).toBe(false);
    const over = evaluateContestThresholds({
      suiteTestCount: 12,
      quarantinedCount: 3,
      runTotalTests: 100,
      runQuarantined: 6,
    });
    expect(over.haltSpec).toBe(true);
    expect(over.haltRun).toBe(true);
  });
});

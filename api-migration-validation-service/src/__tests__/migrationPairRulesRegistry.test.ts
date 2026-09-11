/**
 * Pair-per-project registry (second-pair programme, Spec 0, 2026-09-11).
 *
 * Pins:
 *   LIST PIN      — every ruleset file is listed, sorted by pair_id
 *   RESOLVE PIN   — source engine (+ version preference) selects the ruleset;
 *                   legacy suffixed engine values still resolve; unknown → null
 *   PIN-WINS PIN  — an env pin beats engine resolution
 *   MULTI PIN     — two files + no pin → loadPairRuleset() is null AND warns once
 *   HELPERS PIN   — rules_prefix / session-profile lookup / registry stamp
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  isPairPinned,
  listPairRulesets,
  loadPairRuleset,
  loadPairRulesetById,
  pairRegistryStamp,
  pairRulesetForSource,
  procRulePrefix,
  resetPairRulesetCacheForTest,
  resolvePairRuleset,
  sessionProfileRule,
} from '../migrationPairRules';

const ORIG_PAIR = process.env.MIGRATION_PAIR;
const ORIG_PATH = process.env.MIGRATION_PAIR_RULESET_PATH;
const ORIG_CWD = process.cwd();

function ruleset(pairId: string, source: string, version: string, extra: Record<string, unknown> = {}) {
  return {
    pair_id: pairId,
    version: 2,
    source: { engine: source, version, display: `${source} ${version}` },
    target: { engine: 'postgres', version: '18' },
    rules: [
      { id: `${pairId.toUpperCase()}.DT.001`, divergence_class: 'value_divergence', title: 'dt', comparison: null },
    ],
    ...extra,
  };
}

function makeRepo(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'pair-registry-'));
  mkdirSync(join(root, 'migration-pairs'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, 'migration-pairs', `${name}.rules.json`), JSON.stringify(content));
  }
  return root;
}

function resetEnv(): void {
  if (ORIG_PAIR === undefined) delete process.env.MIGRATION_PAIR;
  else process.env.MIGRATION_PAIR = ORIG_PAIR;
  if (ORIG_PATH === undefined) delete process.env.MIGRATION_PAIR_RULESET_PATH;
  else process.env.MIGRATION_PAIR_RULESET_PATH = ORIG_PATH;
  delete process.env.MIGRATION_PAIR;
  delete process.env.MIGRATION_PAIR_RULESET_PATH;
  process.chdir(ORIG_CWD);
  resetPairRulesetCacheForTest();
}

beforeEach(resetEnv);
afterAll(resetEnv);

describe('registry over the repo ruleset(s)', () => {
  test('the repo ruleset is listed, carries a rules_prefix, and resolves by its source engine', () => {
    const all = listPairRulesets();
    expect(all.length).toBeGreaterThanOrEqual(1);
    for (const rs of all) {
      expect(typeof rs.rules_prefix).toBe('string');
      expect(rs.rules.every((r) => r.id.startsWith(rs.rules_prefix as string))).toBe(true);
      const resolved = resolvePairRuleset({ sourceEngine: rs.source.engine, sourceVersion: rs.source.version });
      expect(resolved?.pair_id).toBe(rs.pair_id);
      expect(loadPairRulesetById(rs.pair_id)?.pair_id).toBe(rs.pair_id);
      expect(procRulePrefix(rs)).toBe(rs.rules_prefix);
    }
  });

  test('an unknown source engine yields null (honest), and pairRulesetForSource mirrors that', () => {
    expect(resolvePairRuleset({ sourceEngine: 'no-such-engine' })).toBeNull();
    expect(pairRulesetForSource('no-such-engine')).toBeNull();
  });

  test('a caller with NO engine at hand keeps the single-file discovery semantics', () => {
    const viaLegacy = loadPairRuleset();
    expect(pairRulesetForSource(null)?.pair_id ?? null).toBe(viaLegacy?.pair_id ?? null);
  });
});

describe('registry over a two-ruleset repo', () => {
  let root: string;
  beforeEach(() => {
    root = makeRepo({
      'alpha15-postgres18': ruleset('alpha15-postgres18', 'alpha', '15', { rules_prefix: 'ALPG.' }),
      'alpha16-postgres18': ruleset('alpha16-postgres18', 'alpha', '16', { rules_prefix: 'ALPG16.' }),
      'beta16-postgres18': ruleset('beta16-postgres18', 'beta', '16', {
        rules: [
          {
            id: 'BEPG.PROC.SESSION.001',
            divergence_class: 'behaviour_divergence',
            title: 'session',
            comparison: null,
            session_profile: { driver: 'x', set: ['set nocount on'] },
          },
        ],
      }),
    });
    process.chdir(root);
    resetPairRulesetCacheForTest();
  });

  test('lists every file sorted by pair_id', () => {
    expect(listPairRulesets().map((r) => r.pair_id)).toEqual([
      'alpha15-postgres18',
      'alpha16-postgres18',
      'beta16-postgres18',
    ]);
  });

  test('resolves by source engine: exact version preferred, else the highest', () => {
    expect(resolvePairRuleset({ sourceEngine: 'alpha', sourceVersion: '15' })?.pair_id).toBe('alpha15-postgres18');
    expect(resolvePairRuleset({ sourceEngine: 'alpha', sourceVersion: 15 })?.pair_id).toBe('alpha15-postgres18');
    expect(resolvePairRuleset({ sourceEngine: 'ALPHA' })?.pair_id).toBe('alpha16-postgres18');
    expect(resolvePairRuleset({ sourceEngine: 'alpha', sourceVersion: '99' })?.pair_id).toBe('alpha16-postgres18');
    expect(resolvePairRuleset({ sourceEngine: 'beta' })?.pair_id).toBe('beta16-postgres18');
  });

  test('legacy suffixed engine values (engine_edition, targetql) still resolve', () => {
    expect(resolvePairRuleset({ sourceEngine: 'beta_ase', targetEngine: 'postgresql' })?.pair_id).toBe('beta16-postgres18');
  });

  test('two files and no pin: loadPairRuleset() is null and warns exactly once', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(isPairPinned()).toBe(false);
      expect(loadPairRuleset()).toBeNull();
      resetPairRulesetCacheForTest();
      expect(loadPairRuleset()).toBeNull();
      const hits = warn.mock.calls.filter((c) => String(c[0]).includes('rulesets present and no MIGRATION_PAIR pin'));
      expect(hits.length).toBe(2); // once per cache reset (the reset clears the once-latch)
    } finally {
      warn.mockRestore();
    }
  });

  test('pairRulesetForSource: engine resolution without a pin; the env pin wins when set', () => {
    expect(pairRulesetForSource('beta')?.pair_id).toBe('beta16-postgres18');
    expect(pairRulesetForSource(null)).toBeNull(); // no engine + two files = honest null
    process.env.MIGRATION_PAIR = 'alpha15-postgres18';
    resetPairRulesetCacheForTest();
    expect(isPairPinned()).toBe(true);
    expect(pairRulesetForSource('beta')?.pair_id).toBe('alpha15-postgres18');
  });

  test('helpers: derived prefix when rules_prefix is absent; session-profile rule by role; registry stamp', () => {
    const beta = loadPairRulesetById('BETA16-postgres18');
    expect(beta).not.toBeNull();
    expect(procRulePrefix(beta!)).toBe('BEPG.');
    expect(sessionProfileRule(beta!)?.id).toBe('BEPG.PROC.SESSION.001');
    expect(sessionProfileRule(loadPairRulesetById('alpha15-postgres18'))).toBeNull();
    expect(sessionProfileRule(null)).toBeNull();
    const stamp = pairRegistryStamp();
    expect(stamp.migration_pairs).toEqual(['alpha15-postgres18', 'alpha16-postgres18', 'beta16-postgres18']);
    expect(stamp.pinned_pair).toBeNull();
    expect(stamp.migration_pair).toBeUndefined();
  });

  test('registry stamp names the pin and a single-file repo keeps the legacy migration_pair key', () => {
    process.env.MIGRATION_PAIR = 'beta16-postgres18';
    resetPairRulesetCacheForTest();
    expect(pairRegistryStamp().pinned_pair).toBe('beta16-postgres18');
    const single = makeRepo({ 'solo1-postgres18': ruleset('solo1-postgres18', 'solo', '1') });
    delete process.env.MIGRATION_PAIR;
    process.chdir(single);
    resetPairRulesetCacheForTest();
    const stamp = pairRegistryStamp();
    expect(stamp.migration_pair).toBe('solo1-postgres18');
    expect(stamp.migration_pairs).toEqual(['solo1-postgres18']);
  });
});

/**
 * Spec O (Data-Tier Oracle Program) — migration-pair ruleset loader +
 * comparison strategy library. Pins:
 *
 *   LOADER PIN    — the repo ruleset loads by discovery (single file, no env),
 *                   by MIGRATION_PAIR id, and by explicit path; missing/invalid
 *                   rulesets yield null (fail-soft, never throw)
 *   STRATEGY PINS — each strategy's equality semantics, driven by rule data
 *   CITATION PIN  — comparisons report the rule ids they applied
 *   STRICT PIN    — with no applicable rules, comparison is strict: divergence
 *                   tolerance is always rule-cited, never silent
 */
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  MigrationPairRule,
  activeRules,
  compareWithRules,
  loadPairRuleset,
  resetPairRulesetCacheForTest,
  resolvePairRuleset,
  rulesForColumnType,
} from '../migrationPairRules';

const ORIG_PAIR = process.env.MIGRATION_PAIR;
const ORIG_PATH = process.env.MIGRATION_PAIR_RULESET_PATH;

function resetEnv(): void {
  if (ORIG_PAIR === undefined) delete process.env.MIGRATION_PAIR;
  else process.env.MIGRATION_PAIR = ORIG_PAIR;
  if (ORIG_PATH === undefined) delete process.env.MIGRATION_PAIR_RULESET_PATH;
  else process.env.MIGRATION_PAIR_RULESET_PATH = ORIG_PATH;
  resetPairRulesetCacheForTest();
}

beforeEach(resetEnv);
afterAll(resetEnv);

function rule(partial: Partial<MigrationPairRule> & { id: string }): MigrationPairRule {
  return {
    divergence_class: 'test',
    title: 'test rule',
    ...partial,
  } as MigrationPairRule;
}

describe('loader', () => {
  test('resolves the repo ruleset for its source engine without env config', () => {
    delete process.env.MIGRATION_PAIR;
    delete process.env.MIGRATION_PAIR_RULESET_PATH;
    resetPairRulesetCacheForTest();
    const rs = resolvePairRuleset({ sourceEngine: 'sybase' });
    expect(rs).not.toBeNull();
    expect(rs!.pair_id.length).toBeGreaterThan(0);
    expect(rs!.version).toBeGreaterThanOrEqual(1);
    expect(rs!.rules.length).toBeGreaterThan(0);
    expect(typeof rs!.guidance_heading).toBe('string');
  });

  test('MIGRATION_PAIR selects the ruleset by id', () => {
    const discovered = resolvePairRuleset({ sourceEngine: 'sybase' });
    expect(discovered).not.toBeNull();
    resetPairRulesetCacheForTest();
    process.env.MIGRATION_PAIR = discovered!.pair_id;
    const byId = loadPairRuleset();
    expect(byId).not.toBeNull();
    expect(byId!.pair_id).toBe(discovered!.pair_id);
    expect(byId!.version).toBe(discovered!.version);
  });

  test('missing explicit path yields null (fail-soft)', () => {
    process.env.MIGRATION_PAIR_RULESET_PATH = join(tmpdir(), 'does-not-exist.rules.json');
    resetPairRulesetCacheForTest();
    expect(loadPairRuleset()).toBeNull();
  });

  test('invalid ruleset content yields null (fail-soft)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pair-rules-test-'));
    const bad = join(dir, 'broken.rules.json');
    writeFileSync(bad, '{"pair_id": "x", "rules": "not-an-array"}', 'utf8');
    process.env.MIGRATION_PAIR_RULESET_PATH = bad;
    resetPairRulesetCacheForTest();
    expect(loadPairRuleset()).toBeNull();
  });

  test('rulesForColumnType matches case-insensitively and excludes disabled rules', () => {
    const rs = resolvePairRuleset({ sourceEngine: 'sybase' });
    expect(rs).not.toBeNull();
    const varcharRules = rulesForColumnType(rs!, 'VARCHAR');
    expect(varcharRules.length).toBeGreaterThan(0);
    for (const r of varcharRules) {
      expect(r.comparison).toBeTruthy();
      expect(r.enabled_by_default).not.toBe(false);
    }
    expect(activeRules(rs!).every((r) => r.enabled_by_default !== false)).toBe(true);
  });
});

describe('strategies', () => {
  test('timestamp-truncate with ticks_per_second pins the tick grid', () => {
    const r = [rule({
      id: 'T.TICKS',
      comparison: { strategy: 'timestamp-truncate', params: { ticks_per_second: 300 } },
    })];
    // ROUND recovery (2026-08-11): renderings of ONE stored tick compare
    // equal even across a boundary (.456/.457 both recover tick 137 — the
    // live false key-mismatch class floor() created); values recovering
    // DIFFERENT ticks stay unequal.
    expect(compareWithRules('2026-01-01T00:00:00.456Z', '2026-01-01T00:00:00.457Z', r).equal).toBe(true);
    expect(compareWithRules('2026-01-01T00:00:00.003Z', '2026-01-01T00:00:00.007Z', r).equal).toBe(false);
  });

  test('timestamp-truncate with granularity_ms pins minute truncation', () => {
    const r = [rule({
      id: 'T.MIN',
      comparison: { strategy: 'timestamp-truncate', params: { granularity_ms: 60000 } },
    })];
    expect(compareWithRules('2026-01-01T12:00:10Z', '2026-01-01T12:00:50Z', r).equal).toBe(true);
    expect(compareWithRules('2026-01-01T12:00:10Z', '2026-01-01T12:01:10Z', r).equal).toBe(false);
  });

  test('string-rtrim: trailing spaces insignificant; empty equals single space; case preserved', () => {
    const r = [rule({ id: 'T.RTRIM', comparison: { strategy: 'string-rtrim' } })];
    expect(compareWithRules('A ', 'A', r).equal).toBe(true);
    expect(compareWithRules('', ' ', r).equal).toBe(true);
    expect(compareWithRules('A', 'a', r).equal).toBe(false);
  });

  test('numeric-rescale compares at fixed scale with rounding', () => {
    const r = [rule({
      id: 'T.SCALE',
      comparison: { strategy: 'numeric-rescale', params: { scale: 4 } },
    })];
    expect(compareWithRules('1.00004', 1.0, r).equal).toBe(true);
    expect(compareWithRules(1.00006, '1.0001', r).equal).toBe(true);
    expect(compareWithRules(1.0002, 1.0001, r).equal).toBe(false);
  });

  test('numeric-epsilon supplies pairwise tolerance', () => {
    const r = [rule({
      id: 'T.EPS',
      comparison: { strategy: 'numeric-epsilon', params: { relative: 1e-9 } },
    })];
    expect(compareWithRules(0.1 + 0.2, 0.3, r).equal).toBe(true);
    expect(compareWithRules(0.3, 0.300001, r).equal).toBe(false);
  });

  test('charset-normalize equates composed and decomposed forms', () => {
    const r = [rule({ id: 'T.NORM', comparison: { strategy: 'charset-normalize' } })];
    expect(compareWithRules('é', 'é', r).equal).toBe(true);
  });

  test('collation-case folds case when the rule is enabled', () => {
    const r = [rule({ id: 'T.CASE', comparison: { strategy: 'collation-case', params: { mode: 'casefold' } } })];
    expect(compareWithRules('ABC', 'abc', r).equal).toBe(true);
    expect(compareWithRules('ABC', 'abd', r).equal).toBe(false);
  });

  test('unknown strategies are flagged, never silently tolerant', () => {
    const r = [rule({ id: 'T.UNK', comparison: { strategy: 'no-such-strategy' } })];
    const same = compareWithRules('x', 'x', r);
    expect(same.equal).toBe(true);
    expect(same.unknownStrategies).toEqual(['no-such-strategy']);
    expect(compareWithRules('x', 'y', r).equal).toBe(false);
  });

  test('null semantics: null equals null; null never equals a canonical value', () => {
    const r = [rule({ id: 'T.NULL', comparison: { strategy: 'string-rtrim' } })];
    expect(compareWithRules(null, null, r).equal).toBe(true);
    expect(compareWithRules(null, '', r).equal).toBe(false);
  });

  test('with no rules, comparison is strict (tolerance is always rule-cited)', () => {
    expect(compareWithRules('a ', 'a', []).equal).toBe(false);
    expect(compareWithRules('a', 'a', []).equal).toBe(true);
  });

  test('applied rule ids are reported for citation', () => {
    const r = [
      rule({ id: 'CITE.1', comparison: { strategy: 'string-rtrim' } }),
      rule({ id: 'CITE.2', comparison: { strategy: 'collation-case' } }),
    ];
    const result = compareWithRules('AbC ', 'abc', r);
    expect(result.equal).toBe(true);
    expect(result.appliedRuleIds).toEqual(['CITE.1', 'CITE.2']);
  });
});

describe('bi-temporal open sentinel (Oracle Nine item 4)', () => {
  it('the 9999-12-31 open-row sentinel survives timestamp-truncate canonicalization', async () => {
    const { canonicalize } = await import('../migrationPairRules');
    const comparison = { strategy: 'timestamp-truncate', params: {} } as never;
    const sourceRendering = canonicalize('9999-12-31 00:00:00.0', comparison);
    const targetRendering = canonicalize('9999-12-31T00:00:00.000Z', comparison);
    // Canonical form is epoch-ms: the open-row sentinel must be finite
    // (never clipped/overflowed) and identical from both engines'
    // renderings — an updated row must never read as delete+insert.
    expect(typeof sourceRendering).toBe('number');
    expect(Number.isFinite(sourceRendering as number)).toBe(true);
    expect(sourceRendering).toBe(targetRendering);
  });
});

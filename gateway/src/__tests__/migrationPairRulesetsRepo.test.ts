/**
 * Every ruleset checked into migration-pairs/ is valid, self-consistent and
 * fully understood by the strategy library (second-pair programme, Spec 3).
 *
 * Pins per ruleset: unique rule ids sharing the declared rules_prefix; every
 * comparison strategy known to the library (compareWithRules reports none as
 * unknown); a session-profile rule present; a type_map rule present; source
 * and target engines declared; the SQL Server ruleset resolves for `mssql`
 * and the Sybase one for `sybase`, and they are distinct.
 */
import {
  compareWithRules,
  listPairRulesets,
  procRulePrefix,
  resetPairRulesetCacheForTest,
  resolvePairRuleset,
  sessionProfileRule,
} from '../migrationPairRules';

beforeEach(() => {
  delete process.env.MIGRATION_PAIR;
  delete process.env.MIGRATION_PAIR_RULESET_PATH;
  resetPairRulesetCacheForTest();
});

describe('repo rulesets', () => {
  test('both pairs are present and resolve by their source engine', () => {
    const ids = listPairRulesets().map((r) => r.pair_id);
    expect(ids).toEqual(expect.arrayContaining(['sybase15-postgres18', 'sqlserver16-postgres18']));
    expect(resolvePairRuleset({ sourceEngine: 'sybase' })?.pair_id).toBe('sybase15-postgres18');
    expect(resolvePairRuleset({ sourceEngine: 'mssql' })?.pair_id).toBe('sqlserver16-postgres18');
    expect(resolvePairRuleset({ sourceEngine: 'mssql', sourceVersion: '16' })?.pair_id).toBe('sqlserver16-postgres18');
  });

  for (const rs of listPairRulesets()) {
    describe(rs.pair_id, () => {
      test('rule ids are unique and carry the declared prefix', () => {
        const ids = rs.rules.map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        const prefix = procRulePrefix(rs);
        expect(prefix.length).toBeGreaterThan(0);
        expect(ids.every((id) => id.startsWith(prefix))).toBe(true);
      });

      test('every comparison strategy is known to the library', () => {
        const withComparison = rs.rules.filter((r) => r.comparison);
        expect(withComparison.length).toBeGreaterThan(0);
        const result = compareWithRules('a', 'a', withComparison);
        expect(result.unknownStrategies).toEqual([]);
      });

      test('declares engines, a session profile and a type map', () => {
        expect(rs.source.engine.length).toBeGreaterThan(0);
        expect(rs.target.engine).toBe('postgres');
        expect(sessionProfileRule(rs)?.session_profile?.set?.length ?? 0).toBeGreaterThan(0);
        expect(rs.rules.some((r) => r.type_map && Object.keys(r.type_map).length > 0)).toBe(true);
        expect(rs.rules.some((r) => r.convention && typeof r.convention.shapes === 'object')).toBe(true);
      });
    });
  }

  test('the SQL Server profile uses the named isolation level and never a Sybase-only option', () => {
    const rs = resolvePairRuleset({ sourceEngine: 'mssql' })!;
    const set = sessionProfileRule(rs)!.session_profile!.set!;
    expect(set).toContain('set transaction isolation level read committed');
    expect(set.some((s) => /\b(chained|string_rtruncation|ansinull)\b/.test(s))).toBe(false);
    expect(rs.rules.find((r) => r.id === 'MSPG.COLL.001')?.enabled_by_default).toBe(true);
  });
});

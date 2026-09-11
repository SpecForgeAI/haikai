import { forwardTransformRow } from '../services/dataMigration/pairRuleForwardTransform';
import { pairRulesetForSource } from '../migrationPairRules';

describe('forwardTransformRow (Spec Y load-time transform)', () => {
  const ruleset = pairRulesetForSource('sybase');

  it('loads the sybase15-postgres18 ruleset from the repo', () => {
    expect(ruleset).not.toBeNull();
    expect(ruleset?.pair_id).toBe('sybase15-postgres18');
  });

  it('NFC-normalizes string values and cites the charset rule', () => {
    // 'e' + combining acute accent (U+0301) -> NFC precomposed 'é' (U+00E9).
    const res = forwardTransformRow(
      { name: 'café' },
      [{ name: 'name', sourceType: 'varchar(50)' }],
      ruleset,
    );
    expect(res.values[0]).toBe('café');
    expect(res.appliedRuleIds).toContain('SYBPG.STR.002');
  });

  it('coerces bit 0/1 to boolean and cites the bit rule', () => {
    const one = forwardTransformRow({ active: 1 }, [{ name: 'active', sourceType: 'bit' }], ruleset);
    expect(one.values[0]).toBe(true);
    expect(one.appliedRuleIds).toContain('SYBPG.BIT.001');

    const zero = forwardTransformRow({ active: 0 }, [{ name: 'active', sourceType: 'bit' }], ruleset);
    expect(zero.values[0]).toBe(false);
  });

  it('does NOT truncate datetime on load (reconcile-time tolerance only)', () => {
    const ts = '2026-07-17T10:20:30.123Z';
    const res = forwardTransformRow({ created: ts }, [{ name: 'created', sourceType: 'datetime' }], ruleset);
    expect(res.values[0]).toBe(ts); // unchanged
    expect(res.appliedRuleIds).not.toContain('SYBPG.DT.001');
  });

  it('does NOT rescale money on load (target column enforces scale)', () => {
    const res = forwardTransformRow({ amount: '19.999' }, [{ name: 'amount', sourceType: 'money' }], ruleset);
    expect(res.values[0]).toBe('19.999');
    expect(res.appliedRuleIds).not.toContain('SYBPG.NUM.001');
  });

  it('aligns values to the column order and nulls missing columns', () => {
    const res = forwardTransformRow({ b: 2, a: 1 }, [
      { name: 'a', sourceType: 'int' },
      { name: 'b', sourceType: 'int' },
      { name: 'c', sourceType: 'int' },
    ], ruleset);
    expect(res.values).toEqual([1, 2, null]);
  });

  it('passes values through unchanged with no ruleset', () => {
    const res = forwardTransformRow({ x: 'raw' }, [{ name: 'x', sourceType: 'varchar' }], null);
    expect(res.values[0]).toBe('raw');
    expect(res.appliedRuleIds).toEqual([]);
  });
});

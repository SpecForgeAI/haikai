/**
 * NULL-aware keyset predicate (2026-08-07) — the pagination primitive behind
 * the uncapped bulk load. NULLS-LOW contract: NULL sorts lowest, so
 * "after NULL" = IS NOT NULL and "equal to NULL" = IS NULL.
 */
import { keysetPredicate } from '../services/db/keyset';

const lit = (v: unknown): string => (typeof v === 'number' ? String(v) : `'${String(v)}'`);

describe('keysetPredicate', () => {
  it('single-column key', () => {
    expect(keysetPredicate(['"id"'], [42], lit)).toBe('(("id" > 42))');
  });

  it('multi-column tuple expansion (a,b,c) > (x,y,z)', () => {
    expect(keysetPredicate(['"a"', '"b"', '"c"'], [1, 2, 3], lit)).toBe(
      '(("a" > 1) OR ("a" = 1 AND "b" > 2) OR ("a" = 1 AND "b" = 2 AND "c" > 3))',
    );
  });

  it('NULL key values map to IS [NOT] NULL under NULLS-LOW', () => {
    expect(keysetPredicate(['"a"', '"b"'], [null, 'x'], lit)).toBe(
      `(("a" IS NOT NULL) OR ("a" IS NULL AND "b" > 'x'))`,
    );
  });

  it('refuses arity mismatch and empty keys', () => {
    expect(() => keysetPredicate(['"a"'], [1, 2], lit)).toThrow('arity');
    expect(() => keysetPredicate([], [], lit)).toThrow('at least one order column');
  });
});

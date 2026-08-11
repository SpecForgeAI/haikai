/**
 * NULL-aware keyset predicate (2026-08-07) — the pagination primitive behind
 * the uncapped bulk load. NULLS-LOW contract: NULL sorts lowest, so
 * "after NULL" = IS NOT NULL and "equal to NULL" = IS NULL.
 */
import { keysetPredicate } from '../services/db/keyset';

const lit = (v: unknown): string => (typeof v === 'number' ? String(v) : `'${String(v)}'`);

describe('keysetPredicate', () => {
  it('single-column key (no redundant bound — the branch is already sargable)', () => {
    expect(keysetPredicate(['"id"'], [42], lit)).toBe('((("id" > 42)))');
  });

  it('multi-column tuple expansion carries the SARGABLE leading bound (2026-08-11)', () => {
    // `"a" >= 1` is implied by every OR branch (semantics untouched) but lets
    // the optimiser range-seek instead of scan-and-discard from the table
    // start — the linear page-cost growth behind the truncated-load shape.
    expect(keysetPredicate(['"a"', '"b"', '"c"'], [1, 2, 3], lit)).toBe(
      '("a" >= 1 AND (("a" > 1) OR ("a" = 1 AND "b" > 2) OR ("a" = 1 AND "b" = 2 AND "c" > 3)))',
    );
  });

  it('NULL key values map to IS [NOT] NULL under NULLS-LOW (no bound on a NULL lead)', () => {
    expect(keysetPredicate(['"a"', '"b"'], [null, 'x'], lit)).toBe(
      `((("a" IS NOT NULL) OR ("a" IS NULL AND "b" > 'x')))`,
    );
  });

  it('refuses arity mismatch and empty keys', () => {
    expect(() => keysetPredicate(['"a"'], [1, 2], lit)).toThrow('arity');
    expect(() => keysetPredicate([], [], lit)).toThrow('at least one order column');
  });
});

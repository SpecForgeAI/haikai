/**
 * Condition-colour threshold tests (2026-08-16).
 *
 * Locks the agreed TOP-DOWN `>=` boundary convention: exactly 5% -> light
 * orange, exactly 15% -> medium orange, exactly 30% -> medium red on the
 * undesired scale; exactly 95% -> light green, 100% -> medium green on the
 * fully-reconciled scale. The undesired scale deliberately has NO light-green
 * tier — any nonzero value is at least yellow.
 */

import { describe, it, expect } from 'vitest';
import {
  formatCountWithPct,
  matchingTier,
  reconciledTier,
  undesiredTier,
} from '../progressReportColours';

describe('undesiredTier (desired value is zero)', () => {
  it('zero is medium green regardless of denominator', () => {
    expect(undesiredTier(0, 120)).toBe('medium-green');
    expect(undesiredTier(0, 0)).toBe('medium-green');
    expect(undesiredTier(0, null)).toBe('medium-green');
  });

  it('any nonzero value is at least yellow (no light-green tier)', () => {
    expect(undesiredTier(1, 10000)).toBe('yellow');
  });

  it('boundaries fall per the top-down >= convention', () => {
    expect(undesiredTier(2, 120)).toBe('yellow'); // 1.7%
    expect(undesiredTier(6, 120)).toBe('light-orange'); // exactly 5%
    expect(undesiredTier(17, 120)).toBe('light-orange'); // 14.2%
    expect(undesiredTier(18, 120)).toBe('medium-orange'); // exactly 15%
    expect(undesiredTier(35, 120)).toBe('medium-orange'); // 29.2%
    expect(undesiredTier(36, 120)).toBe('medium-red'); // exactly 30%
    expect(undesiredTier(120, 120)).toBe('medium-red');
  });

  it('nonzero with an unknown/zero denominator is medium red', () => {
    expect(undesiredTier(3, null)).toBe('medium-red');
    expect(undesiredTier(3, 0)).toBe('medium-red');
  });
});

describe('reconciledTier (inverse ladder)', () => {
  it('100% is medium green; a zero/unknown denominator is vacuously complete', () => {
    expect(reconciledTier(120, 120)).toBe('medium-green');
    expect(reconciledTier(0, 0)).toBe('medium-green');
    expect(reconciledTier(0, null)).toBe('medium-green');
  });

  it('boundaries fall per the top-down >= convention', () => {
    expect(reconciledTier(114, 120)).toBe('light-green'); // exactly 95%
    expect(reconciledTier(113, 120)).toBe('yellow'); // 94.2%
    expect(reconciledTier(102, 120)).toBe('yellow'); // exactly 85%
    expect(reconciledTier(101, 120)).toBe('light-orange'); // 84.2%
    expect(reconciledTier(90, 120)).toBe('light-orange'); // exactly 75%
    expect(reconciledTier(89, 120)).toBe('medium-orange'); // 74.2%
    expect(reconciledTier(60, 120)).toBe('medium-orange'); // exactly 50%
    expect(reconciledTier(59, 120)).toBe('medium-red'); // 49.2%
    expect(reconciledTier(0, 120)).toBe('medium-red');
  });
});

describe('matchingTier', () => {
  it('true is medium green, false is medium red', () => {
    expect(matchingTier(true)).toBe('medium-green');
    expect(matchingTier(false)).toBe('medium-red');
  });
});

describe('formatCountWithPct', () => {
  it('one decimal below 10%, whole numbers above', () => {
    expect(formatCountWithPct(2, 120)).toBe('2 (1.7%)');
    expect(formatCountWithPct(114, 120)).toBe('114 (95%)');
  });

  it('falls back to the bare count without a denominator', () => {
    expect(formatCountWithPct(7, null)).toBe('7');
    expect(formatCountWithPct(7, 0)).toBe('7');
  });
});

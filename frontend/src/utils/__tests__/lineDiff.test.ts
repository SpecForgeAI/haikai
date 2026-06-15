/**
 * lineDiff tests
 *
 * Spec: 2026-05-20 In-Product Spec Editor + Confirm-Overwrite -- Task Group 6.1 + 6.4.
 *
 * Smoke-tests the LCS line diff utility. Coverage:
 *   - Trivial add / remove / unchanged classification on a one-line change.
 *   - Empty old text -> all lines emit as `added`.
 *   - Identical inputs -> all lines emit as `unchanged`.
 */

import { describe, it, expect } from 'vitest';
import { computeLineDiff } from '../lineDiff';

describe('computeLineDiff', () => {
  it('emits add / remove / unchanged segments for a trivial one-line change', () => {
    const oldText = 'line one\nline two\nline three';
    const newText = 'line one\nline two-edited\nline three';

    const diff = computeLineDiff(oldText, newText);

    expect(diff).toEqual([
      { type: 'unchanged', text: 'line one' },
      { type: 'removed', text: 'line two' },
      { type: 'added', text: 'line two-edited' },
      { type: 'unchanged', text: 'line three' },
    ]);
  });

  it('treats an empty old text as zero lines (every new line is added)', () => {
    const diff = computeLineDiff('', 'first\nsecond');
    expect(diff).toEqual([
      { type: 'added', text: 'first' },
      { type: 'added', text: 'second' },
    ]);
  });

  it('returns all-unchanged when both inputs are identical', () => {
    const text = 'alpha\nbeta\ngamma';
    const diff = computeLineDiff(text, text);
    expect(diff).toEqual([
      { type: 'unchanged', text: 'alpha' },
      { type: 'unchanged', text: 'beta' },
      { type: 'unchanged', text: 'gamma' },
    ]);
  });

  it('treats an empty new text as zero lines (every old line is removed)', () => {
    const diff = computeLineDiff('keep\ngone', '');
    expect(diff).toEqual([
      { type: 'removed', text: 'keep' },
      { type: 'removed', text: 'gone' },
    ]);
  });

  it('returns an empty array for two empty texts', () => {
    expect(computeLineDiff('', '')).toEqual([]);
  });
});

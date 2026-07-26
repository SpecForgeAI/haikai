/**
 * Server-gate block-reason grouping (2026-07-26).
 *
 * The Start dialog used to report only "N reason(s) — see the plane cards",
 * but the cards visualise ONLY spec readiness — the gate's baseline and
 * carry-over dimensions were invisible, leaving the user with no next step.
 * Pins the grouping: known codes get friendly titles + remedies, unknown
 * codes fall back to the raw code, messages preserve order.
 */
import { describe, it, expect } from 'vitest';
import { groupBlockReasons } from '../MigrationBookOfWorkReviewWorkspace';

describe('groupBlockReasons', () => {
  it('groups by code with friendly titles + remedies; unknown codes fall back to the code', () => {
    const groups = groupBlockReasons([
      { code: 'carry_over_not_accounted', message: 'finding A not accounted' },
      { code: 'story_not_spec_ready', message: 'Story "X" is not spec-ready' },
      { code: 'carry_over_not_accounted', message: 'finding B not accounted' },
      { code: 'missing_current_baseline', message: 'no baseline' },
      { code: 'some_future_code', message: 'mystery' },
    ]);
    expect(groups.map((g) => g.code)).toEqual([
      'carry_over_not_accounted',
      'story_not_spec_ready',
      'missing_current_baseline',
      'some_future_code',
    ]);
    const carryOver = groups[0];
    expect(carryOver.title).toBe('Carry-over items not accounted');
    expect(carryOver.remedy).toMatch(/CITED|DISMISSED/);
    expect(carryOver.messages).toEqual([
      'finding A not accounted',
      'finding B not accounted',
    ]);
    const unknown = groups[3];
    expect(unknown.title).toBe('some_future_code');
    expect(unknown.remedy).toBeNull();
  });

  it('empty input -> empty groups', () => {
    expect(groupBlockReasons([])).toEqual([]);
  });
});

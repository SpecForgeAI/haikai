/**
 * Second identity for four-eyes endpoints (Item #4, 2026-08-27) + the
 * coverage-score exclusion for manual_rec_required scenarios.
 */

import { resolveSecondIdentityOverride } from '../services/authOverride';
import {
  assembleCoverageSummary,
  scoreEndpointCoverage,
  type GeneratedScenario,
} from '../services/captureSessionOrchestrator';

describe('resolveSecondIdentityOverride', () => {
  it('swaps the secondary value into the SAME auth shape', () => {
    expect(
      resolveSecondIdentityOverride({
        type: 'custom_header',
        headerName: 'ssoToken',
        headerValue: 'primary',
        secondaryValue: 'other-human',
      }),
    ).toMatchObject({ type: 'custom_header', headerName: 'ssoToken', headerValue: 'other-human' });
    expect(
      resolveSecondIdentityOverride({ type: 'bearer', bearerToken: 'p', secondaryValue: 's' }),
    ).toMatchObject({ type: 'bearer', bearerToken: 's' });
  });

  it('is null without a secondary value or on unsupported auth types', () => {
    expect(resolveSecondIdentityOverride({ type: 'bearer', bearerToken: 'p' })).toBeNull();
    expect(
      resolveSecondIdentityOverride({ type: 'none', secondaryValue: 'x' } as never),
    ).toBeNull();
  });
});

describe('coverage exclusion for manual_rec_required (Item #4)', () => {
  const op = { operation_id: 'publishFilter', method: 'POST', path: '/filters/publish' };
  const scenarios = [
    { name: 'happy_path', type: 'happy_path', expectedStatus: 'success' },
    { name: 'four_eyes_publish', type: 'business_edge_case', expectedStatus: 'success' },
  ] as unknown as GeneratedScenario[];

  it('an excluded dimension leaves the denominator and is labelled a human todo', () => {
    const outcomes = new Map([
      ['happy_path', [{ captureId: 'c1', status: 200, body: { ok: true } }]],
    ]);
    const result = scoreEndpointCoverage(
      op,
      scenarios,
      outcomes as never,
      null,
      new Set(['four_eyes_publish']),
    );
    const excluded = result.dimensions.find((d) => d.name === 'four_eyes_publish');
    expect(excluded?.excluded).toBe(true);
    expect(excluded?.reason).toContain('manual_rec_required');
    // Score = 1/1, not 1/2: the human todo never drags the score.
    expect(result.score).toBe(1);

    const summary = assembleCoverageSummary([result], {
      achieved: true,
      representative_operation_id: null,
      probes: [],
    } as never);
    // 1 scoring dimension + the auth dimension.
    expect(summary.dimensions_total).toBe(2);
    expect(summary.dimensions_achieved).toBe(2);
  });
});

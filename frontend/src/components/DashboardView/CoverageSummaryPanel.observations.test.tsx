/**
 * CoverageSummaryPanel -- reframed metric + non-scoring observations tests
 *
 * Spec: 2026-06-23 Semantics-aware API Behaviour Baseline coverage -- Task
 * Group 5 (5.1b).
 *
 * Coverage (focused):
 *   - the overall metric is reframed to read as "behaviour observed/captured"
 *     (not REST-convention adherence);
 *   - the separate, clearly-labelled NON-SCORING "Observations / REST-convention
 *     deviations" list renders the items from `summary.observations`;
 *   - the parser tolerates the new `observations` field and defaults it to `[]`
 *     (never throws) when absent, so no observations list is rendered.
 *
 * The panel takes its CSS classes as a prop (`classes`), so no CSS-module mock
 * is needed; we pass plain string class names.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  CoverageSummaryPanel,
  parseCoverageSummary,
} from './CoverageSummaryPanel';

const classes = {
  banner: 'banner',
  badge: 'badge',
  badgeWarning: 'badgeWarning',
};

/** A minimal raw summary blob (snake_case wire) with observations. */
function rawSummaryWithObservations(): Record<string, unknown> {
  return {
    overall_score: 0.98,
    dimensions_total: 50,
    dimensions_achieved: 49,
    per_endpoint: [],
    auth_coverage: { achieved: true, representative_operation_id: 'op-1', probes: [] },
    observations: [
      'returns 200 for a missing resource',
      'no auth enforced',
      '500 with no recognizable validation body — possible crash',
    ],
  };
}

describe('CoverageSummaryPanel -- reframed metric + observations (Task 5.1b)', () => {
  it('reframes the overall metric to "behaviour observed/captured"', () => {
    render(<CoverageSummaryPanel raw={rawSummaryWithObservations()} classes={classes} />);

    const overall = screen.getByTestId('coverage-summary-overall');
    expect(overall).toHaveTextContent('Behaviour observed/captured');
    expect(overall).toHaveTextContent('98%');
    // The old "Oracle coverage" / "pinned" framing is gone.
    expect(overall).not.toHaveTextContent('Oracle coverage');
  });

  it('renders the separate non-scoring "Observations / REST-convention deviations" list', () => {
    render(<CoverageSummaryPanel raw={rawSummaryWithObservations()} classes={classes} />);

    const list = screen.getByTestId('coverage-summary-observations-list');
    expect(list).toBeInTheDocument();
    const items = screen.getAllByTestId('coverage-summary-observation');
    expect(items).toHaveLength(3);
    expect(list).toHaveTextContent('returns 200 for a missing resource');
    expect(list).toHaveTextContent('no auth enforced');
    expect(list).toHaveTextContent('possible crash');

    // The section is clearly labelled as non-scoring.
    const section = screen.getByTestId('coverage-summary-observations');
    expect(section).toHaveTextContent(/non-scoring/i);
  });

  it('parses observations defensively (defaults to [] when absent) and renders no list', () => {
    const rawNoObs: Record<string, unknown> = {
      overall_score: 0.5,
      dimensions_total: 2,
      dimensions_achieved: 1,
      per_endpoint: [],
      auth_coverage: { achieved: false, representative_operation_id: null, probes: [] },
      // no `observations` field at all (legacy / pre-fix)
    };

    // Parser never throws and defaults observations to [].
    const parsed = parseCoverageSummary(rawNoObs);
    expect(parsed).not.toBeNull();
    expect(parsed?.observations).toEqual([]);
    // A non-array observations value is also coerced to [] (never throws).
    expect(
      parseCoverageSummary({ ...rawNoObs, observations: 'oops' })?.observations,
    ).toEqual([]);

    render(<CoverageSummaryPanel raw={rawNoObs} classes={classes} />);
    expect(
      screen.queryByTestId('coverage-summary-observations'),
    ).not.toBeInTheDocument();
    // The reframed metric still renders.
    expect(screen.getByTestId('coverage-summary-overall')).toHaveTextContent(
      'Behaviour observed/captured',
    );
  });
});

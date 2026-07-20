/**
 * Happy-path coverage GATE — helper + banner (Spec 2026-07-20 Coverage Closure,
 * CC1).
 *
 * Coverage:
 *   - computeHappyPathGate mirrors the service gate: complete IFF every included
 *     endpoint has its happy-path baseline; null/empty is never complete;
 *   - CoverageGateBanner renders "complete" vs "N unresolved" and only shows the
 *     "Retry uncovered APIs" button when a handler is wired AND work remains.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  CoverageGateBanner,
  computeHappyPathGate,
} from './CoverageSummaryPanel';

const classes = {
  banner: 'banner',
  badge: 'badge',
  badgeWarning: 'badgeWarning',
  button: 'button',
};

function rawWith(perEndpoint: unknown[]): Record<string, unknown> {
  return {
    overall_score: 0,
    dimensions_total: 0,
    dimensions_achieved: 0,
    per_endpoint: perEndpoint,
    auth_coverage: { achieved: false, representative_operation_id: null, probes: [] },
    observations: [],
  };
}

function ep(operation_id: string, method: string, path: string, happyAchieved: boolean) {
  return {
    operation_id,
    method,
    path,
    score: happyAchieved ? 1 : 0,
    dimensions: [
      {
        name: 'happy_path',
        type: 'happy_path',
        expected_status: 'success',
        achieved: happyAchieved,
        canonical_capture_id: happyAchieved ? 'c1' : null,
        reason: happyAchieved ? null : 'id 999 not found',
        observation: null,
      },
    ],
  };
}

describe('computeHappyPathGate', () => {
  it('null / unrecorded -> not complete', () => {
    expect(computeHappyPathGate(null).complete).toBe(false);
    expect(computeHappyPathGate(undefined).included_total).toBe(0);
  });

  it('all included endpoints have happy-path -> complete', () => {
    const gate = computeHappyPathGate(rawWith([ep('a', 'GET', '/a', true), ep('b', 'GET', '/b', true)]));
    expect(gate.complete).toBe(true);
    expect(gate.happy_achieved).toBe(2);
    expect(gate.unresolved).toHaveLength(0);
  });

  it('a missing happy-path -> not complete, listed with reason', () => {
    const gate = computeHappyPathGate(rawWith([ep('a', 'GET', '/a', true), ep('b', 'GET', '/b/{id}', false)]));
    expect(gate.complete).toBe(false);
    expect(gate.unresolved).toEqual([
      { operation_id: 'b', method: 'GET', path: '/b/{id}', reason: 'id 999 not found' },
    ]);
  });
});

describe('CoverageGateBanner', () => {
  it('renders the complete state when every endpoint has happy-path', () => {
    render(<CoverageGateBanner raw={rawWith([ep('a', 'GET', '/a', true)])} classes={classes} />);
    expect(screen.getByTestId('coverage-gate')).toHaveAttribute('data-complete', 'true');
    expect(screen.getByTestId('coverage-gate-complete')).toBeInTheDocument();
  });

  it('renders nothing before any coverage is recorded', () => {
    const { container } = render(<CoverageGateBanner raw={null} classes={classes} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the unresolved list + fires onRetryUncovered with the endpoints', () => {
    const onRetry = vi.fn();
    render(
      <CoverageGateBanner
        raw={rawWith([ep('a', 'GET', '/a', true), ep('b', 'GET', '/b/{id}', false)])}
        classes={classes}
        onRetryUncovered={onRetry}
      />,
    );
    expect(screen.getByTestId('coverage-gate')).toHaveAttribute('data-complete', 'false');
    expect(screen.getAllByTestId('coverage-gate-unresolved')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('coverage-gate-retry'));
    expect(onRetry).toHaveBeenCalledWith([
      { operation_id: 'b', method: 'GET', path: '/b/{id}', reason: 'id 999 not found' },
    ]);
  });

  it('omits the retry button when no handler is wired', () => {
    render(<CoverageGateBanner raw={rawWith([ep('b', 'GET', '/b/{id}', false)])} classes={classes} />);
    expect(screen.queryByTestId('coverage-gate-retry')).not.toBeInTheDocument();
  });
});

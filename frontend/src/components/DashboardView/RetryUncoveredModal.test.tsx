/**
 * RetryUncoveredModal — per-endpoint attempts + notes config capture (CC3, Spec
 * 2026-07-20).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { RetryUncoveredModal, DEFAULT_ATTEMPTS } from './RetryUncoveredModal';
import type { UnresolvedEndpoint } from './CoverageSummaryPanel';

const classes = {
  backdrop: 'backdrop',
  panel: 'panel',
  header: 'header',
  body: 'body',
  primaryButton: 'primaryButton',
  secondaryButton: 'secondaryButton',
};

const unresolved: UnresolvedEndpoint[] = [
  { operation_id: 'op1', method: 'GET', path: '/orders/{id}', reason: 'id 999 not found' },
  { operation_id: 'op2', method: 'POST', path: '/orders', reason: '422 bad body' },
];

describe('RetryUncoveredModal', () => {
  it('lists the uncovered endpoints and defaults attempts to 15', () => {
    render(<RetryUncoveredModal unresolved={unresolved} classes={classes} onClose={() => {}} />);
    expect(screen.getAllByTestId('retry-uncovered-modal-row')).toHaveLength(2);
    expect(screen.getByTestId('retry-uncovered-modal-attempts-op1')).toHaveValue(DEFAULT_ATTEMPTS);
  });

  it('disables launch when no handler is wired', () => {
    render(<RetryUncoveredModal unresolved={unresolved} classes={classes} onClose={() => {}} />);
    expect(screen.getByTestId('retry-uncovered-modal-launch')).toBeDisabled();
  });

  it('collects per-endpoint attempts + notes and passes them to onLaunch', () => {
    const onLaunch = vi.fn();
    render(
      <RetryUncoveredModal
        unresolved={unresolved}
        classes={classes}
        onClose={() => {}}
        onLaunch={onLaunch}
      />,
    );
    fireEvent.change(screen.getByTestId('retry-uncovered-modal-attempts-op1'), {
      target: { value: '25' },
    });
    fireEvent.change(screen.getByTestId('retry-uncovered-modal-notes-op1'), {
      target: { value: "try ID=3275, use 'Core' for type" },
    });
    fireEvent.click(screen.getByTestId('retry-uncovered-modal-launch'));
    expect(onLaunch).toHaveBeenCalledWith([
      {
        operation_id: 'op1',
        method: 'GET',
        path: '/orders/{id}',
        attempts: 25,
        notes: "try ID=3275, use 'Core' for type",
      },
      { operation_id: 'op2', method: 'POST', path: '/orders', attempts: DEFAULT_ATTEMPTS, notes: '' },
    ]);
  });

  it('invalid attempts fall back to the default', () => {
    const onLaunch = vi.fn();
    render(
      <RetryUncoveredModal
        unresolved={[unresolved[0]]}
        classes={classes}
        onClose={() => {}}
        onLaunch={onLaunch}
      />,
    );
    fireEvent.change(screen.getByTestId('retry-uncovered-modal-attempts-op1'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByTestId('retry-uncovered-modal-launch'));
    expect(onLaunch.mock.calls[0][0][0].attempts).toBe(DEFAULT_ATTEMPTS);
  });
});

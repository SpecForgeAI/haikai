/**
 * RetryUncoveredModal — table redesign (2026-08-02): one table of all missing
 * scenarios (happy + other) with per-row attempts/notes/not-possible and a
 * compact "include other" checkbox beside the buttons.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { RetryUncoveredModal, DEFAULT_ATTEMPTS } from './RetryUncoveredModal';
import type { UnresolvedEndpoint, FailedDimensionItem } from './CoverageSummaryPanel';

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

const failedDimensions: FailedDimensionItem[] = [
  { operation_id: 'op1', method: 'GET', path: '/orders/{id}', name: 'not_found', type: 'error', reason: null },
];

describe('RetryUncoveredModal (table)', () => {
  it('renders one table row per missing scenario, happy + other, with a Type badge', () => {
    render(
      <RetryUncoveredModal
        unresolved={unresolved}
        failedDimensions={failedDimensions}
        classes={classes}
        onClose={() => {}}
      />,
    );
    const rows = screen.getAllByTestId('retry-uncovered-modal-row');
    expect(rows).toHaveLength(3); // 2 happy + 1 other
    expect(rows[0]).toHaveAttribute('data-kind', 'happy');
    expect(rows[2]).toHaveAttribute('data-kind', 'other');
    expect(screen.getByTestId('retry-uncovered-modal-attempts-op1')).toHaveValue(DEFAULT_ATTEMPTS);
  });

  it('disables launch when no handler is wired', () => {
    render(<RetryUncoveredModal unresolved={unresolved} classes={classes} onClose={() => {}} />);
    expect(screen.getByTestId('retry-uncovered-modal-launch')).toBeDisabled();
  });

  it('passes only NON-excluded happy-path rows to onLaunch with their attempts + notes', () => {
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
    expect(onLaunch).toHaveBeenCalledWith(
      [
        {
          operation_id: 'op1',
          method: 'GET',
          path: '/orders/{id}',
          attempts: 25,
          notes: "try ID=3275, use 'Core' for type",
        },
        { operation_id: 'op2', method: 'POST', path: '/orders', attempts: DEFAULT_ATTEMPTS, notes: '' },
      ],
      false,
    );
  });

  it('hides the include-other checkbox when there are no other failed scenarios', () => {
    render(
      <RetryUncoveredModal
        unresolved={unresolved}
        classes={classes}
        onClose={() => {}}
        onLaunch={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('retry-uncovered-modal-dimensions-toggle')).toBeNull();
  });

  it('shows the include-other checkbox with a count and passes the flag when checked', () => {
    const onLaunch = vi.fn();
    render(
      <RetryUncoveredModal
        unresolved={unresolved}
        failedDimensions={failedDimensions}
        classes={classes}
        onClose={() => {}}
        onLaunch={onLaunch}
      />,
    );
    const toggle = screen.getByTestId('retry-uncovered-modal-dimensions-toggle');
    expect(toggle.textContent).toContain('Include other failed coverage scenarios (1)');
    fireEvent.click(screen.getByTestId('retry-uncovered-modal-dimensions-checkbox'));
    fireEvent.click(screen.getByTestId('retry-uncovered-modal-launch'));
    expect(onLaunch.mock.calls[0][1]).toBe(true);
  });

  it('dimensional-only (no happy rows) implies the include-other flag on launch', () => {
    const onLaunch = vi.fn();
    render(
      <RetryUncoveredModal
        unresolved={[]}
        failedDimensions={failedDimensions}
        classes={classes}
        onClose={() => {}}
        onLaunch={onLaunch}
      />,
    );
    const launch = screen.getByTestId('retry-uncovered-modal-launch');
    expect(launch).toHaveTextContent('Re-attempt failed scenarios');
    fireEvent.click(launch);
    expect(onLaunch).toHaveBeenCalledWith([], true);
  });

  it('"Not possible" needs a reason, then excludes the row (whole endpoint for happy, dimension for other)', () => {
    const onExclude = vi.fn();
    const onLaunch = vi.fn();
    render(
      <RetryUncoveredModal
        unresolved={unresolved}
        failedDimensions={failedDimensions}
        classes={classes}
        onClose={() => {}}
        onLaunch={onLaunch}
        onExclude={onExclude}
      />,
    );
    // Disabled until a reason is present.
    expect(screen.getByTestId('retry-uncovered-modal-notpossible-op2')).toBeDisabled();
    fireEvent.change(screen.getByTestId('retry-uncovered-modal-notes-op2'), {
      target: { value: 'XML variant 400s on current-state; JSON only' },
    });
    fireEvent.click(screen.getByTestId('retry-uncovered-modal-notpossible-op2'));
    // Happy-path row -> whole-endpoint exclusion (no scenarioName).
    expect(onExclude).toHaveBeenCalledWith(
      'op2',
      'XML variant 400s on current-state; JSON only',
      undefined,
    );

    // The "other" row (op1 / not_found) excludes at the dimension level.
    fireEvent.change(screen.getByTestId('retry-uncovered-modal-notes-op1-not_found'), {
      target: { value: 'error path not reproducible on current-state' },
    });
    fireEvent.click(screen.getByTestId('retry-uncovered-modal-notpossible-op1-not_found'));
    expect(onExclude).toHaveBeenLastCalledWith(
      'op1',
      'error path not reproducible on current-state',
      'not_found',
    );
  });

  it('a not-possible happy row is dropped from the closure launch set', () => {
    const onExclude = vi.fn();
    const onLaunch = vi.fn();
    render(
      <RetryUncoveredModal
        unresolved={unresolved}
        classes={classes}
        onClose={() => {}}
        onLaunch={onLaunch}
        onExclude={onExclude}
      />,
    );
    fireEvent.change(screen.getByTestId('retry-uncovered-modal-notes-op2'), {
      target: { value: 'not possible' },
    });
    fireEvent.click(screen.getByTestId('retry-uncovered-modal-notpossible-op2'));
    fireEvent.click(screen.getByTestId('retry-uncovered-modal-launch'));
    const launched = onLaunch.mock.calls[0][0] as Array<{ operation_id: string }>;
    expect(launched.map((c) => c.operation_id)).toEqual(['op1']);
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

/**
 * BatchResolveConflictsModal tests
 *
 * Spec 2026-06-23 Batch "Resolve Conflicts" Modal -- Task Group 2.1.
 *
 * Focused coverage of the five critical modal behaviours (the commit/result-
 * banner/retry wiring is exercised in TG3):
 *
 *   (a) renders one row per (candidate, attribute) conflict, grouped by type
 *       with friendly group headers, sorted by name;
 *   (b) the "* most authoritative" tag lands on the highest-ranked option in a
 *       row;
 *   (c) "Use most authoritative source" pre-selects rows and "Prefer a
 *       source..." pre-selects only where present;
 *   (d) the prefer-source dropdown lists ONLY sources present;
 *   (e) the empty / all-resolved state shows "No unresolved conflicts." with
 *       only a Close button.
 *
 * The CSS module is proxied so class names equal their keys (mirrors the
 * BulkCandidateActionConfirmModal test), letting selectors stay testid-based.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';

vi.mock('./BatchResolveConflictsModal.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import {
  BatchResolveConflictsModal,
  type BatchRowSelections,
} from './BatchResolveConflictsModal';
import { rowKey, type ConflictRow } from './batchResolveConflictsSupport';

function row(
  candidateId: string,
  candidateName: string,
  type: string,
  attr: string,
  options: { value: unknown; source: string }[],
): ConflictRow {
  return { candidateId, candidateName, type, attr, options };
}

// Two types, multiple candidates, an out-of-alphabetical-order pair to prove the
// within-group name sort. Each row has a clear highest-authority option.
function buildRows(): ConflictRow[] {
  return [
    row('s2', 'Zeta Service', 'service', 'description', [
      { value: 'guessed', source: 'llm-gap-fill' },
      { value: 'scanned', source: 'spring-classic-jaxrs' },
    ]),
    row('s1', 'Alpha Service', 'service', 'name', [
      { value: 'rt-name', source: 'runtime-evidence' },
      { value: 'fw-name', source: 'spring-classic-jaxrs' },
    ]),
    row('e1', 'Orders', 'logical_data_entities', 'label', [
      { value: 'Orders', source: 'spring-classic-jaxrs' },
      { value: 'OrderRT', source: 'runtime-evidence' },
    ]),
  ];
}

describe('BatchResolveConflictsModal -- grouping, sorting, rows', () => {
  it('renders one row per conflict, grouped by type (friendly headers), sorted by name', () => {
    render(
      <BatchResolveConflictsModal
        isOpen
        rows={buildRows()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    // Friendly group headers from the TG1 label map.
    expect(
      screen.getByTestId('batch-resolve-group-header-service'),
    ).toHaveTextContent('Services');
    expect(
      screen.getByTestId('batch-resolve-group-header-logical_data_entities'),
    ).toHaveTextContent('Logical Data Entities');

    // One row per (candidate, attribute).
    expect(
      screen.getByTestId(`batch-resolve-row-${rowKey({ candidateId: 's1', attr: 'name' })}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`batch-resolve-row-${rowKey({ candidateId: 's2', attr: 'description' })}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`batch-resolve-row-${rowKey({ candidateId: 'e1', attr: 'label' })}`),
    ).toBeInTheDocument();

    // Within the Services group, Alpha (s1) sorts before Zeta (s2).
    const serviceGroup = screen.getByTestId('batch-resolve-group-service');
    const names = within(serviceGroup)
      .getAllByTestId(/^batch-resolve-row-name-/)
      .map((el) => el.textContent);
    expect(names).toEqual(['Alpha Service', 'Zeta Service']);
  });

  it('marks the "* most authoritative" tag on the highest-ranked option in a row', () => {
    render(
      <BatchResolveConflictsModal
        isOpen
        rows={buildRows()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    // s2/description: llm-gap-fill (index 0) vs framework (index 1) -> framework wins.
    const s2Key = rowKey({ candidateId: 's2', attr: 'description' });
    const tag = screen.getByTestId(`batch-resolve-authoritative-tag-${s2Key}`);
    // The tag lives inside the framework option (index 1), not the llm one.
    const optIndex1 = screen.getByTestId(`batch-resolve-option-${s2Key}-1`);
    const optIndex0 = screen.getByTestId(`batch-resolve-option-${s2Key}-0`);
    expect(optIndex1).toContainElement(tag);
    expect(optIndex0).not.toContainElement(tag);
    expect(tag).toHaveTextContent('most authoritative');
  });
});

describe('BatchResolveConflictsModal -- Resolve-All helpers', () => {
  it('"Use most authoritative source" pre-selects the highest-authority option per row', () => {
    render(
      <BatchResolveConflictsModal
        isOpen
        rows={buildRows()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('batch-resolve-use-most-authoritative'));

    // Each row's framework option becomes aria-pressed.
    const s2Key = rowKey({ candidateId: 's2', attr: 'description' });
    const s1Key = rowKey({ candidateId: 's1', attr: 'name' });
    const e1Key = rowKey({ candidateId: 'e1', attr: 'label' });
    expect(screen.getByTestId(`batch-resolve-option-${s2Key}-1`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId(`batch-resolve-option-${s1Key}-1`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId(`batch-resolve-option-${e1Key}-0`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('"Prefer a source..." pre-selects only rows where the source is present and lists only present sources', () => {
    const captured: BatchRowSelections[] = [];
    render(
      <BatchResolveConflictsModal
        isOpen
        rows={buildRows()}
        onClose={vi.fn()}
        onConfirm={(s) => captured.push(s)}
      />,
    );

    const select = screen.getByTestId('batch-resolve-prefer-source-select');
    // Dropdown lists ONLY sources present (no 'contract-pack' label, etc.).
    const optionValues = within(select)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== '');
    expect(new Set(optionValues)).toEqual(
      new Set(['spring-classic-jaxrs', 'runtime-evidence', 'llm-gap-fill']),
    );

    // Prefer runtime-evidence: present on s1 (index 0) and e1 (index 1), absent
    // on s2 (which has llm + framework only) -> s2 stays unselected.
    fireEvent.change(select, { target: { value: 'runtime-evidence' } });

    const s1Key = rowKey({ candidateId: 's1', attr: 'name' });
    const e1Key = rowKey({ candidateId: 'e1', attr: 'label' });
    const s2Key = rowKey({ candidateId: 's2', attr: 'description' });
    expect(screen.getByTestId(`batch-resolve-option-${s1Key}-0`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId(`batch-resolve-option-${e1Key}-1`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Neither option on s2 is pressed.
    expect(screen.getByTestId(`batch-resolve-option-${s2Key}-0`)).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByTestId(`batch-resolve-option-${s2Key}-1`)).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Confirm forwards the merged selections (s1 + e1 only).
    fireEvent.click(screen.getByTestId('batch-resolve-confirm'));
    expect(captured).toHaveLength(1);
    expect(captured[0][s1Key]).toBe(0);
    expect(captured[0][e1Key]).toBe(1);
    expect(s2Key in captured[0]).toBe(false);
  });
});

describe('BatchResolveConflictsModal -- empty state + confirm gating', () => {
  it('shows "No unresolved conflicts." with only a Close button when there are no rows', () => {
    render(
      <BatchResolveConflictsModal
        isOpen
        rows={[]}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByTestId('batch-resolve-empty-state')).toHaveTextContent(
      'No unresolved conflicts.',
    );
    // No Confirm button in the empty state -- only Close.
    expect(screen.queryByTestId('batch-resolve-confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('batch-resolve-close')).toBeInTheDocument();
  });

  it('disables Confirm until at least one row is selected', () => {
    render(
      <BatchResolveConflictsModal
        isOpen
        rows={buildRows()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const confirm = screen.getByTestId('batch-resolve-confirm');
    expect(confirm).toBeDisabled();

    const s1Key = rowKey({ candidateId: 's1', attr: 'name' });
    fireEvent.click(screen.getByTestId(`batch-resolve-option-${s1Key}-0`));
    expect(confirm).toBeEnabled();
  });
});

describe('BatchResolveConflictsModal -- result banner, retry, auto-close (TG3.4)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('relabels Confirm to "Retry failed (N)" and keeps ONLY the failed rows selected on partial failure', () => {
    const s1Key = rowKey({ candidateId: 's1', attr: 'name' });
    const s2Key = rowKey({ candidateId: 's2', attr: 'description' });

    const { rerender } = render(
      <BatchResolveConflictsModal
        isOpen
        rows={buildRows()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        result={null}
      />,
    );

    // Select two rows, then a partial-failure result arrives (s2 failed).
    fireEvent.click(screen.getByTestId(`batch-resolve-option-${s1Key}-0`));
    fireEvent.click(screen.getByTestId(`batch-resolve-option-${s2Key}-1`));

    rerender(
      <BatchResolveConflictsModal
        isOpen
        rows={buildRows()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        result={{
          resolved: [{ candidateId: 's1', attr: 'name' }],
          failed: [{ candidateId: 's2', attr: 'description' }],
        }}
      />,
    );

    // Banner pinned at the top of the content reports the partial outcome.
    const banner = screen.getByTestId('batch-resolve-result-banner');
    expect(banner).toHaveTextContent('1 resolved');
    expect(banner).toHaveTextContent('1 failed');

    // Confirm relabels to "Retry failed (1)".
    const confirm = screen.getByTestId('batch-resolve-confirm');
    expect(confirm).toHaveTextContent('Retry failed (1)');

    // Selection pruned to ONLY the failed row: s2 still pressed, s1 dropped.
    expect(screen.getByTestId(`batch-resolve-option-${s2Key}-1`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId(`batch-resolve-option-${s1Key}-0`)).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('re-fires ONLY the failed selections when Retry is clicked', () => {
    const captured: Record<string, number | undefined>[] = [];
    const s1Key = rowKey({ candidateId: 's1', attr: 'name' });
    const s2Key = rowKey({ candidateId: 's2', attr: 'description' });

    const { rerender } = render(
      <BatchResolveConflictsModal
        isOpen
        rows={buildRows()}
        onClose={vi.fn()}
        onConfirm={(s) => captured.push(s)}
        result={null}
      />,
    );
    fireEvent.click(screen.getByTestId(`batch-resolve-option-${s1Key}-0`));
    fireEvent.click(screen.getByTestId(`batch-resolve-option-${s2Key}-1`));

    rerender(
      <BatchResolveConflictsModal
        isOpen
        rows={buildRows()}
        onClose={vi.fn()}
        onConfirm={(s) => captured.push(s)}
        result={{
          resolved: [{ candidateId: 's1', attr: 'name' }],
          failed: [{ candidateId: 's2', attr: 'description' }],
        }}
      />,
    );

    fireEvent.click(screen.getByTestId('batch-resolve-confirm'));
    const lastCall = captured[captured.length - 1];
    expect(lastCall[s2Key]).toBe(1);
    expect(s1Key in lastCall).toBe(false);
  });

  it('auto-closes after an all-success result', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    const { rerender } = render(
      <BatchResolveConflictsModal
        isOpen
        rows={buildRows()}
        onClose={onClose}
        onConfirm={vi.fn()}
        result={null}
      />,
    );

    rerender(
      <BatchResolveConflictsModal
        isOpen
        rows={buildRows()}
        onClose={onClose}
        onConfirm={vi.fn()}
        result={{
          resolved: [
            { candidateId: 's1', attr: 'name' },
            { candidateId: 's2', attr: 'description' },
          ],
          failed: [],
        }}
      />,
    );

    // Success banner shows and no failure copy is present.
    const banner = screen.getByTestId('batch-resolve-result-banner');
    expect(banner).toHaveTextContent('2 resolved');
    expect(banner).not.toHaveTextContent('failed');
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});


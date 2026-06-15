/**
 * SelectiveCopyConflictResolution Tests
 *
 * Spec 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy
 * (Spec #7) -- Task Group 8
 * Task 8.1: 4-8 focused tests for the new conflict resolution component.
 *
 * Coverage matrix (mirrors the test scope in tasks.md 8.1):
 *   1. Renders summary stats (total selected / conflicts / auto-included /
 *      will copy) directly from the `summary` prop.
 *   2. Renders the auto-included list (when non-empty) with each row's
 *      element name and `includedBecause` parent.
 *   3. Renders conflict rows with element name + element type.
 *   4. Bulk `Skip all` button updates every conflict's resolution to `skip`
 *      in the emitted map.
 *   5. Bulk `Overwrite all` and `Duplicate all` work the same way (combined
 *      into a single test for brevity).
 *   6. Per-row radio change updates only that element's resolution; other
 *      rows remain untouched.
 *   7. Soft "many conflicts" banner appears above 10 conflicts (safety
 *      property (i)) and is dismissible without blocking the commit (safety
 *      property (j)).
 *   8. No banner when conflict count is at or below the threshold.
 *
 * Test strategy:
 *   - Vitest with `vi.mock()` per project memory. The component is a pure
 *     presentation component so NO API mocks are required.
 *   - The `resolutions` map is owned by the parent (the wizard); these
 *     tests pass it in as a prop and assert the emitted callback payload
 *     reflects the user's interaction.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { SelectiveCopyConflictResolution } from './SelectiveCopyConflictResolution';
import type {
  SelectiveCopyAutoIncluded,
  SelectiveCopyConflict,
  SelectiveCopyPreflightSummary,
} from '../../api/architecturesApi';

// ============================================================================
// Fixtures
// ============================================================================

function buildConflicts(count: number): SelectiveCopyConflict[] {
  const out: SelectiveCopyConflict[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      elementId: `elt-${i}`,
      elementType: i % 2 === 0 ? 'application' : 'data_entity',
      name: `Element ${i}`,
      conflictReason: 'same_uuid',
    });
  }
  return out;
}

function buildSummary(overrides: Partial<SelectiveCopyPreflightSummary> = {}): SelectiveCopyPreflightSummary {
  return {
    totalSelected: 5,
    conflictCount: 3,
    autoIncludedCount: 1,
    willCopyCount: 6,
    ...overrides,
  };
}

interface RenderOpts {
  conflicts?: SelectiveCopyConflict[];
  autoIncluded?: SelectiveCopyAutoIncluded[];
  summary?: SelectiveCopyPreflightSummary;
  resolutions?: Record<string, 'skip' | 'overwrite' | 'duplicate'>;
}

function renderResolution(opts: RenderOpts = {}) {
  const conflicts = opts.conflicts ?? buildConflicts(3);
  // Default-Skip seed: the wizard initialises resolutions with `skip` for
  // every conflict on first transition (safety property (i)). Mirror that
  // here so the tests reflect the realistic in-app state.
  const seededResolutions: Record<string, 'skip' | 'overwrite' | 'duplicate'> = {};
  for (const c of conflicts) seededResolutions[c.elementId] = 'skip';

  const onResolutionsChange: Mock = vi.fn();
  const utils = render(
    <SelectiveCopyConflictResolution
      conflicts={conflicts}
      autoIncluded={opts.autoIncluded ?? []}
      summary={opts.summary ?? buildSummary()}
      resolutions={opts.resolutions ?? seededResolutions}
      onResolutionsChange={onResolutionsChange}
    />,
  );
  return { ...utils, onResolutionsChange, conflicts };
}

// ============================================================================
// Tests
// ============================================================================

describe('SelectiveCopyConflictResolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the summary stats from the summary prop', () => {
    renderResolution({
      summary: {
        totalSelected: 12,
        conflictCount: 4,
        autoIncludedCount: 2,
        willCopyCount: 10,
      },
      conflicts: buildConflicts(4),
    });

    const total = screen.getByTestId('selective-copy-summary-total');
    expect(total).toHaveTextContent('Total selected:');
    expect(total).toHaveTextContent('12');

    const conflicts = screen.getByTestId('selective-copy-summary-conflicts');
    expect(conflicts).toHaveTextContent('Conflicts:');
    expect(conflicts).toHaveTextContent('4');

    const auto = screen.getByTestId('selective-copy-summary-auto-included');
    expect(auto).toHaveTextContent('Auto-included:');
    expect(auto).toHaveTextContent('2');

    const willCopy = screen.getByTestId('selective-copy-summary-will-copy');
    expect(willCopy).toHaveTextContent('Will copy:');
    expect(willCopy).toHaveTextContent('10');
  });

  it('renders the auto-included list with element name + includedBecause when non-empty', () => {
    const autoIncluded: SelectiveCopyAutoIncluded[] = [
      {
        elementId: 'data-1',
        elementType: 'data_entity',
        name: 'Customer',
        includedBecause: 'Order Fulfillment',
      },
      {
        elementId: 'data-2',
        elementType: 'data_entity',
        name: 'Invoice',
        includedBecause: 'Billing Process',
      },
    ];

    renderResolution({ autoIncluded });

    expect(screen.getByTestId('selective-copy-auto-included-section')).toBeInTheDocument();

    const row1 = screen.getByTestId('selective-copy-auto-included-row-data-1');
    expect(row1).toHaveTextContent('Customer');
    expect(row1).toHaveTextContent('Order Fulfillment');

    const row2 = screen.getByTestId('selective-copy-auto-included-row-data-2');
    expect(row2).toHaveTextContent('Invoice');
    expect(row2).toHaveTextContent('Billing Process');
  });

  it('renders one conflict row per conflict with element name and type', () => {
    const conflicts: SelectiveCopyConflict[] = [
      {
        elementId: 'app-1',
        elementType: 'application',
        name: 'Order Service',
        conflictReason: 'same_uuid',
      },
      {
        elementId: 'app-2',
        elementType: 'application',
        name: 'Payment Service',
        conflictReason: 'same_uuid',
      },
    ];
    renderResolution({ conflicts });

    expect(screen.getByTestId('selective-copy-conflict-name-app-1')).toHaveTextContent(
      'Order Service',
    );
    expect(screen.getByTestId('selective-copy-conflict-type-app-1')).toHaveTextContent(
      'application',
    );
    expect(screen.getByTestId('selective-copy-conflict-name-app-2')).toHaveTextContent(
      'Payment Service',
    );
  });

  it('clicking "Skip all" emits a resolution map with every conflict set to skip', () => {
    // Seed with mixed actions so the bulk action is observable.
    const conflicts = buildConflicts(3);
    const resolutions: Record<string, 'skip' | 'overwrite' | 'duplicate'> = {
      'elt-0': 'overwrite',
      'elt-1': 'duplicate',
      'elt-2': 'overwrite',
    };
    const { onResolutionsChange } = renderResolution({ conflicts, resolutions });

    fireEvent.click(screen.getByTestId('selective-copy-bulk-skip'));

    expect(onResolutionsChange).toHaveBeenCalledTimes(1);
    const emitted = onResolutionsChange.mock.calls[0][0] as Record<string, string>;
    expect(emitted['elt-0']).toBe('skip');
    expect(emitted['elt-1']).toBe('skip');
    expect(emitted['elt-2']).toBe('skip');
  });

  it('clicking "Overwrite all" and "Duplicate all" sets every conflict to that action', () => {
    const conflicts = buildConflicts(3);
    const { onResolutionsChange } = renderResolution({ conflicts });

    fireEvent.click(screen.getByTestId('selective-copy-bulk-overwrite'));
    let emitted = onResolutionsChange.mock.calls[0][0] as Record<string, string>;
    expect(emitted['elt-0']).toBe('overwrite');
    expect(emitted['elt-1']).toBe('overwrite');
    expect(emitted['elt-2']).toBe('overwrite');

    onResolutionsChange.mockClear();
    fireEvent.click(screen.getByTestId('selective-copy-bulk-duplicate'));
    emitted = onResolutionsChange.mock.calls[0][0] as Record<string, string>;
    expect(emitted['elt-0']).toBe('duplicate');
    expect(emitted['elt-1']).toBe('duplicate');
    expect(emitted['elt-2']).toBe('duplicate');
  });

  it('per-row radio change updates only that elements resolution', () => {
    const conflicts = buildConflicts(3);
    // All three start at `skip` (default).
    const resolutions: Record<string, 'skip' | 'overwrite' | 'duplicate'> = {
      'elt-0': 'skip',
      'elt-1': 'skip',
      'elt-2': 'skip',
    };
    const { onResolutionsChange } = renderResolution({ conflicts, resolutions });

    // Switch row 1 to overwrite.
    const radio = screen.getByTestId('selective-copy-conflict-radio-elt-1-overwrite');
    fireEvent.click(radio);

    expect(onResolutionsChange).toHaveBeenCalledTimes(1);
    const emitted = onResolutionsChange.mock.calls[0][0] as Record<string, string>;
    expect(emitted['elt-1']).toBe('overwrite');
    // Other rows untouched.
    expect(emitted['elt-0']).toBe('skip');
    expect(emitted['elt-2']).toBe('skip');
  });

  it('renders the many-conflicts soft banner when conflictCount > 10 and is dismissible', () => {
    const conflicts = buildConflicts(11);
    renderResolution({
      conflicts,
      summary: buildSummary({ conflictCount: 11, totalSelected: 11, willCopyCount: 11 }),
    });

    const banner = screen.getByTestId('selective-copy-many-conflicts-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('Many conflicts detected (11)');
    expect(banner).toHaveTextContent('Consider cancelling and refining your selection');

    // Dismissable -- clicking removes the banner from the DOM.
    fireEvent.click(screen.getByTestId('selective-copy-many-conflicts-banner-dismiss'));
    expect(
      screen.queryByTestId('selective-copy-many-conflicts-banner'),
    ).not.toBeInTheDocument();

    // Bulk action buttons remain enabled (no hard block).
    expect(screen.getByTestId('selective-copy-bulk-skip')).not.toBeDisabled();
    expect(screen.getByTestId('selective-copy-bulk-overwrite')).not.toBeDisabled();
    expect(screen.getByTestId('selective-copy-bulk-duplicate')).not.toBeDisabled();
  });

  it('does NOT render the soft banner when conflictCount <= 10', () => {
    const conflicts = buildConflicts(10);
    renderResolution({
      conflicts,
      summary: buildSummary({ conflictCount: 10, totalSelected: 10, willCopyCount: 10 }),
    });

    expect(
      screen.queryByTestId('selective-copy-many-conflicts-banner'),
    ).not.toBeInTheDocument();
  });
});

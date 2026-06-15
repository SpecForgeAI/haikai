/**
 * Manual-edit overwrite modal tests
 *
 * Spec: 2026-05-20 In-Product Spec Editor + Confirm-Overwrite -- Task Group 9.1.
 *
 * Covers both modals introduced by Group 9:
 *
 *   - SingleStoryManualEditOverwriteModal
 *       - Renders the editor info + Cancel/Continue affordances.
 *       - Cancel and Continue call the right handlers.
 *
 *   - BulkManualEditOverwriteModal
 *       - Per-row checkboxes default UNCHECKED (skip).
 *       - Header "Overwrite all" radio flips every checkbox.
 *       - Confirm submits the allow-list (empty when everything skipped).
 *       - Confirm with one row checked submits only that row.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import SingleStoryManualEditOverwriteModal from '../SingleStoryManualEditOverwriteModal';
import BulkManualEditOverwriteModal from '../BulkManualEditOverwriteModal';
import type { ManuallyEditedScopeRow } from '../../../../api/specGenerationApi';

beforeEach(() => {
  vi.resetAllMocks();
});

// ============================================================================
// SingleStoryManualEditOverwriteModal
// ============================================================================

describe('SingleStoryManualEditOverwriteModal (Group 9)', () => {
  it('renders editor info and Cancel/Continue buttons', () => {
    render(
      <SingleStoryManualEditOverwriteModal
        lastManuallyEditedBy="user-bob"
        lastManuallyEditedAt="2026-05-20T10:00:00Z"
        onCancel={vi.fn()}
        onContinue={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId('manual-edit-overwrite-confirm-modal-body'),
    ).toHaveTextContent(/user-bob/);
    expect(
      screen.getByTestId('manual-edit-overwrite-confirm-modal-cancel'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('manual-edit-overwrite-confirm-modal-continue'),
    ).toBeInTheDocument();
  });

  it('Continue fires onContinue, Cancel fires onCancel', () => {
    const onCancel = vi.fn();
    const onContinue = vi.fn();
    render(
      <SingleStoryManualEditOverwriteModal
        lastManuallyEditedBy="user-bob"
        lastManuallyEditedAt="2026-05-20T10:00:00Z"
        onCancel={onCancel}
        onContinue={onContinue}
      />,
    );

    fireEvent.click(
      screen.getByTestId('manual-edit-overwrite-confirm-modal-continue'),
    );
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByTestId('manual-edit-overwrite-confirm-modal-cancel'),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// BulkManualEditOverwriteModal
// ============================================================================

function makeBulkRows(): ManuallyEditedScopeRow[] {
  return [
    {
      workItemId: 'wi-1',
      workItemTitle: 'Story 1',
      specGenerationId: 'spec-1',
      lastManuallyEditedAt: '2026-05-20T10:00:00Z',
      lastManuallyEditedBy: 'user-alice',
    },
    {
      workItemId: 'wi-2',
      workItemTitle: 'Story 2',
      specGenerationId: 'spec-2',
      lastManuallyEditedAt: '2026-05-20T11:00:00Z',
      lastManuallyEditedBy: 'user-bob',
    },
  ];
}

describe('BulkManualEditOverwriteModal (Group 9)', () => {
  it('renders one row per pre-flight entry with UNCHECKED checkboxes by default', () => {
    render(
      <BulkManualEditOverwriteModal
        rows={makeBulkRows()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const cb1 = screen.getByTestId(
      'manual-edit-overwrite-bulk-modal-row-wi-1-checkbox',
    ) as HTMLInputElement;
    const cb2 = screen.getByTestId(
      'manual-edit-overwrite-bulk-modal-row-wi-2-checkbox',
    ) as HTMLInputElement;
    expect(cb1.checked).toBe(false);
    expect(cb2.checked).toBe(false);
  });

  it('the "Overwrite all" header toggle checks every row', () => {
    render(
      <BulkManualEditOverwriteModal
        rows={makeBulkRows()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByTestId('manual-edit-overwrite-bulk-modal-toggle-overwrite-all'),
    );

    const cb1 = screen.getByTestId(
      'manual-edit-overwrite-bulk-modal-row-wi-1-checkbox',
    ) as HTMLInputElement;
    const cb2 = screen.getByTestId(
      'manual-edit-overwrite-bulk-modal-row-wi-2-checkbox',
    ) as HTMLInputElement;
    expect(cb1.checked).toBe(true);
    expect(cb2.checked).toBe(true);
  });

  it('Confirm submits the per-row allow-list (only checked rows)', () => {
    const onConfirm = vi.fn();
    render(
      <BulkManualEditOverwriteModal
        rows={makeBulkRows()}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(
      screen.getByTestId(
        'manual-edit-overwrite-bulk-modal-row-wi-2-checkbox',
      ),
    );
    fireEvent.click(
      screen.getByTestId('manual-edit-overwrite-bulk-modal-confirm'),
    );

    expect(onConfirm).toHaveBeenCalledWith({
      manuallyEditedWorkItemIdsToOverwrite: ['wi-2'],
    });
  });

  it('Confirm submits an empty allow-list when nothing is checked (skip-all default)', () => {
    const onConfirm = vi.fn();
    render(
      <BulkManualEditOverwriteModal
        rows={makeBulkRows()}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(
      screen.getByTestId('manual-edit-overwrite-bulk-modal-confirm'),
    );

    expect(onConfirm).toHaveBeenCalledWith({
      manuallyEditedWorkItemIdsToOverwrite: [],
    });
  });
});

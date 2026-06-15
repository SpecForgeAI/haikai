/**
 * SaveTargetArchitecturePickerModal Tests
 *
 * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 8
 *
 * Coverage (kept to <=8 focused tests, per task spec 8.1):
 *   1. Renders all NON-archived architectures from useArchitectureContext()
 *      in oldest-first order (the backend list contract is preserved by the
 *      filter); archived ones are excluded.
 *   2. Pre-selected with `defaultArchitectureId` when that id exists in the
 *      non-archived list. Confirm button label reflects the pre-selected
 *      architecture name.
 *   3. Selecting a different architecture and clicking Save calls
 *      `onConfirm` with the NEW id (not the original default).
 *   4. Confirm flow: while in flight the primary button reads "Saving..."
 *      and is disabled; on success the modal closes (onClose called).
 *   5. On onConfirm error the inline error renders, the modal stays open,
 *      and onClose is NOT called -- the user can retry / cancel.
 *
 * Mocking strategy:
 *   - vi.mock the `ArchitectureContext` module so `useArchitectureContext()`
 *     returns a controlled `architectures` array per test (no Provider
 *     needed). Mirrors the pattern in the DashboardView tests.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock useArchitectureContext. Tests can mutate the array between renders by
// reassigning the entries; the hook re-reads the variable each time it runs.
// ---------------------------------------------------------------------------

const archivedSnapshot = {
  id: 'arch-archived',
  projectId: 'proj-1',
  name: 'Archived Snapshot',
  description: null,
  tags: [] as string[],
  archived: true,
  createdAt: '2025-12-01T00:00:00Z',
  updatedAt: '2025-12-01T00:00:00Z',
};
const oldest = {
  id: 'arch-current',
  projectId: 'proj-1',
  name: 'Current State',
  description: null,
  tags: [] as string[],
  archived: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const middle = {
  id: 'arch-target',
  projectId: 'proj-1',
  name: 'Target State',
  description: null,
  tags: [] as string[],
  archived: false,
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
};
const newest = {
  id: 'arch-experimental',
  projectId: 'proj-1',
  name: 'Experimental',
  description: null,
  tags: [] as string[],
  archived: false,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
};

// Backend contract: oldest-first. Tests rely on this order.
let mockArchitectures = [oldest, middle, newest, archivedSnapshot];

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureContext: () => ({ architectures: mockArchitectures }),
}));

// Imports AFTER the mock so the mocked module is wired in.
import { SaveTargetArchitecturePickerModal } from './SaveTargetArchitecturePickerModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderModal(
  overrides: Partial<React.ComponentProps<typeof SaveTargetArchitecturePickerModal>> = {}
) {
  const defaults: React.ComponentProps<typeof SaveTargetArchitecturePickerModal> = {
    open: true,
    onClose: vi.fn(),
    onConfirm: vi.fn().mockResolvedValue(undefined),
    defaultArchitectureId: 'arch-target',
    taskName: 'ux-designer--ui-domain',
  };
  const props = { ...defaults, ...overrides };
  return { props, ...render(<SaveTargetArchitecturePickerModal {...props} />) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SaveTargetArchitecturePickerModal (Task 8.1)', () => {
  beforeEach(() => {
    // Reset to the canonical fixture in case a test mutated it.
    mockArchitectures = [oldest, middle, newest, archivedSnapshot];
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Test 1: renders all non-archived architectures, oldest first; archived
  // ones are excluded from the picker.
  // --------------------------------------------------------------------------
  it('renders all non-archived architectures in oldest-first order; excludes archived', () => {
    renderModal();

    const select = screen.getByTestId('save-target-arch-picker-select') as HTMLSelectElement;
    const options = within(select).getAllByRole('option') as HTMLOptionElement[];

    // Three non-archived options, in oldest-first order.
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveValue('arch-current');
    expect(options[0]).toHaveTextContent('Current State');
    expect(options[1]).toHaveValue('arch-target');
    expect(options[1]).toHaveTextContent('Target State');
    expect(options[2]).toHaveValue('arch-experimental');
    expect(options[2]).toHaveTextContent('Experimental');

    // Archived snapshot is NOT rendered as an option.
    expect(within(select).queryByText('Archived Snapshot')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 2: pre-selected with defaultArchitectureId; confirm label reflects
  // the pre-selected architecture name.
  // --------------------------------------------------------------------------
  it('pre-selects the defaultArchitectureId; confirm button label embeds the selected arch name', () => {
    renderModal({ defaultArchitectureId: 'arch-target' });

    const select = screen.getByTestId('save-target-arch-picker-select') as HTMLSelectElement;
    expect(select.value).toBe('arch-target');

    // Confirm label embeds the resolved name (Target State, not the id).
    expect(screen.getByTestId('save-target-arch-picker-confirm')).toHaveTextContent(
      'Save to Target State'
    );

    // Header copy and explanation copy use the spec-mandated wording.
    expect(screen.getByText('Save target architecture')).toBeInTheDocument();
    expect(screen.getByTestId('save-target-arch-picker-message')).toHaveTextContent(
      'Choose the architecture to save this ux-designer--ui-domain output to.'
    );
  });

  // --------------------------------------------------------------------------
  // Test 3: changing the select and clicking Save invokes onConfirm with the
  // NEW id (not the pre-filled default).
  // --------------------------------------------------------------------------
  it('selecting a different architecture and confirming calls onConfirm with the new id', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderModal({
      defaultArchitectureId: 'arch-target',
      onConfirm,
      onClose,
    });

    const select = screen.getByTestId('save-target-arch-picker-select');
    fireEvent.change(select, { target: { value: 'arch-experimental' } });

    // Confirm label updates to reflect the new selection.
    expect(screen.getByTestId('save-target-arch-picker-confirm')).toHaveTextContent(
      'Save to Experimental'
    );

    fireEvent.click(screen.getByTestId('save-target-arch-picker-confirm'));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    expect(onConfirm).toHaveBeenCalledWith('arch-experimental');

    // After successful save the parent should be told to close.
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // Test 4: in-flight state -- primary button reads "Saving..." and is
  // disabled while the onConfirm promise is pending; cancel + X are also
  // disabled.
  // --------------------------------------------------------------------------
  it('shows in-flight state while onConfirm is pending; resolved success closes the modal', async () => {
    let resolveConfirm: () => void = () => undefined;
    const onConfirm = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        })
    );
    const onClose = vi.fn();
    renderModal({ onConfirm, onClose });

    fireEvent.click(screen.getByTestId('save-target-arch-picker-confirm'));

    // While in flight: button label flips to "Saving..." and primary +
    // secondary + close-X are all disabled.
    await waitFor(() => {
      expect(screen.getByTestId('save-target-arch-picker-confirm')).toHaveTextContent(
        'Saving...'
      );
    });
    expect(screen.getByTestId('save-target-arch-picker-confirm')).toBeDisabled();
    expect(screen.getByTestId('save-target-arch-picker-cancel')).toBeDisabled();
    expect(screen.getByTestId('save-target-arch-picker-close-x')).toBeDisabled();

    // onClose has NOT been called yet -- the promise is still pending.
    expect(onClose).not.toHaveBeenCalled();

    // Resolve the promise -- the modal should call onClose now.
    resolveConfirm();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // Test 5: onConfirm error path -- inline error renders, modal stays open,
  // onClose NOT called.
  // --------------------------------------------------------------------------
  it('on onConfirm error: surfaces the error inline and keeps the modal open', async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValue(new Error('Boom: gateway refused architecture binding'));
    const onClose = vi.fn();
    renderModal({ onConfirm, onClose });

    fireEvent.click(screen.getByTestId('save-target-arch-picker-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('save-target-arch-picker-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('save-target-arch-picker-error')).toHaveTextContent(
      'Boom: gateway refused architecture binding'
    );

    // Modal still mounted; parent NOT told to close.
    expect(screen.getByTestId('save-target-arch-picker-modal')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Submit button is re-enabled so the user can retry.
    expect(screen.getByTestId('save-target-arch-picker-confirm')).not.toBeDisabled();
  });
});

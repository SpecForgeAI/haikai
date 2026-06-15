/**
 * SaveBackConfirmModal Tests
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 8
 *
 * Coverage:
 *   1. Renders nothing when `open === false`; renders shell + body when set.
 *      Body copy includes the candidate count + architecture name. Confirm
 *      button label uses the architecture name.
 *   2. Relationships clause is omitted when relationshipCount is undefined
 *      OR 0; included when > 0.
 *   3. Architecture-archived warning paragraph renders only when
 *      `architectureArchived === true`.
 *   4. Cancel and X close (and Esc) DO NOT call onConfirm; only the Confirm
 *      button calls onConfirm. This is the in-modal half of safety
 *      property (e) -- the writes (the parent's onConfirm) are gated
 *      strictly behind the confirm button.
 *   5. Confirm flow: onConfirm awaited, then onClose. If onConfirm throws,
 *      modal stays open and the inline error renders; onClose is NOT
 *      called.
 *
 * Test strategy:
 *   - Vitest with no module-level mocks needed -- the modal is purely
 *     presentational (props in, callbacks out). The architecture name is
 *     resolved by the parent in DiscoveryRunDetailView.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

import { SaveBackConfirmModal } from './SaveBackConfirmModal';

// ============================================================================
// Helpers
// ============================================================================

function renderModal(overrides: Partial<React.ComponentProps<typeof SaveBackConfirmModal>> = {}) {
  const defaults: React.ComponentProps<typeof SaveBackConfirmModal> = {
    open: true,
    onClose: vi.fn(),
    onConfirm: vi.fn().mockResolvedValue(undefined),
    candidateCount: 5,
    architectureName: 'Target State',
  };
  const props = { ...defaults, ...overrides };
  return { props, ...render(<SaveBackConfirmModal {...props} />) };
}

// ============================================================================
// Tests
// ============================================================================

describe('SaveBackConfirmModal (Task 8.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Test 1: hidden when open === false; visible when true; correct copy.
  // --------------------------------------------------------------------------
  it('renders nothing when open is false; renders shell with counts + arch name when open', () => {
    // open === false: nothing on screen.
    const { rerender } = render(
      <SaveBackConfirmModal
        open={false}
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        candidateCount={5}
        architectureName="Target State"
      />
    );
    expect(screen.queryByTestId('save-back-confirm-modal')).not.toBeInTheDocument();

    // Flip to open: the shell, header, and body all render.
    rerender(
      <SaveBackConfirmModal
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        candidateCount={23}
        architectureName="Target State"
      />
    );
    expect(screen.getByTestId('save-back-confirm-modal')).toBeInTheDocument();
    // Spec header copy.
    expect(screen.getByText('Save to canonical model?')).toBeInTheDocument();
    // Body copy includes the count + arch name.
    const message = screen.getByTestId('save-back-confirm-message');
    expect(message).toHaveTextContent('Save 23 candidates');
    expect(message).toHaveTextContent("architecture 'Target State'");
    // Confirm button label embeds the architecture name.
    expect(screen.getByTestId('save-back-confirm-confirm')).toHaveTextContent(
      'Save to Target State'
    );
  });

  // --------------------------------------------------------------------------
  // Test 2: relationships clause omitted when undefined / 0; included > 0.
  // --------------------------------------------------------------------------
  it('omits the relationships clause when count is undefined or 0; includes it when > 0', () => {
    // 2a. Undefined relationshipCount -- no "and N relationships" in copy.
    const { rerender } = renderModal({
      candidateCount: 5,
      relationshipCount: undefined,
      architectureName: 'Default',
    });
    let message = screen.getByTestId('save-back-confirm-message');
    expect(message).not.toHaveTextContent(/relationships/i);
    expect(message).toHaveTextContent('Save 5 candidates');

    // 2b. relationshipCount === 0 -- still omitted.
    rerender(
      <SaveBackConfirmModal
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        candidateCount={5}
        relationshipCount={0}
        architectureName="Default"
      />
    );
    message = screen.getByTestId('save-back-confirm-message');
    expect(message).not.toHaveTextContent(/relationships/i);

    // 2c. relationshipCount === 11 -- the clause appears with the count.
    rerender(
      <SaveBackConfirmModal
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        candidateCount={23}
        relationshipCount={11}
        architectureName="Default"
      />
    );
    message = screen.getByTestId('save-back-confirm-message');
    expect(message).toHaveTextContent('Save 23 candidates and 11 relationships');
    expect(message).toHaveTextContent("architecture 'Default'");
  });

  // --------------------------------------------------------------------------
  // Test 3: archived warning renders only when architectureArchived === true.
  // --------------------------------------------------------------------------
  it('renders the archived warning only when architectureArchived is true', () => {
    // 3a. Default (not archived) -- no warning.
    const { rerender } = renderModal({ architectureArchived: false });
    expect(
      screen.queryByTestId('save-back-confirm-archived-warning')
    ).not.toBeInTheDocument();

    // 3b. architectureArchived true -- warning visible with the spec wording.
    rerender(
      <SaveBackConfirmModal
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        candidateCount={3}
        architectureName="Old Snapshot"
        architectureArchived={true}
      />
    );
    const warning = screen.getByTestId('save-back-confirm-archived-warning');
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveTextContent('this architecture is archived');
    expect(warning).toHaveTextContent('save-back will still apply');
  });

  // --------------------------------------------------------------------------
  // Test 4: Confirm button calls onConfirm; Cancel + X do NOT.
  //
  // This is the in-modal half of safety property (e): the writes (parent's
  // onConfirm callback) only fire when the user explicitly clicks Confirm.
  // --------------------------------------------------------------------------
  it('calls onConfirm only when the Confirm button is clicked; Cancel and X do not fire onConfirm', async () => {
    // 4a. Clicking Cancel -- onConfirm NOT called; onClose IS called.
    const onConfirmCancel = vi.fn().mockResolvedValue(undefined);
    const onCloseCancel = vi.fn();
    render(
      <SaveBackConfirmModal
        open={true}
        onClose={onCloseCancel}
        onConfirm={onConfirmCancel}
        candidateCount={5}
        architectureName="Target State"
      />
    );

    fireEvent.click(screen.getByTestId('save-back-confirm-cancel'));
    expect(onConfirmCancel).not.toHaveBeenCalled();
    expect(onCloseCancel).toHaveBeenCalledTimes(1);

    cleanup();

    // 4b. Clicking the X close button -- same: onConfirm NOT called.
    const onConfirmX = vi.fn().mockResolvedValue(undefined);
    const onCloseX = vi.fn();
    render(
      <SaveBackConfirmModal
        open={true}
        onClose={onCloseX}
        onConfirm={onConfirmX}
        candidateCount={5}
        architectureName="Target State"
      />
    );

    fireEvent.click(screen.getByTestId('save-back-confirm-close-x'));
    expect(onConfirmX).not.toHaveBeenCalled();
    expect(onCloseX).toHaveBeenCalledTimes(1);

    cleanup();

    // 4c. Clicking Confirm -- onConfirm IS called, then onClose.
    const onConfirmGo = vi.fn().mockResolvedValue(undefined);
    const onCloseGo = vi.fn();
    render(
      <SaveBackConfirmModal
        open={true}
        onClose={onCloseGo}
        onConfirm={onConfirmGo}
        candidateCount={5}
        architectureName="Target State"
      />
    );

    fireEvent.click(screen.getByTestId('save-back-confirm-confirm'));
    await waitFor(() => {
      expect(onConfirmGo).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(onCloseGo).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // Test 5: Confirm error path -- inline error rendered, modal stays open,
  // onClose NOT called. The user can retry or cancel.
  // --------------------------------------------------------------------------
  it('on onConfirm error: renders inline error, keeps modal open, does not call onClose', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('Boom: backend rejected save'));
    const onClose = vi.fn();
    render(
      <SaveBackConfirmModal
        open={true}
        onClose={onClose}
        onConfirm={onConfirm}
        candidateCount={5}
        architectureName="Target State"
      />
    );

    fireEvent.click(screen.getByTestId('save-back-confirm-confirm'));

    // Wait for the error to render.
    await waitFor(() => {
      expect(screen.getByTestId('save-back-confirm-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('save-back-confirm-error')).toHaveTextContent(
      'Boom: backend rejected save'
    );
    // Modal still on screen.
    expect(screen.getByTestId('save-back-confirm-modal')).toBeInTheDocument();
    // onClose NOT called -- parent must keep open state until the user
    // explicitly cancels or retries successfully.
    expect(onClose).not.toHaveBeenCalled();
  });
});

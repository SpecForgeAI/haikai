/**
 * DeleteDiagramConfirmModal Tests
 *
 * Spec 2026-03-05: Diagrams Toolbar UX Refresh
 * Task Group 6, Task 6.1: Write 3 focused tests for DeleteDiagramConfirmModal
 *
 * Tests verify:
 * - Test 1: Modal renders with confirmation message when isOpen is true
 * - Test 2: Clicking "Delete" calls onConfirm; clicking "Cancel" calls onClose
 * - Test 3: Pressing Escape and clicking overlay both call onClose
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeleteDiagramConfirmModal } from '../DeleteDiagramConfirmModal';

describe('DeleteDiagramConfirmModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Modal renders with confirmation message when isOpen is true
  it('renders with confirmation message when isOpen is true', () => {
    render(<DeleteDiagramConfirmModal {...defaultProps} />);

    // Check the modal is rendered
    expect(screen.getByTestId('delete-diagram-confirm-modal')).toBeInTheDocument();

    // Check for the confirmation message
    expect(
      screen.getByText('Are you sure you want to permanently delete this diagram?')
    ).toBeInTheDocument();

    // Check for the title
    expect(screen.getByText('Delete Diagram')).toBeInTheDocument();

    // Check for the buttons
    expect(screen.getByTestId('modal-delete-button')).toBeInTheDocument();
    expect(screen.getByTestId('modal-cancel-button')).toBeInTheDocument();

    // Verify modal does not render when isOpen is false
    const { unmount } = render(
      <DeleteDiagramConfirmModal {...defaultProps} isOpen={false} />
    );
    // The second render should NOT produce another modal
    const modals = screen.getAllByTestId('delete-diagram-confirm-modal');
    expect(modals).toHaveLength(1);
    unmount();
  });

  // Test 2: Clicking "Delete" calls onConfirm; clicking "Cancel" calls onClose
  it('calls onConfirm when Delete is clicked and onClose when Cancel is clicked', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <DeleteDiagramConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );

    // Click the Delete button
    fireEvent.click(screen.getByTestId('modal-delete-button'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    // Reset mocks
    vi.clearAllMocks();

    // Click the Cancel button
    fireEvent.click(screen.getByTestId('modal-cancel-button'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // Test 3: Pressing Escape and clicking overlay both call onClose
  it('calls onClose when Escape is pressed and when overlay is clicked', () => {
    const onClose = vi.fn();

    render(
      <DeleteDiagramConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={vi.fn()}
      />
    );

    // Press Escape key
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Reset mock
    vi.clearAllMocks();

    // Click the overlay (the outermost div)
    const overlay = screen.getByTestId('delete-diagram-confirm-modal');
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Reset mock
    vi.clearAllMocks();

    // Clicking inside the modal (not the overlay) should NOT call onClose
    const cancelButton = screen.getByTestId('modal-cancel-button');
    // Get the modal div (child of overlay) and click it
    const modalDiv = overlay.querySelector(':scope > div');
    if (modalDiv) {
      fireEvent.click(modalDiv);
      // onClose should NOT be called because the click target is the modal, not the overlay
      expect(onClose).not.toHaveBeenCalled();
    }
  });
});

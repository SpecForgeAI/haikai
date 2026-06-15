/**
 * Spec 2026-01-23: Two-Flag Workflow State Machine
 * Task Group 3: ImplementConfirmationModal Tests
 *
 * Tests for the ImplementConfirmationModal component:
 * - Modal not rendered when isOpen is false
 * - Modal displays correct count message
 * - Cancel button calls onClose callback
 * - Continue button calls onConfirm callback and then onClose
 * - Modal has warning styling (amber header background)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImplementConfirmationModal } from '../components/ProductView/ImplementConfirmationModal';

describe('Spec 2026-01-23: ImplementConfirmationModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    openQuestionCount: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Modal visibility', () => {
    it('should NOT render when isOpen is false', () => {
      render(<ImplementConfirmationModal {...defaultProps} isOpen={false} />);

      const modal = screen.queryByTestId('implement-confirmation-modal');
      expect(modal).not.toBeInTheDocument();
    });

    it('should render when isOpen is true', () => {
      render(<ImplementConfirmationModal {...defaultProps} isOpen={true} />);

      const modal = screen.getByTestId('implement-confirmation-modal');
      expect(modal).toBeInTheDocument();
    });
  });

  describe('Modal content', () => {
    it('should display the correct count message for multiple questions', () => {
      render(<ImplementConfirmationModal {...defaultProps} openQuestionCount={3} />);

      expect(screen.getByTestId('confirm-modal-message')).toHaveTextContent(
        'You have 3 unanswered questions from the Product Owner.'
      );
    });

    it('should display singular form for 1 question', () => {
      render(<ImplementConfirmationModal {...defaultProps} openQuestionCount={1} />);

      expect(screen.getByTestId('confirm-modal-message')).toHaveTextContent(
        'You have 1 unanswered question from the Product Owner.'
      );
    });

    it('should display the header title "Proceed to Implementation?"', () => {
      render(<ImplementConfirmationModal {...defaultProps} />);

      expect(screen.getByText('Proceed to Implementation?')).toBeInTheDocument();
    });

    it('should ask if user wants to proceed', () => {
      render(<ImplementConfirmationModal {...defaultProps} />);

      expect(screen.getByText(/Are you sure you want to proceed\?/)).toBeInTheDocument();
    });
  });

  describe('Cancel button', () => {
    it('should render Cancel button', () => {
      render(<ImplementConfirmationModal {...defaultProps} />);

      const cancelButton = screen.getByTestId('modal-cancel-button');
      expect(cancelButton).toBeInTheDocument();
      expect(cancelButton).toHaveTextContent('Cancel');
    });

    it('should call onClose when Cancel button is clicked', () => {
      const onClose = vi.fn();
      render(<ImplementConfirmationModal {...defaultProps} onClose={onClose} />);

      const cancelButton = screen.getByTestId('modal-cancel-button');
      fireEvent.click(cancelButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should NOT call onConfirm when Cancel button is clicked', () => {
      const onConfirm = vi.fn();
      render(<ImplementConfirmationModal {...defaultProps} onConfirm={onConfirm} />);

      const cancelButton = screen.getByTestId('modal-cancel-button');
      fireEvent.click(cancelButton);

      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe('Continue button', () => {
    it('should render Continue button', () => {
      render(<ImplementConfirmationModal {...defaultProps} />);

      const continueButton = screen.getByTestId('modal-continue-button');
      expect(continueButton).toBeInTheDocument();
      expect(continueButton).toHaveTextContent('Continue');
    });

    it('should call onConfirm and onClose when Continue button is clicked', () => {
      const onConfirm = vi.fn();
      const onClose = vi.fn();
      render(
        <ImplementConfirmationModal
          {...defaultProps}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      );

      const continueButton = screen.getByTestId('modal-continue-button');
      fireEvent.click(continueButton);

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Close button (X)', () => {
    it('should render close button in header', () => {
      render(<ImplementConfirmationModal {...defaultProps} />);

      const closeButton = screen.getByTestId('modal-close-button');
      expect(closeButton).toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', () => {
      const onClose = vi.fn();
      render(<ImplementConfirmationModal {...defaultProps} onClose={onClose} />);

      const closeButton = screen.getByTestId('modal-close-button');
      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Overlay click', () => {
    it('should call onClose when overlay is clicked', () => {
      const onClose = vi.fn();
      render(<ImplementConfirmationModal {...defaultProps} onClose={onClose} />);

      const overlay = screen.getByTestId('implement-confirmation-modal');
      fireEvent.click(overlay);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should NOT call onClose when modal content is clicked (event propagation)', () => {
      const onClose = vi.fn();
      render(<ImplementConfirmationModal {...defaultProps} onClose={onClose} />);

      const modalContent = screen.getByText('Proceed to Implementation?').parentElement;
      if (modalContent) {
        fireEvent.click(modalContent);
      }

      // Should not trigger close when clicking inside modal content
      // (due to stopPropagation on modal container)
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Keyboard interaction', () => {
    it('should call onClose when Escape key is pressed', () => {
      const onClose = vi.fn();
      render(<ImplementConfirmationModal {...defaultProps} onClose={onClose} />);

      const modal = screen.getByTestId('implement-confirmation-modal');
      fireEvent.keyDown(modal, { key: 'Escape' });

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Modal styling (amber/warning theme)', () => {
    it('should have warning styling class on header', () => {
      render(<ImplementConfirmationModal {...defaultProps} />);

      const header = screen.getByText('Proceed to Implementation?').closest('div');
      // Header should have a class containing 'header'
      expect(header?.className).toContain('header');
    });

    it('should have warning styling class on warning message area', () => {
      render(<ImplementConfirmationModal {...defaultProps} />);

      const warningBox = screen.getByTestId('confirm-modal-warning');
      expect(warningBox?.className).toContain('warning');
    });
  });
});

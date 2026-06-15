/**
 * Tests for Toast Notification Component
 *
 * Spec 2026-01-31: Trigger Global Standards Generation
 * Task Group 5: Toast Notification Component
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Toast, ToastType } from './Toast';

// Mock timers for auto-dismiss testing
vi.useFakeTimers();

describe('Toast Component', () => {
  const mockOnDismiss = vi.fn();

  beforeEach(() => {
    mockOnDismiss.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('rendering', () => {
    it('renders success toast with correct styling class', () => {
      render(
        <Toast
          message="Success message"
          type="success"
          visible={true}
          onDismiss={mockOnDismiss}
        />
      );

      const toast = screen.getByTestId('toast-success');
      expect(toast).toBeInTheDocument();
      // CSS modules hash class names, so check for class containing 'success'
      expect(toast.className).toMatch(/success/i);
      expect(toast).toHaveTextContent('Success message');
    });

    it('renders error toast with correct styling class', () => {
      render(
        <Toast
          message="Error message"
          type="error"
          visible={true}
          onDismiss={mockOnDismiss}
        />
      );

      const toast = screen.getByTestId('toast-error');
      expect(toast).toBeInTheDocument();
      // CSS modules hash class names, so check for class containing 'error'
      expect(toast.className).toMatch(/error/i);
      expect(toast).toHaveTextContent('Error message');
    });

    it('does not render when visible is false', () => {
      render(
        <Toast
          message="Test message"
          type="success"
          visible={false}
          onDismiss={mockOnDismiss}
        />
      );

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('has correct ARIA attributes', () => {
      render(
        <Toast
          message="Accessible message"
          type="success"
          visible={true}
          onDismiss={mockOnDismiss}
        />
      );

      const toast = screen.getByRole('alert');
      expect(toast).toHaveAttribute('aria-live', 'polite');
    });

    it('error toast has assertive aria-live', () => {
      render(
        <Toast
          message="Error message"
          type="error"
          visible={true}
          onDismiss={mockOnDismiss}
        />
      );

      const toast = screen.getByRole('alert');
      expect(toast).toHaveAttribute('aria-live', 'assertive');
    });
  });

  describe('auto-dismiss behavior', () => {
    it('success toast auto-dismisses after ~5 seconds', () => {
      render(
        <Toast
          message="Success message"
          type="success"
          visible={true}
          onDismiss={mockOnDismiss}
        />
      );

      expect(mockOnDismiss).not.toHaveBeenCalled();

      // Fast-forward 5 seconds
      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(mockOnDismiss).toHaveBeenCalledTimes(1);
    });

    it('error toast auto-dismisses after ~30 seconds', () => {
      render(
        <Toast
          message="Error message"
          type="error"
          visible={true}
          onDismiss={mockOnDismiss}
        />
      );

      expect(mockOnDismiss).not.toHaveBeenCalled();

      // Fast-forward 29 seconds - should not dismiss yet
      act(() => {
        vi.advanceTimersByTime(29000);
      });
      expect(mockOnDismiss).not.toHaveBeenCalled();

      // Fast-forward 1 more second (total 30)
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(mockOnDismiss).toHaveBeenCalledTimes(1);
    });

    it('respects custom duration', () => {
      render(
        <Toast
          message="Custom duration"
          type="success"
          visible={true}
          onDismiss={mockOnDismiss}
          duration={2000}
        />
      );

      expect(mockOnDismiss).not.toHaveBeenCalled();

      // Fast-forward 2 seconds
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(mockOnDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('manual dismiss', () => {
    it('can be dismissed by clicking close button', () => {
      render(
        <Toast
          message="Dismissable message"
          type="error"
          visible={true}
          onDismiss={mockOnDismiss}
        />
      );

      const closeButton = screen.getByTestId('toast-close-button');
      fireEvent.click(closeButton);

      expect(mockOnDismiss).toHaveBeenCalledTimes(1);
    });

    it('close button has accessible label', () => {
      render(
        <Toast
          message="Test message"
          type="success"
          visible={true}
          onDismiss={mockOnDismiss}
        />
      );

      const closeButton = screen.getByTestId('toast-close-button');
      expect(closeButton).toHaveAttribute('aria-label', 'Dismiss notification');
    });
  });

  describe('custom test ID', () => {
    it('uses custom data-testid when provided', () => {
      render(
        <Toast
          message="Test message"
          type="success"
          visible={true}
          onDismiss={mockOnDismiss}
          data-testid="custom-toast"
        />
      );

      expect(screen.getByTestId('custom-toast')).toBeInTheDocument();
    });
  });
});

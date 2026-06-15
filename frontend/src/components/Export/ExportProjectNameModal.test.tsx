/**
 * ExportProjectNameModal Tests
 *
 * Spec 2026-01-19: Export Project Name Prompt
 * Task Group 1: ExportProjectNameModal Component
 *
 * Tests for the ExportProjectNameModal component that prompts users
 * for a project name when exporting if one is not already set.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExportProjectNameModal } from './ExportProjectNameModal';

describe('ExportProjectNameModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1.1a: Modal renders with correct elements
  it('renders with correct elements (input, Export button, Cancel button)', () => {
    render(<ExportProjectNameModal {...defaultProps} />);

    // Check for project name input
    expect(screen.getByTestId('project-name-input')).toBeInTheDocument();
    expect(screen.getByLabelText(/product name/i)).toBeInTheDocument();

    // Check for Export button
    expect(screen.getByTestId('modal-export-button')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();

    // Check for Cancel button
    expect(screen.getByTestId('cancel-button')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  // Test 1.1b: Export button disabled when input is empty/whitespace
  it('disables Export button when input is empty or whitespace only', () => {
    render(<ExportProjectNameModal {...defaultProps} />);

    const exportButton = screen.getByTestId('modal-export-button');
    const input = screen.getByTestId('project-name-input');

    // Initially empty - should be disabled
    expect(exportButton).toBeDisabled();

    // Whitespace only - should still be disabled
    fireEvent.change(input, { target: { value: '   ' } });
    expect(exportButton).toBeDisabled();

    // Valid input - should be enabled
    fireEvent.change(input, { target: { value: 'My Project' } });
    expect(exportButton).not.toBeDisabled();
  });

  // Test 1.1c: Enter key triggers export when input is valid
  it('triggers export when Enter key is pressed with valid input', () => {
    const onConfirm = vi.fn();
    render(<ExportProjectNameModal {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByTestId('project-name-input');

    // Enter with empty input - should not trigger
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();

    // Enter with valid input - should trigger
    fireEvent.change(input, { target: { value: 'My Project' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith('My Project');
  });

  // Test 1.1d: Escape key triggers cancel
  it('triggers cancel when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<ExportProjectNameModal {...defaultProps} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  // Test 1.1e: Inline error displays when attempting export with empty input
  it('shows inline error when attempting to export with empty input', () => {
    render(<ExportProjectNameModal {...defaultProps} />);

    const exportButton = screen.getByTestId('modal-export-button');

    // Click export with empty input - button should be disabled
    // But we simulate the edge case where user might try clicking anyway
    expect(exportButton).toBeDisabled();

    // Enter whitespace and try to submit (button will still be disabled, but test error message logic)
    const input = screen.getByTestId('project-name-input');
    fireEvent.change(input, { target: { value: '   ' } });

    // The error should only show when user tries invalid submit action
    // Since button is disabled, we test the Enter key path
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    // Error message should be visible. The message now renders in two
    // places (the inline name-validation span and the error-message div),
    // so use the *AllBy* variant.
    expect(screen.getByTestId('error-message')).toBeInTheDocument();
    expect(screen.getAllByText(/product name is required/i).length).toBeGreaterThanOrEqual(1);
  });

  // Test 1.1f: onConfirm callback receives trimmed project name
  it('calls onConfirm with trimmed project name', () => {
    const onConfirm = vi.fn();
    render(<ExportProjectNameModal {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByTestId('project-name-input');
    const exportButton = screen.getByTestId('modal-export-button');

    // Enter name with leading/trailing whitespace
    fireEvent.change(input, { target: { value: '  My Project  ' } });
    fireEvent.click(exportButton);

    // Should receive trimmed name
    expect(onConfirm).toHaveBeenCalledWith('My Project');
  });

  // Test: Modal does not render when isOpen is false
  it('does not render when isOpen is false', () => {
    render(<ExportProjectNameModal {...defaultProps} isOpen={false} />);

    expect(screen.queryByTestId('project-name-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('modal-export-button')).not.toBeInTheDocument();
  });

  // Test: Input clears error message when user types
  it('clears error message when user modifies input', () => {
    render(<ExportProjectNameModal {...defaultProps} />);

    const input = screen.getByTestId('project-name-input');

    // Trigger error by pressing Enter with whitespace
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    // Error should be visible
    expect(screen.getByTestId('error-message')).toBeInTheDocument();

    // Type valid input - error should clear
    fireEvent.change(input, { target: { value: 'My Project' } });
    expect(screen.queryByTestId('error-message')).not.toBeInTheDocument();
  });

  // Test: Cancel button calls onClose
  it('calls onClose when Cancel button is clicked', () => {
    const onClose = vi.fn();
    render(<ExportProjectNameModal {...defaultProps} onClose={onClose} />);

    const cancelButton = screen.getByTestId('cancel-button');
    fireEvent.click(cancelButton);

    expect(onClose).toHaveBeenCalled();
  });
});

/**
 * RenameDiagramModal Tests
 *
 * Spec: 2026-03-05 Diagrams Toolbar UX Refresh
 * Task Group 5: Rename Diagram Modal
 *
 * Tests for the RenameDiagramModal component that allows users to rename
 * an existing diagram with validation for same-name, empty, and duplicate names.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RenameDiagramModal } from '../RenameDiagramModal';
import { Diagram } from '../../../../types/model';

// Helper to create minimal Diagram objects for testing
function makeDiagram(id: string, name: string): Diagram {
  return {
    id,
    name,
    description: '',
    diagram_type: 'General',
    settings: {},
    diagram_nodes: [],
    diagram_edges: [],
  };
}

describe('RenameDiagramModal', () => {
  const existingDiagrams: Diagram[] = [
    makeDiagram('diag-1', 'Main Diagram'),
    makeDiagram('diag-2', 'Secondary Diagram'),
    makeDiagram('diag-3', 'Third Diagram'),
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    existingDiagrams,
    currentDiagramName: 'Main Diagram',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Modal renders with name pre-populated with current diagram name when isOpen is true
  it('renders with name pre-populated with current diagram name when isOpen is true', () => {
    render(<RenameDiagramModal {...defaultProps} />);

    // Modal should be visible
    expect(screen.getByTestId('rename-diagram-modal')).toBeInTheDocument();

    // Title should be "Rename Diagram"
    expect(screen.getByText('Rename Diagram')).toBeInTheDocument();

    // Name input should be pre-populated with current diagram name
    const nameInput = screen.getByTestId('rename-diagram-name-input') as HTMLInputElement;
    expect(nameInput.value).toBe('Main Diagram');

    // Rename and Cancel buttons should be present
    expect(screen.getByTestId('modal-rename-button')).toBeInTheDocument();
    expect(screen.getByTestId('modal-cancel-button')).toBeInTheDocument();

    // Should not render when isOpen is false
    const { container } = render(
      <RenameDiagramModal {...defaultProps} isOpen={false} />
    );
    // The second render should produce no modal content (returns null)
    expect(container.querySelector('[data-testid="rename-diagram-modal"]')).toBeNull();
  });

  // Test 2: Clicking "Rename" when name is identical to current name shows same-name error
  it('shows "The new name is the same as the current name." error when name is identical', () => {
    render(<RenameDiagramModal {...defaultProps} />);

    const renameButton = screen.getByTestId('modal-rename-button');

    // Click Rename without changing the name (still "Main Diagram")
    fireEvent.click(renameButton);

    // Should show the same-name validation error
    const errorEl = screen.getByTestId('validation-error');
    expect(errorEl).toBeInTheDocument();
    expect(errorEl.textContent).toBe('The new name is the same as the current name.');

    // onSubmit should NOT have been called
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();

    // Also test with whitespace-padded same name
    const nameInput = screen.getByTestId('rename-diagram-name-input');
    fireEvent.change(nameInput, { target: { value: '  Main Diagram  ' } });
    fireEvent.click(renameButton);

    // Should still show the same-name error (trimmed name matches)
    expect(screen.getByTestId('validation-error').textContent).toBe(
      'The new name is the same as the current name.'
    );
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  // Test 3: Clicking "Rename" with a valid, different name calls onSubmit with the trimmed name
  it('calls onSubmit with trimmed name when a valid, different name is provided', () => {
    const onSubmit = vi.fn();
    render(
      <RenameDiagramModal {...defaultProps} onSubmit={onSubmit} />
    );

    const nameInput = screen.getByTestId('rename-diagram-name-input');
    const renameButton = screen.getByTestId('modal-rename-button');

    // Change to a valid, different name (with extra whitespace to test trimming)
    fireEvent.change(nameInput, { target: { value: '  Renamed Diagram  ' } });
    fireEvent.click(renameButton);

    // onSubmit should be called with the trimmed name
    expect(onSubmit).toHaveBeenCalledWith('Renamed Diagram');

    // No validation error should be displayed
    expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument();
  });

  // Test 4: Validation error from validateDiagramName (duplicate/empty) displays inline
  it('displays validation errors from validateDiagramName for empty and duplicate names', () => {
    render(<RenameDiagramModal {...defaultProps} />);

    const nameInput = screen.getByTestId('rename-diagram-name-input');
    const renameButton = screen.getByTestId('modal-rename-button');

    // Test empty name validation
    fireEvent.change(nameInput, { target: { value: '   ' } });
    fireEvent.click(renameButton);

    // Empty name should NOT trigger same-name error (empty !== "Main Diagram")
    // Instead it should trigger validateDiagramName's empty check
    const errorEl = screen.getByTestId('validation-error');
    expect(errorEl).toBeInTheDocument();
    expect(errorEl.textContent).toBe('Please enter a diagram name before creating a new diagram.');

    // onSubmit should not be called
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();

    // Test duplicate name validation (name of another existing diagram)
    fireEvent.change(nameInput, { target: { value: 'Secondary Diagram' } });
    fireEvent.click(renameButton);

    const dupErrorEl = screen.getByTestId('validation-error');
    expect(dupErrorEl).toBeInTheDocument();
    expect(dupErrorEl.textContent).toBe(
      'A diagram with this name already exists. Please choose a different name.'
    );

    // onSubmit should still not be called
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();

    // Verify error clears when user modifies input
    fireEvent.change(nameInput, { target: { value: 'Something new' } });
    expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument();
  });
});

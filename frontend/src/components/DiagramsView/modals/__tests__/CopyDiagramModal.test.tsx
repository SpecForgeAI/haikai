/**
 * CopyDiagramModal Tests
 *
 * Spec: 2026-03-05 Diagrams Toolbar UX Refresh
 * Task Group 4: Copy Diagram Modal
 *
 * 3 focused tests:
 * - Test 1: Modal renders with name pre-populated as "[OriginalName] (Copy)" when isOpen is true
 * - Test 2: Clicking "Create" with a valid name calls onSubmit with the trimmed name;
 *           validation error displays for empty/duplicate names
 * - Test 3: Pressing Escape or clicking overlay calls onClose
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CopyDiagramModal } from '../CopyDiagramModal';
import { Diagram } from '../../../../types/model';

// Helper to build a minimal Diagram for testing
function makeDiagram(overrides: Partial<Diagram> & { id: string; name: string }): Diagram {
  return {
    description: '',
    diagram_type: 'General',
    diagram_nodes: [],
    diagram_edges: [],
    ...overrides,
  };
}

describe('CopyDiagramModal', () => {
  const existingDiagrams: Diagram[] = [
    makeDiagram({ id: 'diag-1', name: 'Main Diagram' }),
    makeDiagram({ id: 'diag-2', name: 'Secondary Diagram' }),
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    existingDiagrams,
    sourceDiagramName: 'Main Diagram',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Modal renders with name pre-populated as "[OriginalName] (Copy)" when isOpen is true
  it('renders with name pre-populated as "[OriginalName] (Copy)" when isOpen is true', () => {
    render(<CopyDiagramModal {...defaultProps} />);

    // Title is visible
    expect(screen.getByText('Copy Diagram')).toBeInTheDocument();

    // Label is visible
    expect(screen.getByLabelText('Copied Diagram New Name')).toBeInTheDocument();

    // Name input is pre-populated
    const nameInput = screen.getByTestId('copy-diagram-name-input') as HTMLInputElement;
    expect(nameInput.value).toBe('Main Diagram (Copy)');

    // Create and Cancel buttons are visible
    expect(screen.getByTestId('modal-create-button')).toBeInTheDocument();
    expect(screen.getByTestId('modal-cancel-button')).toBeInTheDocument();

    // Does not render when isOpen is false
    const { container } = render(
      <CopyDiagramModal {...defaultProps} isOpen={false} />
    );
    expect(container.querySelector('[data-testid="copy-diagram-modal"]')).not.toBeInTheDocument();
  });

  // Test 2: Clicking "Create" with a valid name calls onSubmit with the trimmed name;
  //         validation error displays for empty/duplicate names
  it('calls onSubmit with trimmed name for valid input; shows validation error for empty/duplicate names', () => {
    const onSubmit = vi.fn();
    render(
      <CopyDiagramModal {...defaultProps} onSubmit={onSubmit} />
    );

    const nameInput = screen.getByTestId('copy-diagram-name-input');
    const createButton = screen.getByTestId('modal-create-button');

    // Case A: Empty name should show validation error
    fireEvent.change(nameInput, { target: { value: '   ' } });
    fireEvent.click(createButton);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('validation-error')).toBeInTheDocument();

    // Typing clears validation error
    fireEvent.change(nameInput, { target: { value: 'Some Name' } });
    expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument();

    // Case B: Duplicate name should show validation error
    fireEvent.change(nameInput, { target: { value: 'Secondary Diagram' } });
    fireEvent.click(createButton);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('validation-error')).toBeInTheDocument();
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();

    // Case C: Valid, unique name should call onSubmit with trimmed value
    fireEvent.change(nameInput, { target: { value: '  Main Diagram (Copy)  ' } });
    fireEvent.click(createButton);
    expect(onSubmit).toHaveBeenCalledWith('Main Diagram (Copy)');
  });

  // Test 3: Pressing Escape or clicking overlay calls onClose
  it('calls onClose when Escape is pressed or overlay is clicked', () => {
    const onClose = vi.fn();
    render(<CopyDiagramModal {...defaultProps} onClose={onClose} />);

    // Pressing Escape calls onClose
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Clicking the overlay calls onClose
    const overlay = screen.getByTestId('copy-diagram-modal');
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(2);

    // Clicking inside the modal card does NOT call onClose
    const modalTitle = screen.getByText('Copy Diagram');
    fireEvent.click(modalTitle);
    expect(onClose).toHaveBeenCalledTimes(2); // Still 2, no extra call

    // Clicking close (x) button calls onClose
    const closeButton = screen.getByTestId('modal-close-button');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

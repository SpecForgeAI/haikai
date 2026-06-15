/**
 * NewDiagramModal Tests
 *
 * Spec 2026-03-05: Diagrams Toolbar UX Refresh
 * Task Group 3, Task 3.1: Write 3 focused tests for NewDiagramModal
 *
 * Tests verify:
 * - Test 1: Modal renders with empty name field and type dropdown defaulting to "General" when isOpen is true
 * - Test 2: Clicking "Create" with an empty name displays validation error inline;
 *           clicking "Create" with a valid name calls onSubmit with { name, diagramType }
 * - Test 3: Pressing Escape or clicking overlay calls onClose
 *
 * Spec 2026-04-03: User Journey Native Diagram Type and Renderer
 * Task Group 1, Task 1.1 (Test 5):
 * - Test 4: NewDiagramModal does not render a 'User Journey' option in its type <select> dropdown
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NewDiagramModal } from '../NewDiagramModal';
import type { Diagram } from '../../../../types/model';

// ============================================================================
// Test Data
// ============================================================================

const existingDiagrams: Diagram[] = [
  {
    id: 'diag-1',
    name: 'Existing Diagram',
    description: '',
    diagram_type: 'General',
    settings: {},
    diagram_nodes: [],
    diagram_edges: [],
  },
];

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSubmit: vi.fn(),
  existingDiagrams,
};

// ============================================================================
// Tests
// ============================================================================

describe('NewDiagramModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Modal renders with empty name field and type dropdown defaulting to "General"
  it('renders with empty name field and type dropdown defaulting to "General" when isOpen is true', () => {
    render(<NewDiagramModal {...defaultProps} />);

    // Modal title should be visible
    expect(screen.getByText('Create New Diagram')).toBeInTheDocument();

    // Name input should be empty
    const nameInput = screen.getByTestId('new-diagram-name-input');
    expect(nameInput).toBeInTheDocument();
    expect(nameInput).toHaveValue('');

    // Type dropdown should default to "General"
    const typeSelect = screen.getByTestId('new-diagram-type-select');
    expect(typeSelect).toBeInTheDocument();
    expect(typeSelect).toHaveValue('General');

    // Buttons should be present
    expect(screen.getByTestId('new-diagram-create-button')).toBeInTheDocument();
    expect(screen.getByTestId('new-diagram-cancel-button')).toBeInTheDocument();

    // Should NOT render when isOpen is false
    const { unmount } = render(<NewDiagramModal {...defaultProps} isOpen={false} />);
    // The second render with isOpen=false should not add a second modal title
    const titles = screen.getAllByText('Create New Diagram');
    expect(titles).toHaveLength(1);
    unmount();
  });

  // Test 2: Clicking "Create" with empty name shows validation error; valid name calls onSubmit
  it('displays validation error for empty name; calls onSubmit with valid name and selected type', () => {
    const onSubmit = vi.fn();
    render(<NewDiagramModal {...defaultProps} onSubmit={onSubmit} />);

    const createButton = screen.getByTestId('new-diagram-create-button');
    const nameInput = screen.getByTestId('new-diagram-name-input');
    const typeSelect = screen.getByTestId('new-diagram-type-select');

    // Click Create with empty name -- should show validation error
    fireEvent.click(createButton);
    expect(screen.getByTestId('new-diagram-validation-error')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    // Type a valid name -- error should clear
    fireEvent.change(nameInput, { target: { value: 'My New Diagram' } });
    expect(screen.queryByTestId('new-diagram-validation-error')).not.toBeInTheDocument();

    // Select a different diagram type
    fireEvent.change(typeSelect, { target: { value: 'Sequence' } });

    // Click Create with valid name -- should call onSubmit
    fireEvent.click(createButton);
    expect(onSubmit).toHaveBeenCalledWith('My New Diagram', 'Sequence');

    // Also test duplicate name validation
    onSubmit.mockClear();
    const { unmount } = render(<NewDiagramModal {...defaultProps} onSubmit={onSubmit} />);
    const nameInput2 = screen.getAllByTestId('new-diagram-name-input')[1];
    const createButton2 = screen.getAllByTestId('new-diagram-create-button')[1];

    fireEvent.change(nameInput2, { target: { value: 'Existing Diagram' } });
    fireEvent.click(createButton2);
    expect(screen.getAllByTestId('new-diagram-validation-error').length).toBeGreaterThanOrEqual(1);
    expect(onSubmit).not.toHaveBeenCalled();
    unmount();
  });

  // Test 3: Pressing Escape or clicking overlay calls onClose
  it('calls onClose when pressing Escape or clicking overlay', () => {
    const onClose = vi.fn();
    render(<NewDiagramModal {...defaultProps} onClose={onClose} />);

    // Pressing Escape should call onClose
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();

    // Clicking the overlay should call onClose
    const overlay = screen.getByTestId('new-diagram-modal-overlay');
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();

    // Clicking inside the modal (not on overlay) should NOT call onClose
    const modal = screen.getByTestId('new-diagram-modal');
    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();

    onClose.mockClear();

    // Clicking the close button should call onClose
    const closeButton = screen.getByTestId('new-diagram-close-button');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Test 4 (Spec 2026-04-03): NewDiagramModal does not render User Journey in type dropdown
  it('does not render a "User Journey" option in the type dropdown', () => {
    render(<NewDiagramModal {...defaultProps} />);

    const typeSelect = screen.getByTestId('new-diagram-type-select');
    const options = typeSelect.querySelectorAll('option');
    const optionLabels = Array.from(options).map((opt) => opt.textContent);

    // User Journey should NOT be present
    expect(optionLabels).not.toContain('User Journey');

    // Other types should still be present
    expect(optionLabels).toContain('General');
    expect(optionLabels).toContain('ER');
    expect(optionLabels).toContain('Sequence');
    expect(optionLabels).toContain('Activity');
    expect(optionLabels).toContain('State');
    expect(optionLabels).toContain('UI Workflow');
    expect(optionLabels).toContain('UI Screen');
  });
});

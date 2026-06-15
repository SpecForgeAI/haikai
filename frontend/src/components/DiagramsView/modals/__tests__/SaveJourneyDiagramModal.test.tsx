/**
 * SaveJourneyDiagramModal Tests
 *
 * Spec 2026-04-03: User Journey Diagram Edit and Save Flow
 * Task Group 3, Task 3.1: 5 focused tests for SaveJourneyDiagramModal
 *
 * Test 1: Modal renders nothing when isOpen is false
 * Test 2: Modal renders with the default name pre-filled from defaultName prop
 * Test 3: Clicking Save with an empty name shows the validation error
 * Test 4: Clicking Save with a valid name calls onSubmit with the trimmed name
 * Test 5: Clicking Cancel calls onClose and resets state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SaveJourneyDiagramModal } from '../SaveJourneyDiagramModal';
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
  defaultName: 'Customer Onboarding Journey',
  existingDiagrams,
};

// ============================================================================
// Tests
// ============================================================================

describe('SaveJourneyDiagramModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Modal renders nothing when isOpen is false
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <SaveJourneyDiagramModal {...defaultProps} isOpen={false} />
    );
    expect(container.innerHTML).toBe('');
  });

  // Test 2: Modal renders with the default name pre-filled
  it('renders with the default name pre-filled from defaultName prop', () => {
    render(<SaveJourneyDiagramModal {...defaultProps} />);

    // Modal title should be visible
    expect(screen.getByText('Save Journey as Diagram')).toBeInTheDocument();

    // Name input should be pre-filled with the journey name
    const nameInput = screen.getByTestId('save-journey-name-input');
    expect(nameInput).toBeInTheDocument();
    expect(nameInput).toHaveValue('Customer Onboarding Journey');

    // Buttons should be present
    expect(screen.getByTestId('save-journey-save-button')).toBeInTheDocument();
    expect(screen.getByTestId('save-journey-cancel-button')).toBeInTheDocument();
  });

  // Test 3: Clicking Save with an empty name shows validation error
  it('clicking Save with an empty name shows the validation error', () => {
    render(<SaveJourneyDiagramModal {...defaultProps} defaultName="" />);

    const saveButton = screen.getByTestId('save-journey-save-button');
    fireEvent.click(saveButton);

    // Validation error should appear
    const errorEl = screen.getByTestId('save-journey-validation-error');
    expect(errorEl).toBeInTheDocument();
    expect(errorEl.textContent).toContain('Please enter a diagram name');

    // onSubmit should NOT have been called
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  // Test 4: Clicking Save with a valid name calls onSubmit with the trimmed name
  it('clicking Save with a valid name calls onSubmit with the trimmed name', () => {
    render(
      <SaveJourneyDiagramModal {...defaultProps} defaultName="  My Journey  " />
    );

    const saveButton = screen.getByTestId('save-journey-save-button');
    fireEvent.click(saveButton);

    // onSubmit should be called with trimmed name
    expect(defaultProps.onSubmit).toHaveBeenCalledTimes(1);
    expect(defaultProps.onSubmit).toHaveBeenCalledWith('My Journey');
  });

  // Test 5: Clicking Cancel calls onClose and resets state
  it('clicking Cancel calls onClose and resets state', () => {
    render(<SaveJourneyDiagramModal {...defaultProps} />);

    // Change the name first
    const nameInput = screen.getByTestId('save-journey-name-input');
    fireEvent.change(nameInput, { target: { value: 'Changed Name' } });
    expect(nameInput).toHaveValue('Changed Name');

    // Click Cancel
    const cancelButton = screen.getByTestId('save-journey-cancel-button');
    fireEvent.click(cancelButton);

    // onClose should be called
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});

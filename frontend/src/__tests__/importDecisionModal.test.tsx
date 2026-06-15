/**
 * Tests for ImportDecisionModal Component
 *
 * Spec 2026-03-05: Import Product Snapshot Redesign
 * Task Group 4: Import Decision Modal (Save-and-Replace vs. Merge)
 *
 * 5 focused tests covering:
 * 1. Modal renders with two radio options, first option selected by default
 * 2. Modal shows imported project name as read-only header
 * 3. For XLSX imports, Option 1 ("Save and close") is hidden; modal skips to cherry-pick
 * 4. Selecting Option 1 and confirming triggers save-and-replace flow (calls onSaveAndReplace)
 * 5. Selecting Option 2 and confirming opens the cherry-pick merge modal (calls onMerge)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ImportDecisionModal } from '../components/Import/ImportDecisionModal';

describe('ImportDecisionModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    importedProjectName: 'My Imported Project',
    importSource: 'json' as const,
    onSaveAndReplace: vi.fn(),
    onMerge: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1: Modal renders with two radio options, first option selected by default
  // -------------------------------------------------------------------------
  it('renders with two radio options and first option selected by default', () => {
    render(<ImportDecisionModal {...defaultProps} />);

    // Modal should be visible
    expect(screen.getByTestId('import-decision-modal')).toBeTruthy();

    // Two radio buttons should be present
    const radioSaveAndReplace = screen.getByTestId('radio-save-and-replace') as HTMLInputElement;
    const radioMerge = screen.getByTestId('radio-merge') as HTMLInputElement;

    expect(radioSaveAndReplace).toBeTruthy();
    expect(radioMerge).toBeTruthy();

    // First option (save-and-replace) should be checked by default
    expect(radioSaveAndReplace.checked).toBe(true);
    expect(radioMerge.checked).toBe(false);

    // Both option labels should be visible
    expect(screen.getByText('Save and close current project, then load imported file')).toBeTruthy();
    expect(screen.getByText('Merge imported data into current project')).toBeTruthy();

    // Continue and Cancel buttons should be present
    expect(screen.getByTestId('import-decision-continue-button')).toBeTruthy();
    expect(screen.getByTestId('import-decision-cancel-button')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Test 2: Modal shows imported project name as read-only header
  // -------------------------------------------------------------------------
  it('shows imported project name as read-only display', () => {
    render(<ImportDecisionModal {...defaultProps} importedProjectName="Architecture Alpha" />);

    // The imported project name should be displayed
    const nameDisplay = screen.getByTestId('imported-project-name-display');
    expect(nameDisplay).toBeTruthy();
    expect(nameDisplay.textContent).toBe('Architecture Alpha');

    // Modal title should be "Import Product"
    expect(screen.getByText('Import Product')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Test 3: For XLSX imports, Option 1 is hidden; modal auto-skips to merge
  // -------------------------------------------------------------------------
  it('auto-skips to onMerge for XLSX imports without rendering modal', async () => {
    const onMerge = vi.fn();

    render(
      <ImportDecisionModal
        {...defaultProps}
        importSource="xlsx"
        onMerge={onMerge}
      />
    );

    // For XLSX, the modal should not be rendered (returns null for xlsx)
    expect(screen.queryByTestId('import-decision-modal')).toBeNull();

    // onMerge should have been called via the useEffect auto-skip
    await waitFor(() => {
      expect(onMerge).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: Selecting Option 1 and confirming triggers onSaveAndReplace
  // -------------------------------------------------------------------------
  it('calls onSaveAndReplace when Option 1 is selected and Continue is clicked', () => {
    const onSaveAndReplace = vi.fn();
    const onMerge = vi.fn();

    render(
      <ImportDecisionModal
        {...defaultProps}
        onSaveAndReplace={onSaveAndReplace}
        onMerge={onMerge}
      />
    );

    // Option 1 is already selected by default; click Continue
    fireEvent.click(screen.getByTestId('import-decision-continue-button'));

    // onSaveAndReplace should be called
    expect(onSaveAndReplace).toHaveBeenCalledTimes(1);
    // onMerge should NOT be called
    expect(onMerge).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 5: Selecting Option 2 and confirming calls onMerge
  // -------------------------------------------------------------------------
  it('calls onMerge when Option 2 is selected and Continue is clicked', () => {
    const onSaveAndReplace = vi.fn();
    const onMerge = vi.fn();

    render(
      <ImportDecisionModal
        {...defaultProps}
        onSaveAndReplace={onSaveAndReplace}
        onMerge={onMerge}
      />
    );

    // Select Option 2 (merge)
    fireEvent.click(screen.getByTestId('radio-merge'));

    // Verify Option 2 is now selected
    const radioMerge = screen.getByTestId('radio-merge') as HTMLInputElement;
    expect(radioMerge.checked).toBe(true);

    // Click Continue
    fireEvent.click(screen.getByTestId('import-decision-continue-button'));

    // onMerge should be called
    expect(onMerge).toHaveBeenCalledTimes(1);
    // onSaveAndReplace should NOT be called
    expect(onSaveAndReplace).not.toHaveBeenCalled();
  });
});

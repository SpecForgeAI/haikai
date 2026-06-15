/**
 * Tests for FileMenu "Generate Standards" menu item
 *
 * Spec 2026-01-31: Project-level Standards Generation
 * Task Group 4: FileMenu and TopBar Integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileMenu } from './FileMenu';

// Mock ReactDOM.createPortal to render normally
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock the useIncludeDatabase hook
vi.mock('../../contexts/AppConfigContext', () => ({
  useIncludeDatabase: vi.fn(),
}));

import { useIncludeDatabase } from '../../contexts/AppConfigContext';

describe('FileMenu - Generate Standards menu item', () => {
  const mockOnClose = vi.fn();
  const mockOnCreateProject = vi.fn();
  const mockOnOpenBackend = vi.fn();
  const mockOnSave = vi.fn();
  const mockOnSaveAsBackend = vi.fn();
  const mockOnDelete = vi.fn();
  const mockOnImportJson = vi.fn();
  const mockOnExportJson = vi.fn();
  const mockOnImportXlsx = vi.fn();
  const mockOnExportXlsx = vi.fn();
  const mockOnGenerateStandards = vi.fn();

  const defaultProps = {
    visible: true,
    x: 100,
    y: 100,
    onClose: mockOnClose,
    onCreateProject: mockOnCreateProject,
    onOpenBackend: mockOnOpenBackend,
    onSave: mockOnSave,
    saveDisabled: false,
    onSaveAsBackend: mockOnSaveAsBackend,
    saveAsDisabled: false,
    onDelete: mockOnDelete,
    onImportJson: mockOnImportJson,
    importJsonDisabled: false,
    onExportJson: mockOnExportJson,
    exportJsonDisabled: false,
    onImportXlsx: mockOnImportXlsx,
    importXlsxDisabled: false,
    onExportXlsx: mockOnExportXlsx,
    exportXlsxDisabled: false,
    onGenerateStandards: mockOnGenerateStandards,
    generateStandardsDisabled: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useIncludeDatabase as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  it('renders "Generate Standards" menu item between "Open" and "Save" when includeDatabase=true', () => {
    render(<FileMenu {...defaultProps} />);

    const menuItems = screen.getAllByRole('generic').filter(
      el => el.className.includes('menuItem') && !el.className.includes('separator')
    );

    // Find the indices
    const openIndex = menuItems.findIndex(el => el.textContent === 'Open');
    const generateIndex = menuItems.findIndex(el => el.textContent === 'Generate Standards');
    const saveIndex = menuItems.findIndex(el => el.textContent === 'Save');

    expect(generateIndex).toBeGreaterThan(openIndex);
    expect(generateIndex).toBeLessThan(saveIndex);
  });

  it('does not render "Generate Standards" menu item when includeDatabase=false', () => {
    (useIncludeDatabase as ReturnType<typeof vi.fn>).mockReturnValue(false);

    render(<FileMenu {...defaultProps} />);

    expect(screen.queryByText('Generate Standards')).not.toBeInTheDocument();
  });

  it('menu item is disabled when generateStandardsDisabled=true', () => {
    render(<FileMenu {...defaultProps} generateStandardsDisabled={true} />);

    const menuItem = screen.getByText('Generate Standards');
    expect(menuItem.className).toContain('menuItemDisabled');
  });

  it('menu item is enabled when generateStandardsDisabled=false', () => {
    render(<FileMenu {...defaultProps} generateStandardsDisabled={false} />);

    const menuItem = screen.getByText('Generate Standards');
    expect(menuItem.className).not.toContain('menuItemDisabled');
  });

  it('calls onGenerateStandards and onClose when menu item is clicked', () => {
    render(<FileMenu {...defaultProps} />);

    const menuItem = screen.getByText('Generate Standards');
    fireEvent.click(menuItem);

    expect(mockOnGenerateStandards).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('does not call onGenerateStandards when item is clicked while disabled', () => {
    render(<FileMenu {...defaultProps} generateStandardsDisabled={true} />);

    const menuItem = screen.getByText('Generate Standards');
    fireEvent.click(menuItem);

    expect(mockOnGenerateStandards).not.toHaveBeenCalled();
  });
});

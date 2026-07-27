/**
 * Tests for the FileMenu "Edit" menu item (2026-07-27).
 *
 * The Product menu gains an Edit entry directly under Create: it opens the
 * Create-Product modal in EDIT mode for the ACTIVE project (prefilled saved
 * values; Save persists the changes to the database and (re)registers the
 * implementation workspace via POST /projects/init). Disabled when no project
 * is active — mirrors the Generate Standards gating pattern.
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

describe('FileMenu - Edit menu item', () => {
  const mockOnClose = vi.fn();
  const mockOnEditProject = vi.fn();

  const defaultProps = {
    visible: true,
    x: 100,
    y: 100,
    onClose: mockOnClose,
    onCreateProject: vi.fn(),
    onEditProject: mockOnEditProject,
    editProjectDisabled: false,
    onOpenBackend: vi.fn(),
    onSave: vi.fn(),
    saveDisabled: false,
    onSaveAsBackend: vi.fn(),
    saveAsDisabled: false,
    onDelete: vi.fn(),
    onImportJson: vi.fn(),
    importJsonDisabled: false,
    onExportJson: vi.fn(),
    exportJsonDisabled: false,
    onImportXlsx: vi.fn(),
    importXlsxDisabled: false,
    onExportXlsx: vi.fn(),
    exportXlsxDisabled: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useIncludeDatabase as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  it('renders "Edit" between "Create" and "Open"', () => {
    render(<FileMenu {...defaultProps} />);

    const menuItems = screen
      .getAllByRole('generic')
      .filter(
        (el) =>
          el.className.includes('menuItem') && !el.className.includes('separator')
      );
    const createIndex = menuItems.findIndex((el) => el.textContent === 'Create');
    const editIndex = menuItems.findIndex((el) => el.textContent === 'Edit');
    const openIndex = menuItems.findIndex((el) => el.textContent === 'Open');

    expect(editIndex).toBeGreaterThan(createIndex);
    expect(editIndex).toBeLessThan(openIndex);
  });

  it('calls onEditProject and closes on click when enabled', () => {
    render(<FileMenu {...defaultProps} />);
    fireEvent.click(screen.getByTestId('project-menu-edit'));
    expect(mockOnEditProject).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('is disabled (and inert) when no project is active', () => {
    render(<FileMenu {...defaultProps} editProjectDisabled={true} />);
    const item = screen.getByTestId('project-menu-edit');
    expect(item.className).toContain('menuItemDisabled');
    fireEvent.click(item);
    expect(mockOnEditProject).not.toHaveBeenCalled();
  });
});

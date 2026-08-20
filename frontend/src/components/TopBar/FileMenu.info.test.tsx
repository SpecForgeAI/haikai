/**
 * FileMenu "Info" item (2026-08-20): last entry in the Product menu, own
 * separator, ALWAYS enabled (build identity needs no active project — so it
 * renders with includeDatabase both on and off), opens the build-info modal
 * via onInfo and closes the menu.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileMenu } from './FileMenu';

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

vi.mock('../../contexts/AppConfigContext', () => ({
  useIncludeDatabase: vi.fn(),
}));

import { useIncludeDatabase } from '../../contexts/AppConfigContext';

describe('FileMenu - Info menu item', () => {
  const mockOnClose = vi.fn();
  const mockOnInfo = vi.fn();

  const defaultProps = {
    visible: true,
    x: 100,
    y: 100,
    onClose: mockOnClose,
    onCreateProject: vi.fn(),
    onOpenBackend: vi.fn(),
    onSave: vi.fn(),
    saveDisabled: false,
    onSaveAsBackend: vi.fn(),
    onDelete: vi.fn(),
    onImportJson: vi.fn(),
    onExportJson: vi.fn(),
    onImportXlsx: vi.fn(),
    onExportXlsx: vi.fn(),
    onInfo: mockOnInfo,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useIncludeDatabase as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  it('renders Info as the LAST menu item', () => {
    render(<FileMenu {...defaultProps} />);
    const items = screen
      .getAllByRole('generic')
      .filter(
        (el) =>
          el.className.includes('menuItem') && !el.className.includes('separator'),
      );
    expect(items[items.length - 1].textContent).toBe('Info');
  });

  it('calls onInfo and closes the menu on click', () => {
    render(<FileMenu {...defaultProps} />);
    fireEvent.click(screen.getByTestId('project-menu-info'));
    expect(mockOnInfo).toHaveBeenCalledTimes(1);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('still renders when includeDatabase is OFF (file-only mode)', () => {
    (useIncludeDatabase as ReturnType<typeof vi.fn>).mockReturnValue(false);
    render(<FileMenu {...defaultProps} />);
    expect(screen.getByTestId('project-menu-info')).toBeInTheDocument();
  });

  it('does not render the item when no onInfo handler is wired', () => {
    const { onInfo: _omitted, ...withoutInfo } = defaultProps;
    render(<FileMenu {...withoutInfo} />);
    expect(screen.queryByTestId('project-menu-info')).toBeNull();
  });
});

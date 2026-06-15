/**
 * Project Menu Disable Tests
 *
 * Spec 2026-01-11: Project Menu Disable When No Active Project
 *
 * Task Group 1: Tests for disabled menu item behavior
 * - Test: Save As menu item is disabled when saveAsDisabled prop is true
 * - Test: Save As menu item is enabled when saveAsDisabled prop is false
 * - Test: Import JSON menu item is disabled when importJsonDisabled prop is true
 * - Test: Export JSON menu item is disabled when exportJsonDisabled prop is true
 * - Test: Export XLSX menu item is disabled when exportXlsxDisabled prop is true
 * - Test: Disabled menu items do not call their handlers when clicked
 *
 * Task Group 2: Additional coverage tests
 * - Test: All 4 items disabled simultaneously when no active project
 * - Test: All 4 items enabled when active project exists
 *
 * Spec 2026-01-19: Project Menu Import/Export Always Enabled
 * - Import JSON and Import XLSX are always enabled in practice (TopBar passes false)
 * - Tests for FileMenu component prop behavior remain to ensure component handles props correctly
 * - Added new tests to verify Import items are always enabled with default props
 *
 * Note: While the FileMenu component still accepts importJsonDisabled and importXlsxDisabled
 * props for backward compatibility and testing purposes, TopBar always passes false for these
 * props per Spec 2026-01-19.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { ReactNode } from 'react';

// Import FileMenu component
import { FileMenu } from '../components/TopBar/FileMenu';

// Mock the useIncludeDatabase hook to avoid needing the full AppConfigProvider
vi.mock('../contexts/AppConfigContext', () => ({
  useIncludeDatabase: () => true, // Default to true for tests (database features enabled)
}));

describe('Task Group 1: Disabled Menu Item Behavior', () => {
  const defaultProps = {
    visible: true,
    x: 100,
    y: 100,
    onClose: vi.fn(),
    onCreateProject: vi.fn(),
    onOpenBackend: vi.fn(),
    onSave: vi.fn(),
    saveDisabled: false,
    onSaveAsBackend: vi.fn(),
    onDelete: vi.fn(),
    onImportJson: vi.fn(),
    onExportJson: vi.fn(),
    onImportXlsx: vi.fn(),
    importXlsxDisabled: false,
    onExportXlsx: vi.fn(),
    // New disabled props for this feature
    saveAsDisabled: false,
    importJsonDisabled: false,
    exportJsonDisabled: false,
    exportXlsxDisabled: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Test 1.1a: Save As disabled state', () => {
    it('should be disabled when saveAsDisabled prop is true', () => {
      render(<FileMenu {...defaultProps} saveAsDisabled={true} />);

      const saveAsItem = screen.getByTestId('project-menu-save-as');

      // Check for disabled styling class
      expect(saveAsItem.className).toMatch(/menuItemDisabled/);
    });

    it('should be enabled when saveAsDisabled prop is false', () => {
      render(<FileMenu {...defaultProps} saveAsDisabled={false} />);

      const saveAsItem = screen.getByTestId('project-menu-save-as');

      // Should not have disabled class
      expect(saveAsItem.className).not.toMatch(/menuItemDisabled/);
    });
  });

  describe('Test 1.1b: Import JSON disabled state (FileMenu component prop behavior)', () => {
    // Note: In practice, TopBar always passes importJsonDisabled={false} per Spec 2026-01-19
    // These tests verify the FileMenu component correctly handles the prop when passed
    it('should show disabled styling when importJsonDisabled prop is true', () => {
      render(<FileMenu {...defaultProps} importJsonDisabled={true} />);

      const importJsonItem = screen.getByTestId('project-menu-import-json');

      // Check for disabled styling class
      expect(importJsonItem.className).toMatch(/menuItemDisabled/);
    });

    it('should be enabled when importJsonDisabled prop is false', () => {
      render(<FileMenu {...defaultProps} importJsonDisabled={false} />);

      const importJsonItem = screen.getByTestId('project-menu-import-json');

      // Should not have disabled class
      expect(importJsonItem.className).not.toMatch(/menuItemDisabled/);
    });
  });

  describe('Test 1.1c: Export JSON disabled state', () => {
    it('should be disabled when exportJsonDisabled prop is true', () => {
      render(<FileMenu {...defaultProps} exportJsonDisabled={true} />);

      const exportJsonItem = screen.getByTestId('project-menu-export-json');

      // Check for disabled styling class
      expect(exportJsonItem.className).toMatch(/menuItemDisabled/);
    });

    it('should be enabled when exportJsonDisabled prop is false', () => {
      render(<FileMenu {...defaultProps} exportJsonDisabled={false} />);

      const exportJsonItem = screen.getByTestId('project-menu-export-json');

      // Should not have disabled class
      expect(exportJsonItem.className).not.toMatch(/menuItemDisabled/);
    });
  });

  describe('Test 1.1d: Export XLSX disabled state', () => {
    it('should be disabled when exportXlsxDisabled prop is true', () => {
      render(<FileMenu {...defaultProps} exportXlsxDisabled={true} />);

      const exportXlsxItem = screen.getByTestId('project-menu-export-xlsx');

      // Check for disabled styling class
      expect(exportXlsxItem.className).toMatch(/menuItemDisabled/);
    });

    it('should be enabled when exportXlsxDisabled prop is false', () => {
      render(<FileMenu {...defaultProps} exportXlsxDisabled={false} />);

      const exportXlsxItem = screen.getByTestId('project-menu-export-xlsx');

      // Should not have disabled class
      expect(exportXlsxItem.className).not.toMatch(/menuItemDisabled/);
    });
  });

  describe('Test 1.1e: Disabled menu items do not call their handlers', () => {
    it('should not call onSaveAsBackend when Save As is disabled', () => {
      const onSaveAsBackend = vi.fn();
      const onClose = vi.fn();

      render(
        <FileMenu
          {...defaultProps}
          onSaveAsBackend={onSaveAsBackend}
          onClose={onClose}
          saveAsDisabled={true}
        />
      );

      const saveAsItem = screen.getByTestId('project-menu-save-as');
      fireEvent.click(saveAsItem);

      expect(onSaveAsBackend).not.toHaveBeenCalled();
    });

    // Note: Per Spec 2026-01-19, Import JSON handler no longer has a disabled guard
    // since importJsonDisabled is always false from TopBar. The handler always executes.
    // This test is kept to document the behavior change.
    it('should call onImportJson even when importJsonDisabled prop is true (Spec 2026-01-19)', () => {
      const onImportJson = vi.fn();
      const onClose = vi.fn();

      render(
        <FileMenu
          {...defaultProps}
          onImportJson={onImportJson}
          onClose={onClose}
          importJsonDisabled={true}
        />
      );

      const importJsonItem = screen.getByTestId('project-menu-import-json');
      fireEvent.click(importJsonItem);

      // Per Spec 2026-01-19: Handler is always called (guard was removed)
      expect(onImportJson).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should not call onExportJson when Export JSON is disabled', () => {
      const onExportJson = vi.fn();
      const onClose = vi.fn();

      render(
        <FileMenu
          {...defaultProps}
          onExportJson={onExportJson}
          onClose={onClose}
          exportJsonDisabled={true}
        />
      );

      const exportJsonItem = screen.getByTestId('project-menu-export-json');
      fireEvent.click(exportJsonItem);

      expect(onExportJson).not.toHaveBeenCalled();
    });

    it('should not call onExportXlsx when Export XLSX is disabled', () => {
      const onExportXlsx = vi.fn();
      const onClose = vi.fn();

      render(
        <FileMenu
          {...defaultProps}
          onExportXlsx={onExportXlsx}
          onClose={onClose}
          exportXlsxDisabled={true}
        />
      );

      const exportXlsxItem = screen.getByTestId('project-menu-export-xlsx');
      fireEvent.click(exportXlsxItem);

      expect(onExportXlsx).not.toHaveBeenCalled();
    });

    // Note: Per Spec 2026-01-19, Import XLSX handler no longer has a disabled guard
    // since importXlsxDisabled is always false from TopBar. The handler always executes.
    it('should call onImportXlsx even when importXlsxDisabled prop is true (Spec 2026-01-19)', () => {
      const onImportXlsx = vi.fn();
      const onClose = vi.fn();

      render(
        <FileMenu
          {...defaultProps}
          onImportXlsx={onImportXlsx}
          onClose={onClose}
          importXlsxDisabled={true}
        />
      );

      const importXlsxItem = screen.getByTestId('project-menu-import-xlsx');
      fireEvent.click(importXlsxItem);

      // Per Spec 2026-01-19: Handler is always called (guard was removed)
      expect(onImportXlsx).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Test 1.1f: Enabled menu items call their handlers', () => {
    it('should call onSaveAsBackend when Save As is enabled', () => {
      const onSaveAsBackend = vi.fn();
      const onClose = vi.fn();

      render(
        <FileMenu
          {...defaultProps}
          onSaveAsBackend={onSaveAsBackend}
          onClose={onClose}
          saveAsDisabled={false}
        />
      );

      const saveAsItem = screen.getByTestId('project-menu-save-as');
      fireEvent.click(saveAsItem);

      expect(onSaveAsBackend).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should call onImportJson when Import JSON is enabled', () => {
      const onImportJson = vi.fn();
      const onClose = vi.fn();

      render(
        <FileMenu
          {...defaultProps}
          onImportJson={onImportJson}
          onClose={onClose}
          importJsonDisabled={false}
        />
      );

      const importJsonItem = screen.getByTestId('project-menu-import-json');
      fireEvent.click(importJsonItem);

      expect(onImportJson).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should call onExportJson when Export JSON is enabled', () => {
      const onExportJson = vi.fn();
      const onClose = vi.fn();

      render(
        <FileMenu
          {...defaultProps}
          onExportJson={onExportJson}
          onClose={onClose}
          exportJsonDisabled={false}
        />
      );

      const exportJsonItem = screen.getByTestId('project-menu-export-json');
      fireEvent.click(exportJsonItem);

      expect(onExportJson).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should call onExportXlsx when Export XLSX is enabled', () => {
      const onExportXlsx = vi.fn();
      const onClose = vi.fn();

      render(
        <FileMenu
          {...defaultProps}
          onExportXlsx={onExportXlsx}
          onClose={onClose}
          exportXlsxDisabled={false}
        />
      );

      const exportXlsxItem = screen.getByTestId('project-menu-export-xlsx');
      fireEvent.click(exportXlsxItem);

      expect(onExportXlsx).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Task Group 2: Integration and Coverage Tests', () => {
  const defaultProps = {
    visible: true,
    x: 100,
    y: 100,
    onClose: vi.fn(),
    onCreateProject: vi.fn(),
    onOpenBackend: vi.fn(),
    onSave: vi.fn(),
    saveDisabled: false,
    onSaveAsBackend: vi.fn(),
    onDelete: vi.fn(),
    onImportJson: vi.fn(),
    onExportJson: vi.fn(),
    onImportXlsx: vi.fn(),
    importXlsxDisabled: false,
    onExportXlsx: vi.fn(),
    saveAsDisabled: false,
    importJsonDisabled: false,
    exportJsonDisabled: false,
    exportXlsxDisabled: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Test 2.3a: FileMenu component disabled props behavior', () => {
    // Note: This test verifies FileMenu component handles disabled props correctly.
    // In practice, per Spec 2026-01-19, Import items always receive false from TopBar.
    it('should apply disabled styling when all disabled props are true', () => {
      render(
        <FileMenu
          {...defaultProps}
          saveAsDisabled={true}
          importJsonDisabled={true}
          exportJsonDisabled={true}
          exportXlsxDisabled={true}
        />
      );

      const saveAsItem = screen.getByTestId('project-menu-save-as');
      const importJsonItem = screen.getByTestId('project-menu-import-json');
      const exportJsonItem = screen.getByTestId('project-menu-export-json');
      const exportXlsxItem = screen.getByTestId('project-menu-export-xlsx');

      expect(saveAsItem.className).toMatch(/menuItemDisabled/);
      expect(importJsonItem.className).toMatch(/menuItemDisabled/);
      expect(exportJsonItem.className).toMatch(/menuItemDisabled/);
      expect(exportXlsxItem.className).toMatch(/menuItemDisabled/);
    });
  });

  describe('Test 2.3b: All 4 items enabled when active project exists', () => {
    it('should enable Save As, Import JSON, Export JSON, and Export XLSX when all disabled props are false', () => {
      render(
        <FileMenu
          {...defaultProps}
          saveAsDisabled={false}
          importJsonDisabled={false}
          exportJsonDisabled={false}
          exportXlsxDisabled={false}
        />
      );

      const saveAsItem = screen.getByTestId('project-menu-save-as');
      const importJsonItem = screen.getByTestId('project-menu-import-json');
      const exportJsonItem = screen.getByTestId('project-menu-export-json');
      const exportXlsxItem = screen.getByTestId('project-menu-export-xlsx');

      expect(saveAsItem.className).not.toMatch(/menuItemDisabled/);
      expect(importJsonItem.className).not.toMatch(/menuItemDisabled/);
      expect(exportJsonItem.className).not.toMatch(/menuItemDisabled/);
      expect(exportXlsxItem.className).not.toMatch(/menuItemDisabled/);
    });
  });

  describe('Test 2.3c: Always-enabled items remain enabled regardless of active project', () => {
    it('should keep Create, Open, and Delete enabled even when project-dependent items are disabled', () => {
      render(
        <FileMenu
          {...defaultProps}
          saveDisabled={true}
          saveAsDisabled={true}
          importJsonDisabled={true}
          exportJsonDisabled={true}
          importXlsxDisabled={true}
          exportXlsxDisabled={true}
        />
      );

      const createItem = screen.getByTestId('project-menu-create');
      const openItem = screen.getByTestId('project-menu-open');
      const deleteItem = screen.getByTestId('project-menu-delete');

      // These should never have the disabled class
      expect(createItem.className).not.toMatch(/menuItemDisabled/);
      expect(openItem.className).not.toMatch(/menuItemDisabled/);
      expect(deleteItem.className).not.toMatch(/menuItemDisabled/);
    });
  });

  describe('Test 2.3d: Disabled props default to false', () => {
    it('should have all items enabled when disabled props are not provided', () => {
      // Only provide required props
      const minimalProps = {
        visible: true,
        x: 100,
        y: 100,
        onClose: vi.fn(),
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
      };

      render(<FileMenu {...minimalProps} />);

      const saveAsItem = screen.getByTestId('project-menu-save-as');
      const importJsonItem = screen.getByTestId('project-menu-import-json');
      const exportJsonItem = screen.getByTestId('project-menu-export-json');
      const exportXlsxItem = screen.getByTestId('project-menu-export-xlsx');

      // Should not have disabled class when props default to false
      expect(saveAsItem.className).not.toMatch(/menuItemDisabled/);
      expect(importJsonItem.className).not.toMatch(/menuItemDisabled/);
      expect(exportJsonItem.className).not.toMatch(/menuItemDisabled/);
      expect(exportXlsxItem.className).not.toMatch(/menuItemDisabled/);
    });
  });
});

/**
 * Spec 2026-01-19: Project Menu Import/Export Always Enabled
 * New tests to verify Import items are always enabled in the intended usage
 */
describe('Task Group 3: Import Always Enabled Tests (Spec 2026-01-19)', () => {
  const defaultProps = {
    visible: true,
    x: 100,
    y: 100,
    onClose: vi.fn(),
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
    // These props match what TopBar passes per Spec 2026-01-19
    saveAsDisabled: false,
    importJsonDisabled: false,
    exportJsonDisabled: false,
    importXlsxDisabled: false,
    exportXlsxDisabled: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Test 3.1: Import JSON is always enabled (simulating fresh app startup)', () => {
    it('should show Import JSON as enabled when importJsonDisabled is false', () => {
      // This simulates fresh app startup where TopBar passes importJsonDisabled={false}
      render(<FileMenu {...defaultProps} importJsonDisabled={false} />);

      const importJsonItem = screen.getByTestId('project-menu-import-json');

      // Should not have disabled class
      expect(importJsonItem.className).not.toMatch(/menuItemDisabled/);
    });

    it('should call onImportJson handler when clicking Import JSON', () => {
      const onImportJson = vi.fn();
      const onClose = vi.fn();

      render(
        <FileMenu
          {...defaultProps}
          onImportJson={onImportJson}
          onClose={onClose}
          importJsonDisabled={false}
        />
      );

      const importJsonItem = screen.getByTestId('project-menu-import-json');
      fireEvent.click(importJsonItem);

      expect(onImportJson).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Test 3.2: Import XLSX is always enabled (simulating fresh app startup)', () => {
    it('should show Import XLSX as enabled when importXlsxDisabled is false', () => {
      // This simulates fresh app startup where TopBar passes importXlsxDisabled={false}
      render(<FileMenu {...defaultProps} importXlsxDisabled={false} />);

      const importXlsxItem = screen.getByTestId('project-menu-import-xlsx');

      // Should not have disabled class
      expect(importXlsxItem.className).not.toMatch(/menuItemDisabled/);
    });

    it('should call onImportXlsx handler when clicking Import XLSX', () => {
      const onImportXlsx = vi.fn();
      const onClose = vi.fn();

      render(
        <FileMenu
          {...defaultProps}
          onImportXlsx={onImportXlsx}
          onClose={onClose}
          importXlsxDisabled={false}
        />
      );

      const importXlsxItem = screen.getByTestId('project-menu-import-xlsx');
      fireEvent.click(importXlsxItem);

      expect(onImportXlsx).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Test 3.3: Both Import items enabled simultaneously (fresh startup scenario)', () => {
    it('should show both Import JSON and Import XLSX as enabled', () => {
      // Simulates fresh app startup: no project loaded, but imports are enabled
      render(
        <FileMenu
          {...defaultProps}
          saveAsDisabled={true}  // Save As would be disabled with no project
          importJsonDisabled={false}  // But Import JSON is always enabled
          importXlsxDisabled={false}  // And Import XLSX is always enabled
        />
      );

      const importJsonItem = screen.getByTestId('project-menu-import-json');
      const importXlsxItem = screen.getByTestId('project-menu-import-xlsx');

      // Both import items should be enabled
      expect(importJsonItem.className).not.toMatch(/menuItemDisabled/);
      expect(importXlsxItem.className).not.toMatch(/menuItemDisabled/);
    });

    it('should call both import handlers correctly', () => {
      const onImportJson = vi.fn();
      const onImportXlsx = vi.fn();
      const onClose = vi.fn();

      const { rerender } = render(
        <FileMenu
          {...defaultProps}
          onImportJson={onImportJson}
          onImportXlsx={onImportXlsx}
          onClose={onClose}
          importJsonDisabled={false}
          importXlsxDisabled={false}
        />
      );

      // Click Import JSON
      const importJsonItem = screen.getByTestId('project-menu-import-json');
      fireEvent.click(importJsonItem);
      expect(onImportJson).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);

      // Reset mocks and rerender for Import XLSX click
      vi.clearAllMocks();
      rerender(
        <FileMenu
          {...defaultProps}
          onImportJson={onImportJson}
          onImportXlsx={onImportXlsx}
          onClose={onClose}
          importJsonDisabled={false}
          importXlsxDisabled={false}
        />
      );

      // Click Import XLSX
      const importXlsxItem = screen.getByTestId('project-menu-import-xlsx');
      fireEvent.click(importXlsxItem);
      expect(onImportXlsx).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * FileMenu Database Gating Tests
 *
 * Spec 2026-01-19: UI Route Gating for Startup Feature Toggles
 * Task Group 2: FileMenu Gating (includeDatabase)
 *
 * Tests cover:
 * 1. All menu items render when includeDatabase=true
 * 2. Create, Open, Save, Save As, Delete items do NOT render when includeDatabase=false
 * 3. Import as JSON, Export as JSON, Import as XLSX, Export as XLSX items render when includeDatabase=false
 * 4. Separator is removed when all DB items are hidden (no orphaned separator)
 * 5. Menu closes correctly after clicking any visible item
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Track mock value for dynamic control
let mockIncludeDatabase = true;

// Mock AppConfigContext hooks
vi.mock('../contexts/AppConfigContext', () => ({
  useIncludeDelivery: () => true,
  useIncludeDatabase: () => mockIncludeDatabase,
}));

// Import after mocks
import { FileMenu } from '../components/TopBar/FileMenu';

describe('FileMenu Database Gating (includeDatabase)', () => {
  // Default props for FileMenu
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIncludeDatabase = true; // Reset to default
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Task 2.1 Test 1: All menu items render when includeDatabase=true', () => {
    it('should render all database-dependent menu items when includeDatabase is true', () => {
      mockIncludeDatabase = true;

      render(<FileMenu {...defaultProps} />);

      // DB-dependent items
      expect(screen.getByTestId('project-menu-create')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-open')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-save')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-save-as')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-delete')).toBeInTheDocument();
    });

    it('should render all file import/export items when includeDatabase is true', () => {
      mockIncludeDatabase = true;

      render(<FileMenu {...defaultProps} />);

      // File-only items
      expect(screen.getByTestId('project-menu-import-json')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-export-json')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-import-xlsx')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-export-xlsx')).toBeInTheDocument();
    });
  });

  describe('Task 2.1 Test 2: Create, Open, Save, Save As, Delete items do NOT render when includeDatabase=false', () => {
    it('should NOT render Create menu item when includeDatabase is false', () => {
      mockIncludeDatabase = false;

      render(<FileMenu {...defaultProps} />);

      expect(screen.queryByTestId('project-menu-create')).not.toBeInTheDocument();
    });

    it('should NOT render Open menu item when includeDatabase is false', () => {
      mockIncludeDatabase = false;

      render(<FileMenu {...defaultProps} />);

      expect(screen.queryByTestId('project-menu-open')).not.toBeInTheDocument();
    });

    it('should NOT render Save menu item when includeDatabase is false', () => {
      mockIncludeDatabase = false;

      render(<FileMenu {...defaultProps} />);

      expect(screen.queryByTestId('project-menu-save')).not.toBeInTheDocument();
    });

    it('should NOT render Save As menu item when includeDatabase is false', () => {
      mockIncludeDatabase = false;

      render(<FileMenu {...defaultProps} />);

      expect(screen.queryByTestId('project-menu-save-as')).not.toBeInTheDocument();
    });

    it('should NOT render Delete menu item when includeDatabase is false', () => {
      mockIncludeDatabase = false;

      render(<FileMenu {...defaultProps} />);

      expect(screen.queryByTestId('project-menu-delete')).not.toBeInTheDocument();
    });
  });

  describe('Task 2.1 Test 3: Import as JSON, Export as JSON, Import as XLSX, Export as XLSX items render when includeDatabase=false', () => {
    it('should render Import as JSON when includeDatabase is false', () => {
      mockIncludeDatabase = false;

      render(<FileMenu {...defaultProps} />);

      expect(screen.getByTestId('project-menu-import-json')).toBeInTheDocument();
      expect(screen.getByText('Import as JSON')).toBeInTheDocument();
    });

    it('should render Export as JSON when includeDatabase is false', () => {
      mockIncludeDatabase = false;

      render(<FileMenu {...defaultProps} />);

      expect(screen.getByTestId('project-menu-export-json')).toBeInTheDocument();
      expect(screen.getByText('Export as JSON')).toBeInTheDocument();
    });

    it('should render Import as XLSX when includeDatabase is false', () => {
      mockIncludeDatabase = false;

      render(<FileMenu {...defaultProps} />);

      expect(screen.getByTestId('project-menu-import-xlsx')).toBeInTheDocument();
      expect(screen.getByText('Import as XLSX')).toBeInTheDocument();
    });

    it('should render Export as XLSX when includeDatabase is false', () => {
      mockIncludeDatabase = false;

      render(<FileMenu {...defaultProps} />);

      expect(screen.getByTestId('project-menu-export-xlsx')).toBeInTheDocument();
      expect(screen.getByText('Export as XLSX')).toBeInTheDocument();
    });
  });

  describe('Task 2.1 Test 4: Separator is removed when all DB items are hidden (no orphaned separator)', () => {
    it('should have separator when includeDatabase is true', () => {
      mockIncludeDatabase = true;

      render(<FileMenu {...defaultProps} />);

      const menu = screen.getByTestId('project-menu');
      const separators = menu.querySelectorAll('[class*="separator"]');
      expect(separators.length).toBeGreaterThan(0);
    });

    it('should NOT have separator when includeDatabase is false', () => {
      mockIncludeDatabase = false;

      render(<FileMenu {...defaultProps} />);

      const menu = screen.getByTestId('project-menu');
      const separators = menu.querySelectorAll('[class*="separator"]');
      expect(separators.length).toBe(0);
    });
  });

  describe('Task 2.1 Test 5: Menu closes correctly after clicking any visible item', () => {
    it('should call onClose after clicking Import as JSON when includeDatabase is false', () => {
      mockIncludeDatabase = false;

      render(<FileMenu {...defaultProps} />);

      const importJsonItem = screen.getByTestId('project-menu-import-json');
      fireEvent.click(importJsonItem);

      expect(mockOnImportJson).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onClose after clicking Export as XLSX when includeDatabase is false', () => {
      mockIncludeDatabase = false;

      render(<FileMenu {...defaultProps} />);

      const exportXlsxItem = screen.getByTestId('project-menu-export-xlsx');
      fireEvent.click(exportXlsxItem);

      expect(mockOnExportXlsx).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });
});

/**
 * Tests for Generate Standards disabled behavior
 *
 * Spec 2026-02-01: Disable Generate Standards When No Active Project
 * Task Group 1: Tests for disabled state logic
 *
 * These tests verify that the Generate Standards menu item is disabled:
 * - When loadedFileName is null/empty (no project loaded)
 * - When activeProject is null
 * - And is only enabled when both conditions are satisfied along with organisationId
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Import FileMenu component
import { FileMenu } from '../components/TopBar/FileMenu';

// Mock the useIncludeDatabase hook to avoid needing the full AppConfigProvider
vi.mock('../contexts/AppConfigContext', () => ({
  useIncludeDatabase: () => true, // Default to true for tests (database features enabled)
}));

describe('Spec 2026-02-01: Generate Standards Disabled Behavior', () => {
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
    onGenerateStandards: vi.fn(),
    generateStandardsDisabled: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Test 1: Generate Standards disabled when no project loaded (loadedFileName is null/empty)', () => {
    /**
     * This test verifies that when generateStandardsDisabled=true (which would be
     * computed in TopBar.tsx when loadedFileName is null/empty), the menu item
     * shows as disabled with the appropriate CSS class.
     *
     * The actual computation of generateStandardsDisabled happens in TopBar.tsx.
     * This test verifies the FileMenu component correctly applies the disabled state.
     */
    it('should show Generate Standards as disabled when generateStandardsDisabled prop is true', () => {
      render(<FileMenu {...defaultProps} generateStandardsDisabled={true} />);

      const generateStandardsItem = screen.getByTestId('project-menu-generate-standards');

      // Check for disabled styling class
      expect(generateStandardsItem.className).toMatch(/menuItemDisabled/);
    });

    it('should not call onGenerateStandards when clicking disabled Generate Standards', () => {
      const onGenerateStandards = vi.fn();
      const onClose = vi.fn();

      render(
        <FileMenu
          {...defaultProps}
          onGenerateStandards={onGenerateStandards}
          onClose={onClose}
          generateStandardsDisabled={true}
        />
      );

      const generateStandardsItem = screen.getByTestId('project-menu-generate-standards');
      fireEvent.click(generateStandardsItem);

      // Handler should NOT be called when disabled
      expect(onGenerateStandards).not.toHaveBeenCalled();
      // Menu should NOT close when clicking disabled item
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Test 2: Generate Standards disabled when activeProject is null', () => {
    /**
     * This test verifies the disabled behavior when activeProject is null.
     * In TopBar.tsx, generateStandardsDisabled includes the check !activeProject.
     * When activeProject is null, generateStandardsDisabled will be true.
     */
    it('should apply disabled styling when generateStandardsDisabled is true (activeProject is null)', () => {
      render(<FileMenu {...defaultProps} generateStandardsDisabled={true} />);

      const generateStandardsItem = screen.getByTestId('project-menu-generate-standards');

      // Should have disabled class when prop is true
      expect(generateStandardsItem.className).toMatch(/menuItemDisabled/);
    });
  });

  describe('Test 3: Generate Standards enabled when loadedFileName AND activeProject with organisationId exist', () => {
    /**
     * This test verifies that when all conditions are met:
     * - loadedFileName exists
     * - activeProject exists
     * - activeProject.organisationId exists
     * Then generateStandardsDisabled will be false and the menu item is enabled.
     */
    it('should show Generate Standards as enabled when generateStandardsDisabled is false', () => {
      render(<FileMenu {...defaultProps} generateStandardsDisabled={false} />);

      const generateStandardsItem = screen.getByTestId('project-menu-generate-standards');

      // Should NOT have disabled class
      expect(generateStandardsItem.className).not.toMatch(/menuItemDisabled/);
    });

    it('should call onGenerateStandards when clicking enabled Generate Standards', () => {
      const onGenerateStandards = vi.fn();
      const onClose = vi.fn();

      render(
        <FileMenu
          {...defaultProps}
          onGenerateStandards={onGenerateStandards}
          onClose={onClose}
          generateStandardsDisabled={false}
        />
      );

      const generateStandardsItem = screen.getByTestId('project-menu-generate-standards');
      fireEvent.click(generateStandardsItem);

      // Handler should be called when enabled
      expect(onGenerateStandards).toHaveBeenCalledTimes(1);
      // Menu should close after action
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Consistency with Save/Save As disabled states', () => {
    /**
     * This test verifies that Generate Standards follows the same disabled
     * pattern as Save and Save As menu items when no project is loaded.
     */
    it('should have Generate Standards, Save, and Save As all disabled when no project loaded', () => {
      render(
        <FileMenu
          {...defaultProps}
          saveDisabled={true}
          saveAsDisabled={true}
          generateStandardsDisabled={true}
        />
      );

      const saveItem = screen.getByTestId('project-menu-save');
      const saveAsItem = screen.getByTestId('project-menu-save-as');
      const generateStandardsItem = screen.getByTestId('project-menu-generate-standards');

      // All three should be disabled
      expect(saveItem.className).toMatch(/menuItemDisabled/);
      expect(saveAsItem.className).toMatch(/menuItemDisabled/);
      expect(generateStandardsItem.className).toMatch(/menuItemDisabled/);
    });

    it('should have Generate Standards, Save, and Save As all enabled when project loaded', () => {
      render(
        <FileMenu
          {...defaultProps}
          saveDisabled={false}
          saveAsDisabled={false}
          generateStandardsDisabled={false}
        />
      );

      const saveItem = screen.getByTestId('project-menu-save');
      const saveAsItem = screen.getByTestId('project-menu-save-as');
      const generateStandardsItem = screen.getByTestId('project-menu-generate-standards');

      // All three should be enabled
      expect(saveItem.className).not.toMatch(/menuItemDisabled/);
      expect(saveAsItem.className).not.toMatch(/menuItemDisabled/);
      expect(generateStandardsItem.className).not.toMatch(/menuItemDisabled/);
    });
  });
});

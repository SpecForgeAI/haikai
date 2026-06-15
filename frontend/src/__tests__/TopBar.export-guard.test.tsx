/**
 * TopBar Export Guard Tests
 *
 * Spec 2026-01-22: File Mode Blank Start UX
 * Task Group 4: Remove Export Guards
 *
 * Tests verify that export functions proceed without showing the
 * "Nothing to export yet" toast, since the backend now auto-initializes
 * a blank project.
 *
 * IMPORTANT: These tests verify the REMOVAL of the export guards.
 * The toast guards have been removed, so export should now proceed
 * to show the ExportProjectNameModal when no loadedFileName is set.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import React from 'react';

// Track mock values for dynamic control
let mockIncludeDatabase = false; // File Mode
let mockIncludeDelivery = true;
let mockLoadedFileName: string | null = null;

// Track modal open state
let capturedExportProjectNameModalOpen = false;

// Mock AppConfigContext hooks
vi.mock('../contexts/AppConfigContext', () => ({
  useIncludeDelivery: () => mockIncludeDelivery,
  useIncludeDatabase: () => mockIncludeDatabase,
}));

// Mock ArchitectureContext with dynamic loadedFileName
vi.mock('../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitecture: () => ({
    loadedFileName: mockLoadedFileName,
    currentView: 'metamodel',
    model: {
      metaModel: {
        entities: {},
        relationships: {},
      },
    },
  }),
  useArchitectureDispatch: () => vi.fn(),
}));

// Mock ProjectContext
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => null,
  useRefreshActiveProject: () => vi.fn(),
  useClearActiveProject: () => vi.fn(),
  useSetActiveProject: () => vi.fn(),
}));

// Mock FileMenu to capture export click handlers
let capturedOnExportJson: (() => void) | null = null;
let capturedOnExportXlsx: (() => void) | null = null;

vi.mock('../components/TopBar/FileMenu', () => ({
  FileMenu: (props: { onExportJson: () => void; onExportXlsx: () => void }) => {
    capturedOnExportJson = props.onExportJson;
    capturedOnExportXlsx = props.onExportXlsx;
    return null;
  },
}));

// Mock other child components
vi.mock('../components/Project/CreateProjectModal', () => ({
  CreateProjectModal: () => null,
}));

vi.mock('../components/Project/ImportProjectSnapshotModal', () => ({
  ImportProjectSnapshotModal: () => null,
}));

vi.mock('../components/Project/DeleteProjectModal', () => ({
  DeleteProjectModal: () => null,
}));

vi.mock('../components/Import/ImportModeModal', () => ({
  ImportModeModal: () => null,
}));

// Mock ExportProjectNameModal to track when it opens
vi.mock('../components/Export/ExportProjectNameModal', () => ({
  ExportProjectNameModal: (props: { isOpen: boolean }) => {
    capturedExportProjectNameModalOpen = props.isOpen;
    return props.isOpen ? <div data-testid="export-project-name-modal">Modal Open</div> : null;
  },
}));

vi.mock('../components/file/ModelFileDialog', () => ({
  ModelFileDialog: () => null,
}));

vi.mock('../components/common/Modal', () => ({
  ErrorModal: () => null,
}));

vi.mock('../components/common/ImportSummaryModal', () => ({
  ImportSummaryModal: () => null,
}));

// Import after mocks
import { TopBar } from '../components/TopBar/TopBar';
import { renderWithRouter } from '../test-utils/renderWithProviders';

describe('TopBar Export Guard Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIncludeDatabase = false; // File Mode
    mockIncludeDelivery = true;
    mockLoadedFileName = null; // No project loaded
    capturedOnExportJson = null;
    capturedOnExportXlsx = null;
    capturedExportProjectNameModalOpen = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Task 4.1: Export JSON proceeds without toast guard', () => {
    /**
     * Test: handleExportJsonClick_proceedsWithoutToast_whenBlankProject
     *
     * Spec 2026-01-22: File Mode Blank Start UX
     * Task Group 4: Remove Export Guards
     *
     * When Export JSON is clicked in File Mode with no loadedFileName,
     * it should NOT show the "Nothing to export yet" toast.
     * Instead, it should open the ExportProjectNameModal.
     */
    it('should NOT show toast and should open ExportProjectNameModal when Export JSON clicked in File Mode', async () => {
      // Arrange
      mockIncludeDatabase = false;
      mockLoadedFileName = null;

      renderWithRouter(<TopBar />);

      // Act - Trigger export JSON via captured handler
      expect(capturedOnExportJson).not.toBeNull();
      capturedOnExportJson!();

      // Assert - Give time for state updates
      await waitFor(() => {
        // The notification toast with "Nothing to export yet" should NOT appear
        const toast = screen.queryByTestId('notification-toast');
        if (toast) {
          expect(toast).not.toHaveTextContent('Nothing to export yet');
        }
      });

      // The ExportProjectNameModal should open instead
      expect(capturedExportProjectNameModalOpen).toBe(true);
    });
  });

  describe('Task 4.1: Export XLSX proceeds without toast guard', () => {
    /**
     * Test: handleExportXlsxClick_proceedsWithoutToast_whenBlankProject
     *
     * Spec 2026-01-22: File Mode Blank Start UX
     * Task Group 4: Remove Export Guards
     *
     * When Export XLSX is clicked in File Mode with no loadedFileName,
     * it should NOT show the "Nothing to export yet" toast.
     * Instead, it should open the ExportProjectNameModal.
     */
    it('should NOT show toast and should open ExportProjectNameModal when Export XLSX clicked in File Mode', async () => {
      // Arrange
      mockIncludeDatabase = false;
      mockLoadedFileName = null;

      renderWithRouter(<TopBar />);

      // Act - Trigger export XLSX via captured handler
      expect(capturedOnExportXlsx).not.toBeNull();
      capturedOnExportXlsx!();

      // Assert - Give time for state updates
      await waitFor(() => {
        // The notification toast with "Nothing to export yet" should NOT appear
        const toast = screen.queryByTestId('notification-toast');
        if (toast) {
          expect(toast).not.toHaveTextContent('Nothing to export yet');
        }
      });

      // The ExportProjectNameModal should open instead
      expect(capturedExportProjectNameModalOpen).toBe(true);
    });
  });

  describe('Export with existing project name proceeds directly', () => {
    /**
     * Test: Export proceeds directly when loadedFileName is set
     *
     * When loadedFileName is set, export should proceed directly
     * without showing the ExportProjectNameModal.
     */
    it('should NOT open ExportProjectNameModal when loadedFileName is set', async () => {
      // Arrange - Project is loaded
      mockIncludeDatabase = false;
      mockLoadedFileName = 'MyProject';

      renderWithRouter(<TopBar />);

      // Act - Trigger export JSON via captured handler
      expect(capturedOnExportJson).not.toBeNull();
      capturedOnExportJson!();

      // Assert - Give time for state updates
      await new Promise(resolve => setTimeout(resolve, 100));

      // The ExportProjectNameModal should NOT open (export proceeds directly)
      expect(capturedExportProjectNameModalOpen).toBe(false);
    });
  });
});

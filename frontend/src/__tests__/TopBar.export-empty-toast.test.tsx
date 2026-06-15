/**
 * TopBar Export Empty Toast Tests
 *
 * Spec 2026-01-22: No-Database Mode Empty-State UX
 * Task Group 3: TopBar Export Toast Handlers
 *
 * Tests cover:
 * 1. Shows info toast when Export JSON clicked with `includeDatabase=false` AND `activeProject=null`
 * 2. Shows info toast when Export XLSX clicked with `includeDatabase=false` AND `activeProject=null`
 * 3. Does NOT show toast when Export JSON clicked with project loaded (has `loadedFileName`)
 * 4. Does NOT show toast when `includeDatabase=true` (DB mode)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Track mock values for dynamic control
let mockIncludeDatabase = true;
let mockIncludeDelivery = true;
let mockLoadedFileName: string | null = null;

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

// Spec 2026-01-22 File Mode Blank Start UX (Task Group 4) removed the
// "Nothing to export yet" toast guards: export with no loadedFileName now
// opens ExportProjectNameModal instead. The mock surfaces its open state.
vi.mock('../components/Export/ExportProjectNameModal', () => ({
  ExportProjectNameModal: (props: { isOpen: boolean }) =>
    props.isOpen ? <div data-testid="export-project-name-modal-open" /> : null,
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

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// Import after mocks
import { TopBar } from '../components/TopBar/TopBar';
import { renderWithRouter } from '../test-utils/renderWithProviders';

describe('TopBar Export Empty Toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIncludeDatabase = true;
    mockIncludeDelivery = true;
    mockLoadedFileName = null;
    capturedOnExportJson = null;
    capturedOnExportXlsx = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Task 3.1 Test 1: Opens project-name modal when Export JSON clicked with includeDatabase=false AND no project', () => {
    // Spec 2026-01-22 (Task Group 4): the empty-state toast was removed.
    // Export with no loadedFileName prompts for a project name instead.
    it('should open ExportProjectNameModal (not a toast) when Export JSON clicked in no-DB mode with no project', async () => {
      mockIncludeDatabase = false;
      mockLoadedFileName = null;

      renderWithRouter(<TopBar />);

      // Trigger export JSON via captured handler
      expect(capturedOnExportJson).not.toBeNull();
      capturedOnExportJson!();

      // The project-name modal opens; no empty-state toast appears.
      await waitFor(() => {
        expect(screen.getByTestId('export-project-name-modal-open')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('notification-toast')).not.toBeInTheDocument();
    });
  });

  describe('Task 3.1 Test 2: Opens project-name modal when Export XLSX clicked with includeDatabase=false AND no project', () => {
    it('should open ExportProjectNameModal (not a toast) when Export XLSX clicked in no-DB mode with no project', async () => {
      mockIncludeDatabase = false;
      mockLoadedFileName = null;

      renderWithRouter(<TopBar />);

      // Trigger export XLSX via captured handler
      expect(capturedOnExportXlsx).not.toBeNull();
      capturedOnExportXlsx!();

      // The project-name modal opens; no empty-state toast appears.
      await waitFor(() => {
        expect(screen.getByTestId('export-project-name-modal-open')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('notification-toast')).not.toBeInTheDocument();
    });
  });

  describe('Task 3.1 Test 3: Does NOT show toast when Export JSON clicked with project loaded', () => {
    it('should NOT show empty-state toast when project is loaded (has loadedFileName)', async () => {
      mockIncludeDatabase = false;
      mockLoadedFileName = 'MyProject';

      renderWithRouter(<TopBar />);

      // Trigger export JSON via captured handler
      expect(capturedOnExportJson).not.toBeNull();
      capturedOnExportJson!();

      // Give time for any async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify no toast with the empty-state message appears
      // (other toasts might appear for different reasons, so we check specifically for the message)
      const toast = screen.queryByTestId('notification-toast');
      if (toast) {
        expect(toast).not.toHaveTextContent('Nothing to export yet');
      }
    });
  });

  describe('Task 3.1 Test 4: Does NOT show toast when includeDatabase=true (DB mode)', () => {
    it('should NOT show empty-state toast when in DB mode even with no project', async () => {
      mockIncludeDatabase = true;
      mockLoadedFileName = null;

      renderWithRouter(<TopBar />);

      // Trigger export JSON via captured handler
      expect(capturedOnExportJson).not.toBeNull();
      capturedOnExportJson!();

      // Give time for any async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify no toast with the empty-state message appears
      const toast = screen.queryByTestId('notification-toast');
      if (toast) {
        expect(toast).not.toHaveTextContent('Nothing to export yet');
      }
    });
  });
});

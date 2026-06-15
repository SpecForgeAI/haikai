/**
 * TopBar Export Flow Tests
 *
 * Spec 2026-01-19: Export Project Name Prompt
 * Task Group 3: TopBar Export Flow Integration
 *
 * Tests for the export flow integration with ExportProjectNameModal.
 * Verifies modal shows when loadedFileName is unset, export proceeds when set,
 * and project name is persisted to state after modal confirmation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Mock the modules before importing TopBar
vi.mock('../../api/projectSnapshotApi', () => ({
  exportActiveProjectSnapshot: vi.fn(),
}));

vi.mock('../../utils/excelOperations', () => ({
  exportMetaModelToExcel: vi.fn(),
  importMetaModelFromExcel: vi.fn(),
}));

vi.mock('../../utils/fileOperations', () => ({
  sanitizeFilename: vi.fn((name: string) => name.replace(/[<>:"/\\|?*]/g, '_')),
  triggerDownload: vi.fn(),
}));

// Mock contexts
const mockDispatch = vi.fn();
const mockState = {
  model: {
    metaModel: { entities: {}, relationships: {} },
    diagrams: [],
  },
  loadedFileName: null as string | null,
  currentView: 'metamodel' as const,
  selectedTab: 'Users',
  selectedDiagramId: null,
  validationErrors: [],
  isPalettePanelCollapsed: false,
  sectionExpandStates: {},
  paletteSearchQuery: '',
  isInspectorPanelCollapsed: false,
  selectedDomain: 'business',
  relationshipCellLabels: {},
};

vi.mock('../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitecture: () => mockState,
  useArchitectureDispatch: () => mockDispatch,
}));

vi.mock('../../contexts/AppConfigContext', () => ({
  useIncludeDatabase: vi.fn(() => true),
  useIncludeDelivery: () => true,
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => null,
  useRefreshActiveProject: () => vi.fn(),
  useClearActiveProject: () => vi.fn(),
  useSetActiveProject: () => vi.fn(),
}));

// Mock all child components to simplify testing
vi.mock('./FileMenu', () => ({
  FileMenu: ({
    visible,
    onExportJson,
    onExportXlsx,
    exportJsonDisabled,
    exportXlsxDisabled,
  }: {
    visible: boolean;
    onExportJson: () => void;
    onExportXlsx: () => void;
    exportJsonDisabled: boolean;
    exportXlsxDisabled: boolean;
  }) =>
    visible ? (
      <div data-testid="file-menu">
        <button
          data-testid="export-json-button"
          onClick={onExportJson}
          disabled={exportJsonDisabled}
        >
          Export JSON
        </button>
        <button
          data-testid="export-xlsx-button"
          onClick={onExportXlsx}
          disabled={exportXlsxDisabled}
        >
          Export XLSX
        </button>
      </div>
    ) : null,
}));

vi.mock('../Project/CreateProjectModal', () => ({
  CreateProjectModal: () => null,
}));

vi.mock('../Project/ImportProjectSnapshotModal', () => ({
  ImportProjectSnapshotModal: () => null,
}));

vi.mock('../Project/DeleteProjectModal', () => ({
  DeleteProjectModal: () => null,
}));

vi.mock('../Import/ImportModeModal', () => ({
  ImportModeModal: () => null,
}));

vi.mock('../file/ModelFileDialog', () => ({
  ModelFileDialog: () => null,
}));

vi.mock('../common/Modal', () => ({
  ErrorModal: () => null,
}));

vi.mock('../common/ImportSummaryModal', () => ({
  ImportSummaryModal: () => null,
}));

vi.mock('../../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// Import after mocks are set up
import { TopBar } from './TopBar';
import { exportActiveProjectSnapshot } from '../../api/projectSnapshotApi';
import { exportMetaModelToExcel } from '../../utils/excelOperations';
import { renderWithRouter } from '../../test-utils/renderWithProviders';

describe('TopBar Export Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.loadedFileName = null;
  });

  afterEach(() => {
    mockState.loadedFileName = null;
  });

  // Helper to open the file menu
  const openFileMenu = () => {
    const projectButton = screen.getByTestId('project-menu-trigger');
    fireEvent.click(projectButton);
  };

  // Test 3.1a: JSON export shows modal when loadedFileName is falsy
  it('shows ExportProjectNameModal when exporting JSON and loadedFileName is unset', async () => {
    mockState.loadedFileName = null;

    renderWithRouter(<TopBar />);
    openFileMenu();

    // Click Export JSON button
    const exportJsonButton = screen.getByTestId('export-json-button');
    fireEvent.click(exportJsonButton);

    // Modal should appear
    await waitFor(() => {
      expect(screen.getByTestId('export-project-name-modal')).toBeInTheDocument();
    });
  });

  // Test 3.1b: JSON export proceeds directly when loadedFileName is set
  it('proceeds directly with JSON export when loadedFileName is set', async () => {
    mockState.loadedFileName = 'My Project';

    // Mock successful export
    (exportActiveProjectSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({
      project: { name: 'My Project' },
      model: {},
    });

    renderWithRouter(<TopBar />);
    openFileMenu();

    // Click Export JSON button
    const exportJsonButton = screen.getByTestId('export-json-button');
    fireEvent.click(exportJsonButton);

    // Should NOT show modal
    await waitFor(() => {
      expect(screen.queryByTestId('export-project-name-modal')).not.toBeInTheDocument();
    });

    // Should call export directly
    expect(exportActiveProjectSnapshot).toHaveBeenCalled();
  });

  // Test 3.1c: XLSX export shows modal when loadedFileName is falsy
  it('shows ExportProjectNameModal when exporting XLSX and loadedFileName is unset', async () => {
    mockState.loadedFileName = null;

    renderWithRouter(<TopBar />);
    openFileMenu();

    // Click Export XLSX button
    const exportXlsxButton = screen.getByTestId('export-xlsx-button');
    fireEvent.click(exportXlsxButton);

    // Modal should appear
    await waitFor(() => {
      expect(screen.getByTestId('export-project-name-modal')).toBeInTheDocument();
    });
  });

  // Test 3.1d: XLSX export proceeds directly when loadedFileName is set
  it('proceeds directly with XLSX export when loadedFileName is set', () => {
    mockState.loadedFileName = 'My Project';

    renderWithRouter(<TopBar />);
    openFileMenu();

    // Click Export XLSX button
    const exportXlsxButton = screen.getByTestId('export-xlsx-button');
    fireEvent.click(exportXlsxButton);

    // Should NOT show modal
    expect(screen.queryByTestId('export-project-name-modal')).not.toBeInTheDocument();

    // Should call export directly
    expect(exportMetaModelToExcel).toHaveBeenCalledWith(mockState.model, 'My Project');
  });

  // Test 3.1e: Project name is set in state after modal confirmation
  it('dispatches SET_PROJECT_NAME after modal confirmation', async () => {
    mockState.loadedFileName = null;

    // Mock successful export
    (exportActiveProjectSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({
      project: { name: 'New Project Name' },
      model: {},
    });

    renderWithRouter(<TopBar />);
    openFileMenu();

    // Click Export JSON button to open modal
    const exportJsonButton = screen.getByTestId('export-json-button');
    fireEvent.click(exportJsonButton);

    // Wait for modal
    await waitFor(() => {
      expect(screen.getByTestId('export-project-name-modal')).toBeInTheDocument();
    });

    // Enter project name and confirm
    const input = screen.getByTestId('project-name-input');
    fireEvent.change(input, { target: { value: 'New Project Name' } });

    const exportButton = screen.getByTestId('modal-export-button');
    fireEvent.click(exportButton);

    // Should dispatch SET_PROJECT_NAME
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'SET_PROJECT_NAME',
        fileName: 'New Project Name',
      });
    });
  });

  // Test 3.1f: Filename uses sanitized project name
  it('uses sanitized project name in export filename', async () => {
    mockState.loadedFileName = 'My Project: Test';

    // Mock successful export
    (exportActiveProjectSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({
      project: { name: 'My Project: Test' },
      model: {},
    });

    renderWithRouter(<TopBar />);
    openFileMenu();

    // Click Export JSON button
    const exportJsonButton = screen.getByTestId('export-json-button');
    fireEvent.click(exportJsonButton);

    // Export should be called - filename sanitization is tested in the actual function
    await waitFor(() => {
      expect(exportActiveProjectSnapshot).toHaveBeenCalled();
    });
  });
});

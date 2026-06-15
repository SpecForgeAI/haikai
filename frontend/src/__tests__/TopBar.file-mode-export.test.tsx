/**
 * TopBar File Mode Export Tests
 *
 * Spec 2026-01-22: File Mode JSON Export/Import Fix
 * Task Group 1: Fix File Mode JSON Export
 *
 * Tests cover:
 * 1. buildLocalSnapshot includes current ArchitectureContext model state
 * 2. executeJsonExport uses local snapshot when includeDatabase=false
 * 3. executeJsonExport uses backend endpoint when includeDatabase=true
 * 4. Exported JSON contains correct meta fields (version, exported_at, export_kind)
 * 5. buildLocalSnapshot uses activeProject when available
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Track mock values for dynamic control
let mockIncludeDatabase = false;
let mockActiveProject: { id: string; name: string } | null = null;

// Mock model data for testing
const mockModelData = {
  metaModel: {
    entities: {
      business_users: [{ id: 'bu-1', name: 'Business User 1' }],
      applications: [],
      app_components: [],
      services: [],
      business_processes: [],
      process_activities: [],
      interfaces: [],
      endpoints: [],
      application_points: [],
      business_points: [],
      app_business_points: [],
      logical_data_entities: [],
      physical_data_entities: [],
      logical_data_attributes: [],
      physical_data_attributes: [],
      interactions: [],
      data_entity_points: [],
      sequence_diagrams: [],
    },
    relationships: {
      interface_logical_entities: [],
    },
  },
  diagrams: [{ id: 'diag-1', name: 'Test Diagram' }],
};

// Mock AppConfigContext hooks
vi.mock('../contexts/AppConfigContext', () => ({
  useIncludeDelivery: () => true,
  useIncludeDatabase: () => mockIncludeDatabase,
}));

// Mock ArchitectureContext - include all hooks used by TopBar
const mockDispatch = vi.fn();
const mockState = {
  model: mockModelData,
  loadedFileName: 'test-project',
  currentView: 'metamodel' as const,
};
vi.mock('../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitecture: () => mockState,
  useArchitectureDispatch: () => mockDispatch,
  useArchitectureContext: () => ({ state: mockState, dispatch: mockDispatch }),
}));

// Mock ProjectContext
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => mockActiveProject,
  useRefreshActiveProject: () => vi.fn(),
  useClearActiveProject: () => vi.fn(),
  useSetActiveProject: () => vi.fn(),
}));

// Mock API modules
const mockExportActiveProjectSnapshot = vi.fn();
const mockExportSessionSnapshot = vi.fn();

vi.mock('../api/projectSnapshotApi', () => ({
  exportActiveProjectSnapshot: () => mockExportActiveProjectSnapshot(),
  importProjectSnapshot: vi.fn(),
}));

vi.mock('../api/projectSessionApi', () => ({
  exportSessionSnapshot: () => mockExportSessionSnapshot(),
  importToSession: vi.fn(),
}));

vi.mock('../api/modelApi', () => ({
  loadModelByFilename: vi.fn(),
}));

vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual('../api/projectsApi');
  return {
    ...actual,
    createProject: vi.fn(),
  listProjects: vi.fn(),
  deleteProject: vi.fn(),
  };
});

vi.mock('../api/organisationsApi', async () => {
  const actual = await vi.importActual('../api/organisationsApi');
  return {
    ...actual,
    listOrganisations: vi.fn().mockResolvedValue([]),
  createOrganisation: vi.fn(),
  };
});

// Mock utility modules
vi.mock('../utils/saveUtils', () => ({
  saveModelToBackend: vi.fn(),
}));

vi.mock('../utils/excelOperations', () => ({
  exportMetaModelToExcel: vi.fn(),
  importMetaModelFromExcel: vi.fn(),
}));

// Track calls to triggerDownload to verify exported content
const mockTriggerDownload = vi.fn();
vi.mock('../utils/fileOperations', () => ({
  sanitizeFilename: vi.fn((name) => name),
  triggerDownload: (content: string, filename: string) => mockTriggerDownload(content, filename),
}));

// Import after mocks
import { TopBar } from '../components/TopBar/TopBar';
import { renderWithRouter } from '../test-utils/renderWithProviders';

describe('TopBar File Mode Export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIncludeDatabase = false; // Default to File Mode
    mockActiveProject = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Task 1.1: buildLocalSnapshot includes current ArchitectureContext model state', () => {
    it('should export snapshot containing Business User entity from current UI state', async () => {
      mockIncludeDatabase = false;

      renderWithRouter(<TopBar />);

      // Open the Project menu
      const menuButton = screen.getByTestId('project-menu-trigger');
      fireEvent.click(menuButton);

      // Click Export as JSON
      const exportJsonItem = screen.getByTestId('project-menu-export-json');
      fireEvent.click(exportJsonItem);

      // Wait for export to complete
      await waitFor(() => {
        expect(mockTriggerDownload).toHaveBeenCalled();
      });

      // Parse the exported JSON
      const exportedJson = mockTriggerDownload.mock.calls[0][0];
      const snapshot = JSON.parse(exportedJson);

      // Verify the model contains the Business User entity from mockModelData
      expect(snapshot.model).toBeDefined();
      expect(snapshot.model.metaModel.entities.business_users).toEqual([
        { id: 'bu-1', name: 'Business User 1' },
      ]);
    });

    it('should export snapshot containing diagrams from current UI state', async () => {
      mockIncludeDatabase = false;

      renderWithRouter(<TopBar />);

      // Open the Project menu
      const menuButton = screen.getByTestId('project-menu-trigger');
      fireEvent.click(menuButton);

      // Click Export as JSON
      const exportJsonItem = screen.getByTestId('project-menu-export-json');
      fireEvent.click(exportJsonItem);

      // Wait for export to complete
      await waitFor(() => {
        expect(mockTriggerDownload).toHaveBeenCalled();
      });

      // Parse the exported JSON
      const exportedJson = mockTriggerDownload.mock.calls[0][0];
      const snapshot = JSON.parse(exportedJson);

      // Verify the model contains the diagrams array
      expect(snapshot.model.diagrams).toEqual([{ id: 'diag-1', name: 'Test Diagram' }]);
    });
  });

  describe('Task 1.2: executeJsonExport uses local snapshot when includeDatabase=false', () => {
    it('should NOT call backend export endpoint in File Mode', async () => {
      mockIncludeDatabase = false;

      renderWithRouter(<TopBar />);

      // Open the Project menu
      const menuButton = screen.getByTestId('project-menu-trigger');
      fireEvent.click(menuButton);

      // Click Export as JSON
      const exportJsonItem = screen.getByTestId('project-menu-export-json');
      fireEvent.click(exportJsonItem);

      // Wait for export to complete
      await waitFor(() => {
        expect(mockTriggerDownload).toHaveBeenCalled();
      });

      // Verify backend endpoint was NOT called
      expect(mockExportActiveProjectSnapshot).not.toHaveBeenCalled();
      // Session endpoint should also NOT be called since we build locally
      expect(mockExportSessionSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('Task 1.3: executeJsonExport uses backend endpoint when includeDatabase=true', () => {
    it('should call backend export endpoint in DB Mode', async () => {
      mockIncludeDatabase = true;
      mockExportActiveProjectSnapshot.mockResolvedValue({
        meta: { snapshot_version: 1, exported_at: '2026-01-22T12:00:00Z', export_kind: 'active' },
        project: { id: 'proj-1', name: 'DB Project' },
        model: mockModelData,
        work_items: [],
        artifacts: [],
      });

      renderWithRouter(<TopBar />);

      // Open the Project menu
      const menuButton = screen.getByTestId('project-menu-trigger');
      fireEvent.click(menuButton);

      // Click Export as JSON
      const exportJsonItem = screen.getByTestId('project-menu-export-json');
      fireEvent.click(exportJsonItem);

      // Wait for export to complete
      await waitFor(() => {
        expect(mockExportActiveProjectSnapshot).toHaveBeenCalled();
      });
    });
  });

  describe('Task 1.4: Exported JSON contains correct meta fields', () => {
    it('should include snapshot_version: 1 in exported JSON', async () => {
      mockIncludeDatabase = false;

      renderWithRouter(<TopBar />);

      const menuButton = screen.getByTestId('project-menu-trigger');
      fireEvent.click(menuButton);

      const exportJsonItem = screen.getByTestId('project-menu-export-json');
      fireEvent.click(exportJsonItem);

      await waitFor(() => {
        expect(mockTriggerDownload).toHaveBeenCalled();
      });

      const exportedJson = mockTriggerDownload.mock.calls[0][0];
      const snapshot = JSON.parse(exportedJson);

      expect(snapshot.meta.snapshot_version).toBe(1);
    });

    it('should include exported_at timestamp in exported JSON', async () => {
      mockIncludeDatabase = false;

      renderWithRouter(<TopBar />);

      const menuButton = screen.getByTestId('project-menu-trigger');
      fireEvent.click(menuButton);

      const exportJsonItem = screen.getByTestId('project-menu-export-json');
      fireEvent.click(exportJsonItem);

      await waitFor(() => {
        expect(mockTriggerDownload).toHaveBeenCalled();
      });

      const exportedJson = mockTriggerDownload.mock.calls[0][0];
      const snapshot = JSON.parse(exportedJson);

      expect(snapshot.meta.exported_at).toBeDefined();
      // Verify it's a valid ISO timestamp
      expect(new Date(snapshot.meta.exported_at).getTime()).not.toBeNaN();
    });

    it('should include export_kind: session in exported JSON', async () => {
      mockIncludeDatabase = false;

      renderWithRouter(<TopBar />);

      const menuButton = screen.getByTestId('project-menu-trigger');
      fireEvent.click(menuButton);

      const exportJsonItem = screen.getByTestId('project-menu-export-json');
      fireEvent.click(exportJsonItem);

      await waitFor(() => {
        expect(mockTriggerDownload).toHaveBeenCalled();
      });

      const exportedJson = mockTriggerDownload.mock.calls[0][0];
      const snapshot = JSON.parse(exportedJson);

      expect(snapshot.meta.export_kind).toBe('session');
    });
  });

  describe('Task 1.5: buildLocalSnapshot uses activeProject when available', () => {
    it('should use activeProject data when available', async () => {
      mockIncludeDatabase = false;
      mockActiveProject = {
        id: 'active-proj-id',
        name: 'Active Project Name',
      };

      renderWithRouter(<TopBar />);

      const menuButton = screen.getByTestId('project-menu-trigger');
      fireEvent.click(menuButton);

      const exportJsonItem = screen.getByTestId('project-menu-export-json');
      fireEvent.click(exportJsonItem);

      await waitFor(() => {
        expect(mockTriggerDownload).toHaveBeenCalled();
      });

      const exportedJson = mockTriggerDownload.mock.calls[0][0];
      const snapshot = JSON.parse(exportedJson);

      // Should use active project data
      expect(snapshot.project.id).toBe('active-proj-id');
      expect(snapshot.project.name).toBe('Active Project Name');
    });

    it('should synthesize project data when no activeProject', async () => {
      mockIncludeDatabase = false;
      mockActiveProject = null;

      renderWithRouter(<TopBar />);

      const menuButton = screen.getByTestId('project-menu-trigger');
      fireEvent.click(menuButton);

      const exportJsonItem = screen.getByTestId('project-menu-export-json');
      fireEvent.click(exportJsonItem);

      await waitFor(() => {
        expect(mockTriggerDownload).toHaveBeenCalled();
      });

      const exportedJson = mockTriggerDownload.mock.calls[0][0];
      const snapshot = JSON.parse(exportedJson);

      // Should have synthesized project with valid UUID and name from loadedFileName
      expect(snapshot.project.id).toBeDefined();
      expect(snapshot.project.name).toBe('test-project');
      // Note: The property is camelCase (isActive) not snake_case (is_active) in frontend code
      expect(snapshot.project.isActive).toBe(true);
    });
  });
});

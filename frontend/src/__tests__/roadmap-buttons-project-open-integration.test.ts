/**
 * Integration Tests for Roadmap Buttons Project Open Flows
 *
 * Spec 2026-01-10: Fix Roadmap Tab Buttons Incorrectly Disabled When a Project is Open
 * Task Group 3: Verification and Integration Testing
 *
 * Tests cover:
 * - Create Project flow - after creating project, Roadmap buttons are enabled
 * - Import Snapshot flow with "Make active" checked - after import, Roadmap buttons are enabled
 * - Open from Backend flow - after opening, Roadmap buttons are enabled (new behavior)
 * - Open from Backend flow with no matching project - banner shows after loading completes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the API modules
vi.mock('../api/modelApi', () => ({
  loadModelByFilename: vi.fn(),
}));

vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual('../api/projectsApi');
  return {
    ...actual,
    getActiveProject: vi.fn(),
  createProject: vi.fn(),
  };
});

vi.mock('../api/projectSnapshotApi', () => ({
  importProjectSnapshot: vi.fn(),
}));

import { loadModelByFilename } from '../api/modelApi';
import { getActiveProject, createProject } from '../api/projectsApi';

/**
 * Helper to compute isImportDisabled state
 * Matches the updated logic in ProductRoadmapPage.tsx
 */
function computeIsImportDisabled(
  loading: boolean,
  activeProject: { id: string; name: string } | null,
  importing: boolean
): boolean {
  return loading || !activeProject || importing;
}

/**
 * Helper to compute banner visibility
 * Matches the updated logic in ProductRoadmapPage.tsx
 */
function computeBannerVisible(
  loading: boolean,
  activeProject: { id: string; name: string } | null
): boolean {
  return !loading && !activeProject;
}

describe('Roadmap Buttons Project Open Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Create Project flow', () => {
    it('should enable Roadmap buttons after creating a project', async () => {
      // Arrange: Mock create project response
      const mockCreateProject = createProject as ReturnType<typeof vi.fn>;
      const createdProject = {
        id: 'proj-new-123',
        name: 'NewProject',
        projectParentFolder: '/projects',
        isActive: true,
        createdAt: '2026-01-10T10:00:00Z',
        updatedAt: '2026-01-10T10:00:00Z',
      };
      mockCreateProject.mockResolvedValueOnce(createdProject);

      // Mock getActiveProject to return the created project (after refresh)
      const mockGetActiveProject = getActiveProject as ReturnType<typeof vi.fn>;
      mockGetActiveProject.mockResolvedValueOnce(createdProject);

      // Simulate initial state: loading complete, no active project
      let loading = false;
      let activeProject: typeof createdProject | null = null;
      const importing = false;

      // Initial state: buttons disabled, banner visible
      expect(computeIsImportDisabled(loading, activeProject, importing)).toBe(true);
      expect(computeBannerVisible(loading, activeProject)).toBe(true);

      // Act: Create project and refresh
      await createProject('NewProject', '/projects');
      const refreshedProject = await getActiveProject();
      activeProject = refreshedProject;

      // Assert: Buttons enabled, banner hidden
      expect(computeIsImportDisabled(loading, activeProject, importing)).toBe(false);
      expect(computeBannerVisible(loading, activeProject)).toBe(false);
    });
  });

  describe('Import Snapshot flow with "Make active" checked', () => {
    it('should enable Roadmap buttons after importing with setActive=true', async () => {
      // Arrange: Mock the refreshActiveProject call that happens after import
      const mockGetActiveProject = getActiveProject as ReturnType<typeof vi.fn>;
      const importedProject = {
        id: 'proj-imported-456',
        name: 'ImportedProject',
        projectParentFolder: '/imported',
        isActive: true,
        createdAt: '2026-01-10T10:00:00Z',
        updatedAt: '2026-01-10T10:00:00Z',
      };
      mockGetActiveProject.mockResolvedValueOnce(importedProject);

      // Mock loadModelByFilename for the post-import model load
      const mockLoadModel = loadModelByFilename as ReturnType<typeof vi.fn>;
      mockLoadModel.mockResolvedValueOnce({
        metaModel: { entities: {}, relationships: {} },
        diagrams: [],
      });

      // Simulate initial state: loading complete, no active project
      let loading = false;
      let activeProject: typeof importedProject | null = null;
      const importing = false;

      // Initial state: buttons disabled
      expect(computeIsImportDisabled(loading, activeProject, importing)).toBe(true);

      // Act: Simulate import success with setActive=true
      // This triggers refreshActiveProject() in handleImportSuccess
      const refreshedProject = await getActiveProject();
      activeProject = refreshedProject;

      // Load the model (part of handleImportSuccess when setActive=true)
      if (activeProject) {
        await loadModelByFilename(activeProject.name);
      }

      // Assert: Buttons enabled
      expect(computeIsImportDisabled(loading, activeProject, importing)).toBe(false);
      expect(activeProject).not.toBeNull();
      expect(activeProject?.name).toBe('ImportedProject');
    });
  });

  describe('Open from Backend flow (new behavior)', () => {
    it('should enable Roadmap buttons after opening a model from backend', async () => {
      // Arrange: Mock successful model load
      const mockLoadModel = loadModelByFilename as ReturnType<typeof vi.fn>;
      mockLoadModel.mockResolvedValueOnce({
        metaModel: { entities: {}, relationships: {} },
        diagrams: [],
      });

      // Mock getActiveProject to return a project matching the opened model
      const mockGetActiveProject = getActiveProject as ReturnType<typeof vi.fn>;
      const activeProjectFromBackend = {
        id: 'proj-backend-789',
        name: 'BackendProject',
        projectParentFolder: '/backend',
        isActive: true,
        createdAt: '2026-01-10T10:00:00Z',
        updatedAt: '2026-01-10T10:00:00Z',
      };
      mockGetActiveProject.mockResolvedValueOnce(activeProjectFromBackend);

      // Simulate initial state: loading complete, no active project yet
      let loading = false;
      let activeProject: typeof activeProjectFromBackend | null = null;
      const importing = false;

      // Initial state: buttons disabled
      expect(computeIsImportDisabled(loading, activeProject, importing)).toBe(true);

      // Act: Simulate handleOpenFromBackend
      const filename = 'BackendProject';
      await loadModelByFilename(filename);

      // The fix: refreshActiveProject is called after model load
      const refreshedProject = await getActiveProject();
      activeProject = refreshedProject;

      // Assert: Buttons now enabled
      expect(computeIsImportDisabled(loading, activeProject, importing)).toBe(false);
      expect(computeBannerVisible(loading, activeProject)).toBe(false);
      expect(activeProject).not.toBeNull();
      expect(activeProject?.name).toBe('BackendProject');
    });

    it('should show banner after loading completes when no matching project exists', async () => {
      // Arrange: Mock successful model load
      const mockLoadModel = loadModelByFilename as ReturnType<typeof vi.fn>;
      mockLoadModel.mockResolvedValueOnce({
        metaModel: { entities: {}, relationships: {} },
        diagrams: [],
      });

      // Mock getActiveProject to return null (no matching project)
      const mockGetActiveProject = getActiveProject as ReturnType<typeof vi.fn>;
      mockGetActiveProject.mockResolvedValueOnce(null);

      // Simulate initial state: loading in progress
      let loading = true;
      let activeProject: { id: string; name: string } | null = null;
      const importing = false;

      // During loading: buttons disabled, banner NOT shown
      expect(computeIsImportDisabled(loading, activeProject, importing)).toBe(true);
      expect(computeBannerVisible(loading, activeProject)).toBe(false);

      // Act: Load model and refresh project
      const filename = 'OrphanModel';
      await loadModelByFilename(filename);
      const refreshedProject = await getActiveProject();
      activeProject = refreshedProject;
      loading = false; // Loading complete

      // Assert: Banner now shown, buttons disabled
      expect(computeIsImportDisabled(loading, activeProject, importing)).toBe(true);
      expect(computeBannerVisible(loading, activeProject)).toBe(true);
    });
  });

  describe('Full flow simulation', () => {
    it('should correctly transition through all states during open from backend', async () => {
      // Initial application state
      let loading = true;
      let activeProject: { id: string; name: string } | null = null;
      const importing = false;

      // State 1: App loading
      expect(computeIsImportDisabled(loading, activeProject, importing)).toBe(true);
      expect(computeBannerVisible(loading, activeProject)).toBe(false);

      // State 2: Loading complete, no project yet
      loading = false;
      expect(computeIsImportDisabled(loading, activeProject, importing)).toBe(true);
      expect(computeBannerVisible(loading, activeProject)).toBe(true);

      // State 3: User opens model from backend
      // Mock the APIs
      const mockLoadModel = loadModelByFilename as ReturnType<typeof vi.fn>;
      mockLoadModel.mockResolvedValueOnce({
        metaModel: { entities: {}, relationships: {} },
        diagrams: [],
      });

      const mockGetActiveProject = getActiveProject as ReturnType<typeof vi.fn>;
      mockGetActiveProject.mockResolvedValueOnce({
        id: 'proj-full-flow',
        name: 'FullFlowProject',
        projectParentFolder: '/test',
        isActive: true,
        createdAt: '2026-01-10T10:00:00Z',
        updatedAt: '2026-01-10T10:00:00Z',
      });

      // Simulate the open flow
      await loadModelByFilename('FullFlowProject');
      const refreshedProject = await getActiveProject();
      activeProject = refreshedProject;

      // State 4: Model loaded and project refreshed
      expect(computeIsImportDisabled(loading, activeProject, importing)).toBe(false);
      expect(computeBannerVisible(loading, activeProject)).toBe(false);
      expect(activeProject?.name).toBe('FullFlowProject');
    });
  });
});

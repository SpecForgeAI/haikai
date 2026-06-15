/**
 * Tests for LandingPage Direct Load (Flow A)
 *
 * Spec 2026-03-05: Import Product Snapshot Redesign
 * Task Group 3: LandingPage Direct Load (No Active Project)
 *
 * 4 focused tests covering:
 * 1. Valid JSON file triggers LOAD_MODEL dispatch without opening any modal
 * 2. importProjectSnapshot (DB mode) is called with implicit setActive: true and overwriteExistingProject: true
 * 3. importToSession (File Mode) is called instead of importProjectSnapshot when includeDatabase is false
 * 4. Invalid JSON file shows inline error message on LandingPage (uses existing errorMessage state)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ============================================================================
// Mock control variables
// ============================================================================

let mockIncludeDatabase = true;

// ============================================================================
// Mock snapshot data
// ============================================================================

const validSnapshot = {
  project: {
    id: 'proj-1',
    name: 'Test Project',
    projectParentFolder: '/test',
    projectHierarchy: null,
    organisationId: null,
    isActive: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  meta: { snapshot_version: 1, exported_at: '2026-01-01', export_kind: 'full' },
  model: {
    metaModel: {
      entities: {
        applications: [{ id: 'a1', name: 'App 1' }],
      },
      relationships: {},
    },
    diagrams: [],
  },
  work_items: [],
  artifacts: [],
};

// ============================================================================
// Mocks
// ============================================================================

// Mock AppConfigContext
vi.mock('../contexts/AppConfigContext', () => ({
  useIncludeDatabase: () => mockIncludeDatabase,
}));

// Mock ArchitectureContext - track dispatch calls
const mockDispatch = vi.fn();
vi.mock('../contexts/ArchitectureContext', () => ({
  useArchitectureDispatch: () => mockDispatch,
}));

// Mock ProjectContext
const mockRefreshActiveProject = vi.fn().mockResolvedValue(undefined);
const mockSetActiveProject = vi.fn();
vi.mock('../contexts/ProjectContext', () => ({
  useRefreshActiveProject: () => mockRefreshActiveProject,
  useSetActiveProject: () => mockSetActiveProject,
}));

// Mock API: importProjectSnapshot (DB mode)
const mockImportProjectSnapshot = vi.fn().mockResolvedValue({
  project: validSnapshot.project,
  modelSaved: true,
  workItemsInserted: 0,
  artifactsInserted: 0,
  warnings: [],
});
vi.mock('../api/projectSnapshotApi', () => ({
  importProjectSnapshot: (...args: unknown[]) => mockImportProjectSnapshot(...args),
}));

// Mock API: importToSession (File mode)
const mockImportToSession = vi.fn().mockResolvedValue({
  project: validSnapshot.project,
  modelSaved: true,
  workItemsInserted: 0,
  artifactsInserted: 0,
  warnings: [],
});
vi.mock('../api/projectSessionApi', () => ({
  importToSession: (...args: unknown[]) => mockImportToSession(...args),
}));

// Mock API: other project APIs used by LandingPage
vi.mock('../api/projectsApi', () => ({
  activateProject: vi.fn(),
}));
vi.mock('../api/modelApi', () => ({
  loadModelByProjectId: vi.fn(),
  loadModelByFilename: vi.fn(),
}));

// Mock child components that LandingPage renders (CreateProjectModal, ModelFileDialog)
vi.mock('../components/Project/CreateProjectModal', () => ({
  CreateProjectModal: () => null,
}));
vi.mock('../components/file/ModelFileDialog', () => ({
  ModelFileDialog: () => null,
  isOpenProjectResult: () => false,
}));

// ============================================================================
// Helper: simulate file selection via fireEvent.change on the file input
// ============================================================================

/**
 * Creates a File object with the given content and triggers a change event
 * on the file input element. jsdom does not support programmatic value setting
 * on file inputs, so we construct the event target with a files array.
 */
function simulateFileSelection(fileInput: HTMLElement, content: string, fileName = 'test.json') {
  const file = new File([content], fileName, { type: 'application/json' });
  // fireEvent.change works with the file input when we provide a target with files
  fireEvent.change(fileInput, { target: { files: [file] } });
}

// ============================================================================
// Import component under test (after mocks are defined)
// ============================================================================

import { LandingPage } from '../components/LandingPage/LandingPage';

// ============================================================================
// Tests
// ============================================================================

describe('LandingPage Direct Load (Flow A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIncludeDatabase = true;
  });

  // --------------------------------------------------------------------------
  // Test 1: Valid JSON triggers LOAD_MODEL dispatch without opening any modal
  // --------------------------------------------------------------------------
  it('dispatches LOAD_MODEL without opening any modal when a valid JSON file is selected', async () => {
    render(<LandingPage />);

    const fileInput = screen.getByTestId('landing-json-file-input');
    simulateFileSelection(fileInput, JSON.stringify(validSnapshot));

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LOAD_MODEL',
          payload: validSnapshot.model,
          fileName: 'Test Project',
        })
      );
    });

    // No modal should be rendered -- ImportProjectSnapshotModal has been removed
    expect(screen.queryByTestId('import-snapshot-modal')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 2: DB mode calls importProjectSnapshot with setActive and overwrite
  // --------------------------------------------------------------------------
  it('calls importProjectSnapshot with setActive: true and overwriteExistingProject: true in DB mode', async () => {
    mockIncludeDatabase = true;

    render(<LandingPage />);

    const fileInput = screen.getByTestId('landing-json-file-input');
    simulateFileSelection(fileInput, JSON.stringify(validSnapshot));

    await waitFor(() => {
      expect(mockImportProjectSnapshot).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockImportProjectSnapshot.mock.calls[0][0];
    expect(callArgs.snapshot).toEqual(validSnapshot);
    expect(callArgs.setActive).toBe(true);
    expect(callArgs.overwriteExistingProject).toBe(true);

    // importToSession should NOT have been called
    expect(mockImportToSession).not.toHaveBeenCalled();

    // refreshActiveProject should be called after successful import
    await waitFor(() => {
      expect(mockRefreshActiveProject).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Test 3: File mode calls importToSession instead of importProjectSnapshot
  // --------------------------------------------------------------------------
  it('calls importToSession instead of importProjectSnapshot when includeDatabase is false', async () => {
    mockIncludeDatabase = false;

    render(<LandingPage />);

    const fileInput = screen.getByTestId('landing-json-file-input');
    simulateFileSelection(fileInput, JSON.stringify(validSnapshot));

    await waitFor(() => {
      expect(mockImportToSession).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockImportToSession.mock.calls[0][0];
    expect(callArgs.snapshot).toEqual(validSnapshot);
    expect(callArgs.setActive).toBe(true);
    expect(callArgs.overwriteExistingProject).toBe(true);

    // importProjectSnapshot should NOT have been called
    expect(mockImportProjectSnapshot).not.toHaveBeenCalled();

    // refreshActiveProject should be called after successful import
    await waitFor(() => {
      expect(mockRefreshActiveProject).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Test 4: Invalid JSON shows inline error message
  // --------------------------------------------------------------------------
  it('shows inline error message on LandingPage when invalid JSON file is selected', async () => {
    render(<LandingPage />);

    const fileInput = screen.getByTestId('landing-json-file-input');
    // A JSON object missing required fields (no project, no meta, no model)
    simulateFileSelection(fileInput, JSON.stringify({ foo: 'bar' }));

    await waitFor(() => {
      const errorElement = screen.getByTestId('landing-error');
      expect(errorElement).toBeInTheDocument();
      expect(errorElement.textContent).toContain('Invalid snapshot file');
    });

    // No dispatch should have been called
    expect(mockDispatch).not.toHaveBeenCalled();
    // No API calls
    expect(mockImportProjectSnapshot).not.toHaveBeenCalled();
    expect(mockImportToSession).not.toHaveBeenCalled();
  });
});

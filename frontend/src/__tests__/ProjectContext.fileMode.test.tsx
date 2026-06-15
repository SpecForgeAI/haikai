/**
 * Tests for ProjectContext File Mode resilience
 *
 * Spec 2026-01-26: Activate Project on Open
 * Task Group 2: ProjectContext setActiveProject Method
 *
 * Tests:
 * - File Mode doesn't fail on missing session project (404)
 * - File Mode preserves state set via setActiveProject after refresh
 */

import React from 'react';
import { screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ProjectProvider,
  useProject,
  useActiveProjectSource,
  useSetActiveProject,
  useRefreshActiveProject,
} from '../contexts/ProjectContext';
import { getSessionProject } from '../api/projectSessionApi';
import { renderWithRouter } from '../test-utils/renderWithProviders';

// Track mock value for dynamic control - File Mode
let mockIncludeDatabase = false;

// Mock AppConfigContext hooks
vi.mock('../contexts/AppConfigContext', () => ({
  useIncludeDelivery: () => true,
  useIncludeDatabase: () => mockIncludeDatabase,
  AppConfigProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock the API functions
vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual('../api/projectsApi');
  return {
    ...actual,
    getActiveProject: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('../api/projectSessionApi', () => ({
  getSessionProject: vi.fn(),
}));

const mockGetSessionProject = vi.mocked(getSessionProject);

// Test component that uses the context hooks
function TestConsumer() {
  const project = useProject();
  const source = useActiveProjectSource();
  const setActiveProject = useSetActiveProject();
  const refreshActiveProject = useRefreshActiveProject();

  return (
    <div>
      <span data-testid="project-name">{project?.name || 'null'}</span>
      <span data-testid="project-source">{source}</span>
      <button
        data-testid="set-project-btn"
        onClick={() =>
          setActiveProject({
            id: 'file-mode-id',
            name: 'File Mode Project',
            projectParentFolder: '/local/path',
            projectHierarchy: null,
            organisationId: null,
            isActive: true,
            createdAt: '2026-01-26T00:00:00Z',
            updatedAt: '2026-01-26T00:00:00Z',
          })
        }
      >
        Set Project
      </button>
      <button
        data-testid="refresh-btn"
        onClick={() => refreshActiveProject()}
      >
        Refresh
      </button>
    </div>
  );
}

describe('ProjectContext.fileMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // File Mode for all tests
    mockIncludeDatabase = false;
  });

  afterEach(() => {
    // Cleanup
    mockIncludeDatabase = false;
  });

  describe('File Mode graceful 404 handling', () => {
    it('does not fail on 404 during initialization', async () => {
      // Mock 404 error from session endpoint
      mockGetSessionProject.mockRejectedValue(new Error('404 Not Found'));

      renderWithRouter(
        <ProjectProvider>
          <TestConsumer />
        </ProjectProvider>
      );

      // Wait for initial load to complete
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Should not crash, state should be null/none
      expect(screen.getByTestId('project-name').textContent).toBe('null');
      expect(screen.getByTestId('project-source').textContent).toBe('none');
    });

    it('preserves state set via setActiveProject when refresh fails with 404', async () => {
      // First call succeeds (init), subsequent calls fail with 404
      mockGetSessionProject
        .mockResolvedValueOnce(null) // Initial load returns null
        .mockRejectedValue(new Error('404 Not Found')); // Subsequent calls fail

      renderWithRouter(
        <ProjectProvider>
          <TestConsumer />
        </ProjectProvider>
      );

      // Wait for initial load
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Set a project via setActiveProject (simulating open flow)
      await act(async () => {
        screen.getByTestId('set-project-btn').click();
      });

      // Verify project is set
      expect(screen.getByTestId('project-name').textContent).toBe('File Mode Project');
      expect(screen.getByTestId('project-source').textContent).toBe('session');

      // Now try to refresh (which will fail with 404)
      await act(async () => {
        screen.getByTestId('refresh-btn').click();
      });

      // Wait for refresh to complete
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // State should be preserved (not cleared to null)
      expect(screen.getByTestId('project-name').textContent).toBe('File Mode Project');
      expect(screen.getByTestId('project-source').textContent).toBe('session');
    });
  });

  describe('File Mode successful session loading', () => {
    it('loads session project when available', async () => {
      const mockProject = {
        id: 'session-proj-id',
        name: 'Session Project',
        projectParentFolder: '/session/path',
        projectHierarchy: null,
        organisationId: null,
        isActive: true,
        createdAt: '2026-01-26T00:00:00Z',
        updatedAt: '2026-01-26T00:00:00Z',
      };

      mockGetSessionProject.mockResolvedValue(mockProject);

      renderWithRouter(
        <ProjectProvider>
          <TestConsumer />
        </ProjectProvider>
      );

      // Wait for initial load
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Should load the session project
      expect(screen.getByTestId('project-name').textContent).toBe('Session Project');
      expect(screen.getByTestId('project-source').textContent).toBe('session');
    });
  });
});

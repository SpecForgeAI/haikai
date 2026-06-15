/**
 * Tests for ProjectContext setActiveProject functionality
 *
 * Spec 2026-01-26: Activate Project on Open
 * Task Group 2: ProjectContext setActiveProject Method
 *
 * Tests:
 * - setActiveProject updates the activeProject state
 * - setActiveProject sets source to 'db' when includeDatabase=true
 * - setActiveProject sets source to 'session' when includeDatabase=false
 * - useSetActiveProject hook returns the function
 * - useSetActiveProject throws when used outside ProjectProvider
 */

import React from 'react';
import { screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ProjectProvider,
  useProject,
  useActiveProjectSource,
  useSetActiveProject,
} from '../contexts/ProjectContext';
import { ProjectDto } from '../api/projectsApi';
import { renderWithRouter } from '../test-utils/renderWithProviders';

// Track mock value for dynamic control
let mockIncludeDatabase = true;

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
  getSessionProject: vi.fn().mockResolvedValue(null),
}));

// Test component that uses the context hooks
function TestConsumer() {
  const project = useProject();
  const source = useActiveProjectSource();
  const setActiveProject = useSetActiveProject();

  return (
    <div>
      <span data-testid="project-name">{project?.name || 'null'}</span>
      <span data-testid="project-source">{source}</span>
      <button
        data-testid="set-project-btn"
        onClick={() =>
          setActiveProject({
            id: 'test-id',
            name: 'Test Project',
            projectParentFolder: '/test/path',
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
    </div>
  );
}

describe('ProjectContext.setActiveProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default value
    mockIncludeDatabase = true;
  });

  afterEach(() => {
    // Cleanup
    mockIncludeDatabase = true;
  });

  describe('setActiveProject updates state', () => {
    it('updates the activeProject state when called', async () => {
      mockIncludeDatabase = true;

      renderWithRouter(
        <ProjectProvider>
          <TestConsumer />
        </ProjectProvider>
      );

      // Wait for initial load to complete
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Initial state should be null
      expect(screen.getByTestId('project-name').textContent).toBe('null');

      // Click the button to set the project
      await act(async () => {
        screen.getByTestId('set-project-btn').click();
      });

      // Project should now be set
      expect(screen.getByTestId('project-name').textContent).toBe('Test Project');
    });

    it('sets source to "db" when includeDatabase=true', async () => {
      mockIncludeDatabase = true;

      renderWithRouter(
        <ProjectProvider>
          <TestConsumer />
        </ProjectProvider>
      );

      // Wait for initial load
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Click to set project
      await act(async () => {
        screen.getByTestId('set-project-btn').click();
      });

      // Source should be 'db'
      expect(screen.getByTestId('project-source').textContent).toBe('db');
    });

    it('sets source to "session" when includeDatabase=false', async () => {
      mockIncludeDatabase = false;

      renderWithRouter(
        <ProjectProvider>
          <TestConsumer />
        </ProjectProvider>
      );

      // Wait for initial load
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Click to set project
      await act(async () => {
        screen.getByTestId('set-project-btn').click();
      });

      // Source should be 'session' (File Mode)
      expect(screen.getByTestId('project-source').textContent).toBe('session');
    });
  });

  describe('useSetActiveProject hook', () => {
    it('returns a function', async () => {
      mockIncludeDatabase = true;
      let setActiveProjectFn: ((project: ProjectDto) => void) | undefined;

      function HookConsumer() {
        setActiveProjectFn = useSetActiveProject();
        return null;
      }

      renderWithRouter(
        <ProjectProvider>
          <HookConsumer />
        </ProjectProvider>
      );

      // Wait for initial load
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(typeof setActiveProjectFn).toBe('function');
    });

    it('throws error when used outside ProjectProvider', () => {
      mockIncludeDatabase = true;
      // Suppress console.error for this test
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      function BadConsumer() {
        useSetActiveProject();
        return null;
      }

      expect(() => {
        renderWithRouter(<BadConsumer />);
      }).toThrow('useSetActiveProject must be used within a ProjectProvider');

      consoleError.mockRestore();
    });
  });
});

/**
 * ProjectContext activeProjectSource Tests
 *
 * Spec 2026-01-22: Explicit Project Session API
 * Task Group 4: ProjectContext with Source Tracking
 *
 * Tests for the activeProjectSource state tracking:
 * - Test 1: In DB mode, activeProjectSource is 'db' when project loaded
 * - Test 2: In DB mode, activeProjectSource is 'none' when no project
 * - Test 3: In no-DB mode, activeProjectSource is 'session' when project loaded
 * - Test 4: In no-DB mode, activeProjectSource is 'none' when no project
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { ProjectProvider, useActiveProjectSource } from '../contexts/ProjectContext';

// Mock the API modules
vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual('../api/projectsApi');
  return {
    ...actual,
    getActiveProject: vi.fn(),
  };
});

vi.mock('../api/projectSessionApi', () => ({
  getSessionProject: vi.fn(),
}));

// Mock useIncludeDatabase hook
vi.mock('../contexts/AppConfigContext', () => ({
  useIncludeDatabase: vi.fn(),
}));

// Import mocked modules
import { getActiveProject } from '../api/projectsApi';
import { getSessionProject } from '../api/projectSessionApi';
import { useIncludeDatabase } from '../contexts/AppConfigContext';
import { renderWithRouter } from '../test-utils/renderWithProviders';

// Test component that displays the source
function TestSourceDisplay() {
  const source = useActiveProjectSource();
  return <div data-testid="source-display">{source}</div>;
}

describe('Task Group 4: ProjectContext activeProjectSource Tests', () => {
  const mockProject = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Test Project',
    projectParentFolder: '/test/folder',
    projectHierarchy: null,
    organisationId: null,
    isActive: true,
    createdAt: '2026-01-22T00:00:00Z',
    updatedAt: '2026-01-22T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Test 1: In DB mode, activeProjectSource is 'db' when project loaded
  // =========================================================================

  it('should set activeProjectSource to "db" when project loaded in DB mode', async () => {
    // Arrange
    vi.mocked(useIncludeDatabase).mockReturnValue(true);
    vi.mocked(getActiveProject).mockResolvedValue(mockProject);
    vi.mocked(getSessionProject).mockResolvedValue(null);

    // Act
    renderWithRouter(
      <ProjectProvider>
        <TestSourceDisplay />
      </ProjectProvider>
    );

    // Assert
    await waitFor(() => {
      expect(screen.getByTestId('source-display')).toHaveTextContent('db');
    });

    // Verify correct API was called
    expect(getActiveProject).toHaveBeenCalled();
    expect(getSessionProject).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test 2: In DB mode, activeProjectSource is 'none' when no project
  // =========================================================================

  it('should set activeProjectSource to "none" when no project in DB mode', async () => {
    // Arrange
    vi.mocked(useIncludeDatabase).mockReturnValue(true);
    vi.mocked(getActiveProject).mockResolvedValue(null);
    vi.mocked(getSessionProject).mockResolvedValue(null);

    // Act
    renderWithRouter(
      <ProjectProvider>
        <TestSourceDisplay />
      </ProjectProvider>
    );

    // Assert
    await waitFor(() => {
      expect(screen.getByTestId('source-display')).toHaveTextContent('none');
    });

    // Verify correct API was called
    expect(getActiveProject).toHaveBeenCalled();
    expect(getSessionProject).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test 3: In no-DB mode, activeProjectSource is 'session' when project loaded
  // =========================================================================

  it('should set activeProjectSource to "session" when project loaded in no-DB mode', async () => {
    // Arrange
    vi.mocked(useIncludeDatabase).mockReturnValue(false);
    vi.mocked(getActiveProject).mockResolvedValue(null);
    vi.mocked(getSessionProject).mockResolvedValue(mockProject);

    // Act
    renderWithRouter(
      <ProjectProvider>
        <TestSourceDisplay />
      </ProjectProvider>
    );

    // Assert
    await waitFor(() => {
      expect(screen.getByTestId('source-display')).toHaveTextContent('session');
    });

    // Verify correct API was called
    expect(getActiveProject).not.toHaveBeenCalled();
    expect(getSessionProject).toHaveBeenCalled();
  });

  // =========================================================================
  // Test 4: In no-DB mode, activeProjectSource is 'none' when no project
  // =========================================================================

  it('should set activeProjectSource to "none" when no project in no-DB mode', async () => {
    // Arrange
    vi.mocked(useIncludeDatabase).mockReturnValue(false);
    vi.mocked(getActiveProject).mockResolvedValue(null);
    vi.mocked(getSessionProject).mockResolvedValue(null);

    // Act
    renderWithRouter(
      <ProjectProvider>
        <TestSourceDisplay />
      </ProjectProvider>
    );

    // Assert
    await waitFor(() => {
      expect(screen.getByTestId('source-display')).toHaveTextContent('none');
    });

    // Verify correct API was called
    expect(getActiveProject).not.toHaveBeenCalled();
    expect(getSessionProject).toHaveBeenCalled();
  });
});

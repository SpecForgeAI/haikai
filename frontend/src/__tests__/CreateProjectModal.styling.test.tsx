/**
 * Visual/styling tests for CreateProjectModal organisation elements.
 *
 * Spec 2026-01-18: Organisations Iteration 2 - Mandatory Organisation Autocomplete
 * Task Group 4: CSS Styling Tests
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Create mock functions
const mockListOrganisations = vi.fn();

// Mock dependencies
vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual('../api/projectsApi');
  return {
    ...actual,
    createProject: vi.fn().mockResolvedValue({}),
  };
});

vi.mock('../api/organisationsApi', async () => {
  class OrganisationConflictError extends Error {
    isConflict = true;
    constructor(message: string) {
      super(message);
      this.name = 'OrganisationConflictError';
    }
  }

  const actual = await vi.importActual('../api/organisationsApi');

  return {
    ...actual,
    listOrganisations: () => mockListOrganisations(),
    createOrganisation: vi.fn().mockResolvedValue({ id: 'new-id', name: 'New', description: null }),
    OrganisationConflictError,
  };
});

vi.mock('../contexts/ProjectContext', () => ({
  useRefreshActiveProject: () => vi.fn().mockResolvedValue(undefined),
  useSetActiveProject: () => vi.fn(),
}));

vi.mock('../contexts/ArchitectureContext', () => ({
  useArchitectureContext: () => ({
    state: { model: {} },
    dispatch: vi.fn(),
  }),
}));

vi.mock('../utils/saveUtils', () => ({
  saveModelToBackend: vi.fn().mockResolvedValue({ success: true }),
}));

// Import after mocks
import { CreateProjectModal } from '../components/Project/CreateProjectModal';

describe('CreateProjectModal - CSS Styling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('loading indicator has correct styling class during fetch', async () => {
    // Make listOrganisations take longer to show loading state
    mockListOrganisations.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
    );

    render(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    // Loading indicator should be present and have correct class
    const loadingElement = screen.getByTestId('organisations-loading');
    expect(loadingElement).toBeInTheDocument();
    expect(loadingElement.className).toContain('organisationLoading');

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByTestId('organisations-loading')).not.toBeInTheDocument();
    });
  });

  it('warning message has correct styling class on load failure', async () => {
    mockListOrganisations.mockRejectedValueOnce(new Error('Network error'));

    render(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      const warningElement = screen.getByTestId('organisations-warning');
      expect(warningElement).toBeInTheDocument();
      expect(warningElement.className).toContain('organisationWarning');
    });
  });
});

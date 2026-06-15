/**
 * Integration tests for ModelFileDialog with OrganisationGroupedProjectList
 *
 * Spec 2026-01-18: Organisations Iteration 3 - Update Project Open Modal
 * Task Group 3: CSS Module and Integrate into ModelFileDialog
 *
 * Spec 2026-01-26: Activate Project on Open
 * - onConfirm now receives OpenProjectResult { filename, projectId }
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ModelFileDialog } from '../components/file/ModelFileDialog';

describe('ModelFileDialog - Organisation Grouping Integration', () => {
  // Mock fetch
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Sample data
  const sampleProjects = [
    {
      id: 'proj-1',
      name: 'Alpha Project',
      project_parent_folder: '/projects/alpha',
      project_hierarchy: 'Hierarchy1',
      organisation_id: 'org-1',
      is_active: false,
      created_at: '2026-01-18T12:00:00Z',
      updated_at: '2026-01-18T12:00:00Z',
    },
    {
      id: 'proj-2',
      name: 'Beta Project',
      project_parent_folder: '/projects/beta',
      project_hierarchy: 'Hierarchy2',
      organisation_id: 'org-2',
      is_active: false,
      created_at: '2026-01-18T12:00:00Z',
      updated_at: '2026-01-18T12:00:00Z',
    },
  ];

  const sampleOrganisations = [
    { id: 'org-1', name: 'Acme Corporation', description: null },
    { id: 'org-2', name: 'Beta Industries', description: null },
  ];

  it('fetches projects and organisations in parallel when open mode dialog opens', async () => {
    // Track the order of fetch calls
    const fetchCalls: string[] = [];

    mockFetch.mockImplementation(async (url: string) => {
      fetchCalls.push(url);
      if (url.includes('/api/projects')) {
        return {
          ok: true,
          json: async () => sampleProjects,
        };
      }
      if (url.includes('/api/v1/organisations')) {
        return {
          ok: true,
          json: async () => sampleOrganisations,
        };
      }
      return { ok: false, status: 404 };
    });

    render(
      <ModelFileDialog
        mode="open"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    // Both endpoints should be called
    expect(fetchCalls).toContain('/api/projects');
    expect(fetchCalls).toContain('/api/v1/organisations');
  });

  it('renders OrganisationGroupedProjectList with correct organisation names', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/projects')) {
        return { ok: true, json: async () => sampleProjects };
      }
      if (url.includes('/api/v1/organisations')) {
        return { ok: true, json: async () => sampleOrganisations };
      }
      return { ok: false, status: 404 };
    });

    render(
      <ModelFileDialog
        mode="open"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      // Organisation names should be displayed (not IDs)
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
      expect(screen.getByText('Beta Industries')).toBeInTheDocument();
    });
  });

  it('project selection flow works end-to-end', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/projects')) {
        return { ok: true, json: async () => sampleProjects };
      }
      if (url.includes('/api/v1/organisations')) {
        return { ok: true, json: async () => sampleOrganisations };
      }
      return { ok: false, status: 404 };
    });

    const onConfirm = vi.fn();

    render(
      <ModelFileDialog
        mode="open"
        isOpen={true}
        onClose={() => {}}
        onConfirm={onConfirm}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    // Expand organisation section
    fireEvent.click(screen.getByTestId('org-header-org-1'));

    // Expand hierarchy section
    await waitFor(() => {
      expect(screen.getByTestId('hierarchy-header-org-1-Hierarchy1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('hierarchy-header-org-1-Hierarchy1'));

    // Click on project row
    await waitFor(() => {
      expect(screen.getByTestId('project-row-proj-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('project-row-proj-1'));

    // Click OK button
    const okButton = screen.getByRole('button', { name: /OK/i });
    fireEvent.click(okButton);

    // Verify onConfirm was called with OpenProjectResult (filename + projectId)
    // Spec 2026-01-26: open mode now passes { filename, projectId }
    expect(onConfirm).toHaveBeenCalledWith({
      filename: 'Alpha Project',
      projectId: 'proj-1',
    });
  });

  it('handles loading and error states correctly', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(
      <ModelFileDialog
        mode="open"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    // Error message should be displayed
    await waitFor(() => {
      expect(screen.getByText(/Network error|Failed to load/i)).toBeInTheDocument();
    });

    // Retry button should be available
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });
});

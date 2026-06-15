/**
 * RepoMapEditor tests.
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair --
 * Task Group 4 (Task 4.1).
 *
 * Covers the post-init repo CRUD home:
 *  (a) drift on the GET (gateway `changed: true`) shows the visible
 *      "Repo map updated from workspace" notice, with the rows rendered
 *      from the LIVE (external-wins) map;
 *  (b) no drift -> no notice;
 *  (c) add row validates the folder slug rule client-side, then POSTs and
 *      re-renders from the returned RepoMapResponse;
 *  (d) delete calls the DELETE route and re-renders from the response.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockGetImplementationRepoMap = vi.fn();
const mockAddImplementationRepo = vi.fn();
const mockUpdateImplementationRepo = vi.fn();
const mockDeleteImplementationRepo = vi.fn();

vi.mock('../api/implementationProjectsApi', async () => {
  const actual = await vi.importActual('../api/implementationProjectsApi');
  return {
    ...actual,
    getImplementationRepoMap: (...args: unknown[]) =>
      mockGetImplementationRepoMap(...args),
    addImplementationRepo: (...args: unknown[]) =>
      mockAddImplementationRepo(...args),
    updateImplementationRepo: (...args: unknown[]) =>
      mockUpdateImplementationRepo(...args),
    deleteImplementationRepo: (...args: unknown[]) =>
      mockDeleteImplementationRepo(...args),
  };
});

import { RepoMapEditor } from '../components/Project/RepoMapEditor';

function repoMapResponse(
  repos: Record<string, string>,
  changed = false
) {
  return {
    company: 'acme-corp',
    project: 'my-product',
    repos,
    changed,
    synced: true,
  };
}

function renderEditor() {
  return render(
    <RepoMapEditor company="acme-corp" project="my-product" projectId="proj-1" />
  );
}

describe('RepoMapEditor (Spec 2026-06-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImplementationRepoMap.mockResolvedValue(
      repoMapResponse({
        backend: 'https://github.com/acme/backend.git',
        frontend: 'https://github.com/acme/frontend.git',
      })
    );
  });

  it('shows the "Repo map updated from workspace" notice when the GET reports drift, rendering the live map', async () => {
    mockGetImplementationRepoMap.mockResolvedValue(
      repoMapResponse(
        { backend: 'https://github.com/acme/backend-moved.git' },
        true
      )
    );
    renderEditor();

    await waitFor(() => {
      expect(screen.getByTestId('repo-map-editor')).toBeInTheDocument();
    });

    expect(mockGetImplementationRepoMap).toHaveBeenCalledWith(
      'acme-corp',
      'my-product',
      'proj-1'
    );
    // Visible drift notice (external-wins auto-sync already happened gateway-side)
    expect(screen.getByTestId('repo-drift-notice')).toHaveTextContent(
      'Repo map updated from workspace'
    );
    // Rows render from the LIVE map
    expect(screen.getByTestId('repo-map-url-backend')).toHaveValue(
      'https://github.com/acme/backend-moved.git'
    );
  });

  it('shows no drift notice when the stored map already matched', async () => {
    renderEditor();
    await waitFor(() => {
      expect(screen.getByTestId('repo-map-editor')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('repo-drift-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('repo-map-row-backend')).toBeInTheDocument();
    expect(screen.getByTestId('repo-map-row-frontend')).toBeInTheDocument();
  });

  it('add row: rejects an invalid folder name client-side, then POSTs and re-renders from the response', async () => {
    renderEditor();
    await waitFor(() => {
      expect(screen.getByTestId('repo-map-editor')).toBeInTheDocument();
    });

    // Invalid slug -> inline error, no API call
    fireEvent.change(screen.getByTestId('repo-map-new-folder'), {
      target: { value: 'Bad Folder' },
    });
    fireEvent.change(screen.getByTestId('repo-map-new-url'), {
      target: { value: 'https://github.com/acme/new.git' },
    });
    fireEvent.click(screen.getByTestId('repo-map-add-button'));
    expect(screen.getByTestId('repo-map-action-error')).toHaveTextContent(
      /lowercase/
    );
    expect(mockAddImplementationRepo).not.toHaveBeenCalled();

    // Valid add -> POST, re-render from the returned map
    mockAddImplementationRepo.mockResolvedValue(
      repoMapResponse({
        backend: 'https://github.com/acme/backend.git',
        frontend: 'https://github.com/acme/frontend.git',
        'new-svc': 'https://github.com/acme/new.git',
      })
    );
    fireEvent.change(screen.getByTestId('repo-map-new-folder'), {
      target: { value: 'new-svc' },
    });
    fireEvent.click(screen.getByTestId('repo-map-add-button'));

    await waitFor(() => {
      expect(screen.getByTestId('repo-map-row-new-svc')).toBeInTheDocument();
    });
    expect(mockAddImplementationRepo).toHaveBeenCalledWith(
      'acme-corp',
      'my-product',
      'proj-1',
      'new-svc',
      'https://github.com/acme/new.git'
    );
    expect(screen.queryByTestId('repo-map-action-error')).not.toBeInTheDocument();
  });

  it('delete row: calls the DELETE route and re-renders from the returned map', async () => {
    renderEditor();
    await waitFor(() => {
      expect(screen.getByTestId('repo-map-row-frontend')).toBeInTheDocument();
    });

    mockDeleteImplementationRepo.mockResolvedValue(
      repoMapResponse({ backend: 'https://github.com/acme/backend.git' })
    );
    fireEvent.click(screen.getByTestId('repo-map-delete-frontend'));

    await waitFor(() => {
      expect(
        screen.queryByTestId('repo-map-row-frontend')
      ).not.toBeInTheDocument();
    });
    expect(mockDeleteImplementationRepo).toHaveBeenCalledWith(
      'acme-corp',
      'my-product',
      'proj-1',
      'frontend'
    );
    expect(screen.getByTestId('repo-map-row-backend')).toBeInTheDocument();
  });
});

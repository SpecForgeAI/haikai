/**
 * Gap-fill end-to-end tests for the multi-architecture plumbing pipeline.
 *
 * Spec: 2026-05-01 Multi-Architecture Plumbing -- Task 6.4.
 *
 * Existing Group 4 tests (`multiArchitecturePlumbing.test.tsx`) cover:
 *   - ArchitectureContext resolves activeArchitectureId to the oldest non-archived
 *   - useActiveArchitectureId() returns null while loading and the resolved id once settled
 *   - loadModelByProjectId(projectId, architectureId) embeds /architectures/{id}/
 *   - architecturesApi.listArchitectures hits the correct endpoint
 *
 * They cover each unit in isolation. They do NOT cover the end-to-end flow:
 * a project loads -> ArchitectureContext resolves the Default -> a consumer
 * component reads activeArchitectureId via the hook -> a Bucket A API call
 * uses that resolved id in the upstream URL. This file fills that gap.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import React, { ReactNode, useEffect, useState } from 'react';

// ============================================================================
// Mocks
// ============================================================================

// Mock the architecturesApi so we control what listArchitectures returns.
vi.mock('../api/architecturesApi', async () => {
  const actual = await vi.importActual('../api/architecturesApi');
  return {
    ...actual,
    listArchitectures: vi.fn(),
  };
});

// Mock the ProjectContext useProject hook.
vi.mock('../contexts/ProjectContext', () => ({
  useProject: vi.fn(),
}));

import { listArchitectures, type Architecture } from '../api/architecturesApi';
import { useProject } from '../contexts/ProjectContext';
import { renderWithRouter } from '../test-utils/renderWithProviders';
import {
  ArchitectureProvider,
  useActiveArchitectureId,
} from '../contexts/ArchitectureContext';

const PROJECT_ID = 'proj-e2e-uuid';
const RESOLVED_ARCH_ID = 'arch-resolved-uuid';

function buildArchitecture(overrides: Partial<Architecture>): Architecture {
  return {
    id: 'arch-default',
    projectId: PROJECT_ID,
    name: 'Default',
    description: null,
    tags: [],
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildProjectFixture() {
  return {
    id: PROJECT_ID,
    name: 'E2E Test Project',
    projectParentFolder: '/test',
    projectHierarchy: null,
    organisationId: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/**
 * Real consumer pattern: read activeArchitectureId via the hook and
 * thread it into a Bucket A API call once it becomes available.
 */
function ConsumerComponent({ onApiCall }: { onApiCall: (url: string) => void }) {
  const activeArchitectureId = useActiveArchitectureId();
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!activeArchitectureId || done) return;
    // Simulate a Bucket A API call: build the URL the same way the real
    // loadModelByProjectId does. We don't import the real API to keep the
    // test isolated from any global fetch wiring -- the assertion is purely
    // about what URL the consumer would build given the resolved id.
    const url = `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(activeArchitectureId)}`;
    onApiCall(url);
    setDone(true);
  }, [activeArchitectureId, done, onApiCall]);

  return (
    <div data-testid="active-arch-id">{activeArchitectureId ?? 'NULL'}</div>
  );
}

function renderWithProvider(children: ReactNode) {
  // Mount on a project-scoped URL: in the real flow a loaded project always
  // puts the user under /projects/..., and the always-selected-architecture
  // effect deliberately only auto-resolves there (it must not hijack the
  // landing page or the 404 page — safety property g of the 2026-05-04
  // routing spec).
  return renderWithRouter(
    <ArchitectureProvider>{children}</ArchitectureProvider>,
    { initialEntries: [`/projects/${PROJECT_ID}/dashboard`] },
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('Multi-Architecture Plumbing -- End-to-End Frontend Wiring (Task 6.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: project loads -> resolves Default -> Bucket A URL is scoped
  // ---------------------------------------------------------------------------
  it('project load -> ArchitectureContext resolves Default -> consumer threads it into Bucket A URL', async () => {
    // Backend lists three architectures: an archived (oldest) one, the Default,
    // and a newer one. The Default-resolution rule (oldest non-archived) MUST
    // pick the middle one and the URL the consumer builds MUST embed exactly
    // that id -- not the archived one, not the newer one.
    const archived = buildArchitecture({
      id: 'arch-archived',
      name: 'Old (archived)',
      archived: true,
      createdAt: '2025-10-01T00:00:00Z',
    });
    const resolvedDefault = buildArchitecture({
      id: RESOLVED_ARCH_ID,
      name: 'Default',
      archived: false,
      createdAt: '2026-01-01T00:00:00Z',
    });
    const newer = buildArchitecture({
      id: 'arch-newer',
      name: 'Future',
      archived: false,
      createdAt: '2026-03-01T00:00:00Z',
    });

    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(listArchitectures).mockResolvedValue([archived, resolvedDefault, newer]);

    const onApiCall = vi.fn();
    renderWithProvider(<ConsumerComponent onApiCall={onApiCall} />);

    // The hook should report the resolved Default once listArchitectures settles.
    await waitFor(() => {
      expect(screen.getByTestId('active-arch-id')).toHaveTextContent(RESOLVED_ARCH_ID);
    });

    // The consumer must have made exactly one API call, and its URL must
    // embed the resolved Default id verbatim.
    await waitFor(() => {
      expect(onApiCall).toHaveBeenCalledTimes(1);
    });
    const calledUrl = onApiCall.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      `/api/model/projects/${PROJECT_ID}/architectures/${RESOLVED_ARCH_ID}`
    );
    expect(calledUrl).toContain(`/architectures/${RESOLVED_ARCH_ID}`);
    // Critically: it must NOT have used the archived or the newer id.
    expect(calledUrl).not.toContain('arch-archived');
    expect(calledUrl).not.toContain('arch-newer');

    // And exactly one list-architectures call should have been made
    // (no unintended re-fetching from the consumer).
    expect(listArchitectures).toHaveBeenCalledTimes(1);
    expect(listArchitectures).toHaveBeenCalledWith(PROJECT_ID);
  });

  // ---------------------------------------------------------------------------
  // Test 2: while listArchitectures is in flight, the consumer must NOT call
  //         the Bucket A endpoint with a hardcoded default
  // ---------------------------------------------------------------------------
  it('consumer does NOT call Bucket A endpoint while activeArchitectureId is null (no hardcoded default)', async () => {
    let resolveList!: (architectures: Architecture[]) => void;
    const listPromise = new Promise<Architecture[]>((resolve) => {
      resolveList = resolve;
    });

    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(listArchitectures).mockReturnValue(listPromise);

    const onApiCall = vi.fn();
    renderWithProvider(<ConsumerComponent onApiCall={onApiCall} />);

    // While the architectures list is in flight, the consumer must skip the
    // Bucket A call (the hook returns null; the early-return guard fires).
    expect(screen.getByTestId('active-arch-id')).toHaveTextContent('NULL');
    expect(onApiCall).not.toHaveBeenCalled();

    // Now resolve. After settle, the consumer fires exactly one Bucket A call
    // with the resolved id.
    resolveList([buildArchitecture({ id: RESOLVED_ARCH_ID, archived: false })]);

    await waitFor(() => {
      expect(onApiCall).toHaveBeenCalledTimes(1);
    });
    expect(onApiCall.mock.calls[0][0]).toContain(`/architectures/${RESOLVED_ARCH_ID}`);
  });
});

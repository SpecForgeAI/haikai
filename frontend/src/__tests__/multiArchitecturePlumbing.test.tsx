/**
 * Multi-Architecture Plumbing -- Frontend Wiring Tests
 *
 * Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
 * Task 4.1: 4 focused tests for the frontend wiring.
 *
 * Tests:
 *   1. ArchitectureContext resolves activeArchitectureId to the project's
 *      Default architecture (oldest non-archived) when a project loads.
 *   2. useActiveArchitectureId() hook returns the resolved value.
 *   3. One representative Bucket A API client function (loadModelByProjectId)
 *      called with architectureId produces a URL containing
 *      `/architectures/{architectureId}/`.
 *   4. architecturesApi.listArchitectures(projectId) hits
 *      `GET /api/projects/{projectId}/architectures`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React, { ReactNode } from 'react';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 2
// ArchitectureProvider now uses useParams/useNavigate/useLocation, so all
// renders must be wrapped in a Router. MemoryRouter lets us drive the
// :architectureId segment via initialEntries.
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ============================================================================
// Mocks
// ============================================================================

// Mock the architecturesApi module so we control what listArchitectures returns.
vi.mock('../api/architecturesApi', async () => {
  const actual = await vi.importActual('../api/architecturesApi');
  return {
    ...actual,
    listArchitectures: vi.fn(),
  };
});

// Mock the ProjectContext useProject hook so ArchitectureProvider sees a project
// without us having to mount the full ProjectProvider + activate flow.
vi.mock('../contexts/ProjectContext', () => ({
  useProject: vi.fn(),
}));

// Import mocked modules so we can control their behaviour per-test.
import { listArchitectures, type Architecture } from '../api/architecturesApi';
import { useProject } from '../contexts/ProjectContext';

// Import the system-under-test AFTER the mocks are set up.
import {
  ArchitectureProvider,
  useActiveArchitectureId,
} from '../contexts/ArchitectureContext';

// ============================================================================
// Test Helpers
// ============================================================================

const PROJECT_ID = 'proj-uuid-123';
const ARCH_OLDEST_NON_ARCHIVED_ID = 'arch-uuid-default';
const ARCH_NEWER_ID = 'arch-uuid-newer';

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
    name: 'Test Project',
    projectParentFolder: '/test',
    projectHierarchy: null,
    organisationId: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function ActiveArchProbe() {
  const id = useActiveArchitectureId();
  return <div data-testid="active-arch-id">{id ?? 'NULL'}</div>;
}

/**
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 2
 *
 * Mounts ArchitectureProvider under a MemoryRouter at the canonical URL
 * `/projects/:projectId/architectures/:architectureId/dashboard` so that
 * `useParams().architectureId` resolves to ARCH_OLDEST_NON_ARCHIVED_ID.
 * The provider's URL-driven behaviour matches what tests 1 & 2 used to
 * assert on the now-removed useState/useEffect resolver.
 */
function renderWithProvider(children: ReactNode) {
  return render(
    <MemoryRouter
      initialEntries={[
        `/projects/${PROJECT_ID}/architectures/${ARCH_OLDEST_NON_ARCHIVED_ID}/dashboard`,
      ]}
    >
      <Routes>
        <Route
          path="/projects/:projectId/architectures/:architectureId/*"
          element={<ArchitectureProvider>{children}</ArchitectureProvider>}
        />
      </Routes>
    </MemoryRouter>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('Multi-Architecture Plumbing -- Frontend Wiring (Task 4.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1 (updated for spec #2 Task Group 2):
  // ArchitectureContext exposes activeArchitectureId from the URL segment.
  //
  // The OLD spec-#1 behaviour ('resolver picks oldest non-archived from
  // listArchitectures') has moved to <ProjectLayout> and is covered by
  // multiArchitectureSelectorAndRouting.routingSkeleton.test.tsx Test 3.
  // Here we verify the unchanged hook signature still returns the right
  // value -- now sourced from the URL.
  // ---------------------------------------------------------------------------
  it('exposes activeArchitectureId from the URL :architectureId segment (URL is the source of truth)', async () => {
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(listArchitectures).mockResolvedValue([
      buildArchitecture({ id: ARCH_OLDEST_NON_ARCHIVED_ID, archived: false }),
    ]);

    renderWithProvider(<ActiveArchProbe />);

    // The id is read directly from useParams(); available on first render.
    expect(screen.getByTestId('active-arch-id')).toHaveTextContent(
      ARCH_OLDEST_NON_ARCHIVED_ID
    );
  });

  // ---------------------------------------------------------------------------
  // Test 2 (updated for spec #2 Task Group 2):
  // useActiveArchitectureId() never depends on listArchitectures resolution.
  //
  // Safety property (a) for spec #2: the id is read from the URL, not from
  // any API resolver, so it is observable on first render even when the
  // architectures fetch never completes.
  // ---------------------------------------------------------------------------
  it('useActiveArchitectureId() returns the URL-derived id without waiting for listArchitectures to settle', async () => {
    // listArchitectures returns a never-resolving promise so we can prove
    // the hook does not depend on it for the active id.
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(listArchitectures).mockReturnValue(new Promise(() => {}));

    renderWithProvider(<ActiveArchProbe />);

    // The id is available immediately -- no waitFor needed.
    expect(screen.getByTestId('active-arch-id')).toHaveTextContent(
      ARCH_OLDEST_NON_ARCHIVED_ID
    );
  });

  // ---------------------------------------------------------------------------
  // Test 3: Bucket A API function (loadModelByProjectId) called with
  //         architectureId embeds it in the URL as a path segment.
  // ---------------------------------------------------------------------------
  it('loadModelByProjectId(projectId, architectureId) hits /api/model/projects/{projectId}/architectures/{architectureId}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        meta_model: { entities: {}, relationships: {} },
        diagrams: [],
      }),
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof global.fetch;

    try {
      const { loadModelByProjectId } = await import('../api/modelApi');
      await loadModelByProjectId('proj-abc', 'arch-xyz');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl] = fetchMock.mock.calls[0];
      expect(calledUrl).toContain('/api/model/projects/proj-abc/architectures/arch-xyz');
      // Must NOT use the old query-param shape.
      expect(calledUrl).not.toContain('?projectId=');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // ---------------------------------------------------------------------------
  // Test 4: architecturesApi.listArchitectures(projectId) hits the correct endpoint.
  // ---------------------------------------------------------------------------
  it('architecturesApi.listArchitectures(projectId) hits GET /api/projects/{projectId}/architectures', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'arch-1',
          projectId: 'proj-list-test',
          name: 'Default',
          description: null,
          tags: [],
          archived: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof global.fetch;

    try {
      // Re-import to bypass the test-file-scoped vi.mock above.
      const actual = await vi.importActual<typeof import('../api/architecturesApi')>(
        '../api/architecturesApi'
      );

      const result = await actual.listArchitectures('proj-list-test');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl] = fetchMock.mock.calls[0];
      expect(calledUrl).toContain('/api/projects/proj-list-test/architectures');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('arch-1');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

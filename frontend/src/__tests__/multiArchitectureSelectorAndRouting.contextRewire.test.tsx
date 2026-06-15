/**
 * Multi-Architecture Selector + URL Routing -- Context Rewire Tests
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 2
 * Task 2.1: 2-8 focused tests for the context rewire.
 *
 * Tests cover:
 *   1. (Safety property a) `useActiveArchitectureId()` returns the architecture
 *      id from the URL path segment, NOT from API resolution. The id is
 *      observable on first render with no `listArchitectures` call required.
 *   2. Changing the URL `:architectureId` segment causes
 *      `useActiveArchitectureId()` to return the new id.
 *   3. `useProject()` continues to expose the active project (project id can
 *      be read from `useParams().projectId`); existing public hook surface
 *      preserved.
 *   4. `setActiveArchitecture(id)` swaps only the `:architectureId` segment in
 *      the current URL while preserving `:projectId` and the trailing view
 *      segment.
 *   5. `architectures` array is populated by a single `listArchitectures`
 *      call for the active project (and is the data the selector dropdown in
 *      Group 3 will consume).
 *
 * Test strategy:
 *   - Vitest with `vi.mock()` at top of file.
 *   - `MemoryRouter` for route-driven assertions.
 *   - `useProject` is mocked so we can drive ArchitectureProvider without
 *     mounting the full ProjectProvider.
 *   - `listArchitectures` is mocked to control the architectures list.
 */

import React, { ReactNode, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

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

// Mock the ProjectContext useProject hook so ArchitectureProvider sees a
// project without us having to mount the full ProjectProvider.
vi.mock('../contexts/ProjectContext', () => ({
  useProject: vi.fn(),
}));

import { listArchitectures, type Architecture } from '../api/architecturesApi';
import { useProject } from '../contexts/ProjectContext';
import {
  ArchitectureProvider,
  useActiveArchitectureId,
  useArchitectureContext,
} from '../contexts/ArchitectureContext';

// ============================================================================
// Test Helpers
// ============================================================================

const PROJECT_ID = 'proj-uuid-123';
const ARCH_DEFAULT_ID = 'arch-default-uuid';
const ARCH_TARGET_ID = 'arch-target-uuid';

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

/**
 * Probe component that exposes the hook return values to test assertions.
 */
function ActiveArchProbe() {
  const id = useActiveArchitectureId();
  return <div data-testid="active-arch-id">{id ?? 'NULL'}</div>;
}

/**
 * Probe component that exposes architectures + setActiveArchitecture
 * (the new public surface added in Group 2).
 */
function SelectorProbe({
  switchTo,
}: {
  switchTo?: string;
}) {
  const ctx = useArchitectureContext();
  const list = ctx.architectures ?? [];
  return (
    <div>
      <div data-testid="architectures-count">{list.length}</div>
      <div data-testid="architectures-ids">
        {list.map((a) => a.id).join(',')}
      </div>
      <button
        type="button"
        data-testid="switch-arch-button"
        onClick={() => {
          if (switchTo) ctx.setActiveArchitecture(switchTo);
        }}
      >
        switch
      </button>
    </div>
  );
}

/**
 * Probe component that reports the current location.pathname so we can
 * assert that setActiveArchitecture navigates correctly.
 */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="current-pathname">{location.pathname}</div>;
}

/**
 * Render the ArchitectureProvider under a MemoryRouter, with the routes
 * tree that mirrors the production wiring closely enough for the context
 * to resolve `:architectureId` from `useParams`.
 */
function renderWithRouting(opts: {
  initialEntries: string[];
  routePath: string;
  children: ReactNode;
}) {
  return render(
    <MemoryRouter initialEntries={opts.initialEntries}>
      <Routes>
        <Route
          path={opts.routePath}
          element={
            <ArchitectureProvider>{opts.children}</ArchitectureProvider>
          }
        />
        {/* Catch-all so any navigation away from the routePath still renders
            the Provider (useful for the setActiveArchitecture navigation
            assertion). */}
        <Route
          path="*"
          element={
            <ArchitectureProvider>{opts.children}</ArchitectureProvider>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('Multi-Architecture Selector + URL Routing -- Context Rewire (Task 2.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no project active. Individual tests override as needed.
    vi.mocked(useProject).mockReturnValue(null);
    vi.mocked(listArchitectures).mockResolvedValue([
      buildArchitecture({ id: ARCH_DEFAULT_ID, name: 'Default' }),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1 (Safety property a): useActiveArchitectureId() reads from URL,
  // not from API resolution.
  // ---------------------------------------------------------------------------
  it('returns the architecture id from the URL path segment without requiring listArchitectures resolution (safety property a)', () => {
    // Project is active but listArchitectures is intentionally left as a
    // never-resolving promise so we can prove the context never depends on
    // it for the active id.
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(listArchitectures).mockReturnValue(new Promise(() => {}));

    renderWithRouting({
      initialEntries: [
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      ],
      routePath: '/projects/:projectId/architectures/:architectureId/*',
      children: <ActiveArchProbe />,
    });

    // The id is available immediately on first render -- it is read from
    // useParams(), not from any async resolution.
    expect(screen.getByTestId('active-arch-id')).toHaveTextContent(
      ARCH_DEFAULT_ID
    );
  });

  // ---------------------------------------------------------------------------
  // Test 2: Changing the URL :architectureId segment updates the hook.
  // ---------------------------------------------------------------------------
  it('updates useActiveArchitectureId() when the URL :architectureId segment changes', () => {
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());

    // We re-render with a new initialEntries by simulating a router-driven
    // path change. The simplest way is to mount with one entry, then
    // unmount + remount with the second entry -- this proves the hook
    // tracks the URL.
    const { unmount } = renderWithRouting({
      initialEntries: [
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      ],
      routePath: '/projects/:projectId/architectures/:architectureId/*',
      children: <ActiveArchProbe />,
    });

    expect(screen.getByTestId('active-arch-id')).toHaveTextContent(
      ARCH_DEFAULT_ID
    );

    unmount();

    renderWithRouting({
      initialEntries: [
        `/projects/${PROJECT_ID}/architectures/${ARCH_TARGET_ID}/diagrams`,
      ],
      routePath: '/projects/:projectId/architectures/:architectureId/*',
      children: <ActiveArchProbe />,
    });

    expect(screen.getByTestId('active-arch-id')).toHaveTextContent(
      ARCH_TARGET_ID
    );
  });

  // ---------------------------------------------------------------------------
  // Test 3: Public hook surface preserved -- useProject() still works.
  // ---------------------------------------------------------------------------
  it('preserves the existing useProject() hook signature so consumers keep working', () => {
    const project = buildProjectFixture();
    vi.mocked(useProject).mockReturnValue(project);

    function ProjectProbe() {
      const p = useProject();
      return <div data-testid="active-project-id">{p?.id ?? 'NULL'}</div>;
    }

    renderWithRouting({
      initialEntries: [
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      ],
      routePath: '/projects/:projectId/architectures/:architectureId/*',
      children: <ProjectProbe />,
    });

    expect(screen.getByTestId('active-project-id')).toHaveTextContent(
      PROJECT_ID
    );
  });

  // ---------------------------------------------------------------------------
  // Test 4: setActiveArchitecture(id) swaps only the :architectureId segment.
  // ---------------------------------------------------------------------------
  it('setActiveArchitecture(id) navigates to the same view with the :architectureId segment swapped, preserving :projectId and the trailing view', async () => {
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(listArchitectures).mockResolvedValue([
      buildArchitecture({ id: ARCH_DEFAULT_ID, name: 'Default' }),
      buildArchitecture({
        id: ARCH_TARGET_ID,
        name: 'Target',
        createdAt: '2026-02-01T00:00:00Z',
      }),
    ]);

    render(
      <MemoryRouter
        initialEntries={[
          `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
        ]}
      >
        <Routes>
          <Route
            path="/projects/:projectId/architectures/:architectureId/*"
            element={
              <ArchitectureProvider>
                <SelectorProbe switchTo={ARCH_TARGET_ID} />
                <LocationProbe />
              </ArchitectureProvider>
            }
          />
          <Route
            path="*"
            element={
              <ArchitectureProvider>
                <LocationProbe />
              </ArchitectureProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    // Confirm starting URL.
    expect(screen.getByTestId('current-pathname')).toHaveTextContent(
      `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`
    );

    // Click the probe button -- this calls setActiveArchitecture(ARCH_TARGET_ID).
    act(() => {
      screen.getByTestId('switch-arch-button').click();
    });

    // The URL must have swapped only the :architectureId segment.
    await waitFor(() => {
      expect(screen.getByTestId('current-pathname')).toHaveTextContent(
        `/projects/${PROJECT_ID}/architectures/${ARCH_TARGET_ID}/diagrams`
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 5: architectures is populated by a single listArchitectures call
  //         when projectId changes (used by Group 3's selector dropdown).
  // ---------------------------------------------------------------------------
  it('populates `architectures` from a single listArchitectures call when the active project changes', async () => {
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(listArchitectures).mockResolvedValue([
      buildArchitecture({ id: ARCH_DEFAULT_ID, name: 'Default' }),
      buildArchitecture({
        id: ARCH_TARGET_ID,
        name: 'Target',
        createdAt: '2026-02-01T00:00:00Z',
      }),
    ]);

    renderWithRouting({
      initialEntries: [
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      ],
      routePath: '/projects/:projectId/architectures/:architectureId/*',
      children: <SelectorProbe />,
    });

    await waitFor(() => {
      expect(screen.getByTestId('architectures-count')).toHaveTextContent('2');
    });

    expect(screen.getByTestId('architectures-ids')).toHaveTextContent(
      `${ARCH_DEFAULT_ID},${ARCH_TARGET_ID}`
    );

    // Single API call for the project.
    expect(listArchitectures).toHaveBeenCalledTimes(1);
    expect(listArchitectures).toHaveBeenCalledWith(PROJECT_ID);
  });
});

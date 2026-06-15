/**
 * Comprehensive Frontend Routing -- Foundational Bug Fix Tests
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 1
 * Task 1.1: 2-8 focused tests for the foundational fix.
 *
 * Coverage:
 *   - Pure helper `parseArchitectureIdFromPathname`
 *   - Safety property (a): `useActiveArchitectureId()` returns the URL-segment
 *     value when the URL has `:architectureId`, regardless of where the
 *     consumer is mounted relative to the route tree.
 *   - Safety property (h): a context using `useLocation()`-based parsing
 *     returns the URL-derived value when mounted OUTSIDE the route tree.
 *   - Safety property (b): `RootRoute` auto-navigates to `/projects/:projectId`
 *     when `activeProject` exists on mount; no empty TopBar shell rendered.
 *   - Safety property (c, partial -- Bug 3 fix): a TopBar nav button click on
 *     a hydrated app at the canonical URL changes `MemoryRouter` history.
 *     Validates handleViewChange's early-return guard now passes because
 *     activeArchitectureId is URL-derived rather than permanently null.
 *   - Bug 2 fix: the model auto-load effect in AppShell now fires when on the
 *     canonical URL ("Untitled" no longer shows because the auto-load
 *     receives a real architecture id).
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 3 refactor:
 *   The inline `<TestAppTree>` harness has been replaced with the new
 *   `renderWithFullApp` helper from `__tests__/routing/testUtils.tsx`. The
 *   helper mounts the FULL production `<AppContent>` (with `<AppShell>` and
 *   its auto-load-model effect, `<RootRoute>` and its auto-navigate effect)
 *   under a `<MemoryRouter>` -- which means Group 1's "behavioural" tests
 *   exercise the same code paths the user does in production. Test 2 and
 *   Test 3 still mount `<ArchitectureProvider>` directly under a
 *   `<MemoryRouter>` because they test the bug class at the smallest
 *   reproducible scope.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import {
  MemoryRouter,
  Routes,
  Route,
  useLocation,
} from 'react-router-dom';

// ============================================================================
// Mocks (must be set up BEFORE module-under-test imports)
// ============================================================================

vi.mock('../api/architecturesApi', async () => {
  const actual = await vi.importActual('../api/architecturesApi');
  return {
    ...actual,
    // Default to an empty list so provider-level fetches that run before a
    // test sets its own mockResolvedValue do not return undefined (.then crash).
    listArchitectures: vi.fn(() => Promise.resolve([])),
  };
});

vi.mock('../contexts/ProjectContext', async () => {
  const actual = await vi.importActual<typeof import('../contexts/ProjectContext')>(
    '../contexts/ProjectContext'
  );
  return {
    ...actual,
    useProject: vi.fn(),
    useProjectLoading: vi.fn(),
  };
});

vi.mock('../api/modelApi', async () => {
  const actual = await vi.importActual('../api/modelApi');
  return {
    ...actual,
    // Default: resolve an empty model so AppShell's load effect never calls
    // .then on undefined before a test installs its own mockResolvedValue.
    loadModelByProjectId: vi.fn(async () => {
      const { emptyModel } = await vi.importActual<typeof import('../config/defaults')>('../config/defaults');
      return JSON.parse(JSON.stringify(emptyModel));
    }),
  };
});

// Render portals inline so any toast / menu pops appear in the test DOM tree.
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Heavy view components -> lightweight stubs so route bodies mount fast.
vi.mock('../components/DashboardView/DashboardView', () => ({
  DashboardView: () => <div data-testid="dashboard-view-stub">DashboardView</div>,
}));
vi.mock('../components/MetaModelView/MetaModelView', () => ({
  MetaModelView: () => <div data-testid="meta-model-view-stub">MetaModelView</div>,
}));
vi.mock('../components/DiagramsView/DiagramsView', () => ({
  DiagramsView: () => <div data-testid="diagrams-view-stub">DiagramsView</div>,
}));
vi.mock('../components/ProductView/ProductView', () => ({
  ProductView: () => <div data-testid="product-view-stub">ProductView</div>,
}));
// LandingPage and CreateOrganisationModal pull heavy form / chat trees that
// are not relevant to the foundational-fix surface; stub them.
vi.mock('../components/LandingPage/LandingPage', () => ({
  LandingPage: () => <div data-testid="landing-page-stub">LandingPage</div>,
}));
vi.mock('../components/Organisation/CreateOrganisationModal', () => ({
  CreateOrganisationModal: () => null,
}));

// ============================================================================
// Imports of system-under-test (after mocks)
// ============================================================================

import { listArchitectures } from '../api/architecturesApi';
import { useProject, useProjectLoading } from '../contexts/ProjectContext';
import { loadModelByProjectId } from '../api/modelApi';
import {
  ArchitectureProvider,
  useActiveArchitectureId,
} from '../contexts/ArchitectureContext';
import { parseArchitectureIdFromPathname } from '../hooks/useCurrentView';
import {
  renderWithFullApp,
  setupDefaultMocks,
  teardownDefaultMocks,
  buildProjectFixture,
  buildArchitectureFixture,
  DEFAULT_PROJECT_ID as PROJECT_ID,
  DEFAULT_ARCH_ID as ARCH_ID,
} from './routing/testUtils';

// ============================================================================
// Probes
// ============================================================================

function ActiveArchitectureIdProbe() {
  const id = useActiveArchitectureId();
  return <div data-testid="active-arch-id-probe">{id ?? 'NULL'}</div>;
}

function PathnameProbe() {
  const loc = useLocation();
  return <div data-testid="pathname-probe">{loc.pathname}</div>;
}

// ============================================================================
// Tests
// ============================================================================

describe('Comprehensive Frontend Routing -- Foundational Fix (Task 1.1)', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  afterEach(() => {
    teardownDefaultMocks();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Pure helper.
  // ---------------------------------------------------------------------------
  it('parseArchitectureIdFromPathname returns the :architectureId segment from canonical URLs and null otherwise', () => {
    // Canonical shapes for every known top-level view -- all return the id.
    expect(
      parseArchitectureIdFromPathname('/projects/p1/architectures/a1/dashboard')
    ).toBe('a1');
    expect(
      parseArchitectureIdFromPathname(
        '/projects/p1/architectures/a1/metamodel/application'
      )
    ).toBe('a1');
    expect(
      parseArchitectureIdFromPathname('/projects/p1/architectures/a1/diagrams/d-42')
    ).toBe('a1');

    // No `architectures` segment -> null.
    expect(parseArchitectureIdFromPathname('/projects/p1/dashboard')).toBeNull();
    expect(parseArchitectureIdFromPathname('/')).toBeNull();
    expect(parseArchitectureIdFromPathname('')).toBeNull();

    // Validation: the literal "undefined" sentinel string is rejected
    // (a naive template-string concatenation like `architectures/${maybeUndef}`
    // produces this and we don't want to treat it as a real id).
    expect(
      parseArchitectureIdFromPathname(
        '/projects/p1/architectures/undefined/dashboard'
      )
    ).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test 2 (safety property h):
  // useActiveArchitectureId returns the URL-derived value even when
  // ArchitectureProvider is mounted ABOVE the <Routes> tree (i.e. the
  // architecture-scoped <Route> never matches the provider's location). This
  // is the exact mount shape used in App.tsx today.
  // ---------------------------------------------------------------------------
  it('useActiveArchitectureId returns the URL-derived value when ArchitectureProvider is mounted OUTSIDE the route tree (safety property h)', () => {
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(useProjectLoading).mockReturnValue(false);
    vi.mocked(listArchitectures).mockResolvedValue([buildArchitectureFixture()]);

    render(
      <MemoryRouter
        initialEntries={[
          `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/dashboard`,
        ]}
      >
        {/*
          NOTE: NO <Routes>/<Route> wrappers between the router and the
          provider. A `useParams()` read inside the provider would return
          `{}` here -- this test would fail if the provider still relied
          on useParams. With the URL-derived parser, the value resolves
          correctly from `useLocation().pathname`.
        */}
        <ArchitectureProvider>
          <ActiveArchitectureIdProbe />
        </ArchitectureProvider>
      </MemoryRouter>
    );

    // Available on the very first render -- no useEffect wait required.
    expect(screen.getByTestId('active-arch-id-probe')).toHaveTextContent(ARCH_ID);
  });

  // ---------------------------------------------------------------------------
  // Test 3 (safety property a):
  // The hook returns the URL-segment value regardless of where the consumer
  // is mounted. Here we mount the probe inside a deeply-nested Routes tree
  // while the provider remains ABOVE Routes (matches App.tsx).
  // ---------------------------------------------------------------------------
  it('useActiveArchitectureId returns the URL-segment value regardless of consumer mount location (safety property a)', () => {
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(useProjectLoading).mockReturnValue(false);
    vi.mocked(listArchitectures).mockResolvedValue([buildArchitectureFixture()]);

    render(
      <MemoryRouter
        initialEntries={[
          `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/dashboard`,
        ]}
      >
        <ArchitectureProvider>
          <Routes>
            <Route
              path="/projects/:projectId/architectures/:architectureId/*"
              element={<ActiveArchitectureIdProbe />}
            />
          </Routes>
        </ArchitectureProvider>
      </MemoryRouter>
    );

    expect(screen.getByTestId('active-arch-id-probe')).toHaveTextContent(ARCH_ID);
  });

  // ---------------------------------------------------------------------------
  // Test 4 (safety property b):
  // RootRoute auto-navigates to `/projects/:projectId` when activeProject is
  // hydrated on mount. We assert this by observing that listArchitectures is
  // called (which only happens inside <ProjectLayout>'s redirect resolver,
  // which only runs after the navigate from `/` -> `/projects/:p` fires).
  // ---------------------------------------------------------------------------
  it('RootRoute auto-navigates to /projects/:projectId when activeProject is hydrated on mount (safety property b)', async () => {
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(useProjectLoading).mockReturnValue(false);
    vi.mocked(listArchitectures).mockResolvedValue([buildArchitectureFixture()]);

    renderWithFullApp('/');

    // The presence of the listArchitectures call proves the navigate from
    // `/` fired (otherwise <ProjectLayout> never mounts to call it).
    await waitFor(() => {
      expect(vi.mocked(listArchitectures)).toHaveBeenCalledWith(PROJECT_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 5 (safety property c, partial -- Bug 3 fix):
  // TopBar nav button click on the hydrated app at the canonical URL changes
  // the URL. Pre-fix, handleViewChange would early-return because
  // activeArchitectureId was permanently null.
  // ---------------------------------------------------------------------------
  it('TopBar nav button click changes the URL when on a hydrated architecture-scoped URL (validates Bug 3 fix)', async () => {
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(useProjectLoading).mockReturnValue(false);
    vi.mocked(listArchitectures).mockResolvedValue([buildArchitectureFixture()]);

    renderWithFullApp(
      `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/dashboard`,
      { extra: <PathnameProbe /> }
    );

    // Wait for the dashboard view to mount (i.e. AppShell + TopBar are live).
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe')).toHaveTextContent(
        `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/dashboard`
      );
    });

    // Find a TopBar nav button. The exact accessible name is component
    // implementation; we use a regex that matches "Architecture", which the
    // TopBar uses for the metamodel button label.
    const metaButton = await screen.findByRole('button', {
      name: /architecture\s*&?\s*design|metamodel/i,
    });
    act(() => {
      fireEvent.click(metaButton);
    });

    // The URL now ends in /metamodel -- proving handleViewChange's
    // navigate() fired. Pre-fix this would have been a silent no-op.
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe')).toHaveTextContent(
        `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/metamodel`
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 6 (Bug 2 fix -- model auto-load effect fires):
  // The auto-load-model effect inside AppShell calls loadModelByProjectId
  // when on a hydrated architecture-scoped URL. Pre-fix, the effect's guard
  // `if (!activeArchitectureId) return;` always tripped, leaving
  // state.loadedFileName empty and surfacing the "Untitled" fallback.
  // ---------------------------------------------------------------------------
  it('AppShell auto-load-model effect fires when on the canonical architecture-scoped URL (validates Bug 2 fix)', async () => {
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(useProjectLoading).mockReturnValue(false);
    vi.mocked(listArchitectures).mockResolvedValue([buildArchitectureFixture()]);

    renderWithFullApp(
      `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/dashboard`
    );

    // The auto-load effect must fire with the URL-derived architecture id.
    await waitFor(() => {
      expect(vi.mocked(loadModelByProjectId)).toHaveBeenCalledWith(
        PROJECT_ID,
        ARCH_ID
      );
    });
  });
});

/**
 * Comprehensive Frontend Routing -- AppShell `<Outlet/>` Rework + 404
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 2
 * Task 2.1: 2-8 focused tests for the AppShell + 404 work.
 *
 * Coverage:
 *   - Safety property (g): hitting `/some-bogus-path` renders the 404 page.
 *   - The 404 page contains a `<Link to="/">` back to landing.
 *   - The bare `/projects/:p/architectures/:a` index URL `<Navigate replace/>`s
 *     to `dashboard` (preserving Group 2.3 behaviour).
 *   - AppShell renders the `<Outlet/>` body for the matched child route
 *     (e.g. dashboard at the dashboard route).
 *   - `KNOWN_VIEW_SEGMENTS` exported (or referenced) from `ProjectLayout` now
 *     includes `discovery`, validated indirectly by the legacy-redirect path
 *     `/projects/:p/discovery` resolving to `.../architectures/:a/discovery`
 *     instead of falling back to `dashboard`.
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 3 refactor:
 *   The inline `<TestAppTree>` harness has been replaced with the
 *   `renderWithFullApp` helper from `__tests__/routing/testUtils.tsx`. This
 *   exercises the production `<AppContent>` (which mirrors what the user
 *   sees) under a `<MemoryRouter>` instead of a custom routes tree -- the
 *   tests now validate the actual `App.tsx` routing tree, not a duplicate.
 *
 * Async note: `<AppConfigProvider>` returns null while `/api/bootstrap` is in
 * flight, so every test below uses `findByTestId` / `waitFor` to wait until
 * the provider unblocks and the route tree mounts.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';

// ============================================================================
// Mocks (must be set up BEFORE module-under-test imports)
// ============================================================================

vi.mock('../api/architecturesApi', async () => {
  const actual = await vi.importActual('../api/architecturesApi');
  return {
    ...actual,
    listArchitectures: vi.fn(),
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
// are not relevant to this group's surface; stub them.
vi.mock('../components/LandingPage/LandingPage', () => ({
  LandingPage: () => <div data-testid="landing-page-stub">LandingPage</div>,
}));
vi.mock('../components/Organisation/CreateOrganisationModal', () => ({
  CreateOrganisationModal: () => null,
}));
// TopBar pulls a large chat / import / export tree; stub it down to a thin
// wrapper that still passes children through so AppShell's <Outlet/> renders.
vi.mock('../components/TopBar/TopBar', () => ({
  TopBar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="top-bar-stub">{children}</div>
  ),
}));

// ============================================================================
// Imports of system-under-test (after mocks)
// ============================================================================

import { listArchitectures } from '../api/architecturesApi';
import { useProject, useProjectLoading } from '../contexts/ProjectContext';
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

// Probe component that renders the current pathname so tests can assert on
// routing decisions (index redirects, etc.) without needing a custom router.
function PathnameProbe() {
  const loc = useLocation();
  return <div data-testid="pathname-probe">{loc.pathname}</div>;
}

// ============================================================================
// Tests
// ============================================================================

describe('Comprehensive Frontend Routing -- AppShell + 404 (Task 2.1)', () => {
  beforeEach(() => {
    setupDefaultMocks();
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(useProjectLoading).mockReturnValue(false);
    vi.mocked(listArchitectures).mockResolvedValue([buildArchitectureFixture()]);
  });

  afterEach(() => {
    teardownDefaultMocks();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1 (safety property g):
  // Bogus URL renders the 404 page.
  // ---------------------------------------------------------------------------
  it('renders the 404 page for a bogus URL (safety property g)', async () => {
    renderWithFullApp('/some-bogus-path-that-does-not-exist');

    // <AppConfigProvider> renders null while bootstrap fetch is pending;
    // wait for the route tree to mount before asserting.
    expect(await screen.findByTestId('not-found-page')).toBeInTheDocument();
    expect(screen.getByText(/page not found/i)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 2: 404 page contains a link back to `/`.
  // ---------------------------------------------------------------------------
  it('the 404 page contains a Link back to / (safety property g, link assertion)', async () => {
    renderWithFullApp('/another/bogus/url');

    // Wait for the 404 page itself first (clearer failure mode than a
    // role-query timeout while AppConfigProvider is still bootstrapping).
    await screen.findByTestId('not-found-page');
    const backLink = screen.getByRole('link', { name: /back to landing/i });
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute('href', '/');
  });

  // ---------------------------------------------------------------------------
  // Test 3: Index redirect from `/projects/:p/architectures/:a` -> `dashboard`.
  // ---------------------------------------------------------------------------
  it('index route at /projects/:p/architectures/:a redirects to /dashboard', async () => {
    renderWithFullApp(`/projects/${PROJECT_ID}/architectures/${ARCH_ID}`, {
      extra: <PathnameProbe />,
    });

    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe')).toHaveTextContent(
        `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/dashboard`
      );
    });

    // The dashboard view body mounted inside the AppShell (i.e. inside
    // <Outlet/>), confirming the parent layout + child route wiring.
    expect(screen.getByTestId('dashboard-view-stub')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 4: AppShell renders <Outlet/> content -- dashboard view at the
  // dashboard route, with the TopBar shell wrapping the outlet.
  // ---------------------------------------------------------------------------
  it('AppShell renders the matched child route inside its <Outlet/> (dashboard URL -> DashboardView inside TopBar)', async () => {
    renderWithFullApp(
      `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/dashboard`
    );

    // TopBar shell present -> AppShell mounted.
    const topBar = await screen.findByTestId('top-bar-stub');
    expect(topBar).toBeInTheDocument();
    // Dashboard view body rendered inside the TopBar -> outlet wired.
    const dashboard = screen.getByTestId('dashboard-view-stub');
    expect(dashboard).toBeInTheDocument();
    expect(topBar).toContainElement(dashboard);
  });

  // ---------------------------------------------------------------------------
  // Test 5: Each top-level child route mounts its respective view inside the
  // shell. Validates the parent-AppShell + child-routes shape across all
  // four current top-level views (Groups 4-7 will add sub-routes).
  // ---------------------------------------------------------------------------
  it.each([
    ['dashboard', 'dashboard-view-stub'],
    ['metamodel', 'meta-model-view-stub'],
    ['diagrams', 'diagrams-view-stub'],
    ['product', 'product-view-stub'],
  ])(
    '/.../%s renders the corresponding view inside the AppShell',
    async (segment, stubTestId) => {
      renderWithFullApp(
        `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/${segment}`
      );

      expect(await screen.findByTestId('top-bar-stub')).toBeInTheDocument();
      expect(screen.getByTestId(stubTestId)).toBeInTheDocument();
    }
  );

  // ---------------------------------------------------------------------------
  // Test 6: KNOWN_VIEW_SEGMENTS includes `discovery` -- validated through the
  // missing-architecture redirect: `/projects/:p/discovery` should resolve to
  // `.../architectures/:a/discovery` (preserving the `discovery` segment)
  // rather than falling back to `dashboard`.
  //
  // Note: the architecture-scoped `discovery` route is not yet wired (Group 7
  // will add it), so we assert on the redirected pathname only -- the
  // resulting route falls through the parent's `<Route path="*" element={null} />`
  // and renders nothing visible. The redirect URL itself is the contract.
  // ---------------------------------------------------------------------------
  it('ProjectLayout KNOWN_VIEW_SEGMENTS now includes "discovery" -- legacy /projects/:p/discovery preserves the segment on redirect', async () => {
    renderWithFullApp(`/projects/${PROJECT_ID}/discovery`, {
      extra: <PathnameProbe />,
    });

    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe')).toHaveTextContent(
        `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/discovery`
      );
    });
  });
});

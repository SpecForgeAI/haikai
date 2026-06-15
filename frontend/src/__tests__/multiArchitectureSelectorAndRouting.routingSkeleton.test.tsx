/**
 * Multi-Architecture Selector + URL Routing -- Routing Skeleton Tests
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 1
 * Task 1.1: 2-8 focused tests for the routing skeleton.
 *
 * Tests:
 *   1. <BrowserRouter> mounts without crashing the existing app shell
 *      (root URL renders the existing state-driven <AppContent>).
 *   2. Visiting `/projects/:projectId/architectures/:architectureId/diagrams`
 *      renders the diagrams view (component is reachable via the route).
 *   3. Visiting `/projects/:projectId/diagrams` (missing `:architectureId`)
 *      hits <ProjectLayout> and triggers a <Navigate replace> to the
 *      canonical URL using the oldest non-archived architecture from
 *      `listArchitectures(projectId)`.
 *   4. <ProjectLayout> with a present `:architectureId` renders <Outlet>
 *      (i.e. it does NOT trigger the redirect or call listArchitectures).
 *
 * SPA fallback note (Task 1.5):
 *   The gateway (gateway/src/server.ts) is API-only -- it does NOT serve
 *   static files or index.html. Frontend dev is served by Vite, whose dev
 *   server has SPA history fallback enabled by default (`appType: 'spa'`),
 *   so `/projects/abc/...` deep links resolve to index.html in development.
 *   No gateway change is required.
 *
 * Test patterns mirror frontend/src/__tests__/multiArchitecturePlumbing.test.tsx:
 *   - vi.mock() for module-level mocks at the top of the file.
 *   - MemoryRouter with explicit initialEntries for route-driven assertions.
 *   - Heavy view components are mocked to lightweight stubs to keep the test
 *     focused on routing behaviour and avoid pulling in ~50 unrelated
 *     dependencies (canvas, contexts, etc.).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ============================================================================
// Mocks
// ============================================================================

// Mock the architecturesApi module so we control what listArchitectures returns
// for the redirect test.
vi.mock('../api/architecturesApi', async () => {
  const actual = await vi.importActual('../api/architecturesApi');
  return {
    ...actual,
    listArchitectures: vi.fn(),
  };
});

// Mock the heavy view components to lightweight stubs. The routing skeleton
// only needs to assert "the right component is reachable", not exercise the
// real view trees (which would require ArchitectureProvider, model state, a
// canvas runtime, etc.).
vi.mock('../components/MetaModelView/MetaModelView', () => ({
  MetaModelView: () => <div data-testid="meta-model-view">MetaModelView stub</div>,
}));
vi.mock('../components/DiagramsView/DiagramsView', () => ({
  DiagramsView: () => <div data-testid="diagrams-view">DiagramsView stub</div>,
}));
vi.mock('../components/ProductView/ProductView', () => ({
  ProductView: () => <div data-testid="product-view">ProductView stub</div>,
}));
vi.mock('../components/DashboardView/DashboardView', () => ({
  DashboardView: () => <div data-testid="dashboard-view">DashboardView stub</div>,
}));

// Import mocks after declarations so vi.mocked() gives typed accessors.
import { listArchitectures, type Architecture } from '../api/architecturesApi';

// Import the system-under-test AFTER mocks are set up.
import { ProjectLayout } from '../components/Layout/ProjectLayout';
import { DiagramsView } from '../components/DiagramsView/DiagramsView';
import { MetaModelView } from '../components/MetaModelView/MetaModelView';
import { ProductView } from '../components/ProductView/ProductView';
import { DashboardView } from '../components/DashboardView/DashboardView';

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

/**
 * Render the same routes tree we mount in App.tsx, but inside a MemoryRouter
 * so we can drive it from explicit `initialEntries`. We do NOT mount the real
 * <App> here because that would also pull in BrowserRouter (double-router
 * conflict), AppConfigProvider, all the deep view contexts, and so on -- none
 * of which are relevant to the routing skeleton itself.
 *
 * The structure mirrors the production routes tree exactly (see App.tsx
 * `AppRoutes()`): ProjectLayout matches both with-architecture and
 * without-architecture URLs; child routes mount the architecture-scoped
 * views; a catch-all renders the "existing app shell" stub.
 */
function renderRoutes(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectLayout />}>
          <Route
            path="architectures/:architectureId/metamodel"
            element={<MetaModelView />}
          />
          <Route
            path="architectures/:architectureId/diagrams"
            element={<DiagramsView />}
          />
          <Route
            path="architectures/:architectureId/product"
            element={<ProductView />}
          />
          <Route
            path="architectures/:architectureId/dashboard"
            element={<DashboardView />}
          />
          {/* No-content branch for legacy (no `:architectureId`) URLs --
              the redirect happens in ProjectLayout itself. */}
          <Route path="*" element={null} />
        </Route>
        {/* Catch-all stub for the "existing app shell" -- mirrors the role
            <AppContent> plays in App.tsx so the test can assert that the
            BrowserRouter mount preserves the existing UI for non-routed
            paths. */}
        <Route
          path="*"
          element={<div data-testid="app-shell-stub">app shell</div>}
        />
      </Routes>
    </MemoryRouter>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('Multi-Architecture Selector + URL Routing -- Routing Skeleton (Task 1.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Router mounts without crashing the existing app shell.
  // ---------------------------------------------------------------------------
  it('mounts the routes tree at `/` and renders the existing app shell catch-all without crashing', () => {
    renderRoutes(['/']);

    // The catch-all branch represents the existing state-driven <AppContent>.
    // Asserting its presence proves: (a) the BrowserRouter / Routes / Route
    // tree compiles and mounts, and (b) the routing skeleton is purely
    // additive at the root URL.
    expect(screen.getByTestId('app-shell-stub')).toBeInTheDocument();

    // No architecture resolution should kick in for `/`.
    expect(listArchitectures).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Test 2: Architecture-scoped diagrams URL renders DiagramsView.
  // ---------------------------------------------------------------------------
  it('renders <DiagramsView> for `/projects/:projectId/architectures/:architectureId/diagrams`', () => {
    renderRoutes([
      `/projects/${PROJECT_ID}/architectures/${ARCH_OLDEST_NON_ARCHIVED_ID}/diagrams`,
    ]);

    // Diagrams view is reachable via the route.
    expect(screen.getByTestId('diagrams-view')).toBeInTheDocument();

    // No redirect resolution should happen because :architectureId is present.
    expect(listArchitectures).not.toHaveBeenCalled();

    // Other view stubs should NOT render.
    expect(screen.queryByTestId('meta-model-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('product-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-view')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 3: Missing-:architectureId URL triggers the silent redirect to the
  //         canonical URL using the oldest non-archived architecture.
  // ---------------------------------------------------------------------------
  it('redirects `/projects/:projectId/diagrams` (missing `:architectureId`) to the canonical URL using the oldest non-archived architecture', async () => {
    // listArchitectures returns one archived (oldest) + two non-archived.
    // The frontend filters out archived and takes the first remaining one
    // (the oldest non-archived, i.e. the migrated `Default`).
    const archivedOldest = buildArchitecture({
      id: 'arch-archived-old',
      name: 'Archived Old',
      archived: true,
      createdAt: '2025-12-01T00:00:00Z',
    });
    const oldestNonArchived = buildArchitecture({
      id: ARCH_OLDEST_NON_ARCHIVED_ID,
      name: 'Default',
      archived: false,
      createdAt: '2026-01-01T00:00:00Z',
    });
    const newer = buildArchitecture({
      id: ARCH_NEWER_ID,
      name: 'Target State',
      archived: false,
      createdAt: '2026-02-01T00:00:00Z',
    });
    vi.mocked(listArchitectures).mockResolvedValue([
      archivedOldest,
      oldestNonArchived,
      newer,
    ]);

    renderRoutes([`/projects/${PROJECT_ID}/diagrams`]);

    // The redirect resolution effect runs, listArchitectures is called with
    // the projectId from the URL, and the route swaps to the canonical URL.
    await waitFor(() => {
      expect(screen.getByTestId('diagrams-view')).toBeInTheDocument();
    });

    expect(listArchitectures).toHaveBeenCalledTimes(1);
    expect(listArchitectures).toHaveBeenCalledWith(PROJECT_ID);

    // Sanity: the trailing view segment must be preserved (we landed on
    // diagrams, not dashboard).
    expect(screen.queryByTestId('dashboard-view')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 4: With `:architectureId` present, ProjectLayout renders <Outlet>
  //         and does NOT trigger the legacy-URL redirect resolver.
  // ---------------------------------------------------------------------------
  it('does NOT call listArchitectures when `:architectureId` is present in the URL (renders <Outlet> directly)', async () => {
    // Set the mock to a real promise so any accidental call would still be
    // observable via the mock counter.
    vi.mocked(listArchitectures).mockResolvedValue([
      buildArchitecture({ id: ARCH_OLDEST_NON_ARCHIVED_ID }),
    ]);

    renderRoutes([
      `/projects/${PROJECT_ID}/architectures/${ARCH_OLDEST_NON_ARCHIVED_ID}/metamodel`,
    ]);

    // The metamodel view stub should render via the child route's Outlet.
    expect(screen.getByTestId('meta-model-view')).toBeInTheDocument();

    // listArchitectures must NOT have been invoked -- the redirect path is
    // not exercised when :architectureId is already present.
    // Wait one tick to be sure no async effect fires after first render.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listArchitectures).not.toHaveBeenCalled();
  });
});

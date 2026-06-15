/**
 * Comprehensive Frontend Routing -- renderWithFullApp Helper Tests
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 3 (Task 3.1)
 *
 * 2-8 focused tests exercising the helper itself:
 *
 *   - `renderWithFullApp('/')` mounts the landing page (DB mode + no active
 *     project fixture) without crashing.
 *   - `renderWithFullApp('/projects/p/architectures/a/dashboard')` mounts
 *     `<DashboardView/>` inside `<AppShell/>` with the URL-derived
 *     architecture id available via `useActiveArchitectureId`.
 *   - `renderWithFullApp('/some-bogus-path')` mounts the 404 page via the
 *     catch-all route.
 *   - The helper does NOT mount a second router on top of `<AppContent>`'s
 *     production `<BrowserRouter>` (there is only ONE router in the rendered
 *     tree -- the `<MemoryRouter>` from the helper).
 *   - The helper exposes `user` (`userEvent.setup()`) for interaction tests
 *     in downstream groups.
 *
 * The provider-outside-routes regression test (safety property h) lives in
 * a separate file (`architectureProviderUrlDerivation.test.tsx`) so the bug
 * class has its own dedicated regression suite.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

// ============================================================================
// Mocks (must be set up BEFORE module-under-test imports)
// ============================================================================

vi.mock('../../api/architecturesApi', async () => {
  const actual = await vi.importActual('../../api/architecturesApi');
  return {
    ...actual,
    listArchitectures: vi.fn(),
  };
});

vi.mock('../../contexts/ProjectContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/ProjectContext')>(
    '../../contexts/ProjectContext'
  );
  return {
    ...actual,
    useProject: vi.fn(),
    useProjectLoading: vi.fn(),
  };
});

vi.mock('../../api/modelApi', async () => {
  const actual = await vi.importActual('../../api/modelApi');
  return {
    ...actual,
    loadModelByProjectId: vi.fn(),
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

// Heavy view stubs.
vi.mock('../../components/DashboardView/DashboardView', async () => {
  const archCtx = await vi.importActual<
    typeof import('../../contexts/ArchitectureContext')
  >('../../contexts/ArchitectureContext');
  return {
    DashboardView: () => {
      const id = archCtx.useActiveArchitectureId();
      return (
        <div data-testid="dashboard-view-stub">
          <span data-testid="dashboard-arch-id-probe">{id ?? 'NULL'}</span>
        </div>
      );
    },
  };
});
vi.mock('../../components/MetaModelView/MetaModelView', () => ({
  MetaModelView: () => <div data-testid="meta-model-view-stub" />,
}));
vi.mock('../../components/DiagramsView/DiagramsView', () => ({
  DiagramsView: () => <div data-testid="diagrams-view-stub" />,
}));
vi.mock('../../components/ProductView/ProductView', () => ({
  ProductView: () => <div data-testid="product-view-stub" />,
}));
vi.mock('../../components/LandingPage/LandingPage', () => ({
  LandingPage: () => <div data-testid="landing-page-stub" />,
}));
vi.mock('../../components/Organisation/CreateOrganisationModal', () => ({
  CreateOrganisationModal: () => null,
}));
vi.mock('../../components/TopBar/TopBar', () => ({
  TopBar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="top-bar-stub">{children}</div>
  ),
}));

// ============================================================================
// Imports of system-under-test (after mocks)
// ============================================================================

import { useProject, useProjectLoading } from '../../contexts/ProjectContext';
import { listArchitectures } from '../../api/architecturesApi';
import {
  renderWithFullApp,
  setupDefaultMocks,
  teardownDefaultMocks,
  buildProjectFixture,
  buildArchitectureFixture,
  DEFAULT_PROJECT_ID,
  DEFAULT_ARCH_ID,
} from './testUtils';

// ============================================================================
// Tests
// ============================================================================

describe('Comprehensive Frontend Routing -- renderWithFullApp Helper (Task 3.1)', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  afterEach(() => {
    teardownDefaultMocks();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: bare `/` mounts the LandingPage when no active project.
  //
  // setupDefaultMocks() returns null from useProject() by default, so the
  // RootRoute falls through to the LandingPage branch.
  // ---------------------------------------------------------------------------
  it('renderWithFullApp("/") mounts the LandingPage when no active project', async () => {
    renderWithFullApp('/');

    // <AppConfigProvider> blocks render until /api/bootstrap resolves.
    expect(await screen.findByTestId('landing-page-stub')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 2: bare `/` with a hydrated active project auto-navigates and
  // ultimately lands on the dashboard.
  //
  // Validates the helper threads through the RootRoute auto-navigate effect
  // (Group 1 safety property b) + the ProjectLayout missing-architecture
  // redirect chain.
  // ---------------------------------------------------------------------------
  it('renderWithFullApp("/") with a hydrated project auto-navigates to the dashboard', async () => {
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(useProjectLoading).mockReturnValue(false);
    vi.mocked(listArchitectures).mockResolvedValue([buildArchitectureFixture()]);

    renderWithFullApp('/');

    // The auto-navigate effect fires once activeProject is hydrated;
    // ProjectLayout then resolves the missing-architecture redirect via
    // listArchitectures and chains to the canonical dashboard URL.
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-view-stub')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Test 3: canonical architecture-scoped URL mounts DashboardView with the
  // URL-derived architecture id available immediately.
  // ---------------------------------------------------------------------------
  it('renderWithFullApp("/projects/X/architectures/Y/dashboard") mounts DashboardView inside the AppShell with the URL-derived arch id', async () => {
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(useProjectLoading).mockReturnValue(false);

    renderWithFullApp(
      `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}/dashboard`
    );

    // Wait for the dashboard view to mount.
    const dashboard = await screen.findByTestId('dashboard-view-stub');
    expect(dashboard).toBeInTheDocument();

    // AppShell wraps the dashboard.
    const topBar = screen.getByTestId('top-bar-stub');
    expect(topBar).toContainElement(dashboard);

    // URL-derived architecture id is exposed via useActiveArchitectureId()
    // through the provider hierarchy (proves Group 1 fix is wired).
    expect(screen.getByTestId('dashboard-arch-id-probe')).toHaveTextContent(
      DEFAULT_ARCH_ID
    );
  });

  // ---------------------------------------------------------------------------
  // Test 4: bogus URL renders the 404 page (safety property g via the helper).
  //
  // Mirrors the Group 2 test but proves the same outcome via the helper, so
  // downstream groups can rely on `renderWithFullApp` for their not-found
  // assertions.
  // ---------------------------------------------------------------------------
  it('renderWithFullApp("/some-bogus-path") shows the 404 page', async () => {
    renderWithFullApp('/some-bogus-path-that-does-not-exist');

    expect(await screen.findByTestId('not-found-page')).toBeInTheDocument();
    expect(screen.getByText(/page not found/i)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 5: helper exposes `user` (userEvent.setup() handle) so downstream
  // tests can drive interactions.
  // ---------------------------------------------------------------------------
  it('renderWithFullApp returns a `user` handle (userEvent.setup) for interaction tests', () => {
    const result = renderWithFullApp('/');
    expect(result.user).toBeDefined();
    // userEvent.setup() returns an object with click / type / etc methods.
    expect(typeof result.user.click).toBe('function');
    expect(typeof result.user.type).toBe('function');
  });

  // ---------------------------------------------------------------------------
  // Test 6: helper does NOT nest a second router. Production <App> wraps
  // <AppContent> in <BrowserRouter>; the helper wraps <AppContent> in
  // <MemoryRouter>. Nesting two routers is a React Router error (warning at
  // dev time, undefined behaviour at runtime).
  //
  // The console.error spy proves the helper renders cleanly with NO router-
  // nesting warning.
  // ---------------------------------------------------------------------------
  it('renderWithFullApp does NOT mount a second router (no router-nesting warnings)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderWithFullApp('/');
    await screen.findByTestId('landing-page-stub');

    // Look for any error mentioning "Router" cannot be inside another
    // "Router" (the canonical react-router warning text).
    const routerNestingWarnings = errorSpy.mock.calls.filter(call => {
      const message = String(call[0] ?? '');
      return /You cannot render a <Router> inside another <Router>/i.test(message);
    });
    expect(routerNestingWarnings).toHaveLength(0);

    errorSpy.mockRestore();
  });
});

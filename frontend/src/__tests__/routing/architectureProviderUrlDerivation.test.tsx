/**
 * Comprehensive Frontend Routing -- Provider-Outside-Routes Regression Test
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 3 (Task 3.4)
 *
 * Direct, canonical regression test for the bug class fixed by Group 1
 * (safety property h):
 *
 *   "A context using `useLocation()`-based parsing returns the URL-derived
 *    value when mounted OUTSIDE the route tree."
 *
 * Why this matters: in `App.tsx` the `<ArchitectureProvider>` is mounted
 * ABOVE `<AppRoutes>` (i.e. above any `<Route>` elements). A naive
 * `useParams()` read inside the provider therefore returns `{}`, and
 * `useActiveArchitectureId()` is permanently `null` regardless of URL.
 * Group 1 fixed this by switching to `parseArchitectureIdFromPathname(
 * useLocation().pathname)` -- which works at any nesting depth as long as
 * the consumer sits inside SOME router.
 *
 * This file exercises the bug class via three complementary tests:
 *
 *   1. `useParams()` outside `<Routes>` returns `{}` -- demonstrates HOW the
 *      OLD pattern would silently fail. Acts as living documentation: any
 *      future contributor who forgets the fix and reaches for `useParams()`
 *      from a provider above `<Routes>` will see this test.
 *
 *   2. `useActiveArchitectureId()` reads the URL-derived value via the full
 *      `<App>` mount through `renderWithFullApp` -- proves the NEW pattern
 *      works in the production provider hierarchy AND that the test
 *      infrastructure is wired correctly end-to-end.
 *
 *   3. The bare-metal version: `<ArchitectureProvider>` mounted directly
 *      under `<MemoryRouter>` (NO `<Routes>` between them) still resolves
 *      `:architectureId` from the URL on first render.
 *
 * Tests (2) and (3) are the canonical safety-property-(h) regression tests
 * cited in tasks.md.
 */

import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useParams, useLocation } from 'react-router-dom';

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

// Heavy view stubs so the route bodies mount fast. The DashboardView stub
// embeds the architecture-id probe inline so we can assert on the URL-derived
// value via the full <AppContent> hierarchy.
vi.mock('../../components/DashboardView/DashboardView', async () => {
  const archCtx = await vi.importActual<
    typeof import('../../contexts/ArchitectureContext')
  >('../../contexts/ArchitectureContext');
  return {
    DashboardView: () => {
      const id = archCtx.useActiveArchitectureId();
      return (
        <div data-testid="dashboard-view-stub">
          <div data-testid="active-arch-id-probe">{id ?? 'NULL'}</div>
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

import {
  ArchitectureProvider,
  useActiveArchitectureId,
} from '../../contexts/ArchitectureContext';
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
// Probe components
// ============================================================================

/**
 * Probe that reads `useParams()` and `useLocation().pathname` simultaneously
 * so we can assert that the OLD pattern (`useParams()`) returns `{}` while
 * the NEW pattern (`useLocation()`) successfully exposes the URL.
 */
function ParamsVsLocationProbe() {
  const params = useParams();
  const loc = useLocation();
  return (
    <div>
      <div data-testid="params-keys-probe">
        {Object.keys(params).length === 0 ? 'EMPTY' : Object.keys(params).join(',')}
      </div>
      <div data-testid="location-pathname-probe">{loc.pathname}</div>
    </div>
  );
}

/**
 * Probe that captures `useActiveArchitectureId()` on the FIRST render via a
 * ref. The ref captures the value at first mount so we can prove the value
 * is available without any `useEffect` wait -- tests safety property (a)
 * end-to-end through the full provider hierarchy.
 */
function ActiveArchIdProbe() {
  const id = useActiveArchitectureId();
  const firstRenderRef = useRef<string | null>(id);
  return (
    <>
      <div data-testid="active-arch-id-probe">{id ?? 'NULL'}</div>
      <div data-testid="active-arch-id-first-render-probe">
        {firstRenderRef.current ?? 'NULL'}
      </div>
    </>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('Comprehensive Frontend Routing -- Provider-Outside-Routes Regression (Task 3.4)', () => {
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
  // Test 1 (the OLD bug pattern -- demonstrates failure mode):
  // A consumer using `useParams()` mounted directly under `<MemoryRouter>`
  // (i.e. with NO `<Routes>` between the router and the consumer) gets back
  // an empty object. This is exactly the situation `<ArchitectureProvider>`
  // was in pre-Group-1.
  // ---------------------------------------------------------------------------
  it('useParams() outside <Routes> returns empty -- demonstrates the OLD bug pattern', () => {
    render(
      <MemoryRouter
        initialEntries={[
          `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}/dashboard`,
        ]}
      >
        <ParamsVsLocationProbe />
      </MemoryRouter>
    );

    // useParams() returns {} -- pre-Group-1, this is what
    // <ArchitectureProvider> was getting, and why
    // useActiveArchitectureId() was permanently null.
    expect(screen.getByTestId('params-keys-probe')).toHaveTextContent('EMPTY');

    // useLocation() works just fine -- the URL is right there, the parser
    // can read it, and the NEW Group 1 pattern hangs off this hook.
    expect(screen.getByTestId('location-pathname-probe')).toHaveTextContent(
      `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}/dashboard`
    );
  });

  // ---------------------------------------------------------------------------
  // Test 2 (the NEW pattern via the full app mount -- safety property h):
  // The full `<AppContent>` mounted at the canonical dashboard URL exposes
  // the URL-derived `:architectureId` via `useActiveArchitectureId()` --
  // even though the provider sits ABOVE `<AppRoutes>` and never sees a
  // matched `<Route>`.
  //
  // This is the canonical safety-property-(h) regression test cited in
  // tasks.md. It exercises the production provider tree end-to-end via
  // `renderWithFullApp`, which proves both the Group 1 fix AND the Group 3
  // helper infrastructure work as intended.
  // ---------------------------------------------------------------------------
  it('useActiveArchitectureId() returns the URL-derived value via renderWithFullApp -- safety property h', async () => {
    renderWithFullApp(
      `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}/dashboard`
    );

    // <AppConfigProvider> blocks render until /api/bootstrap resolves. Wait
    // for the dashboard view stub to mount before asserting on the probe.
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-view-stub')).toBeInTheDocument();
    });

    // The probe is rendered INSIDE the dashboard stub. It reads the
    // URL-derived value through useActiveArchitectureId() -- which lives on
    // ArchitectureProvider, mounted ABOVE the routes tree.
    expect(screen.getByTestId('active-arch-id-probe')).toHaveTextContent(
      DEFAULT_ARCH_ID
    );
  });

  // ---------------------------------------------------------------------------
  // Test 3 (provider mounted directly under <MemoryRouter> -- bare-metal
  // version of safety property h):
  // Demonstrate that `<ArchitectureProvider>` itself, when mounted with
  // NO <Routes> between it and the router, correctly resolves the
  // architecture id from the URL. This is the smallest possible
  // reproduction of the bug class and matches the exact mount shape of
  // App.tsx.
  // ---------------------------------------------------------------------------
  it('ArchitectureProvider mounted directly under <MemoryRouter> resolves architectureId from URL on first render', () => {
    render(
      <MemoryRouter
        initialEntries={[
          `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}/dashboard`,
        ]}
      >
        {/* NO <Routes> -- provider sits directly under the router. */}
        <ArchitectureProvider>
          <ActiveArchIdProbe />
        </ArchitectureProvider>
      </MemoryRouter>
    );

    // First-render value (captured into a ref) -- no useEffect wait. The
    // URL-derived parser is synchronous; useActiveArchitectureId() returns
    // the right id even without a route match.
    expect(screen.getByTestId('active-arch-id-first-render-probe')).toHaveTextContent(
      DEFAULT_ARCH_ID
    );
    // Same value on the live render.
    expect(screen.getByTestId('active-arch-id-probe')).toHaveTextContent(
      DEFAULT_ARCH_ID
    );
  });
});

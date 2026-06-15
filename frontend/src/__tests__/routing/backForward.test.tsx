/**
 * Comprehensive Frontend Routing -- Browser Back/Forward Sweep
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 9 (Task 9.4)
 *
 * Cross-tier verification: simulated browser back/forward navigation across
 * the four top-level architecture-scoped views changes the active view
 * without remounting providers / AppShell. This is safety property (e) --
 * "browser back/forward changes the active sub-state without page reload"
 * -- with TOP-LEVEL coverage (per-view back/forward is already exercised
 * inside Group 5 for diagrams).
 *
 * `MemoryRouter` does not honour `window.history.back()`; we drive
 * back/forward via a `<NavController>` probe that exposes the router's
 * `useNavigate(delta)` to the test scope. Calling `navRef.current(-1)` is
 * functionally equivalent to a Back-button press for routing-history
 * purposes.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useLocation, useNavigate } from 'react-router-dom';

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

// Render portals inline.
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Heavy view stubs. Each view stub captures a stable ref to its DOM node so
// we can assert the AppShell did NOT remount across back/forward navigations.
vi.mock('../../components/DashboardView/DashboardView', () => ({
  DashboardView: () => <div data-testid="dashboard-view-stub" />,
}));
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
// Imports (after mocks)
// ============================================================================

import { useProject, useProjectLoading } from '../../contexts/ProjectContext';
import {
  renderWithFullApp,
  setupDefaultMocks,
  teardownDefaultMocks,
  buildProjectFixture,
  DEFAULT_PROJECT_ID,
  DEFAULT_ARCH_ID,
} from './testUtils';

// ============================================================================
// Helpers
// ============================================================================

const ARCH_BASE = `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}`;

function PathnameProbe() {
  const location = useLocation();
  return <div data-testid="pathname-probe">{location.pathname}</div>;
}

/**
 * Probe that exposes `useNavigate(delta)` to the test scope via a closure
 * `ref`. Used to drive back/forward since MemoryRouter does not honour
 * `window.history.back()`.
 */
function makeNavController(navRef: { current: ((delta: number) => void) | null }) {
  return function NavController() {
    const navigate = useNavigate();
    React.useEffect(() => {
      navRef.current = (delta: number) => navigate(delta);
    }, [navigate]);
    return null;
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Comprehensive Frontend Routing -- Browser Back/Forward Sweep (Task 9.4)', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  afterEach(() => {
    teardownDefaultMocks();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Back/Forward across [dashboard, metamodel, diagrams, product]
  // changes the active view without remounting AppShell.
  //
  // Seeded entries: [dashboard, metamodel, diagrams, product] starting at
  // index 3 (product). Back -> diagrams; Back -> metamodel; Back -> dashboard.
  // Forward -> metamodel; Forward -> diagrams; Forward -> product.
  //
  // The AppShell's TopBar testId is captured before/after each navigation;
  // the same DOM node persists, proving providers and shell stay mounted
  // (only the `<Outlet/>` content changes).
  //
  // Safety property (e) full coverage at the top-level granularity.
  // ---------------------------------------------------------------------------
  it('back/forward across top-level views changes the active view without remounting AppShell', async () => {
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(useProjectLoading).mockReturnValue(false);

    const navRef: { current: ((delta: number) => void) | null } = { current: null };
    const NavController = makeNavController(navRef);

    const URL_DASHBOARD = `${ARCH_BASE}/dashboard`;
    const URL_METAMODEL = `${ARCH_BASE}/metamodel`;
    const URL_DIAGRAMS = `${ARCH_BASE}/diagrams`;
    const URL_PRODUCT = `${ARCH_BASE}/product`;

    renderWithFullApp(URL_DASHBOARD, {
      additionalEntries: [URL_METAMODEL, URL_DIAGRAMS, URL_PRODUCT],
      initialIndex: 3, // start at PRODUCT
      extra: (
        <>
          <PathnameProbe />
          <NavController />
        </>
      ),
    });

    // Started at product.
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(URL_PRODUCT);
    });
    await waitFor(() => {
      expect(screen.getByTestId('product-view-stub')).toBeInTheDocument();
    });

    // Capture the AppShell instance to assert it stays mounted.
    const topBarBefore = screen.getByTestId('top-bar-stub');

    // Wait for the navigator ref to be wired.
    await waitFor(() => expect(navRef.current).not.toBeNull());

    // Back -> diagrams.
    navRef.current!(-1);
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(URL_DIAGRAMS);
    });
    await waitFor(() => {
      expect(screen.getByTestId('diagrams-view-stub')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('product-view-stub')).not.toBeInTheDocument();

    // Back -> metamodel.
    navRef.current!(-1);
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(URL_METAMODEL);
    });
    await waitFor(() => {
      expect(screen.getByTestId('meta-model-view-stub')).toBeInTheDocument();
    });

    // Back -> dashboard.
    navRef.current!(-1);
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(URL_DASHBOARD);
    });
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-view-stub')).toBeInTheDocument();
    });

    // Forward -> metamodel.
    navRef.current!(1);
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(URL_METAMODEL);
    });
    await waitFor(() => {
      expect(screen.getByTestId('meta-model-view-stub')).toBeInTheDocument();
    });

    // Forward -> diagrams.
    navRef.current!(1);
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(URL_DIAGRAMS);
    });

    // Forward -> product (back to start).
    navRef.current!(1);
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(URL_PRODUCT);
    });
    await waitFor(() => {
      expect(screen.getByTestId('product-view-stub')).toBeInTheDocument();
    });

    // The AppShell stayed mounted throughout -- providers / chrome do not
    // remount across back/forward navigations (safety property e).
    expect(screen.getByTestId('top-bar-stub')).toBe(topBarBefore);
  });
});

/**
 * Comprehensive Frontend Routing -- Product Sub-Routes
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6 (Task 6.1)
 *
 * 2-8 focused tests for the product sub-route migration:
 *   1. Pure parser unit tests (`parseProductTabFromPathname`,
 *      `parseWorkItemIdFromPathname`) plus hook smoke tests via probes.
 *   2. Bare `/.../product` redirects to `/.../product/backlog`.
 *   3. Each tab URL mounts the correct tab body inside the persistent
 *      ProductView chrome.
 *   4. Clicking a NavLink navigates to the corresponding sub-route URL.
 *   5. `/.../product/backlog/<workItemId>` mounts the backlog with the
 *      details panel pre-opened on that work item.
 *   6. `/.../product/implement/<workItemId>` mounts the Implementation
 *      Assistant for that work item.
 *   7. Browser back/forward switches tabs without remounting the
 *      ProductView chrome (safety property e for product).
 *
 * Notes:
 *   - We do NOT stub `ProductView` / `BacklogTab` / etc. -- those are the
 *     system under test. Heavy bodies (`ProductBacklogPage`,
 *     `ProductImplementPage`, `ProductRoadmapPage`, `ProductPage`) ARE
 *     stubbed because their internal data fetches and chat panels are not
 *     in scope and would slow the tests dramatically.
 *   - The tab body stubs render `data-testid="<tab>-body-stub"` plus the
 *     URL-derived workItemId so we can assert deep-link mounts.
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

// Render portals inline so any toast / menu pops appear in the test DOM tree.
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Heavy non-product views stubbed (per testUtils header recommendations).
vi.mock('../../components/DashboardView/DashboardView', () => ({
  DashboardView: () => <div data-testid="dashboard-view-stub" />,
}));
vi.mock('../../components/MetaModelView/MetaModelView', () => ({
  MetaModelView: () => <div data-testid="meta-model-view-stub" />,
}));
vi.mock('../../components/DiagramsView/DiagramsView', () => ({
  DiagramsView: () => <div data-testid="diagrams-view-stub" />,
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

// Stub the heavy product tab bodies. The wrapper components
// (MissionTab / RoadmapTab / BacklogTab / ImplementTab) and the
// ProductView layout itself are NOT stubbed -- they are the SUT.
vi.mock('../../components/ProductView/ProductPage', () => ({
  ProductPage: () => <div data-testid="mission-body-stub">Mission body</div>,
}));
vi.mock('../../components/ProductView/ProductRoadmapPage', () => ({
  ProductRoadmapPage: () => (
    <div data-testid="roadmap-body-stub">Roadmap body</div>
  ),
  // formatTimestamp is imported by ProductView.tsx for the inline status row.
  formatTimestamp: (d: Date) => d.toISOString(),
}));
vi.mock('../../components/ProductView/ProductBacklogPage', () => ({
  ProductBacklogPage: ({
    initialSelectedId,
  }: {
    initialSelectedId?: string | null;
  }) => (
    <div
      data-testid="backlog-body-stub"
      data-initial-selected-id={initialSelectedId ?? ''}
    >
      Backlog body
    </div>
  ),
}));
vi.mock('../../components/ProductView/ProductImplementPage', () => ({
  ProductImplementPage: ({
    workItemId,
    refinementMode,
  }: {
    workItemId: string | null;
    refinementMode?: string;
  }) => (
    <div
      data-testid="implement-body-stub"
      data-work-item-id={workItemId ?? ''}
      data-refinement-mode={refinementMode ?? 'standard'}
    >
      Implement body
    </div>
  ),
}));

// ProductUiStateProvider is needed but not the SUT; it has no fetches so we
// keep the real one.

// ============================================================================
// Imports of system-under-test (after mocks)
// ============================================================================

import { useProject, useProjectLoading } from '../../contexts/ProjectContext';
import {
  parseProductTabFromPathname,
  parseWorkItemIdFromPathname,
} from '../../hooks/useCurrentView';
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

const PRODUCT_BASE = `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}/product`;
const WORK_ITEM_ID = 'wi-aaaa-1111';

/**
 * Probe component that exposes the current pathname for assertions.
 */
function PathnameProbe() {
  const location = useLocation();
  return <div data-testid="pathname-probe">{location.pathname}</div>;
}

/**
 * Probe that exposes `useNavigate(delta)` to the test scope via a closure
 * `ref`. Used by the back/forward test.
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

/**
 * Render the app at the supplied URL with a hydrated active project.
 */
function renderAtUrl(url: string) {
  vi.mocked(useProject).mockReturnValue(buildProjectFixture());
  vi.mocked(useProjectLoading).mockReturnValue(false);
  return renderWithFullApp(url, { extra: <PathnameProbe /> });
}

// ============================================================================
// Tests
// ============================================================================

describe('Comprehensive Frontend Routing -- Product Sub-Routes (Task 6.1)', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  afterEach(() => {
    teardownDefaultMocks();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: pure parser unit tests for both URL parsers.
  // ---------------------------------------------------------------------------
  it('parseProductTabFromPathname / parseWorkItemIdFromPathname handle each URL shape', () => {
    // Tab parser
    expect(parseProductTabFromPathname(`${PRODUCT_BASE}/mission`)).toBe('mission');
    expect(parseProductTabFromPathname(`${PRODUCT_BASE}/roadmap`)).toBe('roadmap');
    expect(parseProductTabFromPathname(`${PRODUCT_BASE}/backlog`)).toBe('backlog');
    expect(parseProductTabFromPathname(`${PRODUCT_BASE}/backlog/${WORK_ITEM_ID}`)).toBe(
      'backlog'
    );
    expect(parseProductTabFromPathname(`${PRODUCT_BASE}/implement/${WORK_ITEM_ID}`)).toBe(
      'implement'
    );
    expect(parseProductTabFromPathname(PRODUCT_BASE)).toBeNull();
    expect(parseProductTabFromPathname(`${PRODUCT_BASE}/bogus`)).toBeNull();
    expect(parseProductTabFromPathname('/')).toBeNull();

    // Work item parser
    expect(parseWorkItemIdFromPathname(`${PRODUCT_BASE}/backlog/${WORK_ITEM_ID}`)).toBe(
      WORK_ITEM_ID
    );
    expect(parseWorkItemIdFromPathname(`${PRODUCT_BASE}/implement/${WORK_ITEM_ID}`)).toBe(
      WORK_ITEM_ID
    );
    expect(parseWorkItemIdFromPathname(`${PRODUCT_BASE}/backlog`)).toBeNull();
    expect(parseWorkItemIdFromPathname(`${PRODUCT_BASE}/mission`)).toBeNull();
    expect(parseWorkItemIdFromPathname(`${PRODUCT_BASE}/roadmap`)).toBeNull();
    // Sentinel rejection
    expect(parseWorkItemIdFromPathname(`${PRODUCT_BASE}/backlog/undefined`)).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test 2: bare `/.../product` redirects to `/.../product/backlog`.
  // ---------------------------------------------------------------------------
  it('bare /product redirects to /product/backlog', async () => {
    renderAtUrl(PRODUCT_BASE);

    await screen.findByTestId('top-bar-stub');

    // The pathname has been rewritten to the default tab.
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${PRODUCT_BASE}/backlog`
      );
    });

    // The backlog body is mounted.
    expect(screen.getByTestId('backlog-body-stub')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 3: each tab URL mounts the correct body inside the layout chrome.
  // Parameterised across the four tabs to keep within the test budget.
  // ---------------------------------------------------------------------------
  it.each([
    { url: `${PRODUCT_BASE}/mission`, bodyTestId: 'mission-body-stub' },
    { url: `${PRODUCT_BASE}/roadmap`, bodyTestId: 'roadmap-body-stub' },
    { url: `${PRODUCT_BASE}/backlog`, bodyTestId: 'backlog-body-stub' },
    {
      url: `${PRODUCT_BASE}/implement/${WORK_ITEM_ID}`,
      bodyTestId: 'implement-body-stub',
    },
  ])(
    'refresh on $url mounts the correct tab body inside ProductView chrome',
    async ({ url, bodyTestId }) => {
      renderAtUrl(url);

      // Layout chrome (tab bar) is mounted.
      await screen.findByTestId('product-tab-bar');

      // The expected body is mounted.
      await waitFor(() => {
        expect(screen.getByTestId(bodyTestId)).toBeInTheDocument();
      });

      // The pathname stays put (no redirect).
      expect(screen.getByTestId('pathname-probe').textContent).toBe(url);
    }
  );

  // ---------------------------------------------------------------------------
  // Test 4: clicking a NavLink navigates to the matching sub-route URL.
  // No more URLSearchParams / pushState manipulation -- the URL drives.
  // ---------------------------------------------------------------------------
  it('clicking a tab NavLink navigates to the corresponding sub-route URL', async () => {
    const { user } = renderAtUrl(`${PRODUCT_BASE}/backlog`);

    await screen.findByTestId('product-tab-bar');

    // Click Roadmap
    const roadmapLink = screen.getByTestId('roadmap-tab');
    await user.click(roadmapLink);

    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${PRODUCT_BASE}/roadmap`
      );
    });
    expect(screen.getByTestId('roadmap-body-stub')).toBeInTheDocument();

    // Click Backlog
    const backlogLink = screen.getByTestId('backlog-tab');
    await user.click(backlogLink);

    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${PRODUCT_BASE}/backlog`
      );
    });
    expect(screen.getByTestId('backlog-body-stub')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 5: deep-link to `/product/backlog/<id>` mounts the backlog with
  // the details panel pre-opened (initialSelectedId prop is wired through).
  // ---------------------------------------------------------------------------
  it('deep-link /product/backlog/<workItemId> mounts backlog with item pre-selected', async () => {
    renderAtUrl(`${PRODUCT_BASE}/backlog/${WORK_ITEM_ID}`);

    await screen.findByTestId('product-tab-bar');

    const body = await screen.findByTestId('backlog-body-stub');
    expect(body).toHaveAttribute('data-initial-selected-id', WORK_ITEM_ID);

    // Pathname stays put.
    expect(screen.getByTestId('pathname-probe').textContent).toBe(
      `${PRODUCT_BASE}/backlog/${WORK_ITEM_ID}`
    );
  });

  // ---------------------------------------------------------------------------
  // Test 6: deep-link to `/product/implement/<id>` mounts the
  // Implementation Assistant for that work item.
  // ---------------------------------------------------------------------------
  it('deep-link /product/implement/<workItemId> mounts Implementation Assistant for that item', async () => {
    renderAtUrl(`${PRODUCT_BASE}/implement/${WORK_ITEM_ID}`);

    await screen.findByTestId('product-tab-bar');

    const body = await screen.findByTestId('implement-body-stub');
    expect(body).toHaveAttribute('data-work-item-id', WORK_ITEM_ID);
    // Default refinement mode (no nav state on a fresh deep-link).
    expect(body).toHaveAttribute('data-refinement-mode', 'standard');

    expect(screen.getByTestId('pathname-probe').textContent).toBe(
      `${PRODUCT_BASE}/implement/${WORK_ITEM_ID}`
    );
  });

  // ---------------------------------------------------------------------------
  // Test 7: back/forward across product tabs switches the body without
  // remounting the layout chrome (safety property e, partial for product).
  //
  // MemoryRouter does not surface the browser History API; we drive
  // back/forward via a `<NavController>` probe that exposes the router's
  // `useNavigate(-1 | 1)` to the test scope.
  // ---------------------------------------------------------------------------
  it('back/forward across product tabs preserves layout chrome instance', async () => {
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(useProjectLoading).mockReturnValue(false);

    const navRef: { current: ((delta: number) => void) | null } = { current: null };
    const NavController = makeNavController(navRef);

    // Entries: [0]=backlog (initial), [1]=roadmap, [2]=mission.
    // Start at index 2 (mission); Back -> roadmap; Back -> backlog.
    renderWithFullApp(`${PRODUCT_BASE}/backlog`, {
      additionalEntries: [`${PRODUCT_BASE}/roadmap`, `${PRODUCT_BASE}/mission`],
      initialIndex: 2,
      extra: (
        <>
          <PathnameProbe />
          <NavController />
        </>
      ),
    });

    // Started on mission.
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${PRODUCT_BASE}/mission`
      );
    });
    await screen.findByTestId('mission-body-stub');

    // Capture the layout chrome instance.
    const tabBarBefore = screen.getByTestId('product-tab-bar');

    // Wait for the navigator ref to be wired by the effect.
    await waitFor(() => expect(navRef.current).not.toBeNull());

    // Back -> roadmap
    navRef.current!(-1);
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${PRODUCT_BASE}/roadmap`
      );
    });
    await screen.findByTestId('roadmap-body-stub');

    // Back -> backlog
    navRef.current!(-1);
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${PRODUCT_BASE}/backlog`
      );
    });
    await screen.findByTestId('backlog-body-stub');

    // Forward -> roadmap
    navRef.current!(1);
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${PRODUCT_BASE}/roadmap`
      );
    });

    // The product-tab-bar element instance stayed mounted across all
    // back/forward navigations -- the layout chrome is stable.
    expect(screen.getByTestId('product-tab-bar')).toBe(tabBarBefore);
  });
});

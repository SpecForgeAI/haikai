/**
 * Comprehensive Frontend Routing -- Dashboard Cleanup
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 8 (Task 8.1)
 *
 * Focused tests for the dashboard cleanup that removes the now-superseded
 * "show discovery detail" toggle from `DashboardView`. Group 7 promoted
 * discovery to first-class routes (`/discovery`, `/discovery/runs/:runId`);
 * this group removes the dead code in `DashboardView` and verifies:
 *
 *   1. `DashboardView` source no longer contains `showDiscoveryDetail` /
 *      `setShowDiscoveryDetail` (grep-style assertion via fs.readFile).
 *   2. `DashboardView` no longer mounts `<DiscoveryRunDetailView/>` inline
 *      (component-tree assertion via testIds).
 *   3. The discovery card "Open" button still navigates to `/.../discovery`
 *      (regression check from Group 7 -- the wiring stayed intact).
 *   4. The "Back to Discovery" label appears when `DiscoveryRunDetailView`
 *      is mounted via the route (`routeRunId` prop set).
 *
 * Notes:
 *   - We do NOT stub `DashboardView` in tests 2 / 3 -- the cleanup is the SUT.
 *   - Test 4 mounts the discovery detail page route directly so the
 *     `routeRunId` prop is supplied by `DiscoveryRunDetailPage`.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
    // Default: resolve an empty model so AppShell's load effect never calls
    // .then on undefined before a test installs its own mockResolvedValue.
    loadModelByProjectId: vi.fn(async () => {
      const { emptyModel } = await vi.importActual<typeof import('../../config/defaults')>('../../config/defaults');
      return JSON.parse(JSON.stringify(emptyModel));
    }),
  };
});

vi.mock('../../api/discoveryApi', async () => {
  const actual = await vi.importActual('../../api/discoveryApi');
  return {
    ...actual,
    getDiscoveryRuns: vi.fn(),
    getDiscoveryRun: vi.fn(),
    getDiscoveryCandidateCount: vi.fn(),
    getDiscoveryCandidates: vi.fn(() => Promise.resolve([])),
    getDiscoveryRunSummary: vi.fn(),
  };
});

vi.mock('../../api/dashboardApi', async () => {
  const actual = await vi.importActual('../../api/dashboardApi');
  return {
    ...actual,
    getDashboardSummary: vi.fn(),
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

// Heavy non-dashboard views stubbed (we exercise dashboard + discovery; the
// rest just need to not throw on mount).
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

// Stub UnifiedChatPanel (mounted by DashboardView) -- per project memory it
// requires several context providers we are not exercising in this group.
vi.mock('../../components/UnifiedChat', () => ({
  UnifiedChatPanel: () => <div data-testid="unified-chat-stub" />,
}));

// ============================================================================
// Imports of system-under-test (after mocks)
// ============================================================================

import { useProject, useProjectLoading } from '../../contexts/ProjectContext';
import {
  getDiscoveryRuns,
  getDiscoveryRun,
  getDiscoveryCandidateCount,
  getDiscoveryRunSummary,
} from '../../api/discoveryApi';
import { getDashboardSummary } from '../../api/dashboardApi';
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

const DASHBOARD_URL = `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}/dashboard`;
const DISCOVERY_BASE = `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}/discovery`;
const RUN_ID_A = 'run-aaa-1111';

/**
 * Probe component that exposes the current pathname for assertions.
 */
function PathnameProbe() {
  const location = useLocation();
  return <div data-testid="pathname-probe">{location.pathname}</div>;
}

/**
 * Build a minimal dashboard summary DTO that the DashboardView happy-path
 * branch needs to render the success-state cards.
 */
function buildDashboardSummaryFixture() {
  const metric = (label: string, value: string | number | boolean) => ({
    label,
    value,
  });
  return {
    header: {
      mode: 'PRD',
      headerInsight: '',
      lastUpdatedLabel: 'just now',
    },
    strategicFoundation: {
      productDefinition: {
        missionExists: metric('Mission', false),
        lastUpdatedLabel: metric('Last updated', 'never'),
      },
      usersAndInteractions: {
        userRoles: metric('User roles', 0),
        businessActivities: metric('Activities', 0),
        uiScreens: metric('UI screens', 0),
      },
      roadmap: {
        initiativesCount: metric('Initiatives', 0),
        epics: metric('Epics', 0),
        completed: metric('Completed', 0),
      },
      standards: {
        orgTechStack: metric('Org stack', ''),
        productTechStack: metric('Product stack', ''),
      },
      highLevelArchitecture: {
        overall: metric('Overall', 0),
        applications: metric('Applications', 0),
        services: metric('Services', 0),
        dataStores: metric('Data stores', 0),
      },
      testStrategy: {
        exists: metric('Exists', false),
        lastUpdated: metric('Last updated', 'never'),
      },
    },
    detailedDefinitionAndDelivery: {
      preCoding: {
        backlog: {
          epicsInScope: metric('Epics in scope', 0),
          featuresCount: metric('Features', 0),
          storiesCount: metric('Stories', 0),
          storiesWithAcceptanceCriteriaCount: metric('Stories w/AC', 0),
        },
        detailedArchitecture: {
          processActivities: metric('Process activities', 0),
          interfaceEndpoints: metric('Interface endpoints', 0),
          logicalDataEntities: metric('Logical data', 0),
          physicalDataEntities: metric('Physical data', 0),
        },
        testingSuite: {
          functionalTestCount: metric('Functional tests', 0),
          endToEndTestCount: metric('E2E tests', 0),
        },
      },
      postCoding: {
        implementation: {
          featuresInProgress: metric('Features in progress', 0),
          storiesInProgress: metric('Stories in progress', 0),
          storiesComplete: metric('Stories complete', 0),
        },
        verification: {
          pendingReviewCount: metric('Pending review', 0),
          storiesVerifiedCount: metric('Stories verified', 0),
        },
        summaryInsight: { enabled: false, message: null },
      },
    },
  } as unknown as Awaited<ReturnType<typeof getDashboardSummary>>;
}

/**
 * Build a minimal discovery run dto.
 */
function buildRunDto(id: string, status: string = 'COMPLETED') {
  return {
    id,
    project_id: DEFAULT_PROJECT_ID,
    status,
    current_step: null,
    config_snapshot: null,
    steps_payload: null,
    error_message: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    architecture_id: DEFAULT_ARCH_ID,
  };
}

function renderAtUrl(url: string) {
  vi.mocked(useProject).mockReturnValue(buildProjectFixture());
  vi.mocked(useProjectLoading).mockReturnValue(false);
  return renderWithFullApp(url, { extra: <PathnameProbe /> });
}

// ============================================================================
// Tests
// ============================================================================

describe('Comprehensive Frontend Routing -- Dashboard Cleanup (Task 8.1)', () => {
  beforeEach(() => {
    setupDefaultMocks();
    vi.mocked(getDiscoveryRuns).mockResolvedValue([]);
    vi.mocked(getDiscoveryRun).mockResolvedValue(buildRunDto(RUN_ID_A));
    vi.mocked(getDiscoveryCandidateCount).mockResolvedValue({ count: 0 });
    vi.mocked(getDiscoveryRunSummary).mockResolvedValue({
      latest_run_id: null,
      latest_run_status: null,
      latest_run_created_at: null,
      total_candidates: 0,
      candidate_counts_by_status: {},
      entities_saved: 0,
      entity_type_coverage: 0,
    });
    vi.mocked(getDashboardSummary).mockResolvedValue(buildDashboardSummaryFixture());
  });

  afterEach(() => {
    teardownDefaultMocks();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: DashboardView source no longer contains the dead state.
  //
  // Grep-style assertion -- reads the source file directly and verifies the
  // strings `showDiscoveryDetail` and `setShowDiscoveryDetail` only appear
  // in COMMENT lines (so the historical reference is preserved but the
  // active code is gone). This catches regressions where someone reverts
  // part of the cleanup.
  // ---------------------------------------------------------------------------
  it('DashboardView source has no active showDiscoveryDetail / sessionStorage handoff', () => {
    const dashboardPath = path.resolve(
      __dirname,
      '../../components/DashboardView/DashboardView.tsx'
    );
    const source = fs.readFileSync(dashboardPath, 'utf8');

    // Inspect each line: identifier-style hits are only allowed inside
    // comment lines (which is how we document the removal).
    const offending: string[] = [];
    const lines = source.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
      if (
        line.includes('showDiscoveryDetail') ||
        line.includes('setShowDiscoveryDetail') ||
        line.includes("sessionStorage.getItem('pendingDiscoveryDetail")
      ) {
        offending.push(raw);
      }
    }
    expect(offending).toEqual([]);

    // The `useState<boolean>(false)` form for showDiscoveryDetail is gone.
    expect(source).not.toMatch(/useState<boolean>\(false\);[^\n]*\n[^\n]*showDiscoveryDetail/);
    // The inline DiscoveryRunDetailView import is gone.
    expect(source).not.toMatch(/^import\s+\{\s*DiscoveryRunDetailView\s*\}/m);
  });

  // ---------------------------------------------------------------------------
  // Test 2: DashboardView no longer mounts DiscoveryRunDetailView inline.
  //
  // Renders the dashboard with a discovery summary indicating a recent run
  // is present (so the card's Open button is enabled) and asserts that
  // even before the user clicks anything, the inline detail view is NOT in
  // the tree -- the dashboard renders only the cards and the chat panel.
  // ---------------------------------------------------------------------------
  it('DashboardView does not mount DiscoveryRunDetailView inline', async () => {
    vi.mocked(getDiscoveryRunSummary).mockResolvedValue({
      latest_run_id: RUN_ID_A,
      latest_run_status: 'COMPLETED',
      latest_run_created_at: '2026-04-01T00:00:00Z',
      total_candidates: 5,
      candidate_counts_by_status: {},
      entities_saved: 3,
      entity_type_coverage: 2,
    });

    renderAtUrl(DASHBOARD_URL);

    // Wait for the dashboard layout to render.
    await screen.findByTestId('dashboard-layout');
    // Wait for the discovery card to render.
    await screen.findByTestId('card-discovery-summary');

    // The inline DiscoveryRunDetailView wrapper testid is NOT in the tree.
    expect(
      screen.queryByTestId('discovery-run-detail-view')
    ).not.toBeInTheDocument();
    // And the route-mode wrapper is NOT mounted on the dashboard URL.
    expect(
      screen.queryByTestId('discovery-run-detail-page')
    ).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 3: discovery card "Open" navigates to `/.../discovery`.
  //
  // Regression check from Group 7 -- the cleanup must not break the
  // navigation wiring. Click the Open button on the dashboard's discovery
  // card and assert the URL switches to the list page.
  // ---------------------------------------------------------------------------
  it('discovery card Open button navigates to /discovery list', async () => {
    vi.mocked(getDiscoveryRunSummary).mockResolvedValue({
      latest_run_id: RUN_ID_A,
      latest_run_status: 'COMPLETED',
      latest_run_created_at: '2026-04-01T00:00:00Z',
      total_candidates: 5,
      candidate_counts_by_status: {},
      entities_saved: 3,
      entity_type_coverage: 2,
    });

    const { user } = renderAtUrl(DASHBOARD_URL);

    const card = await screen.findByTestId('card-discovery-summary');
    const openBtn = await waitFor(() => {
      const btn = within(card).getByRole('button', { name: /open/i });
      expect(btn).toBeInTheDocument();
      return btn;
    });

    await user.click(openBtn);

    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        DISCOVERY_BASE
      );
    });
    // The dashboard layout is gone; the discovery list page is mounted.
    expect(screen.queryByTestId('dashboard-layout')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('discovery-list-page')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Test 4: "Back to Discovery" label appears when DiscoveryRunDetailView
  // is mounted via the route (`routeRunId` prop set by DiscoveryRunDetailPage).
  //
  // Deep-links to `/discovery/runs/:runId` so the page wrapper supplies
  // `routeRunId`. Asserts the back button text is "Back to Discovery"
  // (route mode) and NOT the legacy "Back to Dashboard" label.
  // ---------------------------------------------------------------------------
  it('Back button reads "Back to Discovery" when mounted via route (routeRunId set)', async () => {
    vi.mocked(getDiscoveryRuns).mockResolvedValue([buildRunDto(RUN_ID_A)]);
    vi.mocked(getDiscoveryRun).mockResolvedValue(buildRunDto(RUN_ID_A));

    renderAtUrl(`${DISCOVERY_BASE}/runs/${RUN_ID_A}`);

    await screen.findByTestId('top-bar-stub');

    // The route-mode wrapper mounts and supplies routeRunId.
    await waitFor(() => {
      expect(screen.getByTestId('discovery-run-detail-page')).toBeInTheDocument();
    });

    // The back button text reflects route mode.
    const back = await screen.findByTestId('back-to-dashboard-button');
    expect(back).toHaveTextContent('Back to Discovery');
    // And NOT the legacy "Back to Dashboard" text.
    expect(back).not.toHaveTextContent('Back to Dashboard');
  });
});

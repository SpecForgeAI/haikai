/**
 * Comprehensive Frontend Routing -- Discovery Sub-Routes
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 7 (Task 7.1)
 *
 * 2-8 focused tests for the discovery promotion:
 *
 *   1. Pure parser unit tests (`parseDiscoveryRunIdFromPathname`) plus hook
 *      smoke test via probe.
 *   2. Refresh on `/.../discovery` mounts the DiscoveryListPage.
 *   3. Deep-link to `/.../discovery/runs/:runId` from cold start lands on
 *      the DiscoveryRunDetailPage with the URL-derived run id (safety
 *      property (f)).
 *   4. Clicking a row in the DiscoveryListPage navigates to the run-detail
 *      URL (deep-linkable).
 *   5. Dashboard discovery card click navigates to `/.../discovery` instead
 *      of toggling internal state.
 *
 * Notes:
 *   - We do NOT stub `DiscoveryListPage` / `DiscoveryRunDetailPage` -- those
 *     are the system under test. The heavy `DiscoveryRunDetailView` body is
 *     kept un-stubbed to verify the URL -> selection sync, but its detail
 *     fetches are mocked.
 *   - `DashboardView` is intentionally NOT stubbed for test 5; the discovery
 *     card click is the SUT.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';

// ============================================================================
// Mocks (must be set up BEFORE module-under-test imports)
// ============================================================================

vi.mock('../../api/architecturesApi', async () => {
  const actual = await vi.importActual('../../api/architecturesApi');
  return {
    ...actual,
    // Default to an empty list so provider-level fetches that run before a
    // test sets its own mockResolvedValue do not return undefined (.then crash).
    listArchitectures: vi.fn(() => Promise.resolve([])),
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

// Heavy non-discovery views stubbed (per testUtils header recommendations).
// DashboardView is kept un-stubbed for test 5 (discovery card click is SUT).
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
  parseDiscoveryRunIdFromPathname,
  useDiscoveryRunId,
} from '../../hooks/useCurrentView';
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

const DISCOVERY_BASE = `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}/discovery`;
const DASHBOARD_URL = `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}/dashboard`;
const RUN_ID_A = 'run-aaa-1111';
const RUN_ID_B = 'run-bbb-2222';

/**
 * Probe component that exposes the current pathname for assertions, plus
 * the URL-derived discovery run id via `useDiscoveryRunId`.
 */
function PathnameProbe() {
  const location = useLocation();
  const id = useDiscoveryRunId();
  return (
    <>
      <div data-testid="pathname-probe">{location.pathname}</div>
      <div data-testid="discovery-run-id-probe">{id ?? 'NULL'}</div>
    </>
  );
}

/**
 * Build a minimal dashboard summary DTO that the DashboardView happy-path
 * branch needs to render the success-state cards. Any field not asserted on
 * by these tests gets a benign default.
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
 * Build a minimal discovery run dto for tests.
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

describe('Comprehensive Frontend Routing -- Discovery Sub-Routes (Task 7.1)', () => {
  beforeEach(() => {
    setupDefaultMocks();
    // Default: empty runs list so list page renders without the heavy
    // detail-fetch path firing.
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
  // Test 1: pure parser + hook smoke tests.
  //
  // Validates the URL-segment extraction and the hook variant. Mirrors the
  // parser tests in Groups 5 / 6 (kept terse to fit the 2-8 budget).
  // ---------------------------------------------------------------------------
  it('parseDiscoveryRunIdFromPathname / useDiscoveryRunId return the :runId or null', async () => {
    // Pure parser.
    expect(
      parseDiscoveryRunIdFromPathname(`${DISCOVERY_BASE}/runs/${RUN_ID_A}`)
    ).toBe(RUN_ID_A);
    expect(parseDiscoveryRunIdFromPathname(DISCOVERY_BASE)).toBeNull();
    expect(parseDiscoveryRunIdFromPathname(`${DISCOVERY_BASE}/runs`)).toBeNull();
    expect(parseDiscoveryRunIdFromPathname('/')).toBeNull();
    expect(
      parseDiscoveryRunIdFromPathname(
        `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}/diagrams/abc`
      )
    ).toBeNull();
    // Sentinel rejection.
    expect(
      parseDiscoveryRunIdFromPathname(`${DISCOVERY_BASE}/runs/undefined`)
    ).toBeNull();

    // Hook variant via the probe.
    renderAtUrl(`${DISCOVERY_BASE}/runs/${RUN_ID_A}`);
    await waitFor(() => {
      expect(screen.getByTestId('discovery-run-id-probe').textContent).toBe(
        RUN_ID_A
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: refresh on `/.../discovery` mounts the DiscoveryListPage.
  // ---------------------------------------------------------------------------
  it('refresh on /discovery mounts the DiscoveryListPage', async () => {
    renderAtUrl(DISCOVERY_BASE);

    // Top bar shell mounts.
    await screen.findByTestId('top-bar-stub');

    // The list page is mounted with the heading.
    await waitFor(() => {
      expect(screen.getByTestId('discovery-list-page')).toBeInTheDocument();
    });
    expect(screen.getByText('Discovery Runs')).toBeInTheDocument();

    // The reusable runs list is mounted.
    expect(screen.getByTestId('discovery-runs-list')).toBeInTheDocument();

    // No detail page rendered.
    expect(screen.queryByTestId('discovery-run-detail-page')).not.toBeInTheDocument();

    // Pathname stays put.
    expect(screen.getByTestId('pathname-probe').textContent).toBe(DISCOVERY_BASE);
  });

  // ---------------------------------------------------------------------------
  // Test 3: deep-link to `/discovery/runs/:runId` from cold start lands on
  // the detail page with the URL-derived run id. SAFETY PROPERTY (f).
  // ---------------------------------------------------------------------------
  it('deep-linking to /discovery/runs/:runId mounts the detail page with that run', async () => {
    // Seed a run with the deep-linked id so the detail-fetch resolves it.
    vi.mocked(getDiscoveryRun).mockResolvedValue(buildRunDto(RUN_ID_A));
    vi.mocked(getDiscoveryRuns).mockResolvedValue([buildRunDto(RUN_ID_A)]);

    renderAtUrl(`${DISCOVERY_BASE}/runs/${RUN_ID_A}`);

    // Top bar mounts.
    await screen.findByTestId('top-bar-stub');

    // Detail page wrapper is mounted.
    await waitFor(() => {
      expect(screen.getByTestId('discovery-run-detail-page')).toBeInTheDocument();
    });

    // Detail page captures the URL run id in its data-attribute.
    expect(
      screen.getByTestId('discovery-run-detail-page').getAttribute('data-route-run-id')
    ).toBe(RUN_ID_A);

    // The hook returns the URL value.
    expect(screen.getByTestId('discovery-run-id-probe').textContent).toBe(RUN_ID_A);

    // The pathname stays put.
    expect(screen.getByTestId('pathname-probe').textContent).toBe(
      `${DISCOVERY_BASE}/runs/${RUN_ID_A}`
    );

    // The list page is NOT mounted.
    expect(screen.queryByTestId('discovery-list-page')).not.toBeInTheDocument();

    // The detail-fetch was called with the URL-derived id (safety property f).
    await waitFor(() => {
      expect(getDiscoveryRun).toHaveBeenCalledWith(
        DEFAULT_PROJECT_ID,
        DEFAULT_ARCH_ID,
        RUN_ID_A
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 4: clicking a row in the DiscoveryListPage navigates to the
  // run-detail URL (deep-linkable behaviour).
  // ---------------------------------------------------------------------------
  it('clicking a row in DiscoveryListPage navigates to /discovery/runs/<id>', async () => {
    vi.mocked(getDiscoveryRuns).mockResolvedValue([
      buildRunDto(RUN_ID_A, 'COMPLETED'),
      buildRunDto(RUN_ID_B, 'RUNNING'),
    ]);

    const { user } = renderAtUrl(DISCOVERY_BASE);

    // Wait for rows.
    await waitFor(() => {
      const items = screen.getAllByTestId('run-list-item');
      expect(items.length).toBeGreaterThanOrEqual(2);
    });

    // Click the first row (RUN_ID_A).
    const items = screen.getAllByTestId('run-list-item');
    const rowA = items.find(
      (li) => li.getAttribute('data-run-id') === RUN_ID_A
    );
    expect(rowA).toBeDefined();
    await user.click(rowA!);

    // Pathname switches to the run-detail URL.
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${DISCOVERY_BASE}/runs/${RUN_ID_A}`
      );
    });

    // The detail page mounts.
    await waitFor(() => {
      expect(screen.getByTestId('discovery-run-detail-page')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('discovery-list-page')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 5: clicking the dashboard discovery card navigates to /discovery
  // (the list page) instead of toggling internal state.
  // ---------------------------------------------------------------------------
  it('dashboard discovery card "Open" navigates to /discovery list', async () => {
    // Seed the discovery summary with a latest run so the card is enabled.
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

    // Wait for the dashboard card to render with an enabled Open button.
    const card = await screen.findByTestId('card-discovery-summary');
    expect(card).toBeInTheDocument();

    // Find the Open button within the card.
    const openBtn = await waitFor(() => {
      const btn = within(card).getByRole('button', { name: /open/i });
      expect(btn).toBeInTheDocument();
      return btn;
    });

    await user.click(openBtn);

    // Pathname switches to the discovery list URL.
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        DISCOVERY_BASE
      );
    });

    // The discovery list page is mounted.
    await waitFor(() => {
      expect(screen.getByTestId('discovery-list-page')).toBeInTheDocument();
    });
  });
});

// Re-export `within` for the dashboard card test (kept inline to avoid
// pulling in another import line).
import { within } from '@testing-library/react';

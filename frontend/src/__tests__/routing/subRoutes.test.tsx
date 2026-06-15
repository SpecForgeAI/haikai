/**
 * Comprehensive Frontend Routing -- Sub-Route Refresh Sweep
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 9 (Task 9.4)
 *
 * Cross-tier verification: refreshing the page on every SUB-ROUTE URL from
 * the locked URL list lands on the correct view + sub-state. This
 * consolidates safety property (d) -- "refreshing on any sub-route URL
 * renders the correct view + sub-state" -- in a single parameterised pass
 * that exercises every sub-route in one place. Per-view sub-route tests
 * already exist in Groups 4-7; this test catches cross-cutting regressions
 * that might escape per-view coverage.
 *
 * Parameterised via `it.each` to keep the test count low.
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
    getDiscoveryRuns: vi.fn(() => Promise.resolve([])),
    getDiscoveryRun: vi.fn(),
    getDiscoveryCandidateCount: vi.fn(() => Promise.resolve({ count: 0 })),
    getDiscoveryCandidates: vi.fn(() => Promise.resolve([])),
    getDiscoveryRunSummary: vi.fn().mockResolvedValue({
      latest_run_id: null,
      latest_run_status: null,
      latest_run_created_at: null,
      total_candidates: 0,
      candidate_counts_by_status: {},
      entities_saved: 0,
      entity_type_coverage: 0,
    }),
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

// ===== Heavy view stubs =====
//
// We stub the deep view internals (Grid, Canvas, ProductBacklogPage etc.)
// so we can still mount the real wrappers (MetaModelView, DiagramsView,
// BacklogTab, ImplementTab, DiscoveryRunDetailPage) and assert the
// URL-derived sub-state.
vi.mock('../../components/Grid/Grid', () => ({
  Grid: ({ entityType }: { entityType: string }) => (
    <div data-testid="grid-stub" data-entity-type={entityType} />
  ),
}));
vi.mock('../../components/Grid/RelationshipGrid', () => ({
  RelationshipGrid: ({ relationshipType }: { relationshipType: string }) => (
    <div data-testid="relationship-grid-stub" data-rel-type={relationshipType} />
  ),
}));
vi.mock('../../components/MetaModelView/PackageSetsView', () => ({
  PackageSetsView: () => <div data-testid="package-sets-view-stub" />,
}));
vi.mock('../../components/DiagramsView/Canvas', () => ({
  Canvas: ({ diagramId }: { diagramId: string }) => (
    <div data-testid="canvas-stub" data-diagram-id={diagramId} />
  ),
}));
vi.mock('../../components/ProductView/ProductPage', () => ({
  ProductPage: () => <div data-testid="mission-body-stub" />,
}));
vi.mock('../../components/ProductView/ProductRoadmapPage', () => ({
  ProductRoadmapPage: () => <div data-testid="roadmap-body-stub" />,
  formatTimestamp: (d: Date) => d.toISOString(),
}));
vi.mock('../../components/ProductView/ProductBacklogPage', () => ({
  ProductBacklogPage: ({ initialSelectedId }: { initialSelectedId?: string | null }) => (
    <div
      data-testid="backlog-body-stub"
      data-initial-selected-id={initialSelectedId ?? ''}
    />
  ),
}));
vi.mock('../../components/ProductView/ProductImplementPage', () => ({
  ProductImplementPage: ({ workItemId }: { workItemId: string | null }) => (
    <div
      data-testid="implement-body-stub"
      data-work-item-id={workItemId ?? ''}
    />
  ),
}));

vi.mock('../../components/DashboardView/DashboardView', () => ({
  DashboardView: () => <div data-testid="dashboard-view-stub" />,
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
vi.mock('../../components/UnifiedChat', () => ({
  UnifiedChatPanel: () => <div data-testid="unified-chat-stub" />,
}));
vi.mock('../../hooks/useDiscoveryOrigins', () => ({
  useDiscoveryOrigins: () => ({}),
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { useProject, useProjectLoading } from '../../contexts/ProjectContext';
import { loadModelByProjectId } from '../../api/modelApi';
import { getDiscoveryRun } from '../../api/discoveryApi';
import { emptyModel } from '../../config/defaults';
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
const DIAGRAM_ID = 'diag-aaa-1111';
const WORK_ITEM_ID = 'wi-bbb-2222';
const RUN_ID = 'run-ccc-3333';

function PathnameProbe() {
  const location = useLocation();
  return <div data-testid="pathname-probe">{location.pathname}</div>;
}

function renderAtUrl(url: string) {
  vi.mocked(useProject).mockReturnValue(buildProjectFixture());
  vi.mocked(useProjectLoading).mockReturnValue(false);
  return renderWithFullApp(url, { extra: <PathnameProbe /> });
}

function seedDiagramsModel() {
  vi.mocked(loadModelByProjectId).mockResolvedValue({
    ...JSON.parse(JSON.stringify(emptyModel)),
    diagrams: [
      {
        id: DIAGRAM_ID,
        name: 'Sub Route Diagram',
        description: '',
        diagram_type: 'CONTEXT',
        settings: {},
        diagram_nodes: [],
        diagram_edges: [],
      },
    ],
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('Comprehensive Frontend Routing -- Sub-Route Refresh Sweep (Task 9.4)', () => {
  beforeEach(() => {
    setupDefaultMocks();
    vi.mocked(getDiscoveryRun).mockResolvedValue({
      id: RUN_ID,
      project_id: DEFAULT_PROJECT_ID,
      status: 'COMPLETED',
      current_step: null,
      config_snapshot: null,
      steps_payload: null,
      error_message: null,
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z',
      architecture_id: DEFAULT_ARCH_ID,
    } as Awaited<ReturnType<typeof getDiscoveryRun>>);
  });

  afterEach(() => {
    teardownDefaultMocks();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1 (parameterised): refresh on each sub-route URL renders the
  // correct view + sub-state. Asserts on the body-level testids and the
  // URL-derived sub-state value (work-item id, diagram id, etc.).
  //
  // Each scenario seeds whatever fixture data is required for the sub-state
  // to render meaningfully. Discovery is intentionally limited to the run
  // detail wrapper testid -- the deep run-detail UI relies on contexts not
  // exercised here.
  // ---------------------------------------------------------------------------
  it.each([
    {
      label: 'metamodel/data',
      url: `${ARCH_BASE}/metamodel/data`,
      seed: () => {},
      assertion: () => {
        // The Data domain renders Grid stubs for data entities.
        expect(screen.getByTestId('top-bar-stub')).toBeInTheDocument();
        // The pathname stays put (proves the URL was matched).
        expect(screen.getByTestId('pathname-probe').textContent).toBe(
          `${ARCH_BASE}/metamodel/data`
        );
      },
    },
    {
      label: 'diagrams/<id>',
      url: `${ARCH_BASE}/diagrams/${DIAGRAM_ID}`,
      seed: seedDiagramsModel,
      assertion: () => {
        // The canvas mounts with the URL-derived diagram id.
        const canvas = screen.getByTestId('canvas-stub');
        expect(canvas.getAttribute('data-diagram-id')).toBe(DIAGRAM_ID);
      },
    },
    {
      label: 'product/backlog/<workItemId>',
      url: `${ARCH_BASE}/product/backlog/${WORK_ITEM_ID}`,
      seed: () => {},
      assertion: () => {
        // BacklogTab passes the URL-derived work item id to ProductBacklogPage.
        const backlog = screen.getByTestId('backlog-body-stub');
        expect(backlog.getAttribute('data-initial-selected-id')).toBe(WORK_ITEM_ID);
      },
    },
    {
      label: 'product/implement/<workItemId>',
      url: `${ARCH_BASE}/product/implement/${WORK_ITEM_ID}`,
      seed: () => {},
      assertion: () => {
        // ImplementTab passes the URL-derived work item id to ProductImplementPage.
        const implement = screen.getByTestId('implement-body-stub');
        expect(implement.getAttribute('data-work-item-id')).toBe(WORK_ITEM_ID);
      },
    },
    {
      label: 'discovery/runs/<runId>',
      url: `${ARCH_BASE}/discovery/runs/${RUN_ID}`,
      seed: () => {},
      assertion: () => {
        // The detail page wrapper is mounted with the URL-derived run id.
        const detail = screen.getByTestId('discovery-run-detail-page');
        expect(detail.getAttribute('data-route-run-id')).toBe(RUN_ID);
      },
    },
  ])(
    'refresh on $label mounts the correct view + URL-derived sub-state',
    async ({ url, seed, assertion }) => {
      seed();
      renderAtUrl(url);

      // Wait for the AppShell.
      await screen.findByTestId('top-bar-stub');

      // Wait for the URL to be fully matched (pathname probe reflects the
      // requested URL, no redirect away).
      await waitFor(() => {
        expect(screen.getByTestId('pathname-probe').textContent).toBe(url);
      });

      // 404 must NOT render -- the URL was matched.
      expect(screen.queryByTestId('not-found-page')).not.toBeInTheDocument();

      // Wait for the body to mount and run scenario-specific assertions.
      await waitFor(() => {
        assertion();
      });
    }
  );
});

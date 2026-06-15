/**
 * DashboardView Component Tests
 *
 * Spec 2026-02-18: Dashboard Increment 3 -- Task Group 2
 * Task 2.1: 8 focused tests for the DashboardView component.
 *
 * Spec 2026-02-28: Hub Chat MVP v1 -- Removed PersonaPanelContext mock (context deleted)
 *
 * Spec 2026-03-06: Dashboard UX Improvements -- Task Group 5 (Task 5.6)
 * Updated mock data to conform to new type interfaces:
 * - ProductDefinitionMetrics: removed state, missionExists is boolean, lastUpdatedLabel is string
 * - RoadmapMetrics: removed state, renamed epicsCount to epics, renamed epicsCompletedCount to completed
 * - StandardsMetrics: renamed companyStandards to orgTechStack, productStandards to productTechStack (string values)
 * - PostCodingSection.implementation: now ImplementationMetrics (3 fields, not single MetricCard)
 * - StrategicFoundationSection: added testStrategy field
 * Updated test assertions:
 * - Test 5: now expects 5 Strategic Foundation cards (added Test Strategy)
 * - Test 8: Summary Insight disabled test updated -- mock has summaryInsight.enabled=false so still shows disabled
 * Updated header summary text assertion (Gap Test 6) -- new LLM summary text
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 7 (Task 7.3)
 * Mechanical updates for the SET_VIEW removal:
 *  - Wrapped <DashboardView /> in <MemoryRouter> so the new useNavigate() inside
 *    the component resolves a Router context.
 *  - Mocked useActiveArchitectureId (added by spec 2026-05-01) so the component
 *    has a non-null architectureId when computing canonical URLs.
 *  - Test 7 asserts on the navigate() call (canonical URL with `?tab=roadmap`)
 *    instead of the now-removed SET_VIEW dispatch + window.history.pushState pair.
 *
 * Tests:
 * 1. No project -> "Select a project to view the dashboard."
 * 2. Loading state -> skeleton loading (dashboard-skeleton testid)
 * 3. Fetch error -> error message + "Retry" button
 * 4. Success -> header with projectName and scope label
 * 5. Success -> 5 Strategic Foundation cards with correct data-testid (was 4, now includes Test Strategy)
 * 6. Success -> 6 Detailed D&D cards with correct data-testid
 * 7. Click action link navigates to canonical product URL with ?tab=roadmap
 * 8. Summary Insight card shows "AI insights coming soon" disabled
 *
 * Mocks: useProject(), useArchitectureDispatch(), useActiveArchitectureId(), getDashboardSummary()
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { DashboardSummaryDto } from '../types/dashboard';

// ============================================================================
// Mock setup
// ============================================================================

const mockDispatch = vi.fn();
let mockActiveProject: { id: string; name: string } | null = null;
const ACTIVE_ARCH_ID = 'arch-uuid-dashboard-test';

// Mock ProjectContext
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => mockActiveProject,
  useSetActiveProject: () => vi.fn(),
}));

// Mock ArchitectureContext
//
// Spec 2026-05-01 added useActiveArchitectureId; spec 2026-05-02 wires it into
// DashboardView's navigateTo helper. Provide a non-null id so the navigate
// branch fires.
// Harness: UnifiedChatPanel (mounted by DashboardView) calls
// useActivateTemporaryDiagram(); stub it so no TemporaryDiagramProvider is needed.
vi.mock('../contexts/TemporaryDiagramContext', () => ({
  useActivateTemporaryDiagram: vi.fn(() => vi.fn()),
}));

vi.mock('../contexts/ArchitectureContext', () => ({
  useArchitectureContext: vi.fn(() => ({
    state: { model: { metaModel: { entities: {}, relationships: {} }, diagrams: [] } },
    dispatch: vi.fn(),
    undo: vi.fn(),
    canUndo: false,
    activeArchitectureId: 'arch-1',
    architectures: [],
    setActiveArchitecture: vi.fn(),
    refreshArchitectures: vi.fn(),
    invalidateArchitectureModelCache: vi.fn(),
    setArchitectureModelCacheInvalidator: vi.fn(),
  })),
  useArchitectureDispatch: () => mockDispatch,
  useActiveArchitectureId: () => ACTIVE_ARCH_ID,
}));

// Mock getDashboardSummary
const mockGetDashboardSummary = vi.fn();
vi.mock('../api/dashboardApi', () => ({
  getDashboardSummary: (...args: unknown[]) => mockGetDashboardSummary(...args),
}));

// Mock CSS module to return identity mapping
vi.mock('../components/DashboardView/DashboardView.module.css', () => ({
  default: new Proxy({}, {
    get: (_target, prop) => String(prop),
  }),
}));

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// ============================================================================
// Sample DTO fixture (updated for Dashboard UX Improvements type changes)
// ============================================================================

const sampleDto: DashboardSummaryDto = {
  header: {
    projectName: 'Test Project Alpha',
    generatedAt: '2026-02-18T12:00:00.000Z',
    initiativesCount: 3,
    epicsCount: 8,
    activeEpicsCount: 4,
    storiesInProgressCount: 12,
    lastUpdatedLabel: '2 hours ago',
    mode: 'GREENFIELD',
    headerInsight: '',
  },
  scope: {
    type: 'NEXT_5_EPICS',
    label: 'Next 5 Epics',
    scopeValue: null,
  },
  strategicFoundation: {
    productDefinition: {
      missionExists: { label: 'Mission Exists', value: true },
      lastUpdatedLabel: { label: 'Last Updated', value: '01/03/2026' },
    },
    highLevelArchitecture: {
      overall: { label: 'Overall', value: 14 },
      applications: { label: 'Applications', value: 5 },
      services: { label: 'Services', value: 3 },
      interfaces: { label: 'Interfaces', value: 4 },
      dataStores: { label: 'Data Stores', value: 2 },
    },
    roadmap: {
      initiativesCount: { label: 'Initiatives', value: 3 },
      epics: { label: 'Epics', value: 8 },
      completed: { label: 'Completed', value: 2 },
    },
    usersAndInteractions: {
      userRoles: { label: 'User Roles', value: 0 },
      businessActivities: { label: 'Business Activities', value: 0 },
      uiScreens: { label: 'UI Screens', value: 'No UI' },
    },
    standards: {
      orgTechStack: { label: 'Org Tech Stack', value: 'Generated' },
      productTechStack: { label: 'Product Tech Stack', value: 'Not Generated' },
    },
    testStrategy: {
      exists: { label: 'Exists', value: true },
      lastUpdated: { label: 'Last Updated', value: '08/03/2026' },
    },
    summaryInsight: { enabled: false, message: null },
  },
  detailedDefinitionAndDelivery: {
    preCoding: {
      backlog: {
        epicsInScope: { label: 'Epics In Scope', value: 5 },
        featuresCount: { label: 'Features', value: 10 },
        storiesCount: { label: 'Stories', value: 22 },
        storiesWithAcceptanceCriteriaCount: { label: 'Stories with AC', value: 14 },
      },
      detailedArchitecture: {
        overall: { label: 'Overall', value: 10 },
        processActivities: { label: 'Process Activities', value: 3 },
        interfaceEndpoints: { label: 'Interface Endpoints', value: 4 },
        logicalDataEntities: { label: 'Logical Data Entities', value: 2 },
        physicalDataEntities: { label: 'Physical Data Entities', value: 1 },
      },
      testingSuite: {
        endToEndTestCount: { label: 'E2E Tests', value: 3 },
        functionalTestCount: { label: 'Functional Tests', value: 8 },
      },
    },
    postCoding: {
      implementation: {
        featuresInProgress: { label: 'Features in Progress', value: 2 },
        storiesInProgress: { label: 'Stories in Progress', value: 7 },
        storiesComplete: { label: 'Stories Complete', value: 5 },
      },
      verification: {
        storiesVerifiedCount: { label: 'Stories Verified', value: 3 },
        pendingReviewCount: { label: 'Stories Pending Review', value: 2 },
      },
      summaryInsight: { enabled: false, message: null },
    },
  },
};

// ============================================================================
// Render helper -- mount DashboardView under a MemoryRouter so useNavigate()
// has a Router context (added by spec 2026-05-02).
// ============================================================================

/**
 * Probe that exposes the current pathname + search to tests so the navigation
 * assertion in Test 7 can read the canonical URL the dashboard navigates to.
 */
function PathnameProbe() {
  const loc = useLocation();
  return (
    <div data-testid="probe-pathname">{`${loc.pathname}${loc.search}`}</div>
  );
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/initial']}>
      <Routes>
        <Route
          path="/initial"
          element={
            <>
              <DashboardView />
              <PathnameProbe />
            </>
          }
        />
        {/* Catch-all so the post-navigate render still mounts the probe. */}
        <Route
          path="*"
          element={
            <>
              <DashboardView />
              <PathnameProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

// ============================================================================
// Tests
// ============================================================================

// We need to import DashboardView dynamically after mocks are set up
let DashboardView: React.FC;

beforeEach(async () => {
  vi.clearAllMocks();
  mockActiveProject = null;
  mockGetDashboardSummary.mockReset();
  // Import the component fresh
  const mod = await import('../components/DashboardView/DashboardView');
  DashboardView = mod.DashboardView;
});

describe('Dashboard Increment 3: DashboardView Component', () => {

  it('Test 1: renders empty-state when no project is selected', () => {
    mockActiveProject = null;
    renderDashboard();
    expect(screen.getByTestId('dashboard-view')).toBeInTheDocument();
    expect(screen.getByText('Select a project to view the dashboard.')).toBeInTheDocument();
  });

  it('Test 2: renders skeleton loading state while fetch is in progress', () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    // Never resolve the promise to keep loading state
    mockGetDashboardSummary.mockReturnValue(new Promise(() => {}));
    renderDashboard();
    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('header-summary')).not.toBeInTheDocument();
  });

  it('Test 3: renders error message and Retry button on fetch failure', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockRejectedValueOnce(new Error('Network error'));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('Test 4: renders header with projectName and scope label on success', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project Alpha' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Test Project Alpha')).toBeInTheDocument();
    });
    // Updated: Increment 4 -- "Next 5 Epics" now appears in both the header scope label
    // and the scope selector <option>, so use getAllByText instead of getByText
    expect(screen.getAllByText('Next 5 Epics').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('GREENFIELD')).toBeInTheDocument();
  });

  it('Test 5: renders 5 Strategic Foundation cards with correct data-testid (including Test Strategy)', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('card-product-definition')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-roadmap')).toBeInTheDocument();
    expect(screen.getByTestId('card-standards')).toBeInTheDocument();
    expect(screen.getByTestId('card-hla')).toBeInTheDocument();
    expect(screen.getByTestId('card-test-strategy')).toBeInTheDocument();
  });

  it('Test 6: renders 6 Detailed D&D cards with correct data-testid', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('card-backlog')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-detailed-architecture')).toBeInTheDocument();
    expect(screen.getByTestId('card-testing-suite')).toBeInTheDocument();
    expect(screen.getByTestId('card-implementation')).toBeInTheDocument();
    expect(screen.getByTestId('card-verification')).toBeInTheDocument();
    expect(screen.getByTestId('card-summary-insight')).toBeInTheDocument();
  });

  // Spec 2026-05-02 update: SET_VIEW + history.pushState replaced by useNavigate()
  // call to the canonical architecture-scoped URL with `?tab=roadmap`.
  it('Test 7: clicking the roadmap card action navigates to the canonical product URL with ?tab=roadmap', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('card-roadmap')).toBeInTheDocument();
    });

    const roadmapCard = screen.getByTestId('card-roadmap');
    fireEvent.click(within(roadmapCard).getByText('Open'));

    // The canonical URL is built from `useActiveArchitectureId()` (mocked above)
    // and the active project's id. The roadmap card targets the product view's
    // roadmap tab, so the navigation includes `?tab=roadmap`.
    await waitFor(() => {
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/proj-1/architectures/${ACTIVE_ARCH_ID}/product/roadmap`
      );
    });

    // SET_VIEW must NOT be dispatched (the action was removed in spec 2026-05-02).
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_VIEW' })
    );
  });

  it('Test 8: Summary Insight card shows "AI insights coming soon" with disabled styling', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('card-summary-insight')).toBeInTheDocument();
    });

    const insightCard = screen.getByTestId('card-summary-insight');
    expect(insightCard).toHaveTextContent('AI insights coming soon');
    // The card should have the disabled class applied
    expect(insightCard.className).toContain('cardDisabled');
  });
});

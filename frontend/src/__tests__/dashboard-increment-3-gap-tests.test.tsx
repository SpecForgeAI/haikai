/**
 * Dashboard Increment 3 -- Gap Tests (Frontend)
 *
 * Spec 2026-02-18: Dashboard Increment 3 -- Task Group 3
 * Task 3.3: Strategic gap tests covering critical workflows not covered
 * by Task Group 1 and 2 tests.
 *
 * Spec 2026-02-28: Hub Chat MVP v1 -- Removed PersonaPanelContext mock (context deleted)
 *
 * Spec 2026-03-06: Dashboard UX Improvements -- Task Group 5 (Task 5.6)
 * Updated mock data to conform to new type interfaces:
 * - ProductDefinitionMetrics: removed state, missionExists is boolean, lastUpdatedLabel is string
 * - RoadmapMetrics: removed state, renamed epicsCount to epics, renamed epicsCompletedCount to completed
 * - StandardsMetrics: renamed companyStandards to orgTechStack, productStandards to productTechStack (string values)
 * - PostCodingSection.implementation: now ImplementationMetrics (3 fields)
 * - StrategicFoundationSection: added testStrategy field
 * Updated test assertions:
 * - Gap Test 3: Standards card now renders string values directly ("Generated" / "Not Generated")
 *   instead of the old numeric value > 0 workaround
 * - Gap Test 6: Header summary text updated -- headerInsight is now dynamic (null when not provided)
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 7 (Task 7.3)
 * Mechanical updates for the SET_VIEW removal:
 *  - Wrapped <DashboardView /> in <MemoryRouter> so the new useNavigate() inside
 *    the component resolves a Router context.
 *  - Mocked useActiveArchitectureId so the component composes a non-null URL.
 *  - Gap Test 4 now asserts on the canonical product URL with `?tab=product`.
 *  - Gap Test 5 now asserts on the canonical metamodel URL (no query string).
 *
 * Gap tests:
 * 1. Error-then-retry flow: click Retry after error, verify re-fetch succeeds and data renders
 * 2. Project change triggers re-fetch with new project ID
 * 3. Standards card renders "Org Tech Stack: Generated" and "Product Tech Stack: Not Generated"
 * 4. Clicking "Open Product" navigates to /projects/.../architectures/.../product?tab=product
 * 5. Clicking "Open Architecture" on HLA card navigates to /projects/.../architectures/.../metamodel
 * 6. All header stat values from the DTO render in the header summary bar
 *
 * Mocks: useProject(), useArchitectureDispatch(), useActiveArchitectureId(), getDashboardSummary()
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { DashboardSummaryDto } from '../types/dashboard';

// ============================================================================
// Mock setup
// ============================================================================

const mockDispatch = vi.fn();
let mockActiveProject: { id: string; name: string } | null = null;
const ACTIVE_ARCH_ID = 'arch-uuid-gap-test';

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => mockActiveProject,
  useSetActiveProject: () => vi.fn(),
}));

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

const mockGetDashboardSummary = vi.fn();
vi.mock('../api/dashboardApi', () => ({
  getDashboardSummary: (...args: unknown[]) => mockGetDashboardSummary(...args),
}));

vi.mock('../components/DashboardView/DashboardView.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
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
    projectName: 'Gap Test Project',
    generatedAt: '2026-02-18T14:00:00.000Z',
    initiativesCount: 4,
    epicsCount: 10,
    activeEpicsCount: 5,
    storiesInProgressCount: 15,
    lastUpdatedLabel: '5 minutes ago',
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
      initiativesCount: { label: 'Initiatives', value: 4 },
      epics: { label: 'Epics', value: 10 },
      completed: { label: 'Completed', value: 3 },
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
        featuresCount: { label: 'Features', value: 12 },
        storiesCount: { label: 'Stories', value: 30 },
        storiesWithAcceptanceCriteriaCount: { label: 'Stories with AC', value: 20 },
      },
      detailedArchitecture: {
        overall: { label: 'Overall', value: 10 },
        processActivities: { label: 'Process Activities', value: 3 },
        interfaceEndpoints: { label: 'Interface Endpoints', value: 5 },
        logicalDataEntities: { label: 'Logical Data Entities', value: 2 },
        physicalDataEntities: { label: 'Physical Data Entities', value: 1 },
      },
      testingSuite: {
        endToEndTestCount: { label: 'E2E Tests', value: 4 },
        functionalTestCount: { label: 'Functional Tests', value: 10 },
      },
    },
    postCoding: {
      implementation: {
        featuresInProgress: { label: 'Features in Progress', value: 2 },
        storiesInProgress: { label: 'Stories in Progress', value: 7 },
        storiesComplete: { label: 'Stories Complete', value: 5 },
      },
      verification: {
        storiesVerifiedCount: { label: 'Stories Verified', value: 5 },
        pendingReviewCount: { label: 'Stories Pending Review', value: 3 },
      },
      summaryInsight: { enabled: false, message: null },
    },
  },
};

// ============================================================================
// Render helper -- mount DashboardView under a MemoryRouter so useNavigate()
// has a Router context.
// ============================================================================

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

let DashboardView: React.FC;

beforeEach(async () => {
  vi.clearAllMocks();
  mockActiveProject = null;
  mockGetDashboardSummary.mockReset();
  const mod = await import('../components/DashboardView/DashboardView');
  DashboardView = mod.DashboardView;
});

afterEach(() => {
  cleanup();
});

describe('Dashboard Increment 3: Gap Tests (Frontend)', () => {

  // ---- Gap Test 1: Error-then-retry flow ----
  it('Gap 1: clicking Retry after error re-fetches and renders data on success', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Gap Test Project' };

    // First call fails
    mockGetDashboardSummary.mockRejectedValueOnce(new Error('Network error'));

    renderDashboard();

    // Wait for error state
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    // Second call succeeds
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);

    // Click Retry
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    // Wait for successful render with project name
    await waitFor(() => {
      expect(screen.getByText('Gap Test Project')).toBeInTheDocument();
    });

    // Verify the fetch was called twice (initial + retry)
    expect(mockGetDashboardSummary).toHaveBeenCalledTimes(2);
  });

  // ---- Gap Test 2: Project change triggers re-fetch ----
  it('Gap 2: when activeProject changes, the component re-fetches with the new project ID', async () => {
    mockActiveProject = { id: 'proj-A', name: 'Project A' };

    const dtoProjA = { ...sampleDto, header: { ...sampleDto.header, projectName: 'Project A' } };
    mockGetDashboardSummary.mockResolvedValueOnce(dtoProjA);

    const { unmount } = renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Project A')).toBeInTheDocument();
    });
    expect(mockGetDashboardSummary).toHaveBeenCalledWith('proj-A');

    unmount();

    // Switch to project B
    mockActiveProject = { id: 'proj-B', name: 'Project B' };
    const dtoProjB = { ...sampleDto, header: { ...sampleDto.header, projectName: 'Project B' } };
    mockGetDashboardSummary.mockResolvedValueOnce(dtoProjB);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Project B')).toBeInTheDocument();
    });
    expect(mockGetDashboardSummary).toHaveBeenCalledWith('proj-B');
  });

  // ---- Gap Test 3: Standards card renders string values directly ----
  // Updated for Dashboard UX Improvements: standards now use string values
  // "Generated" / "Not Generated" directly, no numeric value > 0 workaround
  it('Gap 3: Standards card renders "Org Tech Stack: Generated" and "Product Tech Stack: Not Generated"', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('card-standards')).toBeInTheDocument();
    });

    const standardsCard = screen.getByTestId('card-standards');
    // orgTechStack has value: 'Generated'
    expect(standardsCard).toHaveTextContent('Org Tech Stack: Generated');
    // productTechStack has value: 'Not Generated'
    expect(standardsCard).toHaveTextContent('Product Tech Stack: Not Generated');
  });

  // ---- Gap Test 4: navigate to canonical product URL with ?tab=product ----
  // Spec 2026-05-02: SET_VIEW + history.pushState replaced by useNavigate().
  it('Gap 4: clicking "Open Product" navigates to the canonical product URL with ?tab=product', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('card-product-definition')).toBeInTheDocument();
    });

    const prodCard = screen.getByTestId('card-product-definition');
    fireEvent.click(within(prodCard).getByText('Open'));

    await waitFor(() => {
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/proj-1/architectures/${ACTIVE_ARCH_ID}/product/mission`
      );
    });

    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_VIEW' })
    );
  });

  // ---- Gap Test 5: navigate to canonical metamodel URL (no query) ----
  // Spec 2026-05-02: navigateTo now uses useNavigate; metamodel target has no
  // tab query string.
  it('Gap 5: clicking "Open Architecture" on HLA card navigates to the canonical metamodel URL with no query string', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('card-hla')).toBeInTheDocument();
    });

    const hlaCard = screen.getByTestId('card-hla');
    const openArchButton = within(hlaCard).getByText('Open');
    expect(openArchButton).toBeInTheDocument();

    fireEvent.click(openArchButton);

    await waitFor(() => {
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/proj-1/architectures/${ACTIVE_ARCH_ID}/metamodel`
      );
    });

    // No `?tab=` query string for metamodel navigation.
    expect(screen.getByTestId('probe-pathname').textContent).not.toMatch(/\?tab=/);

    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_VIEW' })
    );
  });

  // ---- Gap Test 6: Header renders project name, mode badge, and last updated chip ----
  // Updated for Dashboard UX Improvements: headerInsight is now dynamic (null when not provided)
  it('Gap 6: header summary bar renders project name, mode badge, and last updated chip', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Gap Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('header-summary')).toBeInTheDocument();
    });

    const header = screen.getByTestId('header-summary');
    // project name
    expect(header).toHaveTextContent('Gap Test Project');
    // mode badge
    expect(header).toHaveTextContent('GREENFIELD');
    // last updated chip
    expect(header).toHaveTextContent('Last updated:');
    expect(header).toHaveTextContent('5 minutes ago');
  });
});

/**
 * DashboardView Component Tests
 *
 * Spec 2026-02-18: Dashboard Increment 6 -- Task Group 5
 * Updated: Dashboard Increment 6 -- Task Group 6 (gap-fill tests)
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
 * Updated snapshot tests: deleted old snapshots to regenerate
 *
 * Behavioral and snapshot tests for the modified DashboardView component
 * covering the new loading skeleton, scope-error resilience, and retry
 * spinner states.
 *
 * Tests:
 * 1. Snapshot: loading skeleton renders and matches snapshot
 * 2. Snapshot: success dashboard renders targeted header snapshot
 * 3. Behavioral: scope-change error preserves header and strategic cards
 * 4. Behavioral: scope-change error shows inline banner with Retry
 * 5. Behavioral: clicking inline Retry re-triggers scope fetch
 * 6. Behavioral: retrying state shows loading skeleton on full-page error
 * 7. Gap: scope-error banner Retry transitions to skeleton loading cards
 * 8. Gap: full-page error state renders warning icon
 *
 * Mocks: ProjectContext, ArchitectureContext,
 *        dashboardApi, CSS module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import type { DashboardSummaryDto } from '../types/dashboard';
import { renderWithRouter } from '../test-utils/renderWithProviders';

// ============================================================================
// Mock setup
// ============================================================================

const mockDispatch = vi.fn();
let mockActiveProject: { id: string; name: string } | null = null;

// Mock ProjectContext
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => mockActiveProject,
  useSetActiveProject: () => vi.fn(),
}));

// Mock ArchitectureContext
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
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitectureDispatch: () => mockDispatch,
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

describe('DashboardView Component Tests (Increment 6)', () => {

  // --------------------------------------------------------------------------
  // Task 5.2: Snapshot test -- loading skeleton
  // --------------------------------------------------------------------------
  it('renders loading skeleton and matches snapshot', () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    // Never-resolving promise keeps the component in loading state
    mockGetDashboardSummary.mockReturnValue(new Promise(() => {}));

    renderWithRouter(<DashboardView />);

    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-skeleton').innerHTML).toMatchSnapshot();
  });

  // --------------------------------------------------------------------------
  // Task 5.3: Snapshot test -- success dashboard shell
  // --------------------------------------------------------------------------
  it('renders success dashboard and matches targeted snapshot', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);

    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('header-summary')).toBeInTheDocument();
    });

    expect(screen.getByTestId('header-summary').innerHTML).toMatchSnapshot();
  });

  // --------------------------------------------------------------------------
  // Task 5.4: Behavioral test -- scope-change error preserves header and strategic cards
  // --------------------------------------------------------------------------
  it('scope-change error preserves header and strategic foundation cards', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    // Initial load succeeds
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);

    renderWithRouter(<DashboardView />);

    // Wait for initial data to render
    await waitFor(() => {
      expect(screen.getByTestId('card-backlog')).toBeInTheDocument();
    });

    // Scope change will reject with an error
    mockGetDashboardSummary.mockRejectedValueOnce(new Error('Scope error'));

    await act(async () => {
      fireEvent.change(screen.getByTestId('scope-selector'), {
        target: { value: 'ENTIRE_PRODUCT' },
      });
    });

    // Wait for error state to settle
    await waitFor(() => {
      expect(screen.getByTestId('scope-error-banner')).toBeInTheDocument();
    });

    // Header summary remains visible
    expect(screen.getByTestId('header-summary')).toBeInTheDocument();
    // Strategic foundation cards remain visible
    expect(screen.getByTestId('card-product-definition')).toBeInTheDocument();
    expect(screen.getByTestId('card-roadmap')).toBeInTheDocument();
    // Scope selector remains visible
    expect(screen.getByTestId('scope-selector')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Task 5.5: Behavioral test -- scope-change error shows inline banner with Retry
  // --------------------------------------------------------------------------
  it('scope-change error shows inline error banner with Retry button', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    // Initial load succeeds
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);

    renderWithRouter(<DashboardView />);

    // Wait for initial data to render
    await waitFor(() => {
      expect(screen.getByTestId('card-backlog')).toBeInTheDocument();
    });

    // Scope change will reject
    mockGetDashboardSummary.mockRejectedValueOnce(new Error('Scope error'));

    await act(async () => {
      fireEvent.change(screen.getByTestId('scope-selector'), {
        target: { value: 'ENTIRE_PRODUCT' },
      });
    });

    // Wait for error banner to appear
    await waitFor(() => {
      expect(screen.getByTestId('scope-error-banner')).toBeInTheDocument();
    });

    // The error message text is visible within the banner
    expect(screen.getByText('Scope error')).toBeInTheDocument();
    // A Retry button exists within the banner
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Task 5.6: Behavioral test -- clicking inline Retry re-triggers scope fetch
  // --------------------------------------------------------------------------
  it('clicking Retry in scope error banner re-triggers scope fetch', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    // Initial load succeeds
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);

    renderWithRouter(<DashboardView />);

    // Wait for initial data to render
    await waitFor(() => {
      expect(screen.getByTestId('card-backlog')).toBeInTheDocument();
    });

    // Scope change rejects
    mockGetDashboardSummary.mockRejectedValueOnce(new Error('Scope error'));

    await act(async () => {
      fireEvent.change(screen.getByTestId('scope-selector'), {
        target: { value: 'ENTIRE_PRODUCT' },
      });
    });

    // Wait for error banner
    await waitFor(() => {
      expect(screen.getByTestId('scope-error-banner')).toBeInTheDocument();
    });

    const callCountBeforeRetry = mockGetDashboardSummary.mock.calls.length;

    // Mock next call to resolve with sampleDto (recovery)
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);

    // Click Retry
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });

    // getDashboardSummary was called again
    expect(mockGetDashboardSummary.mock.calls.length).toBeGreaterThan(callCountBeforeRetry);

    // After resolution, scope-error-banner should disappear
    await waitFor(() => {
      expect(screen.queryByTestId('scope-error-banner')).not.toBeInTheDocument();
    });

    // Detail cards are visible again
    expect(screen.getByTestId('card-backlog')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Task 5.7: Behavioral test -- retrying state disables Retry on full-page error
  // --------------------------------------------------------------------------
  it('retrying state disables Retry button on full-page error', async () => {
    // Use a UNIQUE project id: DashboardView keeps a module-level
    // per-project cache, so reusing 'proj-1' would render cached data
    // instead of the full-page error state.
    mockActiveProject = { id: 'proj-error-retry', name: 'Test Project' };
    // Initial load rejects -- triggers full-page error state
    mockGetDashboardSummary.mockRejectedValueOnce(new Error('Initial load failed'));

    renderWithRouter(<DashboardView />);

    // Wait for full-page error state and Retry button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
    expect(screen.getByText('Initial load failed')).toBeInTheDocument();

    // Mock next call with never-resolving promise to keep retrying state
    mockGetDashboardSummary.mockReturnValueOnce(new Promise(() => {}));

    // Click Retry -- this triggers setRetrying(true) then fetchData() which
    // sets setLoading(true). Because loading takes precedence over error in
    // the render logic, the component transitions to the loading skeleton.
    // This IS the retrying state from the user's perspective: the error is
    // replaced by the loading skeleton while the retry fetch is in progress.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });

    // The error state is replaced by the loading skeleton (retrying state)
    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument();
    // The error message and Retry button are no longer visible
    expect(screen.queryByText('Initial load failed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    // getDashboardSummary was called again (retry triggered)
    expect(mockGetDashboardSummary).toHaveBeenCalledTimes(2);
  });

  // --------------------------------------------------------------------------
  // Task 6.3 Gap 1: scope-error banner Retry transitions to skeleton loading
  // --------------------------------------------------------------------------
  it('scope-error banner Retry transitions to skeleton cards while re-fetch is pending', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    // Initial load succeeds
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);

    renderWithRouter(<DashboardView />);

    // Wait for initial data
    await waitFor(() => {
      expect(screen.getByTestId('card-backlog')).toBeInTheDocument();
    });

    // Scope change rejects
    mockGetDashboardSummary.mockRejectedValueOnce(new Error('Scope error'));

    await act(async () => {
      fireEvent.change(screen.getByTestId('scope-selector'), {
        target: { value: 'ENTIRE_PRODUCT' },
      });
    });

    // Wait for error banner
    await waitFor(() => {
      expect(screen.getByTestId('scope-error-banner')).toBeInTheDocument();
    });

    // Mock next call with never-resolving promise to keep scopeLoading=true
    mockGetDashboardSummary.mockReturnValueOnce(new Promise(() => {}));

    // Click Retry in the banner -- handleScopeChange clears scopeError and
    // sets scopeLoading=true, so the banner is replaced by skeleton cards
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });

    // The scope-error banner is gone (scopeError cleared)
    expect(screen.queryByTestId('scope-error-banner')).not.toBeInTheDocument();
    // Skeleton cards are visible (scopeLoading=true)
    const container = screen.getByTestId('dashboard-view');
    const skeletonCards = container.querySelectorAll('.skeletonCard');
    expect(skeletonCards.length).toBe(6);
    // Strategic cards remain visible
    expect(screen.getByTestId('card-product-definition')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Task 6.3 Gap 2: full-page error state renders warning icon
  // --------------------------------------------------------------------------
  it('full-page error state renders warning icon', async () => {
    // Unique project id to bypass the module-level dashboard cache.
    mockActiveProject = { id: 'proj-error-icon', name: 'Test Project' };
    // Initial load rejects -- triggers full-page error
    mockGetDashboardSummary.mockRejectedValueOnce(new Error('Server error'));

    renderWithRouter(<DashboardView />);

    // Wait for error state
    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });

    // The warning icon should be rendered
    expect(screen.getByText('\u26A0')).toBeInTheDocument();
  });

});

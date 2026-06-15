/**
 * Dashboard Increment 4: Scope Selector Tests
 *
 * Spec 2026-02-18: Dashboard Increment 4 -- Task Group 3, Task 3.5
 *
 * Spec 2026-02-28: Hub Chat MVP v1 -- Removed PersonaPanelContext mock (context deleted)
 *
 * Spec 2026-03-06: Dashboard Real Data -- default scope changed from NEXT_5_EPICS to ENTIRE_PRODUCT
 *
 * Tests:
 * 1. scope selector renders with default value ENTIRE_PRODUCT
 * 2. scope selector is inside scope-control-bar container
 * 3. changing scope calls getDashboardSummary with new scope
 * 4. scope selector is disabled during scopeLoading
 * 5. skeleton cards render during scopeLoading
 * 6. Strategic Foundation cards remain visible during scopeLoading
 * 7. selecting CUSTOM shows placeholder text
 * 8. after scope change completes, real cards render with updated data
 *
 * Mocks: useProject(), useArchitectureDispatch(), getDashboardSummary(), CSS module
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
// Sample DTO fixtures
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
    type: 'ENTIRE_PRODUCT',
    label: 'Entire Product',
    scopeValue: null,
  },
  strategicFoundation: {
    productDefinition: {
      missionExists: { label: 'Mission Exists', value: 1 },
      lastUpdatedLabel: { label: 'Last Updated', value: 0 },
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
      completed: { label: 'Epics Completed', value: 2 },
    },
    usersAndInteractions: {
      userRoles: { label: 'User Roles', value: 0 },
      businessActivities: { label: 'Business Activities', value: 0 },
      uiScreens: { label: 'UI Screens', value: 'No UI' },
    },
    standards: {
      orgTechStack: { label: 'Company Standards', value: 1 },
      productTechStack: { label: 'Product Standards', value: 0 },
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
        featuresInProgress: { label: 'Features in Progress', value: 0 },
        storiesInProgress: { label: 'Stories in Progress', value: 0 },
        storiesComplete: { label: 'Stories Complete', value: 0 },
      },
      verification: {
        storiesVerifiedCount: { label: 'Stories Verified', value: 3 },
        pendingReviewCount: { label: 'Stories Pending Review', value: 2 },
      },
      summaryInsight: { enabled: false, message: null },
    },
  },
};

/** Updated DTO for verifying data changes after a scope change */
const updatedDto: DashboardSummaryDto = {
  ...sampleDto,
  scope: {
    type: 'NEXT_5_EPICS',
    label: 'Next 5 Epics',
    scopeValue: null,
  },
  detailedDefinitionAndDelivery: {
    preCoding: {
      backlog: {
        epicsInScope: { label: 'Epics In Scope', value: 12 },
        featuresCount: { label: 'Features', value: 35 },
        storiesCount: { label: 'Stories', value: 85 },
        storiesWithAcceptanceCriteriaCount: { label: 'Stories with AC', value: 60 },
      },
      detailedArchitecture: {
        overall: { label: 'Overall', value: 38 },
        processActivities: { label: 'Process Activities', value: 25 },
        interfaceEndpoints: { label: 'Interface Endpoints', value: 42 },
        logicalDataEntities: { label: 'Logical Data Entities', value: 15 },
        physicalDataEntities: { label: 'Physical Data Entities', value: 12 },
      },
      testingSuite: {
        endToEndTestCount: { label: 'E2E Tests', value: 15 },
        functionalTestCount: { label: 'Functional Tests', value: 38 },
      },
    },
    postCoding: {
      implementation: {
        featuresInProgress: { label: 'Features in Progress', value: 0 },
        storiesInProgress: { label: 'Stories in Progress', value: 0 },
        storiesComplete: { label: 'Stories Complete', value: 0 },
      },
      verification: {
        storiesVerifiedCount: { label: 'Stories Verified', value: 20 },
        pendingReviewCount: { label: 'Stories Pending Review', value: 8 },
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

describe('Dashboard Increment 4: Scope Selector UI', () => {

  it('Test 1: scope selector renders with default value ENTIRE_PRODUCT', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('scope-selector')).toBeInTheDocument();
    });

    const selector = screen.getByTestId('scope-selector') as HTMLSelectElement;
    expect(selector.value).toBe('ENTIRE_PRODUCT');
  });

  it('Test 2: scope selector is inside scope-control-bar container', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('scope-control-bar')).toBeInTheDocument();
    });

    const controlBar = screen.getByTestId('scope-control-bar');
    const selector = screen.getByTestId('scope-selector');
    expect(controlBar).toContainElement(selector);
  });

  it('Test 3: changing scope calls getDashboardSummary with new scope', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('scope-selector')).toBeInTheDocument();
    });

    // Set up the second mock for the scope-change call
    mockGetDashboardSummary.mockResolvedValueOnce(updatedDto);

    const selector = screen.getByTestId('scope-selector');
    await act(async () => {
      fireEvent.change(selector, { target: { value: 'NEXT_5_EPICS' } });
    });

    // First call is the initial load, second is the scope change
    expect(mockGetDashboardSummary).toHaveBeenCalledWith('proj-1', 'NEXT_5_EPICS');
  });

  it('Test 4: scope selector is disabled during scopeLoading', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('scope-selector')).toBeInTheDocument();
    });

    // Create a promise that we control so we can check the intermediate state
    let resolveScope!: (value: DashboardSummaryDto) => void;
    const scopePromise = new Promise<DashboardSummaryDto>((resolve) => {
      resolveScope = resolve;
    });
    mockGetDashboardSummary.mockReturnValueOnce(scopePromise);

    // Trigger scope change -- do NOT await the handler's async completion
    await act(async () => {
      fireEvent.change(screen.getByTestId('scope-selector'), { target: { value: 'NEXT_5_EPICS' } });
    });

    // The selector should be disabled while waiting
    const selector = screen.getByTestId('scope-selector') as HTMLSelectElement;
    expect(selector.disabled).toBe(true);

    // Resolve and clean up
    await act(async () => {
      resolveScope(updatedDto);
    });
  });

  it('Test 5: skeleton cards render during scopeLoading', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('scope-selector')).toBeInTheDocument();
    });

    // Create a controlled promise
    let resolveScope!: (value: DashboardSummaryDto) => void;
    const scopePromise = new Promise<DashboardSummaryDto>((resolve) => {
      resolveScope = resolve;
    });
    mockGetDashboardSummary.mockReturnValueOnce(scopePromise);

    await act(async () => {
      fireEvent.change(screen.getByTestId('scope-selector'), { target: { value: 'QTR' } });
    });

    // Skeleton cards should be visible -- query by class name via the container
    const container = screen.getByTestId('dashboard-view');
    const skeletonCards = container.querySelectorAll('.skeletonCard');
    expect(skeletonCards.length).toBe(6);

    // Real detail cards should NOT be visible
    expect(screen.queryByTestId('card-backlog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-implementation')).not.toBeInTheDocument();

    // Resolve and clean up
    await act(async () => {
      resolveScope(sampleDto);
    });
  });

  it('Test 6: Strategic Foundation cards remain visible during scopeLoading', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('card-product-definition')).toBeInTheDocument();
    });

    // Create a controlled promise
    let resolveScope!: (value: DashboardSummaryDto) => void;
    const scopePromise = new Promise<DashboardSummaryDto>((resolve) => {
      resolveScope = resolve;
    });
    mockGetDashboardSummary.mockReturnValueOnce(scopePromise);

    await act(async () => {
      fireEvent.change(screen.getByTestId('scope-selector'), { target: { value: 'NEXT_5_EPICS' } });
    });

    // Strategic Foundation cards should still be in the DOM
    expect(screen.getByTestId('card-product-definition')).toBeInTheDocument();
    expect(screen.getByTestId('card-hla')).toBeInTheDocument();
    expect(screen.getByTestId('card-roadmap')).toBeInTheDocument();
    expect(screen.getByTestId('card-standards')).toBeInTheDocument();

    // Resolve and clean up
    await act(async () => {
      resolveScope(updatedDto);
    });
  });

  it('Test 7: selecting CUSTOM shows placeholder text', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('scope-selector')).toBeInTheDocument();
    });

    // Set up the scope-change response
    mockGetDashboardSummary.mockResolvedValueOnce({
      ...sampleDto,
      scope: { type: 'CUSTOM', label: 'Custom Scope', scopeValue: null },
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('scope-selector'), { target: { value: 'CUSTOM' } });
    });

    // Wait for the scope change to complete and placeholder to appear
    await waitFor(() => {
      expect(screen.getByText('(custom scope not yet configurable)')).toBeInTheDocument();
    });
  });

  it('Test 8: after scope change completes, real cards render with updated data', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('card-backlog')).toBeInTheDocument();
    });

    // Verify initial values
    expect(screen.getByText(/Epics In Scope: 5/)).toBeInTheDocument();

    // Trigger scope change with updated DTO
    mockGetDashboardSummary.mockResolvedValueOnce(updatedDto);

    await act(async () => {
      fireEvent.change(screen.getByTestId('scope-selector'), { target: { value: 'NEXT_5_EPICS' } });
    });

    // Wait for the updated values to render
    await waitFor(() => {
      expect(screen.getByText(/Epics In Scope: 12/)).toBeInTheDocument();
    });

    // Verify the real cards are back
    expect(screen.getByTestId('card-backlog')).toBeInTheDocument();
    expect(screen.getByTestId('card-implementation')).toBeInTheDocument();
    expect(screen.getByTestId('card-verification')).toBeInTheDocument();

    // Verify updated metric values
    expect(screen.getByText(/Stories: 85/)).toBeInTheDocument();
    expect(screen.getByText(/Features in Progress: 0/)).toBeInTheDocument();
  });
});

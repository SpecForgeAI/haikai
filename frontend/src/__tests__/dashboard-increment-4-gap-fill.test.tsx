/**
 * Dashboard Increment 4: Gap-Fill Tests
 *
 * Spec 2026-02-18: Dashboard Increment 4 -- Task Group 5, Task 5.2
 * Updated: Dashboard Increment 6 -- Task Group 3 (scope-error resilience)
 *
 * Spec 2026-02-28: Hub Chat MVP v1 -- Removed PersonaPanelContext mock (context deleted)
 *
 * Tests for critical untested paths identified during gap analysis:
 * 1. Error during scope change: verify inline error banner is shown while
 *    preserving dashboard data (header, strategic cards, scope selector)
 * 2. Error during scope change clears scopeLoading: verify that after
 *    a scope-change error, the inline error banner replaces skeleton cards
 *    while dashboard data remains visible
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
// Sample DTO fixture
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

describe('Dashboard Increment 4: Gap-Fill Tests', () => {

  it('Gap 1: error during scope change shows inline error banner while preserving dashboard data', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    // Initial load succeeds
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    // Wait for initial data to render
    await waitFor(() => {
      expect(screen.getByTestId('card-backlog')).toBeInTheDocument();
    });

    // Scope change will reject with an error
    mockGetDashboardSummary.mockRejectedValueOnce(new Error('Scope fetch failed'));

    await act(async () => {
      fireEvent.change(screen.getByTestId('scope-selector'), {
        target: { value: 'ENTIRE_PRODUCT' },
      });
    });

    // Wait for the error state to appear
    await waitFor(() => {
      expect(screen.getByTestId('scope-error-banner')).toBeInTheDocument();
    });

    // Inline scope error banner is shown
    expect(screen.getByTestId('scope-error-banner')).toBeInTheDocument();
    // Scope selector remains visible (dashboard data preserved)
    expect(screen.getByTestId('scope-selector')).toBeInTheDocument();
    // Strategic foundation cards remain visible
    expect(screen.getByTestId('card-product-definition')).toBeInTheDocument();
    expect(screen.getByTestId('card-roadmap')).toBeInTheDocument();
    // Error message is displayed within the scope error banner
    expect(screen.getByText('Scope fetch failed')).toBeInTheDocument();
    // Retry button is available in the banner
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('Gap 2: scope-change error clears skeleton and shows inline error banner while preserving data', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    // Initial load succeeds
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    // Wait for initial data to render
    await waitFor(() => {
      expect(screen.getByTestId('card-backlog')).toBeInTheDocument();
    });

    // Create a controlled promise that we will reject
    let rejectScope!: (reason: Error) => void;
    const scopePromise = new Promise<DashboardSummaryDto>((_resolve, reject) => {
      rejectScope = reject;
    });
    mockGetDashboardSummary.mockReturnValueOnce(scopePromise);

    // Trigger scope change
    await act(async () => {
      fireEvent.change(screen.getByTestId('scope-selector'), {
        target: { value: 'QTR' },
      });
    });

    // During loading, skeleton cards should be visible
    const container = screen.getByTestId('dashboard-view');
    const skeletonCards = container.querySelectorAll('.skeletonCard');
    expect(skeletonCards.length).toBe(6);

    // Now reject the promise
    await act(async () => {
      rejectScope(new Error('Network timeout'));
    });

    // After rejection, inline scope error banner should display
    await waitFor(() => {
      expect(screen.getByTestId('scope-error-banner')).toBeInTheDocument();
    });
    expect(screen.getByText('Network timeout')).toBeInTheDocument();
    // No skeleton cards should remain
    const remainingSkeletons = screen.getByTestId('dashboard-view').querySelectorAll('.skeletonCard');
    expect(remainingSkeletons.length).toBe(0);
    // Strategic cards and scope selector remain visible
    expect(screen.getByTestId('scope-selector')).toBeInTheDocument();
    expect(screen.getByTestId('card-product-definition')).toBeInTheDocument();
  });
});

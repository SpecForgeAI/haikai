/**
 * Dashboard Discovery Summary Card Tests
 *
 * Spec: Discovery Results Visibility (Increment 12)
 * Task Group 4, Task 4.1: 5 focused tests for the discovery summary card.
 *
 * Tests:
 * 1. Discovery card renders within the Technical sub-section with correct title and icon
 * 2. Card displays latest run status and key metrics when summary data is available
 * 3. Card renders disabled/empty state when no discovery runs exist
 * 4. "Open" button is present and triggers state change to show run detail view
 * 5. Discovery data fetch failure does not break the rest of the Dashboard
 *
 * Mocks: useProject(), useArchitectureDispatch(), getDashboardSummary(),
 *        getDiscoveryRunSummary(), useChatThread(), chatV2Api, fileUploadUtils, CSS module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import type { DashboardSummaryDto } from '../../../types/dashboard';
import { renderWithRouter } from '../../../test-utils/renderWithProviders';

// ============================================================================
// Mock setup
// ============================================================================

const mockDispatch = vi.fn();
let mockActiveProject: { id: string; name: string } | null = null;

// The discovery card's Open button navigates (react-router) to the
// first-class /discovery list route -- spy on useNavigate.
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual: any = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// Mock useChatThread to prevent errors from UnifiedChatPanel
vi.mock('../../../hooks/useChatThread', () => ({
  useChatThread: vi.fn(() => ({
    messages: [],
    activePersonaId: 'assistant',
    activeTaskId: 'unknown',
    isLoading: false,
    error: null,
    sendMessage: vi.fn(),
    selectPersona: vi.fn(),
    selectTask: vi.fn(),
    startTask: vi.fn(),
  })),
}));

// Mock ProjectContext
vi.mock('../../../contexts/ProjectContext', () => ({
  useProject: () => mockActiveProject,
  useSetActiveProject: () => vi.fn(),
}));

// Mock ArchitectureContext
// Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7:
// DashboardView now reads useActiveArchitectureId() to thread architectureId
// into getDiscoveryRunSummary(). Mock returns the test-fixture default arch.
vi.mock('../../../contexts/ArchitectureContext', () => ({
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
  useArchitecture: vi.fn(() => ({ currentView: 'dashboard' })),
  useArchitectureDispatch: () => mockDispatch,
  useActiveArchitectureId: () => 'arch-uuid-default',
}));

// Mock UserJourneyReviewContext (useActivateJourneyReview used in UnifiedChatPanel)
vi.mock('../../../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// Mock TemporaryDiagramContext (useActivateTemporaryDiagram used in UnifiedChatPanel)
vi.mock('../../../contexts/TemporaryDiagramContext', () => ({
  useActivateTemporaryDiagram: vi.fn(() => vi.fn()),
}));

// Mock getDashboardSummary
const mockGetDashboardSummary = vi.fn();
vi.mock('../../../api/dashboardApi', () => ({
  getDashboardSummary: (...args: unknown[]) => mockGetDashboardSummary(...args),
}));

// Mock getDiscoveryRunSummary
const mockGetDiscoveryRunSummary = vi.fn();
vi.mock('../../../api/discoveryApi', () => ({
  getDiscoveryRunSummary: (...args: unknown[]) => mockGetDiscoveryRunSummary(...args),
}));

// Mock CSS module to return identity mapping
vi.mock('../DashboardView.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

// Mock chatV2Api functions to prevent actual network calls
vi.mock('../../../api/chatV2Api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/chatV2Api')>();
  return {
    ...actual,
    getThreadHistory: vi.fn().mockResolvedValue({
      threadKey: 'project:test-123:hub',
      projectId: 'test-123',
      messages: [],
      activePersonaId: null,
      activeTaskId: null,
      createdAt: '2026-04-05T00:00:00.000Z',
      updatedAt: '2026-04-05T00:00:00.000Z',
    }),
    postChatV2: vi.fn().mockResolvedValue({
      threadKey: 'project:test-123:hub',
      personaId: 'assistant',
      taskId: 'unknown',
      assistant: { message: 'Response' },
      structuredResponse: null,
    }),
  };
});

// Mock file upload utils (imported by ChatInputBar)
vi.mock('../../../utils/fileUploadUtils', () => ({
  validateFiles: vi.fn().mockReturnValue({ valid: true }),
  readFilesAsBase64: vi.fn().mockResolvedValue([]),
  ACCEPTED_MIME_TYPES: '.txt,.pdf,.json',
  MAX_FILES: 5,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
}));

// ============================================================================
// Sample DTO fixtures
// ============================================================================

const sampleDto: DashboardSummaryDto = {
  header: {
    projectName: 'Test Project Alpha',
    generatedAt: '2026-04-05T12:00:00.000Z',
    initiativesCount: 5,
    epicsCount: 12,
    activeEpicsCount: 4,
    storiesInProgressCount: 7,
    lastUpdatedLabel: '1 hour ago',
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
      initiativesCount: { label: 'Initiatives', value: 5 },
      epics: { label: 'Epics', value: 12 },
      completed: { label: 'Completed', value: 2 },
    },
    usersAndInteractions: {
      userRoles: { label: 'User Roles', value: 0 },
      businessActivities: { label: 'Business Activities', value: 0 },
      uiScreens: { label: 'UI Screens', value: 'No UI' },
    },
    standards: {
      orgTechStack: { label: 'Org Tech Stack', value: 'Generated' },
      productTechStack: { label: 'Product Tech Stack', value: 'Generated' },
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

const sampleDiscoverySummary = {
  latest_run_id: 'run-abc-123',
  latest_run_status: 'COMPLETED',
  latest_run_created_at: '2026-04-05T10:00:00.000Z',
  total_candidates: 15,
  candidate_counts_by_status: { proposed: 10, accepted: 5 },
  entities_saved: 8,
  entity_type_coverage: 3,
};

// ============================================================================
// Tests
// ============================================================================

let DashboardView: React.FC;

beforeEach(async () => {
  vi.clearAllMocks();
  mockActiveProject = null;
  mockGetDashboardSummary.mockReset();
  mockGetDiscoveryRunSummary.mockReset();
  const mod = await import('../DashboardView');
  DashboardView = mod.DashboardView;
});

describe('Dashboard Discovery Summary Card (Task Group 4)', () => {

  // --------------------------------------------------------------------------
  // Test 1: Discovery card renders within the Technical sub-section
  // --------------------------------------------------------------------------
  it('Test 1: Discovery card renders within the Technical sub-section with correct title and icon', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project Alpha' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    mockGetDiscoveryRunSummary.mockResolvedValueOnce(sampleDiscoverySummary);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('card-discovery-summary')).toBeInTheDocument();
    });

    // Find the "Technical" sub-section label and its parent subSectionGroup
    const technicalLabel = screen.getAllByText('Technical').find(el =>
      el.className.includes('subSectionGroupLabel')
    );
    expect(technicalLabel).toBeDefined();
    const technicalGroup = technicalLabel!.parentElement!;

    // Verify discovery card is inside the Technical sub-section
    expect(within(technicalGroup).getByTestId('card-discovery-summary')).toBeInTheDocument();

    // Verify title text
    const discoveryCard = screen.getByTestId('card-discovery-summary');
    expect(discoveryCard).toHaveTextContent('Discovery');
  });

  // --------------------------------------------------------------------------
  // Test 2: Card displays latest run status and key metrics when data is available
  // --------------------------------------------------------------------------
  it('Test 2: Card displays latest run status and key metrics when summary data is available', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project Alpha' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    mockGetDiscoveryRunSummary.mockResolvedValueOnce(sampleDiscoverySummary);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('card-discovery-summary')).toBeInTheDocument();
    });

    const discoveryCard = screen.getByTestId('card-discovery-summary');
    expect(discoveryCard).toHaveTextContent('Status: COMPLETED');
    expect(discoveryCard).toHaveTextContent('Candidates: 15');
    expect(discoveryCard).toHaveTextContent('Entities Saved: 8');
    expect(discoveryCard).toHaveTextContent('Coverage: 3 types');
  });

  // --------------------------------------------------------------------------
  // Test 3: Card renders disabled/empty state when no discovery runs exist
  // --------------------------------------------------------------------------
  it('Test 3: Card renders disabled/empty state when no discovery runs exist', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project Alpha' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    mockGetDiscoveryRunSummary.mockResolvedValueOnce({
      latest_run_id: null,
      latest_run_status: null,
      latest_run_created_at: null,
      total_candidates: 0,
      candidate_counts_by_status: {},
      entities_saved: 0,
      entity_type_coverage: 0,
    });
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('card-discovery-summary')).toBeInTheDocument();
    });

    const discoveryCard = screen.getByTestId('card-discovery-summary');

    // Should have the disabled class
    expect(discoveryCard.className).toContain('cardDisabled');

    // Should show the disabled placeholder text
    expect(discoveryCard).toHaveTextContent('Discovery results coming soon');
  });

  // --------------------------------------------------------------------------
  // Test 4: "Open" button triggers state change to show run detail view
  // --------------------------------------------------------------------------
  it('Test 4: "Open" button is present and navigates to the discovery list route', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project Alpha' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    mockGetDiscoveryRunSummary.mockResolvedValueOnce(sampleDiscoverySummary);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('card-discovery-summary')).toBeInTheDocument();
    });

    const discoveryCard = screen.getByTestId('card-discovery-summary');
    const openButton = within(discoveryCard).getByText('Open');
    expect(openButton).toBeInTheDocument();

    // Click the Open button
    fireEvent.click(openButton);

    // Spec 2026-05-04 Comprehensive Frontend Routing: Open navigates to the
    // first-class /discovery list route (the in-page detail-view toggle is gone).
    expect(mockNavigate).toHaveBeenCalledWith(
      '/projects/proj-1/architectures/arch-uuid-default/discovery'
    );
  });

  // --------------------------------------------------------------------------
  // Test 5: Discovery data fetch failure does not break the rest of the Dashboard
  // --------------------------------------------------------------------------
  it('Test 5: Discovery data fetch failure does not break the rest of the Dashboard', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project Alpha' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    mockGetDiscoveryRunSummary.mockRejectedValueOnce(new Error('Network error'));
    renderWithRouter(<DashboardView />);

    // Dashboard should still render even if discovery fetch fails
    await waitFor(() => {
      expect(screen.getByTestId('card-product-definition')).toBeInTheDocument();
    });

    // Discovery card should render in the disabled state
    const discoveryCard = screen.getByTestId('card-discovery-summary');
    expect(discoveryCard.className).toContain('cardDisabled');
    expect(discoveryCard).toHaveTextContent('Discovery results coming soon');
  });
});

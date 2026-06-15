/**
 * DashboardView UX Improvements Tests
 *
 * Spec 2026-03-06: Dashboard UX Improvements -- Task Group 2
 * Task 2.1 / 2.14: 6 focused tests for the DashboardView component changes.
 *
 * Tests:
 * 1. Strategic Foundation renders two sub-section groups with labels "Product" and "Technical"
 * 2. "Technical" sub-section contains cards for Standards, High-Level Architecture, and Test Strategy
 * 3. "Product" sub-section contains cards for Product Definition and Roadmap
 * 4. Test Strategy card renders with "Exists: true" and "Last Updated: 08/03/2026" metrics
 * 5. Summary Insight card renders insight text (not disabled placeholder) when summaryInsight.enabled is true
 * 6. Implementation card renders three metrics (Features in Progress, Stories in Progress, Stories Complete)
 *
 * Mocks: useProject(), useArchitectureDispatch(), getDashboardSummary(),
 *        useChatThread(), chatV2Api, fileUploadUtils, CSS module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { DashboardSummaryDto } from '../../../types/dashboard';
import { renderWithRouter } from '../../../test-utils/renderWithProviders';

// ============================================================================
// Mock setup
// ============================================================================

const mockDispatch = vi.fn();
let mockActiveProject: { id: string; name: string } | null = null;

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
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitecture: vi.fn(() => ({ currentView: 'dashboard' })),
  useArchitectureDispatch: () => mockDispatch,
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
      createdAt: '2026-03-06T00:00:00.000Z',
      updatedAt: '2026-03-06T00:00:00.000Z',
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
// Sample DTO fixture (conforming to updated types from Task Group 1)
// ============================================================================

const sampleDto: DashboardSummaryDto = {
  header: {
    projectName: 'Test Project Alpha',
    generatedAt: '2026-03-06T12:00:00.000Z',
    initiativesCount: 5,
    epicsCount: 12,
    activeEpicsCount: 4,
    storiesInProgressCount: 7,
    lastUpdatedLabel: '1 hour ago',
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
      summaryInsight: {
        enabled: true,
        message: 'Delivery is progressing steadily with 5 stories completed and 7 actively in development across 2 features. Verification coverage is solid at 72% of completed stories reviewed. The testing suite has good functional coverage but end-to-end tests should be expanded before the next release milestone to reduce regression risk.',
      },
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
  const mod = await import('../DashboardView');
  DashboardView = mod.DashboardView;
});

describe('Dashboard UX Improvements: DashboardView Component (Task Group 2)', () => {

  // --------------------------------------------------------------------------
  // Test 1: Strategic Foundation renders two sub-section groups with labels
  // --------------------------------------------------------------------------
  it('Test 1: Strategic Foundation renders two sub-section groups with labels "Product" and "Technical"', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project Alpha' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('card-product-definition')).toBeInTheDocument();
    });

    // Find all sub-section group labels
    const subSectionLabels = screen.getAllByText(/^(Product|Technical)$/);
    const labelTexts = subSectionLabels.map(el => el.textContent);
    expect(labelTexts).toContain('Product');
    expect(labelTexts).toContain('Technical');
  });

  // --------------------------------------------------------------------------
  // Test 2: "Technical" sub-section contains Standards, HLA, and Test Strategy cards
  // --------------------------------------------------------------------------
  it('Test 2: "Technical" sub-section contains cards for Standards, High-Level Architecture, and Test Strategy', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project Alpha' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('card-standards')).toBeInTheDocument();
    });

    // Find the "Technical" sub-section label and its parent subSectionGroup
    const technicalLabel = screen.getAllByText('Technical').find(el =>
      el.className.includes('subSectionGroupLabel')
    );
    expect(technicalLabel).toBeDefined();
    const technicalGroup = technicalLabel!.parentElement!;

    // Verify all three cards are inside the Technical sub-section
    expect(within(technicalGroup).getByTestId('card-standards')).toBeInTheDocument();
    expect(within(technicalGroup).getByTestId('card-hla')).toBeInTheDocument();
    expect(within(technicalGroup).getByTestId('card-test-strategy')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 3: "Product" sub-section contains Product Definition and Roadmap cards
  // --------------------------------------------------------------------------
  it('Test 3: "Product" sub-section contains cards for Product Definition and Roadmap', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project Alpha' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('card-product-definition')).toBeInTheDocument();
    });

    // Find the "Product" sub-section label and its parent subSectionGroup
    const productLabel = screen.getAllByText('Product').find(el =>
      el.className.includes('subSectionGroupLabel')
    );
    expect(productLabel).toBeDefined();
    const productGroup = productLabel!.parentElement!;

    // Verify both cards are inside the Product sub-section
    expect(within(productGroup).getByTestId('card-product-definition')).toBeInTheDocument();
    expect(within(productGroup).getByTestId('card-roadmap')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 4: Test Strategy card renders with correct metrics
  // --------------------------------------------------------------------------
  it('Test 4: Test Strategy card renders with "Exists: true" and "Last Updated: 08/03/2026" metrics', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project Alpha' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('card-test-strategy')).toBeInTheDocument();
    });

    const testStrategyCard = screen.getByTestId('card-test-strategy');
    expect(testStrategyCard).toHaveTextContent('Test Strategy');
    expect(testStrategyCard).toHaveTextContent('Exists: true');
    expect(testStrategyCard).toHaveTextContent('Last Updated: 08/03/2026');
  });

  // --------------------------------------------------------------------------
  // Test 5: Summary Insight card renders insight text when enabled
  // --------------------------------------------------------------------------
  it('Test 5: Summary Insight card renders insight text (not disabled placeholder) when summaryInsight.enabled is true', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project Alpha' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('card-summary-insight')).toBeInTheDocument();
    });

    const insightCard = screen.getByTestId('card-summary-insight');

    // Should NOT have the disabled class
    expect(insightCard.className).not.toContain('cardDisabled');

    // Should NOT show the disabled placeholder
    expect(insightCard).not.toHaveTextContent('AI insights coming soon');

    // Should show the insight message text
    expect(insightCard).toHaveTextContent('Delivery is progressing steadily');
  });

  // --------------------------------------------------------------------------
  // Test 6: Implementation card renders three metrics
  // --------------------------------------------------------------------------
  it('Test 6: Implementation card renders three metrics (Features in Progress, Stories in Progress, Stories Complete)', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project Alpha' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('card-implementation')).toBeInTheDocument();
    });

    const implCard = screen.getByTestId('card-implementation');
    expect(implCard).toHaveTextContent('Features in Progress: 2');
    expect(implCard).toHaveTextContent('Stories in Progress: 7');
    expect(implCard).toHaveTextContent('Stories Complete: 5');
  });
});

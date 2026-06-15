/**
 * DashboardView Default Scope Tests
 *
 * Spec 2026-03-06: Dashboard Real Data -- Task Group 3
 * Task 3.1: 2 focused tests for the default scope change.
 *
 * Tests:
 * 1. DashboardView initializes with selectedScope set to 'ENTIRE_PRODUCT'
 * 2. The scope selector <select> element has 'ENTIRE_PRODUCT' as its default value
 *
 * Mocks: useProject(), useArchitectureDispatch(), getDashboardSummary(),
 *        useChatThread(), chatV2Api, fileUploadUtils, CSS module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
// Sample DTO fixture
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

describe('Dashboard Default Scope (Task Group 3)', () => {

  // --------------------------------------------------------------------------
  // Test 1: DashboardView initializes with selectedScope set to 'ENTIRE_PRODUCT'
  // --------------------------------------------------------------------------
  it('initializes with selectedScope set to ENTIRE_PRODUCT', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project Alpha' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('scope-selector')).toBeInTheDocument();
    });

    // The scope selector should have 'ENTIRE_PRODUCT' as its current value
    const scopeSelector = screen.getByTestId('scope-selector') as HTMLSelectElement;
    expect(scopeSelector.value).toBe('ENTIRE_PRODUCT');
  });

  // --------------------------------------------------------------------------
  // Test 2: The scope selector <select> element has 'ENTIRE_PRODUCT' as default
  // --------------------------------------------------------------------------
  it('scope selector <select> element has ENTIRE_PRODUCT as its default value on initial render', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project Alpha' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('scope-selector')).toBeInTheDocument();
    });

    // The selected option text should be 'Entire Product'
    const scopeSelector = screen.getByTestId('scope-selector') as HTMLSelectElement;
    const selectedOption = scopeSelector.options[scopeSelector.selectedIndex];
    expect(selectedOption.value).toBe('ENTIRE_PRODUCT');
    expect(selectedOption.textContent).toBe('Entire Product');
  });
});

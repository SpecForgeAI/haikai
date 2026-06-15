/**
 * ProductPage and Product Tab Tests
 *
 * Spec 2026-02-12: Increment 1 -- Add Product Tab + Minimal ProductDefinition
 * Task Group 3.1: Focused tests for the Product tab and ProductPage component
 *
 * Test 1: Product tab button renders in the tab bar when includeDatabase is true
 * Test 2: Product tab button is NOT rendered when includeDatabase is false
 * Test 3: Clicking the Product tab button renders the ProductPage component
 * Test 4: ProductPage displays the read-only product definition content area
 *          (Updated for Spec 2026-03-01: Increment 9 -- replaced PM chat panel with
 *          read-only content area + UnifiedChatPanel overlay)
 *
 * Task Group 4.3: Additional strategic tests to fill coverage gaps
 *
 * Gap Test 7: URL ?tab=product is recognized by parseTabFromUrl() and returns 'product'
 * Gap Test 8: Default tab remains 'backlog' when no tab parameter is in URL
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { renderWithRouter } from '../../../test-utils/renderWithProviders';

/**
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6:
 * ProductView is now a thin layout (tab bar = NavLinks + <Outlet/>); the tab
 * bodies are child routes. Tests therefore mount ProductView inside the same
 * route shape App.tsx uses (product parent + mission/backlog children).
 */
async function renderProductViewWithRoutes(initialPath: string) {
  const { ProductView } = await import('../ProductView');
  const { MissionTab } = await import('../MissionTab');
  const { BacklogTab } = await import('../BacklogTab');
  return renderWithRouter(
    <Routes>
      <Route
        path="/projects/:projectId/architectures/:architectureId/product"
        element={<ProductView />}
      >
        <Route index element={<Navigate replace to="backlog" />} />
        <Route path="mission" element={<MissionTab />} />
        <Route path="backlog" element={<BacklogTab />} />
      </Route>
    </Routes>,
    { initialEntries: [initialPath] }
  );
}

const PRODUCT_BASE = '/projects/project-123/architectures/arch-1/product';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock the includeDatabase toggle - default to true
let mockIncludeDatabase = true;
vi.mock('../../../contexts/AppConfigContext', () => ({
  useIncludeDatabase: () => mockIncludeDatabase,
}));

// Mock the useProject hook
const mockActiveProject = {
  id: 'project-123',
  name: 'Test Project',
  projectParentFolder: '/path/to/project',
  projectHierarchy: null,
  organisationId: null,
  isActive: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

vi.mock('../../../contexts/ProjectContext', () => ({
  useProject: () => mockActiveProject,
  useSetActiveProject: () => vi.fn(),
}));

// Mock the ArchitectureContext
vi.mock('../../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitecture: () => ({
    loadedFileName: 'test-file.json',
    currentView: 'dashboard',
  }),
  useArchitectureDispatch: () => vi.fn(),
}));

// Mock UserJourneyReviewContext (useActivateJourneyReview used in UnifiedChatPanel)
vi.mock('../../../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// Mock TemporaryDiagramContext (useActivateTemporaryDiagram used in UnifiedChatPanel)
vi.mock('../../../contexts/TemporaryDiagramContext', () => ({
  useActivateTemporaryDiagram: vi.fn(() => vi.fn()),
}));

// Mock the ProductUiStateContext
vi.mock('../../../contexts/ProductUiStateContext', () => ({
  ProductUiStateProvider: ({ children }: { children: React.ReactNode }) => children,
  useProductUiState: () => ({
    getImplementChatState: vi.fn(() => null),
    setImplementChatState: vi.fn(),
    getLastImplementWorkItemId: vi.fn(() => null),
    setLastImplementWorkItemId: vi.fn(),
  }),
  deriveProjectKey: (id: string) => id,
}));

// Mock the bookOfWorkApi
vi.mock('../../../api/bookOfWorkApi', () => ({
  uploadBookOfWork: vi.fn(),
}));

// Mock the chatApi (may still be needed by other components in ProductView tree)
const mockGetImplementConversation = vi.fn();
const mockPostChatMessage = vi.fn();
vi.mock('../../../api/chatApi', async () => {
  const actual = await vi.importActual('../../../api/chatApi');
  return {
    ...actual,
    getImplementConversation: (...args: unknown[]) => mockGetImplementConversation(...args),
  postChatMessage: (...args: unknown[]) => mockPostChatMessage(...args),
  convertMessageEntryToChatMessage: vi.fn((entry: { role: string; content: string; timestamp: string }) => ({
    id: `msg-${Date.now()}`,
    role: entry.role === 'system' ? 'assistant' : entry.role,
    content: entry.content,
    timestamp: new Date(entry.timestamp),
  })),
  };
});

// Spec 2026-03-01: Increment 9 -- Mock dashboardApi for ProductPage read-only content
vi.mock('../../../api/dashboardApi', () => ({
  getDashboardSummary: vi.fn().mockResolvedValue({
    header: { projectName: 'Test', generatedAt: '2026-03-01T00:00:00.000Z', initiativesCount: 2, epicsCount: 5, activeEpicsCount: 3, storiesInProgressCount: 0, lastUpdatedLabel: 'just now', mode: 'GREENFIELD', headerInsight: null },
    strategicFoundation: {
      productDefinition: { missionExists: { label: 'Mission', value: 1 }, lastUpdatedLabel: { label: 'Updated', value: 0 } },
      highLevelArchitecture: { overall: { label: 'Overall', value: 0 }, applications: { label: 'Apps', value: 0 }, services: { label: 'Services', value: 0 }, interfaces: { label: 'Interfaces', value: 0 }, dataStores: { label: 'Data Stores', value: 0 } },
      roadmap: { initiativesCount: { label: 'Initiatives', value: 2 }, epics: { label: 'Epics', value: 5 }, completed: { label: 'Completed', value: 0 } },
      standards: { orgTechStack: { label: 'Org Tech Stack', value: 0 }, productTechStack: { label: 'Product Tech Stack', value: 0 } },
      testStrategy: { exists: { label: 'Exists', value: true }, lastUpdated: { label: 'Last Updated', value: '08/03/2026' } },
      summaryInsight: { enabled: false, message: null },
    },
    scope: { type: 'NEXT_5_EPICS', label: 'Next 5 Epics', scopeValue: null },
    detailedDefinitionAndDelivery: {
      preCoding: { backlog: { epicsInScope: { label: 'Epics', value: 0 }, featuresCount: { label: 'Features', value: 0 }, storiesCount: { label: 'Stories', value: 0 }, storiesWithAcceptanceCriteriaCount: { label: 'AC', value: 0 } }, detailedArchitecture: { overall: { label: 'Overall', value: 0 }, processActivities: { label: 'PA', value: 0 }, interfaceEndpoints: { label: 'IE', value: 0 }, logicalDataEntities: { label: 'LDE', value: 0 }, physicalDataEntities: { label: 'PDE', value: 0 } }, testingSuite: { endToEndTestCount: { label: 'E2E', value: 0 }, functionalTestCount: { label: 'Functional', value: 0 } } },
      postCoding: { implementation: { featuresInProgress: { label: 'Features in Progress', value: 0 }, storiesInProgress: { label: 'Stories in Progress', value: 0 }, storiesComplete: { label: 'Stories Complete', value: 0 } }, verification: { storiesVerifiedCount: { label: 'Verified', value: 0 }, pendingReviewCount: { label: 'Pending', value: 0 } }, summaryInsight: { enabled: false, message: null } },
    },
  }),
}));

// Spec 2026-03-01: Increment 9 -- Mock useChatThread (needed by UnifiedChatPanel)
vi.mock('../../../hooks/useChatThread', () => ({
  useChatThread: vi.fn(() => ({
    messages: [],
    activePersonaId: 'product-manager',
    activeTaskId: 'unknown',
    isLoading: false,
    isGenerating: false,
    isSaving: false,
    artifactPreview: null,
    sealedTaskIds: [],
    error: null,
    sendMessage: vi.fn(),
    selectPersona: vi.fn(),
    selectTask: vi.fn(),
    startTask: vi.fn(),
    confirmArtifact: vi.fn(),
    rejectArtifact: vi.fn(),
  })),
  TASK_ARTIFACT_MAP: {},
}));

// Spec 2026-03-01: Increment 9 -- Mock chatV2Api
vi.mock('../../../api/chatV2Api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/chatV2Api')>();
  return {
    ...actual,
    getThreadHistory: vi.fn().mockResolvedValue({
      threadKey: 'project:project-123:panel:product',
      projectId: 'project-123',
      messages: [],
      activePersonaId: null,
      activeTaskId: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    }),
    postChatV2: vi.fn().mockResolvedValue({
      threadKey: 'project:project-123:panel:product',
      personaId: 'product-manager',
      taskId: 'unknown',
      assistant: { message: 'Response' },
      structuredResponse: null,
    }),
  };
});

// Spec 2026-03-01: Increment 9 -- Mock fileUploadUtils (needed by ChatInputBar)
vi.mock('../../../utils/fileUploadUtils', () => ({
  validateFiles: vi.fn().mockReturnValue({ valid: true }),
  readFilesAsBase64: vi.fn().mockResolvedValue([]),
  ACCEPTED_MIME_TYPES: '.txt,.pdf,.json',
  MAX_FILES: 5,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
}));

// Mock child components that are complex to render
vi.mock('../ProductBacklogPage', () => ({
  ProductBacklogPage: () => <div data-testid="mock-backlog-page">Backlog Page</div>,
}));

vi.mock('../ProductImplementPage', () => ({
  ProductImplementPage: () => <div data-testid="mock-implement-page">Implement Page</div>,
}));

vi.mock('../ProductRoadmapPage', () => ({
  ProductRoadmapPage: () => <div data-testid="mock-roadmap-page">Roadmap Page</div>,
  formatTimestamp: (ts: string) => ts,
}));

// ============================================================================
// Task Group 3.1: Original Tests
// ============================================================================

describe('Product Tab and ProductPage', () => {
  beforeEach(() => {
    mockIncludeDatabase = true;
    // Default chatApi mocks (may still be needed by other parts of the tree)
    mockGetImplementConversation.mockResolvedValue({ exists: false, messages: [] });
    mockPostChatMessage.mockResolvedValue({
      sessionId: 'session-1',
      assistant: { message: 'Hello! Let me help you define your product.' },
      productManagerResponse: { phase: 'questions', questions: [], summary: 'Hello!' },
    });
    // Set URL to default (no tab param)
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/');
  });

  /**
   * Test 1: Product tab button renders in the tab bar when includeDatabase is true
   */
  it('renders Product tab button in the tab bar when includeDatabase is true', async () => {
    mockIncludeDatabase = true;

    const { ProductView } = await import('../ProductView');
    renderWithRouter(<ProductView />);

    const productTab = screen.getByTestId('product-tab');
    expect(productTab).toBeInTheDocument();
    expect(productTab).toHaveTextContent('Product');

    // Verify it appears before the Roadmap tab in the DOM. The tabs are now
    // react-router NavLinks (anchors), not buttons.
    const tabBar = screen.getByTestId('product-tab-bar');
    const tabs = tabBar.querySelectorAll('a');
    expect(tabs[0]).toHaveAttribute('data-testid', 'product-tab');
    expect(tabs[1]).toHaveAttribute('data-testid', 'roadmap-tab');
  });

  /**
   * Test 2: Product tab button is NOT rendered when includeDatabase is false
   */
  it('does NOT render Product tab button when includeDatabase is false', async () => {
    mockIncludeDatabase = false;

    const { ProductView } = await import('../ProductView');
    renderWithRouter(<ProductView />);

    expect(screen.queryByTestId('product-tab')).not.toBeInTheDocument();

    // Roadmap, Backlog, and Implement tabs should still be present
    expect(screen.getByTestId('roadmap-tab')).toBeInTheDocument();
    expect(screen.getByTestId('backlog-tab')).toBeInTheDocument();
    expect(screen.getByTestId('implement-tab')).toBeInTheDocument();
  });

  /**
   * Test 3: Clicking the Product tab button renders the ProductPage component
   */
  it('renders ProductPage when Product tab is clicked', async () => {
    mockIncludeDatabase = true;

    await renderProductViewWithRoutes(`${PRODUCT_BASE}/backlog`);

    // Click the Product tab (NavLink -> navigates to the mission sub-route)
    const productTab = screen.getByTestId('product-tab');
    fireEvent.click(productTab);

    // Wait for ProductPage (via MissionTab) to render
    await waitFor(() => {
      expect(screen.getByTestId('product-page')).toBeInTheDocument();
    });
  });

  /**
   * Test 4: ProductPage displays the read-only product definition content area
   *
   * Updated for Spec 2026-03-01: Increment 9 -- The PM/SA chat panels were replaced
   * with a read-only product definition content area + UnifiedChatPanel overlay.
   */
  it('displays the read-only product definition content area', async () => {
    mockIncludeDatabase = true;

    const { ProductPage } = await import('../ProductPage');
    renderWithRouter(<ProductPage />);

    // Wait for page to render
    await waitFor(() => {
      expect(screen.getByTestId('product-page')).toBeInTheDocument();
    });

    // Placeholder should no longer exist
    expect(screen.queryByTestId('product-manager-placeholder')).not.toBeInTheDocument();

    // Legacy PM chat panel should NOT be rendered
    expect(screen.queryByTestId('pm-chat-container')).not.toBeInTheDocument();

    // Read-only product definition content area should be rendered
    expect(screen.getByTestId('product-definition-content')).toBeInTheDocument();
  });
});

// ============================================================================
// Task Group 4.3: Additional Strategic Tests (Gap Analysis)
// ============================================================================

describe('Product Tab and ProductPage - Gap Tests (Task Group 4.3)', () => {
  beforeEach(() => {
    mockIncludeDatabase = true;
    // Default chatApi mocks
    mockGetImplementConversation.mockResolvedValue({ exists: false, messages: [] });
    mockPostChatMessage.mockResolvedValue({
      sessionId: 'session-1',
      assistant: { message: 'Hello! Let me help you define your product.' },
      productManagerResponse: { phase: 'questions', questions: [], summary: 'Hello!' },
    });
    // Set URL to default (no tab param)
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/');
  });

  /**
   * Gap Test 7: the canonical URL for the Product tab is now the `mission`
   * sub-route (Spec 2026-05-04 replaced the legacy `?tab=product` query
   * param). Landing on `/.../product/mission` activates the Product tab and
   * renders ProductPage.
   */
  it('recognizes the mission sub-route URL and activates the Product tab', async () => {
    mockIncludeDatabase = true;

    await renderProductViewWithRoutes(`${PRODUCT_BASE}/mission`);

    // The Product tab should be present and active (aria-current via NavLink)
    const productTab = screen.getByTestId('product-tab');
    expect(productTab).toBeInTheDocument();
    expect(productTab).toHaveAttribute('aria-current', 'page');

    // ProductPage should be rendered because the URL targets the mission tab
    await waitFor(() => {
      expect(screen.getByTestId('product-page')).toBeInTheDocument();
    });
  });

  /**
   * Gap Test 8: Default tab remains 'backlog' when no tab parameter is in URL.
   *
   * Verifies that when no ?tab= parameter is in the URL, the default
   * active tab is 'backlog' (not 'product' or any other tab).
   */
  it('defaults to backlog tab when no tab parameter is in URL', async () => {
    mockIncludeDatabase = true;

    // Land on the bare `product` URL: the index route redirects to backlog.
    await renderProductViewWithRoutes(PRODUCT_BASE);

    // Backlog page should be rendered by default (mocked)
    await waitFor(() => {
      expect(screen.getByTestId('mock-backlog-page')).toBeInTheDocument();
    });

    // Product page should NOT be rendered
    expect(screen.queryByTestId('product-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('product-page-loading')).not.toBeInTheDocument();
  });
});

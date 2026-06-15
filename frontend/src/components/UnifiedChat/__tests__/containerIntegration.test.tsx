/**
 * Container & Integration Tests
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 7, Task 7.1: Write 5 focused tests for container and integration
 *
 * Spec 2026-02-28: Hub Chat MVP v1 -- Removed PersonaPanelContext mock (context deleted)
 *
 * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities
 * Task Group 3: Updated tests for per-threadKey persistence and defaultOpen behavior.
 * - Tests 1-2 now pass defaultOpen={true} since panel defaults to collapsed without it
 * - Tests 3-4 updated localStorage keys from shared 'unified-chat-panel-width'
 *   to per-threadKey 'unified-chat-width:project:test-proj-1:hub'
 * - Test 5 updated to expect expanded state since DashboardView passes defaultOpen={true}
 *
 * Spec 2026-03-03: UnifiedChatPanel UX Polish
 * Task Group 2: Updated Test 5 assertion to expect expanded panel state (unified-chat-panel)
 * since DashboardView now passes defaultOpen={true} to UnifiedChatPanel.
 *
 * Tests verify:
 * 1. UnifiedChatPanel renders in expanded state with header, ChatThread, and ChatInputBar
 * 2. UnifiedChatPanel toggles between collapsed (slim tab) and expanded states
 * 3. UnifiedChatPanel persists width to localStorage on resize (per-threadKey key)
 * 4. UnifiedChatPanel reads initial width from localStorage on mount (per-threadKey key)
 * 5. DashboardView renders UnifiedChatPanel when activeProject is not null
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';

// ============================================================================
// Mocks: must be declared before imports that use them
// ============================================================================

// Mock useChatThread hook
const mockSendMessage = vi.fn();
const mockSelectPersona = vi.fn();
const mockSelectTask = vi.fn();

vi.mock('../../../hooks/useChatThread', () => ({
  useChatThread: vi.fn(() => ({
    messages: [
      {
        id: 'msg-1',
        role: 'assistant',
        personaId: 'assistant',
        taskId: null,
        content: 'Hello! How can I help you?',
        structuredResponse: null,
        timestamp: '2026-02-28T10:00:00.000Z',
      },
    ],
    activePersonaId: 'assistant',
    activeTaskId: 'unknown',
    isLoading: false,
    error: null,
    sendMessage: mockSendMessage,
    selectPersona: mockSelectPersona,
    selectTask: mockSelectTask,
    startTask: vi.fn(),
  })),
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
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:00:00.000Z',
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

// Mock DashboardView dependencies
vi.mock('../../../contexts/ProjectContext', () => ({
  useProject: vi.fn(),
  useSetActiveProject: () => vi.fn(),
}));

vi.mock('../../../contexts/ArchitectureContext', () => ({
  useArchitecture: vi.fn(() => ({ currentView: 'dashboard' })),
  useArchitectureDispatch: vi.fn(() => vi.fn()),
  // Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG11:
  //   Group 7 added useActiveArchitectureId() to useChatThread + UnifiedChatPanel.
  //   Group 9/10 added useArchitectureContext() to the invalidation banner +
  //   picker. The pre-existing mock above only stubbed useArchitecture +
  //   useArchitectureDispatch, so the unmocked exports threw 'must be used
  //   within an ArchitectureProvider'. Add the two missing stubs to keep
  //   these pre-existing tests green without touching their assertions.
  useActiveArchitectureId: vi.fn(() => null),
  useArchitectureContext: vi.fn(() => ({
    architectures: [],
    setActiveArchitecture: vi.fn(),
  })),
}));

// Mock UserJourneyReviewContext (useActivateJourneyReview used in UnifiedChatPanel)
vi.mock('../../../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// Mock TemporaryDiagramContext (useActivateTemporaryDiagram used in UnifiedChatPanel)
vi.mock('../../../contexts/TemporaryDiagramContext', () => ({
  useActivateTemporaryDiagram: vi.fn(() => vi.fn()),
}));

vi.mock('../../../api/dashboardApi', () => ({
  getDashboardSummary: vi.fn(),
}));

vi.mock('../../DashboardView/DashboardSkeleton', () => ({
  DashboardSkeleton: () => <div data-testid="dashboard-skeleton">Loading...</div>,
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { UnifiedChatPanel } from '../UnifiedChatPanel';
import { DashboardView } from '../../DashboardView/DashboardView';
import { useProject } from '../../../contexts/ProjectContext';
import { getDashboardSummary } from '../../../api/dashboardApi';
import type { ThreadKey } from '../../../api/chatV2Api';
import { renderWithRouter } from '../../../test-utils/renderWithProviders';

// ============================================================================
// Test Helpers
// ============================================================================

const defaultThreadKey: ThreadKey = { type: 'hub', projectId: 'test-proj-1' };

/**
 * Helper to build a mock DashboardSummaryDto that passes all guards in DashboardView.
 */
function buildMockDashboardData() {
  const metric = (label: string, value: number | boolean | string) => ({ label, value });
  return {
    header: { mode: 'Build', lastUpdatedLabel: '2 hours ago' },
    strategicFoundation: {
      // Harness: DashboardView now renders the Users & Interactions card and
      // reads these metrics unconditionally; provide zeros so render succeeds.
      usersAndInteractions: {
        userRoles: metric('User Roles', 0),
        businessActivities: metric('Business Activities', 0),
        uiScreens: metric('UI Screens', 0),
      },
      productDefinition: {
        missionExists: metric('Mission', 'Yes'),
        lastUpdatedLabel: metric('Updated', '1 day ago'),
      },
      roadmap: {
        initiativesCount: metric('Initiatives', 3),
        epics: metric('Epics', 8),
        completed: metric('Completed', 2),
      },
      standards: {
        orgTechStack: metric('Company Standards', 1),
        productTechStack: metric('Product Standards', 0),
      },
      testStrategy: {
        exists: metric('Exists', true),
        lastUpdated: metric('Last Updated', '08/03/2026'),
      },
      highLevelArchitecture: {
        overall: metric('Overall', 15),
        applications: metric('Applications', 4),
        services: metric('Services', 6),
        interfaces: metric('Interfaces', 3),
        dataStores: metric('Data Stores', 2),
      },
      summaryInsight: { enabled: false, message: null },
    },
    detailedDefinitionAndDelivery: {
      preCoding: {
        backlog: {
          epicsInScope: metric('Epics in Scope', 5),
          featuresCount: metric('Features', 12),
          storiesCount: metric('Stories', 30),
          storiesWithAcceptanceCriteriaCount: metric('With AC', 20),
        },
        detailedArchitecture: {
          processActivities: metric('Process Activities', 10),
          interfaceEndpoints: metric('Interface Endpoints', 5),
          logicalDataEntities: metric('Logical Data Entities', 8),
          physicalDataEntities: metric('Physical Data Entities', 6),
        },
        testingSuite: {
          endToEndTestCount: metric('E2E Tests', 15),
          functionalTestCount: metric('Functional Tests', 25),
        },
      },
      postCoding: {
        implementation: {
          featuresInProgress: metric('Features in Progress', 0),
          storiesInProgress: metric('Stories in Progress', 0),
          storiesComplete: metric('Stories Complete', 0),
        },
        verification: {
          storiesVerifiedCount: metric('Stories Verified', 10),
          pendingReviewCount: metric('Stories Pending Review', 5),
        },
        summaryInsight: { enabled: false, message: null },
      },
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('UnifiedChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // --------------------------------------------------------------------------
  // Test 1: Renders in expanded state with header, ChatThread, and ChatInputBar
  // --------------------------------------------------------------------------

  it('renders in expanded state with header, ChatThread, and ChatInputBar', () => {
    renderWithRouter(
      <UnifiedChatPanel
        threadKey={defaultThreadKey}
        initialPersonaId="assistant"
        defaultOpen={true}
      />
    );

    // Panel should be in expanded state (data-testid="unified-chat-panel")
    expect(screen.getByTestId('unified-chat-panel')).toBeInTheDocument();

    // Header should be visible
    expect(screen.getByTestId('unified-chat-header')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();

    // Persona indicator should show Assistant initials
    expect(screen.getByTestId('persona-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('persona-indicator')).toHaveTextContent('AS');

    // ChatThread should be visible with the mock message
    expect(screen.getByTestId('chat-thread')).toBeInTheDocument();
    expect(screen.getByText('Hello! How can I help you?')).toBeInTheDocument();

    // ChatInputBar should be visible
    expect(screen.getByTestId('chat-input-bar')).toBeInTheDocument();

    // Collapse button should be present
    expect(screen.getByTestId('unified-chat-collapse-button')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 2: Toggles between collapsed (slim tab) and expanded states
  // --------------------------------------------------------------------------

  it('toggles between collapsed (slim tab) and expanded states', () => {
    renderWithRouter(
      <UnifiedChatPanel
        threadKey={defaultThreadKey}
        initialPersonaId="assistant"
        defaultOpen={true}
      />
    );

    // Initially expanded
    expect(screen.getByTestId('unified-chat-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('unified-chat-panel-collapsed')).not.toBeInTheDocument();

    // Click collapse button
    fireEvent.click(screen.getByTestId('unified-chat-collapse-button'));

    // Now should be in collapsed state
    expect(screen.queryByTestId('unified-chat-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('unified-chat-panel-collapsed')).toBeInTheDocument();

    // Collapsed tab should have "Chat" label
    const collapsedTab = screen.getByTestId('unified-chat-panel-collapsed');
    expect(collapsedTab).toHaveTextContent('Chat');

    // Click collapsed tab to expand
    fireEvent.click(collapsedTab);

    // Should be back to expanded state
    expect(screen.getByTestId('unified-chat-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('unified-chat-panel-collapsed')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 3: Persists width to localStorage on resize (per-threadKey key)
  // --------------------------------------------------------------------------

  it('persists width to localStorage on resize', () => {
    renderWithRouter(
      <UnifiedChatPanel
        threadKey={defaultThreadKey}
        initialPersonaId="assistant"
        defaultOpen={true}
      />
    );

    const resizeHandle = screen.getByTestId('unified-chat-resize-handle');

    // Simulate mousedown on the resize handle
    fireEvent.mouseDown(resizeHandle);

    // Simulate mousemove to resize (window.innerWidth defaults to 1024 in jsdom)
    // Move mouse to x=544, so new width = 1024 - 544 = 480
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 544, bubbles: true })
      );
    });

    // Simulate mouseup to finish resize
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    // Check that localStorage was updated with per-threadKey key
    const storedWidth = localStorage.getItem('unified-chat-width:project:test-proj-1:hub');
    expect(storedWidth).toBe('480');
  });

  // --------------------------------------------------------------------------
  // Test 4: Reads initial width from localStorage on mount (per-threadKey key)
  // --------------------------------------------------------------------------

  it('reads initial width from localStorage on mount', () => {
    // Pre-set a width in localStorage using per-threadKey key
    localStorage.setItem('unified-chat-width:project:test-proj-1:hub', '450');

    renderWithRouter(
      <UnifiedChatPanel
        threadKey={defaultThreadKey}
        initialPersonaId="assistant"
        defaultOpen={true}
      />
    );

    // The panel element should have the stored width
    const panel = screen.getByTestId('unified-chat-panel');
    expect(panel.style.width).toBe('450px');
  });

  // --------------------------------------------------------------------------
  // Test 5: DashboardView renders UnifiedChatPanel when activeProject is not null
  // DashboardView passes defaultOpen={true}, so the panel starts expanded.
  // --------------------------------------------------------------------------

  it('DashboardView renders UnifiedChatPanel when activeProject is not null', async () => {
    // Mock useProject to return an active project
    const mockProject = {
      id: 'proj-abc',
      name: 'Test Project',
      projectParentFolder: '/test',
      projectHierarchy: null,
      organisationId: null,
      isActive: true,
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:00:00.000Z',
    };
    vi.mocked(useProject).mockReturnValue(mockProject);

    // Mock getDashboardSummary to return valid data
    vi.mocked(getDashboardSummary).mockResolvedValue(buildMockDashboardData() as any);

    await act(async () => {
      renderWithRouter(<DashboardView />);
    });

    // Wait for the dashboard to finish loading and render
    // The DashboardView should now show the data state
    expect(screen.getByTestId('dashboard-view')).toBeInTheDocument();

    // UnifiedChatPanel should be rendered in expanded state (DashboardView passes defaultOpen={true})
    expect(screen.getByTestId('unified-chat-panel')).toBeInTheDocument();
  });
});

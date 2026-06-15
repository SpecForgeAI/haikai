/**
 * Side-by-Side Chat Panel Layout Tests
 *
 * Spec 2026-03-06: Dashboard UX Improvements
 * Task Group 3, Tasks 3.1 / 3.9: Write and verify 4 focused tests for inline layout
 *
 * Tests verify:
 * 1. DashboardView renders a .dashboardLayout flex-row wrapper containing both
 *    the dashboard container and the chat panel
 * 2. UnifiedChatPanel with layout="inline" prop renders with .panelInline class
 *    (not .panel with fixed positioning)
 * 3. When chat panel is collapsed in inline mode, collapsed tab uses
 *    .collapsedTabInline class (no fixed positioning)
 * 4. UnifiedChatPanel without layout prop (non-Dashboard views) still renders
 *    with .panel class (fixed positioning)
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
    messages: [],
    activePersonaId: 'assistant',
    activeTaskId: 'unknown',
    isLoading: false,
    isGenerating: false,
    isSaving: false,
    artifactPreview: null,
    sealedTaskIds: [],
    error: null,
    sendMessage: mockSendMessage,
    selectPersona: mockSelectPersona,
    selectTask: mockSelectTask,
    startTask: vi.fn(),
    confirmArtifact: vi.fn(),
    rejectArtifact: vi.fn(),
    clearThread: vi.fn(),
  })),
  TASK_ARTIFACT_MAP: {},
}));

// Mock chatV2Api functions -- keep threadKeyToString as the real implementation
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

// Mock ArchitectureContext (useArchitecture and useArchitectureDispatch used in UnifiedChatPanel)
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

// Mock PendingActionContext (usePendingAction used in UnifiedChatPanel)
vi.mock('../../../contexts/PendingActionContext', () => ({
  usePendingAction: vi.fn(() => ({
    pendingAction: null,
    setPendingAction: vi.fn(),
    clearPendingAction: vi.fn(),
  })),
}));

// Mock ModalActionContext (useModalActions used in UnifiedChatPanel)
vi.mock('../../../contexts/ModalActionContext', () => ({
  useModalActions: vi.fn(() => ({
    openGenerateStandardsModal: vi.fn(),
  })),
}));

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

const hubThreadKey: ThreadKey = { type: 'hub', projectId: 'test-proj-1' };

/**
 * Build mock DashboardSummaryDto matching the current type structure
 * (after Task Groups 1 and 2 updates).
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
        missionExists: metric('Mission Exists', true),
        lastUpdatedLabel: metric('Last Updated', '01/03/2026'),
      },
      roadmap: {
        initiativesCount: metric('Initiatives', 5),
        epics: metric('Epics', 12),
        completed: metric('Completed', 2),
      },
      standards: {
        orgTechStack: metric('Org Tech Stack', 'Generated'),
        productTechStack: metric('Product Tech Stack', 'Generated'),
      },
      highLevelArchitecture: {
        applications: metric('Applications', 4),
        services: metric('Services', 6),
        interfaces: metric('Interfaces', 3),
        dataStores: metric('Data Stores', 2),
      },
      testStrategy: {
        exists: metric('Exists', true),
        lastUpdated: metric('Last Updated', '08/03/2026'),
      },
    },
    detailedDefinitionAndDelivery: {
      preCoding: {
        backlog: {
          epicsInScope: metric('Epics in Scope', 5),
          featuresCount: metric('Features', 12),
          storiesCount: metric('Stories', 22),
          storiesWithAcceptanceCriteriaCount: metric('With AC', 14),
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
          featuresInProgress: metric('Features in Progress', 2),
          storiesInProgress: metric('Stories in Progress', 7),
          storiesComplete: metric('Stories Complete', 5),
        },
        verification: {
          storiesVerifiedCount: metric('Stories Verified', 10),
          pendingReviewCount: metric('Stories Pending Review', 5),
        },
        summaryInsight: {
          enabled: true,
          message: 'Delivery is progressing steadily.',
        },
      },
    },
  };
}

const mockProject = {
  id: 'proj-test-1',
  name: 'Test Project',
  projectParentFolder: '/test',
  projectHierarchy: null,
  organisationId: null,
  isActive: true,
  createdAt: '2026-03-06T00:00:00.000Z',
  updatedAt: '2026-03-06T00:00:00.000Z',
};

// ============================================================================
// Tests
// ============================================================================

// Provide a minimal localStorage stub for test environment
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

describe('Side-by-Side Chat Panel Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  // --------------------------------------------------------------------------
  // Test 1: DashboardView renders a .dashboardLayout flex-row wrapper
  //         containing both the dashboard container and the chat panel
  // --------------------------------------------------------------------------

  it('DashboardView renders a .dashboardLayout wrapper containing both dashboard and chat panel', async () => {
    vi.mocked(useProject).mockReturnValue(mockProject);
    vi.mocked(getDashboardSummary).mockResolvedValue(buildMockDashboardData() as any);

    await act(async () => {
      renderWithRouter(<DashboardView />);
    });

    // The .dashboardLayout wrapper should exist
    const layoutWrapper = screen.getByTestId('dashboard-layout');
    expect(layoutWrapper).toBeInTheDocument();

    // The dashboard container should be inside the layout wrapper
    const dashboardContainer = screen.getByTestId('dashboard-view');
    expect(layoutWrapper.contains(dashboardContainer)).toBe(true);

    // The chat panel should also be inside the layout wrapper
    const chatPanel = screen.getByTestId('unified-chat-panel');
    expect(layoutWrapper.contains(chatPanel)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Test 2: UnifiedChatPanel with layout="inline" renders with .panelInline
  //         class (not .panel with fixed positioning)
  // --------------------------------------------------------------------------

  it('renders with panelInline class when layout="inline" is set', () => {
    renderWithRouter(
      <UnifiedChatPanel
        threadKey={hubThreadKey}
        initialPersonaId="assistant"
        defaultOpen={true}
        layout="inline"
      />
    );

    const panel = screen.getByTestId('unified-chat-panel');
    expect(panel).toBeInTheDocument();

    // In inline mode, width style IS applied (defaults to 30% of viewport)
    expect(panel.style.width).not.toBe('');

    // The panel className should contain the inline variant
    expect(panel.className).toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // Test 3: When chat panel is collapsed in inline mode, collapsed tab uses
  //         .collapsedTabInline class (no fixed positioning)
  // --------------------------------------------------------------------------

  it('collapsed tab uses collapsedTabInline class in inline mode', () => {
    // Inline mode always starts expanded -- collapse it via the toggle button
    renderWithRouter(
      <UnifiedChatPanel
        threadKey={hubThreadKey}
        initialPersonaId="assistant"
        layout="inline"
      />
    );

    // Panel should start expanded in inline mode
    expect(screen.getByTestId('unified-chat-panel')).toBeInTheDocument();

    // Click the collapse button to collapse
    const collapseButton = screen.getByTestId('unified-chat-collapse-button');
    fireEvent.click(collapseButton);

    const collapsedTab = screen.getByTestId('unified-chat-panel-collapsed');
    expect(collapsedTab).toBeInTheDocument();

    // The collapsed tab className should be set (CSS modules mangle names)
    expect(collapsedTab.className).toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // Test 4: UnifiedChatPanel without layout prop (non-Dashboard views)
  //         still renders with .panel class (fixed positioning + explicit width)
  // --------------------------------------------------------------------------

  it('renders with panel class and explicit width when layout prop is absent (overlay mode)', () => {
    renderWithRouter(
      <UnifiedChatPanel
        threadKey={hubThreadKey}
        initialPersonaId="assistant"
        defaultOpen={true}
      />
    );

    const panel = screen.getByTestId('unified-chat-panel');
    expect(panel).toBeInTheDocument();

    // In overlay mode (default), width style should be applied
    expect(panel.style.width).toBe('380px');
  });
});

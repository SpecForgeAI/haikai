/**
 * Hub Chat MVP v1: Dashboard Card Wiring Tests (Navigation-Only Confirmation)
 *
 * Spec 2026-02-28: Hub Chat MVP v1 -- Task Group 5, Task 5.1
 *
 * Spec 2026-03-06: Dashboard UX Improvements -- Task Group 5 (Task 5.6)
 * Updated mock data to conform to new type interfaces:
 * - ProductDefinitionMetrics: removed state, missionExists is boolean, lastUpdatedLabel is string
 * - RoadmapMetrics: removed state, renamed epicsCount to epics, renamed epicsCompletedCount to completed
 * - StandardsMetrics: renamed companyStandards to orgTechStack, productStandards to productTechStack (string values)
 * - PostCodingSection.implementation: now ImplementationMetrics (3 fields)
 * - StrategicFoundationSection: added testStrategy field
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 7 (Task 7.3)
 * Mechanical updates for the SET_VIEW removal:
 *  - Wrapped <DashboardView /> in <MemoryRouter> so the new useNavigate() inside
 *    the component resolves a Router context.
 *  - Mocked useActiveArchitectureId so the component composes a non-null URL.
 *  - Tests 1 + 2 assert on the canonical pathname instead of the now-removed
 *    SET_VIEW dispatch + history.pushState pair.
 *
 * Verifies that:
 * 1. Clicking "Product Definition" card's "Open" button navigates to the canonical
 *    product URL (with ?tab=product) and does NOT attempt persona switching on UnifiedChatPanel
 * 2. Clicking "High-Level Architecture" card's "Open" button navigates to the canonical
 *    metamodel URL and does NOT attempt persona switching
 * 3. UnifiedChatPanel is rendered on the Dashboard when activeProject is present
 *
 * These tests confirm that card buttons are navigation-only after the PersonaHelperPanel
 * removal in TG4. No persona switching side effects occur on card clicks because
 * navigation away from the Dashboard causes UnifiedChatPanel to unmount.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { DashboardSummaryDto } from '../types/dashboard';

// ============================================================================
// Mock setup
// ============================================================================

const mockDispatch = vi.fn();
let mockActiveProject: { id: string; name: string } | null = null;
const ACTIVE_ARCH_ID = 'arch-uuid-hub-chat-wiring';

// Mock useChatThread to track persona switching calls
const mockSelectPersona = vi.fn();
const mockSelectTask = vi.fn();
const mockSendMessage = vi.fn();

vi.mock('../hooks/useChatThread', () => ({
  useChatThread: vi.fn(() => ({
    messages: [],
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

// Mock ProjectContext
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => mockActiveProject,
  useSetActiveProject: () => vi.fn(),
}));

// Mock ArchitectureContext
//
// Spec 2026-05-02 removed `currentView` from state. We expose
// useActiveArchitectureId so DashboardView's navigateTo helper can compose a
// non-null architecture-scoped URL.
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
  useArchitecture: vi.fn(() => ({})),
  useArchitectureDispatch: () => mockDispatch,
  useActiveArchitectureId: () => ACTIVE_ARCH_ID,
}));

// Mock UserJourneyReviewContext (useActivateJourneyReview used in UnifiedChatPanel)
vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// Mock TemporaryDiagramContext (useActivateTemporaryDiagram used in UnifiedChatPanel)
vi.mock('../contexts/TemporaryDiagramContext', () => ({
  useActivateTemporaryDiagram: vi.fn(() => vi.fn()),
}));

// Mock getDashboardSummary
const mockGetDashboardSummary = vi.fn();
vi.mock('../api/dashboardApi', () => ({
  getDashboardSummary: (...args: unknown[]) => mockGetDashboardSummary(...args),
}));

// Mock CSS module to return identity mapping
vi.mock('../components/DashboardView/DashboardView.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

// Mock chatV2Api functions to prevent actual network calls
vi.mock('../api/chatV2Api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/chatV2Api')>();
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
vi.mock('../utils/fileUploadUtils', () => ({
  validateFiles: vi.fn().mockReturnValue({ valid: true }),
  readFilesAsBase64: vi.fn().mockResolvedValue([]),
  ACCEPTED_MIME_TYPES: '.txt,.pdf,.json',
  MAX_FILES: 5,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
}));

// ============================================================================
// Sample DTO fixture (updated for Dashboard UX Improvements type changes)
// ============================================================================

const sampleDto: DashboardSummaryDto = {
  header: {
    projectName: 'Test Project',
    generatedAt: '2026-02-28T12:00:00.000Z',
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

describe('Hub Chat MVP v1: Dashboard Card Wiring (Navigation-Only Confirmation)', () => {

  // --------------------------------------------------------------------------
  // Test 1: Product Definition card navigates only -- no persona switching
  // --------------------------------------------------------------------------
  it('clicking "Product Definition" card Open button navigates to the canonical product URL and does NOT trigger persona switching', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);

    renderDashboard();

    // Wait for cards to render
    await waitFor(() => {
      expect(screen.getByTestId('card-product-definition')).toBeInTheDocument();
    });

    // Click the Product Definition card's "Open" button
    const prodCard = screen.getByTestId('card-product-definition');
    fireEvent.click(within(prodCard).getByText('Open'));

    // Spec 2026-05-02: navigateTo now uses useNavigate -- assert canonical URL.
    await waitFor(() => {
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/proj-1/architectures/${ACTIVE_ARCH_ID}/product/mission`
      );
    });

    // SET_VIEW dispatch must NOT happen (action removed in spec 2026-05-02).
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_VIEW' })
    );

    // Key assertion: NO persona switching happened on UnifiedChatPanel
    expect(mockSelectPersona).not.toHaveBeenCalled();
    expect(mockSelectTask).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 2: High-Level Architecture card navigates only -- no persona switching
  // --------------------------------------------------------------------------
  it('clicking "High-Level Architecture" card Open button navigates to the canonical metamodel URL and does NOT trigger persona switching', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);

    renderDashboard();

    // Wait for cards to render
    await waitFor(() => {
      expect(screen.getByTestId('card-hla')).toBeInTheDocument();
    });

    // Click the HLA card's "Open" button
    const hlaCard = screen.getByTestId('card-hla');
    fireEvent.click(within(hlaCard).getByText('Open'));

    // Spec 2026-05-02: navigateTo now uses useNavigate -- assert canonical URL.
    await waitFor(() => {
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/proj-1/architectures/${ACTIVE_ARCH_ID}/metamodel`
      );
    });

    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_VIEW' })
    );

    // Key assertion: NO persona switching happened on UnifiedChatPanel
    expect(mockSelectPersona).not.toHaveBeenCalled();
    expect(mockSelectTask).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 3: UnifiedChatPanel is rendered on the Dashboard when activeProject is present
  // --------------------------------------------------------------------------
  it('UnifiedChatPanel is rendered on the Dashboard when activeProject is present', async () => {
    mockActiveProject = { id: 'proj-abc', name: 'My Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);

    renderDashboard();

    // Wait for the dashboard to finish loading
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-view')).toBeInTheDocument();
    });

    // UnifiedChatPanel should be rendered (expanded state by default)
    expect(screen.getByTestId('unified-chat-panel')).toBeInTheDocument();
  });
});

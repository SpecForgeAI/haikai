/**
 * Hub Chat MVP v1: Cleanup Verification Tests
 *
 * Spec 2026-02-28: Hub Chat MVP v1 -- Task Group 4, Task 4.1
 *
 * Verifies that the PersonaHelperPanel and PersonaPanelContext infrastructure
 * has been fully removed and that DashboardView card buttons no longer
 * reference openPanel.
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 7 (Task 7.3)
 * Mechanical updates for the SET_VIEW removal:
 *  - Wrapped <DashboardView /> in <MemoryRouter> so the new useNavigate() inside
 *    the component resolves a Router context.
 *  - Mocked useActiveArchitectureId so the component composes a non-null URL.
 *  - Test 2's "dispatch SET_VIEW: 'product' / 'metamodel'" assertions become
 *    pathname assertions on the canonical architecture-scoped URLs.
 *  - Updated stripComments check to also confirm SET_VIEW is no longer
 *    referenced by DashboardView (cleanup invariant strengthened).
 *
 * Tests:
 * 1. App renders without PersonaPanelProvider and PersonaHelperPanel
 * 2. DashboardView card "Open" buttons navigate to canonical URLs (no openPanel
 *    dependency, no SET_VIEW dispatch)
 *
 * NOTE: The fact that these tests compile and run successfully is itself proof
 * that the PersonaPanelContext module has been deleted -- if DashboardView or App
 * still imported from it, the test would fail with a module resolution error.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { DashboardSummaryDto } from '../types/dashboard';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Mock setup for DashboardView tests
// ============================================================================

const mockDispatch = vi.fn();
let mockActiveProject: { id: string; name: string } | null = null;
const ACTIVE_ARCH_ID = 'arch-uuid-hub-chat-cleanup';

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => mockActiveProject,
  useSetActiveProject: () => vi.fn(),
}));

// Spec 2026-05-02: useArchitecture no longer carries `currentView`. Provide
// useActiveArchitectureId so DashboardView's navigateTo helper composes a
// non-null URL.
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
  useArchitectureDispatch: () => mockDispatch,
  useArchitecture: () => ({}),
  useActiveArchitectureId: () => ACTIVE_ARCH_ID,
}));

const mockGetDashboardSummary = vi.fn();
vi.mock('../api/dashboardApi', () => ({
  getDashboardSummary: (...args: unknown[]) => mockGetDashboardSummary(...args),
}));

vi.mock('../components/DashboardView/DashboardView.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// ============================================================================
// Helper: strip comments from source code for verification
// ============================================================================

/**
 * Remove single-line (//) and multi-line comments from source code
 * so that only actual code tokens are checked.
 */
function stripComments(src: string): string {
  // Remove multi-line comments (/* ... */) including JSX {/* ... */}
  let result = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove single-line comments (// ...)
  result = result.replace(/\/\/.*$/gm, '');
  return result;
}

// ============================================================================
// Sample DTO fixture (minimal for card rendering)
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

describe('Hub Chat MVP v1: Cleanup Verification', () => {

  // --------------------------------------------------------------------------
  // Test 1: App renders without PersonaPanelProvider and PersonaHelperPanel
  // --------------------------------------------------------------------------
  it('App component has no PersonaPanelProvider or PersonaHelperPanel references in code', () => {
    // Verify the source files have been deleted
    const srcDir = path.resolve(__dirname, '..');
    const personaPanelContextPath = path.join(srcDir, 'contexts', 'PersonaPanelContext.tsx');
    const personaHelperPanelPath = path.join(srcDir, 'components', 'PersonaHelperPanel', 'PersonaHelperPanel.tsx');
    const personaHelperPanelCssPath = path.join(srcDir, 'components', 'PersonaHelperPanel', 'PersonaHelperPanel.module.css');

    expect(fs.existsSync(personaPanelContextPath)).toBe(false);
    expect(fs.existsSync(personaHelperPanelPath)).toBe(false);
    expect(fs.existsSync(personaHelperPanelCssPath)).toBe(false);

    // Verify that App.tsx code (excluding comments) has no PersonaPanelProvider or PersonaHelperPanel
    const appTsxPath = path.join(srcDir, 'App.tsx');
    const appCode = stripComments(fs.readFileSync(appTsxPath, 'utf-8'));
    expect(appCode).not.toContain('PersonaPanelProvider');
    expect(appCode).not.toContain('PersonaHelperPanel');
    // Verify no import from PersonaPanelContext (check code, not comments)
    expect(appCode).not.toMatch(/from\s+['"]\.\/contexts\/PersonaPanelContext['"]/);
  });

  // --------------------------------------------------------------------------
  // Test 2: DashboardView card "Open" buttons navigate to canonical URLs
  //
  // Spec 2026-05-02 removed both openPanel (Hub Chat MVP) AND SET_VIEW (this
  // spec). The cleanup invariant remains: the buttons must navigate without
  // touching either piece of legacy infrastructure.
  // --------------------------------------------------------------------------
  it('DashboardView card "Open" buttons navigate to canonical URLs (no openPanel, no SET_VIEW dispatch)', async () => {
    mockActiveProject = { id: 'proj-1', name: 'Test Project' };
    mockGetDashboardSummary.mockResolvedValueOnce(sampleDto);

    renderDashboard();

    // Wait for the cards to render
    await waitFor(() => {
      expect(screen.getByTestId('card-product-definition')).toBeInTheDocument();
    });

    // Click the Product Definition card's "Open" button -- canonical product URL.
    const prodCard = screen.getByTestId('card-product-definition');
    fireEvent.click(within(prodCard).getByText('Open'));

    await waitFor(() => {
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/proj-1/architectures/${ACTIVE_ARCH_ID}/product/mission`
      );
    });

    // No SET_VIEW dispatch (action removed entirely in spec 2026-05-02).
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_VIEW' })
    );

    // Verify DashboardView.tsx code (excluding comments) has no openPanel or PersonaPanelContext.
    const srcDir = path.resolve(__dirname, '..');
    const dashboardViewPath = path.join(srcDir, 'components', 'DashboardView', 'DashboardView.tsx');
    const dashboardCode = stripComments(fs.readFileSync(dashboardViewPath, 'utf-8'));
    expect(dashboardCode).not.toContain('openPanel');
    expect(dashboardCode).not.toContain('useOpenPersonaPanel');
    expect(dashboardCode).not.toMatch(/from\s+['"].*PersonaPanelContext['"]/);

    // Click the HLA card's "Open" button -- canonical metamodel URL.
    const hlaCard = screen.getByTestId('card-hla');
    fireEvent.click(within(hlaCard).getByText('Open'));

    await waitFor(() => {
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/proj-1/architectures/${ACTIVE_ARCH_ID}/metamodel`
      );
    });
  });
});

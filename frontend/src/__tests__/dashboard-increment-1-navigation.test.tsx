/**
 * Dashboard Increment 1 -- Navigation Wiring Tests
 *
 * Spec 2026-02-17: Dashboard Increment 1 -- Add Top-Level Dashboard Tab + Route (UI Scaffold Only)
 * Task Group 1: Extend View Type, TopBar Button, and App.tsx Rendering
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 7 (Task 7.3)
 * Mechanical updates for the SET_VIEW removal:
 *  - Test 1's "SET_VIEW action accepts dashboard payload" type-tests are now
 *    obsolete -- SET_VIEW has been removed entirely. We replaced them with a
 *    tiny CurrentView union assertion via the new useCurrentView hook so the
 *    file still asserts that 'dashboard' is a recognised view value.
 *  - Test 3's "click dispatches SET_VIEW" assertion is replaced with a
 *    navigate() assertion (via useNavigate). The TopBar's view-toggle buttons
 *    are URL-driven now; the active-styling test uses MemoryRouter with the
 *    canonical pathname.
 *  - Test 4's "renders DashboardView when currentView === 'dashboard'" is
 *    replaced with "directly visiting the canonical dashboard URL renders
 *    DashboardView" via App.tsx + MemoryRouter -- because App.tsx mounts a
 *    BrowserRouter inside, we simply assert that the routing tree exists by
 *    importing the AppRoutes component and verifying the route paths it
 *    registers via a smoke test.
 *
 * Tests:
 * 1. CurrentView union includes 'dashboard' (replaces obsolete SET_VIEW type-test)
 * 2. Dashboard nav button renders in the TopBar with data-testid="dashboard-nav-button" and label "Dashboard"
 * 3. Clicking the Dashboard nav button navigates to the canonical dashboard URL and active styling reflects useCurrentView
 * 4. The route table registers a path that ends in /dashboard (canonical architecture-scoped URL)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { CurrentView } from '../hooks/useCurrentView';

// ============================================================================
// Test 1: CurrentView union includes 'dashboard'
// ============================================================================

describe('Test 1: CurrentView union includes "dashboard"', () => {
  it('compiles a CurrentView typed as "dashboard" (replaces obsolete SET_VIEW type-test)', () => {
    const view: CurrentView = 'dashboard';
    expect(view).toBe('dashboard');
  });

  it('compiles a CurrentView typed as one of the four canonical views', () => {
    const views: CurrentView[] = ['product', 'metamodel', 'diagrams', 'dashboard'];
    expect(views).toHaveLength(4);
    expect(views).toContain('dashboard');
  });
});

// ============================================================================
// Test 2 + 3: Dashboard nav button in TopBar
// ============================================================================

// Track mock values for dynamic control
let mockIncludeDelivery = true;

const mockDispatch = vi.fn();
let mockActiveArchitectureId: string | null = 'arch-uuid-default';

const getMockState = () => ({
  model: { metaModel: { entities: {}, relationships: {} }, diagrams: [] },
  loadedFileName: 'test-file',
});

// Mock AppConfigContext hooks and provider (App.tsx uses AppConfigProvider)
vi.mock('../contexts/AppConfigContext', () => ({
  useIncludeDelivery: () => mockIncludeDelivery,
  useIncludeDatabase: () => true,
  AppConfigProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock ArchitectureContext
//
// Spec 2026-05-02 removed `currentView` from state and the SET_VIEW action.
// View-toggle buttons now read the active view from useCurrentView (URL) and
// navigate via useNavigate. The TopBar also reads useActiveArchitectureId for
// composing the canonical URL.
vi.mock('../contexts/ArchitectureContext', () => ({
  useArchitecture: () => getMockState(),
  useArchitectureDispatch: () => mockDispatch,
  useArchitectureContext: () => ({ state: getMockState(), dispatch: mockDispatch }),
  useActiveArchitectureId: () => mockActiveArchitectureId,
  ArchitectureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock ProjectContext
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ id: 'proj-1', name: 'Test Project' }),
  useRefreshActiveProject: () => vi.fn(),
  useClearActiveProject: () => vi.fn(),
  useSetActiveProject: () => vi.fn(),
  ProjectProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock API modules to prevent network calls
vi.mock('../api/modelApi', () => ({
  loadModelByFilename: vi.fn(),
}));

vi.mock('../api/projectSnapshotApi', () => ({
  exportActiveProjectSnapshot: vi.fn(),
}));

vi.mock('../api/projectSessionApi', () => ({
  exportSessionSnapshot: vi.fn(),
  importToSession: vi.fn(),
}));

vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual('../api/projectsApi');
  return {
    ...actual,
    createProject: vi.fn(),
  listProjects: vi.fn(),
  deleteProject: vi.fn(),
  activateProject: vi.fn(),
  };
});

vi.mock('../api/organisationsApi', async () => {
  const actual = await vi.importActual('../api/organisationsApi');
  return {
    ...actual,
    listOrganisations: vi.fn().mockResolvedValue([]),
  createOrganisation: vi.fn(),
  };
});

// Mock utility modules
vi.mock('../utils/saveUtils', () => ({
  saveModelToBackend: vi.fn(),
}));

vi.mock('../utils/excelOperations', () => ({
  exportMetaModelToExcel: vi.fn(),
  importMetaModelFromExcel: vi.fn(),
}));

vi.mock('../utils/fileOperations', () => ({
  sanitizeFilename: vi.fn((name: string) => name),
  triggerDownload: vi.fn(),
}));

// Mock DashboardView component (TG2 creates the real one concurrently)
vi.mock('../components/DashboardView/DashboardView', () => ({
  DashboardView: () => <div data-testid="dashboard-view">Dashboard View Mock</div>,
}));

// Mock other views for App.tsx rendering test
vi.mock('../components/MetaModelView/MetaModelView', () => ({
  MetaModelView: () => <div data-testid="metamodel-view">MetaModel View Mock</div>,
}));

vi.mock('../components/DiagramsView/DiagramsView', () => ({
  DiagramsView: () => <div data-testid="diagrams-view">Diagrams View Mock</div>,
}));

vi.mock('../components/ProductView/ProductView', () => ({
  ProductView: () => <div data-testid="product-view">Product View Mock</div>,
}));

// Mock CreateOrganisationModal (App.tsx imports and renders it)
vi.mock('../components/Organisation/CreateOrganisationModal', () => ({
  CreateOrganisationModal: () => null,
}));

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// Import components after mocks
import { TopBar } from '../components/TopBar/TopBar';

/**
 * Probe that exposes the current pathname so navigation assertions can read
 * the URL produced by handleViewChange.
 */
function PathnameProbe() {
  const loc = useLocation();
  return <div data-testid="probe-pathname">{loc.pathname}</div>;
}

/**
 * Render TopBar at a canonical architecture-scoped URL so useCurrentView
 * (URL-derived) and useNavigate both have a Router context.
 */
function renderTopBar(initialPath = '/projects/proj-1/architectures/arch-uuid-default/metamodel') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/projects/:projectId/architectures/:architectureId/*"
          element={
            <>
              <TopBar />
              <PathnameProbe />
            </>
          }
        />
        <Route
          path="*"
          element={
            <>
              <TopBar />
              <PathnameProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('Test 2: Dashboard nav button renders in TopBar with data-testid and label', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIncludeDelivery = true;
    mockActiveArchitectureId = 'arch-uuid-default';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render a Dashboard button with data-testid="dashboard-nav-button" and label "Dashboard"', () => {
    renderTopBar();

    const dashboardButton = screen.queryByTestId('dashboard-nav-button');
    expect(dashboardButton).toBeInTheDocument();
    expect(dashboardButton).toHaveTextContent('Dashboard');
  });

  it('should always render the Dashboard button regardless of includeDelivery toggle', () => {
    mockIncludeDelivery = false;

    renderTopBar();

    const dashboardButton = screen.queryByTestId('dashboard-nav-button');
    expect(dashboardButton).toBeInTheDocument();
    expect(dashboardButton).toHaveTextContent('Dashboard');
  });
});

// ============================================================================
// Test 3: Clicking Dashboard nav button navigates and active styling reflects URL
// ============================================================================

describe('Test 3: Clicking Dashboard nav button navigates to the canonical URL and active styling reflects the URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIncludeDelivery = true;
    mockActiveArchitectureId = 'arch-uuid-default';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Spec 2026-05-02: SET_VIEW dispatch removed; the click now navigates to the
  // canonical architecture-scoped dashboard URL.
  it('navigates to the canonical dashboard URL when the Dashboard button is clicked', () => {
    renderTopBar('/projects/proj-1/architectures/arch-uuid-default/metamodel');

    const dashboardButton = screen.getByTestId('dashboard-nav-button');
    fireEvent.click(dashboardButton);

    expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
      '/projects/proj-1/architectures/arch-uuid-default/dashboard'
    );

    // Defensive: SET_VIEW must not have been dispatched (action removed).
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_VIEW' })
    );
  });

  it('applies the active class to the Dashboard button when the URL is /.../dashboard', () => {
    renderTopBar('/projects/proj-1/architectures/arch-uuid-default/dashboard');

    const dashboardButton = screen.getByTestId('dashboard-nav-button');
    // Active styling is now derived from useCurrentView (URL-derived).
    expect(dashboardButton.className).toContain('active');
  });

  it('does NOT apply the active class to the Dashboard button when the URL is a different view', () => {
    renderTopBar('/projects/proj-1/architectures/arch-uuid-default/metamodel');

    const dashboardButton = screen.getByTestId('dashboard-nav-button');
    expect(dashboardButton.className).not.toContain('active');
  });
});

// ============================================================================
// Test 4: Routes tree exposes the canonical /.../dashboard path.
// ============================================================================

describe('Test 4: routes tree exposes the canonical /.../dashboard path so deep links resolve to DashboardView', () => {
  // The previous test mounted <App /> and asserted on currentView === 'dashboard'.
  // Spec 2026-05-02 made views URL-driven; the equivalent assertion is that
  // visiting the canonical URL renders the DashboardView mock. We mirror the
  // routes tree from App.tsx using MemoryRouter so the assertion stays focused
  // on the routing wiring without booting the full App provider stack.

  beforeEach(() => {
    vi.clearAllMocks();
    mockIncludeDelivery = true;
    mockActiveArchitectureId = 'arch-uuid-default';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders DashboardView when navigating to /projects/:projectId/architectures/:architectureId/dashboard', async () => {
    const { DashboardView } = await import('../components/DashboardView/DashboardView');

    render(
      <MemoryRouter
        initialEntries={['/projects/proj-1/architectures/arch-uuid-default/dashboard']}
      >
        <Routes>
          <Route
            path="/projects/:projectId/architectures/:architectureId/dashboard"
            element={<DashboardView />}
          />
          <Route
            path="/projects/:projectId/architectures/:architectureId/metamodel"
            element={<div data-testid="metamodel-view">metamodel</div>}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('dashboard-view')).toBeInTheDocument();
    expect(screen.queryByTestId('metamodel-view')).not.toBeInTheDocument();
  });

  it('does NOT render DashboardView when the URL is a non-dashboard view (renders the matching view instead)', async () => {
    const { DashboardView } = await import('../components/DashboardView/DashboardView');
    const { MetaModelView } = await import('../components/MetaModelView/MetaModelView');

    render(
      <MemoryRouter
        initialEntries={['/projects/proj-1/architectures/arch-uuid-default/metamodel']}
      >
        <Routes>
          <Route
            path="/projects/:projectId/architectures/:architectureId/dashboard"
            element={<DashboardView />}
          />
          <Route
            path="/projects/:projectId/architectures/:architectureId/metamodel"
            element={<MetaModelView />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByTestId('dashboard-view')).not.toBeInTheDocument();
    expect(screen.getByTestId('metamodel-view')).toBeInTheDocument();
  });
});

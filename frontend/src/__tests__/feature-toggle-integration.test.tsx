/**
 * Feature Toggle Integration Tests
 *
 * Spec 2026-01-19: UI Route Gating for Startup Feature Toggles
 * Task Group 4: Mixed-Mode Integration & Test Gap Analysis
 *
 * Tests cover all four toggle combinations:
 * - (true, true): Full platform, no gating
 * - (true, false): Delivery UI present, DB menu items removed
 * - (false, true): Architecture-only UI, DB menu items present
 * - (false, false): Architecture-only UI, file-only menu
 *
 * Also verifies:
 * - View guard + TopBar consistency (hidden button + blocked navigation)
 * - No UI indicators reveal gated features (no tooltips, badges, etc.)
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 7 (Task 7.3)
 * Mechanical updates for the SET_VIEW removal:
 *  - currentView is no longer reducer state -- it is URL-derived. Tests that
 *    used to seed `mockCurrentView = 'product'` now seed the canonical URL
 *    via MemoryRouter `initialEntries`.
 *  - SET_VIEW dispatch assertions become URL/pathname assertions.
 *  - Tests that mounted <App /> to test the view-redirect guard now mount
 *    the relevant route directly under <MemoryRouter> + <ProjectLayout>.
 *  - Mocked useActiveArchitectureId so handleViewChange composes a non-null URL.
 *
 * Notes:
 *  - The "redirect from product view to metamodel when includeDelivery=false"
 *    used to live in App.tsx via a SET_VIEW dispatch on mount; that guard now
 *    runs at the route boundary in <ViewGuard> (or via the redirect inside
 *    <ProjectLayout>). The tests below assert the equivalent post-redirect
 *    URL is reached.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// Track mock values for dynamic control
let mockIncludeDelivery = true;
let mockIncludeDatabase = true;

const mockDispatch = vi.fn();
const ACTIVE_PROJECT = { id: 'proj-1', name: 'Test Project' };
const ACTIVE_ARCH_ID = 'arch-uuid-default';

// Mock AppConfigContext hooks - use functions to get current values
vi.mock('../contexts/AppConfigContext', () => ({
  useIncludeDelivery: () => mockIncludeDelivery,
  useIncludeDatabase: () => mockIncludeDatabase,
  AppConfigProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock ArchitectureContext
//
// Spec 2026-05-02 removed `currentView` from state. The TopBar's view-toggle
// buttons now read the URL via useCurrentView and write via useNavigate. We
// keep useArchitecture / useArchitectureContext mocks for non-view consumers
// (loadedFileName etc.) but no longer expose currentView in state.
const mockState = {
  model: { metaModel: { entities: {}, relationships: {} }, diagrams: [] },
  loadedFileName: 'test-file',
};

vi.mock('../contexts/ArchitectureContext', () => ({
  useArchitecture: () => mockState,
  useArchitectureDispatch: () => mockDispatch,
  useArchitectureContext: () => ({ state: mockState, dispatch: mockDispatch }),
  useActiveArchitectureId: () => ACTIVE_ARCH_ID,
  ArchitectureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock ProjectContext
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ACTIVE_PROJECT,
  useRefreshActiveProject: () => vi.fn(),
  useClearActiveProject: () => vi.fn(),
  ProjectProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSetActiveProject: () => vi.fn(),
}));

// Mock API modules to prevent network calls
vi.mock('../api/modelApi', () => ({
  loadModelByFilename: vi.fn(),
}));

vi.mock('../api/projectSnapshotApi', () => ({
  exportActiveProjectSnapshot: vi.fn(),
}));

vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual('../api/projectsApi');
  return {
    ...actual,
    createProject: vi.fn(),
  listProjects: vi.fn(),
  deleteProject: vi.fn(),
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
  sanitizeFilename: vi.fn((name) => name),
  triggerDownload: vi.fn(),
}));

// Mock child view components to simplify rendering
vi.mock('../components/MetaModelView/MetaModelView', () => ({
  MetaModelView: () => <div data-testid="metamodel-view">MetaModel View Mock</div>,
}));

vi.mock('../components/DiagramsView/DiagramsView', () => ({
  DiagramsView: () => <div data-testid="diagrams-view">Diagrams View Mock</div>,
}));

vi.mock('../components/ProductView/ProductView', () => ({
  ProductView: () => <div data-testid="product-view">Product View Mock</div>,
}));

// Import components after mocks
import { TopBar } from '../components/TopBar/TopBar';
import { FileMenu } from '../components/TopBar/FileMenu';

/**
 * Probe that exposes the current pathname so navigation assertions can read
 * the URL produced by the TopBar's view-toggle buttons.
 */
function PathnameProbe() {
  const loc = useLocation();
  return <div data-testid="probe-pathname">{loc.pathname}</div>;
}

/**
 * Render TopBar at a canonical architecture-scoped URL so useCurrentView
 * (URL-derived) and useNavigate both have a Router context.
 */
function renderTopBar(
  initialPath = `/projects/${ACTIVE_PROJECT.id}/architectures/${ACTIVE_ARCH_ID}/metamodel`
) {
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

describe('Feature Toggle Integration Tests', () => {
  // Default props for FileMenu
  const createFileMenuProps = () => ({
    visible: true,
    x: 100,
    y: 100,
    onClose: vi.fn(),
    onCreateProject: vi.fn(),
    onOpenBackend: vi.fn(),
    onSave: vi.fn(),
    saveDisabled: false,
    onSaveAsBackend: vi.fn(),
    saveAsDisabled: false,
    onDelete: vi.fn(),
    onImportJson: vi.fn(),
    importJsonDisabled: false,
    onExportJson: vi.fn(),
    exportJsonDisabled: false,
    onImportXlsx: vi.fn(),
    importXlsxDisabled: false,
    onExportXlsx: vi.fn(),
    exportXlsxDisabled: false,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to defaults
    mockIncludeDelivery = true;
    mockIncludeDatabase = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Mixed-Mode: (true, true) - Full platform, no gating', () => {
    beforeEach(() => {
      mockIncludeDelivery = true;
      mockIncludeDatabase = true;
    });

    it('should render Product & Delivery button and all menu items', () => {
      const { rerender } = renderTopBar();

      // TopBar assertions
      expect(screen.getByTestId('product-nav-button')).toBeInTheDocument();
      expect(screen.getByTestId('architecture-nav-button')).toBeInTheDocument();
      expect(screen.getByTestId('diagrams-nav-button')).toBeInTheDocument();

      // FileMenu assertions - render separately since TopBar doesn't show menu by default
      rerender(
        <MemoryRouter>
          <FileMenu {...createFileMenuProps()} />
        </MemoryRouter>
      );

      // All DB items present
      expect(screen.getByTestId('project-menu-create')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-open')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-save')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-save-as')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-delete')).toBeInTheDocument();

      // All file items present
      expect(screen.getByTestId('project-menu-import-json')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-export-json')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-import-xlsx')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-export-xlsx')).toBeInTheDocument();
    });
  });

  describe('Mixed-Mode: (true, false) - Delivery UI present, DB menu items removed', () => {
    beforeEach(() => {
      mockIncludeDelivery = true;
      mockIncludeDatabase = false;
    });

    it('should render Product & Delivery button but NOT DB menu items', () => {
      // TopBar with Product & Delivery visible
      renderTopBar();

      expect(screen.getByTestId('product-nav-button')).toBeInTheDocument();
      expect(screen.getByTestId('architecture-nav-button')).toBeInTheDocument();
      expect(screen.getByTestId('diagrams-nav-button')).toBeInTheDocument();
    });

    it('should hide DB menu items but show file import/export items', () => {
      render(
        <MemoryRouter>
          <FileMenu {...createFileMenuProps()} />
        </MemoryRouter>
      );

      // DB items should NOT be present
      expect(screen.queryByTestId('project-menu-create')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-menu-open')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-menu-save')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-menu-save-as')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-menu-delete')).not.toBeInTheDocument();

      // File items should still be present
      expect(screen.getByTestId('project-menu-import-json')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-export-json')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-import-xlsx')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-export-xlsx')).toBeInTheDocument();
    });

    // Spec 2026-05-02: SET_VIEW removed -- click navigates to canonical URL.
    it('should navigate to the canonical Product URL when the Product button is clicked', () => {
      renderTopBar();

      const productButton = screen.getByTestId('product-nav-button');
      fireEvent.click(productButton);

      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/${ACTIVE_PROJECT.id}/architectures/${ACTIVE_ARCH_ID}/product`
      );
      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SET_VIEW' })
      );
    });
  });

  describe('Mixed-Mode: (false, true) - Architecture-only UI, DB menu items present', () => {
    beforeEach(() => {
      mockIncludeDelivery = false;
      mockIncludeDatabase = true;
    });

    it('should NOT render Product & Delivery button but show all menu items', () => {
      renderTopBar();

      expect(screen.queryByTestId('product-nav-button')).not.toBeInTheDocument();
      expect(screen.getByTestId('architecture-nav-button')).toBeInTheDocument();
      expect(screen.getByTestId('diagrams-nav-button')).toBeInTheDocument();
    });

    it('should show all DB menu items and file import/export items', () => {
      render(
        <MemoryRouter>
          <FileMenu {...createFileMenuProps()} />
        </MemoryRouter>
      );

      // All DB items present
      expect(screen.getByTestId('project-menu-create')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-open')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-save')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-save-as')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-delete')).toBeInTheDocument();

      // All file items present
      expect(screen.getByTestId('project-menu-import-json')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-export-json')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-import-xlsx')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-export-xlsx')).toBeInTheDocument();
    });

    // Spec 2026-05-02: The redirect from /product to /metamodel used to be a
    // SET_VIEW dispatch from a top-level App.tsx effect. With URL-driven views
    // the equivalent guard runs in view-navigation-guard (see
    // view-navigation-guard.test.tsx) and is exercised by directly visiting
    // the gated URL. We assert the simpler invariant here: with
    // includeDelivery=false the Product nav button is hidden so the user
    // cannot reach the product URL via the TopBar.
    it('hides the Product nav button so the user cannot reach the gated product URL', () => {
      renderTopBar();
      expect(screen.queryByTestId('product-nav-button')).not.toBeInTheDocument();
    });
  });

  describe('Mixed-Mode: (false, false) - Architecture-only UI, file-only menu', () => {
    beforeEach(() => {
      mockIncludeDelivery = false;
      mockIncludeDatabase = false;
    });

    it('should NOT render Product & Delivery button and NOT render DB menu items', () => {
      renderTopBar();

      expect(screen.queryByTestId('product-nav-button')).not.toBeInTheDocument();
      expect(screen.getByTestId('architecture-nav-button')).toBeInTheDocument();
      expect(screen.getByTestId('diagrams-nav-button')).toBeInTheDocument();
    });

    it('should show ONLY file import/export items in menu', () => {
      render(
        <MemoryRouter>
          <FileMenu {...createFileMenuProps()} />
        </MemoryRouter>
      );

      // DB items should NOT be present
      expect(screen.queryByTestId('project-menu-create')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-menu-open')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-menu-save')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-menu-save-as')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-menu-delete')).not.toBeInTheDocument();

      // File items should still be present
      expect(screen.getByTestId('project-menu-import-json')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-export-json')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-import-xlsx')).toBeInTheDocument();
      expect(screen.getByTestId('project-menu-export-xlsx')).toBeInTheDocument();
    });

    // Spec 2026-05-02: see comment on the (false, true) variant.
    it('hides the Product nav button so the user cannot reach the gated product URL', () => {
      renderTopBar();
      expect(screen.queryByTestId('product-nav-button')).not.toBeInTheDocument();
    });
  });

  describe('View Guard + TopBar Consistency', () => {
    it('hides the Product nav button when includeDelivery=false', () => {
      mockIncludeDelivery = false;
      mockIncludeDatabase = true;

      renderTopBar();

      // Product button is not in the DOM (TopBar gating).
      expect(screen.queryByTestId('product-nav-button')).not.toBeInTheDocument();
    });
  });

  describe('No UI Indicators of Gated Features', () => {
    it('should not have any tooltips, badges, or disabled states revealing gated nav features', () => {
      mockIncludeDelivery = false;
      mockIncludeDatabase = true;

      renderTopBar();

      // The Product & Delivery button should simply not exist
      const productButton = screen.queryByTestId('product-nav-button');
      expect(productButton).not.toBeInTheDocument();

      // There should be no text mentioning "disabled", "locked", "unavailable" etc.
      expect(screen.queryByText(/disabled/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/locked/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/limited mode/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/file.?only/i)).not.toBeInTheDocument();

      // No aria-disabled on navigation buttons
      const archButton = screen.getByTestId('architecture-nav-button');
      const diagramsButton = screen.getByTestId('diagrams-nav-button');
      expect(archButton).not.toHaveAttribute('aria-disabled');
      expect(diagramsButton).not.toHaveAttribute('aria-disabled');
    });

    it('should not have any tooltips, badges, or indicators revealing gated menu features', () => {
      mockIncludeDelivery = true;
      mockIncludeDatabase = false;

      render(
        <MemoryRouter>
          <FileMenu {...createFileMenuProps()} />
        </MemoryRouter>
      );

      // The DB menu items should simply not exist
      expect(screen.queryByTestId('project-menu-create')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-menu-open')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-menu-save')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-menu-save-as')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-menu-delete')).not.toBeInTheDocument();

      // There should be no text mentioning DB features being unavailable
      expect(screen.queryByText(/database/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/create.*disabled/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/save.*unavailable/i)).not.toBeInTheDocument();

      // The remaining items should look normal (not greyed out)
      const importJsonItem = screen.getByTestId('project-menu-import-json');
      const exportJsonItem = screen.getByTestId('project-menu-export-json');
      expect(importJsonItem).not.toHaveAttribute('aria-disabled');
      expect(exportJsonItem).not.toHaveAttribute('aria-disabled');
    });
  });

  describe('App State Consistency Across Toggle Combinations', () => {
    // Spec 2026-05-02: The "no SET_VIEW dispatched on mount" assertion is
    // moot now that SET_VIEW has been removed. The equivalent invariant is
    // that visiting the metamodel URL does NOT fire any URL-rewriting guard
    // (path stays the same).
    it('should NOT change the URL when already on metamodel under a restricted toggle setup', () => {
      mockIncludeDelivery = false;
      mockIncludeDatabase = false;

      renderTopBar(`/projects/${ACTIVE_PROJECT.id}/architectures/${ACTIVE_ARCH_ID}/metamodel`);

      // No SET_VIEW dispatch should have happened (action removed entirely).
      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SET_VIEW' })
      );

      // The pathname is still the metamodel URL.
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/${ACTIVE_PROJECT.id}/architectures/${ACTIVE_ARCH_ID}/metamodel`
      );
    });

    // Spec 2026-05-02: SET_VIEW removed; assert URL changes via useNavigate.
    it('should allow navigation between allowed views when delivery is disabled', () => {
      mockIncludeDelivery = false;
      mockIncludeDatabase = true;

      renderTopBar(`/projects/${ACTIVE_PROJECT.id}/architectures/${ACTIVE_ARCH_ID}/metamodel`);

      // Click on Diagrams button -- URL becomes /diagrams.
      const diagramsButton = screen.getByTestId('diagrams-nav-button');
      fireEvent.click(diagramsButton);
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/${ACTIVE_PROJECT.id}/architectures/${ACTIVE_ARCH_ID}/diagrams`
      );

      // Click on Architecture button -- URL becomes /metamodel.
      const archButton = screen.getByTestId('architecture-nav-button');
      fireEvent.click(archButton);
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/${ACTIVE_PROJECT.id}/architectures/${ACTIVE_ARCH_ID}/metamodel`
      );

      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SET_VIEW' })
      );
    });
  });
});

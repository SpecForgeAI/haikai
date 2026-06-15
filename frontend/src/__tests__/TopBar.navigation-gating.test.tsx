/**
 * TopBar Navigation Gating Tests
 *
 * Spec 2026-01-19: UI Route Gating for Startup Feature Toggles
 * Task Group 1: TopBar Navigation Gating (includeDelivery)
 *
 * Tests cover:
 * 1. Product & Delivery button renders when includeDelivery=true
 * 2. Product & Delivery button does NOT render when includeDelivery=false
 * 3. Architecture & Design and Diagrams buttons always render regardless of toggle
 * 4. Navigation still works correctly for visible buttons when toggle is false
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 7 (Task 7.3)
 * Mechanical updates for the SET_VIEW removal:
 *  - Wrapped <TopBar /> in <MemoryRouter> so the new useNavigate() inside
 *    handleViewChange resolves a Router context.
 *  - Removed `currentView` from the mocked architecture state -- the field is
 *    no longer part of AppState.
 *  - Mocked useActiveArchitectureId so handleViewChange composes a non-null
 *    canonical URL.
 *  - Test 4 assertions become URL/pathname assertions instead of SET_VIEW
 *    dispatch assertions.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// Track mock values for dynamic control
let mockIncludeDelivery = true;

const PROJECT_ID = 'proj-1';
const ACTIVE_ARCH_ID = 'arch-uuid-default';

// Mock AppConfigContext hooks
vi.mock('../contexts/AppConfigContext', () => ({
  useIncludeDelivery: () => mockIncludeDelivery,
  useIncludeDatabase: () => true,
}));

// Mock ArchitectureContext - include all hooks used by TopBar and child components
//
// Spec 2026-05-02: removed `currentView` from state. Active-styling on the
// view-toggle buttons now derives from useCurrentView (URL-based, hook is
// the real one used by TopBar; we drive it via MemoryRouter initialEntries).
const mockDispatch = vi.fn();
const mockState = {
  model: { metaModel: { entities: {}, relationships: {} }, diagrams: [] },
  loadedFileName: 'test-file',
};
vi.mock('../contexts/ArchitectureContext', () => ({
  useArchitecture: () => mockState,
  useArchitectureDispatch: () => mockDispatch,
  useArchitectureContext: () => ({ state: mockState, dispatch: mockDispatch }),
  useActiveArchitectureId: () => ACTIVE_ARCH_ID,
}));

// Mock ProjectContext -- TopBar's handleViewChange requires a non-null
// project to compose the canonical URL.
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ id: PROJECT_ID, name: 'Test Project' }),
  useRefreshActiveProject: () => vi.fn(),
  useClearActiveProject: () => vi.fn(),
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

// Import after mocks
import { TopBar } from '../components/TopBar/TopBar';

/**
 * Probe that exposes the current pathname so navigation assertions can
 * read the URL produced by the TopBar's view-toggle buttons.
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
  initialPath = `/projects/${PROJECT_ID}/architectures/${ACTIVE_ARCH_ID}/metamodel`
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

describe('TopBar Navigation Gating (includeDelivery)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIncludeDelivery = true; // Reset to default
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Task 1.1 Test 1: Product & Delivery button renders when includeDelivery=true', () => {
    it('should render Product & Delivery button when includeDelivery is true', () => {
      mockIncludeDelivery = true;

      renderTopBar();

      const productButton = screen.queryByTestId('product-nav-button');
      expect(productButton).toBeInTheDocument();
      expect(productButton).toHaveTextContent('Product & Delivery');
    });
  });

  describe('Task 1.1 Test 2: Product & Delivery button does NOT render when includeDelivery=false', () => {
    it('should NOT render Product & Delivery button when includeDelivery is false', () => {
      mockIncludeDelivery = false;

      renderTopBar();

      const productButton = screen.queryByTestId('product-nav-button');
      expect(productButton).not.toBeInTheDocument();
    });

    it('should completely remove the button from DOM, not just hide it', () => {
      mockIncludeDelivery = false;

      renderTopBar();

      // Ensure no element with the text "Product & Delivery" exists
      expect(screen.queryByText('Product & Delivery')).not.toBeInTheDocument();
    });
  });

  describe('Task 1.1 Test 3: Architecture & Design and Diagrams buttons always render regardless of toggle', () => {
    it('should render Architecture & Design button when includeDelivery is true', () => {
      mockIncludeDelivery = true;

      renderTopBar();

      const architectureButton = screen.queryByTestId('architecture-nav-button');
      expect(architectureButton).toBeInTheDocument();
      expect(architectureButton).toHaveTextContent('Architecture & Design');
    });

    it('should render Architecture & Design button when includeDelivery is false', () => {
      mockIncludeDelivery = false;

      renderTopBar();

      const architectureButton = screen.queryByTestId('architecture-nav-button');
      expect(architectureButton).toBeInTheDocument();
      expect(architectureButton).toHaveTextContent('Architecture & Design');
    });

    it('should render Diagrams button when includeDelivery is true', () => {
      mockIncludeDelivery = true;

      renderTopBar();

      const diagramsButton = screen.queryByTestId('diagrams-nav-button');
      expect(diagramsButton).toBeInTheDocument();
      expect(diagramsButton).toHaveTextContent('Diagrams');
    });

    it('should render Diagrams button when includeDelivery is false', () => {
      mockIncludeDelivery = false;

      renderTopBar();

      const diagramsButton = screen.queryByTestId('diagrams-nav-button');
      expect(diagramsButton).toBeInTheDocument();
      expect(diagramsButton).toHaveTextContent('Diagrams');
    });
  });

  describe('Task 1.1 Test 4: Navigation still works correctly for visible buttons when toggle is false', () => {
    // Spec 2026-05-02: SET_VIEW dispatch removed -- click navigates to canonical URL.
    it('navigates to the canonical metamodel URL when Architecture & Design is clicked with toggle false', () => {
      mockIncludeDelivery = false;

      renderTopBar(`/projects/${PROJECT_ID}/architectures/${ACTIVE_ARCH_ID}/diagrams`);

      const architectureButton = screen.getByTestId('architecture-nav-button');
      fireEvent.click(architectureButton);

      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/${PROJECT_ID}/architectures/${ACTIVE_ARCH_ID}/metamodel`
      );
      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SET_VIEW' })
      );
    });

    it('navigates to the canonical diagrams URL when Diagrams is clicked with toggle false', () => {
      mockIncludeDelivery = false;

      renderTopBar(`/projects/${PROJECT_ID}/architectures/${ACTIVE_ARCH_ID}/metamodel`);

      const diagramsButton = screen.getByTestId('diagrams-nav-button');
      fireEvent.click(diagramsButton);

      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/${PROJECT_ID}/architectures/${ACTIVE_ARCH_ID}/diagrams`
      );
      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SET_VIEW' })
      );
    });
  });
});

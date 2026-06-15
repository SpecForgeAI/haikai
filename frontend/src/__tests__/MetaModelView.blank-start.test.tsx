/**
 * MetaModelView and ProductView Blank Start Tests
 *
 * Spec 2026-01-22: File Mode Blank Start UX
 * Task Group 3: Remove Forced Import Empty-State
 *
 * Tests verify that MetaModelView and ProductView render blank workspace
 * instead of NoProjectEmptyState when backend auto-initializes blank project.
 *
 * Since the backend now auto-initializes a blank "Untitled" project in File Mode,
 * the NoProjectEmptyState blocks have been removed from both views. These tests
 * verify that the views render their normal content without requiring a project import.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import React from 'react';

// Mock all context hooks to simulate File Mode with blank project
vi.mock('../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitecture: () => ({
    loadedFileName: 'Untitled',
    currentView: 'metamodel',
    selectedTab: 'Applications',
    selectedDomain: 'Application',
    model: {
      metaModel: {
        entities: {},
        relationships: {},
      },
    },
  }),
  useArchitectureDispatch: () => vi.fn(),
}));

vi.mock('../contexts/AppConfigContext', () => ({
  useIncludeDatabase: () => false, // File Mode
  useIncludeDelivery: () => true,
}));

// Mock ProjectContext to return the blank project (not null)
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({
    id: 'mock-uuid',
    name: 'Untitled',
    isActive: true,
  }),
  useRefreshActiveProject: () => vi.fn(),
  useClearActiveProject: () => vi.fn(),
  useSetActiveProject: () => vi.fn(),
}));

// Mock ImportActionsContext
vi.mock('../contexts/ImportActionsContext', () => ({
  useImportActions: () => ({
    triggerImportJson: vi.fn(),
    triggerImportXlsx: vi.fn(),
  }),
}));

// Mock child components to simplify testing
vi.mock('../components/Grid/Grid', () => ({
  Grid: () => <div data-testid="mock-grid">Grid</div>,
}));

vi.mock('../components/Grid/RelationshipGrid', () => ({
  RelationshipGrid: () => <div data-testid="mock-relationship-grid">RelationshipGrid</div>,
}));

// The legacy left-side ChatPanel was removed from MetaModelView; the side
// panel is now UnifiedChatPanel (gated on an active project).
vi.mock('../components/UnifiedChat', () => ({
  UnifiedChatPanel: () => <div data-testid="mock-unified-chat-panel">UnifiedChatPanel</div>,
}));

vi.mock('../components/MetaModelView/DomainSelector', () => ({
  DomainSelector: () => <div data-testid="mock-domain-selector">DomainSelector</div>,
}));

vi.mock('../components/MetaModelView/PackageSetsView', () => ({
  PackageSetsView: () => <div data-testid="mock-package-sets-view">PackageSetsView</div>,
}));

vi.mock('../config/gridConfigs', () => ({
  tabToEntityType: { 'Applications': 'application' },
  relationshipTabToType: {},
  domainGroupings: { 'Application': ['Applications'] },
}));

vi.mock('../config/relationshipDefinitions', () => ({
  getOrderedRelationshipDisplayNamesForDomain: () => [],
}));

// Import after mocks
import { Routes, Route } from 'react-router-dom';
import { MetaModelView } from '../components/MetaModelView/MetaModelView';

/**
 * Spec 2026-05-04 Comprehensive Frontend Routing: MetaModelView is a route
 * layout reading the `:domain` URL token, so it must be mounted at the
 * architecture-scoped metamodel URL.
 */
function renderMetaModelViewAtRoute() {
  return renderWithRouter(
    <Routes>
      <Route
        path="/projects/:projectId/architectures/:architectureId/metamodel/:domain"
        element={<MetaModelView />}
      />
    </Routes>,
    { initialEntries: ['/projects/mock-uuid/architectures/arch-1/metamodel/application'] }
  );
}

describe('MetaModelView Blank Start Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Test 1: MetaModelView renders blank workspace when project is "Untitled"
   *
   * Spec 2026-01-22: File Mode Blank Start UX
   * - Backend auto-initializes blank "Untitled" project
   * - MetaModelView no longer shows NoProjectEmptyState
   * - View renders normal workspace with Grid and ChatPanel
   */
  it('MetaModelView_rendersBlankWorkspace_whenProjectIsUntitled', () => {
    // Arrange & Act
    renderMetaModelViewAtRoute();

    // Assert - NoProjectEmptyState should NOT be present
    expect(screen.queryByTestId('no-project-empty-state')).not.toBeInTheDocument();

    // Assert - Normal workspace components ARE present (the legacy ChatPanel
    // was replaced by the UnifiedChatPanel side panel)
    expect(screen.getByTestId('mock-unified-chat-panel')).toBeInTheDocument();
    expect(screen.getByTestId('mock-domain-selector')).toBeInTheDocument();
    expect(screen.getByTestId('mock-grid')).toBeInTheDocument();
  });

  /**
   * Test 2: MetaModelView does not render NoProjectEmptyState in File Mode
   *
   * Spec 2026-01-22: File Mode Blank Start UX
   * - Previously, MetaModelView showed NoProjectEmptyState when activeProject === null
   * - Now that block is removed, so even with activeProject being the blank project,
   *   the view should render normally
   */
  it('MetaModelView_doesNotRenderNoProjectEmptyState_inFileMode', () => {
    // Arrange & Act
    renderMetaModelViewAtRoute();

    // Assert - NoProjectEmptyState elements should NOT be present
    expect(screen.queryByTestId('no-project-empty-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('empty-state-heading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-json-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-xlsx-button')).not.toBeInTheDocument();
  });
});

// ProductView tests require more complex mocking, creating a separate describe block

// Additional mocks for ProductView
vi.mock('../components/ProductView/ProductBacklogPage', () => ({
  ProductBacklogPage: () => <div data-testid="mock-backlog-page">ProductBacklogPage</div>,
}));

vi.mock('../components/ProductView/ProductImplementPage', () => ({
  ProductImplementPage: () => <div data-testid="mock-implement-page">ProductImplementPage</div>,
}));

vi.mock('../components/ProductView/ProductRoadmapPage', () => ({
  ProductRoadmapPage: () => <div data-testid="mock-roadmap-page">ProductRoadmapPage</div>,
  formatTimestamp: () => 'mocked-timestamp',
}));

vi.mock('../contexts/ProductUiStateContext', () => ({
  ProductUiStateProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useProductUiState: () => ({
    getLastImplementWorkItemId: vi.fn(),
    setLastImplementWorkItemId: vi.fn(),
  }),
  deriveProjectKey: () => 'mock-project-key',
}));

vi.mock('../api/bookOfWorkApi', () => ({
  uploadBookOfWork: vi.fn(),
}));

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// Import ProductView after mocks
import { ProductView } from '../components/ProductView/ProductView';
import { renderWithRouter } from '../test-utils/renderWithProviders';

describe('ProductView Blank Start Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset URL for each test
    window.history.pushState({}, '', '/');
  });

  /**
   * Test: ProductView renders blank workspace when project is "Untitled"
   *
   * Spec 2026-01-22: File Mode Blank Start UX
   * - Backend auto-initializes blank "Untitled" project
   * - ProductView no longer shows NoProjectEmptyState
   * - View renders normal workspace with tab bar and content
   */
  it('ProductView_rendersBlankWorkspace_whenProjectIsUntitled', () => {
    // Arrange & Act
    renderWithRouter(<ProductView />);

    // Assert - NoProjectEmptyState should NOT be present
    expect(screen.queryByTestId('no-project-empty-state')).not.toBeInTheDocument();

    // Assert - Normal workspace components ARE present
    expect(screen.getByTestId('product-view')).toBeInTheDocument();
    expect(screen.getByTestId('product-tab-bar')).toBeInTheDocument();
    expect(screen.getByTestId('roadmap-tab')).toBeInTheDocument();
    expect(screen.getByTestId('backlog-tab')).toBeInTheDocument();
    expect(screen.getByTestId('implement-tab')).toBeInTheDocument();
  });
});

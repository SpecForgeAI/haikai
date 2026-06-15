/**
 * MetaModelView Empty-State Tests
 *
 * Spec 2026-01-22: No-Database Mode Empty-State UX
 * Task Group 4: MetaModelView Empty-State Integration
 *
 * Updated for Spec 2026-01-22 File Mode Blank Start UX + Spec 2026-05-04
 * Comprehensive Frontend Routing:
 * - The NoProjectEmptyState gate was REMOVED from MetaModelView (the backend
 *   auto-initializes a blank project), so the view renders its normal layout
 *   in every mode.
 * - MetaModelView is now a route layout that reads the `:domain` URL token;
 *   it must be mounted at `/projects/:p/architectures/:a/metamodel/:domain`.
 * - The legacy left-side ChatPanel was removed; the side panel is now
 *   UnifiedChatPanel (mocked here).
 *
 * Tests cover:
 * 1. Renders normal content even when includeDatabase=false AND activeProject=null
 * 2. Shows normal MetaModelView content when includeDatabase=true
 * 3. Shows normal MetaModelView content when project is loaded (even in no-DB mode)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import React from 'react';
import { Routes, Route } from 'react-router-dom';

// Track mock values for dynamic control
let mockIncludeDatabase = true;
let mockActiveProject: { id: string; name: string } | null = null;

// Mock AppConfigContext hooks
vi.mock('../contexts/AppConfigContext', () => ({
  useIncludeDatabase: () => mockIncludeDatabase,
}));

// Mock ProjectContext
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => mockActiveProject,
  useSetActiveProject: () => vi.fn(),
}));

// Mock ArchitectureContext
vi.mock('../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitecture: () => ({
    selectedTab: 'Applications',
    selectedDomain: 'Application',
    loadedFileName: mockActiveProject ? 'TestProject' : null,
  }),
  useArchitectureDispatch: () => vi.fn(),
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
  Grid: () => <div data-testid="entity-grid">Entity Grid</div>,
}));

vi.mock('../components/Grid/RelationshipGrid', () => ({
  RelationshipGrid: () => <div data-testid="relationship-grid">Relationship Grid</div>,
}));

vi.mock('../components/MetaModelView/DomainSelector', () => ({
  DomainSelector: () => <div data-testid="domain-selector">Domain Selector</div>,
}));

vi.mock('../components/MetaModelView/PackageSetsView', () => ({
  PackageSetsView: () => <div data-testid="package-sets-view">Package Sets View</div>,
}));

// The right-hand side panel (only mounted when a project is active)
vi.mock('../components/UnifiedChat', () => ({
  UnifiedChatPanel: () => <div data-testid="unified-chat-panel">Unified Chat Panel</div>,
}));

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// Mock useDiscoveryOrigins (fires a fetch when project+architecture resolve)
vi.mock('../hooks/useDiscoveryOrigins', () => ({
  useDiscoveryOrigins: vi.fn(() => ({ originEntityIds: new Set(), loading: false })),
}));

// Import after mocks
import { MetaModelView } from '../components/MetaModelView/MetaModelView';
import { renderWithRouter } from '../test-utils/renderWithProviders';

function renderMetaModelView() {
  return renderWithRouter(
    <Routes>
      <Route
        path="/projects/:projectId/architectures/:architectureId/metamodel/:domain"
        element={<MetaModelView />}
      />
    </Routes>,
    { initialEntries: ['/projects/proj-123/architectures/arch-1/metamodel/application'] }
  );
}

describe('MetaModelView Empty-State', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIncludeDatabase = true;
    mockActiveProject = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Task 4.1 Test 1: Renders normal content when includeDatabase=false AND activeProject=null', () => {
    // Spec 2026-01-22 File Mode Blank Start UX removed the forced empty
    // state: the backend auto-initializes a blank project, so the view
    // renders its normal workspace even with no active project.
    it('should render the normal workspace (no empty state) in no-DB mode with no project', () => {
      mockIncludeDatabase = false;
      mockActiveProject = null;

      renderMetaModelView();

      // Empty state must NOT be shown
      expect(screen.queryByTestId('no-project-empty-state')).not.toBeInTheDocument();

      // Normal view elements render directly
      expect(screen.getByTestId('domain-selector')).toBeInTheDocument();
      expect(screen.getByTestId('entity-grid')).toBeInTheDocument();
    });
  });

  describe('Task 4.1 Test 2: Shows normal MetaModelView content when includeDatabase=true', () => {
    it('should render normal content when in DB mode (even without project)', () => {
      mockIncludeDatabase = true;
      mockActiveProject = null;

      renderMetaModelView();

      // Should NOT show empty state
      expect(screen.queryByTestId('no-project-empty-state')).not.toBeInTheDocument();

      // Should show normal view elements. The side panel is gated on an
      // active project, so it is absent here.
      expect(screen.getByTestId('domain-selector')).toBeInTheDocument();
      expect(screen.getByTestId('entity-grid')).toBeInTheDocument();
      expect(screen.queryByTestId('unified-chat-panel')).not.toBeInTheDocument();
    });
  });

  describe('Task 4.1 Test 3: Shows normal MetaModelView content when project is loaded (even in no-DB mode)', () => {
    it('should render normal content when project is loaded in no-DB mode', () => {
      mockIncludeDatabase = false;
      mockActiveProject = { id: 'proj-123', name: 'Test Project' };

      renderMetaModelView();

      // Should NOT show empty state
      expect(screen.queryByTestId('no-project-empty-state')).not.toBeInTheDocument();

      // Should show normal view elements, including the side panel (the
      // legacy left-side ChatPanel was replaced by UnifiedChatPanel).
      expect(screen.getByTestId('domain-selector')).toBeInTheDocument();
      expect(screen.getByTestId('entity-grid')).toBeInTheDocument();
      expect(screen.getByTestId('unified-chat-panel')).toBeInTheDocument();
    });
  });
});

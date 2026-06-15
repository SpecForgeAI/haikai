/**
 * ProductView Empty-State Tests
 *
 * Spec 2026-01-22: No-Database Mode Empty-State UX
 * Task Group 5: ProductView Empty-State Integration
 *
 * Updated for Spec 2026-01-22 File Mode Blank Start UX: the
 * NoProjectEmptyState gate was REMOVED from ProductView -- the backend now
 * auto-initializes a blank project, so the view renders its normal layout
 * (tab bar + outlet) in every mode.
 *
 * Tests cover:
 * 1. Renders normal content even when includeDatabase=false AND activeProject=null
 * 2. Shows normal ProductView content when `includeDatabase=true`
 * 3. Shows normal ProductView content when project is loaded (even in no-DB mode)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import React from 'react';

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
    loadedFileName: mockActiveProject ? 'TestProject' : null,
  }),
}));

// Mock ImportActionsContext
vi.mock('../contexts/ImportActionsContext', () => ({
  useImportActions: () => ({
    triggerImportJson: vi.fn(),
    triggerImportXlsx: vi.fn(),
  }),
}));

// Mock ProductUiStateContext
vi.mock('../contexts/ProductUiStateContext', () => ({
  ProductUiStateProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useProductUiState: () => ({
    setLastImplementWorkItemId: vi.fn(),
    getLastImplementWorkItemId: () => null,
  }),
  deriveProjectKey: (fileName: string | null) => fileName || 'default',
}));

// Mock child components to simplify testing
vi.mock('../components/ProductView/ProductBacklogPage', () => ({
  ProductBacklogPage: () => <div data-testid="product-backlog-page">Backlog Page</div>,
}));

vi.mock('../components/ProductView/ProductImplementPage', () => ({
  ProductImplementPage: () => <div data-testid="product-implement-page">Implement Page</div>,
}));

vi.mock('../components/ProductView/ProductRoadmapPage', () => ({
  ProductRoadmapPage: () => <div data-testid="product-roadmap-page">Roadmap Page</div>,
  formatTimestamp: () => 'formatted timestamp',
}));

vi.mock('../api/bookOfWorkApi', () => ({
  uploadBookOfWork: vi.fn(),
}));

// Import after mocks
import { ProductView } from '../components/ProductView/ProductView';
import { renderWithRouter } from '../test-utils/renderWithProviders';

describe('ProductView Empty-State', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIncludeDatabase = true;
    mockActiveProject = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Task 5.1 Test 1: Renders normal content when includeDatabase=false AND activeProject=null', () => {
    // Spec 2026-01-22 File Mode Blank Start UX removed the forced empty
    // state: the backend auto-initializes a blank project, so the view
    // renders its normal layout even with no active project in no-DB mode.
    it('should render the normal layout (no empty state) in no-DB mode with no project', () => {
      mockIncludeDatabase = false;
      mockActiveProject = null;

      renderWithRouter(<ProductView />);

      // Empty state must NOT be shown
      expect(screen.queryByTestId('no-project-empty-state')).not.toBeInTheDocument();

      // Normal view elements (tab bar) render directly
      expect(screen.getByTestId('product-tab-bar')).toBeInTheDocument();
      expect(screen.getByTestId('product-view')).toBeInTheDocument();
    });
  });

  describe('Task 5.1 Test 2: Shows normal ProductView content when includeDatabase=true', () => {
    it('should render normal content when in DB mode (even without project)', () => {
      mockIncludeDatabase = true;
      mockActiveProject = null;

      renderWithRouter(<ProductView />);

      // Should NOT show empty state
      expect(screen.queryByTestId('no-project-empty-state')).not.toBeInTheDocument();

      // Should show normal view elements (tab bar)
      expect(screen.getByTestId('product-tab-bar')).toBeInTheDocument();
      expect(screen.getByTestId('product-view')).toBeInTheDocument();
    });
  });

  describe('Task 5.1 Test 3: Shows normal ProductView content when project is loaded (even in no-DB mode)', () => {
    it('should render normal content when project is loaded in no-DB mode', () => {
      mockIncludeDatabase = false;
      mockActiveProject = { id: 'proj-123', name: 'Test Project' };

      renderWithRouter(<ProductView />);

      // Should NOT show empty state
      expect(screen.queryByTestId('no-project-empty-state')).not.toBeInTheDocument();

      // Should show normal view elements (tab bar)
      expect(screen.getByTestId('product-tab-bar')).toBeInTheDocument();
      expect(screen.getByTestId('product-view')).toBeInTheDocument();
    });
  });
});

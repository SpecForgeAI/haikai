/**
 * TopBar File Mode Indicator Tests
 *
 * Spec 2026-01-22: No-Database Mode Empty-State UX
 * Task Group 2: TopBar File Mode Indicator
 *
 * Tests cover:
 * 1. "File Mode" indicator renders when `includeDatabase=false`
 * 2. "File Mode" indicator does NOT render when `includeDatabase=true`
 * 3. Indicator has correct tooltip text
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import React from 'react';

// Track mock values for dynamic control
let mockIncludeDatabase = true;
let mockIncludeDelivery = true;

// Mock AppConfigContext hooks
vi.mock('../contexts/AppConfigContext', () => ({
  useIncludeDelivery: () => mockIncludeDelivery,
  useIncludeDatabase: () => mockIncludeDatabase,
}));

// Mock ArchitectureContext
vi.mock('../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitecture: () => ({
    loadedFileName: null,
    currentView: 'metamodel',
    model: {
      metaModel: {
        entities: {},
        relationships: {},
      },
    },
  }),
  useArchitectureDispatch: () => vi.fn(),
}));

// Mock ProjectContext
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => null,
  useRefreshActiveProject: () => vi.fn(),
  useClearActiveProject: () => vi.fn(),
  useSetActiveProject: () => vi.fn(),
}));

// Mock child components to simplify testing
vi.mock('../components/TopBar/FileMenu', () => ({
  FileMenu: () => null,
}));

vi.mock('../components/Project/CreateProjectModal', () => ({
  CreateProjectModal: () => null,
}));

vi.mock('../components/Project/ImportProjectSnapshotModal', () => ({
  ImportProjectSnapshotModal: () => null,
}));

vi.mock('../components/Project/DeleteProjectModal', () => ({
  DeleteProjectModal: () => null,
}));

vi.mock('../components/Import/ImportModeModal', () => ({
  ImportModeModal: () => null,
}));

vi.mock('../components/Export/ExportProjectNameModal', () => ({
  ExportProjectNameModal: () => null,
}));

vi.mock('../components/file/ModelFileDialog', () => ({
  ModelFileDialog: () => null,
}));

vi.mock('../components/common/Modal', () => ({
  ErrorModal: () => null,
}));

vi.mock('../components/common/ImportSummaryModal', () => ({
  ImportSummaryModal: () => null,
}));

// Import after mocks
import { TopBar } from '../components/TopBar/TopBar';
import { renderWithRouter } from '../test-utils/renderWithProviders';

describe('TopBar File Mode Indicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIncludeDatabase = true;
    mockIncludeDelivery = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Task 2.1 Test 1: "File Mode" indicator renders when includeDatabase=false', () => {
    it('should render File Mode indicator when includeDatabase is false', () => {
      mockIncludeDatabase = false;

      renderWithRouter(<TopBar />);

      const indicator = screen.getByTestId('file-mode-indicator');
      expect(indicator).toBeInTheDocument();
      expect(indicator).toHaveTextContent('File Mode');
    });
  });

  describe('Task 2.1 Test 2: "File Mode" indicator does NOT render when includeDatabase=true', () => {
    it('should NOT render File Mode indicator when includeDatabase is true', () => {
      mockIncludeDatabase = true;

      renderWithRouter(<TopBar />);

      expect(screen.queryByTestId('file-mode-indicator')).not.toBeInTheDocument();
    });
  });

  describe('Task 2.1 Test 3: Indicator has correct tooltip text', () => {
    it('should have correct tooltip explaining the mode', () => {
      mockIncludeDatabase = false;

      renderWithRouter(<TopBar />);

      const indicator = screen.getByTestId('file-mode-indicator');
      expect(indicator).toHaveAttribute(
        'title',
        'Database features are disabled. Use Import/Export for file-based workflows.'
      );
    });
  });
});

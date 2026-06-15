/**
 * ProductRoadmapPage Panel Integration Tests
 *
 * Spec 2026-03-01: Increment 9 -- Side Panel v2: Product and Roadmap Screens
 * Task Group 3, Task 3.1: Write 2 focused tests for ProductRoadmapPage panel integration
 *
 * Tests verify:
 * 5. ProductRoadmapPage renders UnifiedChatPanel and does NOT render RoadmapPmChatPanel
 * 6. UnifiedChatPanel receives correct PanelThreadKey { type: 'panel', projectId, screen: 'roadmap' }
 *    and allowedPersonaIds: ['product-manager']
 *
 * Follows the exact pattern from MetaModelView.panel.test.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';

// ============================================================================
// Mocks: must be declared before imports that use them
// ============================================================================

// Mock useChatThread hook (used by UnifiedChatPanel)
vi.mock('../../../hooks/useChatThread', () => ({
  useChatThread: vi.fn(() => ({
    messages: [],
    activePersonaId: 'product-manager',
    activeTaskId: 'unknown',
    isLoading: false,
    isGenerating: false,
    isSaving: false,
    artifactPreview: null,
    sealedTaskIds: [],
    error: null,
    sendMessage: vi.fn(),
    selectPersona: vi.fn(),
    selectTask: vi.fn(),
    startTask: vi.fn(),
    confirmArtifact: vi.fn(),
    rejectArtifact: vi.fn(),
  })),
  TASK_ARTIFACT_MAP: {},
}));

// Mock chatV2Api functions to prevent actual network calls
vi.mock('../../../api/chatV2Api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/chatV2Api')>();
  return {
    ...actual,
    getThreadHistory: vi.fn().mockResolvedValue({
      threadKey: 'project:test-rm-1:panel:roadmap',
      projectId: 'test-rm-1',
      messages: [],
      activePersonaId: null,
      activeTaskId: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    }),
    postChatV2: vi.fn().mockResolvedValue({
      threadKey: 'project:test-rm-1:panel:roadmap',
      personaId: 'product-manager',
      taskId: 'unknown',
      assistant: { message: 'Response' },
      structuredResponse: null,
    }),
  };
});

// Mock file upload utils (imported by ChatInputBar)
vi.mock('../../../utils/fileUploadUtils', () => ({
  validateFiles: vi.fn().mockReturnValue({ valid: true }),
  readFilesAsBase64: vi.fn().mockResolvedValue([]),
  ACCEPTED_MIME_TYPES: '.txt,.pdf,.json',
  MAX_FILES: 5,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
}));

// Mock ProjectContext (used by ProductRoadmapPage to get activeProject)
vi.mock('../../../contexts/ProjectContext', () => ({
  useProject: vi.fn(),
  useProjectLoading: vi.fn(() => false),
  useSetActiveProject: () => vi.fn(),
}));

// Mock ArchitectureContext (used by ProductRoadmapPage and UnifiedChatPanel)
vi.mock('../../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitecture: vi.fn(() => ({
    loadedFileName: 'test-project.json',
    currentView: 'dashboard',
  })),
  useArchitectureDispatch: vi.fn(() => vi.fn()),
  // Expanded UnifiedChatPanel reads the architectures list from the context.
  useArchitectureContext: vi.fn(() => ({
    architectures: [
      { id: 'arch-1', name: 'Architecture 1', archived: false, createdAt: '2026-01-01T00:00:00Z' },
    ],
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

// Mock ProductUiStateContext (used by ProductRoadmapPage for expansion state)
vi.mock('../../../contexts/ProductUiStateContext', () => ({
  useProductExpansion: vi.fn(() => ({
    expandedIds: new Set(),
    setExpandedIds: vi.fn(),
    toggleExpanded: vi.fn(),
  })),
  deriveProjectKey: (id: string) => id,
}));

// Mock workItemsApi
vi.mock('../../../api/workItemsApi', () => ({
  fetchWorkItems: vi.fn().mockResolvedValue([]),
}));

// Mock roadmapApi
vi.mock('../../../api/roadmapApi', () => ({
  importRoadmap: vi.fn().mockResolvedValue({}),
  fetchLatestArtifactMetadata: vi.fn().mockResolvedValue(null),
}));

// Mock workItemTreeBuilder
vi.mock('../../../utils/workItemTreeBuilder', () => ({
  buildWorkItemTree: vi.fn().mockReturnValue({ roots: [], orphans: [] }),
}));

// Mock WorkItemTree to simplify rendering
vi.mock('../WorkItemTree', () => ({
  WorkItemTree: () => <div data-testid="work-item-tree">WorkItemTree</div>,
}));

// Mock ResizableSplitPane to simplify rendering
vi.mock('../../shared/ResizableSplitPane', () => ({
  ResizableSplitPane: ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => (
    <div data-testid="resizable-split-pane">
      <div data-testid="split-left">{left}</div>
      <div data-testid="split-right">{right}</div>
    </div>
  ),
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { ProductRoadmapPage } from '../ProductRoadmapPage';
import { useProject } from '../../../contexts/ProjectContext';
import { useChatThread } from '../../../hooks/useChatThread';
import { renderWithRouter } from '../../../test-utils/renderWithProviders';

// ============================================================================
// Test Helpers
// ============================================================================

const mockProject = {
  id: 'proj-rm-1',
  name: 'Roadmap Test Project',
  projectParentFolder: '/test',
  projectHierarchy: null,
  organisationId: null,
  isActive: true,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
};

const defaultProps = {
  onNavigateToBacklog: vi.fn(),
  onControlStateChange: vi.fn(),
};

// ============================================================================
// Tests
// ============================================================================

describe('ProductRoadmapPage Panel Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // --------------------------------------------------------------------------
  // Test 5: ProductRoadmapPage renders UnifiedChatPanel and does NOT render
  //          RoadmapPmChatPanel
  // --------------------------------------------------------------------------

  it('renders UnifiedChatPanel and does NOT render RoadmapPmChatPanel', () => {
    vi.mocked(useProject).mockReturnValue(mockProject);

    renderWithRouter(<ProductRoadmapPage {...defaultProps} />);

    // UnifiedChatPanel mounts collapsed by default; expanding it via the
    // collapsed tab reveals the full panel.
    const collapsedTab = screen.getByTestId('unified-chat-panel-collapsed');
    expect(collapsedTab).toBeInTheDocument();
    fireEvent.click(collapsedTab);
    expect(screen.getByTestId('unified-chat-panel')).toBeInTheDocument();

    // Legacy RoadmapPmChatPanel should NOT be present
    expect(screen.queryByTestId('rm-chat-container')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 6: UnifiedChatPanel receives correct PanelThreadKey and allowedPersonaIds
  // --------------------------------------------------------------------------

  it('UnifiedChatPanel receives correct PanelThreadKey { type: panel, projectId, screen: roadmap } and allowedPersonaIds: [product-manager]', () => {
    vi.mocked(useProject).mockReturnValue(mockProject);

    renderWithRouter(<ProductRoadmapPage {...defaultProps} />);

    // Verify useChatThread was called with the correct PanelThreadKey
    expect(useChatThread).toHaveBeenCalledWith(
      { type: 'panel', projectId: 'proj-rm-1', screen: 'roadmap' },
      expect.objectContaining({
        initialPersonaId: 'product-manager',
        allowedPersonaIds: ['product-manager'],
      }),
    );
  });
});

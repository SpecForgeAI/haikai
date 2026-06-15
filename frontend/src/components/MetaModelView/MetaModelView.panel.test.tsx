/**
 * MetaModelView Panel Integration Tests
 *
 * Spec 2026-03-01: Side Panel v1 on Architecture/MetaModel Screen (Increment 8)
 * Task Group 3, Task 3.1: Write 4 focused tests for MetaModelView panel integration
 *
 * Updated 2026-06-12: the legacy OAS ChatPanel was removed from
 * MetaModelView (UnifiedChatPanel is the only panel), and the view is now a
 * route layout reading the `:domain` URL token (Spec 2026-05-04), so it is
 * mounted at the architecture-scoped metamodel URL in these tests.
 *
 * Tests verify:
 * 1. MetaModelView renders UnifiedChatPanel (legacy ChatPanel is gone)
 * 2. UnifiedChatPanel receives the correct PanelThreadKey { type: 'panel', projectId, screen: 'metamodel' }
 * 3. UnifiedChatPanel receives allowedPersonaIds: ['architect', 'ux-designer', 'test-engineer']
 * 4. PanelThreadKey serializes to project:{projectId}:panel:metamodel
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';

// ============================================================================
// Mocks: must be declared before imports that use them
// ============================================================================

// Mock useChatThread hook (used by UnifiedChatPanel)
vi.mock('../../hooks/useChatThread', () => ({
  useChatThread: vi.fn(() => ({
    messages: [],
    activePersonaId: 'architect',
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
vi.mock('../../api/chatV2Api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/chatV2Api')>();
  return {
    ...actual,
    getThreadHistory: vi.fn().mockResolvedValue({
      threadKey: 'project:test-123:panel:metamodel',
      projectId: 'test-123',
      messages: [],
      activePersonaId: null,
      activeTaskId: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    }),
    postChatV2: vi.fn().mockResolvedValue({
      threadKey: 'project:test-123:panel:metamodel',
      personaId: 'architect',
      taskId: 'unknown',
      assistant: { message: 'Response' },
      structuredResponse: null,
    }),
  };
});

// Mock file upload utils (imported by ChatInputBar)
vi.mock('../../utils/fileUploadUtils', () => ({
  validateFiles: vi.fn().mockReturnValue({ valid: true }),
  readFilesAsBase64: vi.fn().mockResolvedValue([]),
  ACCEPTED_MIME_TYPES: '.txt,.pdf,.json',
  MAX_FILES: 5,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
}));

// Mock ArchitectureContext (used by MetaModelView for state and dispatch)
vi.mock('../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitecture: vi.fn(() => ({
    selectedTab: 'Services',
    selectedDomain: 'Application',
    currentView: 'metamodel',
  })),
  useArchitectureDispatch: vi.fn(() => vi.fn()),
  // The expanded UnifiedChatPanel reads the architectures list.
  useArchitectureContext: vi.fn(() => ({
    architectures: [
      { id: 'arch-1', name: 'Architecture 1', archived: false, createdAt: '2026-01-01T00:00:00Z' },
    ],
  })),
}));

// Mock ProjectContext (used by MetaModelView to get activeProject)
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: vi.fn(),
  useSetActiveProject: () => vi.fn(),
}));

// Mock UserJourneyReviewContext (useActivateJourneyReview used in UnifiedChatPanel)
vi.mock('../../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// Mock TemporaryDiagramContext (useActivateTemporaryDiagram used in UnifiedChatPanel)
vi.mock('../../contexts/TemporaryDiagramContext', () => ({
  useActivateTemporaryDiagram: vi.fn(() => vi.fn()),
}));

// Mock Grid and RelationshipGrid to simplify rendering
vi.mock('../Grid/Grid', () => ({
  Grid: () => <div data-testid="grid">Grid</div>,
}));

vi.mock('../Grid/RelationshipGrid', () => ({
  RelationshipGrid: () => <div data-testid="relationship-grid">RelationshipGrid</div>,
}));

// Mock DomainSelector
vi.mock('./DomainSelector', () => ({
  DomainSelector: () => <div data-testid="domain-selector">DomainSelector</div>,
}));

// Mock PackageSetsView
vi.mock('./PackageSetsView', () => ({
  PackageSetsView: () => <div data-testid="package-sets-view">PackageSetsView</div>,
}));

// Mock config imports used by MetaModelView
vi.mock('../../config/gridConfigs', () => ({
  tabToEntityType: { Services: 'Service', Applications: 'Application' },
  relationshipTabToType: {},
  domainGroupings: { Application: ['Services', 'Applications'] },
}));

vi.mock('../../config/relationshipDefinitions', () => ({
  getOrderedRelationshipDisplayNamesForDomain: vi.fn(() => []),
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { MetaModelView } from './MetaModelView';
import { useProject } from '../../contexts/ProjectContext';
import { threadKeyToString } from '../../api/chatV2Api';
import type { PanelThreadKey } from '../../api/chatV2Api';
import { useChatThread } from '../../hooks/useChatThread';
import { renderWithRouter } from '../../test-utils/renderWithProviders';

// ============================================================================
// Test Helpers
// ============================================================================

const mockProject = {
  id: 'proj-meta-1',
  name: 'MetaModel Test Project',
  projectParentFolder: '/test',
  projectHierarchy: null,
  organisationId: null,
  isActive: true,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
};

/**
 * Spec 2026-05-04: MetaModelView reads the `:domain` URL token, so it must
 * be mounted at the architecture-scoped metamodel URL.
 */
function renderMetaModelViewAtRoute() {
  return renderWithRouter(
    <Routes>
      <Route
        path="/projects/:projectId/architectures/:architectureId/metamodel/:domain"
        element={<MetaModelView />}
      />
    </Routes>,
    { initialEntries: ['/projects/proj-meta-1/architectures/arch-1/metamodel/application'] }
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('MetaModelView Panel Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // --------------------------------------------------------------------------
  // Test 1: MetaModelView renders both ChatPanel (legacy) and UnifiedChatPanel
  // --------------------------------------------------------------------------

  it('renders UnifiedChatPanel when activeProject is available (legacy ChatPanel removed)', () => {
    vi.mocked(useProject).mockReturnValue(mockProject);

    renderMetaModelViewAtRoute();

    // The legacy OAS ChatPanel was removed from MetaModelView entirely.
    expect(screen.queryByTestId('legacy-chat-panel')).not.toBeInTheDocument();

    // UnifiedChatPanel mounts collapsed by default; expanding via the
    // collapsed tab reveals the full panel.
    const collapsedTab = screen.getByTestId('unified-chat-panel-collapsed');
    expect(collapsedTab).toBeInTheDocument();
    fireEvent.click(collapsedTab);
    expect(screen.getByTestId('unified-chat-panel')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 2: UnifiedChatPanel receives correct PanelThreadKey
  // --------------------------------------------------------------------------

  it('UnifiedChatPanel receives correct PanelThreadKey { type: panel, projectId, screen: metamodel }', () => {
    vi.mocked(useProject).mockReturnValue(mockProject);

    renderMetaModelViewAtRoute();

    // Verify useChatThread was called with the correct PanelThreadKey
    expect(useChatThread).toHaveBeenCalledWith(
      { type: 'panel', projectId: 'proj-meta-1', screen: 'metamodel' },
      expect.objectContaining({
        initialPersonaId: 'architect',
        allowedPersonaIds: ['architect', 'ux-designer', 'test-engineer'],
      }),
    );
  });

  // --------------------------------------------------------------------------
  // Test 3: UnifiedChatPanel receives allowedPersonaIds
  // --------------------------------------------------------------------------

  it('UnifiedChatPanel receives allowedPersonaIds: [architect, ux-designer, test-engineer]', () => {
    vi.mocked(useProject).mockReturnValue(mockProject);

    renderMetaModelViewAtRoute();

    // Verify useChatThread was called with the correct allowedPersonaIds
    expect(useChatThread).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        allowedPersonaIds: ['architect', 'ux-designer', 'test-engineer'],
      }),
    );
  });

  // --------------------------------------------------------------------------
  // Test 4: PanelThreadKey serializes to project:{projectId}:panel:metamodel
  // --------------------------------------------------------------------------

  it('PanelThreadKey serializes to project:{projectId}:panel:metamodel', () => {
    const panelKey: PanelThreadKey = {
      type: 'panel',
      projectId: 'proj-meta-1',
      screen: 'metamodel',
    };

    const serialized = threadKeyToString(panelKey);
    expect(serialized).toBe('project:proj-meta-1:panel:metamodel');
  });
});

/**
 * ProductPage Panel Integration Tests
 *
 * Spec 2026-03-01: Increment 9 -- Side Panel v2: Product and Roadmap Screens
 * Task Group 3, Task 3.1: Write 4 focused tests for ProductPage panel integration
 *
 * Tests verify:
 * 1. ProductPage renders UnifiedChatPanel when activeProject is available
 * 2. ProductPage does NOT render ProductManagerChatPanel or SolutionArchitectChatPanel
 * 3. UnifiedChatPanel receives correct PanelThreadKey { type: 'panel', projectId, screen: 'product' }
 *    and allowedPersonaIds: ['product-manager']
 * 4. PanelThreadKey for product screen serializes to project:{projectId}:panel:product
 *
 * Follows the exact pattern from MetaModelView.panel.test.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';

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
      threadKey: 'project:test-prod-1:panel:product',
      projectId: 'test-prod-1',
      messages: [],
      activePersonaId: null,
      activeTaskId: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    }),
    postChatV2: vi.fn().mockResolvedValue({
      threadKey: 'project:test-prod-1:panel:product',
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

// Mock ProjectContext (used by ProductPage to get activeProject)
vi.mock('../../../contexts/ProjectContext', () => ({
  useProject: vi.fn(),
  useSetActiveProject: () => vi.fn(),
}));

// Mock ArchitectureContext (required by UnifiedChatPanel)
vi.mock('../../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitecture: vi.fn(() => ({ currentView: 'dashboard' })),
  useArchitectureDispatch: () => vi.fn(),
}));

// Mock UserJourneyReviewContext (useActivateJourneyReview used in UnifiedChatPanel)
vi.mock('../../../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// Mock TemporaryDiagramContext (useActivateTemporaryDiagram used in UnifiedChatPanel)
vi.mock('../../../contexts/TemporaryDiagramContext', () => ({
  useActivateTemporaryDiagram: vi.fn(() => vi.fn()),
}));

// Mock dashboardApi to prevent actual network calls
vi.mock('../../../api/dashboardApi', () => ({
  getDashboardSummary: vi.fn().mockResolvedValue({
    header: { projectName: 'Test', generatedAt: '2026-03-01T00:00:00.000Z', initiativesCount: 2, epicsCount: 5, activeEpicsCount: 3, storiesInProgressCount: 0, lastUpdatedLabel: 'just now', mode: 'GREENFIELD', headerInsight: null },
    strategicFoundation: {
      productDefinition: { missionExists: { label: 'Mission', value: 1 }, lastUpdatedLabel: { label: 'Updated', value: 0 } },
      highLevelArchitecture: { overall: { label: 'Overall', value: 0 }, applications: { label: 'Apps', value: 0 }, services: { label: 'Services', value: 0 }, interfaces: { label: 'Interfaces', value: 0 }, dataStores: { label: 'Data Stores', value: 0 } },
      roadmap: { initiativesCount: { label: 'Initiatives', value: 2 }, epics: { label: 'Epics', value: 5 }, completed: { label: 'Completed', value: 0 } },
      standards: { orgTechStack: { label: 'Org Tech Stack', value: 0 }, productTechStack: { label: 'Product Tech Stack', value: 0 } },
      testStrategy: { exists: { label: 'Exists', value: true }, lastUpdated: { label: 'Last Updated', value: '08/03/2026' } },
      summaryInsight: { enabled: false, message: null },
    },
    scope: { type: 'NEXT_5_EPICS', label: 'Next 5 Epics', scopeValue: null },
    detailedDefinitionAndDelivery: {
      preCoding: { backlog: { epicsInScope: { label: 'Epics', value: 0 }, featuresCount: { label: 'Features', value: 0 }, storiesCount: { label: 'Stories', value: 0 }, storiesWithAcceptanceCriteriaCount: { label: 'AC', value: 0 } }, detailedArchitecture: { overall: { label: 'Overall', value: 0 }, processActivities: { label: 'PA', value: 0 }, interfaceEndpoints: { label: 'IE', value: 0 }, logicalDataEntities: { label: 'LDE', value: 0 }, physicalDataEntities: { label: 'PDE', value: 0 } }, testingSuite: { endToEndTestCount: { label: 'E2E', value: 0 }, functionalTestCount: { label: 'Functional', value: 0 } } },
      postCoding: { implementation: { featuresInProgress: { label: 'Features in Progress', value: 0 }, storiesInProgress: { label: 'Stories in Progress', value: 0 }, storiesComplete: { label: 'Stories Complete', value: 0 } }, verification: { storiesVerifiedCount: { label: 'Verified', value: 0 }, pendingReviewCount: { label: 'Pending', value: 0 } }, summaryInsight: { enabled: false, message: null } },
    },
  }),
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { ProductPage } from '../ProductPage';
import { useProject } from '../../../contexts/ProjectContext';
import { threadKeyToString } from '../../../api/chatV2Api';
import type { PanelThreadKey } from '../../../api/chatV2Api';
import { useChatThread } from '../../../hooks/useChatThread';
import { renderWithRouter } from '../../../test-utils/renderWithProviders';

// ============================================================================
// Test Helpers
// ============================================================================

const mockProject = {
  id: 'proj-prod-1',
  name: 'Product Test Project',
  projectParentFolder: '/test',
  projectHierarchy: null,
  organisationId: null,
  isActive: true,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
};

// ============================================================================
// Tests
// ============================================================================

describe('ProductPage Panel Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // --------------------------------------------------------------------------
  // Test 1: ProductPage renders UnifiedChatPanel when activeProject is available
  // --------------------------------------------------------------------------

  it('renders UnifiedChatPanel when activeProject is available', () => {
    vi.mocked(useProject).mockReturnValue(mockProject);

    renderWithRouter(<ProductPage />);

    // UnifiedChatPanel should be present (collapsed state by default for overlay layout)
    expect(screen.getByTestId('unified-chat-panel-collapsed')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 2: ProductPage does NOT render legacy chat panels
  // --------------------------------------------------------------------------

  it('does NOT render ProductManagerChatPanel or SolutionArchitectChatPanel', () => {
    vi.mocked(useProject).mockReturnValue(mockProject);

    renderWithRouter(<ProductPage />);

    // Legacy chat panels should NOT be present
    expect(screen.queryByTestId('pm-chat-container')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sa-chat-container')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 3: UnifiedChatPanel receives correct PanelThreadKey and allowedPersonaIds
  // --------------------------------------------------------------------------

  it('UnifiedChatPanel receives correct PanelThreadKey { type: panel, projectId, screen: product } and allowedPersonaIds: [product-manager]', () => {
    vi.mocked(useProject).mockReturnValue(mockProject);

    renderWithRouter(<ProductPage />);

    // Verify useChatThread was called with the correct PanelThreadKey
    expect(useChatThread).toHaveBeenCalledWith(
      { type: 'panel', projectId: 'proj-prod-1', screen: 'product' },
      expect.objectContaining({
        initialPersonaId: 'product-manager',
        allowedPersonaIds: ['product-manager'],
      }),
    );
  });

  // --------------------------------------------------------------------------
  // Test 4: PanelThreadKey serializes to project:{projectId}:panel:product
  // --------------------------------------------------------------------------

  it('PanelThreadKey for product screen serializes to project:{projectId}:panel:product', () => {
    const panelKey: PanelThreadKey = {
      type: 'panel',
      projectId: 'proj-prod-1',
      screen: 'product',
    };

    const serialized = threadKeyToString(panelKey);
    expect(serialized).toBe('project:proj-prod-1:panel:product');
  });
});

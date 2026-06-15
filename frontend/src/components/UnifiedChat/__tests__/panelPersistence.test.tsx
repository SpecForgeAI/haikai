/**
 * Panel State Persistence Tests
 *
 * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities
 * Task Group 3, Task 3.1: Write 5 focused tests for panel state persistence
 *
 * Tests verify:
 * 1. Panel initializes collapsed when `defaultOpen` is absent and no persisted state
 * 2. Panel initializes expanded when `defaultOpen={true}` and no persisted state
 * 3. Panel uses persisted collapse state from localStorage when available (overrides `defaultOpen`)
 * 4. Panel persists collapse state to localStorage keyed by threadKey on toggle
 * 5. Panel persists width to localStorage keyed by threadKey (not shared key)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';

// ============================================================================
// Mocks: must be declared before imports that use them
// ============================================================================

// Mock useChatThread hook
const mockSendMessage = vi.fn();
const mockSelectPersona = vi.fn();
const mockSelectTask = vi.fn();

vi.mock('../../../hooks/useChatThread', () => ({
  useChatThread: vi.fn(() => ({
    messages: [],
    activePersonaId: 'assistant',
    activeTaskId: 'unknown',
    isLoading: false,
    isGenerating: false,
    isSaving: false,
    artifactPreview: null,
    sealedTaskIds: [],
    error: null,
    sendMessage: mockSendMessage,
    selectPersona: mockSelectPersona,
    selectTask: mockSelectTask,
    startTask: vi.fn(),
    confirmArtifact: vi.fn(),
    rejectArtifact: vi.fn(),
  })),
  TASK_ARTIFACT_MAP: {},
}));

// Mock chatV2Api functions -- keep threadKeyToString as the real implementation
vi.mock('../../../api/chatV2Api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/chatV2Api')>();
  return {
    ...actual,
    getThreadHistory: vi.fn().mockResolvedValue({
      threadKey: 'project:test-123:hub',
      projectId: 'test-123',
      messages: [],
      activePersonaId: null,
      activeTaskId: null,
      createdAt: '2026-03-03T00:00:00.000Z',
      updatedAt: '2026-03-03T00:00:00.000Z',
    }),
    postChatV2: vi.fn().mockResolvedValue({
      threadKey: 'project:test-123:hub',
      personaId: 'assistant',
      taskId: 'unknown',
      assistant: { message: 'Response' },
      structuredResponse: null,
    }),
  };
});

// Mock ArchitectureContext (useArchitecture and useArchitectureDispatch used in UnifiedChatPanel)
vi.mock('../../../contexts/ArchitectureContext', () => ({
  useArchitecture: vi.fn(() => ({ currentView: 'dashboard' })),
  useArchitectureDispatch: vi.fn(() => vi.fn()),
  // Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG11:
  //   Group 7 added useActiveArchitectureId() to useChatThread + UnifiedChatPanel.
  //   Group 9/10 added useArchitectureContext() to the invalidation banner +
  //   picker. The pre-existing mock above only stubbed useArchitecture +
  //   useArchitectureDispatch, so the unmocked exports threw 'must be used
  //   within an ArchitectureProvider'. Add the two missing stubs to keep
  //   these pre-existing tests green without touching their assertions.
  useActiveArchitectureId: vi.fn(() => null),
  useArchitectureContext: vi.fn(() => ({
    architectures: [],
    setActiveArchitecture: vi.fn(),
  })),
}));

// Mock PendingActionContext (usePendingAction used in UnifiedChatPanel)
vi.mock('../../../contexts/PendingActionContext', () => ({
  usePendingAction: vi.fn(() => ({
    pendingAction: null,
    setPendingAction: vi.fn(),
    clearPendingAction: vi.fn(),
  })),
}));

// Mock ModalActionContext (useModalActions used in UnifiedChatPanel)
vi.mock('../../../contexts/ModalActionContext', () => ({
  useModalActions: vi.fn(() => ({
    openGenerateStandardsModal: vi.fn(),
  })),
}));

// Mock UserJourneyReviewContext (useActivateJourneyReview used in UnifiedChatPanel)
vi.mock('../../../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// Mock ProjectContext (useProject used in UnifiedChatPanel)
vi.mock('../../../contexts/ProjectContext', () => ({
  useProject: vi.fn(() => null),
  useSetActiveProject: () => vi.fn(),
}));

// Mock TemporaryDiagramContext (useActivateTemporaryDiagram used in UnifiedChatPanel)
vi.mock('../../../contexts/TemporaryDiagramContext', () => ({
  useActivateTemporaryDiagram: vi.fn(() => vi.fn()),
}));

// Mock file upload utils (imported by ChatInputBar)
vi.mock('../../../utils/fileUploadUtils', () => ({
  validateFiles: vi.fn().mockReturnValue({ valid: true }),
  readFilesAsBase64: vi.fn().mockResolvedValue([]),
  ACCEPTED_MIME_TYPES: '.txt,.pdf,.json',
  MAX_FILES: 5,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { UnifiedChatPanel } from '../UnifiedChatPanel';
import type { ThreadKey } from '../../../api/chatV2Api';
import { renderWithRouter } from '../../../test-utils/renderWithProviders';

// ============================================================================
// Test Helpers
// ============================================================================

const hubThreadKey: ThreadKey = { type: 'hub', projectId: 'test-proj-1' };
const panelThreadKey: ThreadKey = { type: 'panel', projectId: 'test-proj-1', screen: 'metamodel' };

// ============================================================================
// Tests
// ============================================================================

describe('UnifiedChatPanel - Panel State Persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // --------------------------------------------------------------------------
  // Test 1: Panel initializes collapsed when `defaultOpen` is absent and no persisted state
  // --------------------------------------------------------------------------

  it('initializes collapsed when defaultOpen is absent and no persisted state', () => {
    renderWithRouter(
      <UnifiedChatPanel
        threadKey={hubThreadKey}
        initialPersonaId="assistant"
      />
    );

    // Panel should be in collapsed state (no defaultOpen, no persisted state)
    expect(screen.getByTestId('unified-chat-panel-collapsed')).toBeInTheDocument();
    expect(screen.queryByTestId('unified-chat-panel')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 2: Panel initializes expanded when `defaultOpen={true}` and no persisted state
  // --------------------------------------------------------------------------

  it('initializes expanded when defaultOpen={true} and no persisted state', () => {
    renderWithRouter(
      <UnifiedChatPanel
        threadKey={hubThreadKey}
        initialPersonaId="assistant"
        defaultOpen={true}
      />
    );

    // Panel should be in expanded state (defaultOpen=true, no persisted state)
    expect(screen.getByTestId('unified-chat-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('unified-chat-panel-collapsed')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 3: Panel uses persisted collapse state from localStorage when available
  //         (overrides `defaultOpen`)
  // --------------------------------------------------------------------------

  it('uses persisted collapse state from localStorage, overriding defaultOpen', () => {
    // Pre-set persisted state: collapsed = true for this hub threadKey
    localStorage.setItem('unified-chat-collapsed:project:test-proj-1:hub', 'true');

    renderWithRouter(
      <UnifiedChatPanel
        threadKey={hubThreadKey}
        initialPersonaId="assistant"
        defaultOpen={true}
      />
    );

    // Panel should be collapsed because persisted state overrides defaultOpen={true}
    expect(screen.getByTestId('unified-chat-panel-collapsed')).toBeInTheDocument();
    expect(screen.queryByTestId('unified-chat-panel')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 4: Panel persists collapse state to localStorage keyed by threadKey on toggle
  // --------------------------------------------------------------------------

  it('persists collapse state to localStorage keyed by threadKey on toggle', () => {
    const storageKey = 'unified-chat-collapsed:project:test-proj-1:panel:metamodel';

    // Render with defaultOpen so it starts expanded
    renderWithRouter(
      <UnifiedChatPanel
        threadKey={panelThreadKey}
        initialPersonaId="assistant"
        defaultOpen={true}
      />
    );

    // Verify panel starts expanded
    expect(screen.getByTestId('unified-chat-panel')).toBeInTheDocument();

    // Click collapse button to toggle to collapsed
    fireEvent.click(screen.getByTestId('unified-chat-collapse-button'));

    // Verify localStorage was updated with the per-threadKey key
    expect(localStorage.getItem(storageKey)).toBe('true');

    // Now click the collapsed tab to toggle back to expanded
    fireEvent.click(screen.getByTestId('unified-chat-panel-collapsed'));

    // Verify localStorage reflects expanded state (collapsed = false)
    expect(localStorage.getItem(storageKey)).toBe('false');
  });

  // --------------------------------------------------------------------------
  // Test 5: Panel persists width to localStorage keyed by threadKey (not shared key)
  // --------------------------------------------------------------------------

  it('persists width to localStorage keyed by threadKey, not shared key', () => {
    const perThreadWidthKey = 'unified-chat-width:project:test-proj-1:panel:metamodel';
    const oldSharedKey = 'unified-chat-panel-width';

    renderWithRouter(
      <UnifiedChatPanel
        threadKey={panelThreadKey}
        initialPersonaId="assistant"
        defaultOpen={true}
      />
    );

    const resizeHandle = screen.getByTestId('unified-chat-resize-handle');

    // Simulate mousedown on the resize handle
    fireEvent.mouseDown(resizeHandle);

    // Simulate mousemove to resize (window.innerWidth defaults to 1024 in jsdom)
    // Move mouse to x=544, so new width = 1024 - 544 = 480
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 544, bubbles: true })
      );
    });

    // Simulate mouseup to finish resize
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    // Width should be stored under the per-threadKey key
    expect(localStorage.getItem(perThreadWidthKey)).toBe('480');

    // Old shared key should NOT be used
    expect(localStorage.getItem(oldSharedKey)).toBeNull();
  });
});

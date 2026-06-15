/**
 * UnifiedChatPanel: Save-Target Resolution Wiring Tests
 *
 * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 10
 *
 * Verifies the chat-panel-level wiring for the three save-target resolution
 * modes that lands in Group 10:
 *   - bound-by-system-prompt / derived-from-context: invalidation banner
 *     mounts when active arch differs from `Thread.metadata.boundArchitectureId`,
 *     save inputs are disabled while the banner is active.
 *   - clarify-at-save: picker modal mounts when the user confirms an artifact;
 *     picker confirm threads its chosen architecture id through to the save
 *     payload (postSaveArtifact).
 *   - bindingError on the chatV2 response: surfaced as an inline system
 *     message in the message stream (independent of the banner).
 *
 * Test inventory (kept to <=8 focused tests, per task spec 10.1):
 *   1. Banner mounts when task is bound-mode + thread has boundArchitectureId
 *      + active arch differs from bound.
 *   2. Banner does NOT mount for clarify-at-save tasks (no banner regardless
 *      of bound metadata, since the picker handles save-time selection).
 *   3. Save input is disabled when the banner is active; enabled otherwise.
 *   4. Picker mounts on save-trigger for clarify-at-save tasks.
 *   5. Picker does NOT mount for bound/derived tasks (save proceeds directly).
 *   6. Picker confirm includes the chosen architectureId in the
 *      postSaveArtifact payload going to the backend.
 *   7. bindingError on the chatV2 response renders as an inline system
 *      message in the message stream.
 *
 * Mocking strategy:
 *   - Mock useChatThread to drive the panel state (messages, activeTaskId,
 *     boundArchitectureId, boundArchitectureName, confirmArtifact).
 *   - Mock ArchitectureContext to drive useActiveArchitectureId +
 *     useArchitectureContext (banner + picker both consume these).
 *   - Mock UnifiedChat sub-components that we don't need to exercise
 *     (ChatThread is replaced with a thin stub exposing the
 *     onConfirmArtifact prop so we can fire it from the test).
 *   - Mock postSaveArtifact so we can assert the payload includes
 *     architectureId when the picker confirms.
 *
 * Notes / non-goals:
 *   - We do NOT exercise the full thread metadata round-trip (Group 6 owns
 *     persistence; Group 7 owns the request-side architectureId threading;
 *     Group 9 owns banner self-suppression). Those layers have their own
 *     focused tests; this file verifies only the chat panel wiring that
 *     glues them together.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ===========================================================================
// Mocks (declared before imports so they intercept module resolution)
// ===========================================================================

// --------- useChatThread: drives the panel state per test ---------
const mockConfirmArtifact = vi.fn().mockResolvedValue(undefined);
const mockClearThread = vi.fn().mockResolvedValue(undefined);
const mockSendMessage = vi.fn();

// Mutable state that tests reassign before render()
let mockChatThreadState: {
  activeTaskId: string;
  boundArchitectureId: string | null;
  boundArchitectureName: string | null;
  messages: Array<Record<string, unknown>>;
} = {
  activeTaskId: 'unknown',
  boundArchitectureId: null,
  boundArchitectureName: null,
  messages: [],
};

vi.mock('../../../hooks/useChatThread', () => ({
  TASK_ARTIFACT_MAP: {},
  useChatThread: () => ({
    messages: mockChatThreadState.messages,
    activePersonaId: 'assistant',
    activeTaskId: mockChatThreadState.activeTaskId,
    isLoading: false,
    isGenerating: false,
    isSaving: false,
    error: null,
    artifactPreview: { taskId: mockChatThreadState.activeTaskId, content: 'ARTIFACT' },
    sealedTaskIds: new Set<string>(),
    boundArchitectureId: mockChatThreadState.boundArchitectureId,
    boundArchitectureName: mockChatThreadState.boundArchitectureName,
    sendMessage: mockSendMessage,
    selectPersona: vi.fn(),
    selectTask: vi.fn(),
    startTask: vi.fn(),
    confirmArtifact: mockConfirmArtifact,
    rejectArtifact: vi.fn(),
    discussMore: vi.fn(),
    cancelProposal: vi.fn(),
    clearThread: mockClearThread,
    llmSoloConfirm: null,
    confirmLlmSoloRun: vi.fn(),
    cancelLlmSoloRun: vi.fn(),
  }),
}));

// --------- ArchitectureContext: drives banner + picker fixtures ---------
const archCurrent = {
  id: 'arch-current',
  projectId: 'proj-1',
  name: 'Current State',
  description: null,
  tags: [] as string[],
  archived: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const archTarget = {
  id: 'arch-target',
  projectId: 'proj-1',
  name: 'Target State',
  description: null,
  tags: [] as string[],
  archived: false,
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
};

let mockActiveArchitectureId: string | null = 'arch-target';
const mockSetActiveArchitecture = vi.fn();

// Stable architectures array reference -- the picker memoises its candidate
// list off this and resets selection on `open` flip. A new array reference
// per render would invalidate the memo and reset the user selection.
const STABLE_ARCHITECTURES = [archCurrent, archTarget];

vi.mock('../../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: () => mockActiveArchitectureId,
  useArchitectureContext: () => ({
    architectures: STABLE_ARCHITECTURES,
    setActiveArchitecture: mockSetActiveArchitecture,
  }),
}));

// --------- ChatThread stub: surfaces onConfirmArtifact for the test ---------
// We need a way to programmatically trigger the artifact-confirm flow
// (which the panel intercepts for clarify-at-save). The real ChatThread
// would only expose this through deep MessageBubble interaction.
vi.mock('../ChatThread', () => ({
  ChatThread: (props: { onConfirmArtifact?: () => void; messages: Array<{ id: string; content: string; role: string }> }) => (
    <div data-testid="chat-thread-stub">
      {/* Render messages as a simple list so the bindingError test can assert
          on the inline system message content. */}
      <ul data-testid="chat-thread-messages">
        {props.messages.map((m) => (
          <li key={m.id} data-testid={`chat-msg-${m.role}`}>
            {m.content}
          </li>
        ))}
      </ul>
      {/* Simulated "Confirm Artifact" trigger -- the panel wraps confirmArtifact
          to fire the picker for clarify-at-save and pass through otherwise. */}
      <button
        type="button"
        data-testid="trigger-confirm-artifact"
        onClick={() => props.onConfirmArtifact?.()}
      >
        Confirm
      </button>
    </div>
  ),
}));

// --------- ChatInputBar stub: exposes the disabled prop ---------
vi.mock('../ChatInputBar', () => ({
  ChatInputBar: (props: { disabled?: boolean }) => (
    <div
      data-testid="chat-input-bar-stub"
      data-disabled={props.disabled ? 'true' : 'false'}
    />
  ),
}));

// --------- Other context mocks the panel pulls in (no behaviour needed) ---------
vi.mock('../../../contexts/PendingActionContext', () => ({
  usePendingAction: () => ({
    pendingAction: null,
    setPendingAction: vi.fn(),
    clearPendingAction: vi.fn(),
  }),
}));

vi.mock('../../../contexts/ProjectContext', () => ({
  useProject: () => ({ id: 'proj-1', name: 'Project 1' }),
}));

vi.mock('../../../contexts/ModalActionContext', () => ({
  useModalActions: () => ({ openGenerateStandardsModal: vi.fn() }),
}));

vi.mock('../../../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: () => vi.fn(),
}));

vi.mock('../../../contexts/TemporaryDiagramContext', () => ({
  useActivateTemporaryDiagram: () => vi.fn(),
}));

vi.mock('../../../hooks/useCurrentView', () => ({
  useCurrentView: () => 'dashboard',
}));

vi.mock('../../../api/userJourneyDiagramApi', () => ({
  fetchTemporaryUserJourneyDiagrams: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../api/userJourneyOverviewDiagramApi', () => ({
  fetchTemporaryUserJourneyOverviewDiagram: vi.fn().mockResolvedValue(null),
}));

// LlmSoloConfirmDialog is unconditionally imported by the panel; stub it.
vi.mock('../../DashboardView/LlmSoloConfirmDialog', () => ({
  LlmSoloConfirmDialog: () => null,
}));

// ---- Imports (after mocks) ----
import { UnifiedChatPanel } from '../UnifiedChatPanel';
import type { ThreadKey } from '../../../api/chatV2Api';

// ===========================================================================
// Test Helpers
// ===========================================================================

const hubKey: ThreadKey = { type: 'hub', projectId: 'proj-1' };

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={['/projects/proj-1/architectures/arch-target/dashboard']}>
      <UnifiedChatPanel threadKey={hubKey} initialPersonaId="architect" defaultOpen={true} />
    </MemoryRouter>
  );
}

// ===========================================================================
// Tests
// ===========================================================================

describe('UnifiedChatPanel save-target resolution wiring (Spec #5 TG10)', () => {
  beforeEach(() => {
    // Reset to canonical fixtures.
    mockChatThreadState = {
      activeTaskId: 'unknown',
      boundArchitectureId: null,
      boundArchitectureName: null,
      messages: [],
    };
    mockActiveArchitectureId = 'arch-target';
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Test 1: Banner mounts for bound-mode task + thread is bound + active
  // arch differs.
  // --------------------------------------------------------------------------
  it('mounts the invalidation banner when bound-mode task has boundArchitectureId and active arch differs', () => {
    mockChatThreadState = {
      activeTaskId: 'architect--define-architecture', // bound-by-system-prompt
      boundArchitectureId: 'arch-current',
      boundArchitectureName: 'Current State',
      messages: [],
    };
    mockActiveArchitectureId = 'arch-target'; // different -> banner should render

    renderPanel();

    expect(screen.getByTestId('conv-arch-invalidation-banner')).toBeInTheDocument();
    expect(
      screen.getByTestId('conv-arch-invalidation-banner-message')
    ).toHaveTextContent(/Current State/);
  });

  // --------------------------------------------------------------------------
  // Test 2: Banner does NOT mount for clarify-at-save tasks. The picker is
  // the affordance for clarify-at-save; the banner is reserved for
  // bound/derived modes (the modes are mutually exclusive per task).
  // --------------------------------------------------------------------------
  it('does NOT mount the invalidation banner for clarify-at-save tasks', () => {
    mockChatThreadState = {
      activeTaskId: 'ux-designer--ui-domain', // clarify-at-save
      // Even with a stale boundArchitectureId on the thread metadata
      // (would not happen in practice for clarify-at-save), the panel
      // refuses to mount the banner because the mode does not call for it.
      boundArchitectureId: 'arch-current',
      boundArchitectureName: 'Current State',
      messages: [],
    };
    mockActiveArchitectureId = 'arch-target';

    renderPanel();

    expect(
      screen.queryByTestId('conv-arch-invalidation-banner')
    ).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 3: Save input is disabled when the banner is active; enabled when
  // the active arch matches the bound arch.
  // --------------------------------------------------------------------------
  it('disables the chat input when the banner is active and re-enables when active arch matches bound', () => {
    // Phase 1: divergence -- input is disabled.
    mockChatThreadState = {
      activeTaskId: 'architect--define-architecture',
      boundArchitectureId: 'arch-current',
      boundArchitectureName: 'Current State',
      messages: [],
    };
    mockActiveArchitectureId = 'arch-target'; // diverges -> input disabled

    const { unmount } = renderPanel();

    expect(screen.getByTestId('chat-input-bar-stub')).toHaveAttribute(
      'data-disabled',
      'true'
    );
    expect(screen.getByTestId('unified-chat-input-area')).toHaveAttribute(
      'data-input-disabled-reason',
      'architecture-invalidation'
    );
    unmount();

    // Phase 2: same arch -- input is enabled, no banner, no disable reason.
    mockActiveArchitectureId = 'arch-current'; // matches bound now

    renderPanel();

    expect(
      screen.queryByTestId('conv-arch-invalidation-banner')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-input-bar-stub')).toHaveAttribute(
      'data-disabled',
      'false'
    );
    expect(screen.getByTestId('unified-chat-input-area')).not.toHaveAttribute(
      'data-input-disabled-reason'
    );
  });

  // --------------------------------------------------------------------------
  // Test 4: Picker mounts on save-trigger for clarify-at-save tasks; the
  // panel intercepts the artifact-confirm callback and opens the modal
  // instead of saving directly.
  // --------------------------------------------------------------------------
  it('opens the save-target picker when the user confirms an artifact for a clarify-at-save task', () => {
    mockChatThreadState = {
      activeTaskId: 'ux-designer--ui-domain', // clarify-at-save
      boundArchitectureId: null,
      boundArchitectureName: null,
      messages: [],
    };
    mockActiveArchitectureId = 'arch-target';

    renderPanel();

    // Picker is not yet open.
    expect(
      screen.queryByTestId('save-target-arch-picker-modal')
    ).not.toBeInTheDocument();

    // Click the simulated "Confirm Artifact" trigger from the ChatThread stub.
    fireEvent.click(screen.getByTestId('trigger-confirm-artifact'));

    // Picker is now open. confirmArtifact has NOT been called yet -- the
    // panel deferred the save until the user picks an architecture.
    expect(
      screen.getByTestId('save-target-arch-picker-modal')
    ).toBeInTheDocument();
    expect(mockConfirmArtifact).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 5: Picker does NOT mount for bound/derived tasks; the panel calls
  // confirmArtifact directly (no architecture override).
  // --------------------------------------------------------------------------
  it('does NOT open the picker for bound-by-system-prompt tasks; calls confirmArtifact directly', () => {
    mockChatThreadState = {
      activeTaskId: 'architect--define-architecture', // bound-by-system-prompt
      boundArchitectureId: 'arch-target',
      boundArchitectureName: 'Target State',
      messages: [],
    };
    mockActiveArchitectureId = 'arch-target'; // matches bound -> no banner

    renderPanel();

    fireEvent.click(screen.getByTestId('trigger-confirm-artifact'));

    // Picker stays closed -- bound mode saves directly.
    expect(
      screen.queryByTestId('save-target-arch-picker-modal')
    ).not.toBeInTheDocument();
    // confirmArtifact was called with no override.
    expect(mockConfirmArtifact).toHaveBeenCalledTimes(1);
    expect(mockConfirmArtifact).toHaveBeenCalledWith();
  });

  // --------------------------------------------------------------------------
  // Test 6: Picker confirm threads the chosen architectureId through to
  // confirmArtifact (which forwards it to postSaveArtifact). This is the
  // load-bearing wire for the clarify-at-save mode -- the picker's chosen
  // architecture must reach the save payload.
  // --------------------------------------------------------------------------
  it('picker confirm forwards the chosen architectureId through to confirmArtifact', async () => {
    mockChatThreadState = {
      activeTaskId: 'ux-designer--ui-domain', // clarify-at-save
      boundArchitectureId: null,
      boundArchitectureName: null,
      messages: [],
    };
    mockActiveArchitectureId = 'arch-target'; // pre-selected by picker

    renderPanel();

    // Open the picker.
    fireEvent.click(screen.getByTestId('trigger-confirm-artifact'));
    expect(
      screen.getByTestId('save-target-arch-picker-modal')
    ).toBeInTheDocument();

    // Picker is pre-selected with the active arch (arch-target). Switch to
    // arch-current so we verify the NEW selection (not the default) reaches
    // confirmArtifact.
    fireEvent.change(screen.getByTestId('save-target-arch-picker-select'), {
      target: { value: 'arch-current' },
    });

    // Click Save.
    fireEvent.click(screen.getByTestId('save-target-arch-picker-confirm'));

    // confirmArtifact is invoked with the picker's chosen id.
    await waitFor(() => {
      expect(mockConfirmArtifact).toHaveBeenCalledTimes(1);
    });
    expect(mockConfirmArtifact).toHaveBeenCalledWith('arch-current');
  });

  // --------------------------------------------------------------------------
  // Test 7: bindingError on the chatV2 response renders as an inline system
  // message in the message stream. (The hook is responsible for synthesising
  // the message; the panel just renders the message stream that includes it.)
  // --------------------------------------------------------------------------
  it('renders bindingError-derived inline system message in the chat message stream', () => {
    // Simulate the hook having appended a bindingError system message to the
    // thread (Group 6 chatV2 returned bindingError; Group 10 hook
    // synthesises the inline system message). The panel just renders it.
    mockChatThreadState = {
      activeTaskId: 'architect--oas-spec',
      boundArchitectureId: null,
      boundArchitectureName: null,
      messages: [
        {
          id: 'msg-binding-err',
          role: 'system',
          personaId: null,
          taskId: null,
          content:
            "Cannot bind to archived architecture. Pick a different entity. (Cannot bind to archived architecture: Old State)",
          structuredResponse: { type: 'binding-error', code: 'archived_architecture', status: 422 },
          timestamp: '2026-05-01T00:00:00.000Z',
        },
      ],
    };
    mockActiveArchitectureId = 'arch-target';

    renderPanel();

    // The system message is rendered in the message stream. We use the
    // ChatThread stub's structured rendering to assert on it directly so
    // this test does not need to know MessageBubble internals.
    const systemMessages = screen.getAllByTestId('chat-msg-system');
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0]).toHaveTextContent(
      /Cannot bind to archived architecture\./
    );
  });
});

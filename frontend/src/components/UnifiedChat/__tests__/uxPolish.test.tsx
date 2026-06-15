/**
 * UX Polish Tests
 *
 * Spec 2026-03-03: UnifiedChatPanel UX Polish
 * Task Group 1: FR2, FR3, FR4 tests
 * Task Group 2: FR1 tests (Room Header Redesign)
 * Task Group 3: FR5 tests (Questions rendering suppresses content and shows summary)
 * Task Group 5: Gap analysis tests (coverage gaps for FR1-FR5)
 *
 * Tests verify:
 * - FR2: selectPersona calls sendMessage('') after switching (auto-send trigger)
 * - FR2: selectPersona still inserts "Switched to {name}" system message before auto-send
 * - FR3: MentionInput dropdown selection clears input (calls onChange('')) instead of inserting @DisplayName
 * - FR3: onPersonaSelected is called with the correct persona ID when selecting from dropdown
 * - FR4: selectTask sends the menuLabel directly (e.g., "Define Product") not "Selected task: Define Product"
 * - FR4: selectTask falls back to taskId when no menuLabel is found
 * - FR1: Header displays "Room: Project Room" for hub threadKey
 * - FR1: Header displays "Room: Product Strategy Room" / "Room: Architecture Room" for panel threadKeys
 * - FR1: "In:" section shows active persona's colored circle and displayName
 * - FR1: "In:" section updates when activePersonaId changes
 * - FR1: "Available:" section renders icons for all allowed personas except active
 * - FR1: Clicking an available persona icon calls selectPersona
 * - FR5: Questions rendering suppresses message.content and shows structuredResponse.summary
 * - FR5: Questions rendering shows only questions table when summary is absent
 * - FR5: Questions rendering suppresses JSON-like content
 * - FR5: Regular (non-questions) assistant messages still render content normally
 *
 * Gap analysis tests (Task Group 5):
 * - FR1: Available personas when allowedPersonaIds is undefined (hub = all 6 minus active)
 * - FR1: Available personas always includes assistant even when not in allowedPersonaIds
 * - FR2: selectPersona with same persona ID (no system message, no postHandoff, but sendMessage still called)
 * - FR3: MentionInput keyboard Enter persona selection clears input (not just click)
 * - FR5: Questions rendering with empty string summary (should not render empty div)
 * - FR5: Questions rendering with null structuredResponse still renders content normally
 * - Integration: Click available persona icon => system message appears in rendered output
 * - Integration: @-mention select => input cleared + onPersonaSelected triggered
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { screen, fireEvent, within } from '@testing-library/react';
import { useState } from 'react';
import { useChatThread } from '../../../hooks/useChatThread';
import { MentionInput } from '../MentionInput';
import { MessageBubble } from '../MessageBubble';
import type { ThreadKey, Thread, ChatV2Response, ThreadMessage } from '../../../api/chatV2Api';

// ============================================================================
// Mock the API module
// ============================================================================

vi.mock('../../../api/chatV2Api', async () => {
  const actual = await vi.importActual<typeof import('../../../api/chatV2Api')>(
    '../../../api/chatV2Api'
  );
  return {
    ...actual,
    postChatV2: vi.fn(),
    getThreadHistory: vi.fn(),
    postHandoff: vi.fn(),
    postGenerateArtifact: vi.fn(),
    postSaveArtifact: vi.fn(),
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

// Mock UserJourneyReviewContext (useActivateJourneyReview used in UnifiedChatPanel)
vi.mock('../../../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// Mock TemporaryDiagramContext (useActivateTemporaryDiagram used in UnifiedChatPanel)
vi.mock('../../../contexts/TemporaryDiagramContext', () => ({
  useActivateTemporaryDiagram: vi.fn(() => vi.fn()),
}));

// Mock ProjectContext (useProject used in UnifiedChatPanel)
vi.mock('../../../contexts/ProjectContext', () => ({
  useProject: vi.fn(() => null),
  useSetActiveProject: () => vi.fn(),
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

// Mock file upload utils (imported by ChatInputBar within UnifiedChatPanel)
vi.mock('../../../utils/fileUploadUtils', () => ({
  validateFiles: vi.fn().mockReturnValue({ valid: true }),
  readFilesAsBase64: vi.fn().mockResolvedValue([]),
  ACCEPTED_MIME_TYPES: '.txt,.pdf,.json',
  MAX_FILES: 5,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
}));

import { postChatV2, getThreadHistory, postHandoff } from '../../../api/chatV2Api';
import { UnifiedChatPanel } from '../UnifiedChatPanel';
import { renderWithRouter } from '../../../test-utils/renderWithProviders';

const mockPostChatV2 = vi.mocked(postChatV2);
const mockGetThreadHistory = vi.mocked(getThreadHistory);
const mockPostHandoff = vi.mocked(postHandoff);

// ============================================================================
// Test Data
// ============================================================================

const testThreadKey: ThreadKey = { type: 'hub', projectId: 'test-proj-1' };

const emptyThread: Thread = {
  threadKey: 'project:test-proj-1:hub',
  projectId: 'test-proj-1',
  messages: [],
  activePersonaId: null,
  activeTaskId: null,
  createdAt: '2026-03-03T10:00:00.000Z',
  updatedAt: '2026-03-03T10:00:00.000Z',
};

/** Task-menu response for selectTask tests */
const taskMenuResponse: ChatV2Response = {
  threadKey: 'project:test-proj-1:hub',
  personaId: 'product-manager',
  taskId: 'unknown',
  assistant: { message: 'Please select a task:' },
  structuredResponse: {
    type: 'task-menu',
    tasks: [
      { taskId: 'product-manager--define-product', menuLabel: 'Define Product', description: 'Define the product' },
      { taskId: 'product-manager--roadmap', menuLabel: 'Define Roadmap', description: 'Define the roadmap' },
    ],
  },
};

/** Standard response after task selection */
const taskSelectedResponse: ChatV2Response = {
  threadKey: 'project:test-proj-1:hub',
  personaId: 'product-manager',
  taskId: 'product-manager--define-product',
  assistant: { message: 'Let us define your product.' },
  structuredResponse: null,
};

// ============================================================================
// Stateful Wrapper for MentionInput (controlled component)
// ============================================================================

/**
 * A stateful wrapper that manages the value state for MentionInput,
 * mimicking how a real parent component would use it. Uses an onChange spy
 * to track calls while still updating the internal state.
 */
function MentionInputTestWrapper(props: {
  onPersonaSelected: (personaId: string) => void;
  onSubmit: () => void;
  onChangeSpy: (value: string) => void;
}) {
  const [value, setValue] = useState('');

  const handleChange = (newValue: string) => {
    setValue(newValue);
    props.onChangeSpy(newValue);
  };

  return (
    <MentionInput
      value={value}
      onChange={handleChange}
      onPersonaSelected={props.onPersonaSelected}
      onSubmit={props.onSubmit}
    />
  );
}

// ============================================================================
// FR2 Tests: Persona Switch Auto-Send
// ============================================================================

describe('FR2: selectPersona auto-send', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetThreadHistory.mockResolvedValue(emptyThread);
    mockPostHandoff.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('selectPersona calls sendMessage("") after switching persona, triggering the auto-send', async () => {
    // Given - set up a task menu response for the auto-send call
    mockPostChatV2.mockResolvedValue(taskMenuResponse);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'assistant' })
    );

    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    expect(result.current.activePersonaId).toBe('assistant');

    // When - switch to product-manager
    await act(async () => {
      result.current.selectPersona('product-manager');
    });

    // Then - postChatV2 should be called with empty message and taskId='unknown'
    // because sendMessage('') was called after the persona switch.
    // The persona ref is set synchronously to 'product-manager' before sendMessage runs.
    await waitFor(() => {
      expect(mockPostChatV2).toHaveBeenCalledTimes(1);
    });

    expect(mockPostChatV2).toHaveBeenCalledWith(
      expect.objectContaining({
        personaId: 'product-manager',
        taskId: 'unknown',
        message: '',
      })
    );
  });

  it('selectPersona still inserts "Switched to {name}" system message before auto-send', async () => {
    // Given
    mockPostChatV2.mockResolvedValue(taskMenuResponse);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'assistant' })
    );

    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    // When - switch persona
    await act(async () => {
      result.current.selectPersona('product-manager');
    });

    // Then - system message "Switched to Product Manager" should exist
    const systemMsg = result.current.messages.find(
      m => m.role === 'system' && m.content.includes('Switched to')
    );
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toBe('Switched to Product Manager');

    // And the auto-send should also have been triggered
    await waitFor(() => {
      expect(mockPostChatV2).toHaveBeenCalledTimes(1);
    });
  });
});

// ============================================================================
// FR3 Tests: @-Mention Persona Selection Clears Input
// ============================================================================

describe('FR3: MentionInput persona selection clears input', () => {
  it('selecting a persona from the MentionInput dropdown clears the input value via onChange("") instead of inserting @DisplayName', () => {
    // Given - render MentionInput with a stateful wrapper that tracks onChange calls
    const onChangeSpy = vi.fn();
    const onPersonaSelectedMock = vi.fn();
    const onSubmitMock = vi.fn();

    renderWithRouter(
      <MentionInputTestWrapper
        onPersonaSelected={onPersonaSelectedMock}
        onSubmit={onSubmitMock}
        onChangeSpy={onChangeSpy}
      />
    );

    // Simulate typing "@" to trigger the dropdown
    const textarea = screen.getByTestId('mention-input-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@' } });

    // The dropdown should now be visible
    expect(screen.getByTestId('mention-dropdown')).toBeInTheDocument();

    // Reset the spy to track only the selection call
    onChangeSpy.mockClear();

    // When - click on the Product Manager option
    const pmOption = screen.getByTestId('mention-option-product-manager');
    fireEvent.mouseDown(pmOption);

    // Then - onChange should have been called with '' (empty string) to clear the input
    expect(onChangeSpy).toHaveBeenCalledWith('');

    // The textarea value should now be empty (cleared)
    expect(textarea.value).toBe('');

    // Verify it did NOT insert @DisplayName text -- the only onChange call should be ''
    const insertionCall = onChangeSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === 'string' && call[0].includes('@Product Manager')
    );
    expect(insertionCall).toBeUndefined();

    // Dropdown should be dismissed
    expect(screen.queryByTestId('mention-dropdown')).not.toBeInTheDocument();
  });

  it('onPersonaSelected is called with the correct persona ID when selecting from dropdown', () => {
    // Given
    const onChangeSpy = vi.fn();
    const onPersonaSelectedMock = vi.fn();
    const onSubmitMock = vi.fn();

    renderWithRouter(
      <MentionInputTestWrapper
        onPersonaSelected={onPersonaSelectedMock}
        onSubmit={onSubmitMock}
        onChangeSpy={onChangeSpy}
      />
    );

    // Trigger the dropdown by simulating change event with "@"
    const textarea = screen.getByTestId('mention-input-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@' } });

    // The dropdown should be visible
    expect(screen.getByTestId('mention-dropdown')).toBeInTheDocument();

    // When - click on the Architect option
    const architectOption = screen.getByTestId('mention-option-architect');
    fireEvent.mouseDown(architectOption);

    // Then - onPersonaSelected should have been called with 'architect'
    expect(onPersonaSelectedMock).toHaveBeenCalledWith('architect');
  });
});

// ============================================================================
// FR4 Tests: Task Click Sends Label Directly
// ============================================================================

describe('FR4: selectTask sends menuLabel directly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetThreadHistory.mockResolvedValue(emptyThread);
    mockPostHandoff.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('selectTask sends the menuLabel directly (e.g., "Define Product") not "Selected task: Define Product"', async () => {
    // Given - set up thread with a task to avoid queuing on first send,
    // then get the task menu response so selectTask has label data
    const threadWithTask: Thread = {
      ...emptyThread,
      activeTaskId: 'some-task',
    };
    mockGetThreadHistory.mockResolvedValue(threadWithTask);

    mockPostChatV2
      .mockResolvedValueOnce(taskMenuResponse)       // first call: returns task menu
      .mockResolvedValueOnce(taskSelectedResponse);   // second call: after selectTask

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    );

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('some-task');
    });

    // Send a message to get the task menu (non-queuing path since taskId is not 'unknown')
    await act(async () => {
      await result.current.sendMessage('What tasks are available?');
    });

    // activeTaskId should now be 'unknown' after task-menu response
    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('unknown');
    });

    // When - select a task without any pending message
    await act(async () => {
      result.current.selectTask('product-manager--define-product');
    });

    // Then - the second call should send the label directly, not "Selected task: ..."
    await waitFor(() => {
      expect(mockPostChatV2).toHaveBeenCalledTimes(2);
    });

    const secondCall = mockPostChatV2.mock.calls[1][0];
    expect(secondCall.message).toBe('Define Product');
    // Verify it does NOT contain the old prefix
    expect(secondCall.message).not.toContain('Selected task:');
  });

  it('selectTask falls back to taskId when no menuLabel is found in the last structured response', async () => {
    // Given - set up with no prior task menu response (lastStructuredResponseRef is null)
    mockPostChatV2.mockResolvedValue(taskSelectedResponse);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    );

    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    // activeTaskId starts as 'unknown', so selectTask without prior task menu
    // will fall back to using the taskId as the label

    // When - select a task with no prior task menu data
    await act(async () => {
      result.current.selectTask('custom-task-id');
    });

    // Then - should send the taskId directly as the fallback label
    await waitFor(() => {
      expect(mockPostChatV2).toHaveBeenCalledTimes(1);
    });

    const call = mockPostChatV2.mock.calls[0][0];
    expect(call.message).toBe('custom-task-id');
    // Verify it does NOT contain "Selected task:" prefix
    expect(call.message).not.toContain('Selected task:');
  });
});

// ============================================================================
// FR1 Tests: Room Header Redesign
// ============================================================================

describe('FR1: Room Header with Room/Persona Model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetThreadHistory.mockResolvedValue(emptyThread);
    mockPostHandoff.mockResolvedValue(undefined);
    mockPostChatV2.mockResolvedValue(taskMenuResponse);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('header displays "Room: Project Room" when threadKey is { type: "hub" }', async () => {
    // Given - hub threadKey
    const hubThreadKey: ThreadKey = { type: 'hub', projectId: 'test-proj-1' };

    await act(async () => {
      renderWithRouter(
        <UnifiedChatPanel
          threadKey={hubThreadKey}
          initialPersonaId="assistant"
          defaultOpen={true}
        />
      );
    });

    // Then - header should display the room name section
    const roomNameSection = screen.getByTestId('header-room-name');
    expect(roomNameSection).toBeInTheDocument();
    expect(roomNameSection).toHaveTextContent('Room:');
    expect(roomNameSection).toHaveTextContent('Project Room');
  });

  it('header displays "Room: Product Strategy Room" for panel screen "product" and "Room: Architecture Room" for screen "metamodel"', async () => {
    // Given - panel threadKey with screen 'product'
    const productPanelKey: ThreadKey = { type: 'panel', projectId: 'test-proj-1', screen: 'product' };
    const productThread: Thread = {
      ...emptyThread,
      threadKey: 'project:test-proj-1:panel:product',
    };
    mockGetThreadHistory.mockResolvedValue(productThread);

    const { unmount } = await act(async () => {
      return renderWithRouter(
        <UnifiedChatPanel
          threadKey={productPanelKey}
          initialPersonaId="assistant"
          defaultOpen={true}
        />
      );
    });

    // Then - should show "Product Strategy Room"
    let roomNameSection = screen.getByTestId('header-room-name');
    expect(roomNameSection).toHaveTextContent('Product Strategy Room');

    // Clean up and re-render with architecture panel
    unmount();
    vi.clearAllMocks();

    const archPanelKey: ThreadKey = { type: 'panel', projectId: 'test-proj-1', screen: 'metamodel' };
    const archThread: Thread = {
      ...emptyThread,
      threadKey: 'project:test-proj-1:panel:metamodel',
    };
    mockGetThreadHistory.mockResolvedValue(archThread);
    mockPostHandoff.mockResolvedValue(undefined);
    mockPostChatV2.mockResolvedValue(taskMenuResponse);

    await act(async () => {
      renderWithRouter(
        <UnifiedChatPanel
          threadKey={archPanelKey}
          initialPersonaId="assistant"
          defaultOpen={true}
        />
      );
    });

    // Then - should show "Architecture Room"
    roomNameSection = screen.getByTestId('header-room-name');
    expect(roomNameSection).toHaveTextContent('Architecture Room');
  });

  it('"In:" section renders active persona colored circle with initials and displayName', async () => {
    // Given - render with assistant as initial persona
    await act(async () => {
      renderWithRouter(
        <UnifiedChatPanel
          threadKey={testThreadKey}
          initialPersonaId="assistant"
          defaultOpen={true}
        />
      );
    });

    // Then - "In:" section should show the active persona
    const activePersonaSection = screen.getByTestId('header-active-persona');
    expect(activePersonaSection).toBeInTheDocument();
    expect(activePersonaSection).toHaveTextContent('In:');

    // Persona indicator should show Assistant initials
    const personaIndicator = screen.getByTestId('persona-indicator');
    expect(personaIndicator).toHaveTextContent('AS');
    expect(personaIndicator).toHaveStyle({ backgroundColor: '#5C6BC0' });

    // Display name should be shown
    expect(activePersonaSection).toHaveTextContent('Assistant');
  });

  it('"In:" section updates when activePersonaId changes via clicking available persona', async () => {
    // Given - render with assistant as initial persona
    await act(async () => {
      renderWithRouter(
        <UnifiedChatPanel
          threadKey={testThreadKey}
          initialPersonaId="assistant"
          defaultOpen={true}
        />
      );
    });

    // Initially shows Assistant
    const activePersonaSection = screen.getByTestId('header-active-persona');
    expect(activePersonaSection).toHaveTextContent('Assistant');

    // When - click on the Product Manager available persona icon
    const pmIcon = screen.getByTestId('available-persona-product-manager');
    await act(async () => {
      fireEvent.click(pmIcon);
    });

    // Then - "In:" section should now show Product Manager
    await waitFor(() => {
      const updatedSection = screen.getByTestId('header-active-persona');
      expect(updatedSection).toHaveTextContent('Product Manager');
    });

    // Persona indicator should now show PM initials
    const personaIndicator = screen.getByTestId('persona-indicator');
    expect(personaIndicator).toHaveTextContent('PM');
  });

  it('"Available:" section renders icons for all allowed personas except active, always includes assistant', async () => {
    // Given - render with product-manager as initial persona and specific allowedPersonaIds
    const allowedIds = ['product-manager', 'architect'];

    await act(async () => {
      renderWithRouter(
        <UnifiedChatPanel
          threadKey={testThreadKey}
          initialPersonaId="product-manager"
          allowedPersonaIds={allowedIds}
          defaultOpen={true}
        />
      );
    });

    // Then - Available section should exist
    const availableSection = screen.getByTestId('header-available-personas');
    expect(availableSection).toBeInTheDocument();
    expect(availableSection).toHaveTextContent('Available:');

    // Should show architect (allowed, not active)
    expect(screen.getByTestId('available-persona-architect')).toBeInTheDocument();

    // Should show assistant (always included, not active)
    expect(screen.getByTestId('available-persona-assistant')).toBeInTheDocument();

    // Should NOT show product-manager (active persona is excluded)
    expect(screen.queryByTestId('available-persona-product-manager')).not.toBeInTheDocument();

    // Should NOT show ux-designer, test-engineer, software-developer (not in allowedPersonaIds)
    expect(screen.queryByTestId('available-persona-ux-designer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('available-persona-test-engineer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('available-persona-software-developer')).not.toBeInTheDocument();
  });

  it('clicking an available persona icon calls selectPersona with the correct personaId', async () => {
    // Given - render with assistant as initial persona
    await act(async () => {
      renderWithRouter(
        <UnifiedChatPanel
          threadKey={testThreadKey}
          initialPersonaId="assistant"
          defaultOpen={true}
        />
      );
    });

    // Architect icon should be available
    const architectIcon = screen.getByTestId('available-persona-architect');
    expect(architectIcon).toBeInTheDocument();
    expect(architectIcon).toHaveTextContent('AR');

    // When - click the architect icon
    await act(async () => {
      fireEvent.click(architectIcon);
    });

    // Then - selectPersona should have been called, triggering persona switch.
    // Verify via postHandoff being called with (threadKey, personaId) as separate args
    await waitFor(() => {
      expect(mockPostHandoff).toHaveBeenCalledWith(
        testThreadKey,
        'architect'
      );
    });

    // And the auto-send should also have been triggered (FR2: selectPersona calls sendMessage)
    await waitFor(() => {
      expect(mockPostChatV2).toHaveBeenCalledWith(
        expect.objectContaining({
          personaId: 'architect',
          taskId: 'unknown',
          message: '',
        })
      );
    });
  });
});

// ============================================================================
// FR5 Tests: Questions Rendering Suppresses Content and Shows Summary
// ============================================================================

describe('FR5: Questions rendering suppresses content and shows summary', () => {
  const onSubmitAnswers = vi.fn();

  it('renders summary text above questions table and suppresses message.content when showQuestions is true', () => {
    const message: ThreadMessage = {
      id: 'msg-1',
      role: 'assistant',
      personaId: 'product-manager',
      taskId: null,
      content: '{"some":"raw json content that should be hidden"}',
      structuredResponse: {
        summary: 'I have a few questions about your product.',
        questions: [
          { id: 'q1', question: 'What is the target market?' },
        ],
      },
      timestamp: '2026-03-03T10:00:00.000Z',
    };

    renderWithRouter(<MessageBubble message={message} onSubmitAnswers={onSubmitAnswers} />);

    // Summary should be rendered
    expect(screen.getByText('I have a few questions about your product.')).toBeInTheDocument();

    // Content (raw JSON) should NOT be rendered
    expect(screen.queryByText(/raw json content/)).not.toBeInTheDocument();

    // Questions table should be rendered
    expect(screen.getByText('What is the target market?')).toBeInTheDocument();
  });

  it('renders only questions table when summary is absent/empty', () => {
    const message: ThreadMessage = {
      id: 'msg-2',
      role: 'assistant',
      personaId: 'product-manager',
      taskId: null,
      content: 'Some content that should be hidden',
      structuredResponse: {
        questions: [
          { id: 'q1', question: 'What is your budget?' },
        ],
      },
      timestamp: '2026-03-03T10:00:00.000Z',
    };

    renderWithRouter(<MessageBubble message={message} onSubmitAnswers={onSubmitAnswers} />);

    // Content should NOT be rendered
    expect(screen.queryByText('Some content that should be hidden')).not.toBeInTheDocument();

    // Questions should be rendered
    expect(screen.getByText('What is your budget?')).toBeInTheDocument();
  });

  it('suppresses JSON-like content when showQuestions is true', () => {
    const message: ThreadMessage = {
      id: 'msg-3',
      role: 'assistant',
      personaId: 'architect',
      taskId: null,
      content: '{"type":"questions","summary":"test","questions":["Q1","Q2"]}',
      structuredResponse: {
        summary: 'Here are my questions.',
        questions: [
          { id: 'q1', question: 'What framework?' },
          { id: 'q2', question: 'What database?' },
        ],
      },
      timestamp: '2026-03-03T10:00:00.000Z',
    };

    renderWithRouter(<MessageBubble message={message} onSubmitAnswers={onSubmitAnswers} />);

    // JSON content should be suppressed
    expect(screen.queryByText(/{"type"/)).not.toBeInTheDocument();

    // Summary should show
    expect(screen.getByText('Here are my questions.')).toBeInTheDocument();
  });

  it('regular (non-questions) assistant messages still render content normally', () => {
    const message: ThreadMessage = {
      id: 'msg-4',
      role: 'assistant',
      personaId: 'assistant',
      taskId: null,
      content: 'Hello! How can I help you today?',
      structuredResponse: null,
      timestamp: '2026-03-03T10:00:00.000Z',
    };

    renderWithRouter(<MessageBubble message={message} />);

    // Regular content should be rendered
    expect(screen.getByText('Hello! How can I help you today?')).toBeInTheDocument();
  });
});

// ============================================================================
// Task Group 5: Gap Analysis Tests
// ============================================================================

describe('TG5 Gap: FR1 - Available personas when allowedPersonaIds is undefined (hub case)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetThreadHistory.mockResolvedValue(emptyThread);
    mockPostHandoff.mockResolvedValue(undefined);
    mockPostChatV2.mockResolvedValue(taskMenuResponse);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows all 5 non-active personas when allowedPersonaIds is not provided (hub = all 6 minus active)', async () => {
    // Given - hub threadKey with NO allowedPersonaIds prop, active persona is 'assistant'
    await act(async () => {
      renderWithRouter(
        <UnifiedChatPanel
          threadKey={testThreadKey}
          initialPersonaId="assistant"
          defaultOpen={true}
        />
      );
    });

    // Then - all 5 non-active personas should appear as available
    // (6 total personas minus the active 'assistant')
    expect(screen.getByTestId('available-persona-product-manager')).toBeInTheDocument();
    expect(screen.getByTestId('available-persona-architect')).toBeInTheDocument();
    expect(screen.getByTestId('available-persona-ux-designer')).toBeInTheDocument();
    expect(screen.getByTestId('available-persona-test-engineer')).toBeInTheDocument();
    expect(screen.getByTestId('available-persona-software-developer')).toBeInTheDocument();

    // Active persona should NOT appear in available list
    expect(screen.queryByTestId('available-persona-assistant')).not.toBeInTheDocument();

    // Verify count: exactly 5 available persona icons rendered
    const availableSection = screen.getByTestId('header-available-personas');
    const icons = within(availableSection).getAllByTestId(/^available-persona-/);
    expect(icons).toHaveLength(5);
  });
});

describe('TG5 Gap: FR1 - Available personas always includes assistant even when not in allowedPersonaIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetThreadHistory.mockResolvedValue(emptyThread);
    mockPostHandoff.mockResolvedValue(undefined);
    mockPostChatV2.mockResolvedValue(taskMenuResponse);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes assistant in available list even when allowedPersonaIds explicitly excludes it', async () => {
    // Given - allowedPersonaIds does NOT include 'assistant', active is 'architect'
    const allowedIds = ['architect', 'product-manager'];

    await act(async () => {
      renderWithRouter(
        <UnifiedChatPanel
          threadKey={testThreadKey}
          initialPersonaId="architect"
          allowedPersonaIds={allowedIds}
          defaultOpen={true}
        />
      );
    });

    // Then - assistant should still appear (always included via the allowedSet.add('assistant') logic)
    expect(screen.getByTestId('available-persona-assistant')).toBeInTheDocument();

    // product-manager should appear (in allowedPersonaIds, not active)
    expect(screen.getByTestId('available-persona-product-manager')).toBeInTheDocument();

    // architect should NOT appear (it is the active persona)
    expect(screen.queryByTestId('available-persona-architect')).not.toBeInTheDocument();

    // ux-designer, test-engineer, software-developer should NOT appear (not in allowedPersonaIds)
    expect(screen.queryByTestId('available-persona-ux-designer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('available-persona-test-engineer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('available-persona-software-developer')).not.toBeInTheDocument();
  });
});

describe('TG5 Gap: FR2 - selectPersona with same persona ID', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetThreadHistory.mockResolvedValue(emptyThread);
    mockPostHandoff.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not insert system message or call postHandoff when selecting the same persona, but still triggers sendMessage', async () => {
    // Given - start with 'assistant' as active persona
    mockPostChatV2.mockResolvedValue(taskMenuResponse);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'assistant' })
    );

    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    expect(result.current.activePersonaId).toBe('assistant');

    // When - call selectPersona with the SAME persona id
    await act(async () => {
      result.current.selectPersona('assistant');
    });

    // Then - no system message should have been inserted
    const systemMsgs = result.current.messages.filter(
      m => m.role === 'system' && m.content.includes('Switched to')
    );
    expect(systemMsgs).toHaveLength(0);

    // And postHandoff should NOT have been called (persona not changing)
    expect(mockPostHandoff).not.toHaveBeenCalled();

    // But sendMessage('') IS still called (resets to unknown task + triggers auto-send)
    await waitFor(() => {
      expect(mockPostChatV2).toHaveBeenCalledTimes(1);
    });

    expect(mockPostChatV2).toHaveBeenCalledWith(
      expect.objectContaining({
        personaId: 'assistant',
        taskId: 'unknown',
        message: '',
      })
    );
  });
});

describe('TG5 Gap: FR3 - MentionInput keyboard Enter persona selection clears input', () => {
  it('pressing Enter on a highlighted dropdown option clears the input (same as mouse click)', () => {
    // Given - render MentionInput with a stateful wrapper
    const onChangeSpy = vi.fn();
    const onPersonaSelectedMock = vi.fn();
    const onSubmitMock = vi.fn();

    renderWithRouter(
      <MentionInputTestWrapper
        onPersonaSelected={onPersonaSelectedMock}
        onSubmit={onSubmitMock}
        onChangeSpy={onChangeSpy}
      />
    );

    // Simulate typing "@" to trigger the dropdown
    const textarea = screen.getByTestId('mention-input-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@' } });

    // The dropdown should now be visible
    expect(screen.getByTestId('mention-dropdown')).toBeInTheDocument();

    // Reset the spy to track only the selection call
    onChangeSpy.mockClear();

    // When - press Enter key to select the first persona in the dropdown
    // (default selectedIndex is 0, which is 'assistant')
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Then - onChange should have been called with '' to clear the input
    expect(onChangeSpy).toHaveBeenCalledWith('');

    // The textarea value should now be empty
    expect(textarea.value).toBe('');

    // onPersonaSelected should have been called with the first persona's ID
    expect(onPersonaSelectedMock).toHaveBeenCalledWith('assistant');

    // Verify no @DisplayName text was inserted
    const insertionCall = onChangeSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === 'string' && call[0].includes('@')
    );
    expect(insertionCall).toBeUndefined();

    // Dropdown should be dismissed
    expect(screen.queryByTestId('mention-dropdown')).not.toBeInTheDocument();
  });
});

describe('TG5 Gap: FR5 - Questions rendering edge cases', () => {
  const onSubmitAnswers = vi.fn();

  it('does not render an empty summary div when structuredResponse.summary is an empty string', () => {
    // Given - questions with empty string summary
    const message: ThreadMessage = {
      id: 'msg-gap-1',
      role: 'assistant',
      personaId: 'product-manager',
      taskId: null,
      content: 'Content that should still be hidden',
      structuredResponse: {
        summary: '',
        questions: [
          { id: 'q1', question: 'What is the timeline?' },
        ],
      },
      timestamp: '2026-03-03T10:00:00.000Z',
    };

    const { container } = renderWithRouter(
      <MessageBubble message={message} onSubmitAnswers={onSubmitAnswers} />
    );

    // Questions should render
    expect(screen.getByText('What is the timeline?')).toBeInTheDocument();

    // Content should be suppressed (questions mode)
    expect(screen.queryByText('Content that should still be hidden')).not.toBeInTheDocument();

    // Empty summary should NOT produce a div with messageContent class
    // The IIFE returns null for falsy summary, so there should be no empty summary div
    const structuredArea = container.querySelector('[class*="structuredResponseArea"]');
    expect(structuredArea).toBeInTheDocument();

    // The structuredResponseArea should only contain the questions renderer,
    // not an empty messageContent div for the summary
    const messageContentDivs = structuredArea!.querySelectorAll('[class*="messageContent"]');
    expect(messageContentDivs).toHaveLength(0);
  });

  it('renders content normally when structuredResponse is null (no questions branch)', () => {
    // Given - message with null structuredResponse (should go through regular text path)
    const message: ThreadMessage = {
      id: 'msg-gap-2',
      role: 'assistant',
      personaId: 'architect',
      taskId: null,
      content: 'Here is my analysis of the architecture.',
      structuredResponse: null,
      timestamp: '2026-03-03T10:00:00.000Z',
    };

    const { container } = renderWithRouter(<MessageBubble message={message} />);

    // Content should be rendered normally
    expect(screen.getByText('Here is my analysis of the architecture.')).toBeInTheDocument();

    // No structuredResponseArea should exist (regular text path, not questions path)
    const structuredArea = container.querySelector('[class*="structuredResponseArea"]');
    expect(structuredArea).not.toBeInTheDocument();
  });
});

describe('TG5 Gap: Integration - Click available persona => system message appears in DOM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetThreadHistory.mockResolvedValue(emptyThread);
    mockPostHandoff.mockResolvedValue(undefined);
    mockPostChatV2.mockResolvedValue(taskMenuResponse);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clicking an available persona icon renders the "Switched to" system message in the chat thread', async () => {
    // Given - render panel with assistant as initial persona
    await act(async () => {
      renderWithRouter(
        <UnifiedChatPanel
          threadKey={testThreadKey}
          initialPersonaId="assistant"
          defaultOpen={true}
        />
      );
    });

    // Initially no system messages
    expect(screen.queryByText(/Switched to/)).not.toBeInTheDocument();

    // When - click on the Product Manager available persona icon
    const pmIcon = screen.getByTestId('available-persona-product-manager');
    await act(async () => {
      fireEvent.click(pmIcon);
    });

    // Then - "Switched to Product Manager" system message should appear in the rendered chat
    await waitFor(() => {
      expect(screen.getByText('Switched to Product Manager')).toBeInTheDocument();
    });

    // The system message should be rendered as a system role bubble
    const switchedMessage = screen.getByText('Switched to Product Manager');
    const bubble = switchedMessage.closest('[data-testid="message-bubble"]');
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveAttribute('data-role', 'system');
  });
});

describe('TG5 Gap: Integration - @-mention select => input cleared + onPersonaSelected triggered', () => {
  it('@-mention selection via keyboard ArrowDown + Enter selects the correct persona and clears input', () => {
    // Given - render MentionInput
    const onChangeSpy = vi.fn();
    const onPersonaSelectedMock = vi.fn();
    const onSubmitMock = vi.fn();

    renderWithRouter(
      <MentionInputTestWrapper
        onPersonaSelected={onPersonaSelectedMock}
        onSubmit={onSubmitMock}
        onChangeSpy={onChangeSpy}
      />
    );

    // Simulate typing "@" to trigger the dropdown
    const textarea = screen.getByTestId('mention-input-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@' } });

    // Dropdown should be visible with all personas
    expect(screen.getByTestId('mention-dropdown')).toBeInTheDocument();

    // Reset spy
    onChangeSpy.mockClear();

    // When - press ArrowDown to move to the second persona (product-manager),
    // then Enter to select it
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Then - onPersonaSelected should be called with the second persona
    // (PERSONA_CONFIGS order: assistant, product-manager, architect, ...)
    expect(onPersonaSelectedMock).toHaveBeenCalledWith('product-manager');

    // Input should be cleared
    expect(onChangeSpy).toHaveBeenCalledWith('');
    expect(textarea.value).toBe('');

    // Dropdown should be dismissed
    expect(screen.queryByTestId('mention-dropdown')).not.toBeInTheDocument();
  });
});

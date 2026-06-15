/**
 * Integration Gap Tests
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 8, Task 8.3: Write up to 10 additional strategic tests
 *
 * These tests fill critical coverage gaps identified during the TG1-7 review:
 *
 * 1. useChatThread: API error sets error state and clears isLoading
 * 2. useChatThread: re-fetches history when threadKey changes
 * 3. MessageBubble: renders TaskMenu when structuredResponse has type 'task-menu'
 * 4. MessageBubble: renders StructuredQuestionsRenderer when structuredResponse has questions
 * 5. MentionInput: allowedPersonaIds constraint restricts dropdown to allowed personas only
 * 6. ChatInputBar: file attachment sends files through to onSend callback
 * 7. MessageBubble: task-menu onSelectTask callback fires with correct taskId
 * 8. StructuredQuestionsRenderer: onSubmitAnswers receives formatted answers on submit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';

// ============================================================================
// Imports for components under test
// ============================================================================

import { MessageBubble } from '../MessageBubble';
import { MentionInput } from '../MentionInput';
import { ChatInputBar } from '../ChatInputBar';
import type { ThreadMessage } from '../../../api/chatV2Api';
import type { ThreadKey, Thread, ChatV2Response } from '../../../api/chatV2Api';

// ============================================================================
// Mock setup for useChatThread hook tests
// ============================================================================

vi.mock('../../../api/chatV2Api', async () => {
  const actual = await vi.importActual<typeof import('../../../api/chatV2Api')>(
    '../../../api/chatV2Api'
  );
  return {
    ...actual,
    postChatV2: vi.fn(),
    getThreadHistory: vi.fn(),
  };
});

// Mock file upload utils (used by ChatInputBar)
vi.mock('../../../utils/fileUploadUtils', () => ({
  validateFiles: vi.fn().mockReturnValue({ valid: true }),
  readFilesAsBase64: vi.fn().mockResolvedValue([
    { filename: 'test.txt', mimeType: 'text/plain', base64: 'dGVzdA==' },
  ]),
  ACCEPTED_MIME_TYPES: '.txt,.pdf,.json',
  MAX_FILES: 5,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
}));

import { postChatV2, getThreadHistory } from '../../../api/chatV2Api';
import { validateFiles, readFilesAsBase64 } from '../../../utils/fileUploadUtils';
import { useChatThread } from '../../../hooks/useChatThread';
import { createProvidersWrapper } from '../../../test-utils/renderWithProviders';

// Shared harness: useChatThread reads useActiveArchitectureId(), which
// requires the real ArchitectureProvider (Router + ProjectContext stack).
const providersWrapper = createProvidersWrapper();

const mockPostChatV2 = vi.mocked(postChatV2);
const mockGetThreadHistory = vi.mocked(getThreadHistory);

// ============================================================================
// Test Data
// ============================================================================

const emptyThread: Thread = {
  threadKey: 'project:test-proj-1:hub',
  projectId: 'test-proj-1',
  messages: [],
  activePersonaId: null,
  activeTaskId: null,
  createdAt: '2026-02-28T10:00:00.000Z',
  updatedAt: '2026-02-28T10:00:00.000Z',
};

const taskMenuMessage: ThreadMessage = {
  id: 'msg-tm-1',
  role: 'assistant',
  personaId: 'product-manager',
  taskId: 'unknown',
  content: 'Please select a task:',
  structuredResponse: {
    type: 'task-menu',
    tasks: [
      {
        taskId: 'define-product',
        menuLabel: 'Define Product',
        description: 'Define the product mission and vision',
      },
      {
        taskId: 'build-roadmap',
        menuLabel: 'Build Roadmap',
        description: 'Create a product roadmap',
      },
    ],
  },
  timestamp: '2026-02-28T10:00:00.000Z',
};

const questionsMessage: ThreadMessage = {
  id: 'msg-q-1',
  role: 'assistant',
  personaId: 'product-manager',
  taskId: 'define-product',
  content: 'Please answer the following questions:',
  structuredResponse: {
    questions: [
      { id: 'q1', question: 'What problem does the product solve?' },
      { id: 'q2', question: 'Who is the target user?' },
    ],
  },
  timestamp: '2026-02-28T10:01:00.000Z',
};

// ============================================================================
// MentionInput Wrapper (controlled component)
// ============================================================================

function MentionInputWrapper(props: {
  onPersonaSelected: (personaId: string) => void;
  onSubmit: () => void;
  allowedPersonaIds?: string[];
}) {
  const [value, setValue] = useState('');
  return (
    <MentionInput
      value={value}
      onChange={setValue}
      onPersonaSelected={props.onPersonaSelected}
      onSubmit={props.onSubmit}
      allowedPersonaIds={props.allowedPersonaIds}
    />
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('Integration Gap Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // vi.restoreAllMocks() in afterEach RESETS the factory-configured return
    // values of the fileUploadUtils mocks, so re-establish them per test.
    vi.mocked(validateFiles).mockReturnValue({ valid: true });
    vi.mocked(readFilesAsBase64).mockResolvedValue([
      { filename: 'test.txt', mimeType: 'text/plain', base64: 'dGVzdA==' },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Gap 1: useChatThread handles API error gracefully
  // Covers: error state set, isLoading cleared, error indicator message appended
  // --------------------------------------------------------------------------
  describe('useChatThread error handling', () => {
    it('sets error state and clears isLoading when postChatV2 throws', async () => {
      const threadKey: ThreadKey = { type: 'hub', projectId: 'err-proj' };
      mockGetThreadHistory.mockResolvedValue({
        ...emptyThread,
        threadKey: 'project:err-proj:hub',
        projectId: 'err-proj',
      });
      mockPostChatV2.mockRejectedValue(new Error('Network failure'));

      const { result } = renderHook(() =>
        useChatThread(threadKey, { initialPersonaId: 'assistant' })
      , { wrapper: providersWrapper });

      // Wait for initial history load
      await waitFor(() => {
        expect(mockGetThreadHistory).toHaveBeenCalled();
      });

      // Send a message that will fail
      await act(async () => {
        await result.current.sendMessage('This will fail');
      });

      // Error state should be set
      expect(result.current.error).toBe('Network failure');
      // isLoading should be false
      expect(result.current.isLoading).toBe(false);

      // Messages should contain the optimistic user message + error indicator
      expect(result.current.messages.length).toBe(2);
      expect(result.current.messages[0].role).toBe('user');
      expect(result.current.messages[0].content).toBe('This will fail');
      expect(result.current.messages[1].role).toBe('system');
      expect(result.current.messages[1].content).toContain('Error: Network failure');
    });
  });

  // --------------------------------------------------------------------------
  // Gap 2: useChatThread re-fetches when threadKey changes
  // --------------------------------------------------------------------------
  describe('useChatThread threadKey change', () => {
    it('re-fetches history when threadKey changes', async () => {
      const threadKey1: ThreadKey = { type: 'hub', projectId: 'proj-a' };
      const threadKey2: ThreadKey = { type: 'hub', projectId: 'proj-b' };

      const threadA: Thread = {
        ...emptyThread,
        threadKey: 'project:proj-a:hub',
        projectId: 'proj-a',
        messages: [
          {
            id: 'msg-a1',
            role: 'user',
            personaId: null,
            taskId: null,
            content: 'Message from project A',
            structuredResponse: null,
            timestamp: '2026-02-28T10:00:00.000Z',
          },
        ],
      };

      const threadB: Thread = {
        ...emptyThread,
        threadKey: 'project:proj-b:hub',
        projectId: 'proj-b',
        messages: [
          {
            id: 'msg-b1',
            role: 'user',
            personaId: null,
            taskId: null,
            content: 'Message from project B',
            structuredResponse: null,
            timestamp: '2026-02-28T11:00:00.000Z',
          },
        ],
      };

      mockGetThreadHistory
        .mockResolvedValueOnce(threadA)
        .mockResolvedValueOnce(threadB);

      // Start with threadKey1
      const { result, rerender } = renderHook(
        ({ tk }) => useChatThread(tk, { initialPersonaId: 'assistant' }),
        { initialProps: { tk: threadKey1 as ThreadKey }, wrapper: providersWrapper }
      );

      // Wait for first load
      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });
      expect(result.current.messages[0].content).toBe('Message from project A');

      // Change threadKey
      rerender({ tk: threadKey2 });

      // Wait for second load
      await waitFor(() => {
        expect(result.current.messages[0].content).toBe('Message from project B');
      });

      // getThreadHistory should have been called twice
      expect(mockGetThreadHistory).toHaveBeenCalledTimes(2);
      expect(mockGetThreadHistory).toHaveBeenCalledWith(threadKey1);
      expect(mockGetThreadHistory).toHaveBeenCalledWith(threadKey2);
    });
  });

  // --------------------------------------------------------------------------
  // Gap 3: MessageBubble renders TaskMenu for task-menu structured response
  // --------------------------------------------------------------------------
  describe('MessageBubble with structured responses', () => {
    it('renders TaskMenu when structuredResponse has type task-menu', () => {
      const onSelectTask = vi.fn();

      render(
        <MessageBubble
          message={taskMenuMessage}
          onSelectTask={onSelectTask}
        />
      );

      // Task menu should be rendered
      expect(screen.getByTestId('task-menu')).toBeInTheDocument();

      // Individual task cards should be present
      expect(screen.getByTestId('task-card-define-product')).toBeInTheDocument();
      expect(screen.getByTestId('task-card-build-roadmap')).toBeInTheDocument();

      // The message text should also be shown
      expect(screen.getByText('Please select a task:')).toBeInTheDocument();

      // Persona avatar and name should be rendered (assistant message)
      expect(screen.getByText('Product Manager')).toBeInTheDocument();
      expect(screen.getByTestId('persona-avatar')).toHaveTextContent('PM');
    });

    // --------------------------------------------------------------------------
    // Gap 4: MessageBubble renders StructuredQuestionsRenderer for questions
    // --------------------------------------------------------------------------
    it('renders StructuredQuestionsRenderer when structuredResponse has questions', () => {
      const onSubmitAnswers = vi.fn();

      render(
        <MessageBubble
          message={questionsMessage}
          onSubmitAnswers={onSubmitAnswers}
        />
      );

      // Structured questions container should be rendered
      expect(screen.getByTestId('structured-questions')).toBeInTheDocument();

      // Question rows should be present
      expect(screen.getByTestId('question-row-q1')).toBeInTheDocument();
      expect(screen.getByTestId('question-row-q2')).toBeInTheDocument();

      // Question text should be visible
      expect(screen.getByText('What problem does the product solve?')).toBeInTheDocument();
      expect(screen.getByText('Who is the target user?')).toBeInTheDocument();

      // Answer inputs should be present
      expect(screen.getByTestId('answer-input-q1')).toBeInTheDocument();
      expect(screen.getByTestId('answer-input-q2')).toBeInTheDocument();

      // FR5: message.content is suppressed when questions are present
      expect(screen.queryByText('Please answer the following questions:')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Gap 5: MentionInput with allowedPersonaIds shows only allowed personas
  // --------------------------------------------------------------------------
  describe('MentionInput with allowedPersonaIds', () => {
    it('shows only allowed personas when allowedPersonaIds is provided', () => {
      const onPersonaSelected = vi.fn();
      const onSubmit = vi.fn();

      render(
        <MentionInputWrapper
          onPersonaSelected={onPersonaSelected}
          onSubmit={onSubmit}
          allowedPersonaIds={['product-manager', 'architect']}
        />
      );

      const textarea = screen.getByTestId('mention-input-textarea');

      // Trigger the dropdown
      fireEvent.change(textarea, { target: { value: '@' } });

      // Dropdown should be visible
      expect(screen.getByTestId('mention-dropdown')).toBeInTheDocument();

      // Only allowed personas should be shown
      expect(screen.getByTestId('mention-option-product-manager')).toBeInTheDocument();
      expect(screen.getByTestId('mention-option-architect')).toBeInTheDocument();

      // Other personas should NOT be shown
      expect(screen.queryByTestId('mention-option-assistant')).not.toBeInTheDocument();
      expect(screen.queryByTestId('mention-option-ux-designer')).not.toBeInTheDocument();
      expect(screen.queryByTestId('mention-option-test-engineer')).not.toBeInTheDocument();
      expect(screen.queryByTestId('mention-option-software-developer')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Gap 6: ChatInputBar file attachment sends files through onSend
  // --------------------------------------------------------------------------
  describe('ChatInputBar with file attachment', () => {
    it('sends files through onSend callback when files are attached', async () => {
      const onSend = vi.fn();
      const onPersonaSelected = vi.fn();

      render(
        <ChatInputBar
          onSend={onSend}
          onPersonaSelected={onPersonaSelected}
        />
      );

      // Attach a file using the hidden file input
      const fileInput = screen.getByTestId('chat-file-input') as HTMLInputElement;
      const testFile = new File(['test content'], 'document.txt', {
        type: 'text/plain',
      });

      fireEvent.change(fileInput, { target: { files: [testFile] } });

      // File chip should be displayed
      await waitFor(() => {
        expect(screen.getByTestId('file-attachment-bar')).toBeInTheDocument();
      });
      expect(screen.getByTestId('file-chip-0')).toBeInTheDocument();

      // Send button should be enabled even without text (files are attached)
      const sendButton = screen.getByTestId('chat-send-button');
      expect(sendButton).not.toBeDisabled();

      // Click send
      fireEvent.click(sendButton);

      // onSend should be called with the processed files
      await waitFor(() => {
        expect(onSend).toHaveBeenCalledTimes(1);
      });

      // onSend receives the text (empty) and the processed file attachments from readFilesAsBase64
      expect(onSend).toHaveBeenCalledWith(
        '',
        [{ filename: 'test.txt', mimeType: 'text/plain', base64: 'dGVzdA==' }]
      );
    });
  });

  // --------------------------------------------------------------------------
  // Gap 7: Task menu in MessageBubble fires onSelectTask with correct taskId
  // --------------------------------------------------------------------------
  describe('MessageBubble task-menu interaction', () => {
    it('fires onSelectTask with correct taskId when a task card is clicked', () => {
      const onSelectTask = vi.fn();

      render(
        <MessageBubble
          message={taskMenuMessage}
          onSelectTask={onSelectTask}
        />
      );

      // Click on the "Build Roadmap" task card
      fireEvent.click(screen.getByTestId('task-card-build-roadmap'));

      expect(onSelectTask).toHaveBeenCalledTimes(1);
      expect(onSelectTask).toHaveBeenCalledWith('build-roadmap');

      // Click on the "Define Product" task card
      fireEvent.click(screen.getByTestId('task-card-define-product'));

      expect(onSelectTask).toHaveBeenCalledTimes(2);
      expect(onSelectTask).toHaveBeenCalledWith('define-product');
    });
  });

  // --------------------------------------------------------------------------
  // Gap 8: StructuredQuestionsRenderer in MessageBubble submits answers
  // --------------------------------------------------------------------------
  describe('MessageBubble structured questions submission', () => {
    it('calls onSubmitAnswers with formatted answers when submit is clicked', () => {
      const onSubmitAnswers = vi.fn();

      render(
        <MessageBubble
          message={questionsMessage}
          onSubmitAnswers={onSubmitAnswers}
        />
      );

      // Fill in answer for the first question
      const input1 = screen.getByTestId('answer-input-q1');
      fireEvent.change(input1, {
        target: { value: 'Reduces manual effort' },
      });

      // Fill in answer for the second question
      const input2 = screen.getByTestId('answer-input-q2');
      fireEvent.change(input2, {
        target: { value: 'Small business owners' },
      });

      // Submit button should be enabled
      const submitButton = screen.getByTestId('submit-answers-button');
      expect(submitButton).not.toBeDisabled();

      // Click submit
      fireEvent.click(submitButton);

      // onSubmitAnswers should be called with both answers. The callback
      // signature gained an optional second `files` parameter (undefined
      // when no files are attached to the answers).
      expect(onSubmitAnswers).toHaveBeenCalledTimes(1);
      expect(onSubmitAnswers).toHaveBeenCalledWith(
        [
          {
            id: 'q1',
            question: 'What problem does the product solve?',
            answer: 'Reduces manual effort',
          },
          {
            id: 'q2',
            question: 'Who is the target user?',
            answer: 'Small business owners',
          },
        ],
        undefined
      );
    });
  });
});

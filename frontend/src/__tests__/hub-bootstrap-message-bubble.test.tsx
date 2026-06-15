/**
 * Hub Bootstrap 1: MessageBubble Updates and Question Normalization Tests
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Task Group 4, Task 4.1: Write 6 focused tests for MessageBubble changes
 *
 * Tests verify:
 * - hasQuestions returns true when structuredResponse.questions is an array of plain strings
 * - extractQuestions normalizes plain string "Q1" into { id: 'q-0', question: 'Q1' } object format
 * - extractQuestions passes through existing { id, question } objects unchanged
 * - isArtifactPreview returns true for { type: 'artifact-preview', markdownContent: '...' }
 * - isCompletionChip returns true for { type: 'completion-chip', taskId: '...', personaId: '...', artifactName: '...' }
 * - MessageBubble renders ArtifactPreviewBubble when structuredResponse.type === 'artifact-preview' and onConfirmArtifact is provided
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from '../components/UnifiedChat/MessageBubble';
import type { ThreadMessage } from '../api/chatV2Api';

// Mock CSS modules
vi.mock('../components/UnifiedChat/MessageBubble.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../components/UnifiedChat/StructuredQuestionsRenderer.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../components/UnifiedChat/TaskMenu.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Import the internal helper functions from MessageBubble for direct unit testing.
 * Since these are non-exported module-level functions, we test them indirectly via
 * the component behavior. However, for hasQuestions and extractQuestions we render
 * a MessageBubble and check if the StructuredQuestionsRenderer appears.
 */

function createAssistantMessage(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: 'msg-test-1',
    role: 'assistant',
    personaId: 'product-manager',
    taskId: 'product-manager--define-product',
    content: 'Here are some questions:',
    structuredResponse: null,
    timestamp: '2026-02-28T10:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// Test 1: hasQuestions returns true for plain string arrays
// ============================================================================

describe('Hub Bootstrap 1: MessageBubble Updates', () => {
  it('hasQuestions returns true when structuredResponse.questions is an array of plain strings', () => {
    const message = createAssistantMessage({
      structuredResponse: {
        questions: ['Q1', 'Q2', 'Q3'],
      },
    });

    const mockOnSubmitAnswers = vi.fn();
    render(
      <MessageBubble
        message={message}
        onSubmitAnswers={mockOnSubmitAnswers}
      />
    );

    // If hasQuestions works correctly with plain strings, the StructuredQuestionsRenderer
    // should be rendered with data-testid="structured-questions"
    expect(screen.getByTestId('structured-questions')).toBeInTheDocument();
  });

  // ============================================================================
  // Test 2: extractQuestions normalizes plain strings to { id, question } objects
  // ============================================================================

  it('extractQuestions normalizes plain string "Q1" into { id: "q-0", question: "Q1" } object format', () => {
    const message = createAssistantMessage({
      structuredResponse: {
        questions: ['Q1', 'Q2'],
      },
    });

    const mockOnSubmitAnswers = vi.fn();
    render(
      <MessageBubble
        message={message}
        onSubmitAnswers={mockOnSubmitAnswers}
      />
    );

    // The StructuredQuestionsRenderer should render question rows with auto-generated IDs
    // It uses data-testid="question-row-{id}" pattern
    expect(screen.getByTestId('question-row-q-0')).toBeInTheDocument();
    expect(screen.getByTestId('question-row-q-1')).toBeInTheDocument();

    // The question text should be rendered
    expect(screen.getByText('Q1')).toBeInTheDocument();
    expect(screen.getByText('Q2')).toBeInTheDocument();
  });

  // ============================================================================
  // Test 3: extractQuestions passes through existing { id, question } objects unchanged
  // ============================================================================

  it('extractQuestions passes through existing { id, question } objects unchanged', () => {
    const message = createAssistantMessage({
      structuredResponse: {
        questions: [
          { id: 'custom-1', question: 'What is your vision?' },
          { id: 'custom-2', question: 'Who is the target audience?' },
        ],
      },
    });

    const mockOnSubmitAnswers = vi.fn();
    render(
      <MessageBubble
        message={message}
        onSubmitAnswers={mockOnSubmitAnswers}
      />
    );

    // Should use the original custom IDs, not auto-generated ones
    expect(screen.getByTestId('question-row-custom-1')).toBeInTheDocument();
    expect(screen.getByTestId('question-row-custom-2')).toBeInTheDocument();

    // Question text should be displayed
    expect(screen.getByText('What is your vision?')).toBeInTheDocument();
    expect(screen.getByText('Who is the target audience?')).toBeInTheDocument();
  });

  // ============================================================================
  // Test 4: isArtifactPreview returns true for artifact-preview type
  // ============================================================================

  it('isArtifactPreview returns true for { type: "artifact-preview", markdownContent: "..." }', () => {
    const message = createAssistantMessage({
      content: '',
      structuredResponse: {
        type: 'artifact-preview',
        markdownContent: '# MISSION.MD\n\nThis is the product mission.',
      },
    });

    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <MessageBubble
        message={message}
        onConfirmArtifact={mockOnConfirm}
        onRejectArtifact={mockOnReject}
      />
    );

    // When isArtifactPreview is true and onConfirmArtifact is provided,
    // the ArtifactPreviewBubble stub should render
    expect(screen.getByTestId('artifact-preview-bubble')).toBeInTheDocument();
  });

  // ============================================================================
  // Test 5: isCompletionChip returns true for completion-chip type
  // ============================================================================

  it('isCompletionChip returns true for { type: "completion-chip", taskId: "...", personaId: "...", artifactName: "..." }', () => {
    const message = createAssistantMessage({
      content: 'Product Definition complete.',
      structuredResponse: {
        type: 'completion-chip',
        taskId: 'product-manager--define-product',
        personaId: 'product-manager',
        artifactName: 'MISSION.MD',
        artifactId: 'mission-md',
        timestamp: '2026-02-28T12:00:00.000Z',
      },
    });

    const mockOnDownload = vi.fn();

    render(
      <MessageBubble
        message={message}
        onDownloadTranscript={mockOnDownload}
      />
    );

    // When isCompletionChip is true and onDownloadTranscript is provided,
    // the CompletionChip stub should render
    expect(screen.getByTestId('completion-chip')).toBeInTheDocument();
  });

  // ============================================================================
  // Test 6: MessageBubble renders ArtifactPreviewBubble when artifact-preview + onConfirmArtifact
  // ============================================================================

  it('MessageBubble renders ArtifactPreviewBubble when structuredResponse.type === "artifact-preview" and onConfirmArtifact is provided', () => {
    const markdownContent = '# Product Mission\n\nBuild an amazing product.';
    const message = createAssistantMessage({
      content: '',
      structuredResponse: {
        type: 'artifact-preview',
        markdownContent,
      },
    });

    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <MessageBubble
        message={message}
        onConfirmArtifact={mockOnConfirm}
        onRejectArtifact={mockOnReject}
        disabled={false}
        isConfirmingArtifact={false}
      />
    );

    // ArtifactPreviewBubble should be rendered
    const previewBubble = screen.getByTestId('artifact-preview-bubble');
    expect(previewBubble).toBeInTheDocument();

    // Should NOT render as a regular questions block
    expect(screen.queryByTestId('structured-questions')).not.toBeInTheDocument();
  });
});

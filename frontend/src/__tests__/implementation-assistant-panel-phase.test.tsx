/**
 * Tests for Phase Handling in ImplementationAssistantPanel
 *
 * Spec 2026-01-13: Implement Assistant Stage 2 - Phased Conversations
 * Task Group 3: Frontend Component Integration
 *
 * Tests that the component correctly passes phase values to the API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { ImplementationAssistantPanel } from '../components/ProductView/ImplementationAssistantPanel';
import { createEmptyContextState } from '../utils/contextStorage';

// Mock the chat API
vi.mock('../api/chatApi', async () => {
  const actual = await vi.importActual('../api/chatApi');
  return {
    ...actual,
    postChatMessage: vi.fn(),
  };
});

// Mock the ProductUiStateContext
vi.mock('../contexts/ProductUiStateContext', () => ({
  ProductUiStateProvider: ({ children }: { children: React.ReactNode }) => children,
  useProductUiState: () => ({
    getImplementChatState: vi.fn(() => null),
    setImplementChatState: vi.fn(),
    getLastImplementWorkItemId: vi.fn(() => null),
    setLastImplementWorkItemId: vi.fn(),
    getExpandedIds: vi.fn(() => new Set()),
    setExpandedIds: vi.fn(),
    toggleExpanded: vi.fn(),
  }),
  deriveProjectKey: (id: string) => id,
}));

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

import { postChatMessage } from '../api/chatApi';
import { renderWithProviders, makeTestProject } from '../test-utils/renderWithProviders';

describe('ImplementationAssistantPanel Phase Handling', () => {
  const defaultProps = {
    workItemId: 'WI-001',
    workItemTitle: 'Add user authentication',
    workItemType: 'Feature',
    workItemDescription: 'Implement OAuth2 authentication flow',
    projectId: 'my-project.json',
    contextState: createEmptyContextState(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleSend passes phase: "refine"', () => {
    it('should include phase: "refine" in context when sending normal chat message', async () => {
      (postChatMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        sessionId: 'session-123',
        assistant: { message: 'Response' },
      });

      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Help me clarify requirements' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));

      await waitFor(() => {
        expect(postChatMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Help me clarify requirements',
            context: expect.objectContaining({
              mode: 'implement_feature',
              intent: 'normal_chat',
              phase: 'refine',
            }),
          })
        );
      });
    });

    it('should consistently pass phase: "refine" for multiple consecutive chat messages', async () => {
      (postChatMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          sessionId: 'session-123',
          assistant: { message: 'First response' },
        })
        .mockResolvedValueOnce({
          sessionId: 'session-123',
          assistant: { message: 'Second response' },
        });

      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      // First message
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'First question' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));

      await waitFor(() => {
        expect(postChatMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({
              phase: 'refine',
            }),
          })
        );
      });

      // Second message
      fireEvent.change(input, { target: { value: 'Second question' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));

      await waitFor(() => {
        expect(postChatMessage).toHaveBeenCalledTimes(2);
        // Both calls should have phase: 'refine'
        const secondCall = (postChatMessage as ReturnType<typeof vi.fn>).mock.calls[1][0];
        expect(secondCall.context.phase).toBe('refine');
      });
    });
  });

  /*
   * The 'handleImplement passes phase: "handoff"' test was DELETED
   * 2026-06-12: clicking Implement no longer posts a second chat message
   * with phase 'handoff' -- the handoff goes through startOrchestrationJob
   * (jobs API) after the PM->TE refinement loop. The modern flow is covered
   * by ImplementButton.workflow.test.tsx and orchestrationApi.job.test.ts.
   */
  describe('buildContext function includes phase parameter', () => {
    it('should correctly structure context with both intent and phase for normal_chat', async () => {
      (postChatMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        sessionId: 'session-123',
        assistant: { message: 'Response' },
      });

      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Test message' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));

      await waitFor(() => {
        const call = (postChatMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
        const context = call.context;

        // Verify full context structure
        expect(context).toMatchObject({
          mode: 'implement_feature',
          intent: 'normal_chat',
          phase: 'refine',
          filename: 'my-project.json',
          workItem: {
            id: 'WI-001',
            title: 'Add user authentication',
            type: 'Feature',
            description: 'Implement OAuth2 authentication flow',
          },
          architectureContext: {
            entityIds: [],
            diagramIds: [],
          },
        });
      });
    });

    /*
     * The generate_specs/handoff variant was DELETED 2026-06-12 for the same
     * reason as above: the Implement click no longer routes through
     * postChatMessage, so there is no second call carrying intent
     * 'generate_specs' / phase 'handoff'.
     */
  });
});

/**
 * Tests for ImplementationAssistantPanel Chat Integration
 *
 * Spec 2026-01-09: Implement Chat - Planner Conversation Loop (Iteration 2)
 * Task Group 5: ImplementationAssistantPanel Chat Integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { ImplementationAssistantPanel } from '../components/ProductView/ImplementationAssistantPanel';
import { ContextState, createEmptyContextState } from '../utils/contextStorage';

// Mock the chat API
vi.mock('../api/chatApi', async () => {
  const actual = await vi.importActual('../api/chatApi');
  return {
    ...actual,
    postChatMessage: vi.fn(),
  };
});

// Mock ProductUiStateContext
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

import { postChatMessage } from '../api/chatApi';
import { renderWithProviders, makeTestProject } from '../test-utils/renderWithProviders';

describe('ImplementationAssistantPanel Chat Integration', () => {
  const defaultProps = {
    workItemId: 'WI-001',
    workItemTitle: 'Add user authentication',
    workItemType: 'Feature',
    workItemDescription: 'Implement OAuth2 authentication flow',
    projectId: 'my-project.json',
    contextState: createEmptyContextState(),
  };

  const contextWithRefs: ContextState = {
    version: 1,
    entity_refs: [
      { kind: 'ENTITY', entity_type: 'services', entity_id: 'SVC-001', label: 'Auth Service' },
      { kind: 'ENTITY', entity_type: 'applications', entity_id: 'APP-001', label: 'Web App' },
    ],
    diagram_refs: [
      { kind: 'DIAGRAM', diagram_id: 'DIA-001', label: 'Architecture Diagram' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Empty state', () => {
    it('should display empty state message when no messages', () => {
      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      const emptyStateText = screen.getByText(/Start a conversation to clarify this work item/i);
      expect(emptyStateText).toBeInTheDocument();
    });
  });

  describe('Component rendering', () => {
    it('should render the chat header with the Implementation Studio room', () => {
      // The old "Implementation Assistant" title header was replaced by the
      // split-layout chat header ("Chat - Room: Implementation Studio").
      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      expect(screen.getByText('Implementation Studio')).toBeInTheDocument();
    });

    it('should render ChatInput component', () => {
      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      const input = screen.getByRole('textbox', { name: /chat message input/i });
      expect(input).toBeInTheDocument();
    });

    it('should maintain data-testid attribute', () => {
      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      const panel = screen.getByTestId('implementation-assistant-panel');
      expect(panel).toBeInTheDocument();
    });
  });

  describe('Session management', () => {
    it('should initialize sessionId as null', async () => {
      (postChatMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        sessionId: 'new-session-123',
        assistant: { message: 'Hello! How can I help?' },
      });

      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      // Initially no messages
      expect(screen.getByText(/Start a conversation/i)).toBeInTheDocument();

      // Send a message
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Hello' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));

      // Wait for response
      await waitFor(() => {
        expect(screen.getByText('Hello! How can I help?')).toBeInTheDocument();
      });

      // The component should have received a sessionId from the response
      expect(postChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: undefined,
          message: 'Hello',
        })
      );
    });
  });

  describe('Work item change behavior', () => {
    it('should clear messages when workItemId changes', async () => {
      (postChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
        sessionId: 'session-123',
        assistant: { message: 'Response message' },
      });

      const { rerender } = renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      // Send a message
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Test message' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));

      // Wait for message to appear
      await waitFor(() => {
        expect(screen.getByText('Test message')).toBeInTheDocument();
      });

      // Change workItemId
      rerender(
        <ImplementationAssistantPanel
          {...defaultProps}
          workItemId="WI-002"
          workItemTitle="Different feature"
        />
      );

      // Messages should be cleared, showing empty state again
      await waitFor(() => {
        expect(screen.getByText(/Start a conversation/i)).toBeInTheDocument();
      });
    });
  });

  describe('Context construction', () => {
    it('should construct context with correct mode and intent', async () => {
      (postChatMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        sessionId: 'session-123',
        assistant: { message: 'Response' },
      });

      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Help me clarify' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));

      await waitFor(() => {
        expect(postChatMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Help me clarify',
            context: expect.objectContaining({
              mode: 'implement_feature',
              intent: 'normal_chat',
              workItem: expect.objectContaining({
                id: 'WI-001',
                title: 'Add user authentication',
                type: 'Feature',
                description: 'Implement OAuth2 authentication flow',
              }),
            }),
          })
        );
      });
    });

    it('should derive architectureContext from contextState entity_refs and diagram_refs', async () => {
      (postChatMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        sessionId: 'session-123',
        assistant: { message: 'Response' },
      });

      renderWithProviders(
        <ImplementationAssistantPanel
          {...defaultProps}
          contextState={contextWithRefs}
        />
      , { project: makeTestProject() });

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'What entities are linked?' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));

      await waitFor(() => {
        expect(postChatMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({
              // architectureContext now ALSO carries rich entities/diagrams
              // bundle descriptors; the id arrays are still present.
              architectureContext: expect.objectContaining({
                // entityIds are now type-qualified ("<entity_type>::<id>")
                entityIds: ['services::SVC-001', 'applications::APP-001'],
                diagramIds: ['DIA-001'],
              }),
            }),
          })
        );
      });
    });
  });

  describe('Message display', () => {
    it('should display user message immediately after sending', async () => {
      (postChatMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        sessionId: 'session-123',
        assistant: { message: 'Assistant response' },
      });

      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'My question' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));

      // User message should appear immediately
      await waitFor(() => {
        expect(screen.getByText('My question')).toBeInTheDocument();
      });
    });

    it('should display assistant response after API call completes', async () => {
      (postChatMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        sessionId: 'session-123',
        assistant: { message: 'I understand you want to add authentication.' },
      });

      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Help with auth' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));

      // Wait for assistant response
      await waitFor(() => {
        expect(screen.getByText('I understand you want to add authentication.')).toBeInTheDocument();
      });
    });
  });
});

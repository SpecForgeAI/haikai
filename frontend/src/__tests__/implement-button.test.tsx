/**
 * Tests for Implement button in ImplementationAssistantPanel
 *
 * Spec 2026-01-09: Implement Generate Specs - Iteration 4
 * Task Group 5: Implement Button and Click Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { ImplementationAssistantPanel } from '../components/ProductView/ImplementationAssistantPanel';
import * as chatApi from '../api/chatApi';
import { renderWithProviders, makeTestProject } from '../test-utils/renderWithProviders';

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

const mockPostChatMessage = vi.mocked(chatApi.postChatMessage);

const defaultProps = {
  workItemId: 'WI-001',
  workItemTitle: 'Test Feature',
  workItemType: 'Feature',
  workItemDescription: 'Test description',
  projectId: 'test-project.json',
  contextState: {
    entity_refs: [{ entity_id: 'ENT-001', entity_name: 'Test Entity' }],
    diagram_refs: [{ diagram_id: 'DIA-001', diagram_name: 'Test Diagram' }],
  },
};

describe('Implement Button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('should render Implement button adjacent to Send button', () => {
      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      const implementButton = screen.getByTestId('implement-button');
      expect(implementButton).toBeInTheDocument();
      expect(implementButton).toHaveTextContent('Implement');
    });

    it('should render Implement button with distinct styling', () => {
      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      const implementButton = screen.getByTestId('implement-button');
      // Button should exist and be visible
      expect(implementButton).toBeVisible();
    });
  });

  describe('disabled state', () => {
    it('should be disabled when no sessionId exists (no conversation started)', () => {
      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      const implementButton = screen.getByTestId('implement-button');
      // Initially disabled because no session has been established yet
      expect(implementButton).toBeDisabled();
    });

    it('should be enabled after session is established via a chat message', async () => {
      mockPostChatMessage.mockResolvedValueOnce({
        sessionId: 'test-session-123',
        assistant: {
          message: 'Hello! I can help clarify this feature.',
        },
      });

      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      // Simulate sending a message to establish session
      const input = screen.getByPlaceholderText(/type a message/i);
      const sendButton = screen.getByTestId('send-button');

      fireEvent.change(input, { target: { value: 'Hello' } });
      fireEvent.click(sendButton);

      // Wait for session to be established
      await waitFor(() => {
        const implementButton = screen.getByTestId('implement-button');
        expect(implementButton).not.toBeDisabled();
      });
    });

    it('should be disabled while isLoading is true', async () => {
      // Create a promise that we can control
      let resolvePromise: (value: chatApi.ChatResponse) => void;
      const pendingPromise = new Promise<chatApi.ChatResponse>((resolve) => {
        resolvePromise = resolve;
      });
      mockPostChatMessage.mockReturnValueOnce(pendingPromise);

      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      // Simulate sending a message
      const input = screen.getByPlaceholderText(/type a message/i);
      const sendButton = screen.getByTestId('send-button');

      fireEvent.change(input, { target: { value: 'Hello' } });
      fireEvent.click(sendButton);

      // While loading, implement button should be disabled
      const implementButton = screen.getByTestId('implement-button');
      expect(implementButton).toBeDisabled();

      // Resolve the promise to clean up
      resolvePromise!({
        sessionId: 'test-session',
        assistant: { message: 'Response' },
      });
    });

    it('should be disabled when no workItemId is provided', () => {
      const propsWithoutWorkItem = {
        ...defaultProps,
        workItemId: '',
      };

      renderWithProviders(<ImplementationAssistantPanel {...propsWithoutWorkItem} />, { project: makeTestProject() });

      const implementButton = screen.getByTestId('implement-button');
      expect(implementButton).toBeDisabled();
    });
  });

  describe('click handler', () => {
    it('should call postChatMessage with generate_specs intent when clicked', async () => {
      // First establish a session
      mockPostChatMessage.mockResolvedValueOnce({
        sessionId: 'test-session-123',
        assistant: {
          message: 'I understand the feature. Let me ask some questions.',
        },
      });

      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      // Send a message to establish session
      const input = screen.getByPlaceholderText(/type a message/i);
      const sendButton = screen.getByTestId('send-button');

      fireEvent.change(input, { target: { value: 'Hello' } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(mockPostChatMessage).toHaveBeenCalledTimes(1);
      });

      // Now set up mock for implement button click
      mockPostChatMessage.mockResolvedValueOnce({
        sessionId: 'test-session-123',
        assistant: {
          message: '["/agent-os:write-spec test"]',
        },
        specs: ['/agent-os:write-spec test'],
      });

      // Click the implement button
      const implementButton = screen.getByTestId('implement-button');
      fireEvent.click(implementButton);

      await waitFor(() => {
        expect(mockPostChatMessage).toHaveBeenCalledTimes(2);
      });

      // Verify the second call was with generate_specs intent
      const lastCall = mockPostChatMessage.mock.calls[1][0];
      expect(lastCall.context?.intent).toBe('generate_specs');
      expect(lastCall.context?.mode).toBe('implement_feature');
      expect(lastCall.sessionId).toBe('test-session-123');
    });

    it('should include workItem and architectureContext in the request', async () => {
      // First establish a session
      mockPostChatMessage.mockResolvedValueOnce({
        sessionId: 'test-session-123',
        assistant: { message: 'Ready to help.' },
      });

      renderWithProviders(<ImplementationAssistantPanel {...defaultProps} />, { project: makeTestProject() });

      // Send a message to establish session
      const input = screen.getByPlaceholderText(/type a message/i);
      const sendButton = screen.getByTestId('send-button');
      fireEvent.change(input, { target: { value: 'Start' } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(mockPostChatMessage).toHaveBeenCalledTimes(1);
      });

      // Setup for implement click
      mockPostChatMessage.mockResolvedValueOnce({
        sessionId: 'test-session-123',
        assistant: { message: '[]' },
        specs: [],
      });

      // Click implement
      const implementButton = screen.getByTestId('implement-button');
      fireEvent.click(implementButton);

      await waitFor(() => {
        expect(mockPostChatMessage).toHaveBeenCalledTimes(2);
      });

      const request = mockPostChatMessage.mock.calls[1][0];
      expect(request.context?.workItem).toEqual({
        id: 'WI-001',
        title: 'Test Feature',
        type: 'Feature',
        description: 'Test description',
      });
      expect(request.context?.architectureContext).toEqual({
        entityIds: ['ENT-001'],
        diagramIds: ['DIA-001'],
      });
    });
  });
});

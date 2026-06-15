/**
 * ImplementationAssistantPanel Split Layout Tests
 *
 * Spec 2026-01-22: Feature Shaping UI Consumes Planner JSON
 * Task Group 6: Update ImplementationAssistantPanel Layout and State
 *
 * Tests for:
 * - Split layout renders Feature Definition panel (65%) and Team Chat panel (35%)
 * - latestPlannerResponse state updates when valid plannerResponse received
 * - latestPlannerResponse preserves previous value when invalid response received
 * - Chat bubbles display only message field from plannerResponse
 * - Responsive behavior switches to stacked layout on tablet viewport
 * - Responsive behavior switches to tabs on mobile viewport
 *
 * Updated for Spec 2026-01-24: Split changed from 60/40 to 65/35
 * Updated for Spec 2026-01-25: "Description" section renamed to "Initial Description & Context"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ImplementationAssistantPanel } from '../components/ProductView/ImplementationAssistantPanel';
import * as chatApi from '../api/chatApi';
import type { PlannerResponse, ChatResponse } from '../api/chatApi';

// Mock the API modules
vi.mock('../api/chatApi', async () => {
  const actual = await vi.importActual('../api/chatApi');
  return {
    ...actual,
    postChatMessage: vi.fn(),
    getImplementConversation: vi.fn(),
  };
});

vi.mock('../api/orchestrationApi', async () => {
  const actual = await vi.importActual('../api/orchestrationApi');
  return {
    ...actual,
    startOrchestration: vi.fn(),
  };
});

vi.mock('../api/organisationsApi', async () => {
  const actual = await vi.importActual('../api/organisationsApi');
  return {
    ...actual,
    getOrganisationById: vi.fn().mockResolvedValue({ name: 'Test Org' }),
  };
});

// Mock contexts
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

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({
    name: 'Test Project',
    projectParentFolder: '/test/path',
    organisationId: 'org-123',
  }),
  useSetActiveProject: () => vi.fn(),
}));

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

describe('Task Group 6: ImplementationAssistantPanel Split Layout', () => {
  const defaultProps = {
    workItemId: 'work-item-1',
    workItemTitle: 'Test Feature',
    workItemType: 'Feature',
    workItemDescription: 'This is the test feature description',
    projectId: 'test-project.json',
    contextState: {
      entity_refs: [],
      diagram_refs: [],
    },
  };

  const mockPlannerResponse: PlannerResponse = {
    schemaVersion: '1.1',
    message: 'I understand your feature request.',
    featureUnderstanding: 'The feature enables user authentication via OAuth2.',
    scope: {
      in: ['OAuth2 login', 'Token refresh'],
      out: ['Social login'],
    },
    assumptions: ['Users have email'],
    acceptanceCriteria: ['User can log in'],
    openQuestions: [],
    plannerReadyForSpec: false,
    implementationPlan: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for getImplementConversation
    vi.mocked(chatApi.getImplementConversation).mockResolvedValue({
      exists: false,
      messages: [],
    });
    // Default mock for postChatMessage - return bootstrap response
    vi.mocked(chatApi.postChatMessage).mockResolvedValue({
      sessionId: 'session-123',
      assistant: {
        message: 'Welcome! How can I help you?',
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Test 6.1: Split layout renders Feature Definition and Team Chat panels', () => {
    it('should render the Feature Definition panel', async () => {
      render(<ImplementationAssistantPanel {...defaultProps} />);

      // Wait for bootstrap to complete
      await waitFor(() => {
        expect(screen.getByText('Feature:')).toBeInTheDocument();
      });

      // Feature header should show work item title
      expect(screen.getByText('Test Feature')).toBeInTheDocument();
    });

    it('should render the Team Chat header in the chat panel', async () => {
      const { container } = render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Feature:')).toBeInTheDocument();
      });

      // The chat header now reads "Chat" with the Implementation Studio room
      const chatHeaderTitle = container.querySelector('[class*="chatHeaderTitle"]');
      expect(chatHeaderTitle).toBeInTheDocument();
      expect(chatHeaderTitle?.textContent).toBe('Chat');
      expect(screen.getByText('Implementation Studio')).toBeInTheDocument();
    });

    it('should render Initial Description & Context section with workItemDescription', async () => {
      render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        // Spec 2026-01-25: Section renamed from "Description" to "Initial Description & Context"
        expect(screen.getByText('Initial Description & Context')).toBeInTheDocument();
      });

      expect(screen.getByText('This is the test feature description')).toBeInTheDocument();
    });
  });

  describe('Test 6.2: latestPlannerResponse state updates when valid plannerResponse received', () => {
    it('should update Feature Definition when plannerResponse is received', async () => {
      const responseWithPlanner: ChatResponse = {
        sessionId: 'session-456',
        assistant: {
          message: mockPlannerResponse.message,
        },
        plannerResponse: mockPlannerResponse,
      };

      // First call returns bootstrap, second returns plannerResponse
      vi.mocked(chatApi.postChatMessage)
        .mockResolvedValueOnce({
          sessionId: 'session-123',
          assistant: { message: 'Welcome!' },
        })
        .mockResolvedValueOnce(responseWithPlanner);

      render(<ImplementationAssistantPanel {...defaultProps} />);

      // Wait for bootstrap
      await waitFor(() => {
        expect(screen.getByText('Welcome!')).toBeInTheDocument();
      });

      // Type a message and send
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Tell me more' } });

      const sendButton = screen.getByTestId('send-button');
      fireEvent.click(sendButton);

      // Wait for response with plannerResponse
      await waitFor(() => {
        expect(screen.getByText('The feature enables user authentication via OAuth2.')).toBeInTheDocument();
      });

      // Scope should be visible
      expect(screen.getByText('OAuth2 login')).toBeInTheDocument();
    });
  });

  describe('Test 6.3: latestPlannerResponse preserves previous value on invalid response', () => {
    it('should preserve previous plannerResponse when new response lacks plannerResponse', async () => {
      const responseWithPlanner: ChatResponse = {
        sessionId: 'session-456',
        assistant: { message: mockPlannerResponse.message },
        plannerResponse: mockPlannerResponse,
      };

      const responseWithoutPlanner: ChatResponse = {
        sessionId: 'session-456',
        assistant: { message: 'Got it, anything else?' },
        // No plannerResponse
      };

      vi.mocked(chatApi.postChatMessage)
        .mockResolvedValueOnce({
          sessionId: 'session-123',
          assistant: { message: 'Welcome!' },
        })
        .mockResolvedValueOnce(responseWithPlanner)
        .mockResolvedValueOnce(responseWithoutPlanner);

      render(<ImplementationAssistantPanel {...defaultProps} />);

      // Wait for bootstrap
      await waitFor(() => {
        expect(screen.getByText('Welcome!')).toBeInTheDocument();
      });

      // Send first message to get plannerResponse
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'First message' } });
      fireEvent.click(screen.getByTestId('send-button'));

      await waitFor(() => {
        expect(screen.getByText('The feature enables user authentication via OAuth2.')).toBeInTheDocument();
      });

      // Send second message without plannerResponse
      fireEvent.change(textarea, { target: { value: 'Second message' } });
      fireEvent.click(screen.getByTestId('send-button'));

      await waitFor(() => {
        expect(screen.getByText('Got it, anything else?')).toBeInTheDocument();
      });

      // Previous plannerResponse should still be displayed
      expect(screen.getByText('The feature enables user authentication via OAuth2.')).toBeInTheDocument();
    });
  });

  describe('Test 6.4: Chat bubbles display only message field from plannerResponse', () => {
    it('should display only the message field in chat bubble, not structured content', async () => {
      const responseWithPlanner: ChatResponse = {
        sessionId: 'session-456',
        assistant: { message: 'Fallback message' },
        plannerResponse: mockPlannerResponse,
      };

      vi.mocked(chatApi.postChatMessage)
        .mockResolvedValueOnce({
          sessionId: 'session-123',
          assistant: { message: 'Welcome!' },
        })
        .mockResolvedValueOnce(responseWithPlanner);

      render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Welcome!')).toBeInTheDocument();
      });

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Test message' } });
      fireEvent.click(screen.getByTestId('send-button'));

      // Should see plannerResponse.message in chat
      await waitFor(() => {
        expect(screen.getByText('I understand your feature request.')).toBeInTheDocument();
      });

      // The featureUnderstanding should appear in Feature Definition, not as duplicate chat content
      // Note: featureUnderstanding appears once in Feature Definition panel
      const understandingElements = screen.getAllByText('The feature enables user authentication via OAuth2.');
      expect(understandingElements.length).toBe(1); // Only in Feature Definition, not in chat
    });
  });

  describe('Test 6.5: Responsive behavior - tablet viewport', () => {
    it('should have split panel container with appropriate data attribute', async () => {
      const { container } = render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Feature:')).toBeInTheDocument();
      });

      // Check for split panel container
      const splitContainer = container.querySelector('[class*="splitContainer"]');
      expect(splitContainer).toBeInTheDocument();
    });
  });

  describe('Test 6.6: Mobile tab behavior', () => {
    it('should render tab buttons for mobile view', async () => {
      render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Feature:')).toBeInTheDocument();
      });

      // Look for mobile tab buttons
      const featureTab = screen.queryByTestId('mobile-tab-feature');
      const chatTab = screen.queryByTestId('mobile-tab-chat');

      // Tabs should exist (visible on mobile via CSS)
      expect(featureTab).toBeInTheDocument();
      expect(chatTab).toBeInTheDocument();
    });

    it('should switch active panel when mobile tab is clicked', async () => {
      render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Feature:')).toBeInTheDocument();
      });

      // Click on Chat tab
      const chatTab = screen.getByTestId('mobile-tab-chat');
      fireEvent.click(chatTab);

      // The chat panel should now be active (visible)
      // This is controlled by activeTab state
      expect(chatTab).toHaveClass(/activeTab/);
    });
  });
});

/**
 * ImplementationAssistantPanel Information Density Tests
 *
 * Spec 2026-01-24: Implement Screen Information Density
 * Task Group 8: Test Review and Gap Analysis
 *
 * Tests for:
 * - Task Group 1: Header removal - FeatureHeader is topmost element
 * - Task Group 2: Chat composer relocated to RHS panel only
 * - Task Group 3: Implement button relocated to LHS footer
 * - Additional structure validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ImplementationAssistantPanel } from '../components/ProductView/ImplementationAssistantPanel';
import * as chatApi from '../api/chatApi';

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

describe('Spec 2026-01-24: Implement Screen Information Density', () => {
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
    epicName: 'Test Epic',
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

  describe('Task Group 1: Header Removal', () => {
    it('should NOT render "Implementation Assistant" header text', async () => {
      render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Feature:')).toBeInTheDocument();
      });

      // The header bar with "Implementation Assistant" should no longer exist
      expect(screen.queryByTestId('implementation-assistant-title')).not.toBeInTheDocument();
      expect(screen.queryByText('Implementation Assistant')).not.toBeInTheDocument();
    });

    it('should have FeatureHeader as the topmost content element in Feature panel', async () => {
      const { container } = render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Feature:')).toBeInTheDocument();
      });

      // Check that Feature: label is present (from FeatureHeader)
      const featureLabel = screen.getByText('Feature:');
      expect(featureLabel).toBeInTheDocument();

      // Check that split container contains the feature panel
      const splitContainer = container.querySelector('[class*="splitContainer"]');
      expect(splitContainer).toBeInTheDocument();
    });
  });

  describe('Task Group 2: Chat Composer Relocation to RHS', () => {
    it('should render textarea inside Team Chat panel', async () => {
      render(<ImplementationAssistantPanel {...defaultProps} />);

      // The chat header now reads "Chat - Room: Implementation Studio"
      await waitFor(() => {
        expect(screen.getByText('Implementation Studio')).toBeInTheDocument();
      });

      // Textarea should be present
      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveAttribute('placeholder', 'Type a message...');
    });

    it('should render Send button inside Team Chat panel', async () => {
      render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Implementation Studio')).toBeInTheDocument();
      });

      // Send button should be present
      const sendButton = screen.getByTestId('send-button');
      expect(sendButton).toBeInTheDocument();
      expect(sendButton).toHaveTextContent('Send');
    });

    it('should allow typing and sending messages from RHS panel', async () => {
      render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Welcome! How can I help you?')).toBeInTheDocument();
      });

      // Type a message
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Test message' } });
      expect(textarea).toHaveValue('Test message');

      // Click send
      const sendButton = screen.getByTestId('send-button');
      fireEvent.click(sendButton);

      // User message should appear
      await waitFor(() => {
        expect(screen.getByText('Test message')).toBeInTheDocument();
      });
    });
  });

  describe('Task Group 3: Implement Button Relocation to LHS Footer', () => {
    it('should render feature footer in Feature Definition panel', async () => {
      const { container } = render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Feature:')).toBeInTheDocument();
      });

      // Feature footer (the data-testid was dropped; locate by class)
      const featureFooter = container.querySelector('[class*="featureFooter"]');
      expect(featureFooter).toBeInTheDocument();
    });

    it('should render Implement button inside feature footer', async () => {
      render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Feature:')).toBeInTheDocument();
      });

      // Implement button should be present
      const implementButton = screen.getByTestId('implement-button');
      expect(implementButton).toBeInTheDocument();
      expect(implementButton).toHaveTextContent('Implement');
    });

    it('should NOT render Implement button in the RHS button row', async () => {
      const { container } = render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Implementation Studio')).toBeInTheDocument();
      });

      // The button row in RHS should only contain Send (the chat panel is
      // located by class since the team-chat-panel testid was dropped)
      const chatPanel = container.querySelector('[class*="chatPanel"]');
      expect(chatPanel).toBeInTheDocument();

      const buttonsInChatPanel = chatPanel!.querySelectorAll('button');
      const buttonTexts = Array.from(buttonsInChatPanel).map(b => b.textContent);

      // Send should be there; Implement must NOT be
      expect(buttonTexts.some(t => t === 'Send')).toBe(true);
      expect(buttonTexts.some(t => t === 'Implement')).toBe(false);
    });
  });

  describe('Layout Structure Validation', () => {
    it('should render split container with Feature panel (65%) and Chat panel (35%)', async () => {
      const { container } = render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Feature:')).toBeInTheDocument();
      });

      // Split container
      const splitContainer = container.querySelector('[class*="splitContainer"]');
      expect(splitContainer).toBeInTheDocument();

      // Feature panel (located by class -- panel testids were dropped)
      const featurePanel = container.querySelector('[class*="featurePanel"]');
      expect(featurePanel).toBeInTheDocument();

      // Chat panel
      const chatPanel = container.querySelector('[class*="chatPanel"]');
      expect(chatPanel).toBeInTheDocument();
    });

    it('should render mobile tab buttons', async () => {
      render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Feature:')).toBeInTheDocument();
      });

      // Mobile tabs should exist
      const featureTab = screen.getByTestId('mobile-tab-feature');
      const chatTab = screen.getByTestId('mobile-tab-chat');

      expect(featureTab).toBeInTheDocument();
      expect(chatTab).toBeInTheDocument();
    });

    it('should switch tabs when mobile tab buttons are clicked', async () => {
      render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Feature:')).toBeInTheDocument();
      });

      // Click Chat tab
      const chatTab = screen.getByTestId('mobile-tab-chat');
      fireEvent.click(chatTab);

      // Chat tab should now be active
      expect(chatTab.className).toMatch(/activeTab/);

      // Click Feature tab
      const featureTab = screen.getByTestId('mobile-tab-feature');
      fireEvent.click(featureTab);

      // Feature tab should now be active
      expect(featureTab.className).toMatch(/activeTab/);
    });
  });

  describe('Epic Name Display', () => {
    it('should display epic name in FeatureHeader when provided', async () => {
      render(<ImplementationAssistantPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Feature:')).toBeInTheDocument();
      });

      // Epic label should be present
      expect(screen.getByText('Epic:')).toBeInTheDocument();
      expect(screen.getByText('Test Epic')).toBeInTheDocument();
    });

    it('should not display epic section when epicName is undefined', async () => {
      const propsWithoutEpic = { ...defaultProps, epicName: undefined };
      render(<ImplementationAssistantPanel {...propsWithoutEpic} />);

      await waitFor(() => {
        expect(screen.getByText('Feature:')).toBeInTheDocument();
      });

      // Epic label should not be present
      expect(screen.queryByText('Epic:')).not.toBeInTheDocument();
    });
  });
});

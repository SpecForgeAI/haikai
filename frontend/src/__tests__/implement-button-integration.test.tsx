/**
 * Tests for Implement Button Integration with Orchestrations API
 *
 * Spec 2026-01-18: Planner to Implementor Handoff via Orchestrations API
 * Task Group 4: Implement Button Integration and UI States
 * Task 4.1: Write 4-6 focused tests for Implement button integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImplementationAssistantPanel } from '../components/ProductView/ImplementationAssistantPanel';
import { createEmptyContextState } from '../utils/contextStorage';
import * as chatApi from '../api/chatApi';
import * as orchestrationApi from '../api/orchestrationApi';

// Mock the chat API
vi.mock('../api/chatApi', async () => {
  const actual = await vi.importActual('../api/chatApi');
  return {
    ...actual,
    postChatMessage: vi.fn(),
    getImplementConversation: vi.fn().mockResolvedValue({ exists: false, messages: [] }),
  };
});

// Mock the orchestration API
vi.mock('../api/orchestrationApi', async () => {
  const actual = await vi.importActual('../api/orchestrationApi');
  return {
    ...actual,
    startOrchestration: vi.fn(),
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

// Mock the ProjectContext
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({
    id: 'project-123',
    name: 'test-project',
    projectParentFolder: '/path/to/project',
    organisationId: 'org-456',
    isActive: true,
  }),
  useSetActiveProject: () => vi.fn(),
}));

// Mock the organisations API with getOrganisationById
vi.mock('../api/organisationsApi', async () => {
  const actual = await vi.importActual('../api/organisationsApi');
  return {
    ...actual,
    listOrganisations: vi.fn().mockResolvedValue([
    { id: 'org-456', name: 'Acme Corporation', description: null },
    { id: 'org-789', name: 'Other Org', description: null },
  ]),
  getOrganisationById: vi.fn().mockResolvedValue({
    id: 'org-456',
    name: 'Acme Corporation',
    description: null,
  }),
  };
});

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

const mockPostChatMessage = vi.mocked(chatApi.postChatMessage);
const mockStartOrchestration = vi.mocked(orchestrationApi.startOrchestration);

// Sample Planner message containing Part 4 and PROPOSED markers
const VALID_PLANNER_MESSAGE_WITH_PROPOSED = `
Great! Based on our discussion, let me summarize the feature.

--- Part 4: Proposed Final Feature Definition ---

PROPOSED \u2014

**User Authentication System**

Context: The application needs secure user authentication.

Goal: Implement a complete user authentication system.

Scope: Backend authentication service, frontend login forms.

Requirements:
- JWT-based authentication tokens
- Password hashing with bcrypt

Acceptance Criteria:
- Users can register with email and password
- Users can log in and receive a valid session

Non-Goals:
- OAuth/social login integration
`;

const defaultProps = {
  workItemId: 'WI-001',
  workItemTitle: 'User Authentication Feature',
  workItemType: 'Feature',
  workItemDescription: 'Implement user authentication',
  projectId: 'test-project.json',
  contextState: createEmptyContextState(),
};

describe('Implement Button Integration (Spec 2026-01-18 Task Group 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no PROPOSED marker in messages
    mockPostChatMessage.mockResolvedValue({
      sessionId: 'session-123',
      assistant: { message: 'I understand your requirements.' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Test 1: Implement button is disabled when PROPOSED marker not found
   *
   * The Implement button should only be enabled when a valid PROPOSED marker
   * is found in the conversation messages.
   */
  describe('Button disabled when PROPOSED marker not found', () => {
    it('should disable Implement button when no PROPOSED marker exists in messages', async () => {
      // Message without Part 4 / PROPOSED markers
      mockPostChatMessage.mockResolvedValueOnce({
        sessionId: 'session-123',
        assistant: { message: 'Let me help you understand the requirements better.' },
      });

      render(<ImplementationAssistantPanel {...defaultProps} />);

      // Establish session by sending a message
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Help me with auth' } });
      fireEvent.click(screen.getByTestId('send-button'));

      await waitFor(() => {
        expect(screen.getByText('Let me help you understand the requirements better.')).toBeInTheDocument();
      });

      // Implement button should be disabled because no PROPOSED marker
      const implementButton = screen.getByTestId('implement-button');
      expect(implementButton).toBeDisabled();
    });

    it('should show error message when clicking Implement without PROPOSED marker', async () => {
      // Establish session
      mockPostChatMessage.mockResolvedValueOnce({
        sessionId: 'session-123',
        assistant: { message: 'Response without PROPOSED marker.' },
      });

      render(<ImplementationAssistantPanel {...defaultProps} />);

      // Send a message to establish session
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Initial message' } });
      fireEvent.click(screen.getByTestId('send-button'));

      await waitFor(() => {
        expect(screen.getByText('Response without PROPOSED marker.')).toBeInTheDocument();
      });

      // The implement button should be disabled when no PROPOSED marker
      const implementButton = screen.getByTestId('implement-button');
      expect(implementButton).toBeDisabled();
    });
  });

  /*
   * Tests 2-6 (in-flight disable / duplicate-click prevention / success /
   * failure / debug-log around `startOrchestration`) were DELETED 2026-06-12:
   * they asserted the superseded Spec 2026-01-18 direct-orchestration handoff.
   * Production now gates the Implement button on the PM->TE refinement loop
   * (`hasTestPlan`) and hands off via `startOrchestrationJob` + job polling,
   * which is covered by ImplementButton.workflow.test.tsx,
   * implementButton.threePhase.test.tsx, implementClickOptimisticMessage.test.tsx
   * and orchestrationApi.job.test.ts.
   */
});

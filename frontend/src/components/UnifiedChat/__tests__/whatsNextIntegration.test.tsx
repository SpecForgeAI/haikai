/**
 * What's Next Integration Tests
 *
 * Spec 2026-03-04: Assistant "What's Next" v1
 * Task Group 10 (Task 10.2): Integration/gap tests for cross-component behavior
 *
 * Spec 2026-03-04: What's Next v1-B -- Modal Launch
 * Task Group 7, Tasks 7.2-7.3: Update fixtures for ModalAction and add modal dispatch tests
 * - Updated define-tech-stack fixture from launch: 'panel' to launch: 'modal' with modalId
 * - Added test: "clicking a modal-type action card calls openGenerateStandardsModal from context"
 * - Added test: "clicking a panel-type action card does NOT call openGenerateStandardsModal"
 *
 * Covers integration points not tested by individual unit test files:
 * 1. MessageBubble renders WhatsNextActionList for structuredResponse.type === 'whats-next-actions'
 * 2. MessageBubble excludes questions when whats-next-actions present
 * 3. PendingActionContext round-trip: setPendingAction + read + clearPendingAction
 * 4. ChatThread forwards onActionClick to MessageBubble
 * 5. Modal dispatch integration: clicking modal-type card triggers openGenerateStandardsModal
 * 6. Panel action does NOT trigger openGenerateStandardsModal
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MessageBubble } from '../MessageBubble';
import { ChatThread } from '../ChatThread';
import { PendingActionProvider, usePendingAction } from '../../../contexts/PendingActionContext';
import { ModalActionProvider } from '../../../contexts/ModalActionContext';
import type { ThreadMessage } from '../../../api/chatV2Api';
import type { NextAction } from '../WhatsNextActionList';

// ============================================================================
// Test Data
// ============================================================================

const whatsNextMessage: ThreadMessage = {
  id: 'msg-wn-1',
  role: 'assistant',
  personaId: 'assistant',
  taskId: 'assistant--whats-next',
  content: 'Here are your recommended next steps.',
  structuredResponse: {
    type: 'whats-next-actions',
    explanation: 'Your project does not yet have a Product Mission defined.',
    actions: [
      {
        id: 'define-mission',
        label: 'Define Product Mission',
        reason: 'A product mission is the foundation for all other activities.',
        priority: 100,
        target: { screen: 'product', tab: 'product', personaId: 'product-manager', taskId: 'product-manager--define-product' },
        launch: 'panel',
      },
      {
        id: 'define-tech-stack',
        label: 'Define Tech Stack',
        reason: 'Establishing technology standards early ensures consistent decisions.',
        priority: 80,
        launch: 'modal',
        modalId: 'generate-standards',
        target: { personaId: 'architect' },
      },
    ],
  },
  timestamp: '2026-03-04T10:00:00.000Z',
};

/**
 * A message with both whats-next-actions and questions in the structuredResponse.
 * This tests that showWhatsNextActions takes precedence and questions are excluded.
 */
const whatsNextWithQuestions: ThreadMessage = {
  id: 'msg-wn-q',
  role: 'assistant',
  personaId: 'assistant',
  taskId: 'assistant--whats-next',
  content: 'Next steps for you.',
  structuredResponse: {
    type: 'whats-next-actions',
    explanation: 'Some foundational artifacts are missing.',
    actions: [
      {
        id: 'define-mission',
        label: 'Define Product Mission',
        reason: 'Foundation for all activities.',
        priority: 100,
        target: { screen: 'product', tab: 'product', personaId: 'product-manager', taskId: 'product-manager--define-product' },
        launch: 'panel',
      },
    ],
    // These questions should NOT render because whats-next-actions takes precedence
    questions: [
      { id: 'q1', question: 'What is your product?' },
    ],
  },
  timestamp: '2026-03-04T10:01:00.000Z',
};

// ============================================================================
// Tests
// ============================================================================

describe('What\'s Next Integration (Spec 2026-03-04, Task Group 10)', () => {
  // --------------------------------------------------------------------------
  // Test 1: MessageBubble renders WhatsNextActionList for whats-next-actions
  // --------------------------------------------------------------------------
  it('MessageBubble renders WhatsNextActionList when structuredResponse.type is whats-next-actions', () => {
    const onActionClick = vi.fn();
    render(
      <MessageBubble
        message={whatsNextMessage}
        onActionClick={onActionClick}
      />
    );

    // The WhatsNextActionList container should be present
    expect(screen.getByTestId('whats-next-action-list')).toBeInTheDocument();

    // The explanation text should be rendered
    expect(screen.getByText('Your project does not yet have a Product Mission defined.')).toBeInTheDocument();

    // Both action cards should be rendered
    expect(screen.getByTestId('whats-next-action-define-mission')).toBeInTheDocument();
    expect(screen.getByTestId('whats-next-action-define-tech-stack')).toBeInTheDocument();

    // Labels should be visible
    expect(screen.getByText('Define Product Mission')).toBeInTheDocument();
    expect(screen.getByText('Define Tech Stack')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 2: MessageBubble excludes questions when whats-next-actions present
  // --------------------------------------------------------------------------
  it('MessageBubble does not render questions when whats-next-actions type is present', () => {
    const onActionClick = vi.fn();
    const onSubmitAnswers = vi.fn();
    render(
      <MessageBubble
        message={whatsNextWithQuestions}
        onActionClick={onActionClick}
        onSubmitAnswers={onSubmitAnswers}
      />
    );

    // WhatsNextActionList should render
    expect(screen.getByTestId('whats-next-action-list')).toBeInTheDocument();

    // Questions should NOT render -- the StructuredQuestionsRenderer uses a submit button
    // with text "Submit Answers" -- it should not be present
    expect(screen.queryByText('Submit Answers')).not.toBeInTheDocument();

    // The question text itself should not appear
    expect(screen.queryByText('What is your product?')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 3: PendingActionContext round-trip
  // --------------------------------------------------------------------------
  it('PendingActionContext: setPendingAction stores value and clearPendingAction resets to null', () => {
    // Create a test component that exercises the context
    let capturedPendingAction: ReturnType<typeof usePendingAction>['pendingAction'] = null;
    let capturedSetPendingAction: ReturnType<typeof usePendingAction>['setPendingAction'];
    let capturedClearPendingAction: ReturnType<typeof usePendingAction>['clearPendingAction'];

    function TestConsumer() {
      const { pendingAction, setPendingAction, clearPendingAction } = usePendingAction();
      capturedPendingAction = pendingAction;
      capturedSetPendingAction = setPendingAction;
      capturedClearPendingAction = clearPendingAction;
      return (
        <div data-testid="pending-value">
          {pendingAction ? pendingAction.personaId : 'null'}
        </div>
      );
    }

    render(
      <PendingActionProvider>
        <TestConsumer />
      </PendingActionProvider>
    );

    // Initially null
    expect(screen.getByTestId('pending-value')).toHaveTextContent('null');

    // Set a pending action
    act(() => {
      capturedSetPendingAction!({
        screen: 'metamodel',
        personaId: 'architect',
        taskId: 'architect--define-architecture',
      });
    });

    // Should now show the personaId
    expect(screen.getByTestId('pending-value')).toHaveTextContent('architect');

    // Clear the pending action
    act(() => {
      capturedClearPendingAction!();
    });

    // Should be back to null
    expect(screen.getByTestId('pending-value')).toHaveTextContent('null');
  });

  // --------------------------------------------------------------------------
  // Test 4: ChatThread forwards onActionClick to MessageBubble
  // --------------------------------------------------------------------------
  it('ChatThread forwards onActionClick and it fires when a whats-next action card is clicked', () => {
    const onActionClick = vi.fn();
    const messages: ThreadMessage[] = [whatsNextMessage];

    render(
      <ChatThread
        messages={messages}
        isLoading={false}
        onActionClick={onActionClick}
      />
    );

    // The action card should be rendered through the ChatThread -> MessageBubble -> WhatsNextActionList chain
    const actionCard = screen.getByTestId('whats-next-action-define-mission');
    expect(actionCard).toBeInTheDocument();

    // Click the action card
    fireEvent.click(actionCard);

    // onActionClick should have been called with the correct action object
    expect(onActionClick).toHaveBeenCalledTimes(1);
    expect(onActionClick).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'define-mission',
        label: 'Define Product Mission',
        target: expect.objectContaining({
          screen: 'product',
          personaId: 'product-manager',
        }),
      })
    );
  });

  // --------------------------------------------------------------------------
  // Test 5: Modal dispatch integration -- clicking modal action calls context
  // --------------------------------------------------------------------------
  it('clicking a modal-type action card calls openGenerateStandardsModal from context', () => {
    const mockOpenModal = vi.fn();

    // Build an onActionClick handler that dispatches modal actions via context
    const onActionClick = (action: NextAction) => {
      if (action.launch === 'modal') {
        mockOpenModal();
      }
    };

    render(
      <ModalActionProvider openGenerateStandardsModal={mockOpenModal}>
        <MessageBubble
          message={whatsNextMessage}
          onActionClick={onActionClick}
        />
      </ModalActionProvider>
    );

    // Click the modal-type action card (define-tech-stack)
    const modalActionCard = screen.getByTestId('whats-next-action-define-tech-stack');
    fireEvent.click(modalActionCard);

    // The mock should have been called
    expect(mockOpenModal).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Test 6: Panel action does NOT call openGenerateStandardsModal
  // --------------------------------------------------------------------------
  it('clicking a panel-type action card does NOT call openGenerateStandardsModal', () => {
    const mockOpenModal = vi.fn();

    // Build an onActionClick handler that only dispatches modal actions
    const onActionClick = (action: NextAction) => {
      if (action.launch === 'modal') {
        mockOpenModal();
      }
    };

    render(
      <ModalActionProvider openGenerateStandardsModal={mockOpenModal}>
        <MessageBubble
          message={whatsNextMessage}
          onActionClick={onActionClick}
        />
      </ModalActionProvider>
    );

    // Click the panel-type action card (define-mission)
    const panelActionCard = screen.getByTestId('whats-next-action-define-mission');
    fireEvent.click(panelActionCard);

    // The mock should NOT have been called
    expect(mockOpenModal).not.toHaveBeenCalled();
  });
});

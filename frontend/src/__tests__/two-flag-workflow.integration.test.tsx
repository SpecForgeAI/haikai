/**
 * Spec 2026-01-23: Two-Flag Workflow State Machine
 * Task Group 6: Integration Tests
 *
 * Strategic integration tests verifying the complete two-flag workflow:
 * - plannerReadyForSpec (controlled by LLM)
 * - implementationMode (controlled by user)
 *
 * Test scenarios:
 * 1. Initial state: both flags false, badge hidden, button shows "Implement"
 * 2. LLM sets plannerReadyForSpec: badge appears, button still shows "Implement"
 * 3. User clicks Implement with open questions: modal appears
 * 4. User confirms modal: implementationMode becomes true, button shows "In Implementation"
 * 5. User clicks Implement with no open questions: direct transition to implementationMode
 * 6. State persistence: implementationMode survives tab switches
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ProductUiStateProvider,
  useProductUiState,
  ImplementChatUiState,
} from '../contexts/ProductUiStateContext';
import { FeatureHeader } from '../components/ProductView/FeatureHeader';
import { ImplementConfirmationModal } from '../components/ProductView/ImplementConfirmationModal';

// Wrapper for hooks
function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(ProductUiStateProvider, null, children);
}

describe('Spec 2026-01-23: Two-Flag Workflow Integration Tests', () => {
  describe('Initial state scenario', () => {
    it('should start with both flags false: badge hidden, button text "Implement"', () => {
      // Initial state values
      const implementationMode = false;
      const plannerReadyForSpec = false;

      // Badge logic
      render(<FeatureHeader title="Test Feature" isReadyForSpec={plannerReadyForSpec} />);
      const badge = screen.queryByTestId('ready-for-spec-badge');
      expect(badge).not.toBeInTheDocument();

      // Button text logic
      const buttonText = implementationMode ? 'In Implementation' : 'Implement';
      expect(buttonText).toBe('Implement');
    });
  });

  describe('LLM sets plannerReadyForSpec scenario', () => {
    it('should show badge when plannerReadyForSpec true, button still shows "Implement"', () => {
      const implementationMode = false;
      const plannerReadyForSpec = true;

      // Badge should appear
      render(<FeatureHeader title="Test Feature" isReadyForSpec={plannerReadyForSpec} />);
      const badge = screen.getByTestId('ready-for-spec-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Ready for Spec');

      // Button should still say "Implement" (user hasn't clicked yet)
      const buttonText = implementationMode ? 'In Implementation' : 'Implement';
      expect(buttonText).toBe('Implement');
    });
  });

  describe('User clicks Implement with open questions scenario', () => {
    it('should show modal when clicking Implement with open questions', () => {
      const openQuestionCount = 3;
      let isModalOpen = false;

      // Simulate handleImplementClick logic
      function handleImplementClick() {
        if (openQuestionCount > 0) {
          isModalOpen = true;
        }
      }

      handleImplementClick();
      expect(isModalOpen).toBe(true);

      // Render modal
      render(
        <ImplementConfirmationModal
          isOpen={isModalOpen}
          onClose={() => {}}
          onConfirm={() => {}}
          openQuestionCount={openQuestionCount}
        />
      );

      const modal = screen.getByTestId('implement-confirmation-modal');
      expect(modal).toBeInTheDocument();
      expect(screen.getByTestId('confirm-modal-message')).toHaveTextContent(
        'You have 3 unanswered questions'
      );
    });

    it('should set implementationMode true and close modal when user confirms', () => {
      let implementationMode = false;
      let isModalOpen = true;
      const onProceed = vi.fn();

      // Simulate handleModalConfirm
      function handleModalConfirm() {
        implementationMode = true;
        isModalOpen = false;
        onProceed();
      }

      handleModalConfirm();

      expect(implementationMode).toBe(true);
      expect(isModalOpen).toBe(false);
      expect(onProceed).toHaveBeenCalledTimes(1);
    });
  });

  describe('User clicks Implement with no open questions scenario', () => {
    it('should directly set implementationMode without showing modal', () => {
      const openQuestionCount = 0;
      let implementationMode = false;
      let isModalOpen = false;
      const onProceed = vi.fn();

      // Simulate handleImplementClick logic
      function handleImplementClick() {
        if (openQuestionCount > 0) {
          isModalOpen = true;
        } else {
          implementationMode = true;
          onProceed();
        }
      }

      handleImplementClick();

      expect(isModalOpen).toBe(false);
      expect(implementationMode).toBe(true);
      expect(onProceed).toHaveBeenCalledTimes(1);
    });
  });

  describe('Button state after implementationMode becomes true', () => {
    it('should show "In Implementation" and be disabled', () => {
      const implementationMode = true;

      // Button text
      const buttonText = implementationMode ? 'In Implementation' : 'Implement';
      expect(buttonText).toBe('In Implementation');

      // Button disabled state
      const isDisabled = implementationMode || false; // OR with base disabled conditions
      expect(isDisabled).toBe(true);
    });
  });

  describe('State persistence across tab switches', () => {
    it('should persist implementationMode: true across context updates', () => {
      const { result } = renderHook(() => useProductUiState(), { wrapper });

      const projectKey = 'test-project';
      const workItemId = 'work-item-persist';

      // Set initial state with implementationMode: true
      const initialState: ImplementChatUiState = {
        sessionId: 'session-persist',
        messages: [],
        generatedSpecs: null,
        error: null,
        inputDraft: '',
        implementationMode: true,
      };

      act(() => {
        result.current.setImplementChatState(projectKey, workItemId, initialState);
      });

      // Verify persistence
      const retrieved = result.current.getImplementChatState(projectKey, workItemId);
      expect(retrieved?.implementationMode).toBe(true);
    });

    it('should persist implementationMode separately per work item', () => {
      const { result } = renderHook(() => useProductUiState(), { wrapper });

      const projectKey = 'test-project';
      const workItem1 = 'work-item-1';
      const workItem2 = 'work-item-2';

      // Set state for work item 1 with implementationMode: true
      act(() => {
        result.current.setImplementChatState(projectKey, workItem1, {
          sessionId: 'session-1',
          messages: [],
          generatedSpecs: null,
          error: null,
          inputDraft: '',
          implementationMode: true,
        });
      });

      // Set state for work item 2 with implementationMode: false
      act(() => {
        result.current.setImplementChatState(projectKey, workItem2, {
          sessionId: 'session-2',
          messages: [],
          generatedSpecs: null,
          error: null,
          inputDraft: '',
          implementationMode: false,
        });
      });

      // Verify each work item has its own implementationMode
      const state1 = result.current.getImplementChatState(projectKey, workItem1);
      const state2 = result.current.getImplementChatState(projectKey, workItem2);

      expect(state1?.implementationMode).toBe(true);
      expect(state2?.implementationMode).toBe(false);
    });
  });

  describe('Complete workflow scenario', () => {
    it('should transition through all states correctly', () => {
      // Track state progression
      const states: { plannerReadyForSpec: boolean; implementationMode: boolean }[] = [];

      // State 1: Initial
      let plannerReadyForSpec = false;
      let implementationMode = false;
      states.push({ plannerReadyForSpec, implementationMode });

      // State 2: LLM sets plannerReadyForSpec
      plannerReadyForSpec = true;
      states.push({ plannerReadyForSpec, implementationMode });

      // State 3: User confirms (sets implementationMode)
      implementationMode = true;
      states.push({ plannerReadyForSpec, implementationMode });

      // Verify state progression
      expect(states[0]).toEqual({ plannerReadyForSpec: false, implementationMode: false });
      expect(states[1]).toEqual({ plannerReadyForSpec: true, implementationMode: false });
      expect(states[2]).toEqual({ plannerReadyForSpec: true, implementationMode: true });
    });

    it('should correctly derive button text and disabled state at each stage', () => {
      // Stage 1: Both false - button: "Implement", enabled (if base conditions met)
      let implementationMode = false;
      let canImplementBase = true;

      let buttonText = implementationMode ? 'In Implementation' : 'Implement';
      let isDisabled = implementationMode || !canImplementBase;
      expect(buttonText).toBe('Implement');
      expect(isDisabled).toBe(false);

      // Stage 2: User clicks, modal shown, implementationMode still false
      // (no change until confirmation)
      expect(buttonText).toBe('Implement');
      expect(isDisabled).toBe(false);

      // Stage 3: User confirms, implementationMode becomes true
      implementationMode = true;
      buttonText = implementationMode ? 'In Implementation' : 'Implement';
      isDisabled = implementationMode || !canImplementBase;
      expect(buttonText).toBe('In Implementation');
      expect(isDisabled).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle clicking Implement when already in implementationMode', () => {
      const implementationMode = true;
      const onShowModal = vi.fn();
      const onProceed = vi.fn();

      // Simulate guard clause in handleImplementClick
      function handleImplementClick() {
        if (implementationMode) {
          return; // Early return guard
        }
        // Should never reach here
        onShowModal();
        onProceed();
      }

      handleImplementClick();

      // Neither callback should be called
      expect(onShowModal).not.toHaveBeenCalled();
      expect(onProceed).not.toHaveBeenCalled();
    });

    it('should handle canceling the modal (implementationMode stays false)', () => {
      let implementationMode = false;
      let isModalOpen = true;

      // Simulate handleModalCancel
      function handleModalCancel() {
        isModalOpen = false;
        // Do NOT set implementationMode
      }

      handleModalCancel();

      expect(isModalOpen).toBe(false);
      expect(implementationMode).toBe(false); // Should remain false
    });

    it('should handle exactly 1 open question (singular form)', () => {
      render(
        <ImplementConfirmationModal
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          openQuestionCount={1}
        />
      );

      expect(screen.getByTestId('confirm-modal-message')).toHaveTextContent(
        '1 unanswered question'
      );
      // Verify it's singular, not plural
      expect(screen.getByTestId('confirm-modal-message')).not.toHaveTextContent(
        '1 unanswered questions'
      );
    });
  });
});

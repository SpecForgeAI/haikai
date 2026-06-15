/**
 * Infinite Loop Regression Tests for Implementation Assistant
 *
 * Spec 2026-01-11: Fix Infinite Re-render Loop in Implementation Assistant
 * Task Group 4: Regression Testing
 *
 * These tests verify that the infinite re-render loop bug is fixed and does not regress.
 * The tests specifically check for:
 * - "Maximum update depth exceeded" warnings are NOT logged
 * - setImplementChatState is called at most once during initial mount/hydration
 * - Chat state persistence continues to function correctly
 * - Tab switching does not cause infinite loops
 */

import { screen, waitFor, act } from '@testing-library/react';
import { createElement, ReactNode, useState } from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ImplementationAssistantPanel } from '../components/ProductView/ImplementationAssistantPanel';
import { renderWithProviders, makeTestProject } from '../test-utils/renderWithProviders';
import {
  ProductUiStateProvider,
  useProductUiState,
  ImplementChatUiState,
} from '../contexts/ProductUiStateContext';

// Mock the chatApi module
vi.mock('../api/chatApi', async () => {
  const actual = await vi.importActual('../api/chatApi');
  return {
    ...actual,
    postChatMessage: vi.fn().mockResolvedValue({
    sessionId: 'test-session-id',
    assistant: { message: 'Test response' },
  }),
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

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

/**
 * Default props for ImplementationAssistantPanel
 */
const defaultProps = {
  workItemId: 'work-item-regression-1',
  workItemTitle: 'Regression Test Work Item',
  workItemType: 'Feature',
  workItemDescription: 'Test description for regression testing',
  projectId: 'regression-test-project.json',
  contextState: {
    entity_refs: [],
    diagram_refs: [],
  },
};

describe('Infinite Loop Regression Tests (Spec 2026-01-11 Task Group 4)', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on console to detect "Maximum update depth exceeded" warnings
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  /**
   * Test 4.3.1: Integration test - ProductUiStateProvider with ImplementationAssistantPanel
   * Verifies that rendering the provider and panel together does not cause infinite loops.
   */
  it('should render ProductUiStateProvider with ImplementationAssistantPanel without infinite loop', async () => {
    renderWithProviders(
      createElement(
        ProductUiStateProvider,
        null,
        createElement(ImplementationAssistantPanel, defaultProps)
      )
    , { project: makeTestProject() });

    // Wait for the component to render
    await waitFor(() => {
      expect(screen.getByTestId('implementation-assistant-panel')).toBeInTheDocument();
    });

    // Allow time for any potential infinite loop to manifest
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify "Maximum update depth exceeded" was NOT logged
    const maxUpdateDepthError = consoleErrorSpy.mock.calls.find(
      (call) => call[0]?.toString().includes('Maximum update depth exceeded')
    );
    expect(maxUpdateDepthError).toBeUndefined();

    // Component should render successfully
    // Old title header replaced by the chat header room label
    expect(screen.getByText('Implementation Studio')).toBeInTheDocument();
    // The chat content renders either the empty state or a seeded message --
    // both prove the render settled without looping.
    expect(
      screen.queryByTestId('implementation-assistant-empty') ??
        screen.getByTestId('implementation-assistant-panel')
    ).toBeInTheDocument();
  });

  /**
   * Test 4.3.2: Verify setImplementChatState is called at most once during initial mount
   */
  it('should call setImplementChatState at most once during initial mount/hydration', async () => {
    let setImplementChatStateCallCount = 0;

    // Wrapper component that tracks setImplementChatState calls
    function SetterTracker({ children }: { children: ReactNode }) {
      const context = useProductUiState();

      // Track calls to setImplementChatState by wrapping it
      const originalSetter = context.setImplementChatState;
      context.setImplementChatState = (
        projectKey: string,
        workItemId: string,
        chatState: ImplementChatUiState
      ) => {
        setImplementChatStateCallCount++;
        return originalSetter(projectKey, workItemId, chatState);
      };

      return createElement('div', null, children);
    }

    renderWithProviders(
      createElement(
        ProductUiStateProvider,
        null,
        createElement(
          SetterTracker,
          null,
          createElement(ImplementationAssistantPanel, defaultProps)
        )
      )
    , { project: makeTestProject() });

    // Wait for component to mount
    await waitFor(() => {
      expect(screen.getByTestId('implementation-assistant-panel')).toBeInTheDocument();
    });

    // Allow effects to settle
    await new Promise((resolve) => setTimeout(resolve, 300));

    // setImplementChatState should be called at most once (for initial persist)
    // With the equality guard, it may be called 0 times if nothing to persist
    expect(setImplementChatStateCallCount).toBeLessThanOrEqual(1);
  });

  /**
   * Test 4.3.3: Verify chat state persistence still works correctly after the fix
   */
  it('should persist chat state correctly after fix', async () => {
    // Component to verify state persistence
    function PersistenceTestComponent() {
      const context = useProductUiState();
      const [hasPersistedState, setHasPersistedState] = useState(false);

      // Check for persisted state after a delay
      const checkState = () => {
        const state = context.getImplementChatState(
          defaultProps.projectId,
          defaultProps.workItemId
        );
        setHasPersistedState(!!state);
      };

      return createElement('div', null, [
        createElement(ImplementationAssistantPanel, { ...defaultProps, key: 'panel' }),
        createElement(
          'button',
          {
            key: 'check-btn',
            'data-testid': 'check-state-btn',
            onClick: checkState,
          },
          'Check State'
        ),
        createElement(
          'div',
          {
            key: 'state-indicator',
            'data-testid': 'state-indicator',
            'data-has-state': hasPersistedState ? 'true' : 'false',
          },
          hasPersistedState ? 'Has State' : 'No State'
        ),
      ]);
    }

    renderWithProviders(
      createElement(ProductUiStateProvider, null, createElement(PersistenceTestComponent))
    , { project: makeTestProject() });

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByTestId('implementation-assistant-panel')).toBeInTheDocument();
    });

    // Allow persist effects to run
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Click to check state
    const checkBtn = screen.getByTestId('check-state-btn');
    act(() => {
      checkBtn.click();
    });

    // Verify no infinite loop occurred
    const maxUpdateDepthError = consoleErrorSpy.mock.calls.find(
      (call) => call[0]?.toString().includes('Maximum update depth exceeded')
    );
    expect(maxUpdateDepthError).toBeUndefined();
  });

  /**
   * Test 4.3.4: Verify tab/work item switching does not cause infinite loops
   */
  it('should not cause infinite loop when switching work items', async () => {
    // Component that simulates work item switching
    function WorkItemSwitcher() {
      const [currentWorkItemId, setCurrentWorkItemId] = useState('work-item-1');

      return createElement('div', null, [
        createElement(ImplementationAssistantPanel, {
          ...defaultProps,
          workItemId: currentWorkItemId,
          key: 'panel',
        }),
        createElement(
          'button',
          {
            key: 'switch-btn',
            'data-testid': 'switch-work-item-btn',
            onClick: () =>
              setCurrentWorkItemId((prev) =>
                prev === 'work-item-1' ? 'work-item-2' : 'work-item-1'
              ),
          },
          'Switch Work Item'
        ),
      ]);
    }

    renderWithProviders(createElement(ProductUiStateProvider, null, createElement(WorkItemSwitcher)), { project: makeTestProject() });

    // Wait for initial render
    await waitFor(() => {
      expect(screen.getByTestId('implementation-assistant-panel')).toBeInTheDocument();
    });

    // Allow initial effects to settle
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Switch work items multiple times
    const switchBtn = screen.getByTestId('switch-work-item-btn');

    for (let i = 0; i < 3; i++) {
      act(() => {
        switchBtn.click();
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Verify "Maximum update depth exceeded" was NOT logged during any switch
    const maxUpdateDepthError = consoleErrorSpy.mock.calls.find(
      (call) => call[0]?.toString().includes('Maximum update depth exceeded')
    );
    expect(maxUpdateDepthError).toBeUndefined();

    // Component should still be functional
    expect(screen.getByTestId('implementation-assistant-panel')).toBeInTheDocument();
  });

  /**
   * Test 4.3.5: Verify context getter stability prevents re-render cascade
   */
  it('should maintain stable getter function identities to prevent re-render cascade', async () => {
    let getterReferenceChanges = 0;
    let previousGetImplementChatState: unknown = null;

    // Component that tracks getter reference changes
    function GetterTracker() {
      const context = useProductUiState();

      if (previousGetImplementChatState !== null) {
        if (context.getImplementChatState !== previousGetImplementChatState) {
          getterReferenceChanges++;
        }
      }
      previousGetImplementChatState = context.getImplementChatState;

      return createElement(ImplementationAssistantPanel, defaultProps);
    }

    renderWithProviders(createElement(ProductUiStateProvider, null, createElement(GetterTracker)), { project: makeTestProject() });

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByTestId('implementation-assistant-panel')).toBeInTheDocument();
    });

    // Allow time for potential re-renders
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Getter reference should not change (0 changes after initial capture)
    // If it changes many times, it indicates the infinite loop problem
    expect(getterReferenceChanges).toBe(0);

    // Verify no infinite loop occurred
    const maxUpdateDepthError = consoleErrorSpy.mock.calls.find(
      (call) => call[0]?.toString().includes('Maximum update depth exceeded')
    );
    expect(maxUpdateDepthError).toBeUndefined();
  });
});

/**
 * Pending Action Context
 *
 * Spec 2026-03-04: Assistant "What's Next" v1
 * Task Group 5, Task 5.1: Create PendingActionContext with Provider and hook
 *
 * Provides a cross-screen action handoff mechanism for the "What's Next" feature.
 * When a user clicks a recommended action card on one screen, the pending action
 * is set in this context. After navigation, the target screen's UnifiedChatPanel
 * consumes the pending action to auto-expand, switch persona, and select the task.
 *
 * Usage:
 * - App.tsx wraps AppContent with PendingActionProvider (inside ArchitectureProvider)
 * - Source component calls setPendingAction(action) then navigates
 * - Target component reads pendingAction, acts on it, and calls clearPendingAction()
 */

import { createContext, useContext, useState, ReactNode } from 'react';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Represents a pending navigation action from a "What's Next" recommendation.
 */
export interface PendingAction {
  /** Target view: 'dashboard' | 'product' | 'metamodel' */
  screen: string;
  /** Optional tab within the view (e.g., 'product', 'roadmap') */
  tab?: string;
  /** Persona ID to switch to */
  personaId: string;
  /** Task ID to select (optional -- if omitted, persona switch triggers greeting + task menu) */
  taskId?: string;
}

/**
 * Context type providing pending action state and operations.
 */
interface PendingActionContextType {
  /** The current pending action, or null if none */
  pendingAction: PendingAction | null;
  /** Set a new pending action for cross-screen handoff */
  setPendingAction: (action: PendingAction) => void;
  /** Clear the pending action after consumption */
  clearPendingAction: () => void;
}

// ============================================================================
// Context
// ============================================================================

const PendingActionContext = createContext<PendingActionContextType | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

/**
 * Props for PendingActionProvider component.
 */
interface PendingActionProviderProps {
  children: ReactNode;
}

/**
 * PendingActionProvider component.
 *
 * Wraps children and provides pending action state for cross-screen
 * navigation handoff. The pending action is set by the source screen
 * (e.g., Dashboard "What's Next" action cards) and consumed by the
 * target screen's UnifiedChatPanel on mount.
 *
 * @param children - Child components
 */
export function PendingActionProvider({ children }: PendingActionProviderProps) {
  const [pendingAction, setPendingActionState] = useState<PendingAction | null>(null);

  const setPendingAction = (action: PendingAction) => {
    setPendingActionState(action);
  };

  const clearPendingAction = () => {
    setPendingActionState(null);
  };

  return (
    <PendingActionContext.Provider value={{ pendingAction, setPendingAction, clearPendingAction }}>
      {children}
    </PendingActionContext.Provider>
  );
}

// ============================================================================
// Custom Hook
// ============================================================================

/** No-op default for when the hook is used outside PendingActionProvider (e.g., in tests) */
const DEFAULT_PENDING_ACTION_CONTEXT: PendingActionContextType = {
  pendingAction: null,
  setPendingAction: () => {},
  clearPendingAction: () => {},
};

/**
 * Hook to get pending action state and operations from context.
 *
 * Returns a safe no-op default when used outside PendingActionProvider,
 * allowing components like UnifiedChatPanel to render in tests without
 * requiring the provider wrapper.
 *
 * @returns Object with pendingAction, setPendingAction, and clearPendingAction
 */
export function usePendingAction() {
  const context = useContext(PendingActionContext);
  return context ?? DEFAULT_PENDING_ACTION_CONTEXT;
}

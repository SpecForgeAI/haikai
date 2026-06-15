/**
 * Modal Action Context
 *
 * Spec 2026-03-04: What's Next v1-B -- Modal Launch
 * Task Group 2, Task 2.1: Create ModalActionContext with Provider and hook
 *
 * Provides modal action triggers to the application.
 * Allows components (like UnifiedChatPanel) to trigger modal opens
 * that are controlled by TopBar.
 *
 * Usage:
 * - TopBar wraps its children with ModalActionProvider (alongside ImportActionsProvider)
 * - TopBar passes its handleGenerateStandards handler as openGenerateStandardsModal
 * - Components consume via useModalActions() hook
 */

import { createContext, useContext, ReactNode } from 'react';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Context type providing modal action triggers.
 */
export interface ModalActionsContextType {
  /** Trigger the Generate Standards modal (same as Product menu -> Generate Standards) */
  openGenerateStandardsModal: () => void;
}

// ============================================================================
// Context
// ============================================================================

const ModalActionContext = createContext<ModalActionsContextType>({
  openGenerateStandardsModal: () => {},
});

// ============================================================================
// Provider
// ============================================================================

/**
 * Props for ModalActionProvider component.
 */
interface ModalActionProviderProps {
  children: ReactNode;
  /** Handler to trigger the Generate Standards modal */
  openGenerateStandardsModal: () => void;
}

/**
 * ModalActionProvider component.
 *
 * Wraps children and provides modal action triggers.
 * Used in TopBar to expose modal functionality to nested components
 * like UnifiedChatPanel's handleWhatsNextAction handler.
 *
 * @param children - Child components
 * @param openGenerateStandardsModal - Handler to trigger the Generate Standards modal
 */
export function ModalActionProvider({
  children,
  openGenerateStandardsModal,
}: ModalActionProviderProps) {
  return (
    <ModalActionContext.Provider value={{ openGenerateStandardsModal }}>
      {children}
    </ModalActionContext.Provider>
  );
}

// ============================================================================
// Custom Hook
// ============================================================================

/**
 * Hook to get modal action triggers from context.
 *
 * Returns a safe no-op default when used outside ModalActionProvider,
 * allowing components like UnifiedChatPanel to render in tests without
 * requiring the provider wrapper.
 *
 * @returns Object with openGenerateStandardsModal function
 */
export function useModalActions(): ModalActionsContextType {
  return useContext(ModalActionContext);
}

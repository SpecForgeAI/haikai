/**
 * TemporaryDiagramContext
 *
 * Spec 2026-03-26: Render Temporary Architecture Diagrams in Frontend (Increment 4)
 * Task Group 4, Task 4.7: Expose a mechanism for external components to activate
 * temporary diagram mode.
 *
 * This lightweight React context provides a callback that external components
 * (like the chat panel) can use to activate temporary diagram mode. The activation
 * sets the temporary diagram state and works in conjunction with dispatching
 * SET_VIEW with 'diagrams' to navigate to the Diagrams view.
 *
 * Usage:
 * - The TemporaryDiagramProvider wraps the app at the same level as other providers
 *   (inside App.tsx, wrapping around ArchitectureProvider or at the same level).
 * - External components call `activateTemporaryDiagram(projectId, temporaryDiagramId)`
 *   to trigger temporary diagram mode.
 * - DiagramsView reads `temporaryDiagramRequest` to detect when to enter temporary mode.
 * - DiagramsView calls `clearTemporaryDiagramRequest()` after consuming the request.
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// ============================================================================
// Types
// ============================================================================

/**
 * A request to view a temporary diagram. Set by external components,
 * consumed by DiagramsView.
 */
export interface TemporaryDiagramRequest {
  /** The project UUID */
  projectId: string;
  /** The client/LLM-provided diagram identifier */
  temporaryDiagramId: string;
}

/**
 * Context type for temporary diagram activation.
 */
interface TemporaryDiagramContextType {
  /** The current pending request, or null if none */
  temporaryDiagramRequest: TemporaryDiagramRequest | null;
  /** Activate temporary diagram mode with the given IDs */
  activateTemporaryDiagram: (projectId: string, temporaryDiagramId: string) => void;
  /** Clear the pending request (called by DiagramsView after consuming it) */
  clearTemporaryDiagramRequest: () => void;
}

// ============================================================================
// Context and Provider
// ============================================================================

const TemporaryDiagramContext = createContext<TemporaryDiagramContextType | undefined>(undefined);

interface TemporaryDiagramProviderProps {
  children: ReactNode;
}

/**
 * TemporaryDiagramProvider
 *
 * Provides the activation mechanism for temporary diagram mode.
 * External components set a request; DiagramsView consumes it.
 */
export function TemporaryDiagramProvider({ children }: TemporaryDiagramProviderProps) {
  const [request, setRequest] = useState<TemporaryDiagramRequest | null>(null);

  const activateTemporaryDiagram = useCallback((projectId: string, temporaryDiagramId: string) => {
    setRequest({ projectId, temporaryDiagramId });
  }, []);

  const clearTemporaryDiagramRequest = useCallback(() => {
    setRequest(null);
  }, []);

  return (
    <TemporaryDiagramContext.Provider value={{
      temporaryDiagramRequest: request,
      activateTemporaryDiagram,
      clearTemporaryDiagramRequest,
    }}>
      {children}
    </TemporaryDiagramContext.Provider>
  );
}

// ============================================================================
// Custom Hooks
// ============================================================================

/**
 * Hook to get the full temporary diagram context.
 *
 * Used by DiagramsView to read and clear the request.
 *
 * @throws Error if used outside TemporaryDiagramProvider
 */
export function useTemporaryDiagramContext(): TemporaryDiagramContextType {
  const context = useContext(TemporaryDiagramContext);
  if (context === undefined) {
    throw new Error('useTemporaryDiagramContext must be used within a TemporaryDiagramProvider');
  }
  return context;
}

/**
 * Hook to get just the activation function.
 *
 * Used by external components (chat panel) to trigger temporary diagram viewing.
 *
 * @throws Error if used outside TemporaryDiagramProvider
 */
export function useActivateTemporaryDiagram(): (projectId: string, temporaryDiagramId: string) => void {
  const context = useContext(TemporaryDiagramContext);
  if (context === undefined) {
    throw new Error('useActivateTemporaryDiagram must be used within a TemporaryDiagramProvider');
  }
  return context.activateTemporaryDiagram;
}

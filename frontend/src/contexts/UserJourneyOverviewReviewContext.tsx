/**
 * UserJourneyOverviewReviewContext
 *
 * Spec 2026-04-07: User Journey Overview Parent Diagram Generation
 * Task Group 5, Task 5.2: Ephemeral review session state for a single overview diagram.
 *
 * This React context manages the in-memory, session-scoped state for reviewing
 * a temporary User Journey Overview diagram. It follows a simplified version of
 * the UserJourneyReviewContext pattern -- single diagram, no multi-item navigation
 * or chooser.
 *
 * Usage:
 * - The UserJourneyOverviewReviewProvider wraps the app at the same level as
 *   UserJourneyReviewProvider (inside App.tsx, within PendingActionProvider).
 * - External components call activateOverviewReview(projectId, dto, previousView)
 *   to start a review session.
 * - DiagramsView reads the context to detect when to render the OverviewReviewBanner
 *   and the overview renderer.
 * - markOverviewSaved() marks the diagram as saved.
 * - closeOverviewReview() clears all state; the caller dispatches SET_VIEW to restore
 *   the previous view.
 */

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { UserJourneyOverviewDiagramDto } from '../types/userJourneyOverviewDiagram';

// ============================================================================
// Types
// ============================================================================

/**
 * State shape for the user journey overview review session.
 */
export interface UserJourneyOverviewReviewState {
  /** Whether the review session is active */
  active: boolean;
  /** The project UUID */
  projectId: string;
  /** The fetched overview diagram DTO */
  overviewDiagram: UserJourneyOverviewDiagramDto | null;
  /** Whether the overview has been saved as a persistent diagram */
  saved: boolean;
  /** The currentView value before entering review mode, for restoration on close */
  previousView: string;
}

/**
 * Context type exposing state and actions.
 */
interface UserJourneyOverviewReviewContextType extends UserJourneyOverviewReviewState {
  /** Start a review session with a fetched overview diagram */
  activateOverviewReview: (projectId: string, dto: UserJourneyOverviewDiagramDto, previousView: string) => void;
  /** Mark the overview as saved */
  markOverviewSaved: () => void;
  /** Clear all state (caller handles SET_VIEW restoration) */
  closeOverviewReview: () => void;
}

// ============================================================================
// Initial State
// ============================================================================

const initialState: UserJourneyOverviewReviewState = {
  active: false,
  projectId: '',
  overviewDiagram: null,
  saved: false,
  previousView: '',
};

// ============================================================================
// Context and Provider
// ============================================================================

const UserJourneyOverviewReviewContext = createContext<UserJourneyOverviewReviewContextType | undefined>(undefined);

interface UserJourneyOverviewReviewProviderProps {
  children: ReactNode;
}

/**
 * UserJourneyOverviewReviewProvider
 *
 * Provides ephemeral review session state for User Journey Overview diagrams.
 * Purely in-memory; never persisted to any backend.
 */
export function UserJourneyOverviewReviewProvider({ children }: UserJourneyOverviewReviewProviderProps) {
  const [state, setState] = useState<UserJourneyOverviewReviewState>(initialState);

  const activateOverviewReview = useCallback(
    (projectId: string, dto: UserJourneyOverviewDiagramDto, previousView: string) => {
      setState({
        active: true,
        projectId,
        overviewDiagram: dto,
        saved: false,
        previousView,
      });
    },
    []
  );

  const markOverviewSaved = useCallback(() => {
    setState((prev) => ({
      ...prev,
      saved: true,
    }));
  }, []);

  const closeOverviewReview = useCallback(() => {
    setState(initialState);
  }, []);

  return (
    <UserJourneyOverviewReviewContext.Provider
      value={{
        ...state,
        activateOverviewReview,
        markOverviewSaved,
        closeOverviewReview,
      }}
    >
      {children}
    </UserJourneyOverviewReviewContext.Provider>
  );
}

// ============================================================================
// Custom Hooks
// ============================================================================

/**
 * Hook to get the full user journey overview review context.
 *
 * Used by DiagramsView to read state and invoke actions.
 *
 * @throws Error if used outside UserJourneyOverviewReviewProvider
 */
export function useUserJourneyOverviewReviewContext(): UserJourneyOverviewReviewContextType {
  const context = useContext(UserJourneyOverviewReviewContext);
  if (context === undefined) {
    throw new Error('useUserJourneyOverviewReviewContext must be used within a UserJourneyOverviewReviewProvider');
  }
  return context;
}

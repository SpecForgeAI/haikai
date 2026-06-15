/**
 * UserJourneyReviewContext
 *
 * Manages ephemeral review session state for User Journey and User Journey
 * Overview diagrams. Provides unified Next/Previous navigation across both
 * diagram types using a single index:
 *   positions 0 .. journeys.length-1  → child journey diagrams
 *   positions journeys.length .. total-1  → overview diagrams
 */

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { UserJourneyDiagramDto } from '../types/userJourneyDiagram';
import type { UserJourneyOverviewDiagramDto } from '../types/userJourneyOverviewDiagram';

// ============================================================================
// Types
// ============================================================================

export interface UserJourneyReviewState {
  active: boolean;
  projectId: string;
  sourceTaskId: string;
  journeys: UserJourneyDiagramDto[];
  overviews: UserJourneyOverviewDiagramDto[];
  /** Unified index across journeys + overviews, or null when in chooser */
  selectedIndex: number | null;
  loading: boolean;
  error: string | null;
  previousView: string;
  /** Unified indices that have been saved (spans both arrays) */
  savedIndices: Set<number>;
}

interface UserJourneyReviewContextType extends UserJourneyReviewState {
  activateReviewSession: (projectId: string, sourceTaskId: string, journeys: UserJourneyDiagramDto[], previousView: string, initialSelectedIndex?: number | null, overviews?: UserJourneyOverviewDiagramDto[]) => void;
  /** Select by unified index */
  selectItem: (index: number) => void;
  selectNext: () => void;
  selectPrevious: () => void;
  returnToChooser: () => void;
  markSaved: (index: number) => void;
  closeReviewSession: () => void;
  /** Total count of all diagrams (journeys + overviews) */
  totalCount: number;
  /** Whether the current selection is an overview diagram */
  isOverview: boolean;
  /** The child journey at the current index, or null */
  currentJourney: UserJourneyDiagramDto | null;
  /** The overview at the current index, or null */
  currentOverview: UserJourneyOverviewDiagramDto | null;
  /** The overview-local index (0-based within overviews array), or -1 */
  currentOverviewIndex: number;

  // Backward-compat aliases used by existing code
  /** @deprecated use selectItem */
  selectJourney: (index: number) => void;
  /** @deprecated use selectItem(journeys.length + index) */
  selectOverview: (index: number) => void;
  /** @deprecated use markSaved */
  markJourneySaved: (index: number) => void;
  /** @deprecated use markSaved(journeys.length + index) */
  markOverviewSaved: (index: number) => void;
  /** @deprecated use savedIndices */
  savedOverviewIndices: Set<number>;
  /** @deprecated — no longer separate, use selectedIndex */
  selectedOverviewIndex: number | null;
}

// ============================================================================
// Initial State
// ============================================================================

const initialState: UserJourneyReviewState = {
  active: false,
  projectId: '',
  sourceTaskId: '',
  journeys: [],
  overviews: [],
  selectedIndex: null,
  loading: false,
  error: null,
  previousView: '',
  savedIndices: new Set<number>(),
};

// ============================================================================
// Context and Provider
// ============================================================================

const UserJourneyReviewContext = createContext<UserJourneyReviewContextType | undefined>(undefined);

interface UserJourneyReviewProviderProps {
  children: ReactNode;
}

export function UserJourneyReviewProvider({ children }: UserJourneyReviewProviderProps) {
  const [state, setState] = useState<UserJourneyReviewState>(initialState);

  const totalCount = state.journeys.length + state.overviews.length;

  const activateReviewSession = useCallback(
    (projectId: string, sourceTaskId: string, journeys: UserJourneyDiagramDto[], previousView: string, initialSelectedIndex?: number | null, overviews?: UserJourneyOverviewDiagramDto[]) => {
      setState({
        active: true,
        projectId,
        sourceTaskId,
        journeys,
        overviews: overviews ?? [],
        selectedIndex: initialSelectedIndex ?? null,
        loading: false,
        error: null,
        previousView,
        savedIndices: new Set<number>(),
      });
    },
    []
  );

  const selectItem = useCallback((index: number) => {
    setState((prev) => ({ ...prev, selectedIndex: index }));
  }, []);

  const selectNext = useCallback(() => {
    setState((prev) => {
      if (prev.selectedIndex === null) return prev;
      const total = prev.journeys.length + prev.overviews.length;
      if (prev.selectedIndex >= total - 1) return prev;
      return { ...prev, selectedIndex: prev.selectedIndex + 1 };
    });
  }, []);

  const selectPrevious = useCallback(() => {
    setState((prev) => {
      if (prev.selectedIndex === null) return prev;
      if (prev.selectedIndex <= 0) return prev;
      return { ...prev, selectedIndex: prev.selectedIndex - 1 };
    });
  }, []);

  const returnToChooser = useCallback(() => {
    setState((prev) => ({ ...prev, selectedIndex: null }));
  }, []);

  const markSaved = useCallback((index: number) => {
    setState((prev) => {
      const next = new Set(prev.savedIndices);
      next.add(index);
      return { ...prev, savedIndices: next };
    });
  }, []);

  const closeReviewSession = useCallback(() => {
    setState(initialState);
  }, []);

  // Derived values
  const isOverview = state.selectedIndex !== null && state.selectedIndex >= state.journeys.length;
  const currentJourney = state.selectedIndex !== null && state.selectedIndex < state.journeys.length
    ? state.journeys[state.selectedIndex]
    : null;
  const currentOverviewIndex = isOverview ? state.selectedIndex! - state.journeys.length : -1;
  const currentOverview = currentOverviewIndex >= 0 ? state.overviews[currentOverviewIndex] : null;

  // Backward-compat: savedOverviewIndices as a view over unified savedIndices
  const savedOverviewIndices = new Set<number>();
  for (const idx of state.savedIndices) {
    if (idx >= state.journeys.length) {
      savedOverviewIndices.add(idx - state.journeys.length);
    }
  }

  // Backward-compat: selectedOverviewIndex
  const selectedOverviewIndex = isOverview ? currentOverviewIndex : null;

  return (
    <UserJourneyReviewContext.Provider
      value={{
        ...state,
        activateReviewSession,
        selectItem,
        selectNext,
        selectPrevious,
        returnToChooser,
        markSaved,
        closeReviewSession,
        totalCount,
        isOverview,
        currentJourney,
        currentOverview,
        currentOverviewIndex,
        // Backward-compat aliases
        selectJourney: selectItem,
        selectOverview: useCallback((index: number) => {
          setState((prev) => ({ ...prev, selectedIndex: prev.journeys.length + index }));
        }, []),
        markJourneySaved: markSaved,
        markOverviewSaved: useCallback((index: number) => {
          setState((prev) => {
            const next = new Set(prev.savedIndices);
            next.add(prev.journeys.length + index);
            return { ...prev, savedIndices: next };
          });
        }, []),
        savedOverviewIndices,
        selectedOverviewIndex,
      }}
    >
      {children}
    </UserJourneyReviewContext.Provider>
  );
}

// ============================================================================
// Custom Hooks
// ============================================================================

export function useUserJourneyReviewContext(): UserJourneyReviewContextType {
  const context = useContext(UserJourneyReviewContext);
  if (context === undefined) {
    throw new Error('useUserJourneyReviewContext must be used within a UserJourneyReviewProvider');
  }
  return context;
}

export function useActivateJourneyReview(): UserJourneyReviewContextType['activateReviewSession'] {
  const context = useContext(UserJourneyReviewContext);
  if (context === undefined) {
    throw new Error('useActivateJourneyReview must be used within a UserJourneyReviewProvider');
  }
  return context.activateReviewSession;
}

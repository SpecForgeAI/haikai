/**
 * useFeatureRefinementOrchestration Hook
 *
 * Manages multi-story cycling for the refinement workflow.
 * When a FEATURE is refined, this hook orchestrates cycling through
 * each of its child stories, one at a time (PM → TE per story).
 * After all stories are refined, it transitions to a holistic TE review
 * that produces integration/E2E test definitions.
 *
 * Also supports 'holistic_only' mode where the hook starts directly
 * in holistic_review phase (for standalone "Define Integration/E2E" flow).
 *
 * State is persisted to localStorage so that cycling progress survives
 * page reloads.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { WorkItem } from '../types/workItems';
import type {
  RefinementPhase,
  StoryRefinementResult,
  StoryRefinementOutput,
  HolisticReviewData,
  RefinementProgress,
} from '../types/featureRefinement';

// ============================================================================
// localStorage persistence helpers
// ============================================================================

const STORAGE_KEY_PREFIX = 'refinement_orchestration_';

interface PersistedOrchestrationState {
  phase: RefinementPhase;
  currentIndex: number;
  storyResults: StoryRefinementResult[];
  refinementMode: string;
}

function loadPersistedState(featureId: string): PersistedOrchestrationState | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${featureId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Restore Date objects in storyResults
    if (parsed.storyResults) {
      parsed.storyResults = parsed.storyResults.map((r: StoryRefinementResult & { completedAt: string }) => ({
        ...r,
        completedAt: new Date(r.completedAt),
      }));
    }
    // Migrate persisted state that still has the removed 'feature_refine' phase
    if (parsed.phase === 'feature_refine') {
      parsed.phase = 'story_refine';
      parsed.currentIndex = 0;
    }
    return parsed;
  } catch {
    return null;
  }
}

function savePersistedState(featureId: string, state: PersistedOrchestrationState): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${featureId}`, JSON.stringify(state));
  } catch {
    // localStorage full or unavailable — best effort
  }
}

function clearPersistedState(featureId: string): void {
  try {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${featureId}`);
  } catch {
    // best effort
  }
}

// ============================================================================
// Hook
// ============================================================================

interface UseFeatureRefinementOrchestrationArgs {
  /** The feature work item ID (from URL/props) */
  featureWorkItemId: string | null;
  /** Child stories of the feature */
  stories: WorkItem[];
  /** Current refinement mode */
  refinementMode: 'standard' | 'refine' | 'refine_and_implement' | 'holistic_only';
  /** Pre-loaded story results for holistic_only mode (loaded by parent from backend) */
  preloadedStoryResults?: StoryRefinementResult[];
}

export interface FeatureRefinementOrchestration {
  /** The work item ID to pass to ImplementationAssistantPanel */
  activeWorkItemId: string | null;
  /** Current orchestration phase */
  phase: RefinementPhase;
  /** Whether multi-story cycling is engaged */
  hasMultiStory: boolean;
  /** Progress information for the UI */
  progress: RefinementProgress;
  /** Completed story results */
  storyResults: StoryRefinementResult[];
  /** Holistic review data (non-null when phase is 'holistic_review') */
  holisticReviewData: HolisticReviewData | null;
  /** Advance to the next item in the queue. Accepts optional story output for accumulation. */
  advance: (output?: StoryRefinementOutput) => void;
}

export function useFeatureRefinementOrchestration({
  featureWorkItemId,
  stories,
  refinementMode,
  preloadedStoryResults,
}: UseFeatureRefinementOrchestrationArgs): FeatureRefinementOrchestration {
  // Try to restore from localStorage on initial mount
  const initialState = useMemo(() => {
    if (!featureWorkItemId || refinementMode === 'standard') return null;
    const persisted = loadPersistedState(featureWorkItemId);
    if (persisted && persisted.refinementMode === refinementMode) {
      return persisted;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  const [currentIndex, setCurrentIndex] = useState(initialState?.currentIndex ?? 0);
  const [storyResults, setStoryResults] = useState<StoryRefinementResult[]>(initialState?.storyResults ?? []);
  const [phase, setPhase] = useState<RefinementPhase>(initialState?.phase ?? 'idle');

  // Track the featureWorkItemId to reset when it changes
  const prevFeatureIdRef = useRef<string | null>(null);

  // Build the processing queue: story IDs only (no feature)
  const queue = useMemo(() => {
    if (refinementMode === 'standard' || stories.length === 0 || !featureWorkItemId) {
      return [];
    }
    return stories.map(s => s.id);
  }, [featureWorkItemId, stories, refinementMode]);

  // Initialize phase when queue becomes available (only if not restored from localStorage)
  useEffect(() => {
    if (queue.length > 0 && phase === 'idle') {
      if (refinementMode === 'holistic_only') {
        setPhase('holistic_review');
        if (preloadedStoryResults) {
          setStoryResults(preloadedStoryResults);
        }
      } else {
        setPhase('story_refine');
      }
    } else if (queue.length === 0 && phase !== 'idle') {
      setPhase('idle');
      setCurrentIndex(0);
      setStoryResults([]);
    }
  }, [queue.length, phase, refinementMode, preloadedStoryResults]);

  // Reset when feature changes
  useEffect(() => {
    if (prevFeatureIdRef.current !== null && prevFeatureIdRef.current !== featureWorkItemId) {
      setCurrentIndex(0);
      setStoryResults([]);
      if (refinementMode === 'holistic_only') {
        setPhase(queue.length > 0 ? 'holistic_review' : 'idle');
      } else {
        setPhase(queue.length > 0 ? 'story_refine' : 'idle');
      }
      // Clear old persisted state
      if (prevFeatureIdRef.current) {
        clearPersistedState(prevFeatureIdRef.current);
      }
    }
    prevFeatureIdRef.current = featureWorkItemId;
  }, [featureWorkItemId, queue.length, refinementMode]);

  // Persist state to localStorage on changes
  useEffect(() => {
    if (!featureWorkItemId || phase === 'idle') return;
    savePersistedState(featureWorkItemId, {
      phase,
      currentIndex,
      storyResults,
      refinementMode,
    });
  }, [featureWorkItemId, phase, currentIndex, storyResults, refinementMode]);

  // Clear persisted state when complete
  useEffect(() => {
    if (phase === 'complete' && featureWorkItemId) {
      clearPersistedState(featureWorkItemId);
    }
  }, [phase, featureWorkItemId]);

  const hasMultiStory = queue.length > 0 || refinementMode === 'holistic_only';

  const activeWorkItemId = useMemo(() => {
    if (phase === 'idle' || phase === 'complete' || phase === 'holistic_review') {
      return featureWorkItemId;
    }
    if (phase === 'story_refine') return queue[currentIndex] ?? featureWorkItemId;
    return featureWorkItemId;
  }, [phase, queue, currentIndex, featureWorkItemId]);

  const advance = useCallback((output?: StoryRefinementOutput) => {
    if (phase === 'story_refine') {
      if (output) {
        setStoryResults(prev => [...prev, {
          storyId: output.storyId,
          storyTitle: output.storyTitle,
          plannerResponse: output.plannerResponse,
          testPlannerResponse: output.testPlannerResponse,
          completedAt: new Date(),
        }]);
      }

      if (currentIndex < queue.length - 1) {
        setCurrentIndex(prev => prev + 1);
      } else {
        setPhase('holistic_review');
      }
    } else if (phase === 'holistic_review') {
      setPhase('complete');
    }
  }, [phase, queue.length, currentIndex]);

  // Holistic review data: available when phase is holistic_review
  const holisticReviewData: HolisticReviewData | null = useMemo(() => {
    if (phase !== 'holistic_review') return null;
    return { storyResults };
  }, [phase, storyResults]);

  const progress: RefinementProgress = useMemo(() => {
    const storyCount = queue.length;

    if (phase === 'story_refine') {
      const storyNumber = currentIndex + 1;
      return { current: storyNumber, total: storyCount, phase, label: `Refining story ${storyNumber} of ${storyCount}` };
    }
    if (phase === 'holistic_review') {
      return { current: storyCount, total: storyCount, phase, label: 'Holistic test review...' };
    }
    if (phase === 'complete') {
      return { current: storyCount, total: storyCount, phase, label: 'All stories refined' };
    }
    return { current: 0, total: 0, phase: 'idle', label: '' };
  }, [phase, currentIndex, queue.length]);

  return {
    activeWorkItemId,
    phase,
    hasMultiStory,
    progress,
    storyResults,
    holisticReviewData,
    advance,
  };
}

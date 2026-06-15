/**
 * Product UI State Context
 *
 * Spec 2026-01-07: Preserve Product Tab UI State
 *
 * Provides UI state management for Product tabs (Backlog, Roadmap, Implement).
 * Stores expansion state keyed by project identifier and tab key.
 * This context enables preservation of tree expansion state across tab switches
 * without relying on localStorage (in-memory only for session).
 *
 * Spec 2026-01-10: Preserve Implement Tab State Across Product & Delivery Tab Switches
 *
 * Extended to store Implement tab chat state (session ID, messages, generated specs,
 * input draft) per project per work item, enabling seamless tab switching without
 * losing conversation context.
 *
 * Spec 2026-01-17: Fix Implement Assistant Infinite Render Loop
 *
 * Implemented stateRef pattern to stabilize getter function identities.
 * Getters now use empty dependency arrays with stateRef.current access,
 * preventing infinite re-render loops when getters are used in useEffect deps.
 *
 * Spec 2026-01-23: Two-Flag Workflow State Machine
 *
 * Added implementationMode field to ImplementChatUiState for tracking
 * user-controlled implementation phase transition. Updated equality guard
 * to include implementationMode check.
 */

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, ReactNode } from 'react';
import type { ChatMessage, HandoffPlanResponse, PlannerResponse, TestPlannerResponse, Question } from '../api/chatApi';
import type { PartStatus } from '../types/part';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Valid tab keys for Product View tabs.
 */
export type TabKey = 'roadmap' | 'backlog' | 'implement';
/**
 * Spec 2026-01-14: Execution result state from orchestration API call.
 */
export interface ExecutionResult {
  /** Whether the execution succeeded */
  success: boolean;
  /** Response data from orchestration service on success */
  data?: unknown;
  /** Error message on failure */
  error?: string;
}


/**
 * Spec 2026-01-10: Implement chat UI state for a single work item.
 * Contains the full state of the Implementation Assistant chat conversation.
 *
 * Spec 2026-01-23: Added implementationMode for Two-Flag Workflow State Machine.
 */
export interface ImplementChatUiState {
  /** Session ID for conversation continuity with the backend */
  sessionId: string | null;
  /** Array of chat messages (user and assistant) */
  messages: ChatMessage[];
  /** Generated specification commands from generate_specs intent */
  generatedSpecs: string[] | null;
  /** Error message if last operation failed */
  error: string | null;
  /** Current draft text in the input field */
  inputDraft: string;
  /** Whether the bootstrap phase has been completed for this session */
  hasBootstrapped?: boolean;
  /** Handoff plan from Gateway response for handoff phase */
  handoffPlan?: HandoffPlanResponse | null;
  /** Whether orchestration execution is currently in progress */
  isExecuting?: boolean;
  /** Result from the last orchestration execution attempt */
  executionResult?: ExecutionResult | null;
  /**
   * Spec 2026-01-23: Two-Flag Workflow State Machine
   * User-controlled flag indicating implementation phase has been entered.
   * When true, the Implement button shows "In Implementation" and is disabled.
   * Optional for backward compatibility with existing stored state.
   */
  implementationMode?: boolean;
  // Planner-related fields (also persisted to disk)
  latestPlannerResponse?: PlannerResponse | null;
  answers?: Record<string, string>;
  questionStatuses?: Map<string, 'Open' | 'Answered'>;
  streamedQuestions?: Question[];
  streamedAnswers?: Record<string, string>;
  latestFolder?: string | null;
  incrementStatuses?: Map<string, string>;
  activeIncrementId?: string | null;
  prefetchedSpecs?: Map<number, PlannerResponse>;
  partStatuses?: Map<number, PartStatus>;
  activePartIndex?: number | null;
  currentJobId?: string | null;
  partTranscripts?: Map<number, ChatMessage[]>;
  hasPlan?: boolean;
  hasTriggeredOrchestration?: boolean;
  // Test Engineer phase state (Spec 2026-03-18: Refine Feature Flow)
  latestTestPlannerResponse?: TestPlannerResponse | null;
  hasTestPlan?: boolean;
  teAnswers?: Record<string, string>;
  teQuestionStatuses?: Map<string, 'Open' | 'Answered'>;
  // Spec intent texts for "See Spec" modal (Spec 2026-03-19)
  specIntentTexts?: Map<string, string>;
  // Shape-spec session ID for orchestration requests (Spec 2026-03-21)
  shapeSpecSessionId?: string | null;
}

/**
 * Internal state shape for a single project's expansion state.
 * Arrays are used internally for easy serialization, but the API exposes Sets.
 *
 * Spec 2026-01-10: Extended with Implement-specific fields.
 */
interface ProjectTabState {
  roadmap: string[];
  backlog: string[];
  implement: string[];
  /** Last work item ID selected in the Implement tab for this project */
  lastImplementWorkItemId: string | null;
  /** Chat state keyed by work item ID */
  implementChatState: Record<string, ImplementChatUiState>;
}

/**
 * Internal state shape: Record keyed by projectKey.
 * Each project has its own set of tab expansion states.
 */
export type ProductUiState = Record<string, ProjectTabState>;

/**
 * Context type providing methods to read and modify expansion state.
 *
 * Spec 2026-01-10: Extended with Implement chat state methods.
 */
export interface ProductUiStateContextType {
  /**
   * Get the expanded IDs for a specific project and tab.
   * Returns an empty Set if no state exists for the given project/tab.
   *
   * @param projectKey - The project identifier (typically derived from loadedFileName)
   * @param tabKey - The tab key ('roadmap', 'backlog', or 'implement')
   * @returns Set of expanded item IDs
   */
  getExpandedIds(projectKey: string, tabKey: TabKey): Set<string>;

  /**
   * Set the expanded IDs for a specific project and tab.
   * Overwrites any existing state for that project/tab.
   *
   * @param projectKey - The project identifier
   * @param tabKey - The tab key
   * @param ids - Set of item IDs to store as expanded
   */
  setExpandedIds(projectKey: string, tabKey: TabKey, ids: Set<string>): void;

  /**
   * Toggle a single ID's expanded state for a specific project and tab.
   * Adds the ID if not present, removes it if present.
   *
   * @param projectKey - The project identifier
   * @param tabKey - The tab key
   * @param id - The item ID to toggle
   */
  toggleExpanded(projectKey: string, tabKey: TabKey, id: string): void;

  // ============================================================================
  // Spec 2026-01-10: Implement Chat State Methods
  // ============================================================================

  /**
   * Get the last selected work item ID for the Implement tab.
   * Returns null if no work item has been selected for this project.
   *
   * @param projectKey - The project identifier
   * @returns The last work item ID or null
   */
  getLastImplementWorkItemId(projectKey: string): string | null;

  /**
   * Set the last selected work item ID for the Implement tab.
   *
   * @param projectKey - The project identifier
   * @param workItemId - The work item ID to store, or null to clear
   */
  setLastImplementWorkItemId(projectKey: string, workItemId: string | null): void;

  /**
   * Get the chat state for a specific work item in a project.
   * Returns undefined if no state has been stored (distinguishes from empty state).
   *
   * @param projectKey - The project identifier
   * @param workItemId - The work item ID
   * @returns The chat state or undefined if never stored
   */
  getImplementChatState(projectKey: string, workItemId: string): ImplementChatUiState | undefined;

  /**
   * Set the chat state for a specific work item in a project.
   * Creates the project entry if it doesn't exist.
   *
   * @param projectKey - The project identifier
   * @param workItemId - The work item ID
   * @param chatState - The chat state to store
   */
  setImplementChatState(projectKey: string, workItemId: string, chatState: ImplementChatUiState): void;
}

// ============================================================================
// Context and Provider
// ============================================================================

const ProductUiStateContext = createContext<ProductUiStateContextType | undefined>(undefined);

/**
 * Props for ProductUiStateProvider component.
 */
interface ProductUiStateProviderProps {
  children: ReactNode;
}

/**
 * Default empty project tab state factory.
 * Creates a new ProjectTabState with empty arrays for each tab.
 *
 * Spec 2026-01-10: Initializes Implement-specific fields.
 */
function createEmptyProjectTabState(): ProjectTabState {
  return {
    roadmap: [],
    backlog: [],
    implement: [],
    lastImplementWorkItemId: null,
    implementChatState: {},
  };
}

/**
 * ProductUiStateProvider component.
 *
 * Wraps components that need access to product UI state.
 * Should be placed at a level that survives tab unmount/remount cycles
 * (e.g., wrapping ProductView or at App level).
 *
 * Spec 2026-01-17: Implements stateRef pattern for stable getter identities.
 */
export function ProductUiStateProvider({ children }: ProductUiStateProviderProps) {
  // Internal state: Record<projectKey, ProjectTabState>
  // Initialized as empty object
  const [state, setState] = useState<ProductUiState>({});

  // Spec 2026-01-17: stateRef pattern for stable getter identities
  // This ref always holds the current state, enabling getters to have
  // empty dependency arrays while still accessing current data.
  const stateRef = useRef<ProductUiState>(state);

  // Spec 2026-01-17: Synchronization effect to keep stateRef current
  // This runs after every state update to sync the ref with state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /**
   * Get the expanded IDs for a specific project and tab.
   * Returns empty Set if no state exists.
   *
   * Spec 2026-01-17: Uses stateRef.current for stable function identity.
   * Dependency array is empty [] so function identity never changes.
   */
  const getExpandedIds = useCallback(
    (projectKey: string, tabKey: TabKey): Set<string> => {
      const projectState = stateRef.current[projectKey];
      if (!projectState) {
        return new Set();
      }
      const tabArray = projectState[tabKey];
      if (!tabArray || tabArray.length === 0) {
        return new Set();
      }
      return new Set(tabArray);
    },
    []
  );

  /**
   * Set the expanded IDs for a specific project and tab.
   * Converts Set to array for internal storage.
   */
  const setExpandedIds = useCallback(
    (projectKey: string, tabKey: TabKey, ids: Set<string>): void => {
      setState((prevState) => {
        const existingProjectState = prevState[projectKey] || createEmptyProjectTabState();
        return {
          ...prevState,
          [projectKey]: {
            ...existingProjectState,
            [tabKey]: Array.from(ids),
          },
        };
      });
    },
    []
  );

  /**
   * Toggle a single ID's expanded state.
   * Adds the ID if not present, removes it if present.
   */
  const toggleExpanded = useCallback(
    (projectKey: string, tabKey: TabKey, id: string): void => {
      setState((prevState) => {
        const existingProjectState = prevState[projectKey] || createEmptyProjectTabState();
        const currentArray = existingProjectState[tabKey] || [];
        const currentSet = new Set(currentArray);

        if (currentSet.has(id)) {
          currentSet.delete(id);
        } else {
          currentSet.add(id);
        }

        return {
          ...prevState,
          [projectKey]: {
            ...existingProjectState,
            [tabKey]: Array.from(currentSet),
          },
        };
      });
    },
    []
  );

  // ============================================================================
  // Spec 2026-01-10: Implement Chat State Methods
  // ============================================================================

  /**
   * Get the last selected work item ID for the Implement tab.
   *
   * Spec 2026-01-17: Uses stateRef.current for stable function identity.
   * Dependency array is empty [] so function identity never changes.
   */
  const getLastImplementWorkItemId = useCallback(
    (projectKey: string): string | null => {
      const projectState = stateRef.current[projectKey];
      if (!projectState) {
        return null;
      }
      return projectState.lastImplementWorkItemId ?? null;
    },
    []
  );

  /**
   * Set the last selected work item ID for the Implement tab.
   */
  const setLastImplementWorkItemId = useCallback(
    (projectKey: string, workItemId: string | null): void => {
      setState((prevState) => {
        const existingProjectState = prevState[projectKey] || createEmptyProjectTabState();
        return {
          ...prevState,
          [projectKey]: {
            ...existingProjectState,
            lastImplementWorkItemId: workItemId,
          },
        };
      });
    },
    []
  );

  /**
   * Get the chat state for a specific work item in a project.
   * Returns undefined if no state has been stored.
   *
   * Spec 2026-01-17: Uses stateRef.current for stable function identity.
   * Dependency array is empty [] so function identity never changes.
   */
  const getImplementChatState = useCallback(
    (projectKey: string, workItemId: string): ImplementChatUiState | undefined => {
      const projectState = stateRef.current[projectKey];
      if (!projectState) {
        return undefined;
      }
      return projectState.implementChatState[workItemId];
    },
    []
  );

  /**
   * Set the chat state for a specific work item in a project.
   *
   * Spec 2026-01-17 Task Group 4: Implements equality guard optimization.
   * Skips state update if sessionId, messages.length, inputDraft, and
   * implementationMode match existing state, preventing no-op updates
   * that would trigger ref synchronization.
   *
   * Spec 2026-01-23: Added implementationMode to equality guard.
   */
  const setImplementChatState = useCallback(
    (projectKey: string, workItemId: string, chatState: ImplementChatUiState): void => {
      setState((prevState) => {
        const existingProjectState = prevState[projectKey] || createEmptyProjectTabState();
        const existingChatState = existingProjectState.implementChatState[workItemId];

        // Spec 2026-01-17 Task Group 4: Equality guard
        // Spec 2026-01-23: Added implementationMode to equality check
        // Spec 2026-03-21: Added hasTestPlan and latestTestPlannerResponse presence
        // to prevent TE state changes from being silently dropped
        // Skip update if key fields match to prevent no-op updates
        if (existingChatState) {
          const sessionIdMatches = existingChatState.sessionId === chatState.sessionId;
          const messagesLengthMatches = existingChatState.messages.length === chatState.messages.length;
          const inputDraftMatches = existingChatState.inputDraft === chatState.inputDraft;
          const implementationModeMatches = existingChatState.implementationMode === chatState.implementationMode;
          const hasPlanMatches = (existingChatState.hasPlan ?? false) === (chatState.hasPlan ?? false);
          const hasTestPlanMatches = (existingChatState.hasTestPlan ?? false) === (chatState.hasTestPlan ?? false);
          const teResponseMatches = (existingChatState.latestTestPlannerResponse === null) === (chatState.latestTestPlannerResponse === null);

          if (sessionIdMatches && messagesLengthMatches && inputDraftMatches && implementationModeMatches && hasPlanMatches && hasTestPlanMatches && teResponseMatches) {
            // No meaningful change, return previous state unchanged
            return prevState;
          }
        }

        return {
          ...prevState,
          [projectKey]: {
            ...existingProjectState,
            implementChatState: {
              ...existingProjectState.implementChatState,
              [workItemId]: chatState,
            },
          },
        };
      });
    },
    []
  );

  // Memoize context value to prevent unnecessary re-renders
  // Spec 2026-01-17: With stable getters (empty deps), this useMemo
  // dependencies will no longer change on state updates, keeping
  // the context object identity stable.
  const contextValue = useMemo<ProductUiStateContextType>(
    () => ({
      getExpandedIds,
      setExpandedIds,
      toggleExpanded,
      getLastImplementWorkItemId,
      setLastImplementWorkItemId,
      getImplementChatState,
      setImplementChatState,
    }),
    [
      getExpandedIds,
      setExpandedIds,
      toggleExpanded,
      getLastImplementWorkItemId,
      setLastImplementWorkItemId,
      getImplementChatState,
      setImplementChatState,
    ]
  );

  return (
    <ProductUiStateContext.Provider value={contextValue}>
      {children}
    </ProductUiStateContext.Provider>
  );
}

// ============================================================================
// Custom Hooks
// ============================================================================

/**
 * Hook to get the full ProductUiState context.
 *
 * @returns The ProductUiStateContextType with all methods
 * @throws Error if used outside ProductUiStateProvider
 */
export function useProductUiState(): ProductUiStateContextType {
  const context = useContext(ProductUiStateContext);
  if (context === undefined) {
    throw new Error('useProductUiState must be used within a ProductUiStateProvider');
  }
  return context;
}

/**
 * Convenience hook for working with expansion state for a specific project and tab.
 * Returns bound methods that don't require passing projectKey and tabKey.
 *
 * Uses local state to provide immediate reactivity on toggle clicks.
 * The context's stateRef pattern prevents consumer re-renders (by design for
 * implement chat state), so expansion state is mirrored locally to ensure
 * the tree updates instantly when a node is expanded or collapsed.
 *
 * @param projectKey - The project identifier
 * @param tabKey - The tab key ('roadmap', 'backlog', or 'implement')
 * @returns Object with expandedIds, setExpandedIds, and toggleExpanded bound to the given project/tab
 */
export function useProductExpansion(
  projectKey: string,
  tabKey: TabKey
): {
  expandedIds: Set<string>;
  setExpandedIds: (ids: Set<string>) => void;
  toggleExpanded: (id: string) => void;
} {
  const context = useProductUiState();

  // Local state mirrors context expansion state for immediate reactivity.
  // Initialized from context on mount; all subsequent mutations update both.
  const [expandedIds, setLocalExpandedIds] = useState<Set<string>>(
    () => context.getExpandedIds(projectKey, tabKey)
  );

  // Re-initialize local state when project or tab changes
  const keyRef = useRef(`${projectKey}::${tabKey}`);
  if (`${projectKey}::${tabKey}` !== keyRef.current) {
    keyRef.current = `${projectKey}::${tabKey}`;
    setLocalExpandedIds(context.getExpandedIds(projectKey, tabKey));
  }

  // Bound setExpandedIds: updates both context (persistence) and local state (reactivity)
  const boundSetExpandedIds = useCallback(
    (ids: Set<string>) => {
      context.setExpandedIds(projectKey, tabKey, ids);
      setLocalExpandedIds(ids);
    },
    [context, projectKey, tabKey]
  );

  // Bound toggleExpanded: updates both context and local state
  const boundToggleExpanded = useCallback(
    (id: string) => {
      context.toggleExpanded(projectKey, tabKey, id);
      setLocalExpandedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [context, projectKey, tabKey]
  );

  return {
    expandedIds,
    setExpandedIds: boundSetExpandedIds,
    toggleExpanded: boundToggleExpanded,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Derive a stable project key from the loaded file name.
 * This is used to key the expansion state by project.
 *
 * @param loadedFileName - The file name from ArchitectureContext, or null
 * @returns A stable project key string (empty string if no file loaded)
 */
export function deriveProjectKey(loadedFileName: string | null): string {
  if (!loadedFileName) {
    return '';
  }
  // Use the file name as-is for the project key
  // This provides a stable identifier per loaded file
  return loadedFileName;
}

/**
 * Workspace State Mapper
 *
 * Maps component state to/from the persisted format.
 * Handles extraction of persistable fields and exclusion of transient state.
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 5: Workspace State Mapping
 */

import type {
  PersistedWorkspaceState,
  PersistedQuestion,
  PersistedTranscriptEntry,
  PersistedIncrementArtifacts,
} from '../api/implementWorkspaceApi';
import type { ChatMessage, PlannerResponse, Question } from '../api/chatApi';
import type { IncrementArtifacts, IncrementStatus } from '../components/ProductView/ImplementationAssistantPanel';
import { CURRENT_SCHEMA_VERSION } from './workspaceSchemaVersion';
import { validateLLMPayload } from './validateLLMPayload';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Transient fields that should NOT be persisted.
 * These are UI-only state that should reset on reload.
 */
export interface TransientFields {
  /** Loading flags */
  isLoading: boolean;
  isBootstrapping: boolean;
  isImplementing: boolean;
  isSubmittingAnswers: boolean;
  /** UI-only state */
  activeTab: 'feature' | 'chat';
  isConfirmModalOpen: boolean;
  /** Transient error messages */
  error: string | null;
  /** Session ID (new session on reload) */
  sessionId: string | null;
  /** Input draft text */
  inputDraft: string;
  /** Disk hydration flag */
  isDiskHydrationComplete: boolean;
  /** Executing state */
  executingStep: string | null;
  executingIncrementId: string | null;
}

/**
 * Component state that can be mapped to persisted format.
 */
export interface ComponentWorkspaceState {
  /** User-controlled implementation mode flag */
  implementationMode: boolean;
  /** Latest planner response (contains feature understanding, scope, etc.) */
  latestPlannerResponse: PlannerResponse | null;
  /** Currently selected increment */
  activeIncrementId: string | null;
  /** User answers keyed by question ID */
  answers: Record<string, string>;
  /** SA questions array */
  saQuestions: Question[];
  /** Increment statuses map */
  incrementStatuses: Map<string, IncrementStatus>;
  /** Increment artifacts map */
  incrementArtifacts: Map<string, IncrementArtifacts>;
  /** Chat messages */
  messages: ChatMessage[];
  /** Current conversation phase */
  currentPhase: string;
}

/**
 * State restored from persisted format.
 */
export interface RestoredComponentState {
  implementationMode: boolean;
  latestPlannerResponse: PlannerResponse | null;
  activeIncrementId: string | null;
  answers: Record<string, string>;
  saQuestions: Question[];
  incrementStatuses: Map<string, IncrementStatus>;
  incrementArtifacts: Map<string, IncrementArtifacts>;
  messages: ChatMessage[];
  hasBootstrapped: boolean;
}

// ============================================================================
// Map State TO Persisted Format
// ============================================================================

/**
 * Maps component state to the persisted format.
 * Extracts only persistable fields and excludes transient state.
 *
 * @param state - The component workspace state
 * @param lastKnownGoodPlannerPayload - Optional fallback for invalid planner payload
 * @returns The persisted workspace state
 */
export function mapStateToPersisted(
  state: ComponentWorkspaceState,
  lastKnownGoodPlannerPayload?: Record<string, unknown> | null
): PersistedWorkspaceState {
  // Validate planner payload before including
  let plannerPayload: Record<string, unknown> | null = null;

  if (state.latestPlannerResponse) {
    const validation = validateLLMPayload(state.latestPlannerResponse, 'PlannerResponse');
    if (validation.valid) {
      plannerPayload = state.latestPlannerResponse as unknown as Record<string, unknown>;
    } else {
      console.warn('Invalid PlannerResponse, using last-known-good:', validation.errors);
      plannerPayload = lastKnownGoodPlannerPayload ?? null;
    }
  }

  // Merge PO questions from plannerResponse with SA questions
  const questions = mergeQuestions(state.latestPlannerResponse, state.answers, state.saQuestions);

  // Convert increment artifacts from Map to Record
  const executionArtifactsByIncrement: Record<string, PersistedIncrementArtifacts> = {};
  state.incrementArtifacts.forEach((artifacts, incrementId) => {
    executionArtifactsByIncrement[incrementId] = {
      shapeSpecArtifact: artifacts.shapeSpecArtifact,
      writeSpecArtifact: artifacts.writeSpecArtifact,
      tasksSummary: artifacts.tasksSummary,
      implementationResult: artifacts.implementationResult,
      error: artifacts.error,
    };
  });

  // Convert messages to transcript entries
  const teamChatTranscript = mapMessagesToTranscript(state.messages);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    implementationMode: state.implementationMode,
    plannerPayload,
    activeIncrementId: state.activeIncrementId,
    questions,
    executionArtifactsByIncrement,
    teamChatTranscript,
  };
}

/**
 * Merges PO questions from plannerResponse with SA questions into a single array.
 */
function mergeQuestions(
  plannerResponse: PlannerResponse | null,
  answers: Record<string, string>,
  saQuestions: Question[]
): PersistedQuestion[] {
  const result: PersistedQuestion[] = [];

  // Add PO questions from plannerResponse
  if (plannerResponse?.openQuestions) {
    for (const oq of plannerResponse.openQuestions) {
      const answer = answers[oq.id] ?? '';
      result.push({
        id: oq.id,
        question: oq.question,
        status: answer.trim() ? 'Answered' : 'Open',
        answer,
        source: 'Product Manager',
      });
    }
  }

  // Add SA questions
  for (const q of saQuestions) {
    const answer = answers[q.id] ?? q.answer;
    result.push({
      id: q.id,
      question: q.question,
      status: answer.trim() ? 'Answered' : 'Open',
      answer,
      source: 'Software Developer',
      incrementId: q.incrementId,
    });
  }

  return result;
}

/**
 * Converts ChatMessage array to PersistedTranscriptEntry array.
 */
function mapMessagesToTranscript(messages: ChatMessage[]): PersistedTranscriptEntry[] {
  return messages.map((msg) => ({
    id: msg.id,
    role: msg.role,
    message: msg.content,
    createdAt: msg.timestamp instanceof Date ? msg.timestamp.toISOString() : String(msg.timestamp),
  }));
}

// ============================================================================
// Map Persisted State TO Component State
// ============================================================================

/**
 * Maps persisted state to component state format.
 * Applies safe defaults for missing fields (fail-soft).
 *
 * @param persisted - The persisted workspace state
 * @returns The restored component state
 */
export function mapPersistedToState(persisted: PersistedWorkspaceState | null): RestoredComponentState {
  // Handle null/empty persisted state
  if (!persisted) {
    return createEmptyRestoredState();
  }

  // Extract PlannerResponse from plannerPayload (if valid)
  let latestPlannerResponse: PlannerResponse | null = null;
  if (persisted.plannerPayload) {
    // Attempt to cast to PlannerResponse
    // The validation already happened during save, so we trust the structure
    latestPlannerResponse = persisted.plannerPayload as unknown as PlannerResponse;
  }

  // Separate PO and SA questions
  const answers: Record<string, string> = {};
  const saQuestions: Question[] = [];

  for (const q of persisted.questions ?? []) {
    // Store answer
    if (q.answer) {
      answers[q.id] = q.answer;
    }

    // SA questions have incrementId
    if (q.source === 'Software Developer') {
      saQuestions.push({
        id: q.id,
        question: q.question,
        status: q.status,
        answer: q.answer,
        source: 'Software Developer',
        incrementId: q.incrementId,
      });
    }
  }

  // Convert execution artifacts from Record to Map
  const incrementArtifacts = new Map<string, IncrementArtifacts>();
  if (persisted.executionArtifactsByIncrement) {
    for (const [incrementId, artifacts] of Object.entries(persisted.executionArtifactsByIncrement)) {
      incrementArtifacts.set(incrementId, artifacts as IncrementArtifacts);
    }
  }

  // Derive increment statuses from questions and artifacts
  const incrementStatuses = deriveIncrementStatuses(saQuestions, incrementArtifacts);

  // Convert transcript to messages
  const messages = mapTranscriptToMessages(persisted.teamChatTranscript ?? []);

  return {
    implementationMode: persisted.implementationMode ?? false,
    latestPlannerResponse,
    activeIncrementId: persisted.activeIncrementId ?? null,
    answers,
    saQuestions,
    incrementStatuses,
    incrementArtifacts,
    messages,
    hasBootstrapped: messages.length > 0, // If we have messages, we've bootstrapped
  };
}

/**
 * Derives increment statuses from SA questions and artifacts.
 */
function deriveIncrementStatuses(
  saQuestions: Question[],
  incrementArtifacts: Map<string, IncrementArtifacts>
): Map<string, IncrementStatus> {
  const statuses = new Map<string, IncrementStatus>();

  // Group questions by incrementId
  const questionsByIncrement = new Map<string, Question[]>();
  for (const q of saQuestions) {
    if (q.incrementId) {
      const existing = questionsByIncrement.get(q.incrementId) ?? [];
      existing.push(q);
      questionsByIncrement.set(q.incrementId, existing);
    }
  }

  // Derive status for each increment with questions
  for (const [incrementId, questions] of questionsByIncrement) {
    // Check if we have artifacts (indicates execution happened)
    const artifacts = incrementArtifacts.get(incrementId);

    if (artifacts?.error) {
      statuses.set(incrementId, 'FAILED');
    } else if (artifacts?.implementationResult) {
      statuses.set(incrementId, 'COMPLETED');
    } else if (questions.some((q) => q.status === 'Open')) {
      statuses.set(incrementId, 'IN_CLARIFICATION');
    } else {
      statuses.set(incrementId, 'READY_TO_EXECUTE');
    }
  }

  // Check artifacts for increments without questions
  for (const [incrementId, artifacts] of incrementArtifacts) {
    if (!statuses.has(incrementId)) {
      if (artifacts.error) {
        statuses.set(incrementId, 'FAILED');
      } else if (artifacts.implementationResult) {
        statuses.set(incrementId, 'COMPLETED');
      }
    }
  }

  return statuses;
}

/**
 * Converts PersistedTranscriptEntry array to ChatMessage array.
 */
function mapTranscriptToMessages(transcript: PersistedTranscriptEntry[]): ChatMessage[] {
  return transcript
    .filter((entry) => entry.role !== 'system') // Filter out system messages
    .map((entry) => ({
      id: entry.id,
      role: entry.role as 'user' | 'assistant',
      content: entry.message,
      timestamp: new Date(entry.createdAt),
    }));
}

/**
 * Creates an empty restored state with safe defaults.
 */
function createEmptyRestoredState(): RestoredComponentState {
  return {
    implementationMode: false,
    latestPlannerResponse: null,
    activeIncrementId: null,
    answers: {},
    saQuestions: [],
    incrementStatuses: new Map(),
    incrementArtifacts: new Map(),
    messages: [],
    hasBootstrapped: false,
  };
}

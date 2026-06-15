/**
 * Implementation State Serializer
 *
 * Provides serialization and deserialization for the Implementation Assistant
 * screen state. Handles conversion between in-memory types (Maps, Dates) and
 * JSON-safe types (Records, ISO strings) for disk persistence.
 *
 * Spec 2026-02-11: Persist Implementation Screen State to Disk
 */

import type {
  PlannerResponse,
  TestPlannerResponse,
  Question,
  ChatMessage,
  ChatMessagePersona,
  PersistedImplementationState,
  SerializedChatMessage,
  SerializedQuestion,
} from '../api/chatApi';
import type { PartStatus } from '../types/part';

// Re-export for convenience (used by the panel import)
export type { PersistedImplementationState };

type IncrementStatus =
  | 'NOT_STARTED'
  | 'SPEC_READY'
  | 'IN_CLARIFICATION'
  | 'READY_TO_EXECUTE'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED';

/**
 * Arguments for serializeImplementState.
 * Mirrors the state variables in ImplementationAssistantPanel.
 */
export interface SerializeArgs {
  sessionId: string | null;
  latestPlannerResponse: PlannerResponse | null;
  answers: Record<string, string>;
  questionStatuses: Map<string, 'Open' | 'Answered'>;
  streamedQuestions: Question[];
  streamedAnswers: Record<string, string>;
  latestFolder: string | null;
  incrementStatuses: Map<string, IncrementStatus>;
  activeIncrementId: string | null;
  prefetchedSpecs: Map<number, PlannerResponse>;
  partStatuses: Map<number, PartStatus>;
  activePartIndex: number | null;
  currentJobId: string | null;
  partTranscripts: Map<number, ChatMessage[]>;
  hasBootstrapped: boolean;
  hasPlan: boolean;
  hasTriggeredOrchestration: boolean;
  inputMessage: string;
  messages: ChatMessage[];
  // Test Engineer fields (Spec 2026-03-18)
  latestTestPlannerResponse: TestPlannerResponse | null;
  hasTestPlan: boolean;
  teAnswers: Record<string, string>;
  teQuestionStatuses: Map<string, 'Open' | 'Answered'>;
  // Spec intent texts for "See Spec" modal (Spec 2026-03-19)
  specIntentTexts: Map<string, string>;
  // Shape-spec session ID for orchestration requests (Spec 2026-03-21)
  shapeSpecSessionId: string | null;
}

/**
 * Deserialized implementation state ready for setState calls.
 * All Maps and Dates are restored from their JSON representations.
 */
export interface DeserializedImplementState {
  sessionId: string | null;
  latestPlannerResponse: PlannerResponse | null;
  answers: Record<string, string>;
  questionStatuses: Map<string, 'Open' | 'Answered'>;
  streamedQuestions: Question[];
  streamedAnswers: Record<string, string>;
  latestFolder: string | null;
  incrementStatuses: Map<string, IncrementStatus>;
  activeIncrementId: string | null;
  prefetchedSpecs: Map<number, PlannerResponse>;
  partStatuses: Map<number, PartStatus>;
  activePartIndex: number | null;
  currentJobId: string | null;
  partTranscripts: Map<number, ChatMessage[]>;
  hasBootstrapped: boolean;
  hasPlan: boolean;
  hasTriggeredOrchestration: boolean;
  inputDraft: string;
  messages: ChatMessage[];
  // Test Engineer fields (Spec 2026-03-18)
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
 * Serializes a ChatMessage to its JSON-safe representation.
 * Converts Date timestamp to ISO string.
 */
function serializeChatMessage(msg: ChatMessage): SerializedChatMessage {
  const result: SerializedChatMessage = {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp instanceof Date ? msg.timestamp.toISOString() : String(msg.timestamp),
  };
  if (msg.persona) {
    result.persona = msg.persona;
  }
  return result;
}

/**
 * Deserializes a SerializedChatMessage back to a ChatMessage.
 * Converts ISO string timestamp back to Date.
 */
function deserializeChatMessage(raw: SerializedChatMessage): ChatMessage {
  const result: ChatMessage = {
    id: raw.id || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    role: raw.role || 'assistant',
    content: raw.content || '',
    timestamp: new Date(raw.timestamp || Date.now()),
  };
  if (raw.persona) {
    result.persona = raw.persona as ChatMessagePersona;
  }
  return result;
}

/**
 * Serializes a Question to its JSON-safe representation.
 */
function serializeQuestion(q: Question): SerializedQuestion {
  const result: SerializedQuestion = {
    id: q.id,
    question: q.question,
    status: q.status,
    answer: q.answer,
    source: q.source,
  };
  if (q.incrementId) {
    result.incrementId = q.incrementId;
  }
  return result;
}

/**
 * Deserializes a SerializedQuestion back to a Question.
 */
function deserializeQuestion(raw: SerializedQuestion): Question {
  const result: Question = {
    id: raw.id || '',
    question: raw.question || '',
    status: raw.status || 'Open',
    answer: raw.answer || '',
    source: raw.source || 'Product Manager',
  };
  if (raw.incrementId) {
    result.incrementId = raw.incrementId;
  }
  return result;
}

/**
 * Serializes the full implementation state for JSON persistence.
 *
 * Converts:
 * - Maps to Records (Object.fromEntries)
 * - Number-keyed maps: stringify keys
 * - ChatMessage timestamps: Date → ISO string
 *
 * @param args - Current state variables from ImplementationAssistantPanel
 * @returns JSON-safe PersistedImplementationState
 */
export function serializeImplementState(args: SerializeArgs): PersistedImplementationState {
  // Convert questionStatuses Map<string, ...> → Record<string, ...>
  const questionStatusesRecord: Record<string, 'Open' | 'Answered'> = Object.fromEntries(args.questionStatuses);

  // Convert incrementStatuses Map<string, ...> → Record<string, ...>
  const incrementStatusesRecord: Record<string, string> = Object.fromEntries(args.incrementStatuses);

  // Convert prefetchedSpecs Map<number, ...> → Record<string, ...> (stringify keys)
  const prefetchedSpecsRecord: Record<string, PlannerResponse> = {};
  args.prefetchedSpecs.forEach((value, key) => {
    prefetchedSpecsRecord[String(key)] = value;
  });

  // Convert partStatuses Map<number, ...> → Record<string, ...> (stringify keys)
  const partStatusesRecord: Record<string, string> = {};
  args.partStatuses.forEach((value, key) => {
    partStatusesRecord[String(key)] = value;
  });

  // Convert partTranscripts Map<number, ChatMessage[]> → Record<string, SerializedChatMessage[]>
  const partTranscriptsRecord: Record<string, SerializedChatMessage[]> = {};
  args.partTranscripts.forEach((messages, key) => {
    partTranscriptsRecord[String(key)] = messages.map(serializeChatMessage);
  });

  return {
    schemaVersion: 1,
    sessionId: args.sessionId,
    latestPlannerResponse: args.latestPlannerResponse,
    answers: { ...args.answers },
    questionStatuses: questionStatusesRecord,
    streamedQuestions: args.streamedQuestions.map(serializeQuestion),
    streamedAnswers: { ...args.streamedAnswers },
    latestFolder: args.latestFolder,
    incrementStatuses: incrementStatusesRecord,
    activeIncrementId: args.activeIncrementId,
    prefetchedSpecs: prefetchedSpecsRecord,
    partStatuses: partStatusesRecord,
    activePartIndex: args.activePartIndex,
    currentJobId: args.currentJobId,
    partTranscripts: partTranscriptsRecord,
    hasBootstrapped: args.hasBootstrapped,
    hasPlan: args.hasPlan,
    hasTriggeredOrchestration: args.hasTriggeredOrchestration,
    inputDraft: args.inputMessage,
    messages: args.messages.map(serializeChatMessage),
    // Test Engineer fields
    latestTestPlannerResponse: args.latestTestPlannerResponse,
    hasTestPlan: args.hasTestPlan,
    teAnswers: { ...args.teAnswers },
    teQuestionStatuses: Object.fromEntries(args.teQuestionStatuses),
    // Spec intent texts
    specIntentTexts: Object.fromEntries(args.specIntentTexts),
    // Shape-spec session ID
    shapeSpecSessionId: args.shapeSpecSessionId,
  };
}

/**
 * Deserializes persisted state back to in-memory types for setState calls.
 *
 * Converts:
 * - Records back to Maps
 * - ISO strings back to Dates
 * - Provides defensive defaults for every field (handles missing/partial state)
 * - Schema version check (v1 only for now)
 *
 * @param persisted - The persisted state from disk
 * @returns Deserialized state ready for setState calls, or null if schema version is unsupported
 */
export function deserializeImplementState(
  persisted: PersistedImplementationState
): DeserializedImplementState | null {
  // Schema version check
  if (persisted.schemaVersion !== 1) {
    console.warn('Unsupported implementation state schema version:', persisted.schemaVersion);
    return null;
  }

  // questionStatuses: Record → Map
  const questionStatuses = new Map<string, 'Open' | 'Answered'>();
  if (persisted.questionStatuses && typeof persisted.questionStatuses === 'object') {
    for (const [key, value] of Object.entries(persisted.questionStatuses)) {
      if (value === 'Open' || value === 'Answered') {
        questionStatuses.set(key, value);
      }
    }
  }

  // incrementStatuses: Record → Map
  const incrementStatuses = new Map<string, IncrementStatus>();
  if (persisted.incrementStatuses && typeof persisted.incrementStatuses === 'object') {
    for (const [key, value] of Object.entries(persisted.incrementStatuses)) {
      incrementStatuses.set(key, value as IncrementStatus);
    }
  }

  // prefetchedSpecs: Record<string, ...> → Map<number, ...>
  const prefetchedSpecs = new Map<number, PlannerResponse>();
  if (persisted.prefetchedSpecs && typeof persisted.prefetchedSpecs === 'object') {
    for (const [key, value] of Object.entries(persisted.prefetchedSpecs)) {
      const numKey = Number(key);
      if (!isNaN(numKey) && value) {
        prefetchedSpecs.set(numKey, value);
      }
    }
  }

  // partStatuses: Record<string, ...> → Map<number, ...>
  const partStatuses = new Map<number, PartStatus>();
  if (persisted.partStatuses && typeof persisted.partStatuses === 'object') {
    for (const [key, value] of Object.entries(persisted.partStatuses)) {
      const numKey = Number(key);
      if (!isNaN(numKey)) {
        partStatuses.set(numKey, value as PartStatus);
      }
    }
  }

  // partTranscripts: Record<string, SerializedChatMessage[]> → Map<number, ChatMessage[]>
  const partTranscripts = new Map<number, ChatMessage[]>();
  if (persisted.partTranscripts && typeof persisted.partTranscripts === 'object') {
    for (const [key, value] of Object.entries(persisted.partTranscripts)) {
      const numKey = Number(key);
      if (!isNaN(numKey) && Array.isArray(value)) {
        partTranscripts.set(numKey, value.map(deserializeChatMessage));
      }
    }
  }

  // streamedQuestions: SerializedQuestion[] → Question[]
  const streamedQuestions: Question[] = Array.isArray(persisted.streamedQuestions)
    ? persisted.streamedQuestions.map(deserializeQuestion)
    : [];

  return {
    sessionId: persisted.sessionId ?? null,
    latestPlannerResponse: persisted.latestPlannerResponse ?? null,
    answers: persisted.answers && typeof persisted.answers === 'object' ? persisted.answers : {},
    questionStatuses,
    streamedQuestions,
    streamedAnswers: persisted.streamedAnswers && typeof persisted.streamedAnswers === 'object' ? persisted.streamedAnswers : {},
    latestFolder: persisted.latestFolder ?? null,
    incrementStatuses,
    activeIncrementId: persisted.activeIncrementId ?? null,
    prefetchedSpecs,
    partStatuses,
    activePartIndex: persisted.activePartIndex ?? null,
    currentJobId: persisted.currentJobId ?? null,
    partTranscripts,
    hasBootstrapped: persisted.hasBootstrapped ?? false,
    hasPlan: persisted.hasPlan ?? false,
    hasTriggeredOrchestration: persisted.hasTriggeredOrchestration ?? false,
    inputDraft: persisted.inputDraft ?? '',
    messages: Array.isArray(persisted.messages)
      ? persisted.messages.map(deserializeChatMessage)
      : [],
    // Test Engineer fields
    latestTestPlannerResponse: persisted.latestTestPlannerResponse ?? null,
    hasTestPlan: persisted.hasTestPlan ?? false,
    teAnswers: persisted.teAnswers && typeof persisted.teAnswers === 'object' ? persisted.teAnswers : {},
    teQuestionStatuses: (() => {
      const m = new Map<string, 'Open' | 'Answered'>();
      if (persisted.teQuestionStatuses && typeof persisted.teQuestionStatuses === 'object') {
        for (const [k, v] of Object.entries(persisted.teQuestionStatuses)) {
          if (v === 'Open' || v === 'Answered') m.set(k, v);
        }
      }
      return m;
    })(),
    // Spec intent texts
    specIntentTexts: (() => {
      const m = new Map<string, string>();
      if (persisted.specIntentTexts && typeof persisted.specIntentTexts === 'object') {
        for (const [k, v] of Object.entries(persisted.specIntentTexts)) {
          if (typeof v === 'string') m.set(k, v);
        }
      }
      return m;
    })(),
    // Shape-spec session ID
    shapeSpecSessionId: persisted.shapeSpecSessionId ?? null,
  };
}

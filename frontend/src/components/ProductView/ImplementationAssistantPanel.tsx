/**
 * ImplementationAssistantPanel Component
 *
 * Spec 2026-01-03: Product Implement View (Stage 5 - Increment 4)
 * Updated for Spec 2026-01-09: Implement Chat - Planner Conversation Loop (Iteration 2)
 * Updated for Spec 2026-01-09: Implement Generate Specs - Iteration 4
 * Task Group 5: Full chat integration with Implement button and generate_specs support.
 *
 * Spec 2026-01-10: Preserve Implement Tab State Across Product & Delivery Tab Switches
 * Task Group 3: Chat state hydration and persistence
 * - Hydrates chat state from context on mount when stored state exists
 * - Persists chat state to context on state changes (write-through)
 * - Preserves inputDraft across tab switches
 *
 * Spec 2026-01-11: Fix Infinite Re-render Loop in Implementation Assistant
 * Task Group 2: Consumer Component Fixes
 * - Destructure context methods at component top level
 * - Fix persistChatState callback dependencies (remove uiStateContext)
 * - Fix hydration useEffect dependencies (use stable getImplementChatState)
 *
 * Spec 2026-01-13: Fix Implement Context Resolution Plumbing
 * - Added filename to buildContext() for Gateway context resolution
 *
 * Spec 2026-01-13: Implement Assistant Stage 2 - Phased Conversations
 * - Added phase parameter to buildContext() function
 * - handleSend passes phase: 'refine' for exploratory dialog
 * - handleImplement passes phase: 'handoff' for spec generation
 *
 * Spec 2026-01-13: Implement Assistant Stage 3 - Bootstrap Phase
 * - Added isBootstrapping, hasBootstrapped state variables
 * - Added triggerBootstrap() callback for auto-triggered context loading
 * - Added useEffect hook to trigger bootstrap on mount when messages empty
 * - Updated UI to show "Initializing assistant..." loading state
 * - Persists hasBootstrapped to context state
 *
 * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
 * - Import useProject hook to get projectParentFolder
 * - Added projectParentFolder, featureId, featureTitle to buildContext()
 * - Updated handleExecute() to pass projectParentFolder and sessionId
 *
 * Spec 2026-01-16: Fix Implement Assistant Context Injection
 * - Changed buildContext to construct typed entity IDs in format "<entity_type>::<entity_id>"
 * - This enables the backend ImplementContextResolutionService to correctly parse and resolve entities
 *
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 * - Added disk hydration useEffect to load conversation from GET /api/implement-conversations
 * - Hydration order: context state -> disk -> bootstrap
 * - Sets hasBootstrapped: true when hydrating from disk to prevent duplicate bootstrap
 *
 * Spec 2026-01-16: Fix Implement Conversation Rehydration Path Alignment
 * Task Group 3: Frontend Hydration useEffect Updates
 * - Added guard clause for undefined projectParentFolder to prevent disk hydration
 * - Updated getImplementConversation call to pass projectParentFolder and workItemTitle
 * - Added activeProject?.projectParentFolder and workItemTitle to useEffect dependencies
 *
 * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End
 * Task Group 2: buildContext() Enhancement
 * - Added entities[] array construction from contextState.entity_refs
 * - Added diagrams[] array construction from contextState.diagram_refs
 * - Includes entity_type, entity_id, bundle_type, depth for each entity
 * - Includes diagram_id, bundle_type for each diagram
 * - depth defaults to 1 when undefined in EntityRef
 * - Maintains backward-compatible entityIds/diagramIds arrays
 *
 * Spec 2026-01-18: Planner to Implementor Handoff via Orchestrations API
 * Task Group 4: Implement Button Integration and UI States
 * - Added isImplementing state for tracking orchestration API request
 * - Import extraction and transformation utilities from proposedDefinitionExtractor
 * - Updated handleImplement to extract PROPOSED and call startOrchestration
 * - Updated canImplement to check for PROPOSED marker in messages
 * - Added confirmation/error messages for orchestration results
 * - Added debug logging for generated shape-spec payload
 *
 * Spec 2026-01-22: Feature Shaping UI Consumes Planner JSON
 * Task Group 6: Split Layout and Responsive Design
 * - Added split panel layout (65% Feature / 35% Chat)
 * - Added latestPlannerResponse state for Feature Definition panel
 * - Added mobile tab bar for responsive design
 * - Updates latestPlannerResponse when valid plannerResponse received
 *
 * Spec 2026-01-23: Questions System v1
 * Task Group 7: ImplementationAssistantPanel Integration
 * - Added answers state (Record<string, string>) for question answers
 * - Added questionStatuses state (Map<string, 'Open' | 'Answered'>)
 * - Added handleSubmitAnswers callback for answer submission
 * - Added isSubmittingAnswers state for loading state
 *
 * Spec 2026-01-23: Implement Triggers Plan Generation
 * Task Group 6: ImplementationAssistantPanel Integration
 * - Added activeIncrementId state for selected increment
 * - Added generateImplementationPlan callback
 *
 * Spec 2026-01-23: Execute Increment Pipeline
 * Task Group 4: Pipeline Execution Integration
 * - Added incrementStatuses state Map for tracking status per increment
 * - Added getIncrementStatus callback
 * - Added onStartImplementation callback
 *
 * Spec 2026-01-24: Implement Screen Change 1 - Remove RHS WorkItemSummaryPanel
 * Task Group 4: ImplementationAssistantPanel Props Update
 * - Added epicName, contextLoading, onAddContext props
 * - Added onRemoveEntityChip, onRemoveDiagramChip props
 *
 * Spec 2026-01-25: Implement Click Sends "Generate implementation plan" Message
 * Task Group 1: Optimistic User Message in generateImplementationPlan
 * - Added generateImplementationPlan() callback for plan generation
 * - Inserts optimistic user message immediately on button click
 * - Message content: "Generate implementation plan"
 * - Message sent to API (replaces empty string pattern)
 * - Follows same pattern as handleSend() and handleSubmitAnswers()
 *
 * Spec 2026-01-26: Implement Context Include Relationships and Propagate to Planner Payload
 * Task Group 5: Frontend Chat Payload Changes
 * - Added relationships[] array construction from contextState.relationship_refs
 * - Added relationshipIds[] array construction for legacy compatibility
 * - Each relationship includes relationship_type, relationship_id, label
 * - Included in architectureContext for planner LLM access
 *
 * Spec 2026-01-28: Implement Button Starts Shape-Spec Stream
 * Task Group 4: Implement Button Handler Replacement
 * - Added isStreaming state for tracking stream
 * - Added startShapeSpecStreamCallback for initiating shape-spec stream
 * - Replace generateImplementationPlan() call with shape-spec stream initiation
 * - Added onStart, onContent, onDone, onError stream callbacks
 * - Button disabled during active stream (isStreaming check)
 * - Software Developer messages use persona and purple color
 *
 * Spec 2026-01-28: Shape-Spec 2 - Streaming Event Contract + Open Questions Loop
 * Task Group 3: Add Streamed Questions and Folder State
 * - Added streamedQuestions state for Software Developer questions
 * - Added latestFolder state for implementation folder
 * - Added receivedQuestionsInTurn ref for tracking questions in current turn
 * - Added handleQuestionsEvent callback for onQuestions
 * - Added handleFolderEvent callback for onFolder
 * - Updated startShapeSpecStreamCallback to pass new callbacks
 * - Updated onDone to clear questions if none received in turn
 * - Reset state on workItemId change
 *
 * Task Group 4: Integrate Streamed Questions with QuestionsTable and Answer Flow
 * - Added streamedAnswers state for tracking answers to streamed questions
 * - Added handleStreamedAnswerChange callback for answer editing
 * - Added handleAnswerStreamedQuestions callback for continuation flow
 * - Added canAnswerStreamedQuestions computed variable for button enable/disable
 * - Updated FeatureDefinitionPanel to receive streamed questions props
 * - Updated onDone to clear streamedAnswers when no questions returned
 *
 * Spec 2026-01-28: Shape-Spec 3 - Trigger Orchestration
 * Task Group 1: Add hasTriggeredOrchestration State Variable
 * - Added hasTriggeredOrchestration useState for orchestration guard flag
 * - Session-scoped state, not persisted to ImplementChatUiState
 * - Resets to false when workItemId changes
 *
 * Task Group 2: Create Orchestration Trigger Function
 * - Added triggerOrchestration helper function
 * - Implements guard check for hasTriggeredOrchestration
 * - Implements missing folder error handling with chat message
 * - Implements orchestration API call with company/project/spec_intents
 * - Implements success message handling for HTTP 200/201
 * - Implements failure handling with user-friendly error message
 *
 * Task Group 3: Add Detection Logic to onDone Callbacks
 * - Added orchestration trigger detection to startShapeSpecStreamCallback onDone
 * - Added orchestration trigger detection to handleAnswerStreamedQuestions onDone
 * - Detection conditions: no questions in turn AND streamedQuestions already empty
 * - Detection runs BEFORE async state updates to ensure accurate condition checking
 * - Calls triggerOrchestration(latestFolder) when all conditions met
 *
 * Task Group 4: Verify Message Styling
 * - Updated currentPhase prop to persist 'implementation_clarification' when orchestration triggered
 * - Ensures success/error messages render with Software Developer persona (purple styling)
 * - Phase remains 'implementation_clarification' for messages added after streaming completes
 *
 * Spec 2026-01-30: Fix /api/v1 Streaming Chat Bubbles
 * Task Group 1: Force Persona on /api/v1 Messages
 * - Added persona: 'Software Developer' to all /api/v1 message creation points
 * - startShapeSpecStreamCallback initial message stamped with persona at creation
 * - handleAnswerStreamedQuestions initial message stamped with persona at creation
 * - triggerOrchestration success/error messages stamped with persona at creation
 * - User messages (composed Q/A) do NOT have persona field (user messages never have persona)
 *
 * Task Group 2: Streaming Refactor - New Message Per Delta
 * - Removed streamingMessageId state variable
 * - Removed streamedContentRef ref
 * - Updated onContent to create NEW ChatMessage per delta (not accumulate)
 * - Skip empty/whitespace-only deltas
 * - Updated onDone handlers to not reference removed accumulator state
 * - Updated onError handlers to create new error message instead of updating existing
 * - Updated workItemId change reset logic to not reference removed state

 * Spec 2026-01-30: Force RHS Team Chat Scroll to Bottom
 * Task Group 2: ImplementationAssistantPanel Scroll Control
 * - Added messagesContainerRef for scroll control ownership
 * - Added unconditional scroll-to-bottom useEffect on messages change
 * - Passes disableAutoScroll={true} to ChatMessageList
 * - Uses requestAnimationFrame for reliable DOM timing
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Task Group 6: Integration and Wiring
 * - Added part workflow state: partStatuses, activePartIndex, currentJobId, partTranscripts
 * - Added split plan detection useEffect to initialize part workflow
 * - Added handleRetryOrchestration for FAILED part retry
 * - Added handleResumeQA for FAILED part Q&A resume
 * - Added handlePartClick for part selection
 * - Added job polling loop with 2-second interval
 * - Added workflow completion detection
 * - Integrated part props with FeatureDefinitionPanel
 *
 * Features:
 * - Split layout: 65% Feature Definition (left), 35% Team Chat (right)
 * - Chat interface with ChatInput and ChatMessageList components
 * - Empty state message when no messages
 * - Session management per work item (resets on workItemId change)
 * - Constructs context for implement_feature mode API calls
 * - Implement button in feature footer for generating specs
 * - Generated specs display panel
 * - Chat state persistence across tab switches
 * - Auto-bootstrap on mount for rich context loading
 * - Disk-based conversation rehydration on app restart
 * - Questions system with answer state management
 * - Implementation plan with increment selection
 * - Shape-spec streaming with Software Developer chat messages
 * - Streamed questions from Software Developer with folder state
 * - Q&A loop for streamed questions with continuation flow
 * - Orchestration guard flag to prevent duplicate triggers
 * - Automatic orchestration trigger when questions complete
 * - Multi-bubble streaming: each delta creates a new message
 * - Part-based sequential workflow for split implementation plans
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair
 * Task Group 5: Implement-flow repairs
 * - Retired the legacy handleExecute/executeOrchestration path (gateway
 *   POST /execute is deleted; the v2 jobs path is the surviving mechanism)
 * - Fixed handleRetryOrchestration to send the spec FOLDER name as spec_name
 * - startJobPolling consumes the full JobDetailResponse: live progress while
 *   queued/running, defensive git-outcome extraction on completion
 * - Git outcome (branch/PR/logs) persisted onto the AMS work item and
 *   re-rendered on return to the Implement screen
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ChatMessageList } from '../chat/ChatMessageList';
import {
  ChatMessage,
  ImplementChatContext,
  ImplementChatIntent,
  ImplementChatPhase,
  postChatMessage,
  HandoffPlanResponse,
  getImplementConversation,
  getImplementState,
  putImplementState,
  convertMessageEntryToChatMessage,
  EntityBundleSelection,
  DiagramBundleSelection,
  PlannerResponse,
  TestPlannerResponse,
  RelationshipContextPayload,
  Question,
  Increment,
  ChatMessagePersona,
} from '../../api/chatApi';
import {
  serializeImplementState,
  deserializeImplementState,
} from '../../utils/implementStateSerializer';
import {
  startOrchestrationJob,
  pollJobStatus,
  type SpecIntent,
} from '../../api/orchestrationApi';
import { getOrganisationById } from '../../api/organisationsApi';
import { ContextState } from '../../utils/contextStorage';
import {
  useProductUiState,
  deriveProjectKey,
  ImplementChatUiState,
} from '../../contexts/ProductUiStateContext';
import { useProject } from '../../contexts/ProjectContext';
import {
  extractProposedDefinition,
} from '../../utils/proposedDefinitionExtractor';
import { composeSpecIntent, composeFullFeatureContext } from '../../utils/specIntentComposer';
import { resolveAndFormatArchitectureContext, appendArchitectureContext, fetchArchitectureExplainer } from '../../utils/formatArchitectureContext';
import { useShapeSpecStream } from '../../hooks/useShapeSpecStream';
import { FeatureDefinitionPanel } from './FeatureDefinitionPanel';
import { SpecViewerModal } from './SpecViewerModal';
import type { Part, PartStatus } from '../../types/part';
import type { StoryRefinementOutput, HolisticReviewData, RefinementProgress } from '../../types/featureRefinement';
import { createWorkItem, fetchWorkItems, updateWorkItem } from '../../api/workItemsApi';
import { extractGitOutcome, hasGitOutcome, type GitOutcome } from '../../utils/extractGitOutcome';
import styles from './ImplementationAssistantPanel.module.css';
import { Trash2 } from 'lucide-react';

/**
 * Increment status type for pipeline execution workflow.
 * Spec 2026-01-23: Execute Increment Pipeline - Task Group 1
 */
export type IncrementStatus =
  | 'NOT_STARTED'
  | 'SPEC_READY'
  | 'IN_CLARIFICATION'
  | 'READY_TO_EXECUTE'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED';

/**
 * Live progress of the orchestration job currently being polled.
 * Spec 2026-06-12: surfaced during polling instead of silence.
 */
interface ActiveJobProgress {
  /** Part the running job belongs to */
  partIndex: number;
  /** Non-terminal job status */
  status: 'queued' | 'running';
  /** Step-level progress fields (all optional upstream) */
  currentStep?: number;
  totalSteps?: number;
  stepDescription?: string;
  percentage?: number;
}

/** Map Increment[] to Part[] — direct field copy since both share the same shape. */
function incrementsToParts(increments: Increment[]): Part[] {
  return increments.map((inc, idx) => ({
    partIndex: inc.partIndex ?? idx + 1,
    title: inc.title,
    intent: inc.intent,
    dependencies: inc.dependencies,
  }));
}

/**
 * Props interface for ImplementationAssistantPanel
 *
 * Spec 2026-01-24: Added epicName, contextLoading, onAddContext, onRemoveEntityChip, onRemoveDiagramChip
 */
export interface ImplementationAssistantPanelProps {
  /** Work item unique identifier */
  workItemId: string;
  /** Work item title */
  workItemTitle: string;
  /** Work item type (e.g., Feature, Story, Epic) */
  workItemType: string;
  /** Work item description */
  workItemDescription: string;
  /** Project identifier (architecture filename) */
  projectId: string;
  /** Project UUID from project table PK, for work-item API calls */
  projectUuid?: string;
  /** Context state containing linked entity_refs and diagram_refs */
  contextState: ContextState;
  /** Optional parent Epic name for display in FeatureHeader */
  epicName?: string;
  /** Optional parent Feature name for display in FeatureHeader (when working on a Story) */
  featureName?: string;
  /** Sibling work items under the same parent (title, description, status) for scope boundary awareness */
  siblingStories?: Array<{ title: string; description: string | null; status: string }>;
  /** Whether context is being loaded from backend */
  contextLoading?: boolean;
  /** Callback when "Add context" button is clicked */
  onAddContext?: () => void;
  /** Callback when an entity chip's remove button is clicked */
  onRemoveEntityChip?: (entityId: string) => void;
  /** Callback when a diagram chip's remove button is clicked */
  onRemoveDiagramChip?: (diagramId: string) => void;
  /** Message to auto-send into chat (set by context modal "Send" button) */
  autoSendMessage?: string | null;
  /** Callback when auto-send message has been consumed */
  onAutoSendComplete?: () => void;
  /** Refinement mode: 'standard' (default), 'refine' (PM+TE only), 'refine_and_implement' (PM+TE+SD) */
  refinementMode?: 'standard' | 'refine' | 'refine_and_implement' | 'holistic_only';
  /** Multi-story refinement progress (for inline progress display) */
  refinementProgress?: RefinementProgress;
  /** Callback fired when refinement completes for the current work item (hasTestPlan transitions to true) */
  onRefinementComplete?: (output?: StoryRefinementOutput) => void;
  /** When provided, skip PM flow and run holistic TE review with accumulated story data */
  holisticReviewData?: HolisticReviewData | null;
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Job polling interval in milliseconds.
 * Spec 2026-02-06: 2-second interval (fixed, no backoff in v1)
 */
const JOB_POLLING_INTERVAL_MS = 2000;

/**
 * ImplementationAssistantPanel Component
 *
 * Provides a split-panel interface with Feature Definition (65%) and Team Chat (35%).
 * Uses implement_feature mode to bypass tool execution on the Gateway.
 * Includes Implement button for generating specs.
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Task Group 6: Integration and Wiring
 * - Detects split plan and initializes part workflow state
 * - Handles part-based Q&A and orchestration job polling
 * - Supports manual intervention (retry, resume) for failed parts
 * - Auto-advances to next part on completion
 */
export function ImplementationAssistantPanel({
  workItemId,
  workItemTitle,
  workItemType,
  workItemDescription,
  projectId,
  projectUuid,
  contextState,
  epicName,
  featureName,
  siblingStories,
  contextLoading,
  onAddContext,
  onRemoveEntityChip,
  onRemoveDiagramChip,
  autoSendMessage,
  onAutoSendComplete,
  refinementMode = 'standard',
  refinementProgress,
  onRefinementComplete,
  holisticReviewData,
}: ImplementationAssistantPanelProps) {
  // Spec 2026-01-10: Access UI state context for chat state persistence
  // Spec 2026-01-11 Task Group 2: Destructure context methods at top level
  // This enables using individual methods in dependency arrays instead of the entire context
  const uiStateContext = useProductUiState();
  const { getImplementChatState, setImplementChatState } = uiStateContext;

  // Spec 2026-01-15: Get active project for projectParentFolder
  const activeProject = useProject();

  // Spec 2026-01-28: Use shape-spec stream hook
  const { startStream, isStreaming: hookIsStreaming, abort: abortStream } = useShapeSpecStream();

  const projectKey = deriveProjectKey(projectId);

  // Session state - resets when workItemId changes (unless hydrating from context)
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState('');

  // Generated specs state - Iteration 4
  const [generatedSpecs, setGeneratedSpecs] = useState<string[] | null>(null);

  // Spec 2026-01-14: Handoff plan state
  const [handoffPlan, setHandoffPlan] = useState<HandoffPlanResponse | null>(null);

  // Spec 2026-01-13: Bootstrap phase state
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [hasBootstrapped, setHasBootstrapped] = useState(false);

  // Spec 2026-06-12: Live progress of the orchestration job being polled
  const [jobProgress, setJobProgress] = useState<ActiveJobProgress | null>(null);

  // Spec 2026-06-12: Git outcome persisted on the AMS work item
  // (implementation_branch / implementation_pr_url / implementation_logs_url).
  // Loaded on mount so the outcome survives leaving the screen.
  const [persistedGitOutcome, setPersistedGitOutcome] = useState<GitOutcome | null>(null);

  // Spec 2026-01-18: Implementing state for orchestration API call
  const [isImplementing, setIsImplementing] = useState(false);

  // Spec 2026-01-28: Streaming state for shape-spec stream
  // Task Group 4: Task 4.2 - Add streaming state
  // Spec 2026-01-30 Task Group 2: Removed streamingMessageId and streamedContentRef (multi-bubble pattern)
  const [isStreaming, setIsStreaming] = useState(false);

  // Tracks whether the user has clicked "Answer Open Questions" and the
  // answer-continuation stream is in progress. Distinct from isStreaming
  // (which is true for ANY active shape-spec stream, including the initial
  // one that delivers questions mid-stream). Using isStreaming for the
  // QuestionsTable isSubmitting prop caused a regression where questions
  // rendered in "Submitting..." state immediately on arrival.
  const [isSubmittingStreamedAnswers, setIsSubmittingStreamedAnswers] = useState(false);

  // Responding persona indicator — set at request time based on api path, cleared on response
  // 'Product Manager' for api/chat calls, 'Software Developer' for api/v1 streams
  const [respondingPersona, setRespondingPersona] = useState<ChatMessagePersona | null>(null);

  // Spec 2026-02-11: Whether the background prefetch loop is running (fetching specs for inc 2+).
  // Used for the multi-persona activity indicator.
  const [isPrefetching, setIsPrefetching] = useState(false);

  // Spec 2026-01-28: Shape-Spec 2 - Task Group 3
  // Task 3.2: Add streamedQuestions state variable
  // Type: Question[] - separate from latestPlannerResponse.openQuestions
  const [streamedQuestions, setStreamedQuestions] = useState<Question[]>([]);

  // Spec 2026-01-28: Shape-Spec 2 - Task Group 3
  // Task 3.3: Add latestFolder state variable
  // Type: string | null - persists across stream turns, resets on workItem change
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_latestFolder, setLatestFolder] = useState<string | null>(null);

  // Ref mirror of latestFolder for use in stream onDone closures (avoids stale closure bug)
  const latestFolderRef = useRef<string | null>(null);

  // Shape-spec session ID received from the SSE stream.
  // Stored for use in continuation streams (session_mode: 'resume') and orchestration requests.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_shapeSpecSessionId, setShapeSpecSessionId] = useState<string | null>(null);
  const shapeSpecSessionIdRef = useRef<string | null>(null);

  // Spec 2026-01-28: Shape-Spec 2 - Task Group 3
  // Task 3.4: Add receivedQuestionsInTurn ref to track if questions were received
  // Reset to false when stream starts, set to true when questions event received
  // Used by onDone to determine if questions should be cleared
  const receivedQuestionsInTurn = useRef<boolean>(false);

  // Spec 2026-01-28: Shape-Spec 2 - Task Group 4
  // Task 4.2: Add streamedAnswers state for tracking answers to streamed questions
  // Type: Record<string, string> (questionId -> answer)
  // Reset when streamedQuestions changes (new questions replace old answers)
  const [streamedAnswers, setStreamedAnswers] = useState<Record<string, string>>({});

  // Spec 2026-01-28: Shape-Spec 3 - Task Group 1
  // Task 1.1: Add hasTriggeredOrchestration state variable
  // Guard flag to prevent duplicate orchestration calls within same session
  // Session-scoped only - not persisted to ImplementChatUiState
  // Resets to false when workItemId changes
  const [hasTriggeredOrchestration, setHasTriggeredOrchestration] = useState<boolean>(false);

  // Spec 2026-02-10: Auto-trigger implementation planning
  // Tracks whether implementation planning (Phase A) has completed.
  // The Implement button is gated on this flag instead of canImplementBase.
  const [hasPlan, setHasPlan] = useState(false);

  // Spec 2026-01-16: Track if disk hydration has been attempted
  const [isDiskHydrationComplete, setIsDiskHydrationComplete] = useState(false);

  // Spec 2026-01-22: Track latest planner response for Feature Definition panel
  const [latestPlannerResponse, setLatestPlannerResponse] = useState<PlannerResponse | null>(null);

  // Spec 2026-03-18: Test Engineer test_planning phase state
  const [latestTestPlannerResponse, setLatestTestPlannerResponse] = useState<TestPlannerResponse | null>(null);
  const [hasTestPlan, setHasTestPlan] = useState(false);
  const [isTestPlanning, setIsTestPlanning] = useState(false);
  const [teAnswers, setTeAnswers] = useState<Record<string, string>>({});
  const [teQuestionStatuses, setTeQuestionStatuses] = useState<Map<string, 'Open' | 'Answered'>>(new Map());
  // Spec 2026-03-21: Guard ref to prevent auto-trigger from re-firing triggerTestPlanning
  // after it completes with open questions (hasPlan && !hasTestPlan && !isTestPlanning
  // would otherwise be true again, causing a second API call that overwrites the questions).
  const testPlanningTriggeredRef = useRef(false);

  // Spec 2026-01-23: Questions System v1 - Answers for open questions
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Spec 2026-01-24: Question statuses (Open/Answered) - managed explicitly after submit success
  const [questionStatuses, setQuestionStatuses] = useState<Map<string, 'Open' | 'Answered'>>(new Map());

  // Spec 2026-01-23: Track if answers are being submitted
  const [isSubmittingAnswers, setIsSubmittingAnswers] = useState(false);

  // Spec 2026-01-23: Active increment ID for implementation plan
  const [activeIncrementId, setActiveIncrementId] = useState<string | null>(null);

  // Spec 2026-01-23: Increment statuses for pipeline execution
  const [incrementStatuses, setIncrementStatuses] = useState<Map<string, IncrementStatus>>(new Map());

  // Spec 2026-03-15: Stored spec intent text per increment for "See Spec" modal
  const [specIntentTexts, setSpecIntentTexts] = useState<Map<string, string>>(new Map());
  const [specViewerModal, setSpecViewerModal] = useState<{ incrementId: string } | null>(null);

  // Spec 2026-03-15: Cached meta-model explainer for architecture context
  const architectureExplainerRef = useRef<string | null>(null);
  useEffect(() => {
    fetchArchitectureExplainer().then((text) => {
      architectureExplainerRef.current = text;
    });
  }, []);

  // Spec 2026-01-22: Mobile tab switching for responsive layout
  const [activeTab, setActiveTab] = useState<'feature' | 'chat'>('feature');

  // Spec 2026-03-15: Clear conversation confirmation modal state
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  // Track if we're currently persisting to avoid feedback loops
  const isPersisting = useRef(false);
  // Track the previous workItemId to detect changes
  const prevWorkItemIdRef = useRef<string | null>(null);

  // Spec 2026-01-30: Force RHS Team Chat Scroll to Bottom - Task Group 2
  // Task 2.2: Add messagesContainerRef for scroll control
  // This ref targets the div.messagesContainer element that owns the scrollbar
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Spec 2026-02-11: Refs for debounced disk state persistence
  const isPersistingState = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushStateToDiskRef = useRef<() => Promise<void>>(() => Promise.resolve());
  // Set to true when disk hydration successfully restored full state.
  // Prevents the key-change useEffect from resetting disk-managed fields.
  const hydratedFromDiskStateRef = useRef(false);
  // Guards the disk hydration effect to run exactly once per workItemId.
  // Uses a ref instead of isDiskHydrationComplete state to avoid
  // React 18 StrictMode batching race conditions.
  const diskHydrationAttemptedRef = useRef(false);

  // =========================================================================
  // Spec 2026-02-06: Part Workflow State
  // Task Group 6: Integration and Wiring
  // =========================================================================

  /**
   * Task 6.2: Part statuses map for tracking per-part workflow state.
   * Map of partIndex -> PartStatus
   * Only used when isSplit=true in plannerResponse.implementationPlan
   */
  const [partStatuses, setPartStatuses] = useState<Map<number, PartStatus>>(new Map());

  /**
   * Task 6.2: Currently active/selected part index (null = none selected).
   * Used to display the correct transcript in the RHS panel.
   */
  const [activePartIndex, setActivePartIndex] = useState<number | null>(null);

  /**
   * Task 6.3: Current job ID for polling (null when no job is running).
   * Tracks the active orchestration job for the current part.
   */
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  /**
   * Task 6.8: Per-part transcripts for displaying in RHS panel.
   * Map of partIndex -> ChatMessage[] for each part's Q&A history.
   */
  const [partTranscripts, setPartTranscripts] = useState<Map<number, ChatMessage[]>>(new Map());

  /**
   * Spec 2026-02-11: Pre-fetched detailed specs per part index.
   * Populated in parallel by the background prefetch loop so that
   * autoAdvanceToNextPart can skip the planner call when a spec is cached.
   */
  const [prefetchedSpecs, setPrefetchedSpecs] = useState<Map<number, PlannerResponse>>(new Map());

  /**
   * Ref tracking activePartIndex for stable callback identities.
   * Updated via a synchronization effect so that callbacks like
   * handleQuestionsEvent can read the current value without depending
   * on the state variable (which would cause callback recreation).
   */
  const activePartIndexRef = useRef<number | null>(activePartIndex);
  activePartIndexRef.current = activePartIndex;

  /**
   * Ref to track job polling interval ID for cleanup.
   */
  const jobPollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Ref to track the latest autoAdvanceToNextPart callback.
   * Used by startJobPolling to avoid stale closure issues (startJobPolling has [] deps).
   */
  const autoAdvanceRef = useRef<(completedPartIndex: number) => void>(() => {});

  /**
   * Ref for startJobPolling to allow forward-reference from triggerPartOrchestration.
   * startJobPolling is defined later in the file but triggerPartOrchestration needs to call it.
   */
  const startJobPollingRef = useRef<(partIndex: number, jobId: string) => void>(() => {});

  /**
   * Spec 2026-06-12: Ref for persistGitOutcome so the polling loop (which has
   * minimal deps) always calls the latest version without stale closures.
   */
  const persistGitOutcomeRef = useRef<(outcome: GitOutcome) => Promise<void>>(async () => {});

  /**
   * Spec 2026-02-11: Map partIndex to incrementId.
   * Parts are 1-indexed; increments array is 0-indexed.
   * Falls back to "INC-{partIndex}" if plan is unavailable.
   */
  const partIndexToIncrementId = useCallback((partIndex: number): string => {
    const plan = latestPlannerResponse?.implementationPlan;
    return plan?.increments?.[partIndex - 1]?.id ?? `INC-${partIndex}`;
  }, [latestPlannerResponse]);

  /**
   * Spec 2026-02-11: Update increment status for a given partIndex.
   * Convenience wrapper combining partIndexToIncrementId + setIncrementStatuses.
   */
  const setIncrementStatusForPart = useCallback((partIndex: number, status: IncrementStatus) => {
    const incId = partIndexToIncrementId(partIndex);
    setIncrementStatuses((prev) => {
      const updated = new Map(prev);
      updated.set(incId, status);
      return updated;
    });
  }, [partIndexToIncrementId]);

  /**
   * Spec 2026-01-18: Check if PROPOSED marker exists in messages
   * This is used to determine if the Implement button should be enabled
   */
  const hasProposedDefinition = useMemo(() => {
    return extractProposedDefinition(messages) !== null;
  }, [messages]);

  /**
   * Spec 2026-01-23: Check if planner is ready for spec generation
   * Used for 3-phase button enablement
   */
  const canImplementBase = useMemo(() => {
    // Phase 1: Button disabled - no valid planner definition yet
    if (!latestPlannerResponse) return false;

    // Phase 2: Button disabled - planner not ready for spec
    if (!latestPlannerResponse.plannerReadyForSpec) return false;

    // Phase 2: Button disabled - has unanswered open questions
    const openQuestions = latestPlannerResponse.openQuestions || [];
    const hasUnansweredQuestions = openQuestions.some(q => {
      const status = questionStatuses.get(q.id);
      return status !== 'Answered';
    });
    if (hasUnansweredQuestions) return false;

    // Phase 3: Button enabled
    return true;
  }, [latestPlannerResponse, questionStatuses]);

  /**
   * Spec 2026-01-28: Shape-Spec 2 - Task Group 4
   * Task 4.5: Compute button enable/disable state for "Answer Open Questions"
   *
   * Enable when:
   * - streamedQuestions.length > 0 AND
   * - All questions have non-empty answers AND
   * - !isStreaming
   */
  const canAnswerStreamedQuestions = useMemo(() => {
    // Must have at least one streamed question
    if (streamedQuestions.length === 0) return false;

    // Must not be streaming
    if (isStreaming) return false;

    // All questions must have non-empty answers
    const allQuestionsAnswered = streamedQuestions.every((q) => {
      const answer = streamedAnswers[q.id];
      return answer && answer.trim().length > 0;
    });

    return allQuestionsAnswered;
  }, [streamedQuestions, streamedAnswers, isStreaming]);

  /**
   * Spec 2026-02-06: Task Group 6 - Task 6.7
   * Detect when all parts have reached COMPLETED status.
   */
  const allPartsCompleted = useMemo(() => {
    if (partStatuses.size === 0) return false;
    return Array.from(partStatuses.values()).every((status) => status === 'COMPLETED');
  }, [partStatuses]);

  /**
   * Spec 2026-02-06: Task Group 6 - Task 6.2
   * Determine if we should use part-based workflow vs increment-based workflow.
   */
  const useSplitWorkflow = useMemo(() => {
    const plan = latestPlannerResponse?.implementationPlan;
    return (plan?.increments?.length ?? 0) > 1;
  }, [latestPlannerResponse]);

  /**
   * Spec 2026-01-10: Helper to persist current chat state to context
   *
   * Spec 2026-01-11 Task Group 2: Fixed dependencies
   * - Removed uiStateContext from dependency array
   * - Added setImplementChatState to dependencies (already stable with [] deps)
   *
   * Spec 2026-01-13: Added hasBootstrapped to persisted state
   */
  const persistChatState = useCallback(() => {
    if (!projectKey || !workItemId || isPersisting.current) return;

    isPersisting.current = true;
    const chatState: ImplementChatUiState = {
      sessionId,
      messages,
      generatedSpecs,
      error,
      inputDraft: inputMessage,
      hasBootstrapped,
      handoffPlan,
      // Planner fields
      latestPlannerResponse,
      answers,
      questionStatuses,
      streamedQuestions,
      streamedAnswers,
      latestFolder: _latestFolder,
      incrementStatuses,
      activeIncrementId,
      prefetchedSpecs,
      partStatuses,
      activePartIndex,
      currentJobId,
      partTranscripts,
      hasPlan,
      hasTriggeredOrchestration,
      // Test Engineer fields
      latestTestPlannerResponse,
      hasTestPlan,
      teAnswers,
      teQuestionStatuses,
      // Spec intent texts
      specIntentTexts,
      // Shape-spec session ID for orchestration
      shapeSpecSessionId: shapeSpecSessionIdRef.current,
    };
    setImplementChatState(projectKey, workItemId, chatState);
    isPersisting.current = false;
  }, [projectKey, workItemId, sessionId, messages, generatedSpecs, handoffPlan, error, inputMessage, hasBootstrapped, latestPlannerResponse, latestTestPlannerResponse, hasTestPlan, teAnswers, teQuestionStatuses, answers, questionStatuses, streamedQuestions, streamedAnswers, _latestFolder, incrementStatuses, activeIncrementId, prefetchedSpecs, partStatuses, activePartIndex, currentJobId, partTranscripts, hasPlan, hasTriggeredOrchestration, specIntentTexts, setImplementChatState]);

  /**
   * Spec 2026-01-10: Hydrate state from context on mount or when workItemId changes
   * If stored state exists, restore it; otherwise reset to empty defaults
   *
   * Spec 2026-01-11 Task Group 2: Fixed dependencies
   * - Removed uiStateContext from dependency array
   * - Added getImplementChatState to dependencies (now stable after context fix)
   *
   * Spec 2026-01-13: Hydrates hasBootstrapped from stored state
   *
   * Spec 2026-01-16: Also resets disk hydration flag on workItemId change
   *
   * Spec 2026-01-28: Shape-Spec 2 - Task Group 3
   * Task 3.9: Reset streamedQuestions and latestFolder on workItemId change
   *
   * Spec 2026-01-28: Shape-Spec 2 - Task Group 4
   * Also reset streamedAnswers on workItemId change
   *
   * Spec 2026-01-28: Shape-Spec 3 - Task Group 1
   * Task 1.2: Reset hasTriggeredOrchestration on workItemId change
   *
   * Spec 2026-01-30: Task Group 2
   * Task 2.7: Removed references to streamingMessageId and streamedContentRef
   *
   * Spec 2026-02-06: Task Group 6
   * Also reset part workflow state on workItemId change
   */
  useEffect(() => {
    // Detect if this is a workItemId change or initial mount
    const isWorkItemChange = prevWorkItemIdRef.current !== null && prevWorkItemIdRef.current !== workItemId;
    prevWorkItemIdRef.current = workItemId;

    if (!projectKey || !workItemId) {
      // No project or work item - reset to defaults
      setSessionId(null);
      setMessages([]);
      setError(null);
      setInputMessage('');
      setGeneratedSpecs(null);
      setHasBootstrapped(false);
      setIsDiskHydrationComplete(false);
      diskHydrationAttemptedRef.current = false;
      setIsImplementing(false);
      setIsStreaming(false);
      setIsSubmittingStreamedAnswers(false);
      setRespondingPersona(null);
      setLatestPlannerResponse(null);
      setAnswers({});
      setQuestionStatuses(new Map());
      setActiveIncrementId(null);
      setIncrementStatuses(new Map());
      // Spec 2026-01-28: Shape-Spec 2 - Task Group 3 - Reset new state
      setStreamedQuestions([]);
      setLatestFolder(null);
      // Spec 2026-01-28: Shape-Spec 2 - Task Group 4 - Reset streamedAnswers
      setStreamedAnswers({});
      // Spec 2026-01-28: Shape-Spec 3 - Task Group 1 - Reset hasTriggeredOrchestration
      setHasTriggeredOrchestration(false);
      // Spec 2026-02-10: Reset hasPlan for auto-trigger flow
      setHasPlan(false);
      // Spec 2026-02-06: Task Group 6 - Reset part workflow state
      setPartStatuses(new Map());
      setActivePartIndex(null);
      setCurrentJobId(null);
      setJobProgress(null);
      setPartTranscripts(new Map());
      return;
    }

    // Try to hydrate from stored state
    const storedState = getImplementChatState(projectKey, workItemId);

    if (storedState) {
      // Hydrate from stored state (tab-switch case)
      setSessionId(storedState.sessionId);
      setMessages(storedState.messages);
      setGeneratedSpecs(storedState.generatedSpecs);
      setError(storedState.error);
      setInputMessage(storedState.inputDraft);
      setHasBootstrapped(storedState.hasBootstrapped ?? false);
      setHandoffPlan(storedState.handoffPlan ?? null);
      // NOTE: Do NOT set isDiskHydrationComplete here.
      // The disk hydration effect will set it after checking whether
      // disk state needs loading. Setting it here causes a race condition
      // with React 18 StrictMode where persistChatState creates a ghost
      // entry during the first effects pass, and this branch reads it back
      // on the second pass, permanently preventing the GET implement-state call.

      // Restore planner fields from stored state — the in-memory store now
      // carries all fields, so no conditional reset is needed.
      setLatestPlannerResponse(storedState.latestPlannerResponse ?? null);
      setAnswers(storedState.answers ?? {});
      setQuestionStatuses(storedState.questionStatuses ?? new Map());
      setStreamedQuestions(storedState.streamedQuestions ?? []);
      setStreamedAnswers(storedState.streamedAnswers ?? {});
      setLatestFolder(storedState.latestFolder ?? null);
      latestFolderRef.current = storedState.latestFolder ?? null;
      setIncrementStatuses(storedState.incrementStatuses ?? new Map());
      setActiveIncrementId(storedState.activeIncrementId ?? null);
      setPrefetchedSpecs(storedState.prefetchedSpecs ?? new Map());
      setPartStatuses(storedState.partStatuses ?? new Map());
      setActivePartIndex(storedState.activePartIndex ?? null);
      setCurrentJobId(storedState.currentJobId ?? null);
      setPartTranscripts(storedState.partTranscripts ?? new Map());
      setHasPlan(storedState.hasPlan ?? false);
      setHasTriggeredOrchestration(storedState.hasTriggeredOrchestration ?? false);
      // Test Engineer fields
      setLatestTestPlannerResponse(storedState.latestTestPlannerResponse ?? null);
      setHasTestPlan(storedState.hasTestPlan ?? false);
      setTeAnswers(storedState.teAnswers ?? {});
      setTeQuestionStatuses(storedState.teQuestionStatuses ?? new Map());
      // Prevent auto-trigger re-firing if TE already responded
      if (storedState.latestTestPlannerResponse) {
        testPlanningTriggeredRef.current = true;
      }
      // Spec intent texts
      setSpecIntentTexts(storedState.specIntentTexts ?? new Map());
      // Shape-spec session ID
      if (storedState.shapeSpecSessionId) {
        setShapeSpecSessionId(storedState.shapeSpecSessionId);
        shapeSpecSessionIdRef.current = storedState.shapeSpecSessionId;
      }
    } else if (isWorkItemChange) {
      // New work item with no stored state - reset to empty defaults
      setSessionId(null);
      setMessages([]);
      setError(null);
      setInputMessage('');
      setGeneratedSpecs(null);
      setHasBootstrapped(false);
      setHandoffPlan(null);
      // Reset disk hydration flags for new work item
      setIsDiskHydrationComplete(false);
      diskHydrationAttemptedRef.current = false;
      setIsImplementing(false);
      setIsStreaming(false);
      setIsSubmittingStreamedAnswers(false);
      setRespondingPersona(null);
      setLatestPlannerResponse(null);
      setAnswers({});
      setQuestionStatuses(new Map());
      setActiveIncrementId(null);
      setIncrementStatuses(new Map());
      // Spec 2026-01-28: Shape-Spec 2 - Task Group 3 - Reset new state
      setStreamedQuestions([]);
      setLatestFolder(null);
      // Spec 2026-01-28: Shape-Spec 2 - Task Group 4 - Reset streamedAnswers
      setStreamedAnswers({});
      // Spec 2026-01-28: Shape-Spec 3 - Task Group 1 - Reset hasTriggeredOrchestration
      setHasTriggeredOrchestration(false);
      // Spec 2026-02-10: Reset hasPlan for auto-trigger flow
      setHasPlan(false);
      // Spec 2026-02-06: Task Group 6 - Reset part workflow state
      setPartStatuses(new Map());
      setActivePartIndex(null);
      setCurrentJobId(null);
      setJobProgress(null);
      setPartTranscripts(new Map());
      // Spec 2026-03-18: Reset Test Engineer state
      setLatestTestPlannerResponse(null);
      setHasTestPlan(false);
      setIsTestPlanning(false);
      setTeAnswers({});
      setTeQuestionStatuses(new Map());
      testPlanningTriggeredRef.current = false;
    }
    // On initial mount with no stored state, we also want empty defaults
    // This case is handled by the initial useState values
  }, [projectKey, workItemId, getImplementChatState]);

  /**
   * Spec 2026-02-06: Task Group 6 - Task 6.2
   * Split plan detection useEffect.
   * When latestPlannerResponse changes and isSplit=true, initialize part workflow.
   */
  useEffect(() => {
    const plan = latestPlannerResponse?.implementationPlan;
    const increments = plan?.increments;
    if (increments && increments.length > 1) {
      const parts = incrementsToParts(increments);
      // Guard: handleImplementClick already initialises part state with the
      // first part set to QA_IN_PROGRESS.  Do not overwrite if partStatuses
      // was already populated in the same render batch.
      setPartStatuses((prev) => {
        if (prev.size > 0) return prev; // already initialised
        const newStatuses = new Map<number, PartStatus>();
        for (const part of parts) {
          newStatuses.set(part.partIndex, 'PENDING');
        }
        return newStatuses;
      });

      // Set first part as active (only if not already set)
      setActivePartIndex((prev) => {
        if (prev !== null) return prev;
        const sortedParts = [...parts].sort((a, b) => a.partIndex - b.partIndex);
        return sortedParts.length > 0 ? sortedParts[0].partIndex : null;
      });

      // Initialize empty transcripts for each part (only if not already set)
      setPartTranscripts((prev) => {
        if (prev.size > 0) return prev;
        const newTranscripts = new Map<number, ChatMessage[]>();
        for (const part of parts) {
          newTranscripts.set(part.partIndex, []);
        }
        return newTranscripts;
      });
    }
  }, [latestPlannerResponse]);

  /**
   * Spec 2026-01-16: Disk hydration useEffect
   * Attempts to load conversation from disk when context state is empty.
   * This enables conversation restoration after app restarts.
   *
   * Hydration order:
   * 1. Context state (handled by above useEffect) - for tab switches
   * 2. Disk via GET endpoint (this useEffect) - for app restarts
   * 3. Bootstrap (handled by below useEffect) - for new conversations
   *
   * Spec 2026-01-16: Fix Implement Conversation Rehydration Path Alignment
   * Task Group 3: Added guard clause for undefined projectParentFolder
   * - Prevents disk hydration attempt when project path is unknown
   * - Ensures getImplementConversation is called with all required parameters
   */
  useEffect(() => {
    // Ref-based guard: ensures disk hydration runs exactly once per workItemId.
    // Using a ref instead of isDiskHydrationComplete state avoids a race condition
    // with React 18 StrictMode where the key-change effect's storedState branch
    // can set isDiskHydrationComplete=true before this effect gets a chance to run
    // (due to persistChatState writing a ghost entry during StrictMode's first pass).
    if (diskHydrationAttemptedRef.current) {
      return;
    }

    // Prerequisite guards — these may fail on early renders (e.g. activeProject
    // not loaded yet). Because the ref is NOT set here, the effect will re-run
    // when deps change and these prerequisites are met.
    if (
      !projectKey ||
      !workItemId ||
      !activeProject?.projectParentFolder ||
      isBootstrapping ||
      isLoading
    ) {
      return;
    }

    // All prerequisites met — mark as attempted so we don't re-run
    diskHydrationAttemptedRef.current = true;

    // Check if context state has real messages (tab-switch case).
    // If so, context is authoritative and we skip disk hydration.
    const storedState = getImplementChatState(projectKey, workItemId);
    if (storedState && storedState.messages.length > 0) {
      setIsDiskHydrationComplete(true);
      return;
    }

    // Attempt disk hydration
    const hydrateFromDisk = async () => {
      try {
        // Spec 2026-02-11: Try implementation-state.json first (has user-visible messages).
        // Fall back to conversation.json only if state doesn't exist.
        let hydratedFromState = false;

        try {
          const stateResponse = await getImplementState(
            projectId,
            workItemId,
            activeProject.projectParentFolder,
            workItemTitle,
            "implement"
          );

          if (stateResponse.exists && stateResponse.state) {
            const deserialized = deserializeImplementState(stateResponse.state);
            if (deserialized) {
              // Restore user-visible messages from state
              if (deserialized.messages.length > 0) {
                setMessages(deserialized.messages);
              }
              setSessionId(deserialized.sessionId);
              setLatestPlannerResponse(deserialized.latestPlannerResponse);
              setAnswers(deserialized.answers);
              setQuestionStatuses(deserialized.questionStatuses);
              setStreamedQuestions(deserialized.streamedQuestions);
              setStreamedAnswers(deserialized.streamedAnswers);
              setLatestFolder(deserialized.latestFolder);
              latestFolderRef.current = deserialized.latestFolder;
              setIncrementStatuses(deserialized.incrementStatuses);
              setActiveIncrementId(deserialized.activeIncrementId);
              setPrefetchedSpecs(deserialized.prefetchedSpecs);
              setPartStatuses(deserialized.partStatuses);
              setActivePartIndex(deserialized.activePartIndex);
              setCurrentJobId(deserialized.currentJobId);
              setPartTranscripts(deserialized.partTranscripts);
              setHasBootstrapped(deserialized.hasBootstrapped);
              setHasPlan(deserialized.hasPlan);
              setHasTriggeredOrchestration(deserialized.hasTriggeredOrchestration);
              setInputMessage(deserialized.inputDraft);
              // Restore Test Engineer state
              if (deserialized.latestTestPlannerResponse !== undefined) {
                setLatestTestPlannerResponse(deserialized.latestTestPlannerResponse);
                // Mark test planning as already triggered to prevent auto-trigger re-firing
                if (deserialized.latestTestPlannerResponse !== null) {
                  testPlanningTriggeredRef.current = true;
                }
              }
              if (deserialized.hasTestPlan !== undefined) {
                setHasTestPlan(deserialized.hasTestPlan);
              }
              if (deserialized.teAnswers) {
                setTeAnswers(deserialized.teAnswers);
              }
              if (deserialized.teQuestionStatuses) {
                setTeQuestionStatuses(deserialized.teQuestionStatuses);
              }
              // Restore spec intent texts for "See Spec" modal
              if (deserialized.specIntentTexts && deserialized.specIntentTexts.size > 0) {
                setSpecIntentTexts(deserialized.specIntentTexts);
              }
              // Restore shape-spec session ID for orchestration
              if (deserialized.shapeSpecSessionId) {
                setShapeSpecSessionId(deserialized.shapeSpecSessionId);
                shapeSpecSessionIdRef.current = deserialized.shapeSpecSessionId;
              }
              hydratedFromState = true;
              hydratedFromDiskStateRef.current = true;
            }
          }
        } catch (stateErr) {
          console.error('Failed to hydrate implementation state from disk:', stateErr);
        }

        // Fallback: if no state file, try conversation.json for messages only
        if (!hydratedFromState) {
          const response = await getImplementConversation(
            projectId,
            workItemId,
            activeProject.projectParentFolder,
            workItemTitle,
            "implement"
          );

          if (response.exists && response.messages.length > 0) {
            const hydratedMessages = response.messages
              .filter((entry) => entry.role !== 'system')
              .map(convertMessageEntryToChatMessage);

            setMessages(hydratedMessages);
            setHasBootstrapped(true);
          }
        }

        // If neither exists, do nothing - bootstrap will trigger normally
      } catch (err) {
        // Log error but don't fail - fall back to bootstrap
        console.error('Failed to hydrate conversation from disk:', err);
      } finally {
        // Mark disk hydration as complete regardless of outcome
        setIsDiskHydrationComplete(true);
      }
    };

    hydrateFromDisk();
  }, [
    projectKey,
    workItemId,
    projectId,
    isBootstrapping,
    isLoading,
    getImplementChatState,
    // Spec 2026-01-16 Task Group 3: Added dependencies for re-hydration if these values change
    activeProject?.projectParentFolder,
    workItemTitle,
  ]);

  /**
   * Spec 2026-01-10: Persist state whenever key fields change
   * This implements write-through persistence
   *
   * Spec 2026-01-11 Task Group 2: Effect behavior verified
   * - persistChatState callback is now stable due to fixed deps
   * - Effect only re-runs on meaningful state changes
   */
  useEffect(() => {
    // Only persist after initial mount, when we have valid keys, and after
    // disk hydration is complete. The isDiskHydrationComplete guard prevents
    // writing ghost entries to the context store during React StrictMode's
    // first effects pass (which the key-change effect would then read back).
    if (projectKey && workItemId && prevWorkItemIdRef.current === workItemId && isDiskHydrationComplete) {
      persistChatState();
    }
  }, [sessionId, messages, generatedSpecs, handoffPlan, error, hasBootstrapped, latestPlannerResponse, latestTestPlannerResponse, hasTestPlan, teAnswers, teQuestionStatuses, answers, questionStatuses, streamedQuestions, streamedAnswers, _latestFolder, incrementStatuses, activeIncrementId, prefetchedSpecs, partStatuses, activePartIndex, currentJobId, partTranscripts, hasPlan, hasTriggeredOrchestration, persistChatState, projectKey, workItemId, isDiskHydrationComplete]);

  // =========================================================================
  // Spec 2026-02-11: Debounced Disk State Persistence
  // =========================================================================

  /**
   * Flushes all persisted state variables to disk via the gateway.
   * Serializes Maps to Records and Dates to ISO strings.
   * Fire-and-forget: logs errors but never throws.
   */
  const flushStateToDisk = useCallback(async () => {
    if (
      isPersistingState.current ||
      !activeProject?.projectParentFolder ||
      !workItemId ||
      !projectId
    ) {
      return;
    }

    isPersistingState.current = true;
    try {
      const serialized = serializeImplementState({
        sessionId,
        latestPlannerResponse,
        answers,
        questionStatuses,
        streamedQuestions,
        streamedAnswers,
        latestFolder: _latestFolder,
        incrementStatuses,
        activeIncrementId,
        prefetchedSpecs,
        partStatuses,
        activePartIndex,
        currentJobId,
        partTranscripts,
        hasBootstrapped,
        hasPlan,
        hasTriggeredOrchestration,
        inputMessage,
        messages,
        latestTestPlannerResponse,
        hasTestPlan,
        teAnswers,
        teQuestionStatuses,
        specIntentTexts,
        shapeSpecSessionId: shapeSpecSessionIdRef.current,
      });

      await putImplementState({
        projectId,
        featureId: workItemId,
        projectParentFolder: activeProject.projectParentFolder,
        featureTitle: workItemTitle,
        state: serialized,
        kind: "implement",
      });
    } catch (err) {
      console.error('Failed to persist implementation state to disk:', err);
    } finally {
      isPersistingState.current = false;
    }
  }, [
    activeProject?.projectParentFolder,
    workItemId,
    workItemTitle,
    projectId,
    sessionId,
    latestPlannerResponse,
    latestTestPlannerResponse,
    hasTestPlan,
    teAnswers,
    teQuestionStatuses,
    answers,
    questionStatuses,
    streamedQuestions,
    streamedAnswers,
    _latestFolder,
    incrementStatuses,
    activeIncrementId,
    prefetchedSpecs,
    partStatuses,
    activePartIndex,
    currentJobId,
    partTranscripts,
    hasBootstrapped,
    hasPlan,
    hasTriggeredOrchestration,
    inputMessage,
    messages,
    specIntentTexts,
  ]);

  // Keep ref in sync so unmount cleanup always calls the latest version
  flushStateToDiskRef.current = flushStateToDisk;

  /**
   * Debounced save: clears pending timer and sets a 2-second debounce
   * before calling flushStateToDisk.
   */
  const debouncedSaveState = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      flushStateToDisk();
    }, 2000);
  }, [flushStateToDisk]);

  /**
   * Spec 2026-02-11: Save useEffect — triggers debounced save on state changes.
   * Guarded by isDiskHydrationComplete to avoid saving during hydration.
   */
  useEffect(() => {
    if (!isDiskHydrationComplete) return;
    if (!activeProject?.projectParentFolder || !workItemId) return;

    debouncedSaveState();
  }, [
    isDiskHydrationComplete,
    activeProject?.projectParentFolder,
    workItemId,
    sessionId,
    latestPlannerResponse,
    answers,
    questionStatuses,
    streamedQuestions,
    streamedAnswers,
    _latestFolder,
    incrementStatuses,
    activeIncrementId,
    prefetchedSpecs,
    partStatuses,
    activePartIndex,
    currentJobId,
    partTranscripts,
    hasBootstrapped,
    hasPlan,
    hasTriggeredOrchestration,
    inputMessage,
    messages,
    debouncedSaveState,
  ]);

  /**
   * Spec 2026-02-11: Cleanup useEffect — on unmount, cancel timer and fire-and-forget final save.
   * Uses flushStateToDiskRef so the closure always calls the latest version.
   */
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // Fire-and-forget final save on unmount via ref (never stale)
      flushStateToDiskRef.current();
    };
  }, []);

  /**
   * Construct the implement_feature context
   *
   * Spec 2026-01-13: Added filename for Gateway context resolution
   * The projectId prop contains the architecture filename needed by the Gateway
   * to resolve entity and diagram IDs into human-readable summaries.
   *
   * Spec 2026-01-13: Added phase parameter for phased conversation workflow
   * - phase: 'bootstrap' for initial context loading
   * - phase: 'refine' for exploratory dialog (steps 1a-1e)
   * - phase: 'handoff' for transition to spec generation
   *
   * Spec 2026-01-15: Added projectParentFolder, featureId, featureTitle for persistence
   * - projectParentFolder: absolute path to project's parent folder for transcript storage
   * - featureId: work item ID for deterministic folder naming
   * - featureTitle: work item title for folder naming
   *
   * Spec 2026-01-16: Fixed entity ID construction for backend resolution
   * - Entity IDs are now constructed in typed format: "<entity_type>::<entity_id>"
   * - This format matches what ImplementContextResolutionService.parseEntityId() expects
   * - Diagram IDs remain plain (not typed) as they are handled differently
   *
   * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End - Task Group 2
   * - Added entities[] array construction from contextState.entity_refs
   * - Added diagrams[] array construction from contextState.diagram_refs
   * - Each entity includes entity_type, entity_id, bundle_type, depth
   * - Each diagram includes diagram_id, bundle_type
   * - depth defaults to 1 when undefined in EntityRef
   *
   * Spec 2026-01-26: Implement Context Include Relationships and Propagate to Planner Payload
   * Task Group 5: Frontend Chat Payload Changes
   * - Added relationshipIds[] array construction from contextState.relationship_refs
   * - Added relationships[] array construction with resolved details
   * - Format: "relationshipType::relationshipId" for relationshipIds
   * - Each relationship includes relationship_type, relationship_id, label
   */
  const buildContext = useCallback(
    (intent: ImplementChatIntent, phase: ImplementChatPhase, currentMessages?: ChatMessage[]): ImplementChatContext => {
      // Spec 2026-01-16: Construct typed entity IDs in format "<entity_type>::<entity_id>"
      // This enables the backend ImplementContextResolutionService to correctly parse and resolve entities
      const entityIds = contextState.entity_refs.map(
        (ref) => `${ref.entity_type}::${ref.entity_id}`
      );
      // Diagram IDs remain plain (not typed) - they use a different resolution path
      const diagramIds = contextState.diagram_refs.map((ref) => ref.diagram_id);

      // Spec 2026-01-17: Construct entities[] array from entity_refs for expand-resolve
      // Each entity includes entity_type, entity_id, bundle_type, and depth
      // depth defaults to 1 when undefined in EntityRef for backward compatibility
      const entities: EntityBundleSelection[] = contextState.entity_refs.map((ref) => ({
        entity_type: ref.entity_type,
        entity_id: ref.entity_id,
        bundle_type: ref.bundle_type || 'entity_only',
        depth: ref.depth ?? 1, // Default to 1 if undefined
      }));

      // Spec 2026-01-17: Construct diagrams[] array from diagram_refs for expand-resolve
      // Each diagram includes diagram_id and bundle_type
      const diagrams: DiagramBundleSelection[] = contextState.diagram_refs.map((ref) => ({
        diagram_id: ref.diagram_id,
        bundle_type: ref.bundle_type || 'diagram_only',
      }));

      // Spec 2026-01-26: Construct relationshipIds[] array from relationship_refs
      // Format: "relationshipType::relationshipId"
      const relationshipRefs = contextState.relationship_refs || [];
      const relationshipIds = relationshipRefs.map(
        (ref) => `${ref.relationship_type}::${ref.relationship_id}`
      );

      // Spec 2026-01-26: Construct relationships[] array with resolved details
      // Each relationship includes relationship_type, relationship_id, label
      const relationships: RelationshipContextPayload[] = relationshipRefs.map((ref) => ({
        relationship_type: ref.relationship_type,
        relationship_id: ref.relationship_id,
        label: ref.label,
      }));

      // Build displayedMessages snapshot for short-displayed-conversation.txt
      // Use currentMessages when provided to avoid stale closure (the caller may
      // have added messages via setMessages that haven't committed to state yet).
      const msgs = currentMessages ?? messages;
      const displayedMessages = msgs.map((m) => ({
        displayRole: m.role === 'user' ? 'You' : (m.persona || 'Product Manager'),
        content: m.content,
      }));

      return {
        mode: 'implement_feature',
        intent,
        phase,
        filename: projectId,
        projectId: projectUuid || projectId,
        // Spec 2026-01-15: Persistence metadata
        projectParentFolder: activeProject?.projectParentFolder,
        featureId: workItemId,
        featureTitle: workItemTitle,
        workItem: {
          id: workItemId,
          title: workItemTitle,
          type: workItemType,
          description: workItemDescription,
          siblingStories: siblingStories?.length ? siblingStories : undefined,
        },
        architectureContext: {
          entityIds,
          diagramIds,
          // Spec 2026-01-17: Include structured bundle selections for expand-resolve
          entities,
          diagrams,
          // Spec 2026-01-26: Include relationship selections for planner access
          relationshipIds,
          relationships,
        },
        displayedMessages,
      };
    },
    [workItemId, workItemTitle, workItemType, workItemDescription, siblingStories, contextState, projectId, projectUuid, activeProject?.projectParentFolder, messages]
  );

  /**
   * Ask the planner LLM to produce a detailed shape spec for a specific part.
   * Sends a 'refine' phase message to the planner (api/chat) with the part's
   * title, intent, and dependencies. The planner's response is the elaborated
   * spec text that will be sent to the shape-spec stream.
   *
   * @param part - The Part to elaborate
   * @param totalParts - Total number of parts in the plan
   * @returns The planner's full PlannerResponse for this increment, or null on failure
   *
   * Spec 2026-02-10: Changed return type from string to PlannerResponse so
   * callers can compose a structured spec (featureUnderstanding, scope,
   * assumptions, acceptanceCriteria) for the implementation LLM instead of
   * only forwarding the assistant chat-bubble text.
   */
  const elaboratePartSpec = useCallback(async (
    part: Part,
    totalParts: number
  ): Promise<PlannerResponse | null> => {
    const depsText = part.dependencies?.length
      ? `\nDependencies: ${part.dependencies.join(', ')}`
      : '';
    const message = `Please produce a detailed shape spec for Part ${part.partIndex} of ${totalParts}: "${part.title}".\n\nPart intent: ${part.intent}${depsText}\n\nProvide a comprehensive technical description focusing on this specific part only, including all details needed for the Software Developer to implement it.`;

    const context = buildContext('normal_chat', 'refine');
    const response = await postChatMessage({
      sessionId: sessionId || undefined,
      message,
      context,
    });

    if (response.sessionId && !sessionId) {
      setSessionId(response.sessionId);
    }

    return response.plannerResponse || null;
  }, [buildContext, sessionId]);

  /**
   * Spec 2026-01-13: Trigger bootstrap phase
   * Auto-triggered on mount when messages are empty
   * Sends phase: 'bootstrap' with empty message to load context
   */
  const triggerBootstrap = useCallback(async () => {
    if (hasBootstrapped || isBootstrapping || !workItemId) return;

    setIsBootstrapping(true);
    setRespondingPersona('Product Manager');
    setError(null);

    const context = buildContext('normal_chat', 'bootstrap');

    try {
      const response = await postChatMessage({
        sessionId: sessionId || undefined,
        message: '', // Bootstrap allows empty message
        context,
      });

      // Store sessionId from response
      if (response.sessionId) {
        setSessionId(response.sessionId);
      }

      // Add assistant bootstrap message
      const assistantMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: response.assistant.message,
        timestamp: new Date(),
        persona: 'Product Manager',
      };
      setMessages([assistantMessage]);
      setHasBootstrapped(true);

      // Spec 2026-01-22: Update latestPlannerResponse if present
      if (response.plannerResponse) {
        setLatestPlannerResponse(response.plannerResponse);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to initialize assistant';
      setError(errorMessage);
      // Still mark as bootstrapped to prevent retry loops
      setHasBootstrapped(true);
    } finally {
      setIsBootstrapping(false);
      setRespondingPersona(null);
    }
  }, [hasBootstrapped, isBootstrapping, workItemId, sessionId, buildContext]);

  /**
   * Spec 2026-01-13: Bootstrap useEffect hook
   * Triggers bootstrap on mount when messages are empty and not yet bootstrapped
   *
   * Spec 2026-01-16: Now waits for disk hydration to complete before triggering bootstrap
   */
  useEffect(() => {
    // Only trigger bootstrap if:
    // 1. We have a workItemId
    // 2. Messages are empty
    // 3. Not already bootstrapped
    // 4. Not currently bootstrapping
    // 5. Not currently loading
    // 6. Disk hydration has completed (Spec 2026-01-16)
    // Skip bootstrap when in holistic review mode — the holistic trigger handles initialization
    if (
      workItemId &&
      messages.length === 0 &&
      !hasBootstrapped &&
      !isBootstrapping &&
      !isLoading &&
      isDiskHydrationComplete &&
      !holisticReviewData
    ) {
      triggerBootstrap();
    }
  }, [workItemId, messages.length, hasBootstrapped, isBootstrapping, isLoading, isDiskHydrationComplete, triggerBootstrap, holisticReviewData]);

  /**
   * Spec 2026-01-30: Force RHS Team Chat Scroll to Bottom - Task Group 2
   * Task 2.3: Unconditional scroll-to-bottom useEffect
   *
   * Scrolls the messagesContainer to the bottom whenever the messages array changes.
   * This includes:
   * - New messages added
   * - Streaming content deltas (each creates a new message)
   *
   * Uses requestAnimationFrame wrapper for reliable DOM timing after React updates.
   * No near-bottom checks or user-scroll detection - always scrolls unconditionally.
   * Only scrolls the messagesContainerRef element (never window/document).
   */
  useEffect(() => {
    if (!messagesContainerRef.current) return;

    requestAnimationFrame(() => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    });
  }, [messages]);

  /**
   * Spec 2026-02-06: Task Group 6 - Job polling cleanup
   * Clear polling interval on unmount or when job completes.
   */
  useEffect(() => {
    return () => {
      if (jobPollingIntervalRef.current) {
        clearInterval(jobPollingIntervalRef.current);
        jobPollingIntervalRef.current = null;
      }
    };
  }, []);

  /**
   * Spec 2026-01-10: Handle input change with persistence
   */
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setInputMessage(newValue);
    // Persist draft after state updates (will be handled by effect)
  }, []);

  /**
   * Send a chat message programmatically (used by handleSend and auto-send).
   * Accepts message content directly rather than reading from inputMessage state.
   *
   * Spec 2026-03-21: Routes to the correct persona based on current workflow phase.
   * When TE has open questions (latestTestPlannerResponse with openQuestions, !hasTestPlan),
   * sends with phase: 'test_planning' so the backend routes to the Test Engineer.
   * Otherwise defaults to phase: 'refine' for Product Manager.
   */
  const sendChatMessage = useCallback(async (content: string) => {
    // Spec 2026-03-21: Determine active persona from current workflow phase
    const teHasOpenQuestions = !hasTestPlan && latestTestPlannerResponse !== null
      && (latestTestPlannerResponse.openQuestions?.length ?? 0) > 0;
    const phase = teHasOpenQuestions ? 'test_planning' : 'refine';
    const persona: ChatMessagePersona = teHasOpenQuestions ? 'Test Engineer' : 'Product Manager';

    // Add user message immediately
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content,
      timestamp: new Date(),
    };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setIsLoading(true);
    setRespondingPersona(persona);
    setError(null);

    const context = buildContext('normal_chat', phase, updatedMessages);

    // Spec 2026-03-21: Inject shaped feature data for TE context (same as handleSubmitTeAnswers)
    if (teHasOpenQuestions && latestPlannerResponse) {
      (context as unknown as Record<string, unknown>).shapedFeature = {
        featureUnderstanding: latestPlannerResponse.featureUnderstanding,
        scopeIn: latestPlannerResponse.scope?.in,
        scopeOut: latestPlannerResponse.scope?.out,
        assumptions: latestPlannerResponse.assumptions,
        acceptanceCriteria: latestPlannerResponse.acceptanceCriteria,
      };
      if (latestPlannerResponse.implementationPlan) {
        (context as unknown as Record<string, unknown>).implementationPlan = JSON.stringify(latestPlannerResponse.implementationPlan);
      }
    }

    try {
      const response = await postChatMessage({
        sessionId: sessionId || undefined,
        message: content,
        context,
      });

      // Store sessionId from response
      if (response.sessionId && !sessionId) {
        setSessionId(response.sessionId);
      }

      if (teHasOpenQuestions) {
        // Spec 2026-03-21: Handle TE response (same pattern as handleSubmitTeAnswers)
        if (response.testPlannerResponse) {
          setLatestTestPlannerResponse(response.testPlannerResponse);
          const chatContent = response.testPlannerResponse.message || response.assistant.message;
          const teMsg: ChatMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: chatContent,
            timestamp: new Date(),
            persona: 'Test Engineer',
          };
          setMessages((prev) => [...prev, teMsg]);

          const openQuestions = response.testPlannerResponse.openQuestions || [];
          if (openQuestions.length === 0) {
            setHasTestPlan(true);
          }
        } else {
          // Fallback: no structured TE response
          const fallbackMsg: ChatMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: response.assistant.message,
            timestamp: new Date(),
            persona: 'Test Engineer',
          };
          setMessages((prev) => [...prev, fallbackMsg]);
        }
      } else {
        // PM response (original behaviour)
        const chatContent = response.plannerResponse?.message || response.assistant.message;
        const assistantMessage: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: chatContent,
          timestamp: new Date(),
          persona: 'Product Manager',
        };
        setMessages((prev) => [...prev, assistantMessage]);

        if (response.plannerResponse) {
          setLatestPlannerResponse(response.plannerResponse);
        }
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to send message';
      setError(errorMessage);

      // Add error as assistant message for visibility
      const errorChatMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: `Error: ${errorMessage}`,
        timestamp: new Date(),
        persona,
      };
      setMessages((prev) => [...prev, errorChatMessage]);
    } finally {
      setIsLoading(false);
      setRespondingPersona(null);
    }
  }, [sessionId, buildContext, messages, hasTestPlan, latestTestPlannerResponse, latestPlannerResponse]);

  /**
   * Handle sending a message from the chat input.
   * Delegates to sendChatMessage which routes to the correct persona.
   */
  const handleSend = useCallback(async () => {
    const message = inputMessage.trim();
    if (!message) return;
    setInputMessage('');
    await sendChatMessage(message);
  }, [inputMessage, sendChatMessage]);

  // Auto-send message when triggered by context modal "Send" button
  useEffect(() => {
    if (autoSendMessage) {
      sendChatMessage(autoSendMessage);
      onAutoSendComplete?.();
    }
  }, [autoSendMessage, sendChatMessage, onAutoSendComplete]);

  /**
   * Spec 2026-01-23: Handle answer submission for open questions
   * Sends phase: 'refine' with the answers to submit
   * Updates questionStatuses on success
   */
  const handleSubmitAnswers = useCallback(async () => {
    if (isSubmittingAnswers) return;

    // Get questions that have answers but aren't marked as Answered yet
    const questionsToSubmit = Object.entries(answers).filter(([id, answer]) => {
      const status = questionStatuses.get(id);
      return answer.trim() && status !== 'Answered';
    });

    if (questionsToSubmit.length === 0) return;

    setIsSubmittingAnswers(true);
    setRespondingPersona('Product Manager');
    setError(null);

    // Build optimistic user message with answers
    const answerLines = questionsToSubmit.map(([id, answer]) => {
      const question = latestPlannerResponse?.openQuestions.find(q => q.id === id);
      return `Q: ${question?.question || id}\nA: ${answer}`;
    }).join('\n\n');

    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: `Answers to your questions:\n\n${answerLines}`,
      timestamp: new Date(),
    };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    const context = buildContext('normal_chat', 'refine', updatedMessages);

    try {
      const response = await postChatMessage({
        sessionId: sessionId || undefined,
        message: userMessage.content,
        context,
      });

      // Store sessionId from response
      if (response.sessionId && !sessionId) {
        setSessionId(response.sessionId);
      }

      // Spec 2026-01-22: Extract message from plannerResponse if present
      const chatContent = response.plannerResponse?.message || response.assistant.message;

      // Add assistant message
      const assistantMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: chatContent,
        timestamp: new Date(),
        persona: 'Product Manager',
      };
      setMessages((prev) => [...prev, assistantMessage]);

      // Spec 2026-01-24: Update questionStatuses on successful submit
      setQuestionStatuses((prev) => {
        const newStatuses = new Map(prev);
        questionsToSubmit.forEach(([id]) => {
          newStatuses.set(id, 'Answered');
        });
        return newStatuses;
      });

      // Spec 2026-01-22: Update latestPlannerResponse if present
      if (response.plannerResponse) {
        setLatestPlannerResponse(response.plannerResponse);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to submit answers';
      setError(errorMessage);

      // Add error as assistant message for visibility
      const errorChatMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: `Error: ${errorMessage}`,
        timestamp: new Date(),
        persona: 'Product Manager',
      };
      setMessages((prev) => [...prev, errorChatMessage]);
    } finally {
      setIsSubmittingAnswers(false);
      setRespondingPersona(null);
    }
  }, [isSubmittingAnswers, answers, questionStatuses, latestPlannerResponse, sessionId, buildContext, messages]);

  /**
   * Spec 2026-01-28: Shape-Spec 2 - Task Group 3
   * Task 3.5: Create handleQuestionsEvent callback
   *
   * Handles {type:"questions"} SSE events from the shape-spec stream.
   * Maps each streamed question to a Question type with derived fields:
   * - status: 'Open'
   * - answer: ''
   * - source: 'Software Developer'
   * - incrementId: undefined
   *
   * Replaces streamedQuestions state entirely (not merge).
   * Sets receivedQuestionsInTurn.current = true.
   *
   * Spec 2026-01-28: Shape-Spec 2 - Task Group 4
   * Also reset streamedAnswers when new questions arrive (new questions replace old answers)
   */
  const handleQuestionsEvent = useCallback((questions: Array<{ id: string; question: string }>) => {
    // Deduplicate by question ID — the upstream service occasionally sends
    // the same questions twice in a single event payload.
    const seen = new Set<string>();
    const uniqueQuestions = questions.filter((q) => {
      if (seen.has(q.id)) return false;
      seen.add(q.id);
      return true;
    });

    if (uniqueQuestions.length !== questions.length) {
      console.warn(
        `[handleQuestionsEvent] Deduplicated questions: received ${questions.length}, unique ${uniqueQuestions.length}`
      );
    }

    // Map streamed questions to Question type with derived fields
    const mappedQuestions: Question[] = uniqueQuestions.map((q) => ({
      id: q.id,
      question: q.question,
      status: 'Open' as const,
      answer: '',
      source: 'Software Developer' as const,
      incrementId: undefined,
    }));

    // Replace streamedQuestions state entirely (not merge)
    setStreamedQuestions(mappedQuestions);

    // Spec 2026-01-28: Shape-Spec 2 - Task Group 4
    // Reset streamedAnswers when new questions arrive (new questions replace old answers)
    setStreamedAnswers({});

    // Mark that questions were received in this turn
    receivedQuestionsInTurn.current = true;

    // Clear "Software Developer is responding..." indicator — the SA has
    // delivered its questions and is now waiting for the user to answer.
    setRespondingPersona(null);

    // Spec 2026-02-11: Set active increment to IN_CLARIFICATION
    // Read from ref to avoid depending on activePartIndex state (which
    // would recreate this callback on every part change, risking stale
    // closure issues when the callback is captured by a running SSE stream).
    const currentPartIndex = activePartIndexRef.current;
    if (currentPartIndex !== null) {
      setIncrementStatusForPart(currentPartIndex, 'IN_CLARIFICATION');
    }
  }, [setIncrementStatusForPart]);

  /**
   * Spec 2026-01-28: Shape-Spec 2 - Task Group 3
   * Task 3.6: Create handleFolderEvent callback
   *
   * Handles {type:"folder"} SSE events from the shape-spec stream.
   * Updates latestFolder state, overwriting previous value (no merge).
   */
  const handleFolderEvent = useCallback((folder: string) => {
    setLatestFolder(folder);
    latestFolderRef.current = folder;
  }, []);

  /**
   * Handles {type:"session"} SSE events from the shape-spec stream.
   * Stores the session_id for use in continuation streams and orchestration requests.
   */
  const handleSessionEvent = useCallback((sid: string) => {
    setShapeSpecSessionId(sid);
    shapeSpecSessionIdRef.current = sid;
  }, []);

  /**
   * Spec 2026-01-28: Shape-Spec 2 - Task Group 4
   * Task 4.3: Create handleStreamedAnswerChange callback
   *
   * Accepts: (id: string, answer: string) => void
   * Updates streamedAnswers[id] with new answer value
   */
  const handleStreamedAnswerChange = useCallback((id: string, answer: string) => {
    setStreamedAnswers((prev) => ({ ...prev, [id]: answer }));
  }, []);

  /**
   * Spec 2026-01-28: Shape-Spec 3 - Task Group 2
   * Task 2.1-2.6: Create triggerOrchestration helper function
   *
   * Encapsulates orchestration call and message handling.
   * Called when "questions complete" is detected (no more questions from SA).
   *
   * Spec 2026-01-30: Fix /api/v1 Streaming Chat Bubbles - Task Group 1
   * Added persona: 'Software Developer' to all message creation points
   *
   * @param folder - The spec folder name from latestFolder state
   */
  const triggerOrchestration = useCallback(async (folder: string | null) => {
    if (hasTriggeredOrchestration) {
      return;
    }

    if (!folder || folder.trim() === '') {
      const errorMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: 'Error: Cannot start implementation - spec folder is missing.',
        timestamp: new Date(),
        persona: 'Software Developer',
      };
      setMessages((prev) => [...prev, errorMessage]);
      return;
    }

    setHasTriggeredOrchestration(true);

    try {
      let companyName = 'Unknown Organisation';
      if (activeProject?.organisationId) {
        try {
          const organisation = await getOrganisationById(activeProject.organisationId);
          if (organisation) {
            companyName = organisation.name;
          }
        } catch (err) {
          console.warn('Failed to fetch organisation name for orchestration:', err);
        }
      }
      const projectName = activeProject?.name || projectId;

      // Mark increment as EXECUTING
      setIncrementStatusForPart(1, 'EXECUTING');

      const specIntent: SpecIntent = {
        spec_name: folder,
        ...(shapeSpecSessionIdRef.current ? { session_id: shapeSpecSessionIdRef.current } : {}),
      };
      const { jobId } = await startOrchestrationJob(companyName, projectName, [specIntent]);
      setCurrentJobId(jobId);

      // Start polling for job completion
      startJobPollingRef.current(1, jobId);

      const successMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: "Okay, I'll start implementing the code change now. Speak to you soon!",
        timestamp: new Date(),
        persona: 'Software Developer',
      };
      setMessages((prev) => [...prev, successMessage]);
    } catch (err) {
      console.error('Orchestration API call failed:', err);
      setIncrementStatusForPart(1, 'FAILED');
      const errorMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: 'Error: Unable to start implementation. Please try again later.',
        timestamp: new Date(),
        persona: 'Software Developer',
      };
      setMessages((prev) => [...prev, errorMessage]);
    }
  }, [hasTriggeredOrchestration, activeProject, projectId, setIncrementStatusForPart]);

  /**
   * Trigger orchestration for a specific part in the split workflow.
   * Creates a job via startOrchestrationJob and starts polling via startJobPolling.
   * Transitions the part to ORCHESTRATING state.
   *
   * @param partIndex - The part index to trigger orchestration for
   * @param folder - The spec folder name from the shape-spec stream
   */
  const triggerPartOrchestration = useCallback(async (partIndex: number, folder: string | null) => {
    if (!folder || folder.trim() === '') {
      const errorMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: 'Error: Cannot start implementation - spec folder is missing.',
        timestamp: new Date(),
        persona: 'Software Developer',
      };
      setMessages((prev) => [...prev, errorMessage]);
      return;
    }

    // Transition part to ORCHESTRATING
    setPartStatuses((prev) => {
      const updated = new Map(prev);
      updated.set(partIndex, 'ORCHESTRATING');
      return updated;
    });
    // Spec 2026-02-11: Mark increment as EXECUTING
    setIncrementStatusForPart(partIndex, 'EXECUTING');

    try {
      let companyName = 'Unknown Organisation';
      if (activeProject?.organisationId) {
        try {
          const organisation = await getOrganisationById(activeProject.organisationId);
          if (organisation) {
            companyName = organisation.name;
          }
        } catch (err) {
          console.warn('Failed to fetch organisation name for part orchestration:', err);
        }
      }
      const projectName = activeProject?.name || projectId;

      const specIntent: SpecIntent = {
        spec_name: folder,
        ...(shapeSpecSessionIdRef.current ? { session_id: shapeSpecSessionIdRef.current } : {}),
      };
      const { jobId } = await startOrchestrationJob(companyName, projectName, [specIntent]);
      setCurrentJobId(jobId);

      const startMsg: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: `Starting implementation for Part ${partIndex}...`,
        timestamp: new Date(),
        persona: 'Software Developer',
      };
      setMessages((prev) => [...prev, startMsg]);

      startJobPollingRef.current(partIndex, jobId);
    } catch (err) {
      console.error('Failed to start part orchestration job:', err);
      setPartStatuses((prev) => {
        const updated = new Map(prev);
        updated.set(partIndex, 'FAILED');
        return updated;
      });
      // Spec 2026-02-11: Mark increment as FAILED
      setIncrementStatusForPart(partIndex, 'FAILED');

      const errorMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: `Error: Failed to start orchestration for Part ${partIndex}.`,
        timestamp: new Date(),
        persona: 'Software Developer',
      };
      setMessages((prev) => [...prev, errorMessage]);
    }
  }, [activeProject, projectId, setIncrementStatusForPart]);

  /**
   * Spec 2026-01-28: Shape-Spec 2 - Task Group 4
   * Task 4.4: Create handleAnswerStreamedQuestions callback for continuation flow
   *
   * Compose message string with numbered answers only (single line):
   * ```
   * 1. [answer] 2. [answer]
   * ```
   *
   * Reset receivedQuestionsInTurn.current = false
   * Call startStream() with:
   * - company: from activeProject.organisationId lookup (same as initial)
   * - project: from activeProject.name
   * - message: composed Q/A message
   * - sessionMode: 'resume' for continuation
   * - onContent, onDone, onError, onQuestions, onFolder: same callbacks
   *
   * Spec 2026-01-28: Shape-Spec 3 - Task Group 3
   * Task 3.2: Added orchestration trigger detection to onDone callback
   * - Checks receivedQuestionsInTurn.current === false AND streamedQuestions.length === 0
   * - Calls triggerOrchestration(latestFolder) when conditions met
   * - Detection runs BEFORE async state updates to ensure accurate condition checking
   *
   * Spec 2026-01-30: Fix /api/v1 Streaming Chat Bubbles - Task Group 1
   * Task 1.3: Added persona: 'Software Developer' to messages at creation time
   * User message does NOT have persona (user messages never have persona)
   *
   * Spec 2026-01-30: Fix /api/v1 Streaming Chat Bubbles - Task Group 2
   * Task 2.3: Updated onContent to create NEW message per delta (multi-bubble pattern)
   * Task 2.5: Updated onDone to not reference removed accumulator state
   * Task 2.6: Updated onError to create new error message instead of updating existing
   */
  const handleAnswerStreamedQuestions = useCallback(async () => {
    // Compose message string with numbered answers only (single line)
    const composedMessage = streamedQuestions.map((q, idx) => {
      const answer = streamedAnswers[q.id] || '';
      return `${idx + 1}. ${answer}`;
    }).join(' ');

    // Derive company name
    let companyName = 'Unknown Organisation';
    if (activeProject?.organisationId) {
      try {
        const organisation = await getOrganisationById(activeProject.organisationId);
        if (organisation) {
          companyName = organisation.name;
        }
      } catch (err) {
        console.warn('Failed to fetch organisation name:', err);
      }
    }

    // Derive project name
    const projectName = activeProject?.name || projectId;

    // Set streaming state
    setIsStreaming(true);
    setIsSubmittingStreamedAnswers(true);
    setRespondingPersona('Software Developer');

    // Reset receivedQuestionsInTurn for this new turn
    receivedQuestionsInTurn.current = false;

    // Add user message with answers to chat
    // Spec 2026-01-30 Task 1.3: User message does NOT have persona
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: composedMessage,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Start stream with continuation (session_mode: 'resume')
    startStream({
      company: companyName,
      project: projectName,
      message: composedMessage,
      sessionMode: 'resume',

      // Spec 2026-01-30 Task Group 2: onContent creates NEW message per delta
      onContent: (delta: string) => {
        // Skip empty/whitespace-only deltas
        if (!delta || !delta.trim()) return;

        // Create NEW ChatMessage for each delta
        const newMessage: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          persona: 'Software Developer',
          content: delta,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, newMessage]);
      },

      // onDone callback - orchestration trigger after Q&A completes
      onDone: () => {
        const noQuestionsThisTurn = !receivedQuestionsInTurn.current;

        setIsStreaming(false);
        setIsSubmittingStreamedAnswers(false);
        setRespondingPersona(null);

        if (!receivedQuestionsInTurn.current) {
          setStreamedQuestions([]);
          setStreamedAnswers({});
        }
        receivedQuestionsInTurn.current = false;

        // Trigger orchestration when no new questions arrived this turn
        if (noQuestionsThisTurn) {
          // Spec 2026-02-11: Mark increment as READY_TO_EXECUTE before orchestration
          if (activePartIndex !== null) {
            setIncrementStatusForPart(activePartIndex, 'READY_TO_EXECUTE');
          }
          const folder = latestFolderRef.current;
          if (activePartIndex !== null && partStatuses.size > 0) {
            // Split path: per-part job orchestration
            triggerPartOrchestration(activePartIndex, folder);
          } else {
            // Non-split path: legacy orchestration
            triggerOrchestration(folder);
          }
        }
      },

      // Spec 2026-01-30 Task 2.6: onError creates new error message
      onError: (errorMsg: string) => {
        const errorMessage: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: `Error: ${errorMsg}`,
          timestamp: new Date(),
          persona: 'Software Developer',
        };
        setMessages((prev) => [...prev, errorMessage]);
        setIsStreaming(false);
        setIsSubmittingStreamedAnswers(false);
        setRespondingPersona(null);
        // Spec 2026-02-11: Mark increment as FAILED on stream error
        if (activePartIndex !== null) {
          setIncrementStatusForPart(activePartIndex, 'FAILED');
        }
      },

      // onQuestions, onFolder, onSession callbacks - same as initial stream
      onQuestions: handleQuestionsEvent,
      onFolder: handleFolderEvent,
      onSession: handleSessionEvent,
    });
  }, [streamedQuestions, streamedAnswers, activeProject, projectId, startStream, handleQuestionsEvent, handleFolderEvent, handleSessionEvent, triggerOrchestration, triggerPartOrchestration, activePartIndex, partStatuses, setIncrementStatusForPart]);

  /**
   * Spec 2026-01-23: Get increment status for pipeline execution
   */
  const getIncrementStatus = useCallback((incrementId: string): IncrementStatus => {
    return incrementStatuses.get(incrementId) || 'NOT_STARTED';
  }, [incrementStatuses]);

  /**
   * Spec 2026-01-23: Handle start implementation for an increment
   */
  const handleStartImplementation = useCallback((incrementId: string) => {
    // TODO: Implement pipeline execution trigger
    console.log('Start implementation for increment:', incrementId);
    setIncrementStatuses((prev) => {
      const newStatuses = new Map(prev);
      newStatuses.set(incrementId, 'EXECUTING');
      return newStatuses;
    });
  }, []);

  const handleMarkIncrementComplete = useCallback((incrementId: string) => {
    setIncrementStatuses((prev) => {
      const updated = new Map(prev);
      updated.set(incrementId, 'COMPLETED');
      return updated;
    });

    const plan = latestPlannerResponse?.implementationPlan;
    if (plan?.increments) {
      const index = plan.increments.findIndex((inc) => inc.id === incrementId);
      if (index >= 0) {
        const partIndex = plan.increments[index].partIndex ?? index + 1;
        setPartStatuses((prev) => {
          const updated = new Map(prev);
          updated.set(partIndex, 'COMPLETED');
          return updated;
        });

        if (useSplitWorkflow) {
          autoAdvanceRef.current?.(partIndex);
        }
      }
    }
  }, [latestPlannerResponse, useSplitWorkflow]);

  /**
   * Handle keyboard events in textarea
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  /**
   * Handle Copy All button click
   */
  const handleCopyAll = useCallback(async () => {
    if (generatedSpecs && generatedSpecs.length > 0) {
      const allSpecs = generatedSpecs.join('\n\n');
      try {
        await navigator.clipboard.writeText(allSpecs);
      } catch (err) {
        console.error('Failed to copy specs to clipboard:', err);
      }
    }
  }, [generatedSpecs]);

  /**
   * Handle answer change for a question
   */
  const handleAnswerChange = useCallback((id: string, answer: string) => {
    setAnswers((prev) => ({ ...prev, [id]: answer }));
  }, []);

  /**
   * Spec 2026-03-15: Clear conversation handlers for trash icon in chat header
   */
  const handleClearClick = useCallback(() => {
    setShowClearConfirm(true);
  }, []);

  const handleClearCancel = useCallback(() => {
    setShowClearConfirm(false);
  }, []);

  const handleClearConfirm = useCallback(() => {
    setShowClearConfirm(false);
    // Clear messages
    setMessages([]);
    // Wipe LLM-generated understanding
    setLatestPlannerResponse(null);
    // Reset bootstrap state so it re-triggers
    setHasBootstrapped(false);
    // Reset session
    setSessionId(null);
    // Clear other related state
    setAnswers({});
    setQuestionStatuses(new Map());
    setStreamedQuestions([]);
    setStreamedAnswers({});
    setIncrementStatuses(new Map());
    setSpecIntentTexts(new Map());
    setActiveIncrementId(null);
    setPartStatuses(new Map());
    setActivePartIndex(null);
    setCurrentJobId(null);
    setJobProgress(null);
    setHasPlan(false);
    setHasTriggeredOrchestration(false);
    setGeneratedSpecs(null);
    setHandoffPlan(null);
    setError(null);
    // Reset Test Engineer state
    setLatestTestPlannerResponse(null);
    setHasTestPlan(false);
    setIsTestPlanning(false);
    setTeAnswers({});
    setTeQuestionStatuses(new Map());
    testPlanningTriggeredRef.current = false;
    // Note: hasBootstrapped=false will trigger the bootstrap useEffect to re-run
  }, []);

  /**
   * Spec 2026-02-10: Combined Implementation Planning + SA Stream Launch.
   *
   * Auto-fires when the PO has no more questions (canImplementBase becomes true).
   * 1. Asks the planner to evaluate whether the feature needs splitting
   * 2. Displays the evaluation message in chat
   * 3. Sets hasPlan=true (enables the "Implement" button)
   * 4. For split plans: initialises part workflow state
   */
  const triggerImplementationPlanning = useCallback(async () => {
    if (isImplementing || isStreaming) return;

    setIsImplementing(true);
    setRespondingPersona('Product Manager');

    // Show Product Manager evaluation message
    const evalMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: "Okay, let's see if we need to break this work item into parts...",
      timestamp: new Date(),
      persona: 'Product Manager',
    };
    const messagesWithEval = [...messages, evalMessage];
    setMessages(messagesWithEval);

    try {
      // Send implementation_planning phase to planner
      const context = buildContext('normal_chat', 'implementation_planning', messagesWithEval);
      const response = await postChatMessage({
        sessionId: sessionId || undefined,
        message: 'Generate implementation plan',
        context,
      });

      if (response.sessionId && !sessionId) {
        setSessionId(response.sessionId);
      }

      const plannerResponse = response.plannerResponse;
      if (!plannerResponse) {
        const errorMsg: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: 'Error: Could not generate implementation plan. Please try again.',
          timestamp: new Date(),
          persona: 'Product Manager',
        };
        setMessages((prev) => [...prev, errorMsg]);
        setIsImplementing(false);
        setRespondingPersona(null);
        return;
      }

      const plan = plannerResponse.implementationPlan;

      // Guard: if the gateway returned a fallback response (validation failed),
      // implementationPlan will be null. Show an error instead of the success
      // message and preserve the existing refine-phase data on the LHS.
      if (!plan || !plan.increments || plan.increments.length === 0) {
        const retryMsg: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: 'I was unable to generate the implementation plan. Please click the text box and press Send to try again.',
          timestamp: new Date(),
          persona: 'Product Manager',
        };
        setMessages((prev) => [...prev, retryMsg]);
        setIsImplementing(false);
        setRespondingPersona(null);
        return;
      }

      // Plan is valid — update latestPlannerResponse (refreshes LHS Feature Definition panel).
      // Merge with the existing refine-phase data so feature understanding, scope,
      // and acceptance criteria are preserved if the implementation_planning response
      // returned empty values for those fields.
      setLatestPlannerResponse((prev) => {
        if (!prev) return plannerResponse;
        return {
          ...prev,
          // Only overwrite refine-phase fields if the new response has non-empty values
          featureUnderstanding: plannerResponse.featureUnderstanding || prev.featureUnderstanding,
          scope: (plannerResponse.scope?.in?.length || plannerResponse.scope?.out?.length)
            ? plannerResponse.scope
            : prev.scope,
          assumptions: plannerResponse.assumptions?.length ? plannerResponse.assumptions : prev.assumptions,
          acceptanceCriteria: plannerResponse.acceptanceCriteria?.length ? plannerResponse.acceptanceCriteria : prev.acceptanceCriteria,
          // Always take the new plan and readiness state
          implementationPlan: plannerResponse.implementationPlan,
          plannerReadyForSpec: plannerResponse.plannerReadyForSpec,
          openQuestions: plannerResponse.openQuestions,
        };
      });

      const isSplit = plan.isSplit === true;

      if (!isSplit) {
        // ===== NON-SPLIT: show brief message =====
        const readyMsg: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: "This item is small enough, so let's get the software developer to review this.",
          timestamp: new Date(),
          persona: 'Product Manager',
        };
        setMessages((prev) => [...prev, readyMsg]);

        // Compose spec intent and resolve architecture context immediately
        // Use the merged planner response for spec composition
        const mergedResponse = latestPlannerResponse
          ? {
              ...latestPlannerResponse,
              featureUnderstanding: plannerResponse.featureUnderstanding || latestPlannerResponse.featureUnderstanding,
              scope: (plannerResponse.scope?.in?.length || plannerResponse.scope?.out?.length)
                ? plannerResponse.scope
                : latestPlannerResponse.scope,
              assumptions: plannerResponse.assumptions?.length ? plannerResponse.assumptions : latestPlannerResponse.assumptions,
              acceptanceCriteria: plannerResponse.acceptanceCriteria?.length ? plannerResponse.acceptanceCriteria : latestPlannerResponse.acceptanceCriteria,
              implementationPlan: plannerResponse.implementationPlan,
            }
          : plannerResponse;

        const incId = plan.increments[0].id;
        const specIntent = composeSpecIntent(mergedResponse, siblingStories);
        if (specIntent) {
          const archContextBlock = await resolveAndFormatArchitectureContext(
            projectUuid || projectId, contextState, architectureExplainerRef.current
          );
          const fullSpecMessage = appendArchitectureContext(specIntent, archContextBlock);
          setSpecIntentTexts((prev) => {
            const updated = new Map(prev);
            updated.set(incId, fullSpecMessage);
            return updated;
          });
        }
        setIncrementStatuses((prev) => {
          const updated = new Map(prev);
          updated.set(incId, 'SPEC_READY');
          return updated;
        });
      } else {
        // ===== SPLIT: show summary and initialise part workflow state =====
        const parts = incrementsToParts(plan!.increments);
        const sortedParts = [...parts].sort((a, b) => a.partIndex - b.partIndex);

        const partsList = sortedParts
          .map((p) => `${p.partIndex}. ${p.title}`)
          .join('\n');
        const splitMsg: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: `I have decided to break this work into ${parts.length} increments:\n${partsList}\n\nClick Implement to start the software developer review.`,
          timestamp: new Date(),
          persona: 'Product Manager',
        };
        setMessages((prev) => [...prev, splitMsg]);

        // Initialise part workflow state
        const newStatuses = new Map<number, PartStatus>();
        for (const part of parts) {
          newStatuses.set(part.partIndex, 'PENDING');
        }
        setPartStatuses(newStatuses);
        setActivePartIndex(sortedParts[0].partIndex);

        const newTranscripts = new Map<number, ChatMessage[]>();
        for (const part of parts) {
          newTranscripts.set(part.partIndex, []);
        }
        setPartTranscripts(newTranscripts);

        // Elaborate all increment specs in background so "See Spec" is available immediately
        const totalParts = parts.length;
        setIsPrefetching(true);
        (async () => {
          try {
            // Resolve architecture context once for all increments
            const archContextBlock = await resolveAndFormatArchitectureContext(
              projectUuid || projectId, contextState, architectureExplainerRef.current
            );

            for (const part of sortedParts) {
              try {
                const partResponse = await elaboratePartSpec(part, totalParts);
                if (partResponse) {
                  // Cache the elaborated response for handleImplementClick
                  setPrefetchedSpecs((prev) => {
                    const updated = new Map(prev);
                    updated.set(part.partIndex, partResponse);
                    return updated;
                  });

                  // Compose full spec message with architecture context
                  const partSpec = composeSpecIntent(partResponse, siblingStories);
                  if (partSpec) {
                    const partFeatureCtx = composeFullFeatureContext(plannerResponse);
                    const partMessage = [partSpec, partFeatureCtx]
                      .filter(Boolean)
                      .join('\n\n');
                    const fullPartMessage = appendArchitectureContext(partMessage, archContextBlock);
                    const incId = plan!.increments.find(
                      (_inc, idx) => idx === part.partIndex - 1
                    )?.id ?? `INC-${part.partIndex}`;
                    setSpecIntentTexts((prev) => {
                      const updated = new Map(prev);
                      updated.set(incId, fullPartMessage);
                      return updated;
                    });
                    setIncrementStatuses((prev) => {
                      const updated = new Map(prev);
                      updated.set(incId, 'SPEC_READY');
                      return updated;
                    });
                  }
                }
              } catch (err) {
                console.warn(`Background spec elaboration failed for Part ${part.partIndex}:`, err);
              }
            }
          } finally {
            setIsPrefetching(false);
          }
        })();
      }

      // Mark plan as ready — enables the "Implement" button.
      // SA stream is NOT started here; it starts when user clicks "Implement".
      setHasPlan(true);
      setIsImplementing(false);
      setRespondingPersona(null);
    } catch (err) {
      console.error('Implementation planning failed:', err);
      const errorMsg: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to evaluate implementation plan'}`,
        timestamp: new Date(),
        persona: 'Product Manager',
      };
      setMessages((prev) => [...prev, errorMsg]);
      setIsImplementing(false);
      setRespondingPersona(null);
    }
  }, [isImplementing, isStreaming, sessionId, buildContext, messages, projectUuid, projectId, contextState, elaboratePartSpec, latestPlannerResponse, siblingStories]);

  /**
   * Spec 2026-02-10: Auto-trigger implementation planning when PO finishes questions.
   * Fires once when canImplementBase becomes true and no plan exists yet.
   */
  useEffect(() => {
    if (canImplementBase && !hasPlan && !isImplementing) {
      triggerImplementationPlanning();
    }
  }, [canImplementBase, hasPlan, isImplementing, triggerImplementationPlanning]);

  /**
   * Spec 2026-03-18: Trigger Test Engineer test_planning phase.
   * Auto-fires when implementation planning completes (hasPlan=true) and
   * no test plan exists yet. Sends a test_planning phase request and
   * processes the TestPlannerResponse.
   */
  const triggerTestPlanning = useCallback(async () => {
    if (isTestPlanning || hasTestPlan || !hasPlan) return;

    testPlanningTriggeredRef.current = true;
    setIsTestPlanning(true);
    setRespondingPersona('Test Engineer');

    // Show transition message
    const transitionMsg: ChatMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: "Now let's get the Test Engineer to review this and define the test plan...",
      timestamp: new Date(),
      persona: 'Product Manager',
    };
    const messagesWithTransition = [...messages, transitionMsg];
    setMessages(messagesWithTransition);

    try {
      const context = buildContext('normal_chat', 'test_planning', messagesWithTransition);
      // Inject shaped feature data and implementation plan for the TE prompt
      if (latestPlannerResponse) {
        (context as unknown as Record<string, unknown>).shapedFeature = {
          featureUnderstanding: latestPlannerResponse.featureUnderstanding,
          scopeIn: latestPlannerResponse.scope?.in,
          scopeOut: latestPlannerResponse.scope?.out,
          assumptions: latestPlannerResponse.assumptions,
          acceptanceCriteria: latestPlannerResponse.acceptanceCriteria,
        };
        if (latestPlannerResponse.implementationPlan) {
          (context as unknown as Record<string, unknown>).implementationPlan = JSON.stringify(latestPlannerResponse.implementationPlan);
        }
      }
      const response = await postChatMessage({
        sessionId: sessionId || undefined,
        message: 'Review the spec and define unit and functional tests',
        context,
      });

      if (response.sessionId && !sessionId) {
        setSessionId(response.sessionId);
      }

      if (response.testPlannerResponse) {
        setLatestTestPlannerResponse(response.testPlannerResponse);

        const chatContent = response.testPlannerResponse.message || response.assistant.message;
        const teMsg: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: chatContent,
          timestamp: new Date(),
          persona: 'Test Engineer',
        };
        setMessages((prev) => [...prev, teMsg]);

        // Check if TE has open questions
        const openQuestions = response.testPlannerResponse.openQuestions || [];
        if (openQuestions.length === 0) {
          // TE is done — no questions, test plan is final
          setHasTestPlan(true);
        }
        // If there are open questions, they'll be displayed and the user can answer them
      } else {
        // Fallback: no structured response
        const fallbackMsg: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: response.assistant.message,
          timestamp: new Date(),
          persona: 'Test Engineer',
        };
        setMessages((prev) => [...prev, fallbackMsg]);
        // Mark as complete even on fallback to avoid blocking
        setHasTestPlan(true);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get test plan';
      const errorMsg: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: `Error: ${errorMessage}`,
        timestamp: new Date(),
        persona: 'Test Engineer',
      };
      setMessages((prev) => [...prev, errorMsg]);
      // Mark as complete on error to avoid blocking the workflow
      setHasTestPlan(true);
    } finally {
      setIsTestPlanning(false);
      setRespondingPersona(null);
    }
  }, [isTestPlanning, hasTestPlan, hasPlan, sessionId, buildContext, messages]);

  /**
   * Spec 2026-03-18: Auto-trigger test planning when implementation plan is ready.
   * Fires once when hasPlan becomes true and no test plan exists yet.
   * Spec 2026-03-21: Guard with testPlanningTriggeredRef to prevent re-firing after
   * triggerTestPlanning completes with open questions (where hasTestPlan stays false).
   */
  useEffect(() => {
    if (hasPlan && !hasTestPlan && !isTestPlanning && !testPlanningTriggeredRef.current) {
      triggerTestPlanning();
    }
  }, [hasPlan, hasTestPlan, isTestPlanning, triggerTestPlanning]);

  /**
   * Spec 2026-03-19: When the TE finishes, show a confirmation prompt instead of auto-advancing.
   * The user clicks a button to move to the next story (or see "Refinement Complete" on the last).
   * readyToAdvance becomes true when hasTestPlan transitions to true AND onRefinementComplete exists.
   */
  const [readyToAdvance, setReadyToAdvance] = useState(false);
  const prevHasTestPlanRef = useRef(false);
  useEffect(() => {
    if (hasTestPlan && !prevHasTestPlanRef.current) {
      if (onRefinementComplete) {
        setReadyToAdvance(true);
      }
    }
    prevHasTestPlanRef.current = hasTestPlan;
  }, [hasTestPlan, onRefinementComplete]);

  /**
   * Spec 2026-03-19: Create TEST work items from holistic TE review results.
   * Each integration/E2E test in the test plan becomes a TEST work item under the feature.
   */
  const createTestWorkItems = useCallback(async (
    testPlan: Array<{ title: string; description: string; type: string }>,
    featureId: string,
  ) => {
    if (!projectUuid) return;

    let created = 0;
    for (const test of testPlan) {
      try {
        await createWorkItem(projectUuid, {
          type: 'TEST',
          parentId: featureId,
          title: `[${test.type.toUpperCase()}] ${test.title}`,
          description: test.description,
          status: 'PLANNED',
          sortOrder: 999 + created,
        });
        created++;
      } catch (err) {
        console.warn('Failed to create TEST work item:', test.title, err);
      }
    }

    if (created > 0) {
      const confirmMsg: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: `Created ${created} TEST work item${created > 1 ? 's' : ''} under this feature.`,
        timestamp: new Date(),
        persona: 'Test Engineer',
      };
      setMessages(prev => [...prev, confirmMsg]);
    }
  }, [projectUuid]);

  const handleAdvanceClick = useCallback(async () => {
    // In holistic mode, save TEST work items before advancing
    const isHolistic = refinementMode === 'holistic_only' || !!holisticReviewData;
    if (isHolistic && projectUuid && latestTestPlannerResponse?.testPlan?.length) {
      await createTestWorkItems(latestTestPlannerResponse.testPlan, workItemId);
    }

    if (onRefinementComplete) {
      onRefinementComplete({
        storyId: workItemId,
        storyTitle: workItemTitle,
        plannerResponse: latestPlannerResponse,
        testPlannerResponse: latestTestPlannerResponse,
      });
    }
    setReadyToAdvance(false);
  }, [onRefinementComplete, workItemId, workItemTitle, latestPlannerResponse, latestTestPlannerResponse, refinementMode, holisticReviewData, projectUuid, createTestWorkItems]);

  const holisticReviewTriggeredRef = useRef(false);
  const triggerHolisticReview = useCallback(async () => {
    if (!holisticReviewData || holisticReviewTriggeredRef.current) return;
    holisticReviewTriggeredRef.current = true;

    setIsTestPlanning(true);
    setRespondingPersona('Test Engineer');

    // Show transition message
    const transitionMsg: ChatMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: 'Now reviewing all stories together for integration and end-to-end test coverage...',
      timestamp: new Date(),
      persona: 'Test Engineer',
    };
    setMessages([transitionMsg]);

    try {
      const context = buildContext('normal_chat', 'test_planning_holistic', [transitionMsg]);

      // Inject story specs for the holistic prompt
      const storySpecs = holisticReviewData.storyResults.map(r => ({
        storyTitle: r.storyTitle,
        featureUnderstanding: r.plannerResponse?.featureUnderstanding,
        scopeIn: r.plannerResponse?.scope?.in,
        scopeOut: r.plannerResponse?.scope?.out,
        acceptanceCriteria: r.plannerResponse?.acceptanceCriteria,
        implementationPlan: r.plannerResponse?.implementationPlan
          ? JSON.stringify(r.plannerResponse.implementationPlan)
          : undefined,
        testPlan: r.testPlannerResponse?.testPlan,
      }));
      (context as unknown as Record<string, unknown>).storySpecs = storySpecs;

      const response = await postChatMessage({
        sessionId: sessionId || undefined,
        message: 'Review all stories together and define integration and E2E tests',
        context,
      });

      if (response.sessionId && !sessionId) {
        setSessionId(response.sessionId);
      }

      if (response.testPlannerResponse) {
        setLatestTestPlannerResponse(response.testPlannerResponse);

        const openQuestions = response.testPlannerResponse.openQuestions || [];
        let chatContent = response.testPlannerResponse.message || response.assistant.message;
        // Append question count hint for the user
        if (openQuestions.length > 0) {
          chatContent += `\n\nI have ${openQuestions.length} question${openQuestions.length > 1 ? 's' : ''} for you to answer.`;
        }
        const teMsg: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: chatContent,
          timestamp: new Date(),
          persona: 'Test Engineer',
        };
        setMessages(prev => [...prev, teMsg]);

        if (openQuestions.length === 0) {
          setHasTestPlan(true);
        }
      } else {
        const fallbackMsg: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: response.assistant.message,
          timestamp: new Date(),
          persona: 'Test Engineer',
        };
        setMessages(prev => [...prev, fallbackMsg]);
        setHasTestPlan(true);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get holistic test review';
      const errorMsg: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: `Error: ${errorMessage}`,
        timestamp: new Date(),
        persona: 'Test Engineer',
      };
      setMessages(prev => [...prev, errorMsg]);
      setHasTestPlan(true);
    } finally {
      setIsTestPlanning(false);
      setRespondingPersona(null);
    }
  }, [holisticReviewData, sessionId, buildContext, projectUuid, workItemId]);

  useEffect(() => {
    if (holisticReviewData && !holisticReviewTriggeredRef.current) {
      triggerHolisticReview();
    }
  }, [holisticReviewData, triggerHolisticReview]);

  // Reset holistic review trigger when workItemId changes
  useEffect(() => {
    holisticReviewTriggeredRef.current = false;
  }, [workItemId]);

  /**
   * Spec 2026-03-18: Handle TE open question answer changes.
   */
  const handleTeAnswerChange = useCallback((questionId: string, answer: string) => {
    setTeAnswers((prev) => ({ ...prev, [questionId]: answer }));
  }, []);

  /**
   * Spec 2026-03-18: Submit TE open question answers.
   * Sends answers back as a test_planning phase message and processes the response.
   */
  const handleSubmitTeAnswers = useCallback(async () => {
    if (!latestTestPlannerResponse) return;

    const questionsToSubmit = Object.entries(teAnswers).filter(([id, answer]) => {
      const status = teQuestionStatuses.get(id);
      return answer.trim().length > 0 && status !== 'Answered';
    });

    if (questionsToSubmit.length === 0) return;

    setIsTestPlanning(true);
    setRespondingPersona('Test Engineer');

    // Compose answer text
    const answerLines = questionsToSubmit.map(([id, answer]) => {
      const question = latestTestPlannerResponse.openQuestions.find(q => q.id === id);
      return `Q: ${question?.question || id}\nA: ${answer}`;
    });
    const answerText = answerLines.join('\n\n');

    // Add user message
    const userMsg: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: answerText,
      timestamp: new Date(),
    };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    try {
      const context = buildContext('normal_chat', 'test_planning', updatedMessages);
      // Inject shaped feature data for TE follow-up
      if (latestPlannerResponse) {
        (context as unknown as Record<string, unknown>).shapedFeature = {
          featureUnderstanding: latestPlannerResponse.featureUnderstanding,
          scopeIn: latestPlannerResponse.scope?.in,
          scopeOut: latestPlannerResponse.scope?.out,
          assumptions: latestPlannerResponse.assumptions,
          acceptanceCriteria: latestPlannerResponse.acceptanceCriteria,
        };
        if (latestPlannerResponse.implementationPlan) {
          (context as unknown as Record<string, unknown>).implementationPlan = JSON.stringify(latestPlannerResponse.implementationPlan);
        }
      }
      const response = await postChatMessage({
        sessionId: sessionId || undefined,
        message: answerText,
        context,
      });

      if (response.sessionId && !sessionId) {
        setSessionId(response.sessionId);
      }

      // Mark submitted questions as answered
      setTeQuestionStatuses((prev) => {
        const next = new Map(prev);
        for (const [id] of questionsToSubmit) {
          next.set(id, 'Answered');
        }
        return next;
      });

      if (response.testPlannerResponse) {
        setLatestTestPlannerResponse(response.testPlannerResponse);

        const openQuestions = response.testPlannerResponse.openQuestions || [];
        let chatContent = response.testPlannerResponse.message || response.assistant.message;
        if (openQuestions.length > 0) {
          chatContent += `\n\nI have ${openQuestions.length} question${openQuestions.length > 1 ? 's' : ''} for you to answer.`;
        }
        const teMsg: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: chatContent,
          timestamp: new Date(),
          persona: 'Test Engineer',
        };
        setMessages((prev) => [...prev, teMsg]);

        if (openQuestions.length === 0) {
          setHasTestPlan(true);
        }
      } else {
        const fallbackMsg: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: response.assistant.message,
          timestamp: new Date(),
          persona: 'Test Engineer',
        };
        setMessages((prev) => [...prev, fallbackMsg]);
        setHasTestPlan(true);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to submit answers';
      const errorMsg: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: `Error: ${errorMessage}`,
        timestamp: new Date(),
        persona: 'Test Engineer',
      };
      setMessages((prev) => [...prev, errorMsg]);
      setHasTestPlan(true);
    } finally {
      setIsTestPlanning(false);
      setRespondingPersona(null);
    }
  }, [latestTestPlannerResponse, teAnswers, teQuestionStatuses, sessionId, buildContext, messages]);

  /**
   * Spec 2026-02-10: Phase B — Handle Implement button click (starts SA stream).
   *
   * Reads latestPlannerResponse from state (populated by Phase A) and starts
   * the SA shape-spec stream. For split plans, elaborates the first part first.
   */
  const handleImplementClick = useCallback(async () => {
    if (isImplementing || isStreaming || !latestPlannerResponse) return;

    setIsImplementing(true);

    // Resolve company / project names for shape-spec stream
    let companyName = 'Unknown Organisation';
    if (activeProject?.organisationId) {
      try {
        const organisation = await getOrganisationById(activeProject.organisationId);
        if (organisation) {
          companyName = organisation.name;
        }
      } catch (err) {
        console.warn('Failed to fetch organisation name:', err);
      }
    }
    const projectName = activeProject?.name || projectId;

    // Resolve architecture context once (used by both split and non-split branches)
    const archContextBlock = await resolveAndFormatArchitectureContext(projectUuid || projectId, contextState, architectureExplainerRef.current);

    const plan = latestPlannerResponse.implementationPlan;
    const isSplit = plan?.isSplit === true;

    if (!isSplit) {
      // ===== NON-SPLIT: start shape-spec stream for the whole feature =====
      // Spec intent + architecture context already cached in triggerImplementationPlanning
      const incId = plan?.increments?.[0]?.id ?? 'INC-1';
      let fullSpecMessage = specIntentTexts.get(incId) ?? null;

      // Fallback: compose fresh if not yet cached (should not happen normally)
      if (!fullSpecMessage) {
        const specIntent = composeSpecIntent(latestPlannerResponse, siblingStories);
        if (!specIntent) {
          const errMsg: ChatMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: 'Error: Cannot generate spec intent from planner response.',
            timestamp: new Date(),
            persona: 'Software Developer',
          };
          setMessages((prev) => [...prev, errMsg]);
          setIsImplementing(false);
          return;
        }
        fullSpecMessage = appendArchitectureContext(specIntent, archContextBlock);
      }

      // Set activePartIndex so handleQuestionsEvent and onDone guards pass
      setActivePartIndex(1);

      setIsImplementing(false);
      setIsStreaming(true);
      setRespondingPersona('Software Developer');
      receivedQuestionsInTurn.current = false;

      startStream({
        company: companyName,
        project: projectName,
        message: fullSpecMessage,
        sessionMode: 'new',
        onContent: (delta: string) => {
          if (!delta || !delta.trim()) return;
          const newMessage: ChatMessage = {
            id: generateMessageId(),
            role: 'assistant',
            persona: 'Software Developer',
            content: delta,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, newMessage]);
        },
        onDone: () => {
          const noQuestionsThisTurn = !receivedQuestionsInTurn.current;

          setIsStreaming(false);
          setRespondingPersona(null);
          if (!receivedQuestionsInTurn.current) {
            setStreamedQuestions([]);
            setStreamedAnswers({});
          }
          receivedQuestionsInTurn.current = false;

          if (noQuestionsThisTurn) {
            // Set READY_TO_EXECUTE before orchestration (consistent with split path)
            setIncrementStatusForPart(1, 'READY_TO_EXECUTE');
            triggerOrchestration(latestFolderRef.current);
          }
        },
        onError: (errorMsg: string) => {
          const errMessage: ChatMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: `Error: ${errorMsg}`,
            timestamp: new Date(),
            persona: 'Software Developer',
          };
          setMessages((prev) => [...prev, errMessage]);
          setIsStreaming(false);
          setRespondingPersona(null);
          // Mark increment as FAILED on stream error (consistent with split path)
          setIncrementStatusForPart(1, 'FAILED');
        },
        onQuestions: handleQuestionsEvent,
        onFolder: handleFolderEvent,
        onSession: handleSessionEvent,
      });
    } else {
      // ===== SPLIT: use prefetched spec for first part, start shape-spec stream =====
      const parts = incrementsToParts(plan!.increments);
      const sortedParts = [...parts].sort((a, b) => a.partIndex - b.partIndex);
      const firstPart = sortedParts[0];
      const firstIncId = firstPart.partIndex === 1 ? 'INC-1' : plan!.increments[0].id;

      // Try cached spec from triggerImplementationPlanning background prefetch
      let incrementResponse = prefetchedSpecs.get(firstPart.partIndex) ?? null;

      if (!incrementResponse) {
        // Fallback: elaborate on demand (user clicked Implement before prefetch completed)
        setRespondingPersona('Product Manager');
        try {
          incrementResponse = await elaboratePartSpec(firstPart, parts.length);
        } catch (err) {
          console.error('Failed to elaborate part spec:', err);
          const errMsg: ChatMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: 'Error: Failed to elaborate spec for Part ' + firstPart.partIndex + '.',
            timestamp: new Date(),
            persona: 'Product Manager',
          };
          setMessages((prev) => [...prev, errMsg]);
          setRespondingPersona(null);
          setIsImplementing(false);
          setPartStatuses((prev) => {
            const updated = new Map(prev);
            updated.set(firstPart.partIndex, 'FAILED');
            return updated;
          });
          return;
        }

        if (!incrementResponse) {
          const errMsg: ChatMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: 'Error: Planner returned empty spec for Part ' + firstPart.partIndex + '.',
            timestamp: new Date(),
            persona: 'Product Manager',
          };
          setMessages((prev) => [...prev, errMsg]);
          setRespondingPersona(null);
          setIsImplementing(false);
          setPartStatuses((prev) => {
            const updated = new Map(prev);
            updated.set(firstPart.partIndex, 'FAILED');
            return updated;
          });
          return;
        }
      }

      // Use cached spec intent text if available, otherwise compose fresh
      let fullFirstIncMessage = specIntentTexts.get(firstIncId) ?? null;
      if (!fullFirstIncMessage) {
        const incrementSpec = composeSpecIntent(incrementResponse, siblingStories);
        const fullFeatureCtx = composeFullFeatureContext(latestPlannerResponse);
        const incrementMessage = [incrementSpec, fullFeatureCtx]
          .filter(Boolean)
          .join('\n\n');
        fullFirstIncMessage = appendArchitectureContext(incrementMessage, archContextBlock);
        if (incrementSpec) {
          setSpecIntentTexts((prev) => {
            const updated = new Map(prev);
            updated.set(firstIncId, fullFirstIncMessage!);
            return updated;
          });
          setIncrementStatuses((prev) => {
            const updated = new Map(prev);
            updated.set(firstIncId, 'SPEC_READY');
            return updated;
          });
        }
      }

      // Send structured increment spec to shape-spec stream
      setIsImplementing(false);
      setIsStreaming(true);
      setRespondingPersona('Software Developer');
      receivedQuestionsInTurn.current = false;

      startStream({
        company: companyName,
        project: projectName,
        message: fullFirstIncMessage,
        sessionMode: 'new',
        onContent: (delta: string) => {
          if (!delta || !delta.trim()) return;
          const newMessage: ChatMessage = {
            id: generateMessageId(),
            role: 'assistant',
            persona: 'Software Developer',
            content: delta,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, newMessage]);
        },
        onDone: () => {
          setIsStreaming(false);
          setRespondingPersona(null);
          if (!receivedQuestionsInTurn.current) {
            setStreamedQuestions([]);
            setStreamedAnswers({});
            // Spec 2026-02-11: Mark increment as READY_TO_EXECUTE before orchestration
            setIncrementStatusForPart(firstPart.partIndex, 'READY_TO_EXECUTE');
            // No questions: trigger orchestration if folder received, otherwise READY_TO_RUN
            const folder = latestFolderRef.current;
            if (folder) {
              triggerPartOrchestration(firstPart.partIndex, folder);
            } else {
              setPartStatuses((prev) => {
                const updated = new Map(prev);
                updated.set(firstPart.partIndex, 'READY_TO_RUN');
                return updated;
              });
            }
          }
          receivedQuestionsInTurn.current = false;
        },
        onError: (errorMsg: string) => {
          const errMessage: ChatMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: `Error: ${errorMsg}`,
            timestamp: new Date(),
            persona: 'Software Developer',
          };
          setMessages((prev) => [...prev, errMessage]);
          setIsStreaming(false);
          setRespondingPersona(null);
          // Mark first part as FAILED on error
          setPartStatuses((prev) => {
            const updated = new Map(prev);
            updated.set(firstPart.partIndex, 'FAILED');
            return updated;
          });
          // Spec 2026-02-11: Mark increment as FAILED
          setIncrementStatusForPart(firstPart.partIndex, 'FAILED');
        },
        onQuestions: handleQuestionsEvent,
        onFolder: handleFolderEvent,
        onSession: handleSessionEvent,
      });
    }
  }, [isImplementing, isStreaming, latestPlannerResponse, activeProject, projectId, startStream, handleQuestionsEvent, handleFolderEvent, handleSessionEvent, triggerOrchestration, triggerPartOrchestration, elaboratePartSpec, contextState, setIncrementStatusForPart, specIntentTexts, prefetchedSpecs]);

  // =========================================================================
  // Spec 2026-02-06: Part Workflow Handlers
  // Task Group 6: Integration and Wiring
  // =========================================================================

  /**
   * Task 6.6: Handle part selection when user clicks a part in the LHS list.
   * Updates activePartIndex to display that part's transcript in the RHS.
   */
  const handlePartClick = useCallback((partIndex: number) => {
    setActivePartIndex(partIndex);
  }, []);

  /**
   * Task 6.3: Handle retry orchestration for a FAILED part.
   * Transitions part from FAILED to ORCHESTRATING and re-creates the job.
   *
   * Spec 2026-06-12 (Task Group 5): fixed a contract violation — the retry
   * previously sent the composed part-payload TEXT as `spec_name`. The
   * upstream contract requires the spec FOLDER name (the same value the
   * non-retry paths read from the shape-spec stream's folder event), so the
   * retry now reuses latestFolderRef like triggerOrchestration /
   * triggerPartOrchestration do.
   */
  const handleRetryOrchestration = useCallback(async (partIndex: number) => {
    const currentStatus = partStatuses.get(partIndex);
    if (currentStatus !== 'FAILED') {
      console.warn(`Cannot retry orchestration: part ${partIndex} is not in FAILED state`);
      return;
    }

    // The spec folder name from the shape-spec stream — the same source the
    // non-retry paths use. Without it there is nothing valid to submit.
    const folder = latestFolderRef.current;
    if (!folder || folder.trim() === '') {
      const errorMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: `Error: Cannot retry implementation for Part ${partIndex} - spec folder is missing. Use "Resume Q&A" to regenerate the spec first.`,
        timestamp: new Date(),
        persona: 'Software Developer',
      };
      setMessages((prev) => [...prev, errorMessage]);
      return;
    }

    // Transition to ORCHESTRATING
    setPartStatuses((prev) => {
      const newStatuses = new Map(prev);
      newStatuses.set(partIndex, 'ORCHESTRATING');
      return newStatuses;
    });

    try {
      // Derive company name
      let companyName = 'Unknown Organisation';
      if (activeProject?.organisationId) {
        const organisation = await getOrganisationById(activeProject.organisationId);
        if (organisation) {
          companyName = organisation.name;
        }
      }
      const projectName = activeProject?.name || projectId;

      // Start orchestration job with the spec FOLDER name as spec_name
      const specIntentObj: SpecIntent = {
        spec_name: folder,
        ...(shapeSpecSessionIdRef.current ? { session_id: shapeSpecSessionIdRef.current } : {}),
      };
      const { jobId } = await startOrchestrationJob(companyName, projectName, [specIntentObj]);
      setCurrentJobId(jobId);

      // Start polling
      startJobPolling(partIndex, jobId);
    } catch (err) {
      console.error('Failed to retry orchestration job:', err);
      setPartStatuses((prev) => {
        const newStatuses = new Map(prev);
        newStatuses.set(partIndex, 'FAILED');
        return newStatuses;
      });

      // Add error message
      const errorMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: `Error: Failed to retry orchestration for Part ${partIndex}.`,
        timestamp: new Date(),
        persona: 'Software Developer',
      };
      setMessages((prev) => [...prev, errorMessage]);
    }
  }, [partStatuses, activeProject, projectId]);

  /**
   * Task 6.4: Handle resume Q&A for a FAILED part.
   * Transitions part from FAILED to QA_IN_PROGRESS, asks the planner to elaborate
   * the part spec, then re-starts shape-spec stream with the elaborated spec.
   */
  const handleResumeQA = useCallback(async (partIndex: number) => {
    const currentStatus = partStatuses.get(partIndex);
    if (currentStatus !== 'FAILED') {
      console.warn(`Cannot resume Q&A: part ${partIndex} is not in FAILED state`);
      return;
    }

    // Transition to QA_IN_PROGRESS
    setPartStatuses((prev) => {
      const newStatuses = new Map(prev);
      newStatuses.set(partIndex, 'QA_IN_PROGRESS');
      return newStatuses;
    });

    // Set as active part
    setActivePartIndex(partIndex);

    // Get the part data
    const plan = latestPlannerResponse?.implementationPlan;
    const allParts = plan?.increments ? incrementsToParts(plan.increments) : [];
    const part = allParts.find((p) => p.partIndex === partIndex);
    if (!part) {
      console.error(`Part ${partIndex} not found in implementation plan`);
      setPartStatuses((prev) => {
        const newStatuses = new Map(prev);
        newStatuses.set(partIndex, 'FAILED');
        return newStatuses;
      });
      return;
    }

    const totalParts = allParts.length || 1;

    try {
      // Step b.1: Ask planner to elaborate this part
      setRespondingPersona('Product Manager');
      const incrementResponse = await elaboratePartSpec(part, totalParts);

      if (!incrementResponse) {
        const errMsg: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: `Error: Planner returned empty spec for Part ${partIndex}.`,
          timestamp: new Date(),
          persona: 'Product Manager',
        };
        setMessages((prev) => [...prev, errMsg]);
        setRespondingPersona(null);
        setPartStatuses((prev) => {
          const newStatuses = new Map(prev);
          newStatuses.set(partIndex, 'FAILED');
          return newStatuses;
        });
        return;
      }

      // Derive company name
      let companyName = 'Unknown Organisation';
      if (activeProject?.organisationId) {
        const organisation = await getOrganisationById(activeProject.organisationId);
        if (organisation) {
          companyName = organisation.name;
        }
      }
      const projectName = activeProject?.name || projectId;

      // Resolve architecture context for shape-spec stream
      const archContextBlock = await resolveAndFormatArchitectureContext(projectUuid || projectId, contextState, architectureExplainerRef.current);

      // Spec 2026-02-10: Compose structured increment spec from the full
      // plannerResponse so the implementation LLM receives all structured detail.
      const incrementSpec = composeSpecIntent(incrementResponse, siblingStories);
      const fullFeatureCtx = composeFullFeatureContext(latestPlannerResponse);
      const incrementMessage = [incrementSpec, fullFeatureCtx]
        .filter(Boolean)
        .join('\n\n');

      // Step b.2: Send to shape-spec stream
      setIsStreaming(true);
      setRespondingPersona('Software Developer');
      receivedQuestionsInTurn.current = false;

      startStream({
        company: companyName,
        project: projectName,
        message: appendArchitectureContext(incrementMessage, archContextBlock),
        sessionMode: 'new',

        onContent: (delta: string) => {
          if (!delta || !delta.trim()) return;
          const newMessage: ChatMessage = {
            id: generateMessageId(),
            role: 'assistant',
            persona: 'Software Developer',
            content: delta,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, newMessage]);
        },

        onDone: () => {
          setIsStreaming(false);
          setRespondingPersona(null);
          if (!receivedQuestionsInTurn.current) {
            setStreamedQuestions([]);
            setStreamedAnswers({});
            // Spec 2026-02-11: Mark increment as READY_TO_EXECUTE before orchestration
            setIncrementStatusForPart(partIndex, 'READY_TO_EXECUTE');
            // No questions: trigger orchestration if folder received, otherwise READY_TO_RUN
            const folder = latestFolderRef.current;
            if (folder) {
              triggerPartOrchestration(partIndex, folder);
            } else {
              setPartStatuses((prev) => {
                const newStatuses = new Map(prev);
                newStatuses.set(partIndex, 'READY_TO_RUN');
                return newStatuses;
              });
            }
          }
          receivedQuestionsInTurn.current = false;
        },

        onError: (errorMsg: string) => {
          const errorMessage: ChatMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: `Error: ${errorMsg}`,
            timestamp: new Date(),
            persona: 'Software Developer',
          };
          setMessages((prev) => [...prev, errorMessage]);
          setIsStreaming(false);
          setRespondingPersona(null);
          setPartStatuses((prev) => {
            const newStatuses = new Map(prev);
            newStatuses.set(partIndex, 'FAILED');
            return newStatuses;
          });
          // Spec 2026-02-11: Mark increment as FAILED
          setIncrementStatusForPart(partIndex, 'FAILED');
        },

        onQuestions: handleQuestionsEvent,
        onFolder: handleFolderEvent,
        onSession: handleSessionEvent,
      });
    } catch (err) {
      console.error('Failed to resume Q&A:', err);
      setRespondingPersona(null);
      setPartStatuses((prev) => {
        const newStatuses = new Map(prev);
        newStatuses.set(partIndex, 'FAILED');
        return newStatuses;
      });
      // Spec 2026-02-11: Mark increment as FAILED
      setIncrementStatusForPart(partIndex, 'FAILED');
    }
  }, [partStatuses, latestPlannerResponse, activeProject, projectId, startStream, handleQuestionsEvent, handleFolderEvent, handleSessionEvent, elaboratePartSpec, triggerPartOrchestration, contextState, setIncrementStatusForPart]);

  /**
   * Task 6.7: Start job polling loop.
   * Polls job status every 2 seconds until completion or failure.
   *
   * Spec 2026-06-12 (Task Group 5): consumes the full JobDetailResponse —
   * surfaces step-level progress while the job is queued/running, and on
   * completion renders the git outcome (feature branch / PR / logs) extracted
   * DEFENSIVELY from the untyped `result` payload, then persists it onto the
   * AMS work item so it survives leaving the screen.
   */
  const startJobPolling = useCallback((partIndex: number, jobId: string) => {
    // Clear any existing polling interval
    if (jobPollingIntervalRef.current) {
      clearInterval(jobPollingIntervalRef.current);
    }

    // Show an immediate (step-less) progress indicator while the first poll runs
    setJobProgress({ partIndex, status: 'queued' });

    const pollJob = async () => {
      try {
        const jobStatus = await pollJobStatus(jobId);

        if (jobStatus.status === 'completed') {
          // Job completed successfully
          clearInterval(jobPollingIntervalRef.current!);
          jobPollingIntervalRef.current = null;
          setCurrentJobId(null);
          setJobProgress(null);

          // Transition part to COMPLETED
          setPartStatuses((prev) => {
            const newStatuses = new Map(prev);
            newStatuses.set(partIndex, 'COMPLETED');
            return newStatuses;
          });
          // Spec 2026-02-11: Mark increment as COMPLETED
          setIncrementStatusForPart(partIndex, 'COMPLETED');

          // Spec 2026-06-12: surface the git outcome instead of a generic
          // success message. `result` is untyped upstream — extraction is
          // isolated in extractGitOutcome and tolerates any shape.
          const outcome = extractGitOutcome(jobStatus.result, jobStatus.logs_url);
          const outcomeLines = [`Part ${partIndex} implementation completed.`];
          if (outcome.branch) {
            outcomeLines.push(`Feature branch: ${outcome.branch}`);
          }
          if (outcome.prUrl) {
            outcomeLines.push(`Pull request: ${outcome.prUrl}`);
          }
          if (outcome.logsUrl) {
            outcomeLines.push(`Logs: ${outcome.logsUrl}`);
          }
          if (!hasGitOutcome(outcome)) {
            outcomeLines.push('The implementation service did not report a feature branch or pull request for this job.');
          }

          const successMessage: ChatMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: outcomeLines.join('\n'),
            timestamp: new Date(),
            persona: 'Software Developer',
          };
          setMessages((prev) => [...prev, successMessage]);

          // Spec 2026-06-12: persist branch/PR/logs onto the AMS work item
          // (ref avoids stale closure — this callback has minimal deps).
          if (hasGitOutcome(outcome)) {
            void persistGitOutcomeRef.current(outcome);
          }

          // Auto-advance to next part (use ref to avoid stale closure)
          autoAdvanceRef.current(partIndex);
        } else if (jobStatus.status === 'failed') {
          // Job failed
          clearInterval(jobPollingIntervalRef.current!);
          jobPollingIntervalRef.current = null;
          setCurrentJobId(null);
          setJobProgress(null);

          // Transition part to FAILED
          setPartStatuses((prev) => {
            const newStatuses = new Map(prev);
            newStatuses.set(partIndex, 'FAILED');
            return newStatuses;
          });
          // Spec 2026-02-11: Mark increment as FAILED
          setIncrementStatusForPart(partIndex, 'FAILED');

          // Add error message (include the logs URL when the service provides one)
          const errorMessage: ChatMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: `Error: Part ${partIndex} implementation failed. ${jobStatus.error || ''}${jobStatus.logs_url ? `\nLogs: ${jobStatus.logs_url}` : ''}`,
            timestamp: new Date(),
            persona: 'Software Developer',
          };
          setMessages((prev) => [...prev, errorMessage]);
        } else if (jobStatus.status === 'cancelled') {
          // Job cancelled
          clearInterval(jobPollingIntervalRef.current!);
          jobPollingIntervalRef.current = null;
          setCurrentJobId(null);
          setJobProgress(null);

          setPartStatuses((prev) => {
            const newStatuses = new Map(prev);
            newStatuses.set(partIndex, 'FAILED');
            return newStatuses;
          });
          setIncrementStatusForPart(partIndex, 'FAILED');

          const cancelledMessage: ChatMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: `Part ${partIndex} implementation was cancelled.`,
            timestamp: new Date(),
            persona: 'Software Developer',
          };
          setMessages((prev) => [...prev, cancelledMessage]);
        } else {
          // Queued or running — surface progress instead of silence and keep polling
          setJobProgress({
            partIndex,
            status: jobStatus.status,
            currentStep: jobStatus.progress?.current_step,
            totalSteps: jobStatus.progress?.total_steps,
            stepDescription: jobStatus.progress?.step_description,
            percentage: jobStatus.progress?.percentage,
          });
        }
      } catch (err) {
        console.error('Job polling error:', err);
        // Don't stop polling on transient errors
      }
    };

    // Start polling interval
    jobPollingIntervalRef.current = setInterval(pollJob, JOB_POLLING_INTERVAL_MS);

    // Also poll immediately
    pollJob();
  }, [setIncrementStatusForPart]);

  // Keep startJobPollingRef in sync for forward-reference from triggerPartOrchestration
  startJobPollingRef.current = startJobPolling;

  /**
   * Spec 2026-06-12 (Task Group 5): Persist the implementation git outcome
   * (branch / PR URL / logs URL) onto the AMS work item so it survives
   * leaving the Implement screen.
   *
   * The AMS work-item PUT overwrites several fields with the request values
   * (title/description/priority/etc.), so the current work item is fetched
   * first and echoed back alongside the three new outcome fields.
   */
  const persistGitOutcome = useCallback(async (outcome: GitOutcome) => {
    if (!projectUuid || !workItemId || !hasGitOutcome(outcome)) {
      return;
    }
    try {
      const items = await fetchWorkItems(projectUuid);
      const current = items.find((wi) => wi.id === workItemId);
      await updateWorkItem(projectUuid, workItemId, {
        // Echo current values so the PUT does not wipe unrelated fields
        type: current?.type ?? workItemType,
        parentId: current?.parentId ?? undefined,
        title: current?.title ?? workItemTitle,
        description: current?.description ?? workItemDescription,
        status: current?.status,
        priority: current?.priority ?? undefined,
        targetWindow: current?.targetWindow ?? undefined,
        tags: current?.tags ?? undefined,
        // The git outcome — null-guarded on the backend (absent = unchanged)
        ...(outcome.branch ? { implementationBranch: outcome.branch } : {}),
        ...(outcome.prUrl ? { implementationPrUrl: outcome.prUrl } : {}),
        ...(outcome.logsUrl ? { implementationLogsUrl: outcome.logsUrl } : {}),
      });
      setPersistedGitOutcome(outcome);
    } catch (err) {
      console.warn('Failed to persist implementation git outcome to work item:', err);
      // Still surface it locally for this session even if persistence failed
      setPersistedGitOutcome(outcome);
    }
  }, [projectUuid, workItemId, workItemType, workItemTitle, workItemDescription]);

  // Keep persistGitOutcomeRef in sync for use inside the polling loop
  persistGitOutcomeRef.current = persistGitOutcome;

  /**
   * Spec 2026-06-12 (Task Group 5): On entering the Implement screen, load
   * any previously persisted git outcome from the AMS work item so the
   * branch / PR / logs links render again on revisit.
   */
  useEffect(() => {
    setPersistedGitOutcome(null);
    if (!projectUuid || !workItemId) {
      return;
    }
    let cancelled = false;
    fetchWorkItems(projectUuid)
      .then((items) => {
        if (cancelled) return;
        const item = items.find((wi) => wi.id === workItemId);
        if (item && (item.implementationBranch || item.implementationPrUrl || item.implementationLogsUrl)) {
          setPersistedGitOutcome({
            branch: item.implementationBranch ?? undefined,
            prUrl: item.implementationPrUrl ?? undefined,
            logsUrl: item.implementationLogsUrl ?? undefined,
          });
        }
      })
      .catch((err) => {
        console.warn('Failed to load persisted implementation outcome:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [projectUuid, workItemId]);

  /**
   * Task 6.8: Auto-advance to the next pending part after completion.
   * Now also starts the part workflow (elaborate with planner → shape-spec stream).
   */
  const autoAdvanceToNextPart = useCallback(async (completedPartIndex: number) => {
    const plan = latestPlannerResponse?.implementationPlan;
    if (!plan?.increments) return;

    const allParts = incrementsToParts(plan.increments);

    // Find next PENDING part
    const sortedParts = [...allParts].sort((a, b) => a.partIndex - b.partIndex);
    const nextPart = sortedParts.find(
      (p) => p.partIndex > completedPartIndex && partStatuses.get(p.partIndex) === 'PENDING'
    );

    if (!nextPart) return;

    // Transition next part to QA_IN_PROGRESS and set as active
    setPartStatuses((prev) => {
      const newStatuses = new Map(prev);
      newStatuses.set(nextPart.partIndex, 'QA_IN_PROGRESS');
      return newStatuses;
    });
    setActivePartIndex(nextPart.partIndex);

    // Reset folder ref for the new part
    latestFolderRef.current = null;
    setLatestFolder(null);

    const advanceMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: `Advancing to Part ${nextPart.partIndex}: ${nextPart.title}`,
      timestamp: new Date(),
      persona: 'Product Manager',
    };
    setMessages((prev) => [...prev, advanceMessage]);

    // Step b.1: Use prefetched spec if available, otherwise ask planner on-demand
    const totalParts = allParts.length;
    setRespondingPersona('Product Manager');

    let incrementResponse: PlannerResponse | null = null;
    const cached = prefetchedSpecs.get(nextPart.partIndex);
    if (cached) {
      // Spec 2026-02-11: Use pre-fetched spec (parallel prefetch hit)
      incrementResponse = cached;
    } else {
      // Fallback: elaborate on-demand (prefetch may have failed or not finished)
      try {
        incrementResponse = await elaboratePartSpec(nextPart, totalParts);
      } catch (err) {
        console.error('Failed to elaborate part spec:', err);
        const errMsg: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: `Error: Failed to elaborate spec for Part ${nextPart.partIndex}.`,
          timestamp: new Date(),
          persona: 'Product Manager',
        };
        setMessages((prev) => [...prev, errMsg]);
        setRespondingPersona(null);
        setPartStatuses((prev) => {
          const updated = new Map(prev);
          updated.set(nextPart.partIndex, 'FAILED');
          return updated;
        });
        return;
      }
    }

    if (!incrementResponse) {
      const errMsg: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: `Error: Planner returned empty spec for Part ${nextPart.partIndex}.`,
        timestamp: new Date(),
        persona: 'Product Manager',
      };
      setMessages((prev) => [...prev, errMsg]);
      setRespondingPersona(null);
      setPartStatuses((prev) => {
        const updated = new Map(prev);
        updated.set(nextPart.partIndex, 'FAILED');
        return updated;
      });
      return;
    }

    // Step b.2: Send to shape-spec stream
    let companyName = 'Unknown Organisation';
    if (activeProject?.organisationId) {
      try {
        const organisation = await getOrganisationById(activeProject.organisationId);
        if (organisation) {
          companyName = organisation.name;
        }
      } catch (err) {
        console.warn('Failed to fetch organisation name:', err);
      }
    }
    const projectName = activeProject?.name || projectId;

    // Use cached spec intent text if available (from triggerImplementationPlanning)
    const nextIncId = plan.increments.find(
      (_inc: unknown, idx: number) => idx === nextPart.partIndex - 1
    )?.id ?? `INC-${nextPart.partIndex}`;
    let streamMessage = specIntentTexts.get(nextIncId) ?? null;

    if (!streamMessage) {
      // Fallback: compose fresh (prefetch may not have completed for this part)
      const archContextBlock = await resolveAndFormatArchitectureContext(projectUuid || projectId, contextState, architectureExplainerRef.current);
      const incrementSpec = composeSpecIntent(incrementResponse, siblingStories);
      const fullFeatureCtx = composeFullFeatureContext(latestPlannerResponse);
      const incrementMessage = [incrementSpec, fullFeatureCtx]
        .filter(Boolean)
        .join('\n\n');
      streamMessage = appendArchitectureContext(incrementMessage, archContextBlock);
    }

    setIsStreaming(true);
    setRespondingPersona('Software Developer');
    receivedQuestionsInTurn.current = false;

    startStream({
      company: companyName,
      project: projectName,
      message: streamMessage,
      sessionMode: 'new',
      onContent: (delta: string) => {
        if (!delta || !delta.trim()) return;
        const newMessage: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          persona: 'Software Developer',
          content: delta,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, newMessage]);
      },
      onDone: () => {
        setIsStreaming(false);
        setRespondingPersona(null);
        if (!receivedQuestionsInTurn.current) {
          setStreamedQuestions([]);
          setStreamedAnswers({});
          // Spec 2026-02-11: Mark increment as READY_TO_EXECUTE before orchestration
          setIncrementStatusForPart(nextPart.partIndex, 'READY_TO_EXECUTE');
          const folder = latestFolderRef.current;
          if (folder) {
            triggerPartOrchestration(nextPart.partIndex, folder);
          } else {
            setPartStatuses((prev) => {
              const updated = new Map(prev);
              updated.set(nextPart.partIndex, 'READY_TO_RUN');
              return updated;
            });
          }
        }
        receivedQuestionsInTurn.current = false;
      },
      onError: (errorMsg: string) => {
        const errMessage: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: `Error: ${errorMsg}`,
          timestamp: new Date(),
          persona: 'Software Developer',
        };
        setMessages((prev) => [...prev, errMessage]);
        setIsStreaming(false);
        setRespondingPersona(null);
        setPartStatuses((prev) => {
          const updated = new Map(prev);
          updated.set(nextPart.partIndex, 'FAILED');
          return updated;
        });
        // Spec 2026-02-11: Mark increment as FAILED
        setIncrementStatusForPart(nextPart.partIndex, 'FAILED');
      },
      onQuestions: handleQuestionsEvent,
      onFolder: handleFolderEvent,
      onSession: handleSessionEvent,
    });
  }, [latestPlannerResponse, partStatuses, elaboratePartSpec, activeProject, projectId, startStream, handleQuestionsEvent, handleFolderEvent, handleSessionEvent, triggerPartOrchestration, contextState, prefetchedSpecs, setIncrementStatusForPart, specIntentTexts]);

  // Keep autoAdvanceRef in sync with the latest autoAdvanceToNextPart
  autoAdvanceRef.current = autoAdvanceToNextPart;

  const hasMessages = messages.length > 0;
  const canSend = inputMessage.trim().length > 0 && !isLoading && !isBootstrapping;
  // Spec 2026-01-18 Task 4.4: Updated canImplement to include PROPOSED check and isImplementing
  const canImplement = !!sessionId && !isLoading && !isBootstrapping && !!workItemId && hasProposedDefinition && !isImplementing;

  // Spec 2026-02-06: Extract parts from implementation plan for FeatureDefinitionPanel
  const parts = latestPlannerResponse?.implementationPlan?.increments
    ? incrementsToParts(latestPlannerResponse.implementationPlan.increments)
    : [];

  // Spec 2026-03-15: Resolve spec text for the currently open "See Spec" modal
  const specViewerText = specViewerModal
    ? specIntentTexts.get(specViewerModal.incrementId) ?? ''
    : '';

  // Spec 2026-03-19: Dynamic persona indicators based on current state and mode.
  // "In" = who is currently active, "Up Next" = who comes after.
  // Modes:
  //   standard / "Work on this now" (story-level): PM → TE → SD (all three)
  //   refine (feature-level "Refine"): PM → TE (no SD)
  //   refine_and_implement (feature-level "Refine and Implement"): PM → TE → SD
  //   holistic_only: TE only
  const personaIndicators = useMemo(() => {
    type PersonaInfo = { abbr: string; name: string; color: string };
    const PM: PersonaInfo = { abbr: 'PM', name: 'Product Manager', color: '#C62828' };
    const TE: PersonaInfo = { abbr: 'TE', name: 'Test Engineer', color: '#2E7D32' };
    const SD: PersonaInfo = { abbr: 'SD', name: 'Software Developer', color: '#455A64' };

    if (refinementMode === 'holistic_only') {
      return { current: TE, upNext: [] as PersonaInfo[] };
    }

    const includeSD = refinementMode !== 'refine';

    // Determine who is currently active
    if (isStreaming || hasTriggeredOrchestration) {
      // SD is active (implementing)
      return { current: SD, upNext: [] as PersonaInfo[] };
    }
    // Spec 2026-03-21: Also check latestTestPlannerResponse with open questions —
    // after triggerTestPlanning completes with questions, isTestPlanning is false
    // and hasTestPlan is false, but TE is still the active persona.
    const teHasOpenQuestions = latestTestPlannerResponse !== null
      && (latestTestPlannerResponse.openQuestions?.length ?? 0) > 0
      && !hasTestPlan;
    if (isTestPlanning || hasTestPlan || teHasOpenQuestions) {
      // TE is active or finished
      if (hasTestPlan && includeSD) {
        return { current: TE, upNext: [SD] };
      }
      return { current: TE, upNext: [] as PersonaInfo[] };
    }
    // PM is active (default state)
    if (includeSD) {
      return { current: PM, upNext: [TE, SD] };
    }
    return { current: PM, upNext: [TE] };
  }, [refinementMode, isStreaming, hasTriggeredOrchestration, isTestPlanning, hasTestPlan, latestTestPlannerResponse]);

  return (
    <>
    <div className={styles.container} data-testid="implementation-assistant-panel">
      {/* Mobile Tab Bar - Spec 2026-01-22 */}
      <div className={styles.mobileTabBar}>
        <button
          className={`${styles.mobileTab} ${activeTab === 'feature' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('feature')}
          data-testid="mobile-tab-feature"
        >
          Feature
        </button>
        <button
          className={`${styles.mobileTab} ${activeTab === 'chat' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('chat')}
          data-testid="mobile-tab-chat"
        >
          Chat
        </button>
      </div>

      {/* Split Container - 65% Feature / 35% Chat */}
      <div className={styles.splitContainer}>
        {/* Left Panel: Feature Definition (65%) */}
        <div className={`${styles.featurePanel} ${activeTab === 'feature' ? styles.activePanel : ''}`}>
          <FeatureDefinitionPanel
            workItemTitle={workItemTitle}
            workItemDescription={workItemDescription}
            plannerResponse={latestPlannerResponse}
            answers={answers}
            onAnswerChange={handleAnswerChange}
            onSubmitAnswers={handleSubmitAnswers}
            activeIncrementId={activeIncrementId}
            onIncrementSelect={setActiveIncrementId}
            epicName={epicName}
            featureName={featureName}
            workItemType={workItemType}
            contextState={contextState}
            contextLoading={contextLoading}
            onAddContext={onAddContext}
            onRemoveEntityChip={onRemoveEntityChip}
            onRemoveDiagramChip={onRemoveDiagramChip}
            questionStatuses={questionStatuses}
            isSubmittingAnswers={isSubmittingAnswers}
            getIncrementStatus={getIncrementStatus}
            onStartImplementation={handleStartImplementation}
            // Spec 2026-01-28: Shape-Spec 2 - Task Group 4 - Task 4.6
            // Pass streamed questions props to FeatureDefinitionPanel
            streamedQuestions={streamedQuestions}
            streamedAnswers={streamedAnswers}
            onStreamedAnswerChange={handleStreamedAnswerChange}
            onSubmitStreamedAnswers={handleAnswerStreamedQuestions}
            isStreamedQuestionsSubmitting={isSubmittingStreamedAnswers}
            canAnswerStreamedQuestions={canAnswerStreamedQuestions}
            // Spec 2026-02-06: Task Group 6 - Pass parts props to FeatureDefinitionPanel
            parts={parts}
            partStatuses={partStatuses}
            activePartIndex={activePartIndex}
            onPartClick={handlePartClick}
            onRetryOrchestration={handleRetryOrchestration}
            onResumeQA={handleResumeQA}
            onSeeSpec={(incrementId) => setSpecViewerModal({ incrementId })}
            onMarkComplete={handleMarkIncrementComplete}
            testPlan={latestTestPlannerResponse?.testPlan}
            teOpenQuestions={latestTestPlannerResponse?.openQuestions}
            teAnswers={teAnswers}
            teQuestionStatuses={teQuestionStatuses}
            onTeAnswerChange={handleTeAnswerChange}
            onSubmitTeAnswers={handleSubmitTeAnswers}
            isTeSubmitting={isTestPlanning}
            refinementProgressLabel={refinementProgress?.phase !== 'idle' ? refinementProgress?.label : undefined}
            isHolisticReview={refinementMode === 'holistic_only' || !!holisticReviewData}
          />
          {/* Feature Footer with Implement Button - Spec 2026-01-24 */}
          {/* Spec 2026-03-18: Hide Implement button in 'refine' and 'holistic_only' modes */}
          {refinementMode !== 'refine' && refinementMode !== 'holistic_only' && (
            <div className={styles.featureFooter}>
              <button
                className={styles.implementButton}
                onClick={handleImplementClick}
                disabled={!hasTestPlan || isImplementing || isStreaming}
                aria-label="Generate implementation specifications"
                data-testid="implement-button"
              >
                {isStreaming ? 'Streaming...' : isImplementing ? 'Implementing...' : 'Implement'}
              </button>
            </div>
          )}
          {/* Spec 2026-03-19: Confirmation button to advance to next story / save tests */}
          {readyToAdvance && (
            <div className={styles.featureFooter}>
              <button
                className={styles.implementButton}
                onClick={handleAdvanceClick}
                style={{ background: '#2E7D32' }}
                data-testid="advance-story-button"
              >
                {(refinementMode === 'holistic_only' || !!holisticReviewData)
                  ? 'Save Tests'
                  : refinementProgress?.phase === 'story_refine' && refinementProgress.current < refinementProgress.total
                    ? 'Move to next story'
                    : 'Continue to holistic review'}
              </button>
            </div>
          )}
          {/* Spec 2026-03-18: Show "Refinement Complete" in 'refine' mode when TE is done */}
          {refinementMode === 'refine' && hasTestPlan && !readyToAdvance && (
            <div className={styles.featureFooter}>
              <span style={{ color: '#2e7d32', fontWeight: 600, fontSize: '13px' }}>
                Refinement Complete
              </span>
            </div>
          )}
          {/* Spec 2026-03-19: Show "Holistic Review Complete" in 'holistic_only' mode */}
          {refinementMode === 'holistic_only' && hasTestPlan && (
            <div className={styles.featureFooter}>
              <span style={{ color: '#2e7d32', fontWeight: 600, fontSize: '13px' }}>
                Holistic Review Complete
              </span>
            </div>
          )}
        </div>

        {/* Right Panel: Team Chat (35%) */}
        <div className={`${styles.chatPanel} ${activeTab === 'chat' ? styles.activePanel : ''}`}>
          <div className={styles.chatHeader}>
            <div className={styles.chatHeaderLeft}>
              <span className={styles.chatHeaderTitle}>Chat</span>
              <span className={styles.chatHeaderSeparator}>&ndash;</span>
              <div className={styles.chatHeaderSection}>
                <span className={styles.chatHeaderLabel}>Room:</span>
                <span className={styles.chatHeaderPersonaName}>
                  Implementation Studio
                  {useSplitWorkflow && activePartIndex !== null && (
                    <span className={styles.activePartIndicator}> - Part {activePartIndex}</span>
                  )}
                </span>
              </div>
              <span className={styles.chatHeaderSeparator}>&ndash;</span>
              <div className={styles.chatHeaderSection}>
                <span className={styles.chatHeaderLabel}>In:</span>
                <div className={styles.chatHeaderPersonaIndicator} style={{ backgroundColor: personaIndicators.current.color }} title={personaIndicators.current.name}>{personaIndicators.current.abbr}</div>
                <span className={styles.chatHeaderPersonaName}>{personaIndicators.current.name}</span>
              </div>
              {personaIndicators.upNext.length > 0 && (
                <>
                  <span className={styles.chatHeaderSeparator}>&ndash;</span>
                  <div className={styles.chatHeaderSection}>
                    <span className={styles.chatHeaderLabel}>Up Next:</span>
                    {personaIndicators.upNext.map(p => (
                      <div key={p.abbr} className={styles.chatHeaderPersonaIndicator} style={{ backgroundColor: p.color }} title={p.name}>{p.abbr}</div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className={styles.chatHeaderActions}>
              <button className={styles.chatHeaderActionButton} onClick={handleClearClick} aria-label="Clear conversation and understanding" data-testid="impl-chat-clear-button">
                <Trash2 size={18} />
              </button>
            </div>
          </div>

          {/* Chat Content */}
          <div className={styles.chatContent}>
            {/* Spec 2026-02-06: Task 6.7 - Workflow completion message */}
            {allPartsCompleted && (
              <div className={styles.workflowCompleteMessage} data-testid="workflow-complete">
                All parts completed successfully!
              </div>
            )}

            {/* Spec 2026-01-13: Bootstrap loading state */}
            {isBootstrapping ? (
              <div className={styles.bootstrapLoading} data-testid="bootstrap-loading">
                <div className={styles.loadingSpinner} />
                <div className={styles.loadingText}>
                  Initializing assistant...
                </div>
              </div>
            ) : hasMessages ? (
              <div ref={messagesContainerRef} className={styles.messagesContainer}>
                {/* Spec 2026-01-28: Pass implementation_clarification phase for Software Developer messages */}
                {/* Spec 2026-01-28 Task Group 4: Persist phase when orchestration triggered */}
                <ChatMessageList
                  messages={messages}
                  currentPhase={(isStreaming || hasTriggeredOrchestration) ? 'implementation_clarification' : undefined}
                  disableAutoScroll={true}
                />
              </div>
            ) : (
              <div className={styles.emptyState} data-testid="implementation-assistant-empty">
                <div className={styles.emptyStateIcon}>
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    <line x1="9" y1="10" x2="15" y2="10" />
                    <line x1="12" y1="7" x2="12" y2="13" />
                  </svg>
                </div>
                <div className={styles.emptyStateText}>
                  Start a conversation to clarify this work item.
                </div>
                <div className={styles.emptyStateHint}>
                  The Implementation Assistant will help you understand requirements,
                  surface assumptions, and ensure clarity before implementation.
                </div>
              </div>
            )}

            {/* Spec 2026-02-11: Multi-persona activity indicator.
                Shows compound message when both PO (prefetching) and SA (streaming) are active. */}
            {(isPrefetching || respondingPersona) && (
              <div className={styles.loadingIndicator}>
                {isPrefetching && 'Product Manager is thinking...'}
                {isPrefetching && respondingPersona && ' '}
                {respondingPersona && `${respondingPersona} is responding...`}
              </div>
            )}
          </div>

          {/* Generated Specs Panel - Iteration 4 */}
          {generatedSpecs && generatedSpecs.length > 0 && (
            <div className={styles.specsPanel} data-testid="generated-specs-panel">
              <div className={styles.specsPanelHeader}>
                <h3>Generated Specifications (Not Yet Executed)</h3>
                <button
                  className={styles.copyButton}
                  onClick={handleCopyAll}
                  data-testid="copy-all-button"
                >
                  Copy All
                </button>
              </div>
              <div className={styles.specsWarning}>
                These specifications have not been executed. No changes have been made.
              </div>
              <div className={styles.specsContent}>
                {generatedSpecs.map((spec, index) => (
                  <pre key={index} className={styles.specBlock} data-testid={`spec-block-${index}`}>
                    {spec}
                  </pre>
                ))}
              </div>
            </div>
          )}

          {/* Handoff Plan Preview Panel - Spec 2026-01-14 */}
          {handoffPlan && (
            <div className={styles.handoffPlanPanel} data-testid="handoff-plan-panel">
              <div className={styles.handoffPlanHeader}>
                <h3>
                  Implementation Plan {' '}
                  {handoffPlan.is_split ? (
                    <span className={styles.handoffSplitBadge}>
                      {handoffPlan.handoff_intents.length} Sub-Specs
                    </span>
                  ) : (
                    <span className={styles.handoffNoSplitBadge}>Single Spec</span>
                  )}
                </h3>
              </div>
              <div className={styles.handoffPlanSummary}>
                {handoffPlan.handoff_plan_summary}
              </div>
              <div className={styles.handoffIntentsList}>
                {handoffPlan.handoff_intents.map((intent) => (
                  <div key={intent.id} className={styles.handoffIntentCard} data-testid={`intent-card-${intent.id}`}>
                    <div className={styles.handoffIntentCardHeader}>
                      <span className={styles.handoffIntentId}>{intent.id}</span>
                      <h4 className={styles.handoffIntentTitle}>{intent.title}</h4>
                    </div>
                    <div className={styles.handoffIntentDescription}>
                      {intent.intent}
                    </div>
                    {intent.in_scope.length > 0 && (
                      <div className={styles.handoffIntentSection}>
                        <div className={styles.handoffIntentSectionLabel}>In Scope</div>
                        <ul className={styles.handoffIntentList}>
                          {intent.in_scope.map((item, idx) => (
                            <li key={idx} className={`${styles.handoffIntentListItem} ${styles.inScope}`}>
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {intent.out_of_scope.length > 0 && (
                      <div className={styles.handoffIntentSection}>
                        <div className={styles.handoffIntentSectionLabel}>Out of Scope</div>
                        <ul className={styles.handoffIntentList}>
                          {intent.out_of_scope.map((item, idx) => (
                            <li key={idx} className={`${styles.handoffIntentListItem} ${styles.outOfScope}`}>
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {intent.acceptance_criteria.length > 0 && (
                      <div className={styles.handoffIntentSection}>
                        <div className={styles.handoffIntentSectionLabel}>Acceptance Criteria</div>
                        <ul className={styles.handoffIntentList}>
                          {intent.acceptance_criteria.map((item, idx) => (
                            <li key={idx} className={`${styles.handoffIntentListItem} ${styles.acceptance}`}>
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {intent.dependencies.length > 0 && (
                      <div className={styles.handoffIntentSection}>
                        <div className={styles.handoffIntentSectionLabel}>Dependencies</div>
                        <ul className={styles.handoffIntentList}>
                          {intent.dependencies.map((dep, idx) => (
                            <li key={idx} className={`${styles.handoffIntentListItem} ${styles.dependency}`}>
                              {dep}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Spec 2026-06-12: Implementation git outcome (persisted on the work item) */}
          {persistedGitOutcome && hasGitOutcome(persistedGitOutcome) && (
            <div className={styles.executionResultPanel} data-testid="implementation-outcome-panel">
              <div className={styles.executionResultPanelHeader}>
                <h3>Implementation Result</h3>
              </div>
              <div className={styles.executionResultContent}>
                {persistedGitOutcome.branch && (
                  <div className={styles.outcomeRow} data-testid="implementation-outcome-branch">
                    <span className={styles.outcomeLabel}>Feature branch:</span>{' '}
                    <code>{persistedGitOutcome.branch}</code>
                  </div>
                )}
                {persistedGitOutcome.prUrl && (
                  <div className={styles.outcomeRow} data-testid="implementation-outcome-pr">
                    <span className={styles.outcomeLabel}>Pull request:</span>{' '}
                    <a href={persistedGitOutcome.prUrl} target="_blank" rel="noopener noreferrer">
                      {persistedGitOutcome.prUrl}
                    </a>
                  </div>
                )}
                {persistedGitOutcome.logsUrl && (
                  <div className={styles.outcomeRow} data-testid="implementation-outcome-logs">
                    <span className={styles.outcomeLabel}>Logs:</span>{' '}
                    <a href={persistedGitOutcome.logsUrl} target="_blank" rel="noopener noreferrer">
                      {persistedGitOutcome.logsUrl}
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Spec 2026-06-12: Live progress while an orchestration job runs */}
          {jobProgress && (
            <div className={styles.jobProgressIndicator} data-testid="job-progress-indicator">
              <span>
                {`Implementing Part ${jobProgress.partIndex}`}
                {jobProgress.status === 'queued' && !jobProgress.stepDescription ? ' — queued' : ''}
                {jobProgress.currentStep != null && jobProgress.totalSteps != null
                  ? ` — step ${jobProgress.currentStep}/${jobProgress.totalSteps}`
                  : ''}
                {jobProgress.stepDescription ? `: ${jobProgress.stepDescription}` : ''}
                {jobProgress.percentage != null ? ` (${Math.round(jobProgress.percentage)}%)` : ''}
              </span>
            </div>
          )}

          {/* Input area - Spec 2026-01-24: Relocated to RHS chat panel only */}
          <div className={styles.inputArea}>
            <textarea
              className={styles.textarea}
              value={inputMessage}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={isLoading || isBootstrapping || isStreaming}
              aria-label="Chat message input"
            />
            <div className={styles.buttonRow}>
              <button
                className={styles.sendButton}
                onClick={handleSend}
                disabled={!canSend || isStreaming}
                aria-label="Send message"
                data-testid="send-button"
              >
                Send
              </button>
            </div>
          </div>

          {/* Spec 2026-03-15: Clear Conversation Confirmation Modal */}
          {showClearConfirm && (
            <div className={styles.confirmOverlay} onClick={handleClearCancel} data-testid="impl-clear-confirm-overlay">
              <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()} data-testid="impl-clear-confirm-dialog">
                <p className={styles.confirmMessage}>
                  This will clear the conversation and all generated understanding, scope, assumptions, and acceptance criteria. The Product Manager will restart the conversation.
                </p>
                <div className={styles.confirmActions}>
                  <button className={styles.confirmCancelButton} onClick={handleClearCancel} data-testid="impl-clear-confirm-cancel">
                    Cancel
                  </button>
                  <button className={styles.confirmClearButton} onClick={handleClearConfirm} data-testid="impl-clear-confirm-clear">
                    Clear Conversation and Understanding
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    <SpecViewerModal
      isOpen={specViewerModal !== null}
      onClose={() => setSpecViewerModal(null)}
      workItemName={workItemTitle}
      specText={specViewerText}
    />
    </>
  );
}

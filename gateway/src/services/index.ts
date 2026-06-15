/**
 * Central export for all services
 *
 * Spec 2026-03-02: Legacy Chat Removal and Cleanup (Increment 10)
 * - Removed: validateProductManagerResponse, createFallbackProductManagerResponse (from productManagerResponseValidator)
 * - Removed: validateSolutionArchitectResponse, createFallbackSolutionArchitectResponse (from solutionArchitectResponseValidator)
 * - Removed: validateRoadmapPmResponse, createFallbackRoadmapPmResponse, ROADMAP_PM_CORRECTIVE_INSTRUCTION (from roadmapPmResponseValidator)
 * - Removed: buildRoadmapSummary, hasExistingRoadmap, isFirstTurnRoadmapPm, countRoadmapItems barrel exports
 *   (chatV2.ts imports these directly from roadmapSummaryBuilder, not through the barrel)
 *
 * Spec 2026-03-06: Dashboard Real Data
 * - Removed: buildMockDashboardSummary (dashboardSummaryMockService deleted)
 * - Added: fetchWorkItemStats
 *
 * Spec 2026-05-01: Multi-Architecture Plumbing
 * - Added: listArchitectures, resolveDefaultArchitectureId (Bucket A list endpoint + Default resolver)
 */

export { logger, logRequestStart, logRequestEnd, logToolCall, logOpenAIRequest, logOasContent } from './logger';

export {
  getOrCreateSession,
  updateSession,
  getSession,
  deleteSession,
  startCleanupInterval,
  stopCleanupInterval,
  getSessionCount,
  clearAllSessions,
  runCleanup,
  sessionStore,
} from './sessionStore';

export { buildSystemPrompt, buildContextSummary, buildGenerateSpecsPrompt, buildBootstrapPrompt, buildHandoffPlanningPrompt, MISSION_GENERATION_PROMPT_TEMPLATE, ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE } from './promptBuilder';


export {
  isToolAllowed,
  validateToolArguments,
  executeTool,
  executeToolCall,
  getToolDefinitions,
} from './toolExecutor';

export {
  sendChatRequest,
  sendStreamingRequest,
  buildToolResultMessages,
  resetOpenAIClient,
  OpenAIMessage,
  OpenAIResponse,
  ChatRequestOptions,
  ContentPart,
} from './openaiClient';

// LLM Client Factory (Spec 2026-03-06: Azure OpenAI LLM Provider)
export {
  getLlmClient,
  createLlmClient,
  LlmClient,
  resetLlmClient,
} from './llmClient';

export { buildMessagesForTurn, persistConversation } from './conversation';

// Architecture Model Service Client (Spec: Iteration 3)
// Extended with bootstrap functions (Spec: Iteration 3 Stage 3)
// Extended with bundle expansion functions (Spec: 2026-01-16 Context Bundles Backend Expansion)
// Extended with fetchProductName (Spec: 2026-02-12 Increment 5)
// Extended with fetchWorkItemStats (Spec: 2026-03-06 Dashboard Real Data)
// Extended with listArchitectures + resolveDefaultArchitectureId (Spec: 2026-05-01 Multi-Architecture Plumbing)
export {
  resolveImplementContext,
  fetchProductSummary,
  fetchProductName,
  fetchMetaModelSummary,
  fetchWorkItemStats,
  expandResolveContext,
  hasBundleTypeSelections,
  tryResolveImplementContextWithBundles,
  listArchitectures,
  resolveDefaultArchitectureId,
} from './architectureModelClient';

// Specs Validator (Spec: Iteration 4 - Generate Specs)
export { validateGeneratedSpecs, SpecsValidationResult } from './specsValidator';

// Handoff Plan Validator (Spec 2026-01-14: Stage 6a)
export { validateHandoffPlan, generateFallbackPlan, HandoffPlanValidationResult } from './handoffPlanValidator';

// Planner Response Validator (Spec 2026-01-22: Expanded Planner JSON Contract v1.1)
export {
  validatePlannerResponse,
  createFallbackPlannerResponse,
  extractJson,
} from './plannerResponseValidator';

// Implementer Response Validator (Spec 2026-01-23: SA Handoff Per Increment)
export {
  validateImplementerResponse,
  createFallbackImplementerResponse,
} from './implementerResponseValidator';

// Test Planner Response Validator (Spec 2026-03-18: Refine Feature Flow)
export {
  validateTestPlannerResponse,
  createFallbackTestPlannerResponse,
} from './testPlannerResponseValidator';

// Holistic Test Planning Prompt (Spec 2026-03-19: Holistic TE Review)
export { buildHolisticTestPlanningPrompt, type StorySpecSummary } from './holisticTestPlanningPrompt';

// Jira Import Service (Spec 2026-02-15: RM Increment 4 -- Jira Import for Roadmap Skeleton)
export {
  importJiraRoadmap,
  JiraImportRequest,
  JiraImportResult,
  WorkItemDto,
  fetchJiraIssues,
  filterToInitiativesAndEpics,
  generateDeterministicId,
  constructExternalUrl,
  resolveOrphanEpics,
  buildSyntheticInitiative,
} from './jiraImportService';

// Implementation Clarification Prompt (Spec 2026-01-23: SA Handoff Per Increment)
export { buildImplementationClarificationPrompt } from './implementationClarificationPrompt';

// Implementation LLM Proxy Client (Spec 2026-02-01: Unify Implementation LLM Proxy Service Config)
// Replaces shapeSpecUpstreamClient and standardsServiceClient with unified auth
export {
  request,
  postJson,
  getJson,
  requestStream,
  RequestOptions,
  StreamRequestOptions,
} from './implementationLlmProxyClient';

// Transcript Store (Spec 2026-01-14: Stage 7 - Conversation Persistence)
export {
  initializeTranscript,
  getTranscript,
  appendTranscriptEntry,
  deleteTranscript,
  startTranscriptCleanupInterval,
  stopTranscriptCleanupInterval,
  getTranscriptCount,
  clearAllTranscripts,
  runTranscriptCleanup,
  transcriptStore,
} from './transcriptStore';

// Transcript Writer (Spec 2026-01-14: Stage 7 - Conversation Persistence)
// Extended with formatMessagesFromTranscript and writeConversationJson (Spec 2026-01-16: Conversation Persistence and Rehydration)
// Extended with normalizeKind (Spec 2026-02-12: Generalize Conversation Persistence to Support Kind)
export {
  writeTranscriptToFile,
  deriveFolderName,
  buildTranscriptPath,
  formatTranscript,
  formatMessagesFromTranscript,
  writeConversationJson,
  formatDisplayedConversation,
  writeDisplayedConversation,
  normalizeKind,
} from './transcriptWriter';

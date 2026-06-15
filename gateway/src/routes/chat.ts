/**
 * Chat routes for the Gateway API
 *
 * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
 * - Added transcript flushing after every ASSISTANT entry for implement_feature mode
 * - Integrated projectParentFolder, featureId, featureTitle for persistence
 *
 * Spec 2026-01-16: Fix Implement Context Resolution Entity Type Canonicalization
 * - Updated tryResolveImplementContext to use tryResolveImplementContextWithBundles
 * - Supports bundle-based context expansion when bundle_type is present
 *
 * Spec 2026-01-16: Fix Implement Assistant Context Injection
 * - Added bootstrap phase detection to fetch product and meta-model summaries
 * - Pass summaries to buildSystemPrompt for bootstrap phase
 *
 * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
 * - Added PlannerResponse validation for refine and implementation_planning phases
 * - Includes plannerResponse in ChatResponse for structured shaping output
 * - Uses fallback behavior to never break chat flow
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * - Added implementation_clarification phase handling
 * - Uses buildImplementationClarificationPrompt for SA system prompt
 * - Validates ImplementerResponse and includes in ChatResponse
 *
 * Spec 2026-01-24: Fix Planner JSON Parsing Regression
 * - Pass sessionId to validatePlannerResponse for logging correlation
 * - Update createFallbackPlannerResponse call (no longer pass raw content)
 * - Set assistant.message to safe fallback message when validation fails
 *
 * Spec 2026-02-17: Multi-File Upload + URL References
 * - Added buildContentParts, extractUrlsFromText, buildPersistenceContent helpers
 * - Added server-side file count and size validation
 *
 * Spec 2026-03-02: Legacy Chat Removal and Cleanup (Increment 10)
 * - Removed product_manager, solution_architect, roadmap_pm mode branches
 * - Removed all SA/PM/RM-specific constants, helpers, and validation logic
 * - Removed associated imports from ../services and ../types
 * - Kept OAS assistant and implement_feature modes fully intact
 */

import { Router, Request, Response, NextFunction } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../config';
import {
  ChatRequest,
  ChatResponse,
  ChatContext,
  ToolTraceItem,
  ChatArtifacts,
  SaveOasSpecSummaryDto,
  ToolCall,
  ToolResult,
  ResolvedImplementContextDto,
  ProductSummaryDto,
  MetaModelSummaryDto,
  TranscriptPhase,
  PlannerResponse,
  ImplementerResponse,
  Increment,
  TOOL_DEFINITIONS,
  ToolDefinition,
} from '../types';
import {
  getOrCreateSession,
  updateSession,
  buildSystemPrompt,
  // Hotfix 2026-05-15: implement_feature mode must route through the
  // provider-aware factory so an azure-openai config doesn't silently fall
  // back to the OpenAI SDK. We import getLlmClient() instead of the raw
  // sendChatRequest. sendStreamingRequest is kept on the legacy import
  // because the streaming endpoint is documented (line ~1298 below) as not
  // currently supporting implement_feature -- a follow-up spec will add
  // streaming to LlmClient + the Azure adapter.
  getLlmClient,
  sendStreamingRequest,
  buildToolResultMessages,
  executeToolCall,
  isToolAllowed,
  OpenAIMessage,
  logger,
  logRequestStart,
  logRequestEnd,
  buildMessagesForTurn,
  persistConversation,
  fetchProductSummary,
  fetchMetaModelSummary,
  resolveDefaultArchitectureId,
  validateGeneratedSpecs,
  validateHandoffPlan,
  generateFallbackPlan,
  appendTranscriptEntry,
  getTranscript,
  writeTranscriptToFile,
  tryResolveImplementContextWithBundles,
  validatePlannerResponse,
  createFallbackPlannerResponse,
  validateImplementerResponse,
  createFallbackImplementerResponse,
  validateTestPlannerResponse,
  createFallbackTestPlannerResponse,
  buildImplementationClarificationPrompt,
  ContentPart,
} from '../services';
import { fetchFullArchitectureContext } from '../services/architectureContextBuilder';
import { getThread } from '../services/threadStore';
import type { Thread } from '../types/chatV2';
import {
  validateChatRequestMiddleware,
  validateStreamRequestMiddleware,
} from '../middleware';
import {
  validateBaselineJsonShape,
  ensureMinimumServices,
  buildConversationTranscript,
  BASELINE_JSON_CORRECTIVE_INSTRUCTION,
} from './chatValidation';

// Re-export shared utilities for backward compatibility (other files may still import from './chat')
export { validateBaselineJsonShape, ensureMinimumServices, buildConversationTranscript, BASELINE_JSON_CORRECTIVE_INSTRUCTION };

export const chatRouter = Router();

/**
 * Safe fallback message for chat display when validation fails.
 * Matches the message in createFallbackPlannerResponse.
 *
 * Spec 2026-01-24: Fix Planner JSON Parsing Regression
 */
const SAFE_FALLBACK_MESSAGE = "I couldn't parse the structured response. Please try again.";

/**
 * Corrective instruction appended to messages when Planner JSON validation fails.
 * Used in the retry loop for implement_feature mode (refine and implementation_planning phases).
 */
const PLANNER_CORRECTIVE_INSTRUCTION = 'Your last response was not valid JSON. Return ONLY a single JSON object matching the PlannerResponse schema v1.1 with fields: schemaVersion, message, featureUnderstanding, scope, assumptions, acceptanceCriteria, openQuestions, plannerReadyForSpec, implementationPlan. No markdown, no code blocks, no prose outside the JSON.';

/**
 * Maximum number of retry attempts for Planner response validation.
 * On each failed attempt, a corrective instruction is appended and the LLM is re-called.
 * After all attempts are exhausted, the fallback response is returned.
 */
const MAX_PLANNER_RETRY_ATTEMPTS = 5;

/**
 * Determines if tool execution should be bypassed based on context mode.
 * In implement_feature mode, we skip the agent loop entirely.
 *
 * Spec 2026-03-02: Simplified -- only implement_feature bypasses tools.
 *
 * @param context - Chat context from request
 * @returns true if tool execution should be bypassed
 */
function shouldBypassToolExecution(context?: ChatContext): boolean {
  return context?.mode === 'implement_feature';
}

/**
 * Determines if transcript appending should be performed.
 * Append entries for implement_feature mode conversations.
 *
 * Spec 2026-01-14: Stage 7 - Conversation Persistence
 * Spec 2026-03-02: Simplified -- only implement_feature uses transcripts in v1.
 *
 * @param context - Chat context from request
 * @returns true if transcript should be appended
 */
function shouldAppendToTranscript(context?: ChatContext): boolean {
  return context?.mode === 'implement_feature';
}

/**
 * Gets the transcript phase from context, defaulting to 'refine' if absent.
 *
 * Spec 2026-01-14: Stage 7 - Conversation Persistence
 *
 * @param context - Chat context from request
 * @returns The transcript phase
 */
function getTranscriptPhase(context?: ChatContext): TranscriptPhase {
  return context?.phase || 'refine';
}

/**
 * Determines if the current phase should use PlannerResponse validation.
 * Applies to refine and implementation_planning phases.
 *
 * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
 *
 * @param context - Chat context from request
 * @returns true if PlannerResponse validation should be applied
 */
function shouldValidatePlannerResponse(context?: ChatContext): boolean {
  if (context?.mode !== 'implement_feature') {
    return false;
  }
  const phase = context?.phase;
  return phase === 'refine' || phase === 'implementation_planning';
}

/**
 * Determines if the current phase should use ImplementerResponse validation.
 * Applies only to implementation_clarification phase.
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 *
 * @param context - Chat context from request
 * @returns true if ImplementerResponse validation should be applied
 */
function shouldValidateImplementerResponse(context?: ChatContext): boolean {
  if (context?.mode !== 'implement_feature') {
    return false;
  }
  return context?.phase === 'implementation_clarification';
}

/**
 * Determines if the current phase should use TestPlannerResponse validation.
 * Applies only to test_planning phase.
 */
function shouldValidateTestPlannerResponse(context?: ChatContext): boolean {
  if (context?.mode !== 'implement_feature') {
    return false;
  }
  return context?.phase === 'test_planning' || context?.phase === 'test_planning_holistic';
}

/**
 * Determines if implementationPlan is expected in the PlannerResponse.
 * True for implementation_planning phase, false for refine phase.
 *
 * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
 *
 * @param context - Chat context from request
 * @returns true if implementationPlan is expected
 */
function expectImplementationPlan(context?: ChatContext): boolean {
  return context?.phase === 'implementation_planning';
}

/**
 * Flushes the transcript to disk for modes that support disk persistence.
 * Non-blocking: logs errors but does not fail the chat request.
 *
 * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
 * Spec 2026-03-02: Simplified -- only implement_feature uses disk persistence in v1.
 *
 * @param sessionId - The session ID
 * @param context - Chat context containing persistence metadata
 * @param requestId - Request ID for logging
 */
async function flushTranscriptToDisk(
  sessionId: string,
  context: ChatContext | undefined,
  requestId: string
): Promise<void> {
  // Only flush for implement_feature mode
  if (context?.mode !== 'implement_feature') {
    return;
  }

  const featureId = context.featureId;
  const featureTitle = context.featureTitle;
  const projectParentFolder = context.projectParentFolder;

  // Log warning if persistence metadata is missing
  const missingFields: string[] = [];
  if (!projectParentFolder) missingFields.push('projectParentFolder');
  if (!featureId) missingFields.push('featureId');
  if (!featureTitle) missingFields.push('featureTitle');

  if (missingFields.length > 0) {
    logger.warn('Transcript persistence skipped: missing required fields', {
      requestId,
      sessionId,
      featureId: featureId || 'not provided',
      featureTitle: featureTitle || 'not provided',
      projectParentFolder: projectParentFolder || 'not provided',
      missingFields,
    });
    // Spec requirement: skip persistence when required fields are missing
    return;
  }

  // Get the transcript
  const transcript = getTranscript(sessionId);
  if (!transcript) {
    logger.warn('Cannot flush transcript: transcript not found', {
      requestId,
      sessionId,
    });
    return;
  }

  // Determine the conversation kind based on mode
  const kind = 'implement';

  // Write transcript to disk (non-blocking)
  try {
    await writeTranscriptToFile(
      transcript,
      featureTitle || '',
      featureId || '',
      projectParentFolder!,
      kind,
      context.displayedMessages
    );
  } catch (error) {
    // Log error but don't fail the request
    logger.error('Failed to flush transcript to disk - persistence error', {
      requestId,
      sessionId,
      featureId: featureId || 'not provided',
      featureTitle: featureTitle || 'not provided',
      projectParentFolder: projectParentFolder || 'not provided',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Builds an OpenAI content parts array from augmented message text and attached files.
 * The text part comes first, followed by file/image parts in attachment order.
 *
 * Image MIME types (starting with "image/") produce image_url content parts.
 * Non-image MIME types produce file content parts.
 *
 * Spec 2026-02-17: Multi-File Upload + URL References
 * Task Group 2: Content Parts Construction
 *
 * @param augmentedMessage - The augmented user message text (may include URL-fetched content)
 * @param files - Array of attached files with filename, mimeType, and base64 data
 * @returns ContentPart[] array with text first, then file/image parts
 */
export function buildContentParts(
  augmentedMessage: string,
  files: Array<{ filename: string; mimeType: string; base64: string }>
): ContentPart[] {
  const parts: ContentPart[] = [
    { type: 'text', text: augmentedMessage },
  ];

  for (const file of files) {
    if (file.mimeType.startsWith('image/')) {
      // Images: send as image_url content part
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${file.mimeType};base64,${file.base64}`,
          detail: 'auto',
        },
      });
    } else if (file.mimeType === 'application/pdf') {
      // PDFs: send as file content part (only MIME type OpenAI supports for file type)
      parts.push({
        type: 'file',
        file: {
          file_data: `data:${file.mimeType};base64,${file.base64}`,
          filename: file.filename,
        },
      });
    } else {
      // Text-based files (txt, csv, yaml, json, md, etc.): decode and inline as text
      // OpenAI only accepts application/pdf for the file content type;
      // all other file types must be inlined as text content.
      const decoded = Buffer.from(file.base64, 'base64').toString('utf-8');
      parts.push({
        type: 'text',
        text: `--- File: ${file.filename} ---\n${decoded}\n--- End of ${file.filename} ---`,
      });
    }
  }

  return parts;
}

/**
 * Extracts HTTP and HTTPS URLs from message text.
 * Used to auto-detect URLs in message text when files are attached
 * so they can be fetched server-side via buildAugmentedMessage.
 *
 * Spec 2026-02-17: Multi-File Upload + URL References
 * Task Group 2: URL Auto-Detection
 *
 * @param text - The message text to scan for URLs
 * @returns Array of URL strings found in the text
 */
export function extractUrlsFromText(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^\[\]`]+/g;
  const matches = text.match(urlRegex);
  return matches || [];
}

/**
 * Builds the persistence-safe content string for messages with attached files.
 * Replaces the full content parts array (which contains base64 data) with a
 * plain string containing the original message text and a list of attached filenames.
 *
 * Spec 2026-02-17: Multi-File Upload + URL References
 * Task Group 2: Persistence Stripping
 *
 * @param originalMessage - The original user message text (before augmentation)
 * @param files - Array of attached files (only filenames are used)
 * @returns Plain string with format: "<original text>\n\n[Attached: file1.pdf, file2.png]"
 */
export function buildPersistenceContent(
  originalMessage: string,
  files: Array<{ filename: string; mimeType: string; base64: string }>
): string {
  const filenames = files.map(f => f.filename).join(', ');
  return `${originalMessage}\n\n[Attached: ${filenames}]`;
}



/**
 * Builds an augmented message by reading source documents (local files or URLs)
 * and appending their content to the user's message.
 *
 * @param message - The original user message
 * @param sources - Optional array of file paths or URLs
 * @param requestId - Request ID for logging
 * @returns The augmented message with document contents appended
 */
async function buildAugmentedMessage(
  message: string,
  sources: string[] | undefined,
  requestId: string
): Promise<string> {
  if (!sources || sources.length === 0) return message;

  const parts: string[] = [message, '\n\n--- ATTACHED DOCUMENTS ---'];

  for (const source of sources) {
    try {
      if (source.startsWith('http://') || source.startsWith('https://')) {
        const resp = await fetch(source, { signal: AbortSignal.timeout(10000) });
        const text = await resp.text();
        parts.push(`\n\n### Source: ${source}\n${text.substring(0, 50000)}`);
      } else {
        const { promises: fs } = await import('fs');
        const content = await fs.readFile(source, 'utf8');
        parts.push(`\n\n### Source: ${source}\n${content.substring(0, 50000)}`);
      }
    } catch (err) {
      logger.warn('Failed to read source', { requestId, source, error: (err as Error).message });
      parts.push(`\n\n### Source: ${source}\n[Error: Could not read this source: ${(err as Error).message}]`);
    }
  }

  return parts.join('');
}

/**
 * Resolves the implement context if in implement_feature mode.
 * Returns null if resolution fails or mode is not implement_feature.
 *
 * Spec: Implement Context Resolution - Iteration 3
 * Spec 2026-01-16: Context Bundles Backend Expansion - Task Group 9
 * - Now delegates to tryResolveImplementContextWithBundles
 * - Supports bundle-based context expansion when bundle_type is present
 *
 * @param context - Chat context from request
 * @param requestId - Request ID for logging
 * @returns ResolvedImplementContextDto or null
 */
async function tryResolveImplementContext(
  context: ChatContext | undefined,
  requestId: string
): Promise<ResolvedImplementContextDto | null> {
  // Delegate to the bundle-aware resolution function
  // This handles both standard resolve and expand-resolve based on bundle_type presence
  return tryResolveImplementContextWithBundles(context, requestId);
}

/**
 * Formats a hub thread into a compact backlog conversation string for prompt injection.
 * Prefers the rolling summary if available; otherwise renders recent messages.
 * Truncates to a reasonable size to avoid token explosion.
 *
 * @param hubThread - The hub thread loaded from disk, or null
 * @returns Formatted backlog conversation string, or fallback message
 */
function formatBacklogConversation(hubThread: Thread | null): string {
  if (!hubThread) {
    return 'No prior backlog conversation available.';
  }

  const parts: string[] = [];

  // If a rolling summary exists, prefer it for compactness
  if (hubThread.summary) {
    parts.push('### Rolling Summary of Earlier Discussion');
    parts.push(hubThread.summary);
    parts.push('');
  }

  // Include messages after the summarised point (or all if no summary)
  const startIdx = hubThread.summary ? hubThread.summarisedUpToIndex : 0;
  const relevantMessages = hubThread.messages.slice(startIdx);

  if (relevantMessages.length > 0) {
    // Cap at last 40 messages to keep prompt size manageable
    const maxMessages = 40;
    const messagesToInclude = relevantMessages.length > maxMessages
      ? relevantMessages.slice(-maxMessages)
      : relevantMessages;

    if (messagesToInclude.length < relevantMessages.length) {
      parts.push(`(Showing last ${maxMessages} of ${relevantMessages.length} messages)`);
      parts.push('');
    }

    parts.push('### Conversation');
    for (const msg of messagesToInclude) {
      const role = msg.role === 'user' ? 'User' : 'Product Manager';
      // Truncate very long individual messages
      const content = msg.content.length > 1000
        ? msg.content.slice(0, 1000) + '...(truncated)'
        : msg.content;
      parts.push(`**${role}:** ${content}`);
    }
  }

  if (parts.length === 0) {
    return 'No prior backlog conversation available.';
  }

  return parts.join('\n');
}

/**
 * Fetches product and meta-model summaries for bootstrap phase,
 * and loads the hub thread backlog conversation for all implement_feature phases.
 * Returns null for any item if fetch fails (graceful degradation).
 *
 * Spec 2026-01-16: Fix Implement Assistant Context Injection
 * Task Group 1: Bootstrap Phase Summary Fetching
 *
 * Spec 2026-03-17: Inject Backlog Conversation into Implementation Prompts
 * - Loads hub thread and formats backlog conversation for PM context
 *
 * @param context - Chat context from request
 * @param requestId - Request ID for logging
 * @returns Object containing productSummary, metaModelSummary, fullArchitectureModel, and backlogConversation (any may be null)
 */
async function tryFetchBootstrapSummaries(
  context: ChatContext | undefined,
  requestId: string
): Promise<{ productSummary: ProductSummaryDto | null; metaModelSummary: MetaModelSummaryDto | null; fullArchitectureModel: object | null; backlogConversation: string | null }> {
  // Full architecture model and backlog conversation are fetched for ALL implement_feature phases;
  // productSummary and metaModelSummary are only fetched for bootstrap phase.
  if (context?.mode !== 'implement_feature') {
    return { productSummary: null, metaModelSummary: null, fullArchitectureModel: null, backlogConversation: null };
  }

  // Use context.projectId (UUID) for work-item queries; fall back to filename
  const projectId = context.projectId || context.filename;
  if (!projectId) {
    logger.warn('Cannot fetch bootstrap summaries: no projectId or filename provided', { requestId });
    return { productSummary: null, metaModelSummary: null, fullArchitectureModel: null, backlogConversation: null };
  }

  logger.debug('Fetching summaries for implement_feature project', {
    requestId,
    projectId,
    phase: context.phase,
  });

  // Fetch full architecture model for ALL implement_feature phases
  const fullArchitectureModelPromise = fetchFullArchitectureContext(projectId).catch((error) => {
    logger.warn('Failed to fetch full architecture model, proceeding without it', {
      requestId,
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  });

  // Load hub thread for backlog conversation context (all phases)
  const hubThreadPromise = getThread({ type: 'hub', projectId }).catch((error) => {
    logger.warn('Failed to load hub thread for backlog conversation, proceeding without it', {
      requestId,
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  });

  // Only fetch product/meta-model summaries for bootstrap phase
  if (context.phase !== 'bootstrap') {
    const [fullArchitectureModel, hubThread] = await Promise.all([
      fullArchitectureModelPromise,
      hubThreadPromise,
    ]);
    const backlogConversation = formatBacklogConversation(hubThread);
    return { productSummary: null, metaModelSummary: null, fullArchitectureModel, backlogConversation };
  }

  // Bootstrap phase: fetch all in parallel.
  // Spec 2026-05-01 Multi-Architecture Plumbing - Task Group 3:
  //   resolve the project's Default architecture (oldest non-archived) before
  //   the Bucket A meta-model-summary call, since that endpoint now requires
  //   an architectureId path segment.
  const architectureId = await resolveDefaultArchitectureId(projectId).catch((error) => {
    logger.warn('Failed to resolve default architecture, proceeding without meta-model summary', {
      requestId,
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  });

  const [productSummary, metaModelSummary, fullArchitectureModel, hubThread] = await Promise.all([
    fetchProductSummary(projectId).catch((error) => {
      logger.warn('Failed to fetch product summary, proceeding without it', {
        requestId,
        projectId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }),
    architectureId
      ? fetchMetaModelSummary(projectId, architectureId).catch((error) => {
          logger.warn('Failed to fetch meta-model summary, proceeding without it', {
            requestId,
            projectId,
            architectureId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          return null;
        })
      : Promise.resolve(null),
    fullArchitectureModelPromise,
    hubThreadPromise,
  ]);

  // Log warnings for null results (fetch functions already log internally,
  // but we add context-specific warnings here)
  if (productSummary === null) {
    logger.warn('Product summary not available for bootstrap phase', {
      requestId,
      projectId,
    });
  }

  if (metaModelSummary === null) {
    logger.warn('Meta-model summary not available for bootstrap phase', {
      requestId,
      projectId,
    });
  }

  const backlogConversation = formatBacklogConversation(hubThread);

  logger.debug('Bootstrap summaries fetched', {
    requestId,
    projectId,
    hasProductSummary: productSummary !== null,
    hasMetaModelSummary: metaModelSummary !== null,
    hasFullArchitectureModel: fullArchitectureModel !== null,
    hasBacklogConversation: hubThread !== null,
    initiativesCount: productSummary?.initiatives?.length || 0,
    servicesCount: metaModelSummary?.services?.length || 0,
  });

  return { productSummary, metaModelSummary, fullArchitectureModel, backlogConversation };
}

/**
 * POST /api/chat
 *
 * Send a user chat message and receive an assistant response (non-streaming).
 */
chatRouter.post(
  '/',
  validateChatRequestMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const requestId = req.requestId;
    const body = req.body as ChatRequest;
    const { message, context, sources, files } = body;

    // Generate sessionId if missing or blank after trim
    const sessionCreated = !body.sessionId?.trim();
    const effectiveSessionId = body.sessionId?.trim() || uuidv4();

    if (sessionCreated) {
      logger.info('Session ID generated by gateway', {
        session_created: true,
        sessionId: effectiveSessionId,
        requestId,
      });
    }

    logRequestStart(requestId, effectiveSessionId, 'POST', '/api/chat');

    try {
      const config = getConfig();

      // Get or create session
      const session = getOrCreateSession(effectiveSessionId);

      // Spec 2026-02-17: Multi-File Upload - Server-side validation for files array
      // Task Group 2: Validate file count and individual file sizes before any LLM logic
      if (files && files.length > 0) {
        if (files.length > 10) {
          res.status(400).json({ error: 'Maximum 10 files allowed' });
          return;
        }
        const MAX_BASE64_LENGTH = 6_670_000; // ~5 MB raw * 1.34 base64 overhead
        for (const file of files) {
          if (file.base64.length > MAX_BASE64_LENGTH) {
            res.status(400).json({ error: `File exceeds 5 MB limit: ${file.filename}` });
            return;
          }
        }
      }

      // Resolve implement context if in implement_feature mode
      // Spec: Implement Context Resolution - Iteration 3
      // Spec 2026-01-16: Context Bundles Backend Expansion - supports bundle-based expansion
      const resolvedContext = await tryResolveImplementContext(context, requestId);

      // Spec 2026-01-16: Fetch bootstrap summaries for bootstrap phase
      // Task Group 1: Bootstrap Phase Summary Fetching
      const { productSummary, metaModelSummary, fullArchitectureModel, backlogConversation } = await tryFetchBootstrapSummaries(context, requestId);

      // Spec 2026-03-18: Inject test_planning context (TEST-STRATEGY.MD) before buildSystemPrompt
      if ((context?.phase === 'test_planning' || context?.phase === 'test_planning_holistic') && context.projectParentFolder) {
        let testStrategyContent: string | null = null;
        try {
          const testStrategyPath = path.join(context.projectParentFolder, 'agent-os', 'product', 'TEST-STRATEGY.MD');
          testStrategyContent = await fs.readFile(testStrategyPath, 'utf-8');
        } catch {
          logger.debug('TEST-STRATEGY.MD not found for test_planning context injection (optional, proceeding)', { requestId });
        }
        (context as Record<string, unknown>).testStrategy = testStrategyContent;
      }

      // Spec 2026-01-23: Build SA prompt for implementation_clarification phase
      // For this phase, we need the increment data which would be passed via the request
      // In v1, the increment is passed via a custom field or derived from context
      // For now, we use the standard prompt builder - SA prompt integration will be refined
      let systemPrompt: string;

      if (shouldValidateImplementerResponse(context)) {
        // Implementation clarification phase: use SA prompt
        // Note: In a full implementation, the increment would be passed in the request
        // For now, we build a placeholder prompt - the frontend will need to include increment data
        logger.debug('Using implementation_clarification phase - SA prompt expected', {
          requestId,
          sessionId: effectiveSessionId,
        });
        // For v1, fall back to standard prompt until frontend sends increment data
        systemPrompt = buildSystemPrompt(session, context, resolvedContext, productSummary, metaModelSummary, fullArchitectureModel, backlogConversation);
      } else {
        // Build system prompt with context, resolved context, and summaries
        // Spec 2026-01-16: Pass summaries as 4th and 5th parameters
        systemPrompt = buildSystemPrompt(session, context, resolvedContext, productSummary, metaModelSummary, fullArchitectureModel, backlogConversation);
      }


      // Spec 2026-01-14: Stage 7 - Append SYSTEM entry to transcript
      // Only append for modes that support transcript persistence
      if (shouldAppendToTranscript(context)) {
        const phase = getTranscriptPhase(context);
        appendTranscriptEntry(effectiveSessionId, 'SYSTEM', phase, systemPrompt);
      }

      // Spec 2026-02-13: Augment message with document sources if provided
      // Spec 2026-02-17: When files are present but no sources, extract URLs from message text
      // and pass them as synthetic sources so URL content is still fetched and appended to the text part
      let effectiveSources = sources;
      if (files && files.length > 0 && (!sources || sources.length === 0)) {
        const extractedUrls = extractUrlsFromText(message);
        if (extractedUrls.length > 0) {
          effectiveSources = extractedUrls;
        }
      }
      const augmentedMessage = await buildAugmentedMessage(message, effectiveSources, requestId);

      // Build messages with conversation history
      const messages = buildMessagesForTurn(session, systemPrompt, augmentedMessage);

      // Spec 2026-02-17: When files are attached, set the user message content to a ContentPart[]
      // array (text + file/image parts) instead of a plain string.
      // The last message in the array is the user message we just added.
      if (files && files.length > 0) {
        const contentParts = buildContentParts(augmentedMessage, files);
        const userMessageIdx = messages.length - 1;
        messages[userMessageIdx] = { ...messages[userMessageIdx], content: contentParts };
      }


      // Spec 2026-01-14: Stage 7 - Append USER entry to transcript
      // Only append for implement_feature mode
      if (shouldAppendToTranscript(context)) {
        const phase = getTranscriptPhase(context);
        appendTranscriptEntry(effectiveSessionId, 'USER', phase, augmentedMessage);
      }

      // Debug logging for conversation memory
      logger.debug('Building messages for turn', {
        requestId,
        sessionId: effectiveSessionId,
        priorConversationCount: session.conversation?.length || 0,
        mode: context?.mode || 'oas_assistant',
        intent: context?.intent || 'normal_chat',
        phase: context?.phase || 'none',
        hasResolvedContext: !!resolvedContext,
        hasProductSummary: productSummary !== null,
        hasMetaModelSummary: metaModelSummary !== null,
      });

      // Track tool calls and artifacts
      const toolTrace: ToolTraceItem[] = [];
      const artifacts: ChatArtifacts = {};
      let toolCallCount = 0;

      // Send initial request via the provider-aware LLM client (Hotfix 2026-05-15)
      let response = await getLlmClient().sendChatRequest(messages, requestId, effectiveSessionId);

      // Check if we should bypass tool execution (implement_feature mode)
      const bypassTools = shouldBypassToolExecution(context);

      if (bypassTools) {
        // In implement_feature mode: skip the agent loop entirely
        // Treat the response as final regardless of tool calls
        logger.debug('Bypassing tool execution for mode', {
          requestId,
          sessionId: effectiveSessionId,
          mode: context?.mode,
        });
      } else {
        // OAS assistant mode: run the normal agent loop
        while (!response.isFinal && toolCallCount < config.maxToolCallsPerTurn) {
          const toolCalls = response.toolCalls || [];

          if (toolCalls.length === 0) {
            break;
          }

          // Create assistant message with tool calls for context
          const assistantMessage: OpenAIMessage = {
            role: 'assistant',
            content: '',
            tool_calls: toolCalls.map(tc => ({
              id: tc.callId,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          };

          // Execute tool calls
          const toolResults: ToolResult[] = [];

          for (const toolCall of toolCalls) {
            toolCallCount++;

            const result = await executeToolCall(
              toolCall.callId,
              toolCall.name,
              toolCall.arguments,
              session.mcpSessionId,
              requestId,
              effectiveSessionId
            );

            toolResults.push({
              callId: result.callId,
              output: result.output,
              error: result.error,
            });

            // Track for tool trace
            if (config.enableToolTrace) {
              toolTrace.push({
                toolName: toolCall.name,
                status: result.status,
                durationMs: result.durationMs,
              });
            }

            // Extract artifacts from save_oas_spec
            if (toolCall.name === 'save_oas_spec' && result.output && !result.error) {
              artifacts.savedSpec = result.output as SaveOasSpecSummaryDto;
            }

            if (toolCallCount >= config.maxToolCallsPerTurn) {
              break;
            }
          }

          // Build messages with tool results
          const toolResultMessages = buildToolResultMessages(assistantMessage, toolResults);
          messages.push(...toolResultMessages);

          // Send tool results back via the provider-aware LLM client (Hotfix 2026-05-15)
          response = await getLlmClient().sendChatRequest(messages, requestId, effectiveSessionId);
        }
      }

      // Spec 2026-01-14: Stage 7 - Append ASSISTANT entry to transcript
      // Only append for implement_feature mode
      if (shouldAppendToTranscript(context)) {
        const phase = getTranscriptPhase(context);
        appendTranscriptEntry(effectiveSessionId, 'ASSISTANT', phase, response.content || '');
      }

      // Spec 2026-01-15: Flush transcript to disk after ASSISTANT entry
      // Non-blocking: errors are logged but don't fail the request
      await flushTranscriptToDisk(effectiveSessionId, context, requestId);

      // Append final assistant response to messages for persistence
      messages.push({ role: 'assistant', content: response.content || '' });

      // Debug logging for messages sent count
      logger.debug('Persisting conversation after response', {
        requestId,
        sessionId: effectiveSessionId,
        messagesSentCount: messages.length,
        mode: context?.mode || 'oas_assistant',
      });

      // Persist conversation before returning response (default behavior)
      persistConversation(effectiveSessionId, messages);

      // Update session with context
      updateSession(effectiveSessionId, {
        filename: context?.filename || session.filename,
        interfaceId: context?.interfaceId || session.interfaceId,
        lastDraftOas: context?.draftOas || session.lastDraftOas,
        lastSavedSpecSummary: artifacts.savedSpec || session.lastSavedSpecSummary,
      });

      // Build response
      let chatResponse: ChatResponse = {
        sessionId: effectiveSessionId,
        assistant: {
          message: response.content || '',
          ...(config.enableToolTrace && toolTrace.length > 0 ? { toolTrace } : {}),
          ...(Object.keys(artifacts).length > 0 ? { artifacts } : {}),
        },
      };

      // Spec 2026-01-23: Handle implementation_clarification phase with ImplementerResponse validation
      if (shouldValidateImplementerResponse(context)) {
        const validationResult = validateImplementerResponse(response.content || '');

        logger.info('Implementer response validation result', {
          requestId,
          sessionId: effectiveSessionId,
          phase: context?.phase,
          valid: validationResult.valid,
          questionsCount: validationResult.implementerResponse?.openQuestions?.length || 0,
          error: validationResult.error,
        });

        if (validationResult.valid && validationResult.implementerResponse) {
          // Validation succeeded: include implementerResponse in response
          chatResponse = {
            ...chatResponse,
            assistant: {
              ...chatResponse.assistant,
              // Use the message from implementerResponse for chat display
              message: validationResult.implementerResponse.message,
            },
            implementerResponse: validationResult.implementerResponse,
          };

          logger.debug('Implementer response validation succeeded', {
            requestId,
            sessionId: effectiveSessionId,
            phase: context?.phase,
            questionsCount: validationResult.implementerResponse.openQuestions.length,
            incrementReady: validationResult.implementerResponse.openQuestions.length === 0,
          });
        } else {
          // Validation failed: use fallback (never break chat flow)
          const fallback = createFallbackImplementerResponse(response.content || '');

          chatResponse = {
            ...chatResponse,
            implementerResponse: fallback,
            error: validationResult.error || 'Failed to parse implementer response',
          };

          logger.warn('Implementer response validation failed, using fallback', {
            requestId,
            sessionId: effectiveSessionId,
            phase: context?.phase,
            error: validationResult.error,
            rawContentLength: (response.content || '').length,
          });
        }
      }

      // Spec 2026-01-22: Handle refine and implementation_planning phases with PlannerResponse validation
      // Spec 2026-01-24: Fix Planner JSON Parsing Regression
      // Spec 2026-02-16: Added corrective retry loop (up to MAX_PLANNER_RETRY_ATTEMPTS)
      // On each failed attempt, append corrective instruction and resend to LLM.
      // The user sees "Thinking..." during retries (all within a single HTTP request).
      if (shouldValidatePlannerResponse(context)) {
        const expectPlan = expectImplementationPlan(context);
        let currentContent = response.content || '';
        let validationResult = validatePlannerResponse(currentContent, expectPlan, effectiveSessionId);
        let attemptNumber = 1;

        logger.info('Planner response validation result', {
          requestId,
          sessionId: effectiveSessionId,
          phase: context?.phase,
          attempt: attemptNumber,
          valid: validationResult.valid,
          expectImplementationPlan: expectPlan,
          hasImplementationPlan: validationResult.plannerResponse?.implementationPlan !== null,
          error: validationResult.error,
        });

        // Corrective retry loop: if validation fails, retry up to MAX_PLANNER_RETRY_ATTEMPTS
        while (!validationResult.valid && attemptNumber < MAX_PLANNER_RETRY_ATTEMPTS) {
          attemptNumber++;

          logger.warn('Planner response validation failed, attempting corrective retry', {
            requestId,
            sessionId: effectiveSessionId,
            phase: context?.phase,
            attempt: attemptNumber,
            maxAttempts: MAX_PLANNER_RETRY_ATTEMPTS,
            previousError: validationResult.error,
            rawContentLength: currentContent.length,
          });

          // Append the invalid assistant response and corrective instruction
          messages.push({ role: 'assistant', content: currentContent });
          messages.push({ role: 'user', content: PLANNER_CORRECTIVE_INSTRUCTION });

          // Resend via the provider-aware LLM client (Hotfix 2026-05-15)
          const retryResponse = await getLlmClient().sendChatRequest(messages, requestId, effectiveSessionId);
          currentContent = retryResponse.content || '';

          // Validate the retry response
          validationResult = validatePlannerResponse(currentContent, expectPlan, effectiveSessionId);

          logger.info('Planner response validation result (retry)', {
            requestId,
            sessionId: effectiveSessionId,
            phase: context?.phase,
            attempt: attemptNumber,
            valid: validationResult.valid,
            error: validationResult.error,
          });
        }

        if (validationResult.valid && validationResult.plannerResponse) {
          // Validation succeeded (possibly after retries)
          chatResponse = {
            ...chatResponse,
            assistant: {
              ...chatResponse.assistant,
              message: validationResult.plannerResponse.message,
            },
            plannerResponse: validationResult.plannerResponse,
          };

          logger.debug('Planner response validation succeeded', {
            requestId,
            sessionId: effectiveSessionId,
            phase: context?.phase,
            attempt: attemptNumber,
            plannerReadyForSpec: validationResult.plannerResponse.plannerReadyForSpec,
            hasImplementationPlan: validationResult.plannerResponse.implementationPlan !== null,
          });
        } else {
          // All attempts exhausted: use fallback
          const fallback = createFallbackPlannerResponse();

          chatResponse = {
            ...chatResponse,
            assistant: {
              ...chatResponse.assistant,
              message: SAFE_FALLBACK_MESSAGE,
            },
            plannerResponse: fallback,
            error: validationResult.error || 'Failed to parse planner response after all retry attempts',
          };

          logger.warn('Planner response validation failed after all retry attempts, using fallback', {
            requestId,
            sessionId: effectiveSessionId,
            phase: context?.phase,
            totalAttempts: attemptNumber,
            lastError: validationResult.error,
            rawContentLength: currentContent.length,
          });
        }
      }

      // Spec 2026-03-18: Handle test_planning phase with TestPlannerResponse validation
      if (shouldValidateTestPlannerResponse(context)) {
        const validationResult = validateTestPlannerResponse(response.content || '', effectiveSessionId);

        logger.info('Test planner response validation result', {
          requestId,
          sessionId: effectiveSessionId,
          phase: context?.phase,
          valid: validationResult.valid,
          testCount: validationResult.testPlannerResponse?.testPlan?.length || 0,
          questionsCount: validationResult.testPlannerResponse?.openQuestions?.length || 0,
          error: validationResult.error,
        });

        if (validationResult.valid && validationResult.testPlannerResponse) {
          chatResponse = {
            ...chatResponse,
            assistant: {
              ...chatResponse.assistant,
              message: validationResult.testPlannerResponse.message,
            },
            testPlannerResponse: validationResult.testPlannerResponse,
          };
        } else {
          const fallback = createFallbackTestPlannerResponse();
          chatResponse = {
            ...chatResponse,
            testPlannerResponse: fallback,
            error: validationResult.error || 'Failed to parse test planner response',
          };
        }
      }

      // Handle generate_specs intent validation
      // Spec: Implement Generate Specs - Iteration 4
      if (context?.intent === 'generate_specs') {
        const validationResult = validateGeneratedSpecs(response.content || '');

        logger.info('Generate specs validation result', {
          requestId,
          sessionId: effectiveSessionId,
          valid: validationResult.valid,
          specsCount: validationResult.specs?.length || 0,
          error: validationResult.error,
        });

        if (validationResult.valid && validationResult.specs) {
          // Validation succeeded: include specs in response
          chatResponse = {
            ...chatResponse,
            specs: validationResult.specs,
          };
          logger.debug('Generate specs validation succeeded', {
            requestId,
            sessionId: effectiveSessionId,
            specsCount: validationResult.specs.length,
          });
        } else {
          // Validation failed: return error message
          chatResponse = {
            ...chatResponse,
            assistant: {
              ...chatResponse.assistant,
              message: `Error: Failed to generate valid specifications. ${validationResult.error || 'Unknown validation error'}. Please try again.`,
            },
          };
          logger.warn('Generate specs validation failed', {
            requestId,
            sessionId: effectiveSessionId,
            error: validationResult.error,
            rawContent: (response.content || '').substring(0, 200),
          });
        }
      }


      // Handle handoff phase validation
      // Spec 2026-01-14: Implement Assistant Stage 6a - Sub-Spec Planning and Handoff Plan Preview
      if (context?.phase === 'handoff') {
        const handoffValidationResult = validateHandoffPlan(response.content || '');

        logger.info('Handoff plan validation result', {
          requestId,
          sessionId: effectiveSessionId,
          valid: handoffValidationResult.valid,
          intentsCount: handoffValidationResult.handoffPlan?.handoff_intents?.length || 0,
          error: handoffValidationResult.error,
        });

        if (handoffValidationResult.valid && handoffValidationResult.handoffPlan) {
          // Validation succeeded: include handoff plan in response
          chatResponse = {
            ...chatResponse,
            handoffPlan: handoffValidationResult.handoffPlan,
          };
          logger.debug('Handoff plan validation succeeded', {
            requestId,
            sessionId: effectiveSessionId,
            isSplit: handoffValidationResult.handoffPlan.is_split,
            intentsCount: handoffValidationResult.handoffPlan.handoff_intents.length,
          });

          // Spec 2026-01-14: Stage 7 - Append PLANNER_HANDOFF entry to transcript
          // Only append for implement_feature mode when handoff validation succeeds
          if (shouldAppendToTranscript(context)) {
            const handoffContent = JSON.stringify(handoffValidationResult.handoffPlan, null, 2);
            appendTranscriptEntry(effectiveSessionId, 'PLANNER_HANDOFF', 'handoff', handoffContent);
          }
        } else {
          // Validation failed: generate fallback plan
          const fallbackPlan = generateFallbackPlan(
            context?.workItem?.title,
            context?.workItem?.description
          );
          chatResponse = {
            ...chatResponse,
            handoffPlan: fallbackPlan,
            assistant: {
              ...chatResponse.assistant,
              message: `Note: Could not parse structured handoff plan from assistant response. Using fallback single-intent plan. Original error: ${handoffValidationResult.error || 'Unknown'}`,
            },
          };
          logger.warn('Handoff plan validation failed, using fallback', {
            requestId,
            sessionId: effectiveSessionId,
            error: handoffValidationResult.error,
            rawContent: (response.content || '').substring(0, 200),
          });
        }
      }

      const durationMs = Date.now() - startTime;
      logRequestEnd(requestId, effectiveSessionId, 200, durationMs);

      res.json(chatResponse);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/chat/stream
 *
 * Server-Sent Events stream for chat responses (streaming).
 */
chatRouter.get(
  '/stream',
  validateStreamRequestMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const requestId = req.requestId;
    const message = req.query.message as string;
    const context: ChatContext = {
      filename: req.query.filename as string | undefined,
      interfaceId: req.query.interfaceId as string | undefined,
      preferredFormat: req.query.preferredFormat as 'yaml' | 'json' | undefined,
    };

    // Generate sessionId if missing or blank after trim
    const sessionCreated = !(req.query.sessionId as string)?.trim();
    const effectiveSessionId = (req.query.sessionId as string)?.trim() || uuidv4();

    if (sessionCreated) {
      logger.info('Session ID generated by gateway', {
        session_created: true,
        sessionId: effectiveSessionId,
        requestId,
      });
    }

    logRequestStart(requestId, effectiveSessionId, 'GET', '/api/chat/stream');

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Handle client disconnect
    let isClientConnected = true;
    req.on('close', () => {
      isClientConnected = false;
    });

    /**
     * Send an SSE event
     */
    const sendEvent = (eventType: string, data: unknown) => {
      if (!isClientConnected) return;
      res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const config = getConfig();

      // Get or create session
      const session = getOrCreateSession(effectiveSessionId);

      // Build system prompt with context
      // Note: Streaming endpoint does not currently support implement_feature mode
      // so we don't resolve context here
      const systemPrompt = buildSystemPrompt(session, context);

      // Build messages with conversation history
      const messages = buildMessagesForTurn(session, systemPrompt, message);


      // Spec 2026-01-14: Stage 7 - Append USER entry to transcript
      // Only append for implement_feature mode
      if (shouldAppendToTranscript(context)) {
        const phase = getTranscriptPhase(context);
        appendTranscriptEntry(effectiveSessionId, 'USER', phase, message);
      }

      // Debug logging for conversation memory
      logger.debug('Building messages for streaming turn', {
        requestId,
        sessionId: effectiveSessionId,
        priorConversationCount: session.conversation?.length || 0,
      });

      // Track artifacts
      const artifacts: ChatArtifacts = {};
      let fullMessage = '';
      let toolCallCount = 0;

      // Start streaming
      let pendingToolCalls: ToolCall[] = [];
      let streaming = true;

      while (streaming && isClientConnected) {
        // Process any pending tool calls first
        if (pendingToolCalls.length > 0) {
          const toolCalls = pendingToolCalls;
          pendingToolCalls = [];

          // Create assistant message with tool calls
          const assistantMessage: OpenAIMessage = {
            role: 'assistant',
            content: '',
            tool_calls: toolCalls.map(tc => ({
              id: tc.callId,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          };

          const toolResults: ToolResult[] = [];

          for (const toolCall of toolCalls) {
            if (!isClientConnected) break;

            toolCallCount++;

            // Emit tool started event
            sendEvent('tool_call_started', {
              toolName: toolCall.name,
              callId: toolCall.callId,
            });

            const result = await executeToolCall(
              toolCall.callId,
              toolCall.name,
              toolCall.arguments,
              session.mcpSessionId,
              requestId,
              effectiveSessionId
            );

            toolResults.push({
              callId: result.callId,
              output: result.output,
              error: result.error,
            });

            // Emit tool finished event
            sendEvent('tool_call_finished', {
              toolName: toolCall.name,
              callId: toolCall.callId,
              status: result.status,
              durationMs: result.durationMs,
            });

            // Extract artifacts
            if (toolCall.name === 'save_oas_spec' && result.output && !result.error) {
              artifacts.savedSpec = result.output as SaveOasSpecSummaryDto;
            }

            if (toolCallCount >= config.maxToolCallsPerTurn) {
              break;
            }
          }

          // Add tool results to messages
          const toolResultMessages = buildToolResultMessages(assistantMessage, toolResults);
          messages.push(...toolResultMessages);
        }

        // Send request to OpenAI (streaming)
        const streamGen = sendStreamingRequest(messages, requestId, effectiveSessionId);

        for await (const event of streamGen) {
          if (!isClientConnected) break;

          if (event.type === 'token' && event.content) {
            fullMessage += event.content;
            sendEvent('token', { content: event.content });
          } else if (event.type === 'tool_call' && event.toolCall) {
            pendingToolCalls.push(event.toolCall);
          } else if (event.type === 'done') {
            if (pendingToolCalls.length === 0 || toolCallCount >= config.maxToolCallsPerTurn) {
              streaming = false;
            }
          }
        }
      }

      // Append final assistant response to messages for persistence
      messages.push({ role: 'assistant', content: fullMessage });

      // Debug logging for messages sent count
      logger.debug('Persisting conversation after streaming', {
        requestId,
        sessionId: effectiveSessionId,
        messagesSentCount: messages.length,
      });

      // Persist conversation before ending response
      persistConversation(effectiveSessionId, messages);

      // Update session
      updateSession(effectiveSessionId, {
        filename: context?.filename || session.filename,
        interfaceId: context?.interfaceId || session.interfaceId,
        lastSavedSpecSummary: artifacts.savedSpec || session.lastSavedSpecSummary,
      });

      // Send final event with sessionId
      if (isClientConnected) {
        sendEvent('final', {
          sessionId: effectiveSessionId,
          message: fullMessage,
          ...(Object.keys(artifacts).length > 0 ? { artifacts } : {}),
        });
      }

      const durationMs = Date.now() - startTime;
      logRequestEnd(requestId, effectiveSessionId, 200, durationMs);

      res.end();
    } catch (error) {
      if (isClientConnected) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        sendEvent('error', {
          code: 500,
          message: 'An error occurred while processing your request',
        });
      }

      const durationMs = Date.now() - startTime;
      logRequestEnd(requestId, effectiveSessionId, 500, durationMs);

      logger.error('Streaming error', {
        requestId,
        sessionId: effectiveSessionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      res.end();
    }
  }
);

/**
 * GET /health
 *
 * Health check endpoint.
 */
export const healthRouter = Router();

healthRouter.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

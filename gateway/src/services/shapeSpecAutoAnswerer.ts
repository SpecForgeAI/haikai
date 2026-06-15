/**
 * Headless Shape-Spec Auto-Answerer -- concrete implementation (Spec 2026-06-14,
 * Task Group 4).
 *
 * Implements the {@link ShapeSpecAutoAnswerer} seam the Driver's per-spec runner
 * (Task Group 2) calls. It lets the external software-architect service shape
 * each spec with NO human in the loop:
 *
 *   1. drives the headless shape-spec SSE stream ({@link driveShapeSpecStream},
 *      reusing the `requestStream` in-process seam + the `parseSSELine` event
 *      union), feeding the spec's combined `generated_spec_text`;
 *   2. for EACH `questions` batch, answers automatically via the bounded LLM
 *      answer loop ({@link answerShapeSpecQuestions}) -- it DECIDES, NEVER
 *      abstains -- grounded in the spec text (primary) + the composed migration
 *      context (product/migration goal + discovery findings), then resumes in
 *      RESUME mode (ONE combined numbered answer, `session_mode:'resume'`, NO
 *      `session_id` -- CD-1);
 *   3. appends each `{ question, answer, rationale }` decision to the run-item
 *      inline JSONB decision log via the AMS PATCH run-item endpoint (CD-4);
 *   4. on conclusion (`folder` + `session`) returns the captured `spec_name`
 *      (folder) + `session_id` (for the SpecIntent only) + the decision log.
 *
 * GROUNDING composes already-resolved materials (the `buildOpenPhaseGrounding`
 * PATTERN): the combined `generated_spec_text` body is the PRIMARY ground (fed
 * straight to the answer loop); the supplementary block is the existing context
 * resolvers' output (migration-discovery context + product summary). The resolver
 * call is injected so tests need no AMS round-trip.
 *
 * Everything external is injected ({@link ShapeSpecAutoAnswererDeps}) so the
 * answerer is unit-testable with mocks and the live-LLM guard is respected (the
 * LLM is only ever reached through the injected `ArchitectLlmClient`, mocked in
 * tests).
 *
 * The default production wiring ({@link buildDefaultShapeSpecAutoAnswerer})
 * bridges to the gateway-default `getLlmClient()` (the same adapter the architect
 * conversation uses) so the real run has a live decision model to call.
 *
 * Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 4.
 */

import { v4 as uuidv4 } from 'uuid';

import { logger } from './logger';
import type { OpenAIMessage, ChatRequestOptions } from './openaiClient';
import type {
  ArchitectLlmClient,
  ArchitectToolCall,
} from './architectConversation/architectLlmClient';
import {
  answerShapeSpecQuestions,
  type ShapeSpecAnswerDecision,
  type ShapeSpecQuestion,
} from './shapeSpecAnswerLoopRunner';
import {
  driveShapeSpecStream,
  realStreamOpener,
  type ShapeSpecStreamOpener,
} from './shapeSpecHeadlessStream';
import {
  patchMigrationExecutionRunItem,
  type MigrationExecutionRunItem,
} from './migrationExecutionRunClient';
import {
  MigrationDiscoveryContextResolver,
  ProductSummaryContextResolver,
} from './contextResolvers';
import { getLlmClient } from './llmClient';
import type {
  ShapeSpecAnswerInput,
  ShapeSpecAnswerResult,
  ShapeSpecAutoAnswerer,
} from './shapeSpecAutoAnswererSeam';

// ---------------------------------------------------------------------------
// Dependency surface (the DI seam for tests).
// ---------------------------------------------------------------------------

export interface ShapeSpecAutoAnswererDeps {
  /** The LLM client (mocked at this boundary in all tests -- the LLM guard). */
  llmClient: ArchitectLlmClient;
  /** Opens an upstream shape-spec stream POST (production: {@link realStreamOpener}). */
  openStream: ShapeSpecStreamOpener;
  /**
   * Resolve the supplementary migration grounding for a project (the
   * product/migration goal + discovery findings, composed). Production wires the
   * existing context resolvers; tests inject a canned string. Returns a single
   * prompt-ready block; the spec text is fed separately as the primary ground.
   */
  resolveGrounding: (projectId: string) => Promise<string>;
  /** PATCH the run-item (the inline JSONB decision log append -- CD-4). */
  patchRunItem: (
    projectId: string,
    runItemId: string,
    patch: MigrationExecutionRunItem
  ) => Promise<MigrationExecutionRunItem>;
  /** Optional model name forwarded to the answer loop. */
  model?: string;
}

// ---------------------------------------------------------------------------
// Grounding (the buildOpenPhaseGrounding PATTERN -- compose resolved materials).
// ---------------------------------------------------------------------------

/**
 * Compose the supplementary migration grounding from the existing context
 * resolvers (migration-discovery context + product summary). PURE composition
 * over already-resolved strings -- mirrors `buildOpenPhaseGrounding`. Empty /
 * unavailable sections are cleanly omitted; when nothing resolves, a short
 * explicit placeholder is returned so the prompt never carries an empty block.
 *
 * Production passes this as {@link ShapeSpecAutoAnswererDeps.resolveGrounding}.
 * Each resolver is fail-soft (returns a short status string, never throws), so
 * the answerer always has grounding to work with.
 */
export async function resolveMigrationGrounding(projectId: string): Promise<string> {
  const sections: string[] = [];
  // The resolvers key off the project; the thread key is unused by both.
  const threadKey = '';

  try {
    const discovery = await new MigrationDiscoveryContextResolver().resolve(
      projectId,
      threadKey
    );
    if (discovery && discovery.trim().length > 0) {
      sections.push(`## Migration discovery context\n${discovery.trim()}`);
    }
  } catch (error) {
    logger.debug('[diag-gateway] shape_spec_auto_answerer grounding_discovery_failed', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  try {
    const product = await new ProductSummaryContextResolver().resolve(projectId, threadKey);
    if (product && product.trim().length > 0) {
      sections.push(`## Migration goal / product summary\n${product.trim()}`);
    }
  } catch (error) {
    logger.debug('[diag-gateway] shape_spec_auto_answerer grounding_product_failed', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  if (sections.length === 0) {
    return 'No additional migration grounding context is available.';
  }
  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// The concrete answerer.
// ---------------------------------------------------------------------------

/**
 * Build a {@link ShapeSpecAutoAnswerer} over the injected deps. The returned
 * `driveAndAnswer` NEVER throws -- failures resolve as `{ ok:false, error }`.
 */
export function buildShapeSpecAutoAnswerer(
  deps: ShapeSpecAutoAnswererDeps
): ShapeSpecAutoAnswerer {
  return {
    async driveAndAnswer(input: ShapeSpecAnswerInput): Promise<ShapeSpecAnswerResult> {
      const { projectId, runItemId } = input;
      logger.info('[diag-gateway] shape_spec_auto_answerer drive_start', {
        projectId,
        runItemId,
        company: input.company,
        project: input.project,
      });

      // Resolve the supplementary grounding once for the whole stream (the spec
      // text is the primary ground and is fed per-batch by the stream driver).
      let grounding: string;
      try {
        grounding = await deps.resolveGrounding(projectId);
      } catch (error) {
        // Grounding is fail-soft: a resolver throw must not stop the run.
        grounding = 'No additional migration grounding context is available.';
        logger.warn('[diag-gateway] shape_spec_auto_answerer grounding_failed', {
          projectId,
          runItemId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // The running decision log -- persisted incrementally to the run-item so a
      // crash mid-stream still leaves the answered-so-far decisions durable (CD-4).
      const decisionLog: ShapeSpecAnswerDecision[] = [];

      const result = await driveShapeSpecStream({
        company: input.company,
        project: input.project,
        generatedSpecText: input.generatedSpecText,
        openStream: deps.openStream,
        answerBatch: async (questions: ShapeSpecQuestion[]) => {
          return answerShapeSpecQuestions({
            llmClient: deps.llmClient,
            specText: input.generatedSpecText,
            grounding,
            questions,
            model: deps.model,
          });
        },
        onDecision: (decision) => {
          decisionLog.push(decision);
          // Persist the growing log after each decision (best-effort; the PATCH
          // is null-guarded AMS-side so it never wipes other fields). A failed
          // persist is logged but never stops the stream -- the final result
          // also carries the full log for the runner to persist.
          void deps
            .patchRunItem(projectId, runItemId, {
              auto_answer_decision_log_json: decisionLog.map((d) => ({ ...d })),
            })
            .catch((error) => {
              logger.warn('[diag-gateway] shape_spec_auto_answerer log_persist_failed', {
                projectId,
                runItemId,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            });
        },
      });

      logger.info('[diag-gateway] shape_spec_auto_answerer drive_complete', {
        projectId,
        runItemId,
        ok: result.ok,
        specName: result.specName,
        decisionCount: result.decisionLog.length,
      });

      return {
        ok: result.ok,
        specName: result.specName,
        sessionId: result.sessionId,
        decisionLog: result.decisionLog.map((d) => ({ ...d })),
        error: result.error ?? null,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Production wiring -- bridge to the gateway-default LLM client.
// ---------------------------------------------------------------------------

/**
 * Build the production {@link ArchitectLlmClient} adapter over the gateway-default
 * `getLlmClient()` (the same bridge the architect conversation uses -- see
 * `routes/architectConversation.ts`'s `buildArchitectLlmClient`). Only
 * `callLlmToolLoop` is needed by the answer loop; `callSingleShot` throws (the
 * answerer never calls it).
 */
function buildProductionLlmClient(): ArchitectLlmClient {
  return {
    callLlmToolLoop: async (args) => {
      const llm = getLlmClient();
      const openaiMessages: OpenAIMessage[] = args.messages.map((m) => ({
        role: m.role,
        content: m.content ?? '',
        tool_call_id: m.tool_call_id,
        tool_calls: m.tool_calls,
      }));
      const options: ChatRequestOptions = {
        tools: args.tools as unknown as ChatRequestOptions['tools'],
        toolChoice: args.toolChoice as unknown as ChatRequestOptions['toolChoice'],
      };
      const response = await llm.sendChatRequest(
        openaiMessages,
        `shape-spec-answer-${uuidv4()}`,
        `shape-spec-answer-session-${uuidv4()}`,
        options
      );
      const toolCalls: ArchitectToolCall[] | undefined = response.toolCalls?.map((tc) => ({
        id: tc.callId,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
      }));
      return {
        message: {
          role: 'assistant',
          content: response.content ?? null,
          tool_calls: toolCalls,
        },
      };
    },
    callSingleShot: async () => {
      throw new Error('callSingleShot is not used by the shape-spec auto-answerer');
    },
  };
}

/**
 * The default production answerer: the real `requestStream` stream opener, the
 * real context-resolver grounding, the real AMS PATCH run-item, and the
 * gateway-default LLM client. Injected into {@link defaultMigrationDriverDeps}.
 */
export function buildDefaultShapeSpecAutoAnswerer(): ShapeSpecAutoAnswerer {
  return buildShapeSpecAutoAnswerer({
    llmClient: buildProductionLlmClient(),
    openStream: realStreamOpener,
    resolveGrounding: resolveMigrationGrounding,
    patchRunItem: patchMigrationExecutionRunItem,
  });
}

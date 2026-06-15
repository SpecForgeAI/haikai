/**
 * Discovery Business-Logic Behaviour-Capture Relay Route
 *
 * Spec: 2026-05-29 Business-logic behaviour capture for discovery (Gap C),
 * Task Group 2.
 *
 * Provides a stateless relay endpoint for the per-method behaviour-capture
 * LLM stage (`llmBehaviourCaptureStep` in discovery-service). The
 * discovery-service composes a fully-assembled prompt (the method body + 1
 * hop of direct-callee bodies + the documented 7-part output contract) and
 * POSTs it here; this route forwards the prompt to the shared LLM client and
 * returns the response content unmodified.
 *
 * This is a SIBLING of the V3 gap-fill relay (`discoveryGapFill.ts`). Both
 * routes are thin stateless prompt relays with no prompt content of their
 * own; behaviour capture gets its own route purely so its LLM traffic is
 * independently observable in gateway logs / metrics. The behaviour-capture
 * stage MUST NOT call the LLM directly — all LLM access flows through this
 * relay, exactly like gap-fill.
 *
 * Endpoint:
 *   POST /v3/behaviour-capture
 *
 * Mounted at /api/v1/discovery in server.ts, serving:
 *   POST /api/v1/discovery/v3/behaviour-capture
 */

import { Router, Request, Response } from 'express';
import { getLlmClient } from '../services/llmClient';
import { logger } from '../services/logger';
import { OpenAIMessage } from '../services/openaiClient';

export const discoveryBehaviourCaptureRouter = Router();

// ============================================================================
// Types
// ============================================================================

/**
 * Request shape for the behaviour-capture relay.
 *
 * The discovery-service composes the prompt from its method-body +
 * direct-callee-body assembly and sends it here fully assembled. `methodId`
 * and `runId` are carried for logging / correlation only.
 */
interface BehaviourCaptureRequest {
  /** Fully-assembled prompt composed by discovery-service. */
  prompt: string;
  /** Stable method id `FQN#name(ParamTypes)` the prompt targets -- logging / correlation only. */
  methodId: string;
  /** Discovery run ID -- used for logging / correlation only. */
  runId: string;
}

/**
 * Response shape returned to discovery-service.
 *
 * Raw LLM text content is returned verbatim. JSON parsing + 7-part-block
 * validation happen downstream in discovery-service.
 */
interface BehaviourCaptureResponse {
  /** Raw LLM response content (expected to be the documented 7-part JSON block). */
  content: string;
  /** Token usage information (passthrough from the LLM client). */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

// ============================================================================
// POST /v3/behaviour-capture
// ============================================================================

/**
 * POST /v3/behaviour-capture
 *
 * Stateless relay: accepts a caller-composed prompt, forwards it to the
 * configured LLM client, returns the response content.
 *
 * Request body: { prompt: string, methodId: string, runId: string }
 * Response body: { content: string, usage?: {...} }
 */
discoveryBehaviourCaptureRouter.post(
  '/v3/behaviour-capture',
  async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || 'unknown';
    const startTime = Date.now();

    try {
      const body = req.body as BehaviourCaptureRequest;

      // Validate request body
      if (!body || typeof body.prompt !== 'string' || body.prompt.length === 0) {
        return res.status(400).json({
          error: { code: 400, message: 'prompt is required and must be a non-empty string' },
        });
      }

      if (typeof body.methodId !== 'string' || body.methodId.length === 0) {
        return res.status(400).json({
          error: { code: 400, message: 'methodId is required and must be a non-empty string' },
        });
      }

      if (typeof body.runId !== 'string' || body.runId.length === 0) {
        return res.status(400).json({
          error: { code: 400, message: 'runId is required and must be a non-empty string' },
        });
      }

      logger.info('[BehaviourCapture] Received behaviour-capture request', {
        requestId,
        runId: body.runId,
        methodId: body.methodId,
        promptLengthChars: body.prompt.length,
        estimatedTokens: Math.ceil(body.prompt.length / 4),
      });

      // Build a single user message containing the caller-supplied prompt.
      // No system message is injected here -- the caller-composed prompt
      // already contains any role / system context.
      const messages: OpenAIMessage[] = [
        {
          role: 'user',
          content: body.prompt,
        },
      ];

      const llmClient = getLlmClient();
      const llmStart = Date.now();
      const llmResponse = await llmClient.sendChatRequest(
        messages,
        requestId,
        `v3-behaviour-capture-${body.runId}-${body.methodId}`,
        // temperature 0 → deterministic behaviour capture (oracle reproducibility).
        { tools: [], temperature: 0 },
      );
      const llmDurationMs = Date.now() - llmStart;

      logger.info('[BehaviourCapture] LLM response received', {
        requestId,
        runId: body.runId,
        methodId: body.methodId,
        llmDurationMs,
        responseContentLength: llmResponse.content?.length || 0,
        usage: llmResponse.usage,
        totalDurationMs: Date.now() - startTime,
      });

      const response: BehaviourCaptureResponse = {
        content: llmResponse.content || '',
        usage: llmResponse.usage,
      };

      return res.json(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[BehaviourCapture] Endpoint error', {
        requestId,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        totalDurationMs: Date.now() - startTime,
      });
      return res.status(500).json({
        error: {
          code: 500,
          message: 'Internal server error',
        },
      });
    }
  },
);
